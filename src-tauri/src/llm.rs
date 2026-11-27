use crate::models::{
    ActionItem, AppSettings, ChatAnswer, ChatCitation, Folder, LiveAssistResult, Note,
    TranscriptSegment,
};
use crate::secrets;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn format_ms(ms: u64) -> String {
    let sec = ms / 1000;
    format!("{:02}:{:02}", sec / 60, sec % 60)
}

fn clean_bearer_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("Bearer ") {
        rest.trim().to_string()
    } else if let Some(rest) = trimmed.strip_prefix("bearer ") {
        rest.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_secret_candidates(keys: &[&str], env_vars: &[&str]) -> Option<String> {
    for k in keys {
        if let Ok(Some(v)) = secrets::get_secret(k) {
            let cleaned = clean_bearer_key(&v);
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }
    for env_name in env_vars {
        if let Ok(v) = std::env::var(env_name) {
            let cleaned = clean_bearer_key(&v);
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }
    None
}

pub fn note_context_text(note: &Note) -> String {
    let title = if note.title.trim().is_empty() {
        "無題のノート"
    } else {
        note.title.trim()
    };
    let mut out = format!("タイトル: {}\n日時: {}\n", title, note.created_at);
    if !note.summary.trim().is_empty() {
        out.push_str(&format!("\n[要約]\n{}\n", note.summary.trim()));
    }
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

async fn call_openai_compatible_endpoint(
    client: &reqwest::Client,
    base_raw: &str,
    model_raw: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let base = base_raw.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("OpenAI 互換 API のベースURLを設定してください（例: https://openrouter.ai/api/v1 または http://localhost:1234/v1）。".to_string());
    }
    let url = if base.ends_with("/chat/completions") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else if base.contains("openrouter.ai") && !base.contains("/api/v1") {
        format!("{base}/api/v1/chat/completions")
    } else {
        format!("{base}/chat/completions")
    };
    let model = if model_raw.trim().is_empty() {
        "openai/gpt-4o-mini"
    } else {
        model_raw.trim()
    };
    let key = resolve_secret_candidates(
        &[
            "llm_openai_compatible_api_key",
            "llm_openai_api_key",
            "openai_api_key",
            "groq_api_key",
        ],
        &["OPENROUTER_API_KEY", "OPENAI_API_KEY"],
    )
    .unwrap_or_default();

    let is_local = base.contains("localhost") || base.contains("127.0.0.1");
    if key.is_empty() && !is_local {
        return Err("OpenAI 互換 APIキーが保存されていません。設定（左下歯車）＞「AI・LLM」で「OpenAI互換 API Key」を入力して保存してください。".to_string());
    }

    let mut req = client
        .post(&url)
        .header("HTTP-Referer", "https://github.com/Terry-Blossom/Notelet")
        .header("X-Title", "Notelet")
        .json(&json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "temperature": 0.2
        }));
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("OpenAI 互換 API 通信エラー ({url}): {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        if s.as_u16() == 401 {
            return Err("OpenAI 互換 API の認証エラー (401): APIキーが未設定か無効です。設定＞AI・LLMで「OpenAI互換 API Key」を入力し「保存」を押してください。".to_string());
        }
        return Err(format!("OpenAI 互換 API エラー ({s}): {b}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
    Ok(v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string())
}

pub async fn call_llm(
    settings: &AppSettings,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    if settings.llm_provider == "none" || settings.llm_provider.trim().is_empty() {
        return Err("LLMが未設定です。設定＞AI・LLMでプロバイダーとAPIキー（またはローカルOllama）を設定してください。".to_string());
    }

    let effective_system = if settings.llm_custom_prompt.trim().is_empty() {
        system_prompt.to_string()
    } else {
        format!(
            "{system_prompt}\n\n【ユーザーの独自ルール・カスタム指示（必ず従うこと）】\n{}",
            settings.llm_custom_prompt.trim()
        )
    };
    let system_prompt = effective_system.as_str();

    let client = reqwest::Client::new();
    match settings.llm_provider.as_str() {
        "openai" => {
            let key = resolve_secret_candidates(
                &[
                    "llm_openai_api_key",
                    "openai_api_key",
                    "llm_openai_compatible_api_key",
                ],
                &["OPENAI_API_KEY"],
            )
            .ok_or_else(|| {
                "OpenAI APIキーが未設定です。設定＞AI・LLMでAPIキーを入力し「保存」を押してください。"
                    .to_string()
            })?;
            let model = if settings.llm_model.trim().is_empty() {
                "gpt-4o-mini"
            } else {
                settings.llm_model.trim()
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
        "openai_compatible" => {
            call_openai_compatible_endpoint(
                &client,
                &settings.llm_endpoint,
                &settings.llm_model,
                system_prompt,
                user_prompt,
            )
            .await
        }
        "anthropic" => {
            let key = resolve_secret_candidates(
                &["llm_anthropic_api_key"],
                &["ANTHROPIC_API_KEY"],
            )
            .ok_or_else(|| "Anthropic APIキーが未設定です。".to_string())?;
            let model = if settings.llm_model.trim().is_empty() {
                "claude-3-5-sonnet-latest"
            } else {
                settings.llm_model.trim()
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
            let key = resolve_secret_candidates(&["llm_gemini_api_key"], &["GEMINI_API_KEY"])
                .ok_or_else(|| "Gemini APIキーが未設定です。".to_string())?;
            let model = if settings.llm_model.trim().is_empty() {
                "gemini-2.5-flash"
            } else {
                settings.llm_model.trim()
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
            let raw_ep = settings.llm_endpoint.trim().trim_end_matches('/');
            // If endpoint is actually an OpenRouter / Groq / OpenAI-compatible URL, route it directly
            let looks_openai_compat = raw_ep.contains("openrouter.ai")
                || raw_ep.contains("groq.com")
                || raw_ep.contains("openai.com")
                || raw_ep.ends_with("/v1");
            if looks_openai_compat {
                let has_key = resolve_secret_candidates(
                    &[
                        "llm_openai_compatible_api_key",
                        "llm_openai_api_key",
                        "openai_api_key",
                        "groq_api_key",
                    ],
                    &["OPENROUTER_API_KEY", "OPENAI_API_KEY"],
                )
                .map(|k| !k.is_empty())
                .unwrap_or(false);
                if has_key || raw_ep.contains("localhost") || raw_ep.contains("127.0.0.1") {
                    if let Ok(ans) = call_openai_compatible_endpoint(
                        &client,
                        raw_ep,
                        &settings.llm_model,
                        system_prompt,
                        user_prompt,
                    )
                    .await
                    {
                        return Ok(ans);
                    }
                }
            }

            let endpoint = if raw_ep.is_empty()
                || raw_ep.contains("openrouter.ai")
                || raw_ep.contains("groq.com")
                || raw_ep.contains("openai.com")
            {
                "http://localhost:11434"
            } else {
                raw_ep.trim_end_matches("/v1")
            };
            let mut model = if settings.llm_model.trim().is_empty() {
                "qwen2.5:7b".to_string()
            } else {
                settings.llm_model.trim().to_string()
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

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                // Model may not exist in local Ollama (e.g. "gpt-4o-mini"); query /api/tags for installed models
                if let Ok(tags_resp) = client.get(format!("{endpoint}/api/tags")).send().await {
                    if let Ok(tags_json) = tags_resp.json::<Value>().await {
                        if let Some(first_model) = tags_json["models"]
                            .as_array()
                            .and_then(|arr| arr.first())
                            .and_then(|m| m["name"].as_str())
                        {
                            model = first_model.to_string();
                            let retry = client
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
                                .map_err(|e| format!("Ollama 再試行通信エラー: {e}"))?;
                            if retry.status().is_success() {
                                let v: Value = retry.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
                                return Ok(v["message"]["content"]
                                    .as_str()
                                    .unwrap_or("")
                                    .trim()
                                    .to_string());
                            }
                        }
                    }
                }
                // Or endpoint might be an OpenAI-compatible local server (/v1/chat/completions)
                if let Ok(ans) = call_openai_compatible_endpoint(
                    &client,
                    &format!("{endpoint}/v1"),
                    &model,
                    system_prompt,
                    user_prompt,
                )
                .await
                {
                    return Ok(ans);
                }
            }

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
    template_id: Option<&str>,
) -> Result<(String, Vec<String>, Vec<ActionItem>), String> {
    let tpl = template_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if settings.active_template_id.trim().is_empty() {
                "standard"
            } else {
                settings.active_template_id.trim()
            }
        });
    let custom_preset_instruction = settings
        .summary_presets
        .iter()
        .find(|p| p.id == tpl)
        .filter(|p| !p.prompt.trim().is_empty())
        .map(|p| {
            let name = if p.name.trim().is_empty() {
                "カスタム"
            } else {
                p.name.trim()
            };
            format!("【{name}テンプレート】{}", p.prompt.trim())
        });
    let tpl_instruction = custom_preset_instruction.unwrap_or_else(|| match tpl {
        "1on1" => "【1on1・面談テンプレート】summaryフィールドには「## 相手の状況・共有事項」「## 課題・フィードバック」「## 次回までの目標・アクション」の見出しを使って整理してください。".to_string(),
        "lecture" => "【講義・セミナーテンプレート】summaryフィールドには「## テーマ・重要概念」「## 講義の要点まとめ」「## 疑問点・復習ポイント」の見出しを使って整理してください。".to_string(),
        "brainstorm" => "【ブレスト・アイデアテンプレート】summaryフィールドには「## 提案されたアイデア一覧」「## 有望案と優先度」「## 次の検証ステップ」の見出しを使って整理してください。".to_string(),
        _ => "【標準議事録テンプレート】summaryフィールドには「## 概要」「## 議論の要点」「## 今後の進め方」の見出しを使って整理してください。".to_string(),
    });
    let sys = format!(
        "あなたは正確な議事録・ノート要約アシスタントです。与えられた文字起こしとメモのみを根拠にし、会話にない事実を推測で補わないでください。{tpl_instruction} 必ずJSONのみで返答し、summaryフィールドは見出し(## )や箇条書き(- )、太字(**強調**)を用いた読みやすいMarkdown記事形式で記述してください: {{\"summary\": \"## 概要\\n...\\n\\n## 要点\\n- ...\", \"decisions\": [\"...\"], \"action_items\": [{{\"text\": \"...\", \"assignee\": \"...\"}}]}}"
    );
    let user = note_context_text(note);
    let raw = call_llm(settings, &sys, &user).await?;
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

pub async fn live_assist_note(
    settings: &AppSettings,
    note: &Note,
    live_segments: &[TranscriptSegment],
) -> Result<LiveAssistResult, String> {
    let mut temp_note = note.clone();
    if !live_segments.is_empty() {
        temp_note.segments.extend_from_slice(live_segments);
    }

    if settings.llm_provider != "none" && !settings.llm_provider.trim().is_empty() {
        let sys = "あなたは会議中のリアルタイムAIファシリテーターです。ここまでの文字起こしとメモから、1) ここまでの要点（最大3項目、各1行）、2) 次に確認・質問すべき論点（最大3項目、各1行）をJSON形式のみで出力してください: {\"summary_points\": [\"...\"], \"next_questions\": [\"...\"]}";
        let user = note_context_text(&temp_note);
        if let Ok(raw) = call_llm(settings, sys, &user).await {
            let cleaned = raw
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();
            if let Ok(v) = serde_json::from_str::<Value>(cleaned) {
                let summary_points: Vec<String> = v["summary_points"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                let next_questions: Vec<String> = v["next_questions"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                if !summary_points.is_empty() || !next_questions.is_empty() {
                    return Ok(LiveAssistResult {
                        summary_points,
                        next_questions,
                    });
                }
            }
        }
    }

    // Fallback heuristic when LLM is off or unavailable
    let recent: Vec<String> = temp_note
        .segments
        .iter()
        .rev()
        .take(3)
        .rev()
        .map(|s| {
            let sp = if s.speaker.trim().is_empty() {
                "発言"
            } else {
                s.speaker.trim()
            };
            format!("[{}] {}: {}", format_ms(s.start_ms), sp, s.text)
        })
        .collect();
    let summary_points = if recent.is_empty() {
        vec!["まだ文字起こしセグメントがありません。録音を続けると直近の要点が表示されます。".to_string()]
    } else {
        recent
    };
    let next_questions = vec![
        "ここまでの決定事項と保留事項の切り分けは完了していますか？".to_string(),
        "次のアクションアイテムの担当者と期限は明確になっていますか？".to_string(),
        "反対意見やリスク・懸念点で未解消のものはありませんか？".to_string(),
    ];
    Ok(LiveAssistResult {
        summary_points,
        next_questions,
    })
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

fn build_local_fallback_answer(
    notes: &[Note],
    question: &str,
    citations: &[ChatCitation],
    notice: Option<&str>,
) -> String {
    let mut lines = Vec::new();
    if let Some(msg) = notice {
        lines.push(format!("※ {msg}\n"));
    }
    if notes.is_empty() {
        lines.push("選択されたスペースにノートがまだありません。".to_string());
        return lines.join("\n");
    }
    if citations.is_empty() {
        lines.push(format!(
            "「{}」に関連するノート（全{}件）を検索しましたが、一致する発言やメモが見つかりませんでした。",
            question,
            notes.len()
        ));
    } else {
        lines.push(format!(
            "ローカル検索で関連する箇所が {} 件見つかりました:",
            citations.len()
        ));
        for (idx, c) in citations.iter().enumerate() {
            lines.push(format!(
                "- **{}** [{}]: {} [{}]",
                c.note_title, c.timestamp, c.excerpt, idx + 1
            ));
        }
    }
    lines.join("\n")
}

fn strip_html_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut inside = false;
    for ch in raw.chars() {
        if ch == '<' {
            inside = true;
            out.push(' ');
        } else if ch == '>' {
            inside = false;
        } else if !inside {
            out.push(ch);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_sentence_excerpt(text: &str, query_lower: &str) -> String {
    let clean = strip_html_tags(text);
    let sentences: Vec<&str> = clean
        .split(['。', '！', '？', '\n'])
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let terms: Vec<&str> = query_lower
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .collect();
    if !terms.is_empty() {
        for s in &sentences {
            let s_low = s.to_lowercase();
            if terms.iter().any(|w| s_low.contains(w)) {
                let mut res: String = s.chars().take(200).collect();
                if !res.ends_with('。') {
                    res.push('。');
                }
                return res;
            }
        }
    }
    clean.chars().take(200).collect()
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct ChatActionSpec {
    #[serde(rename = "type")]
    pub kind: String,
    pub note_id: Option<String>,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub title: Option<String>,
    pub name: Option<String>,
    pub summary: Option<String>,
    pub manual_notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub from_speaker: Option<String>,
    pub to_speaker: Option<String>,
    pub text: Option<String>,
    pub assignee: Option<String>,
}

fn extract_actions_and_clean_answer(raw: &str) -> (String, Vec<ChatActionSpec>) {
    let marker = "```notelet-actions";
    if let Some(start_idx) = raw.find(marker) {
        let after_marker = &raw[start_idx + marker.len()..];
        if let Some(end_rel) = after_marker.find("```") {
            let json_block = after_marker[..end_rel].trim();
            let specs = serde_json::from_str::<Vec<ChatActionSpec>>(json_block).unwrap_or_default();
            let before = raw[..start_idx].trim_end();
            let after = after_marker[end_rel + 3..].trim_start();
            let cleaned = if after.is_empty() {
                before.to_string()
            } else {
                format!("{before}\n\n{after}")
            };
            return (cleaned, specs);
        }
    }
    (raw.to_string(), Vec::new())
}

fn has_inline_citation_marker(text: &str, count: usize) -> bool {
    for i in 1..=count {
        if text.contains(&format!("[{i}]")) {
            return true;
        }
    }
    false
}

fn ensure_inline_citation_markers(answer: &str, citations: &[ChatCitation]) -> String {
    if citations.is_empty() || has_inline_citation_marker(answer, citations.len()) {
        return answer.to_string();
    }

    let mut out_lines = Vec::new();
    for line in answer.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("```") {
            out_lines.push(line.to_string());
            continue;
        }
        let line_low = trimmed.to_lowercase();
        let mut best_idx: Option<usize> = None;
        let mut best_score = 0usize;
        for (idx, c) in citations.iter().enumerate() {
            let mut score = 0usize;
            if !c.note_title.is_empty() && line_low.contains(&c.note_title.to_lowercase()) {
                score += 3;
            }
            for token in c.excerpt.split(|ch: char| ch.is_whitespace() || ch == '、' || ch == '。') {
                let t = token.trim().to_lowercase();
                if t.chars().count() >= 3 && line_low.contains(&t) {
                    score += 1;
                }
            }
            if score > best_score {
                best_score = score;
                best_idx = Some(idx);
            }
        }
        if let Some(idx) = best_idx {
            out_lines.push(format!("{line} [{}]", idx + 1));
        } else {
            out_lines.push(line.to_string());
        }
    }
    out_lines.join("\n")
}

fn parse_quoted_value(text: &str) -> Option<String> {
    for (open, close) in [('「', '」'), ('『', '』'), ('"', '"'), ('\'', '\'')] {
        if let Some(s) = text.find(open) {
            let rest = &text[s + open.len_utf8()..];
            if let Some(e) = rest.find(close) {
                let val = rest[..e].trim();
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

fn infer_local_chat_actions(notes: &[Note], folders: &[Folder], question: &str) -> Vec<ChatActionSpec> {
    let mut specs = Vec::new();
    let default_note_id = notes.first().map(|n| n.id.clone());
    let quoted = parse_quoted_value(question);

    if (question.contains("タイトル") || question.contains("名前"))
        && (question.contains("変更") || question.contains("訂正") || question.contains("直して") || question.contains("変えて"))
    {
        if let (Some(nid), Some(new_title)) = (default_note_id.clone(), quoted.clone()) {
            specs.push(ChatActionSpec {
                kind: "rename_note".into(),
                note_id: Some(nid),
                folder_id: None,
                folder_name: None,
                title: Some(new_title),
                name: None,
                summary: None,
                manual_notes: None,
                tags: None,
                from_speaker: None,
                to_speaker: None,
                text: None,
                assignee: None,
            });
        }
    } else if (question.contains("カテゴリ") || question.contains("フォルダ"))
        && (question.contains("作成") || question.contains("作って") || question.contains("追加"))
    {
        if let Some(fname) = quoted.clone() {
            specs.push(ChatActionSpec {
                kind: "create_folder".into(),
                note_id: None,
                folder_id: None,
                folder_name: Some(fname.clone()),
                title: None,
                name: Some(fname),
                summary: None,
                manual_notes: None,
                tags: None,
                from_speaker: None,
                to_speaker: None,
                text: None,
                assignee: None,
            });
        }
    } else if (question.contains("カテゴリ") || question.contains("フォルダ"))
        && (question.contains("移動") || question.contains("変更") || question.contains("移して"))
    {
        if let Some(nid) = default_note_id.clone() {
            let target_folder = quoted.clone().or_else(|| {
                folders
                    .iter()
                    .find(|f| question.contains(&f.name))
                    .map(|f| f.name.clone())
            });
            if let Some(fname) = target_folder {
                specs.push(ChatActionSpec {
                    kind: "move_note_folder".into(),
                    note_id: Some(nid),
                    folder_id: None,
                    folder_name: Some(fname),
                    title: None,
                    name: None,
                    summary: None,
                    manual_notes: None,
                    tags: None,
                    from_speaker: None,
                    to_speaker: None,
                    text: None,
                    assignee: None,
                });
            }
        }
    } else if question.contains("タグ") && (question.contains("追加") || question.contains("付けて")) {
        if let (Some(nid), Some(tag)) = (default_note_id.clone(), quoted.clone()) {
            specs.push(ChatActionSpec {
                kind: "add_tags".into(),
                note_id: Some(nid),
                folder_id: None,
                folder_name: None,
                title: None,
                name: None,
                summary: None,
                manual_notes: None,
                tags: Some(vec![tag]),
                from_speaker: None,
                to_speaker: None,
                text: None,
                assignee: None,
            });
        }
    }
    specs
}

fn is_greeting_or_trivial_query(question: &str) -> bool {
    let q = question.trim().to_lowercase();
    if q.is_empty() {
        return true;
    }
    let trivial = [
        "あ", "あー", "え", "お", "ん", "はい", "いいえ", "ok", "okay", "hi", "hello", "hey",
        "こんにちは", "こんばんは", "おはよう", "おはようございます", "ありがとう", "ありがとうございます",
        "よろしく", "お願いします", "テスト", "test",
    ];
    if trivial.contains(&q.as_str()) {
        return true;
    }
    q.chars().count() <= 2 && !q.contains('?') && !q.contains('？')
}

fn extract_thinking_and_clean(raw: &str) -> (Option<String>, String) {
    if let Some(start) = raw.find("<think>") {
        let after_start = &raw[start + "<think>".len()..];
        if let Some(end_rel) = after_start.find("</think>") {
            let thinking = after_start[..end_rel].trim().to_string();
            let before = raw[..start].trim_end();
            let after = after_start[end_rel + "</think>".len()..].trim_start();
            let cleaned = if before.is_empty() {
                after.to_string()
            } else if after.is_empty() {
                before.to_string()
            } else {
                format!("{before}\n\n{after}")
            };
            let opt = if thinking.is_empty() { None } else { Some(thinking) };
            return (opt, cleaned);
        }
    }
    (None, raw.to_string())
}

fn filter_and_renumber_used_citations(
    answer: &str,
    candidates: &[ChatCitation],
) -> (String, Vec<ChatCitation>) {
    if candidates.is_empty() {
        return (answer.to_string(), Vec::new());
    }
    // Scan [N] markers in order of appearance
    let mut used_indices: Vec<usize> = Vec::new();
    let bytes = answer.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b']' {
                if let Ok(num) = answer[i + 1..j].parse::<usize>() {
                    if num >= 1 && num <= candidates.len() && !used_indices.contains(&(num - 1)) {
                        used_indices.push(num - 1);
                    }
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }

    if used_indices.is_empty() {
        return (answer.to_string(), Vec::new());
    }

    let mut renumbered_citations = Vec::with_capacity(used_indices.len());
    let mut updated_answer = answer.to_string();
    // Replace via temporary placeholders to avoid collisions during renumbering
    for (new_idx, &old_idx) in used_indices.iter().enumerate() {
        let old_marker = format!("[{}]", old_idx + 1);
        let temp_marker = format!("__NOTELET_CITE_{}__", new_idx + 1);
        updated_answer = updated_answer.replace(&old_marker, &temp_marker);
        renumbered_citations.push(candidates[old_idx].clone());
    }
    for new_idx in 0..used_indices.len() {
        let temp_marker = format!("__NOTELET_CITE_{}__", new_idx + 1);
        let final_marker = format!("[{}]", new_idx + 1);
        updated_answer = updated_answer.replace(&temp_marker, &final_marker);
    }

    (updated_answer, renumbered_citations)
}

pub async fn chat_with_notes_and_actions(
    settings: &AppSettings,
    notes: &[Note],
    folders: &[Folder],
    question: &str,
) -> Result<(ChatAnswer, Vec<ChatActionSpec>), String> {
    let mut citations = Vec::new();
    let mut context = String::new();
    let q_lower = question.to_lowercase();
    let trivial_query = is_greeting_or_trivial_query(question);

    for note in notes.iter().take(16) {
        let note_title = if note.title.trim().is_empty() {
            "無題のノート".to_string()
        } else {
            note.title.clone()
        };
        let folder_name = folders
            .iter()
            .find(|f| f.id == note.folder_id)
            .map(|f| f.name.as_str())
            .unwrap_or("一般");
        context.push_str(&format!(
            "\n=== ノート: {} (ref:{}, カテゴリ: {}, タグ: [{}]) ===\n",
            note_title,
            note.id,
            folder_name,
            note.tags.join(", ")
        ));
        if !note.summary.trim().is_empty() {
            context.push_str(&format!("[要約] {}\n", note.summary.trim()));
            if !trivial_query
                && citations.len() < 8
                && q_lower
                    .split_whitespace()
                    .any(|w| !w.is_empty() && note.summary.to_lowercase().contains(w))
            {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title: note_title.clone(),
                    timestamp: "要約".to_string(),
                    excerpt: extract_sentence_excerpt(&note.summary, &q_lower),
                });
            }
        }
        if !note.manual_notes.trim().is_empty() {
            let clean_memo = strip_html_tags(&note.manual_notes);
            context.push_str(&format!("[メモ] {}\n", clean_memo));
            if !trivial_query
                && citations.len() < 8
                && (q_lower
                    .split_whitespace()
                    .any(|w| !w.is_empty() && clean_memo.to_lowercase().contains(w))
                    || note.segments.is_empty())
            {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title: note_title.clone(),
                    timestamp: "メモ".to_string(),
                    excerpt: extract_sentence_excerpt(&clean_memo, &q_lower),
                });
            }
        }
        for seg in &note.segments {
            let ts = format_ms(seg.start_ms);
            context.push_str(&format!("[{ts}] {}: {}\n", seg.speaker, seg.text));
            if !trivial_query
                && citations.len() < 8
                && (q_lower
                    .split_whitespace()
                    .any(|w| !w.is_empty() && seg.text.to_lowercase().contains(w))
                    || note.segments.len() <= 3)
            {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title: note_title.clone(),
                    timestamp: ts,
                    excerpt: extract_sentence_excerpt(&seg.text, &q_lower),
                });
            }
        }
    }

    if citations.is_empty() && !trivial_query {
        for note in notes.iter().take(4) {
            let note_title = if note.title.trim().is_empty() {
                "無題のノート".to_string()
            } else {
                note.title.clone()
            };
            if let Some(seg) = note.segments.first() {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title,
                    timestamp: format_ms(seg.start_ms),
                    excerpt: extract_sentence_excerpt(&seg.text, &q_lower),
                });
            } else if !note.summary.trim().is_empty() {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title,
                    timestamp: "要約".to_string(),
                    excerpt: extract_sentence_excerpt(&note.summary, &q_lower),
                });
            } else if !note.manual_notes.trim().is_empty() {
                citations.push(ChatCitation {
                    note_id: note.id.clone(),
                    note_title,
                    timestamp: "メモ".to_string(),
                    excerpt: extract_sentence_excerpt(&note.manual_notes, &q_lower),
                });
            }
        }
    }

    if settings.llm_provider == "none" || settings.llm_provider.trim().is_empty() {
        let specs = infer_local_chat_actions(notes, folders, question);
        if !specs.is_empty() {
            return Ok((
                ChatAnswer {
                    answer: "ご指示の内容を変更案として提示します。内容を確認して「承認」してください。".to_string(),
                    citations: Vec::new(),
                    actions: Vec::new(),
                    proposed_actions: Vec::new(),
                    thinking: Some("ユーザーの編集指示を解析し、承認待ちの変更案を作成しました。".to_string()),
                },
                specs,
            ));
        }
        if trivial_query {
            return Ok((
                ChatAnswer {
                    answer: "こんにちは！ノートの内容に関する質問や、タイトル・カテゴリ・タグの編集などをお気軽にご指示ください。".to_string(),
                    citations: Vec::new(),
                    actions: Vec::new(),
                    proposed_actions: Vec::new(),
                    thinking: Some("挨拶・短文のため引用検索はスキップしました。".to_string()),
                },
                Vec::new(),
            ));
        }
        let answer = build_local_fallback_answer(notes, question, &citations, None);
        let (final_answer, used_citations) = filter_and_renumber_used_citations(&answer, &citations);
        return Ok((
            ChatAnswer {
                answer: final_answer,
                citations: used_citations,
                actions: Vec::new(),
                proposed_actions: Vec::new(),
                thinking: Some(format!("ローカル検索を実行し、{}件の関連箇所を確認しました。", citations.len())),
            },
            specs,
        ));
    }

    let folder_list = folders
        .iter()
        .map(|f| format!("- {} (ref:{})", f.name, f.id))
        .collect::<Vec<_>>()
        .join("\n");
    let citation_list = if citations.is_empty() {
        "（引用候補なし）".to_string()
    } else {
        citations
            .iter()
            .enumerate()
            .map(|(i, c)| format!("[{}] {} ({}): {}", i + 1, c.note_title, c.timestamp, c.excerpt))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let sys = r#"あなたは Notelet の検索・編集エージェントアシスタントです。
以下のルールを厳密に守ってください：

1. **思考プロセスの出力**:
   回答の先頭に `<think>...</think>` タグを置き、その中に簡潔な思考プロセス（どのノート・情報を見てどう判断したか）を日本語で書いてください。その後にユーザー向けの回答を書いてください。

2. **内部IDを回答に出力しない**:
   回答本文や思考プロセスの中で、`ID: personal`、`フォルダID: personal`、`note-...`、`folder-...`、`ref:...` のようなシステム内部IDを絶対にユーザーに見せないでください。必ず人間が読むノートタイトルやカテゴリ名（例：「一般」「会議」）のみを使ってください。

3. **インライン引用印の付与（必要な場合のみ）**:
   ノートの具体的な事実・発言を引用して回答する場合のみ、根拠となった引用番号（`[1]`, `[2]` 等）を該当する文章や箇条書きの文末に付けてください。挨拶・一般的な会話・操作完了報告など、ノートの引用が不要な回答には `[1]` 等を一切付けないでください。

4. **Notelet データ操作アクション**:
   ユーザーからノートのタイトル訂正・カテゴリ（フォルダ）の作成/変更/移動/削除・タグ追加/削除・要約/メモの書き換え・話者名変更・アクション項目追加・ノート作成/削除などの操作依頼があった場合は、回答の最後に次のコードブロック形式で JSON アクション配列を出力してください（操作依頼がない場合は出力不要です）：
```notelet-actions
[
  {"type": "rename_note", "note_id": "対象ref", "title": "新しいタイトル"},
  {"type": "move_note_folder", "note_id": "対象ref", "folder_name": "カテゴリ名"},
  {"type": "create_folder", "name": "新しいカテゴリ名"},
  {"type": "rename_folder", "folder_id": "対象ref", "name": "新しいカテゴリ名"},
  {"type": "delete_folder", "folder_id": "対象ref"},
  {"type": "add_tags", "note_id": "対象ref", "tags": ["タグ1"]},
  {"type": "remove_tags", "note_id": "対象ref", "tags": ["タグ1"]},
  {"type": "update_summary", "note_id": "対象ref", "summary": "新しい要約"},
  {"type": "update_manual_notes", "note_id": "対象ref", "manual_notes": "新しいメモ"},
  {"type": "rename_speaker", "note_id": "対象ref", "from_speaker": "旧話者名", "to_speaker": "新話者名"},
  {"type": "add_action_item", "note_id": "対象ref", "text": "タスク内容", "assignee": "担当者"},
  {"type": "create_note", "title": "新規タイトル", "folder_name": "カテゴリ名", "summary": "要約"},
  {"type": "delete_note", "note_id": "対象ref"}
]
```"#;

    let user = format!(
        "質問・指示: {question}\n\n利用可能なカテゴリ:\n{folder_list}\n\n引用候補番号:\n{citation_list}\n\n参照ノート:\n{context}"
    );
    match call_llm(settings, sys, &user).await {
        Ok(raw_answer) => {
            let (thinking, without_think) = extract_thinking_and_clean(&raw_answer);
            let (clean_answer, specs) = extract_actions_and_clean_answer(&without_think);
            let annotated = if !trivial_query && specs.is_empty() && !citations.is_empty() {
                ensure_inline_citation_markers(&clean_answer, &citations)
            } else {
                clean_answer
            };
            let (final_answer, used_citations) = filter_and_renumber_used_citations(&annotated, &citations);
            Ok((
                ChatAnswer {
                    answer: final_answer,
                    citations: used_citations,
                    actions: Vec::new(),
                    proposed_actions: Vec::new(),
                    thinking,
                },
                specs,
            ))
        }
        Err(err) => {
            let specs = infer_local_chat_actions(notes, folders, question);
            let answer = build_local_fallback_answer(notes, question, &citations, Some(&err));
            let (final_answer, used_citations) = filter_and_renumber_used_citations(&answer, &citations);
            Ok((
                ChatAnswer {
                    answer: final_answer,
                    citations: used_citations,
                    actions: Vec::new(),
                    proposed_actions: Vec::new(),
                    thinking: Some("クラウドLLM接続に失敗したため、ローカル検索結果で回答を構成しました。".to_string()),
                },
                specs,
            ))
        }
    }
}

#[allow(dead_code)]
pub async fn chat_with_notes(
    settings: &AppSettings,
    notes: &[Note],
    question: &str,
) -> Result<ChatAnswer, String> {
    let (ans, _) = chat_with_notes_and_actions(settings, notes, &[], question).await?;
    Ok(ans)
}

pub async fn test_llm_connection(settings: &AppSettings) -> Result<String, String> {
    if settings.llm_provider == "none" || settings.llm_provider.trim().is_empty() {
        return Err("LLMプロバイダーが「利用しない」に設定されています。".to_string());
    }
    let reply = call_llm(
        settings,
        "Reply with OK only.",
        "ping",
    )
    .await?;
    let preview: String = reply.trim().chars().take(40).collect();
    Ok(format!("LLM ({}) への接続に成功しました: {preview}", settings.llm_provider))
}

