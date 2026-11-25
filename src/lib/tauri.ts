import { invoke } from '@tauri-apps/api/core';
import {
  AppDataSnapshot,
  AppSettings,
  AsrModelInfo,
  AudioDeviceInfo,
  AudioSourceMode,
  CalendarEventItem,
  ChatAnswer,
  DictionaryEntry,
  Folder,
  GpuCapabilities,
  IntegrationAdapterInfo,
  IssueCreateResult,
  LiveAssistResult,
  Note,
  NotionTarget,
  Recipe,
  RecordingStatus,
  SecretStatus,
  StorageStats,
  TranscriptSegment,
  UpdateCheckResult,
} from '../types';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function apiGetSnapshot(): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('get_snapshot');
}

export async function apiSaveSettings(settings: AppSettings): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('save_settings', { settings });
}

export async function apiSaveNote(note: Note): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('save_note', { note });
}

export async function apiDeleteNote(noteId: string): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('delete_note', { noteId });
}

export async function apiSaveDictionaryEntry(entry: DictionaryEntry): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('save_dictionary_entry', { entry });
}

export async function apiDeleteDictionaryEntry(entryId: string): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('delete_dictionary_entry', { entryId });
}

export async function apiSaveRecipe(recipe: Recipe): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('save_recipe', { recipe });
}

export async function apiSaveFolder(folder: Folder): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('save_folder', { folder });
}

export async function apiDeleteFolder(folderId: string): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('delete_folder', { folderId });
}

export async function apiClearChatHistory(): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('clear_chat_history');
}

export async function apiDeleteChatHistoryItems(itemIds: string[]): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('delete_chat_history_items', { itemIds });
}

export async function apiListAudioDevices(): Promise<AudioDeviceInfo[]> {
  return invoke<AudioDeviceInfo[]>('list_audio_devices');
}

export async function apiStartRecording(
  sourceMode: AudioSourceMode,
  deviceId: string | null
): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('start_recording', { sourceMode, deviceId });
}

export async function apiPauseRecording(): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('pause_recording');
}

export async function apiResumeRecording(): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('resume_recording');
}

export async function apiStopRecording(): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('stop_recording');
}

export async function apiGetRecordingStatus(): Promise<RecordingStatus> {
  return invoke<RecordingStatus>('get_recording_status');
}

export async function apiListAsrModels(): Promise<AsrModelInfo[]> {
  return invoke<AsrModelInfo[]>('list_asr_models');
}

export async function apiDownloadAsrModel(modelId: string): Promise<string> {
  return invoke<string>('download_asr_model', { modelId });
}

export async function apiInstallAsrRuntime(kind: 'whisper' | 'parakeet'): Promise<string> {
  return invoke<string>('install_asr_runtime', { kind });
}

export async function apiDetectGpuCapabilities(): Promise<GpuCapabilities> {
  return invoke<GpuCapabilities>('detect_gpu_capabilities_cmd');
}

export async function apiTranscribeRecording(wavPath: string, noteId: string): Promise<Note> {
  return invoke<Note>('transcribe_recording', { wavPath, noteId });
}

export async function apiTranscribeUploadedAudio(
  fileName: string,
  bytes: number[],
  noteId: string
): Promise<Note> {
  return invoke<Note>('transcribe_uploaded_audio', { fileName, bytes, noteId });
}

export async function apiTranscribeUploadedUrl(url: string, noteId: string): Promise<Note> {
  return invoke<Note>('transcribe_uploaded_url', { url, noteId });
}

export async function apiSummarizeNote(noteId: string, templateId?: string): Promise<Note> {
  return invoke<Note>('summarize_note_cmd', { noteId, templateId: templateId ?? null });
}

export async function apiLiveAssist(
  noteId: string,
  liveSegments?: TranscriptSegment[]
): Promise<LiveAssistResult> {
  return invoke<LiveAssistResult>('live_assist_cmd', {
    noteId,
    liveSegments: liveSegments ?? null,
  });
}

export async function apiDraftFollowup(noteId: string): Promise<Note> {
  return invoke<Note>('draft_followup_cmd', { noteId });
}

export async function apiRunRecipe(noteId: string, recipePrompt: string): Promise<string> {
  return invoke<string>('run_recipe_cmd', { noteId, recipePrompt });
}

export async function apiChatNotes(
  noteIds: string[],
  question: string,
  spaceId?: string | null
): Promise<ChatAnswer> {
  return invoke<ChatAnswer>('chat_notes_cmd', { noteIds, question, spaceId: spaceId ?? null });
}

export async function apiSetSecret(key: string, value: string): Promise<void> {
  return invoke<void>('set_secret_cmd', { key, value });
}

export async function apiGetSecretStatus(): Promise<SecretStatus> {
  return invoke<SecretStatus>('get_secret_status_cmd');
}

export async function apiNotionOAuthUrl(clientId: string, redirectUri: string): Promise<string> {
  return invoke<string>('notion_oauth_url', { clientId, redirectUri });
}

export async function apiNotionExchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<string> {
  return invoke<string>('notion_exchange_code', { clientId, clientSecret, code, redirectUri });
}

export async function apiNotionSearchTargets(query: string): Promise<NotionTarget[]> {
  return invoke<NotionTarget[]>('notion_search_targets', { query });
}

export async function apiNotionSaveNote(noteId: string): Promise<Note> {
  return invoke<Note>('notion_save_note', { noteId });
}

export async function apiNotionPullNotes(): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('notion_pull_notes');
}

export async function apiFetchNotionNoteContent(noteId: string): Promise<Note> {
  return invoke<Note>('fetch_notion_note_content', { noteId });
}

export async function apiSetNoteStorageMode(noteId: string, notionOnly: boolean): Promise<Note> {
  return invoke<Note>('set_note_storage_mode', { noteId, notionOnly });
}

export async function apiPurgeSyncedLocalNotes(): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('purge_synced_local_notes');
}

export async function apiListIntegrationAdapters(): Promise<IntegrationAdapterInfo[]> {
  return invoke<IntegrationAdapterInfo[]>('list_integration_adapters');
}

export async function apiShareToSlack(noteId: string): Promise<void> {
  return invoke<void>('share_to_slack_cmd', { noteId });
}

export async function apiSendWebhook(noteId: string): Promise<void> {
  return invoke<void>('send_webhook_cmd', { noteId });
}

export async function apiGetMcpConfigPreview(): Promise<string> {
  return invoke<string>('get_mcp_config_preview');
}

export async function apiCopyAndPreparePaste(text: string): Promise<string> {
  return invoke<string>('copy_and_prepare_paste', { text });
}

export async function apiExportAllData(): Promise<string> {
  return invoke<string>('export_all_data');
}

export async function apiPurgeAllData(): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('purge_all_data');
}

export async function apiCheckAppUpdate(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>('check_app_update');
}

export async function apiInstallAppUpdate(
  downloadUrl: string,
  assetName: string
): Promise<string> {
  return invoke<string>('install_app_update', { downloadUrl, assetName });
}

export async function apiReadNoteAudio(noteId: string): Promise<string> {
  return invoke<string>('read_note_audio', { noteId });
}

export async function apiOpenExternalUrl(url: string): Promise<void> {
  return invoke<void>('open_external_url', { url });
}

export async function apiGetStorageStats(): Promise<StorageStats> {
  return invoke<StorageStats>('get_storage_stats_cmd');
}

export async function apiOpenStorageFolder(): Promise<void> {
  return invoke<void>('open_storage_folder_cmd');
}

export async function apiCompressRetainedAudio(): Promise<{
  compressed_count: number;
  saved_bytes: number;
  stats: StorageStats;
}> {
  return invoke<{
    compressed_count: number;
    saved_bytes: number;
    stats: StorageStats;
  }>('compress_retained_audio_cmd');
}

export async function apiGetUpcomingCalendarEvents(): Promise<CalendarEventItem[]> {
  return invoke<CalendarEventItem[]>('get_upcoming_calendar_events_cmd');
}

export async function apiReadGranolaLocalCache(): Promise<string> {
  return invoke<string>('read_granola_local_cache_cmd');
}

export async function apiFetchGranolaNotes(apiKey?: string): Promise<string> {
  return invoke<string>('fetch_granola_notes_cmd', { apiKey: apiKey ?? null });
}

export async function apiCreateIssueFromAction(
  provider: string,
  title: string,
  body: string
): Promise<IssueCreateResult> {
  return invoke<IssueCreateResult>('create_issue_from_action_cmd', { provider, title, body });
}

export async function apiRestoreBackupSnapshot(snapshot: AppDataSnapshot): Promise<AppDataSnapshot> {
  return invoke<AppDataSnapshot>('restore_backup_snapshot', { snapshot });
}

export async function apiTestCloudAsrConnection(provider: string): Promise<string> {
  return invoke<string>('test_cloud_asr_connection_cmd', { provider });
}

export async function apiTestLlmConnection(): Promise<string> {
  return invoke<string>('test_llm_connection_cmd');
}

export async function apiTestMicLevel(
  deviceId?: string | null
): Promise<{ rms: number; device_name: string }> {
  return invoke<{ rms: number; device_name: string }>('test_mic_level_cmd', {
    deviceId: deviceId ?? null,
  });
}
