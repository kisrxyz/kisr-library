import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBackupBook } from '../core/backup';
import { newProgress } from '../core/progress';
import { encodeBook } from '../core/sync';
import type { Mark } from '../core/types';
import { deleteBook, getAllBooks, saveBook } from '../db/books';
import { getMarks, putMark } from '../db/marks';
import { getAllProgress, putProgress } from '../db/progress';
import { __resetDbForTests } from '../db/schema';
import { getLastSyncAt } from '../db/sync';
import { sampleBook } from '../db/testing';
import { runSync } from './engine';
import { createFakeGitHub, type FakeGitHub } from './fakeGitHub';
import { GitHubError, repoClient, type RepoClient } from './github';

const CFG = { token: 'tok', owner: 'kisr', repo: 'kisr-library-data', branch: 'main' };

let gh: FakeGitHub;
let client: RepoClient;
const devices = { A: new IDBFactory(), B: new IDBFactory() };

/** Работаем «на устройстве»: своя IndexedDB. */
function on(name: 'A' | 'B'): void {
  __resetDbForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = devices[name];
}

function markOf(bookId: string, key: string, updatedAt: number, note = ''): Mark {
  return { id: `${bookId}|${key}`, bookId, chapter: 1, blockKey: key, text: 'абзац', highlight: true, note, createdAt: updatedAt, updatedAt };
}

beforeEach(() => {
  devices.A = new IDBFactory();
  devices.B = new IDBFactory();
  gh = createFakeGitHub();
  client = repoClient(CFG, gh.fetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** На A две книги, место чтения в первой и отметка — и первая синхронизация. */
async function seedA() {
  on('A');
  const one = sampleBook('Первая', 3, { id: 'pervaya', now: 1000 });
  const two = sampleBook('Вторая', 2, { id: 'vtoraya', now: 1000 });
  await saveBook(one.meta, one.chapters);
  await saveBook(two.meta, two.chapters);
  await putProgress({ ...newProgress('pervaya', 1000), chapter: 2, maxChapter: 2, lastReadAt: 2000 });
  await putMark(markOf('pervaya', 'k1', 1500));
  return runSync(client);
}

describe('runSync', () => {
  it('первая синхронизация пустого репозитория: README, книги и общие файлы', async () => {
    const r = await seedA();
    expect(Object.keys(gh.files()).sort()).toEqual([
      'README.md',
      'books/pervaya.json',
      'books/vtoraya.json',
      'deleted.json',
      'marks.json',
      'progress.json',
      'tasks.json',
    ]);
    expect(r.pushed).toBe(6);
    expect(await getLastSyncAt()).not.toBeNull();
  });

  it('второе устройство получает книги, место чтения и отметки', async () => {
    await seedA();
    on('B');
    const r = await runSync(client);
    expect(r).toMatchObject({ added: 2, updated: 0, removed: 0, pushed: 0, progressFrom: ['pervaya'] });
    expect((await getAllBooks()).map((b) => b.id).sort()).toEqual(['pervaya', 'vtoraya']);
    expect((await getAllProgress()).map((p) => [p.bookId, p.chapter])).toEqual([['pervaya', 2]]);
    expect((await getMarks()).map((m) => m.id)).toEqual(['pervaya|k1']);
  });

  it('повторные проходы без правок ничего не отправляют (нет «пилы» коммитов)', async () => {
    await seedA();
    on('B');
    await runSync(client);
    const commits = gh.commits();
    on('A');
    expect((await runSync(client)).pushed).toBe(0);
    on('B');
    expect((await runSync(client)).pushed).toBe(0);
    on('A');
    expect((await runSync(client)).pushed).toBe(0);
    expect(gh.commits()).toBe(commits);
  });

  it('удаление доезжает до второго устройства, и книга не возвращается', async () => {
    await seedA();
    on('B');
    await runSync(client);

    on('A');
    await deleteBook('pervaya');
    await runSync(client);
    expect(Object.keys(gh.files())).not.toContain('books/pervaya.json');

    on('B');
    const r = await runSync(client);
    expect(r.removed).toBe(1);
    expect((await getAllBooks()).map((b) => b.id)).toEqual(['vtoraya']);
    expect(await getAllProgress()).toEqual([]);
    expect(await getMarks()).toEqual([]);
    expect((await runSync(client)).pushed).toBe(0);

    on('A');
    await runSync(client);
    expect((await getAllBooks()).map((b) => b.id)).toEqual(['vtoraya']);
  });

  it('правки на обоих устройствах сходятся', async () => {
    await seedA();
    on('B');
    await runSync(client);

    on('A');
    await putProgress({ ...newProgress('pervaya', 1000), chapter: 3, maxChapter: 3, lastReadAt: 5000 });
    on('B');
    await putMark(markOf('vtoraya', 'k9', 5000, 'заметка с B'));
    await runSync(client);
    on('A');
    const onA = await runSync(client);
    on('B');
    const onB = await runSync(client);

    expect(onA.pushed).toBeGreaterThan(0);
    expect(onB.progressFrom).toEqual(['pervaya']);
    for (const d of ['A', 'B'] as const) {
      on(d);
      expect((await getAllProgress()).map((p) => p.chapter)).toEqual([3]);
      expect((await getMarks()).map((m) => m.id).sort()).toEqual(['pervaya|k1', 'vtoraya|k9']);
      expect((await runSync(client)).pushed).toBe(0);
    }
  });

  it('голова ушла вперёд во время отправки — проход повторяется и забирает чужое', async () => {
    await seedA();
    const other = sampleBook('С третьего устройства', 1, { id: 'tretya', now: 3000 });
    let advanced = false;
    const racing: RepoClient = {
      ...client,
      async commit(base, changes, message) {
        if (!advanced) {
          advanced = true;
          await gh.advance('books/tretya.json', encodeBook(toBackupBook(other.meta, other.chapters)));
        }
        return client.commit(base, changes, message);
      },
    };
    on('A');
    await putMark(markOf('vtoraya', 'k2', 4000));
    const r = await runSync(racing);
    expect(r.added).toBe(1);
    expect((await getAllBooks()).map((b) => b.id).sort()).toEqual(['pervaya', 'tretya', 'vtoraya']);
    expect(gh.files()['marks.json']).toContain('vtoraya|k2');
  });

  it('три конфликта подряд — ошибка conflict', async () => {
    await seedA();
    let n = 0;
    const always: RepoClient = {
      ...client,
      async commit(base, changes, message) {
        await gh.advance('README.md', `правка ${++n}`);
        return client.commit(base, changes, message);
      },
    };
    on('A');
    await putMark(markOf('vtoraya', 'k3', 4000));
    await expect(runSync(always)).rejects.toMatchObject({ kind: 'conflict' });
    expect(n).toBe(3);
    expect(new GitHubError('conflict', 422, '')).toBeInstanceOf(Error);
  });

  it('битый файл книги в репозитории пропускается, остальное синхронизируется', async () => {
    await seedA();
    await gh.advance('books/bad.json', 'мусор');
    on('B');
    const r = await runSync(client);
    expect(r.added).toBe(2);
    expect((await getAllBooks()).map((b) => b.id).sort()).toEqual(['pervaya', 'vtoraya']);
    expect((await runSync(client)).pushed).toBe(0);
  });
});
