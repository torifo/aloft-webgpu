// gpu.js — WebGPU device/context initialization.

export class WebGPUUnavailable extends Error {}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{device:GPUDevice, context:GPUCanvasContext, format:GPUTextureFormat}>}
 */
export async function initWebGPU(canvas) {
  if (!navigator.gpu) {
    throw new WebGPUUnavailable("navigator.gpu is undefined (WebGPU not supported).");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new WebGPUUnavailable("requestAdapter() returned null (no compatible GPU adapter).");
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new WebGPUUnavailable("canvas.getContext('webgpu') returned null.");
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}
