// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBook } from '../../core/book';
import { newProgress } from '../../core/progress';
import { DEFAULT_SETTINGS, type BookMeta, type Mark } from '../../core/types';
import { getMarks, putMark } from '../../db/marks';
import { freshDb } from '../../db/testing';
import { route } from '../../router';
import { applySettings, settings } from '../../state/settings';
import { toasts } from '../../ui/toast-state';
import { markId } from './marks';
import { BlockActionsSlot, SettingsSlot, TocSlot } from './slots';

let host: HTMLElement;
let prose: HTMLElement;

const { meta: book }: { meta: BookMeta } = buildBook(
  {
    title: 'Тихая книга',
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    chapters: [
      { title: 'Первая', md: 'Один два три.' },
      { title: '2.1. Вторая', md: 'Четыре пять шесть.' },
    ],
    warnings: [],
  },
  { origin: 'paste', id: 'kniga', now: 1 },
);

const BODY = `
  <p data-key="pa1">Первый абзац главы.</p>
  <p data-key="pb2">Второй абзац, а в нём <a href="https://example.com">ссылка</a>.</p>
  <ul><li class="task" data-key="lc3"><label class="task-check"><input type="checkbox"><span class="task-box"></span></label><span class="tx">Пункт списка</span></li></ul>
  <div class="deck"><p>Колода карточек</p></div>
  <div class="table-wrap"><p>Таблица</p></div>
  <p>Абзац без ключа.</p>`;

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

const tap = (el: Element) => act(() => (el as HTMLElement).click());
const block = (key: string) => prose.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
const bar = () => document.querySelector<HTMLElement>('.bact');
const barButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.bact button')].find((b) => b.textContent === text)!;

function mountActions(version = 1) {
  act(() => render(<BlockActionsSlot bookId="kniga" chapter={1} root={prose} version={version} />, host));
}

const savedMark = (blockKey: string, patch: Partial<Mark> = {}): Mark => ({
  id: markId('kniga', blockKey),
  bookId: 'kniga',
  chapter: 1,
  blockKey,
  text: 'Первый абзац главы.',
  highlight: true,
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

beforeEach(() => {
  freshDb();
  toasts.value = [];
  location.hash = '#/';
  host = document.createElement('div');
  prose = document.createElement('div');
  prose.className = 'prose';
  prose.innerHTML = BODY;
  document.body.append(host, prose);
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  prose.remove();
  settings.value = { ...DEFAULT_SETTINGS };
  document.documentElement.removeAttribute('data-theme');
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  vi.restoreAllMocks();
});

describe('BlockActions: выбор абзаца', () => {
  it('нажатие на абзац выделяет его и показывает панель; повторное снимает', async () => {
    mountActions();
    await flush();
    expect(bar()).toBeNull();
    tap(block('pa1'));
    expect(block('pa1').classList.contains('sel')).toBe(true);
    expect([...document.querySelectorAll('.bact button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Отметить',
      'Заметка',
      'Копировать',
      'Закрыть',
    ]);
    tap(block('pa1'));
    expect(block('pa1').classList.contains('sel')).toBe(false);
    expect(bar()).toBeNull();
  });

  it('другой абзац переносит выделение', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(block('pb2'));
    expect(block('pa1').classList.contains('sel')).toBe(false);
    expect(block('pb2').classList.contains('sel')).toBe(true);
  });

  it('ссылки, чекбоксы, колоды, таблицы и блоки без ключа не выделяются', async () => {
    mountActions();
    await flush();
    for (const target of [
      prose.querySelector('a')!,
      prose.querySelector('input')!,
      prose.querySelector('.task-check')!,
      prose.querySelector('.deck p')!,
      prose.querySelector('.table-wrap p')!,
      prose.querySelector('p:last-child')!,
    ]) {
      tap(target);
      expect(bar(), target.outerHTML).toBeNull();
      expect(prose.querySelector('.sel')).toBeNull();
    }
  });

  it('текст пункта чек-листа выделяется как обычный блок', async () => {
    mountActions();
    await flush();
    tap(prose.querySelector('.tx')!);
    expect(block('lc3').classList.contains('sel')).toBe(true);
  });

  it('нажатие мимо, ✕ и Esc закрывают панель и снимают выделение', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(document.body);
    expect(bar()).toBeNull();
    expect(prose.querySelector('.sel')).toBeNull();

    tap(block('pa1'));
    tap(document.querySelector('.bact__close')!);
    expect(bar()).toBeNull();

    tap(block('pa1'));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(bar()).toBeNull();
    expect(prose.querySelector('.sel')).toBeNull();
  });

  it('нажатие на ссылку при выбранном абзаце тоже закрывает панель', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(prose.querySelector('a')!);
    expect(bar()).toBeNull();
  });

  it('прокрутка закрывает панель, а сдвиг на пару пикселей — нет', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    act(() => {
      (window as unknown as { scrollY: number }).scrollY = 3;
      window.dispatchEvent(new Event('scroll'));
    });
    expect(bar()).not.toBeNull();
    act(() => {
      (window as unknown as { scrollY: number }).scrollY = 40;
      window.dispatchEvent(new Event('scroll'));
    });
    expect(bar()).toBeNull();
    expect(prose.querySelector('.sel')).toBeNull();
  });

  it('нажатие на другой абзац сразу после прокрутки: запоздавшее событие прокрутки выбор не сбрасывает', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    // Страница сдвинулась и тут же пришло нажатие; событие прокрутки добирается после него
    (window as unknown as { scrollY: number }).scrollY = 71;
    tap(block('pb2'));
    act(() => void window.dispatchEvent(new Event('scroll')));
    expect(bar()).not.toBeNull();
    expect(block('pb2').classList.contains('sel')).toBe(true);
  });

  it('идущее выделение текста не принимается за выбор абзаца', async () => {
    mountActions();
    await flush();
    const range = document.createRange();
    range.selectNodeContents(block('pa1'));
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    tap(block('pa1'));
    expect(bar()).toBeNull();
    getSelection()!.removeAllRanges();
  });

  it('глава отрисована заново — выбор сбрасывается', async () => {
    mountActions(1);
    await flush();
    tap(block('pa1'));
    mountActions(2);
    expect(bar()).toBeNull();
  });
});

describe('BlockActions: отметка', () => {
  it('«Отметить» красит абзац, пишет в базу и работает как переключатель', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    expect(barButton('Отметить').getAttribute('aria-pressed')).toBe('false');
    tap(barButton('Отметить'));
    await flush();
    expect(block('pa1').classList.contains('mk')).toBe(true);
    expect(barButton('Отметить').getAttribute('aria-pressed')).toBe('true');
    const stored = await getMarks('kniga');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ blockKey: 'pa1', chapter: 1, highlight: true, text: 'Первый абзац главы.' });

    tap(barButton('Отметить'));
    await flush();
    expect(block('pa1').classList.contains('mk')).toBe(false);
    expect(await getMarks('kniga')).toEqual([]);
  });

  it('красит сохранённые отметки при открытии и при новой отрисовке главы', async () => {
    await putMark(savedMark('pa1'));
    await putMark(savedMark('pb2', { highlight: false, note: 'мысль' }));
    mountActions(1);
    await flush();
    expect(block('pa1').className).toContain('mk');
    expect(block('pb2').className).toBe('has-note');
    // Новый текст главы (innerHTML заменили) — отметки возвращаются
    prose.innerHTML = BODY;
    mountActions(2);
    expect(block('pa1').classList.contains('mk')).toBe(true);
    expect(block('pb2').classList.contains('has-note')).toBe(true);
  });

  it('быстрые нажатия «Отметить» не затирают друг друга', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(barButton('Отметить'));
    tap(barButton('Отметить'));
    tap(barButton('Отметить'));
    await flush();
    expect(await getMarks('kniga')).toHaveLength(1);
    expect(block('pa1').classList.contains('mk')).toBe(true);
  });
});

describe('BlockActions: заметка', () => {
  it('«Заметка» открывает шторку с цитатой; «Сохранить» кладёт заметку и закрывает всё', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(barButton('Заметка'));
    const sheet = document.querySelector('dialog.sheet')!;
    expect(sheet.querySelector('.sheet__title')?.textContent).toBe('Заметка');
    expect(sheet.querySelector('.nform__quote')?.textContent).toBe('«Первый абзац главы.»');
    const input = sheet.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(sheet.textContent).not.toContain('Удалить заметку');

    act(() => {
      input.value = '  Вернуться к этому  ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    tap(sheet.querySelector('button[type="submit"]')!);
    await flush();

    expect(block('pa1').classList.contains('has-note')).toBe(true);
    expect(block('pa1').classList.contains('mk')).toBe(false);
    expect(block('pa1').classList.contains('sel')).toBe(false);
    expect(bar()).toBeNull();
    expect(await getMarks('kniga')).toMatchObject([{ blockKey: 'pa1', note: 'Вернуться к этому', highlight: false }]);
  });

  it('у блока с заметкой поле заполнено, «Удалить заметку» убирает её и оставляет подсветку', async () => {
    await putMark(savedMark('pa1', { note: 'старая' }));
    mountActions();
    await flush();
    tap(block('pa1'));
    expect(barButton('Заметка').hasAttribute('data-on')).toBe(true);
    tap(barButton('Заметка'));
    const sheet = document.querySelector('dialog.sheet')!;
    expect(sheet.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('старая');
    const del = [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Удалить заметку')!;
    tap(del);
    await flush();
    expect(block('pa1').className).toBe('mk');
    expect(await getMarks('kniga')).toMatchObject([{ blockKey: 'pa1', note: '', highlight: true }]);
    expect(toasts.value.map((t) => t.text)).toContain('Заметка удалена');
  });

  it('пока шторка заметки открыта, нажатия внутри неё абзац не сбрасывают', async () => {
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(barButton('Заметка'));
    tap(document.querySelector('dialog.sheet textarea')!);
    expect(block('pa1').classList.contains('sel')).toBe(true);
  });
});

describe('BlockActions: копирование', () => {
  it('«Копировать» кладёт собственный текст абзаца в буфер, закрывает панель и говорит «Скопировано»', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mountActions();
    await flush();
    tap(block('pb2'));
    tap(barButton('Копировать'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('Второй абзац, а в нём ссылка.');
    expect(bar()).toBeNull();
    expect(toasts.value.map((t) => t.text)).toContain('Скопировано');
  });

  it('буфер недоступен — «Не удалось скопировать»', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('нет доступа'))) },
    });
    mountActions();
    await flush();
    tap(block('pa1'));
    tap(barButton('Копировать'));
    await flush();
    expect(toasts.value.map((t) => t.text)).toContain('Не удалось скопировать');
  });
});

describe('TocSlot: оглавление', () => {
  const mountToc = (props: { progress?: ReturnType<typeof newProgress>; chapter?: number } = {}) => {
    const onClose = vi.fn();
    act(() => render(<TocSlot open onClose={onClose} book={book} progress={props.progress} chapter={props.chapter ?? 1} />, host));
    return onClose;
  };
  const sheet = () => document.querySelector('dialog.sheet')!;
  const tab = (name: string) => [...sheet().querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.textContent?.startsWith(name))!;

  it('«Главы»: список с текущей главой; нажатие закрывает шторку и открывает главу', () => {
    const onClose = mountToc({ chapter: 1 });
    expect(sheet().querySelector('.sheet__title')?.textContent).toBe('Оглавление');
    expect(tab('Главы').getAttribute('aria-checked')).toBe('true');
    const rows = [...sheet().querySelectorAll<HTMLElement>('.chapters__row')];
    expect(rows.map((r) => r.dataset.state)).toEqual(['current', 'todo']);
    tap(rows[1]);
    expect(onClose).toHaveBeenCalled();
    expect(route.value).toMatchObject({ name: 'read', id: 'kniga', chapter: 2 });
  });

  it('«Отметки»: пусто — подсказка', async () => {
    mountToc();
    await flush();
    tap(tab('Отметки'));
    expect(sheet().querySelector('.toc__empty')?.textContent).toBe('Отметок пока нет. Нажми на абзац, чтобы отметить его');
  });

  it('«Отметки»: фрагмент в «ёлочках», заметка, глава; по главам; нажатие ведёт к блоку', async () => {
    await putMark(savedMark('pb2', { chapter: 2, text: 'Четыре пять', createdAt: 5 }));
    await putMark(savedMark('pa1', { chapter: 1, text: 'Один два', note: 'моя мысль', createdAt: 9 }));
    await putMark({ ...savedMark('zz', { chapter: 1, text: 'Чужая книга' }), id: 'other|zz', bookId: 'other' });
    const onClose = mountToc();
    await flush();
    expect(tab('Отметки').textContent).toBe('Отметки2');
    tap(tab('Отметки'));
    const rows = [...sheet().querySelectorAll<HTMLElement>('.tmarks__row')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.tmarks__text')?.textContent).toBe('«Один два»');
    expect(rows[0].querySelector('.tmarks__note')?.textContent).toBe('моя мысль');
    expect(rows[0].querySelector('.tmarks__where')?.textContent).toBe('Глава 1 · Первая');
    expect(rows[1].querySelector('.tmarks__note')).toBeNull();
    expect(rows[1].querySelector('.tmarks__where')?.textContent).toBe('Глава 2 · 2.1. Вторая');

    tap(rows[1]);
    expect(onClose).toHaveBeenCalled();
    expect(location.hash).toBe('#/read/kniga/2?b=pb2');
    expect(route.value).toMatchObject({ name: 'read', id: 'kniga', chapter: 2, block: 'pb2' });
  });
});

describe('SettingsSlot: «Aa»', () => {
  const mountSettings = () => act(() => render(<SettingsSlot open onClose={() => {}} book={book} chapter={1} />, host));
  const sheet = () => document.querySelector('dialog.sheet')!;
  const radio = (label: string) => [...sheet().querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.textContent === label)!;
  const labelled = (label: string) => sheet().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const waitSettings = () => flush();

  beforeEach(() => applySettings(DEFAULT_SETTINGS));

  it('размер: A+ и A− меняют шрифт читалки сразу, в пределах 15–24', async () => {
    mountSettings();
    expect(sheet().querySelector('.sheet__title')?.textContent).toBe('Оформление');
    expect(sheet().querySelector('output')?.textContent).toBe('18');
    tap(labelled('Увеличить текст'));
    await waitSettings();
    expect(settings.value.fontSize).toBe(19);
    expect(sheet().querySelector('output')?.textContent).toBe('19');
    expect(document.documentElement.style.getPropertyValue('--read-size')).toBe(`${19 / 16}rem`);

    for (let i = 0; i < 10; i++) tap(labelled('Увеличить текст'));
    await waitSettings();
    expect(settings.value.fontSize).toBe(24);
    expect(labelled('Увеличить текст').disabled).toBe(true);

    for (let i = 0; i < 12; i++) tap(labelled('Уменьшить текст'));
    await waitSettings();
    expect(settings.value.fontSize).toBe(15);
    expect(labelled('Уменьшить текст').disabled).toBe(true);
  });

  it('шрифт, интервал и тема применяются сразу', async () => {
    mountSettings();
    tap(radio('Без засечек'));
    tap(radio('Свободно'));
    tap(radio('Тёмная'));
    await waitSettings();
    expect(settings.value).toMatchObject({ font: 'sans', lineHeight: 'loose', theme: 'dark' });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--read-font')).toBe('var(--font-ui)');
    expect(style.getPropertyValue('--read-line')).toBe('1.75');
    expect(document.documentElement.dataset.theme).toBe('dark');
    tap(radio('Авто'));
    await waitSettings();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(radio('Бумага')).toBeTruthy();
    expect(radio('Светлая')).toBeTruthy();
  });

  it('переносы включаются и выключаются', async () => {
    mountSettings();
    const sw = [...sheet().querySelectorAll<HTMLElement>('[role="switch"]')].find((b) => b.textContent?.startsWith('Переносы'))!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    tap(sw);
    await waitSettings();
    expect(settings.value.hyphens).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.style.getPropertyValue('--read-hyphens')).toBe('manual');
  });

  it('«Не гасить экран» скрыт без Wake Lock и работает с ним', async () => {
    mountSettings();
    expect(sheet().textContent).not.toContain('Не гасить экран');
    act(() => render(null, host));

    const sentinel = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    mountSettings();
    const sw = [...sheet().querySelectorAll<HTMLElement>('[role="switch"]')].find((b) => b.textContent?.startsWith('Не гасить'))!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(request).not.toHaveBeenCalled();
    tap(sw);
    await waitSettings();
    expect(settings.value.keepAwake).toBe(true);
    expect(request).toHaveBeenCalledWith('screen');
    tap(sw);
    await waitSettings();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it('экран держится и при закрытой шторке, пока читалка открыта', async () => {
    const sentinel = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    settings.value = { ...DEFAULT_SETTINGS, keepAwake: true };
    act(() => render(<SettingsSlot open={false} onClose={() => {}} book={book} chapter={1} />, host));
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    act(() => render(null, host));
    await flush();
    expect(sentinel.release).toHaveBeenCalled();
  });
});
