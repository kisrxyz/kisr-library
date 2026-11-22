import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookMeta, Chapter } from '../../core/types';
import { __resetChaptersForTests, searchLibraryText } from './engine';

function book(id: string, contentHash = 'h'): BookMeta {
  return {
    id,
    title: id,
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    origin: 'paste',
    createdAt: 1,
    addedAt: 1,
    updatedAt: 1,
    words: 10,
    cards: 0,
    tasks: 0,
    chapters: [],
    contentHash,
    favorite: false,
  };
}

function chapters(bookId: string, md = 'в тексте есть слово цель.', count = 1): Chapter[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${bookId}--0${i + 1}`,
    bookId,
    order: i + 1,
    title: `Глава ${i + 1}`,
    md,
    words: 5,
  }));
}

const never = () => false;

beforeEach(() => __resetChaptersForTests());

describe('searchLibraryText: кэш глав', () => {
  it('главы грузятся один раз, а не на каждый запрос', async () => {
    const load = vi.fn(async () => chapters('a'));
    const list = [book('a')];
    expect(await searchLibraryText(list, 'цель', never, { load })).toHaveLength(1);
    expect(await searchLibraryText(list, 'слово', never, { load })).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('параллельные запросы делят одну загрузку', async () => {
    const load = vi.fn(async () => chapters('a'));
    const list = [book('a')];
    await Promise.all([
      searchLibraryText(list, 'цель', never, { load }),
      searchLibraryText(list, 'слово', never, { load }),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('новая книга сбрасывает кэш', async () => {
    const stored = [...chapters('a')];
    const load = vi.fn(async () => [...stored]);
    expect(await searchLibraryText([book('a')], 'цель', never, { load })).toHaveLength(1);

    stored.push(...chapters('b'));
    const hits = await searchLibraryText([book('a'), book('b')], 'цель', never, { load });
    expect(load).toHaveBeenCalledTimes(2);
    expect(hits?.map((h) => h.bookId)).toEqual(['a', 'b']);
  });

  it('обновлённый текст книги (другой contentHash) сбрасывает кэш', async () => {
    let md = 'старая цель';
    const load = vi.fn(async () => chapters('a', md));
    await searchLibraryText([book('a', 'v1')], 'цель', never, { load });
    md = 'новая мысль';
    const hits = await searchLibraryText([book('a', 'v2')], 'мысль', never, { load });
    expect(load).toHaveBeenCalledTimes(2);
    expect(hits).toHaveLength(1);
  });

  it('смена названия или избранного кэш не трогает: у книги тот же текст', async () => {
    const load = vi.fn(async () => chapters('a'));
    await searchLibraryText([book('a')], 'цель', never, { load });
    await searchLibraryText([{ ...book('a'), title: 'Другое', favorite: true, updatedAt: 99 }], 'цель', never, { load });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('удалённая книга пропадает из результата без новой загрузки', async () => {
    const load = vi.fn(async () => [...chapters('a'), ...chapters('b')]);
    expect(await searchLibraryText([book('a'), book('b')], 'цель', never, { load })).toHaveLength(2);
    const hits = await searchLibraryText([book('a')], 'цель', never, { load });
    expect(hits?.map((h) => h.bookId)).toEqual(['a']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('ошибка загрузки не застревает в кэше: следующий запрос пробует снова', async () => {
    const load = vi
      .fn<() => Promise<Chapter[]>>()
      .mockRejectedValueOnce(new Error('нет доступа'))
      .mockResolvedValue(chapters('a'));
    await expect(searchLibraryText([book('a')], 'цель', never, { load })).rejects.toThrow('нет доступа');
    expect(await searchLibraryText([book('a')], 'цель', never, { load })).toHaveLength(1);
  });
});

describe('searchLibraryText: ход поиска', () => {
  it('короткий запрос — пусто и без загрузки глав', async () => {
    const load = vi.fn(async () => chapters('a'));
    expect(await searchLibraryText([book('a')], 'ц', never, { load })).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('устаревший запрос возвращает null', async () => {
    const load = vi.fn(async () => chapters('a'));
    expect(await searchLibraryText([book('a')], 'цель', () => true, { load })).toBeNull();
  });

  it('большая библиотека обрабатывается порциями, лимит соблюдается', async () => {
    const many = Array.from({ length: 450 }, (_, i) => chapters(`b${i}`, 'цель цель цель')[0]);
    const load = async () => many;
    const list = many.map((c) => book(c.bookId));
    const pause = vi.fn(async () => {});
    const hits = await searchLibraryText(list, 'цель', never, { load, pause });
    expect(hits).toHaveLength(50);
    // Лимит набрался на первых порциях: дальше не ищем
    expect(pause.mock.calls.length).toBeLessThanOrEqual(1);

    const rare = await searchLibraryText(list, 'нету такого слова', never, { load, pause });
    expect(rare).toEqual([]);
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('запрос сменился между порциями — поиск бросается', async () => {
    const many = Array.from({ length: 450 }, (_, i) => chapters(`b${i}`, 'ничего')[0]);
    let stale = false;
    const pause = vi.fn(async () => {
      stale = true;
    });
    const result = await searchLibraryText(many.map((c) => book(c.bookId)), 'цель', () => stale, {
      load: async () => many,
      pause,
    });
    expect(result).toBeNull();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('результаты в порядке глав, по книгам', async () => {
    const load = async () => [...chapters('b', 'цель', 2), ...chapters('a', 'цель', 1)];
    const hits = await searchLibraryText([book('a'), book('b')], 'цель', never, { load });
    expect(hits?.map((h) => `${h.bookId}:${h.chapter}`)).toEqual(['b:1', 'b:2', 'a:1']);
  });
});
