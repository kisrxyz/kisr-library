import { useState } from 'preact/hooks';
import type { BookMeta } from '../../core/types';
import { editBookMeta } from '../../state/library';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { buildMetaPatch, tagsToText } from './editMeta';
import './EditBookSheet.css';

interface EditBookSheetProps {
  open: boolean;
  book: BookMeta;
  /** Разделы полки: из них выбирают раздел книги. */
  categories: { name: string; count: number }[];
  onClose: () => void;
}

/** Выбран пункт «Новый раздел…»: название вводится в отдельном поле. */
const NEW_CATEGORY = '';

/** Шторка «Изменить»: название, раздел (из списка или новый) и теги через запятую. */
export function EditBookSheet({ open, book, categories, onClose }: EditBookSheetProps) {
  return (
    <Sheet open={open} title="Изменить книгу" onClose={onClose}>
      <EditForm book={book} categories={categories} onClose={onClose} />
    </Sheet>
  );
}

/** Своё состояние у формы: шторка убирает её с экрана при закрытии, и при следующем открытии поля начинаются заново. */
function EditForm({ book, categories, onClose }: Omit<EditBookSheetProps, 'open'>) {
  const [title, setTitle] = useState(book.title);
  const [choice, setChoice] = useState(book.category);
  const [newCategory, setNewCategory] = useState('');
  const [tags, setTags] = useState(tagsToText(book.tags));
  const [saving, setSaving] = useState(false);

  const names = categories.map((c) => c.name);
  // Раздел книги всегда есть среди разделов полки; запасной вариант — на случай гонки при удалении
  const options = names.includes(book.category) ? names : [book.category, ...names];
  const canSave = title.trim() !== '' && (choice !== NEW_CATEGORY || newCategory.trim() !== '') && !saving;

  const save = async (e: Event) => {
    e.preventDefault();
    if (!canSave) return;
    const patch = buildMetaPatch(book, { title, category: choice === NEW_CATEGORY ? newCategory : choice, tags }, names);
    if (!patch) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await editBookMeta(book.id, patch);
      onClose();
    } catch (error) {
      console.error('Не удалось сохранить книгу', error);
      toast('Не удалось сохранить');
      setSaving(false);
    }
  };

  return (
    <form class="bform" onSubmit={save}>
      <label class="bform__field">
        <span class="bform__label">Название</span>
        <input
          class="bform__input"
          type="text"
          value={title}
          autocomplete="off"
          enterkeyhint="next"
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
      </label>

      <label class="bform__field">
        <span class="bform__label">Раздел</span>
        <span class="bform__select">
          <select class="bform__input" value={choice} onChange={(e) => setChoice(e.currentTarget.value)}>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={NEW_CATEGORY}>Новый раздел…</option>
          </select>
        </span>
      </label>

      {choice === NEW_CATEGORY && (
        <label class="bform__field">
          <span class="bform__label">Название нового раздела</span>
          <input
            class="bform__input"
            type="text"
            value={newCategory}
            autocomplete="off"
            enterkeyhint="next"
            onInput={(e) => setNewCategory(e.currentTarget.value)}
          />
        </label>
      )}

      <label class="bform__field">
        <span class="bform__label">Теги через запятую</span>
        <input
          class="bform__input"
          type="text"
          value={tags}
          autocomplete="off"
          autocapitalize="none"
          enterkeyhint="done"
          onInput={(e) => setTags(e.currentTarget.value)}
        />
      </label>

      <div class="bform__actions">
        <Button variant="primary" type="submit" wide disabled={!canSave}>
          Сохранить
        </Button>
        <Button wide onClick={onClose}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
