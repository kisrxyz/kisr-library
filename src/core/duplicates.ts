/** Дубли при добавлении книги (spec §7.2): поиск, решение по умолчанию, применение «Обновить» и «Дописать». */
import { buildBook } from './book';
import type { ParsedBook } from './parse';
import { normalizeTitle } from './text';
import type { BookMeta, Chapter } from './types';

export type Resolution = 'update' | 'append' | 'separate' | 'skip';

export type Duplicate = { kind: 'same-content' | 'same-title'; book: BookMeta } | null;

/** Сначала по содержимому (`contentHash`), потом по названию без регистра, ё и пунктуации. */
export function findDuplicate(parsed: ParsedBook, contentHash: string, books: BookMeta[]): Duplicate {
  const same = books.find((b) => b.contentHash === contentHash);
  if (same) return { kind: 'same-content', book: same };
  const title = normalizeTitle(parsed.title);
  if (title) {
    const sameTitle = books.find((b) => normalizeTitle(b.title) === title);
    if (sameTitle) return { kind: 'same-title', book: sameTitle };
  }
  return null;
}

export function defaultResolution(parsed: ParsedBook, dup: Duplicate): Resolution {
  if (!dup) return 'separate';
  if (dup.kind === 'same-content') return 'skip';
  return parsed.part && parsed.part.n > 1 ? 'append' : 'update';
}

/**
 * «Обновить» заменяет содержимое, «Дописать» добавляет главы в конец. В обоих случаях сохраняются
 * `id`, `createdAt`, `addedAt`, `favorite` и `action` (а значит, и прогресс с отметками, которые
 * привязаны к `id`); `updatedAt = now`, счётчики и `contentHash` считаются заново.
 */
export function applyResolution(
  existing: { meta: BookMeta; chapters: Chapter[] },
  parsed: ParsedBook,
  res: 'update' | 'append',
  now: number,
): { meta: BookMeta; chapters: Chapter[] } {
  const old = existing.meta;
  const content: ParsedBook =
    res === 'update'
      ? parsed
      : {
          ...parsed,
          title: old.title,
          category: old.category,
          tags: [...new Set([...old.tags, ...parsed.tags])],
          summary: old.summary || parsed.summary,
          source: old.source || parsed.source,
          ...(old.level ? { level: old.level } : {}),
          chapters: [
            ...[...existing.chapters].sort((a, b) => a.order - b.order).map((c) => ({ title: c.title, md: c.md })),
            ...parsed.chapters,
          ],
        };

  const built = buildBook(content, { origin: old.origin, id: old.id, now, createdAt: old.createdAt });
  const meta: BookMeta = { ...built.meta, addedAt: old.addedAt, favorite: old.favorite, updatedAt: now };
  if (old.action) meta.action = { ...old.action };
  return { meta, chapters: built.chapters };
}
