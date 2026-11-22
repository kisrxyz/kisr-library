import type { ReadingEntry } from '../../core/library';
import { percentOf } from '../../core/progress';
import { noOrphanDash } from '../../core/text';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/ProgressBar';
import { chapterLine, currentChapter, progressLine, readHref } from './shared';
import './ContinueCard.css';

interface ContinueCardProps {
  entry: ReadingEntry;
  callNo: string;
  wpm: number;
}

/** «Продолжить»: последняя незаконченная книга; нажатие открывает читалку ровно на том же абзаце. */
export function ContinueCard({ entry: { book, progress }, callNo, wpm }: ContinueCardProps) {
  const chapter = currentChapter(book, progress);
  const percent = percentOf(book, progress.wordsRead);

  return (
    <a
      class="continue"
      href={readHref(book, progress)}
      aria-label={`Продолжить: ${book.title}, глава ${chapter.n}, прочитано ${percent}%`}
    >
      <span class="continue__stamp" aria-hidden="true">
        {callNo}
      </span>
      <span class="continue__eyebrow">Продолжить</span>
      <span class="continue__shelf">
        {callNo} · {book.category}
      </span>
      <span class="continue__title">{noOrphanDash(book.title)}</span>
      <span class="continue__where">{chapterLine(book, progress)}</span>
      {progress.snippet && <span class="continue__quote">«{progress.snippet}»</span>}
      <ProgressBar class="continue__bar" value={percent} label="Прочитано в книге" />
      <span class="continue__foot">
        <span class="continue__left">{progressLine(book, progress, wpm)}</span>
        <span class="continue__go">
          Читать
          <Icon name="right" size={16} />
        </span>
      </span>
    </a>
  );
}
