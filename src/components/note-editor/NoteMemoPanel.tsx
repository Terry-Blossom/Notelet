import React from 'react';
import { t } from '../../i18n';

interface NoteMemoPanelProps {
  memoEditorRef: React.RefObject<HTMLDivElement | null>;
  applyMemoCommand: (command: string, value?: string) => void;
  saveMemoHtml: (html: string) => void;
  onFlush?: () => void;
}

export const NoteMemoPanel: React.FC<NoteMemoPanelProps> = React.memo(({
  memoEditorRef,
  applyMemoCommand,
  saveMemoHtml,
  onFlush,
}) => (
  <div className="note-notes-tab">
    <section className="note-card" style={{ padding: 0 }}>
      <div className="rich-memo-toolbar" role="toolbar" aria-label={t('メモ書式ツールバー')}>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('formatBlock', 'h1');
          }}
        >
          H1
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('formatBlock', 'h2');
          }}
        >
          H2
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('formatBlock', 'h3');
          }}
        >
          H3
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('bold');
          }}
        >
          <strong>{t('太字')}</strong>
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('underline');
          }}
        >
          <u>{t('下線')}</u>
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('insertUnorderedList');
          }}
        >
          {t('箇条書き')}
        </button>
      </div>
      <div
        ref={memoEditorRef}
        role="textbox"
        aria-label={t('自由メモ帳')}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className="rich-memo-editor"
        onInput={(e) => saveMemoHtml(e.currentTarget.innerHTML)}
        onBlur={(e) => {
          saveMemoHtml(e.currentTarget.innerHTML);
          onFlush?.();
        }}
      />
    </section>
  </div>
));
