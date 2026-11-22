/**
 * Позиция «где остановился» (spec §8.4) — чистая арифметика без DOM: какой блок стоит у линии чтения,
 * куда прокрутить, чтобы он вернулся на то же место, сколько слов прочитано и что записать в прогресс.
 * Позиция — это ключ блока и доля его высоты над линией, а не пиксели: после смены шрифта или поворота
 * экрана тот же абзац встаёт на то же место.
 */
import { chapterStartWords, percentOf } from '../../core/progress';
import { normalizeForSearch } from '../../core/text';
import type { BookMeta, Progress } from '../../core/types';
import type { EnhanceResult } from '../../markdown/enhance';

/** Верх и высота блока в координатах окна. */
export interface Rect {
  top: number;
  height: number;
}

/** Блок у линии чтения и доля его высоты, уже ушедшая выше линии (0..1). */
export interface Anchor {
  index: number;
  offset: number;
}

/** Зазор между нижним краем панели и линией чтения. */
export const LINE_GAP = 8;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Якорь — первый блок, чей низ ниже линии `lineY`; доля = (lineY − верх) / высота, в пределах 0..1.
 * Все блоки выше линии — последний с долей 1. Блоков нет — `{index: 0, offset: 0}`.
 */
export function findAnchor(rects: Rect[], lineY: number): Anchor {
  if (rects.length === 0) return { index: 0, offset: 0 };
  for (let i = 0; i < rects.length; i++) {
    const { top, height } = rects[i];
    if (top + height > lineY) return { index: i, offset: height > 0 ? clamp01((lineY - top) / height) : 0 };
  }
  return { index: rects.length - 1, offset: 1 };
}

/** Прокрутка, при которой точка «верх блока + доля высоты» встаёт на линию чтения под панелью высотой `headerH`. */
export function scrollTargetY(absTop: number, height: number, offset: number, headerH: number): number {
  return Math.max(0, absTop + offset * height - headerH - LINE_GAP);
}

/** Промежуток между блоками не больше этого — просто отступ (абзац, заголовок ###), а не таблица или колода. */
export const MARGIN_GAP = 48;

/**
 * Прокрутка, возвращающая якорь на линию чтения (`rects` — в координатах документа).
 * Доля 0 значит, что линия стояла над блоком. Если между ним и предыдущим блоком что-то без ключа
 * (таблица, колода карточек, линия), на линию встаёт низ предыдущего блока — и всё между ними остаётся
 * на виду; но не больше `maxGap`, иначе сам блок ушёл бы за экран. Если между ними только отступ —
 * на линию встаёт сам блок. Первый блок с долей 0 — начало главы.
 */
export function anchorScrollY(rects: Rect[], index: number, offset: number, headerH: number, maxGap = Infinity): number {
  const rect = rects[index];
  if (!rect) return 0;
  if (offset > 0) return scrollTargetY(rect.top, rect.height, offset, headerH);
  // Предыдущий блок, который кончается выше этого (пункт-родитель вложенного списка его накрывает)
  for (let i = index - 1; i >= 0; i--) {
    const prev = rects[i];
    const bottom = prev.top + prev.height;
    if (bottom > rect.top) continue;
    const gap = rect.top - bottom;
    return gap <= MARGIN_GAP || gap > maxGap
      ? scrollTargetY(rect.top, rect.height, 0, headerH)
      : scrollTargetY(prev.top, prev.height, 1, headerH);
  }
  return 0;
}

/** Собственные слова блоков главы до точки «блок `index`, доля `offset`». */
export function wordsAt(res: Pick<EnhanceResult, 'wordsBefore' | 'words'>, index: number, offset: number): number {
  return (res.wordsBefore[index] ?? 0) + Math.round(offset * (res.words[index] ?? 0));
}

/**
 * Слова главы до точки. Блоки считают только свой текст (без таблиц, кода, заголовков ##), поэтому их
 * сумма меньше слов главы — доля переводится в слова главы. Конец последнего блока — вся глава.
 */
export function chapterWordsAt(
  res: Pick<EnhanceResult, 'wordsBefore' | 'words'>,
  index: number,
  offset: number,
  chapterWords: number,
): number {
  const total = res.words.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return 0;
  return Math.min(chapterWords, Math.round((wordsAt(res, index, offset) / total) * chapterWords));
}

/** Сохранённая позиция главы — поля из `Progress`. */
export type SavedPosition = Pick<Progress, 'blockKey' | 'blockIndex' | 'blockOffset'>;

/** Откуда взялась точка: поиск, ключ из адреса, сохранённое место главы или начало главы. */
export type TargetSource = 'find' | 'block' | 'saved' | 'top';

/**
 * Куда встать при открытии главы: `?find=` (первый блок с запросом) → `?b=` (блок по ключу) →
 * сохранённое место этой главы (по ключу, если его нет — по индексу) → начало главы.
 * `?b=`, совпавший с сохранённым ключом («Продолжить»), берёт и сохранённую долю.
 */
export function restoreTarget(input: {
  keys: readonly string[];
  /** Собственный текст блоков — нужен только для `find`. */
  texts?: readonly string[];
  find?: string;
  block?: string;
  /** Позиция из прогресса, только если она относится к этой главе. */
  saved?: SavedPosition;
}): Anchor & { source: TargetSource } {
  const { keys, texts, find, block, saved } = input;
  const top = { index: 0, offset: 0, source: 'top' as const };
  if (keys.length === 0) return top;

  const query = find ? normalizeForSearch(find) : '';
  if (query && texts) {
    const index = texts.findIndex((t) => normalizeForSearch(t).includes(query));
    if (index >= 0) return { index, offset: 0, source: 'find' };
  }

  if (block) {
    const index = keys.indexOf(block);
    if (index >= 0) {
      return saved?.blockKey === block
        ? { index, offset: clamp01(saved.blockOffset), source: 'saved' }
        : { index, offset: 0, source: 'block' };
    }
  }

  if (saved) {
    let index = saved.blockKey ? keys.indexOf(saved.blockKey) : -1;
    if (index < 0) {
      const i = Number.isFinite(saved.blockIndex) ? Math.trunc(saved.blockIndex) : 0;
      index = Math.min(Math.max(0, i), keys.length - 1);
    }
    return { index, offset: clamp01(saved.blockOffset), source: 'saved' };
  }

  return top;
}

/** Сколько символов абзаца запоминается для карточки «Продолжить». */
export const SNIPPET_LENGTH = 140;

/**
 * Прогресс после чтения до точки: позиция, слова и процент, самая дальняя глава, время.
 * Статус, дата завершения и дочитанные главы не трогаются: прочитанная книга остаётся прочитанной.
 */
export function progressAt(
  p: Progress,
  input: {
    meta: BookMeta;
    chapter: number;
    index: number;
    offset: number;
    /** `data-key` блока у линии; `null`, если в главе нет блоков. */
    key: string | null;
    /** Собственный текст этого блока. */
    text: string;
    /** Слова главы до точки (`chapterWordsAt`). */
    inChapter: number;
    now: number;
    /** Активное время чтения с прошлой записи. */
    addMs: number;
  },
): Progress {
  const { meta, chapter, now } = input;
  const start = chapterStartWords(meta, chapter);
  const wordsRead = Math.min(meta.words, start + Math.max(0, input.inChapter));
  const next: Progress = {
    ...p,
    chapter,
    blockKey: input.key,
    blockIndex: input.index,
    blockOffset: clamp01(input.offset),
    maxChapter: Math.max(p.maxChapter, chapter),
    wordsRead,
    percent: p.status === 'finished' ? 100 : percentOf(meta, wordsRead),
    lastReadAt: now,
    readingMs: p.readingMs + Math.max(0, Math.round(input.addMs)),
  };
  const snippet = Array.from(input.text.trim()).slice(0, SNIPPET_LENGTH).join('').trim();
  if (input.key && snippet) next.snippet = snippet;
  else delete next.snippet;
  return next;
}
