/**
 * Service worker и обновления (spec §12). Сам worker — `src/sw.ts`; здесь его регистрация и сигнал «ждёт обновление».
 * `registerType: 'prompt'`: новая версия скачивается тихо и применяется только по нажатию «Обновить»,
 * чтобы страница не перезагрузилась посреди чтения. Данные в IndexedDB обновление не трогает.
 */
import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';
import { toast } from './ui/toast-state';

/** Новая версия скачана и ждёт нажатия «Обновить». */
export const needUpdate = signal(false);

/** Включает ожидающую версию и перезагружает страницу; возвращает `registerSW`. До регистрации — обычная перезагрузка. */
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined;

/** Применить ожидающую версию. Без service worker (разработка, старый браузер) — просто перезагрузка. */
export async function updateApp(): Promise<void> {
  if (!applyUpdate) {
    location.reload();
    return;
  }
  await applyUpdate(true);
}

/** Тост про обновление висит дольше обычного: читающий человек замечает его не сразу. */
const UPDATE_TOAST_MS = 15000;

/** Регистрирует service worker. Вызывать один раз при старте, только в сборке (в `npm run dev` worker не работает). */
export function initPwa(): void {
  if (applyUpdate || !('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh() {
      needUpdate.value = true;
      toast('Доступно обновление', { label: 'Обновить', run: () => void updateApp() }, UPDATE_TOAST_MS);
    },
    onOfflineReady() {
      toast('Готово к работе без интернета');
    },
    // Установленное приложение живёт днями: браузер сам ищет новую версию редко, поэтому спрашиваем,
    // когда оно возвращается на экран. Без сети проверка тихо проваливается.
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    },
    onRegisterError(error) {
      console.error('Service worker не зарегистрировался', error);
    },
  });
}
