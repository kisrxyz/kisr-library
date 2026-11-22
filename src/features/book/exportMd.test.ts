import { beforeEach, describe, expect, it } from 'vitest';
import { buildBook } from '../../core/book';
import { parseBook } from '../../core/parse';
import { saveBook } from '../../db/books';
import { freshDb } from '../../db/testing';
import { exportBookMd } from './exportMd';

beforeEach(freshDb);

/** Книга с шапкой, введением, обычными и служебной главами — как её даёт Claude. */
function richBook() {
  const intro = Array.from({ length: 45 }, (_, i) => `слово${i}`).join(' ');
  return buildBook(
    {
      title: 'Тихая работа: как думать медленно',
      category: 'Психология',
      tags: ['внимание', 'привычки', 'сон'],
      summary: 'Короткое описание книги.',
      source: 'Конспект по трём книгам',
      level: 'средний',
      chapters: [
        { title: 'Вступление', md: intro },
        { title: 'Первая глава', md: 'Текст первой главы.\n\n- пункт один\n- пункт два' },
        { title: '1.1. Подраздел', md: 'Вложенный заголовок с текстом.' },
        { title: 'Источники', md: '- Книга А\n- Книга Б' },
      ],
      warnings: [],
    },
    { origin: 'paste', id: 'tihaya-rabota-abc', now: 1_700_000_000_000 },
  );
}

describe('exportBookMd', () => {
  it('отдаёт файл, который парсер читает обратно с той же шапкой и главами', async () => {
    const { meta, chapters } = richBook();
    await saveBook(meta, chapters);

    const { name, text } = await exportBookMd(meta.id);
    expect(name).toBe('tihaya-rabota-kak-dumat-medlenno.md');

    const back = parseBook(text);
    expect(back.title).toBe(meta.title);
    expect(back.category).toBe(meta.category);
    expect(back.tags).toEqual(meta.tags);
    expect(back.summary).toBe(meta.summary);
    expect(back.source).toBe(meta.source);
    expect(back.level).toBe('средний');
    expect(back.chapters.map((c) => c.title)).toEqual(chapters.map((c) => c.title));
    expect(back.chapters.map((c) => c.md)).toEqual(chapters.map((c) => c.md));
  });

  it('главы идут по порядку чтения, даже если в базе лежат вперемешку', async () => {
    const { meta, chapters } = richBook();
    await saveBook(meta, [...chapters].reverse());
    const { text } = await exportBookMd(meta.id);
    expect(parseBook(text).chapters.map((c) => c.title)).toEqual(chapters.map((c) => c.title));
  });

  it('берёт название и раздел, исправленные после добавления', async () => {
    const { meta, chapters } = richBook();
    await saveBook({ ...meta, title: 'Новое название', category: 'Разное', tags: [] }, chapters);
    const { name, text } = await exportBookMd(meta.id);
    expect(name).toBe('novoe-nazvanie.md');
    const back = parseBook(text);
    expect(back.title).toBe('Новое название');
    expect(back.category).toBe('Разное');
    expect(back.tags).toEqual([]);
  });

  it('несуществующая книга — ошибка', async () => {
    await expect(exportBookMd('net-takoy')).rejects.toThrow('Книга не найдена');
  });
});
