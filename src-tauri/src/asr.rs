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

mod futures_util_stub {
    // reqwest::Response::chunk() を使うため追加依存不要
}

pub fn resolve_whisper_cli(custom_path: &str) -> Option<PathBuf> {
    if !custom_path.trim().is_empty() {
        let p = PathBuf::from(custom_path.trim());
        if p.exists() {
            return Some(p);
        }
    }
    let bin_name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let local_bin = storage::app_data_dir().join("bin").join(bin_name);
    if local_bin.exists() {
        return Some(local_bin);
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
    let local_bin = storage::app_data_dir().join("bin").join(bin_name);
    if local_bin.exists() {
        return Some(local_bin);
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
            supports_realtime: false,
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
            supports_realtime: false,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason.clone(),
            installed: models_dir.join("ggml-small-q5_1.bin").exists(),
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
            supports_realtime: false,
            supports_diarization: false,
            is_compatible: whisper_cli_ok,
            compatibility_reason: whisper_reason,
            installed: models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "parakeet-tdt-ctc-0.6b-ja".to_string(),
            name: "NVIDIA Parakeet TDT/CTC 0.6B 日本語".to_string(),
            provider: AsrProviderKind::LocalParakeet,
            is_local: true,
            languages: vec!["日本語（句読点対応）".into()],
            environment: "ローカル ONNX Runtime / sherpa-onnx (x86_64 / arm64)".into(),
            memory_mb: 2400,
            license: "CC-BY-4.0 (NVIDIA) / Apache-2.0 (sherpa-onnx)".into(),
            size_mb: 640,
            download_url: "https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja".into(),
            filename: "parakeet-tdt_ctc-0.6b-ja".into(),
            supports_realtime: false,
            supports_diarization: false,
            is_compatible: parakeet_arch_ok && parakeet_cli_ok,
            compatibility_reason: parakeet_reason.clone(),
            installed: models_dir.join("parakeet-tdt_ctc-0.6b-ja").exists(),
            data_handling: "音声は外部送信されず、PC内のみで処理されます。".into(),
        },
        AsrModelInfo {
            id: "parakeet-tdt-0.6b-v3".to_string(),
            name: "NVIDIA Parakeet TDT 0.6B v3 (英語・欧州)".to_string(),
            provider: AsrProviderKind::LocalParakeet,
            is_local: true,
            languages: vec!["英語".into(), "欧州25言語".into()],
            environment: "ローカル ONNX Runtime / sherpa-onnx (x86_64 / arm64)".into(),
            memory_mb: 2400,
            license: "CC-BY-4.0 (NVIDIA) / Apache-2.0 (sherpa-onnx)".into(),
            size_mb: 640,
            download_url: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3".into(),
            filename: "parakeet-tdt-0.6b-v3".into(),
            supports_realtime: false,
            supports_diarization: false,
            is_compatible: parakeet_arch_ok && parakeet_cli_ok,
            compatibility_reason: parakeet_reason,
            installed: models_dir.join("parakeet-tdt-0.6b-v3").exists(),
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
            supports_realtime: false,
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
            supports_realtime: false,
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
            supports_realtime: false,
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
    if model.provider != AsrProviderKind::LocalWhisper {
        return Err("このモデルの自動ダウンロードは現在 Whisper GGML モデルのみ対応しています。Parakeet ONNX モデルは Hugging Face から変換済みディレクトリを配置してください。".to_string());
    }

    let dest = storage::models_dir().join(&model.filename);
    let tmp = storage::models_dir().join(format!("{}.part", &model.filename));

    let client = reqwest::Client::new();
    let mut resp = client
        .get(&model.download_url)
        .send()
        .await
        .map_err(|e| format!("ダウンロード接続に失敗しました: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ダウンロードエラー: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(model.size_mb as u64 * 1024 * 1024);
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
        let pct = ((downloaded as f64 / total.max(1) as f64) * 100.0).min(100.0) as u8;
        let _ = app.emit(
            "asr-download-progress",
            serde_json::json!({ "model_id": model_id, "progress": pct }),
        );
    }
    drop(file);
    fs::rename(&tmp, &dest).map_err(|e| format!("モデルファイルの配置に失敗: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
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
            let cli = resolve_whisper_cli(&settings.whisper_cli_path).ok_or_else(|| {
                "ローカルWhisperランタイム（whisper-cli）が見つかりません。設定＞ASRモデルからパスを指定してください。クラウドへの自動切替は行いません。"
                    .to_string()
            })?;
            let model_path = storage::models_dir().join(&model.filename);
            if !model_path.exists() {
                return Err(format!(
                    "モデルファイル（{}）が未取得です。設定＞ASRモデルからダウンロードしてください。",
                    model.filename
                ));
            }
            let out_base = wav_path.with_extension("whisper_out");
            let mut cmd = Command::new(cli);
            cmd.arg("-m")
                .arg(&model_path)
                .arg("-f")
                .arg(wav_path)
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
        AsrProviderKind::LocalParakeet => {
            let cli = resolve_parakeet_cli(&settings.parakeet_cli_path).ok_or_else(|| {
                "Parakeet ランタイム（sherpa-onnx-offline）が未設定です。設定＞ASRモデルで実行ファイルのパスを指定してください。"
                    .to_string()
            })?;
            let model_dir = storage::models_dir().join(&model.filename);
            if !model_dir.exists() {
                return Err(format!(
                    "Parakeet モデルフォルダ（{}）が見つかりません。ONNXモデルをモデルディレクトリへ配置してください。",
                    model_dir.display()
                ));
            }
            let encoder = model_dir.join("encoder.onnx");
            let decoder = model_dir.join("decoder.onnx");
            let joiner = model_dir.join("joiner.onnx");
            let tokens = model_dir.join("tokens.txt");
            let output = Command::new(cli)
                .arg(format!("--encoder={}", encoder.display()))
                .arg(format!("--decoder={}", decoder.display()))
                .arg(format!("--joiner={}", joiner.display()))
                .arg(format!("--tokens={}", tokens.display()))
                .arg("--model-type=nemo_transducer")
                .arg(wav_path)
                .output()
                .map_err(|e| format!("Parakeet ランタイム実行失敗: {e}"))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Parakeet 文字起こしエラー: {stderr}"));
            }
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
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
