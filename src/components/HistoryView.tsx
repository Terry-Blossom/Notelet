import React, { useMemo, useState } from 'react';
import { Search, Folder as FolderIcon, Trash2, MessageSquare, Calendar, FileText } from 'lucide-react';
import { AppSettings, ChatAnswer, Folder, Note } from '../types';
import { formatDateTime, formatMs } from '../lib/format';

interface HistoryViewProps {
  notes: Note[];
  folders: Folder[];
  settings: AppSettings;
  onOpenNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => Promise<void>;
  onChatAcrossNotes: (noteIds: string[], question: string) => Promise<ChatAnswer>;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  notes,
  folders,
  settings,
  onOpenNote,
  onDeleteNote,
  onChatAcrossNotes,
}) => {
  const [query, setQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [auxMode, setAuxMode] = useState<'list' | 'brief' | 'chat'>('list');
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState<ChatAnswer | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isBasicLimited = settings.plan_tier === 'basic';
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sp = speakerFilter.trim().toLowerCase();
    return notes.filter((n) => {
      if (isBasicLimited) {
        const ts = new Date(n.created_at).getTime();
        if (!Number.isNaN(ts) && ts < thirtyDaysAgo) return false;
      }
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
  }, [notes, query, selectedFolderId, speakerFilter, dateFrom, isBasicLimited, thirtyDaysAgo]);

  const hiddenOldCount = isBasicLimited
    ? notes.filter((n) => new Date(n.created_at).getTime() < thirtyDaysAgo).length
    : 0;

  const llmConfigured = settings.llm_provider !== 'none' && settings.llm_provider !== '';

  const handleCrossChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim()) return;
    setChatBusy(true);
    setChatError(null);
    try {
      const res = await onChatAcrossNotes(
        filteredNotes.map((n) => n.id),
        chatQuestion
      );
      setChatAnswer(res);
    } catch (err) {
      setChatError(String(err));
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">履歴と検索</h1>
          <p className="text-secondary" style={{ margin: '4px 0 0' }}>
            保存されたノートの検索、フォルダ絞り込み、複数会議を横断した確認ができます
          </p>
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
          <button
            type="button"
            className={`tab-btn ${auxMode === 'chat' ? 'active' : ''}`}
            onClick={() => setAuxMode('chat')}
          >
            横断AIチャット
          </button>
        </div>
      </div>

      {isBasicLimited && hiddenOldCount > 0 && (
        <div className="surface-subtle" style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          現在のプラン設定（Basic相当）では直近30日以内のノートを表示しています。30日以前の {hiddenOldCount} 件はローカルに保持されており、削除されません（設定でBusiness以上に切り替えると全期間を表示できます）。
        </div>
      )}

      {auxMode === 'list' && (
        <>
          <section className="surface-card" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) repeat(3, minmax(140px, 1fr))', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} strokeWidth={1.5} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
              <input
                type="search"
                aria-label="キーワード検索"
                className="input"
                style={{ paddingLeft: '32px' }}
                placeholder="タイトル・本文・タグを検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <select
              aria-label="フォルダ絞り込み"
              className="select"
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
            >
              <option value="all">すべてのフォルダ</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              aria-label="話者で絞り込み"
              className="input"
              placeholder="話者名"
              value={speakerFilter}
              onChange={(e) => setSpeakerFilter(e.target.value)}
            />

            <input
              type="date"
              aria-label="開始日"
              className="input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredNotes.length === 0 ? (
              <div className="surface-subtle text-secondary">
                条件に一致するノートはありません。
              </div>
            ) : (
              filteredNotes.map((note) => {
                const folder = folders.find((f) => f.id === note.folder_id);
                return (
                  <div
                    key={note.id}
                    className="surface-card"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '12px 16px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenNote(note.id)}
                      style={{ flex: 1, textAlign: 'left', minWidth: 0 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileText size={16} strokeWidth={1.5} color="var(--text-muted)" />
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {note.title || '無題のノート'}
                        </span>
                        {folder && (
                          <span className="status-chip">
                            <FolderIcon size={12} strokeWidth={1.5} />
                            {folder.name}
                          </span>
                        )}
                      </div>
                      <div className="text-muted" style={{ marginTop: '4px' }}>
                        {formatDateTime(note.created_at)} · <span className="mono-num">{formatMs(note.duration_sec * 1000)}</span> · {note.segments.length} 行
                      </div>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {note.notion_sync.status === 'synced' && (
                        <span className="status-chip ok">Notion済み</span>
                      )}
                      {confirmDeleteId === note.id ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ height: '30px', fontSize: '12px' }}
                            onClick={async () => {
                              await onDeleteNote(note.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            削除確定
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ height: '30px', fontSize: '12px' }}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-label="ノートを削除"
                          className="btn btn-ghost"
                          onClick={() => setConfirmDeleteId(note.id)}
                        >
                          <Trash2 size={15} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </>
      )}

      {auxMode === 'brief' && (
        <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={18} strokeWidth={1.5} />
            <h2 className="section-title">会議前ブリーフ（Business相当機能）</h2>
          </div>
          <p className="text-secondary" style={{ margin: 0 }}>
            Google Calendar / Outlook 連携は現在アダプター枠（未接続）です。過去の関連ノートから直近の決定事項・未完了アクションを一覧できます。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {notes.slice(0, 5).map((n) => (
              <div key={n.id} className="surface-subtle">
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{n.title}</div>
                <div className="text-muted">{formatDateTime(n.created_at)}</div>
                {n.action_items.filter((a) => !a.done).length > 0 && (
                  <div style={{ fontSize: '14px', marginTop: '4px' }}>
                    未完了タスク: {n.action_items.filter((a) => !a.done).map((a) => a.text).join(' / ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {auxMode === 'chat' && (
        <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h2 className="section-title">複数会議を横断するAIチャット</h2>
          {!llmConfigured && (
            <div className="surface-subtle" style={{ color: 'var(--warning)', fontSize: '14px' }}>
              LLMが未設定のため利用できません。設定＞AI・LLM設定からモデルとAPIキーを登録してください。
            </div>
          )}
          <form onSubmit={handleCrossChat} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input"
              placeholder="過去の会議全体から質問（例：前回のリリース日程は？）"
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!llmConfigured || chatBusy}>
              <MessageSquare size={15} strokeWidth={1.5} />
              質問
            </button>
          </form>
          {chatError && (
            <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {chatError}
            </div>
          )}
          {chatAnswer && (
            <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{chatAnswer.answer}</div>
              {chatAnswer.citations.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                  <div className="text-muted" style={{ marginBottom: '4px' }}>根拠となったノート</div>
                  {chatAnswer.citations.map((c, idx) => (
                    <div key={idx} className="text-muted">
                      <strong>{c.note_title}</strong> <span className="mono-num">[{c.timestamp}]</span> {c.excerpt}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
