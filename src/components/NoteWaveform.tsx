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
  const hasVoiceSignal = mode === 'recording' && levelRms >= 0.015;

  return (
    <div className="note-waveform" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        let height = 4;

        if (mode === 'completed') {
          height = COMPLETED_HEIGHTS[i] ?? 8;
        } else if (hasVoiceSignal && !reducedMotion) {
          const sample =
            waveform.length > 0
              ? waveform[Math.min(waveform.length - 1, Math.floor((i / BAR_COUNT) * waveform.length))] ?? levelRms
              : levelRms;
          const weight = 0.7 + ((i % 3) * 0.2);
          const scaled = Math.min(1, Math.max(0, sample * 3.5 * weight + levelRms * 1.2));
          height = Math.round(4 + scaled * 12);
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
