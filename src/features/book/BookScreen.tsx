import type { RouteOf } from '../../router';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: страницу книги делает задача 6.
export function BookScreen(_props: { route: RouteOf<'book'> }) {
  return (
    <>
      <TopBar back={{ name: 'library', params: new URLSearchParams() }} backLabel="Полка" />
      <main class="screen">
        <EmptyState
          title="Книга не найдена"
          text="Возможно, её уже нет на полке."
          action={<Button href="#/">На полку</Button>}
        />
      </main>
    </>
  );
}
