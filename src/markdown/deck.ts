/**
 * Колода карточек из блока ```cards. Перенос `buildDeck` из старого приложения на чистом DOM:
 * «Вопрос → нажми → Ответ», «Назад» / «Дальше» по кругу, счётчик «3 / 14», «Перемешать», «Списком».
 * Колода живёт внутри главы, но своих ключей не имеет (spec §8.3) — позицию чтения она не задаёт.
 */
import { toast } from '../ui/toast-state';
import { ICONS } from '../ui/Icon';
import '../ui/Button.css';
import './markdown.css';

interface Card {
  q: string;
  a: string;
}

type DeckIcon = 'left' | 'right' | 'shuffle' | 'list';

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(name: DeckIcon): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  ...children: (Node | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  for (const c of children) if (c) node.append(c);
  return node;
}

/** Кнопка в общем стиле `.btn` (≥ 44px). Подпись и/или значок; без подписи — квадратная, нужен `label`. */
function button(opts: { text?: string; label?: string; icon: DeckIcon; iconAfter?: boolean }): HTMLButtonElement {
  const b = el('button', opts.text ? 'btn btn--ghost' : 'btn btn--ghost btn--icon');
  b.type = 'button';
  if (opts.label) b.setAttribute('aria-label', opts.label);
  const parts: Node[] = [icon(opts.icon)];
  if (opts.text) parts.push(el('span', undefined, opts.text));
  if (opts.iconAfter) parts.reverse();
  b.append(...parts);
  return b;
}

export function buildDeck(cards: Card[]): HTMLElement {
  const wrap = el('div', 'deck');
  if (!cards.length) return wrap;

  const order = cards.map((_, i) => i);
  let idx = 0;
  let shown = false;
  let listMode = false;

  // Счётчик объявляется скринридеру при каждой смене карточки.
  const out = el('output');
  out.setAttribute('aria-live', 'polite');

  const card = el('button', 'flash');
  card.type = 'button';
  const body = el('div');

  const prev = button({ text: 'Назад', icon: 'left' });
  const next = button({ text: 'Дальше', icon: 'right', iconAfter: true });
  const shuffleBtn = button({ label: 'Перемешать карточки', icon: 'shuffle' });
  shuffleBtn.title = 'Перемешать';
  const modeBtn = button({ label: 'Показать все карточки списком', icon: 'list' });
  modeBtn.title = 'Списком';
  modeBtn.setAttribute('aria-pressed', 'false');

  function go(step: number): void {
    idx = (idx + step + order.length) % order.length;
    shown = false;
    paint();
  }

  function paint(): void {
    if (listMode) {
      const list = el(
        'div',
        'deck-list',
        undefined,
        ...order.map((i) => el('details', undefined, undefined, el('summary', undefined, cards[i].q), el('p', undefined, cards[i].a))),
      );
      body.replaceChildren(list);
      return;
    }
    const c = cards[order[idx]];
    card.setAttribute('aria-expanded', String(shown));
    card.replaceChildren(
      el('span', 'lbl', shown ? 'Ответ' : 'Вопрос'),
      el('span', 'q', c.q),
      shown ? el('span', 'a', c.a || '—') : el('span', 'tap', 'Нажми, чтобы увидеть ответ'),
    );
    out.textContent = `${idx + 1} / ${order.length}`;
    body.replaceChildren(card, el('div', 'deck-nav', undefined, prev, out, next));
  }

  card.addEventListener('click', () => {
    shown = !shown;
    paint();
  });
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));

  shuffleBtn.addEventListener('click', () => {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    idx = 0;
    shown = false;
    paint();
    toast('Карточки перемешаны');
  });

  modeBtn.addEventListener('click', () => {
    listMode = !listMode;
    modeBtn.setAttribute('aria-pressed', String(listMode));
    modeBtn.setAttribute('aria-label', listMode ? 'Показывать по одной' : 'Показать все карточки списком');
    shuffleBtn.hidden = listMode;
    paint();
  });

  wrap.append(
    el('div', 'deck-top', undefined, el('strong', undefined, `Карточки · ${cards.length}`), el('div', 'deck-tools', undefined, shuffleBtn, modeBtn)),
    body,
  );
  paint();
  return wrap;
}
