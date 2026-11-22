/**
 * Перенос из старого приложения (spec §13): `npm run migrate`.
 * Читает `kisr-library/` и `migration/raw/` (оба вне git), пишет `migration/kisr-library-backup-migrated.json`,
 * который открывается в приложении через «Ещё → Восстановить из копии», и печатает сводку.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBackup, planMerge } from '../src/core/backup';
import { convertOld, findEmptyChapters, readOldSources } from '../src/migration/convertArtifact';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'migration');
const outPath = join(outDir, 'kisr-library-backup-migrated.json');

function fail(message: string): never {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function main(): void {
  if (!existsSync(join(root, 'migration', 'raw'))) {
    console.warn('Внимание: migration/raw не найден — даты книг берутся из поля created, прогресс только из user-state.json.');
  }

  const sources = readOldSources(root);
  const { backup, summary } = convertOld(sources, Date.now());

  const empty = findEmptyChapters(backup);
  if (empty.length > 0) {
    fail(`пустые главы: ${empty.map((e) => `${e.bookId} (гл. ${e.chapter})`).join(', ')}. Файл не записан.`);
  }

  // Проверка, что приложение примет файл: тот же разбор и слияние, что при восстановлении, но в пустую библиотеку.
  const file: unknown = JSON.parse(JSON.stringify(backup));
  if (!isBackup(file)) fail('получился файл, который приложение не признает копией. Файл не записан.');
  const plan = planMerge({ books: [], progress: [], marks: [], tasks: [], settings: {} }, file);
  if (plan.report.added !== summary.books || plan.putProgress.length !== summary.progress) {
    fail(`проверка восстановления не сошлась: добавилось ${plan.report.added} из ${summary.books} книг, прогресса ${plan.putProgress.length} из ${summary.progress}. Файл не записан.`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(backup, null, 2) + '\n', 'utf8');

  const kb = Math.round(statSync(outPath).size / 1024);
  console.log(`Книг: ${summary.books} · глав: ${summary.chapters} · слов: ${summary.words} · прогресс: ${summary.progress}`);
  console.log(`Проверка восстановления в пустую библиотеку: добавлено ${plan.report.added}, прогресса ${plan.putProgress.length}, пустых глав нет.`);
  console.log(`Файл: ${outPath} (${kb} КБ)`);
}

try {
  main();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
