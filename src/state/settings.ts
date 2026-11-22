/** Состояние настроек: сигнал, загрузка из БД и применение к странице (тема, шрифт читалки, цвет строки состояния). */
import { signal } from '@preact/signals';
import { DEFAULT_SETTINGS, type Settings } from '../core/types';
import { getSettings, setSettings } from '../db/settings';

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

const LINE_HEIGHT: Record<Settings['lineHeight'], string> = { tight: '1.45', normal: '1.6', loose: '1.75' };
const READ_FONT: Record<Settings['font'], string> = { serif: 'var(--font-book)', sans: 'var(--font-ui)' };
const MIN_SIZE = 15;
const MAX_SIZE = 24;

const hasDom = () => typeof document !== 'undefined';

/** Значение `--paper` на `<html>` сейчас → в `<meta name="theme-color">` (цвет строки состояния и «шапки» PWA). */
function syncThemeColor(): void {
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  if (!paper) return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', paper);
}

let watchingSystem = false;

/** При теме «Авто» цвет следует за системой, пока приложение открыто. */
function watchSystemTheme(): void {
  if (watchingSystem || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  watchingSystem = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.value.theme === 'auto') syncThemeColor();
  });
}

/** Тема, переменные читалки и цвет строки состояния. Без DOM (тесты в Node) ничего не делает. */
export function applySettings(s: Settings): void {
  if (!hasDom()) return;
  const root = document.documentElement;

  if (s.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = s.theme;

  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, s.fontSize));
  root.style.setProperty('--read-size', `${size / 16}rem`);
  root.style.setProperty('--read-line', LINE_HEIGHT[s.lineHeight] ?? LINE_HEIGHT.normal);
  root.style.setProperty('--read-font', READ_FONT[s.font] ?? READ_FONT.serif);
  root.style.setProperty('--read-hyphens', s.hyphens ? 'auto' : 'manual');

  syncThemeColor();
  watchSystemTheme();
}

/** Прочитать настройки из БД и применить. Вызывается один раз до первого показа экранов. */
export async function loadSettings(): Promise<void> {
  const loaded = await getSettings();
  settings.value = loaded;
  applySettings(loaded);
}

/** Изменить настройки: сигнал и страница обновляются сразу, затем запись в БД. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...settings.value, ...patch };
  settings.value = next;
  applySettings(next);
  await setSettings(patch);
}
