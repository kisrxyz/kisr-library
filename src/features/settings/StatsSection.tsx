import { useMemo } from 'preact/hooks';
import { books, progressMap } from '../../state/library';
import { Section } from './Section';
import { libraryStats } from './stats';

/** «Статистика»: книги, время чтения, карточки. */
export function StatsSection() {
  const all = books.value;
  const progress = progressMap.value;
  const stats = useMemo(() => libraryStats(all, progress), [all, progress]);

  return (
    <Section title="Статистика">
      <div class="sset__card">
        <p class="srow">
          Книг: <b>{stats.total}</b> · прочитано: <b>{stats.finished}</b> · читаю: <b>{stats.reading}</b>
        </p>
        <p class="srow">
          Минут чтения: <b>{stats.minutesRead}</b>
        </p>
        <p class="srow">
          Карточек: <b>{stats.cards}</b>
        </p>
      </div>
    </Section>
  );
}
