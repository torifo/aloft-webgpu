// png.mjs — minimal self-contained PNG decode/encode for the aloft DEM toolchain.
// Decode: 8-bit RGB / RGBA / grayscale, all 5 scanline filters, single zlib stream.
// Encode: 8-bit grayscale, deflate via node:zlib.
// Used at BUILD time only (Node). Zero npm deps.

import zlib from "node:zlib";

const SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function u32be(buf, off) {
  return (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0;
}

/**
 * Decode a PNG buffer to { width, height, channels, data:Uint8Array }.
 * Supports 8-bit color types 0 (gray), 2 (RGB), 6 (RGBA).
 * @param {Buffer|Uint8Array} input
 */
export function decodePNG(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error("not a PNG (bad signature)");
  }
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = u32be(buf, p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = u32be(data, 0);
      height = u32be(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (need 8)`);
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;                 // bytes per pixel (8-bit)
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);

  // Reconstruct scanline filters per PNG spec (filter byte precedes each row).
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const row = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[inPos++];
      const a = x >= bpp ? row[x - bpp] : 0;          // left
      const b = prev ? prev[x] : 0;                    // up
      const c = prev && x >= bpp ? prev[x - bpp] : 0;  // up-left
      let val;
      switch (filter) {
        case 0: val = rawByte; break;                  // None
        case 1: val = rawByte + a; break;              // Sub
        case 2: val = rawByte + b; break;              // Up
        case 3: val = rawByte + ((a + b) >> 1); break; // Average
        case 4: {                                      // Paeth
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          val = rawByte + pr;
          break;
        }
        default: throw new Error(`unsupported PNG filter ${filter}`);
      }
      row[x] = val & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
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

/**
 * Encode an 8-bit grayscale image to a PNG Buffer.
 * @param {Uint8Array} gray   length width*height
 * @param {number} width
 * @param {number} height
 */
export function encodeGrayPNG(gray, width, height) {
  if (gray.length !== width * height) throw new Error("gray length mismatch");
  const stride = width + 1;
  const rawImg = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    rawImg[y * stride] = 0; // filter None
    rawImg.set(gray.subarray(y * width, y * width + width), y * stride + 1);
  }
  const idat = zlib.deflateSync(Buffer.from(rawImg));
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // grayscale
  const parts = [SIG, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, q) => s + q.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const part of parts) { png.set(part, off); off += part.length; }
  return Buffer.from(png);
}
