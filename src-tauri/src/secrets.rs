use keyring::Entry;

const SERVICE_NAME: &str = "app.koenote.desktop";

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key).map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    if value.trim().is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry
        .set_password(value)
        .map_err(|e| format!("資格情報の保存に失敗: {e}"))
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, key).map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("資格情報の読み取りに失敗: {e}")),
    }
}

pub fn has_secret(key: &str) -> bool {
    matches!(get_secret(key), Ok(Some(v)) if !v.is_empty())
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key).map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("資格情報の削除に失敗: {e}")),
    }
}
