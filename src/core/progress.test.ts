import { describe, expect, it } from 'vitest';
import {
  bookStatus,
  chapterStartWords,
  clampProgress,
  lastRequiredChapter,
  markChapterDone,
  newProgress,
  percentOf,
  remainingWords,
} from './progress';
import type { BookMeta, Progress } from './types';

const NOW = 1_800_000_000_000;

/** Книга из 4 глав по 100 слов; последняя — «Источники». */
function makeMeta(titles = ['Первая', 'Вторая', 'Третья', 'Источники']): BookMeta {
  const chapters = titles.map((title, i) => ({ id: `kniga--${String(i + 1).padStart(2, '0')}`, title, words: 100 }));
  return {
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
    words: chapters.length * 100,
    cards: 0,
    tasks: 0,
    chapters,
    contentHash: 'h',
    favorite: false,
  };
}

describe('chapterStartWords / percentOf / remainingWords', () => {
  const meta = makeMeta();

  it('chapterStartWords — слова всех предыдущих глав', () => {
    expect(chapterStartWords(meta, 1)).toBe(0);
    expect(chapterStartWords(meta, 3)).toBe(200);
    expect(chapterStartWords(meta, 4)).toBe(300);
  });

  it('chapterStartWords за пределами книги не выходит за общее число слов', () => {
    expect(chapterStartWords(meta, 99)).toBe(400);
    expect(chapterStartWords(meta, 0)).toBe(0);
  });

  it('percentOf округляет и держится в 0..100', () => {
    expect(percentOf(meta, 200)).toBe(50);
    expect(percentOf(meta, 0)).toBe(0);
    expect(percentOf(meta, 1)).toBe(0);
    expect(percentOf(meta, 199)).toBe(50);
    expect(percentOf(meta, 9999)).toBe(100);
    expect(percentOf(meta, -5)).toBe(0);
  });

  it('percentOf книги без слов — 0, а не NaN', () => {
    expect(percentOf({ ...meta, words: 0 }, 10)).toBe(0);
  });

  it('remainingWords не уходит в минус', () => {
    expect(remainingWords(meta, 150)).toBe(250);
    expect(remainingWords(meta, 9999)).toBe(0);
  });
});

describe('bookStatus', () => {
  it('нет записи — «new»', () => {
    expect(bookStatus(undefined)).toBe('new');
  });
  it('reading и finished берутся из записи', () => {
    const p = newProgress('kniga', NOW);
    expect(bookStatus(p)).toBe('reading');
    expect(bookStatus({ ...p, status: 'finished' })).toBe('finished');
  });
});

describe('lastRequiredChapter', () => {
  it('последняя не служебная глава', () => {
    expect(lastRequiredChapter(makeMeta())).toBe(3);
  });
  it('несколько служебных глав в конце пропускаются', () => {
    expect(lastRequiredChapter(makeMeta(['А', 'Б', 'Карточки', 'Литература', 'Источники']))).toBe(2);
  });
  it('служебная глава посреди книги не мешает — берётся последняя не служебная', () => {
    expect(lastRequiredChapter(makeMeta(['А', 'Источники', 'В']))).toBe(3);
  });
  it('если все главы служебные — последняя глава', () => {
    expect(lastRequiredChapter(makeMeta(['Источники', 'Литература']))).toBe(2);
  });
  it('регистр названия не важен', () => {
    expect(lastRequiredChapter(makeMeta(['А', 'ИСТОЧНИКИ']))).toBe(1);
  });
});

describe('newProgress', () => {
  it('пустая запись «читаю» с первой главы', () => {
    expect(newProgress('kniga', NOW)).toEqual({
      bookId: 'kniga',
      chapter: 1,
      blockKey: null,
      blockIndex: 0,
      blockOffset: 0,
      maxChapter: 1,
      chaptersDone: [],
      wordsRead: 0,
      percent: 0,
      status: 'reading',
      startedAt: NOW,
      lastReadAt: NOW,
      readingMs: 0,
    });
  });
});

describe('markChapterDone', () => {
  const meta = makeMeta();

  it('последняя обязательная глава завершает книгу', () => {
    const p = newProgress('kniga', NOW);
    const { progress, finishedNow } = markChapterDone(p, 3, meta, NOW + 5);
    expect(finishedNow).toBe(true);
    expect(bookStatus(progress)).toBe('finished');
    expect(progress.status).toBe('finished');
    expect(progress.percent).toBe(100);
    expect(progress.finishedAt).toBe(NOW + 5);
    expect(progress.lastReadAt).toBe(NOW + 5);
    expect(progress.chaptersDone).toContain(3);
    expect(progress.maxChapter).toBe(3);
  });

  it('обычная глава только отмечается, процент считается по её концу', () => {
    const { progress, finishedNow } = markChapterDone(newProgress('kniga', NOW), 1, meta, NOW + 1);
    expect(finishedNow).toBe(false);
    expect(progress.status).toBe('reading');
    expect(progress.chaptersDone).toEqual([1]);
    expect(progress.wordsRead).toBe(100);
    expect(progress.percent).toBe(25);
    expect(progress.finishedAt).toBeUndefined();
  });

  it('chaptersDone без повторов и по порядку; maxChapter не уменьшается', () => {
    let p: Progress = { ...newProgress('kniga', NOW), maxChapter: 3 };
    p = markChapterDone(p, 2, meta, NOW).progress;
    p = markChapterDone(p, 1, meta, NOW).progress;
    p = markChapterDone(p, 2, meta, NOW).progress;
    expect(p.chaptersDone).toEqual([1, 2]);
    expect(p.maxChapter).toBe(3);
  });

  it('wordsRead не откатывается назад, если читатель уже дальше', () => {
    const p: Progress = { ...newProgress('kniga', NOW), wordsRead: 350, chapter: 4, maxChapter: 4 };
    const { progress } = markChapterDone(p, 1, meta, NOW);
    expect(progress.wordsRead).toBe(350);
  });

  it('повторное прохождение конца уже законченной книги — не «finishedNow»', () => {
    const first = markChapterDone(newProgress('kniga', NOW), 3, meta, NOW + 1).progress;
    const again = markChapterDone(first, 3, meta, NOW + 99);
    expect(again.finishedNow).toBe(false);
    expect(again.progress.status).toBe('finished');
    expect(again.progress.finishedAt).toBe(NOW + 1);
    expect(again.progress.percent).toBe(100);
  });

  it('служебная глава после последней обязательной книгу не завершает', () => {
    const { progress, finishedNow } = markChapterDone(newProgress('kniga', NOW), 4, meta, NOW);
    expect(finishedNow).toBe(false);
    expect(progress.status).toBe('reading');
  });

  it('не меняет переданный объект', () => {
    const p = newProgress('kniga', NOW);
    const copy = structuredClone(p);
    markChapterDone(p, 3, meta, NOW + 1);
    expect(p).toEqual(copy);
  });
});

describe('clampProgress', () => {
  const meta = makeMeta();

  it('глава и maxChapter не больше числа глав', () => {
    const p: Progress = {
      ...newProgress('kniga', NOW),
      chapter: 9,
      maxChapter: 12,
      chaptersDone: [2, 7, 4, 2, 0],
      wordsRead: 5000,
      percent: 100,
      blockKey: 'pabc',
      blockIndex: 7,
      blockOffset: 0.4,
      snippet: 'старый абзац',
    };
    const c = clampProgress(p, meta);
    expect(c.chapter).toBe(4);
    expect(c.maxChapter).toBeLessThanOrEqual(4);
    expect(c.chaptersDone).toEqual([2, 4]);
    expect(c.wordsRead).toBeLessThanOrEqual(meta.words);
  });

  it('если глава сдвинулась, позиция в старой главе сбрасывается на начало новой', () => {
    const p: Progress = { ...newProgress('kniga', NOW), chapter: 9, maxChapter: 9, blockKey: 'pabc', blockIndex: 7, blockOffset: 0.4, snippet: 'x' };
    const c = clampProgress(p, meta);
    expect(c.blockKey).toBeNull();
    expect(c.blockIndex).toBe(0);
    expect(c.blockOffset).toBe(0);
    expect(c.snippet).toBeUndefined();
    expect(c.wordsRead).toBe(chapterStartWords(meta, 4));
    expect(c.percent).toBe(75);
  });

  it('если всё в границах, позиция остаётся, а процент пересчитывается', () => {
    const p: Progress = {
      ...newProgress('kniga', NOW),
      chapter: 2,
      maxChapter: 2,
      blockKey: 'pabc',
      blockIndex: 3,
      blockOffset: 0.5,
      wordsRead: 150,
      percent: 99,
      snippet: 'абзац',
    };
    const c = clampProgress(p, meta);
    expect(c.chapter).toBe(2);
    expect(c.blockKey).toBe('pabc');
    expect(c.blockIndex).toBe(3);
    expect(c.snippet).toBe('абзац');
    expect(c.percent).toBe(38);
  });

  it('у законченной книги процент остаётся 100', () => {
    const p: Progress = { ...newProgress('kniga', NOW), status: 'finished', wordsRead: 100, percent: 100, finishedAt: NOW };
    expect(clampProgress(p, meta).percent).toBe(100);
  });

  it('книга ужалась до одной главы', () => {
    const one = { ...makeMeta(['Только одна']), words: 100, chapters: [{ id: 'kniga--01', title: 'Только одна', words: 100 }] };
    const c = clampProgress({ ...newProgress('kniga', NOW), chapter: 5, maxChapter: 5, chaptersDone: [1, 5] }, one);
    expect(c.chapter).toBe(1);
    expect(c.maxChapter).toBe(1);
    expect(c.chaptersDone).toEqual([1]);
  });

  it('maxChapter не меньше текущей главы', () => {
    const p: Progress = { ...newProgress('kniga', NOW), chapter: 3, maxChapter: 1 };
    expect(clampProgress(p, meta).maxChapter).toBe(3);
  });

  it('не меняет переданный объект', () => {
    const p: Progress = { ...newProgress('kniga', NOW), chapter: 9 };
    clampProgress(p, meta);
    expect(p.chapter).toBe(9);
  });
});
