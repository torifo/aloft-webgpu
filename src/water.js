// water.js — reflective water-plane pipeline + geometry. A large quad at y=level.

export const WATER_UBO_SIZE = 64 + 16 + 16 + 16 + 16; // mat4 + camPos + sunDir + params + tint = 128

/** Build a flat quad (two triangles) of half-extent `ext` at y=`level`. */
export function buildWaterQuad(level, ext) {
  const v = new Float32Array([
    -ext, level, -ext,
     ext, level, -ext,
     ext, level,  ext,
    -ext, level,  ext,
  ]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
  return { vertices: v, indices: idx };
}

export async function createWaterPass(device, format, fetchText) {
  const code = await fetchText("./src/shaders/water.wgsl");
  const module = device.createShaderModule({ code });
  const bgl = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: {
      module, entryPoint: "vs_main",
      buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
    },
    fragment: {
      module, entryPoint: "fs_main",
      targets: [{
        format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
  });
  return { pipeline, bgl, module };
}
