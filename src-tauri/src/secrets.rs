use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use rand::RngCore;

const SERVICE_NAME: &str = "app.koenote.desktop";
const ENC_PREFIX: &str = "ENCv1:";

fn get_or_create_secret_cipher_key() -> Result<[u8; 32], String> {
    let key_entry = Entry::new(SERVICE_NAME, "__koenote_master_key__")
        .map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    if let Ok(encoded) = key_entry.get_password() {
        if let Ok(bytes) = B64.decode(encoded.trim()) {
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key_entry
        .set_password(&B64.encode(key))
        .map_err(|e| format!("暗号鍵の保存に失敗: {e}"))?;
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
    let entry =
        Entry::new(SERVICE_NAME, key).map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    if value.trim().is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    let encrypted = if key == "audio_encryption_key" {
        value.to_string()
    } else {
        encrypt_secret_value(value.trim())?
    };
    entry
        .set_password(&encrypted)
        .map_err(|e| format!("資格情報の保存に失敗: {e}"))
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let entry =
        Entry::new(SERVICE_NAME, key).map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    match entry.get_password() {
        Ok(pw) => {
            if key == "audio_encryption_key" {
                Ok(Some(pw))
            } else {
                decrypt_secret_value(&pw).map(Some)
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("資格情報の読み取りに失敗: {e}")),
    }
}

pub fn has_secret(key: &str) -> bool {
    matches!(get_secret(key), Ok(Some(v)) if !v.is_empty())
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, key).map_err(|e| format!("資格情報ストアの初期化に失敗: {e}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("資格情報の削除に失敗: {e}")),
    }
}
