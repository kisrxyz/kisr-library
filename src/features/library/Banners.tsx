import { needsBackupReminder } from '../../core/backup';
import { formatDate, plural } from '../../core/text';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { books } from '../../state/library';
import { settings, updateSettings } from '../../state/settings';
import './Banners.css';

const DAY_MS = 24 * 60 * 60 * 1000;
/** На сколько «Позже» прячет напоминание о копии. */
export const BACKUP_SNOOZE_MS = 7 * DAY_MS;

/** iPhone или iPad в обычной вкладке Safari, не в приложении с экрана «Домой». */
export function needsInstallHint(): boolean {
  if (typeof navigator === 'undefined') return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return !standalone && /iPhone|iPad/.test(navigator.userAgent);
}

/** Что написать в напоминании: копии не было, добавилось много книг или давно не делали. */
function backupText(bookCount: number): string {
  const { lastBackupAt, booksAtLastBackup } = settings.value;
  if (lastBackupAt === null) return 'Копии ещё не было, а книги хранятся только на этом устройстве.';
  const added = Math.max(0, bookCount - booksAtLastBackup);
  if (added >= 5) {
    return `С последней копии (${formatDate(lastBackupAt)}) добавлено ${added} ${plural(added, 'книга', 'книги', 'книг')}.`;
  }
  return `Последняя копия — ${formatDate(lastBackupAt)}. Прошло больше двух недель.`;
}

/**
 * Одно сообщение над полкой. Подсказка про установку на iOS важнее: пока приложение открыто
 * во вкладке, всё добавленное туда не попадёт. Иначе — напоминание о резервной копии.
 */
export function Banners() {
  if (needsInstallHint()) {
    return (
      <aside class="banner" aria-label="Установка приложения">
        <Icon class="banner__icon" name="share" size={22} />
        <div class="banner__body">
          <p class="banner__title">Установи на экран «Домой»</p>
          <p class="banner__text">
            Книги из браузера не попадут в приложение. В Safari нажми «Поделиться» → «На экран „Домой“».
          </p>
        </div>
      </aside>
    );
  }

  const now = Date.now();
  const bookCount = books.value.length;
  if (!needsBackupReminder(settings.value, bookCount, now)) return null;

  return (
    <aside class="banner" aria-label="Резервная копия">
      <Icon class="banner__icon" name="upload" size={22} />
      <div class="banner__body">
        <p class="banner__title">Сохрани копию книг</p>
        <p class="banner__text">{backupText(bookCount)}</p>
        <div class="banner__actions">
          <Button variant="primary" href="#/settings">
            Сделать копию
          </Button>
          <Button
            variant="plain"
            onClick={() => {
              updateSettings({ backupBannerHiddenUntil: Date.now() + BACKUP_SNOOZE_MS }).catch((e) =>
                console.error('Не удалось отложить напоминание', e),
              );
            }}
          >
            Позже
          </Button>
        </div>
      </div>
    </aside>
  );
}
