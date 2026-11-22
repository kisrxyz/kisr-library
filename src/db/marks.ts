/** Хранилище `marks`: отметки и заметки к абзацам, id = `${bookId}|${blockKey}`. */
import type { Mark } from '../core/types';
import { openDb } from './schema';

/** Отметки одной книги или, без аргумента, все. */
export async function getMarks(bookId?: string): Promise<Mark[]> {
  const db = await openDb();
  return bookId === undefined ? db.getAll('marks') : db.getAllFromIndex('marks', 'bookId', bookId);
}

export async function putMark(m: Mark): Promise<void> {
  await (await openDb()).put('marks', m);
}

export async function deleteMark(id: string): Promise<void> {
  await (await openDb()).delete('marks', id);
}
