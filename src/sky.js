// sky.js — fullscreen sky pipeline (gradient + sun). Shares a 96-byte Scene UBO.

export const SCENE_UBO_SIZE = 96; // mat4(64) + vec4(16) camPos + ... see below

/**
 * Scene uniform layout (shared by sky + clouds), 6 vec4 rows = 96 bytes... we use
 * mat4(64) + camPos vec4(16) + sunDir vec4(16) + params vec4(16) = 112 bytes.
 */
export const SCENE_SIZE = 112;

export async function createSkyPass(device, format, fetchText) {
  const code = await fetchText("./src/shaders/sky.wgsl");
  const module = device.createShaderModule({ code });
  const bgl = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
    // no depth: sky writes nothing to depth so terrain draws over it
  });
  return { pipeline, bgl, module };
}
