import { describe, expect, it } from 'vitest';
import { countCards, countTasks, parseCards } from './cards';

describe('parseCards', () => {
  it('разбирает пары Q/A и В/О, склеивает продолжения строк', () => {
    expect(parseCards('Q: Что такое HRV?\nA: Разброс интервалов\nмежду ударами\n\nВ: Второй?\nО: Да')).toEqual([
      { q: 'Что такое HRV?', a: 'Разброс интервалов между ударами' },
      { q: 'Второй?', a: 'Да' },
    ]);
  });
  it('понимает «Вопрос:/Ответ:» и полноширинное двоеточие', () => {
    expect(parseCards('Вопрос： Раз?\nОтвет: Два')).toEqual([{ q: 'Раз?', a: 'Два' }]);
  });
  it('отбрасывает карточки без вопроса и текст до первой карточки', () => {
    expect(parseCards('мусор\nA: ответ без вопроса\nQ:\nA: пусто')).toEqual([]);
  });
});

describe('countCards', () => {
  it('считает строки Q: и В:', () => {
    expect(countCards('Q: а\nA: б\n\n  В: в\nО: г\nA: не считается')).toBe(2);
    expect(countCards('нет карточек')).toBe(0);
  });
});

describe('countTasks', () => {
  it('считает пункты с чекбоксами', () => {
    expect(countTasks('- [ ] один\n- [x] два\n* [ ] три\n- обычный')).toBe(3);
    expect(countTasks('- [X] большая X')).toBe(1);
    expect(countTasks('')).toBe(0);
  });
});
