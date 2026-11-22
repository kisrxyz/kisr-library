/** Прогресс чтения (spec §6, §8.4–8.5): проценты, «осталось», завершение книги. Чистые функции. */
import { isServiceChapter } from './book';
import type { BookMeta, Progress } from './types';

/** Слова всех глав до `chapter` (главы с 1): с этого числа начинается глава. */
export function chapterStartWords(meta: BookMeta, chapter: number): number {
  let sum = 0;
  const end = Math.min(Math.max(0, Math.floor(chapter) - 1), meta.chapters.length);
  for (let i = 0; i < end; i++) sum += meta.chapters[i].words;
  return sum;
}

/** Процент прочитанного, целое число 0..100. */
export function percentOf(meta: BookMeta, wordsRead: number): number {
  if (meta.words <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((wordsRead / meta.words) * 100)));
}

export function remainingWords(meta: BookMeta, wordsRead: number): number {
  return Math.max(0, meta.words - wordsRead);
}

export function bookStatus(p?: Progress): 'new' | 'reading' | 'finished' {
  if (!p) return 'new';
  return p.status === 'finished' ? 'finished' : 'reading';
}

/** Последняя «не служебная» глава (её дочитывать обязательно); если все служебные — последняя глава. */
export function lastRequiredChapter(meta: BookMeta): number {
  for (let i = meta.chapters.length - 1; i >= 0; i--) {
    if (!isServiceChapter(meta.chapters[i].title)) return i + 1;
  }
  return meta.chapters.length;
}

export function newProgress(bookId: string, now: number): Progress {
  return {
    bookId,
    chapter: 1,
    blockKey: null,
    blockIndex: 0,
    blockOffset: 0,
    maxChapter: 1,
    chaptersDone: [],
    wordsRead: 0,
    percent: 0,
    status: 'reading',
    startedAt: now,
    lastReadAt: now,
    readingMs: 0,
  };
}

/** Привести прогресс к книге, у которой изменилось число глав (обновление, слияние копий). */
export function clampProgress(p: Progress, meta: BookMeta): Progress {
  const count = meta.chapters.length;
  const chapter = count > 0 ? Math.min(Math.max(1, p.chapter), count) : 1;
  const next: Progress = {
    ...p,
    chapter,
    maxChapter: Math.max(chapter, count > 0 ? Math.min(Math.max(1, p.maxChapter), count) : 1),
    chaptersDone: [...new Set(p.chaptersDone.filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].sort((a, b) => a - b),
    wordsRead: Math.min(Math.max(0, p.wordsRead), meta.words),
  };
  if (chapter !== p.chapter) {
    // Позиция относилась к главе, которой больше нет: встаём на начало последней.
    next.blockKey = null;
    next.blockIndex = 0;
    next.blockOffset = 0;
    delete next.snippet;
    next.wordsRead = chapterStartWords(meta, chapter);
  }
  next.percent = next.status === 'finished' ? 100 : percentOf(meta, next.wordsRead);
  return next;
}

/**
 * Глава дочитана (виден её конец). Книга считается прочитанной, когда дочитана
 * последняя не служебная глава; `finishedNow` — это произошло только что.
 */
export function markChapterDone(
  p: Progress,
  chapter: number,
  meta: BookMeta,
  now: number,
): { progress: Progress; finishedNow: boolean } {
  const chaptersDone = [...new Set([...p.chaptersDone, chapter])].sort((a, b) => a - b);
  const wordsRead = Math.min(meta.words, Math.max(p.wordsRead, chapterStartWords(meta, chapter + 1)));
  const wasFinished = p.status === 'finished';
  const finished = wasFinished || chaptersDone.includes(lastRequiredChapter(meta));

  const progress: Progress = {
    ...p,
    chaptersDone,
    maxChapter: Math.max(p.maxChapter, chapter),
    wordsRead,
    lastReadAt: now,
    status: finished ? 'finished' : 'reading',
    percent: finished ? 100 : percentOf(meta, wordsRead),
  };
  if (finished) progress.finishedAt = p.finishedAt ?? now;
  return { progress, finishedNow: finished && !wasFinished };
}
