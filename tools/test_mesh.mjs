// test_mesh.mjs — Node unit test for buildTerrainMesh math (no GPU/DOM).
import assert from "node:assert/strict";
import { buildTerrainMesh } from "../src/mesh.js";

let pass = 0;
const ok = (name) => { console.log("  ok -", name); pass++; };

// 1) counts on a 4x3 grid
{
  const W = 4, H = 3;
  const data = new Float32Array(W * H).fill(0);
  const m = buildTerrainMesh({ width: W, height: H, data });
  assert.equal(m.vertexCount, W * H);
  assert.equal(m.positions.length, W * H * 3);
  assert.equal(m.normals.length, W * H * 3);
  assert.equal(m.indexCount, (W - 1) * (H - 1) * 6);
  assert.equal(m.indices.length, m.indexCount);
  ok("vertex/index counts");
}

// 2) all indices in range
{
  const W = 8, H = 5;
  const data = new Float32Array(W * H).map((_, i) => (i % 7) / 7);
  const m = buildTerrainMesh({ width: W, height: H, data });
  for (const idx of m.indices) {
    assert.ok(idx >= 0 && idx < m.vertexCount, `index ${idx} out of range`);
  }
  ok("indices within range");
}

// 3) flat grid -> up normals + minH==maxH==0
{
  const W = 5, H = 5;
  const data = new Float32Array(W * H).fill(0.5);
  const m = buildTerrainMesh({ width: W, height: H, data }, { heightScale: 10 });
  for (let i = 0; i < m.vertexCount; i++) {
    assert.ok(Math.abs(m.normals[i * 3 + 0]) < 1e-6, "nx≈0");
    assert.ok(Math.abs(m.normals[i * 3 + 1] - 1) < 1e-6, "ny≈1");
    assert.ok(Math.abs(m.normals[i * 3 + 2]) < 1e-6, "nz≈0");
  }
  // flat => all heights equal => minH==maxH
  assert.equal(m.minH, m.maxH);
  assert.equal(m.minH, 0.5 * 10);
  ok("flat grid normals point up, minH==maxH");
}

// 4) sloped grid -> minH < maxH and a tilted normal
{
  const W = 4, H = 4;
  const data = new Float32Array(W * H);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) data[z * W + x] = x / (W - 1);
  const m = buildTerrainMesh({ width: W, height: H, data }, { heightScale: 30 });
  assert.ok(m.maxH > m.minH, "maxH > minH on a slope");
  // an interior vertex should have nonzero x-tilt because height varies in x
  const c = (1 * W + 1) * 3;
  assert.ok(Math.abs(m.normals[c + 0]) > 1e-3, "interior normal tilts in x");
  ok("sloped grid height range + tilted normal");
}

// 5) guards
{
  assert.throws(() => buildTerrainMesh({ width: 1, height: 5, data: new Float32Array(5) }));
  assert.throws(() => buildTerrainMesh({ width: 3, height: 3, data: new Float32Array(8) }));
  ok("input guards throw");
}

console.log(`\n${pass} mesh tests passed.`);
