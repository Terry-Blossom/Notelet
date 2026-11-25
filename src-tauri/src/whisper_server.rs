use crate::storage;
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const SERVER_BINARY_CANDIDATES: &[&str] = if cfg!(windows) {
    &[
        "whisper-server.exe",
        "whisper-server-win32-x64-cuda.exe",
        "whisper-server-win32-x64-vulkan.exe",
        "whisper-server-win32-x64-cpu.exe",
    ]
} else if cfg!(target_os = "macos") {
    if cfg!(target_arch = "aarch64") {
        &[
            "whisper-server-darwin-arm64",
            "whisper-server",
            "whisper-server-darwin-x64",
        ]
    } else {
        &[
            "whisper-server-darwin-x64",
            "whisper-server",
            "whisper-server-darwin-arm64",
        ]
    }
} else {
    &[
        "whisper-server",
        "whisper-server-linux-x64-cuda",
        "whisper-server-linux-x64-vulkan",
        "whisper-server-linux-x64-cpu",
    ]
};

struct ServerState {
    child: Child,
    port: u16,
    server_bin: PathBuf,
    model_path: PathBuf,
    language: String,
    use_gpu: bool,
    stderr_log: Arc<StdMutex<String>>,
}

static WHISPER_SERVER: OnceLock<Mutex<Option<ServerState>>> = OnceLock::new();
static SERVER_PID: AtomicU32 = AtomicU32::new(0);

fn kill_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

fn server_mutex() -> &'static Mutex<Option<ServerState>> {
    WHISPER_SERVER.get_or_init(|| Mutex::new(None))
}

fn configure_bg_command(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub(crate) fn find_server_in_dir(dir: &Path) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    for name in SERVER_BINARY_CANDIDATES {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(found) = find_server_in_dir(&p) {
                    return Some(found);
                }
            } else if let Some(fname) = p.file_name().and_then(|n| n.to_str()) {
                if fname.starts_with("whisper-server") {
                    return Some(p);
                }
            }
        }
    }
    None
}

pub fn resolve_whisper_server(custom_path: &str) -> Option<PathBuf> {
    if !custom_path.trim().is_empty() {
        let p = PathBuf::from(custom_path.trim());
        if p.is_dir() {
            if let Some(found) = find_server_in_dir(&p) {
                return Some(found);
            }
        }
        if p.is_file() {
            if let Some(fname) = p.file_name().and_then(|n| n.to_str()) {
                if fname.starts_with("whisper-server") {
                    return Some(p);
                }
            }
            if let Some(parent) = p.parent() {
                if let Some(found) = find_server_in_dir(parent) {
                    return Some(found);
                }
            }
        }
    }

    let app_bin = storage::app_data_dir().join("bin").join("whisper");
    if let Some(found) = find_server_in_dir(&app_bin) {
        return Some(found);
    }

    for candidate in SERVER_BINARY_CANDIDATES {
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path_var) {
                let c = dir.join(candidate);
                if c.is_file() {
                    return Some(c);
                }
            }
        }
    }

    for fixed in [
        "/opt/homebrew/bin/whisper-server",
        "/usr/local/bin/whisper-server",
        "/usr/bin/whisper-server",
    ] {
        let p = PathBuf::from(fixed);
        if p.is_file() {
            return Some(p);
        }
    }

    None
}

fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("空きポートの確保に失敗しました: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("ポート取得失敗: {e}"))?
        .port();
    Ok(port)
}

async fn check_health(client: &reqwest::Client, port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/");
    client
        .get(&url)
        .timeout(Duration::from_millis(1200))
        .send()
        .await
        .is_ok()
}

fn recent_stderr(log: &Arc<StdMutex<String>>) -> String {
    let guard = log.lock().ok();
    let s = guard.as_deref().map_or("", |v| v.as_str());
    let trimmed = s.trim();
    if trimmed.len() > 400 {
        let start = trimmed.len() - 400;
        let safe_start = trimmed
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= start)
            .unwrap_or(0);
        trimmed[safe_start..].to_string()
    } else {
        trimmed.to_string()
    }
}

async fn spawn_once(
    server_bin: &Path,
    model_path: &Path,
    language: &str,
    use_gpu: bool,
    threads: usize,
) -> Result<ServerState, String> {
    let port = find_free_port()?;
    let mut cmd = Command::new(server_bin);
    configure_bg_command(&mut cmd);

    if let Some(bin_dir) = server_bin.parent() {
        if let Ok(existing_path) = std::env::var("PATH") {
            let sep = if cfg!(windows) { ";" } else { ":" };
            cmd.env("PATH", format!("{}{sep}{existing_path}", bin_dir.display()));
        } else {
            cmd.env("PATH", bin_dir);
        }
        #[cfg(target_os = "linux")]
        {
            let existing_ld = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            let next_ld = if existing_ld.is_empty() {
                bin_dir.display().to_string()
            } else {
                format!("{}:{existing_ld}", bin_dir.display())
            };
            cmd.env("LD_LIBRARY_PATH", next_ld);
        }
    }

    // Use model_path's parent as working directory and pass the ASCII filename to -m
    // so Windows ANSI argv never breaks on non-ASCII (e.g. Japanese) user profile paths.
    let model_arg: String = if let (Some(parent), Some(fname)) =
        (model_path.parent(), model_path.file_name().and_then(|n| n.to_str()))
    {
        if fname.is_ascii() {
            cmd.current_dir(parent);
            fname.to_string()
        } else {
            model_path.to_string_lossy().to_string()
        }
    } else {
        model_path.to_string_lossy().to_string()
    };

    let startup_lang = if language.trim().is_empty() {
        "ja"
    } else {
        language.trim()
    };

    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-m")
        .arg(&model_arg)
        .arg("-l")
        .arg(startup_lang)
        .arg("-t")
        .arg(threads.to_string())
        .arg("--max-len")
        .arg("4096")
        .arg("--suppress-nst")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if !use_gpu {
        cmd.arg("-ng");
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(server_bin) {
            let mut perms = meta.permissions();
            if perms.mode() & 0o111 == 0 {
                perms.set_mode(perms.mode() | 0o755);
                let _ = fs::set_permissions(server_bin, perms);
            }
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("whisper-server の起動に失敗しました: {e}"))?;
    SERVER_PID.store(child.id(), Ordering::SeqCst);

    let stderr_log = Arc::new(StdMutex::new(String::new()));
    if let Some(mut stderr_pipe) = child.stderr.take() {
        let log_clone = Arc::clone(&stderr_log);
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            while let Ok(n) = stderr_pipe.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let chunk = String::from_utf8_lossy(&buf[..n]);
                if let Ok(mut g) = log_clone.lock() {
                    g.push_str(&chunk);
                    if g.len() > 8192 {
                        let trim_at = g.len() - 4096;
                        let safe = g
                            .char_indices()
                            .map(|(i, _)| i)
                            .find(|&i| i >= trim_at)
                            .unwrap_or(0);
                        g.drain(..safe);
                    }
                }
            }
        });
    }

    let client = reqwest::Client::new();
    // Vulkan shader compilation on cold start can take up to ~90s
    let timeout_secs = if use_gpu { 90 } else { 45 };
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            SERVER_PID.store(0, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(50)).await;
            let detail = recent_stderr(&stderr_log);
            return Err(format!(
                "whisper-server が起動中に終了しました ({status}){}",
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(": {detail}")
                }
            ));
        }
        if check_health(&client, port).await {
            return Ok(ServerState {
                child,
                port,
                server_bin: server_bin.to_path_buf(),
                model_path: model_path.to_path_buf(),
                language: startup_lang.to_string(),
                use_gpu,
                stderr_log,
            });
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let _ = child.kill();
    let _ = child.wait();
    SERVER_PID.store(0, Ordering::SeqCst);
    let detail = recent_stderr(&stderr_log);
    Err(format!(
        "whisper-server の起動がタイムアウトしました{}",
        if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        }
    ))
}

/// ポート確保とプロセス起動の間に他プロセスが同じポートを掴む競合に備え、
/// 起動直後に終了した場合だけ新しいポートで数回リトライする。
async fn spawn_and_wait(
    server_bin: &Path,
    model_path: &Path,
    language: &str,
    use_gpu: bool,
    threads: usize,
) -> Result<ServerState, String> {
    let mut last_err = String::new();
    for attempt in 0..3 {
        match spawn_once(server_bin, model_path, language, use_gpu, threads).await {
            Ok(state) => return Ok(state),
            Err(err) => {
                let retryable = err.contains("起動中に終了しました");
                last_err = err;
                if !retryable || attempt == 2 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        }
    }
    Err(last_err)
}

async fn ensure_running(
    server_bin: &Path,
    model_path: &Path,
    language: &str,
    use_gpu: bool,
    threads: usize,
) -> Result<(u16, bool), String> {
    let mut guard = server_mutex().lock().await;
    let client = reqwest::Client::new();
    let norm_lang = if language.trim().is_empty() {
        "ja"
    } else {
        language.trim()
    };

    if let Some(st) = guard.as_mut() {
        let alive = matches!(st.child.try_wait(), Ok(None));
        if alive
            && st.server_bin == server_bin
            && st.model_path == model_path
            && st.language == norm_lang
            && st.use_gpu == use_gpu
            && check_health(&client, st.port).await
        {
            return Ok((st.port, st.use_gpu));
        }
        let _ = st.child.kill();
        let _ = st.child.wait();
        SERVER_PID.store(0, Ordering::SeqCst);
        *guard = None;
    }

    match spawn_and_wait(server_bin, model_path, norm_lang, use_gpu, threads).await {
        Ok(st) => {
            let port = st.port;
            let gpu = st.use_gpu;
            *guard = Some(st);
            Ok((port, gpu))
        }
        Err(gpu_err) if use_gpu => {
            // Automatic CPU fallback if GPU server fails to start
            match spawn_and_wait(server_bin, model_path, norm_lang, false, threads).await {
                Ok(st) => {
                    let port = st.port;
                    *guard = Some(st);
                    Ok((port, false))
                }
                Err(cpu_err) => Err(format!("{gpu_err} / CPUフォールバックも失敗: {cpu_err}")),
            }
        }
        Err(err) => Err(err),
    }
}

pub async fn prewarm(server_bin: &Path, model_path: &Path, language: &str, use_gpu: bool) {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let _ = ensure_running(server_bin, model_path, language, use_gpu, threads).await;
}

pub fn stop_server_sync() {
    if let Ok(mut guard) = server_mutex().try_lock() {
        if let Some(mut st) = guard.take() {
            let _ = st.child.kill();
            let _ = st.child.wait();
            SERVER_PID.store(0, Ordering::SeqCst);
            return;
        }
    }
    // 起動処理がロックを保持している間でも、PID が分かれば直接終了させる。
    let pid = SERVER_PID.swap(0, Ordering::SeqCst);
    kill_pid(pid);
}

pub async fn stop_server_async() {
    let mut guard = server_mutex().lock().await;
    if let Some(mut st) = guard.take() {
        let _ = st.child.kill();
        let _ = st.child.wait();
        SERVER_PID.store(0, Ordering::SeqCst);
    }
}

async fn post_inference(
    port: u16,
    wav_bytes: Vec<u8>,
    language: &str,
    prompt: &str,
) -> Result<Value, String> {
    let part = Part::bytes(wav_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("WAVパート構築失敗: {e}"))?;
    let mut form = Form::new()
        .part("file", part)
        .text("language", language.to_string())
        .text("response_format", "verbose_json")
        .text("entropy_thold", "2.8")
        .text("logprob_thold", "-1.25");
    if !prompt.trim().is_empty() {
        form = form.text("prompt", prompt.to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTPクライアント構築失敗: {e}"))?;

    let resp = client
        .post(format!("http://127.0.0.1:{port}/inference"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("whisper-server 通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("whisper-server エラー ({status}): {body}"));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("whisper-server JSON解析失敗: {e}"))
}

pub async fn infer_wav(
    server_bin: &Path,
    model_path: &Path,
    wav_path: &Path,
    language: &str,
    prompt: &str,
    use_gpu: bool,
) -> Result<Value, String> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let wav_bytes = fs::read(wav_path).map_err(|e| format!("WAV読み込み失敗: {e}"))?;

    let (port, active_gpu) =
        ensure_running(server_bin, model_path, language, use_gpu, threads).await?;
    match post_inference(port, wav_bytes.clone(), language, prompt).await {
        Ok(val) => Ok(val),
        Err(err) if active_gpu => {
            // GPU server crashed mid-inference: restart in CPU mode and retry once
            let (cpu_port, _) =
                ensure_running(server_bin, model_path, language, false, threads).await?;
            post_inference(cpu_port, wav_bytes, language, prompt)
                .await
                .map_err(|cpu_err| format!("{err} / CPUリトライ失敗: {cpu_err}"))
        }
        Err(err) => Err(err),
    }
}
