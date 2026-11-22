// @vitest-environment jsdom
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { DEFAULT_SETTINGS } from './core/types';
import { brokenDb, freshDb, sampleBook } from './db/testing';
import { __resetLibraryForTests, saveImportedBook, startLibrary } from './state/library';
import { settings } from './state/settings';

// Service worker в тестах не нужен (и `virtual:pwa-register` есть только в сборке)
vi.mock('./pwa', () => ({ needUpdate: signal(false), updateApp: vi.fn() }));

let host: HTMLElement;

beforeEach(() => {
  freshDb();
  __resetLibraryForTests();
  settings.value = { ...DEFAULT_SETTINGS };
  location.hash = '#/';
  window.scrollTo = vi.fn(); // jsdom не умеет прокручивать
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  __resetLibraryForTests();
});

const mount = () => act(() => render(<App />, host));
const heading = () => host.querySelector('h2')?.textContent;

describe('App: запуск и хранилище', () => {
  it('база не открылась — экран «Не удалось открыть хранилище», а не пустая полка', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    brokenDb();
    await startLibrary();
    mount();

    expect(heading()).toBe('Не удалось открыть хранилище');
    expect(host.textContent).toContain(
      'Книги на месте — не удаляй приложение. Закрой его и открой снова; если не поможет, перезагрузи телефон.',
    );
    expect(host.textContent).not.toContain('Полка пока пустая');
    expect(host.querySelector('.tabbar')).toBeNull();
    // `location.reload()` в jsdom не подменить (свойство неизменяемое): проверяем, что кнопка есть
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Перезагрузить');
  });

  it('пустая база открылась — онбординг пустой полки', async () => {
    await startLibrary();
    mount();
    expect(heading()).toBe('Полка пока пустая');
    expect(host.textContent).not.toContain('Не удалось открыть хранилище');
  });

  it('книги есть — полка с книгами', async () => {
    const b = sampleBook('Тихая работа', 2, { id: 'tihaya' });
    await saveImportedBook(b.meta, b.chapters);
    __resetLibraryForTests();
    await startLibrary();
    mount();
    expect(host.textContent).toContain('Тихая работа');
    expect(host.textContent).not.toContain('Полка пока пустая');
    expect(host.textContent).not.toContain('Не удалось открыть хранилище');
  });
});
