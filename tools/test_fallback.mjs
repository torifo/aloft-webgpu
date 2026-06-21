// test_fallback.mjs — procedural fallback generators: value range, no NaN, signature.
import assert from "node:assert/strict";
import { generateGrid, buildMeta } from "./gen_fallback.mjs";
import { DESTINATIONS } from "./dem_common.mjs";

let pass = 0;
const ok = (n) => { console.log("  ok -", n); pass++; };

const SIZE = 64; // small for speed

// 1) every generator: finite, normalized to 0..1, spans the full range
{
  for (const d of DESTINATIONS) {
    const g = generateGrid(d.id, SIZE);
    assert.equal(g.length, SIZE * SIZE, `${d.id} length`);
    let lo = Infinity, hi = -Infinity;
    for (const v of g) {
      assert.ok(Number.isFinite(v), `${d.id} finite`);
      assert.ok(v >= -1e-6 && v <= 1 + 1e-6, `${d.id} in [0,1] got ${v}`);
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    assert.ok(Math.abs(lo - 0) < 1e-6, `${d.id} min ~0`);
    assert.ok(Math.abs(hi - 1) < 1e-6, `${d.id} max ~1`);
  }
  ok("all generators finite + normalized 0..1");
}

// 2) fuji is a cone: center higher than edges
{
  const S = 96;
  const g = generateGrid("fuji", S);
  const center = g[Math.floor(S / 2) * S + Math.floor(S / 2)];
  const corner = g[0];
  assert.ok(center > corner + 0.3, `fuji center (${center}) >> corner (${corner})`);
  ok("fuji cone signature (center peak)");
}

// 3) himalaya has high mean relief vs guilin plain
{
  const S = 96;
  const mean = (id) => { const g = generateGrid(id, S); let s = 0; for (const v of g) s += v; return s / g.length; };
  assert.ok(mean("himalaya") > mean("guilin"), "himalaya higher mean than guilin plain");
  ok("relative relief himalaya > guilin");
}

// 4) buildMeta: sane fields
{
  const g = generateGrid("fjord", SIZE);
  const m = buildMeta(DESTINATIONS.find((d) => d.id === "fjord"), g);
  assert.equal(m.source, "procedural-fallback");
  assert.equal(m.size, SIZE);
  assert.ok(m.elevMax > m.elevMin, "elev range positive");
  assert.ok(m.waterLevel >= 0 && m.waterLevel <= 1, "water level normalized");
  ok("buildMeta fields sane");
}

console.log(`\n${pass} fallback tests passed.`);
