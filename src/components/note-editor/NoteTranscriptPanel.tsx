import React, { useState } from 'react';
import { BookPlus, Pause, Pencil, Play } from 'lucide-react';
import { TranscriptSegment } from '../../types';
import { formatNoteTimer } from '../../lib/format';
import { t } from '../../i18n';

interface NoteTranscriptPanelProps {
  segments: TranscriptSegment[];
  activeSegId: string | null;
  isRecording: boolean;
  isCompleted: boolean;
  editingSegId: string | null;
  editingSegText: string;
  onStartEdit: (segId: string, text: string) => void;
  onChangeEditText: (text: string) => void;
  onCommitEdit: (segId: string) => void;
  onCancelEdit: () => void;
  onTogglePlayback: () => void;
  onPlayFromMs: (startMs: number) => void;
  onAddDictionaryTerm: (term: string) => Promise<void>;
  onNotify: (msg: string) => void;
  highlightSearchText: (text: string) => React.ReactNode;
}

const INITIAL_WINDOW = 300;
const WINDOW_STEP = 300;

export const NoteTranscriptPanel: React.FC<NoteTranscriptPanelProps> = React.memo(
  ({
    segments,
    activeSegId,
    isRecording,
    isCompleted,
    editingSegId,
    editingSegText,
    onStartEdit,
    onChangeEditText,
    onCommitEdit,
    onCancelEdit,
    onTogglePlayback,
    onPlayFromMs,
    onAddDictionaryTerm,
    onNotify,
    highlightSearchText,
  }) => {
    const [visibleCount, setVisibleCount] = useState(INITIAL_WINDOW);
    const startIndex = Math.max(0, segments.length - visibleCount);
    const visibleSegments = startIndex > 0 ? segments.slice(startIndex) : segments;

    return (
      <div className={`note-transcript-list ${isCompleted ? 'completed' : ''}`}>
        {startIndex > 0 && (
          <button
            type="button"
            className="note-transcript-more"
            onClick={() => setVisibleCount((count) => count + WINDOW_STEP)}
          >
            {t('以前の文字起こしを表示（残り {0} 件）', [startIndex])}
          </button>
        )}
        {visibleSegments.map((seg) => {
          const isActiveSeg = activeSegId === seg.id;
          const isInterimSeg = isRecording || seg.id.startsWith('live-');
          const isEditingSeg = editingSegId === seg.id;
          return (
            <article key={seg.id} className={`note-turn ${isActiveSeg ? 'playing' : ''}`}>
              <div
                className="note-turn-meta"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
              >
                <button
                  type="button"
                  className={`note-seg-play-btn ${isActiveSeg ? 'active' : ''}`}
                  aria-label={
                    isActiveSeg
                      ? t('一時停止')
                      : t('{0} から再生', [formatNoteTimer(seg.start_ms)])
                  }
                  title={
                    isActiveSeg
                      ? t('一時停止')
                      : t('{0} から再生', [formatNoteTimer(seg.start_ms)])
                  }
                  onClick={() => {
                    if (isActiveSeg) {
                      onTogglePlayback();
                    } else {
                      onPlayFromMs(seg.start_ms);
                    }
                  }}
                >
                  {isActiveSeg ? (
                    <Pause size={11} strokeWidth={2} />
                  ) : (
                    <Play size={11} strokeWidth={2} />
                  )}
                </button>
                <button
                  type="button"
                  className="note-turn-time"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  title={t('{0} から再生', [formatNoteTimer(seg.start_ms)])}
                  onClick={() => onPlayFromMs(seg.start_ms)}
                >
                  {formatNoteTimer(seg.start_ms)}
                </button>
                {isInterimSeg && (
                  <span
                    className="status-chip"
                    style={{ fontSize: '10px', padding: '0 4px', opacity: 0.8 }}
                  >
                    {t('暫定')}
                  </span>
                )}
                {!isRecording && !isEditingSeg && (
                  <div
                    style={{
                      marginLeft: 'auto',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
                      title={t('この発言を編集')}
                      onClick={() => onStartEdit(seg.id, seg.text)}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
                      title={t('選択テキストまたは単語を辞書に追加')}
                      onClick={async () => {
                        const sel = window.getSelection()?.toString().trim();
                        const candidate = sel || seg.text.trim().slice(0, 24);
                        if (!candidate) return;
                        await onAddDictionaryTerm(candidate);
                        onNotify(t('「{0}」を辞書に追加しました', [candidate]));
                      }}
                    >
                      <BookPlus size={11} />
                    </button>
                  </div>
                )}
              </div>
              {isEditingSeg ? (
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="text"
                    className="input"
                    value={editingSegText}
                    autoFocus
                    onChange={(e) => onChangeEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onCommitEdit(seg.id);
                      } else if (e.key === 'Escape') {
                        onCancelEdit();
                      }
                    }}
                    style={{ flex: 1, height: '30px', fontSize: '13px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ height: '30px', padding: '0 12px', fontSize: '12px' }}
                    onClick={() => onCommitEdit(seg.id)}
                  >
                    {t('保存')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ height: '30px', padding: '0 8px', fontSize: '12px' }}
                    onClick={onCancelEdit}
                  >
                    {t('取消')}
                  </button>
                </div>
              ) : (
                <p className="note-turn-text" style={{ opacity: isInterimSeg ? 0.85 : 1 }}>
                  {highlightSearchText(seg.text)}
                </p>
              )}
            </article>
          );
        })}
      </div>
    );
  }
);
