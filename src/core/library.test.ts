import { describe, expect, it } from 'vitest';
import {
  categoryCounts,
  continueReading,
  filterBooks,
  isNew,
  readingNow,
  statusCounts,
  type ShelfQuery,
} from './library';
import type { BookMeta, Progress } from './types';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WPM = 180;

function book(id: string, over: Partial<BookMeta> = {}): BookMeta {
  return {
    id,
    title: id,
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    origin: 'paste',
    createdAt: NOW - 100 * DAY,
    addedAt: NOW - 100 * DAY,
    updatedAt: NOW - 100 * DAY,
    words: 1800,
    cards: 0,
    tasks: 0,
    chapters: [{ id: `${id}--01`, title: 'Глава', words: over.words ?? 1800 }],
    contentHash: id,
    favorite: false,
    ...over,
  };
}

function prog(bookId: string, over: Partial<Progress> = {}): Progress {
  return {
    bookId,
    chapter: 1,
    blockKey: null,
    blockIndex: 0,
    blockOffset: 0,
    maxChapter: 1,
    chaptersDone: [],
    wordsRead: 0,
    percent: 0,
    status: 'reading',
    startedAt: NOW - 50 * DAY,
    lastReadAt: NOW - 50 * DAY,
    readingMs: 0,
    ...over,
  };
}

/**
 * Шесть книг (скорость 180 слов/мин):
 *   alpha  Философия  10 мин  не начата, добавлена 10 дней назад
 *   bravo  Психология 20 мин  не начата, добавлена вчера, ★
 *   cesar  Философия  50 мин  читаю, открыта 3 дня назад
 *   delta  Психология  5 мин  прочитана, открыта 5 дней назад
 *   yolka  Наука      30 мин  читаю, открыта час назад, ★
 *   zeta   Наука      31 мин  не начата, добавлена 2 дня назад
 */
const alpha = book('alpha', { title: 'Альфа', category: 'Философия', words: 1800, addedAt: NOW - 10 * DAY });
const bravo = book('bravo', {
  title: 'Бета',
  category: 'Психология',
  words: 3600,
  addedAt: NOW - 1 * DAY,
  favorite: true,
});
const cesar = book('cesar', { title: 'Евгений', category: 'Философия', words: 9000, addedAt: NOW - 20 * DAY });
const delta = book('delta', { title: 'Яма', category: 'Психология', words: 900, addedAt: NOW - 30 * DAY });
const yolka = book('yolka', {
  title: 'Ёлка',
  category: 'Наука',
  words: 5400,
  addedAt: NOW - 5 * DAY,
  favorite: true,
});
const zeta = book('zeta', { title: 'Вера', category: 'Наука', words: 5580, addedAt: NOW - 2 * DAY });

const BOOKS = [alpha, bravo, cesar, delta, yolka, zeta];

const PROGRESS = new Map<string, Progress>([
  ['cesar', prog('cesar', { lastReadAt: NOW - 3 * DAY })],
  ['delta', prog('delta', { status: 'finished', percent: 100, lastReadAt: NOW - 5 * DAY, finishedAt: NOW - 5 * DAY })],
  ['yolka', prog('yolka', { lastReadAt: NOW - HOUR })],
]);

const ALL: ShelfQuery = { status: 'all', category: null, length: 'any', sort: 'recent' };
const ids = (list: BookMeta[]) => list.map((b) => b.id);
const run = (q: Partial<ShelfQuery> = {}) => ids(filterBooks(BOOKS, PROGRESS, { ...ALL, ...q }, WPM));

describe('filterBooks: статус', () => {
  it('«Все» — все книги', () => {
    expect(run({ sort: 'title' })).toHaveLength(6);
  });

  it('«Читаю» — начатые и не дочитанные', () => {
    expect(new Set(run({ status: 'reading' }))).toEqual(new Set(['cesar', 'yolka']));
  });

  it('«Новые» — ещё не начатые', () => {
    expect(new Set(run({ status: 'new' }))).toEqual(new Set(['alpha', 'bravo', 'zeta']));
  });

  it('«Прочитано» — дочитанные', () => {
    expect(run({ status: 'finished' })).toEqual(['delta']);
  });

  it('★ — избранные', () => {
    expect(new Set(run({ status: 'fav' }))).toEqual(new Set(['bravo', 'yolka']));
  });

  it('не меняет переданный массив книг', () => {
    const copy = [...BOOKS];
    filterBooks(BOOKS, PROGRESS, { ...ALL, sort: 'title' }, WPM);
    expect(BOOKS).toEqual(copy);
  });
});

describe('filterBooks: раздел и длина', () => {
  it('раздел оставляет только его книги', () => {
    expect(new Set(run({ category: 'Философия' }))).toEqual(new Set(['alpha', 'cesar']));
    expect(run({ category: 'Нет такого' })).toEqual([]);
  });

  it('«короткие» — до 10 минут, «средние» — до 30, «длинные» — дольше', () => {
    expect(new Set(run({ length: 'short' }))).toEqual(new Set(['alpha', 'delta']));
    expect(new Set(run({ length: 'medium' }))).toEqual(new Set(['bravo', 'yolka']));
    expect(new Set(run({ length: 'long' }))).toEqual(new Set(['cesar', 'zeta']));
  });

  it('длина считается по скорости чтения из настроек', () => {
    // 1800 слов: при 120 слов/мин — 15 мин (средняя), при 300 — 6 мин (короткая)
    const slow = filterBooks([alpha], PROGRESS, { ...ALL, length: 'medium' }, 120);
    const fast = filterBooks([alpha], PROGRESS, { ...ALL, length: 'short' }, 300);
    expect(ids(slow)).toEqual(['alpha']);
    expect(ids(fast)).toEqual(['alpha']);
  });

  it('фильтры складываются', () => {
    expect(run({ status: 'new', category: 'Наука', length: 'long' })).toEqual(['zeta']);
    expect(run({ status: 'fav', category: 'Философия' })).toEqual([]);
  });
});

describe('filterBooks: сортировка', () => {
  it('«Недавние» — по max(lastReadAt, addedAt), свежие сверху', () => {
    // yolka −1 ч · bravo −1 д · zeta −2 д · cesar −3 д (чтение; добавлена −20) · delta −5 д · alpha −10 д
    expect(run({ sort: 'recent' })).toEqual(['yolka', 'bravo', 'zeta', 'cesar', 'delta', 'alpha']);
  });

  it('«Недавние»: недавно добавленная, но не открытая книга выше давно читанной', () => {
    expect(run({ sort: 'recent' }).indexOf('bravo')).toBeLessThan(run({ sort: 'recent' }).indexOf('delta'));
  });

  it('«Добавлены» — по addedAt, новые сверху (чтение на порядок не влияет)', () => {
    expect(run({ sort: 'added' })).toEqual(['bravo', 'zeta', 'yolka', 'alpha', 'cesar', 'delta']);
  });

  it('«Название» — по алфавиту с русскими правилами (ё после е)', () => {
    expect(run({ sort: 'title' })).toEqual(['alpha', 'bravo', 'zeta', 'cesar', 'yolka', 'delta']);
    // Альфа, Бета, Вера, Евгений, Ёлка, Яма
  });

  it('«Короче» — меньше слов раньше', () => {
    expect(run({ sort: 'short' })).toEqual(['delta', 'alpha', 'bravo', 'yolka', 'zeta', 'cesar']);
  });

  it('«Длиннее» — больше слов раньше', () => {
    expect(run({ sort: 'long' })).toEqual(['cesar', 'zeta', 'yolka', 'bravo', 'alpha', 'delta']);
  });

  it('при равных значениях порядок стабилен: по названию', () => {
    const twins = [book('b', { title: 'Бета', words: 900 }), book('a', { title: 'Альфа', words: 900 })];
    const out = filterBooks(twins, new Map(), { ...ALL, sort: 'short' }, WPM);
    expect(ids(out)).toEqual(['a', 'b']);
  });
});

describe('categoryCounts', () => {
  it('по убыванию числа книг, при равенстве — по имени', () => {
    expect(categoryCounts(BOOKS)).toEqual([
      { name: 'Наука', count: 2 },
      { name: 'Психология', count: 2 },
      { name: 'Философия', count: 2 },
    ]);
    const more = [...BOOKS, book('x', { category: 'Философия' })];
    expect(categoryCounts(more)[0]).toEqual({ name: 'Философия', count: 3 });
  });

  it('пустая полка — пустой список', () => {
    expect(categoryCounts([])).toEqual([]);
  });
});

describe('statusCounts', () => {
  it('считает книги по каждому сегменту', () => {
    expect(statusCounts(BOOKS, PROGRESS)).toEqual({ all: 6, reading: 2, new: 3, finished: 1, fav: 2 });
  });

  it('без прогресса все книги новые', () => {
    expect(statusCounts(BOOKS, new Map())).toEqual({ all: 6, reading: 0, new: 6, finished: 0, fav: 2 });
  });
});

describe('continueReading / readingNow', () => {
  it('«Продолжить» — самая свежая из начатых по lastReadAt', () => {
    const found = continueReading(BOOKS, PROGRESS);
    expect(found?.book.id).toBe('yolka');
    expect(found?.progress.bookId).toBe('yolka');
  });

  it('не берёт прочитанные и не начатые книги', () => {
    const onlyDone = new Map([['delta', PROGRESS.get('delta')!]]);
    expect(continueReading(BOOKS, onlyDone)).toBeNull();
    expect(continueReading(BOOKS, new Map())).toBeNull();
  });

  it('прогресс удалённой книги игнорируется', () => {
    const orphan = new Map([['ghost', prog('ghost', { lastReadAt: NOW })], ...PROGRESS]);
    expect(continueReading(BOOKS, orphan)?.book.id).toBe('yolka');
    expect(readingNow(BOOKS, orphan).map((r) => r.book.id)).toEqual(['cesar']);
  });

  it('«Читаю сейчас» — остальные начатые, свежие сверху, без героя', () => {
    expect(readingNow(BOOKS, PROGRESS).map((r) => r.book.id)).toEqual(['cesar']);
  });

  it('«Читаю сейчас» ограничен лимитом (по умолчанию 5)', () => {
    const many = Array.from({ length: 9 }, (_, i) => book(`b${i}`));
    const progress = new Map(many.map((b, i) => [b.id, prog(b.id, { lastReadAt: NOW - i * HOUR })]));
    const list = readingNow(many, progress);
    expect(list).toHaveLength(5);
    expect(list.map((r) => r.book.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(readingNow(many, progress, 2).map((r) => r.book.id)).toEqual(['b1', 'b2']);
  });

  it('без начатых книг — пусто', () => {
    expect(readingNow(BOOKS, new Map())).toEqual([]);
  });
});

describe('isNew', () => {
  it('добавлена за последние 3 суток и не открыта — новая', () => {
    expect(isNew(bravo, undefined, NOW)).toBe(true); // вчера
    expect(isNew(zeta, undefined, NOW)).toBe(true); // 2 дня
    expect(isNew(book('edge', { addedAt: NOW - 3 * DAY }), undefined, NOW)).toBe(true);
  });

  it('старше 3 суток — уже нет', () => {
    expect(isNew(book('old', { addedAt: NOW - 3 * DAY - 1 }), undefined, NOW)).toBe(false);
    expect(isNew(alpha, undefined, NOW)).toBe(false);
  });

  it('если есть прогресс, метка не нужна', () => {
    const fresh = book('fresh', { addedAt: NOW - HOUR });
    expect(isNew(fresh, prog('fresh'), NOW)).toBe(false);
  });

  it('добавлена вставкой, файлом или через «Поделиться» — новая', () => {
    for (const origin of ['paste', 'file', 'share'] as const) {
      expect(isNew(book('o', { origin, addedAt: NOW - HOUR }), undefined, NOW), origin).toBe(true);
    }
  });

  it('перенесённая из старого приложения не новая, даже если перенос был только что', () => {
    expect(isNew(book('moved', { origin: 'migration', addedAt: NOW - HOUR }), undefined, NOW)).toBe(false);
  });

  it('восстановленная из копии не новая, даже если восстановление было только что', () => {
    expect(isNew(book('restored', { origin: 'backup', addedAt: NOW - HOUR }), undefined, NOW)).toBe(false);
  });
});

describe('производительность', () => {
  it('500 книг: filterBooks быстрее 20 мс при любой сортировке', () => {
    const categories = ['Философия', 'Психология', 'Наука', 'История', 'Экономика', 'Разное'];
    const many = Array.from({ length: 500 }, (_, i) =>
      book(`book-${i}`, {
        title: `Книга номер ${(i * 7919) % 500} про что-то важное`,
        category: categories[i % categories.length],
        words: 600 + ((i * 7919) % 9000),
        addedAt: NOW - ((i * 104729) % 200) * DAY,
        favorite: i % 11 === 0,
      }),
    );
    const progress = new Map(
      many
        .filter((_, i) => i % 3 === 0)
        .map((b, i) => [b.id, prog(b.id, { lastReadAt: NOW - i * HOUR, status: i % 4 === 0 ? 'finished' : 'reading' })]),
    );

    for (const sort of ['recent', 'added', 'title', 'short', 'long'] as const) {
      const start = performance.now();
      const out = filterBooks(many, progress, { status: 'all', category: null, length: 'any', sort }, WPM);
      const spent = performance.now() - start;
      expect(out).toHaveLength(500);
      expect(spent, `сортировка ${sort}: ${spent.toFixed(1)} мс`).toBeLessThan(20);
    }
  });
});
