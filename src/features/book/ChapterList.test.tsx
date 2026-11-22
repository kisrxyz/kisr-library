// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBook } from '../../core/book';
import { newProgress } from '../../core/progress';
import type { Progress } from '../../core/types';
import { ChapterList } from './ChapterList';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(' ');

const { meta: book } = buildBook(
  {
    title: 'Книга',
    category: 'Разное',
    tags: [],
    summary: '',
    source: '',
    chapters: [
      { title: 'Введение', md: words(180) },
      { title: 'Основа', md: words(181) },
      { title: '2.1. Подраздел', md: words(400) },
      { title: 'Источники', md: words(5) },
    ],
    warnings: [],
  },
  { origin: 'paste', id: 'kniga', now: 1 },
);

const rows = () => [...host.querySelectorAll<HTMLButtonElement>('.chapters__row')];
const states = () => rows().map((r) => r.dataset.state);

function mount(props: { progress?: Progress; current?: number; onOpen?: (n: number) => void } = {}) {
  act(() => render(<ChapterList book={book} onOpen={props.onOpen ?? (() => {})} progress={props.progress} current={props.current} />, host));
}

describe('ChapterList', () => {
  it('показывает номер, название и минуты каждой главы', () => {
    mount();
    expect(rows()).toHaveLength(4);
    expect(rows().map((r) => r.querySelector('.chapters__num')?.textContent)).toEqual(['1', '2', '3', '4']);
    expect(rows().map((r) => r.querySelector('.chapters__title')?.textContent)).toEqual([
      'Введение',
      'Основа',
      '2.1. Подраздел',
      'Источники',
    ]);
    // 180 слов — 1 минута, 181 — 2, 400 — 3, 5 слов — минимум 1; пробел перед «мин» неразрывный
    expect(rows().map((r) => r.querySelector('.chapters__min')?.textContent)).toEqual([
      '1\u00A0мин',
      '2\u00A0мин',
      '3\u00A0мин',
      '1\u00A0мин',
    ]);
  });

  it('сдвигает вправо только заголовки вида «N.M.»', () => {
    mount();
    const sub = rows().map((r) => r.querySelector('.chapters__title')?.classList.contains('chapters__title--sub'));
    expect(sub).toEqual([false, false, true, false]);
  });

  it('без прогресса все главы не дочитаны', () => {
    mount();
    expect(states()).toEqual(['todo', 'todo', 'todo', 'todo']);
  });

  it('✓ у дочитанных глав, ● у текущей, ○ у остальных', () => {
    const progress: Progress = { ...newProgress('kniga', 1), chapter: 2, chaptersDone: [1] };
    mount({ progress });
    expect(states()).toEqual(['done', 'current', 'todo', 'todo']);
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].textContent).toContain('дочитана');
    expect(rows()[1].textContent).toContain('текущая');
    expect(rows()[2].textContent).toContain('не дочитана');
  });

  it('у прочитанной книги текущей главы нет', () => {
    const progress: Progress = { ...newProgress('kniga', 1), chapter: 3, chaptersDone: [1, 3], status: 'finished' };
    mount({ progress });
    expect(states()).toEqual(['done', 'todo', 'done', 'todo']);
  });

  it('`current` из читалки важнее прогресса', () => {
    const progress: Progress = { ...newProgress('kniga', 1), chapter: 2, chaptersDone: [1] };
    mount({ progress, current: 4 });
    expect(states()).toEqual(['done', 'todo', 'todo', 'current']);
  });

  it('глава за пределами книги в прогрессе — текущей считается последняя', () => {
    mount({ progress: { ...newProgress('kniga', 1), chapter: 99 } });
    expect(states()).toEqual(['todo', 'todo', 'todo', 'current']);
  });

  it('нажатие отдаёт номер главы с единицы', () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    act(() => rows()[2].click());
    expect(onOpen).toHaveBeenCalledWith(3);
  });
});
