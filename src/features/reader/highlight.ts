/**
 * Подсветка найденного поиском (`?find=`): первое совпадение в блоке оборачивается в `<mark>`.
 * Сравнение — как у поиска (`normalizeForSearch`): регистр и ё/е не важны, знаки разметки
 * `#>*_`|` не считаются, пробелы схлопнуты. В `<mark>` попадает исходный текст, даже если совпадение
 * переходит через `<strong>` или `<em>`.
 */
import { normalizeForSearch } from '../../core/text';

/** Откуда в DOM пришёл символ нормализованного текста. */
interface Source {
  node: Text;
  start: number;
  end: number;
}

const MARKUP = new Set(['#', '>', '*', '_', '`', '|']);

/**
 * Найти `query` в тексте `el` и обернуть первое совпадение в `<mark>`.
 * Текст внутри `skip` не просматривается: по умолчанию вложенные списки и колода — так же,
 * как собственный текст блока (`ownText`). Для поиска по всей главе — `skip = '.deck'`.
 */
export function highlightMatch(el: HTMLElement, query: string, skip = 'ul, ol, .deck'): HTMLElement | null {
  const needle = normalizeForSearch(query);
  if (!needle) return null;

  let text = '';
  const from: Source[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      return parent && parent !== el && parent.closest(skip) && el.contains(parent.closest(skip))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data;
    for (let i = 0; i < data.length; ) {
      const ch = String.fromCodePoint(data.codePointAt(i)!);
      const end = i + ch.length;
      for (const c of ch.toLowerCase()) {
        if (MARKUP.has(c)) continue;
        if (/\s/.test(c)) {
          // Пробелы схлопываются в один; в начале не нужны
          if (text === '' || text.endsWith(' ')) continue;
          text += ' ';
        } else {
          text += c === 'ё' ? 'е' : c;
        }
        from.push({ node, start: i, end });
      }
      i = end;
    }
  }

  const at = text.indexOf(needle);
  if (at < 0) return null;
  const first = from[at];
  const last = from[at + needle.length - 1];

  const range = el.ownerDocument.createRange();
  range.setStart(first.node, first.start);
  range.setEnd(last.node, last.end);
  const mark = el.ownerDocument.createElement('mark');
  try {
    range.surroundContents(mark);
  } catch {
    // Совпадение режет элемент (часть слова в <strong>): переносим кусок внутрь <mark>
    mark.append(range.extractContents());
    range.insertNode(mark);
  }
  return mark;
}
