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

  it('«Списком» показывает все карточки и прячет перемешивание; «По одной» возвращает', () => {
    mount();
    const list = btn('Показать все карточки списком');
    expect(list.getAttribute('aria-pressed')).toBe('false');
    list.click();
    expect(deck.querySelectorAll('.deck-list details')).toHaveLength(3);
    expect(deck.querySelector('.deck-list summary')!.textContent).toBe('Первый вопрос');
    expect(deck.querySelector('.deck-list details p')!.textContent).toBe('Первый ответ');
    expect(deck.querySelector('button.flash')).toBeNull();
    expect(btn('Перемешать карточки').hidden).toBe(true);
    const back = btn('Показывать по одной');
    expect(back.getAttribute('aria-pressed')).toBe('true');
    back.click();
    expect(deck.querySelector('button.flash')).not.toBeNull();
    expect(btn('Перемешать карточки').hidden).toBe(false);
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
