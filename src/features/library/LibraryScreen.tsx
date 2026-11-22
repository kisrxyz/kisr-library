import type { RouteOf } from '../../router';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: полку делает задача 5 (фильтры придут в route.params).
export function LibraryScreen(_props: { route: RouteOf<'library'> }) {
  return (
    <>
      <TopBar
        title={
          <span class="wordmark">
            Kisr <span>Library</span>
          </span>
        }
        actions={<Button variant="plain" icon="plus" href="#/add" aria-label="Добавить книгу" />}
      />
      <main class="screen">
        <EmptyState
          title="Полка пока пустая"
          text="Попроси Claude написать книгу, скопируй ответ и нажми «Добавить»."
          action={
            <Button variant="primary" icon="plus" href="#/add">
              Добавить книгу
            </Button>
          }
        />
      </main>
    </>
  );
}
