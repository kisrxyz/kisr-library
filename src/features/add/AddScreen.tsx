import type { RouteOf } from '../../router';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: импорт и конструктор запроса делает задача 10 (route.shared — пришло через «Поделиться»).
export function AddScreen(_props: { route: RouteOf<'add'> }) {
  return (
    <>
      <TopBar title="Добавить" />
      <main class="screen">
        <EmptyState
          title="Добавление книг"
          text="Здесь ты вставишь ответ Claude или выберешь файл .md — и книга встанет на полку."
        />
      </main>
    </>
  );
}
