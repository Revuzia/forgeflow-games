/**
 * ASCENDANT — runtime/world/builders.js
 * ---------------------------------------------------------------------------
 * How a platform is BUILT. This module is the whole difference between "a pile
 * of boxes" and an obby that survives a side-by-side against a AAA trailer.
 *
 * Every landable surface gets, in order of visual priority:
 *   1. a LEADING-EDGE STRIPE  — a 0.12 m emissive band on the faces you jump
 *      toward. Readable from 25 m. This is the single most important feature in
 *      the game; it is what turns "guessing the edge" into "reading the edge".
 *   2. an accent RIM/TRIM line around the top perimeter (quiet, always on).
 *   3. a recessed top PANEL inset 0.06 m with its own material.
 *   4. a CHAMFERED slab body — there is no naked BoxGeometry anywhere here.
 *   5. corner CAPS / bolt studs on anything above 2 m wide.
 *   6. an UNDERSIDE with a darker underlayer and ribs, so looking up from a
 *      fall still looks composed.
 *
 * Art is complicated; collision is not. Every builder returns the simple OBB of
 * its structural body as the collider list.
 *
 * ARCHITECTURE NOTES
 *  - Every geometry produced here is NON-INDEXED with exactly {position, normal,
 *    uv}. That makes `mergeGeometries` legal in any combination, always.
 *  - Finished composite geometries are cached by a signature string built from
 *    dimensions rounded to 1 mm, so 200 identical platforms share ONE
 *    BufferGeometry. Cached geometries carry `userData.__shared` and are never
 *    mutated in place (see `edgeStripe`, `mergeStatic`).
 *  - No per-frame heap allocation: scratch vectors/matrices are module scope,
 *    and shader animation rides on ONE shared uniform object (`FX_TIME`).
 *
 * @module runtime/world/builders
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Collider } from './collider.js';

// ---------------------------------------------------------------------------
// scratch (module scope — never allocate in a build or update path)
// ---------------------------------------------------------------------------
const _v0 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _e0 = new THREE.Euler();
const _s0 = new THREE.Vector3(1, 1, 1);
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _col = new THREE.Color();

/** Shared animation clock. ONE object, read by every animated material. */
const FX_TIME = { value: 0 };
let _fxPinned = false;

/**
 * Pin the effect clock for deterministic capture/replay. Pass null to unpin and
 * return to wall time.
 * @param {number|null} t seconds
 */
export function setFxTime(t) {
  if (t === null || t === undefined) { _fxPinned = false; return; }
  _fxPinned = true;
  FX_TIME.value = t;
}

/** onBeforeRender hook: advances the shared clock at most once per frame. */
function syncFxTime() {
  if (!_fxPinned) {
    FX_TIME.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
  }
}

// ---------------------------------------------------------------------------
// palette helpers
// ---------------------------------------------------------------------------
const DEFAULT_PALETTE = {
  safe: 0x9fb2c9,
  safeEdge: 0x7ef0ff,
  kill: 0xff3a1f,
  killGlow: 0xffb03a,
  checkpoint: 0x2f6fa8,
  checkpointOn: 0x59ffc4,
  finish: 0xffd76a,
  accent: 0x4fb9ff,
  deco: 0x6f86a8,
  /* pad = the jump/speed-pad family's world identity. Round 2 (2026-08-31):
   * jump pads wore `checkpointOn` verbatim, which is why one mint pad showed
   * up in EVERY world — pads now carry a per-theme colour that is NOT the
   * checkpoint armed signal. */
  pad: 0x4fb9ff,
};

/** Read a palette colour from a ThemeDef, with a hard fallback. */
function pal(theme, key) {
  const p = (theme && theme.palette) || null;
  const v = (p && p[key] !== undefined && p[key] !== null) ? p[key] : DEFAULT_PALETTE[key];
  return v === undefined ? 0xffffff : v;
}

function themeId(theme) {
  return (theme && (theme.id || theme.name)) || 'default';
}

// ---------------------------------------------------------------------------
// procedural texture bank
// ---------------------------------------------------------------------------
// This is the FALLBACK material set, used whenever the caller does not hand us
// the shared Mats service. It has to look good on its own, so it is real PBR:
// albedo + roughness map + a sobel-derived normal map, all canvas generated,
// six surface families, generated once and shared.
// ---------------------------------------------------------------------------
const _texCache = new Map();

function makeCanvas(size) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

/** Deterministic hash noise — identical every run, holds no RNG state. */
function vnoise(x, y, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = vnoise(xi, yi, seed), b = vnoise(xi + 1, yi, seed);
  const c = vnoise(xi, yi + 1, seed), d = vnoise(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, seed, octaves) {
  let f = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    f += amp * smoothNoise(x * freq, y * freq, seed + i * 7919);
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return f / norm;
}

/** Greyscale height/detail field for a surface family. */
function heightField(kind, size, seed) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size, fy = y / size;
      let v;
      if (kind === 'panel') {
        const cell = 4;
        const gx = Math.abs((fx * cell) % 1 - 0.5) * 2;
        const gy = Math.abs((fy * cell) % 1 - 0.5) * 2;
        const seam = Math.min(1, Math.pow(Math.max(gx, gy), 14));
        const ru = ((fx * cell) % 1) - 0.5, rv = ((fy * cell) % 1) - 0.5;
        const rd = Math.sqrt(ru * ru + rv * rv);
        const rivet = (rd < 0.44 && rd > 0.385) ? 0.5 : 0;
        v = 0.62 - seam * 0.42 + rivet + fbm(fx * 22, fy * 22, seed, 3) * 0.14;
      } else if (kind === 'speckle') {
        const g = fbm(fx * 9, fy * 9, seed, 5);
        const sp = vnoise(x * 3, y * 3, seed + 17) > 0.955 ? 0.34 : 0;
        v = 0.42 + g * 0.5 + sp;
      } else if (kind === 'streak') {
        v = 0.5 + (fbm(fx * 3, fy * 96, seed, 4) - 0.5) * 0.85
              + (fbm(fx * 30, fy * 6, seed + 3, 2) - 0.5) * 0.2;
      } else if (kind === 'weave') {
        const w = Math.sin(fx * Math.PI * 26) * Math.sin(fy * Math.PI * 26);
        v = 0.52 + w * 0.2 + (fbm(fx * 16, fy * 16, seed, 3) - 0.5) * 0.4;
      } else if (kind === 'facet') {
        const cx = Math.floor(fx * 7) + 0.5, cy = Math.floor(fy * 7) + 0.5;
        const dd = Math.hypot(fx * 7 - cx, fy * 7 - cy);
        v = 0.35 + (1 - dd) * 0.55 + (fbm(fx * 12, fy * 12, seed, 2) - 0.5) * 0.2;
      } else {
        v = fbm(fx * 7, fy * 7, seed, 5) * 0.72 + fbm(fx * 41, fy * 41, seed + 11, 2) * 0.28;
      }
      h[y * size + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return h;
}

function fieldToAlbedo(h, size, contrast, floorV) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < h.length; i++) {
    const v = floorV + (h[i] - 0.5) * contrast;
    const s = Math.round(255 * (v < 0 ? 0 : v > 1 ? 1 : v));
    img.data[i * 4] = s; img.data[i * 4 + 1] = s; img.data[i * 4 + 2] = s; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function fieldToLinear(h, size, lo, hi) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < h.length; i++) {
    const v = lo + h[i] * (hi - lo);
    const s = Math.round(255 * (v < 0 ? 0 : v > 1 ? 1 : v));
    img.data[i * 4] = s; img.data[i * 4 + 1] = s; img.data[i * 4 + 2] = s; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function fieldToNormal(h, size, strength) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const SURFACE_FAMILY = {
  grain:   { kind: 'grain',   contrast: 0.42, floor: 0.62, rough: [0.55, 0.95], norm: 2.4 },
  panel:   { kind: 'panel',   contrast: 0.36, floor: 0.70, rough: [0.30, 0.78], norm: 3.4 },
  speckle: { kind: 'speckle', contrast: 0.50, floor: 0.62, rough: [0.62, 0.98], norm: 2.8 },
  streak:  { kind: 'streak',  contrast: 0.30, floor: 0.74, rough: [0.18, 0.62], norm: 1.6 },
  weave:   { kind: 'weave',   contrast: 0.34, floor: 0.66, rough: [0.55, 0.92], norm: 2.0 },
  facet:   { kind: 'facet',   contrast: 0.44, floor: 0.68, rough: [0.06, 0.40], norm: 2.2 },
};

/** Build (once) and return the texture triple for a surface family. */
function family(name) {
  let f = _texCache.get(name);
  if (f) return f;
  const spec = SURFACE_FAMILY[name] || SURFACE_FAMILY.grain;
  const size = 256;
  const h = heightField(spec.kind, size, name.length * 977 + 13);
  f = {
    map: fieldToAlbedo(h, size, spec.contrast, spec.floor),
    roughnessMap: fieldToLinear(h, size, spec.rough[0], spec.rough[1]),
    normalMap: fieldToNormal(h, size, spec.norm),
  };
  _texCache.set(name, f);
  return f;
}

// ---------------------------------------------------------------------------
// fallback material bank (keys match CONTRACT §8, so Mats is a drop-in)
// ---------------------------------------------------------------------------
const MAT_RECIPE = {
  stone:    { fam: 'speckle', color: 0x8d95a4, rough: 0.92, metal: 0.02, nScale: 0.9 },
  metal:    { fam: 'streak',  color: 0x9aa6b6, rough: 0.42, metal: 0.92, nScale: 0.7 },
  panel:    { fam: 'panel',   color: 0x707d90, rough: 0.55, metal: 0.55, nScale: 1.0 },
  grate:    { fam: 'panel',   color: 0x4d5765, rough: 0.68, metal: 0.75, nScale: 1.3 },
  ice:      { fam: 'facet',   color: 0xa8dcf2, rough: 0.10, metal: 0.02, nScale: 0.6,
              phys: { transmission: 0.32, thickness: 0.6, ior: 1.31, clearcoat: 1, clearcoatRoughness: 0.06 } },
  glass:    { fam: 'facet',   color: 0xbfe6ff, rough: 0.05, metal: 0.00, nScale: 0.25,
              phys: { transmission: 0.85, thickness: 0.25, ior: 1.45 }, transparent: true, opacity: 0.45 },
  emissive: { fam: 'grain',   color: 0x1b2430, rough: 0.35, metal: 0.10, nScale: 0.4, emissive: 0x8fe9ff, emissiveIntensity: 1.6 },
  lava:     { fam: 'grain',   color: 0x2a0d07, rough: 0.72, metal: 0.00, nScale: 1.4, emissive: 0xff6620, emissiveIntensity: 2.2 },
  obsidian: { fam: 'facet',   color: 0x14161d, rough: 0.22, metal: 0.35, nScale: 0.8 },
  crystal:  { fam: 'facet',   color: 0x7fd8ff, rough: 0.08, metal: 0.05, nScale: 0.5,
              phys: { transmission: 0.5, thickness: 0.5, ior: 1.6 }, emissive: 0x1d5c7a, emissiveIntensity: 0.6 },
  wood:     { fam: 'streak',  color: 0x8a6340, rough: 0.82, metal: 0.00, nScale: 1.0 },
  sand:     { fam: 'speckle', color: 0xc2ab84, rough: 0.96, metal: 0.00, nScale: 1.2 },
  neon:     { fam: 'panel',   color: 0x1a2436, rough: 0.28, metal: 0.60, nScale: 0.8, emissive: 0x39d7ff, emissiveIntensity: 1.1 },
  checker:  { fam: 'panel',   color: 0xb9c3d2, rough: 0.50, metal: 0.15, nScale: 0.8 },
  hazard:   { fam: 'streak',  color: 0xe8b33a, rough: 0.55, metal: 0.30, nScale: 0.9, emissive: 0x6a3b06, emissiveIntensity: 0.5 },
  rubber:   { fam: 'weave',   color: 0x2b3038, rough: 0.98, metal: 0.00, nScale: 1.4 },
  conveyor: { fam: 'weave',   color: 0x353b46, rough: 0.86, metal: 0.15, nScale: 1.5 },
  cloud:    { fam: 'grain',   color: 0xdfe9f5, rough: 1.00, metal: 0.00, nScale: 0.4, transparent: true, opacity: 0.72 },
};

const _matCache = new Map();

/** Build (and cache) one fallback PBR material. */
function fallbackMaterial(key, theme) {
  const id = key + '|' + themeId(theme);
  let m = _matCache.get(id);
  if (m) return m;
  const r = MAT_RECIPE[key] || MAT_RECIPE.stone;
  const f = family(r.fam);
  const opts = { color: r.color, roughness: r.rough, metalness: r.metal };
  if (f.map) {
    opts.map = f.map;
    opts.roughnessMap = f.roughnessMap;
    opts.normalMap = f.normalMap;
  }
  if (r.transparent) { opts.transparent = true; opts.opacity = r.opacity; }
  if (r.emissive !== undefined) { opts.emissive = r.emissive; opts.emissiveIntensity = r.emissiveIntensity; }
  if (r.phys) {
    for (const k in r.phys) opts[k] = r.phys[k];
    m = new THREE.MeshPhysicalMaterial(opts);
  } else {
    m = new THREE.MeshStandardMaterial(opts);
  }
  if (f.normalMap) m.normalScale = new THREE.Vector2(r.nScale, r.nScale);
  m.name = 'fb_' + key;
  _matCache.set(id, m);
  return m;
}

/**
 * Resolve a material key. Prefers the shared Mats service (CONTRACT §8) when the
 * caller supplies it; falls back to the internal bank, so builders.js is usable
 * stand-alone and can never hard-fail on module load order.
 */
function materialFor(key, theme, mats) {
  if (mats && typeof mats.get === 'function') {
    try {
      const m = mats.get(key, themeId(theme));
      if (m && m.isMaterial) return m;
    } catch (e) { /* fall through to the internal bank */ }
  }
  return fallbackMaterial(key, theme);
}

// ---------------------------------------------------------------------------
// emissive helpers
// ---------------------------------------------------------------------------
// Stripes, rims and cores are OUR responsibility (readability law, CONTRACT §9)
// so they are always built here, whichever material service is in play.
// ---------------------------------------------------------------------------
const _emCache = new Map();

/**
 * Normalise `def.glow`. Stage data authors TWO shapes:
 *
 *   glow: 1.4        — a brightness multiplier for the emissive trim (temple-1)
 *   glow: 0xa8e6ff   — a palette COLOUR for the trim (foundry/neon/spire/hub,
 *                      temple-2/3 — authored as `glow: COLD` etc.)
 *
 * Every builder used to read BOTH as the multiplier, so a colour authored as
 * glow became emissiveIntensity ≈ 11 million (0xa8e6ff = 11,069,183): the trim
 * rendered at the half-float ceiling (65504) and the bloom pass smeared it over
 * the whole frame — the 2026-08-31 white-out on every colour-glow stage.
 * Measured: foundry-1 frame was 60.8 % pure white; hiding the two `em_*`
 * materials with 10^7 intensities collapsed the HDR mean from 15,443 to 8,186.
 *
 * A finite scalar in (0, 16] is the multiplier; any larger number is a colour
 * (the smallest colour in shipped data is 0x2c4c6e = 2,903,150, so the bands
 * cannot collide). Colour glows keep multiplier 1 and tint the trim instead.
 *
 * @param {object|null} def
 * @returns {{k: number, color: number|null}}
 */
function glowSpec(def) {
  const g = def && def.glow;
  if (typeof g !== 'number' || !isFinite(g) || g <= 0) return { k: 1, color: null };
  if (g > 16) return { k: 1, color: g >>> 0 };
  return { k: g, color: null };
}

// --- landable-glow sanitizer (readability law, CONTRACT §9) ------------------
// Stage data has shipped `glow: <kill colour>` on coin-shortcut platforms and
// `glow: <checkpointOn colour>` on plain decks. Both break the game's colour
// contract: the moment a landable wears the kill hue, red stops meaning death;
// the moment a plain deck wears mint, mint stops meaning "save point". This is
// the generator-level guard: ANY colour glow authored on a landable (platform /
// beam) that sits in the theme's kill hue band, or reads as that theme's
// checkpointOn, is remapped to the theme accent — or to safeEdge when the
// accent itself lives in the kill band (foundry: accent 35°, kill 15°).
// Checkpoint furniture built by stage.js keeps checkpointOn exclusively.
const _sanColor = new THREE.Color();
const _sanHSL = { h: 0, s: 0, l: 0 };

function _hueDist(a, b) {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

function _hslOf(hex, out) {
  _sanColor.set(hex >>> 0);
  return _sanColor.getHSL(out, THREE.SRGBColorSpace);
}

const KILL_BAND = 30 / 360;   // hue distance that counts as "wearing the kill colour"
const CPON_BAND = 20 / 360;   // hue distance that counts as "wearing checkpointOn"
/* The pre-round-2 universal checkpoint mint (0x56ffd0 family). Stage data
 * authored literal copies of it on checkpoint decks ("glow: MINT // palette.
 * checkpointOn"); the palette has since moved to per-world pad identities, so
 * those hexes are stale. Any landable glow still in this band was authored to
 * MEAN "checkpoint deck" — remap it to the theme's CURRENT checkpointOn
 * instead of letting thirteen data files resurrect the mint (round 2,
 * 2026-08-31). */
const LEGACY_MINT_H = 158 / 360;
const LEGACY_MINT_BAND = 22 / 360;

/**
 * @param {number|null} color authored glow colour (hex) or null
 * @param {object} theme ThemeDef
 * @returns {number|null} a colour safe for a landable surface
 */
function safeLandableGlow(color, theme) {
  if (color === null || color === undefined) return color;
  _hslOf(color, _sanHSL);
  const gh = _sanHSL.h, gsat = _sanHSL.s;
  _hslOf(pal(theme, 'kill'), _sanHSL);
  const killH = _sanHSL.h;
  const nearKill = _hueDist(gh, killH) <= KILL_BAND && gsat >= 0.45;
  _hslOf(pal(theme, 'checkpointOn'), _sanHSL);
  const nearCp = _hueDist(gh, _sanHSL.h) <= CPON_BAND && gsat >= 0.35;
  if (!nearKill && !nearCp) {
    if (_hueDist(gh, LEGACY_MINT_H) <= LEGACY_MINT_BAND && gsat >= 0.35) {
      return pal(theme, 'checkpointOn');
    }
    return color;
  }
  const accent = pal(theme, 'accent');
  _hslOf(accent, _sanHSL);
  return _hueDist(_sanHSL.h, killH) >= 45 / 360 ? accent : pal(theme, 'safeEdge');
}

/** Flat emissive band — bright enough to read at 25 m through fog. */
function emissiveMat(color, intensity, opts) {
  const o = opts || null;
  const side = (o && o.side) || THREE.FrontSide;
  const opacity = (o && o.opacity !== undefined) ? o.opacity : 1;
  const key = 'e' + (color >>> 0).toString(16) + ':' + intensity.toFixed(2) + ':' + side + ':' + opacity;
  let m = _emCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: 0x0b0f16,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.0,
    side,
  });
  if (opacity < 1) { m.transparent = true; m.opacity = opacity; }
  m.name = 'em_' + key;
  _emCache.set(key, m);
  return m;
}

/**
 * The dark KEYLINE that flanks every leading-edge stripe. The stripe alone is a
 * glow bank under bloom — its own fringe swallows the physical lip it marks.
 * Bordered by two near-black matte strips it stays a *drawn line* at any bloom
 * setting: emissive bleeds into dark, not into deck. Cached, one per session.
 */
function keylineMaterial() {
  const key = 'keyline';
  let m = _emCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    roughness: 0.92,
    metalness: 0.05,
  });
  m.name = 'em_keyline';
  _emCache.set(key, m);
  return m;
}

/** Additive glow (pad shafts, ground pools). Gradient from UV, pulse from FX_TIME. */
function glowMat(color, opts) {
  const o = opts || null;
  const mode = (o && o.mode) || 'shaft';
  const speed = (o && o.speed !== undefined) ? o.speed : 1;
  const power = (o && o.power !== undefined) ? o.power : 1.6;
  const gain = (o && o.gain !== undefined) ? o.gain : 1;
  const key = 'g' + (color >>> 0).toString(16) + ':' + mode + ':' + speed + ':' + power + ':' + gain;
  let m = _emCache.get(key);
  if (m) return m;
  const shaftBody =
    'float a = pow(1.0 - clamp(vUvG.y, 0.0, 1.0), uPower);' +
    'float band = 0.55 + 0.45 * sin((vUvG.y * 9.0 - uTime * uSpeed * 2.4) * 3.14159);' +
    'a *= mix(0.65, 1.0, band);';
  const radialBody =
    'vec2 dd = vUvG * 2.0 - 1.0;' +
    'float rr = clamp(length(dd), 0.0, 1.0);' +
    'float a = pow(1.0 - rr, uPower);' +
    'a *= 0.75 + 0.25 * sin(uTime * uSpeed * 3.0);';
  m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: FX_TIME,
      uSpeed: { value: speed },
      uPower: { value: power },
      uGain: { value: gain },
    },
    vertexShader:
      'varying vec2 vUvG;\n' +
      'varying vec3 vWG;\n' +
      'void main(){ vUvG = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWG = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader:
      'uniform vec3 uColor; uniform float uTime, uSpeed, uPower, uGain;\n' +
      'varying vec2 vUvG;\n' +
      'varying vec3 vWG;\n' +
      'void main(){\n' + (mode === 'shaft' ? shaftBody : radialBody) + '\n' +
      '  a *= uGain;\n' +
      // Standing ON a pad puts the camera inside this additive volume: without
      // a near fade its walls painted the whole frame with the glow colour
      // (round-2 toggle probe, 2026-08-31 — same failure the checkpoint beam
      // fixed with its vDepth fade). Beyond ~2.6 m it is a no-op.
      '  a *= smoothstep(0.9, 2.6, distance(vWG, cameraPosition));\n' +
      '  if (a < 0.004) discard;\n' +
      '  gl_FragColor = vec4(uColor * (0.85 + 0.35 * a), a);\n' +
      '}',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.name = 'glow_' + key;
  _emCache.set(key, m);
  return m;
}

/** Emissive material whose intensity breathes — pad cores, armed markers. */
function pulseMat(color, base, amp, speed) {
  const key = 'p' + (color >>> 0).toString(16) + ':' + base.toFixed(2) + ':' + amp.toFixed(2) + ':' + speed;
  let m = _emCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: 0x080c12, emissive: color, emissiveIntensity: base,
    roughness: 0.30, metalness: 0.0,
  });
  const pulse = new THREE.Vector3(base, amp, speed);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = FX_TIME;
    shader.uniforms.uPulse = { value: pulse };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPulse;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        'totalEmissiveRadiance *= (uPulse.x + uPulse.y * (0.5 + 0.5 * sin(uTime * uPulse.z))) / max(uPulse.x, 0.0001);');
  };
  m.customProgramCacheKey = () => 'ascendant-pulse';
  m.name = 'pulse_' + key;
  _emCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
// low-level geometry emitters
// ---------------------------------------------------------------------------
const _P = [];
const _N = [];
const _U = [];

function beginGeo() { _P.length = 0; _N.length = 0; _U.length = 0; }

function endGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(_P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(_N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(_U), 2));
  return g;
}

const _uvTmp = [0, 0];

/** Project onto the two axes perpendicular to the dominant normal axis. */
function uvFor(p, n, scale, out) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let a, b;
  if (ax >= ay && ax >= az) { a = 2; b = 1; }
  else if (ay >= az) { a = 0; b = 2; }
  else { a = 0; b = 1; }
  out[0] = p[a] * scale;
  out[1] = p[b] * scale;
}

function emitVert(p, n, scale) {
  _P.push(p[0], p[1], p[2]);
  _N.push(n[0], n[1], n[2]);
  uvFor(p, n, scale, _uvTmp);
  _U.push(_uvTmp[0], _uvTmp[1]);
}

/** Emit a triangle, auto-orienting the winding to match the desired normal. */
function pushTri(a, b, c, n, scale) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) {
    emitVert(a, n, scale); emitVert(b, n, scale); emitVert(c, n, scale);
  } else {
    emitVert(a, n, scale); emitVert(c, n, scale); emitVert(b, n, scale);
  }
}

/** Emit a planar quad (p0..p3 in ring order) as two triangles. */
function pushQuad(p0, p1, p2, p3, n, scale) {
  pushTri(p0, p1, p2, n, scale);
  pushTri(p0, p2, p3, n, scale);
}

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * A chamfered (bevelled) box — the structural unit of every platform.
 * 6 face quads + 12 edge chamfers + 8 corner triangles = 44 triangles.
 * RoundedBoxGeometry is not vendored, and at obby scale a chamfer reads better
 * than a fillet anyway: it catches a hard specular line on every edge.
 */
export function bevelBoxGeometry(w, h, d, bevel, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
  const b = Math.max(0.0008, Math.min(bevel === undefined ? 0.04 : bevel, hx * 0.85, hy * 0.85, hz * 0.85));
  const V = (sx, sy, sz, axis) => [
    axis === 0 ? sx * hx : sx * (hx - b),
    axis === 1 ? sy * hy : sy * (hy - b),
    axis === 2 ? sz * hz : sz * (hz - b),
  ];
  beginGeo();
  const sg = [0, 0, 0];
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  // 6 faces
  for (let axis = 0; axis < 3; axis++) {
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    for (let s = -1; s <= 1; s += 2) {
      const n = [0, 0, 0]; n[axis] = s;
      const pts = [];
      for (let i = 0; i < 4; i++) {
        sg[axis] = s; sg[a1] = CORNERS[i][0]; sg[a2] = CORNERS[i][1];
        pts.push(V(sg[0], sg[1], sg[2], axis));
      }
      pushQuad(pts[0], pts[1], pts[2], pts[3], n, scale);
    }
  }
  // 12 edge chamfers
  for (let ax = 0; ax < 3; ax++) {
    const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
    for (let i = 0; i < 4; i++) {
      const s1 = CORNERS[i][0], s2 = CORNERS[i][1];
      const nv = [0, 0, 0]; nv[a1] = s1; nv[a2] = s2;
      const n = norm3(nv[0], nv[1], nv[2]);
      sg[ax] = -1; sg[a1] = s1; sg[a2] = s2;
      const p0 = V(sg[0], sg[1], sg[2], a1);
      const p1 = V(sg[0], sg[1], sg[2], a2);
      sg[ax] = 1;
      const p2 = V(sg[0], sg[1], sg[2], a2);
      const p3 = V(sg[0], sg[1], sg[2], a1);
      pushQuad(p0, p1, p2, p3, n, scale);
    }
  }
  // 8 corner triangles
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const n = norm3(sx, sy, sz);
        pushTri(V(sx, sy, sz, 0), V(sx, sy, sz, 1), V(sx, sy, sz, 2), n, scale);
      }
    }
  }
  return endGeo();
}

/** Hard box (12 tris) — for thin trim where a chamfer would be sub-pixel. */
export function boxGeometry(w, h, d, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
  beginGeo();
  const F = [
    [[1, 0, 0], [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [[-1, 0, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz]]],
    [[0, 1, 0], [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, -1, 0], [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  for (let i = 0; i < F.length; i++) {
    const p = F[i][1];
    pushQuad(p[0], p[1], p[2], p[3], F[i][0], scale);
  }
  return endGeo();
}

/** A single axis-aligned quad. `axis`: 0=X 1=Y 2=Z, `sign`: +1/-1. */
export function quadGeometry(a, b, axis, sign, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const ha = a * 0.5, hb = b * 0.5;
  beginGeo();
  const n = [0, 0, 0]; n[axis] = sign;
  const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
  const mk = (u, v) => { const p = [0, 0, 0]; p[a1] = u * ha; p[a2] = v * hb; return p; };
  pushQuad(mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1), n, scale);
  return endGeo();
}

/** Low-poly prism — bolt studs, rivet caps, hex hardware. */
export function prismGeometry(radius, height, sides, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const s = Math.max(3, sides || 6);
  const hy = height * 0.5;
  beginGeo();
  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * Math.PI * 2, a1 = ((i + 1) / s) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    const n = norm3(Math.cos((a0 + a1) * 0.5), 0, Math.sin((a0 + a1) * 0.5));
    pushQuad([x0, -hy, z0], [x1, -hy, z1], [x1, hy, z1], [x0, hy, z0], n, scale);
    pushTri([0, hy, 0], [x0, hy, z0], [x1, hy, z1], [0, 1, 0], scale);
    pushTri([0, -hy, 0], [x1, -hy, z1], [x0, -hy, z0], [0, -1, 0], scale);
  }
  return endGeo();
}

/** Tapered tube — pillar shafts, cables, cones (rTop = 0). */
export function tubeGeometry(rTop, rBot, height, sides, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const s = Math.max(3, sides || 12);
  const hy = height * 0.5;
  const slope = (rBot - rTop) / Math.max(height, 0.001);
  beginGeo();
  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * Math.PI * 2, a1 = ((i + 1) / s) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const n = norm3(Math.cos((a0 + a1) * 0.5), slope, Math.sin((a0 + a1) * 0.5));
    pushQuad(
      [c0 * rBot, -hy, s0 * rBot], [c1 * rBot, -hy, s1 * rBot],
      [c1 * rTop, hy, s1 * rTop], [c0 * rTop, hy, s0 * rTop], n, scale);
    if (rTop > 0.0005) pushTri([0, hy, 0], [c0 * rTop, hy, s0 * rTop], [c1 * rTop, hy, s1 * rTop], [0, 1, 0], scale);
    if (rBot > 0.0005) pushTri([0, -hy, 0], [c1 * rBot, -hy, s1 * rBot], [c0 * rBot, -hy, s0 * rBot], [0, -1, 0], scale);
  }
  return endGeo();
}

/** Flat annulus in the XZ plane. */
export function ringGeometry(rInner, rOuter, sides, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const s = Math.max(6, sides || 40);
  beginGeo();
  const n = [0, 1, 0];
  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * Math.PI * 2, a1 = ((i + 1) / s) * Math.PI * 2;
    pushQuad(
      [Math.cos(a0) * rInner, 0, Math.sin(a0) * rInner],
      [Math.cos(a0) * rOuter, 0, Math.sin(a0) * rOuter],
      [Math.cos(a1) * rOuter, 0, Math.sin(a1) * rOuter],
      [Math.cos(a1) * rInner, 0, Math.sin(a1) * rInner], n, scale);
  }
  return endGeo();
}

/** Disc in the XZ plane with normalised 0..1 radial UVs (for glow shaders). */
export function discGeometry(radius, sides) {
  const s = Math.max(6, sides || 40);
  beginGeo();
  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * Math.PI * 2, a1 = ((i + 1) / s) * Math.PI * 2;
    const p0 = [0, 0, 0];
    const p1 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius];
    const p2 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    // manual emit so we can write radial UVs rather than projected ones
    const n = [0, 1, 0];
    const tri = [p0, p2, p1];
    for (let k = 0; k < 3; k++) {
      const p = tri[k];
      _P.push(p[0], p[1], p[2]);
      _N.push(n[0], n[1], n[2]);
      _U.push(p[0] / (radius * 2) + 0.5, p[2] / (radius * 2) + 0.5);
    }
  }
  return endGeo();
}

/**
 * Torus with a CHAMFERED-RECTANGULAR cross-section — a machined ring, not a
 * doughnut. `profile` = [halfWidth, halfHeight, chamfer].
 */
export function ringProfileGeometry(radius, profile, seg, uvScale) {
  const scale = uvScale === undefined ? 1 : uvScale;
  const s = Math.max(8, seg || 48);
  const hw = profile[0], hh = profile[1];
  const ch = Math.min(profile[2], hw * 0.8, hh * 0.8);
  const X = [
    [hw, -hh + ch, 1, 0], [hw - ch, -hh, 0.7, -0.7], [-hw + ch, -hh, -0.7, -0.7],
    [-hw, -hh + ch, -1, 0], [-hw, hh - ch, -1, 0], [-hw + ch, hh, -0.7, 0.7],
    [hw - ch, hh, 0.7, 0.7], [hw, hh - ch, 1, 0],
  ];
  beginGeo();
  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * Math.PI * 2, a1 = ((i + 1) / s) * Math.PI * 2;
    const c0 = Math.cos(a0), sn0 = Math.sin(a0), c1 = Math.cos(a1), sn1 = Math.sin(a1);
    const cm = Math.cos((a0 + a1) * 0.5), sm = Math.sin((a0 + a1) * 0.5);
    for (let k = 0; k < X.length; k++) {
      const A = X[k], B = X[(k + 1) % X.length];
      const nr = (A[2] + B[2]) * 0.5, ny = (A[3] + B[3]) * 0.5;
      const n = norm3(cm * nr, ny, sm * nr);
      pushQuad(
        [c0 * (radius + A[0]), A[1], sn0 * (radius + A[0])],
        [c1 * (radius + A[0]), A[1], sn1 * (radius + A[0])],
        [c1 * (radius + B[0]), B[1], sn1 * (radius + B[0])],
        [c0 * (radius + B[0]), B[1], sn0 * (radius + B[0])], n, scale);
    }
  }
  return endGeo();
}

// ---------------------------------------------------------------------------
// geometry transforms, cache and assembly
// ---------------------------------------------------------------------------
/** Translate/rotate a geometry in place. Build time only. */
function xform(geo, x, y, z, rx, ry, rz) {
  if (rx || ry || rz) {
    _e0.set(rx || 0, ry || 0, rz || 0);
    _q0.setFromEuler(_e0);
    _v0.set(x || 0, y || 0, z || 0);
    _s0.set(1, 1, 1);
    _m0.compose(_v0, _q0, _s0);
    geo.applyMatrix4(_m0);
  } else if (x || y || z) {
    geo.translate(x || 0, y || 0, z || 0);
  }
  return geo;
}

/**
 * Composite-geometry cache. 200 identical platforms share ONE BufferGeometry.
 * Keys are built from dimensions rounded to 1 mm.
 */
export const GeoCache = {
  _map: new Map(),
  key() {
    let s = '';
    for (let i = 0; i < arguments.length; i++) {
      const p = arguments[i];
      s += (typeof p === 'number' ? (Math.round(p * 1000) / 1000) : p) + '|';
    }
    return s;
  },
  get(key, factory) {
    let g = this._map.get(key);
    if (g) return g;
    g = factory();
    g.userData.__shared = true;
    this._map.set(key, g);
    return g;
  },
  get size() { return this._map.size; },
  clear() {
    for (const g of this._map.values()) g.dispose();
    this._map.clear();
  },
};

function emptyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(0), 2));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * Merge `parts` (each {geo, mat:<slotIndex>}) into ONE geometry with one group
 * per slot. The result is material-AGNOSTIC — the caller supplies the material
 * array per theme — which is what lets the geometry be cached and shared.
 *
 * @param {{geo:THREE.BufferGeometry, mat:number}[]} parts
 * @param {number} slots number of material slots
 * @returns {THREE.BufferGeometry}
 */
function assembleIndexed(parts, slots) {
  const buckets = [];
  for (let i = 0; i < slots; i++) buckets.push([]);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || !p.geo) continue;
    if (p.geo.attributes.position.count === 0) { p.geo.dispose(); continue; }
    buckets[p.mat].push(p.geo);
  }
  const present = [];
  const slotOf = [];
  for (let i = 0; i < slots; i++) {
    if (buckets[i].length === 0) continue;
    const g = buckets[i].length === 1 ? buckets[i][0] : mergeGeometries(buckets[i], false);
    if (!g) continue;
    if (buckets[i].length > 1) for (const x of buckets[i]) x.dispose();
    present.push(g);
    slotOf.push(i);
  }
  if (present.length === 0) return emptyGeometry();

  let geometry;
  if (present.length === 1) {
    geometry = present[0];
    geometry.clearGroups();
    geometry.addGroup(0, geometry.attributes.position.count, slotOf[0]);
  } else {
    geometry = mergeGeometries(present, true);
    if (!geometry) { for (const g of present) g.dispose(); return emptyGeometry(); }
    for (const g of present) g.dispose();
    for (let i = 0; i < geometry.groups.length; i++) geometry.groups[i].materialIndex = slotOf[i];
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// ---------------------------------------------------------------------------
// ObjectDef helpers
// ---------------------------------------------------------------------------
function size3(def, dw, dh, dd) {
  const s = def && def.s;
  if (Array.isArray(s)) {
    return [s[0] === undefined ? dw : s[0], s[1] === undefined ? dh : s[1], s[2] === undefined ? dd : s[2]];
  }
  if (typeof s === 'number') return [s, s, s];
  return [dw, dh, dd];
}

function pos3(def) {
  const p = (def && def.p) || null;
  return p ? [p[0] || 0, p[1] || 0, p[2] || 0] : [0, 0, 0];
}

/**
 * ROTATION CONVENTION — an assumption other modules must honour.
 *   `def.rot` is Euler angles in RADIANS:
 *     number   -> yaw only (rotation about +Y)
 *     [x,y,z]  -> XYZ Euler order
 *     {x,y,z}  -> XYZ Euler order
 */
function applyRot(obj, rot) {
  if (rot === undefined || rot === null) return obj;
  if (typeof rot === 'number') obj.rotation.set(0, rot, 0);
  else if (Array.isArray(rot)) obj.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  else obj.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
  return obj;
}

function rotQuat(rot, out) {
  if (rot === undefined || rot === null) return out.identity();
  if (typeof rot === 'number') _e0.set(0, rot, 0);
  else if (Array.isArray(rot)) _e0.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  else _e0.set(rot.x || 0, rot.y || 0, rot.z || 0);
  return out.setFromEuler(_e0);
}

/** Build a Collider and attach surface params without assuming the ctor takes them. */
function makeCollider(cx, cy, cz, hx, hy, hz, quat, surface, props, ref) {
  const c = new Collider({
    center: new THREE.Vector3(cx, cy, cz),
    half: new THREE.Vector3(hx, hy, hz),
    quat: quat,
    surface: surface || 'normal',
    ref: ref || null,
    group: 'world',
  });
  if (props) c.props = props;
  return c;
}

/** Which faces get the loud leading-edge stripe. +X is ALWAYS on (CONTRACT §10). */
const FACE_KEYS = ['+x', '-x', '+z', '-z'];
function stripeFaces(def) {
  const s = def ? def.stripe : undefined;
  if (s === false) return [];                       // explicit opt-out
  if (s === true || s === 'all') return FACE_KEYS.slice();
  const out = ['+x'];
  if (typeof s === 'string') {
    if (FACE_KEYS.indexOf(s) >= 0 && s !== '+x') out.push(s);
  } else if (Array.isArray(s)) {
    for (const f of s) if (FACE_KEYS.indexOf(f) >= 0 && out.indexOf(f) < 0) out.push(f);
  }
  return out;
}

/** surface kind -> [body material key, stripe palette key, emissive gain]. */
const SURFACE_LOOK = {
  normal:   ['stone', 'safeEdge', 1.00],
  ice:      ['ice', 'safeEdge', 1.15],
  /* bounce wore 'checkpointOn' and speed wore 'finish' — a bouncy deck
   * impersonated a save point in every theme and a speed strip stole the
   * finish's reserved violet (round-2 critic, 2026-08-31). Bounce now wears
   * the theme's pad identity, speed its safeEdge (the hot landable stripe). */
  bounce:   ['rubber', 'pad', 1.35],
  speed:    ['neon', 'safeEdge', 1.40],
  conveyor: ['conveyor', 'accent', 1.10],
  sticky:   ['rubber', 'deco', 0.90],
  nostick:  ['metal', 'safeEdge', 1.00],
};

function bevelFor(w, h, d) {
  return Math.max(0.012, Math.min(0.09, h * 0.30, w * 0.10, d * 0.10));
}

// ---------------------------------------------------------------------------
// PLATFORM
// ---------------------------------------------------------------------------
/**
 * Build a platform. Never a naked box: chamfered slab + recessed inset panel +
 * accent rim + leading-edge stripes + corner studs (>2 m) + ribbed underside.
 * Returns exactly ONE mesh (five material groups) and one OBB collider.
 *
 * @param {object} def   {kind:'platform', p, s, rot?, mat?, surface?, props?, glow?, stripe?}
 * @param {object} theme ThemeDef (CONTRACT §9)
 * @param {object} [mats] the shared Mats service (CONTRACT §8); optional
 * @returns {{mesh: THREE.Mesh, colliders: Collider[]}}
 */
export function buildPlatform(def, theme, mats) {
  const s = size3(def, 4, 0.6, 4);
  const w = s[0], h = s[1], d = s[2];
  const surface = (def && def.surface) || 'normal';
  const look = SURFACE_LOOK[surface] || SURFACE_LOOK.normal;
  const bodyKey = (def && def.mat) || look[0];
  const gs = glowSpec(def);
  const glow = gs.k;
  const faces = stripeFaces(def);

  const glowColor = safeLandableGlow(gs.color, theme);
  const bodyMat = materialFor(bodyKey, theme, mats);
  const panelMat = materialFor(surface === 'ice' ? 'ice' : (bodyKey === 'grate' ? 'metal' : 'panel'), theme, mats);
  const rimMat = emissiveMat(pal(theme, 'accent'), 0.85 * glow);
  const stripeMat = emissiveMat(glowColor !== null ? glowColor : pal(theme, look[1]), 2.6 * glow * look[2]);
  const underMat = materialFor('obsidian', theme, mats);

  const key = GeoCache.key('plat', w, h, d, faces.join(''));
  const geo = GeoCache.get(key, () => platformGeometry(w, h, d, faces));

  const mesh = new THREE.Mesh(geo, [bodyMat, panelMat, rimMat, stripeMat, underMat, keylineMaterial()]);
  mesh.name = 'platform';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const collider = makeCollider(
    p[0], p[1], p[2], w * 0.5, h * 0.5, d * 0.5,
    rotQuat(def && def.rot, new THREE.Quaternion()),
    surface, (def && def.props) || null, null);
  mesh.userData.collider = collider;
  mesh.userData.def = def;
  return { mesh, colliders: [collider] };
}

/**
 * The platform art, in local space, centred on the slab.
 * Material slots: 0 body · 1 panel · 2 rim · 3 stripe · 4 underside · 5 keyline.
 */
function platformGeometry(w, h, d, faces) {
  const b = bevelFor(w, h, d);
  const hy = h * 0.5;
  const parts = [];
  const push = (geo, mat) => parts.push({ geo, mat });

  // --- 1. chamfered slab body ----------------------------------------------
  push(bevelBoxGeometry(w, h, d, b, 0.5), 0);

  // --- 2. recessed top panel, inset 0.06 m ---------------------------------
  const inset = 0.06;
  const pw = Math.max(0.08, w - inset * 2);
  const pd = Math.max(0.08, d - inset * 2);
  const ph = Math.min(0.14, Math.max(0.03, h * 0.45));
  // its top sits 0.02 m below the walking plane -> a readable shoulder all round
  push(xform(bevelBoxGeometry(pw, ph, pd, Math.min(0.03, b * 0.6), 1.15), 0, hy - 0.02 - ph * 0.5, 0), 1);

  // panel seam lines so big slabs are never a blank sheet
  if (pw > 2.2 || pd > 2.2) {
    const nx = Math.max(0, Math.min(5, Math.round(pw / 1.6) - 1));
    const nz = Math.max(0, Math.min(5, Math.round(pd / 1.6) - 1));
    for (let i = 1; i <= nx; i++) {
      const x = -pw * 0.5 + (pw * i) / (nx + 1);
      push(xform(boxGeometry(0.035, 0.008, pd * 0.94, 1), x, hy - 0.018, 0), 2);
    }
    for (let i = 1; i <= nz; i++) {
      const z = -pd * 0.5 + (pd * i) / (nz + 1);
      push(xform(boxGeometry(pw * 0.94, 0.008, 0.035, 1), 0, hy - 0.018, z), 2);
    }
  }

  // --- 3. accent rim around the top edge -----------------------------------
  const rimW = 0.05, rimT = 0.022;
  const rx = w * 0.5 - b * 0.45, rz = d * 0.5 - b * 0.45;
  const rimY = hy - 0.004;
  push(xform(boxGeometry(w - b, rimT, rimW, 1), 0, rimY, rz - rimW * 0.5), 2);
  push(xform(boxGeometry(w - b, rimT, rimW, 1), 0, rimY, -rz + rimW * 0.5), 2);
  push(xform(boxGeometry(rimW, rimT, Math.max(0.02, d - b - rimW * 2), 1), rx - rimW * 0.5, rimY, 0), 2);
  push(xform(boxGeometry(rimW, rimT, Math.max(0.02, d - b - rimW * 2), 1), -rx + rimW * 0.5, rimY, 0), 2);

  // --- 4. LEADING-EDGE STRIPES ---------------------------------------------
  // The readability feature: a 0.12 m top band inset just inside the rim, plus a
  // matching band down the vertical face so the edge also reads from below.
  // Every emissive band is FLANKED by 0.03 m near-black keylines (slot 5) so the
  // stripe stays a drawn line under bloom instead of a glow bank — the physical
  // lip must never hide inside its own marker's fringe.
  const SW = 0.12;
  const KW = 0.03;                                    // keyline width
  const vH = Math.min(0.14, Math.max(0.05, h * 0.55));
  const eps = 0.004;
  const hasFace = (name) => faces.indexOf(name) >= 0;
  // one vertical face band + keyline underline, shared by both loops below
  const vBandX = (sx) => {
    const len = Math.max(0.05, d - b * 1.2);
    push(xform(boxGeometry(0.02, vH, len, 1), sx * (w * 0.5 + 0.004), hy - b - vH * 0.5, 0), 3);
    push(xform(boxGeometry(0.022, 0.035, len, 1), sx * (w * 0.5 + 0.005), hy - b - vH - 0.022, 0), 5);
  };
  const vBandZ = (sz) => {
    const len = Math.max(0.05, w - b * 1.2);
    push(xform(boxGeometry(len, vH, 0.02, 1), 0, hy - b - vH * 0.5, sz * (d * 0.5 + 0.004)), 3);
    push(xform(boxGeometry(len, 0.035, 0.022, 1), 0, hy - b - vH - 0.022, sz * (d * 0.5 + 0.005)), 5);
  };
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f === '+x' || f === '-x') {
      const sx = f === '+x' ? 1 : -1;
      const cxs = sx * (rx - SW * 0.5 - 0.055);       // top band centre
      const len = Math.max(0.05, d - b * 1.2);
      push(xform(boxGeometry(SW, 0.014, len, 1), cxs, hy + eps - 0.007, 0), 3);
      // keylines flanking the top band, a hair taller so they cap the glow
      push(xform(boxGeometry(KW, 0.016, len, 1), cxs + sx * (SW * 0.5 + KW * 0.5), hy + eps - 0.006, 0), 5);
      push(xform(boxGeometry(KW, 0.016, len, 1), cxs - sx * (SW * 0.5 + KW * 0.5), hy + eps - 0.006, 0), 5);
      vBandX(sx);
      // MIRROR the vertical band onto the approach face: the course runs +X, so
      // the face the player actually sees while lining up a jump is the -X one.
      // Without this every landing ahead is a dark silhouette and the stripe
      // only rewards you after you arrive ("every landing is visible from its
      // take-off" — the landing's near face carries the mark).
      if (!hasFace(sx === 1 ? '-x' : '+x')) vBandX(-sx);
    } else {
      const sz = f === '+z' ? 1 : -1;
      const czs = sz * (rz - SW * 0.5 - 0.055);
      const len = Math.max(0.05, w - b * 1.2);
      push(xform(boxGeometry(len, 0.014, SW, 1), 0, hy + eps - 0.007, czs), 3);
      push(xform(boxGeometry(len, 0.016, KW, 1), 0, hy + eps - 0.006, czs + sz * (SW * 0.5 + KW * 0.5)), 5);
      push(xform(boxGeometry(len, 0.016, KW, 1), 0, hy + eps - 0.006, czs - sz * (SW * 0.5 + KW * 0.5)), 5);
      vBandZ(sz);
      if (!hasFace(sz === 1 ? '-z' : '+z')) vBandZ(-sz);
    }
  }

  // --- 5. corner caps / bolt studs (anything above 2 m wide) ----------------
  if (w > 2 || d > 2) {
    const studR = 0.055, studH = 0.03;
    const ix = Math.max(0.05, w * 0.5 - 0.20);
    const iz = Math.max(0.05, d * 0.5 - 0.20);
    const spots = [[ix, iz], [ix, -iz], [-ix, iz], [-ix, -iz]];
    const nx = Math.min(4, Math.max(0, Math.floor(w / 1.6) - 1));
    const nz = Math.min(4, Math.max(0, Math.floor(d / 1.6) - 1));
    for (let i = 1; i <= nx; i++) {
      const x = -ix + (ix * 2 * i) / (nx + 1);
      spots.push([x, iz], [x, -iz]);
    }
    for (let i = 1; i <= nz; i++) {
      const z = -iz + (iz * 2 * i) / (nz + 1);
      spots.push([ix, z], [-ix, z]);
    }
    for (let i = 0; i < spots.length && i < 12; i++) {
      push(xform(prismGeometry(studR, studH, 6, 2.0), spots[i][0], hy - 0.002, spots[i][1]), 0);
    }
    const capS = Math.min(0.34, w * 0.16, d * 0.16);
    if (capS > 0.05) {
      const CS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (let i = 0; i < 4; i++) {
        push(xform(bevelBoxGeometry(capS, h * 0.55, capS, Math.min(0.05, capS * 0.25), 1.2),
          CS[i][0] * (w * 0.5 - capS * 0.45), hy - h * 0.30, CS[i][1] * (d * 0.5 - capS * 0.45)), 0);
      }
    }
  }

  // --- 6. underside: dark recessed underlayer, lighter structural ribs, and a
  // single accent line down the spine. A fall is a long look at this face, so it
  // gets real value separation instead of one flat black plate.
  const uw = Math.max(0.10, w - 0.16), ud = Math.max(0.10, d - 0.16);
  push(xform(bevelBoxGeometry(uw, 0.05, ud, 0.02, 0.9), 0, -hy - 0.020, 0), 4);
  const long = w >= d;
  const span = long ? w : d;
  const ribs = Math.min(9, Math.max(2, Math.round(span / 0.85)));
  const ribLen = long ? Math.max(0.06, ud - 0.24) : Math.max(0.06, uw - 0.24);
  for (let i = 0; i < ribs; i++) {
    const t = i / (ribs - 1);
    const o = (t - 0.5) * Math.max(0.02, span - 0.55);
    const g = long ? boxGeometry(0.085, 0.055, ribLen, 1.2) : boxGeometry(ribLen, 0.055, 0.085, 1.2);
    push(xform(g, long ? o : 0, -hy - 0.062, long ? 0 : o), 0);
  }
  const spineLen = long ? Math.max(0.06, uw - 0.20) : Math.max(0.06, ud - 0.20);
  push(xform(long ? boxGeometry(spineLen, 0.07, 0.12, 1.2) : boxGeometry(0.12, 0.07, spineLen, 1.2),
    0, -hy - 0.056, 0), 0);
  push(xform(long ? boxGeometry(spineLen * 0.92, 0.016, 0.035, 1.4) : boxGeometry(0.035, 0.016, spineLen * 0.92, 1.4),
    0, -hy - 0.094, 0), 2);

  return assembleIndexed(parts, 6);
}

// ---------------------------------------------------------------------------
// BEAM
// ---------------------------------------------------------------------------
/**
 * The thin precision platform. Gets a bright top-centre guide line (so the exact
 * walking line reads from a distance), machined end caps with a directional
 * chevron, side pinstripes and a structural rib spine underneath.
 */
export function buildBeam(def, theme, mats) {
  const s = size3(def, 6, 0.28, 0.6);
  const w = s[0], h = s[1], d = s[2];
  const gs = glowSpec(def);
  const glow = gs.k;
  const beamGlowColor = safeLandableGlow(gs.color, theme);
  const bodyMat = materialFor((def && def.mat) || 'metal', theme, mats);
  const capMat = materialFor('panel', theme, mats);
  const lineMat = emissiveMat(beamGlowColor !== null ? beamGlowColor : pal(theme, 'safeEdge'), 3.0 * glow);
  const trimMat = emissiveMat(pal(theme, 'accent'), 0.9 * glow);
  const alongX = w >= d;

  const key = GeoCache.key('beam', w, h, d, alongX ? 'x' : 'z');
  const geo = GeoCache.get(key, () => {
    const b = Math.max(0.008, Math.min(0.045, h * 0.35, Math.min(w, d) * 0.18));
    const hy = h * 0.5;
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    push(bevelBoxGeometry(w, h, d, b, 1.1), 0);

    const L = alongX ? w : d;
    const W = alongX ? d : w;

    // top-centre guide line, 0.06 m
    push(xform(alongX ? boxGeometry(Math.max(0.05, L - 0.10), 0.012, 0.06, 1)
                      : boxGeometry(0.06, 0.012, Math.max(0.05, L - 0.10), 1),
      0, hy + 0.002, 0), 2);

    // side pinstripes at mid height
    for (const sg of [-1, 1]) {
      push(xform(alongX ? boxGeometry(Math.max(0.05, L - 0.12), 0.016, 0.014, 1)
                        : boxGeometry(0.014, 0.016, Math.max(0.05, L - 0.12), 1),
        alongX ? 0 : sg * (W * 0.5 + 0.002), 0.02, alongX ? sg * (W * 0.5 + 0.002) : 0), 3);
    }

    // machined end caps + directional chevrons
    const capT = Math.min(0.16, L * 0.10);
    for (const sg of [-1, 1]) {
      const cw = alongX ? capT : W * 1.12;
      const cd = alongX ? W * 1.12 : capT;
      push(xform(bevelBoxGeometry(cw, h * 1.18, cd, Math.min(0.03, h * 0.2), 1.4),
        alongX ? sg * (L * 0.5 - capT * 0.5) : 0, 0, alongX ? 0 : sg * (L * 0.5 - capT * 0.5)), 1);
      push(xform(alongX ? boxGeometry(0.018, h * 0.42, W * 0.55, 1)
                        : boxGeometry(W * 0.55, h * 0.42, 0.018, 1),
        alongX ? sg * (L * 0.5 + 0.004) : 0, 0.01, alongX ? 0 : sg * (L * 0.5 + 0.004)), 2);
    }

    // structural ribs + spine
    const ribN = Math.max(2, Math.min(12, Math.round(L / 1.1)));
    for (let i = 0; i < ribN; i++) {
      const t = (i + 0.5) / ribN - 0.5;
      const o = t * Math.max(0.02, L - 0.3);
      push(xform(bevelBoxGeometry(alongX ? 0.07 : W * 0.62, 0.10, alongX ? W * 0.62 : 0.07, 0.015, 1.4),
        alongX ? o : 0, -hy - 0.045, alongX ? 0 : o), 1);
    }
    push(xform(alongX ? boxGeometry(Math.max(0.06, L - 0.2), 0.06, 0.09, 1.2)
                      : boxGeometry(0.09, 0.06, Math.max(0.06, L - 0.2), 1.2),
      0, -hy - 0.055, 0), 1);
    return assembleIndexed(parts, 4);
  });

  const mesh = new THREE.Mesh(geo, [bodyMat, capMat, lineMat, trimMat]);
  mesh.name = 'beam';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const collider = makeCollider(
    p[0], p[1], p[2], w * 0.5, h * 0.5, d * 0.5,
    rotQuat(def && def.rot, new THREE.Quaternion()),
    (def && def.surface) || 'normal', (def && def.props) || null, null);
  mesh.userData.collider = collider;
  return { mesh, colliders: [collider] };
}

// ---------------------------------------------------------------------------
// PAD — jump pads / speed pads
// ---------------------------------------------------------------------------
/**
 * Circular pad: machined plinth, accent ring, inner disc with radial spokes, an
 * animated emissive core, direction chevrons, a ground glow pool and an upward
 * glow shaft. Returns a Group — the glow layers are additive and animated, so
 * they must NOT be swept into the merged static art.
 */
export function buildPad(def, theme, mats) {
  const s = size3(def, 1.5, 0.12, 1.5);
  const r = (def && def.r) || Math.max(s[0], s[2]) * 0.5;
  const height = Math.max(0.04, s[1]);
  const isSpeed = !!(def && (def.kind === 'speedpad' || def.surface === 'speed'));
  const gs = glowSpec(def);
  const glow = gs.k;
  /* Round 2 (2026-08-31 toggle probe): jump pads wore checkpointOn — the same
   * mint in every world — and speed pads wore the finish's reserved violet.
   * Pads now wear the theme's own pad identity (THEMES[world].palette.pad),
   * speed pads its safeEdge, so foundry pads are cyan-on-steel, spire's ice
   * blue, temple's gold. The ring follows 'pad' too (in foundry the accent is
   * amber — an amber self-lit animated ring on a landable violates that
   * theme's "only hazards are orange + emissive + moving" law). */
  const tint = gs.color !== null ? gs.color : pal(theme, isSpeed ? 'safeEdge' : 'pad');

  const plinthMat = materialFor('metal', theme, mats);
  const discMat = materialFor('panel', theme, mats);
  /* core 2.6/1.5 blew the pad centre to white under every theme's bloom
   * threshold (0.85-1.10); 1.7/0.9 still clears the thresholds so the core
   * glows with a halo, but its hue survives — the controlled-emissive rim the
   * round-2 spec demands. */
  const ringMat = emissiveMat(pal(theme, 'pad'), 1.2 * glow);
  const coreMat = pulseMat(tint, 1.7 * glow, 0.9 * glow, 3.4);

  const key = GeoCache.key('pad', r, height, isSpeed ? 's' : 'j');
  const geo = GeoCache.get(key, () => {
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    push(xform(tubeGeometry(r * 0.99, r * 1.04, height, 40, 1.0), 0, height * 0.5, 0), 0);
    push(xform(tubeGeometry(r * 0.94, r * 0.99, 0.02, 40, 1.0), 0, height + 0.01, 0), 0);
    push(xform(ringProfileGeometry(r * 0.86, [0.055, 0.026, 0.012], 44, 1.4), 0, height + 0.024, 0), 2);
    push(xform(tubeGeometry(r * 0.79, r * 0.79, 0.028, 40, 1.6), 0, height + 0.014, 0), 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      push(xform(boxGeometry(r * 0.34, 0.010, 0.026, 1.5),
        Math.cos(a) * r * 0.55, height + 0.030, Math.sin(a) * r * 0.55, 0, -a, 0), 2);
    }
    push(xform(tubeGeometry(r * 0.56, r * 0.56, 0.016, 36, 1.8), 0, height + 0.034, 0), 3);
    for (let i = 0; i < 3; i++) {
      const y = height + 0.040 + i * 0.001;
      const sc = 1 - i * 0.22;
      for (const sg of [-1, 1]) {
        push(xform(boxGeometry(r * 0.44 * sc, 0.008, 0.05, 2.0),
          sg * r * 0.16 * sc, y, (i - 1) * r * 0.24, 0, sg * 0.62, 0), 3);
      }
    }
    return assembleIndexed(parts, 4);
  });

  const group = new THREE.Group();
  group.name = isSpeed ? 'speedpad' : 'jumppad';

  const solid = new THREE.Mesh(geo, [plinthMat, discMat, ringMat, coreMat]);
  solid.castShadow = true;
  solid.receiveShadow = true;
  solid.onBeforeRender = syncFxTime;
  group.add(solid);

  const poolGeo = GeoCache.get(GeoCache.key('padpool', r), () => discGeometry(r * 1.85, 44));
  const pool = new THREE.Mesh(poolGeo, glowMat(tint, { mode: 'radial', speed: 2.2, power: 2.4, gain: 0.42 * glow }));
  pool.position.y = 0.006;
  pool.renderOrder = 2;
  pool.userData.noMerge = true;
  pool.onBeforeRender = syncFxTime;
  group.add(pool);

  const shaftH = isSpeed ? 1.2 : 2.4;
  const shaftGeo = GeoCache.get(GeoCache.key('padshaft', r, shaftH), () => {
    const g = tubeGeometry(r * 0.98, r * 0.55, shaftH, 26, 1);
    const posAttr = g.attributes.position, uvAttr = g.attributes.uv;
    for (let i = 0; i < posAttr.count; i++) {
      uvAttr.setXY(i, uvAttr.getX(i), (posAttr.getY(i) + shaftH * 0.5) / shaftH);
    }
    uvAttr.needsUpdate = true;
    return g;
  });
  const shaft = new THREE.Mesh(shaftGeo, glowMat(tint, { mode: 'shaft', speed: 1.6, power: 1.9, gain: 0.4 * glow }));
  shaft.position.y = height + shaftH * 0.5;
  shaft.renderOrder = 3;
  shaft.userData.noMerge = true;
  shaft.onBeforeRender = syncFxTime;
  group.add(shaft);

  const p = pos3(def);
  group.position.set(p[0], p[1], p[2]);
  applyRot(group, def && def.rot);

  const props = (def && def.props) || {
    power: (def && def.power) !== undefined ? def.power : 6,
    dir: (def && def.dir) || null,
  };
  const collider = makeCollider(
    p[0], p[1] + height * 0.5, p[2], r, height * 0.5, r,
    rotQuat(def && def.rot, new THREE.Quaternion()),
    isSpeed ? 'speed' : 'bounce', props, null);
  group.userData.collider = collider;
  return { mesh: group, colliders: [collider] };
}

// ---------------------------------------------------------------------------
// PILLAR
// ---------------------------------------------------------------------------
/**
 * A real column: stepped plinth, tapered fluted shaft, glowing service band,
 * stepped capital. `def.round` (default true) picks a cylindrical profile.
 */
export function buildPillar(def, theme, mats) {
  const s = size3(def, 0.9, 5, 0.9);
  const w = s[0], h = s[1], d = s[2];
  const round = (def && def.round !== undefined) ? !!def.round : true;
  const gs = glowSpec(def);
  const glow = gs.k;
  const bodyMat = materialFor((def && def.mat) || 'stone', theme, mats);
  const trimMat = materialFor('metal', theme, mats);
  const bandMat = emissiveMat(gs.color !== null ? gs.color : pal(theme, 'accent'), 1.5 * glow);

  const key = GeoCache.key('pillar', w, h, d, round ? 'r' : 's');
  const geo = GeoCache.get(key, () => {
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    const baseH = Math.min(0.34, h * 0.10);
    const capH = Math.min(0.30, h * 0.09);
    const shaftH = Math.max(0.20, h - baseH - capH);
    const rBot = Math.min(w, d) * 0.5, rTop = rBot * 0.86;

    push(xform(bevelBoxGeometry(w * 1.42, baseH * 0.55, d * 1.42, 0.035, 0.8), 0, baseH * 0.275, 0), 0);
    push(xform(bevelBoxGeometry(w * 1.20, baseH * 0.50, d * 1.20, 0.030, 0.9), 0, baseH * 0.800, 0), 0);

    if (round) {
      push(xform(tubeGeometry(rTop, rBot, shaftH, 16, 0.7), 0, baseH + shaftH * 0.5, 0), 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        push(xform(bevelBoxGeometry(0.055, shaftH * 0.94, 0.10, 0.012, 1.2),
          Math.cos(a) * rBot * 0.97, baseH + shaftH * 0.5, Math.sin(a) * rBot * 0.97, 0, -a, 0), 1);
      }
    } else {
      push(xform(bevelBoxGeometry(w, shaftH, d, 0.05, 0.7), 0, baseH + shaftH * 0.5, 0), 0);
      const FL = [[1, 0, 0.06, d * 0.62], [-1, 0, 0.06, d * 0.62], [0, 1, w * 0.62, 0.06], [0, -1, w * 0.62, 0.06]];
      for (let i = 0; i < 4; i++) {
        push(xform(bevelBoxGeometry(FL[i][2], shaftH * 0.94, FL[i][3], 0.012, 1.2),
          FL[i][0] * (w * 0.5 + 0.02), baseH + shaftH * 0.5, FL[i][1] * (d * 0.5 + 0.02)), 1);
      }
    }

    const bandY = baseH + shaftH * 0.66;
    if (round) {
      push(xform(ringProfileGeometry(rBot * 1.02, [0.05, 0.05, 0.016], 20, 1.4), 0, bandY, 0), 1);
      push(xform(ringProfileGeometry(rBot * 1.06, [0.014, 0.028, 0.006], 20, 1.6), 0, bandY, 0), 2);
    } else {
      push(xform(bevelBoxGeometry(w * 1.10, 0.10, d * 1.10, 0.020, 1.4), 0, bandY, 0), 1);
      push(xform(bevelBoxGeometry(w * 1.14, 0.03, d * 1.14, 0.008, 1.6), 0, bandY, 0), 2);
    }

    push(xform(bevelBoxGeometry(w * 1.18, capH * 0.5, d * 1.18, 0.030, 0.9), 0, h - capH * 0.75, 0), 0);
    push(xform(bevelBoxGeometry(w * 1.42, capH * 0.5, d * 1.42, 0.035, 0.8), 0, h - capH * 0.25, 0), 0);
    push(xform(boxGeometry(w * 1.36, 0.014, d * 1.36, 1.2), 0, h + 0.002, 0), 2);
    return assembleIndexed(parts, 3);
  });

  const mesh = new THREE.Mesh(geo, [bodyMat, trimMat, bandMat]);
  mesh.name = 'pillar';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const colliders = [];
  if (!def || def.solid !== false) {
    const q = rotQuat(def && def.rot, new THREE.Quaternion());
    _v0.set(0, h * 0.5, 0).applyQuaternion(q);
    colliders.push(makeCollider(p[0] + _v0.x, p[1] + _v0.y, p[2] + _v0.z,
      w * 0.5, h * 0.5, d * 0.5, q, 'normal', null, null));
  }
  return { mesh, colliders };
}

// ---------------------------------------------------------------------------
// WALL
// ---------------------------------------------------------------------------
/** Panelled wall: proud frame, inset panel grid with rivets, emissive seams. */
export function buildWall(def, theme, mats) {
  const s = size3(def, 8, 4, 0.5);
  const w = s[0], h = s[1], d = s[2];
  const gs = glowSpec(def);
  const glow = gs.k;
  const bodyMat = materialFor((def && def.mat) || 'panel', theme, mats);
  const frameMat = materialFor('metal', theme, mats);
  const seamMat = emissiveMat(gs.color !== null ? gs.color : pal(theme, 'accent'), 1.1 * glow);

  const key = GeoCache.key('wall', w, h, d);
  const geo = GeoCache.get(key, () => {
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    const fr = Math.min(0.22, w * 0.06, h * 0.06);

    push(bevelBoxGeometry(Math.max(0.05, w - fr * 0.6), Math.max(0.05, h - fr * 0.6), d * 0.72, 0.03, 0.6), 0);
    push(xform(bevelBoxGeometry(w, fr, d, 0.03, 0.9), 0, h * 0.5 - fr * 0.5, 0), 1);
    push(xform(bevelBoxGeometry(w, fr, d, 0.03, 0.9), 0, -h * 0.5 + fr * 0.5, 0), 1);
    push(xform(bevelBoxGeometry(fr, Math.max(0.02, h - fr * 2), d, 0.03, 0.9), w * 0.5 - fr * 0.5, 0, 0), 1);
    push(xform(bevelBoxGeometry(fr, Math.max(0.02, h - fr * 2), d, 0.03, 0.9), -w * 0.5 + fr * 0.5, 0, 0), 1);

    const cols = Math.max(1, Math.min(10, Math.round((w - fr * 2) / 1.8)));
    const rows = Math.max(1, Math.min(10, Math.round((h - fr * 2) / 1.6)));
    const cw = (w - fr * 2) / cols, ch = (h - fr * 2) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -w * 0.5 + fr + cw * (i + 0.5);
        const y = -h * 0.5 + fr + ch * (j + 0.5);
        push(xform(bevelBoxGeometry(cw * 0.86, ch * 0.86, d * 0.9, 0.022, 1.1), x, y, 0), 0);
        const RV = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (let k = 0; k < 4; k++) {
          push(xform(prismGeometry(0.026, 0.016, 6, 2.4),
            x + RV[k][0] * cw * 0.38, y + RV[k][1] * ch * 0.38, d * 0.46, Math.PI * 0.5, 0, 0), 1);
        }
      }
    }
    for (let i = 1; i < cols; i++) {
      const x = -w * 0.5 + fr + cw * i;
      push(xform(boxGeometry(0.02, Math.max(0.05, h - fr * 2.2), d * 0.94, 1), x, 0, 0), 2);
    }
    push(xform(boxGeometry(Math.max(0.05, w - fr * 2.2), 0.02, d * 1.02, 1), 0, h * 0.5 - fr * 1.15, 0), 2);
    return assembleIndexed(parts, 3);
  });

  const mesh = new THREE.Mesh(geo, [bodyMat, frameMat, seamMat]);
  mesh.name = 'wall';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const collider = makeCollider(
    p[0], p[1], p[2], w * 0.5, h * 0.5, d * 0.5,
    rotQuat(def && def.rot, new THREE.Quaternion()),
    (def && def.surface) || 'normal', null, null);
  mesh.userData.collider = collider;
  return { mesh, colliders: [collider] };
}

// ---------------------------------------------------------------------------
// RING
// ---------------------------------------------------------------------------
/**
 * A machined ring (gate / goal hoop): chamfered rectangular cross-section, an
 * emissive inner band, segment plates every 45 deg and mounting struts.
 * Collision is opt-in (`def.solid`) — most rings are meant to be flown through.
 */
export function buildRing(def, theme, mats) {
  const r = (def && (def.r || def.radius)) || size3(def, 3, 3, 0.4)[0] * 0.5;
  const tube = (def && def.tube) || Math.max(0.10, r * 0.09);
  const gs = glowSpec(def);
  const glow = gs.k;
  const struts = (def && def.struts !== undefined) ? (def.struts | 0) : 2;
  const bodyMat = materialFor((def && def.mat) || 'metal', theme, mats);
  const trimMat = materialFor('panel', theme, mats);
  const bandMat = emissiveMat(
    (def && def.tint) ? pal(theme, def.tint)
      : (gs.color !== null ? gs.color : pal(theme, 'checkpointOn')),
    2.4 * glow);

  const key = GeoCache.key('ring', r, tube, struts);
  const geo = GeoCache.get(key, () => {
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    push(ringProfileGeometry(r, [tube, tube * 1.15, tube * 0.32], 56, 1.0), 0);
    push(ringProfileGeometry(r - tube * 0.55, [tube * 0.16, tube * 0.62, tube * 0.06], 56, 1.6), 2);
    push(ringProfileGeometry(r + tube * 0.78, [tube * 0.22, tube * 0.42, tube * 0.10], 56, 1.4), 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      push(xform(bevelBoxGeometry(tube * 0.9, tube * 2.5, tube * 0.55, tube * 0.12, 1.5),
        Math.cos(a) * (r + tube * 0.5), Math.sin(a) * (r + tube * 0.5), 0, 0, 0, a + Math.PI * 0.5), 1);
    }
    for (let i = 0; i < struts; i++) {
      const a = Math.PI + (i - (struts - 1) * 0.5) * 0.55;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      const len = Math.abs(py) + r * 0.15;
      push(xform(bevelBoxGeometry(tube * 0.8, len, tube * 0.8, tube * 0.2, 1.0),
        px, py - len * 0.5 + tube * 0.2, 0), 0);
    }
    return assembleIndexed(parts, 3);
  });

  // the ring stands in the XY plane; rotate the whole geometry into place via rot
  const mesh = new THREE.Mesh(geo, [bodyMat, trimMat, bandMat]);
  mesh.name = 'ring';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const colliders = [];
  if (def && def.solid) {
    const q = rotQuat(def && def.rot, new THREE.Quaternion());
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      _v0.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyQuaternion(q);
      colliders.push(makeCollider(p[0] + _v0.x, p[1] + _v0.y, p[2] + _v0.z,
        tube * 1.2, tube * 1.2, tube * 1.4, q.clone(), 'normal', null, null));
    }
  }
  return { mesh, colliders };
}

// ---------------------------------------------------------------------------
// ARCH
// ---------------------------------------------------------------------------
/**
 * Two piers plus a real voussoir span (individually rotated chamfered blocks
 * around the arc), a keystone, and an emissive strip on the intrados so a gate
 * reads as a doorway from across the stage.
 */
export function buildArch(def, theme, mats) {
  const s = size3(def, 6, 5, 1.2);
  const w = s[0], h = s[1], d = s[2];
  const pierW = (def && def.pier) || Math.min(1.0, w * 0.18);
  const rise = (def && def.rise) || Math.min(h * 0.42, Math.max(0.4, (w - pierW * 2) * 0.5));
  const gs = glowSpec(def);
  const glow = gs.k;
  const bodyMat = materialFor((def && def.mat) || 'stone', theme, mats);
  const trimMat = materialFor('metal', theme, mats);
  const lineMat = emissiveMat(gs.color !== null ? gs.color : pal(theme, 'accent'), 1.6 * glow);

  const key = GeoCache.key('arch', w, h, d, pierW, rise);
  const geo = GeoCache.get(key, () => {
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    const span = Math.max(0.4, w - pierW * 2);
    const pierH = Math.max(0.4, h - rise);

    for (const sg of [-1, 1]) {
      const x = sg * (w * 0.5 - pierW * 0.5);
      push(xform(bevelBoxGeometry(pierW * 1.28, 0.26, d * 1.24, 0.04, 0.8), x, 0.13, 0), 0);
      push(xform(bevelBoxGeometry(pierW, Math.max(0.05, pierH - 0.26), d, 0.05, 0.7),
        x, 0.26 + Math.max(0.05, pierH - 0.26) * 0.5, 0), 0);
      push(xform(bevelBoxGeometry(pierW * 1.2, 0.16, d * 1.16, 0.03, 1.0), x, pierH + 0.08, 0), 1);
      push(xform(boxGeometry(pierW * 1.1, 0.016, d * 1.1, 1.2), x, pierH + 0.17, 0), 2);
    }

    const R = span * 0.5;
    const N = 13;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const a = Math.PI * t;
      const cx = -Math.cos(a) * R;
      const cy = pierH + Math.sin(a) * rise;
      const blockW = (Math.PI * R) / N * 1.06;
      const ang = Math.atan2(Math.cos(a) * rise, Math.sin(a) * R);
      push(xform(bevelBoxGeometry(blockW, 0.46, d, 0.035, 0.9), cx, cy, 0, 0, 0, -ang + Math.PI * 0.5),
        (i * 2 === N - 1) ? 1 : 0);
    }
    push(xform(bevelBoxGeometry(0.42, 0.68, d * 1.08, 0.045, 1.0), 0, pierH + rise + 0.08, 0), 1);

    const M = N * 2;
    for (let i = 0; i < M; i++) {
      const t = (i + 0.5) / M;
      const a = Math.PI * t;
      const cx = -Math.cos(a) * Math.max(0.05, R - 0.10);
      const cy = pierH + Math.sin(a) * Math.max(0.05, rise - 0.10);
      const ang = Math.atan2(Math.cos(a) * rise, Math.sin(a) * R);
      push(xform(boxGeometry((Math.PI * R) / M * 1.1, 0.03, d * 0.5, 1.4), cx, cy, 0, 0, 0, -ang + Math.PI * 0.5), 2);
    }
    return assembleIndexed(parts, 3);
  });

  const mesh = new THREE.Mesh(geo, [bodyMat, trimMat, lineMat]);
  mesh.name = 'arch';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;

  const colliders = [];
  if (!def || def.solid !== false) {
    const q = rotQuat(def && def.rot, new THREE.Quaternion());
    const pierH = Math.max(0.4, h - rise);
    for (const sg of [-1, 1]) {
      _v0.set(sg * (w * 0.5 - pierW * 0.5), pierH * 0.5, 0).applyQuaternion(q);
      colliders.push(makeCollider(p[0] + _v0.x, p[1] + _v0.y, p[2] + _v0.z,
        pierW * 0.5, pierH * 0.5, d * 0.5, q.clone(), 'normal', null, null));
    }
  }
  return { mesh, colliders };
}

// ---------------------------------------------------------------------------
// DECO
// ---------------------------------------------------------------------------
/** mulberry32 — same generator as core/util.js, inlined to avoid a dependency. */
function rngFrom(seed) {
  let a = (seed | 0) >>> 0 || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The scatter vocabulary buildDeco understands via `def.kindOf`. */
export const DECO_KINDS = ['rocks', 'spires', 'fins', 'pipes', 'slabs', 'crystals', 'shard', 'antennae', 'girders'];

/**
 * Decoration must never wear the landable body material — a floating rock in
 * the platform's own stone reads as a platform (Sky Temple shipped exactly
 * that: sand rocks, sand decks, sand fog, one colour, three meanings). Deco
 * bodies get the theme's `palette.deco` tint instead: same texture family,
 * visibly NOT the course. Cached per theme.
 */
function decoBodyMaterial(theme) {
  const id = 'decoBody|' + themeId(theme);
  let m = _matCache.get(id);
  if (m) return m;
  const f = family('speckle');
  const opts = {
    color: pal(theme, 'deco'),
    roughness: 0.94,
    metalness: 0.02,
  };
  if (f.map) {
    opts.map = f.map;
    opts.roughnessMap = f.roughnessMap;
    opts.normalMap = f.normalMap;
  }
  m = new THREE.MeshStandardMaterial(opts);
  if (f.normalMap) m.normalScale = new THREE.Vector2(1.0, 1.0);
  m.name = 'deco_body';
  _matCache.set(id, m);
  return m;
}

/**
 * A decorative cluster, deterministic from `def.seed`, merged into ONE mesh and
 * with NO colliders — decoration must never be something you can stand on by
 * accident. Small clusters lose castShadow (see feedback_forgeflow_games_fps).
 */
export function buildDeco(def, theme, mats) {
  const kindOf = (def && def.kindOf) || 'rocks';
  const count = Math.max(1, Math.min(64, (def && def.count) || 6));
  const scale = (def && def.scale) || 1;
  const seed = (def && def.seed !== undefined) ? def.seed : 1337;
  const gs = glowSpec(def);
  const glow = gs.k;

  // `spread` is a radius, or [sx, sy, sz]: a box scatter with vertical jitter.
  // (Stage data ships arrays — a naive number multiply turned every such cluster
  // into NaN geometry that silently rendered nothing and poisoned chunk bounds.)
  const sprRaw = def && def.spread;
  let sprX = 3, sprY = 0, sprZ = null;
  if (Array.isArray(sprRaw)) {
    sprX = Math.abs(+sprRaw[0]) || 3;
    sprY = Math.abs(+sprRaw[1]) || 0;
    sprZ = sprRaw[2] === undefined ? sprX : (Math.abs(+sprRaw[2]) || 0);
  } else if (typeof sprRaw === 'number' && isFinite(sprRaw) && sprRaw > 0) {
    sprX = sprRaw;
  }

  const authoredMat = def && def.mat;
  const baseKey = authoredMat
    || ((kindOf === 'crystals' || kindOf === 'shard') ? 'crystal' : kindOf === 'rocks' ? 'stone' : 'metal');
  // rocks / slabs (and any unrecognised kind, which falls to the rocks shape)
  // are the flat-topped, landable-looking clusters: they must NOT wear the
  // course's stone. See decoBodyMaterial.
  const rockShaped = kindOf === 'rocks' || kindOf === 'slabs' || DECO_KINDS.indexOf(kindOf) < 0;
  const useDecoBody = rockShaped && (!authoredMat || authoredMat === 'stone' || authoredMat === 'sand');
  const bodyMat = useDecoBody ? decoBodyMaterial(theme) : materialFor(baseKey, theme, mats);
  const trimMat = materialFor('obsidian', theme, mats);
  const emMat = emissiveMat(gs.color !== null ? gs.color : pal(theme, 'deco'),
    (kindOf === 'crystals' || kindOf === 'shard' || kindOf === 'antennae' ? 2.0 : 0.8) * glow);

  const key = GeoCache.key('deco', kindOf, count, sprX, sprY, sprZ === null ? 'r' : sprZ, scale, seed);
  const geo = GeoCache.get(key, () => {
    const rnd = rngFrom(Math.imul(seed | 0, 2654435761));
    const parts = [];
    const push = (g, m) => parts.push({ geo: g, mat: m });
    for (let i = 0; i < count; i++) {
      let x, z;
      if (sprZ !== null) {
        x = (rnd() * 2 - 1) * sprX;
        z = (rnd() * 2 - 1) * sprZ;
      } else {
        const ang = rnd() * Math.PI * 2;
        const rad = Math.sqrt(rnd()) * sprX;
        x = Math.cos(ang) * rad; z = Math.sin(ang) * rad;
      }
      const by = sprY > 0 ? rnd() * sprY : 0;   // vertical jitter (box scatter)
      const yaw = rnd() * Math.PI * 2;
      const sc = scale * (0.6 + rnd() * 0.8);

      if (kindOf === 'spires') {
        // Leaning flat-topped monoliths. The old silhouette was a needle-sharp
        // cone with a pointed tip — the universal obby language of kill spikes,
        // worn by decoration (readability law: decor must never impersonate a
        // hazard). Truncated shaft, hex cap, real lean: crystal, not spike.
        const hgt = 1.6 * sc * (0.7 + rnd());
        const leanZ = (rnd() - 0.5) * 0.30;
        push(xform(tubeGeometry(0.10 * sc, 0.24 * sc, hgt, 6, 1.0), x, by + hgt * 0.5, z, 0, yaw, leanZ), 0);
        const tx = x - Math.sin(leanZ) * hgt * 0.5 * Math.cos(yaw);
        const tz = z + Math.sin(leanZ) * hgt * 0.5 * Math.sin(yaw);
        push(xform(prismGeometry(0.085 * sc, 0.09 * sc, 6, 1.4),
          tx, by + hgt * 0.5 + Math.cos(leanZ) * hgt * 0.5 - 0.02 * sc, tz, 0, yaw, leanZ), 2);
      } else if (kindOf === 'fins') {
        const hgt = 1.1 * sc * (0.6 + rnd());
        push(xform(bevelBoxGeometry(0.09 * sc, hgt, 0.85 * sc, 0.02, 1.1), x, by + hgt * 0.5, z, 0, yaw, (rnd() - 0.5) * 0.14), 0);
        push(xform(boxGeometry(0.02, hgt * 0.7, 0.02, 1), x, by + hgt * 0.55, z + 0.42 * sc, 0, yaw, 0), 2);
      } else if (kindOf === 'pipes') {
        const len = 1.8 * sc * (0.6 + rnd());
        const tilt = (rnd() - 0.5) * 0.5;
        push(xform(tubeGeometry(0.11 * sc, 0.11 * sc, len, 10, 0.8), x, by + 0.35 * sc, z, Math.PI * 0.5, yaw, tilt), 0);
        push(xform(ringProfileGeometry(0.14 * sc, [0.035 * sc, 0.05 * sc, 0.012], 12, 1.4), x, by + 0.35 * sc, z, Math.PI * 0.5, yaw, tilt), 1);
      } else if (kindOf === 'slabs') {
        const hgt = 0.35 * sc * (0.6 + rnd());
        push(xform(bevelBoxGeometry(1.1 * sc, hgt, 0.9 * sc, 0.05, 0.7), x, by + hgt * 0.5, z, (rnd() - 0.5) * 0.12, yaw, (rnd() - 0.5) * 0.12), 0);
      } else if (kindOf === 'crystals' || kindOf === 'shard') {
        // Crystals, NOT spikes: truncated tops and a pronounced lean, so a
        // cluster near the course line can never read as a kill spike bed.
        const hgt = 1.0 * sc * (0.5 + rnd() * 1.2);
        const rB = 0.17 * sc;
        const leanX = (rnd() - 0.5) * 0.7, leanZ = (rnd() - 0.5) * 0.7;
        push(xform(tubeGeometry(rB * 0.34, rB, hgt, 5, 1.2), x, by + hgt * 0.45, z, leanX, yaw, leanZ), 0);
        push(xform(tubeGeometry(rB * 0.32, rB * 0.55, hgt * 0.55, 5, 1.6),
          x + 0.14 * sc, by + hgt * 0.22, z - 0.10 * sc, leanX * 1.6, yaw, leanZ * 1.6), 2);
      } else if (kindOf === 'antennae') {
        const hgt = 2.4 * sc * (0.7 + rnd() * 0.6);
        push(xform(tubeGeometry(0.018 * sc, 0.06 * sc, hgt, 6, 1.0), x, by + hgt * 0.5, z, 0, yaw, 0), 0);
        for (let k = 1; k <= 3; k++) {
          push(xform(boxGeometry(0.34 * sc * (1 - k * 0.2), 0.016, 0.016, 1), x, by + hgt * (0.45 + k * 0.16), z, 0, yaw + k * 0.7, 0), 1);
        }
        push(xform(prismGeometry(0.045 * sc, 0.05 * sc, 6, 2.0), x, by + hgt + 0.03, z), 2);
      } else if (kindOf === 'girders') {
        const len = 2.6 * sc * (0.6 + rnd());
        const y = by + 0.4 * sc + rnd() * 0.5;
        const rr = (rnd() - 0.5) * 0.3, rz = (rnd() - 0.5) * 0.4;
        push(xform(bevelBoxGeometry(len, 0.16 * sc, 0.16 * sc, 0.02, 0.8), x, y, z, rr, yaw, rz), 0);
        push(xform(bevelBoxGeometry(len * 0.96, 0.05 * sc, 0.34 * sc, 0.012, 1.2), x, y, z, rr, yaw, rz), 1);
      } else { // rocks
        const s2 = sc * 0.55;
        push(xform(bevelBoxGeometry(s2 * (0.8 + rnd() * 0.8), s2 * (0.5 + rnd() * 0.7), s2 * (0.8 + rnd() * 0.8), s2 * 0.22, 1.0),
          x, by + s2 * 0.3, z, (rnd() - 0.5) * 0.7, yaw, (rnd() - 0.5) * 0.7), 0);
        if (rnd() > 0.5) {
          push(xform(bevelBoxGeometry(s2 * 0.5, s2 * 0.4, s2 * 0.5, s2 * 0.16, 1.2),
            x + s2 * 0.5, by + s2 * 0.22, z - s2 * 0.4, (rnd() - 0.5) * 0.9, yaw, (rnd() - 0.5) * 0.9), 1);
        }
      }
    }
    return assembleIndexed(parts, 3);
  });

  const mesh = new THREE.Mesh(geo, [bodyMat, trimMat, emMat]);
  mesh.name = 'deco_' + kindOf;
  const rad = geo.boundingSphere ? geo.boundingSphere.radius : 1;
  mesh.castShadow = rad >= 0.75;
  mesh.receiveShadow = true;
  const p = pos3(def);
  mesh.position.set(p[0], p[1], p[2]);
  applyRot(mesh, def && def.rot);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return { mesh, colliders: [] };
}

// ---------------------------------------------------------------------------
// edgeStripe
// ---------------------------------------------------------------------------
/** Coerce any geometry to non-indexed {position, normal, uv}; never mutates input. */
function toStandardGeometry(geo) {
  let extra = false;
  for (const k in geo.attributes) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') { extra = true; break; }
  }
  const needs = !!geo.index || !geo.attributes.uv || !geo.attributes.normal || extra;
  if (!needs) return geo;
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k in g.attributes) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.userData.__shared = false;
  return g;
}

/**
 * Add the "you can land here" highlight to a mesh built elsewhere — mover lids,
 * hazard tops, bespoke geometry. Works out the local bounding box, lays a band
 * on the top face inset from each requested edge plus a matching band down the
 * vertical face, and appends it as a new material group.
 *
 * Never mutates a cached geometry: a `__shared` geometry is cloned first.
 *
 * @param {THREE.Mesh} mesh
 * @param {number|string|THREE.Color} color
 * @param {number} [width=0.12] band width in metres
 * @param {object} [opts] {faces:['+x','-z','+y'], intensity:2.6}
 * @returns {THREE.Mesh} the same mesh, for chaining
 */
export function edgeStripe(mesh, color, width, opts) {
  if (!mesh || !mesh.isMesh || !mesh.geometry) return mesh;
  const o = opts || null;
  const W = width === undefined ? 0.12 : width;
  const faces = (o && o.faces && o.faces.length) ? o.faces : ['+x'];
  const intensity = (o && o.intensity !== undefined) ? o.intensity : 2.6;

  let geo = mesh.geometry;
  if (geo.userData.__shared) {
    geo = geo.clone();
    geo.userData.__shared = false;
    mesh.geometry = geo;
  }
  const host = toStandardGeometry(geo);
  if (!host.boundingBox) host.computeBoundingBox();
  const bb = host.boundingBox;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z;
  if (!(w > 0 && d > 0)) { if (host !== geo) host.dispose(); return mesh; }
  const cx = (bb.max.x + bb.min.x) * 0.5, cz = (bb.max.z + bb.min.z) * 0.5;
  const topY = bb.max.y;
  const vH = Math.min(0.14, Math.max(0.04, h * 0.5));

  const bands = [];
  const keys = [];   // dark keyline flanks (see keylineMaterial) — appended as their own group
  const KW = 0.03;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f === '+x' || f === '-x') {
      const sg = f === '+x' ? 1 : -1;
      const bx = cx + sg * (w * 0.5 - W * 0.5 - 0.03);
      bands.push(xform(boxGeometry(W, 0.014, d * 0.96, 1), bx, topY - 0.004, cz));
      keys.push(xform(boxGeometry(KW, 0.016, d * 0.96, 1), bx + sg * (W * 0.5 + KW * 0.5), topY - 0.003, cz));
      keys.push(xform(boxGeometry(KW, 0.016, d * 0.96, 1), bx - sg * (W * 0.5 + KW * 0.5), topY - 0.003, cz));
      bands.push(xform(boxGeometry(0.02, vH, d * 0.96, 1), cx + sg * (w * 0.5 + 0.005), topY - 0.02 - vH * 0.5, cz));
    } else if (f === '+z' || f === '-z') {
      const sg = f === '+z' ? 1 : -1;
      const bz = cz + sg * (d * 0.5 - W * 0.5 - 0.03);
      bands.push(xform(boxGeometry(w * 0.96, 0.014, W, 1), cx, topY - 0.004, bz));
      keys.push(xform(boxGeometry(w * 0.96, 0.016, KW, 1), cx, topY - 0.003, bz + sg * (W * 0.5 + KW * 0.5)));
      keys.push(xform(boxGeometry(w * 0.96, 0.016, KW, 1), cx, topY - 0.003, bz - sg * (W * 0.5 + KW * 0.5)));
      bands.push(xform(boxGeometry(w * 0.96, vH, 0.02, 1), cx, topY - 0.02 - vH * 0.5, cz + sg * (d * 0.5 + 0.005)));
    } else if (f === '+y') {
      const rr = Math.min(w, d) * 0.5;
      bands.push(xform(ringGeometry(Math.max(0.01, rr - W), rr, 40, 1), cx, topY + 0.004, cz));
      keys.push(xform(ringGeometry(Math.max(0.005, rr - W - KW), Math.max(0.01, rr - W), 40, 1), cx, topY + 0.0045, cz));
    }
  }
  if (bands.length === 0) { if (host !== geo) host.dispose(); return mesh; }
  const band = bands.length === 1 ? bands[0] : mergeGeometries(bands, false);
  if (bands.length > 1) for (const b of bands) b.dispose();
  if (!band) { for (const k of keys) k.dispose(); if (host !== geo) host.dispose(); return mesh; }
  const keyBand = keys.length === 0 ? null : (keys.length === 1 ? keys[0] : mergeGeometries(keys, false));
  if (keys.length > 1) for (const k of keys) k.dispose();

  const hostCount = host.attributes.position.count;
  // A mesh with a SINGLE material renders its whole geometry with it — three
  // ignores groups in that case — so collapse the host to one group before we
  // append ours, otherwise the primitive's stale materialIndexes (BoxGeometry
  // ships six) would start pointing at the stripe material.
  const mats = Array.isArray(mesh.material) ? mesh.material.slice() : [mesh.material];
  const hostGroups = (Array.isArray(mesh.material) && host.groups.length)
    ? host.groups.map((g) => ({
      start: g.start,
      count: g.count,
      materialIndex: Math.min(g.materialIndex || 0, mats.length - 1),
    }))
    : [{ start: 0, count: hostCount, materialIndex: 0 }];

  const bandCount = band.attributes.position.count;
  const merged = keyBand ? mergeGeometries([host, band, keyBand], false)
                         : mergeGeometries([host, band], false);
  band.dispose();
  if (keyBand) keyBand.dispose();
  if (host !== geo) host.dispose();
  if (!merged) return mesh;

  merged.clearGroups();
  for (let i = 0; i < hostGroups.length; i++) {
    merged.addGroup(hostGroups[i].start, hostGroups[i].count, hostGroups[i].materialIndex);
  }
  merged.addGroup(hostCount, bandCount, mats.length);
  mats.push(emissiveMat(_col.set(color).getHex(), intensity));
  if (keyBand) {
    merged.addGroup(hostCount + bandCount, merged.attributes.position.count - hostCount - bandCount, mats.length);
    mats.push(keylineMaterial());
  }
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  merged.userData.__shared = false;
  if (geo !== merged) geo.dispose();
  mesh.geometry = merged;
  mesh.material = mats;
  return mesh;
}

// ---------------------------------------------------------------------------
// InstancedGroup
// ---------------------------------------------------------------------------
const _instMat = new THREE.Matrix4();

/** Parse a built-in geometry key, e.g. 'box:1,0.2,1' or 'cyl:0.2,0.2,1,10'. */
function builtinGeometry(spec) {
  const c = spec.indexOf(':');
  const kind = c < 0 ? spec : spec.slice(0, c);
  const a = c < 0 ? [] : spec.slice(c + 1).split(',').map(Number);
  switch (kind) {
    case 'box': return boxGeometry(a[0] || 1, a[1] || 1, a[2] || 1, 1);
    case 'bevel': return bevelBoxGeometry(a[0] || 1, a[1] || 1, a[2] || 1, a[3] === undefined ? 0.04 : a[3], 1);
    case 'cyl': return tubeGeometry(a[0] === undefined ? 0.2 : a[0], a[1] === undefined ? (a[0] || 0.2) : a[1], a[2] || 1, a[3] || 12, 1);
    case 'cone': return tubeGeometry(0, a[0] || 0.3, a[1] || 1, a[2] || 10, 1);
    case 'stud': return prismGeometry(a[0] || 0.05, a[1] || 0.03, a[2] || 6, 2);
    case 'prism': return prismGeometry(a[0] || 0.3, a[1] || 0.6, a[2] || 6, 1);
    case 'ring': return ringProfileGeometry(a[0] || 1, [a[1] || 0.1, a[2] || 0.1, a[3] || 0.03], a[4] || 32, 1);
    case 'disc': return discGeometry((a[0] || 1) * 0.5, a[1] || 24);
    case 'plate': return ringGeometry(0, (a[0] || 1) * 0.5, a[1] || 24, 1);
    case 'quad': return quadGeometry(a[0] || 1, a[1] || 1, 1, 1, 1);
    default: return null;
  }
}

/**
 * Accumulate (geometryKey, materialKey, matrix, colour) then `commit()` into
 * InstancedMesh objects with per-instance colour, correct bounding spheres and
 * the right shadow flags.
 *
 * Small clutter (geometry bounding radius < 0.75 m) gets castShadow = FALSE —
 * see feedback_forgeflow_games_fps: shadow-casting clutter is the single
 * biggest avoidable cost on integrated graphics.
 */
export class InstancedGroup {
  /**
   * @param {object} [opts] {theme, mats, name, receiveShadow, castShadowRadius}
   */
  constructor(opts) {
    const o = opts || {};
    this.theme = o.theme || null;
    this.mats = o.mats || null;
    this.name = o.name || 'instanced';
    this.receiveShadow = o.receiveShadow !== false;
    this.castShadowRadius = o.castShadowRadius === undefined ? 0.75 : o.castShadowRadius;
    this._geo = new Map();      // geoKey -> BufferGeometry
    this._own = new Set();      // geometries we created and must dispose
    this._mat = new Map();      // matKey -> Material
    this._buckets = new Map();  // "geoKey matKey" -> {geoKey, matKey, m:[], c:[]}
    this._committed = [];
  }

  /** Register a custom geometry for a key (overrides the built-in parser). */
  define(geoKey, geometry) {
    const g = toStandardGeometry(geometry);
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g !== geometry) this._own.add(g);
    this._geo.set(geoKey, g);
    return this;
  }

  /** Register a custom material for a key (overrides the material bank). */
  defineMaterial(matKey, material) {
    this._mat.set(matKey, material);
    return this;
  }

  /**
   * @param {string} geoKey registered key, or a built-in spec like 'box:1,0.2,1'
   * @param {string} matKey registered key, or a Mats/bank key ('stone', 'metal', ...)
   * @param {THREE.Matrix4|THREE.Object3D} matrix
   * @param {number|THREE.Color} [color] per-instance tint
   */
  add(geoKey, matKey, matrix, color) {
    const k = geoKey + ' ' + matKey;
    let b = this._buckets.get(k);
    if (!b) { b = { geoKey, matKey, m: [], c: [] }; this._buckets.set(k, b); }
    let src;
    if (matrix && matrix.isMatrix4) src = matrix;
    else if (matrix && matrix.isObject3D) { matrix.updateMatrix(); src = matrix.matrix; }
    else src = _instMat.identity();
    const arr = new Float32Array(16);
    arr.set(src.elements);
    b.m.push(arr);
    b.c.push(color === undefined || color === null ? -1 : (color.isColor ? color.getHex() : color));
    return this;
  }

  /** Convenience: add from position/quaternion/uniform-or-xyz scale. */
  addTRS(geoKey, matKey, x, y, z, quat, sx, sy, sz, color) {
    _v0.set(x, y, z);
    if (quat) _q0.copy(quat); else _q0.identity();
    const ux = sx === undefined ? 1 : sx;
    _s0.set(ux, sy === undefined ? ux : sy, sz === undefined ? ux : sz);
    _instMat.compose(_v0, _q0, _s0);
    return this.add(geoKey, matKey, _instMat, color);
  }

  /** Total instances accumulated so far. */
  get count() {
    let n = 0;
    for (const b of this._buckets.values()) n += b.m.length;
    return n;
  }

  _geometryFor(geoKey) {
    let g = this._geo.get(geoKey);
    if (g) return g;
    g = builtinGeometry(geoKey);
    if (!g) g = boxGeometry(0.25, 0.25, 0.25, 1); // visible marker beats a silent hole
    g.computeBoundingSphere();
    this._own.add(g);
    this._geo.set(geoKey, g);
    return g;
  }

  _materialFor(matKey) {
    let m = this._mat.get(matKey);
    if (m) return m;
    m = materialFor(matKey, this.theme, this.mats);
    this._mat.set(matKey, m);
    return m;
  }

  /** @returns {THREE.InstancedMesh[]} */
  commit() {
    const out = [];
    for (const b of this._buckets.values()) {
      const n = b.m.length;
      if (n === 0) continue;
      const geo = this._geometryFor(b.geoKey);
      const mat = this._materialFor(b.matKey);
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.name = this.name + ':' + b.geoKey;
      let anyColor = false;
      for (let i = 0; i < n; i++) {
        _instMat.fromArray(b.m[i]);
        im.setMatrixAt(i, _instMat);
        if (b.c[i] >= 0) {
          anyColor = true;
          _col.setHex(b.c[i]);
          im.setColorAt(i, _col);
        }
      }
      if (anyColor) {
        // instances without an explicit colour must render white, not black
        for (let i = 0; i < n; i++) {
          if (b.c[i] < 0) { _col.setHex(0xffffff); im.setColorAt(i, _col); }
        }
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
      im.instanceMatrix.needsUpdate = true;
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const radius = geo.boundingSphere ? geo.boundingSphere.radius : 1;
      im.castShadow = radius >= this.castShadowRadius;
      im.receiveShadow = this.receiveShadow;
      im.frustumCulled = true;
      im.computeBoundingSphere();
      im.updateMatrix();
      im.matrixAutoUpdate = false;
      out.push(im);
    }
    this._committed = out;
    return out;
  }

  /** Drop accumulated instance data; geometry/material registrations survive. */
  clear() { this._buckets.clear(); return this; }

  dispose() {
    for (const im of this._committed) {
      if (im.parent) im.parent.remove(im);
      im.dispose();
    }
    this._committed.length = 0;
    for (const g of this._own) if (!g.userData.__shared) g.dispose();
    this._own.clear();
    this._geo.clear();
    this._buckets.clear();
  }
}

// ---------------------------------------------------------------------------
// mergeStatic
// ---------------------------------------------------------------------------
/** Extract one material group of a geometry as a standalone non-indexed slice. */
function sliceGroup(geo, group) {
  const src = geo.attributes;
  const count = group.count;
  if (count <= 0) return null;
  const out = new THREE.BufferGeometry();
  const keys = ['position', 'normal', 'uv'];
  if (geo.index) {
    const idx = geo.index;
    for (let ki = 0; ki < keys.length; ki++) {
      const a = src[keys[ki]];
      if (!a) continue;
      const it = a.itemSize;
      const dst = new Float32Array(count * it);
      for (let i = 0; i < count; i++) {
        const v = idx.getX(group.start + i);
        for (let c = 0; c < it; c++) dst[i * it + c] = a.array[v * it + c];
      }
      out.setAttribute(keys[ki], new THREE.BufferAttribute(dst, it));
    }
  } else {
    for (let ki = 0; ki < keys.length; ki++) {
      const a = src[keys[ki]];
      if (!a) continue;
      const it = a.itemSize;
      const dst = new Float32Array(count * it);
      dst.set(a.array.subarray(group.start * it, (group.start + count) * it));
      out.setAttribute(keys[ki], new THREE.BufferAttribute(dst, it));
    }
  }
  if (!out.attributes.position) { out.dispose(); return null; }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  }
  return out;
}

/**
 * Merge all the static, same-material platform art in a stage into a handful of
 * draw calls. Run once, at stage build time, after every builder has placed its
 * mesh. Geometry is baked into the SHARED PARENT's local space, so the result
 * can be dropped straight back into that parent (which this does for you when
 * `removeSources` is on and every source shared one parent).
 *
 * Skipped and left alone: `userData.noMerge`, InstancedMesh, SkinnedMesh.
 * Source geometries are NOT disposed by default — they are usually shared out of
 * GeoCache, and disposing one would blank every other user of it.
 *
 * @param {THREE.Mesh[]|THREE.Object3D} meshes array of meshes, or a root to walk
 * @param {object} [opts] {removeSources=true, chunkSize=60, disposeSources=false, name}
 * @returns {THREE.Mesh[]} merged meshes, in the shared parent's local space
 */
export function mergeStatic(meshes, opts) {
  const o = opts || {};
  const removeSources = o.removeSources !== false;
  const disposeSources = o.disposeSources === true;
  const chunkSize = o.chunkSize === undefined ? 60 : o.chunkSize;

  const list = [];
  if (Array.isArray(meshes)) {
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (m && m.isMesh) list.push(m);
    }
  } else if (meshes && meshes.traverse) {
    meshes.traverse((x) => { if (x.isMesh) list.push(x); });
  }

  // pass 1 — eligibility + a common parent
  const eligible = [];
  let parent = null, mixedParents = false;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.userData.noMerge || m.isInstancedMesh || m.isSkinnedMesh) continue;
    const geo = m.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position || geo.attributes.position.count === 0) continue;
    if (!m.material) continue;
    eligible.push(m);
    if (parent === null) parent = m.parent;
    else if (parent !== m.parent) mixedParents = true;
  }
  if (eligible.length === 0) return [];

  const host = mixedParents ? null : parent;
  if (host) { host.updateWorldMatrix(true, false); _m1.copy(host.matrixWorld).invert(); }
  else _m1.identity();

  // pass 2 — slice, transform, bucket
  const buckets = new Map();
  for (let i = 0; i < eligible.length; i++) {
    const m = eligible[i];
    m.updateWorldMatrix(true, false);
    _m2.multiplyMatrices(_m1, m.matrixWorld);

    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const geo = m.geometry;
    const total = geo.index ? geo.index.count : geo.attributes.position.count;
    const groups = (geo.groups && geo.groups.length) ? geo.groups : null;

    let ck = 0;
    if (chunkSize > 0) {
      _v0.setFromMatrixPosition(m.matrixWorld);
      ck = (Math.floor(_v0.x / chunkSize) * 73856093)
         ^ (Math.floor(_v0.y / chunkSize) * 19349663)
         ^ (Math.floor(_v0.z / chunkSize) * 83492791);
    }

    const n = groups ? groups.length : 1;
    for (let gi = 0; gi < n; gi++) {
      const g = groups ? groups[gi] : { start: 0, count: total, materialIndex: 0 };
      const mat = mats[g.materialIndex] || mats[0];
      if (!mat) continue;
      const slice = sliceGroup(geo, g);
      if (!slice) continue;
      slice.applyMatrix4(_m2);
      const k = ck + ' ' + mat.uuid;
      let b = buckets.get(k);
      if (!b) { b = { mat, geos: [], cast: false, recv: false }; buckets.set(k, b); }
      b.geos.push(slice);
      b.cast = b.cast || m.castShadow;
      b.recv = b.recv || m.receiveShadow;
    }
  }

  // pass 3 — merge each bucket into one mesh
  const out = [];
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.name = (o.name || 'static') + '_' + (b.mat.name || b.mat.type);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.userData.merged = true;
    out.push(mesh);
  }

  if (removeSources) {
    for (let i = 0; i < eligible.length; i++) {
      const m = eligible[i];
      if (m.parent) m.parent.remove(m);
      if (disposeSources && m.geometry && !m.geometry.userData.__shared) m.geometry.dispose();
    }
    if (host) for (let i = 0; i < out.length; i++) host.add(out[i]);
  }
  return out;
}

/** Triangle total across meshes/roots — for the CONTRACT §4 perf budget. */
export function triangleCount(objects) {
  let t = 0;
  const visit = (o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const n = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
      t += (n / 3) * (o.isInstancedMesh ? o.count : 1);
    }
    const kids = o.children;
    if (kids) for (let i = 0; i < kids.length; i++) visit(kids[i]);
  };
  if (Array.isArray(objects)) for (let i = 0; i < objects.length; i++) visit(objects[i]);
  else if (objects) visit(objects);
  return t;
}

// ---------------------------------------------------------------------------
// dispatch + teardown
// ---------------------------------------------------------------------------
const BUILDERS = {
  platform: buildPlatform,
  beam: buildBeam,
  pad: buildPad,
  jumppad: buildPad,
  speedpad: buildPad,
  pillar: buildPillar,
  wall: buildWall,
  ring: buildRing,
  arch: buildArch,
  deco: buildDeco,
};

/** Build any ObjectDef by its `kind`. Returns null for kinds this module does not own. */
export function build(def, theme, mats) {
  const fn = BUILDERS[def && def.kind];
  return fn ? fn(def, theme, mats) : null;
}

// --- shared with runtime/world/props.js ------------------------------------
// props.js builds its procedural set out of the same material bank and the same
// geometry emitters, so a torch bracket and a platform rim are literally the
// same steel. These are the only cross-module surface builders.js offers.

/** Resolve a material key against the Mats service, else the internal bank. */
export function getMaterial(key, theme, mats) { return materialFor(key, theme, mats); }

/** Cached flat emissive material (readability bands, cores, seams). */
export function getEmissive(color, intensity, opts) { return emissiveMat(color, intensity, opts); }

/** Cached additive glow material. `opts.mode`: 'shaft' (UV.y gradient) | 'radial'. */
export function getGlow(color, opts) { return glowMat(color, opts); }

/** Cached breathing-emissive material. */
export function getPulse(color, base, amp, speed) { return pulseMat(color, base, amp, speed); }

/** The shared animation-clock uniform object, for materials that want to ride it. */
export function fxTimeUniform() { return FX_TIME; }

/** onBeforeRender hook that advances the shared animation clock. */
export const fxTick = syncFxTime;

/** Release every cached geometry, material and texture owned by this module. */
export function disposeBuilders() {
  GeoCache.clear();
  for (const m of _matCache.values()) m.dispose();
  _matCache.clear();
  for (const m of _emCache.values()) m.dispose();
  _emCache.clear();
  for (const f of _texCache.values()) {
    if (f.map) f.map.dispose();
    if (f.roughnessMap) f.roughnessMap.dispose();
    if (f.normalMap) f.normalMap.dispose();
  }
  _texCache.clear();
}
