// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProgress } from '../../core/progress';
import type { BookMeta, Progress } from '../../core/types';
import { freshDb, sampleBook } from '../../db/testing';
import { route } from '../../router';
import { DELETE_UNDO_MS, __resetLibraryForTests, books, progressMap } from '../../state/library';
import { EXIT_MS } from '../../ui/Sheet';
import { toasts } from '../../ui/toast-state';
import { BookScreen } from './BookScreen';

let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  freshDb();
  __resetLibraryForTests();
  toasts.value = [];
  location.hash = '#/';
  window.scrollTo = vi.fn(); // jsdom не умеет прокручивать
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  __resetLibraryForTests();
});

function seed(progress?: Partial<Progress>, patch: Partial<BookMeta> = {}) {
  const { meta } = sampleBook('Тихая работа', 3, { id: 'tihaya', category: 'Психология' });
  books.value = [{ ...meta, ...patch }];
  if (progress) progressMap.value = new Map([['tihaya', { ...newProgress('tihaya', 1), ...progress }]]);
  return meta;
}

function mount(id = 'tihaya') {
  act(() => render(<BookScreen route={{ name: 'book', id }} />, host));
}

const go = () => host.querySelector<HTMLAnchorElement>('.bhead__go .btn')!;
const clickByText = (text: string) => {
  const el = [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`Нет кнопки «${text}»`);
  act(() => el.click());
};
const settle = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('BookScreen: главная кнопка', () => {
  it('новая книга — «Начать читать» с первой главы', () => {
    seed();
    mount();
    expect(go().textContent).toBe('Начать читать');
    expect(go().getAttribute('href')).toBe('#/read/tihaya/1');
    expect(host.querySelector('.bhead__progress')).toBeNull();
  });

  it('начатая — «Продолжить · гл. N, P%» с абзацем, где остановился', () => {
    seed({ chapter: 2, blockKey: 'abc', wordsRead: 15, percent: 50 });
    mount();
    expect(go().textContent).toBe('Продолжить · гл.\u00A02, 50%');
    expect(go().getAttribute('href')).toBe('#/read/tihaya/2?b=abc');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('прочитанная — «Читать заново» с первой главы, прогресс не трогаем', () => {
    seed({ chapter: 3, status: 'finished', percent: 100, wordsRead: 30, finishedAt: 5 });
    mount();
    expect(go().textContent).toBe('Читать заново');
    expect(go().getAttribute('href')).toBe('#/read/tihaya/1');
    expect(progressMap.value.get('tihaya')?.chapter).toBe(3);
  });
});

describe('BookScreen: название', () => {
  it('с « — »: пробел перед тире неразрывный, тире не начинает строку', () => {
    seed(undefined, { title: 'Дейл Карнеги — шпаргалка' });
    mount();
    expect(host.querySelector('h1')?.textContent).toBe('Дейл Карнеги — шпаргалка');
  });
});

describe('BookScreen: страница', () => {
  it('шифр, раздел, название, описание и строка мета', () => {
    seed(undefined, { cards: 14 });
    mount();
    expect(host.querySelector('.bhead__callno')?.textContent).toBe('ПСИ·01');
    expect(host.querySelector('.bhead__cat')?.textContent).toBe('Психология');
    expect(host.querySelector('h1')?.textContent).toBe('Тихая работа');
    expect(host.querySelector('.bhead__sum')?.textContent).toContain('Описание книги');
    const meta = host.querySelector('.bhead__meta')?.textContent ?? '';
    expect(meta).toMatch(/^≈\s1\sмин\s·\s3\sглавы\s·\s14\sкарточек\s·\sдобавлена\s/);
  });

  it('теги ведут в поиск, источник показан', () => {
    seed(undefined, { source: 'Конспект' });
    mount();
    act(() => host.querySelector<HTMLButtonElement>('.btags .chip')!.click());
    expect(route.value).toEqual({ name: 'search', q: 'тест' });
    expect(host.querySelector('.bsource')?.textContent).toContain('Конспект');
  });

  it('нет такой книги — «Книга не найдена» и кнопка на полку', () => {
    seed();
    mount('net-takoy');
    expect(host.querySelector('.empty__title')?.textContent).toBe('Книга не найдена');
    expect(host.querySelector('.empty a')?.getAttribute('href')).toBe('#/');
  });

  it('действие и «Прочитано» — у прочитанной книги или если действие записано', () => {
    seed();
    mount();
    expect(host.querySelector('.baction')).toBeNull();

    seed({ status: 'finished', percent: 100, finishedAt: 5 });
    mount();
    expect(host.querySelector('.baction')?.textContent).toContain('Прочитано');
    expect(host.querySelector('.baction')?.textContent).toContain('Записать действие');

    seed({ status: 'reading' }, { action: { text: 'Позвонить', done: false } });
    mount();
    expect(host.querySelector('.baction')?.textContent).toContain('Позвонить');
    expect(host.querySelector('.baction__read')).toBeNull();
  });
});

describe('BookScreen: удаление', () => {
  function confirmDelete() {
    clickByText('Удалить книгу'); // пункт меню — подтверждение откроется после ухода меню
    settle(EXIT_MS + 100);
    clickByText('Удалить');
  }

  it('подтверждение → книга скрыта, тост «Вернуть», переход на полку; «Вернуть» возвращает книгу', () => {
    seed();
    location.hash = '#/book/tihaya';
    mount();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Действия с книгой"]')!.click());
    confirmDelete();

    expect(books.value).toHaveLength(0);
    expect(route.value.name).toBe('library');
    const t = toasts.value.at(-1)!;
    expect(t.text).toBe('Удалено');
    expect(t.action?.label).toBe('Вернуть');

    act(() => t.action!.run());
    expect(books.value.map((b) => b.id)).toEqual(['tihaya']);
    // таймер удаления отменён: через 6 секунд книга всё ещё на полке
    settle(DELETE_UNDO_MS + 100);
    expect(books.value).toHaveLength(1);
  });

  it('«Отмена» ничего не удаляет', () => {
    seed();
    mount();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Действия с книгой"]')!.click());
    clickByText('Удалить книгу');
    settle(EXIT_MS + 100);
    clickByText('Отмена');
    expect(books.value).toHaveLength(1);
    expect(toasts.value).toHaveLength(0);
  });
});
