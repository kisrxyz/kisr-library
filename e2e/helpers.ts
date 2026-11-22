import { expect, type Locator, type Page } from '@playwright/test';
import type { FixtureBook } from './fixtures/make-book';

/** Вкладка нижней панели: «Полка», «Поиск», «Добавить», «Заметки», «Ещё». */
export const tab = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name, exact: true });

/** Экран читалки: `data-state="ready"` — глава показана и место восстановлено (ReaderScreen). */
export const readerMain = (page: Page): Locator => page.locator('main.rscreen');

/** Книга со вставкой: «Добавить» → текст в поле → «Сохранить на полку». Заканчивает на экране «Добавить». */
export async function addBookFromPaste(page: Page, book: FixtureBook): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Полка пока пустая' })).toBeVisible();
  await tab(page, 'Добавить').click();
  // Кнопка «Вставить из буфера» просит разрешение у браузера — в тесте текст кладём в поле сами
  await page.getByPlaceholder('Вставь сюда ответ Claude целиком').fill(book.md);
  await expect(page.getByText(`${book.chapters.length} глав`)).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить на полку' }).click();
  await expect(page.getByText('Книга на полке')).toBeVisible();
}

/** С полки — на страницу книги. */
export async function openBookPage(page: Page, book: FixtureBook): Promise<void> {
  await tab(page, 'Полка').click();
  await page.getByRole('heading', { level: 3, name: book.title }).click();
  await expect(page.getByRole('heading', { level: 1, name: book.title })).toBeVisible();
}

/** Читалка показала главу и вернула место. */
export async function expectReaderReady(page: Page, chapterTitle: string, chapterNumber: number, count: number): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: chapterTitle })).toBeVisible();
  await expect(readerMain(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByText(`Глава ${chapterNumber} из ${count}`)).toBeVisible();
}

/** Блок у линии чтения — то же правило, что у `findAnchor`: первый блок, чей низ ниже панели + зазор. */
export interface TopBlock {
  key: string;
  /** Доля блока, уже ушедшая выше линии (0..1). */
  offset: number;
  /** Верх блока в окне, px. */
  top: number;
  text: string;
}

export async function topBlock(page: Page): Promise<TopBlock> {
  return page.evaluate(() => {
    const LINE_GAP = 8; // position.ts
    const bar = document.querySelector<HTMLElement>('.rbar');
    const lineY = (bar?.offsetHeight ?? 0) + LINE_GAP;
    for (const el of document.querySelectorAll<HTMLElement>('.prose [data-key]')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > lineY) {
        return {
          key: el.dataset.key ?? '',
          offset: r.height > 0 ? Math.min(1, Math.max(0, (lineY - r.top) / r.height)) : 0,
          top: r.top,
          text: (el.textContent ?? '').slice(0, 60),
        };
      }
    }
    throw new Error('Ни один блок главы не ниже линии чтения');
  });
}

/**
 * Читатель листает главу вниз, пока линия чтения не дойдёт до доли `fraction` текста главы.
 * Прокрутка — короткими шагами через `scrollTo`, как при пролистывании пальцем (события `scroll` идут подряд).
 */
export async function scrollChapterTo(page: Page, fraction: number): Promise<void> {
  await page.evaluate(async (frac) => {
    const prose = document.querySelector('.prose');
    const bar = document.querySelector<HTMLElement>('.rbar');
    if (!prose || !bar) throw new Error('Нет главы на экране');
    const box = prose.getBoundingClientRect();
    const target = Math.round(box.top + window.scrollY + frac * box.height - bar.offsetHeight - 8);
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    for (let i = 0; i < 400 && Math.abs(window.scrollY - target) > 1; i++) {
      const step = Math.sign(target - window.scrollY) * Math.min(240, Math.abs(target - window.scrollY));
      window.scrollTo(0, window.scrollY + step);
      await frame();
    }
  }, fraction);
}

/**
 * Кнопка в липкой панели читалки. WebKit под Windows с профилем iPhone считает окно меньше заявленного
 * (innerWidth 340 вместо 390, визуальный вьюпорт сдвигается), и панель оказывается над видимой областью:
 * обычный `click()` сначала прокручивает страницу «к кнопке» и тем самым сдвигает место, которое проверяет
 * тест. На настоящем iPhone такого нет, поэтому нажимаем событием, без прокрутки.
 */
export async function pressBarButton(page: Page, name: string): Promise<void> {
  await page.locator('.rbar').getByRole('button', { name }).dispatchEvent('click');
}

/** Панель читалки прячется при прокрутке вниз; прокрутка вверх на пару строк возвращает её. */
export async function revealBar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.scrollBy(0, -40);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** Что записано в IndexedDB `progress` (читаем базу напрямую: так видно, сохранено ли место до всяких событий жизненного цикла). */
export async function savedProgress(page: Page): Promise<{ bookId: string; chapter: number; blockKey: string | null; blockOffset: number } | undefined> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('kisr-library');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('progress').objectStore('progress').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve(req.result[0]);
          };
        };
      }),
  );
}
