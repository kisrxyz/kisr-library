/**
 * Подсказка в открытой читалке (spec §18.5): синхронизация принесла другое место чтения этой книги —
 * тост «Ты читал эту книгу на другом устройстве · Перейти». Сама читалка никуда не прыгает.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { BookMeta } from '../../core/types';
import { navigate } from '../../router';
import { progressMap } from '../../state/library';
import { progressArrived } from '../../state/sync';
import { toast } from '../../ui/toast-state';
import { readHref } from '../library/shared';

/** Сколько держать тост: нужно время заметить его посреди чтения. */
const HINT_MS = 10_000;

export function useArrivedHint(book: BookMeta): void {
  const arrived = progressArrived.value;
  // То, что пришло до открытия читалки, уже учтено: книга открылась на свежем месте
  const seen = useRef(arrived);

  useEffect(() => {
    if (!arrived || arrived === seen.current) return;
    seen.current = arrived;
    if (!arrived.ids.includes(book.id)) return;
    const p = progressMap.peek().get(book.id);
    if (!p) return;
    toast('Ты читал эту книгу на другом устройстве', { label: 'Перейти', run: () => navigate(readHref(book, p)) }, HINT_MS);
  }, [arrived, book]);
}
