/** Карточки и задачи в тексте книги. Разбор карточек — перенос `parseCards` из старого приложения. */

/** Текст блока ```cards → пары вопрос/ответ. Продолжения строк склеиваются через пробел. */
export function parseCards(text: string): { q: string; a: string }[] {
  const cards: { q: string; a: string }[] = [];
  let cur: { q: string; a: string } | null = null;
  let field: 'q' | 'a' | null = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(Q|В|Вопрос)\s*[:：]\s*(.*)$/i))) {
      cur = { q: m[2], a: '' };
      cards.push(cur);
      field = 'q';
    } else if ((m = line.match(/^(A|О|Ответ)\s*[:：]\s*(.*)$/i)) && cur) {
      cur.a = m[2];
      field = 'a';
    } else if (line && cur && field) {
      cur[field] += (cur[field] ? ' ' : '') + line;
    }
  }
  return cards.filter((c) => c.q);
}

/** Число пар Q/A по строкам `Q:` / `В:` (так считало старое приложение). */
export function countCards(md: string): number {
  return (String(md).match(/^\s*(Q|В)\s*:/gm) || []).length;
}

/** Число пунктов `- [ ]` / `- [x]`. */
export function countTasks(md: string): number {
  return (String(md).match(/^\s*[-*] \[[ xX]\]/gm) || []).length;
}
