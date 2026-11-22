/** Общие мелочи карточек полки: ссылка на место чтения и строка «42% · ещё 14 мин». */
import { percentOf, remainingWords } from '../../core/progress';
import { minutesLabel } from '../../core/time';
import type { BookMeta, Progress } from '../../core/types';
import { toHash } from '../../router';

/** Глава, на которой остановился читатель. Номер из прогресса может выйти за пределы книги — тогда последняя. */
export function currentChapter(book: BookMeta, progress: Progress): { n: number; title: string } {
  const n = Math.min(Math.max(1, progress.chapter), Math.max(1, book.chapters.length));
  return { n, title: book.chapters[n - 1]?.title ?? '' };
}

/**
 * «Глава 3 · Название». Если название главы уже начинается с её номера («Глава 4. …», «Часть 2»),
 * номер экрана не добавляется: два разных номера подряд только путают.
 */
export function chapterLine(book: BookMeta, progress: Progress): string {
  const { n, title } = currentChapter(book, progress);
  if (!title) return `Глава ${n}`;
  return /^(Глава|Часть|Раздел)\s*\d/i.test(title) ? title : `Глава ${n} · ${title}`;
}

/** Читалка ровно на месте, где остановился (`#/read/:id/:chapter?b=:blockKey`). */
export function readHref(book: BookMeta, progress: Progress): string {
  const { n } = currentChapter(book, progress);
  return toHash({ name: 'read', id: book.id, chapter: n, block: progress.blockKey ?? undefined });
}

/** «42% · ещё 14 мин» */
export function progressLine(book: BookMeta, progress: Progress, wpm: number): string {
  const percent = percentOf(book, progress.wordsRead);
  return `${percent}% · ещё ${minutesLabel(remainingWords(book, progress.wordsRead), wpm)}`;
}
