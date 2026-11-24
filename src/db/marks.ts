/** Хранилище `marks`: отметки и заметки к абзацам, id = `${bookId}|${blockKey}`. */
import { markTomb } from '../core/sync';
import type { Mark } from '../core/types';
import { notifyLocalChange } from './changes';
import { openDb } from './schema';

/** Отметки одной книги или, без аргумента, все. */
export async function getMarks(bookId?: string): Promise<Mark[]> {
  const db = await openDb();
  return bookId === undefined ? db.getAll('marks') : db.getAllFromIndex('marks', 'bookId', bookId);
}

export async function putMark(m: Mark): Promise<void> {
  await (await openDb()).put('marks', m);
  notifyLocalChange('data');
}

/** Удаляет отметку и той же транзакцией пишет метку удаления `mark:<id>` (spec §18.2). */
export async function deleteMark(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['marks', 'deleted'], 'readwrite');
  await Promise.all([tx.objectStore('marks').delete(id), tx.objectStore('deleted').put({ key: markTomb(id), at: Date.now() }), tx.done]);
  notifyLocalChange('data');
}
