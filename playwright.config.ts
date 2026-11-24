import { defineConfig, devices } from '@playwright/test';

/**
 * Порт предпросмотра собранного приложения: тесты идут по настоящей сборке (с service worker), а не по dev-серверу.
 * `E2E_PORT` — если 4173 занят другим проектом (иначе тесты молча пойдут по чужому приложению).
 */
const PORT = Number(process.env.E2E_PORT) || 4173;

export default defineConfig({
  testDir: 'e2e',
  // Каждый тест получает свой пустой контекст (своя IndexedDB), поэтому тесты не мешают друг другу
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  // WebKit под Windows медленный: при полной загрузке процессора один сценарий идёт до минуты
  timeout: 90_000,
  workers: process.env.CI ? 2 : 3,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [
    // iPhone 13: WebKit — ближайшее, что есть к Safari на телефоне владельца
    { name: 'iphone', use: { ...devices['iPhone 13'] }, testIgnore: /offline\.spec\.ts/ },
    // Pixel 7: Chromium — Android; офлайн-сценарий (service worker) проверяем здесь
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
