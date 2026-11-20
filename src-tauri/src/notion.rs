use crate::models::{AppSettings, Note, NotionSyncState, TranscriptSegment};
use crate::secrets;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

const NOTION_VERSION: &str = "2022-06-28";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionTarget {
    pub id: String,
    pub title: String,
    pub object_type: String, // "database" | "page"
    pub url: String,
}

pub fn is_connected() -> bool {
    secrets::has_secret("notion_access_token")
}

pub fn build_oauth_authorize_url(client_id: &str, redirect_uri: &str) -> String {
    format!(
        "https://api.notion.com/v1/oauth/authorize?client_id={}&response_type=code&owner=user&redirect_uri={}",
        urlencoding_simple(client_id),
        urlencoding_simple(redirect_uri)
    )
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub async fn exchange_oauth_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<String, String> {
    let auth = B64.encode(format!("{client_id}:{client_secret}"));
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.notion.com/v1/oauth/token")
        .header("Authorization", format!("Basic {auth}"))
        .header("Notion-Version", NOTION_VERSION)
        .json(&json!({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri
        }))
        .send()
        .await
        .map_err(|e| format!("Notion OAuth 通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("Notion OAuth トークン交換に失敗 ({s}): {b}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
    let token = v["access_token"]
        .as_str()
        .ok_or_else(|| "access_token が応答に含まれていません".to_string())?
        .to_string();
    secrets::set_secret("notion_access_token", &token)?;
    Ok(v["workspace_name"]
        .as_str()
        .unwrap_or("Notion ワークスペース")
        .to_string())
}

pub async fn search_targets(query: &str) -> Result<Vec<NotionTarget>, String> {
    let token = secrets::get_secret("notion_access_token")?
        .ok_or_else(|| "Notion が未接続です。設定からOAuth接続またはトークンを登録してください。".to_string())?;
    let client = reqwest::Client::new();
    let mut body = json!({ "page_size": 20 });
    if !query.trim().is_empty() {
        body["query"] = json!(query.trim());
    }
    let resp = client
        .post("https://api.notion.com/v1/search")
        .bearer_auth(token)
        .header("Notion-Version", NOTION_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Notion 検索通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("Notion 検索に失敗 ({s}): {b}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
    let mut out = Vec::new();
    if let Some(results) = v["results"].as_array() {
        for item in results {
            let obj_type = item["object"].as_str().unwrap_or("page").to_string();
            let id = item["id"].as_str().unwrap_or("").to_string();
            let url = item["url"].as_str().unwrap_or("").to_string();
            let title = if obj_type == "database" {
                item["title"][0]["plain_text"]
                    .as_str()
                    .unwrap_or("無題のデータベース")
                    .to_string()
            } else {
                item["properties"]["title"]["title"][0]["plain_text"]
                    .as_str()
                    .or_else(|| item["properties"]["Name"]["title"][0]["plain_text"].as_str())
                    .unwrap_or("無題のページ")
                    .to_string()
            };
            if !id.is_empty() {
                out.push(NotionTarget {
                    id,
                    title,
                    object_type: obj_type,
                    url,
                });
            }
        }
    }
    Ok(out)
}

fn format_ms(ms: u64) -> String {
    let sec = ms / 1000;
    format!("{:02}:{:02}", sec / 60, sec % 60)
}

fn strip_html_to_text(raw: &str) -> String {
    let mut s = raw
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n")
        .replace("</li>", "\n")
        .replace("<li>", "・")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(ch);
        }
    }
    s.clear();
    out.trim().to_string()
}

fn build_children_blocks(note: &Note, folder_name: &str) -> Vec<Value> {
    let mut blocks = Vec::new();

    // 0. スペース情報
    let space_label = if folder_name.trim().is_empty() {
        "一般"
    } else {
        folder_name.trim()
    };
    blocks.push(json!({
        "object": "block",
        "type": "paragraph",
        "paragraph": { "rich_text": [{ "type": "text", "text": { "content": format!("スペース: {space_label}") } }] }
    }));

    // 1. 要約
    blocks.push(json!({
        "object": "block",
        "type": "heading_2",
        "heading_2": { "rich_text": [{ "type": "text", "text": { "content": "要約" } }] }
    }));
    let summary_text = if note.summary.trim().is_empty() {
        "（要約なし）".to_string()
    } else {
        note.summary.trim().chars().take(1900).collect::<String>()
    };
    blocks.push(json!({
        "object": "block",
        "type": "paragraph",
        "paragraph": { "rich_text": [{ "type": "text", "text": { "content": summary_text } }] }
    }));

    // 2. メモ
    blocks.push(json!({
        "object": "block",
        "type": "heading_2",
        "heading_2": { "rich_text": [{ "type": "text", "text": { "content": "メモ" } }] }
    }));
    let clean_memo = strip_html_to_text(&note.manual_notes);
    let memo_text = if clean_memo.is_empty() {
        "（メモなし）".to_string()
    } else {
        clean_memo.chars().take(1900).collect::<String>()
    };
    blocks.push(json!({
        "object": "block",
        "type": "paragraph",
        "paragraph": { "rich_text": [{ "type": "text", "text": { "content": memo_text } }] }
    }));

    // 3. 文字起こし
    blocks.push(json!({
        "object": "block",
        "type": "heading_2",
        "heading_2": { "rich_text": [{ "type": "text", "text": { "content": "文字起こし" } }] }
    }));
    if note.segments.is_empty() {
        blocks.push(json!({
            "object": "block",
            "type": "paragraph",
            "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "（文字起こしなし）" } }] }
        }));
    } else {
        for seg in note.segments.iter().take(60) {
            let line = if seg.speaker.trim().is_empty() {
                format!("[{}] {}", format_ms(seg.start_ms), seg.text)
            } else {
                format!("[{}] {}: {}", format_ms(seg.start_ms), seg.speaker, seg.text)
            };
            blocks.push(json!({
                "object": "block",
                "type": "paragraph",
                "paragraph": { "rich_text": [{ "type": "text", "text": { "content": line.chars().take(1900).collect::<String>() } }] }
            }));
        }
    }
    blocks
}

async fn resolve_db_title_prop(client: &reqwest::Client, token: &str, settings: &AppSettings) -> String {
    let mut resolved = settings.notion_mapping.title_prop.clone();
    if settings.notion_target_type != "database" {
        return resolved;
    }
    let db_url = format!("https://api.notion.com/v1/databases/{}", settings.notion_target_id);
    if let Ok(db_resp) = client
        .get(&db_url)
        .bearer_auth(token)
        .header("Notion-Version", NOTION_VERSION)
        .send()
        .await
    {
        if let Ok(db_json) = db_resp.json::<Value>().await {
            if let Some(props) = db_json["properties"].as_object() {
                for (prop_name, prop_val) in props {
                    if prop_val["type"].as_str() == Some("title") {
                        resolved = prop_name.clone();
                        break;
                    }
                }
            }
        }
    }
    resolved
}

pub async fn save_note_to_notion(
    note: &Note,
    folder_name: &str,
    settings: &AppSettings,
) -> Result<(String, String, String), String> {
    let token = secrets::get_secret("notion_access_token")?
        .ok_or_else(|| "Notion が未接続です。設定＞Notion連携から接続してください。".to_string())?;
    if settings.notion_target_id.trim().is_empty() {
        return Err("Notion の保存先ページまたはデータベースが未選択です。".to_string());
    }

    let client = reqwest::Client::new();
    let title_text = if note.title.trim().is_empty() {
        "無題のノート"
    } else {
        note.title.trim()
    };
    let title_prop_name = resolve_db_title_prop(&client, &token, settings).await;

    // 既に notion_page_id がある場合は重複作成を防ぎ、既存ページのタイトルと3種ブロック（要約・メモ・文字起こし）を更新する
    if let Some(ref existing_page_id) = note.notion_sync.page_id {
        let page_url = format!("https://api.notion.com/v1/pages/{existing_page_id}");
        let resp = client
            .patch(&page_url)
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .json(&json!({
                "properties": {
                    &title_prop_name: {
                        "title": [{ "text": { "content": title_text } }]
                    }
                }
            }))
            .send()
            .await
            .map_err(|e| format!("Notion 更新通信エラー（ローカルに保持済み・再試行可能）: {e}"))?;

        if resp.status().is_success() {
            let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
            let url = v["url"].as_str().unwrap_or("").to_string();

            let blocks_url = format!("https://api.notion.com/v1/blocks/{existing_page_id}/children?page_size=100");
            if let Ok(list_resp) = client
                .get(&blocks_url)
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .send()
                .await
            {
                if let Ok(list_json) = list_resp.json::<Value>().await {
                    if let Some(results) = list_json["results"].as_array() {
                        for b in results {
                            if let Some(bid) = b["id"].as_str() {
                                let del_url = format!("https://api.notion.com/v1/blocks/{bid}");
                                let _ = client
                                    .delete(&del_url)
                                    .bearer_auth(&token)
                                    .header("Notion-Version", NOTION_VERSION)
                                    .send()
                                    .await;
                            }
                        }
                    }
                }
            }

            let children = build_children_blocks(note, folder_name);
            let append_url = format!("https://api.notion.com/v1/blocks/{existing_page_id}/children");
            let _ = client
                .patch(&append_url)
                .bearer_auth(&token)
                .header("Notion-Version", NOTION_VERSION)
                .json(&json!({ "children": children }))
                .send()
                .await;

            return Ok((existing_page_id.clone(), url, Utc::now().to_rfc3339()));
        }
    }

    let parent = if settings.notion_target_type == "database" {
        json!({ "database_id": settings.notion_target_id })
    } else {
        json!({ "page_id": settings.notion_target_id })
    };

    let mut properties = json!({
        &title_prop_name: {
            "title": [{ "text": { "content": title_text } }]
        }
    });

    if settings.notion_target_type == "database" {
        if !settings.notion_mapping.summary_prop.is_empty() && !note.summary.is_empty() {
            properties[&settings.notion_mapping.summary_prop] = json!({
                "rich_text": [{ "text": { "content": note.summary.chars().take(1900).collect::<String>() } }]
            });
        }
        if !settings.notion_mapping.date_prop.is_empty() && !note.created_at.is_empty() {
            properties[&settings.notion_mapping.date_prop] = json!({
                "date": { "start": note.created_at }
            });
        }
    }

    let children = build_children_blocks(note, folder_name);
    let payload = json!({
        "parent": parent,
        "properties": properties,
        "children": children
    });

    let mut resp = client
        .post("https://api.notion.com/v1/pages")
        .bearer_auth(&token)
        .header("Notion-Version", NOTION_VERSION)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Notion 保存通信エラー（ノートはローカルに安全に保持されています）: {e}"))?;

    // DB側のプロパティ名が一致しない(400)場合は、DBスキーマから実際のtitleプロパティ名（例: 名前 / Name）を取得して再試行
    if resp.status() == reqwest::StatusCode::BAD_REQUEST && settings.notion_target_type == "database" {
        let mut resolved_title_prop = settings.notion_mapping.title_prop.clone();
        let db_url = format!("https://api.notion.com/v1/databases/{}", settings.notion_target_id);
        if let Ok(db_resp) = client
            .get(&db_url)
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .send()
            .await
        {
            if let Ok(db_json) = db_resp.json::<Value>().await {
                if let Some(props) = db_json["properties"].as_object() {
                    for (prop_name, prop_val) in props {
                        if prop_val["type"].as_str() == Some("title") {
                            resolved_title_prop = prop_name.clone();
                            break;
                        }
                    }
                }
            }
        }
        let fallback_payload = json!({
            "parent": parent,
            "properties": {
                resolved_title_prop: {
                    "title": [{ "text": { "content": title_text } }]
                }
            },
            "children": children
        });
        resp = client
            .post("https://api.notion.com/v1/pages")
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .json(&fallback_payload)
            .send()
            .await
            .map_err(|e| format!("Notion 保存通信エラー: {e}"))?;
    }

    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("Notion 保存エラー ({s}): {b}"));
    }

    let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
    let page_id = v["id"].as_str().unwrap_or("").to_string();
    let url = v["url"].as_str().unwrap_or("").to_string();
    Ok((page_id, url, Utc::now().to_rfc3339()))
}

fn extract_rich_text(arr: Option<&Vec<Value>>) -> String {
    let Some(items) = arr else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|x| x["plain_text"].as_str())
        .collect::<Vec<_>>()
        .join("")
}

pub async fn pull_notes_from_notion(
    settings: &AppSettings,
) -> Result<Vec<(Note, String)>, String> {
    let token = secrets::get_secret("notion_access_token")?
        .ok_or_else(|| "Notion が未接続です。".to_string())?;
    if settings.notion_target_id.trim().is_empty() || settings.notion_target_type != "database" {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::new();
    let query_url = format!(
        "https://api.notion.com/v1/databases/{}/query",
        settings.notion_target_id
    );
    let resp = client
        .post(&query_url)
        .bearer_auth(&token)
        .header("Notion-Version", NOTION_VERSION)
        .json(&json!({ "page_size": 50 }))
        .send()
        .await
        .map_err(|e| format!("Notion 読み込み通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("Notion データベース取得エラー ({s}): {b}"));
    }

    let v: Value = resp.json().await.map_err(|e| format!("応答解析失敗: {e}"))?;
    let mut out = Vec::new();
    let Some(pages) = v["results"].as_array() else {
        return Ok(out);
    };

    for page in pages {
        let page_id = page["id"].as_str().unwrap_or("").to_string();
        if page_id.is_empty() {
            continue;
        }
        let page_url = page["url"].as_str().unwrap_or("").to_string();
        let created_at = page["created_time"]
            .as_str()
            .unwrap_or(&Utc::now().to_rfc3339())
            .to_string();
        let updated_at = page["last_edited_time"]
            .as_str()
            .unwrap_or(&created_at)
            .to_string();

        let mut title = String::new();
        if let Some(props) = page["properties"].as_object() {
            for (_k, pv) in props {
                if pv["type"].as_str() == Some("title") {
                    title = extract_rich_text(pv["title"].as_array());
                    break;
                }
            }
        }
        if title.trim().is_empty() {
            title = "無題のノート".to_string();
        }

        let mut space_name = "一般".to_string();
        let mut summary = String::new();
        let mut manual_notes = String::new();
        let mut segments = Vec::new();

        let blocks_url = format!("https://api.notion.com/v1/blocks/{page_id}/children?page_size=100");
        if let Ok(b_resp) = client
            .get(&blocks_url)
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .send()
            .await
        {
            if let Ok(b_json) = b_resp.json::<Value>().await {
                if let Some(blocks) = b_json["results"].as_array() {
                    let mut section = "";
                    for b in blocks {
                        let btype = b["type"].as_str().unwrap_or("");
                        if btype == "heading_2" {
                            let h = extract_rich_text(b["heading_2"]["rich_text"].as_array());
                            if h.contains("要約") {
                                section = "summary";
                            } else if h.contains("メモ") {
                                section = "memo";
                            } else if h.contains("文字起こし") {
                                section = "transcript";
                            }
                            continue;
                        }
                        if btype == "paragraph" {
                            let text = extract_rich_text(b["paragraph"]["rich_text"].as_array());
                            let trimmed = text.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            if let Some(sp) = trimmed.strip_prefix("スペース:") {
                                let sp_trim = sp.trim();
                                if !sp_trim.is_empty() {
                                    space_name = sp_trim.to_string();
                                }
                                continue;
                            }
                            match section {
                                "summary" if trimmed != "（要約なし）" => {
                                    if !summary.is_empty() {
                                        summary.push('\n');
                                    }
                                    summary.push_str(trimmed);
                                }
                                "memo" if trimmed != "（メモなし）" && trimmed != "（手入力メモなし）" => {
                                    if !manual_notes.is_empty() {
                                        manual_notes.push_str("<br>");
                                    }
                                    manual_notes.push_str(trimmed);
                                }
                                "transcript" if trimmed != "（文字起こしなし）" => {
                                    let body = if let Some(rest) = trimmed.strip_prefix('[') {
                                        if let Some(pos) = rest.find(']') {
                                            rest[pos + 1..].trim()
                                        } else {
                                            trimmed
                                        }
                                    } else {
                                        trimmed
                                    };
                                    if !body.is_empty() {
                                        segments.push(TranscriptSegment {
                                            id: Uuid::new_v4().to_string(),
                                            start_ms: (segments.len() as u64) * 5000,
                                            end_ms: ((segments.len() as u64) + 1) * 5000,
                                            speaker: String::new(),
                                            text: body.to_string(),
                                        });
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        let note = Note {
            id: Uuid::new_v4().to_string(),
            title,
            created_at,
            updated_at,
            duration_sec: (segments.len() as u64) * 5,
            folder_id: "personal".to_string(),
            tags: Vec::new(),
            participants: Vec::new(),
            manual_notes,
            segments,
            summary,
            decisions: Vec::new(),
            action_items: Vec::new(),
            follow_up_draft: String::new(),
            asr_model_id: settings.active_asr_model_id.clone(),
            asr_provider_label: settings.active_asr_provider.clone(),
            language: settings.language.clone(),
            diarization_supported: false,
            notion_sync: NotionSyncState {
                page_id: Some(page_id),
                page_url: Some(page_url),
                database_id: Some(settings.notion_target_id.clone()),
                last_synced_at: Some(Utc::now().to_rfc3339()),
                status: "synced".to_string(),
                last_error: None,
            },
            audio_path: None,
            audio_encrypted: false,
        };
        out.push((note, space_name));
    }

    Ok(out)
}
