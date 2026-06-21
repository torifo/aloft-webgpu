// terrain.wgsl — heightfield render: directional hillshade + elevation color ramp
// + snow caps + distance haze (aerial perspective) + time-of-day sun tint.

struct Uniforms {
  viewProj : mat4x4<f32>,
  lightDir : vec4<f32>,   // xyz = direction TO light, w = time-of-day 0..1
  camPos   : vec4<f32>,   // xyz camera world pos
  range    : vec4<f32>,   // x=minH, y=maxH, z=snowStart(0..1), w=fogFar
  tint     : vec4<f32>,   // rgb sun/ambient tint
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) normal     : vec3<f32>,
  @location(1) worldY     : f32,
  @location(2) world      : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  out.clip = u.viewProj * vec4<f32>(position, 1.0);
  out.normal = normal;
  out.worldY = position.y;
  out.world = position;
  return out;
}

// elevation color ramp: deep -> shore -> grass -> rock -> snow
fn rampColor(tIn : f32) -> vec3<f32> {
  let t = clamp(tIn, 0.0, 1.0);
  let water = vec3<f32>(0.18, 0.30, 0.45);
  let shore = vec3<f32>(0.76, 0.70, 0.50);
  let grass = vec3<f32>(0.26, 0.45, 0.22);
  let rock  = vec3<f32>(0.42, 0.38, 0.34);
  let snow  = vec3<f32>(0.95, 0.96, 0.98);
  if (t < 0.20) {
    return mix(water, shore, t / 0.20);
  } else if (t < 0.45) {
    return mix(shore, grass, (t - 0.20) / 0.25);
  } else if (t < 0.75) {
    return mix(grass, rock, (t - 0.45) / 0.30);
  } else {
    return mix(rock, snow, (t - 0.75) / 0.25);
  }
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let l = normalize(u.lightDir.xyz);
  let tod = u.lightDir.w;
  let diffuse = max(dot(n, l), 0.0);
  let day = smoothstep(0.0, 0.5, 1.0 - abs(tod - 0.5) * 2.0);
  let ambient = 0.18 + 0.17 * day;
  let shade = ambient + (1.0 - ambient) * diffuse;

  let span = max(u.range.y - u.range.x, 1e-5);
  let elev = (in.worldY - u.range.x) / span;
  var base = rampColor(elev);

  // snow caps above snowStart, biased by flatness (snow sticks to gentler slopes)
  let snowStart = u.range.z;
  if (elev > snowStart) {
    let flat = clamp(n.y, 0.0, 1.0);
    let snowAmt = smoothstep(snowStart, snowStart + 0.12, elev) * (0.4 + 0.6 * flat);
    base = mix(base, vec3<f32>(0.97, 0.98, 1.0), snowAmt);
  }

  // sun-tinted lighting
  var col = base * shade * u.tint.rgb;

  // aerial perspective: fade distant terrain into haze
  let dist = length(u.camPos.xyz - in.world);
  let fog = smoothstep(u.range.w * 0.25, u.range.w * 0.95, dist);
  let hazeCol = mix(vec3<f32>(0.12, 0.16, 0.26), vec3<f32>(0.80, 0.85, 0.92), day);
  col = mix(col, hazeCol, fog * 0.9);

  return vec4<f32>(col, 1.0);
}
