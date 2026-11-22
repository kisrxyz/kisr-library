import type { BookMeta } from '../../core/types';
import { DELETE_UNDO_MS } from '../../state/library';
import { Button } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import './BookMenu.css';

export type BookMenuAction = 'edit' | 'export' | 'finish' | 'unfinish' | 'delete';

interface BookMenuProps {
  open: boolean;
  /** Прочитана ли книга: от этого зависит пункт «Отметить прочитанной» / «Вернуть в «Читаю»». */
  finished: boolean;
  onPick: (action: BookMenuAction) => void;
  onClose: () => void;
}

/** Шторка «⋯»: действия с книгой крупными строками, как меню действий на iPhone. */
export function BookMenu({ open, finished, onPick, onClose }: BookMenuProps) {
  const items: { action: BookMenuAction; icon: IconName; label: string; danger?: boolean }[] = [
    { action: 'edit', icon: 'note', label: 'Изменить название, раздел и теги' },
    { action: 'export', icon: 'share', label: 'Экспорт в .md' },
    finished
      ? { action: 'unfinish', icon: 'book', label: 'Вернуть в «Читаю»' }
      : { action: 'finish', icon: 'check', label: 'Отметить прочитанной' },
    { action: 'delete', icon: 'trash', label: 'Удалить книгу', danger: true },
  ];

  return (
    <Sheet open={open} title="Действия с книгой" onClose={onClose}>
      <ul class="bmenu">
        {items.map(({ action, icon, label, danger }) => (
          <li key={action}>
            <button type="button" class={danger ? 'bmenu__item bmenu__item--danger' : 'bmenu__item'} onClick={() => onPick(action)}>
              <Icon name={icon} size={22} />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

interface DeleteBookSheetProps {
  open: boolean;
  book: BookMeta;
  onConfirm: () => void;
  onClose: () => void;
}

/** Подтверждение удаления. Само удаление и «Вернуть» — в `BookScreen`. */
export function DeleteBookSheet({ open, book, onConfirm, onClose }: DeleteBookSheetProps) {
  return (
    <Sheet open={open} title="Удалить книгу?" onClose={onClose}>
      <p class="bdelete__text">
        «{book.title}» пропадёт с полки вместе с прогрессом, отметками и заметками. Вернуть её можно в течение{' '}
        {DELETE_UNDO_MS / 1000}&nbsp;секунд.
      </p>
      <div class="bdelete__actions">
        <Button class="bdelete__confirm" wide icon="trash" onClick={onConfirm}>
          Удалить
        </Button>
        <Button wide onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}
