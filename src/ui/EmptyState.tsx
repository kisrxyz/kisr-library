import type { ComponentChildren } from 'preact';
import './EmptyState.css';

interface EmptyStateProps {
  title: string;
  /** Что здесь появится и как этого добиться. */
  text: ComponentChildren;
  /** Обычно `<Button variant="primary">`. */
  action?: ComponentChildren;
}

/** Пустой экран или блок — как чистая карточка библиотечного каталога. */
export function EmptyState({ title, text, action }: EmptyStateProps) {
  return (
    <section class="empty">
      <h2 class="empty__title">{title}</h2>
      <div class="empty__text">{text}</div>
      {action && <div class="empty__action">{action}</div>}
    </section>
  );
}
