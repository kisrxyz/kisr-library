import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // По умолчанию тесты идут в Node. Тестам с DOM нужна строка `// @vitest-environment jsdom`.
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'claude-skill/**/*.test.ts'],
      setupFiles: ['fake-indexeddb/auto'],
    },
  }),
);
