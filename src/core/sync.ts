/**
 * Синхронизация между устройствами (spec §18): формат файлов в репозитории, канонический JSON,
 * git blob sha, правила слияния и что отправлять. Чистая логика, без сети и IndexedDB.
 */
import { isOutOfRange, toStored, type BackupBook } from './backup';
import { clampProgress } from './progress';
import { hash, slug } from './text';
import type { BookMeta, Chapter, Mark, Progress, TaskState } from './types';

/** Метки удаления: `book:<id>` или `mark:<id>` → когда удалили. */
export type Tombstones = Record<string, number>;

export const bookTomb = (id: string): string => `book:${id}`;
export const markTomb = (id: string): string => `mark:${id}`;

export const SHARED_FILES = ['progress.json', 'marks.json', 'tasks.json', 'deleted.json'] as const;
export type SharedPath = (typeof SHARED_FILES)[number];

const FORMAT_VERSION = 1;
const BOOK_FORMAT = 'kisr-library-book';
const SHARED_FORMAT: Record<SharedPath, string> = {
  'progress.json': 'kisr-library-progress',
  'marks.json': 'kisr-library-marks',
  'tasks.json': 'kisr-library-tasks',
  'deleted.json': 'kisr-library-deleted',
};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * JSON с ключами объектов по алфавиту на всех уровнях. Одинаковые данные на разных устройствах дают
 * одинаковые байты, а значит, одинаковый sha: устройства не перезаписывают друг друга по кругу.
 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) =>
    isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value,
  );
}

/** sha блоба, как его считает git: SHA-1 от `"blob <длина в байтах>\0" + содержимое`, hex. */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head, 0);
  all.set(body, head.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const BOOK_PATH = /^books\/[^/]+\.json$/;

/** Файл книги в репозитории. У книг приложения id из `[a-z0-9-]`, он и есть имя файла. */
export function bookPath(id: string): string {
  return `books/${SAFE_ID.test(id) ? id : `${slug(id, 40)}-${hash(id)}`}.json`;
}

export function isBookPath(path: string): boolean {
  return BOOK_PATH.test(path);
}

export function encodeBook(book: BackupBook): string {
  return canonicalJson({ format: BOOK_FORMAT, version: FORMAT_VERSION, book });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isBackupBook(x: unknown): x is BackupBook {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    typeof x.title === 'string' &&
    typeof x.updatedAt === 'number' &&
    Array.isArray(x.chapters) &&
    x.chapters.every((c) => isRecord(c) && typeof c.title === 'string' && typeof c.md === 'string')
  );
}

/** Файл книги из репозитория; мусор, чужой формат или версия новее нашей — `null`. */
export function decodeBook(text: string): BackupBook | null {
  const data = parseJson(text);
  if (!isRecord(data) || data.format !== BOOK_FORMAT || data.version !== FORMAT_VERSION) return null;
  return isBackupBook(data.book) ? data.book : null;
}

/** Места чтения, отметки, галочки и метки удаления — то, что лежит в общих файлах. */
export interface SharedState {
  progress: Progress[];
  marks: Mark[];
  tasks: TaskState[];
  deleted: Tombstones;
}

const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** Тексты общих файлов: массивы по ключу записи, всё канонически. */
export function encodeShared(s: SharedState): Record<SharedPath, string> {
  const file = (path: SharedPath, items: unknown) => canonicalJson({ format: SHARED_FORMAT[path], version: FORMAT_VERSION, items });
  return {
    'progress.json': file('progress.json', [...s.progress].sort(byKey((p) => p.bookId))),
    'marks.json': file('marks.json', [...s.marks].sort(byKey((m) => m.id))),
    'tasks.json': file('tasks.json', [...s.tasks].sort(byKey((t) => t.bookId))),
    'deleted.json': file('deleted.json', s.deleted),
  };
}

const everyRecord = (list: unknown[], check: (r: Record<string, unknown>) => boolean) => list.every((r) => isRecord(r) && check(r));

/** Общий файл из репозитория; мусор или не тот формат — `null`. */
export function decodeShared(path: SharedPath, text: string): Partial<SharedState> | null {
  const data = parseJson(text);
  if (!isRecord(data) || data.format !== SHARED_FORMAT[path] || data.version !== FORMAT_VERSION) return null;
  const items = data.items;
  if (path === 'deleted.json') {
    return isRecord(items) && Object.values(items).every((v) => typeof v === 'number') ? { deleted: items as Tombstones } : null;
  }
  if (!Array.isArray(items)) return null;
  if (path === 'progress.json') {
    return everyRecord(items, (p) => typeof p.bookId === 'string' && typeof p.lastReadAt === 'number') ? { progress: items as Progress[] } : null;
  }
  if (path === 'marks.json') {
    return everyRecord(items, (m) => typeof m.id === 'string' && typeof m.bookId === 'string' && typeof m.updatedAt === 'number')
      ? { marks: items as Mark[] }
      : null;
  }
  return everyRecord(items, (t) => typeof t.bookId === 'string' && isRecord(t.done)) ? { tasks: items as TaskState[] } : null;
}

/** Всё, что синхронизация читает из базы устройства. */
export interface SyncSnapshot extends SharedState {
  books: BookMeta[];
}

/** Что пришло из репозитория за этот проход: только изменившиеся файлы. */
export interface Incoming {
  books: BackupBook[];
  progress?: Progress[];
  marks?: Mark[];
  tasks?: TaskState[];
  deleted?: Tombstones;
}

export interface SyncPlan {
  putBooks: { meta: BookMeta; chapters: Chapter[] }[];
  /** Книги, которые удалить вместе с главами, прогрессом, отметками и галочками. */
  deleteBooks: string[];
  putProgress: Progress[];
  putMarks: Mark[];
  deleteMarks: string[];
  putTasks: TaskState[];
  /** Новые и более поздние метки удаления. */
  putDeleted: Tombstones;
  report: { added: number; updated: number; removed: number };
}

/**
 * Побеждает ли входящая запись нашу: новее по времени, а при равном времени — по каноническому тексту.
 * Так при равных штампах оба устройства выбирают одну и ту же запись.
 */
function wins<T>(incoming: T, ours: T, stamp: (x: T) => number): boolean {
  const a = stamp(incoming);
  const b = stamp(ours);
  if (a !== b) return a > b;
  const ta = canonicalJson(incoming);
  const tb = canonicalJson(ours);
  return ta !== tb && ta > tb;
}

function sameDone(a: TaskState['done'], b: TaskState['done']): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k]);
}

/** Галочки: запись целиком по `updatedAt`; если штампа нет хотя бы у одной стороны — объединение. */
function mergeTasks(ours: TaskState | undefined, incoming: TaskState): TaskState | null {
  if (!ours) return incoming;
  if (incoming.updatedAt !== undefined && ours.updatedAt !== undefined) {
    return wins(incoming, ours, (t) => t.updatedAt ?? 0) ? incoming : null;
  }
  const done = { ...ours.done, ...incoming.done };
  const stamps = [ours.updatedAt, incoming.updatedAt].filter((n): n is number => n !== undefined);
  if (sameDone(done, ours.done) && stamps.length === 0) return null;
  // Объединение — новая запись: штамп новее обеих, иначе устройство со штампом её не возьмёт
  return stamps.length ? { bookId: incoming.bookId, done, updatedAt: Math.max(...stamps) + 1 } : { bookId: incoming.bookId, done };
}

/**
 * Слияние входящего с базой устройства (spec §18.3). Ничего не записывает — только говорит, что записать.
 * Повторное слияние тех же данных даёт пустой план.
 */
export function planSync(local: SyncSnapshot, incoming: Incoming): SyncPlan {
  const deleted: Tombstones = { ...local.deleted };
  const putDeleted: Tombstones = {};
  for (const [key, at] of Object.entries(incoming.deleted ?? {})) {
    if (typeof at !== 'number') continue;
    if (deleted[key] === undefined || at > deleted[key]) {
      deleted[key] = at;
      putDeleted[key] = at;
    }
  }
  /** Метка удаления не раньше времени записи — запись удалена. */
  const killed = (key: string, at: number) => deleted[key] !== undefined && deleted[key] >= at;

  const report = { added: 0, updated: 0, removed: 0 };
  const books = new Map(local.books.map((b) => [b.id, b]));
  const putBooks: SyncPlan['putBooks'] = [];
  for (const book of incoming.books) {
    if (killed(bookTomb(book.id), book.updatedAt)) continue;
    const ours = books.get(book.id);
    if (ours && book.updatedAt <= ours.updatedAt) continue;
    report[ours ? 'updated' : 'added']++;
    const stored = toStored(book);
    putBooks.push(stored);
    books.set(book.id, stored.meta);
  }

  const deleteBooks: string[] = [];
  for (const b of local.books) {
    if (books.get(b.id) !== b || !killed(bookTomb(b.id), b.updatedAt)) continue;
    deleteBooks.push(b.id);
    books.delete(b.id);
    report.removed++;
  }
  /** Книга удалена: есть метка, а самой книги (правленной позже) нет. */
  const gone = (bookId: string) => deleted[bookTomb(bookId)] !== undefined && !books.has(bookId);

  const ourProgress = new Map(local.progress.map((p) => [p.bookId, p]));
  const progressPuts = new Map<string, Progress>();
  for (const p of incoming.progress ?? []) {
    if (gone(p.bookId)) continue;
    const best = progressPuts.get(p.bookId) ?? ourProgress.get(p.bookId);
    if (best && !wins(p, best, (x) => x.lastReadAt)) continue;
    const meta = books.get(p.bookId);
    progressPuts.set(p.bookId, meta && isOutOfRange(p, meta) ? clampProgress(p, meta) : p);
  }
  // Книга заменена версией покороче, а наш прогресс уцелел: приводим его к новой книге
  for (const { meta } of putBooks) {
    const survivor = progressPuts.get(meta.id) ?? ourProgress.get(meta.id);
    if (survivor && isOutOfRange(survivor, meta)) progressPuts.set(meta.id, clampProgress(survivor, meta));
  }

  const ourMarks = new Map(local.marks.map((m) => [m.id, m]));
  const putMarks: Mark[] = [];
  for (const m of incoming.marks ?? []) {
    if (gone(m.bookId) || killed(markTomb(m.id), m.updatedAt)) continue;
    const ours = ourMarks.get(m.id);
    if (ours && !wins(m, ours, (x) => x.updatedAt)) continue;
    putMarks.push(m);
    ourMarks.set(m.id, m);
  }
  const deleteMarks = local.marks.filter((m) => ourMarks.get(m.id) === m && killed(markTomb(m.id), m.updatedAt)).map((m) => m.id);

  const ourTasks = new Map(local.tasks.map((t) => [t.bookId, t]));
  const putTasks: TaskState[] = [];
  for (const t of incoming.tasks ?? []) {
    if (gone(t.bookId)) continue;
    const next = mergeTasks(ourTasks.get(t.bookId), t);
    if (!next) continue;
    putTasks.push(next);
    ourTasks.set(t.bookId, next);
  }

  return { putBooks, deleteBooks, putProgress: [...progressPuts.values()], putMarks, deleteMarks, putTasks, putDeleted, report };
}

/** Что устройство знает о репозитории на коммите `head`. */
export interface RemoteState {
  head: string | null;
  tree: string | null;
  /** Путь → sha блоба. */
  files: Record<string, string>;
  /** id книги → `updatedAt` её версии в репозитории. */
  books: Record<string, number>;
}

export const EMPTY_REMOTE: RemoteState = { head: null, tree: null, files: {}, books: {} };

/** Общее состояние устройства для отправки: без записей удалённых книг. */
export function sharedOf(s: SyncSnapshot): SharedState {
  const have = new Set(s.books.map((b) => b.id));
  const alive = (bookId: string) => have.has(bookId) || s.deleted[bookTomb(bookId)] === undefined;
  return {
    progress: s.progress.filter((p) => alive(p.bookId)),
    marks: s.marks.filter((m) => alive(m.bookId)),
    tasks: s.tasks.filter((t) => alive(t.bookId)),
    deleted: s.deleted,
  };
}

/**
 * Что отправить: книги, которых в репозитории нет или где мы новее; файлы удалённых книг убрать;
 * общие файлы — если sha их текста отличается от того, что лежит в репозитории.
 */
export function planPush(
  local: SyncSnapshot,
  remote: RemoteState,
  sharedShas: Record<SharedPath, string>,
): { books: string[]; removeBooks: string[]; shared: SharedPath[] } {
  const books = local.books.filter((b) => remote.books[b.id] === undefined || b.updatedAt > remote.books[b.id]).map((b) => b.id);
  const have = new Set(local.books.map((b) => b.id));
  const removeBooks = Object.keys(remote.books).filter((id) => !have.has(id) && local.deleted[bookTomb(id)] !== undefined);
  const shared = SHARED_FILES.filter((p) => remote.files[p] !== sharedShas[p]);
  return { books, removeBooks, shared };
}
