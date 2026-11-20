import React, { useMemo, useState } from 'react';
import { Search, Trash2, Calendar, FileText, Folder as FolderIcon, Plus } from 'lucide-react';
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
  onCreateManualNote,
  onSaveFolder,
  onDeleteFolder,
  onDeleteNote,
}) => {
  const [query, setQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [auxMode, setAuxMode] = useState<'list' | 'brief'>('list');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

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

  const handleAddFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !onSaveFolder) return;
    const created: Folder = {
      id: crypto.randomUUID(),
      name: newFolderName.trim(),
      is_shared: false,
      permission: 'owner',
    };
    await onSaveFolder(created);
    setSelectedFolderId(created.id);
    setNewFolderName('');
  };

  const activeFolderLabel =
    selectedFolderId === 'all'
      ? 'すべてのノート'
      : folders.find((f) => f.id === selectedFolderId)?.name ?? 'スペース';

  return (
    <div className="chat-split">
      {/* Left Pane: Parent Folders (Spaces) */}
      <aside className="chat-history-rail" aria-label="スペース（親フォルダ）">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FolderIcon size={15} strokeWidth={1.5} />
          <strong style={{ fontSize: '12px', fontWeight: 600 }}>スペース（親フォルダ）</strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button
            type="button"
            className={`nav-item ${selectedFolderId === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedFolderId('all')}
          >
            <FolderIcon size={15} strokeWidth={1.5} />
            <span style={{ flex: 1 }}>すべて</span>
            <span className="text-muted mono-num">{notes.length}</span>
          </button>

          {folders.map((folder) => {
            const count = notes.filter((n) => n.folder_id === folder.id).length;
            const isSelected = selectedFolderId === folder.id;
            return (
              <div
                key={folder.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  borderRadius: '8px',
                  backgroundColor: isSelected ? 'var(--accent-tint)' : 'transparent',
                }}
              >
                <button
                  type="button"
                  className={`nav-item ${isSelected ? 'active' : ''}`}
                  style={{ flex: 1, minWidth: 0 }}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <FolderIcon size={15} strokeWidth={1.5} />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {folder.name}
                  </span>
                  <span className="text-muted mono-num">{count}</span>
                </button>
                {onCreateManualNote && (
                  <button
                    type="button"
                    aria-label={`${folder.name}に新規ノート`}
                    title={`${folder.name}に新規ノート`}
                    className="btn btn-ghost"
                    style={{ width: '24px', height: '24px', padding: 0 }}
                    onClick={() => onCreateManualNote(folder.id)}
                  >
                    <Plus size={13} strokeWidth={1.5} />
                  </button>
                )}
                {onDeleteFolder && folder.id !== 'personal' && (
                  <button
                    type="button"
                    aria-label={`${folder.name}を削除`}
                    title={`${folder.name}を削除`}
                    className="btn btn-ghost"
                    style={{ width: '24px', height: '24px', padding: 0 }}
                    onClick={async () => {
                      await onDeleteFolder(folder.id);
                      if (selectedFolderId === folder.id) {
                        setSelectedFolderId('all');
                      }
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {onSaveFolder && (
          <form onSubmit={handleAddFolder} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <input
              className="input"
              style={{ height: '32px', backgroundColor: 'var(--bg-canvas)' }}
              placeholder="新しい親フォルダ..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ height: '32px', padding: '0 8px' }}
              aria-label="親フォルダを作成"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </form>
        )}
      </aside>

      {/* Right Pane: Child Files (Notes in Selected Space) */}
      <div className="chat-main-pane">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderIcon size={18} strokeWidth={1.5} />
            <h2 className="section-title">{activeFolderLabel}</h2>
            <span className="status-chip">{filteredNotes.length} 件</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onCreateManualNote && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '32px' }}
                onClick={() =>
                  onCreateManualNote(selectedFolderId === 'all' ? 'personal' : selectedFolderId)
                }
              >
                <Plus size={14} strokeWidth={1.5} />
                このフォルダに新規ノート
              </button>
            )}
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
              <p className="text-secondary" style={{ margin: '0px' }}>
                条件に一致するノート（子ファイル）はありません
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
          )
        ) : (
          <div className="flat-list">
            {filteredNotes.slice(0, 6).map((note) => (
              <div key={note.id} className="flat-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={14} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                    <strong style={{ fontWeight: 500 }}>{note.title.trim() || '無題のノート'}</strong>
                    <span className="text-muted mono-num">{formatDateTime(note.created_at)}</span>
                  </div>
                  <p className="text-secondary" style={{ margin: '0px', whiteSpace: 'pre-wrap' }}>
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
    </div>
  );
};
