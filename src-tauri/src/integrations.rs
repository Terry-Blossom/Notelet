use crate::models::{AppSettings, CalendarEventMock, IntegrationAdapterInfo, Note, PlanTier};
use crate::secrets;
use serde_json::json;

pub fn list_adapters(settings: &AppSettings) -> Vec<IntegrationAdapterInfo> {
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
            status: "adapter_ready".into(),
            min_plan: PlanTier::Basic,
            description: format!(
                "ローカルノートをMCP経由で参照可能にする設定を生成します（現在の範囲: {}）。",
                settings.mcp_scope
            ),
            required_config: "MCP設定の有効化とクライアントへの登録".into(),
        },
        IntegrationAdapterInfo {
            id: "google_calendar".into(),
            name: "Google Calendar".into(),
            category: "カレンダー・会議前ブリーフ".into(),
            status: "unimplemented".into(),
            min_plan: PlanTier::Business,
            description: "予定と参加者を取得して会議前ブリーフを作成するためのアダプター枠。OAuth実装は未接続です。".into(),
            required_config: "Google OAuth Client ID / Secret（未設定）".into(),
        },
        IntegrationAdapterInfo {
            id: "outlook_calendar".into(),
            name: "Outlook / Microsoft 365".into(),
            category: "カレンダー・メール".into(),
            status: "unimplemented".into(),
            min_plan: PlanTier::Business,
            description: "Microsoft Graph API 連携用アダプター枠（未接続）。".into(),
            required_config: "Azure AD アプリ登録（未設定）".into(),
        },
        IntegrationAdapterInfo {
            id: "crm_suite".into(),
            name: "HubSpot / Attio / Affinity / Salesforce".into(),
            category: "CRM".into(),
            status: "unimplemented".into(),
            min_plan: PlanTier::Business,
            description: "商談・コンタクトへの議事録同期用アダプター枠（未実装）。汎用Webhook経由での連携が可能です。".into(),
            required_config: "各CRMのOAuthアプリ（未実装）".into(),
        },
        IntegrationAdapterInfo {
            id: "pm_suite".into(),
            name: "Asana / ClickUp / GitHub / Jira / Linear / Monday.com / Trello".into(),
            category: "タスク・開発管理".into(),
            status: "unimplemented".into(),
            min_plan: PlanTier::Business,
            description: "アクション項目をIssue/タスクとして起票するアダプター枠（未実装）。".into(),
            required_config: "各サービスのAPIトークン（未実装）".into(),
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
    if url.trim().is_empty() {
        return Err("Webhook URL が設定されていません。".to_string());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(url.trim())
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
    let scope_note = match settings.plan_tier {
        PlanTier::Basic => "personal_30d (本人の直近30日のみ)",
        PlanTier::Business => "workspace (本人および共有ワークスペース)",
        PlanTier::Enterprise => &settings.mcp_scope,
    };
    serde_json::to_string_pretty(&json!({
        "mcpServers": {
            "koenote": {
                "command": "koenote-mcp",
                "args": ["--data-dir", crate::storage::app_data_dir(), "--scope", scope_note],
                "note": "ローカルデータディレクトリを読み取る読み取り専用MCPサーバー設定例（専用MCPバイナリは今後同梱予定）"
            }
        }
    }))
    .unwrap_or_default()
}

pub fn sample_calendar_notice() -> Vec<CalendarEventMock> {
    // 外部カレンダー未接続時は空を返し、UI側で未接続状態と手動ブリーフ作成を表示する
    Vec::new()
}
