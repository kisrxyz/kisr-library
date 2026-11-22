import { describe, expect, it } from 'vitest';
import {
  countWords,
  formatDate,
  hash,
  makeBookId,
  noOrphanDash,
  normalizeForSearch,
  normalizeTitle,
  pad2,
  plainText,
  plural,
  slug,
} from './text';

describe('hash', () => {
  it('совпадает с djb2 → base36 старого приложения', () => {
    expect(hash('Привет, мир')).toBe('5v995x');
    expect(hash('')).toBe('45h');
    expect(hash('abc')).toBe('3772q3');
  });
});

describe('slug', () => {
  it('транслитерирует и обрезает до 40 символов', () => {
    expect(slug('Как реально заработать в 2026: глубокий разбор без инфоцыган')).toBe(
      'kak-realno-zarabotat-v-2026-glubokiy-raz',
    );
    expect(slug('Стоицизм: как жить твёрдо')).toBe('stoitsizm-kak-zhit-tverdo');
  });
  it('знает казахские буквы', () => {
    expect(slug('Қазақ тілі және әліпби')).toBe('kazak-tili-zhane-alipbi');
  });
  it('пустая строка и мусор дают item', () => {
    expect(slug('!!!')).toBe('item');
    expect(slug('')).toBe('item');
  });
  it('учитывает свой максимум и не оставляет дефис на конце', () => {
    expect(slug('abc def ghi', 4)).toBe('abc');
  });
});

describe('makeBookId', () => {
  it('slug + время в base36', () => {
    expect(makeBookId('Вредно ли бегать', 1794890055494)).toBe('vredno-li-begat-mwk772h2');
  });
  it('по умолчанию берёт текущее время', () => {
    expect(makeBookId('Тест')).toMatch(/^test-[0-9a-z]+$/);
  });
});

describe('countWords', () => {
  it('считает буквы и цифры, знаки и тире не считает', () => {
    expect(countWords('Привет, мир! 2026 год — время C++ и ёжиков')).toBe(8);
    expect(countWords('')).toBe(0);
  });
});

describe('plural', () => {
  it('склоняет по-русски', () => {
    expect(plural(1, 'глава', 'главы', 'глав')).toBe('глава');
    expect(plural(3, 'глава', 'главы', 'глав')).toBe('главы');
    expect(plural(11, 'глава', 'главы', 'глав')).toBe('глав');
    expect(plural(22, 'глава', 'главы', 'глав')).toBe('главы');
    expect(plural(0, 'глава', 'главы', 'глав')).toBe('глав');
    expect(plural(111, 'глава', 'главы', 'глав')).toBe('глав');
  });
});

describe('pad2', () => {
  it('дополняет нулём', () => {
    expect(pad2(1)).toBe('01');
    expect(pad2(12)).toBe('12');
    expect(pad2(123)).toBe('123');
  });
});

describe('plainText', () => {
  it('убирает разметку, карточки и чекбоксы', () => {
    const md = '```cards\nQ: Что?\nA: Это\n```\n- [ ] шаг\n**жирный** [ссылка](https://x.y) > цитата';
    const out = plainText(md);
    expect(out).not.toMatch(/[`*>\[\]]/);
    expect(out).toContain('Что?');
    expect(out).toContain('шаг');
    expect(out).toContain('ссылка');
    expect(out).not.toContain('https');
  });
  it('убирает маркеры списка в начале строк, пустые строки между абзацами остаются', () => {
    expect(plainText('Стоики:\n- Сенека\n  - Эпиктет\n* Марк Аврелий\n+ Зенон\n• Клеанф\n\nДальше.')).toBe(
      'Стоики:\nСенека\nЭпиктет\nМарк Аврелий\nЗенон\nКлеанф\n\nДальше.',
    );
  });
  it('тире прямой речи, минус перед числом и дефис внутри строки не трогает', () => {
    expect(plainText('— Привет, — сказал он.\n-5 градусов\nсеверо-запад - ветер')).toBe('— Привет, — сказал он.\n-5 градусов\nсеверо-запад - ветер');
  });
});

describe('normalizeForSearch / normalizeTitle', () => {
  it('нижний регистр, ё→е, без разметки, пробелы схлопнуты', () => {
    expect(normalizeForSearch('  **Твёрдый**   _ЧАЙ_ | `код` > цитата # ')).toBe('твердый чай код цитата');
  });
  it('маркеры списка в начале строк не считаются — как в plainText', () => {
    expect(normalizeForSearch('- Сенека\n- Эпиктет')).toBe('сенека эпиктет');
    expect(normalizeForSearch('— Привет')).toBe('— привет');
  });
  it('название сравнивается без пунктуации', () => {
    expect(normalizeTitle('Стоицизм: как жить ТВЁРДО!')).toBe('стоицизм как жить твердо');
    expect(normalizeTitle('Стоицизм — как жить твердо')).toBe('стоицизм как жить твердо');
  });
});

describe('noOrphanDash', () => {
  it('пробел перед тире — неразрывный: тире не начинает строку', () => {
    expect(noOrphanDash('Дейл Карнеги — шпаргалка')).toBe('Дейл Карнеги — шпаргалка');
    expect(noOrphanDash('А — б — в')).toBe('А — б — в');
  });
  it('без тире и с дефисом — как было', () => {
    expect(noOrphanDash('Северо-запад')).toBe('Северо-запад');
    expect(noOrphanDash('Стоицизм')).toBe('Стоицизм');
  });
});

describe('formatDate', () => {
  it('день и короткий месяц по-русски', () => {
    expect(formatDate(new Date(2026, 10, 17, 12).getTime())).toBe('17 нояб.');
  });
});
