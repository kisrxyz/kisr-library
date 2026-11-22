/**
 * Парсер книги. Перенос 1:1 функций старого приложения (migration/old-artifact.html,
 * `normalizeMd` и связанные): главы должны делиться ровно так же. Сверх старого: отброс мусора
 * до шапки, поля `part` и `level`, предупреждения, `splitBooks`.
 * Контракт формата — docs/book-format.md, spec §7.1.
 */
import { countCards } from './cards';
import { countWords, plainText } from './text';
import type { BookMeta } from './types';

export interface ParsedChapter {
  title: string;
  md: string;
}

export interface ParsedBook {
  title: string;
  /** Пустая строка, если в шапке раздела нет; `buildBook` заменит её на «Разное». */
  category: string;
  tags: string[];
  summary: string;
  source: string;
  level?: string;
  part?: { n: number; of?: number };
  chapters: ParsedChapter[];
  warnings: string[];
}

type FrontValue = string | string[];

/** Шапка книги: `---` + строка `title:` в начале строки. */
const HEADER_START = /^---[ \t]*\n[ \t]*title[ \t]*:/im;
/** Сколько символов мусора перед шапкой прощаем. */
const PREAMBLE_LIMIT = 600;

/** Значение шапки как строка (массив склеивается через запятую). */
function str(v: FrontValue | undefined): string {
  if (v === undefined) return '';
  return (Array.isArray(v) ? v.join(', ') : String(v)).trim();
}

interface Fence {
  ch: string;
  len: number;
  info: string;
}

/** Строка-забор Markdown: три и больше ` или ~, затем необязательное слово (язык). */
function fenceOf(line: string): Fence | null {
  const m = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/);
  return m ? { ch: m[1][0], len: m[1].length, info: m[2] } : null;
}

/** Обёртка всей книги: забор без языка или с `markdown` / `md`. */
const isWrapperFence = (f: Fence | null): f is Fence => !!f && /^(markdown|md)?$/i.test(f.info);

/** Строка k — начало шапки: `---`, а под ней `title:`. */
function isHeaderAt(lines: string[], k: number): boolean {
  return /^---[ \t]*$/.test(lines[k]) && /^[ \t]*title[ \t]*:/i.test(lines[k + 1] ?? '');
}

/** Индекс шапки, которая идёт сразу после строки i (пустые строки между ними прощаем), иначе -1. */
function headerAfter(lines: string[], i: number): number {
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  return j < lines.length && isHeaderAt(lines, j) ? j : -1;
}

/**
 * Снимает обёртку ```markdown (или ````markdown, ~~~) вокруг книги: открывашку над шапкой и закрывашку.
 * Остальное остаётся: в обёртке могут быть блоки ```cards, а после неё — фраза вроде
 * «Хочешь, сделаю продолжение?».
 *
 * Идёт по строкам как Markdown-разборщик: помнит, внутри обёртки ли он и внутри ли вложенного блока.
 * Открывашка — забор без языка (или `markdown`/`md`), за которым сразу шапка. Закрывашка — первый
 * забор без языка, не закрывающий вложенный блок и не короче открывашки (так находятся и ```, и ````).
 * Если обёртку не закрыли и дальше открылась новая, прежняя просто снимается.
 *
 * `all = false`: только обёртка первой шапки (вставка одной книги, шапка в первых 600 символах).
 * `all = true`: обёртки у всех шапок (несколько книг в одной вставке, в общем или в разных заборах).
 */
function unwrapFences(s: string, all: boolean): string {
  const lines = s.split('\n');
  if (!all && /^---[ \t]*$/.test(lines[0])) return s; // книга начинается с шапки: обёртки нет
  const offsets: number[] = [];
  let sum = 0;
  for (const line of lines) {
    offsets.push(sum);
    sum += line.length + 1;
  }

  const drop: number[] = [];
  let wrapper: Fence | null = null;
  let inner: Fence | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!all && !wrapper && isHeaderAt(lines, i)) break; // первая шапка без обёртки
    const f = fenceOf(lines[i]);
    if (!f) continue;
    if (inner) {
      if (f.ch === inner.ch && f.info === '' && f.len >= inner.len) inner = null;
      continue;
    }
    if (wrapper && f.ch === wrapper.ch && f.info === '' && f.len >= wrapper.len) {
      drop.push(i);
      wrapper = null;
      if (!all) break;
      continue;
    }
    const h = isWrapperFence(f) ? headerAfter(lines, i) : -1;
    if (h >= 0) {
      if (!all && offsets[h] > PREAMBLE_LIMIT) return s; // шапка слишком далеко: это не вставка с обёрткой
      drop.push(i);
      wrapper = f;
    } else {
      inner = f; // обычный блок кода (```cards и т. п.)
    }
  }
  for (const i of drop) lines[i] = '';
  return lines.join('\n');
}

/** Весь текст в обёртке ```markdown … ``` → внутренность (забор любой длины, ` или ~). */
function cleanModelMd(t: string): string {
  let s = String(t || '').trim();
  const lines = s.split('\n');
  const open = fenceOf(lines[0]);
  const close = fenceOf(lines[lines.length - 1]);
  const wrapped =
    lines.length >= 3 &&
    isWrapperFence(open) &&
    close !== null &&
    close.ch === open.ch &&
    close.info === '' &&
    close.len >= open.len;
  if (wrapped && !closedBeforeNextBook(lines, open)) s = lines.slice(1, -1).join('\n').trim();
  return s;
}

/**
 * Обёртку, открытую в первой строке, закрыли раньше конца текста, а после неё начинается ещё одна
 * книга (шапка): значит, последний забор текста принадлежит уже ей, а не первой обёртке.
 */
function closedBeforeNextBook(lines: string[], opener: Fence): boolean {
  let inner: Fence | null = null;
  for (let i = 1; i < lines.length - 1; i++) {
    const f = fenceOf(lines[i]);
    if (!f) continue;
    if (inner) {
      if (f.ch === inner.ch && f.info === '' && f.len >= inner.len) inner = null;
    } else if (f.ch === opener.ch && f.info === '' && f.len >= opener.len) {
      return lines.slice(i + 1).some((_, j) => isHeaderAt(lines, i + 1 + j));
    } else {
      inner = f;
    }
  }
  return false;
}

/** Отбрасывает всё до шапки, если шапка начинается в первых 600 символах (spec §7.1). */
function stripPreamble(s: string): string {
  if (/^---[ \t]*(\n|$)/.test(s)) return s;
  const m = HEADER_START.exec(s);
  if (!m || m.index > PREAMBLE_LIMIT) return s;
  return s.slice(m.index).trim();
}

/** BOM, \r, обёртка ```markdown, мусор до шапки. */
function prepare(raw: string, all = false): string {
  let s = cleanModelMd(String(raw || '').replace(/\r/g, ''));
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return stripPreamble(unwrapFences(s, all));
}

export function parseFront(md: string): { meta: Record<string, FrontValue>; body: string } {
  const s = prepare(md);
  const m = s.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  if (!m) return { meta: {}, body: s };
  const meta: Record<string, FrontValue> = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.*)$/);
    if (!mm) continue;
    const v = mm[2].trim();
    meta[mm[1].toLowerCase()] = /^\[.*\]$/.test(v)
      ? v
          .slice(1, -1)
          .split(',')
          .map((x) => x.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: s.slice(m[0].length).trim() };
}

/** Делит по `## `. Текст до первой — «Вступление». */
function splitSections(body: string): ParsedChapter[] {
  const text = String(body).trim();
  const chunks = text.split(/^##\s+/m);
  const out: ParsedChapter[] = [];
  const intro = (chunks.shift() ?? '').trim();
  if (intro) out.push({ title: 'Вступление', md: intro });
  for (const c of chunks) {
    const nl = c.indexOf('\n');
    const title = (nl < 0 ? c : c.slice(0, nl)).trim();
    const md = nl < 0 ? '' : c.slice(nl + 1).trim();
    out.push({ title, md });
  }
  if (!out.length) out.push({ title: 'Текст', md: text });
  return out;
}

/** Английские заголовки моделей → русские. */
const HEADS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(tl;?\s?dr|tldr|summary|executive summary)\s*:?$/i, () => 'Коротко'],
  [/^key (findings|takeaways|points|insights)\s*:?$/i, () => 'Главное'],
  [/^(details|detailed analysis|deep dive|analysis)\s*:?$/i, () => 'Подробно'],
  [/^recommendations?\s*:?\s*(.*)$/i, (m) => ('Что делать ' + m[1]).trim()],
  [/^(caveats|limitations|caveats (and|&) limitations)\s*:?$/i, () => 'Оговорки'],
  [/^(sources|references|bibliography)\s*:?$/i, () => 'Источники'],
  [/^(conclusions?|bottom line)\s*:?$/i, () => 'Итог'],
  [/^(next steps|action plan|action items)\s*:?$/i, () => 'Что сделать'],
  [/^(overview|introduction)\s*:?$/i, () => 'Обзор'],
];

function ruTitle(t: string): string {
  const s = String(t || '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]*:$/, '')
    .trim();
  for (const [re, f] of HEADS) {
    const m = s.match(re);
    if (m) return f(m);
  }
  return s;
}

/** Срезает `---` (и `***`, `___`) в начале и конце главы. */
function cleanSecMd(md: string): string {
  return String(md || '')
    .replace(/^(?:[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*\n+)+/, '')
    .replace(/(?:\n+[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*)+\s*$/, '')
    .trim();
}

/** Описание из первого содержательного абзаца: целые предложения до `max` символов. */
function smartSummary(md: string, max = 220): string {
  const paras = plainText(md)
    .split(/\n\s*\n/)
    .map((x) =>
      x
        .replace(/^\s*(?:[-–•]|\d+[.)])\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  const p = paras.find((x) => x.length > 30) || paras.find(Boolean) || '';
  if (p.length <= max) return p;
  let out = '';
  for (const s of p.match(/[^.!?…]+[.!?…]+["»)]?(\s+|$)/g) || []) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  out = out.trim();
  if (out.length >= 60) return out;
  const cut = p.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—–-]\s*$/, '') + '…';
}

/** Длинную главу с `###` делит по ним: мелкие куски склеивает (до ~250 слов, максимум 1000). */
function splitLong(x: ParsedChapter): ParsedChapter[] {
  const parts = x.md.split(/^###\s+/m);
  const head = (parts.shift() ?? '').trim();
  const sub = parts.map((p) => {
    const nl = p.indexOf('\n');
    return {
      title: (nl < 0 ? p : p.slice(0, nl)).replace(/\*\*/g, '').trim(),
      md: (nl < 0 ? '' : p.slice(nl + 1)).replace(/^####\s+/gm, '### ').trim(),
    };
  });
  if (!sub.length) return [x];
  const res: ParsedChapter[] = [];
  if (head && countWords(head) >= 40) res.push({ title: x.title, md: head });
  else if (head) sub[0].md = head + '\n\n' + sub[0].md;
  let cur: { title: string; md: string; w: number } | null = null;
  for (const s of sub) {
    const w = countWords(s.md);
    if (cur && (cur.w < 250 || w < 150) && cur.w + w <= 1000) {
      cur.md += '\n\n### ' + s.title + '\n\n' + s.md;
      cur.w += w;
    } else {
      if (cur) res.push({ title: cur.title, md: cur.md });
      cur = { title: s.title, md: s.md, w };
    }
  }
  if (cur) res.push({ title: cur.title, md: cur.md });
  return res;
}

/** `part: 2/3` → {n: 2, of: 3}; `part: 2` → {n: 2}. Хвостовой `# комментарий` из шаблона отбрасывается. */
function parsePart(v: FrontValue | undefined): ParsedBook['part'] {
  const m = str(v)
    .replace(/\s+#.*$/, '')
    .match(/^(\d+)\s*(?:(?:\/|из)\s*(\d+))?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 1) return undefined;
  const of = m[2] ? Number(m[2]) : 0;
  return of >= n ? { n, of } : { n };
}

export function parseBook(raw: string, opts: { fileName?: string } = {}): ParsedBook {
  const warnings: string[] = [];
  const { meta, body: framed } = parseFront(raw);
  const hasHeader = Object.keys(meta).length > 0;

  // Строка-подпись вида «Автор · @имя» сразу после шапки
  let body = framed.replace(/^[^\n]{0,60}·[ \t]*@[\w.-]+[^\n]*\n+/, '').trim();
  let h1 = '';
  let h1From = '';
  const h1m = body.match(/^#\s+(.+)\n/);
  if (h1m) {
    h1 = h1m[1].replace(/\*\*/g, '').trim();
    h1From = 'заголовка «#»';
    body = body.slice(h1m[0].length).trim();
  }
  if (!meta.title && !h1) {
    const bm = body.match(/^\*\*([^*\n]{3,90})\*\*[ \t]*\n\n/);
    if (bm && /^##\s/m.test(body)) {
      h1 = bm[1].trim();
      h1From = 'жирной строки перед первой главой';
      body = body.slice(bm[0].length).trim();
    }
  }
  if (/^#\s/m.test(body)) body = body.replace(/^#\s+/gm, '## ');
  body = body.replace(/(^|\n)(Источники|Литература|Sources|References)[ \t]*:[ \t]*(?=\n)/g, '$1## Источники');
  if (!/^##\s/m.test(body.replace(/^## Источники$/m, ''))) {
    if (/^###\s/m.test(body)) body = body.replace(/^###\s+/gm, '## ').replace(/^####\s+/gm, '### ');
    else
      body = body.replace(
        /(^|\n\n)\*\*([^*\n]{2,80}?)\*\*[ \t]*:?[ \t]*(?=\n)/g,
        (_m0: string, pre: string, t: string) => pre + '## ' + t.trim(),
      );
  }

  let secs = splitSections(body)
    .map((x) => ({ title: ruTitle(x.title), md: cleanSecMd(x.md) }))
    .filter((x) => x.md || x.title);

  // Ни одного `##` (и ни `###`, ни жирных строк): весь текст — одна глава «Текст» (book-format.md, п. 5).
  // Старое приложение назвало бы её «Вступление»; контракт и наш тест требуют «Текст».
  if (secs.length === 1 && secs[0].title === 'Вступление' && !/^##\s/m.test(body)) {
    secs = [{ title: 'Текст', md: secs[0].md }];
    warnings.push('Нет глав (##): весь текст — одна глава');
  } else if (secs.length > 1 && secs[0].title === 'Вступление' && countWords(secs[0].md) < 40) {
    secs[1] = { title: secs[1].title, md: secs[0].md + '\n\n' + secs[1].md };
    secs.shift();
  }

  const chapters: ParsedChapter[] = [];
  for (const x of secs) {
    if (countWords(x.md) > 1200 && /^###\s/m.test(x.md)) chapters.push(...splitLong(x));
    else chapters.push(x);
  }
  if (!chapters.length) chapters.push({ title: 'Текст', md: body });

  const tags = Array.isArray(meta.tags)
    ? meta.tags
    : meta.tags
      ? String(meta.tags)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  const fileTitle = opts.fileName
    ? opts.fileName
        .replace(/\.(md|markdown|txt)$/i, '')
        .replace(/[_]+/g, ' ')
        .trim()
    : '';
  const title = (str(meta.title) || h1 || fileTitle || 'Без названия').trim();

  if (!str(meta.title)) {
    const from = h1 ? h1From : fileTitle ? 'имени файла' : '';
    const tail = from ? `название взято из ${from}` : 'название не найдено, поставлено «Без названия»';
    warnings.unshift(`${hasHeader ? 'В шапке нет названия' : 'Нет шапки'}: ${tail}`);
  }

  const sumSrc = chapters.find((x) => countWords(x.md) > 15) || chapters[0];
  const book: ParsedBook = {
    title,
    category: str(meta.category),
    tags,
    summary: (str(meta.summary) || smartSummary(sumSrc ? sumSrc.md : '')).trim(),
    source: str(meta.source),
    chapters,
    warnings,
  };
  const level = str(meta.level).replace(/\s+#.*$/, '').trim();
  if (level) book.level = level;
  const part = parsePart(meta.part);
  if (part) book.part = part;

  // Карточки стоят в последней части: у не последней (или с неизвестным числом частей) их может не быть.
  const nonFinalPart = !!part && (!part.of || part.n < part.of);
  if (!nonFinalPart && !chapters.some((c) => countCards(c.md) > 0)) warnings.push('Карточек нет');
  return book;
}

/** Несколько книг в одной вставке: новая книга начинается с `---` + `title:` в начале строки. */
export function splitBooks(raw: string): string[] {
  const s = prepare(raw, true);
  if (!s) return [];
  const starts: number[] = [];
  const re = new RegExp(HEADER_START.source, 'gim');
  for (let m = re.exec(s); m; m = re.exec(s)) starts.push(m.index);
  if (starts.length < 2) return [s];
  // Первая книга забирает всё, что стоит до её шапки: парсер сам решит, что с этим делать.
  return starts.map((_, i) => s.slice(i === 0 ? 0 : starts[i], starts[i + 1] ?? s.length).trim());
}

/** Книга → текст в формате `book-format.md` (обратная сборка для экспорта и проверок). */
export function reassemble(
  meta: Pick<BookMeta, 'title' | 'category' | 'tags' | 'summary' | 'source'> & { level?: string },
  chapters: ParsedChapter[],
): string {
  const one = (v: string | undefined) => String(v ?? '').replace(/\s*\n\s*/g, ' ').trim();
  const head = [
    '---',
    `title: ${one(meta.title)}`,
    `category: ${one(meta.category)}`,
    `tags: [${(meta.tags || [])
      .map((t) => one(t).replace(/,/g, ' '))
      .filter(Boolean)
      .join(', ')}]`,
    `summary: ${one(meta.summary)}`,
    `source: ${one(meta.source)}`,
  ];
  if (meta.level) head.push(`level: ${one(meta.level)}`);
  head.push('---');
  const body = chapters
    .map((s, i) => (i === 0 && s.title === 'Вступление' ? s.md : '## ' + s.title + '\n\n' + s.md))
    .join('\n\n');
  return head.map((l) => l.trimEnd()).join('\n') + '\n' + body;
}
