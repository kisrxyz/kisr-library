/** Резервная копия (spec §10.6): формат файла, правила слияния при восстановлении, напоминание. Чистая логика. */
import { pad2, countWords } from './text';
import { clampProgress } from './progress';
import { DEFAULT_SETTINGS, type BookMeta, type Chapter, type Mark, type Progress, type Settings, type TaskState } from './types';

export const BACKUP_FORMAT = 'kisr-library-backup';
export const BACKUP_VERSION = 1;

/** Книга в файле: метаданные и главы целиком (без служебных `id`, `order`, `words` глав). */
export type BackupBook = Omit<BookMeta, 'chapters'> & { chapters: { title: string; md: string }[] };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  app: string;
  books: BackupBook[];
  progress: Progress[];
  marks: Mark[];
  tasks: TaskState[];
  settings: Partial<Settings>;
}

/** Всё, что копия может изменить: то, что сейчас лежит в базе. */
export interface LibrarySnapshot {
  books: BookMeta[];
  progress: Progress[];
  marks: Mark[];
  tasks: TaskState[];
  /** Только записанные ключи, без значений по умолчанию. */
  settings: Partial<Settings>;
}

export interface MergePlan {
  putBooks: { meta: BookMeta; chapters: Chapter[] }[];
  putProgress: Progress[];
  putMarks: Mark[];
  putTasks: TaskState[];
  settings: Partial<Settings>;
  report: { added: number; updated: number; skipped: number };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function everyRecord(list: unknown, check: (r: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(list) && list.every((r) => isRecord(r) && check(r));
}

/** Похоже ли это на файл копии, который мы умеем читать. Проверяет форму, а не каждое поле. */
export function isBackup(x: unknown): x is BackupFile {
  if (!isRecord(x)) return false;
  if (x.format !== BACKUP_FORMAT) return false;
  if (typeof x.version !== 'number' || x.version < 1 || x.version > BACKUP_VERSION) return false;
  return (
    everyRecord(x.books, (b) => typeof b.id === 'string' && Array.isArray(b.chapters)) &&
    everyRecord(x.progress, (p) => typeof p.bookId === 'string') &&
    everyRecord(x.marks, (m) => typeof m.id === 'string') &&
    everyRecord(x.tasks, (t) => typeof t.bookId === 'string') &&
    isRecord(x.settings)
  );
}

/** Книга из файла → записи БД. Главы нумеруются заново, слова считаются по тексту. */
function toStored(book: BackupBook): { meta: BookMeta; chapters: Chapter[] } {
  const chapters: Chapter[] = book.chapters.map((c, i) => ({
    id: `${book.id}--${pad2(i + 1)}`,
    bookId: book.id,
    order: i + 1,
    title: c.title,
    md: c.md,
    words: countWords(c.md),
  }));
  const meta: BookMeta = {
    ...book,
    words: chapters.reduce((sum, c) => sum + c.words, 0),
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, words: c.words })),
  };
  return { meta, chapters };
}

/** Прогресс выходит за пределы книги только при ручной правке или при пропуске более короткой версии. */
function isOutOfRange(p: Progress, meta: BookMeta): boolean {
  const count = meta.chapters.length;
  return p.chapter > count || p.maxChapter > count || p.wordsRead > meta.words || p.chaptersDone.some((n) => n > count);
}

/** Тип значения настройки должен совпадать с типом значения по умолчанию (`null` — число или `null`). */
function isValidSetting(key: keyof Settings, value: unknown): boolean {
  const def = DEFAULT_SETTINGS[key];
  if (def === null) return value === null || typeof value === 'number';
  if (typeof def === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === typeof def;
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/**
 * Слияние при восстановлении (spec §10.6), ничего не записывает — только говорит, что записать:
 * книги по `id` (побеждает новее `updatedAt`), прогресс (новее `lastReadAt`), отметки (новее
 * `updatedAt`), задачи (объединение галочек), настройки (только те ключи, которых у нас нет).
 * Повторное слияние того же файла ничего не меняет.
 */
export function planMerge(current: LibrarySnapshot, incoming: BackupFile): MergePlan {
  const report = { added: 0, updated: 0, skipped: 0 };

  const ourBooks = new Map(current.books.map((b) => [b.id, b]));
  const putBooks: MergePlan['putBooks'] = [];
  for (const book of incoming.books) {
    const ours = ourBooks.get(book.id);
    if (!ours) {
      report.added++;
    } else if (book.updatedAt > ours.updatedAt) {
      report.updated++;
    } else {
      report.skipped++;
      continue;
    }
    const stored = toStored(book);
    putBooks.push(stored);
    ourBooks.set(book.id, stored.meta);
  }

  const ourProgress = new Map(current.progress.map((p) => [p.bookId, p]));
  const putProgress: Progress[] = [];
  for (const p of incoming.progress) {
    const ours = ourProgress.get(p.bookId);
    if (ours && p.lastReadAt <= ours.lastReadAt) continue;
    const meta = ourBooks.get(p.bookId);
    putProgress.push(meta && isOutOfRange(p, meta) ? clampProgress(p, meta) : p);
  }

  const ourMarks = new Map(current.marks.map((m) => [m.id, m]));
  const putMarks = incoming.marks.filter((m) => {
    const ours = ourMarks.get(m.id);
    return !ours || m.updatedAt > ours.updatedAt;
  });

  const ourTasks = new Map(current.tasks.map((t) => [t.bookId, t]));
  const putTasks: TaskState[] = [];
  for (const t of incoming.tasks) {
    const ours = ourTasks.get(t.bookId);
    const incomingKeys = Object.keys(t.done);
    if (ours && incomingKeys.every((k) => ours.done[k])) continue;
    putTasks.push({ bookId: t.bookId, done: { ...ours?.done, ...t.done } });
  }

  const settings: Partial<Settings> = {};
  for (const key of SETTING_KEYS) {
    const value = incoming.settings[key];
    if (value !== undefined && current.settings[key] === undefined && isValidSetting(key, value)) {
      (settings as Record<string, unknown>)[key] = value;
    }
  }

  return { putBooks, putProgress, putMarks, putTasks, settings, report };
}

const REMINDER_DAYS = 14;
const REMINDER_BOOKS_SINCE = 5;
const REMINDER_BOOKS_NO_BACKUP = 3;

/**
 * Показывать ли на полке напоминание о копии: книги есть, баннер не скрыт, и с последней копии
 * добавлено 5+ книг, прошло 14+ дней, либо копий ещё не было, а книг уже 3+.
 */
export function needsBackupReminder(s: Settings, bookCount: number, now: number): boolean {
  if (bookCount <= 0) return false;
  if (s.backupBannerHiddenUntil !== null && s.backupBannerHiddenUntil > now) return false;
  if (bookCount - s.booksAtLastBackup >= REMINDER_BOOKS_SINCE) return true;
  if (s.lastBackupAt !== null) return now - s.lastBackupAt >= REMINDER_DAYS * 24 * 60 * 60 * 1000;
  return bookCount >= REMINDER_BOOKS_NO_BACKUP;
}
