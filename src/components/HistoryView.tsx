import React, { useMemo, useState } from 'react';
import { Search, Trash2, Calendar, FileText } from 'lucide-react';
import { Folder, Note } from '../types';
import { formatDateTime, formatMs } from '../lib/format';
import { NotionSyncBadge } from './NotionSyncBadge';

interface HistoryViewProps {
  notes: Note[];
  folders: Folder[];
  onOpenNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => Promise<void>;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  notes,
  folders,
  onOpenNote,
  onDeleteNote,
}) => {
  const [query, setQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [auxMode, setAuxMode] = useState<'list' | 'brief'>('list');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sp = speakerFilter.trim().toLowerCase();
    return notes.filter((n) => {
      if (selectedFolderId !== 'all' && n.folder_id !== selectedFolderId) return false;
      if (dateFrom && n.created_at.slice(0, 10) < dateFrom) return false;
      if (sp) {
        const hasSpeaker =
          n.participants.some((p) => p.toLowerCase().includes(sp)) ||
          n.segments.some((s) => s.speaker.toLowerCase().includes(sp));
        if (!hasSpeaker) return false;
      }
      if (q) {
        const hay = [
          n.title,
          n.summary,
          n.manual_notes,
          ...n.tags,
          ...n.segments.map((s) => s.text),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notes, query, selectedFolderId, speakerFilter, dateFrom]);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={`chip-filter ${selectedFolderId === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedFolderId('all')}
          >
            すべて ({notes.length})
          </button>
          {folders.map((folder) => {
            const count = notes.filter((n) => n.folder_id === folder.id).length;
            return (
              <button
                key={folder.id}
                type="button"
                className={`chip-filter ${selectedFolderId === folder.id ? 'active' : ''}`}
                onClick={() => setSelectedFolderId(folder.id)}
              >
                {folder.name} ({count})
              </button>
            );
          })}
        </div>

        <div className="tabs-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <button
            type="button"
            className={`tab-btn ${auxMode === 'list' ? 'active' : ''}`}
            onClick={() => setAuxMode('list')}
          >
            ノート一覧
          </button>
          <button
            type="button"
            className={`tab-btn ${auxMode === 'brief' ? 'active' : ''}`}
            onClick={() => setAuxMode('brief')}
          >
            会議前ブリーフ
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
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
            aria-label="ノートを検索"
            className="input"
            style={{ paddingLeft: '36px', borderRadius: '999px', backgroundColor: 'var(--bg-subtle)' }}
            placeholder="キーワード、決定事項、文字起こしを検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <input
          aria-label="話者で絞り込み"
          className="input"
          style={{ width: '160px' }}
          placeholder="話者名"
          value={speakerFilter}
          onChange={(e) => setSpeakerFilter(e.target.value)}
        />
        <input
          aria-label="開始日で絞り込み"
          type="date"
          className="input"
          style={{ width: '160px' }}
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
      </div>

      {auxMode === 'list' ? (
        filteredNotes.length === 0 ? (
          <div style={{ padding: '32px 0', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
            <FileText size={24} strokeWidth={1.5} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
            <p className="text-secondary" style={{ margin: 0 }}>
              条件に一致するノートはありません
            </p>
          </div>
        ) : (
          <div className="flat-list">
            {filteredNotes.map((note) => {
              const folderName = folders.find((f) => f.id === note.folder_id)?.name ?? '個人';
              return (
                <div key={note.id} className="flat-row">
                  <button
                    type="button"
                    onClick={() => onOpenNote(note.id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {note.title}
                      </strong>
                      <span className="status-chip">{folderName}</span>
                    </div>
                    <p
                      className="text-secondary"
                      style={{
                        margin: 0,
                        fontSize: '14px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {note.summary || note.segments[0]?.text || note.manual_notes || '文字起こしなし'}
                    </p>
                    <span className="text-muted mono-num">
                      {formatDateTime(note.created_at)} ・ {formatMs(note.duration_sec * 1000)} ・ {note.segments.length} セグメント
                    </span>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {confirmDeleteId === note.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ height: '28px', padding: '0 12px', fontSize: '12px' }}
                          onClick={async () => {
                            await onDeleteNote(note.id);
                            setConfirmDeleteId(null);
                          }}
                        >
                          削除する
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ height: '28px', padding: '0 8px', fontSize: '12px' }}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          キャンセル
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`${note.title}を削除`}
                        className="btn btn-ghost"
                        style={{ height: '28px', width: '28px', padding: 0 }}
                        onClick={() => setConfirmDeleteId(note.id)}
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    )}
                    <NotionSyncBadge status={note.notion_sync.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="flat-list">
          {filteredNotes.slice(0, 6).map((note) => (
            <div key={note.id} className="flat-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={14} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                  <strong style={{ fontSize: '14px', fontWeight: 500 }}>{note.title}</strong>
                  <span className="text-muted mono-num">{formatDateTime(note.created_at)}</span>
                </div>
                <p className="text-secondary" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {note.summary || '要約はまだありません'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '28px', fontSize: '12px', flexShrink: 0 }}
                onClick={() => onOpenNote(note.id)}
              >
                開く
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
