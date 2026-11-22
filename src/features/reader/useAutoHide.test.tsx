// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isProgrammaticScroll, scrollWindowTo, useAutoHide } from './useAutoHide';

let scrollY = 0;
let clock = 1_000;
let host: HTMLElement;

beforeEach(() => {
  scrollY = 0;
  clock += 10_000; // прокрутка «от приложения» из прошлого теста давно истекла
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  window.scrollTo = vi.fn((_x: number, y: number) => {
    scrollY = y;
  }) as unknown as typeof window.scrollTo;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // Длинная глава: до низа страницы далеко
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 10_000 });
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
});

describe('scrollWindowTo / isProgrammaticScroll', () => {
  it('прокрутка приложения узнаётся по месту и времени', () => {
    scrollWindowTo(500);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 500);
    expect(isProgrammaticScroll()).toBe(true);
    scrollY = 640; // читатель уже сдвинул страницу
    expect(isProgrammaticScroll()).toBe(false);
    scrollY = 500;
    clock += 250; // позже 200 мс — это уже не та прокрутка
    expect(isProgrammaticScroll()).toBe(false);
  });

  it('браузер упёрся в край страницы — запоминается, где окно оказалось', () => {
    window.scrollTo = vi.fn(() => {
      scrollY = 1200; // ниже прокрутить нельзя
    }) as unknown as typeof window.scrollTo;
    scrollWindowTo(5000);
    expect(isProgrammaticScroll()).toBe(true);
  });
});

function Probe({ enabled, nearEnd = () => false }: { enabled: boolean; nearEnd?: () => boolean }) {
  const visible = useAutoHide(enabled, nearEnd);
  return <p data-visible={String(visible)} />;
}

const visible = () => host.querySelector('p')!.dataset.visible;

async function scrollPage(y: number) {
  scrollY = y;
  window.dispatchEvent(new Event('scroll'));
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
  });
}

describe('useAutoHide', () => {
  it('вниз — прячется, вверх — появляется, у начала страницы видна', async () => {
    scrollY = 300;
    act(() => render(<Probe enabled />, host));
    expect(visible()).toBe('true');
    await scrollPage(500);
    expect(visible()).toBe('false');
    await scrollPage(480);
    expect(visible()).toBe('true');
    await scrollPage(700);
    expect(visible()).toBe('false');
    await scrollPage(60);
    expect(visible()).toBe('true');
  });

  it('дрожание меньше 12px в одну сторону панель не трогает', async () => {
    scrollY = 300;
    act(() => render(<Probe enabled />, host));
    await scrollPage(306);
    await scrollPage(312);
    expect(visible()).toBe('true');
    await scrollPage(320);
    expect(visible()).toBe('false');
  });

  it('у конца главы панель видна и при прокрутке вниз', async () => {
    let atEnd = false;
    scrollY = 300;
    act(() => render(<Probe enabled nearEnd={() => atEnd} />, host));
    atEnd = true;
    await scrollPage(900);
    expect(visible()).toBe('true');
  });

  it('у самого низа страницы панель видна', async () => {
    scrollY = 300;
    act(() => render(<Probe enabled />, host));
    await scrollPage(10_000 - window.innerHeight - 20);
    expect(visible()).toBe('true');
  });

  it('пока глава открывается (enabled = false), прокрутка панель не прячет', async () => {
    scrollY = 300;
    act(() => render(<Probe enabled={false} />, host));
    await scrollPage(900);
    expect(visible()).toBe('true');
  });

  it('прокрутка приложения (возврат на место) панель не прячет', async () => {
    scrollY = 300;
    act(() => render(<Probe enabled />, host));
    scrollWindowTo(2400);
    window.dispatchEvent(new Event('scroll'));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(visible()).toBe('true');
  });
});
