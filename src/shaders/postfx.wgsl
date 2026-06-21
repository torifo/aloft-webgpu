// postfx.wgsl — speed feel pass. Samples the rendered scene texture and adds
// radial wind streaks + edge motion-blur + vignette, intensity scaled by speed.

struct Post {
  params : vec4<f32>,  // x=speed01 (0..1), y=time, z=aspect, w=freeMode(0/1)
};

@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var tex  : texture_2d<f32>;
@group(0) @binding(2) var<uniform> p : Post;

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0), vec2<f32>(2.0, 1.0), vec2<f32>(0.0, -1.0));
  var out : VOut;
  out.clip = vec4<f32>(pos[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

fn hash(p2 : vec2<f32>) -> f32 {
  return fract(sin(dot(p2, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_main(in : VOut) -> @location(0) vec4<f32> {
  let speed = clamp(p.params.x, 0.0, 1.0);
  let t = p.params.y;
  let center = vec2<f32>(0.5, 0.5);
  let toC = in.uv - center;
  let r = length(toC);
  let dir = normalize(toC + vec2<f32>(1e-5));

  // radial motion blur: a few taps marching outward, stronger with speed & radius
  let blurAmt = speed * (0.006 + r * 0.05) * (1.0 + p.params.w);
  var col = textureSample(tex, samp, in.uv).rgb;
  var acc = col;
  for (var i = 1; i <= 4; i = i + 1) {
    let off = dir * blurAmt * f32(i);
    acc = acc + textureSample(tex, samp, in.uv + off).rgb;
  }
  col = acc / 5.0;

  // radial wind streaks (angular noise lines whipping outward)
  let ang = atan2(toC.y, toC.x);
  let streak = hash(vec2<f32>(floor(ang * 40.0), floor(r * 6.0 - t * (2.0 + speed * 8.0))));
  let streakMask = smoothstep(0.985, 1.0, streak) * smoothstep(0.18, 0.6, r) * speed;
  col = col + vec3<f32>(1.0, 1.0, 1.0) * streakMask * 0.4;

  // vignette tightens with speed
  let vig = 1.0 - smoothstep(0.45, 0.95, r) * (0.25 + speed * 0.45);
  col = col * vig;

  return vec4<f32>(col, 1.0);
}
