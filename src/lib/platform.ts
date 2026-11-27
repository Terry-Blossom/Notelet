import { useEffect, useState } from 'react';
import { isTauriRuntime } from './tauri';

/** Tauri の Android ランタイムかどうか（WebView の UA で判定）。 */
export function isAndroidRuntime(): boolean {
  return isTauriRuntime() && /Android/i.test(navigator.userAgent);
}

/** 縦画面かつ狭い幅のときモバイルレイアウト。横画面は従来のデスクトップUI。 */
export const MOBILE_LAYOUT_QUERY = '(orientation: portrait) and (max-width: 900px)';

export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_LAYOUT_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    setMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return mobile;
}
