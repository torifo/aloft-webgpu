// main.js — aloft: Destinations menu -> cinematic glide tour over real-DEM terrain.
// Multi-pass: sky -> terrain -> water -> clouds -> speed postfx. Hybrid flight
// (on-rails Catmull-Rom default; F toggles free hang-glider). Esc returns to menu.

import { initWebGPU, WebGPUUnavailable } from "./gpu.js";
import { loadHeightmap, loadMeta } from "./dem.js";
import { buildTerrainMesh, sampleHeight } from "./mesh.js";
import { orbitViewProj, perspective, lookAt, multiply, invert } from "./camera.js";
import { DESTINATIONS, destById, readHash, writeHash, createMenu } from "./destinations.js";
import {
  buildGlidePath, railViewProj, stepFreeFlight, freeViewProj,
} from "./flightpath.js";
import { createSkyPass } from "./sky.js";
import { createCloudsPass } from "./clouds.js";
import { createWaterPass, buildWaterQuad } from "./water.js";

const canvas = document.getElementById("gpu");
const fallback = document.getElementById("fallback");
const hud = document.getElementById("hud");

function showFallback(msg) {
  if (canvas) canvas.style.display = "none";
  if (fallback) { fallback.style.display = "flex"; fallback.textContent = msg; }
  console.warn("[aloft]", msg);
}
function setHud(msg) { if (hud) hud.innerHTML = msg; }

function interleave(mesh) {
  const out = new Float32Array(mesh.vertexCount * 6);
  for (let i = 0; i < mesh.vertexCount; i++) {
    out[i * 6 + 0] = mesh.positions[i * 3 + 0];
    out[i * 6 + 1] = mesh.positions[i * 3 + 1];
    out[i * 6 + 2] = mesh.positions[i * 3 + 2];
    out[i * 6 + 3] = mesh.normals[i * 3 + 0];
    out[i * 6 + 4] = mesh.normals[i * 3 + 1];
    out[i * 6 + 5] = mesh.normals[i * 3 + 2];
  }
  return out;
}

const fetchText = (url) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`fetch ${r.status} (${url})`);
  return r.text();
});

// time-of-day -> sun direction (azimuth fixed, elevation arcs across the sky)
function sunDirFromTOD(tod) {
  // tod 0..1: 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
  const elev = Math.sin((tod - 0.0) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5; // 0..1
  const a = Math.PI * (0.25 + tod * 0.5);
  const e = (elev * 0.9 + 0.04) * (Math.PI / 2);
  return [Math.cos(a) * Math.cos(e), Math.max(0.06, Math.sin(e)), Math.sin(a) * Math.cos(e)];
}
function sunTint(tod) {
  const day = Math.max(0, 1 - Math.abs(tod - 0.5) * 2);
  const gold = Math.max(
    Math.max(0, 1 - Math.abs(tod - 0.27) / 0.45),
    Math.max(0, 1 - Math.abs(tod - 0.73) / 0.45)
  );
  const night = 1 - day;
  // warm gold, cool night, neutral day
  const r = 0.85 + 0.20 * gold - 0.25 * night;
  const g = 0.85 + 0.02 * gold - 0.20 * night;
  const b = 0.85 - 0.18 * gold - 0.05 * night;
  return [Math.max(0.2, r), Math.max(0.2, g), Math.max(0.25, b)];
}

async function start() {
  if (!canvas) { showFallback("aloft: canvas element missing."); return; }

  let device, context, format;
  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (e) {
    if (e instanceof WebGPUUnavailable) {
      showFallback(
        "aloft needs WebGPU. Your browser/GPU did not provide it.\n" +
        "Try a recent Chrome/Edge (or Safari Technology Preview / Firefox Nightly with WebGPU enabled).\n\n" +
        "Detail: " + e.message);
    } else {
      showFallback("aloft: GPU init error: " + e.message);
    }
    return;
  }

  // ---- pipelines ----
  let terrainShader, skyPass, cloudsPass, waterPass, postModule;
  try {
    [terrainShader, skyPass, cloudsPass, waterPass, postModule] = await Promise.all([
      fetchText("./src/shaders/terrain.wgsl"),
      createSkyPass(device, format, fetchText),
      createCloudsPass(device, format, fetchText),
      createWaterPass(device, format, fetchText),
      fetchText("./src/shaders/postfx.wgsl").then((c) => device.createShaderModule({ code: c })),
    ]);
  } catch (e) {
    showFallback("aloft: pipeline asset load failed.\n" + e.message);
    return;
  }

  // terrain pipeline
  const terrainModule = device.createShaderModule({ code: terrainShader });
  const terrainBGL = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const SCENE_TARGET = "rgba16float"; // offscreen scene color for postfx input
  const terrainPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [terrainBGL] }),
    vertex: {
      module: terrainModule, entryPoint: "vs_main",
      buffers: [{ arrayStride: 24, attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
      ] }],
    },
    fragment: { module: terrainModule, entryPoint: "fs_main", targets: [{ format: SCENE_TARGET }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  // Rebuild sky/clouds/water pipelines against the offscreen target format.
  const skyP = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [skyPass.bgl] }),
    vertex: { module: skyPass.module, entryPoint: "vs_main" },
    fragment: { module: skyPass.module, entryPoint: "fs_main", targets: [{ format: SCENE_TARGET }] },
    primitive: { topology: "triangle-list" },
    // PASS 1 has a depth attachment, so every pipeline used in it must declare a
    // matching depthStencil. Sky is the background fill: never writes/tests depth.
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
  });
  const cloudsP = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [cloudsPass.bgl] }),
    vertex: { module: cloudsPass.module, entryPoint: "vs_main" },
    fragment: { module: cloudsPass.module, entryPoint: "fs_main", targets: [{
      format: SCENE_TARGET,
      blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
               alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } },
    }] },
    primitive: { topology: "triangle-list" },
    // Same as sky: depth attachment present in PASS 1 -> must declare depthStencil.
    // Clouds composite over everything as the final scene layer (no depth write/test).
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
  });
  const waterP = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [waterPass.bgl] }),
    vertex: { module: waterPass.module, entryPoint: "vs_main",
      buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
    fragment: { module: waterPass.module, entryPoint: "fs_main", targets: [{
      format: SCENE_TARGET,
      blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
               alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } },
    }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
  });

  // postfx pipeline (samples offscreen scene -> swapchain)
  const postBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const postPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [postBGL] }),
    vertex: { module: postModule, entryPoint: "vs_main" },
    fragment: { module: postModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const postSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // ---- uniform buffers ----
  const TERRAIN_UBO = 128;            // mat4 + lightDir + camPos + range + tint
  const SCENE_UBO = 112;              // mat4 + camPos + sunDir + params  (sky/clouds)
  const WATER_UBO = 128;              // mat4 + camPos + sunDir + params + tint
  const POST_UBO = 16;
  const terrainUBO = device.createBuffer({ size: TERRAIN_UBO, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const skyUBO = device.createBuffer({ size: SCENE_UBO, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cloudsUBO = device.createBuffer({ size: SCENE_UBO, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const waterUBO = device.createBuffer({ size: WATER_UBO, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const postUBO = device.createBuffer({ size: POST_UBO, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const terrainBG = device.createBindGroup({ layout: terrainBGL, entries: [{ binding: 0, resource: { buffer: terrainUBO } }] });
  const skyBG = device.createBindGroup({ layout: skyPass.bgl, entries: [{ binding: 0, resource: { buffer: skyUBO } }] });
  const cloudsBG = device.createBindGroup({ layout: cloudsPass.bgl, entries: [{ binding: 0, resource: { buffer: cloudsUBO } }] });
  const waterBG = device.createBindGroup({ layout: waterPass.bgl, entries: [{ binding: 0, resource: { buffer: waterUBO } }] });

  // ---- sizing + render targets ----
  let depthTex = null, sceneTex = null, postBG = null;
  function ensureSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h || !depthTex) {
      canvas.width = w; canvas.height = h;
      depthTex?.destroy(); sceneTex?.destroy();
      depthTex = device.createTexture({ size: [w, h], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      sceneTex = device.createTexture({
        size: [w, h], format: SCENE_TARGET,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      postBG = device.createBindGroup({
        layout: postBGL,
        entries: [
          { binding: 0, resource: postSampler },
          { binding: 1, resource: sceneTex.createView() },
          { binding: 2, resource: { buffer: postUBO } },
        ],
      });
    }
  }

  // ---- scene state ----
  const menu = createMenu((id) => enterGlide(id));
  let scene = null;       // current loaded destination scene (buffers + meta)
  let mode = "menu";      // "menu" | "glide"
  let freeMode = false;
  let tod = 0.27;         // golden-hour default (sunrise side)
  const keys = new Set();
  let railU = 0;
  let freeState = null;
  let speed01 = 0;        // smoothed speed feel 0..1
  let loadingId = null;

  const sceneCache = new Map();

  async function loadDestination(id) {
    if (sceneCache.has(id)) return sceneCache.get(id);
    const [grid, meta] = await Promise.all([
      loadHeightmap(`./assets/${id}.png`),
      loadMeta(`./assets/${id}.json`).catch(() => null),
    ]);
    const span = Math.max(grid.width, grid.height);
    // vertical exaggeration: scale normalized 0..1 height into world units.
    // Kept gentle so broad cones (Fuji) read as cones, not needles.
    const heightScale = span * 0.22;
    const mesh = buildTerrainMesh(grid, { spacing: 1.0, heightScale });
    const verts = interleave(mesh);
    const vbuf = device.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, verts);
    const ibuf = device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibuf, 0, mesh.indices);

    const waterNorm = meta?.waterLevel ?? 0.05;
    const waterY = mesh.minH + (mesh.maxH - mesh.minH) * waterNorm;
    const wq = buildWaterQuad(waterY, span * 1.4);
    const wvb = device.createBuffer({ size: wq.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(wvb, 0, wq.vertices);
    const wib = device.createBuffer({ size: wq.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(wib, 0, wq.indices);

    const path = buildGlidePath(span, mesh.maxH);
    const accent = meta?.accent ?? "#7fd1ff";
    const tint = hexToRgb(accent);

    const s = {
      id, meta, grid, mesh, span, heightScale,
      vbuf, ibuf, indexCount: mesh.indexCount,
      waterY, wvb, wib, waterTint: tint,
      path, fogFar: span * 2.2,
      // snowStart normalized: place snow line ~70% of elevation (less for fjord/guilin)
      snowStart: id === "fjord" || id === "guilin" ? 0.85 : 0.62,
    };
    sceneCache.set(id, s);
    return s;
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return [0.18, 0.30, 0.45];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  async function enterGlide(id) {
    const dest = destById(id);
    if (!dest) return;
    loadingId = id;
    menu.setStatus(`loading ${dest.name}…`);
    try {
      scene = await loadDestination(id);
    } catch (e) {
      menu.setStatus(`failed to load ${dest.name}: ${e.message}`);
      return;
    }
    if (loadingId !== id) return; // a newer pick superseded this one
    mode = "glide";
    freeMode = false;
    railU = 0;
    speed01 = 0;
    writeHash(id);
    menu.hide();
    canvas.style.display = "block";
    updateHud();
  }

  function returnToMenu() {
    mode = "menu";
    scene = null;
    writeHash(null);
    menu.show();
    menu.setStatus("");
  }

  function updateHud() {
    if (mode !== "glide" || !scene) { setHud("aloft"); return; }
    const d = destById(scene.id);
    const ja = d?.lang === "ja";
    const name = d?.name ?? scene.id;
    const real = scene.meta?.source === "aws-terrarium";
    const src = ja ? (real ? "実DEM" : "手続き生成") : (real ? "real DEM" : "procedural");
    const elev = scene.meta ? `${scene.meta.elevMin}–${scene.meta.elevMax} m` : "";
    const L = ja
      ? { mode: "モード", free: "自由滑空 (WASD/矢印)", rail: "オンレール・シネマ", toggle: "切替", menu: "メニュー", tod: "時間帯スライダー" }
      : { mode: "mode", free: "FREE glide (WASD/arrows)", rail: "on-rails cinematic", toggle: "toggle", menu: "menu", tod: "time-of-day slider" };
    setHud(
      `<b>${name}</b> · ${src} ${elev}<br>` +
      `${L.mode}: <b>${freeMode ? L.free : L.rail}</b> · ` +
      `<kbd>F</kbd> ${L.toggle} · <kbd>Esc</kbd> ${L.menu} · ${L.tod} ↗`
    );
  }

  // ---- input ----
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") { if (mode === "glide") { returnToMenu(); e.preventDefault(); } return; }
    if (mode !== "glide") return;
    if (e.code === "KeyF") {
      freeMode = !freeMode;
      if (freeMode) {
        // seed free state from current rail position
        const a = railViewProj(scene.path, railU, 1, scene.mesh.maxH * 0.4);
        freeState = { pos: [...a.eye], yaw: Math.atan2(a.target[2] - a.eye[2], a.target[0] - a.eye[0]), pitch: 0.0, speed: 48 };
      }
      updateHud();
      e.preventDefault();
      return;
    }
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // hash deep-link / browser back
  window.addEventListener("hashchange", () => {
    const id = readHash();
    if (id && destById(id)) { if (mode !== "glide" || scene?.id !== id) enterGlide(id); }
    else if (mode === "glide") returnToMenu();
  });

  // ---- render loop ----
  const fSky = new Float32Array(SCENE_UBO / 4);
  const fClouds = new Float32Array(SCENE_UBO / 4);
  const fTerrain = new Float32Array(TERRAIN_UBO / 4);
  const fWater = new Float32Array(WATER_UBO / 4);
  const fPost = new Float32Array(POST_UBO / 4);
  let last = performance.now();
  const startTime = last;

  function readInputs(dt) {
    let pitch = 0, yaw = 0, throttle = 0;
    if (keys.has("ArrowUp") || keys.has("KeyW")) pitch += 1;   // nose down/forward dive
    if (keys.has("ArrowDown") || keys.has("KeyS")) pitch -= 1;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) yaw -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) yaw += 1;
    if (keys.has("ShiftLeft") || keys.has("Space")) throttle += 1;
    if (keys.has("ControlLeft")) throttle -= 1;
    return { pitch, yaw, throttle };
  }

  function frame(now) {
    ensureSize();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - startTime) / 1000;
    const aspect = canvas.width / canvas.height;

    // pick a view
    let vp, eye, target, curSpeed = 0;
    if (mode === "glide" && scene) {
      const lookY = scene.mesh.minH + (scene.mesh.maxH - scene.mesh.minH) * 0.35;
      if (freeMode && freeState) {
        stepFreeFlight(freeState, readInputs(dt), dt);
        // terrain collision: sample the actual surface under the glider and repel
        // upward when too close, so you skim over peaks instead of through them.
        const groundY = sampleHeight(scene.grid, scene.heightScale, freeState.pos[0], freeState.pos[2]);
        const minY = groundY + scene.heightScale * 0.05 + 6;
        if (Number.isFinite(minY) && freeState.pos[1] < minY) {
          freeState.pos[1] = minY;                           // don't penetrate
          freeState.pitch = Math.max(freeState.pitch, 0.18); // bounce: nose up
          freeState.speed *= 0.97;                           // shed a little speed
        }
        // soft boundary: keep the glider near the terrain so it can't drift away
        // forever. Past the soft radius the heading is steered back inward; a hard
        // clamp caps horizontal range and a ceiling caps altitude.
        const hr = Math.hypot(freeState.pos[0], freeState.pos[2]) || 1;
        const softR = scene.span * 0.6, maxR = scene.span * 0.95;
        if (hr > softR) {
          const inward = Math.atan2(-freeState.pos[2], -freeState.pos[0]);
          let dy = inward - freeState.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          freeState.yaw += dy * Math.min(1, (hr - softR) / (maxR - softR)) * 2.2 * dt;
        }
        if (hr > maxR) { const k = maxR / hr; freeState.pos[0] *= k; freeState.pos[2] *= k; }
        const ceiling = scene.mesh.maxH + scene.span * 0.7;
        if (freeState.pos[1] > ceiling) { freeState.pos[1] = ceiling; freeState.pitch = Math.min(freeState.pitch, -0.04); }
        const r = freeViewProj(freeState, aspect);
        vp = r.vp; eye = r.eye; target = r.target; curSpeed = freeState.speed;
      } else {
        railU = (railU + dt * 0.018) % 1;     // slow, sweeping cruise
        const r = railViewProj(scene.path, railU, aspect, lookY);
        vp = r.vp; eye = r.eye; target = r.target; curSpeed = scene.span * 0.018;
      }
    } else {
      // menu idle: gentle orbit over a neutral center so the canvas isn't black
      const r = orbitViewProj(t, { aspect, radius: 600, height: 320, center: [0, 80, 0], speed: 0.05 });
      vp = r; eye = [Math.cos(t * 0.05) * 600, 320, Math.sin(t * 0.05) * 600]; target = [0, 80, 0];
    }

    // speed feel 0..1 (free mode reaches higher)
    const tgt = mode === "glide"
      ? (freeMode ? Math.min(1, (curSpeed - 30) / 290) * 0.6 : 0.0)
      : 0.0;
    speed01 += (tgt - speed01) * Math.min(1, dt * 3);

    const inv = invert(vp);
    const sun = sunDirFromTOD(tod);
    const tint = sunTint(tod);
    const fog = scene ? scene.fogFar : 3000;
    const cloudY = scene ? scene.mesh.minH + (scene.mesh.maxH - scene.mesh.minH) * 0.18 : 30;

    // sky UBO
    fSky.set(inv, 0);
    fSky[16] = eye[0]; fSky[17] = eye[1]; fSky[18] = eye[2];
    fSky[20] = sun[0]; fSky[21] = sun[1]; fSky[22] = sun[2]; fSky[23] = tod;
    fSky[24] = aspect; fSky[25] = scene ? scene.waterY : 0; fSky[26] = 0.5; fSky[27] = fog;
    device.queue.writeBuffer(skyUBO, 0, fSky);

    // clouds UBO (params: aspect, cloudLevelY, time, far)
    fClouds.set(inv, 0);
    fClouds[16] = eye[0]; fClouds[17] = eye[1]; fClouds[18] = eye[2];
    fClouds[20] = sun[0]; fClouds[21] = sun[1]; fClouds[22] = sun[2]; fClouds[23] = tod;
    fClouds[24] = aspect; fClouds[25] = cloudY; fClouds[26] = t; fClouds[27] = fog;
    device.queue.writeBuffer(cloudsUBO, 0, fClouds);

    // terrain UBO
    if (scene) {
      fTerrain.set(vp, 0);
      fTerrain[16] = sun[0]; fTerrain[17] = sun[1]; fTerrain[18] = sun[2]; fTerrain[19] = tod;
      fTerrain[20] = eye[0]; fTerrain[21] = eye[1]; fTerrain[22] = eye[2];
      fTerrain[24] = scene.mesh.minH; fTerrain[25] = scene.mesh.maxH; fTerrain[26] = scene.snowStart; fTerrain[27] = fog;
      fTerrain[28] = tint[0]; fTerrain[29] = tint[1]; fTerrain[30] = tint[2];
      device.queue.writeBuffer(terrainUBO, 0, fTerrain);

      // water UBO
      fWater.set(vp, 0);
      fWater[16] = eye[0]; fWater[17] = eye[1]; fWater[18] = eye[2];
      fWater[20] = sun[0]; fWater[21] = sun[1]; fWater[22] = sun[2]; fWater[23] = tod;
      fWater[24] = t; fWater[25] = scene.waterY; fWater[26] = fog; fWater[27] = 0;
      fWater[28] = scene.waterTint[0]; fWater[29] = scene.waterTint[1]; fWater[30] = scene.waterTint[2];
      device.queue.writeBuffer(waterUBO, 0, fWater);
    }

    // post UBO
    fPost[0] = speed01; fPost[1] = t; fPost[2] = aspect; fPost[3] = freeMode ? 1 : 0;
    device.queue.writeBuffer(postUBO, 0, fPost);

    const encoder = device.createCommandEncoder();
    // PASS 1: scene -> offscreen (sky, terrain, water, clouds)
    const sceneView = sceneTex.createView();
    const scenePass = encoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, clearValue: { r: 0.05, g: 0.07, b: 0.12, a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    // sky (no depth write)
    scenePass.setPipeline(skyP);
    scenePass.setBindGroup(0, skyBG);
    scenePass.draw(3);
    if (scene) {
      scenePass.setPipeline(terrainPipeline);
      scenePass.setBindGroup(0, terrainBG);
      scenePass.setVertexBuffer(0, scene.vbuf);
      scenePass.setIndexBuffer(scene.ibuf, "uint32");
      scenePass.drawIndexed(scene.indexCount);
      // water
      scenePass.setPipeline(waterP);
      scenePass.setBindGroup(0, waterBG);
      scenePass.setVertexBuffer(0, scene.wvb);
      scenePass.setIndexBuffer(scene.wib, "uint16");
      scenePass.drawIndexed(6);
    }
    // clouds (alpha over)
    scenePass.setPipeline(cloudsP);
    scenePass.setBindGroup(0, cloudsBG);
    scenePass.draw(3);
    scenePass.end();

    // PASS 2: postfx -> swapchain
    const postPass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    postPass.setPipeline(postPipeline);
    postPass.setBindGroup(0, postBG);
    postPass.draw(3);
    postPass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  // time-of-day slider wiring
  const todSlider = document.getElementById("tod");
  if (todSlider) {
    todSlider.value = String(Math.round(tod * 100));
    todSlider.addEventListener("input", () => { tod = Number(todSlider.value) / 100; });
  }

  // initial route
  const hashId = readHash();
  if (hashId && destById(hashId)) { menu.hide(); enterGlide(hashId); }
  else { menu.show(); }

  requestAnimationFrame(frame);
}

start().catch((e) => showFallback("aloft: unexpected error: " + (e?.message ?? e)));
