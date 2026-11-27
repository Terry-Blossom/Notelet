use crate::storage;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

#[derive(Clone)]
struct AudioStreamEntry {
    path: PathBuf,
    encrypted: bool,
    mime: String,
}

struct AudioServerState {
    port: u16,
    token: String,
    entries: Mutex<HashMap<String, AudioStreamEntry>>,
    decrypted_cache: Mutex<Option<(String, Arc<Vec<u8>>)>>,
}

static SERVER_STATE: OnceLock<Result<Arc<AudioServerState>, String>> = OnceLock::new();

fn mime_for_audio_path(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "ogg" | "opus" => "audio/ogg",
        "webm" => "audio/webm",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        _ => "audio/wav",
    }
    .to_string()
}

fn ensure_server() -> Result<&'static Arc<AudioServerState>, String> {
    let res = SERVER_STATE.get_or_init(|| {
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("音声ストリーミングサーバーの起動に失敗: {e}"))?;
        std_listener
            .set_nonblocking(true)
            .map_err(|e| format!("音声サーバー設定失敗: {e}"))?;
        let port = std_listener
            .local_addr()
            .map_err(|e| format!("音声サーバーアドレス取得失敗: {e}"))?
            .port();
        let state = Arc::new(AudioServerState {
            port,
            token: Uuid::new_v4().simple().to_string(),
            entries: Mutex::new(HashMap::new()),
            decrypted_cache: Mutex::new(None),
        });
        let server_state = Arc::clone(&state);
        tauri::async_runtime::spawn(async move {
            let Ok(listener) = TcpListener::from_std(std_listener) else {
                return;
            };
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    continue;
                };
                let st = Arc::clone(&server_state);
                tauri::async_runtime::spawn(async move {
                    let _ = handle_connection(stream, st).await;
                });
            }
        });
        Ok(state)
    });
    res.as_ref().map_err(|e| e.clone())
}

pub fn register_note_audio(note_id: &str, path: PathBuf, encrypted: bool) -> Result<String, String> {
    let state = ensure_server()?;
    let mime = mime_for_audio_path(&path);
    {
        let mut guard = state.entries.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(
            note_id.to_string(),
            AudioStreamEntry {
                path,
                encrypted,
                mime,
            },
        );
    }
    {
        let mut cache = state.decrypted_cache.lock().unwrap_or_else(|e| e.into_inner());
        if cache.as_ref().is_some_and(|(id, _)| id == note_id) {
            *cache = None;
        }
    }
    Ok(format!(
        "http://127.0.0.1:{}/audio/{}?token={}",
        state.port, note_id, state.token
    ))
}

pub(crate) fn parse_range_header(header_val: &str, total_len: u64) -> Option<(u64, u64)> {
    if total_len == 0 {
        return None;
    }
    let spec = header_val.trim().strip_prefix("bytes=")?;
    let first_range = spec.split(',').next()?.trim();
    let (start_s, end_s) = first_range.split_once('-')?;
    if start_s.is_empty() {
        let suffix: u64 = end_s.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix);
        return Some((start, total_len - 1));
    }
    let start: u64 = start_s.trim().parse().ok()?;
    if start >= total_len {
        return None;
    }
    let end = if end_s.trim().is_empty() {
        total_len - 1
    } else {
        end_s.trim().parse::<u64>().ok()?.min(total_len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

async fn write_simple_response(
    stream: &mut TcpStream,
    status: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    if !body.is_empty() {
        stream.write_all(body).await?;
    }
    Ok(())
}

async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<AudioServerState>,
) -> std::io::Result<()> {
    let (reader_half, mut writer_half) = stream.split();
    let mut reader = BufReader::new(reader_half);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await? == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    let mut range_header: Option<String> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range_header = Some(val.trim().to_string());
            }
        }
    }

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                    Access-Control-Allow-Headers: Range\r\n\
                    Connection: close\r\n\r\n";
        writer_half.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    if method != "GET" && method != "HEAD" {
        return write_simple_response(&mut stream, "405 Method Not Allowed", b"").await;
    }

    let (path_part, query_part) = target.split_once('?').unwrap_or((target, ""));
    let token_ok = query_part
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .any(|(k, v)| k == "token" && v == state.token);
    if !token_ok {
        return write_simple_response(&mut stream, "403 Forbidden", b"Forbidden").await;
    }

    let Some(note_id) = path_part.strip_prefix("/audio/") else {
        return write_simple_response(&mut stream, "404 Not Found", b"Not Found").await;
    };
    let entry = {
        let guard = state.entries.lock().unwrap_or_else(|e| e.into_inner());
        guard.get(note_id).cloned()
    };
    let Some(entry) = entry else {
        return write_simple_response(&mut stream, "404 Not Found", b"Not Found").await;
    };

    if entry.encrypted {
        let bytes = {
            let cached = {
                let guard = state.decrypted_cache.lock().unwrap_or_else(|e| e.into_inner());
                guard
                    .as_ref()
                    .filter(|(id, _)| id == note_id)
                    .map(|(_, b)| Arc::clone(b))
            };
            if let Some(b) = cached {
                b
            } else {
                let path_str = entry.path.to_string_lossy().to_string();
                let dec = match tokio::task::spawn_blocking(move || {
                    storage::read_retained_audio_bytes(&path_str, true)
                })
                .await
                {
                    Ok(Ok(b)) => Arc::new(b),
                    _ => {
                        return write_simple_response(
                            &mut stream,
                            "500 Internal Server Error",
                            b"Decrypt failed",
                        )
                        .await;
                    }
                };
                let mut guard = state.decrypted_cache.lock().unwrap_or_else(|e| e.into_inner());
                *guard = Some((note_id.to_string(), Arc::clone(&dec)));
                dec
            }
        };

        let total_len = bytes.len() as u64;
        let (status_line, start, end) = match range_header
            .as_deref()
            .and_then(|r| parse_range_header(r, total_len))
        {
            Some((s, e)) => ("HTTP/1.1 206 Partial Content", s, e),
            None => (
                "HTTP/1.1 200 OK",
                0,
                total_len.saturating_sub(1),
            ),
        };
        let content_len = if total_len == 0 { 0 } else { end - start + 1 };
        let mut headers = format!(
            "{status_line}\r\n\
             Content-Type: {}\r\n\
             Accept-Ranges: bytes\r\n\
             Content-Length: {content_len}\r\n\
             Access-Control-Allow-Origin: *\r\n",
            entry.mime
        );
        if status_line.starts_with("HTTP/1.1 206") {
            headers.push_str(&format!("Content-Range: bytes {start}-{end}/{total_len}\r\n"));
        }
        headers.push_str("Connection: close\r\n\r\n");
        writer_half.write_all(headers.as_bytes()).await?;
        if method == "GET" && content_len > 0 {
            writer_half
                .write_all(&bytes[start as usize..=(end as usize)])
                .await?;
        }
        return Ok(());
    }

    let Ok(mut file) = tokio::fs::File::open(&entry.path).await else {
        return write_simple_response(&mut stream, "404 Not Found", b"Audio not found").await;
    };
    let total_len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let (status_line, start, end) = match range_header
        .as_deref()
        .and_then(|r| parse_range_header(r, total_len))
    {
        Some((s, e)) => ("HTTP/1.1 206 Partial Content", s, e),
        None => ("HTTP/1.1 200 OK", 0, total_len.saturating_sub(1)),
    };
    let content_len = if total_len == 0 { 0 } else { end - start + 1 };
    let mut headers = format!(
        "{status_line}\r\n\
         Content-Type: {}\r\n\
         Accept-Ranges: bytes\r\n\
         Content-Length: {content_len}\r\n\
         Access-Control-Allow-Origin: *\r\n",
        entry.mime
    );
    if status_line.starts_with("HTTP/1.1 206") {
        headers.push_str(&format!("Content-Range: bytes {start}-{end}/{total_len}\r\n"));
    }
    headers.push_str("Connection: close\r\n\r\n");
    writer_half.write_all(headers.as_bytes()).await?;

    if method == "GET" && content_len > 0 {
        file.seek(std::io::SeekFrom::Start(start)).await?;
        let mut remaining = content_len;
        let mut buf = vec![0u8; 64 * 1024];
        while remaining > 0 {
            let to_read = (remaining as usize).min(buf.len());
            let n = file.read(&mut buf[..to_read]).await?;
            if n == 0 {
                break;
            }
            writer_half.write_all(&buf[..n]).await?;
            remaining -= n as u64;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_range_header;

    #[test]
    fn parses_http_byte_ranges_correctly() {
        assert_eq!(parse_range_header("bytes=0-1023", 4096), Some((0, 1023)));
        assert_eq!(parse_range_header("bytes=1024-", 4096), Some((1024, 4095)));
        assert_eq!(parse_range_header("bytes=-512", 4096), Some((3584, 4095)));
        assert_eq!(parse_range_header("bytes=4096-", 4096), None);
        assert_eq!(parse_range_header("bytes=100-50", 4096), None);
        assert_eq!(parse_range_header("bytes=0-10", 0), None);
    }
}
