// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getMarks } from '../../db/marks';
import { freshDb } from '../../db/testing';
import type { Mark } from '../../core/types';
import { markId, paintMarks, saveNote, toggleHighlight } from './marks';

beforeEach(freshDb);

function block(key: string, html: string, tag = 'p'): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.key = key;
  el.innerHTML = html;
  return el;
}

const para = () => block('p1abc', 'Первый   абзац\nглавы.');

describe('markId', () => {
  it('книга|ключ блока', () => {
    expect(markId('kniga', 'p1abc')).toBe('kniga|p1abc');
  });
});

describe('toggleHighlight', () => {
  it('создаёт отметку с собственным текстом блока', async () => {
    const m = await toggleHighlight('kniga', 2, para(), 1000);
    expect(m).toEqual<Mark>({
      id: 'kniga|p1abc',
      bookId: 'kniga',
      chapter: 2,
      blockKey: 'p1abc',
      text: 'Первый абзац главы.',
      highlight: true,
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(await getMarks('kniga')).toEqual([m]);
  });

  it('текст не длиннее 400 символов и без вложенных списков', async () => {
    const long = 'я'.repeat(900);
    const li = block('l9', `${long}<ul><li>вложенный пункт</li></ul>`, 'li');
    const m = await toggleHighlight('kniga', 1, li, 1);
    expect(m!.text).toHaveLength(400);
    expect(m!.text).not.toContain('вложенный');
  });

  it('не рвёт суррогатную пару на границе 400 символов', async () => {
    const m = await toggleHighlight('kniga', 1, block('p2', 'я'.repeat(399) + '😀 хвост'), 1);
    expect(m!.text).toBe('я'.repeat(399));
  });

  it('повторный вызов при пустой заметке снимает отметку и удаляет запись', async () => {
    await toggleHighlight('kniga', 1, para(), 1);
    expect(await toggleHighlight('kniga', 1, para(), 2)).toBeNull();
    expect(await getMarks('kniga')).toEqual([]);
  });

  it('если есть заметка, снимает только подсветку', async () => {
    await toggleHighlight('kniga', 1, para(), 1);
    await saveNote('kniga', 1, para(), 'важно', 2);
    const off = await toggleHighlight('kniga', 1, para(), 3);
    expect(off).toMatchObject({ highlight: false, note: 'важно', createdAt: 1, updatedAt: 3 });
    expect(await getMarks('kniga')).toHaveLength(1);
  });

  it('блок только с заметкой получает подсветку, заметка остаётся', async () => {
    await saveNote('kniga', 1, para(), 'мысль', 2);
    const on = await toggleHighlight('kniga', 1, para(), 5);
    expect(on).toMatchObject({ highlight: true, note: 'мысль', createdAt: 2, updatedAt: 5 });
  });

  it('блок без ключа не отмечается', async () => {
    const el = document.createElement('p');
    el.textContent = 'без ключа';
    expect(await toggleHighlight('kniga', 1, el, 1)).toBeNull();
    expect(await getMarks('kniga')).toEqual([]);
  });

  it('отметки разных книг и блоков не мешают друг другу', async () => {
    await toggleHighlight('a', 1, para(), 1);
    await toggleHighlight('b', 1, para(), 1);
    await toggleHighlight('a', 1, block('p2zzz', 'Другой абзац'), 1);
    expect((await getMarks('a')).map((m) => m.blockKey).sort()).toEqual(['p1abc', 'p2zzz']);
    expect(await getMarks('b')).toHaveLength(1);
  });
});

describe('saveNote', () => {
  it('создаёт заметку без подсветки', async () => {
    const m = await saveNote('kniga', 3, para(), '  мысль  ', 10);
    expect(m).toEqual<Mark>({
      id: 'kniga|p1abc',
      bookId: 'kniga',
      chapter: 3,
      blockKey: 'p1abc',
      text: 'Первый абзац главы.',
      highlight: false,
      note: 'мысль',
      createdAt: 10,
      updatedAt: 10,
    });
  });

  it('у отмеченного блока сохраняет подсветку и дату создания', async () => {
    await toggleHighlight('kniga', 1, para(), 1);
    const m = await saveNote('kniga', 1, para(), 'заметка', 7);
    expect(m).toMatchObject({ highlight: true, note: 'заметка', createdAt: 1, updatedAt: 7 });
    expect(await getMarks('kniga')).toHaveLength(1);
  });

  it('пустая заметка у неотмеченного блока удаляет запись', async () => {
    await saveNote('kniga', 1, para(), 'была', 1);
    expect(await saveNote('kniga', 1, para(), '', 2)).toBeNull();
    expect(await getMarks('kniga')).toEqual([]);
  });

  it('заметка из одних пробелов — тоже пустая', async () => {
    await saveNote('kniga', 1, para(), 'была', 1);
    expect(await saveNote('kniga', 1, para(), ' \n ', 2)).toBeNull();
    expect(await getMarks('kniga')).toEqual([]);
  });

  it('пустая заметка у отмеченного блока оставляет отметку', async () => {
    await toggleHighlight('kniga', 1, para(), 1);
    await saveNote('kniga', 1, para(), 'была', 2);
    const m = await saveNote('kniga', 1, para(), '', 3);
    expect(m).toMatchObject({ highlight: true, note: '', updatedAt: 3 });
    expect(await getMarks('kniga')).toHaveLength(1);
  });

  it('пустая заметка у блока без записи ничего не пишет', async () => {
    expect(await saveNote('kniga', 1, para(), '', 1)).toBeNull();
    expect(await getMarks('kniga')).toEqual([]);
  });

  it('блок без ключа заметки не получает', async () => {
    const el = document.createElement('p');
    el.textContent = 'без ключа';
    expect(await saveNote('kniga', 1, el, 'x', 1)).toBeNull();
    expect(await getMarks('kniga')).toEqual([]);
  });
});

describe('paintMarks', () => {
  const mark = (blockKey: string, patch: Partial<Mark> = {}): Mark => ({
    id: markId('kniga', blockKey),
    bookId: 'kniga',
    chapter: 1,
    blockKey,
    text: 'x',
    highlight: true,
    note: '',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });

  function chapter(): HTMLElement {
    const root = document.createElement('div');
    root.append(block('p1', 'Один'), block('p2', 'Два'), block('p3', 'Три'));
    root.append(Object.assign(document.createElement('p'), { textContent: 'без ключа' }));
    return root;
  }

  it('ставит .mk отмеченным и .has-note блокам с заметкой', () => {
    const root = chapter();
    paintMarks(root, [mark('p1'), mark('p2', { highlight: false, note: 'мысль' }), mark('p3', { note: 'и то и другое' })]);
    const [a, b, c, d] = Array.from(root.children) as HTMLElement[];
    expect([a.className, b.className, c.className, d.className]).toEqual(['mk', 'has-note', 'mk has-note', '']);
  });

  it('снимает классы с блоков, у которых отметки больше нет, и не трогает .sel', () => {
    const root = chapter();
    paintMarks(root, [mark('p1', { note: 'н' }), mark('p2')]);
    (root.children[0] as HTMLElement).classList.add('sel');
    paintMarks(root, [mark('p2')]);
    expect((root.children[0] as HTMLElement).className).toBe('sel');
    expect((root.children[1] as HTMLElement).className).toBe('mk');
  });

  it('отметка без подсветки и без заметки ничего не красит', () => {
    const root = chapter();
    paintMarks(root, [mark('p1', { highlight: false, note: '' })]);
    expect((root.children[0] as HTMLElement).className).toBe('');
  });
});
