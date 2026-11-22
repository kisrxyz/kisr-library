import { minutesLabel } from '../../core/time';
import type { BookMeta } from '../../core/types';
import { Icon } from '../../ui/Icon';

interface ChapterEndProps {
  book: BookMeta;
  /** Открытая глава (с 1). */
  chapter: number;
  wpm: number;
  onGo: (chapter: number) => void;
}

/** Конец главы (spec §8.1): крупная карточка «Дальше: <название> · 7 мин» и маленькая «‹ Предыдущая глава». */
export function ChapterEnd({ book, chapter, wpm, onGo }: ChapterEndProps) {
  const next = book.chapters[chapter];
  const hasPrev = chapter > 1;
  if (!next && !hasPrev) return null;
  const minutes = next ? minutesLabel(next.words, wpm) : '';

  return (
    <nav class="rend" aria-label="Главы">
      {next && (
        <button type="button" class="rend__next" aria-label={`Дальше: ${next.title} · ${minutes}`} onClick={() => onGo(chapter + 1)}>
          <span class="rend__eyebrow">Дальше</span>
          <span class="rend__title">{next.title}</span>
          <span class="rend__min">{minutes}</span>
          <Icon name="right" size={22} class="rend__arrow" />
        </button>
      )}
      {hasPrev && (
        <button type="button" class="rend__prev" onClick={() => onGo(chapter - 1)}>
          <Icon name="left" size={16} />
          <span>Предыдущая глава</span>
        </button>
      )}
    </nav>
  );
}
