/**
 * Место «где остановился» (spec §8.4). Когда место в главе восстановлено, хук следит за блоком у линии
 * чтения и пишет его в прогресс: при прокрутке — не чаще раза в 300 мс (и не позже чем через 300 мс
 * после остановки), при сворачивании (`visibilitychange: hidden`), на `pagehide` и при уходе из главы.
 * Копит активное время чтения: пока вкладка видна и прокрутка была в последние 60 с.
 * Если текст перестроился (размер шрифта в «Aa», поворот экрана, догрузка шрифта), тот же блок
 * возвращается на линию чтения — позиция держится за абзац, а не за пиксели.
 */
import { useEffect, useRef } from 'preact/hooks';
import { chapterStartWords, newProgress } from '../../core/progress';
import type { BookMeta, Progress, Settings } from '../../core/types';
import { ownText, type EnhanceResult } from '../../markdown/enhance';
import { books, progressMap, saveProgress } from '../../state/library';
import { settings } from '../../state/settings';
import { anchorScrollY, chapterWordsAt, findAnchor, LINE_GAP, progressAt, type Anchor, type Rect } from './position';
import { isProgrammaticScroll, scrollWindowTo } from './useAutoHide';

/** Не чаще одной записи за столько миллисекунд при прокрутке. */
export const SAVE_THROTTLE_MS = 300;
/** Время считается чтением, если читатель прокручивал не дальше столько назад. */
const ACTIVE_WINDOW_MS = 60_000;
/** Чтобы восстановленный блок не ушёл за экран, таблица над ним «съедает» не больше такой доли экрана. */
const MAX_GAP_SHARE = 0.6;

export interface PositionTrackingOptions {
  book: BookMeta;
  chapter: number;
  /** Блоки главы после `enhanceChapter`; `null`, пока глава не отрисована. */
  res: EnhanceResult | null;
  /** Место восстановлено. До этого ничего не пишется, иначе сохранённое место затрётся началом главы. */
  ready: boolean;
  /** Сразу записать место, как только оно восстановлено: книга открыта впервые, другая глава, переход по ссылке. */
  saveOnReady: boolean;
  /** Линия чтения в координатах окна: низ панели плюс зазор. */
  lineY: () => number;
  /** Конец главы уже в кадре или выше: глава прочитана целиком. */
  endReached: () => boolean;
  /** Прочитано слов книги до текущего места — для плашки и линии прогресса. */
  onWords: (wordsRead: number) => void;
}

export interface PositionTracker {
  /** Читатель сам выбрал место (переход к блоку): записать его сейчас. */
  save(): void;
  /** Записать место и больше не писать: читатель уходит в другую главу. */
  close(): void;
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, height: r.height };
};

/** Прокрутка, при которой якорь (блок и доля) стоит на линии чтения под панелью высотой `headerH`. */
export function anchorTargetY(anchors: HTMLElement[], anchor: Anchor, headerH: number): number {
  const rects = anchors.map((el) => {
    const r = rectOf(el);
    return { top: r.top + window.scrollY, height: r.height };
  });
  return anchorScrollY(rects, anchor.index, anchor.offset, headerH, window.innerHeight * MAX_GAP_SHARE);
}

const typographyOf = (s: Settings) => `${s.fontSize}|${s.lineHeight}|${s.font}|${s.hyphens}`;

/** Шрифты главы догружены (или ждать дольше `ms` в сумме не стоит: текст пока скрыт). */
export async function fontsSettled(ms = 2000): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const deadline = performance.now() + ms;
  for (let i = 0; i < 3; i++) {
    const left = deadline - performance.now();
    if (left <= 0) return;
    const ready = fonts.ready as Promise<unknown> | undefined;
    if (!ready) return;
    // Шрифт не загрузился — ждать больше нечего: раскладка уже с запасным шрифтом
    await Promise.race([ready.catch(() => undefined), new Promise((r) => setTimeout(r, left))]);
    // Кадр спустя раскладка могла запросить ещё начертание (курсив, латиницу)
    await new Promise((r) => requestAnimationFrame(r));
    if (fonts.status !== 'loading') return;
  }
}

export function usePositionTracking(opts: PositionTrackingOptions): PositionTracker {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const api = useRef<PositionTracker | null>(null);
  const tracker = useRef<PositionTracker>({
    save: () => api.current?.save(),
    close: () => api.current?.close(),
  });

  useEffect(() => {
    const { res, ready } = optsRef.current;
    if (!ready || !res) return;
    const { anchors } = res;

    let closed = false;
    /** Место отличается от записанного: писать и позицию, а не только время. */
    let moved = optsRef.current.saveOnReady;
    let latest: Anchor = { index: 0, offset: 0 };
    /** Слова главы до `latest` — считаются при замере, запись раскладку не трогает. */
    let latestWords = 0;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastWrite = -Infinity;
    let lastUserScroll = -Infinity;
    let width = window.innerWidth;

    // Активное время чтения
    let visible = document.visibilityState !== 'hidden';
    let lastTick = performance.now();
    let lastActive = lastTick;
    let pendingMs = 0;
    const account = (now: number) => {
      if (visible) {
        const end = Math.min(now, lastActive + ACTIVE_WINDOW_MS);
        if (end > lastTick) pendingMs += end - lastTick;
      }
      lastTick = now;
    };

    // Экран главы уже убран из страницы (идёт переход на другой экран, а очистка этого эффекта ещё не дошла):
    // у блоков нулевые рамки, и измерение приняло бы «все блоки выше линии» за конец главы. Браузер при этом
    // зажимает прокрутку по короткой странице — приходит `scroll` и затирает место, на котором читатель остановился.
    const detached = () => anchors.length > 0 && !anchors[0].isConnected;

    const measure = () => {
      if (detached()) return;
      const o = optsRef.current;
      latest = findAnchor(anchors.map(rectOf), o.lineY());
      // Конец главы в кадре — глава прочитана целиком, даже если линия ещё на последних абзацах
      const chapterWords = o.book.chapters[o.chapter - 1]?.words ?? 0;
      latestWords = o.endReached() ? chapterWords : chapterWordsAt(res, latest.index, latest.offset, chapterWords);
      o.onWords(Math.min(o.book.words, chapterStartWords(o.book, o.chapter) + latestWords));
    };

    const write = () => {
      clearTimeout(timer);
      timer = undefined;
      if (closed) return;
      const now = performance.now();
      account(now);
      lastWrite = now;
      const o = optsRef.current;
      // Книгу удалили, пока она была открыта, — прогресс ей не нужен
      if (!books.value.some((b) => b.id === o.book.id)) return;
      const at = Date.now();
      const old = progressMap.value.get(o.book.id);
      if (!old && !moved) return;
      const p0 = old ?? newProgress(o.book.id, at);
      let next: Progress;
      if (moved) {
        const el = anchors[latest.index];
        next = progressAt(p0, {
          meta: o.book,
          chapter: o.chapter,
          index: latest.index,
          offset: latest.offset,
          key: el?.dataset.key ?? null,
          text: el ? ownText(el) : '',
          inChapter: latestWords,
          now: at,
          addMs: pendingMs,
        });
      } else {
        next = { ...p0, lastReadAt: at, readingMs: p0.readingMs + Math.round(pendingMs) };
      }
      pendingMs = 0;
      void saveProgress(next).catch((e) => console.error('Не удалось сохранить место чтения', e));
    };

    const throttled = () => {
      const wait = lastWrite + SAVE_THROTTLE_MS - performance.now();
      if (wait <= 0) write();
      else if (timer === undefined) timer = setTimeout(write, wait);
    };

    /** Вернуть блок `latest` на линию чтения после перестройки текста. */
    const reanchor = () => {
      if (closed || detached()) return;
      const y = anchorTargetY(anchors, latest, optsRef.current.lineY() - LINE_GAP);
      if (Math.abs(y - window.scrollY) >= 1) scrollWindowTo(y);
    };

    const onFrame = () => {
      frame = 0;
      measure();
      if (moved) throttled();
    };

    const onScroll = () => {
      if (detached()) return;
      if (!isProgrammaticScroll()) {
        const now = performance.now();
        account(now);
        lastActive = now;
        lastUserScroll = now;
        moved = true;
      }
      if (!frame) frame = requestAnimationFrame(onFrame);
    };

    const onVisibility = () => {
      const now = performance.now();
      account(now);
      visible = document.visibilityState !== 'hidden';
      if (visible) {
        lastActive = now;
      } else {
        measure();
        write();
      }
    };

    const onPageHide = () => {
      measure();
      write();
    };

    // Поворот экрана: событие resize приходит раньше scroll того же кадра, `latest` ещё прежний
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      reanchor();
    };

    // Догрузился шрифт (например, курсив) — строки сдвинулись; пока читатель листает, не мешаем
    const onFonts = () => {
      if (performance.now() - lastUserScroll > 250) reanchor();
    };

    // «Aa»: сигнал меняется раньше, чем переменные шрифта попадают на страницу (applySettings).
    // В микрозадаче раскладка уже новая, а `latest` ещё прежний — по нему блок и возвращается
    let typography = typographyOf(settings.value);
    const unsubscribe = settings.subscribe((s) => {
      const next = typographyOf(s);
      if (next === typography) return;
      typography = next;
      queueMicrotask(() => {
        reanchor();
        void fontsSettled().then(reanchor);
      });
    });

    measure();
    if (moved) write();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    document.fonts?.addEventListener?.('loadingdone', onFonts);

    api.current = {
      save() {
        measure();
        moved = true;
        write();
      },
      close() {
        measure();
        write();
        closed = true;
      },
    };

    return () => {
      // Экран уже меняется: пишем последнее измеренное место, не измеряя заново
      write();
      closed = true;
      api.current = null;
      cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
    };
  }, [opts.ready, opts.res]);

  return tracker.current;
}
