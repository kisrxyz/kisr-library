import { useState } from 'preact/hooks';
import type { LengthFilter, ShelfQuery, StatusFilter } from '../../core/library';
import { plural } from '../../core/text';
import type { SortKey } from '../../core/types';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { Segmented, type SegmentedOption } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import './ShelfFilters.css';

/** Столько разделов показывается фишками; если их больше — в конце «Все разделы…». */
export const MAX_CATEGORY_CHIPS = 12;

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Недавние',
  added: 'Добавлены',
  title: 'Название',
  short: 'Короче',
  long: 'Длиннее',
};
const SORT_ORDER: SortKey[] = ['recent', 'added', 'title', 'short', 'long'];

export const LENGTH_LABELS: Record<LengthFilter, string> = {
  any: 'Любая',
  short: 'До 10 мин',
  medium: '10–30 мин',
  long: '30+ мин',
};
const LENGTH_ORDER: LengthFilter[] = ['any', 'short', 'medium', 'long'];

interface ShelfFiltersProps {
  query: ShelfQuery;
  statusCounts: Record<StatusFilter, number>;
  categories: { name: string; count: number }[];
  /** Всего книг на полке и сколько осталось под фильтрами. */
  total: number;
  shown: number;
  onChange: (patch: Partial<ShelfQuery>) => void;
}

interface Option {
  value: string;
  label: string;
  count?: number;
}

const STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * Вертикальный список вариантов с одним выбранным: радиогруппа, строка ≥ 48px.
 * Стрелки, Home и End только двигают фокус (в списке один пункт доступен по Tab, как в radiogroup);
 * выбирают Enter, пробел и нажатие — иначе в шторке разделов первая же стрелка выбрала бы раздел
 * и закрыла шторку, и по списку нельзя было бы ходить с клавиатуры или экранным диктором.
 */
export function OptionList({
  options,
  value,
  onChange,
  label,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  // Пункт с фокусом доступен по Tab; пока фокуса в списке не было — выбранный
  const [focused, setFocused] = useState<number | null>(null);
  const tabbable = Math.min(focused ?? selected, options.length - 1);

  return (
    <div class="optlist" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          class="optlist__item"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === tabbable ? 0 : -1}
          onFocus={() => setFocused(i)}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            let to = -1;
            if (e.key in STEP) to = (i + STEP[e.key] + options.length) % options.length;
            else if (e.key === 'Home') to = 0;
            else if (e.key === 'End') to = options.length - 1;
            if (to < 0) return;
            e.preventDefault();
            (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
          }}
        >
          <span>{o.label}</span>
          {o.count != null && <small>{o.count}</small>}
          {o.value === value && <Icon name="check" size={20} />}
        </button>
      ))}
    </div>
  );
}

/** Статус, разделы, сортировка и длина. Состояние хранит адрес (`#/?status=&cat=&len=&sort=`), здесь только вид. */
export function ShelfFilters({ query, statusCounts, categories, total, shown, onChange }: ShelfFiltersProps) {
  const [sheet, setSheet] = useState<'sort' | 'categories' | null>(null);
  const close = () => setSheet(null);

  const statusOptions: SegmentedOption<StatusFilter>[] = [
    { value: 'all', label: 'Все', count: statusCounts.all },
    { value: 'reading', label: 'Читаю', count: statusCounts.reading },
    { value: 'new', label: 'Новые', count: statusCounts.new },
    { value: 'finished', label: 'Прочитано', count: statusCounts.finished },
    {
      value: 'fav',
      label: (
        <>
          <Icon name="star" size={16} />
          <span class="sr-only">Избранные</span>
        </>
      ),
      count: statusCounts.fav,
    },
  ];

  // Фишки: самые большие разделы; выбранный раздел всегда виден, даже если он не вошёл в первые 12
  const manyCategories = categories.length > MAX_CATEGORY_CHIPS;
  let chips = manyCategories ? categories.slice(0, MAX_CATEGORY_CHIPS) : categories;
  if (query.category !== null && !chips.some((c) => c.name === query.category)) {
    const active = categories.find((c) => c.name === query.category);
    if (active) chips = [active, ...chips];
  }

  const lengthActive = query.length !== 'any';
  const counted = shown === total ? `${total}` : `${shown} из ${total}`;

  return (
    <div class="filters">
      <Segmented
        label="Статус книг"
        options={statusOptions}
        value={query.status}
        onChange={(status) => onChange({ status })}
      />

      {categories.length > 1 && (
        <div class="filters__cats" role="group" aria-label="Разделы">
          <Chip active={query.category === null} count={total} onClick={() => onChange({ category: null })}>
            Все
          </Chip>
          {chips.map((c) => (
            <Chip
              key={c.name}
              active={query.category === c.name}
              count={c.count}
              onClick={() => onChange({ category: query.category === c.name ? null : c.name })}
            >
              {c.name}
            </Chip>
          ))}
          {manyCategories && <Chip onClick={() => setSheet('categories')}>Все разделы…</Chip>}
        </div>
      )}

      <div class="shelf-head">
        <h2>
          Книги <span class="shelf-head__count">{counted}</span>
        </h2>
        <Button
          class={lengthActive ? 'filters__sort is-on' : 'filters__sort'}
          variant="plain"
          icon="sort"
          onClick={() => setSheet('sort')}
          aria-haspopup="dialog"
        >
          {SORT_LABELS[query.sort]}
          {lengthActive && ` · ${LENGTH_LABELS[query.length]}`}
        </Button>
      </div>

      <Sheet open={sheet === 'sort'} title="Сортировка и фильтр" onClose={close}>
        <div class="filters__group">
          <h3 class="filters__label">Сортировка</h3>
          <OptionList
            label="Сортировка"
            options={SORT_ORDER.map((value) => ({ value, label: SORT_LABELS[value] }))}
            value={query.sort}
            onChange={(sort) => onChange({ sort: sort as SortKey })}
          />
        </div>
        <div class="filters__group">
          <h3 class="filters__label">Длина</h3>
          <Segmented
            label="Длина книги"
            options={LENGTH_ORDER.map((value) => ({ value, label: LENGTH_LABELS[value] }))}
            value={query.length}
            onChange={(length) => onChange({ length })}
          />
        </div>
        <Button variant="primary" wide onClick={close}>
          Готово
        </Button>
      </Sheet>

      <Sheet open={sheet === 'categories'} title="Все разделы" onClose={close}>
        <p class="filters__hint">
          {categories.length} {plural(categories.length, 'раздел', 'раздела', 'разделов')}
        </p>
        <OptionList
          label="Раздел"
          options={[
            { value: '', label: 'Все разделы', count: total },
            ...categories.map((c) => ({ value: c.name, label: c.name, count: c.count })),
          ]}
          value={query.category ?? ''}
          onChange={(name) => {
            onChange({ category: name || null });
            close();
          }}
        />
      </Sheet>
    </div>
  );
}
