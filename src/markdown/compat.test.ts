// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enhanceChapter } from './enhance';
import { renderMarkdown } from './render';

/*
  Совместимость со старым приложением: ключи абзацев, сохранённые им у владельца, должны находиться
  среди data-key главы после renderMarkdown + enhanceChapter. Тест идёт по реальным данным из migration/
  (их нет в git), поэтому пропускается, если папки нет.
*/
const RAW = join(__dirname, '..', '..', 'migration', 'raw');
const SECTIONS = join(RAW, 'sections');

function keysOf(chapterId: string): string[] {
  const { md } = JSON.parse(readFileSync(join(SECTIONS, `${chapterId}.json`), 'utf8')) as { md: string };
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(md);
  const { anchors } = enhanceChapter(root, { tasksDone: {}, onTask: () => {} });
  return anchors.map((a) => a.dataset.key!);
}

describe.skipIf(!existsSync(SECTIONS))('ключи блоков совпадают с сохранёнными старым приложением', () => {
  const PAIRS: [string, string][] = [
    ['pochemu-ne-poluchaetsya-vyuchit-angliysk-mwkkoblt--01', 'pedkclj'],
    ['pochemu-evrei-kazhutsya-takimi-mogusches-mwkknz6u--01', 'h1xsfv7q'],
    ['carnegie-shpargalka--05', 'p1i6upg5'],
    ['vstuplenie-mwkhjndt--09', 'l1bf2vkx'],
  ];

  it.each(PAIRS)('%s → %s', (chapterId, key) => {
    expect(keysOf(chapterId)).toContain(key);
  });

  it('каждая сохранённая позиция из r-*.json находится в своей главе', () => {
    const dir = join(RAW, 'data', 'users', 'me');
    let checked = 0;
    for (const name of readdirSync(dir).filter((n) => /^r-.*\.json$/.test(n))) {
      const saved = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        articleId?: string;
        order?: number;
        key?: string;
      };
      if (!saved.articleId || !saved.order || !saved.key) continue;
      const chapterId = `${saved.articleId}--${String(saved.order).padStart(2, '0')}`;
      if (!existsSync(join(SECTIONS, `${chapterId}.json`))) continue; // текст личной книги в снимок не входит
      expect(keysOf(chapterId), chapterId).toContain(saved.key);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
