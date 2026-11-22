import { computed } from '@preact/signals';
import { useLayoutEffect, useMemo } from 'preact/hooks';
import { callNumbers } from '../../core/book';
import {
  categoryCounts,
  continueReading,
  filterBooks,
  isNew,
  readingNow,
  statusCounts,
  type LengthFilter,
  type ShelfQuery,
  type StatusFilter,
} from '../../core/library';
import type { SortKey } from '../../core/types';
import { navigate, rememberScroll, restoreScroll, type RouteOf } from '../../router';
import { books, progressMap } from '../../state/library';
import { settings, updateSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { TopBar } from '../../ui/TopBar';
import { Banners } from './Banners';
import { BookCard } from './BookCard';
import { ContinueCard } from './ContinueCard';
import { ReadingNow } from './ReadingNow';
import { ShelfFilters } from './ShelfFilters';
import './LibraryScreen.css';

/** Шифры считаются один раз на изменение списка книг, а не при каждой перерисовке полки. */
const callNos = computed(() => callNumbers(books.value));

const STATUSES: readonly StatusFilter[] = ['all', 'reading', 'new', 'finished', 'fav'];
const LENGTHS: readonly LengthFilter[] = ['any', 'short', 'medium', 'long'];
const SORTS: readonly SortKey[] = ['recent', 'added', 'title', 'short', 'long'];

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

/** Фильтры из адреса `#/?status=&cat=&len=&sort=`; без `sort` порядок берётся из настроек. */
function readQuery(params: URLSearchParams, defaultSort: SortKey): ShelfQuery {
  return {
    status: pick(params.get('status'), STATUSES, 'all'),
    category: params.get('cat') || null,
    length: pick(params.get('len'), LENGTHS, 'any'),
    sort: pick(params.get('sort'), SORTS, defaultSort),
  };
}

/** Обратное к `readQuery`: значения по умолчанию в адрес не пишутся. */
function writeQuery(q: ShelfQuery, defaultSort: SortKey): URLSearchParams {
  const params = new URLSearchParams();
  if (q.status !== 'all') params.set('status', q.status);
  if (q.category) params.set('cat', q.category);
  if (q.length !== 'any') params.set('len', q.length);
  if (q.sort !== defaultSort) params.set('sort', q.sort);
  return params;
}

/**
 * Книга у верхнего края и её отступ от экрана. Карточки вне экрана (`content-visibility`) считаются
 * по оценке высоты, и одно число прокрутки при возврате попадает «рядом». С книгой-якорем полка
 * встаёт ровно на то место, откуда ушли.
 */
let anchor: { id: string; top: number } | null = null;

const shelfItems = () => document.querySelectorAll<HTMLElement>('.shelf__list > li');

function saveAnchor(): void {
  anchor = null;
  if (window.scrollY <= 0) return;
  const barBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  for (const li of shelfItems()) {
    const rect = li.getBoundingClientRect();
    if (rect.bottom > barBottom) {
      anchor = { id: li.dataset.id ?? '', top: rect.top };
      return;
    }
  }
}

function restoreAnchor(): void {
  if (!anchor) return;
  for (const li of shelfItems()) {
    if (li.dataset.id === anchor.id) {
      window.scrollBy(0, li.getBoundingClientRect().top - anchor.top);
      return;
    }
  }
}

const ONBOARDING = (
  <>
    <ol class="onboarding">
      <li>Попроси Claude написать книгу про то, что тебе интересно.</li>
      <li>Скопируй ответ целиком.</li>
      <li>Нажми «Добавить» — книга появится на полке.</li>
    </ol>
    <p class="onboarding__restore">
      Есть файл резервной копии? Открой «Ещё» и выбери <a href="#/settings">«Восстановить из копии»</a>.
    </p>
  </>
);

export function LibraryScreen({ route: current }: { route: RouteOf<'library'> }) {
  const all = books.value;
  const progress = progressMap.value;
  const { wpm, sort: defaultSort } = settings.value;
  const calls = callNos.value;

  // Прокрутка полки: возвращаем при открытии, запоминаем при уходе (после отрисовки списка)
  useLayoutEffect(() => {
    restoreScroll('library');
    restoreAnchor();
    return () => {
      rememberScroll('library');
      saveAnchor();
    };
  }, []);

  const query = readQuery(current.params, defaultSort);
  const categories = useMemo(() => categoryCounts(all), [all]);
  const counts = useMemo(() => statusCounts(all, progress), [all, progress]);
  // Раздела, которого на полке больше нет (последнюю книгу удалили), для фильтра не существует
  if (query.category !== null && !categories.some((c) => c.name === query.category)) query.category = null;

  const shown = useMemo(
    () => filterBooks(all, progress, query, wpm),
    [all, progress, query.status, query.category, query.length, query.sort, wpm],
  );

  const change = (patch: Partial<ShelfQuery>) => {
    const next = { ...query, ...patch };
    if (patch.sort !== undefined) {
      // Выбранный порядок запоминается и становится порядком по умолчанию
      updateSettings({ sort: patch.sort }).catch((e) => console.error('Не удалось сохранить сортировку', e));
    }
    // updateSettings меняет сигнал сразу, поэтому новый порядок уже «по умолчанию» и в адрес не попадает
    navigate({ name: 'library', params: writeQuery(next, settings.value.sort) }, { replace: true });
  };

  const reset = () => change({ status: 'all', category: null, length: 'any' });

  const filtered = query.status !== 'all' || query.category !== null || query.length !== 'any';
  const hero = filtered ? null : continueReading(all, progress);
  const others = filtered ? [] : readingNow(all, progress);
  const now = Date.now();

  return (
    <>
      <TopBar
        title={
          <span class="wordmark">
            Kisr <span>Library</span>
          </span>
        }
        actions={<Button variant="plain" icon="plus" href="#/add" aria-label="Добавить книгу" />}
      />
      <main class="screen shelf">
        <Banners />

        {all.length === 0 ? (
          <EmptyState
            title="Полка пока пустая"
            text={ONBOARDING}
            action={
              <Button variant="primary" icon="plus" href="#/add">
                Добавить книгу
              </Button>
            }
          />
        ) : (
          <>
            {hero && <ContinueCard entry={hero} callNo={calls.get(hero.book.id) ?? ''} wpm={wpm} />}
            <ReadingNow entries={others} total={counts.reading} wpm={wpm} />
            <ShelfFilters
              query={query}
              statusCounts={counts}
              categories={categories}
              total={all.length}
              shown={shown.length}
              onChange={change}
            />
            {shown.length === 0 ? (
              <EmptyState
                title="Ничего не нашлось"
                text="Под эти фильтры не подходит ни одна книга."
                action={<Button onClick={reset}>Сбросить фильтры</Button>}
              />
            ) : (
              <ul class="shelf__list">
                {shown.map((book) => {
                  const p = progress.get(book.id);
                  return (
                    <li key={book.id} data-id={book.id}>
                      <BookCard
                        book={book}
                        progress={p}
                        callNo={calls.get(book.id) ?? ''}
                        wpm={wpm}
                        fresh={isNew(book, p, now)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}
