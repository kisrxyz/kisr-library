import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runToastAction, toast, toasts } from './toast-state';

const texts = () => toasts.value.map((t) => t.text);

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('показывает сообщение и сам убирает его через ms', () => {
    toast('Скопировано');
    expect(texts()).toEqual(['Скопировано']);
    vi.advanceTimersByTime(3999);
    expect(toasts.value[0].leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toasts.value[0].leaving).toBe(true);
    vi.advanceTimersByTime(160);
    expect(toasts.value).toEqual([]);
  });

  it('кнопка выполняет действие один раз и убирает тост', () => {
    const run = vi.fn();
    toast('Удалено', { label: 'Вернуть', run }, 6000);
    const { id } = toasts.value[0];
    runToastAction(id);
    runToastAction(id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(toasts.value[0].leaving).toBe(true);
  });

  it('после срока кнопка уже не срабатывает', () => {
    const run = vi.fn();
    toast('Удалено', { label: 'Вернуть', run }, 6000);
    const { id } = toasts.value[0];
    vi.advanceTimersByTime(6000);
    runToastAction(id);
    expect(run).not.toHaveBeenCalled();
  });

  it('держит не больше трёх: старые уходят', () => {
    for (const text of ['1', '2', '3', '4']) toast(text);
    expect(texts()).toEqual(['2', '3', '4']);
  });

  it('с ms = Infinity ждёт нажатия', () => {
    toast('Доступно обновление', { label: 'Обновить', run: () => {} }, Infinity);
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
    expect(texts()).toEqual(['Доступно обновление']);
  });
});
