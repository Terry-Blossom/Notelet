import React, { useEffect, useState } from 'react';

interface NoteWaveformProps {
  mode: 'idle' | 'recording' | 'processing' | 'completed';
  levelRms?: number;
  waveform?: number[];
  playbackProgress?: number; // 0..1 when mode === 'completed'
}

const STATIC_HEIGHTS = [7, 11, 15, 9, 13, 17, 10, 8, 14, 16, 11, 7];

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

  return (
    <div className="note-waveform" aria-hidden="true">
      {STATIC_HEIGHTS.map((baseHeight, i) => {
        let height = baseHeight;

        if (mode === 'recording' && !reducedMotion) {
          const sample =
            waveform.length > 0
              ? waveform[Math.min(waveform.length - 1, Math.floor((i / 12) * waveform.length))] ?? levelRms
              : levelRms;
          const weight = 0.65 + ((i % 3) * 0.25);
          const scaled = Math.min(1, Math.max(0.08, sample * 3.8 * weight + levelRms * 1.4));
          height = Math.round(6 + scaled * 12);
        }

        let backgroundColor: string;
        if (mode === 'completed') {
          const barThreshold = (i + 1) / 12;
          backgroundColor =
            playbackProgress > 0 && barThreshold <= playbackProgress
              ? 'var(--ns-accent-blue)'
              : 'var(--ns-wave-idle)';
        } else if (i < 4) {
          backgroundColor = 'var(--ns-accent-blue)';
        } else if (i >= 9) {
          backgroundColor = 'var(--ns-accent-warm)';
        } else {
          backgroundColor = 'var(--ns-wave-idle)';
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
