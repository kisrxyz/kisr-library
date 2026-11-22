import type { ReadingEntry } from '../../core/library';
import { percentOf, remainingWords } from '../../core/progress';
import { minutesLabel } from '../../core/time';
import { toHash } from '../../router';
import { ProgressBar } from '../../ui/ProgressBar';
import { currentChapter, readHref } from './shared';
import './ReadingNow.css';

interface ReadingNowProps {
  entries: ReadingEntry[];
  /** Сколько всего начатых книг, с «Продолжить». */
  total: number;
  wpm: number;
}

const ALL_READING = toHash({ name: 'library', params: new URLSearchParams({ status: 'reading' }) });

/** «Читаю сейчас»: остальные начатые книги компактными строками. Нажатие — читалка на том же месте. */
export function ReadingNow({ entries, total, wpm }: ReadingNowProps) {
  if (entries.length === 0) return null;
  return (
    <section class="rnow" aria-labelledby="rnow-title">
      <div class="shelf-head">
        <h2 id="rnow-title">Читаю сейчас</h2>
        <a class="shelf-head__link" href={ALL_READING}>
          Все ({total})
        </a>
      </div>
      <ul class="rnow__list">
        {entries.map(({ book, progress }) => {
          const chapter = currentChapter(book, progress);
          const percent = percentOf(book, progress.wordsRead);
          return (
            <li key={book.id}>
              <a class="rrow" href={readHref(book, progress)}>
                <span class="rrow__title">{book.title}</span>
                <span class="rrow__pct">{percent}%</span>
                <span class="rrow__meta">
                  Глава {chapter.n} · ещё {minutesLabel(remainingWords(book, progress.wordsRead), wpm)}
                </span>
                <ProgressBar class="rrow__bar" value={percent} label={`Прочитано: ${book.title}`} />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
