import type { ComponentChildren } from 'preact';
import type { Settings } from '../../core/types';
import { settings, updateSettings } from '../../state/settings';
import { Segmented, type SegmentedOption } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { wakeLockSupported } from './useWakeLock';
import './ReaderSettingsSheet.css';

export interface ReaderSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

const MIN_SIZE = 15;
const MAX_SIZE = 24;

const FONTS: SegmentedOption<Settings['font']>[] = [
  { value: 'serif', label: 'С засечками' },
  { value: 'sans', label: 'Без засечек' },
];
const LINES: SegmentedOption<Settings['lineHeight']>[] = [
  { value: 'tight', label: 'Плотно' },
  { value: 'normal', label: 'Обычно' },
  { value: 'loose', label: 'Свободно' },
];
const THEMES: SegmentedOption<Settings['theme']>[] = [
  { value: 'auto', label: 'Авто' },
  { value: 'light', label: 'Светлая' },
  { value: 'sepia', label: 'Бумага' },
  { value: 'dark', label: 'Тёмная' },
];

/** Всё применяется сразу (`updateSettings` красит страницу и пишет в базу). Тост здесь не показать: он под шторкой. */
function change(patch: Partial<Settings>): void {
  void updateSettings(patch).catch((e) => console.error('Не удалось сохранить настройки', e));
}

/** «Aa» (spec §8.10): размер, шрифт, интервал, тема, переносы, «Не гасить экран». */
export function ReaderSettingsSheet({ open, onClose }: ReaderSettingsSheetProps) {
  return (
    <Sheet open={open} title="Оформление" onClose={onClose}>
      <SettingsBody />
    </Sheet>
  );
}

function SettingsBody() {
  const s = settings.value;
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, s.fontSize));

  return (
    <div class="rset">
      <div class="rset__row">
        <span class="rset__label">Размер текста</span>
        <div class="rset__stepper">
          <button
            type="button"
            class="rset__step"
            aria-label="Уменьшить текст"
            disabled={size <= MIN_SIZE}
            onClick={() => change({ fontSize: size - 1 })}
          >
            <span class="rset__a rset__a--small" aria-hidden="true">
              A
            </span>
            <span aria-hidden="true">−</span>
          </button>
          <output class="rset__value" aria-live="polite" aria-label={`Размер текста: ${size}`}>
            {size}
          </output>
          <button
            type="button"
            class="rset__step"
            aria-label="Увеличить текст"
            disabled={size >= MAX_SIZE}
            onClick={() => change({ fontSize: size + 1 })}
          >
            <span class="rset__a rset__a--big" aria-hidden="true">
              A
            </span>
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>

      <Field label="Шрифт">
        <Segmented label="Шрифт" options={FONTS} value={s.font} onChange={(font) => change({ font })} />
      </Field>
      <Field label="Интервал между строками">
        <Segmented label="Интервал между строками" options={LINES} value={s.lineHeight} onChange={(lineHeight) => change({ lineHeight })} />
      </Field>
      <Field label="Тема">
        <Segmented label="Тема" options={THEMES} value={s.theme} onChange={(theme) => change({ theme })} />
      </Field>

      <Switch label="Переносы слов" checked={s.hyphens} onChange={(hyphens) => change({ hyphens })} />
      {wakeLockSupported() && (
        <Switch label="Не гасить экран" hint="Пока читаешь, экран не погаснет" checked={s.keepAwake} onChange={(keepAwake) => change({ keepAwake })} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="rset__field">
      <span class="rset__label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Переключатель на всю строку: зона нажатия — строка, а не маленький бегунок. */
function Switch({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} class="rset__switch" onClick={() => onChange(!checked)}>
      <span class="rset__swtext">
        <span class="rset__swlabel">{label}</span>
        {hint && <span class="rset__hint">{hint}</span>}
      </span>
      <span class="rset__track" aria-hidden="true">
        <span class="rset__thumb" />
      </span>
    </button>
  );
}
