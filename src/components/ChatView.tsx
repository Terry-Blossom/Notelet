import React, { useMemo, useState } from 'react';
import { MessageSquare, AlertCircle, Search, Trash2 } from 'lucide-react';
import { AppSettings, ChatAnswer, ChatHistoryItem, Folder, Note } from '../types';
import { formatDateTime } from '../lib/format';
import { StreamingMarkdownArticle } from './StreamingMarkdownArticle';

interface ChatViewProps {
  notes: Note[];
  folders: Folder[];
  chatHistory: ChatHistoryItem[];
  settings: AppSettings;
  onChatAcrossNotes: (noteIds: string[], question: string, spaceId?: string | null) => Promise<ChatAnswer>;
  onClearHistory: () => Promise<void>;
  onOpenNote: (noteId: string) => void;
  onGoSettings: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  notes,
  folders,
  chatHistory,
  settings,
  onChatAcrossNotes,
  onClearHistory,
  onOpenNote,
  onGoSettings,
}) => {
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('all');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<ChatAnswer | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');

  const llmConfigured = settings.llm_provider !== 'none' && settings.llm_provider !== '';

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return chatHistory.filter((item) => {
      if (selectedSpaceId !== 'all' && item.space_id !== selectedSpaceId) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
      );
    });
  }, [chatHistory, historyQuery, selectedSpaceId]);

  const activeHistoryItem = useMemo(
    () => filteredHistory.find((h) => h.id === selectedHistoryId) ?? null,
    [filteredHistory, selectedHistoryId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setSelectedHistoryId(null);
    try {
      const spaceId = selectedSpaceId === 'all' ? null : selectedSpaceId;
      const targetIds = notes
        .filter((n) => !spaceId || n.folder_id === spaceId)
        .map((n) => n.id);
      const res = await onChatAcrossNotes(targetIds, question, spaceId);
      setAnswer(res);
      setQuestion('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activeSpaceName =
    selectedSpaceId === 'all'
      ? 'すべてのスペース'
      : folders.find((f) => f.id === selectedSpaceId)?.name ?? 'スペース';

  const displayedAnswer = activeHistoryItem
    ? { answer: activeHistoryItem.answer, citations: activeHistoryItem.citations }
    : answer;

  return (
    <div className="chat-split">
      {/* Left Rail: Searchable Conversation History */}
      <aside className="chat-history-rail">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '14px', fontWeight: 600 }}>会話履歴 ({filteredHistory.length})</strong>
          {chatHistory.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: '24px', padding: '0 8px', fontSize: '12px' }}
              onClick={onClearHistory}
            >
              <Trash2 size={12} strokeWidth={1.5} />
              削除
            </button>
          )}
        </div>

        <div style={{ position: 'relative' }}>
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
            aria-label="会話履歴を検索"
            className="input"
            style={{ height: '32px', paddingLeft: '32px', fontSize: '12px', backgroundColor: 'var(--bg-canvas)' }}
            placeholder="履歴を検索..."
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
          />
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-muted" style={{ margin: '8px 0 0' }}>
            履歴はありません
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredHistory.map((item) => {
              const isSelected = selectedHistoryId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedHistoryId(item.id)}
                  style={{
                    textAlign: 'left',
                    padding: '8px',
                    borderRadius: '6px',
                    backgroundColor: isSelected ? 'var(--accent-tint)' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: isSelected ? 600 : 500,
                      color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.question}
                  </span>
                  <span className="text-muted mono-num" style={{ fontSize: '11px' }}>
                    {formatDateTime(item.timestamp)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* Main Chat Pane */}
      <div className="chat-main-pane">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className={`chip-filter ${selectedSpaceId === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedSpaceId('all')}
          >
            すべて
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip-filter ${selectedSpaceId === f.id ? 'active' : ''}`}
              onClick={() => setSelectedSpaceId(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>

        {!llmConfigured && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} strokeWidth={1.5} style={{ color: 'var(--warning)' }} />
              <span>AIプロバイダが未設定のため、ローカル検索ベースで回答します。</span>
            </div>
            <button type="button" className="btn btn-secondary" style={{ height: '28px', fontSize: '12px' }} onClick={onGoSettings}>
              設定へ
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            aria-label="全ノートへの質問"
            className="input"
            placeholder={`${activeSpaceName} のノートをもとに質問（例：今週決まったタスクは？）`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
            <MessageSquare size={15} strokeWidth={1.5} />
            {busy ? '検索中' : '質問する'}
          </button>
        </form>

        {error && (
          <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>
        )}

        {busy || displayedAnswer ? (
          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {activeHistoryItem && (
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Q. {activeHistoryItem.question}
              </div>
            )}
            <StreamingMarkdownArticle
              content={busy ? '' : displayedAnswer?.answer || ''}
              isGenerating={busy}
              animateOnChange={!activeHistoryItem}
            />
            {!busy && displayedAnswer && displayedAnswer.citations.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                {displayedAnswer.citations.map((c, idx) => (
                  <button
                    key={`${c.note_id}-${idx}`}
                    type="button"
                    className="chip-filter"
                    onClick={() => onOpenNote(c.note_id)}
                  >
                    {c.note_title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '24px 0', color: 'var(--text-muted)' }}>
            上の入力欄から質問するか、左側の履歴から過去の回答を開けます。
          </div>
        )}
      </div>
    </div>
  );
};
