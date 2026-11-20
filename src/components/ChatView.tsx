import React, { useMemo, useState } from 'react';
import { MessageSquare, AlertCircle, Search, Trash2 } from 'lucide-react';
import { AppSettings, ChatAnswer, ChatHistoryItem, Folder, Note } from '../types';
import { formatDateTime } from '../lib/format';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const spaceId = selectedSpaceId === 'all' ? null : selectedSpaceId;
      const targetIds = notes
        .filter((n) => !spaceId || n.folder_id === spaceId)
        .map((n) => n.id);
      const res = await onChatAcrossNotes(targetIds, question, spaceId);
      setAnswer(res);
      setQuestion('');
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">チャット</h1>
          <p className="text-secondary" style={{ margin: '4px 0 0' }}>
            スペースごとのAI質問と、これまでの会話履歴の検索ができます
          </p>
        </div>

        <select
          aria-label="対象スペース"
          className="select"
          style={{ width: 'auto', minWidth: '180px' }}
          value={selectedSpaceId}
          onChange={(e) => setSelectedSpaceId(e.target.value)}
        >
          <option value="all">すべてのスペース</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {!llmConfigured && (
        <section className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)' }}>
            <AlertCircle size={16} strokeWidth={1.5} />
            <span>LLMが未設定のため利用できません。設定から LLM プロバイダーと API キーを登録してください。</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onGoSettings}>
            AI設定を開く
          </button>
        </section>
      )}

      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input"
            placeholder="スペースや過去のノートについて質問"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!llmConfigured || busy || notes.length === 0}>
            <MessageSquare size={16} strokeWidth={1.5} />
            {busy ? '回答中' : '質問'}
          </button>
        </form>

        {error && (
          <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {answer && (
          <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</div>
            {answer.citations.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="text-muted">根拠となったノート</div>
                {answer.citations.map((c, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onOpenNote(c.note_id)}
                    style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div style={{ fontWeight: 600 }}>{c.note_title}</div>
                    <div className="text-muted">
                      <span className="mono-num">[{c.timestamp}]</span> {c.excerpt}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Chat History Search */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h2 className="section-title">会話履歴 ({filteredHistory.length})</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, maxWidth: '400px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} strokeWidth={1.5} style={{ position: 'absolute', left: '10px', top: '11px', color: 'var(--text-muted)' }} />
              <input
                type="search"
                className="input"
                style={{ paddingLeft: '32px' }}
                placeholder="過去の会話を検索"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
              />
            </div>
            {chatHistory.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={onClearHistory} title="履歴をクリア">
                <Trash2 size={15} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>
            保存された会話履歴はありません。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredHistory.map((item) => (
              <div key={item.id} className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '14px' }}>Q: {item.question}</strong>
                  <span className="text-muted">{formatDateTime(item.timestamp)}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{item.answer}</div>
                {item.citations.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {item.citations.map((c, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="btn btn-ghost"
                        style={{ height: '28px', fontSize: '12px' }}
                        onClick={() => onOpenNote(c.note_id)}
                      >
                        {c.note_title} [{c.timestamp}]
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
