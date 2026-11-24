import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProgress } from '../core/progress';
import { EMPTY_REMOTE, bookTomb, markTomb, type RemoteState } from '../core/sync';
import type { Mark } from '../core/types';
import { exportBackup, importBackup } from './backup';
import { deleteBook, getAllBooks, getAllChapters, saveBook, updateBookMeta } from './books';
import { onLocalChange, type ChangeKind } from './changes';
import { deleteMark, getMarks, putMark } from './marks';
import { getAllProgress, putProgress } from './progress';
import { DB_NAME, __resetDbForTests, openDb } from './schema';
import {
  applyIncoming,
  clearSync,
  getLastSyncAt,
  getRemoteState,
  getSyncConfig,
  readBookForUpload,
  readSyncSnapshot,
  setLastSyncAt,
  setRemoteState,
  setSyncConfig,
} from './sync';
import { getTasks, setTask } from './tasks';
import { freshDb, sampleBook } from './testing';

const NOW = 1_800_000_000_000;

beforeEach(freshDb);
afterEach(() => vi.restoreAllMocks());

function markOf(bookId: string, blockKey: string, updatedAt = 5): Mark {
  return { id: `${bookId}|${blockKey}`, bookId, chapter: 1, blockKey, text: 'абзац', highlight: true, note: '', createdAt: 1, updatedAt };
}

const CONFIG = { token: 'github_pat_секрет', owner: 'kisr', repo: 'kisr-library-data', branch: 'main' };

describe('БД версии 2', () => {
  it('открывается поверх версии 1: данные целы, новые хранилища есть', async () => {
    __resetDbForTests();
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('bookId', 'bookId');
        db.createObjectStore('progress', { keyPath: 'bookId' });
        db.createObjectStore('marks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
        db.createObjectStore('tasks', { keyPath: 'bookId' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('inbox', { keyPath: 'id' });
      },
    });
    const { meta } = sampleBook('Старая', 1, { id: 'staraya' });
    await v1.put('books', meta);
    v1.close();

    const db = await openDb();
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(['deleted', 'sync']));
    expect((await getAllBooks()).map((b) => b.id)).toEqual(['staraya']);
  });
});

describe('метки удаления', () => {
  it('deleteBook пишет book:<id> с текущим временем', async () => {
    const { meta, chapters } = sampleBook('Книга', 2, { id: 'kniga' });
    await saveBook(meta, chapters);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await deleteBook('kniga');
    expect((await readSyncSnapshot()).deleted).toEqual({ [bookTomb('kniga')]: NOW });
  });

  it('deleteMark пишет mark:<id>', async () => {
    await putMark(markOf('a', 'k'));
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await deleteMark('a|k');
    expect(await getMarks()).toEqual([]);
    expect((await readSyncSnapshot()).deleted).toEqual({ [markTomb('a|k')]: NOW });
  });

  it('setTask ставит updatedAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await setTask('a', 't1', true);
    expect(await getTasks('a')).toEqual({ bookId: 'a', done: { t1: true }, updatedAt: NOW });
  });
});

describe('уведомления об изменениях', () => {
  it('каждая запись говорит, что изменилось', async () => {
    const seen: ChangeKind[] = [];
    const off = onLocalChange((k) => seen.push(k));
    const { meta, chapters } = sampleBook('Книга', 1, { id: 'kniga' });
    await saveBook(meta, chapters);
    await updateBookMeta('kniga', { favorite: true });
    await putMark(markOf('kniga', 'k'));
    await deleteMark('kniga|k');
    await setTask('kniga', 't', true);
    await putProgress(newProgress('kniga', 1));
    await deleteBook('kniga');
    expect(seen).toEqual(['data', 'data', 'data', 'data', 'data', 'progress', 'data']);
    off();
    await putProgress(newProgress('x', 1));
    expect(seen).toHaveLength(7);
  });

  it('восстановление из копии — data; слияние синхронизации — ничего', async () => {
    const file = await exportBackup('test');
    const seen: ChangeKind[] = [];
    onLocalChange((k) => seen.push(k));
    await importBackup(file);
    expect(seen).toEqual(['data']);
    await applyIncoming({ books: [] }, EMPTY_REMOTE);
    expect(seen).toEqual(['data']);
  });
});

describe('резервная копия и синхронизация', () => {
  it('в копию не попадают ни ключ, ни метки удаления', async () => {
    await setSyncConfig(CONFIG);
    await putMark(markOf('a', 'k'));
    await deleteMark('a|k');
    const text = JSON.stringify(await exportBackup('test'));
    expect(text).not.toContain('github_pat');
    expect(text).not.toContain('mark:');
  });

  it('восстановленная книга с меткой удаления остаётся: updatedAt = сейчас, метки нет', async () => {
    const { meta, chapters } = sampleBook('Книга', 2, { id: 'kniga', now: 1000 });
    await saveBook(meta, chapters);
    await putMark(markOf('kniga', 'k', 1000));
    const file = await exportBackup('test');
    await deleteBook('kniga');

    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await importBackup(file);
    const books = await getAllBooks();
    expect(books.map((b) => [b.id, b.updatedAt])).toEqual([['kniga', NOW]]);
    expect((await readSyncSnapshot()).deleted).toEqual({});
  });

  it('восстановленная отметка с меткой удаления остаётся', async () => {
    await putMark(markOf('a', 'k', 1000));
    const file = await exportBackup('test');
    await deleteMark('a|k');
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await importBackup(file);
    expect((await getMarks()).map((m) => [m.id, m.updatedAt])).toEqual([['a|k', NOW]]);
    expect((await readSyncSnapshot()).deleted).toEqual({});
  });
});

describe('настройка синхронизации', () => {
  it('config, remote и время последней синхронизации; clearSync оставляет метки', async () => {
    expect(await getSyncConfig()).toBeNull();
    expect(await getRemoteState()).toEqual(EMPTY_REMOTE);
    expect(await getLastSyncAt()).toBeNull();

    const remote: RemoteState = { head: 'c1', tree: 't1', files: { 'progress.json': 's' }, books: { a: 1 } };
    await setSyncConfig(CONFIG);
    await setRemoteState(remote);
    await setLastSyncAt(NOW);
    expect(await getSyncConfig()).toEqual(CONFIG);
    expect(await getRemoteState()).toEqual(remote);
    expect(await getLastSyncAt()).toBe(NOW);

    await putMark(markOf('a', 'k'));
    await deleteMark('a|k');
    await clearSync();
    expect(await getSyncConfig()).toBeNull();
    expect(await getRemoteState()).toEqual(EMPTY_REMOTE);
    expect(await getLastSyncAt()).toBeNull();
    expect(Object.keys((await readSyncSnapshot()).deleted)).toEqual([markTomb('a|k')]);
  });
});

describe('readSyncSnapshot и readBookForUpload', () => {
  it('снимок: книги, прогресс, отметки, галочки, метки', async () => {
    const { meta, chapters } = sampleBook('Книга', 2, { id: 'kniga' });
    await saveBook(meta, chapters);
    await putProgress(newProgress('kniga', 1));
    await putMark(markOf('kniga', 'k'));
    await setTask('kniga', 't', true);
    const s = await readSyncSnapshot();
    expect(s.books.map((b) => b.id)).toEqual(['kniga']);
    expect(s.progress.map((p) => p.bookId)).toEqual(['kniga']);
    expect(s.marks.map((m) => m.id)).toEqual(['kniga|k']);
    expect(s.tasks.map((t) => t.bookId)).toEqual(['kniga']);
    expect(s.deleted).toEqual({});
  });

  it('книга для отправки — как в резервной копии; нет книги — null', async () => {
    const { meta, chapters } = sampleBook('Книга', 3, { id: 'kniga' });
    await saveBook(meta, chapters);
    const fromBackup = (await exportBackup('test')).books[0];
    expect(await readBookForUpload('kniga')).toEqual(fromBackup);
    expect(await readBookForUpload('нет')).toBeNull();
  });
});

describe('applyIncoming', () => {
  it('книги, удаления и remote — одной транзакцией', async () => {
    const keep = sampleBook('Остаётся', 2, { id: 'keep', now: 1000 });
    const gone = sampleBook('Уходит', 2, { id: 'gone', now: 1000 });
    await saveBook(keep.meta, keep.chapters);
    await saveBook(gone.meta, gone.chapters);
    await putProgress(newProgress('gone', 1000));
    await putMark(markOf('gone', 'k', 1000));
    await setTask('gone', 't', true);

    const incomingBook = sampleBook('Новая', 1, { id: 'new', now: 2000 });
    const { chapters: _s, ...rest } = incomingBook.meta;
    void _s;
    const remote: RemoteState = { head: 'c2', tree: 't2', files: {}, books: { new: 2000 } };
    const plan = await applyIncoming(
      { books: [{ ...rest, chapters: incomingBook.chapters.map((c) => ({ title: c.title, md: c.md })) }], deleted: { [bookTomb('gone')]: 5000 } },
      remote,
    );

    expect(plan.report).toEqual({ added: 1, updated: 0, removed: 1 });
    expect((await getAllBooks()).map((b) => b.id).sort()).toEqual(['keep', 'new']);
    expect((await getAllChapters()).filter((c) => c.bookId === 'gone')).toEqual([]);
    expect(await getAllProgress()).toEqual([]);
    expect(await getMarks()).toEqual([]);
    expect((await getTasks('gone')).done).toEqual({});
    expect((await readSyncSnapshot()).deleted).toEqual({ [bookTomb('gone')]: 5000 });
    expect(await getRemoteState()).toEqual(remote);
  });

  it('место чтения, записанное во время слияния, не затирается более старым входящим', async () => {
    const { meta, chapters } = sampleBook('Книга', 3, { id: 'kniga' });
    await saveBook(meta, chapters);
    await putProgress({ ...newProgress('kniga', 1), lastReadAt: 100 });

    const applying = applyIncoming({ books: [], progress: [{ ...newProgress('kniga', 1), chapter: 2, maxChapter: 2, lastReadAt: 200 }] }, EMPTY_REMOTE);
    const reading = putProgress({ ...newProgress('kniga', 1), chapter: 3, maxChapter: 3, lastReadAt: 300 });
    await Promise.all([applying, reading]);

    expect((await getAllProgress()).map((p) => [p.chapter, p.lastReadAt])).toEqual([[3, 300]]);
  });

  it('отметки с меткой удаления уходят', async () => {
    await putMark(markOf('a', 'k', 10));
    await applyIncoming({ books: [], deleted: { [markTomb('a|k')]: 20 } }, EMPTY_REMOTE);
    expect(await getMarks()).toEqual([]);
  });
});
