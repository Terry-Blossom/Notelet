export type PlanTier = 'basic' | 'business' | 'enterprise';
export type AudioSourceMode = 'mic' | 'system' | 'both';
export type AsrProviderKind =
  | 'local_whisper'
  | 'local_parakeet'
  | 'local_qwen'
  | 'cloud_openai'
  | 'cloud_deepgram'
  | 'cloud_groq';

export interface AudioDeviceInfo {
  id: string;
  name: string;
  kind: 'input' | 'loopback';
  is_default: boolean;
}

export interface RecordingStatus {
  state: 'idle' | 'recording' | 'paused' | 'error';
  elapsed_ms: number;
  level_rms: number;
  waveform: number[];
  device_name: string;
  source_mode: AudioSourceMode;
  is_silent_warning: boolean;
  error_message: string | null;
  recovery_hint: string | null;
  temp_wav_path: string | null;
}

export interface AsrModelInfo {
  id: string;
  name: string;
  provider: AsrProviderKind;
  is_local: boolean;
  languages: string[];
  environment: string;
  memory_mb: number;
  license: string;
  size_mb: number;
  download_url: string;
  filename: string;
  supports_realtime: boolean;
  supports_diarization: boolean;
  is_compatible: boolean;
  compatibility_reason: string | null;
  installed: boolean;
  data_handling: string;
}

export interface TranscriptSegment {
  id: string;
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

export interface ActionItem {
  id: string;
  text: string;
  assignee: string;
  done: boolean;
}

export interface NotionSyncState {
  page_id: string | null;
  page_url: string | null;
  database_id: string | null;
  last_synced_at: string | null;
  status: 'not_synced' | 'syncing' | 'synced' | 'failed';
  last_error: string | null;
}

export interface Note {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  duration_sec: number;
  folder_id: string;
  tags: string[];
  participants: string[];
  manual_notes: string;
  segments: TranscriptSegment[];
  summary: string;
  decisions: string[];
  action_items: ActionItem[];
  follow_up_draft: string;
  asr_model_id: string;
  asr_provider_label: string;
  language: string;
  diarization_supported: boolean;
  notion_sync: NotionSyncState;
  audio_path: string | null;
  audio_encrypted: boolean;
}

export interface Folder {
  id: string;
  name: string;
  is_shared: boolean;
  permission: 'owner' | 'editor' | 'viewer';
}

export interface DictionaryEntry {
  id: string;
  term: string;
  reading: string;
  note: string;
  scope: 'personal' | 'workspace';
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  prompt: string;
  is_builtin: boolean;
}

export interface NotionPropertyMapping {
  title_prop: string;
  date_prop: string;
  participants_prop: string;
  summary_prop: string;
  actions_prop: string;
}

export interface AppSettings {
  plan_tier: PlanTier;
  active_asr_model_id: string;
  active_asr_provider: AsrProviderKind;
  language: string;
  allow_cloud_asr: boolean;
  llm_provider: string;
  llm_model: string;
  llm_endpoint: string;
  record_shortcut: string;
  voice_typing_shortcut: string;
  delete_audio_after_transcribe: boolean;
  encrypt_retained_audio: boolean;
  retention_days: number;
  participant_notice_enabled: boolean;
  participant_notice_text: string;
  admin_enforced_notice: boolean;
  opt_out_model_training: boolean;
  org_opt_out_model_training: boolean;
  copy_format: 'markdown' | 'plain';
  notion_target_id: string;
  notion_target_type: 'database' | 'page';
  notion_target_name: string;
  notion_mapping: NotionPropertyMapping;
  whisper_cli_path: string;
  parakeet_cli_path: string;
  slack_webhook_configured: boolean;
  generic_webhook_url: string;
  mcp_enabled: boolean;
  mcp_scope: string;
  active_template_id: string;
  recording_overlay_x?: number | null;
  recording_overlay_y?: number | null;
  llm_custom_prompt?: string;
  main_window_x?: number | null;
  main_window_y?: number | null;
  main_window_width?: number | null;
  main_window_height?: number | null;
  user_speaker_name?: string;
  remote_speaker_name?: string;
  calendar_ics_url?: string;
  github_repo?: string;
  linear_team_id?: string;
  jira_base_url?: string;
  jira_email?: string;
  jira_project_key?: string;
  enable_local_diarization?: boolean;
}

export interface IssueCreateResult {
  provider: string;
  key: string;
  url: string;
}

export interface StorageStats {
  audio_bytes: number;
  audio_count: number;
  models_bytes: number;
  data_dir: string;
}

export interface LiveAssistResult {
  summary_points: string[];
  next_questions: string[];
}

export interface CalendarEventItem {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  participants: string[];
  provider: string;
}

export interface IntegrationAdapterInfo {
  id: string;
  name: string;
  category: string;
  status: 'implemented' | 'adapter_ready' | 'unimplemented';
  min_plan: PlanTier;
  description: string;
  required_config: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  detail: string;
}

export interface ChatCitation {
  note_id: string;
  note_title: string;
  timestamp: string;
  excerpt: string;
}

export interface ChatAnswer {
  answer: string;
  citations: ChatCitation[];
}

export interface ChatHistoryItem {
  id: string;
  timestamp: string;
  space_id?: string | null;
  question: string;
  answer: string;
  citations: ChatCitation[];
}

export interface AppDataSnapshot {
  notes: Note[];
  folders: Folder[];
  dictionary: DictionaryEntry[];
  recipes: Recipe[];
  settings: AppSettings;
  audit_logs: AuditEvent[];
  chat_history?: ChatHistoryItem[];
}

export interface NotionTarget {
  id: string;
  title: string;
  object_type: 'database' | 'page';
  url: string;
}

export interface SecretStatus {
  openai_api_key: boolean;
  deepgram_api_key: boolean;
  groq_api_key: boolean;
  llm_openai_api_key: boolean;
  llm_openai_compatible_api_key: boolean;
  llm_anthropic_api_key: boolean;
  llm_gemini_api_key: boolean;
  notion_access_token: boolean;
  slack_webhook_url: boolean;
  github_update_token?: boolean;
  granola_api_key?: boolean;
  github_issue_token?: boolean;
  linear_api_key?: boolean;
  jira_api_token?: boolean;
}

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  release_url: string;
  asset_name: string | null;
  download_url: string | null;
}
