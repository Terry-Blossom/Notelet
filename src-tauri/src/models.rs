use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanTier {
    Basic,
    Business,
    Enterprise,
}

impl Default for PlanTier {
    fn default() -> Self {
        Self::Basic
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AudioSourceMode {
    Mic,
    System,
    Both,
}

impl Default for AudioSourceMode {
    fn default() -> Self {
        Self::Mic
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // "input" | "loopback"
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingStatus {
    pub state: String, // "idle" | "recording" | "paused" | "error"
    pub elapsed_ms: u64,
    pub level_rms: f32,
    pub waveform: Vec<f32>,
    pub device_name: String,
    pub source_mode: AudioSourceMode,
    pub is_silent_warning: bool,
    pub error_message: Option<String>,
    pub recovery_hint: Option<String>,
    pub temp_wav_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AsrProviderKind {
    LocalWhisper,
    LocalParakeet,
    LocalQwen,
    CloudOpenAi,
    CloudDeepgram,
    CloudGroq,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrModelInfo {
    pub id: String,
    pub name: String,
    pub provider: AsrProviderKind,
    pub is_local: bool,
    pub languages: Vec<String>,
    pub environment: String,
    pub memory_mb: u32,
    pub license: String,
    pub size_mb: u32,
    pub download_url: String,
    pub filename: String,
    pub supports_realtime: bool,
    pub supports_diarization: bool,
    pub is_compatible: bool,
    pub compatibility_reason: Option<String>,
    pub installed: bool,
    pub data_handling: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub id: String,
    pub text: String,
    pub assignee: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotionSyncState {
    pub page_id: Option<String>,
    pub page_url: Option<String>,
    pub database_id: Option<String>,
    pub last_synced_at: Option<String>,
    pub status: String, // "not_synced" | "syncing" | "synced" | "failed"
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub duration_sec: u64,
    pub folder_id: String,
    pub tags: Vec<String>,
    pub participants: Vec<String>,
    pub manual_notes: String,
    pub segments: Vec<TranscriptSegment>,
    pub summary: String,
    pub decisions: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub follow_up_draft: String,
    pub asr_model_id: String,
    pub asr_provider_label: String,
    pub language: String,
    pub diarization_supported: bool,
    pub notion_sync: NotionSyncState,
    pub audio_path: Option<String>,
    pub audio_encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub is_shared: bool,
    pub permission: String, // "owner" | "editor" | "viewer"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub id: String,
    pub term: String,
    pub reading: String,
    pub note: String,
    pub scope: String, // "personal" | "workspace"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEventMock {
    pub id: String,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub participants: Vec<String>,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionPropertyMapping {
    pub title_prop: String,
    pub date_prop: String,
    pub participants_prop: String,
    pub summary_prop: String,
    pub actions_prop: String,
}

impl Default for NotionPropertyMapping {
    fn default() -> Self {
        Self {
            title_prop: "Name".to_string(),
            date_prop: "Date".to_string(),
            participants_prop: "Participants".to_string(),
            summary_prop: "Summary".to_string(),
            actions_prop: "Action Items".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub plan_tier: PlanTier,
    pub active_asr_model_id: String,
    pub active_asr_provider: AsrProviderKind,
    pub language: String, // "auto" | "ja" | "en"
    pub allow_cloud_asr: bool,
    pub llm_provider: String, // "none" | "openai" | "anthropic" | "gemini" | "ollama"
    pub llm_model: String,
    pub llm_endpoint: String,
    pub record_shortcut: String,
    pub voice_typing_shortcut: String,
    pub delete_audio_after_transcribe: bool,
    pub encrypt_retained_audio: bool,
    pub retention_days: u32, // 0 = unlimited
    pub participant_notice_enabled: bool,
    pub participant_notice_text: String,
    pub admin_enforced_notice: bool,
    pub opt_out_model_training: bool,
    pub org_opt_out_model_training: bool,
    pub copy_format: String, // "markdown" | "plain"
    pub notion_target_id: String,
    pub notion_target_type: String, // "database" | "page"
    pub notion_target_name: String,
    pub notion_mapping: NotionPropertyMapping,
    pub whisper_cli_path: String,
    pub parakeet_cli_path: String,
    pub slack_webhook_configured: bool,
    pub generic_webhook_url: String,
    pub mcp_enabled: bool,
    pub mcp_scope: String, // "personal_30d" | "workspace" | "admin_custom"
    pub active_template_id: String,
    #[serde(default)]
    pub recording_overlay_x: Option<f64>,
    #[serde(default)]
    pub recording_overlay_y: Option<f64>,
    #[serde(default)]
    pub llm_custom_prompt: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            plan_tier: PlanTier::Basic,
            active_asr_model_id: "whisper-small-q5".to_string(),
            active_asr_provider: AsrProviderKind::LocalWhisper,
            language: "ja".to_string(),
            allow_cloud_asr: false,
            llm_provider: "none".to_string(),
            llm_model: "gpt-4o-mini".to_string(),
            llm_endpoint: "http://localhost:11434".to_string(),
            record_shortcut: "CommandOrControl+Shift+R".to_string(),
            voice_typing_shortcut: "CommandOrControl+Shift+V".to_string(),
            delete_audio_after_transcribe: false,
            encrypt_retained_audio: true,
            retention_days: 0,
            participant_notice_enabled: false,
            participant_notice_text: "この会話はメモ作成のために録音・文字起こしを行っています。".to_string(),
            admin_enforced_notice: false,
            opt_out_model_training: true,
            org_opt_out_model_training: true,
            copy_format: "markdown".to_string(),
            notion_target_id: String::new(),
            notion_target_type: "database".to_string(),
            notion_target_name: String::new(),
            notion_mapping: NotionPropertyMapping::default(),
            whisper_cli_path: String::new(),
            parakeet_cli_path: String::new(),
            slack_webhook_configured: false,
            generic_webhook_url: String::new(),
            mcp_enabled: false,
            mcp_scope: "personal_30d".to_string(),
            active_template_id: "standard".to_string(),
            recording_overlay_x: None,
            recording_overlay_y: None,
            llm_custom_prompt: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationAdapterInfo {
    pub id: String,
    pub name: String,
    pub category: String,
    pub status: String, // "implemented" | "adapter_ready" | "unimplemented"
    pub min_plan: PlanTier,
    pub description: String,
    pub required_config: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub timestamp: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCitation {
    pub note_id: String,
    pub note_title: String,
    pub timestamp: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAnswer {
    pub answer: String,
    pub citations: Vec<ChatCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryItem {
    pub id: String,
    pub timestamp: String,
    pub space_id: Option<String>,
    pub question: String,
    pub answer: String,
    pub citations: Vec<ChatCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletedNoteRecord {
    pub note_id: String,
    pub notion_page_id: Option<String>,
    pub deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppDataSnapshot {
    pub notes: Vec<Note>,
    pub folders: Vec<Folder>,
    pub dictionary: Vec<DictionaryEntry>,
    pub recipes: Vec<Recipe>,
    pub settings: AppSettings,
    pub audit_logs: Vec<AuditEvent>,
    #[serde(default)]
    pub chat_history: Vec<ChatHistoryItem>,
    #[serde(default)]
    pub deleted_notes: Vec<DeletedNoteRecord>,
}
