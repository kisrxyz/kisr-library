/**
 * Синхронизация для экранов (spec §18.5–18.6): состояние в сигналах, расписание проходов, подключение
 * и отключение. Сам проход — `sync/engine.ts`, правила слияния — `core/sync.ts`.
 */
import { signal } from '@preact/signals';
import { plural } from '../core/text';
import { onLocalChange, type ChangeKind } from '../db/changes';
import { clearSync, getLastSyncAt, getSyncConfig, setSyncConfig, type SyncConfig } from '../db/sync';
import { runSync, type SyncResult } from '../sync/engine';
import { GitHubError, getRepo, getUser, repoClient, type GitHubErrorKind } from '../sync/github';
import { toast } from '../ui/toast-state';
import { loadLibrary } from './library';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncView {
  phase: SyncPhase;
  /** `владелец/репозиторий`, если синхронизация включена. */
  repo: string | null;
  lastSyncAt: number | null;
  /** Текст ошибки для «Ещё»; у `offline` его нет. */
  error: string | null;
  /** Ключ не подходит или без права записи: нужен новый. */
  needsToken: boolean;
}

const OFF: SyncView = { phase: 'off', repo: null, lastSyncAt: null, error: null, needsToken: false };

export const syncView = signal<SyncView>({ ...OFF });
/** С другого устройства пришло место чтения этих книг (для подсказки в открытой читалке). */
export const progressArrived = signal<{ ids: string[]; at: number } | null>(null);

/** После правки книги, отметки, галочки, удаления. */
export const DATA_DELAY_MS = 3000;
/** После места чтения — столько тишины: чтение не должно делать коммит каждые полминуты. */
export const PROGRESS_DELAY_MS = 60_000;
/** Повторы после временной ошибки: через минуту, потом каждые 5 минут. */
export const RETRY_MS = [60_000, 300_000] as const;

export const DEFAULT_REPO = 'kisr-library-data';

const MESSAGES: Record<GitHubErrorKind | 'public', string> = {
  auth: 'Ключ не подходит. Вставь новый',
  forbidden: 'У ключа нет права записи в репозиторий. Создай новый ключ',
  notfound: 'Не вижу репозиторий. Проверь название и что ключ к нему открыт',
  public: 'Репозиторий открытый — книги увидит кто угодно. Сделай его приватным',
  rate: 'GitHub просит подождать. Повторю позже',
  server: 'GitHub не отвечает. Повторю позже',
  conflict: 'Не получилось договориться с другим устройством. Повторю позже',
  bad: 'Не удалось синхронизировать. Повторю позже',
  offline: 'Нет сети — продолжу, когда появится',
};

/** Ошибки, после которых без человека дальше никак: проходы останавливаются до правки в «Ещё». */
const STOPPING: GitHubErrorKind[] = ['auth', 'forbidden', 'notfound'];

type Deadline = 'data' | 'progress' | 'now' | 'retry';

let config: SyncConfig | null = null;
/** Остановлена из-за ошибки, где нужен человек: расписание молчит, «Синхронизировать сейчас» работает. */
let stopped = false;
/** Приватность репозитория проверена в этом запуске приложения. */
let privacyChecked = false;
let retryStep = 0;
let deadlines: Partial<Record<Deadline, number>> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let active: Promise<SyncResult | null> | null = null;
let again = false;
let unsubscribe: (() => void)[] = [];
let fetchImpl: typeof fetch = (input, init) => fetch(input, init);

function setView(patch: Partial<SyncView>): void {
  syncView.value = { ...syncView.value, ...patch };
}

function arm(): void {
  clearTimeout(timer);
  timer = undefined;
  const due = Math.min(...Object.values(deadlines));
  if (!Number.isFinite(due)) return;
  timer = setTimeout(() => {
    timer = undefined;
    if (active) again = true;
    else void syncNow();
  }, Math.max(0, due - Date.now()));
}

/** Запланировать проход. `reset` — отсчёт заново (тишина после последней правки), иначе — что раньше. */
function schedule(kind: Deadline, delayMs: number, reset: boolean): void {
  if (!config || stopped) return;
  const at = Date.now() + delayMs;
  const old = deadlines[kind];
  deadlines[kind] = reset || old === undefined ? at : Math.min(old, at);
  arm();
}

/** Пройти как можно скорее (через `delayMs`). Если синхронизация выключена или остановлена — ничего. */
export function requestSync(delayMs = 0): void {
  schedule('now', delayMs, false);
}

function onChange(kind: ChangeKind): void {
  schedule(kind, kind === 'progress' ? PROGRESS_DELAY_MS : DATA_DELAY_MS, true);
}

interface Env {
  doc?: EventTarget & { visibilityState: DocumentVisibilityState };
  win?: EventTarget;
}

/** Подписки на правки, видимость и сеть — один раз. */
function subscribe(env: Env = {}): void {
  if (unsubscribe.length) return;
  unsubscribe.push(onLocalChange(onChange));
  const doc = env.doc ?? (typeof document === 'undefined' ? undefined : document);
  const win = env.win ?? (typeof window === 'undefined' ? undefined : window);
  if (doc) {
    const onVisibility = () => {
      if (!config || stopped) return;
      if (doc.visibilityState === 'hidden') {
        // Уходим из приложения: отложенное отправляем сразу, пока страницу не заморозили
        if (deadlines.data !== undefined || deadlines.progress !== undefined) void syncNow();
      } else requestSync();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    unsubscribe.push(() => doc.removeEventListener('visibilitychange', onVisibility));
  }
  if (win) {
    const onOnline = () => requestSync();
    win.addEventListener('online', onOnline);
    unsubscribe.push(() => win.removeEventListener('online', onOnline));
  }
}

/** Запуск приложения (после загрузки полки): настройка из базы, подписки и первый проход. Не бросает. */
export async function initSync(env?: Env): Promise<void> {
  subscribe(env);
  try {
    const [cfg, last] = await Promise.all([getSyncConfig(), getLastSyncAt()]);
    config = cfg;
    syncView.value = cfg ? { phase: 'idle', repo: `${cfg.owner}/${cfg.repo}`, lastSyncAt: last, error: null, needsToken: false } : { ...OFF };
    if (cfg) requestSync();
  } catch (error) {
    console.error('Не удалось прочитать настройку синхронизации', error);
  }
}

function stop(message: string, needsToken: boolean): void {
  stopped = true;
  deadlines = {};
  arm();
  const repeated = syncView.value.phase === 'error' && syncView.value.error === message;
  setView({ phase: 'error', error: message, needsToken });
  if (!repeated) toast(`Синхронизация остановилась: ${message.charAt(0).toLowerCase()}${message.slice(1)}`);
}

async function doRun(cfg: SyncConfig): Promise<SyncResult | null> {
  setView({ phase: 'syncing' });
  try {
    if (!privacyChecked) {
      const info = await getRepo(cfg.token, cfg.owner, cfg.repo, fetchImpl);
      if (config !== cfg) return null;
      if (!info.private) {
        stop(MESSAGES.public, false);
        return null;
      }
      privacyChecked = true;
    }
    const result = await runSync(repoClient(cfg, fetchImpl));
    if (config !== cfg) return result;
    retryStep = 0;
    setView({ phase: 'idle', lastSyncAt: Date.now(), error: null, needsToken: false });
    if (result.added + result.updated + result.removed > 0 || result.progressFrom.length) await loadLibrary();
    if (result.added) toast(`С другого устройства: +${result.added} ${plural(result.added, 'книга', 'книги', 'книг')}`);
    if (result.progressFrom.length) progressArrived.value = { ids: result.progressFrom, at: Date.now() };
    return result;
  } catch (error) {
    if (config !== cfg) return null;
    const kind: GitHubErrorKind = error instanceof GitHubError ? error.kind : 'bad';
    if (!(error instanceof GitHubError)) console.error('Синхронизация не удалась', error);
    if (STOPPING.includes(kind)) {
      stop(MESSAGES[kind], kind !== 'notfound');
      return null;
    }
    setView({ phase: kind === 'offline' ? 'offline' : 'error', error: kind === 'offline' ? null : MESSAGES[kind] });
    deadlines.retry = Date.now() + RETRY_MS[Math.min(retryStep, RETRY_MS.length - 1)];
    retryStep++;
    arm();
    return null;
  }
}

/**
 * Проход сейчас. Если проход уже идёт — после него будет ещё один, а вернётся текущий.
 * `null` — синхронизация выключена или проход не удался (причина в `syncView`).
 */
export async function syncNow(): Promise<SyncResult | null> {
  if (!config) return null;
  if (active) {
    again = true;
    return active;
  }
  deadlines = {};
  arm();
  const run = doRun(config);
  active = run;
  try {
    return await run;
  } finally {
    active = null;
    if (again) {
      again = false;
      if (config && !stopped) void syncNow();
    }
  }
}

/** Что ввели в поле «Репозиторий»: название, `владелец/название` или ссылка. Пусто — `kisr-library-data`. */
export function parseRepoInput(input: string, login: string): { owner: string; repo: string } | null {
  const NAME = /^[A-Za-z0-9_.-]+$/;
  let text = input.trim().replace(/\/+$/, '');
  if (!text) return { owner: login, repo: DEFAULT_REPO };
  const url = text.match(/github\.com\/(.+)$/i);
  if (url) text = url[1].replace(/\/+$/, '');
  text = text.replace(/\.git$/i, '');
  const parts = text.split('/');
  if (parts.length === 1 && NAME.test(parts[0])) return { owner: login, repo: parts[0] };
  if (parts.length === 2 && NAME.test(parts[0]) && NAME.test(parts[1])) return { owner: parts[0], repo: parts[1] };
  return null;
}

function connectMessage(error: unknown): string {
  if (!(error instanceof GitHubError)) {
    console.error('Не удалось подключить синхронизацию', error);
    return 'Не получилось подключить. Попробуй ещё раз';
  }
  switch (error.kind) {
    case 'auth':
      return 'Ключ не подходит. Проверь, что скопировал его целиком';
    case 'forbidden':
    case 'notfound':
      return MESSAGES[error.kind];
    case 'offline':
      return 'Нет сети. Подключись к интернету и попробуй ещё раз';
    default:
      return 'GitHub сейчас не отвечает. Попробуй чуть позже';
  }
}

/**
 * Подключить синхронизацию: ключ подходит → репозиторий найден и приватный → настройка сохраняется
 * и идёт первый проход. Его итог — в `result` (`null`, если проход не удался: причина в `syncView`).
 */
export async function connectSync(
  token: string,
  repoInput: string,
): Promise<{ ok: true; result: SyncResult | null } | { ok: false; message: string }> {
  subscribe();
  const key = token.trim();
  if (!key) return { ok: false, message: 'Вставь ключ доступа' };
  try {
    const { login } = await getUser(key, fetchImpl);
    const target = parseRepoInput(repoInput, login);
    if (!target) return { ok: false, message: 'Не понимаю название репозитория. Например: kisr-library-data' };
    const info = await getRepo(key, target.owner, target.repo, fetchImpl);
    if (!info.private) return { ok: false, message: MESSAGES.public };

    const [owner, repo] = info.fullName.split('/');
    const cfg: SyncConfig = { token: key, owner, repo, branch: info.defaultBranch };
    await active?.catch(() => null);
    const old = await getSyncConfig();
    // Другой репозиторий — знание о прежнем больше не годится
    if (old && (old.owner !== owner || old.repo !== repo)) await clearSync();
    await setSyncConfig(cfg);
    config = cfg;
    stopped = false;
    privacyChecked = true;
    retryStep = 0;
    setView({ phase: 'idle', repo: info.fullName, error: null, needsToken: false });
    return { ok: true, result: await syncNow() };
  } catch (error) {
    return { ok: false, message: connectMessage(error) };
  }
}

/** Отключить на этом устройстве: книги остаются здесь и в репозитории, ключ забывается. */
export async function disconnectSync(): Promise<void> {
  config = null;
  stopped = false;
  privacyChecked = false;
  deadlines = {};
  arm();
  await active?.catch(() => null);
  await clearSync();
  syncView.value = { ...OFF };
}

/** Только для тестов: подменить `fetch` (поддельный GitHub). */
export function __setFetchForTests(f: typeof fetch): void {
  fetchImpl = f;
}

/** Только для тестов: дождаться, пока закончатся все начатые проходы (и цепочка «ещё один»). */
export async function __whenSyncIdleForTests(): Promise<void> {
  while (active) {
    await active.catch(() => null);
    await Promise.resolve();
  }
}

/** Только для тестов: забыть настройку, расписание и подписки (`fetch` остаётся подменённым). */
export function __resetSyncForTests(): void {
  for (const off of unsubscribe) off();
  unsubscribe = [];
  config = null;
  stopped = false;
  privacyChecked = false;
  retryStep = 0;
  deadlines = {};
  clearTimeout(timer);
  timer = undefined;
  active = null;
  again = false;
  syncView.value = { ...OFF };
  progressArrived.value = null;
}
