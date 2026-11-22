// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupFile } from '../../core/backup';
import { DEFAULT_SETTINGS } from '../../core/types';
import { getAllBooks, getChapters } from '../../db/books';
import { putInbox } from '../../db/inbox';
import { freshDb, sampleBook } from '../../db/testing';
import { __resetLibraryForTests, books, saveImportedBook } from '../../state/library';
import { settings } from '../../state/settings';
import { toasts } from '../../ui/toast-state';
import { AddScreen } from './AddScreen';
import { __resetImportFlowForTests } from './importFlow';
import { claudeUrl } from './prompt';

let host: HTMLElement;

const book = (title: string, chapters = 2, extra = '') =>
  `---\ntitle: ${title}\ncategory: Психология\ntags: [один]\nsummary: Описание книги.\nsource: нет\n${extra}---\n` +
  Array.from({ length: chapters }, (_, i) => `## Глава ${i + 1}\nТекст главы ${i + 1} книги «${title}», в нём несколько слов.`).join('\n\n');

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
  __resetImportFlowForTests();
  settings.value = { ...DEFAULT_SETTINGS };
  toasts.value = [];
  location.hash = '#/add';
  try {
    localStorage.clear();
  } catch {
    // нет хранилища — тест всё равно должен работать
  }
  window.scrollTo = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  __resetLibraryForTests();
});

const mount = (shared = false) => act(() => render(<AddScreen route={{ name: 'add', shared }} />, host));
const area = () => host.querySelector<HTMLTextAreaElement>('.addbox__area')!;
const button = (text: string) => {
  const el = [...host.querySelectorAll<HTMLElement>('button, a.btn')].find((b) => b.textContent?.trim() === text || b.textContent?.includes(text));
  if (!el) throw new Error(`Нет кнопки «${text}»`);
  return el as HTMLButtonElement;
};
const has = (text: string) => [...host.querySelectorAll<HTMLElement>('button, a.btn')].some((b) => b.textContent?.includes(text));
const toastTexts = () => toasts.value.map((t) => t.text);

/** Ввод в поле, как при долгом нажатии → «Вставить»; разбор идёт после короткой паузы. */
async function paste(text: string) {
  mount();
  await act(async () => {
    area().value = text;
    area().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await vi.waitFor(() => expect(host.querySelector('.pv, .restore')).not.toBeNull(), { timeout: 2000 });
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));

function stubClipboard(clip: Partial<Clipboard>) {
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
}

describe('поле и кнопки источника', () => {
  it('поле: 16px-совместимые атрибуты и подсказка', () => {
    mount();
    expect(area().getAttribute('autocapitalize')).toBe('off');
    expect(area().getAttribute('autocorrect')).toBe('off');
    expect(area().placeholder).toBe('Вставь сюда ответ Claude целиком');
    expect(host.querySelector<HTMLInputElement>('input[type=file]')?.multiple).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type=file]')?.accept).toBe('.md,.markdown,.txt,.json,text/*,application/json');
  });

  it('«Вставить из буфера» читает буфер и сразу показывает предпросмотр', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue(book('Тихая работа')) });
    mount();
    await act(async () => button('Вставить из буфера').click());
    expect(host.querySelector<HTMLInputElement>('.pv input')?.value).toBe('Тихая работа');
    expect(area().value).toContain('Тихая работа');
    expect(host.querySelector('.pv__stats')?.textContent).toBe('2 главы · ≈ 1 мин · 0 карточек');
  });

  it('если буфер не прочитался: фокус в поле и подсказка', async () => {
    stubClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) });
    mount();
    await act(async () => button('Вставить из буфера').click());
    expect(document.activeElement).toBe(area());
    expect(host.textContent).toContain('Нажми и удерживай поле → Вставить');
    expect(host.querySelector('.pv')).toBeNull();
  });

  it('нет API буфера вообще — то же самое', async () => {
    mount();
    await act(async () => button('Вставить из буфера').click());
    expect(host.textContent).toContain('Нажми и удерживай поле → Вставить');
  });

  it('пустой буфер — подсказка, предпросмотра нет', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('  \n') });
    mount();
    await act(async () => button('Вставить из буфера').click());
    expect(host.textContent).toContain('В буфере пусто');
  });
});

describe('одна книга: вставка → предпросмотр → полка', () => {
  it('сохраняет, очищает форму и говорит «Книга на полке · Открыть»', async () => {
    await paste(book('Тихая работа'));
    expect(host.querySelector<HTMLInputElement>('.pv input')?.value).toBe('Тихая работа');

    await act(async () => button('Сохранить на полку').click());
    await vi.waitFor(() => expect(books.value).toHaveLength(1));

    expect(books.value[0].title).toBe('Тихая работа');
    expect(await getAllBooks()).toHaveLength(1);
    expect(area().value).toBe('');
    expect(host.querySelector('.pv')).toBeNull();
    const t = toasts.value.at(-1)!;
    expect(t.text).toBe('Книга на полке');
    expect(t.action?.label).toBe('Открыть');
    act(() => t.action!.run());
    expect(location.hash).toBe(`#/book/${books.value[0].id}`);
  });

  it('название, раздел и теги можно поправить до сохранения', async () => {
    await paste(book('Тихая работа'));
    const input = (sel: string) => host.querySelector<HTMLInputElement>(sel)!;
    await act(async () => {
      const title = host.querySelector<HTMLInputElement>('.pv input[type=text]')!;
      title.value = 'Тишина';
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      const tags = [...host.querySelectorAll<HTMLInputElement>('.pv input[type=text]')].at(-1)!;
      tags.value = 'сон,  отдых ,#покой';
      tags.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input('.pv input[type=text]').value).toBe('Тишина');
    await act(async () => button('Сохранить на полку').click());
    await vi.waitFor(() => expect(books.value).toHaveLength(1));
    expect(books.value[0].title).toBe('Тишина');
    expect(books.value[0].tags).toEqual(['сон', 'отдых', 'покой']);
  });

  it('новый раздел: пункт «Новый раздел…» открывает поле', async () => {
    const other = sampleBook('Другая', 1, { id: 'other', category: 'Здоровье' });
    await saveImportedBook(other.meta, other.chapters);
    await paste(book('Тихая работа'));
    const select = host.querySelector<HTMLSelectElement>('.pv select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Психология', 'Здоровье', 'Новый раздел…']);
    await act(async () => {
      select.value = select.options[select.options.length - 1].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const custom = [...host.querySelectorAll<HTMLInputElement>('.pv input[type=text]')].at(-2)!;
    await act(async () => {
      custom.value = 'Мой раздел';
      custom.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Сохранить на полку').click());
    await vi.waitFor(() => expect(books.value.map((b) => b.title)).toContain('Тихая работа'));
    expect(books.value.find((b) => b.title === 'Тихая работа')?.category).toBe('Мой раздел');
  });

  it('грязная вставка: вступление Claude, забор ```markdown и вопрос в конце', async () => {
    await paste(`Вот разбор, как просил:\n\n\`\`\`markdown\n${book('Тихая работа')}\n\`\`\`\n\nХочешь, сделаю продолжение?`);
    expect(host.querySelector<HTMLInputElement>('.pv input')?.value).toBe('Тихая работа');
  });
});

describe('пустой текст', () => {
  it('«Пустой текст», кнопка сохранения неактивна, ничего не пишется', async () => {
    await paste('!!! ??? ...');
    expect(host.querySelector('.pv__warn--stop')?.textContent).toBe('Пустой текст');
    expect(button('Сохранить на полку').disabled).toBe(true);
    await settle();
    expect(books.value).toHaveLength(0);
  });
});

describe('несколько книг', () => {
  const two = `${book('Первая книга')}\n\n${book('Вторая книга')}`;

  it('два предпросмотра и «Сохранить все (2)»', async () => {
    await paste(two);
    expect(host.querySelectorAll('.pv')).toHaveLength(2);
    expect(host.querySelector('.pv__label')?.textContent).toBe('Книга 1 из 2');
    await act(async () => button('Сохранить все (2)').click());
    await vi.waitFor(() => expect(books.value).toHaveLength(2));
    expect(toastTexts().at(-1)).toBe('Добавлено 2');
    expect(host.querySelector('.pv')).toBeNull();
    expect(area().value).toBe('');
  });

  it('одну из двух можно сохранить отдельно, вторая остаётся', async () => {
    await paste(two);
    const save = [...host.querySelectorAll<HTMLButtonElement>('.pv .btn--primary')][0];
    await act(async () => save.click());
    await vi.waitFor(() => expect(books.value).toHaveLength(1));
    expect(host.querySelectorAll('.pv')).toHaveLength(1);
    expect(area().value).not.toBe('');
  });

  it('«Убрать из списка» убирает книгу из предпросмотра', async () => {
    await paste(two);
    await act(async () => host.querySelector<HTMLButtonElement>('.pv [aria-label="Убрать из списка"]')!.click());
    expect(host.querySelectorAll('.pv')).toHaveLength(1);
    expect(has('Сохранить все')).toBe(false);
  });
});

describe('дубли', () => {
  async function shelve(title: string, chapters = 3) {
    const b = sampleBook(title, chapters, { id: 'old', category: 'Моё' });
    await saveImportedBook(b.meta, b.chapters);
  }

  it('то же название: «Обновить» по умолчанию, выбор из трёх', async () => {
    await shelve('Тихая работа');
    await paste(book('Тихая работа'));
    const radios = [...host.querySelectorAll<HTMLElement>('.pv [role=radio]')];
    expect(radios.map((r) => r.textContent)).toEqual(['Обновить', 'Дописать', 'Отдельно']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('.pv__note')?.textContent).toContain('Прогресс и отметки останутся');
  });

  it('«Дописать» прячет название и добавляет главы в конец', async () => {
    await shelve('Тихая работа', 3);
    // у части 2 свои главы: часть с теми же главами, что уже в книге, — «Эта часть уже в книге»
    await paste(book('Тихая работа', 2, 'part: 2/2\n').replaceAll('## Глава ', '## Продолжение '));
    // часть 2 → «Дописать» уже выбрано
    expect(host.querySelector('.pv [role=radio][aria-checked=true]')?.textContent).toBe('Дописать');
    expect(host.querySelector('.pv input[type=text]')).toBeNull();
    await act(async () => button('Сохранить на полку').click());
    await vi.waitFor(async () => expect((await getChapters('old')).length).toBe(5));
    expect(books.value).toHaveLength(1);
    expect(toastTexts().at(-1)).toBe('Главы дописаны');
  });

  it('часть, которая уже в книге: «Эта часть уже в книге», ничего не выбрано, сохранять нечего', async () => {
    const part = (n: number, names: string[]) =>
      `---\ntitle: Тихая работа\ncategory: Психология\npart: ${n}/2\n---\n` +
      names.map((t) => `## ${t}\nТекст главы «${t}», в ней несколько слов.`).join('\n\n');
    const { readInput, commitDraft } = await import('./importFlow');
    for (const [i, text] of [part(1, ['Начало', 'Середина']), part(2, ['Развязка', 'Итог'])].entries()) {
      const res = readInput(text, 'paste');
      if (res.kind !== 'books') throw new Error('книги');
      await commitDraft(res.drafts[0], 1_700_000_000_000 + i);
    }

    await paste(part(1, ['Начало', 'Середина']));
    expect(host.querySelector('.pv__dup strong')?.textContent).toBe('Эта часть уже в книге');
    expect(host.querySelector('.pv [role=radio][aria-checked=true]')).toBeNull();
    expect(button('Сохранить на полку').disabled).toBe(true);

    // Можно всё же выбрать действие: тогда сохранить можно
    await act(async () => [...host.querySelectorAll<HTMLElement>('.pv [role=radio]')][1].click());
    expect(host.querySelector('.pv [role=radio][aria-checked=true]')?.textContent).toBe('Дописать');
    expect(button('Сохранить на полку').disabled).toBe(false);
  });

  it('«Отдельно» делает вторую книгу', async () => {
    await shelve('Тихая работа');
    await paste(book('Тихая работа'));
    await act(async () => [...host.querySelectorAll<HTMLElement>('.pv [role=radio]')][2].click());
    await act(async () => button('Сохранить на полку').click());
    await vi.waitFor(() => expect(books.value).toHaveLength(2));
  });

  it('тот же текст: «Уже на полке», «Открыть», кнопки сохранения нет', async () => {
    mount();
    const text = book('Тихая работа');
    // кладём на полку то, что разберёт вставка, чтобы хеши совпали
    const { readInput, commitDraft } = await import('./importFlow');
    const res = readInput(text, 'paste');
    if (res.kind !== 'books') throw new Error('книги');
    const saved = await commitDraft(res.drafts[0], 1_700_000_000_000);
    act(() => render(null, host));
    await paste(text);
    expect(host.querySelector('.pv__dup--same')?.textContent).toContain('Уже на полке');
    const open = host.querySelector<HTMLAnchorElement>('.pv__dup--same a')!;
    expect(open.getAttribute('href')).toBe(`#/book/${saved.bookId}`);
    expect(has('Сохранить на полку')).toBe(false);
  });
});

describe('копия библиотеки', () => {
  function backup(titles: string[], exportedAt = 1_795_000_000_000): BackupFile {
    const made = titles.map((t, i) => sampleBook(t, 2, { id: `b${i}`, now: 1_700_000_000_000 + i }));
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      app: 'test',
      books: made.map(({ meta, chapters }) => {
        const { chapters: _s, ...rest } = meta;
        void _s;
        return { ...rest, chapters: chapters.map((c) => ({ title: c.title, md: c.md })) };
      }),
      progress: [],
      marks: [],
      tasks: [],
      settings: {},
    };
  }

  it('JSON копии → подтверждение «Восстановить копию: книг N» → итог и дата последней копии', async () => {
    await paste(JSON.stringify(backup(['Первая', 'Вторая'])));
    expect(host.querySelector('.restore__title')?.textContent).toBe('Восстановить копию: книг 2');
    expect(host.querySelector('.pv')).toBeNull();
    expect(books.value).toHaveLength(0); // пока не подтвердили — ничего не записано

    await act(async () => button('Восстановить').click());
    await vi.waitFor(() => expect(books.value).toHaveLength(2));
    expect(toastTexts().at(-1)).toBe('Добавлено 2, обновлено 0, пропущено 0');
    expect(settings.value.lastBackupAt).toBe(1_795_000_000_000);
    expect(settings.value.booksAtLastBackup).toBe(2);
    expect(host.querySelector('.restore')).toBeNull();
    expect(area().value).toBe('');
  });

  it('«Отмена» ничего не восстанавливает', async () => {
    await paste(JSON.stringify(backup(['Первая'])));
    await act(async () => button('Отмена').click());
    expect(host.querySelector('.restore')).toBeNull();
    expect(books.value).toHaveLength(0);
  });

  it('битая копия: ошибка в поле, предпросмотра нет', async () => {
    mount();
    await act(async () => {
      area().value = JSON.stringify({ format: BACKUP_FORMAT, version: 99, books: [] });
      area().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.waitFor(() => expect(host.querySelector('.addbox__note--problem')).not.toBeNull(), { timeout: 2000 });
    expect(host.querySelector('.pv, .restore')).toBeNull();
  });

  it('оборванная вставка копии: ошибка в поле, «книги» из обрывка JSON нет', async () => {
    const whole = JSON.stringify(backup(['Первая', 'Вторая']));
    mount();
    await act(async () => {
      area().value = whole.slice(0, Math.floor(whole.length / 2));
      area().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.waitFor(() => expect(host.querySelector('.addbox__note--problem')).not.toBeNull(), { timeout: 2000 });
    expect(host.querySelector('.addbox__note--problem')?.textContent).toContain('Файл копии повреждён');
    expect(host.querySelector('.pv, .restore')).toBeNull();
    expect(has('Сохранить на полку')).toBe(false);
  });

  /** Выбор файлов: jsdom не умеет выбирать файлы, поэтому подкладываем «файлы» с `name` и `text()`. */
  async function pick(...picked: { name: string; text: string }[]) {
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: picked.map((f) => ({ name: f.name, text: async () => f.text })),
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('выбранный файл копии: подтверждение, как при вставке', async () => {
    mount();
    await pick({ name: 'kisr-library-backup-2026-11-22.json', text: JSON.stringify(backup(['Первая'])) });
    await vi.waitFor(() => expect(host.querySelector('.restore__title')?.textContent).toBe('Восстановить копию: книг 1'));
  });

  it('выбранный оборванный файл копии: тост с причиной, а не «Не удалось прочитать: имя»; книги нет', async () => {
    const whole = JSON.stringify(backup(['Первая', 'Вторая']));
    mount();
    await pick({ name: 'kisr-library-backup-2026-11-22.json', text: whole.slice(0, 200) });
    await vi.waitFor(() => expect(toastTexts()).toContain('Файл копии повреждён или сделан более новой версией приложения'));
    expect(toastTexts().some((t) => t.startsWith('Не удалось прочитать'))).toBe(false);
    expect(toastTexts().some((t) => t.startsWith('В выбранных файлах нет текста'))).toBe(false);
    expect(host.querySelector('.pv, .restore')).toBeNull();
  });

  it('несколько файлов: у оборванного в тосте его имя, остальные читаются', async () => {
    mount();
    await pick(
      { name: 'книга.md', text: book('Тихая работа') },
      { name: 'копия.json', text: '{"format": "kisr-library-backup", "versi' },
    );
    await vi.waitFor(() => expect(host.querySelector('.pv')).not.toBeNull());
    expect(toastTexts()).toContain('копия.json: Файл копии повреждён или сделан более новой версией приложения');
    expect(host.querySelectorAll('.pv')).toHaveLength(1);
  });
});

describe('«Поделиться» (?shared=1)', () => {
  it('забирает текст и файлы из inbox и показывает предпросмотр', async () => {
    await putInbox({
      id: 'a',
      at: 1,
      text: book('Из сообщения'),
      files: [{ name: 'вторая_книга.md', text: 'Текст без шапки, просто несколько слов.' }],
    });
    mount(true);
    await vi.waitFor(() => expect(host.querySelectorAll('.pv')).toHaveLength(2), { timeout: 2000 });
    const titles = [...host.querySelectorAll<HTMLInputElement>('.pv input[type=text]:first-of-type')].map((i) => i.value);
    expect(titles).toContain('Из сообщения');
    expect(titles).toContain('вторая книга');
    expect(location.hash).toBe('#/add');
  });

  it('один файл оборван — у него в тосте имя, а остальные файлы того же «Поделиться» читаются', async () => {
    await putInbox({
      id: 'a',
      at: 1,
      files: [
        { name: 'копия.json', text: '{"format": "kisr-library-backup", "versi' },
        { name: 'книга.md', text: book('Тихая работа') },
      ],
    });
    mount(true);
    await vi.waitFor(() => expect(host.querySelectorAll('.pv')).toHaveLength(1), { timeout: 2000 });
    expect(host.querySelector<HTMLInputElement>('.pv input[type=text]')?.value).toBe('Тихая работа');
    expect(toastTexts()).toContain('копия.json: Файл копии повреждён или сделан более новой версией приложения');
    expect(toastTexts()).not.toContain('Из «Поделиться» ничего не пришло');
  });
});

describe('«Попросить Claude»', () => {
  const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(async () => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const topic = () => host.querySelector<HTMLInputElement>('.pb input[type=text]')!;

  it('пока темы нет, копировать нечего', () => {
    mount();
    expect(button('Скопировать запрос').disabled).toBe(true);
    expect(button('Открыть Claude').disabled).toBe(true);
  });

  it('копирует запрос со скиллом и показывает тост', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    mount();
    await type(topic(), 'Как работает память');
    await act(async () => button('Скопировать запрос').click());
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt.startsWith('Разбор для Kisr Library: Как работает память')).toBe(true);
    expect(prompt).toContain('2000–3500 слов'); // «Средне» по умолчанию
    expect(toastTexts()).toContain('Запрос скопирован');
  });

  it('«Открыть Claude» открывает ссылку в новой вкладке', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mount();
    await type(topic(), 'Как работает память');
    await act(async () => button('Открыть Claude').click());
    const prompt = 'Разбор для Kisr Library: Как работает память\n\nОбъём: Средне — 2000–3500 слов.';
    expect(open).toHaveBeenCalledWith(claudeUrl(prompt), '_blank', 'noopener');
  });

  it('без скилла запрос длинный: кнопки «Открыть Claude» нет, есть пояснение', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    mount();
    await type(topic(), 'Как работает память');
    await act(async () => host.querySelector<HTMLInputElement>('.switch__input')!.click());
    expect(has('Открыть Claude')).toBe(false);
    expect(host.textContent).toContain('в ссылку не поместится');
    await act(async () => button('Скопировать запрос').click());
    expect(writeText.mock.calls[0][0]).toContain('Правила разметки');
  });

  it('переключатель скилла по умолчанию включён и запоминается', async () => {
    mount();
    const sw = () => host.querySelector<HTMLInputElement>('.switch__input')!;
    expect(sw().checked).toBe(true);
    await act(async () => sw().click());
    expect(sw().checked).toBe(false);
    expect(localStorage.getItem('kisr-library:skill-installed')).toBe('0');

    act(() => render(null, host));
    mount();
    expect(sw().checked).toBe(false);
  });

  it('объём меняет запрос', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    mount();
    await type(topic(), 'Сон');
    await act(async () => [...host.querySelectorAll<HTMLElement>('.pb [role=radio]')].find((r) => r.textContent === 'Подробно')!.click());
    await act(async () => button('Скопировать запрос').click());
    expect(writeText.mock.calls[0][0]).toContain('4000–6000 слов');
  });

  it('если буфер недоступен, показывает текст запроса для ручного копирования', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    mount();
    await type(topic(), 'Сон');
    await act(async () => button('Скопировать запрос').click());
    expect(host.querySelector<HTMLDetailsElement>('.pb__text')?.open).toBe(true);
    expect(toastTexts().at(-1)).toContain('Не удалось скопировать');
  });
});

describe('«Как это работает»', () => {
  it('три шага и подсказка про файлы и части', () => {
    mount();
    const steps = [...host.querySelectorAll('.how__steps li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Попроси Claude: «Разбор для Kisr Library: <тема>» (или собери запрос ниже).',
      'Скопируй ответ целиком.',
      'Нажми «Вставить из буфера» и «Сохранить на полку».',
    ]);
    expect(host.querySelector('.how__more')?.textContent).toContain('«Выбрать файлы»');
    expect(host.querySelector('.how__more')?.textContent).toContain('«Дописать»');
  });
});
