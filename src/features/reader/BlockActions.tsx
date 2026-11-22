/**
 * Отметки и заметки к абзацам (spec §8.8). Нажатие на блок выделяет его (`.sel`) и вызывает нижнюю панель
 * «Отметить / Заметка / Копировать / ✕». Нажатие мимо, прокрутка, Esc и ✕ закрывают её.
 * Текст остаётся выделяемым системно: ни `user-select`, ни `preventDefault` на касаниях здесь нет.
 * Отметки читаются из базы при открытии главы и красятся при каждой её отрисовке (`version`).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Mark } from '../../core/types';
import { getMarks } from '../../db/marks';
import { ownText } from '../../markdown/enhance';
import { Icon } from '../../ui/Icon';
import { EXIT_MS } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { paintMarks, saveNote, toggleHighlight } from './marks';
import { NoteSheet } from './NoteSheet';
import './BlockActions.css';

export interface BlockActionsProps {
  bookId: string;
  /** Открытая глава (с 1). */
  chapter: number;
  /** `<div class="prose">` с текстом главы; `null`, пока глава не отрисована. */
  root: HTMLElement | null;
  /** Растёт после каждой отрисовки главы: пора заново покрасить отметки. */
  version: number;
}

/** По этим элементам нажатие работает само, абзац под ними не выделяется. */
const OWN_TAP = 'a, input, label, button, select, textarea, summary, [role="button"], .deck, .table-wrap';
/** Прокрутка дальше этого закрывает панель: касание, сдвинувшее страницу на пару пикселей, не в счёт. */
const SCROLL_CLOSE_PX = 8;

/** Блок с `data-key` под пальцем, если на него вообще можно нажимать. */
function blockAt(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || !root.contains(target) || target.closest(OWN_TAP)) return null;
  const block = target.closest<HTMLElement>('[data-key]');
  return block && root.contains(block) ? block : null;
}

/** Идёт выделение текста (долгое нажатие или мышь): это не выбор абзаца. */
function selectingText(): boolean {
  const s = typeof getSelection === 'function' ? getSelection() : null;
  return !!s && !s.isCollapsed && s.toString().trim() !== '';
}

export function BlockActions({ bookId, chapter, root, version }: BlockActionsProps) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [sel, setSel] = useState<HTMLElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  /** Абзац заметки не сбрасывается вместе с `sel`: шторка ещё уезжает и показывает его цитату. */
  const [noteEl, setNoteEl] = useState<HTMLElement | null>(null);
  const noteOpenRef = useRef(false);
  noteOpenRef.current = noteOpen;
  /** Где была страница при последнем нажатии: «прокрутка» считается от этого места, а не от того, что слушатель увидел позже. */
  const tapY = useRef(0);
  /** Записи идут по очереди: два быстрых нажатия не затрут друг друга. */
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Отметки книги — один раз на открытие главы
  useEffect(() => {
    let alive = true;
    getMarks(bookId)
      .then((all) => alive && setMarks(all))
      .catch((e) => console.error('Не удалось прочитать отметки', e));
    return () => {
      alive = false;
    };
  }, [bookId]);

  // Красим до показа главы: текст скрыт, пока место не восстановлено
  useLayoutEffect(() => {
    if (root) paintMarks(root, marks);
  }, [root, version, marks]);

  // Глава отрисована заново — прежний блок уже не в документе
  useEffect(() => setSel(null), [root, version]);

  useEffect(() => {
    sel?.classList.add('sel');
    return () => sel?.classList.remove('sel');
  }, [sel]);

  /*
    Нажатие на блок выделяет его — слушатель на самом `root`, а не на `document`. iOS Safari не создаёт `click`
    для неинтерактивного элемента (`<p>`, `<li>`), если единственный слушатель висит на `document` или `body`;
    слушатель на предке ниже `body` делает нажимаемыми и потомков.
  */
  useEffect(() => {
    if (!root) return;
    const onTap = (e: MouseEvent) => {
      if (noteOpenRef.current) return;
      tapY.current = window.scrollY;
      const block = blockAt(root, e.target);
      if (block && selectingText()) return;
      setSel((now) => (block && block !== now ? block : null));
    };
    root.addEventListener('click', onTap);
    return () => root.removeEventListener('click', onTap);
  }, [root]);

  /*
    Нажатие вне главы (поля экрана, конец главы, пустое место) снимает выделение. Слушатель — на области экрана
    (`<main>`), по той же причине: на пустом месте под `document` iOS нажатия не отдаёт. `document` — запасной:
    его хватает на ПК и на нажатиях по интерактивным элементам вне `main`. Нажатия внутри `root` обрабатывает
    слушатель выше; панель и шторка заметки не в счёт.
  */
  useEffect(() => {
    if (!root) return;
    const area = root.closest('main') ?? root.parentElement;
    const onAway = (e: MouseEvent) => {
      if (noteOpenRef.current) return;
      if (e.target instanceof Element && (root.contains(e.target) || e.target.closest('.bact'))) return;
      tapY.current = window.scrollY;
      setSel(null);
    };
    area?.addEventListener('click', onAway);
    document.addEventListener('click', onAway);
    return () => {
      area?.removeEventListener('click', onAway);
      document.removeEventListener('click', onAway);
    };
  }, [root]);

  // Прокрутка и Esc закрывают панель
  useEffect(() => {
    if (!sel) return;
    const onScroll = () => {
      if (!noteOpenRef.current && Math.abs(window.scrollY - tapY.current) > SCROLL_CLOSE_PX) setSel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !noteOpenRef.current) setSel(null);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [sel]);

  const markOf = (el: HTMLElement | null) => (el?.dataset.key ? marks.find((m) => m.blockKey === el.dataset.key) : undefined);

  /** Записать и перекрасить; `done` — после удачной записи. Ошибка базы — тост; вызывать только вне открытой шторки. */
  const write = (el: HTMLElement, job: () => Promise<Mark | null>, done?: () => void) => {
    const key = el.dataset.key;
    queue.current = queue.current
      .then(job)
      .then((m) => {
        setMarks((prev) => [...prev.filter((x) => x.blockKey !== key), ...(m ? [m] : [])]);
        done?.();
      })
      .catch((e) => {
        console.error('Не удалось сохранить отметку', e);
        toast('Не удалось сохранить');
      });
  };

  const onMark = () => {
    if (sel) write(sel, () => toggleHighlight(bookId, chapter, sel, Date.now()));
  };

  const onCopy = () => {
    if (!sel) return;
    const text = ownText(sel);
    setSel(null);
    // Нет API буфера (старый браузер, страница не по https): не падаем, а говорим
    if (!navigator.clipboard?.writeText) {
      toast('Не получилось скопировать');
      return;
    }
    // Запрос к буферу — сразу в обработчике нажатия: iOS другой не пускает
    navigator.clipboard.writeText(text).then(
      () => toast('Скопировано'),
      () => toast('Не удалось скопировать'),
    );
  };

  const onNote = () => {
    if (!sel) return;
    setNoteEl(sel);
    setNoteOpen(true);
  };

  /** Шторка закрыта: выбор абзаца заканчивается вместе с ней. */
  const closeNote = () => {
    setNoteOpen(false);
    setSel(null);
  };

  /** Закрыть шторку и записать заметку. `told` — тост, когда запись удалась и шторка уже уехала (под ней его не видно). */
  const submitNote = (note: string, told?: string) => {
    const el = noteEl;
    closeNote();
    if (!el) return;
    const sheetGone = new Promise((r) => setTimeout(r, EXIT_MS));
    write(el, () => saveNote(bookId, chapter, el, note, Date.now()), told ? () => void sheetGone.then(() => toast(told)) : undefined);
  };

  const removeNote = () => submitNote('', 'Заметка удалена');

  const mark = markOf(sel);
  const noteMark = markOf(noteEl);

  return (
    <>
      {sel && (
        <div class="bact" role="toolbar" aria-label="Действия с абзацем">
          <button type="button" class="bact__btn" aria-pressed={mark?.highlight === true} onClick={onMark}>
            <Bookmark />
            <span>Отметить</span>
          </button>
          <button type="button" class="bact__btn" data-on={mark !== undefined && mark.note.trim() !== '' ? '' : undefined} onClick={onNote}>
            <Icon name="note" size={22} />
            <span>Заметка</span>
          </button>
          <button type="button" class="bact__btn" onClick={onCopy}>
            <Icon name="copy" size={22} />
            <span>Копировать</span>
          </button>
          <button type="button" class="bact__close" aria-label="Закрыть" onClick={() => setSel(null)}>
            <Icon name="close" size={22} />
          </button>
        </div>
      )}
      <NoteSheet
        open={noteOpen}
        quote={noteEl ? ownText(noteEl) : ''}
        mark={noteMark}
        onSave={(note, dismissed) => submitNote(note, dismissed ? 'Заметка сохранена' : undefined)}
        onDelete={removeNote}
        onClose={closeNote}
      />
    </>
  );
}

/** Закладка: набор иконок приложения такой не содержит. Рисуется так же, как `Icon`: штрих 1.9, закруглённые концы. */
function Bookmark() {
  return (
    <svg
      class="bact__mark"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4.5h10v15.2l-5-3.7-5 3.7z" />
    </svg>
  );
}
