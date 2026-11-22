import { computed } from '@preact/signals';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { callNumbers } from '../../core/book';
import { categoryCounts } from '../../core/library';
import { bookStatus, percentOf } from '../../core/progress';
import { formatDate, plural } from '../../core/text';
import { minutesLabel } from '../../core/time';
import type { BookMeta } from '../../core/types';
import { navigate, rememberScroll, restoreScroll, toHash, type Route, type RouteOf } from '../../router';
import {
  DELETE_UNDO_MS,
  books,
  progressMap,
  scheduleDelete,
  setFinished,
  toggleFavorite,
  undoDelete,
} from '../../state/library';
import { settings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/ProgressBar';
import { EXIT_MS } from '../../ui/Sheet';
import { shareOrDownload } from '../../ui/share';
import { toast } from '../../ui/Toast';
import { TopBar } from '../../ui/TopBar';
import { chapterLine, currentChapter, progressLine, readHref } from '../library/shared';
import { BookAction } from './BookAction';
import { BookMenu, DeleteBookSheet, type BookMenuAction } from './BookMenu';
import { ChapterList } from './ChapterList';
import { EditBookSheet } from './EditBookSheet';
import { exportBookMd } from './exportMd';
import './BookScreen.css';

/** Шифры считаются один раз на изменение списка книг (как на полке). */
const callNos = computed(() => callNumbers(books.value));

const shelf = (): Route => ({ name: 'library', params: new URLSearchParams() });

type SheetName = 'menu' | 'edit' | 'delete';

/** Файл `.md` — через «Поделиться» на телефоне или скачиванием. */
async function exportBook(id: string): Promise<void> {
  try {
    const { name, text } = await exportBookMd(id);
    await shareOrDownload(name, new Blob([text], { type: 'text/plain' }));
  } catch (error) {
    console.error('Не удалось выгрузить книгу', error);
    toast('Не удалось выгрузить книгу');
  }
}

/** Части строки «≈ 25 мин · 12 глав · 14 карточек · добавлена 17 нояб.»: внутри части пробелы неразрывные, точка прилипает к левой. */
function metaItems(book: BookMeta, wpm: number): string[] {
  const chapters = book.chapters.length;
  const items = [`≈\u00A0${minutesLabel(book.words, wpm)}`, `${chapters}\u00A0${plural(chapters, 'глава', 'главы', 'глав')}`];
  if (book.cards > 0) items.push(`${book.cards}\u00A0${plural(book.cards, 'карточка', 'карточки', 'карточек')}`);
  // Для перенесённых книг `addedAt` — день переноса, а `createdAt` — когда книгу получили в старом приложении
  items.push(`добавлена\u00A0${formatDate(book.createdAt || book.addedAt).replace(' ', '\u00A0')}`);
  return items.map((item, i) => (i < items.length - 1 ? `${item}\u00A0·` : item));
}

/** Книга: шифр, описание, главная кнопка, главы, теги, «одно действие» (spec §10.2). */
export function BookScreen({ route: current }: { route: RouteOf<'book'> }) {
  const id = current.id;
  const book = books.value.find((b) => b.id === id);
  const progress = progressMap.value.get(id);
  const { wpm } = settings.value;
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Своя прокрутка у каждой книги. Без этого переход из книги в книгу (`ScrollToTop` следит за именем
  // экрана, а оно то же) оставил бы новую страницу там, где закончилась старая.
  useLayoutEffect(() => {
    restoreScroll(`book:${id}`);
    return () => rememberScroll(`book:${id}`);
  }, [id]);

  // Закрылась страница с открытой шторкой — отложенное открытие следующей уже не нужно
  useEffect(() => () => clearTimeout(swapTimer.current), []);

  const categories = useMemo(() => categoryCounts(books.value), [books.value]);

  if (!book) {
    return (
      <>
        <TopBar back={shelf()} backLabel="Назад" />
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

  const status = bookStatus(progress);
  const callNo = callNos.value.get(id) ?? '';
  const percent = progress ? percentOf(book, progress.wordsRead) : 0;

  // Шторки идут по очереди: следующая открывается, когда предыдущая уже ушла, иначе фокус не вернётся на «⋯»
  const swapTo = (next: SheetName) => {
    setSheet(null);
    clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => setSheet(next), EXIT_MS + 60);
  };

  const fail = (what: string) => (error: unknown) => {
    console.error(what, error);
    toast('Не удалось сохранить');
  };

  const pick = (action: BookMenuAction) => {
    switch (action) {
      case 'edit':
      case 'delete':
        swapTo(action);
        return;
      case 'export':
        setSheet(null);
        void exportBook(id);
        return;
      case 'finish':
        setSheet(null);
        setFinished(id, true)
          .then(() => toast('Книга в «Прочитано»'))
          .catch(fail('Не удалось отметить книгу'));
        return;
      case 'unfinish':
        setSheet(null);
        setFinished(id, false)
          .then(() => toast('Книга снова в «Читаю»'))
          .catch(fail('Не удалось вернуть книгу'));
        return;
    }
  };

  // Сначала закрываем шторку: тост под открытой шторкой (модальный <dialog>) не нажать
  const confirmDelete = () => {
    setSheet(null);
    scheduleDelete(id);
    toast('Книга удалена', { label: 'Вернуть', run: () => undoDelete(id) }, DELETE_UNDO_MS);
    navigate(shelf(), { replace: true });
  };

  let goLabel: string;
  let goHref: string;
  if (status === 'reading' && progress) {
    goLabel = `Продолжить · гл.\u00A0${currentChapter(book, progress).n}, ${percent}%`;
    goHref = readHref(book, progress);
  } else {
    // «Читать заново» открывает первую главу; прогресс не сбрасывается, пока читатель не прокрутил
    goLabel = status === 'finished' ? 'Читать заново' : 'Начать читать';
    goHref = toHash({ name: 'read', id, chapter: 1 });
  }

  const meta = metaItems(book, wpm);
  const showAction = status === 'finished' || book.action !== undefined;

  return (
    <>
      <TopBar
        back={shelf()}
        backLabel="Назад"
        actions={
          <>
            <Button
              variant="plain"
              icon="star"
              aria-label="Избранное"
              aria-pressed={book.favorite}
              onClick={() => void toggleFavorite(id).catch(fail('Не удалось изменить избранное'))}
            />
            <Button variant="plain" icon="more" aria-label="Действия с книгой" onClick={() => setSheet('menu')} />
          </>
        }
      />

      <main class="screen book">
        <header class="bhead">
          <div class="bhead__top">
            <span class="bhead__callno">{callNo}</span>
            <span class="bhead__cat">{book.category}</span>
          </div>
          <h1 class="bhead__title">{book.title}</h1>
          {book.summary && <p class="bhead__sum">{book.summary}</p>}
          <p class="bhead__meta">
            {meta.map((item, i) => (
              <Fragment key={item}>
                <span>{item}</span>
                {i < meta.length - 1 ? ' ' : ''}
              </Fragment>
            ))}
          </p>

          <div class="bhead__go">
            <Button variant="primary" wide href={goHref}>
              {goLabel}
            </Button>
            {status === 'reading' && progress && (
              <div class="bhead__progress">
                <p class="bhead__where">{chapterLine(book, progress)}</p>
                <ProgressBar value={percent} label={`Прочитано: ${book.title}`} />
                <p class="bhead__left">{progressLine(book, progress, wpm)}</p>
              </div>
            )}
          </div>
        </header>

        {showAction && (
          <BookAction
            bookId={id}
            action={book.action}
            finishedAt={status === 'finished' && progress ? (progress.finishedAt ?? progress.lastReadAt) : undefined}
          />
        )}

        <section class="bsec" aria-labelledby="chapters-title">
          <h2 id="chapters-title" class="bsec__label">
            Главы <span class="bsec__count">{book.chapters.length}</span>
          </h2>
          <div class="bsec__card">
            <ChapterList book={book} progress={progress} onOpen={(chapter) => navigate({ name: 'read', id, chapter })} />
          </div>
        </section>

        {book.tags.length > 0 && (
          <section class="bsec" aria-labelledby="tags-title">
            <h2 id="tags-title" class="bsec__label">
              Теги
            </h2>
            <ul class="btags">
              {book.tags.map((tag) => (
                <li key={tag}>
                  <Chip onClick={() => navigate({ name: 'search', q: tag })}>{tag}</Chip>
                </li>
              ))}
            </ul>
          </section>
        )}

        {book.source && (
          <p class="bsource">
            <Icon name="book" size={14} />
            <span>Источник: {book.source}</span>
          </p>
        )}
      </main>

      <BookMenu open={sheet === 'menu'} finished={status === 'finished'} onPick={pick} onClose={() => setSheet(null)} />
      <EditBookSheet open={sheet === 'edit'} book={book} categories={categories} onClose={() => setSheet(null)} />
      <DeleteBookSheet open={sheet === 'delete'} book={book} onConfirm={confirmDelete} onClose={() => setSheet(null)} />
    </>
  );
}
