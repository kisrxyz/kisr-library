// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types';
import { getSettings } from '../db/settings';
import { freshDb } from '../db/testing';
import { loadSettings, settings, updateSettings } from './settings';

const root = document.documentElement;
const themeMetas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));

beforeEach(() => {
  freshDb();
  settings.value = { ...DEFAULT_SETTINGS };
  root.removeAttribute('data-theme');
  root.removeAttribute('style');
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#000001" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000002" />
    <style>
      :root { --paper: #F2F4F1; }
      :root[data-theme="dark"] { --paper: #0E1412; }
      :root[data-theme="sepia"] { --paper: #F1E7D3; }
    </style>`;
});

describe('loadSettings', () => {
  it('без записей — значения по умолчанию, тема «авто» без атрибута', async () => {
    await loadSettings();
    expect(settings.value).toEqual(DEFAULT_SETTINGS);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('применяет сохранённые настройки к странице', async () => {
    await updateSettings({ theme: 'sepia', fontSize: 21 });
    settings.value = { ...DEFAULT_SETTINGS };
    root.removeAttribute('data-theme');
    root.removeAttribute('style');

    await loadSettings();

    expect(settings.value.theme).toBe('sepia');
    expect(root.dataset.theme).toBe('sepia');
    expect(root.style.getPropertyValue('--read-size')).toBe('1.3125rem');
  });
});

describe('updateSettings', () => {
  it('пишет в БД и обновляет сигнал', async () => {
    await updateSettings({ wpm: 240, hyphens: false });
    expect(settings.value.wpm).toBe(240);
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, wpm: 240, hyphens: false });
  });

  it('явная тема ставит data-theme, «авто» снимает атрибут', async () => {
    await updateSettings({ theme: 'dark' });
    expect(root.dataset.theme).toBe('dark');
    await updateSettings({ theme: 'light' });
    expect(root.dataset.theme).toBe('light');
    await updateSettings({ theme: 'auto' });
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('ставит переменные читалки', async () => {
    await updateSettings({ fontSize: 18, lineHeight: 'tight', font: 'sans', hyphens: false });
    expect(root.style.getPropertyValue('--read-size')).toBe('1.125rem');
    expect(root.style.getPropertyValue('--read-line')).toBe('1.45');
    expect(root.style.getPropertyValue('--read-font')).toBe('var(--font-ui)');
    expect(root.style.getPropertyValue('--read-hyphens')).toBe('manual');

    await updateSettings({ fontSize: 15, lineHeight: 'loose', font: 'serif', hyphens: true });
    expect(root.style.getPropertyValue('--read-size')).toBe('0.9375rem');
    expect(root.style.getPropertyValue('--read-line')).toBe('1.75');
    expect(root.style.getPropertyValue('--read-font')).toBe('var(--font-book)');
    expect(root.style.getPropertyValue('--read-hyphens')).toBe('auto');
  });

  it('размер вне диапазона 15–24 приводится к границе', async () => {
    await updateSettings({ fontSize: 40 });
    expect(root.style.getPropertyValue('--read-size')).toBe('1.5rem');
    await updateSettings({ fontSize: 3 });
    expect(root.style.getPropertyValue('--read-size')).toBe('0.9375rem');
  });

  it('theme-color следует за --paper выбранной темы', async () => {
    await updateSettings({ theme: 'dark' });
    expect(themeMetas()).toEqual(['#0E1412', '#0E1412']);
    await updateSettings({ theme: 'sepia' });
    expect(themeMetas()).toEqual(['#F1E7D3', '#F1E7D3']);
    await updateSettings({ theme: 'auto' });
    expect(themeMetas()).toEqual(['#F2F4F1', '#F2F4F1']);
  });
});
