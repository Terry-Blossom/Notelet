use crate::models::{ActionItem, AppSettings, ChatAnswer, ChatCitation, Note};
use crate::secrets;
use serde_json::{json, Value};
use uuid::Uuid;

fn format_ms(ms: u64) -> String {
    let sec = ms / 1000;
    format!("{:02}:{:02}", sec / 60, sec % 60)
}

pub fn note_context_text(note: &Note) -> String {
    let mut out = format!("タイトル: {}\n日時: {}\n", note.title, note.created_at);
    if !note.manual_notes.trim().is_empty() {
        out.push_str(&format!("\n[手入力メモ]\n{}\n", note.manual_notes.trim()));
    }
    out.push_str("\n[文字起こし]\n");
    for seg in &note.segments {
        out.push_str(&format!(
            "[{}] {}: {}\n",
            format_ms(seg.start_ms),
            seg.speaker,
            seg.text
        ));
    }
    out
}

pub async fn call_llm(
    settings: &AppSettings,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    if settings.llm_provider == "none" || settings.llm_provider.trim().is_empty() {
        return Err("LLMが未設定です。設定＞AI・LLM設定でプロバイダーとAPIキー（またはローカルOllama）を設定してください。".to_string());
    }

    let client = reqwest::Client::new();
    match settings.llm_provider.as_str() {
        "openai" => {
            let key = secrets::get_secret("llm_openai_api_key")?
                .or_else(|| secrets::get_secret("openai_api_key").ok().flatten())
                .ok_or_else(|| "OpenAI APIキーが未設定です。".to_string())?;
            let model = if settings.llm_model.is_empty() {
                "gpt-4o-mini"
            } else {
                &settings.llm_model
            };
            let resp = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(key)
                .json(&json!({
                    "model": model,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_prompt }
                    ],
                    "temperature": 0.2
                }))
                .send()
                .await
                .map_err(|e| format!("OpenAI 通信エラー: {e}"))?;
            if !resp.status().is_success() {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                return Err(format!("OpenAI API エラー ({s}): {b}"));
            }
            let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
            Ok(v["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string())
        }
        "anthropic" => {
            let key = secrets::get_secret("llm_anthropic_api_key")?
                .ok_or_else(|| "Anthropic APIキーが未設定です。".to_string())?;
            let model = if settings.llm_model.is_empty() {
                "claude-3-5-sonnet-latest"
            } else {
                &settings.llm_model
            };
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": model,
                    "max_tokens": 2048,
                    "system": system_prompt,
                    "messages": [{ "role": "user", "content": user_prompt }]
                }))
                .send()
                .await
                .map_err(|e| format!("Anthropic 通信エラー: {e}"))?;
            if !resp.status().is_success() {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                return Err(format!("Anthropic API エラー ({s}): {b}"));
            }
            let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
            Ok(v["content"][0]["text"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string())
        }
        "gemini" => {
            let key = secrets::get_secret("llm_gemini_api_key")?
                .ok_or_else(|| "Gemini APIキーが未設定です。".to_string())?;
            let model = if settings.llm_model.is_empty() {
                "gemini-2.5-flash"
            } else {
                &settings.llm_model
            };
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            );
            let resp = client
                .post(url)
                .json(&json!({
                    "systemInstruction": { "parts": [{ "text": system_prompt }] },
                    "contents": [{ "parts": [{ "text": user_prompt }] }]
                }))
                .send()
                .await
                .map_err(|e| format!("Gemini 通信エラー: {e}"))?;
            if !resp.status().is_success() {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                return Err(format!("Gemini API エラー ({s}): {b}"));
            }
            let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
            Ok(v["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string())
        }
        "ollama" => {
            let endpoint = if settings.llm_endpoint.trim().is_empty() {
                "http://localhost:11434"
            } else {
                settings.llm_endpoint.trim_end_matches('/')
            };
            let model = if settings.llm_model.is_empty() {
                "qwen2.5:7b"
            } else {
                &settings.llm_model
            };
            let resp = client
                .post(format!("{endpoint}/api/chat"))
                .json(&json!({
                    "model": model,
                    "stream": false,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_prompt }
                    ]
                }))
                .send()
                .await
                .map_err(|e| format!("ローカル Ollama への接続に失敗しました ({endpoint}): {e}"))?;
            if !resp.status().is_success() {
                let s = resp.status();
                let b = resp.text().await.unwrap_or_default();
                return Err(format!("Ollama エラー ({s}): {b}"));
            }
            let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
            Ok(v["message"]["content"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string())
        }
        other => Err(format!("未対応のLLMプロバイダーです: {other}")),
    }
}

pub async fn summarize_note(
    settings: &AppSettings,
    note: &Note,
) -> Result<(String, Vec<String>, Vec<ActionItem>), String> {
    let sys = "あなたは正確な議事録アシスタントです。与えられた文字起こしとメモのみを根拠にし、会話にない事実を推測で補わないでください。必ずJSONのみで返答してください: {\"summary\": \"...\", \"decisions\": [\"...\"], \"action_items\": [{\"text\": \"...\", \"assignee\": \"...\"}]}";
    let user = note_context_text(note);
    let raw = call_llm(settings, sys, &user).await?;
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if let Ok(v) = serde_json::from_str::<Value>(cleaned) {
        let summary = v["summary"].as_str().unwrap_or("").to_string();
        let decisions = v["decisions"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let action_items = v["action_items"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x["text"].as_str().map(|t| ActionItem {
                            id: Uuid::new_v4().to_string(),
                            text: t.to_string(),
                            assignee: x["assignee"].as_str().unwrap_or("").to_string(),
                            done: false,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((summary, decisions, action_items))
    } else {
        Ok((raw, Vec::new(), Vec::new()))
    }
}

pub async fn draft_followup_email(settings: &AppSettings, note: &Note) -> Result<String, String> {
    let sys = "会議の文字起こしと決定事項から、参加者向けの簡潔で丁寧なフォローアップメールの下書きを日本語で作成してください。会話に含まれない日程や約束を勝手に作らないでください。";
    let user = note_context_text(note);
    call_llm(settings, sys, &user).await
}

pub async fn run_recipe(
    settings: &AppSettings,
    note: &Note,
    recipe_prompt: &str,
) -> Result<String, String> {
    let sys = "指定された指示に従って文字起こしとメモを整理してください。会話にない事実を創作しないでください。";
    let user = format!("指示:\n{recipe_prompt}\n\n資料:\n{}", note_context_text(note));
    call_llm(settings, sys, &user).await
}

pub async fn chat_with_notes(
    settings: &AppSettings,
    notes: &[Note],
    question: &str,
) -> Result<ChatAnswer, String> {
    let mut citations = Vec::new();
    let mut context = String::new();
    let q_lower = question.to_lowercase();

    for note in notes.iter().take(12) {
        context.push_str(&format!("\n=== ノート: {} (ID: {}) ===\n", note.title, note.id));
        for seg in &note.segments {
            let ts = format_ms(seg.start_ms);
            context.push_str(&format!("[{ts}] {}: {}\n", seg.speaker, seg.text));
            if citations.len() < 5
                && (q_lower.split_whitespace().any(|w| !w.is_empty() && seg.text.to_lowercase().contains(w))
                    || note.segments.len() <= 3)
            {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title: note.title.clone(),
                    timestamp: ts,
                    excerpt: seg.text.chars().take(80).collect(),
                });
            }
        }
    }

    if citations.is_empty() {
        for note in notes.iter().take(3) {
            if let Some(seg) = note.segments.first() {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title: note.title.clone(),
                    timestamp: format_ms(seg.start_ms),
                    excerpt: seg.text.chars().take(80).collect(),
                });
            }
        }
    }

    let sys = "あなたはノート検索・質問応答アシスタントです。与えられたノートの記録だけに基づいて回答してください。記録にない情報は「記録に見当たりません」と答え、推測で補わないでください。回答には該当するノート名と [MM:SS] タイムスタンプを明記してください。";
    let user = format!("質問: {question}\n\n参照ノート:\n{context}");
    let answer = call_llm(settings, sys, &user).await?;
    Ok(ChatAnswer { answer, citations })
}
