// Generates the Plainfold master icon: a blank page with a text cursor.
// Written without image dependencies so the asset can be rebuilt anywhere.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = 1024;
const SS = 4; // supersampling factor for smooth edges
const S = OUT * SS;

const px = new Uint8Array(S * S * 4);

function insideRoundRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + r, Math.min(x, right - r));
  const cy = Math.max(top + r, Math.min(y, bottom - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundRect(left, top, right, bottom, r, color) {
  const x0 = Math.max(0, Math.floor(left * S));
  const x1 = Math.min(S - 1, Math.ceil(right * S));
  const y0 = Math.max(0, Math.floor(top * S));
  const y1 = Math.min(S - 1, Math.ceil(bottom * S));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      if (!insideRoundRect(u, v, left, top, right, bottom, r)) continue;
      const i = (y * S + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = color[3];
    }
  }
}

const ink = [28, 36, 48, 255];
const paper = [252, 252, 250, 255];
const accent = [37, 99, 235, 255];

// Page and border.
const left = 0.24;
const right = 0.76;
const top = 0.1;
const bottom = 0.9;
const radius = 0.05;
fillRoundRect(left, top, right, bottom, radius, ink);
fillRoundRect(left + 0.035, top + 0.035, right - 0.035, bottom - 0.035, radius * 0.7, paper);

// Text cursor: a bar with a small foot, readable at 16 px.
fillRoundRect(0.487, 0.38, 0.513, 0.68, 0.006, accent);
fillRoundRect(0.46, 0.67, 0.54, 0.705, 0.008, accent);

// Downsample.
const out = new Uint8Array(OUT * OUT * 4);
const n = SS * SS;
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = (((y * SS + sy) * S) + (x * SS + sx)) * 4;
        const alpha = px[i + 3] / 255;
        r += px[i] * alpha;
        g += px[i + 1] * alpha;
        b += px[i + 2] * alpha;
        a += alpha;
      }
    }
    const o = (y * OUT + x) * 4;
    if (a > 0) {
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
}

// Minimal PNG writer (RGBA, 8-bit, one IDAT).
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc((OUT * 4 + 1) * OUT);
for (let y = 0; y < OUT; y++) {
  raw[y * (OUT * 4 + 1)] = 0;
  Buffer.from(out.buffer, out.byteOffset + y * OUT * 4, OUT * 4).copy(raw, y * (OUT * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../assets/icon-master.png");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png);
console.log(`wrote ${target} (${png.length} bytes)`);
