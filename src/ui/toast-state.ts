import { signal } from '@preact/signals';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  text: string;
  action?: ToastAction;
  /** Уже уходит: кнопка не работает, тост гаснет. */
  leaving: boolean;
}

/** Тосты на экране, новые — в конце. */
export const toasts = signal<ToastItem[]>([]);

const MAX_VISIBLE = 3;
/** Совпадает с анимацией `toast-out` в Toast.css. */
const LEAVE_MS = 160;
/** Больше setTimeout не умеет: `ms = Infinity` значит «пока не нажмут». */
const MAX_DELAY = 2 ** 31 - 1;

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function clearTimer(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function remove(id: number): void {
  clearTimer(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Короткое сообщение внизу экрана. С действием — кнопка рядом: «Удалено · Вернуть». */
export function toast(text: string, action?: ToastAction, ms = 4000): void {
  const id = nextId++;
  const list = [...toasts.value, { id, text, action, leaving: false }];
  const overflow = list.length - MAX_VISIBLE;
  for (const old of list.slice(0, Math.max(0, overflow))) clearTimer(old.id);
  toasts.value = list.slice(-MAX_VISIBLE);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), Math.min(ms, MAX_DELAY)),
  );
}

/** Убрать тост раньше срока. */
export function dismissToast(id: number): void {
  const item = toasts.value.find((t) => t.id === id);
  if (!item || item.leaving) return;
  clearTimer(id);
  toasts.value = toasts.value.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  timers.set(
    id,
    setTimeout(() => remove(id), LEAVE_MS),
  );
}

/** Нажата кнопка тоста: тост уходит, действие выполняется. */
export function runToastAction(id: number): void {
  const item = toasts.value.find((t) => t.id === id);
  if (!item?.action || item.leaving) return;
  dismissToast(id);
  item.action.run();
}
