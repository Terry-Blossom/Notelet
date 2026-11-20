import React, { useMemo, useState } from 'react';
import { Search, Trash2, FileText } from 'lucide-react';
import { Folder, Note } from '../types';
import { formatDateTime, formatMs } from '../lib/format';
import { NotionSyncBadge } from './NotionSyncBadge';

interface HistoryViewProps {
  notes: Note[];
  folders: Folder[];
  recordingNoteId?: string | null;
  onOpenNote: (noteId: string) => void;
  onCreateManualNote?: (folderId?: string) => void;
  onSaveFolder?: (folder: Folder) => Promise<void>;
  onDeleteFolder?: (folderId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  notes,
  folders,
  recordingNoteId = null,
  onOpenNote,
  onDeleteNote,
}) => {
  const [query, setQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (selectedFolderId !== 'all' && n.folder_id !== selectedFolderId) return false;
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
  }, [notes, query, selectedFolderId]);

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

        <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
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
      </div>

      {filteredNotes.length === 0 ? (
        <div style={{ padding: '32px 0', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
          <FileText size={24} strokeWidth={1.5} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
          <p className="text-secondary" style={{ margin: '0px' }}>
            条件に一致するノートはありません
          </p>
        </div>
      ) : (
        <div className="flat-list">
          {filteredNotes.map((note) => {
            const folderName = folders.find((f) => f.id === note.folder_id)?.name ?? '個人';
            const displayTitle = note.title.trim() || '無題のノート';
            const isNoteRec = recordingNoteId === note.id;
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
                    <FileText size={14} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
                    <strong style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {displayTitle}
                    </strong>
                    <span className="status-chip">{folderName}</span>
                    {isNoteRec && <span className="status-chip danger">録音中</span>}
                  </div>
                  <p
                    className="text-secondary"
                    style={{
                      margin: '0px',
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
                      aria-label={`${displayTitle}を削除`}
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
      )}
    </div>
  );
};
