// gen_fallback.mjs — per-destination PROCEDURAL heightmaps (offline fallback).
// Used when AWS Terrain Tiles cannot be fetched. Each generator approximates the
// signature shape of its real place. Output: a Float32 grid (0..1) + meta, written
// as assets/<id>.png (grayscale) + assets/<id>.json. Deterministic (seeded).
//
// Exports the generators so they can be unit-tested for value range / no-NaN.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeGrayPNG } from "./png.mjs";
import { DESTINATIONS, destById } from "./dem_common.mjs";

export const SIZE = 512;

// --- deterministic value noise -------------------------------------------------
function hash2(ix, iy, seed) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h & 0xffffff) / 0xffffff;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const v00 = hash2(x0, y0, seed), v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed), v11 = hash2(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}
function fbm(x, y, seed, octaves = 6, gain = 0.5, lac = 2) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o);
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}
// ridged multifractal: sharp crests (himalaya / fjord walls)
function ridged(x, y, seed, octaves = 6) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * valueNoise(x * freq, y * freq, seed + o) - 1);
    sum += amp * n * n;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// --- per-place generators (return value in 0..1) --------------------------------
// Each takes normalized coords nx,ny in [0,1].
const GENERATORS = {
  // Fuji: isolated cone + summit + gentle noise skirt.
  fuji(nx, ny) {
    const dx = nx - 0.5, dy = ny - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy) * 2; // 0 center .. ~1.4 corner
    const cone = Math.max(0, 1 - d * 1.15);
    const peak = Math.pow(cone, 1.6);
    const skirt = fbm(nx * 6, ny * 6, 11) * 0.18 * Math.max(0, 1 - d);
    return Math.min(1, peak * 0.92 + skirt);
  },
  // Grand Canyon: high plateau incised by a meandering river valley.
  grandcanyon(nx, ny) {
    const plateau = 0.62 + fbm(nx * 4, ny * 4, 23) * 0.22;
    // river path meanders in x as a function of y
    const river = 0.5 + 0.18 * Math.sin(ny * Math.PI * 2.0) + 0.06 * Math.sin(ny * Math.PI * 6.3);
    const dist = Math.abs(nx - river);
    const canyon = Math.min(1, dist / 0.16);          // 0 in channel .. 1 outside
    const incision = (1 - canyon) * (1 - canyon);      // deep near river
    const terraces = Math.round((1 - incision) * 5) / 5; // layered steps
    const h = plateau * (0.30 + 0.70 * terraces);
    return Math.max(0.04, Math.min(1, h));
  },
  // Himalaya: ridged multifractal, towering crests.
  himalaya(nx, ny) {
    const base = ridged(nx * 3.2, ny * 3.2, 37, 7);
    const macro = fbm(nx * 1.4, ny * 1.4, 41) * 0.35;
    const h = Math.pow(base, 1.25) * 0.85 + macro;
    return Math.min(1, h);
  },
  // Guilin: flat plain studded with steep limestone towers.
  guilin(nx, ny) {
    const plain = 0.12 + fbm(nx * 5, ny * 5, 53) * 0.05;
    // tower field: high-frequency cellular bumps thresholded to sharp peaks
    let towers = 0;
    const cell = 9;
    const gx = nx * cell, gy = ny * cell;
    const cx = Math.floor(gx), cy = Math.floor(gy);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const px = cx + ox, py = cy + oy;
        const jx = hash2(px, py, 61), jy = hash2(px, py, 67);
        const tx = px + jx, ty = py + jy;
        const dd = Math.hypot(gx - tx, gy - ty);
        const r = 0.34 + hash2(px, py, 71) * 0.12;
        if (dd < r) {
          const t = 1 - dd / r;
          towers = Math.max(towers, Math.pow(t, 0.6) * (0.55 + hash2(px, py, 73) * 0.45));
        }
      }
    }
    return Math.min(1, plain + towers * 0.85);
  },
  // Fjord: high plateaus split by a deep flat-bottomed water channel + steep walls.
  fjord(nx, ny) {
    const highland = 0.55 + ridged(nx * 3.5, ny * 3.5, 83, 6) * 0.45;
    // winding channel in x
    const channel = 0.5 + 0.14 * Math.sin(ny * Math.PI * 1.6) + 0.05 * Math.sin(ny * Math.PI * 5.0);
    const dist = Math.abs(nx - channel);
    const wall = Math.min(1, dist / 0.10);
    // sea level inside channel, sheer rise outside
    const profile = Math.pow(wall, 0.5);
    const h = 0.08 + highland * profile;
    return Math.max(0.02, Math.min(1, h));
  },
};

export function generateGrid(id, size = SIZE) {
  const gen = GENERATORS[id];
  if (!gen) throw new Error(`no fallback generator for "${id}"`);
  const grid = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = gen(x / (size - 1), y / (size - 1));
      grid[y * size + x] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  // normalize to 0..1
  const span = hi - lo || 1;
  for (let i = 0; i < grid.length; i++) grid[i] = (grid[i] - lo) / span;
  return grid;
}

// Plausible real-world elevation ranges (meters) so meta is sensible offline.
const ELEV_RANGES = {
  fuji: [600, 3776], grandcanyon: [760, 2400], himalaya: [3000, 8500],
  guilin: [100, 700], fjord: [0, 1700],
};

export function buildMeta(dest, grid) {
  const [emin, emax] = ELEV_RANGES[dest.id] ?? [0, 3000];
  return {
    id: dest.id,
    name: dest.name,
    source: "procedural-fallback",
    size: Math.round(Math.sqrt(grid.length)),
    elevMin: emin,
    elevMax: emax,
    waterLevel: dest.waterPercentile, // 0..1 in normalized height
    metersPerSample: ((emax - emin) / 255) || 1,
    center: { lat: dest.lat, lon: dest.lon },
    accent: dest.accent,
    tagline: dest.tagline,
  };
}

export function writeAssets(dest, grid, meta) {
  const here = dirname(fileURLToPath(import.meta.url));
  const size = meta.size;
  const gray = new Uint8Array(size * size);
  for (let i = 0; i < grid.length; i++) {
    gray[i] = Math.max(0, Math.min(255, Math.round(grid[i] * 255)));
  }
  const png = encodeGrayPNG(gray, size, size);
  const pngPath = resolve(here, "..", "assets", `${dest.id}.png`);
  const jsonPath = resolve(here, "..", "assets", `${dest.id}.json`);
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath, png);
  writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
  return { pngPath, jsonPath, bytes: png.length };
}

// CLI: regenerate all fallbacks.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const only = process.argv[2];
  const list = only ? [destById(only)].filter(Boolean) : DESTINATIONS;
  if (!list.length) { console.error(`unknown destination "${only}"`); process.exit(1); }
  for (const dest of list) {
    const grid = generateGrid(dest.id);
    const meta = buildMeta(dest, grid);
    const r = writeAssets(dest, grid, meta);
    console.log(`fallback ${dest.id}: ${meta.size}x${meta.size}, ${r.bytes} bytes -> ${r.pngPath}`);
  }
}
