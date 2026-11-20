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
    DictionaryEntry, IntegrationAdapterInfo, Note, Recipe, RecordingStatus,
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
    if storage::delete_note(&mut data, &note_id) {
        storage::append_audit(&mut data, "note_deleted", &format!("note_id={note_id}"));
        storage::save_snapshot(&data)?;
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
fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    AudioManager::list_devices()
}

#[tauri::command]
fn start_recording(
    app: tauri::AppHandle,
    state: State<AppState>,
    source_mode: AudioSourceMode,
    device_id: Option<String>,
) -> Result<RecordingStatus, String> {
    let status = {
        let mut audio = state.audio.lock().unwrap();
        audio.start(source_mode, device_id)?
    };

    let app_handle = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
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
                audio.take_live_chunk(48_000)
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
                        let start_ms = elapsed_ms.saturating_sub(3000);
                        let seg = models::TranscriptSegment {
                            id: uuid::Uuid::new_v4().to_string(),
                            start_ms,
                            end_ms: elapsed_ms,
                            speaker: "話者1".to_string(),
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
fn stop_recording(state: State<AppState>) -> RecordingStatus {
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
) -> Result<ChatAnswer, String> {
    let (settings, notes) = {
        let data = state.data.lock().unwrap();
        let filtered: Vec<Note> = if note_ids.is_empty() {
            data.notes.clone()
        } else {
            data.notes
                .iter()
                .filter(|n| note_ids.contains(&n.id))
                .cloned()
                .collect()
        };
        (data.settings.clone(), filtered)
    };
    llm::chat_with_notes(&settings, &notes, &question).await
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

    match notion::save_note_to_notion(&note, &settings).await {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            save_settings,
            save_note,
            delete_note,
            save_dictionary_entry,
            delete_dictionary_entry,
            save_recipe,
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
        .expect("KoeNote の起動中にエラーが発生しました");
}
