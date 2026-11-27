use crate::secrets;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Emitter;

const GITHUB_REPO: &str = "Terry-Blossom/Notelet";
const MANUAL_UPDATE_ERR: &str = "この形式（deb など）ではアプリ内で自動更新できません。リリースページから新しいパッケージを入れてください。";

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
    pub asset_sha256: Option<String>,
    pub install_kind: String,
    pub can_auto_install: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedAsset {
    pub name: String,
    pub download_url: String,
    pub sha256: Option<String>,
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

pub fn detect_linux_appimage_path(appimage_env: Option<&str>) -> Option<PathBuf> {
    let raw = appimage_env?.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

pub fn detect_install_kind(os: &str, appimage_env: Option<&str>) -> (&'static str, bool) {
    match os {
        "windows" => ("windows", true),
        "macos" => ("macos", true),
        "linux" => {
            if detect_linux_appimage_path(appimage_env).is_some() {
                ("appimage", true)
            } else {
                ("deb", false)
            }
        }
        _ => ("unknown", false),
    }
}

fn ensure_can_auto_install(os: &str, appimage_env: Option<&str>) -> Result<Option<PathBuf>, String> {
    match os {
        "windows" | "macos" => Ok(None),
        "linux" => {
            let path = detect_linux_appimage_path(appimage_env)
                .ok_or_else(|| MANUAL_UPDATE_ERR.to_string())?;
            Ok(Some(path))
        }
        _ => Err(
            "この環境ではアプリ内で自動更新できません。リリースページから手動で更新してください。"
                .to_string(),
        ),
    }
}

pub fn parse_sha256_digest(digest: Option<&str>) -> Option<String> {
    let raw = digest?.trim();
    let hex = raw
        .strip_prefix("sha256:")
        .or_else(|| raw.strip_prefix("SHA256:"))?;
    let hex = hex.trim();
    if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(hex.to_ascii_lowercase())
    } else {
        None
    }
}

fn asset_match_priority(name: &str, os: &str, arch: &str, install_kind: &str) -> Option<u8> {
    match os {
        "windows" => {
            if name.ends_with("-setup.exe") {
                Some(3)
            } else if name.ends_with(".msi") {
                Some(2)
            } else if name.eq_ignore_ascii_case("notelet.exe") {
                Some(1)
            } else {
                None
            }
        }
        "macos" => {
            if arch == "aarch64" {
                if name.ends_with("aarch64.dmg") {
                    Some(2)
                } else {
                    None
                }
            } else if name.ends_with("x64.dmg") || name.ends_with("x86_64.dmg") {
                Some(2)
            } else {
                None
            }
        }
        "linux" => match install_kind {
            "appimage" => match arch {
                "x86_64" => {
                    if name.ends_with("_linux_x86_64.AppImage") {
                        Some(2)
                    } else if name.ends_with("amd64.AppImage") {
                        Some(1)
                    } else {
                        None
                    }
                }
                "x86" => {
                    if name.ends_with("_linux_i386.AppImage") {
                        Some(2)
                    } else {
                        None
                    }
                }
                "aarch64" => {
                    if name.ends_with("_linux_aarch64.AppImage") {
                        Some(2)
                    } else if name.ends_with("aarch64.AppImage") {
                        Some(1)
                    } else {
                        None
                    }
                }
                _ => None,
            },
            "deb" => match arch {
                "x86_64" => {
                    if name.ends_with("_linux_x86_64.deb") {
                        Some(2)
                    } else if name.ends_with("amd64.deb") {
                        Some(1)
                    } else {
                        None
                    }
                }
                "aarch64" => {
                    if name.ends_with("_linux_aarch64.deb") {
                        Some(2)
                    } else if name.ends_with("arm64.deb") {
                        Some(1)
                    } else {
                        None
                    }
                }
                _ => None,
            },
            _ => None,
        },
        _ => None,
    }
}

pub fn select_release_asset(
    assets: &[Value],
    os: &str,
    arch: &str,
    install_kind: &str,
    use_api_url: bool,
) -> Option<SelectedAsset> {
    let mut best: Option<(u8, SelectedAsset)> = None;
    for a in assets {
        let name = a["name"].as_str().unwrap_or("");
        let url = if use_api_url {
            a["url"].as_str().unwrap_or("")
        } else {
            a["browser_download_url"].as_str().unwrap_or("")
        };
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let Some(priority) = asset_match_priority(name, os, arch, install_kind) else {
            continue;
        };
        let should_replace = best
            .as_ref()
            .is_none_or(|(best_prio, _)| priority > *best_prio);
        if should_replace {
            let sha256 = parse_sha256_digest(a["digest"].as_str());
            best = Some((
                priority,
                SelectedAsset {
                    name: name.to_string(),
                    download_url: url.to_string(),
                    sha256,
                },
            ));
        }
    }
    best.map(|(_, selected)| selected)
}

fn normalize_expected_sha256(expected: &str) -> Result<String, String> {
    let trimmed = expected.trim();
    let hex = trimmed
        .strip_prefix("sha256:")
        .or_else(|| trimmed.strip_prefix("SHA256:"))
        .unwrap_or(trimmed)
        .trim();
    if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(hex.to_ascii_lowercase())
    } else {
        Err(format!("無効な SHA-256 ダイジェスト形式です: {expected}"))
    }
}

pub fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("検証対象ファイルを開けませんでした: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("検証対象ファイルの読み込みに失敗しました: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        let _ = write!(&mut hex, "{byte:02x}");
    }
    Ok(hex)
}

pub fn verify_file_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let expected_hex = normalize_expected_sha256(expected)?;
    let actual_hex = compute_file_sha256(path)?;
    if actual_hex != expected_hex {
        return Err(format!(
            "ダウンロードファイルの SHA-256 が一致しません（期待値: {expected_hex}, 実際: {actual_hex}）。安全のため更新を中止しました。"
        ));
    }
    Ok(())
}

pub fn replace_appimage_file(
    downloaded_path: &Path,
    target_appimage_path: &Path,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    if let Some(expected) = expected_sha256.filter(|s| !s.trim().is_empty()) {
        verify_file_sha256(downloaded_path, expected)?;
    }

    let target_dir = target_appimage_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "AppImage の配置ディレクトリを特定できませんでした。".to_string())?;
    let file_name = target_appimage_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "AppImage のファイル名を特定できませんでした。".to_string())?;

    let staged_path = target_dir.join(format!(".{file_name}.new"));

    let copy_result = (|| -> std::io::Result<()> {
        let mut src = fs::File::open(downloaded_path)?;
        let mut dst = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&staged_path)?;
        std::io::copy(&mut src, &mut dst)?;
        dst.sync_all()?;
        Ok(())
    })();
    if let Err(e) = copy_result {
        let _ = fs::remove_file(&staged_path);
        return Err(format!(
            "{} に書き込めません。リリースページから手動で更新してください ({e})",
            target_dir.display()
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(&staged_path, fs::Permissions::from_mode(0o755)) {
            let _ = fs::remove_file(&staged_path);
            return Err(format!(
                "{} に書き込めません。リリースページから手動で更新してください ({e})",
                target_dir.display()
            ));
        }
    }

    if let Err(e) = fs::rename(&staged_path, target_appimage_path) {
        let _ = fs::remove_file(&staged_path);
        return Err(format!(
            "{} に書き込めません。リリースページから手動で更新してください ({e})",
            target_dir.display()
        ));
    }

    Ok(())
}

pub async fn check_latest_release() -> Result<UpdateCheckResult, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let appimage_env = std::env::var("APPIMAGE").ok();
    let (install_kind, can_auto_install) =
        detect_install_kind(std::env::consts::OS, appimage_env.as_deref());

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
            release_notes: "GitHub Releases にリリースが公開されるとここから更新できます。"
                .to_string(),
            release_url: format!("https://github.com/{GITHUB_REPO}/releases"),
            asset_name: None,
            download_url: None,
            asset_sha256: None,
            install_kind: install_kind.to_string(),
            can_auto_install,
        });
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "GitHub API エラー ({status}): Private リポジトリの場合は更新用 GitHub Token を設定してください。{body}"
        ));
    }

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON解析失敗: {e}"))?;
    let tag = v["tag_name"].as_str().unwrap_or(&current).to_string();
    let latest_clean = tag.trim_start_matches('v').to_string();
    let has_update = parse_semver(&latest_clean) > parse_semver(&current);

    let has_token = secrets::get_secret("github_update_token")
        .ok()
        .flatten()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);

    let selected = v["assets"].as_array().and_then(|assets| {
        select_release_asset(
            assets,
            std::env::consts::OS,
            std::env::consts::ARCH,
            install_kind,
            has_token,
        )
    });

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
        asset_name: selected.as_ref().map(|a| a.name.clone()),
        download_url: selected.as_ref().map(|a| a.download_url.clone()),
        asset_sha256: selected.and_then(|a| a.sha256),
        install_kind: install_kind.to_string(),
        can_auto_install,
    })
}

pub async fn download_and_launch_update(
    app: &tauri::AppHandle,
    download_url: &str,
    asset_name: &str,
    expected_sha256: Option<&str>,
) -> Result<String, String> {
    let appimage_env = std::env::var("APPIMAGE").ok();
    let current_appimage_path =
        ensure_can_auto_install(std::env::consts::OS, appimage_env.as_deref())?;

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
        return Err(
            "セキュリティ上、GitHub公式ドメイン以外の更新URLは許可されていません。".to_string(),
        );
    }
    let safe_asset_name = Path::new(asset_name)
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
        let _ = app.emit(
            "app-update-progress",
            serde_json::json!({ "progress": pct }),
        );
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
    } else if cfg!(target_os = "linux") {
        let target_appimage = current_appimage_path
            .ok_or_else(|| MANUAL_UPDATE_ERR.to_string())?;
        if let Err(err) = replace_appimage_file(&dest, &target_appimage, expected_sha256) {
            let _ = fs::remove_file(&dest);
            return Err(err);
        }
        let _ = fs::remove_file(&dest);

        crate::whisper_server::stop_server_sync();
        Command::new(&target_appimage)
            .env_remove("APPDIR")
            .env_remove("APPIMAGE")
            .env_remove("OWD")
            .env_remove("ARGV0")
            .spawn()
            .map_err(|e| format!("新しい AppImage の起動に失敗しました: {e}"))?;
        app.exit(0);
        Ok("更新しました。再起動します。".to_string())
    } else {
        Ok(format!("{} にダウンロードしました。", dest.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notelet_updater_test_{}_{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn detects_linux_appimage_vs_deb_install_kind() {
        let dir = make_temp_dir("detect_kind");
        let appimage = dir.join("Notelet.AppImage");
        fs::write(&appimage, b"dummy").expect("write dummy appimage");

        assert_eq!(
            detect_install_kind("linux", Some(&appimage.to_string_lossy())),
            ("appimage", true)
        );
        assert_eq!(detect_install_kind("linux", None), ("deb", false));
        assert_eq!(detect_install_kind("linux", Some("")), ("deb", false));
        assert_eq!(
            detect_install_kind("linux", Some(&dir.join("missing.AppImage").to_string_lossy())),
            ("deb", false)
        );
        // Directory path is not an AppImage file
        assert_eq!(
            detect_install_kind("linux", Some(&dir.to_string_lossy())),
            ("deb", false)
        );
        assert_eq!(detect_install_kind("windows", None), ("windows", true));
        assert_eq!(detect_install_kind("macos", None), ("macos", true));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_can_auto_install_blocks_non_appimage_linux() {
        let err = ensure_can_auto_install("linux", None).unwrap_err();
        assert!(err.contains("自動更新できません"));

        assert!(ensure_can_auto_install("windows", None).is_ok());
        assert!(ensure_can_auto_install("macos", None).is_ok());
    }

    #[test]
    fn selects_linux_appimage_and_never_deb_regardless_of_order() {
        let appimage_sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let deb_sha = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
        let assets = vec![
            json!({
                "name": "Notelet_0.18.0_linux_x86_64.AppImage",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_linux_x86_64.AppImage",
                "url": "https://api.github.com/repos/Terry-Blossom/Notelet/releases/assets/1",
                "digest": format!("sha256:{appimage_sha}")
            }),
            json!({
                "name": "Notelet_0.18.0_linux_x86_64.deb",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_linux_x86_64.deb",
                "url": "https://api.github.com/repos/Terry-Blossom/Notelet/releases/assets/2",
                "digest": format!("sha256:{deb_sha}")
            }),
            json!({
                "name": "Notelet_0.18.0_windows_x64-setup.exe",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_windows_x64-setup.exe",
                "url": "https://api.github.com/repos/Terry-Blossom/Notelet/releases/assets/3"
            }),
        ];

        let selected =
            select_release_asset(&assets, "linux", "x86_64", "appimage", false).expect("selected");
        assert_eq!(selected.name, "Notelet_0.18.0_linux_x86_64.AppImage");
        assert_eq!(selected.sha256.as_deref(), Some(appimage_sha));

        // API URL when token is used
        let selected_api =
            select_release_asset(&assets, "linux", "x86_64", "appimage", true).expect("selected");
        assert_eq!(
            selected_api.download_url,
            "https://api.github.com/repos/Terry-Blossom/Notelet/releases/assets/1"
        );

        // If only deb exists, appimage mode must return None (never pick deb)
        let deb_only = vec![assets[1].clone()];
        assert!(select_release_asset(&deb_only, "linux", "x86_64", "appimage", false).is_none());

        // deb install kind picks deb
        let selected_deb =
            select_release_asset(&assets, "linux", "x86_64", "deb", false).expect("deb");
        assert_eq!(selected_deb.name, "Notelet_0.18.0_linux_x86_64.deb");
        assert_eq!(selected_deb.sha256.as_deref(), Some(deb_sha));
    }

    #[test]
    fn selects_arch_specific_linux_windows_and_macos_assets() {
        let assets = vec![
            json!({
                "name": "Notelet_0.18.0_linux_i386.AppImage",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_linux_i386.AppImage"
            }),
            json!({
                "name": "Notelet_0.18.0_linux_aarch64.AppImage",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_linux_aarch64.AppImage"
            }),
            json!({
                "name": "Notelet_0.18.0_macos_aarch64.dmg",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_macos_aarch64.dmg"
            }),
            json!({
                "name": "Notelet_0.18.0_macos_x64.dmg",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_macos_x64.dmg"
            }),
            json!({
                "name": "Notelet_0.18.0_windows_x64.msi",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_windows_x64.msi"
            }),
            json!({
                "name": "Notelet_0.18.0_windows_x64-setup.exe",
                "browser_download_url": "https://github.com/Terry-Blossom/Notelet/releases/download/v0.18.0/Notelet_0.18.0_windows_x64-setup.exe"
            }),
        ];

        assert_eq!(
            select_release_asset(&assets, "linux", "x86", "appimage", false)
                .unwrap()
                .name,
            "Notelet_0.18.0_linux_i386.AppImage"
        );
        assert_eq!(
            select_release_asset(&assets, "linux", "aarch64", "appimage", false)
                .unwrap()
                .name,
            "Notelet_0.18.0_linux_aarch64.AppImage"
        );
        assert_eq!(
            select_release_asset(&assets, "macos", "aarch64", "macos", false)
                .unwrap()
                .name,
            "Notelet_0.18.0_macos_aarch64.dmg"
        );
        assert_eq!(
            select_release_asset(&assets, "macos", "x86_64", "macos", false)
                .unwrap()
                .name,
            "Notelet_0.18.0_macos_x64.dmg"
        );
        // -setup.exe has higher priority than .msi even when .msi comes first
        assert_eq!(
            select_release_asset(&assets, "windows", "x86_64", "windows", false)
                .unwrap()
                .name,
            "Notelet_0.18.0_windows_x64-setup.exe"
        );
    }

    #[test]
    fn replaces_appimage_atomically_with_exec_permissions_and_valid_sha256() {
        let dir = make_temp_dir("replace_ok");
        let target = dir.join("Notelet.AppImage");
        let downloaded = dir.join("downloaded.AppImage");
        fs::write(&target, b"old-binary-content").expect("write old");
        fs::write(&downloaded, b"new-binary-content").expect("write new");

        let expected_sha = compute_file_sha256(&downloaded).expect("sha");
        replace_appimage_file(&downloaded, &target, Some(&expected_sha))
            .expect("replace succeeds");

        assert_eq!(fs::read(&target).expect("read target"), b"new-binary-content");
        assert!(!dir.join(".Notelet.AppImage.new").exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&target).expect("meta").permissions().mode();
            assert_eq!(mode & 0o777, 0o755);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn aborts_replace_and_keeps_old_file_on_sha256_mismatch() {
        let dir = make_temp_dir("replace_mismatch");
        let target = dir.join("Notelet.AppImage");
        let downloaded = dir.join("downloaded.AppImage");
        fs::write(&target, b"old-binary-content").expect("write old");
        fs::write(&downloaded, b"tampered-content").expect("write new");

        let wrong_sha = "0000000000000000000000000000000000000000000000000000000000000000";
        let err = replace_appimage_file(&downloaded, &target, Some(wrong_sha)).unwrap_err();
        assert!(err.contains("SHA-256"));
        assert_eq!(fs::read(&target).expect("old remains"), b"old-binary-content");
        assert!(!dir.join(".Notelet.AppImage.new").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn returns_friendly_error_when_target_dir_is_not_writable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = make_temp_dir("replace_readonly");
        let target_dir = dir.join("ro");
        fs::create_dir_all(&target_dir).expect("mkdir");
        let target = target_dir.join("Notelet.AppImage");
        let downloaded = dir.join("downloaded.AppImage");
        fs::write(&target, b"old").expect("write old");
        fs::write(&downloaded, b"new").expect("write new");

        fs::set_permissions(&target_dir, fs::Permissions::from_mode(0o555)).expect("chmod 555");
        let res = replace_appimage_file(&downloaded, &target, None);
        // Restore permissions before assertions/cleanup
        let _ = fs::set_permissions(&target_dir, fs::Permissions::from_mode(0o755));

        // Note: when running tests as root, chmod 0555 may still be writable
        if is_non_root() {
            let err = res.unwrap_err();
            assert!(err.contains("に書き込めません"));
            assert!(err.contains("リリースページから手動で更新してください"));
            assert_eq!(fs::read(&target).expect("old remains"), b"old");
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    fn is_non_root() -> bool {
        // Check if running as non-root via /proc/self/status Uid line without needing libc crate
        fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("Uid:"))
                    .and_then(|l| l.split_whitespace().nth(2))
                    .map(|euid| euid != "0")
            })
            .unwrap_or(true)
    }
}
