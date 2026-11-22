import { minutesLabel } from '../../core/time';
import type { BookMeta, Progress } from '../../core/types';
import { settings } from '../../state/settings';
import { Icon } from '../../ui/Icon';
import './ChapterList.css';

interface ChapterListProps {
  book: BookMeta;
  progress?: Progress;
  /** Нажата глава с этим номером (с 1). */
  onOpen: (order: number) => void;
  /** Глава, которая открыта сейчас (● в оглавлении читалки). По умолчанию — глава, где остановился читатель. */
  current?: number;
}

/** Заголовки вида «1.1. Подраздел» чуть сдвинуты вправо. */
const SUBSECTION = /^\d+\.\d+/;

const STATUS_LABEL = { done: 'дочитана', current: 'текущая', todo: 'не дочитана' } as const;

/**
 * Список глав: номер, название, минуты и статус — ✓ дочитана, ● текущая, ○ нет.
 * Общий для страницы книги и оглавления читалки.
 */
export function ChapterList({ book, progress, onOpen, current }: ChapterListProps) {
  const wpm = settings.value.wpm;
  const count = book.chapters.length;
  const done = new Set(progress?.chaptersDone);
  // У прочитанной книги «текущей» главы нет: она вся позади
  const here = current ?? (progress?.status === 'reading' ? Math.min(Math.max(1, progress.chapter), count) : undefined);

  return (
    <ol class="chapters">
      {book.chapters.map((chapter, i) => {
        const n = i + 1;
        const state = n === here ? 'current' : done.has(n) ? 'done' : 'todo';
        return (
          <li key={chapter.id}>
            <button
              type="button"
              class="chapters__row"
              data-state={state}
              aria-current={state === 'current' ? 'true' : undefined}
              onClick={() => onOpen(n)}
            >
              <span class="chapters__num">{n}</span>
              <span class={SUBSECTION.test(chapter.title) ? 'chapters__title chapters__title--sub' : 'chapters__title'}>
                {chapter.title}
              </span>
              <span class="chapters__min">{minutesLabel(chapter.words, wpm)}</span>
              <span class="chapters__status" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={16} /> : <span class="chapters__dot" />}
              </span>
              <span class="sr-only">{STATUS_LABEL[state]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
