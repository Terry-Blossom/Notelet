import React from 'react';
import { Mic, Monitor, Layers, FileAudio, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  AppSettings,
  AsrModelInfo,
  AudioDeviceInfo,
  AudioSourceMode,
  Note,
  SecretStatus,
} from '../types';
import { formatDateTime, formatMs } from '../lib/format';

interface HomeViewProps {
  settings: AppSettings;
  models: AsrModelInfo[];
  devices: AudioDeviceInfo[];
  sourceMode: AudioSourceMode;
  selectedDeviceId: string;
  notes: Note[];
  secretStatus: SecretStatus | null;
  onChangeSourceMode: (mode: AudioSourceMode) => void;
  onChangeDevice: (deviceId: string) => void;
  onStartRecording: () => void;
  onOpenNote: (noteId: string) => void;
  onCreateManualNote: () => void;
  onGoSettings: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  settings,
  models,
  devices,
  sourceMode,
  selectedDeviceId,
  notes,
  secretStatus,
  onChangeSourceMode,
  onChangeDevice,
  onStartRecording,
  onOpenNote,
  onCreateManualNote,
  onGoSettings,
}) => {
  const activeModel = models.find((m) => m.id === settings.active_asr_model_id);
  const filteredDevices = devices.filter((d) =>
    sourceMode === 'system' ? d.kind === 'loopback' : d.kind === 'input'
  );
  const notionConnected = Boolean(secretStatus?.notion_access_token);
  const recentNotes = notes.slice(0, 6);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">録音と文字起こし</h1>
          <p className="text-secondary" style={{ margin: '4px 0 0' }}>
            録音ボタンを押して話し、文字起こしを整えて貼り付けや Notion へ保存します
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onCreateManualNote}>
          空のノートを作成
        </button>
      </div>

      {/* Main Recording Card */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-record"
              onClick={onStartRecording}
            >
              <Mic size={18} strokeWidth={1.5} />
              録音を開始
            </button>
            <span className="kbd-cap">{settings.record_shortcut}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className={`status-chip ${activeModel?.is_compatible && activeModel?.installed ? 'ok' : 'warn'}`}>
              <span className="status-dot" />
              {activeModel ? activeModel.name : 'ASRモデル未選択'}
            </span>
            <span className={`status-chip ${notionConnected ? 'ok' : ''}`}>
              <span className="status-dot" />
              {notionConnected ? 'Notion 接続済み' : 'Notion 未接続'}
            </span>
          </div>
        </div>

        {/* Input Source & Device */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              録音入力
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(
                [
                  { id: 'mic', label: 'マイク', icon: Mic },
                  { id: 'system', label: 'システム音声', icon: Monitor },
                  { id: 'both', label: '両方', icon: Layers },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = sourceMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1 }}
                    onClick={() => onChangeSourceMode(item.id)}
                  >
                    <Icon size={16} strokeWidth={1.5} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="audio-device-select"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}
            >
              入力デバイス
            </label>
            <select
              id="audio-device-select"
              className="select"
              value={selectedDeviceId}
              onChange={(e) => onChangeDevice(e.target.value)}
            >
              <option value="">OSの既定デバイスを使用</option>
              {filteredDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.is_default ? '（既定）' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Honest Model & Compliance Status */}
        <div
          className="surface-subtle"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
            {activeModel && activeModel.is_compatible && activeModel.installed ? (
              <CheckCircle2 size={16} strokeWidth={1.5} color="var(--success)" />
            ) : (
              <AlertCircle size={16} strokeWidth={1.5} color="var(--warning)" />
            )}
            <span>
              {activeModel
                ? activeModel.compatibility_reason
                  ? activeModel.compatibility_reason
                  : !activeModel.installed
                    ? `${activeModel.name} は未ダウンロードです（録音と保存は可能、文字起こし前に設定から取得できます）`
                    : activeModel.data_handling
                : 'モデル未設定でも録音・メモ・コピーは利用できます'}
            </span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onGoSettings}>
            モデルと連携を設定
            <ArrowRight size={14} strokeWidth={1.5} />
          </button>
        </div>

        <p className="text-muted" style={{ margin: 0 }}>
          録音前に、会話の相手へ録音・文字起こしの同意を得て、お住まいの地域の法令に従ってください。Botとして会議へ自動参加することはありません。
        </p>
      </section>

      {/* Recent Notes */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="section-title">最近のノート</h2>
        {recentNotes.length === 0 ? (
          <div className="surface-subtle" style={{ color: 'var(--text-secondary)' }}>
            ノートはまだありません。上の「録音を開始」を押して最初の記録を作成できます。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recentNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="surface-card"
                onClick={() => onOpenNote(note.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  padding: '12px 16px',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <FileAudio size={16} strokeWidth={1.5} color="var(--text-muted)" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {note.title || '無題のノート'}
                    </div>
                    <div className="text-muted">
                      {formatDateTime(note.created_at)} · {note.asr_provider_label}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <span className="mono-num text-muted">{formatMs(note.duration_sec * 1000)}</span>
                  {note.notion_sync.status === 'synced' && (
                    <span className="status-chip ok">Notion保存済み</span>
                  )}
                  {note.notion_sync.status === 'failed' && (
                    <span className="status-chip danger">Notion未完了</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
