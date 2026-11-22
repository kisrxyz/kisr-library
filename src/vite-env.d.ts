/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Версия из `package.json`; подставляется через `define` в `vite.config.ts`. */
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
