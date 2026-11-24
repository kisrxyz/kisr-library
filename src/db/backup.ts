/** Экспорт и восстановление резервной копии (spec §10.6). Правила слияния — `core/backup.ts`. */
import { BACKUP_FORMAT, BACKUP_VERSION, planMerge, toBackupBook, type BackupFile, type LibrarySnapshot } from '../core/backup';
import type { Settings } from '../core/types';
import { writeBook } from './books';
import { notifyLocalChange } from './changes';
import { openDb } from './schema';

/** Копия всей библиотеки одним снимком: чтение идёт в одной транзакции, поэтому данные согласованы. */
export async function exportBackup(app: string): Promise<BackupFile> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters', 'progress', 'marks', 'tasks', 'settings'], 'readonly');
  const [books, chapters, progress, marks, tasks, settings] = await Promise.all([
    tx.objectStore('books').getAll(),
    tx.objectStore('chapters').getAll(),
    tx.objectStore('progress').getAll(),
    tx.objectStore('marks').getAll(),
    tx.objectStore('tasks').getAll(),
    tx.objectStore('settings').getAll(),
    tx.done,
  ]);

  const byBook = new Map<string, { order: number; title: string; md: string }[]>();
  for (const c of chapters) {
    const list = byBook.get(c.bookId) ?? [];
    list.push({ order: c.order, title: c.title, md: c.md });
    byBook.set(c.bookId, list);
  }

  const backupBooks = books.map((meta) => toBackupBook(meta, byBook.get(meta.id) ?? []));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    app,
    books: backupBooks,
    progress,
    marks,
    tasks,
    settings: Object.fromEntries(settings.map((row) => [row.key, row.value])) as Partial<Settings>,
  };
}

/**
 * Сливает копию с библиотекой одной транзакцией (всё или ничего) и возвращает итог для экрана.
 * Книга или отметка, восстановленная поверх метки удаления, эту метку снимает (spec §18.3).
 */
export async function importBackup(file: BackupFile): Promise<{ added: number; updated: number; skipped: number }> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters', 'progress', 'marks', 'tasks', 'settings', 'deleted'], 'readwrite');
  try {
    const [books, progress, marks, tasks, settings, deleted] = await Promise.all([
      tx.objectStore('books').getAll(),
      tx.objectStore('progress').getAll(),
      tx.objectStore('marks').getAll(),
      tx.objectStore('tasks').getAll(),
      tx.objectStore('settings').getAll(),
      tx.objectStore('deleted').getAll(),
    ]);
    const current: LibrarySnapshot = {
      books,
      progress,
      marks,
      tasks,
      settings: Object.fromEntries(settings.map((row) => [row.key, row.value])) as Partial<Settings>,
      deleted: Object.fromEntries(deleted.map((row) => [row.key, row.at])),
    };
    const plan = planMerge(current, file, Date.now());

    const stores = { books: tx.objectStore('books'), chapters: tx.objectStore('chapters') };
    for (const { meta, chapters } of plan.putBooks) await writeBook(stores, meta, chapters);
    await Promise.all([
      ...plan.putProgress.map((p) => tx.objectStore('progress').put(p)),
      ...plan.putMarks.map((m) => tx.objectStore('marks').put(m)),
      ...plan.putTasks.map((t) => tx.objectStore('tasks').put(t)),
      ...Object.entries(plan.settings).map(([key, value]) => tx.objectStore('settings').put({ key, value })),
      ...plan.revived.map((key) => tx.objectStore('deleted').delete(key)),
    ]);
    await tx.done;
    notifyLocalChange('data');
    return plan.report;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // транзакция уже завершена
    }
    await tx.done.catch(() => {});
    throw e;
  }
}
