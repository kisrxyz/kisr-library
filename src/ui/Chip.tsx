import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import './Chip.css';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'children'> {
  /** Выбран (фильтр включён). Без `active` фишка — обычная кнопка, например тег. */
  active?: boolean;
  count?: number;
  class?: string;
  children?: ComponentChildren;
}

/** Фишка: раздел, тег, фильтр. */
export function Chip({ active, count, class: className, children, ...rest }: ChipProps) {
  return (
    <button type="button" class={className ? `chip ${className}` : 'chip'} aria-pressed={active} {...rest}>
      <span>{children}</span>
      {count != null && <small>{count}</small>}
    </button>
  );
}
