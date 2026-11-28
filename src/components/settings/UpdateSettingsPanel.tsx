import React from 'react';
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { apiOpenExternalUrl } from '../../lib/tauri';
import { UpdateCheckResult } from '../../types';
import { t } from '../../i18n';

interface UpdateSettingsPanelProps {
  updateProgress: number | null;
  onCheckUpdate: () => Promise<UpdateCheckResult>;
  onInstallUpdate: () => Promise<string>;
  onOpenExternalUrl?: (url: string) => Promise<void>;
  updateInfo: UpdateCheckResult | null;
  checkingUpdate: boolean;
  installingUpdate: boolean;
  updateError: string | null;
  appVersion: string;
  setCheckingUpdate: (checking: boolean) => void;
  setInstallingUpdate: (installing: boolean) => void;
  setUpdateInfo: (info: UpdateCheckResult) => void;
  setUpdateError: (error: string | null) => void;
  flash: (message: string) => void;
}

export const UpdateSettingsPanel: React.FC<UpdateSettingsPanelProps> = ({
  updateProgress,
  onCheckUpdate,
  onInstallUpdate,
  onOpenExternalUrl,
  updateInfo,
  checkingUpdate,
  installingUpdate,
  updateError,
  appVersion,
  setCheckingUpdate,
  setInstallingUpdate,
  setUpdateInfo,
  setUpdateError,
  flash,
}) => {
  const openExternalUrl = onOpenExternalUrl ?? apiOpenExternalUrl;
  const canAutoUpdate = Boolean(
    updateInfo?.has_update && updateInfo.can_auto_install && updateInfo.download_url
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 className="section-title">{t('アプリ更新')}</h2>
        <p className="text-muted" style={{ margin: '4px 0 0' }}>
          {t('GitHub Releases から最新バージョンを確認してワンクリックで更新できます。')}
        </p>
      </div>

      <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            {t('現在のバージョン:')} <strong className="mono-num">v{updateInfo?.current_version ?? (appVersion || '...')}</strong>
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
            {checkingUpdate ? t('確認中...') : t('最新リリースを確認')}
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
                  ? t('新しいバージョン v{0} が利用可能です', [updateInfo.latest_version])
                  : t('最新の状態です (v{0})', [updateInfo.current_version])}
              </span>
              {canAutoUpdate && updateInfo.download_url && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={installingUpdate}
                  onClick={async () => {
                    if (!updateInfo.download_url) return;
                    setInstallingUpdate(true);
                    setUpdateError(null);
                    try {
                      const msg = await onInstallUpdate();
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
                      ? t('ダウンロード中 ({0}%)', [updateProgress])
                      : t('更新中...')
                    : t('v{0} に今すぐアップデート', [updateInfo.latest_version])}
                </button>
              )}
              {updateInfo.has_update && !canAutoUpdate && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    setUpdateError(null);
                    try {
                      await openExternalUrl(updateInfo.release_url);
                    } catch (e) {
                      setUpdateError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <ExternalLink size={14} strokeWidth={1.5} />
                  {t('リリースページを開く')}
                </button>
              )}
            </div>
            {updateInfo.has_update && !updateInfo.can_auto_install && (
              <p className="text-muted" style={{ margin: 0, fontSize: '13px' }}>
                {t('この形式（deb など）ではアプリ内で自動更新できません。リリースページから新しいパッケージを入れてください。')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
