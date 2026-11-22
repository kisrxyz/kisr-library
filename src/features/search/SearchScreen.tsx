import type { RouteOf } from '../../router';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: поиск делает задача 11 (запрос — route.q).
export function SearchScreen(_props: { route: RouteOf<'search'> }) {
  return (
    <>
      <TopBar title="Поиск" />
      <main class="screen">
        <EmptyState
          title="Искать пока негде"
          text="Добавь книги — и здесь найдутся названия, теги и места в тексте."
          action={<Button href="#/add">Добавить книгу</Button>}
        />
      </main>
    </>
  );
}
