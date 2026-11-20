import { invoke } from '@tauri-apps/api/core';
import {
  AppDataSnapshot,
  AppSettings,
  AsrModelInfo,
  AudioDeviceInfo,
  AudioSourceMode,
  ChatAnswer,
  DictionaryEntry,
  IntegrationAdapterInfo,
  Note,
  NotionTarget,
  Recipe,
  RecordingStatus,
  SecretStatus,
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

export async function apiSummarizeNote(noteId: string): Promise<Note> {
  return invoke<Note>('summarize_note_cmd', { noteId });
}

export async function apiDraftFollowup(noteId: string): Promise<Note> {
  return invoke<Note>('draft_followup_cmd', { noteId });
}

export async function apiRunRecipe(noteId: string, recipePrompt: string): Promise<string> {
  return invoke<string>('run_recipe_cmd', { noteId, recipePrompt });
}

export async function apiChatNotes(noteIds: string[], question: string): Promise<ChatAnswer> {
  return invoke<ChatAnswer>('chat_notes_cmd', { noteIds, question });
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
