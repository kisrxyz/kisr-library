import { describe, expect, it } from 'vitest';
import { excerpt, highlightParts, searchBooks, searchText, TEXT_LIMIT } from './search';
import type { BookMeta, Chapter } from './types';

function book(patch: Partial<BookMeta> & { id: string }): BookMeta {
  return {
    title: 'Книга',
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    origin: 'paste',
    createdAt: 1,
    addedAt: 1,
    updatedAt: 1,
    words: 100,
    cards: 0,
    tasks: 0,
    chapters: [],
    contentHash: 'h',
    favorite: false,
    ...patch,
  };
}

function chapter(md: string, patch: Partial<Chapter> = {}): Chapter {
  return { id: 'b--01', bookId: 'b', order: 1, title: 'Глава 1', md, words: 10, ...patch };
}

describe('searchBooks', () => {
  it('«ёжик» находит «Ежик» и наоборот', () => {
    const list = [book({ id: 'a', title: 'Ежик в тумане' }), book({ id: 'b', title: 'Ёжик и медвежонок' })];
    expect(searchBooks(list, 'ёжик').map((b) => b.id)).toEqual(['a', 'b']);
    expect(searchBooks(list, 'ЕЖИК').map((b) => b.id)).toEqual(['a', 'b']);
    expect(searchBooks([list[0]], 'Ёжик')).toHaveLength(1);
  });

  it('совпадение в названии выше, чем в описании; теги и раздел — между ними', () => {
    const list = [
      book({ id: 'summary', title: 'Другое', summary: 'Здесь про стоицизм' }),
      book({ id: 'tag', title: 'Третье', tags: ['стоицизм'] }),
      book({ id: 'category', title: 'Четвёртое', category: 'Стоицизм' }),
      book({ id: 'title', title: 'Стоицизм для всех' }),
      book({ id: 'none', title: 'Без совпадений' }),
    ];
    const ids = searchBooks(list, 'стоицизм').map((b) => b.id);
    expect(ids[0]).toBe('title');
    expect(ids.at(-1)).toBe('summary');
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('none');
  });

  it('вес складывается по полям: название + описание выше одного названия', () => {
    const list = [
      book({ id: 'one', title: 'Сенека' }),
      book({ id: 'two', title: 'Сенека', summary: 'Письма Сенеки' }),
    ];
    expect(searchBooks(list, 'сенек').map((b) => b.id)).toEqual(['two', 'one']);
  });

  it('равный вес — порядок как в списке', () => {
    const list = [book({ id: 'x', title: 'Море' }), book({ id: 'y', title: 'Море' }), book({ id: 'z', title: 'Море' })];
    expect(searchBooks(list, 'море').map((b) => b.id)).toEqual(['x', 'y', 'z']);
  });

  it('несколько слов: каждое должно найтись, но в разных полях', () => {
    const list = [
      book({ id: 'a', title: 'Письма', tags: ['сенека'] }),
      book({ id: 'b', title: 'Письма' }),
      book({ id: 'c', title: 'Сенека' }),
    ];
    expect(searchBooks(list, 'письма сенека').map((b) => b.id)).toEqual(['a']);
  });

  it('пустой запрос и пустая разметка — ничего', () => {
    const list = [book({ id: 'a', title: 'Что-то' })];
    expect(searchBooks(list, '')).toEqual([]);
    expect(searchBooks(list, '   ')).toEqual([]);
    expect(searchBooks(list, '#*_')).toEqual([]);
  });

  it('не меняет переданный список', () => {
    const list = [book({ id: 'a', title: 'Море', summary: 'море' }), book({ id: 'b', title: 'Лес море' })];
    const copy = [...list];
    searchBooks(list, 'море');
    expect(list).toEqual(copy);
  });
});

describe('searchText', () => {
  it('match — исходное написание, а не нормализованное', () => {
    const [hit] = searchText([chapter('Жил-был Ёжик у реки.')], 'ежик');
    expect(hit.match).toBe('Ёжик');
    expect(hit.before).toBe('Жил-был ');
    expect(hit.after).toBe(' у реки.');
  });

  it('«ёжик» находит «ежик» в тексте', () => {
    const [hit] = searchText([chapter('Маленький ЕЖИК спал.')], 'Ёжик');
    expect(hit.match).toBe('ЕЖИК');
  });

  it('контекст — по 60 символов с каждой стороны исходного текста', () => {
    const left = 'а'.repeat(100);
    const right = 'б'.repeat(100);
    const [hit] = searchText([chapter(`${left} цель ${right}`)], 'цель');
    expect(hit.before).toBe(`${'а'.repeat(59)} `);
    expect(hit.before).toHaveLength(60);
    expect(hit.match).toBe('цель');
    expect(hit.after).toHaveLength(60);
    expect(hit.after).toBe(` ${'б'.repeat(59)}`);
  });

  it('в начале и конце главы контекст короче', () => {
    const [hit] = searchText([chapter('цель близко')], 'цель');
    expect(hit.before).toBe('');
    expect(hit.after).toBe(' близко');
  });

  it('разметка не мешает: поиск идёт по plainText', () => {
    const [hit] = searchText([chapter('Это **очень важная** мысль и [ссылка](http://x.y) тоже.')], 'очень важная');
    expect(hit.match).toBe('очень важная');
    expect(hit.before).toBe('Это ');
    expect(searchText([chapter('Это [ссылка](http://x.y) тоже.')], 'ссылка тоже')[0].match).toBe('ссылка тоже');
  });

  it('маркеры списка не попадают в сниппет: «Сенека», а не «- Сенека»', () => {
    const [hit] = searchText([chapter('Стоики:\n- Сенека\n- Эпиктет\n- Марк Аврелий')], 'эпиктет');
    expect(hit.before).toBe('Стоики: Сенека ');
    expect(hit.match).toBe('Эпиктет');
    expect(hit.after).toBe(' Марк Аврелий');
  });

  it('перевод строки между словами считается пробелом, в сниппете это пробел', () => {
    const [hit] = searchText([chapter('Первая строка\nвторая строка')], 'строка вторая');
    expect(hit.match).toBe('строка вторая');
    const [two] = searchText([chapter('Первая строка\nвторая строка')], 'первая строка вторая');
    expect(two.match).toBe('Первая строка вторая');
  });

  it('не больше 3 совпадений на главу, без пересечений', () => {
    const hits = searchText([chapter('слово. слово. слово. слово. слово.')], 'слово');
    expect(hits).toHaveLength(3);
    expect(searchText([chapter('аааааа')], 'аа')).toHaveLength(3);
  });

  it('данные главы переходят в результат', () => {
    const [hit] = searchText([chapter('Тут цель.', { bookId: 'zz', order: 4, title: 'Четвёртая' })], 'цель');
    expect(hit).toMatchObject({ bookId: 'zz', chapter: 4, chapterTitle: 'Четвёртая', match: 'цель' });
  });

  it('запрос короче 2 символов — пусто', () => {
    const chapters = [chapter('а а а а а')];
    expect(searchText(chapters, 'а')).toEqual([]);
    expect(searchText(chapters, ' а ')).toEqual([]);
    expect(searchText(chapters, '')).toEqual([]);
    expect(searchText(chapters, '**')).toEqual([]);
    expect(searchText(chapters, 'аа').length).toBe(0); // «аа» в тексте нет
  });

  it('лимит общий для всех глав и по умолчанию 50', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      chapter('цель, цель, цель', { id: `b--${i}`, order: i + 1 }),
    );
    expect(TEXT_LIMIT).toBe(50);
    expect(searchText(many, 'цель')).toHaveLength(50);
    expect(searchText(many, 'цель', 5)).toHaveLength(5);
    expect(searchText(many, 'цель', 0)).toEqual([]);
  });

  it('порядок глав сохраняется', () => {
    const list = [chapter('цель', { order: 2 }), chapter('цель', { order: 1 })];
    expect(searchText(list, 'цель').map((h) => h.chapter)).toEqual([2, 1]);
  });

  it('символы, у которых строчная форма длиннее (İ), не сдвигают совпадение', () => {
    const [hit] = searchText([chapter('İstanbul и Ёжик')], 'ежик');
    expect(hit.match).toBe('Ёжик');
    expect(hit.before).toBe('İstanbul и ');
  });

  it('повторный поиск по тем же главам даёт тот же результат', () => {
    const list = [chapter('Один Ёжик, второй ёжик.')];
    const first = searchText(list, 'ежик');
    expect(searchText(list, 'ежик')).toEqual(first);
    expect(first.map((h) => h.match)).toEqual(['Ёжик', 'ёжик']);
  });

  it('спецсимволы регулярных выражений в запросе — обычный текст', () => {
    const [hit] = searchText([chapter('Цена (в рублях) растёт. Что? Да.')], '(в рублях)');
    expect(hit.match).toBe('(в рублях)');
    expect(searchText([chapter('Что? Да.')], 'что? да')[0].match).toBe('Что? Да');
    expect(searchText([chapter('abc')], '.*')).toEqual([]);
  });
});

describe('highlightParts', () => {
  const joined = (parts: { text: string; hit: boolean }[]) => parts.map((p) => p.text).join('');

  it('делит строку на куски, исходное написание сохраняется', () => {
    expect(highlightParts('Ёжик в тумане', 'ежик')).toEqual([
      { text: 'Ёжик', hit: true },
      { text: ' в тумане', hit: false },
    ]);
  });

  it('все слова запроса, в любом месте, без пересечений', () => {
    const parts = highlightParts('Письма Сенеки о письмах', 'пись сенек');
    expect(joined(parts)).toBe('Письма Сенеки о письмах');
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['Пись', 'Сенек', 'пись']);
  });

  it('нет совпадений — один кусок; пустой запрос — тоже', () => {
    expect(highlightParts('Море', 'лес')).toEqual([{ text: 'Море', hit: false }]);
    expect(highlightParts('Море', '')).toEqual([{ text: 'Море', hit: false }]);
    expect(highlightParts('', 'лес')).toEqual([]);
  });

  it('однобуквенное слово запроса не подсвечивается, если есть длиннее', () => {
    const parts = highlightParts('Войны и мир', 'войны и мир');
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['Войны', 'мир']);
  });
});

describe('excerpt', () => {
  it('найденное близко к началу — строка целиком', () => {
    expect(excerpt('Письма Сенеки о счастье', 'сенек')).toBe('Письма Сенеки о счастье');
  });

  it('нет совпадений — строка целиком', () => {
    expect(excerpt('Письма о счастье', 'море')).toBe('Письма о счастье');
  });

  it('найденное далеко — начало отрезается по границе слова и ставится «…»', () => {
    const text = 'Это очень длинное описание книги, в котором нужное слово стоит ближе к концу, чем к началу.';
    const cut = excerpt(text, 'нужное', 20);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut).toContain('нужное слово стоит');
    expect(text.endsWith(cut.slice(1))).toBe(true);
    // начинается с целого слова
    expect(text).toContain(` ${cut.slice(1)}`);
  });
});
