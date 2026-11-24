import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/types';
import { appearanceSummary, backupFileName, formatBytes, lastBackupLine, speedOptions, syncStatusLine } from './format';

const NB = '\u00A0';

describe('formatBytes', () => {
  it('мегабайты с одной цифрой после запятой по-русски', () => {
    expect(formatBytes(3.2 * 1024 * 1024)).toBe(`3,2${NB}МБ`);
    expect(formatBytes(12 * 1024 * 1024)).toBe(`12${NB}МБ`);
  });

  it('меньше мегабайта — килобайты, меньше килобайта — байты', () => {
    expect(formatBytes(512 * 1024)).toBe(`512${NB}КБ`);
    expect(formatBytes(900)).toBe(`900${NB}Б`);
    expect(formatBytes(0)).toBe(`0${NB}Б`);
  });

  it('гигабайты и разделитель тысяч', () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe(`1,5${NB}ГБ`);
    expect(formatBytes(1023.99 * 1024 * 1024)).toBe(`1${NB}ГБ`);
    expect(formatBytes(2048 * 1024 * 1024 * 1024)).toBe(`2${NB}048${NB}ГБ`);
  });

  it('мусор не ломает вывод', () => {
    expect(formatBytes(-5)).toBe(`0${NB}Б`);
    expect(formatBytes(Number.NaN)).toBe(`0${NB}Б`);
  });
});

describe('backupFileName', () => {
  it('kisr-library-backup-ГГГГ-ММ-ДД.json по местной дате', () => {
    expect(backupFileName(new Date(2026, 10, 7, 23, 59))).toBe('kisr-library-backup-2026-11-07.json');
    expect(backupFileName(new Date(2026, 0, 31, 0, 1))).toBe('kisr-library-backup-2026-01-31.json');
  });
});

describe('lastBackupLine', () => {
  it('копий не было', () => {
    expect(lastBackupLine(null)).toBe('Копий ещё не было');
  });

  it('«Последняя копия: 17 нояб.»', () => {
    expect(lastBackupLine(new Date(2026, 10, 17, 12).getTime())).toBe('Последняя копия: 17 нояб.');
  });
});

describe('appearanceSummary', () => {
  it('шрифт · размер · тема', () => {
    expect(appearanceSummary({ ...DEFAULT_SETTINGS })).toBe('Literata · 18 · Авто');
    expect(appearanceSummary({ ...DEFAULT_SETTINGS, font: 'sans', fontSize: 21, theme: 'dark' })).toBe('Golos Text · 21 · Тёмная');
    expect(appearanceSummary({ ...DEFAULT_SETTINGS, theme: 'sepia' })).toBe('Literata · 18 · Бумага');
    expect(appearanceSummary({ ...DEFAULT_SETTINGS, theme: 'light', fontSize: 40 })).toBe('Literata · 24 · Светлая');
  });
});

describe('speedOptions', () => {
  it('четыре готовых значения', () => {
    expect(speedOptions(180).map((o) => o.value)).toEqual([150, 180, 220, 260]);
  });

  it('своё значение из восстановленных настроек встаёт на своё место', () => {
    expect(speedOptions(200).map((o) => o.value)).toEqual([150, 180, 200, 220, 260]);
    expect(speedOptions(120).map((o) => o.value)).toEqual([120, 150, 180, 220, 260]);
  });
});

describe('syncStatusLine', () => {
  const now = new Date(2026, 10, 24, 15, 30).getTime();
  const view = { phase: 'idle' as const, repo: 'kisr/kisr-library-data', lastSyncAt: null, error: null, needsToken: false };

  it('время последней синхронизации: сегодня, вчера, дата', () => {
    expect(syncStatusLine({ ...view, lastSyncAt: new Date(2026, 10, 24, 14, 5).getTime() }, now)).toBe('Синхронизировано сегодня в 14:05');
    expect(syncStatusLine({ ...view, lastSyncAt: new Date(2026, 10, 23, 9, 0).getTime() }, now)).toBe('Синхронизировано вчера в 09:00');
    expect(syncStatusLine({ ...view, lastSyncAt: new Date(2026, 10, 17, 21, 40).getTime() }, now)).toMatch(/^Синхронизировано 17 нояб\.? в 21:40$/);
    expect(syncStatusLine(view, now)).toBe('Ещё не синхронизировалось');
  });

  it('идёт проход, нет сети, ошибка', () => {
    expect(syncStatusLine({ ...view, phase: 'syncing' }, now)).toBe('Синхронизирую…');
    expect(syncStatusLine({ ...view, phase: 'offline' }, now)).toBe('Нет сети — продолжу, когда появится');
    expect(syncStatusLine({ ...view, phase: 'error', error: 'Ключ не подходит. Вставь новый' }, now)).toBe('Ключ не подходит. Вставь новый');
  });
});
