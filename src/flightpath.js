// flightpath.js — hybrid flight: on-rails Catmull-Rom cinematic glide (default)
// + free hang-glider mode (pitch/yaw/speed). Pure math, Node-testable.

import { perspective, lookAt, multiply } from "./camera.js";

/**
 * Centripetal-ish Catmull-Rom interpolation of one segment between p1 and p2,
 * using neighbors p0,p3. t in [0,1]. Each p is [x,y,z].
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (
      2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
    );
  }
  return out;
}

/**
 * Sample a closed Catmull-Rom spline through `points` at global u in [0,1).
 * Returns { pos, tangent } (tangent normalized). Closed loop => C1-continuous.
 * @param {number[][]} points  >= 4 control points [x,y,z]
 */
export function sampleSpline(points, u) {
  const n = points.length;
  if (n < 4) throw new Error("spline needs >= 4 control points");
  const uu = ((u % 1) + 1) % 1;        // wrap into [0,1)
  const f = uu * n;
  const i = Math.floor(f) % n;
  const localT = f - Math.floor(f);
  const p0 = points[(i - 1 + n) % n];
  const p1 = points[i];
  const p2 = points[(i + 1) % n];
  const p3 = points[(i + 2) % n];
  const pos = catmullRom(p0, p1, p2, p3, localT);
  // tangent via small finite difference along u
  const eps = 1e-4;
  const ahead = sampleSplineRaw(points, uu + eps);
  let tx = ahead[0] - pos[0], ty = ahead[1] - pos[1], tz = ahead[2] - pos[2];
  const len = Math.hypot(tx, ty, tz) || 1;
  return { pos, tangent: [tx / len, ty / len, tz / len] };
}

function sampleSplineRaw(points, u) {
  const n = points.length;
  const uu = ((u % 1) + 1) % 1;
  const f = uu * n;
  const i = Math.floor(f) % n;
  const localT = f - Math.floor(f);
  return catmullRom(
    points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n], localT
  );
}

/**
 * Build a per-destination closed cinematic loop above the terrain.
 * `span` is the terrain world extent (XZ); `topY` is the highest terrain Y.
 * Returns an array of control points [x,y,z] sweeping around + diving toward peaks.
 */
export function buildGlidePath(span, topY) {
  const r = span * 0.62;
  const cruiseY = topY * 1.35 + span * 0.12;   // sail high above the summit
  const lowY = topY * 1.08 + span * 0.05;      // swoop closer, still clearing peaks
  const pts = [];
  const N = 8;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    // alternate altitude to give rise/fall rhythm; radius wobble for sweep
    const rr = r * (0.85 + 0.20 * Math.cos(a * 2));
    const y = k % 2 === 0 ? cruiseY : lowY;
    pts.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  return pts;
}

/**
 * On-rails camera: position from spline at u, looking along the tangent toward
 * the terrain center, with a slight downward tilt for the awe/glide feel.
 */
export function railViewProj(points, u, aspect, lookCenterY) {
  const { pos, tangent } = sampleSpline(points, u);
  // Frame the terrain center (the peak sits at the origin), keeping only a small
  // forward lead for cinematic drift. Looking straight along the tangent kept the
  // summit off to the side and out of frame.
  const lead = 0.2;
  const target = [
    (pos[0] + tangent[0] * 60) * lead,
    (lookCenterY ?? 0),
    (pos[2] + tangent[2] * 60) * lead,
  ];
  const proj = perspective((58 * Math.PI) / 180, aspect, 0.5, 8000);
  const view = lookAt(pos, target, [0, 1, 0]);
  return { vp: multiply(proj, view), eye: pos, target };
}

/**
 * Free hang-glider state integrator. Mutates and returns `state`.
 * Controls: pitchInput/yawInput in [-1,1], throttle in [-1,1].
 * @param {object} state {pos:[x,y,z], yaw, pitch, speed}
 * @param {object} input {pitch, yaw, throttle}
 * @param {number} dt seconds
 */
export function stepFreeFlight(state, input, dt) {
  const TURN = 1.0, PITCH_RATE = 0.8, ACCEL = 26, MIN_SPD = 16, MAX_SPD = 130;
  state.yaw += (input.yaw || 0) * TURN * dt;
  state.pitch += (input.pitch || 0) * PITCH_RATE * dt;
  state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch));
  state.speed += (input.throttle || 0) * ACCEL * dt;
  // gravity-ish: diving (negative pitch) gains speed, climbing bleeds it
  state.speed += -Math.sin(state.pitch) * 14 * dt;
  state.speed = Math.max(MIN_SPD, Math.min(MAX_SPD, state.speed));
  const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
  const dir = [
    Math.cos(state.yaw) * cp,
    sp,
    Math.sin(state.yaw) * cp,
  ];
  state.pos[0] += dir[0] * state.speed * dt;
  state.pos[1] += dir[1] * state.speed * dt;
  state.pos[2] += dir[2] * state.speed * dt;
  state.dir = dir;
  return state;
}

export function freeViewProj(state, aspect) {
  const dir = state.dir || [Math.cos(state.yaw), 0, Math.sin(state.yaw)];
  const target = [state.pos[0] + dir[0] * 50, state.pos[1] + dir[1] * 50, state.pos[2] + dir[2] * 50];
  const proj = perspective((64 * Math.PI) / 180, aspect, 0.5, 8000);
  const view = lookAt(state.pos, target, [0, 1, 0]);
  return { vp: multiply(proj, view), eye: state.pos, target };
}
