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

render(<App />, document.getElementById('app')!);
