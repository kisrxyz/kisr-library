import { describe, expect, it } from 'vitest';
import { gitBlobSha } from '../core/sync';
import { createFakeGitHub } from './fakeGitHub';
import { GitHubError, getRepo, getUser, repoClient } from './github';

const CFG = { token: 'tok', owner: 'kisr', repo: 'kisr-library-data', branch: 'main' };

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof GitHubError ? e.kind : `не GitHubError: ${String(e)}`;
  }
}

describe('getUser / getRepo', () => {
  it('логин и сведения о репозитории', async () => {
    const gh = createFakeGitHub({ login: 'kisr', repo: 'kisr-library-data' });
    expect(await getUser('tok', gh.fetch)).toEqual({ login: 'kisr' });
    expect(await getRepo('tok', 'kisr', 'kisr-library-data', gh.fetch)).toEqual({ fullName: 'kisr/kisr-library-data', private: true, defaultBranch: 'main' });
    expect(await kindOf(getRepo('tok', 'kisr', 'нет-такого', gh.fetch))).toBe('notfound');
  });

  it('открытый репозиторий так и называется', async () => {
    const gh = createFakeGitHub({ private: false });
    expect((await getRepo('tok', 'kisr', 'kisr-library-data', gh.fetch)).private).toBe(false);
  });
});

describe('repoClient', () => {
  it('пустой репозиторий: головы нет, README создаёт первый коммит', async () => {
    const gh = createFakeGitHub();
    const c = repoClient(CFG, gh.fetch);
    expect(await c.getHead()).toBeNull();
    const head = await c.initRepo('# Данные\n');
    expect(await c.getHead()).toBe(head);
    const { files } = await c.getTree(head);
    expect(Object.keys(files)).toEqual(['README.md']);
    expect(await c.getBlob(files['README.md'])).toBe('# Данные\n');
  });

  it('коммит добавляет, меняет и удаляет файлы; sha блоба — как у git', async () => {
    const gh = createFakeGitHub();
    const c = repoClient(CFG, gh.fetch);
    const head0 = await c.initRepo('readme');
    const { tree: tree0 } = await c.getTree(head0);
    const first = await c.commit({ head: head0, tree: tree0 }, [
      { path: 'books/a.json', content: 'книга а' },
      { path: 'progress.json', content: '{}' },
    ], 'm1');
    const second = await c.commit(first, [
      { path: 'books/a.json', content: null },
      { path: 'progress.json', content: '{"x":1}' },
    ], 'm2');
    expect(await c.getHead()).toBe(second.head);
    const { files, tree } = await c.getTree(second.head);
    expect(tree).toBe(second.tree);
    expect(Object.keys(files).sort()).toEqual(['README.md', 'progress.json']);
    expect(files['progress.json']).toBe(await gitBlobSha('{"x":1}'));
    expect(await c.getBlob(files['progress.json'])).toBe('{"x":1}');
    expect(gh.files()).toEqual({ 'README.md': 'readme', 'progress.json': '{"x":1}' });
  });

  it('много содержимого уходит несколькими деревьями, итог тот же', async () => {
    const gh = createFakeGitHub();
    const c = repoClient(CFG, gh.fetch);
    const head = await c.initRepo('readme');
    const { tree } = await c.getTree(head);
    const big = 'я'.repeat(400_000);
    await c.commit({ head, tree }, [1, 2, 3].map((n) => ({ path: `books/${n}.json`, content: `${n}${big}` })), 'big');
    expect(gh.treePosts()).toBe(2);
    expect(Object.keys(gh.files()).sort()).toEqual(['README.md', 'books/1.json', 'books/2.json', 'books/3.json']);
  });

  it('если голова ушла вперёд — conflict', async () => {
    const gh = createFakeGitHub();
    const c = repoClient(CFG, gh.fetch);
    const head = await c.initRepo('readme');
    const { tree } = await c.getTree(head);
    await gh.advance('marks.json', 'другое устройство');
    expect(await kindOf(c.commit({ head, tree }, [{ path: 'progress.json', content: '{}' }], 'm'))).toBe('conflict');
    expect(gh.files()).toEqual({ 'README.md': 'readme', 'marks.json': 'другое устройство' });
  });

  it('ошибки по кодам ответа', async () => {
    const gh = createFakeGitHub();
    const c = repoClient(CFG, gh.fetch);
    gh.failNext(401);
    expect(await kindOf(c.getHead())).toBe('auth');
    gh.failNext(403);
    expect(await kindOf(c.getHead())).toBe('forbidden');
    gh.failNext(403, { 'x-ratelimit-remaining': '0' });
    expect(await kindOf(c.getHead())).toBe('rate');
    gh.failNext(429);
    expect(await kindOf(c.getHead())).toBe('rate');
    gh.failNext(502);
    expect(await kindOf(c.getHead())).toBe('server');
    gh.failNext(400);
    expect(await kindOf(c.getHead())).toBe('bad');
    expect(await kindOf(getUser('tok', async () => new Response('{}', { status: 401 })))).toBe('auth');
  });

  it('сеть недоступна — offline', async () => {
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await kindOf(repoClient(CFG, offline).getHead())).toBe('offline');
  });

  it('все запросы мимо кэша браузера и с ключом', async () => {
    const gh = createFakeGitHub();
    const c = repoClient(CFG, gh.fetch);
    const head = await c.initRepo('r');
    await c.getTree(head);
    expect(gh.requests().length).toBeGreaterThan(2);
    for (const r of gh.requests()) {
      expect(r.cache).toBe('no-store');
      expect(r.auth).toBe('Bearer tok');
    }
  });
});
