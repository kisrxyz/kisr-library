import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBook, callNumbers, contentHashOf, isServiceChapter } from './book';
import { parseBook, reassemble } from './parse';
import { slug } from './text';
import type { BookMeta } from './types';

const full = readFileSync(join(__dirname, '__fixtures__', 'full.md'), 'utf8');
const NOW = 1794890055494;

describe('buildBook', () => {
  const parsed = parseBook(full);
  const { meta, chapters } = buildBook(parsed, { origin: 'paste', now: NOW });

  it('id начинается со slug названия, главы — id--NN с order от 1', () => {
    expect(meta.id.startsWith(slug(parsed.title))).toBe(true);
    expect(meta.id).toBe(`${slug(parsed.title)}-mwk772h2`);
    expect(chapters[0].id).toBe(`${meta.id}--01`);
    expect(chapters.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(chapters.every((c) => c.bookId === meta.id)).toBe(true);
    expect(meta.chapters.map((c) => c.id)).toEqual(chapters.map((c) => c.id));
  });

  it('считает слова, карточки и задачи', () => {
    expect(meta.words).toBe(chapters.reduce((s, c) => s + c.words, 0));
    expect(meta.words).toBeGreaterThan(0);
    expect(meta.cards).toBe(3);
    expect(meta.tasks).toBe(2);
    expect(meta.chapters.map((c) => c.words)).toEqual(chapters.map((c) => c.words));
  });

  it('переносит поля шапки и ставит служебные', () => {
    expect(meta.title).toBe('Как заварить хороший чай');
    expect(meta.category).toBe('Быт');
    expect(meta.tags).toEqual(['чай', 'кухня', 'привычки']);
    expect(meta.level).toBe('базовый');
    expect(meta.origin).toBe('paste');
    expect(meta.favorite).toBe(false);
    expect(meta.createdAt).toBe(NOW);
    expect(meta.addedAt).toBe(NOW);
    expect(meta.updatedAt).toBe(NOW);
    expect(meta.action).toBeUndefined();
  });

  it('пустой раздел становится «Разное», level без значения не попадает в запись', () => {
    const b = buildBook(parseBook('# Т\n\n## Г\nтекст'), { origin: 'file', now: NOW });
    expect(b.meta.category).toBe('Разное');
    expect('level' in b.meta).toBe(false);
  });

  it('уважает id и createdAt из параметров', () => {
    const b = buildBook(parsed, { origin: 'migration', id: 'old-id', now: NOW, createdAt: 5 });
    expect(b.meta.id).toBe('old-id');
    expect(b.chapters[1].id).toBe('old-id--02');
    expect(b.meta.createdAt).toBe(5);
    expect(b.meta.addedAt).toBe(NOW);
  });

  it('contentHash: тот же текст — тот же хеш, одна буква — другой', () => {
    const again = buildBook(parseBook(full), { origin: 'paste', now: NOW + 1000 });
    expect(again.meta.contentHash).toBe(meta.contentHash);
    const changed = buildBook(parseBook(full.replace('Чай кажется', 'Чай кажеться')), { origin: 'paste', now: NOW });
    expect(changed.meta.contentHash).not.toBe(meta.contentHash);
  });

  it('contentHashOf считается по названиям и тексту глав', () => {
    const a = contentHashOf([{ title: 'А', md: 'один' }]);
    expect(contentHashOf([{ title: 'А', md: 'один' }])).toBe(a);
    expect(contentHashOf([{ title: 'Б', md: 'один' }])).not.toBe(a);
  });

  it('нумерует больше 99 глав без обрезки', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ title: `Г${i}`, md: 'т' }));
    const b = buildBook({ ...parsed, chapters: many }, { origin: 'paste', now: NOW });
    expect(b.chapters[8].id.endsWith('--09')).toBe(true);
    expect(b.chapters[100].id.endsWith('--101')).toBe(true);
  });
});

describe('isServiceChapter', () => {
  it('Источники, Литература, Карточки — служебные', () => {
    expect(isServiceChapter('Источники')).toBe(true);
    expect(isServiceChapter('карточки')).toBe(true);
    expect(isServiceChapter('Литература')).toBe(true);
    expect(isServiceChapter('Коротко')).toBe(false);
    expect(isServiceChapter('Источники и методы')).toBe(false);
  });
});

describe('callNumbers', () => {
  const book = (id: string, category: string, createdAt: number) => ({ id, category, createdAt }) as BookMeta;

  it('код раздела и номер по createdAt внутри раздела', () => {
    const nums = callNumbers([book('b', 'Философия', 2), book('a', 'Философия', 1)]);
    expect(nums.get('a')).toBe('ФИЛ·01');
    expect(nums.get('b')).toBe('ФИЛ·02');
  });
  it('разделы нумеруются отдельно, пустой раздел — «Разное», без букв — КН', () => {
    const nums = callNumbers([
      book('a', 'Философия', 1),
      book('b', 'Здоровье и бег', 2),
      book('c', '', 3),
      book('d', '!!!', 4),
      book('e', 'Философия', 5),
    ]);
    expect(nums.get('a')).toBe('ФИЛ·01');
    expect(nums.get('b')).toBe('ЗДО·01');
    expect(nums.get('c')).toBe('РАЗ·01');
    expect(nums.get('d')).toBe('КН·01');
    expect(nums.get('e')).toBe('ФИЛ·02');
  });
  it('не меняет переданный массив', () => {
    const list = [book('b', 'Х', 2), book('a', 'Х', 1)];
    callNumbers(list);
    expect(list.map((b) => b.id)).toEqual(['b', 'a']);
  });
});

const rawArticles = join(process.cwd(), 'migration', 'raw', 'articles');
const rawSections = join(process.cwd(), 'migration', 'raw', 'sections');

describe.skipIf(!existsSync(rawSections) || !existsSync(rawArticles))(
  'buildBook: счётчики совпадают со старым приложением (личные данные, мимо git)',
  () => {
    it('слова, карточки и id глав у каждой старой книги те же', () => {
      type Section = { articleId: string; order: number; title: string; md: string };
      const sections = readdirSync(rawSections)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(rawSections, f), 'utf8')) as Section);
      const files = readdirSync(rawArticles).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const old = JSON.parse(readFileSync(join(rawArticles, file), 'utf8')) as {
          title: string;
          category: string;
          tags: string[];
          summary: string;
          source: string;
          words: number;
          cards: number;
          createdAt: number;
          sections: { id: string; title: string; words: number }[];
        };
        const id = file.replace(/\.json$/, '');
        const chapters = sections
          .filter((s) => s.articleId === id)
          .sort((x, y) => x.order - y.order)
          .map((s) => ({ title: s.title, md: s.md }));
        const { meta } = buildBook(parseBook(reassemble(old, chapters)), {
          origin: 'migration',
          id,
          now: 1,
          createdAt: old.createdAt,
        });
        expect({ id, words: meta.words, cards: meta.cards, chapters: meta.chapters }).toEqual({
          id,
          words: old.words,
          cards: old.cards,
          chapters: old.sections,
        });
      }
    });
  },
);
