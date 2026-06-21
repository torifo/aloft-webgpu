// clouds.js — fullscreen cloud-sea pipeline (alpha-blended over scene).

export async function createCloudsPass(device, format, fetchText) {
  const code = await fetchText("./src/shaders/clouds.wgsl");
  const module = device.createShaderModule({ code });
  const bgl = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: "vs_main" },
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
    primitive: { topology: "triangle-list" },
  });
  return { pipeline, bgl, module };
}
