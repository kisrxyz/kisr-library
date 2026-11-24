/** Хранилище `tasks`: отмеченные пункты чек-листов книги, ключ — "t" + hash текста пункта. */
import type { TaskState } from '../core/types';
import { notifyLocalChange } from './changes';
import { openDb } from './schema';

export async function getTasks(bookId: string): Promise<TaskState> {
  return (await (await openDb()).get('tasks', bookId)) ?? { bookId, done: {} };
}

/**
 * Поставить или снять галочку; чтение и запись — в одной транзакции. `updatedAt` — время последней
 * галочки: по нему снятая галочка тоже доезжает до других устройств (spec §18.3).
 */
export async function setTask(bookId: string, key: string, done: boolean): Promise<TaskState> {
  const db = await openDb();
  const tx = db.transaction('tasks', 'readwrite');
  const state: TaskState = (await tx.store.get(bookId)) ?? { bookId, done: {} };
  const next: TaskState = { bookId, done: { ...state.done }, updatedAt: Date.now() };
  if (done) next.done[key] = true;
  else delete next.done[key];
  await tx.store.put(next);
  await tx.done;
  notifyLocalChange('data');
  return next;
}
