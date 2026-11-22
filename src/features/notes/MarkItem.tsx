import { formatDate } from '../../core/text';
import type { BookMeta, Mark } from '../../core/types';
import { toHash } from '../../router';
import { Icon } from '../../ui/Icon';

/** Глава, где поставлена отметка: «Глава 3 · Название»; без названия — «Глава 3». */
export function markChapterLine(book: BookMeta, chapter: number): string {
  const title = book.chapters[chapter - 1]?.title ?? '';
  if (!title) return `Глава ${chapter}`;
  // Название вида «Глава 4. …» уже с номером: второй номер подряд только путает
  return /^(Глава|Часть|Раздел)\s*\d/i.test(title) ? title : `Глава ${chapter} · ${title}`;
}

interface MarkItemProps {
  mark: Mark;
  book: BookMeta;
}

/** Одна отметка: абзац в «ёлочках», заметка, глава и дата. Нажатие открывает читалку на этом абзаце. */
export function MarkItem({ mark, book }: MarkItemProps) {
  const href = toHash({ name: 'read', id: book.id, chapter: mark.chapter, block: mark.blockKey });
  return (
    <a class="mark" href={href}>
      {mark.text && <p class={mark.highlight ? 'mark__text mark__text--hl' : 'mark__text'}>«{mark.text}»</p>}
      {mark.note && (
        <p class="mark__note">
          <Icon name="note" size={16} />
          <span>{mark.note}</span>
        </p>
      )}
      <p class="mark__meta">
        {markChapterLine(book, mark.chapter)} · {formatDate(mark.updatedAt)}
      </p>
    </a>
  );
}
