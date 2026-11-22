/**
 * Добавление книг (spec §7.2): что вставили или выбрали → черновики с дублями → запись на полку.
 * Логика без экрана: DOM здесь не нужен, поэтому она проверяется тестами в Node.
 */
import { BACKUP_FORMAT, backupStamp, isBackup, type BackupFile } from '../../core/backup';
import { buildBook, contentHashOf } from '../../core/book';
import { applyResolution, defaultResolution, findDuplicate, type Duplicate, type Resolution } from '../../core/duplicates';
import { parseBooks, type ParsedBook } from '../../core/parse';
import { reopenIfGrown } from '../../core/progress';
import { countWords, makeBookId } from '../../core/text';
import type { BookMeta } from '../../core/types';
import { importBackup } from '../../db/backup';
import { getAllBooks, getChapters } from '../../db/books';
import { books, progressMap, reloadAfterRestore, saveImportedBook, saveProgress } from '../../state/library';
import { updateSettings } from '../../state/settings';

/** Одна книга из вставки или файла, ещё не сохранённая: читатель смотрит и правит её в предпросмотре. */
export interface Draft {
  key: string;
  parsed: ParsedBook;
  /** Хеш текста — по нему ищутся дубли. */
  hash: string;
  dup: Duplicate;
  resolution: Resolution;
  /** Правится в предпросмотре; при «Дописать» не используется (у книги остаётся своё название). */
  title: string;
  /** Пусто — «Разное». */
  category: string;
  tags: string[];
  source: 'paste' | 'file' | 'share';
}

export type ReadResult = { kind: 'backup'; file: BackupFile } | { kind: 'books'; drafts: Draft[] };

export type CommitAction = 'added' | 'updated' | 'appended' | 'skipped';

const DEFAULT_CATEGORY = 'Разное';
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

let nextKey = 1;

/** Раздел из шапки пишется как у существующего раздела на полке: «психология» не заводит второй. */
function matchCategory(wanted: string, shelf: { category: string }[]): string {
  const lower = wanted.toLowerCase();
  return shelf.find((b) => b.category.toLowerCase() === lower)?.category ?? wanted;
}

function makeDraft(parsed: ParsedBook, source: Draft['source']): Draft {
  const shelf = books.value;
  const hash = contentHashOf(parsed.chapters);
  const dup = findDuplicate(parsed, hash, shelf);
  // Что в шапке не написано, то у книги на полке не трогаем: обновление не должно сбрасывать раздел и теги.
  const category = matchCategory(parsed.category || dup?.book.category || DEFAULT_CATEGORY, shelf);
  return {
    key: `d${nextKey++}`,
    parsed,
    hash,
    dup,
    resolution: defaultResolution(parsed, dup),
    title: parsed.title,
    category,
    tags: parsed.tags.length > 0 ? parsed.tags : [...(dup?.book.tags ?? [])],
    source,
  };
}

/** Копию не удалось прочитать: файл оборван, сломан или сделан более новой версией приложения. */
export const BROKEN_BACKUP = 'Файл копии повреждён или сделан более новой версией приложения';

/**
 * Копия библиотеки, если текст — JSON этого приложения; `null` — это не копия (обычный текст, чужой JSON).
 * Что не разобралось, но было копией, — ошибка, а не «книга» из обрывка JSON: так бывает, если вставили не
 * всё или файл докачался не до конца. Копией считаем `.json`-файл и текст с `{`, в котором есть
 * `kisr-library-backup`; чужой JSON, вставленный как текст, остаётся текстом.
 */
function readBackup(raw: string, fileName?: string): BackupFile | null {
  const text = raw.replace(/^﻿/, '').trim();
  const isJsonFile = !!fileName && /\.json$/i.test(fileName);
  if (!text || !(isJsonFile || text.startsWith('{'))) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (isJsonFile || (text.startsWith('{') && text.includes(BACKUP_FORMAT))) throw new Error(BROKEN_BACKUP);
    return null;
  }
  if (isBackup(json)) return json;
  if (typeof json === 'object' && json !== null && (json as { format?: unknown }).format === BACKUP_FORMAT) {
    throw new Error(BROKEN_BACKUP);
  }
  return null;
}

/**
 * Что вставили или выбрали. Копия библиотеки — `backup`; всё остальное — книги (одна или несколько),
 * даже если это мусор: парсер превратит его в одну главу «Текст» с предупреждением.
 * Бросает ошибку (`BROKEN_BACKUP`) только для копии, которую нельзя прочитать.
 * `fileName` — запасное название книги без шапки.
 */
export function readInput(text: string, source: Draft['source'], fileName?: string): ReadResult {
  const raw = String(text ?? '');
  const file = readBackup(raw, fileName);
  if (file) return { kind: 'backup', file };
  return { kind: 'books', drafts: parseBooks(raw, { fileName }).map((parsed) => makeDraft(parsed, source)) };
}

/** В тексте нет ни одного слова: такую книгу не сохраняем. */
export function isEmptyDraft(d: Draft): boolean {
  return d.parsed.chapters.every((c) => countWords(c.md) === 0);
}

/** Что показать под названием: предупреждения парсера; у пустого текста — только «Пустой текст», остальное не важно. */
export function draftWarnings(d: Draft): string[] {
  return isEmptyDraft(d) ? ['Пустой текст'] : d.parsed.warnings;
}

/** Есть что сохранять: не «Пропустить», не пустой текст, у новой книги и обновления есть название. */
export function canSaveDraft(d: Draft): boolean {
  if (d.resolution === 'skip' || isEmptyDraft(d)) return false;
  return d.resolution === 'append' || squash(d.title) !== '';
}

let persistAsked = false;

/** Просим браузер не чистить хранилище. Один раз за сеанс; отказ и ошибки не важны. */
function askPersistOnce(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (typeof navigator === 'undefined') return;
    const asked = navigator.storage?.persist?.();
    Promise.resolve(asked).catch(() => {});
  } catch {
    // нет такого API — ничего страшного
  }
}

/** Только для тестов. */
export function __resetImportFlowForTests(): void {
  persistAsked = false;
  nextKey = 1;
}

/** Первая отметка времени не меньше `now`, при которой id новой книги ещё не занят: два одинаковых названия подряд не затрут друг друга. */
function freeStamp(title: string, now: number): number {
  let stamp = now;
  while (books.value.some((b) => b.id === makeBookId(title, stamp))) stamp++;
  return stamp;
}

/**
 * Записывает черновик. «Отдельно» — новая книга; «Обновить» и «Дописать» — существующая (id, прогресс
 * и отметки остаются, прогресс ограничивает `saveImportedBook`); «Пропустить» и пустой текст — ничего.
 * Если книга, которую хотели обновить, уже ушла с полки, добавляется новая: воскрешать удалённый id нельзя.
 */
export async function commitDraft(d: Draft, now: number): Promise<{ bookId: string; action: CommitAction }> {
  if (d.resolution === 'skip' || isEmptyDraft(d)) return { bookId: d.dup?.book.id ?? '', action: 'skipped' };

  const parsed: ParsedBook = {
    ...d.parsed,
    title: squash(d.title) || d.parsed.title,
    category: squash(d.category),
    tags: d.tags,
  };

  const existing = d.resolution === 'separate' ? undefined : books.value.find((b) => b.id === d.dup?.book.id);
  let result: { bookId: string; action: CommitAction };
  if (existing && (d.resolution === 'update' || d.resolution === 'append')) {
    const chapters = d.resolution === 'append' ? await getChapters(existing.id) : [];
    const built = applyResolution({ meta: existing, chapters }, parsed, d.resolution, now);
    await saveImportedBook(built.meta, built.chapters);
    if (d.resolution === 'append') await reopenAfterAppend(built.meta, existing.chapters.length);
    result = { bookId: existing.id, action: d.resolution === 'update' ? 'updated' : 'appended' };
  } else {
    const built = buildBook(parsed, { origin: d.source, now: freeStamp(parsed.title, now) });
    await saveImportedBook(built.meta, built.chapters);
    result = { bookId: built.meta.id, action: 'added' };
  }
  askPersistOnce();
  return result;
}

/** Прочитанная книга, в которую дописали главы, снова «Читаю» (сам прогресс уже ограничен `saveImportedBook`). */
async function reopenAfterAppend(meta: BookMeta, chaptersBefore: number): Promise<void> {
  const progress = progressMap.value.get(meta.id);
  if (!progress) return;
  const next = reopenIfGrown(progress, meta, chaptersBefore);
  if (next !== progress) await saveProgress(next);
}

/** Текст тоста после сохранения: одна книга — своими словами, несколько — итогом. */
export function savedMessage(results: { action: CommitAction }[]): string {
  const count = (a: CommitAction) => results.filter((r) => r.action === a).length;
  const added = count('added');
  const updated = count('updated');
  const appended = count('appended');
  if (added + updated + appended === 1) return added ? 'Книга на полке' : updated ? 'Книга обновлена' : 'Главы дописаны';
  const parts = [
    added && `добавлено ${added}`,
    updated && `обновлено ${updated}`,
    appended && `дописано ${appended}`,
  ].filter(Boolean) as string[];
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Восстановление из копии: слияние, затем «последняя копия» = эта (иначе напоминание на полке
 * сработает сразу после восстановления), затем перечитываем полку и настройки.
 */
export async function restoreBackup(file: BackupFile): Promise<{ added: number; updated: number; skipped: number }> {
  const report = await importBackup(file);
  try {
    // Мусор или время из будущего в файле — «сейчас», иначе напоминание о копии замолчало бы
    await updateSettings({ lastBackupAt: backupStamp(file.exportedAt), booksAtLastBackup: (await getAllBooks()).length });
  } catch (e) {
    // Книги уже восстановлены; без этой записи напоминание сработает раньше, чем нужно — не страшно.
    console.error('Не удалось запомнить дату копии', e);
  }
  await reloadAfterRestore();
  return report;
}
