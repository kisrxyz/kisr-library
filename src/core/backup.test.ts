import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupStamp,
  isBackup,
  needsBackupReminder,
  planMerge,
  type BackupBook,
  type BackupFile,
  type LibrarySnapshot,
} from './backup';
import { buildBook } from './book';
import type { ParsedBook } from './parse';
import { newProgress } from './progress';
import { DEFAULT_SETTINGS, type BookMeta, type Chapter, type Mark, type Progress, type Settings, type TaskState } from './types';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function parsedOf(title: string, chapters: string[]): ParsedBook {
  return {
    title,
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    chapters: chapters.map((name) => ({ title: name, md: `Текст главы «${name}» для счёта слов.` })),
    warnings: [],
  };
}

function backupBookOf(title: string, id: string, updatedAt = T0, chapterNames = ['Раз', 'Два']): BackupBook {
  const { meta, chapters } = buildBook(parsedOf(title, chapterNames), { origin: 'paste', id, now: T0 });
  const { chapters: _summaries, ...rest } = meta;
  void _summaries;
  return { ...rest, updatedAt, chapters: chapters.map((c) => ({ title: c.title, md: c.md })) };
}

function emptyCurrent(): LibrarySnapshot {
  return { books: [], progress: [], marks: [], tasks: [], settings: {} };
}

function fileOf(parts: Partial<BackupFile> = {}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: T0,
    app: 'kisr-library@test',
    books: [backupBookOf('Первая', 'pervaya-1'), backupBookOf('Вторая', 'vtoraya-2')],
    progress: [],
    marks: [],
    tasks: [],
    settings: {},
    ...parts,
  };
}

/** Применяет план к снимку так же, как это сделает importBackup в базе. */
function apply(current: LibrarySnapshot, plan: ReturnType<typeof planMerge>): LibrarySnapshot {
  const byId = <T,>(list: T[], key: (x: T) => string, puts: T[]): T[] => {
    const map = new Map(list.map((x) => [key(x), x]));
    for (const x of puts) map.set(key(x), x);
    return [...map.values()];
  };
  return {
    books: byId<BookMeta>(current.books, (b) => b.id, plan.putBooks.map((b) => b.meta)),
    progress: byId<Progress>(current.progress, (p) => p.bookId, plan.putProgress),
    marks: byId<Mark>(current.marks, (m) => m.id, plan.putMarks),
    tasks: byId<TaskState>(current.tasks, (t) => t.bookId, plan.putTasks),
    settings: { ...current.settings, ...plan.settings },
  };
}

function markOf(bookId: string, blockKey: string, updatedAt: number, note = ''): Mark {
  return { id: `${bookId}|${blockKey}`, bookId, chapter: 1, blockKey, text: 'абзац', highlight: true, note, createdAt: T0, updatedAt };
}

describe('isBackup', () => {
  it('узнаёт правильный файл', () => {
    expect(isBackup(fileOf())).toBe(true);
    expect(isBackup(JSON.parse(JSON.stringify(fileOf())))).toBe(true);
  });

  it('отвергает всё остальное', () => {
    expect(isBackup(null)).toBe(false);
    expect(isBackup(undefined)).toBe(false);
    expect(isBackup('kisr-library-backup')).toBe(false);
    expect(isBackup([])).toBe(false);
    expect(isBackup({})).toBe(false);
    expect(isBackup({ ...fileOf(), format: 'other' })).toBe(false);
    expect(isBackup({ ...fileOf(), version: 'один' })).toBe(false);
    expect(isBackup({ ...fileOf(), version: BACKUP_VERSION + 1 })).toBe(false);
    expect(isBackup({ ...fileOf(), books: 'нет' })).toBe(false);
    expect(isBackup({ ...fileOf(), progress: undefined })).toBe(false);
    expect(isBackup({ ...fileOf(), settings: null })).toBe(false);
    expect(isBackup({ ...fileOf(), books: [{ title: 'без id', chapters: [] }] })).toBe(false);
    expect(isBackup({ ...fileOf(), books: [{ id: 'x', title: 'без глав' }] })).toBe(false);
  });
});

describe('planMerge', () => {
  it('пустая библиотека и файл с 2 книгами — added 2', () => {
    const plan = planMerge(emptyCurrent(), fileOf());
    expect(plan.report).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(plan.putBooks.map((b) => b.meta.id)).toEqual(['pervaya-1', 'vtoraya-2']);
  });

  it('собирает записи книги: главы с id --NN, order и словами; meta.chapters — краткий список', () => {
    const { meta, chapters } = planMerge(emptyCurrent(), fileOf()).putBooks[0];
    expect(chapters.map((c: Chapter) => c.id)).toEqual(['pervaya-1--01', 'pervaya-1--02']);
    expect(chapters.map((c: Chapter) => c.order)).toEqual([1, 2]);
    expect(chapters.every((c: Chapter) => c.bookId === 'pervaya-1' && c.words > 0)).toBe(true);
    expect(meta.chapters).toEqual(chapters.map((c: Chapter) => ({ id: c.id, title: c.title, words: c.words })));
    expect(meta.words).toBe(chapters.reduce((s: number, c: Chapter) => s + c.words, 0));
    expect(meta.title).toBe('Первая');
    expect(meta.origin).toBe('paste');
  });

  it('Review Focus 5: повторное слияние того же файла — added 0, updated 0, skipped 2, putBooks пуст', () => {
    const file = fileOf({
      progress: [{ ...newProgress('pervaya-1', T0), lastReadAt: T0 + 10 }],
      marks: [markOf('pervaya-1', 'pabc', T0 + 3)],
      tasks: [{ bookId: 'pervaya-1', done: { t1: true } }],
      settings: { theme: 'dark', wpm: 200 },
    });
    const first = planMerge(emptyCurrent(), file);
    const after = apply(emptyCurrent(), first);
    const second = planMerge(after, file);
    expect(second.report).toEqual({ added: 0, updated: 0, skipped: 2 });
    expect(second.putBooks).toEqual([]);
    expect(second.putProgress).toEqual([]);
    expect(second.putMarks).toEqual([]);
    expect(second.putTasks).toEqual([]);
    expect(second.settings).toEqual({});
  });

  it('книга в файле с бо́льшим updatedAt обновляется', () => {
    const current = apply(emptyCurrent(), planMerge(emptyCurrent(), fileOf()));
    const file = fileOf({ books: [backupBookOf('Первая (правка)', 'pervaya-1', T0 + DAY), backupBookOf('Вторая', 'vtoraya-2')] });
    const plan = planMerge(current, file);
    expect(plan.report).toEqual({ added: 0, updated: 1, skipped: 1 });
    expect(plan.putBooks).toHaveLength(1);
    expect(plan.putBooks[0].meta.title).toBe('Первая (правка)');
  });

  it('книга у нас новее — пропускается', () => {
    const current = apply(emptyCurrent(), planMerge(emptyCurrent(), fileOf({ books: [backupBookOf('Свежая', 'a-1', T0 + 5 * DAY)] })));
    const plan = planMerge(current, fileOf({ books: [backupBookOf('Старая', 'a-1', T0)] }));
    expect(plan.report).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect(plan.putBooks).toEqual([]);
  });

  it('прогресс побеждает по lastReadAt', () => {
    const books = [backupBookOf('Первая', 'pervaya-1')];
    const ours: Progress = { ...newProgress('pervaya-1', T0), chapter: 2, lastReadAt: T0 + 100 };
    const current: LibrarySnapshot = { ...emptyCurrent(), books: [planMerge(emptyCurrent(), fileOf({ books })).putBooks[0].meta], progress: [ours] };

    const older = planMerge(current, fileOf({ books, progress: [{ ...ours, chapter: 1, lastReadAt: T0 + 50 }] }));
    expect(older.putProgress).toEqual([]);

    const newer = planMerge(current, fileOf({ books, progress: [{ ...ours, chapter: 1, lastReadAt: T0 + 200 }] }));
    expect(newer.putProgress).toHaveLength(1);
    expect(newer.putProgress[0].lastReadAt).toBe(T0 + 200);
    expect(newer.putProgress[0].chapter).toBe(1);
  });

  it('прогресс, которого у нас нет, добавляется', () => {
    const p = { ...newProgress('pervaya-1', T0), lastReadAt: T0 + 1 };
    expect(planMerge(emptyCurrent(), fileOf({ progress: [p] })).putProgress).toEqual([p]);
  });

  it('прогресс за пределами числа глав ограничивается', () => {
    const p: Progress = { ...newProgress('pervaya-1', T0), chapter: 9, maxChapter: 9, chaptersDone: [1, 9], lastReadAt: T0 + 1 };
    const [put] = planMerge(emptyCurrent(), fileOf({ progress: [p] })).putProgress;
    expect(put.chapter).toBe(2);
    expect(put.maxChapter).toBe(2);
    expect(put.chaptersDone).toEqual([1]);
  });

  describe('наш прогресс при замене книги более короткой версией', () => {
    const five = ['1', '2', '3', '4', '5'];
    const localBook = planMerge(emptyCurrent(), fileOf({ books: [backupBookOf('Длинная', 'dl-1', T0, five)] })).putBooks[0].meta;
    const aheadOfShort: Progress = {
      ...newProgress('dl-1', T0),
      chapter: 5,
      maxChapter: 5,
      chaptersDone: [1, 2, 3, 4],
      wordsRead: localBook.words - 1,
      lastReadAt: T0 + 100,
      blockKey: 'pabc',
      blockIndex: 4,
      blockOffset: 0.3,
    };
    const current: LibrarySnapshot = { ...emptyCurrent(), books: [localBook], progress: [aheadOfShort] };
    const shortNewer = backupBookOf('Длинная', 'dl-1', T0 + DAY, ['1', '2', '3']);

    it('прогресса нет в файле: наш прогресс ограничивается числом глав новой версии', () => {
      const plan = planMerge(current, fileOf({ books: [shortNewer] }));
      expect(plan.report).toEqual({ added: 0, updated: 1, skipped: 0 });
      expect(plan.putProgress).toHaveLength(1);
      const [p] = plan.putProgress;
      expect(p.bookId).toBe('dl-1');
      expect(p.chapter).toBe(3);
      expect(p.maxChapter).toBeLessThanOrEqual(3);
      expect(p.chaptersDone).toEqual([1, 2, 3]);
      expect(p.lastReadAt).toBe(T0 + 100);
      expect(p.blockKey).toBeNull();
    });

    it('прогресс есть в файле, но старше нашего: наш тоже ограничивается', () => {
      const older: Progress = { ...newProgress('dl-1', T0), chapter: 2, lastReadAt: T0 + 50 };
      const plan = planMerge(current, fileOf({ books: [shortNewer], progress: [older] }));
      expect(plan.putProgress).toHaveLength(1);
      expect(plan.putProgress[0].chapter).toBe(3);
      expect(plan.putProgress[0].lastReadAt).toBe(T0 + 100);
    });

    it('прогресс в файле новее нашего: побеждает файл, и он тоже в границах', () => {
      const newer: Progress = { ...newProgress('dl-1', T0), chapter: 9, maxChapter: 9, lastReadAt: T0 + 500 };
      const plan = planMerge(current, fileOf({ books: [shortNewer], progress: [newer] }));
      expect(plan.putProgress).toHaveLength(1);
      expect(plan.putProgress[0].lastReadAt).toBe(T0 + 500);
      expect(plan.putProgress[0].chapter).toBe(3);
    });

    it('наш прогресс в границах новой версии не трогается', () => {
      const inRange: Progress = { ...aheadOfShort, chapter: 2, maxChapter: 2, chaptersDone: [1], wordsRead: 0 };
      const plan = planMerge({ ...current, progress: [inRange] }, fileOf({ books: [shortNewer] }));
      expect(plan.putProgress).toEqual([]);
    });

    it('книга пропущена (наша новее): наш прогресс не трогается', () => {
      const ourNewer: BookMeta = { ...localBook, updatedAt: T0 + 5 * DAY };
      const plan = planMerge({ ...current, books: [ourNewer] }, fileOf({ books: [shortNewer] }));
      expect(plan.report).toEqual({ added: 0, updated: 0, skipped: 1 });
      expect(plan.putProgress).toEqual([]);
    });

    it('после применения плана повторное слияние ничего не меняет', () => {
      const file = fileOf({ books: [shortNewer] });
      const after = apply(current, planMerge(current, file));
      expect(after.progress[0].chapter).toBe(3);
      const again = planMerge(after, file);
      expect(again.report).toEqual({ added: 0, updated: 0, skipped: 1 });
      expect(again.putProgress).toEqual([]);
    });
  });

  it('отметки: побеждает новее updatedAt', () => {
    const ours = markOf('pervaya-1', 'pabc', T0 + 10, 'наша');
    const current: LibrarySnapshot = { ...emptyCurrent(), marks: [ours] };
    const plan = planMerge(
      current,
      fileOf({ marks: [markOf('pervaya-1', 'pabc', T0 + 5, 'старая'), markOf('pervaya-1', 'pnew', T0 + 1, 'новая отметка')] }),
    );
    expect(plan.putMarks.map((m) => m.id)).toEqual(['pervaya-1|pnew']);
    const newer = planMerge(current, fileOf({ marks: [markOf('pervaya-1', 'pabc', T0 + 20, 'свежая')] }));
    expect(newer.putMarks.map((m) => m.note)).toEqual(['свежая']);
  });

  it('задачи объединяются: галочки с обеих сторон', () => {
    const current: LibrarySnapshot = { ...emptyCurrent(), tasks: [{ bookId: 'a', done: { t1: true } }, { bookId: 'c', done: { t9: true } }] };
    const plan = planMerge(
      current,
      fileOf({ tasks: [{ bookId: 'a', done: { t1: true, t2: true } }, { bookId: 'b', done: { t3: true } }, { bookId: 'c', done: { t9: true } }] }),
    );
    expect(plan.putTasks).toEqual([
      { bookId: 'a', done: { t1: true, t2: true } },
      { bookId: 'b', done: { t3: true } },
    ]);
  });

  it('настройки берутся только там, где у нас пусто, и только известные ключи', () => {
    const current: LibrarySnapshot = { ...emptyCurrent(), settings: { theme: 'sepia' } };
    const incoming = { theme: 'dark', wpm: 220, fontSize: 20, мусор: 1, hyphens: 'да' } as unknown as Partial<Settings>;
    expect(planMerge(current, fileOf({ settings: incoming })).settings).toEqual({ wpm: 220, fontSize: 20 });
    expect(planMerge(emptyCurrent(), fileOf({ settings: { theme: 'dark' } })).settings).toEqual({ theme: 'dark' });
  });

  it('не меняет переданные снимок и файл', () => {
    const file = fileOf({ progress: [{ ...newProgress('pervaya-1', T0), chapter: 9 }] });
    const current = emptyCurrent();
    const fileBefore = structuredClone(file);
    planMerge(current, file);
    expect(file).toEqual(fileBefore);
    expect(current).toEqual(emptyCurrent());
  });
});

describe('needsBackupReminder', () => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  const NOW = T0 + 100 * DAY;

  it('0 книг — напоминать нечего', () => {
    expect(needsBackupReminder({ ...base, lastBackupAt: NOW - 90 * DAY }, 0, NOW)).toBe(false);
    expect(needsBackupReminder(base, 0, NOW)).toBe(false);
  });

  it('5 книг, копий не было — да', () => {
    expect(needsBackupReminder({ ...base, booksAtLastBackup: 0, lastBackupAt: null }, 5, NOW)).toBe(true);
  });

  it('3 книги, копий не было — да; 2 книги — нет', () => {
    expect(needsBackupReminder(base, 3, NOW)).toBe(true);
    expect(needsBackupReminder(base, 2, NOW)).toBe(false);
  });

  it('скрыто до завтра — нет, даже если условия выполнены', () => {
    expect(needsBackupReminder({ ...base, backupBannerHiddenUntil: NOW + DAY }, 5, NOW)).toBe(false);
  });

  it('срок скрытия вышел — снова да', () => {
    expect(needsBackupReminder({ ...base, backupBannerHiddenUntil: NOW - 1 }, 5, NOW)).toBe(true);
    expect(needsBackupReminder({ ...base, backupBannerHiddenUntil: NOW }, 5, NOW)).toBe(true);
  });

  it('после копии: +5 книг — да, +4 — нет', () => {
    const s: Settings = { ...base, lastBackupAt: NOW - DAY, booksAtLastBackup: 10 };
    expect(needsBackupReminder(s, 15, NOW)).toBe(true);
    expect(needsBackupReminder(s, 14, NOW)).toBe(false);
  });

  it('после копии: прошло 14 дней — да, 13 — нет', () => {
    expect(needsBackupReminder({ ...base, lastBackupAt: NOW - 14 * DAY, booksAtLastBackup: 4 }, 4, NOW)).toBe(true);
    expect(needsBackupReminder({ ...base, lastBackupAt: NOW - 13 * DAY, booksAtLastBackup: 4 }, 4, NOW)).toBe(false);
  });
});

describe('backupStamp', () => {
  const now = new Date(2026, 10, 20, 12).getTime();

  it('время копии из файла', () => {
    const exportedAt = new Date(2026, 10, 17, 12).getTime();
    expect(backupStamp(exportedAt, now)).toBe(exportedAt);
  });

  it('нет времени, мусор или не число — берём «сейчас», чтобы напоминание не ломалось', () => {
    for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '1700000000000', {}]) {
      expect(backupStamp(bad, now)).toBe(now);
    }
  });

  it('время из будущего не откладывает напоминание: берём «сейчас»', () => {
    expect(backupStamp(now + 5 * 24 * 3600 * 1000, now)).toBe(now);
  });
});
