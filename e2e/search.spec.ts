import { expect, test } from '@playwright/test';
import { makeBook } from './fixtures/make-book';
import { addBookFromPaste, expectReaderReady, readerMain, tab } from './helpers';

test('поиск по тексту: слово из главы 3 открывает читалку на этой главе с подсвеченным совпадением', async ({ page }) => {
  const book = makeBook();
  const count = book.chapters.length;
  const word = book.chapters[2].rare!;

  await addBookFromPaste(page, book);
  await tab(page, 'Поиск').click();
  await page.getByRole('searchbox', { name: 'Поиск по библиотеке' }).fill(word);

  // «В тексте»: одно место — в главе 3
  const hits = page.getByRole('region', { name: /^В тексте/ });
  const hit = hits.getByRole('link', { name: new RegExp(`Глава 3 · ${book.chapters[2].title}`) });
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText(word);
  await hit.click();

  // Читалка: глава 3, место с совпадением подсвечено
  await expectReaderReady(page, book.chapters[2].title, 3, count);
  const mark = readerMain(page).locator('mark');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText(new RegExp(word, 'i'));
  await expect(mark).toBeInViewport();
});
