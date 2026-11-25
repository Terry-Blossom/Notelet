mod asr;
mod audio;
mod integrations;
mod llm;
mod models;
mod notion;
mod secrets;
mod storage;
mod updater;
mod whisper_server;

use audio::AudioManager;
use models::{
    AppDataSnapshot, AppSettings, AsrModelInfo, AudioDeviceInfo, AudioSourceMode,
    CalendarEventMock, ChatAnswer, ChatHistoryItem, DictionaryEntry, Folder,
    IntegrationAdapterInfo, LiveAssistResult, Note, Recipe, RecordingStatus, StorageStats,
};
use notion::NotionTarget;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    audio: Mutex<AudioManager>,
    data: Mutex<AppDataSnapshot>,
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> AppDataSnapshot {
    state.data.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: State<AppState>,
    settings: AppSettings,
) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    data.settings = settings.clone();
    storage::append_audit(&mut data, "settings_updated", "アプリ設定を更新");
    storage::save_snapshot(&data)?;
    drop(data);

    let _ = app.global_shortcut().unregister_all();
    if !settings.record_shortcut.trim().is_empty() {
        let _ = app.global_shortcut().register(settings.record_shortcut.trim());
    }
    if !settings.voice_typing_shortcut.trim().is_empty()
        && settings.voice_typing_shortcut.trim() != settings.record_shortcut.trim()
    {
        let _ = app
            .global_shortcut()
            .register(settings.voice_typing_shortcut.trim());
    }
    if settings.notion_target_type == "database" && !settings.notion_target_id.trim().is_empty() {
        let db_id = settings.notion_target_id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = notion::ensure_database_schema(&db_id).await;
        });
    }
    Ok(state.data.lock().unwrap().clone())
}

#[tauri::command]
fn save_note(state: State<AppState>, mut note: Note) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    let id = note.id.clone();
    let encrypt = data.settings.encrypt_retained_audio;

    if let Some(ref p) = note.audio_path.clone() {
        let path_obj = std::path::Path::new(p);
        if p.contains("temp_recordings") && path_obj.exists() {
            if let Ok((retained_path, encrypted)) =
                storage::retain_audio_file(path_obj, &id, encrypt)
            {
                storage::remove_file_if_exists(p);
                note.audio_path = Some(retained_path);
                note.audio_encrypted = encrypted;
            }
        }
    } else if let Some(existing) = data.notes.iter().find(|n| n.id == id) {
        if existing.audio_path.is_some() {
            note.audio_path = existing.audio_path.clone();
            note.audio_encrypted = existing.audio_encrypted;
        }
    }

    if let Some(existing) = data.notes.iter().find(|n| n.id == id) {
        let content_changed = existing.title != note.title
            || existing.folder_id != note.folder_id
            || existing.manual_notes != note.manual_notes
            || existing.summary != note.summary
            || existing.segments.len() != note.segments.len();
        if content_changed && note.notion_sync.status == "synced" {
            note.notion_sync.status = "not_synced".to_string();
        }
    }

    storage::upsert_note(&mut data, note);
    storage::append_audit(&mut data, "note_saved", &format!("note_id={id}"));
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn delete_note(state: State<AppState>, note_id: String) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    let page_id_to_archive = data
        .notes
        .iter()
        .find(|n| n.id == note_id)
        .and_then(|n| n.notion_sync.page_id.clone());
    if storage::delete_note(&mut data, &note_id) {
        storage::append_audit(&mut data, "note_deleted", &format!("note_id={note_id}"));
        storage::save_snapshot(&data)?;
        if let Some(pid) = page_id_to_archive {
            tauri::async_runtime::spawn(async move {
                let _ = notion::archive_notion_page(&pid).await;
            });
        }
    }
    Ok(data.clone())
}

#[tauri::command]
fn save_dictionary_entry(
    state: State<AppState>,
    entry: DictionaryEntry,
) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    storage::upsert_dictionary(&mut data, entry);
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn delete_dictionary_entry(
    state: State<AppState>,
    entry_id: String,
) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    data.dictionary.retain(|d| d.id != entry_id);
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn save_recipe(state: State<AppState>, recipe: Recipe) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    if let Some(existing) = data.recipes.iter_mut().find(|r| r.id == recipe.id) {
        *existing = recipe;
    } else {
        data.recipes.push(recipe);
    }
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn save_folder(state: State<AppState>, folder: Folder) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    let clean = Folder {
        is_shared: false,
        ..folder
    };
    if let Some(existing) = data.folders.iter_mut().find(|f| f.id == clean.id) {
        *existing = clean;
    } else {
        data.folders.push(clean);
    }
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn delete_folder(state: State<AppState>, folder_id: String) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    if folder_id == "personal" {
        return Err("既定のスペースは削除できません。".to_string());
    }
    data.folders.retain(|f| f.id != folder_id);
    for note in data.notes.iter_mut() {
        if note.folder_id == folder_id {
            note.folder_id = "personal".to_string();
        }
    }
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn clear_chat_history(state: State<AppState>) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    data.chat_history.clear();
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn delete_chat_history_items(
    state: State<AppState>,
    item_ids: Vec<String>,
) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    data.chat_history.retain(|item| !item_ids.contains(&item.id));
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    AudioManager::list_devices()
}

#[tauri::command]
async fn start_recording(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_mode: AudioSourceMode,
    device_id: Option<String>,
) -> Result<RecordingStatus, String> {
    let status = {
        let mut audio = state.audio.lock().unwrap();
        audio.start(source_mode, device_id)?
    };

    if let Some(notify_win) = app.get_webview_window("meeting-notify") {
        let _ = notify_win.hide();
    }

    if let Some(win) = app.get_webview_window("recording-overlay") {
        let (saved_x, saved_y) = {
            let data = state.data.lock().unwrap();
            (data.settings.recording_overlay_x, data.settings.recording_overlay_y)
        };
        if let (Some(x), Some(y)) = (saved_x, saved_y) {
            let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        } else if let Ok(Some(monitor)) = app.primary_monitor() {
            let scale = monitor.scale_factor();
            let sw = monitor.size().width as f64 / scale;
            let sh = monitor.size().height as f64 / scale;
            let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                ((sw - 276.0) / 2.0).max(16.0),
                (sh - 96.0).max(16.0),
            )));
        }
        let _ = win.show();
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // Pre-warm OpenWhispr-style persistent whisper-server immediately when recording starts
        {
            let st_ref = app_handle.state::<AppState>();
            let initial_settings = {
                let data = st_ref.data.lock().unwrap();
                data.settings.clone()
            };
            asr::prewarm_whisper_server(&initial_settings).await;
        }

        let mut error_reported = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            let st_ref = app_handle.state::<AppState>();
            let rec_state = {
                let audio = st_ref.audio.lock().unwrap();
                audio.status().state
            };
            if rec_state == "idle" || rec_state == "error" {
                break;
            }
            if rec_state != "recording" {
                continue;
            }
            let (settings, dictionary) = {
                let data = st_ref.data.lock().unwrap();
                (data.settings.clone(), data.dictionary.clone())
            };
            let is_cloud_provider = matches!(
                settings.active_asr_provider,
                models::AsrProviderKind::CloudOpenAi
                    | models::AsrProviderKind::CloudDeepgram
                    | models::AsrProviderKind::CloudGroq
                    | models::AsrProviderKind::CloudStepFun
            );
            if is_cloud_provider && !settings.allow_cloud_asr {
                continue;
            }
            // Cloud APIs use 3.0s chunks (48,000 samples @ 16kHz) for better phrase accuracy and rate-limit safety;
            // local models use 2.0s chunks (32,000 samples).
            let min_samples = if is_cloud_provider { 48_000 } else { 32_000 };
            let chunk_span_ms = if is_cloud_provider { 3000 } else { 2000 };
            let chunk_opt = {
                let audio = st_ref.audio.lock().unwrap();
                audio.take_live_chunk(min_samples)
            };
            if let Some((chunk_path, elapsed_ms, _dominant_source)) = chunk_opt {
                let chunk_clone = chunk_path.clone();
                let res = asr::transcribe_chunk_async(&chunk_clone, &settings, &dictionary).await;
                let _ = std::fs::remove_file(&chunk_clone);
                match res {
                    Ok(text) if !text.is_empty() => {
                        let start_ms = elapsed_ms.saturating_sub(chunk_span_ms);
                        let seg = models::TranscriptSegment {
                            id: uuid::Uuid::new_v4().to_string(),
                            start_ms,
                            end_ms: elapsed_ms,
                            speaker: String::new(),
                            text,
                        };
                        let _ = app_handle.emit("live-transcript-segment", seg);
                    }
                    Err(err) if !error_reported => {
                        error_reported = true;
                        let _ = app_handle.emit("live-transcript-error", err);
                    }
                    _ => {}
                }
            }
        }
    });

    Ok(status)
}

#[tauri::command]
fn pause_recording(state: State<AppState>) -> RecordingStatus {
    state.audio.lock().unwrap().pause()
}

#[tauri::command]
fn resume_recording(state: State<AppState>) -> RecordingStatus {
    state.audio.lock().unwrap().resume()
}

#[tauri::command]
fn stop_recording(app: tauri::AppHandle, state: State<AppState>) -> RecordingStatus {
    if let Some(win) = app.get_webview_window("recording-overlay") {
        if let (Ok(pos), Ok(scale)) = (win.outer_position(), win.scale_factor()) {
            let logical = pos.to_logical::<f64>(scale);
            let mut data = state.data.lock().unwrap();
            data.settings.recording_overlay_x = Some(logical.x);
            data.settings.recording_overlay_y = Some(logical.y);
            let _ = storage::save_snapshot(&data);
        }
        let _ = win.hide();
    }
    state.audio.lock().unwrap().stop()
}

#[tauri::command]
fn read_note_audio(state: State<AppState>, note_id: String) -> Result<String, String> {
    let (audio_path, encrypted) = {
        let mut data = state.data.lock().unwrap();
        let encrypt_pref = data.settings.encrypt_retained_audio;
        let note = data
            .notes
            .iter_mut()
            .find(|n| n.id == note_id)
            .ok_or_else(|| "対象ノートが見つかりません".to_string())?;
        let existing_valid = note
            .audio_path
            .as_ref()
            .filter(|p| std::path::Path::new(p.as_str()).exists())
            .cloned();
        if let Some(p) = existing_valid {
            (p, note.audio_encrypted)
        } else if let Some((recovered_path, enc)) =
            storage::recover_orphan_temp_audio(&note_id, encrypt_pref)
        {
            note.audio_path = Some(recovered_path.clone());
            note.audio_encrypted = enc;
            let _ = storage::save_snapshot(&data);
            (recovered_path, enc)
        } else {
            return Err("このノートには保存された録音音声がありません".to_string());
        }
    };
    let bytes = storage::read_retained_audio_bytes(&audio_path, encrypted)?;
    let ext = std::path::Path::new(&audio_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "ogg" | "opus" => "audio/ogg",
        "webm" => "audio/webm",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        _ => "audio/wav",
    };
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("http/https の URL のみ開けます".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("URL を開けませんでした: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("URL を開けませんでした: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("URL を開けませんでした: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn get_recording_status(state: State<AppState>) -> RecordingStatus {
    state.audio.lock().unwrap().status()
}

#[tauri::command]
fn list_asr_models(state: State<AppState>) -> Vec<AsrModelInfo> {
    let data = state.data.lock().unwrap();
    asr::list_models(&data.settings)
}

#[tauri::command]
async fn download_asr_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<String, String> {
    let settings = state.data.lock().unwrap().settings.clone();
    asr::download_whisper_model(&app, &model_id, &settings).await
}

#[tauri::command]
async fn install_asr_runtime(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<String, String> {
    let installed_path = asr::install_runtime_binary(&app, &kind).await?;
    let mut data = state.data.lock().unwrap();
    if kind == "whisper" {
        data.settings.whisper_cli_path = installed_path.clone();
    } else if kind == "parakeet" {
        data.settings.parakeet_cli_path = installed_path.clone();
    }
    storage::save_snapshot(&data)?;
    Ok(installed_path)
}

#[tauri::command]
fn detect_gpu_capabilities_cmd() -> models::GpuCapabilities {
    asr::detect_gpu_capabilities()
}

#[tauri::command]
async fn transcribe_recording(
    state: State<'_, AppState>,
    wav_path: String,
    note_id: String,
) -> Result<Note, String> {
    let (settings, dictionary, existing_note) = {
        let data = state.data.lock().unwrap();
        let note = data.notes.iter().find(|n| n.id == note_id).cloned();
        (data.settings.clone(), data.dictionary.clone(), note)
    };

    let mut note = existing_note.ok_or_else(|| "対象ノートが見つかりません".to_string())?;
    let mut raw_path = std::path::PathBuf::from(&wav_path);
    let mut used_retained_copy = false;
    let mut cleanup_decrypted: Option<std::path::PathBuf> = None;

    if wav_path.trim().is_empty() || !raw_path.exists() {
        if let Some(ref ap) = note.audio_path {
            let ap_path = std::path::Path::new(ap);
            if ap_path.exists() {
                if let Ok(bytes) = storage::read_retained_audio_bytes(ap, note.audio_encrypted) {
                    let temp_dir = storage::app_data_dir().join("temp_recordings");
                    let _ = std::fs::create_dir_all(&temp_dir);
                    let dec_path = temp_dir.join(format!("dec_{}.wav", uuid::Uuid::new_v4()));
                    if std::fs::write(&dec_path, &bytes).is_ok() {
                        raw_path = dec_path.clone();
                        used_retained_copy = true;
                        cleanup_decrypted = Some(dec_path);
                    }
                }
            }
        }
    }

    let (path, detected_dur_sec) = storage::normalize_media_to_16k_wav(&raw_path);
    let transcribe_res = asr::transcribe_wav(&path, &settings, &dictionary).await;

    let (segments, _diarization_supported, model_name) = match transcribe_res {
        Ok(ok) => ok,
        Err(err) => {
            if let Some(ref dec) = cleanup_decrypted {
                let _ = std::fs::remove_file(dec);
            }
            // Even when transcription fails, preserve the recorded audio so the user can retry
            if !used_retained_copy && path.exists() {
                if let Ok((retained_path, encrypted)) =
                    storage::retain_audio_file(&path, &note.id, settings.encrypt_retained_audio)
                {
                    let _ = std::fs::remove_file(&path);
                    storage::remove_file_if_exists(&wav_path);
                    note.audio_path = Some(retained_path);
                    note.audio_encrypted = encrypted;
                    note.updated_at = chrono::Utc::now().to_rfc3339();
                    let mut data = state.data.lock().unwrap();
                    storage::upsert_note(&mut data, note);
                    let _ = storage::save_snapshot(&data);
                }
            }
            return Err(err);
        }
    };

    if note.duration_sec == 0 && detected_dur_sec > 0 {
        note.duration_sec = detected_dur_sec;
    } else if note.duration_sec == 0 {
        if let Some(last) = segments.last() {
            note.duration_sec = (last.end_ms / 1000).max(1);
        }
    }
    note.segments = segments;
    note.diarization_supported = false;
    note.asr_model_id = settings.active_asr_model_id.clone();
    note.asr_provider_label = model_name;
    note.updated_at = chrono::Utc::now().to_rfc3339();

    if used_retained_copy {
        if let Some(ref dec) = cleanup_decrypted {
            let _ = std::fs::remove_file(dec);
        }
        if path != raw_path {
            let _ = std::fs::remove_file(&path);
        }
    } else if path.exists() {
        if let Ok((retained_path, encrypted)) =
            storage::retain_audio_file(&path, &note.id, settings.encrypt_retained_audio)
        {
            let _ = std::fs::remove_file(&path);
            storage::remove_file_if_exists(&wav_path);
            note.audio_path = Some(retained_path);
            note.audio_encrypted = encrypted;
        }
    }

    let mut data = state.data.lock().unwrap();
    storage::upsert_note(&mut data, note.clone());
    storage::append_audit(&mut data, "transcribed", &format!("note_id={}", note.id));
    storage::save_snapshot(&data)?;
    Ok(note)
}

#[tauri::command]
async fn transcribe_uploaded_audio(
    state: State<'_, AppState>,
    file_name: String,
    bytes: Vec<u8>,
    note_id: String,
) -> Result<Note, String> {
    let temp_dir = storage::app_data_dir().join("temp_recordings");
    let _ = std::fs::create_dir_all(&temp_dir);
    let safe_name = file_name.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '_', "_");
    let temp_path = temp_dir.join(format!("upload_{}_{}", uuid::Uuid::new_v4(), safe_name));
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("アップロードファイルの一時保存に失敗: {e}"))?;
    let path_str = temp_path.to_string_lossy().to_string();
    transcribe_recording(state, path_str, note_id).await
}

#[tauri::command]
async fn transcribe_uploaded_url(
    state: State<'_, AppState>,
    url: String,
    note_id: String,
) -> Result<Note, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("有効な http:// または https:// の動画・音声リンクを入力してください。".to_string());
    }
    let temp_dir = storage::app_data_dir().join("temp_recordings");
    let _ = std::fs::create_dir_all(&temp_dir);
    let url_path = trimmed.split('?').next().unwrap_or(trimmed);
    let ext = url_path
        .rsplit('.')
        .next()
        .filter(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "mov" | "webm" | "mkv" | "mp3" | "wav" | "m4a" | "ogg" | "flac"))
        .unwrap_or("mp4");
    let temp_path = temp_dir.join(format!("url_{}.{}", uuid::Uuid::new_v4(), ext));

    // Try yt-dlp first for web video links if available, otherwise direct HTTP download
    let mut downloaded = false;
    let ytdlp_out = temp_dir.join(format!("url_{}.%(ext)s", uuid::Uuid::new_v4()));
    let mut ytdlp_cmd = std::process::Command::new("yt-dlp");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        ytdlp_cmd.creation_flags(0x0800_0000);
    }
    if let Ok(out) = ytdlp_cmd
        .args(["-x", "--audio-format", "wav", "-o"])
        .arg(&ytdlp_out)
        .arg(trimmed)
        .output()
    {
        if out.status.success() {
            let wav_cand = ytdlp_out.with_extension("wav");
            if wav_cand.exists() {
                let path_str = wav_cand.to_string_lossy().to_string();
                return transcribe_recording(state, path_str, note_id).await;
            }
            downloaded = true;
        }
    }

    if !downloaded {
        let client = reqwest::Client::new();
        let resp = client
            .get(trimmed)
            .send()
            .await
            .map_err(|e| format!("動画・音声リンクの取得に失敗: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("動画・音声リンクの取得に失敗 ({})", resp.status()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("動画・音声データの読み込みに失敗: {e}"))?;
        std::fs::write(&temp_path, &bytes)
            .map_err(|e| format!("一時ファイルの保存に失敗: {e}"))?;
    }

    let path_str = temp_path.to_string_lossy().to_string();
    transcribe_recording(state, path_str, note_id).await
}

#[tauri::command]
async fn summarize_note_cmd(
    state: State<'_, AppState>,
    note_id: String,
    template_id: Option<String>,
) -> Result<Note, String> {
    let (settings, mut note) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        (data.settings.clone(), n)
    };
    let (summary, decisions, action_items) =
        llm::summarize_note(&settings, &note, template_id.as_deref()).await?;
    if note.title.trim().is_empty() {
        let candidate = summary
            .lines()
            .map(|l| l.trim().trim_start_matches('#').trim_start_matches('-').trim_start_matches('*').trim())
            .find(|l| !l.is_empty() && !l.starts_with("```"))
            .unwrap_or("");
        if !candidate.is_empty() {
            let short: String = candidate.chars().take(32).collect();
            note.title = short;
        }
    }
    note.summary = summary;
    note.decisions = decisions;
    note.action_items = action_items;
    note.updated_at = chrono::Utc::now().to_rfc3339();

    let mut data = state.data.lock().unwrap();
    if let Some(ref tid) = template_id {
        if !tid.trim().is_empty() {
            data.settings.active_template_id = tid.clone();
        }
    }
    storage::upsert_note(&mut data, note.clone());
    storage::save_snapshot(&data)?;
    Ok(note)
}

#[tauri::command]
async fn live_assist_cmd(
    state: State<'_, AppState>,
    note_id: String,
    live_segments: Option<Vec<models::TranscriptSegment>>,
) -> Result<LiveAssistResult, String> {
    let (settings, note) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        (data.settings.clone(), n)
    };
    llm::live_assist_note(&settings, &note, &live_segments.unwrap_or_default()).await
}

#[tauri::command]
async fn draft_followup_cmd(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Note, String> {
    let (settings, mut note) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        (data.settings.clone(), n)
    };
    let draft = llm::draft_followup_email(&settings, &note).await?;
    note.follow_up_draft = draft;
    note.updated_at = chrono::Utc::now().to_rfc3339();
    let mut data = state.data.lock().unwrap();
    storage::upsert_note(&mut data, note.clone());
    storage::save_snapshot(&data)?;
    Ok(note)
}

#[tauri::command]
async fn run_recipe_cmd(
    state: State<'_, AppState>,
    note_id: String,
    recipe_prompt: String,
) -> Result<String, String> {
    let (settings, note) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        (data.settings.clone(), n)
    };
    llm::run_recipe(&settings, &note, &recipe_prompt).await
}

fn apply_chat_actions(
    data: &mut AppDataSnapshot,
    specs: &[llm::ChatActionSpec],
    default_note_id: Option<&str>,
) -> Vec<models::ChatActionResult> {
    let mut results = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    for spec in specs {
        let target_note_id = spec
            .note_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or(default_note_id)
            .map(|s| s.to_string());

        match spec.kind.as_str() {
            "rename_note" => {
                if let (Some(nid), Some(new_title)) = (target_note_id, spec.title.as_deref().map(str::trim).filter(|s| !s.is_empty())) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        let old = note.title.clone();
                        note.title = new_title.to_string();
                        note.updated_at = now.clone();
                        storage::append_audit(data, "chat_rename_note", &format!("{nid}: {old} -> {new_title}"));
                        results.push(models::ChatActionResult {
                            action: "rename_note".into(),
                            target_id: Some(nid),
                            description: format!("ノート「{old}」のタイトルを「{new_title}」に変更しました"),
                            success: true,
                        });
                    }
                }
            }
            "move_note_folder" => {
                if let Some(nid) = target_note_id {
                    let resolved_folder = if let Some(fid) = spec.folder_id.as_deref().filter(|s| !s.trim().is_empty()) {
                        data.folders.iter().find(|f| f.id == fid).map(|f| (f.id.clone(), f.name.clone()))
                    } else if let Some(fname) = spec.folder_name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                        if let Some(existing) = data.folders.iter().find(|f| f.name == fname || f.id == fname) {
                            Some((existing.id.clone(), existing.name.clone()))
                        } else {
                            let new_fid = format!("folder-{}", uuid::Uuid::new_v4());
                            data.folders.push(Folder {
                                id: new_fid.clone(),
                                name: fname.to_string(),
                                is_shared: false,
                                permission: "owner".to_string(),
                            });
                            Some((new_fid, fname.to_string()))
                        }
                    } else {
                        None
                    };

                    if let Some((fid, fname)) = resolved_folder {
                        if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                            note.folder_id = fid;
                            note.updated_at = now.clone();
                            let note_title = note.title.clone();
                            storage::append_audit(data, "chat_move_folder", &format!("{nid} -> {fname}"));
                            results.push(models::ChatActionResult {
                                action: "move_note_folder".into(),
                                target_id: Some(nid),
                                description: format!("ノート「{note_title}」をカテゴリ「{fname}」へ移動しました"),
                                success: true,
                            });
                        }
                    }
                }
            }
            "create_folder" => {
                if let Some(fname) = spec.name.as_deref().or(spec.folder_name.as_deref()).map(str::trim).filter(|s| !s.is_empty()) {
                    if let Some(existing) = data.folders.iter().find(|f| f.name == fname) {
                        results.push(models::ChatActionResult {
                            action: "create_folder".into(),
                            target_id: Some(existing.id.clone()),
                            description: format!("カテゴリ「{fname}」は既に存在します"),
                            success: true,
                        });
                    } else {
                        let new_fid = format!("folder-{}", uuid::Uuid::new_v4());
                        data.folders.push(Folder {
                            id: new_fid.clone(),
                            name: fname.to_string(),
                            is_shared: false,
                            permission: "owner".to_string(),
                        });
                        storage::append_audit(data, "chat_create_folder", fname);
                        results.push(models::ChatActionResult {
                            action: "create_folder".into(),
                            target_id: Some(new_fid),
                            description: format!("カテゴリ「{fname}」を作成しました"),
                            success: true,
                        });
                    }
                }
            }
            "rename_folder" => {
                if let (Some(fid), Some(new_name)) = (spec.folder_id.as_deref(), spec.name.as_deref().map(str::trim).filter(|s| !s.is_empty())) {
                    if let Some(folder) = data.folders.iter_mut().find(|f| f.id == fid || f.name == fid) {
                        let old = folder.name.clone();
                        let actual_id = folder.id.clone();
                        folder.name = new_name.to_string();
                        storage::append_audit(data, "chat_rename_folder", &format!("{old} -> {new_name}"));
                        results.push(models::ChatActionResult {
                            action: "rename_folder".into(),
                            target_id: Some(actual_id),
                            description: format!("カテゴリ「{old}」を「{new_name}」に変更しました"),
                            success: true,
                        });
                    }
                }
            }
            "delete_folder" => {
                if let Some(fid) = spec.folder_id.as_deref().or(spec.folder_name.as_deref()) {
                    if let Some(pos) = data.folders.iter().position(|f| f.id == fid || f.name == fid) {
                        let removed = data.folders.remove(pos);
                        for n in &mut data.notes {
                            if n.folder_id == removed.id {
                                n.folder_id = "personal".to_string();
                            }
                        }
                        storage::append_audit(data, "chat_delete_folder", &removed.name);
                        results.push(models::ChatActionResult {
                            action: "delete_folder".into(),
                            target_id: Some(removed.id),
                            description: format!("カテゴリ「{}」を削除しました", removed.name),
                            success: true,
                        });
                    }
                }
            }
            "add_tags" => {
                if let (Some(nid), Some(tags)) = (target_note_id, spec.tags.as_ref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        for t in tags {
                            let clean = t.trim();
                            if !clean.is_empty() && !note.tags.iter().any(|x| x == clean) {
                                note.tags.push(clean.to_string());
                            }
                        }
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "add_tags".into(),
                            target_id: Some(nid),
                            description: format!("タグ [{}] を追加しました", tags.join(", ")),
                            success: true,
                        });
                    }
                }
            }
            "remove_tags" => {
                if let (Some(nid), Some(tags)) = (target_note_id, spec.tags.as_ref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.tags.retain(|x| !tags.iter().any(|t| t.trim() == x));
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "remove_tags".into(),
                            target_id: Some(nid),
                            description: format!("タグ [{}] を削除しました", tags.join(", ")),
                            success: true,
                        });
                    }
                }
            }
            "update_summary" => {
                if let (Some(nid), Some(summary)) = (target_note_id, spec.summary.as_deref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.summary = summary.trim().to_string();
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "update_summary".into(),
                            target_id: Some(nid),
                            description: format!("ノート「{}」の要約を更新しました", note.title),
                            success: true,
                        });
                    }
                }
            }
            "update_manual_notes" => {
                if let (Some(nid), Some(memo)) = (target_note_id, spec.manual_notes.as_deref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.manual_notes = memo.trim().to_string();
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "update_manual_notes".into(),
                            target_id: Some(nid),
                            description: format!("ノート「{}」のメモを更新しました", note.title),
                            success: true,
                        });
                    }
                }
            }
            "rename_speaker" => {
                if let (Some(nid), Some(from), Some(to)) = (
                    target_note_id,
                    spec.from_speaker.as_deref().map(str::trim),
                    spec.to_speaker.as_deref().map(str::trim),
                ) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        let mut count = 0usize;
                        for seg in &mut note.segments {
                            if seg.speaker.trim() == from {
                                seg.speaker = to.to_string();
                                count += 1;
                            }
                        }
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "rename_speaker".into(),
                            target_id: Some(nid),
                            description: format!("話者「{from}」を「{to}」に変更しました（{count}件）"),
                            success: true,
                        });
                    }
                }
            }
            "add_action_item" => {
                if let (Some(nid), Some(text)) = (target_note_id, spec.text.as_deref().map(str::trim).filter(|s| !s.is_empty())) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.action_items.push(models::ActionItem {
                            id: format!("act-{}", uuid::Uuid::new_v4()),
                            text: text.to_string(),
                            assignee: spec.assignee.clone().unwrap_or_default(),
                            done: false,
                        });
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "add_action_item".into(),
                            target_id: Some(nid),
                            description: format!("アクション項目「{text}」を追加しました"),
                            success: true,
                        });
                    }
                }
            }
            "create_note" => {
                let title = spec.title.as_deref().unwrap_or("新規ノート").trim().to_string();
                let fid = spec
                    .folder_id
                    .clone()
                    .or_else(|| {
                        spec.folder_name.as_deref().and_then(|fname| {
                            data.folders.iter().find(|f| f.name == fname).map(|f| f.id.clone())
                        })
                    })
                    .unwrap_or_else(|| "personal".to_string());
                let new_id = format!("note-{}", uuid::Uuid::new_v4());
                let note = Note {
                    id: new_id.clone(),
                    title: title.clone(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    duration_sec: 0,
                    folder_id: fid,
                    tags: spec.tags.clone().unwrap_or_default(),
                    participants: Vec::new(),
                    manual_notes: spec.manual_notes.clone().unwrap_or_default(),
                    segments: Vec::new(),
                    summary: spec.summary.clone().unwrap_or_default(),
                    decisions: Vec::new(),
                    action_items: Vec::new(),
                    follow_up_draft: String::new(),
                    asr_model_id: "chat-agent".to_string(),
                    asr_provider_label: "AIチャット作成".to_string(),
                    language: "ja".to_string(),
                    diarization_supported: false,
                    notion_sync: models::NotionSyncState::default(),
                    audio_path: None,
                    audio_encrypted: false,
                    storage_mode: "local".to_string(),
                };
                storage::upsert_note(data, note);
                results.push(models::ChatActionResult {
                    action: "create_note".into(),
                    target_id: Some(new_id),
                    description: format!("新規ノート「{title}」を作成しました"),
                    success: true,
                });
            }
            "delete_note" => {
                if let Some(nid) = target_note_id {
                    let title = data.notes.iter().find(|n| n.id == nid).map(|n| n.title.clone()).unwrap_or_else(|| nid.clone());
                    storage::delete_note(data, &nid);
                    results.push(models::ChatActionResult {
                        action: "delete_note".into(),
                        target_id: Some(nid),
                        description: format!("ノート「{title}」を削除しました"),
                        success: true,
                    });
                }
            }
            _ => {}
        }
    }

    results
}

#[tauri::command]
async fn chat_notes_cmd(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    note_ids: Vec<String>,
    question: String,
    space_id: Option<String>,
) -> Result<ChatAnswer, String> {
    let (settings, notes, folders) = {
        let data = state.data.lock().unwrap();
        let filtered: Vec<Note> = if !note_ids.is_empty() {
            data.notes
                .iter()
                .filter(|n| note_ids.contains(&n.id))
                .cloned()
                .collect()
        } else if let Some(ref sid) = space_id {
            data.notes
                .iter()
                .filter(|n| &n.folder_id == sid)
                .cloned()
                .collect()
        } else {
            data.notes.clone()
        };
        (data.settings.clone(), filtered, data.folders.clone())
    };
    let default_note_id = notes.first().map(|n| n.id.clone());
    let (mut ans, specs) = llm::chat_with_notes_and_actions(&settings, &notes, &folders, &question).await?;
    // Emit progressive streaming chunks so chat views render smoothly in real time
    let chars: Vec<char> = ans.answer.chars().collect();
    let step = (chars.len() / 16).max(6);
    let mut pos = 0;
    while pos < chars.len() {
        pos = (pos + step).min(chars.len());
        let partial: String = chars[..pos].iter().collect();
        let _ = app.emit("chat-stream-chunk", &partial);
        tokio::time::sleep(std::time::Duration::from_millis(12)).await;
    }
    let mut data = state.data.lock().unwrap();
    if !specs.is_empty() {
        ans.actions = apply_chat_actions(&mut data, &specs, default_note_id.as_deref());
    }
    data.chat_history.insert(
        0,
        ChatHistoryItem {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            space_id,
            question,
            answer: ans.answer.clone(),
            citations: ans.citations.clone(),
            actions: ans.actions.clone(),
            thinking: ans.thinking.clone(),
        },
    );
    if data.chat_history.len() > 200 {
        data.chat_history.truncate(200);
    }
    let _ = storage::save_snapshot(&data);
    Ok(ans)
}

#[tauri::command]
fn set_secret_cmd(key: String, value: String) -> Result<(), String> {
    secrets::set_secret(&key, &value)
}

#[tauri::command]
fn get_secret_status_cmd() -> serde_json::Value {
    serde_json::json!({
        "openai_api_key": secrets::has_secret("openai_api_key") || secrets::has_secret("llm_openai_api_key"),
        "deepgram_api_key": secrets::has_secret("deepgram_api_key"),
        "groq_api_key": secrets::has_secret("groq_api_key"),
        "stepfun_api_key": secrets::has_secret("stepfun_api_key"),
        "llm_openai_api_key": secrets::has_secret("llm_openai_api_key"),
        "llm_openai_compatible_api_key": secrets::has_secret("llm_openai_compatible_api_key"),
        "llm_anthropic_api_key": secrets::has_secret("llm_anthropic_api_key"),
        "llm_gemini_api_key": secrets::has_secret("llm_gemini_api_key"),
        "notion_access_token": notion::is_connected(),
        "slack_webhook_url": secrets::has_secret("slack_webhook_url"),
        "github_update_token": secrets::has_secret("github_update_token"),
        "granola_api_key": secrets::has_secret("granola_api_key"),
        "github_issue_token": secrets::has_secret("github_issue_token"),
        "linear_api_key": secrets::has_secret("linear_api_key"),
        "jira_api_token": secrets::has_secret("jira_api_token"),
    })
}

#[tauri::command]
async fn check_app_update() -> Result<updater::UpdateCheckResult, String> {
    updater::check_latest_release().await
}

#[tauri::command]
async fn install_app_update(
    app: tauri::AppHandle,
    download_url: String,
    asset_name: String,
) -> Result<String, String> {
    updater::download_and_launch_update(&app, &download_url, &asset_name).await
}

#[tauri::command]
fn notion_oauth_url(client_id: String, redirect_uri: String) -> String {
    notion::build_oauth_authorize_url(&client_id, &redirect_uri)
}

#[tauri::command]
async fn notion_exchange_code(
    client_id: String,
    client_secret: String,
    code: String,
    redirect_uri: String,
) -> Result<String, String> {
    notion::exchange_oauth_code(&client_id, &client_secret, &code, &redirect_uri).await
}

#[tauri::command]
async fn notion_search_targets(query: String) -> Result<Vec<NotionTarget>, String> {
    notion::search_targets(&query).await
}

fn strip_local_note_body(note: &mut Note) {
    if let Some(ref p) = note.audio_path {
        let _ = std::fs::remove_file(p);
    }
    note.audio_path = None;
    note.audio_encrypted = false;
    note.segments.clear();
    note.summary.clear();
    note.manual_notes.clear();
    note.decisions.clear();
    note.action_items.clear();
    note.follow_up_draft.clear();
    note.storage_mode = "notion_only".to_string();
}

#[tauri::command]
async fn notion_save_note(state: State<'_, AppState>, note_id: String) -> Result<Note, String> {
    let (settings, mut note, folder_name) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        let fname = data
            .folders
            .iter()
            .find(|f| f.id == n.folder_id)
            .map(|f| f.name.clone())
            .unwrap_or_else(|| "一般".to_string());
        (data.settings.clone(), n, fname)
    };

    match notion::save_note_to_notion(&note, &folder_name, &settings).await {
        Ok((page_id, page_url, synced_at)) => {
            let mut data = state.data.lock().unwrap();
            let result_note = if let Some(latest) = data.notes.iter_mut().find(|n| n.id == note.id) {
                let locally_edited_during_sync = latest.updated_at != note.updated_at
                    || latest.title != note.title
                    || latest.folder_id != note.folder_id;
                latest.notion_sync.page_id = Some(page_id);
                latest.notion_sync.page_url = Some(page_url);
                latest.notion_sync.database_id = Some(settings.notion_target_id.clone());
                latest.notion_sync.last_synced_at = Some(synced_at);
                latest.notion_sync.last_error = None;
                if locally_edited_during_sync {
                    latest.notion_sync.status = "not_synced".to_string();
                } else {
                    latest.notion_sync.status = "synced".to_string();
                    if settings.notion_viewer_mode || latest.storage_mode == "notion_only" {
                        strip_local_note_body(latest);
                    }
                }
                latest.clone()
            } else {
                note.notion_sync.page_id = Some(page_id);
                note.notion_sync.page_url = Some(page_url);
                note.notion_sync.database_id = Some(settings.notion_target_id.clone());
                note.notion_sync.last_synced_at = Some(synced_at);
                note.notion_sync.status = "synced".to_string();
                note.notion_sync.last_error = None;
                if settings.notion_viewer_mode || note.storage_mode == "notion_only" {
                    strip_local_note_body(&mut note);
                }
                storage::upsert_note(&mut data, note.clone());
                note
            };
            storage::append_audit(&mut data, "notion_synced", &format!("note_id={}", result_note.id));
            storage::save_snapshot(&data)?;
            Ok(result_note)
        }
        Err(err) => {
            let mut data = state.data.lock().unwrap();
            if let Some(latest) = data.notes.iter_mut().find(|n| n.id == note.id) {
                latest.notion_sync.status = "failed".to_string();
                latest.notion_sync.last_error = Some(err.clone());
            } else {
                note.notion_sync.status = "failed".to_string();
                note.notion_sync.last_error = Some(err.clone());
                storage::upsert_note(&mut data, note);
            }
            let _ = storage::save_snapshot(&data);
            Err(err)
        }
    }
}

#[tauri::command]
async fn fetch_notion_note_content(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Note, String> {
    let mut note = {
        let data = state.data.lock().unwrap();
        data.notes
            .iter()
            .find(|n| n.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?
    };
    let page_id = note
        .notion_sync
        .page_id
        .clone()
        .ok_or_else(|| "このノートはまだ Notion に保存されていません".to_string())?;
    let (title, _space_name, summary, manual_notes, segments, updated_at) =
        notion::fetch_notion_page_for_viewer(&page_id).await?;
    note.title = title;
    note.summary = summary;
    note.manual_notes = manual_notes;
    note.segments = segments;
    note.updated_at = updated_at;
    Ok(note)
}

#[tauri::command]
async fn set_note_storage_mode(
    state: State<'_, AppState>,
    note_id: String,
    notion_only: bool,
) -> Result<Note, String> {
    let (settings, mut note, folder_name) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        let fname = data
            .folders
            .iter()
            .find(|f| f.id == n.folder_id)
            .map(|f| f.name.clone())
            .unwrap_or_else(|| "一般".to_string());
        (data.settings.clone(), n, fname)
    };

    if notion_only {
        if note.notion_sync.page_id.is_none() || note.notion_sync.status != "synced" {
            let (page_id, page_url, synced_at) =
                notion::save_note_to_notion(&note, &folder_name, &settings).await?;
            note.notion_sync.page_id = Some(page_id);
            note.notion_sync.page_url = Some(page_url);
            note.notion_sync.database_id = Some(settings.notion_target_id.clone());
            note.notion_sync.last_synced_at = Some(synced_at);
            note.notion_sync.status = "synced".to_string();
            note.notion_sync.last_error = None;
        }
        strip_local_note_body(&mut note);
    } else {
        if let Some(ref page_id) = note.notion_sync.page_id {
            let (title, _space_name, summary, manual_notes, segments, updated_at) =
                notion::fetch_notion_page_for_viewer(page_id).await?;
            note.title = title;
            note.summary = summary;
            note.manual_notes = manual_notes;
            note.segments = segments;
            note.updated_at = updated_at;
        }
        note.storage_mode = "local".to_string();
    }

    let mut data = state.data.lock().unwrap();
    storage::upsert_note(&mut data, note.clone());
    storage::save_snapshot(&data)?;
    Ok(note)
}

#[tauri::command]
async fn purge_synced_local_notes(state: State<'_, AppState>) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    for n in &mut data.notes {
        if n.notion_sync.status == "synced" && n.notion_sync.page_id.is_some() {
            strip_local_note_body(n);
        }
    }
    storage::append_audit(&mut data, "purge_synced_local_notes", "converted synced notes to notion_only");
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

fn parse_rfc3339_millis(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

#[tauri::command]
async fn notion_pull_notes(state: State<'_, AppState>) -> Result<AppDataSnapshot, String> {
    let (settings, known_timestamps) = {
        let data = state.data.lock().unwrap();
        let mut map = std::collections::HashMap::new();
        for n in &data.notes {
            if let Some(ref pid) = n.notion_sync.page_id {
                map.insert(pid.clone(), n.updated_at.clone());
            }
        }
        (data.settings.clone(), map)
    };
    let pulled = notion::pull_notes_from_notion(&settings, &known_timestamps).await?;

    let mut pulled_page_ids = std::collections::HashSet::new();
    for (n, _, _) in &pulled {
        if let Some(pid) = &n.notion_sync.page_id {
            pulled_page_ids.insert(pid.clone());
        }
    }

    // Check if any locally synced notes missing from query results were archived/deleted in Notion
    let missing_synced: Vec<(String, String, String)> = {
        let data = state.data.lock().unwrap();
        data.notes
            .iter()
            .filter_map(|n| {
                let pid = n.notion_sync.page_id.as_ref()?;
                let db_matches = n.notion_sync.database_id.as_deref() == Some(settings.notion_target_id.as_str());
                if db_matches && n.notion_sync.status == "synced" && !pulled_page_ids.contains(pid) {
                    Some((n.id.clone(), pid.clone(), n.updated_at.clone()))
                } else {
                    None
                }
            })
            .collect()
    };

    let mut notion_deleted_note_ids = Vec::new();
    for (nid, pid, local_updated) in missing_synced {
        if let Ok(Some((archived, notion_edited))) = notion::fetch_page_archive_status(&pid).await {
            if archived && parse_rfc3339_millis(&notion_edited) > parse_rfc3339_millis(&local_updated) {
                notion_deleted_note_ids.push(nid);
            }
        }
    }

    let mut pages_to_archive_in_notion: Vec<String> = Vec::new();
    let mut notes_to_push_to_notion: Vec<(Note, String)> = Vec::new();

    {
        let mut data = state.data.lock().unwrap();

        for nid in notion_deleted_note_ids {
            storage::delete_note(&mut data, &nid);
        }

        for (mut note, space_name, blocks_loaded) in pulled {
            let notion_ts = parse_rfc3339_millis(&note.updated_at);
            let page_id_opt = note.notion_sync.page_id.clone();

            // Check local deletion tombstone first (Last-Write-Wins)
            if let Some(ref pid) = page_id_opt {
                if let Some(del_rec) = data
                    .deleted_notes
                    .iter()
                    .find(|d| d.notion_page_id.as_deref() == Some(pid.as_str()))
                    .cloned()
                {
                    let del_ts = parse_rfc3339_millis(&del_rec.deleted_at);
                    if del_ts >= notion_ts {
                        // Local deletion is newer -> keep deleted and archive on Notion
                        pages_to_archive_in_notion.push(pid.clone());
                        continue;
                    } else {
                        // Notion was re-edited after local deletion -> restore
                        data.deleted_notes
                            .retain(|d| d.notion_page_id.as_deref() != Some(pid.as_str()));
                    }
                }
            }

            if let Some(ref page_id) = page_id_opt {
                if let Some(existing_n) = data
                    .notes
                    .iter_mut()
                    .find(|n| n.notion_sync.page_id.as_ref() == Some(page_id))
                {
                    let local_ts = parse_rfc3339_millis(&existing_n.updated_at);
                    let has_pending_local_edits = existing_n.notion_sync.status != "synced";
                    if !blocks_loaded || has_pending_local_edits || local_ts >= notion_ts {
                        // Local is up-to-date, newer, or has pending unpushed edits -> preserve local title & folder_id
                        if existing_n.storage_mode != "notion_only"
                            && (has_pending_local_edits || local_ts > notion_ts)
                        {
                            let existing_clone = existing_n.clone();
                            let folder_name = data
                                .folders
                                .iter()
                                .find(|f| f.id == existing_clone.folder_id)
                                .map(|f| f.name.clone())
                                .unwrap_or_else(|| "一般".to_string());
                            notes_to_push_to_notion.push((existing_clone, folder_name));
                        }
                        continue;
                    }
                    // Notion is strictly newer and local has no pending edits -> update local note
                    let resolved_folder_id = if let Some(existing_f) = data.folders.iter().find(|f| f.name == space_name) {
                        existing_f.id.clone()
                    } else {
                        let new_f = Folder {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: space_name.clone(),
                            is_shared: false,
                            permission: "owner".to_string(),
                        };
                        let id = new_f.id.clone();
                        data.folders.push(new_f);
                        id
                    };
                    existing_n.title = note.title;
                    existing_n.folder_id = resolved_folder_id;
                    existing_n.updated_at = note.updated_at;
                    if existing_n.storage_mode != "notion_only" && !settings.notion_viewer_mode {
                        existing_n.summary = note.summary;
                        existing_n.manual_notes = note.manual_notes;
                        if !note.segments.is_empty() {
                            existing_n.segments = note.segments;
                        }
                    } else {
                        strip_local_note_body(existing_n);
                    }
                    existing_n.notion_sync.status = "synced".to_string();
                    existing_n.notion_sync.last_error = None;
                    continue;
                }
            }
            if blocks_loaded {
                let resolved_folder_id = if let Some(existing_f) = data.folders.iter().find(|f| f.name == space_name) {
                    existing_f.id.clone()
                } else {
                    let new_f = Folder {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: space_name.clone(),
                        is_shared: false,
                        permission: "owner".to_string(),
                    };
                    let id = new_f.id.clone();
                    data.folders.push(new_f);
                    id
                };
                note.folder_id = resolved_folder_id;
            }
            if data.settings.notion_viewer_mode {
                strip_local_note_body(&mut note);
            }
            data.notes.push(note);
        }
        data.notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        storage::save_snapshot(&data)?;
    }

    for pid in pages_to_archive_in_notion {
        let _ = notion::archive_notion_page(&pid).await;
    }
    for (local_note, folder_name) in notes_to_push_to_notion {
        if let Ok((page_id, page_url, synced_at)) =
            notion::save_note_to_notion(&local_note, &folder_name, &settings).await
        {
            let mut data = state.data.lock().unwrap();
            if let Some(n) = data.notes.iter_mut().find(|n| n.id == local_note.id) {
                n.notion_sync.page_id = Some(page_id);
                n.notion_sync.page_url = Some(page_url);
                n.notion_sync.database_id = Some(settings.notion_target_id.clone());
                n.notion_sync.last_synced_at = Some(synced_at);
                n.notion_sync.status = "synced".to_string();
                n.notion_sync.last_error = None;
            }
            let _ = storage::save_snapshot(&data);
        }
    }

    let data = state.data.lock().unwrap();
    Ok(data.clone())
}

#[tauri::command]
fn list_integration_adapters(state: State<AppState>) -> Vec<IntegrationAdapterInfo> {
    let data = state.data.lock().unwrap();
    integrations::list_adapters(&data.settings)
}

#[tauri::command]
async fn share_to_slack_cmd(state: State<'_, AppState>, note_id: String) -> Result<(), String> {
    let note = {
        let data = state.data.lock().unwrap();
        data.notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?
    };
    integrations::send_slack_share(&note).await
}

#[tauri::command]
async fn send_webhook_cmd(state: State<'_, AppState>, note_id: String) -> Result<(), String> {
    let (note, url) = {
        let data = state.data.lock().unwrap();
        let n = data
            .notes
            .iter()
            .find(|x| x.id == note_id)
            .cloned()
            .ok_or_else(|| "ノートが見つかりません".to_string())?;
        (n, data.settings.generic_webhook_url.clone())
    };
    integrations::send_generic_webhook(&note, &url).await
}

#[tauri::command]
fn get_mcp_config_preview(state: State<AppState>) -> String {
    let data = state.data.lock().unwrap();
    integrations::build_mcp_config_preview(&data.settings)
}

#[tauri::command]
fn copy_and_prepare_paste(app: tauri::AppHandle, text: String) -> Result<String, String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("クリップボードへの書き込みに失敗: {e}"))?;
    if cfg!(target_os = "macos") {
        Ok("クリップボードにコピーしました。他アプリへ貼り付けるには、貼り付け先を選択して Cmd+V を押してください（自動ペーストには macOS の「システム設定＞プライバシーとセキュリティ＞アクセシビリティ」許可が必要です）。".to_string())
    } else {
        Ok("クリップボードにコピーしました。貼り付け先の入力欄にフォーカスを移して Ctrl+V で貼り付けできます（アプリへ勝手に文字を送信しません）。".to_string())
    }
}

#[tauri::command]
fn export_all_data(state: State<AppState>) -> Result<String, String> {
    let data = state.data.lock().unwrap();
    storage::export_all_json(&data)
}

#[tauri::command]
fn purge_all_data(state: State<AppState>) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    for n in &data.notes {
        if let Some(ref p) = n.audio_path {
            storage::remove_file_if_exists(p);
        }
    }
    data.notes.clear();
    data.audit_logs.clear();
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

#[tauri::command]
fn get_storage_stats_cmd() -> StorageStats {
    storage::compute_storage_stats()
}

#[tauri::command]
fn open_storage_folder_cmd() -> Result<(), String> {
    let dir = storage::app_data_dir();
    let dir_str = dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn compress_retained_audio_cmd(state: State<AppState>) -> Result<serde_json::Value, String> {
    let mut data = state.data.lock().unwrap();
    let (count, saved_bytes) = storage::compress_all_retained_audio(&mut data)?;
    storage::save_snapshot(&data)?;
    let stats = storage::compute_storage_stats();
    Ok(serde_json::json!({
        "compressed_count": count,
        "saved_bytes": saved_bytes,
        "stats": stats,
    }))
}

#[tauri::command]
async fn get_upcoming_calendar_events_cmd(state: State<'_, AppState>) -> Result<Vec<CalendarEventMock>, String> {
    use chrono::{Local, Timelike};
    let ics_url = {
        let data = state.data.lock().unwrap();
        data.settings.calendar_ics_url.clone()
    };

    let now = Local::now();
    let hour = now.hour();
    let mut events = Vec::new();

    if let Some(active_app) = detect_active_meeting() {
        events.push(CalendarEventMock {
            id: "active-meeting".to_string(),
            title: format!("{} オンライン会議", active_app),
            start_time: format!("{:02}:00", hour),
            end_time: format!("{:02}:00", (hour + 1) % 24),
            participants: vec!["自分".to_string(), "相手".to_string()],
            provider: active_app,
        });
    }

    if !ics_url.trim().is_empty() {
        if let Ok(remote_events) = integrations::fetch_ics_calendar_events(&ics_url).await {
            events.extend(remote_events);
        }
    }

    // Parse local calendar.ics if user placed one in app_data_dir
    let ics_path = storage::app_data_dir().join("calendar.ics");
    if let Ok(ics_raw) = std::fs::read_to_string(&ics_path) {
        for block in ics_raw.split("BEGIN:VEVENT").skip(1).take(5) {
            let summary = block
                .lines()
                .find_map(|l| l.strip_prefix("SUMMARY:"))
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if !summary.is_empty() {
                events.push(CalendarEventMock {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: summary,
                    start_time: format!("{:02}:00", hour),
                    end_time: format!("{:02}:00", (hour + 1) % 24),
                    participants: vec!["自分".to_string()],
                    provider: "カレンダー (ICS)".to_string(),
                });
            }
        }
    }

    Ok(events)
}

#[tauri::command]
fn read_granola_local_cache_cmd() -> Result<String, String> {
    integrations::read_granola_local_cache()
}

#[tauri::command]
async fn fetch_granola_notes_cmd(api_key: Option<String>) -> Result<String, String> {
    integrations::fetch_granola_notes_api(api_key).await
}

#[tauri::command]
async fn create_issue_from_action_cmd(
    state: State<'_, AppState>,
    provider: String,
    title: String,
    body: String,
) -> Result<models::IssueCreateResult, String> {
    let settings = {
        let data = state.data.lock().unwrap();
        data.settings.clone()
    };
    let result = integrations::create_issue_from_action(&provider, &settings, &title, &body).await?;
    let mut data = state.data.lock().unwrap();
    storage::append_audit(&mut data, "issue_created", &format!("{}:{}", result.provider, result.key));
    storage::save_snapshot(&data)?;
    Ok(result)
}

#[tauri::command]
fn restore_backup_snapshot(
    state: State<'_, AppState>,
    snapshot: AppDataSnapshot,
) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    data.notes = snapshot.notes;
    data.folders = snapshot.folders;
    data.dictionary = snapshot.dictionary;
    data.recipes = snapshot.recipes;
    let notes_count = data.notes.len();
    storage::append_audit(&mut data, "backup_restored", &format!("notes={notes_count}"));
    storage::save_snapshot(&data)?;
    Ok(data.clone())
}

fn detect_active_meeting() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = r#"
$procs = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName, MainWindowTitle
foreach ($p in $procs) {
  $n = $p.ProcessName
  $t = $p.MainWindowTitle
  if ($n -match '^(Zoom|CptHost)$' -and $t -match 'Zoom') { Write-Output 'Zoom'; break }
  if ($n -match '^(ms-teams|Teams)$' -and $t -match '(Teams|会議|Meeting)') { Write-Output 'Microsoft Teams'; break }
  if ($n -match '^(webex|CiscoCollabHost)$') { Write-Output 'Webex'; break }
  if ($t -match 'Meet - |Google Meet') { Write-Output 'Google Meet'; break }
  if ($t -match 'Huddle|ハドル') { Write-Output 'Slack Huddle'; break }
}
"#;
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !text.is_empty() {
            return Some(text);
        }
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        let script = r#"tell application "System Events" to get name of every process whose visible is true"#;
        let out = std::process::Command::new("osascript")
            .args(["-e", script])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        for (needle, label) in [
            ("zoom.us", "Zoom"),
            ("Microsoft Teams", "Microsoft Teams"),
            ("Webex", "Webex"),
        ] {
            if text.contains(needle) {
                return Some(label.to_string());
            }
        }
        return None;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let snapshot = storage::load_snapshot();
    let app_state = AppState {
        audio: Mutex::new(AudioManager::new()),
        data: Mutex::new(snapshot),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("global-shortcut-triggered", shortcut.to_string());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let (shortcut_str, mw_x, mw_y, mw_w, mw_h) = {
                let state = app.state::<AppState>();
                let data = state.data.lock().unwrap();
                (
                    data.settings.record_shortcut.clone(),
                    data.settings.main_window_x,
                    data.settings.main_window_y,
                    data.settings.main_window_width,
                    data.settings.main_window_height,
                )
            };
            if !shortcut_str.is_empty() {
                let _ = app.global_shortcut().register(shortcut_str.as_str());
            }

            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_icon(tauri::include_image!("icons/icon.png"));
                if let (Some(w), Some(h)) = (mw_w, mw_h) {
                    if w >= 760.0 && h >= 480.0 && w <= 3840.0 && h <= 2160.0 {
                        let _ = main_win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
                    }
                }
                if let (Some(x), Some(y)) = (mw_x, mw_y) {
                    if x >= -100.0 && y >= -50.0 && x <= 3800.0 && y <= 2100.0 {
                        let _ = main_win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                    }
                }
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last_notified: Option<String> = None;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                    let is_rec = {
                        let st = app_handle.state::<AppState>();
                        let audio = st.audio.lock().unwrap();
                        let s = audio.status().state;
                        s == "recording" || s == "paused"
                    };
                    if is_rec {
                        continue;
                    }
                    let detected = tokio::task::spawn_blocking(detect_active_meeting)
                        .await
                        .ok()
                        .flatten();
                    match detected {
                        Some(meeting_label) => {
                            if last_notified.as_deref() != Some(meeting_label.as_str()) {
                                if let Some(win) = app_handle.get_webview_window("meeting-notify") {
                                    let is_visible = win.is_visible().unwrap_or(false);
                                    if !is_visible {
                                        last_notified = Some(meeting_label.clone());
                                        if let Ok(Some(monitor)) = app_handle.primary_monitor() {
                                            let scale = monitor.scale_factor();
                                            let sw = monitor.size().width as f64 / scale;
                                            let _ = win.set_position(tauri::Position::Logical(
                                                tauri::LogicalPosition::new((sw - 360.0).max(16.0), 24.0),
                                            ));
                                        }
                                        let _ = app_handle.emit_to("meeting-notify", "meeting-detected", meeting_label);
                                        let _ = win.show();
                                    }
                                }
                            }
                        }
                        None => {
                            last_notified = None;
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::Moved(pos) => {
                        if let Ok(scale) = window.scale_factor() {
                            let logical = pos.to_logical::<f64>(scale);
                            if logical.x > -10000.0 && logical.y > -10000.0 {
                                let st = window.app_handle().state::<AppState>();
                                if let Ok(mut data) = st.data.lock() {
                                    data.settings.main_window_x = Some(logical.x);
                                    data.settings.main_window_y = Some(logical.y);
                                };
                            }
                        }
                    }
                    tauri::WindowEvent::Resized(size) => {
                        if let Ok(scale) = window.scale_factor() {
                            let logical = size.to_logical::<f64>(scale);
                            if logical.width >= 760.0 && logical.height >= 480.0 {
                                let st = window.app_handle().state::<AppState>();
                                if let Ok(mut data) = st.data.lock() {
                                    data.settings.main_window_width = Some(logical.width);
                                    data.settings.main_window_height = Some(logical.height);
                                };
                            }
                        }
                    }
                    tauri::WindowEvent::CloseRequested { .. } => {
                        let st = window.app_handle().state::<AppState>();
                        if let Ok(data) = st.data.lock() {
                            let _ = storage::save_snapshot(&data);
                        };
                        window.app_handle().exit(0);
                    }
                    _ => {}
                }
            } else if window.label() == "recording-overlay" {
                if let tauri::WindowEvent::Moved(pos) = event {
                    if let Ok(scale) = window.scale_factor() {
                        let logical = pos.to_logical::<f64>(scale);
                        let st = window.app_handle().state::<AppState>();
                        if let Ok(mut data) = st.data.lock() {
                            data.settings.recording_overlay_x = Some(logical.x);
                            data.settings.recording_overlay_y = Some(logical.y);
                        };
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            save_settings,
            save_note,
            delete_note,
            save_dictionary_entry,
            delete_dictionary_entry,
            save_recipe,
            save_folder,
            delete_folder,
            clear_chat_history,
            delete_chat_history_items,
            list_audio_devices,
            start_recording,
            pause_recording,
            resume_recording,
            stop_recording,
            read_note_audio,
            open_external_url,
            get_recording_status,
            list_asr_models,
            download_asr_model,
            install_asr_runtime,
            detect_gpu_capabilities_cmd,
            transcribe_recording,
            transcribe_uploaded_audio,
            transcribe_uploaded_url,
            summarize_note_cmd,
            live_assist_cmd,
            draft_followup_cmd,
            run_recipe_cmd,
            chat_notes_cmd,
            set_secret_cmd,
            get_secret_status_cmd,
            notion_oauth_url,
            notion_exchange_code,
            notion_search_targets,
            notion_save_note,
            notion_pull_notes,
            fetch_notion_note_content,
            set_note_storage_mode,
            purge_synced_local_notes,
            list_integration_adapters,
            share_to_slack_cmd,
            send_webhook_cmd,
            get_mcp_config_preview,
            copy_and_prepare_paste,
            export_all_data,
            purge_all_data,
            get_storage_stats_cmd,
            open_storage_folder_cmd,
            compress_retained_audio_cmd,
            get_upcoming_calendar_events_cmd,
            read_granola_local_cache_cmd,
            fetch_granola_notes_cmd,
            create_issue_from_action_cmd,
            restore_backup_snapshot,
            check_app_update,
            install_app_update,
        ])
        .build(tauri::generate_context!())
        .expect("Notelet のビルド中にエラーが発生しました")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                whisper_server::stop_server_sync();
            }
        });
}
