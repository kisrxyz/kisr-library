// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts } from '../../ui/toast-state';

const sync = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), now: vi.fn() }));
vi.mock('../../state/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/sync')>();
  return { ...actual, connectSync: sync.connect, disconnectSync: sync.disconnect, syncNow: sync.now };
});
import { syncView } from '../../state/sync';
import { SyncSection } from './SyncSection';

let host: HTMLElement;

const OFF = { phase: 'off' as const, repo: null, lastSyncAt: null, error: null, needsToken: false };
const ON = { phase: 'idle' as const, repo: 'kisr/kisr-library-data', lastSyncAt: Date.now(), error: null, needsToken: false };

const button = (text: string, root: ParentNode = document) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const sheet = () => document.querySelector('dialog.sheet');

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  syncView.value = { ...OFF };
  toasts.value = [];
  sync.connect.mockReset();
  sync.disconnect.mockReset().mockResolvedValue(undefined);
  sync.now.mockReset().mockResolvedValue(null);
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe('SyncSection: выключена', () => {
  it('«Настроить» открывает шторку с шагами, ссылками на GitHub и полями', async () => {
    act(() => render(<SyncSection />, host));
    expect(host.textContent).toContain('Синхронизация между устройствами');
    await act(async () => button('Настроить', host)!.click());

    const s = sheet()!;
    expect(s.querySelector('.sheet__title')?.textContent).toBe('Синхронизация');
    const links = [...s.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(links.some((h) => h.startsWith('https://github.com/new?') && h.includes('visibility=private'))).toBe(true);
    const tokenLink = links.find((h) => h.startsWith('https://github.com/settings/personal-access-tokens/new?'));
    expect(tokenLink).toContain('contents=write');
    expect(tokenLink).toContain('expires_in=none');

    const key = s.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(key.getAttribute('autocomplete')).toBe('off');
    expect(key.getAttribute('autocapitalize')).toBe('off');
    expect(key.getAttribute('spellcheck')).toBe('false');
    expect(key.getAttribute('autocorrect')).toBe('off');
    expect(s.querySelector<HTMLInputElement>('input[name="repo"]')!.value).toBe('kisr-library-data');
  });

  it('«Подключить»: ключ и репозиторий уходят в connectSync, при успехе — тост', async () => {
    sync.connect.mockResolvedValue({ ok: true, result: { added: 0, updated: 0, removed: 0, pushed: 6, progressFrom: [] } });
    act(() => render(<SyncSection />, host));
    await act(async () => button('Настроить', host)!.click());
    const s = sheet()!;
    await act(async () => type(s.querySelector<HTMLInputElement>('input[type="password"]')!, 'github_pat_123'));
    await act(async () => button('Подключить', s)!.click());

    expect(sync.connect).toHaveBeenCalledWith('github_pat_123', 'kisr-library-data');
    expect(toasts.value.map((t) => t.text)).toContain('Синхронизация включена');
  });

  it('отказ показывается в шторке', async () => {
    sync.connect.mockResolvedValue({ ok: false, message: 'Ключ не подходит. Проверь, что скопировал его целиком' });
    act(() => render(<SyncSection />, host));
    await act(async () => button('Настроить', host)!.click());
    const s = sheet()!;
    await act(async () => type(s.querySelector<HTMLInputElement>('input[type="password"]')!, 'плохой'));
    await act(async () => button('Подключить', s)!.click());
    expect(s.querySelector('[role="alert"]')?.textContent).toContain('Ключ не подходит');
  });

  it('без ключа «Подключить» недоступна', async () => {
    act(() => render(<SyncSection />, host));
    await act(async () => button('Настроить', host)!.click());
    expect(button('Подключить', sheet()!)!.disabled).toBe(true);
  });
});

describe('SyncSection: включена', () => {
  it('репозиторий, время и «Синхронизировать сейчас»', async () => {
    syncView.value = { ...ON };
    act(() => render(<SyncSection />, host));
    expect(host.textContent).toContain('Включена · kisr/kisr-library-data');
    expect(host.textContent).toContain('Синхронизировано сегодня в');
    await act(async () => button('Синхронизировать сейчас', host)!.click());
    expect(sync.now).toHaveBeenCalled();
  });

  it('ключ не подходит — «Вставить новый ключ» открывает шторку', async () => {
    syncView.value = { ...ON, phase: 'error', error: 'Ключ не подходит. Вставь новый', needsToken: true };
    act(() => render(<SyncSection />, host));
    expect(host.textContent).toContain('Ключ не подходит. Вставь новый');
    await act(async () => button('Вставить новый ключ', host)!.click());
    expect(sheet()?.querySelector('input[type="password"]')).not.toBeNull();
    expect(sheet()!.querySelector<HTMLInputElement>('input[name="repo"]')!.value).toBe('kisr/kisr-library-data');
  });

  it('«Отключить на этом устройстве» спрашивает подтверждение', async () => {
    syncView.value = { ...ON };
    act(() => render(<SyncSection />, host));
    await act(async () => button('Отключить на этом устройстве', host)!.click());
    const s = sheet()!;
    expect(s.textContent).toContain('Книги останутся');
    await act(async () => button('Отключить', s)!.click());
    expect(sync.disconnect).toHaveBeenCalled();
  });
});
