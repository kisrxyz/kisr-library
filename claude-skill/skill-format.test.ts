/**
 * Скилл Claude и приложение должны понимать друг друга: то, что скилл учит писать, парсер читает без предупреждений.
 * Здесь проверяются: синтетическая книга «по скиллу», шаблон из самого SKILL.md, шапка скилла,
 * совпадение project-instructions.md с телом скилла и свежесть zip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { countCards, countTasks, parseCards } from '../src/core/cards';
import { parseBook } from '../src/core/parse';

const skillPath = join(__dirname, 'kisr-library-razbor', 'SKILL.md');
const instructionsPath = join(__dirname, 'project-instructions.md');
const zipPath = join(__dirname, 'kisr-library-razbor.zip');

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const skill = read(skillPath);

/** Тело скилла — всё после YAML-шапки. */
const skillBody = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^\n+/, '');

/** Синтетическая книга ровно в формате скилла: шапка, вступление, «Коротко», 2 раздела, «Что делать», «Карточки», «Источники». */
const EXAMPLE_BOOK = `---
title: Как работает интервальное повторение
category: Учёба
tags: [память, обучение, привычки]
summary: Почему повторения с растущими паузами запоминаются надёжнее зубрёжки и как составить такой график.
source: Эббингауз, 1885; Cepeda и др., 2006
level: базовый
---
Забывание идёт не по прямой: сначала быстро, потом всё медленнее. Поэтому повторять выгодно в момент, когда след в памяти ещё не стёрся, но уже ослаб.

## Коротко
- 🟢 Повторения с растущими паузами запоминаются лучше, чем та же работа за один подход.
- 🟢 Лучшая пауза между повторами — примерно 10–20% от срока, на который нужно помнить.
- 🟡 Точные графики для разных людей пока изучены слабо.
- Начни с 4 повторов: через день, через 3 дня, через неделю, через месяц.

## Почему мы забываем
### Кривая забывания
Герман Эббингауз в 1885 году заучивал бессмысленные слоги и проверял себя через разные промежутки времени. За первый час он терял больше половины выученного, а дальше потери замедлялись.

Пример: ты выучил 20 слов за вечер. Утром помнишь около 8, через неделю без повторов — 4–5. Эти числа учебные, чтобы показать форму кривой, а не результат исследования.

### Что с этим делать
Каждое повторение «выпрямляет» кривую: после него забывание идёт медленнее. Поэтому второй повтор можно отложить дольше первого.

## Как расставить повторения
Большой эксперимент Cepeda и др. (2006) свёл вместе больше 300 результатов исследований. Вывод: чем дольше нужно помнить, тем длиннее должна быть пауза между повторами. Проще: хочешь помнить год — не повторяй всё за одну неделю.

| Срок памяти | Первая пауза |
|---|---|
| 1 неделя | 1 день |
| 1 месяц | 3–4 дня |
| 1 год | 3–4 недели |

Пример: готовишься к экзамену через месяц — повтори материал через 3 дня, потом через 10 и накануне.

## Что делать
- [ ] Выбери 10 самых нужных фактов и запиши их в виде вопросов.
- [ ] Повтори их сегодня, завтра и через 3 дня.
- [ ] Поставь напоминание на повтор через неделю.

## Карточки
\`\`\`cards
Q: Что такое кривая забывания?
A: График того, как быстро выученное стирается из памяти: сначала резко, потом медленно.

Q: Кто первым измерил забывание?
A: Герман Эббингауз, 1885 год.

Q: Какую долю выученного человек теряет за первый час по Эббингаузу?
A: Больше половины.

Q: Что даёт повторение?
A: Замедляет дальнейшее забывание.

Q: Как связаны срок памяти и пауза между повторами?
A: Чем дольше нужно помнить, тем длиннее пауза.

Q: Какая пауза нужна, чтобы помнить месяц?
A: Первое повторение через 3–4 дня.

Q: Почему зубрёжка за один вечер работает хуже?
A: Нет пауз, на которых память успевает ослабнуть и закрепиться заново.

Q: С чего начать, если нет времени планировать?
A: Повторить через день, через 3 дня, через неделю и через месяц.
\`\`\`

## Источники
- [Ebbinghaus, 1885 (перевод 1913). Memory: A Contribution to Experimental Psychology — Classics in the History of Psychology](https://psychclassics.yorku.ca/Ebbinghaus/index.htm)
- [Cepeda и др., 2006. Distributed practice in verbal recall tasks — Psychological Bulletin](https://doi.org/10.1037/0033-2909.132.3.354)
`;

describe('книга в формате скилла', () => {
  const book = parseBook(EXAMPLE_BOOK);

  it('разбирается без предупреждений', () => {
    expect(book.warnings).toEqual([]);
  });

  it('шапка читается целиком', () => {
    expect(book.title).toBe('Как работает интервальное повторение');
    expect(book.category).toBe('Учёба');
    expect(book.tags).toEqual(['память', 'обучение', 'привычки']);
    expect(book.summary).toMatch(/^Почему повторения/);
    expect(book.source).toBe('Эббингауз, 1885; Cepeda и др., 2006');
    expect(book.level).toBe('базовый');
  });

  it('главы идут как заголовки ## (короткое вступление приклеивается к «Коротко»)', () => {
    expect(book.chapters.map((c) => c.title)).toEqual([
      'Коротко',
      'Почему мы забываем',
      'Как расставить повторения',
      'Что делать',
      'Карточки',
      'Источники',
    ]);
    expect(book.chapters[0].md.startsWith('Забывание идёт не по прямой')).toBe(true);
  });

  it('карточки считаются: не меньше 8', () => {
    const cards = book.chapters.reduce((sum, c) => sum + countCards(c.md), 0);
    expect(cards).toBeGreaterThanOrEqual(8);
    expect(parseCards(book.chapters[4].md).length).toBe(cards);
  });

  it('задания с галочками находятся', () => {
    expect(book.chapters.reduce((sum, c) => sum + countTasks(c.md), 0)).toBe(3);
  });
});

describe('шаблон внутри SKILL.md', () => {
  /** Первый блок ````markdown … ```` (четыре забора: внутри есть свои ```cards). */
  const template = skill.match(/````markdown\n([\s\S]*?)\n````/)?.[1] ?? '';
  const parsed = parseBook(template);

  it('найден и начинается с шапки', () => {
    expect(template.startsWith('---\ntitle:')).toBe(true);
  });

  it('парсер видит шапку, предупреждения «Нет шапки» нет', () => {
    expect(parsed.warnings.filter((w) => /нет шапки|в шапке нет названия/i.test(w))).toEqual([]);
    expect(parsed.title).toBe('Название, до 70 символов');
  });

  it('содержит обязательные разделы шаблона', () => {
    const titles = parsed.chapters.map((c) => c.title);
    for (const t of ['Коротко', 'Что делать', 'Оговорки', 'Карточки', 'Источники']) expect(titles).toContain(t);
  });
});

describe('книга частями (шапка части из SKILL.md)', () => {
  /** Пример шапки второй части из трёх: первый блок ```text … ``` в разделе «Длинная книга». */
  const partHeader = skill.match(/```text\n([\s\S]*?)\n```/)?.[1] ?? '';
  const section =
    '\n\nПовтор через неделю закрепляет то, что осталось после первого дня. Пример: слова, выученные во вторник, в следующий вторник узнаёшь заметно легче.\n';

  it('пример шапки найден и содержит part: 2/3', () => {
    expect(partHeader.startsWith('---\ntitle:')).toBe(true);
    expect(partHeader).toMatch(/^part: 2\/3$/m);
  });

  it('часть 2/3 по примеру из скилла (без карточек и источников) разбирается без предупреждений', () => {
    const book = parseBook(partHeader + section);
    expect(book.title).toBe('Как работает память');
    expect(book.part).toEqual({ n: 2, of: 3 });
    expect(book.chapters.map((c) => c.title)).toEqual(['Как расставить повторения']);
    expect(book.warnings).toEqual([]);
  });

  it('последняя часть 3/3 с карточками тоже без предупреждений', () => {
    const cards =
      '\n\n## Карточки\n```cards\nQ: Что такое кривая забывания?\nA: График потери выученного со временем.\n```\n';
    const book = parseBook(partHeader.replace('part: 2/3', 'part: 3/3') + section + cards);
    expect(book.part).toEqual({ n: 3, of: 3 });
    expect(book.warnings).toEqual([]);
  });
});

describe('SKILL.md', () => {
  it('YAML-шапка: то же имя, что у старого скилла, и описание по-русски', () => {
    const head = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    expect(head).toMatch(/^name: kisr-library-razbor$/m);
    const description = head.match(/^description: "(.*)"$/m)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(100);
    expect(description.length).toBeLessThanOrEqual(1024);
    for (const word of ['Kisr Library', 'исследовани', 'карточ', 'вставк']) expect(description).toContain(word);
  });

  it('описание привязано к библиотеке: не срабатывает на обычное «разбери тему»', () => {
    const description = skill.match(/^description: "(.*)"$/m)?.[1] ?? '';
    expect(description).toContain('«для библиотеки»');
    expect(description).toContain('«для Kisr Library»');
    expect(description).toMatch(/Не используй для обычного «разбери тему»/);
    expect(description).not.toMatch(/Используй, когда просят разобрать тему/);
  });

  it('учит правилам выдачи: только книга, длинная — файлом или частями', () => {
    expect(skill).toContain('part: N/M');
    expect(skill).toContain('<slug>.md');
    expect(skill).toContain('5000');
    expect(skill).toContain('прямо в чате'); // просят текст в чате, а не файлом — частями
  });

  it('чек-лист перед отправкой различает режимы: целая книга, части, файл, несколько книг', () => {
    const checklist = skill.slice(skill.indexOf('### Проверь перед отправкой'));
    expect(checklist).not.toBe('');
    for (const mode of ['Книга целиком', 'Первая часть', 'Средняя часть', 'Последняя часть', 'Режим файла', 'Несколько книг'])
      expect(checklist).toContain(mode);
  });

  it('не тащит старое: базу данных артефакта, pack.py, пути А/Б, адрес артефакта', () => {
    expect(skill).not.toMatch(/db_(list|get|write)|pack\.py|Путь [АБ]|claude\.ai\/artifact|ToolSearch|articles\//);
  });
});

describe('project-instructions.md', () => {
  const instructions = read(instructionsPath);

  it('первая строка — заголовок инструкций проекта', () => {
    expect(instructions.split('\n')[0]).toBe(
      'Инструкции проекта Kisr Library: каждый ответ в этом проекте — книга для приложения',
    );
  });

  it('дальше — то же тело, что в SKILL.md, без YAML-шапки', () => {
    expect(instructions).not.toMatch(/^---\nname:/);
    expect(instructions.split('\n').slice(2).join('\n')).toBe(skillBody(skill));
  });
});

describe('zip для claude.ai', () => {
  it('лежит рядом и содержит ровно kisr-library-razbor/SKILL.md, свежий', () => {
    expect(existsSync(zipPath)).toBe(true);
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
    expect(Object.keys(files)).toEqual(['kisr-library-razbor/SKILL.md']);
    expect(strFromU8(files['kisr-library-razbor/SKILL.md'])).toBe(skill);
  });
});
