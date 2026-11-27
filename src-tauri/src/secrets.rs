use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use rand::RngCore;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const SERVICE_NAME: &str = "app.notelet.desktop";
const KEYCHAIN_ACCOUNT: &str = "__notelet_master_key__";
// Legacy KoeNote migration fallback (scheduled for removal in v1.0.0)
const LEGACY_SERVICE_NAME: &str = "app.koenote.desktop";
const LEGACY_KEYCHAIN_ACCOUNT: &str = "__koenote_master_key__";
const ENC_PREFIX: &str = "ENCv1:";
const DPAPI_PREFIX: &str = "DPAPIv1:";

fn vault_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn ensure_legacy_migration() {
    static MIGRATION: OnceLock<()> = OnceLock::new();
    MIGRATION.get_or_init(migrate_legacy_secrets);
}

fn restrict_dir_permissions(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
    }
}

fn restrict_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(windows)]
mod win_dpapi {
    use core::ffi::c_void;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    fn protect_with_entropy(plain: &[u8], entropy: &[u8]) -> Option<Vec<u8>> {
        let mut entropy_buf = entropy.to_vec();
        let mut in_buf = plain.to_vec();
        let in_blob = DataBlob {
            cb_data: u32::try_from(in_buf.len()).ok()?,
            pb_data: in_buf.as_mut_ptr(),
        };
        let entropy_blob = DataBlob {
            cb_data: u32::try_from(entropy_buf.len()).ok()?,
            pb_data: entropy_buf.as_mut_ptr(),
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: core::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &in_blob,
                core::ptr::null(),
                &entropy_blob,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };
        if ok == 0 || out_blob.pb_data.is_null() {
            return None;
        }
        let slice = unsafe { core::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize) };
        let result = slice.to_vec();
        unsafe {
            LocalFree(out_blob.pb_data as *mut c_void);
        }
        Some(result)
    }

    fn unprotect_with_entropy(cipher: &[u8], entropy: &[u8]) -> Option<Vec<u8>> {
        let mut entropy_buf = entropy.to_vec();
        let mut in_buf = cipher.to_vec();
        let in_blob = DataBlob {
            cb_data: u32::try_from(in_buf.len()).ok()?,
            pb_data: in_buf.as_mut_ptr(),
        };
        let entropy_blob = DataBlob {
            cb_data: u32::try_from(entropy_buf.len()).ok()?,
            pb_data: entropy_buf.as_mut_ptr(),
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: core::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &in_blob,
                core::ptr::null_mut(),
                &entropy_blob,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };
        if ok == 0 || out_blob.pb_data.is_null() {
            return None;
        }
        let slice = unsafe { core::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize) };
        let result = slice.to_vec();
        unsafe {
            LocalFree(out_blob.pb_data as *mut c_void);
        }
        Some(result)
    }

    const ENTROPY: &[u8] = b"app.notelet.desktop.vault.v1";
    const LEGACY_ENTROPY: &[u8] = b"app.koenote.desktop.vault.v1";

    pub fn protect(plain: &[u8]) -> Option<Vec<u8>> {
        protect_with_entropy(plain, ENTROPY)
    }

    pub fn unprotect(cipher: &[u8]) -> Option<Vec<u8>> {
        unprotect_with_entropy(cipher, ENTROPY)
    }

    pub fn unprotect_legacy(cipher: &[u8]) -> Option<Vec<u8>> {
        unprotect_with_entropy(cipher, LEGACY_ENTROPY)
    }
}

fn write_protected_master_key_fallback(encoded_b64: &str) {
    let path = master_key_fallback_path();
    #[cfg(windows)]
    {
        if let Ok(raw_key) = B64.decode(encoded_b64.trim()) {
            if let Some(protected) = win_dpapi::protect(&raw_key) {
                let payload = format!("{DPAPI_PREFIX}{}", B64.encode(protected));
                let _ = fs::write(&path, payload);
                restrict_file_permissions(&path);
                return;
            }
        }
    }
    let _ = fs::write(&path, encoded_b64.trim());
    restrict_file_permissions(&path);
}

fn read_master_key_file(path: &Path, legacy: bool) -> Option<[u8; 32]> {
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    #[cfg(windows)]
    if let Some(rest) = trimmed.strip_prefix(DPAPI_PREFIX) {
        let protected = B64.decode(rest.trim()).ok()?;
        let plain = if legacy {
            win_dpapi::unprotect_legacy(&protected)?
        } else {
            win_dpapi::unprotect(&protected)?
        };
        if plain.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&plain);
            return Some(key);
        }
        return None;
    }
    let _ = legacy;
    if let Ok(bytes) = B64.decode(trimmed) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Some(key);
        }
    }
    None
}

fn read_protected_master_key_fallback() -> Option<[u8; 32]> {
    let path = master_key_fallback_path();
    let key = read_master_key_file(&path, false)?;
    let raw = fs::read_to_string(&path).ok()?;
    if !raw.trim().starts_with(DPAPI_PREFIX) {
        // Upgrade legacy plaintext fallback key to DPAPI-protected / 0600
        write_protected_master_key_fallback(&B64.encode(key));
    }
    Some(key)
}

/// 旧 KoeNote のキーチェーン・マスターキーを Notelet 側へ移行する。
pub fn migrate_legacy_secrets() {
    let new_key_path = master_key_fallback_path();
    if !new_key_path.exists() {
        let candidates = [
            vault_dir().join(".koenote_master_key"),
            legacy_vault_dir().join(".koenote_master_key"),
        ];
        for old_path in candidates {
            if !old_path.is_file() {
                continue;
            }
            if let Some(key) = read_master_key_file(&old_path, true) {
                write_protected_master_key_fallback(&B64.encode(key));
                let _ = fs::remove_file(&old_path);
                break;
            }
        }
    }

    if let Ok(new_entry) = Entry::new(SERVICE_NAME, KEYCHAIN_ACCOUNT) {
        if new_entry.get_password().is_err() {
            if let Ok(old_entry) = Entry::new(LEGACY_SERVICE_NAME, LEGACY_KEYCHAIN_ACCOUNT) {
                if let Ok(encoded) = old_entry.get_password() {
                    let _ = new_entry.set_password(encoded.trim());
                }
            }
        }
    }

    let new_vault = secrets_vault_path();
    let old_vault = legacy_vault_dir().join("secrets_vault.json");
    if !new_vault.exists() && old_vault.exists() {
        let _ = fs::copy(&old_vault, &new_vault);
        restrict_file_permissions(&new_vault);
    }
}

fn vault_dir() -> PathBuf {
    let dir = crate::storage::default_data_root().join("Notelet");
    let _ = fs::create_dir_all(&dir);
    restrict_dir_permissions(&dir);
    dir
}

fn legacy_vault_dir() -> PathBuf {
    crate::storage::default_data_root().join("KoeNote")
}

fn master_key_fallback_path() -> PathBuf {
    vault_dir().join(".notelet_master_key")
}

fn secrets_vault_path() -> PathBuf {
    vault_dir().join("secrets_vault.json")
}

fn read_vault_map() -> HashMap<String, String> {
    let path = secrets_vault_path();
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
            return map;
        }
    }
    HashMap::new()
}

fn write_vault_map(map: &HashMap<String, String>) -> Result<(), String> {
    let path = secrets_vault_path();
    let raw = serde_json::to_string_pretty(map)
        .map_err(|e| format!("シークレット保存データの生成に失敗しました: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, &raw).is_ok() {
        restrict_file_permissions(&tmp);
        if fs::rename(&tmp, &path).is_ok() {
            restrict_file_permissions(&path);
            return Ok(());
        }
    }
    let _ = fs::remove_file(&tmp);
    fs::write(&path, raw)
        .map_err(|e| format!("APIキーの保存に失敗しました: {e}"))?;
    restrict_file_permissions(&path);
    Ok(())
}

fn get_or_create_secret_cipher_key() -> Result<[u8; 32], String> {
    ensure_legacy_migration();
    if let Ok(key_entry) = Entry::new(SERVICE_NAME, KEYCHAIN_ACCOUNT) {
        if let Ok(encoded) = key_entry.get_password() {
            if let Ok(bytes) = B64.decode(encoded.trim()) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    write_protected_master_key_fallback(encoded.trim());
                    return Ok(key);
                }
            }
        }
    }

    if let Some(key) = read_protected_master_key_fallback() {
        let encoded = B64.encode(key);
        if let Ok(key_entry) = Entry::new(SERVICE_NAME, KEYCHAIN_ACCOUNT) {
            let _ = key_entry.set_password(&encoded);
        }
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let encoded = B64.encode(key);
    write_protected_master_key_fallback(&encoded);
    if let Ok(key_entry) = Entry::new(SERVICE_NAME, KEYCHAIN_ACCOUNT) {
        let _ = key_entry.set_password(&encoded);
    }
    Ok(key)
}

fn encrypt_secret_value(plain: &str) -> Result<String, String> {
    let key = get_or_create_secret_cipher_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("暗号化器の初期化に失敗: {e}"))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| format!("APIキーの暗号化に失敗: {e}"))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(format!("{ENC_PREFIX}{}", B64.encode(out)))
}

fn decrypt_secret_value(stored: &str) -> Result<String, String> {
    if !stored.starts_with(ENC_PREFIX) {
        return Ok(stored.to_string());
    }
    let payload = &stored[ENC_PREFIX.len()..];
    let bytes = B64
        .decode(payload)
        .map_err(|e| format!("暗号化データのデコードに失敗: {e}"))?;
    if bytes.len() < 13 {
        return Err("暗号化データが破損しています".to_string());
    }
    let (nonce_bytes, ciphertext) = bytes.split_at(12);
    let key = get_or_create_secret_cipher_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("復号器の初期化に失敗: {e}"))?;
    let plain_bytes = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|e| format!("APIキーの復号に失敗: {e}"))?;
    String::from_utf8(plain_bytes).map_err(|e| format!("UTF-8変換に失敗: {e}"))
}

fn sanitize_secret_value(key: &str, value: &str) -> String {
    let mut s = value
        .trim()
        .trim_matches(|c: char| matches!(c, '\u{feff}' | '\u{200b}' | '\r' | '\n'))
        .trim()
        .to_string();
    if key != "audio_encryption_key" {
        // Strip surrounding quotes if pasted from .env / JSON
        if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
            || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
        {
            s = s[1..s.len() - 1].trim().to_string();
        }
        // Strip accidental "Bearer " prefix
        if s.len() > 7 && s.is_char_boundary(7) && s[..7].eq_ignore_ascii_case("bearer ") {
            s = s[7..].trim().to_string();
        }
    }
    s
}

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let cleaned = sanitize_secret_value(key, value);
    if cleaned.is_empty() {
        // Never wipe an existing secret when an empty string is submitted by a "Save" button.
        // Deletion is handled explicitly via delete_secret(key).
        return Ok(());
    }
    let encrypted = encrypt_secret_value(&cleaned)?;

    {
        let _guard = vault_lock().lock().unwrap_or_else(|e| e.into_inner());
        let mut vault = read_vault_map();
        vault.insert(key.to_string(), encrypted.clone());
        write_vault_map(&vault)?;
    }

    if let Ok(entry) = Entry::new(SERVICE_NAME, key) {
        let _ = entry.set_password(&encrypted);
    }
    Ok(())
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    // Check secrets_vault.json first so newly updated keys always take precedence
    // even if the OS keyring failed to overwrite a stale entry.
    let stored_opt = {
        let _guard = vault_lock().lock().unwrap_or_else(|e| e.into_inner());
        let vault = read_vault_map();
        vault.get(key).cloned()
    };
    if let Some(stored) = stored_opt {
        if let Ok(dec) = decrypt_secret_value(&stored) {
            let cleaned = sanitize_secret_value(key, &dec);
            if !cleaned.is_empty() {
                return Ok(Some(cleaned));
            }
        }
    }

    if let Ok(entry) = Entry::new(SERVICE_NAME, key) {
        if let Ok(pw) = entry.get_password() {
            if let Ok(dec) = decrypt_secret_value(&pw) {
                let cleaned = sanitize_secret_value(key, &dec);
                if !cleaned.is_empty() {
                    return Ok(Some(cleaned));
                }
            }
        }
    }

    Ok(None)
}

pub fn has_secret(key: &str) -> bool {
    matches!(get_secret(key), Ok(Some(v)) if !v.trim().is_empty())
}

#[allow(dead_code)]
pub fn delete_secret(key: &str) -> Result<(), String> {
    {
        let _guard = vault_lock().lock().unwrap_or_else(|e| e.into_inner());
        let mut vault = read_vault_map();
        vault.remove(key);
        let _ = write_vault_map(&vault);
    }

    if let Ok(entry) = Entry::new(SERVICE_NAME, key) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_bearer_and_whitespace() {
        assert_eq!(sanitize_secret_value("openai_api_key", " Bearer  sk-test \n"), "sk-test");
        assert_eq!(sanitize_secret_value("notion_access_token", "  secret_abc  "), "secret_abc");
    }

    #[test]
    fn aes_gcm_roundtrip_with_fixed_key() {
        let key = [42u8; 32];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher.encrypt(nonce, b"sk-roundtrip-secret".as_ref()).unwrap();
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ct);
        let encoded = format!("{ENC_PREFIX}{}", B64.encode(&combined));
        assert!(encoded.starts_with(ENC_PREFIX));

        let raw = B64.decode(encoded.trim_start_matches(ENC_PREFIX)).unwrap();
        let (n, c) = raw.split_at(12);
        let pt = cipher.decrypt(Nonce::from_slice(n), c).unwrap();
        assert_eq!(String::from_utf8(pt).unwrap(), "sk-roundtrip-secret");
    }
}
