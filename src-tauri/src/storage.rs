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

fn dir_size_bytes(dir: &Path) -> (u64, usize) {
    let mut total = 0u64;
    let mut count = 0usize;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let (sub_b, sub_c) = dir_size_bytes(&p);
                total += sub_b;
                count += sub_c;
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
                count += 1;
            }
        }
    }
    (total, count)
}

pub fn compute_storage_stats() -> crate::models::StorageStats {
    let (audio_bytes, audio_count) = dir_size_bytes(&audio_dir());
    let (models_bytes, _) = dir_size_bytes(&models_dir());
    crate::models::StorageStats {
        audio_bytes,
        audio_count,
        models_bytes,
        data_dir: app_data_dir().to_string_lossy().to_string(),
    }
}

pub fn compress_all_retained_audio(snapshot: &mut AppDataSnapshot) -> Result<(usize, u64), String> {
    let mut compressed_count = 0usize;
    let mut saved_bytes = 0u64;
    let encrypt = snapshot.settings.encrypt_retained_audio;

    for note in snapshot.notes.iter_mut() {
        let Some(ref path_str) = note.audio_path.clone() else {
            continue;
        };
        let path_obj = Path::new(path_str);
        if !path_obj.exists() {
            continue;
        }
        let before_len = fs::metadata(path_obj).map(|m| m.len()).unwrap_or(0);
        let Ok(raw_wav) = read_retained_audio_bytes(path_str, note.audio_encrypted) else {
            continue;
        };
        let cursor = std::io::Cursor::new(&raw_wav);
        let Ok(mut reader) = hound::WavReader::new(cursor) else {
            continue;
        };
        let spec = reader.spec();
        if spec.sample_rate <= 8000 && spec.channels == 1 {
            continue;
        }
        let step = ((spec.sample_rate as usize) / 8000).max(1) * (spec.channels.max(1) as usize);
        let samples_i16: Vec<i16> = match spec.sample_format {
            hound::SampleFormat::Int => reader
                .samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|v| {
                    if spec.bits_per_sample <= 16 {
                        v as i16
                    } else {
                        (v >> (spec.bits_per_sample - 16)) as i16
                    }
                })
                .collect(),
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .filter_map(|s| s.ok())
                .map(|v| (v.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                .collect(),
        };
        if samples_i16.is_empty() {
            continue;
        }
        let downsampled: Vec<i16> = samples_i16.iter().step_by(step).copied().collect();
        let temp_dir = app_data_dir().join("temp_recordings");
        let _ = fs::create_dir_all(&temp_dir);
        let tmp_wav = temp_dir.join(format!("comp_{}.wav", note.id));
        let out_spec = hound::WavSpec {
            channels: 1,
            sample_rate: 8000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        if let Ok(mut writer) = hound::WavWriter::create(&tmp_wav, out_spec) {
            for s in downsampled {
                let _ = writer.write_sample(s);
            }
            let _ = writer.finalize();
            if let Ok((new_path, new_enc)) = retain_audio_file(&tmp_wav, &note.id, encrypt) {
                let _ = fs::remove_file(&tmp_wav);
                let after_len = fs::metadata(&new_path).map(|m| m.len()).unwrap_or(before_len);
                if before_len > after_len {
                    saved_bytes += before_len - after_len;
                }
                note.audio_path = Some(new_path);
                note.audio_encrypted = new_enc;
                compressed_count += 1;
            }
        }
    }
    Ok((compressed_count, saved_bytes))
}

pub fn normalize_media_to_16k_wav(input_path: &Path) -> (PathBuf, u64) {
    let temp_dir = app_data_dir().join("temp_recordings");
    let _ = fs::create_dir_all(&temp_dir);
    let out_wav = temp_dir.join(format!("norm_{}.wav", Uuid::new_v4()));

    // 1. Check if already a readable WAV
    if let Ok(mut reader) = hound::WavReader::open(input_path) {
        let spec = reader.spec();
        let total_samples = reader.duration() as u64;
        let dur_sec = if spec.sample_rate > 0 {
            (total_samples / spec.sample_rate as u64).max(1)
        } else {
            0
        };
        if spec.channels == 1 && spec.sample_rate == 16_000 && spec.bits_per_sample == 16 {
            return (input_path.to_path_buf(), dur_sec);
        }
        // Resample WAV to 16kHz mono 16-bit in pure Rust
        let ch = spec.channels.max(1) as usize;
        let mono: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Int => {
                let raw: Vec<i32> = reader.samples::<i32>().filter_map(|s| s.ok()).collect();
                let scale = (1i64 << (spec.bits_per_sample.saturating_sub(1))) as f32;
                raw.chunks(ch)
                    .map(|frame| frame.iter().map(|&v| v as f32 / scale.max(1.0)).sum::<f32>() / ch as f32)
                    .collect()
            }
            hound::SampleFormat::Float => {
                let raw: Vec<f32> = reader.samples::<f32>().filter_map(|s| s.ok()).collect();
                raw.chunks(ch)
                    .map(|frame| frame.iter().sum::<f32>() / ch as f32)
                    .collect()
            }
        };
        let ratio = (spec.sample_rate as f64 / 16_000.0).max(0.1);
        let out_spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        if let Ok(mut writer) = hound::WavWriter::create(&out_wav, out_spec) {
            let mut idx = 0.0f64;
            while (idx as usize) < mono.len() {
                let s = (mono[idx as usize].clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                let _ = writer.write_sample(s);
                idx += ratio;
            }
            let _ = writer.finalize();
            let _ = fs::remove_file(input_path);
            return (out_wav, dur_sec);
        }
        return (input_path.to_path_buf(), dur_sec);
    }

    // 2. Non-WAV file (.mp3, .m4a, .mp4, .webm, .ogg, .flac): try ffmpeg or macOS afconvert
    let mut ff_cmd = std::process::Command::new("ffmpeg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        ff_cmd.creation_flags(0x0800_0000);
    }
    if let Ok(status) = ff_cmd
        .args(["-y", "-i"])
        .arg(input_path)
        .args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(&out_wav)
        .status()
    {
        if status.success() && out_wav.exists() {
            let dur_sec = hound::WavReader::open(&out_wav)
                .ok()
                .map(|r| (r.duration() as u64 / r.spec().sample_rate.max(1) as u64).max(1))
                .unwrap_or(0);
            let _ = fs::remove_file(input_path);
            return (out_wav, dur_sec);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(status) = std::process::Command::new("afconvert")
            .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
            .arg(input_path)
            .arg(&out_wav)
            .status()
        {
            if status.success() && out_wav.exists() {
                let dur_sec = hound::WavReader::open(&out_wav)
                    .ok()
                    .map(|r| (r.duration() as u64 / r.spec().sample_rate.max(1) as u64).max(1))
                    .unwrap_or(0);
                let _ = fs::remove_file(input_path);
                return (out_wav, dur_sec);
            }
        }
    }

    (input_path.to_path_buf(), 0)
}
