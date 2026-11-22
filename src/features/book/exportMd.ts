import { reassemble } from '../../core/parse';
import { slug } from '../../core/text';
import { getBook, getChapters } from '../../db/books';

/** Книга из базы → файл в формате `docs/book-format.md`: шапка и главы по порядку чтения. */
export async function exportBookMd(bookId: string): Promise<{ name: string; text: string }> {
  const [meta, chapters] = await Promise.all([getBook(bookId), getChapters(bookId)]);
  if (!meta) throw new Error(`Книга не найдена: ${bookId}`);
  return { name: `${slug(meta.title)}.md`, text: reassemble(meta, chapters) };
}
