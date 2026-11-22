import { useEffect, useRef, useState } from 'preact/hooks';
import { isBackup, type BackupFile } from '../../core/backup';
import { formatDate, plural } from '../../core/text';
import { exportBackup, importBackup } from '../../db/backup';
import { books, reloadAfterRestore } from '../../state/library';
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

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** «Данные»: резервная копия, восстановление, место на устройстве. */
export function DataSection() {
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [file, setFile] = useState<BackupFile | null>(null);
  const [confirming, setConfirming] = useState(false);
  // После копии и восстановления занятое место меняется
  const [storageTick, setStorageTick] = useState(0);
  const picker = useRef<HTMLInputElement>(null);

  const fail = (text: string, error?: unknown) => {
    if (error !== undefined) console.error(text, error);
    setNotice({ kind: 'error', text });
    toast(text);
  };

  const makeBackup = async () => {
    setBusy('export');
    setNotice(null);
    try {
      const data = await exportBackup(`kisr-library@${APP_VERSION}`);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      await shareOrDownload(backupFileName(new Date()), blob);
      await updateSettings({ lastBackupAt: Date.now(), booksAtLastBackup: books.value.length });
      setStorageTick((n) => n + 1);
    } catch (error) {
      fail('Не удалось сделать копию', error);
    } finally {
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
    setFile(data);
    setConfirming(true);
  };

  const restore = async (backup: BackupFile) => {
    setConfirming(false);
    setBusy('restore');
    // Пока шторка уходит, под ней не видно ни тоста, ни итога
    await wait(EXIT_MS);
    try {
      let report: Awaited<ReturnType<typeof importBackup>>;
      try {
        report = await importBackup(backup);
      } catch (error) {
        // Слияние идёт одной транзакцией: при сбое в базе ничего не изменилось
        fail('Не удалось восстановить: ничего не изменилось', error);
        return;
      }
      try {
        await reloadAfterRestore();
        await updateSettings({ lastBackupAt: backup.exportedAt, booksAtLastBackup: books.value.length });
      } catch (error) {
        fail('Копия восстановлена, но экран не обновился. Закрой приложение и открой снова', error);
        return;
      }
      const text = `Добавлено ${report.added}, обновлено ${report.updated}, пропущено ${report.skipped}`;
      setNotice({ kind: 'ok', text });
      toast(text);
      setStorageTick((n) => n + 1);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Данные">
      <div class="sset__card">
        <button type="button" class="srow srow--button" disabled={busy !== null} onClick={() => void makeBackup()}>
          <span class="srow__text">
            <span class="srow__title">Сделать резервную копию</span>
            <span class="srow__sub">{busy === 'export' ? 'Готовлю файл…' : lastBackupLine(settings.value.lastBackupAt)}</span>
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
        {file && <RestoreConfirm file={file} onConfirm={() => void restore(file)} onCancel={() => setConfirming(false)} />}
      </Sheet>
    </Section>
  );
}

function RestoreConfirm({ file, onConfirm, onCancel }: { file: BackupFile; onConfirm: () => void; onCancel: () => void }) {
  const bookCount = file.books.length;
  const markCount = file.marks.length;
  return (
    <>
      <p class="sconfirm__what">
        Копия от {formatDate(file.exportedAt)}: {bookCount}&nbsp;{plural(bookCount, 'книга', 'книги', 'книг')}, {markCount}&nbsp;
        {plural(markCount, 'отметка', 'отметки', 'отметок')}.
      </p>
      <p class="sconfirm__rules">
        Книги, которых у тебя нет, добавятся. Если книга есть и там и тут, останется та, что новее. Прогресс и отметки
        сливаются так же. Ничего не удалится.
      </p>
      <div class="sconfirm__actions">
        <Button variant="primary" wide onClick={onConfirm}>
          Восстановить
        </Button>
        <Button wide onClick={onCancel}>
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
