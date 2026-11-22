import { describe, expect, it } from 'vitest';
import { newProgress } from '../../core/progress';
import type { BookMeta, Progress } from '../../core/types';
import { sampleBook } from '../../db/testing';
import { libraryStats } from './stats';

function book(id: string, cards = 0): BookMeta {
  return { ...sampleBook(`Книга ${id}`, 2, { id }).meta, cards };
}

function prog(bookId: string, patch: Partial<Progress>): Progress {
  return { ...newProgress(bookId, 1), ...patch };
}

describe('libraryStats', () => {
  it('пустая библиотека — нули', () => {
    expect(libraryStats([], new Map())).toEqual({ total: 0, finished: 0, reading: 0, minutesRead: 0, cards: 0 });
  });

  it('считает книги, прочитанные, читаемые, карточки и минуты чтения', () => {
    const books = [book('a', 10), book('b', 20), book('c', 30), book('d', 40)];
    const progress = new Map<string, Progress>([
      ['a', prog('a', { status: 'finished', readingMs: 60_000 })],
      ['b', prog('b', { status: 'reading', readingMs: 30_000 })],
      ['c', prog('c', { status: 'reading', readingMs: 90_000 })],
      // у «d» прогресса нет: книга новая
    ]);
    expect(libraryStats(books, progress)).toEqual({
      total: 4,
      finished: 1,
      reading: 2,
      minutesRead: 3, // 180 000 мс = 3 мин
      cards: 100,
    });
  });

  it('минуты — сумма по всем книгам, округлённая один раз, а не по каждой', () => {
    const books = [book('a'), book('b'), book('c')];
    const progress = new Map<string, Progress>([
      ['a', prog('a', { readingMs: 20_000 })],
      ['b', prog('b', { readingMs: 20_000 })],
      ['c', prog('c', { readingMs: 20_000 })],
    ]);
    // 60 000 мс = ровно 1 мин; по отдельности каждая округлилась бы до 0
    expect(libraryStats(books, progress).minutesRead).toBe(1);
  });

  it('прогресс удалённых книг не считается', () => {
    const progress = new Map<string, Progress>([
      ['a', prog('a', { status: 'finished', readingMs: 120_000 })],
      ['gone', prog('gone', { status: 'finished', readingMs: 600_000 })],
    ]);
    expect(libraryStats([book('a')], progress)).toEqual({ total: 1, finished: 1, reading: 0, minutesRead: 2, cards: 0 });
  });

  it('прочитанная книга не считается «читаю»', () => {
    const books = [book('a')];
    const progress = new Map<string, Progress>([['a', prog('a', { status: 'finished' })]]);
    const stats = libraryStats(books, progress);
    expect(stats.finished).toBe(1);
    expect(stats.reading).toBe(0);
  });
});
