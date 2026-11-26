#[cfg(target_os = "linux")]
const APP_ICON_256_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");

/// Linux の AppImage 実行時（`APPIMAGE` 環境変数が設定されている場合）に、
/// アイコンと `.desktop` エントリを `~/.local/share/` 配下へ自動登録する。
pub fn ensure_appimage_desktop_integration_async() {
    #[cfg(target_os = "linux")]
    {
        std::thread::spawn(|| {
            if let Err(err) = ensure_appimage_desktop_integration() {
                eprintln!("[notelet] desktop integration skipped: {err}");
            }
        });
    }
}

#[cfg(target_os = "linux")]
fn ensure_appimage_desktop_integration() -> Result<(), String> {
    let appimage_path = match std::env::var("APPIMAGE") {
        Ok(val) if !val.trim().is_empty() => val,
        _ => return Ok(()),
    };

    let data_dir = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))
        .ok_or_else(|| "could not resolve ~/.local/share".to_string())?;

    let icons_dir = data_dir
        .join("icons")
        .join("hicolor")
        .join("256x256")
        .join("apps");
    let apps_dir = data_dir.join("applications");

    std::fs::create_dir_all(&icons_dir)
        .map_err(|e| format!("failed to create icons dir: {e}"))?;
    std::fs::create_dir_all(&apps_dir)
        .map_err(|e| format!("failed to create applications dir: {e}"))?;

    let icon_path = icons_dir.join("notelet.png");
    if !icon_path.exists() {
        std::fs::write(&icon_path, APP_ICON_256_PNG)
            .map_err(|e| format!("failed to write icon: {e}"))?;
    }

    let escaped_exec = appimage_path.replace('"', "\\\"");
    let desktop_content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Notelet\n\
         Comment=軽量なローカルファースト録音・文字起こし・Notion連携ノートアプリ\n\
         Exec=\"{escaped_exec}\" %U\n\
         Icon=notelet\n\
         StartupWMClass=notelet\n\
         Categories=Office;AudioVideo;\n\
         Terminal=false\n"
    );

    let desktop_path = apps_dir.join("notelet.desktop");
    if let Ok(existing) = std::fs::read_to_string(&desktop_path) {
        if existing == desktop_content {
            return Ok(());
        }
    }

    std::fs::write(&desktop_path, desktop_content)
        .map_err(|e| format!("failed to write desktop file: {e}"))?;

    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps_dir)
        .status();

    Ok(())
}
