// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types';
import { getSettings } from '../db/settings';
import { freshDb } from '../db/testing';
import { THEME_STORAGE_KEY, loadSettings, settings, updateSettings } from './settings';

const root = document.documentElement;
const themeMetas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));

beforeEach(() => {
  localStorage.clear();
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

describe('тема в localStorage (index.html красит страницу ею до первой отрисовки)', () => {
  it('updateSettings зеркалит тему под ключом kisr-theme', async () => {
    expect(THEME_STORAGE_KEY).toBe('kisr-theme');
    await updateSettings({ theme: 'dark' });
    expect(localStorage.getItem('kisr-theme')).toBe('dark');
    await updateSettings({ theme: 'sepia' });
    expect(localStorage.getItem('kisr-theme')).toBe('sepia');
    await updateSettings({ theme: 'auto' });
    expect(localStorage.getItem('kisr-theme')).toBe('auto');
  });

  it('loadSettings выравнивает зеркало по базе', async () => {
    await updateSettings({ theme: 'light' });
    localStorage.setItem('kisr-theme', 'dark'); // зеркало разошлось с базой
    await loadSettings();
    expect(localStorage.getItem('kisr-theme')).toBe('light');
  });

  it('другие настройки зеркало не трогают, а недоступный localStorage не ломает запись', async () => {
    await updateSettings({ theme: 'dark' });
    await updateSettings({ wpm: 220 });
    expect(localStorage.getItem('kisr-theme')).toBe('dark');

    const broken = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      await expect(updateSettings({ theme: 'sepia' })).resolves.toBeUndefined();
      expect(settings.value.theme).toBe('sepia');
      expect((await getSettings()).theme).toBe('sepia');
    } finally {
      broken.mockRestore();
    }
  });
});

describe('скрипт в index.html (тема до первой отрисовки)', () => {
  const inline = readFileSync(resolve('index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const run = () => new Function(inline)();

  it('есть и читает тот же ключ, что и state/settings', () => {
    expect(inline).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it.each(['light', 'dark', 'sepia'])('ставит data-theme="%s" из localStorage', (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    run();
    expect(root.dataset.theme).toBe(theme);
  });

  it('«авто», пустое и чужое значение ничего не ставят', () => {
    run();
    expect(root.hasAttribute('data-theme')).toBe(false);
    for (const value of ['auto', 'neon', '']) {
      localStorage.setItem(THEME_STORAGE_KEY, value);
      run();
      expect(root.hasAttribute('data-theme')).toBe(false);
    }
  });

  it('недоступный localStorage не роняет страницу', () => {
    const broken = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(run).not.toThrow();
      expect(root.hasAttribute('data-theme')).toBe(false);
    } finally {
      broken.mockRestore();
    }
  });
});
