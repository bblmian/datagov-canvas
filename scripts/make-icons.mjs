// Generates the toolbar/store icons (public/icons/icon{16,32,48,128}.png) without any image library:
// a rounded blue square with two white "tables" joined by a relation line.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for smooth edges
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
          const a = p[3] / 255;
          acc = [acc[0] + p[0] * a, acc[1] + p[1] * a, acc[2] + p[2] * a, acc[3] + a];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = acc[3] / 16;
      raw[o] = a ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const BLUE = [37, 99, 235, 255];
const WHITE = [255, 255, 255, 255];
const LIGHT = [191, 219, 254, 255];
const NONE = [0, 0, 0, 0];

function pixel(x, y) {
  if (!inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) return NONE;
  // table A (top-left) and table B (bottom-right): white header + light body
  const table = (x0, y0) => {
    if (!inRoundRect(x, y, x0, y0, x0 + 0.34, y0 + 0.36, 0.04)) return null;
    return y < y0 + 0.11 ? WHITE : LIGHT;
  };
  const a = table(0.13, 0.14);
  if (a) return a;
  const b = table(0.53, 0.5);
  if (b) return b;
  // relation: horizontal from A's right, then vertical down to B's top
  const onH = y > 0.3 && y < 0.36 && x > 0.47 && x < 0.73;
  const onV = x > 0.67 && x < 0.73 && y > 0.3 && y < 0.5;
  if (onH || onV) return WHITE;
  return BLUE;
}

mkdirSync('public/icons', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${s}.png`, png(s, pixel));
console.log('icons written');
