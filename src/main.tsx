// Шрифты локальные (офлайн): Literata с оптическими размерами — для книг, Golos Text — интерфейс,
// Unbounded — знак. Браузер скачивает только нужные наборы символов (unicode-range).
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/unbounded';
import './styles/tokens.css';
import './styles/base.css';
import { render } from 'preact';
import { App } from './app';
import { initPwa } from './pwa';
import { libraryError, startLibrary } from './state/library';
import { initSync } from './state/sync';

/**
 * Пока настройки и библиотека читаются из IndexedDB (десятки миллисекунд), на странице только
 * фон из токенов: экраны не показываются пустыми и не мигают. Если база не открылась или не ответила
 * за 8 с, приложение открывается с экраном «Не удалось открыть хранилище», а не с пустой полкой.
 */
async function start(): Promise<void> {
  await startLibrary();
  render(<App />, document.getElementById('app')!);
  // Service worker только в сборке: в `npm run dev` он кэшировал бы устаревший код.
  if (import.meta.env.PROD) initPwa();
  // Синхронизация (spec §18) — после полки и только если хранилище открылось: сливать не во что
  if (!libraryError.value) void initSync();
}

void start();
