import { runToastAction, toasts } from './toast-state';
import './Toast.css';

export { toast } from './toast-state';

/** Место для тостов: внизу, над вкладками. Одно на приложение (в `app.tsx`). */
export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={t.leaving ? 'toast toast--leaving' : 'toast'}>
          <span class="toast__text">{t.text}</span>
          {t.action && (
            <button type="button" class="toast__action" disabled={t.leaving} onClick={() => runToastAction(t.id)}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
