import { useId, useState } from 'preact/hooks';
import { formatDate } from '../../core/text';
import type { BookMeta, Progress } from '../../core/types';
import { setBookAction, setFinished } from '../../state/library';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/Toast';

type Action = NonNullable<BookMeta['action']>;

interface FinishBlockProps {
  book: BookMeta;
  progress?: Progress;
}

const fail = (what: string) => (error: unknown) => {
  console.error(what, error);
  toast('Не удалось сохранить');
};

/**
 * Блок завершения в конце книги (spec §8.5), как в старом приложении: «Дочитал?» и одно действие,
 * которое сделаешь после книги. У прочитанной — «Прочитано 17 нояб.», действие с галочкой «сделано»
 * и «Вернуть в «Читаю»». Действие видно и на странице книги, и в «Заметках».
 */
export function FinishBlock({ book, progress }: FinishBlockProps) {
  const finished = progress?.status === 'finished';
  const action = book.action;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(action?.text ?? '');
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const fieldId = useId();
  const showForm = !action || editing;

  const save = async (e: Event) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (busy || (finished && !trimmed)) return;
    setBusy(true);
    try {
      // «Дочитал?» → «Сохранить»: книга отмечается прочитанной, действие — если записано
      if (!finished) {
        await setFinished(book.id, true);
        toast('Книга в «Прочитано»');
      }
      if (trimmed) {
        // Правка текста не сбрасывает «сделано»
        const next: Action = { text: trimmed, done: action?.done ?? false };
        if (action?.done && action.doneAt !== undefined) next.doneAt = action.doneAt;
        await setBookAction(book.id, next);
      }
      setEditing(false);
    } catch (error) {
      fail('Не удалось сохранить действие')(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = (done: boolean) => {
    if (!action) return;
    const next: Action = { text: action.text, done };
    if (done) next.doneAt = Date.now();
    setBookAction(book.id, next).catch(fail('Не удалось отметить действие'));
  };

  const unfinish = () => {
    setFinished(book.id, false)
      .then(() => toast('Книга снова в «Читаю»'))
      .catch(fail('Не удалось вернуть книгу'));
  };

  return (
    <section class="rfin" aria-labelledby={titleId}>
      {finished ? (
        <h2 id={titleId} class="rfin__done">
          <Icon name="check" size={18} />
          Прочитано {formatDate(progress.finishedAt ?? progress.lastReadAt)}
        </h2>
      ) : (
        <>
          <h2 id={titleId} class="rfin__title">
            Дочитал?
          </h2>
          <p class="rfin__hint">Запиши одно действие, которое сделаешь после книги. Оно появится на странице книги и в «Заметках».</p>
        </>
      )}

      {showForm ? (
        <form class="rfin__form" onSubmit={(e) => void save(e)}>
          <label class="rfin__field" for={fieldId}>
            <span class="rfin__label">Одно действие, которое сделаешь после книги</span>
            <textarea
              id={fieldId}
              class="rfin__input"
              rows={3}
              value={text}
              placeholder="Например: завтра позвоню трём людям и сделаю первый шаг"
              onInput={(e) => setText(e.currentTarget.value)}
            />
          </label>
          <div class="rfin__actions">
            <Button variant="primary" type="submit" disabled={busy || (finished && !text.trim())}>
              Сохранить
            </Button>
            {editing && (
              <Button variant="plain" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div class="rfin__act">
          <p class={action.done ? 'rfin__text rfin__text--done' : 'rfin__text'}>{action.text}</p>
          <div class="rfin__row">
            <label class="rfin__check">
              <input type="checkbox" checked={action.done} onChange={(e) => toggleDone(e.currentTarget.checked)} />
              <span>сделано{action.done && action.doneAt ? ` · ${formatDate(action.doneAt)}` : ''}</span>
            </label>
            <Button
              variant="plain"
              icon="note"
              onClick={() => {
                setText(action.text);
                setEditing(true);
              }}
            >
              Изменить
            </Button>
          </div>
        </div>
      )}

      {finished && (
        <Button class="rfin__back" onClick={unfinish}>
          Вернуть в «Читаю»
        </Button>
      )}
    </section>
  );
}
