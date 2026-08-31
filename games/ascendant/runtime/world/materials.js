/**
 * ASCENDANT — runtime/world/materials.js
 * CONTRACT section 8.
 *
 * The PBR material library. Every material is built from procedurally generated
 * textures (albedo + packed ORM + tangent-space normal + optional emissive/alpha).
 * There is not a single `new MeshStandardMaterial({color})` in this file.
 *
 * ---------------------------------------------------------------------------
 * UV POLICY — READ THIS IF YOU WRITE GEOMETRY
 * ---------------------------------------------------------------------------
 * Sixteen of the eighteen materials are WORLD-SPACE BOX PROJECTED in the vertex
 * shader (see `injectBoxProjection`). Their texture coordinates are derived from
 * world position + world normal, so:
 *    - geometry does NOT need correct UVs (a raw BoxGeometry is fine),
 *    - texture scale is physically correct no matter how big the platform is,
 *    - texture detail flows CONTINUOUSLY across adjacent platforms — which is a
 *      big part of why this reads as a built world and not as a pile of cubes.
 *
 * The two exceptions need direction relative to the object, so they use the
 * geometry's own UVs:
 *    - 'conveyor'  V must run ALONG the belt's travel direction (treads are
 *                  bands of constant V; the belt scrolls toward +V).
 *    - 'hazard'    U must run ALONG the hazard's long axis (chevrons point
 *                  toward +U and scroll that way).
 * For those two, map UV in world metres (1 uv unit = 1 m) and everything lines up.
 *
 * If the shader injection ever fails (a three.js chunk rename), every material
 * silently falls back to attribute UVs and each texture's `repeat` is preset to
 * the same metres-per-tile value, so the world still tiles sanely.
 *
 * ---------------------------------------------------------------------------
 * CACHING
 * ---------------------------------------------------------------------------
 * `get(key, themeId)` returns a SHARED material cached per (key, theme). Theme
 * variation is colour/roughness/emissive multiplication on a clone that reuses
 * the *same* textures — never a second texture bake, never a per-object clone.
 */

import * as THREE from 'three';
import { THEMES } from './themes.js';

/* ========================================================================== *
 * 0. constants / module state                                                *
 * ========================================================================== */

const SIZE_LG = 512;
const SIZE_MD = 256;
const SIZE_SM = 128;

/** every material key the contract promises */
const KEYS = [
  'stone', 'metal', 'panel', 'grate', 'ice', 'glass', 'emissive', 'lava',
  'obsidian', 'crystal', 'wood', 'sand', 'neon', 'checker', 'hazard',
  'rubber', 'conveyor', 'cloud',
];

/** materials whose UVs come from world-space box projection */
const BOX_KEYS = new Set([
  'stone', 'metal', 'panel', 'grate', 'ice', 'glass', 'emissive', 'lava',
  'obsidian', 'crystal', 'wood', 'sand', 'neon', 'checker', 'rubber', 'cloud',
]);

let _renderer = null;
let _ready = false;
let _aniso = 4;
let _clock = 0;
let _injectWarned = false;

const _tex = new Map();      // name -> THREE.Texture           (public via tex())
const _base = new Map();     // key  -> THREE.Material          (untinted template)
const _themed = new Map();   // 'key|themeId' -> THREE.Material (tinted clone)
const _uvScale = new Map();  // key  -> uv units per world metre
const _shaderU = new Map();  // key  -> {uAscUv,uAscUv2,uAscFlow}
const _owned = [];           // every texture we created, for dispose()

/** shared, animated uniforms (referenced by every clone of a key) */
const LAVA_U = {
  uAscTime: { value: 0 },
  uAscFlowA: { value: new THREE.Vector2() },
  uAscFlowB: { value: new THREE.Vector2() },
};

/* scratch — hoisted, never allocated in a loop or an update path */
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const W = { f1: 0, f2: 0, id: 0 };

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
 * dirt streaks) - scaling the *input* instead breaks the tile, because the
 * lattice no longer completes a whole number of cells across the texture.
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

/** domain-warped anisotropic fBm - the wood-grain generator */
function warpedFbmXY(x01, y01, cellsX, cellsY, oct, gain, seed, warp) {
  const hx = Math.max(1, cellsX >> 1), hy = Math.max(1, cellsY >> 1);
  const wx = fbmXY(x01, y01, hx, hy, 3, 0.5, seed + 5501) - 0.5;
  const wy = fbmXY(x01, y01, hx, hy, 3, 0.5, seed + 9902) - 0.5;
  return fbmXY(x01 + wx * warp, y01 + wy * warp, cellsX, cellsY, oct, gain, seed);
}

/** Ridged multifractal - sharp creases, ideal for rock and ice fractures. */
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

/** domain-warped fbm — used for wood grain and smoke-like albedo drift */
function warpedFbm(x01, y01, cells, oct, gain, seed, warp) {
  const wx = fbm(x01, y01, cells * 0.5, 3, 0.5, seed + 5501) - 0.5;
  const wy = fbm(x01, y01, cells * 0.5, 3, 0.5, seed + 9902) - 0.5;
  return fbm(x01 + wx * warp, y01 + wy * warp, cells, oct, gain, seed);
}

/* ---------------------------------------------------------------- canvases */

function makeCanvas(n) {
  const cv = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: n, height: n, getContext: () => null };
  cv.width = n;
  cv.height = n;
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
 * visible seam across every grate in the game. rows ~= cols * 2/sqrt(3),
 * rounded to even, keeps the holes near-regular.
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

function upload(cv, name, srgb, repeat) {
  const t = new THREE.CanvasTexture(cv);
  t.name = name;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
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

/** a small working set: three float fields + three RGBA buffers, reused per bake */
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

/* ========================================================================== *
 * 3. material assembly                                                       *
 * ========================================================================== */

/**
 * World-space box projection + shader-driven scroll, injected into a stock
 * three.js material. Defensive: if a chunk marker is missing (three rename) the
 * injection is skipped entirely and the material falls back to attribute UVs.
 */
function injectBoxProjection(mat, key, uvScale, uv2Mul, extraFragment) {
  const u = {
    uAscUv: { value: new THREE.Vector2(uvScale, uvScale) },
    uAscUv2: { value: uv2Mul || 1 },
    uAscFlow: { value: new THREE.Vector2(0, 0) },
  };
  _shaderU.set(key, u);

  const isLava = key === 'lava';

  mat.onBeforeCompile = function (shader) {
    shader.uniforms.uAscUv = u.uAscUv;
    shader.uniforms.uAscUv2 = u.uAscUv2;
    shader.uniforms.uAscFlow = u.uAscFlow;
    if (isLava) {
      shader.uniforms.uAscTime = LAVA_U.uAscTime;
      shader.uniforms.uAscFlowA = LAVA_U.uAscFlowA;
      shader.uniforms.uAscFlowB = LAVA_U.uAscFlowB;
    }

    const MARK = '#include <project_vertex>';
    if (shader.vertexShader.indexOf(MARK) === -1) {
      if (!_injectWarned) {
        _injectWarned = true;
        console.warn('[Mats] box-projection marker not found — falling back to attribute UVs');
      }
      return;
    }

    shader.vertexShader =
      'uniform vec2 uAscUv;\nuniform float uAscUv2;\nuniform vec2 uAscFlow;\nvarying vec3 vAscW;\n' +
      shader.vertexShader.replace(MARK, MARK + `
  // --- ASCENDANT world-space box projection -------------------------------
  // mirrors the batching/instancing chain that <project_vertex> applies, so an
  // InstancedMesh of decor projects at its instance transform, not the base one
  vec4 ascP = vec4( transformed, 1.0 );
  vec3 ascNo = objectNormal;
  #ifdef USE_BATCHING
    ascP = batchingMatrix * ascP;
    ascNo = mat3( batchingMatrix ) * ascNo;
  #endif
  #ifdef USE_INSTANCING
    ascP = instanceMatrix * ascP;
    ascNo = mat3( instanceMatrix ) * ascNo;
  #endif
  vec3 ascW = ( modelMatrix * ascP ).xyz;
  vec3 ascN = normalize( mat3( modelMatrix ) * ascNo );
  vAscW = ascW;
  vec3 ascA = abs( ascN );
  vec2 ascUv;
  if ( ascA.y >= ascA.x && ascA.y >= ascA.z ) {
    ascUv = vec2( ascW.x, ascW.z );
  } else if ( ascA.x >= ascA.z ) {
    ascUv = vec2( ascW.z, ascW.y );
  } else {
    ascUv = vec2( ascW.x, ascW.y );
  }
  ascUv = ascUv * uAscUv + uAscFlow;
  #ifdef USE_MAP
    vMapUv = ascUv;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = ascUv;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = ascUv;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv = ascUv;
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv = ascUv;
  #endif
  #ifdef USE_ALPHAMAP
    vAlphaMapUv = ascUv;
  #endif
  #ifdef USE_CLEARCOAT_NORMALMAP
    vClearcoatNormalMapUv = ascUv * uAscUv2;
  #endif
  // ------------------------------------------------------------------------`);

    let fragHead = 'varying vec3 vAscW;\n';
    if (isLava) fragHead += 'uniform float uAscTime;\nuniform vec2 uAscFlowA;\nuniform vec2 uAscFlowB;\n';
    shader.fragmentShader = fragHead + shader.fragmentShader;

    if (isLava) {
      const EM = '#include <emissivemap_fragment>';
      if (shader.fragmentShader.indexOf(EM) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(EM, `
  #ifdef USE_EMISSIVEMAP
    // two independently scrolling flow layers -> molten rock that never loops
    vec3 lavaA = texture2D( emissiveMap, vEmissiveMapUv + uAscFlowA ).rgb;
    vec3 lavaB = texture2D( emissiveMap, vEmissiveMapUv * 0.61 + uAscFlowB ).rgb;
    vec3 lavaMix = max( lavaA, lavaB * 0.88 );
    float lavaPulse = 0.80 + 0.30 * sin( uAscTime * 1.35 + vAscW.x * 0.42 + vAscW.z * 0.31 );
    float lavaHeat = smoothstep( 0.06, 0.55, max( lavaMix.r, lavaMix.g ) );
    totalEmissiveRadiance *= lavaMix * mix( 0.75, lavaPulse, lavaHeat );
    // molten channels are smoother and less metallic than the frozen crust
    roughnessFactor = mix( roughnessFactor, 0.30, lavaHeat * 0.85 );
  #endif`);
      }
    }

    if (extraFragment) {
      const MK = '#include <color_fragment>';
      if (shader.fragmentShader.indexOf(MK) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(MK, MK + '\n' + extraFragment);
      }
    }
  };

  mat.customProgramCacheKey = function () {
    return isLava ? 'asc-lava' : (extraFragment ? 'asc-box-' + key : 'asc-box');
  };
  return mat;
}

/**
 * `THREE.Material.copy()` copies an explicit field list that does NOT include
 * `onBeforeCompile` / `customProgramCacheKey`. A plain `.clone()` of one of our
 * materials would therefore silently lose world-space box projection and fall
 * back to attribute UVs — a vanishing platform would suddenly wear a different
 * texture scale from the platform beside it.
 *
 * Downstream code legitimately clones these (hazards/vanish.js, movers.js and
 * rotors.js each clone a shared platform material to animate opacity or trim),
 * so we install a clone that carries the hooks — and installs itself on the
 * copy, so clone-of-a-clone keeps working too.
 */
function installHookPreservingClone(mat) {
  mat.clone = function () {
    const c = new this.constructor().copy(this);
    c.onBeforeCompile = this.onBeforeCompile;
    c.customProgramCacheKey = this.customProgramCacheKey;
    c.clone = this.clone;
    c.userData.ascKey = this.userData.ascKey;
    c.userData.ascUvScale = this.userData.ascUvScale;
    c.userData.baseEmissive = this.userData.baseEmissive;
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
 */
function assemble(key, maps, params, uvScale, uv2Mul, extraFragment) {
  const physical = !!params.__physical;
  delete params.__physical;

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
  mat.name = 'asc.' + key;
  mat.userData.ascKey = key;
  mat.userData.ascUvScale = uvScale;
  mat.userData.baseEmissive = mat.emissiveIntensity || 0;

  if (BOX_KEYS.has(key)) injectBoxProjection(mat, key, uvScale, uv2Mul, extraFragment);
  installHookPreservingClone(mat);

  _uvScale.set(key, uvScale);
  _base.set(key, mat);
  return mat;
}

/* ========================================================================== *
 * 4. the bakes                                                               *
 * ========================================================================== */

/* -------------------------------------------------------------- 4.1 stone */
/** Chipped granite: worley crack network, mineral speckle, dust in the crevices. */
function bakeStone() {
  const n = SIZE_LG, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data;
  const chipMask = new Float32Array(n * n);

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;

      const swell = fbm(u, v, 5, 5, 0.52, 91);
      const grit = fbm(u, v, 44, 3, 0.5, 313);

      worley(u, v, 9, 1201);
      const crack = 1 - smoothstep(0.0, 0.075, W.f2 - W.f1);   // 1 on the crack
      worley(u, v, 26, 5507);
      const chip = smoothstep(0.16, 0.05, W.f1) * (hash2i(x >> 4, y >> 4, 77) > 0.72 ? 1 : 0);
      chipMask[i] = chip;

      let h = 0.52 + (swell - 0.5) * 0.55 + (grit - 0.5) * 0.13;
      h -= crack * 0.30;
      h -= chip * 0.22;
      B.h[i] = h;

      // mineral speckle: three feldspar/quartz/biotite populations
      const sp = hash2i(x, y, 4409);
      let base = 0.40 + (swell - 0.5) * 0.20 + (grit - 0.5) * 0.10;
      let r = base * 1.04, g = base * 1.02, b = base;
      if (sp > 0.972) { r = 0.80; g = 0.82; b = 0.86; }        // quartz fleck
      else if (sp < 0.026) { r = 0.11; g = 0.11; b = 0.13; }   // biotite fleck
      else if (sp > 0.93) { r *= 1.16; g *= 1.12; b *= 1.06; }

      // dust settles in the low ground and warms it
      const low = clamp01((0.52 - h) * 2.4);
      const dust = low * low * 0.55 * (0.5 + 0.5 * grit);
      r = lerp(r, 0.70, dust); g = lerp(g, 0.66, dust); b = lerp(b, 0.56, dust);

      // crack interiors go dark and rough
      r = lerp(r, 0.07, crack * 0.85); g = lerp(g, 0.07, crack * 0.85); b = lerp(b, 0.08, crack * 0.85);

      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p + 1] = clamp(0.94 - (swell - 0.5) * 0.16 + crack * 0.05 - chip * 0.10, 0.42, 1) * 255;
      O[p + 2] = 6;                                            // effectively dielectric
      O[p + 3] = 255;
    }
  }

  // bake contact occlusion from the blurred height field into albedo + ORM.R
  const ao = blurField(B.h, n, 5);
  for (let i = 0, p = 0; i < n * n; i++, p += 4) {
    const occ = clamp01(0.55 + (B.h[i] - ao[i]) * 3.4 + 0.45);
    const k = 0.52 + 0.48 * occ;
    A[p] *= k; A[p + 1] *= k; A[p + 2] *= k;
    O[p] = occ * 255;
  }

  const maps = {
    map: upload(commitA(B), 'stone.albedo', true, 0.34),
    orm: upload(commitO(B), 'stone.orm', false, 0.34),
    normal: upload(heightToNormal(B.h, n, 1.35), 'stone.normal', false, 0.34),
  };
  return assemble('stone', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(1.05, 1.05), envMapIntensity: 0.6,
  }, 0.34);
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

  const ao = blurField(B.h, n, 4);
  for (let i = 0, p = 0; i < n * n; i++, p += 4) {
    const occ = clamp01(0.62 + (B.h[i] - ao[i]) * 3.0 + 0.38);
    const k = 0.60 + 0.40 * occ;
    A[p] *= k; A[p + 1] *= k; A[p + 2] *= k;
    O[p] = occ * 255;
  }

  const maps = {
    map: upload(commitA(B), 'panel.albedo', true, 0.5),
    orm: upload(commitO(B), 'panel.orm', false, 0.5),
    normal: upload(heightToNormal(B.h, n, 1.15), 'panel.normal', false, 0.5),
  };
  return assemble('panel', maps, {
    color: 0xffffff, roughness: 1, metalness: 1,
    normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 1.0,
  }, 0.5);
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
  }, 0.30, 5.5);
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
 *  scrolling flow layers live in the injected fragment shader. */
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
  }, 0.13);
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
      const g = warpedFbmXY(u + off, pv + off * 3.0, 4, 2, 4, 0.55, 71 + pi * 37, 0.30);
      let ring = frac(g * 11.0 + u * 2.0);   // 2 whole cycles across the tile -> wraps
      ring = Math.abs(ring - 0.5) * 2;
      const grain = smoothstep(0.55, 0.95, ring);

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

  const ao = blurField(B.h, n, 4);
  for (let i = 0, p = 0; i < n * n; i++, p += 4) {
    const occ = clamp01(0.60 + (B.h[i] - ao[i]) * 3.2 + 0.40);
    const k = 0.62 + 0.38 * occ;
    A[p] *= k; A[p + 1] *= k; A[p + 2] *= k;
    O[p] = occ * 255;
  }

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

/* --------------------------------------------------------------- 4.15 sand */
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

      /* ripple weight was 0.16 — under a flat fill the dune structure produced
       * no visible normal response at all and the money-shot blocks read as a
       * uniform speckle (temple-1_1, 2026-08-31 critic pass). The wind-ripple
       * field now DOMINATES the height and the albedo shades with it, so the
       * surface reads as sand from 2 m and from 25 m. */
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
  }, 0.55);
}

/* -------------------------------------------------------------- 4.16 cloud */
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
      let r = lerp(0.640, 0.985, lit);
      let g = lerp(0.700, 0.992, lit);
      let b = lerp(0.800, 1.000, lit);
      A[p] = r * 255; A[p + 1] = g * 255; A[p + 2] = b * 255; A[p + 3] = 255;
      O[p] = 255;
      O[p + 1] = 252;
      O[p + 2] = 0;
      O[p + 3] = 255;
    }
  }

  const ao = blurField(B.h, n, 7);
  for (let i = 0, p = 0; i < n * n; i++, p += 4) {
    const occ = clamp01(0.55 + (B.h[i] - ao[i]) * 2.4 + 0.45);
    const k = 0.70 + 0.30 * occ;
    A[p] *= k; A[p + 1] *= k; A[p + 2] *= k;
    O[p] = occ * 255;
  }

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

/* ------------------------------------------------------------ 4.17 checker */
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

  const ao = blurField(B.h, n, 4);
  for (let i = 0, p = 0; i < n * n; i++, p += 4) {
    const occ = clamp01(0.66 + (B.h[i] - ao[i]) * 2.8 + 0.34);
    const k = 0.66 + 0.34 * occ;
    A[p] *= k; A[p + 1] *= k; A[p + 2] *= k;
    O[p] = occ * 255;
  }

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

/* ----------------------------------------------------------- 4.18 emissive */
/** Pure light trim: black body, emissive map does all the work. */
function bakeEmissive() {
  const n = SIZE_SM, B = bakeBuffers(n);
  const A = B.imgA.data, O = B.imgO.data, E = B.imgE.data;

  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x, p = i * 4;
      const flow = fbm(u, v, 5, 3, 0.55, 5959);
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

/* --------------------------------------------- 4.19 loose utility textures */
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

  // 'radial' — the soft blob used for contact shadows / glow sprites
  {
    const cv = makeCanvas(n), c = ctx2d(cv);
    c.clearRect(0, 0, n, n);
    const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, n, n);
    const t = upload(cv, 'radial', true, 1);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
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
}

/* ========================================================================== *
 * 5. theme tinting                                                           *
 * ========================================================================== */

/**
 * A materialOverride entry (authored in themes.js) may carry:
 *   tint                hex, MULTIPLIED into the base colour
 *   color               hex, REPLACES the base colour
 *   rough / metal       signed deltas applied to the scalar factors
 *   roughness/metalness absolute values
 *   emissive            hex emissive colour
 *   emissiveIntensity   absolute
 *   env                 envMapIntensity multiplier
 *   sheenColor / attenuationColor / clearcoat / transmission / opacity
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

  if (mat.isMeshPhysicalMaterial) {
    if (o.sheenColor !== undefined && mat.sheenColor) mat.sheenColor.set(o.sheenColor);
    if (o.attenuationColor !== undefined && mat.attenuationColor) mat.attenuationColor.set(o.attenuationColor);
    if (o.attenuationDistance !== undefined) mat.attenuationDistance = o.attenuationDistance;
    if (o.clearcoat !== undefined) mat.clearcoat = clamp01(o.clearcoat);
    if (o.transmission !== undefined) mat.transmission = clamp01(o.transmission);
    if (o.iridescence !== undefined) mat.iridescence = clamp01(o.iridescence);
  }
  // capture the post-override intensity: tick() pulses relative to THIS value,
  // so a theme that dims or brightens its neon keeps that choice.
  mat.userData.baseEmissive = mat.emissiveIntensity || 0;
  return mat;
}

/* ========================================================================== *
 * 6. public API                                                              *
 * ========================================================================== */

/* pulse state — module scope so the per-frame Map walk allocates nothing */
let _pulseNeon = 1;
let _pulseCrystal = 1;

function applyPulse(m, k) {
  if (!m) return;
  const b = m.userData.baseEmissive;
  if (!b) return;
  m.emissiveIntensity = b * k;
}

function pulseThemed(m) {
  const k = m.userData.ascKey;
  if (k === 'neon') applyPulse(m, _pulseNeon);
  else if (k === 'crystal') applyPulse(m, _pulseCrystal);
}

export const Mats = {
  /** every material key this library answers to (contract section 8) */
  keys: KEYS.slice(),

  /** true once init() has finished baking */
  get ready() { return _ready; },

  /**
   * Bake every procedural texture and build every base material. Idempotent —
   * calling twice is a no-op. Safe to call without a renderer (anisotropy 4).
   */
  init(renderer) {
    if (_ready) return Mats;
    _renderer = renderer || null;
    try {
      if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
        _aniso = Math.max(1, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
      }
    } catch (e) { _aniso = 4; }

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
    bakeSand();
    bakeCloud();
    bakeChecker();
    bakeEmissive();
    bakeUtilityTextures();

    _ready = true;
    return Mats;
  },

  /**
   * Shared, cached material for (key, theme). NEVER clone the result per object —
   * if you need a one-off variation, ask for a different key.
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
      m = base.clone();
      m.name = 'asc.' + key + '.' + theme.id;
      m.userData.ascKey = key;
      m.userData.ascTheme = theme.id;
      applyOverride(m, base, theme, key);
      _themed.set(ck, m);
    }
    return m;
  },

  /** procedural texture by name — 'noise','grunge','sparkle','radial','scratch'
   *  plus every baked map as '<key>.albedo' / '.orm' / '.normal' / '.emissive'. */
  tex(name) {
    if (!_ready) Mats.init(_renderer);
    const t = _tex.get(name);
    if (!t) console.warn('[Mats] unknown texture "' + name + '"');
    return t || null;
  },

  /** uv units per world metre for a key — useful if a builder wants to author
   *  matching UVs on 'conveyor'/'hazard', which are not box-projected. */
  uvScale(key) { return _uvScale.get(key) || 0.5; },

  /** true if the key's UVs come from world-space box projection */
  isBoxProjected(key) { return BOX_KEYS.has(key); },

  /**
   * Advance every scrolling / flowing map. Values are derived from `elapsed`
   * (not integrated) so they are deterministic and never drift; if `elapsed` is
   * not supplied the module keeps its own clock from `dt`.
   */
  tick(dt, elapsed) {
    if (!_ready) return;
    const d = (typeof dt === 'number' && isFinite(dt)) ? dt : 0;
    const t = (typeof elapsed === 'number' && isFinite(elapsed)) ? elapsed : (_clock + d);
    _clock = t;

    // lava — base crust drifts, the two emissive flow layers cross-scroll
    const lavaU = _shaderU.get('lava');
    if (lavaU) lavaU.uAscFlow.value.set(frac(t * 0.011), frac(t * -0.008));
    LAVA_U.uAscTime.value = t;
    LAVA_U.uAscFlowA.value.set(frac(t * 0.028), frac(t * -0.016));
    LAVA_U.uAscFlowB.value.set(frac(t * -0.013), frac(t * 0.024));

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
    if (cl) cl.uAscFlow.value.set(frac(t * 0.0045), frac(t * 0.0031));

    // ice sparkle creeps so the glitter is never static
    const ice = _shaderU.get('ice');
    if (ice) ice.uAscFlow.value.set(frac(t * 0.0018), frac(t * -0.0012));

    // living light: neon strips pulse ~5% (reads as life, not as a warning),
    // crystal cores breathe on a slower, offset beat so the two never sync.
    _pulseNeon = 1 + 0.055 * Math.sin(t * 1.9) + 0.025 * Math.sin(t * 5.3 + 1.1);
    _pulseCrystal = 1 + 0.09 * Math.sin(t * 0.85 + 2.2);
    applyPulse(_base.get('neon'), _pulseNeon);
    applyPulse(_base.get('crystal'), _pulseCrystal);
    _themed.forEach(pulseThemed);
  },

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
