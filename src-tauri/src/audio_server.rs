use crate::storage;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use uuid::Uuid;

const MAX_HEADER_BYTES: u64 = 8 * 1024;
const MAX_HEADERS: usize = 32;
const MAX_CONNECTIONS: usize = 16;
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(5);
const ALLOWED_ORIGINS: [&str; 5] = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
];

fn is_allowed_origin(origin: &str) -> bool {
    ALLOWED_ORIGINS.contains(&origin)
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

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
    connections: Arc<Semaphore>,
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
            connections: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
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
                let Ok(permit) = Arc::clone(&server_state.connections).try_acquire_owned() else {
                    // 同時接続数の上限を超えたら即座に切断する。
                    drop(stream);
                    continue;
                };
                let st = Arc::clone(&server_state);
                tauri::async_runtime::spawn(async move {
                    let _permit = permit;
                    let _ = handle_connection(stream, st).await;
                });
            }
        });
        Ok(state)
    });
    res.as_ref().map_err(|e| e.clone())
}

pub fn register_note_audio(note_id: &str, path: PathBuf, encrypted: bool) -> Result<String, String> {
    if storage::validate_note_audio_path(&path.to_string_lossy(), note_id).is_none() {
        return Err("管理外または他ノートの音声ファイルは配信できません。".to_string());
    }
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

struct HttpRequest {
    method: String,
    target: String,
    origin: Option<String>,
    range: Option<String>,
}

fn append_cors_headers(headers: &mut String, origin: Option<&str>) {
    if let Some(origin) = origin {
        headers.push_str(&format!(
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"
        ));
    }
}

async fn write_simple_response<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    origin: Option<&str>,
    status: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let mut header = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    append_cors_headers(&mut header, origin);
    header.push_str("\r\n");
    writer.write_all(header.as_bytes()).await?;
    if !body.is_empty() {
        writer.write_all(body).await?;
    }
    Ok(())
}

async fn read_request<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> io::Result<Option<HttpRequest>> {
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await? == 0 {
        return Ok(None);
    }
    // Take の上限に達して改行が来なかった場合はヘッダー過大とみなす。
    if !request_line.ends_with('\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request line too large",
        ));
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();

    let mut origin: Option<String> = None;
    let mut range: Option<String> = None;
    let mut header_count = 0usize;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if !line.ends_with('\n') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "header too large",
            ));
        }
        header_count += 1;
        if header_count > MAX_HEADERS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many headers",
            ));
        }
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range = Some(val.trim().to_string());
            } else if name.trim().eq_ignore_ascii_case("origin") {
                origin = Some(val.trim().to_string());
            }
        }
    }

    Ok(Some(HttpRequest {
        method,
        target,
        origin,
        range,
    }))
}

async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<AudioServerState>,
) -> std::io::Result<()> {
    let (reader_half, mut writer_half) = stream.split();
    let mut reader = BufReader::new(reader_half.take(MAX_HEADER_BYTES));

    let request = match tokio::time::timeout(HEADER_READ_TIMEOUT, read_request(&mut reader)).await {
        Err(_) => {
            return write_simple_response(
                &mut writer_half,
                None,
                "408 Request Timeout",
                b"Request timeout",
            )
            .await;
        }
        Ok(Err(e)) if e.kind() == io::ErrorKind::InvalidData => {
            return write_simple_response(
                &mut writer_half,
                None,
                "431 Request Header Fields Too Large",
                b"Headers too large",
            )
            .await;
        }
        Ok(Err(e)) => return Err(e),
        Ok(Ok(None)) => return Ok(()),
        Ok(Ok(Some(request))) => request,
    };

    if let Some(origin) = request.origin.as_deref() {
        if !is_allowed_origin(origin) {
            return write_simple_response(&mut writer_half, None, "403 Forbidden", b"Forbidden")
                .await;
        }
    }
    let origin = request.origin.as_deref();

    if request.method == "OPTIONS" {
        let mut resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Range\r\n"
            .to_string();
        append_cors_headers(&mut resp, origin);
        resp.push_str("Connection: close\r\n\r\n");
        writer_half.write_all(resp.as_bytes()).await?;
        return Ok(());
    }

    if request.method != "GET" && request.method != "HEAD" {
        return write_simple_response(&mut writer_half, origin, "405 Method Not Allowed", b"").await;
    }

    let (path_part, query_part) = request.target.split_once('?').unwrap_or((&request.target, ""));
    let token_ok = query_part
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .any(|(k, v)| k == "token" && constant_time_eq(v, &state.token));
    if !token_ok {
        return write_simple_response(&mut writer_half, origin, "403 Forbidden", b"Forbidden").await;
    }

    let Some(note_id) = path_part.strip_prefix("/audio/") else {
        return write_simple_response(&mut writer_half, origin, "404 Not Found", b"Not Found").await;
    };
    let entry = {
        let guard = state.entries.lock().unwrap_or_else(|e| e.into_inner());
        guard.get(note_id).cloned()
    };
    let Some(entry) = entry else {
        return write_simple_response(&mut writer_half, origin, "404 Not Found", b"Not Found").await;
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
                            &mut writer_half,
                            origin,
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
        let (status_line, start, end) = match request
            .range
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
             Content-Length: {content_len}\r\n",
            entry.mime
        );
        if status_line.starts_with("HTTP/1.1 206") {
            headers.push_str(&format!("Content-Range: bytes {start}-{end}/{total_len}\r\n"));
        }
        append_cors_headers(&mut headers, origin);
        headers.push_str("Connection: close\r\n\r\n");
        writer_half.write_all(headers.as_bytes()).await?;
        if request.method == "GET" && content_len > 0 {
            writer_half
                .write_all(&bytes[start as usize..=(end as usize)])
                .await?;
        }
        return Ok(());
    }

    let Ok(mut file) = tokio::fs::File::open(&entry.path).await else {
        return write_simple_response(&mut writer_half, origin, "404 Not Found", b"Audio not found").await;
    };
    let total_len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let (status_line, start, end) = match request
        .range
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
         Content-Length: {content_len}\r\n",
        entry.mime
    );
    if status_line.starts_with("HTTP/1.1 206") {
        headers.push_str(&format!("Content-Range: bytes {start}-{end}/{total_len}\r\n"));
    }
    append_cors_headers(&mut headers, origin);
    headers.push_str("Connection: close\r\n\r\n");
    writer_half.write_all(headers.as_bytes()).await?;

    if request.method == "GET" && content_len > 0 {
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
    use super::{constant_time_eq, is_allowed_origin, parse_range_header};

    #[test]
    fn parses_http_byte_ranges_correctly() {
        assert_eq!(parse_range_header("bytes=0-1023", 4096), Some((0, 1023)));
        assert_eq!(parse_range_header("bytes=1024-", 4096), Some((1024, 4095)));
        assert_eq!(parse_range_header("bytes=-512", 4096), Some((3584, 4095)));
        assert_eq!(parse_range_header("bytes=4096-", 4096), None);
        assert_eq!(parse_range_header("bytes=100-50", 4096), None);
        assert_eq!(parse_range_header("bytes=0-10", 0), None);
    }

    #[test]
    fn only_allows_known_webview_origins() {
        assert!(is_allowed_origin("http://tauri.localhost"));
        assert!(is_allowed_origin("https://tauri.localhost"));
        assert!(is_allowed_origin("tauri://localhost"));
        assert!(is_allowed_origin("http://localhost:1420"));
        assert!(!is_allowed_origin("https://evil.example"));
        assert!(!is_allowed_origin("http://127.0.0.1:8080"));
        assert!(!is_allowed_origin("http://tauri.localhost.evil.example"));
    }

    #[test]
    fn compares_tokens_without_early_exit() {
        assert!(constant_time_eq("abcd1234", "abcd1234"));
        assert!(!constant_time_eq("abcd1234", "abcd1235"));
        assert!(!constant_time_eq("abcd1234", "abcd123"));
        assert!(!constant_time_eq("", "x"));
    }
}
