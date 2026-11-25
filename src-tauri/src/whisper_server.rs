use crate::storage;
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
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
    &[
        "whisper-server",
        "whisper-server-darwin-arm64",
        "whisper-server-darwin-x64",
    ]
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
    use_gpu: bool,
}

static WHISPER_SERVER: OnceLock<Mutex<Option<ServerState>>> = OnceLock::new();

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

fn find_server_in_dir(dir: &Path) -> Option<PathBuf> {
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
    match client
        .get(&url)
        .timeout(Duration::from_millis(1200))
        .send()
        .await
    {
        Ok(_) => true,
        Err(_) => false,
    }
}

async fn spawn_and_wait(
    server_bin: &Path,
    model_path: &Path,
    use_gpu: bool,
    threads: usize,
) -> Result<ServerState, String> {
    let port = find_free_port()?;
    let mut cmd = Command::new(server_bin);
    configure_bg_command(&mut cmd);

    if let Some(parent) = server_bin.parent() {
        cmd.current_dir(parent);
        if let Ok(existing_path) = std::env::var("PATH") {
            let sep = if cfg!(windows) { ";" } else { ":" };
            cmd.env("PATH", format!("{}{sep}{existing_path}", parent.display()));
        }
        #[cfg(target_os = "linux")]
        {
            let existing_ld = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
            let next_ld = if existing_ld.is_empty() {
                parent.display().to_string()
            } else {
                format!("{}:{existing_ld}", parent.display())
            };
            cmd.env("LD_LIBRARY_PATH", next_ld);
        }
    }

    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-m")
        .arg(model_path)
        .arg("-t")
        .arg(threads.to_string())
        .arg("--max-len")
        .arg("4096")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

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

    let client = reqwest::Client::new();
    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("whisper-server が起動中に終了しました ({status})"));
        }
        if check_health(&client, port).await {
            return Ok(ServerState {
                child,
                port,
                server_bin: server_bin.to_path_buf(),
                model_path: model_path.to_path_buf(),
                use_gpu,
            });
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("whisper-server の起動がタイムアウトしました".to_string())
}

async fn ensure_running(
    server_bin: &Path,
    model_path: &Path,
    use_gpu: bool,
    threads: usize,
) -> Result<(u16, bool), String> {
    let mut guard = server_mutex().lock().await;
    let client = reqwest::Client::new();

    if let Some(st) = guard.as_mut() {
        let alive = matches!(st.child.try_wait(), Ok(None));
        if alive
            && st.server_bin == server_bin
            && st.model_path == model_path
            && st.use_gpu == use_gpu
            && check_health(&client, st.port).await
        {
            return Ok((st.port, st.use_gpu));
        }
        let _ = st.child.kill();
        let _ = st.child.wait();
        *guard = None;
    }

    match spawn_and_wait(server_bin, model_path, use_gpu, threads).await {
        Ok(st) => {
            let port = st.port;
            let gpu = st.use_gpu;
            *guard = Some(st);
            Ok((port, gpu))
        }
        Err(gpu_err) if use_gpu => {
            // Automatic CPU fallback if GPU server fails to start
            match spawn_and_wait(server_bin, model_path, false, threads).await {
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

pub async fn prewarm(server_bin: &Path, model_path: &Path, use_gpu: bool) {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let _ = ensure_running(server_bin, model_path, use_gpu, threads).await;
}

pub fn stop_server_sync() {
    if let Ok(mut guard) = server_mutex().try_lock() {
        if let Some(mut st) = guard.take() {
            let _ = st.child.kill();
            let _ = st.child.wait();
        }
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

    let (port, active_gpu) = ensure_running(server_bin, model_path, use_gpu, threads).await?;
    match post_inference(port, wav_bytes.clone(), language, prompt).await {
        Ok(val) => Ok(val),
        Err(err) if active_gpu => {
            // GPU server crashed mid-inference: restart in CPU mode and retry once
            let (cpu_port, _) = ensure_running(server_bin, model_path, false, threads).await?;
            post_inference(cpu_port, wav_bytes, language, prompt)
                .await
                .map_err(|cpu_err| format!("{err} / CPUリトライ失敗: {cpu_err}"))
        }
        Err(err) => Err(err),
    }
}
