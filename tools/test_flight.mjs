// test_flight.mjs — Catmull-Rom spline continuity/endpoints + free-flight integrator.
import assert from "node:assert/strict";
import {
  catmullRom, sampleSpline, buildGlidePath, stepFreeFlight,
} from "../src/flightpath.js";

let pass = 0;
const ok = (n) => { console.log("  ok -", n); pass++; };

const finite3 = (p) => p.every(Number.isFinite);

// 1) catmullRom passes through p1 (t=0) and p2 (t=1)
{
  const p0 = [0, 0, 0], p1 = [1, 2, 3], p2 = [4, 0, -1], p3 = [5, 5, 5];
  const a = catmullRom(p0, p1, p2, p3, 0);
  const b = catmullRom(p0, p1, p2, p3, 1);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(a[i] - p1[i]) < 1e-9, "t=0 -> p1");
    assert.ok(Math.abs(b[i] - p2[i]) < 1e-9, "t=1 -> p2");
  }
  ok("catmullRom endpoints");
}

// 2) closed spline: continuity across the wrap (u≈1 ~ u≈0) and all finite
{
  const pts = buildGlidePath(1000, 400);
  assert.ok(pts.length >= 4);
  const near0 = sampleSpline(pts, 0.0).pos;
  const nearEnd = sampleSpline(pts, 0.99999).pos;
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(near0[i] - nearEnd[i]) < 5, "closed-loop seam continuous");
  }
  ok("closed spline seam continuity");
}

// 3) dense sampling: finite positions + unit tangents, no jumps
{
  const pts = buildGlidePath(800, 300);
  let prev = null;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const s = sampleSpline(pts, u);
    assert.ok(finite3(s.pos), `finite pos at u=${u}`);
    assert.ok(finite3(s.tangent), `finite tangent at u=${u}`);
    const tl = Math.hypot(...s.tangent);
    assert.ok(Math.abs(tl - 1) < 1e-3, `unit tangent at u=${u}`);
    if (prev) {
      const d = Math.hypot(s.pos[0] - prev[0], s.pos[1] - prev[1], s.pos[2] - prev[2]);
      assert.ok(d < 200, `no large jump at u=${u} (d=${d})`);
    }
    prev = s.pos;
  }
  ok("dense spline sampling finite + smooth");
}

// 4) buildGlidePath flies above the summit
{
  const top = 500;
  const pts = buildGlidePath(1000, top);
  for (const p of pts) assert.ok(p[1] > top, "all control points above summit");
  ok("glide path stays above terrain");
}

// 5) free-flight integrator: bounded speed, finite state, dive gains speed
{
  const st = { pos: [0, 100, 0], yaw: 0, pitch: 0, speed: 90 };
  for (let i = 0; i < 200; i++) stepFreeFlight(st, { pitch: 0, yaw: 0.2, throttle: 0 }, 0.016);
  assert.ok(finite3(st.pos) && Number.isFinite(st.speed));
  assert.ok(st.speed >= 30 && st.speed <= 320, "speed clamped");

  // negative pitch = nose down = dive; should descend and gain speed, no NaN
  const st2 = { pos: [0, 500, 0], yaw: 0, pitch: 0, speed: 90 };
  const before = st2.speed;
  for (let i = 0; i < 60; i++) stepFreeFlight(st2, { pitch: -0.8, yaw: 0, throttle: 0 }, 0.016);
  assert.ok(Number.isFinite(st2.speed) && st2.pos[1] < 500, "dive descends");
  assert.ok(st2.speed >= before, "dive gains/holds speed");
  ok("free-flight integrator bounded + finite");
}

console.log(`\n${pass} flight tests passed.`);
