/** Правка названия, раздела и тегов книги (spec §10.2): разбор того, что ввёл читатель. */
import type { BookMeta } from '../../core/types';
import type { BookMetaPatch } from '../../db/books';

const DEFAULT_CATEGORY = 'Разное';

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Теги из строки через запятую (допустимы и «;», и перенос строки): без `#` и без повторов. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const tag = squash(raw).replace(/^#+\s*/, '');
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function tagsToText(tags: string[]): string {
  return tags.join(', ');
}

/**
 * Что записать в книгу. `null` — менять нечего (или название пустое). Раздел, который совпал
 * с существующим без учёта регистра, пишется как у существующего: «психология» не заводит второй раздел.
 */
export function buildMetaPatch(
  book: BookMeta,
  input: { title: string; category: string; tags: string },
  knownCategories: string[],
): BookMetaPatch | null {
  const title = squash(input.title);
  if (!title) return null;
  const typed = squash(input.category) || DEFAULT_CATEGORY;
  const category = knownCategories.find((c) => c.toLowerCase() === typed.toLowerCase()) ?? typed;
  const tags = parseTags(input.tags);

  const patch: BookMetaPatch = {};
  if (title !== book.title) patch.title = title;
  if (category !== book.category) patch.category = category;
  if (tagsToText(tags) !== tagsToText(book.tags)) patch.tags = tags;
  return Object.keys(patch).length > 0 ? patch : null;
}
