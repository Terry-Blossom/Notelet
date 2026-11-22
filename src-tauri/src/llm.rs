use crate::models::{
    ActionItem, AppSettings, ChatAnswer, ChatCitation, LiveAssistResult, Note, TranscriptSegment,
};
use crate::secrets;
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
        .header("HTTP-Referer", "https://github.com/otetcham/koenote")
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
    let tpl_instruction = match tpl {
        "1on1" => "【1on1・面談テンプレート】summaryフィールドには「## 相手の状況・共有事項」「## 課題・フィードバック」「## 次回までの目標・アクション」の見出しを使って整理してください。",
        "lecture" => "【講義・セミナーテンプレート】summaryフィールドには「## テーマ・重要概念」「## 講義の要点まとめ」「## 疑問点・復習ポイント」の見出しを使って整理してください。",
        "brainstorm" => "【ブレスト・アイデアテンプレート】summaryフィールドには「## 提案されたアイデア一覧」「## 有望案と優先度」「## 次の検証ステップ」の見出しを使って整理してください。",
        _ => "【標準議事録テンプレート】summaryフィールドには「## 概要」「## 議論の要点」「## 今後の進め方」の見出しを使って整理してください。",
    };
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
        for c in citations {
            lines.push(format!(
                "・{} [{}]: {}",
                c.note_title, c.timestamp, c.excerpt
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
        .split(|c| c == '。' || c == '！' || c == '？' || c == '\n')
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

pub async fn chat_with_notes(
    settings: &AppSettings,
    notes: &[Note],
    question: &str,
) -> Result<ChatAnswer, String> {
    let mut citations = Vec::new();
    let mut context = String::new();
    let q_lower = question.to_lowercase();

    for note in notes.iter().take(16) {
        let note_title = if note.title.trim().is_empty() {
            "無題のノート".to_string()
        } else {
            note.title.clone()
        };
        context.push_str(&format!("\n=== ノート: {} (ID: {}) ===\n", note_title, note.id));
        if !note.summary.trim().is_empty() {
            context.push_str(&format!("[要約] {}\n", note.summary.trim()));
            if citations.len() < 8
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
            if citations.len() < 8
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
            if citations.len() < 8
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

    if citations.is_empty() {
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
        let answer = build_local_fallback_answer(notes, question, &citations, None);
        return Ok(ChatAnswer { answer, citations });
    }

    let sys = "あなたはノート検索・質問応答アシスタントです。与えられたノートの記録だけに基づいて、見出し(## や ###)・箇条書き(- )・太字(**...**)を使った読みやすいMarkdown記事形式で回答してください。記録にない情報は「記録に見当たりません」と答え、推測で補わないでください。各情報の根拠となった引用元ノート名・タイムスタンプ・該当する元の文章を「> 『該当する文章』（出典: ノート名 [MM:SS]）」のように文章レベルで明記してください。";
    let user = format!("質問: {question}\n\n参照ノート:\n{context}");
    match call_llm(settings, sys, &user).await {
        Ok(answer) => Ok(ChatAnswer { answer, citations }),
        Err(err) => {
            let answer = build_local_fallback_answer(notes, question, &citations, Some(&err));
            Ok(ChatAnswer { answer, citations })
        }
    }
}
