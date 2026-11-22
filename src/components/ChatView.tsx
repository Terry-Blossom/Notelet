import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  CheckSquare,
  FileText,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { AppSettings, ChatAnswer, ChatCitation, ChatHistoryItem, Folder, Note } from '../types';
import { formatDateTime } from '../lib/format';
import { StreamingMarkdownArticle } from './StreamingMarkdownArticle';
import { confirmDeleteDialog } from './ConfirmDialog';

interface ChatViewProps {
  notes: Note[];
  folders: Folder[];
  chatHistory: ChatHistoryItem[];
  settings: AppSettings;
  onChatAcrossNotes: (noteIds: string[], question: string, spaceId?: string | null) => Promise<ChatAnswer>;
  onClearHistory: () => Promise<void>;
  onDeleteHistoryItems?: (itemIds: string[]) => Promise<void>;
  onOpenNote: (noteId: string) => void;
  onGoSettings: () => void;
}

interface ActiveTurn {
  id: string;
  question: string;
  answer: ChatAnswer;
}

export const ChatView: React.FC<ChatViewProps> = ({
  notes,
  folders,
  chatHistory,
  settings,
  onChatAcrossNotes,
  onClearHistory,
  onDeleteHistoryItems,
  onOpenNote,
  onGoSettings,
}) => {
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('all');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ActiveTurn[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
    () => chatHistory.find((h) => h.id === selectedHistoryId) ?? null,
    [chatHistory, selectedHistoryId]
  );

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    if (selectedHistoryId && activeHistoryItem) {
      setTurns([
        {
          id: activeHistoryItem.id,
          question: activeHistoryItem.question,
          answer: { answer: activeHistoryItem.answer, citations: activeHistoryItem.citations },
        },
      ]);
      setSelectedHistoryId(null);
    }
    setQuestion('');
    try {
      const spaceId = selectedSpaceId === 'all' ? null : selectedSpaceId;
      const targetIds = notes
        .filter((n) => !spaceId || n.folder_id === spaceId)
        .map((n) => n.id);
      const res = await onChatAcrossNotes(targetIds, q, spaceId);
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          question: q,
          answer: res,
        },
      ]);
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

  const allSelected =
    filteredHistory.length > 0 && filteredHistory.every((h) => selectedIds.includes(h.id));

  const renderCitations = (citations: ChatCitation[]) => {
    if (!citations || citations.length === 0) return null;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          paddingTop: '12px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
          引用元のノート・該当箇所
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {citations.map((c, idx) => (
            <button
              key={`${c.note_id}-${idx}`}
              type="button"
              onClick={() => onOpenNote(c.note_id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <FileText size={13} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} />
                <strong style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {c.note_title}
                </strong>
                {c.timestamp && (
                  <span className="status-chip mono-num" style={{ fontSize: '11px' }}>
                    {c.timestamp}
                  </span>
                )}
              </div>
              {c.excerpt && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  「{c.excerpt}」
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-split">
      {/* Left Rail: Searchable Conversation History */}
      <aside className="chat-history-rail">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '14px', fontWeight: 600 }}>会話履歴 ({filteredHistory.length})</strong>
          <button
            type="button"
            aria-label="チャット履歴を選択"
            title={selectMode ? '選択を終了' : '複数選択して削除'}
            aria-pressed={selectMode}
            className={`btn btn-ghost ${selectMode ? 'active' : ''}`}
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              backgroundColor: selectMode ? 'var(--text-primary)' : undefined,
              color: selectMode ? 'var(--text-inverse)' : undefined,
            }}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelectedIds([]);
            }}
          >
            <CheckSquare size={15} strokeWidth={1.75} />
          </button>
        </div>

        {selectMode && (
          <div
            className="surface-subtle"
            style={{
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: '24px', padding: '0 8px', fontSize: '12px' }}
              onClick={() => {
                if (allSelected) {
                  setSelectedIds([]);
                } else {
                  setSelectedIds(filteredHistory.map((h) => h.id));
                }
              }}
            >
              {allSelected ? 'すべて解除' : 'すべて選択'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ height: '24px', padding: '0 8px', fontSize: '12px' }}
              disabled={selectedIds.length === 0}
              onClick={async () => {
                if (selectedIds.length === 0) return;
                const ok = await confirmDeleteDialog(
                  `${selectedIds.length} 件のチャット履歴を削除しますか？`,
                  '選択した会話履歴を削除します。この操作は取り消せません。'
                );
                if (!ok) return;
                if (onDeleteHistoryItems) {
                  await onDeleteHistoryItems(selectedIds);
                } else if (selectedIds.length === chatHistory.length) {
                  await onClearHistory();
                }
                if (selectedHistoryId && selectedIds.includes(selectedHistoryId)) {
                  setSelectedHistoryId(null);
                }
                setSelectedIds([]);
                setSelectMode(false);
              }}
            >
              <Trash2 size={12} strokeWidth={1.5} />
              削除 ({selectedIds.length})
            </button>
          </div>
        )}

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
          <div className="text-muted" style={{ paddingTop: '8px', fontSize: '13px' }}>
            履歴はありません
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredHistory.map((item) => {
              const isSelected = selectedHistoryId === item.id;
              const isChecked = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '6px',
                    backgroundColor: isSelected ? 'var(--accent-tint)' : 'transparent',
                  }}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      aria-label={`${item.question}を選択`}
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds((prev) => [...prev, item.id]);
                        } else {
                          setSelectedIds((prev) => prev.filter((id) => id !== item.id));
                        }
                      }}
                      style={{ width: '16px', height: '16px', flexShrink: 0, cursor: 'pointer' }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectMode) {
                        setSelectedIds((prev) =>
                          prev.includes(item.id)
                            ? prev.filter((id) => id !== item.id)
                            : [...prev, item.id]
                        );
                      } else {
                        setSelectedHistoryId(item.id);
                      }
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
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
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* Main Chat Pane */}
      <div className="chat-main-pane" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
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

          <button
            type="button"
            className="btn btn-secondary"
            aria-label="新しいチャットを作成"
            title="新しいチャットを作成"
            style={{ height: '32px', padding: '0 12px' }}
            onClick={() => {
              setSelectedHistoryId(null);
              setTurns([]);
              setQuestion('');
              setError(null);
            }}
          >
            <Plus size={15} strokeWidth={1.75} />
            <span>新規チャット</span>
          </button>
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
              flexShrink: 0,
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

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: '13px', flexShrink: 0 }}>{error}</div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeHistoryItem ? (
            <div
              style={{
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Q. {activeHistoryItem.question}
              </div>
              <StreamingMarkdownArticle
                content={activeHistoryItem.answer}
                isGenerating={false}
                animateOnChange={false}
              />
              {renderCitations(activeHistoryItem.citations)}
            </div>
          ) : turns.length > 0 || busy ? (
            <>
              {turns.map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Q. {t.question}
                  </div>
                  <StreamingMarkdownArticle
                    content={t.answer.answer}
                    isGenerating={false}
                    animateOnChange
                  />
                  {renderCitations(t.answer.citations)}
                </div>
              ))}
              {busy && (
                <div
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <StreamingMarkdownArticle content="" isGenerating animateOnChange />
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '24px 0', color: 'var(--text-muted)' }}>
              下の入力欄から「{activeSpaceName}」について何でも質問するか、左側の履歴から過去の回答を開けます。
            </div>
          )}
        </div>

        {/* Bottom Composer Box (matching NoteEditorView's "ノートについて何でも質問") */}
        <div className="note-composer-wrap" style={{ flexShrink: 0 }}>
          <div className="note-composer-box">
            <textarea
              aria-label="全ノートへの質問"
              className="note-composer-input"
              rows={1}
              placeholder={`${activeSpaceName}について何でも質問`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleAsk();
                }
              }}
            />
            <button
              type="button"
              className="note-send-btn"
              aria-label="質問を送信"
              disabled={busy || !question.trim()}
              onClick={() => void handleAsk()}
            >
              <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
