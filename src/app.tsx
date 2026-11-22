import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { AddScreen } from './features/add/AddScreen';
import { BookScreen } from './features/book/BookScreen';
import { LibraryScreen } from './features/library/LibraryScreen';
import { NotesScreen } from './features/notes/NotesScreen';
import type { ReaderScreen as ReaderScreenType } from './features/reader/ReaderScreen';
import { SearchScreen } from './features/search/SearchScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { route, type Route, type RouteOf } from './router';
import { libraryError, libraryReady } from './state/library';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { TabBar } from './ui/TabBar';
import { Toasts } from './ui/Toast';
import { TopBar } from './ui/TopBar';

type Reader = typeof ReaderScreenType;

let loadedReader: Reader | null = null;
let readerLoading: Promise<Reader> | null = null;

function loadReader(): Promise<Reader> {
  readerLoading ??= import('./features/reader/ReaderScreen').then((m) => (loadedReader = m.ReaderScreen));
  return readerLoading;
}

/**
 * Читалка — отдельный файл: в ней marked и DOMPurify, полке и остальным экранам они не нужны,
 * и стартовый JS остаётся маленьким. Пока файл грузится (из кэша — миллисекунды), экран пустой.
 */
function LazyReader({ route: current }: { route: RouteOf<'read'> }) {
  const [Screen, setScreen] = useState<Reader | null>(() => loadedReader);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Screen) return;
    let alive = true;
    loadReader().then(
      (loaded) => alive && setScreen(() => loaded),
      (error) => {
        console.error('Не удалось загрузить читалку', error);
        readerLoading = null;
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (Screen) return <Screen route={current} />;
  if (!failed) return null;
  return (
    <>
      <TopBar back={{ name: 'book', id: current.id }} backLabel="Назад" />
      <main class="screen">
        <EmptyState
          title="Не удалось открыть читалку"
          text="Похоже, приложение обновилось или пропала связь. Обнови страницу."
          action={<Button onClick={() => location.reload()}>Обновить</Button>}
        />
      </main>
    </>
  );
}

function screenFor(current: Route) {
  switch (current.name) {
    case 'library':
      return <LibraryScreen route={current} />;
    case 'book':
      return <BookScreen route={current} />;
    case 'read':
      return <LazyReader route={current} />;
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

/**
 * Хранилище не открылось при запуске. Вместо экранов — что делать: пустая полка выглядела бы как
 * потеря всех книг, а «Удалить приложение» стёрло бы их по-настоящему.
 */
function StorageError() {
  return (
    <div class="app">
      <main class="screen screen--alone">
        <EmptyState
          title="Не удалось открыть хранилище"
          text="Книги на месте — не удаляй приложение. Закрой его и открой снова; если не поможет, перезагрузи телефон."
          action={
            <Button variant="primary" onClick={() => location.reload()}>
              Перезагрузить
            </Button>
          }
        />
      </main>
    </div>
  );
}

export function App() {
  // Если загрузка всё же закончится позже, `libraryReady` вернёт обычные экраны
  if (libraryError.value && !libraryReady.value) return <StorageError />;
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
