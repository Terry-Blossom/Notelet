import React from 'react';
import { t } from '../i18n';

interface WaveformMeterProps {
  waveform: number[];
  levelRms: number;
  paused: boolean;
}

export const WaveformMeter: React.FC<WaveformMeterProps> = ({
  waveform,
  levelRms,
  paused,
}) => {
  const bars = waveform.length > 0 ? waveform : new Array(48).fill(0);

  return (
    <div
      aria-label={t('入力音量 {0}%', [Math.round(levelRms * 100)])}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        height: '64px',
        padding: '0 12px',
        backgroundColor: 'var(--bg-subtle)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {bars.map((v, i) => {
        const clamped = paused ? 0.06 : Math.max(0.06, Math.min(1, v * 4.5));
        const pct = Math.round(clamped * 100);
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${pct}%`,
              minHeight: '4px',
              borderRadius: '2px',
              backgroundColor: paused
                ? 'var(--text-muted)'
                : clamped > 0.72
                  ? 'var(--danger)'
                  : 'var(--accent)',
              transition: 'height 80ms linear',
            }}
          />
        );
      })}
    </div>
  );
};
