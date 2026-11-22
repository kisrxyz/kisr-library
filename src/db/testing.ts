/** Помощники для тестов базы: чистая IndexedDB на каждый тест и готовые книги. Приложение это не импортирует. */
import { IDBFactory } from 'fake-indexeddb';
import { buildBook } from '../core/book';
import type { BookMeta, Chapter } from '../core/types';
import { __resetDbForTests } from './schema';

/** Новая пустая IndexedDB; соединение предыдущего теста закрывается. */
export function freshDb(): void {
  __resetDbForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
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
