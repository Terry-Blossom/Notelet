import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  Home,
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
  DictionaryEntry,
  IntegrationAdapterInfo,
  Note,
  RecordingStatus,
  SecretStatus,
  TranscriptSegment,
} from './types';
import {
  apiChatNotes,
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
  apiRunRecipe,
  apiSaveRecipe,
  apiSaveFolder,
  apiDeleteFolder,
  apiClearChatHistory,
  apiSaveDictionaryEntry,
  apiSaveNote,
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
  isTauriRuntime,
} from './lib/tauri';
import { createEmptyNote, formatMs } from './lib/format';
import { HomeView } from './components/HomeView';
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
  active_asr_model_id: 'whisper-small-q5',
  active_asr_provider: 'local_whisper',
  language: 'ja',
  allow_cloud_asr: false,
  llm_provider: 'none',
  llm_model: 'gpt-4o-mini',
  llm_endpoint: 'http://localhost:11434',
  record_shortcut: 'CommandOrControl+Shift+R',
  voice_typing_shortcut: 'CommandOrControl+Shift+V',
  delete_audio_after_transcribe: true,
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
    return () => {
      active = false;
      clearInterval(timer);
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
          style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '20px' }}
          aria-hidden="true"
        >
          {bars.map((v, idx) => {
            const h = Math.max(4, Math.min(18, Math.round(4 + (Number.isFinite(v) ? v : 0.1) * 14)));
            return (
              <span
                key={idx}
                style={{
                  width: '2px',
                  height: `${h}px`,
                  borderRadius: '2px',
                  backgroundColor: isPaused ? '#A1A1AA' : '#F4F4F5',
                  transition: 'height 120ms ease-out',
                }}
              />
            );
          })}
        </div>
        <span
          data-tauri-drag-region
          style={{ fontVariantNumeric: 'tabular-nums', color: '#E4E4E7', fontSize: '12px', marginLeft: '4px' }}
        >
          {formatMs(status.elapsed_ms)}
        </span>
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

const MainApp: React.FC = () => {
  const [view, setView] = useState<NavView>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [recStatus, setRecStatus] = useState<RecordingStatus>(INITIAL_RECORDING_STATUS);
  const [liveManualNotes, setLiveManualNotes] = useState('');
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [recordingNoteId, setRecordingNoteId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const notionDebounceTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const notionCatchupStartedRef = React.useRef(false);
  const notionPullStartedRef = React.useRef(false);

  const syncNoteToNotion = useCallback(
    async (noteId: string, silent = false) => {
      if (!isTauriRuntime()) return;
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
        setSnapshot((prev) => ({
          ...prev,
          notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
        }));
      } catch (err) {
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
      }
    },
    []
  );

  const scheduleAutoNotionSync = useCallback(
    (noteId: string, immediate = false) => {
      if (!isTauriRuntime()) return;
      if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;
      const existingTimer = notionDebounceTimersRef.current[noteId];
      if (existingTimer) clearTimeout(existingTimer);
      if (immediate) {
        void syncNoteToNotion(noteId, true);
      } else {
        notionDebounceTimersRef.current[noteId] = setTimeout(() => {
          void syncNoteToNotion(noteId, true);
        }, 1800);
      }
    },
    [secretStatus?.notion_access_token, snapshot.settings.notion_target_id, syncNoteToNotion]
  );

  // Catch-up sync for past unsynced or failed notes when Notion is configured
  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;
    if (notionCatchupStartedRef.current) return;
    const pending = snapshot.notes.filter(
      (n) => n.notion_sync.status === 'not_synced' || n.notion_sync.status === 'failed'
    );
    if (pending.length === 0) return;
    notionCatchupStartedRef.current = true;
    void (async () => {
      for (const n of pending) {
        await syncNoteToNotion(n.id, true);
      }
    })();
  }, [secretStatus?.notion_access_token, snapshot.settings.notion_target_id, snapshot.notes, syncNoteToNotion]);

  // Auto-pull notes and spaces from Notion on startup when configured
  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!secretStatus?.notion_access_token || !snapshot.settings.notion_target_id) return;
    if (notionPullStartedRef.current) return;
    notionPullStartedRef.current = true;
    void apiNotionPullNotes()
      .then((snap) => setSnapshot(snap))
      .catch(() => {
        // ignore transient startup pull error
      });
  }, [secretStatus?.notion_access_token, snapshot.settings.notion_target_id]);

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
    let unlistenDl: (() => void) | undefined;
    let unlistenSc: (() => void) | undefined;
    let unlistenUpd: (() => void) | undefined;
    let unlistenLive: (() => void) | undefined;
    let unlistenOverlayStop: (() => void) | undefined;
    let unlistenOverlayStart: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlistenDl = await listen<{ model_id: string; progress: number }>('asr-download-progress', (ev) => {
        setDownloadProgress((prev) => ({ ...prev, [ev.payload.model_id]: ev.payload.progress }));
        if (ev.payload.progress >= 100) {
          void refreshAll();
        }
      });
      unlistenUpd = await listen<{ progress: number }>('app-update-progress', (ev) => {
        setUpdateProgress(ev.payload.progress);
      });
      unlistenLive = await listen<TranscriptSegment>('live-transcript-segment', (ev) => {
        setLiveSegments((prev) => [...prev, ev.payload]);
      });
      unlistenSc = await listen<string>('global-shortcut-triggered', () => {
        if (recStatus.state === 'recording' || recStatus.state === 'paused') {
          void handleStopAndFinish();
        } else {
          void handleStartRecording();
        }
      });
      unlistenOverlayStop = await listen('overlay-stop-recording', () => {
        void handleStopAndFinish();
      });
      unlistenOverlayStart = await listen('overlay-start-recording', () => {
        void handleStartRecording();
      });
    });
    return () => {
      unlistenDl?.();
      unlistenUpd?.();
      unlistenLive?.();
      unlistenSc?.();
      unlistenOverlayStop?.();
      unlistenOverlayStart?.();
    };
  }, [recStatus.state, refreshAll]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (recStatus.state !== 'recording' && recStatus.state !== 'paused') return;
    const timer = setInterval(async () => {
      try {
        const st = await apiGetRecordingStatus();
        setRecStatus(st);
      } catch {
        // ignore transient polling error
      }
    }, 150);
    return () => clearInterval(timer);
  }, [recStatus.state]);

  const handleStartRecording = async () => {
    setTranscribeError(null);
    setLiveManualNotes('');
    setLiveSegments([]);
    if (!isTauriRuntime()) {
      const note = createEmptyNote(recordingSpaceId);
      note.title = '';
      setSnapshot((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
      setRecordingNoteId(note.id);
      setActiveNoteId(note.id);
      setView('editor');
      return;
    }
    try {
      const note = createEmptyNote(recordingSpaceId);
      note.title = '';
      const nextSnap = await apiSaveNote(note);
      setSnapshot(nextSnap);
      setRecordingNoteId(note.id);
      setActiveNoteId(note.id);
      setView('editor');
      const st = await apiStartRecording(sourceMode, selectedDeviceId || null);
      setRecStatus(st);
    } catch (e) {
      setBannerMessage(String(e));
    }
  };

  const handleStartRecordingInNote = async () => {
    setTranscribeError(null);
    setLiveSegments([]);
    setRecordingNoteId(activeNoteId);
    if (!isTauriRuntime()) return;
    try {
      const st = await apiStartRecording(sourceMode, selectedDeviceId || null);
      setRecStatus(st);
    } catch (e) {
      setBannerMessage(String(e));
    }
  };

  const handleStopAndFinish = async () => {
    const finalStatus = isTauriRuntime() ? await apiStopRecording() : recStatus;
    setRecStatus(INITIAL_RECORDING_STATUS);
    const targetId = recordingNoteId || activeNoteId;
    setRecordingNoteId(null);
    const existing = snapshot.notes.find((n) => n.id === targetId);
    const nowStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const targetNote: Note = existing
      ? {
          ...existing,
          title: existing.title.trim() ? existing.title : `録音ノート ${nowStr}`,
          duration_sec: existing.duration_sec + Math.round(finalStatus.elapsed_ms / 1000),
          manual_notes: liveManualNotes
            ? [existing.manual_notes, liveManualNotes].filter(Boolean).join('\n')
            : existing.manual_notes,
          segments: liveSegments.length > 0 ? [...existing.segments, ...liveSegments] : existing.segments,
          updated_at: new Date().toISOString(),
        }
      : {
          ...createEmptyNote(recordingSpaceId),
          duration_sec: Math.round(finalStatus.elapsed_ms / 1000),
          manual_notes: liveManualNotes,
          segments: liveSegments,
          language: snapshot.settings.language,
        };

    if (isTauriRuntime()) {
      const nextSnap = await apiSaveNote(targetNote);
      setSnapshot(nextSnap);
      setActiveNoteId(targetNote.id);
      setView('editor');

      if (finalStatus.temp_wav_path && liveSegments.length === 0) {
        setTranscribing(true);
        setTranscribeError(null);
        try {
          const updatedNote = await apiTranscribeRecording(finalStatus.temp_wav_path, targetNote.id);
          const mergedSegments =
            existing && existing.segments.length > 0 && updatedNote.segments.length > 0
              ? [...existing.segments, ...updatedNote.segments]
              : updatedNote.segments;
          const finalNote = { ...updatedNote, segments: mergedSegments };
          setSnapshot((prev) => ({
            ...prev,
            notes: prev.notes.map((n) => (n.id === finalNote.id ? finalNote : n)),
          }));
          scheduleAutoNotionSync(finalNote.id, true);
        } catch (err) {
          setTranscribeError(String(err));
        } finally {
          setTranscribing(false);
        }
      } else {
        scheduleAutoNotionSync(targetNote.id, true);
      }
    } else {
      setSnapshot((prev) => ({
        ...prev,
        notes: existing
          ? prev.notes.map((n) => (n.id === targetNote.id ? targetNote : n))
          : [targetNote, ...prev.notes],
      }));
      setActiveNoteId(targetNote.id);
      setView('editor');
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

  const handleUpdateNote = async (updated: Note) => {
    setSnapshot((prev) => ({
      ...prev,
      notes: prev.notes.some((n) => n.id === updated.id)
        ? prev.notes.map((n) => (n.id === updated.id ? updated : n))
        : [updated, ...prev.notes],
    }));
    setActiveNoteId((prevId) => prevId || updated.id);
    if (isTauriRuntime()) {
      const nextSnap = await apiSaveNote(updated);
      setSnapshot(nextSnap);
      scheduleAutoNotionSync(updated.id, false);
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
  const fallbackEditorNote = React.useMemo(() => createEmptyNote(recordingSpaceId), [recordingSpaceId]);
  const editorNote = activeNote || fallbackEditorNote;
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
        <button
          type="button"
          aria-label="設定を閉じる"
          className="btn btn-ghost"
          onClick={() => setSettingsOpen(false)}
          style={{ position: 'absolute', top: '12px', right: '16px', zIndex: 20, width: '32px', height: '32px', padding: 0 }}
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
            const json = isTauriRuntime()
              ? await apiExportAllData()
              : JSON.stringify(snapshot, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'koenote-export.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
          onPurgeAll={async () => {
            if (isTauriRuntime()) {
              setSnapshot(await apiPurgeAllData());
            } else {
              setSnapshot((prev) => ({ ...prev, notes: [], audit_logs: [] }));
            }
          }}
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="app-shell">
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
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`tab-btn ${sourceMode === opt.id ? 'active' : ''}`}
                      style={{ flex: 1, height: '28px', padding: '0 8px', fontSize: '12px' }}
                      onClick={() => setSourceMode(opt.id)}
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
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
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

      <main className="main-area">
        <div className="main-canvas">
          <header className="topbar">
            <div className="topbar-left">
              <button
                type="button"
                aria-label={sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
                className="btn btn-ghost"
                style={{ width: '32px', height: '32px', padding: 0 }}
                onClick={() => setSidebarCollapsed((v) => !v)}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
              </button>
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
              onClick={() => {
                setCommandQuery('');
                setCommandSearchOpen(true);
              }}
            >
              <Search size={14} strokeWidth={1.5} />
              <span>ノートや会話を検索...</span>
            </button>

            <div className="topbar-right">
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '30px', padding: '0 12px', fontSize: '12px' }}
                onClick={() => handleCreateManualNote(recordingSpaceId)}
              >
                <Plus size={14} strokeWidth={1.5} />
                新規ノート
              </button>
            </div>
          </header>

          <div className="main-scroll">
            {isRecordingActive && (
          <div className="recording-dock" role="status" aria-live="polite">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="recording-live-dot" />
              <strong style={{ fontSize: '14px', color: 'var(--danger)' }}>
                {recStatus.state === 'paused' ? '録音一時停止中' : '録音中'}
              </strong>
              <span className="mono-num" style={{ fontWeight: 600 }}>
                {formatMs(recStatus.elapsed_ms)}
              </span>
              <span className="text-muted">{recStatus.device_name}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(view !== 'editor' || (recordingNoteId && activeNoteId !== recordingNoteId)) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '30px' }}
                  onClick={() => {
                    if (recordingNoteId) setActiveNoteId(recordingNoteId);
                    setView('editor');
                  }}
                >
                  録音中のノートへ
                </button>
              )}
              <button type="button" className="btn btn-danger" style={{ height: '30px' }} onClick={handleStopAndFinish}>
                <Square size={13} strokeWidth={1.5} />
                停止
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
            onOpenNote={(id) => {
              setActiveNoteId(id);
              setView('editor');
            }}
            onDeleteNote={async (id) => {
              if (isTauriRuntime()) {
                setSnapshot(await apiDeleteNote(id));
              } else {
                setSnapshot((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
              }
            }}
            onCreateManualNote={handleCreateManualNote}
            onSaveFolder={handleSaveFolder}
            onDeleteFolder={handleDeleteFolder}
            onChatSpace={apiChatNotes}
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
                      citations: res.citations,
                    },
                    ...(prev.chat_history || []),
                  ],
                }));
              }
              return res;
            }}
            onClearHistory={async () => {
              if (isTauriRuntime()) {
                setSnapshot(await apiClearChatHistory());
              } else {
                setSnapshot((prev) => ({ ...prev, chat_history: [] }));
              }
            }}
            onOpenNote={(id) => {
              setActiveNoteId(id);
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

        {(view === 'editor' || view === 'notes') && (
          <NoteEditorView
            note={editorNote}
            allNotes={snapshot.notes}
            folders={snapshot.folders}
            recordingNoteId={isRecordingActive ? recordingNoteId : null}
            settings={snapshot.settings}
            recipes={snapshot.recipes}
            secretStatus={secretStatus}
            transcribing={transcribing && (!recordingNoteId || editorNote.id === recordingNoteId)}
            transcribeError={transcribeError}
            recordingStatus={
              isRecordingActive && (!recordingNoteId || editorNote.id === recordingNoteId)
                ? recStatus
                : INITIAL_RECORDING_STATUS
            }
            liveSegments={
              isRecordingActive && (!recordingNoteId || editorNote.id === recordingNoteId)
                ? liveSegments
                : []
            }
            onStartRecording={handleStartRecordingInNote}
            onStopRecording={handleStopAndFinish}
            onUpdateNote={handleUpdateNote}
            onSelectNote={(id) => setActiveNoteId(id)}
            onCreateNoteInFolder={(folderId) => handleCreateManualNote(folderId)}
            onSaveFolder={handleSaveFolder}
            onDeleteFolder={handleDeleteFolder}
            onDeleteNote={async (id) => {
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
            onSummarize={async (noteId) => {
              const updated = await apiSummarizeNote(noteId);
              setSnapshot((prev) => ({
                ...prev,
                notes: prev.notes.map((n) => (n.id === updated.id ? updated : n)),
              }));
              scheduleAutoNotionSync(noteId, true);
            }}
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
            onChatNote={apiChatNotes}
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
        )}

          </div>
        </div>
      </main>
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
                  const q = commandQuery.trim().toLowerCase();
                  if (!q) return true;
                  return [n.title, n.summary, n.manual_notes, ...n.segments.map((s) => s.text)]
                    .join(' ')
                    .toLowerCase()
                    .includes(q);
                })
                .slice(0, 12)
                .map((n) => {
                  const sp = snapshot.folders.find((f) => f.id === n.folder_id)?.name ?? '個人';
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className="flat-row"
                      style={{ borderBottom: 'none', padding: '8px 12px' }}
                      onClick={() => {
                        setActiveNoteId(n.id);
                        setView('notes');
                        setCommandSearchOpen(false);
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <FileText size={14} strokeWidth={1.5} />
                        <span style={{ fontWeight: 500 }}>{n.title.trim() || '無題のノート'}</span>
                      </div>
                      <span className="status-chip">{sp}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
