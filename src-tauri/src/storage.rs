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
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;
use uuid::Uuid;

pub fn app_data_dir() -> PathBuf {
    // テストや検証用に、アプリデータのルートを環境変数で差し替えられるようにする。
    // 旧名の環境変数は既存利用者の移行用フォールバックとしてのみ受け付ける。
    let custom = std::env::var_os("NOTELET_DATA_DIR")
        .or_else(|| std::env::var_os("KOENOTE_DATA_DIR"));
    if let Some(custom) = custom {
        let dir = PathBuf::from(custom);
        if !dir.as_os_str().is_empty() {
            let _ = fs::create_dir_all(&dir);
            return dir;
        }
    }
    let dir = default_data_root().join("Notelet");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn default_data_root() -> PathBuf {
    #[cfg(target_os = "android")]
    {
        if let Some(dir) = android_app_files_dir() {
            return dir;
        }
    }
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Android のアプリ専用 files ディレクトリ。
/// dirs クレートは Android をサポートしないため、/proc/self/cmdline から
/// パッケージ名を求めて /data/data/<package>/files を使う。
#[cfg(target_os = "android")]
fn android_app_files_dir() -> Option<PathBuf> {
    let cmdline = fs::read_to_string("/proc/self/cmdline").ok()?;
    let package = cmdline.split('\0').next()?.trim();
    if package.is_empty() || !package.contains('.') {
        return None;
    }
    Some(PathBuf::from(format!("/data/data/{package}/files")))
}

fn legacy_data_dir() -> PathBuf {
    default_data_root().join("KoeNote")
}

/// 旧 KoeNote のデータディレクトリ・データファイルを Notelet 側へ移行する。
/// 移行元は成功確認まで削除しない。
pub fn migrate_legacy_app_data() {
    let has_custom_dir = std::env::var_os("NOTELET_DATA_DIR")
        .or_else(|| std::env::var_os("KOENOTE_DATA_DIR"))
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    let old_dir = legacy_data_dir();
    let new_dir = default_data_root().join("Notelet");

    if !has_custom_dir && old_dir.is_dir() {
        if !new_dir.exists() {
            let _ = fs::rename(&old_dir, &new_dir);
        }
        if new_dir.exists() && old_dir.exists() {
            copy_missing_dir_contents(&old_dir, &new_dir);
        }
    }

    let active_dir = app_data_dir();
    let new_file = active_dir.join("notelet_data.json");
    let legacy_file = active_dir.join("koenote_data.json");
    if !new_file.exists() && legacy_file.exists() {
        let _ = fs::rename(&legacy_file, &new_file);
    }
    rewrite_legacy_paths(&new_file, &old_dir, &new_dir);
}

fn copy_missing_dir_contents(src: &Path, dst: &Path) {
    let _ = fs::create_dir_all(dst);
    let Ok(entries) = fs::read_dir(src) else {
        return;
    };
    for entry in entries.flatten() {
        let from = entry.path();
        let Some(name) = from.file_name() else {
            continue;
        };
        let to = dst.join(name);
        if from.is_dir() {
            if !to.exists() {
                let _ = fs::rename(&from, &to);
            } else {
                copy_missing_dir_contents(&from, &to);
            }
        } else if !to.exists() {
            let _ = fs::copy(&from, &to);
        }
    }
}

fn rewrite_legacy_paths(file: &Path, old_dir: &Path, new_dir: &Path) {
    let Ok(raw) = fs::read_to_string(file) else {
        return;
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let old_prefix = old_dir.to_string_lossy().to_string();
    let new_prefix = new_dir.to_string_lossy().to_string();
    let mut changed = false;
    if let Some(notes) = value.get_mut("notes").and_then(|v| v.as_array_mut()) {
        for note in notes {
            let Some(path) = note
                .get("audio_path")
                .and_then(|v| v.as_str()).map(|s| s.to_string())
            else {
                continue;
            };
            if !old_prefix.is_empty() && path.contains(&old_prefix) {
                note["audio_path"] =
                    serde_json::Value::String(path.replace(&old_prefix, &new_prefix));
                changed = true;
            }
        }
    }
    if let Some(settings) = value.get_mut("settings") {
        for key in ["whisper_cli_path", "parakeet_cli_path"] {
            let Some(path) = settings
                .get(key)
                .and_then(|v| v.as_str()).map(|s| s.to_string())
            else {
                continue;
            };
            if !old_prefix.is_empty() && path.contains(&old_prefix) {
                settings[key] =
                    serde_json::Value::String(path.replace(&old_prefix, &new_prefix));
                changed = true;
            }
        }
    }
    if changed {
        if let Ok(json) = serde_json::to_string_pretty(&value) {
            let _ = fs::write(file, json);
        }
    }
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

pub fn temp_recordings_dir() -> PathBuf {
    let dir = app_data_dir().join("temp_recordings");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn managed_audio_roots() -> Vec<PathBuf> {
    vec![audio_dir(), temp_recordings_dir()]
}

pub(crate) fn path_is_within(root: &Path, candidate: &Path) -> bool {
    candidate != root && candidate.starts_with(root)
}

/// アプリ管理下の音声ファイルのみ許可する。
/// `canonicalize` でシンボリックリンクを解決したうえで判定するため、`..` やリンクによる脱出も拒否する。
pub fn validate_managed_audio_path(path: &str) -> Option<PathBuf> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return None;
    }
    let canonical = fs::canonicalize(candidate).ok()?;
    for root in managed_audio_roots() {
        if let Ok(root) = fs::canonicalize(&root) {
            if path_is_within(&root, &canonical) {
                return Some(canonical);
            }
        }
    }
    None
}

pub fn is_managed_audio_path(path: &str) -> bool {
    validate_managed_audio_path(path).is_some()
}

/// 管理下の音声パスのうち、対象ノート自身の保存ファイル（`<note_id>.wav[.enc]`）または一時録音のみ許可する。
pub fn validate_note_audio_path(path: &str, note_id: &str) -> Option<PathBuf> {
    let canonical = validate_managed_audio_path(path)?;
    let audio_root = fs::canonicalize(audio_dir()).ok()?;
    if !canonical.starts_with(&audio_root) {
        // temp_recordings 配下は録音中の一時ファイルとして許可する。
        return Some(canonical);
    }
    let expected_stem = format!("{note_id}.wav");
    let stem = canonical.file_stem()?.to_string_lossy().to_string();
    if stem == expected_stem {
        Some(canonical)
    } else {
        None
    }
}

fn data_file_path() -> PathBuf {
    app_data_dir().join("notelet_data.json")
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
        popup_chat_sessions: Vec::new(),
        deleted_notes: Vec::new(),
    }
}

fn write_snapshot_to_path(path: &Path, snapshot: &AppDataSnapshot) -> Result<(), String> {
    let json = serde_json::to_vec(snapshot)
        .map_err(|e| format!("データのシリアライズに失敗: {e}"))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json).map_err(|e| format!("一時ファイルの書き込みに失敗: {e}"))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("データファイルの更新に失敗: {e}"))?;
    Ok(())
}

struct PendingSave {
    target: Option<(PathBuf, AppDataSnapshot)>,
    seq: u64,
}

struct SnapshotWriter {
    state: Mutex<PendingSave>,
    cv: Condvar,
    flushed_cv: Condvar,
}

static SNAPSHOT_WRITER: OnceLock<SnapshotWriter> = OnceLock::new();

fn snapshot_writer() -> &'static SnapshotWriter {
    SNAPSHOT_WRITER.get_or_init(|| {
        let writer = SnapshotWriter {
            state: Mutex::new(PendingSave {
                target: None,
                seq: 0,
            }),
            cv: Condvar::new(),
            flushed_cv: Condvar::new(),
        };
        let _ = std::thread::Builder::new()
            .name("notelet-storage-writer".to_string())
            .spawn(|| {
                let w = snapshot_writer();
                loop {
                    let (path, snap) = {
                        let mut guard = w.state.lock().unwrap_or_else(|e| e.into_inner());
                        while guard.target.is_none() {
                            guard = w.cv.wait(guard).unwrap_or_else(|e| e.into_inner());
                        }
                        let seq_seen = guard.seq;
                        // 250ms デバウンスで連続更新を合流させ、呼び出し元のロック保持を最小化する
                        let (g, _) = w
                            .cv
                            .wait_timeout_while(
                                guard,
                                Duration::from_millis(250),
                                |st| st.seq == seq_seen,
                            )
                            .unwrap_or_else(|e| e.into_inner());
                        guard = g;
                        let Some((p, s)) = guard.target.take() else {
                            w.flushed_cv.notify_all();
                            continue;
                        };
                        (p, s)
                    };
                    if let Err(err) = write_snapshot_to_path(&path, &snap) {
                        eprintln!("[notelet] async snapshot save failed: {err}");
                    }
                    let guard = w.state.lock().unwrap_or_else(|e| e.into_inner());
                    if guard.target.is_none() {
                        w.flushed_cv.notify_all();
                    }
                }
            });
        writer
    })
}

pub fn save_snapshot(snapshot: &AppDataSnapshot) -> Result<(), String> {
    let path = data_file_path();
    if cfg!(test) {
        return write_snapshot_to_path(&path, snapshot);
    }
    let w = snapshot_writer();
    let mut guard = w.state.lock().unwrap_or_else(|e| e.into_inner());
    guard.target = Some((path, snapshot.clone()));
    guard.seq = guard.seq.wrapping_add(1);
    w.cv.notify_all();
    Ok(())
}

pub fn flush_snapshot_sync() {
    if let Some(w) = SNAPSHOT_WRITER.get() {
        let mut guard = w.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((path, snap)) = guard.target.take() {
            drop(guard);
            let _ = write_snapshot_to_path(&path, &snap);
        } else {
            let _ = w
                .flushed_cv
                .wait_timeout_while(guard, Duration::from_secs(2), |st| st.target.is_some());
        }
    }
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
    if validate_managed_audio_path(&temp_wav.to_string_lossy()).is_none() {
        return Err("管理外の音声ファイルは取り込めません。".to_string());
    }
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
    if validate_managed_audio_path(path).is_none() {
        return Err("管理外の音声ファイルは読み込めません。".to_string());
    }
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
        if fname.starts_with("live_") || !fname.contains(note_id) {
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
    // 管理ディレクトリ配下のみ削除する（任意ファイル削除の防止）。
    if let Some(p) = validate_managed_audio_path(path) {
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
        let mono = wav_reader_mono_f32(&mut reader);
        if mono.is_empty() {
            continue;
        }
        let downsampled = resample_mono(&mono, spec.sample_rate.max(1), 8000);
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
                let sample = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                let _ = writer.write_sample(sample);
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

fn wav_reader_mono_f32<R: std::io::Read>(reader: &mut hound::WavReader<R>) -> Vec<f32> {
    let spec = reader.spec();
    let ch = spec.channels.max(1) as usize;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => match spec.bits_per_sample {
            8 => reader
                .samples::<i8>()
                .filter_map(|s| s.ok())
                .map(|v| (v as u8 as f32 - 128.0) / 128.0)
                .collect(),
            16 => reader
                .samples::<i16>()
                .filter_map(|s| s.ok())
                .map(|v| v as f32 / 32_768.0)
                .collect(),
            bits => {
                let scale = (1i64 << (bits.min(32).saturating_sub(1))) as f32;
                reader
                    .samples::<i32>()
                    .filter_map(|s| s.ok())
                    .map(|v| v as f32 / scale.max(1.0))
                    .collect()
            }
        },
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(|s| s.ok()).collect(),
    };
    samples
        .chunks(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

fn resample_mono(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((input.len() as f64) / ratio).round().max(1.0) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let i0 = src.floor() as usize;
        let frac = (src - i0 as f64) as f32;
        let a = input.get(i0).copied().unwrap_or(0.0);
        let b = input.get(i0 + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

fn stream_wav_to_16k_writer<R: std::io::Read, W: std::io::Write + std::io::Seek>(
    reader: &mut hound::WavReader<R>,
    writer: &mut hound::WavWriter<W>,
) -> Result<usize, String> {
    const FRAME_CHUNK: usize = 4096;
    let spec = reader.spec();
    let ch = spec.channels.max(1) as usize;
    let from_rate = spec.sample_rate.max(1);

    let mut raw_iter: Box<dyn Iterator<Item = f32> + '_> = match spec.sample_format {
        hound::SampleFormat::Int => match spec.bits_per_sample {
            8 => Box::new(
                reader
                    .samples::<i8>()
                    .filter_map(|s| s.ok())
                    .map(|v| (v as u8 as f32 - 128.0) / 128.0),
            ),
            16 => Box::new(
                reader
                    .samples::<i16>()
                    .filter_map(|s| s.ok())
                    .map(|v| v as f32 / 32_768.0),
            ),
            bits => {
                let scale = (1i64 << (bits.min(32).saturating_sub(1))) as f32;
                Box::new(
                    reader
                        .samples::<i32>()
                        .filter_map(|s| s.ok())
                        .map(move |v| v as f32 / scale.max(1.0)),
                )
            }
        },
        hound::SampleFormat::Float => Box::new(reader.samples::<f32>().filter_map(|s| s.ok())),
    };

    let mut total_written = 0usize;
    let mut carry = Vec::with_capacity(ch);
    let mut chunk_mono = Vec::with_capacity(FRAME_CHUNK);
    loop {
        chunk_mono.clear();
        for _ in 0..FRAME_CHUNK {
            carry.clear();
            for _ in 0..ch {
                match raw_iter.next() {
                    Some(v) => carry.push(v),
                    None => break,
                }
            }
            if carry.len() < ch {
                break;
            }
            chunk_mono.push(carry.iter().sum::<f32>() / ch as f32);
        }
        if chunk_mono.is_empty() {
            break;
        }
        let out_chunk = resample_mono(&chunk_mono, from_rate, 16_000);
        for s in out_chunk {
            let sample = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer
                .write_sample(sample)
                .map_err(|e| format!("連結音声の書き込みに失敗: {e}"))?;
            total_written += 1;
        }
    }
    Ok(total_written)
}

/// 保持済みの音声（復号済みバイト列）の末尾に新しい録音を連結した 16kHz WAV を作る（チャンク単位ストリーミング処理）。
pub fn concat_wav_audio(existing: &[u8], additional: &Path) -> Result<PathBuf, String> {
    let mut old_reader = hound::WavReader::new(std::io::Cursor::new(existing))
        .map_err(|e| format!("既存音声の読み込みに失敗: {e}"))?;
    let mut new_reader = hound::WavReader::open(additional)
        .map_err(|e| format!("追加音声の読み込みに失敗: {e}"))?;

    let temp_dir = app_data_dir().join("temp_recordings");
    let _ = fs::create_dir_all(&temp_dir);
    let out_wav = temp_dir.join(format!("concat_{}.wav", Uuid::new_v4()));
    let out_spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&out_wav, out_spec)
        .map_err(|e| format!("連結音声の作成に失敗: {e}"))?;

    let n1 = stream_wav_to_16k_writer(&mut old_reader, &mut writer)?;
    let n2 = stream_wav_to_16k_writer(&mut new_reader, &mut writer)?;
    if n1 == 0 && n2 == 0 {
        drop(writer);
        let _ = fs::remove_file(&out_wav);
        return Err("連結する音声データがありません".to_string());
    }

    writer
        .finalize()
        .map_err(|e| format!("連結音声の確定に失敗: {e}"))?;
    Ok(out_wav)
}

pub fn wav_duration_ms(bytes: &[u8]) -> Option<u64> {
    let reader = hound::WavReader::new(std::io::Cursor::new(bytes)).ok()?;
    let spec = reader.spec();
    if spec.sample_rate == 0 {
        return None;
    }
    Some(reader.duration() as u64 * 1000 / spec.sample_rate as u64)
}

pub fn normalize_media_to_16k_wav(input_path: &Path) -> (PathBuf, u64) {
    let temp_dir = app_data_dir().join("temp_recordings");
    let _ = fs::create_dir_all(&temp_dir);
    let out_wav = temp_dir.join(format!("norm_{}.wav", Uuid::new_v4()));

    // 1. Check if already a readable WAV
    if let Ok(mut reader) = hound::WavReader::open(input_path) {
        let spec = reader.spec();
        let frames = reader.duration() as u64;
        let dur_sec = if spec.sample_rate > 0 {
            frames.div_ceil(spec.sample_rate as u64)
        } else {
            0
        };
        if frames == 0 {
            return (input_path.to_path_buf(), 0);
        }
        if spec.channels == 1 && spec.sample_rate == 16_000 && spec.bits_per_sample == 16 {
            return (input_path.to_path_buf(), dur_sec);
        }
        // Resample WAV to 16kHz mono 16-bit in pure Rust
        let mono = wav_reader_mono_f32(&mut reader);
        if mono.is_empty() {
            return (input_path.to_path_buf(), 0);
        }
        let resampled = resample_mono(&mono, spec.sample_rate.max(1), 16_000);
        let out_spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        if let Ok(mut writer) = hound::WavWriter::create(&out_wav, out_spec) {
            for s in resampled {
                let sample = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                let _ = writer.write_sample(sample);
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
                .map(|r| {
                    let rate = r.spec().sample_rate.max(1) as u64;
                    (r.duration() as u64).div_ceil(rate)
                })
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
                    .map(|r| {
                        let rate = r.spec().sample_rate.max(1) as u64;
                        (r.duration() as u64).div_ceil(rate)
                    })
                    .unwrap_or(0);
                let _ = fs::remove_file(input_path);
                return (out_wav, dur_sec);
            }
        }
    }

    (input_path.to_path_buf(), 0)
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn rewrites_legacy_paths_in_snapshot() {
        let root = std::env::temp_dir().join(format!("notelet-migration-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let old_dir = root.join("KoeNote");
        let new_dir = root.join("Notelet");
        fs::create_dir_all(old_dir.join("audio")).unwrap();
        let old_audio = old_dir.join("audio").join("n1.wav");
        let old_cli = old_dir.join("bin").join("whisper").join("whisper-server");
        let file = root.join("notelet_data.json");
        let payload = serde_json::json!({
            "notes": [{ "id": "n1", "audio_path": old_audio.to_string_lossy() }],
            "settings": { "whisper_cli_path": old_cli.to_string_lossy() }
        });
        fs::write(&file, serde_json::to_string(&payload).unwrap()).unwrap();

        rewrite_legacy_paths(&file, &old_dir, &new_dir);

        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        let audio = value["notes"][0]["audio_path"].as_str().unwrap();
        let cli = value["settings"]["whisper_cli_path"].as_str().unwrap();
        let new_prefix = new_dir.to_string_lossy().to_string();
        assert!(audio.starts_with(&new_prefix));
        assert!(cli.starts_with(&new_prefix));
        assert!(!audio.contains("KoeNote"));
        assert!(!cli.contains("KoeNote"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copies_missing_legacy_files_without_overwriting() {
        let root = std::env::temp_dir().join(format!("notelet-copy-{}", Uuid::new_v4()));
        let old = root.join("KoeNote");
        let new = root.join("Notelet");
        fs::create_dir_all(old.join("audio")).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("audio").join("a.wav"), b"legacy").unwrap();
        fs::write(old.join("keep.txt"), b"old").unwrap();
        fs::write(new.join("keep.txt"), b"new").unwrap();

        copy_missing_dir_contents(&old, &new);

        assert!(new.join("audio").join("a.wav").exists());
        assert_eq!(fs::read_to_string(new.join("keep.txt")).unwrap(), "new");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn managed_audio_path_rejects_parent_and_outside_paths() {
        let root = std::env::temp_dir().join(format!("notelet-audio-{}", Uuid::new_v4()));
        let audio = root.join("audio");
        let temp = root.join("temp_recordings");
        fs::create_dir_all(&audio).unwrap();
        fs::create_dir_all(&temp).unwrap();
        let inside = audio.join("n1.wav");
        let temp_file = temp.join("live_1.wav");
        let outside = root.join("secret.txt");
        fs::write(&inside, b"x").unwrap();
        fs::write(&temp_file, b"x").unwrap();
        fs::write(&outside, b"x").unwrap();

        let canonical_audio = fs::canonicalize(&audio).unwrap();
        let canonical_temp = fs::canonicalize(&temp).unwrap();
        assert!(path_is_within(&canonical_audio, &fs::canonicalize(&inside).unwrap()));
        assert!(path_is_within(&canonical_temp, &fs::canonicalize(&temp_file).unwrap()));
        assert!(!path_is_within(&canonical_audio, &fs::canonicalize(&outside).unwrap()));
        assert!(!path_is_within(
            &canonical_audio,
            &fs::canonicalize(audio.join("../secret.txt")).unwrap()
        ));
        let _ = fs::remove_dir_all(&root);
    }
}