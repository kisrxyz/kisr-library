import { describe, expect, it } from 'vitest';
import { newProgress } from '../../core/progress';
import type { BookMeta, Progress } from '../../core/types';
import {
  anchorScrollY,
  chapterWordsAt,
  findAnchor,
  progressAt,
  restoreTarget,
  scrollTargetY,
  wordsAt,
  type Rect,
} from './position';

describe('findAnchor', () => {
  const blocks: Rect[] = [
    { top: -50, height: 100 },
    { top: 50, height: 100 },
  ];

  it('линия внутри первого блока → он и доля над линией', () => {
    expect(findAnchor(blocks, 0)).toEqual({ index: 0, offset: 0.5 });
  });

  it('первый блок уже над линией → второй', () => {
    const a = findAnchor(blocks, 60);
    expect(a.index).toBe(1);
    expect(a.offset).toBeCloseTo(0.1, 10);
  });

  it('все блоки над линией → последний с offset 1', () => {
    expect(findAnchor(blocks, 1000)).toEqual({ index: 1, offset: 1 });
  });

  it('пустой массив → {index: 0, offset: 0}', () => {
    expect(findAnchor([], 10)).toEqual({ index: 0, offset: 0 });
  });

  it('блок, чей низ ровно на линии, уже прочитан — якорь следующий', () => {
    expect(findAnchor([{ top: 0, height: 50 }, { top: 50, height: 50 }], 50)).toEqual({ index: 1, offset: 0 });
  });

  it('блок целиком под линией (над ним заголовок главы) — offset 0, а не отрицательный', () => {
    expect(findAnchor([{ top: 120, height: 40 }], 64)).toEqual({ index: 0, offset: 0 });
  });

  it('блок нулевой высоты не даёт NaN', () => {
    expect(findAnchor([{ top: 80, height: 0 }], 64)).toEqual({ index: 0, offset: 0 });
  });

  it('вложенный список: родительский пункт выше по документу и ниже по низу — якорь он (как в старом приложении)', () => {
    // li-родитель (0..300) содержит li-детей (40..140, 140..300)
    const nested: Rect[] = [
      { top: 0, height: 300 },
      { top: 40, height: 100 },
      { top: 140, height: 160 },
    ];
    expect(findAnchor(nested, 150)).toEqual({ index: 0, offset: 0.5 });
  });
});

describe('scrollTargetY', () => {
  it('начало блока плюс доля его высоты — под панелью с зазором 8px', () => {
    expect(scrollTargetY(1000, 200, 0.25, 56)).toBe(986);
  });

  it('не меньше нуля', () => {
    expect(scrollTargetY(10, 20, 0, 56)).toBe(0);
  });

  it('Review Focus 2: крупный шрифт (блоки в 1,3 раза выше) — тот же блок и та же доля у линии чтения', () => {
    const headerH = 56;
    const lineY = headerH + 8; // линия чтения в окне
    const scrollY = 340;
    // Обычный шрифт: координаты блоков в документе
    const docTops = [0, 120, 300, 520];
    const docHeights = [100, 160, 200, 90];
    const before = findAnchor(
      docTops.map((top, i) => ({ top: top - scrollY, height: docHeights[i] })),
      lineY,
    );
    // Линия 64 в окне = 404 в документе: блок 2 (300..500), доля (404 − 300) / 200
    expect(before.index).toBe(2);
    expect(before.offset).toBeCloseTo(0.52, 10);

    // Тот же текст крупнее: все верхушки и высоты × 1,3. Ищем блок по ключу (индекс 2).
    const bigTops = docTops.map((t) => t * 1.3);
    const bigHeights = docHeights.map((h) => h * 1.3);
    const y = scrollTargetY(bigTops[2], bigHeights[2], before.offset, headerH);
    // 390 + 0,52 · 260 − 56 − 8 = 461,2
    expect(y).toBeCloseTo(461.2, 6);

    // После прокрутки к y у линии чтения снова блок 2 на той же доле
    const after = findAnchor(
      bigTops.map((top, i) => ({ top: top - y, height: bigHeights[i] })),
      lineY,
    );
    expect(after.index).toBe(2);
    expect(after.offset).toBeCloseTo(0.52, 6);
  });
});

describe('anchorScrollY (координаты блоков — в документе)', () => {
  const headerH = 56;

  it('доля больше 0 — как scrollTargetY: точка блока на линии чтения', () => {
    const rects: Rect[] = [
      { top: 300, height: 100 },
      { top: 420, height: 200 },
    ];
    expect(anchorScrollY(rects, 1, 0.5, headerH)).toBe(420 + 100 - 56 - 8);
  });

  it('первый блок с долей 0 — начало главы (видно её название)', () => {
    expect(anchorScrollY([{ top: 300, height: 100 }], 0, 0, headerH)).toBe(0);
  });

  it('доля 0 — линия стояла над блоком: на линию встаёт низ предыдущего, таблица между ними остаётся на виду', () => {
    const rects: Rect[] = [
      { top: 300, height: 100 },
      { top: 420, height: 80 }, // низ 500, дальше таблица до 900
      { top: 900, height: 100 },
    ];
    expect(anchorScrollY(rects, 2, 0, headerH)).toBe(500 - 56 - 8);
  });

  it('доля 0, а между блоками только обычный отступ — на линию встаёт сам блок (предыдущий не торчит из-под панели)', () => {
    const rects: Rect[] = [
      { top: 300, height: 100 }, // низ 400
      { top: 415, height: 100 }, // отступ абзаца 15px
    ];
    expect(anchorScrollY(rects, 1, 0, headerH)).toBe(415 - 56 - 8);
  });

  it('доля 0 у пункта после вложенного списка: родитель, который накрывает блок, пропускается', () => {
    const rects: Rect[] = [
      { top: 300, height: 100 }, // абзац, низ 400
      { top: 420, height: 300 }, // пункт-родитель 420..720 накрывает следующий
      { top: 460, height: 100 }, // вложенный пункт
    ];
    expect(anchorScrollY(rects, 2, 0, headerH)).toBe(400 - 56 - 8);
  });

  it('между блоками больше maxGap (огромная таблица) — сам блок на линию, иначе его не будет видно', () => {
    const rects: Rect[] = [
      { top: 300, height: 100 }, // низ 400, дальше таблица на 2000px
      { top: 2400, height: 100 },
    ];
    expect(anchorScrollY(rects, 1, 0, headerH, 600)).toBe(2400 - 56 - 8);
    expect(anchorScrollY(rects, 1, 0, headerH)).toBe(400 - 56 - 8);
  });

  it('нет блока с таким индексом — начало главы', () => {
    expect(anchorScrollY([], 3, 0.4, headerH)).toBe(0);
  });
});

describe('wordsAt / chapterWordsAt', () => {
  // Три блока по 10, 15 и 5 собственных слов
  const res = { wordsBefore: [0, 10, 25], words: [10, 15, 5] };

  it('wordsAt = слова до блока + округлённая доля его слов', () => {
    expect(wordsAt(res, 0, 0)).toBe(0);
    expect(wordsAt(res, 1, 0.5)).toBe(18); // 10 + round(7.5)
    expect(wordsAt(res, 2, 1)).toBe(30);
  });

  it('wordsAt пустой главы — 0, а не NaN', () => {
    expect(wordsAt({ wordsBefore: [], words: [] }, 0, 0)).toBe(0);
  });

  it('chapterWordsAt пересчитывает слова блоков в слова главы (в главе есть таблицы и заголовки без ключей)', () => {
    // собственных слов 30, в главе 60: 18 из 30 → 36 из 60
    expect(chapterWordsAt(res, 1, 0.5, 60)).toBe(36);
    expect(chapterWordsAt(res, 2, 1, 60)).toBe(60);
    expect(chapterWordsAt(res, 0, 0, 60)).toBe(0);
  });

  it('chapterWordsAt главы без блоков — 0', () => {
    expect(chapterWordsAt({ wordsBefore: [], words: [] }, 0, 0, 60)).toBe(0);
  });
});

describe('restoreTarget', () => {
  const keys = ['pa1', 'pb2', 'pc3', 'pd4'];
  const texts = ['Первый абзац', 'Чтобы быть интересным, интересуйся другими', 'Ёжик вышел из **тумана**', 'Конец главы'];

  it('?find= — первый блок с запросом (регистр и ё не важны)', () => {
    expect(restoreTarget({ keys, texts, find: 'ЕЖИК' })).toEqual({ index: 2, offset: 0, source: 'find' });
    expect(restoreTarget({ keys, texts, find: '  интересным,  ' })).toEqual({ index: 1, offset: 0, source: 'find' });
  });

  it('?find= без совпадения — дальше по порядку: ?b=, затем сохранённая позиция', () => {
    expect(restoreTarget({ keys, texts, find: 'слон', block: 'pc3' })).toEqual({ index: 2, offset: 0, source: 'block' });
  });

  it('?b= — блок по ключу с начала', () => {
    expect(restoreTarget({ keys, block: 'pd4' })).toEqual({ index: 3, offset: 0, source: 'block' });
  });

  it('?b= совпадает с сохранённым ключом этой главы («Продолжить») — с сохранённой долей', () => {
    const saved = { blockKey: 'pb2', blockIndex: 1, blockOffset: 0.4 };
    expect(restoreTarget({ keys, block: 'pb2', saved })).toEqual({ index: 1, offset: 0.4, source: 'saved' });
  });

  it('?b= не нашёлся — сохранённая позиция главы', () => {
    const saved = { blockKey: 'pc3', blockIndex: 2, blockOffset: 0.3 };
    expect(restoreTarget({ keys, block: 'zzz', saved })).toEqual({ index: 2, offset: 0.3, source: 'saved' });
  });

  it('сохранённый ключ не нашёлся (текст правили) — по индексу, индекс за пределами — последний блок', () => {
    expect(restoreTarget({ keys, saved: { blockKey: 'p0ld', blockIndex: 3, blockOffset: 0.6 } })).toEqual({
      index: 3,
      offset: 0.6,
      source: 'saved',
    });
    expect(restoreTarget({ keys, saved: { blockKey: null, blockIndex: 9, blockOffset: 0 } })).toEqual({
      index: 3,
      offset: 0,
      source: 'saved',
    });
  });

  it('доля из записи приводится к 0..1', () => {
    expect(restoreTarget({ keys, saved: { blockKey: 'pa1', blockIndex: 0, blockOffset: 7 } }).offset).toBe(1);
    expect(restoreTarget({ keys, saved: { blockKey: 'pa1', blockIndex: 0, blockOffset: Number.NaN } }).offset).toBe(0);
  });

  it('ничего не задано или в главе нет блоков — начало главы', () => {
    expect(restoreTarget({ keys })).toEqual({ index: 0, offset: 0, source: 'top' });
    expect(restoreTarget({ keys: [], saved: { blockKey: 'pa1', blockIndex: 0, blockOffset: 0.5 } })).toEqual({
      index: 0,
      offset: 0,
      source: 'top',
    });
  });
});

describe('progressAt', () => {
  const NOW = 1_800_000_000_000;
  const meta: BookMeta = {
    id: 'kniga',
    title: 'Книга',
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    origin: 'paste',
    createdAt: NOW,
    addedAt: NOW,
    updatedAt: NOW,
    words: 300,
    cards: 0,
    tasks: 0,
    chapters: [
      { id: 'kniga--01', title: 'Первая', words: 100 },
      { id: 'kniga--02', title: 'Вторая', words: 100 },
      { id: 'kniga--03', title: 'Третья', words: 100 },
    ],
    contentHash: 'h',
    favorite: false,
  };
  const base = (patch: Partial<Progress> = {}): Progress => ({ ...newProgress('kniga', NOW - 10_000), ...patch });
  const at = (p: Progress, patch: Partial<Parameters<typeof progressAt>[1]> = {}) =>
    progressAt(p, {
      meta,
      chapter: 2,
      index: 3,
      offset: 0.5,
      key: 'pabc',
      text: 'Абзац, на котором остановился',
      inChapter: 40,
      now: NOW,
      addMs: 1500,
      ...patch,
    });

  it('позиция, слова, процент, время и снимок абзаца', () => {
    const p = at(base({ readingMs: 1000 }));
    expect(p).toMatchObject({
      bookId: 'kniga',
      chapter: 2,
      blockKey: 'pabc',
      blockIndex: 3,
      blockOffset: 0.5,
      wordsRead: 140, // 100 слов первой главы + 40
      percent: 47, // 140 / 300
      maxChapter: 2,
      lastReadAt: NOW,
      readingMs: 2500,
      snippet: 'Абзац, на котором остановился',
      status: 'reading',
    });
  });

  it('snippet — первые 140 символов', () => {
    const long = 'я'.repeat(200);
    expect(at(base(), { text: long }).snippet).toBe('я'.repeat(140));
  });

  it('нет абзаца — snippet старой позиции не остаётся', () => {
    const p = at(base({ snippet: 'старый' }), { key: null, text: '' });
    expect(p.blockKey).toBeNull();
    expect('snippet' in p).toBe(false);
  });

  it('maxChapter не уменьшается, дочитанные главы не теряются', () => {
    const p = at(base({ maxChapter: 3, chaptersDone: [1, 2] }), { chapter: 1, inChapter: 10 });
    expect(p.maxChapter).toBe(3);
    expect(p.chaptersDone).toEqual([1, 2]);
    expect(p.wordsRead).toBe(10);
  });

  it('прочитанная книга остаётся прочитанной при перечитывании: статус, дата и 100%', () => {
    const p = at(base({ status: 'finished', percent: 100, finishedAt: NOW - 5000 }), { chapter: 1, inChapter: 0 });
    expect(p.status).toBe('finished');
    expect(p.finishedAt).toBe(NOW - 5000);
    expect(p.percent).toBe(100);
    expect(p.wordsRead).toBe(0);
  });

  it('слова не больше слов книги и не меньше начала главы', () => {
    expect(at(base(), { chapter: 3, inChapter: 999 }).wordsRead).toBe(300);
    expect(at(base(), { chapter: 3, inChapter: -5 }).wordsRead).toBe(200);
  });

  it('время чтения не уменьшается', () => {
    expect(at(base({ readingMs: 700 }), { addMs: -50 }).readingMs).toBe(700);
  });

  it('не меняет переданную запись', () => {
    const p = base();
    const copy = structuredClone(p);
    at(p);
    expect(p).toEqual(copy);
  });
});
