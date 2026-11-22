import { formatDate } from '../../core/text';
import type { BookMeta } from '../../core/types';
import { toHash } from '../../router';
import { setBookAction } from '../../state/library';
import { toast } from '../../ui/Toast';

interface ActionItemProps {
  /** Книга с записанным действием. */
  book: BookMeta;
}

/** Действие после книги: название ведёт на страницу книги, галочка «сделано» сохраняется сразу. */
export function ActionItem({ book }: ActionItemProps) {
  const action = book.action;
  if (!action) return null;

  const toggle = (done: boolean) => {
    const next: NonNullable<BookMeta['action']> = { text: action.text, done };
    if (done) next.doneAt = Date.now();
    setBookAction(book.id, next).catch((error) => {
      console.error('Не удалось сохранить действие', error);
      toast('Не удалось сохранить');
    });
  };

  return (
    <article class={action.done ? 'action action--done' : 'action'}>
      <a class="action__book" href={toHash({ name: 'book', id: book.id })}>
        {book.title}
      </a>
      <p class="action__text">{action.text}</p>
      <label class="action__check">
        <input type="checkbox" checked={action.done} onChange={(e) => toggle(e.currentTarget.checked)} />
        <span>сделано{action.done && action.doneAt ? ` · ${formatDate(action.doneAt)}` : ''}</span>
      </label>
    </article>
  );
}
