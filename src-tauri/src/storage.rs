use crate::models::{
    AppDataSnapshot, AppSettings, AuditEvent, DictionaryEntry, Folder, Note, Recipe,
};
use crate::secrets;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use rand::RngCore;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("KoeNote");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn models_dir() -> PathBuf {
    let dir = app_data_dir().join("models");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn audio_dir() -> PathBuf {
    let dir = app_data_dir().join("audio");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn data_file_path() -> PathBuf {
    app_data_dir().join("koenote_data.json")
}

fn default_folders() -> Vec<Folder> {
    vec![
        Folder {
            id: "personal".to_string(),
            name: "一般".to_string(),
            is_shared: false,
            permission: "owner".to_string(),
        },
        Folder {
            id: "meeting".to_string(),
            name: "会議".to_string(),
            is_shared: false,
            permission: "owner".to_string(),
        },
    ]
}

fn default_recipes() -> Vec<Recipe> {
    vec![
        Recipe {
            id: "recipe-minutes".to_string(),
            name: "標準議事録".to_string(),
            description: "議題・決定事項・担当者付きアクション項目に整理します".to_string(),
            prompt: "以下の文字起こしと手入力メモから、1) 概要（3行以内）、2) 決定事項、3) アクション項目（担当者と期限が会話に出た場合のみ記載）を日本語で整理してください。会話にない情報は推測で補わないでください。".to_string(),
            is_builtin: true,
        },
        Recipe {
            id: "recipe-1on1".to_string(),
            name: "1on1 振り返り".to_string(),
            description: "話された論点、困りごと、次の行動を抽出します".to_string(),
            prompt: "1on1の記録から、相談されたトピック、共有された事実、合意した次のステップを簡潔にまとめてください。".to_string(),
            is_builtin: true,
        },
        Recipe {
            id: "recipe-customer".to_string(),
            name: "顧客ヒアリング".to_string(),
            description: "要望・課題・導入条件を構造化します".to_string(),
            prompt: "顧客ヒアリングの文字起こしから、現在の課題、要望された機能や条件、次回までの宿題を抽出してください。".to_string(),
            is_builtin: true,
        },
    ]
}

pub fn load_snapshot() -> AppDataSnapshot {
    let path = data_file_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(mut snap) = serde_json::from_str::<AppDataSnapshot>(&raw) {
            snap.folders.retain(|f| f.id != "team-shared" && !f.is_shared);
            if snap.folders.is_empty() {
                snap.folders = default_folders();
            }
            if snap.recipes.is_empty() {
                snap.recipes = default_recipes();
            }
            snap.settings.delete_audio_after_transcribe = false;
            return snap;
        }
    }
    AppDataSnapshot {
        notes: Vec::new(),
        folders: default_folders(),
        dictionary: Vec::new(),
        recipes: default_recipes(),
        settings: AppSettings::default(),
        audit_logs: Vec::new(),
        chat_history: Vec::new(),
        deleted_notes: Vec::new(),
    }
}

pub fn save_snapshot(snapshot: &AppDataSnapshot) -> Result<(), String> {
    let path = data_file_path();
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("データのシリアライズに失敗: {e}"))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json).map_err(|e| format!("一時ファイルの書き込みに失敗: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("データファイルの更新に失敗: {e}"))?;
    Ok(())
}

pub fn append_audit(snapshot: &mut AppDataSnapshot, action: &str, detail: &str) {
    // プライバシー原則: 文字起こし本文や音声内容を監査ログに含めない
    snapshot.audit_logs.insert(
        0,
        AuditEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            action: action.to_string(),
            detail: detail.to_string(),
        },
    );
    if snapshot.audit_logs.len() > 500 {
        snapshot.audit_logs.truncate(500);
    }
}

fn get_or_create_audio_key() -> Result<[u8; 32], String> {
    if let Ok(Some(encoded)) = secrets::get_secret("audio_encryption_key") {
        if let Ok(bytes) = B64.decode(encoded) {
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    secrets::set_secret("audio_encryption_key", &B64.encode(key))?;
    Ok(key)
}

pub fn retain_audio_file(temp_wav: &Path, note_id: &str, encrypt: bool) -> Result<(String, bool), String> {
    let ext = if encrypt { "wav.enc" } else { "wav" };
    let dest = audio_dir().join(format!("{note_id}.{ext}"));
    let data = fs::read(temp_wav).map_err(|e| format!("録音ファイルの読み込みに失敗: {e}"))?;
    if encrypt {
        let key = get_or_create_audio_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| format!("暗号化器の初期化に失敗: {e}"))?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, data.as_ref())
            .map_err(|e| format!("音声の暗号化に失敗: {e}"))?;
        let mut out = Vec::with_capacity(12 + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        fs::write(&dest, out).map_err(|e| format!("暗号化音声の保存に失敗: {e}"))?;
        Ok((dest.to_string_lossy().to_string(), true))
    } else {
        fs::write(&dest, data).map_err(|e| format!("音声ファイルの保存に失敗: {e}"))?;
        Ok((dest.to_string_lossy().to_string(), false))
    }
}

pub fn read_retained_audio_bytes(path: &str, encrypted: bool) -> Result<Vec<u8>, String> {
    let raw = fs::read(path).map_err(|e| format!("録音ファイルの読み込みに失敗: {e}"))?;
    if !encrypted {
        return Ok(raw);
    }
    if raw.len() < 12 {
        return Err("暗号化音声データが破損しています".to_string());
    }
    let key = get_or_create_audio_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("復号器の初期化に失敗: {e}"))?;
    let nonce = Nonce::from_slice(&raw[..12]);
    cipher
        .decrypt(nonce, &raw[12..])
        .map_err(|e| format!("音声の復号に失敗しました: {e}"))
}

pub fn recover_orphan_temp_audio(note_id: &str, encrypt: bool) -> Option<(String, bool)> {
    let temp_dir = app_data_dir().join("temp_recordings");
    let entries = fs::read_dir(&temp_dir).ok()?;
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let p = entry.path();
        let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if fname.starts_with("live_") {
            continue;
        }
        let is_audio = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("wav"))
            .unwrap_or(false);
        if !is_audio {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > 1000 {
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                if newest.as_ref().map(|(t, _)| mtime > *t).unwrap_or(true) {
                    newest = Some((mtime, p));
                }
            }
        }
    }
    let (_, cand_path) = newest?;
    let res = retain_audio_file(&cand_path, note_id, encrypt).ok()?;
    let _ = fs::remove_file(&cand_path);
    Some(res)
}

pub fn remove_file_if_exists(path: &str) {
    let p = Path::new(path);
    if p.exists() {
        let _ = fs::remove_file(p);
    }
}

pub fn export_all_json(snapshot: &AppDataSnapshot) -> Result<String, String> {
    serde_json::to_string_pretty(snapshot).map_err(|e| format!("エクスポート生成に失敗: {e}"))
}

pub fn upsert_note(snapshot: &mut AppDataSnapshot, note: Note) {
    snapshot.deleted_notes.retain(|d| d.note_id != note.id);
    if let Some(existing) = snapshot.notes.iter_mut().find(|n| n.id == note.id) {
        *existing = note;
    } else {
        snapshot.notes.insert(0, note);
    }
}

pub fn delete_note(snapshot: &mut AppDataSnapshot, note_id: &str) -> bool {
    let before = snapshot.notes.len();
    let mut notion_page_id: Option<String> = None;
    if let Some(n) = snapshot.notes.iter().find(|n| n.id == note_id) {
        if let Some(ref p) = n.audio_path {
            remove_file_if_exists(p);
        }
        notion_page_id = n.notion_sync.page_id.clone();
    }
    snapshot.notes.retain(|n| n.id != note_id);
    if snapshot.notes.len() < before {
        let now = chrono::Utc::now().to_rfc3339();
        snapshot.deleted_notes.retain(|d| d.note_id != note_id);
        snapshot.deleted_notes.push(crate::models::DeletedNoteRecord {
            note_id: note_id.to_string(),
            notion_page_id,
            deleted_at: now,
        });
        true
    } else {
        false
    }
}

pub fn upsert_dictionary(snapshot: &mut AppDataSnapshot, entry: DictionaryEntry) {
    if let Some(existing) = snapshot.dictionary.iter_mut().find(|d| d.id == entry.id) {
        *existing = entry;
    } else {
        snapshot.dictionary.push(entry);
    }
}
