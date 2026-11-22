import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

interface SectionProps {
  title: string;
  /** Содержимое секции: карточка строк или блоки справки. */
  children: ComponentChildren;
}

/** Секция «Ещё»: мелкий заголовок-надпись, как на странице книги, и карточки под ним. */
export function Section({ title, children }: SectionProps) {
  const id = useId();
  return (
    <section class="sset" aria-labelledby={id}>
      <h2 id={id} class="sset__label">
        {title}
      </h2>
      {children}
    </section>
  );
}
