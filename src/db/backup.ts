/** Экспорт и восстановление резервной копии (spec §10.6). Правила слияния — `core/backup.ts`. */
import { BACKUP_FORMAT, BACKUP_VERSION, planMerge, type BackupBook, type BackupFile, type LibrarySnapshot } from '../core/backup';
import type { Settings } from '../core/types';
import { writeBook } from './books';
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

  const backupBooks: BackupBook[] = books.map((meta) => {
    const { chapters: _summaries, ...rest } = meta;
    void _summaries;
    const own = (byBook.get(meta.id) ?? []).sort((a, b) => a.order - b.order);
    return { ...rest, chapters: own.map((c) => ({ title: c.title, md: c.md })) };
  });

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

/** Сливает копию с библиотекой одной транзакцией (всё или ничего) и возвращает итог для экрана. */
export async function importBackup(file: BackupFile): Promise<{ added: number; updated: number; skipped: number }> {
  const db = await openDb();
  const tx = db.transaction(['books', 'chapters', 'progress', 'marks', 'tasks', 'settings'], 'readwrite');
  try {
    const [books, progress, marks, tasks, settings] = await Promise.all([
      tx.objectStore('books').getAll(),
      tx.objectStore('progress').getAll(),
      tx.objectStore('marks').getAll(),
      tx.objectStore('tasks').getAll(),
      tx.objectStore('settings').getAll(),
    ]);
    const current: LibrarySnapshot = {
      books,
      progress,
      marks,
      tasks,
      settings: Object.fromEntries(settings.map((row) => [row.key, row.value])) as Partial<Settings>,
    };
    const plan = planMerge(current, file);

    const stores = { books: tx.objectStore('books'), chapters: tx.objectStore('chapters') };
    for (const { meta, chapters } of plan.putBooks) await writeBook(stores, meta, chapters);
    await Promise.all([
      ...plan.putProgress.map((p) => tx.objectStore('progress').put(p)),
      ...plan.putMarks.map((m) => tx.objectStore('marks').put(m)),
      ...plan.putTasks.map((t) => tx.objectStore('tasks').put(t)),
      ...Object.entries(plan.settings).map(([key, value]) => tx.objectStore('settings').put({ key, value })),
    ]);
    await tx.done;
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
