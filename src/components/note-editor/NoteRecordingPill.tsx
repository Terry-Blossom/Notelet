import React from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import { NoteWaveform } from '../NoteWaveform';
import { formatNoteTimer } from '../../lib/format';
import { NotePhase } from '../NoteEditorView';

interface NoteRecordingPillProps {
  phase: NotePhase;
  hasAudioPath: boolean;
  isExternalRecording: boolean;
  levelRms: number;
  waveform: number[];
  timerMs: number;
  isPlaying: boolean;
  playbackProgress: number;
  playbackRate: number;
  onRecordButtonClick: () => void;
  onTogglePlayback: () => void;
  onSkipAudioBy: (deltaMs: number) => void;
  onCyclePlaybackRate: () => void;
}

export const NoteRecordingPill: React.FC<NoteRecordingPillProps> = React.memo(
  ({
    phase,
    hasAudioPath,
    isExternalRecording,
    levelRms,
    waveform,
    timerMs,
    isPlaying,
    playbackProgress,
    playbackRate,
    onRecordButtonClick,
    onTogglePlayback,
    onSkipAudioBy,
    onCyclePlaybackRate,
  }) => {
    if (phase === 'idle' || phase === 'recording') {
      return (
        <div className="note-rec-pill">
          <button
            type="button"
            className={`note-rec-btn ${phase === 'recording' ? 'recording' : ''}`}
            aria-pressed={phase === 'recording'}
            aria-label={phase === 'recording' ? '録音を停止' : '録音を開始'}
            onClick={onRecordButtonClick}
          >
            {phase === 'recording' ? (
              <span className="note-rec-btn-square" />
            ) : (
              <span className="note-rec-btn-dot" />
            )}
          </button>

          <NoteWaveform
            mode={phase === 'recording' ? 'recording' : 'idle'}
            levelRms={isExternalRecording ? levelRms : 0}
            waveform={waveform}
          />

          <span
            className={`note-timer ${phase === 'idle' ? 'muted' : ''}`}
            aria-hidden="true"
          >
            {formatNoteTimer(timerMs)}
          </span>
        </div>
      );
    }

    if (phase === 'processing') {
      return (
        <div className="note-rec-pill">
          <NoteWaveform mode="processing" />
          <span className="note-status-label">文字起こし中…</span>
        </div>
      );
    }

    if (phase === 'completed' && hasAudioPath) {
      return (
        <div className="note-rec-pill">
          <button
            type="button"
            className="note-play-btn"
            aria-label={isPlaying ? '再生を一時停止' : '録音を再生'}
            onClick={onTogglePlayback}
          >
            {isPlaying ? (
              <Pause size={20} strokeWidth={1.75} />
            ) : (
              <Play size={20} strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            className="chip-filter mono-num"
            aria-label="5秒戻る"
            title="5秒戻る (←)"
            style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
            onClick={() => onSkipAudioBy(-5000)}
          >
            -5s
          </button>
          <button
            type="button"
            className="chip-filter mono-num"
            aria-label="5秒進む"
            title="5秒進む (→)"
            style={{ fontSize: '11px', height: '22px', padding: '0 8px' }}
            onClick={() => onSkipAudioBy(5000)}
          >
            +5s
          </button>

          <NoteWaveform mode="completed" playbackProgress={playbackProgress} />

          <span className="note-timer" aria-hidden="true">
            {formatNoteTimer(timerMs)}
          </span>

          <button
            type="button"
            className="chip-filter mono-num"
            aria-label="再生速度を切り替え"
            title="再生速度を切り替え (1.0x / 1.25x / 1.5x / 2.0x)"
            style={{ height: '24px', padding: '0 8px', fontSize: '12px', fontWeight: 600 }}
            onClick={onCyclePlaybackRate}
          >
            {playbackRate}x
          </button>

          <button
            type="button"
            className="note-rerecord-btn"
            aria-label="再録音"
            onClick={onRecordButtonClick}
          >
            <Mic size={12} strokeWidth={1.75} />
          </button>
        </div>
      );
    }

    return (
      <div className="note-rec-pill">
        <button
          type="button"
          className="note-rec-btn"
          aria-label="録音を開始"
          onClick={onRecordButtonClick}
        >
          <span className="note-rec-btn-dot" />
        </button>
        <NoteWaveform mode="idle" levelRms={0} waveform={[]} />
        <span className="note-timer muted" aria-hidden="true">
          {formatNoteTimer(0)}
        </span>
      </div>
    );
  }
);
