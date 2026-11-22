import { percentOf } from '../../core/progress';
import { minutesLabel } from '../../core/time';
import type { BookMeta, Progress } from '../../core/types';
import { formatDate, plural } from '../../core/text';
import { toHash } from '../../router';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/ProgressBar';
import './BookCard.css';

interface BookCardProps {
  book: BookMeta;
  progress: Progress | undefined;
  /** Шифр каталога, «ФИЛ·03». */
  callNo: string;
  wpm: number;
  /** Метка «Новая»: добавлена недавно и ещё не открыта. */
  fresh: boolean;
}

/** Карточка книги в стиле библиотечного каталога. */
export function BookCard({ book, progress, callNo, wpm, fresh }: BookCardProps) {
  const chapters = book.chapters.length;
  const reading = progress?.status === 'reading';
  const finished = progress?.status === 'finished';
  const percent = reading ? percentOf(book, progress.wordsRead) : 0;

  return (
    <a class="bcard" href={toHash({ name: 'book', id: book.id })}>
      <span class="bcard__top">
        <span class="bcard__callno">{callNo}</span>
        <span class="bcard__cat">{book.category}</span>
        {fresh && <span class="bcard__new">Новая</span>}
        {book.favorite && (
          <span class="bcard__fav" role="img" aria-label="В избранном">
            <Icon name="star" size={16} />
          </span>
        )}
      </span>
      <h3 class="bcard__title">{book.title}</h3>
      {book.summary && <p class="bcard__sum">{book.summary}</p>}
      <span class="bcard__meta">
        <span>
          ≈ {minutesLabel(book.words, wpm)} · {chapters}&nbsp;{plural(chapters, 'глава', 'главы', 'глав')}
        </span>
        {finished && (
          <span class="bcard__done">
            <Icon name="check" size={14} />
            Прочитано {formatDate(progress.finishedAt ?? progress.lastReadAt)}
          </span>
        )}
      </span>
      {reading && (
        <span class="bcard__progress">
          <ProgressBar value={percent} label={`Прочитано: ${book.title}`} />
          <span class="bcard__pct">{percent}%</span>
        </span>
      )}
    </a>
  );
}
