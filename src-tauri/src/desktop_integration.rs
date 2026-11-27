#[cfg(target_os = "linux")]
const APP_ICON_256_PNG: &[u8] = include_bytes!("../icons/128x128@2x.png");

/// Freedesktop Desktop Entry 仕様に準拠し、二重引用符 `"..."` 内で特別な意味を持つ
/// `\`, `"`, `$`, `` ` `` をバックスラッシュでエスケープする。
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn escape_desktop_exec_arg(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for ch in path.chars() {
        match ch {
            '\\' | '"' | '$' | '`' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn build_desktop_entry_content(appimage_path: &str) -> String {
    let escaped_exec = escape_desktop_exec_arg(appimage_path);
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Notelet\n\
         Comment=軽量なローカルファースト録音・文字起こし・Notion連携ノートアプリ\n\
         Exec=\"{escaped_exec}\" %U\n\
         Icon=notelet\n\
         StartupWMClass=notelet\n\
         Categories=Office;AudioVideo;\n\
         Terminal=false\n"
    )
}

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
    let needs_icon_write = std::fs::read(&icon_path)
        .map(|existing| existing.as_slice() != APP_ICON_256_PNG)
        .unwrap_or(true);
    if needs_icon_write {
        std::fs::write(&icon_path, APP_ICON_256_PNG)
            .map_err(|e| format!("failed to write icon: {e}"))?;
    }

    let desktop_content = build_desktop_entry_content(&appimage_path);

    // .deb パッケージが配置する `/usr/share/applications/Notelet.desktop` とデスクトップ ID を揃え、
    // 併用時の二重登録を防ぐ（ユーザー領域の Notelet.desktop がシステム側を優先上書きする）。
    let legacy_lower = apps_dir.join("notelet.desktop");
    if legacy_lower.exists() {
        let _ = std::fs::remove_file(&legacy_lower);
    }

    let desktop_path = apps_dir.join("Notelet.desktop");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_desktop_exec_special_characters() {
        let raw = r#"/home/user/My "App" $1 `test`\Notelet.AppImage"#;
        let escaped = escape_desktop_exec_arg(raw);
        assert_eq!(
            escaped,
            r#"/home/user/My \"App\" \$1 \`test\`\\Notelet.AppImage"#
        );
        let entry = build_desktop_entry_content(raw);
        assert!(entry.contains(&format!("Exec=\"{escaped}\" %U")));
    }
}
