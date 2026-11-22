import { useEffect, useRef, useState } from 'preact/hooks';
import { backupStamp, isBackup, type BackupFile } from '../../core/backup';
import { formatDate, plural } from '../../core/text';
import type { BookMeta, Progress, Settings } from '../../core/types';
import { exportBackup, importBackup } from '../../db/backup';
import { books, progressMap, reloadAfterRestore } from '../../state/library';
import { settings, updateSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { EXIT_MS, Sheet } from '../../ui/Sheet';
import { shareOrDownload } from '../../ui/share';
import { toast } from '../../ui/Toast';
import { backupFileName, formatBytes, lastBackupLine } from './format';
import { Section } from './Section';
import { APP_VERSION } from './version';

type Busy = 'export' | 'restore' | null;
interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/** Файл копии, выбранный для восстановления, и время, которое мы ему припишем (см. `backupStamp`). */
interface Picked {
  file: BackupFile;
  stamp: number;
}

/** От чего собран подготовленный файл: если что-то из этого изменилось, файл устарел. */
type Source = readonly [BookMeta[], Map<string, Progress>, Settings];

interface Prepared {
  file: File;
  bookCount: number;
  source: Source;
}

/** Пауза перед пересборкой файла после изменений: серия правок собирает его один раз. */
const PREPARE_DELAY_MS = 500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const currentSource = (): Source => [books.peek(), progressMap.peek(), settings.peek()];
const sameSource = (a: Source, b: Source) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

async function buildBackup(source: Source): Promise<Prepared> {
  const data = await exportBackup(`kisr-library@${APP_VERSION}`);
  const file = new File([JSON.stringify(data)], backupFileName(new Date(data.exportedAt)), { type: 'application/json' });
  return { file, bookCount: data.books.length, source };
}

/** «Данные»: резервная копия, восстановление, место на устройстве. */
export function DataSection() {
  // Читаем сигналы при отрисовке: экран следит за изменениями, а файл копии пересобирается
  const allBooks = books.value;
  const progress = progressMap.value;
  const current = settings.value;

  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Первая подготовка файла копии закончилась (удачно или нет): до этого под кнопкой «Готовлю копию…»
  const [primed, setPrimed] = useState(false);
  // После копии и восстановления занятое место меняется
  const [storageTick, setStorageTick] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  // Двойной тап не должен запускать копию или восстановление дважды: состояние `busy` обновится только при следующей отрисовке
  const working = useRef(false);
  const prepared = useRef<Prepared | null>(null);
  const firstRun = useRef(true);

  /**
   * Файл копии собирается заранее и по каждому изменению библиотеки или настроек (с паузой). Тогда нажатие
   * сразу отдаёт готовый файл в «Поделиться»: iOS разрешает его только сразу после нажатия, а на сборку
   * копии и `JSON.stringify` жест может «протухнуть».
   */
  useEffect(() => {
    const source: Source = [allBooks, progress, current];
    prepared.current = null;
    let alive = true;
    const delay = firstRun.current ? 0 : PREPARE_DELAY_MS;
    firstRun.current = false;
    const timer = setTimeout(() => {
      buildBackup(source).then(
        (result) => {
          if (!alive) return;
          prepared.current = result;
          setPrimed(true);
        },
        (error) => {
          console.error('Не удалось заранее подготовить копию', error);
          if (alive) setPrimed(true);
        },
      );
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [allBooks, progress, current]);

  const fail = (text: string, error?: unknown) => {
    if (error !== undefined) console.error(text, error);
    setNotice({ kind: 'error', text });
    toast(text);
  };

  const makeBackup = async () => {
    if (working.current) return;
    working.current = true;
    setBusy('export');
    setNotice(null);
    try {
      const old = prepared.current;
      let ready: Prepared | null = old && sameSource(old.source, currentSource()) ? old : null;
      // Свежего готового файла нет (ещё готовится, не вышло или данные изменились): собираем сейчас.
      // Если файл готов, `await` здесь не выполняется и «Поделиться» вызывается прямо в обработчике нажатия.
      ready ??= await buildBackup(currentSource());
      const given = await shareOrDownload(ready.file.name, ready.file);
      // Закрыли меню «Поделиться» — копии нет, и напоминание о ней остаётся в силе
      if (given) {
        await updateSettings({ lastBackupAt: Date.now(), booksAtLastBackup: ready.bookCount });
        setStorageTick((n) => n + 1);
      }
    } catch (error) {
      fail('Не удалось сделать копию', error);
    } finally {
      working.current = false;
      setBusy(null);
    }
  };

  /** Файл выбран: проверяем, что это копия, и просим подтверждение. */
  const pick = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    if (!chosen) return;
    setNotice(null);
    let data: unknown;
    try {
      data = JSON.parse(await chosen.text());
    } catch {
      input.value = '';
      fail('Не получилось прочитать файл: это не копия Kisr Library');
      return;
    }
    // Тот же файл можно выбрать ещё раз: без сброса `change` не сработает
    input.value = '';
    if (!isBackup(data)) {
      fail('Это не файл резервной копии Kisr Library');
      return;
    }
    setPicked({ file: data, stamp: backupStamp(data.exportedAt) });
    setConfirming(true);
  };

  const restore = async ({ file, stamp }: Picked) => {
    if (working.current) return;
    working.current = true;
    setConfirming(false);
    setBusy('restore');
    try {
      // Пока шторка уходит, под ней не видно ни тоста, ни итога
      await wait(EXIT_MS);
      let report: Awaited<ReturnType<typeof importBackup>>;
      try {
        report = await importBackup(file);
      } catch (error) {
        // Слияние идёт одной транзакцией: при сбое в базе ничего не изменилось
        fail('Не удалось восстановить: ничего не изменилось', error);
        return;
      }
      try {
        await reloadAfterRestore();
        await updateSettings({ lastBackupAt: stamp, booksAtLastBackup: books.value.length });
      } catch (error) {
        fail('Копия восстановлена, но экран не обновился. Закрой приложение и открой снова', error);
        return;
      }
      const text = `Добавлено ${report.added}, обновлено ${report.updated}, пропущено ${report.skipped}`;
      setNotice({ kind: 'ok', text });
      toast(text);
      setStorageTick((n) => n + 1);
    } finally {
      working.current = false;
      setBusy(null);
    }
  };

  // Пересборка после правок идёт молча (подпись не мигает); если нажать в этот момент, копия соберётся при нажатии
  const exportHint = busy === 'export' ? 'Сохраняю копию…' : !primed ? 'Готовлю копию…' : lastBackupLine(current.lastBackupAt);

  return (
    <Section title="Данные">
      <div class="sset__card">
        <button type="button" class="srow srow--button" disabled={busy !== null} onClick={() => void makeBackup()}>
          <span class="srow__text">
            <span class="srow__title">Сделать резервную копию</span>
            <span class="srow__sub">{exportHint}</span>
          </span>
          <Icon class="srow__icon" name="upload" size={20} />
        </button>

        <button type="button" class="srow srow--button" disabled={busy !== null} onClick={() => picker.current?.click()}>
          <span class="srow__text">
            <span class="srow__title">Восстановить из копии</span>
            <span class="srow__sub">{busy === 'restore' ? 'Восстанавливаю…' : 'Выбери файл, который сохранил раньше'}</span>
          </span>
          <Icon class="srow__icon" name="paste" size={20} />
        </button>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e)} />

        {notice && (
          <p class={notice.kind === 'ok' ? 'srow snotice' : 'srow snotice snotice--error'} role={notice.kind === 'ok' ? 'status' : 'alert'}>
            {notice.kind === 'ok' && <Icon name="check" size={18} />}
            {notice.text}
          </p>
        )}

        <Storage tick={storageTick} />
      </div>

      <Sheet open={confirming} title="Восстановить из копии?" onClose={() => setConfirming(false)}>
        {picked && (
          <RestoreConfirm picked={picked} busy={busy !== null} onConfirm={() => void restore(picked)} onCancel={() => setConfirming(false)} />
        )}
      </Sheet>
    </Section>
  );
}

interface RestoreConfirmProps {
  picked: Picked;
  /** Идёт восстановление (шторка ещё уходит): повторное нажатие ничего не должно запускать. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function RestoreConfirm({ picked, busy, onConfirm, onCancel }: RestoreConfirmProps) {
  const bookCount = picked.file.books.length;
  const markCount = picked.file.marks.length;
  return (
    <>
      <p class="sconfirm__what">
        Копия от {formatDate(picked.stamp)}: {bookCount}&nbsp;{plural(bookCount, 'книга', 'книги', 'книг')}, {markCount}&nbsp;
        {plural(markCount, 'отметка', 'отметки', 'отметок')}.
      </p>
      <p class="sconfirm__rules">
        Книги, которых у тебя нет, добавятся. Если книга есть и там и тут, останется та, что новее. Прогресс и отметки
        сливаются так же. Ничего не удалится.
      </p>
      <div class="sconfirm__actions">
        <Button variant="primary" wide disabled={busy} onClick={onConfirm}>
          Восстановить
        </Button>
        <Button wide disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </>
  );
}

/** «Занято» и «Защищено от очистки»: строки есть только там, где браузер умеет отвечать. */
function Storage({ tick }: { tick: number }) {
  const api = typeof navigator === 'undefined' ? undefined : navigator.storage;
  const [usage, setUsage] = useState<number | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!api || typeof api.estimate !== 'function') return;
    let alive = true;
    api.estimate().then(
      (e) => alive && typeof e.usage === 'number' && setUsage(e.usage),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [api, tick]);

  useEffect(() => {
    if (!api || typeof api.persisted !== 'function') return;
    let alive = true;
    api.persisted().then(
      (p) => alive && setPersisted(p),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const protect = async () => {
    try {
      const granted = await api!.persist();
      setPersisted(granted);
      toast(granted ? 'Хранилище защищено от очистки' : 'Браузер не дал защиту. Делай копии почаще');
    } catch (error) {
      console.error('Не удалось запросить защиту хранилища', error);
      toast('Не удалось запросить защиту');
    }
  };

  return (
    <>
      {usage !== null && <p class="srow srow--info">Занято: {formatBytes(usage)}</p>}
      {persisted !== null && (
        <div class="srow srow--info srow--between">
          <span>Защищено от очистки: {persisted ? 'да' : 'нет'}</span>
          {!persisted && typeof api?.persist === 'function' && (
            <Button onClick={() => void protect()}>Защитить</Button>
          )}
        </div>
      )}
    </>
  );
}
