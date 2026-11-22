import { expect, test } from '@playwright/test';
import { makeBook } from './fixtures/make-book';
import { addBookFromPaste, expectReaderReady, openBookPage, pressBarButton, scrollChapterTo, tab } from './helpers';

test('резервная копия: скачать, восстановить в чистом профиле, восстановить ещё раз', async ({ page, browser }, testInfo) => {
  const book = makeBook();

  // Системное меню «Поделиться» (в WebKit оно есть) открывалось бы вместо скачивания: идём по пути скачивания файла
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
  });

  await addBookFromPaste(page, book);
  // Немного почитать, чтобы в копии был и прогресс, а не только книга
  await openBookPage(page, book);
  await page.getByRole('link', { name: 'Начать читать' }).click();
  await expectReaderReady(page, book.chapters[0].title, 1, book.chapters.length);
  await scrollChapterTo(page, 0.4);
  await page.waitForTimeout(500);

  // «Ещё» → «Сделать резервную копию»
  await pressBarButton(page, 'К странице книги'); // в читалке вкладок нет
  await tab(page, 'Ещё').click();
  await expect(page.getByText('Копий ещё не было')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Сделать резервную копию/ }).click(),
  ]);
  const backupPath = testInfo.outputPath('backup.json');
  await download.saveAs(backupPath);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await expect(page.getByText(/Последняя копия:/)).toBeVisible();

  // Новый профиль: чистое хранилище, полка пустая
  const fresh = await browser.newContext();
  try {
    const clean = await fresh.newPage();
    // Профиль тот же (телефон), хранилище другое
    expect(clean.viewportSize()).toEqual(page.viewportSize());
    await clean.goto('/');
    await expect(clean.getByRole('heading', { name: 'Полка пока пустая' })).toBeVisible();

    const restore = async (summary: RegExp) => {
      await tab(clean, 'Ещё').click();
      await clean.locator('input[type="file"]').setInputFiles(backupPath);
      const sheet = clean.getByRole('dialog', { name: 'Восстановить из копии?' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(/1\s+книга/)).toBeVisible();
      await sheet.getByRole('button', { name: 'Восстановить', exact: true }).click();
      // Итог — и в тосте, и под кнопками раздела «Данные»; берём строку состояния
      await expect(clean.getByRole('status').filter({ hasText: summary })).toBeVisible();
    };

    // Первое восстановление: книга добавлена; и на полке то же самое — книга, а в ней прогресс («Продолжить»)
    await restore(/Добавлено 1, обновлено 0, пропущено 0/);
    await tab(clean, 'Полка').click();
    await expect(clean.getByRole('heading', { level: 3, name: book.title })).toBeVisible();
    await expect(clean.getByRole('link', { name: new RegExp(`^Продолжить: ${book.title}`) })).toBeVisible();

    // Повторное восстановление той же копии: ничего не задвоилось
    await restore(/Добавлено 0, обновлено 0, пропущено 1/);
    await tab(clean, 'Полка').click();
    await expect(clean.getByRole('heading', { level: 3, name: book.title })).toHaveCount(1);
  } finally {
    await fresh.close();
  }
});
