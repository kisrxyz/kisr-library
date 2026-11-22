// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hash } from '../core/text';
import { blockKey, enhanceChapter, ownText } from './enhance';
import { renderMarkdown } from './render';

function render(md: string, tasksDone: Record<string, true> = {}, onTask = vi.fn()) {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(md);
  document.body.append(root);
  const res = enhanceChapter(root, { tasksDone, onTask });
  return { root, res, onTask };
}

const keys = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-key]')).map((e) => e.getAttribute('data-key'));

describe('таблицы и ссылки', () => {
  it('таблица лежит внутри .table-wrap', () => {
    const { root } = render('| а | б |\n|---|---|\n| 1 | 2 |');
    const wrap = root.querySelector('.table-wrap')!;
    expect(wrap).not.toBeNull();
    expect(wrap.querySelector('table')).not.toBeNull();
    expect(root.querySelectorAll('table')).toHaveLength(1);
    expect(wrap.parentElement).toBe(root);
  });

  it('прокручиваемая таблица доступна с клавиатуры', () => {
    const { root } = render('| а | б |\n|---|---|\n| 1 | 2 |');
    const wrap = root.querySelector('.table-wrap')!;
    expect(wrap.getAttribute('tabindex')).toBe('0');
    expect(wrap.getAttribute('role')).toBe('region');
    expect(wrap.getAttribute('aria-label')).toBe('Таблица');
  });

  it('ссылки открываются в новой вкладке с rel=noopener', () => {
    const { root } = render('[сайт](https://example.com) и [почта](mailto:a@b.c)');
    expect(root.querySelectorAll('a')).toHaveLength(2);
    for (const a of root.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
    }
  });
});

describe('ключи блоков (spec §8.3)', () => {
  it('абзац «Привет, мир» получает p5v995x', () => {
    const { root } = render('Привет, мир');
    expect(root.querySelector('p')!.getAttribute('data-key')).toBe('p5v995x');
  });

  it('p внутри li ключа не получает, li получает l…', () => {
    const { root } = render('- Первый пункт\n\n- Второй пункт');
    const li = root.querySelector('li')!;
    expect(li.querySelector('p')).not.toBeNull();
    expect(li.querySelector('p')!.hasAttribute('data-key')).toBe(false);
    expect(li.getAttribute('data-key')).toBe('l' + hash('Первый пункт'));
  });

  it('вложенный список: собственный текст li не включает вложенный ul/ol', () => {
    const { root } = render('- родитель\n  - ребёнок\n  - второй\n- брат');
    const li = root.querySelector('li')!;
    expect(ownText(li)).toBe('родитель');
    expect(keys(root)).toEqual(['l' + hash('родитель'), 'l' + hash('ребёнок'), 'l' + hash('второй'), 'l' + hash('брат')]);
  });

  it('blockquote получает b…, p внутри него — нет; h3 и h4 получают h…, h1/h2 — нет', () => {
    const { root } = render('# Один\n\n## Два\n\n### Три\n\n#### Четыре\n\n> Цитата\n>\n> вторая');
    expect(root.querySelector('h1')!.hasAttribute('data-key')).toBe(false);
    expect(root.querySelector('h2')!.hasAttribute('data-key')).toBe(false);
    expect(root.querySelector('h3')!.getAttribute('data-key')).toBe('h' + hash('Три'));
    expect(root.querySelector('h4')!.getAttribute('data-key')).toBe('h' + hash('Четыре'));
    const bq = root.querySelector('blockquote')!;
    expect(bq.getAttribute('data-key')).toBe('b' + hash('Цитата вторая'));
    expect(bq.querySelector('p')!.hasAttribute('data-key')).toBe(false);
  });

  it('блок короче двух символов ключа не получает', () => {
    const { root } = render('я\n\nда');
    const ps = root.querySelectorAll('p');
    expect(ps[0].hasAttribute('data-key')).toBe(false);
    expect(ps[1].getAttribute('data-key')).toBe('p' + hash('да'));
  });

  it('пробелы и переносы в тексте схлопываются, как в старом приложении', () => {
    const { root } = render('раз\nдва   **три**');
    expect(root.querySelector('p')!.getAttribute('data-key')).toBe('p' + hash('раз два три'));
  });

  it('blockKey считает то же самое для отдельного элемента', () => {
    const { root } = render('Привет, мир\n\nя');
    const [a, b] = Array.from(root.querySelectorAll('p'));
    expect(blockKey(a)).toBe('p5v995x');
    expect(blockKey(b)).toBeNull();
    expect(blockKey(root)).toBeNull();
  });

  it('data-key из сырого HTML книги не считается ключом блока', () => {
    const { root, res } = render('<p data-key="evil">я</p>\n\nТекст абзаца');
    expect(keys(root)).toEqual(['p' + hash('Текст абзаца')]);
    expect(res.anchors).toHaveLength(1);
  });
});

describe('чекбоксы (spec §8.7)', () => {
  it('«- [ ] шаг» становится настоящим чекбоксом, не отмеченным и доступным', () => {
    const { root } = render('- [ ] шаг');
    const box = root.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    const li = root.querySelector('li')!;
    expect(li.classList.contains('task')).toBe(true);
    expect(li.classList.contains('done')).toBe(false);
    expect(li.getAttribute('data-key')).toBe('l' + hash('шаг'));
  });

  it('чекбокс называется текстом пункта', () => {
    const { root } = render('- [ ] шаг **один**');
    const box = root.querySelector('input')!;
    const name = root.querySelector('#' + box.getAttribute('aria-labelledby'))!;
    expect(name.textContent!.trim()).toBe('шаг один');
  });

  it('отмечен, если ключ есть в tasksDone; li получает .done', () => {
    const { root } = render('- [ ] шаг', { ['t' + hash('шаг')]: true });
    expect(root.querySelector('input')!.checked).toBe(true);
    expect(root.querySelector('li')!.classList.contains('done')).toBe(true);
  });

  it('исходный [x] в тексте состояния не задаёт: правда — в tasksDone', () => {
    const { root } = render('- [x] шаг');
    expect(root.querySelector('input')!.checked).toBe(false);
  });

  it('change вызывает onTask(key, done) и переключает .done', () => {
    const key = 't' + hash('шаг');
    const { root, onTask } = render('- [ ] шаг', { [key]: true });
    const box = root.querySelector('input')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onTask).toHaveBeenCalledWith(key, false);
    expect(root.querySelector('li')!.classList.contains('done')).toBe(false);
    box.click();
    expect(onTask).toHaveBeenLastCalledWith(key, true);
    expect(root.querySelector('li')!.classList.contains('done')).toBe(true);
  });

  it('ключ пункта строится по тексту без вложенного списка; в плотном и «рыхлом» списке одинаков', () => {
    const tight = render('- [ ] **шаг** один\n  - [ ] вложенный');
    const loose = render('- [ ] **шаг** один\n\n- [ ] другой');
    const t = Array.from(tight.root.querySelectorAll('input'));
    expect(t).toHaveLength(2);
    t[0].click();
    expect(tight.onTask).toHaveBeenCalledWith('t' + hash('шаг один'), true);
    t[1].click();
    expect(tight.onTask).toHaveBeenLastCalledWith('t' + hash('вложенный'), true);
    loose.root.querySelector('input')!.click();
    expect(loose.onTask).toHaveBeenCalledWith('t' + hash('шаг один'), true);
  });

  it('вложенный список остаётся внутри li пункта', () => {
    const { root } = render('- [ ] родитель\n  - [ ] ребёнок');
    const parent = root.querySelector('li')!;
    expect(parent.querySelector(':scope > ul > li')).not.toBeNull();
    expect(parent.getAttribute('data-key')).toBe('l' + hash('родитель'));
  });

  it('посторонние input в пункте убираются, настоящий чекбокс работает', () => {
    const root = document.createElement('div');
    // Разметка не из renderMarkdown: enhanceChapter не должен полагаться на то, что её уже вычистили.
    root.innerHTML =
      '<ul><li><input type="checkbox" disabled> шаг <input type="password" name="p"> <input type="image" src="x"></li></ul>';
    document.body.append(root); // change у отсоединённого чекбокса не срабатывает
    const onTask = vi.fn();
    enhanceChapter(root, { tasksDone: {}, onTask });
    const inputs = Array.from(root.querySelectorAll('input'));
    expect(inputs).toHaveLength(1);
    expect(inputs[0].type).toBe('checkbox');
    inputs[0].click();
    expect(onTask).toHaveBeenCalledWith('t' + hash('шаг'), true);
  });

  it('пункт с input другого типа вместо чекбокса не становится задачей, input убирается', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ul><li><input type="text"> шаг</li></ul>';
    enhanceChapter(root, { tasksDone: {}, onTask: vi.fn() });
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('li')!.classList.contains('task')).toBe(false);
  });

  it('обычные пункты чекбоксов не получают', () => {
    const { root } = render('- просто');
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('li')!.classList.contains('task')).toBe(false);
  });
});

describe('колода ```cards', () => {
  const md =
    'До колоды\n\n```cards\nQ: Что такое hash?\nA: djb2 в base36\nQ: Зачем ключи?\nA: Чтобы найти место\n```\n\nПосле колоды';

  it('блок заменён на .deck, ключей внутри нет', () => {
    const { root } = render(md);
    const deck = root.querySelector('.deck')!;
    expect(deck).not.toBeNull();
    expect(root.querySelector('pre')).toBeNull();
    expect(deck.querySelector('[data-key]')).toBeNull();
    expect(deck.querySelector('.deck-top strong')!.textContent).toBe('Карточки · 2');
  });

  it('абзацы вокруг колоды получают ключи, колода — нет', () => {
    const { root } = render(md);
    expect(keys(root)).toEqual(['p' + hash('До колоды'), 'p' + hash('После колоды')]);
  });

  it('блок без карточек остаётся кодом', () => {
    const { root } = render('```cards\nпросто текст без вопросов\n```');
    expect(root.querySelector('.deck')).toBeNull();
    expect(root.querySelector('pre')).not.toBeNull();
  });

  it('обычный код не трогается', () => {
    const { root } = render('```js\nconst a = 1;\n```');
    expect(root.querySelector('pre > code')).not.toBeNull();
    expect(root.querySelector('.deck')).toBeNull();
  });
});

describe('anchors и слова', () => {
  const md = [
    '## Глава',
    'Привет, мир',
    '### Подзаголовок',
    '- раз два\n  - вложенный пункт из трёх',
    '- [ ] задача',
    '> цитата из трёх слов',
    '```cards\nQ: вопрос один\nA: ответ\n```',
    'Последний абзац текста',
  ].join('\n\n');

  it('anchors — все элементы с data-key по порядку документа', () => {
    const { root, res } = render(md);
    const all = Array.from(root.querySelectorAll('[data-key]'));
    expect(res.anchors.length).toBe(all.length);
    expect(res.anchors).toEqual(all);
    expect(res.wordsBefore).toHaveLength(all.length);
    expect(res.words).toHaveLength(all.length);
  });

  it('wordsBefore[0] === 0 и wordsBefore[i+1] === wordsBefore[i] + words[i]', () => {
    const { res } = render(md);
    expect(res.wordsBefore[0]).toBe(0);
    for (let i = 0; i < res.anchors.length - 1; i++) {
      expect(res.wordsBefore[i + 1]).toBe(res.wordsBefore[i] + res.words[i]);
    }
  });

  it('слова блока — по его собственному тексту (без вложенного списка и колоды)', () => {
    const { res } = render(md);
    const idx = (text: string) => res.anchors.findIndex((a) => ownText(a) === text);
    expect(res.words[idx('Привет, мир')]).toBe(2);
    expect(res.words[idx('раз два')]).toBe(2);
    expect(res.words[idx('вложенный пункт из трёх')]).toBe(4);
    expect(res.words[idx('Последний абзац текста')]).toBe(3);
  });

  it('пустая глава даёт пустые массивы', () => {
    const { res } = render('');
    expect(res).toEqual({ anchors: [], wordsBefore: [], words: [] });
  });
});
