/** Полка (spec §10.1): фильтры, сортировка, «Продолжить» и «Читаю сейчас». Чистые функции. */
import { bookStatus } from './progress';
import { lengthBucket } from './time';
import type { BookMeta, Progress, SortKey } from './types';

export type StatusFilter = 'all' | 'reading' | 'new' | 'finished' | 'fav';
export type LengthFilter = 'any' | 'short' | 'medium' | 'long';

export interface ShelfQuery {
  status: StatusFilter;
  /** Название раздела; `null` — все разделы. */
  category: string | null;
  length: LengthFilter;
  sort: SortKey;
}

/** Метка «Новая»: добавлена не больше трёх суток назад. */
export const NEW_BOOK_MS = 3 * 24 * 60 * 60 * 1000;

/** Один сборщик на всё приложение: `localeCompare` без него на каждом сравнении создаёт новый. */
const ru = new Intl.Collator('ru');

const byTitle = (a: BookMeta, b: BookMeta): number => ru.compare(a.title, b.title);

function matchesStatus(book: BookMeta, progress: Progress | undefined, status: StatusFilter): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'fav':
      return book.favorite;
    default:
      return bookStatus(progress) === status;
  }
}

/**
 * Книги полки под фильтрами и в нужном порядке. Исходный массив не меняется.
 * Равные по ключу книги идут по названию, чтобы порядок не прыгал между перерисовками.
 */
export function filterBooks(
  books: BookMeta[],
  progress: Map<string, Progress>,
  q: ShelfQuery,
  wpm: number,
): BookMeta[] {
  const shown = books.filter(
    (b) =>
      matchesStatus(b, progress.get(b.id), q.status) &&
      (q.category === null || b.category === q.category) &&
      (q.length === 'any' || lengthBucket(b.words, wpm) === q.length),
  );

  switch (q.sort) {
    case 'recent': {
      // Ключ считается один раз на книгу, а не на каждое сравнение
      const keyed = shown.map((book) => ({ book, key: Math.max(progress.get(book.id)?.lastReadAt ?? 0, book.addedAt) }));
      keyed.sort((a, b) => b.key - a.key || byTitle(a.book, b.book));
      return keyed.map((k) => k.book);
    }
    case 'added':
      return shown.sort((a, b) => b.addedAt - a.addedAt || byTitle(a, b));
    case 'title':
      return shown.sort(byTitle);
    case 'short':
      return shown.sort((a, b) => a.words - b.words || byTitle(a, b));
    case 'long':
      return shown.sort((a, b) => b.words - a.words || byTitle(a, b));
  }
}

/** Разделы с числом книг: больших больше сверху, при равенстве — по алфавиту. */
export function categoryCounts(books: BookMeta[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of books) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || ru.compare(a.name, b.name));
}

/** Числа на сегментах «Все · Читаю · Новые · Прочитано · ★». */
export function statusCounts(books: BookMeta[], progress: Map<string, Progress>): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: books.length, reading: 0, new: 0, finished: 0, fav: 0 };
  for (const b of books) {
    counts[bookStatus(progress.get(b.id))] += 1;
    if (b.favorite) counts.fav += 1;
  }
  return counts;
}

export interface ReadingEntry {
  book: BookMeta;
  progress: Progress;
}

/** Начатые и не дочитанные книги, самая свежая по `lastReadAt` — первая. Прогресс без книги пропускается. */
function startedBooks(books: BookMeta[], progress: Map<string, Progress>): ReadingEntry[] {
  const out: ReadingEntry[] = [];
  for (const book of books) {
    const p = progress.get(book.id);
    if (p && p.status === 'reading') out.push({ book, progress: p });
  }
  return out.sort((a, b) => b.progress.lastReadAt - a.progress.lastReadAt);
}

/** Герой «Продолжить»: самая свежая из начатых. */
export function continueReading(books: BookMeta[], progress: Map<string, Progress>): ReadingEntry | null {
  return startedBooks(books, progress)[0] ?? null;
}

/** «Читаю сейчас»: остальные начатые книги (без героя), свежие сверху. */
export function readingNow(books: BookMeta[], progress: Map<string, Progress>, limit = 5): ReadingEntry[] {
  return startedBooks(books, progress).slice(1, 1 + limit);
}

/**
 * Метка «Новая»: книгу только что добавили и ещё не открывали (добавлена за последние 3 суток, прогресса нет).
 * Книги, перенесённые из старого приложения или восстановленные из копии, не «новые»: их не добавляли заново.
 */
export function isNew(book: BookMeta, progress: Progress | undefined, now: number): boolean {
  if (book.origin === 'migration' || book.origin === 'backup') return false;
  return !progress && now - book.addedAt <= NEW_BOOK_MS;
}
