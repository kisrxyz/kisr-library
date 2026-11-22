import { describe, expect, it } from 'vitest';
import { newProgress } from '../../core/progress';
import type { BookMeta, Mark, Progress } from '../../core/types';
import { sampleBook } from '../../db/testing';
import { bookActions, groupMarks } from './groups';

const book = (id: string, patch: Partial<BookMeta> = {}): BookMeta => ({ ...sampleBook(`Книга ${id}`, 3, { id }).meta, ...patch });

function mark(bookId: string, key: string, updatedAt: number, patch: Partial<Mark> = {}): Mark {
  return {
    id: `${bookId}|${key}`,
    bookId,
    chapter: 1,
    blockKey: key,
    text: `Абзац ${key}`,
    highlight: true,
    note: '',
    createdAt: updatedAt,
    updatedAt,
    ...patch,
  };
}

describe('groupMarks', () => {
  it('группирует по книгам: внутри новые сверху, группы — по самой новой отметке', () => {
    const books = [book('a'), book('b'), book('c')];
    const marks = [mark('a', 'k1', 10), mark('b', 'k2', 50), mark('a', 'k3', 30), mark('b', 'k4', 20), mark('c', 'k5', 40)];
    const groups = groupMarks(marks, books);
    expect(groups.map((g) => g.book.id)).toEqual(['b', 'c', 'a']);
    expect(groups[0].marks.map((m) => m.blockKey)).toEqual(['k2', 'k4']);
    expect(groups[2].marks.map((m) => m.blockKey)).toEqual(['k3', 'k1']);
  });

  it('отметки книг, которых нет на полке, не показываются', () => {
    const groups = groupMarks([mark('gone', 'k', 5), mark('a', 'k', 6)], [book('a')]);
    expect(groups.map((g) => g.book.id)).toEqual(['a']);
  });

  it('без отметок — пусто; при равном времени порядок стабилен', () => {
    expect(groupMarks([], [book('a')])).toEqual([]);
    const groups = groupMarks([mark('a', 'x', 7), mark('a', 'y', 7)], [book('a')]);
    expect(groups[0].marks.map((m) => m.blockKey)).toEqual(['x', 'y']);
  });

  it('не меняет переданные массивы', () => {
    const marks = [mark('a', 'k1', 1), mark('a', 'k2', 2)];
    const copy = [...marks];
    groupMarks(marks, [book('a')]);
    expect(marks).toEqual(copy);
  });
});

describe('bookActions', () => {
  const act = (text: string, done = false, doneAt?: number): BookMeta['action'] => (done ? { text, done, doneAt } : { text, done });
  const fin = (id: string, finishedAt: number): Progress => ({ ...newProgress(id, 1), status: 'finished', finishedAt });

  it('только книги с действием; невыполненные сверху, свежепрочитанные раньше', () => {
    const books = [
      book('a', { action: act('A') }),
      book('b'),
      book('c', { action: act('C') }),
      book('d', { action: act('D', true, 900) }),
    ];
    const progress = new Map<string, Progress>([
      ['a', fin('a', 100)],
      ['c', fin('c', 200)],
      ['d', fin('d', 50)],
    ]);
    expect(bookActions(books, progress).map((b) => b.id)).toEqual(['c', 'a', 'd']);
  });

  it('выполненные идут по времени «сделано», без прогресса — по updatedAt книги', () => {
    const books = [
      book('a', { action: act('A', true, 100), updatedAt: 1 }),
      book('b', { action: act('B', true, 300), updatedAt: 1 }),
      book('c', { action: act('C'), updatedAt: 5 }),
      book('d', { action: act('D'), updatedAt: 9 }),
    ];
    expect(bookActions(books, new Map()).map((b) => b.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});
