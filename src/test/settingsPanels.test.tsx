import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateSettingsPanel } from '../components/settings/UpdateSettingsPanel';
import { UpdateCheckResult } from '../types';

const updateResult: UpdateCheckResult = {
  current_version: '0.16.4',
  latest_version: '0.17.0',
  has_update: true,
  release_name: '0.17.0',
  release_notes: '',
  release_url: 'https://example.com/release',
  asset_name: 'Notelet-Setup.exe',
  download_url: 'https://example.com/Notelet-Setup.exe',
};

describe('UpdateSettingsPanel', () => {
  it('checks for updates and starts an available download', async () => {
    const onCheckUpdate = vi.fn().mockResolvedValue(updateResult);
    const onInstallUpdate = vi.fn().mockResolvedValue('更新を開始しました');
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

    await waitFor(() => expect(setUpdateInfo).toHaveBeenCalledWith(updateResult));
    expect(setCheckingUpdate).toHaveBeenNthCalledWith(1, true);
    expect(setCheckingUpdate).toHaveBeenLastCalledWith(false);

    rerender(
      <UpdateSettingsPanel
        updateProgress={null}
        onCheckUpdate={onCheckUpdate}
        onInstallUpdate={onInstallUpdate}
        updateInfo={updateResult}
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

    await waitFor(() => expect(flash).toHaveBeenCalledWith('更新を開始しました'));
    expect(onInstallUpdate).toHaveBeenCalledWith(
      updateResult.download_url,
      updateResult.asset_name
    );
    expect(setInstallingUpdate).toHaveBeenNthCalledWith(1, true);
    expect(setInstallingUpdate).toHaveBeenLastCalledWith(false);
  });
});
