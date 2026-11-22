import { useState } from 'preact/hooks';
import { formatDate } from '../../core/text';
import type { BookMeta } from '../../core/types';
import { setBookAction } from '../../state/library';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import './BookAction.css';

type Action = NonNullable<BookMeta['action']>;

interface BookActionProps {
  bookId: string;
  action: BookMeta['action'];
  /** Когда книга прочитана («Прочитано 17 нояб.»). Нет — книга сейчас не в «Прочитано», но действие у неё записано. */
  finishedAt?: number;
}

const fail = (error: unknown) => {
  console.error('Не удалось сохранить действие', error);
  toast('Не удалось сохранить');
};

/** «Прочитано 17 нояб.» и «одно действие после книги»: текст, галочка «сделано», правка в шторке. */
export function BookAction({ bookId, action, finishedAt }: BookActionProps) {
  const [editing, setEditing] = useState(false);

  const toggleDone = (done: boolean) => {
    if (!action) return;
    const next: Action = { text: action.text, done };
    if (done) next.doneAt = Date.now();
    setBookAction(bookId, next).catch(fail);
  };

  return (
    <section class="baction" aria-labelledby="baction-title">
      {finishedAt !== undefined && (
        <p class="baction__read">
          <Icon name="check" size={16} />
          Прочитано {formatDate(finishedAt)}
        </p>
      )}
      <h2 id="baction-title" class="baction__label">
        Одно действие
      </h2>

      {action ? (
        <>
          <p class={action.done ? 'baction__text baction__text--done' : 'baction__text'}>{action.text}</p>
          <div class="baction__row">
            <label class="baction__check">
              <input type="checkbox" checked={action.done} onChange={(e) => toggleDone(e.currentTarget.checked)} />
              <span>сделано{action.done && action.doneAt ? ` · ${formatDate(action.doneAt)}` : ''}</span>
            </label>
            <Button variant="plain" icon="note" onClick={() => setEditing(true)}>
              Изменить
            </Button>
          </div>
        </>
      ) : (
        <>
          <p class="baction__hint">Какое одно действие ты сделаешь после этой книги? Запиши — оно появится и во вкладке «Заметки».</p>
          <Button icon="plus" onClick={() => setEditing(true)}>
            Записать действие
          </Button>
        </>
      )}

      <Sheet open={editing} title="Одно действие" onClose={() => setEditing(false)}>
        <ActionForm bookId={bookId} action={action} onClose={() => setEditing(false)} />
      </Sheet>
    </section>
  );
}

function ActionForm({ bookId, action, onClose }: { bookId: string; action: BookMeta['action']; onClose: () => void }) {
  const [text, setText] = useState(action?.text ?? '');
  const [saving, setSaving] = useState(false);

  const write = async (next: BookMeta['action']) => {
    setSaving(true);
    try {
      await setBookAction(bookId, next);
      onClose();
    } catch (error) {
      fail(error);
      setSaving(false);
    }
  };

  const save = (e: Event) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    // Правка текста не сбрасывает «сделано»
    const next: Action = { text: trimmed, done: action?.done ?? false };
    if (action?.done && action.doneAt !== undefined) next.doneAt = action.doneAt;
    void write(next);
  };

  return (
    <form class="bform" onSubmit={save}>
      <label class="bform__field">
        <span class="bform__label">Что сделаешь после книги?</span>
        <textarea
          class="bform__input"
          rows={4}
          value={text}
          placeholder="Одно конкретное действие"
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <div class="bform__actions">
        <Button variant="primary" type="submit" wide disabled={!text.trim() || saving}>
          Сохранить
        </Button>
        {action && (
          <Button wide disabled={saving} onClick={() => void write(undefined)}>
            Убрать действие
          </Button>
        )}
        <Button wide onClick={onClose}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
