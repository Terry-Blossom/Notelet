import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Folder as FolderIcon,
  MessageSquare,
  Plus,
  Search,
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
  onCreateManualNote,
  onSaveFolder,
  onDeleteFolder,
  onChatSpace,
  onGoSettings,
}) => {
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(
    now.toISOString().slice(0, 10)
  );
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newSpaceName, setNewSpaceName] = useState('');

  const [chatQuestion, setChatQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState<ChatAnswer | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const llmConfigured = settings.llm_provider !== 'none' && settings.llm_provider !== '';

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

  const handleAddSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpaceName.trim()) return;
    await onSaveFolder({
      id: crypto.randomUUID(),
      name: newSpaceName.trim(),
      is_shared: false,
      permission: 'owner',
    });
    setNewSpaceName('');
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim()) return;
    setChatBusy(true);
    setChatError(null);
    try {
      const targetSpace = selectedSpaceId === 'all' ? null : selectedSpaceId;
      const targetIds = notes
        .filter((n) => !targetSpace || n.folder_id === targetSpace)
        .map((n) => n.id);
      const res = await onChatSpace(targetIds, chatQuestion, targetSpace);
      setChatAnswer(res);
    } catch (err) {
      setChatError(String(err));
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header + Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <h1 className="page-title">ホーム</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, maxWidth: '520px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} strokeWidth={1.5} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="search"
              className="input"
              style={{ paddingLeft: '32px' }}
              placeholder="ノートを検索（空欄時は選択日のノートを表示）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onCreateManualNote(selectedSpaceId === 'all' ? 'personal' : selectedSpaceId)}
          >
            <Plus size={15} strokeWidth={1.5} />
            新規ノート
          </button>
        </div>
      </div>

      {/* Calendar + Spaces */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
        {/* Calendar */}
        <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
              <CalendarIcon size={16} strokeWidth={1.5} />
              <span>{calYear}年 {calMonth + 1}月</span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                aria-label="前月"
                className="btn btn-ghost"
                onClick={() => {
                  if (calMonth === 0) {
                    setCalYear((y) => y - 1);
                    setCalMonth(11);
                  } else {
                    setCalMonth((m) => m - 1);
                  }
                }}
              >
                <ChevronLeft size={16} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="翌月"
                className="btn btn-ghost"
                onClick={() => {
                  if (calMonth === 11) {
                    setCalYear((y) => y + 1);
                    setCalMonth(0);
                  } else {
                    setCalMonth((m) => m + 1);
                  }
                }}
              >
                <ChevronRight size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div className="calendar-grid">
            {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
              <div key={w} className="text-muted" style={{ textAlign: 'center' }}>{w}</div>
            ))}
            {calendarCells.map((day, idx) => {
              if (!day) return <div key={`e-${idx}`} />;
              const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const hasNotes = noteDates.has(key);
              const isSelected = selectedDateKey === key && !searchQuery.trim();
              return (
                <button
                  key={key}
                  type="button"
                  className={`calendar-day ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedDateKey((prev) => (prev === key ? '' : key));
                  }}
                >
                  <span className="mono-num">{day}</span>
                  {hasNotes && <span className="calendar-day-dot" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Spaces */}
        <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="section-title">スペース</h2>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelectedSpaceId('all')}
            >
              すべて表示
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {folders.map((f) => {
              const count = notes.filter((n) => n.folder_id === f.id).length;
              const active = selectedSpaceId === f.id;
              return (
                <div
                  key={f.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    backgroundColor: active ? 'var(--accent-tint)' : 'var(--bg-subtle)',
                  }}
                >
                  <button
                    type="button"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, textAlign: 'left', fontWeight: active ? 600 : 400 }}
                    onClick={() => setSelectedSpaceId(active ? 'all' : f.id)}
                  >
                    <FolderIcon size={15} strokeWidth={1.5} />
                    <span>{f.name}</span>
                    <span className="mono-num text-muted">({count})</span>
                  </button>
                  {f.id !== 'personal' && (
                    <button
                      type="button"
                      aria-label={`${f.name}を削除`}
                      className="btn btn-ghost"
                      onClick={() => onDeleteFolder(f.id)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <form onSubmit={handleAddSpace} style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
            <input
              type="text"
              className="input"
              placeholder="新しいスペース名"
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" disabled={!newSpaceName.trim()}>
              追加
            </button>
          </form>
        </section>
      </div>

      {/* Filtered Notes List */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-title">
            {searchQuery.trim()
              ? `検索結果 (${filteredNotes.length})`
              : selectedDateKey
                ? `${selectedDateKey} のノート (${filteredNotes.length})`
                : `すべてのノート (${filteredNotes.length})`}
          </h2>
          {selectedDateKey && !searchQuery.trim() && (
            <button type="button" className="btn btn-ghost" onClick={() => setSelectedDateKey('')}>
              日付絞り込みを解除
            </button>
          )}
        </div>

        {filteredNotes.length === 0 ? (
          <div className="surface-subtle text-secondary">
            表示するノートはありません。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredNotes.slice(0, 12).map((note) => (
              <button
                key={note.id}
                type="button"
                className="surface-card"
                onClick={() => onOpenNote(note.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  padding: '12px 16px',
                  textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{note.title || '無題のノート'}</div>
                  <div className="text-muted">
                    {formatDateTime(note.created_at)} · <span className="mono-num">{formatMs(note.duration_sec * 1000)}</span>
                  </div>
                </div>
                <NotionSyncBadge status={note.notion_sync.status} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Embedded Quick AI Chat */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-title">
            AIチャット（{selectedSpaceId === 'all' ? '全スペース' : folders.find((f) => f.id === selectedSpaceId)?.name || 'スペース'}）
          </h2>
          {!llmConfigured && (
            <button type="button" className="btn btn-secondary" onClick={onGoSettings}>
              AI設定を開く
            </button>
          )}
        </div>

        <form onSubmit={handleChat} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input"
            placeholder={llmConfigured ? 'スペース内のノートについて質問' : '設定からLLMを登録すると質問できます'}
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!llmConfigured || chatBusy || notes.length === 0}>
            <MessageSquare size={15} strokeWidth={1.5} />
            {chatBusy ? '回答中' : '質問'}
          </button>
        </form>

        {chatError && (
          <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {chatError}
          </div>
        )}

        {chatAnswer && (
          <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{chatAnswer.answer}</div>
            {chatAnswer.citations.map((c, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', height: 'auto', padding: '4px 8px' }}
                onClick={() => onOpenNote(c.note_id)}
              >
                <span className="mono-num">[{c.timestamp}]</span> {c.note_title}: {c.excerpt}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
