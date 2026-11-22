import { useState } from 'preact/hooks';
import { countCards } from '../../core/cards';
import { partAlreadyIn, type Resolution } from '../../core/duplicates';
import { countWords, plural } from '../../core/text';
import { minutesLabel } from '../../core/time';
import { toHash } from '../../router';
import { Button } from '../../ui/Button';
import { Segmented, type SegmentedOption } from '../../ui/Segmented';
import { parseTags, tagsToText } from '../book/editMeta';
import { canSaveDraft, draftWarnings, isEmptyDraft, type Draft } from './importFlow';
import './ImportPreview.css';

interface ImportPreviewProps {
  draft: Draft;
  /** Номер среди нескольких книг из одной вставки; `null`, если книга одна. */
  position: { index: number; total: number } | null;
  /** Разделы, которые уже есть на полке. */
  categories: string[];
  wpm: number;
  busy: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDismiss: () => void;
}

/** Выбран пункт «Новый раздел…»: название вводится в отдельном поле. */
const NEW_CATEGORY = '\u0000new';

/** «Пропустить» среди вариантов нет: оно стоит по умолчанию у части, которая уже в книге (ничего не выбрано). */
const CHOICES: SegmentedOption<Resolution>[] = [
  { value: 'update', label: 'Обновить' },
  { value: 'append', label: 'Дописать' },
  { value: 'separate', label: 'Отдельно' },
];

const EXPLAIN: Record<Resolution, string> = {
  update: 'Текст заменится новым. Прогресс и отметки останутся; если глав стало меньше, место в книге сдвинется.',
  append: 'Главы добавятся в конец книги: так собирают книгу, которая пришла частями.',
  separate: 'На полке будет две книги с таким названием.',
  skip: 'Все главы этой части уже есть в книге, сохранять нечего.',
};

/** «7 глав · ≈ 12 мин · 10 карточек» */
export function statsLine(d: Draft, wpm: number): string {
  const chapters = d.parsed.chapters.length;
  const words = d.parsed.chapters.reduce((sum, c) => sum + countWords(c.md), 0);
  const cards = d.parsed.chapters.reduce((sum, c) => sum + countCards(c.md), 0);
  return [
    `${chapters} ${plural(chapters, 'глава', 'главы', 'глав')}`,
    `≈ ${minutesLabel(words, wpm)}`,
    `${cards} ${plural(cards, 'карточка', 'карточки', 'карточек')}`,
  ].join(' · ');
}

/** Предпросмотр одной книги из вставки или файла: что получится, что можно поправить, что делать с дублем. */
export function ImportPreview({ draft: d, position, categories, wpm, busy, onChange, onSave, onDismiss }: ImportPreviewProps) {
  const warnings = draftWarnings(d);
  const same = d.dup?.kind === 'same-content';
  const sameTitle = d.dup?.kind === 'same-title';
  const appending = d.resolution === 'append';

  return (
    <article class="pv" aria-label={position ? `Книга ${position.index} из ${position.total}` : 'Предпросмотр книги'}>
      <header class="pv__top">
        <span class="pv__label">{position ? `Книга ${position.index} из ${position.total}` : 'Предпросмотр'}</span>
        <Button variant="plain" icon="close" aria-label="Убрать из списка" onClick={onDismiss} />
      </header>

      {same || appending ? (
        <h2 class="pv__title">{same ? d.title : d.dup?.book.title}</h2>
      ) : (
        <label class="pf">
          <span class="pf__label">Название</span>
          <input
            class="pf__input"
            type="text"
            value={d.title}
            autocomplete="off"
            enterkeyhint="done"
            onInput={(e) => onChange({ title: e.currentTarget.value })}
          />
        </label>
      )}

      <p class="pv__stats">{statsLine(d, wpm)}</p>

      {same && d.dup && (
        <div class="pv__dup pv__dup--same">
          <p class="pv__duptext">
            <strong>Уже на полке</strong>
            <span>«{d.dup.book.title}» — текст тот же.</span>
          </p>
          <Button href={toHash({ name: 'book', id: d.dup.book.id })}>Открыть</Button>
        </div>
      )}

      {!same && d.parsed.summary && !isEmptyDraft(d) && <p class="pv__sum">{d.parsed.summary}</p>}

      {!same && warnings.length > 0 && (
        <ul class="pv__warns" aria-label="Предупреждения">
          {warnings.map((w) => (
            <li key={w} class={w === 'Пустой текст' ? 'pv__warn pv__warn--stop' : 'pv__warn'}>
              {w}
            </li>
          ))}
        </ul>
      )}

      {sameTitle && d.dup && (
        <div class="pv__dup">
          <p class="pv__duptext">
            <strong>{partAlreadyIn(d.parsed, d.dup.book) ? 'Эта часть уже в книге' : 'На полке уже есть такая книга'}</strong>
            <span>
              «{d.dup.book.title}», {d.dup.book.chapters.length} {plural(d.dup.book.chapters.length, 'глава', 'главы', 'глав')}.{' '}
              <a href={toHash({ name: 'book', id: d.dup.book.id })}>Открыть</a>
            </span>
          </p>
          <Segmented
            label="Что сделать с книгой на полке"
            options={CHOICES}
            value={d.resolution}
            onChange={(resolution) => onChange({ resolution })}
          />
          <p class="pv__note">{EXPLAIN[d.resolution]}</p>
        </div>
      )}

      {!same && !appending && (
        <>
          <CategoryField value={d.category} shelf={categories} onChange={(category) => onChange({ category })} />
          <TagsField tags={d.tags} onChange={(tags) => onChange({ tags })} />
        </>
      )}

      {!same && (
        <Button variant="primary" wide disabled={busy || !canSaveDraft(d)} onClick={onSave}>
          Сохранить на полку
        </Button>
      )}
    </article>
  );
}

/** Раздел: из существующих (и из шапки книги) или новый. */
function CategoryField({ value, shelf, onChange }: { value: string; shelf: string[]; onChange: (category: string) => void }) {
  // Раздел из шапки остаётся в списке, даже если выбрали другой и передумали
  const [own] = useState(value);
  const [creating, setCreating] = useState(false);
  const [custom, setCustom] = useState('');
  const options = own && !shelf.includes(own) ? [own, ...shelf] : shelf;

  return (
    <>
      <label class="pf">
        <span class="pf__label">Раздел</span>
        <span class="pf__select">
          <select
            class="pf__input"
            value={creating ? NEW_CATEGORY : value}
            onChange={(e) => {
              const picked = e.currentTarget.value;
              if (picked === NEW_CATEGORY) {
                setCreating(true);
                onChange(custom);
              } else {
                setCreating(false);
                onChange(picked);
              }
            }}
          >
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={NEW_CATEGORY}>Новый раздел…</option>
          </select>
        </span>
      </label>
      {creating && (
        <label class="pf">
          <span class="pf__label">Название нового раздела</span>
          <input
            class="pf__input"
            type="text"
            value={custom}
            autocomplete="off"
            enterkeyhint="done"
            onInput={(e) => {
              setCustom(e.currentTarget.value);
              onChange(e.currentTarget.value);
            }}
          />
        </label>
      )}
    </>
  );
}

/** Теги через запятую: пока печатаешь, запятые и пробелы остаются как есть. */
function TagsField({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tagsToText(tags));
  return (
    <label class="pf">
      <span class="pf__label">Теги через запятую</span>
      <input
        class="pf__input"
        type="text"
        value={text}
        autocomplete="off"
        autocapitalize="off"
        enterkeyhint="done"
        onInput={(e) => {
          setText(e.currentTarget.value);
          onChange(parseTags(e.currentTarget.value));
        }}
      />
    </label>
  );
}
