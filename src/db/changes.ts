/**
 * Что-то изменилось в библиотеке на этом устройстве: синхронизация (spec §18.5) по этому сигналу
 * планирует отправку. `progress` — место чтения (отправляется реже), `data` — всё остальное.
 */
export type ChangeKind = 'data' | 'progress';

const listeners = new Set<(kind: ChangeKind) => void>();

/** Подписаться; возвращает отписку. */
export function onLocalChange(fn: (kind: ChangeKind) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Вызывается функциями `db/*` после удачной записи. Ошибка подписчика запись не ломает. */
export function notifyLocalChange(kind: ChangeKind): void {
  for (const fn of listeners) {
    try {
      fn(kind);
    } catch (error) {
      console.error('Ошибка подписчика на изменения', error);
    }
  }
}
