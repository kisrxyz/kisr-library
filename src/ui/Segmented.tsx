import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import './Segmented.css';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ComponentChildren;
  /** Число справа от подписи, например книг в разделе. */
  count?: number;
}

interface SegmentedProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Название группы для экранного диктора, например «Статус книг». */
  label?: string;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Выбор одного из нескольких: радиогруппа, стрелки переключают вариант. */
export function Segmented<T extends string | number>({ options, value, onChange, label }: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const select = (index: number) => {
    const i = (index + options.length) % options.length;
    onChange(options[i].value);
    (group.current?.children[i] as HTMLElement | undefined)?.focus();
  };

  return (
    <div ref={group} class="seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key in STEP) select(i + STEP[e.key]);
            else if (e.key === 'Home') select(0);
            else if (e.key === 'End') select(options.length - 1);
            else return;
            e.preventDefault();
          }}
        >
          {o.label}
          {o.count != null && <small>{o.count}</small>}
        </button>
      ))}
    </div>
  );
}
