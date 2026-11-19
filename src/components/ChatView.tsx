import React, { useState } from 'react';
import { MessageSquare, AlertCircle } from 'lucide-react';
import { AppSettings, ChatAnswer, Note } from '../types';

interface ChatViewProps {
  notes: Note[];
  settings: AppSettings;
  onChatAcrossNotes: (noteIds: string[], question: string) => Promise<ChatAnswer>;
  onOpenNote: (noteId: string) => void;
  onGoSettings: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  notes,
  settings,
  onChatAcrossNotes,
  onOpenNote,
  onGoSettings,
}) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<ChatAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const llmConfigured = settings.llm_provider !== 'none' && settings.llm_provider !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onChatAcrossNotes(
        notes.map((n) => n.id),
        question
      );
      setAnswer(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container">
      <div>
        <h1 className="page-title">チャット</h1>
        <p className="text-secondary" style={{ margin: '4px 0 0' }}>
          保存されたノートを横断して検索し、記録に基づいた回答と参照箇所を確認できます
        </p>
      </div>

      {!llmConfigured && (
        <section className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)' }}>
            <AlertCircle size={16} strokeWidth={1.5} />
            <span>LLMが未設定のため利用できません。設定から OpenAI / OpenAI互換 / Anthropic / Gemini / Ollama を設定してください。</span>
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
            placeholder="過去のノートについて質問（例：決定したリリース日と担当者は？）"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!llmConfigured || busy || notes.length === 0}>
            <MessageSquare size={16} strokeWidth={1.5} />
            {busy ? '回答中' : '質問'}
          </button>
        </form>

        {notes.length === 0 && (
          <p className="text-muted" style={{ margin: 0 }}>
            参照できるノートがまだありません。録音またはアップロードからノートを作成してください。
          </p>
        )}

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
    </div>
  );
};
