import { useEffect } from 'react';
import { isTauriRuntime } from './tauri';

export type TauriEventSubscription<T = unknown> = {
  event: string;
  handler: (payload: T) => void;
};

/**
 * Tauri イベントを安全に購読する共通フック。
 * `listen()` の解決前にアンマウントされた場合でも `cancelled` フラグで即座に解除する。
 */
export function useTauriEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const fn = await listen<T>(eventName, (ev) => {
        if (!cancelled) {
          handler(ev.payload);
        }
      });
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}
