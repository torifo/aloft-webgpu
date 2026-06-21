// sky.wgsl — fullscreen gradient sky + sun disc/halo. Reconstructs a view ray
// per pixel from the inverse view-projection, so it sits behind everything.

struct Scene {
  invViewProj : mat4x4<f32>,
  camPos      : vec4<f32>,   // xyz = camera world pos
  sunDir      : vec4<f32>,   // xyz = direction TO sun (normalized), w = time-of-day 0..1
  params      : vec4<f32>,   // x = aspect, y = waterLevelY, z = horizonHaze, w = far
};

@group(0) @binding(0) var<uniform> s : Scene;

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VOut {
  // fullscreen triangle
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out : VOut;
  out.clip = vec4<f32>(p[vid], 0.0, 1.0);
  out.ndc = p[vid];
  return out;
}

fn rayDir(ndc : vec2<f32>) -> vec3<f32> {
  let far = s.invViewProj * vec4<f32>(ndc.x, ndc.y, 1.0, 1.0);
  let near = s.invViewProj * vec4<f32>(ndc.x, ndc.y, 0.0, 1.0);
  let fw = far.xyz / far.w;
  let nw = near.xyz / near.w;
  return normalize(fw - nw);
}

// Golden-hour palette interpolated by time-of-day (0=night,0.5=noon,1=night).
fn skyGradient(dir : vec3<f32>, tod : f32) -> vec3<f32> {
  let up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  // day vs golden vs night anchors
  let zenithDay = vec3<f32>(0.18, 0.40, 0.78);
  let horizonDay = vec3<f32>(0.72, 0.82, 0.92);
  let zenithGold = vec3<f32>(0.10, 0.18, 0.42);
  let horizonGold = vec3<f32>(0.98, 0.62, 0.34);
  let zenithNight = vec3<f32>(0.02, 0.03, 0.08);
  let horizonNight = vec3<f32>(0.06, 0.08, 0.16);
  // daylight factor: 1 at noon, 0 at night
  let day = smoothstep(0.0, 0.5, 1.0 - abs(tod - 0.5) * 2.0);
  // goldenness peaks near sunrise/sunset (tod ~0.25 / ~0.75)
  let gold = max(smoothstep(0.45, 0.0, abs(tod - 0.27)), smoothstep(0.45, 0.0, abs(tod - 0.73)));
  let zenithBright = mix(zenithNight, zenithDay, day);
  let horizonBright = mix(horizonNight, horizonDay, day);
  let zenith = mix(zenithBright, zenithGold, gold * 0.7);
  let horizon = mix(horizonBright, horizonGold, gold * 0.85);
  return mix(horizon, zenith, pow(up, 0.8));
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4<f32> {
  let dir = rayDir(in.ndc);
  let tod = s.sunDir.w;
  var col = skyGradient(dir, tod);
  // sun
  let sd = normalize(s.sunDir.xyz);
  let c = max(dot(dir, sd), 0.0);
  let disc = pow(c, 2200.0);
  let halo = pow(c, 8.0) * 0.5;
  let sunCol = mix(vec3<f32>(1.0, 0.95, 0.85), vec3<f32>(1.0, 0.62, 0.32),
                   max(smoothstep(0.45, 0.0, abs(tod - 0.27)), smoothstep(0.45, 0.0, abs(tod - 0.73))));
  col += sunCol * (disc * 1.4 + halo);
  return vec4<f32>(col, 1.0);
}
