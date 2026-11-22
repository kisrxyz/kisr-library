import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProgress } from '../core/progress';
import { getAllBooks, getChapters } from '../db/books';
import { getAllProgress, putProgress } from '../db/progress';
import { brokenDb, freshDb, hangingDb, sampleBook } from '../db/testing';
import {
  DELETE_UNDO_MS,
  STARTUP_TIMEOUT_MS,
  __resetLibraryForTests,
  books,
  editBookMeta,
  libraryError,
  libraryReady,
  loadLibrary,
  progressMap,
  reloadAfterRestore,
  saveImportedBook,
  saveProgress,
  scheduleDelete,
  setBookAction,
  setFinished,
  startLibrary,
  toggleFavorite,
  undoDelete,
} from './library';
import { settings } from './settings';
import { setSettings } from '../db/settings';

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

async function addBook(title: string, chapters = 3, id = title.toLowerCase()) {
  const b = sampleBook(title, chapters, { id });
  await saveImportedBook(b.meta, b.chapters);
  return b;
}

describe('loadLibrary', () => {
  it('читает книги и прогресс из БД и ставит libraryReady', async () => {
    const a = sampleBook('А', 2, { id: 'a' });
    await saveImportedBook(a.meta, a.chapters);
    await putProgress(newProgress('a', 1));
    __resetLibraryForTests();
    expect(libraryReady.value).toBe(false);

    await loadLibrary();

    expect(books.value.map((b) => b.id)).toEqual(['a']);
    expect(progressMap.value.get('a')?.bookId).toBe('a');
    expect(libraryReady.value).toBe(true);
  });

  it('пустая база — пустая полка, но библиотека готова', async () => {
    await loadLibrary();
    expect(books.value).toEqual([]);
    expect(libraryReady.value).toBe(true);
  });
});

describe('startLibrary: запуск приложения', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('база открылась — библиотека готова, ошибки нет', async () => {
    await addBook('Книга', 1, 'kniga');
    __resetLibraryForTests();
    await startLibrary();
    expect(libraryReady.value).toBe(true);
    expect(libraryError.value).toBe(false);
    expect(books.value.map((b) => b.id)).toEqual(['kniga']);
  });

  it('база не открылась — ошибка хранилища, полка не «готова»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    brokenDb();
    await startLibrary();
    expect(libraryError.value).toBe(true);
    expect(libraryReady.value).toBe(false);
  });

  it('открытие базы повисло — через 8 секунд та же ошибка', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    hangingDb();
    let finished = false;
    const started = startLibrary().then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(STARTUP_TIMEOUT_MS - 1);
    expect(finished).toBe(false);
    expect(libraryError.value).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(libraryError.value).toBe(true);
    expect(libraryReady.value).toBe(false);
  });
});

describe('saveImportedBook', () => {
  it('сохраняет в БД и добавляет в сигнал; повторная запись заменяет, а не дублирует', async () => {
    const b = await addBook('Книга', 3, 'kniga');
    expect(books.value).toHaveLength(1);
    await saveImportedBook({ ...b.meta, title: 'Книга (новая)' }, b.chapters);
    expect(books.value).toHaveLength(1);
    expect(books.value[0].title).toBe('Книга (новая)');
    expect((await getAllBooks())[0].title).toBe('Книга (новая)');
  });

  it('при обновлении на меньшее число глав прогресс ограничивается', async () => {
    await addBook('Книга', 5, 'kniga');
    await saveProgress({ ...newProgress('kniga', 1), chapter: 5, maxChapter: 5, chaptersDone: [1, 2, 3, 4] });

    const shorter = sampleBook('Книга', 3, { id: 'kniga' });
    await saveImportedBook(shorter.meta, shorter.chapters);

    expect(progressMap.value.get('kniga')?.chapter).toBe(3);
    expect((await getAllProgress())[0].chapter).toBe(3);
    expect((await getChapters('kniga')).map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it('прогресс в границах не перезаписывается', async () => {
    await addBook('Книга', 3, 'kniga');
    const p = { ...newProgress('kniga', 1), chapter: 2, maxChapter: 2, wordsRead: 0, percent: 0 };
    await saveProgress(p);
    const same = sampleBook('Книга', 3, { id: 'kniga' });
    await saveImportedBook(same.meta, same.chapters);
    expect(progressMap.value.get('kniga')).toBe(p);
  });
});

describe('toggleFavorite / editBookMeta / setBookAction', () => {
  it('toggleFavorite переключает и пишет в БД', async () => {
    await addBook('Книга', 1, 'kniga');
    await toggleFavorite('kniga');
    expect(books.value[0].favorite).toBe(true);
    expect((await getAllBooks())[0].favorite).toBe(true);
    await toggleFavorite('kniga');
    expect(books.value[0].favorite).toBe(false);
  });

  it('toggleFavorite неизвестной книги ничего не делает', async () => {
    await expect(toggleFavorite('нет')).resolves.toBeUndefined();
  });

  it('editBookMeta меняет название, раздел и теги', async () => {
    await addBook('Книга', 1, 'kniga');
    await editBookMeta('kniga', { title: 'Новое', category: 'Наука', tags: ['а', 'б'] });
    expect(books.value[0]).toMatchObject({ title: 'Новое', category: 'Наука', tags: ['а', 'б'], id: 'kniga' });
    expect((await getAllBooks())[0].category).toBe('Наука');
  });

  it('setBookAction задаёт, отмечает и убирает действие', async () => {
    await addBook('Книга', 1, 'kniga');
    await setBookAction('kniga', { text: 'Выписать три правила', done: false });
    expect(books.value[0].action).toEqual({ text: 'Выписать три правила', done: false });
    await setBookAction('kniga', { text: 'Выписать три правила', done: true, doneAt: 5 });
    expect((await getAllBooks())[0].action?.done).toBe(true);
    await setBookAction('kniga', undefined);
    expect('action' in books.value[0]).toBe(false);
    expect('action' in (await getAllBooks())[0]).toBe(false);
  });
});

describe('saveProgress / setFinished', () => {
  it('saveProgress обновляет сигнал сразу и пишет в БД', async () => {
    const p = { ...newProgress('a', 1), chapter: 2 };
    const done = saveProgress(p);
    expect(progressMap.value.get('a')).toBe(p);
    await done;
    expect((await getAllProgress())[0].chapter).toBe(2);
  });

  it('новый Map на каждое изменение, чтобы сигнал сработал', async () => {
    const before = progressMap.value;
    await saveProgress(newProgress('a', 1));
    expect(progressMap.value).not.toBe(before);
    expect(before.size).toBe(0);
  });

  it('setFinished(true) без прогресса создаёт запись «прочитано»', async () => {
    await addBook('Книга', 3, 'kniga');
    await setFinished('kniga', true);
    const p = progressMap.value.get('kniga')!;
    expect(p.status).toBe('finished');
    expect(p.percent).toBe(100);
    expect(p.finishedAt).toBeGreaterThan(0);
    expect(p.chaptersDone).toContain(3);
    expect((await getAllProgress())[0].status).toBe('finished');
  });

  it('setFinished(false) возвращает в «Читаю», процент честный', async () => {
    await addBook('Книга', 4, 'kniga');
    await saveProgress({ ...newProgress('kniga', 1), chapter: 2, maxChapter: 2, wordsRead: 20 });
    await setFinished('kniga', true);
    await setFinished('kniga', false);
    const p = progressMap.value.get('kniga')!;
    expect(p.status).toBe('reading');
    expect('finishedAt' in p).toBe(false);
    expect(p.chaptersDone).not.toContain(4);
    expect(p.percent).toBeLessThan(100);
    expect(p.chapter).toBe(2);
  });

  it('setFinished(false) у непрочитанной книги ничего не создаёт', async () => {
    await addBook('Книга', 2, 'kniga');
    await setFinished('kniga', false);
    expect(progressMap.value.size).toBe(0);
  });
});

describe('scheduleDelete / undoDelete', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('книга скрывается сразу, а из БД уходит через 6 секунд', async () => {
    await addBook('А', 2, 'a');
    await addBook('Б', 2, 'b');
    await saveProgress(newProgress('a', 1));

    scheduleDelete('a');
    expect(books.value.map((b) => b.id)).toEqual(['b']);
    expect((await getAllBooks()).map((b) => b.id).sort()).toEqual(['a', 'b']);

    await vi.advanceTimersByTimeAsync(DELETE_UNDO_MS - 1);
    expect((await getAllBooks()).map((b) => b.id).sort()).toEqual(['a', 'b']);

    await vi.advanceTimersByTimeAsync(1);
    // запись в БД идёт на настоящих задачах — дожидаемся её
    await vi.waitFor(async () => expect((await getAllBooks()).map((b) => b.id)).toEqual(['b']));
    expect(await getChapters('a')).toEqual([]);
    expect(await getAllProgress()).toEqual([]);
    expect(progressMap.value.has('a')).toBe(false);
  });

  it('undoDelete в окне отмены возвращает книгу на место, и в БД она остаётся', async () => {
    await addBook('А', 2, 'a');
    await addBook('Б', 2, 'b');
    await addBook('В', 2, 'v');
    scheduleDelete('b');
    expect(books.value.map((x) => x.id)).toEqual(['a', 'v']);

    await vi.advanceTimersByTimeAsync(3000);
    undoDelete('b');
    expect(books.value.map((x) => x.id)).toEqual(['a', 'b', 'v']);

    await vi.advanceTimersByTimeAsync(10_000);
    expect((await getAllBooks()).map((x) => x.id).sort()).toEqual(['a', 'b', 'v']);
    expect(await getChapters('b')).toHaveLength(2);
  });

  it('loadLibrary в окне отмены не возвращает скрытую книгу', async () => {
    await addBook('А', 2, 'a');
    scheduleDelete('a');
    await loadLibrary();
    expect(books.value).toEqual([]);
    undoDelete('a');
    await loadLibrary();
    expect(books.value.map((x) => x.id)).toEqual(['a']);
  });

  it('повторный scheduleDelete не сбрасывает таймер, неизвестный id игнорируется', async () => {
    await addBook('А', 2, 'a');
    scheduleDelete('a');
    await vi.advanceTimersByTimeAsync(4000);
    scheduleDelete('a');
    scheduleDelete('нет');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(async () => expect(await getAllBooks()).toEqual([]));
  });

  it('undoDelete после удаления или без него ничего не ломает', async () => {
    undoDelete('нет');
    expect(books.value).toEqual([]);
  });
});

describe('reloadAfterRestore', () => {
  it('перечитывает книги, прогресс и настройки', async () => {
    const a = sampleBook('А', 2, { id: 'a' });
    const { saveBook } = await import('../db/books');
    await saveBook(a.meta, a.chapters);
    await putProgress(newProgress('a', 1));
    await setSettings({ wpm: 240 });

    await reloadAfterRestore();

    expect(books.value.map((b) => b.id)).toEqual(['a']);
    expect(progressMap.value.has('a')).toBe(true);
    expect(settings.value.wpm).toBe(240);
  });
});
