/**
 * Перенос из старого приложения-артефакта (spec §13): выгрузка владельца + снимок базы → файл резервной
 * копии, который новое приложение умеет восстанавливать. Выполняется в Node (`npm run migrate`), в
 * приложение не попадает. Личные тексты сюда не копируются: функции читают их с диска владельца.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupBook, type BackupFile } from '../core/backup';
import { buildBook } from '../core/book';
import { chapterStartWords, percentOf } from '../core/progress';
import { DEFAULT_SETTINGS, type BookMeta, type Progress, type Settings } from '../core/types';

export interface OldBook {
  id: string;
  title: string;
  category: string;
  tags: string[];
  summary: string;
  source: string;
  created: string; // YYYY-MM-DD
  private: boolean;
  sections: { title: string; md: string }[];
}

/** Запись «где остановился» из старого приложения (`user-state.json → reading` или `r-*.json`). */
export interface OldRead {
  articleId: string;
  order: number;
  key?: string;
  max?: number;
  pin?: boolean;
  done?: boolean;
  doneAt?: number | null;
  act?: string;
  actDone?: boolean;
  at: number;
}

export interface OldSources {
  books: OldBook[];
  reads: OldRead[];
  prefs: { size?: number; mode?: string };
  dates: Record<string, { createdAt?: number; updatedAt?: number }>;
  /** Названия глав по `order` из снимка старой базы: нужны, чтобы найти главу, если в книге их порядок сдвинулся. */
  rawSectionTitles: Record<string, string[]>;
}

export interface MigrationSummary {
  books: number;
  chapters: number;
  words: number;
  progress: number;
}

// ---------------------------------------------------------------------------------------------
// Чтение выгрузки
// ---------------------------------------------------------------------------------------------

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finiteNumber = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Не удалось прочитать ${path}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

/** Все `*.json` папки (по имени, чтобы порядок не зависел от файловой системы); нет папки — пусто. */
function readJsonDir(dir: string): { name: string; data: unknown }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, data: readJson(join(dir, name)) }));
}

function toOldBook(x: unknown, index: number): OldBook {
  if (!isRecord(x) || typeof x.id !== 'string' || !x.id || typeof x.title !== 'string' || !Array.isArray(x.sections)) {
    throw new Error(`library.json: у книги №${index + 1} нет id, названия или глав`);
  }
  const sections = x.sections.map((s, j) => {
    if (!isRecord(s) || typeof s.title !== 'string' || typeof s.md !== 'string') {
      throw new Error(`library.json: у книги «${x.id}» глава №${j + 1} без названия или текста`);
    }
    return { title: s.title, md: s.md };
  });
  return {
    id: x.id,
    title: x.title,
    category: typeof x.category === 'string' ? x.category : '',
    tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === 'string') : [],
    summary: typeof x.summary === 'string' ? x.summary : '',
    source: typeof x.source === 'string' ? x.source : '',
    created: typeof x.created === 'string' ? x.created : '',
    private: x.private === true,
    sections,
  };
}

/** Запись о чтении; всё, что не похоже на неё (нет книги, главы или времени), отбрасывается. */
function toOldRead(x: unknown): OldRead | null {
  if (!isRecord(x) || typeof x.articleId !== 'string' || !x.articleId) return null;
  const order = finiteNumber(x.order);
  const at = finiteNumber(x.at);
  if (order === undefined || at === undefined) return null;
  const r: OldRead = { articleId: x.articleId, order, at };
  if (typeof x.key === 'string') r.key = x.key;
  const max = finiteNumber(x.max);
  if (max !== undefined) r.max = max;
  if (typeof x.pin === 'boolean') r.pin = x.pin;
  if (typeof x.done === 'boolean') r.done = x.done;
  if (x.doneAt === null || finiteNumber(x.doneAt) !== undefined) r.doneAt = x.doneAt as number | null;
  if (typeof x.act === 'string') r.act = x.act;
  if (typeof x.actDone === 'boolean') r.actDone = x.actDone;
  return r;
}

function toPrefs(x: unknown): OldSources['prefs'] {
  const prefs: OldSources['prefs'] = {};
  if (!isRecord(x)) return prefs;
  const size = finiteNumber(x.size);
  if (size !== undefined) prefs.size = size;
  if (typeof x.mode === 'string') prefs.mode = x.mode;
  return prefs;
}

/** По каждой книге побеждает запись с бо́льшим `at`; при равенстве остаётся запись из `a`. */
export function mergeReads(a: OldRead[], b: OldRead[]): OldRead[] {
  const best = new Map<string, OldRead>();
  for (const r of [...a, ...b]) {
    const cur = best.get(r.articleId);
    if (!cur || r.at > cur.at) best.set(r.articleId, r);
  }
  return [...best.values()];
}

/**
 * Читает выгрузку владельца с диска. `root` — корень репозитория: `kisr-library/data/*` (тексты и
 * состояние) и `migration/raw/*` (снимок базы: даты, названия глав, `r-*`). Если `migration/raw`
 * нет, берутся только `library.json` и `user-state.json`. Старые резервные копии `bk-*` не читаются.
 */
export function readOldSources(root: string): OldSources {
  const dataDir = join(root, 'kisr-library', 'data');
  const libraryPath = join(dataDir, 'library.json');
  if (!existsSync(libraryPath)) throw new Error(`Не найден ${libraryPath}`);
  const library = readJson(libraryPath);
  if (!Array.isArray(library)) throw new Error('library.json: ожидался список книг');
  const books = library.map(toOldBook);

  const statePath = join(dataDir, 'user-state.json');
  const state = existsSync(statePath) ? readJson(statePath) : {};
  const stateReads = (isRecord(state) && Array.isArray(state.reading) ? state.reading : []).map(toOldRead).filter((r) => r !== null);
  const statePrefs = toPrefs(isRecord(state) ? state.prefs : undefined);

  const dates: OldSources['dates'] = {};
  const titlesByOrder = new Map<string, { order: number; title: string }[]>();
  const rawReads: OldRead[] = [];
  let rawPrefs: OldSources['prefs'] = {};

  const rawDir = join(root, 'migration', 'raw');
  if (existsSync(rawDir)) {
    const me = join(rawDir, 'data', 'users', 'me');
    const addDates = (id: string, data: unknown) => {
      if (!isRecord(data)) return;
      const createdAt = finiteNumber(data.createdAt);
      const updatedAt = finiteNumber(data.updatedAt);
      if (createdAt === undefined && updatedAt === undefined) return;
      dates[id] = {};
      if (createdAt !== undefined) dates[id].createdAt = createdAt;
      if (updatedAt !== undefined) dates[id].updatedAt = updatedAt;
    };
    const addTitle = (data: unknown) => {
      if (!isRecord(data) || typeof data.articleId !== 'string' || typeof data.title !== 'string') return;
      const order = finiteNumber(data.order);
      if (order === undefined) return;
      const list = titlesByOrder.get(data.articleId) ?? [];
      list.push({ order, title: data.title });
      titlesByOrder.set(data.articleId, list);
    };

    // Публичные книги: у статьи `id` — имя файла (в самом файле его нет); личные — `pa-<id>` и `ps-<id>--NN`.
    for (const { name, data } of readJsonDir(join(rawDir, 'articles'))) addDates(name.slice(0, -'.json'.length), data);
    for (const { data } of readJsonDir(join(rawDir, 'sections'))) addTitle(data);
    for (const { name, data } of readJsonDir(me)) {
      if (name.startsWith('pa-')) addDates(name.slice('pa-'.length, -'.json'.length), data);
      else if (name.startsWith('ps-')) addTitle(data);
      else if (name.startsWith('r-')) {
        const r = toOldRead(data);
        if (r) rawReads.push(r);
      } else if (name === 'prefs.json') rawPrefs = toPrefs(data);
      // bk-* — старые резервные копии, не переносим
    }
  }

  const rawSectionTitles: OldSources['rawSectionTitles'] = {};
  for (const [id, list] of titlesByOrder) rawSectionTitles[id] = list.sort((x, y) => x.order - y.order).map((s) => s.title);

  return {
    books,
    reads: mergeReads(stateReads, rawReads),
    prefs: { ...rawPrefs, ...statePrefs },
    dates,
    rawSectionTitles,
  };
}

// ---------------------------------------------------------------------------------------------
// Преобразование в файл копии
// ---------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` → локальная полночь; не дата → `undefined`. */
function parseCreated(created: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(created.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : undefined;
}

/**
 * Номер главы (с 1) в очищенной книге по номеру `order` из старого приложения. Если глава `order` в снимке
 * старой базы называется иначе, чем в книге (очистка убрала пустые «Часть …»), берётся глава с тем же
 * названием, ближайшая к `order`. Не нашлась — `order`, ограниченный числом глав.
 */
function chapterByOrder(book: OldBook, order: number, rawTitles: string[] | undefined): number {
  const n = Math.max(1, Math.trunc(order));
  const rawTitle = rawTitles?.[n - 1]?.trim();
  if (rawTitle !== undefined && book.sections[n - 1]?.title.trim() !== rawTitle) {
    let best = -1;
    book.sections.forEach((s, i) => {
      if (s.title.trim() === rawTitle && (best < 0 || Math.abs(i + 1 - n) < Math.abs(best + 1 - n))) best = i;
    });
    if (best >= 0) return best + 1;
  }
  return Math.min(n, Math.max(1, book.sections.length));
}

function progressOf(meta: BookMeta, book: OldBook, read: OldRead, rawTitles: string[] | undefined): Progress {
  const chapter = chapterByOrder(book, read.order, rawTitles);
  const maxChapter = Math.max(chapter, chapterByOrder(book, read.max ?? read.order, rawTitles));
  const finished = read.done === true;
  // Дочитанная книга: 100 %, как в `clampProgress`; иначе — слова глав до текущей (spec §13).
  const wordsRead = finished ? meta.words : chapterStartWords(meta, chapter);
  const progress: Progress = {
    bookId: meta.id,
    chapter,
    blockKey: read.key ? read.key : null,
    blockIndex: 0,
    blockOffset: 0,
    maxChapter,
    chaptersDone: [],
    wordsRead,
    percent: finished ? 100 : percentOf(meta, wordsRead),
    status: finished ? 'finished' : 'reading',
    startedAt: read.at,
    lastReadAt: read.at,
    readingMs: 0,
  };
  if (finished) progress.finishedAt = read.doneAt ?? read.at;
  return progress;
}

function settingsOf(prefs: OldSources['prefs']): Partial<Settings> {
  const size = prefs.size;
  return {
    theme: prefs.mode === 'light' || prefs.mode === 'dark' ? prefs.mode : DEFAULT_SETTINGS.theme,
    fontSize: size !== undefined && size >= 15 && size <= 24 ? size : DEFAULT_SETTINGS.fontSize,
  };
}

/**
 * Старая библиотека → файл резервной копии (spec §13). Тексты — из `books`, прогресс — `reads`
 * (по книге побеждает бо́льший `at`), даты — из `dates`, иначе из `created`. Слова, карточки, задачи
 * и хеш считает `buildBook`, поэтому они совпадают с теми, что получились бы при обычном добавлении.
 * Флага `private` в модели данных нет, он не переносится.
 */
export function convertOld(src: OldSources, now: number): { backup: BackupFile; summary: MigrationSummary } {
  const books: BackupBook[] = [];
  const progress: Progress[] = [];
  const reads = new Map(mergeReads(src.reads, []).map((r) => [r.articleId, r]));
  let chapters = 0;
  let words = 0;

  for (const old of src.books) {
    const dates = src.dates[old.id];
    const createdAt = dates?.createdAt ?? parseCreated(old.created) ?? now;
    const { meta, chapters: built } = buildBook(
      {
        title: old.title,
        category: old.category,
        tags: old.tags,
        summary: old.summary,
        source: old.source,
        chapters: old.sections.map((s) => ({ title: s.title, md: s.md })),
        warnings: [],
      },
      { origin: 'migration', id: old.id, now, createdAt },
    );
    meta.updatedAt = dates?.updatedAt ?? createdAt;

    const read = reads.get(old.id);
    if (read) {
      progress.push(progressOf(meta, old, read, src.rawSectionTitles[old.id]));
      if (read.pin === true) meta.favorite = true;
      const act = read.act?.trim();
      if (act) meta.action = { text: act, done: read.actDone === true };
    }

    const { chapters: _summaries, ...rest } = meta;
    void _summaries;
    books.push({ ...rest, chapters: built.map((c) => ({ title: c.title, md: c.md })) });
    chapters += built.length;
    words += meta.words;
  }

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    app: 'kisr-library@migration',
    books,
    progress,
    marks: [],
    tasks: [],
    settings: settingsOf(src.prefs),
  };
  return { backup, summary: { books: books.length, chapters, words, progress: progress.length } };
}

/** Главы без текста (их номера с 1): после переноса таких быть не должно. */
export function findEmptyChapters(backup: BackupFile): { bookId: string; chapter: number }[] {
  const empty: { bookId: string; chapter: number }[] = [];
  for (const b of backup.books) {
    b.chapters.forEach((c, i) => {
      if (!c.md.trim()) empty.push({ bookId: b.id, chapter: i + 1 });
    });
  }
  return empty;
}
