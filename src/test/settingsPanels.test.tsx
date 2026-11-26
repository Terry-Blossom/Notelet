import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { UpdateSettingsPanel } from '../components/settings/UpdateSettingsPanel';
import { UpdateCheckResult } from '../types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const autoInstallUpdateResult: UpdateCheckResult = {
  current_version: '0.16.4',
  latest_version: '0.17.0',
  has_update: true,
  release_name: '0.17.0',
  release_notes: '',
  release_url: 'https://github.com/Terry-Blossom/Notelet/releases/tag/v0.17.0',
  asset_name: 'Notelet_0.17.0_linux_x86_64.AppImage',
  download_url:
    'https://github.com/Terry-Blossom/Notelet/releases/download/v0.17.0/Notelet_0.17.0_linux_x86_64.AppImage',
  asset_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  install_kind: 'appimage',
  can_auto_install: true,
};

const manualInstallUpdateResult: UpdateCheckResult = {
  current_version: '0.16.4',
  latest_version: '0.17.0',
  has_update: true,
  release_name: '0.17.0',
  release_notes: '',
  release_url: 'https://github.com/Terry-Blossom/Notelet/releases/tag/v0.17.0',
  asset_name: 'Notelet_0.17.0_linux_x86_64.deb',
  download_url:
    'https://github.com/Terry-Blossom/Notelet/releases/download/v0.17.0/Notelet_0.17.0_linux_x86_64.deb',
  asset_sha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  install_kind: 'deb',
  can_auto_install: false,
};

describe('UpdateSettingsPanel', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  it('checks for updates and starts install when can_auto_install is true', async () => {
    const onCheckUpdate = vi.fn().mockResolvedValue(autoInstallUpdateResult);
    const onInstallUpdate = vi.fn().mockResolvedValue('更新しました。再起動します。');
    const setCheckingUpdate = vi.fn();
    const setInstallingUpdate = vi.fn();
    const setUpdateInfo = vi.fn();
    const setUpdateError = vi.fn();
    const flash = vi.fn();

    const { rerender } = render(
      <UpdateSettingsPanel
        updateProgress={null}
        onCheckUpdate={onCheckUpdate}
        onInstallUpdate={onInstallUpdate}
        updateInfo={null}
        checkingUpdate={false}
        installingUpdate={false}
        updateError={null}
        appVersion="0.16.4"
        setCheckingUpdate={setCheckingUpdate}
        setInstallingUpdate={setInstallingUpdate}
        setUpdateInfo={setUpdateInfo}
        setUpdateError={setUpdateError}
        flash={flash}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '最新リリースを確認' }));

    await waitFor(() => expect(setUpdateInfo).toHaveBeenCalledWith(autoInstallUpdateResult));
    expect(setCheckingUpdate).toHaveBeenNthCalledWith(1, true);
    expect(setCheckingUpdate).toHaveBeenLastCalledWith(false);

    rerender(
      <UpdateSettingsPanel
        updateProgress={null}
        onCheckUpdate={onCheckUpdate}
        onInstallUpdate={onInstallUpdate}
        updateInfo={autoInstallUpdateResult}
        checkingUpdate={false}
        installingUpdate={false}
        updateError={null}
        appVersion="0.16.4"
        setCheckingUpdate={setCheckingUpdate}
        setInstallingUpdate={setInstallingUpdate}
        setUpdateInfo={setUpdateInfo}
        setUpdateError={setUpdateError}
        flash={flash}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /今すぐアップデート/ }));

    await waitFor(() => expect(flash).toHaveBeenCalledWith('更新しました。再起動します。'));
    expect(onInstallUpdate).toHaveBeenCalledWith(
      autoInstallUpdateResult.download_url,
      autoInstallUpdateResult.asset_name,
      autoInstallUpdateResult.asset_sha256
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(setInstallingUpdate).toHaveBeenNthCalledWith(1, true);
    expect(setInstallingUpdate).toHaveBeenLastCalledWith(false);
  });

  it('opens release page via open_external_url when can_auto_install is false', async () => {
    const onCheckUpdate = vi.fn().mockResolvedValue(manualInstallUpdateResult);
    const onInstallUpdate = vi.fn();
    const setCheckingUpdate = vi.fn();
    const setInstallingUpdate = vi.fn();
    const setUpdateInfo = vi.fn();
    const setUpdateError = vi.fn();
    const flash = vi.fn();

    render(
      <UpdateSettingsPanel
        updateProgress={null}
        onCheckUpdate={onCheckUpdate}
        onInstallUpdate={onInstallUpdate}
        updateInfo={manualInstallUpdateResult}
        checkingUpdate={false}
        installingUpdate={false}
        updateError={null}
        appVersion="0.16.4"
        setCheckingUpdate={setCheckingUpdate}
        setInstallingUpdate={setInstallingUpdate}
        setUpdateInfo={setUpdateInfo}
        setUpdateError={setUpdateError}
        flash={flash}
      />
    );

    expect(
      screen.getByText(/この形式（deb など）ではアプリ内で自動更新できません/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /今すぐアップデート/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'リリースページを開く' }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith('open_external_url', {
        url: manualInstallUpdateResult.release_url,
      })
    );
    expect(onInstallUpdate).not.toHaveBeenCalled();
  });
});
