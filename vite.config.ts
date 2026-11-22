import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Версия приложения — из package.json: показывается в «Ещё → О приложении» (`import.meta.env.APP_VERSION`).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// На GitHub Pages приложение живёт в подпапке: в CI задаётся BASE_PATH=/<репозиторий>/.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    preact(),
    // spec §12. Свой service worker (src/sw.ts): кроме кэша ему нужен приём «Поделиться» (Android).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Новая версия не подменяет старую сама: ждёт тоста «Обновить» (чтение не прерывается).
      registerType: 'prompt',
      // SW — обычный скрипт, а не модуль: работает и в старых Safari, а зависимостей для разбиения на чанки у него нет.
      injectManifest: {
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        // Греческий набор нужен: в книгах по статистике и науке встречаются α, β, μ, π, Δ, χ². Вьетнамский — нет:
        // русским книгам он не нужен, и такие символы, если вдруг встретятся, отрисуются системным шрифтом.
        globIgnores: ['**/*-vietnamese-*.woff2'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Kisr Library',
        short_name: 'Library',
        description: 'Личная библиотека книг от Claude: читать офлайн с того места, где остановился.',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#F2F4F1',
        background_color: '#F2F4F1',
        // Пути относительно манифеста: работают при любом `base`.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Android: «Поделиться» → Kisr Library. Принимает service worker (путь оканчивается на /share-target).
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'file', accept: ['.md', '.txt', '.json', 'text/*', 'application/json'] }],
          },
        },
      },
    }),
  ],
  define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
});
