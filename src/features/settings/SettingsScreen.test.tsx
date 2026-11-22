// @vitest-environment jsdom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBackup } from '../../core/backup';
import { newProgress } from '../../core/progress';
import { DEFAULT_SETTINGS, type BookMeta } from '../../core/types';
import { exportBackup } from '../../db/backup';
import { getAllBooks, saveBook } from '../../db/books';
import { getMarks, putMark } from '../../db/marks';
import { getSettings } from '../../db/settings';
import { freshDb, sampleBook } from '../../db/testing';
import { __resetLibraryForTests, books, loadLibrary, progressMap } from '../../state/library';
import { settings } from '../../state/settings';
import { EXIT_MS } from '../../ui/Sheet';
import { toasts } from '../../ui/toast-state';
import { SettingsScreen } from './SettingsScreen';

const share = vi.hoisted(() => ({ calls: [] as { name: string; data: Blob }[] }));
vi.mock('../../ui/share', () => ({
  shareOrDownload: vi.fn(async (name: string, data: Blob) => {
    share.calls.push({ name, data });
  }),
}));

const pwa = vi.hoisted(() => ({ updateApp: vi.fn() }));
vi.mock('../../pwa', () => ({ needUpdate: signal(false), updateApp: pwa.updateApp }));
import { needUpdate } from '../../pwa';

let host: HTMLElement;

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
  settings.value = { ...DEFAULT_SETTINGS };
  toasts.value = [];
  share.calls.length = 0;
  needUpdate.value = false;
  pwa.updateApp.mockClear();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  __resetLibraryForTests();
  Reflect.deleteProperty(navigator, 'storage');
  vi.useRealTimers();
});

async function mount() {
  await act(async () => {
    render(<SettingsScreen />, host);
  });
}

async function addBook(id: string, title: string, patch: Partial<BookMeta> = {}): Promise<BookMeta> {
  const { meta, chapters } = sampleBook(title, 3, { id });
  const full = { ...meta, ...patch };
  await saveBook(full, chapters);
  books.value = [...books.value, full];
  return full;
}

const rowByTitle = (title: string) => [...host.querySelectorAll<HTMLButtonElement>('button.srow')].find((b) => b.textContent?.includes(title))!;

describe('«Ещё»: внешний вид и чтение', () => {
  it('«Оформление текста» показывает сводку и открывает ту же шторку, что и «Aa»', async () => {
    settings.value = { ...DEFAULT_SETTINGS, fontSize: 20, theme: 'dark' };
    await mount();
    const row = rowByTitle('Оформление текста');
    expect(row.textContent).toContain('Literata · 20 · Тёмная');

    await act(async () => row.click());
    const sheet = document.querySelector('dialog.sheet')!;
    expect(sheet.querySelector('.sheet__title')?.textContent).toBe('Оформление');
    expect(sheet.textContent).toContain('Размер текста');
    expect(sheet.textContent).toContain('Переносы слов');
  });

  it('скорость чтения: четыре значения, выбор пишется в настройки, есть подсказка', async () => {
    await mount();
    const group = host.querySelector('[aria-label="Скорость чтения, слов в минуту"]')!;
    const options = [...group.querySelectorAll('[role="radio"]')];
    expect(options.map((o) => o.textContent)).toEqual(['150', '180', '220', '260']);
    expect(options[1].getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Время у книг пересчитается');

    await act(async () => (options[2] as HTMLButtonElement).click());
    expect(settings.value.wpm).toBe(220);
    await vi.waitFor(async () => expect((await getSettings()).wpm).toBe(220));
  });
});

describe('«Ещё»: статистика, о приложении, помощь', () => {
  it('статистика по библиотеке', async () => {
    await addBook('a', 'Первая', { cards: 10 });
    await addBook('b', 'Вторая', { cards: 20 });
    await addBook('c', 'Третья');
    progressMap.value = new Map([
      ['a', { ...newProgress('a', 1), status: 'finished', readingMs: 120_000 }],
      ['b', { ...newProgress('b', 1), readingMs: 60_000 }],
    ]);
    await mount();
    const rows = [...host.querySelectorAll('.srow')].map((r) => r.textContent);
    expect(rows).toContain('Книг: 3 · прочитано: 1 · читаю: 1');
    expect(rows).toContain('Минут чтения: 3');
    expect(rows).toContain('Карточек: 30');
  });

  it('версия из package.json; «Обновить приложение» только когда новая версия ждёт', async () => {
    await mount();
    expect(host.textContent).toMatch(/версия \d+\.\d+\.\d+/);
    expect(host.textContent).not.toContain('Обновить приложение');

    await act(async () => {
      needUpdate.value = true;
    });
    const update = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Обновить приложение')!;
    act(() => update.click());
    expect(pwa.updateApp).toHaveBeenCalledOnce();
  });

  it('помощь: три раскрывающихся блока, про iPhone — что книги из Safari в приложении не видны', async () => {
    await mount();
    const blocks = [...host.querySelectorAll('details.help')];
    expect(blocks.map((d) => d.querySelector('summary')?.textContent)).toEqual([
      'Как добавить книгу из Claude',
      'Как установить на iPhone',
      'Скилл для Claude',
    ]);
    expect(blocks[1].textContent).toContain('не видны');
    expect(blocks[1].textContent).toContain('На экран „Домой“');
    expect(blocks[2].textContent).toContain('claude-skill/kisr-library-razbor.zip');
  });
});

describe('«Ещё»: место на устройстве', () => {
  const stubStorage = (api: Partial<StorageManager>) => Object.defineProperty(navigator, 'storage', { value: api, configurable: true });

  it('«Занято» и «Защищено от очистки: нет» с кнопкой «Защитить»', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ estimate: async () => ({ usage: 3.2 * 1024 * 1024, quota: 1e9 }), persisted: async () => false, persist });
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('Занято: 3,2 МБ'));
    expect(host.textContent).toContain('Защищено от очистки: нет');

    const protect = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Защитить')!;
    await act(async () => protect.click());
    expect(persist).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(host.textContent).toContain('Защищено от очистки: да'));
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Защитить')).toBe(false);
  });

  it('браузер отказал — остаётся «нет» и тост', async () => {
    stubStorage({ estimate: async () => ({ usage: 1024 }), persisted: async () => false, persist: async () => false });
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('Защищено от очистки: нет'));
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Защитить')!.click());
    await vi.waitFor(() => expect(toasts.value.at(-1)?.text).toContain('не дал защиту'));
    expect(host.textContent).toContain('Защищено от очистки: нет');
  });

  it('без Storage API строки не показываются', async () => {
    stubStorage({});
    await mount();
    expect(host.textContent).not.toContain('Занято');
    expect(host.textContent).not.toContain('Защищено от очистки');
  });
});

describe('«Ещё»: резервная копия', () => {
  it('до первой копии: «Копий ещё не было»', async () => {
    await mount();
    expect(rowByTitle('Сделать резервную копию').textContent).toContain('Копий ещё не было');
  });

  it('копия: файл kisr-library-backup-ГГГГ-ММ-ДД.json отдаётся «Поделиться», запоминаются дата и число книг', async () => {
    await addBook('a', 'Первая');
    await addBook('b', 'Вторая');
    await putMark({ id: 'a|k', bookId: 'a', chapter: 1, blockKey: 'k', text: 'Абзац', highlight: true, note: '', createdAt: 1, updatedAt: 1 });
    await mount();

    const before = Date.now();
    await act(async () => rowByTitle('Сделать резервную копию').click());
    await vi.waitFor(() => expect(settings.value.lastBackupAt).not.toBeNull());

    expect(share.calls).toHaveLength(1);
    const { name, data } = share.calls[0];
    expect(name).toMatch(/^kisr-library-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(data.type).toBe('application/json');
    const file: unknown = JSON.parse(await data.text());
    expect(isBackup(file)).toBe(true);
    if (!isBackup(file)) return;
    expect(file.books.map((b) => b.id).sort()).toEqual(['a', 'b']);
    expect(file.marks).toHaveLength(1);
    expect(file.app).toMatch(/^kisr-library@\d+\.\d+\.\d+/);

    expect(settings.value.lastBackupAt).toBeGreaterThanOrEqual(before);
    expect(settings.value.booksAtLastBackup).toBe(2);
    expect(rowByTitle('Сделать резервную копию').textContent).toMatch(/Последняя копия: \d{1,2} \S+\./);
    // и в базе тоже
    expect((await getSettings()).booksAtLastBackup).toBe(2);
  });

  it('сбой при создании копии — тост, дата копии не меняется', async () => {
    const { shareOrDownload } = await import('../../ui/share');
    vi.mocked(shareOrDownload).mockRejectedValueOnce(new Error('нет места'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await addBook('a', 'Первая');
    await mount();
    await act(async () => rowByTitle('Сделать резервную копию').click());
    await vi.waitFor(() => expect(toasts.value.at(-1)?.text).toBe('Не удалось сделать копию'));
    expect(settings.value.lastBackupAt).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Не удалось сделать копию');
  });
});

/** Выбор файла в скрытом поле: `files` у `input` читается только из браузера, поэтому подменяем. */
async function chooseFile(content: string, name = 'kisr-library-backup-2026-11-17.json') {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // файл читается асинхронно: ждём либо подтверждения, либо сообщения об ошибке
  await vi.waitFor(() => expect(document.querySelector('dialog.sheet') ?? host.querySelector('[role="alert"]')).not.toBeNull());
}

describe('«Ещё»: восстановление из копии', () => {
  /** Копия с двумя книгами, прогрессом и отметкой, сделанная «на другом телефоне». */
  async function makeBackupJson(): Promise<string> {
    await addBook('a', 'Первая');
    await addBook('b', 'Вторая');
    await putMark({ id: 'a|k', bookId: 'a', chapter: 2, blockKey: 'k', text: 'Абзац', highlight: true, note: 'Заметка', createdAt: 5, updatedAt: 5 });
    const file = await exportBackup('kisr-library@test');
    file.exportedAt = new Date(2026, 10, 17, 12).getTime();
    return JSON.stringify(file);
  }

  it('подтверждение → слияние → итог «Добавлено 2, обновлено 0, пропущено 0»; помнит дату копии и число книг', async () => {
    const json = await makeBackupJson();
    // чистый профиль
    freshDb();
    __resetLibraryForTests();
    settings.value = { ...DEFAULT_SETTINGS };
    await mount();
    expect(books.value).toHaveLength(0);

    await chooseFile(json);
    // сначала подтверждение, ничего ещё не записано
    const sheet = document.querySelector('dialog.sheet')!;
    expect(sheet.querySelector('.sheet__title')?.textContent).toBe('Восстановить из копии?');
    expect(sheet.textContent).toContain('2 книги');
    expect(sheet.textContent).toContain('17 нояб.');
    expect(await getAllBooks()).toHaveLength(0);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    await act(async () => {
      [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Восстановить')!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXIT_MS + 50);
    });
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')).not.toBeNull());
    vi.useRealTimers();

    expect(host.querySelector('[role="status"]')?.textContent).toBe('Добавлено 2, обновлено 0, пропущено 0');
    expect(toasts.value.at(-1)?.text).toBe('Добавлено 2, обновлено 0, пропущено 0');
    expect(books.value.map((b) => b.id).sort()).toEqual(['a', 'b']);
    expect(await getAllBooks()).toHaveLength(2);
    expect(await getMarks()).toHaveLength(1);
    expect(settings.value.lastBackupAt).toBe(new Date(2026, 10, 17, 12).getTime());
    expect(settings.value.booksAtLastBackup).toBe(2);
    expect((await getSettings()).booksAtLastBackup).toBe(2);
    expect(rowByTitle('Сделать резервную копию').textContent).toContain('Последняя копия: 17 нояб.');
  });

  it('«Отмена» ничего не записывает', async () => {
    const json = await makeBackupJson();
    freshDb();
    __resetLibraryForTests();
    await mount();
    await chooseFile(json);
    const sheet = document.querySelector('dialog.sheet')!;
    await act(async () => {
      [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Отмена')!.click();
    });
    expect(await getAllBooks()).toHaveLength(0);
    expect(host.querySelector('[role="status"]')).toBeNull();
    await loadLibrary();
    expect(books.value).toHaveLength(0);
  });

  it('не копия: понятная ошибка, шторка не открывается', async () => {
    await mount();
    await chooseFile('{"format":"что-то другое"}');
    expect(document.querySelector('dialog.sheet')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Это не файл резервной копии Kisr Library');
    expect(toasts.value.at(-1)?.text).toBe('Это не файл резервной копии Kisr Library');
  });

  it('не JSON: понятная ошибка', async () => {
    await mount();
    await chooseFile('это вообще не JSON');
    expect(document.querySelector('dialog.sheet')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не получилось прочитать файл');
  });
});
