/**
 * Синхронизация на стороне базы (spec §18.2): настройка и состояние в хранилище `sync`, метки удаления,
 * снимок для отправки и слияние входящего одной транзакцией. Хранилище `sync` в резервную копию не входит.
 */
import { toBackupBook, type BackupBook } from '../core/backup';
import { EMPTY_REMOTE, planSync, type Incoming, type RemoteState, type SyncPlan, type SyncSnapshot, type Tombstones } from '../core/sync';
import { removeBook, writeBook, type BookStores } from './books';
import { openDb, type Tombstone } from './schema';

export interface SyncConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

const CONFIG = 'config';
const REMOTE = 'remote';
const STATUS = 'status';

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

async function getRow(key: string): Promise<unknown> {
  return (await (await openDb()).get('sync', key))?.value;
}

async function putRow(key: string, value: unknown): Promise<void> {
  await (await openDb()).put('sync', { key, value });
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const v = await getRow(CONFIG);
  return isRecord(v) && ['token', 'owner', 'repo', 'branch'].every((k) => typeof v[k] === 'string') ? (v as unknown as SyncConfig) : null;
}

export async function setSyncConfig(c: SyncConfig): Promise<void> {
  await putRow(CONFIG, { token: c.token, owner: c.owner, repo: c.repo, branch: c.branch });
}

/** Отключить синхронизацию на устройстве: ключ, знание о репозитории и время — прочь; метки удаления остаются. */
export async function clearSync(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('sync', 'readwrite');
  await Promise.all([tx.store.delete(CONFIG), tx.store.delete(REMOTE), tx.store.delete(STATUS), tx.done]);
}

function toRemote(v: unknown): RemoteState {
  if (!isRecord(v) || !isRecord(v.files) || !isRecord(v.books)) return { ...EMPTY_REMOTE, files: {}, books: {} };
  return {
    head: typeof v.head === 'string' ? v.head : null,
    tree: typeof v.tree === 'string' ? v.tree : null,
    files: v.files as Record<string, string>,
    books: v.books as Record<string, number>,
  };
}

export async function getRemoteState(): Promise<RemoteState> {
  return toRemote(await getRow(REMOTE));
}

export async function setRemoteState(r: RemoteState): Promise<void> {
  await putRow(REMOTE, r);
}

export async function getLastSyncAt(): Promise<number | null> {
  const v = await getRow(STATUS);
  return isRecord(v) && typeof v.lastSyncAt === 'number' ? v.lastSyncAt : null;
}

export async function setLastSyncAt(at: number): Promise<void> {
  await putRow(STATUS, { lastSyncAt: at });
}

const tombstones = (rows: Tombstone[]): Tombstones => Object.fromEntries(rows.map((r) => [r.key, r.at]));

/** Всё, что нужно синхронизации, одним согласованным снимком. */
export async function readSyncSnapshot(): Promise<SyncSnapshot> {
  const db = await openDb();
  const tx = db.transaction(['books', 'progress', 'marks', 'tasks', 'deleted'], 'readonly');
  const [books, progress, marks, tasks, deleted] = await Promise.all([
    tx.objectStore('books').getAll(),
    tx.objectStore('progress').getAll(),
    tx.objectStore('marks').getAll(),
    tx.objectStore('tasks').getAll(),
    tx.objectStore('deleted').getAll(),
    tx.done,
  ]);
  return { books, progress, marks, tasks, deleted: tombstones(deleted) };
}

/** Книга целиком, как в резервной копии; нет такой — `null`. */
export async function readBookForUpload(id: string): Promise<BackupBook | null> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters'], 'readonly');
  const [meta, chapters] = await Promise.all([
    tx.objectStore('books').get(id),
    tx.objectStore('chapters').index('bookId').getAll(id),
    tx.done,
  ]);
  return meta ? toBackupBook(meta, chapters) : null;
}

/**
 * Слияние входящего с базой (spec §18.3–18.4): чтение, план и запись — одной транзакцией вместе с новым
 * `remote`. Правка, сделанная во время синхронизации, встаёт в очередь после неё и не затирается.
 * Об изменениях не уведомляет: это не правка на устройстве, отправлять обратно нечего.
 */
export async function applyIncoming(incoming: Incoming, remote: RemoteState): Promise<SyncPlan> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters', 'progress', 'marks', 'tasks', 'deleted', 'sync'], 'readwrite');
  try {
    const stores: BookStores = {
      books: tx.objectStore('books'),
      chapters: tx.objectStore('chapters'),
      progress: tx.objectStore('progress'),
      marks: tx.objectStore('marks'),
      tasks: tx.objectStore('tasks'),
    };
    const deletedStore = tx.objectStore('deleted');
    const [books, progress, marks, tasks, deleted] = await Promise.all([
      stores.books.getAll(),
      stores.progress.getAll(),
      stores.marks.getAll(),
      stores.tasks.getAll(),
      deletedStore.getAll(),
    ]);
    const plan = planSync({ books, progress, marks, tasks, deleted: tombstones(deleted) }, incoming);

    for (const { meta, chapters } of plan.putBooks) await writeBook(stores, meta, chapters);
    for (const id of plan.deleteBooks) await removeBook(stores, id);
    await Promise.all([
      ...plan.putProgress.map((p) => stores.progress.put(p)),
      ...plan.putMarks.map((m) => stores.marks.put(m)),
      ...plan.deleteMarks.map((id) => stores.marks.delete(id)),
      ...plan.putTasks.map((t) => stores.tasks.put(t)),
      ...Object.entries(plan.putDeleted).map(([key, at]) => deletedStore.put({ key, at })),
      tx.objectStore('sync').put({ key: REMOTE, value: remote }),
    ]);
    await tx.done;
    return plan;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // транзакция уже завершена
    }
    await tx.done.catch(() => {});
    throw e;
  }
}
