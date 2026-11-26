import React from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { UpdateCheckResult } from '../../types';

interface UpdateSettingsPanelProps {
  updateProgress: number | null;
  onCheckUpdate: () => Promise<UpdateCheckResult>;
  onInstallUpdate: (downloadUrl: string, assetName: string) => Promise<string>;
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
}) => (
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
);
