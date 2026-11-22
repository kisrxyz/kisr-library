# Kisr Library PWA — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** офлайн-PWA «Kisr Library»: личная библиотека книг от Claude с полкой, читалкой по главам, точным «где остановился», импортом, резервными копиями и переносом 23 книг из старого артефакта.

**Architecture:** статическое SPA на Vite + Preact. Все данные лежат в IndexedDB на устройстве. Чистая логика (`src/core`) отделена от хранилища (`src/db`), состояния на сигналах (`src/state`) и экранов (`src/features/*`). Service worker из `src/sw.ts` (injectManifest) кэширует сборку и принимает share target на Android. Хостинг — GitHub Pages.

**Tech Stack:** Node 24, npm, Vite, TypeScript (strict), Preact + `@preact/preset-vite` + `@preact/signals`, `idb`, `marked`, `dompurify`, `vite-plugin-pwa` (injectManifest, workbox-precaching), `@fontsource-variable/{literata,golos-text,unbounded}`, Vitest + `jsdom` + `fake-indexeddb`, Playwright, `tsx`, `sharp` (иконки), `fflate` (zip скилла).

**Spec:** `docs/spec.md` и `docs/book-format.md`. Перед любой задачей прочитай обе. Старое приложение для сверки и переноса логики — `migration/old-artifact.html` (только локально, в git не попадает).

## Global Constraints

- Интерфейс только по-русски, на «ты», с типографскими знаками («ёлочки», —, …, неразрывный пробел перед «мин»). Английских строк в UI нет.
- Книги и личные данные никогда не попадают в git и в `public/`: `migration/` и `*backup*.json` в `.gitignore`. Фикстуры тестов синтетические. Тесты на реальных данных пропускаются, если нет `migration/raw` (`describe.skipIf(!existsSync(...))`).
- Деление на главы — ровно как `normalizeMd` старого приложения (`docs/book-format.md`, «Что приложение прощает»).
- Ключи блоков — ровно по spec §8.3 (`hash` = djb2 → base36; `hash("Привет, мир") === "5v995x"`, `hash("") === "45h"`, `hash("abc") === "3772q3"`).
- Слова `/[\p{L}\p{N}]+/gu`; скорость по умолчанию 180 слов/мин; минуты `max(1, ceil(words / wpm))`.
- Мобильная база из spec §11: `viewport-fit=cover`, safe-area, `100dvh`, поля ввода ≥ 16px, без tap-highlight, `:hover` только внутри `@media (hover: hover) and (pointer: fine)`, `:active` как отклик, зум не запрещать, `user-select: none` только на элементах управления.
- Шрифты и все ресурсы локальные. Во время работы приложения никаких CDN: оно должно работать офлайн.
- Роутинг на `location.hash`. `base` в Vite = `process.env.BASE_PATH || '/'`.
- Стартовый JS ≤ 120 КБ gzip (проверка: вывод `npm run build`).
- Удалять книгу только после окончания окна отмены (6 с). Каждая запись книги — одна транзакция IndexedDB.
- Команды: `npm test` (vitest run), `npm run typecheck` (`tsc --noEmit`), `npm run build`, `npm run e2e`. Перед коммитом всё зелёное.
- Путь проекта содержит пробелы (`c:\chil bro\kisrs library`): в скриптах всегда кавычки и `path.join`.
- Коммит после каждой задачи. Сообщение в стиле conventional commits, последняя строка: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Ответ Claude, скопированный «как есть»** (вступительная фраза перед шапкой, обёртка в ```` ```markdown ````, CRLF, неразрывные пробелы, хвост «Хочешь, сделаю…» после источников) должен импортироваться с правильным названием и главами. Тест в задаче 2.
2. **Смена размера шрифта или поворот экрана, потом снова открыть книгу** — открывается тот же абзац (по ключу), а не те же пиксели. Тест в задаче 8 (юнит на `findAnchor`) и в задаче 15 (e2e: поменять размер → перезагрузить → тот же блок виден).
3. **Повторный импорт обновлённой книги, которую читаешь** (то же название, глав стало меньше): прогресс и отметки сохраняются, глава прогресса ограничивается, ничего не падает. Тест в задаче 3 (`applyResolution` + `clampProgress`).
4. **Приложение убито свайпом без `visibilitychange`** — позиция уже сохранена троттлингом прокрутки. Тест в задаче 15 (e2e: прокрутить → ждать 500 мс → перезагрузить).
5. **Дважды восстановить одну и ту же копию** — дублей нет, итог «Добавлено 0, обновлено 0, пропущено N». Тест в задаче 3.

---

## Карта файлов

```
index.html                         мета, точка входа
vite.config.ts  vitest.config.ts  tsconfig.json  playwright.config.ts
src/main.tsx                       render(<App/>), загрузка библиотеки, регистрация SW
src/app.tsx                        оболочка: экран по маршруту + TabBar + Toasts
src/router.ts                      хеш-роутер на сигналах
src/styles/tokens.css base.css     темы, шрифты, мобильная база, роли текста
src/ui/                            Icon, Button, Sheet, TabBar, Toast(+state), Segmented, Chip, ProgressBar, TopBar, EmptyState
src/core/                          чистая логика (без DOM и IDB): types, text, time, cards, parse, book, progress, library, duplicates, backup, search
src/db/                            schema, books, progress, marks, tasks, settings, inbox, backup
src/state/                         library.ts, settings.ts (сигналы + действия)
src/markdown/                      render.ts, enhance.ts, deck.ts
src/features/library|book|reader|search|add|notes|settings/   экраны
src/migration/convertArtifact.ts   выгрузка артефакта → BackupFile (чистая функция)
src/sw.ts  src/pwa.ts              service worker, регистрация и обновление
scripts/                           migrate-from-artifact.ts, make-icons.mjs, pack-skill.mjs
e2e/                               сценарии Playwright + fixtures
claude-skill/                      скилл v2 + project-instructions.md
.github/workflows/deploy.yml
```

---

### Task 1: Каркас, оболочка, роутер, UI-кит

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/app.tsx`, `src/router.ts`, `src/router.test.ts`, `src/styles/tokens.css`, `src/styles/base.css`, `src/ui/{Icon,Button,Sheet,TabBar,Toast,Segmented,Chip,ProgressBar,TopBar,EmptyState}.tsx` (+ `.css` рядом), `src/ui/toast-state.ts`, `src/features/{library/LibraryScreen,book/BookScreen,reader/ReaderScreen,search/SearchScreen,add/AddScreen,notes/NotesScreen,settings/SettingsScreen}.tsx` (заглушки)

**Interfaces:**
- Produces:
  - `type Route = {name:'library'; params: URLSearchParams} | {name:'book'; id:string} | {name:'read'; id:string; chapter:number; find?:string; block?:string} | {name:'search'; q:string} | {name:'add'; shared:boolean} | {name:'notes'; tab:'marks'|'actions'} | {name:'settings'}`
  - `parseHash(hash: string): Route`, `toHash(r: Route): string`, `route: Signal<Route>`, `navigate(to: Route | string, opts?: {replace?: boolean}): void`, `goBack(fallback: Route): void` (если в истории есть запись этого приложения — `history.back()`, иначе `navigate(fallback, {replace:true})`)
  - `rememberScroll(key: string): void`, `restoreScroll(key: string): void` (позиция `window.scrollY` по ключу маршрута, в памяти)
  - UI: `<Icon name="menu|search|home|star|note|spark|plus|close|left|right|shuffle|list|cards|send|trash|more|upload|copy|book|check|paste|settings|library|clock|filter|sort|share"/>` (пути из `ICONS` в `old-artifact.html` ~строка 410 + недостающие в том же штриховом стиле 24×24, `stroke-width 1.9`); `<Button variant="primary|ghost|plain" icon? wide?>`; `<Sheet open title onClose>` (шторка снизу: scrim, фокус-ловушка, Esc, возврат фокуса, `overscroll-behavior: contain`, `max-height: 88dvh`, нижний отступ `env(safe-area-inset-bottom)`); `<TabBar/>` (5 вкладок: Полка, Поиск, Добавить, Заметки, Ещё; скрыта на `read`); `toast(text: string, action?: {label: string; run: () => void}, ms = 4000): void` + `<Toasts/>`; `<Segmented options value onChange/>`; `<Chip active count/>`; `<ProgressBar value /* 0..100 */ />`; `<TopBar back? title? actions?/>`; `<EmptyState title text action?/>`

- [ ] **Step 1: Создать проект и поставить зависимости**

`npm init -y`, затем `npm i preact @preact/signals idb marked dompurify @fontsource-variable/literata @fontsource-variable/golos-text @fontsource-variable/unbounded` и `npm i -D vite @preact/preset-vite typescript vitest jsdom fake-indexeddb @types/dompurify vite-plugin-pwa workbox-precaching workbox-core tsx @playwright/test sharp fflate`. Берём свежие стабильные версии. Если `vite-plugin-pwa` не поддерживает самую новую мажорную версию Vite, ставим самую новую из поддерживаемых. Скрипты: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`), `test:watch`, `typecheck`, `e2e` (`playwright test`), `migrate` (`tsx scripts/migrate-from-artifact.ts`), `icons` (`node scripts/make-icons.mjs`), `skill` (`node scripts/pack-skill.mjs`). В `tsconfig` — `strict`, `jsx: react-jsx`, `jsxImportSource: preact`, `moduleResolution: bundler`, `types: ["vite/client"]`. В `vitest.config.ts` по умолчанию окружение `node`; тесты DOM ставят `// @vitest-environment jsdom`; `setupFiles` подключает `fake-indexeddb/auto`.

- [ ] **Step 2: Написать падающие тесты роутера** (`src/router.test.ts`)

```ts
expect(parseHash('')).toEqual({ name: 'library', params: new URLSearchParams() });
expect(parseHash('#/book/vredno-li-begat-mwkkoeik')).toEqual({ name: 'book', id: 'vredno-li-begat-mwkkoeik' });
expect(parseHash('#/read/abc/3?find=%D0%BC%D0%B8%D1%84')).toEqual({ name: 'read', id: 'abc', chapter: 3, find: 'миф' });
expect(parseHash('#/read/abc')).toMatchObject({ name: 'read', id: 'abc', chapter: 1 });
expect(parseHash('#/read/abc/2?b=p1i6upg5')).toMatchObject({ chapter: 2, block: 'p1i6upg5' });
expect(parseHash('#/notes?tab=actions')).toEqual({ name: 'notes', tab: 'actions' });
expect(parseHash('#/add?shared=1')).toEqual({ name: 'add', shared: true });
expect(parseHash('#/nonsense')).toMatchObject({ name: 'library' });
for (const r of [/* все варианты выше */]) expect(parseHash(toHash(r))).toEqual(r); // туда-обратно
```

- [ ] **Step 3: Запустить** `npm test` → тесты роутера падают (модуля нет).

- [ ] **Step 4: Реализовать** `src/router.ts`, стили (`tokens.css`: переменные spec §11 для светлой и тёмной темы, «Бумага» как `[data-theme="sepia"]`, авто через `prefers-color-scheme` с защитой `:root:not([data-theme])`; роли текста и переменные читалки `--read-font`, `--read-size`, `--read-line`, `--read-hyphens`; `base.css`: мобильная база из Global Constraints, `body` с явным фоном `--paper`), UI-кит, оболочку `app.tsx` (экран по `route.value.name`, `<TabBar/>`, `<Toasts/>`) и заглушки экранов (заголовок экрана и `EmptyState`). `index.html`: `lang="ru"`, viewport `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`, `theme-color` для light (`#F2F4F1`) и dark (`#0E1412`), `color-scheme`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` = «Kisr Library», `apple-mobile-web-app-status-bar-style=default`. Шрифты импортировать в `main.tsx`. Визуальный язык — из CSS старого приложения (`old-artifact.html`, строки ~22–330) и spec §11.

- [ ] **Step 5: Проверить:** `npm test` (PASS), `npm run typecheck` (0 ошибок), `npm run build` (собирается; размер JS в выводе меньше 60 КБ gzip). `npm run dev` — открыть `http://localhost:5173` в мобильном окне 390×844: 5 вкладок переключают заглушки, тёмная тема по системной настройке.

- [ ] **Step 6: Commit** `feat: scaffold app shell, hash router, UI kit`

---

### Task 2: Ядро — текст, время, карточки, парсер книги

**Files:**
- Create: `src/core/types.ts`, `src/core/text.ts`, `src/core/time.ts`, `src/core/cards.ts`, `src/core/parse.ts`, `src/core/book.ts`, тесты `*.test.ts` рядом, `src/core/__fixtures__/*.md` (синтетические книги)

**Interfaces:**
- Produces (`types.ts`): `BookMeta`, `Chapter`, `Progress`, `Mark`, `TaskState`, `InboxItem` — **ровно** как в spec §6; `type BookOrigin = BookMeta['origin']`; `interface Settings` и `DEFAULT_SETTINGS` (`{theme:'auto', font:'serif', fontSize:18, lineHeight:'normal', hyphens:true, keepAwake:false, wpm:180, sort:'recent', lastBackupAt:null, booksAtLastBackup:0, backupBannerHiddenUntil:null}`); `type SortKey = 'recent'|'added'|'title'|'short'|'long'`
- Produces (`text.ts`): `hash(s: string): string`, `countWords(s: string): number`, `slug(s: string, max = 40): string` (таблица `TR` из старого приложения, включая казахские буквы), `makeBookId(title: string, now = Date.now()): string`, `plural(n, one, few, many): string`, `plainText(md: string): string` (порт), `normalizeForSearch(s: string): string` (нижний регистр, ё→е, без `[#>*_`|]`, пробелы схлопнуты), `normalizeTitle(s: string): string` (`normalizeForSearch` + удалить всё, кроме букв, цифр и пробелов), `formatDate(ts: number): string` (`ru-RU`, `{day:'numeric', month:'short'}` → «17 нояб.»)
- Produces (`time.ts`): `DEFAULT_WPM = 180`, `minutesFor(words: number, wpm = DEFAULT_WPM): number`, `minutesLabel(words: number, wpm?: number): string` (→ `"25 мин"` с неразрывным пробелом `\u00A0`), `lengthBucket(words: number, wpm?: number): 'short'|'medium'|'long'` (≤10 / ≤30 / больше)
- Produces (`cards.ts`): `parseCards(text: string): {q: string; a: string}[]` (порт), `countCards(md: string): number` (`/^\s*(Q|В)\s*:/gm`), `countTasks(md: string): number` (`/^\s*[-*] \[[ xX]\]/gm`)
- Produces (`parse.ts`): `interface ParsedChapter {title: string; md: string}`, `interface ParsedBook {title; category; tags: string[]; summary; source; level?: string; part?: {n: number; of?: number}; chapters: ParsedChapter[]; warnings: string[]}`, `parseFront(md: string): {meta: Record<string, string | string[]>; body: string}`, `splitBooks(raw: string): string[]`, `parseBook(raw: string, opts?: {fileName?: string}): ParsedBook`, `reassemble(meta: Pick<BookMeta,'title'|'category'|'tags'|'summary'|'source'> & {level?: string}, chapters: ParsedChapter[]): string`
- Produces (`book.ts`): `contentHashOf(chapters: ParsedChapter[]): string` (= `hash(chapters.map(c => c.title + '\n' + c.md).join('\n\n'))`), `buildBook(parsed: ParsedBook, opts: {origin: BookOrigin; id?: string; now?: number; createdAt?: number}): {meta: BookMeta; chapters: Chapter[]}` (id по умолчанию `makeBookId(title, now)`, главы `${id}--NN` с `order` от 1, `words`/`cards`/`tasks` посчитаны, `favorite: false`, `category || 'Разное'`), `isServiceChapter(title: string): boolean` (`/^(Источники|Литература|Карточки)$/i`), `callNumbers(books: BookMeta[]): Map<string, string>` (порт `callNumbers()`: код раздела — первые 3 буквы/цифры в верхнем регистре или `КН`, номер `·NN` по `createdAt` внутри раздела)

- [ ] **Step 1: Падающие тесты `text.test.ts`, `time.test.ts`, `cards.test.ts`**

```ts
expect(hash('Привет, мир')).toBe('5v995x'); expect(hash('')).toBe('45h'); expect(hash('abc')).toBe('3772q3');
expect(slug('Как реально заработать в 2026: глубокий разбор без инфоцыган')).toBe('kak-realno-zarabotat-v-2026-glubokiy-raz');
expect(slug('Стоицизм: как жить твёрдо')).toBe('stoitsizm-kak-zhit-tverdo');
expect(slug('!!!')).toBe('item'); expect(slug('Қазақ тілі және әліпби')).toBe('kazak-tili-zhane-alipbi');
expect(makeBookId('Вредно ли бегать', 1794890055494)).toBe('vredno-li-begat-mwk772h2');
expect(countWords('Привет, мир! 2026 год — время C++ и ёжиков')).toBe(8);
expect(plural(1,'глава','главы','глав')).toBe('глава'); expect(plural(3,'глава','главы','глав')).toBe('главы'); expect(plural(11,'глава','главы','глав')).toBe('глав'); expect(plural(22,'глава','главы','глав')).toBe('главы');
expect(normalizeTitle('Стоицизм: как жить ТВЁРДО!')).toBe('стоицизм как жить твердо');
expect(minutesFor(0)).toBe(1); expect(minutesFor(180)).toBe(1); expect(minutesFor(181)).toBe(2); expect(minutesFor(4581)).toBe(26); expect(minutesFor(8966)).toBe(50);
expect(minutesLabel(4581)).toBe('26\u00A0мин');
expect(lengthBucket(1800)).toBe('short'); expect(lengthBucket(1801)).toBe('medium'); expect(lengthBucket(5401)).toBe('long');
expect(parseCards('Q: Что такое HRV?\nA: Разброс интервалов\nмежду ударами\n\nВ: Второй?\nО: Да')).toEqual([{q:'Что такое HRV?', a:'Разброс интервалов между ударами'}, {q:'Второй?', a:'Да'}]);
expect(countTasks('- [ ] один\n- [x] два\n* [ ] три\n- обычный')).toBe(3);
```

- [ ] **Step 2: Падающие тесты `parse.test.ts`** на синтетических фикстурах (`__fixtures__/full.md` — книга по шаблону `book-format.md` с вступлением 50+ слов, 4 главами, ```` ```cards ```` с 3 парами, 2 задачами, «## Источники»):
  - `full.md`: title/category/tags/summary/source из шапки; главы `['Вступление','Коротко','Раздел один','Раздел два','Карточки','Источники']`; `warnings` пустой.
  - Короткое вступление (< 40 слов) приклеивается к первой `##`-главе, и «Вступление» исчезает.
  - Без шапки, с `# Заголовок` → `title === 'Заголовок'`, `category === ''` (в `buildBook` станет «Разное»), в `warnings` есть «Нет шапки».
  - **Review Focus 1:** текст `"Вот разбор:\r\n\r\n```markdown\r\n---\r\ntitle: Тест\r\n---\r\nВступление…\r\n## Глава\r\nтекст\u00A0текст\r\n```\r\n"` → `title === 'Тест'`, одна или две главы, никаких ```` ``` ```` в `md`. Хвост «Хочешь, сделаю продолжение?» после последней главы остаётся внутри неё, а не становится главой.
  - Английские заголовки: `## TL;DR` → «Коротко», `## Sources` → «Источники», `## Key findings` → «Главное».
  - Нет `##`, но есть `###` → главы из `###`. Нет ни того ни другого → одна глава «Текст».
  - Глава на 1500 слов с тремя `###` делится (`splitLong`): ни одной части больше 1000 слов, если её можно было разбить.
  - `part: 2/3` → `{n: 2, of: 3}`; `part: 2` → `{n: 2}`.
  - `splitBooks` на двух книгах подряд (вторая начинается с `\n---\ntitle:`) → 2 строки. На одной книге → 1.
  - `reassemble(...)` → `parseBook` даёт те же главы (туда-обратно).
  - `describe.skipIf(!existsSync('migration/raw/sections'))`: для каждой статьи из `migration/raw/articles` собрать главы из `sections`, `reassemble` → `parseBook` → те же названия и число глав.

- [ ] **Step 3: Падающие тесты `book.test.ts`:** `buildBook` на `full.md` с `now = 1794890055494` → `meta.id` начинается со `slug(title)`, `chapters[0].id === meta.id + '--01'`, `meta.words === сумма words глав`, `meta.cards === 3`, `meta.tasks === 2`, `contentHash` одинаковый для одинакового текста и разный при изменении одной буквы; `isServiceChapter('Источники') === true`, `isServiceChapter('Коротко') === false`; `callNumbers` для двух книг раздела «Философия» с `createdAt` 1 и 2 → `ФИЛ·01`, `ФИЛ·02`.

- [ ] **Step 4: Запустить** `npm test` → новые тесты падают.

- [ ] **Step 5: Реализовать** модули. Парсер — перенос 1:1 функций `cleanModelMd`, `parseFront`, `splitSections`, `HEADS`/`ruTitle`, `cleanSecMd`, `smartSummary`, `splitLong`, `normalizeMd`, `reassemble` из `migration/old-artifact.html` (строки ~472–900) на TypeScript, плюс отбрасывание мусора до шапки (spec §7.1), `part`, `level` и предупреждения: «Нет шапки: название взято из …», «Нет глав (##): весь текст — одна глава», «Карточек нет».

- [ ] **Step 6: Запустить** `npm test` и `npm run typecheck` → PASS.

- [ ] **Step 7: Commit** `feat(core): text utils, reading time, cards, book parser compatible with old app`

---

### Task 3: Хранилище, состояние, прогресс, дубли, резервная копия

**Files:**
- Create: `src/core/progress.ts`, `src/core/duplicates.ts`, `src/core/backup.ts`, `src/db/{schema,books,progress,marks,tasks,settings,inbox,backup}.ts`, `src/state/library.ts`, `src/state/settings.ts`, тесты рядом (`src/db/*.test.ts` используют `fake-indexeddb`; перед каждым тестом `indexedDB = new IDBFactory()` и сброс singleton `openDb`)

**Interfaces:**
- Consumes: типы и функции задачи 2.
- Produces (`core/progress.ts`): `chapterStartWords(meta: BookMeta, chapter: number): number`; `percentOf(meta: BookMeta, wordsRead: number): number` (0..100, округление; у finished — 100); `remainingWords(meta, wordsRead): number`; `bookStatus(p?: Progress): 'new'|'reading'|'finished'`; `lastRequiredChapter(meta: BookMeta): number` (последняя не служебная глава, иначе последняя); `newProgress(bookId: string, now: number): Progress`; `clampProgress(p: Progress, meta: BookMeta): Progress` (chapter и maxChapter ≤ числа глав, `chaptersDone` отфильтрованы, `wordsRead` ≤ `meta.words`, `percent` пересчитан); `markChapterDone(p: Progress, chapter: number, meta: BookMeta, now: number): {progress: Progress; finishedNow: boolean}` (finished, когда дочитана `lastRequiredChapter`)
- Produces (`core/duplicates.ts`): `type Resolution = 'update'|'append'|'separate'|'skip'`; `findDuplicate(parsed: ParsedBook, contentHash: string, books: BookMeta[]): {kind: 'same-content'|'same-title'; book: BookMeta} | null` (по `contentHash`, затем по `normalizeTitle`); `defaultResolution(parsed: ParsedBook, dup: ReturnType<typeof findDuplicate>): Resolution` (нет дубля → `separate`; same-content → `skip`; same-title и `part.n > 1` → `append`; иначе `update`); `applyResolution(existing: {meta: BookMeta; chapters: Chapter[]}, parsed: ParsedBook, res: 'update'|'append', now: number): {meta: BookMeta; chapters: Chapter[]}` (update: id, `createdAt`, `addedAt`, `favorite`, `action` сохраняются, контент заменяется; append: главы добавляются в конец с перенумерацией, теги объединяются, summary старый; оба: `updatedAt = now`, счётчики и `contentHash` пересчитаны)
- Produces (`core/backup.ts`): `BACKUP_FORMAT = 'kisr-library-backup'`, `BACKUP_VERSION = 1`, `type BackupBook = Omit<BookMeta,'chapters'> & {chapters: {title: string; md: string}[]}`; `interface BackupFile {format; version; exportedAt; app; books: BackupBook[]; progress: Progress[]; marks: Mark[]; tasks: TaskState[]; settings: Partial<Settings>}`; `isBackup(x: unknown): x is BackupFile`; `interface LibrarySnapshot {books: BookMeta[]; progress: Progress[]; marks: Mark[]; tasks: TaskState[]; settings: Partial<Settings>}`; `planMerge(current: LibrarySnapshot, incoming: BackupFile): {putBooks: {meta: BookMeta; chapters: Chapter[]}[]; putProgress: Progress[]; putMarks: Mark[]; putTasks: TaskState[]; settings: Partial<Settings>; report: {added: number; updated: number; skipped: number}}` (правила spec §10.6); `needsBackupReminder(s: Settings, bookCount: number, now: number): boolean` (`bookCount > 0`, баннер не скрыт до `> now`, и одно из: `bookCount - booksAtLastBackup >= 5`; `lastBackupAt !== null && now - lastBackupAt >= 14 дней`; `lastBackupAt === null && bookCount >= 3`)
- Produces (`db/*`): `openDb(): Promise<IDBPDatabase<KisrDB>>` (имя `kisr-library`, версия 1, хранилища и индексы spec §6); `getAllBooks()`, `getChapters(bookId)` (по `order`), `getChapter(bookId, order)`, `getAllChapters()`, `saveBook(meta, chapters)` (одна транзакция: удалить старые главы книги, которых нет в новом наборе, записать meta и главы), `updateBookMeta(id, patch): Promise<BookMeta>`, `deleteBook(id)` (одна транзакция: книга, главы, progress, marks, tasks); `getAllProgress()`, `putProgress(p)`, `deleteProgress(id)`; `getMarks(bookId?)`, `putMark(m)`, `deleteMark(id)`; `getTasks(bookId): Promise<TaskState>`, `setTask(bookId, key, done): Promise<TaskState>`; `getSettings(): Promise<Settings>` (слияние с `DEFAULT_SETTINGS`), `setSettings(patch: Partial<Settings>)`; `putInbox(item)`, `takeInbox(): Promise<InboxItem[]>`; `exportBackup(app: string): Promise<BackupFile>`, `importBackup(file: BackupFile): Promise<{added; updated; skipped}>`
- Produces (`state/library.ts`): сигналы `books: Signal<BookMeta[]>`, `progressMap: Signal<Map<string, Progress>>`, `libraryReady: Signal<boolean>`; действия `loadLibrary()`, `saveImportedBook(meta, chapters)`, `toggleFavorite(id)`, `editBookMeta(id, patch)`, `scheduleDelete(id): void` (скрыть сразу, удалить из БД через 6 с), `undoDelete(id)`, `saveProgress(p)`, `setFinished(id, finished: boolean)`, `setBookAction(id, action)`, `reloadAfterRestore()`
- Produces (`state/settings.ts`): `settings: Signal<Settings>`, `loadSettings()`, `updateSettings(patch)` (пишет в БД и применяет: `data-theme` на `<html>` (у auto — снять атрибут), CSS-переменные читалки, `theme-color` = вычисленный `--paper`)

- [ ] **Step 1: Падающие тесты `core/progress.test.ts`:** книга из 4 глав по 100 слов, последняя — «Источники». `chapterStartWords(meta, 3) === 200`; `percentOf(meta, 200) === 50`; `lastRequiredChapter === 3`; `markChapterDone` главы 3 → `finishedNow === true`, `status === 'finished'`, `percent === 100`; `clampProgress` с `chapter: 9` для книги из 4 глав → `chapter === 4`, `maxChapter <= 4`.

- [ ] **Step 2: Падающие тесты `core/duplicates.test.ts`:** тот же `contentHash` → `same-content` и `skip`; название «Стоицизм: как жить твёрдо» против «стоицизм — как жить твердо» → `same-title` и `update`; `part {n:2}` → `append`. **Review Focus 3:** `applyResolution('update')` книги из 5 глав на 3 главы сохраняет `id`, `favorite: true`, `action`, `createdAt`, и `clampProgress` прогресса с `chapter: 5` даёт `chapter: 3`. `append` 2 + 2 главы → 4 главы с id `--01..--04`.

- [ ] **Step 3: Падающие тесты `core/backup.test.ts`:** `isBackup` на правильном и неправильном объекте; `planMerge` пустой библиотеки и файла с 2 книгами → `added 2`; **Review Focus 5:** повторный `planMerge` того же файла поверх результата → `added 0, updated 0, skipped 2`, `putBooks` пустой; книга в файле с бо́льшим `updatedAt` → `updated 1`; прогресс побеждает по `lastReadAt`. `needsBackupReminder`: 0 книг → false; 5 книг, `booksAtLastBackup 0`, копий не было → true; скрыт до завтра → false.

- [ ] **Step 4: Падающие тесты `db/*.test.ts`:** `saveBook` → `getAllBooks` и `getChapters` (сортировка по `order`); повторный `saveBook` с меньшим числом глав удаляет лишние главы; `deleteBook` удаляет главы, прогресс, отметки и задачи; `setTask` туда и обратно; `getSettings` без записей возвращает `DEFAULT_SETTINGS`; `takeInbox` возвращает и очищает; `exportBackup` → `importBackup` в чистую базу → те же книги, главы и прогресс.

- [ ] **Step 5: Запустить** `npm test` → падают.

- [ ] **Step 6: Реализовать** модули по Interfaces.

- [ ] **Step 7: Подключить** в `main.tsx`: `await Promise.all([loadSettings(), loadLibrary()])` до первого рендера экранов (до этого — пустая оболочка без мигания).

- [ ] **Step 8: Запустить** `npm test`, `npm run typecheck`, `npm run build` → PASS.

- [ ] **Step 9: Commit** `feat(data): IndexedDB storage, signals state, progress, duplicates, backup merge`

---

### Task 4: Перенос из старого приложения

**Files:**
- Create: `src/migration/convertArtifact.ts`, `src/migration/convertArtifact.test.ts`, `src/migration/__fixtures__/raw-mini/` (синтетическая мини-выгрузка той же структуры: 2 статьи, 5 глав, 1 `pa-`/`ps-` книга, 1 `r-`, `prefs`, 1 `bk-`), `scripts/migrate-from-artifact.ts`

**Interfaces:**
- Consumes: `buildBook`-счётчики (`countWords`, `countCards`, `countTasks`, `contentHashOf`), `percentOf`, `chapterStartWords`, `BackupFile`, `BACKUP_FORMAT`, `BACKUP_VERSION`.
- Produces: `interface ArtifactExport {articles: Record<string, any>[]; sections: Record<string, any>[]; user: Record<string, any>[] /* документы data/users/me с полем __id */}`; `readArtifactDir(dir: string): ArtifactExport` (Node fs; `__id` = имя файла без `.json`); `convertArtifact(raw: ArtifactExport, now: number): {backup: BackupFile; summary: {books: number; chapters: number; words: number; progress: number}}`

- [ ] **Step 1: Падающий тест на мини-выгрузке:** 3 книги (2 + 1 личная `pa-`), `bk-` не перенесён; главы по `order`, id `${articleId}--NN`; у книги из `r-` прогресс `chapter = order`, `maxChapter = max`, `blockKey = key`, `status: 'reading'`, `lastReadAt = at`, `percent = percentOf(meta, chapterStartWords(meta, order))`; `pin: true` → `favorite: true`; `settings.fontSize === 18`; `origin === 'migration'`, `addedAt === now`, `createdAt` из статьи.

- [ ] **Step 2: Тест на реальных данных** (`describe.skipIf(!existsSync('migration/raw'))`): `summary.books === 23`, `summary.progress === 5`, ни одна глава не пустая, у `carnegie-shpargalka` `favorite === true` и `blockKey === 'p1i6upg5'`.

- [ ] **Step 3: Запустить** → падает. **Step 4: Реализовать** `convertArtifact.ts` и скрипт: он читает `migration/raw`, пишет `migration/kisr-library-backup-migrated.json` и печатает сводку. **Step 5:** `npm test` → PASS; `npm run migrate` → «книг 23, глав …, прогресс 5», файл создан. Проверить `git status`: файла в индексе нет (он под `.gitignore`).

- [ ] **Step 6: Commit** `feat(migration): convert old artifact export into a backup file` (только код и синтетические фикстуры).

---

### Task 5: Полка

**Files:**
- Create: `src/core/library.ts` (+ тест), `src/features/library/{LibraryScreen,ContinueCard,ReadingNow,BookCard,ShelfFilters,Banners}.tsx` (+ `.css`)
- Modify: `src/features/library/LibraryScreen.tsx` (заглушка → экран)

**Interfaces:**
- Consumes: `books`, `progressMap`, `settings`, `callNumbers`, `minutesFor`, `percentOf`, `remainingWords`, `bookStatus`, `needsBackupReminder`, роутер, UI-кит.
- Produces (`core/library.ts`): `type StatusFilter = 'all'|'reading'|'new'|'finished'|'fav'`; `type LengthFilter = 'any'|'short'|'medium'|'long'`; `interface ShelfQuery {status: StatusFilter; category: string | null; length: LengthFilter; sort: SortKey}`; `filterBooks(books, progress: Map<string, Progress>, q: ShelfQuery, wpm: number): BookMeta[]` (сортировка recent = по убыванию `max(lastReadAt ?? 0, addedAt)`, added = `addedAt` убыв., title = `localeCompare(…, 'ru')`, short/long = по `words`); `categoryCounts(books): {name: string; count: number}[]` (по убыванию числа, затем по имени); `statusCounts(books, progress): Record<StatusFilter, number>`; `continueReading(books, progress): {book: BookMeta; progress: Progress} | null` (самый свежий `reading`); `readingNow(books, progress, limit = 5)` (остальные `reading` по `lastReadAt`); `isNew(book, progress?, now): boolean` (`addedAt` в пределах 3 суток и нет прогресса). Состояние фильтров живёт в query маршрута `#/?status=&cat=&len=&sort=`.

- [ ] **Step 1: Падающие тесты `core/library.test.ts`** на 6 синтетических книгах (разные разделы, длины, прогрессы): каждый фильтр статуса, раздел, длина, все 5 сортировок; `categoryCounts` порядок; `continueReading` выбирает самый свежий `lastReadAt` среди reading; `isNew`. Производительность: 500 синтетических книг, `filterBooks` быстрее 20 мс (`performance.now()`).
- [ ] **Step 2: Запустить** → падают. **Step 3: Реализовать** `core/library.ts` → PASS.
- [ ] **Step 4: Реализовать экран** по spec §10.1: шапка со знаком «Kisr Library» (Unbounded) и «+»; `ContinueCard` (раздел и шифр, название, «Глава N · <название>», `snippet` в «ёлочках» на 2 строки (Literata), `ProgressBar`, «42% · ещё 14 мин», нажатие → `#/read/:id/:chapter?b=:blockKey`); `ReadingNow`; сегменты статуса с числами; фишки разделов (горизонтальный скролл, `scroll-snap`, при числе разделов больше 12 — «Все разделы…» в `Sheet`); сортировка и длина в одной `Sheet` «Сортировка и фильтр»; `BookCard` (spec §10.1, `content-visibility: auto; contain-intrinsic-size: auto 150px`); пустая полка с онбордингом; `Banners`: резервная копия (`needsBackupReminder`, «Сделать копию» → `#/settings`, «Позже» → `backupBannerHiddenUntil = now + 7 дней`) и «Установи на экран «Домой»» (iOS, не standalone: `navigator.standalone !== true && !matchMedia('(display-mode: standalone)').matches && /iPhone|iPad/.test(navigator.userAgent)`). При уходе с экрана и при возврате — `rememberScroll`/`restoreScroll('library')`.
- [ ] **Step 5: Проверить:** `npm test`, `npm run typecheck`. В `npm run dev` с данными: в консоли разработчика вызвать `importBackup` с `migration/kisr-library-backup-migrated.json` (или временной кнопкой отладки, которую потом удалить) → 23 книги, «Продолжить» показывает книгу с самым свежим прогрессом, фильтры работают. Скриншот на 390×844 в светлой и тёмной теме.
- [ ] **Step 6: Commit** `feat(library): shelf with continue reading, status, categories, sort and filters`

---

### Task 6: Страница книги

**Files:**
- Create: `src/features/book/{BookScreen,ChapterList,EditBookSheet,BookMenu}.tsx` (+ `.css`), `src/features/book/exportMd.ts`
- Modify: `src/features/book/BookScreen.tsx`

**Interfaces:**
- Consumes: `books`, `progressMap`, `toggleFavorite`, `editBookMeta`, `scheduleDelete`, `undoDelete`, `setFinished`, `setBookAction`, `getChapters`, `reassemble`, `callNumbers`, `minutesLabel`, `percentOf`, `isServiceChapter`, UI-кит.
- Produces: `<ChapterList book progress onOpen(order)/>` — используется и в оглавлении читалки (задача 9): номер, название (сдвиг вправо у `^\d+\.\d+`), минуты, статус ✓/●/○; `exportBookMd(bookId: string): Promise<{name: string; text: string}>` (имя `${slug(title)}.md`) и `shareOrDownload(name: string, data: Blob): Promise<void>` (`navigator.canShare({files})` → `navigator.share`, иначе скачивание через `<a download>`) — общий помощник, кладётся в `src/ui/share.ts`.

- [ ] **Step 1: Падающий тест** `exportMd.test.ts` (jsdom + fake-indexeddb): сохранённая книга → `exportBookMd` → `parseBook(text)` даёт те же названия глав и шапку.
- [ ] **Step 2: Реализовать** экран по spec §10.2: «‹ Полка» (`goBack({name:'library', …})`), ★, «⋯» (Изменить → `EditBookSheet`: название, раздел — выбор из `categoryCounts` или новый, теги через запятую; Экспорт .md; Удалить → подтверждение в `Sheet` → `scheduleDelete` → тост «Удалено · Вернуть» с `undoDelete` → переход на полку); шифр, раздел, название (Literata 600, `text-wrap: balance`), описание, строка мета; главная кнопка «Начать читать» / «Продолжить · гл. N, P%» / «Читать заново» (у прочитанной: сначала гл. 1, прогресс не сбрасывается до прокрутки); `ProgressBar`; `ChapterList`; теги-фишки → `#/search?q=<тег>`; `source`; блок «Прочитано 17 нояб.» и «одно действие» (редактирование и галочка «сделано»).
- [ ] **Step 3: Проверить** `npm test`, `npm run typecheck`, вручную в `dev`: все действия, отмена удаления возвращает книгу, экспорт отдаёт файл.
- [ ] **Step 4: Commit** `feat(book): book page with chapters, actions, export, delete with undo`

---

### Task 7: Markdown — рендер и обогащение главы

**Files:**
- Create: `src/markdown/render.ts`, `src/markdown/enhance.ts`, `src/markdown/deck.ts`, `src/markdown/markdown.css`, тесты `src/markdown/*.test.ts` (`// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: `hash`, `countWords`, `parseCards`.
- Produces: `renderMarkdown(md: string): string` (marked GFM, `breaks: false` → DOMPurify с `ADD_TAGS: ['input']`, `ADD_ATTR: ['type','checked','disabled','start']`); `ownText(el: Element): string`; `blockKey(el: Element): string | null`; `interface EnhanceResult {anchors: HTMLElement[]; wordsBefore: number[] /* слов главы до начала anchors[i] */; words: number[] /* слов в anchors[i] */}`; `enhanceChapter(root: HTMLElement, ctx: {tasksDone: Record<string, true>; onTask: (key: string, done: boolean) => void}): EnhanceResult` (таблицы → `div.table-wrap`; ссылки → `target=_blank rel=noopener`; ```` ```cards ```` → `buildDeck`; задачи → чекбоксы с ключом `"t"+hash`; ключи блоков → `data-key`; правила spec §8.3); `buildDeck(cards: {q: string; a: string}[]): HTMLElement` (порт `buildDeck` старого приложения на чистом DOM: переворот, назад/дальше, счётчик, перемешать, списком; кнопки ≥ 44px, `aria-live` для счётчика).

- [ ] **Step 1: Падающие тесты:** `renderMarkdown('<script>alert(1)</script>\n\nтекст')` не содержит `<script>`; таблица GFM рендерится и после `enhanceChapter` лежит внутри `.table-wrap`; `- [ ] шаг` → `input[type=checkbox]`, при `tasksDone = {['t'+hash('шаг')]: true}` он `checked`, `change` вызывает `onTask('t'+hash('шаг'), false)`; абзац `Привет, мир` получает `data-key="p5v995x"`; `p` внутри `li` ключа не получает, а сам `li` получает `l…`; блок в ```` ```cards ```` заменён на `.deck`, и в колоде ключей нет; `anchors.length` совпадает с числом `[data-key]`; `wordsBefore[0] === 0`, `wordsBefore[i+1] === wordsBefore[i] + words[i]`.
- [ ] **Step 2: Тест совместимости** (`describe.skipIf(!existsSync('migration/raw/sections'))`): для 4 пар (глава → ключ) из `migration/raw/data/users/me/r-*.json` (у главы `order`) ключ находится среди `data-key` после `renderMarkdown` + `enhanceChapter`. Ожидаемые: `pochemu-ne-poluchaetsya-vyuchit-angliysk-mwkkoblt--01` → `pedkclj`, `pochemu-evrei-kazhutsya-takimi-mogusches-mwkknz6u--01` → `h1xsfv7q`, `carnegie-shpargalka--05` → `p1i6upg5`, `vstuplenie-mwkhjndt--09` → `l1bf2vkx`.
- [ ] **Step 3: Запустить** → падают. **Step 4: Реализовать.** Стили `.prose` — роли spec §8.2 на CSS-переменных из задачи 1 (`font-family: var(--read-font)`, `font-size: var(--read-size)`, `line-height: var(--read-line)`, `hyphens: var(--read-hyphens)`, `max-width: 65ch`, `text-wrap: pretty` у `p`, таблицы, цитаты, код, отметки `.mk`, `.has-note`, `.sel`, вспышка `.flash-hit` с `prefers-reduced-motion`). **Step 5:** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat(markdown): safe rendering, block keys compatible with old app, tasks, flashcard deck`

---

### Task 8: Читалка — глава, позиция, навигация, завершение

**Files:**
- Create: `src/features/reader/{ReaderScreen,ReaderTopBar,ChapterEnd,FinishBlock}.tsx` (+ `reader.css`), `src/features/reader/position.ts` (+ тест), `src/features/reader/usePositionTracking.ts`, `src/features/reader/useAutoHide.ts`
- Modify: `src/features/reader/ReaderScreen.tsx`

**Interfaces:**
- Consumes: `getChapter`, `getTasks`, `setTask`, `renderMarkdown`, `enhanceChapter`, `ownText`, `normalizeForSearch`, `saveProgress`, `markChapterDone`, `newProgress`, `chapterStartWords`, `percentOf`, `remainingWords`, `minutesLabel`, `isServiceChapter`, `lastRequiredChapter`, `setFinished`, `setBookAction`, `settings`, роутер, `toast`.
- Produces (`position.ts`): `interface Rect {top: number; height: number}`; `findAnchor(rects: Rect[], lineY: number): {index: number; offset: number}` (первый, чей низ ниже `lineY`; `offset = clamp((lineY - top) / height, 0, 1)`; нет такого → последний с `offset 1`; пустой массив → `{index: 0, offset: 0}`); `scrollTargetY(absTop: number, height: number, offset: number, headerH: number): number` (= `absTop + offset * height - headerH - 8`, не меньше 0); `wordsAt(res: EnhanceResult, index: number, offset: number): number` (= `wordsBefore[index] + round(offset * words[index])`). Слоты для задачи 9: `<ReaderScreen>` рендерит `props.tocSheet`, `props.settingsSheet` и `props.blockActions` из `features/reader/slots.tsx` (в этой задаче — пустые компоненты).

- [ ] **Step 1: Падающие тесты `position.test.ts`:** блоки `[{top:-50,height:100},{top:50,height:100}]`, `lineY = 0` → `{index:0, offset:0.5}`; `lineY = 60` → `{index:1, offset:0.1}`; `lineY = 1000` → `{index:1, offset:1}`; пустой массив → `{index:0, offset:0}`; **Review Focus 2:** тот же `blockKey`, но высоты блоков в 1,3 раза больше (крупный шрифт) → `scrollTargetY` попадает в начало того же блока плюс `offset`, проверка арифметики; `wordsAt` на заданных `wordsBefore`/`words`.
- [ ] **Step 2: Запустить** → падают. **Step 3: Реализовать** `position.ts` → PASS.
- [ ] **Step 4: Реализовать экран** по spec §8.1, §8.4, §8.5: загрузка главы (`#/read/:id/:chapter`, порядок за пределами глав → ограничить); рендер → `enhanceChapter`; восстановление (после `document.fonts.ready`: `?b=` → `blockKey`, иначе сохранённый прогресс этой главы, иначе начало; `?find=` — первый блок, чей `normalizeForSearch(ownText)` содержит запрос, с подсветкой найденного через `mark`); вспышка блока; `usePositionTracking` (троттлинг 300 мс, плюс `visibilitychange`/`pagehide`/размонтирование; пишет `chapter`, `blockKey`, `blockIndex`, `blockOffset`, `snippet` (первые 140 символов `ownText`), `wordsRead = chapterStartWords + wordsAt`, `percent`, `maxChapter`, `lastReadAt`, `readingMs`; у первого открытия — `newProgress`); IntersectionObserver на «стражнике» конца главы → `markChapterDone` (если `finishedNow` — тост «Книга в «Прочитано» · Отменить» → `setFinished(id, false)`); `useAutoHide` (вниз — прятать, вверх, у начала и у конца — показывать); `ReaderTopBar` («‹» → `#/book/:id`, название, «Глава N из M», кнопки оглавления и «Aa» открывают слоты, тонкая полоса прогресса книги); нижняя плашка «P% · ещё N мин»; `ChapterEnd` («Дальше: <название> · N мин», «‹ Предыдущая глава»); `FinishBlock` в конце последней главы (spec §8.5); клавиши ←/→. TabBar скрыт (задача 1).
- [ ] **Step 5: Проверить** `npm test`, `npm run typecheck`; вручную: открыть перенесённую «Дейл Карнеги» → открывается глава 5 на абзаце «Чтобы быть интересным…»; прокрутить, перезагрузить → то же место; дочитать главу → ✓ в оглавлении книги.
- [ ] **Step 6: Commit** `feat(reader): chapter reader with exact resume, chapter navigation and finishing`

---

### Task 9: Читалка — оглавление, «Aa», отметки и заметки

**Files:**
- Create: `src/features/reader/{TocSheet,ReaderSettingsSheet,BlockActions,NoteSheet}.tsx`, `src/features/reader/marks.ts` (+ тест)
- Modify: `src/features/reader/slots.tsx`

**Interfaces:**
- Consumes: `ChapterList` (задача 6), `settings`/`updateSettings`, `getMarks`, `putMark`, `deleteMark`, `ownText`, `EnhanceResult`.
- Produces (`marks.ts`): `markId(bookId: string, blockKey: string): string` (= `${bookId}|${blockKey}`); `toggleHighlight(bookId: string, chapter: number, el: HTMLElement, now: number): Promise<Mark | null>`; `saveNote(bookId: string, chapter: number, el: HTMLElement, note: string, now: number): Promise<Mark | null>` (пустая заметка без отметки удаляет запись); `paintMarks(root: HTMLElement, marks: Mark[]): void` (классы `.mk` и `.has-note`)

- [ ] **Step 1: Падающие тесты `marks.test.ts`** (jsdom + fake-indexeddb): `toggleHighlight` создаёт отметку с `text` (≤ 400 символов, `ownText`), повторный вызов при пустой заметке удаляет; `saveNote('')` у неотмеченного блока удаляет запись; `paintMarks` ставит классы.
- [ ] **Step 2: Запустить** → падают. **Step 3: Реализовать** `marks.ts` → PASS.
- [ ] **Step 4: Реализовать** `TocSheet` (вкладки «Главы» — `ChapterList` с текущей главой и «Отметки» — отметки этой книги, нажатие → глава и блок), `ReaderSettingsSheet` (spec §8.10; «Не гасить экран» через `navigator.wakeLock.request('screen')` с повторным запросом на `visibilitychange`; если не поддерживается, переключатель скрыт), `BlockActions` (нажатие на блок с `data-key` вне ссылок, чекбоксов, `.deck` и `.table-wrap` → класс `.sel` и нижняя панель «Отметить / Заметка / Копировать / ✕» над safe-area; нажатие мимо закрывает), `NoteSheet` (textarea 16px, «Сохранить»/«Удалить заметку»). Отметки красятся при каждом рендере главы.
- [ ] **Step 5: Проверить** `npm test`, `npm run typecheck`; вручную: отметка и заметка переживают перезагрузку; размер шрифта и тема применяются сразу.
- [ ] **Step 6: Commit** `feat(reader): table of contents, reading settings, highlights and notes`

---

### Task 10: Добавить — импорт и конструктор запроса

**Files:**
- Create: `src/features/add/{AddScreen,ImportPreview,PromptBuilder,HowItWorks}.tsx` (+ `.css`), `src/features/add/importFlow.ts` (+ тест), `src/features/add/prompt.ts` (+ тест)
- Modify: `src/features/add/AddScreen.tsx`

**Interfaces:**
- Consumes: `splitBooks`, `parseBook`, `buildBook`, `contentHashOf`, `findDuplicate`, `defaultResolution`, `applyResolution`, `clampProgress`, `isBackup`, `importBackup`, `saveImportedBook`, `reloadAfterRestore`, `takeInbox`, `getChapters`, `books`, `progressMap`, `categoryCounts`, `toast`.
- Produces (`importFlow.ts`): `interface Draft {key: string; parsed: ParsedBook; hash: string; dup: ReturnType<typeof findDuplicate>; resolution: Resolution; title: string; category: string; tags: string[]; source: 'paste'|'file'|'share'}`; `readInput(text: string, source: Draft['source'], fileName?: string): {kind: 'backup'; file: BackupFile} | {kind: 'books'; drafts: Draft[]}`; `commitDraft(d: Draft, now: number): Promise<{bookId: string; action: 'added'|'updated'|'appended'|'skipped'}>` (`separate` → новая книга; `update`/`append` → `applyResolution` по существующей книге + `clampProgress` её прогресса; `skip` → ничего; после первого добавления — `navigator.storage?.persist?.()`)
- Produces (`prompt.ts`): `type Size = 'short'|'medium'|'long'|'book'`; `buildPrompt(o: {topic: string; size: Size; wishes: string; skillInstalled: boolean; formatBlock: string}): string`; `claudeUrl(prompt: string): string | null` (`https://claude.ai/new?q=` + `encodeURIComponent`, `null` при длине больше 6000); `FORMAT_BLOCK` — текст формата из `docs/book-format.md` (шаблон + правила разметки + объёмы), строковая константа.

- [ ] **Step 1: Падающие тесты `importFlow.test.ts`** (fake-indexeddb): вставка одной книги → 1 черновик `separate`; две книги подряд → 2; JSON копии → `kind: 'backup'`; книга с тем же названием, что на полке → `update`; `commitDraft` с `update` сохраняет id и прогресс (ограниченный); с `append` добавляет главы; `skip` ничего не пишет; мусорный текст «привет» → 1 черновик с предупреждением и главой «Текст».
- [ ] **Step 2: Падающие тесты `prompt.test.ts`:** `buildPrompt({topic:'Как работает память', size:'medium', wishes:'', skillInstalled:true, formatBlock:'F'})` начинается с `Разбор для Kisr Library: Как работает память` и содержит `2000–3500 слов` и не содержит `F`; при `skillInstalled:false` содержит `F`; `claudeUrl` у текста в 7000 символов → `null`.
- [ ] **Step 3: Запустить** → падают. **Step 4: Реализовать** логику → PASS.
- [ ] **Step 5: Реализовать экран** по spec §7.2 и §10.4: «Вставить из буфера» (`navigator.clipboard.readText` по нажатию; ошибка → фокус в textarea и подсказка «Нажми и удерживай поле → Вставить»), textarea (16px, `autocapitalize="off"`), «Выбрать файлы» (`<input type=file multiple accept=".md,.markdown,.txt,.json,text/*,application/json">`, `File.text()`), `?shared=1` → `takeInbox()`; `ImportPreview` для каждого черновика (редактирование названия, раздела, тегов; дубль — выбор `Segmented` из «Обновить / Дописать / Отдельно» или «Уже на полке · Открыть»; «N глав · ≈ M мин · K карточек»; предупреждения); «Сохранить на полку» / «Сохранить все (N)» → тост «Книга на полке · Открыть»; копия → подтверждение «Восстановить копию: книг N» → `importBackup` → итог «Добавлено X, обновлено Y, пропущено Z». Ниже `PromptBuilder` («Скопировать запрос» через `navigator.clipboard.writeText`, «Открыть Claude» → `claudeUrl` в новой вкладке) и `HowItWorks`.
- [ ] **Step 6: Проверить** `npm test`, `npm run typecheck`; вручную: вставить `src/core/__fixtures__/full.md` → предпросмотр → сохранить → книга на полке.
- [ ] **Step 7: Commit** `feat(add): paste/file/share import with preview and duplicates; Claude prompt builder`

---

### Task 11: Поиск

**Files:**
- Create: `src/core/search.ts` (+ тест), `src/features/search/{SearchScreen,SearchResults}.tsx` (+ `.css`)
- Modify: `src/features/search/SearchScreen.tsx`

**Interfaces:**
- Consumes: `normalizeForSearch`, `plainText`, `getAllChapters`, `books`, роутер.
- Produces: `searchBooks(books: BookMeta[], q: string): BookMeta[]` (вес: название 3, теги 2, раздел 2, описание 1; по убыванию); `interface TextHit {bookId: string; chapter: number; chapterTitle: string; before: string; match: string; after: string}`; `searchText(chapters: Chapter[], q: string, limit = 50): TextHit[]` (по нормализованному `plainText(md)`; ±60 символов контекста по исходному тексту; не больше 3 совпадений на главу; запрос короче 2 символов → `[]`)

- [ ] **Step 1: Падающие тесты:** «ёжик» находит «Ежик» и наоборот; совпадение в названии выше, чем в описании; `searchText` возвращает `before/match/after` с `match`, равным исходному написанию в тексте; лимит 3 на главу; `q = 'а'` → `[]`.
- [ ] **Step 2: Запустить** → падают. **Step 3: Реализовать** → PASS.
- [ ] **Step 4: Реализовать экран** по spec §10.3 (поле в фокусе, `type="search"`, `enterkeyhint="search"`, задержка 150 мс, `q` в адресе через `navigate(…, {replace:true})`; главы грузятся при первом запросе и кэшируются в модуле; группы «Книги» и «В тексте»; `<mark>` вокруг `match`; нажатие на совпадение в тексте → `#/read/:id/:chapter?find=<q>`).
- [ ] **Step 5: Проверить** `npm test`, `npm run typecheck`; вручную на 23 перенесённых книгах: «Сенека» → совпадения в «Стоицизме», переход к месту подсвечивает слово.
- [ ] **Step 6: Commit** `feat(search): search books and full text with jump to the match`

---

### Task 12: Заметки и «Ещё» (настройки, копии, статистика, помощь)

**Files:**
- Create: `src/features/notes/{NotesScreen,MarkItem,ActionItem}.tsx`, `src/features/settings/{SettingsScreen,AppearanceSection,DataSection,StatsSection,HelpSection,AboutSection}.tsx` (+ `.css`), `src/features/settings/stats.ts` (+ тест)
- Modify: `src/features/notes/NotesScreen.tsx`, `src/features/settings/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `getMarks`, `books`, `progressMap`, `setBookAction`, `settings`/`updateSettings`, `exportBackup`, `importBackup`, `reloadAfterRestore`, `shareOrDownload`, `isBackup`, `formatDate`, `needUpdate`/`updateApp` (задача 13: до её завершения — `import { needUpdate, updateApp } from '../../pwa'` с заглушкой в `src/pwa.ts`, которую создаёт эта задача: `needUpdate = signal(false)`, `updateApp = () => location.reload()`).
- Produces (`stats.ts`): `libraryStats(books, progress): {total: number; finished: number; reading: number; minutesRead: number /* round(sum readingMs / 60000) */; cards: number}`

- [ ] **Step 1: Падающий тест `stats.test.ts`** на синтетике.
- [ ] **Step 2: Реализовать** → PASS.
- [ ] **Step 3: Реализовать экраны:** «Заметки» по spec §10.5 (вкладки через `#/notes?tab=`; отметки по книгам, новые сверху, нажатие → `#/read/:id/:chapter?b=:blockKey`; «Действия» с галочкой `setBookAction`; пустые состояния). «Ещё» по spec §10.7: внешний вид (те же элементы управления, что в «Aa»), скорость (`Segmented` 150/180/220/260 с подсказкой), «Сделать резервную копию» (`exportBackup` → `kisr-library-backup-YYYY-MM-DD.json` → `shareOrDownload` → `updateSettings({lastBackupAt: now, booksAtLastBackup: n})`, ниже «Последняя копия: 17 нояб.»), «Восстановить из копии» (выбор файла → `isBackup` → подтверждение → `importBackup` → итог), место (`navigator.storage.estimate`), «Защищено от очистки» (`persisted()`, кнопка «Защитить» → `persist()`), статистика, помощь (3 раскрывающихся блока: «Как добавить книгу из Claude», «Как установить на iPhone», «Скилл для Claude»), «О приложении» (версия из `import.meta.env.APP_VERSION`, заданной через `define` в Vite из `package.json`; «Обновить приложение», если `needUpdate`).
- [ ] **Step 4: Проверить** `npm test`, `npm run typecheck`; вручную: копия → восстановление в чистом профиле браузера даёт ту же полку.
- [ ] **Step 5: Commit** `feat(notes,settings): notes and actions, appearance, backup/restore, stats, help`

---

### Task 13: PWA — манифест, иконки, service worker, обновления, share target

**Files:**
- Create: `assets/icon.svg`, `scripts/make-icons.mjs`, `public/icons/{icon-192.png,icon-512.png,icon-maskable-512.png,apple-touch-icon.png}` (сгенерированы), `public/favicon.svg`, `src/sw.ts`
- Modify: `vite.config.ts` (VitePWA), `index.html` (`apple-touch-icon`, favicon), `src/pwa.ts` (настоящая реализация вместо заглушки), `src/main.tsx`

**Interfaces:**
- Consumes: `putInbox` (из `src/db/inbox.ts`, импортируется в SW — он собирается тем же Vite), роутер.
- Produces (`src/pwa.ts`): `needUpdate: Signal<boolean>`, `updateApp(): Promise<void>`, `initPwa(): void` (`registerSW` из `virtual:pwa-register` с `onNeedRefresh` → `needUpdate.value = true` и тост «Доступно обновление · Обновить»; `onOfflineReady` → тост «Готово к работе без интернета»).

- [ ] **Step 1: Иконки:** `assets/icon.svg` (квадрат `#1C694C`, по центру светлый `#F2F4F1` знак — раскрытая книга или «K» в духе Unbounded; у maskable содержимое в безопасной зоне 80%); `make-icons.mjs` растеризует его через `sharp` в 4 PNG. `npm run icons`.
- [ ] **Step 2: Манифест в `vite.config.ts`** — ровно spec §12 (`strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, `registerType: 'prompt'`, `injectManifest.globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}']`, `manifest.share_target` как в spec), `base` из `BASE_PATH`.
- [ ] **Step 3: `src/sw.ts`:** `precacheAndRoute(self.__WB_MANIFEST)`; `cleanupOutdatedCaches()`; навигационные запросы → кэшированный `index.html`; `fetch` POST на путь, оканчивающийся на `/share-target` → `formData()` → `InboxItem` (тексты файлов читаются через `File.text()`) → `putInbox` → `Response.redirect('./#/add?shared=1', 303)`; `message` `SKIP_WAITING` → `self.skipWaiting()`.
- [ ] **Step 4: Проверить:** `npm run build && npm run preview`; в Chromium DevTools → Application: манифест без ошибок, SW активен, в precache есть шрифты `.woff2`; отключить сеть → перезагрузка → полка открывается. Размер стартового JS в выводе сборки ≤ 120 КБ gzip.
- [ ] **Step 5: Commit** `feat(pwa): manifest, icons, offline service worker, update prompt, Android share target`

---

### Task 14: Скилл Claude v2

**Files:**
- Create: `claude-skill/kisr-library-razbor/SKILL.md`, `claude-skill/project-instructions.md`, `claude-skill/README.md`, `scripts/pack-skill.mjs`

**Interfaces:**
- Consumes: `docs/book-format.md`, старый скилл `migration/old-skill-SKILL.md`.
- Produces: `claude-skill/kisr-library-razbor.zip` (папка `kisr-library-razbor/` с `SKILL.md` внутри) — через `npm run skill`.

- [ ] **Step 1: Написать `SKILL.md`** — шапка `name: "kisr-library-razbor"`, `description` (по-русски: книга или разбор темы для приложения Kisr Library — реальные исследования, примеры, термины с расшифровкой, карточки; когда просят разобрать тему, написать книгу или разбор «для библиотеки» или «для Kisr Library»). Тело: раздел 1 «Что делает книгу сильной» — из старого скилла без изменений по смыслу; раздел 2 «Формат» — шаблон и правила из `docs/book-format.md` и таблица объёмов; раздел 3 «Как отдать книгу» — spec §14: ответ — только книга, начиная с `---`, без вступления и без вопросов в конце; книга больше ~5000 слов — файлом `<slug>.md`, если есть инструменты создания файлов, иначе частями с `part: N/M` и тем же `title`; перед написанием большой темы можно провести поиск и исследование; читатель и личный контекст — по правилам старого скилла. Пути А и Б старого приложения и схемы базы удалить.
- [ ] **Step 2: `project-instructions.md`** — тот же текст без YAML-шапки, с первой строкой «Инструкции проекта Kisr Library: каждый ответ в этом проекте — книга для приложения».
- [ ] **Step 3: `pack-skill.mjs`** (fflate `zipSync`) → `npm run skill` → zip создан, внутри `kisr-library-razbor/SKILL.md` (проверить, выведя список файлов из zip).
- [ ] **Step 4: Проверка формата:** взять пример книги в формате скилла (3 главы, синтетика), прогнать через `parseBook` в коротком тесте `claude-skill/skill-format.test.ts` → без предупреждений.
- [ ] **Step 5: Commit** `feat(skill): Claude skill v2 that outputs books in the app format`

---

### Task 15: E2E-сценарии

**Files:**
- Create: `playwright.config.ts`, `e2e/fixtures/make-book.ts` (генерирует синтетическую книгу: шапка, 5 глав по ~600 слов русских предложений-заглушек, карточки, задачи), `e2e/{import-read,resume,backup,search,offline}.spec.ts`

**Interfaces:**
- Consumes: всё приложение через UI; доступные имена кнопок (`getByRole`) — те, что заданы в экранах.

- [ ] **Step 1: Конфиг:** `webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173' }`, проекты `iphone` (`devices['iPhone 13']`, WebKit) и `android` (`devices['Pixel 7']`, Chromium); `npx playwright install webkit chromium`.
- [ ] **Step 2: Сценарии:**
  - `import-read`: «Добавить» → вставить книгу в textarea → «Сохранить на полку» → карточка на полке → открыть → глава 1 → «Дальше» → глава 2.
  - `resume` (**Review Focus 2 и 4**): открыть главу 2, прокрутить до 60% главы, подождать 500 мс → перезагрузить (без перехода по экранам) → «Продолжить» на полке → в зоне видимости тот же блок (`data-key` совпадает). Затем «Aa» → размер 22 → перезагрузить → тот же `data-key` у верхнего блока.
  - `backup`: «Ещё» → «Сделать резервную копию» (перехват `download` или `share` через `page.on('download')`; в WebKit-проекте, если `navigator.share` есть, подменить его до загрузки страницы через `addInitScript`) → новая страница с чистым хранилищем → «Восстановить из копии» → та же полка; повторное восстановление → «пропущено 1».
  - `search`: поиск слова из главы 3 → нажать совпадение → в читалке глава 3 и подсвеченный `mark`.
  - `offline` (только `android`): загрузить, дождаться активного SW, `context.setOffline(true)`, перезагрузить → полка видна.
- [ ] **Step 3: Запустить** `npm run e2e` → все PASS в обоих проектах (падения — чинить код, а не тесты, если тест верно отражает spec).
- [ ] **Step 4: Commit** `test(e2e): import, resume, backup, search, offline`

---

### Task 16: Документация и деплой-конвейер

**Files:**
- Create: `README.md`, `HANDOFF.md`, `.github/workflows/deploy.yml`
- Modify: `CLAUDE.md` (дополнить фактическими командами и структурой после реализации)

- [ ] **Step 1: `deploy.yml`:** на `push` в `main` и `workflow_dispatch`: `actions/checkout`, `actions/setup-node` (Node 24, кэш npm), `npm ci`, `npm test`, `BASE_PATH=/<repo>/ npm run build` (имя репозитория из `${{ github.event.repository.name }}`), `actions/configure-pages`, `actions/upload-pages-artifact` (`dist`), `actions/deploy-pages`; `permissions: pages: write, id-token: write, contents: read`; `concurrency: pages`. Версии actions — актуальные мажорные.
- [ ] **Step 2: `README.md`** (по-русски, для владельца): что это; как установить на iPhone (Safari → адрес → «Поделиться» → «На экран «Домой»» → открыть с экрана «Домой»); как перенести 23 книги (переслать себе `migration/kisr-library-backup-migrated.json` → в приложении «Ещё → Восстановить из копии»); как добавлять книги (скилл → «Копировать» → «Добавить» → «Вставить из буфера»); как загрузить скилл в claude.ai; резервные копии; разработка (`npm i`, `npm run dev`, тесты).
- [ ] **Step 3: `HANDOFF.md`:** состояние (что сделано, что проверено, что не проверено на реальном iPhone), где что лежит, как продолжить, фаза 2 из spec §16, известные ограничения.
- [ ] **Step 4: Проверить:** `npm test`, `npm run typecheck`, `npm run build`, `npm run e2e` — всё PASS; `git status` чистый, в индексе нет ничего из `migration/`.
- [ ] **Step 5: Commit** `docs: readme, handoff, deploy workflow`

Публикация (создать репозиторий на GitHub, включить Pages, первый push) — **только после согласия владельца**, вне этого плана.
