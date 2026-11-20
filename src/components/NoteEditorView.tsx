import React, { useState } from 'react';
import {
  Copy,
  ClipboardPaste,
  UploadCloud,
  Sparkles,
  Plus,
  Trash2,
  Send,
  BookOpen,
  MessageSquare,
  Share2,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  AppSettings,
  ChatAnswer,
  Note,
  Recipe,
  SecretStatus,
  TranscriptSegment,
} from '../types';
import { formatDateTime, formatMs, formatNoteForCopy } from '../lib/format';

interface NoteEditorViewProps {
  note: Note;
  settings: AppSettings;
  recipes: Recipe[];
  secretStatus: SecretStatus | null;
  transcribing: boolean;
  transcribeError: string | null;
  onUpdateNote: (note: Note) => void;
  onCopyText: (text: string, label: string) => Promise<void>;
  onPastePrepare: (text: string) => Promise<void>;
  onSaveToNotion: (noteId: string) => Promise<void>;
  onSummarize: (noteId: string) => Promise<void>;
  onDraftFollowup: (noteId: string) => Promise<void>;
  onRunRecipe: (noteId: string, prompt: string) => Promise<string>;
  onSaveRecipe: (recipe: Recipe) => Promise<void>;
  onChatNote: (noteIds: string[], question: string) => Promise<ChatAnswer>;
  onShareSlack: (noteId: string) => Promise<void>;
  onSendWebhook: (noteId: string) => Promise<void>;
  onAddDictionaryTerm: (term: string) => Promise<void>;
  onGoSettings: () => void;
}

export const NoteEditorView: React.FC<NoteEditorViewProps> = ({
  note,
  settings,
  recipes,
  secretStatus,
  transcribing,
  transcribeError,
  onUpdateNote,
  onCopyText,
  onPastePrepare,
  onSaveToNotion,
  onSummarize,
  onDraftFollowup,
  onRunRecipe,
  onSaveRecipe,
  onChatNote,
  onShareSlack,
  onSendWebhook,
  onAddDictionaryTerm,
  onGoSettings,
}) => {
  const [copyFormat, setCopyFormat] = useState<'markdown' | 'plain'>(settings.copy_format || 'markdown');
  const [notionPreviewOpen, setNotionPreviewOpen] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [auxTab, setAuxTab] = useState<'summary' | 'recipes' | 'chat' | 'share'>('summary');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [recipeOutput, setRecipeOutput] = useState<string>('');
  const [newRecipeName, setNewRecipeName] = useState('');
  const [newRecipePrompt, setNewRecipePrompt] = useState('');
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState<ChatAnswer | null>(null);
  const [newDictTerm, setNewDictTerm] = useState('');
  const [actionToast, setActionToast] = useState<string | null>(null);

  const llmConfigured = settings.llm_provider !== 'none' && settings.llm_provider !== '';
  const notionReady = Boolean(secretStatus?.notion_access_token) && Boolean(settings.notion_target_id);

  const notify = (msg: string) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 3500);
  };

  const updateSegment = (segId: string, patch: Partial<TranscriptSegment>) => {
    const next = note.segments.map((s) => (s.id === segId ? { ...s, ...patch } : s));
    onUpdateNote({ ...note, segments: next, updated_at: new Date().toISOString() });
  };

  const addSegment = () => {
    const lastEnd = note.segments[note.segments.length - 1]?.end_ms ?? 0;
    const seg: TranscriptSegment = {
      id: crypto.randomUUID(),
      start_ms: lastEnd,
      end_ms: lastEnd + 5000,
      speaker: '話者1',
      text: '',
    };
    onUpdateNote({ ...note, segments: [...note.segments, seg], updated_at: new Date().toISOString() });
  };

  const removeSegment = (segId: string) => {
    onUpdateNote({
      ...note,
      segments: note.segments.filter((s) => s.id !== segId),
      updated_at: new Date().toISOString(),
    });
  };

  const handleCopy = async () => {
    const text = formatNoteForCopy(note, copyFormat);
    await onCopyText(text, copyFormat === 'markdown' ? 'Markdown' : 'プレーンテキスト');
    notify(`${copyFormat === 'markdown' ? 'Markdown' : 'プレーンテキスト'}でコピーしました`);
  };

  const handlePaste = async () => {
    const text = formatNoteForCopy(note, copyFormat);
    await onPastePrepare(text);
  };

  const handleConfirmNotionSave = async () => {
    setNotionBusy(true);
    try {
      await onSaveToNotion(note.id);
      setNotionPreviewOpen(false);
      notify('Notion に保存しました');
    } catch {
      // エラーは note.notion_sync.last_error に記録される
    } finally {
      setNotionBusy(false);
    }
  };

  const handleSummarize = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      await onSummarize(note.id);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const handleDraftFollowup = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      await onDraftFollowup(note.id);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const handleRunRecipe = async (recipe: Recipe) => {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await onRunRecipe(note.id, recipe.prompt);
      setRecipeOutput(res);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const handleAskChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await onChatNote([note.id], chatQuestion);
      setChatAnswer(res);
    } catch (err) {
      setAiError(String(err));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header & Primary Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '280px' }}>
            <input
              type="text"
              aria-label="ノートタイトル"
              className="input"
              style={{ fontSize: '20px', fontWeight: 600, height: '44px', borderColor: 'transparent', paddingLeft: 0 }}
              value={note.title}
              onChange={(e) => onUpdateNote({ ...note, title: e.target.value, updated_at: new Date().toISOString() })}
              placeholder="ノートのタイトル"
            />
            <div className="text-muted" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
              <span>{formatDateTime(note.created_at)}</span>
              <span className="mono-num">録音時間 {formatMs(note.duration_sec * 1000)}</span>
              <span>ASR: {note.asr_provider_label}</span>
              <span>
                {note.diarization_supported
                  ? '自動話者識別: 対応'
                  : '自動話者識別: 未対応（手動で話者名を変更できます）'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select
              aria-label="コピー形式"
              className="select"
              style={{ width: 'auto' }}
              value={copyFormat}
              onChange={(e) => setCopyFormat(e.target.value as 'markdown' | 'plain')}
            >
              <option value="markdown">Markdown</option>
              <option value="plain">プレーンテキスト</option>
            </select>

            <button type="button" className="btn btn-secondary" onClick={handleCopy}>
              <Copy size={16} strokeWidth={1.5} />
              コピー
            </button>

            <button type="button" className="btn btn-secondary" onClick={handlePaste}>
              <ClipboardPaste size={16} strokeWidth={1.5} />
              貼り付け
            </button>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setNotionPreviewOpen(true)}
            >
              <UploadCloud size={16} strokeWidth={1.5} />
              {note.notion_sync.status === 'synced'
                ? 'Notion を更新'
                : note.notion_sync.status === 'failed'
                  ? 'Notion 再試行'
                  : 'Notion に保存'}
            </button>
          </div>
        </div>

        {actionToast && (
          <div className="status-chip ok" style={{ alignSelf: 'flex-start' }}>
            <Check size={14} strokeWidth={1.5} />
            {actionToast}
          </div>
        )}

        {transcribing && (
          <div className="surface-subtle" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Loader2 size={16} strokeWidth={1.5} />
            <span>録音後の文字起こしを実行しています（選択中のモデルはリアルタイム非対応のため録音後処理です）</span>
          </div>
        )}

        {transcribeError && (
          <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
            <div style={{ fontWeight: 600 }}>文字起こしを実行できませんでした</div>
            <div style={{ fontSize: '14px', marginTop: '4px' }}>{transcribeError}</div>
          </div>
        )}

        {note.notion_sync.status === 'failed' && note.notion_sync.last_error && (
          <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
            <div style={{ fontWeight: 600 }}>Notion 保存エラー（内容はローカルに保持されています）</div>
            <div style={{ fontSize: '14px', marginTop: '4px' }}>{note.notion_sync.last_error}</div>
          </div>
        )}
      </div>

      {/* Main Two-Column Content: Transcript/Notes + Auxiliary AI/Share */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 1fr)', gap: '20px', alignItems: 'start' }}>
        {/* Left: Transcript & Manual Notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="section-title">文字起こし</h2>
              <button type="button" className="btn btn-secondary" style={{ height: '30px', fontSize: '12px' }} onClick={addSegment}>
                <Plus size={14} strokeWidth={1.5} />
                行を追加
              </button>
            </div>

            {note.segments.length === 0 ? (
              <p className="text-muted" style={{ margin: 0 }}>
                文字起こし行がありません。「行を追加」から手動で入力するか、録音後に文字起こしを実行してください。
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {note.segments.map((seg) => (
                  <div
                    key={seg.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '76px 110px minmax(0, 1fr) 32px',
                      gap: '8px',
                      alignItems: 'start',
                      paddingBottom: '12px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      type="text"
                      aria-label="開始時刻(秒)"
                      className="input mono-num"
                      style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                      value={formatMs(seg.start_ms)}
                      onChange={(e) => {
                        const parts = e.target.value.split(':').map(Number);
                        if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
                          updateSegment(seg.id, { start_ms: (parts[0] * 60 + parts[1]) * 1000 });
                        }
                      }}
                    />
                    <input
                      type="text"
                      aria-label="話者名"
                      className="input"
                      style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                      value={seg.speaker}
                      onChange={(e) => updateSegment(seg.id, { speaker: e.target.value })}
                    />
                    <textarea
                      aria-label="発話内容"
                      className="textarea"
                      style={{ minHeight: '56px', padding: '8px 12px' }}
                      value={seg.text}
                      onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label="行を削除"
                      className="btn btn-ghost"
                      onClick={() => removeSegment(seg.id)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Quick User Dictionary Add */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <input
                type="text"
                className="input"
                style={{ height: '32px' }}
                placeholder="固有名詞をユーザー辞書へ登録"
                value={newDictTerm}
                onChange={(e) => setNewDictTerm(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '32px', flexShrink: 0 }}
                disabled={!newDictTerm.trim()}
                onClick={async () => {
                  await onAddDictionaryTerm(newDictTerm.trim());
                  setNewDictTerm('');
                  notify('ユーザー辞書に登録しました');
                }}
              >
                辞書に追加
              </button>
            </div>
          </section>

          <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="editor-manual-notes" className="section-title">
              手入力メモ
            </label>
            <textarea
              id="editor-manual-notes"
              className="textarea"
              value={note.manual_notes}
              onChange={(e) => onUpdateNote({ ...note, manual_notes: e.target.value, updated_at: new Date().toISOString() })}
              placeholder="補足メモを入力"
            />
          </section>
        </div>

        {/* Right: Auxiliary AI & Sharing */}
        <aside className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="tabs-row">
            <button
              type="button"
              className={`tab-btn ${auxTab === 'summary' ? 'active' : ''}`}
              onClick={() => setAuxTab('summary')}
            >
              要約・タスク
            </button>
            <button
              type="button"
              className={`tab-btn ${auxTab === 'recipes' ? 'active' : ''}`}
              onClick={() => setAuxTab('recipes')}
            >
              Recipes
            </button>
            <button
              type="button"
              className={`tab-btn ${auxTab === 'chat' ? 'active' : ''}`}
              onClick={() => setAuxTab('chat')}
            >
              AIチャット
            </button>
            <button
              type="button"
              className={`tab-btn ${auxTab === 'share' ? 'active' : ''}`}
              onClick={() => setAuxTab('share')}
            >
              共有
            </button>
          </div>

          {!llmConfigured && auxTab !== 'share' && (
            <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--warning)' }}>
                <AlertCircle size={15} strokeWidth={1.5} />
                LLMが未設定です
              </div>
              <p className="text-muted" style={{ margin: 0 }}>
                要約・Recipes・AIチャットを使うには、設定画面で OpenAI / Anthropic / Gemini / ローカル Ollama を設定してください。文字起こし・編集・コピー・Notion保存は設定なしで利用できます。
              </p>
              <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', height: '30px' }} onClick={onGoSettings}>
                AI設定を開く
              </button>
            </div>
          )}

          {aiError && (
            <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {aiError}
            </div>
          )}

          {auxTab === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!llmConfigured || aiBusy}
                  onClick={handleSummarize}
                >
                  <Sparkles size={15} strokeWidth={1.5} />
                  {aiBusy ? '生成中' : '要約とアクション抽出'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!llmConfigured || aiBusy}
                  onClick={handleDraftFollowup}
                >
                  メール下書き
                </button>
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>要約</div>
                <textarea
                  className="textarea"
                  value={note.summary}
                  onChange={(e) => onUpdateNote({ ...note, summary: e.target.value })}
                  placeholder="要約がここに入ります（手動編集も可能）"
                />
              </div>

              {note.decisions.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>決定事項</div>
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    {note.decisions.map((d, i) => (
                      <li key={i} style={{ fontSize: '14px' }}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {note.action_items.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>アクション項目</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {note.action_items.map((a) => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={a.done}
                          onChange={(e) =>
                            onUpdateNote({
                              ...note,
                              action_items: note.action_items.map((x) =>
                                x.id === a.id ? { ...x, done: e.target.checked } : x
                              ),
                            })
                          }
                        />
                        <span>{a.text}{a.assignee ? `（${a.assignee}）` : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {note.follow_up_draft && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    フォローアップメール下書き（確認のうえ手動送信）
                  </div>
                  <textarea
                    className="textarea"
                    value={note.follow_up_draft}
                    onChange={(e) => onUpdateNote({ ...note, follow_up_draft: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {auxTab === 'recipes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recipes.map((r) => (
                <div key={r.id} className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BookOpen size={14} strokeWidth={1.5} />
                      {r.name}
                    </div>
                    <div className="text-muted">{r.description}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: '30px', flexShrink: 0 }}
                    disabled={!llmConfigured || aiBusy}
                    onClick={() => handleRunRecipe(r)}
                  >
                    実行
                  </button>
                </div>
              ))}
              {recipeOutput && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>実行結果</div>
                  <textarea className="textarea" style={{ minHeight: '140px' }} value={recipeOutput} readOnly />
                </div>
              )}

              <details className="surface-subtle">
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>新しい Recipe を作成</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Recipe 名（例: 営業日報用まとめ）"
                    value={newRecipeName}
                    onChange={(e) => setNewRecipeName(e.target.value)}
                  />
                  <textarea
                    className="textarea"
                    style={{ minHeight: '72px' }}
                    placeholder="AIへの指示プロンプト"
                    value={newRecipePrompt}
                    onChange={(e) => setNewRecipePrompt(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!newRecipeName.trim() || !newRecipePrompt.trim()}
                    onClick={async () => {
                      await onSaveRecipe({
                        id: crypto.randomUUID(),
                        name: newRecipeName.trim(),
                        description: 'カスタム Recipe',
                        prompt: newRecipePrompt.trim(),
                        is_builtin: false,
                      });
                      setNewRecipeName('');
                      setNewRecipePrompt('');
                      notify('Recipe を保存しました');
                    }}
                  >
                    Recipe を保存
                  </button>
                </div>
              </details>
            </div>
          )}

          {auxTab === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <form onSubmit={handleAskChat} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="この会議について質問"
                  value={chatQuestion}
                  onChange={(e) => setChatQuestion(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={!llmConfigured || aiBusy}>
                  <MessageSquare size={15} strokeWidth={1.5} />
                </button>
              </form>
              {chatAnswer && (
                <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{chatAnswer.answer}</div>
                  {chatAnswer.citations.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                      <div className="text-muted" style={{ marginBottom: '4px' }}>参照箇所</div>
                      {chatAnswer.citations.map((c, idx) => (
                        <div key={idx} className="text-muted">
                          <span className="mono-num">[{c.timestamp}]</span> {c.excerpt}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {auxTab === 'share' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!secretStatus?.slack_webhook_url}
                onClick={async () => {
                  await onShareSlack(note.id);
                  notify('Slack へ共有しました');
                }}
              >
                <Share2 size={15} strokeWidth={1.5} />
                Slack へ共有{!secretStatus?.slack_webhook_url ? '（Webhook未設定）' : ''}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!settings.generic_webhook_url}
                onClick={async () => {
                  await onSendWebhook(note.id);
                  notify('Webhook へ送信しました');
                }}
              >
                <Send size={15} strokeWidth={1.5} />
                汎用 Webhook 送信{!settings.generic_webhook_url ? '（URL未設定）' : ''}
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Notion Preview Modal */}
      {notionPreviewOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="notion-modal-title">
          <div className="modal-panel">
            <h2 id="notion-modal-title" className="section-title">Notion 保存前の確認</h2>
            {!notionReady ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p className="text-secondary" style={{ margin: 0 }}>
                  Notion の接続または保存先データベース／ページが未設定です。設定画面で接続を完了してください。
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setNotionPreviewOpen(false)}>
                    閉じる
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => { setNotionPreviewOpen(false); onGoSettings(); }}>
                    Notion設定へ
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="surface-subtle" style={{ fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div>保存先: <strong>{settings.notion_target_name || settings.notion_target_id}</strong>（{settings.notion_target_type}）</div>
                  <div>タイトル: <strong>{note.title}</strong></div>
                  <div>要約文字数: {note.summary.length} 文字 / 文字起こし行数: {note.segments.length} 行</div>
                  {note.notion_sync.page_id && (
                    <div className="status-chip accent" style={{ alignSelf: 'flex-start' }}>
                      既存ページを更新（重複ページを作成しません）
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setNotionPreviewOpen(false)}>
                    キャンセル
                  </button>
                  <button type="button" className="btn btn-primary" disabled={notionBusy} onClick={handleConfirmNotionSave}>
                    {notionBusy ? <Loader2 size={15} strokeWidth={1.5} className="spin" /> : <UploadCloud size={15} strokeWidth={1.5} />}
                    {notionBusy ? '同期中' : 'Notion へ保存'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
