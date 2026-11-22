# Kisr Library — PWA

Личная офлайн-библиотека книг, которые Claude пишет по запросу владельца (Kisr). Это телефонное приложение (PWA) с полкой, читалкой по главам, точным «где остановился», импортом, отметками и резервными копиями. Оно заменяет старое приложение — артефакт в claude.ai.

## Сначала прочитай

- `docs/spec.md` — что строим и почему (все продуктовые решения).
- `docs/book-format.md` — контракт формата книги между скиллом Claude и приложением.
- `docs/superpowers/plans/2026-11-22-kisr-library-pwa.md` — план по задачам.
- `HANDOFF.md` — текущее состояние, что проверено и что нет, известные ограничения, что дальше.
- `README.md` — инструкция для владельца (установка на iPhone, перенос книг, скилл, копии).

## Жёсткие правила

1. **Книги владельца не попадают в git и в интернет.** `migration/` (снимок базы старого приложения, его HTML и старый скилл), `kisr-library/` (выгрузка старой библиотеки, которую сделал владелец: 23 книги в `.md` и `data/*.json`; среди них 2 личные) и любые `*backup*.json` лежат в `.gitignore`. Папки закреплены в корне как `/migration/` и `/kisr-library/`, чтобы маска не задела одноимённые папки в `src/`. Файлы в git добавляй по имени, никогда `git add -A` и `git add .`. Тестовые фикстуры только синтетические. Тесты на реальных данных — через `describe.skipIf(!existsSync('migration/raw'))`.
2. **Совместимость со старым приложением.** Деление текста на главы — как `normalizeMd` в `migration/old-artifact.html`. Ключи абзацев — djb2 → base36 (`hash("Привет, мир") === "5v995x"`), правила в spec §8.3. От этого зависит перенос позиций чтения.
3. **Интерфейс по-русски, на «ты»,** с типографскими знаками («», —, …, неразрывный пробел в «25 мин»).
4. **Офлайн:** никаких CDN во время работы приложения, шрифты локальные (`@fontsource-variable/*`).
5. **Мобильная база** (spec §11): safe-area, `100dvh`, поля ввода ≥ 16px, `:hover` только в `@media (hover: hover) and (pointer: fine)`, зум не запрещать, `user-select: none` только на элементах управления.
6. **Данные не теряем:** запись книги — одна транзакция IndexedDB; удаление — после окна отмены 6 с; обновление книги сохраняет id, прогресс и отметки.
7. Публикация (GitHub-репозиторий, Pages, push) — только с согласия владельца.

## Стек и структура

Vite + TypeScript (strict) + Preact + `@preact/signals`, `idb`, `marked` + `dompurify`, `vite-plugin-pwa` (injectManifest, `src/sw.ts`), Vitest (+ jsdom, fake-indexeddb), Playwright.

```
src/core/       чистая логика без DOM и IndexedDB (парсер, время, прогресс, дубли, копии, поиск) — покрыта тестами
src/db/         IndexedDB (`kisr-library`): books, chapters, progress, marks, tasks, settings, inbox
src/state/      сигналы + действия (library, settings); UI читает только их
src/router.ts   свой маленький роутер на `location.hash` (история, «назад», прокрутка)
src/pwa.ts      регистрация service worker и сигнал «ждёт обновление»; сам SW — `src/sw.ts`
src/markdown/   рендер Markdown, ключи блоков, чекбоксы, колода карточек
src/features/   экраны: library, book, reader, search, add, notes, settings (CSS и тесты рядом с компонентами)
src/ui/         общие компоненты (Sheet, TabBar, Toast, Button…)
src/migration/  перенос из старого приложения (чистая функция)
scripts/        migrate-from-artifact.ts, make-icons.mjs, pack-skill.mjs
assets/         исходник иконки (`icon.svg`); PNG-иконки собираются в `public/icons/`
claude-skill/   скилл Claude v2 («скрипт», который пишет книги в нужном формате) и его zip
e2e/            Playwright (проекты iphone/WebKit и android/Chromium)
docs/           spec.md, book-format.md, superpowers/plans/ (план по задачам)
.github/workflows/deploy.yml   тесты → сборка → GitHub Pages при push в main
.superpowers/   служебная папка процесса разработки (журнал решений, задания и отчёты по задачам); сама себя исключает из git (`.superpowers/sdd/.gitignore`), не коммитить, для работы приложения не нужна
```

## Команды

- `npm run dev` — разработка (http://localhost:5173)
- `npm test` — юнит-тесты (Vitest, один прогон); `npm run test:watch` — в режиме наблюдения. Тесты на реальных данных пропускаются сами, если нет `migration/` и `kisr-library/` (так и должно быть на CI)
- `npm run typecheck` — проверка типов (входит и в `npm run build`: `tsc --noEmit && vite build`)
- `npm run build` / `npm run preview` — сборка и просмотр (SW работает только в preview); на GitHub Pages сборка идёт с `BASE_PATH=/<репозиторий>/`
- `npm run e2e` — Playwright (собирает проект и гоняет сценарии в WebKit/iPhone и Chromium/Android)
- `npm run migrate` — `migration/raw` → `migration/kisr-library-backup-migrated.json`
- `npm run icons` — PNG-иконки из `assets/icon.svg`
- `npm run skill` — `claude-skill/kisr-library-razbor.zip`

## Как работать

- TDD для `src/core`, `src/db`, `src/markdown`: сначала тест, потом код.
- После каждой задачи — `npm test && npm run typecheck && npm run build` зелёные, затем коммит (conventional commits, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Путь проекта содержит пробелы: в скриптах кавычки и `path.join`.
- Среда — Windows: в Bash-скриптах POSIX-синтаксис; Python запускать с `-I`, а для кириллицы в выводе — `sys.stdout.reconfigure(encoding="utf-8")`.
- Проверяй UI в мобильном окне (390×844) в светлой и тёмной теме. Окончательная проверка — на реальном iPhone, её делает владелец.
- Обновляй `HANDOFF.md`, когда закончил крупный кусок.
