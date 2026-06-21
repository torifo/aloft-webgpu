// mesh.js — pure heightfield mesh generation from a DEM height grid.
// No GPU / DOM dependencies so it is unit-testable under Node.

/**
 * @typedef {Object} HeightGrid
 * @property {number} width
 * @property {number} height
 * @property {Float32Array} data   length width*height, values 0..1
 */

/**
 * Build an interleaved-attribute terrain mesh.
 * positions: (x, y=height, z) ; normals: per-vertex from neighbor heights.
 *
 * @param {HeightGrid} grid
 * @param {{ spacing?: number, heightScale?: number }} [opts]
 */
export function buildTerrainMesh(grid, opts = {}) {
  const { width: W, height: H, data } = grid;
  if (!(W >= 2 && H >= 2)) throw new Error("grid must be >= 2x2");
  if (data.length !== W * H) throw new Error("grid data length mismatch");

  const spacing = opts.spacing ?? 1.0;
  const heightScale = opts.heightScale ?? 40.0;

  const vertexCount = W * H;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  // Center the grid on origin in XZ.
  const halfW = ((W - 1) * spacing) / 2;
  const halfH = ((H - 1) * spacing) / 2;

  let minH = Infinity;
  let maxH = -Infinity;

  // positions
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const h = data[i] * heightScale;
      const o = i * 3;
      positions[o] = x * spacing - halfW;
      positions[o + 1] = h;
      positions[o + 2] = z * spacing - halfH;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  // normals from central differences of the height field (in world units)
  const sampleH = (x, z) => {
    const cx = x < 0 ? 0 : x >= W ? W - 1 : x;
    const cz = z < 0 ? 0 : z >= H ? H - 1 : z;
    return data[cz * W + cx] * heightScale;
  };
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const hl = sampleH(x - 1, z);
      const hr = sampleH(x + 1, z);
      const hd = sampleH(x, z - 1);
      const hu = sampleH(x, z + 1);
      // gradient -> normal. dx/dz span 2*spacing across the central difference.
      let nx = (hl - hr);
      let ny = 2 * spacing;
      let nz = (hd - hu);
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = (z * W + x) * 3;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;
    }
  }

  // indices: two triangles per cell, CCW
  const indexCount = (W - 1) * (H - 1) * 6;
  const indices = new Uint32Array(indexCount);
  let k = 0;
  for (let z = 0; z < H - 1; z++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = z * W + x;
      const tr = tl + 1;
      const bl = tl + W;
      const br = bl + 1;
      indices[k++] = tl; indices[k++] = bl; indices[k++] = tr;
      indices[k++] = tr; indices[k++] = bl; indices[k++] = br;
    }
  }

  return { positions, normals, indices, vertexCount, indexCount, minH, maxH };
}
