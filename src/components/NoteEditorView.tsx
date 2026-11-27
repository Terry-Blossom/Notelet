import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Cloud,
  Copy,
  Download,
  FileText,
  Folder as FolderIcon,
  GitMerge,
  Link2,
  List,
  Loader2,
  Menu,
  Mic,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  AppSettings,
  CalendarEventItem,
  ChatAnswer,
  ChatCitation,
  ChatHistoryItem,
  DEFAULT_SUMMARY_PRESETS,
  Folder,
  Note,
  PopupChatSession,
  Recipe,
  RecordingStatus,
  SecretStatus,
  TranscriptSegment,
} from '../types';
import {
  findNoteSearchMatches,
  formatDateTime,
  formatNoteForCopy,
  formatNoteTimer,
} from '../lib/format';
import { sanitizeMemoHtml } from '../lib/sanitizeHtml';
import { useTauriEvent } from '../lib/tauriEvents';
import { NoteChatPopup } from './note-editor/NoteChatPopup';
import { NoteMemoPanel } from './note-editor/NoteMemoPanel';
import { NoteRecordingPill } from './note-editor/NoteRecordingPill';
import { NoteSummaryPanel } from './note-editor/NoteSummaryPanel';
import { NoteTranscriptPanel } from './note-editor/NoteTranscriptPanel';
import { NotionSyncBadge } from './NotionSyncBadge';
import { confirmActionDialog, confirmDeleteDialog } from './ConfirmDialog';
import {
  apiCreateIssueFromAction,
  apiFetchNotionNoteContent,
  apiGetUpcomingCalendarEvents,
  apiReadNoteAudio,
  apiSetNoteStorageMode,
  isTauriRuntime,
} from '../lib/tauri';

const CHAT_SESSIONS_KEY = 'notelet_chat_sessions_v1';
const LAST_CHAT_SESSION_KEY = 'notelet_last_chat_session_v1';

function loadChatSessions(): PopupChatSession[] {
  try {
    const raw = localStorage.getItem(CHAT_SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as PopupChatSession[]) : [];
  } catch {
    return [];
  }
}

function loadLastSessionMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_CHAT_SESSION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export type NotePhase = 'idle' | 'recording' | 'processing' | 'completed';

interface NoteEditorViewProps {
  note: Note;
  allNotes?: Note[];
  folders?: Folder[];
  chatHistory?: ChatHistoryItem[];
  popupChatSessions?: PopupChatSession[];
  onSavePopupChatSessions?: (sessions: PopupChatSession[]) => Promise<void> | void;
  initialSearchQuery?: string | null;
  openNoteSeq?: number;
  pendingSeekMs?: number | null;
  recordingNoteId?: string | null;
  settings: AppSettings;
  recipes: Recipe[];
  secretStatus: SecretStatus | null;
  transcribing: boolean;
  transcribeProgress?: { note_id: string; progress: number; label: string } | null;
  transcribeError: string | null;
  recordingStatus?: RecordingStatus;
  liveSegments?: TranscriptSegment[];
  onStartRecording?: () => Promise<void> | void;
  onStopRecording?: () => Promise<void> | void;
  onRetranscribeNote?: (noteId: string) => Promise<void> | void;
  onUpdateNote: (note: Note) => void;
  onSelectNote?: (noteId: string) => void;
  onCreateNoteInFolder?: (folderId: string) => void;
  onSaveFolder?: (folder: Folder) => Promise<void>;
  onDeleteFolder?: (folderId: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onCopyText: (text: string, label: string) => Promise<void>;
  onPastePrepare: (text: string) => Promise<void>;
  onSaveToNotion: (noteId: string) => Promise<void>;
  onSummarize: (noteId: string, templateId?: string) => Promise<void>;
  onDraftFollowup: (noteId: string) => Promise<void>;
  onRunRecipe: (noteId: string, prompt: string) => Promise<string>;
  onSaveRecipe: (recipe: Recipe) => Promise<void>;
  onChatNote: (noteIds: string[], question: string, spaceId?: string | null) => Promise<ChatAnswer>;
  onShareSlack: (noteId: string) => Promise<void>;
  onSendWebhook: (noteId: string) => Promise<void>;
  onAddDictionaryTerm: (term: string) => Promise<void>;
  onUploadFile?: (file: File) => Promise<void>;
  onGoSettings: () => void;
  onGoHome?: () => void;
}

export const NoteEditorView: React.FC<NoteEditorViewProps> = ({
  note,
  allNotes,
  folders = [{ id: 'personal', name: '一般', is_shared: false, permission: 'owner' }],
  chatHistory = [],
  popupChatSessions,
  onSavePopupChatSessions,
  initialSearchQuery = null,
  openNoteSeq = 0,
  pendingSeekMs = null,
  recordingNoteId = null,
  settings,
  secretStatus,
  transcribing,
  transcribeProgress = null,
  transcribeError,
  recordingStatus,
  liveSegments: externalLiveSegments = [],
  onStartRecording,
  onStopRecording,
  onRetranscribeNote,
  onUpdateNote,
  onSelectNote,
  onCreateNoteInFolder,
  onSaveFolder,
  onDeleteFolder,
  onDeleteNote,
  onCopyText,
  onPastePrepare,
  onSaveToNotion,
  onSummarize,
  onChatNote,
  onShareSlack,
  onSendWebhook,
  onAddDictionaryTerm,
  onGoSettings,
}) => {
  // Sidebar & responsive drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [dropdownNewSpaceName, setDropdownNewSpaceName] = useState('');
  const [chatScope, setChatScope] = useState<'note' | 'space' | 'all'>('note');
  const [inNoteSearchOpen, setInNoteSearchOpen] = useState(Boolean(initialSearchQuery));
  const [inNoteSearchQuery, setInNoteSearchQuery] = useState(initialSearchQuery ?? '');
  const chatMessagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [viewingFolderId, setViewingFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [editingSpaceName, setEditingSpaceName] = useState(false);
  const [spaceNameDraft, setSpaceNameDraft] = useState('');
  const [spaceChatQuestion, setSpaceChatQuestion] = useState('');
  const [spaceChatBusy, setSpaceChatBusy] = useState(false);
  const [spaceChatError, setSpaceChatError] = useState<string | null>(null);
  const [spaceSearchQuery, setSpaceSearchQuery] = useState('');
  const [spaceSortOrder, setSpaceSortOrder] = useState<'newest' | 'oldest' | 'title'>('newest');
  const [spaceSelectMode, setSpaceSelectMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [bulkMoveTargetId, setBulkMoveTargetId] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [noteContextMenu, setNoteContextMenu] = useState<{ noteId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!noteContextMenu) return;
    const close = () => setNoteContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNoteContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [noteContextMenu]);

  useEffect(() => {
    setSpaceSelectMode(false);
    setSelectedNoteIds([]);
    setSpaceSearchQuery('');
    setMergeOpen(false);
  }, [viewingFolderId]);

  const notesList = useMemo(
    () => (allNotes && allNotes.length > 0 ? allNotes : [note]),
    [allNotes, note]
  );

  // Inline title editing with Enter confirm / Esc cancel
  const [titleDraft, setTitleDraft] = useState(note.title);
  const titleSnapshotRef = useRef(note.title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const skipTitleBlurSaveRef = useRef(false);

  useEffect(() => {
    setViewingFolderId(null);
    skipTitleBlurSaveRef.current = false;
    setTitleDraft(note.title);
    titleSnapshotRef.current = note.title;
  }, [note.id, openNoteSeq]);

  useEffect(() => {
    if (titleInputRef.current && document.activeElement === titleInputRef.current) {
      return;
    }
    setTitleDraft(note.title);
    titleSnapshotRef.current = note.title;
  }, [note.title]);

  // Tabs: 3 stages (文字起こし / 要約 / メモ)
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'memo'>('transcript');
  const [hasUnreadTranscript, setHasUnreadTranscript] = useState(false);
  const transcriptTabRef = useRef<HTMLButtonElement>(null);
  const summaryTabRef = useRef<HTMLButtonElement>(null);
  const memoTabRef = useRef<HTMLButtonElement>(null);
  const memoEditorRef = useRef<HTMLDivElement>(null);

  // Popovers & dialogs
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [notionPreviewOpen, setNotionPreviewOpen] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Recording / processing / playback state
  const [localRecording, setLocalRecording] = useState(false);
  const [localProcessing, setLocalProcessing] = useState(false);
  const [localElapsedMs, setLocalElapsedMs] = useState(0);
  const [localRms, setLocalRms] = useState(0);
  const [localFallbackSegments, setLocalFallbackSegments] = useState<TranscriptSegment[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editingSegText, setEditingSegText] = useState('');
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareRevisionId, setCompareRevisionId] = useState<string | null>(null);
  const [dismissedCandidates, setDismissedCandidates] = useState<Record<string, boolean>>({});
  const summaryPresets = useMemo(
    () =>
      settings.summary_presets && settings.summary_presets.length > 0
        ? settings.summary_presets
        : DEFAULT_SUMMARY_PRESETS,
    [settings.summary_presets]
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    settings.active_template_id || summaryPresets[0]?.id || 'standard'
  );
  useEffect(() => {
    if (!summaryPresets.some((p) => p.id === selectedTemplateId)) {
      setSelectedTemplateId(summaryPresets[0]?.id || 'standard');
    }
  }, [summaryPresets, selectedTemplateId]);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState<boolean>(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventItem[]>([]);
  const [streamingChatText, setStreamingChatText] = useState<string>('');
  const [viewerNote, setViewerNote] = useState<Note | null>(null);
  const [viewerLoading, setViewerLoading] = useState<boolean>(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const inNoteSearchInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlCacheRef = useRef<Record<string, string>>({});

  const reloadNotionViewer = async () => {
    if (!isTauriRuntime() || note.storage_mode !== 'notion_only' || !note.notion_sync.page_id) {
      return;
    }
    setViewerLoading(true);
    setViewerError(null);
    try {
      const fetched = await apiFetchNotionNoteContent(note.id);
      setViewerNote(fetched);
      if (fetched.title && fetched.title !== titleDraft) {
        setTitleDraft(fetched.title);
      }
    } catch (err) {
      setViewerError(String(err));
    } finally {
      setViewerLoading(false);
    }
  };

  useEffect(() => {
    setViewerNote(null);
    setViewerError(null);
    if (note.storage_mode === 'notion_only' && isTauriRuntime() && note.notion_sync.page_id) {
      void reloadNotionViewer();
    }
  }, [note.id, note.storage_mode, note.updated_at]);

  useEffect(() => {
    if (initialSearchQuery && initialSearchQuery.trim()) {
      setInNoteSearchOpen(true);
      setInNoteSearchQuery(initialSearchQuery.trim());
    }
  }, [initialSearchQuery, note.id, openNoteSeq]);

  useEffect(() => {
    if (pendingSeekMs !== null && pendingSeekMs !== undefined) {
      setActiveTab('transcript');
      if (note.audio_path) {
        void playNoteAudioFromMs(pendingSeekMs);
      } else {
        setPlaybackMs(pendingSeekMs);
      }
    }
  }, [pendingSeekMs, note.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setInNoteSearchOpen(true);
        setTimeout(() => inNoteSearchInputRef.current?.focus(), 0);
      } else if (e.key === 'Escape' && inNoteSearchOpen) {
        setInNoteSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inNoteSearchOpen]);

  useTauriEvent<string>('chat-stream-chunk', (payload) => {
    if (typeof payload === 'string') {
      setStreamingChatText(payload);
    }
  });

  // Persistent popup chat sessions (synced with AppDataSnapshot + one-time localStorage migration)
  const [chatSessions, setChatSessions] = useState<PopupChatSession[]>(() =>
    popupChatSessions && popupChatSessions.length > 0 ? popupChatSessions : loadChatSessions()
  );
  const migratedPopupRef = useRef(false);
  useEffect(() => {
    if (popupChatSessions && popupChatSessions.length > 0) {
      setChatSessions(popupChatSessions);
      migratedPopupRef.current = true;
      try {
        localStorage.removeItem(CHAT_SESSIONS_KEY);
      } catch {
        // ignore storage errors
      }
    } else if (!migratedPopupRef.current && popupChatSessions && popupChatSessions.length === 0) {
      const legacy = loadChatSessions();
      if (legacy.length > 0 && onSavePopupChatSessions) {
        migratedPopupRef.current = true;
        try {
          void Promise.resolve(onSavePopupChatSessions(legacy.slice(0, 100))).then(() => {
            localStorage.removeItem(CHAT_SESSIONS_KEY);
          }).catch(() => {
            migratedPopupRef.current = false;
          });
        } catch {
          migratedPopupRef.current = false;
        }
      } else if (legacy.length === 0) {
        migratedPopupRef.current = true;
        try {
          localStorage.removeItem(CHAT_SESSIONS_KEY);
        } catch {
          // ignore storage errors
        }
      }
    }
  }, [popupChatSessions, onSavePopupChatSessions]);
  const [lastSessionByScope, setLastSessionByScope] = useState<Record<string, string>>(() => loadLastSessionMap());
  const [chatPopupOpen, setChatPopupOpen] = useState<boolean>(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const composerUnifiedRef = useRef<HTMLDivElement | null>(null);

  const currentScopeKey = viewingFolderId ? `space:${viewingFolderId}` : `note:${note.id}`;

  const persistPopupSessions = (next: PopupChatSession[]) => {
    if (onSavePopupChatSessions) {
      void onSavePopupChatSessions(next.slice(0, 100));
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(LAST_CHAT_SESSION_KEY, JSON.stringify(lastSessionByScope));
    } catch {
      // ignore
    }
  }, [lastSessionByScope]);

  // Close popup when switching notes/spaces (tapping the textbox reopens the last session)
  useEffect(() => {
    setChatHistoryOpen(false);
    setChatPopupOpen(false);
  }, [currentScopeKey]);

  // Close popup when clicking outside the unified popup + composer container
  useEffect(() => {
    if (!chatPopupOpen) return;
    const onDown = (e: MouseEvent) => {
      if (composerUnifiedRef.current && !composerUnifiedRef.current.contains(e.target as Node)) {
        setChatPopupOpen(false);
        setChatHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [chatPopupOpen]);

  // Sync rich memo HTML when note or activeTab switches
  useEffect(() => {
    if (activeTab === 'memo' && memoEditorRef.current) {
      const sourceMemo =
        note.storage_mode === 'notion_only' && viewerNote && viewerNote.id === note.id
          ? viewerNote.manual_notes
          : note.manual_notes;
      const targetHtml = sanitizeMemoHtml(sourceMemo || '');
      if (
        document.activeElement !== memoEditorRef.current &&
        memoEditorRef.current.innerHTML !== targetHtml
      ) {
        memoEditorRef.current.innerHTML = targetHtml;
      }
    }
  }, [note.id, activeTab, note.manual_notes, note.storage_mode, viewerNote]);

  const saveMemoHtml = (html: string) => {
    const clean = sanitizeMemoHtml(html);
    if (clean === note.manual_notes) return;
    onUpdateNote({
      ...note,
      manual_notes: clean,
      updated_at: new Date().toISOString(),
    });
  };

  const applyMemoCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (memoEditorRef.current) {
      saveMemoHtml(memoEditorRef.current.innerHTML);
    }
  };

  // Per-note AI / Q&A state so summarizing Note A never blocks Note B
  const [summarizingByNote, setSummarizingByNote] = useState<Record<string, boolean>>({});
  const [askingByNote, setAskingByNote] = useState<Record<string, boolean>>({});
  const [aiErrorByNote, setAiErrorByNote] = useState<Record<string, string | null>>({});
  const [dismissedSuggestByNote, setDismissedSuggestByNote] = useState<Record<string, boolean>>({});
  const [question, setQuestion] = useState('');

  const isSummarizingThisNote = Boolean(summarizingByNote[note.id]);
  const isAskingThisNote = Boolean(askingByNote[note.id]);
  const aiError = aiErrorByNote[note.id] ?? null;

  const handleRunSummarize = async () => {
    const targetNoteId = note.id;
    if (summarizingByNote[targetNoteId]) return;
    setActiveTab('summary');
    setSummarizingByNote((prev) => ({ ...prev, [targetNoteId]: true }));
    setAiErrorByNote((prev) => ({ ...prev, [targetNoteId]: null }));
    try {
      await onSummarize(targetNoteId, selectedTemplateId);
    } catch (err) {
      setAiErrorByNote((prev) => ({ ...prev, [targetNoteId]: String(err) }));
    } finally {
      setSummarizingByNote((prev) => ({ ...prev, [targetNoteId]: false }));
    }
  };

  // Scroll tracking
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // Determine effective recording state (external Tauri or local fallback)
  const isExternalRecording =
    recordingStatus?.state === 'recording' || recordingStatus?.state === 'paused';
  const isRecording = isExternalRecording || localRecording;
  const isProcessing = transcribing || localProcessing;

  const prevExtRecRef = useRef(isExternalRecording);
  useEffect(() => {
    if (isExternalRecording) {
      setLocalRecording(false);
    } else if (prevExtRecRef.current && !isExternalRecording) {
      setLocalRecording(false);
      setLocalRms(0);
    }
    prevExtRecRef.current = isExternalRecording;
  }, [isExternalRecording]);

  const effectiveNote =
    note.storage_mode === 'notion_only' && viewerNote && viewerNote.id === note.id
      ? viewerNote
      : note;

  const displayedSegments = useMemo(() => {
    if (isRecording) {
      const merged = [...effectiveNote.segments, ...externalLiveSegments, ...localFallbackSegments];
      if (merged.length > 0) return merged;
    }
    return effectiveNote.segments;
  }, [isRecording, externalLiveSegments, localFallbackSegments, effectiveNote.segments]);

  const totalDurationMs = useMemo(() => {
    if (note.duration_sec > 0) return note.duration_sec * 1000;
    const lastSeg = note.segments[note.segments.length - 1];
    return lastSeg ? lastSeg.end_ms : 0;
  }, [note.duration_sec, note.segments]);

  const phase: NotePhase = useMemo(() => {
    if (isRecording) return 'recording';
    if (isProcessing) return 'processing';
    if (note.segments.length > 0 || note.duration_sec > 0) return 'completed';
    return 'idle';
  }, [isRecording, isProcessing, note.segments.length, note.duration_sec]);

  // Announce phase transitions politely
  const prevPhaseRef = useRef<NotePhase>(phase);
  useEffect(() => {
    if (prevPhaseRef.current === phase) return;
    prevPhaseRef.current = phase;
    if (phase === 'recording') {
      setLiveAnnouncement('録音を開始しました');
    } else if (phase === 'processing') {
      setLiveAnnouncement('文字起こし中です');
    } else if (phase === 'completed') {
      setLiveAnnouncement('文字起こしが完了しました');
    }
  }, [phase]);

  // Local timer when recording without Tauri runtime (stays flat/silent when no real audio input)
  useEffect(() => {
    if (!localRecording) return;
    const startAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startAt;
      setLocalElapsedMs(elapsed);
      setLocalRms(0);
    }, 200);
    return () => clearInterval(id);
  }, [localRecording]);

  // Stop audio when switching notes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setPlaybackMs(0);
  }, [note.id]);

  // Real audio playback (with timer fallback in non-Tauri test env)
  useEffect(() => {
    if (!isPlaying || phase !== 'completed') return;
    if (isTauriRuntime() && note.audio_path) return;
    const dur = Math.max(totalDurationMs, 10000);
    const id = setInterval(() => {
      setPlaybackMs((prev) => {
        if (prev + 250 >= dur) {
          setIsPlaying(false);
          return 0;
        }
        return prev + 250;
      });
    }, 250);
    return () => clearInterval(id);
  }, [isPlaying, phase, totalDurationMs, note.audio_path]);

  // Auto-skip silence & auto-scroll active karaoke segment during playback
  useEffect(() => {
    if (!isPlaying) return;
    if (settings.silence_skip_enabled && displayedSegments.length > 0) {
      const inSegment = displayedSegments.some(
        (s) => playbackMs >= s.start_ms && playbackMs <= s.end_ms + 300
      );
      if (!inSegment) {
        const nextSeg = displayedSegments.find((s) => s.start_ms > playbackMs + 1200);
        if (nextSeg) {
          if (audioRef.current) {
            audioRef.current.currentTime = nextSeg.start_ms / 1000;
          }
          setPlaybackMs(nextSeg.start_ms);
        }
      }
    }
    if (scrollRef.current) {
      const activeEl = scrollRef.current.querySelector('.note-turn.playing');
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [isPlaying, playbackMs, settings.silence_skip_enabled, displayedSegments]);

  const cyclePlaybackRate = () => {
    const rates = [1.0, 1.25, 1.5, 2.0];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const playNoteAudioFromMs = async (startMs?: number) => {
    if (isTauriRuntime()) {
      if (!note.audio_path) {
        notify('このノートには保存された録音音声がありません');
        return;
      }
      try {
        let playUrl = audioUrlCacheRef.current[note.id];
        if (!playUrl) {
          const dataUrl = await apiReadNoteAudio(note.id);
          if (dataUrl.startsWith('data:')) {
            const commaIdx = dataUrl.indexOf(',');
            const header = dataUrl.slice(5, commaIdx);
            const mime = header.split(';')[0] || 'audio/wav';
            const b64 = dataUrl.slice(commaIdx + 1);
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) {
              bytes[i] = bin.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mime });
            playUrl = URL.createObjectURL(blob);
          } else {
            playUrl = dataUrl;
          }
          audioUrlCacheRef.current[note.id] = playUrl;
        }
        if (!audioRef.current) {
          const el = new Audio(playUrl);
          el.addEventListener('timeupdate', () => {
            setPlaybackMs(Math.round(el.currentTime * 1000));
          });
          el.addEventListener('ended', () => {
            setIsPlaying(false);
            setPlaybackMs(0);
          });
          audioRef.current = el;
        } else if (audioRef.current.src !== playUrl) {
          audioRef.current.src = playUrl;
        }
        audioRef.current.playbackRate = playbackRate;
        const seekSec = ((startMs ?? playbackMs) || 0) / 1000;
        audioRef.current.currentTime = seekSec;
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        notify(`音声の再生に失敗しました: ${String(err)}`);
        setIsPlaying(false);
      }
    } else {
      if (startMs !== undefined) setPlaybackMs(startMs);
      setIsPlaying(true);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      void playNoteAudioFromMs();
    }
  };

  const skipAudioBy = (deltaMs: number) => {
    const nextMs = Math.max(0, playbackMs + deltaMs);
    if (audioRef.current) {
      audioRef.current.currentTime = nextMs / 1000;
      setPlaybackMs(nextMs);
    } else if (note.audio_path) {
      void playNoteAudioFromMs(nextMs);
    }
  };

  useEffect(() => {
    const onPlayKeyDown = (e: KeyboardEvent) => {
      if (phase !== 'completed' || !note.audio_path) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skipAudioBy(-5000);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipAudioBy(5000);
      }
    };
    window.addEventListener('keydown', onPlayKeyDown);
    return () => window.removeEventListener('keydown', onPlayKeyDown);
  }, [phase, note.audio_path, isPlaying, playbackMs]);

  const formatSrtTime = (ms: number, sep: ',' | '.' = ',') => {
    const totalMs = Math.max(0, Math.floor(ms));
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const rem = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(rem).padStart(3, '0')}`;
  };

  const exportTranscriptAs = (format: 'srt' | 'vtt' | 'txt' | 'md') => {
    const segs = displayedSegments;
    if (segs.length === 0) {
      notify('エクスポートする文字起こしがありません');
      return;
    }
    const baseName = (note.title.trim() || 'transcript').replace(/[\\/:*?"<>|]/g, '_');
    let content = '';
    if (format === 'srt') {
      content = segs
        .map((s, idx) => `${idx + 1}\n${formatSrtTime(s.start_ms, ',')} --> ${formatSrtTime(Math.max(s.end_ms, s.start_ms + 1000), ',')}\n${s.text.trim()}\n`)
        .join('\n');
    } else if (format === 'vtt') {
      content =
        'WEBVTT\n\n' +
        segs
          .map((s) => `${formatSrtTime(s.start_ms, '.')} --> ${formatSrtTime(Math.max(s.end_ms, s.start_ms + 1000), '.')}\n${s.text.trim()}\n`)
          .join('\n');
    } else if (format === 'md') {
      content = `# ${note.title.trim() || '無題のノート'}\n\n${note.summary ? `## 要約\n\n${note.summary}\n\n` : ''}## 文字起こし\n\n${segs
        .map((s) => `- **[${formatNoteTimer(s.start_ms)}]** ${s.text.trim()}`)
        .join('\n')}\n`;
    } else {
      content = segs.map((s) => `[${formatNoteTimer(s.start_ms)}] ${s.text.trim()}`).join('\n');
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`${format.toUpperCase()} でエクスポートしました`);
  };

  const dictionaryCandidates = useMemo(() => {
    const text = displayedSegments.map((s) => s.text).join(' ');
    if (!text.trim()) return [];
    const counts = new Map<string, number>();
    const matches = text.match(/[A-Za-z][A-Za-z0-9._-]{2,}|[ァ-ヶー]{3,}/g) || [];
    for (const token of matches) {
      if (dismissedCandidates[token]) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([term]) => term);
  }, [displayedSegments, dismissedCandidates]);

  const suggestedPresetId = useMemo(() => {
    const hay = `${note.title} ${displayedSegments.slice(0, 8).map((s) => s.text).join(' ')}`.toLowerCase();
    if (/1on1|1対1|面談|フィードバック/.test(hay)) {
      return summaryPresets.find((p) => /1on1|面談/i.test(p.id + p.name))?.id ?? null;
    }
    if (/商談|顧客|提案|見積|営業/.test(hay)) {
      return summaryPresets.find((p) => /sales|商談|営業/i.test(p.id + p.name))?.id ?? null;
    }
    if (/定例|週次|朝会|進捗/.test(hay)) {
      return summaryPresets.find((p) => /weekly|定例|標準/i.test(p.id + p.name))?.id ?? null;
    }
    return null;
  }, [note.title, displayedSegments, summaryPresets]);

  const searchMatches = useMemo(() => {
    if (!inNoteSearchQuery.trim()) return [];
    return findNoteSearchMatches(note, inNoteSearchQuery);
  }, [note, inNoteSearchQuery]);

  const jumpToSearchMatch = (delta: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const nextIdx = (searchMatchIdx + delta + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(nextIdx);
    setTimeout(() => {
      const marks = document.querySelectorAll('.note-editor-root mark, .note-transcript-list mark, .note-card mark');
      const targetMark = marks[nextIdx] as HTMLElement | undefined;
      targetMark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  };

  // Auto-scroll & unread dot when segments grow during recording
  const prevSegCountRef = useRef(displayedSegments.length);
  useEffect(() => {
    const count = displayedSegments.length;
    if (count > prevSegCountRef.current) {
      if (activeTab !== 'transcript' && phase === 'recording') {
        setHasUnreadTranscript(true);
      }
      if (isAtBottom && scrollRef.current) {
        const el = scrollRef.current;
        const reduced =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (typeof el.scrollTo === 'function') {
          el.scrollTo({
            top: el.scrollHeight,
            behavior: reduced ? 'auto' : 'smooth',
          });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      }
    }
    prevSegCountRef.current = count;
  }, [displayedSegments.length, activeTab, phase, isAtBottom]);

  // Auto-follow active transcript segment during audio playback
  useEffect(() => {
    if (!isPlaying || activeTab !== 'transcript' || !scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector('.note-turn.playing');
    if (activeEl && typeof (activeEl as HTMLElement).scrollIntoView === 'function') {
      (activeEl as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isPlaying, playbackMs, activeTab]);

  const highlightSearchText = (text: string) => {
    const q = inNoteSearchQuery.trim();
    if (!q) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark
          key={i}
          style={{
            backgroundColor: '#FEF08A',
            color: 'inherit',
            borderRadius: '3px',
            padding: '0 2px',
          }}
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setIsAtBottom(nearBottom);
  };

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setIsAtBottom(true);
  };

  const beginRecording = async () => {
    setIsPlaying(false);
    setLocalFallbackSegments([]);
    setLocalElapsedMs(0);
    setIsAtBottom(true);

    const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (onStartRecording && isTauriEnv) {
      await onStartRecording();
    } else if (onStartRecording) {
      await onStartRecording();
      if (!recordingStatus || recordingStatus.state === 'idle') {
        setLocalRecording(true);
      }
    } else {
      setLocalRecording(true);
    }
  };

  const stopRecording = async () => {
    setLocalRecording(false);
    setLocalRms(0);
    if (isExternalRecording && onStopRecording) {
      await onStopRecording();
      return;
    }

    const elapsedSec = Math.max(1, Math.round(localElapsedMs / 1000));
    setLocalProcessing(true);

    setTimeout(() => {
      const baseOffsetMs =
        note.segments.length > 0
          ? note.segments[note.segments.length - 1].end_ms + 1000
          : 0;
      const appended: TranscriptSegment[] =
        localFallbackSegments.length > 0
          ? localFallbackSegments
          : [
              {
                id: crypto.randomUUID(),
                start_ms: baseOffsetMs,
                end_ms: baseOffsetMs + Math.max(2000, elapsedSec * 1000),
                speaker: 'あなた',
                text: '本日の議題と次のアクションを確認しましょう。',
              },
            ];

      onUpdateNote({
        ...note,
        duration_sec: note.duration_sec + elapsedSec,
        segments: [...note.segments, ...appended],
        updated_at: new Date().toISOString(),
      });
      setLocalFallbackSegments([]);
      setLocalProcessing(false);
    }, 600);
  };

  const handleRecordButtonClick = () => {
    if (phase === 'recording') {
      void stopRecording();
    } else if (phase === 'completed' || phase === 'idle') {
      void beginRecording();
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, current: 'transcript' | 'summary' | 'memo') => {
    const order: ('transcript' | 'summary' | 'memo')[] = ['transcript', 'summary', 'memo'];
    const idx = order.indexOf(current);
    let next: 'transcript' | 'summary' | 'memo' | null = null;
    if (e.key === 'ArrowRight') next = order[(idx + 1) % order.length];
    else if (e.key === 'ArrowLeft') next = order[(idx + order.length - 1) % order.length];
    else if (e.key === 'Home') next = 'transcript';
    else if (e.key === 'End') next = 'memo';

    if (next) {
      e.preventDefault();
      setActiveTab(next);
      if (next === 'transcript') {
        setHasUnreadTranscript(false);
        transcriptTabRef.current?.focus();
      } else if (next === 'summary') {
        summaryTabRef.current?.focus();
      } else {
        memoTabRef.current?.focus();
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = titleDraft.trim();
      titleSnapshotRef.current = trimmed;
      onUpdateNote({ ...note, title: trimmed, updated_at: new Date().toISOString() });
      titleInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      skipTitleBlurSaveRef.current = true;
      setTitleDraft(titleSnapshotRef.current);
      onUpdateNote({ ...note, title: titleSnapshotRef.current });
      titleInputRef.current?.blur();
    }
  };

  const appendToSession = (scopeKey: string, userText: string, assistantText?: string) => {
    const now = new Date().toISOString();
    const existingId = lastSessionByScope[scopeKey];
    const existing = chatSessions.find((s) => s.id === existingId);
    if (existing) {
      const next = chatSessions.map((s) => {
        if (s.id !== existing.id) return s;
        const nextMsgs = [...s.messages];
        if (userText) {
          nextMsgs.push({ role: 'user', text: userText, createdAt: now });
        }
        if (assistantText !== undefined) {
          nextMsgs.push({ role: 'assistant', text: assistantText, createdAt: now });
        }
        return { ...s, updatedAt: now, messages: nextMsgs };
      });
      setChatSessions(next);
      persistPopupSessions(next);
      return existing.id;
    } else {
      const newId = crypto.randomUUID();
      const newSession: PopupChatSession = {
        id: newId,
        scopeKey,
        title: userText.slice(0, 28) || '新しいチャット',
        updatedAt: now,
        messages: userText ? [{ role: 'user', text: userText, createdAt: now }] : [],
      };
      const next = [newSession, ...chatSessions];
      setChatSessions(next);
      persistPopupSessions(next);
      setLastSessionByScope((prev) => ({ ...prev, [scopeKey]: newId }));
      return newId;
    }
  };

  const handleCitationNavigate = async (c: ChatCitation) => {
    const ok = await confirmActionDialog(
      `「${c.note_title}」に移動しますか？`,
      c.excerpt ? `該当箇所 [${c.timestamp}]: ${c.excerpt}` : `該当箇所: ${c.timestamp}`,
      'ノートを開く'
    );
    if (ok) {
      setViewingFolderId(null);
      onSelectNote?.(c.note_id);
    }
  };

  const handleAskQuestion = async () => {
    const q = question.trim();
    const targetNoteId = note.id;
    const scopeKey = `note:${targetNoteId}`;
    if (!q || askingByNote[targetNoteId]) return;
    setChatPopupOpen(true);
    setChatHistoryOpen(false);
    const sid = appendToSession(scopeKey, q);
    setQuestion('');
    setStreamingChatText('');
    setAskingByNote((prev) => ({ ...prev, [targetNoteId]: true }));
    setAiErrorByNote((prev) => ({ ...prev, [targetNoteId]: null }));
    try {
      const ids = chatScope === 'note' ? [targetNoteId] : [];
      const res = await (onChatNote as (noteIds: string[], question: string, spaceId?: string | null) => Promise<ChatAnswer>)(
        ids,
        q,
        chatScope === 'space' ? note.folder_id : null
      );
      const now = new Date().toISOString();
      setChatSessions((prev) => {
        const next: PopupChatSession[] = prev.map((s) =>
          s.id === sid
            ? {
                ...s,
                updatedAt: now,
                messages: [
                  ...s.messages,
                  {
                    role: 'assistant' as const,
                    text: res.answer,
                    citations: res.citations,
                    actions: res.actions,
                    thinking: res.thinking,
                    createdAt: now,
                  },
                ],
              }
            : s
        );
        persistPopupSessions(next);
        return next;
      });
    } catch (err) {
      setAiErrorByNote((prev) => ({ ...prev, [targetNoteId]: String(err) }));
    } finally {
      setAskingByNote((prev) => ({ ...prev, [targetNoteId]: false }));
      setStreamingChatText('');
    }
  };

  const renderChatPopup = (scopeKey: string, busy: boolean, isSpacePage = false) => (
    <NoteChatPopup
      open={chatPopupOpen}
      scopeKey={scopeKey}
      busy={busy}
      isSpacePage={isSpacePage}
      chatScope={chatScope}
      onChangeChatScope={setChatScope}
      chatHistoryOpen={chatHistoryOpen}
      onToggleHistory={() => setChatHistoryOpen((v) => !v)}
      onClose={() => {
        setChatPopupOpen(false);
        setChatHistoryOpen(false);
      }}
      chatSessions={chatSessions}
      chatHistory={chatHistory}
      lastSessionByScope={lastSessionByScope}
      onSelectSession={(key, sid) => {
        setLastSessionByScope((prev) => ({ ...prev, [key]: sid }));
        setChatHistoryOpen(false);
      }}
      onNewChat={(key) => {
        setLastSessionByScope((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setChatHistoryOpen(false);
      }}
      streamingChatText={streamingChatText}
      errorText={isSpacePage ? spaceChatError : aiError}
      scrollRef={chatMessagesScrollRef}
      onCitationClick={(c) => void handleCitationNavigate(c)}
    />
  );

  const handleQuestionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAskQuestion();
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      const text = formatNoteForCopy(note, settings.copy_format || 'markdown');
      await onCopyText(text, 'ノート');
      notify('Markdown形式でコピーしました');
      setShareOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyFormat = async (fmt: 'markdown' | 'slack' | 'line', label: string) => {
    try {
      const text = formatNoteForCopy(note, fmt);
      await onCopyText(text, label);
      notify(`${label}をコピーしました`);
      setShareOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirmNotionSave = async () => {
    setNotionBusy(true);
    try {
      await onSaveToNotion(note.id);
      setNotionPreviewOpen(false);
      setShareOpen(false);
      notify('Notion に保存しました');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setNotionBusy(false);
    }
  };

  const activeFolder =
    folders.find((f) => f.id === note.folder_id) ||
    folders[0] || { id: 'personal', name: '個人', is_shared: false, permission: 'owner' as const };
  const folderDisplayName =
    activeFolder.id === 'personal' ? '個人' : activeFolder.name;

  // Smart Category Suggestion ("もしかして：授業" etc.)
  const suggestedCategory = useMemo((): { id: string | null; name: string } | null => {
    if (dismissedSuggestByNote[note.id]) return null;
    const textHaystack = [
      note.title,
      note.summary,
      note.manual_notes.replace(/<[^>]*>/g, ' '),
      ...note.segments.map((s) => s.text),
    ]
      .join(' ')
      .toLowerCase();
    if (textHaystack.trim().length < 3) return null;

    const domainKeywords: Record<string, string[]> = {
      授業: ['授業', '講義', '教授', '先生', '単位', '課題', 'レポート', 'シラバス', '試験', 'テスト', '学期', '科目', '宿題', 'ゼミ'],
      講義: ['講義', '授業', '教授', '単位', 'シラバス', 'レポート', '試験'],
      会議: ['会議', '定例', '議題', '進捗', 'クライアント', '納期', '仕様', 'リリース', 'ミーティング', '打ち合わせ', 'タスク'],
      研究: ['研究', '論文', '実験', 'データ', '仮説', '学会', '考察'],
      面接: ['面接', '採用', '志望動機', '自己pr', '選考', 'キャリア'],
    };

    let bestFolder: Folder | null = null;
    let bestScore = 0;

    for (const f of folders) {
      if (f.id === note.folder_id || f.id === 'personal') continue;
      const fNameLower = f.name.toLowerCase();
      let score = 0;
      if (fNameLower.length >= 2 && textHaystack.includes(fNameLower)) {
        score += 3;
      }
      for (const [domain, kwList] of Object.entries(domainKeywords)) {
        if (f.name.includes(domain)) {
          for (const kw of kwList) {
            if (textHaystack.includes(kw)) score += 2;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestFolder = f;
      }
    }

    if (bestFolder && bestScore >= 2) {
      return { id: bestFolder.id, name: bestFolder.name };
    }

    // Also suggest creating/moving to "授業" or "会議" if note is still in 'personal' and clearly matches
    if (note.folder_id === 'personal') {
      const lectureHits = domainKeywords['授業'].filter((kw) => textHaystack.includes(kw)).length;
      if (lectureHits >= 1) {
        const existing = folders.find((f) => f.name.includes('授業') || f.name.includes('講義'));
        return existing ? { id: existing.id, name: existing.name } : { id: null, name: '授業' };
      }
      const meetingHits = domainKeywords['会議'].filter((kw) => textHaystack.includes(kw)).length;
      if (meetingHits >= 2) {
        const existing = folders.find((f) => f.name.includes('会議'));
        if (existing && existing.id !== note.folder_id) {
          return { id: existing.id, name: existing.name };
        }
      }
    }
    return null;
  }, [note, folders, dismissedSuggestByNote]);

  const handleApplySuggestedCategory = async () => {
    if (!suggestedCategory) return;
    setDismissedSuggestByNote((prev) => ({ ...prev, [note.id]: true }));
    if (suggestedCategory.id) {
      onUpdateNote({
        ...note,
        folder_id: suggestedCategory.id,
        updated_at: new Date().toISOString(),
      });
      notify(`「${suggestedCategory.name}」に移動しました`);
    } else if (onSaveFolder) {
      const created: Folder = {
        id: crypto.randomUUID(),
        name: suggestedCategory.name,
        is_shared: false,
        permission: 'owner',
      };
      await onSaveFolder(created);
      onUpdateNote({
        ...note,
        folder_id: created.id,
        updated_at: new Date().toISOString(),
      });
      notify(`「${created.name}」を作成して移動しました`);
    }
  };

  const llmConfigured = settings.llm_provider !== 'none' && settings.llm_provider !== '';
  const notionReady = Boolean(secretStatus?.notion_access_token) && Boolean(settings.notion_target_id);
  const timerMs = isExternalRecording
    ? recordingStatus?.elapsed_ms ?? 0
    : localRecording
      ? localElapsedMs
      : phase === 'completed'
        ? totalDurationMs
        : 0;
  const playbackProgress =
    phase === 'completed' && totalDurationMs > 0
      ? Math.min(1, playbackMs / totalDurationMs)
      : 0;

  const activeSegId = useMemo(() => {
    if (!isPlaying) return null;
    return (
      displayedSegments.find(
        (s) => playbackMs >= s.start_ms && playbackMs < s.end_ms
      )?.id ?? null
    );
  }, [isPlaying, playbackMs, displayedSegments]);

  return (
    <div className="note-shell">
      {/* Mobile drawer backdrop */}
      <div
        className={`note-sidebar-backdrop ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar (272px): Parent Folder (Space) -> Child File (Note) Tree */}
      <aside
        className={`note-sidebar ${drawerOpen ? 'drawer-open' : ''}`}
        aria-label="スペース"
      >
        <div className="note-sidebar-heading">
          <FolderIcon size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="note-sidebar-heading-text">スペースとノート</span>
        </div>

        <nav className="note-sidebar-list" aria-label="スペース一覧">
          {folders.map((f) => {
            const childNotes = notesList.filter((n) => n.folder_id === f.id);
            const isExpanded = expandedFolders[f.id] ?? true;
            const isFolderActive = viewingFolderId === f.id;
            return (
              <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div
                  className={`note-sidebar-item ${isFolderActive ? 'selected' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '8px' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedFolders((prev) => ({
                        ...prev,
                        [f.id]: viewingFolderId === f.id ? !(prev[f.id] ?? true) : true,
                      }));
                      setViewingFolderId(f.id);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      fontWeight: 600,
                    }}
                    title={`${f.name}（スペースを開く）`}
                  >
                    <ChevronDown
                      size={14}
                      strokeWidth={1.75}
                      style={{
                        transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform 150ms ease',
                        flexShrink: 0,
                      }}
                    />
                    <FolderIcon size={16} strokeWidth={1.75} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span className="note-sidebar-item-label">{f.name}</span>
                    <span className="text-muted mono-num" style={{ marginLeft: 'auto' }}>
                      {childNotes.length}
                    </span>
                  </button>
                  {onCreateNoteInFolder && (
                    <button
                      type="button"
                      aria-label={`${f.name}に新規ノートを作成`}
                      title={`${f.name}に新規ノートを作成`}
                      className="btn btn-ghost"
                      style={{ width: '24px', height: '24px', padding: 0, flexShrink: 0 }}
                      onClick={() => {
                        setViewingFolderId(null);
                        onCreateNoteInFolder(f.id);
                        setDrawerOpen(false);
                      }}
                    >
                      <Plus size={14} strokeWidth={1.75} />
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '20px' }}>
                    {childNotes.length === 0 ? (
                      <div style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        ノートなし
                      </div>
                    ) : (
                      childNotes.map((cn) => {
                        const isCurrentNote = !viewingFolderId && cn.id === note.id;
                        const isChildRecording =
                          recordingNoteId === cn.id || (cn.id === note.id && isRecording);
                        return (
                          <button
                            key={cn.id}
                            type="button"
                            className={`note-sidebar-item ${isCurrentNote ? 'selected' : ''}`}
                            style={{ height: '32px', padding: '0 8px' }}
                            onClick={() => {
                              setViewingFolderId(null);
                              onSelectNote?.(cn.id);
                              setDrawerOpen(false);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setNoteContextMenu({ noteId: cn.id, x: e.clientX, y: e.clientY });
                            }}
                            title={cn.title.trim() || '無題のノート'}
                          >
                            <FileText size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                            <span className="note-sidebar-item-label" style={{ fontSize: '12px' }}>
                              {cn.title.trim() || '無題のノート'}
                            </span>
                            {isChildRecording && (
                              <span
                                title="録音中"
                                aria-label="録音中"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  marginLeft: 'auto',
                                  flexShrink: 0,
                                  color: 'var(--danger)',
                                }}
                              >
                                <Loader2 size={14} strokeWidth={2} className="spin" />
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {onSaveFolder && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newSpaceName.trim()) return;
              const newFolder: Folder = {
                id: crypto.randomUUID(),
                name: newSpaceName.trim(),
                is_shared: false,
                permission: 'owner',
              };
              await onSaveFolder(newFolder);
              setExpandedFolders((prev) => ({ ...prev, [newFolder.id]: true }));
              setViewingFolderId(newFolder.id);
              setNewSpaceName('');
            }}
            style={{ display: 'flex', gap: '8px', padding: '8px 4px' }}
          >
            <input
              type="text"
              className="input"
              style={{ height: '32px' }}
              placeholder="スペースを追加"
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" style={{ height: '32px', padding: '0 8px' }} disabled={!newSpaceName.trim()}>
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </form>
        )}
      </aside>

      {/* Main Content */}
      <div className="note-main">
        {/* Mobile Drawer Trigger */}
        <div className="note-mobile-bar">
          <button
            type="button"
            className="note-meta-pill"
            aria-label="サイドバーを開く"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Polite status announcer */}
        <div className="sr-only" aria-live="polite">
          {liveAnnouncement}
        </div>

        {viewingFolderId ? (
          (() => {
            const targetFolder =
              folders.find((f) => f.id === viewingFolderId) || activeFolder;
            const folderNotesRaw = notesList.filter((n) => n.folder_id === targetFolder.id);
            const q = spaceSearchQuery.trim().toLowerCase();
            const folderNotes = folderNotesRaw
              .filter((fn) => {
                if (!q) return true;
                const hay = [
                  fn.title,
                  fn.summary,
                  fn.manual_notes,
                  ...fn.segments.map((s) => s.text),
                ]
                  .join(' ')
                  .toLowerCase();
                return hay.includes(q);
              })
              .sort((a, b) => {
                if (spaceSortOrder === 'oldest') {
                  return a.created_at.localeCompare(b.created_at);
                }
                if (spaceSortOrder === 'title') {
                  return (a.title.trim() || '無題のノート').localeCompare(
                    b.title.trim() || '無題のノート',
                    'ja'
                  );
                }
                return b.created_at.localeCompare(a.created_at);
              });
            const otherFolders = folders.filter((f) => f.id !== targetFolder.id);
            const effectiveMoveTargetId =
              bulkMoveTargetId && otherFolders.some((f) => f.id === bulkMoveTargetId)
                ? bulkMoveTargetId
                : otherFolders[0]?.id || '';
            const effectiveMergeTargetId =
              mergeTargetId && otherFolders.some((f) => f.id === mergeTargetId)
                ? mergeTargetId
                : otherFolders[0]?.id || '';
            const allSelected =
              folderNotes.length > 0 && folderNotes.every((fn) => selectedNoteIds.includes(fn.id));

            const handleSpaceAsk = async () => {
              const prompt = spaceChatQuestion.trim();
              const scopeKey = `space:${targetFolder.id}`;
              if (!prompt || spaceChatBusy) return;
              setChatPopupOpen(true);
              setChatHistoryOpen(false);
              const sid = appendToSession(scopeKey, prompt);
              setSpaceChatQuestion('');
              setSpaceChatBusy(true);
              setSpaceChatError(null);
              try {
                const targetIds = folderNotesRaw.map((n) => n.id);
                const res = await (
                  onChatNote as (
                    noteIds: string[],
                    question: string,
                    spaceId?: string | null
                  ) => Promise<ChatAnswer>
                )(targetIds, prompt, targetFolder.id);
                const now = new Date().toISOString();
                setChatSessions((prev) => {
                  const next: PopupChatSession[] = prev.map((s) =>
                    s.id === sid
                      ? {
                          ...s,
                          updatedAt: now,
                          messages: [
                            ...s.messages,
                            { role: 'assistant' as const, text: res.answer, citations: res.citations, actions: res.actions, createdAt: now },
                          ],
                        }
                      : s
                  );
                  persistPopupSessions(next);
                  return next;
                });
              } catch (err) {
                setSpaceChatError(err instanceof Error ? err.message : String(err));
              } finally {
                setSpaceChatBusy(false);
              }
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div className="note-space-container" style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <FolderIcon size={20} strokeWidth={1.75} />
                      {editingSpaceName && onSaveFolder ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!spaceNameDraft.trim()) return;
                            await onSaveFolder({ ...targetFolder, name: spaceNameDraft.trim() });
                            setEditingSpaceName(false);
                            notify('スペース名を変更しました');
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="text"
                            className="input"
                            style={{ height: '32px', width: 'min(200px, 100%)' }}
                            value={spaceNameDraft}
                            onChange={(e) => setSpaceNameDraft(e.target.value)}
                            autoFocus
                          />
                          <button type="submit" className="btn btn-primary" style={{ height: '32px' }}>
                            保存
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ height: '32px' }}
                            onClick={() => setEditingSpaceName(false)}
                          >
                            キャンセル
                          </button>
                        </form>
                      ) : (
                        <>
                          <h2 className="page-title">{targetFolder.name}</h2>
                          {onSaveFolder && (
                            <button
                              type="button"
                              aria-label="スペース名を変更"
                              title="スペース名を変更"
                              className="btn btn-ghost"
                              style={{ width: '28px', height: '28px', padding: 0 }}
                              onClick={() => {
                                setSpaceNameDraft(targetFolder.name);
                                setEditingSpaceName(true);
                              }}
                            >
                              <Pencil size={14} strokeWidth={1.5} />
                            </button>
                          )}
                        </>
                      )}
                      <span className="status-chip">{folderNotesRaw.length} 件のノート</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {otherFolders.length > 0 && onDeleteFolder && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setMergeOpen((v) => !v)}
                        >
                          <GitMerge size={14} strokeWidth={1.75} />
                          スペースを結合
                        </button>
                      )}
                      {onCreateNoteInFolder && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            setViewingFolderId(null);
                            onCreateNoteInFolder(targetFolder.id);
                          }}
                        >
                          <Plus size={14} strokeWidth={1.75} />
                          新規ノート
                        </button>
                      )}
                      {onDeleteFolder && targetFolder.id !== 'personal' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={async () => {
                            const ok = await confirmDeleteDialog(
                              `スペース「${targetFolder.name}」を削除しますか？`,
                              'スペース内のノートは「一般」スペースへ移動されます。'
                            );
                            if (!ok) return;
                            await onDeleteFolder(targetFolder.id);
                            setViewingFolderId(null);
                          }}
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                          スペースを削除
                        </button>
                      )}
                    </div>
                  </div>

                  {mergeOpen && otherFolders.length > 0 && onDeleteFolder && (
                    <div
                      className="surface-subtle"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>
                          {targetFolder.id === 'personal'
                            ? 'このスペースに取り込むスペース:'
                            : '結合先のスペース:'}
                        </span>
                        <select
                          aria-label="結合先スペース"
                          className="input"
                          style={{ width: '180px', height: '32px', lineHeight: '1.2' }}
                          value={effectiveMergeTargetId}
                          onChange={(e) => setMergeTargetId(e.target.value)}
                        >
                          {otherFolders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ height: '32px' }}
                          onClick={async () => {
                            if (!effectiveMergeTargetId) return;
                            const keepId =
                              targetFolder.id === 'personal' ? targetFolder.id : effectiveMergeTargetId;
                            const dropId =
                              targetFolder.id === 'personal' ? effectiveMergeTargetId : targetFolder.id;
                            const movingNotes = notesList.filter((n) => n.folder_id === dropId);
                            for (const mn of movingNotes) {
                              await onUpdateNote({
                                ...mn,
                                folder_id: keepId,
                                updated_at: new Date().toISOString(),
                              });
                            }
                            await onDeleteFolder(dropId);
                            setMergeOpen(false);
                            setViewingFolderId(keepId);
                            notify('スペースを結合しました');
                          }}
                        >
                          結合を実行
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ height: '32px' }}
                          onClick={() => setMergeOpen(false)}
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Search, Sort & Bulk Select Toolbar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                      <Search
                        size={14}
                        strokeWidth={1.5}
                        style={{
                          position: 'absolute',
                          left: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--text-muted)',
                        }}
                      />
                      <input
                        type="text"
                        className="input"
                        style={{ height: '36px', paddingLeft: '36px' }}
                        placeholder="このスペース内を検索..."
                        value={spaceSearchQuery}
                        onChange={(e) => setSpaceSearchQuery(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="並び替え"
                      className="input"
                      style={{ width: '132px', height: '36px', lineHeight: '1.2' }}
                      value={spaceSortOrder}
                      onChange={(e) =>
                        setSpaceSortOrder(e.target.value as 'newest' | 'oldest' | 'title')
                      }
                    >
                      <option value="newest">新しい順</option>
                      <option value="oldest">古い順</option>
                      <option value="title">タイトル順</option>
                    </select>
                    <button
                      type="button"
                      className={`btn ${spaceSelectMode ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ height: '36px' }}
                      onClick={() => {
                        setSpaceSelectMode((v) => !v);
                        setSelectedNoteIds([]);
                      }}
                    >
                      {spaceSelectMode ? '選択終了' : '複数選択'}
                    </button>
                  </div>

                  {spaceSelectMode && (
                    <div
                      className="surface-subtle"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ height: '32px' }}
                          onClick={() => {
                            if (allSelected) {
                              setSelectedNoteIds([]);
                            } else {
                              setSelectedNoteIds(folderNotes.map((fn) => fn.id));
                            }
                          }}
                        >
                          {allSelected ? 'すべて解除' : 'すべて選択'}
                        </button>
                        <span className="text-muted" style={{ fontSize: '12px' }}>
                          {selectedNoteIds.length} 件選択中
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {otherFolders.length > 0 && (
                          <>
                            <select
                              aria-label="一括移動先のスペース"
                              className="input"
                              style={{ width: '150px', height: '32px', lineHeight: '1.2' }}
                              value={effectiveMoveTargetId}
                              onChange={(e) => setBulkMoveTargetId(e.target.value)}
                            >
                              {otherFolders.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ height: '32px' }}
                              disabled={selectedNoteIds.length === 0 || !effectiveMoveTargetId}
                              onClick={async () => {
                                const targets = notesList.filter((n) => selectedNoteIds.includes(n.id));
                                for (const t of targets) {
                                  await onUpdateNote({
                                    ...t,
                                    folder_id: effectiveMoveTargetId,
                                    updated_at: new Date().toISOString(),
                                  });
                                }
                                setSelectedNoteIds([]);
                                setSpaceSelectMode(false);
                                notify(`${targets.length} 件を移動しました`);
                              }}
                            >
                              スペース移動
                            </button>
                          </>
                        )}
                        {onDeleteNote && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ height: '32px' }}
                            disabled={selectedNoteIds.length === 0}
                            onClick={async () => {
                              const ids = [...selectedNoteIds];
                              const ok = await confirmDeleteDialog(
                                `${ids.length} 件のノートを削除しますか？`,
                                '選択したノートをすべて削除します。この操作は取り消せません。'
                              );
                              if (!ok) return;
                              for (const id of ids) {
                                await onDeleteNote(id);
                              }
                              setSelectedNoteIds([]);
                              setSpaceSelectMode(false);
                              notify(`${ids.length} 件を削除しました`);
                            }}
                          >
                            <Trash2 size={14} strokeWidth={1.5} />
                            一括削除
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {folderNotes.length === 0 ? (
                    <div style={{ padding: '24px 0', borderTop: '1px solid var(--border-subtle)' }}>
                      <p className="text-secondary" style={{ margin: '0px' }}>
                        {spaceSearchQuery.trim()
                          ? '検索条件に一致するノートがありません。'
                          : 'このスペースにはまだノートがありません。'}
                      </p>
                    </div>
                  ) : (
                    <div className="flat-list">
                      {folderNotes.map((fn) => {
                        const isFnRecording =
                          recordingNoteId === fn.id || (fn.id === note.id && isRecording);
                        const fnTitle = fn.title.trim() || '無題のノート';
                        const isChecked = selectedNoteIds.includes(fn.id);
                        return (
                          <div
                            key={fn.id}
                            className="flat-row"
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setNoteContextMenu({ noteId: fn.id, x: e.clientX, y: e.clientY });
                            }}
                          >
                            {spaceSelectMode && (
                              <input
                                type="checkbox"
                                aria-label={`${fnTitle}を選択`}
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedNoteIds((prev) => [...prev, fn.id]);
                                  } else {
                                    setSelectedNoteIds((prev) => prev.filter((id) => id !== fn.id));
                                  }
                                }}
                                style={{ width: '16px', height: '16px', flexShrink: 0, cursor: 'pointer' }}
                              />
                            )}
                            <button
                              type="button"
                              style={{
                                flex: 1,
                                minWidth: 0,
                                textAlign: 'left',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                              }}
                              onClick={() => {
                                if (spaceSelectMode) {
                                  setSelectedNoteIds((prev) =>
                                    prev.includes(fn.id)
                                      ? prev.filter((id) => id !== fn.id)
                                      : [...prev, fn.id]
                                  );
                                } else {
                                  setViewingFolderId(null);
                                  onSelectNote?.(fn.id);
                                }
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <FileText size={15} strokeWidth={1.75} />
                                <strong style={{ fontWeight: 600 }}>{fnTitle}</strong>
                                {isFnRecording && (
                                  <span className="status-chip danger" style={{ gap: '4px' }}>
                                    <Loader2 size={12} strokeWidth={2} className="spin" />
                                    録音中
                                  </span>
                                )}
                              </div>
                              <span className="text-muted mono-num">
                                {formatDateTime(fn.created_at)} ・ {fn.segments.length} セグメント
                              </span>
                              {spaceSearchQuery.trim() && (() => {
                                const matches = findNoteSearchMatches(fn, spaceSearchQuery);
                                if (matches.length === 0) return null;
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
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
                                );
                              })()}
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                              <NotionSyncBadge status={fn.notion_sync.status} pageUrl={fn.notion_sync.page_url} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Space Bottom Question Bar (matching Note page composer design) */}
                <div className="note-composer-wrap">
                  <div ref={composerUnifiedRef} className="note-composer-unified">
                    {renderChatPopup(`space:${targetFolder.id}`, spaceChatBusy, true)}
                    <div className={`note-composer-box ${chatPopupOpen ? 'popup-open' : ''}`}>
                      <textarea
                        aria-label={`${targetFolder.name}について何でも質問`}
                        className="note-composer-input"
                        rows={1}
                        placeholder={`${targetFolder.name}について何でも質問`}
                        value={spaceChatQuestion}
                        onClick={() => setChatPopupOpen(true)}
                        onFocus={() => setChatPopupOpen(true)}
                        onChange={(e) => setSpaceChatQuestion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSpaceAsk();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="note-send-btn"
                        aria-label="質問を送信"
                        disabled={!spaceChatQuestion.trim() || spaceChatBusy}
                        onClick={() => void handleSpaceAsk()}
                      >
                        <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <>
        {/* Header */}
        <header className="note-header">
          <input
            ref={titleInputRef}
            type="text"
            aria-label="ノートタイトル"
            className="note-title-input"
            value={titleDraft}
            placeholder="無題のノート"
            onFocus={() => {
              titleSnapshotRef.current = titleDraft;
            }}
            onChange={(e) => {
              setTitleDraft(e.target.value);
              onUpdateNote({
                ...note,
                title: e.target.value,
                updated_at: new Date().toISOString(),
              });
            }}
            onBlur={() => {
              if (skipTitleBlurSaveRef.current) {
                skipTitleBlurSaveRef.current = false;
                return;
              }
              const trimmed = titleDraft.trim();
              titleSnapshotRef.current = trimmed;
              if (trimmed !== note.title) {
                onUpdateNote({
                  ...note,
                  title: trimmed,
                  updated_at: new Date().toISOString(),
                });
              }
            }}
            onKeyDown={handleTitleKeyDown}
          />

          {/* Metadata Pills */}
          <div className="note-meta-pills">
            <label
              className="note-meta-pill"
              style={{ cursor: 'pointer', position: 'relative' }}
              title="日付を変更"
              onClick={() => {
                (dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null)?.showPicker?.();
              }}
            >
              <Calendar size={15} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
              <span>{note.created_at ? note.created_at.slice(0, 10).replace(/-/g, '/') : '日付を選択'}</span>
              <input
                ref={dateInputRef}
                type="date"
                className="note-date-input"
                aria-label="ノートの日付"
                style={{
                  position: 'absolute',
                  opacity: 0,
                  width: '1px',
                  height: '1px',
                  pointerEvents: 'none',
                }}
                value={note.created_at ? note.created_at.slice(0, 10) : ''}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const timePart = note.created_at.slice(10) || 'T00:00:00.000Z';
                  onUpdateNote({
                    ...note,
                    created_at: `${e.target.value}${timePart}`,
                    updated_at: new Date().toISOString(),
                  });
                }}
              />
            </label>

            <div className="note-meta-pill-wrap">
              <button
                type="button"
                className="note-meta-pill"
                aria-expanded={folderMenuOpen}
                onClick={() => {
                  setFolderMenuOpen((o) => !o);
                }}
              >
                <FolderIcon size={15} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
                <span>{folderDisplayName}</span>
              </button>

              {folderMenuOpen && folders.length > 0 && (
                <div className="note-popover" role="menu" aria-label="フォルダ選択" style={{ minWidth: '210px' }}>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`note-sidebar-item ${f.id === note.folder_id ? 'selected' : ''}`}
                      onClick={() => {
                        onUpdateNote({
                          ...note,
                          folder_id: f.id,
                          updated_at: new Date().toISOString(),
                        });
                        setFolderMenuOpen(false);
                      }}
                    >
                      <FolderIcon size={15} strokeWidth={1.75} />
                      <span>{f.id === 'personal' ? '個人' : f.name}</span>
                    </button>
                  ))}
                  {onSaveFolder && (
                    <div
                      style={{
                        display: 'flex',
                        gap: '4px',
                        padding: '8px 8px 4px',
                        marginTop: '4px',
                        borderTop: '1px solid var(--ns-border-sidebar)',
                      }}
                    >
                      <input
                        type="text"
                        className="input"
                        style={{ height: '28px', fontSize: '12px', flex: 1, minWidth: 0 }}
                        placeholder="新しいスペース名"
                        value={dropdownNewSpaceName}
                        onChange={(e) => setDropdownNewSpaceName(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && dropdownNewSpaceName.trim()) {
                            e.preventDefault();
                            const created: Folder = {
                              id: crypto.randomUUID(),
                              name: dropdownNewSpaceName.trim(),
                              is_shared: false,
                              permission: 'owner',
                            };
                            await onSaveFolder(created);
                            onUpdateNote({
                              ...note,
                              folder_id: created.id,
                              updated_at: new Date().toISOString(),
                            });
                            setDropdownNewSpaceName('');
                            setFolderMenuOpen(false);
                            notify(`スペース「${created.name}」を作成しました`);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ height: '28px', padding: '0 8px', fontSize: '12px' }}
                        disabled={!dropdownNewSpaceName.trim()}
                        onClick={async () => {
                          if (!dropdownNewSpaceName.trim()) return;
                          const created: Folder = {
                            id: crypto.randomUUID(),
                            name: dropdownNewSpaceName.trim(),
                            is_shared: false,
                            permission: 'owner',
                          };
                          await onSaveFolder(created);
                          onUpdateNote({
                            ...note,
                            folder_id: created.id,
                            updated_at: new Date().toISOString(),
                          });
                          setDropdownNewSpaceName('');
                          setFolderMenuOpen(false);
                          notify(`スペース「${created.name}」を作成しました`);
                        }}
                      >
                        <Plus size={12} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pin Toggle Pill */}
            <button
              type="button"
              className="note-meta-pill"
              aria-pressed={Boolean(note.pinned)}
              title={note.pinned ? 'ピン留め解除' : 'ノートをピン留め'}
              style={{
                borderColor: note.pinned ? 'var(--accent)' : undefined,
                color: note.pinned ? 'var(--accent)' : undefined,
              }}
              onClick={() =>
                onUpdateNote({
                  ...note,
                  pinned: !note.pinned,
                  updated_at: new Date().toISOString(),
                })
              }
            >
              <Pin size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>{note.pinned ? 'ピン留め中' : 'ピン留め'}</span>
            </button>

            {/* Tags Pill */}
            {(note.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="note-meta-pill"
                style={{ gap: '4px', paddingRight: '8px' }}
              >
                <Tag size={12} strokeWidth={1.75} aria-hidden="true" />
                <span>#{tag}</span>
                <button
                  type="button"
                  aria-label={`タグ ${tag} を削除`}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', color: 'inherit' }}
                  onClick={() =>
                    onUpdateNote({
                      ...note,
                      tags: (note.tags ?? []).filter((t) => t !== tag),
                      updated_at: new Date().toISOString(),
                    })
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {tagInputOpen ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = tagDraft.trim().replace(/^#/, '');
                  if (clean && !(note.tags ?? []).includes(clean)) {
                    onUpdateNote({
                      ...note,
                      tags: [...(note.tags ?? []), clean],
                      updated_at: new Date().toISOString(),
                    });
                  }
                  setTagDraft('');
                  setTagInputOpen(false);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <input
                  type="text"
                  className="input"
                  autoFocus
                  placeholder="タグ名..."
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onBlur={() => setTagInputOpen(false)}
                  style={{ width: '100px', height: '28px', fontSize: '12px', padding: '0 8px' }}
                />
              </form>
            ) : (
              <button
                type="button"
                className="note-meta-pill"
                title="タグを追加"
                onClick={() => setTagInputOpen(true)}
              >
                <Tag size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>+ タグ</span>
              </button>
            )}

            {/* Calendar Event Linking Pill */}
            <div className="note-meta-pill-wrap">
              <button
                type="button"
                className="note-meta-pill"
                style={{ padding: '0 12px' }}
                title="カレンダー予定からタイトル・参加者を設定"
                aria-expanded={calendarMenuOpen}
                onClick={async () => {
                  const nextOpen = !calendarMenuOpen;
                  setCalendarMenuOpen(nextOpen);
                  if (nextOpen) {
                    if (isTauriRuntime()) {
                      try {
                        const evs = await apiGetUpcomingCalendarEvents();
                        setCalendarEvents(evs);
                      } catch {
                        setCalendarEvents([]);
                      }
                    } else {
                      setCalendarEvents([]);
                    }
                  }
                }}
              >
                <Calendar size={14} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
                <span>予定紐付け</span>
              </button>

              {calendarMenuOpen && (
                <div
                  className="note-popover"
                  role="menu"
                  aria-label="カレンダー予定を選択"
                  style={{ minWidth: '256px' }}
                >
                  <div style={{ padding: '4px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--ns-text-muted)' }}>
                    現在の会議・予定から自動セット
                  </div>
                  {calendarEvents.length === 0 ? (
                    <div className="text-muted" style={{ padding: '8px', fontSize: '12px' }}>
                      表示できる予定はありません（連携設定から ICS URL を登録できます）
                    </div>
                  ) : (
                    calendarEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        className="note-sidebar-item"
                        style={{ height: 'auto', padding: '8px', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}
                        onClick={() => {
                          setTitleDraft(ev.title);
                          titleSnapshotRef.current = ev.title;
                          onUpdateNote({
                            ...note,
                            title: ev.title,
                            participants: Array.from(new Set([...note.participants, ...ev.participants])),
                            updated_at: new Date().toISOString(),
                          });
                          setCalendarMenuOpen(false);
                          notify(`予定「${ev.title}」を紐付けました`);
                        }}
                      >
                        <strong style={{ fontSize: '12px', fontWeight: 600 }}>{ev.title}</strong>
                        <span className="text-muted mono-num" style={{ fontSize: '11px' }}>
                          {ev.start_time} - {ev.end_time} ・ {ev.provider}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {suggestedCategory && (
              <div className="category-suggest-pill" role="status">
                <button
                  type="button"
                  onClick={handleApplySuggestedCategory}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}
                >
                  <Sparkles size={13} strokeWidth={1.75} />
                  <span>もしかして：{suggestedCategory.name}</span>
                </button>
                <button
                  type="button"
                  aria-label="カテゴリ提案を閉じる"
                  onClick={() =>
                    setDismissedSuggestByNote((prev) => ({ ...prev, [note.id]: true }))
                  }
                  style={{ display: 'inline-flex', padding: 0, color: 'var(--text-muted)' }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {inNoteSearchOpen && (
            <div
              role="search"
              aria-label="ページ内検索"
              style={{
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
                maxWidth: '420px',
              }}
            >
              <Search size={14} strokeWidth={1.75} color="var(--text-muted)" />
              <input
                ref={inNoteSearchInputRef}
                type="text"
                className="input"
                style={{ height: '28px', fontSize: '13px', flex: 1, backgroundColor: 'var(--bg-canvas)' }}
                placeholder="このノート内を検索 (Ctrl+F)..."
                value={inNoteSearchQuery}
                onChange={(e) => {
                  setInNoteSearchQuery(e.target.value);
                  setSearchMatchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    jumpToSearchMatch(e.shiftKey ? -1 : 1);
                  }
                }}
              />
              {inNoteSearchQuery.trim() && (
                <>
                  <span className="text-muted mono-num" style={{ fontSize: '11px', flexShrink: 0 }}>
                    {searchMatches.length > 0 ? `${(searchMatchIdx % searchMatches.length) + 1}/${searchMatches.length}件` : '0件'}
                  </span>
                  <button
                    type="button"
                    aria-label="前の一致へ"
                    className="btn btn-ghost"
                    style={{ width: '24px', height: '24px', padding: 0 }}
                    disabled={searchMatches.length === 0}
                    onClick={() => jumpToSearchMatch(-1)}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="次の一致へ"
                    className="btn btn-ghost"
                    style={{ width: '24px', height: '24px', padding: 0 }}
                    disabled={searchMatches.length === 0}
                    onClick={() => jumpToSearchMatch(1)}
                  >
                    <ChevronRight size={13} />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label="ページ内検索を閉じる"
                className="btn btn-ghost"
                style={{ width: '24px', height: '24px', padding: 0 }}
                onClick={() => {
                  setInNoteSearchOpen(false);
                  setInNoteSearchQuery('');
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}
        </header>

        {/* Toolbar */}
        <div className="note-toolbar">
          <div className="note-tablist" role="tablist" aria-label="ノート表示切り替え">
            <button
              ref={transcriptTabRef}
              type="button"
              role="tab"
              aria-selected={activeTab === 'transcript'}
              className={`note-tab ${activeTab === 'transcript' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('transcript');
                setHasUnreadTranscript(false);
              }}
              onKeyDown={(e) => handleTabKeyDown(e, 'transcript')}
            >
              <AudioLines size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>文字起こし</span>
              {hasUnreadTranscript && (
                <span className="note-tab-unread-dot" aria-label="未読の文字起こし" />
              )}
            </button>

            <button
              ref={summaryTabRef}
              type="button"
              role="tab"
              aria-selected={activeTab === 'summary'}
              className={`note-tab ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
              onKeyDown={(e) => handleTabKeyDown(e, 'summary')}
            >
              <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>要約</span>
            </button>

            <button
              ref={memoTabRef}
              type="button"
              role="tab"
              aria-selected={activeTab === 'memo'}
              className={`note-tab ${activeTab === 'memo' ? 'active' : ''}`}
              onClick={() => setActiveTab('memo')}
              onKeyDown={(e) => handleTabKeyDown(e, 'memo')}
            >
              <List size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>メモ</span>
            </button>
          </div>

          <div className="note-toolbar-right">
            {/* Recording / Processing / Completed Pill */}
            <NoteRecordingPill
              phase={phase}
              hasAudioPath={Boolean(note.audio_path)}
              isExternalRecording={isExternalRecording}
              levelRms={isExternalRecording ? recordingStatus?.level_rms ?? 0 : localRms}
              waveform={recordingStatus?.waveform ?? []}
              timerMs={timerMs}
              isPlaying={isPlaying}
              playbackProgress={playbackProgress}
              playbackRate={playbackRate}
              onRecordButtonClick={handleRecordButtonClick}
              onTogglePlayback={togglePlayback}
              onSkipAudioBy={skipAudioBy}
              onCyclePlaybackRate={cyclePlaybackRate}
            />

            <NotionSyncBadge status={note.notion_sync.status} pageUrl={note.notion_sync.page_url} />

            {/* Share Pill */}
            <div className="note-share-wrap">
              <div className="note-share-pill">
                <button
                  type="button"
                  className="note-share-action"
                  aria-expanded={shareOpen}
                  aria-label="共有"
                  title="共有"
                  onClick={() => setShareOpen((o) => !o)}
                >
                  <Upload size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>

              {shareOpen && (
                <div className="note-popover right" role="dialog" aria-label="共有オプション">
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={handleCopyMarkdown}
                  >
                    <Copy size={15} strokeWidth={1.75} />
                    <span>Markdown形式でコピー</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={() => void handleCopyFormat('slack', 'Slack共有フォーマット')}
                  >
                    <Copy size={15} strokeWidth={1.75} />
                    <span>Slack投稿形式でコピー</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={() => void handleCopyFormat('line', 'LINE・メール用テキスト')}
                  >
                    <Copy size={15} strokeWidth={1.75} />
                    <span>LINE・メール用でコピー</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={async () => {
                      try {
                        await onPastePrepare(formatNoteForCopy(note, settings.copy_format || 'markdown'));
                        setShareOpen(false);
                      } catch (err) {
                        notify(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <ClipboardPaste size={15} strokeWidth={1.75} />
                    <span>貼り付け準備</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={() => setNotionPreviewOpen(true)}
                  >
                    <UploadCloud size={15} strokeWidth={1.75} />
                    <span>
                      {note.notion_sync.status === 'synced'
                        ? 'Notion を更新'
                        : note.notion_sync.status === 'failed'
                          ? 'Notion 再試行'
                          : 'Notion に保存'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={async () => {
                      const toNotionOnly = note.storage_mode !== 'notion_only';
                      const ok = await confirmActionDialog(
                        toNotionOnly
                          ? 'このノートを「Notionのみ（ローカル削除）」にしますか？'
                          : 'このノートをローカルにも保存しますか？',
                        toNotionOnly
                          ? 'Notion に同期したうえでローカルの音声・本文データを削除し、オンラインビュワーとして閲覧します。'
                          : 'Notion から本文を取得してローカルに保存します。',
                        toNotionOnly ? 'Notionのみにする' : 'ローカルに保存'
                      );
                      if (!ok) return;
                      try {
                        if (isTauriRuntime()) {
                          const updated = await apiSetNoteStorageMode(note.id, toNotionOnly);
                          onUpdateNote(updated);
                        } else {
                          onUpdateNote({ ...note, storage_mode: toNotionOnly ? 'notion_only' : 'local' });
                        }
                        notify(
                          toNotionOnly
                            ? 'Notionのみ（オンラインビュワー）に切り替えました'
                            : 'ローカルに保存しました'
                        );
                        setShareOpen(false);
                      } catch (err) {
                        notify(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <Cloud size={15} strokeWidth={1.75} />
                    <span>
                      {note.storage_mode === 'notion_only'
                        ? 'ローカルにダウンロード'
                        : 'Notionのみにする（ローカル削除）'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={async () => {
                      try {
                        await onShareSlack(note.id);
                        notify('Slack に送信しました');
                        setShareOpen(false);
                      } catch (err) {
                        notify(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <Send size={15} strokeWidth={1.75} />
                    <span>Slack に共有</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={async () => {
                      try {
                        await onSendWebhook(note.id);
                        notify('Webhook を送信しました');
                        setShareOpen(false);
                      } catch (err) {
                        notify(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <Link2 size={15} strokeWidth={1.75} />
                    <span>Webhook 送信</span>
                  </button>
                  {isTauriRuntime() && (
                    <>
                      {(['github', 'linear', 'jira'] as const)
                        .filter((p) => {
                          if (p === 'github') return Boolean(settings.github_repo?.trim());
                          if (p === 'linear') return Boolean(settings.linear_team_id?.trim());
                          return Boolean(settings.jira_project_key?.trim());
                        })
                        .map((provider) => (
                          <button
                            key={provider}
                            type="button"
                            className="note-sidebar-item"
                            onClick={async () => {
                              try {
                                const firstAction = note.action_items[0]?.text;
                                const issueTitle = firstAction
                                  ? `[${note.title || '会議'}] ${firstAction}`
                                  : note.title || '無題のノート';
                                const issueBody = [
                                  note.summary ? `## 要約\n${note.summary}` : '',
                                  note.action_items.length > 0
                                    ? `## アクション項目\n${note.action_items.map((a) => `- [${a.done ? 'x' : ' '}] ${a.text}`).join('\n')}`
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join('\n\n');
                                const res = await apiCreateIssueFromAction(provider, issueTitle, issueBody);
                                notify(`${res.provider.toUpperCase()} Issue ${res.key} を起票しました`);
                                setShareOpen(false);
                              } catch (e) {
                                notify(e instanceof Error ? e.message : String(e));
                              }
                            }}
                          >
                            <GitMerge size={15} strokeWidth={1.75} />
                            <span>{provider === 'github' ? 'GitHub Issue 起票' : provider === 'linear' ? 'Linear Issue 起票' : 'Jira Task 起票'}</span>
                          </button>
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Active ASR Model Pill */}
            <button
              type="button"
              className="note-meta-pill"
              style={{ padding: '0 12px', fontSize: '12px', color: 'var(--ns-text-secondary)' }}
              title="使用中の音声認識 (ASR) モデル（クリックで設定を開く）"
              onClick={onGoSettings}
            >
              <Mic size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>
                {(() => {
                  const id = note.asr_model_id || settings.active_asr_model_id;
                  if (id === 'stepfun-stepaudio-3-asr-max') return 'StepAudio 3 Max';
                  if (id === 'stepfun-stepaudio-2.5-asr') return 'StepAudio 2.5';
                  if (id === 'google-cloud-stt') return 'Google Cloud STT';
                  if (id === 'groq-whisper-large-v3-turbo') return 'Groq Whisper';
                  if (id === 'openai-whisper-1') return 'OpenAI Whisper';
                  if (id === 'deepgram-nova-2') return 'Deepgram Nova-2';
                  return id || 'モデル未選択';
                })()}
              </span>
            </button>
          </div>
        </div>

        {/* Status Toast / Errors / Silent Mic Warning */}
        {isRecording && recordingStatus?.is_silent_warning && (
          <div
            role="status"
            style={{
              marginTop: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 12px',
              borderRadius: '999px',
              backgroundColor: 'var(--warning-bg)',
              color: 'var(--warning)',
              fontSize: '12px',
              fontWeight: 500,
              alignSelf: 'flex-start',
            }}
          >
            音声が入力されていません（マイクまたは録音ソースを確認してください）
          </div>
        )}

        {toast && (
          <div
            style={{
              marginTop: '10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              color: 'var(--ns-text-secondary)',
            }}
          >
            <Check size={14} strokeWidth={1.75} />
            <span>{toast}</span>
          </div>
        )}

        {note.storage_mode === 'notion_only' && (
          <div
            style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
              padding: '8px 12px',
              borderRadius: '10px',
              backgroundColor: 'var(--ns-surface-pill)',
              border: '1px solid var(--ns-border-pill)',
              fontSize: '12.5px',
              color: 'var(--ns-text-secondary)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Cloud size={14} strokeWidth={1.75} />
              <strong>オンライン閲覧中（Notionのみ）</strong>
              {viewerLoading && <span>— Notion から読み込み中...</span>}
              {viewerError && <span style={{ color: 'var(--danger)' }}>— 読み込み失敗: {viewerError}</span>}
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '26px', fontSize: '12px', padding: '0 12px' }}
                disabled={viewerLoading}
                onClick={() => void reloadNotionViewer()}
              >
                最新を読み込む
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: '26px', fontSize: '12px', padding: '0 12px' }}
                onClick={async () => {
                  if (isTauriRuntime()) {
                    const updated = await apiSetNoteStorageMode(note.id, false);
                    onUpdateNote(updated);
                  } else {
                    onUpdateNote({ ...note, storage_mode: 'local' });
                  }
                  notify('ローカルに保存しました');
                }}
              >
                ローカルに保存
              </button>
            </div>
          </div>
        )}

        {isProcessing && (
          <div
            role="status"
            style={{
              marginTop: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-subtle, #F8FAFC)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
                <Loader2 size={14} strokeWidth={2} className="spin" />
                {transcribeProgress && transcribeProgress.note_id === note.id
                  ? transcribeProgress.label
                  : '文字起こし処理中...'}
              </span>
              {transcribeProgress && transcribeProgress.note_id === note.id && (
                <span className="mono-num text-muted">{transcribeProgress.progress}%</span>
              )}
            </div>
            <div
              style={{
                width: '100%',
                height: '4px',
                borderRadius: '999px',
                backgroundColor: 'var(--border-subtle, #E2E8F0)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width:
                    transcribeProgress && transcribeProgress.note_id === note.id
                      ? `${Math.max(8, transcribeProgress.progress)}%`
                      : '45%',
                  height: '100%',
                  backgroundColor: 'var(--accent)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </div>
        )}

        {transcribeError && (
          <div
            style={{
              marginTop: '10px',
              fontSize: '13.5px',
              color: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <span>{transcribeError}</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {note.audio_path && onRetranscribeNote && !isRecording && !isProcessing && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '28px', fontSize: '12px' }}
                  onClick={() => void onRetranscribeNote(note.id)}
                >
                  再文字起こし
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: '28px', fontSize: '12px' }}
                onClick={onGoSettings}
              >
                設定を開く
              </button>
            </div>
          </div>
        )}

        {/* Body (Scrollable, flex: 1, min-height: 0) */}
        <div className="note-body-area">
          <div
            ref={scrollRef}
            className="note-body-scroll"
            onScroll={handleScroll}
          >
            {activeTab === 'transcript' && (
              <div aria-live="polite" aria-relevant="additions" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(isRecording || displayedSegments.length > 0) && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {isRecording && (
                        <span className="status-chip" style={{ fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent-border)' }}>
                          暫定ライブ文字起こし（録音停止後に確定・整形）
                        </span>
                      )}
                      {dictionaryCandidates.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          <span className="text-muted" style={{ fontSize: '11px' }}>辞書候補:</span>
                          {dictionaryCandidates.map((term) => (
                            <button
                              key={term}
                              type="button"
                              className="chip-filter"
                              style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
                              title={`「${term}」を辞書に追加`}
                              onClick={async () => {
                                await onAddDictionaryTerm(term);
                                setDismissedCandidates((prev) => ({ ...prev, [term]: true }));
                                notify(`「${term}」を辞書に追加しました`);
                              }}
                            >
                              + {term}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {displayedSegments.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Download size={13} strokeWidth={1.75} className="text-muted" />
                        {(['srt', 'vtt', 'txt', 'md'] as const).map((fmt) => (
                          <button
                            key={fmt}
                            type="button"
                            className="chip-filter mono-num"
                            style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
                            onClick={() => exportTranscriptAs(fmt)}
                          >
                            .{fmt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {displayedSegments.length === 0 ? (
                  <div className="note-empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <span>{isProcessing ? '文字起こし処理中...' : 'まだ文字起こしがありません'}</span>
                    {!isRecording && !isProcessing && note.audio_path && onRetranscribeNote && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ height: '32px', fontSize: '13px' }}
                        onClick={() => void onRetranscribeNote(note.id)}
                      >
                        録音音声から文字起こしを実行
                      </button>
                    )}
                  </div>
                ) : (
                  <NoteTranscriptPanel
                    segments={displayedSegments}
                    activeSegId={activeSegId}
                    isRecording={isRecording}
                    isCompleted={phase === 'completed'}
                    editingSegId={editingSegId}
                    editingSegText={editingSegText}
                    onStartEdit={(segId, text) => {
                      setEditingSegId(segId);
                      setEditingSegText(text);
                    }}
                    onChangeEditText={setEditingSegText}
                    onCommitEdit={(segId) => {
                      const nextSegs = note.segments.map((s) =>
                        s.id === segId ? { ...s, text: editingSegText } : s
                      );
                      onUpdateNote({
                        ...note,
                        segments: nextSegs,
                        updated_at: new Date().toISOString(),
                      });
                      setEditingSegId(null);
                    }}
                    onCancelEdit={() => setEditingSegId(null)}
                    onTogglePlayback={togglePlayback}
                    onPlayFromMs={(ms) => void playNoteAudioFromMs(ms)}
                    onAddDictionaryTerm={onAddDictionaryTerm}
                    onNotify={notify}
                    highlightSearchText={highlightSearchText}
                  />
                )}
              </div>
            )}

            {activeTab === 'summary' && (
              <NoteSummaryPanel
                note={note}
                effectiveNote={effectiveNote}
                summaryPresets={summaryPresets}
                selectedTemplateId={selectedTemplateId}
                setSelectedTemplateId={setSelectedTemplateId}
                suggestedPresetId={suggestedPresetId}
                historyOpen={historyOpen}
                setHistoryOpen={setHistoryOpen}
                compareRevisionId={compareRevisionId}
                setCompareRevisionId={setCompareRevisionId}
                isSummarizing={isSummarizingThisNote}
                onRunSummarize={handleRunSummarize}
                llmConfigured={llmConfigured}
                onUpdateNote={onUpdateNote}
                onNotify={notify}
                aiError={aiError}
                onGoSettings={onGoSettings}
              />
            )}

            {activeTab === 'memo' && (
              <NoteMemoPanel
                memoEditorRef={memoEditorRef}
                applyMemoCommand={applyMemoCommand}
                saveMemoHtml={saveMemoHtml}
              />
            )}
          </div>

          {activeTab === 'transcript' && isRecording && !isAtBottom && displayedSegments.length > 0 && (
            <button
              type="button"
              className="note-jump-latest"
              onClick={scrollToLatest}
            >
              <ArrowDown size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>最新↓</span>
            </button>
          )}
        </div>

        {/* Bottom Question Input + Generate Summary Button (popup when transcript exists & summary empty) */}
        <div className="note-composer-wrap">
          {(() => {
            const hasTranscript =
              note.segments.some((s) => s.text.trim().length > 0) ||
              externalLiveSegments.some((s) => s.text.trim().length > 0);
            const showSummarizeBtn = !note.summary.trim() && hasTranscript;
            if (!showSummarizeBtn && chatPopupOpen) return null;
            return (
              <div
                style={{
                  width: '100%',
                  maxWidth: '840px',
                  display: 'flex',
                  justifyContent: showSummarizeBtn ? 'space-between' : 'flex-end',
                  alignItems: 'center',
                  marginBottom: '8px',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                {showSummarizeBtn && (
                  <div className="note-summary-popup-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select
                      aria-label="要約テンプレート選択"
                      className="input"
                      style={{ width: '148px', height: '32px', fontSize: '12px', padding: '0 8px', lineHeight: '1.2' }}
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                    >
                      {summaryPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!llmConfigured || isSummarizingThisNote}
                      onClick={handleRunSummarize}
                    >
                      <Sparkles size={14} strokeWidth={1.75} />
                      {isSummarizingThisNote ? '要約を生成中...' : '要約を生成'}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          <div ref={composerUnifiedRef} className="note-composer-unified">
            {renderChatPopup(`note:${note.id}`, isAskingThisNote, false)}
            <div className={`note-composer-box ${chatPopupOpen ? 'popup-open' : ''}`}>
              <textarea
                aria-label="ノートについて何でも質問"
                className="note-composer-input"
                rows={1}
                placeholder="ノートについて何でも質問"
                value={question}
                onClick={() => setChatPopupOpen(true)}
                onFocus={() => setChatPopupOpen(true)}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleQuestionKeyDown}
              />
              <button
                type="button"
                className="note-send-btn"
                aria-label="質問を送信"
                disabled={!question.trim() || isAskingThisNote}
                onClick={handleAskQuestion}
              >
                <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="note-consent-note">
            <Shield size={13} strokeWidth={1.75} aria-hidden="true" />
            <span>他の人を録音するときは必ず同意を得てください</span>
          </div>
        </div>
        </>
        )}
      </div>

      {/* Notion Duplicate-Prevention Preview Dialog */}
      {notionPreviewOpen && (
        <div
          className="note-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notion-dialog-title"
        >
          <div className="note-dialog">
            <h2 id="notion-dialog-title" className="section-title">
              Notion 保存前の確認
            </h2>
            <p style={{ margin: 0, color: 'var(--ns-text-secondary)' }}>
              {note.notion_sync.page_id
                ? '既存ページを更新（重複ページを作成しません）'
                : '新規ページを作成'}
            </p>
            {!notionReady && (
              <p style={{ margin: 0, color: 'var(--danger)' }}>
                Notion 連携が未設定です。連携設定からトークンと保存先を設定してください。
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setNotionPreviewOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!notionReady || notionBusy}
                onClick={handleConfirmNotionSave}
              >
                {notionBusy ? '保存中...' : '保存を実行'}
              </button>
            </div>
          </div>
        </div>
      )}
      {noteContextMenu && (
        <div
          className="context-menu"
          role="menu"
          style={{ left: `${noteContextMenu.x}px`, top: `${noteContextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            role="menuitem"
            onClick={() => {
              const id = noteContextMenu.noteId;
              setNoteContextMenu(null);
              setViewingFolderId(null);
              onSelectNote?.(id);
            }}
          >
            <FileText size={14} strokeWidth={1.5} />
            <span>開く</span>
          </button>
          {onDeleteNote && (
            <button
              type="button"
              className="context-menu-item danger"
              role="menuitem"
              onClick={async () => {
                const id = noteContextMenu.noteId;
                setNoteContextMenu(null);
                const ok = await confirmDeleteDialog(
                  'このノートを削除しますか？',
                  '削除したノートは元に戻せません。'
                );
                if (!ok) return;
                await onDeleteNote(id);
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              <span>削除</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
