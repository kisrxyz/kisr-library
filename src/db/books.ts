/** Хранилища `books` и `chapters`. Запись книги — всегда одна транзакция. */
import { pad2 } from '../core/text';
import { bookTomb } from '../core/sync';
import type { BookMeta, Chapter } from '../core/types';
import { notifyLocalChange } from './changes';
import { openDb, type WriteStore } from './schema';

/** Что можно менять у книги: всё, кроме `id`. `undefined` снимает необязательное поле. */
export type BookMetaPatch = Partial<Omit<BookMeta, 'id'>>;

export async function getAllBooks(): Promise<BookMeta[]> {
  return (await openDb()).getAll('books');
}

export async function getBook(id: string): Promise<BookMeta | undefined> {
  return (await openDb()).get('books', id);
}

/** Главы книги по порядку чтения. */
export async function getChapters(bookId: string): Promise<Chapter[]> {
  const chapters = await (await openDb()).getAllFromIndex('chapters', 'bookId', bookId);
  return chapters.sort((a, b) => a.order - b.order);
}

export async function getChapter(bookId: string, order: number): Promise<Chapter | undefined> {
  const db = await openDb();
  const direct = await db.get('chapters', `${bookId}--${pad2(order)}`);
  if (direct && direct.bookId === bookId && direct.order === order) return direct;
  // id не по шаблону (чужие данные): ищем по порядку среди глав книги.
  return (await db.getAllFromIndex('chapters', 'bookId', bookId)).find((c) => c.order === order);
}

/** Все главы всех книг — для поиска по тексту. */
export async function getAllChapters(): Promise<Chapter[]> {
  return (await openDb()).getAll('chapters');
}

/**
 * Записывает книгу в хранилища чужой транзакции: лишние главы старой версии удаляются, meta и
 * главы пишутся заново. Общий кусок для `saveBook` и восстановления из копии.
 */
export async function writeBook(
  stores: { books: WriteStore<'books'>; chapters: WriteStore<'chapters'> },
  meta: BookMeta,
  chapters: Chapter[],
): Promise<void> {
  const keep = new Set(chapters.map((c) => c.id));
  for (const key of await stores.chapters.index('bookId').getAllKeys(meta.id)) {
    if (!keep.has(key)) await stores.chapters.delete(key);
  }
  await stores.books.put(meta);
  for (const chapter of chapters) await stores.chapters.put(chapter);
}

/** Одна транзакция: либо записалось всё, либо ничего (при ошибке транзакция отменяется). */
export async function saveBook(meta: BookMeta, chapters: Chapter[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters'], 'readwrite');
  try {
    await writeBook({ books: tx.objectStore('books'), chapters: tx.objectStore('chapters') }, meta, chapters);
  } catch (e) {
    tx.abort();
    await tx.done.catch(() => {});
    throw e;
  }
  await tx.done;
  notifyLocalChange('data');
}

/** Меняет поля книги и возвращает новую запись. `updatedAt` обновляется, если его не задали. */
export async function updateBookMeta(id: string, patch: BookMetaPatch): Promise<BookMeta> {
  const db = await openDb();
  const tx = db.transaction('books', 'readwrite');
  const old = await tx.store.get(id);
  if (!old) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(`Книга не найдена: ${id}`);
  }
  const next: BookMeta = { ...old, ...patch, id, updatedAt: patch.updatedAt ?? Date.now() };
  // `{ action: undefined }` в патче значит «убрать поле», а не «записать undefined».
  for (const key of Object.keys(next) as (keyof BookMeta)[]) {
    if (next[key] === undefined) delete next[key];
  }
  await tx.store.put(next);
  await tx.done;
  notifyLocalChange('data');
  return next;
}

/** Хранилища книги и всего, что к ней относится, из чужой транзакции на запись. */
export interface BookStores {
  books: WriteStore<'books'>;
  chapters: WriteStore<'chapters'>;
  progress: WriteStore<'progress'>;
  marks: WriteStore<'marks'>;
  tasks: WriteStore<'tasks'>;
}

/** Убирает книгу, её главы, прогресс, отметки и задачи в чужой транзакции. Общий кусок для удаления и синхронизации. */
export async function removeBook(stores: BookStores, id: string): Promise<void> {
  const [chapterKeys, markKeys] = await Promise.all([stores.chapters.index('bookId').getAllKeys(id), stores.marks.index('bookId').getAllKeys(id)]);
  await Promise.all([
    stores.books.delete(id),
    stores.progress.delete(id),
    stores.tasks.delete(id),
    ...chapterKeys.map((key) => stores.chapters.delete(key)),
    ...markKeys.map((key) => stores.marks.delete(key)),
  ]);
}

/**
 * Книга, её главы, прогресс, отметки и задачи — одной транзакцией, вместе с меткой удаления `book:<id>`:
 * по ней удаление доезжает до других устройств (spec §18.2).
 */
export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters', 'progress', 'marks', 'tasks', 'deleted'], 'readwrite');
  const stores: BookStores = {
    books: tx.objectStore('books'),
    chapters: tx.objectStore('chapters'),
    progress: tx.objectStore('progress'),
    marks: tx.objectStore('marks'),
    tasks: tx.objectStore('tasks'),
  };
  await Promise.all([removeBook(stores, id), tx.objectStore('deleted').put({ key: bookTomb(id), at: Date.now() })]);
  await tx.done;
  notifyLocalChange('data');
}
