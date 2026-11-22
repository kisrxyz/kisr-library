import { expect, test, type Page } from '@playwright/test';
import { makeBook } from './fixtures/make-book';
import {
  addBookFromPaste,
  expectReaderReady,
  openBookPage,
  pressBarButton,
  revealBar,
  savedProgress,
  scrollChapterTo,
  tab,
  topBlock,
  type TopBlock,
} from './helpers';

/** Пауза после прокрутки из задания (запись места идёт не чаще раза в 300 мс, usePositionTracking). */
const SETTLE_MS = 500;
/** Сколько ждать, пока место запишется или встанет на место после перезагрузки и смены шрифта. */
const POLL_MS = 3000;

/**
 * Блок у линии чтения тот же, и стоит он там же (а не просто где-то на экране). Ждём, а не берём один замер:
 * после перезагрузки и смены шрифта место встаёт, когда догрузятся шрифты.
 */
async function expectSameSpot(page: Page, before: TopBlock, what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const now = await topBlock(page);
        // Место — это блок и доля его высоты, а не пиксели: за доли пикселя от округления отличаться можно
        return { key: now.key, near: Math.abs(now.offset - before.offset) < 0.03 };
      },
      { message: `${what}: тот же блок (${before.text}) и та же доля над линией`, timeout: POLL_MS },
    )
    .toEqual({ key: before.key, near: true });
}

/** В базе уже записано это место: тот же блок и та же доля (одного ключа мало — блок мог не смениться). */
async function expectSaved(page: Page, spot: TopBlock, what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const saved = await savedProgress(page);
        return { key: saved?.blockKey, near: !!saved && Math.abs(saved.blockOffset - spot.offset) < 0.03 };
      },
      { message: what, timeout: POLL_MS },
    )
    .toEqual({ key: spot.key, near: true });
}

test('место чтения: прокрутка → перезагрузка, «Продолжить», смена размера шрифта', async ({ page }) => {
  const book = makeBook();
  const count = book.chapters.length;
  const chapter = book.chapters[1];

  await addBookFromPaste(page, book);
  await openBookPage(page, book);
  await page.getByRole('link', { name: 'Начать читать' }).click();
  await expectReaderReady(page, book.chapters[0].title, 1, count);
  await page.getByRole('button', { name: new RegExp(`^Дальше: ${chapter.title}`) }).click();
  await expectReaderReady(page, chapter.title, 2, count);

  // 1. Прокрутили до 60% главы и подождали: место уже записано, хотя ни `visibilitychange`, ни `pagehide` не было
  // (Review Focus 4: приложение, убитое свайпом, ничего не успевает сохранить само)
  await scrollChapterTo(page, 0.6);
  await page.waitForTimeout(SETTLE_MS);
  const before = await topBlock(page);
  await expectSaved(page, before, 'в базе уже тот же блок, до любого события жизненного цикла');
  expect((await savedProgress(page))?.chapter, 'в базе уже глава 2').toBe(2);

  // 2. Перезагрузка прямо в читалке (без перехода по экранам): тот же блок на том же месте
  await page.reload();
  await expectReaderReady(page, chapter.title, 2, count);
  await expectSameSpot(page, before, 'после перезагрузки');

  // 3. «Продолжить» на полке: тот же блок. В читалке вкладок нет: «‹» к странице книги, оттуда на полку
  await pressBarButton(page, 'К странице книги');
  await expect(page.getByRole('heading', { level: 1, name: book.title })).toBeVisible();
  await tab(page, 'Полка').click();
  const resume = page.getByRole('link', { name: /^Продолжить:/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expectReaderReady(page, chapter.title, 2, count);
  await expectSameSpot(page, before, 'после «Продолжить»');

  // 4. Крупный шрифт: «Aa» → размер 22. Тот же абзац остаётся у линии (Review Focus 2) ...
  // «Продолжить» по ссылке место не пишет, пока читатель не прокрутил: прокрутка вверх (показать панель) — его
  await revealBar(page);
  const beforeFont = await topBlock(page);
  await expectSaved(page, beforeFont, 'место после прокрутки вверх записано');
  await pressBarButton(page, 'Настройки чтения');
  const dialog = page.getByRole('dialog', { name: 'Оформление' });
  await expect(dialog).toBeVisible();
  const bigger = dialog.getByRole('button', { name: 'Увеличить текст' });
  const size = dialog.getByLabel(/^Размер текста:/);
  await expect(size).toHaveText('18');
  const paragraph = page.locator('.prose p').first();
  const fontBefore = await paragraph.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  for (let i = 0; i < 4; i++) await bigger.click();
  await expect(size).toHaveText('22');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const fontAfter = await paragraph.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontAfter, 'шрифт действительно стал крупнее').toBeGreaterThan(fontBefore + 3);
  await expectSameSpot(page, beforeFont, 'после смены размера');
  await expectSaved(page, beforeFont, 'после смены размера в базе то же место');

  // ... и после перезагрузки тоже: позиция держится за абзац, а не за пиксели
  await page.reload();
  await expectReaderReady(page, chapter.title, 2, count);
  expect(await paragraph.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'размер 22 запомнился').toBeCloseTo(fontAfter, 0);
  await expectSameSpot(page, beforeFont, 'после смены размера и перезагрузки');
});
