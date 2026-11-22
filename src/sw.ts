/// <reference lib="webworker" />
/**
 * Service worker (spec §12). Собирается тем же Vite через vite-plugin-pwa (injectManifest):
 *  - кэширует всю сборку, включая шрифты, — приложение открывается без сети;
 *  - любая навигация отдаёт закэшированный `index.html` (роутер у нас на `location.hash`);
 *  - принимает «Поделиться» из других приложений (Android, `share_target` в манифесте): кладёт текст и файлы в IndexedDB
 *    и отправляет на `#/add?shared=1`, где экран «Добавить» их забирает;
 *  - обновление ждёт команды: новая версия активируется по `SKIP_WAITING` из тоста «Обновить» (src/pwa.ts).
 * Здесь нельзя импортировать ничего, что тянет DOM, — только `src/db` и типы.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { InboxItem } from './core/types';
import { putInbox } from './db/inbox';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/** `action: "./share-target"` из манифеста: путь зависит от `base`, поэтому смотрим на окончание. */
const SHARE_TARGET = /\/share-target$/;

// Адреса приложения — всегда `index.html`: страницы и роутер те же, что при первой загрузке.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [SHARE_TARGET] }));

/** Поле формы — строка (файлы и пустые поля не считаются). */
const field = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() ? value : undefined;
};

/**
 * Читает форму «Поделиться» и кладёт её в inbox. Поле `url` не берём: по ссылке книгу не получить.
 * Любая ошибка не должна ломать переход: экран «Добавить» сам скажет, что ничего не пришло.
 */
async function receiveShare(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const files: NonNullable<InboxItem['files']> = [];
    for (const [, value] of form) {
      if (typeof value !== 'string') files.push({ name: value.name, text: await value.text() });
    }
    const item: InboxItem = { id: crypto.randomUUID(), at: Date.now(), title: field(form, 'title'), text: field(form, 'text'), files };
    if (item.title || item.text || files.length) await putInbox(item);
  } catch (error) {
    console.error('Не удалось принять «Поделиться»', error);
  }
  // 303: браузер идёт на адрес обычным GET. Адрес считаем от области действия, а не от пути запроса.
  return Response.redirect(new URL('./#/add?shared=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'POST' && SHARE_TARGET.test(new URL(request.url).pathname)) event.respondWith(receiveShare(request));
});

// Тост «Обновить» (src/pwa.ts через workbox-window) просит новую версию занять место старой.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
