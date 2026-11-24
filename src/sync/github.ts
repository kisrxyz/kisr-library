/**
 * Клиент GitHub для синхронизации (spec §18.4): Git Data API поверх `fetch`. Каждый запрос мимо кэша
 * браузера (`ref` иначе мог бы прийти из кэша до 60 с). Ошибки сводятся к понятным видам `GitHubError`.
 */
import type { SyncConfig } from '../db/sync';

const API = 'https://api.github.com';

export type GitHubErrorKind = 'offline' | 'auth' | 'forbidden' | 'notfound' | 'conflict' | 'rate' | 'server' | 'bad';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface RepoClient {
  /** Коммит на ветке; `null` — репозиторий пустой (или ветки ещё нет). */
  getHead(): Promise<string | null>;
  /** Первый коммит пустого репозитория: `README.md`. Возвращает sha коммита. */
  initRepo(readme: string): Promise<string>;
  /** Дерево коммита: его sha и все файлы (путь → sha блоба). */
  getTree(commit: string): Promise<{ tree: string; files: Record<string, string> }>;
  getBlob(sha: string): Promise<string>;
  /** Коммит поверх `base.head`: `content: null` — удалить файл. Голова ушла вперёд — `GitHubError('conflict')`. */
  commit(base: { head: string; tree: string }, changes: { path: string; content: string | null }[], message: string): Promise<{ head: string; tree: string }>;
}

/** Сколько символов содержимого класть в одно создание дерева: большие наборы уходят порциями. */
export const TREE_CHUNK_CHARS = 1_000_000;

function errorOf(res: Response): GitHubError {
  const s = res.status;
  if (s === 401) return new GitHubError('auth', s, 'Ключ не подходит');
  if (s === 429 || (s === 403 && res.headers.get('x-ratelimit-remaining') === '0')) return new GitHubError('rate', s, 'Лимит запросов GitHub');
  if (s === 403) return new GitHubError('forbidden', s, 'Нет доступа');
  if (s === 404) return new GitHubError('notfound', s, 'Не найдено');
  if (s === 409 || s === 422) return new GitHubError('conflict', s, 'Конфликт');
  if (s >= 500) return new GitHubError('server', s, 'GitHub не отвечает');
  return new GitHubError('bad', s, `Ответ GitHub ${s}`);
}

type Fetch = typeof fetch;

/** Один запрос к API: ответ `ok` или `GitHubError`. */
async function call(f: Fetch, token: string, method: string, path: string, opts: { body?: unknown; raw?: boolean } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await f(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    // Нет сети, сбой DNS или CORS: для нас всё это «нет связи»
    throw new GitHubError('offline', 0, 'Нет сети');
  }
  if (!res.ok) throw errorOf(res);
  return res;
}

async function callJson<T>(f: Fetch, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(f, token, method, path, { body });
  try {
    return (await res.json()) as T;
  } catch {
    throw new GitHubError('bad', res.status, 'Непонятный ответ GitHub');
  }
}

const seg = encodeURIComponent;

export async function getUser(token: string, f: Fetch = fetch): Promise<{ login: string }> {
  const u = await callJson<{ login: string }>(f, token, 'GET', '/user');
  return { login: u.login };
}

export async function getRepo(token: string, owner: string, repo: string, f: Fetch = fetch): Promise<RepoInfo> {
  const r = await callJson<{ full_name: string; private: boolean; default_branch: string }>(f, token, 'GET', `/repos/${seg(owner)}/${seg(repo)}`);
  return { fullName: r.full_name, private: r.private === true, defaultBranch: r.default_branch };
}

/** UTF-8 → base64 (Contents API принимает содержимое только так). */
function base64(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Изменения порциями так, чтобы в каждой было не больше `TREE_CHUNK_CHARS` символов (и хотя бы одно изменение). */
function chunks<T extends { content: string | null }>(list: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const item of list) {
    const len = item.content?.length ?? 0;
    if (cur.length && size + len > TREE_CHUNK_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(item);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function repoClient(cfg: SyncConfig, f: Fetch = fetch): RepoClient {
  const base = `/repos/${seg(cfg.owner)}/${seg(cfg.repo)}`;
  const branch = cfg.branch.split('/').map(seg).join('/');
  const json = <T>(method: string, path: string, body?: unknown) => callJson<T>(f, cfg.token, method, base + path, body);

  return {
    async getHead() {
      try {
        return (await json<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`)).object.sha;
      } catch (e) {
        // Пустой репозиторий отвечает 409, несуществующая ветка — 404
        if (e instanceof GitHubError && (e.kind === 'conflict' || e.kind === 'notfound')) return null;
        throw e;
      }
    },

    async initRepo(readme) {
      const r = await json<{ commit: { sha: string } }>('PUT', '/contents/README.md', { message: 'Kisr Library: начало', content: base64(readme) });
      return r.commit.sha;
    },

    async getTree(commit) {
      const c = await json<{ tree: { sha: string } }>('GET', `/git/commits/${seg(commit)}`);
      const t = await json<{ tree: { path: string; type: string; sha: string }[]; truncated?: boolean }>('GET', `/git/trees/${seg(c.tree.sha)}?recursive=1`);
      if (t.truncated) throw new GitHubError('bad', 200, 'Слишком много файлов в репозитории');
      const files: Record<string, string> = {};
      for (const e of t.tree) if (e.type === 'blob') files[e.path] = e.sha;
      return { tree: c.tree.sha, files };
    },

    async getBlob(sha) {
      return (await call(f, cfg.token, 'GET', `${base}/git/blobs/${seg(sha)}`, { raw: true })).text();
    },

    async commit(start, changes, message) {
      let tree = start.tree;
      for (const part of chunks(changes)) {
        const entries = part.map((c) =>
          c.content === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.content },
        );
        tree = (await json<{ sha: string }>('POST', '/git/trees', { base_tree: tree, tree: entries })).sha;
      }
      const commit = await json<{ sha: string }>('POST', '/git/commits', { message, tree, parents: [start.head] });
      // Без force: если кто-то успел раньше, GitHub ответит 422, и проход начнётся заново
      await json('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
      return { head: commit.sha, tree };
    },
  };
}
