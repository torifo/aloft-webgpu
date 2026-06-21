# aloft Design

## Overview
A single-page, no-build WebGPU app. `index.html` loads ES modules. The DEM (a small
grayscale PNG, synthetic fractal terrain generated at author time) is decoded to a
Float32 height grid, turned into a heightfield mesh, and rendered each frame with a WGSL
pipeline doing directional hillshade + elevation color. A camera module orbits over the
terrain. If WebGPU is missing, a fallback DOM message is shown and the GPU path is skipped.

## Architecture

### Components
- **`index.html`**: Canvas, fallback `<div>`, HUD text, single `<script type=module>`.
- **`src/main.js`**: Orchestrator. WebGPU support check → init → load DEM → build mesh →
  create pipeline/buffers → start render loop. Owns error/fallback display.
- **`src/gpu.js`**: `initWebGPU(canvas)` — adapter/device/context/format; returns handles
  or throws a typed error consumed by main for fallback.
- **`src/dem.js`**: `loadHeightmap(url)` — fetch PNG → `createImageBitmap` → draw to
  `OffscreenCanvas` → `getImageData` → Float32Array luminance grid `{ width, height, data }`.
- **`src/mesh.js`**: `buildTerrainMesh(grid, opts)` — pure function producing
  `{ positions:Float32Array, normals:Float32Array, indices:Uint32Array, vertexCount,
  indexCount, minH, maxH }`. No GPU/DOM deps (Node-testable).
- **`src/camera.js`**: `mat4` helpers + `orbitViewProj(t, params)` returning a column-major
  4x4 view-projection matrix (Float32Array length 16).
- **`src/shaders/terrain.wgsl`**: vertex + fragment shaders.

### Data Flow
```mermaid
sequenceDiagram
  main->>gpu: initWebGPU(canvas)
  gpu-->>main: {device, context, format} | throw
  main->>dem: loadHeightmap("./assets/heightmap.png")
  dem-->>main: {width,height,data:Float32Array}
  main->>mesh: buildTerrainMesh(grid)
  mesh-->>main: {positions,normals,indices,minH,maxH}
  main->>gpu: create buffers + pipeline (terrain.wgsl)
  loop each frame
    main->>camera: orbitViewProj(t)
    camera-->>main: viewProj mat4
    main->>gpu: writeBuffer(uniform); draw indexed
  end
```

## Data Models

```typescript
interface HeightGrid {
  width: number;        // columns
  height: number;       // rows
  data: Float32Array;   // length width*height, luminance 0..1
}

interface TerrainMesh {
  positions: Float32Array; // 3 floats/vertex (x, y=height, z)
  normals:   Float32Array; // 3 floats/vertex
  indices:   Uint32Array;  // (width-1)*(height-1)*6
  vertexCount: number;
  indexCount: number;
  minH: number;            // min world height (for color ramp)
  maxH: number;
}
```

### Vertex layout (interleaved)
`[px, py, pz, nx, ny, nz]` → stride 24 bytes; attr0 position @offset 0, attr1 normal @offset 12.

### Uniform buffer (std140-compatible, 96 bytes)
```
offset  0  : mat4x4<f32> viewProj   (64 B)
offset 64  : vec3<f32>   lightDir    (12 B) + pad (4)
offset 80  : f32 minH; f32 maxH; (+8 pad)  (16 B)
```

## DEM data model (how the heightmap is stored/loaded)
- **Stored as**: a grayscale PNG `assets/heightmap.png`, 256x256, 8-bit. Brightness =
  elevation (black=low, white=high).
- **Sample is SYNTHETIC**: generated with value-noise fractal Brownian motion (multi-octave)
  by `tools/gen_heightmap.mjs` (Node, zero deps; writes PNG via a tiny self-contained
  encoder). Documented as synthetic, not real-world.
- **Loaded as**: PNG → `createImageBitmap` → 2D canvas `getImageData` → red channel / 255
  → Float32 luminance grid.
- **Swapping in real DEM**: replace `assets/heightmap.png` with any 8-bit grayscale PNG
  exported from real DEM (e.g. GeoTIFF → `gdal_translate -of PNG -ot Byte -scale`). Same
  dimensions need no code change; different dimensions auto-handled (grid reads PNG size).

## Bind group layout (must match WGSL)
- `@group(0) @binding(0)`: uniform buffer (visibility VERTEX | FRAGMENT).

## Error Handling
- No `navigator.gpu` → fallback DOM, no throw.
- `requestAdapter()` null → fallback DOM.
- DEM fetch/decode failure → on-page error banner; caught, no unhandled rejection.
- WGSL compile error → surfaced via `device.pushErrorScope`/`getCompilationInfo` logged
  to console + banner.

## Security Considerations
- No remote origins; all `fetch` use relative paths under the served root.
- No user input executed; no eval.

## Testing Strategy
- **Unit (Node)**: `tools/test_mesh.mjs` checks `buildTerrainMesh` math — vertex count =
  W*H, index count = (W-1)*(H-1)*6, indices in range, flat grid → up-normals, minH/maxH.
- **Static**: `node --check` every `.js`/`.mjs`; `naga` validates `terrain.wgsl`.
- **Layout audit**: confirm WGSL `@group/@binding` and struct sizes match `gpu.js`
  bindGroupLayout + uniform writes (manual + documented in tasks).
- **Manual (GPU)**: serve locally, open in WebGPU browser, confirm lit colored terrain and
  orbiting camera. Headless GPU rendering is NOT reliably verifiable here — documented as
  a manual step.
