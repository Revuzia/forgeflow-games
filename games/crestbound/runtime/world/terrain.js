/**
 * CRESTBOUND — runtime/world/terrain.js
 * ---------------------------------------------------------------------------
 * The ground itself. CONTRACT §18.
 *
 * CRESTBOUND courses are OPEN dioramas, not corridors of floating boxes, so the
 * floor has to be a real signed surface the player can run over, slide down and
 * read at a glance. This module turns a compact authored description —
 *
 *     {seed, base, hills:[{p,r,h}], flats:[{p,r,h}], ridges:[{a,b,w,h}],
 *      noise:{amp, freq}}
 *
 * — into three things that MUST agree with each other or the game lies to the
 * player:
 *
 *   1. a rendered BufferGeometry (indexed, metric UVs, analytic smooth normals,
 *      vertex colours carrying the slope blend and the carved paths),
 *   2. a `Heightfield` collider (collider.js) sampling the SAME array,
 *   3. `sampleHeights(def)` — a pure-Math closure over the SAME sampler, so the
 *      Node validators (`_harness/reachcheck.mjs`) and the data author can ask
 *      "how high is the ground at (x, z)?" and get the number the physics will
 *      actually produce.
 *
 * (3) is why the sampler lives at the top of this file and touches nothing but
 * `Math`: it must be callable from a validator that never builds a scene.
 *
 * GRASS. Instanced crossed blade cards, count driven by `quality.grass`
 * (30 000 at ultra/high, 8 000 at low), placed only where the slope is under
 * 30° and never inside a carved path, tinted per instance from a second noise
 * band plus a height gradient, and swayed in the vertex stage from one shared
 * `uTime` uniform. One InstancedMesh, one draw call, zero per-frame allocation.
 *
 * PERF. The mesh is INDEXED (a 160 × 160 m field at 1 m resolution is 51 k
 * triangles indexed, 154 k unindexed) and is the ONE place in the runtime that
 * is allowed to be indexed — it is never fed to `mergeStatic`.
 *
 * @module runtime/world/terrain
 */

import * as THREE from 'three';
import { Heightfield } from './collider.js';
import { getMaterial } from './builders.js';

/* ===========================================================================
 * 1. THE SAMPLER — pure Math, Node-safe, shared by the mesh, the collider and
 *    the reach validator. Nothing below this banner may touch THREE.
 * ======================================================================== */

/** Integer hash in [0, 1). Deterministic across engines (Math.imul only). */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Quintic smoothstep — C² continuous, so fbm terrain has no normal creases. */
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** 2D value noise in [-1, 1]. */
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = ihash(ix, iz, seed), b = ihash(ix + 1, iz, seed);
  const c = ihash(ix, iz + 1, seed), d = ihash(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return (ab + (cd - ab) * fz) * 2 - 1;
}

/** Fractal value noise in roughly [-1, 1]. */
function fbm(x, z, seed, octaves, gain, lacunarity) {
  const O = octaves || 4;
  const G = gain === undefined ? 0.5 : gain;
  const L = lacunarity === undefined ? 2.03 : lacunarity;
  let v = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < O; i++) {
    v += vnoise(x * f, z * f, seed + i * 131) * a;
    norm += a;
    a *= G; f *= L;
  }
  return norm > 0 ? v / norm : 0;
}

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim, C¹ at both. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Distance from (px,pz) to segment a→b in the XZ plane. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

/** Distance from (px,pz) to a polyline of [x,z] points. */
function polyDist(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  if (pts.length === 1) {
    const dx = pts[0][0] - px, dz = pts[0][1] - pz;
    best = Math.sqrt(dx * dx + dz * dz);
  }
  return best;
}

/**
 * Build the height sampler for a terrain def.
 *
 * Evaluation order — and it MATTERS, because it is what lets an author drop a
 * fort onto a hillside and know the courtyard will be level:
 *
 *   base  →  + hills  →  + ridges  →  + fbm noise  →  flats BLEND OVER the lot
 *
 * `flats` are plateaus: inside one, the surface is dragged toward its `h` by
 * the falloff weight, so the middle is dead level and the rim melts into the
 * landscape. `paths` do NOT change height (a road that dented the ground would
 * break every authored jump) — they only carve the surface look.
 *
 * @param {object} def a TerrainDef, or its `heights` spec directly. A function
 *        is returned as-is; a Float32Array is bilinearly sampled against the
 *        def's origin/size/res.
 * @returns {(x:number, z:number) => number}
 */
export function sampleHeights(def) {
  const d = def || {};
  const spec = (d.heights !== undefined && d.heights !== null) ? d.heights : d;

  // (a) an author-supplied function is authoritative
  if (typeof spec === 'function') return spec;

  // (b) a baked Float32Array: bilinear sample against the def footprint
  if (spec && typeof spec.length === 'number' && typeof spec !== 'string') {
    const origin = d.origin || [0, 0];
    const size = d.size || [64, 64];
    const res = d.res || 1;
    const nx = Math.max(2, Math.round(size[0] / res) + 1);
    const nz = Math.max(2, Math.round(size[1] / res) + 1);
    const cellX = size[0] / (nx - 1), cellZ = size[1] / (nz - 1);
    const arr = spec;
    return function (x, z) {
      let u = (x - origin[0]) / cellX;
      let v = (z - origin[1]) / cellZ;
      if (u < 0) u = 0; else if (u > nx - 1) u = nx - 1;
      if (v < 0) v = 0; else if (v > nz - 1) v = nz - 1;
      const i0 = Math.floor(u), j0 = Math.floor(v);
      const i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(nz - 1, j0 + 1);
      const fu = u - i0, fv = v - j0;
      const h00 = arr[j0 * nx + i0], h10 = arr[j0 * nx + i1];
      const h01 = arr[j1 * nx + i0], h11 = arr[j1 * nx + i1];
      const a = h00 + (h10 - h00) * fu;
      const b = h01 + (h11 - h01) * fu;
      return a + (b - a) * fv;
    };
  }

  // (c) the authored recipe
  const s = spec || {};
  const seed = (s.seed | 0) || 1337;
  const base = s.base === undefined ? 0 : s.base;
  const hills = s.hills || [];
  const flats = s.flats || [];
  const ridges = s.ridges || [];
  const noise = s.noise || null;
  const nAmp = noise ? (noise.amp === undefined ? 0 : noise.amp) : 0;
  const nFreq = noise ? (noise.freq === undefined ? 0.05 : noise.freq) : 0;
  const nOct = noise && noise.octaves ? noise.octaves : 4;

  return function (x, z) {
    let y = base;

    for (let i = 0; i < hills.length; i++) {
      const H = hills[i];
      const r = H.r || 1;
      const dx = x - H.p[0], dz = z - H.p[1];
      const dd = Math.sqrt(dx * dx + dz * dz);
      if (dd < r) {
        const k = bump(dd / r);
        // squared falloff reads as a dome rather than a cone
        y += (H.h || 0) * (H.sharp ? k : k * k * (3 - 2 * k));
      }
    }

    for (let i = 0; i < ridges.length; i++) {
      const R = ridges[i];
      const w = (R.w || 1) * 0.5;
      const dd = segDist(x, z, R.a[0], R.a[1], R.b[0], R.b[1]);
      if (dd < w) y += (R.h || 0) * bump(dd / w);
    }

    if (nAmp !== 0) y += fbm(x * nFreq, z * nFreq, seed, nOct) * nAmp;

    for (let i = 0; i < flats.length; i++) {
      const F = flats[i];
      const r = F.r || 1;
      const dx = x - F.p[0], dz = z - F.p[1];
      const dd = Math.sqrt(dx * dx + dz * dz);
      if (dd < r) {
        // inner 55 % is dead level, then a smooth skirt out to the rim
        const t = dd / r;
        const k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45);
        y += ((F.h === undefined ? y : F.h) - y) * k;
      }
    }
    return y;
  };
}

/**
 * How much of the surface at (x, z) is "path". 0 = untouched ground, 1 = the
 * middle of a carved track. Exposed because course.js excludes props and
 * critter spawns from the same corridor.
 *
 * @param {object} def TerrainDef
 * @returns {(x:number, z:number) => number}
 */
export function samplePaths(def) {
  const paths = (def && def.paths) || [];
  if (!paths.length) return function () { return 0; };
  return function (x, z) {
    let k = 0;
    for (let i = 0; i < paths.length; i++) {
      const P = paths[i];
      const w = (P.w || 2) * 0.5;
      const d = polyDist(x, z, P.pts || []);
      if (d < w) {
        const kk = 1 - fade(Math.min(1, d / w));
        if (kk > k) k = kk;
      }
    }
    return k;
  };
}

/* ===========================================================================
 * 2. Rendering — from here down, THREE is fair game.
 * ======================================================================== */

/** CONTRACT §18 blade budget at quality 1.0 ("30k at high, 8k at low"). */
const BLADE_BUDGET_MAX = 30000;

/** ONE shared clock for every grass field in the scene. */
const GRASS_TIME = { value: 0 };

/** Scratch — module scope; nothing in an update path allocates. */
const _v0 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _s0 = new THREE.Vector3(1, 1, 1);
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _col = new THREE.Color();
const _colB = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _norm = new THREE.Vector3();

/** mulberry32 — matched to core/util.js so seeds are interchangeable. */
function mulberry32(seed) {
  let a = (seed | 0) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blade-card geometry: two tapered quads crossed at 90°. 4 triangles. */
function bladeGeometry(w, h, cross) {
  const P = [], N = [], U = [], C = [];
  const half = w * 0.5, tip = w * 0.16;
  /* ROOT-TO-TIP GRADIENT as a geometry colour attribute.
   *
   * three MULTIPLIES the geometry `color` attribute by `instanceColor`, so this
   * costs nothing and needs no shader: the per-instance colour still carries
   * species/height/patch variation, and this darkens every blade toward its
   * root the way a real sward self-shadows. It also replaces the leaves TEXTURE
   * the blade material used to sample — see bladeMaterial. */
  const card = (yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const X = (v) => [c * v, 0, s * v];
    const b0 = X(-half), b1 = X(half), t0 = X(-tip), t1 = X(tip);
    const nx = -s, nz = c;
    const push = (p, y, u, v) => {
      P.push(p[0], y, p[2]); N.push(nx, 0.45, nz); U.push(u, v);
      const k = 0.46 + 0.54 * v;              // v = 0 at the root, 1 at the tip
      C.push(k, k * 1.03, k * 0.92);          // roots read cooler, tips warmer
    };
    push(b0, 0, 0, 0); push(b1, 0, 1, 0); push(t1, h, 1, 1);
    push(b0, 0, 0, 0); push(t1, h, 1, 1); push(t0, h, 0, 1);
  };
  card(0);
  if (cross) card(Math.PI * 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  g.computeBoundingSphere();
  return g;
}

const _grassMats = new Map();

/**
 * The blade material. Derived from the theme's `leaves` bake (so grass shares
 * the world's foliage colour response) but rebuilt rather than cloned, because
 * we install our OWN vertex program and must not stamp on the material bank's.
 *
 * Sway is a two-band sine driven by the instance's world offset, scaled by
 * `pow(uv.y, 1.6)` so the root never moves and the tip whips.
 */
function bladeMaterial(theme, mats, key, field) {
  const id = (theme && theme.id) || 'default';
  const ck = 'blade|' + id + '|' + key + '|' + field.uid;
  let m = _grassMats.get(ck);
  if (m) return m;
  /* NO MAP. This material sampled the theme's `leaves` ALBEDO across a 0..1 uv
   * per blade — i.e. every 8 cm blade card showed the whole leaf-cluster atlas,
   * including its near-black background. It copied `alphaTest: 0.45` from the
   * leaves bake but NOT the alphaMap that bake puts its cutout in, so nothing
   * was ever discarded and the field rendered as solid black spikes
   * (`_shots/_v36_verdant.png`, the first frame in which these blades have ever
   * been drawn at all — see the budget note in buildGrass). A 40 cm blade seen
   * from 3 m needs a gradient and a normal, not a texture: colour now comes
   * from the geometry gradient x the per-instance colour, which is cheaper and
   * cannot fail this way. */
  m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  /* ------------------------------------------------------------------------
   * ROUND 2 — THE CAMERA-LOCAL RING.
   *
   * Round 1 fixed the budget bug (QUALITY.grass was read as an absolute count,
   * so buildGrass returned null at every tier and the contract's instanced
   * grass had never rendered). What that exposed is a DENSITY problem the
   * budget cannot solve: 30 000 blades spread over a 140x140 m meadow is one
   * blade per square metre, and `_shots/_v38_verdant.png` shows exactly that —
   * pale triangles scattered like confetti over painted ground, which is worse
   * than no grass at all.
   *
   * Turf needs ~20 blades/m2 where the camera is and none where it is not.
   * So the instances no longer live at fixed world positions: they are a
   * jittered lattice over a 2R x 2R tile that WRAPS around the camera in the
   * vertex shader (`world = anchor + round((cam-anchor)/2R) * 2R`). The same
   * 30 000 instances then cover 36x36 m at ~23 blades/m2 instead of 19 600 m2
   * at 1. Cost: identical draw calls, identical triangles, one extra vertex
   * texture fetch. Nothing allocates per frame — `cameraPosition` is a three
   * built-in uniform, so there is not even a uniform to push.
   *
   * The ground under a wrapped blade is not known at build time, so the field
   * ships as an RG16F texture: R = terrain height in metres, G = "lushness"
   * (slope gate x path gate x authored exclusions x patch noise). G both culls
   * (a blade on a path or a cliff collapses to a point, which the rasteriser
   * throws away) and tints, so the field reads as a real sward with bare
   * tracks rather than a uniform carpet.
   * --------------------------------------------------------------------- */
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = GRASS_TIME;
    sh.uniforms.uGrassField = { value: field.tex };
    sh.uniforms.uFieldRect = { value: field.rect };   // originX, originZ, 1/sizeX, 1/sizeZ
    sh.uniforms.uRing = { value: field.ring };        // half-size R, fade-start radius
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform float uTime;',
        'uniform sampler2D uGrassField;',
        'uniform vec4 uFieldRect;',
        'uniform vec2 uRing;',
      ].join('\n'))
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  vec3 gAnchor = (modelMatrix * (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0))).xyz;',
        '#else',
        '  vec3 gAnchor = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
        '#endif',
        'vec2 gPeriod = vec2(uRing.x * 2.0);',
        'vec2 gW2 = gAnchor.xz + floor((cameraPosition.xz - gAnchor.xz) / gPeriod + 0.5) * gPeriod;',
        'vec2 gUv = (gW2 - uFieldRect.xy) * uFieldRect.zw;',
        'vec2 gIn = step(vec2(0.0), gUv) * step(gUv, vec2(1.0));',
        'vec2 gFld = texture2D(uGrassField, clamp(gUv, 0.0, 1.0)).rg;',
        'float gLush = gFld.g * gIn.x * gIn.y;',
        'float gDist = length(gW2 - cameraPosition.xz);',
        'float gFade = 1.0 - smoothstep(uRing.y, uRing.x, gDist);',
        'float gScale = smoothstep(0.14, 0.50, gLush) * gFade;',
        'transformed *= gScale;',
        '#ifdef USE_COLOR',
        '  vColor.rgb *= mix(vec3(0.58, 0.56, 0.38), vec3(0.84, 0.88, 0.72), clamp(gLush, 0.0, 1.0));',
        '#endif',
        'float gPh = dot(vec3(gW2.x, 0.0, gW2.y), vec3(0.317, 0.113, 0.271));',
        'float gWt = pow(clamp(uv.y, 0.0, 1.0), 1.6) * gScale;',
        'float gA = sin(uTime * 1.9 + gPh) * 0.5 + sin(uTime * 3.7 + gPh * 1.7) * 0.22;',
        'transformed.x += gA * 0.16 * gWt;',
        'transformed.z += cos(uTime * 1.55 + gPh * 1.3) * 0.11 * gWt;',
        'transformed.y -= abs(gA) * 0.035 * gWt;',
        'vec3 gDelta = vec3(gW2.x - gAnchor.x, gFld.r - gAnchor.y, gW2.y - gAnchor.z);',
      ].join('\n'))
      /* The wrap has to be applied AFTER the instance matrix (it is a world
       * displacement, not an object-space one), so project_vertex is rebuilt
       * rather than patched. worldpos_vertex is rebuilt from the same vec4 so
       * shadow lookups and env sampling agree with where the blade actually is. */
      .replace('#include <project_vertex>', [
        'vec4 mvPosition = vec4(transformed, 1.0);',
        '#ifdef USE_INSTANCING',
        '  mvPosition = instanceMatrix * mvPosition;',
        '#endif',
        'vec4 gWorld = modelMatrix * mvPosition;',
        'gWorld.xyz += gDelta;',
        'mvPosition = viewMatrix * gWorld;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'))
      .replace('#include <worldpos_vertex>', [
        '#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0',
        '  vec4 worldPosition = gWorld;',
        '#endif',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'crestbound-grassblade-ring';
  m.name = 'grass_blade';
  _grassMats.set(ck, m);
  return m;
}

/** Default per-surface look when the def does not override it. */
/**
 * These are VERTEX COLOURS, and a vertex colour MULTIPLIES the surface albedo —
 * it is not the ground's colour, it is a modulation of it.
 *
 * ROUND 1 VISUAL FIX (owner-observed "the meadow is a flat dark green"; see
 * `_shots/_v33_verdant.png` and the measured table — every verdant station came
 * back COOL, R-B between -0.032 and -0.061, against a contract that asks for
 * early morning). `grass.low` was 0x4a7a35 — RGB (0.29, 0.48, 0.21). Multiplied
 * onto an already mid-value grass albedo it removed two thirds of the meadow's
 * light before the light rig ever ran, and no amount of theme tinting or key
 * intensity could put it back: the ground was being darkened at the vertex.
 * The ramps now sit near 1.0 so they MODULATE (the albedo bake carries the
 * colour, which is where the contract puts it), and each keeps its relative
 * relationship — top brighter than low, dirt browner, path drier.
 */
const SURFACE_LOOK = {
  grass: { top: 0xc8e394, low: 0x9cc06c, dirt: 0xb59a72, path: 0xcbb188, blade: 0xa8d874, uvTile: 4.0 },
  snow:  { top: 0xf4fbff, low: 0xd8e8f6, dirt: 0xa8bccd, path: 0xc2d4e2, blade: 0xe8f4ff, uvTile: 5.0 },
  sand:  { top: 0xe8d3a6, low: 0xd0b98c, dirt: 0xb69a6e, path: 0xdcc294, blade: 0xdfc78a, uvTile: 4.5 },
  dirt:  { top: 0xa8896a, low: 0x8a7050, dirt: 0x736046, path: 0x99805a, blade: 0x94a066, uvTile: 4.0 },
};

/**
 * Build the ground.
 *
 * @param {object} def TerrainDef —
 *   {kind:'terrain', origin:[x,z], size:[sx,sz], res:1.0,
 *    heights:'fn'|Float32Array|{seed, base, hills, flats, ridges, noise},
 *    surface:'grass'|'snow'|'sand'|'dirt',
 *    grass:{density, height, color, cross}, paths:[{pts, w}], uvTile, id}
 * @param {object} theme ThemeDef (palette + colour grade)
 * @param {object} [mats] the shared Mats service (CONTRACT §14)
 * @param {object} [quality] QUALITY entry — `grass` is the blade budget
 * @returns {{mesh: THREE.Mesh, heightfield: Heightfield, grass: THREE.InstancedMesh|null,
 *            bounds: THREE.Box3, sample: function, update: function, dispose: function}}
 */
export function buildTerrain(def, theme, mats, quality) {
  const d = def || {};
  const origin = d.origin || [0, 0];
  const size = d.size || [96, 96];
  const surfaceKey = d.surface || 'grass';
  const LOOK = Object.assign({}, SURFACE_LOOK[surfaceKey] || SURFACE_LOOK.grass, d.look || null);

  // --- resolution ---------------------------------------------------------
  // Hard ceiling: 200 k quads. A course that asks for more gets a coarser grid
  // rather than a 30-second load and a blown triangle budget.
  let res = d.res || 1.0;
  let nx = Math.max(2, Math.round(size[0] / res) + 1);
  let nz = Math.max(2, Math.round(size[1] / res) + 1);
  const MAX_SAMPLES = 200000;
  if (nx * nz > MAX_SAMPLES) {
    const k = Math.sqrt((nx * nz) / MAX_SAMPLES);
    res *= k;
    nx = Math.max(2, Math.round(size[0] / res) + 1);
    nz = Math.max(2, Math.round(size[1] / res) + 1);
  }
  const cellX = size[0] / (nx - 1);
  const cellZ = size[1] / (nz - 1);

  const sample = sampleHeights(d);
  const pathAt = samplePaths(d);

  // --- heights ------------------------------------------------------------
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const wz = origin[1] + j * cellZ;
    for (let i = 0; i < nx; i++) {
      heights[j * nx + i] = sample(origin[0] + i * cellX, wz);
    }
  }

  // --- geometry -----------------------------------------------------------
  const uvTile = d.uvTile || LOOK.uvTile || 4.0;     // metres per texture tile
  const invTile = 1 / uvTile;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const col = new Float32Array(count * 3);

  const topC = new THREE.Color(LOOK.top);
  const lowC = new THREE.Color(LOOK.low);
  const dirtC = new THREE.Color(LOOK.dirt);
  const pathC = new THREE.Color(LOOK.path);

  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < count; i++) {
    const h = heights[i];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const span = Math.max(0.001, maxH - minH);

  // analytic normals from central differences of the sampled array
  const hAt = (i, j) => heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const wx = origin[0] + i * cellX;
      const wz = origin[1] + j * cellZ;
      const y = heights[k];
      pos[k * 3] = wx; pos[k * 3 + 1] = y; pos[k * 3 + 2] = wz;
      uv[k * 2] = wx * invTile;
      uv[k * 2 + 1] = wz * invTile;

      const dhx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * cellX);
      const dhz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * cellZ);
      _norm.set(-dhx, 1, -dhz).normalize();
      nrm[k * 3] = _norm.x; nrm[k * 3 + 1] = _norm.y; nrm[k * 3 + 2] = _norm.z;

      // vertex colour = height gradient, then slope→dirt, then path carve
      const gh = (y - minH) / span;
      _col.copy(lowC).lerp(topC, gh * 0.75 + 0.25);
      const slope = 1 - _norm.y;                         // 0 flat .. 1 vertical
      const slopeK = Math.min(1, Math.max(0, (slope - 0.10) / 0.28));
      _col.lerp(dirtC, slopeK * 0.85);
      const pk = pathAt(wx, wz);
      if (pk > 0) _col.lerp(pathC, pk * 0.92);
      /* Per-vertex variation. The old single ±0.05 value whisper left a 140 m
       * meadow reading as ONE colour from the near field to the far hills, so
       * there was no aerial perspective and no sense of a place with weather in
       * it. Three bands now: a fine value noise, a ~14 m dry/lush patch field
       * that shifts HUE (dry grass is warmer and yellower, lush is deeper and
       * cooler), and a ~45 m swell so whole hillsides differ. All three are
       * evaluated per VERTEX, not per pixel — free at render time. */
      const n = vnoise(wx * 0.21, wz * 0.21, 991) * 0.05;
      const dry = (vnoise(wx * 0.072, wz * 0.072, 1777) - 0.5) * 2;   // ~14 m
      const swell = (vnoise(wx * 0.022, wz * 0.022, 2333) - 0.5) * 2; // ~45 m
      const warm = dry * 0.085 + swell * 0.055;
      /* ROUND 2: the hue bands alone still left every distant hill at the SAME
       * VALUE, which is what makes a big meadow read as one flat plastic green
       * (`_shots/_r2a_verdant.png`). Aerial perspective needs whole hillsides to
       * differ in lightness, not only in hue, so the ~45 m swell now also drives
       * value — a light term, because this multiplies the albedo. */
      const val = swell * 0.062 + dry * 0.022;
      col[k * 3] = Math.min(1, Math.max(0, _col.r + n + val + warm * 1.00));
      col[k * 3 + 1] = Math.min(1, Math.max(0, _col.g + n + val + warm * 0.42));
      col[k * 3 + 2] = Math.min(1, Math.max(0, _col.b + n + val - warm * 0.55));
    }
  }

  const idxArr = (count > 65535) ? new Uint32Array((nx - 1) * (nz - 1) * 6)
                                 : new Uint16Array((nx - 1) * (nz - 1) * 6);
  let w = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
      // split each quad along its SHORTER diagonal: a ridge crossing a quad the
      // wrong way is the classic "terrain has a staircase artefact" bug
      if (Math.abs(heights[a] - heights[e]) <= Math.abs(heights[b] - heights[c])) {
        idxArr[w++] = a; idxArr[w++] = c; idxArr[w++] = e;
        idxArr[w++] = a; idxArr[w++] = e; idxArr[w++] = b;
      } else {
        idxArr[w++] = a; idxArr[w++] = c; idxArr[w++] = b;
        idxArr[w++] = b; idxArr[w++] = c; idxArr[w++] = e;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // --- material -----------------------------------------------------------
  // Cloned so `vertexColors` cannot leak onto every other user of the shared
  // surface material. materials.js preserves its shader hook across clone().
  const baseMat = getMaterial(surfaceKey, theme, mats);
  const mat = baseMat.clone();
  mat.vertexColors = true;
  mat.name = 'terrain_' + surfaceKey;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.castShadow = false;         // a ground plane casting onto itself is only acne
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.def = def;

  // --- collider -----------------------------------------------------------
  const heightfield = new Heightfield({
    originX: origin[0], originZ: origin[1],
    sizeX: size[0], sizeZ: size[1],
    nx, nz, heights,
    surface: surfaceKey,
    id: d.id || 'terrain',
    ref: mesh,
  });

  // --- grass --------------------------------------------------------------
  const grass = buildGrass(d, theme, mats, quality, {
    origin, size, sample, pathAt, heightfield, LOOK, minH, span,
  });
  if (grass) mesh.add(grass);

  const bounds = new THREE.Box3(
    new THREE.Vector3(origin[0], minH, origin[1]),
    new THREE.Vector3(origin[0] + size[0], maxH, origin[1] + size[1]));

  return {
    mesh,
    heightfield,
    grass,
    bounds,
    /** The exact sampler the collider was baked from. */
    sample,
    /** Drive the wind. `t` is the course clock in seconds. */
    update(t) { GRASS_TIME.value = t; },
    dispose() {
      geo.dispose();
      mat.dispose();
      if (grass) {
        if (grass.parent) grass.parent.remove(grass);
        grass.geometry.dispose();
        grass.dispose();
        if (grass.userData.field && grass.userData.field.tex) grass.userData.field.tex.dispose();
      }
      heightfield.dispose();
    },
  };
}

/**
 * Bake the grass FIELD texture: R = terrain height (metres), G = lushness.
 *
 * Lushness is the whole placement rule set, resolved once on the heightfield's
 * own grid instead of per blade: slope gate (the collider's normal, so the
 * visual and the physics agree about what is walkable), carved paths, authored
 * exclusions and a two-band patch noise. The vertex program reads it bilinearly
 * at the blade's WRAPPED world position, which is the only place that position
 * is known — see bladeMaterial.
 *
 * RG16F, LinearFilter: half-float is filterable in WebGL2 core, and 16-bit
 * mantissa over a courses's height range is sub-centimetre.
 */
function buildGrassField(d, ctx, g) {
  const hf = ctx.heightfield;
  const nx = hf.nx, nz = hf.nz;
  const exclude = g.exclude || [];
  const maxSlopeCos = Math.cos((g.maxSlopeDeg === undefined ? 32 : g.maxSlopeDeg) * Math.PI / 180);
  const half = THREE.DataUtils.toHalfFloat;
  const data = new Uint16Array(nx * nz * 2);
  for (let iz = 0; iz < nz; iz++) {
    const z = hf.originZ + iz * hf.cellZ;
    for (let ix = 0; ix < nx; ix++) {
      const x = hf.originX + ix * hf.cellX;
      const y = hf.heights[iz * nx + ix];
      let lush = 1;
      hf.normalAt(x, z, _norm);
      // slope: fully lush on the flat, gone by ~12 deg past the gate
      lush *= Math.max(0, Math.min(1, (_norm.y - maxSlopeCos) / 0.18));
      // carved paths keep their bare track
      lush *= 1 - Math.max(0, Math.min(1, (ctx.pathAt(x, z) - 0.04) / 0.16));
      for (let e = 0; e < exclude.length; e++) {
        const E = exclude[e];
        const r = E.r || 1;
        const dd = Math.hypot(x - E.p[0], z - E.p[1]);
        lush *= Math.max(0, Math.min(1, (dd - r * 0.72) / (r * 0.42)));
      }
      /* Two patch bands: ~11 m clumps riding a ~34 m dry/lush swell.
       * `vnoise` returns [-1, 1], NOT [0, 1] — taking it raw drove lushness
       * negative over whole hillsides and left the meadow bald on one side of
       * the frame and dense on the other (`_shots/_r2b_verdant.png`). Both
       * bands are mapped to [0, 1] first, and the floor is high enough that no
       * walkable ground is ever bare unless a path or a slope says so. */
      const clump = vnoise(x * 0.092, z * 0.092, 4242) * 0.5 + 0.5;
      const swell = vnoise(x * 0.029, z * 0.029, 8181) * 0.5 + 0.5;
      lush *= 0.55 + 0.62 * clump * (0.45 + 0.72 * swell);
      const o = (iz * nx + ix) * 2;
      data[o] = half(y);
      data[o + 1] = half(Math.max(0, Math.min(1, lush)));
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'grassfield';
  return tex;
}

let _fieldUid = 0;

/**
 * Build the blade field as a CAMERA-LOCAL RING (see bladeMaterial for why).
 *
 * The instances are a jittered lattice over one 2R x 2R tile centred on the
 * world origin; the vertex program wraps each of them to the tile the camera is
 * standing in and drops it onto the heightfield. So this function no longer
 * cares where the terrain is, only how many blades there are and how big the
 * tile is — and the density the player sees stops depending on how large the
 * meadow happens to be.
 */
function buildGrass(d, theme, mats, quality, ctx) {
  const cfg = d.grass;
  if (cfg === false || cfg === null) return null;
  const g = cfg || {};
  /* CONTRACT §18 "30k at high, 8k at low": QUALITY.grass is a 0..1 SCALE on the
   * blade count (settings.js:54), not the count itself. Reading it as an
   * absolute count is what left this function returning null at every quality
   * tier, on every course, since the module was written. */
  const qScale = (quality && typeof quality.grass === 'number') ? quality.grass : 1;
  /* The quality scale multiplies an authored `count` too — otherwise a course
   * that pins a count silently opts out of the low/medium tiers. */
  const budget = Math.max(0, Math.round(
    (g.count !== undefined ? g.count : BLADE_BUDGET_MAX) * Math.min(1, Math.max(0, qScale))));
  if (budget < 32) return null;

  /* The ring shrinks with the budget so density stays put: a low-quality
   * machine gets a smaller lawn, not a thinner one. 30k blades over 36x36 m is
   * ~23/m2 before the lushness cull. */
  const density = g.density === undefined ? 22 : g.density;         // blades per m²
  const ring = Math.max(6, Math.min(g.ring === undefined ? 18 : g.ring,
    Math.sqrt(budget / Math.max(1, density)) * 0.5));
  const fade = ring * 0.74;

  const bladeH = g.height === undefined ? 0.26 : g.height;
  /* 0.20 m at the base against a 0.42 m height is a 1:2 spike, and instance
   * scaling took it to 27 cm — which is what made the first render read as a
   * field of caltrops rather than grass. A blade is roughly 1:5. */
  const bladeW = g.width === undefined ? 0.075 : g.width;
  const cross = g.cross !== false;

  const wanted = budget;
  const cells = Math.max(4, Math.ceil(Math.sqrt(wanted)));
  const step = (ring * 2) / cells;
  const rnd = mulberry32((d.seed | 0) || 20260902);

  /* Texel-centre mapping, not corner mapping. Height sample (i, j) sits at world
   * origin + i*cell, but a texture lookup at uv lands on texel index
   * uv*n - 0.5 — so a naive (x-origin)/size would read up to half a texel
   * (0.5 m at res 1.0) off, which on a slope is blades hovering or buried. The
   * half-texel is folded into the origin so the shader stays one madd. */
  const hf = ctx.heightfield;
  const field = {
    uid: ++_fieldUid,
    tex: buildGrassField(d, ctx, g),
    rect: new THREE.Vector4(
      hf.originX - hf.cellX * 0.5, hf.originZ - hf.cellZ * 0.5,
      1 / (hf.nx * hf.cellX), 1 / (hf.nz * hf.cellZ)),
    ring: new THREE.Vector2(ring, fade),
  };

  const geo = bladeGeometry(bladeW, bladeH, cross);
  const mat = bladeMaterial(theme, mats, cross ? 'x' : 'i', field);
  const im = new THREE.InstancedMesh(geo, mat, wanted);
  im.name = 'terrain.grass';
  im.castShadow = false;
  im.receiveShadow = true;
  /* The ring follows the camera in the vertex program, so a bounding sphere
   * computed from the authored anchors describes nowhere the blades actually
   * are. It is always around the viewer by construction. */
  im.frustumCulled = false;

  const tipC = new THREE.Color(g.color === undefined ? ctx.LOOK.blade : g.color);
  const rootC = new THREE.Color(ctx.LOOK.low);

  let n = 0;
  for (let j = 0; j < cells && n < wanted; j++) {
    for (let i = 0; i < cells && n < wanted; i++) {
      const x = -ring + (i + rnd()) * step;
      const z = -ring + (j + rnd()) * step;
      const yaw = rnd() * Math.PI * 2;
      const scale = 0.74 + rnd() * 0.66;
      _s0.set(scale, scale * (0.78 + rnd() * 0.62), scale);
      _v0.set(x, 0, z);
      _m0.makeRotationY(yaw);
      _m0.scale(_s0);
      _m0.setPosition(_v0);
      im.setMatrixAt(n, _m0);
      // species variation only; the world-space lushness tint is applied in the
      // vertex program, where the wrapped position is known.
      const k = rnd();
      _col.copy(rootC).lerp(tipC, 0.12 + k * 0.40);
      _colB.setRGB(
        Math.min(1, _col.r * (0.88 + rnd() * 0.26)),
        Math.min(1, _col.g * (0.88 + rnd() * 0.26)),
        Math.min(1, _col.b * (0.88 + rnd() * 0.26)));
      im.setColorAt(n, _colB);
      n++;
    }
  }
  if (n === 0) {
    geo.dispose();
    im.dispose();
    field.tex.dispose();
    return null;
  }
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.matrixAutoUpdate = false;
  im.updateMatrix();
  im.userData.field = field;
  return im;
}

/** The shared grass wind clock, for a caller that drives several fields. */
export function grassTimeUniform() { return GRASS_TIME; }

/** Advance every grass field in the scene. */
export function setGrassTime(t) { GRASS_TIME.value = t; }

/** Release the cached blade materials (level teardown). */
export function disposeTerrain() {
  for (const m of _grassMats.values()) m.dispose();
  _grassMats.clear();
}
