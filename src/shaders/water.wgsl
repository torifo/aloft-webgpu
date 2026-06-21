// water.wgsl — reflective water plane at the destination water level. A big quad
// at y = waterLevelY; fragment fakes a Fresnel-weighted sky reflection + ripples.

struct Water {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
  sunDir   : vec4<f32>,   // xyz dir to sun, w = time-of-day
  params   : vec4<f32>,   // x=time, y=waterLevelY, z=fogFar, w=accentTint(unused)
  tint     : vec4<f32>,   // rgb water base color
};

@group(0) @binding(0) var<uniform> u : Water;

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> VOut {
  var out : VOut;
  out.clip = u.viewProj * vec4<f32>(position, 1.0);
  out.world = position;
  return out;
}

fn hash2(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn noise(p : vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2<f32>(1.0,0.0)), u.x),
             mix(hash2(i + vec2<f32>(0.0,1.0)), hash2(i + vec2<f32>(1.0,1.0)), u.x), u.y);
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4<f32> {
  let t = u.params.x;
  let viewVec = normalize(u.camPos.xyz - in.world);
  let up = vec3<f32>(0.0, 1.0, 0.0);
  // ripple-perturbed normal
  let r = in.world.xz * 0.02;
  let nx = (noise(r + vec2<f32>(t * 0.3, 0.0)) - 0.5) * 0.25;
  let nz = (noise(r + vec2<f32>(0.0, t * 0.27)) - 0.5) * 0.25;
  let n = normalize(vec3<f32>(nx, 1.0, nz));

  // Fresnel: more reflective at grazing angles
  let fres = pow(1.0 - max(dot(viewVec, n), 0.0), 3.0);
  let tod = u.sunDir.w;
  let day = smoothstep(0.0, 0.5, 1.0 - abs(tod - 0.5) * 2.0);
  let skyRefl = mix(vec3<f32>(0.10, 0.14, 0.24), vec3<f32>(0.55, 0.70, 0.92), day);
  let base = u.tint.rgb;
  var col = mix(base, skyRefl, clamp(fres + 0.2, 0.0, 1.0));

  // sun glint
  let h = normalize(viewVec + normalize(u.sunDir.xyz));
  let spec = pow(max(dot(n, h), 0.0), 220.0);
  let gold = mix(vec3<f32>(1.0,0.95,0.85), vec3<f32>(1.0,0.6,0.3),
                 max(smoothstep(0.45,0.0,abs(tod-0.27)), smoothstep(0.45,0.0,abs(tod-0.73))));
  col += gold * spec * 1.5;

  // distance fog toward horizon
  let dist = length(u.camPos.xyz - in.world);
  let fog = smoothstep(u.params.z * 0.2, u.params.z * 0.95, dist);
  let fogCol = mix(vec3<f32>(0.10,0.14,0.22), vec3<f32>(0.80,0.84,0.90), day);
  col = mix(col, fogCol, fog * 0.85);

  return vec4<f32>(col, 0.92);
}
