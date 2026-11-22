/** Время чтения (spec §9): минуты = max(1, ceil(слова / скорость)). */

export const DEFAULT_WPM = 180;

export function minutesFor(words: number, wpm = DEFAULT_WPM): number {
  return Math.max(1, Math.ceil(words / wpm));
}

/** «26 мин» с неразрывным пробелом. */
export function minutesLabel(words: number, wpm?: number): string {
  return `${minutesFor(words, wpm)} мин`;
}

/** Фильтр «короткие / средние / длинные»: ≤ 10 минут / ≤ 30 / больше. */
export function lengthBucket(words: number, wpm?: number): 'short' | 'medium' | 'long' {
  const m = minutesFor(words, wpm);
  if (m <= 10) return 'short';
  if (m <= 30) return 'medium';
  return 'long';
}
