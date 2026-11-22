// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShelfQuery } from '../../core/library';
import { MAX_CATEGORY_CHIPS, OptionList, ShelfFilters } from './ShelfFilters';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

const items = () => [...document.querySelectorAll<HTMLButtonElement>('.optlist__item')];

describe('OptionList: клавиатура', () => {
  const options = [
    { value: 'a', label: 'Первый' },
    { value: 'b', label: 'Второй' },
    { value: 'c', label: 'Третий' },
  ];

  function mount(onChange = vi.fn()) {
    act(() => render(<OptionList label="Тест" options={options} value="a" onChange={onChange} />, host));
    return onChange;
  }

  it('стрелки, Home и End двигают фокус и ничего не выбирают', () => {
    const onChange = mount();
    const [first, second, third] = items();

    first.focus();
    const down = press(first, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);

    press(second, 'ArrowDown');
    expect(document.activeElement).toBe(third);
    press(third, 'ArrowDown'); // по кругу
    expect(document.activeElement).toBe(first);
    press(first, 'ArrowUp');
    expect(document.activeElement).toBe(third);
    press(third, 'Home');
    expect(document.activeElement).toBe(first);
    press(first, 'End');
    expect(document.activeElement).toBe(third);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('выбирает нажатие (Enter и пробел на кнопке дают click), один раз и на сфокусированном пункте', () => {
    const onChange = mount();
    const [first, second] = items();

    first.focus();
    press(first, 'ArrowDown');
    expect(document.activeElement).toBe(second);
    expect(onChange).not.toHaveBeenCalled();

    // Enter и пробел на <button> браузер превращает в click
    act(() => second.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('по Tab доступен один пункт: выбранный, а после стрелок — тот, где фокус', () => {
    mount();
    const [first, second] = items();
    expect(items().map((b) => b.tabIndex)).toEqual([0, -1, -1]);

    first.focus();
    press(first, 'ArrowDown');
    expect(items().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(second);
  });

  it('другие клавиши не трогают список', () => {
    const onChange = mount();
    const [first] = items();
    first.focus();
    const event = press(first, 'a');
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Шторка «Все разделы»: стрелки не выбирают раздел и не закрывают шторку', () => {
  const categories = Array.from({ length: MAX_CATEGORY_CHIPS + 3 }, (_, i) => ({ name: `Раздел ${i + 1}`, count: 20 - i }));
  const query: ShelfQuery = { status: 'all', category: null, length: 'any', sort: 'recent' };

  it('Enter/нажатие выбирает раздел и закрывает шторку, стрелки — нет', async () => {
    const onChange = vi.fn();
    act(() =>
      render(
        <ShelfFilters
          query={query}
          statusCounts={{ all: 100, reading: 0, new: 100, finished: 0, fav: 0 }}
          categories={categories}
          total={100}
          shown={100}
          onChange={onChange}
        />,
        host,
      ),
    );

    const open = [...document.querySelectorAll<HTMLButtonElement>('.chip')].find((c) => c.textContent?.includes('Все разделы…'));
    expect(open).toBeDefined();
    act(() => open!.click());

    const dialog = () => document.querySelector('dialog.sheet');
    expect(dialog()).not.toBeNull();
    // Шторка выезжает кадром позже: data-state становится «open»
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(dialog()?.getAttribute('data-state')).toBe('open');
    const rows = items();
    expect(rows.length).toBe(categories.length + 1); // + «Все разделы»

    rows[0].focus();
    press(rows[0], 'ArrowDown');
    press(items()[1], 'ArrowDown');
    press(items()[2], 'End');
    expect(document.activeElement).toBe(items()[categories.length]);

    expect(onChange).not.toHaveBeenCalled();
    expect(dialog()?.getAttribute('data-state')).toBe('open');

    // Раздел выбирается нажатием на сфокусированный пункт
    act(() => (document.activeElement as HTMLElement).click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ category: `Раздел ${categories.length}` });
    expect(dialog()?.getAttribute('data-state')).toBe('closed');
  });
});
