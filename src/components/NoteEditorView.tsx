import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Calendar,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  FileText,
  Folder as FolderIcon,
  Link2,
  List,
  Menu,
  Mic,
  Pause,
  Play,
  Plus,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import {
  AppSettings,
  ChatAnswer,
  Folder,
  Note,
  Recipe,
  RecordingStatus,
  SecretStatus,
  TranscriptSegment,
} from '../types';
import {
  formatDateTime,
  formatNoteForCopy,
  formatNoteTimer,
} from '../lib/format';
import { NoteWaveform } from './NoteWaveform';

export type NotePhase = 'idle' | 'recording' | 'processing' | 'completed';

interface NoteEditorViewProps {
  note: Note;
  allNotes?: Note[];
  folders?: Folder[];
  recordingNoteId?: string | null;
  settings: AppSettings;
  recipes: Recipe[];
  secretStatus: SecretStatus | null;
  transcribing: boolean;
  transcribeError: string | null;
  recordingStatus?: RecordingStatus;
  liveSegments?: TranscriptSegment[];
  onStartRecording?: () => Promise<void> | void;
  onStopRecording?: () => Promise<void> | void;
  onUpdateNote: (note: Note) => void;
  onSelectNote?: (noteId: string) => void;
  onCreateNoteInFolder?: (folderId: string) => void;
  onSaveFolder?: (folder: Folder) => Promise<void>;
  onDeleteFolder?: (folderId: string) => Promise<void>;
  onCopyText: (text: string, label: string) => Promise<void>;
  onPastePrepare: (text: string) => Promise<void>;
  onSaveToNotion: (noteId: string) => Promise<void>;
  onSummarize: (noteId: string) => Promise<void>;
  onDraftFollowup: (noteId: string) => Promise<void>;
  onRunRecipe: (noteId: string, prompt: string) => Promise<string>;
  onSaveRecipe: (recipe: Recipe) => Promise<void>;
  onChatNote: (noteIds: string[], question: string) => Promise<ChatAnswer>;
  onShareSlack: (noteId: string) => Promise<void>;
  onSendWebhook: (noteId: string) => Promise<void>;
  onAddDictionaryTerm: (term: string) => Promise<void>;
  onGoSettings: () => void;
  onGoHome?: () => void;
}

export const NoteEditorView: React.FC<NoteEditorViewProps> = ({
  note,
  allNotes,
  folders = [{ id: 'personal', name: '一般', is_shared: false, permission: 'owner' }],
  recordingNoteId = null,
  settings,
  secretStatus,
  transcribing,
  transcribeError,
  recordingStatus,
  liveSegments: externalLiveSegments = [],
  onStartRecording,
  onStopRecording,
  onUpdateNote,
  onSelectNote,
  onCreateNoteInFolder,
  onSaveFolder,
  onDeleteFolder,
  onCopyText,
  onPastePrepare,
  onSaveToNotion,
  onSummarize,
  onChatNote,
  onShareSlack,
  onSendWebhook,
  onGoSettings,
  onGoHome,
}) => {
  // Sidebar & responsive drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [chatScope, setChatScope] = useState<'note' | 'space'>('note');
  const [viewingFolderId, setViewingFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const notesList = useMemo(
    () => (allNotes && allNotes.length > 0 ? allNotes : [note]),
    [allNotes, note]
  );

  // Inline title editing with Enter confirm / Esc cancel
  const [titleDraft, setTitleDraft] = useState(note.title);
  const titleSnapshotRef = useRef(note.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleDraft(note.title);
    titleSnapshotRef.current = note.title;
    setViewingFolderId(null);
  }, [note.id, note.title]);

  // Tabs: 3 stages (文字起こし / 要約 / メモ)
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'memo'>('transcript');
  const [hasUnreadTranscript, setHasUnreadTranscript] = useState(false);
  const transcriptTabRef = useRef<HTMLButtonElement>(null);
  const summaryTabRef = useRef<HTMLButtonElement>(null);
  const memoTabRef = useRef<HTMLButtonElement>(null);
  const memoEditorRef = useRef<HTMLDivElement>(null);

  // Popovers & dialogs
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [newParticipant, setNewParticipant] = useState('');
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [notionPreviewOpen, setNotionPreviewOpen] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [rerecordConfirmOpen, setRerecordConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Recording / processing / playback state
  const [localRecording, setLocalRecording] = useState(false);
  const [localProcessing, setLocalProcessing] = useState(false);
  const [localElapsedMs, setLocalElapsedMs] = useState(0);
  const [localRms, setLocalRms] = useState(0);
  const [localFallbackSegments, setLocalFallbackSegments] = useState<TranscriptSegment[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);

  // Sync rich memo HTML when note switches
  useEffect(() => {
    if (memoEditorRef.current && memoEditorRef.current.innerHTML !== note.manual_notes) {
      memoEditorRef.current.innerHTML = note.manual_notes || '';
    }
  }, [note.id]);

  // AI / Q&A
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState<ChatAnswer | null>(null);

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

  const displayedSegments = useMemo(() => {
    if (isRecording) {
      const merged = [...note.segments, ...externalLiveSegments, ...localFallbackSegments];
      if (merged.length > 0) return merged;
    }
    return note.segments;
  }, [isRecording, externalLiveSegments, localFallbackSegments, note.segments]);

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

  // Local timer + simulated RMS when recording without Tauri runtime
  useEffect(() => {
    if (!localRecording) return;
    const startAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startAt;
      setLocalElapsedMs(elapsed);
      setLocalRms(0.18 + Math.abs(Math.sin(elapsed / 240)) * 0.45);
    }, 200);
    return () => clearInterval(id);
  }, [localRecording]);

  // Playback simulation for completed state
  useEffect(() => {
    if (!isPlaying || phase !== 'completed') return;
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
  }, [isPlaying, phase, totalDurationMs]);

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

    if (onStartRecording) {
      await onStartRecording();
      // If external runtime didn't switch to recording (e.g. browser preview), start local timer
      if (!recordingStatus || recordingStatus.state === 'idle') {
        setLocalRecording(true);
      }
    } else {
      setLocalRecording(true);
    }
  };

  const stopRecording = async () => {
    if (isExternalRecording && onStopRecording) {
      await onStopRecording();
      return;
    }

    const elapsedSec = Math.max(1, Math.round(localElapsedMs / 1000));
    setLocalRecording(false);
    setLocalRms(0);
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
    } else if (phase === 'completed') {
      setRerecordConfirmOpen(true);
    } else if (phase === 'idle') {
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
      setTitleDraft(titleSnapshotRef.current);
      onUpdateNote({ ...note, title: titleSnapshotRef.current });
      titleInputRef.current?.blur();
    }
  };

  const handleAddParticipant = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newParticipant.trim();
    if (!name) return;
    if (!note.participants.includes(name)) {
      onUpdateNote({
        ...note,
        participants: [...note.participants, name],
        updated_at: new Date().toISOString(),
      });
    }
    setNewParticipant('');
  };

  const handleAskQuestion = async () => {
    const q = question.trim();
    if (!q || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const ids = chatScope === 'note' ? [note.id] : [];
      const res = await (onChatNote as (noteIds: string[], question: string, spaceId?: string | null) => Promise<ChatAnswer>)(
        ids,
        q,
        chatScope === 'space' ? note.folder_id : null
      );
      setQaAnswer(res);
      setQuestion('');
    } catch (err) {
      setAiError(String(err));
    } finally {
      setAiBusy(false);
    }
  };

  const handleQuestionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAskQuestion();
    }
  };

  const handleCopyMarkdown = async () => {
    const text = formatNoteForCopy(note, settings.copy_format || 'markdown');
    await onCopyText(text, 'ノート');
    notify('コピーしました');
    setShareOpen(false);
  };

  const handleCopyLink = async () => {
    const linkText = `${note.title.trim() || '無題のノート'}\n${formatDateTime(note.created_at)}`;
    await onCopyText(linkText, 'リンク');
    notify('リンクをコピーしました');
  };

  const handleConfirmNotionSave = async () => {
    setNotionBusy(true);
    try {
      await onSaveToNotion(note.id);
      setNotionPreviewOpen(false);
      setShareOpen(false);
      notify('Notion に保存しました');
    } finally {
      setNotionBusy(false);
    }
  };

  const activeFolder =
    folders.find((f) => f.id === note.folder_id) ||
    folders[0] || { id: 'personal', name: '個人', is_shared: false, permission: 'owner' as const };
  const folderDisplayName =
    activeFolder.id === 'personal' ? '個人' : activeFolder.name;

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
                    title={`${f.name}（親フォルダを開く）`}
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
                            title={cn.title.trim() || '無題のノート'}
                          >
                            <FileText size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                            <span className="note-sidebar-item-label" style={{ fontSize: '12px' }}>
                              {cn.title.trim() || '無題のノート'}
                            </span>
                            {isChildRecording && (
                              <span
                                title="録音中"
                                style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  backgroundColor: 'var(--danger)',
                                  marginLeft: 'auto',
                                  flexShrink: 0,
                                }}
                              />
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
              placeholder="親フォルダ（スペース）を追加"
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" style={{ height: '32px', padding: '0 8px' }} disabled={!newSpaceName.trim()}>
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </form>
        )}

        {onGoHome && (
          <div className="note-sidebar-footer">
            <button
              type="button"
              className="note-sidebar-item"
              onClick={onGoHome}
              title="ホームに戻る"
            >
              <ArrowDown size={18} strokeWidth={1.75} style={{ transform: 'rotate(90deg)' }} aria-hidden="true" />
              <span className="note-sidebar-item-label">ホーム</span>
            </button>
          </div>
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
            const folderNotes = notesList.filter((n) => n.folder_id === targetFolder.id);
            return (
              <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FolderIcon size={20} strokeWidth={1.75} />
                    <h2 className="page-title">{targetFolder.name}</h2>
                    <span className="status-chip">{folderNotes.length} 件のノート</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                        このスペースに新規ノート
                      </button>
                    )}
                    {onDeleteFolder && targetFolder.id !== 'personal' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={async () => {
                          await onDeleteFolder(targetFolder.id);
                          setViewingFolderId(null);
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                        スペースを削除
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setViewingFolderId(null)}
                    >
                      開いていたノートへ戻る
                    </button>
                  </div>
                </div>

                {folderNotes.length === 0 ? (
                  <div style={{ padding: '32px 0', borderTop: '1px solid var(--border-subtle)' }}>
                    <p className="text-secondary" style={{ margin: '0px' }}>
                      このスペース（親フォルダ）にはまだノート（子ファイル）がありません。
                    </p>
                  </div>
                ) : (
                  <div className="flat-list">
                    {folderNotes.map((fn) => {
                      const isFnRecording =
                        recordingNoteId === fn.id || (fn.id === note.id && isRecording);
                      return (
                        <button
                          key={fn.id}
                          type="button"
                          className="flat-row"
                          onClick={() => {
                            setViewingFolderId(null);
                            onSelectNote?.(fn.id);
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <FileText size={15} strokeWidth={1.75} />
                              <strong style={{ fontWeight: 600 }}>
                                {fn.title.trim() || '無題のノート'}
                              </strong>
                              {isFnRecording && (
                                <span className="status-chip danger">録音中</span>
                              )}
                            </div>
                            <span className="text-muted mono-num">
                              {formatDateTime(fn.created_at)} ・ {fn.segments.length} セグメント
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
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
            <label className="note-meta-pill" style={{ cursor: 'pointer' }} title="日付を変更">
              <Calendar size={15} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
              <input
                type="date"
                aria-label="ノートの日付"
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
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: 'inherit',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            </label>

            <div className="note-meta-pill-wrap">
              <button
                type="button"
                className="note-meta-pill"
                aria-expanded={participantsOpen}
                onClick={() => {
                  setParticipantsOpen((o) => !o);
                  setFolderMenuOpen(false);
                }}
              >
                <Users size={15} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
                <span>
                  {note.participants.length > 0
                    ? note.participants.join(', ')
                    : '参加者を追加'}
                </span>
                <span className="note-meta-pill-divider" aria-hidden="true" />
                <ChevronDown size={14} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
              </button>

              {participantsOpen && (
                <div className="note-popover" role="dialog" aria-label="参加者を編集">
                  <form onSubmit={handleAddParticipant} style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="input"
                      style={{ height: '32px' }}
                      placeholder="参加者名を入力"
                      value={newParticipant}
                      onChange={(e) => setNewParticipant(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      style={{ height: '32px', padding: '0 12px' }}
                    >
                      追加
                    </button>
                  </form>
                  {note.participants.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {note.participants.map((p) => (
                        <span
                          key={p}
                          className="note-meta-pill"
                          style={{ height: '28px', padding: '0 12px', fontSize: '12px' }}
                        >
                          {p}
                          <button
                            type="button"
                            aria-label={`${p}を削除`}
                            onClick={() =>
                              onUpdateNote({
                                ...note,
                                participants: note.participants.filter((x) => x !== p),
                                updated_at: new Date().toISOString(),
                              })
                            }
                            style={{ display: 'inline-flex', padding: 0 }}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="note-meta-pill-wrap">
              <button
                type="button"
                className="note-meta-pill"
                aria-expanded={folderMenuOpen}
                onClick={() => {
                  setFolderMenuOpen((o) => !o);
                  setParticipantsOpen(false);
                }}
              >
                <FolderIcon size={15} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
                <span>{folderDisplayName}</span>
              </button>

              {folderMenuOpen && folders.length > 0 && (
                <div className="note-popover" role="menu" aria-label="フォルダ選択">
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
                </div>
              )}
            </div>
          </div>
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
            {(phase === 'idle' || phase === 'recording') && (
              <div className="note-rec-pill">
                <button
                  type="button"
                  className="note-rec-btn"
                  aria-pressed={phase === 'recording'}
                  aria-label={phase === 'recording' ? '録音を停止' : '録音を開始'}
                  onClick={handleRecordButtonClick}
                >
                  {phase === 'recording' ? (
                    <span className="note-rec-btn-square" />
                  ) : (
                    <span className="note-rec-btn-dot" />
                  )}
                </button>

                <NoteWaveform
                  mode={phase === 'recording' ? 'recording' : 'idle'}
                  levelRms={
                    isExternalRecording
                      ? recordingStatus?.level_rms ?? 0
                      : localRms
                  }
                  waveform={recordingStatus?.waveform ?? []}
                />

                <span
                  className={`note-timer ${phase === 'idle' ? 'muted' : ''}`}
                  aria-hidden="true"
                >
                  {formatNoteTimer(timerMs)}
                </span>
              </div>
            )}

            {phase === 'processing' && (
              <div className="note-rec-pill">
                <NoteWaveform mode="processing" />
                <span className="note-status-label">文字起こし中…</span>
              </div>
            )}

            {phase === 'completed' && (
              <div className="note-rec-pill">
                <button
                  type="button"
                  className="note-play-btn"
                  aria-label={isPlaying ? '再生を一時停止' : '録音を再生'}
                  onClick={() => setIsPlaying((p) => !p)}
                >
                  {isPlaying ? (
                    <Pause size={20} strokeWidth={1.75} />
                  ) : (
                    <Play size={20} strokeWidth={1.75} />
                  )}
                </button>

                <NoteWaveform mode="completed" playbackProgress={playbackProgress} />

                <span className="note-timer" aria-hidden="true">
                  {formatNoteTimer(timerMs)}
                </span>

                <span className="note-pill-divider" aria-hidden="true" />

                <span className="note-status-label">文字起こし済み</span>

                <button
                  type="button"
                  className="note-rerecord-btn"
                  aria-label="再録音"
                  onClick={handleRecordButtonClick}
                >
                  <Mic size={12} strokeWidth={1.75} />
                </button>
              </div>
            )}

            {/* Share Pill */}
            <div className="note-share-wrap">
              <div className="note-share-pill">
                <button
                  type="button"
                  className="note-share-action"
                  aria-expanded={shareOpen}
                  aria-label="共有"
                  onClick={() => setShareOpen((o) => !o)}
                >
                  <Upload size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span className="note-share-label">共有</span>
                </button>
                <span className="note-pill-divider" aria-hidden="true" />
                <button
                  type="button"
                  className="note-share-action"
                  aria-label="リンクをコピー"
                  onClick={handleCopyLink}
                >
                  <Link2 size={15} strokeWidth={1.75} aria-hidden="true" />
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
                    <span>ノートをコピー</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={async () => {
                      await onPastePrepare(formatNoteForCopy(note, settings.copy_format || 'markdown'));
                      setShareOpen(false);
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
                      await onShareSlack(note.id);
                      notify('Slack に送信しました');
                      setShareOpen(false);
                    }}
                  >
                    <Send size={15} strokeWidth={1.75} />
                    <span>Slack に共有</span>
                  </button>
                  <button
                    type="button"
                    className="note-sidebar-item"
                    onClick={async () => {
                      await onSendWebhook(note.id);
                      notify('Webhook を送信しました');
                      setShareOpen(false);
                    }}
                  >
                    <Link2 size={15} strokeWidth={1.75} />
                    <span>Webhook 送信</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Toast / Errors */}
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

        {transcribeError && (
          <div
            style={{
              marginTop: '10px',
              fontSize: '14px',
              color: 'var(--danger)',
            }}
          >
            {transcribeError}
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
              <div aria-live="polite" aria-relevant="additions">
                {displayedSegments.length === 0 ? (
                  <div className="note-empty-state">
                    まだ文字起こしがありません
                  </div>
                ) : (
                  <div
                    className={`note-transcript-list ${
                      phase === 'completed' ? 'completed' : ''
                    }`}
                  >
                    {displayedSegments.map((seg) => (
                      <article key={seg.id} className="note-turn">
                        <div className="note-turn-meta">
                          <span className="note-turn-time">
                            {formatNoteTimer(seg.start_ms)}
                          </span>
                          <span className="note-turn-speaker">
                            {seg.speaker || '参加者'}
                          </span>
                        </div>
                        <p className="note-turn-text">{seg.text}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'summary' && (
              <div className="note-notes-tab">
                <section className="note-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 className="note-card-title">要約</h2>
                    {llmConfigured && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ height: '30px', fontSize: '12px' }}
                        disabled={aiBusy}
                        onClick={async () => {
                          setAiBusy(true);
                          setAiError(null);
                          try {
                            await onSummarize(note.id);
                          } catch (err) {
                            setAiError(String(err));
                          } finally {
                            setAiBusy(false);
                          }
                        }}
                      >
                        <Sparkles size={13} strokeWidth={1.75} />
                        {aiBusy ? '生成中' : '要約を生成'}
                      </button>
                    )}
                  </div>
                  <textarea
                    aria-label="要約内容"
                    className="textarea"
                    style={{ minHeight: '160px' }}
                    value={note.summary}
                    onChange={(e) =>
                      onUpdateNote({
                        ...note,
                        summary: e.target.value,
                        updated_at: new Date().toISOString(),
                      })
                    }
                    placeholder="要約はまだ生成されていません（下のボタンまたは右上から生成できます）"
                  />
                </section>

                {note.decisions.length > 0 && (
                  <section className="note-card">
                    <h2 className="note-card-title">決定事項</h2>
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '24px' }}>
                      {note.decisions.map((d, i) => (
                        <li key={`d-${i}`}>{d}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {!llmConfigured && (
                  <section className="note-card" style={{ backgroundColor: 'var(--ns-bg-sidebar)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>LLMが未設定です</div>
                    <p style={{ margin: 0, color: 'var(--ns-text-secondary)' }}>
                      AI要約や質問応答を使うには設定画面でプロバイダを設定してください。
                    </p>
                    <button
                      type="button"
                      className="note-inline-link"
                      style={{ alignSelf: 'flex-start' }}
                      onClick={onGoSettings}
                    >
                      AI設定を開く
                    </button>
                  </section>
                )}

                {aiError && (
                  <div style={{ fontSize: '14px', color: 'var(--danger)' }}>{aiError}</div>
                )}
              </div>
            )}

            {activeTab === 'memo' && (
              <div className="note-notes-tab">
                <section className="note-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="rich-memo-toolbar" role="toolbar" aria-label="メモ書式ツールバー">
                    <button
                      type="button"
                      className="rich-memo-tool-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('formatBlock', false, 'h1');
                      }}
                    >
                      H1
                    </button>
                    <button
                      type="button"
                      className="rich-memo-tool-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('formatBlock', false, 'h2');
                      }}
                    >
                      H2
                    </button>
                    <button
                      type="button"
                      className="rich-memo-tool-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('formatBlock', false, 'h3');
                      }}
                    >
                      H3
                    </button>
                    <button
                      type="button"
                      className="rich-memo-tool-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('bold');
                      }}
                    >
                      <strong>太字</strong>
                    </button>
                    <button
                      type="button"
                      className="rich-memo-tool-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('underline');
                      }}
                    >
                      <u>下線</u>
                    </button>
                    <button
                      type="button"
                      className="rich-memo-tool-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        document.execCommand('insertUnorderedList');
                      }}
                    >
                      箇条書き
                    </button>
                  </div>
                  <div
                    ref={memoEditorRef}
                    role="textbox"
                    aria-label="自由メモ帳"
                    aria-multiline="true"
                    contentEditable
                    suppressContentEditableWarning
                    className="rich-memo-editor"
                    onInput={(e) => {
                      onUpdateNote({
                        ...note,
                        manual_notes: e.currentTarget.innerHTML,
                        updated_at: new Date().toISOString(),
                      });
                    }}
                  />
                </section>
              </div>
            )}
          </div>

          {activeTab === 'transcript' && !isAtBottom && displayedSegments.length > 0 && (
            <button
              type="button"
              className="note-jump-latest"
              onClick={scrollToLatest}
            >
              <ArrowDown size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>最新へ</span>
            </button>
          )}
        </div>

        {/* Q&A Answer Card (when answered) */}
        {qaAnswer && (
          <div className="note-qa-card" role="region" aria-label="質問への回答">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{qaAnswer.answer}</div>
              <button
                type="button"
                aria-label="回答を閉じる"
                onClick={() => setQaAnswer(null)}
                style={{ padding: '2px', color: 'var(--ns-text-muted)' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Bottom Question Input + Generate Summary Button (when summary empty) */}
        <div className="note-composer-wrap">
          {!note.summary.trim() && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!llmConfigured || aiBusy}
                onClick={async () => {
                  setAiBusy(true);
                  setAiError(null);
                  try {
                    await onSummarize(note.id);
                    setActiveTab('summary');
                  } catch (err) {
                    setAiError(String(err));
                  } finally {
                    setAiBusy(false);
                  }
                }}
              >
                <Sparkles size={14} strokeWidth={1.75} />
                {aiBusy ? '要約を生成中...' : '要約を生成'}
              </button>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className={`tab-btn ${chatScope === 'note' ? 'active' : ''}`}
                  onClick={() => setChatScope('note')}
                >
                  このノート
                </button>
                <button
                  type="button"
                  className={`tab-btn ${chatScope === 'space' ? 'active' : ''}`}
                  onClick={() => setChatScope('space')}
                >
                  {activeFolder.name}全体
                </button>
              </div>
            </div>
          )}
          <div className="note-composer-box">
            <textarea
              aria-label="ノートについて何でも質問"
              className="note-composer-input"
              rows={1}
              placeholder="ノートについて何でも質問"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleQuestionKeyDown}
            />
            <button
              type="button"
              className="note-send-btn"
              aria-label="質問を送信"
              disabled={!question.trim() || aiBusy}
              onClick={handleAskQuestion}
            >
              <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <div className="note-consent-note">
            <Shield size={13} strokeWidth={1.75} aria-hidden="true" />
            <span>他の人を録音するときは必ず同意を得てください</span>
          </div>
        </div>
        </>
        )}
      </div>

      {/* Re-record Confirmation Dialog */}
      {rerecordConfirmOpen && (
        <div
          className="note-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rerecord-dialog-title"
        >
          <div className="note-dialog">
            <h2 id="rerecord-dialog-title" className="section-title">
              録音をやり直しますか？
            </h2>
            <p style={{ margin: 0, color: 'var(--ns-text-secondary)' }}>
              既存の文字起こしは保持したまま、新しい録音内容を末尾に追記します。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRerecordConfirmOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRerecordConfirmOpen(false);
                  void beginRecording();
                }}
              >
                やり直す
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
};
