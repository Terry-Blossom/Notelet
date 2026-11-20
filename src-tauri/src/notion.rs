use crate::models::{AppSettings, Note};
use crate::secrets;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

fn build_children_blocks(note: &Note) -> Vec<Value> {
    let mut blocks = Vec::new();

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
            let line = format!("[{}] {}: {}", format_ms(seg.start_ms), seg.speaker, seg.text);
            blocks.push(json!({
                "object": "block",
                "type": "paragraph",
                "paragraph": { "rich_text": [{ "type": "text", "text": { "content": line.chars().take(1900).collect::<String>() } }] }
            }));
        }
    }
    blocks
}

pub async fn save_note_to_notion(
    note: &Note,
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

    // 既に notion_page_id がある場合は重複作成を防ぎ、既存ページのタイトルと3種ブロック（要約・メモ・文字起こし）を更新する
    if let Some(ref existing_page_id) = note.notion_sync.page_id {
        let update_url = format!("https://api.notion.notion_api_placeholder");
        let _ = update_url;
        let page_url = format!("https://api.notion.com/v1/pages/{existing_page_id}");
        let resp = client
            .patch(&page_url)
            .bearer_auth(&token)
            .header("Notion-Version", NOTION_VERSION)
            .json(&json!({
                "properties": {
                    &settings.notion_mapping.title_prop: {
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

            // 既存の子ブロックを取得して削除し、最新の3セクション（要約・メモ・文字起こし）を上書き追加
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

            let children = build_children_blocks(note);
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
        &settings.notion_mapping.title_prop: {
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
        if !settings.notion_mapping.participants_prop.is_empty() && !note.participants.is_empty() {
            properties[&settings.notion_mapping.participants_prop] = json!({
                "rich_text": [{ "text": { "content": note.participants.join(", ") } }]
            });
        }
    }

    let children = build_children_blocks(note);
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

    // DB側のプロパティ名が一致しない(400)場合はタイトルのみでフォールバック再試行
    if resp.status() == reqwest::StatusCode::BAD_REQUEST && settings.notion_target_type == "database" {
        let fallback_payload = json!({
            "parent": parent,
            "properties": {
                &settings.notion_mapping.title_prop: {
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
