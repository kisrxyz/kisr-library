/** Подписи и значения экрана «Ещё»: чистые функции, чтобы их можно было проверить без экрана. */
import { formatDate, pad2 } from '../../core/text';
import type { Settings } from '../../core/types';
import type { SegmentedOption } from '../../ui/Segmented';

const NBSP = '\u00A0';
const UNITS = ['Б', 'КБ', 'МБ', 'ГБ'] as const;
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «3,2 МБ»: одна цифра после запятой, неразрывный пробел перед единицей. */
export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  // 1023,96 КБ при округлении стало бы «1024 КБ»: такое пишем уже мегабайтами
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1024) {
    value /= 1024;
    unit++;
  }
  return `${number.format(value)}${NBSP}${UNITS[unit]}`;
}

/** `kisr-library-backup-2026-11-17.json` — по местной дате. */
export function backupFileName(date: Date): string {
  return `kisr-library-backup-${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}.json`;
}

/**
 * Время копии из файла. В чужом или правленом файле его может не быть, или оно может быть мусором или
 * из будущего: тогда `lastBackupAt` стал бы `NaN`/далёким будущим, и напоминание о копии замолчало бы.
 * В таких случаях берётся «сейчас».
 */
export function backupStamp(exportedAt: unknown, now: number = Date.now()): number {
  return typeof exportedAt === 'number' && Number.isFinite(exportedAt) && exportedAt <= now ? exportedAt : now;
}

/** «Последняя копия: 17 нояб.» или «Копий ещё не было». */
export function lastBackupLine(lastBackupAt: number | null): string {
  return lastBackupAt === null ? 'Копий ещё не было' : `Последняя копия: ${formatDate(lastBackupAt)}`;
}

const FONT_NAMES: Record<Settings['font'], string> = { serif: 'Literata', sans: 'Golos Text' };
const THEME_NAMES: Record<Settings['theme'], string> = { auto: 'Авто', light: 'Светлая', sepia: 'Бумага', dark: 'Тёмная' };

/** Коротко о текущем оформлении: «Literata · 18 · Авто». Размер — тот же, что реально применяется (15–24). */
export function appearanceSummary(s: Settings): string {
  const size = Math.min(24, Math.max(15, s.fontSize));
  return `${FONT_NAMES[s.font] ?? FONT_NAMES.serif} · ${size} · ${THEME_NAMES[s.theme] ?? THEME_NAMES.auto}`;
}

const SPEEDS = [150, 180, 220, 260] as const;

/** Скорость чтения, слов в минуту. Значение вне набора (из восстановленных настроек) тоже показывается и выбрано. */
export function speedOptions(current: number): SegmentedOption<number>[] {
  const values: number[] = [...SPEEDS];
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b).map((value) => ({ value, label: String(value) }));
}
