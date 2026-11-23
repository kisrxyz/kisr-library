import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Button } from './Button';
import './Sheet.css';

interface SheetProps {
  open: boolean;
  title: string;
  /** Крестик, нажатие мимо шторки, Esc и «назад» на Android. */
  onClose: () => void;
  children?: ComponentChildren;
}

/** Совпадает с уходом `.sheet__panel` в Sheet.css. Столько шторка остаётся на экране после закрытия. */
export const EXIT_MS = 200;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Сколько после закрытия шторки прокрутка страницы ещё считается сделанной браузером, а не читателем:
 * вернулась полоса прокрутки и браузер подвинул страницу (привязка прокрутки), на iPhone убралась клавиатура.
 */
export const SCROLL_SETTLE_MS = 700;

let scrollLocks = 0;
/** Когда шторка последней отпустила прокрутку страницы (`performance.now()`). */
let releasedAt = Number.NEGATIVE_INFINITY;

function lockPageScroll(lock: boolean): void {
  scrollLocks = Math.max(0, scrollLocks + (lock ? 1 : -1));
  document.documentElement.classList.toggle('is-scroll-locked', scrollLocks > 0);
  if (!lock && scrollLocks === 0) releasedAt = performance.now();
}

/**
 * Прокрутку страницы держит шторка (`html.is-scroll-locked`) или отпустила только что (`SCROLL_SETTLE_MS`):
 * так страницу двигает браузер — клавиатура над полем заметки, вернувшаяся полоса прокрутки, — а не читатель.
 */
export function pageScrollHeld(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('is-scroll-locked') || performance.now() - releasedAt < SCROLL_SETTLE_MS;
}

/** Только для тестов: шторка прошлого теста больше не держит прокрутку. */
export function __resetPageScrollForTests(): void {
  scrollLocks = 0;
  releasedAt = Number.NEGATIVE_INFINITY;
  document.documentElement.classList.remove('is-scroll-locked');
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Tab и Shift+Tab ходят по кругу внутри шторки. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  // tabIndex < 0 — например, невыбранные варианты Segmented: Tab на них не попадает
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
  const active = document.activeElement;
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
  } else if (e.shiftKey && (active === items[0] || active === panel || !panel.contains(active))) {
    e.preventDefault();
    items[items.length - 1].focus();
  } else if (!e.shiftKey && (active === items[items.length - 1] || !panel.contains(active))) {
    e.preventDefault();
    items[0].focus();
  }
}

/**
 * Шторка снизу. Открывается модальным `<dialog>` поверх всего (в том числе вкладок),
 * держит фокус внутри и возвращает его туда, откуда шторку открыли.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Открытие монтирует шторку сразу, закрытие — после анимации ухода
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = setTimeout(
      () => {
        setMounted(false);
        setEntered(false);
      },
      prefersReducedMotion() ? 0 : EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [open, mounted]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!mounted || !dialog || !panel) return;

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    lockPageScroll(true);
    panel.focus({ preventScroll: true });
    // Сначала шторка встаёт за краем экрана, кадром позже — выезжает
    void panel.offsetHeight;
    const frame = requestAnimationFrame(() => setEntered(true));

    return () => {
      cancelAnimationFrame(frame);
      lockPageScroll(false);
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      returnFocus?.focus({ preventScroll: true });
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <dialog
      ref={dialogRef}
      class="sheet"
      data-state={open && entered ? 'open' : 'closed'}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'Tab' && panelRef.current) {
          trapTab(e, panelRef.current);
        }
      }}
    >
      <div class="sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panelRef} class="sheet__panel" tabIndex={-1}>
        <div class="sheet__head">
          <h2 id={titleId} class="sheet__title">
            {title}
          </h2>
          <Button variant="plain" icon="close" aria-label="Закрыть" onClick={onClose} />
        </div>
        <div class="sheet__body">{children}</div>
      </div>
    </dialog>
  );
}
