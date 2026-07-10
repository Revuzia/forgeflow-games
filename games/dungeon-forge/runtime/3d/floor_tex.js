/**
 * Dungeon Forge — runtime/3d/floor_tex.js
 * Seamless, tileable PROCEDURAL floor textures for the Floor tool.
 *
 * Each texture is evaluated per-pixel into a 256×256 canvas with math that wraps
 * perfectly at the edges (value-noise on a wrapping grid, toroidal Voronoi,
 * integer-period ripples/veins), so a floor of many cells tiles with no visible
 * seams. Generated once, then cached as BOTH a THREE.CanvasTexture (for cell
 * rendering) and a data-URL swatch (for the HUD picker). No external image
 * assets and no generation credits — a drop-in library the builder paints with.
 *
 * The canonical id list lives in the sim (dungeon.js FLOOR_TEX_IDS) so the sim
 * stays authoritative and node-testable; this module supplies the pixels + UI
 * labels for those ids. "stone" is the default (the kit's own tile → no canvas).
 */
import * as THREE from "three";

const SZ = 256;
const _canvas = new Map();   // id → HTMLCanvasElement
const _tex = new Map();      // id → THREE.CanvasTexture
const _swatch = new Map();   // id → data URL

// Picker metadata (id + human label). Order = picker order; "stone" first.
export const FLOOR_TEX_DEFS = [
  { id: "stone",     label: "Stone" },       // default → kit tile (no override)
  { id: "cobble",    label: "Cobble" },
  { id: "brick",     label: "Brick" },
  { id: "flagstone", label: "Flagstone" },
  { id: "dirt",      label: "Dirt" },
  { id: "cave",      label: "Cave Rock" },
  { id: "wood",      label: "Wood" },
  { id: "sand",      label: "Sand" },
  { id: "marble",    label: "Marble" },
  { id: "moss",      label: "Mossy" },
];
export const FLOOR_TEX_LABEL = Object.fromEntries(FLOOR_TEX_DEFS.map((d) => [d.id, d.label]));

// ── seamless noise primitives (all wrap over their integer period) ────────────
function hash2(ix, iy, P) {
  let h = (((ix % P) + P) % P) * 374761393 + (((iy % P) + P) % P) * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, P) {              // tileable value noise, period P over [0,1)
  const fx = x * P, fy = y * P;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = smooth(fx - ix), ty = smooth(fy - iy);
  const a = hash2(ix, iy, P), b = hash2(ix + 1, iy, P), c = hash2(ix, iy + 1, P), e = hash2(ix + 1, iy + 1, P);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}
function fbm(x, y, P, oct) {            // fractal sum — each octave grid wraps
  let s = 0, amp = 0.5, p = P, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x, y, p); norm += amp; p *= 2; amp *= 0.5; }
  return s / norm;
}
function voronoi(x, y, P) {             // toroidal Voronoi (F1,F2 + per-cell hashes)
  const gx = x * P, gy = y * P;
  const bx = Math.floor(gx), by = Math.floor(gy);
  let f1 = 9, f2 = 9, cix = 0, ciy = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ci = bx + di, cj = by + dj;
    const fpx = ci + hash2(ci, cj, P), fpy = cj + hash2(ci + 7, cj + 3, P);
    const dx = fpx - gx, dy = fpy - gy, dd = dx * dx + dy * dy;
    if (dd < f1) { f2 = f1; f1 = dd; cix = ci; ciy = cj; } else if (dd < f2) { f2 = dd; }
  }
  return { f1: Math.sqrt(f1), f2: Math.sqrt(f2), cid: hash2(cix, ciy, P), cid2: hash2(cix + 11, ciy + 5, P) };
}
const sstep = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
const sh = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

// ── per-texel evaluators: (u,v) in [0,1) → [r,g,b] 0-255 ──────────────────────
const EVAL = {
  cobble(u, v) {
    const { f1, f2, cid } = voronoi(u, v, 7);
    const edge = sstep(0.015, 0.12, f2 - f1);            // 0 at mortar, 1 in stone
    const base = mix([84, 82, 90], [138, 134, 124], cid);
    const dome = 0.66 + 0.5 * edge * (1 - f1 * 0.7);     // rounded bevel highlight
    const n = 0.8 + 0.4 * fbm(u, v, 20, 3);
    return mix([38, 36, 42], sh(base, dome * n), edge);
  },
  brick(u, v) {
    const rows = 6, cols = 4, rh = 1 / rows, bw = 1 / cols, mw = 0.03;
    const row = Math.floor(v * rows);                   // course index (wraps: rows even)
    const off = (row % 2) * 0.5;                         // running bond: half-offset alt rows
    const bu = (u + off) % 1;
    const cx = Math.floor(bu / bw), inU = (bu % bw) / bw, inV = (v % rh) / rh;
    const mortar = Math.min(sstep(0, mw / bw, inU), sstep(0, mw / bw, 1 - inU), sstep(0, mw / rh, inV), sstep(0, mw / rh, 1 - inV));
    const tint = hash2(cx, row, 97);
    const brick = mix([150, 74, 52], [116, 52, 40], tint);
    const grain = 0.82 + 0.32 * fbm(u * 2, v * 2, 24, 3);
    return mix([58, 54, 52], sh(brick, grain), mortar);
  },
  flagstone(u, v) {
    const { f1, f2, cid } = voronoi(u, v, 4);
    const edge = sstep(0.02, 0.16, f2 - f1);
    const base = mix([92, 94, 100], [132, 132, 136], cid);
    const wear = 0.8 + 0.4 * fbm(u, v, 14, 3);
    return mix([46, 46, 52], sh(base, (0.7 + 0.4 * edge) * wear), edge);
  },
  dirt(u, v) {
    const n = fbm(u, v, 7, 4);
    let col = mix([70, 54, 37], [108, 86, 58], n);
    const clump = sstep(0.55, 0.8, fbm(u + 3.1, v + 1.7, 5, 3));
    col = mix(col, [58, 44, 30], clump * 0.5);
    const peb = voronoi(u, v, 22).f1;
    if (peb < 0.14) col = mix(col, [126, 120, 110], (1 - peb / 0.14) * 0.6);
    const sp = fbm(u * 3, v * 3, 48, 2);
    return sh(col, 0.88 + 0.24 * sp);
  },
  cave(u, v) {
    const n = fbm(u, v, 5, 5);
    let col = mix([66, 68, 74], [116, 118, 126], n);
    const crack = 1 - sstep(0.0, 0.05, Math.abs(fbm(u + 5, v + 9, 4, 4) - 0.5));
    col = mix(col, [26, 26, 30], crack * 0.8);
    const fleck = voronoi(u, v, 30).f1;
    if (fleck < 0.08) col = mix(col, [150, 156, 168], 0.5);   // mineral glints
    return col;
  },
  wood(u, v) {
    const planks = 5, pw = 1 / planks;
    const p = Math.floor(u / pw), inU = (u % pw) / pw;
    const seam = sstep(0, 0.05, inU) * sstep(0, 0.05, 1 - inU);   // dark plank seams
    const base = mix([124, 80, 43], [156, 110, 64], hash2(p % planks, 3, 71)); // per-plank hue (wraps)
    const grain = 0.6 + 0.5 * fbm(u * 6, v, 8, 3);               // 6:1 lengthwise grain
    const bseg = (v * 3) % 1;                                    // 3 plank ends (wraps)
    const brk = sstep(0, 0.04, bseg) * sstep(0, 0.04, 1 - bseg);
    return sh(base, grain * (0.45 + 0.6 * seam) * (0.6 + 0.45 * brk));
  },
  sand(u, v) {
    const ripple = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 9 + fbm(u, v, 6, 2) * 6.5);
    const n = fbm(u * 2, v * 2, 26, 3);
    const base = mix([196, 176, 132], [216, 198, 154], n);
    return sh(base, 0.9 + 0.15 * ripple);
  },
  marble(u, v) {
    const turb = fbm(u, v, 4, 4) - 0.5;
    const vein = Math.abs(Math.sin(Math.PI * 2 * 3 * u + 7 * turb));
    const vein2 = Math.abs(Math.sin(Math.PI * 2 * 2 * v + 6 * (fbm(u + 8, v + 2, 5, 3) - 0.5)));
    const base = mix([224, 222, 216], [200, 200, 206], fbm(u, v, 9, 3));
    const m = Math.max(1 - sstep(0, 0.09, vein), (1 - sstep(0, 0.12, vein2)) * 0.7);
    return mix(base, [118, 120, 132], m * 0.7);
  },
  moss(u, v) {
    const { f1, f2, cid } = voronoi(u, v, 6);
    const edge = sstep(0.02, 0.16, f2 - f1);
    const stone = sh(mix([72, 68, 62], [108, 104, 94], cid), 0.62 + 0.45 * edge);
    const patch = sstep(0.5, 0.78, fbm(u + 2, v + 6, 3, 4));
    const amt = Math.max(patch, (1 - edge) * 0.85);
    const moss = mix([48, 78, 36], [66, 100, 46], fbm(u * 2, v * 2, 18, 2));
    return mix(stone, moss, amt * 0.78);
  },
};

function buildCanvas(id) {
  const evalFn = EVAL[id];
  const cv = document.createElement("canvas");
  cv.width = cv.height = SZ;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(SZ, SZ);
  const data = img.data;
  for (let y = 0; y < SZ; y++) {
    const v = y / SZ;
    for (let x = 0; x < SZ; x++) {
      const rgb = evalFn(x / SZ, v);
      const o = (y * SZ + x) * 4;
      data[o] = Math.max(0, Math.min(255, rgb[0] | 0));
      data[o + 1] = Math.max(0, Math.min(255, rgb[1] | 0));
      data[o + 2] = Math.max(0, Math.min(255, rgb[2] | 0));
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
function canvasFor(id) {
  if (!_canvas.has(id)) _canvas.set(id, buildCanvas(id));
  return _canvas.get(id);
}

/** THREE.CanvasTexture for a floor-texture id (null for "stone"/unknown → kit tile). */
export function floorTexture(id) {
  if (!id || id === "stone" || !EVAL[id]) return null;
  if (_tex.has(id)) return _tex.get(id);
  const t = new THREE.CanvasTexture(canvasFor(id));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  _tex.set(id, t);
  return t;
}

/** Small data-URL swatch of a floor texture for the HUD picker (cached). */
export function floorTexSwatch(id) {
  if (!id || !EVAL[id]) return null;
  if (_swatch.has(id)) return _swatch.get(id);
  const url = canvasFor(id).toDataURL("image/png");
  _swatch.set(id, url);
  return url;
}
