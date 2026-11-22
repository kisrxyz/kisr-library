/**
 * «Не гасить экран» (spec §8.10): пока включено и читалка открыта, держим Screen Wake Lock.
 * Браузер сам снимает блокировку, когда вкладка скрывается, — при возвращении просим заново.
 * Если API нет или браузер отказал (экономия заряда), экран гаснет как обычно.
 */
import { useEffect } from 'preact/hooks';

/** Есть ли в браузере Screen Wake Lock API. */
export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!navigator.wakeLock;
}

export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !wakeLockSupported()) return;
    let alive = true;
    let asking = false;
    let held: WakeLockSentinel | null = null;

    const acquire = async () => {
      // Один запрос за раз и только когда блокировки нет; невидимая вкладка отказ получит всё равно
      if (!alive || asking || (held && !held.released) || document.visibilityState !== 'visible') return;
      asking = true;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!alive) {
          // Выключили или ушли из читалки, пока браузер думал
          void sentinel.release().catch(() => {});
          return;
        }
        held = sentinel;
        sentinel.addEventListener('release', () => {
          if (held === sentinel) held = null;
        });
      } catch {
        // Отказ не страшен: экран погаснет сам, как без настройки
      } finally {
        asking = false;
      }
    };

    const onVisibility = () => void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    void acquire();

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      const sentinel = held;
      held = null;
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [enabled]);
}
