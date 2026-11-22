// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBook } from '../../core/book';
import type { BookMeta } from '../../core/types';
import { saveBook } from '../../db/books';
import { freshDb } from '../../db/testing';
import { navDirection, navigate, route } from '../../router';
import { __resetLibraryForTests, books } from '../../state/library';
import { __resetChaptersForTests } from './engine';
import { SearchScreen } from './SearchScreen';

let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  freshDb();
  __resetLibraryForTests();
  __resetChaptersForTests();
  location.hash = '#/search';
  window.scrollTo = vi.fn(); // jsdom не умеет прокручивать
  navDirection.value = 'initial';
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  __resetLibraryForTests();
  navDirection.value = 'initial';
  Reflect.deleteProperty(window, 'scrollY');
});

interface Seed {
  title: string;
  id: string;
  category?: string;
  tags?: string[];
  summary?: string;
  chapters: { title: string; md: string }[];
}

/** Книги в БД и на полке: поиск читает главы из БД, а книги из сигнала. */
async function seed(...specs: Seed[]): Promise<BookMeta[]> {
  const metas: BookMeta[] = [];
  for (const spec of specs) {
    const { meta, chapters } = buildBook(
      {
        title: spec.title,
        category: spec.category ?? 'Философия',
        tags: spec.tags ?? [],
        summary: spec.summary ?? '',
        source: '',
        chapters: spec.chapters,
        warnings: [],
      },
      { origin: 'paste', id: spec.id, now: 1_700_000_000_000 + metas.length },
    );
    await saveBook(meta, chapters);
    metas.push(meta);
  }
  books.value = metas;
  return metas;
}

const STOIC: Seed = {
  id: 'stoa',
  title: 'Стоицизм для занятых',
  category: 'Философия',
  tags: ['сенека', 'практика'],
  summary: 'Как жить спокойно: письма Сенеки в пересказе.',
  chapters: [
    { title: 'Начало', md: 'Сенека писал письма Луцилию. Первое письмо — о времени.' },
    { title: 'Глава 2. Гнев', md: 'Про гнев Сенека написал целую книгу.\n\nА маленький Ёжик здесь ни при чём.' },
  ],
};

const OTHER: Seed = {
  id: 'les',
  title: 'Лес и вода',
  category: 'Природа',
  tags: ['лес'],
  summary: 'Про реки.',
  chapters: [{ title: 'Река', md: 'Ежик пошёл к реке.' }],
};

function mount(q = '') {
  act(() => render(<SearchScreen route={{ name: 'search', q }} />, host));
}

const input = () => host.querySelector<HTMLInputElement>('input[type="search"]')!;
const text = () => host.textContent ?? '';
const heads = () => [...host.querySelectorAll('.sgroup__head')].map((h) => h.textContent);

function type(value: string) {
  act(() => {
    input().value = value;
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Пройти паузу ввода (150 мс) и дождаться поиска по тексту. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(160);
  });
  await vi.waitFor(() => expect(host.querySelector('[aria-busy="true"]')).toBeNull());
  await vi.waitFor(() => expect(host.textContent).not.toContain('Ищу в тексте'));
}

describe('SearchScreen: поле и подсказки', () => {
  it('поле в фокусе, с мобильными настройками, и подсказка до ввода', async () => {
    await seed(STOIC);
    mount();
    const field = input();
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('enterkeyhint')).toBe('search');
    expect(field.getAttribute('autocapitalize')).toBe('off');
    expect(text()).toContain('Ищи по названию, тегам, разделу или по тексту книг');
    expect(host.querySelector('.sfield__clear')).toBeNull();
    expect(heads()).toEqual([]);
  });

  it('пустая библиотека — «Искать пока негде»', () => {
    mount();
    expect(text()).toContain('Искать пока негде');
    expect(host.querySelector('input')).toBeNull();
  });

  it('одна буква — просим ещё одну, ничего не ищем', async () => {
    await seed(STOIC);
    mount();
    type('с');
    await settle();
    expect(text()).toContain('Ещё одну букву');
    expect(heads()).toEqual([]);
  });

  it('ничего не нашлось', async () => {
    await seed(STOIC);
    mount();
    type('квазар');
    await settle();
    expect(text()).toContain('Ничего не нашлось');
    expect(text()).toContain('«квазар»');
  });
});

describe('SearchScreen: запрос из адреса и ввод', () => {
  it('запрос из адреса подставлен в поле и ищется сразу, без паузы', async () => {
    await seed(STOIC, OTHER);
    mount('сенека');
    expect(input().value).toBe('сенека');
    await vi.waitFor(() => expect(heads()).toEqual(['Книги · 1', 'В тексте · 2']));
  });

  it('ввод ищет после паузы 150 мс и записывает запрос в адрес без новой записи истории', async () => {
    await seed(STOIC, OTHER);
    mount();
    const entries = history.length;
    type('сенек');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(heads()).toEqual([]);
    expect(location.hash).toBe('#/search');

    await settle();
    expect(heads()).toEqual(['Книги · 1', 'В тексте · 2']);
    expect(location.hash).toBe('#/search?q=%D1%81%D0%B5%D0%BD%D0%B5%D0%BA');
    expect(history.length).toBe(entries);
  });

  it('ушли с экрана посреди паузы ввода (нажали на результат) — запоздавшая пауза не возвращает в поиск', async () => {
    await seed(STOIC, OTHER);
    mount();
    type('сенек');
    // Адрес уже читалки, а экран поиска ещё не убран: таймер паузы срабатывает в этот момент
    act(() => navigate('#/read/stoa/1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(location.hash).toBe('#/read/stoa/1');
    expect(route.value.name).toBe('read');
  });

  it('быстрый ввод: ищется только последний запрос', async () => {
    await seed(STOIC, OTHER);
    mount();
    type('ле');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    type('лес');
    await settle();
    expect(heads()).toEqual(['Книги · 1']);
    expect(host.querySelector('.sbook__title')?.textContent).toBe('Лес и вода');
  });

  it('«×» очищает поле, возвращает фокус и убирает запрос из адреса', async () => {
    await seed(STOIC);
    mount('сенека');
    await vi.waitFor(() => expect(heads().length).toBe(2));
    const clear = host.querySelector<HTMLButtonElement>('.sfield__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Очистить');
    input().blur();
    act(() => clear.click());
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(location.hash).toBe('#/search');
    await settle();
    expect(heads()).toEqual([]);
    expect(text()).toContain('Что ищем?');
  });

  it('Enter ищет сразу и убирает клавиатуру', async () => {
    await seed(STOIC);
    mount();
    type('гнев');
    act(() => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).not.toBe(input());
    await vi.waitFor(() => expect(heads()).toEqual(['В тексте · 1']));
  });

  it('адрес изменил кто-то другой (тег, вкладка): поле и результаты следуют за ним', async () => {
    await seed(STOIC, OTHER);
    mount('сенека');
    await vi.waitFor(() => expect(heads().length).toBe(2));
    act(() => render(<SearchScreen route={{ name: 'search', q: 'лес' }} />, host));
    expect(input().value).toBe('лес');
    await vi.waitFor(() => expect(host.querySelector('.sbook__title')?.textContent).toBe('Лес и вода'));
  });
});

describe('SearchScreen: результаты', () => {
  it('книга: шифр, раздел, название и найденное подсвечены, ссылка на страницу книги', async () => {
    await seed(STOIC, OTHER);
    mount('стоицизм');
    await vi.waitFor(() => expect(host.querySelector('.sbook')).not.toBeNull());
    const card = host.querySelector<HTMLAnchorElement>('.sbook')!;
    expect(card.getAttribute('href')).toBe('#/book/stoa');
    expect(card.querySelector('mark')?.textContent).toBe('Стоицизм');
    expect(card.querySelector('.sbook__callno')?.textContent).toBe('ФИЛ·01');
    expect(card.querySelector('.sbook__cat')?.textContent).toBe('Философия');
    expect(card.querySelector('.sbook__meta')?.textContent).toMatch(/≈\s*\d+\s*мин · 2\s*главы/);
  });

  it('если нашлось в теге или описании — они видны с подсветкой', async () => {
    await seed(STOIC);
    mount('практик');
    await vi.waitFor(() => expect(host.querySelector('.sbook__tags')).not.toBeNull());
    expect(host.querySelector('.sbook__tags mark')?.textContent).toBe('практик');
    expect(host.querySelector('.sbook__sum')).toBeNull();

    mount('письма');
    await vi.waitFor(() => expect(host.querySelector('.sbook__sum')).not.toBeNull());
    expect(host.querySelector('.sbook__sum mark')?.textContent).toBe('письма');
  });

  it('место в тексте: книга, глава, фрагмент с исходным написанием и ссылка в читалку', async () => {
    await seed(STOIC, OTHER);
    mount('ёжик');
    await vi.waitFor(() => expect(host.querySelectorAll('.shit').length).toBe(2));
    const hits = [...host.querySelectorAll<HTMLAnchorElement>('.shit')];
    const stoic = hits.find((h) => h.getAttribute('href')?.startsWith('#/read/stoa'))!;
    expect(stoic.getAttribute('href')).toBe(`#/read/stoa/2?find=${encodeURIComponent('ёжик')}`);
    expect(stoic.querySelector('.shit__book')?.textContent).toBe('Стоицизм для занятых');
    // название главы уже с номером — второй номер не добавляем
    expect(stoic.querySelector('.shit__chapter')?.textContent).toBe('Глава 2. Гнев');
    expect(stoic.querySelector('mark')?.textContent).toBe('Ёжик');
    expect(stoic.querySelector('.shit__snip')?.textContent).toContain('А маленький Ёжик здесь ни при чём.');

    const other = hits.find((h) => h.getAttribute('href')?.startsWith('#/read/les'))!;
    expect(other.querySelector('.shit__chapter')?.textContent).toBe('Глава 1 · Река');
    expect(other.querySelector('mark')?.textContent).toBe('Ежик');
  });

  it('ссылка в читалку несёт запрос без лишних пробелов', async () => {
    await seed(STOIC);
    mount('  письма   Луцилию ');
    await vi.waitFor(() => expect(host.querySelector('.shit')).not.toBeNull());
    expect(host.querySelector('.shit')!.getAttribute('href')).toBe(
      `#/read/stoa/1?${new URLSearchParams({ find: 'письма Луцилию' })}`,
    );
    expect(host.querySelector('.shit mark')?.textContent).toBe('письма Луцилию');
  });

  it('много совпадений: «50+» и пояснение', async () => {
    await seed({
      id: 'many',
      title: 'Повторы',
      chapters: Array.from({ length: 20 }, (_, i) => ({ title: `Часть ${i + 1}`, md: 'цель, цель, цель и ещё цель.' })),
    });
    mount('цель');
    await vi.waitFor(() => expect(heads()).toContain('В тексте · 50+'));
    expect(host.querySelectorAll('.shit').length).toBe(50);
    expect(text()).toContain('Показаны первые 50 мест');
  });

  it('книг больше 30 — остальные по кнопке', async () => {
    await seed(
      ...Array.from({ length: 35 }, (_, i) => ({
        id: `b${i}`,
        title: `Море ${i}`,
        chapters: [{ title: 'Глава', md: 'Текст.' }],
      })),
    );
    mount('море');
    await vi.waitFor(() => expect(host.querySelectorAll('.sbook').length).toBe(30));
    expect(heads()[0]).toBe('Книги · 35');
    const more = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Показать все'))!;
    act(() => more.click());
    expect(host.querySelectorAll('.sbook').length).toBe(35);
  });

  it('книга, удалённая с полки, не попадает в результаты, хотя её главы ещё в БД', async () => {
    const [stoa] = await seed(STOIC, OTHER);
    mount('ежик');
    await vi.waitFor(() => expect(host.querySelectorAll('.shit').length).toBe(2));
    // Окно «Вернуть»: с полки книга уже убрана, из БД — ещё нет
    act(() => {
      books.value = books.value.filter((b) => b.id !== stoa.id);
    });
    await vi.waitFor(() => expect(host.querySelectorAll('.shit').length).toBe(1));
    expect(host.querySelector('.shit__book')?.textContent).toBe('Лес и вода');
  });
});

describe('SearchScreen: прокрутка', () => {
  const setScrollY = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

  /** Открыть поиск, дождаться результатов, пролистать до `y` и уйти с экрана — прокрутка запомнена. */
  async function leaveScrolled(y: number, q = 'сенека') {
    mount(q);
    await vi.waitFor(() => expect(host.querySelectorAll('.shit').length).toBeGreaterThan(0));
    setScrollY(y);
    act(() => render(null, host));
    vi.mocked(window.scrollTo).mockClear();
  }

  it('«назад»: прокрутка возвращается, когда результаты по тексту уже отрисованы', async () => {
    await seed(STOIC, OTHER);
    await leaveScrolled(640);

    const hitsAtScroll: number[] = [];
    vi.mocked(window.scrollTo).mockImplementation(() => {
      hitsAtScroll.push(host.querySelectorAll('.shit').length);
    });
    navDirection.value = 'pop';
    mount('сенека');
    // Книги видны сразу, а места в тексте ещё ищутся: прокручивать рано
    expect(window.scrollTo).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(window.scrollTo).toHaveBeenCalledTimes(1));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 640);
    expect(hitsAtScroll).toEqual([2]);
    // Вернулись к результатам — клавиатура их не закрывает
    expect(document.activeElement).not.toBe(input());
  });

  it('возврат делается один раз: следующий поиск прокрутку не трогает', async () => {
    await seed(STOIC, OTHER);
    await leaveScrolled(640);
    navDirection.value = 'pop';
    mount('сенека');
    await vi.waitFor(() => expect(window.scrollTo).toHaveBeenCalledTimes(1));

    type('лес');
    await settle();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('запрос изменили до конца поиска — старую прокрутку не возвращаем', async () => {
    await seed(STOIC, OTHER);
    await leaveScrolled(640);
    navDirection.value = 'pop';
    mount('сенека');
    type('лес');
    await settle();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('не «назад» (ссылка, вкладка): прокрутка не возвращается', async () => {
    await seed(STOIC, OTHER);
    await leaveScrolled(640);
    navDirection.value = 'push';
    mount('сенека');
    await vi.waitFor(() => expect(host.querySelectorAll('.shit').length).toBe(2));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
  });

  it('«назад» к пустому поиску: прокрутка возвращается сразу, поле в фокусе', async () => {
    await seed(STOIC);
    mount();
    setScrollY(120);
    act(() => render(null, host));
    vi.mocked(window.scrollTo).mockClear();

    navDirection.value = 'pop';
    mount();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
    expect(document.activeElement).toBe(input());
  });
});
