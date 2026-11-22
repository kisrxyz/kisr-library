import { route, toHash, type Route } from '../router';
import { Icon, type IconName } from './Icon';
import './TabBar.css';

const TABS: { label: string; icon: IconName; to: Route }[] = [
  { label: 'Полка', icon: 'library', to: { name: 'library', params: new URLSearchParams() } },
  { label: 'Поиск', icon: 'search', to: { name: 'search', q: '' } },
  { label: 'Добавить', icon: 'plus', to: { name: 'add', shared: false } },
  { label: 'Заметки', icon: 'note', to: { name: 'notes', tab: 'marks' } },
  { label: 'Ещё', icon: 'more', to: { name: 'settings' } },
];

function scrollToTop(): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

/** Нижние вкладки. В читалке их нет. */
export function TabBar() {
  const current = route.value;
  if (current.name === 'read') return null;
  // Страница книги принадлежит полке
  const section = current.name === 'book' ? 'library' : current.name;

  return (
    <nav class="tabbar" aria-label="Разделы">
      {TABS.map((tab) => (
        <a
          key={tab.label}
          class="tabbar__tab"
          href={toHash(tab.to)}
          aria-current={tab.to.name === section ? 'page' : undefined}
          onClick={(e) => {
            // Повторное нажатие на открытую вкладку — наверх, фильтры и запрос остаются
            if (tab.to.name === current.name) {
              e.preventDefault();
              scrollToTop();
            }
          }}
        >
          <Icon name={tab.icon} />
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}
