// test_dem.mjs — terrarium decode + tile math + downsample + PNG round-trip.
import assert from "node:assert/strict";
import {
  terrariumElev, lonLatToTile, tileRange, downsample, percentile, DESTINATIONS,
} from "./dem_common.mjs";
import { decodePNG, encodeGrayPNG } from "./png.mjs";

let pass = 0;
const ok = (n) => { console.log("  ok -", n); pass++; };

// 1) terrarium decode known values
{
  // sea level: (R*256 + G + B/256) - 32768 == 0  => R=128,G=0,B=0
  assert.equal(terrariumElev(128, 0, 0), 0);
  // a documented sample: 1000 m -> 32768+1000=33768 ; R=131,G=232 (131*256+232=33768)
  assert.equal(terrariumElev(131, 232, 0), 1000);
  // fractional B contributes /256
  assert.ok(Math.abs(terrariumElev(130, 12, 128) - 524.5) < 1e-9);
  // negative (below sea level): R=127,G=255,B=0 -> (127*256+255)-32768 = -1
  assert.equal(terrariumElev(127, 255, 0), -1);
  ok("terrarium elevation decode");
}

// 2) slippy tile math: equator/prime-meridian center at z0 -> tile (0.5,0.5)
{
  const c = lonLatToTile(0, 0, 0);
  assert.ok(Math.abs(c.x - 0.5) < 1e-9 && Math.abs(c.y - 0.5) < 1e-9);
  // lon increases -> x increases; lat increases (north) -> y decreases
  const e = lonLatToTile(90, 0, 2);
  const w = lonLatToTile(-90, 0, 2);
  assert.ok(e.x > w.x, "east tile x greater");
  const n = lonLatToTile(0, 45, 2);
  const s = lonLatToTile(0, -45, 2);
  assert.ok(n.y < s.y, "north tile y smaller");
  ok("slippy tile math directionality");
}

// 3) tileRange yields a positive, bounded tile box for every destination
{
  for (const d of DESTINATIONS) {
    const tr = tileRange(d);
    assert.ok(tr.nx >= 1 && tr.ny >= 1, `${d.id} positive tile count`);
    assert.ok(tr.nx * tr.ny <= 40, `${d.id} reasonable tile count`);
    assert.ok(tr.x0 >= 0 && tr.y0 >= 0, `${d.id} non-negative tile origin`);
    const max = 2 ** tr.z;
    assert.ok(tr.x1 < max && tr.y1 < max, `${d.id} tiles within zoom range`);
  }
  ok("tileRange bounded for all destinations");
}

// 4) downsample: counts + value preservation of a constant grid
{
  const sw = 16, sh = 16;
  const src = new Float32Array(sw * sh).fill(42);
  const out = downsample(src, sw, sh, 4);
  assert.equal(out.length, 16);
  for (const v of out) assert.equal(v, 42);
  // corners map correctly for a ramp
  const ramp = new Float32Array(sw * sh).map((_, i) => i % sw);
  const o2 = downsample(ramp, sw, sh, 8);
  assert.ok(Number.isFinite(o2[0]) && o2.every(Number.isFinite));
  ok("downsample counts + finite");
}

// 5) percentile basics
{
  const v = new Float32Array([5, 1, 4, 2, 3]);
  assert.equal(percentile(v, 0), 1);
  assert.equal(percentile(v, 1), 5);
  assert.equal(percentile(v, 0.5), 3);
  ok("percentile min/median/max");
}

// 6) PNG encode -> decode round-trip preserves grayscale bytes
{
  const w = 9, h = 7;
  const gray = new Uint8Array(w * h).map((_, i) => (i * 37) & 0xff);
  const png = encodeGrayPNG(gray, w, h);
  const dec = decodePNG(png);
  assert.equal(dec.width, w);
  assert.equal(dec.height, h);
  assert.equal(dec.channels, 1);
  for (let i = 0; i < gray.length; i++) assert.equal(dec.data[i], gray[i], `px ${i}`);
  ok("PNG gray encode/decode round-trip");
}

console.log(`\n${pass} dem tests passed.`);
