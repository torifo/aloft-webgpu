// clouds.wgsl — cloud sea below the flight path. Fullscreen pass that ray-marches
// a horizontal slab at a fixed altitude, sampling animated fbm noise, then alpha-
// composites over the already-drawn sky+terrain. Drawn with alpha blending.

struct Scene {
  invViewProj : mat4x4<f32>,
  camPos      : vec4<f32>,
  sunDir      : vec4<f32>,   // w = time-of-day
  params      : vec4<f32>,   // x=aspect, y=cloudLevelY, z=time, w=far
};

@group(0) @binding(0) var<uniform> s : Scene;

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out : VOut;
  out.clip = vec4<f32>(p[vid], 0.0, 1.0);
  out.ndc = p[vid];
  return out;
}

fn hash2(p : vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}
fn noise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2<f32>(1.0, 0.0));
  let c = hash2(i + vec2<f32>(0.0, 1.0));
  let d = hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0 : vec2<f32>) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 5; i = i + 1) {
    sum = sum + amp * noise(p);
    p = p * 2.02;
    amp = amp * 0.5;
  }
  return sum;
}

fn rayDir(ndc : vec2<f32>) -> vec3<f32> {
  let far = s.invViewProj * vec4<f32>(ndc.x, ndc.y, 1.0, 1.0);
  let near = s.invViewProj * vec4<f32>(ndc.x, ndc.y, 0.0, 1.0);
  return normalize(far.xyz / far.w - near.xyz / near.w);
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4<f32> {
  let dir = rayDir(in.ndc);
  let cam = s.camPos.xyz;
  let cloudY = s.params.y;
  let t = s.params.z;
  let tod = s.sunDir.w;

  // intersect ray with horizontal cloud plane y = cloudY (cloud sea below us)
  if (abs(dir.y) < 1e-4) { discard; }
  let dist = (cloudY - cam.y) / dir.y;
  if (dist <= 0.0) { discard; }              // plane behind / above camera ray
  let hit = cam + dir * dist;

  // animated cloud density
  let uv = hit.xz * 0.0016 + vec2<f32>(t * 0.01, t * 0.006);
  var d = fbm(uv * 2.0) * 0.65 + fbm(uv * 6.0) * 0.35;
  d = smoothstep(0.45, 0.95, d);

  // distance fade so the sea melts into haze near the horizon
  let fade = 1.0 - smoothstep(s.params.w * 0.15, s.params.w * 0.85, dist);
  let alpha = clamp(d * fade, 0.0, 1.0);

  // shade clouds with warm top / cool base depending on sun
  let day = smoothstep(0.0, 0.5, 1.0 - abs(tod - 0.5) * 2.0);
  let warm = vec3<f32>(1.0, 0.86, 0.72);
  let cool = vec3<f32>(0.74, 0.80, 0.90);
  let col = mix(cool, warm, day * 0.6 + 0.2);
  return vec4<f32>(col, alpha);
}
