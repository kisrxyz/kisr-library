/** Что показывают «Отметки» и «Действия»: группировка и порядок. Чистые функции. */
import type { BookMeta, Mark, Progress } from '../../core/types';

export interface MarkGroup {
  book: BookMeta;
  marks: Mark[];
}

const byNewest = (a: Mark, b: Mark) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id);

/**
 * Отметки по книгам: внутри книги новые сверху, сами книги — по самой свежей отметке.
 * Отметки книг, которых на полке нет (удалена или ждёт окна «Вернуть»), не показываются.
 */
export function groupMarks(marks: readonly Mark[], books: readonly BookMeta[]): MarkGroup[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const groups = new Map<string, MarkGroup>();
  for (const m of [...marks].sort(byNewest)) {
    const book = byId.get(m.bookId);
    if (!book) continue;
    const group = groups.get(book.id) ?? { book, marks: [] };
    group.marks.push(m);
    groups.set(book.id, group);
  }
  // Группы создавались в порядке самой свежей отметки каждой книги
  return [...groups.values()];
}

/**
 * Книги с записанным действием. Сначала невыполненные, по времени прочтения книги (свежие выше),
 * затем выполненные — по времени «сделано».
 */
export function bookActions(books: readonly BookMeta[], progress: ReadonlyMap<string, Progress>): BookMeta[] {
  const when = (b: BookMeta): number => {
    if (b.action?.done) return b.action.doneAt ?? b.updatedAt;
    return progress.get(b.id)?.finishedAt ?? b.updatedAt;
  };
  return books
    .filter((b) => b.action !== undefined)
    .sort((a, b) => Number(a.action?.done ?? false) - Number(b.action?.done ?? false) || when(b) - when(a));
}
