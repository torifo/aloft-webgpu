// fetch_dem.mjs — BUILD-TIME real DEM fetch from AWS Terrain Tiles (terrarium).
// For each destination: fetch the covering z/x/y PNG tiles, stitch, decode elevation
// = (R*256 + G + B/256) - 32768, downsample to ~512², and write assets/<id>.png
// (8-bit grayscale, brightness = normalized elevation) + assets/<id>.json (meta).
//
// Runtime is network-free; this runs at build time only (Node fetch). If a place's
// fetch fails, it FALLS BACK to the procedural generator and marks the meta source.
//
// Usage:
//   node tools/fetch_dem.mjs            # all destinations
//   node tools/fetch_dem.mjs fuji       # one destination
//   node tools/fetch_dem.mjs --fallback # skip network, force procedural

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodeGrayPNG } from "./png.mjs";
import {
  DESTINATIONS, destById, tileRange, terrariumElev, downsample,
  metersPerPixel, percentile,
} from "./dem_common.mjs";
import { generateGrid, buildMeta, writeAssets, SIZE } from "./gen_fallback.mjs";

const TILE_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const TILE_PX = 256;
const TARGET = SIZE; // 512
const here = dirname(fileURLToPath(import.meta.url));

async function fetchTile(z, x, y, timeoutMs = 20000) {
  const url = `${TILE_BASE}/${z}/${x}/${y}.png`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return decodePNG(buf);
  } finally {
    clearTimeout(t);
  }
}

/** Stitch the tile range into one elevation (meters) grid. */
async function fetchElevGrid(dest) {
  const tr = tileRange(dest);
  const W = tr.nx * TILE_PX, H = tr.ny * TILE_PX;
  const elev = new Float32Array(W * H);
  let tiles = 0;
  for (let ty = tr.y0; ty <= tr.y1; ty++) {
    for (let tx = tr.x0; tx <= tr.x1; tx++) {
      const img = await fetchTile(tr.z, tx, ty);
      if (img.width !== TILE_PX || img.height !== TILE_PX) {
        throw new Error(`unexpected tile size ${img.width}x${img.height}`);
      }
      const ch = img.channels;
      const ox = (tx - tr.x0) * TILE_PX, oy = (ty - tr.y0) * TILE_PX;
      for (let py = 0; py < TILE_PX; py++) {
        for (let px = 0; px < TILE_PX; px++) {
          const si = (py * TILE_PX + px) * ch;
          const m = terrariumElev(img.data[si], img.data[si + 1], img.data[si + 2]);
          elev[(oy + py) * W + (ox + px)] = m;
        }
      }
      tiles++;
    }
  }
  return { elev, W, H, tiles, z: tr.z };
}

function processRealDem(dest, elev, W, H, z) {
  const grid = downsample(elev, W, H, TARGET); // meters, 512²
  let emin = Infinity, emax = -Infinity;
  for (const v of grid) { if (v < emin) emin = v; if (v > emax) emax = v; }
  const span = emax - emin || 1;
  // water level: a low percentile of elevation (sea/river/lake floor reference)
  const waterMeters = percentile(grid, dest.waterPercentile);
  const waterNorm = (waterMeters - emin) / span;

  const norm = new Float32Array(grid.length);
  const gray = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const t = (grid[i] - emin) / span;
    norm[i] = t;
    gray[i] = Math.max(0, Math.min(255, Math.round(t * 255)));
  }
  const mpp = metersPerPixel(dest.lat, z) * (W / TARGET); // real-world meters per output sample
  const meta = {
    id: dest.id, name: dest.name, source: "aws-terrarium",
    size: TARGET, z,
    elevMin: Math.round(emin), elevMax: Math.round(emax),
    waterLevel: Math.max(0, Math.min(1, waterNorm)),
    metersPerSample: Math.round(mpp * 10) / 10,
    center: { lat: dest.lat, lon: dest.lon },
    accent: dest.accent, tagline: dest.tagline,
  };
  return { gray, meta };
}

function writeReal(dest, gray, meta) {
  const pngPath = resolve(here, "..", "assets", `${dest.id}.png`);
  const jsonPath = resolve(here, "..", "assets", `${dest.id}.json`);
  mkdirSync(dirname(pngPath), { recursive: true });
  const png = encodeGrayPNG(gray, meta.size, meta.size);
  writeFileSync(pngPath, png);
  writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
  return png.length;
}

function fallback(dest, reason) {
  const grid = generateGrid(dest.id);
  const meta = buildMeta(dest, grid);
  meta.fallbackReason = reason;
  const r = writeAssets(dest, grid, meta);
  return { source: "procedural-fallback", bytes: r.bytes, reason };
}

async function run() {
  const args = process.argv.slice(2);
  const forceFallback = args.includes("--fallback");
  const idArg = args.find((a) => !a.startsWith("--"));
  const list = idArg ? [destById(idArg)].filter(Boolean) : DESTINATIONS;
  if (!list.length) { console.error(`unknown destination "${idArg}"`); process.exit(1); }

  const summary = [];
  for (const dest of list) {
    if (forceFallback) {
      const r = fallback(dest, "forced --fallback");
      console.log(`[${dest.id}] FALLBACK (forced) ${r.bytes} bytes`);
      summary.push({ id: dest.id, source: r.source });
      continue;
    }
    try {
      const tr = tileRange(dest);
      console.log(`[${dest.id}] fetching z${tr.z} tiles x[${tr.x0}..${tr.x1}] y[${tr.y0}..${tr.y1}] (${tr.nx * tr.ny} tiles)…`);
      const { elev, W, H, tiles, z } = await fetchElevGrid(dest);
      const { gray, meta } = processRealDem(dest, elev, W, H, z);
      const bytes = writeReal(dest, gray, meta);
      console.log(`[${dest.id}] REAL DEM ok: ${tiles} tiles -> ${W}x${H} -> ${TARGET}², elev ${meta.elevMin}..${meta.elevMax} m, water=${meta.waterLevel.toFixed(3)}, ${bytes} bytes`);
      summary.push({ id: dest.id, source: "aws-terrarium", elevMin: meta.elevMin, elevMax: meta.elevMax });
    } catch (e) {
      const r = fallback(dest, `fetch failed: ${e.message}`);
      console.warn(`[${dest.id}] FETCH FAILED (${e.message}) -> procedural fallback (${r.bytes} bytes)`);
      summary.push({ id: dest.id, source: r.source, reason: e.message });
    }
  }
  console.log("\n=== summary ===");
  for (const s of summary) {
    console.log(`  ${s.id.padEnd(12)} ${s.source}${s.elevMin != null ? ` (${s.elevMin}..${s.elevMax} m)` : ""}${s.reason ? ` [${s.reason}]` : ""}`);
  }
}

run().catch((e) => { console.error("fatal:", e); process.exit(1); });
