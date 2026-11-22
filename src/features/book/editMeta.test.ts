import { describe, expect, it } from 'vitest';
import { sampleBook } from '../../db/testing';
import { buildMetaPatch, parseTags, tagsToText } from './editMeta';

describe('parseTags', () => {
  it('делит по запятым, обрезает пробелы и пустые', () => {
    expect(parseTags(' сон,  привычки ,, внимание ')).toEqual(['сон', 'привычки', 'внимание']);
  });

  it('понимает и точку с запятой, и перенос строки', () => {
    expect(parseTags('сон; привычки\nвнимание')).toEqual(['сон', 'привычки', 'внимание']);
  });

  it('убирает решётку в начале и повторы без учёта регистра', () => {
    expect(parseTags('#сон, Сон, #привычки, сон')).toEqual(['сон', 'привычки']);
  });

  it('пустая строка — нет тегов', () => {
    expect(parseTags('  , ')).toEqual([]);
  });
});

describe('tagsToText', () => {
  it('склеивает через запятую с пробелом', () => {
    expect(tagsToText(['сон', 'привычки'])).toBe('сон, привычки');
  });
});

describe('buildMetaPatch', () => {
  const { meta } = sampleBook('Тихая работа', 2, { id: 'tihaya', category: 'Психология' });
  const book = { ...meta, tags: ['сон', 'привычки'] };
  const known = ['Психология', 'Здоровье'];

  it('без изменений — null', () => {
    expect(buildMetaPatch(book, { title: 'Тихая работа', category: 'Психология', tags: 'сон, привычки' }, known)).toBeNull();
  });

  it('меняет только то, что изменилось', () => {
    expect(buildMetaPatch(book, { title: 'Тихая  работа  2 ', category: 'Психология', tags: 'сон, привычки' }, known)).toEqual({
      title: 'Тихая работа 2',
    });
    expect(buildMetaPatch(book, { title: 'Тихая работа', category: 'Здоровье', tags: 'сон' }, known)).toEqual({
      category: 'Здоровье',
      tags: ['сон'],
    });
  });

  it('новый раздел с названием существующего без учёта регистра берёт написание существующего', () => {
    expect(buildMetaPatch(book, { title: 'Тихая работа', category: 'здоровье', tags: 'сон, привычки' }, known)).toEqual({
      category: 'Здоровье',
    });
  });

  it('пустой раздел — «Разное»', () => {
    expect(buildMetaPatch(book, { title: 'Тихая работа', category: '  ', tags: 'сон, привычки' }, known)).toEqual({
      category: 'Разное',
    });
  });

  it('пустое название не принимается', () => {
    expect(buildMetaPatch(book, { title: '   ', category: 'Психология', tags: '' }, known)).toBeNull();
  });
});
