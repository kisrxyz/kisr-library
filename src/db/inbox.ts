/** Хранилище `inbox`: share target (Android). Service worker кладёт, экран «Добавить» забирает. */
import type { InboxItem } from '../core/types';
import { openDb } from './schema';

export async function putInbox(item: InboxItem): Promise<void> {
  await (await openDb()).put('inbox', item);
}

/** Забрать всё и очистить: чтение и очистка — одна транзакция, поэтому запись не потеряется. */
export async function takeInbox(): Promise<InboxItem[]> {
  const db = await openDb();
  const tx = db.transaction('inbox', 'readwrite');
  const items = await tx.store.getAll();
  await tx.store.clear();
  await tx.done;
  return items.sort((a, b) => a.at - b.at);
}
