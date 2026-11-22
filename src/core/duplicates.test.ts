import { describe, expect, it } from 'vitest';
import { buildBook, contentHashOf } from './book';
import { applyResolution, defaultResolution, findDuplicate, partAlreadyIn } from './duplicates';
import type { ParsedBook } from './parse';
import { newProgress, clampProgress } from './progress';
import type { BookMeta } from './types';

const T0 = 1_700_000_000_000;
const T1 = 1_800_000_000_000;

function parsedOf(title: string, chapters: string[], extra: Partial<ParsedBook> = {}): ParsedBook {
  return {
    title,
    category: 'Философия',
    tags: ['стоики'],
    summary: 'Старое описание',
    source: '',
    chapters: chapters.map((name) => ({ title: name, md: `Текст главы «${name}», несколько слов для счёта.` })),
    warnings: [],
    ...extra,
  };
}

function stored(parsed: ParsedBook, id = 'stoitsizm-abc'): { meta: BookMeta; chapters: ReturnType<typeof buildBook>['chapters'] } {
  return buildBook(parsed, { origin: 'paste', id, now: T0 });
}

describe('findDuplicate', () => {
  const existing = stored(parsedOf('Стоицизм: как жить твёрдо', ['А', 'Б']));
  const hashOf = (p: ParsedBook) => contentHashOf(p.chapters);

  it('тот же contentHash — «same-content», а решение по умолчанию — skip', () => {
    const parsed = parsedOf('Совсем другое название', ['А', 'Б']);
    // Хеш берём у сохранённой книги: содержимое «то же».
    const dup = findDuplicate(parsed, existing.meta.contentHash, [existing.meta]);
    expect(dup).toEqual({ kind: 'same-content', book: existing.meta });
    expect(defaultResolution(parsed, dup)).toBe('skip');
  });

  it('совпадение содержимого важнее совпадения названия', () => {
    const other = stored(parsedOf('Другая', ['В']), 'drugaya-1');
    const parsed = parsedOf('Стоицизм: как жить твёрдо', ['А', 'Б']);
    const dup = findDuplicate(parsed, other.meta.contentHash, [existing.meta, other.meta]);
    expect(dup?.kind).toBe('same-content');
    expect(dup?.book.id).toBe('drugaya-1');
  });

  it('то же название без регистра, ё=е и пунктуации — «same-title», решение — update', () => {
    const parsed = parsedOf('стоицизм — как жить твердо', ['А', 'Б', 'В']);
    const dup = findDuplicate(parsed, hashOf(parsed), [existing.meta]);
    expect(dup).toEqual({ kind: 'same-title', book: existing.meta });
    expect(defaultResolution(parsed, dup)).toBe('update');
  });

  it('part.n > 1 при том же названии — append по умолчанию', () => {
    const parsed = parsedOf('Стоицизм: как жить твёрдо', ['Г'], { part: { n: 2, of: 3 } });
    const dup = findDuplicate(parsed, hashOf(parsed), [existing.meta]);
    expect(dup?.kind).toBe('same-title');
    expect(defaultResolution(parsed, dup)).toBe('append');
  });

  it('part.n === 1 при том же названии — update', () => {
    const parsed = parsedOf('Стоицизм: как жить твёрдо', ['Г'], { part: { n: 1, of: 3 } });
    expect(defaultResolution(parsed, findDuplicate(parsed, hashOf(parsed), [existing.meta]))).toBe('update');
  });

  it('нет дубля — null и separate', () => {
    const parsed = parsedOf('Эпиктет', ['А']);
    const dup = findDuplicate(parsed, hashOf(parsed), [existing.meta]);
    expect(dup).toBeNull();
    expect(defaultResolution(parsed, dup)).toBe('separate');
  });

  it('пустая полка — null', () => {
    const parsed = parsedOf('Любая', ['А']);
    expect(findDuplicate(parsed, hashOf(parsed), [])).toBeNull();
  });
});

describe('часть книги, которая уже в книге (вставили ещё раз)', () => {
  // На полке собраны части 1 и 2: «Начало», «Середина» + «Развязка», «Итог»
  const part1 = parsedOf('Длинная книга', ['Начало', 'Середина'], { part: { n: 1, of: 2 } });
  const part2 = parsedOf('Длинная книга', ['Развязка', 'Итог'], { part: { n: 2, of: 2 } });
  const merged = applyResolution(stored(part1, 'dlinnaya-xyz'), part2, 'append', T1).meta;
  const resolve = (p: ParsedBook) => {
    const dup = findDuplicate(p, contentHashOf(p.chapters), [merged]);
    expect(dup?.kind).toBe('same-title');
    return { dup, res: defaultResolution(p, dup) };
  };

  it('часть 1 ещё раз после того, как части собраны: «Пропустить», а не «Обновить» (часть 2 не пропадёт)', () => {
    const { dup, res } = resolve(part1);
    expect(res).toBe('skip');
    expect(partAlreadyIn(part1, dup!.book)).toBe(true);
  });

  it('часть 2 ещё раз: «Пропустить», а не «Дописать» второй раз', () => {
    expect(resolve(part2).res).toBe('skip');
  });

  it('изменённая часть (другой текст) — как раньше: часть 1 «Обновить», часть 2 «Дописать»', () => {
    const changed = (p: ParsedBook): ParsedBook => ({
      ...p,
      chapters: p.chapters.map((c, i) => (i === 0 ? { ...c, md: c.md + ' И ещё одна новая фраза.' } : c)),
    });
    expect(partAlreadyIn(changed(part1), merged)).toBe(false);
    expect(resolve(changed(part1)).res).toBe('update');
    expect(resolve(changed(part2)).res).toBe('append');
  });

  it('часть с новой главой — не «уже в книге»', () => {
    const more = parsedOf('Длинная книга', ['Развязка', 'Итог', 'Послесловие'], { part: { n: 2, of: 2 } });
    expect(resolve(more).res).toBe('append');
  });

  it('книга без part с теми же главами — как раньше, «Обновить»', () => {
    const whole = parsedOf('Длинная книга', ['Начало', 'Середина']);
    expect(partAlreadyIn(whole, merged)).toBe(false);
    expect(resolve(whole).res).toBe('update');
  });
});

describe('applyResolution — update', () => {
  const five = stored(parsedOf('Стоицизм: как жить твёрдо', ['1', '2', '3', '4', '5']));
  const existing = {
    meta: { ...five.meta, favorite: true, action: { text: 'Выписать три правила', done: true, doneAt: T0 + 5 }, createdAt: 123, addedAt: T0 + 1 },
    chapters: five.chapters,
  };
  const incoming = parsedOf('Стоицизм: как жить твёрдо', ['Новая А', 'Новая Б', 'Новая В'], { summary: 'Новое описание', tags: ['новое'] });

  const result = applyResolution(existing, incoming, 'update', T1);

  it('сохраняет id, createdAt, addedAt, favorite и action', () => {
    expect(result.meta.id).toBe(existing.meta.id);
    expect(result.meta.favorite).toBe(true);
    expect(result.meta.action).toEqual({ text: 'Выписать три правила', done: true, doneAt: T0 + 5 });
    expect(result.meta.createdAt).toBe(123);
    expect(result.meta.addedAt).toBe(T0 + 1);
    expect(result.meta.updatedAt).toBe(T1);
  });

  it('заменяет содержимое и пересчитывает счётчики и contentHash', () => {
    expect(result.chapters.map((c) => c.title)).toEqual(['Новая А', 'Новая Б', 'Новая В']);
    expect(result.chapters.map((c) => c.id)).toEqual(['stoitsizm-abc--01', 'stoitsizm-abc--02', 'stoitsizm-abc--03']);
    expect(result.chapters.every((c) => c.bookId === existing.meta.id)).toBe(true);
    expect(result.meta.chapters).toHaveLength(3);
    expect(result.meta.words).toBe(result.chapters.reduce((s, c) => s + c.words, 0));
    expect(result.meta.words).toBeLessThan(existing.meta.words);
    expect(result.meta.contentHash).toBe(contentHashOf(incoming.chapters));
    expect(result.meta.summary).toBe('Новое описание');
    expect(result.meta.tags).toEqual(['новое']);
  });

  it('прогресс на главе 5 после обновления на 3 главы ограничивается главой 3', () => {
    const progress = { ...newProgress(existing.meta.id, T0), chapter: 5, maxChapter: 5, chaptersDone: [1, 2, 3, 4] };
    const clamped = clampProgress(progress, result.meta);
    expect(clamped.chapter).toBe(3);
    expect(clamped.maxChapter).toBe(3);
    expect(clamped.chaptersDone).toEqual([1, 2, 3]);
  });

  it('книга без action остаётся без ключа action', () => {
    const r = applyResolution({ meta: five.meta, chapters: five.chapters }, incoming, 'update', T1);
    expect('action' in r.meta).toBe(false);
  });

  it('не меняет переданные записи', () => {
    const before = structuredClone(existing);
    applyResolution(existing, incoming, 'update', T1);
    expect(existing).toEqual(before);
  });
});

describe('applyResolution — append', () => {
  const base = stored(parsedOf('Длинная книга', ['Часть 1', 'Часть 2']), 'dlinnaya-xyz');
  const existing = { meta: { ...base.meta, favorite: true, createdAt: 77 }, chapters: base.chapters };
  const incoming = parsedOf('Длинная книга', ['Часть 3', 'Часть 4'], {
    tags: ['стоики', 'новый-тег'],
    summary: 'Описание продолжения',
    part: { n: 2, of: 2 },
  });
  const result = applyResolution(existing, incoming, 'append', T1);

  it('главы добавляются в конец с перенумерацией: 2 + 2 = id --01..--04', () => {
    expect(result.chapters.map((c) => c.id)).toEqual([
      'dlinnaya-xyz--01',
      'dlinnaya-xyz--02',
      'dlinnaya-xyz--03',
      'dlinnaya-xyz--04',
    ]);
    expect(result.chapters.map((c) => c.order)).toEqual([1, 2, 3, 4]);
    expect(result.chapters.map((c) => c.title)).toEqual(['Часть 1', 'Часть 2', 'Часть 3', 'Часть 4']);
    expect(result.chapters.every((c) => c.bookId === 'dlinnaya-xyz')).toBe(true);
    expect(result.meta.chapters.map((c) => c.id)).toEqual(result.chapters.map((c) => c.id));
  });

  it('старые главы не меняются', () => {
    expect(result.chapters.slice(0, 2)).toEqual(existing.chapters);
  });

  it('теги объединяются без повторов, summary остаётся старым', () => {
    expect(result.meta.tags).toEqual(['стоики', 'новый-тег']);
    expect(result.meta.summary).toBe('Старое описание');
  });

  it('id, createdAt, addedAt, favorite сохраняются; updatedAt = now', () => {
    expect(result.meta.id).toBe('dlinnaya-xyz');
    expect(result.meta.createdAt).toBe(77);
    expect(result.meta.addedAt).toBe(existing.meta.addedAt);
    expect(result.meta.favorite).toBe(true);
    expect(result.meta.updatedAt).toBe(T1);
  });

  it('счётчики и contentHash пересчитаны по всему тексту', () => {
    expect(result.meta.words).toBe(result.chapters.reduce((s, c) => s + c.words, 0));
    expect(result.meta.words).toBeGreaterThan(existing.meta.words);
    expect(result.meta.contentHash).toBe(contentHashOf(result.chapters));
    expect(result.meta.contentHash).not.toBe(existing.meta.contentHash);
  });

  it('если у книги не было описания, берётся описание продолжения', () => {
    const noSummary = { meta: { ...existing.meta, summary: '' }, chapters: existing.chapters };
    expect(applyResolution(noSummary, incoming, 'append', T1).meta.summary).toBe('Описание продолжения');
  });
});
