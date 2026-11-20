use crate::secrets;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::process::Command;
use tauri::Emitter;

const GITHUB_REPO: &str = "otetcham/koenote";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub asset_name: Option<String>,
    pub download_url: Option<String>,
}

fn parse_semver(v: &str) -> (u64, u64, u64) {
    let cleaned = v.trim().trim_start_matches('v');
    let mut parts = cleaned.split('.').map(|s| {
        s.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .unwrap_or(0)
    });
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

pub async fn check_latest_release() -> Result<UpdateCheckResult, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent("KoeNote-Updater/0.1")
        .build()
        .map_err(|e| format!("HTTPクライアント初期化失敗: {e}"))?;

    let mut req = client.get(format!(
        "https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    ));
    if let Ok(Some(token)) = secrets::get_secret("github_update_token") {
        if !token.trim().is_empty() {
            req = req.bearer_auth(token.trim());
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("GitHub リリース情報の取得に失敗しました: {e}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateCheckResult {
            current_version: current.clone(),
            latest_version: current,
            has_update: false,
            release_name: "公開リリースはまだありません".to_string(),
            release_notes: "GitHub Releases にリリースが公開されるとここから更新できます。".to_string(),
            release_url: format!("https://github.com/{GITHUB_REPO}/releases"),
            asset_name: None,
            download_url: None,
        });
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "GitHub API エラー ({status}): Private リポジトリの場合は更新用 GitHub Token を設定してください。{body}"
        ));
    }

    let v: Value = resp.json().await.map_err(|e| format!("JSON解析失敗: {e}"))?;
    let tag = v["tag_name"].as_str().unwrap_or(&current).to_string();
    let latest_clean = tag.trim_start_matches('v').to_string();
    let has_update = parse_semver(&latest_clean) > parse_semver(&current);

    let mut asset_name = None;
    let mut download_url = None;
    if let Some(assets) = v["assets"].as_array() {
        for a in assets {
            let name = a["name"].as_str().unwrap_or("");
            let url = a["browser_download_url"].as_str().unwrap_or("");
            let matches_os = if cfg!(windows) {
                name.ends_with("-setup.exe") || name.ends_with(".msi") || name == "koenote.exe"
            } else if cfg!(target_os = "macos") {
                name.ends_with(".dmg")
            } else {
                name.ends_with(".AppImage") || name.ends_with(".deb")
            };
            if matches_os && !url.is_empty() {
                asset_name = Some(name.to_string());
                download_url = Some(url.to_string());
                if name.ends_with("-setup.exe") || name.ends_with(".dmg") {
                    break;
                }
            }
        }
    }

    Ok(UpdateCheckResult {
        current_version: current,
        latest_version: latest_clean,
        has_update,
        release_name: v["name"].as_str().unwrap_or(&tag).to_string(),
        release_notes: v["body"].as_str().unwrap_or("").to_string(),
        release_url: v["html_url"]
            .as_str()
            .unwrap_or(&format!("https://github.com/{GITHUB_REPO}/releases"))
            .to_string(),
        asset_name,
        download_url,
    })
}

pub async fn download_and_launch_update(
    app: &tauri::AppHandle,
    download_url: &str,
    asset_name: &str,
) -> Result<String, String> {
    let update_dir = storage::app_data_dir().join("updates");
    fs::create_dir_all(&update_dir).map_err(|e| format!("更新フォルダ作成失敗: {e}"))?;
    let dest = update_dir.join(asset_name);
    let tmp = update_dir.join(format!("{asset_name}.part"));

    let client = reqwest::Client::builder()
        .user_agent("KoeNote-Updater/0.1")
        .build()
        .map_err(|e| format!("HTTPクライアント初期化失敗: {e}"))?;
    let mut req = client.get(download_url);
    if let Ok(Some(token)) = secrets::get_secret("github_update_token") {
        if !token.trim().is_empty() {
            req = req.bearer_auth(token.trim());
        }
    }
    let mut resp = req
        .send()
        .await
        .map_err(|e| format!("インストーラのダウンロードに失敗: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ダウンロードエラー: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(10 * 1024 * 1024);
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&tmp).map_err(|e| format!("ファイル作成失敗: {e}"))?;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("受信エラー: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("書き込み失敗: {e}"))?;
        downloaded += chunk.len() as u64;
        let pct = ((downloaded as f64 / total.max(1) as f64) * 100.0).min(100.0) as u8;
        let _ = app.emit("app-update-progress", serde_json::json!({ "progress": pct }));
    }
    drop(file);
    fs::rename(&tmp, &dest).map_err(|e| format!("ファイル配置失敗: {e}"))?;

    if cfg!(windows) {
        if asset_name.ends_with(".msi") {
            Command::new("msiexec")
                .args(["/i", &dest.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("MSI インストーラ起動失敗: {e}"))?;
        } else {
            Command::new(&dest)
                .spawn()
                .map_err(|e| format!("インストーラ起動失敗: {e}"))?;
        }
        app.exit(0);
        Ok("インストーラを起動しました。".to_string())
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&dest)
            .spawn()
            .map_err(|e| format!("DMG を開けませんでした: {e}"))?;
        Ok("DMG を開きました。Applications フォルダへ上書きコピーしてください。".to_string())
    } else {
        Ok(format!("{} にダウンロードしました。", dest.display()))
    }
}
