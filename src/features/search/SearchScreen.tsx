import { computed } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { callNumbers } from '../../core/book';
import { MIN_QUERY, TEXT_LIMIT, searchBooks, type TextHit } from '../../core/search';
import { normalizeForSearch, plural } from '../../core/text';
import { navDirection, navigate, rememberScroll, restoreScroll, type RouteOf } from '../../router';
import { books } from '../../state/library';
import { settings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { TopBar } from '../../ui/TopBar';
import { searchLibraryText } from './engine';
import { BookResults, ResultGroup, TextResults } from './SearchResults';
import './SearchScreen.css';

/** Шифры считаются один раз на изменение списка книг (как на полке). */
const callNos = computed(() => callNumbers(books.value));

/** Пауза после последней буквы, прежде чем искать. */
const DEBOUNCE_MS = 150;
/** Сколько книг показываем сразу; остальные — по кнопке. */
const BOOKS_SHOWN = 30;

/** Результат поиска по тексту. `q` — запрос, по которому найдены `hits`; пока идёт новый поиск, старые места остаются. */
interface TextState {
  status: 'loading' | 'done' | 'error';
  q: string;
  hits: TextHit[];
}

const NO_TEXT: TextState = { status: 'done', q: '', hits: [] };

/** Поиск (spec §10.3): по книгам и по тексту глав. Запрос живёт в адресе `#/search?q=`. */
export function SearchScreen({ route: current }: { route: RouteOf<'search'> }) {
  const all = books.value;
  const { wpm } = settings.value;
  const calls = callNos.value;

  const [input, setInput] = useState(current.q);
  /** Запрос, по которому ищем: отстаёт от `input` на `DEBOUNCE_MS`. */
  const [query, setQuery] = useState(current.q);
  const [text, setText] = useState<TextState>(NO_TEXT);
  const [allBooks, setAllBooks] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Что мы сами записали в адрес: отличает нашу правку адреса от чужой (тег на странице книги, вкладка «Поиск»). */
  const written = useRef(current.q);
  /**
   * Экран открыт кнопкой «назад»: прокрутку вернём, когда результаты уже на месте. Сразу при открытии
   * страница ещё короткая и прокрутка упрётся в её край. Любая правка запроса отменяет возврат.
   */
  const restore = useRef(navDirection.value === 'pop');

  // Вернулись «назад» к найденному — клавиатура закрывала бы результаты, поле в фокус не берём
  useEffect(() => {
    if (!(restore.current && current.q)) field.current?.focus();
    return () => clearTimeout(timer.current);
  }, []);

  // Прокрутка запоминается при уходе с экрана (старый экран ещё на месте)
  useLayoutEffect(() => () => rememberScroll('search'), []);

  // Адрес изменил кто-то другой — поле и результаты следуют за ним
  useEffect(() => {
    if (current.q === written.current) return;
    written.current = current.q;
    restore.current = false;
    clearTimeout(timer.current);
    setInput(current.q);
    setQuery(current.q);
  }, [current.q]);

  /** Принять запрос: искать и записать в адрес (запись истории заменяется — «назад» не листает буквы). */
  const commit = (value: string) => {
    clearTimeout(timer.current);
    restore.current = false;
    setQuery(value);
    setAllBooks(false);
    written.current = value.trim();
    navigate({ name: 'search', q: written.current }, { replace: true });
  };

  const change = (value: string) => {
    setInput(value);
    restore.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(value), DEBOUNCE_MS);
  };

  const clear = () => {
    setInput('');
    commit('');
    field.current?.focus();
  };

  const active = normalizeForSearch(query).length >= MIN_QUERY;
  const bookHits = useMemo(() => (active ? searchBooks(all, query) : []), [active, all, query]);

  // Поиск по тексту: после паузы ввода, порциями; устаревший запрос бросается
  useEffect(() => {
    if (!active) {
      setText(NO_TEXT);
      return;
    }
    let stale = false;
    setText((s) => ({ ...s, status: 'loading' }));
    searchLibraryText(all, query, () => stale)
      .then((hits) => {
        if (hits) setText({ status: 'done', q: query, hits });
      })
      .catch((error) => {
        console.error('Не удалось найти в тексте', error);
        if (!stale) setText({ status: 'error', q: query, hits: [] });
      });
    return () => {
      stale = true;
    };
  }, [active, all, query]);

  const byId = useMemo(() => new Map(all.map((b) => [b.id, b])), [all]);
  // Показанные места могут быть от прошлого запроса: пока идёт новый поиск, они остаются, но «ничего» ещё не значит ничего
  const searching = active && (text.status === 'loading' || text.q !== query);
  const capped = text.hits.length >= TEXT_LIMIT;
  const nothing = active && !searching && text.status === 'done' && bookHits.length === 0 && text.hits.length === 0;

  // Возврат «назад»: прокручиваем, когда результаты по тексту уже отрисованы (до отрисовки лишь коротенькая страница)
  useLayoutEffect(() => {
    if (!restore.current || searching) return;
    restore.current = false;
    restoreScroll('search');
  }, [searching]);

  // Тянут результаты — убираем клавиатуру, чтобы видеть их целиком
  const dismissKeyboard = () => {
    if (document.activeElement === field.current) field.current?.blur();
  };

  if (all.length === 0) {
    return (
      <>
        <TopBar title="Поиск" />
        <main class="screen">
          <EmptyState
            title="Искать пока негде"
            text="Добавь книги — и здесь найдутся названия, теги и места в тексте."
            action={<Button href="#/add">Добавить книгу</Button>}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar title="Поиск" />
      <main class="screen ssearch">
        <form
          class="sfield"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            commit(input);
            field.current?.blur();
          }}
        >
          <div class="sfield__box">
            <Icon name="search" size={20} class="sfield__icon" />
            <input
              ref={field}
              class="sfield__input"
              type="search"
              enterkeyhint="search"
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
              placeholder="Название, тег или слово из текста"
              aria-label="Поиск по библиотеке"
              value={input}
              onInput={(event) => change(event.currentTarget.value)}
            />
            {input && (
              <button type="button" class="sfield__clear" aria-label="Очистить" onClick={clear}>
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        </form>

        <div class="sbody" onTouchMove={dismissKeyboard}>
          {!active && (
            <EmptyState
              title={normalizeForSearch(input) ? 'Ещё одну букву' : 'Что ищем?'}
              text={
                normalizeForSearch(input)
                  ? 'Для поиска нужно хотя бы две буквы.'
                  : 'Ищи по названию, тегам, разделу или по тексту книг.'
              }
            />
          )}

          {nothing && (
            <EmptyState
              title="Ничего не нашлось"
              text={`По запросу «${query.trim()}» нет ни книг, ни мест в тексте. Попробуй другое слово или только его начало.`}
            />
          )}

          {bookHits.length > 0 && (
            <ResultGroup id="sgroup-books" title="Книги" count={bookHits.length}>
              <BookResults
                books={allBooks ? bookHits : bookHits.slice(0, BOOKS_SHOWN)}
                callNos={calls}
                q={query}
                wpm={wpm}
              />
              {!allBooks && bookHits.length > BOOKS_SHOWN && (
                <Button onClick={() => setAllBooks(true)}>Показать все ({bookHits.length})</Button>
              )}
            </ResultGroup>
          )}

          {active && text.hits.length > 0 && (
            <ResultGroup
              id="sgroup-text"
              title="В тексте"
              count={capped ? `${TEXT_LIMIT}+` : text.hits.length}
              busy={searching}
            >
              <TextResults hits={text.hits} byId={byId} q={text.q} />
              {capped && !searching && (
                <p class="sbody__note">Показаны первые {TEXT_LIMIT} мест. Уточни запрос, чтобы найти нужное.</p>
              )}
            </ResultGroup>
          )}

          {searching && text.hits.length === 0 && <p class="sbody__note">Ищу в тексте книг…</p>}
          {active && !searching && text.status === 'error' && (
            <p class="sbody__note">Не удалось загрузить тексты книг. Поиск по названиям и тегам работает.</p>
          )}

          <p class="sr-only" role="status">
            {active && !searching
              ? `Найдено: ${bookHits.length} ${plural(bookHits.length, 'книга', 'книги', 'книг')}, ${text.hits.length} ${plural(text.hits.length, 'место', 'места', 'мест')} в тексте`
              : ''}
          </p>
        </div>
      </main>
    </>
  );
}
