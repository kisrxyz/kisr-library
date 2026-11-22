// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

let sentinels: FakeSentinel[];
let request: ReturnType<typeof vi.fn>;
let host: HTMLElement;
let visibility: DocumentVisibilityState;

function Probe({ enabled }: { enabled: boolean }) {
  useWakeLock(enabled);
  return null;
}

const mount = (enabled: boolean) => act(() => render(<Probe enabled={enabled} />, host));
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  sentinels = [];
  request = vi.fn(async () => {
    const s = new FakeSentinel();
    sentinels.push(s);
    return s;
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
});

describe('useWakeLock', () => {
  it('выключено — экран не держит', async () => {
    mount(false);
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('включили — просит «screen», выключили — отпускает', async () => {
    mount(true);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    mount(false);
    await flush();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('при уходе читалки отпускает блокировку', async () => {
    mount(true);
    await flush();
    act(() => render(null, host));
    await flush();
    expect(sentinels[0].released).toBe(true);
  });

  it('браузер снял блокировку при сворачивании — возвращаясь, просит заново', async () => {
    mount(true);
    await flush();
    await sentinels[0].release();
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('пока блокировка держится, видимость повторных запросов не плодит', async () => {
    mount(true);
    await flush();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('вкладка скрыта — не просит', async () => {
    visibility = 'hidden';
    mount(true);
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('выключили, пока запрос в пути — отпускает, как только он ответил', async () => {
    let resolve!: (s: FakeSentinel) => void;
    request.mockImplementationOnce(() => new Promise<FakeSentinel>((r) => (resolve = r)));
    mount(true);
    mount(false);
    const late = new FakeSentinel();
    await act(async () => resolve(late));
    expect(late.release).toHaveBeenCalled();
  });

  it('отказ браузера (экономия заряда) не ломает читалку', async () => {
    request.mockRejectedValueOnce(new DOMException('low battery', 'NotAllowedError'));
    mount(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('без Wake Lock API ничего не делает', async () => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    expect(() => mount(true)).not.toThrow();
  });
});
