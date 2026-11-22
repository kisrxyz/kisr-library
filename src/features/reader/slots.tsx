/**
 * Места для шторок и панели блока читалки. Их наполняет задача 9 (оглавление, «Aa», отметки и заметки);
 * пока это пустые компоненты с готовыми свойствами, и `ReaderScreen` уже рендерит все три.
 */
import type { BookMeta, Progress } from '../../core/types';

export interface SheetSlotProps {
  open: boolean;
  onClose: () => void;
  book: BookMeta;
  progress?: Progress;
  /** Открытая глава (с 1). */
  chapter: number;
}

export interface BlockActionsSlotProps {
  bookId: string;
  chapter: number;
  /** `<div class="prose">` с текстом главы; `null`, пока глава не отрисована. */
  root: HTMLElement | null;
  /** Растёт после каждой отрисовки главы: пора заново покрасить отметки и повесить обработчики. */
  version: number;
}

/** Оглавление (шторка): главы и отметки книги. */
export function TocSlot(_props: SheetSlotProps) {
  return null;
}

/** «Aa» (шторка): размер, шрифт, интервал, тема, переносы, «Не гасить экран». */
export function SettingsSlot(_props: SheetSlotProps) {
  return null;
}

/** Нажатие на абзац: «Отметить», «Заметка», «Копировать». */
export function BlockActionsSlot(_props: BlockActionsSlotProps) {
  return null;
}
