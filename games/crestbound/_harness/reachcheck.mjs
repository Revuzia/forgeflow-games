/**
 * CRESTBOUND reach check — the "no impossible jump, no thin course" gate.
 * ===========================================================================
 * Pure Node. No browser, no renderer, no three.js required (a DOM shim is
 * installed only so an OPTIONAL import of runtime/world/terrain.js can succeed).
 *
 * WHAT IT PROVES, per course (CONTRACT "The gates" / §25):
 *
 *   1. REACHABILITY. spawn -> every checkpoint -> every `open` crest -> every
 *      sigil is joined by LEGAL moves, where "legal" is defined by exactly the
 *      numbers the controller uses: `REACH_TABLE` / `bestGap` / `bestRise` from
 *      runtime/core/tuning.js. Nothing in this file re-derives jump physics; if
 *      the tuning changes, the gate changes with it.
 *
 *   2. CONTENT FLOOR. >= 3 checkpoints, >= 100 coins (after expanding ring /
 *      line / arc groups), exactly 8 sigils, exactly 7 crests, >= 6 distinct
 *      hazard/critter families on non-tutorial courses, `bounds` present, and
 *      the spawn inside those bounds.
 *
 * HOW THE GRAPH IS BUILT
 * ----------------------
 * Every authored object that a player can stand on becomes one or more axis-
 * aligned LANDABLE RECTANGLES (a rotated slab is approximated by its AABB and
 * shrunk, which can only make a gap look bigger, never smaller — the
 * conservative direction for a reach gate). Movers contribute a rectangle at
 * each end of their travel and are joined to each other by a `ride` edge,
 * because a moving platform CARRIES you. Terrain is one node: a heightfield you
 * can walk anywhere on where the slope is under `TUNE.slope.slideDeg` (38 deg),
 * so edges to and from it are found by sampling the field near the other
 * surface rather than by rectangle arithmetic.
 *
 * An edge a -> b exists when a legal move covers the horizontal gap at the
 * height difference, given:
 *
 *   runup    metres of straight, unobstructed approach available ON a along the
 *            take-off direction — the chord of a's rectangle through its centre
 *            in the direction of b (terrain gives the open-ground cap). A move
 *            that needs 6 m of run-up is simply not offered from a 2 m ledge.
 *   landings how many prior landings the approach affords, which is what the
 *            double (1) and triple (2) jump chains need. A surface reached in N
 *            hops affords min(2, N) landings; the flood is run to a FIXED POINT
 *            on that value (it only ever increases) so a surface first found by
 *            a short route is re-relaxed when a longer route later grants it the
 *            landings a triple needs.
 *
 * Costs bias the search toward the route a player would actually take (a step is
 * free, a walk-off is cheap, a triple is expensive, a "tight" jump — inside the
 * theoretical max but outside the authoring-safe fraction — is very expensive
 * and always reported as a warning).
 *
 * COLLECTIBLE TARGETS. A sigil or crest hangs in the air. It is reachable when
 * some reachable surface sits under it within `bestRise` of that surface's
 * approach — i.e. you can actually jump up and touch it, not merely stand
 * beneath it.
 *
 * OUTPUT. A table per course, then every problem and warning in full, then the
 * exact "best available move" for each unreachable target: which move the
 * geometry allows, how far it reaches, and how far the author asked for.
 *
 *   node _harness/reachcheck.mjs                     # every course + the Keep
 *   node _harness/reachcheck.mjs verdant-1 ember-2   # named courses only
 *   node _harness/reachcheck.mjs --json report.json
 *   node _harness/reachcheck.mjs --banner            # print the reach envelope
 *
 * Exit 0 = every course passes. Exit 1 = at least one problem. Exit 2 = the
 * harness itself could not run (no tuning, no data directory).
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA_DIR = join(ROOT, 'runtime', 'data');
const COURSE_DIR = join(DATA_DIR, 'courses');

/* ===========================================================================
 * 0. Tuning — the ONLY source of movement numbers
 * ======================================================================== */

let TUNE, REACH_TABLE, bestGap, bestRise, reachBanner, SAFE_FRACTION;
try {
  const t = await import(pathToFileURL(join(ROOT, 'runtime', 'core', 'tuning.js')).href);
  ({ TUNE, REACH_TABLE, bestGap, bestRise, reachBanner, SAFE_FRACTION } = t);
  if (!TUNE || !REACH_TABLE || typeof bestGap !== 'function' || typeof bestRise !== 'function') {
    throw new Error('tuning.js is missing TUNE / REACH_TABLE / bestGap / bestRise');
  }
} catch (e) {
  console.error(`reachcheck: cannot load runtime/core/tuning.js — ${e && e.message}`);
  process.exit(2);
}
if (typeof SAFE_FRACTION !== 'number') SAFE_FRACTION = 0.84;

const STEP_UP = TUNE.stepUp;
const PLAYER_R = TUNE.radius;
const RUN = TUNE.speedRun;
const SLIDE_DEG = TUNE.slope.slideDeg;          // 38: steeper than this is a slide, not a floor
const CLIMB_KICK_UP = (TUNE.climb.kickV && TUNE.climb.kickV[1]) || 11;

/** Straight-approach cap on open ground: more than this is meaningless. */
const OPEN_RUNUP = 12;
/** Largest horizontal gap any move in the table can cover — the search radius. */
const MAX_REACH = (() => {
  let m = 0;
  for (const t of Object.values(REACH_TABLE)) {
    for (const r of t.rows) if (r.max > m) m = r.max;
  }
  return Math.max(8, m + 2);
})();

/* ===========================================================================
 * 1. Minimal DOM shim — so an OPTIONAL terrain.js import can link under Node
 * ======================================================================== */

function shimDom() {
  if (globalThis.window) return;
  const noop = () => {};
  const ctx2d = () => new Proxy({
    canvas: { width: 256, height: 256 },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    measureText: () => ({ width: 10 }),
  }, { get: (t, k) => (k in t ? t[k] : noop) });
  const el = (tag = 'div') => ({
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild: noop, remove: noop, setAttribute: noop, getAttribute: () => null,
    addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }),
    getContext: () => ctx2d(), toDataURL: () => 'data:,', width: 256, height: 256,
  });
  const doc = {
    documentElement: el('html'), head: el('head'), body: el('body'),
    createElement: (t) => el(t), createElementNS: (_n, t) => el(t),
    getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
  };
  const storage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  };
  globalThis.window = {
    document: doc, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 16), cancelAnimationFrame: noop,
    localStorage: storage(), sessionStorage: storage(),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  globalThis.document = doc;
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.HTMLCanvasElement = class {};
  globalThis.HTMLElement = class {};
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
shimDom();

/* ===========================================================================
 * 2. Terrain sampler
 * ---------------------------------------------------------------------------
 * PREFERRED: runtime/world/terrain.js exports `sampleHeights(def)`, which returns
 * a plain `(x, z) => y` function (a baked-grid def yields a bilinear sampler over
 * it). The gate calls that, so it measures the SAME field the game builds and
 * there is no second implementation to drift. A record carrying
 * {heights, nx, nz} is also accepted, for the day that changes.
 *
 * FALLBACK, used only when terrain.js is absent or will not import under Node:
 * an APPROXIMATE recipe sampler for the documented TerrainDef. It is close but
 * not identical to terrain.js's shaping (that module domes its hills and gives a
 * flat a dead-level core), so a run that reports `builtin recipe sampler` as its
 * source is a weaker result than one that reports `terrain.js:sampleHeights` —
 * the banner prints which was used.
 *
 *   def.terrain = {kind:'terrain', origin:[x,z], size:[sx,sz], res, surface,
 *                  heights: Float32Array | number[] | {seed, base,
 *                    hills:[{p:[x,z], r, h}],            // radial domes, added
 *                    ridges:[{a:[x,z], b:[x,z], w, h}],  // segment ridges, added
 *                    flats:[{p:[x,z], r, h}],            // plateaus, blended over
 *                    noise?:{amp, freq, oct}}}           // deterministic fBm
 *
 * Whichever sampler is used, the FOOTPRINT test is this file's: heights outside
 * `origin .. origin + size` read NaN, so the flood can never walk off the edge of
 * the world onto ground that does not exist.
 * ======================================================================== */

let terrainSampler = null;      // (def) => ((x,z)=>y) | {heights,nx,nz}, or null
let terrainSource = 'builtin';
try {
  const tp = join(ROOT, 'runtime', 'world', 'terrain.js');
  if (existsSync(tp)) {
    const mod = await import(pathToFileURL(tp).href);
    if (typeof mod.sampleHeights === 'function') {
      terrainSampler = mod.sampleHeights;
      terrainSource = 'terrain.js:sampleHeights';
    }
  }
} catch (e) {
  terrainSource = `builtin (terrain.js did not import: ${String(e && e.message).slice(0, 90)})`;
}

/** Deterministic 32-bit PRNG (same family as core/util.js `mulberry32`). */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a lattice point to [0,1) — stable for a given seed. */
function latticeNoise(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Value noise in [-1,1] at a lattice frequency of 1 unit. */
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smootherstep(x - ix), fz = smootherstep(z - iz);
  const a = latticeNoise(ix, iz, seed), b = latticeNoise(ix + 1, iz, seed);
  const c = latticeNoise(ix, iz + 1, seed), d = latticeNoise(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
  return (ab + (cd - ab) * fz) * 2 - 1;
}

function fall(t) {
  if (!(t < 1)) return 0;
  const c = Math.cos(Math.max(0, t) * Math.PI * 0.5);
  return c * c;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** The canonical procedural height function (see the block comment above). */
function proceduralHeight(spec, x, z) {
  const seed = (spec.seed | 0) || 1337;
  let h = Number.isFinite(spec.base) ? spec.base : 0;
  for (const hill of spec.hills || []) {
    const p = hill.p || [0, 0];
    const r = Math.max(1e-3, hill.r || 1);
    h += (hill.h || 0) * fall(Math.hypot(x - p[0], z - p[1]) / r);
  }
  for (const rg of spec.ridges || []) {
    const a = rg.a || [0, 0], b = rg.b || [0, 0];
    const w = Math.max(1e-3, rg.w || 1);
    h += (rg.h || 0) * fall(distToSegment(x, z, a[0], a[1], b[0], b[1]) / w);
  }
  const n = spec.noise;
  if (n && n.amp) {
    const freq = n.freq || 0.05;
    let amp = n.amp, f = freq, sum = 0, norm = 0;
    for (let o = 0; o < (n.oct || 3); o++) {
      sum += valueNoise(x * f, z * f, seed + o * 7919) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    h += norm > 0 ? sum : 0;
  }
  for (const fl of spec.flats || []) {
    const p = fl.p || [0, 0];
    const r = Math.max(1e-3, fl.r || 1);
    const w = fall(Math.hypot(x - p[0], z - p[1]) / r);
    if (w > 0) h = h + (( Number.isFinite(fl.h) ? fl.h : h) - h) * w;
  }
  return h;
}

/**
 * Build the walkable height field for a terrain def.
 *
 * PREFERRED PATH: runtime/world/terrain.js `sampleHeights(def)` returns a plain
 * `(x, z) => y` sampler (verified against that module), so the gate measures the
 * SAME field the game builds — no second implementation to drift.
 *
 * The sampler clamps outside its footprint, so the footprint test lives here:
 * `heightAt` returns NaN outside `origin .. origin + size`, which is what stops
 * the flood from walking off the edge of the world onto imaginary ground.
 *
 * @returns {null|{heightAt:(x,z)=>number, slopeAt:(x,z)=>number, originX:number,
 *                 originZ:number, sizeX:number, sizeZ:number, res:number,
 *                 minY:number, maxY:number, source:string}}
 */
function buildHeightfield(tdef, notes) {
  if (!tdef) return null;
  const origin = tdef.origin || [0, 0];
  const size = tdef.size || [64, 64];
  const res = Math.max(0.25, tdef.res || 1);
  const originX = +origin[0] || 0, originZ = +origin[1] || 0;
  const sizeX = Math.abs(+size[0]) || 64, sizeZ = Math.abs(+size[1]) || 64;
  const spec = tdef.heights;

  /* --- 1. the raw sampler: terrain.js first, then a baked grid, then ours --- */
  let raw = null, source = 'builtin';

  if (terrainSampler) {
    try {
      const got = terrainSampler(tdef);
      if (typeof got === 'function') { raw = got; source = terrainSource; }
      else if (got && got.heights && got.heights.length) {
        raw = gridSampler(got.heights, got.nx, got.nz, originX, originZ, sizeX, sizeZ);
        source = terrainSource + ' (grid)';
      }
    } catch (e) {
      notes.push(`terrain.js sampleHeights threw (${String(e && e.message).slice(0, 80)}); using the builtin sampler`);
    }
  }

  if (!raw && spec && (Array.isArray(spec) || ArrayBuffer.isView(spec))) {
    const nx = tdef.nx || Math.max(2, Math.round(sizeX / res) + 1);
    const nz = tdef.nz || Math.max(2, Math.round(spec.length / nx));
    raw = gridSampler(spec, nx, nz, originX, originZ, sizeX, sizeZ);
    source = 'baked grid in the def';
  }

  if (!raw && spec && typeof spec === 'object') {
    raw = (x, z) => proceduralHeight(spec, x, z);
    source = 'builtin recipe sampler';
  }

  if (!raw) {
    // 'fn' (a sampler the def names but does not carry) or nothing at all.
    const base = (spec && Number.isFinite(spec.base)) ? spec.base
      : (Number.isFinite(tdef.base) ? tdef.base : 0);
    notes.push(`terrain heights are ${JSON.stringify(spec)} — treated as a flat plane at y=${base}`);
    raw = () => base;
    source = 'flat plane fallback';
  }

  /* --- 2. footprint, slope and the height range ---------------------------- */
  const eps = Math.max(0.35, res * 0.5);
  const heightAt = (x, z) => {
    if (x < originX || z < originZ || x > originX + sizeX || z > originZ + sizeZ) return NaN;
    const h = raw(x, z);
    return Number.isFinite(h) ? h : NaN;
  };
  const slopeAt = (x, z) => {
    const h = heightAt(x, z);
    if (!Number.isFinite(h)) return NaN;
    // one-sided differences at the rim so an edge sample is not reported flat
    const hx1 = raw(Math.min(originX + sizeX, x + eps), z);
    const hx0 = raw(Math.max(originX, x - eps), z);
    const hz1 = raw(x, Math.min(originZ + sizeZ, z + eps));
    const hz0 = raw(x, Math.max(originZ, z - eps));
    const gx = (hx1 - hx0) / (2 * eps), gz = (hz1 - hz0) / (2 * eps);
    return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
  };

  let minY = Infinity, maxY = -Infinity;
  const probe = 24;
  for (let j = 0; j <= probe; j++) {
    for (let i = 0; i <= probe; i++) {
      const h = heightAt(originX + (i / probe) * sizeX, originZ + (j / probe) * sizeZ);
      if (!Number.isFinite(h)) continue;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  if (!Number.isFinite(minY)) { minY = 0; maxY = 0; }

  return { heightAt, slopeAt, originX, originZ, sizeX, sizeZ,
           res: Math.min(sizeX, sizeZ) / 64, minY, maxY, source };
}

/** Bilinear sampler over a baked height grid. */
function gridSampler(heights, nx, nz, originX, originZ, sizeX, sizeZ) {
  nx = Math.max(2, nx | 0); nz = Math.max(2, nz | 0);
  const dx = sizeX / (nx - 1), dz = sizeZ / (nz - 1);
  const at = (i, j) => heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  return (x, z) => {
    const fx = Math.min(nx - 1, Math.max(0, (x - originX) / dx));
    const fz = Math.min(nz - 1, Math.max(0, (z - originZ) / dz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * tz;
  };
}

/* ===========================================================================
 * 3. Course geometry -> landable rectangles
 * ======================================================================== */

const v3 = (a, d = 0) => (Array.isArray(a)
  ? [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0]
  : (a && typeof a === 'object' && Number.isFinite(a.x))
    ? [a.x, a.y, a.z]
    : [d, d, d]);

const v2 = (a, d = 0) => (Array.isArray(a) ? [Number(a[0]) || 0, Number(a[1]) || 0] : [d, d]);

/** Kinds whose top face is a floor the hero can stand on. */
const LANDABLE = new Set([
  'platform', 'beam', 'mover', 'vanish', 'ice', 'conveyor', 'jumppad', 'speedpad',
  'sticky', 'crusher', 'elevator', 'seesaw', 'sinker', 'breakable', 'sandboard',
  'stairs', 'ramp', 'bridge', 'building', 'pedestal', 'rock', 'mill', 'cannon',
]);

/** Kinds that are climbable columns/surfaces (CONTRACT §11 CLIMB). */
const CLIMBABLE = new Set(['pole', 'net', 'tree']);

/** Hazard families for the content floor (object kinds). */
const HAZARD_KINDS = new Set([
  'mover', 'vanish', 'rotor', 'pendulum', 'crusher', 'laser', 'lava', 'risinglava',
  'spikes', 'jumppad', 'speedpad', 'conveyor', 'ice', 'wind', 'chase', 'beam',
  'breakable', 'sinker', 'seesaw', 'cannon', 'rings', 'current', 'quicksand',
  'flame', 'sandboard', 'mill',
]);

/** Everything that is scenery and must never be mistaken for a platform. */
const DECOR_KINDS = new Set(['deco', 'text', 'light', 'fence', 'painting', 'gatedoor', 'rings']);

let RID = 0;
function mkRect(o, i, cx, cy, cz, ex, ez, tag, extra) {
  return Object.assign({
    id: `${i}:${o.kind}${tag || ''}#${RID++}`,
    kind: o.kind, idx: i,
    x0: cx - ex, x1: cx + ex,
    z0: cz - ez, z1: cz + ez,
    cx, cz, y: cy,
    moving: o.kind === 'mover' || o.kind === 'elevator' || o.kind === 'crusher' || o.kind === 'sinker' || o.kind === 'seesaw',
    vanishing: o.kind === 'vanish',
    pad: o.kind === 'jumppad' ? (o.power || o.apex || TUNE.bounceDefaultApex) : 0,
    swim: false, terrain: false,
    stripe: !!o.stripe,
  }, extra || {});
}

/** Half extents of a slab, honouring a yaw rotation by taking the AABB. */
function slabExtents(s, rot) {
  const half = [Math.abs(s[0]) / 2 || 0.5, Math.abs(s[1]) / 2 || 0.25, Math.abs(s[2]) / 2 || 0.5];
  const yaw = rot ? (Array.isArray(rot) ? (rot[1] || 0) : (Number(rot) || 0)) : 0;
  if (!yaw) return { ex: half[0], ez: half[2], hy: half[1], shrink: 0 };
  const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
  return { ex: half[0] * c + half[2] * sn, ez: half[2] * c + half[0] * sn, hy: half[1], shrink: 0.25 };
}

/** Every landable rectangle an object contributes, plus its internal edges. */
function rectsFor(o, i, out, links) {
  const kind = o.kind;
  if (DECOR_KINDS.has(kind)) return;

  if (CLIMBABLE.has(kind)) {
    // A climbable column: standing pad at the base, another at the top. The
    // internal link is a CLIMB (CONTRACT §11: speed 2.6 m/s vertical).
    const p = v3(o.p);
    const r = Math.max(0.5, o.r || (kind === 'net' ? 1.5 : 0.6));
    const h = Math.max(1, o.h || 6);
    if (kind === 'tree' && !o.climbable) return;         // a plain tree is scenery
    const base = mkRect(o, i, p[0], p[1], p[2], r + TUNE.climb.radius, r + TUNE.climb.radius, '@foot', { climbFoot: true });
    const top = mkRect(o, i, p[0], p[1] + h, p[2], r, r, '@top', { climbTop: true });
    out.push(base, top);
    links.push({ from: base.id, to: top.id, how: 'climb', d: 0, dy: h, cost: 3 });
    links.push({ from: top.id, to: base.id, how: 'climb-down', d: 0, dy: -h, cost: 2 });
    return;
  }

  if (kind === 'stairs') {
    const p = v3(o.p);
    const n = Math.max(1, o.n | 0 || 8);
    const rise = o.rise || 0.35, run = o.run || 0.4, w = o.w || 2;
    const yaw = Number.isFinite(o.yaw) ? o.yaw : (Array.isArray(o.rot) ? (o.rot[1] || 0) : 0);
    const hx = -Math.sin(yaw), hz = -Math.cos(yaw);          // headingFromYaw
    const len = n * run;
    const bottom = mkRect(o, i, p[0], p[1], p[2], Math.max(0.5, w / 2), Math.max(0.5, w / 2), '@foot');
    const top = mkRect(o, i, p[0] + hx * len, p[1] + n * rise, p[2] + hz * len,
                       Math.max(0.5, w / 2), Math.max(0.5, w / 2), '@top');
    out.push(bottom, top);
    links.push({ from: bottom.id, to: top.id, how: 'stairs', d: len, dy: n * rise, cost: 1 });
    links.push({ from: top.id, to: bottom.id, how: 'stairs', d: len, dy: -n * rise, cost: 1 });
    return;
  }

  if (kind === 'ramp') {
    // A sloped slab: walkable end-to-end when its pitch is under the slide
    // angle, otherwise it is a slide and only goes DOWN.
    const p = v3(o.p), s = v3(o.s, 2);
    const rot = o.rot || [0, 0, 0];
    const pitch = Math.abs(Array.isArray(rot) ? (rot[0] || rot[2] || 0) : 0);
    const yaw = Array.isArray(rot) ? (rot[1] || 0) : 0;
    const { ex, ez, hy } = slabExtents(s, rot);
    const len = Math.max(Math.abs(s[0]), Math.abs(s[2]));
    const dyEnd = Math.sin(pitch) * len;
    const hx2 = -Math.sin(yaw), hz2 = -Math.cos(yaw);
    const lo = mkRect(o, i, p[0] - hx2 * len * 0.5, p[1] + hy - dyEnd * 0.5, p[2] - hz2 * len * 0.5, ex * 0.55, ez * 0.55, '@lo');
    const hi = mkRect(o, i, p[0] + hx2 * len * 0.5, p[1] + hy + dyEnd * 0.5, p[2] + hz2 * len * 0.5, ex * 0.55, ez * 0.55, '@hi');
    out.push(lo, hi);
    const deg = pitch * 180 / Math.PI;
    links.push({ from: lo.id, to: hi.id, how: deg <= SLIDE_DEG ? 'ramp' : 'ramp-steep', d: len, dy: dyEnd, cost: deg <= SLIDE_DEG ? 1 : 40 });
    links.push({ from: hi.id, to: lo.id, how: 'ramp-down', d: len, dy: -dyEnd, cost: 1 });
    return;
  }

  if (kind === 'bridge') {
    const a = v3(o.a), b = v3(o.b);
    const w = Math.max(0.8, o.w || 2), sag = o.sag || 0;
    const deck = mkRect(o, i,
      (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag * 0.5, (a[2] + b[2]) / 2,
      Math.max(w / 2, Math.abs(b[0] - a[0]) / 2), Math.max(w / 2, Math.abs(b[2] - a[2]) / 2), '@deck');
    const pa = mkRect(o, i, a[0], a[1], a[2], w / 2, w / 2, '@a');
    const pb = mkRect(o, i, b[0], b[1], b[2], w / 2, w / 2, '@b');
    out.push(deck, pa, pb);
    for (const end of [pa, pb]) {
      links.push({ from: end.id, to: deck.id, how: 'bridge', d: 0, dy: deck.y - end.y, cost: 1 });
      links.push({ from: deck.id, to: end.id, how: 'bridge', d: 0, dy: end.y - deck.y, cost: 1 });
    }
    return;
  }

  if (kind === 'building') {
    // A building contributes its interior FLOOR and its ROOF. The doors are the
    // way in; a course that wants the roof reachable must author a way up, and
    // this gate will say so if there is not one.
    const p = v3(o.p), s = v3(o.s, 6);
    const { ex, ez, hy } = slabExtents(s, o.rot);
    const floor = mkRect(o, i, p[0], p[1], p[2], Math.max(0.5, ex - 0.4), Math.max(0.5, ez - 0.4), '@floor');
    const roof = mkRect(o, i, p[0], p[1] + hy * 2, p[2], ex, ez, '@roof');
    out.push(floor, roof);
    for (const d of o.doors || []) {
      const dp = v3(d.p !== undefined ? d.p : d);
      const pad = mkRect(o, i, dp[0], dp[1] || p[1], dp[2], 1.0, 1.0, '@door');
      out.push(pad);
      links.push({ from: pad.id, to: floor.id, how: 'door', d: 0, dy: floor.y - pad.y, cost: 1 });
      links.push({ from: floor.id, to: pad.id, how: 'door', d: 0, dy: pad.y - floor.y, cost: 1 });
    }
    return;
  }

  if (kind === 'cannon') {
    // A cannon is a launcher: standing pad plus a one-way edge to its target.
    const p = v3(o.p);
    const pad = mkRect(o, i, p[0], p[1], p[2], 1.2, 1.2, '@pad');
    out.push(pad);
    if (o.target) {
      const t = v3(o.target);
      links.push({ from: pad.id, to: `@world:${t[0]},${t[1]},${t[2]}`, how: 'cannon',
                   d: Math.hypot(t[0] - p[0], t[2] - p[2]), dy: t[1] - p[1], cost: 2,
                   worldTarget: t });
    }
    return;
  }

  if (kind === 'water') {
    // Swimmable: the surface is a traversable node (CONTRACT §11 WATER).
    const p = v3(o.p), s = v3(o.s, 6);
    const { ex, ez, hy } = slabExtents(s, o.rot);
    out.push(mkRect(o, i, p[0], p[1] + hy, p[2], ex, ez, '@surface', { swim: true }));
    return;
  }

  if (!LANDABLE.has(kind)) return;

  const p = v3(o.p);
  const s = v3(o.s, 1);
  const { ex, ez, hy, shrink } = slabExtents(s, o.rot);
  const put = (cx, cy, cz, tag) => out.push(
    mkRect(o, i, cx, cy + hy, cz, Math.max(0.15, ex - shrink), Math.max(0.15, ez - shrink), tag));

  put(p[0], p[1], p[2], '');

  // A mover is landable at BOTH ends of its travel; the poses are joined by a
  // `ride` edge below because a moving platform carries you.
  if ((kind === 'mover' || kind === 'elevator' || kind === 'sinker') && (o.motion || o.to || o.travel)) {
    const m = o.motion || o;
    if (m.to) { const t = v3(m.to); put(t[0], t[1], t[2], '@to'); }
    if (m.type === 'circle' || m.type === 'orbit') {
      const r = m.radius || 0;
      if ((m.axis || 'y') === 'y') {
        put(p[0] + r, p[1], p[2], '@+r'); put(p[0] - r, p[1], p[2], '@-r');
        put(p[0], p[1], p[2] + r, '@+t'); put(p[0], p[1], p[2] - r, '@-t');
      } else {
        put(p[0], p[1] + r, p[2], '@up'); put(p[0], p[1] - r, p[2], '@dn');
      }
    }
    if (m.type === 'oscillate' && m.axis) {
      const a = v3(m.axis), amp = Number.isFinite(m.amp) ? m.amp : (m.radius || 2);
      put(p[0] + a[0] * amp, p[1] + a[1] * amp, p[2] + a[2] * amp, '@+o');
      put(p[0] - a[0] * amp, p[1] - a[1] * amp, p[2] - a[2] * amp, '@-o');
    }
    if (m.type === 'elevator' || m.type === 'sink' || Number.isFinite(m.travel)) {
      const t = m.to ? v3(m.to) : [p[0], p[1] + (m.travel || 4), p[2]];
      put(t[0], t[1], t[2], '@lift');
    }
  }
}

/* ===========================================================================
 * 4. Coin / sigil / crest expansion
 * ======================================================================== */

/** Expand a course's `coins` array (points, rings, lines, arcs) to positions. */
function expandCoins(list) {
  const out = [];
  for (const c of list || []) {
    if (!c) continue;
    if (c.ring) {
      const r = c.ring, ctr = v3(r.c), n = Math.max(1, r.n | 0 || 8), rad = r.r || 2;
      const y = Number.isFinite(r.y) ? r.y : ctr[1];
      const a0 = Number.isFinite(r.from) ? r.from : 0;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        out.push([ctr[0] + Math.cos(a) * rad, y, ctr[2] + Math.sin(a) * rad]);
      }
    } else if (c.arc) {
      const r = c.arc, ctr = v3(r.c), n = Math.max(1, r.n | 0 || 6), rad = r.r || 2;
      const y = Number.isFinite(r.y) ? r.y : ctr[1];
      const a0 = Number.isFinite(r.from) ? r.from : 0;
      const a1 = Number.isFinite(r.to) ? r.to : Math.PI;
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (n === 1 ? 0 : i / (n - 1));
        out.push([ctr[0] + Math.cos(a) * rad, y, ctr[2] + Math.sin(a) * rad]);
      }
    } else if (c.line) {
      const l = c.line, a = v3(l.a), b = v3(l.b), n = Math.max(2, l.n | 0 || 5);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    } else if (c.grid) {
      const g = c.grid, o = v3(g.p), nx = Math.max(1, g.nx | 0 || 3), nz = Math.max(1, g.nz | 0 || 3);
      const sx = g.dx || 2, sz = g.dz || 2;
      for (let j = 0; j < nz; j++) for (let i2 = 0; i2 < nx; i2++) out.push([o[0] + i2 * sx, o[1], o[2] + j * sz]);
    } else {
      out.push(v3(c.p !== undefined ? c.p : c));
    }
  }
  return out;
}

/* ===========================================================================
 * 5. Geometry helpers
 * ======================================================================== */

/** Horizontal gap between two rectangles (0 when their footprints overlap). */
function rectGap(a, b) {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dz = Math.max(0, Math.max(a.z0 - b.z1, b.z0 - a.z1));
  return Math.hypot(dx, dz);
}

/**
 * Metres of straight approach available ON rect `a` toward rect `b`: the chord
 * of the rectangle through its centre along the take-off direction. This is the
 * number that decides whether a triple (6 m) or a long jump (6 m) may be offered
 * at all — a 2 m ledge cannot host either, no matter how short the gap is.
 */
function runupOn(a, b) {
  if (a.terrain) return OPEN_RUNUP;
  let ux = b.cx - a.cx, uz = b.cz - a.cz;
  const L = Math.hypot(ux, uz);
  if (L < 1e-6) return Math.min(OPEN_RUNUP, Math.min(a.x1 - a.x0, a.z1 - a.z0));
  ux /= L; uz /= L;
  const w = a.x1 - a.x0, d = a.z1 - a.z0;
  const tx = Math.abs(ux) > 1e-6 ? w / Math.abs(ux) : Infinity;
  const tz = Math.abs(uz) > 1e-6 ? d / Math.abs(uz) : Infinity;
  return Math.min(OPEN_RUNUP, Math.min(tx, tz));
}

/** Distance a plain run-off covers before falling `dy` (negative) metres. */
function walkOffDist(dy) {
  if (dy >= 0) return -1;
  return RUN * Math.sqrt((2 * -dy) / TUNE.gravFall) * SAFE_FRACTION;
}

/* ---------------------------------------------------------------------------
 * Wall kicks — the vertical move `bestGap`/`bestRise` deliberately exclude
 * ---------------------------------------------------------------------------
 * CONTRACT §11 / REACH_TABLE.wallkick: airborne + wall contact + jump = +2.0 m
 * per kick inside a shaft no wider than `shaftMax` (3.4 m). A shaft is a real,
 * authored structure (the Keep's tower is one), so a gate that cannot see it
 * reports a shipped, playable route as impossible.
 *
 * The solid boxes of the current course live here rather than being threaded
 * through every call site: `moveEdge` is called from four places and from inside
 * the flood, and a per-course module-scope binding is far less error-prone than
 * five extra parameters. `analyse` sets it before it does anything else.
 * ------------------------------------------------------------------------ */

let CURRENT_BOXES = [];

/** Every solid box in the course (not just its top face), for shaft detection. */
function solidBoxesFor(objs) {
  const out = [];
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (!o || DECOR_KINDS.has(o.kind) || !o.p || !o.s) continue;
    if (!LANDABLE.has(o.kind) && o.kind !== 'wall') continue;
    const p = v3(o.p), s = v3(o.s, 1);
    const { ex, ez, hy } = slabExtents(s, o.rot);
    out.push({ x0: p[0] - ex, x1: p[0] + ex, z0: p[2] - ez, z1: p[2] + ez,
               y0: p[1] - hy, y1: p[1] + hy, idx: i, kind: o.kind });
  }
  return out;
}

const WALLKICK_PER_KICK = 2.0;                 // CONTRACT reach table
const WALLKICK_MAX_KICKS = 5;                  // a 5-kick shaft is already a set piece

/**
 * Can the hero kick their way from `a` up to `b`? True when the two surfaces sit
 * (near enough) above one another and two opposing walls tall enough to span the
 * climb stand within `shaftMax` of the line — the geometry a wall-kick shaft is
 * made of. Returns the move or null.
 */
function wallKickEdge(a, b) {
  const shaftMax = (REACH_TABLE.wallkick && REACH_TABLE.wallkick.shaftMax) || 3.4;
  const dy = b.y - a.y;
  if (dy <= 0) return null;
  const single = apexOfSingle();          // the free height before the first kick
  const kicks = Math.ceil((dy - single) / WALLKICK_PER_KICK);
  if (kicks < 1 || kicks > WALLKICK_MAX_KICKS) return null;
  const d = rectGap(a, b);
  if (d > shaftMax) return null;               // you cannot kick sideways across a hall

  const px = (a.cx + b.cx) * 0.5, pz = (a.cz + b.cz) * 0.5;
  const lo = a.y + 0.5, hi = b.y - 0.2;
  let west = false, east = false, north = false, south = false;
  for (const box of CURRENT_BOXES) {
    if (box.y1 < hi - 0.2 || box.y0 > lo) continue;          // must span the climb
    const spansZ = pz >= box.z0 - shaftMax && pz <= box.z1 + shaftMax;
    const spansX = px >= box.x0 - shaftMax && px <= box.x1 + shaftMax;
    if (spansZ) {
      if (box.x1 <= px && px - box.x1 <= shaftMax && pz >= box.z0 && pz <= box.z1) west = true;
      if (box.x0 >= px && box.x0 - px <= shaftMax && pz >= box.z0 && pz <= box.z1) east = true;
    }
    if (spansX) {
      if (box.z1 <= pz && pz - box.z1 <= shaftMax && px >= box.x0 && px <= box.x1) north = true;
      if (box.z0 >= pz && box.z0 - pz <= shaftMax && px >= box.x0 && px <= box.x1) south = true;
    }
  }
  const shaft = (west && east) || (north && south);
  if (!shaft) return null;
  return { how: 'wallkick', d, dy, cost: MOVE_COST.wallkick + kicks, landing: true,
           kicks, note: kicks + ' kick' + (kicks === 1 ? '' : 's') };
}

/** Apex of a plain single jump — the free height before the first kick. */
function apexOfSingle() {
  return (TUNE.jumpV[0] * TUNE.jumpV[0]) / (2 * TUNE.gravRise);
}

/** Cost of a move, so the search prefers the route a player would take. */
const MOVE_COST = {
  step: 0, walkoff: 1, single: 2, sideflip: 3, backflip: 3, double: 5, triple: 8,
  longjump: 6, pad: 2, ride: 2, climb: 3, stairs: 1, ramp: 1, bridge: 1, door: 1,
  cannon: 2, swim: 3, wallkick: 12, none: 99,
};

/**
 * Is there a legal move from `a` to `b` given the landings the approach affords?
 * Returns the cheapest, or null. `-tight` variants are inside the theoretical
 * max but outside the authoring-safe fraction: legal, warned, expensive.
 */
function moveEdge(a, b, landings) {
  const d = rectGap(a, b);
  const dy = b.y - a.y;

  if (d < 0.001 && Math.abs(dy) <= STEP_UP) return { how: 'step', d, dy, cost: 0, landing: false };
  if (d > MAX_REACH + 1) return null;

  if (a.swim && b.swim) return { how: 'swim', d, dy, cost: MOVE_COST.swim, landing: false };
  if (a.swim) {
    // Out of the water: a surface hop (CONTRACT §11 surfaceJumpV = 9 m/s).
    const rise = (TUNE.swim.surfaceJumpV * TUNE.swim.surfaceJumpV) / (2 * TUNE.gravRise);
    if (dy <= rise - 0.2 && d <= 2.4) return { how: 'swim-out', d, dy, cost: 3, landing: false };
  }
  if (b.swim && dy < 0) return { how: 'splash', d, dy, cost: 1, landing: false };

  // A jump pad's arc is FIXED: the only variable is the speed carried onto it.
  if (a.pad > 0 && dy < a.pad - 0.05) {
    const tUp = Math.sqrt(2 * a.pad / TUNE.gravRise);
    const tDown = Math.sqrt(2 * Math.max(0.01, a.pad - dy) / TUNE.gravFall);
    const reach = RUN * (tUp + tDown) * SAFE_FRACTION;
    if (d <= reach) return { how: 'pad', d, dy, cost: MOVE_COST.pad, landing: true, padApex: a.pad };
  }

  const wo = walkOffDist(dy);
  if (wo > 0 && d <= wo) return { how: 'walkoff', d, dy, cost: MOVE_COST.walkoff, landing: true };

  const runup = runupOn(a, b);
  const best = bestGap(dy, runup, landings);

  // Straight up (or near enough that the gap is not the problem): the vertical
  // envelope, not the horizontal one, decides.
  if (d <= 1.0) {
    const rise = bestRise(runup, landings);
    if (dy <= rise.safe) return { how: rise.move, d, dy, cost: MOVE_COST[rise.move] ?? 4, landing: true, vertical: true };
    if (dy <= rise.apex - 0.1) return { how: rise.move + '-tight', d, dy, cost: 30, landing: true, vertical: true, tight: true };
  }

  if (best.safe >= d && best.move !== 'none') {
    return { how: best.move, d, dy, cost: MOVE_COST[best.move] ?? 4, landing: true, safe: best.safe };
  }
  if (best.max >= d && best.move !== 'none') {
    return { how: best.move + '-tight', d, dy, cost: 30, landing: true, tight: true, safe: best.safe, max: best.max };
  }
  // Last: a wall-kick shaft. Deliberately last so the cheap, ordinary moves win
  // wherever they apply and a shaft is only credited where nothing else reaches.
  return wallKickEdge(a, b);
}

/** The best move the geometry ALLOWS for a gap, for the failure report. */
function describeBest(a, b) {
  const d = rectGap(a, b), dy = b.y - a.y;
  const runup = runupOn(a, b);
  const g = bestGap(dy, runup, 2);
  const r = bestRise(runup, 2);
  return {
    gap: +d.toFixed(2), dy: +dy.toFixed(2), runup: +runup.toFixed(2),
    bestMove: g.move, bestSafe: +(g.safe || 0).toFixed(2), bestMax: +(g.max || 0).toFixed(2),
    bestRise: r.move, riseSafe: +r.safe.toFixed(2),
    shortBy: +Math.max(0, d - (g.safe || 0)).toFixed(2),
    tooHighBy: +Math.max(0, dy - r.safe).toFixed(2),
  };
}

/* ===========================================================================
 * 6. Terrain <-> rectangle edges
 * ======================================================================== */

/** Walkable (slope under the slide angle) terrain samples near a rectangle. */
function terrainSamplesNear(hf, rect, radius) {
  const out = [];
  const step = Math.max(0.75, hf.res);
  const x0 = rect.x0 - radius, x1 = rect.x1 + radius;
  const z0 = rect.z0 - radius, z1 = rect.z1 + radius;
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const h = hf.heightAt(x, z);
      if (!Number.isFinite(h)) continue;
      const s = hf.slopeAt(x, z);
      if (!Number.isFinite(s) || s >= SLIDE_DEG) continue;
      out.push([x, h, z]);
    }
  }
  return out;
}

/** Horizontal distance from a point to a rectangle's boundary (0 when inside). */
function pointRectGap(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * Terrain is ONE node. An edge rect->terrain exists when some walkable sample is
 * within a legal move of the rectangle; terrain->rect when some walkable sample
 * can legally reach the rectangle. Open ground affords the full run-up and two
 * landings, which is what makes a triple onto a high ledge from a meadow legal.
 */
function terrainEdges(hf, rect, terrainNode, landings) {
  const samples = terrainSamplesNear(hf, rect, MAX_REACH);
  if (!samples.length) return { toTerrain: null, fromTerrain: null };
  let toT = null, fromT = null;
  for (const [x, h, z] of samples) {
    const d = pointRectGap(x, z, rect);
    // rect -> terrain
    const probe = { x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5, cx: x, cz: z,
                    y: h, pad: 0, swim: false, terrain: false };
    const e1 = moveEdge(rect, probe, landings);
    if (e1 && (!toT || e1.cost < toT.cost)) toT = { ...e1, to: terrainNode.id, d };
    // terrain -> rect
    const src = { x0: x - OPEN_RUNUP / 2, x1: x + OPEN_RUNUP / 2, z0: z - OPEN_RUNUP / 2, z1: z + OPEN_RUNUP / 2,
                  cx: x, cz: z, y: h, pad: 0, swim: false, terrain: true };
    const e2 = moveEdge(src, rect, 2);
    if (e2 && (!fromT || e2.cost < fromT.cost)) fromT = { ...e2, to: rect.id, d };
  }
  return { toTerrain: toT, fromTerrain: fromT };
}

/* ===========================================================================
 * 7. Per-course analysis
 * ======================================================================== */

function analyse(def, opts) {
  const problems = [], notes = [];
  /* The flood re-relaxes surfaces, so the same finding is seen many times; a
     warning list with 40 copies of one line hides the other 39 findings. */
  const warnSeen = new Set();
  const warnings = [];
  const warn = (msg) => { if (!warnSeen.has(msg)) { warnSeen.add(msg); warnings.push(msg); } };
  const isKeep = !!def.isHub || def.id === 'keep';
  const isTutorial = !!def.tutorial || def.id === 'verdant-1';
  const objs = def.objects || [];

  /* ---- 7a. surfaces ---------------------------------------------------- */
  RID = 0;
  CURRENT_BOXES = solidBoxesFor(objs);
  const rects = [];
  const internal = [];
  for (let i = 0; i < objs.length; i++) {
    try { rectsFor(objs[i], i, rects, internal); }
    catch (e) { warn(`object ${i} (${objs[i] && objs[i].kind}) could not be read: ${e.message}`); }
  }
  for (const w of def.waters || []) rectsFor(Object.assign({ kind: 'water' }, w), -1, rects, internal);

  /* ---- 7b. terrain ------------------------------------------------------ */
  const tdef = def.terrain || objs.find((o) => o && o.kind === 'terrain') || null;
  const hf = tdef ? buildHeightfield(tdef, notes) : null;
  let terrainNode = null;
  if (hf) {
    terrainNode = {
      id: 'terrain', kind: 'terrain', idx: -1, terrain: true, swim: false, pad: 0,
      x0: hf.originX, x1: hf.originX + hf.sizeX, z0: hf.originZ, z1: hf.originZ + hf.sizeZ,
      cx: hf.originX + hf.sizeX / 2, cz: hf.originZ + hf.sizeZ / 2,
      y: (hf.minY + hf.maxY) / 2, hf,
    };
    rects.push(terrainNode);
  }

  if (!rects.length) problems.push('the course has NO landable surfaces');

  /* ---- 7c. adjacency ----------------------------------------------------- */
  const byId = new Map(rects.map((r) => [r.id, r]));
  const adj = new Map(rects.map((r) => [r.id, []]));

  // Internal links first (stairs, ramps, climbs, doors, bridge decks, cannons).
  for (const l of internal) {
    if (!adj.has(l.from)) continue;
    if (l.worldTarget) {
      // Cannon: aim the launch edge at the surface under its target point.
      const t = l.worldTarget;
      const land = surfaceUnder(rects, t, hf, 6);
      if (land) adj.get(l.from).push({ to: land.id, how: 'cannon', d: l.d, dy: l.dy, cost: MOVE_COST.cannon, landing: true });
      else warn(`a cannon aims at ${JSON.stringify(t)}, which is not above any landable surface`);
      continue;
    }
    if (adj.has(l.to)) adj.get(l.from).push({ to: l.to, how: l.how, d: l.d, dy: l.dy, cost: l.cost, landing: false });
  }

  // Mover poses carry you between each other.
  const poses = new Map();
  for (const r of rects) {
    if (!r.moving) continue;
    if (!poses.has(r.idx)) poses.set(r.idx, []);
    poses.get(r.idx).push(r);
  }
  for (const group of poses.values()) {
    for (const a of group) for (const b of group) {
      if (a !== b) adj.get(a.id).push({ to: b.id, how: 'ride', d: 0, dy: b.y - a.y, cost: MOVE_COST.ride, landing: false });
    }
  }

  /**
   * Jump edges are landings-dependent, so they are computed lazily inside the
   * fixed-point flood rather than materialised up front (a 400-surface course
   * would otherwise build 160k edges three times over).
   */
  const jumpTargets = new Map();      // surfaceId -> candidate surfaces within reach
  for (const a of rects) {
    const list = [];
    for (const b of rects) {
      if (a === b) continue;
      if (a.terrain || b.terrain) { list.push(b); continue; }
      if (Math.abs(a.cx - b.cx) > MAX_REACH + 40 || Math.abs(a.cz - b.cz) > MAX_REACH + 40) continue;
      if (rectGap(a, b) > MAX_REACH) continue;
      if (b.y - a.y > MAX_REACH) continue;
      list.push(b);
    }
    jumpTargets.set(a.id, list);
  }

  /* ---- 7d. anchoring targets -------------------------------------------- */
  const targets = [];
  const spawnP = v3(def.spawn && def.spawn.p !== undefined ? def.spawn.p : def.spawn);
  const spawnSurface = surfaceUnder(rects, spawnP, hf, 6);
  if (!spawnSurface) problems.push(`spawn ${JSON.stringify(spawnP)} is not above any landable surface`);

  (def.checkpoints || []).forEach((c, i) => {
    const p = v3(c.p !== undefined ? c.p : c);
    const s = surfaceUnder(rects, p, hf, 6);
    if (!s) problems.push(`checkpoint ${i} (${c.id || i}) at ${JSON.stringify(p)} is not above any landable surface`);
    else targets.push({ name: `cp${i}${c.id ? ':' + c.id : ''}`, kind: 'checkpoint', surface: s, p, rise: p[1] - s.y });
  });

  for (const cr of def.crests || []) {
    if (cr.type !== 'open') continue;                 // the rest spawn from triggers
    const p = v3(cr.p !== undefined ? cr.p : cr.spawnAt);
    const s = surfaceUnder(rects, p, hf, 8);
    if (!s) problems.push(`crest "${cr.id}" at ${JSON.stringify(p)} is not above any landable surface`);
    else targets.push({ name: `crest:${cr.id}`, kind: 'crest', surface: s, p, rise: p[1] - s.y });
  }

  (def.sigils || []).forEach((sg, i) => {
    const p = v3(sg.p !== undefined ? sg.p : sg);
    const s = surfaceUnder(rects, p, hf, 8);
    if (!s) problems.push(`sigil ${i} at ${JSON.stringify(p)} is not above any landable surface`);
    else targets.push({ name: `sigil${i}`, kind: 'sigil', surface: s, p, rise: p[1] - s.y });
  });

  if (isKeep) {
    (def.gates || []).forEach((g, i) => {
      const p = v3(g.p !== undefined ? g.p : g);
      const s = surfaceUnder(rects, p, hf, 8);
      if (!s) problems.push(`gate ${i} (${g.course || g.kind || ''}) at ${JSON.stringify(p)} is not above any landable surface`);
      else targets.push({ name: `gate:${g.course || i}`, kind: 'gate', surface: s, p, rise: p[1] - s.y });
    });
  }

  /* ---- 7e. the flood ----------------------------------------------------- */
  // state per surface: reached, hops (min), landings (MAX seen). Landings only
  // ever increase, so re-relaxing on an increase terminates.
  const state = new Map();
  const legPath = new Map();          // surfaceId -> {from, how, d, dy}
  if (spawnSurface) {
    state.set(spawnSurface.id, { hops: 0, landings: 0 });
    let changed = true, passes = 0;
    while (changed && passes++ < 12) {
      changed = false;
      const frontier = Array.from(state.keys());
      for (const aid of frontier) {
        const a = byId.get(aid);
        const st = state.get(aid);
        if (!a || !st) continue;

        const consider = (b, e) => {
          if (!b || !e) return;
          const landing = e.landing === false ? 0 : 1;
          const nHops = st.hops + 1;
          const nLand = Math.min(2, landing ? st.landings + 1 : st.landings);
          const prev = state.get(b.id);
          if (!prev) {
            state.set(b.id, { hops: nHops, landings: nLand });
            legPath.set(b.id, { from: aid, ...e });
            changed = true;
          } else if (nLand > prev.landings || nHops < prev.hops) {
            prev.landings = Math.max(prev.landings, nLand);
            prev.hops = Math.min(prev.hops, nHops);
            changed = true;
          }
        };

        for (const e of adj.get(aid) || []) consider(byId.get(e.to), e);

        for (const b of jumpTargets.get(aid) || []) {
          if (a.terrain && b.terrain) continue;
          if (b.terrain && hf) {
            const te = terrainEdges(hf, a, b, st.landings);
            if (te.toTerrain) consider(b, te.toTerrain);
            continue;
          }
          if (a.terrain && hf) {
            const te = terrainEdges(hf, b, a, 2);
            if (te.fromTerrain) consider(b, te.fromTerrain);
            continue;
          }
          const e = moveEdge(a, b, st.landings);
          if (e) consider(b, e);
        }
      }
    }
  }

  /* ---- 7f. verdict per target -------------------------------------------- */
  /**
   * Walk the discovered route back to spawn and report any move on it that is
   * inside the theoretical max but outside the authoring-safe fraction. Only
   * moves on a route the gate actually uses are worth a warning: warning about
   * every tight edge in the whole graph buries the ones a player must make.
   */
  const routeWarn = (surfaceId, label) => {
    const seen = new Set();
    let cur = surfaceId, guard = 0;
    while (cur && legPath.has(cur) && guard++ < 200 && !seen.has(cur)) {
      seen.add(cur);
      const e = legPath.get(cur);
      if (e && e.tight) {
        warn(`${label}: a ${e.how} of ${(e.d || 0).toFixed(2)} m (dy ${(e.dy || 0).toFixed(2)}) from ${e.from} is inside the theoretical max but OUTSIDE the safe envelope`);
      }
      cur = e && e.from;
    }
  };

  const unreachable = [];
  for (const t of targets) {
    if (state.has(t.surface.id)) routeWarn(t.surface.id, `route to ${t.name}`);
  }
  for (const t of targets) {
    const st = state.get(t.surface.id);
    if (!st) {
      unreachable.push({ ...t, why: 'the surface under it is not reachable from spawn',
                         best: nearestReachedDescription(rects, state, t.surface) });
      continue;
    }
    if (t.kind === 'sigil' || t.kind === 'crest') {
      const runup = t.surface.terrain ? OPEN_RUNUP : Math.min(OPEN_RUNUP, Math.min(t.surface.x1 - t.surface.x0, t.surface.z1 - t.surface.z0));
      const rise = bestRise(runup, st.landings);
      const wall = TUNE.wallKick.vy * TUNE.wallKick.vy / (2 * TUNE.gravRise);
      const headroom = TUNE.height * 0.65;   // the hero's own body reaches this high
      if (t.rise > rise.apex + headroom) {
        unreachable.push({ ...t, why: `it hangs ${t.rise.toFixed(2)} m above its surface; the best move there (${rise.move}) apexes at ${rise.apex.toFixed(2)} m` +
                                       (t.rise <= wall + headroom ? ' (a wall kick would reach it — author a wall, or lower it)' : ''),
                           best: { rise: +t.rise.toFixed(2), bestMove: rise.move, apex: +rise.apex.toFixed(2) } });
      }
    }
  }

  /* ---- 7g. content floor -------------------------------------------------- */
  const coins = expandCoins(def.coins);
  const sigils = (def.sigils || []).length;
  const crests = (def.crests || []).length;
  const cps = (def.checkpoints || []).length;
  const critterKinds = new Set((def.critters || []).map((c) => c && c.kind).filter(Boolean));
  const hazardKinds = new Set();
  for (const o of objs) if (o && HAZARD_KINDS.has(o.kind)) hazardKinds.add(o.kind);
  const families = hazardKinds.size + critterKinds.size;

  const bounds = def.bounds;
  if (!bounds || !bounds.min || !bounds.max) {
    problems.push('no `bounds` — the culler and the minimap have nothing authoritative to read');
  } else {
    const mn = v3(bounds.min), mx = v3(bounds.max);
    for (let k = 0; k < 3; k++) {
      if (!(mx[k] > mn[k])) problems.push(`bounds are degenerate on axis ${'xyz'[k]} (${mn[k]} .. ${mx[k]})`);
    }
    const inside = spawnP[0] >= mn[0] && spawnP[0] <= mx[0]
                && spawnP[1] >= mn[1] && spawnP[1] <= mx[1]
                && spawnP[2] >= mn[2] && spawnP[2] <= mx[2];
    if (!inside) problems.push(`spawn ${JSON.stringify(spawnP)} is OUTSIDE bounds ${JSON.stringify([mn, mx])}`);
  }

  if (!isKeep) {
    if (cps < 3) problems.push(`only ${cps} checkpoints — a course needs >= 3`);
    if (coins.length < 100) problems.push(`only ${coins.length} coins after expansion — a course needs >= 100`);
    if (sigils !== 8) problems.push(`${sigils} sigils — a course has exactly 8`);
    if (crests !== 7) problems.push(`${crests} crests — a course has exactly 7`);
    if (!isTutorial && families < 6) {
      problems.push(`only ${families} hazard/critter families (${[...hazardKinds, ...critterKinds].join(', ') || 'none'}) — non-tutorial courses need >= 6`);
    }
    const need = new Set(['open', 'sigils', 'coins']);
    for (const cr of def.crests || []) need.delete(cr.type);
    if (need.size) warn(`no crest of type: ${[...need].join(', ')} — the sigil/coin rewards have nowhere to land`);
    if (Number.isFinite(def.killY) === false) warn('no `killY` — a fall out of the world never resolves');
  }

  // Coins that no reachable surface sits under are usually a typo.
  let strandedCoins = 0;
  for (const c of coins) {
    const s = surfaceUnder(rects, c, hf, 5);
    if (!s || !state.has(s.id)) strandedCoins++;
  }
  if (strandedCoins > Math.max(4, coins.length * 0.05)) {
    warn(`${strandedCoins} of ${coins.length} coins are not above a reachable surface`);
  }

  const orphans = rects.filter((r) => !state.has(r.id) && !r.swim);

  return {
    id: def.id, name: def.name, realm: def.realm, difficulty: def.difficulty,
    isKeep, isTutorial,
    surfaces: rects.length, objects: objs.length,
    checkpoints: cps, coins: coins.length, sigils, crests,
    families, hazardKinds: [...hazardKinds], critterKinds: [...critterKinds],
    terrain: hf ? { source: hf.source, size: [hf.sizeX, hf.sizeZ], y: [+hf.minY.toFixed(2), +hf.maxY.toFixed(2)] } : null,
    targets: targets.length,
    reachedSurfaces: state.size,
    orphanSurfaces: orphans.length,
    orphanSample: orphans.slice(0, 8).map((o) => o.id),
    strandedCoins,
    unreachable, problems, warnings, notes,
    pass: problems.length === 0 && unreachable.length === 0,
  };
}

/** The landable surface directly under a world point, or null. */
function surfaceUnder(rects, p, hf, maxDrop) {
  let best = null, bestDy = Infinity;
  for (const r of rects) {
    if (r.terrain) continue;
    if (p[0] < r.x0 - 0.6 || p[0] > r.x1 + 0.6 || p[2] < r.z0 - 0.6 || p[2] > r.z1 + 0.6) continue;
    const dy = p[1] - r.y;
    if (dy < -0.8 || dy > maxDrop) continue;
    if (dy < bestDy) { bestDy = dy; best = r; }
  }
  if (best) return best;
  if (hf) {
    const h = hf.heightAt(p[0], p[2]);
    if (Number.isFinite(h) && p[1] - h >= -0.8 && p[1] - h <= maxDrop) {
      return rects.find((r) => r.terrain) || null;
    }
  }
  return null;
}

/** For a failure report: the closest REACHED surface and what move it would need. */
function nearestReachedDescription(rects, state, target) {
  let best = null, bd = Infinity;
  for (const r of rects) {
    if (!state.has(r.id) || r === target) continue;
    const d = rectGap(r, target) + Math.abs(r.y - target.y) * 0.5;
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return { from: null, note: 'nothing at all is reachable from spawn' };
  return { from: best.id, ...describeBest(best, target) };
}

/* ===========================================================================
 * 8. Run
 * ======================================================================== */

const argv = process.argv.slice(2);
let jsonOut = null;
const jsonIdx = argv.indexOf('--json');
if (jsonIdx >= 0) { jsonOut = argv[jsonIdx + 1]; argv.splice(jsonIdx, 2); }
const wantBanner = argv.includes('--banner');
if (wantBanner) argv.splice(argv.indexOf('--banner'), 1);

if (wantBanner && typeof reachBanner === 'function') {
  console.log(reachBanner());
  console.log('');
}

/* Which ids to check: the registry is authoritative (data/index.js), and a
   registered course with no file is a FAILURE, not a silent skip. */
let registryIds = null;
try {
  const idx = await import(pathToFileURL(join(DATA_DIR, 'index.js')).href);
  registryIds = [idx.KEEP_ID || 'keep', ...(idx.ALL_COURSE_IDS || [])];
} catch (e) {
  console.error(`reachcheck: could not import runtime/data/index.js (${e && e.message}); falling back to the directory listing`);
}

let ids;
if (argv.length) {
  ids = argv.slice();
} else if (registryIds) {
  ids = registryIds;
} else {
  const files = existsSync(COURSE_DIR) ? readdirSync(COURSE_DIR).filter((f) => f.endsWith('.js')) : [];
  ids = [...(existsSync(join(DATA_DIR, 'keep.js')) ? ['keep'] : []), ...files.map((f) => f.replace(/\.js$/, ''))].sort();
}
if (!ids.length) {
  console.error('reachcheck: no course ids to check');
  process.exit(2);
}

const reports = [];
for (const id of ids) {
  const file = id === 'keep' ? join(DATA_DIR, 'keep.js') : join(COURSE_DIR, `${id}.js`);
  if (!existsSync(file)) {
    reports.push({ id, pass: false, missing: true, problems: [`no data file at runtime/data/${id === 'keep' ? 'keep.js' : 'courses/' + id + '.js'}`], warnings: [], unreachable: [] });
    continue;
  }
  let def;
  try {
    const mod = await import(pathToFileURL(file).href);
    def = mod.default;
    if (!def || typeof def !== 'object') throw new Error('no default export object');
    if (!def.id) def.id = id;
  } catch (e) {
    reports.push({ id, pass: false, problems: [`import failed: ${e && e.message}`], warnings: [], unreachable: [] });
    continue;
  }
  try {
    reports.push(analyse(def, {}));
  } catch (e) {
    reports.push({ id, pass: false, problems: [`analysis crashed: ${(e && e.stack) || e}`], warnings: [], unreachable: [] });
  }
}

/* ---- report ------------------------------------------------------------- */
const flat = REACH_TABLE.single.rows.find((r) => r.dy === 0) || REACH_TABLE.single.rows[0];
console.log('');
console.log('CRESTBOUND reach check');
console.log(`  envelope: single ${flat.safe} m safe / ${flat.max} m max, triple ${REACH_TABLE.triple.rows[0].safe} m safe, long jump ${REACH_TABLE.longjump.rows[0].safe} m safe`);
console.log(`  terrain sampler: ${terrainSource}`);
console.log('');
console.log('course        surf  obj   cp  coins  sig  cre  fam  unreach  orph  status');
console.log('-'.repeat(80));

let failing = 0;
for (const r of reports) {
  if (!r.pass) failing++;
  const n = (v) => (v === undefined || v === null ? '-' : String(v));
  console.log(
    `${String(r.id).padEnd(13)} ${n(r.surfaces).padStart(4)} ${n(r.objects).padStart(4)} ` +
    `${n(r.checkpoints).padStart(4)} ${n(r.coins).padStart(6)} ${n(r.sigils).padStart(4)} ` +
    `${n(r.crests).padStart(4)} ${n(r.families).padStart(4)} ${n(r.unreachable && r.unreachable.length).padStart(8)} ` +
    `${n(r.orphanSurfaces).padStart(5)}  ${r.pass ? 'PASS' : 'FAIL'}`);
}
console.log('-'.repeat(80));

for (const r of reports) {
  if (r.pass && !(r.warnings || []).length && !(r.notes || []).length) continue;
  console.log(`\n${r.id}${r.name ? ' — ' + r.name : ''}`);
  for (const p of r.problems || []) console.log(`   X  ${p}`);
  for (const u of r.unreachable || []) {
    const b = u.best || {};
    let detail;
    if (b.from && b.bestMove) {
      detail = `nearest reached surface ${b.from}: gap ${b.gap} m, dy ${b.dy} m, run-up ${b.runup} m` +
        ` -> best legal move "${b.bestMove}" reaches ${b.bestSafe} m safe (${b.bestMax} m max)` +
        (b.shortBy > 0 ? `, SHORT BY ${b.shortBy} m` : '') +
        (b.tooHighBy > 0 ? `, TOO HIGH BY ${b.tooHighBy} m (best rise "${b.bestRise}" = ${b.riseSafe} m)` : '');
    } else if (b.apex !== undefined) {
      detail = `hangs ${b.rise} m above its surface; best move "${b.bestMove}" apexes at ${b.apex} m`;
    } else {
      detail = b.note || 'no reachable surface anywhere near it';
    }
    console.log(`   X  UNREACHABLE ${u.name} at ${JSON.stringify(u.p)} — ${u.why}`);
    console.log(`        ${detail}`);
  }
  for (const w of (r.warnings || []).slice(0, 14)) console.log(`   ~  ${w}`);
  if ((r.warnings || []).length > 14) console.log(`   ~  ... and ${r.warnings.length - 14} more warnings`);
  for (const nte of r.notes || []) console.log(`   i  ${nte}`);
  if (r.orphanSample && r.orphanSample.length) {
    console.log(`   i  orphan surfaces (nothing reaches them): ${r.orphanSample.join(', ')}`);
  }
}

console.log('');
console.log('-'.repeat(80));
console.log(`${reports.length} courses, ${failing} failing`);
if (jsonOut) {
  try { writeFileSync(jsonOut, JSON.stringify(reports, null, 2)); console.log(`json -> ${jsonOut}`); }
  catch (e) { console.error(`could not write ${jsonOut}: ${e.message}`); }
} else {
  try { writeFileSync(join(HERE, 'reachcheck.json'), JSON.stringify(reports, null, 2)); } catch { /* optional */ }
}
console.log(`RESULT: ${failing ? 'FAIL' : 'OK'}`);
process.exit(failing ? 1 : 0);
