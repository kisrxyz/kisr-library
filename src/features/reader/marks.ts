/**
 * Отметки и заметки к абзацам (spec §8.8). Запись одна на блок: id = `${bookId}|${blockKey}`.
 * Блок без отметки и без заметки в базе не хранится: запись создаётся первым действием
 * и удаляется, когда снято последнее.
 */
import type { Mark } from '../../core/types';
import { deleteMark, getMarks, putMark } from '../../db/marks';
import { ownText } from '../../markdown/enhance';

/** Сколько символов абзаца запоминается в отметке: хватает для списка «Отметки в книге». */
export const MARK_TEXT_MAX = 400;

export const markId = (bookId: string, blockKey: string): string => `${bookId}|${blockKey}`;

/** Не длиннее `MARK_TEXT_MAX`, суррогатную пару (эмодзи) пополам не режем. */
function clip(text: string): string {
  if (text.length <= MARK_TEXT_MAX) return text;
  let end = MARK_TEXT_MAX;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

async function findMark(bookId: string, key: string): Promise<Mark | undefined> {
  const id = markId(bookId, key);
  return (await getMarks(bookId)).find((m) => m.id === id);
}

function fresh(bookId: string, chapter: number, el: HTMLElement, key: string, now: number): Mark {
  return {
    id: markId(bookId, key),
    bookId,
    chapter,
    blockKey: key,
    text: clip(ownText(el)),
    highlight: false,
    note: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * «Отметить»: включает или снимает подсветку блока. Возвращает запись после изменения или `null`,
 * если записи больше нет (снята последняя подсветка без заметки) или у блока нет ключа.
 */
export async function toggleHighlight(bookId: string, chapter: number, el: HTMLElement, now: number): Promise<Mark | null> {
  const key = el.dataset.key;
  if (!key) return null;
  const old = await findMark(bookId, key);
  const base = old ?? fresh(bookId, chapter, el, key, now);
  const next: Mark = { ...base, highlight: !old?.highlight, updatedAt: now };
  if (!next.highlight && next.note === '') {
    if (old) await deleteMark(old.id);
    return null;
  }
  await putMark(next);
  return next;
}

/**
 * «Заметка»: сохраняет текст заметки (по краям без пробелов). Пустая заметка у блока без подсветки
 * удаляет запись целиком; у отмеченного блока оставляет отметку. Возвращает запись или `null`.
 */
export async function saveNote(bookId: string, chapter: number, el: HTMLElement, note: string, now: number): Promise<Mark | null> {
  const key = el.dataset.key;
  if (!key) return null;
  const old = await findMark(bookId, key);
  const text = note.trim();
  const base = old ?? fresh(bookId, chapter, el, key, now);
  const next: Mark = { ...base, note: text, updatedAt: now };
  if (!next.highlight && text === '') {
    if (old) await deleteMark(old.id);
    return null;
  }
  await putMark(next);
  return next;
}

/** Красит блоки главы по отметкам: `.mk` — подсветка, `.has-note` — метка «заметка». Лишнее снимает, `.sel` не трогает. */
export function paintMarks(root: HTMLElement, marks: Mark[]): void {
  const byKey = new Map(marks.map((m) => [m.blockKey, m]));
  for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
    const m = byKey.get(el.dataset.key ?? '');
    el.classList.toggle('mk', m?.highlight === true);
    el.classList.toggle('has-note', m !== undefined && m.note.trim() !== '');
  }
}
