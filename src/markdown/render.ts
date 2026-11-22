/**
 * Markdown → безопасный HTML. Перенос `mdToHtml` из старого приложения (migration/old-artifact.html):
 * marked с GFM и `breaks: false`, затем DOMPurify, который оставляет чекбоксы задач.
 * Книга приходит из вставленного текста, поэтому сырой HTML из неё не должен ни выполнять код,
 * ни захватывать приложение: script, onerror=, javascript: вычищаются DOMPurify; поверх этого
 * запрещены формы и поля ввода (кроме чекбокса задачи), встроенные страницы и стили,
 * в том числе атрибут style (им можно растянуть блок на весь экран).
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import './markdown.css';

const PURIFY = {
  ADD_TAGS: ['input'],
  ADD_ATTR: ['type', 'checked', 'disabled', 'start'],
  FORBID_TAGS: ['style', 'form', 'button', 'select', 'textarea', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style'],
};

// Из полей ввода остаётся только чекбокс (пункт `- [ ]`); password, image, text и т. д. уходят.
if (DOMPurify.isSupported) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'INPUT' && (node.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') node.remove();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(md: string): string {
  const src = String(md);
  try {
    const raw = marked.parse(src, { gfm: true, breaks: false, async: false });
    return DOMPurify.sanitize(raw, PURIFY);
  } catch (e) {
    // Разбор не должен ронять читалку: в худшем случае глава покажется простым текстом.
    console.error('renderMarkdown: не удалось разобрать Markdown', e);
    return src
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
      .join('');
  }
}
