import React from 'react';
import { ArrowDown, Check, FileText, History, Plus, X } from 'lucide-react';
import { ChatCitation, ChatHistoryItem, PopupChatSession } from '../../types';
import { formatDateTime } from '../../lib/format';
import { StreamingMarkdownArticle } from '../StreamingMarkdownArticle';
import { t } from '../../i18n';

interface NoteChatPopupProps {
  open: boolean;
  scopeKey: string;
  busy: boolean;
  isSpacePage: boolean;
  chatScope: 'note' | 'space' | 'all';
  onChangeChatScope: (scope: 'note' | 'space' | 'all') => void;
  chatHistoryOpen: boolean;
  onToggleHistory: () => void;
  onClose: () => void;
  chatSessions: PopupChatSession[];
  chatHistory: ChatHistoryItem[];
  lastSessionByScope: Record<string, string>;
  onSelectSession: (scopeKey: string, sessionId: string) => void;
  onNewChat: (scopeKey: string) => void;
  streamingChatText: string;
  errorText: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onCitationClick: (citation: ChatCitation) => void;
}

export const NoteChatPopup: React.FC<NoteChatPopupProps> = ({
  open,
  scopeKey,
  busy,
  isSpacePage,
  chatScope,
  onChangeChatScope,
  chatHistoryOpen,
  onToggleHistory,
  onClose,
  chatSessions,
  chatHistory,
  lastSessionByScope,
  onSelectSession,
  onNewChat,
  streamingChatText,
  errorText,
  scrollRef,
  onCitationClick,
}) => {
  if (!open) return null;

  const sharedSessions: PopupChatSession[] = chatHistory
    .filter(
      (h) =>
        !chatSessions.some(
          (s) =>
            s.messages[0]?.text === h.question &&
            Math.abs(Date.parse(s.updatedAt) - Date.parse(h.timestamp)) < 60_000
        )
    )
    .map((h) => ({
      id: `shared:${h.id}`,
      scopeKey: h.space_id ? `space:${h.space_id}` : 'all',
      title: h.question.slice(0, 32),
      updatedAt: h.timestamp,
      messages: [
        { role: 'user', text: h.question, createdAt: h.timestamp },
        {
          role: 'assistant',
          text: h.answer,
          citations: h.citations,
          actions: h.actions,
          thinking: h.thinking,
          createdAt: h.timestamp,
        },
      ],
    }));

  const allSortedSessions = [...chatSessions, ...sharedSessions].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  const session = allSortedSessions.find((s) => s.id === lastSessionByScope[scopeKey]) ?? null;

  return (
    <div className="note-chat-popup" role="dialog" aria-label={t('チャット')}>
      <div className="note-chat-popup-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flexWrap: 'wrap' }}>
          {!isSpacePage ? (
            <>
              <button
                type="button"
                className={`tab-btn ${chatScope === 'note' ? 'active' : ''}`}
                style={{ height: '28px', padding: '0 12px', fontSize: '12px' }}
                onClick={() => onChangeChatScope('note')}
              >
                {t('このノート')}
              </button>
              <button
                type="button"
                className={`tab-btn ${chatScope === 'space' ? 'active' : ''}`}
                style={{ height: '28px', padding: '0 12px', fontSize: '12px' }}
                onClick={() => onChangeChatScope('space')}
              >
                {t('スペース全体')}
              </button>
              <button
                type="button"
                className={`tab-btn ${chatScope === 'all' ? 'active' : ''}`}
                style={{ height: '28px', padding: '0 12px', fontSize: '12px' }}
                onClick={() => onChangeChatScope('all')}
              >
                {t('アプリ全体')}
              </button>
            </>
          ) : (
            <span className="status-chip" style={{ fontSize: '12px' }}>
              {t('スペース全体')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button
            type="button"
            aria-label={t('新しいチャット')}
            title={t('新しいチャット')}
            className="btn btn-ghost"
            style={{ width: '28px', height: '28px', padding: 0 }}
            onClick={() => onNewChat(scopeKey)}
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={t('チャット履歴')}
            title={t('チャット履歴')}
            aria-pressed={chatHistoryOpen}
            className={`btn btn-ghost ${chatHistoryOpen ? 'active' : ''}`}
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              backgroundColor: chatHistoryOpen ? 'var(--ns-text-primary)' : undefined,
              color: chatHistoryOpen ? 'var(--ns-text-on-primary)' : undefined,
            }}
            onClick={onToggleHistory}
          >
            <History size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label={t('チャットを閉じる')}
            title={t('閉じる')}
            className="btn btn-ghost"
            style={{ width: '28px', height: '28px', padding: 0 }}
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="note-chat-popup-body" style={{ position: 'relative' }}>
        {chatHistoryOpen ? (
          allSortedSessions.length === 0 ? (
            <div className="text-muted" style={{ fontSize: '13px' }}>
              {t('チャット履歴はまだありません。')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allSortedSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="flat-row"
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: s.id === session?.id ? 'var(--bg-subtle)' : 'transparent',
                    textAlign: 'left',
                  }}
                  onClick={() => onSelectSession(scopeKey, s.id)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                    <strong
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.title}
                    </strong>
                    <span className="text-muted mono-num" style={{ fontSize: '11px' }}>
                      {formatDateTime(s.updatedAt)} ・ {t('{0} 件のメッセージ', [s.messages.length])}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : !session || session.messages.length === 0 ? (
          <div className="text-muted" style={{ fontSize: '13px' }}>
            {t('下の入力欄から何でも質問できます。過去のチャットは右上の履歴ボタンから呼び出せます。')}
          </div>
        ) : (
          <>
            {session.messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                  maxWidth: m.role === 'user' ? '85%' : '100%',
                  padding: m.role === 'user' ? '8px 12px' : '4px 0',
                  borderRadius: m.role === 'user' ? '12px' : '0',
                  backgroundColor: m.role === 'user' ? 'var(--ns-surface-pill)' : 'transparent',
                  fontSize: '13px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {m.role === 'user' ? (
                  <span>{m.text}</span>
                ) : (
                  <>
                    <StreamingMarkdownArticle
                      content={m.text}
                      isGenerating={false}
                      citations={m.citations}
                      thinking={m.thinking}
                      onCitationClick={onCitationClick}
                    />
                    {m.actions && m.actions.length > 0 && (
                      <div className="chat-actions-bar">
                        {m.actions.map((a, aIdx) => (
                          <span key={aIdx} className="chat-action-chip">
                            <Check size={12} strokeWidth={2} color="var(--accent)" />
                            <span>{a.description}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {m.citations && m.citations.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          paddingTop: '8px',
                          borderTop: '1px solid var(--ns-border-sidebar)',
                        }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ns-text-muted)' }}>
                          {t('引用元のノート・該当箇所')}
                        </span>
                        {m.citations.map((c, cIdx) => (
                          <button
                            key={`${c.note_id}-${cIdx}`}
                            type="button"
                            onClick={() => onCitationClick(c)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              padding: '8px',
                              borderRadius: '8px',
                              backgroundColor: 'var(--ns-bg-sidebar)',
                              border: '1px solid var(--ns-border-sidebar)',
                              textAlign: 'left',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span
                                className="inline-citation-badge"
                                style={{ marginLeft: 0, verticalAlign: 'middle' }}
                              >
                                {cIdx + 1}
                              </span>
                              <FileText size={12} strokeWidth={1.75} />
                              <strong style={{ fontSize: '12px', fontWeight: 600 }}>{c.note_title}</strong>
                              {c.timestamp && (
                                <span className="status-chip mono-num" style={{ fontSize: '11px' }}>
                                  {c.timestamp}
                                </span>
                              )}
                            </div>
                            {c.excerpt && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--ns-text-secondary)',
                                  lineHeight: '1.5',
                                }}
                              >
                                「{c.excerpt}」
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {busy && (
              <StreamingMarkdownArticle
                content={streamingChatText}
                isGenerating={!streamingChatText}
                animateOnChange={false}
              />
            )}
            <button
              type="button"
              className="note-jump-latest"
              style={{ alignSelf: 'flex-end', position: 'sticky', bottom: '4px', marginTop: '4px' }}
              onClick={() => {
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }}
            >
              <ArrowDown size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>{t('最新↓')}</span>
            </button>
          </>
        )}
        {errorText && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: 'var(--danger-bg)',
              color: 'var(--danger)',
              fontSize: '12px',
            }}
          >
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
};
