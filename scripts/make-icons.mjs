/**
 * Иконки приложения (spec §11): `npm run icons`.
 * Единственный источник — assets/icon.svg (зелёный квадрат #1C694C, бумажная книга #F2F4F1).
 * Результат (его коммитим, сборка его не пересоздаёт) — в public/icons/:
 *  - icon-192.png, icon-512.png — обычные;
 *  - icon-maskable-512.png — знак сжат, чтобы целиком лежать в безопасной зоне (круг 80% по центру);
 *  - apple-touch-icon.png — 180×180, сплошной фон без прозрачности (iOS сам скругляет углы).
 * Рядом лежит public/favicon.svg — тот же знак со скруглёнными углами для вкладки браузера.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BACKGROUND = '#1C694C';
/** Во сколько раз знак сжимается у maskable: он остаётся внутри круга радиусом 40% стороны. */
const MASKABLE_SCALE = 0.84;

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(join(root, 'assets', 'icon.svg'));
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

/** Квадрат `size`; растровый SVG берётся с запасом по плотности, чтобы края были чистыми. */
async function render(size, scale = 1) {
  const inner = Math.round(size * scale);
  const mark = await sharp(source, { density: (72 * Math.max(inner, 64) * 2) / 512 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: BACKGROUND } })
    .composite([{ input: mark, gravity: 'centre' }])
    .flatten({ background: BACKGROUND })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const files = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, MASKABLE_SCALE],
  ['apple-touch-icon.png', 180, 1],
];
for (const [name, size, scale] of files) {
  writeFileSync(join(outDir, name), await render(size, scale));
  console.log(`public/icons/${name}  ${size}×${size}${scale === 1 ? '' : `, знак ×${scale}`}`);
}

// Значок вкладки: тот же рисунок, но с мягкими углами (у квадрата-иконки углов нет).
const favicon = source
  .toString('utf8')
  .replace(/<!--[\s\S]*?-->\s*/g, '')
  .replace('<rect width="512" height="512" fill="#1C694C" />', '<rect width="512" height="512" rx="112" fill="#1C694C" />');
if (!favicon.includes('rx="112"')) throw new Error('В assets/icon.svg не нашёлся фон-квадрат для favicon');
writeFileSync(join(root, 'public', 'favicon.svg'), favicon);
console.log('public/favicon.svg');
