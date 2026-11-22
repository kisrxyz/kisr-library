import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';

// Заглушка: настройки, копии и помощь делает задача 12.
export function SettingsScreen() {
  return (
    <>
      <TopBar title="Ещё" />
      <main class="screen">
        <EmptyState
          title="Настройки"
          text="Здесь будут тема и шрифт, резервные копии, статистика и помощь."
        />
      </main>
    </>
  );
}
