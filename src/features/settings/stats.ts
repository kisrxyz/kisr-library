/** Статистика библиотеки для «Ещё» (spec §10.7). Чистая функция. */
import { bookStatus } from '../../core/progress';
import type { BookMeta, Progress } from '../../core/types';

export interface LibraryStats {
  total: number;
  finished: number;
  reading: number;
  /** Активное время чтения всех книг, минуты (по `readingMs`). */
  minutesRead: number;
  cards: number;
}

/** Только книги, которые сейчас на полке: прогресс удалённых и скрытых на время «Отменить» не считается. */
export function libraryStats(books: readonly BookMeta[], progress: ReadonlyMap<string, Progress>): LibraryStats {
  let finished = 0;
  let reading = 0;
  let readingMs = 0;
  let cards = 0;
  for (const b of books) {
    const p = progress.get(b.id);
    const status = bookStatus(p);
    if (status === 'finished') finished++;
    else if (status === 'reading') reading++;
    readingMs += p?.readingMs ?? 0;
    cards += b.cards;
  }
  return { total: books.length, finished, reading, minutesRead: Math.round(readingMs / 60_000), cards };
}
