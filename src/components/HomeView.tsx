import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileText,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { AppSettings, ChatAnswer, Folder, Note } from '../types';
import { formatDateTime, formatMs } from '../lib/format';
import { NotionSyncBadge } from './NotionSyncBadge';

interface HomeViewProps {
  settings: AppSettings;
  notes: Note[];
  folders: Folder[];
  onOpenNote: (noteId: string) => void;
  onDeleteNote?: (noteId: string) => Promise<void> | void;
  onCreateManualNote: (folderId?: string) => void;
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
  onCreateManualNote,
  onGoSettings,
}) => {
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
          ...n.segments.map((s) => s.text),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      } else if (selectedDateKey) {
        if (!n.created_at.startsWith(selectedDateKey)) return false;
      }
      return true;
    });
  }, [notes, selectedSpaceId, searchQuery, selectedDateKey]);

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
                  return (
                    <button
                      key={note.id}
                      type="button"
                      className="flat-row"
                      onClick={() => onOpenNote(note.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ noteId: note.id, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <strong style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {note.title.trim() || '無題のノート'}
                        </strong>
                        <span className="text-muted mono-num">
                          {formatDateTime(note.created_at)} ・ {formatMs(note.duration_sec * 1000)} ・ {spaceName}
                        </span>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <NotionSyncBadge status={note.notion_sync.status} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
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
                  title={settings.active_asr_model_id}
                  style={{
                    fontWeight: 500,
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                  }}
                >
                  {settings.active_asr_model_id}
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
