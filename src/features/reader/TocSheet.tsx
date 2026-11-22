import { useEffect, useRef, useState } from 'preact/hooks';
import type { BookMeta, Mark, Progress } from '../../core/types';
import { getMarks } from '../../db/marks';
import { navigate } from '../../router';
import { ChapterList } from '../book/ChapterList';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import './TocSheet.css';

export interface TocSheetProps {
  open: boolean;
  onClose: () => void;
  book: BookMeta;
  progress?: Progress;
  /** Открытая глава (с 1). */
  chapter: number;
}

type Tab = 'chapters' | 'marks';

/** Оглавление (spec §8.9): вкладки «Главы» и «Отметки» этой книги. Переход заменяет запись истории, как «Дальше» в читалке. */
export function TocSheet({ open, onClose, book, progress, chapter }: TocSheetProps) {
  return (
    <Sheet open={open} title="Оглавление" onClose={onClose}>
      <TocBody book={book} progress={progress} chapter={chapter} onClose={onClose} />
    </Sheet>
  );
}

/** Своё состояние у содержимого: шторка убирает его с экрана при закрытии, и каждое открытие начинается с «Глав». */
function TocBody({ book, progress, chapter, onClose }: Omit<TocSheetProps, 'open'>) {
  const [tab, setTab] = useState<Tab>('chapters');
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Отметки читаются при каждом открытии: их могли поменять в этой же главе
  useEffect(() => {
    let alive = true;
    getMarks(book.id)
      .then((all) => alive && setMarks(all))
      .catch((e) => {
        console.error('Не удалось прочитать отметки', e);
        if (alive) setMarks([]);
      });
    return () => {
      alive = false;
    };
  }, [book.id]);

  // Длинная книга: текущая глава встаёт в середину списка. Прокручиваем сам список, а не страницу
  useEffect(() => {
    if (tab !== 'chapters') return;
    const scroller = bodyRef.current?.closest<HTMLElement>('.sheet__body');
    const here = bodyRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!scroller || !here) return;
    const box = scroller.getBoundingClientRect();
    const row = here.getBoundingClientRect();
    scroller.scrollTop += row.top - box.top - (box.height - row.height) / 2;
  }, [tab]);

  const open = (to: number, block?: string) => {
    onClose();
    navigate({ name: 'read', id: book.id, chapter: to, block }, { replace: true });
  };

  const sorted = marks ? [...marks].sort((a, b) => a.chapter - b.chapter || a.createdAt - b.createdAt) : [];

  return (
    <div ref={bodyRef} class="toc">
      <div class="toc__tabs">
        <Segmented<Tab>
          label="Раздел оглавления"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'chapters', label: 'Главы' },
            { value: 'marks', label: 'Отметки', count: sorted.length || undefined },
          ]}
        />
      </div>

      {tab === 'chapters' && <ChapterList book={book} progress={progress} current={chapter} onOpen={(n) => open(n)} />}

      {tab === 'marks' && marks && sorted.length === 0 && (
        <p class="toc__empty">Отметок пока нет. Нажми на абзац, чтобы отметить его</p>
      )}
      {tab === 'marks' && sorted.length > 0 && (
        <ul class="tmarks">
          {sorted.map((m) => (
            <li key={m.id}>
              <button type="button" class="tmarks__row" onClick={() => open(m.chapter, m.blockKey)}>
                <span class="tmarks__text">«{m.text}»</span>
                {m.note.trim() !== '' && <span class="tmarks__note">{m.note}</span>}
                <span class="tmarks__where">{chapterLabel(book, m.chapter)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Глава 2 · Вторая». Если книгу обновили и главы уже нет — только номер. */
function chapterLabel(book: BookMeta, n: number): string {
  const title = book.chapters[n - 1]?.title;
  return title ? `Глава ${n} · ${title}` : `Глава ${n}`;
}
