/**
 * Отдать файл пользователю: на телефоне — системное меню «Поделиться» (там есть «Сохранить в Файлы»),
 * иначе обычное скачивание. Нужна свежая жестом ввода: звать из обработчика нажатия, и до первого
 * `await`: `navigator.share` вызывается синхронно, пока жест ещё считается свежим (iOS).
 *
 * `true` — файл отдан (меню открыто и выбран вариант, либо скачан). `false` — меню закрыли, ничего не
 * отдано: например, копию тогда считать сделанной нельзя.
 */
export async function shareOrDownload(name: string, data: Blob): Promise<boolean> {
  const file = new File([data], name, { type: data.type });
  if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      // Закрыл меню сам — ничего больше не делаем; любая другая ошибка — скачиваем.
      if ((e as { name?: string } | null)?.name === 'AbortError') return false;
    }
  }
  download(name, data);
  return true;
}

/** Safari отменяет скачивание, если адрес освободить сразу после клика. */
const REVOKE_AFTER_MS = 10_000;

function download(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
