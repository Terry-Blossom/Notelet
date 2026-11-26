import React from 'react';
import { History, RotateCcw, Sparkles } from 'lucide-react';
import { Note, SummaryPreset } from '../../types';
import { StreamingMarkdownArticle } from '../StreamingMarkdownArticle';

interface NoteSummaryPanelProps {
  note: Note;
  effectiveNote: Note;
  summaryPresets: SummaryPreset[];
  selectedTemplateId: string;
  setSelectedTemplateId: (templateId: string) => void;
  suggestedPresetId: string | null;
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  compareRevisionId: string | null;
  setCompareRevisionId: React.Dispatch<React.SetStateAction<string | null>>;
  isSummarizing: boolean;
  onRunSummarize: () => void;
  llmConfigured: boolean;
  onUpdateNote: (note: Note) => void;
  onNotify: (message: string) => void;
  aiError: string | null;
  onGoSettings: () => void;
}

export const NoteSummaryPanel: React.FC<NoteSummaryPanelProps> = ({
  note,
  effectiveNote,
  summaryPresets,
  selectedTemplateId,
  setSelectedTemplateId,
  suggestedPresetId,
  historyOpen,
  setHistoryOpen,
  compareRevisionId,
  setCompareRevisionId,
  isSummarizing,
  onRunSummarize,
  llmConfigured,
  onUpdateNote,
  onNotify,
  aiError,
  onGoSettings,
}) => (
  <div className="note-notes-tab">
    <section className="note-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <h2 className="note-card-title">要約</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {suggestedPresetId && suggestedPresetId !== selectedTemplateId && (
            <button
              type="button"
              className="chip-filter"
              style={{ height: '24px', fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent-border)' }}
              onClick={() => setSelectedTemplateId(suggestedPresetId)}
            >
              推奨: {summaryPresets.find((p) => p.id === suggestedPresetId)?.name} を適用
            </button>
          )}
          <select
            aria-label="要約テンプレート"
            className="input"
            style={{ width: '160px', height: '28px', fontSize: '12px', padding: '0 8px', lineHeight: '1.2' }}
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
          >
            {summaryPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          {(note.summary_history?.length ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: '28px', fontSize: '12px', padding: '0 8px' }}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History size={13} strokeWidth={1.75} />
              履歴 ({note.summary_history?.length})
            </button>
          )}
          {llmConfigured && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: '28px', fontSize: '12px' }}
              disabled={isSummarizing}
              onClick={onRunSummarize}
            >
              <Sparkles size={13} strokeWidth={1.75} />
              {isSummarizing ? '生成中' : '要約を生成'}
            </button>
          )}
        </div>
      </div>

      {historyOpen && (note.summary_history?.length ?? 0) > 0 && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-subtle)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
            <strong>過去の要約バージョン</strong>
            <button type="button" className="btn btn-ghost" style={{ height: '22px', fontSize: '11px' }} onClick={() => setHistoryOpen(false)}>
              閉じる
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {note.summary_history!.map((rev) => (
              <button
                key={rev.id}
                type="button"
                className={`chip-filter ${compareRevisionId === rev.id ? 'active' : ''}`}
                style={{ fontSize: '11px', height: '24px' }}
                onClick={() => setCompareRevisionId(rev.id === compareRevisionId ? null : rev.id)}
              >
                {rev.created_at.slice(0, 16).replace('T', ' ')} ({rev.model_label || '要約'})
              </button>
            ))}
          </div>
          {compareRevisionId && (() => {
            const rev = note.summary_history!.find((r) => r.id === compareRevisionId);
            if (!rev) return null;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                <div style={{ fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto', color: 'var(--text-secondary)' }}>
                  {rev.summary}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ alignSelf: 'flex-start', height: '26px', fontSize: '12px' }}
                  onClick={() => {
                    onUpdateNote({
                      ...note,
                      summary: rev.summary,
                      updated_at: new Date().toISOString(),
                    });
                    setHistoryOpen(false);
                    onNotify('過去の要約を復元しました');
                  }}
                >
                  <RotateCcw size={12} />
                  このバージョンを復元
                </button>
              </div>
            );
          })()}
        </div>
      )}

      <div aria-label="要約内容" style={{ padding: '4px 0' }}>
        <StreamingMarkdownArticle
          key={note.id}
          content={isSummarizing ? '' : effectiveNote.summary}
          isGenerating={isSummarizing}
          animateOnChange
          placeholder="要約はまだ生成されていません（下のボタンまたは右上から生成できます）"
        />
      </div>
    </section>

    {note.decisions.length > 0 && (
      <section className="note-card">
        <h2 className="note-card-title">決定事項</h2>
        <ul style={{ margin: '0px', paddingLeft: '20px', lineHeight: '24px' }}>
          {note.decisions.map((decision, index) => (
            <li key={`d-${index}`}>{decision}</li>
          ))}
        </ul>
      </section>
    )}

    {!llmConfigured && (
      <section className="note-card">
        <div style={{ fontWeight: 600 }}>LLMが未設定です</div>
        <p style={{ margin: '0px', color: 'var(--ns-text-secondary)' }}>
          AI要約や質問応答を使うには設定画面でプロバイダを設定してください。
        </p>
        <button
          type="button"
          className="note-inline-link"
          style={{ alignSelf: 'flex-start' }}
          onClick={onGoSettings}
        >
          AI設定を開く
        </button>
      </section>
    )}

    {aiError && <div style={{ color: 'var(--danger)' }}>{aiError}</div>}
  </div>
);
