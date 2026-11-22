import type { ComponentChildren } from 'preact';
import { goBack, type Route } from '../router';
import { Icon } from './Icon';
import './TopBar.css';

interface TopBarProps {
  /** Куда вести «‹», если открыли не из приложения; иначе — назад по истории (`goBack`). */
  back?: Route;
  /** Подпись у «‹», например «Полка». */
  backLabel?: string;
  /** Заголовок экрана — это его `<h1>`. */
  title?: ComponentChildren;
  /** Кнопки справа. */
  actions?: ComponentChildren;
}

/** Верхняя панель: прилипает к верху, учитывает вырез экрана. */
export function TopBar({ back, backLabel, title, actions }: TopBarProps) {
  return (
    <header class="topbar">
      <div class="topbar__row">
        {back && (
          <button
            type="button"
            class="topbar__back"
            aria-label={backLabel && backLabel !== 'Назад' ? `Назад: ${backLabel}` : 'Назад'}
            onClick={() => goBack(back)}
          >
            <Icon name="left" size={22} />
            {backLabel && <span>{backLabel}</span>}
          </button>
        )}
        {title ? <h1 class="topbar__title">{title}</h1> : <div class="topbar__title" />}
        {actions && <div class="topbar__actions">{actions}</div>}
      </div>
    </header>
  );
}
