/**
 * Поиск по тексту для экрана: главы грузятся из БД один раз и лежат в памяти (spec §10.3),
 * сам поиск идёт порциями, чтобы не держать ввод.
 */
import { MIN_QUERY, TEXT_LIMIT, searchText, type TextHit } from '../../core/search';
import { normalizeForSearch } from '../../core/text';
import type { BookMeta, Chapter } from '../../core/types';
import { getAllChapters } from '../../db/books';

/** Сколько глав просматривается за один заход, прежде чем отдать управление вводу. */
const CHUNK = 100;

interface ChaptersCache {
  /** `id:contentHash` книг, для которых загружены главы. */
  keys: Set<string>;
  chapters: Promise<Chapter[]>;
}

let cache: ChaptersCache | null = null;

/** Текст книги меняется только вместе с `contentHash` (в нём названия и тексты глав). */
const keyOf = (book: BookMeta) => `${book.id}:${book.contentHash}`;

/**
 * Главы всех книг. Кэш живёт, пока каждая книга на полке в нём есть с тем же текстом: добавленная
 * или обновлённая книга запускает новую загрузку, удалённая — нет (её главы отсеиваются при поиске),
 * а смена названия, тегов или избранного текст не затрагивает.
 */
function loadChapters(books: BookMeta[], load: () => Promise<Chapter[]>): Promise<Chapter[]> {
  const current = cache;
  if (current && books.every((b) => current.keys.has(keyOf(b)))) return current.chapters;

  const entry: ChaptersCache = { keys: new Set(books.map(keyOf)), chapters: load() };
  cache = entry;
  // Неудачная загрузка не остаётся в кэше: следующий запрос попробует снова
  entry.chapters.catch(() => {
    if (cache === entry) cache = null;
  });
  return entry.chapters;
}

/** Отдать управление браузеру: ввод и прокрутка не ждут конца поиска. */
function pauseToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Options {
  limit?: number;
  /** Откуда брать главы; в тестах подменяется. */
  load?: () => Promise<Chapter[]>;
  /** Что делать между порциями; в тестах подменяется. */
  pause?: () => Promise<void>;
}

/**
 * Места в тексте книг из `books`. Главы грузятся при первом подходящем запросе и кэшируются.
 * `isStale` спрашивается между порциями: если запрос уже сменился, поиск бросается и возвращает `null`.
 * Запрос короче `MIN_QUERY` — `[]`, главы при этом не грузятся.
 */
export async function searchLibraryText(
  books: BookMeta[],
  q: string,
  isStale: () => boolean,
  { limit = TEXT_LIMIT, load = getAllChapters, pause = pauseToMain }: Options = {},
): Promise<TextHit[] | null> {
  if (normalizeForSearch(q).length < MIN_QUERY || books.length === 0) return [];

  const all = await loadChapters(books, load);
  if (isStale()) return null;

  const onShelf = new Set(books.map((b) => b.id));
  const chapters = all.filter((c) => onShelf.has(c.bookId));

  const hits: TextHit[] = [];
  for (let from = 0; from < chapters.length; from += CHUNK) {
    hits.push(...searchText(chapters.slice(from, from + CHUNK), q, limit - hits.length));
    if (hits.length >= limit || from + CHUNK >= chapters.length) break;
    await pause();
    if (isStale()) return null;
  }
  return hits;
}

/** Только для тестов: забыть загруженные главы. */
export function __resetChaptersForTests(): void {
  cache = null;
}
