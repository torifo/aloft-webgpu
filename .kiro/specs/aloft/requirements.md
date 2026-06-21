# aloft Requirements

## Overview
aloft is a pure-web WebGPU terrain visualizer. It loads a bundled Digital Elevation
Model (DEM) heightmap, builds a 3D heightfield mesh on the GPU, renders it with
directional lighting and elevation-based coloring, and lets the user glide/orbit a
camera over the terrain. It runs entirely locally in a WebGPU-capable browser with no
backend and no runtime network access (every asset, including a small sample DEM, is
vendored locally).

## User Stories

### US-001: View terrain in 3D
**As a** curious web user **I want to** see real-elevation data rendered as 3D terrain
**So that** I can perceive the shape of a landscape on the GPU.

**Acceptance Criteria:**
- WHEN the page loads in a WebGPU-capable browser THE SYSTEM SHALL initialize a WebGPU
  device, configure the canvas context, and render a 3D terrain frame within 3 seconds.
- WHEN the bundled DEM heightmap finishes loading THE SYSTEM SHALL generate a vertex
  grid whose per-vertex height is derived from the DEM sample values.
- IF the DEM asset fails to load (404 or decode error) THEN THE SYSTEM SHALL display a
  visible on-page error message describing the failure and SHALL NOT throw an
  unhandled exception.

### US-002: Graceful fallback without WebGPU
**As a** user on a browser lacking WebGPU **I want to** see a clear message instead of a
blank page or a crash **So that** I know what is wrong and how to fix it.

**Acceptance Criteria:**
- IF `navigator.gpu` is undefined THEN THE SYSTEM SHALL display a human-readable fallback
  message naming WebGPU as the requirement and SHALL NOT attempt GPU initialization.
- IF `requestAdapter()` returns null THEN THE SYSTEM SHALL display a fallback message and
  SHALL NOT attempt to create a device.

### US-003: Lit, colored terrain
**As a** user **I want to** see shading and elevation color **So that** terrain relief is
legible.

**Acceptance Criteria:**
- THE SYSTEM SHALL light the terrain with a single directional light using per-fragment
  surface normals (hillshade).
- THE SYSTEM SHALL color each fragment by its elevation using a low-to-high color ramp.

### US-004: Gliding camera
**As a** user **I want to** the camera to glide/orbit over the terrain
**So that** I see it from changing viewpoints without manual input.

**Acceptance Criteria:**
- WHILE the page is active THE SYSTEM SHALL orbit the camera around the terrain center at
  a constant angular rate, looking toward the terrain center.
- WHEN the user presses a documented key (Space) THE SYSTEM SHALL toggle the automatic
  orbit on/off.

## Functional Requirements

### FR-001: WebGPU initialization
**Priority:** P0 | **Persona:** all users
WHEN the module loads THE SYSTEM SHALL request an adapter and device, configure the
canvas with the preferred format, and store handles for the render loop.
**Rationale:** Nothing renders without a device.

### FR-002: DEM load + decode
**Priority:** P0 | **Persona:** all users
WHEN initialization runs THE SYSTEM SHALL fetch the bundled grayscale PNG heightmap from a
relative path, decode it via `createImageBitmap`, and read its pixel luminance into a
Float32 height grid.
**Rationale:** The DEM is the data source for mesh height.

### FR-003: Heightfield mesh generation
**Priority:** P0 | **Persona:** all users
WHEN the height grid is available THE SYSTEM SHALL generate an (W x H) vertex grid with
positions (x, height, z), per-vertex normals computed from neighboring heights, and a
triangle index buffer of `(W-1)*(H-1)*6` indices.
**Rationale:** GPU needs explicit vertex/index buffers.

### FR-004: Render pipeline
**Priority:** P0 | **Persona:** all users
WHEN buffers are uploaded THE SYSTEM SHALL create a render pipeline bound to one uniform
buffer (view-projection matrix, light direction, elevation range) and draw the indexed
mesh with depth testing each frame.
**Rationale:** Core rendering.

### FR-005: Orbit camera
**Priority:** P1 | **Persona:** all users
WHILE orbit is enabled THE SYSTEM SHALL advance the camera azimuth by elapsed time and
recompute the view-projection matrix every frame.
**Rationale:** US-004.

### FR-006: Fallback path
**Priority:** P0 | **Persona:** non-WebGPU users
IF WebGPU is unavailable THEN THE SYSTEM SHALL render a DOM fallback and skip the GPU code
path.
**Rationale:** US-002.

## Non-Functional Requirements
- Performance: Maintain >= 30 FPS for a 256x256 DEM grid on integrated GPUs.
- Offline: Zero runtime network requests to non-local origins; all assets relative-path local.
- Portability: No build step required; native ES modules served over `http.server`.
- Asset size: Bundled sample DEM <= 100 KB.
- Robustness: No unhandled promise rejections on the load/error paths.
