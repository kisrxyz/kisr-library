/**
 * Markdown → безопасный HTML. Перенос `mdToHtml` из старого приложения (migration/old-artifact.html):
 * marked с GFM и `breaks: false`, затем DOMPurify, который оставляет чекбоксы задач.
 * Сырой HTML из текста книги не исполняется: script, onerror=, javascript: вычищаются.
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import './markdown.css';

const PURIFY = {
  ADD_TAGS: ['input'],
  ADD_ATTR: ['type', 'checked', 'disabled', 'start'],
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(md: string): string {
  const src = String(md);
  try {
    const raw = marked.parse(src, { gfm: true, breaks: false, async: false });
    return DOMPurify.sanitize(raw, PURIFY);
  } catch {
    // Разбор не должен ронять читалку: в худшем случае глава покажется простым текстом.
    return src
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
      .join('');
  }
}
