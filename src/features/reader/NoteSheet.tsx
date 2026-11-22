import { useState } from 'preact/hooks';
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
  /** Текст заметки: пустой убирает её (подсветка остаётся, если была). */
  onSave: (note: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const QUOTE_MAX = 160;

function short(text: string): string {
  return text.length <= QUOTE_MAX ? text : `${text.slice(0, QUOTE_MAX).trimEnd()}…`;
}

/** Заметка к абзацу: поле 16px, «Сохранить» и «Удалить заметку». */
export function NoteSheet({ open, quote, mark, onSave, onDelete, onClose }: NoteSheetProps) {
  return (
    <Sheet open={open} title="Заметка" onClose={onClose}>
      <NoteForm quote={quote} initial={mark?.note ?? ''} onSave={onSave} onDelete={onDelete} />
    </Sheet>
  );
}

/** Своё состояние у формы: каждое открытие шторки начинается с сохранённого текста. */
function NoteForm({ quote, initial, onSave, onDelete }: { quote: string; initial: string; onSave: (note: string) => void; onDelete: () => void }) {
  const [saved] = useState(initial);
  const [text, setText] = useState(initial);
  const dirty = text.trim() !== saved.trim();

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
          onInput={(e) => setText(e.currentTarget.value)}
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
