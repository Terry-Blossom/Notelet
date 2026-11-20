use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use rand::RngCore;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const SERVICE_NAME: &str = "app.koenote.desktop";
const ENC_PREFIX: &str = "ENCv1:";

fn vault_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("KoeNote");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn master_key_fallback_path() -> PathBuf {
    vault_dir().join(".koenote_master_key")
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

fn write_vault_map(map: &HashMap<String, String>) {
    let path = secrets_vault_path();
    if let Ok(raw) = serde_json::to_string_pretty(map) {
        let _ = fs::write(path, raw);
    }
}

fn get_or_create_secret_cipher_key() -> Result<[u8; 32], String> {
    if let Ok(key_entry) = Entry::new(SERVICE_NAME, "__koenote_master_key__") {
        if let Ok(encoded) = key_entry.get_password() {
            if let Ok(bytes) = B64.decode(encoded.trim()) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    let _ = fs::write(master_key_fallback_path(), encoded.trim());
                    return Ok(key);
                }
            }
        }
    }

    if let Ok(encoded) = fs::read_to_string(master_key_fallback_path()) {
        if let Ok(bytes) = B64.decode(encoded.trim()) {
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                if let Ok(key_entry) = Entry::new(SERVICE_NAME, "__koenote_master_key__") {
                    let _ = key_entry.set_password(encoded.trim());
                }
                return Ok(key);
            }
        }
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let encoded = B64.encode(key);
    let _ = fs::write(master_key_fallback_path(), &encoded);
    if let Ok(key_entry) = Entry::new(SERVICE_NAME, "__koenote_master_key__") {
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

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        // Never wipe an existing secret when an empty string is submitted by a "Save" button.
        // Deletion is handled explicitly via delete_secret(key).
        return Ok(());
    }
    let encrypted = if key == "audio_encryption_key" {
        trimmed.to_string()
    } else {
        encrypt_secret_value(trimmed)?
    };

    let mut vault = read_vault_map();
    vault.insert(key.to_string(), encrypted.clone());
    write_vault_map(&vault);

    if let Ok(entry) = Entry::new(SERVICE_NAME, key) {
        let _ = entry.set_password(&encrypted);
    }
    Ok(())
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    if let Ok(entry) = Entry::new(SERVICE_NAME, key) {
        if let Ok(pw) = entry.get_password() {
            if key == "audio_encryption_key" {
                if !pw.trim().is_empty() {
                    return Ok(Some(pw));
                }
            } else if let Ok(dec) = decrypt_secret_value(&pw) {
                if !dec.trim().is_empty() {
                    return Ok(Some(dec));
                }
            }
        }
    }

    let vault = read_vault_map();
    if let Some(stored) = vault.get(key) {
        if key == "audio_encryption_key" {
            return Ok(Some(stored.clone()));
        }
        let dec = decrypt_secret_value(stored)?;
        if !dec.trim().is_empty() {
            return Ok(Some(dec));
        }
    }

    Ok(None)
}

pub fn has_secret(key: &str) -> bool {
    matches!(get_secret(key), Ok(Some(v)) if !v.trim().is_empty())
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let mut vault = read_vault_map();
    vault.remove(key);
    write_vault_map(&vault);

    if let Ok(entry) = Entry::new(SERVICE_NAME, key) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
    Ok(())
}
