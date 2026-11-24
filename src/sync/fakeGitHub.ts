/**
 * Поддельный GitHub в памяти для тестов синхронизации: та же подмножина REST API, что использует
 * `github.ts` (user, repos, git refs/commits/trees/blobs, contents для первого коммита). Приложение это не импортирует.
 */
import { canonicalJson, gitBlobSha } from '../core/sync';

interface Commit {
  tree: string;
  parents: string[];
}

export interface FakeRequest {
  method: string;
  path: string;
  cache: RequestCache | undefined;
  auth: string | null;
}

export interface FakeGitHub {
  fetch: typeof fetch;
  /** Файлы на текущей голове: путь → текст. */
  files(): Record<string, string>;
  /** Сколько коммитов в истории ветки. */
  commits(): number;
  /** Сколько раз создавали дерево (`POST git/trees`). */
  treePosts(): number;
  requests(): FakeRequest[];
  /** Следующий запрос ответит этим кодом. */
  failNext(status: number, headers?: Record<string, string>): void;
  /** «Другое устройство» сделало коммит с этим файлом. */
  advance(path: string, text: string | null): Promise<void>;
}

export function createFakeGitHub(opts: { login?: string; repo?: string; private?: boolean; token?: string } = {}): FakeGitHub {
  const login = opts.login ?? 'kisr';
  const repoName = opts.repo ?? 'kisr-library-data';
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, Commit>();
  let ref: string | null = null;
  let commitCount = 0;
  let treePostCount = 0;
  const log: FakeRequest[] = [];
  let failure: { status: number; headers: Record<string, string> } | null = null;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function putBlob(text: string): Promise<string> {
    const sha = await gitBlobSha(text);
    blobs.set(sha, text);
    return sha;
  }

  async function putTree(entries: Map<string, string>): Promise<string> {
    const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : 1));
    const sha = `t${(await gitBlobSha(canonicalJson(sorted))).slice(0, 39)}`;
    trees.set(sha, new Map(sorted));
    return sha;
  }

  function putCommit(tree: string, parents: string[]): string {
    commitCount++;
    const sha = `c${String(commitCount).padStart(39, '0')}`;
    commits.set(sha, { tree, parents });
    return sha;
  }

  function filesAt(head: string | null): Map<string, string> {
    return head ? new Map(trees.get(commits.get(head)!.tree)) : new Map();
  }

  async function handle(method: string, path: string, body: Record<string, unknown> | undefined, accept: string): Promise<Response> {
    if (method === 'GET' && path === '/user') return json(200, { login });

    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!m) return json(404, { message: 'Not Found' });
    const [, owner, name, rest = ''] = m;
    if (decodeURIComponent(owner) !== login || decodeURIComponent(name) !== repoName) return json(404, { message: 'Not Found' });

    if (method === 'GET' && rest === '') {
      return json(200, { full_name: `${login}/${repoName}`, private: opts.private ?? true, default_branch: 'main' });
    }
    if (method === 'GET' && rest === '/git/ref/heads/main') {
      return ref ? json(200, { ref: 'refs/heads/main', object: { sha: ref, type: 'commit' } }) : json(409, { message: 'Git Repository is empty.' });
    }
    if (method === 'PUT' && rest.startsWith('/contents/')) {
      if (ref) return json(422, { message: 'sha wasn\'t supplied' });
      const file = decodeURIComponent(rest.slice('/contents/'.length));
      const bytes = Uint8Array.from(atob(String(body?.content ?? '')), (ch) => ch.charCodeAt(0));
      const blob = await putBlob(new TextDecoder().decode(bytes));
      const tree = await putTree(new Map([[file, blob]]));
      ref = putCommit(tree, []);
      return json(201, { content: { sha: blob }, commit: { sha: ref } });
    }
    const commitMatch = rest.match(/^\/git\/commits\/(\w+)$/);
    if (method === 'GET' && commitMatch) {
      const c = commits.get(commitMatch[1]);
      return c ? json(200, { sha: commitMatch[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : json(404, { message: 'Not Found' });
    }
    const treeMatch = rest.match(/^\/git\/trees\/(\w+)\?recursive=1$/);
    if (method === 'GET' && treeMatch) {
      const t = trees.get(treeMatch[1]);
      if (!t) return json(404, { message: 'Not Found' });
      const dirs = new Set([...t.keys()].filter((p) => p.includes('/')).map((p) => p.slice(0, p.lastIndexOf('/'))));
      const entries = [
        ...[...dirs].map((p) => ({ path: p, mode: '040000', type: 'tree', sha: 'd'.repeat(40) })),
        ...[...t].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })),
      ];
      return json(200, { sha: treeMatch[1], tree: entries, truncated: false });
    }
    const blobMatch = rest.match(/^\/git\/blobs\/(\w+)$/);
    if (method === 'GET' && blobMatch) {
      const text = blobs.get(blobMatch[1]);
      if (text === undefined) return json(404, { message: 'Not Found' });
      return accept.includes('raw') ? new Response(text, { status: 200 }) : json(200, { content: btoa(String.fromCharCode(...new TextEncoder().encode(text))), encoding: 'base64' });
    }
    if (method === 'POST' && rest === '/git/trees') {
      treePostCount++;
      const base = typeof body?.base_tree === 'string' ? trees.get(body.base_tree) : undefined;
      if (body?.base_tree && !base) return json(422, { message: 'base_tree not found' });
      const next = new Map(base);
      for (const e of body?.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (e.content !== undefined) next.set(e.path, await putBlob(e.content));
        else if (e.sha === null) {
          if (!next.has(e.path)) return json(422, { message: 'GitRPC::BadObjectState' });
          next.delete(e.path);
        } else if (e.sha) next.set(e.path, e.sha);
      }
      const sha = await putTree(next);
      return json(201, { sha, tree: [] });
    }
    if (method === 'POST' && rest === '/git/commits') {
      const tree = String(body?.tree);
      if (!trees.has(tree)) return json(422, { message: 'Tree not found' });
      const sha = putCommit(tree, (body?.parents as string[]) ?? []);
      return json(201, { sha, tree: { sha: tree } });
    }
    if (method === 'PATCH' && rest === '/git/refs/heads/main') {
      const sha = String(body?.sha);
      const c = commits.get(sha);
      if (!c) return json(422, { message: 'Object does not exist' });
      if (ref && !c.parents.includes(ref) && body?.force !== true) return json(422, { message: 'Update is not a fast forward' });
      ref = sha;
      return json(200, { ref: 'refs/heads/main', object: { sha } });
    }
    return json(404, { message: 'Not Found' });
  }

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const path = url.pathname + url.search;
    log.push({ method, path, cache: init?.cache, auth: headers.get('authorization') });
    if (failure) {
      const { status, headers: h } = failure;
      failure = null;
      return json(status, { message: `fail ${status}` }, h);
    }
    if (opts.token && headers.get('authorization') !== `Bearer ${opts.token}`) return json(401, { message: 'Bad credentials' });
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    return handle(method, path, body, headers.get('accept') ?? '');
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    files: () => Object.fromEntries([...filesAt(ref)].map(([p, sha]) => [p, blobs.get(sha)!])),
    commits: () => {
      let n = 0;
      for (let c = ref; c; c = commits.get(c)!.parents[0] ?? null) n++;
      return n;
    },
    treePosts: () => treePostCount,
    requests: () => log,
    failNext(status, headers = {}) {
      failure = { status, headers };
    },
    async advance(path, text) {
      const next = filesAt(ref);
      if (text === null) next.delete(path);
      else next.set(path, await putBlob(text));
      ref = putCommit(await putTree(next), ref ? [ref] : []);
    },
  };
}
