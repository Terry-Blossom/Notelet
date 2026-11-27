import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App';
import { MOBILE_LAYOUT_QUERY } from '../lib/platform';

const setMobileViewport = (mobile: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_LAYOUT_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
};

afterEach(() => {
  setMobileViewport(false);
});

describe('mobile portrait layout', () => {
  it('shows bottom tab bar instead of sidebar in portrait', () => {
    setMobileViewport(true);
    render(<App />);
    expect(screen.getByRole('button', { name: 'その他' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音を開始' })).toBeInTheDocument();
    // サイドバー専用のナビは非表示
    expect(screen.queryByRole('button', { name: 'アップロード' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '辞書' })).not.toBeInTheDocument();
  });

  it('opens upload/dictionary/integrations/settings from the more sheet', () => {
    setMobileViewport(true);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    expect(screen.getByRole('dialog', { name: 'その他のメニュー' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }));
    expect(screen.queryByRole('dialog', { name: 'その他のメニュー' })).not.toBeInTheDocument();
  });

  it('opens the settings screen in a stacked portrait layout', () => {
    setMobileViewport(true);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '設定' }));
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    // モバイルではタブ列と本文を縦積みにする（row のままだと本文が押し出される）
    expect(document.querySelector('.settings-layout')).not.toBeNull();
  });

  it('keeps the desktop sidebar in landscape', () => {
    setMobileViewport(false);
    render(<App />);
    expect(screen.getByRole('button', { name: 'アップロード' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'その他' })).not.toBeInTheDocument();
  });

  it('applies mobile shell class and renders chat and settings in portrait', () => {
    setMobileViewport(true);
    const { container } = render(<App />);
    expect(container.querySelector('.app-shell.mobile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'チャット' }));
    expect(container.querySelector('.chat-split')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(screen.getByRole('button', { name: '設定' }));
    expect(container.querySelector('.settings-modal-panel')).toBeInTheDocument();
  });
});
