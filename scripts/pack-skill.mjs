/**
 * Сборка скилла Claude (spec §14): `npm run skill`.
 *  - claude-skill/kisr-library-razbor.zip — папка `kisr-library-razbor/` с `SKILL.md`, для загрузки в
 *    claude.ai (Настройки → Возможности → Навыки);
 *  - claude-skill/project-instructions.md — то же тело без YAML-шапки, для Claude Project.
 * Единственный источник текста — claude-skill/kisr-library-razbor/SKILL.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';

const NAME = 'kisr-library-razbor';
const INSTRUCTIONS_TITLE = 'Инструкции проекта Kisr Library: каждый ответ в этом проекте — книга для приложения';

const root = fileURLToPath(new URL('..', import.meta.url));
const skillDir = join(root, 'claude-skill');
const skillPath = join(skillDir, NAME, 'SKILL.md');
const zipPath = join(skillDir, `${NAME}.zip`);
const instructionsPath = join(skillDir, 'project-instructions.md');

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

let skill;
try {
  skill = readFileSync(skillPath, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
} catch {
  fail(`не найден ${skillPath}`);
}

const header = skill.match(/^---\n([\s\S]*?)\n---\n/);
if (!header) fail('в SKILL.md нет YAML-шапки (--- … ---) в начале файла');
if (!new RegExp(`^name:\\s*"?${NAME}"?\\s*$`, 'm').test(header[1])) fail(`в шапке SKILL.md должно быть name: ${NAME}`);
if (!/^description:\s*\S/m.test(header[1])) fail('в шапке SKILL.md нет description');

// Инструкции для проекта: тело скилла без шапки, первой строкой — заголовок.
const body = skill.slice(header[0].length).replace(/^\n+/, '');
writeFileSync(instructionsPath, `${INSTRUCTIONS_TITLE}\n\n${body}`, 'utf8');

// Фиксированная дата в файле: zip не меняется от запуска к запуску, пока не поменялся SKILL.md.
const archive = zipSync(
  { [`${NAME}/SKILL.md`]: [strToU8(skill), { level: 9, mtime: new Date(2026, 0, 1, 0, 0, 0) }] },
  {},
);
mkdirSync(skillDir, { recursive: true });
writeFileSync(zipPath, archive);

console.log(`Готово: ${zipPath} (${archive.length} байт)`);
for (const [file, data] of Object.entries(unzipSync(archive))) console.log(`  ${file} — ${data.length} байт`);
console.log(`Готово: ${instructionsPath}`);
