// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

describe('renderMarkdown', () => {
  it('не пропускает сырой script и обработчики событий', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nтекст');
    expect(html).not.toContain('<script');
    expect(html).toContain('<p>текст</p>');

    const evil = renderMarkdown('<img src="x" onerror="alert(1)">\n\n[ссылка](javascript:alert(1))');
    expect(evil).not.toContain('onerror');
    expect(evil).not.toContain('javascript:');
  });

  it('GFM: таблица, зачёркивание, чекбоксы остаются', () => {
    const html = renderMarkdown('| а | б |\n|---|---|\n| 1 | 2 |\n\n~~старое~~\n\n- [ ] шаг\n- [x] готово');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>старое</del>');
    expect(html.match(/<input[^>]*type="checkbox"/g)).toHaveLength(2);
    expect(html).toMatch(/<input[^>]*checked/);
  });

  it('breaks: false — одиночный перенос строки не превращается в <br>', () => {
    expect(renderMarkdown('раз\nдва')).not.toContain('<br');
  });

  it('start у нумерованного списка сохраняется', () => {
    expect(renderMarkdown('3. три\n4. четыре')).toContain('start="3"');
  });

  it('блок cards — это <pre><code class="language-cards">', () => {
    expect(renderMarkdown('```cards\nQ: а\nA: б\n```')).toContain('<code class="language-cards">');
  });

  it('пустая строка даёт пустую строку', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
