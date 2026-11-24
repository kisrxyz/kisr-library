import { describe, expect, it } from 'vitest';
import type { BackupBook } from './backup';
import { buildBook } from './book';
import type { ParsedBook } from './parse';
import { newProgress } from './progress';
import {
  EMPTY_REMOTE,
  bookPath,
  bookTomb,
  canonicalJson,
  decodeBook,
  decodeShared,
  encodeBook,
  encodeShared,
  gitBlobSha,
  isBookPath,
  markTomb,
  planPush,
  planSync,
  sharedOf,
  type Incoming,
  type RemoteState,
  type SharedPath,
  type SyncSnapshot,
} from './sync';
import type { BookMeta, Mark, Progress, TaskState } from './types';

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

function bookOf(id: string, updatedAt = T0, chapterNames = ['Раз', 'Два']): { meta: BookMeta; backup: BackupBook } {
  const { meta, chapters } = buildBook(parsedOf(`Книга ${id}`, chapterNames), { origin: 'paste', id, now: T0 });
  const stamped = { ...meta, updatedAt };
  const { chapters: _summaries, ...rest } = stamped;
  void _summaries;
  return { meta: stamped, backup: { ...rest, chapters: chapters.map((c) => ({ title: c.title, md: c.md })) } };
}

function markOf(bookId: string, key: string, updatedAt = T0): Mark {
  return { id: `${bookId}|${key}`, bookId, chapter: 1, blockKey: key, text: 'абзац', highlight: true, note: '', createdAt: T0, updatedAt };
}

function progressOf(bookId: string, lastReadAt: number, chapter = 1): Progress {
  return { ...newProgress(bookId, T0), chapter, maxChapter: chapter, lastReadAt };
}

function snapshot(part: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return { books: [], progress: [], marks: [], tasks: [], deleted: {}, ...part };
}

describe('canonicalJson', () => {
  it('сортирует ключи на всех уровнях, массивы не трогает', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it('выкидывает undefined, как JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 'я' })).toBe('{"b":null,"c":"я"}');
  });
});

describe('gitBlobSha', () => {
  it('совпадает с git hash-object', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('привет\n')).toBe('d0f56e135b2282bfdd87b1cae5d0238b6a193ab5');
  });
});

describe('bookPath', () => {
  it('id из [a-z0-9-] — имя файла как есть', () => {
    expect(bookPath('kak-rodilos-mwkko04g')).toBe('books/kak-rodilos-mwkko04g.json');
    expect(isBookPath('books/kak-rodilos-mwkko04g.json')).toBe(true);
  });

  it('прочие id — безопасное имя, разное для разных id', () => {
    const a = bookPath('Книга/1');
    const b = bookPath('Книга/2');
    expect(a).toMatch(/^books\/[a-z0-9-]+\.json$/);
    expect(b).toMatch(/^books\/[a-z0-9-]+\.json$/);
    expect(a).not.toBe(b);
  });

  it('не путает с общими файлами', () => {
    expect(isBookPath('progress.json')).toBe(false);
    expect(isBookPath('README.md')).toBe(false);
    expect(isBookPath('books/x.txt')).toBe(false);
  });
});

describe('encodeBook / decodeBook', () => {
  it('туда и обратно', () => {
    const { backup } = bookOf('a');
    expect(decodeBook(encodeBook(backup))).toEqual(backup);
  });

  it('мусор и чужой формат — null', () => {
    expect(decodeBook('не json')).toBeNull();
    expect(decodeBook('{"format":"other","version":1,"book":{}}')).toBeNull();
    expect(decodeBook('{"format":"kisr-library-book","version":1,"book":{"id":1}}')).toBeNull();
    expect(decodeBook('{"format":"kisr-library-book","version":99,"book":{"id":"a","chapters":[]}}')).toBeNull();
  });
});

describe('encodeShared / decodeShared', () => {
  it('одинаковый текст при разном порядке записей', () => {
    const a = encodeShared({
      progress: [progressOf('b', 2), progressOf('a', 1)],
      marks: [markOf('a', 'k2'), markOf('a', 'k1')],
      tasks: [{ bookId: 'b', done: {} }, { bookId: 'a', done: { t1: true } }],
      deleted: { 'book:z': 5, 'book:y': 4 },
    });
    const b = encodeShared({
      progress: [progressOf('a', 1), progressOf('b', 2)],
      marks: [markOf('a', 'k1'), markOf('a', 'k2')],
      tasks: [{ bookId: 'a', done: { t1: true } }, { bookId: 'b', done: {} }],
      deleted: { 'book:y': 4, 'book:z': 5 },
    });
    expect(a).toEqual(b);
    expect(Object.keys(a).sort()).toEqual(['deleted.json', 'marks.json', 'progress.json', 'tasks.json']);
  });

  it('туда и обратно, мусор — null', () => {
    const state = { progress: [progressOf('a', 1)], marks: [markOf('a', 'k')], tasks: [{ bookId: 'a', done: { t: true as const } }], deleted: { 'mark:x': 3 } };
    const files = encodeShared(state);
    expect(decodeShared('progress.json', files['progress.json'])).toEqual({ progress: state.progress });
    expect(decodeShared('marks.json', files['marks.json'])).toEqual({ marks: state.marks });
    expect(decodeShared('tasks.json', files['tasks.json'])).toEqual({ tasks: state.tasks });
    expect(decodeShared('deleted.json', files['deleted.json'])).toEqual({ deleted: state.deleted });
    expect(decodeShared('progress.json', 'мусор')).toBeNull();
    expect(decodeShared('progress.json', files['marks.json'])).toBeNull();
  });
});

describe('planSync: книги', () => {
  it('новая книга добавляется', () => {
    const { backup } = bookOf('a');
    const plan = planSync(snapshot(), { books: [backup] });
    expect(plan.putBooks.map((b) => b.meta.id)).toEqual(['a']);
    expect(plan.putBooks[0].chapters).toHaveLength(2);
    expect(plan.report).toEqual({ added: 1, updated: 0, removed: 0 });
  });

  it('более новая заменяет, такая же и старая пропускаются', () => {
    const ours = bookOf('a', T0 + 10).meta;
    expect(planSync(snapshot({ books: [ours] }), { books: [bookOf('a', T0 + 20).backup] }).report.updated).toBe(1);
    expect(planSync(snapshot({ books: [ours] }), { books: [bookOf('a', T0 + 10).backup] }).putBooks).toEqual([]);
    expect(planSync(snapshot({ books: [ours] }), { books: [bookOf('a', T0 + 5).backup] }).putBooks).toEqual([]);
  });

  it('метка удаления не раньше updatedAt удаляет нашу книгу и не пускает входящую', () => {
    const ours = bookOf('a', T0).meta;
    const plan = planSync(snapshot({ books: [ours] }), { books: [bookOf('b', T0).backup], deleted: { [bookTomb('a')]: T0, [bookTomb('b')]: T0 + 1 } });
    expect(plan.deleteBooks).toEqual(['a']);
    expect(plan.putBooks).toEqual([]);
    expect(plan.report.removed).toBe(1);
  });

  it('книга, правленная после удаления, остаётся', () => {
    const ours = bookOf('a', T0 + 10).meta;
    const plan = planSync(snapshot({ books: [ours] }), { books: [bookOf('b', T0 + 10).backup], deleted: { [bookTomb('a')]: T0, [bookTomb('b')]: T0 } });
    expect(plan.deleteBooks).toEqual([]);
    expect(plan.putBooks.map((b) => b.meta.id)).toEqual(['b']);
  });

  it('своя метка удаления тоже действует (книга вернулась из репозитория)', () => {
    const plan = planSync(snapshot({ deleted: { [bookTomb('a')]: T0 + 1 } }), { books: [bookOf('a', T0).backup] });
    expect(plan.putBooks).toEqual([]);
  });
});

describe('planSync: место чтения', () => {
  it('побеждает более новое lastReadAt', () => {
    const book = bookOf('a').meta;
    const ours = progressOf('a', T0 + 10);
    expect(planSync(snapshot({ books: [book], progress: [ours] }), { books: [], progress: [progressOf('a', T0 + 20, 2)] }).putProgress.map((p) => p.chapter)).toEqual([2]);
    expect(planSync(snapshot({ books: [book], progress: [ours] }), { books: [], progress: [progressOf('a', T0 + 5, 2)] }).putProgress).toEqual([]);
  });

  it('ограничивается главами книги', () => {
    const book = bookOf('a', T0, ['Раз']).meta;
    const plan = planSync(snapshot({ books: [book] }), { books: [], progress: [progressOf('a', T0 + 20, 5)] });
    expect(plan.putProgress[0].chapter).toBe(1);
  });

  it('прогресс удалённой книги отбрасывается', () => {
    const plan = planSync(snapshot({ deleted: { [bookTomb('a')]: T0 + 100 } }), { books: [], progress: [progressOf('a', T0 + 20)] });
    expect(plan.putProgress).toEqual([]);
  });
});

describe('planSync: отметки', () => {
  it('новее updatedAt побеждает', () => {
    const ours = markOf('a', 'k', T0 + 10);
    expect(planSync(snapshot({ marks: [ours] }), { books: [], marks: [{ ...ours, note: 'новая', updatedAt: T0 + 20 }] }).putMarks).toHaveLength(1);
    expect(planSync(snapshot({ marks: [ours] }), { books: [], marks: [{ ...ours, note: 'старая', updatedAt: T0 + 5 }] }).putMarks).toEqual([]);
  });

  it('метка удаления не раньше updatedAt удаляет нашу и не пускает входящую', () => {
    const ours = markOf('a', 'k', T0);
    const incoming = markOf('a', 'z', T0);
    const plan = planSync(snapshot({ marks: [ours] }), { books: [], marks: [incoming], deleted: { [markTomb(ours.id)]: T0 + 1, [markTomb(incoming.id)]: T0 } });
    expect(plan.deleteMarks).toEqual([ours.id]);
    expect(plan.putMarks).toEqual([]);
  });

  it('отметки удалённой книги отбрасываются', () => {
    const plan = planSync(snapshot({ deleted: { [bookTomb('a')]: T0 + 100 } }), { books: [], marks: [markOf('a', 'k', T0 + 20)] });
    expect(plan.putMarks).toEqual([]);
  });
});

describe('planSync: галочки', () => {
  it('запись целиком, новее updatedAt', () => {
    const ours: TaskState = { bookId: 'a', done: { t1: true }, updatedAt: T0 + 10 };
    const newer: TaskState = { bookId: 'a', done: {}, updatedAt: T0 + 20 };
    const older: TaskState = { bookId: 'a', done: { t2: true }, updatedAt: T0 + 5 };
    expect(planSync(snapshot({ tasks: [ours] }), { books: [], tasks: [newer] }).putTasks).toEqual([newer]);
    expect(planSync(snapshot({ tasks: [ours] }), { books: [], tasks: [older] }).putTasks).toEqual([]);
  });

  it('без updatedAt у одной из сторон — объединение, штамп новее обоих (иначе второе устройство его не возьмёт)', () => {
    const ours: TaskState = { bookId: 'a', done: { t1: true } };
    const plan = planSync(snapshot({ tasks: [ours] }), { books: [], tasks: [{ bookId: 'a', done: { t2: true }, updatedAt: T0 }] });
    expect(plan.putTasks).toEqual([{ bookId: 'a', done: { t1: true, t2: true }, updatedAt: T0 + 1 }]);
  });

  it('оба без updatedAt — объединение без штампа; если ничего не добавилось — ничего', () => {
    const ours: TaskState = { bookId: 'a', done: { t1: true } };
    expect(planSync(snapshot({ tasks: [ours] }), { books: [], tasks: [{ bookId: 'a', done: { t2: true } }] }).putTasks).toEqual([
      { bookId: 'a', done: { t1: true, t2: true } },
    ]);
    expect(planSync(snapshot({ tasks: [ours] }), { books: [], tasks: [{ bookId: 'a', done: { t1: true } }] }).putTasks).toEqual([]);
  });
});

describe('planSync: равные штампы', () => {
  it('при равном времени и разном содержимом оба устройства выбирают одну и ту же запись', () => {
    const book = bookOf('a').meta;
    const p1 = progressOf('a', T0 + 10, 1);
    const p2 = progressOf('a', T0 + 10, 2);
    const onA = planSync(snapshot({ books: [book], progress: [p1] }), { books: [], progress: [p2] }).putProgress;
    const onB = planSync(snapshot({ books: [book], progress: [p2] }), { books: [], progress: [p1] }).putProgress;
    // Ровно одно из устройств меняет свою запись, и обе приходят к одному и тому же
    const finalA = onA[0] ?? p1;
    const finalB = onB[0] ?? p2;
    expect(finalA).toEqual(finalB);
  });

  it('новые галочки добавляются, у удалённой книги — нет', () => {
    const t: TaskState = { bookId: 'a', done: { t1: true }, updatedAt: T0 };
    expect(planSync(snapshot(), { books: [], tasks: [t] }).putTasks).toEqual([t]);
    expect(planSync(snapshot({ deleted: { [bookTomb('a')]: T0 + 1 } }), { books: [], tasks: [t] }).putTasks).toEqual([]);
  });
});

describe('planSync: метки удаления', () => {
  it('объединяются по максимуму, в putDeleted только изменившиеся', () => {
    const plan = planSync(snapshot({ deleted: { 'book:a': 10, 'book:b': 30 } }), { books: [], deleted: { 'book:a': 20, 'book:b': 5, 'mark:c': 7 } });
    expect(plan.putDeleted).toEqual({ 'book:a': 20, 'mark:c': 7 });
  });

  it('пустой Incoming — пустой план', () => {
    const book = bookOf('a').meta;
    const plan = planSync(snapshot({ books: [book], progress: [progressOf('a', T0)], marks: [markOf('a', 'k')] }), { books: [] });
    expect(plan).toEqual({ putBooks: [], deleteBooks: [], putProgress: [], putMarks: [], deleteMarks: [], putTasks: [], putDeleted: {}, report: { added: 0, updated: 0, removed: 0 } });
  });
});

describe('sharedOf', () => {
  it('не берёт записи удалённых книг', () => {
    const s = sharedOf(
      snapshot({
        progress: [progressOf('a', T0), progressOf('b', T0)],
        marks: [markOf('a', 'k'), markOf('b', 'k')],
        tasks: [{ bookId: 'a', done: {} }, { bookId: 'b', done: {} }],
        deleted: { [bookTomb('b')]: T0 + 1 },
      }),
    );
    expect(s.progress.map((p) => p.bookId)).toEqual(['a']);
    expect(s.marks.map((m) => m.bookId)).toEqual(['a']);
    expect(s.tasks.map((t) => t.bookId)).toEqual(['a']);
    expect(s.deleted).toEqual({ [bookTomb('b')]: T0 + 1 });
  });
});

describe('planPush', () => {
  const shas = (sha: string): Record<SharedPath, string> => ({ 'progress.json': sha, 'marks.json': sha, 'tasks.json': sha, 'deleted.json': sha });

  it('книги, которых нет в репозитории или где мы новее', () => {
    const local = snapshot({ books: [bookOf('a', T0).meta, bookOf('b', T0 + 10).meta, bookOf('c', T0).meta] });
    const remote: RemoteState = { ...EMPTY_REMOTE, books: { b: T0, c: T0 } };
    expect(planPush(local, remote, shas('x')).books).toEqual(['a', 'b']);
  });

  it('файлы удалённых книг убираются', () => {
    const local = snapshot({ deleted: { [bookTomb('gone')]: T0 } });
    const remote: RemoteState = { ...EMPTY_REMOTE, books: { gone: T0, keep: T0 } };
    expect(planPush(local, remote, shas('x')).removeBooks).toEqual(['gone']);
  });

  it('общие файлы — только если sha отличается', () => {
    const remote: RemoteState = { ...EMPTY_REMOTE, files: { 'progress.json': 'same', 'marks.json': 'old', 'tasks.json': 'same' } };
    expect(planPush(snapshot(), remote, shas('same')).shared).toEqual(['marks.json', 'deleted.json']);
  });
});

it('Incoming без книг — допустимый вход (тип)', () => {
  const incoming: Incoming = { books: [] };
  expect(planSync(snapshot(), incoming).putBooks).toEqual([]);
});
