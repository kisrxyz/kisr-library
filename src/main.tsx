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
import { loadLibrary } from './state/library';
import { loadSettings } from './state/settings';

/**
 * Пока настройки и библиотека читаются из IndexedDB (десятки миллисекунд), на странице только
 * фон из токенов: экраны не показываются пустыми и не мигают. Если база недоступна, приложение
 * всё равно открывается — с пустой полкой.
 */
async function start(): Promise<void> {
  try {
    await Promise.all([loadSettings(), loadLibrary()]);
  } catch (error) {
    console.error('Не удалось прочитать хранилище', error);
  }
  render(<App />, document.getElementById('app')!);
  // Service worker только в сборке: в `npm run dev` он кэшировал бы устаревший код.
  if (import.meta.env.PROD) initPwa();
}

void start();
