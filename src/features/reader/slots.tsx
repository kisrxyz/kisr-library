/**
 * Места для шторок и панели блока читалки: `ReaderScreen` рендерит все три и о начинке не знает.
 * Содержимое — в `TocSheet`, `ReaderSettingsSheet` и `BlockActions` (оглавление, «Aa», отметки и заметки).
 */
import type { BookMeta, Progress } from '../../core/types';
import { settings } from '../../state/settings';
import { BlockActions } from './BlockActions';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';
import { TocSheet } from './TocSheet';
import { useWakeLock } from './useWakeLock';

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
export function TocSlot(props: SheetSlotProps) {
  return <TocSheet {...props} />;
}

/**
 * «Aa» (шторка): размер, шрифт, интервал, тема, переносы, «Не гасить экран».
 * Слот живёт, пока открыта читалка, — поэтому экран держится и при закрытой шторке.
 */
export function SettingsSlot({ open, onClose }: SheetSlotProps) {
  useWakeLock(settings.value.keepAwake);
  return <ReaderSettingsSheet open={open} onClose={onClose} />;
}

/** Нажатие на абзац: «Отметить», «Заметка», «Копировать». */
export function BlockActionsSlot(props: BlockActionsSlotProps) {
  return <BlockActions {...props} />;
}
