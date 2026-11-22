/**
 * Текстовые утилиты. Перенос из старого приложения (migration/old-artifact.html, блок helpers):
 * результаты `hash`, `slug`, `countWords`, `plural`, `plainText` должны совпадать с ним побитно,
 * иначе id книг, ключи блоков и счётчики разойдутся с перенесёнными данными.
 */

/** djb2 → base36. `hash('') === '45h'`, `hash('abc') === '3772q3'`. */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Слова: буквы и цифры подряд. */
export function countWords(s: string): number {
  return (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
}

/** Таблица транслитерации (русский + казахские буквы). */
const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

export function slug(s: string, max = 40): string {
  const t = String(s || '')
    .toLowerCase()
    .split('')
    .map((c) => (Object.hasOwn(TR, c) ? TR[c] : c))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return t.slice(0, max).replace(/-+$/, '') || 'item';
}

/** id книги: `slug(title, 40) + "-" + время в base36`. */
export function makeBookId(title: string, now = Date.now()): string {
  return slug(title, 40) + '-' + now.toString(36);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Русское склонение: plural(3, 'глава', 'главы', 'глав') → «главы». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Markdown → простой текст (для описаний и поиска). Порядок замен как в старом приложении. */
export function plainText(md: string): string {
  return String(md)
    .replace(/```cards\n?/g, '')
    .replace(/```\w*\n?/g, '')
    .replace(/^\s*(Q|A|В|О):\s*/gm, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/[#>*_`|]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[ \t]+/g, ' ');
}

/** Для поиска: нижний регистр, ё→е, без знаков разметки, пробелы схлопнуты. */
export function normalizeForSearch(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[#>*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Для сравнения названий: как для поиска, но без пунктуации. */
export function normalizeTitle(s: string): string {
  return normalizeForSearch(s)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «17 нояб.» */
export function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
