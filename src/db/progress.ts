/** Хранилище `progress`: одна запись на книгу; нет записи — книга не начата. */
import type { Progress } from '../core/types';
import { openDb } from './schema';

export async function getAllProgress(): Promise<Progress[]> {
  return (await openDb()).getAll('progress');
}

export async function putProgress(p: Progress): Promise<void> {
  await (await openDb()).put('progress', p);
}

export async function deleteProgress(bookId: string): Promise<void> {
  await (await openDb()).delete('progress', bookId);
}
