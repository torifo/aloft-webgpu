// dem_common.mjs — pure, Node-testable DEM helpers shared by the build tools.
// Slippy-map tile math, terrarium elevation decode, and the 5 destination configs.

/** Terrarium elevation decode (meters). elev = (R*256 + G + B/256) - 32768. */
export function terrariumElev(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/** lon/lat (deg) -> fractional slippy tile coords at zoom z. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Web-mercator meters-per-pixel at a given latitude and zoom (256px tiles). */
export function metersPerPixel(lat, z) {
  const EARTH_CIRC = 40075016.686;
  return (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
}

/**
 * The 5 real-DEM destinations. `span` is the half-width in degrees used to
 * derive a square-ish bbox around the center for tile selection.
 */
export const DESTINATIONS = [
  {
    id: "fuji", name: "Mount Fuji", country: "Japan",
    lat: 35.36, lon: 138.73, z: 11, span: 0.16,
    tagline: "Lone snow-capped cone above the cloud sea.",
    waterPercentile: 0.04, accent: "#7fd1ff",
  },
  {
    id: "grandcanyon", name: "Grand Canyon", country: "USA",
    lat: 36.11, lon: -112.11, z: 11, span: 0.18,
    tagline: "Layered chasm carved by the Colorado River.",
    waterPercentile: 0.03, accent: "#ffb27f",
  },
  {
    id: "himalaya", name: "Everest / Himalaya", country: "Nepal",
    lat: 27.99, lon: 86.93, z: 11, span: 0.18,
    tagline: "The roof of the world — extreme vertical scale.",
    waterPercentile: 0.0, accent: "#dbe6ff",
  },
  {
    id: "guilin", name: "Guilin Karst", country: "China",
    lat: 25.27, lon: 110.29, z: 11, span: 0.16,
    tagline: "A forest of limestone towers along the Li River.",
    waterPercentile: 0.10, accent: "#9af0c8",
  },
  {
    id: "fjord", name: "Geirangerfjord", country: "Norway",
    lat: 62.10, lon: 7.21, z: 11, span: 0.14,
    tagline: "Sheer cliff walls plunging into a glassy fjord.",
    waterPercentile: 0.18, accent: "#7fe0ff",
  },
];

export function destById(id) {
  return DESTINATIONS.find((d) => d.id === id);
}

/**
 * Compute the integer tile range covering [lon-span, lon+span] x [lat-span, lat+span].
 * @returns {{z, x0, x1, y0, y1, nx, ny}}
 */
export function tileRange(dest) {
  const { lon, lat, span, z } = dest;
  const a = lonLatToTile(lon - span, lat + span, z); // NW
  const b = lonLatToTile(lon + span, lat - span, z); // SE
  const x0 = Math.floor(Math.min(a.x, b.x));
  const x1 = Math.floor(Math.max(a.x, b.x));
  const y0 = Math.floor(Math.min(a.y, b.y));
  const y1 = Math.floor(Math.max(a.y, b.y));
  return { z, x0, x1, y0, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
}

/** Nearest-neighbor downsample of a Float32 grid to target x target. */
export function downsample(src, sw, sh, target) {
  const out = new Float32Array(target * target);
  for (let y = 0; y < target; y++) {
    const sy = Math.min(sh - 1, Math.floor((y / target) * sh));
    for (let x = 0; x < target; x++) {
      const sx = Math.min(sw - 1, Math.floor((x / target) * sw));
      out[y * target + x] = src[sy * sw + sx];
    }
  }
  return out;
}

/** Value at a fractional percentile (0..1) over a copy-sorted array. */
export function percentile(values, p) {
  const arr = Array.from(values).sort((m, n) => m - n);
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))));
  return arr[idx];
}
