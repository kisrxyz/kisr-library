import { batch, signal, type Signal } from '@preact/signals';

/** Экраны приложения. Адреса — в `location.hash` (spec §10). */
export type Route =
  | { name: 'library'; params: URLSearchParams }
  | { name: 'book'; id: string }
  | { name: 'read'; id: string; chapter: number; find?: string; block?: string }
  | { name: 'search'; q: string }
  | { name: 'add'; shared: boolean }
  | { name: 'notes'; tab: 'marks' | 'actions' }
  | { name: 'settings' };

/** Маршрут одного экрана, например `RouteOf<'read'>`. */
export type RouteOf<N extends Route['name']> = Extract<Route, { name: N }>;

const libraryRoute = (params = new URLSearchParams()): Route => ({ name: 'library', params });

function chapterOf(segment: string | undefined): number {
  return segment && /^\d+$/.test(segment) ? Math.max(1, Number(segment)) : 1;
}

/** Разбирает `#/read/abc/3?find=…` в маршрут. Неизвестный или битый адрес — полка. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const qAt = raw.indexOf('?');
  const query = new URLSearchParams(qAt < 0 ? '' : raw.slice(qAt + 1));
  let segments: string[];
  try {
    segments = (qAt < 0 ? raw : raw.slice(0, qAt)).split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return libraryRoute();
  }
  const [name, id, chapter] = segments;

  switch (name) {
    case undefined:
      return libraryRoute(query);
    case 'book':
      return id ? { name: 'book', id } : libraryRoute();
    case 'read': {
      if (!id) return libraryRoute();
      const read: RouteOf<'read'> = { name: 'read', id, chapter: chapterOf(chapter) };
      const find = query.get('find');
      const block = query.get('b');
      if (find) read.find = find;
      if (block) read.block = block;
      return read;
    }
    case 'search':
      return { name: 'search', q: query.get('q') ?? '' };
    case 'add':
      return { name: 'add', shared: query.get('shared') === '1' };
    case 'notes':
      return { name: 'notes', tab: query.get('tab') === 'actions' ? 'actions' : 'marks' };
    case 'settings':
      return { name: 'settings' };
    default:
      return libraryRoute();
  }
}

function withQuery(path: string, entries: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) if (value) query.set(key, value);
  const s = query.toString();
  return s ? `${path}?${s}` : path;
}

/** Обратное к `parseHash`: значения по умолчанию в адрес не пишутся. */
export function toHash(r: Route): string {
  switch (r.name) {
    case 'library': {
      const s = r.params.toString();
      return s ? `#/?${s}` : '#/';
    }
    case 'book':
      return `#/book/${encodeURIComponent(r.id)}`;
    case 'read':
      return withQuery(`#/read/${encodeURIComponent(r.id)}/${r.chapter}`, { find: r.find, b: r.block });
    case 'search':
      return withQuery('#/search', { q: r.q });
    case 'add':
      return withQuery('#/add', { shared: r.shared ? '1' : undefined });
    case 'notes':
      return withQuery('#/notes', { tab: r.tab === 'actions' ? 'actions' : undefined });
    case 'settings':
      return '#/settings';
  }
}

const hasWindow = typeof window !== 'undefined';

/** Текущий экран. Меняется через `navigate`, `goBack`, ссылки `href="#/…"` и кнопки браузера. */
export const route: Signal<Route> = signal(hasWindow ? parseHash(location.hash) : libraryRoute());

/**
 * Как открыт текущий экран: `initial` — первая загрузка, `push` — новая запись истории (ссылка, вкладка,
 * `navigate`), `replace` — запись заменена, `pop` — переход к уже существующей записи (кнопка «назад» или
 * «вперёд», жест на iOS, `goBack`). Прокрутка возвращается только при `pop`: новый экран открывается с начала.
 */
export type NavDirection = 'initial' | 'push' | 'replace' | 'pop';

export const navDirection: Signal<NavDirection> = signal('initial');

// Каждая запись истории, открытая внутри приложения, помечается своим номером.
// Номер > 0 значит, что перед ней есть запись приложения и `history.back()` не уведёт наружу.
const DEPTH_KEY = 'kisrDepth';
// И адресом экрана под ней (откуда пришли): по нему `backTo` решает, шагнуть назад или заменить экран.
// Браузер хранит состояние записи и после перезагрузки.
const PREV_KEY = 'kisrPrev';
let depth = 0;

function stateField(state: unknown, key: string): unknown {
  return state !== null && typeof state === 'object' ? (state as Record<string, unknown>)[key] : undefined;
}

function depthOf(state: unknown): number | null {
  const value = stateField(state, DEPTH_KEY);
  return typeof value === 'number' ? value : null;
}

function prevOf(state: unknown): string | null {
  const value = stateField(state, PREV_KEY);
  return typeof value === 'string' ? value : null;
}

/** Пометить текущую запись. Замена (`url`) сохраняет, откуда пришли на эту запись. */
function markEntry(d: number, url?: string, prev?: string): void {
  const state: unknown = history.state;
  const base = state !== null && typeof state === 'object' ? state : {};
  const next: Record<string, unknown> = { ...base, [DEPTH_KEY]: d };
  if (prev !== undefined) next[PREV_KEY] = prev;
  history.replaceState(next, '', url);
}

/** Меняет маршрут вместе со способом перехода (экраны читают их в одном проходе). Тот же адрес — ничего не меняет. */
function setRoute(next: Route, how: NavDirection): void {
  if (toHash(next) === toHash(route.value)) return;
  batch(() => {
    navDirection.value = how;
    route.value = next;
  });
}

// Ссылки, адресная строка, «назад» и «вперёд». Браузер может прислать и popstate, и hashchange
// на один переход — второй вызов ничего не меняет.
function onHistoryChange(): void {
  const known = depthOf(history.state);
  if (known === null) {
    // Запись без номера: её только что создала ссылка или правка адреса — это переход вперёд
    // с экрана, который ещё в `route`
    depth += 1;
    markEntry(depth, undefined, toHash(route.value));
  } else {
    depth = known;
  }
  setRoute(parseHash(location.hash), known === null ? 'push' : 'pop');
}

if (hasWindow) {
  const known = depthOf(history.state);
  if (known === null) markEntry(0);
  else depth = known;
  // Прокрутку восстанавливают сами экраны (rememberScroll/restoreScroll), браузер не мешает.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('popstate', onHistoryChange);
  window.addEventListener('hashchange', onHistoryChange);
}

/** Переход на экран. Строка — адрес вида `#/book/id`. `replace` заменяет текущую запись истории. */
export function navigate(to: Route | string, opts: { replace?: boolean } = {}): void {
  const hash = toHash(typeof to === 'string' ? parseHash(to) : to);
  const next = parseHash(hash);
  if (opts.replace) {
    markEntry(depth, hash);
  } else {
    const from = toHash(route.value);
    if (hash === from) return;
    depth += 1;
    history.pushState({ [DEPTH_KEY]: depth, [PREV_KEY]: from }, '', hash);
  }
  setRoute(next, opts.replace ? 'replace' : 'push');
}

/**
 * «‹» к определённому экрану — например, из читалки к странице её книги. Если пришли оттуда (это запись
 * под текущей), шаг назад: экран вернётся с прежней прокруткой. Иначе (из поиска, заметок, открыли
 * снаружи) он встаёт на место текущего без новой записи, и его «Назад» ведёт туда, откуда пришли сюда.
 */
export function backTo(target: Route): void {
  if (depth > 0 && prevOf(history.state) === toHash(target)) history.back();
  else navigate(target, { replace: true });
}

/**
 * Кнопка «‹»: назад по истории, если предыдущий экран — из приложения.
 * Иначе (открыли по ссылке, запустили с экрана «Домой») — `fallback` вместо текущего экрана.
 */
export function goBack(fallback: Route): void {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

const scrollPositions = new Map<string, number>();

/**
 * Запомнить прокрутку экрана. Звать при уходе с экрана, например в очистке `useLayoutEffect`:
 * в этот момент старый экран ещё на месте и `window.scrollY` — его.
 */
export function rememberScroll(key: string): void {
  scrollPositions.set(key, window.scrollY);
}

/**
 * Вернуть запомненную прокрутку — только если экран открыт кнопкой «назад» (или «вперёд»), `navDirection === 'pop'`.
 * Иначе (ссылка, вкладка, `navigate`) экран открывается с начала. Звать в `useLayoutEffect`, чтобы не было скачка.
 */
export function restoreScroll(key: string): void {
  window.scrollTo(0, navDirection.value === 'pop' ? (scrollPositions.get(key) ?? 0) : 0);
}
