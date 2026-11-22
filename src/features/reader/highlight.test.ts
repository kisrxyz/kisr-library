// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { highlightMatch } from './highlight';

function block(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root.firstElementChild as HTMLElement;
}

const marks = (el: Element) => Array.from(el.querySelectorAll('mark')).map((m) => m.textContent);

describe('highlightMatch', () => {
  it('оборачивает найденное в <mark> без учёта регистра; текст абзаца не меняется', () => {
    const p = block('<p>Чтобы быть интересным, интересуйся другими.</p>');
    const mark = highlightMatch(p, 'ИНТЕРЕСНЫМ');
    expect(mark?.tagName).toBe('MARK');
    expect(marks(p)).toEqual(['интересным']);
    expect(p.textContent).toBe('Чтобы быть интересным, интересуйся другими.');
  });

  it('ё и е не различаются, в <mark> остаётся исходное написание', () => {
    const p = block('<p>Ёжик вышел из тумана</p>');
    highlightMatch(p, 'ежик');
    expect(marks(p)).toEqual(['Ёжик']);
  });

  it('совпадение через границу выделения жирным', () => {
    const p = block('<p>раз <strong>два</strong> три</p>');
    highlightMatch(p, 'з два т');
    expect(marks(p)).toEqual(['з два т']);
    expect(p.querySelector('mark strong')?.textContent).toBe('два');
    expect(p.textContent).toBe('раз два три');
  });

  it('пробелы и переносы строк схлопываются, как в поиске', () => {
    const p = block('<p>раз\n   два</p>');
    highlightMatch(p, 'раз два');
    expect(marks(p)).toEqual(['раз\n   два']);
  });

  it('только первое совпадение в блоке', () => {
    const p = block('<p>кот и ещё кот</p>');
    highlightMatch(p, 'кот');
    expect(marks(p)).toEqual(['кот']);
    expect(p.innerHTML.startsWith('<mark>кот</mark>')).toBe(true);
  });

  it('в пункте списка не ищет во вложенном списке — как собственный текст блока', () => {
    const li = block('<li>родитель<ul><li>кот</li></ul></li>');
    expect(highlightMatch(li, 'кот')).toBeNull();
    expect(li.querySelector('mark')).toBeNull();
  });

  it('по всей главе (skip = .deck) находит и в списке, но не в колоде', () => {
    const root = block('<div><div class="deck"><p>кот</p></div><ul><li>ещё кот</li></ul></div>');
    highlightMatch(root, 'кот', '.deck');
    expect(marks(root)).toEqual(['кот']);
    expect(root.querySelector('.deck mark')).toBeNull();
    expect(root.querySelector('li mark')).not.toBeNull();
  });

  it('нет совпадения или пустой запрос — null, DOM не тронут', () => {
    const p = block('<p>просто текст</p>');
    expect(highlightMatch(p, 'слон')).toBeNull();
    expect(highlightMatch(p, '  ')).toBeNull();
    expect(p.innerHTML).toBe('просто текст');
  });
});
