import React from 'react';

interface NoteMemoPanelProps {
  memoEditorRef: React.RefObject<HTMLDivElement | null>;
  applyMemoCommand: (command: string, value?: string) => void;
  saveMemoHtml: (html: string) => void;
}

export const NoteMemoPanel: React.FC<NoteMemoPanelProps> = ({
  memoEditorRef,
  applyMemoCommand,
  saveMemoHtml,
}) => (
  <div className="note-notes-tab">
    <section className="note-card" style={{ padding: 0 }}>
      <div className="rich-memo-toolbar" role="toolbar" aria-label="メモ書式ツールバー">
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
          <strong>太字</strong>
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('underline');
          }}
        >
          <u>下線</u>
        </button>
        <button
          type="button"
          className="rich-memo-tool-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyMemoCommand('insertUnorderedList');
          }}
        >
          箇条書き
        </button>
      </div>
      <div
        ref={memoEditorRef}
        role="textbox"
        aria-label="自由メモ帳"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className="rich-memo-editor"
        onInput={(e) => saveMemoHtml(e.currentTarget.innerHTML)}
        onBlur={(e) => saveMemoHtml(e.currentTarget.innerHTML)}
      />
    </section>
  </div>
);
