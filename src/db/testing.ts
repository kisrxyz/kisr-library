/** Помощники для тестов базы: чистая IndexedDB на каждый тест и готовые книги. Приложение это не импортирует. */
import { IDBFactory, IDBOpenDBRequest } from 'fake-indexeddb';
import { buildBook } from '../core/book';
import type { BookMeta, Chapter } from '../core/types';
import { __resetDbForTests } from './schema';

/** Новая пустая IndexedDB; соединение предыдущего теста закрывается. */
export function freshDb(): void {
  __resetDbForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

/** IndexedDB, которая не открывается: `open` бросает ошибку (сбой хранилища, запрет на хранение). */
export function brokenDb(): void {
  __resetDbForTests();
  const factory = new IDBFactory();
  factory.open = () => {
    throw new DOMException('Хранилище недоступно', 'UnknownError');
  };
  (globalThis as { indexedDB: IDBFactory }).indexedDB = factory;
}

/** IndexedDB, у которой `open` так и не отвечает: ни успеха, ни ошибки. */
export function hangingDb(): void {
  __resetDbForTests();
  const factory = new IDBFactory();
  factory.open = () => new IDBOpenDBRequest();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = factory;
}

/** Синтетическая книга с главами «Глава 1…N». */
export function sampleBook(
  title: string,
  chapterCount = 3,
  opts: { id?: string; now?: number; category?: string } = {},
): { meta: BookMeta; chapters: Chapter[] } {
  return buildBook(
    {
      title,
      category: opts.category ?? 'Разное',
      tags: ['тест'],
      summary: `Описание книги «${title}».`,
      source: '',
      chapters: Array.from({ length: chapterCount }, (_, i) => ({
        title: `Глава ${i + 1}`,
        md: `Текст главы ${i + 1} книги «${title}», в нём несколько слов.`,
      })),
      warnings: [],
    },
    { origin: 'paste', id: opts.id, now: opts.now ?? 1_700_000_000_000 },
  );
}
