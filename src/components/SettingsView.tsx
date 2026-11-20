import React, { useState } from 'react';
import { Download, Key, Check, Loader2, RefreshCw } from 'lucide-react';
import { AppSettings, AsrModelInfo, SecretStatus, UpdateCheckResult } from '../types';

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
}

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
}) => {
  const [tab, setTab] = useState<'asr' | 'llm' | 'shortcuts' | 'privacy' | 'update' | 'credits'>('asr');
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const flash = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const update = (patch: Partial<AppSettings>) => {
    void onSaveSettings({ ...settings, ...patch });
  };

  const saveKey = async (keyName: string) => {
    const val = (secretInputs[keyName] || '').trim();
    if (!val) {
      flash('設定を保存しました');
      return;
    }
    await onSetSecret(keyName, val);
    setSecretInputs((prev) => ({ ...prev, [keyName]: '' }));
    flash('APIキーを暗号化して保存しました');
  };

  return (
    <div className="page-container">
      <div>
        <h1 className="page-title">設定</h1>
        <p className="text-secondary" style={{ margin: '4px 0 0' }}>
          ASRモデル、AI・LLM、ショートカット、プライバシー設定を行います
        </p>
      </div>

      {statusMessage && (
        <div className="status-chip ok" style={{ alignSelf: 'flex-start' }}>
          <Check size={14} strokeWidth={1.5} />
          {statusMessage}
        </div>
      )}

      <div className="tabs-row">
        {(
          [
            { id: 'asr', label: 'ASRモデル' },
            { id: 'llm', label: 'AI・LLM' },
            { id: 'shortcuts', label: 'ショートカット' },
            { id: 'privacy', label: 'プライバシー・データ' },
            { id: 'update', label: 'アップデート' },
            { id: 'credits', label: 'クレジット' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 1. ASR Models */}
      {tab === 'asr' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section className="surface-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>文字起こし言語</label>
              <select
                className="select"
                value={settings.language}
                onChange={(e) => update({ language: e.target.value })}
              >
                <option value="ja">日本語 (ja)</option>
                <option value="en">英語 (en)</option>
                <option value="auto">自動判定 (auto)</option>
              </select>
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>whisper-cli パス（任意）</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="例: C:\tools\whisper-cli.exe"
                  value={settings.whisper_cli_path}
                  onChange={(e) => update({ whisper_cli_path: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flexShrink: 0 }}
                  disabled={downloadProgress['runtime:whisper'] !== undefined && downloadProgress['runtime:whisper'] < 100}
                  onClick={() => onInstallRuntime('whisper')}
                >
                  {downloadProgress['runtime:whisper'] !== undefined && downloadProgress['runtime:whisper'] < 100 ? (
                    <Loader2 size={14} strokeWidth={1.5} className="spin" />
                  ) : (
                    <Download size={14} strokeWidth={1.5} />
                  )}
                  {downloadProgress['runtime:whisper'] !== undefined && downloadProgress['runtime:whisper'] < 100
                    ? `${downloadProgress['runtime:whisper']}%`
                    : 'whisper.cpp を導入'}
                </button>
              </div>
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>sherpa-onnx-offline パス（Parakeet用）</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="例: C:\tools\sherpa-onnx-offline.exe"
                  value={settings.parakeet_cli_path}
                  onChange={(e) => update({ parakeet_cli_path: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flexShrink: 0 }}
                  disabled={downloadProgress['runtime:parakeet'] !== undefined && downloadProgress['runtime:parakeet'] < 100}
                  onClick={() => onInstallRuntime('parakeet')}
                >
                  {downloadProgress['runtime:parakeet'] !== undefined && downloadProgress['runtime:parakeet'] < 100 ? (
                    <Loader2 size={14} strokeWidth={1.5} className="spin" />
                  ) : (
                    <Download size={14} strokeWidth={1.5} />
                  )}
                  {downloadProgress['runtime:parakeet'] !== undefined && downloadProgress['runtime:parakeet'] < 100
                    ? `${downloadProgress['runtime:parakeet']}%`
                    : 'sherpa-onnx を導入'}
                </button>
              </div>
            </div>
          </section>

          <section className="surface-subtle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600 }}>クラウドASRへの音声送信を許可</div>
              <div className="text-muted">既定はオフ（ローカル処理のみ）です。ローカル失敗時にクラウドへ自動フォールバックしません。</div>
            </div>
            <input
              type="checkbox"
              aria-label="クラウドASRへの送信を許可"
              checked={settings.allow_cloud_asr}
              onChange={(e) => update({ allow_cloud_asr: e.target.checked })}
            />
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {models.map((m) => {
              const selected = settings.active_asr_model_id === m.id;
              const progress = downloadProgress[m.id];
              return (
                <div key={m.id} className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '15px' }}>{m.name}</span>
                        <span className={`status-chip ${m.is_local ? 'ok' : 'accent'}`}>
                          {m.is_local ? 'ローカル' : 'クラウド (BYOK)'}
                        </span>
                        {m.installed && m.is_local && <span className="status-chip ok">取得済み</span>}
                        {selected && <span className="status-chip ok">使用中</span>}
                      </div>
                      <div className="text-muted" style={{ marginTop: '4px' }}>
                        言語: {m.languages.join(' / ')} · 環境: {m.environment} · ライセンス: {m.license}
                      </div>
                      <div className="text-muted">
                        必要メモリ: {m.memory_mb > 0 ? `${m.memory_mb} MB` : 'なし（API）'} · サイズ: {m.size_mb > 0 ? `${m.size_mb} MB` : '-'} ·
                        リアルタイム: {m.supports_realtime ? '対応' : '録音後処理'} ·
                        自動話者識別: {m.supports_diarization ? '対応' : '未対応（手動割り当て）'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {m.is_local && !m.installed && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={progress !== undefined && progress < 100}
                          onClick={() => onDownloadModel(m.id)}
                        >
                          <Download size={15} strokeWidth={1.5} />
                          {progress !== undefined && progress < 100 ? `取得中 ${progress}%` : 'モデルを取得'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn ${selected ? 'btn-primary' : 'btn-secondary'}`}
                        disabled={!m.is_local && !settings.allow_cloud_asr}
                        onClick={() =>
                          update({ active_asr_model_id: m.id, active_asr_provider: m.provider })
                        }
                      >
                        {selected ? '選択中' : 'このモデルを使う'}
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    データの扱い: {m.data_handling}
                  </div>

                  {m.compatibility_reason && (
                    <div className="status-chip warn" style={{ alignSelf: 'flex-start' }}>
                      {m.compatibility_reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h2 className="section-title">クラウドASR APIキー（OS資格情報ストア保存）</h2>
            {(
              [
                { key: 'openai_api_key', label: 'OpenAI API Key', saved: secretStatus?.openai_api_key },
                { key: 'deepgram_api_key', label: 'Deepgram API Key', saved: secretStatus?.deepgram_api_key },
                { key: 'groq_api_key', label: 'Groq API Key', saved: secretStatus?.groq_api_key },
              ] as const
            ).map((item) => (
              <div key={item.key} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ width: '160px', fontWeight: 600 }}>{item.label}</span>
                <input
                  type="password"
                  className="input"
                  placeholder={item.saved ? '保存済み（更新する場合のみ入力）' : 'APIキーを入力'}
                  value={secretInputs[item.key] || ''}
                  onChange={(e) => setSecretInputs((p) => ({ ...p, [item.key]: e.target.value }))}
                />
                <button type="button" className="btn btn-secondary" onClick={() => saveKey(item.key)}>
                  <Key size={14} strokeWidth={1.5} />
                  保存
                </button>
              </div>
            ))}
          </section>
        </div>
      )}

      {/* 2. LLM Settings */}
      {tab === 'llm' && (
        <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h2 className="section-title">要約・AIチャット用 LLM 設定</h2>
          <p className="text-secondary" style={{ margin: 0 }}>
            送信されるデータ: <strong>文字起こしテキストと手入力メモのみ</strong>（録音音声ファイルはLLMへ送信しません）。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>LLMプロバイダー</label>
              <select
                className="select"
                value={settings.llm_provider}
                onChange={(e) => update({ llm_provider: e.target.value })}
              >
                <option value="none">未設定（AI機能を使用しない）</option>
                <option value="openai">OpenAI</option>
                <option value="openai_compatible">OpenAI 互換 API（エンドポイント指定）</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="gemini">Google Gemini</option>
                <option value="ollama">ローカル Ollama</option>
              </select>
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>モデル名</label>
              <input
                type="text"
                className="input"
                value={settings.llm_model}
                onChange={(e) => update({ llm_model: e.target.value })}
                placeholder="例: gpt-4o-mini / qwen2.5:7b / llama-3.3-70b-versatile"
              />
            </div>
            {(settings.llm_provider === 'ollama' || settings.llm_provider === 'openai_compatible') && (
              <div>
                <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>
                  {settings.llm_provider === 'ollama' ? 'Ollama エンドポイント' : 'OpenAI 互換ベースURL'}
                </label>
                <input
                  type="url"
                  className="input"
                  placeholder={settings.llm_provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
                  value={settings.llm_endpoint}
                  onChange={(e) => update({ llm_endpoint: e.target.value })}
                />
              </div>
            )}
          </div>

          {(
            [
              { key: 'llm_openai_api_key', label: 'OpenAI API Key', saved: secretStatus?.llm_openai_api_key, provider: 'openai' },
              { key: 'llm_openai_compatible_api_key', label: 'OpenAI互換 API Key', saved: secretStatus?.llm_openai_compatible_api_key, provider: 'openai_compatible' },
              { key: 'llm_anthropic_api_key', label: 'Anthropic API Key', saved: secretStatus?.llm_anthropic_api_key, provider: 'anthropic' },
              { key: 'llm_gemini_api_key', label: 'Gemini API Key', saved: secretStatus?.llm_gemini_api_key, provider: 'gemini' },
            ] as const
          ).map((item) => {
            const isCurrentProvider = settings.llm_provider === item.provider;
            return (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  padding: isCurrentProvider ? '8px' : '0px',
                  borderRadius: '8px',
                  backgroundColor: isCurrentProvider ? 'var(--accent-tint)' : 'transparent',
                }}
              >
                <span style={{ width: '176px', fontWeight: 600 }}>{item.label}</span>
                <span className={`status-chip ${item.saved ? 'ok' : 'warn'}`} style={{ flexShrink: 0 }}>
                  {item.saved ? '保存済み' : '未設定'}
                </span>
                <input
                  type="password"
                  className="input"
                  placeholder={item.saved ? '保存済み（更新する場合のみ入力）' : 'APIキーを入力（入力後に保存）'}
                  value={secretInputs[item.key] || ''}
                  onChange={(e) => setSecretInputs((p) => ({ ...p, [item.key]: e.target.value }))}
                  onBlur={() => {
                    if ((secretInputs[item.key] || '').trim()) {
                      void saveKey(item.key);
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => saveKey(item.key)}>
                  保存
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* 3. Shortcuts */}
      {tab === 'shortcuts' && (
        <section className="surface-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <div>
            <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>録音開始/停止ショートカット</label>
            <input
              type="text"
              className="input mono-num"
              value={settings.record_shortcut}
              onChange={(e) => update({ record_shortcut: e.target.value })}
            />
          </div>
          <div>
            <label className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>Voice typing ショートカット</label>
            <input
              type="text"
              className="input mono-num"
              value={settings.voice_typing_shortcut}
              onChange={(e) => update({ voice_typing_shortcut: e.target.value })}
            />
          </div>
        </section>
      )}

      {/* 4. Privacy & Data */}
      {tab === 'privacy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h2 className="section-title">音声・データのプライバシー管理</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input
                type="checkbox"
                checked={settings.delete_audio_after_transcribe}
                onChange={(e) => update({ delete_audio_after_transcribe: e.target.checked })}
              />
              文字起こし完了後に録音音声ファイルを削除する（既定・推奨）
            </label>
            {!settings.delete_audio_after_transcribe && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '24px' }}>
                <input
                  type="checkbox"
                  checked={settings.encrypt_retained_audio}
                  onChange={(e) => update({ encrypt_retained_audio: e.target.checked })}
                />
                保持する音声ファイルを AES-256-GCM で暗号化して保存する
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input
                type="checkbox"
                checked={settings.opt_out_model_training}
                onChange={(e) => update({ opt_out_model_training: e.target.checked })}
              />
              モデル学習へのデータ利用をオプトアウトする
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input
                type="checkbox"
                checked={settings.participant_notice_enabled}
                onChange={(e) => update({ participant_notice_enabled: e.target.checked })}
              />
              録音時に参加者への案内文を表示する
            </label>
          </section>

          <section className="surface-card" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={onExportAll}>
              全データをJSONエクスポート
            </button>
            {confirmPurge ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    await onPurgeAll();
                    setConfirmPurge(false);
                    flash('ローカルのノートを削除しました');
                  }}
                >
                  本当にすべて削除する
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmPurge(false)}>
                  キャンセル
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmPurge(true)}>
                全ノートデータを削除
              </button>
            )}
          </section>
        </div>
      )}

      {/* 5. App Update */}
      {tab === 'update' && (
        <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h2 className="section-title">アプリ更新（GitHub Releases）</h2>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>
                現在のバージョン: <span className="mono-num">v{updateInfo?.current_version ?? '0.5.0'}</span>
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={checkingUpdate || installingUpdate}
              onClick={async () => {
                setCheckingUpdate(true);
                setUpdateError(null);
                try {
                  const res = await onCheckUpdate();
                  setUpdateInfo(res);
                } catch (e) {
                  setUpdateError(String(e));
                } finally {
                  setCheckingUpdate(false);
                }
              }}
            >
              {checkingUpdate ? <Loader2 size={15} strokeWidth={1.5} className="spin" /> : <RefreshCw size={15} strokeWidth={1.5} />}
              {checkingUpdate ? '確認中' : '最新バージョンを確認'}
            </button>
          </div>

          {updateError && (
            <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {updateError}
            </div>
          )}

          {updateInfo && (
            <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {updateInfo.has_update
                      ? `新しいバージョン v${updateInfo.latest_version} が利用可能です`
                      : `最新状態です（v${updateInfo.latest_version}）`}
                  </div>
                  <div className="text-muted">{updateInfo.release_name}</div>
                </div>
                {updateInfo.has_update && (
                  updateInfo.download_url && updateInfo.asset_name ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={installingUpdate}
                      onClick={async () => {
                        setInstallingUpdate(true);
                        setUpdateError(null);
                        try {
                          const msg = await onInstallUpdate(updateInfo.download_url!, updateInfo.asset_name!);
                          flash(msg);
                        } catch (e) {
                          setUpdateError(String(e));
                        } finally {
                          setInstallingUpdate(false);
                        }
                      }}
                    >
                      {installingUpdate ? <Loader2 size={15} strokeWidth={1.5} className="spin" /> : <Download size={15} strokeWidth={1.5} />}
                      {installingUpdate
                        ? `更新中 ${updateProgress ?? 0}%`
                        : `v${updateInfo.latest_version} へそのままアップデート`}
                    </button>
                  ) : (
                    <a
                      href={updateInfo.release_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary"
                    >
                      このOS向けのビルド準備中（リリースページを開く）
                    </a>
                  )
                )}
              </div>
              {updateInfo.release_notes && (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                  {updateInfo.release_notes}
                </pre>
              )}
            </div>
          )}

          <details className="surface-subtle">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Private リポジトリから更新する場合（任意）</summary>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
              <input
                type="password"
                className="input"
                placeholder={secretStatus?.github_update_token ? '保存済み（更新する場合のみ入力）' : 'GitHub Personal Access Token'}
                value={secretInputs['github_update_token'] || ''}
                onChange={(e) => setSecretInputs((p) => ({ ...p, github_update_token: e.target.value }))}
              />
              <button type="button" className="btn btn-secondary" onClick={() => saveKey('github_update_token')}>
                保存
              </button>
            </div>
          </details>
        </section>
      )}

      {/* 6. Credits */}
      {tab === 'credits' && (
        <section className="surface-card" style={{ color: 'var(--text-secondary)' }}>
          <h2 className="section-title" style={{ marginBottom: '8px' }}>About / Credits</h2>
          <p style={{ margin: '0 0 8px' }}>
            UIデザインの構成とトークン設計は Uber Design による Figma コミュニティファイル「Base Gallery」（CC BY 4.0）および Base Design System を参照しています。
          </p>
          <p style={{ margin: 0 }}>
            ローカルASRランタイム・モデル: whisper.cpp / OpenAI Whisper (MIT)、NVIDIA Parakeet TDT/CTC (CC-BY-4.0)、sherpa-onnx (Apache-2.0)。
          </p>
        </section>
      )}
    </div>
  );
};
