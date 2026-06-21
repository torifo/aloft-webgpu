# aloft Tasks

## Implementation Plan

### Wave 1 (parallel — no dependencies)
- [x] **Task 1.1**: Sample DEM generator + asset
  - What: `tools/gen_heightmap.mjs` (zero-dep fBm value noise → 256x256 grayscale PNG);
    run it to produce `assets/heightmap.png`. Document synthetic origin.
  - Files: `tools/gen_heightmap.mjs`, `assets/heightmap.png`
  - Done when: PNG exists, <=100 KB, decodes as 256x256 grayscale.
  - Depends on: none

- [x] **Task 1.2**: Mesh generation (pure)
  - What: `buildTerrainMesh(grid, opts)` — positions, normals, indices, minH/maxH.
  - Files: `src/mesh.js`
  - Done when: Node test asserts counts/ranges/normals.
  - Depends on: none

- [x] **Task 1.3**: Camera math
  - What: mat4 perspective/lookAt/multiply + `orbitViewProj`.
  - Files: `src/camera.js`
  - Done when: `node --check` passes; returns Float32Array(16).
  - Depends on: none

- [x] **Task 1.4**: WGSL shader
  - What: vertex transform + per-fragment hillshade + elevation color ramp.
  - Files: `src/shaders/terrain.wgsl`
  - Done when: `naga` validates the file.
  - Depends on: none

### Wave 2 (after Wave 1)
- [x] **Task 2.1**: WebGPU init + DEM loader
  - What: `initWebGPU`, `loadHeightmap`.
  - Files: `src/gpu.js`, `src/dem.js`
  - Done when: `node --check` passes; layout matches WGSL.
  - Depends on: 1.4

- [x] **Task 2.2**: Orchestrator + HTML + fallback
  - What: `main.js` wiring; `index.html` canvas/fallback/HUD; render loop; Space toggle.
  - Files: `index.html`, `src/main.js`
  - Done when: module graph resolves; fallback path present.
  - Depends on: 1.2, 1.3, 1.4

### Wave 3 (after Wave 2)
- [x] **Task 3.1**: Verification
  - What: `naga` validate WGSL; `node --check` all JS; run mesh test; serve + check no 404s.
  - Files: `tools/test_mesh.mjs`
  - Depends on: 2.1, 2.2
- [x] **Task 3.2**: Docs
  - What: `README.md` — run command, URL, synthetic-DEM note, swap-in instructions, manual GPU step.
  - Files: `README.md`
  - Depends on: 3.1

## Progress
- Total: 8 tasks | Completed: 8 | In Progress: 0
