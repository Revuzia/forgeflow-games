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
  const P = [], N = [], U = [];
  const half = w * 0.5, tip = w * 0.16;
  const card = (yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const X = (v) => [c * v, 0, s * v];
    const b0 = X(-half), b1 = X(half), t0 = X(-tip), t1 = X(tip);
    const nx = -s, nz = c;
    const push = (p, y, u, v) => { P.push(p[0], y, p[2]); N.push(nx, 0.45, nz); U.push(u, v); };
    push(b0, 0, 0, 0); push(b1, 0, 1, 0); push(t1, h, 1, 1);
    push(b0, 0, 0, 0); push(t1, h, 1, 1); push(t0, h, 0, 1);
  };
  card(0);
  if (cross) card(Math.PI * 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
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
function bladeMaterial(theme, mats, key) {
  const id = (theme && theme.id) || 'default';
  const ck = 'blade|' + id + '|' + key;
  let m = _grassMats.get(ck);
  if (m) return m;
  const base = getMaterial('leaves', theme, mats);
  m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: (base && base.map) || null,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  if (base && base.alphaTest) m.alphaTest = base.alphaTest;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = GRASS_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  vec3 gOff = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
        '#else',
        '  vec3 gOff = vec3(0.0);',
        '#endif',
        'float gPh = dot(gOff, vec3(0.317, 0.113, 0.271));',
        'float gW = pow(clamp(uv.y, 0.0, 1.0), 1.6);',
        'float gA = sin(uTime * 1.9 + gPh) * 0.5 + sin(uTime * 3.7 + gPh * 1.7) * 0.22;',
        'transformed.x += gA * 0.16 * gW;',
        'transformed.z += cos(uTime * 1.55 + gPh * 1.3) * 0.11 * gW;',
        'transformed.y -= abs(gA) * 0.035 * gW;',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'crestbound-grassblade';
  m.name = 'grass_blade';
  _grassMats.set(ck, m);
  return m;
}

/** Default per-surface look when the def does not override it. */
const SURFACE_LOOK = {
  grass: { top: 0x6ea043, low: 0x4a7a35, dirt: 0x6b5236, path: 0x7a6448, blade: 0x76ad4a, uvTile: 4.0 },
  snow:  { top: 0xe7f1fa, low: 0xc0d4e6, dirt: 0x8fa2b4, path: 0xa9bccd, blade: 0xd6e6f2, uvTile: 5.0 },
  sand:  { top: 0xd6bd8c, low: 0xbda274, dirt: 0x9c8258, path: 0xc4a97b, blade: 0xc9b071, uvTile: 4.5 },
  dirt:  { top: 0x7a6144, low: 0x5d4a34, dirt: 0x4d3d2b, path: 0x6b5439, blade: 0x6f7a44, uvTile: 4.0 },
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
      // a whisper of per-vertex value noise so the field is never flat colour
      const n = vnoise(wx * 0.21, wz * 0.21, 991) * 0.05;
      col[k * 3] = Math.min(1, Math.max(0, _col.r + n));
      col[k * 3 + 1] = Math.min(1, Math.max(0, _col.g + n));
      col[k * 3 + 2] = Math.min(1, Math.max(0, _col.b + n));
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
      }
      heightfield.dispose();
    },
  };
}

/**
 * Scatter the blade field. Poisson-ish jittered grid rejection: walk a jittered
 * lattice, reject a candidate whose slope exceeds 30° or that sits inside a
 * carved path or an authored exclusion, and stop at the quality budget.
 *
 * Instances are placed in the terrain mesh's LOCAL space (which is world space —
 * the terrain mesh is never moved), tilted slightly with the ground normal so
 * blades on a slope lie along it instead of standing out of it like nails.
 */
function buildGrass(d, theme, mats, quality, ctx) {
  const cfg = d.grass;
  if (cfg === false || cfg === null) return null;
  const g = cfg || {};
  const budget = Math.max(0, Math.round(
    g.count !== undefined ? g.count : ((quality && quality.grass) !== undefined ? quality.grass : 12000)));
  if (budget < 32) return null;

  const density = g.density === undefined ? 1.6 : g.density;      // blades per m²
  const bladeH = g.height === undefined ? 0.42 : g.height;
  const bladeW = g.width === undefined ? 0.20 : g.width;
  const cross = g.cross !== false;
  const maxSlopeCos = Math.cos((g.maxSlopeDeg === undefined ? 30 : g.maxSlopeDeg) * Math.PI / 180);
  const exclude = g.exclude || [];

  const area = ctx.size[0] * ctx.size[1];
  const wanted = Math.min(budget, Math.round(area * density));
  if (wanted < 32) return null;

  // jittered lattice sized to produce ~1.9x the wanted count before rejection
  const cells = Math.max(4, Math.ceil(Math.sqrt(wanted * 1.9)));
  const stepX = ctx.size[0] / cells, stepZ = ctx.size[1] / cells;
  const rnd = mulberry32((d.seed | 0) || 20260902);

  const geo = bladeGeometry(bladeW, bladeH, cross);
  const mat = bladeMaterial(theme, mats, cross ? 'x' : 'i');
  const im = new THREE.InstancedMesh(geo, mat, wanted);
  im.name = 'terrain.grass';
  im.castShadow = false;
  im.receiveShadow = true;
  im.frustumCulled = true;

  const tipC = new THREE.Color(g.color === undefined ? ctx.LOOK.blade : g.color);
  const rootC = new THREE.Color(ctx.LOOK.low);

  let n = 0;
  for (let j = 0; j < cells && n < wanted; j++) {
    for (let i = 0; i < cells && n < wanted; i++) {
      const x = ctx.origin[0] + (i + rnd()) * stepX;
      const z = ctx.origin[1] + (j + rnd()) * stepZ;

      // slope gate (uses the COLLIDER's normal so the visual and the physics
      // agree about what counts as walkable)
      ctx.heightfield.normalAt(x, z, _norm);
      if (_norm.y < maxSlopeCos) continue;

      // path gate
      if (ctx.pathAt(x, z) > 0.18) continue;

      // authored exclusions (buildings, water, arena floors)
      let skip = false;
      for (let e = 0; e < exclude.length; e++) {
        const E = exclude[e];
        const dx = x - E.p[0], dz = z - E.p[1];
        if (dx * dx + dz * dz < (E.r || 1) * (E.r || 1)) { skip = true; break; }
      }
      if (skip) continue;

      const y = ctx.heightfield.heightAt(x, z);
      if (!(y === y)) continue;                         // NaN outside the field

      // patchiness: a second noise band thins the field into clumps
      const patch = vnoise(x * 0.09, z * 0.09, 4242) * 0.5 + 0.5;
      if (rnd() > 0.28 + patch * 0.82) continue;

      // orient: yaw random, then lean with the ground normal
      _q0.setFromUnitVectors(_up, _norm);
      const yaw = rnd() * Math.PI * 2;
      const scale = 0.72 + rnd() * 0.62;
      _s0.set(scale, scale * (0.8 + rnd() * 0.5), scale);
      _v0.set(x, y, z);
      _m0.makeRotationY(yaw);
      _m1.makeRotationFromQuaternion(_q0);
      _m0.premultiply(_m1);
      _m0.scale(_s0);
      _m0.setPosition(_v0);
      im.setMatrixAt(n, _m0);

      // colour: height gradient + noise band, root darker than tip
      const gh = (y - ctx.minH) / ctx.span;
      _col.copy(rootC).lerp(tipC, 0.35 + gh * 0.5 + patch * 0.2);
      _colB.setRGB(
        Math.min(1, _col.r * (0.86 + rnd() * 0.28)),
        Math.min(1, _col.g * (0.86 + rnd() * 0.28)),
        Math.min(1, _col.b * (0.86 + rnd() * 0.28)));
      im.setColorAt(n, _colB);
      n++;
    }
  }
  if (n === 0) {
    geo.dispose();
    im.dispose();
    return null;
  }
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.matrixAutoUpdate = false;
  im.updateMatrix();
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
