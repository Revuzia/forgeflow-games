/**
 * CRESTBOUND — runtime/world/materials.js
 * CONTRACT §14.
 *
 * The PBR material library. Every material is built from procedurally generated
 * textures (albedo + packed ORM + tangent-space normal + optional emissive /
 * alpha / clearcoat-normal). There is not a single `new MeshStandardMaterial
 * ({color})` in this file — every key ships real roughness and normal maps.
 *
 * Ported by transliteration from ASCENDANT's materials.js (the same studio's
 * first-person obby: 18 keys, world-space box projection, deterministic
 * tileable bakes, theme tinting, hook-preserving clone) and EXTENDED for a
 * third-person open-diorama platformer with sixteen new keys:
 *
 *   grass    heightfield meadow: blade-streak albedo, clump variation, SLOPE
 *            BLEND to dirt driven by the interpolated world normal (full dirt
 *            exactly at TUNE.slope.slideDeg so "brown = you will slide"), and
 *            a view-dependent subsurface-ish rim added to the indirect diffuse
 *   dirt     clods + pebbles + dry cracks; also the slope target of grass /
 *            snow / sand
 *   plaster  Keep walls: warm off-white, trowel strokes, crack network, colour
 *            variation, flaked chips exposing the under-render
 *   brick    running bond, per-brick colour, chipped corners, recessed mortar
 *   bark     vertical fissures + lichen; ATTRIBUTE UVs, V runs along the trunk
 *   leaves   alpha-tested canopy CARD (clustered leaves with veins), double
 *            sided, wind sway in the vertex shader (uv.y = card height)
 *   snow     soft drifts, blue shadow lows, high-frequency SPARKLE glints via a
 *            facet normal on the clearcoat layer; slope-blends to dirt
 *   water    a ShaderMaterial (3-wave Gerstner displacement, analytic normal +
 *            ripple detail normal, fresnel sky reflection, sun glint, depth-fade
 *            foam edge from a scene depth texture OR a baked `aShore`
 *            attribute, crest whitecaps, fog) — uniforms exposed for water.js
 *   gold     crest / coin metal: hammered facets, brushed micro-scratches,
 *            metalness 1, roughness ~0.25, clearcoat + anisotropy so the env
 *            highlight stretches warm; ATTRIBUTE UVs (coins spin — a world
 *            projection would swim across them)
 *   cloth    hero coat: warp/weft weave, fibre fuzz, sheen; ATTRIBUTE UVs
 *   painting frame-less canvas with a shimmer sweep (uShimmer 0..1 phase +
 *            uShimmerColor) — per-material uniforms, so every Keep painting can
 *            sweep on its own beat; builders swap `map` for the course thumbnail
 *   marble   polished, sinuous grey + gold veins, clearcoat
 *   moss     velvet clumps with a sheen layer
 *   copper   brushed metal with verdigris patina patches
 *   rope     three-strand twist; ATTRIBUTE UVs, V along the rope (0.25 m tile)
 *
 * ---------------------------------------------------------------------------
 * UV POLICY — READ THIS IF YOU WRITE GEOMETRY
 * ---------------------------------------------------------------------------
 * Most keys are WORLD-SPACE BOX PROJECTED in the vertex shader (see
 * `injectShader`). Their texture coordinates are derived from world position +
 * world normal, so:
 *    - geometry does NOT need correct UVs (a raw BoxGeometry is fine),
 *    - texture scale is physically correct no matter how big the platform is,
 *    - detail flows CONTINUOUSLY across adjacent platforms — a big part of why
 *      the world reads as built, not as a pile of cubes.
 *
 * The ATTRIBUTE-UV keys need direction relative to the object, so they use the
 * geometry's own UVs, authored in WORLD METRES (1 uv unit = 1 m; each texture's
 * `repeat` is preset to tiles-per-metre so metres just work):
 *    conveyor  V runs ALONG the belt's travel (treads = bands of constant V)
 *    hazard    U runs ALONG the hazard's long axis (chevrons point toward +U)
 *    bark      V runs ALONG the trunk, U around it
 *    rope      V runs ALONG the rope, U around it
 *    gold      any UVs (small spinning objects; box projection would swim)
 *    cloth     the hero's own part UVs
 *    leaves    a 0..1 card: uv.y = 0 at the branch, 1 at the tip (wind pivots)
 *    painting  a 0..1 canvas (map is replaced per painting by the builder)
 *    water     PlaneGeometry UVs (0..1) + optional `aShore` float attribute
 *
 * If the shader injection ever fails (a three.js chunk rename), every material
 * silently falls back to attribute UVs and each texture's `repeat` is preset to
 * the same metres-per-tile value, so the world still tiles sanely.
 *
 * ---------------------------------------------------------------------------
 * CACHING
 * ---------------------------------------------------------------------------
 * `get(key, themeId)` returns a SHARED material cached per (key, theme). Theme
 * variation is colour / roughness / emissive / physical-parameter application
 * on a clone that reuses the *same* textures — never a second texture bake,
 * never a per-object clone. Water is the one ShaderMaterial: its per-theme
 * clone shares the SAME uniform objects for time and wave shape, so one
 * `tick()` drives every lake in the game.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE
 * ---------------------------------------------------------------------------
 * Bakes run once in `init()` (boot phase "baking materials"). `tick(dt)` is
 * the only per-frame path and allocates nothing: it writes numbers into
 * hoisted uniforms and texture offsets and walks the themed cache with a
 * module-scope callback.
 */

import * as THREE from 'three';
import { THEMES } from './themes.js';
import { TUNE } from '../core/tuning.js';

/* ========================================================================== *
 * 0. constants / module state                                                *
 * ========================================================================== */

const SIZE_LG = 512;
const SIZE_MD = 256;
const SIZE_SM = 128;

/** every material key the contract promises (§14) */
const KEYS = [
  'stone', 'metal', 'panel', 'grate', 'ice', 'glass', 'emissive', 'lava',
  'obsidian', 'crystal', 'wood', 'sand', 'neon', 'checker', 'hazard',
  'rubber', 'conveyor', 'cloud',
  'grass', 'dirt', 'plaster', 'brick', 'bark', 'leaves', 'snow', 'water',
  'gold', 'cloth', 'painting', 'marble', 'moss', 'copper', 'rope',
];

/** materials whose UVs come from world-space box projection */
const BOX_KEYS = new Set([
  'stone', 'metal', 'panel', 'grate', 'ice', 'glass', 'emissive', 'lava',
  'obsidian', 'crystal', 'wood', 'sand', 'neon', 'checker', 'rubber', 'cloud',
  'grass', 'dirt', 'plaster', 'brick', 'snow', 'marble', 'moss', 'copper',
]);

/** the heightfield materials: blend toward dirt with slope (contract §14/§18) */
const SLOPE_KEYS = new Set(['grass', 'snow', 'sand']);

let _renderer = null;
let _ready = false;
let _aniso = 4;
let _clock = 0;
let _injectWarned = false;

const _tex = new Map();      // name -> THREE.Texture           (public via tex())
const _base = new Map();     // key  -> THREE.Material          (untinted template)
const _themed = new Map();   // 'key|themeId' -> THREE.Material (tinted clone)
const _uvScale = new Map();  // key  -> uv units per world metre
const _shaderU = new Map();  // key  -> shared uniform object   (public via uniforms())
const _owned = [];           // every texture we created, for dispose()

/** shared, animated uniforms (referenced by every clone of the key) */
const LAVA_U = {
  uCbTime: { value: 0 },
  uCbFlowA: { value: new THREE.Vector2() },
  uCbFlowB: { value: new THREE.Vector2() },
};

/** one clock for everything that breathes with time (leaves, caustics, water) */
const TIME_U = { value: 0 };

/* ---------------------------------------------------------------------------
 * MATERIAL LOD — the far half of the frame does not need the whole BRDF.
 *
 * The frame is GPU FILL-bound and PBR fragment shading is its largest single
 * component (CONTRACT hard rule 4; `_harness/frameprobe.py`). Most of what a
 * standard material spends per fragment is invisible past a few dozen metres:
 * the specular IBL lobe (`getIBLRadiance`, a `textureCubeUV` blend of two PMREM
 * mips), the macro de-tiler's value noise, the facing term, the leaf/blade rim,
 * the caustic field and the slope blend's three extra texture reads.
 *
 * `uCbLod = vec2( start metres, 1 / fade metres )`. Every gated term is
 * multiplied by `1 - t` INSIDE its branch, so the term reaches zero exactly
 * where the branch stops running and the switch cannot be seen — a hard cut
 * would print a ring on the meadow at the LOD radius.
 *
 * Deliberately NOT gated: `map`, `normalMap` and the ORM read. Those use
 * implicit derivatives, and a `texture2D` inside non-uniform control flow has
 * undefined mip selection on the quads that straddle the boundary. The IBL
 * path is safe because `textureCubeUV` selects its mip explicitly.
 * ------------------------------------------------------------------------ */
const LOD_START = 40;      // metres: full quality inside this
const LOD_FADE = 25;       // metres of fade; the gate is fully in at START + FADE
const LOD_U = { value: new THREE.Vector2(LOD_START, 1 / LOD_FADE) };

/**
 * Authored roughness at or above which a material takes the free IBL-specular
 * path (see `_harness/_iblrough.py` for the derivation from three's own
 * `getIBLRadiance` / `getIBLIrradiance`). 0.72 keeps every polished key -
 * marble, metal, copper, gold, glass, ice, crystal, obsidian, neon - on the
 * real lookup, and puts stone, plaster, brick, wood, bark, moss, cloth, rope,
 * dirt, grass, snow and sand, which are most of the screen, on the identity.
 * MEASURED (`_harness/_fillab.py`, keep/cp3/quality medium, 1382x777): the
 * environment map as a whole is -2.74 ms of a 22.56 ms frame.
 */
const IBL_ROUGH_CUT = 0.72;

/**
 * Slope-blend targets, in "1 - worldNormal.y" units. Full dirt lands exactly at
 * TUNE.slope.slideDeg so the colour is the affordance: brown ground slides.
 * (1 - cos(38°) = 0.212; the ramp starts ~12° earlier so it reads as a fade.)
 */
const SLOPE_END = 1 - Math.cos(TUNE.slope.slideDeg * Math.PI / 180);
const SLOPE_START = 1 - Math.cos((TUNE.slope.slideDeg - 12) * Math.PI / 180);

/* scratch — hoisted, never allocated in a loop or an update path */
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const W = { f1: 0, f2: 0, id: 0 };
const EMPTY_OPT = Object.freeze({});

/* ========================================================================== *
 * 1. procedural toolkit — deterministic, seeded, tileable                    *
 * ========================================================================== */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const numOrAniso = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const frac = (v) => v - Math.floor(v);

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** integer lattice hash -> 0..1, stable across platforms (Math.imul is exact) */
function hash2i(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Tileable value noise. `x`,`y` are in lattice units; the lattice wraps every
 * `period` cells, which is what makes every texture seamless.
 */
function vnoise(x, y, period, seed) {
  const p = period < 1 ? 1 : period | 0;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = hash2i(x0, y0, seed), b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed), d = hash2i(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Tileable fBm over the unit square. `cells` = base lattice cells across the
 * tile; lacunarity is fixed at 2 so every octave lands on an integer period and
 * the result stays exactly seamless.
 */
function fbm(x01, y01, cells, oct, gain, seed) {
  let amp = 1, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    const p = cells * f;
    sum += amp * vnoise(x01 * p, y01 * p, p, seed + i * 1013);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Anisotropic tileable value noise: independent wrap periods per axis. Needed
 * whenever a pattern is stretched along one axis (mill rolling, wood grain,
 * grass blades, bark fissures) — scaling the *input* instead breaks the tile.
 */
function vnoiseXY(x, y, px, py, seed) {
  const pX = px < 1 ? 1 : px | 0;
  const pY = py < 1 ? 1 : py | 0;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % pX) + pX) % pX, y0 = ((yi % pY) + pY) % pY;
  const x1 = (x0 + 1) % pX, y1 = (y0 + 1) % pY;
  const a = hash2i(x0, y0, seed), b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed), d = hash2i(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** fBm with independent cell counts per axis. cellsX/cellsY must be integers. */
function fbmXY(x01, y01, cellsX, cellsY, oct, gain, seed) {
  let amp = 1, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    const pX = cellsX * f, pY = cellsY * f;
    sum += amp * vnoiseXY(x01 * pX, y01 * pY, pX, pY, seed + i * 1013);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** domain-warped anisotropic fBm — the wood-grain / bark generator */
function warpedFbmXY(x01, y01, cellsX, cellsY, oct, gain, seed, warp) {
  const hx = Math.max(1, cellsX >> 1), hy = Math.max(1, cellsY >> 1);
  const wx = fbmXY(x01, y01, hx, hy, 3, 0.5, seed + 5501) - 0.5;
  const wy = fbmXY(x01, y01, hx, hy, 3, 0.5, seed + 9902) - 0.5;
  return fbmXY(x01 + wx * warp, y01 + wy * warp, cellsX, cellsY, oct, gain, seed);
}

/** Ridged multifractal — sharp creases, ideal for rock, ice fractures, bark. */
function ridged(x01, y01, cells, oct, gain, seed) {
  let amp = 1, sum = 0, norm = 0, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    const p = cells * f;
    let n = vnoise(x01 * p, y01 * p, p, seed + i * 2179);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    n *= prev;
    prev = clamp01(n * 1.4);
    sum += amp * n;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** anisotropic ridged fBm (bark fissures run along V) */
function ridgedXY(x01, y01, cellsX, cellsY, oct, gain, seed) {
  let amp = 1, sum = 0, norm = 0, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    const pX = cellsX * f, pY = cellsY * f;
    let n = vnoiseXY(x01 * pX, y01 * pY, pX, pY, seed + i * 2179);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    n *= prev;
    prev = clamp01(n * 1.4);
    sum += amp * n;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Tileable Worley / cellular noise. Writes into the module-scope `W` struct so
 * it never allocates. f2-f1 gives the crack network; f1 gives the cell bulge.
 */
function worley(x01, y01, cells, seed) {
  const c = cells | 0;
  const fx = x01 * c, fy = y01 * c;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const wx = ((cx % c) + c) % c, wy = ((cy % c) + c) % c;
      const jx = hash2i(wx, wy, seed);
      const jy = hash2i(wx, wy, seed + 7717);
      const dx = cx + jx - fx, dy = cy + jy - fy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2i(wx, wy, seed + 331); }
      else if (d < f2) { f2 = d; }
    }
  }
  W.f1 = f1; W.f2 = f2; W.id = id;
  return W;
}

/** domain-warped fbm — wood grain, marble veins, smoke-like albedo drift */
function warpedFbm(x01, y01, cells, oct, gain, seed, warp) {
  const wx = fbm(x01, y01, cells * 0.5, 3, 0.5, seed + 5501) - 0.5;
  const wy = fbm(x01, y01, cells * 0.5, 3, 0.5, seed + 9902) - 0.5;
  return fbm(x01 + wx * warp, y01 + wy * warp, cells, oct, gain, seed);
}

/* ---------------------------------------------------------------- canvases */

function makeCanvas(n, m) {
  const h = m || n;
  const cv = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: n, height: h, getContext: () => null };
  cv.width = n;
  cv.height = h;
  return cv;
}

function ctx2d(cv) {
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('[Mats] 2D canvas context unavailable');
  return c;
}

/**
 * Directional scratch mask. Drawn with the 2D API (cheap, anti-aliased) and read
 * back as a float field so the pixel loops can fold it into height/roughness.
 */
function maskScratches(n, opt) {
  const cv = makeCanvas(n);
  const c = ctx2d(cv);
  c.fillStyle = '#000';
  c.fillRect(0, 0, n, n);
  const rnd = mulberry32(opt.seed || 1);
  c.lineCap = 'round';
  const baseA = (opt.angle || 0) * Math.PI / 180;
  const jit = (opt.jitter || 6) * Math.PI / 180;
  for (let i = 0; i < (opt.count || 220); i++) {
    const a = baseA + (rnd() * 2 - 1) * jit;
    const len = lerp(opt.minLen || 0.15, opt.maxLen || 0.9, rnd() * rnd()) * n;
    const x = rnd() * n, y = rnd() * n;
    const dx = Math.cos(a) * len * 0.5, dy = Math.sin(a) * len * 0.5;
    const w = lerp(opt.minW || 0.5, opt.maxW || 2.0, rnd() * rnd());
    c.strokeStyle = 'rgba(255,255,255,' + (lerp(0.18, 1.0, rnd() * rnd())).toFixed(3) + ')';
    c.lineWidth = w;
    // draw three times, offset by +/- the tile, so the scratches wrap seamlessly
    for (let k = -1; k <= 1; k++) {
      c.beginPath();
      c.moveTo(x - dx + k * n, y - dy);
      c.lineTo(x + dx + k * n, y + dy);
      c.stroke();
      c.beginPath();
      c.moveTo(x - dx, y - dy + k * n);
      c.lineTo(x + dx, y + dy + k * n);
      c.stroke();
    }
  }
  const img = c.getImageData(0, 0, n, n).data;
  const out = new Float32Array(n * n);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = img[p] / 255;
  return out;
}

/** soft, seamless separable box blur used for baked AO */
function blurField(src, n, radius) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  const r = Math.max(1, radius | 0);
  const inv = 1 / (r * 2 + 1);
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[row + (((x + k) % n) + n) % n];
      tmp[row + x] = s * inv;
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[((((y + k) % n) + n) % n) * n + x];
      out[y * n + x] = s * inv;
    }
  }
  return out;
}

/**
 * Sobel height -> tangent-space normal map (OpenGL green-up).
 * CanvasTexture uploads with flipY = true, so image +y is uv -v: the green
 * channel therefore takes +dy_image. Wraps at the edges to stay seamless.
 */
function heightToNormal(h, n, strength) {
  const cv = makeCanvas(n);
  const c = ctx2d(cv);
  const img = c.createImageData(n, n);
  const d = img.data;
  const s = strength * n / 256;
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1) + n) % n, yp = (y + 1) % n;
    for (let x = 0; x < n; x++) {
      const xm = ((x - 1) + n) % n, xp = (x + 1) % n;
      const tl = h[ym * n + xm], t = h[ym * n + x], tr = h[ym * n + xp];
      const l = h[y * n + xm], r = h[y * n + xp];
      const bl = h[yp * n + xm], b = h[yp * n + x], br = h[yp * n + xp];
      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dX * s, ny = dY * s, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * n + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/** analytic seamless panel grid: returns signed distance-ish seam factor 0..1 */
function panelSeam(u, v, cols, rows, gap, bevel) {
  const cu = Math.abs(frac(u * cols) - 0.5) * 2;   // 0 centre -> 1 edge
  const cv = Math.abs(frac(v * rows) - 0.5) * 2;
  const du = (1 - cu) / (gap * cols || 1e-4);
  const dv = (1 - cv) / (gap * rows || 1e-4);
  const d = Math.min(du, dv);                       // 0 on the seam
  return smoothstep(0, bevel, d);                   // 0 in groove, 1 on plate
}

/**
 * Hexagonal lattice cell centre for the grate perforations.
 * `rows` MUST be even: odd rows are offset by half a column, so an odd row
 * count leaves the top and bottom edges of the tile out of phase and puts a
 * visible seam across every grate in the game.
 */
function hexCell(u, v, cols, rows, out) {
  const row = Math.round(v * rows);
  const off = ((((row % 2) + 2) % 2) === 1) ? 0.5 : 0;
  const col = Math.round(u * cols - off);
  out.x = (col + off) / cols;
  out.y = row / rows;
  return out;
}

const _hex = { x: 0, y: 0 };

/* ========================================================================== *
 * 2. texture upload helpers                                                  *
 * ========================================================================== */

function upload(cv, name, srgb, repeat, clampEdges) {
  const t = new THREE.CanvasTexture(cv);
  t.name = name;
  t.wrapS = clampEdges ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = clampEdges ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = _aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  _tex.set(name, t);
  _owned.push(t);
  return t;
}

/** a small working set: a float height field + four RGBA buffers, reused per bake */
function bakeBuffers(n) {
  const cvA = makeCanvas(n), cvO = makeCanvas(n), cvE = makeCanvas(n), cvM = makeCanvas(n);
  const cA = ctx2d(cvA), cO = ctx2d(cvO), cE = ctx2d(cvE), cM = ctx2d(cvM);
  return {
    n,
    h: new Float32Array(n * n),
    cvA, cvO, cvE, cvM,
    imgA: cA.createImageData(n, n),
    imgO: cO.createImageData(n, n),
    imgE: cE.createImageData(n, n),
    imgM: cM.createImageData(n, n),
    ctxA: cA, ctxO: cO, ctxE: cE, ctxM: cM,
  };
}

function commitA(B) { B.ctxA.putImageData(B.imgA, 0, 0); return B.cvA; }
function commitO(B) { B.ctxO.putImageData(B.imgO, 0, 0); return B.cvO; }
function commitE(B) { B.ctxE.putImageData(B.imgE, 0, 0); return B.cvE; }
function commitM(B) { B.ctxM.putImageData(B.imgM, 0, 0); return B.cvM; }

/**
 * Bake contact occlusion from the blurred height field into albedo + ORM.R.
 *   occ = clamp01(base + (h - blur(h)) * gainK + (1 - base))
 *   albedo *= kMin + (1 - kMin) * occ
 * (the exact form every ASCENDANT bake used inline; parameterised here)
 */
function bakeAO(B, radius, base, gainK, kMin) {
  const n = B.n, A = B.imgA.data, O = B.imgO.data;
  const ao = blurField(B.h, n, radius);
  for (let i = 0, p = 0; i < n * n; i++, p += 4) {
    const occ = clamp01(base + (B.h[i] - ao[i]) * gainK + (1 - base));
    const k = kMin + (1 - kMin) * occ;
    A[p] *= k; A[p + 1] *= k; A[p + 2] *= k;
    O[p] = occ * 255;
  }
}

/* ========================================================================== *
 * 3. shader injection + material assembly                                    *
 * ========================================================================== */

/** GLSL shared by every injected fragment (the caustic + hash helpers) */
const GLSL_FRAG_HELPERS = /* glsl */`
float cbHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
/* Value noise in world metres — the macro-variation field. Two octaves is all
 * a de-tiler needs: it only has to be lower-frequency than the tile it hides. */
float cbVnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = cbHash12( i );
  float b = cbHash12( i + vec2( 1.0, 0.0 ) );
  float c = cbHash12( i + vec2( 0.0, 1.0 ) );
  float d = cbHash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float cbCaustic( vec2 p, float t ) {
  vec2 q = p;
  float c = 0.0;
  for ( int i = 0; i < 3; i ++ ) {
    float fi = float( i );
    q += vec2( sin( q.y * 1.7 + t * 0.9 + fi ), cos( q.x * 1.5 - t * 0.7 + fi * 1.3 ) ) * 0.35;
    c += abs( sin( q.x + q.y * 1.3 + t + fi * 0.7 ) );
  }
  return pow( clamp( 1.0 - c / 3.0, 0.0, 1.0 ), 4.0 ) * 2.5;
}
`;

/**
 * Install the CRESTBOUND shader extensions into a stock three.js material.
 *
 * opts:
 *   box            world-space box projection (default true)
 *   uvScale        uv units per world metre for the projection
 *   uv2Mul         extra multiplier for the clearcoat-normal uv (sparkle)
 *   uniforms       object shared by every clone, OR function(mat) -> object
 *                  (per-material uniforms, e.g. painting's shimmer)
 *   defines        GLSL #defines toggling optional blocks (CB_LAVA, CB_SLOPE,
 *                  CB_RIM, CB_CAUSTIC, CB_WIND, CB_SHIMMER)
 *
 * The program cache key is DERIVED from `box` + `defines` (see the shapeKey
 * note at the end of this function) — it is not an option. Materials with the
 * same injection shape share one program; their uniforms stay per material.
 *
 * Defensive: if a chunk marker is missing (three rename) the injection is
 * skipped and the material falls back to attribute UVs.
 */
function injectShader(mat, key, opts) {
  let box = opts.box !== false;
  let lod = opts.lod !== false;
  const iblRough = !!opts.iblRough;
  const defines = opts.defines || {};
  const uvScale = opts.uvScale || 0.5;
  const u = (typeof opts.uniforms === 'function') ? null : (opts.uniforms || null);
  if (box) {
    const bu = {
      uCbUv: { value: new THREE.Vector2(uvScale, uvScale) },
      uCbUv2: { value: opts.uv2Mul || 1 },
      uCbFlow: { value: new THREE.Vector2(0, 0) },
    };
    _shaderU.set(key, Object.assign(bu, u || {}));
  } else if (u) {
    _shaderU.set(key, u);
  }
  const shared = _shaderU.get(key) || null;
  const perMat = (typeof opts.uniforms === 'function') ? opts.uniforms : null;

  const D = {
    lava: !!defines.CB_LAVA, slope: !!defines.CB_SLOPE, rim: !!defines.CB_RIM,
    caustic: !!defines.CB_CAUSTIC, wind: !!defines.CB_WIND, shimmer: !!defines.CB_SHIMMER,
    macro: !!defines.CB_MACRO, face: !!defines.CB_FACE,
    detail: !!defines.CB_DETAIL, foliage: !!defines.CB_FOLIAGE,
  };

  mat.onBeforeCompile = function (shader) {
    // ---- uniforms ---------------------------------------------------------
    if (shared) for (const k in shared) shader.uniforms[k] = shared[k];
    if (perMat) {
      const local = perMat(this);
      for (const k in local) shader.uniforms[k] = local[k];
    }
    if (D.lava) {
      shader.uniforms.uCbTime = LAVA_U.uCbTime;
      shader.uniforms.uCbFlowA = LAVA_U.uCbFlowA;
      shader.uniforms.uCbFlowB = LAVA_U.uCbFlowB;
    }
    if (D.wind || D.shimmer) shader.uniforms.uCbTime = TIME_U;
    if (lod) shader.uniforms.uCbLod = LOD_U;

    // ---- vertex -----------------------------------------------------------
    let vHead = '';
    if (lod) vHead += 'varying float vCbDist;\n';
    if (box) vHead += 'uniform vec2 uCbUv;\nuniform float uCbUv2;\nuniform vec2 uCbFlow;\nvarying vec3 vCbW;\nvarying vec3 vCbN;\n';
    if (D.wind) vHead += 'uniform float uCbTime;\nuniform float uCbWind;\n';

    if (D.wind) {
      const BEGIN = '#include <begin_vertex>';
      if (shader.vertexShader.indexOf(BEGIN) !== -1) {
        shader.vertexShader = shader.vertexShader.replace(BEGIN, BEGIN + `
  // --- CRESTBOUND canopy wind: the card pivots at uv.y = 0 (the branch) ---
  {
    vec4 cbWp = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      cbWp = instanceMatrix * cbWp;
    #endif
    cbWp = modelMatrix * cbWp;
    float cbPh = dot( cbWp.xz, vec2( 0.37, 0.29 ) ) + uCbTime * 1.6;
    float cbSway = ( sin( cbPh ) + 0.5 * sin( cbPh * 2.3 + 1.7 ) ) * uCbWind * uv.y * uv.y;
    transformed.x += cbSway;
    transformed.z += cbSway * 0.6;
    transformed.y += cbSway * cbSway * 0.35;
  }`);
      }
    }

    const MARK = '#include <project_vertex>';
    if ((box || lod) && shader.vertexShader.indexOf(MARK) === -1) {
      /* No marker means no world position and no view depth: drop BOTH the box
       * projection and the LOD gate rather than ship a varying nothing writes. */
      box = false; lod = false;
      if (!_injectWarned) {
        _injectWarned = true;
        console.warn('[Mats] box-projection marker not found — falling back to attribute UVs');
      }
      return;
    }
    if (lod) {
      shader.vertexShader = shader.vertexShader.replace(MARK, MARK + `
  vCbDist = - mvPosition.z;`);
    }
    if (box) {
      shader.vertexShader = vHead + shader.vertexShader.replace(MARK, MARK + `
  // --- CRESTBOUND world-space box projection -------------------------------
  // mirrors the batching/instancing chain that <project_vertex> applies, so an
  // InstancedMesh of decor projects at its instance transform, not the base one
  vec4 cbP = vec4( transformed, 1.0 );
  vec3 cbNo = objectNormal;
  #ifdef USE_BATCHING
    cbP = batchingMatrix * cbP;
    cbNo = mat3( batchingMatrix ) * cbNo;
  #endif
  #ifdef USE_INSTANCING
    cbP = instanceMatrix * cbP;
    cbNo = mat3( instanceMatrix ) * cbNo;
  #endif
  vec3 cbW = ( modelMatrix * cbP ).xyz;
  vec3 cbN = normalize( mat3( modelMatrix ) * cbNo );
  vCbW = cbW;
  vCbN = cbN;
  vec3 cbA = abs( cbN );
  vec2 cbUv;
  if ( cbA.y >= cbA.x && cbA.y >= cbA.z ) {
    cbUv = vec2( cbW.x, cbW.z );
  } else if ( cbA.x >= cbA.z ) {
    cbUv = vec2( cbW.z, cbW.y );
  } else {
    cbUv = vec2( cbW.x, cbW.y );
  }
  cbUv = cbUv * uCbUv + uCbFlow;
  #ifdef USE_MAP
    vMapUv = cbUv;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = cbUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = cbUv;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv = cbUv;
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv = cbUv;
  #endif
  #ifdef USE_ALPHAMAP
    vAlphaMapUv = cbUv;
  #endif
  #ifdef USE_CLEARCOAT_NORMALMAP
    vClearcoatNormalMapUv = cbUv * uCbUv2;
  #endif
  // ------------------------------------------------------------------------`);
    } else if (vHead) {
      shader.vertexShader = vHead + shader.vertexShader;
    }

    // ---- fragment ---------------------------------------------------------
    let fHead = GLSL_FRAG_HELPERS;
    if (lod) fHead += 'varying float vCbDist;\nuniform vec2 uCbLod;\n';
    if (box) fHead += 'varying vec3 vCbW;\nvarying vec3 vCbN;\n';
    if (D.lava) fHead += 'uniform float uCbTime;\nuniform vec2 uCbFlowA;\nuniform vec2 uCbFlowB;\n';
    if (D.slope) fHead += 'uniform sampler2D uCbBlendMap;\nuniform sampler2D uCbBlendNormal;\nuniform sampler2D uCbBlendOrm;\nuniform float uCbBlendScale;\nuniform vec2 uCbSlope;\n';
    if (D.rim) fHead += 'uniform vec4 uCbRim;\n';
    if (D.macro) fHead += 'uniform vec4 uCbMacro;\n';
    if (D.face) fHead += 'uniform vec2 uCbFace;\n';
    if (D.detail) fHead += 'uniform vec2 uCbDetail;\n';
    if (D.caustic) fHead += 'uniform float uCbCausticTime;\nuniform float uCbCaustic;\nuniform vec4 uCbCausticParams;\nuniform vec3 uCbCausticColor;\n';
    if (D.shimmer) fHead += 'uniform float uCbTime;\nuniform float uShimmer;\nuniform vec3 uShimmerColor;\nuniform float uShimmerWidth;\n';
    shader.fragmentShader = fHead + shader.fragmentShader;

    const MAP = '#include <map_fragment>';
    if (shader.fragmentShader.indexOf(MAP) !== -1) {
      let pre = '', post = '';
      /* Distance LOD weight: 0 inside LOD_START, 1 past LOD_START + LOD_FADE.
         Every gated term below multiplies by (1 - cbLodT) inside its branch, so
         it is already zero where the branch stops running. */
      pre += lod
        ? '  float cbLodT = clamp( ( vCbDist - uCbLod.x ) * uCbLod.y, 0.0, 1.0 );\n'
        : '  float cbLodT = 0.0;\n';
      // slope weight is declared before the map read so every later stage can use it
      pre += D.slope
        ? '  float cbSlopeW = smoothstep( uCbSlope.x, uCbSlope.y, 1.0 - clamp( normalize( vCbN ).y, 0.0, 1.0 ) );\n'
        : '  float cbSlopeW = 0.0;\n';
      if (D.slope) {
        post += `
  #ifdef USE_MAP
    if ( cbSlopeW > 0.001 ) {
      vec4 cbBlendCol = texture2D( uCbBlendMap, vMapUv * uCbBlendScale );
      diffuseColor.rgb = mix( diffuseColor.rgb, cbBlendCol.rgb, cbSlopeW );
    }
  #endif`;
      }
      if (D.macro) {
        /* MACRO VARIATION — the de-tiler.
         *
         * A ground texture is a square that repeats every 1-3 m. From standing
         * height you see 30-80 copies of that square at once, and the eye locks
         * onto whatever the LOWEST surviving frequency inside the tile is — on
         * the verdant meadow that was the worley clump field, and the meadow
         * read as reptile scales (owner-observed, `_shots/verify_v1.png`).
         * The bake-side fix (blade-led normals, macro patches in the albedo)
         * removes the MOTIF; this removes the REPEAT, by modulating value and
         * warmth with a world-space field that has no relationship to the tile:
         *
         *   uCbMacro = vec4( metres per macro cell, value swing,
         *                    warm/cool swing, unused )
         *
         * ONE value-noise tap (4 hashes), no texture fetch, no per-frame
         * allocation. A second octave was drafted and cut: this runs on the
         * three highest-coverage materials in the game (grass, stone, marble)
         * and the frame is already fill-bound at 1080p, so the de-tiler has to
         * be the cheapest thing that works — and the repeat it hides lives at
         * the LOW frequency, which one octave already covers. */
        post += `
  if ( cbLodT < 0.999 ) {
    /* The de-tiler hides a REPEAT, and a repeat you cannot resolve is not a
       repeat: past the LOD radius the tile is sub-pixel and the noise tap is
       pure cost. Faded, not cut, so the radius is invisible. */
    float cbMw = 1.0 - cbLodT;
    vec2 cbM = vCbW.xz / max( uCbMacro.x, 0.001 );
    float cbMs = ( cbVnoise( cbM ) - 0.5 ) * cbMw;
    diffuseColor.rgb *= 1.0 + cbMs * uCbMacro.y;
    diffuseColor.rgb *= vec3( 1.0 + cbMs * uCbMacro.z,
                              1.0 + cbMs * uCbMacro.z * 0.25,
                              1.0 - cbMs * uCbMacro.z * 0.60 );
  }`;
      }
      if (D.face) {
        /* See faceInject. `vCbN` is the interpolated WORLD normal the box
         * projection already computes, so this costs one normalize. */
        post += `
  {
    diffuseColor.rgb *= mix( uCbFace.x, 1.0, smoothstep( 0.05, 0.80, normalize( vCbN ).y ) );
  }`;
      }
      if (D.caustic) {
        /* Underwater light on a floor BELOW a water surface.
         *   uCbCaustic        float strength, 0 = off — water.js's
         *                     linkCaustics(mats, key, strength) writes exactly
         *                     this, which is why it is a float and not a vec4
         *   uCbCausticParams  vec4( waterSurfaceY, worldScale, speed, unused )
         *   uCbCausticTime    its OWN clock object, so water.js may hand this
         *                     key the water clock instead of the material one
         * Drive all four through `Mats.setCaustics()`. */
        post += `
  {
    float cbBelow = uCbCausticParams.x - vCbW.y;
    if ( uCbCaustic > 0.001 && cbBelow > 0.0 && cbLodT < 0.999 ) {
      float cbFade = smoothstep( 0.0, 0.6, cbBelow ) * exp( - cbBelow * 0.22 );
      float cbC = cbCaustic( vCbW.xz * uCbCausticParams.y, uCbCausticTime * uCbCausticParams.z );
      diffuseColor.rgb += diffuseColor.rgb * uCbCausticColor * cbC * uCbCaustic * cbFade * ( 1.0 - cbLodT );
    }
  }`;
      }
      shader.fragmentShader = shader.fragmentShader.replace(MAP, pre + MAP + post);
    }

    if (D.slope) {
      const RM = '#include <roughnessmap_fragment>';
      if (shader.fragmentShader.indexOf(RM) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(RM, RM + `
  #ifdef USE_ROUGHNESSMAP
    if ( cbSlopeW > 0.001 ) {
      roughnessFactor = mix( roughnessFactor, roughness * texture2D( uCbBlendOrm, vRoughnessMapUv * uCbBlendScale ).g, cbSlopeW );
    }
  #endif`);
      }
    }

    /* ---- NORMAL: slope blend, DETAIL NORMAL, foliage bend ---------------
     * One rebuild of <normal_fragment_maps> for the three injections that
     * touch the shading normal, so they compose instead of fighting over the
     * same marker. */
    if (D.slope || D.detail || D.foliage) {
      const NM = '#include <normal_fragment_maps>';
      if (shader.fragmentShader.indexOf(NM) !== -1) {
        let body = NM;
        if (D.slope || D.detail) {
          body = `
  #ifdef USE_NORMALMAP_TANGENTSPACE
    vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;` +
    (D.slope ? `
    if ( cbSlopeW > 0.001 ) {
      vec3 cbMapN2 = texture2D( uCbBlendNormal, vNormalMapUv * uCbBlendScale ).xyz * 2.0 - 1.0;
      mapN = normalize( mix( mapN, cbMapN2, cbSlopeW ) );
    }` : '') +
    (D.detail ? `
    /* DETAIL NORMAL (2026-09-04): the same normal map read again at a second,
       higher frequency and ADDED in tangent space, so ground and stone carry
       micro-relief under the key light where the primary tile is a few
       texels per metre. Near field only — past the LOD radius the tile is
       sub-pixel and the tap is pure cost. */
    if ( cbLodT < 0.999 ) {
      vec2 cbDn = texture2D( normalMap, vNormalMapUv * uCbDetail.x ).xy * 2.0 - 1.0;
      mapN.xy += cbDn * ( uCbDetail.y * ( 1.0 - cbLodT ) );
    }` : '') + `
    mapN.xy *= normalScale;
    normal = normalize( tbn * mapN );
  #else
    ${'#include <normal_fragment_maps>'}
  #endif`;
        }
        if (D.foliage) {
          /* FOLIAGE NORMAL BEND (2026-09-04, owner: "distant trees are black
             cutouts"). A canopy card's own normal points sideways or DOWN on
             half its area, and no light in the rig lands there. Real foliage
             scatters light through itself, and every stylised renderer since
             Wind Waker fakes that the same way: pull the shading normal toward
             WORLD UP so the mass is lit like the sunlit dome it approximates.
             `viewMatrix[1]` is world +Y in view space — no extra uniform. */
          body += `
  {
    vec3 cbUpV = normalize( viewMatrix[ 1 ].xyz );
    normal = normalize( mix( normal, cbUpV, 0.55 ) );
  }`;
        }
        shader.fragmentShader = shader.fragmentShader.replace(NM, body);
      }
    }

    if (D.lava) {
      const EM = '#include <emissivemap_fragment>';
      if (shader.fragmentShader.indexOf(EM) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(EM, `
  #ifdef USE_EMISSIVEMAP
    // two independently scrolling flow layers -> molten rock that never loops
    vec3 lavaA = texture2D( emissiveMap, vEmissiveMapUv + uCbFlowA ).rgb;
    vec3 lavaB = texture2D( emissiveMap, vEmissiveMapUv * 0.61 + uCbFlowB ).rgb;
    vec3 lavaMix = max( lavaA, lavaB * 0.88 );
    float lavaPulse = 0.80 + 0.30 * sin( uCbTime * 1.35 + vCbW.x * 0.42 + vCbW.z * 0.31 );
    float lavaHeat = smoothstep( 0.06, 0.55, max( lavaMix.r, lavaMix.g ) );
    totalEmissiveRadiance *= lavaMix * mix( 0.75, lavaPulse, lavaHeat );
    // molten channels are smoother and less metallic than the frozen crust
    roughnessFactor = mix( roughnessFactor, 0.30, lavaHeat * 0.85 );
  #endif`);
      }
    }

    if (D.shimmer) {
      const EM = '#include <emissivemap_fragment>';
      if (shader.fragmentShader.indexOf(EM) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(EM, EM + `
  {
    // diagonal band sweeping across the canvas: uShimmer is the 0..1 phase
    // (driven by the builder — locked paintings hold a slow idle shimmer)
    // (vMapUv, not vUv: three only declares vUv under USE_UV, but every
    //  painting carries a map so vMapUv is always present)
    float cbBand = vMapUv.x * 0.7 + vMapUv.y * 0.7;
    float cbPos = uShimmer * 2.2 - 0.6;
    float cbS = 1.0 - smoothstep( 0.0, uShimmerWidth, abs( cbBand - cbPos ) );
    float cbWeave = 0.85 + 0.15 * sin( ( vMapUv.x + vMapUv.y ) * 240.0 + uCbTime * 4.0 );
    totalEmissiveRadiance += uShimmerColor * cbS * cbS * cbWeave;
  }`);
      }
    }

    /* ---- IBL SPECULAR LOD ------------------------------------------------
     * `<lights_fragment_maps>` is re-emitted here rather than wrapped, because
     * only HALF of it may be gated: the diffuse `getIBLIrradiance` is what
     * keeps a far surface at the right BRIGHTNESS, and dropping it would print
     * a dark ring at the LOD radius. What is gated is the SPECULAR lobe,
     * `getIBLRadiance` (and the clearcoat one) - a `textureCubeUV` blend of two
     * PMREM mips, per fragment, for a reflection that at 30+ metres is a few
     * pixels of sky already sitting behind the fog band.
     * MEASURED (`_harness/_fillab.py`, keep/cp3/medium): the whole environment
     * map is -1.31 ms of a 24.28 ms frame; on an open diorama, where most of
     * the screen is past the radius, it is the larger share of that.
     * `textureCubeUV` selects its mip EXPLICITLY, so unlike `normalMap` this is
     * safe inside non-uniform control flow.
     * The body is r172's chunk verbatim; if three is re-vendored, re-copy it. */
    if (lod) {
      const LM = '#include <lights_fragment_maps>';
      if (shader.fragmentShader.indexOf(LM) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(LM, `
  #if defined( RE_IndirectDiffuse )
    #ifdef USE_LIGHTMAP
      vec4 cbLightMapTexel = texture2D( lightMap, vLightMapUv );
      irradiance += cbLightMapTexel.rgb * lightMapIntensity;
    #endif
    #if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
      iblIrradiance += getIBLIrradiance( geometryNormal );
    #endif
  #endif
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    ${iblRough ? `
    /* ROUGH PATH: no second textureCubeUV. See IBL_ROUGH_CUT. */
    #if defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
      /* No distance term: this IS the cheap answer, and fading it would cost
         energy for no saving (see _harness/_lodcontinuous.py). */
      radiance += iblIrradiance * RECIPROCAL_PI;
    #else
      radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
    #endif
    #ifdef USE_CLEARCOAT
      if ( cbLodT < 0.999 ) clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * ( 1.0 - cbLodT );
    #endif` : `
    /* SMOOTH path. Near: the real lookup. Far: the same cheap term the rough
       materials use, so the surface keeps its ENERGY and loses only the
       SHARPNESS of the reflection. Blended across the fade, so the radius is
       continuous. */
    if ( cbLodT < 0.999 ) {
      vec3 cbIblCheap = iblIrradiance * RECIPROCAL_PI;
      #ifdef USE_ANISOTROPY
        radiance += mix( getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy ), cbIblCheap, cbLodT );
      #else
        radiance += mix( getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ), cbIblCheap, cbLodT );
      #endif
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += mix( getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ), cbIblCheap, cbLodT );
      #endif
    } else {
      radiance += iblIrradiance * RECIPROCAL_PI;
      #ifdef USE_CLEARCOAT
        clearcoatRadiance += iblIrradiance * RECIPROCAL_PI;
      #endif
    }`}
  #endif`);
      }
    }

    if (D.rim) {
      const AO = '#include <aomap_fragment>';
      if (shader.fragmentShader.indexOf(AO) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(AO, AO + `
  if ( cbLodT < 0.999 ) {
    // subsurface-ish rim: grazing light wraps through thin blades / leaves
    float cbNV = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
    float cbF = cbNV * cbNV * cbNV;
    reflectedLight.indirectDiffuse += diffuseColor.rgb * uCbRim.rgb * cbF * uCbRim.a
                                    * ( 1.0 - cbSlopeW ) * ( 1.0 - cbLodT );
  }`);
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * PROGRAM CACHE KEY = THE SHAPE OF THE INJECTION, NOT THE MATERIAL.
   *
   * three.js compiles one program per distinct cache key and `acquireProgram`
   * matches on that key ALONE — it never compares shader source. So the key
   * must name exactly the axes that change the GLSL above, and nothing else.
   *
   * Read the body of `onBeforeCompile`: every branch in it is `box` or one of
   * the eight `D.*` flags. Nothing reads `key`, `uvScale`, a colour or a map —
   * those are uniforms and three-side `parameters`, both of which are already
   * per-material (`materialProperties.uniforms` is cloned per material, and
   * map/physical/alphaTest/instancing all live in three's own half of the key).
   *
   * The old key was `'cb-' + key`, and `key` carries the THEME
   * (`stone.keep`, `stone.verdant`), so every material forked a program per
   * theme and per material name even though the emitted GLSL was byte-identical.
   * MEASURED (`_harness/_progprobe.py`, verdant-1 after keep, 2026-09-03): 123
   * programs live, of which the `cb.*` family alone held ~35 — one per
   * key×theme. Nine hand-written `cacheKey:` overrides existed to paper over
   * the theme half of that (`cb-stone-macro`, `cb-grass-macro`, …) and are now
   * subsumed: two materials with the same injection shape share one program
   * whatever they are called, whatever theme they belong to.
   *
   * ADDING AN INJECTION: if you add a branch to `onBeforeCompile`, add its flag
   * to this string in the same commit, or the new GLSL will silently inherit
   * the program of a material that does not have it.
   * ------------------------------------------------------------------ */
  const shapeKey = 'cb#' + (box ? 'b' : '-') + (lod ? 'D' : '') + (iblRough ? 'Q' : '') +
    (D.lava ? 'L' : '') + (D.slope ? 'S' : '') + (D.rim ? 'R' : '') +
    (D.caustic ? 'C' : '') + (D.wind ? 'W' : '') + (D.shimmer ? 'H' : '') +
    (D.macro ? 'M' : '') + (D.face ? 'F' : '') + (D.detail ? 'N' : '') + (D.foliage ? 'T' : '');
  mat.customProgramCacheKey = function () { return shapeKey; };
  return mat;
}

/**
 * `THREE.Material.copy()` copies an explicit field list that does NOT include
 * `onBeforeCompile` / `customProgramCacheKey`. A plain `.clone()` of one of our
 * materials would therefore silently lose world-space box projection and fall
 * back to attribute UVs — a vanishing platform would suddenly wear a different
 * texture scale from the platform beside it.
 *
 * Downstream code legitimately clones these (hazards clone a shared platform
 * material to animate opacity or trim; builders clone `painting` to swap the
 * thumbnail), so we install a clone that carries the hooks — and installs
 * itself on the copy, so clone-of-a-clone keeps working too. Per-material
 * uniform objects (`userData.cbLocal`) are deliberately NOT copied: a clone
 * gets its own on first compile.
 */
function installHookPreservingClone(mat) {
  mat.clone = function () {
    const c = new this.constructor().copy(this);
    c.onBeforeCompile = this.onBeforeCompile;
    c.customProgramCacheKey = this.customProgramCacheKey;
    c.clone = this.clone;
    c.userData.cbKey = this.userData.cbKey;
    c.userData.cbUvScale = this.userData.cbUvScale;
    c.userData.baseEmissive = this.userData.baseEmissive;
    c.userData.cbTheme = this.userData.cbTheme;
    c.userData.cbLocal = null;
    c.needsUpdate = true;
    return c;
  };
  return mat;
}

/**
 * Build the concrete THREE material from a baked map set.
 * `maps.orm` is glTF-packed: R = AO (baked into albedo too), G = roughness,
 * B = metalness — which is exactly what three reads from roughnessMap.g and
 * metalnessMap.b, so one texture serves both slots.
 *
 * `inject` (optional) = extra injectShader options (uniforms/defines/uv2Mul).
 */
/* ===========================================================================
 * Transmission is BANNED in this renderer — CONTRACT "Hard rules 4" (perf)
 * ---------------------------------------------------------------------------
 * `MeshPhysicalMaterial.transmission > 0` makes three.js render the ENTIRE
 * opaque scene a second time into `_transmissionRenderTarget` inside a single
 * `renderer.render()` call.  It is not one extra draw for the glass — it is a
 * full duplicate of every draw call and every triangle in the frame, and it
 * costs that whether the glass is one ice cube or a whole spire.
 *
 * Measured on verdant-1 (2026-09-02): 871 draws / 921k triangles with a single
 * water/ice material in view, 437 draws / ~470k with transmission stripped —
 * an exact halving, against a gate of 260 draws / 450k triangles.
 *
 * So the refractive family keeps its LOOK the cheap way: alpha + a strong
 * environment term + clearcoat, which on this art direction (stylised, heavily
 * bloomed, never a lens onto detailed geometry behind it) reads the same.
 * `transmissionToAlpha` is the ONE place that translation happens.
 */
function transmissionToAlpha(params) {
  if (!params || params.transmission === undefined) return params;
  const t = Math.max(0, Math.min(1, params.transmission));
  delete params.transmission;
  delete params.thickness;
  delete params.attenuationColor;
  delete params.attenuationDistance;
  if (t > 0.02) {
    /* An opaque-ish solid at t=0.1 (cloud), a clear pane at t=0.9 (glass). */
    const opacity = Math.max(0.18, 1 - t * 0.72);
    if (params.opacity === undefined || params.opacity > opacity) params.opacity = opacity;
    params.transparent = true;
    params.depthWrite = t < 0.5;
    params.envMapIntensity = (params.envMapIntensity || 1) * (1 + t * 0.55);
  }
  return params;
}

function assemble(key, maps, params, uvScale, inject) {
  const physical = !!params.__physical;
  delete params.__physical;
  transmissionToAlpha(params);

  const def = {
    map: maps.map || null,
    normalMap: maps.normal || null,
    roughnessMap: maps.orm || null,
    metalnessMap: maps.orm || null,
    emissiveMap: maps.emissive || null,
    alphaMap: maps.alpha || null,
  };
  for (const k in def) if (def[k] === null) delete def[k];

  const mat = physical
    ? new THREE.MeshPhysicalMaterial(Object.assign(def, params))
    : new THREE.MeshStandardMaterial(Object.assign(def, params));

  if (maps.clearcoatNormal && mat.isMeshPhysicalMaterial) mat.clearcoatNormalMap = maps.clearcoatNormal;
  mat.name = 'cb.' + key;
  mat.userData.cbKey = key;
  mat.userData.cbUvScale = uvScale;
  mat.userData.baseEmissive = mat.emissiveIntensity || 0;

  const io = Object.assign({ box: BOX_KEYS.has(key), uvScale }, inject || {});
  /* A rough material's specular IBL is its diffuse IBL scaled by 1/PI (see the
     IBL_ROUGH_CUT note); the injection reads this and drops the second
     textureCubeUV. Decided from the AUTHORED roughness, so it is a compile-time
     choice per material, not a per-fragment branch, and every material still
     resolves to exactly one program. */
  if (io.iblRough === undefined) io.iblRough = numOrAniso(mat.roughness, 1) >= IBL_ROUGH_CUT;
  injectShader(mat, key, io);
  installHookPreservingClone(mat);

  _uvScale.set(key, uvScale);
  _base.set(key, mat);
  return mat;
}

/** the three dirt maps + blend uniforms every slope-blended material shares */
/**
 * CB_MACRO defaults. `cell` is the macro period in world metres — it must be
 * several times the material's own tile so it hides the repeat instead of
 * becoming a new one. `value` is the ± brightness swing, `warm` the ± warm/cool
 * swing. `spare` is reserved (the drafted second octave was cut for fill cost —
 * see the CB_MACRO block in injectShader).
 */
function macroInject(cell, value, warm, spare, extra) {
  const e = extra || {};
  return Object.assign({}, e, {
    defines: Object.assign({ CB_MACRO: true }, e.defines || null),
    uniforms: Object.assign({
      uCbMacro: { value: new THREE.Vector4(cell, value, warm, spare) },
    }, e.uniforms || null),
  });
}

/**
 * FACING TERM — walls read darker than floors. CONTRACT SS15 readability law.
 *
 * The law asks that the walked surface hold 3.5:1 against whatever is behind it
 * at eye level. Indoors, and inside a fortress, that "behind" is usually a WALL
 * built from the SAME material as the deck and lit by the same rig — which is
 * the "mid deck against a mid band" failure the themes.js comment warns about,
 * and it cannot be fixed by tinting, because a tint moves both. Measured this
 * session: verdant-1 cp2 deck [214,212,195] against band [165,155,127] = 1.85:1;
 * keep cp1 deck [168,154,125] against band [100,81,72] = 2.69:1.
 *
 * A horizontal surface sees the whole sky and a vertical one sees half of it, so
 * darkening the verticals is what the light is already doing and the renderer
 * cannot afford to compute. `uCbFace.x` is the multiplier a fully vertical face
 * gets; a ceiling gets it too, because it sees no sky at all. One normalize and
 * one smoothstep — no texture fetch, nothing allocated.
 */
function faceInject(wallMul, extra) {
  const e = extra || {};
  return Object.assign({}, e, {
    defines: Object.assign({ CB_FACE: true }, e.defines || null),
    uniforms: Object.assign({
      uCbFace: { value: new THREE.Vector2(wallMul, 0) },
    }, e.uniforms || null),
  });
}

/**
 * DETAIL NORMAL — a second, higher-frequency read of the material's own normal
 * map (see the CB_DETAIL block in injectShader). `mul` is the uv multiplier
 * (how many detail tiles per primary tile), `strength` the tangent-space xy
 * weight. Composes with slope/macro/face injections.
 */
function detailInject(mul, strength, extra) {
  const e = extra || {};
  return Object.assign({}, e, {
    defines: Object.assign({ CB_DETAIL: true }, e.defines || null),
    uniforms: Object.assign({
      uCbDetail: { value: new THREE.Vector2(mul, strength) },
    }, e.uniforms || null),
  });
}

function slopeInject(extra) {
  return Object.assign({
    defines: { CB_SLOPE: true },
    uniforms: {
      uCbBlendMap: { value: _tex.get('dirt.albedo') || null },
      uCbBlendNormal: { value: _tex.get('dirt.normal') || null },
      uCbBlendOrm: { value: _tex.get('dirt.orm') || null },
      uCbBlendScale: { value: 1.0 },
      uCbSlope: { value: new THREE.Vector2(SLOPE_START, SLOPE_END) },
    },
  }, extra || {});
}

/* ========================================================================== *
 * 4. the bakes — ported family (CONTRACT §14, Ascendant heritage)             *
 * ========================================================================== */

/* -------------------------------------------------------------- 4.1 stone */
/**
 * COURSED ASHLAR — the castle wall / flagstone paving stone.
 *
 * ROUND 3 texel + character sweep (critic, `_shots/verdant-1/cp3.png`): the
 * previous bake was a worley CRACK NETWORK, i.e. crazy paving — irregular
 * polygonal cells with a wide dark grout, on every wall, every parapet and
 * every walkway of a fortress. Two things were wrong with it:
 *
 *   1. CHARACTER. A castle is built of RECTANGULAR blocks laid in COURSES.
 *      Crazy paving is a 1970s garden patio; it is what made every stone
 *      surface in the game read as one decal at any distance.
 *   2. SCALE. At uvScale 0.34 the tile was 2.94 m across, so a 9-cell worley
 *      put a cell near 0.33 m — but the cells the eye actually locks onto are
 *      the fbm `swell` (5 cells, 0.59 m) and the block-level colour draw, and
 *      on a 6 m walkway that read as three or four stones.
 *
 * So: running-bond ashlar, 3 courses x 2 blocks per tile at uvScale 0.72
 * (1.39 m tile) = 0.46 m courses of 0.69 m blocks, which is exactly the
 * 0.3-0.5 m range real dressed masonry sits in. Each block gets its own value,
 * warmth, roughness and pitch (tooled face) draw; the joints are recessed lime
 * mortar; the arrises chip. The granite speckle, dust-in-the-crevice and
 * lichen-free mineral response of the old bake are kept — they were right,
 * they were just organised as a patio.
 */
function bakeStone() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  const COURSES = 3;                 // block rows per tile
  const PER_ROW = 2;                 // blocks per row
  const JOINT = 0.030;               // joint half-width in block units (~2 cm)

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      /* ---- which block ---------------------------------------------------
       * Running bond: every other course is offset by half a block, so the
       * head joints never line up into a continuous vertical line — which is
       * both correct masonry and what stops the pattern reading as a grid. */
      const rowF = v * COURSES;
      const row = Math.floor(rowF);
      const sv = rowF - row;
      const shift = (row & 1) ? 0.5 : 0.0;
      const colF = u * PER_ROW + shift;
      const col = Math.floor(colF);
      const su = colF - col;
      const bx = ((col % PER_ROW) + PER_ROW) % PER_ROW;

      const bidV = hash2i(bx, row, 5501);     // value
      const bidW = hash2i(bx, row, 7717);     // warmth
      const bidR = hash2i(bx, row, 3313);     // roughness / tooling
      const bidP = hash2i(bx, row, 9109);     // pitch-face phase

      /* joints. The head joint is narrower than the bed joint on real ashlar,
       * so the courses read as courses. */
      const dU = Math.min(su, 1 - su);
      const dV = Math.min(sv, 1 - sv);
      const jointU = 1 - smoothstep(JOINT * 0.5, JOINT, dU);
      const jointV = 1 - smoothstep(JOINT * 0.7, JOINT * 1.4, dV);
      const joint = Math.max(jointU, jointV);
      const arris = 1 - smoothstep(JOINT, JOINT * 3.4, Math.min(dU, dV));

      /* ---- the face of the block ---------------------------------------- */
      // tooled pitch-face: shallow chisel undulation running along the course
      const pitch = fbm(su * 0.85 + bidP * 3.7, sv * 1.6 + bidP * 2.1, 7, 3, 0.55, 91);
      /* ROUND 5 — THE MOIRE BAND, and the same class of bug bakeGrass fixed.
       * Critic, crop `_shots/_r3_v1_pave.png`: "the fort courtyard paving
       * carries a second, misaligned high-frequency hatch on top of the
       * running-bond grid, which moires into a diagonal streak band in the
       * lower-left of the crop". `grit` was ONE axis-aligned, seamlessly
       * tileable 60-cell field shared by every block on every surface in the
       * game, so it is a single global lattice: at a grazing angle its Nyquist
       * limit beats against the pixel grid and you get the streak band. Two
       * orthogonal fields cross-faded per BLOCK (bidR) means the grain
       * direction changes every 0.5 m, so no lattice survives long enough to
       * beat with anything — exactly the fix bakeGrass made for its blades.
       * The frequency also comes down (60 -> 42 cells, ~3.3 cm) which puts it
       * back above the mip chain's give-up point at courtyard distance. */
      const gritA = fbmXY(u + v * 0.20, v, 42, 26, 3, 0.5, 313);
      const gritB = fbmXY(u, v + u * 0.20, 26, 42, 3, 0.5, 317);
      const grit = lerp(gritA, gritB, bidR);
      // chipped arrises: a few blocks have a corner knocked off
      worley(su * 0.5 + bidP, sv * 0.5 + bidV, 5, 5507);
      const chip = smoothstep(0.20, 0.05, W.f1) * (bidR > 0.70 ? 1 : 0) * arris;

      let h = 0.62 + (pitch - 0.5) * 0.30 + (grit - 0.5) * 0.10 + (bidV - 0.5) * 0.10;
      h -= joint * 0.55;
      h -= arris * 0.09;
      h -= chip * 0.20;
      B.h[i] = h;

      // mineral speckle: three feldspar/quartz/biotite populations
      const sp = hash2i(x, y, 4409);
      /* ROUND 5 — "every paver is exactly the same grey" (critic, same crop).
       * With COURSES 3 x PER_ROW 2 there are only six distinct blocks in the
       * tile, and the per-block value spread was +-0.075 on a 0.455 base: 16 %,
       * which mips away to nothing at 10 m. Real ashlar of one quarry still
       * varies by a third block to block — bedding planes, iron staining, how
       * long each face has been weathering. Value spread and warmth spread both
       * roughly double, and a per-block WEATHERING draw (bidP) darkens a
       * minority of blocks the way a damp course does. */
      const base = 0.455 + (bidV - 0.5) * 0.30 + (pitch - 0.5) * 0.14 + (grit - 0.5) * 0.07;
      const weather = 1 - Math.max(0, bidP - 0.62) * 0.52;
      let r = base * weather * (1.05 + (bidW - 0.5) * 0.20);
      let g = base * weather * (1.015 + (bidW - 0.5) * 0.07);
      let b = base * weather * (1.00 - (bidW - 0.5) * 0.16);
      if (sp > 0.972) { r = 0.80; g = 0.82; b = 0.86; }        // quartz fleck
      else if (sp < 0.026) { r = 0.11; g = 0.11; b = 0.13; }   // biotite fleck
      else if (sp > 0.93) { r *= 1.16; g *= 1.12; b *= 1.06; }

      // dust and weathering settle in the low ground of the tooled face
      const low = clamp01((0.62 - h) * 2.0);
      const dust = low * low * 0.42 * (0.5 + 0.5 * grit);
      r = lerp(r, 0.70, dust); g = lerp(g, 0.66, dust); b = lerp(b, 0.56, dust);

      // chipped corners show fresh, paler stone
      r = lerp(r, 0.66, chip * 0.55); g = lerp(g, 0.65, chip * 0.55); b = lerp(b, 0.62, chip * 0.55);

      // lime mortar joint: warm, pale, matte — and DARK in the shadow of the bed
      const mortar = 0.52 + (grit - 0.5) * 0.10;
      r = lerp(r, mortar * 1.02, joint * 0.90);
      g = lerp(g, mortar * 0.98, joint * 0.90);
      b = lerp(b, mortar * 0.88, joint * 0.90);
      r *= 1 - joint * 0.34; g *= 1 - joint * 0.34; b *= 1 - joint * 0.34;

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.74 + (bidR - 0.5) * 0.22 - (pitch - 0.5) * 0.10 + joint * 0.18, 0.42, 1) * 255;
      O[p + 2] = 6;                                            // effectively dielectric
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 5, 0.55, 3.4, 0.52);

  const maps = {
    map: upload(commitA(B), 'stone.albedo', true, 0.72),
    orm: upload(commitO(B), 'stone.orm', false, 0.72),
    normal: upload(heightToNormal(B.h, n, 1.05), 'stone.normal', false, 0.72),
  };
  return assemble('stone', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(1.05, 1.05), envMapIntensity: 0.6,
  /* ROUND 2: the wall multiplier tightens. contrastcheck measured verdant-1 cp2
   * at 2.99:1 (deck [179,178,155] against a band of [102,94,73] — the fort's
   * own lit interior wall) and keep cp1 at 1.57:1, both against a 3.5:1 law.
   * The band in each case is a VERTICAL face of the same stone family as the
   * deck, so the pair can only be separated by the thing that physically
   * separates them: a wall sees a sliver of sky, a floor sees all of it.
   * Darkening the verticals is also what makes an interior read as a room
   * with depth rather than a single-value box.
   *
   * ROUND 5, MEASURED. contrastcheck verdant-1 cp2 read 3.15:1 after the pad
   * lift was raised as far as the tone map's shoulder allows (deck
   * [195,192,170] over band [109,101,80]); the remaining 11 % has to come off
   * the BAND, which at that station is the fort's own sunlit VERTICAL wall, and
   * this multiplier is the only term in the engine that separates a wall from a
   * floor of the same material. 0.27 -> 0.215 measured [102,95,77] and 3.44:1;
   * 0.180 is the same lever taken past the 3.5 line with the +-0.4 run-to-run
   * drift this station is known to have, so the pass is a margin and not luck. */
  }, 0.72, macroInject(9.0, 0.17, 0.075, 0.35, detailInject(4.7, 0.42, faceInject(0.180))));
}

/* -------------------------------------------------------------- 4.2 panel */
/** Brushed technical panel: recessed seams, corner screws, worn edges. */
function bakePanel() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const brushed = maskScratches(n, { seed: 22, count: 520, angle: 0, jitter: 2.5, minLen: 0.4, maxLen: 1.4, minW: 0.4, maxW: 1.2 });
  const COLS = 2, ROWS = 2, GAP = 0.018;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const plate = panelSeam(u, v, COLS, ROWS, GAP, 0.55);      // 0 groove, 1 plate
      const groove = 1 - plate;

      // screws at each plate's four inset corners
      const su = frac(u * COLS), sv = frac(v * ROWS);
      const sx = Math.min(su, 1 - su), sy = Math.min(sv, 1 - sv);
      const sd = Math.sqrt((sx - 0.085) * (sx - 0.085) + (sy - 0.085) * (sy - 0.085));
      const screw = smoothstep(0.038, 0.020, sd);
      const slot = screw * smoothstep(0.010, 0.004, Math.abs((su - 0.5) * 0.35 + (sv - 0.5) * 0.35));

      const grime = fbm(u, v, 6, 4, 0.55, 771);
      const micro = fbm(u, v, 70, 2, 0.5, 4021);
      const brush = brushed[i];

      let h = 0.60 * plate + 0.06 * brush + (micro - 0.5) * 0.05;
      h += screw * 0.16 - slot * 0.12;
      B.h[i] = h;

      // edge wear: exposed metal along the plate borders + wherever grime is thin
      const wear = clamp01(smoothstep(0.55, 1.0, 1 - plate) * 0.9 + smoothstep(0.62, 0.86, grime) * 0.45) * (0.55 + 0.45 * micro);

      let r = 0.148, g = 0.176, b = 0.212;                       // graphite blue panel
      r += (grime - 0.5) * 0.05; g += (grime - 0.5) * 0.05; b += (grime - 0.5) * 0.05;
      r += brush * 0.055; g += brush * 0.055; b += brush * 0.06;
      // bevel catch-light on the plate lip
      const lip = smoothstep(0.35, 0.9, plate) * (1 - smoothstep(0.9, 1.0, plate));
      r += lip * 0.10; g += lip * 0.11; b += lip * 0.12;
      // groove shadow
      r = lerp(r, 0.045, groove * 0.85); g = lerp(g, 0.052, groove * 0.85); b = lerp(b, 0.064, groove * 0.85);
      // worn-through alloy
      r = lerp(r, 0.60, wear); g = lerp(g, 0.63, wear); b = lerp(b, 0.67, wear);
      // screw heads
      r = lerp(r, 0.52, screw); g = lerp(g, 0.545, screw); b = lerp(b, 0.575, screw);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;

      let rough = 0.54 - brush * 0.10 + groove * 0.18 + (grime - 0.5) * 0.10;
      rough = lerp(rough, 0.30, wear);
      rough = lerp(rough, 0.24, screw);
      let metal = 0.12 + brush * 0.06;
      metal = lerp(metal, 0.88, wear);
      metal = lerp(metal, 0.95, screw);
      O[p + 1] = clamp(rough, 0.14, 0.98) * 255;
      O[p + 2] = clamp(metal, 0, 1) * 255;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.62, 3.0, 0.60);

  const maps = {
    map: upload(commitA(B), 'panel.albedo', true, 0.5),
    orm: upload(commitO(B), 'panel.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 1.15), 'panel.normal', false, 0.5),
  };
  return assemble('panel', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 1.0,
  }, 0.5, faceInject(0.62));
}

/* -------------------------------------------------------------- 4.3 metal */
/** Brushed steel — long directional scratches, faint mill rolling. */
function bakeMetal() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const brush = maskScratches(n, { seed: 88, count: 900, angle: 4, jitter: 3, minLen: 0.5, maxLen: 2.0, minW: 0.4, maxW: 1.1 });
  const deep = maskScratches(n, { seed: 89, count: 70, angle: 4, jitter: 22, minLen: 0.2, maxLen: 0.8, minW: 0.8, maxW: 2.4 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const mill = fbmXY(u, v, 8, 32, 3, 0.5, 1777);   // stretched along U, still tiles
      const patina = fbm(u, v, 7, 4, 0.55, 2311);
      const b = brush[i], d = deep[i];

      B.h[i] = 0.5 + b * 0.10 - d * 0.30 + (mill - 0.5) * 0.06;

      let r = 0.470, g = 0.492, b2 = 0.522;
      r += (patina - 0.5) * 0.09; g += (patina - 0.5) * 0.09; b2 += (patina - 0.5) * 0.10;
      r += b * 0.10; g += b * 0.10; b2 += b * 0.105;
      r = lerp(r, 0.30, d * 0.7); g = lerp(g, 0.315, d * 0.7); b2 = lerp(b2, 0.335, d * 0.7);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b2 * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.34 - b * 0.13 + d * 0.30 + (patina - 0.5) * 0.14, 0.08, 0.95) * 255;
      O[p + 2] = clamp(0.96 - d * 0.18, 0, 1) * 255;
      O[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'metal.albedo', true, 0.5),
    orm: upload(commitO(B), 'metal.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 1.0), 'metal.normal', false, 0.5),
  };
  return assemble('metal', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.25,
  }, 0.5);
}

/* -------------------------------------------------------------- 4.4 grate */
/** Perforated alpha-tested walkway plate, double sided. */
function bakeGrate() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, M = B.imgM.data;
  const COLS = 5, ROWS = 6;          // ROWS even -> the offset rows wrap
  const scuff = maskScratches(n, { seed: 401, count: 240, angle: 32, jitter: 40, minLen: 0.05, maxLen: 0.4, minW: 0.5, maxW: 1.6 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      hexCell(u, v, COLS, ROWS, _hex);
      let dx = u - _hex.x, dy = v - _hex.y;
      dx -= Math.round(dx); dy -= Math.round(dy);
      const d = Math.sqrt(dx * dx + dy * dy) * COLS;

      const hole = smoothstep(0.34, 0.28, d);                 // 1 inside the hole
      const rim = smoothstep(0.28, 0.36, d) * smoothstep(0.46, 0.38, d);
      const grime = fbm(u, v, 9, 3, 0.55, 66);
      const sc = scuff[i];

      B.h[i] = (1 - hole) * (0.55 + rim * 0.30) + sc * 0.08 + (grime - 0.5) * 0.05;

      let r = 0.185, g = 0.200, b = 0.222;
      r += (grime - 0.5) * 0.07; g += (grime - 0.5) * 0.07; b += (grime - 0.5) * 0.07;
      r += rim * 0.13 + sc * 0.16; g += rim * 0.135 + sc * 0.16; b += rim * 0.14 + sc * 0.165;

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.46 - sc * 0.18 + (grime - 0.5) * 0.16, 0.12, 0.95) * 255;
      O[p + 2] = clamp(0.90 - grime * 0.10, 0, 1) * 255;
      O[p + 3] = 255;

      const a = (1 - hole) * 255;
      M[p] = a; M[p + 1] = a; M[p + 2] = a; M[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'grate.albedo', true, 1.0),
    orm: upload(commitO(B), 'grate.orm', false, 1.0),
    normal: upload(heightToNormal(B.h, n, 1.6), 'grate.normal', false, 1.0),
    alpha: upload(commitM(B), 'grate.alpha', false, 1.0),
  };
  return assemble('grate', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    alphaTest: 0.5, transparent: false, side: THREE.DoubleSide,
    normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 1.1,
  }, 1.0);
}

/* ---------------------------------------------------------------- 4.5 ice */
/** Transmissive glacial ice: internal fracture normals + a separate sparkle
 *  micro-normal on the clearcoat layer, so it glitters without smearing. */
function bakeIce() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      worley(u, v, 6, 3301);
      const crack = 1 - smoothstep(0.0, 0.055, W.f2 - W.f1);
      worley(u, v, 14, 8821);
      const shard = 1 - smoothstep(0.0, 0.09, W.f2 - W.f1);
      const swell = fbm(u, v, 4, 4, 0.55, 555);
      const frost = smoothstep(0.55, 0.85, fbm(u, v, 16, 4, 0.5, 991));
      const bubbles = smoothstep(0.86, 0.97, fbm(u, v, 38, 2, 0.5, 1213));

      B.h[i] = 0.5 + (swell - 0.5) * 0.5 - crack * 0.34 - shard * 0.14 + bubbles * 0.10 + frost * 0.05;

      let r = 0.735, g = 0.855, b = 0.925;
      r += (swell - 0.5) * 0.10; g += (swell - 0.5) * 0.08; b += (swell - 0.5) * 0.05;
      // deep blue in the fracture planes
      r = lerp(r, 0.30, crack * 0.55); g = lerp(g, 0.52, crack * 0.55); b = lerp(b, 0.68, crack * 0.45);
      // opaque white frost bloom
      r = lerp(r, 0.955, frost * 0.8); g = lerp(g, 0.975, frost * 0.8); b = lerp(b, 0.995, frost * 0.8);
      r = lerp(r, 0.99, bubbles * 0.6); g = lerp(g, 0.99, bubbles * 0.6); b = lerp(b, 1.0, bubbles * 0.6);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.055 + crack * 0.30 + frost * 0.46 + bubbles * 0.16, 0.02, 0.92) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  // high-frequency sparkle for the clearcoat normal (separate, smaller canvas)
  const ns = SIZE_MD;
  const sparkH = new Float32Array(ns * ns);
  for (let y = 0; y < ns; y++) {
    for (let x = 0; x < ns; x++) {
      const u = x / ns, v = y / ns, i = y * ns + x;
      worley(u, v, 40, 6161);
      const facet = smoothstep(0.55, 0.0, W.f1);
      sparkH[i] = facet * 0.7 + fbm(u, v, 96, 2, 0.5, 71) * 0.3;
    }
  }

  const maps = {
    map: upload(commitA(B), 'ice.albedo', true, 0.30),
    orm: upload(commitO(B), 'ice.orm', false, 0.30),
    normal: upload(heightToNormal(B.h, n, 1.2), 'ice.normal', false, 0.30),
    clearcoatNormal: upload(heightToNormal(sparkH, ns, 1.5), 'ice.sparkle', false, 1.0),
  };
  return assemble('ice', maps, {
    __physical: true,
    color: 0xdcf2ff, roughness: 1, metalness: 0,
    transmission: 0.35, thickness: 0.9, ior: 1.31,
    attenuationColor: new THREE.Color(0x86c8e2), attenuationDistance: 2.2,
    clearcoat: 1.0, clearcoatRoughness: 0.06,
    iridescence: 0.28, iridescenceIOR: 1.25, iridescenceThicknessRange: [120, 460],
    specularIntensity: 1.0, envMapIntensity: 1.5,
    normalScale: new THREE.Vector2(0.85, 0.85),
    clearcoatNormalScale: new THREE.Vector2(0.28, 0.28),
  }, 0.30, { uv2Mul: 5.5 });
}

/* -------------------------------------------------------------- 4.6 glass */
function bakeGlass() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const wipe = maskScratches(n, { seed: 133, count: 90, angle: 70, jitter: 60, minLen: 0.15, maxLen: 0.9, minW: 1.5, maxW: 5.0 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const smudge = fbm(u, v, 5, 4, 0.55, 8181);
      const dust = smoothstep(0.90, 0.99, fbm(u, v, 60, 2, 0.5, 1919));
      const w = wipe[i];

      B.h[i] = 0.5 + (smudge - 0.5) * 0.06 + w * 0.03 + dust * 0.08;

      const t = 0.88 + (smudge - 0.5) * 0.05;
      A[p] = t * 232; A[p + 1] = t * 244; A[p + 2] = t * 252; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.035 + smudge * 0.075 + w * 0.10 + dust * 0.35, 0.02, 0.6) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'glass.albedo', true, 0.25),
    orm: upload(commitO(B), 'glass.orm', false, 0.25),
    normal: upload(heightToNormal(B.h, n, 0.55), 'glass.normal', false, 0.25),
  };
  return assemble('glass', maps, {
    __physical: true,
    color: 0xe8f6ff, roughness: 1, metalness: 0,
    transmission: 0.9, thickness: 0.35, ior: 1.45,
    clearcoat: 0.7, clearcoatRoughness: 0.05,
    side: THREE.DoubleSide, envMapIntensity: 1.6,
    specularIntensity: 1.0,
    normalScale: new THREE.Vector2(0.35, 0.35),
  }, 0.25);
}

/* --------------------------------------------------------------- 4.7 lava */
/** Frozen basalt crust with molten channels in the emissive map. The two
 *  scrolling flow layers live in the injected fragment shader (CB_LAVA). */
function bakeLava() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      worley(u, v, 7, 4242);
      const chan = W.f2 - W.f1;
      const molten = 1 - smoothstep(0.0, 0.20, chan);            // 1 in the channel
      worley(u, v, 20, 909);
      const plate = 1 - smoothstep(0.0, 0.08, W.f2 - W.f1);
      const crust = fbm(u, v, 12, 4, 0.55, 3131);
      const soot = fbm(u, v, 30, 3, 0.5, 767);

      B.h[i] = 0.62 - molten * 0.45 - plate * 0.12 + (crust - 0.5) * 0.22 + (soot - 0.5) * 0.06;

      // basalt: near black, warmed slightly at the channel shoulders
      let r = 0.052 + (crust - 0.5) * 0.035;
      let g = 0.044 + (crust - 0.5) * 0.030;
      let b = 0.042 + (crust - 0.5) * 0.028;
      const shoulder = smoothstep(0.35, 0.02, chan) * (1 - molten);
      r = lerp(r, 0.24, shoulder * 0.8); g = lerp(g, 0.10, shoulder * 0.8); b = lerp(b, 0.05, shoulder * 0.8);
      r = lerp(r, 0.16, molten * 0.6); g = lerp(g, 0.055, molten * 0.6); b = lerp(b, 0.03, molten * 0.6);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;

      O[p] = 255;
      O[p + 1] = clamp(0.90 - molten * 0.40 + plate * 0.05 - (crust - 0.5) * 0.14, 0.22, 1) * 255;
      O[p + 2] = 4;
      O[p + 3] = 255;

      // emissive: black crust -> ember -> orange -> yellow -> white core
      const heat = clamp01(molten * (0.72 + 0.45 * crust) + shoulder * 0.16);
      let er, eg, eb;
      if (heat < 0.35) {
        const t = heat / 0.35;
        er = t * 0.42; eg = t * 0.055; eb = t * 0.012;
      } else if (heat < 0.72) {
        const t = (heat - 0.35) / 0.37;
        er = lerp(0.42, 1.0, t); eg = lerp(0.055, 0.42, t); eb = lerp(0.012, 0.045, t);
      } else {
        const t = (heat - 0.72) / 0.28;
        er = 1.0; eg = lerp(0.42, 0.94, t); eb = lerp(0.045, 0.72, t);
      }
      E[p] = er * 255; E[p + 1] = eg * 255; E[p + 2] = eb * 255; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'lava.albedo', true, 0.13),
    orm: upload(commitO(B), 'lava.orm', false, 0.13),
    normal: upload(heightToNormal(B.h, n, 1.6), 'lava.normal', false, 0.13),
    emissive: upload(commitE(B), 'lava.emissive', true, 0.13),
  };
  return assemble('lava', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    emissive: 0xffffff, emissiveIntensity: 3.4,
    normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 0.35,
  }, 0.13, { defines: { CB_LAVA: true } });
}

/* ----------------------------------------------------------- 4.8 obsidian */
/** Volcanic glass: conchoidal fracture facets, near-black, mirror clearcoat. */
function bakeObsidian() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      worley(u, v, 6, 2020);
      const facet = W.f1;
      const facetId = W.id;
      const edge = 1 - smoothstep(0.0, 0.06, W.f2 - W.f1);
      const swirl = warpedFbm(u, v, 8, 4, 0.55, 3, 0.22);

      B.h[i] = 0.5 + (0.5 - facet) * 0.55 - edge * 0.22 + (swirl - 0.5) * 0.08;

      const tone = 0.030 + facetId * 0.016 + (swirl - 0.5) * 0.012;
      // conchoidal sheen leans violet where the facet turns
      const sheen = smoothstep(0.15, 0.55, facet);
      let r = tone + sheen * 0.030;
      let g = tone * 0.94 + sheen * 0.018;
      let b = tone * 1.28 + sheen * 0.058;
      r = lerp(r, 0.012, edge * 0.7); g = lerp(g, 0.012, edge * 0.7); b = lerp(b, 0.016, edge * 0.7);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.10 + edge * 0.30 + (swirl - 0.5) * 0.10, 0.04, 0.6) * 255;
      O[p + 2] = 10;
      O[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'obsidian.albedo', true, 0.35),
    orm: upload(commitO(B), 'obsidian.orm', false, 0.35),
    normal: upload(heightToNormal(B.h, n, 1.3), 'obsidian.normal', false, 0.35),
  };
  return assemble('obsidian', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 1,
    clearcoat: 1.0, clearcoatRoughness: 0.045,
    specularIntensity: 1.0, envMapIntensity: 1.8,
    normalScale: new THREE.Vector2(0.9, 0.9),
  }, 0.35);
}

/* ------------------------------------------------------------ 4.9 crystal */
function bakeCrystal() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      worley(u, v, 5, 6600);
      const facet = W.f1, fid = W.id;
      const seam = 1 - smoothstep(0.0, 0.07, W.f2 - W.f1);
      const vein = ridged(u, v, 7, 4, 0.55, 4242);
      const veinHot = smoothstep(0.58, 0.95, vein);

      B.h[i] = 0.5 + (0.5 - facet) * 0.45 - seam * 0.20 + veinHot * 0.10;

      let r = 0.30 + fid * 0.10, g = 0.44 + fid * 0.10, b = 0.62 + fid * 0.08;
      r = lerp(r, 0.10, seam * 0.6); g = lerp(g, 0.16, seam * 0.6); b = lerp(b, 0.26, seam * 0.6);
      r = lerp(r, 0.85, veinHot * 0.5); g = lerp(g, 0.94, veinHot * 0.5); b = lerp(b, 1.0, veinHot * 0.5);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;

      O[p] = 255;
      O[p + 1] = clamp(0.06 + seam * 0.26 + (1 - facet) * 0.05, 0.03, 0.7) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;

      const core = clamp01(veinHot * 0.9 + (1 - smoothstep(0.0, 0.35, facet)) * 0.35);
      E[p] = core * 255; E[p + 1] = core * 240; E[p + 2] = core * 255; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'crystal.albedo', true, 0.40),
    orm: upload(commitO(B), 'crystal.orm', false, 0.40),
    normal: upload(heightToNormal(B.h, n, 1.4), 'crystal.normal', false, 0.40),
    emissive: upload(commitE(B), 'crystal.emissive', true, 0.40),
  };
  return assemble('crystal', maps, {
    __physical: true,
    color: 0xbcd8ff, roughness: 1, metalness: 0,
    transmission: 0.72, thickness: 1.4, ior: 1.62,
    attenuationColor: new THREE.Color(0x3a7ad0), attenuationDistance: 1.2,
    iridescence: 0.45, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 700],
    emissive: 0x7fd8ff, emissiveIntensity: 1.6,
    clearcoat: 0.5, clearcoatRoughness: 0.08,
    envMapIntensity: 1.7, specularIntensity: 1.0,
    normalScale: new THREE.Vector2(0.9, 0.9),
  }, 0.40);
}

/* --------------------------------------------------------------- 4.10 neon */
/** Dark rubberised housing carrying intense emissive light strips. */
function bakeNeon() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;
  const STRIPS = 3;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const s = frac(v * STRIPS);
      const d = Math.abs(s - 0.5) * 2;
      const core = smoothstep(0.30, 0.10, d);
      const halo = smoothstep(0.80, 0.28, d);
      const housing = 1 - halo;
      const speck = fbm(u, v, 48, 3, 0.5, 3737);
      const dust = fbm(u, v, 7, 4, 0.55, 88);

      B.h[i] = 0.5 + housing * 0.22 - core * 0.24 + (speck - 0.5) * 0.10;

      let r = 0.042 + (dust - 0.5) * 0.020 + speck * 0.020;
      let g = 0.046 + (dust - 0.5) * 0.020 + speck * 0.020;
      let b = 0.056 + (dust - 0.5) * 0.022 + speck * 0.022;
      r = lerp(r, 0.90, core * 0.85); g = lerp(g, 0.94, core * 0.85); b = lerp(b, 1.0, core * 0.85);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;

      O[p] = 255;
      O[p + 1] = clamp(0.55 - core * 0.30 + (speck - 0.5) * 0.16, 0.10, 0.95) * 255;
      O[p + 2] = clamp(0.06 + housing * 0.06, 0, 1) * 255;
      O[p + 3] = 255;

      const e = clamp01(core + halo * 0.22);
      E[p] = e * 255; E[p + 1] = e * 255; E[p + 2] = e * 255; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'neon.albedo', true, 0.5),
    orm: upload(commitO(B), 'neon.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 1.15), 'neon.normal', false, 0.5),
    emissive: upload(commitE(B), 'neon.emissive', true, 0.5),
  };
  return assemble('neon', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    emissive: 0x38e8ff, emissiveIntensity: 3.6,
    normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.7,
  }, 0.5);
}

/* ------------------------------------------------------------- 4.11 hazard */
/** Black/amber chevrons. USES ATTRIBUTE UVs — chevrons point toward +U and the
 *  texture scrolls that way, so builders must run U along the hazard's axis. */
function bakeHazard() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;
  const wear = maskScratches(n, { seed: 909, count: 300, angle: 12, jitter: 50, minLen: 0.05, maxLen: 0.5, minW: 0.6, maxW: 2.4 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      // chevron: shift u by |v - 0.5| so the stripe kinks into an arrow
      const shifted = u + Math.abs(v - 0.5) * 0.9;
      const band = frac(shifted * 4);
      const stripe = smoothstep(0.02, 0.06, band) * smoothstep(0.52, 0.48, band);
      const edge = smoothstep(0.0, 0.045, Math.min(band, Math.abs(band - 0.5)));
      const grime = fbm(u, v, 8, 4, 0.55, 4141);
      const w = wear[i];

      B.h[i] = 0.5 + stripe * 0.10 - (1 - edge) * 0.12 + w * 0.06;

      const amberR = 1.00, amberG = 0.63, amberB = 0.10;
      let r = lerp(0.045, amberR, stripe);
      let g = lerp(0.040, amberG, stripe);
      let b = lerp(0.038, amberB, stripe);
      const k = 0.86 + 0.14 * grime;
      r *= k; g *= k; b *= k;
      r = lerp(r, 0.30, w * 0.55); g = lerp(g, 0.29, w * 0.55); b = lerp(b, 0.27, w * 0.55);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;

      O[p] = 255;
      O[p + 1] = clamp(0.62 - w * 0.24 + (grime - 0.5) * 0.16, 0.15, 0.98) * 255;
      O[p + 2] = clamp(0.10 + w * 0.30, 0, 1) * 255;
      O[p + 3] = 255;

      const e = stripe * (1 - w * 0.5);
      E[p] = e * 255; E[p + 1] = e * 190; E[p + 2] = e * 60; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'hazard.albedo', true, 0.5),
    orm: upload(commitO(B), 'hazard.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 1.05), 'hazard.normal', false, 0.5),
    emissive: upload(commitE(B), 'hazard.emissive', true, 0.5),
  };
  return assemble('hazard', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    emissive: 0xffffff, emissiveIntensity: 1.9,
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.8,
  }, 0.5);
}

/* ------------------------------------------------------------- 4.12 rubber */
function bakeRubber() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      worley(u, v, 22, 5151);
      const pebble = smoothstep(0.55, 0.05, W.f1);
      const micro = fbm(u, v, 64, 3, 0.5, 1717);
      const sheenN = fbm(u, v, 6, 3, 0.55, 313);

      B.h[i] = 0.42 + pebble * 0.34 + (micro - 0.5) * 0.10;

      const t = 0.086 + (sheenN - 0.5) * 0.024 + pebble * 0.030;
      A[p] = t * 255; A[p + 1] = t * 262; A[p + 2] = t * 285; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.94 - pebble * 0.10 + (micro - 0.5) * 0.08, 0.55, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'rubber.albedo', true, 1.1),
    orm: upload(commitO(B), 'rubber.orm', false, 1.1),
    normal: upload(heightToNormal(B.h, n, 1.3), 'rubber.normal', false, 1.1),
  };
  return assemble('rubber', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 0.35,
  }, 1.1);
}

/* ----------------------------------------------------------- 4.13 conveyor */
/** Belt with lateral treads. USES ATTRIBUTE UVs and scrolls toward +V, so
 *  builders must run V along the belt's travel direction. */
function bakeConveyor() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;
  const RIBS = 6;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const rib = frac(v * RIBS);
      const crest = smoothstep(0.12, 0.30, rib) * smoothstep(0.72, 0.54, rib);
      const groove = 1 - crest;
      const grain = fbm(u, v, 40, 3, 0.5, 828);
      const scuff = fbm(u, v, 9, 4, 0.55, 1234);

      // travel arrows sit inside every third rib
      const arrowBand = (Math.floor(v * RIBS) % 3 === 0) ? 1 : 0;
      const ax = Math.abs(u - 0.5);
      const arrow = arrowBand * smoothstep(0.055, 0.02, Math.abs(rib - 0.42 - ax * 0.35)) * smoothstep(0.44, 0.30, ax);

      B.h[i] = 0.42 + crest * 0.30 + (grain - 0.5) * 0.08 + arrow * 0.05;

      let r = 0.072, g = 0.079, b = 0.092;
      r += crest * 0.075 + (scuff - 0.5) * 0.030 + grain * 0.020;
      g += crest * 0.078 + (scuff - 0.5) * 0.030 + grain * 0.020;
      b += crest * 0.086 + (scuff - 0.5) * 0.032 + grain * 0.022;
      r = lerp(r, 0.55, arrow * 0.7); g = lerp(g, 0.80, arrow * 0.7); b = lerp(b, 0.95, arrow * 0.7);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;

      O[p] = 255;
      O[p + 1] = clamp(0.80 - crest * 0.10 + groove * 0.08 + (grain - 0.5) * 0.10, 0.35, 1) * 255;
      O[p + 2] = clamp(0.05 + crest * 0.05, 0, 1) * 255;
      O[p + 3] = 255;

      E[p] = arrow * 120; E[p + 1] = arrow * 220; E[p + 2] = arrow * 255; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'conveyor.albedo', true, 1.0),
    orm: upload(commitO(B), 'conveyor.orm', false, 1.0),
    normal: upload(heightToNormal(B.h, n, 1.4), 'conveyor.normal', false, 1.0),
    emissive: upload(commitE(B), 'conveyor.emissive', true, 1.0),
  };
  return assemble('conveyor', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    emissive: 0xffffff, emissiveIntensity: 1.5,
    normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 0.45,
  }, 1.0);
}

/* --------------------------------------------------------------- 4.14 wood */
function bakeWood() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const PLANKS = 4;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const pi = Math.floor(v * PLANKS);
      const pv = frac(v * PLANKS);
      const off = hash2i(pi, 0, 4141);
      const shade = hash2i(pi, 1, 9191);

      // grain rings: domain-warped, stretched along the plank
      /* ROUND 2: the grain has to run ALONG the plank. `g * 11.0` against
       * `u * 2.0` is a 5.5:1 noise-over-linear ratio, so the level sets closed
       * into loops and every wooden surface in the game wore the same maze of
       * worms (visible full-frame on the verdant sign, _shots/_r2a_verdant.png).
       * Ten whole cycles across the tile keeps the wrap; the noise now only
       * bends them. */
      const g = warpedFbmXY(u + off, pv + off * 3.0, 4, 2, 4, 0.55, 71 + pi * 37, 0.30);
      let ring = frac(g * 2.10 + u * 10.0);   // 10 whole cycles across the tile -> wraps
      ring = Math.abs(ring - 0.5) * 2;
      const grain = smoothstep(0.52, 0.94, ring);

      // occasional knot
      const kx = 0.18 + off * 0.64, ky = 0.5;
      const kd = Math.sqrt((frac(u * 1.0 - kx + 0.5) - 0.5) * (frac(u * 1.0 - kx + 0.5) - 0.5) * 3.2 + (pv - ky) * (pv - ky));
      const knot = (shade > 0.55) ? smoothstep(0.13, 0.03, kd) : 0;

      const seam = 1 - smoothstep(0.0, 0.035, Math.min(pv, 1 - pv));
      const fibre = fbmXY(u, pv, 8, 48, 2, 0.5, 555 + pi);

      B.h[i] = 0.58 - grain * 0.16 - seam * 0.42 - knot * 0.20 + (fibre - 0.5) * 0.07;

      const warm = 0.24 + shade * 0.11;
      let r = warm * 1.62, gg = warm * 1.06, b = warm * 0.60;
      r = lerp(r, r * 0.62, grain); gg = lerp(gg, gg * 0.58, grain); b = lerp(b, b * 0.55, grain);
      r = lerp(r, 0.115, knot * 0.85); gg = lerp(gg, 0.070, knot * 0.85); b = lerp(b, 0.040, knot * 0.85);
      r = lerp(r, 0.045, seam * 0.9); gg = lerp(gg, 0.032, seam * 0.9); b = lerp(b, 0.022, seam * 0.9);
      r += (fibre - 0.5) * 0.035; gg += (fibre - 0.5) * 0.028; b += (fibre - 0.5) * 0.020;

      A[p] = r * 255; A[p + 1] = gg * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.66 + grain * 0.16 + seam * 0.14 + knot * 0.10 - (fibre - 0.5) * 0.10, 0.30, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.60, 3.2, 0.62);

  const maps = {
    map: upload(commitA(B), 'wood.albedo', true, 0.42),
    orm: upload(commitO(B), 'wood.orm', false, 0.42),
    normal: upload(heightToNormal(B.h, n, 1.15), 'wood.normal', false, 0.42),
  };
  return assemble('wood', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(0.95, 0.95), envMapIntensity: 0.45,
  }, 0.42);
}

/* -------------------------------------------------------------- 4.15 cloud */
function bakeCloud() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const billow = 1 - Math.abs(fbm(u, v, 4, 5, 0.55, 3939) * 2 - 1);
      const puff = 1 - Math.abs(fbm(u, v, 11, 4, 0.5, 7373) * 2 - 1);
      const d = clamp01(billow * 0.7 + puff * 0.42);

      B.h[i] = 0.35 + d * 0.55;

      const lit = smoothstep(0.25, 0.95, d);
      const r = lerp(0.640, 0.985, lit);
      const g = lerp(0.700, 0.992, lit);
      const b = lerp(0.800, 1.000, lit);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = 252;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 7, 0.55, 2.4, 0.70);

  const maps = {
    map: upload(commitA(B), 'cloud.albedo', true, 0.16),
    orm: upload(commitO(B), 'cloud.orm', false, 0.16),
    normal: upload(heightToNormal(B.h, n, 0.75), 'cloud.normal', false, 0.16),
  };
  return assemble('cloud', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 0,
    sheen: 1.0, sheenRoughness: 0.85, sheenColor: new THREE.Color(0xdfe9ff),
    transmission: 0.10, thickness: 3.0, ior: 1.05,
    envMapIntensity: 1.1,
    normalScale: new THREE.Vector2(0.55, 0.55),
  }, 0.16);
}

/* ------------------------------------------------------------ 4.16 checker */
/** The readability workhorse: bevelled checker tiles with grunge and scuffs. */
function bakeChecker() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const SQ = 2;
  const scuff = maskScratches(n, { seed: 6060, count: 260, angle: 24, jitter: 70, minLen: 0.04, maxLen: 0.45, minW: 0.5, maxW: 1.8 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const cu = Math.floor(u * SQ), cv = Math.floor(v * SQ);
      const dark = ((cu + cv) & 1) === 1;
      const bevel = panelSeam(u, v, SQ, SQ, 0.020, 0.6);
      const groove = 1 - bevel;
      const grunge = fbm(u, v, 10, 4, 0.55, 1515);
      const micro = fbm(u, v, 55, 3, 0.5, 2424);
      const sc = scuff[i];

      B.h[i] = bevel * 0.55 + (micro - 0.5) * 0.07 - sc * 0.05;

      const base = dark ? 0.155 : 0.700;
      const tintB = dark ? 1.10 : 1.03;
      let r = base * (0.96 + (grunge - 0.5) * 0.14 + micro * 0.05);
      let g = base * (0.99 + (grunge - 0.5) * 0.13 + micro * 0.05);
      let b = base * tintB * (1.0 + (grunge - 0.5) * 0.12 + micro * 0.05);
      r = lerp(r, base * 1.35, sc * 0.4); g = lerp(g, base * 1.35, sc * 0.4); b = lerp(b, base * 1.35, sc * 0.4);
      const lip = smoothstep(0.30, 0.85, bevel) * (1 - smoothstep(0.85, 1.0, bevel));
      r += lip * 0.07; g += lip * 0.075; b += lip * 0.08;
      r = lerp(r, 0.035, groove * 0.85); g = lerp(g, 0.038, groove * 0.85); b = lerp(b, 0.045, groove * 0.85);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.56 + groove * 0.22 - sc * 0.14 + (grunge - 0.5) * 0.14, 0.20, 0.98) * 255;
      O[p + 2] = clamp(0.05 + sc * 0.10, 0, 1) * 255;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.66, 2.8, 0.66);

  const maps = {
    map: upload(commitA(B), 'checker.albedo', true, 0.5),
    orm: upload(commitO(B), 'checker.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 1.2), 'checker.normal', false, 0.5),
  };
  return assemble('checker', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.8,
  }, 0.5);
}

/* ----------------------------------------------------------- 4.17 emissive */
/** Pure light trim: black body, emissive map does all the work. */
function bakeEmissive() {
  const n = SIZE_SM, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const i = y * n + x, p = i * 4;
      const flow = fbm(x / n, v, 5, 3, 0.55, 5959);
      const scan = 0.86 + 0.14 * Math.sin(v * Math.PI * 2 * 8);
      const e = clamp01((0.72 + flow * 0.42) * scan);

      B.h[i] = 0.5 + (flow - 0.5) * 0.12;
      A[p] = 8; A[p + 1] = 9; A[p + 2] = 12; A[p + 3] = 255;
      O[p] = 255; O[p + 1] = 96; O[p + 2] = 0; O[p + 3] = 255;
      E[p] = e * 255; E[p + 1] = e * 255; E[p + 2] = e * 255; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'emissive.albedo', true, 0.5),
    orm: upload(commitO(B), 'emissive.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 0.45), 'emissive.normal', false, 0.5),
    emissive: upload(commitE(B), 'emissive.emissive', true, 0.5),
  };
  return assemble('emissive', maps, {
    color: 0x0a0b10, roughness: 1, metalness: 0,
    emissive: 0xffffff, emissiveIntensity: 2.8,
    normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.2,
  }, 0.5);
}

/* ========================================================================== *
 * 5. the bakes — CRESTBOUND additions (CONTRACT §14)                          *
 * ========================================================================== */

/* --------------------------------------------------------------- 5.1 dirt */
/**
 * Packed earth: clods, embedded pebbles, dry shrinkage cracks and a fine grit
 * layer. This bakes FIRST because it is the slope-blend TARGET of grass, snow
 * and sand — `slopeInject()` reads `dirt.albedo/normal/orm` out of the texture
 * table, so those three keys must be assembled after it exists.
 */
function bakeDirt() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      // big lumps -> clods -> grit, three octave bands so it reads at any range
      const lump = fbm(u, v, 4, 4, 0.55, 6101);
      const clod = fbm(u, v, 13, 4, 0.52, 6217);
      const grit = fbm(u, v, 72, 2, 0.5, 6353);

      // shrinkage cracks: a wide worley network, only where the soil is dry
      worley(u, v, 8, 6449);
      const dry = smoothstep(0.42, 0.78, lump);
      const crack = (1 - smoothstep(0.0, 0.055, W.f2 - W.f1)) * dry;

      // pebbles half-buried in the clods
      worley(u, v, 30, 6571);
      const peb = smoothstep(0.20, 0.045, W.f1) * (hash2i(x >> 3, y >> 3, 6689) > 0.66 ? 1 : 0);
      const pebId = W.id;

      B.h[i] = 0.46 + (lump - 0.5) * 0.42 + (clod - 0.5) * 0.30
             + (grit - 0.5) * 0.10 + peb * 0.26 - crack * 0.34;

      // damp umber in the hollows, dusty ochre on the crowns
      const crown = clamp01((B.h[i] - 0.42) * 2.1);
      let r = lerp(0.132, 0.318, crown);
      let g = lerp(0.098, 0.238, crown);
      let b = lerp(0.068, 0.156, crown);
      r += (clod - 0.5) * 0.075; g += (clod - 0.5) * 0.058; b += (clod - 0.5) * 0.038;
      r += (grit - 0.5) * 0.045; g += (grit - 0.5) * 0.038; b += (grit - 0.5) * 0.028;
      // pebbles are cool grey minerals, not soil
      const pg = 0.30 + pebId * 0.22;
      r = lerp(r, pg * 1.02, peb * 0.85); g = lerp(g, pg, peb * 0.85); b = lerp(b, pg * 0.98, peb * 0.85);
      // crack interiors: wet, dark, in shadow
      r = lerp(r, 0.052, crack * 0.9); g = lerp(g, 0.038, crack * 0.9); b = lerp(b, 0.026, crack * 0.9);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.97 - peb * 0.28 - crown * 0.06 + crack * 0.02, 0.42, 1) * 255;
      O[p + 2] = 3;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 5, 0.56, 3.1, 0.55);

  const maps = {
    map: upload(commitA(B), 'dirt.albedo', true, 0.45),
    orm: upload(commitO(B), 'dirt.orm', false, 0.45),
    normal: upload(heightToNormal(B.h, n, 1.45), 'dirt.normal', false, 0.45),
  };
  return assemble('dirt', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(1.1, 1.1), envMapIntensity: 0.30,
  }, 0.45, detailInject(4.3, 0.40));
}

/* -------------------------------------------------------------- 5.2 grass */
/**
 * The heightfield meadow. Three things happen here that a flat green never
 * does:
 *
 *  1. BLADES. The albedo is an anisotropic streak field (`fbmXY` with a heavy
 *     Y stretch) modulated by a worley CLUMP field, so the meadow reads as
 *     tufts of blades rather than as noise. Every clump gets its own hue draw
 *     from the yellow-to-blue-green axis real turf actually spans.
 *  2. SLOPE BLEND. `CB_SLOPE` mixes the whole material toward `dirt` using the
 *     interpolated WORLD normal, reaching full dirt exactly at
 *     `TUNE.slope.slideDeg`. Brown ground is therefore not decoration: it is
 *     the surface you will slide down, and the player learns that in one look.
 *  3. SUBSURFACE RIM. `CB_RIM` adds a view-dependent wrap term to the indirect
 *     diffuse — grazing light bleeding through a thin blade. It is faded out
 *     by the slope weight (soil does not transmit) and is what stops a big
 *     hill from reading as painted cardboard at the silhouette.
 *
 * ROUND 1 VISUAL FIX — "the meadow reads as REPTILE SCALES"
 * (owner-observed; measured on `_shots/verify_v1.png`, zoom
 * `_shots/_zoom_grass.png`).  Three compounding causes, all here:
 *
 *   a) The worley CLUMP field was pushed hard into the HEIGHT map
 *      (`clumpCore * 0.34` against a blade term of only 0.30), and the height
 *      map became the normal map at strength 1.55 with `normalScale` 1.0.  Each
 *      cell therefore lit as a rounded DOME with a dark seam — a scale.
 *   b) The blade detail that was supposed to break those cells up lived at 128
 *      cells/tile (~1.4 cm at 1.82 m per tile).  It mips away by ~3 m, leaving
 *      ONLY the domes, so the further you looked the more it became lizard skin.
 *   c) 11 clumps/tile put the cell pitch at ~16 cm — close enough to the tile
 *      pitch to read as one regular lattice.
 *
 * The fix keeps the tuft IDEA and moves its energy out of the normal and into
 * colour, adds a MID-frequency streak band (~9 x 34 cells, ~5-20 cm) that
 * SURVIVES mipping and is the thing that actually reads as blades at 3-10 m,
 * and adds a slow macro-patch field so a 140 m meadow varies at metre scale
 * instead of repeating one motif.
 */
function bakeGrass() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      // clumps: which tuft this pixel belongs to, and how tall it stands.
      // 19 cells/tile (~9.5 cm) sits well off the tile pitch, so the cell field
      // never resolves into one regular lattice the way 11 did.
      worley(u, v, 19, 7001);
      const clumpId = W.id;
      const clumpCore = smoothstep(0.52, 0.06, W.f1);
      const clumpGap = 1 - smoothstep(0.0, 0.10, W.f2 - W.f1);

      // MACRO patches: metre-scale drifts of species / dryness / mown-ness.
      // This is what stops a 140 m meadow from being one motif repeated.
      const patch = fbm(u, v, 2.5, 3, 0.55, 7601);
      const patch2 = fbm(u, v, 5, 2, 0.5, 7643);

      /* BLADES — and the ROUND 3 fix for the shared streak bug.
       *
       * Owner-observed (`_shots/_vz_grass.png`, and the same artifact on the
       * Keep floor): the ground under the blades was a field of long unbroken
       * HORIZONTAL hairline streaks running continuously across many metres.
       * The cause is the same in both materials: a strongly ANISOTROPIC,
       * AXIS-ALIGNED, seamlessly TILEABLE noise field is a set of parallel
       * lines that reconnect to themselves at every tile edge, so a 5:1
       * stretch (26 x 128 cells) becomes an infinite streak in world space —
       * and mipping makes it worse, because the high-frequency axis is the
       * first thing to average away, leaving only the long one.
       *
       * The fix is to remove the SHARED DIRECTION, not the anisotropy: two
       * orthogonal streak fields (one stretched along U, one along V), each
       * still exactly tileable, cross-faded by the per-clump id. Blade
       * direction therefore changes every ~9.5 cm worley cell, so no direction
       * survives averaging over a metre and there is no line to run. The
       * stretch is also pulled from 4.9:1 to 3.2:1, which is what a blade
       * actually is at 3-10 m. */
      const tilt = (clumpId - 0.5) * 0.55;
      const dir = clumpId;                       // 0 = along U, 1 = along V
      // MID band (~5-20 cm) — the only blade signal that survives mipping at
      // 3-10 m, and therefore the one that has to carry "grass" in the shot.
      const tuftA = fbmXY(u + v * tilt, v, 12, 30, 2, 0.55, 7513);
      const tuftB = fbmXY(u, v + u * tilt, 30, 12, 2, 0.55, 7517);
      const tuft = lerp(tuftA, tuftB, dir);
      const bladeA = fbmXY(u + v * tilt, v, 30, 96, 2, 0.5, 7103);
      const bladeB = fbmXY(u, v + u * tilt, 96, 30, 2, 0.5, 7109);
      const blades = lerp(bladeA, bladeB, dir);
      const microA = vnoiseXY((u + v * tilt) * 112, v * 288, 112, 288, 7211);
      const microB = vnoiseXY(u * 288, (v + u * tilt) * 112, 288, 112, 7213);
      const microBlade = lerp(microA, microB, dir);
      const bladeH = tuft * 0.42 + blades * 0.40 + microBlade * 0.18;

      // thatch: dead matter at the base, visible in the gaps between tufts
      const thatch = fbm(u, v, 20, 3, 0.55, 7307);
      const litter = smoothstep(0.55, 0.9, thatch) * clumpGap;

      // Height is now BLADE-led, not cell-led: the clump keeps a hint of relief
      // so tufts still catch a rim, but it can no longer emboss a dome.
      B.h[i] = 0.42 + clumpCore * 0.10 + (bladeH - 0.5) * 0.50
             - clumpGap * 0.06 + (thatch - 0.5) * 0.07;

      // hue axis: 0 = dry yellow-green, 1 = deep blue-green. The macro patch
      // drives it as hard as the clump does, so colour varies at BOTH scales.
      const hue = clamp01(0.20 + clumpId * 0.34 + (patch - 0.5) * 0.85
                          + (patch2 - 0.5) * 0.30 + (tuft - 0.5) * 0.30);
      /* ROUND 2 VISUAL — the ground half of the "blades read as decals" fix
       * (see terrain.js SURFACE_LOOK). Measured on `_shots/verdant-1/spawn.png`
       * the near-field sward floor rendered at [51,86,44]; a sunlit lawn sits
       * nearer [90,120,55]. The bake was carrying a SOIL value with grass hue
       * on it, so every instanced blade laid over it read as a sticker. Lifted
       * ~20 % and the hue axis widened at the same time (the dry end goes
       * further yellow, the lush end further blue-green), so the meadow gains
       * value AND the macro patch field gains something to vary. */
      let r = lerp(0.372, 0.132, hue);
      let g = lerp(0.492, 0.388, hue);
      let b = lerp(0.128, 0.176, hue);
      // blade tips catch light, blade roots go dark and cool
      const tipLit = smoothstep(0.44, 0.92, bladeH) * (0.42 + 0.58 * clumpCore);
      r += tipLit * 0.150; g += tipLit * 0.225; b += tipLit * 0.080;
      const root = smoothstep(0.42, 0.02, bladeH);
      r = lerp(r, 0.052, root * 0.45); g = lerp(g, 0.086, root * 0.45); b = lerp(b, 0.040, root * 0.45);
      // straw litter in the gaps — dry patches, driven by the macro field too
      const dry = clamp01(litter * 0.7 + smoothstep(0.62, 0.95, patch) * 0.35);
      r = lerp(r, 0.318, dry); g = lerp(g, 0.276, dry); b = lerp(b, 0.128, dry);
      // rare clover / flower fleck — one pixel in ~1500, enough to sparkle
      const fl = hash2i(x, y, 7411);
      if (fl > 0.99935) { r = 0.92; g = 0.90; b = 0.66; }
      else if (fl < 0.00035) { r = 0.62; g = 0.32; b = 0.60; }

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      /* ROUND 4 (critic, `_shots/verdant-1/vista-se.png`: "untextured saturated
       * green with a rubbery specular sheen across 100+ m of hillside"). At
       * range the normal map mips flat and the ONLY thing left varying across
       * a hillside is the specular lobe, so a 0.34 roughness floor turned the
       * far meadow into wet plastic. Grass is a matte, scattering surface; the
       * gloss belongs on the near blades and nowhere else. */
      O[p + 1] = clamp(0.93 - tipLit * 0.14 + root * 0.06 + litter * 0.04, 0.66, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.40, 3.6, 0.42);

  /* 0.55 -> 0.72 uv/m (1.82 m -> 1.39 m per tile). A SMALLER tile with a
   * blade-led normal reads as finer turf; the old big tile was what made the
   * surviving low-frequency cells legible as individual plates. */
  const maps = {
    map: upload(commitA(B), 'grass.albedo', true, 0.72),
    orm: upload(commitO(B), 'grass.orm', false, 0.72),
    normal: upload(heightToNormal(B.h, n, 0.85), 'grass.normal', false, 0.72),
  };
  return assemble('grass', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    // 0.35 -> 0.14: the sky reflection WAS the sheen on the distant hills.
    normalScale: new THREE.Vector2(0.58, 0.58), envMapIntensity: 0.14,
    /* MACRO, ROUND 4. The old cell was 9.5 m — about eight screen pixels on a
     * hill 120 m out, so aniso/mip averaged it to nothing exactly where the
     * critic was looking. 26 m survives the mip chain at range and still reads
     * as weather rather than as tiling up close, and the amplitude goes up
     * with it because this is now the only albedo variation the far field has. */
  }, 0.72, macroInject(26.0, 0.46, 0.15, 0.42, detailInject(5.3, 0.55, slopeInject({
    defines: { CB_SLOPE: true, CB_RIM: true },
    uniforms: {
      uCbBlendMap: { value: _tex.get('dirt.albedo') || null },
      uCbBlendNormal: { value: _tex.get('dirt.normal') || null },
      uCbBlendOrm: { value: _tex.get('dirt.orm') || null },
      uCbBlendScale: { value: 0.82 },
      uCbSlope: { value: new THREE.Vector2(SLOPE_START, SLOPE_END) },
      // rgb = transmitted tint, a = strength
      // rim translucency halved: at 100 m every hillside was rimmed at once,
      // which reads as a uniform green glaze, not as light through a blade.
      uCbRim: { value: new THREE.Vector4(0.42, 0.72, 0.22, 0.28) },
    },
  }))));
}

/* --------------------------------------------------------------- 5.3 snow */
/**
 * Wind-packed drifts. The body is soft and almost normal-free (snow has no
 * texture at grazing light, only shape); the LIFE is in the clearcoat sparkle
 * layer: a very high-frequency facet normal at `uv2Mul` frequency, so the
 * surface throws hard little specular glints that swim as the camera moves.
 * Slope-blends to dirt exactly like grass — a snow slope that is about to
 * slide shows its rock.
 */
function bakeSnow() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const drift = fbm(u, v, 3, 4, 0.58, 8101);
      // sastrugi: wind ripples, stretched across the prevailing wind
      const wind = fbmXY(u, v, 40, 7, 3, 0.5, 8209);
      const crust = fbm(u, v, 26, 3, 0.5, 8317);
      const crumb = fbm(u, v, 96, 2, 0.5, 8419);
      // footprint-scale pocks where the crust has broken through
      worley(u, v, 16, 8527);
      const pock = smoothstep(0.18, 0.03, W.f1) * (hash2i(x >> 4, y >> 4, 8623) > 0.80 ? 1 : 0);

      B.h[i] = 0.5 + (drift - 0.5) * 0.62 + (wind - 0.5) * 0.20
             + (crumb - 0.5) * 0.05 - pock * 0.30;

      // white body; the shadowed lows go blue because snow scatters blue deep
      const low = clamp01((0.5 - B.h[i]) * 1.9);
      let r = 0.955 - low * 0.150;
      let g = 0.972 - low * 0.095;
      let b = 0.998 - low * 0.030;
      // crust plates read very slightly warmer than fresh powder
      const plate = smoothstep(0.62, 0.9, crust);
      r += plate * 0.014; g += plate * 0.008; b -= plate * 0.006;
      // exposed grit at the bottom of a deep pock
      r = lerp(r, 0.40, pock * 0.30); g = lerp(g, 0.42, pock * 0.30); b = lerp(b, 0.46, pock * 0.30);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      // packed crust is smoother than powder; the glints come from the coat
      O[p + 1] = clamp(0.72 - plate * 0.26 + low * 0.10, 0.26, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 7, 0.60, 2.2, 0.72);

  // --- the sparkle layer: hard facets at ~14x the body frequency -----------
  const ns = SIZE_MD;
  const sparkH = new Float32Array(ns * ns);
  for (let y = 0; y < ns; y++) {
    for (let x = 0; x < ns; x++) {
      const u = x / ns, v = y / ns, i = y * ns + x;
      worley(u, v, 34, 8731);
      // only a minority of crystals are oriented to flash: gate hard
      const flash = (hash2i(Math.floor(u * 34), Math.floor(v * 34), 8837) > 0.62) ? 1 : 0;
      sparkH[i] = smoothstep(0.34, 0.0, W.f1) * flash * 0.85 + fbm(u, v, 110, 2, 0.5, 8941) * 0.15;
    }
  }

  const maps = {
    map: upload(commitA(B), 'snow.albedo', true, 0.28),
    orm: upload(commitO(B), 'snow.orm', false, 0.28),
    normal: upload(heightToNormal(B.h, n, 0.90), 'snow.normal', false, 0.28),
    clearcoatNormal: upload(heightToNormal(sparkH, ns, 2.4), 'snow.sparkle', false, 1.0),
  };
  return assemble('snow', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 0,
    sheen: 0.55, sheenRoughness: 0.65, sheenColor: new THREE.Color(0xcfe4ff),
    clearcoat: 0.75, clearcoatRoughness: 0.10,
    specularIntensity: 0.85, envMapIntensity: 0.85,
    normalScale: new THREE.Vector2(0.75, 0.75),
    clearcoatNormalScale: new THREE.Vector2(0.55, 0.55),
  }, 0.28, detailInject(6.0, 0.30, slopeInject({
    uv2Mul: 14.0,
    uniforms: {
      uCbBlendMap: { value: _tex.get('dirt.albedo') || null },
      uCbBlendNormal: { value: _tex.get('dirt.normal') || null },
      uCbBlendOrm: { value: _tex.get('dirt.orm') || null },
      uCbBlendScale: { value: 1.6 },
      uCbSlope: { value: new THREE.Vector2(SLOPE_START, SLOPE_END) },
    },
  })));
}

/* --------------------------------------------------------------- 5.4 sand */
/**
 * Wind-rippled dune sand, mica flecks, damp patches. Slope-blends to dirt
 * (a sand slope steeper than the slide angle shows the rock under it) and
 * carries the CAUSTIC injection: `water.js` writes `uCbCaustic` (surfaceY,
 * strength, scale, speed) on this key's shared uniforms, and every sand
 * surface BELOW that height picks up the moving light of the water above it.
 */
function bakeSand() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const drift = fbm(u, v, 4, 4, 0.55, 2626);
      const rippleP = u * 14 + (drift - 0.5) * 7 + v * 3.0;
      const ripple = 0.5 + 0.5 * Math.sin(rippleP * Math.PI * 2);
      const grit = fbm(u, v, 90, 2, 0.5, 4747);
      const damp = smoothstep(0.62, 0.86, fbm(u, v, 7, 3, 0.55, 1010));

      // the wind-ripple field DOMINATES the height: under a flat fill a dune
      // whose structure lives only in the albedo reads as uniform speckle.
      B.h[i] = 0.5 + (drift - 0.5) * 0.40 + (ripple - 0.5) * 0.34 + (grit - 0.5) * 0.10;

      let r = 0.560, g = 0.462, b = 0.318;
      const shade = (ripple - 0.5) * 2;               // -1 trough .. +1 crest
      r += (drift - 0.5) * 0.14 + shade * 0.075 + (grit - 0.5) * 0.05;
      g += (drift - 0.5) * 0.12 + shade * 0.062 + (grit - 0.5) * 0.045;
      b += (drift - 0.5) * 0.085 + shade * 0.040 + (grit - 0.5) * 0.035;
      r = lerp(r, r * 0.58, damp); g = lerp(g, g * 0.56, damp); b = lerp(b, b * 0.58, damp);
      // mica sparkle
      if (hash2i(x, y, 8181) > 0.9955) { r = 1.0; g = 0.98; b = 0.90; }

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.95 - damp * 0.22 + (grit - 0.5) * 0.06, 0.45, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'sand.albedo', true, 0.55),
    orm: upload(commitO(B), 'sand.orm', false, 0.55),
    normal: upload(heightToNormal(B.h, n, 1.6), 'sand.normal', false, 0.55),
  };
  return assemble('sand', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(1.15, 1.15), envMapIntensity: 0.5,
  }, 0.55, detailInject(4.1, 0.45, slopeInject({
    defines: { CB_SLOPE: true, CB_CAUSTIC: true },
    uniforms: {
      uCbBlendMap: { value: _tex.get('dirt.albedo') || null },
      uCbBlendNormal: { value: _tex.get('dirt.normal') || null },
      uCbBlendOrm: { value: _tex.get('dirt.orm') || null },
      uCbBlendScale: { value: 1.1 },
      uCbSlope: { value: new THREE.Vector2(SLOPE_START, SLOPE_END) },
      /* Caustics. `uCbCaustic` is a plain float strength so water.js's
       * `linkCaustics(mats, 'sand', strength)` drives it directly; the geometry
       * of the effect lives in `uCbCausticParams` (waterSurfaceY, worldScale,
       * speed, unused) and the clock is its own uniform object so water.js may
       * swap in the water clock. Prefer `Mats.setCaustics('sand', {...})`. */
      uCbCaustic: { value: 0 },
      uCbCausticParams: { value: new THREE.Vector4(-1e9, 0.55, 0.9, 0) },
      uCbCausticColor: { value: new THREE.Color(0.55, 0.86, 0.92) },
      uCbCausticTime: TIME_U,
    },
  })));
}

/* ------------------------------------------------------------ 5.5 plaster */
/**
 * THE KEEP'S WALLS. Warm off-white lime plaster over rubble: trowel strokes
 * (a low-frequency directional warp), a fine craze-crack network, patches
 * where a chip has flaked off to show the ochre render beneath, and slow
 * colour variation so a 20 m hall never reads as one flat fill.
 */
function bakePlaster() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const trowel = maskScratches(n, { seed: 9101, count: 130, angle: 24, jitter: 30, minLen: 0.25, maxLen: 1.10, minW: 3.0, maxW: 9.0 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const tone = fbm(u, v, 3, 4, 0.58, 9203);          // slow colour variation
      const tooth = fbm(u, v, 58, 3, 0.5, 9311);         // lime tooth / aggregate
      const tr = trowel[i];

      // craze cracks: two worley scales, the fine one only inside the coarse
      worley(u, v, 7, 9419);
      const crackA = 1 - smoothstep(0.0, 0.030, W.f2 - W.f1);
      worley(u, v, 19, 9521);
      const crackB = (1 - smoothstep(0.0, 0.022, W.f2 - W.f1)) * smoothstep(0.35, 0.75, tone);
      const crack = clamp01(crackA * 0.85 + crackB * 0.55);

      // flakes: rounded chips where the top coat has come away
      worley(u, v, 12, 9629);
      const flake = smoothstep(0.24, 0.14, W.f1) * (hash2i(x >> 5, y >> 5, 9733) > 0.79 ? 1 : 0);

      B.h[i] = 0.56 + (tone - 0.5) * 0.22 + tr * 0.10 + (tooth - 0.5) * 0.10
             - crack * 0.26 - flake * 0.30;

      // warm off-white; the render under a flake is ochre
      let r = 0.760 + (tone - 0.5) * 0.115 + tr * 0.035;
      let g = 0.716 + (tone - 0.5) * 0.098 + tr * 0.032;
      let b = 0.632 + (tone - 0.5) * 0.078 + tr * 0.026;
      r += (tooth - 0.5) * 0.045; g += (tooth - 0.5) * 0.042; b += (tooth - 0.5) * 0.040;
      // soot / age bloom low in the tile, the way a hall wall darkens
      const age = smoothstep(0.30, 0.78, fbm(u, v, 5, 3, 0.55, 9841));
      r = lerp(r, r * 0.80, age * 0.45); g = lerp(g, g * 0.79, age * 0.45); b = lerp(b, b * 0.80, age * 0.45);
      // crack lines and flake floors
      r = lerp(r, 0.318, crack * 0.75); g = lerp(g, 0.286, crack * 0.75); b = lerp(b, 0.244, crack * 0.75);
      r = lerp(r, 0.520, flake * 0.85); g = lerp(g, 0.388, flake * 0.85); b = lerp(b, 0.234, flake * 0.85);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.90 - tr * 0.10 + crack * 0.05 + flake * 0.06, 0.55, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.66, 2.6, 0.66);

  const maps = {
    map: upload(commitA(B), 'plaster.albedo', true, 0.68),
    orm: upload(commitO(B), 'plaster.orm', false, 0.68),
    normal: upload(heightToNormal(B.h, n, 1.05), 'plaster.normal', false, 0.68),
  };
  return assemble('plaster', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(0.85, 0.85), envMapIntensity: 0.40,
  }, 0.68, faceInject(0.29));
}

/* -------------------------------------------------------------- 5.6 brick */
/** Running-bond fired brick: recessed lime mortar, per-brick colour draw from
 *  a kiln range, chipped arrises, and efflorescence bloom on the mortar. */
function bakeBrick() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const COURSES = 6;                 // brick rows per tile
  const PER_ROW = 3;                 // bricks per row (2:1 aspect w/ 6 courses)
  const MORTAR = 0.055;              // fraction of a brick that is joint

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const row = Math.floor(v * COURSES);
      const rowV = frac(v * COURSES);
      // running bond: alternate rows shift by half a brick
      const shift = (row & 1) ? 0.5 : 0.0;
      const col = Math.floor(u * PER_ROW + shift);
      const colU = frac(u * PER_ROW + shift);

      // distance (in brick-local units) to the nearest joint
      const dV = Math.min(rowV, 1 - rowV);
      const dU = Math.min(colU, 1 - colU);
      const joint = Math.min(dV, dU * (COURSES / PER_ROW) * 0.5);
      const face = smoothstep(MORTAR * 0.6, MORTAR * 1.7, joint);   // 1 on the brick
      const mortar = 1 - face;

      const id = hash2i(col, row, 10111);
      const id2 = hash2i(col, row, 10223);
      const grain = fbm(u * 3.1 + id, v * 3.1 + id2, 30, 3, 0.5, 10331);
      const blotch = fbm(u * 2.0 + id * 5, v * 2.0 + id2 * 5, 8, 4, 0.55, 10429);

      // chipped arris: bite out of the brick corners
      const corner = smoothstep(0.16, 0.02, Math.sqrt(dU * dU + dV * dV));
      const chip = corner * smoothstep(0.55, 0.9, hash2i(col * 7 + (dU > dV ? 1 : 0), row * 5, 10531));

      B.h[i] = face * (0.62 + (blotch - 0.5) * 0.16 + (grain - 0.5) * 0.10)
             + mortar * 0.16 - chip * 0.26;

      // kiln range: rose -> rust -> iron-spotted plum
      const kiln = clamp01(id * 0.7 + blotch * 0.5);
      let r = lerp(0.398, 0.246, kiln);
      let g = lerp(0.176, 0.128, kiln);
      let b = lerp(0.126, 0.126, kiln);
      r += (grain - 0.5) * 0.070; g += (grain - 0.5) * 0.042; b += (grain - 0.5) * 0.034;
      // sand-struck face flecks
      if (hash2i(x, y, 10639) > 0.992) { r += 0.16; g += 0.13; b += 0.10; }
      // chip exposes raw, paler body
      r = lerp(r, 0.470, chip * 0.7); g = lerp(g, 0.276, chip * 0.7); b = lerp(b, 0.206, chip * 0.7);

      // mortar: grey lime with efflorescence bloom
      const eff = smoothstep(0.55, 0.9, fbm(u, v, 11, 3, 0.55, 10739));
      const mr = lerp(0.508, 0.735, eff), mg = lerp(0.494, 0.730, eff), mb = lerp(0.452, 0.715, eff);
      r = lerp(r, mr, mortar); g = lerp(g, mg, mortar); b = lerp(b, mb, mortar);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.80 + mortar * 0.16 - (grain - 0.5) * 0.12 + chip * 0.08, 0.42, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 5, 0.58, 3.2, 0.54);

  const maps = {
    map: upload(commitA(B), 'brick.albedo', true, 1.05),
    orm: upload(commitO(B), 'brick.orm', false, 1.05),
    normal: upload(heightToNormal(B.h, n, 1.50), 'brick.normal', false, 1.05),
  };
  return assemble('brick', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(1.15, 1.15), envMapIntensity: 0.38,
  }, 1.05, faceInject(0.31));
}

/* --------------------------------------------------------------- 5.7 bark */
/**
 * Tree bark. ATTRIBUTE UVs: V runs ALONG the trunk, U around it, so the
 * fissures are vertical on every trunk regardless of how the builder scaled
 * it. `ridgedXY` with a heavy V stretch gives the deep vertical cracks;
 * lichen sits in flat worley patches on the ridges.
 */
function bakeBark() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      // deep vertical fissures — wide in U, long in V
      const fis = ridgedXY(u, v, 14, 3, 4, 0.55, 11003);
      // plate structure between them
      const plate = warpedFbmXY(u, v, 20, 6, 3, 0.5, 11113, 0.22);
      const grain = fbmXY(u, v, 34, 96, 2, 0.5, 11213);

      // lichen: flat pale patches, only on the ridges (where light reaches)
      worley(u, v, 9, 11321);
      const ridgeMask = smoothstep(0.34, 0.72, fis);
      const lich = smoothstep(0.30, 0.10, W.f1) * ridgeMask
                 * (hash2i(Math.floor(u * 9), Math.floor(v * 9), 11423) > 0.58 ? 1 : 0);

      B.h[i] = 0.44 + fis * 0.46 + (plate - 0.5) * 0.22 + (grain - 0.5) * 0.08 - lich * 0.04;

      /* ROUND 4 — BARK WAS BLACK, NOT DARK (critic, `_shots/verdant-1/spawn.png`:
       * "the two rock formations flanking the frame are near-black untextured
       * slabs with a plastic highlight, the darkest thing in a bright morning
       * frame; they read as holes cut in the world"). They are not rocks: a
       * raycast through those two screen columns at the spawn station returns
       * `merged_cb.bark.verdant` at 10.0 m and 11.8 m, and the frame samples
       * [25,28,24] and [31,28,19] there. The cause is right here — the fissure
       * end of the albedo ramp was sRGB 0.062, i.e. 16/255, which is BELOW
       * charcoal. No key, fill, hemi or ambient can rescue an albedo that dark,
       * and the whole trunk therefore rendered as a silhouette with only the
       * specular lobe on it — which is exactly the "plastic highlight".
       * Real bark sits around sRGB 0.18 (wet crevice) to 0.52 (sunlit ridge).
       * The RANGE is kept — bark is a high-contrast material — it is the FLOOR
       * that moves. */
      const lit = clamp01(fis * 1.25);
      let r = lerp(0.190, 0.520, lit);
      let g = lerp(0.152, 0.432, lit);
      let b = lerp(0.118, 0.334, lit);
      /* variation scales with the lifted range, so the trunk is TEXTURED at the
       * new value rather than merely brighter. */
      r += (plate - 0.5) * 0.120; g += (plate - 0.5) * 0.100; b += (plate - 0.5) * 0.078;
      r += (grain - 0.5) * 0.064; g += (grain - 0.5) * 0.056; b += (grain - 0.5) * 0.044;
      // lichen: pale sage green-grey
      r = lerp(r, 0.470, lich * 0.75); g = lerp(g, 0.516, lich * 0.75); b = lerp(b, 0.398, lich * 0.75);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      // roughness floor up: bark has no gloss lobe at all, and the one it had
      // was the only thing legible on the black trunk.
      O[p + 1] = clamp(0.96 - lich * 0.04 - lit * 0.05, 0.80, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.50, 3.8, 0.46);

  const maps = {
    map: upload(commitA(B), 'bark.albedo', true, 0.70),
    orm: upload(commitO(B), 'bark.orm', false, 0.70),
    normal: upload(heightToNormal(B.h, n, 1.85), 'bark.normal', false, 0.70),
  };
  return assemble('bark', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    // env down with the roughness: a trunk must not mirror the sky.
    normalScale: new THREE.Vector2(1.25, 1.25), envMapIntensity: 0.16,
    /* ROUND 5. 0.70 = a 1.43 m tile. That was authored against trunks whose
     * radius was the course file's `r` (2-3.7 m, i.e. 15-23 m of circumference,
     * so ~12 repeats and every one of them stretched) — see the trunk note in
     * builders.js buildTree, which now derives the bole from the HEIGHT. Round
     * a 0.8 m bole, 1.43 m of tile is TWO repeats and the plates read as metre-
     * wide slabs. 1.55 = 0.65 m per tile, which is what bark plating is. */
  }, 1.55);
}

/* ------------------------------------------------------------- 5.8 leaves */
/**
 * The canopy CARD: an alpha-tested cluster of individual leaves with midribs
 * and side veins, laid out on a 0..1 quad whose `uv.y = 0` is the branch and
 * `uv.y = 1` the tip. `CB_WIND` pivots the card about that root in the vertex
 * shader (amplitude ∝ uv.y², so the branch end never detaches), which is what
 * makes a tree look alive from 40 m for the price of one extra vertex op.
 *
 * ALPHA TEST, not blend: canopies overlap constantly and a blended canopy
 * needs per-triangle sorting nobody can afford. `alphaTest` also keeps the
 * leaves in the shadow map, which is where the dappled ground light comes
 * from.
 */
function bakeLeaves() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, M = B.imgM.data;
  const LEAVES = 34;

  // scatter leaf instances over the card, denser toward the tip
  const rnd = mulberry32(12007);
  const lx = new Float32Array(LEAVES), ly = new Float32Array(LEAVES);
  const la = new Float32Array(LEAVES), lr = new Float32Array(LEAVES);
  const lh = new Float32Array(LEAVES);
  for (let k = 0; k < LEAVES; k++) {
    lx[k] = rnd();
    ly[k] = 0.10 + Math.pow(rnd(), 0.72) * 0.88;
    la[k] = (rnd() * 2 - 1) * 1.35 + Math.PI * 0.5;   // roughly radial, jittered
    lr[k] = 0.085 + rnd() * 0.075;
    lh[k] = rnd();                                     // per-leaf hue draw
  }

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      let cover = 0, hue = 0, vein = 0, depth = 0, best = 0;
      for (let k = 0; k < LEAVES; k++) {
        // shortest offset on the U axis so the card tiles horizontally
        let du = u - lx[k]; du -= Math.round(du);
        const dv = v - ly[k];
        const ca = Math.cos(la[k]), sa = Math.sin(la[k]);
        // rotate into leaf space; the leaf is an ellipse pinched at both ends
        const ex = (du * ca + dv * sa) / lr[k];
        const ey = (-du * sa + dv * ca) / (lr[k] * 0.44);
        const rr = ex * ex + ey * ey;
        if (rr > 1.6) continue;
        // pointed ovate outline: narrow the ellipse toward the tip
        const taper = 1.0 - 0.55 * clamp01(ex * 0.5 + 0.5);
        const edge = Math.sqrt(ex * ex + (ey / Math.max(0.25, taper)) * (ey / Math.max(0.25, taper)));
        // serrated margin
        const serr = 0.055 * Math.sin(ex * 17.0 + k * 2.3);
        const inside = smoothstep(1.0 + serr, 0.94 + serr, edge);
        if (inside <= 0.001) continue;

        cover = Math.max(cover, inside);
        const z = 0.2 + lh[k] * 0.8;
        if (inside * z > best) {
          best = inside * z;
          hue = lh[k];
          depth = z;
          // midrib + side veins in leaf space
          const mid = smoothstep(0.075, 0.0, Math.abs(ey));
          const side = smoothstep(0.85, 1.0, Math.abs(Math.sin(ex * 9.0 + ey * 5.5)))
                     * smoothstep(1.0, 0.55, edge);
          vein = clamp01(mid * 0.9 + side * 0.45);
        }
      }

      const fuzz = fbm(u, v, 46, 3, 0.5, 12101);
      B.h[i] = cover * (0.52 + depth * 0.30 + vein * 0.22 + (fuzz - 0.5) * 0.10);

      // hue axis: 0 = fresh yellow-green (new growth), 1 = deep shade green
      let r = lerp(0.238, 0.062, hue);
      let g = lerp(0.372, 0.216, hue);
      let b = lerp(0.086, 0.098, hue);
      // depth shading: leaves further back in the cluster fall into shadow
      const dk = lerp(0.52, 1.0, depth);
      r *= dk; g *= dk; b *= dk;
      // veins are pale and slightly yellow
      r = lerp(r, r * 1.55 + 0.055, vein * 0.75);
      g = lerp(g, g * 1.42 + 0.070, vein * 0.75);
      b = lerp(b, b * 1.20 + 0.020, vein * 0.75);
      r += (fuzz - 0.5) * 0.030; g += (fuzz - 0.5) * 0.038; b += (fuzz - 0.5) * 0.020;

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = clamp(0.74 - vein * 0.16 + (1 - depth) * 0.12, 0.28, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;

      const a = clamp01(cover * 1.35) * 255;
      M[p] = a; M[p + 1] = a; M[p + 2] = a; M[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'leaves.albedo', true, 1.0),
    orm: upload(commitO(B), 'leaves.orm', false, 1.0),
    normal: upload(heightToNormal(B.h, n, 1.30), 'leaves.normal', false, 1.0),
    alpha: upload(commitM(B), 'leaves.alpha', false, 1.0),
  };
  return assemble('leaves', maps, {
    color: 0xffffff, roughness: 1, metalness: 0,
    alphaTest: 0.45, transparent: false, side: THREE.DoubleSide,
    normalScale: new THREE.Vector2(0.85, 0.85), envMapIntensity: 0.45,
  }, 1.0, {
    box: false,
    defines: { CB_WIND: true, CB_RIM: true, CB_FOLIAGE: true },
    uniforms: {
      uCbWind: { value: 0.085 },
      uCbRim: { value: new THREE.Vector4(0.52, 0.78, 0.26, 0.95) },
    },
  });
}

/* --------------------------------------------------------------- 5.9 gold */
/**
 * CREST AND COIN METAL. Hammered planishing facets + a fine brushed
 * micro-scratch field oriented on one axis, so the environment highlight
 * STRETCHES across the facet the way a real anisotropic polish does — the
 * cheapest convincing "precious metal" there is without a full anisotropy
 * BRDF. ATTRIBUTE UVs: coins spin, and a world-space projection would make
 * the texture swim across a rotating object.
 */
function bakeGold() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const brush = maskScratches(n, { seed: 13001, count: 700, angle: 0, jitter: 2.0, minLen: 0.6, maxLen: 2.0, minW: 0.4, maxW: 0.9 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      // planishing: shallow hammer dishes
      worley(u, v, 9, 13109);
      const dish = smoothstep(0.60, 0.0, W.f1);
      const facetEdge = 1 - smoothstep(0.0, 0.055, W.f2 - W.f1);
      const bl = brush[i];
      const tarn = fbm(u, v, 6, 4, 0.55, 13217);         // slow tarnish drift

      B.h[i] = 0.5 + dish * 0.24 - facetEdge * 0.20 + bl * 0.045 + (tarn - 0.5) * 0.05;

      // rich yellow gold; the tarnish drift shifts it toward rose/old gold
      let r = 1.000, g = 0.775, b = 0.336;
      r = lerp(r, 0.905, tarn * 0.55); g = lerp(g, 0.622, tarn * 0.55); b = lerp(b, 0.262, tarn * 0.55);
      // facet edges catch a hard white highlight
      r += facetEdge * 0.045; g += facetEdge * 0.055; b += facetEdge * 0.075;
      r += bl * 0.030; g += bl * 0.032; b += bl * 0.036;

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p] = 255;
      // the brushed field is the anisotropy: roughness banded along one axis
      O[p + 1] = clamp(0.25 - bl * 0.14 + facetEdge * 0.16 + (tarn - 0.5) * 0.08, 0.06, 0.62) * 255;
      O[p + 2] = 255;                                     // metalness 1 everywhere
      O[p + 3] = 255;
    }
  }

  // clearcoat sparkle: fine scratch normals perpendicular to the brush, so the
  // env highlight elongates instead of staying a round blob
  const ns = SIZE_MD;
  const aniso = maskScratches(ns, { seed: 13323, count: 900, angle: 0, jitter: 1.5, minLen: 0.8, maxLen: 2.0, minW: 0.35, maxW: 0.8 });
  const anisoH = new Float32Array(ns * ns);
  for (let i = 0; i < anisoH.length; i++) anisoH[i] = aniso[i];

  const maps = {
    map: upload(commitA(B), 'gold.albedo', true, 0.60),
    orm: upload(commitO(B), 'gold.orm', false, 0.60),
    normal: upload(heightToNormal(B.h, n, 0.95), 'gold.normal', false, 0.60),
    clearcoatNormal: upload(heightToNormal(anisoH, ns, 2.2), 'gold.aniso', false, 0.60),
  };
  return assemble('gold', maps, {
    __physical: true,
    color: 0xffffff, roughness: 0.25, metalness: 1,
    clearcoat: 0.45, clearcoatRoughness: 0.16,
    specularIntensity: 1.0, envMapIntensity: 2.1,
    normalScale: new THREE.Vector2(0.70, 0.70),
    clearcoatNormalScale: new THREE.Vector2(0.85, 0.10),   // stretched highlight
  }, 0.60);
}

/* -------------------------------------------------------------- 5.10 cloth */
/**
 * NIM'S COAT. A real warp/weft weave (two interleaved sinusoids gated against
 * each other so the over/under alternates cell by cell), fibre fuzz on top,
 * and a sheen layer — `MeshPhysicalMaterial.sheen` is the retroreflective
 * fabric lobe, which is the single parameter that separates "cloth" from
 * "painted plastic" at the silhouette.
 */
function bakeCloth() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const THREADS = 48;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const cu = frac(u * THREADS), cv = frac(v * THREADS);
      const iu = Math.floor(u * THREADS), iv = Math.floor(v * THREADS);
      // plain weave: on half the cells the warp is on top, on the other half
      // the weft is — that alternation is what makes it read as woven
      const warpUp = ((iu + iv) & 1) === 0;
      const warp = Math.sin(cu * Math.PI);       // round thread cross-section
      const weft = Math.sin(cv * Math.PI);
      const top = warpUp ? warp : weft;
      const under = warpUp ? weft : warp;
      const weave = top * 0.78 + under * 0.22;

      const fuzz = fbm(u, v, 84, 3, 0.5, 14009);
      const slub = fbmXY(u, v, 6, 30, 3, 0.55, 14107);   // yarn thickness variation
      const wear = smoothstep(0.66, 0.92, fbm(u, v, 5, 4, 0.55, 14203));

      B.h[i] = 0.34 + weave * 0.42 + (fuzz - 0.5) * 0.10 + (slub - 0.5) * 0.08;

      // deep travelling-coat teal-blue, dyed unevenly
      let r = 0.098 + (slub - 0.5) * 0.048;
      let g = 0.166 + (slub - 0.5) * 0.058;
      let b = 0.196 + (slub - 0.5) * 0.062;
      const lit = clamp01(weave);
      r += lit * 0.062; g += lit * 0.086; b += lit * 0.098;
      // the under-thread sits in shadow
      r *= lerp(0.70, 1.0, clamp01(top)); g *= lerp(0.70, 1.0, clamp01(top)); b *= lerp(0.70, 1.0, clamp01(top));
      // sun-faded, fibre-lifted wear patches
      r = lerp(r, 0.238, wear * 0.45); g = lerp(g, 0.294, wear * 0.45); b = lerp(b, 0.318, wear * 0.45);
      r += (fuzz - 0.5) * 0.026; g += (fuzz - 0.5) * 0.028; b += (fuzz - 0.5) * 0.030;

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.88 - lit * 0.14 + wear * 0.08, 0.52, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 3, 0.60, 3.4, 0.58);

  const maps = {
    map: upload(commitA(B), 'cloth.albedo', true, 1.0),
    orm: upload(commitO(B), 'cloth.orm', false, 1.0),
    normal: upload(heightToNormal(B.h, n, 1.15), 'cloth.normal', false, 1.0),
  };
  return assemble('cloth', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 0,
    sheen: 1.0, sheenRoughness: 0.42, sheenColor: new THREE.Color(0x9fc4d8),
    specularIntensity: 0.35, envMapIntensity: 0.55,
    normalScale: new THREE.Vector2(0.95, 0.95),
  }, 1.0);
}

/* ------------------------------------------------------------ 5.11 painting */
/**
 * THE KEEP'S COURSE PORTALS. A frame-less painted canvas: real linen weave
 * showing through thin paint, a varnish craquelure network, and a diagonal
 * SHIMMER SWEEP driven by per-material uniforms (`uShimmer` phase 0..1,
 * `uShimmerColor`, `uShimmerWidth`) — every painting in the Keep can breathe
 * on its own beat, and a locked gate can hold a slow idle shimmer while an
 * unlocked one pulses invitingly.
 *
 * `builders.buildPainting()` clones this material and swaps `map` for the
 * course thumbnail canvas; the hook-preserving clone keeps the shimmer
 * injection and hands the clone a FRESH uniform object (`userData.cbLocal`
 * is deliberately not copied), so paintings never share a phase by accident.
 */
function bakePainting() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;
  const LINEN = 96;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      // linen ground: coarser and more irregular than the coat's weave
      const cu = frac(u * LINEN), cv = frac(v * LINEN);
      const iu = Math.floor(u * LINEN), iv = Math.floor(v * LINEN);
      const warpUp = ((iu + iv) & 1) === 0;
      const weave = (warpUp ? Math.sin(cu * Math.PI) : Math.sin(cv * Math.PI)) * 0.8
                  + (warpUp ? Math.sin(cv * Math.PI) : Math.sin(cu * Math.PI)) * 0.2;

      // craquelure: fine varnish cracks, denser toward the tile edges
      worley(u, v, 26, 15013);
      const edgeBias = 0.55 + 0.45 * Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      const craq = (1 - smoothstep(0.0, 0.016, W.f2 - W.f1)) * edgeBias;

      // impasto: where the paint was laid on thick
      const impasto = fbm(u, v, 9, 4, 0.55, 15121);
      const varnish = fbm(u, v, 4, 3, 0.55, 15227);

      B.h[i] = 0.46 + weave * 0.16 + (impasto - 0.5) * 0.30 - craq * 0.28;

      // a neutral warm gesso ground — the thumbnail map replaces this in use,
      // so the BASE only has to look like primed, aged canvas
      const t = 0.66 + (impasto - 0.5) * 0.13 + weave * 0.055;
      let r = t * 0.98, g = t * 0.93, b = t * 0.82;
      // yellowed varnish pooling
      r = lerp(r, r * 1.04, varnish * 0.5); g = lerp(g, g * 0.99, varnish * 0.5); b = lerp(b, b * 0.86, varnish * 0.5);
      // crack lines are darker than the ground
      r = lerp(r, 0.216, craq * 0.7); g = lerp(g, 0.190, craq * 0.7); b = lerp(b, 0.156, craq * 0.7);

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p] = 255;
      // varnish gloss varies: that variation IS what makes the sweep readable
      O[p + 1] = clamp(0.46 - varnish * 0.22 + craq * 0.20 + (impasto - 0.5) * 0.10, 0.10, 0.92) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;

      // a barely-there base emissive so an unlit Keep alcove still shows the
      // portal; the shimmer adds on top of this
      E[p] = 14; E[p + 1] = 12; E[p + 2] = 9; E[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'painting.albedo', true, 1.0, true),
    orm: upload(commitO(B), 'painting.orm', false, 1.0, true),
    normal: upload(heightToNormal(B.h, n, 0.90), 'painting.normal', false, 1.0, true),
    emissive: upload(commitE(B), 'painting.emissive', true, 1.0, true),
  };
  return assemble('painting', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 0,
    emissive: 0xffffff, emissiveIntensity: 1.0,
    clearcoat: 0.35, clearcoatRoughness: 0.30,     // the varnish coat
    specularIntensity: 0.75, envMapIntensity: 0.55,
    normalScale: new THREE.Vector2(0.70, 0.70),
  }, 1.0, {
    box: false,
    defines: { CB_SHIMMER: true },
    /* PER-MATERIAL uniforms: a function, so every clone gets its own phase. */
    uniforms: function (mat) {
      let L = mat.userData.cbLocal;
      if (!L) {
        L = {
          uShimmer: { value: 0 },
          uShimmerColor: { value: new THREE.Color(0xffe8b0) },
          uShimmerWidth: { value: 0.30 },
        };
        mat.userData.cbLocal = L;
      }
      return L;
    },
  });
}

/* ------------------------------------------------------------- 5.12 marble */
/** Polished statuary marble LAID AS SLABS.
 *
 *  ROUND 3 — the streak bug (owner-observed, `_shots/_vz_keepfloor.png`).
 *  Rounds 1-2 fixed the metres-per-tile and then chased the vein CHARACTER by
 *  raising the linear term until it dominated the warp (`u * 5.60` against
 *  `w1 * 1.25`). That is arithmetically a family of PARALLEL STRAIGHT LINES:
 *  the level sets of `a*u + b*v` are lines, the bake is tileable, and a line
 *  that leaves one edge of a seamless tile re-enters at the other — so the
 *  Keep floor rendered as hairline scratches running unbroken across many
 *  metres of world, in one direction, with nothing to break them. No amount of
 *  vein tuning fixes that, because the thing generating it is the tiling.
 *
 *  A real marble floor is not one continuous stone: it is SLABS. So the bake
 *  is now a 2 x 2 slab grid inside the tile, with a recessed grout joint, and
 *  every slab carries its own vein ROTATION, offset, body value and polish. A
 *  vein therefore cannot cross a joint, the direction changes every 0.6 m, and
 *  the texture seam falls inside a grout line where it belongs. Specular
 *  break-up comes from a per-slab roughness draw plus a hone swirl in the ORM,
 *  so the reflection breaks at the joints the way a laid floor does.
 *
 *  Scale: uvScale 0.84 = 1.19 m per tile = 0.60 m slabs, which is the real
 *  size of a cathedral floor slab and matches the stone family after the
 *  round-3 texel sweep (stone 0.72, plaster 0.68, brick 1.05). */
function bakeMarble() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  const SLABS = 2;                 // slabs per tile per axis
  const JOINT = 0.026;             // joint half-width, in slab units (~1.6 cm)

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      /* ---- which slab, and where inside it ------------------------------ */
      const gx = Math.floor(u * SLABS), gy = Math.floor(v * SLABS);
      const su = frac(u * SLABS), sv = frac(v * SLABS);
      const sidA = hash2i(gx, gy, 5171);      // vein rotation
      const sidB = hash2i(gx, gy, 9311);      // vein offset
      const sidC = hash2i(gx, gy, 2647);      // body value / polish

      // distance to the nearest joint, in slab units
      const dEdge = Math.min(Math.min(su, 1 - su), Math.min(sv, 1 - sv));
      const joint = 1 - smoothstep(JOINT * 0.45, JOINT, dEdge);
      const chamfer = 1 - smoothstep(JOINT, JOINT * 3.2, dEdge);

      /* ---- slab-local, per-slab-rotated coordinates ----------------------
       * The rotation is what removes the world-long streak: the linear vein
       * term still dominates INSIDE a slab (which is what makes a vein a vein
       * and not a maze), but its direction is redrawn every slab, and the
       * discontinuity lands exactly on the grout line. */
      const ang = sidA * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const cu = su - 0.5, cv = sv - 0.5;
      const ru = cu * ca - cv * sa + 0.5 + sidB * 4.13;
      const rv = cu * sa + cv * ca + 0.5 + sidA * 3.71;

      /* ---- the vein systems, inside the slab ----------------------------- */
      const w1 = warpedFbm(ru, rv, 4, 4, 0.50, 16001, 0.26);
      let band = frac(w1 * 1.15 + ru * 3.10 + rv * 0.95);
      band = Math.abs(band - 0.5) * 2;
      const vein = smoothstep(0.912, 0.999, band);
      const veinSoft = smoothstep(0.828, 0.990, band);

      // secondary gold vein system, sparser and finer
      const w2 = warpedFbm(ru, rv, 7, 4, 0.5, 16111, 0.50);
      let band2 = frac(w2 * 8.0 + rv * 2.4);
      band2 = Math.abs(band2 - 0.5) * 2;
      const gold = smoothstep(0.905, 1.0, band2) * smoothstep(0.35, 0.75, w1);

      const calcite = fbm(u, v, 96, 2, 0.5, 16223);
      // hone swirl: the polisher's arc. Very low contrast in ALBEDO, real
      // contrast in ROUGHNESS — which is how a polished floor breaks a
      // reflection without looking dirty.
      const swirl = fbm(ru * 0.8 + 0.13, rv * 0.8, 6, 2, 0.5, 16447);

      /* ---- height: slabs sit proud of their joints ----------------------- */
      B.h[i] = 0.58 + (veinSoft - 0.5) * 0.06 + (calcite - 0.5) * 0.04
             - vein * 0.03 - joint * 0.34 - chamfer * 0.05;

      /* ---- albedo -------------------------------------------------------- */
      // warm near-white body, with a per-slab value draw so a laid floor reads
      // as many stones rather than one printed sheet
      const slabVal = 0.965 + (sidC - 0.5) * 0.075;
      let r = (0.906 + (calcite - 0.5) * 0.040) * slabVal;
      let g = (0.892 + (calcite - 0.5) * 0.040) * slabVal;
      let b = (0.862 + (calcite - 0.5) * 0.044) * slabVal * (1 + (sidB - 0.5) * 0.03);
      // grey vein — a soft mineral grey, not ink
      r = lerp(r, 0.628, veinSoft * 0.24); g = lerp(g, 0.632, veinSoft * 0.24); b = lerp(b, 0.652, veinSoft * 0.24);
      r = lerp(r, 0.432, vein * 0.46); g = lerp(g, 0.440, vein * 0.46); b = lerp(b, 0.470, vein * 0.46);
      // gold vein
      r = lerp(r, 0.760, gold * 0.85); g = lerp(g, 0.582, gold * 0.85); b = lerp(b, 0.238, gold * 0.85);
      // calcite flecks
      if (hash2i(x, y, 16331) > 0.9975) { r = 0.99; g = 0.99; b = 0.98; }
      // the joint: warm lime mortar in shadow, with a lit chamfer above it
      r = lerp(r, 0.300, joint * 0.86); g = lerp(g, 0.286, joint * 0.86); b = lerp(b, 0.258, joint * 0.86);
      r = lerp(r, r * 1.06, chamfer * 0.5); g = lerp(g, g * 1.06, chamfer * 0.5); b = lerp(b, b * 1.05, chamfer * 0.5);

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p] = 255;
      /* Polish lives here. A walked slab floor is glossy (0.20-0.30) with a
       * PER-SLAB draw and a hone swirl on top, and dead-matte grout. That
       * per-slab roughness step is the specular break-up the reflection needs;
       * one uniform gloss over the whole floor is what read as flat. */
      let rough = 0.22 + (sidC - 0.5) * 0.16 + (swirl - 0.5) * 0.13
                + vein * 0.20 + (calcite - 0.5) * 0.05;
      rough = lerp(rough, 0.94, joint * 0.9);
      O[p + 1] = clamp(rough, 0.10, 1) * 255;
      O[p + 2] = clamp(gold * 0.85 * (1 - joint), 0, 1) * 255;   // only the gold vein is metal
      O[p + 3] = 255;
    }
  }

  const maps = {
    map: upload(commitA(B), 'marble.albedo', true, 0.84),
    orm: upload(commitO(B), 'marble.orm', false, 0.84),
    normal: upload(heightToNormal(B.h, n, 0.34), 'marble.normal', false, 0.84),
  };
  return assemble('marble', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 1,
    /* clearcoat 0.85 + env 1.15 made the Keep floor a mirror for the cool
     * sanctum sky, which is why a cream slab rendered purple-grey. Polished,
     * not wet. */
    clearcoat: 0.48, clearcoatRoughness: 0.10,
    sheen: 0.16, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xf0e8d8),
    specularIntensity: 0.9, envMapIntensity: 0.72,
    normalScale: new THREE.Vector2(0.55, 0.55),
  }, 0.84, macroInject(11.0, 0.055, 0.035, 0.0, faceInject(0.38)));
}

/* --------------------------------------------------------------- 5.13 moss */
/** Velvet cushion moss: tight worley clumps, spore stalks, deep shadow between
 *  the cushions, and a sheen layer so the grazing angle goes silver-green the
 *  way real moss does. */
function bakeMoss() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      worley(u, v, 15, 17003);
      const cushion = smoothstep(0.58, 0.02, W.f1);
      const gap = 1 - smoothstep(0.0, 0.075, W.f2 - W.f1);
      const cid = W.id;

      const nap = fbm(u, v, 90, 2, 0.5, 17111);          // the velvet nap
      const damp = fbm(u, v, 6, 4, 0.55, 17209);

      // spore stalks: sparse bright pinpricks standing above the cushions
      worley(u, v, 44, 17317);
      const stalk = smoothstep(0.09, 0.0, W.f1) * (hash2i(x >> 2, y >> 2, 17419) > 0.90 ? 1 : 0);

      B.h[i] = 0.34 + cushion * 0.44 - gap * 0.24 + (nap - 0.5) * 0.12 + stalk * 0.22;

      const shade = clamp01(cushion * 1.2 - gap * 0.8);
      let r = lerp(0.028, 0.146, shade);
      let g = lerp(0.062, 0.286, shade);
      let b = lerp(0.030, 0.108, shade);
      // each cushion has its own age: young = yellow-green, old = dark olive
      r += (cid - 0.5) * 0.055; g += (cid - 0.5) * 0.060; b += (cid - 0.5) * 0.024;
      r += (nap - 0.5) * 0.030; g += (nap - 0.5) * 0.048; b += (nap - 0.5) * 0.018;
      // wet patches darken and saturate
      const wet = smoothstep(0.62, 0.90, damp);
      r = lerp(r, r * 0.62, wet); g = lerp(g, g * 0.70, wet); b = lerp(b, b * 0.70, wet);
      // spore capsules: pale straw
      r = lerp(r, 0.406, stalk * 0.8); g = lerp(g, 0.356, stalk * 0.8); b = lerp(b, 0.150, stalk * 0.8);

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.95 - wet * 0.34 - stalk * 0.12, 0.30, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.48, 3.6, 0.44);

  const maps = {
    map: upload(commitA(B), 'moss.albedo', true, 0.80),
    orm: upload(commitO(B), 'moss.orm', false, 0.80),
    normal: upload(heightToNormal(B.h, n, 1.45), 'moss.normal', false, 0.80),
  };
  return assemble('moss', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 0,
    sheen: 0.85, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x8fc48a),
    specularIntensity: 0.30, envMapIntensity: 0.30,
    normalScale: new THREE.Vector2(1.05, 1.05),
  }, 0.80);
}

/* ------------------------------------------------------------- 5.14 copper */
/** Brushed copper going to verdigris: bright metal on the wear paths, green
 *  carbonate crust in the sheltered areas, with the crust dielectric and the
 *  bare metal metalness-1 — the metalness MAP is what sells oxidation. */
function bakeCopper() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const brush = maskScratches(n, { seed: 18013, count: 620, angle: 8, jitter: 4, minLen: 0.4, maxLen: 1.6, minW: 0.4, maxW: 1.1 });

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const patchA = fbm(u, v, 5, 4, 0.55, 18111);
      const patchB = warpedFbm(u, v, 11, 4, 0.5, 18211, 0.42);
      const crust = clamp01(smoothstep(0.44, 0.78, patchA) * 0.85 + smoothstep(0.62, 0.90, patchB) * 0.55);
      const crumb = fbm(u, v, 52, 3, 0.5, 18311);
      const bl = brush[i];

      // bright wear paths cut THROUGH the crust
      const wear = smoothstep(0.60, 0.90, fbmXY(u, v, 4, 14, 3, 0.55, 18413));
      const bare = clamp01(1 - crust + wear * 0.9);

      B.h[i] = 0.5 + crust * 0.20 + (crumb - 0.5) * 0.14 * crust + bl * 0.05 - wear * 0.06;

      // metal: warm salmon copper; crust: blue-green carbonate
      let r = lerp(0.128, 0.706, bare);
      let g = lerp(0.412, 0.372, bare);
      let b = lerp(0.352, 0.230, bare);
      r += bl * 0.055 * bare; g += bl * 0.036 * bare; b += bl * 0.024 * bare;
      // crust colour varies from pale chalky green to deep blue-green
      const tone = crumb;
      r = lerp(r, r * (0.80 + tone * 0.5), crust * 0.6);
      g = lerp(g, g * (0.88 + tone * 0.35), crust * 0.6);
      b = lerp(b, b * (0.92 + tone * 0.30), crust * 0.6);
      // dark pitting under the crust
      const pit = smoothstep(0.86, 0.98, crumb) * crust;
      r = lerp(r, 0.046, pit * 0.7); g = lerp(g, 0.096, pit * 0.7); b = lerp(b, 0.086, pit * 0.7);

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p + 1] = clamp(lerp(0.92, 0.26, bare) - bl * 0.10 * bare + pit * 0.06, 0.10, 1) * 255;
      O[p + 2] = clamp(bare * 0.96, 0, 1) * 255;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 4, 0.60, 3.0, 0.60);

  const maps = {
    map: upload(commitA(B), 'copper.albedo', true, 0.45),
    orm: upload(commitO(B), 'copper.orm', false, 0.45),
    normal: upload(heightToNormal(B.h, n, 1.25), 'copper.normal', false, 0.45),
  };
  return assemble('copper', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(0.95, 0.95), envMapIntensity: 1.35,
  }, 0.45);
}

/* --------------------------------------------------------------- 5.15 rope */
/**
 * Three-strand hawser-laid rope. ATTRIBUTE UVs: V runs ALONG the rope, U
 * around it, and the texture is preset to 4 tiles/metre so a 0.25 m lay
 * length comes out right whatever length the builder cuts. The strand helix
 * is a phase ramp `u*3 + v*LAY`, which wraps exactly because both terms are
 * whole numbers of cycles across the tile.
 */
function bakeRope() {
  const n = SIZE_MD, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const STRANDS = 3;
  const LAY = 2;                    // whole helix turns across the tile

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      // which strand, and where across it
      const ph = u * STRANDS + v * LAY * STRANDS;
      const s = frac(ph);
      const sid = Math.floor(ph);
      const round = Math.sin(s * Math.PI);            // strand cross-section
      const groove = 1 - round;

      // yarns spiralling inside each strand (opposite lay to the strand)
      const yarnPh = s * 7.0 - v * 9.0;
      const yarn = 0.5 + 0.5 * Math.sin(yarnPh * Math.PI * 2);

      const fibre = fbmXY(u, v, 30, 84, 2, 0.5, 19001);
      const hairs = fbm(u, v, 120, 2, 0.5, 19111);
      const fray = smoothstep(0.70, 0.94, fbm(u, v, 8, 4, 0.55, 19211));

      B.h[i] = 0.30 + round * 0.44 + yarn * 0.14 * round
             + (fibre - 0.5) * 0.10 + hairs * 0.05 - fray * 0.10;

      // hemp: warm straw, darker in the grooves, silvered on the crowns
      const lit = clamp01(round * 0.85 + yarn * 0.25);
      let r = lerp(0.156, 0.512, lit);
      let g = lerp(0.124, 0.428, lit);
      let b = lerp(0.076, 0.276, lit);
      // per-strand tone so the three strands are distinguishable
      const sTone = hash2i(sid, 0, 19311) * 0.10 - 0.05;
      r += sTone; g += sTone * 0.9; b += sTone * 0.7;
      r += (fibre - 0.5) * 0.070; g += (fibre - 0.5) * 0.058; b += (fibre - 0.5) * 0.040;
      // frayed, sun-bleached hairs
      r = lerp(r, 0.616, fray * 0.45); g = lerp(g, 0.556, fray * 0.45); b = lerp(b, 0.412, fray * 0.45);
      // deep groove shadow
      r = lerp(r, 0.052, groove * groove * 0.65);
      g = lerp(g, 0.042, groove * groove * 0.65);
      b = lerp(b, 0.028, groove * groove * 0.65);

      A[p] = clamp01(r) * 255; A[p + 1] = clamp01(g) * 255; A[p + 2] = clamp01(b) * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.94 - lit * 0.10 + fray * 0.05, 0.55, 1) * 255;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  bakeAO(B, 3, 0.52, 3.4, 0.48);

  const maps = {
    map: upload(commitA(B), 'rope.albedo', true, 4.0),
    orm: upload(commitO(B), 'rope.orm', false, 4.0),
    normal: upload(heightToNormal(B.h, n, 1.65), 'rope.normal', false, 4.0),
  };
  return assemble('rope', maps, {
    __physical: true,
    color: 0xffffff, roughness: 1, metalness: 0,
    sheen: 0.45, sheenRoughness: 0.75, sheenColor: new THREE.Color(0xd8c49a),
    specularIntensity: 0.30, envMapIntensity: 0.30,
    normalScale: new THREE.Vector2(1.15, 1.15),
  }, 4.0);
}

/* ========================================================================== *
 * 6. water — the one ShaderMaterial (CONTRACT §14 + §19)                      *
 * ========================================================================== */

/**
 * Shared water uniforms. `uTime` IS the module clock object (`TIME_U`), so one
 * `Mats.tick()` drives every lake, sea and pool in the game from a single
 * number — and a per-theme clone that re-points its own `uniforms.uTime` at
 * this object stays in phase with all the others.
 *
 * water.js reads and writes these:
 *   uWaveA/B/C  vec4( dirX, dirZ, steepness 0..1, wavelength m )
 *   uAmp        overall displacement multiplier (0 = flat pool, 1 = open sea)
 *   uFlow       vec2 metres/second of surface drift (rivers, currents)
 *   uShallow / uDeep / uFoam   the theme's water colour ramp
 *   uShoreWidth depth in metres over which the foam edge fades out
 *   uDepthFade  metres of water over which uShallow -> uDeep
 *   uSunDir / uSunColor / uSkyTop / uSkyHorizon   the reflection environment
 *   uOpacity    surface alpha at normal incidence (fresnel drives it up)
 */
const WATER_U = {
  uTime: TIME_U,
  uWaveA: { value: new THREE.Vector4(1.0, 0.25, 0.26, 7.5) },
  uWaveB: { value: new THREE.Vector4(-0.6, 0.85, 0.20, 4.1) },
  uWaveC: { value: new THREE.Vector4(0.35, -0.95, 0.14, 2.2) },
  uAmp: { value: 1.0 },
  uFlow: { value: new THREE.Vector2(0, 0) },
  uShallow: { value: new THREE.Color(0x3fd2c8) },
  uDeep: { value: new THREE.Color(0x06364f) },
  uFoam: { value: new THREE.Color(0xeafcff) },
  uShoreWidth: { value: 1.35 },
  uDepthFade: { value: 4.5 },
  uCrestFoam: { value: 0.55 },
  uRipple: { value: 0.55 },
  uFresnelPower: { value: 4.2 },
  uFresnelBias: { value: 0.035 },
  uGloss: { value: 220.0 },
  uSunDir: { value: new THREE.Vector3(-0.42, 0.86, 0.30) },
  uSunColor: { value: new THREE.Color(0xfff2d8) },
  uSkyTop: { value: new THREE.Color(0x2f6fc0) },
  uSkyHorizon: { value: new THREE.Color(0xbcd8ee) },
  uOpacity: { value: 0.86 },
  /* only read under #define CB_WATER_DEPTH (water.js supplies a depth target) */
  uDepthTex: { value: null },
  uDepthParams: { value: new THREE.Vector4(0.1, 1000, 1 / 1280, 1 / 720) },
};

const WATER_VERT = /* glsl */`
uniform float uTime;
uniform vec4  uWaveA;
uniform vec4  uWaveB;
uniform vec4  uWaveC;
uniform float uAmp;
uniform vec2  uFlow;

varying vec3  vCbWorld;
varying vec3  vCbNormal;
varying vec2  vCbUv;
varying float vCbCrest;
varying float vCbShore;

#ifdef CB_WATER_SHORE
  attribute float aShore;
#endif

#include <fog_pars_vertex>

/**
 * One Gerstner wave. Displaces the vertex ALONG its direction as well as up,
 * which is what gives real waves their sharp crests and flat troughs; the
 * analytic tangent/binormal accumulate so the normal is exact rather than
 * finite-differenced.
 *   w = (dirX, dirZ, steepness, wavelength)
 */
vec3 cbGerstner( vec4 w, vec3 p, float t, inout vec3 tang, inout vec3 bino ) {
  vec2 d = normalize( w.xy + vec2( 1e-5, 1e-5 ) );
  float len = max( w.w, 0.25 );
  float k = 6.283185307 / len;
  float c = sqrt( 9.81 / k );              // deep-water phase speed
  float s = clamp( w.z, 0.0, 1.0 ) * uAmp;
  float a = s / k;
  float f = k * ( dot( d, p.xz ) - c * t );
  float sf = sin( f ), cf = cos( f );

  tang += vec3( -d.x * d.x * s * sf,  d.x * s * cf, -d.x * d.y * s * sf );
  bino += vec3( -d.x * d.y * s * sf,  d.y * s * cf, -d.y * d.y * s * sf );

  return vec3( d.x * a * cf, a * sf, d.y * a * cf );
}

void main() {
  vec3 wp = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  float t = uTime;

  vec3 tang = vec3( 1.0, 0.0, 0.0 );
  vec3 bino = vec3( 0.0, 0.0, 1.0 );
  vec3 off = vec3( 0.0 );
  off += cbGerstner( uWaveA, wp, t, tang, bino );
  off += cbGerstner( uWaveB, wp, t, tang, bino );
  off += cbGerstner( uWaveC, wp, t, tang, bino );

  vec3 disp = wp + off;

  vCbWorld = disp;
  vCbNormal = normalize( cross( bino, tang ) );
  vCbUv = disp.xz + uFlow * t;
  // crest factor: 0 in the trough, 1 on the highest crest this wave set makes
  vCbCrest = clamp( off.y / max( 0.08, uAmp * 0.65 ), -1.0, 1.0 ) * 0.5 + 0.5;

  #ifdef CB_WATER_SHORE
    vCbShore = aShore;
  #else
    vCbShore = 0.0;
  #endif

  vec4 mvPosition = viewMatrix * vec4( disp, 1.0 );
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3  uShallow;
uniform vec3  uDeep;
uniform vec3  uFoam;
uniform float uShoreWidth;
uniform float uDepthFade;
uniform float uCrestFoam;
uniform float uRipple;
uniform float uFresnelPower;
uniform float uFresnelBias;
uniform float uGloss;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyTop;
uniform vec3  uSkyHorizon;
uniform float uOpacity;

#ifdef CB_WATER_DEPTH
  uniform sampler2D uDepthTex;
  uniform vec4 uDepthParams;      // near, far, 1/width, 1/height
#endif

varying vec3  vCbWorld;
varying vec3  vCbNormal;
varying vec2  vCbUv;
varying float vCbCrest;
varying float vCbShore;

float cbwHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float cbwNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = cbwHash( i );
  float b = cbwHash( i + vec2( 1.0, 0.0 ) );
  float c = cbwHash( i + vec2( 0.0, 1.0 ) );
  float d = cbwHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

/** two counter-scrolling ripple octaves -> a detail normal the Gerstner mesh
 *  is far too coarse to carry. Returns a tangent-space-ish perturbation. */
vec2 cbRippleGrad( vec2 p, float t ) {
  /* 2026-09-04: 1.7 / 3.9 cycles per metre at a 0.60 render scale was
     sub-pixel noise — the owner's "flat cyan noise" on the azure lagoon. Wind
     ripples on a lagoon are 0.5-2 m; the octaves are lowered to where a
     pixel can resolve them, and the caller fades them with distance. */
  float e = 0.22;
  vec2 a = p * 0.62 + vec2( t * 0.17, -t * 0.12 );
  vec2 b = p * 1.55 - vec2( t * 0.26, t * 0.21 );
  float h  = cbwNoise( a ) * 0.6 + cbwNoise( b ) * 0.4;
  float hx = cbwNoise( a + vec2( e, 0.0 ) ) * 0.6 + cbwNoise( b + vec2( e, 0.0 ) ) * 0.4;
  float hz = cbwNoise( a + vec2( 0.0, e ) ) * 0.6 + cbwNoise( b + vec2( 0.0, e ) ) * 0.4;
  return vec2( hx - h, hz - h ) / e;
}

#include <fog_pars_fragment>

void main() {
  vec3 V = normalize( cameraPosition - vCbWorld );
  vec3 N = normalize( vCbNormal );

  // detail ripples ride on top of the analytic wave normal, and fade with
  // distance so the far surface goes glassy and MIRRORS the sky instead of
  // shimmering at sub-pixel frequency
  float cbWd = length( cameraPosition - vCbWorld );
  float cbRf = 1.0 / ( 1.0 + cbWd * 0.035 );
  vec2 g = cbRippleGrad( vCbUv, uTime );
  N = normalize( N + vec3( -g.x, 0.0, -g.y ) * ( uRipple * cbRf ) );

  float ndv = clamp( dot( N, V ), 0.0, 1.0 );
  float fres = clamp( uFresnelBias + ( 1.0 - uFresnelBias ) * pow( 1.0 - ndv, uFresnelPower ), 0.0, 1.0 );

  /* ---- how much water is under this pixel ------------------------------- */
  float depth = 1.0;                       // 1 = deep, 0 = the shore line
  #ifdef CB_WATER_DEPTH
    vec2 sUv = gl_FragCoord.xy * uDepthParams.zw;
    float dz = texture2D( uDepthTex, sUv ).x;
    float zNear = uDepthParams.x, zFar = uDepthParams.y;
    // perspective depth -> view-space distance
    float sceneZ = ( 2.0 * zNear * zFar ) / ( zFar + zNear - ( dz * 2.0 - 1.0 ) * ( zFar - zNear ) );
    float fragZ  = ( 2.0 * zNear * zFar ) / ( zFar + zNear - ( gl_FragCoord.z * 2.0 - 1.0 ) * ( zFar - zNear ) );
    depth = clamp( ( sceneZ - fragZ ) / max( uDepthFade, 0.05 ), 0.0, 1.0 );
  #else
    depth = clamp( 1.0 - vCbShore, 0.0, 1.0 );
  #endif

  /* ---- body colour: shallow tint over deep tint by depth ---------------- */
  vec3 body = mix( uShallow, uDeep, depth * depth );

  /* ---- sky reflection (analytic — cheaper than a probe, always agrees) --- */
  vec3 R = reflect( -V, N );
  vec3 sky = mix( uSkyHorizon, uSkyTop, clamp( R.y * 1.35, 0.0, 1.0 ) );

  vec3 col = mix( body, sky, fres );

  /* ---- sun glint -------------------------------------------------------- */
  // a tight mirror lobe (the disc) over a broad, dimmer one (the glitter path
  // the ripples scatter it into) — the second is what reads as "sunlit water"
  // from a camera that is not standing in the mirror direction.
  vec3 H = normalize( normalize( uSunDir ) + V );
  float ndh = clamp( dot( N, H ), 0.0, 1.0 );
  float spec = pow( ndh, max( uGloss, 4.0 ) );
  float glit = pow( ndh, 26.0 );
  col += uSunColor * ( spec * 2.2 + glit * 0.22 ) * ( 0.35 + 0.65 * fres );

  /* ---- foam ------------------------------------------------------------- */
  // shore band: a hard-ish line that breaks up with the ripple field
  float shoreBand = 1.0 - smoothstep( 0.0, clamp( uShoreWidth * 0.35, 0.02, 1.0 ), depth );
  float churn = cbwNoise( vCbUv * 2.6 + vec2( uTime * 0.35, -uTime * 0.22 ) );
  float shoreFoam = smoothstep( 0.28, 0.92, shoreBand * ( 0.55 + 0.75 * churn ) );
  // whitecaps on the wave crests
  float caps = smoothstep( 0.72, 0.98, vCbCrest * ( 0.65 + 0.55 * churn ) ) * uCrestFoam;
  float foam = clamp( shoreFoam + caps, 0.0, 1.0 );

  col = mix( col, uFoam, foam );

  float alpha = clamp( mix( uOpacity, 1.0, max( fres * 0.75, foam ) ), 0.0, 1.0 );
  // never let a knife-thin shore edge show the geometry seam under it
  alpha *= smoothstep( 0.0, 0.04, depth + foam );

  /* LINEAR HDR out — see the ROUND 5 double-tone-map note in world/sky.js.
     ACES here clamped every glint and fresnel rim to 1.0 before FinishPass
     ever saw them, which is what flattened the water to one cyan sheet. */
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), alpha );

  #include <fog_fragment>
}
`;

/**
 * Build the shared water ShaderMaterial. Registered in `_base` like any other
 * key so `Mats.get('water')` finds it, but it never goes through `assemble()`
 * (there is no albedo/ORM/normal set — the whole look is analytic).
 */
function bakeWater() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
  // merge() deep-clones what it is given, which would break the SHARED uniform
  // objects — so the water uniforms are attached by reference afterwards.
  for (const k in WATER_U) uniforms[k] = WATER_U[k];

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,           // linear HDR out; FinishPass tone maps
  });
  mat.name = 'cb.water';
  mat.userData.cbKey = 'water';
  mat.userData.cbUvScale = 1;
  mat.userData.baseEmissive = 0;
  mat.customProgramCacheKey = function () { return 'cb-water'; };

  /**
   * Water clones must keep pointing at the SHARED uniform objects, or a second
   * lake would run on its own frozen clock. ShaderMaterial.copy() deep-clones
   * `uniforms`, so we re-attach the shared ones by reference and leave the
   * per-instance colour uniforms as the fresh copies (a theme, or water.js,
   * may then tint one lake without touching the others).
   */
  mat.clone = function () {
    const c = new THREE.ShaderMaterial().copy(this);
    c.customProgramCacheKey = this.customProgramCacheKey;
    c.clone = this.clone;
    c.userData.cbKey = 'water';
    c.userData.cbUvScale = 1;
    c.userData.baseEmissive = 0;
    // shared: the clock and the wave SHAPE (so every surface is one ocean)
    c.uniforms.uTime = WATER_U.uTime;
    c.uniforms.uWaveA = WATER_U.uWaveA;
    c.uniforms.uWaveB = WATER_U.uWaveB;
    c.uniforms.uWaveC = WATER_U.uWaveC;
    c.uniforms.uAmp = WATER_U.uAmp;
    c.needsUpdate = true;
    return c;
  };

  _shaderU.set('water', WATER_U);
  _uvScale.set('water', 1);
  _base.set('water', mat);
  return mat;
}

/* ========================================================================== *
 * 7. loose utility textures                                                  *
 * ========================================================================== */

/** Generic maps other systems ask for through `Mats.tex(name)`. */
function bakeUtilityTextures() {
  const n = SIZE_MD;

  // 'noise' — plain tileable fBm, grayscale
  {
    const cv = makeCanvas(n), c = ctx2d(cv), img = c.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const val = fbm(x / n, y / n, 8, 5, 0.5, 12345) * 255;
      const p = (y * n + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = val; d[p + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    upload(cv, 'noise', false, 1);
  }

  // 'grunge' — dirt / streak mask, useful as an opacity or roughness modulator
  {
    const cv = makeCanvas(n), c = ctx2d(cv), img = c.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      const g = warpedFbm(u, v, 6, 5, 0.55, 2468, 0.35);
      const streak = fbmXY(u, v, 4, 24, 3, 0.5, 1357);
      const val = clamp01(g * 0.75 + streak * 0.35) * 255;
      const p = (y * n + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = val; d[p + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    upload(cv, 'grunge', false, 1);
  }

  // 'sparkle' — soft radial dot field, for particles / glints
  {
    const cv = makeCanvas(n), c = ctx2d(cv);
    c.fillStyle = '#000'; c.fillRect(0, 0, n, n);
    const rnd = mulberry32(999);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * n, y = rnd() * n, r = 1.5 + rnd() * rnd() * 7;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.35 + rnd() * 0.65;
      g.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    upload(cv, 'sparkle', false, 1);
  }

  // 'radial' — the soft blob used for contact shadows / glow sprites / the
  // hero's shadow blob (hero.js reads this by name)
  {
    const cv = makeCanvas(n), c = ctx2d(cv);
    c.clearRect(0, 0, n, n);
    const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, n, n);
    upload(cv, 'radial', true, 1, true);
  }

  // 'scratch' — reusable directional wear mask
  {
    const cv = makeCanvas(n), c = ctx2d(cv), img = c.createImageData(n, n), d = img.data;
    const m = maskScratches(n, { seed: 31337, count: 500, angle: 0, jitter: 8, minLen: 0.3, maxLen: 1.6, minW: 0.4, maxW: 1.6 });
    for (let i = 0, p = 0; i < n * n; i++, p += 4) {
      d[p] = d[p + 1] = d[p + 2] = m[i] * 255; d[p + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    upload(cv, 'scratch', false, 1);
  }

  // 'caustic' — a tileable underwater light pattern for decals / projectors
  {
    const cv = makeCanvas(n), c = ctx2d(cv), img = c.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      worley(u, v, 7, 20011);
      const cell = 1 - smoothstep(0.0, 0.22, W.f2 - W.f1);
      const soft = fbm(u, v, 9, 3, 0.5, 20113);
      const val = clamp01(Math.pow(cell, 1.6) * (0.65 + 0.55 * soft)) * 255;
      const p = (y * n + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = val; d[p + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    upload(cv, 'caustic', false, 1);
  }

  // 'ring' — a crisp annulus for collect bursts, ring gates and pad pulses
  {
    const cv = makeCanvas(n), c = ctx2d(cv);
    c.clearRect(0, 0, n, n);
    const img = c.createImageData(n, n), d = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5, dy = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;             // 0 centre, 1 edge
      const a = smoothstep(0.62, 0.80, r) * smoothstep(1.0, 0.86, r);
      const p = (y * n + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = clamp01(a) * 255;
    }
    c.putImageData(img, 0, 0);
    upload(cv, 'ring', true, 1, true);
  }
}

/* ========================================================================== *
 * 8. theme tinting                                                           *
 * ========================================================================== */

/**
 * A materialOverride entry (authored in themes.js) may carry:
 *   tint                hex, MULTIPLIED into the base colour
 *   color               hex, REPLACES the base colour
 *   rough / metal       signed deltas applied to the scalar factors
 *                       (NOTE: on map-carrying materials the scalar is already
 *                       1.0 and multiplies the map, so a positive rough delta
 *                       is a NO-OP — use specularIntensity / env instead)
 *   roughness/metalness absolute values
 *   emissive            hex emissive colour
 *   emissiveIntensity   absolute
 *   env                 envMapIntensity multiplier
 *   sheen / sheenColor / sheenRoughness
 *   attenuationColor / attenuationDistance / clearcoat / transmission / opacity
 *   specularIntensity   absolute (physical materials) — the lever that
 *                       actually kills a grazing-angle sky mirror on walked
 *                       tops
 *   clearcoatRoughness  absolute (physical materials)
 *   normalScale         scalar multiplier on the baked normal strength
 *
 * Water is handled separately (`_waterFor`) because it is a ShaderMaterial
 * with no `.color`.
 */
function applyOverride(mat, base, theme, key) {
  const o = (theme.materialOverrides && theme.materialOverrides[key]) || null;
  const envMul = (typeof theme.envIntensity === 'number') ? theme.envIntensity : 1;

  // carry the shader hooks across the clone — Material.copy() does not
  mat.onBeforeCompile = base.onBeforeCompile;
  mat.customProgramCacheKey = base.customProgramCacheKey;
  mat.needsUpdate = true;

  mat.envMapIntensity = (base.envMapIntensity || 1) * envMul;
  if (!o) { mat.userData.baseEmissive = mat.emissiveIntensity || 0; return mat; }

  if (o.color !== undefined) {
    mat.color.set(o.color);
  } else if (o.tint !== undefined) {
    _c0.copy(base.color);
    _c1.set(o.tint);
    mat.color.setRGB(_c0.r * _c1.r, _c0.g * _c1.g, _c0.b * _c1.b);
  }
  if (o.roughness !== undefined) mat.roughness = clamp01(o.roughness);
  else if (o.rough !== undefined) mat.roughness = clamp01((base.roughness || 1) + o.rough);
  if (o.metalness !== undefined) mat.metalness = clamp01(o.metalness);
  else if (o.metal !== undefined) mat.metalness = clamp01((base.metalness || 0) + o.metal);

  if (o.emissive !== undefined && mat.emissive) mat.emissive.set(o.emissive);
  if (o.emissiveIntensity !== undefined) mat.emissiveIntensity = o.emissiveIntensity;
  if (o.env !== undefined) mat.envMapIntensity = (base.envMapIntensity || 1) * o.env * envMul;
  if (o.opacity !== undefined) { mat.opacity = o.opacity; mat.transparent = o.opacity < 1; }
  if (o.normalScale !== undefined && mat.normalScale && base.normalScale) {
    mat.normalScale.set(base.normalScale.x * o.normalScale, base.normalScale.y * o.normalScale);
  }

  if (mat.isMeshPhysicalMaterial) {
    if (o.sheen !== undefined) mat.sheen = clamp01(o.sheen);
    if (o.sheenColor !== undefined && mat.sheenColor) mat.sheenColor.set(o.sheenColor);
    if (o.sheenRoughness !== undefined) mat.sheenRoughness = clamp01(o.sheenRoughness);
    if (o.attenuationColor !== undefined && mat.attenuationColor) mat.attenuationColor.set(o.attenuationColor);
    if (o.attenuationDistance !== undefined) mat.attenuationDistance = o.attenuationDistance;
    if (o.clearcoat !== undefined) mat.clearcoat = clamp01(o.clearcoat);
    if (o.clearcoatRoughness !== undefined) mat.clearcoatRoughness = clamp01(o.clearcoatRoughness);
    /* A theme may not re-arm transmission either (see transmissionToAlpha):
       one transmissive material in view doubles the whole frame. */
    if (o.transmission !== undefined) {
      const t = clamp01(o.transmission);
      mat.transmission = 0;
      if (t > 0.02) {
        mat.opacity = Math.min(mat.opacity === undefined ? 1 : mat.opacity, Math.max(0.18, 1 - t * 0.72));
        mat.transparent = true;
        mat.depthWrite = t < 0.5;
        mat.envMapIntensity = mat.envMapIntensity * (1 + t * 0.55);
      }
    }
    if (o.iridescence !== undefined) mat.iridescence = clamp01(o.iridescence);
    if (o.specularIntensity !== undefined) mat.specularIntensity = Math.max(0, o.specularIntensity);
  }
  // capture the post-override intensity: tick() pulses relative to THIS value,
  // so a theme that dims or brightens its neon keeps that choice.
  mat.userData.baseEmissive = mat.emissiveIntensity || 0;
  return mat;
}

/**
 * The per-theme water instance. Colour uniforms come from the theme
 * (`palette.water`, `materialOverrides.water`, the sky params for the
 * reflection) while the clock and the wave shape stay shared.
 */
function _waterFor(theme) {
  const base = _base.get('water');
  const m = base.clone();
  m.name = 'cb.water.' + theme.id;
  m.userData.cbTheme = theme.id;

  const o = (theme.materialOverrides && theme.materialOverrides.water) || null;
  const pal = theme.palette || null;
  const sky = (theme.sky && theme.sky.params) || null;

  if (pal && pal.water !== undefined) m.uniforms.uShallow.value.set(pal.water);
  if (sky) {
    if (sky.top !== undefined) m.uniforms.uSkyTop.value.set(sky.top);
    if (sky.horizon !== undefined) m.uniforms.uSkyHorizon.value.set(sky.horizon);
    if (sky.sunColor !== undefined) m.uniforms.uSunColor.value.set(sky.sunColor);
    if (Array.isArray(sky.sunDir) && sky.sunDir.length >= 3) {
      m.uniforms.uSunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]).normalize();
    }
  }
  const key = theme.lights && theme.lights.key;
  if (key && Array.isArray(key.dir) && key.dir.length >= 3) {
    m.uniforms.uSunDir.value.set(key.dir[0], key.dir[1], key.dir[2]).normalize();
    if (key.color !== undefined) m.uniforms.uSunColor.value.set(key.color);
  }

  if (o) {
    if (o.shallow !== undefined) m.uniforms.uShallow.value.set(o.shallow);
    if (o.deep !== undefined) m.uniforms.uDeep.value.set(o.deep);
    if (o.foam !== undefined) m.uniforms.uFoam.value.set(o.foam);
    if (typeof o.opacity === 'number') m.uniforms.uOpacity.value = clamp01(o.opacity);
    if (typeof o.depthFade === 'number') m.uniforms.uDepthFade.value = o.depthFade;
    if (typeof o.shoreWidth === 'number') m.uniforms.uShoreWidth.value = o.shoreWidth;
    if (typeof o.ripple === 'number') m.uniforms.uRipple.value = o.ripple;
    if (typeof o.crestFoam === 'number') m.uniforms.uCrestFoam.value = o.crestFoam;
    if (typeof o.gloss === 'number') m.uniforms.uGloss.value = o.gloss;
  }
  return m;
}

/* ========================================================================== *
 * 9. public API                                                              *
 * ========================================================================== */

/* pulse state — module scope so the per-frame Map walk allocates nothing */
let _pulseNeon = 1;
let _pulseCrystal = 1;
let _pulseGold = 1;

function applyPulse(m, k) {
  if (!m) return;
  const b = m.userData.baseEmissive;
  if (!b) return;
  m.emissiveIntensity = b * k;
}

function pulseThemed(m) {
  const k = m.userData.cbKey;
  if (k === 'neon') applyPulse(m, _pulseNeon);
  else if (k === 'crystal') applyPulse(m, _pulseCrystal);
  else if (k === 'painting') applyPulse(m, _pulseGold);
}

export const Mats = {
  /** every material key this library answers to (CONTRACT §14) */
  keys: KEYS.slice(),

  /** true once init() has finished baking */
  get ready() { return _ready; },

  /**
   * Bake every procedural texture and build every base material. Idempotent —
   * calling twice is a no-op. Safe to call without a renderer (anisotropy 4).
   *
   * ORDER MATTERS in exactly one place: `dirt` must exist before `grass`,
   * `snow` and `sand`, because those three read its maps as their slope-blend
   * target out of the texture table at assemble time.
   */
  init(renderer, quality) {
    if (_ready) return Mats;
    _renderer = renderer || null;
    /* ANISOTROPY IS A TIER KNOB, NOT A HARDWARE MAXIMUM.
     *
     * settings.js has documented `anisotropy` as "texture anisotropy cap
     * (materials.js)" since the perf pass, and its comment credits the HIGH
     * tier's 4 -> 2 move with -3.7 ms. Nothing ever read it: this function took
     * `renderer.capabilities.getMaxAnisotropy()` (16 on the reference Intel
     * UHD) and clamped it to 8, so EVERY tier — low included — ran 8x AF on
     * every map of every material, and the tier value was dead data.
     * MEASURED 2026-09-03 (`_harness/frameprobe.py`, verdant-1 spawn, quality
     * HIGH, 1920x1080): forcing every texture to anisotropy 1 was worth
     * -3.18 ms on a 37.24 ms frame. That is the saving the preset was already
     * promising and never delivering.
     *
     * `quality` is optional so the harnesses' bare `Mats.init(renderer)` still
     * works; without it the old capability cap applies. */
    let capMax = 8;
    try {
      if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
        capMax = Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()));
      }
    } catch (e) { capMax = 4; }
    const want = (quality && Number.isFinite(quality.anisotropy)) ? quality.anisotropy : Math.min(8, capMax);
    _aniso = Math.max(1, Math.min(capMax, Math.round(want)));

    /* --- ported family ------------------------------------------------- */
    bakeStone();
    bakePanel();
    bakeMetal();
    bakeGrate();
    bakeIce();
    bakeGlass();
    bakeLava();
    bakeObsidian();
    bakeCrystal();
    bakeNeon();
    bakeHazard();
    bakeRubber();
    bakeConveyor();
    bakeWood();
    bakeCloud();
    bakeChecker();
    bakeEmissive();

    /* --- CRESTBOUND additions (dirt FIRST: it is the slope target) ------ */
    bakeDirt();
    bakeGrass();
    bakeSnow();
    bakeSand();
    bakePlaster();
    bakeBrick();
    bakeBark();
    bakeLeaves();
    bakeGold();
    bakeCloth();
    bakePainting();
    bakeMarble();
    bakeMoss();
    bakeCopper();
    bakeRope();
    bakeWater();

    bakeUtilityTextures();

    _ready = true;
    return Mats;
  },

  /**
   * Shared, cached material for (key, theme). NEVER clone the result per
   * object unless you actually need a per-object variation — the clone is
   * hook-preserving, so it is safe, but every clone is a new draw batch.
   *
   * @param {string} key   one of `Mats.keys`
   * @param {string} [themeId]
   * @returns {THREE.Material}
   */
  get(key, themeId) {
    if (!_ready) Mats.init(_renderer);
    let base = _base.get(key);
    if (!base) {
      console.warn('[Mats] unknown material key "' + key + '" — falling back to stone');
      base = _base.get('stone');
      key = 'stone';
    }
    const theme = (themeId && THEMES && THEMES[themeId]) ? THEMES[themeId] : null;
    if (!theme) return base;

    const ck = key + '|' + theme.id;
    let m = _themed.get(ck);
    if (!m) {
      if (key === 'water') {
        m = _waterFor(theme);
      } else {
        m = base.clone();
        m.name = 'cb.' + key + '.' + theme.id;
        m.userData.cbKey = key;
        m.userData.cbTheme = theme.id;
        applyOverride(m, base, theme, key);
      }
      _themed.set(ck, m);
    }
    return m;
  },

  /** true when the key exists (harnesses check every contract name) */
  has(key) { return _base.has(key) || KEYS.indexOf(key) !== -1; },

  /**
   * The material-LOD radius, in metres. Past `start` the injected extras (macro
   * de-tiler, rim, caustics) and the specular IBL fade out and stop being
   * evaluated; they reach zero at `start + fade`, so the radius itself is not
   * visible. One shared uniform - changing it costs nothing and recompiles
   * nothing.
   *
   * `start <= 0` DISABLES the LOD (the radius is pushed past any course), which
   * is what the ULTRA tier wants: it is the tier the contract allows to run
   * under target.
   *
   * @param {number} start metres, or <= 0 to disable
   * @param {number} [fade] metres of fade, default LOD_FADE
   */
  setLodDistance(start, fade) {
    const st = numOrAniso(start, LOD_START);
    const fd = Math.max(1, numOrAniso(fade, LOD_FADE));
    LOD_U.value.set(st > 0 ? st : 1e6, 1 / fd);
    return LOD_U.value.x;
  },

  /** metres at which the material LOD starts fading in (1e6 = disabled) */
  get lodDistance() { return LOD_U.value.x; },

  /**
   * The anisotropy every map this module uploaded is filtered with — the
   * QUALITY tier's `anisotropy`, resolved against the GPU's own maximum.
   * Other modules that build textures (builders, props, critters, hero,
   * collectibles, course) read THIS instead of hard-coding 4, so one tier
   * change moves every map in the game.
   */
  get anisotropy() { return _aniso; },

  /**
   * Re-filter every owned map. Called on a live quality change; a no-op when
   * the value has not moved, because `needsUpdate` on 100+ textures forces a
   * full re-upload.
   * @param {number} n
   */
  setAnisotropy(n) {
    const v = Math.max(1, Math.min(16, Math.round(numOrAniso(n, _aniso))));
    if (v === _aniso) return _aniso;
    _aniso = v;
    for (let i = 0; i < _owned.length; i++) {
      const t = _owned[i];
      if (t && t.anisotropy !== v) { t.anisotropy = v; t.needsUpdate = true; }
    }
    return _aniso;
  },

  /** procedural texture by name — 'noise','grunge','sparkle','radial',
   *  'scratch','caustic','ring' plus every baked map as
   *  '<key>.albedo' / '.orm' / '.normal' / '.emissive' / '.alpha'. */
  tex(name) {
    if (!_ready) Mats.init(_renderer);
    const t = _tex.get(name);
    if (!t) console.warn('[Mats] unknown texture "' + name + '"');
    return t || null;
  },

  /**
   * The SHARED uniform object for a key, so other modules can drive an
   * injected shader without reaching into a material:
   *   water.js  -> `Mats.uniforms('sand').uCbCaustic.value.set(y, strength, scale, speed)`
   *   water.js  -> `Mats.uniforms('water').uWaveA.value.set(...)`
   *   builders  -> `Mats.uniforms('leaves').uCbWind.value = 0.12`
   * Returns null for keys with no injected uniforms.
   */
  uniforms(key) {
    if (!_ready) Mats.init(_renderer);
    return _shaderU.get(key) || null;
  },

  /**
   * Point a caustic-capable key (currently `sand`) at a water surface. This is
   * the supported way to wire `water.js` to the floor under a lake:
   *
   *   Mats.setCaustics('sand', { surfaceY: 12.4, strength: 0.9, scale: 0.55,
   *                              speed: 0.9, color: 0x8fdcea });
   *
   * `strength: 0` disables it — the shader branch is skipped, so an unused key
   * costs nothing per pixel.
   *
   * @param {string} key
   * @param {object} o {surfaceY, strength, scale, speed, color, time}
   * @returns {boolean} true when the key actually carries caustic uniforms
   */
  setCaustics(key, o) {
    if (!_ready) Mats.init(_renderer);
    const u = _shaderU.get(key || 'sand');
    if (!u || !u.uCbCaustic || !u.uCbCausticParams) return false;
    const p = o || EMPTY_OPT;
    if (typeof p.surfaceY === 'number') u.uCbCausticParams.value.x = p.surfaceY;
    if (typeof p.scale === 'number') u.uCbCausticParams.value.y = p.scale;
    if (typeof p.speed === 'number') u.uCbCausticParams.value.z = p.speed;
    if (typeof p.strength === 'number') u.uCbCaustic.value = Math.max(0, p.strength);
    if (p.color !== undefined && u.uCbCausticColor) u.uCbCausticColor.value.set(p.color);
    if (p.time && typeof p.time.value === 'number') u.uCbCausticTime = p.time;
    return true;
  },

  /** uv units per world metre for a key — useful if a builder wants to author
   *  matching UVs on the ATTRIBUTE-UV keys (conveyor, hazard, bark, rope…). */
  uvScale(key) { return _uvScale.get(key) || 0.5; },

  /** true if the key's UVs come from world-space box projection */
  isBoxProjected(key) { return BOX_KEYS.has(key); },

  /** true if the key slope-blends toward dirt (the heightfield materials) */
  isSlopeBlended(key) { return SLOPE_KEYS.has(key); },

  /**
   * Advance every scrolling / flowing map. Values are derived from `elapsed`
   * (not integrated) so they are deterministic and never drift; if `elapsed`
   * is not supplied the module keeps its own clock from `dt`.
   * Allocation-free.
   */
  tick(dt, elapsed) {
    if (!_ready) return;
    const d = (typeof dt === 'number' && isFinite(dt)) ? dt : 0;
    let t = (typeof elapsed === 'number' && isFinite(elapsed)) ? elapsed : (_clock + d);
    // wrap so 32-bit float precision never degrades the noise after a long run
    if (t > 100000) t -= 100000;
    _clock = t;
    TIME_U.value = t;

    // lava — base crust drifts, the two emissive flow layers cross-scroll
    const lavaU = _shaderU.get('lava');
    if (lavaU && lavaU.uCbFlow) lavaU.uCbFlow.value.set(frac(t * 0.011), frac(t * -0.008));
    LAVA_U.uCbTime.value = t;
    LAVA_U.uCbFlowA.value.set(frac(t * 0.028), frac(t * -0.016));
    LAVA_U.uCbFlowB.value.set(frac(t * -0.013), frac(t * 0.024));

    // hazard chevrons march toward +U (attribute UVs -> animate texture offsets)
    const hz = _tex.get('hazard.albedo'), hzE = _tex.get('hazard.emissive');
    const hzO = _tex.get('hazard.orm'), hzN = _tex.get('hazard.normal');
    const hazOff = frac(t * 0.16);
    if (hz) hz.offset.x = hazOff;
    if (hzE) hzE.offset.x = hazOff;
    if (hzO) hzO.offset.x = hazOff;
    if (hzN) hzN.offset.x = hazOff;

    // conveyor belt runs toward +V
    const cvA = _tex.get('conveyor.albedo'), cvE = _tex.get('conveyor.emissive');
    const cvO = _tex.get('conveyor.orm'), cvN = _tex.get('conveyor.normal');
    const belt = frac(t * 0.34);
    if (cvA) cvA.offset.y = belt;
    if (cvE) cvE.offset.y = belt;
    if (cvO) cvO.offset.y = belt;
    if (cvN) cvN.offset.y = belt;

    // cloud platforms breathe very slowly
    const cl = _shaderU.get('cloud');
    if (cl && cl.uCbFlow) cl.uCbFlow.value.set(frac(t * 0.0045), frac(t * 0.0031));

    // ice + snow sparkle creep so the glitter is never static
    const ice = _shaderU.get('ice');
    if (ice && ice.uCbFlow) ice.uCbFlow.value.set(frac(t * 0.0018), frac(t * -0.0012));
    const sn = _shaderU.get('snow');
    if (sn && sn.uCbFlow) sn.uCbFlow.value.set(frac(t * 0.0009), frac(t * 0.0006));

    // living light: neon strips pulse ~5% (reads as life, not as a warning),
    // crystal cores breathe on a slower, offset beat so the two never sync,
    // and the Keep's paintings glow on a third, slower one again.
    _pulseNeon = 1 + 0.055 * Math.sin(t * 1.9) + 0.025 * Math.sin(t * 5.3 + 1.1);
    _pulseCrystal = 1 + 0.09 * Math.sin(t * 0.85 + 2.2);
    _pulseGold = 1 + 0.14 * Math.sin(t * 0.62 + 0.7);
    applyPulse(_base.get('neon'), _pulseNeon);
    applyPulse(_base.get('crystal'), _pulseCrystal);
    applyPulse(_base.get('painting'), _pulseGold);
    _themed.forEach(pulseThemed);
  },

  /**
   * Alias for `tick()`. `world/course.js` drives the shared animation clocks as
   * `mats.update(dt, elapsed)` once per frame; the contract names no method for
   * this, so BOTH spellings exist and mean exactly the same thing. Do not
   * remove it: without it that call silently no-ops (it is feature-detected)
   * and every scrolling map in the game — hazard chevrons, conveyor belts, the
   * lava flow layers, the neon and crest pulses — freezes.
   */
  update(dt, elapsed) { return Mats.tick(dt, elapsed); },

  /** free every GPU resource this module owns */
  dispose() {
    _themed.forEach((m) => m.dispose());
    _base.forEach((m) => m.dispose());
    for (let i = 0; i < _owned.length; i++) {
      const t = _owned[i];
      if (t.image && t.image.width) { t.image.width = 1; t.image.height = 1; }
      t.dispose();
    }
    _owned.length = 0;
    _themed.clear();
    _base.clear();
    _tex.clear();
    _uvScale.clear();
    _shaderU.clear();
    _ready = false;
    _clock = 0;
    _renderer = null;
  },
};

export default Mats;
