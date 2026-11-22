import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORMAT_BLOCK, SIZES, buildPrompt, claudeUrl, type Size } from './prompt';

const base = { topic: 'Как работает память', size: 'medium' as Size, wishes: '', skillInstalled: true, formatBlock: 'F' };

describe('buildPrompt', () => {
  it('со скиллом: короткий запрос с темой в начале и объёмом, без блока формата', () => {
    const p = buildPrompt(base);
    expect(p.startsWith('Разбор для Kisr Library: Как работает память')).toBe(true);
    expect(p).toContain('2000–3500 слов');
    expect(p).not.toContain('F');
  });

  it('без скилла: добавляется блок формата', () => {
    const p = buildPrompt({ ...base, skillInstalled: false });
    expect(p.startsWith('Разбор для Kisr Library: Как работает память')).toBe(true);
    expect(p).toContain('F');
    expect(p).toContain('2000–3500 слов');
  });

  it('пожелания попадают в запрос, пустые — нет', () => {
    expect(buildPrompt({ ...base, wishes: '  для новичка, без формул ' })).toContain('Пожелания: для новичка, без формул');
    expect(buildPrompt(base)).not.toContain('Пожелания');
  });

  it('тема обрезается по краям и схлопывает переносы строк', () => {
    const p = buildPrompt({ ...base, topic: '  Сон\nи память  ' });
    expect(p.split('\n')[0]).toBe('Разбор для Kisr Library: Сон и память');
  });

  it('каждый объём называет свой диапазон слов', () => {
    const words: Record<Size, string> = {
      short: '600–1200 слов',
      medium: '2000–3500 слов',
      long: '4000–6000 слов',
      book: '6000–9000 слов',
    };
    for (const size of Object.keys(words) as Size[]) {
      expect(buildPrompt({ ...base, size })).toContain(words[size]);
    }
  });

  it('«Книга» просит делить на части с part: N/M', () => {
    expect(buildPrompt({ ...base, size: 'book' })).toContain('part: N/M');
    expect(buildPrompt({ ...base, size: 'medium' })).not.toContain('part: N/M');
  });
});

describe('SIZES', () => {
  it('четыре объёма в порядке роста, «Средне» — второй, подписи по-русски', () => {
    expect(SIZES.map((s) => s.value)).toEqual(['short', 'medium', 'long', 'book']);
    expect(SIZES.map((s) => s.label)).toEqual(['Коротко', 'Средне', 'Подробно', 'Книга']);
  });
});

describe('claudeUrl', () => {
  it('короткий запрос → адрес с закодированным текстом', () => {
    expect(claudeUrl('Привет, мир')).toBe(`https://claude.ai/new?q=${encodeURIComponent('Привет, мир')}`);
  });

  it('текст в 7000 символов → null', () => {
    expect(claudeUrl('a'.repeat(7000))).toBeNull();
  });

  it('длина считается по адресу: кириллица в процентном кодировании в 6 раз длиннее', () => {
    expect(claudeUrl('я'.repeat(500))).not.toBeNull(); // ≈ 3 000 знаков адреса
    expect(claudeUrl('я'.repeat(1100))).toBeNull(); // ≈ 6 600 знаков адреса
  });

  it('запрос со скиллом открывается по ссылке, запрос с блоком формата — нет', () => {
    const o = { topic: 'Как работает память', size: 'medium' as Size, wishes: '', formatBlock: FORMAT_BLOCK };
    expect(claudeUrl(buildPrompt({ ...o, skillInstalled: true }))).not.toBeNull();
    expect(claudeUrl(buildPrompt({ ...o, skillInstalled: false }))).toBeNull();
  });
});

describe('FORMAT_BLOCK совпадает с docs/book-format.md', () => {
  const doc = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'book-format.md'), 'utf8').replace(/\r/g, '');

  it('содержит шаблон книги ровно как в документе', () => {
    const template = doc.match(/````markdown\n([\s\S]*?)\n````/)?.[1];
    expect(template).toBeTruthy();
    expect(FORMAT_BLOCK).toContain(template as string);
  });

  it('содержит каждое правило разметки', () => {
    const rules = doc.split('## Правила разметки\n')[1].split('\n## ')[0].trim().split('\n').filter((l) => l.startsWith('- '));
    expect(rules.length).toBeGreaterThan(8);
    for (const rule of rules) expect(FORMAT_BLOCK).toContain(rule);
  });

  it('содержит таблицу объёмов', () => {
    const table = doc.split('## Объёмы\n')[1].split('\n## ')[0].trim().split('\n').filter((l) => l.startsWith('|'));
    expect(table).toHaveLength(6);
    for (const row of table) expect(FORMAT_BLOCK).toContain(row);
  });

  it('не тянет за собой разделы про нормализацию и подсчёты', () => {
    expect(FORMAT_BLOCK).not.toContain('normalizeMd');
    expect(FORMAT_BLOCK).not.toContain('Что приложение прощает');
  });
});
