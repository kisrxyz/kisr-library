// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBook } from '../../core/book';
import { newProgress } from '../../core/progress';
import { hash } from '../../core/text';
import type { BookMeta, Progress } from '../../core/types';
import { saveBook } from '../../db/books';
import { freshDb } from '../../db/testing';
import { navigate, route, type RouteOf } from '../../router';
import { __resetLibraryForTests, books, progressMap } from '../../state/library';
import { runToastAction, toasts } from '../../ui/toast-state';
import { ReaderScreen } from './ReaderScreen';

/*
  В jsdom нет раскладки: блоки с data-key «стоят» друг под другом по 100px, начиная с y = 200 в документе;
  панель высотой 0, поэтому линия чтения — 8px от верха окна. Прокрутку меняет только window.scrollTo.
*/
const BLOCK_TOP = 200;
const BLOCK_H = 100;
let scrollY = 0;

function fakeRect(el: Element): DOMRect {
  let top = 10_000;
  let height = 0;
  const block = el.closest('[data-key]');
  if (block) {
    const index = Array.from(document.querySelectorAll('[data-key]')).indexOf(block);
    top = BLOCK_TOP + index * BLOCK_H;
    height = BLOCK_H;
  }
  const y = top - scrollY;
  return { top: y, bottom: y + height, height, left: 0, right: 300, width: 300, x: 0, y, toJSON: () => ({}) } as DOMRect;
}

class FakeObserver {
  static all: FakeObserver[] = [];
  targets: Element[] = [];
  constructor(readonly cb: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
  takeRecords() {
    return [];
  }
}

/** Конец главы показался в кадре. */
function showChapterEnd() {
  for (const o of FakeObserver.all) {
    for (const target of o.targets) {
      const entry = { isIntersecting: true, target, boundingClientRect: { top: 500, bottom: 501 } };
      o.cb([entry as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
    }
  }
}

const para = (ch: number, i: number) => `Абзац ${i} главы ${ch}: обычный текст, в котором есть несколько слов подряд.`;

/** 4 главы: «Первая», «Вторая», «Третья» по 5 абзацев и служебная «Источники». */
async function makeBook(): Promise<BookMeta> {
  const chapter = (ch: number, title: string) => ({
    title,
    md: Array.from({ length: 5 }, (_, i) => para(ch, i + 1)).join('\n\n'),
  });
  const { meta, chapters } = buildBook(
    {
      title: 'Тихая книга',
      category: 'Разное',
      tags: [],
      summary: '',
      source: '',
      chapters: [chapter(1, 'Первая'), chapter(2, 'Вторая'), chapter(3, 'Третья'), { title: 'Источники', md: 'Список источников.' }],
      warnings: [],
    },
    { origin: 'paste', id: 'kniga', now: 1_700_000_000_000 },
  );
  await saveBook(meta, chapters);
  books.value = [meta];
  return meta;
}

const keyOf = (ch: number, i: number) => 'p' + hash(para(ch, i));

function setProgress(patch: Partial<Progress>) {
  progressMap.value = new Map([['kniga', { ...newProgress('kniga', 1), ...patch }]]);
}

function Host() {
  const r = route.value;
  return r.name === 'read' ? <ReaderScreen route={r as RouteOf<'read'>} /> : null;
}

let host: HTMLElement;

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('не дождались');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

/** Открыть адрес и дождаться, пока место восстановлено и текст показан. */
async function open(hashUrl: string) {
  navigate(hashUrl);
  act(() => render(<Host />, host));
  await waitFor(() => host.querySelector('[data-state="ready"]') !== null);
}

const nextFrame = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
  });

const scrollTo = vi.fn((_x: number, y: number) => {
  scrollY = y;
});

function scrollPage(y: number) {
  scrollY = y;
  window.dispatchEvent(new Event('scroll'));
}

const saved = () => progressMap.value.get('kniga');

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
  toasts.value = [];
  scrollY = 0;
  scrollTo.mockClear();
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return fakeRect(this);
  });
  FakeObserver.all = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
  navigate('#/');
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  __resetLibraryForTests();
});

describe('ReaderScreen: книга и глава', () => {
  it('нет такой книги — «Книга не найдена» и дорога на полку', async () => {
    await makeBook();
    navigate('#/read/net-takoy/1');
    act(() => render(<Host />, host));
    expect(host.querySelector('.empty__title')?.textContent).toBe('Книга не найдена');
    expect(host.querySelector('.empty a')?.getAttribute('href')).toBe('#/');
  });

  it('показывает название книги, «Глава 2 из 4», заголовок главы и текст с ключами блоков', async () => {
    await makeBook();
    await open('#/read/kniga/2');
    expect(host.querySelector('header')?.textContent).toContain('Тихая книга');
    expect(host.querySelector('header')?.textContent).toContain('Глава 2 из 4');
    expect(host.querySelector('h1')?.textContent).toBe('Вторая');
    const prose = host.querySelector('.prose[lang="ru"]')!;
    expect(Array.from(prose.querySelectorAll('[data-key]')).map((e) => e.getAttribute('data-key'))).toEqual(
      [1, 2, 3, 4, 5].map((i) => keyOf(2, i)),
    );
    expect(host.querySelector('button[aria-label="Оглавление"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Настройки чтения"]')?.textContent).toBe('Aa');
  });

  it('номер главы за пределами книги — последняя глава, адрес исправлен', async () => {
    await makeBook();
    await open('#/read/kniga/99');
    expect(host.querySelector('h1')?.textContent).toBe('Источники');
    expect(location.hash).toBe('#/read/kniga/4');
  });
});

describe('ReaderScreen: где остановился', () => {
  it('первое открытие книги заводит прогресс на этой главе', async () => {
    await makeBook();
    await open('#/read/kniga/2');
    await waitFor(() => saved() !== undefined);
    expect(saved()).toMatchObject({ chapter: 2, maxChapter: 2, status: 'reading', blockKey: keyOf(2, 1) });
  });

  it('?b= — блок по ключу встаёт под панель, вспыхивает, ?b= уходит из адреса', async () => {
    await makeBook();
    await open(`#/read/kniga/2?b=${keyOf(2, 3)}`);
    // третий блок: 200 + 2·100 − 0 (панель) − 8
    expect(scrollTo).toHaveBeenLastCalledWith(0, 392);
    const block = host.querySelector(`[data-key="${keyOf(2, 3)}"]`)!;
    expect(block.classList.contains('flash-hit')).toBe(true);
    expect(location.hash).toBe('#/read/kniga/2');
  });

  it('сохранённое место этой главы — по ключу и доле; само открытие место не перезаписывает', async () => {
    await makeBook();
    setProgress({ chapter: 2, maxChapter: 2, blockKey: keyOf(2, 4), blockIndex: 3, blockOffset: 0.5, lastReadAt: 5 });
    await open('#/read/kniga/2');
    // четвёртый блок: 200 + 3·100 + 0,5·100 − 8
    expect(scrollTo).toHaveBeenLastCalledWith(0, 542);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(saved()).toMatchObject({ blockKey: keyOf(2, 4), blockOffset: 0.5, lastReadAt: 5 });
  });

  it('ключ не нашёлся (текст правили) — по индексу блока', async () => {
    await makeBook();
    setProgress({ chapter: 2, blockKey: 'pnetakogo', blockIndex: 2, blockOffset: 0 });
    await open('#/read/kniga/2');
    // доля 0: под линию встаёт низ предыдущего блока — 200 + 2·100 − 8
    expect(scrollTo).toHaveBeenLastCalledWith(0, 392);
  });

  it('прокрутка записывает блок у линии чтения не позже чем через 300 мс', async () => {
    await makeBook();
    await open('#/read/kniga/2');
    // линия чтения 8px окна = 408 документа: третий блок (400..500)
    scrollPage(400);
    await nextFrame();
    // и сразу дальше: 608 — пятый блок (600..700), доля 0,08; запись — по окончании 300 мс
    scrollPage(600);
    await waitFor(() => saved()?.blockKey === keyOf(2, 5), 500);
    const p = saved()!;
    expect(p.blockIndex).toBe(4);
    expect(p.blockOffset).toBeCloseTo(0.08, 5);
    expect(p.snippet).toBe(para(2, 5));
    expect(p.chapter).toBe(2);
  });

  it('уход из читалки раньше, чем истекли 300 мс, всё равно записывает последнее место', async () => {
    await makeBook();
    setProgress({ chapter: 2, blockKey: keyOf(2, 1), blockIndex: 0, blockOffset: 0 });
    await open('#/read/kniga/2');
    scrollPage(400); // линия 408: третий блок — пишется сразу
    await nextFrame();
    scrollPage(500); // линия 508: четвёртый блок — запись ждёт
    await nextFrame();
    act(() => render(null, host));
    expect(saved()?.blockKey).toBe(keyOf(2, 4));
  });
});

describe('ReaderScreen: навигация', () => {
  it('конец главы: «Дальше: <название> · N мин» открывает следующую главу без новой записи истории', async () => {
    await makeBook();
    await open('#/read/kniga/2');
    const next = host.querySelector<HTMLButtonElement>('button[aria-label^="Дальше"]')!;
    expect(next.getAttribute('aria-label')).toBe('Дальше: Третья · 1 мин');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Предыдущая глава')).toBe(true);
    const depth = history.length;
    act(() => next.click());
    await waitFor(() => host.querySelector('h1')?.textContent === 'Третья');
    expect(location.hash).toBe('#/read/kniga/3');
    expect(history.length).toBe(depth);
  });

  it('стрелки ←/→ листают главы, но не в поле ввода', async () => {
    await makeBook();
    await open('#/read/kniga/2');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    await waitFor(() => (route.value as RouteOf<'read'>).chapter === 1);

    const input = document.createElement('textarea');
    document.body.append(input);
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect((route.value as RouteOf<'read'>).chapter).toBe(1);
    input.remove();
  });

  it('?find= — первое совпадение в тексте главы обёрнуто в <mark>', async () => {
    await makeBook();
    await open('#/read/kniga/2?find=АБЗАЦ%204');
    const mark = host.querySelector('.prose mark');
    expect(mark?.textContent).toBe('Абзац 4');
    expect(mark?.closest('[data-key]')?.getAttribute('data-key')).toBe(keyOf(2, 4));
    expect(location.hash).toBe('#/read/kniga/2');
  });
});

describe('ReaderScreen: дочитал', () => {
  it('конец обычной главы отмечает её дочитанной', async () => {
    await makeBook();
    await open('#/read/kniga/1');
    act(() => showChapterEnd());
    await waitFor(() => saved()?.chaptersDone.includes(1) === true);
    expect(saved()?.status).toBe('reading');
    expect(toasts.value).toEqual([]);
  });

  it('конец последней не служебной главы — книга прочитана, тост с «Отменить» возвращает её в «Читаю»', async () => {
    await makeBook();
    await open('#/read/kniga/3');
    act(() => showChapterEnd());
    await waitFor(() => saved()?.status === 'finished');
    const t = toasts.value[0];
    expect(t.text).toBe('Книга в «Прочитано»');
    expect(t.action?.label).toBe('Отменить');
    act(() => runToastAction(t.id));
    await waitFor(() => saved()?.status === 'reading');
  });

  it('в конце последней обязательной главы — «Дочитал?»; «Сохранить» записывает одно действие', async () => {
    await makeBook();
    await open('#/read/kniga/3');
    expect(host.textContent).toContain('Дочитал?');
    const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest('label')?.textContent).toContain('Одно действие, которое сделаешь после книги');
    act(() => {
      field.value = 'Позвонить маме';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить')!;
    act(() => save.click());
    await waitFor(() => books.value[0].action?.text === 'Позвонить маме');
    await waitFor(() => saved()?.status === 'finished');
    await waitFor(() => host.textContent!.includes('Вернуть в «Читаю»'));
    expect(host.querySelector('button[aria-label^="Дальше"]')?.getAttribute('aria-label')).toBe('Дальше: Источники · 1 мин');
  });
});
