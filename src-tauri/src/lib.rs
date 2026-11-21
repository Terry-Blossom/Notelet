mod asr;
mod audio;
mod integrations;
mod llm;
mod models;
mod notion;
mod secrets;
mod storage;
mod updater;

use audio::AudioManager;
use models::{
    AppDataSnapshot, AppSettings, AsrModelInfo, AudioDeviceInfo, AudioSourceMode, ChatAnswer,
    ChatHistoryItem, DictionaryEntry, Folder, IntegrationAdapterInfo, Note, Recipe,
    RecordingStatus,
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
    Ok(state.data.lock().unwrap().clone())
}

#[tauri::command]
fn save_note(state: State<AppState>, note: Note) -> Result<AppDataSnapshot, String> {
    let mut data = state.data.lock().unwrap();
    let id = note.id.clone();
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
        if let Ok(Some(monitor)) = app.primary_monitor() {
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
            let chunk_opt = {
                let audio = st_ref.audio.lock().unwrap();
                audio.take_live_chunk(32_000)
            };
            if let Some((chunk_path, elapsed_ms)) = chunk_opt {
                let (settings, dictionary) = {
                    let data = st_ref.data.lock().unwrap();
                    (data.settings.clone(), data.dictionary.clone())
                };
                let chunk_clone = chunk_path.clone();
                let res = tokio::task::spawn_blocking(move || {
                    let out = asr::transcribe_chunk_sync(&chunk_clone, &settings, &dictionary);
                    let _ = std::fs::remove_file(&chunk_clone);
                    out
                })
                .await;
                if let Ok(Ok(text)) = res {
                    if !text.is_empty() {
                        let start_ms = elapsed_ms.saturating_sub(2000);
                        let seg = models::TranscriptSegment {
                            id: uuid::Uuid::new_v4().to_string(),
                            start_ms,
                            end_ms: elapsed_ms,
                            speaker: String::new(),
                            text,
                        };
                        let _ = app_handle.emit("live-transcript-segment", seg);
                    }
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
        let _ = win.hide();
    }
    state.audio.lock().unwrap().stop()
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

    let path = std::path::PathBuf::from(&wav_path);
    let (segments, diarization_supported, model_name) =
        asr::transcribe_wav(&path, &settings, &dictionary).await?;

    let mut note = existing_note.ok_or_else(|| "対象ノートが見つかりません".to_string())?;
    note.segments = segments;
    note.diarization_supported = diarization_supported;
    note.asr_model_id = settings.active_asr_model_id.clone();
    note.asr_provider_label = model_name;
    note.updated_at = chrono::Utc::now().to_rfc3339();

    if settings.delete_audio_after_transcribe {
        storage::remove_file_if_exists(&wav_path);
        note.audio_path = None;
        note.audio_encrypted = false;
    } else {
        let (retained_path, encrypted) =
            storage::retain_audio_file(&path, &note.id, settings.encrypt_retained_audio)?;
        storage::remove_file_if_exists(&wav_path);
        note.audio_path = Some(retained_path);
        note.audio_encrypted = encrypted;
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
    let (summary, decisions, action_items) = llm::summarize_note(&settings, &note).await?;
    note.summary = summary;
    note.decisions = decisions;
    note.action_items = action_items;
    note.updated_at = chrono::Utc::now().to_rfc3339();

    let mut data = state.data.lock().unwrap();
    storage::upsert_note(&mut data, note.clone());
    storage::save_snapshot(&data)?;
    Ok(note)
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

#[tauri::command]
async fn chat_notes_cmd(
    state: State<'_, AppState>,
    note_ids: Vec<String>,
    question: String,
    space_id: Option<String>,
) -> Result<ChatAnswer, String> {
    let (settings, notes) = {
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
        (data.settings.clone(), filtered)
    };
    let ans = llm::chat_with_notes(&settings, &notes, &question).await?;
    let mut data = state.data.lock().unwrap();
    data.chat_history.insert(
        0,
        ChatHistoryItem {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            space_id,
            question,
            answer: ans.answer.clone(),
            citations: ans.citations.clone(),
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
        "openai_api_key": secrets::has_secret("openai_api_key"),
        "deepgram_api_key": secrets::has_secret("deepgram_api_key"),
        "groq_api_key": secrets::has_secret("groq_api_key"),
        "llm_openai_api_key": secrets::has_secret("llm_openai_api_key"),
        "llm_openai_compatible_api_key": secrets::has_secret("llm_openai_compatible_api_key"),
        "llm_anthropic_api_key": secrets::has_secret("llm_anthropic_api_key"),
        "llm_gemini_api_key": secrets::has_secret("llm_gemini_api_key"),
        "notion_access_token": notion::is_connected(),
        "slack_webhook_url": secrets::has_secret("slack_webhook_url"),
        "github_update_token": secrets::has_secret("github_update_token"),
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
            note.notion_sync.page_id = Some(page_id);
            note.notion_sync.page_url = Some(page_url);
            note.notion_sync.database_id = Some(settings.notion_target_id.clone());
            note.notion_sync.last_synced_at = Some(synced_at);
            note.notion_sync.status = "synced".to_string();
            note.notion_sync.last_error = None;
            let mut data = state.data.lock().unwrap();
            storage::upsert_note(&mut data, note.clone());
            storage::append_audit(&mut data, "notion_synced", &format!("note_id={}", note.id));
            storage::save_snapshot(&data)?;
            Ok(note)
        }
        Err(err) => {
            note.notion_sync.status = "failed".to_string();
            note.notion_sync.last_error = Some(err.clone());
            let mut data = state.data.lock().unwrap();
            storage::upsert_note(&mut data, note);
            let _ = storage::save_snapshot(&data);
            Err(err)
        }
    }
}

fn parse_rfc3339_millis(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

#[tauri::command]
async fn notion_pull_notes(state: State<'_, AppState>) -> Result<AppDataSnapshot, String> {
    let settings = {
        let data = state.data.lock().unwrap();
        data.settings.clone()
    };
    let pulled = notion::pull_notes_from_notion(&settings).await?;

    let mut pulled_page_ids = std::collections::HashSet::new();
    for (n, _) in &pulled {
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

        for (mut note, space_name) in pulled {
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

            // Find or create folder for space_name
            let folder_id = if let Some(existing_f) = data.folders.iter().find(|f| f.name == space_name) {
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
            note.folder_id = folder_id;

            if let Some(ref page_id) = page_id_opt {
                if let Some(existing_n) = data
                    .notes
                    .iter_mut()
                    .find(|n| n.notion_sync.page_id.as_ref() == Some(page_id))
                {
                    let local_ts = parse_rfc3339_millis(&existing_n.updated_at);
                    if notion_ts > local_ts {
                        // Notion is newer -> update local note
                        existing_n.title = note.title;
                        existing_n.folder_id = note.folder_id;
                        existing_n.updated_at = note.updated_at;
                        existing_n.summary = note.summary;
                        existing_n.manual_notes = note.manual_notes;
                        if !note.segments.is_empty() {
                            existing_n.segments = note.segments;
                        }
                        existing_n.notion_sync.status = "synced".to_string();
                        existing_n.notion_sync.last_error = None;
                    } else if local_ts > notion_ts {
                        // Local is newer -> keep local and push back to Notion
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
            let shortcut_str = {
                let state = app.state::<AppState>();
                let data = state.data.lock().unwrap();
                data.settings.record_shortcut.clone()
            };
            if !shortcut_str.is_empty() {
                let _ = app.global_shortcut().register(shortcut_str.as_str());
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
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
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
            list_audio_devices,
            start_recording,
            pause_recording,
            resume_recording,
            stop_recording,
            get_recording_status,
            list_asr_models,
            download_asr_model,
            install_asr_runtime,
            transcribe_recording,
            transcribe_uploaded_audio,
            transcribe_uploaded_url,
            summarize_note_cmd,
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
            list_integration_adapters,
            share_to_slack_cmd,
            send_webhook_cmd,
            get_mcp_config_preview,
            copy_and_prepare_paste,
            export_all_data,
            purge_all_data,
            check_app_update,
            install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("Notelet の起動中にエラーが発生しました");
}
