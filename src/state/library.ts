/**
 * Состояние библиотеки: книги и прогресс в сигналах (spec §6). UI читает только сигналы,
 * а каждое действие сразу обновляет их и пишет в БД.
 */
import { signal } from '@preact/signals';
import { clampProgress, lastRequiredChapter, newProgress, percentOf } from '../core/progress';
import type { BookMeta, Chapter, Progress } from '../core/types';
import { deleteBook, getAllBooks, saveBook, updateBookMeta, type BookMetaPatch } from '../db/books';
import { getAllProgress, putProgress } from '../db/progress';
import { loadSettings } from './settings';

export const books = signal<BookMeta[]>([]);
export const progressMap = signal<Map<string, Progress>>(new Map());
/** Книги и прогресс прочитаны из БД (полка пустая — значит, книг правда нет). */
export const libraryReady = signal(false);
/** При запуске хранилище не открылось: ошибка или ответа нет дольше `STARTUP_TIMEOUT_MS`. */
export const libraryError = signal(false);

/** Сколько при запуске ждать IndexedDB, прежде чем показать «Не удалось открыть хранилище». */
export const STARTUP_TIMEOUT_MS = 8000;

/** Через сколько после «Удалить» книга пропадает из БД (окно «Отменить»). */
export const DELETE_UNDO_MS = 6000;

/** Книги, скрытые с полки и ожидающие удаления из БД. */
const pendingDeletes = new Map<string, { meta: BookMeta; index: number; timer: ReturnType<typeof setTimeout> }>();

/** Только для тестов: забыть отложенные удаления и сбросить сигналы. */
export function __resetLibraryForTests(): void {
  for (const { timer } of pendingDeletes.values()) clearTimeout(timer);
  pendingDeletes.clear();
  books.value = [];
  progressMap.value = new Map();
  libraryReady.value = false;
  libraryError.value = false;
}

function upsertBook(meta: BookMeta): void {
  const list = books.value;
  books.value = list.some((b) => b.id === meta.id) ? list.map((b) => (b.id === meta.id ? meta : b)) : [...list, meta];
}

function setProgressLocal(p: Progress): void {
  const next = new Map(progressMap.value);
  next.set(p.bookId, p);
  progressMap.value = next;
}

/**
 * Запуск приложения: настройки и библиотека из IndexedDB. Если база не открылась или `indexedDB.open`
 * не ответил за 8 с, ставится `libraryError`, и вместо полки показывается экран ошибки: пустая полка
 * выглядела бы как потеря всех книг. Загрузка не отменяется — если она всё же закончится,
 * `libraryReady` вернёт обычные экраны. Не бросает.
 */
export async function startLibrary(timeoutMs = STARTUP_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Хранилище не ответило за ${timeoutMs} мс`)), timeoutMs);
  });
  try {
    await Promise.race([Promise.all([loadSettings(), loadLibrary()]), timeout]);
  } catch (error) {
    console.error('Не удалось открыть хранилище', error);
    libraryError.value = true;
  } finally {
    clearTimeout(timer);
  }
}

/** Прочитать книги и прогресс из БД. Книги, ожидающие удаления, остаются скрытыми. */
export async function loadLibrary(): Promise<void> {
  const [allBooks, allProgress] = await Promise.all([getAllBooks(), getAllProgress()]);
  books.value = allBooks.filter((b) => !pendingDeletes.has(b.id));
  progressMap.value = new Map(allProgress.filter((p) => !pendingDeletes.has(p.bookId)).map((p) => [p.bookId, p]));
  libraryReady.value = true;
}

/**
 * Записать добавленную или обновлённую книгу. Если у книги уже есть прогресс (обновление),
 * он ограничивается новым числом глав.
 */
export async function saveImportedBook(meta: BookMeta, chapters: Chapter[]): Promise<void> {
  await saveBook(meta, chapters);
  upsertBook(meta);
  const old = progressMap.value.get(meta.id);
  if (old) {
    const clamped = clampProgress(old, meta);
    if (JSON.stringify(clamped) !== JSON.stringify(old)) await saveProgress(clamped);
  }
}

export async function toggleFavorite(id: string): Promise<void> {
  const book = books.value.find((b) => b.id === id);
  if (!book) return;
  upsertBook(await updateBookMeta(id, { favorite: !book.favorite }));
}

export async function editBookMeta(id: string, patch: BookMetaPatch): Promise<void> {
  upsertBook(await updateBookMeta(id, patch));
}

/** Скрыть книгу сразу, а из БД удалить через 6 секунд — пока их нет, можно `undoDelete`. */
export function scheduleDelete(id: string): void {
  if (pendingDeletes.has(id)) return;
  const index = books.value.findIndex((b) => b.id === id);
  if (index < 0) return;
  const meta = books.value[index];
  books.value = books.value.filter((b) => b.id !== id);

  const timer = setTimeout(() => void finishDelete(id), DELETE_UNDO_MS);
  pendingDeletes.set(id, { meta, index, timer });
}

async function finishDelete(id: string): Promise<void> {
  const pending = pendingDeletes.get(id);
  if (!pending) return;
  try {
    await deleteBook(id);
    const next = new Map(progressMap.value);
    next.delete(id);
    progressMap.value = next;
  } catch (e) {
    // Не удалилось: книга возвращается на полку, чтобы не вводить в заблуждение.
    console.error('Не удалось удалить книгу', e);
    const list = [...books.value];
    list.splice(Math.min(pending.index, list.length), 0, pending.meta);
    books.value = list;
  } finally {
    pendingDeletes.delete(id);
  }
}

/** Вернуть книгу, пока не истекли 6 секунд. */
export function undoDelete(id: string): void {
  const pending = pendingDeletes.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingDeletes.delete(id);
  const list = [...books.value];
  list.splice(Math.min(pending.index, list.length), 0, pending.meta);
  books.value = list;
}

/** Записать позицию чтения: сигнал обновляется сразу. */
export async function saveProgress(p: Progress): Promise<void> {
  setProgressLocal(p);
  await putProgress(p);
}

/**
 * «Прочитано» вручную или «Вернуть в «Читаю»». Книга считается прочитанной, когда дочитана
 * последняя не служебная глава, поэтому эта глава отмечается и снимается вместе со статусом.
 */
export async function setFinished(id: string, finished: boolean): Promise<void> {
  const meta = books.value.find((b) => b.id === id);
  if (!meta) return;
  const now = Date.now();
  const old = progressMap.value.get(id);
  const last = lastRequiredChapter(meta);

  if (finished) {
    const base = old ?? newProgress(id, now);
    await saveProgress({
      ...base,
      status: 'finished',
      percent: 100,
      finishedAt: base.finishedAt ?? now,
      lastReadAt: now,
      maxChapter: Math.max(base.maxChapter, last),
      chaptersDone: [...new Set([...base.chaptersDone, last])].sort((a, b) => a - b),
    });
    return;
  }

  if (!old) return;
  const { finishedAt: _finishedAt, ...rest } = old;
  void _finishedAt;
  await saveProgress({
    ...rest,
    status: 'reading',
    percent: percentOf(meta, old.wordsRead),
    lastReadAt: now,
    chaptersDone: old.chaptersDone.filter((n) => n !== last),
  });
}

/** «Одно действие после книги»: текст и галочка «сделано». `undefined` убирает действие. */
export async function setBookAction(id: string, action: BookMeta['action']): Promise<void> {
  upsertBook(await updateBookMeta(id, { action }));
}

/** После восстановления из копии: заново читаем книги, прогресс и настройки. */
export async function reloadAfterRestore(): Promise<void> {
  await Promise.all([loadLibrary(), loadSettings()]);
}
