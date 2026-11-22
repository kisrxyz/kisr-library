import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupFile } from '../../core/backup';
import { buildBook } from '../../core/book';
import { newProgress } from '../../core/progress';
import { getAllBooks, getChapters, getBook } from '../../db/books';
import { getAllProgress } from '../../db/progress';
import { freshDb, sampleBook } from '../../db/testing';
import { __resetLibraryForTests, books, progressMap, saveImportedBook, saveProgress } from '../../state/library';
import { settings } from '../../state/settings';
import { DEFAULT_SETTINGS } from '../../core/types';
import {
  __resetImportFlowForTests,
  canSaveDraft,
  commitDraft,
  draftWarnings,
  isEmptyDraft,
  readInput,
  restoreBackup,
  savedMessage,
  type Draft,
} from './importFlow';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', 'core', '__fixtures__', name), 'utf8');
const full = fixture('full.md');
const twoBooks = fixture('two-books.md');

/** Книга в текстовом формате: шапка, вступление и N глав. */
function bookText(title: string, chapters: number, extra = ''): string {
  const body = Array.from({ length: chapters }, (_, i) => `## Глава ${i + 1}\nТекст главы ${i + 1} про «${title}».`).join('\n\n');
  return `---\ntitle: ${title}\ncategory: Психология\ntags: [один, два]\nsummary: Описание.\nsource: нет\n${extra}---\nВступление книги «${title}», в нём несколько слов.\n\n${body}\n`;
}

function drafts(text: string, source: Draft['source'] = 'paste', fileName?: string): Draft[] {
  const r = readInput(text, source, fileName);
  if (r.kind !== 'books') throw new Error('Ожидались книги, а не копия');
  return r.drafts;
}

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
  __resetImportFlowForTests();
  settings.value = { ...DEFAULT_SETTINGS };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readInput: что вставили', () => {
  it('одна книга → один черновик «Отдельно» с полями из шапки', () => {
    const list = drafts(full);
    expect(list).toHaveLength(1);
    const [d] = list;
    expect(d.resolution).toBe('separate');
    expect(d.dup).toBeNull();
    expect(d.title).toBe('Как заварить хороший чай');
    expect(d.category).toBe('Быт');
    expect(d.tags).toEqual(['чай', 'кухня', 'привычки']);
    expect(d.source).toBe('paste');
    expect(d.hash).toMatch(/^[0-9a-z]+$/);
    expect(d.key).toBeTruthy();
  });

  it('две книги подряд → два черновика с разными ключами', () => {
    const list = drafts(twoBooks);
    expect(list.map((d) => d.title)).toEqual(['Первая синтетическая книга', 'Вторая синтетическая книга']);
    expect(new Set(list.map((d) => d.key)).size).toBe(2);
  });

  it('копия библиотеки (JSON) → kind: backup', () => {
    const file: BackupFile = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: 1,
      app: 'test',
      books: [],
      progress: [],
      marks: [],
      tasks: [],
      settings: {},
    };
    const r = readInput(JSON.stringify(file), 'file', 'kisr-library-backup-2026-11-22.json');
    expect(r.kind).toBe('backup');
    if (r.kind === 'backup') expect(r.file.exportedAt).toBe(1);
  });

  it('JSON с форматом копии, но битый по форме, — ошибка, а не «книга» из JSON', () => {
    const broken = JSON.stringify({ format: BACKUP_FORMAT, version: 99, books: [] });
    expect(() => readInput(broken, 'paste')).toThrow(/копи/i);
  });

  describe('копия, которую не удалось разобрать', () => {
    const whole = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: 1,
      app: 'test',
      books: [{ id: 'a', title: 'Книга', chapters: [{ title: 'Г', md: 'текст главы' }] }],
      progress: [],
      marks: [],
      tasks: [],
      settings: {},
    });
    const truncated = whole.slice(0, Math.floor(whole.length * 0.6));

    it('оборванный файл копии (.json) — ошибка, а не «книга» с названием по имени файла', () => {
      expect(() => readInput(truncated, 'file', 'kisr-library-backup-2026-11-22.json')).toThrow(
        'Файл копии повреждён или сделан более новой версией приложения',
      );
    });

    it('оборванная вставка копии (в тексте есть kisr-library-backup) — ошибка', () => {
      expect(() => readInput(truncated, 'paste')).toThrow(/повреждён/);
    });

    it('запятая в конце и прочие поломки того же файла — тоже ошибка', () => {
      expect(() => readInput(whole.replace('"settings":{}', '"settings":{},'), 'file', 'копия.json')).toThrow(/повреждён/);
    });

    it('любой .json, который не разбирается, — ошибка; пустой файл — просто нет книг', () => {
      expect(() => readInput('{"a": 1,', 'file', 'data.json')).toThrow(/повреждён/);
      expect(() => readInput('[1, 2', 'file', 'data.json')).toThrow(/повреждён/);
      expect(readInput('  \n', 'file', 'data.json')).toEqual({ kind: 'books', drafts: [] });
    });

    it('имя кончается на «json», но без точки (не .json-файл) — это текст, а не сломанная копия', () => {
      const list = drafts('{ заметки о книге, а не копия', 'file', 'заметки-json');
      expect(list).toHaveLength(1);
      expect(list[0].parsed.chapters[0].md).toContain('заметки о книге');
    });

    it('чужой JSON-подобный текст без имени .json и без слова «kisr-library-backup» — по-прежнему текст', () => {
      const [d] = drafts('{"a": 1,', 'paste');
      expect(d.parsed.chapters[0].title).toBe('Текст');
      expect(drafts('{не json}', 'file', 'заметка.txt')).toHaveLength(1);
    });

    it('целая копия по-прежнему читается', () => {
      expect(readInput(whole, 'file', 'kisr-library-backup-2026-11-22.json').kind).toBe('backup');
    });
  });

  it('чужой JSON и JSON-подобный текст — обычный текст книги', () => {
    const list = drafts('{"a": 1}', 'file', 'data.json');
    expect(list).toHaveLength(1);
    expect(list[0].parsed.chapters[0].title).toBe('Текст');
  });

  it('болтовня между книгами в заборах не попадает в книги и не меняет хеш', () => {
    const src = '- [Автор, 2020. Название](https://example.com)';
    const wrapped = (t: string) => `\`\`\`markdown\n---\ntitle: ${t}\n---\n## Глава\nтекст ${t}\n\n## Источники\n${src}\n\`\`\``;
    const chatty = drafts(`Вот первая, как просил:\n\n${wrapped('А')}\n\nА вот вторая, как просил:\n\n${wrapped('Б')}\n\nХочешь третью?`);
    const clean = drafts(`${wrapped('А')}\n\n${wrapped('Б')}`);
    expect(chatty.map((d) => d.parsed.chapters.at(-1)!.md)).toEqual([src, src]);
    expect(chatty.map((d) => d.hash)).toEqual(clean.map((d) => d.hash));
  });

  it('много текста после книги в заборе: он отброшен, а в предпросмотре есть предупреждение', () => {
    const tail = Array.from({ length: 50 }, () => 'болтовня').join(' ');
    const [d] = drafts(`\`\`\`markdown\n${bookText('Тихая работа', 2)}\`\`\`\n\n${tail}`);
    expect(d.parsed.chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2']);
    expect(d.parsed.chapters.at(-1)!.md).not.toContain('болтовня');
    expect(draftWarnings(d)).toContain('После книги отброшен текст (50 слов) — проверь, не потерялась ли часть книги');
  });

  it('пустая вставка → нет черновиков', () => {
    expect(drafts('  \n\n ')).toEqual([]);
    expect(drafts('')).toEqual([]);
  });

  it('мусорный текст «привет» → один черновик с предупреждением и главой «Текст»', () => {
    const list = drafts('привет');
    expect(list).toHaveLength(1);
    expect(list[0].parsed.chapters.map((c) => c.title)).toEqual(['Текст']);
    expect(list[0].parsed.warnings.length).toBeGreaterThan(0);
    expect(draftWarnings(list[0]).length).toBeGreaterThan(0);
    expect(list[0].title).toBe('Без названия');
  });

  it('имя файла — запасное название', () => {
    const [d] = drafts('Просто текст без шапки.', 'file', 'моя_заметка.txt');
    expect(d.title).toBe('моя заметка');
    expect(d.source).toBe('file');
  });

  it('грязная вставка: вступление Claude, забор ```markdown и вопрос в конце', () => {
    const messy = `Вот разбор:\n\n\`\`\`\`markdown\n${bookText('Тихая работа', 2)}\`\`\`\`\n\nХочешь, сделаю продолжение?`;
    const list = drafts(messy);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Тихая работа');
    // короткое вступление (меньше 40 слов) приклеивается к первой главе
    expect(list[0].parsed.chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2']);
  });

  it('пустой текст: ни одного слова — черновик помечен и сохранить его нельзя', () => {
    const [d] = drafts('!!! ??? ...');
    expect(isEmptyDraft(d)).toBe(true);
    expect(draftWarnings(d)).toEqual(['Пустой текст']);
    expect(canSaveDraft(d)).toBe(false);
  });

  it('обычная книга сохраняется, «Пустой текст» ей не пишется', () => {
    const [d] = drafts(full);
    expect(isEmptyDraft(d)).toBe(false);
    expect(draftWarnings(d)).not.toContain('Пустой текст');
    expect(canSaveDraft(d)).toBe(true);
  });
});

describe('readInput: дубли с полкой', () => {
  async function shelve(text: string, id = 'tihaya') {
    const [d] = drafts(text);
    const built = buildBook({ ...d.parsed }, { origin: 'paste', id, now: 1_700_000_000_000 });
    await saveImportedBook(built.meta, built.chapters);
    return built;
  }

  it('то же название → «Обновить»; часть 2+ → «Дописать»', async () => {
    await shelve(bookText('Тихая работа', 2));
    const [again] = drafts(bookText('тихая  работа!', 3));
    expect(again.dup?.kind).toBe('same-title');
    expect(again.resolution).toBe('update');
    // у части 2 свои главы (часть с теми же главами, что уже в книге, — «Пропустить», см. ниже)
    const [cont] = drafts(bookText('Тихая работа', 1, 'part: 2/2\n').replace('## Глава 1', '## Глава 3'));
    expect(cont.resolution).toBe('append');
  });

  it('тот же текст → «Пропустить»', async () => {
    await shelve(bookText('Тихая работа', 2));
    const [same] = drafts(bookText('Тихая работа', 2));
    expect(same.dup?.kind).toBe('same-content');
    expect(same.resolution).toBe('skip');
    expect(canSaveDraft(same)).toBe(false);
  });

  describe('часть, которая уже в книге (буфер ещё хранит её)', () => {
    const part = (n: number, names: string[]) =>
      `---\ntitle: Тихая работа\ncategory: Психология\npart: ${n}/2\n---\n` +
      names.map((t) => `## ${t}\nТекст главы «${t}», в ней несколько слов.`).join('\n\n');
    const part1 = part(1, ['Начало', 'Середина']);
    const part2 = part(2, ['Развязка', 'Итог']);

    async function assembled(): Promise<string> {
      const first = await commitDraft(drafts(part1)[0], 1_700_000_000_000);
      const [second] = drafts(part2);
      expect(second.resolution).toBe('append');
      await commitDraft(second, 1_700_000_001_000);
      expect((await getChapters(first.bookId)).map((c) => c.title)).toEqual(['Начало', 'Середина', 'Развязка', 'Итог']);
      return first.bookId;
    }

    it('часть 1 ещё раз после того, как части собраны: «Пропустить», часть 2 не пропадает', async () => {
      const id = await assembled();
      const [again] = drafts(part1);
      expect(again.dup?.kind).toBe('same-title');
      expect(again.resolution).toBe('skip');
      expect(canSaveDraft(again)).toBe(false);
      expect(await commitDraft(again, 1_700_000_002_000)).toEqual({ bookId: id, action: 'skipped' });
      expect((await getChapters(id)).map((c) => c.title)).toEqual(['Начало', 'Середина', 'Развязка', 'Итог']);
    });

    it('часть 2 ещё раз: «Пропустить», главы не задваиваются', async () => {
      const id = await assembled();
      const [again] = drafts(part2);
      expect(again.resolution).toBe('skip');
      await commitDraft(again, 1_700_000_002_000);
      expect(await getChapters(id)).toHaveLength(4);
    });

    it('изменённая часть 2 по-прежнему «Дописать»', async () => {
      await assembled();
      const [changed] = drafts(part2.replace('в ней несколько слов.', 'в ней теперь больше слов, чем было.'));
      expect(changed.resolution).toBe('append');
    });
  });

  it('если в шапке нет раздела и тегов, обновление не стирает раздел и теги книги на полке', async () => {
    const old = sampleBook('Тихая работа', 2, { id: 'tihaya', category: 'Моё' });
    await saveImportedBook(old.meta, old.chapters);
    const [d] = drafts('---\ntitle: Тихая работа\n---\n## Глава\nНовый текст книги.');
    expect(d.dup?.kind).toBe('same-title');
    expect(d.category).toBe('Моё');
    expect(d.tags).toEqual(['тест']);
  });

  it('раздел из шапки пишется так, как он уже назван на полке', async () => {
    const old = sampleBook('Другая', 1, { id: 'other', category: 'Психология' });
    await saveImportedBook(old.meta, old.chapters);
    const [d] = drafts(bookText('Новая книга', 1).replace('category: Психология', 'category: психология'));
    expect(d.category).toBe('Психология');
  });
});

describe('commitDraft', () => {
  it('«Отдельно» → новая книга; название, раздел и теги берутся из черновика', async () => {
    const [d] = drafts(full);
    const draft: Draft = { ...d, title: 'Чай по-моему', category: 'Кухня', tags: ['чай'] };
    const res = await commitDraft(draft, 1_700_000_000_000);
    expect(res.action).toBe('added');
    const saved = await getBook(res.bookId);
    expect(saved?.title).toBe('Чай по-моему');
    expect(saved?.category).toBe('Кухня');
    expect(saved?.tags).toEqual(['чай']);
    expect(saved?.origin).toBe('paste');
    expect(books.value.map((b) => b.id)).toContain(res.bookId);
    expect((await getChapters(res.bookId)).length).toBe(saved?.chapters.length);
  });

  it('пустой раздел → «Разное»; origin = источник черновика', async () => {
    const [d] = drafts('Просто текст без шапки.', 'share');
    const res = await commitDraft({ ...d, category: '' }, 1_700_000_000_000);
    const saved = await getBook(res.bookId);
    expect(saved?.category).toBe('Разное');
    expect(saved?.origin).toBe('share');
  });

  it('две книги с одним названием в одну миллисекунду не затирают друг друга', async () => {
    const [d] = drafts(bookText('Тихая работа', 1));
    const [d2] = drafts(bookText('Тихая работа', 2));
    const a = await commitDraft({ ...d, resolution: 'separate' }, 1_700_000_000_000);
    const b = await commitDraft({ ...d2, resolution: 'separate' }, 1_700_000_000_000);
    expect(a.bookId).not.toBe(b.bookId);
    expect(await getAllBooks()).toHaveLength(2);
  });

  it('«Обновить» сохраняет id и дату создания, заменяет главы и ограничивает прогресс', async () => {
    const old = sampleBook('Тихая работа', 4, { id: 'tihaya', now: 1_700_000_000_000 });
    await saveImportedBook(old.meta, old.chapters);
    await saveProgress({ ...newProgress('tihaya', 1), chapter: 4, maxChapter: 4, chaptersDone: [1, 2, 3, 4], wordsRead: 30, blockKey: 'x', percent: 100 });

    const [d] = drafts(bookText('Тихая работа', 2)); // из 4 глав стало 2
    expect(d.resolution).toBe('update');
    const res = await commitDraft(d, 1_800_000_000_000);

    expect(res).toEqual({ bookId: 'tihaya', action: 'updated' });
    const saved = await getBook('tihaya');
    expect(saved?.chapters).toHaveLength(2);
    expect(saved?.createdAt).toBe(1_700_000_000_000);
    expect(saved?.updatedAt).toBe(1_800_000_000_000);
    expect(await getAllBooks()).toHaveLength(1);
    expect(await getChapters('tihaya')).toHaveLength(2);

    const p = (await getAllProgress()).find((x) => x.bookId === 'tihaya')!;
    expect(p.chapter).toBe(2);
    expect(p.maxChapter).toBe(2);
    expect(p.chaptersDone).toEqual([1, 2]);
    expect(progressMap.value.get('tihaya')).toEqual(p);
  });

  it('«Дописать» добавляет главы в конец и не трогает название книги и прогресс в пределах', async () => {
    const old = sampleBook('Тихая работа', 2, { id: 'tihaya', category: 'Моё' });
    await saveImportedBook(old.meta, old.chapters);
    await saveProgress({ ...newProgress('tihaya', 1), chapter: 2, maxChapter: 2, blockKey: 'abc', wordsRead: 8 });

    const [d] = drafts(bookText('Тихая работа', 2, 'part: 2/2\n'));
    expect(d.resolution).toBe('append');
    const res = await commitDraft({ ...d, title: 'Я передумал', category: 'Другое' }, 1_800_000_000_000);

    expect(res).toEqual({ bookId: 'tihaya', action: 'appended' });
    const saved = await getBook('tihaya');
    expect(saved?.title).toBe('Тихая работа');
    expect(saved?.category).toBe('Моё');
    expect(saved?.chapters.map((c) => c.title)).toEqual(['Глава 1', 'Глава 2', 'Глава 1', 'Глава 2']);
    expect((await getChapters('tihaya')).map((c) => c.order)).toEqual([1, 2, 3, 4]);
    const p = (await getAllProgress()).find((x) => x.bookId === 'tihaya')!;
    expect(p.chapter).toBe(2);
    expect(p.blockKey).toBe('abc');
  });

  describe('«Дописать» в прочитанную книгу', () => {
    async function finishedBook() {
      const old = sampleBook('Тихая работа', 2, { id: 'tihaya' });
      await saveImportedBook(old.meta, old.chapters);
      await saveProgress({
        ...newProgress('tihaya', 1),
        chapter: 2,
        maxChapter: 2,
        chaptersDone: [1, 2],
        wordsRead: old.meta.words,
        percent: 100,
        status: 'finished',
        finishedAt: 1_750_000_000_000,
        blockKey: 'abc',
      });
      return old;
    }

    it('книга снова «Читаю»: процент от нового объёма, позиция и отметки остались, finishedAt убран', async () => {
      const old = await finishedBook();
      const [d] = drafts(bookText('Тихая работа', 2, 'part: 2/2\n'));
      expect(d.resolution).toBe('append');
      await commitDraft(d, 1_800_000_000_000);

      const saved = await getBook('tihaya');
      const p = (await getAllProgress()).find((x) => x.bookId === 'tihaya')!;
      expect(saved?.chapters).toHaveLength(4);
      expect(p.status).toBe('reading');
      expect('finishedAt' in p).toBe(false);
      expect(p.wordsRead).toBe(old.meta.words);
      expect(p.percent).toBe(Math.round((old.meta.words / saved!.words) * 100));
      expect(p.percent).toBeLessThan(100);
      expect(p.chapter).toBe(2);
      expect(p.chaptersDone).toEqual([1, 2]);
      expect(p.blockKey).toBe('abc');
      expect(progressMap.value.get('tihaya')).toEqual(p);
    });

    it('«Обновить» прочитанной книги статус не трогает', async () => {
      await finishedBook();
      const [d] = drafts(bookText('Тихая работа', 3));
      expect(d.resolution).toBe('update');
      await commitDraft(d, 1_800_000_000_000);
      const p = (await getAllProgress()).find((x) => x.bookId === 'tihaya')!;
      expect(p.status).toBe('finished');
      expect(p.percent).toBe(100);
    });

    it('начатая книга остаётся «Читаю», как была', async () => {
      const old = sampleBook('Тихая работа', 2, { id: 'tihaya' });
      await saveImportedBook(old.meta, old.chapters);
      await saveProgress({ ...newProgress('tihaya', 1), chapter: 1, wordsRead: 5, percent: 25 });
      const [d] = drafts(bookText('Тихая работа', 2, 'part: 2/2\n'));
      await commitDraft(d, 1_800_000_000_000);
      const p = (await getAllProgress()).find((x) => x.bookId === 'tihaya')!;
      expect(p.status).toBe('reading');
      expect(p.wordsRead).toBe(5);
    });
  });

  it('«Пропустить» ничего не пишет', async () => {
    const old = sampleBook('Тихая работа', 2, { id: 'tihaya' });
    await saveImportedBook(old.meta, old.chapters);
    const [d] = drafts(bookText('Тихая работа', 1));
    const before = JSON.stringify(await getAllBooks());
    const res = await commitDraft({ ...d, resolution: 'skip' }, 1_800_000_000_000);
    expect(res).toEqual({ bookId: 'tihaya', action: 'skipped' });
    expect(JSON.stringify(await getAllBooks())).toBe(before);
    expect(await getChapters('tihaya')).toHaveLength(2);
  });

  it('пустой черновик не сохраняется даже если до commitDraft дошёл', async () => {
    const [d] = drafts('!!! ???');
    const res = await commitDraft(d, 1_800_000_000_000);
    expect(res.action).toBe('skipped');
    expect(await getAllBooks()).toHaveLength(0);
  });

  it('книгу, которую уже удалили с полки, «Обновить» не воскрешает под старым id: она добавляется заново', async () => {
    const old = sampleBook('Тихая работа', 2, { id: 'tihaya' });
    await saveImportedBook(old.meta, old.chapters);
    const [d] = drafts(bookText('Тихая работа', 1));
    books.value = []; // книга ушла с полки, пока шёл предпросмотр
    const res = await commitDraft(d, 1_800_000_000_000);
    expect(res.action).toBe('added');
    expect(res.bookId).not.toBe('tihaya');
  });

  it('после первого добавления просит постоянное хранилище, один раз за сеанс', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });
    const [a] = drafts(bookText('Первая', 1));
    await commitDraft(a, 1_700_000_000_000);
    const [b] = drafts(bookText('Вторая', 1));
    await commitDraft(b, 1_700_000_000_001);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('если persist() падает или его нет, добавление всё равно проходит', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('нет')) } });
    const [a] = drafts(bookText('Первая', 1));
    await expect(commitDraft(a, 1_700_000_000_000)).resolves.toMatchObject({ action: 'added' });
    __resetImportFlowForTests();
    vi.stubGlobal('navigator', {});
    const [b] = drafts(bookText('Вторая', 1));
    await expect(commitDraft(b, 1_700_000_000_001)).resolves.toMatchObject({ action: 'added' });
  });
});

describe('savedMessage', () => {
  it('одна книга — своими словами', () => {
    expect(savedMessage([{ action: 'added' }])).toBe('Книга на полке');
    expect(savedMessage([{ action: 'updated' }])).toBe('Книга обновлена');
    expect(savedMessage([{ action: 'appended' }])).toBe('Главы дописаны');
  });

  it('несколько — итогом, пропущенные не считаются', () => {
    expect(savedMessage([{ action: 'added' }, { action: 'added' }, { action: 'updated' }, { action: 'skipped' }])).toBe(
      'Добавлено 2, обновлено 1',
    );
    expect(savedMessage([{ action: 'added' }, { action: 'skipped' }])).toBe('Книга на полке');
  });
});

describe('restoreBackup', () => {
  function backupOf(titles: string[], exportedAt = 1_795_000_000_000): BackupFile {
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

  it('сливает копию, считает итог и обновляет полку и сигналы', async () => {
    const res = await restoreBackup(backupOf(['Первая', 'Вторая', 'Третья']));
    expect(res).toEqual({ added: 3, updated: 0, skipped: 0 });
    expect(books.value).toHaveLength(3);
    expect(await getAllBooks()).toHaveLength(3);
  });

  it('напоминание о копии не срабатывает сразу после восстановления', async () => {
    await restoreBackup(backupOf(['Первая', 'Вторая', 'Третья', 'Четвёртая'], 1_795_000_000_000));
    expect(settings.value.lastBackupAt).toBe(1_795_000_000_000);
    expect(settings.value.booksAtLastBackup).toBe(4);
  });

  it('время копии из будущего не глушит напоминание: дата последней копии — «сейчас»', async () => {
    const before = Date.now();
    await restoreBackup(backupOf(['Первая'], before + 30 * 24 * 3600 * 1000));
    expect(settings.value.lastBackupAt).toBeGreaterThanOrEqual(before);
    expect(settings.value.lastBackupAt).toBeLessThanOrEqual(Date.now());
  });

  it('повторное восстановление того же файла: всё пропущено', async () => {
    const file = backupOf(['Первая']);
    await restoreBackup(file);
    expect(await restoreBackup(file)).toEqual({ added: 0, updated: 0, skipped: 1 });
  });

  it('книги, которые уже были на полке, тоже входят в booksAtLastBackup', async () => {
    const mine = sampleBook('Моя', 1, { id: 'mine' });
    await saveImportedBook(mine.meta, mine.chapters);
    await restoreBackup(backupOf(['Первая', 'Вторая']));
    expect(settings.value.booksAtLastBackup).toBe(3);
  });
});
