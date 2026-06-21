// dem.js — load a grayscale-PNG heightmap into a Float32 luminance grid.

/**
 * @param {string} url   relative path to grayscale PNG
 * @returns {Promise<{width:number, height:number, data:Float32Array}>}
 */
export async function loadHeightmap(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`DEM fetch failed: ${resp.status} ${resp.statusText} (${url})`);
  }
  const blob = await resp.blob();
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error(`DEM decode failed (${url}): ${e.message}`);
  }
  const { width, height } = bitmap;

  // Draw to an OffscreenCanvas (fallback to a detached <canvas>) and read pixels.
  let ctx;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(width, height).getContext("2d");
  } else {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    ctx = c.getContext("2d");
  }
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height);
  bitmap.close?.();

  const data = new Float32Array(width * height);
  const px = img.data; // RGBA
  for (let i = 0; i < data.length; i++) {
    data[i] = px[i * 4] / 255; // red channel == luminance for grayscale PNG
  }
  return { width, height, data };
}

/** Load a destination's sidecar metadata JSON (elev range, water level, etc.). */
export async function loadMeta(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`meta fetch failed: ${resp.status} (${url})`);
  return resp.json();
}
