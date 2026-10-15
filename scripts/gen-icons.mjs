/**
 * Writes the PWA icons into public/ as real PNGs.
 *
 * Hand-rolled rather than pulled from a library because the project has no
 * image dependency and this is a rounded square with a letter on it — a few
 * lines of zlib and CRC is cheaper than another package. Re-run with
 * `npm run gen:icons` if the brand colour changes; the output is committed so a
 * fresh clone does not need to.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BRAND = [0x6d, 0x4a, 0xff]; // brand-500, matching tailwind.config.ts
const INK = [0x15, 0x13, 0x1f];

// A 5x7 "F", one row per string. Scaled up to whatever size is asked for.
const GLYPH = ['11111', '10000', '10000', '11110', '10000', '10000', '10000'];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * @param size   square side in pixels
 * @param inset  fraction of the side left transparent on each edge. A maskable
 *               icon must keep its content inside the middle 80%, so the safe
 *               variant passes 0 here and paints the background edge to edge.
 */
function icon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const pad = maskable ? Math.round(size * 0.1) : 0;

  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  // Background: a rounded square, or the full bleed for the maskable variant.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (radius > 0) {
        const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
        const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      set(x, y, BRAND);
    }
  }

  // The letter, centred in whatever space is left after the mask padding.
  const box = size - pad * 2;
  const cell = Math.floor((box * 0.52) / 5);
  const w = cell * 5;
  const h = cell * 7;
  const ox = pad + Math.round((box - w) / 2);
  const oy = pad + Math.round((box - h) / 2);
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (GLYPH[gy][gx] !== '1') continue;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          set(ox + gx * cell + x, oy + gy * cell + y, [255, 255, 255]);
        }
      }
    }
  }

  // PNG scanlines carry a leading filter byte; 0 means "no filter".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [
  ['public/icon-192.png', icon(192)],
  ['public/icon-512.png', icon(512)],
  ['public/icon-maskable-512.png', icon(512, { maskable: true })],
  // iOS ignores the manifest icons and wants this one, opaque, at 180px.
  ['public/apple-touch-icon.png', icon(180)],
];

for (const [path, buf] of files) {
  writeFileSync(path, buf);
  console.log(`${path}  ${(buf.length / 1024).toFixed(1)} kB`);
}
void INK;
