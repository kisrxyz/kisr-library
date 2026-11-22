// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareOrDownload } from './share';

const blob = () => new Blob(['# Книга'], { type: 'text/plain' });

const nav = navigator as unknown as { canShare?: unknown; share?: unknown };

function stubShare(canShare: boolean, share: () => Promise<void>) {
  nav.canShare = vi.fn(() => canShare);
  nav.share = vi.fn(share);
  return { canShare: nav.canShare as ReturnType<typeof vi.fn>, share: nav.share as ReturnType<typeof vi.fn> };
}

let clicked: { href: string; download: string }[];

beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete nav.canShare;
  delete nav.share;
});

describe('shareOrDownload', () => {
  it('открывает меню «Поделиться» с файлом нужного имени, если система его поддерживает', async () => {
    const { share } = stubShare(true, async () => {});
    await shareOrDownload('kniga.md', blob());
    expect(share).toHaveBeenCalledTimes(1);
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('kniga.md');
    expect(clicked).toEqual([]);
  });

  it('закрыл меню — не скачивает', async () => {
    stubShare(true, () => Promise.reject(new DOMException('отмена', 'AbortError')));
    await shareOrDownload('kniga.md', blob());
    expect(clicked).toEqual([]);
  });

  it('другая ошибка меню — скачивает файл', async () => {
    stubShare(true, () => Promise.reject(new DOMException('нет жеста', 'NotAllowedError')));
    await shareOrDownload('kniga.md', blob());
    expect(clicked).toEqual([{ href: expect.stringContaining('blob:test'), download: 'kniga.md' }]);
  });

  it('файлы не поддерживаются — скачивает и освобождает адрес', async () => {
    const { share } = stubShare(false, async () => {});
    await shareOrDownload('kniga.md', blob());
    expect(share).not.toHaveBeenCalled();
    expect(clicked).toEqual([{ href: expect.stringContaining('blob:test'), download: 'kniga.md' }]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('в браузере без Web Share тоже скачивает', async () => {
    await shareOrDownload('kniga.md', blob());
    expect(clicked).toHaveLength(1);
  });
});
