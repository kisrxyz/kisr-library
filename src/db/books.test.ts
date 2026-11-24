import { beforeEach, describe, expect, it } from 'vitest';
import { newProgress } from '../core/progress';
import type { Mark } from '../core/types';
import { deleteBook, getAllBooks, getAllChapters, getBook, getChapter, getChapters, saveBook, updateBookMeta } from './books';
import { getMarks, putMark } from './marks';
import { getAllProgress, putProgress } from './progress';
import { openDb } from './schema';
import { getTasks, setTask } from './tasks';
import { freshDb, sampleBook } from './testing';

beforeEach(freshDb);

function markOf(bookId: string, blockKey: string): Mark {
  return { id: `${bookId}|${blockKey}`, bookId, chapter: 1, blockKey, text: 'абзац', highlight: true, note: '', createdAt: 1, updatedAt: 1 };
}

describe('openDb', () => {
  it('база kisr-library версии 2 со всеми хранилищами и индексами', async () => {
    const db = await openDb();
    expect(db.name).toBe('kisr-library');
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(['books', 'chapters', 'deleted', 'inbox', 'marks', 'progress', 'settings', 'sync', 'tasks']);
    const tx = db.transaction(['books', 'chapters', 'marks', 'progress', 'tasks', 'settings', 'inbox']);
    expect([...tx.objectStore('books').indexNames].sort()).toEqual(['addedAt', 'category', 'updatedAt']);
    expect([...tx.objectStore('chapters').indexNames]).toEqual(['bookId']);
    expect([...tx.objectStore('marks').indexNames].sort()).toEqual(['bookId', 'updatedAt']);
    expect(tx.objectStore('books').keyPath).toBe('id');
    expect(tx.objectStore('chapters').keyPath).toBe('id');
    expect(tx.objectStore('progress').keyPath).toBe('bookId');
    expect(tx.objectStore('marks').keyPath).toBe('id');
    expect(tx.objectStore('tasks').keyPath).toBe('bookId');
    expect(tx.objectStore('settings').keyPath).toBe('key');
    expect(tx.objectStore('inbox').keyPath).toBe('id');
    await tx.done;
  });

  it('возвращает одно и то же соединение', async () => {
    expect(await openDb()).toBe(await openDb());
  });
});

describe('saveBook / getAllBooks / getChapters', () => {
  it('сохраняет книгу и главы; главы идут по order, а не по id', async () => {
    const { meta, chapters } = sampleBook('Первая', 3, { id: 'pervaya' });
    // id нарочно не совпадают с порядком глав
    const odd = chapters.map((c, i) => ({ ...c, id: `pervaya--${['zz', 'mm', 'aa'][i]}` }));
    await saveBook({ ...meta, chapters: odd.map((c) => ({ id: c.id, title: c.title, words: c.words })) }, odd);

    expect((await getAllBooks()).map((b) => b.id)).toEqual(['pervaya']);
    expect((await getChapters('pervaya')).map((c) => c.order)).toEqual([1, 2, 3]);
    expect((await getChapters('pervaya')).map((c) => c.title)).toEqual(['Глава 1', 'Глава 2', 'Глава 3']);
  });

  it('getBook отдаёт одну книгу по id, а чужого id нет', async () => {
    const { meta, chapters } = sampleBook('Первая', 2, { id: 'pervaya' });
    await saveBook(meta, chapters);
    expect(await getBook('pervaya')).toEqual(meta);
    expect(await getBook('net-takoy')).toBeUndefined();
  });

  it('главы разных книг не смешиваются', async () => {
    const a = sampleBook('А', 2, { id: 'a' });
    const b = sampleBook('Б', 3, { id: 'b' });
    await saveBook(a.meta, a.chapters);
    await saveBook(b.meta, b.chapters);
    expect(await getChapters('a')).toHaveLength(2);
    expect(await getChapters('b')).toHaveLength(3);
    expect(await getAllChapters()).toHaveLength(5);
    expect(await getChapters('нет-такой')).toEqual([]);
  });

  it('getChapter по книге и номеру', async () => {
    const { meta, chapters } = sampleBook('Книга', 3, { id: 'kniga' });
    await saveBook(meta, chapters);
    expect((await getChapter('kniga', 2))?.title).toBe('Глава 2');
    expect(await getChapter('kniga', 9)).toBeUndefined();
    expect(await getChapter('нет', 1)).toBeUndefined();
  });

  it('повторное сохранение с меньшим числом глав удаляет лишние', async () => {
    const five = sampleBook('Книга', 5, { id: 'kniga' });
    await saveBook(five.meta, five.chapters);
    const three = sampleBook('Книга', 3, { id: 'kniga' });
    await saveBook(three.meta, three.chapters);

    const left = await getChapters('kniga');
    expect(left.map((c) => c.id)).toEqual(['kniga--01', 'kniga--02', 'kniga--03']);
    expect((await getAllChapters()).map((c) => c.id)).toEqual(['kniga--01', 'kniga--02', 'kniga--03']);
    expect((await getAllBooks())[0].chapters).toHaveLength(3);
  });

  it('повторное сохранение заменяет главы и не трогает другие книги', async () => {
    const other = sampleBook('Другая', 2, { id: 'other' });
    await saveBook(other.meta, other.chapters);
    const v1 = sampleBook('Книга', 2, { id: 'kniga' });
    await saveBook(v1.meta, v1.chapters);
    const v2 = sampleBook('Книга', 2, { id: 'kniga' });
    v2.chapters[0] = { ...v2.chapters[0], md: 'Новый текст' };
    await saveBook(v2.meta, v2.chapters);
    expect((await getChapter('kniga', 1))?.md).toBe('Новый текст');
    expect(await getChapters('other')).toHaveLength(2);
  });

  it('это одна транзакция: если запись главы не удалась, ничего не изменилось', async () => {
    const good = sampleBook('Книга', 3, { id: 'kniga' });
    await saveBook(good.meta, good.chapters);

    const next = sampleBook('Книга (правка)', 2, { id: 'kniga' });
    const broken = [next.chapters[0], { ...next.chapters[1], md: (() => 'нельзя сохранить функцию') as unknown as string }];
    await expect(saveBook(next.meta, broken)).rejects.toThrow();

    expect((await getAllBooks())[0].title).toBe('Книга');
    expect((await getChapters('kniga')).map((c) => c.id)).toEqual(['kniga--01', 'kniga--02', 'kniga--03']);
    expect((await getChapter('kniga', 1))?.md).toBe(good.chapters[0].md);
  });
});

describe('updateBookMeta', () => {
  it('сливает изменения, сохраняет id и обновляет updatedAt', async () => {
    const { meta, chapters } = sampleBook('Книга', 2, { id: 'kniga', now: 1000 });
    await saveBook(meta, chapters);
    const updated = await updateBookMeta('kniga', { favorite: true, category: 'Наука' });
    expect(updated.id).toBe('kniga');
    expect(updated.favorite).toBe(true);
    expect(updated.category).toBe('Наука');
    expect(updated.title).toBe('Книга');
    expect(updated.updatedAt).toBeGreaterThan(1000);
    expect((await getAllBooks())[0]).toEqual(updated);
  });

  it('явный updatedAt уважается', async () => {
    const { meta, chapters } = sampleBook('Книга', 1, { id: 'kniga' });
    await saveBook(meta, chapters);
    expect((await updateBookMeta('kniga', { updatedAt: 42 })).updatedAt).toBe(42);
  });

  it('undefined в патче снимает поле (например, action)', async () => {
    const { meta, chapters } = sampleBook('Книга', 1, { id: 'kniga' });
    await saveBook({ ...meta, action: { text: 'сделать', done: false } }, chapters);
    const updated = await updateBookMeta('kniga', { action: undefined });
    expect('action' in updated).toBe(false);
    expect('action' in (await getAllBooks())[0]).toBe(false);
  });

  it('неизвестная книга — ошибка', async () => {
    await expect(updateBookMeta('нет', { favorite: true })).rejects.toThrow();
  });
});

describe('deleteBook', () => {
  it('удаляет книгу, главы, прогресс, отметки и задачи, чужое не трогает', async () => {
    const a = sampleBook('А', 3, { id: 'a' });
    const b = sampleBook('Б', 2, { id: 'b' });
    await saveBook(a.meta, a.chapters);
    await saveBook(b.meta, b.chapters);
    for (const id of ['a', 'b']) {
      await putProgress(newProgress(id, 1));
      await putMark(markOf(id, 'p1'));
      await putMark(markOf(id, 'p2'));
      await setTask(id, 't1', true);
    }

    await deleteBook('a');

    expect((await getAllBooks()).map((x) => x.id)).toEqual(['b']);
    expect(await getChapters('a')).toEqual([]);
    expect((await getAllProgress()).map((p) => p.bookId)).toEqual(['b']);
    expect(await getMarks('a')).toEqual([]);
    expect(await getMarks('b')).toHaveLength(2);
    expect(await getTasks('a')).toEqual({ bookId: 'a', done: {} });
    expect(await getTasks('b')).toEqual({ bookId: 'b', done: { t1: true }, updatedAt: expect.any(Number) });
    expect(await getChapters('b')).toHaveLength(2);
  });

  it('удаление несуществующей книги не падает', async () => {
    await expect(deleteBook('нет')).resolves.toBeUndefined();
  });
});
