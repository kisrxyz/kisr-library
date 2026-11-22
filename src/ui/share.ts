/**
 * Отдать файл пользователю: на телефоне — системное меню «Поделиться» (там есть «Сохранить в Файлы»),
 * иначе обычное скачивание. Нужна свежая жестом ввода: звать из обработчика нажатия.
 */
export async function shareOrDownload(name: string, data: Blob): Promise<void> {
  const file = new File([data], name, { type: data.type });
  if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      // Закрыл меню сам — ничего больше не делаем; любая другая ошибка — скачиваем.
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
    }
  }
  download(name, data);
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
