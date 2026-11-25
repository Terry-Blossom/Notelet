use crate::models::{AppSettings, AsrModelInfo, AsrProviderKind, DictionaryEntry, TranscriptSegment};
use crate::secrets;
use crate::storage;
use base64::Engine;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::Emitter;
use uuid::Uuid;

static STEPFUN_USE_CN_ENDPOINT: AtomicBool = AtomicBool::new(false);

fn cloud_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
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
    let whisper_cli_ok = crate::whisper_server::resolve_whisper_server(&settings.whisper_cli_path).is_some()
        || resolve_whisper_cli(&settings.whisper_cli_path).is_some();
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
            name: "Whisper Large v3 Turbo Q5_0 (高精度・バランス)".to_string(),
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
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "kotoba-whisper-v2".to_string(),
            name: "Kotoba-Whisper v2.0 (FP16・日本語特化上位)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into()],
            environment: "ローカル CPU / GPU (whisper.cpp)".into(),
            memory_mb: 2800,
            license: "Apache-2.0 (kotoba-tech)".into(),
            size_mb: 1449,
            download_url: "https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/main/ggml-kotoba-whisper-v2.0.bin".into(),
            filename: "ggml-kotoba-whisper-v2.0.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-kotoba-whisper-v2.0.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "whisper-large-v3-turbo".to_string(),
            name: "Whisper Large v3 Turbo (FP16・高精度)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU / GPU (whisper.cpp)".into(),
            memory_mb: 3000,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 1549,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin".into(),
            filename: "ggml-large-v3-turbo.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-large-v3-turbo.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "whisper-large-v3-q5".to_string(),
            name: "Whisper Large v3 Q5_0 (フルモデル・高精度)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU / GPU (whisper.cpp)".into(),
            memory_mb: 2400,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 1031,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin".into(),
            filename: "ggml-large-v3-q5_0.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-large-v3-q5_0.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "whisper-large-v3".to_string(),
            name: "Whisper Large v3 (FP16・最高精度)".to_string(),
            provider: AsrProviderKind::LocalWhisper,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル CPU / GPU (whisper.cpp)".into(),
            memory_mb: 4800,
            license: "MIT (OpenAI Whisper / whisper.cpp)".into(),
            size_mb: 2952,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".into(),
            filename: "ggml-large-v3.bin".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason,
            installed: models_dir.join("ggml-large-v3.bin").exists(),
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
            environment: "ローカル ONNX Runtime / sherpa-onnx (x86_64 / arm64)".into(),
            memory_mb: 1500,
            license: "Apache-2.0 (Alibaba Qwen / sherpa-onnx)".into(),
            size_mb: 850,
            download_url: "https://huggingface.co/csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/resolve/main".into(),
            filename: "sherpa-onnx-qwen3-asr-0.6B-int8".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: parakeet_arch_ok && parakeet_cli_ok,
            compatibility_reason: parakeet_reason.clone(),
            installed: models_dir.join("sherpa-onnx-qwen3-asr-0.6B-int8").join("conv_frontend.onnx").exists()
                && models_dir.join("sherpa-onnx-qwen3-asr-0.6B-int8").join("encoder.int8.onnx").exists()
                && models_dir.join("sherpa-onnx-qwen3-asr-0.6B-int8").join("decoder.int8.onnx").exists()
                && models_dir.join("sherpa-onnx-qwen3-asr-0.6B-int8").join("tokenizer").join("vocab.json").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "qwen3-asr-1.7b".to_string(),
            name: "Qwen3-ASR 1.7B (最高精度・52言語/方言対応)".to_string(),
            provider: AsrProviderKind::LocalQwen,
            is_local: true,
            languages: vec!["日本語".into(), "英語".into(), "多言語(自動判定)".into()],
            environment: "ローカル ONNX Runtime / sherpa-onnx (x86_64 / arm64)".into(),
            memory_mb: 3600,
            license: "Apache-2.0 (Alibaba Qwen / sherpa-onnx)".into(),
            size_mb: 1900,
            download_url: "https://huggingface.co/thieunv-asilla/sherpa-onnx-qwen3-asr-1.7B-int8/resolve/main".into(),
            filename: "sherpa-onnx-qwen3-asr-1.7B-int8".into(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: parakeet_arch_ok && parakeet_cli_ok,
            compatibility_reason: parakeet_reason,
            installed: models_dir.join("sherpa-onnx-qwen3-asr-1.7B-int8").join("conv_frontend.onnx").exists()
                && models_dir.join("sherpa-onnx-qwen3-asr-1.7B-int8").join("encoder.int8.onnx").exists()
                && models_dir.join("sherpa-onnx-qwen3-asr-1.7B-int8").join("decoder.int8.onnx").exists()
                && models_dir.join("sherpa-onnx-qwen3-asr-1.7B-int8").join("tokenizer").join("vocab.json").exists(),
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
            is_compatible: secrets::has_secret("openai_api_key")
                || secrets::has_secret("llm_openai_api_key"),
            compatibility_reason: if secrets::has_secret("openai_api_key")
                || secrets::has_secret("llm_openai_api_key")
            {
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
        AsrModelInfo {
            id: "stepfun-stepaudio-2.5-asr".to_string(),
            name: "StepFun StepAudio 2.5 ASR (クラウド・超高速)".to_string(),
            provider: AsrProviderKind::CloudStepFun,
            is_local: false,
            languages: vec![
                "日本語".into(),
                "英語".into(),
                "中国語".into(),
                "韓国語".into(),
                "多言語(自動判定)".into(),
            ],
            environment: "クラウド API (api.stepfun.ai / api.stepfun.com)".into(),
            memory_mb: 0,
            license: "商用 API (StepFun 利用規約)".into(),
            size_mb: 0,
            download_url: String::new(),
            filename: String::new(),
            supports_realtime: true,
            supports_diarization: false,
            is_compatible: secrets::has_secret("stepfun_api_key"),
            compatibility_reason: if secrets::has_secret("stepfun_api_key") {
                None
            } else {
                Some("StepFun APIキーが未設定です。".into())
            },
            installed: true,
            data_handling: "録音音声ファイルを StepFun API に送信して超高速・高精度に文字起こしします。".into(),
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

    if model.provider == AsrProviderKind::LocalWhisper {
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

    if model.provider == AsrProviderKind::LocalQwen {
        let dir = storage::models_dir().join(&model.filename);
        let tok_dir = dir.join("tokenizer");
        fs::create_dir_all(&tok_dir).map_err(|e| format!("モデルディレクトリ作成失敗: {e}"))?;
        let base_url = model.download_url.trim_end_matches('/');
        let qwen_files = [
            ("tokenizer/vocab.json", tok_dir.join("vocab.json"), 0.0, 2.0, 2 * 1024 * 1024),
            ("tokenizer/merges.txt", tok_dir.join("merges.txt"), 2.0, 2.0, 2 * 1024 * 1024),
            ("tokenizer/tokenizer_config.json", tok_dir.join("tokenizer_config.json"), 4.0, 1.0, 64 * 1024),
            ("conv_frontend.onnx", dir.join("conv_frontend.onnx"), 5.0, 10.0, 100 * 1024 * 1024),
            ("encoder.int8.onnx", dir.join("encoder.int8.onnx"), 15.0, 45.0, (model.size_mb as u64 * 1024 * 1024) / 2),
            ("decoder.int8.onnx", dir.join("decoder.int8.onnx"), 60.0, 40.0, (model.size_mb as u64 * 1024 * 1024) / 2),
        ];
        for (remote, local, b, s, est) in qwen_files {
            download_single_file(app, model_id, &format!("{base_url}/{remote}"), &local, b, s, est).await?;
        }
        return Ok(dir.to_string_lossy().to_string());
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

pub fn detect_gpu_capabilities() -> crate::models::GpuCapabilities {
    if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        return crate::models::GpuCapabilities {
            has_cuda: false,
            has_metal: true,
            gpu_name: "Apple Silicon (Metal)".to_string(),
            recommended_backend: "metal".to_string(),
        };
    }

    let mut smi_cmd = Command::new("nvidia-smi");
    configure_bg_command(&mut smi_cmd);
    if let Ok(out) = smi_cmd
        .args(["--query-gpu=name", "--format=csv,noheader"])
        .output()
    {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                return crate::models::GpuCapabilities {
                    has_cuda: true,
                    has_metal: false,
                    gpu_name: name,
                    recommended_backend: "cuda".to_string(),
                };
            }
        }
    }

    #[cfg(target_os = "windows")]
    if Path::new(r"C:\Windows\System32\nvcuda.dll").exists() {
        return crate::models::GpuCapabilities {
            has_cuda: true,
            has_metal: false,
            gpu_name: "NVIDIA GPU (CUDA)".to_string(),
            recommended_backend: "cuda".to_string(),
        };
    }

    crate::models::GpuCapabilities {
        has_cuda: false,
        has_metal: false,
        gpu_name: "CPU (OpenBLAS)".to_string(),
        recommended_backend: "cpu".to_string(),
    }
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
            crate::whisper_server::stop_server_async().await;
            let dest_dir = bin_root.join("whisper");
            if dest_dir.exists() {
                let _ = fs::remove_dir_all(&dest_dir);
            }
            fs::create_dir_all(&dest_dir).map_err(|e| format!("展開先作成失敗: {e}"))?;
            let gpu = detect_gpu_capabilities();

            let asset_name = if cfg!(target_os = "macos") {
                if cfg!(target_arch = "aarch64") {
                    "whisper-server-darwin-arm64.zip"
                } else {
                    "whisper-server-darwin-x64.zip"
                }
            } else if cfg!(windows) {
                if gpu.has_cuda {
                    "whisper-server-win32-x64-cuda.zip"
                } else if Path::new(r"C:\Windows\System32\vulkan-1.dll").exists() {
                    "whisper-server-win32-x64-vulkan.zip"
                } else {
                    "whisper-server-win32-x64-cpu.zip"
                }
            } else if gpu.has_cuda {
                "whisper-server-linux-x64-cuda.zip"
            } else if Path::new("/usr/lib/libvulkan.so.1").exists()
                || Path::new("/usr/lib/x86_64-linux-gnu/libvulkan.so.1").exists()
            {
                "whisper-server-linux-x64-vulkan.zip"
            } else {
                "whisper-server-linux-x64-cpu.zip"
            };

            let asset_url = format!(
                "https://github.com/OpenWhispr/whisper.cpp/releases/download/0.0.11/{asset_name}"
            );
            let zip_path = bin_root.join(asset_name);
            download_single_file(app, "runtime:whisper", &asset_url, &zip_path, 0.0, 90.0, 20 * 1024 * 1024).await?;

            if cfg!(windows) {
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
                    return Err("whisper-server アーカイブの展開に失敗しました。".to_string());
                }
            } else {
                let mut cmd = Command::new("unzip");
                configure_bg_command(&mut cmd);
                let status = cmd
                    .args(["-o", "-q"])
                    .arg(&zip_path)
                    .arg("-d")
                    .arg(&dest_dir)
                    .status()
                    .map_err(|e| format!("ZIP展開に失敗しました: {e}"))?;
                let _ = fs::remove_file(&zip_path);
                if !status.success() {
                    return Err("whisper-server アーカイブの展開に失敗しました。".to_string());
                }
            }

            let _ = app.emit(
                "asr-download-progress",
                serde_json::json!({ "model_id": "runtime:whisper", "progress": 100 }),
            );
            let exe = crate::whisper_server::resolve_whisper_server("")
                .or_else(|| find_file_recursive(&dest_dir, "whisper-cli.exe"))
                .or_else(|| find_file_recursive(&dest_dir, "whisper-cli"))
                .ok_or_else(|| "展開後に whisper-server 実行ファイルが見つかりませんでした。".to_string())?;
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

async fn resolve_or_install_ffmpeg() -> Result<PathBuf, String> {
    let bin_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let bin_dir = storage::app_data_dir().join("bin");
    let _ = fs::create_dir_all(&bin_dir);
    if let Some(found) = find_file_recursive(&bin_dir, bin_name) {
        return Ok(found);
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let cand = dir.join(bin_name);
            if cand.exists() {
                return Ok(cand);
            }
        }
    }

    // Auto-download portable ffmpeg binary into app_data_dir/bin
    let url = if cfg!(windows) {
        "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip"
    } else if cfg!(target_os = "macos") {
        "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-macos-64.zip"
    } else {
        "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip"
    };

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("ffmpeg の自動取得に失敗しました: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ffmpeg の自動取得に失敗しました ({})", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("ffmpeg データの読み込みに失敗しました: {e}"))?;
    let zip_path = bin_dir.join("ffmpeg.zip");
    fs::write(&zip_path, &bytes).map_err(|e| format!("ffmpeg.zip の保存に失敗しました: {e}"))?;

    let ffmpeg_dest_dir = bin_dir.join("ffmpeg");
    let _ = fs::create_dir_all(&ffmpeg_dest_dir);

    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        configure_bg_command(&mut cmd);
        let st = cmd
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                    zip_path.display(),
                    ffmpeg_dest_dir.display()
                ),
            ])
            .status()
            .map_err(|e| format!("ffmpeg の展開に失敗しました: {e}"))?;
        let _ = fs::remove_file(&zip_path);
        if !st.success() {
            return Err("ffmpeg の展開に失敗しました。".to_string());
        }
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("unzip");
        let st = cmd
            .args([
                "-o",
                &zip_path.to_string_lossy(),
                "-d",
                &ffmpeg_dest_dir.to_string_lossy(),
            ])
            .status()
            .map_err(|e| format!("ffmpeg の展開に失敗しました: {e}"))?;
        let _ = fs::remove_file(&zip_path);
        if !st.success() {
            return Err("ffmpeg の展開に失敗しました。".to_string());
        }
    }

    find_file_recursive(&ffmpeg_dest_dir, bin_name)
        .ok_or_else(|| "展開後に ffmpeg が見つかりませんでした。".to_string())
}

async fn ensure_local_wav(input_path: &Path) -> Result<(PathBuf, bool), String> {
    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "wav" {
        return Ok((input_path.to_path_buf(), false));
    }
    let ffmpeg_bin = resolve_or_install_ffmpeg().await?;
    let converted = input_path.with_extension("converted_16k.wav");
    let mut cmd = Command::new(ffmpeg_bin);
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
            "音声ファイル（.{ext}）の 16kHz WAV 変換に失敗しました。"
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
            let (local_wav, should_cleanup) = ensure_local_wav(wav_path).await?;
            let model_path = storage::models_dir().join(&model.filename);
            if !model_path.exists() {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                return Err(format!(
                    "モデルファイル（{}）が未取得です。設定＞音声認識からダウンロードしてください。",
                    model.filename
                ));
            }
            let whisper_lang = if model.id.starts_with("kotoba-whisper") {
                "ja"
            } else if settings.language.is_empty() {
                "ja"
            } else {
                &settings.language
            };
            let effective_prompt = if !prompt_hint.is_empty() {
                if whisper_lang == "ja" {
                    format!("以下は日本語の会話です。用語: {prompt_hint}")
                } else {
                    prompt_hint.clone()
                }
            } else if whisper_lang == "ja" {
                "こんにちは。本日の会議を始めます。".to_string()
            } else {
                String::new()
            };

            if let Some(server_bin) = crate::whisper_server::resolve_whisper_server(&settings.whisper_cli_path) {
                let res = crate::whisper_server::infer_wav(
                    &server_bin,
                    &model_path,
                    &local_wav,
                    whisper_lang,
                    &effective_prompt,
                    settings.enable_gpu_asr,
                )
                .await;
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                let parsed = res?;
                let mut segs = Vec::new();
                if let Some(arr) = parsed.get("segments").and_then(|v| v.as_array()) {
                    for item in arr {
                        let no_speech = item
                            .get("no_speech_prob")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        if no_speech > 0.75 {
                            continue;
                        }
                        let text = item
                            .get("text")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if text.is_empty() || is_silence_hallucination(&text) {
                            continue;
                        }
                        let start_ms = item
                            .get("start")
                            .and_then(|v| v.as_f64())
                            .map(|s| (s.max(0.0) * 1000.0) as u64)
                            .unwrap_or(0);
                        let end_ms = item
                            .get("end")
                            .and_then(|v| v.as_f64())
                            .map(|s| (s.max(0.0) * 1000.0) as u64)
                            .unwrap_or(start_ms + 1000);
                        segs.push(TranscriptSegment {
                            id: Uuid::new_v4().to_string(),
                            start_ms,
                            end_ms,
                            speaker: String::new(),
                            text,
                        });
                    }
                }
                if segs.is_empty() {
                    if let Some(full_text) = parsed.get("text").and_then(|v| v.as_str()) {
                        let trimmed = full_text.trim().to_string();
                        if !trimmed.is_empty() && !is_silence_hallucination(&trimmed) {
                            segs.push(TranscriptSegment {
                                id: Uuid::new_v4().to_string(),
                                start_ms: 0,
                                end_ms: 1000,
                                speaker: String::new(),
                                text: trimmed,
                            });
                        }
                    }
                }
                return Ok((segs, false, model.name));
            }

            let cli = resolve_whisper_cli(&settings.whisper_cli_path).ok_or_else(|| {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                "ローカルWhisperランタイム（whisper-server / whisper-cli）が見つかりません。設定＞音声認識から導入してください。クラウドへの自動切替は行いません。"
                    .to_string()
            })?;
            let out_base = local_wav.with_extension("whisper_out");
            let threads = std::thread::available_parallelism()
                .map(|n| n.get().clamp(2, 8))
                .unwrap_or(4);
            let build_whisper_cmd = |no_gpu: bool| {
                let mut c = Command::new(&cli);
                configure_bg_command(&mut c);
                c.arg("-m")
                    .arg(&model_path)
                    .arg("-f")
                    .arg(&local_wav)
                    .arg("-oj")
                    .arg("-of")
                    .arg(&out_base)
                    .arg("-t")
                    .arg(threads.to_string())
                    .arg("--beam-size")
                    .arg("5")
                    .arg("--best-of")
                    .arg("5")
                    .arg("--entropy-thold")
                    .arg("2.8")
                    .arg("--logprob-thold")
                    .arg("-1.25")
                    .arg("-l")
                    .arg(whisper_lang);
                if no_gpu {
                    c.arg("-ng");
                }
                if !effective_prompt.is_empty() {
                    c.arg("--prompt").arg(&effective_prompt);
                }
                c
            };
            let mut output = build_whisper_cmd(!settings.enable_gpu_asr)
                .output()
                .map_err(|e| format!("whisper-cli の実行に失敗しました: {e}"))?;
            if !output.status.success() && settings.enable_gpu_asr {
                output = build_whisper_cmd(true)
                    .output()
                    .map_err(|e| format!("whisper-cli の実行に失敗しました: {e}"))?;
            }
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
                        speaker: String::new(),
                        text,
                    });
                }
            }
            Ok((segs, false, model.name))
        }
        AsrProviderKind::LocalParakeet => {
            let (local_wav, should_cleanup) = ensure_local_wav(wav_path).await?;
            let cli = resolve_parakeet_cli(&settings.parakeet_cli_path).ok_or_else(|| {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                "Parakeet ランタイム（sherpa-onnx-offline）が未設定です。設定＞音声認識から導入してください。"
                    .to_string()
            })?;
            let model_dir = storage::models_dir().join(&model.filename);
            if !model_dir.exists() {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                return Err(format!(
                    "Parakeet モデルフォルダ（{}）が見つかりません。設定＞音声認識からモデルを取得してください。",
                    model_dir.display()
                ));
            }
            let ctc_model = model_dir.join("model.int8.onnx");
            let tokens = model_dir.join("tokens.txt");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            if model.id == "sense-voice-int8-ja" {
                let sv_lang = match settings.language.as_str() {
                    "en" => "en",
                    "auto" => "auto",
                    _ => "ja",
                };
                cmd.arg(format!("--sense-voice-model={}", ctc_model.display()))
                    .arg("--sense-voice-use-itn=1")
                    .arg(format!("--sense-voice-language={sv_lang}"))
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
            let raw_out = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let stdout = strip_sense_voice_tags(&raw_out);
            let seg = TranscriptSegment {
                id: Uuid::new_v4().to_string(),
                start_ms: 0,
                end_ms: 1000,
                speaker: String::new(),
                text: if stdout.is_empty() {
                    "（発話が検出されませんでした）".to_string()
                } else {
                    stdout
                },
            };
            Ok((vec![seg], false, model.name))
        }
        AsrProviderKind::LocalQwen => {
            let (local_wav, should_cleanup) = ensure_local_wav(wav_path).await?;
            let cli = resolve_parakeet_cli(&settings.parakeet_cli_path).ok_or_else(|| {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                "Qwen3-ASR 実行ランタイム（sherpa-onnx-offline）が未設定です。設定＞音声認識から導入してください。"
                    .to_string()
            })?;
            let model_dir = storage::models_dir().join(&model.filename);
            if !model_dir.exists() {
                if should_cleanup {
                    let _ = fs::remove_file(&local_wav);
                }
                return Err(format!(
                    "Qwen3-ASR モデルフォルダ（{}）が見つかりません。設定＞音声認識からモデルをダウンロードしてください。",
                    model_dir.display()
                ));
            }
            let conv_frontend = model_dir.join("conv_frontend.onnx");
            let encoder = model_dir.join("encoder.int8.onnx");
            let decoder = model_dir.join("decoder.int8.onnx");
            let tokenizer = model_dir.join("tokenizer");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            cmd.arg(format!("--qwen3-asr-conv-frontend={}", conv_frontend.display()))
                .arg(format!("--qwen3-asr-encoder={}", encoder.display()))
                .arg(format!("--qwen3-asr-decoder={}", decoder.display()))
                .arg(format!("--qwen3-asr-tokenizer={}", tokenizer.display()));
            let hotwords = dictionary
                .iter()
                .map(|d| d.term.trim())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(",");
            if !hotwords.is_empty() {
                cmd.arg(format!("--qwen3-asr-hotwords={hotwords}"));
            }
            cmd.arg(&local_wav);
            let output = cmd
                .output()
                .map_err(|e| format!("Qwen3-ASR 実行失敗: {e}"))?;
            if should_cleanup {
                let _ = fs::remove_file(&local_wav);
            }
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Qwen3-ASR 文字起こしエラー: {stderr}"));
            }
            let raw_out = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let text = strip_sense_voice_tags(&raw_out);
            let seg = TranscriptSegment {
                id: Uuid::new_v4().to_string(),
                start_ms: 0,
                end_ms: 1000,
                speaker: String::new(),
                text: if text.is_empty() {
                    "（発話が検出されませんでした）".to_string()
                } else {
                    text
                },
            };
            Ok((vec![seg], false, model.name))
        }
        AsrProviderKind::CloudOpenAi | AsrProviderKind::CloudGroq => {
            let is_groq = model.provider == AsrProviderKind::CloudGroq;
            let api_key = if is_groq {
                secrets::get_secret("groq_api_key")?
                    .ok_or_else(|| "Groq APIキーが設定されていません。設定＞音声認識＞クラウド API から登録してください。".to_string())?
            } else {
                match secrets::get_secret("openai_api_key")? {
                    Some(k) => k,
                    None => secrets::get_secret("llm_openai_api_key")?
                        .ok_or_else(|| "OpenAI APIキーが設定されていません。設定＞音声認識＞クラウド API から登録してください。".to_string())?,
                }
            };
            let api_key = api_key.trim().to_string();
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
            let file_name = wav_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("recording.wav")
                .to_string();
            let mime = match wav_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("wav")
                .to_lowercase()
                .as_str()
            {
                "mp3" => "audio/mpeg",
                "m4a" | "mp4" => "audio/mp4",
                "ogg" => "audio/ogg",
                "webm" => "audio/webm",
                "flac" => "audio/flac",
                _ => "audio/wav",
            };
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(file_name)
                .mime_str(mime)
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
            let client = cloud_http_client();
            let resp = client
                .post(url)
                .bearer_auth(&api_key)
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("クラウドASR通信エラー: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                if status == reqwest::StatusCode::UNAUTHORIZED {
                    let hint = if is_groq {
                        "Groq APIキー（gsk_...）が正しく保存されているか、設定＞音声認識＞クラウド API＞Groq Whisper で再入力・保存してください。"
                    } else {
                        "OpenAI APIキー（sk-...）が正しく保存されているか、設定＞音声認識＞クラウド API＞OpenAI Whisper で再入力・保存してください。"
                    };
                    return Err(format!("クラウドASR API エラー ({status}): {hint} ({body})"));
                }
                return Err(format!("クラウドASR API エラー ({status}): {body}"));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("クラウドASR応答の解析失敗: {e}"))?;
            let mut segs = Vec::new();
            if let Some(arr) = json.get("segments").and_then(|v| v.as_array()) {
                for item in arr {
                    let no_speech = item
                        .get("no_speech_prob")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    if no_speech > 0.75 {
                        continue;
                    }
                    let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    if text.is_empty() || is_silence_hallucination(&text) {
                        continue;
                    }
                    let start_ms = (item.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1000.0) as u64;
                    let end_ms = (item.get("end").and_then(|v| v.as_f64()).unwrap_or(1.0) * 1000.0) as u64;
                    segs.push(TranscriptSegment {
                        id: Uuid::new_v4().to_string(),
                        start_ms,
                        end_ms,
                        speaker: String::new(),
                        text,
                    });
                }
            } else if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() && !is_silence_hallucination(trimmed) {
                    segs.push(TranscriptSegment {
                        id: Uuid::new_v4().to_string(),
                        start_ms: 0,
                        end_ms: 1000,
                        speaker: String::new(),
                        text: trimmed.to_string(),
                    });
                }
            }
            Ok((segs, false, model.name))
        }
        AsrProviderKind::CloudStepFun => {
            let api_key = secrets::get_secret("stepfun_api_key")?
                .ok_or_else(|| "StepFun APIキーが設定されていません。設定＞音声認識＞クラウド API から登録してください。".to_string())?;
            let api_key = api_key.trim().to_string();
            let (local_wav, should_cleanup) = ensure_local_wav(wav_path).await?;
            let bytes_res = fs::read(&local_wav);
            if should_cleanup {
                let _ = fs::remove_file(&local_wav);
            }
            let bytes = bytes_res.map_err(|e| format!("音声読み込み失敗: {e}"))?;
            let audio_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

            let mut transcription = serde_json::json!({
                "model": "stepaudio-2.5-asr",
                "enable_itn": true,
            });
            if settings.language != "auto" {
                let lang = if settings.language.is_empty() {
                    "ja"
                } else {
                    settings.language.as_str()
                };
                transcription["language"] = serde_json::json!(lang);
            }

            let payload = serde_json::json!({
                "audio": {
                    "data": audio_b64,
                    "input": {
                        "transcription": transcription,
                        "format": {
                            "type": "wav"
                        }
                    }
                }
            });

            let client = cloud_http_client();
            let endpoints = if STEPFUN_USE_CN_ENDPOINT.load(Ordering::Relaxed) {
                [
                    ("https://api.stepfun.com/v1/audio/asr/sse", true),
                    ("https://api.stepfun.ai/v1/audio/asr/sse", false),
                ]
            } else {
                [
                    ("https://api.stepfun.ai/v1/audio/asr/sse", false),
                    ("https://api.stepfun.com/v1/audio/asr/sse", true),
                ]
            };
            let mut last_status = reqwest::StatusCode::INTERNAL_SERVER_ERROR;
            let mut last_body = String::new();
            let mut success_body: Option<String> = None;

            for (idx, (endpoint, is_cn)) in endpoints.iter().enumerate() {
                let resp = client
                    .post(*endpoint)
                    .bearer_auth(&api_key)
                    .header("Accept", "text/event-stream")
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| format!("StepFun ASR 通信エラー: {e}"))?;
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                if status.is_success() {
                    STEPFUN_USE_CN_ENDPOINT.store(*is_cn, Ordering::Relaxed);
                    success_body = Some(body);
                    break;
                }
                last_status = status;
                last_body = body;
                // Overseas (.ai) vs China mainland (.com) keys are region-scoped; retry alternate endpoint on 401/403
                if idx == 0
                    && (status == reqwest::StatusCode::UNAUTHORIZED
                        || status == reqwest::StatusCode::FORBIDDEN)
                {
                    continue;
                }
                break;
            }

            let body = match success_body {
                Some(b) => b,
                None => {
                    if last_status == reqwest::StatusCode::UNAUTHORIZED
                        || last_status == reqwest::StatusCode::FORBIDDEN
                    {
                        return Err(format!(
                            "StepFun ASR API エラー ({last_status}): StepFun APIキー（通常APIキー）が正しいか確認し、設定＞音声認識＞クラウド API で再保存してください。({last_body})"
                        ));
                    }
                    return Err(format!("StepFun ASR API エラー ({last_status}): {last_body}"));
                }
            };

            let segs = parse_stepfun_sse_response(&body)?;
            Ok((segs, false, model.name))
        }
        AsrProviderKind::CloudDeepgram => {
            let api_key = secrets::get_secret("deepgram_api_key")?
                .ok_or_else(|| "Deepgram APIキーが未設定です。".to_string())?;
            let api_key = api_key.trim().to_string();
            let bytes = fs::read(wav_path).map_err(|e| format!("音声読み込み失敗: {e}"))?;
            let lang_param = if settings.language == "auto" || settings.language.is_empty() {
                "detect_language=true".to_string()
            } else {
                format!("language={}", settings.language)
            };
            let url = format!(
                "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&utterances=true&{lang_param}"
            );
            let client = cloud_http_client();
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
            if segs.is_empty() {
                if let Some(transcript) = json
                    .get("results")
                    .and_then(|r| r.get("channels"))
                    .and_then(|c| c.as_array())
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("alternatives"))
                    .and_then(|a| a.as_array())
                    .and_then(|a| a.first())
                    .and_then(|a| a.get("transcript"))
                    .and_then(|t| t.as_str())
                {
                    let trimmed = transcript.trim();
                    if !trimmed.is_empty() {
                        segs.push(TranscriptSegment {
                            id: Uuid::new_v4().to_string(),
                            start_ms: 0,
                            end_ms: 1000,
                            speaker: String::new(),
                            text: trimmed.to_string(),
                        });
                    }
                }
            }
            Ok((segs, true, model.name))
        }
    }
}

fn parse_stepfun_sse_response(body: &str) -> Result<Vec<TranscriptSegment>, String> {
    let mut done_text: Option<String> = None;
    let mut delta_acc = String::new();

    for line in body.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = rest.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data) {
            let ev_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ev_type == "error" || v.get("error").is_some() {
                let msg = v
                    .get("message")
                    .and_then(|m| m.as_str())
                    .or_else(|| {
                        v.get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                    })
                    .unwrap_or(data);
                return Err(format!("StepFun ASR エラー: {msg}"));
            }
            if ev_type == "transcript.text.done" {
                if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                    let t = t.trim();
                    if !t.is_empty() {
                        done_text = Some(t.to_string());
                    }
                }
            } else if ev_type == "transcript.text.delta" {
                if let Some(d) = v.get("delta").and_then(|t| t.as_str()) {
                    delta_acc.push_str(d);
                }
            } else if done_text.is_none() {
                if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                    let t = t.trim();
                    if !t.is_empty() {
                        done_text = Some(t.to_string());
                    }
                }
            }
        }
    }

    let mut final_text = done_text.unwrap_or_else(|| delta_acc.trim().to_string());
    if final_text.is_empty() {
        if let Ok(v) = serde_json::from_str::<Value>(body.trim()) {
            if v.get("error").is_some() {
                let msg = v
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or(body.trim());
                return Err(format!("StepFun ASR エラー: {msg}"));
            }
            if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                final_text = t.trim().to_string();
            }
        }
    }

    let final_text = final_text.trim();
    if final_text.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![TranscriptSegment {
        id: Uuid::new_v4().to_string(),
        start_ms: 0,
        end_ms: 1000,
        speaker: String::new(),
        text: final_text.to_string(),
    }])
}

fn strip_sense_voice_tags(raw: &str) -> String {
    // 1. Extract `text` field if sherpa-onnx printed JSON lines (e.g. {"lang": ..., "text": "もしもし。", ...})
    let mut extracted_parts = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                if let Some(t) = v["text"].as_str() {
                    if !t.trim().is_empty() {
                        extracted_parts.push(t.trim().to_string());
                    }
                    continue;
                }
            }
        }
    }
    let source = if !extracted_parts.is_empty() {
        extracted_parts.join(" ")
    } else {
        raw.to_string()
    };

    // 2. Strip SenseVoice <|...|> tags
    let mut out = String::with_capacity(source.len());
    let mut in_tag = false;
    let chars: Vec<char> = source.chars().collect();
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

fn is_silence_hallucination(text: &str) -> bool {
    let cleaned = text
        .trim()
        .trim_end_matches(|c: char| matches!(c, '。' | '、' | '.' | '!' | '！' | '?' | '？'));
    matches!(
        cleaned,
        "ご視聴ありがとうございました"
            | "ご視聴いただきありがとうございました"
            | "最後までご視聴ありがとうございました"
            | "チャンネル登録よろしくお願いします"
            | "チャンネル登録をお願いします"
            | "高評価よろしくお願いします"
            | "お疲れ様でした"
            | "ありがとうございました"
            | "Thank you for watching"
            | "Thanks for watching"
            | "Subscribe"
            | "MBC 뉴스"
    )
}

pub async fn prewarm_whisper_server(settings: &AppSettings) {
    let models = list_models(settings);
    let Some(model) = models
        .into_iter()
        .find(|m| m.id == settings.active_asr_model_id)
    else {
        return;
    };
    if model.provider != AsrProviderKind::LocalWhisper {
        return;
    }
    let Some(server_bin) =
        crate::whisper_server::resolve_whisper_server(&settings.whisper_cli_path)
    else {
        return;
    };
    let model_path = storage::models_dir().join(&model.filename);
    if !model_path.exists() {
        return;
    }
    let whisper_lang = if model.id.starts_with("kotoba-whisper") {
        "ja"
    } else if settings.language.is_empty() {
        "ja"
    } else {
        &settings.language
    };
    crate::whisper_server::prewarm(&server_bin, &model_path, whisper_lang, settings.enable_gpu_asr)
        .await;
}

pub async fn transcribe_chunk_async(
    chunk_wav: &Path,
    settings: &AppSettings,
    dictionary: &[DictionaryEntry],
) -> Result<String, String> {
    let models = list_models(settings);
    let model = models
        .into_iter()
        .find(|m| m.id == settings.active_asr_model_id)
        .ok_or_else(|| "ASRモデルが見つかりません".to_string())?;
    if !model.supports_realtime {
        return Ok(String::new());
    }

    if !model.is_local {
        if !settings.allow_cloud_asr {
            return Ok(String::new());
        }
        let (segs, _, _) = transcribe_wav(chunk_wav, settings, dictionary).await?;
        let joined = segs
            .into_iter()
            .map(|s| s.text.trim().to_string())
            .filter(|t| !t.is_empty() && !is_silence_hallucination(t))
            .collect::<Vec<_>>()
            .join(" ");
        return Ok(joined);
    }

    if model.provider == AsrProviderKind::LocalWhisper {
        let model_path = storage::models_dir().join(&model.filename);
        if !model_path.exists() {
            return Err(format!(
                "モデルファイル（{}）が未取得です。設定＞音声認識からダウンロードしてください。",
                model.filename
            ));
        }
        if let Some(server_bin) =
            crate::whisper_server::resolve_whisper_server(&settings.whisper_cli_path)
        {
            let prompt_terms: Vec<String> = dictionary.iter().map(|d| d.term.clone()).collect();
            let prompt_hint = prompt_terms.join("、");
            let whisper_lang = if model.id.starts_with("kotoba-whisper") {
                "ja"
            } else if settings.language.is_empty() {
                "ja"
            } else {
                &settings.language
            };
            let effective_prompt = if !prompt_hint.is_empty() {
                if whisper_lang == "ja" {
                    format!("以下は日本語の会話です。用語: {prompt_hint}")
                } else {
                    prompt_hint
                }
            } else if whisper_lang == "ja" {
                "こんにちは。本日の会議を始めます。".to_string()
            } else {
                String::new()
            };
            let parsed = crate::whisper_server::infer_wav(
                &server_bin,
                &model_path,
                chunk_wav,
                whisper_lang,
                &effective_prompt,
                settings.enable_gpu_asr,
            )
            .await?;
            if let Some(arr) = parsed.get("segments").and_then(|v| v.as_array()) {
                let joined = arr
                    .iter()
                    .filter(|s| s.get("no_speech_prob").and_then(|v| v.as_f64()).unwrap_or(0.0) <= 0.75)
                    .filter_map(|s| s.get("text").and_then(|t| t.as_str()))
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty() && !is_silence_hallucination(t))
                    .collect::<Vec<_>>()
                    .join(" ");
                if !joined.is_empty() {
                    return Ok(joined);
                }
            }
            if let Some(full_text) = parsed.get("text").and_then(|v| v.as_str()) {
                let trimmed = full_text.trim();
                if !trimmed.is_empty() && !is_silence_hallucination(trimmed) {
                    return Ok(trimmed.to_string());
                }
            }
            return Ok(String::new());
        }
    }

    let chunk_owned = chunk_wav.to_path_buf();
    let settings_owned = settings.clone();
    let dict_owned = dictionary.to_vec();
    tokio::task::spawn_blocking(move || {
        transcribe_chunk_sync(&chunk_owned, &settings_owned, &dict_owned)
    })
    .await
    .map_err(|e| format!("チャンク推論タスク失敗: {e}"))?
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
                return Err(format!(
                    "モデルファイル（{}）が未取得です。設定＞音声認識からダウンロードしてください。",
                    model.filename
                ));
            }
            let out_base = chunk_wav.with_extension("chunk_out");
            let whisper_lang = if model.id.starts_with("kotoba-whisper") {
                "ja"
            } else if settings.language.is_empty() {
                "ja"
            } else {
                &settings.language
            };
            let effective_prompt = if !prompt_hint.is_empty() {
                if whisper_lang == "ja" {
                    format!("以下は日本語の会話です。用語: {prompt_hint}")
                } else {
                    prompt_hint.clone()
                }
            } else if whisper_lang == "ja" {
                "こんにちは。本日の会議を始めます。".to_string()
            } else {
                String::new()
            };
            let threads = std::thread::available_parallelism()
                .map(|n| n.get().clamp(2, 8))
                .unwrap_or(4);
            let build_chunk_cmd = |no_gpu: bool| {
                let mut c = Command::new(&cli);
                configure_bg_command(&mut c);
                c.arg("-m")
                    .arg(&model_path)
                    .arg("-f")
                    .arg(chunk_wav)
                    .arg("-nt")
                    .arg("-np")
                    .arg("-t")
                    .arg(threads.to_string())
                    .arg("-l")
                    .arg(whisper_lang)
                    .arg("-of")
                    .arg(&out_base)
                    .arg("-otxt");
                if no_gpu {
                    c.arg("-ng");
                }
                if !effective_prompt.is_empty() {
                    c.arg("--prompt").arg(&effective_prompt);
                }
                c
            };
            let mut output = build_chunk_cmd(!settings.enable_gpu_asr)
                .output()
                .map_err(|e| format!("チャンク文字起こし失敗: {e}"))?;
            if !output.status.success() && settings.enable_gpu_asr {
                output = build_chunk_cmd(true)
                    .output()
                    .map_err(|e| format!("チャンク文字起こし失敗: {e}"))?;
            }
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
        AsrProviderKind::LocalParakeet => {
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
            if model.id == "sense-voice-int8-ja" {
                let sv_lang = match settings.language.as_str() {
                    "en" => "en",
                    "auto" => "auto",
                    _ => "ja",
                };
                cmd.arg(format!("--sense-voice-model={}", ctc_model.display()))
                    .arg("--sense-voice-use-itn=1")
                    .arg(format!("--sense-voice-language={sv_lang}"))
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
            let raw = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(strip_sense_voice_tags(&raw))
        }
        AsrProviderKind::LocalQwen => {
            let cli = resolve_parakeet_cli(&settings.parakeet_cli_path)
                .ok_or_else(|| "sherpa-onnx-offline 未設定".to_string())?;
            let model_dir = storage::models_dir().join(&model.filename);
            if !model_dir.exists() {
                return Ok(String::new());
            }
            let conv_frontend = model_dir.join("conv_frontend.onnx");
            let encoder = model_dir.join("encoder.int8.onnx");
            let decoder = model_dir.join("decoder.int8.onnx");
            let tokenizer = model_dir.join("tokenizer");
            let mut cmd = Command::new(cli);
            configure_bg_command(&mut cmd);
            cmd.arg(format!("--qwen3-asr-conv-frontend={}", conv_frontend.display()))
                .arg(format!("--qwen3-asr-encoder={}", encoder.display()))
                .arg(format!("--qwen3-asr-decoder={}", decoder.display()))
                .arg(format!("--qwen3-asr-tokenizer={}", tokenizer.display()))
                .arg(chunk_wav);
            let output = cmd
                .output()
                .map_err(|e| format!("チャンク推論失敗: {e}"))?;
            let raw = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(strip_sense_voice_tags(&raw))
        }
        _ => Ok(String::new()),
    }
}

/// ローカルASR（単一話者出力）に対して、無音ギャップとターン交代ヒューリスティックに基づく簡易話者分離を適用する
pub fn apply_local_heuristic_diarization(
    segments: &mut [TranscriptSegment],
    user_label: &str,
    remote_label: &str,
) -> bool {
    if segments.is_empty() {
        return false;
    }
    let primary = if user_label.trim().is_empty() { "話者A" } else { user_label.trim() };
    let secondary = if remote_label.trim().is_empty() { "話者B" } else { remote_label.trim() };

    let mut use_primary = true;
    let mut prev_end_ms = segments[0].start_ms;
    let mut prev_ended_with_question = false;

    for (idx, seg) in segments.iter_mut().enumerate() {
        if idx > 0 {
            let gap_ms = seg.start_ms.saturating_sub(prev_end_ms);
            if gap_ms >= 1500 || (prev_ended_with_question && gap_ms >= 400) {
                use_primary = !use_primary;
            }
        }
        if seg.speaker.trim().is_empty() || seg.speaker == "話者" || seg.speaker == primary {
            seg.speaker = if use_primary {
                primary.to_string()
            } else {
                secondary.to_string()
            };
        }
        prev_end_ms = seg.end_ms;
        let trimmed = seg.text.trim();
        prev_ended_with_question = trimmed.ends_with('?') || trimmed.ends_with('？');
    }
    true
}

