/** Хранилище `settings`: строки `{key, value}`, незаписанные ключи берутся из `DEFAULT_SETTINGS`. */
import { DEFAULT_SETTINGS, type Settings } from '../core/types';
import { openDb } from './schema';

const KNOWN = new Set<string>(Object.keys(DEFAULT_SETTINGS));

export async function getSettings(): Promise<Settings> {
  const rows = await (await openDb()).getAll('settings');
  const stored: Record<string, unknown> = {};
  for (const row of rows) if (KNOWN.has(row.key)) stored[row.key] = row.value;
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

/** Записывает только переданные ключи; `undefined` пропускается. */
export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('settings', 'readwrite');
  const puts = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => tx.store.put({ key, value }));
  await Promise.all([...puts, tx.done]);
}
