/**
 * Один проход синхронизации (spec §18.4): забрать изменившиеся файлы, слить с базой одной транзакцией,
 * отправить своё одним коммитом. Если кто-то успел закоммитить раньше — проход начинается заново (до 3 раз).
 */
import {
  SHARED_FILES,
  bookPath,
  decodeBook,
  decodeShared,
  encodeBook,
  encodeShared,
  gitBlobSha,
  isBookPath,
  planPush,
  sharedOf,
  type Incoming,
  type RemoteState,
  type SharedPath,
} from '../core/sync';
import { applyIncoming, getRemoteState, readBookForUpload, readSyncSnapshot, setLastSyncAt, setRemoteState } from '../db/sync';
import { GitHubError, type RepoClient } from './github';

export interface SyncResult {
  /** Книги с других устройств: новые, обновлённые, удалённые здесь. */
  added: number;
  updated: number;
  removed: number;
  /** Сколько файлов отправлено (0 — нечего было отправлять). */
  pushed: number;
  /** Книги, чьё место чтения пришло из репозитория. */
  progressFrom: string[];
}

const ATTEMPTS = 3;
const PARALLEL_DOWNLOADS = 6;
const COMMIT_MESSAGE = 'Kisr Library: синхронизация';
const README = `# Kisr Library — данные

Здесь приложение Kisr Library хранит общую копию твоей библиотеки, чтобы она была одинаковой на всех устройствах.

- Не делай этот репозиторий открытым: здесь лежат твои книги, места чтения и заметки.
- Файлы правит само приложение. Руками их лучше не трогать.
`;

const isShared = (path: string): path is SharedPath => (SHARED_FILES as readonly string[]).includes(path);

/** `fn` для каждого элемента, не больше `limit` одновременно; порядок результатов — как у входа. */
async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/** Забрать изменившееся: новый `remote` и входящие данные. Если голова та же, ничего не скачивается. */
async function pull(client: RepoClient, remote: RemoteState, head: string): Promise<{ next: RemoteState; incoming: Incoming }> {
  const next: RemoteState = { head: remote.head, tree: remote.tree, files: { ...remote.files }, books: { ...remote.books } };
  const incoming: Incoming = { books: [] };
  if (head === remote.head && remote.tree) return { next, incoming };

  const { tree, files } = await client.getTree(head);
  for (const path of Object.keys(next.files)) if (!(path in files)) delete next.files[path];
  for (const id of Object.keys(next.books)) if (!(bookPath(id) in files)) delete next.books[id];

  const changed = Object.entries(files).filter(([path, sha]) => next.files[path] !== sha && (isBookPath(path) || isShared(path)));
  const texts = await mapLimit(changed, PARALLEL_DOWNLOADS, ([, sha]) => client.getBlob(sha));
  changed.forEach(([path, sha], i) => {
    // Битый файл запоминаем, чтобы не скачивать его каждый раз; при следующей правке он перезапишется
    next.files[path] = sha;
    if (isBookPath(path)) {
      const book = decodeBook(texts[i]);
      if (!book) return console.warn('Синхронизация: пропускаю непонятный файл', path);
      incoming.books.push(book);
      next.books[book.id] = book.updatedAt;
      return;
    }
    const part = isShared(path) ? decodeShared(path, texts[i]) : null;
    if (!part) return console.warn('Синхронизация: пропускаю непонятный файл', path);
    Object.assign(incoming, part);
  });
  next.head = head;
  next.tree = tree;
  return { next, incoming };
}

async function pass(client: RepoClient, now: () => number): Promise<SyncResult> {
  const remote = await getRemoteState();
  const head = (await client.getHead()) ?? (await client.initRepo(README));
  const { next, incoming } = await pull(client, remote, head);
  const plan = await applyIncoming(incoming, next);

  const local = await readSyncSnapshot();
  const sharedTexts = encodeShared(sharedOf(local));
  const shas = Object.fromEntries(await Promise.all(SHARED_FILES.map(async (p) => [p, await gitBlobSha(sharedTexts[p])]))) as Record<SharedPath, string>;
  const out = planPush(local, next, shas);

  const changes: { path: string; content: string | null; book?: { id: string; updatedAt: number } }[] = [];
  for (const id of out.books) {
    const book = await readBookForUpload(id);
    if (book) changes.push({ path: bookPath(id), content: encodeBook(book), book: { id, updatedAt: book.updatedAt } });
  }
  const after: RemoteState = { ...next, files: { ...next.files }, books: { ...next.books } };
  for (const id of out.removeBooks) {
    const path = bookPath(id);
    // Файла уже нет (убрали с другого устройства) — достаточно забыть о нём
    if (path in next.files) changes.push({ path, content: null });
    delete after.books[id];
  }
  for (const path of out.shared) changes.push({ path, content: sharedTexts[path] });

  if (changes.length) {
    const done = await client.commit({ head: next.head!, tree: next.tree! }, changes, COMMIT_MESSAGE);
    after.head = done.head;
    after.tree = done.tree;
    for (const c of changes) {
      if (c.content === null) delete after.files[c.path];
      else after.files[c.path] = await gitBlobSha(c.content);
      if (c.book) after.books[c.book.id] = c.book.updatedAt;
    }
  }
  if (changes.length || out.removeBooks.length) await setRemoteState(after);
  await setLastSyncAt(now());

  return { ...plan.report, pushed: changes.length, progressFrom: plan.putProgress.map((p) => p.bookId) };
}

/** Один проход синхронизации с репозиторием. Бросает `GitHubError` (или ошибку базы). */
export async function runSync(client: RepoClient, now: () => number = Date.now): Promise<SyncResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pass(client, now);
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'conflict' && attempt < ATTEMPTS) continue;
      throw e;
    }
  }
}
