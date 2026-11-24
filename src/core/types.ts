/**
 * Модель данных IndexedDB `kisr-library` (spec §6). Все времена — миллисекунды Unix.
 */

// books — keyPath "id"; индексы: category, addedAt, updatedAt
export interface BookMeta {
  id: string; // slug(title, 40) + "-" + Date.now().toString(36); у перенесённых — старый id
  title: string;
  category: string; // «Разное», если не задан
  tags: string[];
  summary: string;
  source: string; // поле source из шапки
  level?: string; // базовый | средний | продвинутый (необязательно)
  origin: 'paste' | 'file' | 'share' | 'backup' | 'migration';
  createdAt: number; // когда книга создана (из старого приложения или = addedAt)
  addedAt: number; // когда добавлена в это приложение
  updatedAt: number;
  words: number;
  cards: number; // число пар Q/A
  tasks: number; // число пунктов «- [ ]»
  chapters: { id: string; title: string; words: number }[];
  contentHash: string; // hash() нормализованного полного текста — для дублей
  favorite: boolean;
  action?: { text: string; done: boolean; doneAt?: number }; // «одно действие» после прочтения
}

export type BookOrigin = BookMeta['origin'];

// chapters — keyPath "id" = `${bookId}--NN` (NN = 01, 02…); индекс bookId
export interface Chapter {
  id: string;
  bookId: string;
  order: number /* с 1 */;
  title: string;
  md: string;
  words: number;
}

// progress — keyPath "bookId". Нет записи = книга не начата.
export interface Progress {
  bookId: string;
  chapter: number; // текущая глава (order)
  blockKey: string | null; // ключ абзаца, где остановился (см. §8.3)
  blockIndex: number; // запасной вариант: индекс якорного блока в главе
  blockOffset: number; // 0..1 — насколько блок уже прокручен
  maxChapter: number; // самая дальняя открытая глава
  chaptersDone: number[]; // главы, дочитанные до конца
  wordsRead: number; // слов до текущей позиции (для % и «осталось»)
  percent: number; // 0..100
  status: 'reading' | 'finished';
  startedAt: number;
  lastReadAt: number;
  finishedAt?: number;
  readingMs: number; // активное время чтения (на будущее: своя скорость)
  snippet?: string; // до 140 символов абзаца, где остановился
}

// marks — keyPath "id" = `${bookId}|${blockKey}`; индексы bookId, updatedAt
export interface Mark {
  id: string;
  bookId: string;
  chapter: number;
  blockKey: string;
  text: string /* до 400 симв. */;
  highlight: boolean;
  note: string;
  createdAt: number;
  updatedAt: number;
}

// tasks — keyPath "bookId"
export interface TaskState {
  bookId: string;
  done: Record<string /* "t"+hash */, true>;
  updatedAt?: number; // последняя галочка (для синхронизации, spec §18.2); у старых записей нет
}

// settings — keyPath "key"; значения: см. §10.7
export interface Setting {
  key: string;
  value: unknown;
}

// inbox — keyPath "id": временное хранилище для share target (Android) — SW кладёт, экран «Добавить» забирает
export interface InboxItem {
  id: string;
  at: number;
  title?: string;
  text?: string;
  files?: { name: string; text: string }[];
}

/** Порядок на полке. */
export type SortKey = 'recent' | 'added' | 'title' | 'short' | 'long';

/** Ключи хранилища `settings` (spec §10.7). */
export interface Settings {
  theme: 'auto' | 'light' | 'sepia' | 'dark';
  font: 'serif' | 'sans';
  fontSize: number; // 15–24
  lineHeight: 'tight' | 'normal' | 'loose';
  hyphens: boolean;
  keepAwake: boolean;
  wpm: number; // 120–300
  sort: SortKey;
  lastBackupAt: number | null;
  booksAtLastBackup: number;
  backupBannerHiddenUntil: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  font: 'serif',
  fontSize: 18,
  lineHeight: 'normal',
  hyphens: true,
  keepAwake: false,
  wpm: 180,
  sort: 'recent',
  lastBackupAt: null,
  booksAtLastBackup: 0,
  backupBannerHiddenUntil: null,
};
