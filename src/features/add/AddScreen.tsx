import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BackupFile } from '../../core/backup';
import { categoryCounts } from '../../core/library';
import { takeInbox } from '../../db/inbox';
import { navigate, type RouteOf } from '../../router';
import { books } from '../../state/library';
import { settings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/Toast';
import { TopBar } from '../../ui/TopBar';
import { HowItWorks } from './HowItWorks';
import { canSaveDraft, commitDraft, readInput, restoreBackup, savedMessage, type CommitAction, type Draft } from './importFlow';
import { ImportPreview } from './ImportPreview';
import { PromptBuilder } from './PromptBuilder';
import './AddScreen.css';

/** Копия библиотеки, которую нашли во вставке или файле и которая ждёт подтверждения. */
interface PendingRestore {
  key: string;
  file: BackupFile;
  source: Draft['source'];
}

const PASTE_HINT = 'Нажми и удерживай поле → Вставить';
const ACCEPT = '.md,.markdown,.txt,.json,text/*,application/json';

let restoreKey = 1;

/** «Добавить»: вставка, файлы и «Поделиться» → предпросмотр → полка; ниже — запрос к Claude и подсказка. */
export function AddScreen({ route }: { route: RouteOf<'add'> }) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [restores, setRestores] = useState<PendingRestore[]>([]);
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  /** Текст, из которого сейчас собраны черновики «из вставки»: повторно его не разбираем. */
  const parsedText = useRef('');
  /** Свежие списки для действий, которые ждут записи в БД и вернутся к экрану позже. */
  const latest = useRef({ drafts, restores });
  latest.current = { drafts, restores };

  /** Разбор того, что лежит в поле: заменяет черновики и копии «из вставки», остальные не трогает. */
  const readPasted = (value: string) => {
    if (parsedText.current === value) return;
    parsedText.current = value;
    const rest = <T extends { source: Draft['source'] }>(list: T[]) => list.filter((x) => x.source !== 'paste');
    if (!value.trim()) {
      setDrafts(rest);
      setRestores(rest);
      setNote(null);
      return;
    }
    try {
      const res = readInput(value, 'paste');
      if (res.kind === 'backup') {
        setDrafts(rest);
        setRestores((list) => [{ key: `r${restoreKey++}`, file: res.file, source: 'paste' }, ...rest(list)]);
      } else {
        setDrafts((list) => [...res.drafts, ...rest(list)]);
        setRestores(rest);
      }
      setNote(null);
    } catch (e) {
      setDrafts(rest);
      setRestores(rest);
      setNote({ text: e instanceof Error ? e.message : 'Не удалось прочитать вставленный текст', problem: true });
    }
  };

  // Вставка пальцем (долгое нажатие → «Вставить») приходит как обычный ввод: ждём, пока он затихнет
  useEffect(() => {
    const timer = setTimeout(() => readPasted(text), 150);
    return () => clearTimeout(timer);
  }, [text]);

  /** Добавляет в списки то, что прочитано из файла или «Поделиться». */
  const take = (value: string, source: Draft['source'], fileName?: string): boolean => {
    const res = readInput(value, source, fileName);
    if (res.kind === 'backup') {
      setRestores((list) => [...list, { key: `r${restoreKey++}`, file: res.file, source }]);
      return true;
    }
    setDrafts((list) => [...list, ...res.drafts]);
    return res.drafts.length > 0;
  };

  // «Поделиться» из другого приложения (Android): service worker положил текст и файлы в inbox
  useEffect(() => {
    if (!route.shared) return;
    navigate({ name: 'add', shared: false }, { replace: true });
    takeInbox().then(
      (items) => {
        let found = false;
        for (const item of items) {
          try {
            if (item.text?.trim() && take(item.text, 'share')) found = true;
            for (const f of item.files ?? []) if (take(f.text, 'share', f.name)) found = true;
          } catch (e) {
            toast(e instanceof Error ? e.message : 'Не удалось прочитать то, чем поделились');
          }
        }
        if (!found) toast('Из «Поделиться» ничего не пришло');
      },
      (e) => {
        console.error('Не удалось забрать то, чем поделились', e);
        toast('Не удалось получить то, чем поделились');
      },
    );
  }, [route.shared]);

  // `autocorrect` у браузеров — булево свойство: через JSX строка "off" превратилась бы в «вкл». Ставим атрибут напрямую.
  useLayoutEffect(() => {
    area.current?.setAttribute('autocorrect', 'off');
  }, []);

  // Предпросмотр появился (было пусто): подводим экран к нему, чтобы «Сохранить на полку» был на виду.
  // Предпросмотр исчез (сохранили, убрали, очистили): возвращаемся наверх, к кнопке вставки.
  const hadPreview = useRef(false);
  const hasPreview = drafts.length > 0 || restores.length > 0;
  useEffect(() => {
    const behavior = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (hasPreview && !hadPreview.current) {
      main.current?.querySelector('.pv, .restore')?.scrollIntoView?.({ behavior, block: 'start' });
    } else if (!hasPreview && hadPreview.current) {
      window.scrollTo({ top: 0, behavior });
    }
    hadPreview.current = hasPreview;
  }, [hasPreview]);

  const pasteFromClipboard = async () => {
    setNote(null);
    let value: string;
    try {
      value = await navigator.clipboard.readText(); // только внутри нажатия: иначе браузер откажет
    } catch {
      area.current?.focus();
      setNote({ text: PASTE_HINT, problem: false });
      return;
    }
    if (!value.trim()) {
      area.current?.focus();
      setNote({ text: 'В буфере пусто. Скопируй ответ Claude целиком и нажми снова.', problem: false });
      return;
    }
    setText(value);
    readPasted(value);
  };

  const pickFiles = async (input: HTMLInputElement) => {
    const picked = [...(input.files ?? [])];
    input.value = ''; // тот же файл можно выбрать ещё раз
    const failed: string[] = [];
    let found = false;
    for (const file of picked) {
      try {
        if (take(await file.text(), 'file', file.name)) found = true;
      } catch (e) {
        console.error('Не удалось прочитать файл', file.name, e);
        failed.push(file.name);
      }
    }
    if (failed.length > 0) toast(`Не удалось прочитать: ${failed.join(', ')}`);
    else if (picked.length > 0 && !found) toast('В выбранных файлах нет текста книги');
  };

  const patchDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /** Убирает черновики; когда не осталось ни одного «из вставки», очищает и поле. */
  const drop = (keys: Set<string>) => {
    const left = latest.current.drafts.filter((d) => !keys.has(d.key));
    setDrafts(left);
    if (!left.some((d) => d.source === 'paste') && !latest.current.restores.some((r) => r.source === 'paste')) {
      parsedText.current = '';
      setText('');
    }
  };

  /** Сохраняет черновики по очереди. Что не вышло, остаётся на экране. */
  const save = async (list: Draft[], all: boolean) => {
    if (busy) return;
    setBusy(true);
    const results: { bookId: string; action: CommitAction }[] = [];
    const settled = new Set<string>();
    let failed = 0;
    const started = Date.now();
    for (const [i, d] of list.entries()) {
      if (!canSaveDraft(d)) {
        if (all) settled.add(d.key); // «Сохранить все» пропускает пустые и «Пропустить»
        continue;
      }
      try {
        results.push(await commitDraft(d, started + i));
        settled.add(d.key);
      } catch (e) {
        console.error('Не удалось сохранить книгу', d.title, e);
        failed++;
      }
    }
    setBusy(false);
    drop(settled);

    const saved = results.filter((r) => r.action !== 'skipped');
    if (saved.length === 0) {
      if (failed > 0) toast('Не удалось сохранить');
      return;
    }
    const message = failed > 0 ? `${savedMessage(saved)}. Не удалось сохранить: ${failed}` : savedMessage(saved);
    const action =
      saved.length === 1
        ? { label: 'Открыть', run: () => navigate({ name: 'book', id: saved[0].bookId }) }
        : { label: 'К полке', run: () => navigate({ name: 'library', params: new URLSearchParams() }) };
    toast(message, action, 6000);
  };

  const restore = async (r: PendingRestore) => {
    if (busy) return;
    setBusy(true);
    try {
      const { added, updated, skipped } = await restoreBackup(r.file);
      setRestores((list) => list.filter((x) => x.key !== r.key));
      if (r.source === 'paste' && latest.current.restores.every((x) => x.key === r.key || x.source !== 'paste')) {
        parsedText.current = '';
        setText('');
      }
      toast(
        `Добавлено ${added}, обновлено ${updated}, пропущено ${skipped}`,
        { label: 'К полке', run: () => navigate({ name: 'library', params: new URLSearchParams() }) },
        8000,
      );
    } catch (e) {
      console.error('Не удалось восстановить копию', e);
      toast('Не удалось восстановить копию');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    parsedText.current = '';
    setText('');
    setDrafts((list) => list.filter((d) => d.source !== 'paste'));
    setRestores((list) => list.filter((r) => r.source !== 'paste'));
    setNote(null);
    area.current?.focus();
  };

  const categories = categoryCounts(books.value).map((c) => c.name);
  const saveable = drafts.filter(canSaveDraft);

  return (
    <>
      <TopBar title="Добавить" />
      <main ref={main} class="screen add">
        <section class="addbox" aria-label="Добавить книгу">
          <Button variant="primary" icon="paste" wide onClick={pasteFromClipboard}>
            Вставить из буфера
          </Button>
          <textarea
            ref={area}
            class={hasPreview ? 'addbox__area addbox__area--compact' : 'addbox__area'}
            value={text}
            rows={hasPreview ? 3 : 5}
            placeholder="Вставь сюда ответ Claude целиком"
            aria-label="Текст книги"
            autocapitalize="off"
            spellcheck={false}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          {note && (
            <p class={note.problem ? 'addbox__note addbox__note--problem' : 'addbox__note'} role="status">
              {note.text}
            </p>
          )}
          <div class="addbox__row">
            <Button icon="upload" onClick={() => files.current?.click()}>
              Выбрать файлы
            </Button>
            {text !== '' && (
              <Button variant="plain" onClick={clear}>
                Очистить
              </Button>
            )}
          </div>
          <input
            ref={files}
            class="sr-only"
            type="file"
            multiple
            accept={ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void pickFiles(e.currentTarget)}
          />
        </section>

        {restores.map((r) => (
          <section key={r.key} class="restore" aria-label="Копия библиотеки">
            <div class="restore__head">
              <Icon class="restore__icon" name="library" size={22} />
              <div class="restore__body">
                <h2 class="restore__title">Восстановить копию: книг {r.file.books.length}</h2>
                <p class="restore__text">
                  Книги из копии добавятся к тем, что уже на полке. Если книга есть и там и там, останется более новая версия;
                  прогресс и отметки тоже объединятся.
                </p>
              </div>
            </div>
            <div class="restore__actions">
              <Button variant="primary" disabled={busy} onClick={() => void restore(r)}>
                Восстановить
              </Button>
              <Button disabled={busy} onClick={() => setRestores((list) => list.filter((x) => x.key !== r.key))}>
                Отмена
              </Button>
            </div>
          </section>
        ))}

        {drafts.map((d, i) => (
          <ImportPreview
            key={d.key}
            draft={d}
            position={drafts.length > 1 ? { index: i + 1, total: drafts.length } : null}
            categories={categories}
            wpm={settings.value.wpm}
            busy={busy}
            onChange={(patch) => patchDraft(d.key, patch)}
            onSave={() => void save([d], false)}
            onDismiss={() => drop(new Set([d.key]))}
          />
        ))}

        {saveable.length > 1 && (
          <Button variant="primary" wide disabled={busy} onClick={() => void save(drafts, true)}>
            Сохранить все ({saveable.length})
          </Button>
        )}

        <PromptBuilder />
        <HowItWorks />
      </main>
    </>
  );
}
