use crate::models::{AppSettings, AsrModelInfo, AsrProviderKind, DictionaryEntry, TranscriptSegment};
use crate::secrets;
use crate::storage;
use futures_util_stub::*;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;
use uuid::Uuid;

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

mod futures_util_stub {
    // reqwest::Response::chunk() を使うため追加依存不要
}

fn find_file_recursive(dir: &Path, target_name: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file_recursive(&p, target_name) {
                return Some(found);
            }
        } else if p.file_name().and_then(|n| n.to_str()) == Some(target_name) {
            return Some(p);
        }
    }
    None
}

pub fn resolve_whisper_cli(custom_path: &str) -> Option<PathBuf> {
    if !custom_path.trim().is_empty() {
        let p = PathBuf::from(custom_path.trim());
        if p.exists() {
            return Some(p);
        }
    }
    let bin_name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let local_bin_dir = storage::app_data_dir().join("bin");
    if let Some(found) = find_file_recursive(&local_bin_dir, bin_name) {
        return Some(found);
    }
    // PATH 検索
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let cand = dir.join(bin_name);
            if cand.exists() {
                return Some(cand);
            }
        }
    }
    None
}

pub fn resolve_parakeet_cli(custom_path: &str) -> Option<PathBuf> {
    if !custom_path.trim().is_empty() {
        let p = PathBuf::from(custom_path.trim());
        if p.exists() {
            return Some(p);
        }
    }
    let bin_name = if cfg!(windows) {
        "sherpa-onnx-offline.exe"
    } else {
        "sherpa-onnx-offline"
    };
    let local_bin_dir = storage::app_data_dir().join("bin");
    if let Some(found) = find_file_recursive(&local_bin_dir, bin_name) {
        return Some(found);
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let cand = dir.join(bin_name);
            if cand.exists() {
                return Some(cand);
            }
        }
    }
    None
}

pub fn list_models(settings: &AppSettings) -> Vec<AsrModelInfo> {
    let models_dir = storage::models_dir();
    let whisper_cli_ok = resolve_whisper_cli(&settings.whisper_cli_path).is_some();
    let parakeet_cli_ok = resolve_parakeet_cli(&settings.parakeet_cli_path).is_some();

    let parakeet_arch_ok = cfg!(any(target_arch = "x86_64", target_arch = "aarch64"));
    let parakeet_reason = if !parakeet_arch_ok {
        Some("現在のCPUアーキテクチャは Parakeet ONNX ランタイムに未対応です（x86_64 / arm64 が必要）。".to_string())
    } else if !parakeet_cli_ok {
        Some("Parakeet 実行ランタイム（sherpa-onnx-offline）が未設定です。設定画面でランタイムパスを指定してください。".to_string())
    } else {
        None
    };

    let whisper_reason = if !whisper_cli_ok {
        Some("whisper-cli（whisper.cpp）が見つかりません。設定画面でパスを指定するか導入してください。".to_string())
    } else {
        None
    };

    vec![
        AsrModelInfo {
            id: "whisper-tiny-q5".to_string(),
            name: "Whisper Tiny Q5_1 (超軽量・低メモリ)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU (whisper.cpp)".into(),
            memory_mb: 250,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 32,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin".into(),
            filename: "ggml-tiny-q5_1.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-tiny-q5_1.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "whisper-base".to_string(),
            name: "Whisper Base (GGML)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU (whisper.cpp)".into(),
            memory_mb: 500,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 142,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".into(),
            filename: "ggml-base.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-base.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "whisper-small-q5".to_string(),
            name: "Whisper Small Q5_1 (推奨・軽量日本語)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU (whisper.cpp)".into(),
            memory_mb: 850,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 181,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin".into(),
            filename: "ggml-small-q5_1.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-small-q5_1.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "kotoba-whisper-v2-q5".to_string(),
            name: "Kotoba-Whisper v2.0 Q5_0 (日本語特化チューニング)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into()],
            environment: "ローカル CPU / GPU (whisper.cpp)".into(),
            memory_mb: 1500,
            license: "Apache-2.0 (kotoba-tech)".into(),
            size_mb: 538,
            download_url: "https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/main/ggml-kotoba-whisper-v2.0-q5_0.bin".into(),
            filename: "ggml-kotoba-whisper-v2.0-q5_0.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-kotoba-whisper-v2.0-q5_0.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "whisper-large-v3-turbo-q5".to_string(),
            name: "Whisper Large v3 Turbo Q5_0 (高精度)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU / GPU (whisper.cpp)".into(),
            memory_mb: 1800,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 547,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".into(),
            filename: "ggml-large-v3-turbo-q5_0.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason,
            installed: models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "sense-voice-int8-ja".to_string(),
            name: "SenseVoice INT8 (日本語・超高速リアルタイム)".to_string(),
            provider: AsrProviderKind::LocalParakeet,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "中国語".into(), "韓国語".into()],
            environment: "ローカル ONNX Runtime / sherpa-onnx (x86_64 / arm64)".into(),
            memory_mb: 600,
            license: "FunAudioLLM / Apache-2.0 (sherpa-onnx)".into(),
            size_mb: 228,
            download_url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main".into(),
            filename: "sense-voice-zh-en-ja-ko-yue-int8".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: parakeet_arch_ok && parakeet_cli_ok,
            compatibility_reason: parakeet_reason.clone(),
            installed: models_dir.join("sense-voice-zh-en-ja-ko-yue-int8").join("model.int8.onnx").exists()
                && models_dir.join("sense-voice-zh-en-ja-ko-yue-int8").join("tokens.txt").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "parakeet-tdt-ctc-0.6b-ja".to_string(),
            name: "NVIDIA Parakeet TDT/CTC 0.6B 日本語 (INT8 ONNX)".to_string(),
            provider: AsrProviderKind::LocalParakeet,
            is_local: true,
            languages: vec!["日本語（句読点対応）".into()],
            environment: "ローカル ONNX Runtime / sherpa-onnx (x86_64 / arm64)".into(),
            memory_mb: 1600,
            license: "CC-BY-4.0 (NVIDIA) / Apache-2.0 (sherpa-onnx)".into(),
            size_mb: 625,
            download_url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8/resolve/main".into(),
            filename: "parakeet-tdt_ctc-0.6b-ja".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: parakeet_arch_ok && parakeet_cli_ok,
            compatibility_reason: parakeet_reason.clone(),
            installed: models_dir.join("parakeet-tdt_ctc-0.6b-ja").join("model.int8.onnx").exists()
                && models_dir.join("parakeet-tdt_ctc-0.6b-ja").join("tokens.txt").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "qwen3-asr-0.6b".to_string(),
            name: "Qwen3-ASR 0.6B (軽量・多言語リアルタイム)".to_string(),
            provider: AsrProviderKind::LocalQwen,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル (Qwen3-ASR / HuggingFace)".into(),
            memory_mb: 1500,
            license: "Apache-2.0 (Alibaba Qwen)".into(),
            size_mb: 600,
            download_url: "https://huggingface.co/Qwen/Qwen3-ASR-0.6B/resolve/main/config.json".into(),
            filename: "qwen3-asr-0.6b-config.json".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: true,
            compatibility_reason: None,
            installed: models_dir.join("qwen3-asr-0.6b-config.json").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "qwen3-asr-1.7b".to_string(),
            name: "Qwen3-ASR 1.7B (最高精度・52言語/方言対応)".to_string(),
            provider: AsrProviderKind::LocalQwen,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル (Qwen3-ASR / HuggingFace)".into(),
            memory_mb: 3600,
            license: "Apache-2.0 (Alibaba Qwen)".into(),
            size_mb: 1700,
            download_url: "https://huggingface.co/Qwen/Qwen3-ASR-1.7B/resolve/main/config.json".into(),
            filename: "qwen3-asr-1.7b-config.json".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: true,
            compatibility_reason: None,
            installed: models_dir.join("qwen3-asr-1.7b-config.json").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "openai-whisper-1".to_string(),
            name: "OpenAI Whisper API (クラウド・BYOK)".to_string(),
            provider: AsrProviderKind::CloudOpenAi,
            is_local: false,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "クラウド API (api.openai.com)".into(),
            memory_mb: 0,
            license: "商用 API (OpenAI 利用規約)".into(),
            size_mb: 0,
            download_url: String::new(),
            filename: String::new(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: secrets::has_secret("openai_api_key"),
            compatibility_reason: if secrets::has_secret("openai_api_key") {
                None
            } else {
                Some("OpenAI APIキーが未設定です。".into())
            },
            installed: true,
            data_handling: "録音音声ファイルを api.openai.com に送信します。API経由のデータは既定で学習に使用されません（要アカウント設定確認）。".into(),
        },
        AsrModelInfo {
            id: "deepgram-nova-2".to_string(),
            name: "Deepgram Nova-2 (クラウド・話者識別対応)".to_string(),
            provider: AsrProviderKind::CloudDeepgram,
            is_local: false,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "クラウド API (api.deepgram.com)".into(),
            memory_mb: 0,
            license: "商用 API (Deepgram 利用規約)".into(),
            size_mb: 0,
            download_url: String::new(),
            filename: String::new(),
            supports_realtime: true,
            supports_diarization: true,
            is_compatible: secrets::has_secret("deepgram_api_key"),
            compatibility_reason: if secrets::has_secret("deepgram_api_key") {
                None
            } else {
                Some("Deepgram APIキーが未設定です。".into())
            },
            installed: true,
            data_handling: "録音音声ファイルを api.deepgram.com に送信し、自動話者識別付きで文字起こしします。".into(),
        },
        AsrModelInfo {
            id: "groq-whisper-large-v3-turbo".to_string(),
            name: "Groq Whisper Large v3 Turbo (クラウド・高速)".to_string(),
            provider: AsrProviderKind::CloudGroq,
            is_local: false,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "クラウド API (api.groq.com)".into(),
            memory_mb: 0,
            license: "商用 API (Groq 利用規約)".into(),
            size_mb: 0,
            download_url: String::new(),
            filename: String::new(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: secrets::has_secret("groq_api_key"),
            compatibility_reason: if secrets::has_secret("groq_api_key") {
                None
            } else {
                Some("Groq APIキーが未設定です。".into())
            },
            installed: true,
            data_handling: "録音音声ファイルを api.groq.com に送信して高速処理します。".into(),
        },
    ]
}

async fn download_single_file(
    app: &tauri::AppHandle,
    model_id: &str,
    url: &str,
    dest: &Path,
    base_pct: f64,
    span_pct: f64,
    fallback_bytes: u64,
) -> Result<(), String> {
    let tmp = dest.with_extension("part");
    let client = reqwest::Client::new();
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("ダウンロード接続に失敗しました: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ダウンロードエラー: HTTP {} ({url})", resp.status()));
    }

    let total = resp.content_length().unwrap_or(fallback_bytes.max(1));
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&tmp).map_err(|e| format!("一時ファイル作成失敗: {e}"))?;
    use std::io::Write;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("受信中にエラーが発生しました: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("ファイル書き込み失敗: {e}"))?;
        downloaded += chunk.len() as u64;
        let ratio = (downloaded as f64 / total.max(1) as f64).min(1.0);
        let pct = (base_pct + ratio * span_pct).min(100.0) as u8;
        let _ = app.emit(
            "asr-download-progress",
            serde_json::json!({ "model_id": model_id, "progress": pct }),
        );
    }
    drop(file);
    fs::rename(&tmp, dest).map_err(|e| format!("モデルファイルの配置に失敗: {e}"))?;
    Ok(())
}

pub async fn download_whisper_model(
    app: &tauri::AppHandle,
    model_id: &str,
    settings: &AppSettings,
) -> Result<String, String> {
    let models = list_models(settings);
    let model = models
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| "指定されたモデルが見つかりません".to_string())?;

    if !model.is_local {
        return Err("クラウドモデルはダウンロード不要です。APIキーを設定して利用してください。".to_string());
    }

    if model.provider == AsrProviderKind::LocalWhisper || model.provider == AsrProviderKind::LocalQwen {
        let dest = storage::models_dir().join(&model.filename);
        download_single_file(
            app,
            model_id,
            &model.download_url,
            &dest,
            0.0,
            100.0,
            model.size_mb as u64 * 1024 * 1024,
        )
        .await?;
        return Ok(dest.to_string_lossy().to_string());
    }

    // Parakeet ONNX モデルを直接ダウンロード
    let dir = storage::models_dir().join(&model.filename);
    fs::create_dir_all(&dir).map_err(|e| format!("モデルディレクトリ作成失敗: {e}"))?;
    let base_url = model.download_url.trim_end_matches('/');

    if model.id == "parakeet-tdt-ctc-0.6b-ja" || model.id == "sense-voice-int8-ja" {
        download_single_file(
            app,
            model_id,
            &format!("{base_url}/tokens.txt"),
            &dir.join("tokens.txt"),
            0.0,
            5.0,
            1024 * 512,
        )
        .await?;
        download_single_file(
            app,
            model_id,
            &format!("{base_url}/model.int8.onnx"),
            &dir.join("model.int8.onnx"),
            5.0,
            95.0,
            model.size_mb as u64 * 1024 * 1024,
        )
        .await?;
    } else {
        let files = [
            ("tokens.txt", 0.0, 4.0, 512 * 1024),
            ("decoder.int8.onnx", 4.0, 12.0, 20 * 1024 * 1024),
            ("joiner.int8.onnx", 16.0, 10.0, 15 * 1024 * 1024),
            ("encoder.int8.onnx", 26.0, 74.0, 600 * 1024 * 1024),
        ];
        for (fname, b, s, est) in files {
            download_single_file(
                app,
                model_id,
                &format!("{base_url}/{fname}"),
                &dir.join(fname),
                b,
                s,
                est,
            )
            .await?;
        }
    }

    Ok(dir.to_string_lossy().to_string())
}

pub async fn install_runtime_binary(
    app: &tauri::AppHandle,
    kind: &str,
) -> Result<String, String> {
    let bin_root = storage::app_data_dir().join("bin");
    fs::create_dir_all(&bin_root).map_err(|e| format!("binディレクトリ作成失敗: {e}"))?;
    let client = reqwest::Client::builder()
        .user_agent("KoeNote-Desktop/0.1")
        .build()
        .map_err(|e| format!("HTTPクライアント初期化失敗: {e}"))?;

    match kind {
        "whisper" => {
            if !cfg!(windows) {
                return Err("macOS/Linux の whisper-cli は Homebrew (brew install whisper-cpp) などで導入してパスを指定してください。".to_string());
            }
            let dest_dir = bin_root.join("whisper");
            fs::create_dir_all(&dest_dir).map_err(|e| format!("展開先作成失敗: {e}"))?;
            let resp = client
                .get("https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15")
                .send()
                .await
                .map_err(|e| format!("GitHub API 接続失敗: {e}"))?;
            let releases: Vec<Value> = resp.json().await.map_err(|e| format!("JSON解析失敗: {e}"))?;
            let asset_url = releases
                .iter()
                .filter(|r| !r["prerelease"].as_bool().unwrap_or(false))
                .find_map(|r| {
                    r["assets"].as_array()?.iter().find_map(|a| {
                        let name = a["name"].as_str()?;
                        if name == "whisper-bin-x64.zip" {
                            a["browser_download_url"].as_str().map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                })
                .unwrap_or_else(|| {
                    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip".to_string()
                });

            let zip_path = bin_root.join("whisper-bin-x64.zip");
            download_single_file(app, "runtime:whisper", &asset_url, &zip_path, 0.0, 90.0, 15 * 1024 * 1024).await?;

            let mut cmd = Command::new("powershell");
            configure_bg_command(&mut cmd);
            let status = cmd
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                        zip_path.display(),
                        dest_dir.display()
                    ),
                ])
                .status()
                .map_err(|e| format!("ZIP展開に失敗しました: {e}"))?;
            let _ = fs::remove_file(&zip_path);
            if !status.success() {
                return Err("whisper.cpp アーカイブの展開に失敗しました。".to_string());
            }
            let _ = app.emit(
                "asr-download-progress",
                serde_json::json!({ "model_id": "runtime:whisper", "progress": 100 }),
            );
            let exe = find_file_recursive(&dest_dir, "whisper-cli.exe")
                .or_else(|| find_file_recursive(&dest_dir, "main.exe"))
                .ok_or_else(|| "展開後に whisper-cli.exe が見つかりませんでした。".to_string())?;
            Ok(exe.to_string_lossy().to_string())
        }
        "parakeet" => {
            let dest_dir = bin_root.join("parakeet");
            fs::create_dir_all(&dest_dir).map_err(|e| format!("展開先作成失敗: {e}"))?;
            let resp = client
                .get("https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/latest")
                .send()
                .await
                .map_err(|e| format!("GitHub API 接続失敗: {e}"))?;
            let release: Value = resp.json().await.map_err(|e| format!("JSON解析失敗: {e}"))?;
            let target_suffix = if cfg!(windows) {
                "-win-x64-shared-MT-Release-no-tts.tar.bz2"
            } else if cfg!(target_os = "macos") {
                "-osx-universal2-shared-no-tts.tar.bz2"
            } else {
                return Err("このOS向けの sherpa-onnx 自動インストールは未対応です。".to_string());
            };
            let asset_url = release["assets"]
                .as_array()
                .and_then(|arr| {
                    arr.iter().find_map(|a| {
                        let name = a["name"].as_str()?;
                        if name.ends_with(target_suffix) {
                            a["browser_download_url"].as_str().map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                })
                .ok_or_else(|| "sherpa-onnx の配布アーカイブが見つかりませんでした。".to_string())?;

            let archive_path = bin_root.join("sherpa-onnx.tar.bz2");
            download_single_file(app, "runtime:parakeet", &asset_url, &archive_path, 0.0, 90.0, 45 * 1024 * 1024).await?;

            let mut cmd = Command::new("tar");
            configure_bg_command(&mut cmd);
            let status = cmd
                .arg("-xjf")
                .arg(&archive_path)
                .arg("-C")
                .arg(&dest_dir)
                .status()
                .map_err(|e| format!("tar.bz2 の展開に失敗しました: {e}"))?;
            let _ = fs::remove_file(&archive_path);
            if !status.success() {
                return Err("sherpa-onnx アーカイブの展開に失敗しました。".to_string());
            }
            let _ = app.emit(
                "asr-download-progress",
                serde_json::json!({ "model_id": "runtime:parakeet", "progress": 100 }),
            );
            let bin_name = if cfg!(windows) {
                "sherpa-onnx-offline.exe"
            } else {
                "sherpa-onnx-offline"
            };
            let exe = find_file_recursive(&dest_dir, bin_name)
                .ok_or_else(|| format!("展開後に {bin_name} が見つかりませんでした。"))?;
            Ok(exe.to_string_lossy().to_string())
        }
        other => Err(format!("未知のランタイム種別です: {other}")),
    }
}

fn ensure_local_wav(input_path: &Path) -> Result<(PathBuf, bool), String> {
    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "wav" {
        return Ok((input_path.to_path_buf(), false));
    }
    let converted = input_path.with_extension("converted_16k.wav");
    let mut cmd = Command::new("ffmpeg");
    configure_bg_command(&mut cmd);
    let status = cmd
        .args([
            "-y",
            "-i",
            &input_path.to_string_lossy(),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            &converted.to_string_lossy(),
        ])
        .status();
    match status {
        Ok(st) if st.success() && converted.exists() => Ok((converted, true)),
        _ => Err(format!(
            "ローカルASRモデルは 16kHz WAV 形式が必要です（.{ext} を変換するための ffmpeg が見つかりませんでした）。WAV に変換してアップロードするか、クラウドASRをご利用ください。"
        )),
    }
}

pub async fn transcribe_wav(
    wav_path: &Path,
    settings: &AppSettings,
    dictionary: &[DictionaryEntry],
) -> Result<(Vec<TranscriptSegment>, bool, String), String> {
    if !wav_path.exists() {
        return Err("録音された音声ファイルが見つかりません。".to_string());
    }
    let models = list_models(settings);
    let model = models
        .into_iter()
        .find(|m| m.id == settings.active_asr_model_id)
        .ok_or_else(|| "選択中のASRモデルが見つかりません。設定画面でモデルを選択してください。".to_string())?;

    // クラウド自動フォールバック禁止ガード
    if !model.is_local && !settings.allow_cloud_asr {
        return Err(
            "クラウドASRへの送信が許可されていません（設定で明示的に許可した上でクラウドモデルを選択してください）。"
                .to_string(),
        );
    }

    let prompt_terms: Vec<String> = dictionary.iter().map(|d| d.term.clone()).collect();
    let prompt_hint = prompt_terms.join("、");

    match model.provider {
        AsrProviderKind::LocalWhisper => {
            let (local_wav, should_cleanup) = ensure_local_wav(wav_path)?;
            let cli = resolve_whisper_cli(&settings.whisper_cli_path).ok_or_else(|| {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                "ローカルWhisperランタイム（whisper-cli）が見つかりません。設定＞ASRモデルから導入してください。クラウドへの自動切替は行いません。"
                    .to_string()
            })?;
            let model_path = storage::models_dir().join(&model.filename);
            if !model_path.exists() {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                return Err(format!(
                    "モデルファイル（{}）が未取得です。設定＞ASRモデルからダウンロードしてください。",
                    model.filename
                ));
            }
            let out_base = local_wav.with_extension("whisper_out");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            cmd.arg("-m")
                .arg(&model_path)
                .arg("-f")
                .arg(&local_wav)
                .arg("-oj")
                .arg("-of")
                .arg(&out_base)
                .arg("-l")
                .arg(if settings.language.is_empty() {
                    "auto"
                } else {
                    &settings.language
                });
            if !prompt_hint.is_empty() {
                cmd.arg("--prompt").arg(&prompt_hint);
            }
            let output = cmd
                .output()
                .map_err(|e| format!("whisper-cli の実行に失敗しました: {e}"))?;
            if should_cleanup {
                let _ = fs::remove_file(&local_wav);
            }
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Whisper 文字起こしエラー: {stderr}"));
            }
            let json_path = PathBuf::from(format!("{}.json", out_base.to_string_lossy()));
            let raw = fs::read_to_string(&json_path)
                .map_err(|e| format!("文字起こし結果JSONの読み込みに失敗しました: {e}"))?;
            let _ = fs::remove_file(&json_path);
            let parsed: Value =
                serde_json::from_str(&raw).map_err(|e| format!("JSON解析に失敗: {e}"))?;
            let mut segs = Vec::new();
            if let Some(arr) = parsed.get("transcription").and_then(|v| v.as_array()) {
                for item in arr {
                    let text = item
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if text.is_empty() {
                        continue;
                    }
                    let start_ms = item
                        .get("offsets")
                        .and_then(|o| o.get("from"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let end_ms = item
                        .get("offsets")
                        .and_then(|o| o.get("to"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(start_ms + 1000);
                    segs.push(TranscriptSegment {
                        id: Uuid::new_v4().to_string(),
                        start_ms,
                        end_ms,
                        speaker: "話者1".to_string(),
                        text,
                    });
                }
            }
            Ok((segs, false, model.name))
        }
        AsrProviderKind::LocalParakeet | AsrProviderKind::LocalQwen => {
            let (local_wav, should_cleanup) = ensure_local_wav(wav_path)?;
            let cli = resolve_parakeet_cli(&settings.parakeet_cli_path).ok_or_else(|| {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                "Parakeet ランタイム（sherpa-onnx-offline）が未設定です。設定＞ASRモデルから導入してください。"
                    .to_string()
            })?;
            let model_dir = storage::models_dir().join(&model.filename);
            if !model_dir.exists() {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                return Err(format!(
                    "Parakeet モデルフォルダ（{}）が見つかりません。設定＞ASRモデルからモデルを取得してください。",
                    model_dir.display()
                ));
            }
            let ctc_model = model_dir.join("model.int8.onnx");
            let tokens = model_dir.join("tokens.txt");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            configure_bg_command(&mut cmd);
            if model.id == "sense-voice-int8-ja" {
                cmd.arg(format!("--sense-voice-model={}", ctc_model.display()))
                    .arg("--sense-voice-use-itn=1")
                    .arg(format!("--tokens={}", tokens.display()))
                    .arg(&local_wav);
            } else if ctc_model.exists() {
                cmd.arg(format!("--nemo-ctc-model={}", ctc_model.display()))
                    .arg(format!("--tokens={}", tokens.display()))
                    .arg(&local_wav);
            } else {
                let encoder = model_dir.join("encoder.int8.onnx");
                let decoder = model_dir.join("decoder.int8.onnx");
                let joiner = model_dir.join("joiner.int8.onnx");
                cmd.arg(format!("--encoder={}", encoder.display()))
                    .arg(format!("--decoder={}", decoder.display()))
                    .arg(format!("--joiner={}", joiner.display()))
                    .arg(format!("--tokens={}", tokens.display()))
                    .arg("--model-type=nemo_transducer")
                    .arg(&local_wav);
            }
            let output = cmd
                .output()
                .map_err(|e| format!("Parakeet ランタイム実行失敗: {e}"))?;
            if should_cleanup {
                let _ = fs::remove_file(&local_wav);
            }
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Parakeet 文字起こしエラー: {stderr}"));
            }
            let raw_out = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stdout = strip_sense_voice_tags(&raw_out);
            let seg = TranscriptSegment {
                id: Uuid::new_v4().to_string(),
                start_ms: 0,
                end_ms: 1000,
                speaker: "話者1".to_string(),
                text: if stdout.is_empty() {
                    "（発話が検出されませんでした）".to_string()
                } else {
                    stdout
                },
            };
            Ok((vec![seg], false, model.name))
        }
        AsrProviderKind::CloudOpenAi | AsrProviderKind::CloudGroq => {
            let is_groq = model.provider == AsrProviderKind::CloudGroq;
            let secret_key = if is_groq { "groq_api_key" } else { "openai_api_key" };
            let api_key = secrets::get_secret(secret_key)?
                .ok_or_else(|| "APIキーが設定されていません。設定画面から登録してください。".to_string())?;
            let url = if is_groq {
                "https://api.groq.com/openai/v1/audio/transcriptions"
            } else {
                "https://api.openai.com/v1/audio/transcriptions"
            };
            let api_model = if is_groq {
                "whisper-large-v3-turbo"
            } else {
                "whisper-1"
            };
            let bytes = fs::read(wav_path).map_err(|e| format!("音声読み込み失敗: {e}"))?;
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name("recording.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("リクエスト構築失敗: {e}"))?;
            let mut form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("model", api_model.to_string())
                .text("response_format", "verbose_json".to_string());
            if settings.language != "auto" && !settings.language.is_empty() {
                form = form.text("language", settings.language.clone());
            }
            if !prompt_hint.is_empty() {
                form = form.text("prompt", prompt_hint);
            }
            let client = reqwest::Client::new();
            let resp = client
                .post(url)
                .bearer_auth(api_key)
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("クラウドASR通信エラー: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("クラウドASR API エラー ({status}): {body}"));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("クラウドASR応答の解析失敗: {e}"))?;
            let mut segs = Vec::new();
            if let Some(arr) = json.get("segments").and_then(|v| v.as_array()) {
                for item in arr {
                    let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    let start_ms = (item.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1000.0) as u64;
                    let end_ms = (item.get("end").and_then(|v| v.as_f64()).unwrap_or(1.0) * 1000.0) as u64;
                    segs.push(TranscriptSegment {
                        id: Uuid::new_v4().to_string(),
                        start_ms,
                        end_ms,
                        speaker: "話者1".to_string(),
                        text,
                    });
                }
            } else if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
                segs.push(TranscriptSegment {
                    id: Uuid::new_v4().to_string(),
                    start_ms: 0,
                    end_ms: 1000,
                    speaker: "話者1".to_string(),
                    text: text.trim().to_string(),
                });
            }
            Ok((segs, false, model.name))
        }
        AsrProviderKind::CloudDeepgram => {
            let api_key = secrets::get_secret("deepgram_api_key")?
                .ok_or_else(|| "Deepgram APIキーが未設定です。".to_string())?;
            let bytes = fs::read(wav_path).map_err(|e| format!("音声読み込み失敗: {e}"))?;
            let lang_param = if settings.language == "auto" || settings.language.is_empty() {
                "detect_language=true".to_string()
            } else {
                format!("language={}", settings.language)
            };
            let url = format!(
                "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&utterances=true&{lang_param}"
            );
            let client = reqwest::Client::new();
            let resp = client
                .post(url)
                .header("Authorization", format!("Token {api_key}"))
                .header("Content-Type", "audio/wav")
                .body(bytes)
                .send()
                .await
                .map_err(|e| format!("Deepgram 通信エラー: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("Deepgram API エラー ({status}): {body}"));
            }
            let json: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
            let mut segs = Vec::new();
            if let Some(utts) = json
                .get("results")
                .and_then(|r| r.get("utterances"))
                .and_then(|u| u.as_array())
            {
                for u in utts {
                    let text = u.get("transcript").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    let speaker_num = u.get("speaker").and_then(|v| v.as_u64()).unwrap_or(0);
                    let start_ms = (u.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1000.0) as u64;
                    let end_ms = (u.get("end").and_then(|v| v.as_f64()).unwrap_or(1.0) * 1000.0) as u64;
                    segs.push(TranscriptSegment {
                        id: Uuid::new_v4().to_string(),
                        start_ms,
                        end_ms,
                        speaker: format!("話者{}", speaker_num + 1),
                        text,
                    });
                }
            }
            Ok((segs, true, model.name))
        }
    }
}

fn strip_sense_voice_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '<' && chars[i + 1] == '|' {
            in_tag = true;
            i += 2;
            continue;
        }
        if in_tag && i + 1 < chars.len() && chars[i] == '|' && chars[i + 1] == '>' {
            in_tag = false;
            i += 2;
            continue;
        }
        if !in_tag {
            out.push(chars[i]);
        }
        i += 1;
    }
    out.trim().to_string()
}

pub fn transcribe_chunk_sync(
    chunk_wav: &Path,
    settings: &AppSettings,
    dictionary: &[DictionaryEntry],
) -> Result<String, String> {
    let models = list_models(settings);
    let model = models
        .into_iter()
        .find(|m| m.id == settings.active_asr_model_id)
        .ok_or_else(|| "ASRモデルが見つかりません".to_string())?;
    if !model.is_local || !model.supports_realtime {
        return Ok(String::new());
    }

    let prompt_terms: Vec<String> = dictionary.iter().map(|d| d.term.clone()).collect();
    let prompt_hint = prompt_terms.join("、");

    match model.provider {
        AsrProviderKind::LocalWhisper => {
            let cli = resolve_whisper_cli(&settings.whisper_cli_path)
                .ok_or_else(|| "whisper-cli 未設定".to_string())?;
            let model_path = storage::models_dir().join(&model.filename);
            if !model_path.exists() {
                return Ok(String::new());
            }
            let out_base = chunk_wav.with_extension("chunk_out");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            cmd.arg("-m")
                .arg(&model_path)
                .arg("-f")
                .arg(chunk_wav)
                .arg("-nt")
                .arg("-np")
                .arg("-l")
                .arg(if settings.language.is_empty() {
                    "auto"
                } else {
                    &settings.language
                })
                .arg("-of")
                .arg(&out_base)
                .arg("-otxt");
            if !prompt_hint.is_empty() {
                cmd.arg("--prompt").arg(&prompt_hint);
            }
            let output = cmd
                .output()
                .map_err(|e| format!("チャンク文字起こし失敗: {e}"))?;
            let txt_path = PathBuf::from(format!("{}.txt", out_base.to_string_lossy()));
            let text = if txt_path.exists() {
                let s = fs::read_to_string(&txt_path).unwrap_or_default();
                let _ = fs::remove_file(&txt_path);
                s
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            Ok(text.trim().to_string())
        }
        AsrProviderKind::LocalParakeet | AsrProviderKind::LocalQwen => {
            let cli = resolve_parakeet_cli(&settings.parakeet_cli_path)
                .ok_or_else(|| "sherpa-onnx-offline 未設定".to_string())?;
            let model_dir = storage::models_dir().join(&model.filename);
            if !model_dir.exists() {
                return Ok(String::new());
            }
            let ctc_model = model_dir.join("model.int8.onnx");
            let tokens = model_dir.join("tokens.txt");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            configure_bg_command(&mut cmd);
            if model.id == "sense-voice-int8-ja" {
                cmd.arg(format!("--sense-voice-model={}", ctc_model.display()))
                    .arg("--sense-voice-use-itn=1")
                    .arg(format!("--tokens={}", tokens.display()))
                    .arg(chunk_wav);
            } else if ctc_model.exists() {
                cmd.arg(format!("--nemo-ctc-model={}", ctc_model.display()))
                    .arg(format!("--tokens={}", tokens.display()))
                    .arg(chunk_wav);
            } else {
                return Ok(String::new());
            }
            let output = cmd
                .output()
                .map_err(|e| format!("チャンク推論失敗: {e}"))?;
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(strip_sense_voice_tags(&raw))
        }
        _ => Ok(String::new()),
    }
}
