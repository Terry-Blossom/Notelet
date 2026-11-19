import React from 'react';
import { Pause, Play, Square, AlertTriangle, Copy, Check } from 'lucide-react';
import { AppSettings, RecordingStatus } from '../types';
import { formatMs } from '../lib/format';
import { WaveformMeter } from './WaveformMeter';

interface RecordingViewProps {
  status: RecordingStatus;
  settings: AppSettings;
  manualNotes: string;
  onChangeManualNotes: (val: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStopAndFinish: () => void;
  onCopyNotice: (text: string) => void;
}

export const RecordingView: React.FC<RecordingViewProps> = ({
  status,
  settings,
  manualNotes,
  onChangeManualNotes,
  onPause,
  onResume,
  onStopAndFinish,
  onCopyNotice,
}) => {
  const [noticeCopied, setNoticeCopied] = React.useState(false);
  const isPaused = status.state === 'paused';
  const isError = status.state === 'error';

  const handleCopyNotice = () => {
    onCopyNotice(settings.participant_notice_text);
    setNoticeCopied(true);
    setTimeout(() => setNoticeCopied(false), 1800);
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className={`status-chip ${isError ? 'danger' : isPaused ? 'warn' : 'danger'}`}>
            <span className="status-dot" />
            {isError ? '録音エラー（途中データを保護）' : isPaused ? '一時停止中' : '録音中'}
          </span>
          <span className="mono-num" style={{ fontSize: '24px', fontWeight: 600 }}>
            {formatMs(status.elapsed_ms)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isError && (
            isPaused ? (
              <button type="button" className="btn btn-secondary" onClick={onResume}>
                <Play size={16} strokeWidth={1.5} />
                再開
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onPause}>
                <Pause size={16} strokeWidth={1.5} />
                一時停止
              </button>
            )
          )}
          <button type="button" className="btn btn-danger" onClick={onStopAndFinish}>
            <Square size={16} strokeWidth={1.5} />
            {isError ? '途中までの録音を確認' : '録音を停止して文字起こし'}
          </button>
        </div>
      </div>

      {/* Device & Waveform */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            入力デバイス: <strong style={{ color: 'var(--text-primary)' }}>{status.device_name || '既定デバイス'}</strong>
          </div>
          <div className="text-muted">
            ローカルWAVへ逐次保存中
          </div>
        </div>

        <WaveformMeter
          waveform={status.waveform}
          levelRms={status.level_rms}
          paused={isPaused || isError}
        />

        {status.is_silent_warning && !isPaused && !isError && (
          <div
            className="surface-subtle"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              backgroundColor: 'var(--warning-bg)',
              color: 'var(--warning)',
              borderColor: 'rgba(154, 91, 0, 0.24)',
            }}
          >
            <AlertTriangle size={16} strokeWidth={1.5} />
            <span style={{ fontSize: '14px' }}>
              音声入力が検出されていません（無音状態）。マイクのミュートや入力デバイスの選択を確認してください。
            </span>
          </div>
        )}

        {isError && status.error_message && (
          <div
            className="surface-subtle"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              backgroundColor: 'var(--danger-bg)',
              color: 'var(--danger)',
              borderColor: 'rgba(198, 40, 40, 0.25)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '14px' }}>{status.error_message}</div>
            {status.recovery_hint && (
              <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{status.recovery_hint}</div>
            )}
          </div>
        )}
      </section>

      {/* Participant Notice */}
      {(settings.participant_notice_enabled || settings.admin_enforced_notice) && (
        <section className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '14px' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              参加者への案内文{settings.admin_enforced_notice ? '（管理者設定）' : ''}
            </div>
            <div className="text-secondary">{settings.participant_notice_text}</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleCopyNotice}>
            {noticeCopied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
            {noticeCopied ? 'コピー済み' : '案内文をコピー'}
          </button>
        </section>
      )}

      {/* Manual Notes while Recording */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label htmlFor="live-manual-notes" className="section-title">
          録音中の手入力メモ
        </label>
        <p className="text-muted" style={{ margin: 0 }}>
          話しながら気になった点やキーワードを残すと、文字起こしと合わせて整理できます
        </p>
        <textarea
          id="live-manual-notes"
          className="textarea"
          style={{ minHeight: '200px' }}
          placeholder="議題、決定したこと、確認したい項目を入力"
          value={manualNotes}
          onChange={(e) => onChangeManualNotes(e.target.value)}
        />
      </section>
    </div>
  );
};
