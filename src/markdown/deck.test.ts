// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toasts } from '../ui/toast-state';
import { buildDeck } from './deck';

const CARDS = [
  { q: 'Первый вопрос', a: 'Первый ответ' },
  { q: 'Второй вопрос', a: 'Второй ответ' },
  { q: 'Третий вопрос', a: '' },
];

let deck: HTMLElement;

function mount(cards = CARDS): HTMLElement {
  deck = buildDeck(cards);
  document.body.append(deck);
  return deck;
}

afterEach(() => {
  deck?.remove();
  toasts.value = [];
  vi.restoreAllMocks();
});

const counter = () => deck.querySelector('output')!;
const card = () => deck.querySelector<HTMLButtonElement>('button.flash')!;
/** Виден ли элемент: ни он, ни его предки не скрыты атрибутом hidden. */
const visible = (el: Element) => !el.closest('[hidden]');
const btn = (label: string) =>
  Array.from(deck.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  )!;

describe('buildDeck', () => {
  it('показывает заголовок, вопрос, подсказку и счётчик в aria-live', () => {
    mount();
    expect(deck.classList.contains('deck')).toBe(true);
    expect(deck.querySelector('.deck-top strong')!.textContent).toBe('Карточки · 3');
    expect(card().querySelector('.lbl')!.textContent).toBe('Вопрос');
    expect(card().querySelector('.q')!.textContent).toBe('Первый вопрос');
    expect(card().querySelector('.tap')!.textContent).toBe('Нажми, чтобы увидеть ответ');
    expect(card().querySelector('.a')).toBeNull();
    expect(counter().textContent).toBe('1 / 3');
    expect(counter().getAttribute('aria-live')).toBe('polite');
  });

  it('нажатие переворачивает карточку и обратно', () => {
    mount();
    card().click();
    expect(card().querySelector('.lbl')!.textContent).toBe('Ответ');
    expect(card().querySelector('.a')!.textContent).toBe('Первый ответ');
    expect(card().querySelector('.tap')).toBeNull();
    expect(card().getAttribute('aria-expanded')).toBe('true');
    card().click();
    expect(card().querySelector('.lbl')!.textContent).toBe('Вопрос');
    expect(card().getAttribute('aria-expanded')).toBe('false');
  });

  it('«Дальше» и «Назад» ходят по кругу и закрывают ответ', () => {
    mount();
    card().click();
    btn('Дальше').click();
    expect(counter().textContent).toBe('2 / 3');
    expect(card().querySelector('.q')!.textContent).toBe('Второй вопрос');
    expect(card().querySelector('.lbl')!.textContent).toBe('Вопрос');
    btn('Дальше').click();
    btn('Дальше').click();
    expect(counter().textContent).toBe('1 / 3');
    btn('Назад').click();
    expect(counter().textContent).toBe('3 / 3');
    expect(card().querySelector('.q')!.textContent).toBe('Третий вопрос');
  });

  it('пустой ответ показывается тире', () => {
    mount();
    btn('Назад').click();
    card().click();
    expect(card().querySelector('.a')!.textContent).toBe('—');
  });

  it('«Перемешать» оставляет те же карточки, возвращает на первую и говорит об этом тостом', () => {
    mount();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    btn('Дальше').click();
    btn('Перемешать карточки').click();
    expect(counter().textContent).toBe('1 / 3');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(card().querySelector('.q')!.textContent!);
      btn('Дальше').click();
    }
    expect(seen.sort()).toEqual(CARDS.map((c) => c.q).sort());
    expect(toasts.value.map((t) => t.text)).toContain('Карточки перемешаны');
  });

  it('«Списком» показывает все карточки и прячет перемешивание; повторное нажатие возвращает', () => {
    mount();
    const list = btn('Списком');
    expect(list.getAttribute('aria-pressed')).toBe('false');
    list.click();
    expect(deck.querySelectorAll('.deck-list details')).toHaveLength(3);
    expect(deck.querySelector('.deck-list summary')!.textContent).toBe('Первый вопрос');
    expect(deck.querySelector('.deck-list details p')!.textContent).toBe('Первый ответ');
    expect(visible(card())).toBe(false);
    expect(visible(deck.querySelector('.deck-list')!)).toBe(true);
    expect(btn('Перемешать карточки').hidden).toBe(true);
    // Подпись постоянная, состояние — только в aria-pressed
    expect(list.getAttribute('aria-label')).toBe('Списком');
    expect(list.getAttribute('aria-pressed')).toBe('true');
    list.click();
    expect(list.getAttribute('aria-label')).toBe('Списком');
    expect(list.getAttribute('aria-pressed')).toBe('false');
    expect(visible(card())).toBe(true);
    expect(visible(deck.querySelector('.deck-list')!)).toBe(false);
    expect(btn('Перемешать карточки').hidden).toBe(false);
  });

  it('порядок после перемешивания виден и в списке', () => {
    mount();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    btn('Перемешать карточки').click();
    const shuffled = [...CARDS];
    // тот же перебор, что в колоде: Fisher-Yates с random() === 0
    const order = shuffled.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) [order[i], order[0]] = [order[0], order[i]];
    btn('Списком').click();
    const summaries = Array.from(deck.querySelectorAll('.deck-list summary')).map((s) => s.textContent);
    expect(summaries).toEqual(order.map((i) => CARDS[i].q));
  });

  describe('фокус и живой счётчик', () => {
    it('после «Дальше» и «Назад» фокус остаётся на нажатой кнопке', () => {
      mount();
      const next = btn('Дальше');
      next.focus();
      expect(document.activeElement).toBe(next);
      next.click();
      expect(document.activeElement).toBe(next);
      const prev = btn('Назад');
      prev.focus();
      prev.click();
      expect(document.activeElement).toBe(prev);
    });

    it('переворот карточки оставляет фокус на карточке', () => {
      mount();
      const c = card();
      c.focus();
      c.click();
      expect(document.activeElement).toBe(c);
      c.click();
      expect(document.activeElement).toBe(c);
    });

    it('«Перемешать» и «Списком» оставляют фокус на своих кнопках', () => {
      mount();
      const shuffle = btn('Перемешать карточки');
      shuffle.focus();
      shuffle.click();
      expect(document.activeElement).toBe(shuffle);
      const list = btn('Списком');
      list.focus();
      list.click();
      expect(document.activeElement).toBe(list);
      list.click();
      expect(document.activeElement).toBe(list);
    });

    it('карточка, кнопки и счётчик остаются на месте: ни разу не отсоединяются при действиях', () => {
      mount();
      const watched = [card(), btn('Назад'), btn('Дальше'), counter(), btn('Перемешать карточки'), btn('Списком')];
      const parents = watched.map((n) => n.parentElement);
      const observer = new MutationObserver(() => {});
      observer.observe(deck, { childList: true, subtree: true });
      const removed = () => observer.takeRecords().flatMap((r) => Array.from(r.removedNodes));

      card().click();
      btn('Дальше').click();
      btn('Дальше').click();
      btn('Назад').click();
      btn('Перемешать карточки').click();
      btn('Списком').click();
      btn('Списком').click();
      card().click();

      const gone = removed();
      for (const n of watched) expect(gone, n.className || n.tagName).not.toContain(n);
      expect(watched.map((n) => n.parentElement)).toEqual(parents);
      observer.disconnect();
    });

    it('счётчик — один и тот же узел с aria-live, меняется только его текст', () => {
      mount();
      const out = counter();
      btn('Дальше').click();
      expect(counter()).toBe(out);
      expect(out.isConnected).toBe(true);
      expect(out.textContent).toBe('2 / 3');
      expect(out.getAttribute('aria-live')).toBe('polite');
    });
  });

  it('текст карточек вставляется как текст, не как разметка', () => {
    mount([{ q: '<img src=x onerror=alert(1)>', a: '<b>жирно</b>' }]);
    expect(deck.querySelector('img')).toBeNull();
    expect(card().querySelector('.q')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('кнопки управления используют общий стиль .btn (≥ 44px по Button.css)', () => {
    mount();
    const buttons = Array.from(deck.querySelectorAll('button')).filter((b) => !b.classList.contains('flash'));
    expect(buttons.length).toBe(4);
    for (const b of buttons) expect(b.classList.contains('btn')).toBe(true);
  });

  it('пустой набор не падает', () => {
    expect(() => buildDeck([])).not.toThrow();
  });
});
