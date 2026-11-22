// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goBack, navDirection, navigate, parseHash, rememberScroll, restoreScroll, route, toHash, type Route } from './router';

const library = (query = ''): Route => ({ name: 'library', params: new URLSearchParams(query) });

// jsdom переходит по истории асинхронно (как и браузер)
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('parseHash', () => {
  it('разбирает маршруты из адреса', () => {
    expect(parseHash('')).toEqual({ name: 'library', params: new URLSearchParams() });
    expect(parseHash('#/book/vredno-li-begat-mwkkoeik')).toEqual({ name: 'book', id: 'vredno-li-begat-mwkkoeik' });
    expect(parseHash('#/read/abc/3?find=%D0%BC%D0%B8%D1%84')).toEqual({ name: 'read', id: 'abc', chapter: 3, find: 'миф' });
    expect(parseHash('#/read/abc')).toMatchObject({ name: 'read', id: 'abc', chapter: 1 });
    expect(parseHash('#/read/abc/2?b=p1i6upg5')).toMatchObject({ chapter: 2, block: 'p1i6upg5' });
    expect(parseHash('#/notes?tab=actions')).toEqual({ name: 'notes', tab: 'actions' });
    expect(parseHash('#/add?shared=1')).toEqual({ name: 'add', shared: true });
    expect(parseHash('#/nonsense')).toMatchObject({ name: 'library' });
  });

  it('подставляет значения по умолчанию', () => {
    expect(parseHash('#/')).toEqual(library());
    expect(parseHash('#/?status=reading&cat=Философия')).toEqual(library('status=reading&cat=Философия'));
    expect(parseHash('#/search')).toEqual({ name: 'search', q: '' });
    expect(parseHash('#/search?q=ёжик')).toEqual({ name: 'search', q: 'ёжик' });
    expect(parseHash('#/add')).toEqual({ name: 'add', shared: false });
    expect(parseHash('#/notes')).toEqual({ name: 'notes', tab: 'marks' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });

  it('прощает кривые адреса', () => {
    expect(parseHash('#/notes?tab=xyz')).toEqual({ name: 'notes', tab: 'marks' });
    expect(parseHash('#/read/abc/0')).toMatchObject({ chapter: 1 });
    expect(parseHash('#/read/abc/два')).toMatchObject({ chapter: 1 });
    expect(parseHash('#/read/abc/3?find=')).toEqual({ name: 'read', id: 'abc', chapter: 3 });
    expect(parseHash('#/book/')).toMatchObject({ name: 'library' });
    expect(parseHash('#/read')).toMatchObject({ name: 'library' });
    expect(parseHash('#/book/%E0%A4%A')).toMatchObject({ name: 'library' });
    expect(parseHash('#/nonsense?status=reading')).toEqual(library());
    expect(parseHash('/book/x')).toEqual({ name: 'book', id: 'x' });
    expect(parseHash('#/settings/')).toEqual({ name: 'settings' });
  });
});

describe('toHash', () => {
  it('туда-обратно даёт тот же маршрут', () => {
    const fromBrief = [
      '',
      '#/book/vredno-li-begat-mwkkoeik',
      '#/read/abc/3?find=%D0%BC%D0%B8%D1%84',
      '#/read/abc',
      '#/read/abc/2?b=p1i6upg5',
      '#/notes?tab=actions',
      '#/add?shared=1',
      '#/nonsense',
    ].map(parseHash);
    const more: Route[] = [
      library('status=reading&cat=Философия&sort=title'),
      { name: 'book', id: 'книга с пробелом' },
      { name: 'read', id: 'abc', chapter: 12, find: 'a & b #1?', block: 'p1i6upg5' },
      { name: 'search', q: '' },
      { name: 'search', q: 'ёжик в тумане' },
      { name: 'add', shared: false },
      { name: 'notes', tab: 'marks' },
      { name: 'settings' },
    ];
    for (const r of [...fromBrief, ...more]) expect(parseHash(toHash(r))).toEqual(r);
  });

  it('пишет короткие адреса без значений по умолчанию', () => {
    expect(toHash(library())).toBe('#/');
    expect(toHash({ name: 'book', id: 'x' })).toBe('#/book/x');
    expect(toHash({ name: 'read', id: 'abc', chapter: 2, block: 'p1i6upg5' })).toBe('#/read/abc/2?b=p1i6upg5');
    expect(toHash({ name: 'notes', tab: 'marks' })).toBe('#/notes');
    expect(toHash({ name: 'add', shared: true })).toBe('#/add?shared=1');
  });
});

// Сценарий идёт по одной истории браузера: тесты зависят от порядка.
describe('навигация', () => {
  it('стартует с маршрута из адреса', () => {
    expect(route.value).toEqual(library());
    expect(navDirection.value).toBe('initial');
  });

  it('navigate добавляет запись, а replace — заменяет текущую', () => {
    const start = history.length;
    navigate({ name: 'book', id: 'x' });
    expect(navDirection.value).toBe('push');
    expect(location.hash).toBe('#/book/x');
    expect(route.value).toEqual({ name: 'book', id: 'x' });
    expect(history.length).toBe(start + 1);

    navigate('#/search?q=миф', { replace: true });
    expect(navDirection.value).toBe('replace');
    expect(route.value).toEqual({ name: 'search', q: 'миф' });
    expect(history.length).toBe(start + 1);

    navigate({ name: 'search', q: 'миф' });
    expect(history.length).toBe(start + 1);
  });

  it('goBack возвращается назад, если до этого был экран приложения', async () => {
    goBack({ name: 'settings' });
    await settle();
    expect(route.value).toEqual(library());
    expect(navDirection.value).toBe('pop');
  });

  it('goBack без своей истории открывает запасной маршрут вместо текущего', () => {
    const start = history.length;
    goBack({ name: 'notes', tab: 'actions' });
    expect(navDirection.value).toBe('replace');
    expect(route.value).toEqual({ name: 'notes', tab: 'actions' });
    expect(location.hash).toBe('#/notes?tab=actions');
    expect(history.length).toBe(start);
  });

  it('переход по обычной ссылке тоже попадает в историю приложения', async () => {
    location.hash = '#/book/y';
    await settle();
    expect(route.value).toEqual({ name: 'book', id: 'y' });
    // popstate и hashchange приходят на один переход: второй не превращает «вперёд» в «назад»
    expect(navDirection.value).toBe('push');

    goBack(library());
    await settle();
    expect(route.value).toEqual({ name: 'notes', tab: 'actions' });
    expect(navDirection.value).toBe('pop');
  });
});

describe('прокрутка', () => {
  function spies() {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const scrollY = vi.spyOn(window, 'scrollY', 'get');
    return { scrollTo, scrollY };
  }

  afterEach(() => vi.restoreAllMocks());

  it('«назад» возвращает запомненную позицию экрана', async () => {
    const { scrollTo, scrollY } = spies();
    navigate('#/book/scroll-a');
    scrollY.mockReturnValue(640);
    rememberScroll('book:scroll-a');
    navigate('#/read/scroll-a/1');
    scrollY.mockReturnValue(1200);
    rememberScroll('read:scroll-a');

    history.back();
    await settle();
    expect(navDirection.value).toBe('pop');
    expect(route.value).toEqual({ name: 'book', id: 'scroll-a' });
    restoreScroll('book:scroll-a');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640);
    // экран, которого не запоминали, открывается сверху
    restoreScroll('никогда не был');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('новый переход (navigate, ссылка) открывает экран с начала, даже если позиция запомнена', async () => {
    const { scrollTo, scrollY } = spies();
    scrollY.mockReturnValue(900);
    rememberScroll('book:scroll-a');

    navigate('#/book/scroll-b');
    expect(navDirection.value).toBe('push');
    navigate('#/book/scroll-a');
    restoreScroll('book:scroll-a');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    location.hash = '#/book/scroll-c';
    await settle();
    expect(navDirection.value).toBe('push');
    restoreScroll('book:scroll-a');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    navigate('#/book/scroll-d', { replace: true });
    expect(navDirection.value).toBe('replace');
    restoreScroll('book:scroll-a');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('после «назад» запомненная позиция снова доступна, а следующий переход вперёд её не берёт', async () => {
    const { scrollTo, scrollY } = spies();
    scrollY.mockReturnValue(300);
    rememberScroll('library');

    history.back();
    await settle();
    expect(navDirection.value).toBe('pop');
    restoreScroll('library');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 300);

    navigate('#/settings');
    restoreScroll('library');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });
});
