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
  LayoutGrid,
  Link2,
  List,
  Lock,
  Menu,
  Mic,
  Pause,
  Play,
  Plus,
  Send,
  Shield,
  Sparkles,
  Upload,
  UploadCloud,
  Users,
  Video,
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
  formatMonthDay,
  formatNoteForCopy,
  formatNoteTimer,
} from '../lib/format';
import { NoteWaveform } from './NoteWaveform';

export type NotePhase = 'idle' | 'recording' | 'processing' | 'completed';

interface NoteEditorViewProps {
  note: Note;
  folders?: Folder[];
  settings: AppSettings;
  recipes: Recipe[];
  secretStatus: SecretStatus | null;
  transcribing: boolean;
  transcribeError: string | null;
  recordingStatus?: RecordingStatus;
  onStartRecording?: () => Promise<void> | void;
  onStopRecording?: () => Promise<void> | void;
  onUpdateNote: (note: Note) => void;
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
  folders = [{ id: 'personal', name: '個人', is_shared: false, permission: 'owner' }],
  settings,
  secretStatus,
  transcribing,
  transcribeError,
  recordingStatus,
  onStartRecording,
  onStopRecording,
  onUpdateNote,
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
  const [selectedNav, setSelectedNav] = useState<'private' | 'personal' | 'note' | 'meeting' | 'video'>('note');

  // Inline title editing with Enter confirm / Esc cancel
  const [titleDraft, setTitleDraft] = useState(note.title);
  const titleSnapshotRef = useRef(note.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleDraft(note.title);
    titleSnapshotRef.current = note.title;
  }, [note.id, note.title]);

  // Tabs
  const [activeTab, setActiveTab] = useState<'transcript' | 'notes'>('transcript');
  const [hasUnreadTranscript, setHasUnreadTranscript] = useState(false);
  const transcriptTabRef = useRef<HTMLButtonElement>(null);
  const notesTabRef = useRef<HTMLButtonElement>(null);

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
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);

  // Notes tab inline editing
  const [editingManualNotes, setEditingManualNotes] = useState(false);
  const manualNotesRef = useRef<HTMLTextAreaElement>(null);

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
    if (isRecording && liveSegments.length > 0) {
      return [...note.segments, ...liveSegments];
    }
    return note.segments;
  }, [isRecording, liveSegments, note.segments]);

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
      if (activeTab === 'notes' && phase === 'recording') {
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
    setLiveSegments([]);
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
        liveSegments.length > 0
          ? liveSegments
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
      setLiveSegments([]);
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

  const handleTabKeyDown = (e: React.KeyboardEvent, current: 'transcript' | 'notes') => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = current === 'transcript' ? 'notes' : 'transcript';
      setActiveTab(next);
      if (next === 'transcript') {
        setHasUnreadTranscript(false);
        transcriptTabRef.current?.focus();
      } else {
        notesTabRef.current?.focus();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab('transcript');
      setHasUnreadTranscript(false);
      transcriptTabRef.current?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab('notes');
      notesTabRef.current?.focus();
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
      const res = await onChatNote([note.id], q);
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

  const hasNotesContent =
    Boolean(note.summary.trim()) ||
    Boolean(note.manual_notes.trim()) ||
    note.decisions.length > 0 ||
    note.action_items.length > 0;

  return (
    <div className="note-shell">
      {/* Mobile drawer backdrop */}
      <div
        className={`note-sidebar-backdrop ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar (272px) */}
      <aside
        className={`note-sidebar ${drawerOpen ? 'drawer-open' : ''}`}
        aria-label="テンプレートとアクション"
      >
        <div className="note-sidebar-heading">
          <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="note-sidebar-heading-text">テンプレートとアクション</span>
        </div>

        <nav className="note-sidebar-list" aria-label="ノート階層">
          <button
            type="button"
            className={`note-sidebar-item ${selectedNav === 'private' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedNav('private');
              setDrawerOpen(false);
            }}
            title="プライベート"
          >
            <Lock size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="note-sidebar-item-label">プライベート</span>
          </button>

          <button
            type="button"
            className={`note-sidebar-item ${selectedNav === 'personal' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedNav('personal');
              setDrawerOpen(false);
            }}
            title="個人"
          >
            <FolderIcon size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="note-sidebar-item-label">個人</span>
          </button>

          <button
            type="button"
            className={`note-sidebar-item indent ${selectedNav === 'note' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedNav('note');
              setDrawerOpen(false);
            }}
            aria-current="page"
            title={note.title.trim() || '無題のノート'}
          >
            <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="note-sidebar-item-label">
              {note.title.trim() || '無題のノート'}
            </span>
          </button>

          <button
            type="button"
            className={`note-sidebar-item ${selectedNav === 'meeting' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedNav('meeting');
              setDrawerOpen(false);
            }}
            title="ミーティング"
          >
            <Users size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="note-sidebar-item-label">ミーティング</span>
          </button>

          <button
            type="button"
            className={`note-sidebar-item ${selectedNav === 'video' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedNav('video');
              setDrawerOpen(false);
            }}
            title="ビデオ"
          >
            <Video size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="note-sidebar-item-label">ビデオ</span>
          </button>
        </nav>

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
            <span className="note-meta-pill" style={{ cursor: 'default' }}>
              <Calendar size={15} strokeWidth={1.75} color="#5F5F5F" aria-hidden="true" />
              <span>{formatMonthDay(note.created_at)}</span>
            </span>

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
                  <form onSubmit={handleAddParticipant} style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      className="input"
                      style={{ height: '32px', fontSize: '13px' }}
                      placeholder="参加者名を入力"
                      value={newParticipant}
                      onChange={(e) => setNewParticipant(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      style={{ height: '32px', padding: '0 10px' }}
                    >
                      追加
                    </button>
                  </form>
                  {note.participants.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {note.participants.map((p) => (
                        <span
                          key={p}
                          className="note-meta-pill"
                          style={{ height: '28px', padding: '0 10px', fontSize: '12px' }}
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
              ref={notesTabRef}
              type="button"
              role="tab"
              aria-selected={activeTab === 'notes'}
              className={`note-tab ${activeTab === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveTab('notes')}
              onKeyDown={(e) => handleTabKeyDown(e, 'notes')}
            >
              <List size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>あなたのノート</span>
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
              gap: '6px',
              fontSize: '13px',
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
              fontSize: '13px',
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
                    会話がここに表示されます...
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

            {activeTab === 'notes' && (
              <div className="note-notes-tab">
                {!hasNotesContent && !editingManualNotes ? (
                  <div className="note-empty-state" style={{ flexDirection: 'column', gap: '8px' }}>
                    <span>メモはまだありません</span>
                    <button
                      type="button"
                      className="note-inline-link"
                      onClick={() => {
                        setEditingManualNotes(true);
                        setTimeout(() => manualNotesRef.current?.focus(), 0);
                      }}
                    >
                      メモを追記
                    </button>
                  </div>
                ) : (
                  <>
                    {(note.summary.trim() || llmConfigured) && (
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
                        {note.summary.trim() ? (
                          <p style={{ margin: 0, fontSize: '15px', lineHeight: '26px' }}>
                            {note.summary}
                          </p>
                        ) : (
                          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ns-text-muted)' }}>
                            要約はまだ生成されていません。
                          </p>
                        )}
                      </section>
                    )}

                    {(note.decisions.length > 0 || note.action_items.length > 0) && (
                      <section className="note-card">
                        <h2 className="note-card-title">メモ・アクション</h2>
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '15px', lineHeight: '26px' }}>
                          {note.decisions.map((d, i) => (
                            <li key={`d-${i}`}>{d}</li>
                          ))}
                          {note.action_items.map((a) => (
                            <li key={a.id}>
                              {a.text}
                              {a.assignee ? `（${a.assignee}）` : ''}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    <section className="note-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 className="note-card-title">手入力メモ</h2>
                        {!editingManualNotes && (
                          <button
                            type="button"
                            className="note-inline-link"
                            onClick={() => {
                              setEditingManualNotes(true);
                              setTimeout(() => manualNotesRef.current?.focus(), 0);
                            }}
                          >
                            <Plus size={13} style={{ verticalAlign: 'middle', marginRight: '2px' }} />
                            編集
                          </button>
                        )}
                      </div>
                      <textarea
                        ref={manualNotesRef}
                        aria-label="手入力メモ"
                        className="textarea"
                        value={note.manual_notes}
                        onChange={(e) =>
                          onUpdateNote({
                            ...note,
                            manual_notes: e.target.value,
                            updated_at: new Date().toISOString(),
                          })
                        }
                        placeholder="メモを入力..."
                      />
                    </section>
                  </>
                )}

                {!llmConfigured && (
                  <section className="note-card" style={{ backgroundColor: 'var(--ns-bg-sidebar)' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>LLMが未設定です</div>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--ns-text-secondary)' }}>
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
                  <div style={{ fontSize: '13px', color: 'var(--danger)' }}>{aiError}</div>
                )}
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

        {/* Bottom Question Input + Consent Notice */}
        <div className="note-composer-wrap">
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
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--ns-text-secondary)' }}>
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
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--ns-text-secondary)' }}>
              {note.notion_sync.page_id
                ? '既存ページを更新（重複ページを作成しません）'
                : '新規ページを作成'}
            </p>
            {!notionReady && (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--danger)' }}>
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
