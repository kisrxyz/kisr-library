// Штриховые иконки 24×24, линия 1.9 со скруглёнными концами.
// Набор из старого приложения + settings, library, clock, filter, sort, share в том же стиле.
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  home: '<path d="M4 11.2 12 4.8l8 6.4V19a1 1 0 0 1-1 1h-4.5v-5.2h-5V20H5a1 1 0 0 1-1-1z"/>',
  star: '<path d="m12 3.9 2.47 5.02 5.53.8-4 3.9.94 5.5L12 16.53 7.06 19.12 8 13.62l-4-3.9 5.53-.8z"/>',
  note: '<path d="M5 19.2h3.8L19.3 8.7a2.1 2.1 0 0 0-3-3L5.9 16.2z"/><path d="m14.6 7.4 3 3"/>',
  spark: '<path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5M6 6l3.3 3.3M14.7 14.7 18 18M18 6l-3.3 3.3M9.3 14.7 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  shuffle:
    '<path d="M4 7h3c2.2 0 3.3 1.1 4.4 3l1.2 2c1.1 1.9 2.2 3 4.4 3h3M17 12l3 3-3 3M4 17h3c1.3 0 2.2-.4 3-1.1M14 8.1c.8-.7 1.7-1.1 3-1.1h3M17 4l3 3-3 3"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  cards: '<rect x="4" y="6" width="12" height="14" rx="2"/><path d="M8 3.5h10a2 2 0 0 1 2 2v12"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.2h8L17 7"/>',
  more:
    '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  upload: '<path d="M12 16V4.5M7 9.5l5-5 5 5M5 19.5h14"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  check: '<path d="M5 12.6l4.3 4.3L19 7.2"/>',
  paste: '<rect x="6" y="5" width="12" height="15" rx="2"/><path d="M9.5 5V3.8h5V5"/>',
  settings: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  library:
    '<path d="M3 20.5h18"/><rect x="4.5" y="5" width="4" height="15.5" rx="1"/><rect x="10.5" y="8" width="4" height="12.5" rx="1"/><rect x="16.4" y="9.5" width="3.6" height="11" rx="1" transform="rotate(12 20 20.5)"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  filter: '<path d="M4.5 5.5h15l-5.8 7v5.2l-3.4 1.8v-7z"/>',
  sort: '<path d="M4 7h9M4 12h6M4 17h3M17 5v14M13.8 15.8 17 19l3.2-3.2"/>',
  share:
    '<path d="M12 14.5V4M8.2 7.8 12 4l3.8 3.8M8.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5"/>',
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** Сторона в пикселях; CSS родителя может переопределить. */
  size?: number;
  class?: string;
}

/** Декоративная иконка: подпись даёт кнопка или текст рядом (`aria-label`). */
export function Icon({ name, size = 24, class: className }: IconProps) {
  return (
    <svg
      class={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
