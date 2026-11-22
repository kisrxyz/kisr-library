import { describe, expect, it } from 'vitest';
import { CONTEXT } from '../../core/search';
import { chapterLabel, tidyContext } from './SearchResults';

describe('tidyContext', () => {
  it('короткий контекст (начало или конец главы) не трогает', () => {
    expect(tidyContext({ before: 'Жил-был ', after: ' у реки.' })).toEqual({
      before: 'Жил-был ',
      after: ' у реки.',
      cutBefore: false,
      cutAfter: false,
    });
  });

  it('обрезанное слово на краях отбрасывается, края помечены', () => {
    const before = `ьшое слово ${'а '.repeat(24)}`.slice(0, CONTEXT).padEnd(CONTEXT, 'б');
    const after = `${'б '.repeat(26)}неправиль`.slice(0, CONTEXT);
    expect(before).toHaveLength(CONTEXT);
    expect(after).toHaveLength(CONTEXT);
    const tidy = tidyContext({ before, after });
    expect(tidy.cutBefore).toBe(true);
    expect(tidy.cutAfter).toBe(true);
    expect(tidy.before.startsWith('слово ')).toBe(true);
    expect(tidy.after.endsWith('б')).toBe(true);
    expect(tidy.after).not.toContain('непра');
  });

  it('длинный токен без пробелов не режется целиком', () => {
    const after = 'я'.repeat(CONTEXT);
    expect(tidyContext({ before: '', after }).after).toBe(after);
  });
});

describe('chapterLabel', () => {
  it('«Глава N · Название», номер не повторяется, если он уже в названии', () => {
    expect(chapterLabel(3, 'Коротко')).toBe('Глава 3 · Коротко');
    expect(chapterLabel(4, 'Глава 4. Гнев')).toBe('Глава 4. Гнев');
    expect(chapterLabel(2, 'Часть 2')).toBe('Часть 2');
    expect(chapterLabel(5, '')).toBe('Глава 5');
  });
});
