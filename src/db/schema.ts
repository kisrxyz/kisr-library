/** IndexedDB `kisr-library` (spec §6): схема, версия и единственное соединение на вкладку. */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore, type StoreNames } from 'idb';
import type { BookMeta, Chapter, InboxItem, Mark, Progress, Setting, TaskState } from '../core/types';

export const DB_NAME = 'kisr-library';
export const DB_VERSION = 1;

export interface KisrDB extends DBSchema {
  books: { key: string; value: BookMeta; indexes: { category: string; addedAt: number; updatedAt: number } };
  chapters: { key: string; value: Chapter; indexes: { bookId: string } };
  progress: { key: string; value: Progress };
  marks: { key: string; value: Mark; indexes: { bookId: string; updatedAt: number } };
  tasks: { key: string; value: TaskState };
  settings: { key: string; value: Setting };
  inbox: { key: string; value: InboxItem };
}

export type KisrDatabase = IDBPDatabase<KisrDB>;
/** Хранилище внутри транзакции на запись (из любой транзакции, где оно есть). */
export type WriteStore<N extends StoreNames<KisrDB>> = IDBPObjectStore<KisrDB, StoreNames<KisrDB>[], N, 'readwrite'>;

/** Новые хранилища и индексы добавляются повышением `DB_VERSION` и веткой `oldVersion < N`. */
function upgrade(db: KisrDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const books = db.createObjectStore('books', { keyPath: 'id' });
    books.createIndex('category', 'category');
    books.createIndex('addedAt', 'addedAt');
    books.createIndex('updatedAt', 'updatedAt');

    db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('bookId', 'bookId');
    db.createObjectStore('progress', { keyPath: 'bookId' });

    const marks = db.createObjectStore('marks', { keyPath: 'id' });
    marks.createIndex('bookId', 'bookId');
    marks.createIndex('updatedAt', 'updatedAt');

    db.createObjectStore('tasks', { keyPath: 'bookId' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('inbox', { keyPath: 'id' });
  }
}

let dbPromise: Promise<KisrDatabase> | null = null;

/** Соединение одно на вкладку. Если открыть не вышло, следующий вызов попробует снова. */
export function openDb(): Promise<KisrDatabase> {
  if (!dbPromise) {
    const opening = openDB<KisrDB>(DB_NAME, DB_VERSION, {
      upgrade,
      // Другая вкладка хочет обновить схему: закрываемся и откроемся заново при следующем обращении.
      blocking() {
        void opening.then((db) => db.close()).catch(() => {});
        if (dbPromise === opening) dbPromise = null;
      },
      // Браузер оборвал соединение (например, освободил место).
      terminated() {
        if (dbPromise === opening) dbPromise = null;
      },
    });
    dbPromise = opening;
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
  }
  return dbPromise;
}

/** Только для тестов: закрыть соединение и забыть его (вместе с подменой `indexedDB`). */
export function __resetDbForTests(): void {
  const old = dbPromise;
  dbPromise = null;
  void old?.then((db) => db.close()).catch(() => {});
}
