import { useEffect, useRef, useState } from 'preact/hooks';
import type { Mark } from '../../core/types';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import './NoteSheet.css';

export interface NoteSheetProps {
  open: boolean;
  /** Абзац, к которому пишется заметка. Остаётся прежним, пока шторка уезжает. */
  quote: string;
  /** Запись блока, если она уже есть (заметка для правки). */
  mark?: Mark;
  /**
   * Текст заметки: пустой убирает её (подсветка остаётся, если была). `dismissed` — шторку закрыли мимо
   * «Сохранить» (✕, нажатие мимо, Esc, «назад»), а в поле новый непустой текст: он сохраняется тоже.
   */
  onSave: (note: string, dismissed: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}

const QUOTE_MAX = 160;

function short(text: string): string {
  return text.length <= QUOTE_MAX ? text : `${text.slice(0, QUOTE_MAX).trimEnd()}…`;
}

/** Заметка к абзацу: поле 16px, «Сохранить» и «Удалить заметку». Закрыть шторку — не значит потерять набранное. */
export function NoteSheet({ open, quote, mark, onSave, onDelete, onClose }: NoteSheetProps) {
  /** Новый текст в поле, если он отличается от сохранённого; `null` — сохранять при закрытии нечего. */
  const draft = useRef<string | null>(null);

  const dismiss = () => {
    const text = draft.current;
    draft.current = null;
    // Пустое поле заметку при закрытии не удаляет: для этого есть «Удалить заметку» и «Сохранить»
    if (text !== null && text.trim() !== '') onSave(text, true);
    else onClose();
  };

  return (
    <Sheet open={open} title="Заметка" onClose={dismiss}>
      <NoteForm
        quote={quote}
        initial={mark?.note ?? ''}
        draft={draft}
        onSave={(text) => {
          draft.current = null;
          onSave(text, false);
        }}
        onDelete={() => {
          draft.current = null;
          onDelete();
        }}
      />
    </Sheet>
  );
}

interface NoteFormProps {
  quote: string;
  initial: string;
  /** Сюда форма кладёт изменённый текст: его сохранит закрытие шторки мимо «Сохранить». */
  draft: { current: string | null };
  onSave: (note: string) => void;
  onDelete: () => void;
}

/** Своё состояние у формы: каждое открытие шторки начинается с сохранённого текста. */
function NoteForm({ quote, initial, draft, onSave, onDelete }: NoteFormProps) {
  const [saved] = useState(initial);
  const [text, setText] = useState(initial);
  const dirty = text.trim() !== saved.trim();

  // Форма ушла со шторкой — черновика больше нет
  useEffect(
    () => () => {
      draft.current = null;
    },
    [],
  );

  return (
    <form
      class="nform"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave(text);
      }}
    >
      <p class="nform__quote">«{short(quote)}»</p>
      <label class="nform__field">
        <span class="nform__label">Твоя заметка</span>
        <textarea
          class="nform__input"
          value={text}
          rows={5}
          placeholder="Что здесь важно?"
          enterkeyhint="done"
          onInput={(e) => {
            const next = e.currentTarget.value;
            setText(next);
            draft.current = next.trim() !== saved.trim() ? next : null;
          }}
        />
      </label>
      <div class="nform__actions">
        <Button variant="primary" type="submit" wide disabled={!dirty}>
          Сохранить
        </Button>
        {saved.trim() !== '' && (
          <Button class="nform__delete" wide onClick={onDelete}>
            Удалить заметку
          </Button>
        )}
      </div>
    </form>
  );
}
