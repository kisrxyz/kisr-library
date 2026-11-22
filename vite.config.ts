import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Версия приложения — из package.json: показывается в «Ещё → О приложении» (`import.meta.env.APP_VERSION`).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// На GitHub Pages приложение живёт в подпапке: в CI задаётся BASE_PATH=/<репозиторий>/.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [preact()],
  define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
});
