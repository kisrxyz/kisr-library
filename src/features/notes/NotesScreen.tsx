import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { noOrphanDash, plural } from '../../core/text';
import type { Mark } from '../../core/types';
import { getMarks } from '../../db/marks';
import { navDirection, navigate, rememberScroll, restoreScroll, toHash, type RouteOf } from '../../router';
import { books, progressMap } from '../../state/library';
import { EmptyState } from '../../ui/EmptyState';
import { Segmented } from '../../ui/Segmented';
import { TopBar } from '../../ui/TopBar';
import { ActionItem } from './ActionItem';
import { bookActions, groupMarks, type MarkGroup } from './groups';
import { MarkItem } from './MarkItem';
import './notes.css';

type Tab = RouteOf<'notes'>['tab'];

/** Отметки читаются из базы при открытии экрана: ставятся они только в читалке. `null` — ещё читаются. */
function useMarks(): { marks: Mark[] | null; failed: boolean } {
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getMarks().then(
      (list) => alive && setMarks(list),
      (error) => {
        console.error('Не удалось прочитать отметки', error);
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return { marks, failed };
}

export function NotesScreen({ route: current }: { route: RouteOf<'notes'> }) {
  const all = books.value;
  const progress = progressMap.value;
  const { marks, failed } = useMarks();

  const groups = useMemo(() => (marks ? groupMarks(marks, all) : []), [marks, all]);
  const markCount = groups.reduce((sum, g) => sum + g.marks.length, 0);
  const actions = useMemo(() => bookActions(all, progress), [all, progress]);
  const doneCount = actions.filter((b) => b.action?.done).length;

  // Прокрутка запоминается при уходе (например, в читалку) и возвращается кнопкой «назад», когда отметки уже на месте
  const restore = useRef(navDirection.value === 'pop');
  useLayoutEffect(() => () => rememberScroll('notes'), []);
  useLayoutEffect(() => {
    if (!restore.current || (marks === null && !failed)) return;
    restore.current = false;
    restoreScroll('notes');
  }, [marks, failed]);

  const switchTab = (tab: Tab) => {
    restore.current = false;
    navigate({ name: 'notes', tab }, { replace: true });
    window.scrollTo(0, 0);
  };

  return (
    <>
      <TopBar title="Заметки" />
      <main class="screen notes">
        <Segmented<Tab>
          label="Раздел заметок"
          value={current.tab}
          onChange={switchTab}
          options={[
            { value: 'marks', label: 'Отметки', count: marks ? markCount : undefined },
            { value: 'actions', label: 'Действия', count: actions.length },
          ]}
        />

        {current.tab === 'marks' ? (
          <MarksTab loading={marks === null && !failed} failed={failed} groups={groups} />
        ) : (
          <ActionsTab actions={actions} done={doneCount} />
        )}
      </main>
    </>
  );
}

function MarksTab({ loading, failed, groups }: { loading: boolean; failed: boolean; groups: MarkGroup[] }) {
  if (loading) return <div class="notes__list" aria-busy="true" />;
  if (failed) {
    return <EmptyState title="Не удалось прочитать отметки" text="Закрой приложение и открой снова. Сами отметки не пропали." />;
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        title="Отметок пока нет"
        text="В читалке нажми на абзац и выбери «Отметить» или «Заметка». Всё отмеченное соберётся здесь, по книгам."
      />
    );
  }
  return (
    <div class="notes__list">
      {groups.map(({ book, marks }) => (
        <section key={book.id} class="ngroup" aria-labelledby={`ngroup-${book.id}`}>
          <h2 id={`ngroup-${book.id}`} class="ngroup__head">
            <a class="ngroup__title" href={toHash({ name: 'book', id: book.id })}>
              {noOrphanDash(book.title)}
            </a>
            <span class="ngroup__count">
              {marks.length}&nbsp;{plural(marks.length, 'отметка', 'отметки', 'отметок')}
            </span>
          </h2>
          <ul class="ngroup__items">
            {marks.map((m) => (
              <li key={m.id}>
                <MarkItem mark={m} book={book} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ActionsTab({ actions, done }: { actions: ReturnType<typeof bookActions>; done: number }) {
  if (actions.length === 0) {
    return (
      <EmptyState
        title="Действий пока нет"
        text="Когда дочитаешь книгу, на её странице запиши одно действие, которое сделаешь после неё. Оно появится здесь, и его можно будет отметить «сделано»."
      />
    );
  }
  return (
    <div class="notes__list">
      <p class="notes__summary">
        Сделано {done} из {actions.length}
      </p>
      <ul class="ngroup__items">
        {actions.map((b) => (
          <li key={b.id}>
            <ActionItem book={b} />
          </li>
        ))}
      </ul>
    </div>
  );
}
