import { afterEach, describe, expect, it, vi } from 'vitest';
import { needsInstallHint } from './Banners';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
/** iPadOS 13+ в Safari представляется Mac'ом: отличить можно только по сенсорному экрану. */
const MAC_LIKE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

function device(userAgent: string, maxTouchPoints = 0, standalone?: boolean) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints, standalone });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('needsInstallHint: подсказка «Установи на экран „Домой“»', () => {
  it('iPhone и старый iPad в Safari — да', () => {
    device(IPHONE, 5);
    expect(needsInstallHint()).toBe(true);
    device(IPAD_OLD, 5);
    expect(needsInstallHint()).toBe(true);
  });

  it('iPadOS 13+ (Safari говорит «Macintosh», но экран сенсорный) — да', () => {
    device(MAC_LIKE, 5);
    expect(needsInstallHint()).toBe(true);
  });

  it('настоящий Mac без сенсорного экрана — нет', () => {
    device(MAC_LIKE, 0);
    expect(needsInstallHint()).toBe(false);
  });

  it('уже с экрана «Домой» — нет', () => {
    device(IPHONE, 5, true);
    expect(needsInstallHint()).toBe(false);
    device(MAC_LIKE, 5, true);
    expect(needsInstallHint()).toBe(false);
  });

  it('Android — нет', () => {
    device(ANDROID, 5);
    expect(needsInstallHint()).toBe(false);
  });
});
