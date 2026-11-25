import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Download,
  FolderOpen,
  HardDrive,
  Key,
  Keyboard,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AppSettings, AsrModelInfo, DEFAULT_SUMMARY_PRESETS, Folder, GpuCapabilities, Note, SecretStatus, StorageStats, SummaryPreset, UpdateCheckResult } from '../types';
import { GranolaImportCard } from './GranolaImportCard';
import { confirmActionDialog } from './ConfirmDialog';
import {
  apiCompressRetainedAudio,
  apiDetectGpuCapabilities,
  apiGetStorageStats,
  apiOpenStorageFolder,
  apiPurgeSyncedLocalNotes,
  isTauriRuntime,
} from '../lib/tauri';

declare const __APP_VERSION__: string | undefined;

interface SettingsViewProps {
  settings: AppSettings;
  models: AsrModelInfo[];
  secretStatus: SecretStatus | null;
  downloadProgress: Record<string, number>;
  updateProgress: number | null;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onDownloadModel: (modelId: string) => Promise<void>;
  onInstallRuntime: (kind: 'whisper' | 'parakeet') => Promise<void>;
  onCheckUpdate: () => Promise<UpdateCheckResult>;
  onInstallUpdate: (downloadUrl: string, assetName: string) => Promise<string>;
  onSetSecret: (key: string, value: string) => Promise<void>;
  onExportAll: () => Promise<void>;
  onPurgeAll: () => Promise<void>;
  folders?: Folder[];
  notes?: Note[];
  onImportNotes?: (notes: Note[]) => Promise<void>;
  onRestoreBackup?: (jsonText: string) => Promise<void>;
  onExportObsidianZip?: () => void;
}

type SettingsTab = 'asr' | 'llm' | 'shortcuts' | 'storage' | 'import' | 'update';
type AsrCategory = 'whisper' | 'parakeet' | 'qwen' | 'cloud';

const OpenAILogo: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07ZM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5Zm-9.66-4.13a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65ZM2.34 7.9A4.49 4.49 0 0 1 4.68 5.93V11.6a.77.77 0 0 0 .39.67l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L3.98 14a4.5 4.5 0 0 1-1.64-6.1Zm16.6 3.86L13.1 8.36l2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.65Zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.69ZM8.31 13.5l-2.02-1.16a.08.08 0 0 1-.04-.06V6.7a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.4.68v6.73Zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z" />
  </svg>
);

const NvidiaLogo: React.FC = () => (
  <svg width="15" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8.95 8.72V6.9c.14-.01.29-.02.43-.02 3.98-.13 6.59 3.42 6.59 3.42s-2.82 3.92-5.84 3.92c-.43 0-.82-.07-1.18-.2v-5.3c1.55.19 1.86.88 2.79 2.43l2.07-1.74s-1.51-1.98-4.05-1.98c-.28 0-.55.02-.81.04v1.25zm0-4.43v1.69l.43-.03c5.54-.19 9.16 4.55 9.16 4.55s-4.15 5.05-8.48 5.05c-.38 0-.75-.04-1.11-.1v1.04c.3.04.61.06.93.06 4.03 0 6.95-2.06 9.77-4.49.47.37 2.38 1.29 2.77 1.69-2.68 2.24-8.92 4.05-12.46 4.05-.34 0-.67-.02-1-.06v2.11H24V4.29H8.95zm0 11.15v-1.23c-2.61-.46-3.33-3.17-3.33-3.17s1.25-1.39 3.33-1.61V8.05c-.12.01-.24.02-.36.04-2.55.31-4.38 2.58-4.38 2.58s1.17 3.94 4.74 4.77zM2.32 10.71s2.15-3.17 6.63-3.51V5.8C3.92 6.2 0 10.46 0 10.46s2.35 6.8 8.95 7.42v-1.46C4.07 15.81 2.32 10.71 2.32 10.71z" />
  </svg>
);

const QwenLogo: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 20.66 7 20.66 17 12 22 3.34 17 3.34 7 12 2" />
    <circle cx="12" cy="12" r="3.5" />
    <line x1="14.5" y1="14.5" x2="18" y2="18" />
  </svg>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  models,
  secretStatus,
  downloadProgress,
  updateProgress,
  onSaveSettings,
  onDownloadModel,
  onInstallRuntime,
  onCheckUpdate,
  onInstallUpdate,
  onSetSecret,
  onExportAll,
  onPurgeAll,
  folders = [],
  notes = [],
  onImportNotes,
  onRestoreBackup,
  onExportObsidianZip,
}) => {
  const [tab, setTab] = useState<SettingsTab>('asr');
  const [asrCategory, setAsrCategory] = useState<AsrCategory>(() => {
    if (settings.active_asr_provider === 'local_parakeet') return 'parakeet';
    if (settings.active_asr_provider === 'local_qwen') return 'qwen';
    if (settings.active_asr_provider.startsWith('cloud_')) return 'cloud';
    return 'whisper';
  });
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [compressingAudio, setCompressingAudio] = useState(false);
  const [gpuCaps, setGpuCaps] = useState<GpuCapabilities | null>(null);
  const [appVersion, setAppVersion] = useState<string>(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''
  );

  useEffect(() => {
    if (tab === 'asr' && isTauriRuntime()) {
      void apiDetectGpuCapabilities()
        .then((caps) => setGpuCaps(caps))
        .catch(() => {
          // ignore
        });
    }
    if (tab === 'update' && isTauriRuntime()) {
      void import('@tauri-apps/api/app')
        .then(({ getVersion }) => getVersion())
        .then((v) => setAppVersion(v))
        .catch(() => {
          // ignore
        });
      if (!updateInfo && !checkingUpdate) {
        setCheckingUpdate(true);
        setUpdateError(null);
        void onCheckUpdate()
          .then((res) => setUpdateInfo(res))
          .catch((e) => setUpdateError(e instanceof Error ? e.message : String(e)))
          .finally(() => setCheckingUpdate(false));
      }
    }
    if (tab === 'storage' && isTauriRuntime()) {
      void apiGetStorageStats()
        .then((st) => setStorageStats(st))
        .catch(() => {
          // ignore
        });
    }
  }, [tab]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const flash = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3200);
  };

  const update = (patch: Partial<AppSettings>) => {
    void onSaveSettings({ ...settings, ...patch });
  };

  const savingKeysRef = useRef<Record<string, boolean>>({});

  const saveKey = async (keyName: string) => {
    if (savingKeysRef.current[keyName]) {
      return;
    }
    const val = (secretInputs[keyName] || '').trim();
    if (!val) {
      flash('設定を保存しました');
      return;
    }
    savingKeysRef.current[keyName] = true;
    setSecretInputs((prev) => ({ ...prev, [keyName]: '' }));
    try {
      await onSetSecret(keyName, val);
      flash('APIキーを暗号化して保存しました');
    } catch (e) {
      setSecretInputs((prev) => ({ ...prev, [keyName]: val }));
      flash(`APIキーの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      savingKeysRef.current[keyName] = false;
    }
  };

  const realtimeModels = models.filter((m) => m.supports_realtime);
  const whisperModels = realtimeModels.filter((m) => m.provider === 'local_whisper');
  const parakeetModels = realtimeModels.filter((m) => m.provider === 'local_parakeet');
  const qwenModels = realtimeModels.filter((m) => m.provider === 'local_qwen');
  const cloudModels = realtimeModels.filter((m) => !m.is_local);

  const renderModelRow = (m: AsrModelInfo) => {
    const selected = settings.active_asr_model_id === m.id;
    const progress = downloadProgress[m.id];
    const cloudKeyMeta =
      m.provider === 'cloud_openai'
        ? { key: 'openai_api_key', label: 'OpenAI API Key', saved: secretStatus?.openai_api_key }
        : m.provider === 'cloud_deepgram'
        ? { key: 'deepgram_api_key', label: 'Deepgram API Key', saved: secretStatus?.deepgram_api_key }
        : m.provider === 'cloud_groq'
        ? { key: 'groq_api_key', label: 'Groq API Key', saved: secretStatus?.groq_api_key }
        : m.provider === 'cloud_stepfun'
        ? { key: 'stepfun_api_key', label: 'StepFun API Key', saved: secretStatus?.stepfun_api_key }
        : m.provider === 'cloud_google'
        ? { key: 'google_stt_api_key', label: 'Google Cloud API Key', saved: secretStatus?.google_stt_api_key }
        : null;

    return (
      <div
        key={m.id}
        className={`model-card-row ${selected ? 'selected' : ''}`}
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: selected
                    ? 'var(--accent)'
                    : m.installed
                    ? 'var(--success)'
                    : 'var(--border-strong)',
                }}
              />
              <strong style={{ fontWeight: 600 }}>{m.name}</strong>
              {m.id === 'whisper-large-v3-turbo-q5' && (
                <span className="status-chip ok">高精度・推奨</span>
              )}
              {(m.id === 'whisper-large-v3' || m.id === 'kotoba-whisper-v2') && (
                <span className="status-chip accent">最高精度 (FP16)</span>
              )}
              {(m.id === 'whisper-large-v3-turbo' || m.id === 'whisper-large-v3-q5') && (
                <span className="status-chip ok">上位モデル</span>
              )}
              {m.id === 'whisper-small-q5' && (
                <span className="status-chip">軽量・省メモリ</span>
              )}
              {m.id === 'stepfun-stepaudio-3-asr-max' && (
                <span className="status-chip ok">日本語対応・推奨</span>
              )}
              {m.id === 'stepfun-stepaudio-2.5-asr' && (
                <span className="status-chip">中英特化（日本語時は3-Maxへ自動切替）</span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
              {m.languages.map((lang) => {
                const label =
                  lang === '多言語(自動判定)' ? '多言語対応・自動判定' : lang;
                return (
                  <span key={lang} className="status-chip" style={{ height: '20px', fontSize: '11px' }}>
                    {label}
                  </span>
                );
              })}
              {!m.is_local && (
                <>
                  <span className="status-chip" style={{ height: '20px', fontSize: '11px' }}>
                    クラウドAPI
                  </span>
                  {m.supports_realtime && (
                    <span className="status-chip ok" style={{ height: '20px', fontSize: '11px' }}>
                      リアルタイム対応
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {m.is_local && !m.installed && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '32px' }}
                  disabled={progress !== undefined && progress < 100}
                  onClick={() => onDownloadModel(m.id)}
                >
                  <Download size={14} strokeWidth={1.5} />
                  {progress !== undefined && progress < 100
                    ? `${progress}%`
                    : 'ダウンロード'}
                </button>
              )}

              <button
                type="button"
                className={`btn ${selected ? 'btn-primary' : 'btn-secondary'}`}
                style={{ height: '32px' }}
                disabled={
                  !m.is_compatible ||
                  (m.is_local && !m.installed) ||
                  (!m.is_local && !settings.allow_cloud_asr)
                }
                onClick={() =>
                  update({
                    active_asr_model_id: m.id,
                    active_asr_provider: m.provider,
                  })
                }
              >
                {selected ? '使用中' : '選択する'}
              </button>
            </div>
            {m.is_local && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className="status-chip mono-num" style={{ height: '20px', fontSize: '11px' }}>
                  モデル容量 {m.size_mb}MB
                </span>
                <span className="status-chip mono-num" style={{ height: '20px', fontSize: '11px' }}>
                  メモリ目安 {m.memory_mb}MB
                </span>
              </div>
            )}
          </div>
        </div>

        {cloudKeyMeta && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <span className={`status-chip ${cloudKeyMeta.saved ? 'ok' : 'warn'}`} style={{ flexShrink: 0 }}>
              {cloudKeyMeta.saved ? 'キー保存済み' : 'キー未設定'}
            </span>
            <input
              type="password"
              className="input"
              style={{ height: '32px' }}
              placeholder={
                cloudKeyMeta.saved
                  ? `${cloudKeyMeta.label}（更新する場合のみ入力）`
                  : `${cloudKeyMeta.label} を入力`
              }
              value={secretInputs[cloudKeyMeta.key] || ''}
              onChange={(e) =>
                setSecretInputs((p) => ({ ...p, [cloudKeyMeta.key]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (secretInputs[cloudKeyMeta.key] || '').trim()) {
                  e.preventDefault();
                  void saveKey(cloudKeyMeta.key);
                }
              }}
              onBlur={() => {
                if ((secretInputs[cloudKeyMeta.key] || '').trim()) {
                  void saveKey(cloudKeyMeta.key);
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: '32px' }}
              onClick={() => saveKey(cloudKeyMeta.key)}
            >
              <Key size={13} strokeWidth={1.5} />
              保存
            </button>
          </div>
        )}
      </div>
    );
  };

  const navGroups: {
    heading: string;
    items: {
      id: SettingsTab;
      label: string;
      icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    }[];
  }[] = [
    {
      heading: 'AIモデル',
      items: [
        { id: 'asr', label: '音声認識 (ASR)', icon: Mic },
        { id: 'llm', label: 'エージェント (LLM)', icon: Sparkles },
      ],
    },
    {
      heading: 'データ管理',
      items: [
        { id: 'storage', label: 'ストレージ', icon: HardDrive },
        { id: 'import', label: 'インポート', icon: Download },
      ],
    },
    {
      heading: '一般',
      items: [
        { id: 'shortcuts', label: 'ショートカット・再生', icon: Keyboard },
        { id: 'update', label: 'アップデート', icon: RefreshCw },
      ],
    },
  ];

  const activeLlmSecretMeta =
    settings.llm_provider === 'openai'
      ? { key: 'llm_openai_api_key', label: 'OpenAI API Key', saved: secretStatus?.llm_openai_api_key }
      : settings.llm_provider === 'openai_compatible'
      ? {
          key: 'llm_openai_compatible_api_key',
          label: 'OpenAI互換 API Key',
          saved: secretStatus?.llm_openai_compatible_api_key || secretStatus?.llm_openai_api_key,
        }
      : settings.llm_provider === 'anthropic'
      ? { key: 'llm_anthropic_api_key', label: 'Anthropic API Key', saved: secretStatus?.llm_anthropic_api_key }
      : settings.llm_provider === 'gemini'
      ? { key: 'llm_gemini_api_key', label: 'Gemini API Key', saved: secretStatus?.llm_gemini_api_key }
      : null;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Left Sidebar Navigation */}
      <aside className="settings-sidebar" aria-label="設定メニュー">
        {navGroups.map((group) => (
          <div key={group.heading} style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '10px' }}>
            <div className="settings-sidebar-title">{group.heading}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={15} strokeWidth={1.5} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Right Content Body */}
      <div className="settings-body" style={{ scrollbarGutter: 'stable' }}>
        {statusMessage && (
          <div className="status-chip ok" style={{ alignSelf: 'flex-start' }}>
            <Check size={14} strokeWidth={1.5} />
            {statusMessage}
          </div>
        )}

        {/* 1. ASR Settings — Categorized */}
        {tab === 'asr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 className="section-title">音声認識 (ASR) モデル</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                エンジン別にカテゴリ分けされています。用途に合わせて選択してください。
              </p>
            </div>

            <div className="surface-subtle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px' }}>
              <span className="text-muted" style={{ fontWeight: 500 }}>認識言語（全モデル共通）</span>
              <select
                className="select"
                style={{ width: '160px', height: '34px', padding: '0 12px', lineHeight: '1.2' }}
                value={settings.language}
                onChange={(e) => update({ language: e.target.value })}
              >
                <option value="ja">日本語 (ja)</option>
                <option value="en">英語 (en)</option>
                <option value="auto">自動判定</option>
              </select>
            </div>

            {/* Category Tabs */}
            <div className="category-tabs" role="tablist" aria-label="音声認識エンジンカテゴリ">
              <button
                type="button"
                className={`category-tab ${asrCategory === 'whisper' ? 'active' : ''}`}
                onClick={() => setAsrCategory('whisper')}
              >
                <OpenAILogo />
                Whisper ({whisperModels.length})
              </button>
              <button
                type="button"
                className={`category-tab ${asrCategory === 'parakeet' ? 'active' : ''}`}
                onClick={() => setAsrCategory('parakeet')}
              >
                <NvidiaLogo />
                Parakeet ({parakeetModels.length})
              </button>
              <button
                type="button"
                className={`category-tab ${asrCategory === 'qwen' ? 'active' : ''}`}
                onClick={() => setAsrCategory('qwen')}
              >
                <QwenLogo />
                Qwen ({qwenModels.length})
              </button>
              <button
                type="button"
                className={`category-tab ${asrCategory === 'cloud' ? 'active' : ''}`}
                onClick={() => setAsrCategory('cloud')}
              >
                <Cloud size={14} strokeWidth={1.5} />
                クラウド API ({cloudModels.length})
              </button>
            </div>

            {/* Category 1: Local Whisper */}
            {asrCategory === 'whisper' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '12px' }}>whisper.cpp 実行エンジン</strong>
                    <span className={`status-chip ${settings.whisper_cli_path ? 'ok' : ''}`}>
                      {settings.whisper_cli_path ? '導入済み' : '未導入'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ height: '28px', fontSize: '12px' }}
                      disabled={downloadProgress['runtime:whisper'] !== undefined}
                      onClick={() => onInstallRuntime('whisper')}
                    >
                      {settings.whisper_cli_path ? (
                        <RefreshCw size={13} strokeWidth={1.5} />
                      ) : (
                        <Download size={13} strokeWidth={1.5} />
                      )}
                      {downloadProgress['runtime:whisper'] !== undefined
                        ? `導入中 (${downloadProgress['runtime:whisper']}%)`
                        : settings.whisper_cli_path
                        ? 'GPU/OpenBLAS版へ更新・再導入'
                        : 'ワンクリック導入'}
                    </button>
                  </div>
                </div>

                <div className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 14px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px' }}>
                    <input
                      type="checkbox"
                      checked={settings.enable_gpu_asr ?? true}
                      onChange={(e) => update({ enable_gpu_asr: e.target.checked })}
                    />
                    <span>GPU アクセラレータを有効にする（CUDA / Metal・エラー時は自動でCPUへフォールバック）</span>
                  </label>
                  {gpuCaps && (
                    <span className={`status-chip ${gpuCaps.has_cuda || gpuCaps.has_metal ? 'ok' : ''}`} style={{ fontSize: '11.5px' }}>
                      検出: {gpuCaps.gpu_name}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {whisperModels.map(renderModelRow)}
                </div>

                <details style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  <summary style={{ cursor: 'pointer' }}>実行バイナリのパスを手動で指定する</summary>
                  <div style={{ marginTop: '8px' }}>
                    <input
                      type="text"
                      className="input mono-num"
                      placeholder="例: C:\tools\whisper-cli.exe"
                      value={settings.whisper_cli_path}
                      onChange={(e) => update({ whisper_cli_path: e.target.value })}
                    />
                  </div>
                </details>
              </div>
            )}

            {/* Category 2: Local Parakeet */}
            {asrCategory === 'parakeet' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '12px' }}>sherpa-onnx 実行エンジン</strong>
                    <span className={`status-chip ${settings.parakeet_cli_path ? 'ok' : ''}`}>
                      {settings.parakeet_cli_path ? '導入済み' : '未導入'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: '28px', fontSize: '12px' }}
                    disabled={Boolean(settings.parakeet_cli_path) || downloadProgress['runtime:parakeet'] !== undefined}
                    onClick={() => onInstallRuntime('parakeet')}
                  >
                    {settings.parakeet_cli_path ? (
                      <Check size={13} strokeWidth={1.5} />
                    ) : (
                      <Download size={13} strokeWidth={1.5} />
                    )}
                    {settings.parakeet_cli_path
                      ? '導入済み'
                      : downloadProgress['runtime:parakeet'] !== undefined
                      ? `導入中 (${downloadProgress['runtime:parakeet']}%)`
                      : 'ワンクリック導入'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {parakeetModels.map(renderModelRow)}
                </div>

                <details style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  <summary style={{ cursor: 'pointer' }}>実行バイナリのパスを手動で指定する</summary>
                  <div style={{ marginTop: '8px' }}>
                    <input
                      type="text"
                      className="input mono-num"
                      placeholder="例: C:\tools\sherpa-onnx-offline.exe"
                      value={settings.parakeet_cli_path}
                      onChange={(e) => update({ parakeet_cli_path: e.target.value })}
                    />
                  </div>
                </details>
              </div>
            )}

            {/* Category 3: Local Qwen */}
            {asrCategory === 'qwen' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="surface-subtle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <strong style={{ fontSize: '12px' }}>実行エンジン（sherpa-onnx-offline）</strong>
                    <div className="text-muted">
                      {settings.parakeet_cli_path
                        ? `設定済み: ${settings.parakeet_cli_path}`
                        : 'Qwen3-ASR は Parakeet と共通の sherpa-onnx-offline 実行エンジンが必要です'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: '28px', fontSize: '12px' }}
                    disabled={downloadProgress['runtime:parakeet'] !== undefined}
                    onClick={() => onInstallRuntime('parakeet')}
                  >
                    {downloadProgress['runtime:parakeet'] !== undefined ? (
                      <Loader2 size={13} strokeWidth={1.5} className="spin" />
                    ) : (
                      <Download size={13} strokeWidth={1.5} />
                    )}
                    {settings.parakeet_cli_path
                      ? '導入済み'
                      : downloadProgress['runtime:parakeet'] !== undefined
                      ? `導入中 (${downloadProgress['runtime:parakeet']}%)`
                      : 'ワンクリック導入'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {qwenModels.map(renderModelRow)}
                </div>

                <details style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  <summary style={{ cursor: 'pointer' }}>実行バイナリのパスを手動で指定する</summary>
                  <div style={{ marginTop: '8px' }}>
                    <input
                      type="text"
                      className="input mono-num"
                      placeholder="例: C:\tools\sherpa-onnx-offline.exe"
                      value={settings.parakeet_cli_path}
                      onChange={(e) => update({ parakeet_cli_path: e.target.value })}
                    />
                  </div>
                </details>
              </div>
            )}

            {/* Category 4: Cloud ASR */}
            {asrCategory === 'cloud' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label className="surface-subtle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div>
                    <strong style={{ fontSize: '12px' }}>クラウド音声認識を有効にする</strong>
                    <div className="text-muted">有効時のみ、選択したクラウドAPIへ音声を送信します（録音中は約3秒ごとにリアルタイム文字起こし、停止時に全体で最終確定します）</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.allow_cloud_asr}
                    onChange={(e) => update({ allow_cloud_asr: e.target.checked })}
                  />
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {cloudModels.map(renderModelRow)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. LLM Settings — Categorized by Provider */}
        {tab === 'llm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 className="section-title">エージェント (LLM) 設定</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                要約・チャット検索・ノート操作エージェントで使用するプロバイダーを選択してください（音声ファイルは送信されません）。
              </p>
            </div>

            <div className="category-tabs" role="tablist" aria-label="LLMプロバイダー選択">
              {(
                [
                  { id: 'openai_compatible', label: 'OpenAI互換 (OpenRouter等)' },
                  { id: 'openai', label: 'OpenAI' },
                  { id: 'gemini', label: 'Google Gemini' },
                  { id: 'anthropic', label: 'Anthropic' },
                  { id: 'ollama', label: 'ローカル Ollama' },
                  { id: 'none', label: 'オフ' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`category-tab ${settings.llm_provider === p.id ? 'active' : ''}`}
                  onClick={() => {
                    const patch: Partial<AppSettings> = { llm_provider: p.id };
                    if (p.id === 'ollama') {
                      if (
                        !settings.llm_endpoint ||
                        settings.llm_endpoint.includes('openrouter.ai') ||
                        settings.llm_endpoint.includes('groq.com')
                      ) {
                        patch.llm_endpoint = 'http://localhost:11434';
                      }
                      if (!settings.llm_model || settings.llm_model === 'gpt-4o-mini' || settings.llm_model.includes('/')) {
                        patch.llm_model = 'qwen2.5:7b';
                      }
                    } else if (p.id === 'openai_compatible') {
                      if (!settings.llm_endpoint || settings.llm_endpoint === 'http://localhost:11434') {
                        patch.llm_endpoint = 'https://openrouter.ai/api/v1';
                      }
                    }
                    update(patch);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {settings.llm_provider === 'none' ? (
              <div className="surface-subtle">
                <p className="text-secondary" style={{ margin: '0px' }}>
                  AI機能はオフになっています。チャット画面ではノート内のキーワード検索結果が表示されます。
                </p>
              </div>
            ) : (
              <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {settings.llm_provider === 'openai_compatible' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <label className="text-muted">ベース URL</label>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="chip-filter"
                          onClick={() => update({ llm_endpoint: 'https://openrouter.ai/api/v1' })}
                        >
                          OpenRouter
                        </button>
                        <button
                          type="button"
                          className="chip-filter"
                          onClick={() => update({ llm_endpoint: 'https://api.groq.com/openai/v1' })}
                        >
                          Groq
                        </button>
                        <button
                          type="button"
                          className="chip-filter"
                          onClick={() => update({ llm_endpoint: 'http://localhost:1234/v1' })}
                        >
                          LM Studio (ローカル)
                        </button>
                      </div>
                    </div>
                    <input
                      type="url"
                      className="input"
                      placeholder="https://openrouter.ai/api/v1"
                      value={settings.llm_endpoint}
                      onChange={(e) => update({ llm_endpoint: e.target.value })}
                    />
                  </div>
                )}

                {settings.llm_provider === 'ollama' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="text-muted">Ollama エンドポイント URL</label>
                    <input
                      type="url"
                      className="input"
                      placeholder="http://localhost:11434"
                      value={settings.llm_endpoint}
                      onChange={(e) => update({ llm_endpoint: e.target.value })}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <label className="text-muted">モデル名</label>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {settings.llm_provider === 'openai' &&
                        ['gpt-4o-mini', 'gpt-4o'].map((preset) => (
                          <button key={preset} type="button" className="chip-filter" onClick={() => update({ llm_model: preset })}>
                            {preset}
                          </button>
                        ))}
                      {settings.llm_provider === 'gemini' &&
                        ['gemini-2.5-flash', 'gemini-2.5-pro'].map((preset) => (
                          <button key={preset} type="button" className="chip-filter" onClick={() => update({ llm_model: preset })}>
                            {preset}
                          </button>
                        ))}
                      {settings.llm_provider === 'anthropic' &&
                        ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'].map((preset) => (
                          <button key={preset} type="button" className="chip-filter" onClick={() => update({ llm_model: preset })}>
                            {preset}
                          </button>
                        ))}
                      {settings.llm_provider === 'ollama' &&
                        ['qwen2.5:7b', 'llama3.2'].map((preset) => (
                          <button key={preset} type="button" className="chip-filter" onClick={() => update({ llm_model: preset })}>
                            {preset}
                          </button>
                        ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={settings.llm_model}
                    onChange={(e) => update({ llm_model: e.target.value })}
                    placeholder={
                      settings.llm_provider === 'openai_compatible'
                        ? '例: openai/gpt-4o-mini / google/gemini-2.5-flash'
                        : 'モデル名を入力'
                    }
                  />
                </div>

                {activeLlmSecretMeta && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="text-muted">{activeLlmSecretMeta.label}</label>
                      <span className={`status-chip ${activeLlmSecretMeta.saved ? 'ok' : 'warn'}`}>
                        {activeLlmSecretMeta.saved ? '保存済み' : '未設定'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="password"
                        className="input"
                        placeholder={
                          activeLlmSecretMeta.saved
                            ? '保存済み（更新する場合のみ新しいキーを入力）'
                            : 'APIキーを入力（入力後に保存を押してください）'
                        }
                        value={secretInputs[activeLlmSecretMeta.key] || ''}
                        onChange={(e) =>
                          setSecretInputs((p) => ({
                            ...p,
                            [activeLlmSecretMeta.key]: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          if ((secretInputs[activeLlmSecretMeta.key] || '').trim()) {
                            void saveKey(activeLlmSecretMeta.key);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => saveKey(activeLlmSecretMeta.key)}
                      >
                        <Key size={14} strokeWidth={1.5} />
                        保存
                      </button>
                    </div>
                  </div>
                )}

              </div>
            )}

            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label className="text-muted" style={{ fontWeight: 600 }}>
                独自ルール・カスタムプロンプト（事前設定可）
              </label>
              <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
                AIプロバイダー設定前でも事前にルールを保存できます。要約・チャット実行時に毎回適用されます。
              </p>
              <textarea
                aria-label="独自ルール・カスタムプロンプト"
                className="textarea"
                rows={3}
                placeholder="例: 回答は常に結論から箇条書きで記述してください。専門用語には簡単な補足を添えてください。"
                value={settings.llm_custom_prompt || ''}
                onChange={(e) => update({ llm_custom_prompt: e.target.value })}
              />
            </div>

            {(() => {
              const presets: SummaryPreset[] =
                settings.summary_presets && settings.summary_presets.length > 0
                  ? settings.summary_presets
                  : DEFAULT_SUMMARY_PRESETS;
              const updatePresets = (nextPresets: SummaryPreset[], nextActiveId?: string) => {
                update({
                  summary_presets: nextPresets,
                  ...(nextActiveId ? { active_template_id: nextActiveId } : {}),
                });
              };
              return (
                <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <strong style={{ fontSize: '13px' }}>要約プリセットの作成・編集</strong>
                      <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '12px' }}>
                        ノートの要約生成時に選べるプリセットを自由に作成・編集できます。
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ height: '30px', fontSize: '12px' }}
                        onClick={() => {
                          const newPreset: SummaryPreset = {
                            id: `custom-${Date.now()}`,
                            name: '新しいプリセット',
                            prompt: 'summaryフィールドには「## 概要」「## 重要ポイント」「## ネクストアクション」の見出しを使って整理してください。',
                          };
                          updatePresets([...presets, newPreset]);
                        }}
                      >
                        <Plus size={13} strokeWidth={1.75} />
                        プリセットを追加
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ height: '30px', fontSize: '12px' }}
                        onClick={() => updatePresets(DEFAULT_SUMMARY_PRESETS, 'standard')}
                      >
                        デフォルトに戻す
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {presets.map((preset) => {
                      const isDefault = (settings.active_template_id || 'standard') === preset.id;
                      return (
                        <div
                          key={preset.id}
                          style={{
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '10px',
                            padding: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            backgroundColor: 'var(--bg-subtle)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              aria-label={`プリセット名 (${preset.name})`}
                              className="input"
                              style={{ flex: 1, minWidth: '160px', height: '32px', fontSize: '13px' }}
                              value={preset.name}
                              placeholder="プリセット名"
                              onChange={(e) => {
                                const next = presets.map((p) =>
                                  p.id === preset.id ? { ...p, name: e.target.value } : p
                                );
                                updatePresets(next);
                              }}
                            />
                            <button
                              type="button"
                              className={`chip-filter ${isDefault ? 'active' : ''}`}
                              style={{ height: '28px', fontSize: '12px' }}
                              onClick={() => update({ active_template_id: preset.id })}
                            >
                              {isDefault ? '既定のプリセット' : '既定にする'}
                            </button>
                            {presets.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                aria-label={`${preset.name}を削除`}
                                style={{ height: '28px', padding: '0 8px', color: 'var(--danger)' }}
                                onClick={() => {
                                  const next = presets.filter((p) => p.id !== preset.id);
                                  const nextActive = isDefault ? next[0]?.id : undefined;
                                  updatePresets(next, nextActive);
                                }}
                              >
                                <Trash2 size={13} strokeWidth={1.75} />
                              </button>
                            )}
                          </div>
                          <textarea
                            aria-label={`プリセット指示 (${preset.name})`}
                            className="textarea"
                            rows={2}
                            style={{ fontSize: '12.5px' }}
                            value={preset.prompt}
                            placeholder="要約の構成やフォーマットの指示を入力..."
                            onChange={(e) => {
                              const next = presets.map((p) =>
                                p.id === preset.id ? { ...p, prompt: e.target.value } : p
                              );
                              updatePresets(next);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 3. Shortcuts */}
        {tab === 'shortcuts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 className="section-title">ショートカットキー</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                どのアプリを開いていても録音や音声入力を呼び出せます。
              </p>
            </div>
            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>
                  録音開始 / 停止
                </label>
                <input
                  type="text"
                  className="input mono-num"
                  value={settings.record_shortcut}
                  onChange={(e) => update({ record_shortcut: e.target.value })}
                />
              </div>
              <div>
                <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>
                  音声入力 (Voice Typing)
                </label>
                <input
                  type="text"
                  className="input mono-num"
                  value={settings.voice_typing_shortcut}
                  onChange={(e) => update({ voice_typing_shortcut: e.target.value })}
                />
              </div>
            </div>
            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <strong style={{ fontSize: '13px' }}>音声再生設定</strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.silence_skip_enabled)}
                  onChange={(e) => update({ silence_skip_enabled: e.target.checked })}
                />
                <span>無音スキップ機能を有効にする（再生時に無音区間を自動で早送り）</span>
              </label>
            </div>
          </div>
        )}

        {/* 4. Data Management: Storage */}
        {tab === 'storage' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 className="section-title">ストレージ管理</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                録音ファイルの容量管理・軽量化やデータの暗号化・バックアップを管理します。
              </p>
            </div>

            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <HardDrive size={15} strokeWidth={1.5} />
                  <strong style={{ fontSize: '13px' }}>ストレージ使用状況</strong>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: '28px', fontSize: '12px' }}
                    onClick={async () => {
                      if (isTauriRuntime()) {
                        await apiOpenStorageFolder();
                      }
                    }}
                  >
                    <FolderOpen size={13} strokeWidth={1.5} />
                    保存フォルダを開く
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: '28px', fontSize: '12px' }}
                    disabled={compressingAudio}
                    onClick={async () => {
                      if (!isTauriRuntime()) {
                        flash('録音音声を軽量化しました');
                        return;
                      }
                      setCompressingAudio(true);
                      try {
                        const res = await apiCompressRetainedAudio();
                        setStorageStats(res.stats);
                        flash(
                          res.compressed_count > 0
                            ? `${res.compressed_count} 件の録音を軽量化しました（-${formatBytes(res.saved_bytes)}）`
                            : 'すべての録音ファイルは既に最適化されています'
                        );
                      } finally {
                        setCompressingAudio(false);
                      }
                    }}
                  >
                    {compressingAudio ? '軽量化中...' : '録音音声を軽量化（容量圧縮）'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <span className="status-chip mono-num">
                  録音音声: {storageStats ? `${formatBytes(storageStats.audio_bytes)} (${storageStats.audio_count}件)` : '0 B (0件)'}
                </span>
                <span className="status-chip mono-num">
                  ローカルモデル: {storageStats ? formatBytes(storageStats.models_bytes) : '0 B'}
                </span>
              </div>
            </div>

            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ fontSize: '13px' }}>Notion オンラインビュワーモード</strong>
                  <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '12px' }}>
                    Google Keep のように、同期済みノートの本体や録音音声をローカルから削除し、Notion 上のデータを直接閲覧します。
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '28px', fontSize: '12px' }}
                  onClick={async () => {
                    const ok = await confirmActionDialog(
                      '同期済みノートのローカルデータを削除して「Notionのみ」にしますか？',
                      'Notion 上のデータは保持され、Notelet からオンライン閲覧できます。',
                      '整理する'
                    );
                    if (!ok) return;
                    if (isTauriRuntime()) {
                      await apiPurgeSyncedLocalNotes();
                      const stats = await apiGetStorageStats();
                      setStorageStats(stats);
                    }
                    flash('同期済みノートを Notion オンラインのみに整理しました');
                  }}
                >
                  同期済みノートのローカルデータを整理
                </button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(settings.notion_viewer_mode)}
                  onChange={(e) => {
                    update({ notion_viewer_mode: e.target.checked });
                  }}
                />
                <span>Notion 同期後にローカルの本文・音声を自動削除する</span>
              </label>
            </div>

            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.encrypt_retained_audio}
                  onChange={(e) => update({ encrypt_retained_audio: e.target.checked })}
                />
                <span>保持する音声ファイルを AES-256-GCM で暗号化する</span>
              </label>
            </div>

            <div className="surface-card" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn btn-secondary" onClick={onExportAll}>
                全データをJSONエクスポート
              </button>

              {onExportObsidianZip && (
                <button type="button" className="btn btn-secondary" onClick={onExportObsidianZip}>
                  Markdown / Obsidian 一括エクスポート (ZIP)
                </button>
              )}

              {onRestoreBackup && (
                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                  JSON バックアップから復元
                  <input
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      try {
                        const text = await file.text();
                        await onRestoreBackup(text);
                        flash('JSON バックアップを復元・マージしました');
                      } catch (err) {
                        flash(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  />
                </label>
              )}

              {!confirmPurge ? (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmPurge(true)}>
                  全ノートを初期化
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={async () => {
                      await onPurgeAll();
                      setConfirmPurge(false);
                      flash('全ノートを消去しました');
                    }}
                  >
                    消去を確定
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmPurge(false)}>
                    キャンセル
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. Data Management: Import */}
        {tab === 'import' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 className="section-title">データインポート</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                外部ノートアプリ（Granola 等）からのデータ移行を行います。
              </p>
            </div>
            {onImportNotes && (
              <GranolaImportCard
                folders={folders}
                existingNotes={notes}
                onImportNotes={onImportNotes}
              />
            )}
          </div>
        )}

        {/* 6. App Update */}
        {tab === 'update' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 className="section-title">アプリ更新</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                GitHub Releases から最新バージョンを確認してワンクリックで更新できます。
              </p>
            </div>

            <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  現在のバージョン: <strong className="mono-num">v{updateInfo?.current_version ?? (appVersion || '...')}</strong>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={checkingUpdate || installingUpdate}
                  onClick={async () => {
                    setCheckingUpdate(true);
                    setUpdateError(null);
                    try {
                      const res = await onCheckUpdate();
                      setUpdateInfo(res);
                    } catch (e) {
                      setUpdateError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setCheckingUpdate(false);
                    }
                  }}
                >
                  {checkingUpdate ? (
                    <Loader2 size={14} strokeWidth={1.5} className="spin" />
                  ) : (
                    <RefreshCw size={14} strokeWidth={1.5} />
                  )}
                  {checkingUpdate ? '確認中...' : '最新リリースを確認'}
                </button>
              </div>

              {updateError && (
                <div className="surface-subtle" style={{ color: 'var(--danger)' }}>
                  {updateError}
                </div>
              )}

              {updateInfo && (
                <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span className={`status-chip ${updateInfo.has_update ? 'accent' : 'ok'}`}>
                      {updateInfo.has_update
                        ? `新しいバージョン v${updateInfo.latest_version} が利用可能です`
                        : `最新の状態です (v${updateInfo.current_version})`}
                    </span>
                    {updateInfo.has_update && updateInfo.download_url && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={installingUpdate}
                        onClick={async () => {
                          if (!updateInfo.download_url) return;
                          setInstallingUpdate(true);
                          setUpdateError(null);
                          try {
                            const msg = await onInstallUpdate(
                              updateInfo.download_url,
                              updateInfo.asset_name || 'Notelet-Setup.exe'
                            );
                            flash(msg);
                          } catch (e) {
                            setUpdateError(e instanceof Error ? e.message : String(e));
                          } finally {
                            setInstallingUpdate(false);
                          }
                        }}
                      >
                        {installingUpdate ? (
                          <Loader2 size={14} strokeWidth={1.5} className="spin" />
                        ) : (
                          <Download size={14} strokeWidth={1.5} />
                        )}
                        {installingUpdate
                          ? updateProgress !== null
                            ? `ダウンロード中 (${updateProgress}%)`
                            : '更新中...'
                          : `v${updateInfo.latest_version} に今すぐアップデート`}
                      </button>
                    )}
                    {updateInfo.has_update && !updateInfo.download_url && (
                      <a
                        href={updateInfo.release_url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                        style={{ textDecoration: 'none' }}
                      >
                        <Download size={14} strokeWidth={1.5} />
                        リリースページからダウンロード
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
