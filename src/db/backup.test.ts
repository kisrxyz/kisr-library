import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, isBackup } from '../core/backup';
import { newProgress } from '../core/progress';
import type { Mark } from '../core/types';
import { exportBackup, importBackup } from './backup';
import { getAllBooks, getAllChapters, getChapters, saveBook } from './books';
import { getMarks, putMark } from './marks';
import { getAllProgress, putProgress } from './progress';
import { getSettings, setSettings } from './settings';
import { getTasks, setTask } from './tasks';
import { freshDb, sampleBook } from './testing';

beforeEach(freshDb);

function markOf(bookId: string, blockKey: string, updatedAt = 5): Mark {
  return { id: `${bookId}|${blockKey}`, bookId, chapter: 1, blockKey, text: 'абзац', highlight: true, note: 'заметка', createdAt: 1, updatedAt };
}

async function seed() {
  const a = sampleBook('Первая', 3, { id: 'pervaya', now: 1000 });
  const b = sampleBook('Вторая', 2, { id: 'vtoraya', now: 2000 });
  await saveBook({ ...a.meta, favorite: true }, a.chapters);
  await saveBook(b.meta, b.chapters);
  await putProgress({ ...newProgress('pervaya', 1000), chapter: 2, maxChapter: 2, lastReadAt: 3000, wordsRead: 12, percent: 40 });
  await putMark(markOf('pervaya', 'p1'));
  await setTask('pervaya', 't1', true);
  await setSettings({ theme: 'sepia', wpm: 200 });
}

const byId = <T extends { id: string }>(list: T[]) => [...list].sort((x, y) => x.id.localeCompare(y.id));

describe('exportBackup', () => {
  it('собирает файл формата kisr-library-backup', async () => {
    await seed();
    const file = await exportBackup('kisr-library@1.2.3');
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.app).toBe('kisr-library@1.2.3');
    expect(file.exportedAt).toBeGreaterThan(0);
    expect(file.books.map((b) => b.id).sort()).toEqual(['pervaya', 'vtoraya']);
    const first = file.books.find((b) => b.id === 'pervaya')!;
    expect(first.chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2', 'Глава 3']);
    expect(first.chapters.every((c) => typeof c.md === 'string' && c.md.length > 0)).toBe(true);
    expect(first.favorite).toBe(true);
    expect(file.progress).toHaveLength(1);
    expect(file.marks).toHaveLength(1);
    expect(file.tasks).toEqual([{ bookId: 'pervaya', done: { t1: true } }]);
    expect(file.settings).toEqual({ theme: 'sepia', wpm: 200 });
    expect(isBackup(JSON.parse(JSON.stringify(file)))).toBe(true);
  });

  it('пустая база — пустой, но правильный файл', async () => {
    const file = await exportBackup('x');
    expect(isBackup(file)).toBe(true);
    expect(file.books).toEqual([]);
  });
});

describe('exportBackup → importBackup', () => {
  it('в чистую базу: те же книги, главы, прогресс, отметки, задачи и настройки', async () => {
    await seed();
    const books = await getAllBooks();
    const chapters = await getAllChapters();
    const progress = await getAllProgress();
    const file = JSON.parse(JSON.stringify(await exportBackup('t')));

    freshDb();
    const report = await importBackup(file);

    expect(report).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(byId(await getAllBooks())).toEqual(byId(books));
    expect(await getAllChapters()).toEqual(chapters);
    expect(await getAllProgress()).toEqual(progress);
    expect(await getMarks('pervaya')).toEqual([markOf('pervaya', 'p1')]);
    expect(await getTasks('pervaya')).toEqual({ bookId: 'pervaya', done: { t1: true } });
    expect(await getSettings()).toMatchObject({ theme: 'sepia', wpm: 200 });
  });

  it('повторный импорт того же файла ничего не меняет: пропущено 2', async () => {
    await seed();
    const file = await exportBackup('t');
    freshDb();
    await importBackup(file);
    const before = await getAllChapters();
    expect(await importBackup(file)).toEqual({ added: 0, updated: 0, skipped: 2 });
    expect(await getAllChapters()).toEqual(before);
  });

  it('более новая книга из файла заменяет нашу вместе с главами, лишние главы удаляются', async () => {
    const long = sampleBook('Книга', 5, { id: 'kniga', now: 1000 });
    await saveBook(long.meta, long.chapters);
    const file = await exportBackup('t');

    const short = sampleBook('Книга (новая)', 2, { id: 'kniga', now: 1000 });
    const { chapters: _drop, ...rest } = short.meta;
    void _drop;
    file.books = [{ ...rest, updatedAt: 9000, chapters: short.chapters.map((c) => ({ title: c.title, md: c.md })) }];
    file.progress = [];

    expect(await importBackup(file)).toEqual({ added: 0, updated: 1, skipped: 0 });
    const [book] = await getAllBooks();
    expect(book.title).toBe('Книга (новая)');
    expect(book.chapters).toHaveLength(2);
    expect((await getChapters('kniga')).map((c) => c.id)).toEqual(['kniga--01', 'kniga--02']);
  });

  it('прогресс, отметки и задачи сливаются, настройки — только пустые', async () => {
    await seed();
    const file = await exportBackup('t');
    // У нас после копии: прогресс новее, отметка новее, настройка своя и ещё одна галочка.
    await putProgress({ ...newProgress('pervaya', 1000), chapter: 3, maxChapter: 3, lastReadAt: 9000 });
    await putMark({ ...markOf('pervaya', 'p1'), note: 'новее', updatedAt: 99 });
    await setTask('pervaya', 't2', true);
    await setSettings({ theme: 'dark' });
    file.settings = { theme: 'light', fontSize: 22 };

    await importBackup(file);

    expect((await getAllProgress())[0].chapter).toBe(3);
    expect((await getMarks('pervaya'))[0].note).toBe('новее');
    expect((await getTasks('pervaya')).done).toEqual({ t1: true, t2: true });
    const s = await getSettings();
    expect(s.theme).toBe('dark');
    expect(s.fontSize).toBe(22);
  });
});
