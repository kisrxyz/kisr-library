/** Сборка записей БД из разобранной книги, служебные главы, шифры на полке. */
import { countCards, countTasks } from './cards';
import type { ParsedBook, ParsedChapter } from './parse';
import { countWords, hash, makeBookId, pad2 } from './text';
import type { BookMeta, BookOrigin, Chapter } from './types';

/** Хеш полного текста: одинаковый текст → одинаковый хеш (поиск дублей). */
export function contentHashOf(chapters: ParsedChapter[]): string {
  return hash(chapters.map((c) => c.title + '\n' + c.md).join('\n\n'));
}

export function buildBook(
  parsed: ParsedBook,
  opts: { origin: BookOrigin; id?: string; now?: number; createdAt?: number },
): { meta: BookMeta; chapters: Chapter[] } {
  const now = opts.now ?? Date.now();
  const id = opts.id ?? makeBookId(parsed.title, now);

  const chapters: Chapter[] = parsed.chapters.map((c, i) => ({
    id: `${id}--${pad2(i + 1)}`,
    bookId: id,
    order: i + 1,
    title: c.title,
    md: c.md,
    words: countWords(c.md),
  }));

  const meta: BookMeta = {
    id,
    title: parsed.title,
    category: parsed.category || 'Разное',
    tags: parsed.tags,
    summary: parsed.summary,
    source: parsed.source,
    origin: opts.origin,
    createdAt: opts.createdAt ?? now,
    addedAt: now,
    updatedAt: now,
    words: chapters.reduce((sum, c) => sum + c.words, 0),
    cards: parsed.chapters.reduce((sum, c) => sum + countCards(c.md), 0),
    tasks: parsed.chapters.reduce((sum, c) => sum + countTasks(c.md), 0),
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, words: c.words })),
    contentHash: contentHashOf(parsed.chapters),
    favorite: false,
  };
  if (parsed.level) meta.level = parsed.level;
  return { meta, chapters };
}

/** Главы-справка: «Источники», «Литература», «Карточки» — их можно пропускать и не считать «прочитанными». */
export function isServiceChapter(title: string): boolean {
  return /^(Источники|Литература|Карточки)$/i.test(title.trim());
}

/** Шифры каталога: `ФИЛ·01`. Код — три первые буквы/цифры раздела, номер — по `createdAt` внутри раздела. */
export function callNumbers(books: BookMeta[]): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();
  for (const b of [...books].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))) {
    const category = b.category || 'Разное';
    const n = (counts.get(category) || 0) + 1;
    counts.set(category, n);
    const code = Array.from(category.replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 3).join('').toUpperCase() || 'КН';
    out.set(b.id, `${code}·${pad2(n)}`);
  }
  return out;
}
