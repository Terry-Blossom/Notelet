import React, { useMemo, useState } from 'react';
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileText,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppSettings, ChatAnswer, Folder, Note } from '../types';
import { findNoteSearchMatches, formatDateTime, formatMs } from '../lib/format';
import { NotionSyncBadge } from './NotionSyncBadge';
import { confirmDeleteDialog } from './ConfirmDialog';

interface HomeViewProps {
  settings: AppSettings;
  notes: Note[];
  folders: Folder[];
  onOpenNote: (noteId: string, searchQuery?: string) => void;
  onDeleteNote?: (noteId: string) => Promise<void> | void;
  onSaveNote?: (note: Note) => Promise<void>;
  onCreateManualNote: (folderId?: string) => void;
  onUploadFile?: (file: File) => Promise<void>;
  onSaveFolder: (folder: Folder) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onChatSpace: (noteIds: string[], question: string, spaceId?: string | null) => Promise<ChatAnswer>;
  onGoSettings: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  settings,
  notes,
  folders,
  onOpenNote,
  onDeleteNote,
  onSaveNote,
  onCreateManualNote,
  onUploadFile,
  onGoSettings,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string>('');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ noteId: string; x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const noteDates = useMemo(() => {
    const map = new Set<string>();
    for (const n of notes) {
      if (n.created_at) map.add(n.created_at.slice(0, 10));
    }
    return map;
  }, [notes]);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [calYear, calMonth]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((n) => {
      if (selectedSpaceId !== 'all' && n.folder_id !== selectedSpaceId) return false;
      if (q) {
        const hay = [
          n.title,
          n.summary,
          n.manual_notes,
          ...(n.tags ?? []),
          ...n.segments.map((s) => s.text),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      } else if (selectedDateKey) {
        if (!n.created_at.startsWith(selectedDateKey)) return false;
      }
      return true;
    }).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }, [notes, selectedSpaceId, searchQuery, selectedDateKey]);

  const openActionItems = useMemo(() => {
    const items: Array<{ note: Note; index: number; text: string; assignee?: string | null }> = [];
    for (const note of notes) {
      if (selectedSpaceId !== 'all' && note.folder_id !== selectedSpaceId) continue;
      (note.action_items ?? []).forEach((item, idx) => {
        if (!item.done && item.text.trim()) {
          items.push({ note, index: idx, text: item.text, assignee: item.assignee });
        }
      });
    }
    return items.slice(0, 12);
  }, [notes, selectedSpaceId]);

  const shiftMonth = (delta: number) => {
    const d = new Date(calYear, calMonth + delta, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  };

  const activeSpaceName =
    selectedSpaceId === 'all'
      ? 'すべてのスペース'
      : folders.find((f) => f.id === selectedSpaceId)?.name ?? 'スペース';

  return (
    <div className="page-container">
      <div className="home-grid">
        {/* Main Column: Search + Space Chips + Notes + Quick AI Chat */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search
                  size={15}
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
                  className="input"
                  style={{ paddingLeft: '36px', borderRadius: '999px', backgroundColor: 'var(--bg-subtle)' }}
                  placeholder="ノートを検索（タイトル・要約・メモ・文字起こし）"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {onUploadFile && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,video/*,.wav,.mp3,.m4a,.mp4,.mov,.webm,.ogg,.flac"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        void onUploadFile(f);
                        e.target.value = '';
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} strokeWidth={1.5} />
                    音声インポート
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onCreateManualNote(selectedSpaceId === 'all' ? 'personal' : selectedSpaceId)}
              >
                <Plus size={14} strokeWidth={1.5} />
                メモを作成
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className={`chip-filter ${selectedSpaceId === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedSpaceId('all')}
              >
                すべて ({notes.length})
              </button>
              {folders.map((f) => {
                const count = notes.filter((n) => n.folder_id === f.id).length;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`chip-filter ${selectedSpaceId === f.id ? 'active' : ''}`}
                    onClick={() => setSelectedSpaceId(f.id)}
                  >
                    {f.name} ({count})
                  </button>
                );
              })}
              {selectedDateKey && !searchQuery.trim() && (
                <button
                  type="button"
                  className="chip-filter"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setSelectedDateKey('')}
                >
                  {selectedDateKey} ×
                </button>
              )}
            </div>
          </div>

          <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="section-title">
                {searchQuery.trim()
                  ? `検索結果 (${filteredNotes.length})`
                  : selectedDateKey
                  ? `${selectedDateKey} のノート (${filteredNotes.length})`
                  : `最近のノート (${filteredNotes.length})`}
              </h2>
              <span className="text-muted">{activeSpaceName}</span>
            </div>

            {filteredNotes.length === 0 ? (
              <div style={{ padding: '24px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-muted" style={{ margin: '0px' }}>
                  該当するノートはありません。
                </p>
              </div>
            ) : (
              <div className="flat-list">
                {filteredNotes.map((note) => {
                  const spaceName = folders.find((f) => f.id === note.folder_id)?.name ?? '個人';
                  const matches = searchQuery.trim() ? findNoteSearchMatches(note, searchQuery) : [];
                  return (
                    <button
                      key={note.id}
                      type="button"
                      className="flat-row"
                      onClick={() => onOpenNote(note.id, searchQuery.trim() || undefined)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ noteId: note.id, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {note.pinned && (
                            <Pin size={12} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          )}
                          <strong style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                            {note.title.trim() || '無題のノート'}
                          </strong>
                          {(note.tags ?? []).slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="status-chip"
                              style={{ fontSize: '10px', padding: '2px 8px' }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <span className="text-muted mono-num">
                          {formatDateTime(note.created_at)} ・ {formatMs(note.duration_sec * 1000)} ・ {spaceName}
                        </span>
                        {matches.length > 0 && (
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
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <NotionSyncBadge status={note.notion_sync.status} pageUrl={note.notion_sync.page_url} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {openActionItems.length > 0 && (
            <section className="surface-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckSquare size={15} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
                  未完了アクションアイテム ({openActionItems.length})
                </h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {openActionItems.map(({ note, index, text, assignee }) => (
                  <div
                    key={`${note.id}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      padding: '8px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-subtle)',
                      fontSize: '13px',
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, cursor: onSaveNote ? 'pointer' : 'default' }}>
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={!onSaveNote}
                        onChange={() => {
                          if (!onSaveNote) return;
                          const nextItems = (note.action_items ?? []).map((it, i) =>
                            i === index ? { ...it, done: true } : it
                          );
                          void onSaveNote({ ...note, action_items: nextItems });
                        }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {text}
                      </span>
                      {assignee && (
                        <span className="text-muted" style={{ fontSize: '11px', flexShrink: 0 }}>
                          {assignee}
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                      onClick={() => onOpenNote(note.id)}
                    >
                      {note.title.trim() || '無題'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Rail: Calendar + Engine Summary */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section className="surface-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong className="mono-num">
                {calYear}年 {calMonth + 1}月
              </strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  aria-label="前月"
                  className="btn btn-ghost"
                  style={{ width: '28px', height: '28px', padding: 0 }}
                  onClick={() => shiftMonth(-1)}
                >
                  <ChevronLeft size={14} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label="翌月"
                  className="btn btn-ghost"
                  style={{ width: '28px', height: '28px', padding: 0 }}
                  onClick={() => shiftMonth(1)}
                >
                  <ChevronRight size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="calendar-grid">
              {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                <div
                  key={w}
                  style={{
                    textAlign: 'center',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    paddingBottom: '4px',
                  }}
                >
                  {w}
                </div>
              ))}
              {calendarCells.map((day, idx) => {
                if (day === null) return <div key={`empty-${idx}`} />;
                const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = selectedDateKey === key;
                const hasNote = noteDates.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`calendar-day ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedDateKey((prev) => (prev === key ? '' : key))}
                  >
                    <span className="mono-num">{day}</span>
                    {hasNote && <span className="calendar-day-dot" />}
                  </button>
                );
              })}
            </div>

            {selectedDateKey && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: '28px', fontSize: '12px', alignSelf: 'flex-start', padding: '0 8px' }}
                onClick={() => setSelectedDateKey('')}
              >
                すべての日付を表示
              </button>
            )}
          </section>

          <section className="surface-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={14} strokeWidth={1.5} />
                <strong style={{ fontSize: '12px' }}>エンジン</strong>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: '24px', padding: '0 8px', fontSize: '12px' }}
                onClick={onGoSettings}
              >
                <Settings size={12} strokeWidth={1.5} />
                変更
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span className="text-muted" style={{ flexShrink: 0 }}>ASR</span>
                <span
                  className="mono-num"
                  title={settings.active_asr_model_id || 'モデル未選択'}
                  style={{
                    fontWeight: 500,
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                  }}
                >
                  {settings.active_asr_model_id || 'モデル未選択'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span className="text-muted" style={{ flexShrink: 0 }}>LLM</span>
                {(() => {
                  const rawLlm =
                    settings.llm_provider === 'none'
                      ? '未設定'
                      : settings.llm_model || settings.llm_provider;
                  const shortLlm = rawLlm.includes('/') ? rawLlm.split('/').pop() || rawLlm : rawLlm;
                  return (
                    <span
                      className="mono-num"
                      title={rawLlm}
                      style={{
                        fontWeight: 500,
                        maxWidth: '160px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'right',
                      }}
                    >
                      {shortLlm}
                    </span>
                  );
                })()}
              </div>
            </div>
          </section>
        </aside>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          role="menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            role="menuitem"
            onClick={() => {
              const id = contextMenu.noteId;
              setContextMenu(null);
              onOpenNote(id);
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
                const id = contextMenu.noteId;
                setContextMenu(null);
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
