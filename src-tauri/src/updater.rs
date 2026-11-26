use crate::secrets;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::process::Command;
use tauri::Emitter;

const GITHUB_REPO: &str = "Terry-Blossom/Notelet";

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
        .user_agent("Notelet-Updater/0.1")
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

    let has_token = secrets::get_secret("github_update_token")
        .ok()
        .flatten()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);

    let mut asset_name = None;
    let mut download_url = None;
    if let Some(assets) = v["assets"].as_array() {
        for a in assets {
            let name = a["name"].as_str().unwrap_or("");
            let url = if has_token {
                a["url"].as_str().unwrap_or("")
            } else {
                a["browser_download_url"].as_str().unwrap_or("")
            };
            let matches_os = if cfg!(windows) {
                name.ends_with("-setup.exe")
                    || name.ends_with(".msi")
                    || name.eq_ignore_ascii_case("notelet.exe")
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
    let parsed_url = reqwest::Url::parse(download_url.trim())
        .map_err(|_| "無効な更新ダウンロードURLです。".to_string())?;
    let host = parsed_url
        .host_str()
        .map(|h| h.to_ascii_lowercase())
        .unwrap_or_default();
    let is_github_host = parsed_url.scheme() == "https"
        && (host == "github.com"
            || host == "api.github.com"
            || host.ends_with(".githubusercontent.com"));
    if !is_github_host {
        return Err("セキュリティ上、GitHub公式ドメイン以外の更新URLは許可されていません。".to_string());
    }
    let safe_asset_name = std::path::Path::new(asset_name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && !n.contains(".."))
        .ok_or_else(|| "無効なアセットファイル名です。".to_string())?;

    let update_dir = storage::app_data_dir().join("updates");
    fs::create_dir_all(&update_dir).map_err(|e| format!("更新フォルダ作成失敗: {e}"))?;
    let dest = update_dir.join(safe_asset_name);
    let tmp = update_dir.join(format!("{safe_asset_name}.part"));

    let client = reqwest::Client::builder()
        .user_agent("Notelet-Updater/0.1")
        .build()
        .map_err(|e| format!("HTTPクライアント初期化失敗: {e}"))?;
    let mut req = client.get(parsed_url);
    if let Ok(Some(token)) = secrets::get_secret("github_update_token") {
        if !token.trim().is_empty() {
            req = req
                .bearer_auth(token.trim())
                .header("Accept", "application/octet-stream");
        }
    }
    let mut resp = req
        .send()
        .await
        .map_err(|e| format!("インストーラのダウンロードに失敗: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ダウンロードエラー: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
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
        let pct = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(99.0) as u8
        } else {
            ((downloaded / (1024 * 1024)).min(95)) as u8
        };
        let _ = app.emit("app-update-progress", serde_json::json!({ "progress": pct }));
    }
    drop(file);
    fs::rename(&tmp, &dest).map_err(|e| format!("ファイル配置失敗: {e}"))?;
    let _ = app.emit("app-update-progress", serde_json::json!({ "progress": 100 }));

    if cfg!(windows) {
        crate::whisper_server::stop_server_sync();
        if asset_name.ends_with(".msi") {
            Command::new("msiexec")
                .args(["/i", &dest.to_string_lossy(), "/passive", "/norestart"])
                .spawn()
                .map_err(|e| format!("MSI インストーラ起動失敗: {e}"))?;
        } else if asset_name.ends_with("-setup.exe") {
            // Wait briefly for current process lock release, run silent NSIS overwrite (/S), and relaunch
            let bat_path = update_dir.join("apply_update.cmd");
            let exe_path = std::env::current_exe()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let dest_str = dest.to_string_lossy().to_string();
            let script = format!(
                "@echo off\r\nping -n 3 127.0.0.1 > nul\r\n\"{dest_str}\" /S\r\nif exist \"{exe_path}\" start \"\" \"{exe_path}\"\r\n"
            );
            let _ = fs::write(&bat_path, script);
            Command::new("cmd")
                .args(["/C", "start", "/min", "", &bat_path.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("サイレント更新の起動失敗: {e}"))?;
        } else {
            Command::new(&dest)
                .spawn()
                .map_err(|e| format!("インストーラ起動失敗: {e}"))?;
        }
        app.exit(0);
        Ok("サイレント上書き更新を開始しました。完了後に自動で再起動します。".to_string())
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
