/**
 * Читалка (spec §8.1, §8.4, §8.5): одна глава — один экран с прокруткой. Открывается ровно там, где
 * остановился: `?find=` → `?b=` → сохранённое место этой главы → начало. Место пишется при прокрутке
 * и при уходе (после перехода по `?b=`/`?find=` — только если читатель сам прокрутил); конец главы
 * отмечает её дочитанной, конец последней обязательной — всю книгу.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { chapterStartWords, lastRequiredChapter, markChapterDone, newProgress, percentOf, remainingWords } from '../../core/progress';
import { minutesLabel } from '../../core/time';
import type { BookMeta } from '../../core/types';
import { getChapter } from '../../db/books';
import { getTasks, setTask } from '../../db/tasks';
import { enhanceChapter, ownText, type EnhanceResult } from '../../markdown/enhance';
import { renderMarkdown } from '../../markdown/render';
import { backTo, navigate, route as currentRoute, toHash, type RouteOf } from '../../router';
import { books, progressMap, saveProgress, setFinished } from '../../state/library';
import { settings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { toast } from '../../ui/Toast';
import { TopBar } from '../../ui/TopBar';
import { ChapterEnd } from './ChapterEnd';
import { FinishBlock } from './FinishBlock';
import { highlightMatch } from './highlight';
import { LINE_GAP, restoreTarget, scrollTargetY, type Anchor, type TargetSource } from './position';
import { ReaderTopBar } from './ReaderTopBar';
import { BlockActionsSlot, SettingsSlot, TocSlot } from './slots';
import { scrollWindowTo, useAutoHide } from './useAutoHide';
import { anchorTargetY, fontsSettled, usePositionTracking } from './usePositionTracking';
import './reader.css';

/** Подсветка блока, к которому перешли (spec §8.4: ~2 с). Снимается таймером: при reduced-motion анимации нет. */
const FLASH_MS = 2000;
/** Тост «Книга в «Прочитано»» с «Отменить» держится дольше обычного. */
const UNDO_TOAST_MS = 6000;

export function ReaderScreen({ route }: { route: RouteOf<'read'> }) {
  const book = books.value.find((b) => b.id === route.id);
  if (!book || book.chapters.length === 0) {
    return (
      <>
        <TopBar back={{ name: 'library', params: new URLSearchParams() }} backLabel="Назад" />
        <main class="screen">
          <EmptyState
            title="Книга не найдена"
            text="Возможно, её удалили или ссылка устарела."
            action={<Button href="#/">На полку</Button>}
          />
        </main>
      </>
    );
  }
  // Прогресс и ссылки могут указывать за последнюю главу (книгу обновили) — открываем крайнюю
  const chapter = Math.min(Math.max(1, route.chapter), book.chapters.length);
  return <ChapterView key={`${book.id}\n${chapter}`} book={book} chapter={chapter} route={route} />;
}

type Phase = 'loading' | 'shown' | 'ready' | 'missing' | 'error';

interface ChapterViewProps {
  book: BookMeta;
  chapter: number;
  route: RouteOf<'read'>;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function flash(el: HTMLElement): () => void {
  el.classList.add('flash-hit');
  const timer = setTimeout(() => el.classList.remove('flash-hit'), FLASH_MS);
  return () => clearTimeout(timer);
}

/** Адрес главы без `?b=`/`?find=`: после перехода перезагрузка должна вернуть сохранённое место, а не ссылку. */
function cleanAddress(bookId: string, chapter: number): void {
  const r = currentRoute.value;
  if (r.name !== 'read' || r.id !== bookId) return;
  if (r.chapter !== chapter || r.find || r.block) navigate({ name: 'read', id: bookId, chapter }, { replace: true });
}

function ChapterView({ book, chapter, route }: ChapterViewProps) {
  const id = book.id;
  const count = book.chapters.length;
  const meta = book.chapters[chapter - 1];
  const progress = progressMap.value.get(id);
  const { wpm } = settings.value;

  const barRef = useRef<HTMLElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bookRef = useRef(book);
  bookRef.current = book;
  /** Адрес, с которым глава открылась: его `?find=`/`?b=` обработаны при восстановлении. */
  const startRoute = useRef(route);
  /** Глава открыта переходом по ссылке (заметка, поиск, «Продолжить»): место не пишется, пока не прокрутил. */
  const peek = !!(startRoute.current.find || startRoute.current.block);

  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState(0);
  const [res, setRes] = useState<EnhanceResult | null>(null);
  const [version, setVersion] = useState(0);
  const [saveOnReady, setSaveOnReady] = useState(false);
  const [sheet, setSheet] = useState<'toc' | 'settings' | null>(null);
  const [wordsRead, setWordsRead] = useState(() =>
    progress?.chapter === chapter ? progress.wordsRead : chapterStartWords(book, chapter),
  );
  const ready = phase === 'ready';

  const lineY = () => (barRef.current?.offsetHeight ?? 0) + LINE_GAP;
  const endReached = () => {
    const end = endRef.current;
    return !!end && end.getBoundingClientRect().top < window.innerHeight;
  };
  const headerH = () => barRef.current?.offsetHeight ?? 0;

  const chromeVisible = useAutoHide(ready, endReached);

  // Плашка и линия меняются только вместе с видимыми числами, а не на каждый кадр прокрутки
  const shownWords = useRef(wordsRead);
  const onWords = (w: number) => {
    const b = bookRef.current;
    const was = shownWords.current;
    if (percentOf(b, w) === percentOf(b, was) && minutesLabel(remainingWords(b, w), wpm) === minutesLabel(remainingWords(b, was), wpm)) return;
    shownWords.current = w;
    setWordsRead(w);
  };

  const tracker = usePositionTracking({
    book,
    chapter,
    res,
    root: () => proseRef.current,
    ready,
    saveOnReady,
    peek,
    lineY,
    endReached,
    onWords,
  });

  // 1. Текст главы: Markdown → безопасный HTML → ключи блоков, чекбоксы, колоды
  useEffect(() => {
    let alive = true;
    setPhase('loading');
    Promise.all([getChapter(id, chapter), getTasks(id)])
      .then(([ch, tasks]) => {
        const root = proseRef.current;
        if (!alive || !root) return;
        if (!ch) {
          setPhase('missing');
          return;
        }
        root.innerHTML = renderMarkdown(ch.md);
        const enhanced = enhanceChapter(root, {
          tasksDone: tasks.done,
          onTask: (key, done) =>
            void setTask(id, key, done).catch((e) => {
              console.error('Не удалось сохранить пункт', e);
              toast('Не удалось сохранить');
            }),
        });
        setRes(enhanced);
        setVersion((v) => v + 1);
        setPhase('shown');
      })
      .catch((e) => {
        console.error('Не удалось открыть главу', e);
        if (alive) setPhase('error');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  /** Встать на точку: блок под панель (переход) или вернуть сохранённый вид (продолжение чтения). */
  const place = (anchors: HTMLElement[], target: Anchor & { source: TargetSource }, find?: string): HTMLElement | null => {
    const root = proseRef.current!;
    let mark: HTMLElement | null = null;
    if (find) {
      mark = target.source === 'find' ? highlightMatch(anchors[target.index], find) : highlightMatch(root, find, '.deck');
    }
    if (mark) {
      // Найденное — на линию чтения: блок с совпадением, сдвинутый до строки с <mark>
      const host = target.source === 'find' ? anchors[target.index] : mark;
      const h = host.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      const offset = h.height > 0 ? Math.min(1, Math.max(0, (m.top - h.top) / h.height)) : 0;
      scrollWindowTo(scrollTargetY(h.top + window.scrollY, h.height, offset, headerH()));
      return target.source === 'find' ? host : null;
    }
    if (target.source === 'top') {
      scrollWindowTo(0);
      return null;
    }
    const el = anchors[target.index];
    if (target.source === 'block') {
      const r = el.getBoundingClientRect();
      scrollWindowTo(scrollTargetY(r.top + window.scrollY, r.height, 0, headerH()));
      return el;
    }
    // Продолжение чтения: тот же вид, что был; начало главы не подсвечиваем
    scrollWindowTo(anchorTargetY(anchors, target, headerH()));
    return target.index === 0 && target.offset === 0 ? null : el;
  };

  // 2. Восстановить место — после того как шрифты догружены, иначе высоты блоков другие
  useEffect(() => {
    if (!res) return;
    let alive = true;
    let unflash = () => {};
    void (async () => {
      let restored = false;
      let saveOnOpen = false;
      try {
        proseRef.current?.getBoundingClientRect(); // раскладка запрашивает нужные начертания шрифтов
        await fontsSettled();
        if (!alive) return;
        const { find, block } = startRoute.current;
        // Место из прогресса — только если оно в этой главе (прогресс за концом книги — с начала последней)
        const p = progressMap.value.get(id);
        const saved = p?.chapter === chapter ? p : undefined;
        const target = restoreTarget({
          keys: res.anchors.map((a) => a.dataset.key ?? ''),
          texts: find ? res.anchors.map(ownText) : undefined,
          find,
          block,
          saved,
        });
        const lit = place(res.anchors, target, find);
        if (lit) unflash = flash(lit);
        // Событие прокрутки от восстановления приходит кадром позже — слушать начинаем после него
        await nextFrame();
        await nextFrame();
        // Сразу пишется только глава, открытая с начала или впервые; переход по ссылке — после прокрутки
        saveOnOpen = !find && !block && (!saved || target.source !== 'saved');
        restored = true;
      } catch (error) {
        // Место не вернулось — глава всё равно показывается, с начала; сохранённое место не трогаем,
        // пока читатель сам не прокрутит
        console.error('Не удалось вернуть место в главе', error);
        try {
          scrollWindowTo(0); // прокрутка от приложения: читателем выбранным местом не считается
        } catch {
          // и прокрутить не вышло — текст всё равно покажем
        }
      } finally {
        if (alive) {
          setSaveOnReady(saveOnOpen);
          setPhase('ready');
          if (restored) {
            cleanAddress(id, chapter);
            // Пришли кнопкой «Дальше» или стрелкой — фокус не теряется, а встаёт на название главы
            if (document.activeElement === document.body || document.activeElement === null) {
              headingRef.current?.focus({ preventScroll: true });
            }
          }
        }
      }
    })();
    return () => {
      alive = false;
      unflash();
    };
  }, [res]);

  // 3. Переход к блоку внутри открытой главы (оглавление, заметки): `?b=`/`?find=` в адресе
  useEffect(() => {
    if (!ready || !res || route === startRoute.current || (!route.find && !route.block)) return;
    const target = restoreTarget({
      keys: res.anchors.map((a) => a.dataset.key ?? ''),
      texts: route.find ? res.anchors.map(ownText) : undefined,
      find: route.find,
      block: route.block,
    });
    let unflash = () => {};
    if (target.source !== 'top') {
      // Заглянул — место, где читал, остаётся записанным; цель перехода пишется, когда прокрутит сам
      tracker.jump();
      const lit = place(res.anchors, target, route.find);
      if (lit) unflash = flash(lit);
    }
    cleanAddress(id, chapter);
    return unflash;
  }, [ready, route]);

  // 4. Конец главы в кадре — глава дочитана; конец последней обязательной — книга прочитана
  useEffect(() => {
    const end = endRef.current;
    if (!ready || !end || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      // Пролистал мимо за один кадр — конец уже выше окна; это тоже «дочитал»
      if (!entries.some((e) => e.isIntersecting || e.boundingClientRect.bottom < 0)) return;
      io.disconnect();
      const b = bookRef.current;
      const now = Date.now();
      const { progress: next, finishedNow } = markChapterDone(progressMap.value.get(id) ?? newProgress(id, now), chapter, b, now);
      saveProgress(next).catch((e) => console.error('Не удалось отметить главу', e));
      if (finishedNow) {
        toast(
          'Книга в «Прочитано»',
          {
            label: 'Отменить',
            run: () => void setFinished(id, false).catch((e) => console.error('Не удалось вернуть книгу', e)),
          },
          UNDO_TOAST_MS,
        );
      }
    });
    io.observe(end);
    return () => io.disconnect();
  }, [ready]);

  const goTo = (to: number) => {
    if (to < 1 || to > count || to === chapter) return;
    tracker.close();
    navigate({ name: 'read', id, chapter: to }, { replace: true });
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // 5. На ПК ←/→ листают главы — но не в полях ввода, таблицах и открытых шторках
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable], .table-wrap, [role="radio"], [role="tab"], [role="slider"]')) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      goToRef.current(chapter + (e.key === 'ArrowLeft' ? -1 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Новая глава — с начала страницы, пока не восстановлено место (`ScrollToTop` следит только за именем экрана)
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const percent = percentOf(book, wordsRead);
  const left = remainingWords(book, wordsRead);
  const pill = left > 0 ? `${percent}% · ещё ${minutesLabel(left, wpm)}` : `${percent}% · дочитано`;
  // Один экран — одна глава; у книги из одной главы над текстом её название
  const heading = count === 1 ? book.title : meta.title;
  const showFinish = chapter >= lastRequiredChapter(book);
  const shown = phase === 'shown' || phase === 'ready';

  return (
    <>
      <ReaderTopBar
        barRef={barRef}
        title={book.title}
        chapter={chapter}
        count={count}
        percent={percent}
        hidden={!chromeVisible}
        onBack={() => backTo({ name: 'book', id })}
        onToc={() => setSheet('toc')}
        onSettings={() => setSheet('settings')}
      />

      <main class="screen rscreen" data-state={phase}>
        {phase === 'missing' && (
          <EmptyState
            title="Глава не найдена"
            text="Похоже, текст этой главы не сохранился. Открой книгу и выбери другую главу."
            action={<Button href={toHash({ name: 'book', id })}>К книге</Button>}
          />
        )}
        {phase === 'error' && (
          <EmptyState
            title="Не удалось открыть главу"
            text="Хранилище не ответило. Попробуй ещё раз."
            action={<Button onClick={() => setAttempt((n) => n + 1)}>Попробовать ещё раз</Button>}
          />
        )}

        <div class="rbody" hidden={phase === 'missing' || phase === 'error'}>
          <article class="rchap" aria-labelledby="rchap-title">
            <header class="rchap__head">
              <h1 id="rchap-title" ref={headingRef} class="rchap__title" tabIndex={-1}>
                {heading}
              </h1>
              <p class="rchap__meta">{minutesLabel(meta.words, wpm)}</p>
            </header>
            <div ref={proseRef} class="prose" lang="ru" />
            <div ref={endRef} class="rchap__end" aria-hidden="true" />
          </article>

          {shown && showFinish && <FinishBlock book={book} progress={progress} />}
          {shown && <ChapterEnd book={book} chapter={chapter} wpm={wpm} onGo={goTo} />}
        </div>
      </main>

      <p class="rpill" data-hidden={chromeVisible && ready ? undefined : ''}>
        {pill}
      </p>

      <TocSlot open={sheet === 'toc'} onClose={() => setSheet(null)} book={book} progress={progress} chapter={chapter} />
      <SettingsSlot open={sheet === 'settings'} onClose={() => setSheet(null)} book={book} progress={progress} chapter={chapter} />
      <BlockActionsSlot bookId={id} chapter={chapter} root={res ? proseRef.current : null} version={version} />
    </>
  );
}
