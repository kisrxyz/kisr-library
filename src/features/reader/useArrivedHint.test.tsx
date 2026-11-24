// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProgress } from '../../core/progress';
import type { BookMeta } from '../../core/types';
import { sampleBook } from '../../db/testing';
import { __resetLibraryForTests, progressMap } from '../../state/library';
import { progressArrived } from '../../state/sync';
import { runToastAction, toasts } from '../../ui/toast-state';

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../router')>();
  return { ...actual, navigate: nav.navigate };
});
import { useArrivedHint } from './useArrivedHint';

const book: BookMeta = sampleBook('Книга', 4, { id: 'kniga' }).meta;

function Probe({ b }: { b: BookMeta }) {
  useArrivedHint(b);
  return null;
}

let host: HTMLElement;

beforeEach(() => {
  __resetLibraryForTests();
  progressArrived.value = null;
  toasts.value = [];
  nav.navigate.mockReset();
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe('useArrivedHint', () => {
  it('место этой книги пришло с другого устройства — тост «Перейти» ведёт туда', () => {
    act(() => render(<Probe b={book} />, host));
    progressMap.value = new Map([['kniga', { ...newProgress('kniga', 1), chapter: 3, blockKey: 'abc' }]]);
    act(() => {
      progressArrived.value = { ids: ['kniga'], at: 1 };
    });
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].text).toBe('Ты читал эту книгу на другом устройстве');
    expect(toasts.value[0].action?.label).toBe('Перейти');
    act(() => runToastAction(toasts.value[0].id));
    expect(nav.navigate).toHaveBeenCalledWith('#/read/kniga/3?b=abc');
  });

  it('другая книга или приход до открытия читалки — без тоста', () => {
    progressArrived.value = { ids: ['kniga'], at: 1 };
    progressMap.value = new Map([['kniga', newProgress('kniga', 1)]]);
    act(() => render(<Probe b={book} />, host));
    expect(toasts.value).toEqual([]);
    act(() => {
      progressArrived.value = { ids: ['drugaya'], at: 2 };
    });
    expect(toasts.value).toEqual([]);
  });
});
