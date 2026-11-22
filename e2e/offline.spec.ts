import { expect, test } from '@playwright/test';
import { makeBook } from './fixtures/make-book';
import { addBookFromPaste, expectReaderReady, openBookPage, tab } from './helpers';

// Service worker проверяем в Chromium (проект android): `config.projects` не гонит этот файл в WebKit
test('офлайн: после первой загрузки полка и читалка открываются без сети', async ({ page, context }) => {
  const book = makeBook();
  const count = book.chapters.length;

  await addBookFromPaste(page, book);
  await tab(page, 'Полка').click();
  await expect(page.getByRole('heading', { level: 3, name: book.title })).toBeVisible();

  // Дождаться, пока service worker активен и закэшировал сборку, и страница им управляется (после перезагрузки)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();

  // Полка видна: название приложения и карточка книги (она лежит в IndexedDB)
  await expect(page.locator('.wordmark')).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: book.title })).toBeVisible();

  // И читалка (отдельный JS-файл, шрифты) открывается без сети
  await openBookPage(page, book);
  await page.getByRole('link', { name: 'Начать читать' }).click();
  await expectReaderReady(page, book.chapters[0].title, 1, count);
  await expect(page.locator('.prose p').first()).toBeVisible();

  // Вкладки тоже работают без сети: «Ещё» открывается
  await page.getByRole('button', { name: 'К странице книги' }).click();
  await tab(page, 'Ещё').click();
  await expect(page.getByRole('button', { name: /Сделать резервную копию/ })).toBeVisible();
});
