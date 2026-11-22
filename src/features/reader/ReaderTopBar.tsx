import type { Ref } from 'preact';
import { noOrphanDash } from '../../core/text';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/ProgressBar';

interface ReaderTopBarProps {
  title: string;
  chapter: number;
  count: number;
  /** Прочитано в книге, 0..100 — тонкая линия под панелью. */
  percent: number;
  /** Спрятана при прокрутке вниз (сдвигается вверх, место в раскладке не меняется). */
  hidden: boolean;
  onBack: () => void;
  onToc: () => void;
  onSettings: () => void;
  barRef: Ref<HTMLElement>;
}

/**
 * Панель читалки (spec §8.1): «‹» к странице книги, название книги в одну строку и «Глава N из M»,
 * «Оглавление» и «Aa». Прилипает к верху, учитывает вырез экрана; снизу — линия прогресса книги.
 */
export function ReaderTopBar({ title, chapter, count, percent, hidden, onBack, onToc, onSettings, barRef }: ReaderTopBarProps) {
  return (
    <header ref={barRef} class="rbar" data-hidden={hidden ? '' : undefined}>
      <div class="rbar__row">
        <button type="button" class="rbar__btn rbar__back" aria-label="К странице книги" onClick={onBack}>
          <Icon name="left" size={22} />
        </button>
        <div class="rbar__titles">
          <p class="rbar__book">{noOrphanDash(title)}</p>
          <p class="rbar__chapter">
            Глава {chapter} из {count}
          </p>
        </div>
        <button type="button" class="rbar__btn" aria-label="Оглавление" onClick={onToc}>
          <Icon name="list" size={22} />
        </button>
        <button type="button" class="rbar__btn rbar__aa" aria-label="Настройки чтения" onClick={onSettings}>
          Aa
        </button>
      </div>
      <ProgressBar class="rbar__progress" value={percent} label="Прочитано в книге" />
    </header>
  );
}
