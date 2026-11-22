import { useLayoutEffect } from 'preact/hooks';
import { AddScreen } from './features/add/AddScreen';
import { BookScreen } from './features/book/BookScreen';
import { LibraryScreen } from './features/library/LibraryScreen';
import { NotesScreen } from './features/notes/NotesScreen';
import { ReaderScreen } from './features/reader/ReaderScreen';
import { SearchScreen } from './features/search/SearchScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { route, type Route } from './router';
import { TabBar } from './ui/TabBar';
import { Toasts } from './ui/Toast';

function screenFor(current: Route) {
  switch (current.name) {
    case 'library':
      return <LibraryScreen route={current} />;
    case 'book':
      return <BookScreen route={current} />;
    case 'read':
      return <ReaderScreen route={current} />;
    case 'search':
      return <SearchScreen route={current} />;
    case 'add':
      return <AddScreen route={current} />;
    case 'notes':
      return <NotesScreen route={current} />;
    case 'settings':
      return <SettingsScreen />;
  }
}

/**
 * Новый экран открывается с начала. Стоит перед экраном, поэтому срабатывает раньше его
 * `useLayoutEffect` — и экран может вернуть свою прокрутку через `restoreScroll`.
 */
function ScrollToTop() {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return null;
}

export function App() {
  const current = route.value;
  return (
    <div class="app" data-chrome={current.name === 'read' ? 'reader' : undefined}>
      <ScrollToTop key={current.name} />
      {screenFor(current)}
      <TabBar />
      <Toasts />
    </div>
  );
}
