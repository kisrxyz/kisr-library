/**
 * Поиск (spec §10.3): по книгам (название, теги, раздел, описание) и по тексту глав.
 * Сравнение — как у `normalizeForSearch`: регистр и ё/е не важны, знаки разметки не считаются.
 */
import { normalizeForSearch, plainText } from './text';
import type { BookMeta, Chapter } from './types';

/** Короче этого запрос по тексту не ищем: на одну букву находится всё подряд. */
export const MIN_QUERY = 2;
/** Сколько мест в тексте показываем всего. */
export const TEXT_LIMIT = 50;
/** Не больше стольких совпадений из одной главы. */
export const PER_CHAPTER = 3;
/** Сколько символов контекста по обе стороны от найденного. */
export const CONTEXT = 60;

/** Одно место в тексте: найденное и контекст, всё в исходном написании. */
export interface TextHit {
  bookId: string;
  chapter: number;
  chapterTitle: string;
  before: string;
  match: string;
  after: string;
}

/** Вес поля при поиске по книгам. */
const WEIGHT = { title: 3, tags: 2, category: 2, summary: 1 } as const;

/**
 * Нижний регистр и ё→е без смены длины: индекс в результате — это индекс в исходной строке,
 * поэтому по найденному месту можно вырезать исходное написание. Одно только `toLowerCase`
 * этого не гарантирует: у «İ» строчная форма длиннее.
 */
function fold(s: string): string {
  const t = s.toLowerCase().replace(/ё/g, 'е');
  if (t.length === s.length) return t;
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower.replace(/ё/g, 'е') : ch;
  }
  return out;
}

/** Слова запроса в нормализованном виде. */
function tokensOf(q: string): string[] {
  const needle = normalizeForSearch(q);
  return needle ? needle.split(' ') : [];
}

/**
 * Книги, подходящие под запрос, по убыванию веса: название 3, теги 2, раздел 2, описание 1.
 * Каждое слово запроса должно найтись хоть в одном поле; вес считается по всем словам и полям.
 * При равном весе порядок не меняется.
 */
export function searchBooks(books: BookMeta[], q: string): BookMeta[] {
  const tokens = tokensOf(q);
  if (tokens.length === 0) return [];

  const scored: { book: BookMeta; score: number; index: number }[] = [];
  books.forEach((book, index) => {
    const title = fold(book.title);
    const tags = book.tags.map(fold);
    const category = fold(book.category);
    const summary = fold(book.summary);
    let score = 0;
    for (const token of tokens) {
      let own = 0;
      if (title.includes(token)) own += WEIGHT.title;
      if (tags.some((t) => t.includes(token))) own += WEIGHT.tags;
      if (category.includes(token)) own += WEIGHT.category;
      if (summary.includes(token)) own += WEIGHT.summary;
      if (own === 0) return;
      score += own;
    }
    scored.push({ book, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.book);
}

/**
 * Строка по кускам: какие из них найдены. Подсвечиваются все слова запроса, исходное написание сохраняется.
 * Однобуквенные слова («и», «в») не подсвечиваются, если в запросе есть слова подлиннее: иначе в названии
 * загорится каждая такая буква.
 */
export function highlightParts(text: string, q: string): { text: string; hit: boolean }[] {
  if (!text) return [];
  let tokens = tokensOf(q);
  const long = tokens.filter((t) => t.length >= MIN_QUERY);
  if (long.length > 0) tokens = long;
  if (tokens.length === 0) return [{ text, hit: false }];

  const folded = fold(text);
  const spans: [number, number][] = [];
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at >= 0; at = folded.indexOf(token, at + token.length)) {
      spans.push([at, at + token.length]);
    }
  }
  if (spans.length === 0) return [{ text, hit: false }];

  // Пересекающиеся и соседние куски склеиваем в один
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }

  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [from, to] of merged) {
    if (from > pos) parts.push({ text: text.slice(pos, from), hit: false });
    parts.push({ text: text.slice(from, to), hit: true });
    pos = to;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts;
}

/**
 * Часть строки, где видно найденное: если первое совпадение далеко от начала, строка начинается с «…»
 * за `lead` символов до него (по границе слова). Для длинных описаний в ограниченном по высоте блоке.
 */
export function excerpt(text: string, q: string, lead = 40): string {
  const parts = highlightParts(text, q);
  const first = parts.findIndex((p) => p.hit);
  if (first < 0) return text;
  const offset = parts.slice(0, first).reduce((sum, p) => sum + p.text.length, 0);
  if (offset <= lead) return text;
  const space = text.indexOf(' ', offset - lead);
  const start = space >= 0 && space < offset ? space + 1 : offset - lead;
  return `…${text.slice(start)}`;
}

/**
 * Нормализованный текст глав: считается один раз на главу. Главы приходят из кэша экрана (одни и те же
 * объекты на каждый запрос), поэтому повторный запрос идёт по готовым строкам, а не по Markdown.
 * Запись пропадает вместе с главой.
 */
const foldedChapters = new WeakMap<Chapter, string>();

function foldedText(chapter: Chapter): string {
  let text = foldedChapters.get(chapter);
  if (text === undefined) {
    text = fold(plainText(chapter.md));
    foldedChapters.set(chapter, text);
  }
  return text;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Пробелы и переводы строк в сниппете — обычные пробелы, длина не меняется. */
const flat = (s: string) => s.replace(/\s/g, ' ');

/**
 * Места в тексте глав: по нормализованному `plainText(md)`, до `PER_CHAPTER` на главу и до `limit` всего.
 * Запрос целиком — одной фразой (так же ищет читалка, когда открывает найденное место).
 * `match` и контекст в `CONTEXT` символов — из исходного текста; пробелы и переводы строк в них — пробелы.
 */
export function searchText(chapters: Chapter[], q: string, limit = TEXT_LIMIT): TextHit[] {
  const needle = normalizeForSearch(q);
  const hits: TextHit[] = [];
  if (needle.length < MIN_QUERY || limit <= 0) return hits;

  // Слова запроса могут стоять через любые пробелы и перевод строки
  const phrase = needle.includes(' ')
    ? new RegExp(needle.split(' ').map(escapeRegExp).join('\\s+'), 'g')
    : null;

  for (const chapter of chapters) {
    const haystack = foldedText(chapter);
    const spans: [number, number][] = [];
    if (phrase) {
      phrase.lastIndex = 0;
      for (let m = phrase.exec(haystack); m && spans.length < PER_CHAPTER; m = phrase.exec(haystack)) {
        spans.push([m.index, m.index + m[0].length]);
      }
    } else {
      for (let at = haystack.indexOf(needle); at >= 0 && spans.length < PER_CHAPTER; at = haystack.indexOf(needle, at + needle.length)) {
        spans.push([at, at + needle.length]);
      }
    }
    if (spans.length === 0) continue;

    // Исходный текст нужен только главам с совпадениями
    const original = plainText(chapter.md);
    for (const [from, to] of spans) {
      hits.push({
        bookId: chapter.bookId,
        chapter: chapter.order,
        chapterTitle: chapter.title,
        before: flat(original.slice(Math.max(0, from - CONTEXT), from)),
        match: flat(original.slice(from, to)),
        after: flat(original.slice(to, to + CONTEXT)),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
