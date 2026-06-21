// gen_heightmap.mjs — generate a SYNTHETIC grayscale-PNG DEM for aloft.
//
// The output assets/heightmap.png is fractal value-noise (fBm), NOT real-world
// elevation. It exists only so the MVP has a small, locally-bundled DEM to render.
// To use REAL data: export an 8-bit grayscale PNG from a DEM/GeoTIFF
//   (e.g. gdal_translate -of PNG -ot Byte -scale src.tif heightmap.png)
// and drop it in at assets/heightmap.png — any size works.
//
// Zero dependencies. PNG written with a tiny self-contained encoder (zlib stored
// blocks + manual CRC/Adler32), so no npm install is required.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const OCTAVES = 6;
const SEED = 1337;

// --- deterministic value noise -------------------------------------------------
function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h & 0xffffff) / 0xffffff; // 0..1
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const v00 = hash2(x0, y0, seed), v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed), v11 = hash2(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}
function fbm(x, y) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < OCTAVES; o++) {
    sum += amp * valueNoise(x * freq, y * freq, SEED + o);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // 0..1
}

// --- build pixel buffer (grayscale, 1 byte/px) ---------------------------------
const gray = new Uint8Array(SIZE * SIZE);
let lo = Infinity, hi = -Infinity;
const raw = new Float32Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // scale into a few "mountain" cells, add a radial falloff for an island look
    const nx = (x / SIZE) * 4;
    const ny = (y / SIZE) * 4;
    let h = fbm(nx, ny);
    const cx = x / SIZE - 0.5, cy = y / SIZE - 0.5;
    const d = Math.sqrt(cx * cx + cy * cy) * 1.6;
    h = h * Math.max(0, 1 - d * d); // island falloff
    raw[y * SIZE + x] = h;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
}
for (let i = 0; i < raw.length; i++) {
  const v = (raw[i] - lo) / (hi - lo || 1);
  gray[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
}

// --- PNG encoder (8-bit grayscale, no palette) ---------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function u32(n) {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

// raw scanlines: each row prefixed with filter byte 0
const stride = SIZE + 1;
const rawImg = new Uint8Array(stride * SIZE);
for (let y = 0; y < SIZE; y++) {
  rawImg[y * stride] = 0;
  rawImg.set(gray.subarray(y * SIZE, y * SIZE + SIZE), y * stride + 1);
}

// zlib stream with stored (uncompressed) DEFLATE blocks
function zlibStore(data) {
  const MAX = 65535;
  const blocks = [];
  for (let off = 0; off < data.length; off += MAX) {
    const len = Math.min(MAX, data.length - off);
    const final = off + len >= data.length ? 1 : 0;
    const hdr = new Uint8Array(5);
    hdr[0] = final; // BFINAL, BTYPE=00
    hdr[1] = len & 255;
    hdr[2] = (len >> 8) & 255;
    hdr[3] = ~len & 255;
    hdr[4] = (~len >> 8) & 255;
    blocks.push(hdr, data.subarray(off, off + len));
  }
  const bodyLen = blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(2 + bodyLen + 4);
  out[0] = 0x78; out[1] = 0x01; // zlib header
  let p = 2;
  for (const b of blocks) { out.set(b, p); p += b.length; }
  out.set(u32(adler32(data)), p);
  return out;
}

const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const ihdr = new Uint8Array(13);
ihdr.set(u32(SIZE), 0);
ihdr.set(u32(SIZE), 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 0;  // color type 0 = grayscale
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const idat = zlibStore(rawImg);
const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
const total = parts.reduce((s, p) => s + p.length, 0);
const png = new Uint8Array(total);
let q = 0;
for (const p of parts) { png.set(p, q); q += p.length; }

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "assets", "heightmap.png");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${SIZE}x${SIZE} grayscale, SYNTHETIC fBm)`);
