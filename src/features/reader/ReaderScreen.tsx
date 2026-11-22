import type { RouteOf } from '../../router';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: читалку делает задача 8. Нижних вкладок здесь нет.
export function ReaderScreen({ route }: { route: RouteOf<'read'> }) {
  return (
    <>
      <TopBar back={{ name: 'book', id: route.id }} title={`Глава ${route.chapter}`} />
      <main class="screen">
        <EmptyState
          title="Глава не найдена"
          text="Этой книги нет на полке."
          action={<Button href="#/">На полку</Button>}
        />
      </main>
    </>
  );
}
