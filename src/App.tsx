import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Home,
  Menu,
  MessageSquare,
  FileText,
  Upload,
  BookOpen,
  Link2,
  Mic,
  Pause,
  Play,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Square,
  Video,
  GripVertical,
  X,
} from 'lucide-react';
import {
  AppDataSnapshot,
  AppSettings,
  AsrModelInfo,
  AudioDeviceInfo,
  AudioSourceMode,
  DEFAULT_SUMMARY_PRESETS,
  DictionaryEntry,
  IntegrationAdapterInfo,
  Note,
  RecordingStatus,
  SecretStatus,
  TranscriptSegment,
} from './types';
import {
  apiChatNotes,
  apiApplyChatActionProposals,
  apiCopyAndPreparePaste,
  apiDeleteDictionaryEntry,
  apiDeleteNote,
  apiDownloadAsrModel,
  apiInstallAsrRuntime,
  apiCheckAppUpdate,
  apiInstallAppUpdate,
  apiDraftFollowup,
  apiExportAllData,
  apiGetMcpConfigPreview,
  apiGetRecordingStatus,
  apiGetSecretStatus,
  apiGetSnapshot,
  apiListAsrModels,
  apiListAudioDevices,
  apiListIntegrationAdapters,
  apiNotionExchangeCode,
  apiNotionOAuthUrl,
  apiNotionPullNotes,
  apiNotionSaveNote,
  apiNotionSearchTargets,
  apiPauseRecording,
  apiPurgeAllData,
  apiResumeRecording,
  apiRestoreBackupSnapshot,
  apiRunRecipe,
  apiSaveRecipe,
  apiSaveFolder,
  apiDeleteFolder,
  apiClearChatHistory,
  apiDeleteChatHistoryItems,
  apiSaveDictionaryEntry,
  apiSaveNote,
  apiSaveNoteFast,
  apiSaveSettings,
  apiSendWebhook,
  apiSetSecret,
  apiShareToSlack,
  apiStartRecording,
  apiStopRecording,
  apiSummarizeNote,
  apiTranscribeRecording,
  apiTranscribeUploadedAudio,
  apiTranscribeUploadedUrl,
  apiGetUpcomingCalendarEvents,
  apiSavePopupChatSessions,
  isTauriRuntime,
} from './lib/tauri';
import { createEmptyNote, findNoteSearchMatches, formatMs } from './lib/format';
import { isAndroidRuntime, useMobileLayout } from './lib/platform';
import { useTauriEvent } from './lib/tauriEvents';
import { exportNotesAsObsidianZip, mergeNoteletBackupJson } from './lib/noteExportImport';
import { HomeView } from './components/HomeView';
import { ConfirmDialogHost } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RecordingView } from './components/RecordingView';
import { NoteEditorView } from './components/NoteEditorView';
import { ChatView } from './components/ChatView';
import { UploadView } from './components/UploadView';
import { DictionaryView } from './components/DictionaryView';
import { IntegrationsView } from './components/IntegrationsView';
import { SettingsView } from './components/SettingsView';

type NavView =
  | 'home'
  | 'chat'
  | 'notes'
  | 'upload'
  | 'dictionary'
  | 'integrations'
  | 'recording'
  | 'editor'
  | 'settings';

const FALLBACK_SETTINGS: AppSettings = {
  plan_tier: 'enterprise',
  active_asr_model_id: '',
  active_asr_provider: 'local_whisper',
  language: 'ja',
  allow_cloud_asr: false,
  llm_provider: 'none',
  llm_model: 'gpt-4o-mini',
  llm_endpoint: 'http://localhost:11434',
  record_shortcut: 'CommandOrControl+Shift+R',
  voice_typing_shortcut: 'CommandOrControl+Shift+V',
  delete_audio_after_transcribe: false,
  encrypt_retained_audio: true,
  retention_days: 0,
  participant_notice_enabled: false,
  participant_notice_text: 'この会話はメモ作成のために録音・文字起こしを行っています。',
  admin_enforced_notice: false,
  opt_out_model_training: true,
  org_opt_out_model_training: true,
  copy_format: 'markdown',
  notion_target_id: '',
  notion_target_type: 'database',
  notion_target_name: '',
  notion_mapping: {
    title_prop: 'Name',
    date_prop: 'Date',
    participants_prop: 'Participants',
    summary_prop: 'Summary',
    actions_prop: 'Action Items',
  },
  whisper_cli_path: '',
  parakeet_cli_path: '',
  slack_webhook_configured: false,
  generic_webhook_url: '',
  mcp_enabled: false,
  mcp_scope: 'workspace',
  active_template_id: 'standard',
  enable_gpu_asr: true,
  summary_presets: DEFAULT_SUMMARY_PRESETS,
  preferred_mic_device_id: null,
};

const INITIAL_RECORDING_STATUS: RecordingStatus = {
  state: 'idle',
  elapsed_ms: 0,
  level_rms: 0,
  waveform: new Array(48).fill(0),
  device_name: '',
  source_mode: 'mic',
  is_silent_warning: false,
  error_message: null,
  recovery_hint: null,
  temp_wav_path: null,
};

declare global {
  interface Window {
    __NOTELET_WINDOW_MODE__?: string;
    __NOTELET_MEETING_TITLE__?: string;
  }
}

const getWindowMode = (): string | null => {
  if (typeof window === 'undefined') return null;
  if (isAndroidRuntime()) return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'recording-overlay' || hash === 'meeting-notify') return hash;
  return (
    window.__NOTELET_WINDOW_MODE__ ||
    new URLSearchParams(window.location.search).get('overlay')
  );
};

if (typeof document !== 'undefined') {
  const initialMode = getWindowMode();
  if (initialMode === 'recording-overlay' || initialMode === 'recording' || initialMode === 'meeting-notify') {
    document.documentElement.classList.add('overlay-window');
  }
  if (isAndroidRuntime()) {
    document.documentElement.classList.add('android-runtime');
  }
}

const useTransparentWindowBackground = () => {
  useEffect(() => {
    document.documentElement.classList.add('overlay-window');
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.classList.remove('overlay-window');
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);
};

const startWindowDragIfNotInteractive = (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('button, a, input, select, textarea')) return;
  if (isTauriRuntime()) {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().startDragging()
    );
  }
};

const RecordingOverlay: React.FC = () => {
  useTransparentWindowBackground();
  const [status, setStatus] = useState<RecordingStatus>(INITIAL_RECORDING_STATUS);
  const [liveText, setLiveText] = useState<string>('');

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    const poll = async () => {
      try {
        const st = await apiGetRecordingStatus();
        if (active) setStatus(st);
      } catch {
        // ignore transient polling error
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 200);
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const fn = await listen<TranscriptSegment>('live-transcript-segment', (ev) => {
          if (active && ev.payload?.text?.trim()) {
            setLiveText(ev.payload.text.trim());
          }
        });
        if (active) {
          unlisten = fn;
        } else {
          fn();
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
      clearInterval(timer);
      if (unlisten) unlisten();
    };
  }, []);

  const isPaused = status.state === 'paused';
  const bars = (status.waveform.length > 0 ? status.waveform.slice(-10) : new Array(10).fill(0.15));

  return (
    <div
      data-tauri-drag-region
      onMouseDown={startWindowDragIfNotInteractive}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '0 12px',
        borderRadius: '999px',
        backgroundColor: '#18181B',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.32)',
        color: '#FFFFFF',
        fontSize: '12px',
        fontWeight: 500,
        userSelect: 'none',
        cursor: 'grab',
        boxSizing: 'border-box',
      }}
    >
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <GripVertical size={14} strokeWidth={1.75} style={{ color: '#71717A', flexShrink: 0 }} />
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isPaused ? '#F59E0B' : '#EF4444',
            flexShrink: 0,
          }}
        />
        <div
          data-tauri-drag-region
          style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '20px' }}
          aria-hidden="true"
        >
          {bars.map((v, idx) => {
            const val = Number.isFinite(v) ? v : 0;
            const h = val >= 0.04 ? Math.max(4, Math.min(18, Math.round(3 + val * 15))) : 4;
            return (
              <span
                key={idx}
                style={{
                  width: '2px',
                  height: `${h}px`,
                  borderRadius: '2px',
                  backgroundColor: isPaused ? '#A1A1AA' : '#F4F4F5',
                  transition: 'height 80ms ease-out',
                }}
              />
            );
          })}
        </div>
        <span
          data-tauri-drag-region
          style={{ fontVariantNumeric: 'tabular-nums', color: '#E4E4E7', fontSize: '12px', marginLeft: '4px', flexShrink: 0 }}
        >
          {formatMs(status.elapsed_ms)}
        </span>
        {liveText && (
          <span
            data-tauri-drag-region
            title={liveText}
            style={{
              color: '#A1A1AA',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '180px',
              marginLeft: '4px',
            }}
          >
            {liveText}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          type="button"
          aria-label={isPaused ? '再開' : '一時停止'}
          title={isPaused ? '再開' : '一時停止'}
          onClick={async () => {
            if (!isTauriRuntime()) return;
            const st = isPaused ? await apiResumeRecording() : await apiPauseRecording();
            setStatus(st);
          }}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            color: '#FFFFFF',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {isPaused ? <Play size={12} strokeWidth={2} /> : <Pause size={12} strokeWidth={2} />}
        </button>
        <button
          type="button"
          aria-label="録音を停止"
          title="録音を停止"
          onClick={async () => {
            if (isTauriRuntime()) {
              const { emit } = await import('@tauri-apps/api/event');
              await emit('overlay-stop-recording');
            }
          }}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: '#DC2626',
            color: '#FFFFFF',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Square size={11} strokeWidth={2.2} fill="#FFFFFF" />
        </button>
      </div>
    </div>
  );
};

const MeetingNotifyOverlay: React.FC = () => {
  useTransparentWindowBackground();
  const [meetingTitle, setMeetingTitle] = useState(
    (typeof window !== 'undefined' && window.__NOTELET_MEETING_TITLE__) || 'オンライン会議'
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlisten = await listen<string>('meeting-detected', (ev) => {
        if (ev.payload) setMeetingTitle(ev.payload);
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const closeSelf = async () => {
    if (isTauriRuntime()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().hide();
    }
  };

  return (
    <div
      data-tauri-drag-region
      onMouseDown={startWindowDragIfNotInteractive}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '0 16px',
        borderRadius: '16px',
        backgroundColor: '#18181B',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.35)',
        color: '#FFFFFF',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Video size={16} strokeWidth={1.75} />
        </div>
        <div data-tauri-drag-region style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {meetingTitle} を検出
          </span>
          <span style={{ fontSize: '11px', color: '#A1A1AA' }}>
            Notelet で録音・文字起こし
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          type="button"
          onClick={async () => {
            if (isTauriRuntime()) {
              const { emit } = await import('@tauri-apps/api/event');
              await emit('overlay-start-recording');
              await closeSelf();
            }
          }}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: '999px',
            border: 'none',
            backgroundColor: '#FFFFFF',
            color: '#18181B',
            fontSize: '12px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
          }}
        >
          <Mic size={12} strokeWidth={2} />
          <span>録音開始</span>
        </button>
        <button
          type="button"
          aria-label="閉じる"
          onClick={() => void closeSelf()}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: 'transparent',
            color: '#A1A1AA',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const mode = getWindowMode();
  if (mode === 'recording-overlay' || mode === 'recording') {
    return <RecordingOverlay />;
  }
  if (mode === 'meeting-notify') {
    return <MeetingNotifyOverlay />;
  }
  return <MainApp />;
};

function mergePulledNotionSnapshot(
  prev: AppDataSnapshot,
  incoming: AppDataSnapshot
): AppDataSnapshot {
  const incomingById = new Map(incoming.notes.map((n) => [n.id, n]));
  let changed = false;
  const notes = prev.notes.map((note) => {
    const next = incomingById.get(note.id);
    if (!next) return note;
    // ローカルの方が新しい場合は上書きしない。
    if (note.updated_at > next.updated_at) return note;
    const syncChanged =
      next.notion_sync.status !== note.notion_sync.status ||
      next.notion_sync.page_id !== note.notion_sync.page_id ||
      next.notion_sync.last_synced_at !== note.notion_sync.last_synced_at;
    if (
      next.updated_at !== note.updated_at ||
      next.title !== note.title ||
      next.summary !== note.summary ||
      next.manual_notes !== note.manual_notes ||
      syncChanged
    ) {
      changed = true;
      return next;
    }
    return note;
  });
  const existingIds = new Set(prev.notes.map((n) => n.id));
  for (const note of incoming.notes) {
    if (!existingIds.has(note.id)) {
      notes.unshift(note);
      changed = true;
    }
  }
  let folders = prev.folders;
  if (JSON.stringify(prev.folders) !== JSON.stringify(incoming.folders)) {
    folders = incoming.folders;
    changed = true;
  }
  return changed ? { ...prev, notes, folders } : prev;
}

const MainApp: React.FC = () => {
  const mobile = useMobileLayout();
  const android = isAndroidRuntime();
  const [view, setView] = useState<NavView>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordingStartError, setRecordingStartError] = useState<string | null>(null);
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const deferredCommandQuery = useDeferredValue(commandQuery);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [recordingSpaceId, setRecordingSpaceId] = useState('personal');
  const [snapshot, setSnapshot] = useState<AppDataSnapshot>({
    notes: [],
    folders: [{ id: 'personal', name: '一般', is_shared: false, permission: 'owner' }],
    dictionary: [],
    recipes: [],
    settings: FALLBACK_SETTINGS,
    audit_logs: [],
    chat_history: [],
  });
  const [models, setModels] = useState<AsrModelInfo[]>([]);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [adapters, setAdapters] = useState<IntegrationAdapterInfo[]>([]);
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [mcpPreview, setMcpPreview] = useState('');
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('mic');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [recordOptionsOpen, setRecordOptionsOpen] = useState(false);

  useEffect(() => {
    if (sourceMode !== 'system') {
      setSelectedDeviceId(snapshot.settings.preferred_mic_device_id ?? '');
    }
  }, [snapshot.settings.preferred_mic_device_id, sourceMode]);

  // Android はマイク録音のみ対応。
  useEffect(() => {
    if (android && sourceMode !== 'mic') setSourceMode('mic');
  }, [android, sourceMode]);

  useEffect(() => {
    if (!recordOptionsOpen) return;
    const close = () => setRecordOptionsOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRecordOptionsOpen(false);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [recordOptionsOpen]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [uploadQueueStatus, setUploadQueueStatus] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  const [meetingReminder, setMeetingReminder] = useState<{
    id: string;
    title: string;
    start_time: string;
  } | null>(null);

  useEffect(() => {
    const theme = snapshot.settings.theme ?? 'light';
    const apply = () => {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else if (theme === 'system') {
        const prefersDark =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    };
    apply();
    if (theme === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', apply);
      return () => mq.removeEventListener?.('change', apply);
    }
  }, [snapshot.settings.theme]);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandQuery('');
        setCommandSearchOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (
        e.key === '?' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setCommandSearchOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);
  const [recStatus, setRecStatus] = useState<RecordingStatus>(INITIAL_RECORDING_STATUS);
  const [liveManualNotes, setLiveManualNotes] = useState('');
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [openNoteSeq, setOpenNoteSeq] = useState(0);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string>('');
  const [recordingNoteId, setRecordingNoteId] = useState<string | null>(null);
  const voiceTypingRef = useRef(false);
  const recStateRef = useRef(recStatus.state);
  recStateRef.current = recStatus.state;
  const startRecordingRef = useRef<(voiceTyping?: boolean) => Promise<void>>(async () => {});
  const stopAndFinishRef = useRef<() => Promise<void>>(async () => {});
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<{
    note_id: string;
    progress: number;
    label: string;
  } | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const notionDebounceTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const notionSyncInFlightRef = React.useRef<Set<string>>(new Set());
  const notionRetryBackoffRef = React.useRef<Record<string, { attempts: number; nextAt: number }>>({});
  const notionPullInFlightRef = React.useRef(false);
  const lastNotionPullAtRef = React.useRef(0);
  const snapshotNotesRef = React.useRef(snapshot.notes);
  snapshotNotesRef.current = snapshot.notes;

  const noteSaveSeqRef = React.useRef<Record<string, number>>({});
  const noteSaveTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const notePendingRef = React.useRef<Record<string, Note>>({});
  const flushPendingNoteRef = React.useRef<(noteId?: string) => Promise<void>>(async () => {});

  const syncNoteToNotion = useCallback(
    async (noteId: string, silent = false) => {
      if (!isTauriRuntime()) return;
      // デバウンス中のローカル編集を先に永続化してから同期する。
      await flushPendingNoteRef.current(noteId);
      if (notionSyncInFlightRef.current.has(noteId)) return;
      notionSyncInFlightRef.current.add(noteId);
      setSnapshot((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? { ...n, notion_sync: { ...n.notion_sync, status: 'syncing' } }
            : n
        ),
      }));
      try {
        const updated = await apiNotionSaveNote(noteId);
        delete notionRetryBackoffRef.current[noteId];
        setSnapshot((prev) => ({
          ...prev,
          notes: prev.notes.map((n) => {
            if (n.id !== updated.id) return n;
            // If user edited the note locally while Notion upload was in flight, keep local fields
            if (n.updated_at !== updated.updated_at || n.title !== updated.title || n.folder_id !== updated.folder_id) {
              return {
                ...n,
                notion_sync: {
                  ...updated.notion_sync,
                  status: 'not_synced',
                },
              };
            }
            return updated;
          }),
        }));
      } catch (err) {
        const prevAttempts = notionRetryBackoffRef.current[noteId]?.attempts ?? 0;
        const delayMs = Math.min(60000, 8000 * Math.pow(2, prevAttempts));
        notionRetryBackoffRef.current[noteId] = {
          attempts: prevAttempts + 1,
          nextAt: Date.now() + delayMs,
        };
        setSnapshot((prev) => ({
          ...prev,
          notes: prev.notes.map((n) =>
            n.id === noteId
              ? {
                  ...n,
                  notion_sync: {
                    ...n.notion_sync,
                    status: 'failed',
                    last_error: String(err),
                  },
                }
              : n
          ),
        }));
        if (!silent) throw err;
      } finally {
        notionSyncInFlightRef.current.delete(noteId);
      }
    },
    []
  );

  const scheduleAutoNotionSync = useCallback(
    (noteId: string, immediate = false) => {
      if (!isTauriRuntime()) return;
      if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;
      delete notionRetryBackoffRef.current[noteId];
      const existingTimer = notionDebounceTimersRef.current[noteId];
      if (existingTimer) clearTimeout(existingTimer);
      if (immediate) {
        delete notionDebounceTimersRef.current[noteId];
        void syncNoteToNotion(noteId, true);
      } else {
        notionDebounceTimersRef.current[noteId] = setTimeout(() => {
          delete notionDebounceTimersRef.current[noteId];
          void syncNoteToNotion(noteId, true);
        }, 1800);
      }
    },
    [secretStatus?.notion_access_token, snapshot.settings.notion_target_id, syncNoteToNotion]
  );

  const pullFromNotionIfConfigured = useCallback(
    async (force = false) => {
      if (!isTauriRuntime()) return;
      if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (notionPullInFlightRef.current) return;
      if (
        !force &&
        (notionSyncInFlightRef.current.size > 0 ||
          Object.keys(notionDebounceTimersRef.current).length > 0)
      ) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastNotionPullAtRef.current < 5000) return;
      notionPullInFlightRef.current = true;
      lastNotionPullAtRef.current = now;
      try {
        const snap = await apiNotionPullNotes();
        setSnapshot((prev) => mergePulledNotionSnapshot(prev, snap));
      } catch {
        // transient pull errors will be retried on next tick/focus
      } finally {
        notionPullInFlightRef.current = false;
      }
    },
    [secretStatus?.notion_access_token, snapshot.settings.notion_target_id]
  );

  const retryPendingNotionSyncs = useCallback(
    async (ignoreBackoff = false) => {
      if (!isTauriRuntime()) return;
      if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const now = Date.now();
      const pending = snapshotNotesRef.current.filter((n) => {
        if (n.notion_sync.status !== 'not_synced' && n.notion_sync.status !== 'failed') {
          return false;
        }
        if (notionSyncInFlightRef.current.has(n.id)) return false;
        if (ignoreBackoff) return true;
        const backoff = notionRetryBackoffRef.current[n.id];
        return !backoff || backoff.nextAt <= now;
      });
      for (const n of pending) {
        await syncNoteToNotion(n.id, true);
      }
    },
    [secretStatus?.notion_access_token, snapshot.settings.notion_target_id, syncNoteToNotion]
  );

  const remindedEventIdsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isTauriRuntime() || !snapshot.settings.calendar_reminder_enabled) return;
    const checkEvents = async () => {
      try {
        const events = await apiGetUpcomingCalendarEvents();
        const nowMs = Date.now();
        for (const ev of events) {
          if (remindedEventIdsRef.current.has(ev.id)) continue;
          const startMs = Date.parse(ev.start_time);
          if (!Number.isFinite(startMs)) continue;
          const diffMin = (startMs - nowMs) / 60000;
          if (diffMin >= -2 && diffMin <= 10) {
            remindedEventIdsRef.current.add(ev.id);
            setMeetingReminder({ id: ev.id, title: ev.title, start_time: ev.start_time });
            break;
          }
        }
      } catch {
        // ignore transient calendar errors
      }
    };
    void checkEvents();
    const timer = window.setInterval(() => void checkEvents(), 60000);
    return () => window.clearInterval(timer);
  }, [snapshot.settings.calendar_reminder_enabled]);

  // Initial + periodic retry & bidirectional pull sync (no restart required)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;

    void pullFromNotionIfConfigured(true);
    void retryPendingNotionSyncs(true);

    let tickCount = 0;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      tickCount += 1;
      void retryPendingNotionSyncs(false);
      if (tickCount % 2 === 0) {
        void pullFromNotionIfConfigured(false);
      }
    }, 30000);

    const handleWakeSync = () => {
      notionRetryBackoffRef.current = {};
      void retryPendingNotionSyncs(true);
      void pullFromNotionIfConfigured(true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleWakeSync();
      }
    };

    window.addEventListener('focus', handleWakeSync);
    window.addEventListener('online', handleWakeSync);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleWakeSync);
      window.removeEventListener('online', handleWakeSync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    secretStatus?.notion_access_token,
    snapshot.settings.notion_target_id,
    pullFromNotionIfConfigured,
    retryPendingNotionSyncs,
  ]);

  const refreshAll = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const [snap, mdl, devs, sec, adp, mcp] = await Promise.all([
      apiGetSnapshot(),
      apiListAsrModels(),
      apiListAudioDevices(),
      apiGetSecretStatus(),
      apiListIntegrationAdapters(),
      apiGetMcpConfigPreview(),
    ]);
    setSnapshot(snap);
    setModels(mdl);
    setDevices(devs);
    setSecretStatus(sec);
    setAdapters(adp);
    setMcpPreview(mcp);
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlistenDl: (() => void) | undefined;
    let unlistenUpd: (() => void) | undefined;
    let unlistenLiveSeg: (() => void) | undefined;
    let unlistenLiveErr: (() => void) | undefined;
    let unlistenTranscribeProg: (() => void) | undefined;

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const f1 = await listen<{ model_id: string; progress: number }>('asr-download-progress', (ev) => {
        setDownloadProgress((prev) => ({ ...prev, [ev.payload.model_id]: ev.payload.progress }));
        if (ev.payload.progress >= 100) {
          void refreshAll();
        }
      });
      const f2 = await listen<{ progress: number }>('app-update-progress', (ev) => {
        setUpdateProgress(ev.payload.progress);
      });
      const f3 = await listen<TranscriptSegment>('live-transcript-segment', (ev) => {
        if (ev.payload && ev.payload.text) {
          setLiveSegments((prev) => [...prev, ev.payload]);
        }
      });
      const f4 = await listen<string>('live-transcript-error', (ev) => {
        if (typeof ev.payload === 'string' && ev.payload.trim()) {
          setTranscribeError(ev.payload);
        }
      });
      const f5 = await listen<{ note_id: string; progress: number; label: string }>(
        'asr-transcribe-progress',
        (ev) => {
          if (ev.payload) {
            setTranscribeProgress(ev.payload.progress >= 100 ? null : ev.payload);
          }
        }
      );
      if (cancelled) {
        f1();
        f2();
        f3();
        f4();
        f5();
      } else {
        unlistenDl = f1;
        unlistenUpd = f2;
        unlistenLiveSeg = f3;
        unlistenLiveErr = f4;
        unlistenTranscribeProg = f5;
      }
    });
    return () => {
      cancelled = true;
      unlistenDl?.();
      unlistenUpd?.();
      unlistenLiveSeg?.();
      unlistenLiveErr?.();
      unlistenTranscribeProg?.();
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlistenSc: (() => void) | undefined;
    let unlistenOverlayStop: (() => void) | undefined;
    let unlistenOverlayStart: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const f1 = await listen<{ role?: string }>('global-shortcut-triggered', (event) => {
        const role = event.payload?.role === 'voice_typing' ? 'voice_typing' : 'record';
        if (recStateRef.current === 'recording' || recStateRef.current === 'paused') {
          if (role === 'voice_typing' && !voiceTypingRef.current) return;
          void stopAndFinishRef.current();
        } else {
          void startRecordingRef.current(role === 'voice_typing');
        }
      });
      const f2 = await listen('overlay-stop-recording', () => {
        void stopAndFinishRef.current();
      });
      const f3 = await listen('overlay-start-recording', () => {
        void startRecordingRef.current();
      });
      if (cancelled) {
        f1();
        f2();
        f3();
      } else {
        unlistenSc = f1;
        unlistenOverlayStop = f2;
        unlistenOverlayStart = f3;
      }
    });
    return () => {
      cancelled = true;
      unlistenSc?.();
      unlistenOverlayStop?.();
      unlistenOverlayStart?.();
    };
  }, []);

  useTauriEvent<RecordingStatus>('recording-status', (status) => {
    if (status && status.state) setRecStatus(status);
  }, []);

  const ensureRecordingAsrReady = () => {
    if (!isTauriRuntime()) return true;

    const modelId = snapshot.settings.active_asr_model_id.trim();
    const model = models.find((item) => item.id === modelId);
    let error: string | null = null;
    if (!modelId) {
      error = 'ASRモデルが選択されていません。設定画面でモデルを選択してください。';
    } else if (!model) {
      error = '選択中のASRモデルを確認できません。設定画面でモデルを選択してください。';
    } else if (model.is_local && !model.is_compatible) {
      error = model.compatibility_reason || 'ASRランタイムが利用できません。設定画面を確認してください。';
    } else if (model.is_local && !model.installed) {
      error = '選択中のASRモデルが未導入です。設定画面からモデルをダウンロードしてください。';
    } else if (!model.is_local && !model.is_compatible) {
      error = model.compatibility_reason || 'クラウドASRのAPIキーが未設定です。設定画面を確認してください。';
    } else if (!model.is_local && !snapshot.settings.allow_cloud_asr) {
      error = 'クラウドASRが許可されていません。設定画面で利用を許可してください。';
    }

    setRecordingStartError(error);
    if (error) setSettingsOpen(true);
    return !error;
  };

  const handleStartRecording = async (voiceTyping = false) => {
    if (!ensureRecordingAsrReady()) return;
    voiceTypingRef.current = voiceTyping;
    setTranscribeError(null);
    setLiveManualNotes('');
    setLiveSegments([]);
    if (!isTauriRuntime()) {
      const note = createEmptyNote(recordingSpaceId);
      note.title = '';
      setSnapshot((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
      setRecordingNoteId(note.id);
      setActiveNoteId(note.id);
      if (!voiceTyping) setView('editor');
      return;
    }
    try {
      const note = createEmptyNote(recordingSpaceId);
      note.title = '';
      const nextSnap = await apiSaveNote(note);
      setSnapshot(nextSnap);
      setRecordingNoteId(note.id);
      if (!voiceTyping) {
        setActiveNoteId(note.id);
        setView('editor');
      }
      const st = await apiStartRecording(sourceMode, selectedDeviceId || null);
      setRecStatus(st);
    } catch (e) {
      voiceTypingRef.current = false;
      setBannerMessage(String(e));
    }
  };

  const handleStartRecordingInNote = async () => {
    if (!ensureRecordingAsrReady()) return;
    voiceTypingRef.current = false;
    setTranscribeError(null);
    setLiveSegments([]);
    setRecordingNoteId(activeNote?.id || activeNoteId);
    if (!isTauriRuntime()) return;
    try {
      const st = await apiStartRecording(sourceMode, selectedDeviceId || null);
      setRecStatus(st);
    } catch (e) {
      setBannerMessage(String(e));
    }
  };

  const handleStopAndFinish = async () => {
    const isVoiceTyping = voiceTypingRef.current;
    const finalStatus = isTauriRuntime() ? await apiStopRecording() : recStatus;
    setRecStatus(INITIAL_RECORDING_STATUS);
    const targetId = recordingNoteId || activeNote?.id || activeNoteId;
    setRecordingNoteId(null);
    const existing = snapshot.notes.find((n) => n.id === targetId);
    const nowStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const capturedLiveSegments = [...liveSegments];
    const hasTempWav = Boolean(finalStatus.temp_wav_path);
    const targetNote: Note = existing
      ? {
          ...existing,
          title: existing.title.trim() ? existing.title : `録音ノート ${nowStr}`,
          duration_sec: existing.duration_sec + Math.round(finalStatus.elapsed_ms / 1000),
          manual_notes: liveManualNotes
            ? [existing.manual_notes, liveManualNotes].filter(Boolean).join('\n')
            : existing.manual_notes,
          segments:
            capturedLiveSegments.length > 0
              ? [...existing.segments, ...capturedLiveSegments]
              : existing.segments,
          // Keep temp_wav_path untouched until apiTranscribeRecording completes & retains it
          audio_path: hasTempWav ? existing.audio_path || null : existing.audio_path || null,
          updated_at: new Date().toISOString(),
        }
      : {
          ...createEmptyNote(recordingSpaceId),
          duration_sec: Math.round(finalStatus.elapsed_ms / 1000),
          manual_notes: liveManualNotes,
          segments: capturedLiveSegments,
          audio_path: null,
          language: snapshot.settings.language,
        };

    if (isTauriRuntime()) {
      const nextSnap = await apiSaveNote(targetNote);
      setSnapshot(nextSnap);
      if (!isVoiceTyping) {
        setActiveNoteId(targetNote.id);
        setView('editor');
      }

      if (finalStatus.temp_wav_path) {
        setTranscribing(true);
        setTranscribeError(null);
        try {
          const updatedNote = await apiTranscribeRecording(
            finalStatus.temp_wav_path,
            targetNote.id,
            Boolean(existing)
          );
          const nextSegs =
            updatedNote.segments.length > 0 ? updatedNote.segments : capturedLiveSegments;
          const mergedSegments =
            existing && existing.segments.length > 0
              ? nextSegs.length > 0
                ? [...existing.segments, ...nextSegs]
                : existing.segments
              : nextSegs;
          const finalNote = { ...updatedNote, segments: mergedSegments };
          const savedSnap = await apiSaveNote(finalNote);
          setSnapshot(savedSnap);
          setLiveSegments([]);
          if (isVoiceTyping) {
            const text = finalNote.segments
              .map((seg) => seg.text.trim())
              .filter(Boolean)
              .join('\n');
            if (text) {
              const hint = await apiCopyAndPreparePaste(text);
              setBannerMessage(hint);
            } else {
              setBannerMessage('発話が検出されませんでした。');
            }
            voiceTypingRef.current = false;
          }
          scheduleAutoNotionSync(finalNote.id, true);
        } catch (err) {
          voiceTypingRef.current = false;
          setTranscribeError(String(err));
          void refreshAll();
        } finally {
          setTranscribing(false);
        }
      } else {
        setLiveSegments([]);
        voiceTypingRef.current = false;
        scheduleAutoNotionSync(targetNote.id, true);
      }
    } else {
      setSnapshot((prev) => ({
        ...prev,
        notes: existing
          ? prev.notes.map((n) => (n.id === targetNote.id ? targetNote : n))
          : [targetNote, ...prev.notes],
      }));
      if (!isVoiceTyping) {
        setActiveNoteId(targetNote.id);
        setView('editor');
      }
      voiceTypingRef.current = false;
    }
  };

  startRecordingRef.current = handleStartRecording;
  stopAndFinishRef.current = handleStopAndFinish;

  const handleRetranscribeNote = async (noteId: string) => {
    if (!isTauriRuntime()) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const updatedNote = await apiTranscribeRecording('', noteId);
      setSnapshot((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === updatedNote.id ? updatedNote : n)),
      }));
      scheduleAutoNotionSync(updatedNote.id, true);
    } catch (err) {
      setTranscribeError(String(err));
    } finally {
      setTranscribing(false);
    }
  };

  const handleImportNotes = async (notesToImport: Note[]) => {
    if (notesToImport.length === 0) return;
    if (isTauriRuntime()) {
      let latest = snapshot;
      for (const note of notesToImport) {
        latest = await apiSaveNote(note);
      }
      setSnapshot(latest);
    } else {
      setSnapshot((prev) => ({
        ...prev,
        notes: [...notesToImport, ...prev.notes],
      }));
    }
  };

  const handleUploadAndTranscribe = async (file: File) => {
    const newNote = createEmptyNote();
    newNote.title = file.name.replace(/\.[^/.]+$/, '') || 'アップロード録音';
    newNote.language = snapshot.settings.language;
    setTranscribeError(null);

    if (!isTauriRuntime()) {
      setSnapshot((prev) => ({ ...prev, notes: [newNote, ...prev.notes] }));
      setActiveNoteId(newNote.id);
      setView('editor');
      return;
    }

    const nextSnap = await apiSaveNote(newNote);
    setSnapshot(nextSnap);
    setActiveNoteId(newNote.id);
    setTranscribing(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      const updated = await apiTranscribeUploadedAudio(file.name, bytes, newNote.id);
      setSnapshot((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
      }));
      setView('editor');
      scheduleAutoNotionSync(updated.id, true);
    } catch (err) {
      setTranscribeError(String(err));
    } finally {
      setTranscribing(false);
    }
  };

  const handleUploadUrlAndTranscribe = async (url: string) => {
    const newNote = createEmptyNote(recordingSpaceId);
    newNote.title = url.split('/').pop()?.split('?')[0] || '動画リンク録音';
    newNote.language = snapshot.settings.language;
    setTranscribeError(null);

    if (!isTauriRuntime()) {
      setSnapshot((prev) => ({ ...prev, notes: [newNote, ...prev.notes] }));
      setActiveNoteId(newNote.id);
      setView('editor');
      return;
    }

    const nextSnap = await apiSaveNote(newNote);
    setSnapshot(nextSnap);
    setActiveNoteId(newNote.id);
    setTranscribing(true);
    try {
      const updated = await apiTranscribeUploadedUrl(url, newNote.id);
      setSnapshot((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
      }));
      setView('editor');
      scheduleAutoNotionSync(updated.id, true);
    } catch (err) {
      setTranscribeError(String(err));
    } finally {
      setTranscribing(false);
    }
  };

  const cancelPendingNoteSave = useCallback((noteId: string) => {
    delete notePendingRef.current[noteId];
    const timer = noteSaveTimersRef.current[noteId];
    if (timer) {
      clearTimeout(timer);
      delete noteSaveTimersRef.current[noteId];
    }
  }, []);

  const flushPendingNote = useCallback(
    async (noteId?: string) => {
      if (!isTauriRuntime()) return;
      const ids = noteId ? [noteId] : Object.keys(notePendingRef.current);
      for (const id of ids) {
        const pending = notePendingRef.current[id];
        if (!pending) continue;
        delete notePendingRef.current[id];
        const timer = noteSaveTimersRef.current[id];
        if (timer) {
          clearTimeout(timer);
          delete noteSaveTimersRef.current[id];
        }
        const seq = noteSaveSeqRef.current[id] ?? 0;
        try {
          const saved = await apiSaveNoteFast(pending);
          if ((noteSaveSeqRef.current[id] ?? 0) === seq) {
            setSnapshot((prev) => ({
              ...prev,
              notes: prev.notes.map((n) => (n.id === saved.id ? saved : n)),
            }));
          }
          scheduleAutoNotionSync(id, false);
        } catch (e) {
          // 失敗時は保留に戻し、次の編集/ flush で再試行できるようにする。
          if (!notePendingRef.current[id]) {
            notePendingRef.current[id] = pending;
          }
          setBannerMessage(String(e));
        }
      }
    },
    [scheduleAutoNotionSync]
  );
  flushPendingNoteRef.current = flushPendingNote;

  useEffect(() => {
    const flush = () => void flushPendingNote();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      void flushPendingNote();
    };
  }, [flushPendingNote]);

  const handleUpdateNote = async (updated: Note) => {
    noteSaveSeqRef.current[updated.id] = (noteSaveSeqRef.current[updated.id] ?? 0) + 1;
    const normalized: Note =
      updated.notion_sync.status === 'synced'
        ? { ...updated, notion_sync: { ...updated.notion_sync, status: 'not_synced' } }
        : updated;
    setSnapshot((prev) => ({
      ...prev,
      notes: prev.notes.some((n) => n.id === normalized.id)
        ? prev.notes.map((n) => (n.id === normalized.id ? normalized : n))
        : [normalized, ...prev.notes],
    }));
    setActiveNoteId((prevId) => prevId || normalized.id);
    if (isTauriRuntime()) {
      // キーストローク毎の IPC・全スナップショット返却を避け、短時間デバウンスして保存する。
      notePendingRef.current[normalized.id] = normalized;
      const existing = noteSaveTimersRef.current[normalized.id];
      if (existing) clearTimeout(existing);
      noteSaveTimersRef.current[normalized.id] = setTimeout(() => {
        void flushPendingNote(normalized.id);
      }, 500);
    }
  };

  const handleCreateManualNote = async (folderId?: string) => {
    const note = createEmptyNote(folderId || recordingSpaceId || 'personal');
    note.title = '';
    if (isTauriRuntime()) {
      const next = await apiSaveNote(note);
      setSnapshot(next);
    } else {
      setSnapshot((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
    }
    setActiveNoteId(note.id);
    setView('editor');
  };

  const activeNote =
    snapshot.notes.find((n) => n.id === activeNoteId) || snapshot.notes[0] || null;
  const isRecordingActive = recStatus.state === 'recording' || recStatus.state === 'paused';

  const navItems: { id: NavView; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
    { id: 'home', label: 'ホーム', icon: Home },
    { id: 'chat', label: 'チャット', icon: MessageSquare },
    { id: 'notes', label: 'ノート', icon: FileText },
    { id: 'upload', label: 'アップロード', icon: Upload },
    { id: 'dictionary', label: '辞書', icon: BookOpen },
    { id: 'integrations', label: '連携', icon: Link2 },
  ];

  const handleSaveFolder = async (folder: { id: string; name: string; is_shared: boolean; permission: 'owner' | 'editor' | 'viewer' }) => {
    if (isTauriRuntime()) {
      setSnapshot(await apiSaveFolder(folder));
    } else {
      setSnapshot((prev) => ({
        ...prev,
        folders: prev.folders.some((f) => f.id === folder.id)
          ? prev.folders.map((f) => (f.id === folder.id ? folder : f))
          : [...prev.folders, folder],
      }));
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    await flushPendingNote();
    if (isTauriRuntime()) {
      setSnapshot(await apiDeleteFolder(folderId));
    } else {
      setSnapshot((prev) => ({
        ...prev,
        folders: prev.folders.filter((f) => f.id !== folderId),
      }));
    }
    if (recordingSpaceId === folderId) {
      setRecordingSpaceId('personal');
    }
  };

  const settingsModal = settingsOpen ? (
    <div
      className="settings-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="設定"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div className="settings-modal-panel">
        {recordingStartError && (
          <div role="alert" className="settings-error" style={{ margin: '16px 24px 0' }}>
            {recordingStartError}
          </div>
        )}
        <button
          type="button"
          aria-label="設定を閉じる"
          className="btn btn-ghost settings-close-btn"
          onClick={() => setSettingsOpen(false)}
        >
          <X size={18} strokeWidth={1.75} />
        </button>
        <SettingsView
          settings={snapshot.settings}
          models={models}
          secretStatus={secretStatus}
          downloadProgress={downloadProgress}
          updateProgress={updateProgress}
          onSaveSettings={async (next) => {
            if (isTauriRuntime()) {
              setSnapshot(await apiSaveSettings(next));
              await refreshAll();
            } else {
              setSnapshot((prev) => ({ ...prev, settings: next }));
            }
          }}
          onDownloadModel={async (modelId) => {
            try {
              await apiDownloadAsrModel(modelId);
              await refreshAll();
            } catch (e) {
              setBannerMessage(String(e));
            }
          }}
          onInstallRuntime={async (kind) => {
            try {
              await apiInstallAsrRuntime(kind);
              await refreshAll();
              setBannerMessage(`${kind === 'whisper' ? 'whisper.cpp' : 'sherpa-onnx-offline'} をインストールしました`);
            } catch (e) {
              setBannerMessage(String(e));
            }
          }}
          onCheckUpdate={apiCheckAppUpdate}
          onInstallUpdate={apiInstallAppUpdate}
          onSetSecret={async (key, val) => {
            await apiSetSecret(key, val);
            await refreshAll();
          }}
          onExportAll={async () => {
            await flushPendingNote();
            const json = isTauriRuntime()
              ? await apiExportAllData()
              : JSON.stringify(snapshot, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'notelet-export.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
          onPurgeAll={async () => {
            for (const noteId of Object.keys(notePendingRef.current)) {
              cancelPendingNoteSave(noteId);
            }
            if (isTauriRuntime()) {
              setSnapshot(await apiPurgeAllData());
            } else {
              setSnapshot((prev) => ({ ...prev, notes: [], audit_logs: [] }));
            }
          }}
          folders={snapshot.folders}
          notes={snapshot.notes}
          onImportNotes={handleImportNotes}
          onRestoreBackup={async (jsonText: string) => {
            await flushPendingNote();
            const merged = mergeNoteletBackupJson(jsonText, snapshot);
            if (isTauriRuntime()) {
              setSnapshot(await apiRestoreBackupSnapshot(merged.snapshot));
            } else {
              setSnapshot(merged.snapshot);
            }
          }}
          onExportObsidianZip={() => {
            const blob = exportNotesAsObsidianZip(snapshot.notes, snapshot.folders);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'notelet-obsidian-markdown.zip';
            a.click();
            URL.revokeObjectURL(url);
          }}
        />
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`app-shell ${mobile ? 'mobile' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setGlobalDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setGlobalDragOver(false);
        }
      }}
      onDrop={async (e) => {
        setGlobalDragOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        for (let i = 0; i < files.length; i += 1) {
          setUploadQueueStatus({
            current: i + 1,
            total: files.length,
            fileName: files[i].name,
          });
          await handleUploadAndTranscribe(files[i]);
        }
        setUploadQueueStatus(null);
      }}
    >
      {globalDragOver && (
        <div
          style={{
            position: 'fixed',
            inset: '12px',
            zIndex: 9999,
            borderRadius: '16px',
            border: '2px dashed var(--accent)',
            backgroundColor: 'rgba(24, 24, 27, 0.72)',
            color: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            pointerEvents: 'none',
          }}
        >
          <Upload size={32} strokeWidth={1.75} />
          <strong style={{ fontSize: '16px' }}>
            音声・動画ファイルをドロップして新規ノートを作成＆文字起こし
          </strong>
          <span style={{ fontSize: '12px', color: '#E4E4E7' }}>
            対応形式: WAV / MP3 / M4A / MP4 / MOV / WebM / OGG / FLAC
          </span>
        </div>
      )}
      {!mobile && (
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <nav className="nav-list" aria-label="メインメニュー" style={{ marginTop: '8px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              view === item.id ||
              (item.id === 'notes' && view === 'editor') ||
              (item.id === 'home' && view === 'recording');
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <Icon size={16} strokeWidth={1.5} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {recordOptionsOpen && !sidebarCollapsed && (
            <div
              className="record-options-popover"
              role="dialog"
              aria-label="録音設定"
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  録音ソース
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(
                    [
                      { id: 'mic', label: 'マイク' },
                      { id: 'system', label: '本体音声' },
                      { id: 'both', label: '両方' },
                    ] as const
                  )
                    .filter((opt) => !android || opt.id === 'mic')
                    .map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`tab-btn ${sourceMode === opt.id ? 'active' : ''}`}
                      style={{ flex: 1, height: '28px', padding: '0 8px', fontSize: '12px' }}
                      onClick={() => {
                        if (
                          sourceMode !== opt.id &&
                          (sourceMode === 'system' || opt.id === 'system')
                        ) {
                          setSelectedDeviceId('');
                        }
                        setSourceMode(opt.id);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {sourceMode !== 'system' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    マイク
                  </span>
                  <select
                    aria-label="使用するマイク"
                    className="input"
                    style={{ height: '32px', fontSize: '12px', padding: '0 8px', lineHeight: '1.2' }}
                    value={selectedDeviceId}
                    onChange={(e) => {
                      const deviceId = e.target.value;
                      setSelectedDeviceId(deviceId);
                      const settings = {
                        ...snapshot.settings,
                        preferred_mic_device_id: deviceId || null,
                      };
                      if (isTauriRuntime()) {
                        void apiSaveSettings(settings)
                          .then(setSnapshot)
                          .catch((error) => setBannerMessage(String(error)));
                      } else {
                        setSnapshot((prev) => ({ ...prev, settings }));
                      }
                    }}
                  >
                    <option value="">既定のマイク (自動)</option>
                    {devices
                      .filter((d) => d.kind === 'input')
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {sourceMode === 'system' && devices.some((d) => d.kind === 'loopback') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    システム音声
                  </span>
                  <select
                    aria-label="使用するシステム音声入力"
                    className="input"
                    style={{ height: '32px', fontSize: '12px', padding: '0 8px', lineHeight: '1.2' }}
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                  >
                    <option value="">既定のシステム音声入力 (自動)</option>
                    {devices
                      .filter((d) => d.kind === 'loopback')
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  保存先スペース
                </span>
                <select
                  aria-label="録音先のスペース"
                  className="input"
                  style={{ height: '32px', fontSize: '12px', padding: '0 8px', lineHeight: '1.2' }}
                  value={recordingSpaceId}
                  onChange={(e) => setRecordingSpaceId(e.target.value)}
                >
                  {snapshot.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <button
            type="button"
            aria-label="設定"
            title="設定"
            className={`btn-icon-circle ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} strokeWidth={1.5} />
          </button>

          {!sidebarCollapsed && (
            <div className={`record-split-group ${isRecordingActive ? 'recording' : ''}`}>
              <button
                type="button"
                className="record-split-btn"
                onClick={() => {
                  setRecordOptionsOpen(false);
                  if (isRecordingActive) {
                    void handleStopAndFinish();
                  } else {
                    void handleStartRecording();
                  }
                }}
              >
                {isRecordingActive ? <Square size={14} strokeWidth={1.5} /> : <Mic size={14} strokeWidth={1.5} />}
                <span>{isRecordingActive ? '停止' : '録音'}</span>
              </button>
              <button
                type="button"
                className="record-split-chevron"
                aria-label="録音オプション"
                aria-expanded={recordOptionsOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setRecordOptionsOpen((o) => !o);
                }}
              >
                <ChevronDown size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </aside>
      )}

      <main className="main-area">
        <div className="main-canvas">
          <header className="topbar">
            <div className="topbar-left">
              {!mobile && (
                <button
                  type="button"
                  aria-label={sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
                  className="btn btn-ghost"
                  style={{ width: '32px', height: '32px', padding: 0 }}
                  onClick={() => setSidebarCollapsed((v) => !v)}
                >
                  {sidebarCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
                </button>
              )}
              <h1 className="topbar-title">
                {view === 'editor'
                  ? 'ノート'
                  : view === 'recording'
                  ? '録音'
                  : navItems.find((n) => n.id === view)?.label ?? 'ホーム'}
              </h1>
            </div>

            <button
              type="button"
              className="topbar-search"
              aria-label="ノートや会話を検索"
              onClick={() => {
                setCommandQuery('');
                setCommandSearchOpen(true);
              }}
            >
              <Search size={14} strokeWidth={1.5} />
              <span>ノートや会話を検索...</span>
            </button>

            <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(() => {
                const pendingSyncCount = snapshot.notes.filter(
                  (n) =>
                    secretStatus?.notion_access_token &&
                    snapshot.settings.notion_target_id &&
                    (n.notion_sync.status === 'not_synced' || n.notion_sync.status === 'failed')
                ).length;
                if (pendingSyncCount === 0) return null;
                return (
                  <button
                    type="button"
                    className="status-chip warn"
                    style={{ height: '28px', cursor: 'pointer', border: 'none' }}
                    title="未同期・再試行待ちのノートを今すぐ同期"
                    onClick={() => void retryPendingNotionSyncs(true)}
                  >
                    同期待ち {pendingSyncCount}件
                  </button>
                );
              })()}
              {!mobile && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: '30px', padding: '0 8px', fontSize: '12px' }}
                  title="キーボードショートカット (?)"
                  onClick={() => setShortcutsOpen(true)}
                >
                  ?
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                aria-label="新規ノート"
                style={mobile ? { height: '32px', width: '32px', padding: 0, justifyContent: 'center' } : { height: '30px', padding: '0 12px', fontSize: '12px' }}
                onClick={() => handleCreateManualNote(recordingSpaceId)}
              >
                <Plus size={14} strokeWidth={1.5} />
                {!mobile && '新規ノート'}
              </button>
            </div>
          </header>

          <div className="main-scroll">
        {uploadQueueStatus && (
          <div
            role="status"
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--accent-tint)',
              borderBottom: '1px solid var(--accent-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12.5px',
            }}
          >
            <span>
              インポート文字起こし中 ({uploadQueueStatus.current}/{uploadQueueStatus.total}):{' '}
              <strong>{uploadQueueStatus.fileName}</strong>
            </span>
          </div>
        )}
        {meetingReminder && (
          <div
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--warning-bg)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span>
              まもなく予定が開始されます: <strong>{meetingReminder.title}</strong>
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ height: '28px', fontSize: '12px' }}
                onClick={async () => {
                  const title = meetingReminder.title;
                  setMeetingReminder(null);
                  const note = createEmptyNote(recordingSpaceId || 'personal');
                  note.title = title;
                  if (isTauriRuntime()) {
                    setSnapshot(await apiSaveNote(note));
                  } else {
                    setSnapshot((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
                  }
                  setActiveNoteId(note.id);
                  setView('editor');
                  await handleStartRecording();
                }}
              >
                録音を開始
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMeetingReminder(null)}>
                閉じる
              </button>
            </div>
          </div>
        )}
        {bannerMessage && (
          <div
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--accent-tint)',
              borderBottom: '1px solid var(--accent-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{bannerMessage}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setBannerMessage(null)}>
              閉じる
            </button>
          </div>
        )}

        {view === 'home' && (
          <HomeView
            settings={snapshot.settings}
            notes={snapshot.notes}
            folders={snapshot.folders}
            onOpenNote={(id, query) => {
              setPendingSearchQuery(query || '');
              setActiveNoteId(id);
              setOpenNoteSeq((v) => v + 1);
              setView('editor');
            }}
            onDeleteNote={async (id) => {
              cancelPendingNoteSave(id);
              if (isTauriRuntime()) {
                setSnapshot(await apiDeleteNote(id));
              } else {
                setSnapshot((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
              }
            }}
            onCreateManualNote={handleCreateManualNote}
            onUploadFile={handleUploadAndTranscribe}
            onSaveFolder={handleSaveFolder}
            onDeleteFolder={handleDeleteFolder}
            onSaveNote={async (note) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiSaveNote(note));
              } else {
                setSnapshot((prev) => ({
                  ...prev,
                  notes: prev.notes.map((n) => (n.id === note.id ? note : n)),
                }));
              }
            }}
            onChatSpace={async (ids, q, spaceId) => {
              const res = await apiChatNotes(ids, q, spaceId);
              if (isTauriRuntime() && res.actions && res.actions.length > 0) {
                await refreshAll();
              }
              return res;
            }}
            onGoSettings={() => setSettingsOpen(true)}
          />
        )}

        {view === 'chat' && (
          <ChatView
            notes={snapshot.notes}
            folders={snapshot.folders}
            chatHistory={snapshot.chat_history || []}
            settings={snapshot.settings}
            onChatAcrossNotes={async (ids, q, spaceId) => {
              const res = await apiChatNotes(ids, q, spaceId);
              if (isTauriRuntime()) {
                await refreshAll();
              } else {
                setSnapshot((prev) => ({
                  ...prev,
                  chat_history: [
                    {
                      id: crypto.randomUUID(),
                      timestamp: new Date().toISOString(),
                      space_id: spaceId ?? null,
                      question: q,
                      answer: res.answer,
                      thinking: res.thinking ?? null,
                      citations: res.citations,
                      actions: res.actions,
                    },
                    ...(prev.chat_history || []),
                  ],
                }));
              }
              return res;
            }}
            onApplyChatActions={async (proposals) => {
              if (!isTauriRuntime()) return [];
              const res = await apiApplyChatActionProposals(proposals);
              setSnapshot(res.snapshot);
              return res.results;
            }}
            onClearHistory={async () => {
              if (isTauriRuntime()) {
                setSnapshot(await apiClearChatHistory());
              } else {
                setSnapshot((prev) => ({ ...prev, chat_history: [] }));
              }
            }}
            onDeleteHistoryItems={async (ids) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiDeleteChatHistoryItems(ids));
              } else {
                setSnapshot((prev) => ({
                  ...prev,
                  chat_history: (prev.chat_history || []).filter((h) => !ids.includes(h.id)),
                }));
              }
            }}
            onOpenNote={(id, timestamp, excerpt) => {
              let ms: number | null = null;
              if (timestamp) {
                const parts = timestamp.split(':').map((p) => Number(p));
                if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
                  ms = (parts[0] * 60 + parts[1]) * 1000;
                } else if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
                  ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
                }
              }
              setPendingSeekMs(ms);
              setPendingSearchQuery(excerpt ? excerpt.slice(0, 24) : '');
              setActiveNoteId(id);
              setOpenNoteSeq((v) => v + 1);
              setView('editor');
            }}
            onGoSettings={() => setSettingsOpen(true)}
          />
        )}

        {view === 'upload' && (
          <UploadView
            settings={snapshot.settings}
            models={models}
            busy={transcribing}
            error={transcribeError}
            onUploadAndTranscribe={handleUploadAndTranscribe}
            onUploadUrlAndTranscribe={handleUploadUrlAndTranscribe}
            onGoSettings={() => setSettingsOpen(true)}
            folders={snapshot.folders}
            existingNotes={snapshot.notes}
            onImportNotes={handleImportNotes}
          />
        )}

        {view === 'dictionary' && (
          <DictionaryView
            dictionary={snapshot.dictionary}
            onSaveEntry={async (entry: DictionaryEntry) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiSaveDictionaryEntry(entry));
              } else {
                setSnapshot((prev) => ({ ...prev, dictionary: [...prev.dictionary, entry] }));
              }
            }}
            onDeleteEntry={async (id: string) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiDeleteDictionaryEntry(id));
              } else {
                setSnapshot((prev) => ({ ...prev, dictionary: prev.dictionary.filter((d) => d.id !== id) }));
              }
            }}
          />
        )}

        {view === 'integrations' && (
          <IntegrationsView
            settings={snapshot.settings}
            adapters={adapters}
            secretStatus={secretStatus}
            mcpPreview={mcpPreview}
            folders={snapshot.folders}
            onSaveSettings={async (next) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiSaveSettings(next));
                await refreshAll();
              } else {
                setSnapshot((prev) => ({ ...prev, settings: next }));
              }
            }}
            onSetSecret={async (key, val) => {
              await apiSetSecret(key, val);
              await refreshAll();
            }}
            onNotionSearchTargets={apiNotionSearchTargets}
            onNotionOAuthUrl={apiNotionOAuthUrl}
            onNotionExchangeCode={apiNotionExchangeCode}
            onNotionPullNotes={async () => {
              if (!isTauriRuntime()) return;
              const snap = await apiNotionPullNotes();
              setSnapshot(snap);
              setBannerMessage('Notionからノートとスペースを同期しました');
            }}
          />
        )}

        {view === 'recording' && (
          <RecordingView
            status={recStatus}
            settings={snapshot.settings}
            manualNotes={liveManualNotes}
            liveSegments={liveSegments}
            realtimeSupported={Boolean(
              models.find((m) => m.id === snapshot.settings.active_asr_model_id)?.supports_realtime
            )}
            onChangeManualNotes={setLiveManualNotes}
            onPause={async () => {
              if (isTauriRuntime()) setRecStatus(await apiPauseRecording());
            }}
            onResume={async () => {
              if (isTauriRuntime()) setRecStatus(await apiResumeRecording());
            }}
            onStopAndFinish={handleStopAndFinish}
            onCopyNotice={async (text) => {
              if (isTauriRuntime()) {
                await apiCopyAndPreparePaste(text);
              } else {
                await navigator.clipboard.writeText(text);
              }
            }}
          />
        )}

        {(view === 'editor' || view === 'notes') && !activeNote && (
          <div className="page-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', textAlign: 'center' }}>
            <FileText size={32} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <strong style={{ fontSize: '16px' }}>ノートがありません</strong>
              <span className="text-muted" style={{ fontSize: '13px' }}>
                新しいノートを作成するか、録音を開始してください。
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleCreateManualNote(recordingSpaceId)}
              >
                <Plus size={14} strokeWidth={1.5} />
                新規ノートを作成
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleStartRecording()}
              >
                <Mic size={14} strokeWidth={1.5} />
                録音を開始
              </button>
            </div>
          </div>
        )}

        {(view === 'editor' || view === 'notes') && activeNote && (
          <ErrorBoundary fallbackTitle="ノート画面の表示中にエラーが発生しました">
          <NoteEditorView
            note={activeNote}
            allNotes={snapshot.notes}
            folders={snapshot.folders}
            recordingNoteId={isRecordingActive ? recordingNoteId : null}
            settings={snapshot.settings}
            recipes={snapshot.recipes}
            secretStatus={secretStatus}
            chatHistory={snapshot.chat_history || []}
            popupChatSessions={snapshot.popup_chat_sessions || []}
            onSavePopupChatSessions={async (sessions) => {
              if (isTauriRuntime()) {
                const next = await apiSavePopupChatSessions(sessions);
                if (next) setSnapshot(next);
              } else {
                setSnapshot((prev) => ({ ...prev, popup_chat_sessions: sessions }));
              }
            }}
            initialSearchQuery={pendingSearchQuery || undefined}
            openNoteSeq={openNoteSeq}
            pendingSeekMs={pendingSeekMs}
            transcribing={transcribing && (!recordingNoteId || activeNote.id === recordingNoteId)}
            transcribeProgress={transcribeProgress}
            transcribeError={transcribeError}
            recordingStatus={
              isRecordingActive && (!recordingNoteId || activeNote.id === recordingNoteId)
                ? recStatus
                : INITIAL_RECORDING_STATUS
            }
            liveSegments={
              isRecordingActive && (!recordingNoteId || activeNote.id === recordingNoteId)
                ? liveSegments
                : []
            }
            onStartRecording={handleStartRecordingInNote}
            onStopRecording={handleStopAndFinish}
            onRetranscribeNote={handleRetranscribeNote}
            onUpdateNote={handleUpdateNote}
            onSelectNote={(id) => {
              void flushPendingNote(activeNoteId ?? undefined);
              setPendingSearchQuery('');
              setActiveNoteId(id);
            }}
            onCreateNoteInFolder={(folderId) => handleCreateManualNote(folderId)}
            onSaveFolder={handleSaveFolder}
            onDeleteFolder={handleDeleteFolder}
            onDeleteNote={async (id) => {
              cancelPendingNoteSave(id);
              if (isTauriRuntime()) {
                setSnapshot(await apiDeleteNote(id));
              } else {
                setSnapshot((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
              }
            }}
            onCopyText={async (text) => {
              if (isTauriRuntime()) {
                await apiCopyAndPreparePaste(text);
              } else {
                await navigator.clipboard.writeText(text);
              }
            }}
            onPastePrepare={async (text) => {
              if (isTauriRuntime()) {
                const hint = await apiCopyAndPreparePaste(text);
                setBannerMessage(hint);
              } else {
                await navigator.clipboard.writeText(text);
                setBannerMessage('クリップボードにコピーしました。貼り付け先で Ctrl+V / Cmd+V を押してください。');
              }
            }}
            onSaveToNotion={async (noteId) => {
              await syncNoteToNotion(noteId, false);
            }}
            onSummarize={async (noteId, templateId) => {
              const updated = await apiSummarizeNote(noteId, templateId);
              setSnapshot((prev) => ({
                ...prev,
                notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
              }));
              scheduleAutoNotionSync(noteId, true);
            }}
            onUploadFile={handleUploadAndTranscribe}
            onDraftFollowup={async (noteId) => {
              const updated = await apiDraftFollowup(noteId);
              setSnapshot((prev) => ({
                ...prev,
                notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
              }));
            }}
            onRunRecipe={apiRunRecipe}
            onSaveRecipe={async (recipe) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiSaveRecipe(recipe));
              } else {
                setSnapshot((prev) => ({ ...prev, recipes: [...prev.recipes, recipe] }));
              }
            }}
            onChatNote={async (ids, q, spaceId) => {
              const res = await apiChatNotes(ids, q, spaceId);
              if (isTauriRuntime()) {
                await refreshAll();
              } else {
                setSnapshot((prev) => ({
                  ...prev,
                  chat_history: [
                    {
                      id: crypto.randomUUID(),
                      timestamp: new Date().toISOString(),
                      space_id: spaceId ?? null,
                      question: q,
                      answer: res.answer,
                      thinking: res.thinking ?? null,
                      citations: res.citations,
                      actions: res.actions,
                    },
                    ...(prev.chat_history || []),
                  ],
                }));
              }
              return res;
            }}
            onShareSlack={apiShareToSlack}
            onSendWebhook={apiSendWebhook}
            onAddDictionaryTerm={async (term) => {
              const entry: DictionaryEntry = {
                id: crypto.randomUUID(),
                term,
                reading: '',
                note: '',
                scope: 'personal',
              };
              if (isTauriRuntime()) {
                setSnapshot(await apiSaveDictionaryEntry(entry));
              } else {
                setSnapshot((prev) => ({ ...prev, dictionary: [...prev.dictionary, entry] }));
              }
            }}
            onGoSettings={() => setSettingsOpen(true)}
            onGoHome={() => setView('home')}
          />
          </ErrorBoundary>
        )}

          </div>
        </div>
      </main>
      {mobile && (
        <nav className="mobile-tabbar" aria-label="メインメニュー">
          <button
            type="button"
            className={`mobile-tab ${view === 'home' || view === 'recording' ? 'active' : ''}`}
            onClick={() => setView('home')}
          >
            <Home size={20} strokeWidth={1.5} />
            <span>ホーム</span>
          </button>
          <button
            type="button"
            className={`mobile-tab ${view === 'notes' || view === 'editor' ? 'active' : ''}`}
            onClick={() => setView('notes')}
          >
            <FileText size={20} strokeWidth={1.5} />
            <span>ノート</span>
          </button>
          <button
            type="button"
            className={`mobile-record ${isRecordingActive ? 'recording' : ''}`}
            aria-label={isRecordingActive ? '録音を停止' : '録音を開始'}
            onClick={() => {
              setMoreSheetOpen(false);
              if (isRecordingActive) {
                void handleStopAndFinish();
              } else {
                void handleStartRecording();
              }
            }}
          >
            {isRecordingActive ? <Square size={20} strokeWidth={1.5} /> : <Mic size={20} strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            className={`mobile-tab ${view === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >
            <MessageSquare size={20} strokeWidth={1.5} />
            <span>チャット</span>
          </button>
          <button
            type="button"
            className={`mobile-tab ${moreSheetOpen ? 'active' : ''}`}
            aria-expanded={moreSheetOpen}
            onClick={() => setMoreSheetOpen((o) => !o)}
          >
            <Menu size={20} strokeWidth={1.5} />
            <span>その他</span>
          </button>
        </nav>
      )}
      {mobile && moreSheetOpen && (
        <div className="mobile-more-backdrop" onClick={() => setMoreSheetOpen(false)}>
          <div
            className="mobile-more-sheet"
            role="dialog"
            aria-label="その他のメニュー"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-more-grid">
              {(
                [
                  { id: 'upload', label: 'アップロード', icon: Upload },
                  { id: 'dictionary', label: '辞書', icon: BookOpen },
                  { id: 'integrations', label: '連携', icon: Link2 },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mobile-more-item ${view === item.id ? 'active' : ''}`}
                    onClick={() => {
                      setView(item.id);
                      setMoreSheetOpen(false);
                    }}
                  >
                    <Icon size={20} strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="mobile-more-item"
                onClick={() => {
                  setSettingsOpen(true);
                  setMoreSheetOpen(false);
                }}
              >
                <Settings size={20} strokeWidth={1.5} />
                <span>設定</span>
              </button>
            </div>
            <div className="mobile-more-row">
              <span className="mobile-more-label">保存先スペース</span>
              <select
                aria-label="録音先のスペース"
                className="input"
                value={recordingSpaceId}
                onChange={(e) => setRecordingSpaceId(e.target.value)}
              >
                {snapshot.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            {!android && (
              <div className="mobile-more-row">
                <span className="mobile-more-label">録音ソース</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(
                    [
                      { id: 'mic', label: 'マイク' },
                      { id: 'system', label: '本体音声' },
                      { id: 'both', label: '両方' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`tab-btn ${sourceMode === opt.id ? 'active' : ''}`}
                      style={{ height: '32px', padding: '0 12px', fontSize: '12px' }}
                      onClick={() => {
                        if (sourceMode !== opt.id && (sourceMode === 'system' || opt.id === 'system')) {
                          setSelectedDeviceId('');
                        }
                        setSourceMode(opt.id);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {settingsModal}
      {commandSearchOpen && (
        <div
          className="settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="クイック検索"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCommandSearchOpen(false);
          }}
        >
          <div className="cmd-search-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <Search size={16} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="input"
                style={{ border: 'none', height: '32px', padding: 0 }}
                placeholder="ノート名、本文、文字起こしを検索..."
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: '28px', padding: '0 8px', fontSize: '12px' }}
                onClick={() => setCommandSearchOpen(false)}
              >
                閉じる
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '360px' }}>
              {snapshot.notes
                .filter((n) => {
                  const q = deferredCommandQuery.trim().toLowerCase();
                  if (!q) return true;
                  return [n.title, n.summary, n.manual_notes, ...n.segments.map((s) => s.text)]
                    .join(' ')
                    .toLowerCase()
                    .includes(q);
                })
                .slice(0, 12)
                .map((n) => {
                  const sp = snapshot.folders.find((f) => f.id === n.folder_id)?.name ?? '個人';
                  const matches = deferredCommandQuery.trim() ? findNoteSearchMatches(n, deferredCommandQuery) : [];
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className="flat-row"
                      style={{ borderBottom: 'none', padding: '8px 12px', alignItems: 'flex-start' }}
                      onClick={() => {
                        setPendingSearchQuery(commandQuery.trim());
                        setActiveNoteId(n.id);
                        setOpenNoteSeq((v) => v + 1);
                        setView('notes');
                        setCommandSearchOpen(false);
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <FileText size={14} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                          <span style={{ fontWeight: 500 }}>{n.title.trim() || '無題のノート'}</span>
                        </div>
                        {matches.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '20px' }}>
                            {matches.map((m, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'baseline',
                                  gap: '8px',
                                  fontSize: '12px',
                                  color: 'var(--text-secondary)',
                                  lineHeight: '1.5',
                                }}
                              >
                                <span className="status-chip" style={{ fontSize: '11px', flexShrink: 0 }}>
                                  {m.source}
                                </span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {m.before}
                                  <mark
                                    style={{
                                      backgroundColor: '#FEF08A',
                                      color: 'var(--text-primary)',
                                      padding: '0 4px',
                                      borderRadius: '4px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {m.match}
                                  </mark>
                                  {m.after}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="status-chip" style={{ flexShrink: 0 }}>{sp}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
      {shortcutsOpen && (
        <div
          className="modal-backdrop"
          style={{ alignItems: 'center', paddingTop: 0 }}
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="command-palette"
            role="dialog"
            aria-label="キーボードショートカット一覧"
            style={{ maxWidth: '480px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong style={{ fontSize: '15px' }}>キーボードショートカット</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setShortcutsOpen(false)}>
                閉じる
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: '13px', gap: '8px' }}>
              {[
                ['グローバル録音 開始/停止', snapshot.settings.record_shortcut || 'Ctrl+Shift+R'],
                ['音声入力（Voice Typing）', snapshot.settings.voice_typing_shortcut || 'Ctrl+Shift+V'],
                ['ノート・会話の全体検索', 'Ctrl / Cmd + K'],
                ['再生 / 一時停止（文字起こし）', 'Space'],
                ['5秒戻る / 5秒進む', '← / →'],
                ['ノート内検索（次へ / 前へ）', 'Enter / Shift + Enter'],
                ['ショートカット一覧を表示', '? または Ctrl + /'],
              ].map(([label, key]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <span>{label}</span>
                  <span className="status-chip mono-num">{key}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialogHost />
    </div>
  );
};

export default App;
