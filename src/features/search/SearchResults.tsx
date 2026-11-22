import type { ComponentChildren } from 'preact';
import { CONTEXT, excerpt, highlightParts, type TextHit } from '../../core/search';
import { noOrphanDash, plural } from '../../core/text';
import { minutesLabel } from '../../core/time';
import type { BookMeta } from '../../core/types';
import { toHash } from '../../router';
import './SearchResults.css';

/** Строка с подсвеченным найденным (`<mark>`), исходное написание сохраняется. */
function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}
    </>
  );
}

/** Столько символов с краю можно отбросить, чтобы не показывать обрезанное слово. */
const TRIM_WORD = 14;

const hasMatch = (text: string, q: string) => highlightParts(text, q).some((p) => p.hit);

/** Группа результатов: «Книги · 3», «В тексте · 12». */
export function ResultGroup({
  id,
  title,
  count,
  busy,
  children,
}: {
  id: string;
  title: string;
  /** Число в заголовке; строка — когда точное число неизвестно («50+»). */
  count: number | string;
  busy?: boolean;
  children: ComponentChildren;
}) {
  return (
    <section class="sgroup" aria-labelledby={id} aria-busy={busy || undefined}>
      <h2 id={id} class="sgroup__head">
        {title}
        <span class="sgroup__count"> · {count}</span>
      </h2>
      {children}
    </section>
  );
}

interface BookResultsProps {
  books: BookMeta[];
  callNos: Map<string, string>;
  q: string;
  wpm: number;
}

/** Книги: шифр и раздел, название, а если нашлось в тегах или описании — и они. */
export function BookResults({ books, callNos, q, wpm }: BookResultsProps) {
  return (
    <ul class="sres">
      {books.map((book) => {
        const chapters = book.chapters.length;
        const tagsHit = book.tags.some((tag) => hasMatch(tag, q));
        const summaryHit = hasMatch(book.summary, q);
        return (
          <li key={book.id}>
            <a class="sbook" href={toHash({ name: 'book', id: book.id })}>
              <span class="sbook__top">
                <span class="sbook__callno">{callNos.get(book.id) ?? ''}</span>
                <span class="sbook__cat">
                  <Marked text={book.category} q={q} />
                </span>
              </span>
              <h3 class="sbook__title">
                <Marked text={noOrphanDash(book.title)} q={q} />
              </h3>
              {tagsHit && (
                <span class="sbook__tags">
                  <span class="sr-only">Теги: </span>
                  {book.tags.map((tag, i) => (
                    <span key={tag}>
                      {i > 0 && ' · '}
                      <Marked text={tag} q={q} />
                    </span>
                  ))}
                </span>
              )}
              {summaryHit && (
                <p class="sbook__sum">
                  <Marked text={excerpt(book.summary, q)} q={q} />
                </p>
              )}
              <span class="sbook__meta">
                ≈&nbsp;{minutesLabel(book.words, wpm)} · {chapters}&nbsp;{plural(chapters, 'глава', 'главы', 'глав')}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Фрагмент без обрезанных слов по краям: контекст режется ровно по числу символов, и на краю остаётся
 * половина слова. Обрезанным считается тот край, где контекст дошёл до `CONTEXT`.
 */
export function tidyContext(hit: Pick<TextHit, 'before' | 'after'>): { before: string; after: string; cutBefore: boolean; cutAfter: boolean } {
  const cutBefore = hit.before.length >= CONTEXT;
  const cutAfter = hit.after.length >= CONTEXT;
  let before = hit.before;
  let after = hit.after;
  if (cutBefore) {
    const space = before.indexOf(' ');
    if (space >= 0 && space < TRIM_WORD) before = before.slice(space + 1);
  }
  if (cutAfter) {
    const space = after.lastIndexOf(' ');
    if (space > after.length - TRIM_WORD) after = after.slice(0, space);
  }
  return { before: before.trimStart(), after: after.trimEnd(), cutBefore, cutAfter };
}

/** «Глава 3 · Название»; если название уже начинается с номера («Глава 4. …», «Часть 2»), номер не повторяется. */
export function chapterLabel(n: number, title: string): string {
  if (!title) return `Глава ${n}`;
  return /^(Глава|Часть|Раздел)\s*\d/i.test(title) ? title : `Глава ${n} · ${title}`;
}

interface TextResultsProps {
  hits: TextHit[];
  /** Книги по id: название берётся отсюда, поэтому после переименования оно свежее. */
  byId: Map<string, BookMeta>;
  /** Запрос, по которому найдены `hits`: он уходит в читалку (`?find=`). */
  q: string;
}

/** Места в тексте: книга, глава и фрагмент с подсвеченным найденным. Нажатие открывает читалку на этом месте. */
export function TextResults({ hits, byId, q }: TextResultsProps) {
  // В читалку уходит запрос, как его понимает поиск: без пробелов по краям и без повторов внутри
  const find = q.trim().replace(/\s+/g, ' ');
  return (
    <ul class="sres">
      {hits.map((hit, i) => {
        const book = byId.get(hit.bookId);
        if (!book) return null;
        const { before, after, cutBefore, cutAfter } = tidyContext(hit);
        return (
          <li key={`${hit.bookId}:${hit.chapter}:${i}`}>
            <a class="shit" href={toHash({ name: 'read', id: hit.bookId, chapter: hit.chapter, find })}>
              <span class="shit__where">
                <span class="shit__book">{noOrphanDash(book.title)}</span>
                <span class="shit__chapter">{chapterLabel(hit.chapter, hit.chapterTitle)}</span>
              </span>
              <span class="shit__snip">
                {cutBefore && '…'}
                {before}
                <mark>{hit.match}</mark>
                {after}
                {cutAfter && '…'}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
