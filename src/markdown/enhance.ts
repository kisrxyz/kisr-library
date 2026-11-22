/**
 * Пост-обработка отрисованной главы (порт `enhance()` старого приложения, spec §8.2–8.3, §8.7):
 * таблицы в горизонтальный скролл, внешние ссылки, ```cards → колода, `- [ ]` → чекбоксы,
 * ключи блоков `data-key`. Ключи считаются ровно как в старом приложении: по ним находятся
 * перенесённые позиции чтения.
 */
import { parseCards } from '../core/cards';
import { countWords, hash } from '../core/text';
import { buildDeck } from './deck';
import './markdown.css';

export interface EnhanceContext {
  /** Отмеченные пункты: `"t" + hash(текст пункта)` → true. */
  tasksDone: Record<string, true>;
  /** Пользователь поставил или снял галочку. */
  onTask: (key: string, done: boolean) => void;
}

export interface EnhanceResult {
  /** Блоки с `data-key` в порядке документа. */
  anchors: HTMLElement[];
  /** Слов главы до начала `anchors[i]`. */
  wordsBefore: number[];
  /** Слов в `anchors[i]` (его собственный текст, без вложенных списков). */
  words: number[];
}

const BLOCK_SELECTOR = 'p, li, h3, h4, blockquote';

/** Собственный текст блока: без вложенных списков и колоды, пробелы схлопнуты. */
export function ownText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const x of Array.from(clone.querySelectorAll('ul, ol, .deck'))) x.remove();
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Ключ блока для позиции чтения и отметок: первая буква тега + hash(собственный текст), либо `null`. */
export function blockKey(el: Element): string | null {
  if (!el.matches(BLOCK_SELECTOR) || el.closest('.deck')) return null;
  const parent = el.parentElement;
  if (el.tagName === 'P' && parent && (parent.tagName === 'LI' || parent.tagName === 'BLOCKQUOTE')) return null;
  const text = ownText(el);
  if (text.length < 2) return null;
  return el.tagName.charAt(0).toLowerCase() + hash(text);
}

/** Нужен каждому чекбоксу, чтобы назвать его текстом пункта (`aria-labelledby`). */
let taskSeq = 0;

function wrapTables(root: HTMLElement): void {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    // Прокручиваемая область должна быть достижима с клавиатуры.
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Таблица');
    table.replaceWith(wrap);
    wrap.append(table);
  }
}

function openLinksExternally(root: HTMLElement): void {
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }
}

function buildDecks(root: HTMLElement): void {
  for (const code of Array.from(root.querySelectorAll('pre > code'))) {
    if (!/language-cards/.test(code.className)) continue;
    const cards = parseCards(code.textContent ?? '');
    if (cards.length) code.parentElement!.replaceWith(buildDeck(cards));
  }
}

function isCheckbox(n: Element | null): n is HTMLInputElement {
  return !!n && n.tagName === 'INPUT' && (n as HTMLInputElement).type === 'checkbox';
}

function buildTasks(root: HTMLElement, ctx: EnhanceContext): void {
  for (const li of Array.from(root.querySelectorAll('li'))) {
    // В плотном списке чекбокс лежит прямо в li, в «рыхлом» — в его первом абзаце.
    const p = Array.from(li.children).find((c) => c.tagName === 'P') ?? null;
    let box = Array.from(li.children).find(isCheckbox) ?? null;
    if (!box && p) box = Array.from(p.children).find(isCheckbox) ?? null;
    if (!box) continue;

    const holder: Element = box.parentElement === li ? li : p!;
    const tx = document.createElement('span');
    tx.className = 'tx';
    tx.id = `task-${++taskSeq}`;
    for (const n of Array.from(holder.childNodes)) {
      if (n !== box && !(n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName))) tx.append(n);
    }
    box.remove();
    if (holder !== li) holder.remove();

    // Зона нажатия 44×44 — у обёртки; сам чекбокс невидим, рисует его .task-box (markdown.css).
    const label = document.createElement('label');
    label.className = 'task-check';
    const mark = document.createElement('span');
    mark.className = 'task-box';
    mark.setAttribute('aria-hidden', 'true');
    label.append(box, mark);
    li.classList.add('task');
    li.prepend(label, tx);

    const key = 't' + hash((tx.textContent ?? '').replace(/\s+/g, ' ').trim());
    box.removeAttribute('disabled');
    box.checked = ctx.tasksDone[key] === true;
    box.setAttribute('aria-labelledby', tx.id);
    li.classList.toggle('done', box.checked);
    box.addEventListener('change', () => {
      li.classList.toggle('done', box.checked);
      ctx.onTask(key, box.checked);
    });
  }
}

function assignKeys(root: HTMLElement): HTMLElement[] {
  // data-key из сырого HTML книги ключом блока быть не должен.
  for (const e of Array.from(root.querySelectorAll('[data-key]'))) e.removeAttribute('data-key');
  const anchors: HTMLElement[] = [];
  for (const b of Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    const key = blockKey(b);
    if (!key) continue;
    b.dataset.key = key;
    anchors.push(b);
  }
  return anchors;
}

export function enhanceChapter(root: HTMLElement, ctx: EnhanceContext): EnhanceResult {
  wrapTables(root);
  openLinksExternally(root);
  buildDecks(root);
  buildTasks(root, ctx);
  const anchors = assignKeys(root);

  // Накопленные суммы слов считаются один раз: позиция чтения → прочитанные слова (spec §8.4).
  const words = anchors.map((a) => countWords(ownText(a)));
  const wordsBefore: number[] = [];
  let sum = 0;
  for (const w of words) {
    wordsBefore.push(sum);
    sum += w;
  }
  return { anchors, wordsBefore, words };
}
