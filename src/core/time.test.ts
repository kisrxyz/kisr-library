import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import { DEFAULT_WPM, lengthBucket, minutesFor, minutesLabel } from './time';

describe('minutesFor', () => {
  it('max(1, ceil(слов / скорость))', () => {
    expect(minutesFor(0)).toBe(1);
    expect(minutesFor(180)).toBe(1);
    expect(minutesFor(181)).toBe(2);
    expect(minutesFor(4581)).toBe(26);
    expect(minutesFor(8966)).toBe(50);
  });
  it('учитывает свою скорость', () => {
    expect(minutesFor(600, 300)).toBe(2);
  });
});

describe('minutesLabel', () => {
  it('с неразрывным пробелом', () => {
    expect(minutesLabel(4581)).toBe('26\u00A0мин');
    expect(minutesLabel(600, 300)).toBe('2\u00A0мин');
  });
});

describe('lengthBucket', () => {
  it('короткая ≤10 мин, средняя ≤30, длинная больше', () => {
    expect(lengthBucket(1800)).toBe('short');
    expect(lengthBucket(1801)).toBe('medium');
    expect(lengthBucket(5400)).toBe('medium');
    expect(lengthBucket(5401)).toBe('long');
  });
});

describe('DEFAULT_WPM', () => {
  it('равен скорости из настроек по умолчанию', () => {
    expect(DEFAULT_WPM).toBe(180);
    expect(DEFAULT_SETTINGS.wpm).toBe(DEFAULT_WPM);
  });
});
