import { expect, test } from '@playwright/test';
import { makeBook } from './fixtures/make-book';
import { addBookFromPaste, expectReaderReady, openBookPage, readerMain, tab } from './helpers';

test('книга из вставки попадает на полку и читается по главам', async ({ page }) => {
  const book = makeBook();
  const count = book.chapters.length;

  await addBookFromPaste(page, book);

  // Полка: карточка книги
  await tab(page, 'Полка').click();
  await expect(page.getByRole('heading', { level: 3, name: book.title })).toBeVisible();

  // Страница книги: все главы в списке, главная кнопка — «Начать читать»
  await openBookPage(page, book);
  await expect(page.getByRole('button', { name: new RegExp(book.chapters[count - 1].title) })).toBeVisible();
  await page.getByRole('link', { name: 'Начать читать' }).click();

  // Глава 1, потом «Дальше» — глава 2
  await expectReaderReady(page, book.chapters[0].title, 1, count);
  await expect(page.locator('.prose p').first()).toBeVisible();
  const next = page.getByRole('button', { name: new RegExp(`^Дальше: ${book.chapters[1].title}`) });
  await next.click();

  await expectReaderReady(page, book.chapters[1].title, 2, count);
  // Другая глава — другой текст, и открылась она с начала
  await expect(readerMain(page).locator('[data-key]').first()).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
});
