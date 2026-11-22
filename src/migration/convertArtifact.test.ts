import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isBackup, planMerge, type LibrarySnapshot } from '../core/backup';
import { chapterStartWords, percentOf } from '../core/progress';
import { DEFAULT_SETTINGS } from '../core/types';
import {
  convertOld,
  findEmptyChapters,
  mergeReads,
  readOldSources,
  type OldBook,
  type OldRead,
  type OldSources,
} from './convertArtifact';

const NOW = 1_800_000_000_000;
const MINI = fileURLToPath(new URL('./__fixtures__/old-mini/', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

const EMPTY: LibrarySnapshot = { books: [], progress: [], marks: [], tasks: [], settings: {} };

const read = (articleId: string, at: number, extra: Partial<OldRead> = {}): OldRead => ({ articleId, order: 1, at, ...extra });

describe('mergeReads', () => {
  it('по каждой книге побеждает запись с бо́льшим at, книги из обоих списков остаются', () => {
    const a = [read('x', 100, { key: 'a' }), read('y', 500, { key: 'a' })];
    const b = [read('x', 300, { key: 'b' }), read('y', 200, { key: 'b' }), read('z', 1, { key: 'b' })];
    const merged = mergeReads(a, b);
    expect(merged).toHaveLength(3);
    const byId = Object.fromEntries(merged.map((r) => [r.articleId, r]));
    expect(byId.x.key).toBe('b');
    expect(byId.y.key).toBe('a');
    expect(byId.z.key).toBe('b');
  });

  it('при равном at остаётся запись из первого списка', () => {
    const merged = mergeReads([read('x', 100, { key: 'a' })], [read('x', 100, { key: 'b' })]);
    expect(merged).toEqual([read('x', 100, { key: 'a' })]);
  });

  it('не меняет входные массивы', () => {
    const a = [read('x', 1)];
    const b = [read('x', 2)];
    mergeReads(a, b);
    expect(a).toEqual([read('x', 1)]);
    expect(b).toEqual([read('x', 2)]);
  });
});

describe('readOldSources (мини-выгрузка)', () => {
  const src = readOldSources(MINI);

  it('читает книги из library.json с флагом private и главами', () => {
    expect(src.books.map((b) => b.id)).toEqual(['alfa-aaa111', 'beta-bbb222', 'gamma-ccc333']);
    expect(src.books.map((b) => b.private)).toEqual([false, false, true]);
    expect(src.books[0].sections.map((s) => s.title)).toEqual(['Вступление', 'Основы', 'Карточки', 'Источники']);
    expect(src.books[0].created).toBe('2026-11-10');
  });

  it('объединяет user-state и r-*: по книге побеждает бо́льший at', () => {
    const byId = Object.fromEntries(src.reads.map((r) => [r.articleId, r]));
    expect(src.reads).toHaveLength(3);
    expect(byId['alfa-aaa111'].key).toBe('pnew22'); // user-state новее, чем r-
    expect(byId['beta-bbb222'].key).toBe('lnew33'); // r- новее, чем user-state
    expect(byId['gamma-ccc333'].done).toBe(true); // есть только в r-
  });

  it('берёт даты из articles/* и pa-*', () => {
    expect(src.dates['alfa-aaa111']).toEqual({ createdAt: 1794000000000, updatedAt: 1794500000000 });
    expect(src.dates['gamma-ccc333']).toEqual({ createdAt: 1794100000000, updatedAt: 1794600000000 });
    expect(src.dates['beta-bbb222']).toBeUndefined();
  });

  it('названия глав из старой базы идут по order (sections/* и ps-*)', () => {
    expect(src.rawSectionTitles['alfa-aaa111']).toEqual(['Вступление', 'Основы', 'Карточки', 'Источники']);
    expect(src.rawSectionTitles['beta-bbb222']).toEqual(['Текст', 'Часть I. Люди', 'Что делать', 'Карточки']);
    expect(src.rawSectionTitles['gamma-ccc333']).toEqual(['Вступление', 'Итоги']);
  });

  it('настройки: user-state важнее prefs.json из снимка', () => {
    expect(src.prefs).toEqual({ size: 18, mode: 'auto' });
  });

  it('bk-* не читается', () => {
    expect(JSON.stringify(src)).not.toContain('СТАРАЯ КОПИЯ-МАРКЕР');
  });

  describe('без migration/raw', () => {
    let tmp = '';
    afterEach(() => rmSync(tmp, { recursive: true, force: true }));

    it('не падает: пустые dates и rawSectionTitles, прогресс только из user-state', () => {
      tmp = mkdtempSync(join(tmpdir(), 'kisr-mini-'));
      cpSync(join(MINI, 'kisr-library'), join(tmp, 'kisr-library'), { recursive: true });
      const bare = readOldSources(tmp);
      expect(bare.books).toHaveLength(3);
      expect(bare.dates).toEqual({});
      expect(bare.rawSectionTitles).toEqual({});
      expect(bare.reads.map((r) => r.articleId).sort()).toEqual(['alfa-aaa111', 'beta-bbb222']);
      expect(bare.prefs.size).toBe(18);
      const { backup } = convertOld(bare, NOW);
      expect(backup.books).toHaveLength(3);
    });

    it('без library.json — понятная ошибка', () => {
      tmp = mkdtempSync(join(tmpdir(), 'kisr-mini-'));
      expect(() => readOldSources(tmp)).toThrow(/library\.json/);
    });
  });
});

describe('convertOld (мини-выгрузка)', () => {
  const src = readOldSources(MINI);
  const { backup, summary } = convertOld(src, NOW);
  const book = (id: string) => backup.books.find((b) => b.id === id)!;
  const progress = (id: string) => backup.progress.find((p) => p.bookId === id)!;

  it('сводка и формат файла', () => {
    expect(summary).toEqual({ books: 3, chapters: 9, words: 83, progress: 3 });
    expect(backup.format).toBe('kisr-library-backup');
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe(NOW);
    expect(backup.marks).toEqual([]);
    expect(backup.tasks).toEqual([]);
    expect(isBackup(JSON.parse(JSON.stringify(backup)))).toBe(true);
  });

  it('3 книги с главами по порядку, bk-* не перенесён', () => {
    expect(backup.books.map((b) => b.id)).toEqual(['alfa-aaa111', 'beta-bbb222', 'gamma-ccc333']);
    expect(book('alfa-aaa111').chapters.map((c) => c.title)).toEqual(['Вступление', 'Основы', 'Карточки', 'Источники']);
    expect(book('alfa-aaa111').chapters[1].md).toContain('Сделать первый шаг');
    expect(JSON.stringify(backup)).not.toContain('СТАРАЯ КОПИЯ-МАРКЕР');
  });

  it('id глав — `${id}--NN`, счётчики пересчитаны по тексту', () => {
    const plan = planMerge(EMPTY, backup);
    const alfa = plan.putBooks.find((b) => b.meta.id === 'alfa-aaa111')!;
    expect(alfa.chapters.map((c) => c.id)).toEqual(['alfa-aaa111--01', 'alfa-aaa111--02', 'alfa-aaa111--03', 'alfa-aaa111--04']);
    expect(alfa.meta.chapters.map((c) => c.words)).toEqual([13, 10, 18, 4]);
    expect(book('alfa-aaa111')).toMatchObject({ words: 45, cards: 2, tasks: 2 }); // в library.json стояли 9999 и 7
    expect(book('alfa-aaa111').contentHash).toMatch(/^[0-9a-z]+$/);
  });

  it('origin, addedAt и даты: из снимка, а если их нет — из created (локальная полночь)', () => {
    for (const b of backup.books) {
      expect(b.origin).toBe('migration');
      expect(b.addedAt).toBe(NOW);
    }
    expect(book('alfa-aaa111')).toMatchObject({ createdAt: 1794000000000, updatedAt: 1794500000000 });
    expect(book('gamma-ccc333')).toMatchObject({ createdAt: 1794100000000, updatedAt: 1794600000000 });
    const midnight = new Date(2026, 10, 12).getTime();
    expect(book('beta-bbb222')).toMatchObject({ createdAt: midnight, updatedAt: midnight });
  });

  it('прогресс: chapter = order, maxChapter = max, blockKey = key, status reading, lastReadAt = at', () => {
    const p = progress('alfa-aaa111');
    expect(p).toMatchObject({
      bookId: 'alfa-aaa111',
      chapter: 2,
      maxChapter: 3,
      blockKey: 'pnew22',
      blockIndex: 0,
      blockOffset: 0,
      status: 'reading',
      chaptersDone: [],
      startedAt: 1795000002000,
      lastReadAt: 1795000002000,
      readingMs: 0,
    });
    expect(p.finishedAt).toBeUndefined();
  });

  it('percent = percentOf(meta, слова глав до текущей)', () => {
    const plan = planMerge(EMPTY, backup);
    for (const id of ['alfa-aaa111', 'beta-bbb222']) {
      const meta = plan.putBooks.find((b) => b.meta.id === id)!.meta;
      const p = progress(id);
      const words = chapterStartWords(meta, p.chapter);
      expect(p.wordsRead).toBe(words);
      expect(p.percent).toBe(percentOf(meta, words));
    }
    expect(progress('alfa-aaa111')).toMatchObject({ wordsRead: 13, percent: 29 });
    expect(progress('beta-bbb222')).toMatchObject({ wordsRead: 10, percent: 43 });
  });

  it('pin: true → favorite: true', () => {
    expect(book('alfa-aaa111').favorite).toBe(true);
    expect(book('beta-bbb222').favorite).toBe(false);
    expect(book('gamma-ccc333').favorite).toBe(false);
  });

  it('непустой act → action.text; пустого действия нет', () => {
    expect(book('beta-bbb222').action).toEqual({ text: 'Сделать зарядку', done: false });
    expect(book('alfa-aaa111').action).toBeUndefined();
  });

  it('глава, названная в старой базе иначе, находится по названию', () => {
    // r-beta: order 3 → в старой базе «Что делать», в очищенной книге это глава 2; max 4 («Карточки») → 3
    expect(progress('beta-bbb222')).toMatchObject({ chapter: 2, maxChapter: 3, blockKey: 'lnew33' });
  });

  it('done → finished: 100%, finishedAt из doneAt', () => {
    expect(progress('gamma-ccc333')).toMatchObject({
      status: 'finished',
      chapter: 2,
      maxChapter: 2,
      percent: 100,
      wordsRead: 15,
      lastReadAt: 1795000006000,
      finishedAt: 1795000006500,
    });
  });

  it('настройки: fontSize из prefs.size, тема auto', () => {
    expect(backup.settings.fontSize).toBe(18);
    expect(backup.settings.theme).toBe('auto');
  });

  it('файл восстанавливается в пустую библиотеку: planMerge добавляет все книги и весь прогресс', () => {
    const plan = planMerge(EMPTY, JSON.parse(JSON.stringify(backup)));
    expect(plan.report).toEqual({ added: 3, updated: 0, skipped: 0 });
    expect(plan.putProgress).toHaveLength(3);
    expect(plan.settings).toEqual({ theme: 'auto', fontSize: 18 });
  });

  it('пустых глав нет', () => {
    expect(findEmptyChapters(backup)).toEqual([]);
  });
});

describe('convertOld (граничные случаи)', () => {
  const sections = (...titles: string[]) => titles.map((title) => ({ title, md: `Текст главы ${title}.` }));
  const oldBook = (id: string, secs: OldBook['sections'], extra: Partial<OldBook> = {}): OldBook => ({
    id,
    title: `Книга ${id}`,
    category: '',
    tags: [],
    summary: '',
    source: '',
    created: '2026-11-17',
    private: false,
    sections: secs,
    ...extra,
  });
  const sources = (books: OldBook[], reads: OldRead[], rawSectionTitles: Record<string, string[]> = {}): OldSources => ({
    books,
    reads,
    prefs: {},
    dates: {},
    rawSectionTitles,
  });

  it('без prefs берутся настройки по умолчанию; пустой раздел → «Разное»', () => {
    const { backup } = convertOld(sources([oldBook('k', sections('Раз'))], []), NOW);
    expect(backup.settings).toEqual({ theme: DEFAULT_SETTINGS.theme, fontSize: DEFAULT_SETTINGS.fontSize });
    expect(backup.books[0].category).toBe('Разное');
  });

  it('prefs.size вне 15–24 игнорируется, mode light/dark переносится', () => {
    const base = sources([oldBook('k', sections('Раз'))], []);
    expect(convertOld({ ...base, prefs: { size: 99, mode: 'dark' } }, NOW).backup.settings).toEqual({ theme: 'dark', fontSize: 18 });
    expect(convertOld({ ...base, prefs: { size: 21, mode: 'что-то' } }, NOW).backup.settings).toEqual({ theme: 'auto', fontSize: 21 });
  });

  it('прогресс по книге, которой нет в library.json, пропускается', () => {
    const { backup, summary } = convertOld(sources([oldBook('k', sections('Раз', 'Два'))], [read('k', 5), read('нет-такой', 9)]), NOW);
    expect(backup.progress.map((p) => p.bookId)).toEqual(['k']);
    expect(summary.progress).toBe(1);
  });

  it('сводит записи по книге через mergeReads', () => {
    const src = sources([oldBook('k', sections('Раз', 'Два'))], [read('k', 5, { order: 1 }), read('k', 9, { order: 2 })]);
    const { backup } = convertOld(src, NOW);
    expect(backup.progress).toHaveLength(1);
    expect(backup.progress[0].chapter).toBe(2);
  });

  it('если названия в старой базе совпадают с книгой, порядок не трогаем', () => {
    const src = sources([oldBook('k', sections('Раз', 'Два', 'Три'))], [read('k', 5, { order: 3, max: 3 })], { k: ['Раз', 'Два', 'Три'] });
    expect(convertOld(src, NOW).backup.progress[0]).toMatchObject({ chapter: 3, maxChapter: 3 });
  });

  it('при повторяющихся названиях берётся ближайшая к order глава', () => {
    const src = sources([oldBook('k', sections('Итоги', 'Раз', 'Итоги'))], [read('k', 5, { order: 4, max: 4 })], {
      k: ['Итоги', 'Раз', 'Пропавшая', 'Итоги'],
    });
    expect(convertOld(src, NOW).backup.progress[0]).toMatchObject({ chapter: 3, maxChapter: 3 });
  });

  it('если главы с таким названием нет, order ограничивается числом глав', () => {
    const src = sources([oldBook('k', sections('Раз', 'Два'))], [read('k', 5, { order: 3, max: 3 })], { k: ['Раз', 'Два', 'Исчезла'] });
    expect(convertOld(src, NOW).backup.progress[0]).toMatchObject({ chapter: 2, maxChapter: 2 });
  });

  it('maxChapter не меньше chapter; пустой key → blockKey null', () => {
    const src = sources([oldBook('k', sections('Раз', 'Два', 'Три'))], [read('k', 5, { order: 3, max: 1, key: '' })]);
    expect(convertOld(src, NOW).backup.progress[0]).toMatchObject({ chapter: 3, maxChapter: 3, blockKey: null });
  });

  it('actDone переносится, пробелы в act обрезаются, пустой act игнорируется', () => {
    const books = [oldBook('a', sections('Раз')), oldBook('b', sections('Раз'))];
    const reads = [read('a', 1, { act: '  Позвонить  ', actDone: true }), read('b', 1, { act: '   ', actDone: false })];
    const { backup } = convertOld(sources(books, reads), NOW);
    expect(backup.books[0].action).toEqual({ text: 'Позвонить', done: true });
    expect(backup.books[1].action).toBeUndefined();
  });

  it('finished без doneAt: finishedAt = at', () => {
    const { backup } = convertOld(sources([oldBook('k', sections('Раз', 'Два'))], [read('k', 7, { order: 2, done: true, doneAt: null })]), NOW);
    expect(backup.progress[0]).toMatchObject({ status: 'finished', finishedAt: 7, percent: 100 });
  });

  it('createdAt: некорректная дата created → время миграции', () => {
    const { backup } = convertOld(sources([oldBook('k', sections('Раз'), { created: 'вчера' })], []), NOW);
    expect(backup.books[0].createdAt).toBe(NOW);
  });

  it('findEmptyChapters находит пустые и пробельные главы', () => {
    const { backup } = convertOld(
      sources([oldBook('k', [{ title: 'Раз', md: 'Текст.' }, { title: 'Два', md: ' \n ' }, { title: 'Три', md: '' }])], []),
      NOW,
    );
    expect(findEmptyChapters(backup)).toEqual([
      { bookId: 'k', chapter: 2 },
      { bookId: 'k', chapter: 3 },
    ]);
  });
});

// Тесты на настоящих данных владельца: их нет в репозитории, поэтому без выгрузки пропускаются.
describe.skipIf(!existsSync(join(REPO, 'kisr-library', 'data', 'library.json')))('convertOld (реальная выгрузка)', () => {
  const src = readOldSources(REPO);
  const { backup, summary } = convertOld(src, NOW);

  it('23 книги и прогресс не меньше шести', () => {
    expect(summary.books).toBe(23);
    expect(summary.progress).toBeGreaterThanOrEqual(6);
    expect(backup.books).toHaveLength(23);
    expect(summary.chapters).toBe(backup.books.reduce((n, b) => n + b.chapters.length, 0));
  });

  it('ни одна глава не пустая', () => {
    expect(findEmptyChapters(backup)).toEqual([]);
    for (const b of backup.books) for (const c of b.chapters) expect(c.md.trim().length).toBeGreaterThan(0);
  });

  it('carnegie-shpargalka: избранная, остановились на своём абзаце', () => {
    const p = backup.progress.find((x) => x.bookId === 'carnegie-shpargalka')!;
    expect(backup.books.find((b) => b.id === 'carnegie-shpargalka')!.favorite).toBe(true);
    expect(p.blockKey).toBe('p1i6upg5');
  });

  it('vstuplenie-mwkhjndt: запись user-state (глава 5) новее, чем r- (глава 9)', () => {
    expect(backup.progress.find((x) => x.bookId === 'vstuplenie-mwkhjndt')!.chapter).toBe(5);
  });

  it('файл восстанавливается: planMerge в пустую библиотеку добавляет 23 книги', () => {
    const file = JSON.parse(JSON.stringify(backup));
    expect(isBackup(file)).toBe(true);
    const plan = planMerge(EMPTY, file);
    expect(plan.report.added).toBe(23);
    expect(plan.putProgress.length).toBe(summary.progress);
  });
});
