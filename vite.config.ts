import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// На GitHub Pages приложение живёт в подпапке: в CI задаётся BASE_PATH=/<репозиторий>/.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [preact()],
});
