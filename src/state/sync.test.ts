import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLocalChange } from '../db/changes';
import { newProgress } from '../core/progress';
import { saveBook } from '../db/books';
import { putProgress } from '../db/progress';
import { __resetDbForTests } from '../db/schema';
import { getSyncConfig, setSyncConfig } from '../db/sync';
import { sampleBook } from '../db/testing';
import { createFakeGitHub, type FakeGitHub } from '../sync/fakeGitHub';
import { toasts } from '../ui/toast-state';
import { __resetLibraryForTests, books, loadLibrary } from './library';
import {
  DATA_DELAY_MS,
  PROGRESS_DELAY_MS,
  RETRY_MS,
  __resetSyncForTests,
  __setFetchForTests,
  __whenSyncIdleForTests,
  connectSync,
  disconnectSync,
  initSync,
  parseRepoInput,
  progressArrived,
  requestSync,
  syncNow,
  syncView,
} from './sync';

let gh: FakeGitHub;

function useDevice(factory: IDBFactory): void {
  __resetDbForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = factory;
}

/** Сколько проходов синхронизации было: каждый начинается с чтения головы ветки. */
const passes = () => gh.requests().filter((r) => r.method === 'GET' && r.path.endsWith('/git/ref/heads/main')).length;

/** Продвинуть время и дождаться, пока синхронизация закончит всё, что успела начать. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await __whenSyncIdleForTests();
}

/** Поддельные `document` и `window`: синхронизация слушает только события и `visibilityState`. */
function fakeEnv() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = new EventTarget();
  return { doc, win };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useDevice(new IDBFactory());
  __resetSyncForTests();
  __resetLibraryForTests();
  toasts.value = [];
  gh = createFakeGitHub({ token: 'right' });
  __setFetchForTests(gh.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await __whenSyncIdleForTests();
  __resetSyncForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('parseRepoInput', () => {
  it('название, владелец/название, ссылка', () => {
    expect(parseRepoInput('kisr-library-data', 'kisr')).toEqual({ owner: 'kisr', repo: 'kisr-library-data' });
    expect(parseRepoInput('  ', 'kisr')).toEqual({ owner: 'kisr', repo: 'kisr-library-data' });
    expect(parseRepoInput('other/books', 'kisr')).toEqual({ owner: 'other', repo: 'books' });
    expect(parseRepoInput('https://github.com/kisr/kisr-library-data', 'x')).toEqual({ owner: 'kisr', repo: 'kisr-library-data' });
    expect(parseRepoInput('https://github.com/kisr/kisr-library-data.git/', 'x')).toEqual({ owner: 'kisr', repo: 'kisr-library-data' });
    expect(parseRepoInput('не репозиторий', 'kisr')).toBeNull();
    expect(parseRepoInput('a/b/c', 'kisr')).toBeNull();
  });
});

describe('connectSync', () => {
  it('открытый репозиторий — отказ, настройка не сохраняется', async () => {
    gh = createFakeGitHub({ token: 'right', private: false });
    __setFetchForTests(gh.fetch);
    const r = await connectSync('right', 'kisr-library-data');
    expect(r).toEqual({ ok: false, message: expect.stringContaining('открытый') });
    expect(await getSyncConfig()).toBeNull();
    expect(gh.files()).toEqual({});
  });

  it('неверный ключ — понятный отказ', async () => {
    const r = await connectSync('wrong', '');
    expect(r).toEqual({ ok: false, message: expect.stringContaining('Ключ не подходит') });
  });

  it('удачно: настройка сохранена, первый проход сделан', async () => {
    const { meta, chapters } = sampleBook('Книга', 1, { id: 'kniga' });
    await saveBook(meta, chapters);
    const r = await connectSync(' right ', '');
    expect(r.ok).toBe(true);
    expect(await getSyncConfig()).toEqual({ token: 'right', owner: 'kisr', repo: 'kisr-library-data', branch: 'main' });
    expect(Object.keys(gh.files())).toContain('books/kniga.json');
    expect(syncView.value).toMatchObject({ phase: 'idle', repo: 'kisr/kisr-library-data', error: null, needsToken: false });
    expect(syncView.value.lastSyncAt).not.toBeNull();
  });
});

describe('расписание', () => {
  beforeEach(async () => {
    await connectSync('right', '');
  });

  it('правка — проход через 3 с', async () => {
    const before = passes();
    notifyLocalChange('data');
    await advance(DATA_DELAY_MS - 1);
    expect(passes()).toBe(before);
    await advance(1);
    expect(passes()).toBe(before + 1);
  });

  it('серия мест чтения — один проход через 60 с после последнего', async () => {
    const before = passes();
    notifyLocalChange('progress');
    await advance(30_000);
    notifyLocalChange('progress');
    await advance(20_000);
    notifyLocalChange('progress');
    await advance(PROGRESS_DELAY_MS - 1);
    expect(passes()).toBe(before);
    await advance(1);
    expect(passes()).toBe(before + 1);
    await advance(10 * 60_000);
    expect(passes()).toBe(before + 1);
  });

  it('правка не ждёт отложенного места чтения', async () => {
    const before = passes();
    notifyLocalChange('progress');
    await advance(1000);
    notifyLocalChange('data');
    await advance(DATA_DELAY_MS);
    expect(passes()).toBe(before + 1);
  });

  it('запрос во время прохода — ещё один проход после него', async () => {
    const before = passes();
    const first = syncNow();
    requestSync();
    await first;
    await advance(0);
    expect(passes()).toBe(before + 2);
  });

  it('нет сети — фаза offline и повтор через минуту', async () => {
    let offline = true;
    __setFetchForTests(((...a: Parameters<typeof fetch>) => (offline ? Promise.reject(new TypeError('Failed to fetch')) : gh.fetch(...a))) as typeof fetch);
    await syncNow();
    expect(syncView.value.phase).toBe('offline');
    offline = false;
    const before = passes();
    await advance(RETRY_MS[0]);
    expect(passes()).toBe(before + 1);
    expect(syncView.value.phase).toBe('idle');
  });

  it('ключ протух — ошибка, нужен новый ключ, без повторов', async () => {
    gh.failNext(401);
    await syncNow();
    expect(syncView.value).toMatchObject({ phase: 'error', needsToken: true, error: expect.stringContaining('Ключ не подходит') });
    const before = passes();
    notifyLocalChange('data');
    await advance(30 * 60_000);
    expect(passes()).toBe(before);
  });

  it('отключение: фаза off, правки больше не синхронизируются', async () => {
    await disconnectSync();
    expect(syncView.value.phase).toBe('off');
    expect(await getSyncConfig()).toBeNull();
    const before = gh.requests().length;
    notifyLocalChange('data');
    await advance(60_000);
    expect(gh.requests().length).toBe(before);
  });
});

describe('приход с другого устройства', () => {
  it('полка перечитывается, тост про новые книги, место чтения отмечено', async () => {
    const deviceA = new IDBFactory();
    useDevice(deviceA);
    const one = sampleBook('Первая', 2, { id: 'pervaya' });
    const two = sampleBook('Вторая', 2, { id: 'vtoraya' });
    await saveBook(one.meta, one.chapters);
    await saveBook(two.meta, two.chapters);
    await connectSync('right', '');

    __resetSyncForTests();
    useDevice(new IDBFactory());
    await loadLibrary();
    expect(books.value).toEqual([]);
    await connectSync('right', '');
    expect(books.value.map((b) => b.id).sort()).toEqual(['pervaya', 'vtoraya']);
    expect(toasts.value.map((t) => t.text)).toContain('С другого устройства: +2 книги');
    expect(progressArrived.value).toBeNull();
  });
});

describe('место чтения с другого устройства', () => {
  async function shareFromA(chapter: number, lastReadAt: number) {
    const deviceA = new IDBFactory();
    useDevice(deviceA);
    const one = sampleBook('Первая', 3, { id: 'pervaya' });
    await saveBook(one.meta, one.chapters);
    await putProgress({ ...newProgress('pervaya', 1000), chapter, maxChapter: chapter, lastReadAt });
    await connectSync('right', '');
    __resetSyncForTests();
  }

  it('сдвинулось — книга в progressArrived', async () => {
    await shareFromA(3, 5000);
    useDevice(new IDBFactory());
    const one = sampleBook('Первая', 3, { id: 'pervaya' });
    await saveBook(one.meta, one.chapters);
    await putProgress({ ...newProgress('pervaya', 1000), chapter: 1, lastReadAt: 2000 });
    await loadLibrary();
    await connectSync('right', '');
    expect(progressArrived.value?.ids).toEqual(['pervaya']);
  });

  it('то же место, другое только время — подсказки нет', async () => {
    await shareFromA(2, 5000);
    useDevice(new IDBFactory());
    const one = sampleBook('Первая', 3, { id: 'pervaya' });
    await saveBook(one.meta, one.chapters);
    await putProgress({ ...newProgress('pervaya', 1000), chapter: 2, maxChapter: 2, lastReadAt: 2000 });
    await loadLibrary();
    await connectSync('right', '');
    expect(progressArrived.value).toBeNull();
  });
});

describe('initSync', () => {
  it('при запуске: проход, если синхронизация включена; уход из приложения отправляет отложенное сразу', async () => {
    await setSyncConfig({ token: 'right', owner: 'kisr', repo: 'kisr-library-data', branch: 'main' });
    const { doc, win } = fakeEnv();
    await initSync({ doc, win });
    await advance(0);
    expect(passes()).toBe(1);
    expect(syncView.value.phase).toBe('idle');

    notifyLocalChange('progress');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await advance(0);
    expect(passes()).toBe(2);

    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await advance(0);
    expect(passes()).toBe(3);

    win.dispatchEvent(new Event('online'));
    await advance(0);
    expect(passes()).toBe(4);
  });

  it('репозиторий стал открытым — синхронизация останавливается и ничего не отправляет', async () => {
    gh = createFakeGitHub({ token: 'right', private: false });
    __setFetchForTests(gh.fetch);
    await setSyncConfig({ token: 'right', owner: 'kisr', repo: 'kisr-library-data', branch: 'main' });
    const { meta, chapters } = sampleBook('Книга', 1, { id: 'kniga' });
    await saveBook(meta, chapters);
    const { doc, win } = fakeEnv();
    await initSync({ doc, win });
    await advance(0);
    expect(syncView.value).toMatchObject({ phase: 'error', error: expect.stringContaining('открытый') });
    expect(gh.files()).toEqual({});
  });

  it('выключена — ничего не делает', async () => {
    const { doc, win } = fakeEnv();
    await initSync({ doc, win });
    await advance(0);
    expect(syncView.value.phase).toBe('off');
    expect(gh.requests()).toEqual([]);
  });
});
