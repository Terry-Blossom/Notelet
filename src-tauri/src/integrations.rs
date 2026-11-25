use crate::models::{AppSettings, CalendarEventMock, IntegrationAdapterInfo, IssueCreateResult, Note, PlanTier};
use crate::secrets;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::json;

pub fn list_adapters(settings: &AppSettings) -> Vec<IntegrationAdapterInfo> {
    let calendar_ready = !settings.calendar_ics_url.trim().is_empty();
    let pm_ready = !settings.github_repo.trim().is_empty()
        || !settings.linear_team_id.trim().is_empty()
        || !settings.jira_project_key.trim().is_empty();

    vec![
        IntegrationAdapterInfo {
            id: "notion".into(),
            name: "Notion".into(),
            category: "ドキュメント・DB".into(),
            status: "implemented".into(),
            min_plan: PlanTier::Basic,
            description: "OAuth / トークン接続、DB・ページ選択、プロパティマッピング、重複防止保存に対応。".into(),
            required_config: "Notion OAuth または Integration Token".into(),
        },
        IntegrationAdapterInfo {
            id: "slack".into(),
            name: "Slack".into(),
            category: "チーム共有".into(),
            status: "implemented".into(),
            min_plan: PlanTier::Basic,
            description: "選択したノートや要約を Slack Incoming Webhook へ明示操作で共有します。".into(),
            required_config: "Slack Incoming Webhook URL".into(),
        },
        IntegrationAdapterInfo {
            id: "webhook".into(),
            name: "Zapier / 汎用 Webhook".into(),
            category: "自動化".into(),
            status: "implemented".into(),
            min_plan: PlanTier::Business,
            description: "ノートのJSONペイロードを任意のWebhookエンドポイントへ送信します。".into(),
            required_config: "Webhook URL".into(),
        },
        IntegrationAdapterInfo {
            id: "mcp".into(),
            name: "MCP (Claude / ChatGPT / Cursor)".into(),
            category: "AIツール連携".into(),
            status: "implemented".into(),
            min_plan: PlanTier::Basic,
            description: format!(
                "同梱の mcp-server/index.mjs 経由でローカルノートを検索・参照します（現在の範囲: {}）。",
                settings.mcp_scope
            ),
            required_config: "Node.js 18+ とクライアントへの設定登録".into(),
        },
        IntegrationAdapterInfo {
            id: "google_calendar".into(),
            name: "Google / Outlook Calendar (ICS)".into(),
            category: "カレンダー・会議前ブリーフ".into(),
            status: if calendar_ready { "implemented".into() } else { "adapter_ready".into() },
            min_plan: PlanTier::Business,
            description: "ICS（iCalendar）URL を購読し、直近の会議予定と参加者を取得します。".into(),
            required_config: "カレンダーの非公開 ICS URL".into(),
        },
        IntegrationAdapterInfo {
            id: "pm_suite".into(),
            name: "GitHub / Linear / Jira".into(),
            category: "タスク・開発管理".into(),
            status: if pm_ready { "implemented".into() } else { "adapter_ready".into() },
            min_plan: PlanTier::Business,
            description: "ノート内のアクション項目を GitHub Issue / Linear / Jira へワンクリック起票します。".into(),
            required_config: "各サービスの API トークンとリポジトリ/チーム/プロジェクト設定".into(),
        },
        IntegrationAdapterInfo {
            id: "docs_storage".into(),
            name: "Google Docs / Drive / OneDrive / OneNote / Gmail".into(),
            category: "ドキュメント・メール".into(),
            status: "unimplemented".into(),
            min_plan: PlanTier::Business,
            description: "外部ドキュメント・下書き連携用アダプター枠（未実装）。フォローアップメールはローカル下書き生成後にコピーして利用できます。".into(),
            required_config: "Google / Microsoft OAuth（未実装）".into(),
        },
    ]
}

pub async fn send_slack_share(note: &Note) -> Result<(), String> {
    let url = secrets::get_secret("slack_webhook_url")?
        .ok_or_else(|| "Slack Webhook URL が未設定です。設定＞連携から登録してください。".to_string())?;
    let mut text = format!("*{}*\n日時: {}", note.title, note.created_at);
    if !note.summary.is_empty() {
        text.push_str(&format!("\n\n*要約*\n{}", note.summary));
    }
    if !note.action_items.is_empty() {
        text.push_str("\n\n*アクション項目*");
        for a in &note.action_items {
            text.push_str(&format!("\n• {}", a.text));
        }
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .json(&json!({ "text": text }))
        .send()
        .await
        .map_err(|e| format!("Slack 送信エラー: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Slack Webhook エラー: HTTP {}", resp.status()));
    }
    Ok(())
}

pub async fn send_generic_webhook(note: &Note, url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Webhook URL が設定されていません。".to_string());
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "有効な http:// または https:// の Webhook URL を指定してください。".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Webhook URL は http:// または https:// のみ対応しています。".to_string());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(parsed)
        .json(note)
        .send()
        .await
        .map_err(|e| format!("Webhook 送信エラー: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Webhook エラー: HTTP {}", resp.status()));
    }
    Ok(())
}

pub fn build_mcp_config_preview(settings: &AppSettings) -> String {
    let scope_val = match settings.plan_tier {
        PlanTier::Basic => "personal_30d",
        PlanTier::Business => "workspace",
        PlanTier::Enterprise => settings.mcp_scope.as_str(),
    };
    let server_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("mcp-server").join("index.mjs")))
        .filter(|p| p.exists())
        .unwrap_or_else(|| std::path::PathBuf::from("mcp-server/index.mjs"));

    serde_json::to_string_pretty(&json!({
        "mcpServers": {
            "koenote": {
                "command": "node",
                "args": [
                    server_path,
                    "--data-dir",
                    crate::storage::app_data_dir(),
                    "--scope",
                    scope_val
                ]
            }
        }
    }))
    .unwrap_or_default()
}

pub fn sample_calendar_notice() -> Vec<CalendarEventMock> {
    Vec::new()
}

pub fn read_granola_local_cache() -> Result<String, String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(cfg) = dirs::config_dir() {
        candidates.push(cfg.join("Granola").join("cache-v3.json"));
        candidates.push(cfg.join("Granola").join("cache-v4.json"));
    }
    if let Some(data) = dirs::data_dir() {
        candidates.push(data.join("Granola").join("cache-v3.json"));
        candidates.push(data.join("Granola").join("cache-v4.json"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Library/Application Support/Granola/cache-v3.json"));
        candidates.push(home.join(".config/Granola/cache-v3.json"));
        candidates.push(home.join(".local/share/Granola/cache-v3.json"));
    }

    for path in &candidates {
        if path.exists() {
            return std::fs::read_to_string(path)
                .map_err(|e| format!("Granola キャッシュの読み込みに失敗 ({}): {e}", path.display()));
        }
    }

    Err(format!(
        "Granola のローカルキャッシュが見つかりませんでした。検索パス例: {}",
        candidates
            .first()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "Granola/cache-v3.json".to_string())
    ))
}

pub async fn fetch_granola_notes_api(api_key_override: Option<String>) -> Result<String, String> {
    let token = match api_key_override {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => secrets::get_secret("granola_api_key")?
            .ok_or_else(|| "Granola API キーが設定されていません。".to_string())?,
    };

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.granola.ai/v2/get-documents")
        .bearer_auth(&token)
        .header("Content-Type", "application/json")
        .json(&json!({ "limit": 100, "offset": 0, "include_last_viewed_panel": true }))
        .send()
        .await
        .map_err(|e| format!("Granola API 接続エラー: {e}"))?;

    if resp.status().is_success() {
        return resp
            .text()
            .await
            .map_err(|e| format!("Granola API 応答の読み取りに失敗: {e}"));
    }

    // Fallback to v1 GET endpoint
    let resp_v1 = client
        .get("https://api.granola.ai/v1/notes")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Granola API 接続エラー: {e}"))?;
    if !resp_v1.status().is_success() {
        let status = resp_v1.status();
        let body = resp_v1.text().await.unwrap_or_default();
        return Err(format!("Granola API エラー (HTTP {status}): {body}"));
    }
    resp_v1
        .text()
        .await
        .map_err(|e| format!("Granola API 応答の読み取りに失敗: {e}"))
}

fn parse_ics_datetime(raw: &str) -> String {
    let v = raw.trim().trim_end_matches('Z');
    // Format: YYYYMMDDTHHMMSS or YYYYMMDD
    if v.len() >= 15 && v.as_bytes().get(8) == Some(&b'T') {
        let iso = format!(
            "{}-{}-{}T{}:{}:{}{}",
            &v[0..4],
            &v[4..6],
            &v[6..8],
            &v[9..11],
            &v[11..13],
            &v[13..15],
            if raw.trim().ends_with('Z') { "Z" } else { "" }
        );
        return iso;
    }
    if v.len() >= 8 {
        return format!("{}-{}-{}", &v[0..4], &v[4..6], &v[6..8]);
    }
    raw.trim().to_string()
}

pub async fn fetch_ics_calendar_events(ics_url: &str) -> Result<Vec<CalendarEventMock>, String> {
    let url = ics_url.trim();
    if url.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("カレンダー ICS 取得エラー: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("カレンダー ICS エラー: HTTP {}", resp.status()));
    }
    let raw = resp
        .text()
        .await
        .map_err(|e| format!("カレンダー ICS 読み取りエラー: {e}"))?;

    // Unfold RFC 5545 folded lines
    let unfolded = raw.replace("\r\n ", "").replace("\r\n\t", "").replace("\n ", "");
    let mut events = Vec::new();
    let mut in_event = false;
    let mut uid = String::new();
    let mut title = String::new();
    let mut start = String::new();
    let mut end = String::new();
    let mut participants: Vec<String> = Vec::new();

    for line in unfolded.lines() {
        let trimmed = line.trim();
        if trimmed == "BEGIN:VEVENT" {
            in_event = true;
            uid.clear();
            title.clear();
            start.clear();
            end.clear();
            participants.clear();
            continue;
        }
        if trimmed == "END:VEVENT" {
            if in_event && !title.is_empty() {
                events.push(CalendarEventMock {
                    id: if uid.is_empty() {
                        format!("ics-{}", events.len() + 1)
                    } else {
                        uid.clone()
                    },
                    title: title.clone(),
                    start_time: start.clone(),
                    end_time: end.clone(),
                    participants: participants.clone(),
                    provider: "ICS".to_string(),
                });
            }
            in_event = false;
            continue;
        }
        if !in_event {
            continue;
        }

        if let Some((key_part, val)) = trimmed.split_once(':') {
            let key = key_part.split(';').next().unwrap_or(key_part).to_uppercase();
            match key.as_str() {
                "UID" => uid = val.trim().to_string(),
                "SUMMARY" => title = val.replace("\\,", ",").replace("\\n", " ").trim().to_string(),
                "DTSTART" => start = parse_ics_datetime(val),
                "DTEND" => end = parse_ics_datetime(val),
                "ATTENDEE" => {
                    let email = val.trim().trim_start_matches("mailto:").trim_start_matches("MAILTO:");
                    if !email.is_empty() {
                        participants.push(email.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    events.sort_by(|a, b| b.start_time.cmp(&a.start_time));
    events.truncate(20);
    Ok(events)
}

pub async fn create_issue_from_action(
    provider: &str,
    settings: &AppSettings,
    title: &str,
    body: &str,
) -> Result<IssueCreateResult, String> {
    let client = reqwest::Client::new();
    match provider {
        "github" => {
            let token = secrets::get_secret("github_issue_token")?
                .ok_or_else(|| "GitHub Issue トークンが設定されていません。設定＞連携から登録してください。".to_string())?;
            let repo = settings.github_repo.trim();
            if repo.is_empty() || !repo.contains('/') {
                return Err("GitHub リポジトリ (owner/repo) が設定されていません。".to_string());
            }
            let resp = client
                .post(format!("https://api.github.com/repos/{repo}/issues"))
                .header("User-Agent", "Notelet-Desktop")
                .bearer_auth(token)
                .json(&json!({ "title": title, "body": body }))
                .send()
                .await
                .map_err(|e| format!("GitHub Issue 作成エラー: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("GitHub API エラー (HTTP {status}): {txt}"));
            }
            let v: serde_json::Value = resp.json().await.map_err(|e| format!("GitHub 応答解析エラー: {e}"))?;
            Ok(IssueCreateResult {
                provider: "github".to_string(),
                key: format!("#{}", v["number"].as_u64().unwrap_or(0)),
                url: v["html_url"].as_str().unwrap_or_default().to_string(),
            })
        }
        "linear" => {
            let token = secrets::get_secret("linear_api_key")?
                .ok_or_else(|| "Linear API キーが設定されていません。設定＞連携から登録してください。".to_string())?;
            let team_id = settings.linear_team_id.trim();
            if team_id.is_empty() {
                return Err("Linear Team ID が設定されていません。".to_string());
            }
            let query = "mutation IssueCreate($teamId: String!, $title: String!, $description: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { identifier url } } }";
            let resp = client
                .post("https://api.linear.app/graphql")
                .header("Authorization", token)
                .json(&json!({
                    "query": query,
                    "variables": { "teamId": team_id, "title": title, "description": body }
                }))
                .send()
                .await
                .map_err(|e| format!("Linear Issue 作成エラー: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("Linear API エラー (HTTP {status}): {txt}"));
            }
            let v: serde_json::Value = resp.json().await.map_err(|e| format!("Linear 応答解析エラー: {e}"))?;
            let issue = &v["data"]["issueCreate"]["issue"];
            Ok(IssueCreateResult {
                provider: "linear".to_string(),
                key: issue["identifier"].as_str().unwrap_or("Linear").to_string(),
                url: issue["url"].as_str().unwrap_or_default().to_string(),
            })
        }
        "jira" => {
            let token = secrets::get_secret("jira_api_token")?
                .ok_or_else(|| "Jira API トークンが設定されていません。設定＞連携から登録してください。".to_string())?;
            let base = settings.jira_base_url.trim().trim_end_matches('/');
            let email = settings.jira_email.trim();
            let project = settings.jira_project_key.trim();
            if base.is_empty() || email.is_empty() || project.is_empty() {
                return Err("Jira の Base URL / Email / Project Key をすべて設定してください。".to_string());
            }
            let auth = B64.encode(format!("{email}:{token}"));
            let resp = client
                .post(format!("{base}/rest/api/3/issue"))
                .header("Authorization", format!("Basic {auth}"))
                .json(&json!({
                    "fields": {
                        "project": { "key": project },
                        "summary": title,
                        "issuetype": { "name": "Task" },
                        "description": {
                            "type": "doc",
                            "version": 1,
                            "content": [{
                                "type": "paragraph",
                                "content": [{ "type": "text", "text": body }]
                            }]
                        }
                    }
                }))
                .send()
                .await
                .map_err(|e| format!("Jira Issue 作成エラー: {e}"))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("Jira API エラー (HTTP {status}): {txt}"));
            }
            let v: serde_json::Value = resp.json().await.map_err(|e| format!("Jira 応答解析エラー: {e}"))?;
            let key = v["key"].as_str().unwrap_or("JIRA").to_string();
            Ok(IssueCreateResult {
                provider: "jira".to_string(),
                url: format!("{base}/browse/{key}"),
                key,
            })
        }
        _ => Err(format!("未対応の Issue プロバイダーです: {provider}")),
    }
}

