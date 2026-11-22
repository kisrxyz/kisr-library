// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProgress } from '../../core/progress';
import type { BookMeta, Mark } from '../../core/types';
import { getBook, saveBook } from '../../db/books';
import { putMark } from '../../db/marks';
import { freshDb, sampleBook } from '../../db/testing';
import { route } from '../../router';
import { __resetLibraryForTests, books, progressMap } from '../../state/library';
import { toasts } from '../../ui/toast-state';
import { NotesScreen } from './NotesScreen';

let host: HTMLElement;

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
  toasts.value = [];
  location.hash = '#/notes';
  window.scrollTo = vi.fn(); // jsdom не умеет прокручивать
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  __resetLibraryForTests();
});

/** Книга в базе и в сигнале: действия сохраняются через базу. */
async function addBook(id: string, title: string, patch: Partial<BookMeta> = {}): Promise<BookMeta> {
  const { meta, chapters } = sampleBook(title, 3, { id });
  const full = { ...meta, ...patch };
  await saveBook(full, chapters);
  books.value = [...books.value, full];
  return full;
}

function mark(bookId: string, key: string, updatedAt: number, patch: Partial<Mark> = {}): Mark {
  return {
    id: `${bookId}|${key}`,
    bookId,
    chapter: 2,
    blockKey: key,
    text: `Абзац ${key}`,
    highlight: true,
    note: '',
    createdAt: updatedAt,
    updatedAt,
    ...patch,
  };
}

async function mount(tab: 'marks' | 'actions' = 'marks') {
  await act(async () => {
    render(<NotesScreen route={{ name: 'notes', tab }} />, host);
  });
  // отметки читаются из базы асинхронно
  await vi.waitFor(() => expect(host.querySelector('[aria-busy="true"]')).toBeNull());
}

describe('NotesScreen: отметки', () => {
  it('сгруппированы по книгам, новые сверху: абзац в «ёлочках», заметка, глава, дата, ссылка в читалку', async () => {
    await addBook('a', 'Тихая работа');
    await addBook('b', 'Память');
    const t = new Date(2026, 10, 17, 12).getTime();
    await putMark(mark('a', 'k1', t - 2000));
    await putMark(mark('b', 'k2', t, { text: 'Забывание — норма', note: 'Проверить на себе', highlight: false }));
    await putMark(mark('a', 'k3', t - 1000));
    await mount();

    const heads = [...host.querySelectorAll('.ngroup__title')].map((a) => a.textContent);
    expect(heads).toEqual(['Память', 'Тихая работа']); // группа с самой свежей отметкой — первая

    const items = [...host.querySelectorAll<HTMLAnchorElement>('.mark')];
    expect(items.map((a) => a.querySelector('.mark__text')?.textContent)).toEqual(['«Забывание — норма»', '«Абзац k3»', '«Абзац k1»']);

    const first = items[0];
    expect(first.getAttribute('href')).toBe('#/read/b/2?b=k2');
    expect(first.querySelector('.mark__note')?.textContent).toBe('Проверить на себе');
    expect(first.querySelector('.mark__text--hl')).toBeNull(); // только заметка, без подсветки
    expect(items[1].querySelector('.mark__text--hl')).not.toBeNull();
    expect(first.querySelector('.mark__meta')?.textContent).toBe('Глава 2 · 17 нояб.');
    expect(host.querySelector('.ngroup__count')?.textContent).toBe('1 отметка');
  });

  it('счётчики на вкладках и заголовок группы ведёт на книгу', async () => {
    await addBook('a', 'Тихая работа', { action: { text: 'Сделать', done: false } });
    await putMark(mark('a', 'k1', 1));
    await putMark(mark('a', 'k2', 2));
    await mount();
    const tabs = [...host.querySelectorAll('[role="radio"]')].map((b) => b.textContent);
    expect(tabs).toEqual(['Отметки2', 'Действия1']);
    expect(host.querySelector('.ngroup__title')?.getAttribute('href')).toBe('#/book/a');
    expect(host.querySelector('.ngroup__count')?.textContent).toBe('2 отметки');
  });

  it('отметки книги, которой нет на полке, не показываются', async () => {
    await addBook('a', 'Тихая работа');
    await putMark(mark('a', 'k1', 1));
    await putMark(mark('gone', 'k2', 2));
    await mount();
    expect(host.querySelectorAll('.mark')).toHaveLength(1);
  });

  it('без отметок — пустое состояние, которое объясняет, как они появляются', async () => {
    await addBook('a', 'Тихая работа');
    await mount();
    expect(host.querySelector('.empty__title')?.textContent).toBe('Отметок пока нет');
    expect(host.querySelector('.empty__text')?.textContent).toContain('«Отметить»');
  });

  it('вкладка «Действия» переключается через адрес (заменяя запись истории)', async () => {
    await mount();
    const actionsTab = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.startsWith('Действия'))!;
    act(() => actionsTab.click());
    expect(route.value).toEqual({ name: 'notes', tab: 'actions' });
    expect(location.hash).toBe('#/notes?tab=actions');
  });
});

describe('NotesScreen: действия', () => {
  it('показывает действия книг: невыполненные сверху, название ведёт на книгу', async () => {
    const finished = new Date(2026, 10, 17).getTime();
    await addBook('a', 'Тихая работа', { action: { text: 'Позвонить маме', done: true, doneAt: finished } });
    await addBook('b', 'Память', { action: { text: 'Вести дневник', done: false } });
    await addBook('c', 'Без действия');
    progressMap.value = new Map([['b', { ...newProgress('b', 1), status: 'finished', finishedAt: 5 }]]);
    await mount('actions');

    const titles = [...host.querySelectorAll('.action__book')].map((a) => a.textContent);
    expect(titles).toEqual(['Память', 'Тихая работа']);
    expect(host.querySelector('.action__book')?.getAttribute('href')).toBe('#/book/b');
    expect(host.querySelector('.notes__summary')?.textContent).toBe('Сделано 1 из 2');
    expect(host.querySelectorAll('.action__text')[1].textContent).toBe('Позвонить маме');
    expect(host.querySelectorAll('.action__check')[1].textContent).toBe('сделано · 17 нояб.');
  });

  it('галочка «сделано» сохраняет действие в базе и на экране', async () => {
    await addBook('b', 'Память', { action: { text: 'Вести дневник', done: false } });
    await mount('actions');
    const box = host.querySelector<HTMLInputElement>('.action__check input')!;
    expect(box.checked).toBe(false);

    await act(async () => {
      box.click();
    });
    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('.action__check input')!.checked).toBe(true));

    const saved = (await getBook('b'))!.action!;
    expect(saved.done).toBe(true);
    expect(saved.text).toBe('Вести дневник');
    expect(typeof saved.doneAt).toBe('number');
    expect(host.querySelector('.notes__summary')?.textContent).toBe('Сделано 1 из 1');

    // и обратно: галочка снимается, время «сделано» пропадает
    await act(async () => {
      host.querySelector<HTMLInputElement>('.action__check input')!.click();
    });
    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('.action__check input')!.checked).toBe(false));
    expect((await getBook('b'))!.action).toEqual({ text: 'Вести дневник', done: false });
  });

  it('без действий — пустое состояние', async () => {
    await addBook('a', 'Тихая работа');
    await mount('actions');
    expect(host.querySelector('.empty__title')?.textContent).toBe('Действий пока нет');
    expect(host.querySelector('.empty__text')?.textContent).toContain('одно действие');
  });
});
