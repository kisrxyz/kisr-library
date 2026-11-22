import type { RouteOf } from '../../router';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: заметки и действия делает задача 12.
export function NotesScreen({ route }: { route: RouteOf<'notes'> }) {
  return (
    <>
      <TopBar title="Заметки" />
      <main class="screen">
        {route.tab === 'actions' ? (
          <EmptyState
            title="Действий пока нет"
            text="Когда дочитаешь книгу, запиши одно действие, которое сделаешь после неё. Оно появится здесь."
          />
        ) : (
          <EmptyState
            title="Отметок пока нет"
            text="В читалке нажми на абзац и выбери «Отметить» или «Заметка» — всё отмеченное соберётся здесь."
          />
        )}
      </main>
    </>
  );
}
