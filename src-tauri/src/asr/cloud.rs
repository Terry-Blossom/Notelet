use super::*;

pub async fn test_cloud_asr_connection(provider: &AsrProviderKind) -> Result<String, String> {
    let client = cloud_http_client();
    match provider {
        AsrProviderKind::CloudOpenAi => {
            let api_key = match secrets::get_secret("openai_api_key")? {
                Some(k) => k,
                None => secrets::get_secret("llm_openai_api_key")?
                    .ok_or_else(|| "OpenAI APIキーが未設定です。".to_string())?,
            };
            let resp = client
                .get("https://api.openai.com/v1/models")
                .bearer_auth(api_key.trim())
                .send()
                .await
                .map_err(|e| format!("OpenAI 接続エラー: {e}"))?;
            if resp.status().is_success() {
                Ok("OpenAI Whisper API への接続に成功しました。".to_string())
            } else {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                Err(format!("OpenAI 認証/接続エラー ({s}): {b}"))
            }
        }
        AsrProviderKind::CloudGroq => {
            let api_key = secrets::get_secret("groq_api_key")?
                .ok_or_else(|| "Groq APIキーが未設定です。".to_string())?;
            let resp = client
                .get("https://api.groq.com/openai/v1/models")
                .bearer_auth(api_key.trim())
                .send()
                .await
                .map_err(|e| format!("Groq 接続エラー: {e}"))?;
            if resp.status().is_success() {
                Ok("Groq Whisper API への接続に成功しました。".to_string())
            } else {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                Err(format!("Groq 認証/接続エラー ({s}): {b}"))
            }
        }
        AsrProviderKind::CloudDeepgram => {
            let api_key = secrets::get_secret("deepgram_api_key")?
                .ok_or_else(|| "Deepgram APIキーが未設定です。".to_string())?;
            let resp = client
                .get("https://api.deepgram.com/v1/projects")
                .header("Authorization", format!("Token {}", api_key.trim()))
                .send()
                .await
                .map_err(|e| format!("Deepgram 接続エラー: {e}"))?;
            if resp.status().is_success() {
                Ok("Deepgram API への接続に成功しました。".to_string())
            } else {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                Err(format!("Deepgram 認証/接続エラー ({s}): {b}"))
            }
        }
        AsrProviderKind::CloudStepFun => {
            let api_key = secrets::get_secret("stepfun_api_key")?
                .ok_or_else(|| "StepFun APIキーが未設定です。".to_string())?;
            let endpoints = [
                ("https://api.stepfun.ai/v1/models", false),
                ("https://api.stepfun.com/v1/models", true),
            ];
            let mut last_err = String::new();
            for (url, is_cn) in endpoints {
                let resp = client
                    .get(url)
                    .bearer_auth(api_key.trim())
                    .send()
                    .await
                    .map_err(|e| format!("StepFun 接続エラー: {e}"))?;
                if resp.status().is_success() {
                    STEPFUN_USE_CN_ENDPOINT.store(is_cn, Ordering::Relaxed);
                    return Ok(format!(
                        "StepFun API ({}) への接続に成功しました。",
                        if is_cn {
                            "api.stepfun.com"
                        } else {
                            "api.stepfun.ai"
                        }
                    ));
                }
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                last_err = format!("StepFun 認証/接続エラー ({s}): {b}");
                if s != reqwest::StatusCode::UNAUTHORIZED && s != reqwest::StatusCode::FORBIDDEN {
                    break;
                }
            }
            Err(last_err)
        }
        AsrProviderKind::CloudGoogleStt => {
            let api_key = secrets::get_secret("google_stt_api_key")?
                .ok_or_else(|| "Google Cloud APIキーが未設定です。".to_string())?;
            let silent_b64 = base64::engine::general_purpose::STANDARD.encode(vec![0u8; 3200]);
            let payload = serde_json::json!({
                "config": {
                    "encoding": "LINEAR16",
                    "sampleRateHertz": 16000,
                    "languageCode": "ja-JP"
                },
                "audio": { "content": silent_b64 }
            });
            let resp = client
                .post("https://speech.googleapis.com/v1/speech:recognize")
                .header("X-Goog-Api-Key", api_key.trim())
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Google Cloud STT 接続エラー: {e}"))?;
            if resp.status().is_success() {
                Ok("Google Cloud Speech-to-Text API への接続に成功しました。".to_string())
            } else {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                Err(format!("Google Cloud STT 認証/接続エラー ({s}): {b}"))
            }
        }
        _ => Err("選択されたプロバイダーはローカルモデルです。".to_string()),
    }
}
