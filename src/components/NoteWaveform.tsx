import React, { useEffect, useState } from 'react';

interface NoteWaveformProps {
  mode: 'idle' | 'recording' | 'processing' | 'completed';
  levelRms?: number;
  waveform?: number[];
  playbackProgress?: number; // 0..1 when mode === 'completed'
}

const BAR_COUNT = 10;
const COMPLETED_HEIGHTS = [6, 10, 14, 8, 12, 14, 10, 8, 12, 6];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export const NoteWaveform: React.FC<NoteWaveformProps> = ({
  mode,
  levelRms = 0,
  waveform = [],
  playbackProgress = 0,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const recent = waveform.length > 0 ? waveform.slice(-BAR_COUNT) : [];
  const hasVoiceSignal =
    mode === 'recording' && (levelRms >= 0.002 || recent.some((v) => v >= 0.04));

  return (
    <div className="note-waveform" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        let height = 4;

        if (mode === 'completed') {
          height = COMPLETED_HEIGHTS[i] ?? 8;
        } else if (mode === 'recording' && !reducedMotion) {
          const sample =
            recent.length > 0
              ? recent[Math.min(recent.length - 1, i)] ?? 0
              : Math.min(1, Math.sqrt(Math.max(0, levelRms) * 14));
          height = sample >= 0.04 ? Math.max(4, Math.min(18, Math.round(3 + sample * 15))) : 4;
        }

        let backgroundColor = 'rgba(17, 17, 17, 0.28)';
        if (mode === 'completed') {
          const barThreshold = (i + 1) / BAR_COUNT;
          backgroundColor =
            playbackProgress > 0 && barThreshold <= playbackProgress
              ? '#111111'
              : 'rgba(17, 17, 17, 0.28)';
        } else if (mode === 'recording') {
          backgroundColor = hasVoiceSignal ? '#111111' : 'rgba(17, 17, 17, 0.35)';
        }

        return (
          <span
            key={i}
            className="note-wave-bar"
            style={{
              height: `${height}px`,
              backgroundColor,
            }}
          />
        );
      })}
    </div>
  );
};
