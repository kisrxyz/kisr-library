import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countWords } from './text';
import { parseBook, parseFront, reassemble, splitBooks } from './parse';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const titles = (raw: string) => parseBook(raw).chapters.map((c) => c.title);

/** Текст из n одинаковых слов: нужен, чтобы набрать объём главы. */
const words = (n: number, w = 'слово') => Array.from({ length: n }, () => w).join(' ');

describe('parseBook: книга по шаблону', () => {
  const book = parseBook(fixture('full.md'));

  it('берёт поля из шапки', () => {
    expect(book.title).toBe('Как заварить хороший чай');
    expect(book.category).toBe('Быт');
    expect(book.tags).toEqual(['чай', 'кухня', 'привычки']);
    expect(book.summary).toMatch(/^Короткий разбор/);
    expect(book.source).toBe('общие справочники по чаю');
    expect(book.level).toBe('базовый');
    expect(book.part).toBeUndefined();
  });

  it('делит на главы по ##, текст до первой — «Вступление»', () => {
    expect(book.chapters.map((c) => c.title)).toEqual([
      'Вступление',
      'Коротко',
      'Раздел один',
      'Раздел два',
      'Карточки',
      'Источники',
    ]);
    expect(book.chapters[0].md.startsWith('Чай кажется')).toBe(true);
    expect(book.chapters[2].md).toContain('### Вода');
  });

  it('предупреждений нет', () => {
    expect(book.warnings).toEqual([]);
  });
});

describe('parseBook: вступление', () => {
  it('короткое (< 40 слов) приклеивается к первой ##-главе', () => {
    const raw = `---\ntitle: Т\n---\nКороткое вступление.\n\n## Первая\n${words(60)}\n\n## Вторая\n${words(60)}`;
    const b = parseBook(raw);
    expect(b.chapters.map((c) => c.title)).toEqual(['Первая', 'Вторая']);
    expect(b.chapters[0].md.startsWith('Короткое вступление.\n\n')).toBe(true);
  });
  it('длинное (≥ 40 слов) остаётся главой', () => {
    const raw = `---\ntitle: Т\n---\n${words(45)}\n\n## Первая\n${words(60)}`;
    expect(titles(raw)).toEqual(['Вступление', 'Первая']);
  });
});

describe('parseBook: без шапки', () => {
  it('название из «# Заголовка», раздел пустой, есть предупреждение', () => {
    const b = parseBook(fixture('no-header.md'));
    expect(b.title).toBe('Заметки о садовых инструментах');
    expect(b.category).toBe('');
    expect(b.warnings.some((w) => w.includes('Нет шапки'))).toBe(true);
    // вступление короче 40 слов приклеилось к «Уходу»
    expect(b.chapters.map((c) => c.title)).toEqual(['Уход', 'Хранение']);
  });
  it('описание собирается из первого содержательного абзаца', () => {
    const b = parseBook(fixture('no-header.md'));
    expect(b.summary).toMatch(/^Садовые инструменты служат дольше/);
  });
  it('название из имени файла, если больше неоткуда', () => {
    const b = parseBook('## Глава\nтекст текст', { fileName: 'моя_книга.md' });
    expect(b.title).toBe('моя книга');
    expect(b.warnings.some((w) => w.includes('Нет шапки') && w.includes('имени файла'))).toBe(true);
  });
  it('совсем без названия — «Без названия»', () => {
    const b = parseBook('## Глава\nтекст текст');
    expect(b.title).toBe('Без названия');
    expect(b.warnings.some((w) => w.includes('Нет шапки'))).toBe(true);
  });
  it('название из жирной строки перед первой главой', () => {
    const b = parseBook('**Жирное название книги**\n\n## Глава\nтекст текст');
    expect(b.title).toBe('Жирное название книги');
  });
  it('шапка есть, но без названия — другое предупреждение', () => {
    const b = parseBook('---\ncategory: К\n---\n# Из заголовка\n\n## Глава\nтекст');
    expect(b.title).toBe('Из заголовка');
    expect(b.category).toBe('К');
    expect(b.warnings.some((w) => w.includes('Нет шапки'))).toBe(false);
    expect(b.warnings.some((w) => w.includes('нет названия'))).toBe(true);
  });
});

describe('parseBook: мусор вокруг шапки', () => {
  it('отбрасывает вступительную фразу и обёртку ```markdown (CRLF, NBSP)', () => {
    const raw =
      'Вот разбор:\r\n\r\n```markdown\r\n---\r\ntitle: Тест\r\n---\r\nВступление…\r\n## Глава\r\nтекст текст\r\n```\r\n';
    const b = parseBook(raw);
    expect(b.title).toBe('Тест');
    expect(b.chapters.length).toBeGreaterThanOrEqual(1);
    expect(b.chapters.length).toBeLessThanOrEqual(2);
    for (const c of b.chapters) expect(c.md).not.toContain('```');
    expect(b.chapters.at(-1)!.title).toBe('Глава');
    expect(b.chapters.at(-1)!.md).toContain('текст текст');
  });
  it('хвост «Хочешь, сделаю продолжение?» остаётся внутри последней главы', () => {
    const raw =
      'Вот разбор:\n\n```markdown\n---\ntitle: Тест\n---\n## Глава\nтекст текст\n```\nХочешь, сделаю продолжение?';
    const b = parseBook(raw);
    expect(b.chapters.map((c) => c.title)).toEqual(['Глава']);
    expect(b.chapters[0].md).toContain('Хочешь, сделаю продолжение?');
    expect(b.chapters[0].md).not.toContain('```');
  });
  it('хвост без обёртки тоже не становится главой', () => {
    const raw = `---\ntitle: Т\n---\n## Глава\n${words(50)}\n\nХочешь, сделаю продолжение?`;
    const b = parseBook(raw);
    expect(b.chapters.map((c) => c.title)).toEqual(['Глава']);
    expect(b.chapters[0].md.endsWith('Хочешь, сделаю продолжение?')).toBe(true);
  });
  it('внутренний блок ```cards обёртка не трогает', () => {
    const raw = 'Держи:\n```md\n---\ntitle: Т\n---\n## Карточки\n```cards\nQ: а\nA: б\n```\n```\n';
    const b = parseBook(raw);
    expect(b.chapters[0].md).toContain('```cards');
    expect(b.chapters[0].md.match(/```/g)).toHaveLength(2);
  });
  it('целая книга в обёртке без вступительной фразы', () => {
    const b = parseBook('```markdown\n---\ntitle: Т\n---\n## Глава\nтекст\n```');
    expect(b.title).toBe('Т');
    expect(b.chapters[0].md).toBe('текст');
  });
  it('BOM в начале не мешает', () => {
    const b = parseBook('﻿---\ntitle: Т\n---\n## Глава\nтекст');
    expect(b.title).toBe('Т');
  });
  it('шапка дальше 600 символов от начала — не шапка', () => {
    const raw = `${'мусор '.repeat(150)}\n\n---\ntitle: Далеко\n---\n## Глава\nтекст`;
    expect(parseBook(raw).title).not.toBe('Далеко');
  });
});

describe('parseBook: обёртки разной формы', () => {
  const cards = '```cards\nQ: а\nA: б\n```';
  const innerFences = (md: string) => md.match(/^`{3,}.*$/gm) ?? [];

  it('обёртка из четырёх ` с блоком ```cards внутри и вопросом после', () => {
    const raw = `Вот разбор:\n\n\`\`\`\`markdown\n---\ntitle: Т\n---\n## Глава\nтекст\n${cards}\n\`\`\`\`\nХочешь, сделаю продолжение?`;
    const b = parseBook(raw);
    expect(b.title).toBe('Т');
    expect(b.chapters.map((c) => c.title)).toEqual(['Глава']);
    const md = b.chapters[0].md;
    expect(innerFences(md)).toEqual(['```cards', '```']);
    expect(md).toContain('Q: а\nA: б');
    expect(md.endsWith('Хочешь, сделаю продолжение?')).toBe(true);
    expect(md).not.toContain('````');
  });
  it('пустая строка между открывашкой и шапкой', () => {
    const raw = '```markdown\n\n---\ntitle: Т\n---\n## Глава\nтекст\n```\nХочешь?';
    const b = parseBook(raw);
    expect(b.title).toBe('Т');
    expect(innerFences(b.chapters[0].md)).toEqual([]);
    expect(b.chapters[0].md.endsWith('Хочешь?')).toBe(true);
  });
  it('обёртка ~~~markdown', () => {
    const raw = `Держи:\n~~~markdown\n---\ntitle: Т\n---\n## Глава\nтекст\n${cards}\n~~~\n`;
    const b = parseBook(raw);
    expect(b.title).toBe('Т');
    expect(b.chapters[0].md).not.toContain('~~~');
    expect(innerFences(b.chapters[0].md)).toEqual(['```cards', '```']);
  });
  it('вся книга в обёртке из четырёх ` без шапки и без вступительной фразы', () => {
    const b = parseBook(`\`\`\`\`markdown\n## Глава\nтекст\n${cards}\n\`\`\`\``);
    expect(b.chapters.map((c) => c.title)).toEqual(['Глава']);
    expect(innerFences(b.chapters[0].md)).toEqual(['```cards', '```']);
  });
  it('вся книга в обёртке, закрывашка с хвостом и пустой строкой', () => {
    const b = parseBook('```markdown\n\n---\ntitle: Т\n---\n## Глава\nтекст\n```\n\nХочешь?\n');
    expect(b.title).toBe('Т');
    expect(b.chapters[0].md).toBe('текст\n\n\nХочешь?');
  });
  it('незакрытая обёртка: открывашка снимается, блок ```cards цел', () => {
    const b = parseBook(`Держи:\n\`\`\`markdown\n---\ntitle: Т\n---\n## Глава\n${cards}`);
    expect(b.title).toBe('Т');
    expect(innerFences(b.chapters[0].md)).toEqual(['```cards', '```']);
  });
  it('пример книги в блоке ```markdown внутри главы не трогаем', () => {
    const raw = '---\ntitle: Т\n---\n## Пример\nВот шаблон:\n```markdown\n---\ntitle: Образец\n---\nтекст\n```\nВсё.';
    const b = parseBook(raw);
    expect(b.title).toBe('Т');
    expect(b.chapters[0].md).toContain('```markdown\n---\ntitle: Образец\n---\nтекст\n```');
  });
});

describe('parseBook: заголовки', () => {
  it('переводит английские', () => {
    const raw = `---\ntitle: Т\n---\n## TL;DR\n${words(50)}\n\n## Sources\nx\n\n## Key findings\n${words(50)}`;
    expect(titles(raw)).toEqual(['Коротко', 'Источники', 'Главное']);
  });
  it('«Recommendations: …» сохраняет хвост', () => {
    const raw = '---\ntitle: Т\n---\n## Recommendations для всех\nтекст';
    expect(titles(raw)).toEqual(['Что делать для всех']);
  });
  it('«#» внутри текста становятся «##»', () => {
    const raw = `---\ntitle: Т\n---\n${words(45)}\n\n# Первая\n${words(50)}\n\n# Вторая\n${words(50)}`;
    expect(titles(raw)).toEqual(['Вступление', 'Первая', 'Вторая']);
  });
  it('«# Заголовок» в самом начале — это название, а не глава', () => {
    const b = parseBook(`---\ncategory: К\n---\n# Название\n\n## Глава\n${words(50)}`);
    expect(b.title).toBe('Название');
    expect(b.chapters.map((c) => c.title)).toEqual(['Глава']);
  });
  it('строка «Источники:» становится главой', () => {
    const raw = `---\ntitle: Т\n---\n## Глава\n${words(50)}\n\nИсточники:\n- [а](https://a.b)`;
    expect(titles(raw)).toEqual(['Глава', 'Источники']);
  });
  it('--- в начале и конце глав срезаются', () => {
    const raw = '---\ntitle: Т\n---\n## А\n\n---\n\nтекст\n\n---\n\n## Б\nещё';
    const b = parseBook(raw);
    expect(b.chapters.map((c) => c.md)).toEqual(['текст', 'ещё']);
  });
});

describe('parseBook: нет ##', () => {
  it('главы из ###', () => {
    const raw = `---\ntitle: Т\n---\n### Первая\n${words(50)}\n\n### Вторая\n${words(50)}`;
    const b = parseBook(raw);
    expect(b.chapters.map((c) => c.title)).toEqual(['Первая', 'Вторая']);
    expect(b.warnings.some((w) => w.includes('Нет глав'))).toBe(false);
  });
  it('главы из строк **Заголовок**', () => {
    const raw = `---\ntitle: Т\n---\n**Первая**\n${words(50)}\n\n**Вторая**\n${words(50)}`;
    expect(titles(raw)).toEqual(['Первая', 'Вторая']);
  });
  it('нет ни того ни другого — одна глава «Текст» и предупреждение', () => {
    const b = parseBook('---\ntitle: Т\n---\nПросто текст без заголовков, но с мыслью.');
    expect(b.chapters).toEqual([{ title: 'Текст', md: 'Просто текст без заголовков, но с мыслью.' }]);
    expect(b.warnings).toContain('Нет глав (##): весь текст — одна глава');
  });
});

describe('parseBook: длинные главы', () => {
  it('глава на 1500 слов с тремя ### делится на части не больше 1000 слов', () => {
    const sub = (n: number) => `### Часть ${n}\n${words(500, `слово${n}`)}`;
    const raw = `---\ntitle: Т\n---\n## Длинная\n${sub(1)}\n\n${sub(2)}\n\n${sub(3)}`;
    const b = parseBook(raw);
    expect(b.chapters.length).toBeGreaterThan(1);
    for (const c of b.chapters) expect(countWords(c.md)).toBeLessThanOrEqual(1000);
    // слова не потерялись: у частей добавились только заголовки ###
    expect(b.chapters.reduce((s, c) => s + countWords(c.md), 0)).toBeGreaterThanOrEqual(1500);
  });
  it('глава длиннее 1200 слов без ### остаётся целой', () => {
    const raw = `---\ntitle: Т\n---\n## Длинная\n${words(1300)}`;
    expect(parseBook(raw).chapters).toHaveLength(1);
  });
});

describe('parseBook: part и level', () => {
  it('part: 2/3', () => {
    expect(parseBook('---\ntitle: Т\npart: 2/3\n---\n## Г\nт').part).toEqual({ n: 2, of: 3 });
  });
  it('part: 2', () => {
    expect(parseBook('---\ntitle: Т\npart: 2\n---\n## Г\nт').part).toEqual({ n: 2 });
  });
  it('нечисловой part игнорируется', () => {
    expect(parseBook('---\ntitle: Т\npart: вторая\n---\n## Г\nт').part).toBeUndefined();
  });
  it('level не обязателен', () => {
    expect(parseBook('---\ntitle: Т\n---\n## Г\nт').level).toBeUndefined();
  });
});

describe('parseBook: предупреждения', () => {
  it('«Карточек нет»', () => {
    const b = parseBook('---\ntitle: Т\ncategory: К\n---\n## Г\nтекст');
    expect(b.warnings).toContain('Карточек нет');
  });
  describe('«Карточек нет» и книга частями', () => {
    const part = (p: string) => parseBook(`---\ntitle: Т\ncategory: К\npart: ${p}\n---\n## Г\nтекст`).warnings;
    it('не последняя часть (1/3, 2/3) без карточек — без предупреждения', () => {
      expect(part('1/3')).not.toContain('Карточек нет');
      expect(part('2/3')).not.toContain('Карточек нет');
    });
    it('часть без числа частей (part: 1) — без предупреждения: последняя часть неизвестна', () => {
      expect(part('1')).not.toContain('Карточек нет');
    });
    it('последняя часть (3/3) без карточек — предупреждение остаётся', () => {
      expect(part('3/3')).toContain('Карточек нет');
    });
    it('часть 1/1 — это последняя часть: предупреждение остаётся', () => {
      expect(part('1/1')).toContain('Карточек нет');
    });
    it('не последняя часть с карточками тоже без предупреждения', () => {
      const raw = '---\ntitle: Т\npart: 1/2\n---\n## Карточки\n```cards\nQ: а\nA: б\n```';
      expect(parseBook(raw).warnings).toEqual([]);
    });
  });
  it('на пустом тексте не падает', () => {
    const b = parseBook('');
    expect(b.chapters.length).toBeGreaterThanOrEqual(1);
    expect(b.title).toBe('Без названия');
  });
});

describe('parseFront', () => {
  it('списки в [..], кавычки и регистр ключей', () => {
    const { meta, body } = parseFront('---\nTitle: "Книга"\ntags: [а, "б", в]\n---\nтекст');
    expect(meta.title).toBe('Книга');
    expect(meta.tags).toEqual(['а', 'б', 'в']);
    expect(body).toBe('текст');
  });
  it('нет шапки — пустые метаданные и весь текст', () => {
    expect(parseFront('просто текст')).toEqual({ meta: {}, body: 'просто текст' });
  });
});

describe('splitBooks', () => {
  it('две книги подряд → 2 строки', () => {
    const parts = splitBooks(fixture('two-books.md'));
    expect(parts).toHaveLength(2);
    expect(parseBook(parts[0]).title).toBe('Первая синтетическая книга');
    expect(parseBook(parts[1]).title).toBe('Вторая синтетическая книга');
    expect(parseBook(parts[1]).part).toEqual({ n: 2, of: 3 });
    expect(parseBook(parts[0]).chapters.at(-1)!.md.endsWith('Текст главы А.')).toBe(true);
  });
  it('одна книга → 1 строка', () => {
    expect(splitBooks(fixture('full.md'))).toHaveLength(1);
  });
  it('текст без шапки → 1 строка, пустой → 0', () => {
    expect(splitBooks(fixture('no-header.md'))).toHaveLength(1);
    expect(splitBooks('  \n ')).toHaveLength(0);
  });
  describe('каждая книга в своём заборе', () => {
    const cards = '```cards\nQ: а\nA: б\n```';
    const fences = (md: string) => md.match(/^`{3,}.*$/gm) ?? [];
    const check = (parts: string[], titlesExpected: string[]) => {
      expect(parts).toHaveLength(titlesExpected.length);
      parts.forEach((p, i) => {
        const b = parseBook(p);
        expect(b.title).toBe(titlesExpected[i]);
        // кроме настоящих блоков ```cards ни одного забора в тексте глав
        for (const c of b.chapters) expect(fences(c.md)).toEqual(fences(c.md).length ? ['```cards', '```'] : []);
      });
    };

    it('три ` у обеих, у каждой блок ```cards, между ними болтовня', () => {
      const raw =
        `Первая часть:\n\n\`\`\`markdown\n---\ntitle: А\n---\n## Г\nтекст а\n${cards}\n\`\`\`\n\n` +
        `А вот вторая:\n\n\`\`\`markdown\n---\ntitle: Б\npart: 2/2\n---\n## Г\nтекст б\n${cards}\n\`\`\`\n`;
      const parts = splitBooks(raw);
      check(parts, ['А', 'Б']);
      expect(parseBook(parts[1]).part).toEqual({ n: 2, of: 2 });
    });
    it('четыре ` у обеих и пустая строка после открывашки', () => {
      const raw =
        `\`\`\`\`markdown\n\n---\ntitle: А\n---\n## Г\nтекст а\n${cards}\n\`\`\`\`\n\n` +
        `\`\`\`\`markdown\n---\ntitle: Б\n---\n## Г\nтекст б\n${cards}\n\`\`\`\`\nХочешь третью?`;
      const parts = splitBooks(raw);
      check(parts, ['А', 'Б']);
      expect(parseBook(parts[1]).chapters[0].md.endsWith('Хочешь третью?')).toBe(true);
    });
    it('первая в заборе, вторая без забора, у второй блок ```cards', () => {
      const raw = `\`\`\`markdown\n---\ntitle: А\n---\n## Г\nтекст а\n\`\`\`\n\n---\ntitle: Б\n---\n## Г\nтекст б\n${cards}\n`;
      check(splitBooks(raw), ['А', 'Б']);
    });
    it('первая без забора, вторая в заборе', () => {
      const raw = `---\ntitle: А\n---\n## Г\nтекст а\n${cards}\n\n\`\`\`markdown\n---\ntitle: Б\n---\n## Г\nтекст б\n\`\`\`\n`;
      check(splitBooks(raw), ['А', 'Б']);
    });
    it('первую не закрыли, вторая в заборе', () => {
      const raw = `\`\`\`markdown\n---\ntitle: А\n---\n## Г\nтекст а\n\n\`\`\`markdown\n---\ntitle: Б\n---\n## Г\nтекст б\n\`\`\`\n`;
      check(splitBooks(raw), ['А', 'Б']);
    });
    it('одна обёртка вокруг двух книг (четыре `)', () => {
      const raw = `\`\`\`\`markdown\n---\ntitle: А\n---\n## Г\nтекст а\n${cards}\n\n---\ntitle: Б\n---\n## Г\nтекст б\n${cards}\n\`\`\`\`\n`;
      check(splitBooks(raw), ['А', 'Б']);
    });
  });

  it('две книги в одной обёртке ```markdown', () => {
    const raw = 'Держи:\n```markdown\n---\ntitle: А\n---\n## Г\nтекст а\n\n---\ntitle: Б\n---\n## Г\nтекст б\n```\n';
    const parts = splitBooks(raw);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(parseBook(p).chapters.every((c) => !c.md.includes('```'))).toBe(true);
  });
});

describe('reassemble', () => {
  it('туда-обратно даёт те же главы и поля', () => {
    const b = parseBook(fixture('full.md'));
    const again = parseBook(reassemble(b, b.chapters));
    expect(again.chapters).toEqual(b.chapters);
    expect(again.title).toBe(b.title);
    expect(again.category).toBe(b.category);
    expect(again.tags).toEqual(b.tags);
    expect(again.summary).toBe(b.summary);
    expect(again.source).toBe(b.source);
    expect(again.level).toBe(b.level);
  });
  it('первая глава «Вступление» идёт без заголовка', () => {
    const out = reassemble({ title: 'Т', category: 'К', tags: [], summary: 'С', source: '' }, [
      { title: 'Вступление', md: 'вступление' },
      { title: 'Глава', md: 'текст' },
    ]);
    expect(out).toBe('---\ntitle: Т\ncategory: К\ntags: []\nsummary: С\nsource:\n---\nвступление\n\n## Глава\n\nтекст');
  });
  it('level попадает в шапку только если задан', () => {
    const base = { title: 'Т', category: 'К', tags: ['а', 'б'], summary: 'С', source: 'И' };
    expect(reassemble(base, [])).not.toContain('level:');
    expect(reassemble({ ...base, level: 'средний' }, [])).toContain('level: средний\n');
  });
});

const rawArticles = join(process.cwd(), 'migration', 'raw', 'articles');
const rawSections = join(process.cwd(), 'migration', 'raw', 'sections');

interface RawArticle {
  title: string;
  category: string;
  tags: string[];
  summary: string;
  source: string;
}
interface RawSection {
  articleId: string;
  order: number;
  title: string;
  md: string;
}

describe.skipIf(!existsSync(rawSections) || !existsSync(rawArticles))(
  'совместимость со старым приложением (личные данные, мимо git)',
  () => {
    const articleFiles = existsSync(rawArticles) ? readdirSync(rawArticles).filter((f) => f.endsWith('.json')) : [];
    const sections: RawSection[] = existsSync(rawSections)
      ? readdirSync(rawSections)
          .filter((f) => f.endsWith('.json'))
          .map((f) => JSON.parse(readFileSync(join(rawSections, f), 'utf8')) as RawSection)
      : [];

    it('есть что проверять', () => {
      expect(articleFiles.length).toBeGreaterThan(0);
      expect(sections.length).toBeGreaterThan(0);
    });

    for (const file of articleFiles) {
      it(`${file}: reassemble → parseBook даёт те же главы`, () => {
        const a = JSON.parse(readFileSync(join(rawArticles, file), 'utf8')) as RawArticle;
        const id = file.replace(/\.json$/, '');
        const chapters = sections
          .filter((s) => s.articleId === id)
          .sort((x, y) => x.order - y.order)
          .map((s) => ({ title: s.title, md: s.md }));
        expect(chapters.length).toBeGreaterThan(0);

        const parsed = parseBook(reassemble(a, chapters));
        expect(parsed.chapters.map((c) => c.title)).toEqual(chapters.map((c) => c.title));
        expect(parsed.chapters).toHaveLength(chapters.length);
        expect(parsed.title).toBe(a.title);
      });
    }
  },
);
