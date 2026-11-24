import { beforeEach, describe, expect, it } from 'vitest';
import { newProgress } from '../core/progress';
import { DEFAULT_SETTINGS, type InboxItem, type Mark } from '../core/types';
import { putInbox, takeInbox } from './inbox';
import { deleteMark, getMarks, putMark } from './marks';
import { deleteProgress, getAllProgress, putProgress } from './progress';
import { openDb } from './schema';
import { getSettings, setSettings } from './settings';
import { getTasks, setTask } from './tasks';
import { freshDb } from './testing';

beforeEach(freshDb);

function markOf(bookId: string, blockKey: string, updatedAt = 1): Mark {
  return { id: `${bookId}|${blockKey}`, bookId, chapter: 1, blockKey, text: 'абзац', highlight: true, note: 'заметка', createdAt: 1, updatedAt };
}

describe('progress', () => {
  it('put / getAll / delete', async () => {
    expect(await getAllProgress()).toEqual([]);
    await putProgress(newProgress('a', 10));
    await putProgress({ ...newProgress('b', 20), chapter: 3 });
    await putProgress({ ...newProgress('a', 10), chapter: 2 });
    const all = await getAllProgress();
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.bookId === 'a')?.chapter).toBe(2);
    await deleteProgress('a');
    expect((await getAllProgress()).map((p) => p.bookId)).toEqual(['b']);
  });
});

describe('marks', () => {
  it('put / get по книге / get всех / delete', async () => {
    await putMark(markOf('a', 'p1'));
    await putMark(markOf('a', 'p2'));
    await putMark(markOf('b', 'p1'));
    expect(await getMarks()).toHaveLength(3);
    expect((await getMarks('a')).map((m) => m.id).sort()).toEqual(['a|p1', 'a|p2']);
    expect(await getMarks('нет')).toEqual([]);
    await deleteMark('a|p1');
    expect((await getMarks('a')).map((m) => m.id)).toEqual(['a|p2']);
  });

  it('повторная запись отметки заменяет её', async () => {
    await putMark(markOf('a', 'p1'));
    await putMark({ ...markOf('a', 'p1'), note: 'новая' });
    const marks = await getMarks('a');
    expect(marks).toHaveLength(1);
    expect(marks[0].note).toBe('новая');
  });
});

describe('tasks', () => {
  it('без записей — пустое состояние', async () => {
    expect(await getTasks('a')).toEqual({ bookId: 'a', done: {} });
  });

  it('setTask туда и обратно', async () => {
    expect(await setTask('a', 't1', true)).toEqual({ bookId: 'a', done: { t1: true }, updatedAt: expect.any(Number) });
    expect(await setTask('a', 't2', true)).toEqual({ bookId: 'a', done: { t1: true, t2: true }, updatedAt: expect.any(Number) });
    expect(await getTasks('a')).toEqual({ bookId: 'a', done: { t1: true, t2: true }, updatedAt: expect.any(Number) });
    expect(await setTask('a', 't1', false)).toEqual({ bookId: 'a', done: { t2: true }, updatedAt: expect.any(Number) });
    expect((await getTasks('a')).done).not.toHaveProperty('t1');
    expect(await setTask('a', 't2', false)).toEqual({ bookId: 'a', done: {}, updatedAt: expect.any(Number) });
  });

  it('снятие галочки у книги без записей не падает', async () => {
    expect(await setTask('новая', 't1', false)).toEqual({ bookId: 'новая', done: {}, updatedAt: expect.any(Number) });
  });
});

describe('settings', () => {
  it('без записей — настройки по умолчанию', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('setSettings сливается с остальными, значения по умолчанию остаются', async () => {
    await setSettings({ theme: 'dark', wpm: 220 });
    await setSettings({ fontSize: 20 });
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', wpm: 220, fontSize: 20 });
  });

  it('null и false записываются как значения', async () => {
    await setSettings({ lastBackupAt: 123, hyphens: false });
    await setSettings({ lastBackupAt: null });
    const s = await getSettings();
    expect(s.lastBackupAt).toBeNull();
    expect(s.hyphens).toBe(false);
  });

  it('чужие ключи в хранилище в настройки не попадают', async () => {
    const db = await openDb();
    await db.put('settings', { key: 'мусор', value: 1 });
    expect(Object.keys(await getSettings()).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});

describe('inbox', () => {
  it('takeInbox возвращает записи по времени и очищает хранилище', async () => {
    const a: InboxItem = { id: 'a', at: 20, text: 'второй' };
    const b: InboxItem = { id: 'b', at: 10, title: 'первый', files: [{ name: 'x.md', text: '# x' }] };
    await putInbox(a);
    await putInbox(b);
    expect(await takeInbox()).toEqual([b, a]);
    expect(await takeInbox()).toEqual([]);
  });

  it('пустой inbox — пустой список', async () => {
    expect(await takeInbox()).toEqual([]);
  });
});
