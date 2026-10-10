// GENESIS — chunked terrain LOD over the 20 icosahedron faces (CONTRACT.md §4.2, §15.4).
//
// Each base face is a level-0 triangular patch; a patch splits into 4 children by edge midpoints (the middle child is
// the inverted one). Every patch is a PATCH_RES × PATCH_RES triangular lattice in FLAT face coordinates (units of the
// sim grid), so a render vertex belongs to sim triangle grid.locateFaceCoords(face, fi, fj) — the same rule as the CPU.
//
// Geometry is static per patch (fields are textures): per vertex
//   position = dir (unit), aCells = (cellA, cellB, cellC, wB), aMisc = (wC, detail, skirt, dune), aGrad = ∇detail,
//   aGradD = ∇dune (the dune shape of noise.ts duneNoise, scaled in the shader by the cells' dune amplitude),
// plus a GEOMORPH TARGET: odd lattice vertices collapse onto the midpoint of the two even neighbours along the coarse
// edge they split ((i±1, j), (i, j±1) or (i−1, j+1)/(i+1, j−1)), whose own cells / weights / dirs / coarse-filtered
// detail are stored too (aN1*, aN2*). The midpoint rule is symmetric, so two patches sharing an edge morph it
// identically, and at morph = 1 a patch is exactly its parent's mesh: LOD transitions never pop.
//
// Selection is screen-space error with hysteresis: a level-L patch with vertex spacing s splits when the camera is
// closer than K·size_L (K from viewport height, FOV and the quality's pixel error); vertices morph over the last ~28 %
// of their parent's range, which by construction ends where the coarser neighbour begins. Skirts hide the remaining
// transient cracks (e.g. while children are still being built under the per-frame budget).
//
// Detail relief: detailNoise (src/sim/grid/noise.ts) with Noise3(planet seed) — the function the CPU ground uses —
// baked per vertex, band-limited per level so coarse patches do not alias, at full strength from ~1 m spacing down.

import {
  BatchedMesh, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Sphere, Vector3, Frustum, type Mesh, type Group,
  type Material, type Matrix4,
} from 'three';
import type { IcoGrid } from '../../sim/grid/icogrid.ts';
import { newHit } from '../../sim/grid/icogrid.ts';
import { detailNoise, duneNoise, DUNE_WAVELENGTH, type Noise3 } from '../../sim/grid/noise.ts';
import { curveMargin } from '../../sim/grid/surface.ts';

export const PATCH_RES = 32;
/** angle subtended by an icosahedron edge */
const ICO_EDGE = 1.1071487177940904;

// ───────────────────────────── shared topology ─────────────────────────────

const R = PATCH_RES;
const NPTS = ((R + 1) * (R + 2)) / 2;
const NSKIRT = 3 * R;
const NVERT = NPTS + NSKIRT;
/** indices per patch: R² lattice triangles + two per skirt quad */
const NINDEX = (R * R + 6 * R) * 3;
const ptIndex = (i: number, j: number): number => j * (R + 1) - (j * (j - 1)) / 2 + i;

/** boundary lattice points in CCW order (A→B, B→C, C→A), 3R of them */
const BOUNDARY: [number, number][] = [];
for (let i = 0; i < R; i++) BOUNDARY.push([i, 0]);
for (let j = 0; j < R; j++) BOUNDARY.push([R - j, j]);
for (let j = R; j > 0; j--) BOUNDARY.push([0, j]);

let sharedIndex: Uint16BufferAttribute | null = null;
function indexBuffer(): Uint16BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const idx: number[] = [];
  for (let j = 0; j < R; j++) {
    for (let i = 0; i + j < R; i++) {
      idx.push(ptIndex(i, j), ptIndex(i + 1, j), ptIndex(i, j + 1));
      if (i + j < R - 1) idx.push(ptIndex(i + 1, j), ptIndex(i + 1, j + 1), ptIndex(i, j + 1));
    }
  }
  for (let k = 0; k < NSKIRT; k++) {
    const k1 = (k + 1) % NSKIRT;
    const p0 = ptIndex(BOUNDARY[k][0], BOUNDARY[k][1]);
    const p1 = ptIndex(BOUNDARY[k1][0], BOUNDARY[k1][1]);
    const s0 = NPTS + k, s1 = NPTS + k1;
    idx.push(p0, s0, p1, p1, s0, s1);
  }
  sharedIndex = new Uint16BufferAttribute(idx, 1);
  return sharedIndex;
}

/** the two even lattice neighbours an odd vertex morphs toward (both = self for even vertices) */
function morphNeighbours(i: number, j: number): [number, number, number, number] {
  const io = i & 1, jo = j & 1;
  if (!io && !jo) return [i, j, i, j];
  if (io && !jo) return [i - 1, j, i + 1, j];
  if (!io && jo) return [i, j - 1, i, j + 1];
  return [i - 1, j + 1, i + 1, j - 1];
}

/** band-limit weights for the two detail octaves (≈12 m and ≈3.2 m features) at a vertex spacing */
function detailWeights(spacing: number): [number, number] {
  const w = (feature: number) => Math.min(1, Math.max(0, (feature / spacing - 1.5) / 1.5));
  return [w(12), w(3.2)];
}

/** band-limit weight of the dunes at a vertex spacing (gone where the lattice cannot carry a 26 m ridge) */
function duneWeight(spacing: number): number {
  return Math.min(1, Math.max(0, (DUNE_WAVELENGTH / spacing - 2) / 1.5));
}

function filteredDetail(noise: Noise3, x: number, y: number, z: number, radius: number, w1: number, w2: number): number {
  if (w1 >= 1 && w2 >= 1) return detailNoise(noise, x, y, z, radius);
  if (w1 <= 0 && w2 <= 0) return 0;
  // the same two octaves as detailNoise, faded (identical to detailNoise when both weights are 1)
  const f1 = radius / 12;
  const f2 = radius / 3.2;
  let v = 0;
  if (w1 > 0) v += noise.noise(x * f1, y * f1, z * f1) * 1.6 * w1;
  if (w2 > 0) v += noise.noise(x * f2 + 31.7, y * f2, z * f2) * 0.35 * w2;
  return v;
}

// ───────────────────────────── patches ─────────────────────────────

export class Patch {
  readonly face: number;
  readonly level: number;
  /** flat face coordinates of the corners (units of the sim grid) */
  readonly a: [number, number];
  readonly b: [number, number];
  readonly c: [number, number];
  children: Patch[] | null = null;
  split = false;
  readonly centerDir = new Vector3();
  angRadius = 0;
  hMin = 0;
  hMax = 0;
  hasWater = false;
  boundsVersion = -1;
  cells: Int32Array | null = null;
  /** the cells the patch's vertices actually interpolate (set when its geometry is built): exact water presence */
  vcells: Int32Array | null = null;
  /** geometry built and stored in its level's batch (slot below) */
  built = false;
  /** its level's terrain batch (shared by every patch of the level: planetview swaps its material for the shadow
   * pass through this reference) */
  mesh: Mesh | null = null;
  /** slot in the level's terrain batch, and in its water batch (−1: none; a dry patch never takes a water slot) */
  tSlot = -1;
  wSlot = -1;
  lastUsed = 0;
  readonly sphere = new Sphere();

  constructor(face: number, level: number, a: [number, number], b: [number, number], c: [number, number]) {
    this.face = face; this.level = level; this.a = a; this.b = b; this.c = c;
  }

  makeChildren(): Patch[] {
    if (this.children) return this.children;
    const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const ab = mid(this.a, this.b), bc = mid(this.b, this.c), ca = mid(this.c, this.a);
    const L = this.level + 1;
    this.children = [
      new Patch(this.face, L, this.a, ab, ca),
      new Patch(this.face, L, ab, this.b, bc),
      new Patch(this.face, L, ca, bc, this.c),
      new Patch(this.face, L, bc, ca, ab),
    ];
    return this.children;
  }
}

export interface ChunkMaterials {
  terrain(level: number): Material;
  water(level: number): Material;
}

/**
 * One LOD level's patches in ONE draw (three's BatchedMesh: WEBGL_multi_draw where the browser has it, else a loop
 * of draws with no per-object cost). Every patch has the same vertex and index counts (the shared lattice), so the
 * batch is a pool of fixed-size slots: a new patch overwrites a freed slot in place (a sub-range upload) and the pool
 * doubles when it runs out. The patches' positions are already in the body frame, so every instance matrix stays the
 * identity; visibility per slot is set by the LOD selection (and per shadow cascade), never by three's culling (the
 * unit-direction `position` attribute would give it wrong bounds).
 */
class PatchBatch {
  readonly mesh: BatchedMesh;
  private cap: number;
  private used = 0;
  private free: number[] = [];
  private geomId: number[] = [];
  private instId: number[] = [];
  private visibleN = 0;
  private vis: Uint8Array;

  constructor(material: Material, cap: number, layer: number, name: string) {
    this.cap = cap;
    this.vis = new Uint8Array(cap);
    this.mesh = new BatchedMesh(cap, cap * NVERT, cap * NINDEX, material);
    this.mesh.name = name;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.layers.set(layer);
  }

  /** store a patch geometry, returning its slot (hidden until shown) */
  alloc(geo: BufferGeometry): number {
    let s = this.free.pop();
    if (s === undefined) {
      if (this.used >= this.cap) this.grow();
      s = this.used++;
      this.geomId[s] = this.mesh.addGeometry(geo, NVERT, NINDEX);
      this.instId[s] = this.mesh.addInstance(this.geomId[s]);
      // (a new instance starts visible: count it, then hide it)
      this.vis[s] = 1;
      this.visibleN++;
      this.show(s, false);
    } else {
      // (a freed slot is already hidden)
      this.mesh.setGeometryAt(this.geomId[s], geo);
    }
    return s;
  }

  release(s: number): void {
    if (s < 0) return;
    this.show(s, false);
    this.free.push(s);
  }

  show(s: number, on: boolean): void {
    if (s < 0 || (this.vis[s] === 1) === on) return;
    this.vis[s] = on ? 1 : 0;
    this.visibleN += on ? 1 : -1;
    this.mesh.setVisibleAt(this.instId[s], on);
    this.mesh.visible = this.visibleN > 0;
  }

  isShown(s: number): boolean { return s >= 0 && this.vis[s] === 1; }

  /** a copy of a slot's vertex data as a stand-alone geometry (a patch that turns wet takes a water slot from it) */
  extract(s: number): BufferGeometry {
    const src = this.mesh.geometry;
    const r = this.mesh.getGeometryRangeAt(this.geomId[s]) as { vertexStart: number };
    const vs = r.vertexStart;
    const geo = new BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.getAttribute(name);
      geo.setAttribute(name, new Float32BufferAttribute((a.array as Float32Array).slice(vs * a.itemSize, (vs + NVERT) * a.itemSize), a.itemSize));
    }
    geo.setIndex(indexBuffer());
    return geo;
  }

  private grow(): void {
    const cap = this.cap * 2;
    this.mesh.setInstanceCount(cap);
    this.mesh.setGeometrySize(cap * NVERT, cap * NINDEX);
    const v = new Uint8Array(cap);
    v.set(this.vis);
    this.vis = v;
    this.cap = cap;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

export interface ChunkSelectContext {
  /** camera position in the planet BODY frame (m) */
  camBody: Vector3;
  /** camera frustum in world (camera-relative) space */
  frustum: Frustum;
  /** body → world (camera-relative) transform of the planet group */
  bodyToWorld: Matrix4;
  /** split distance factor: a level-L patch splits when closer than K · size_L */
  K: number;
  frame: number;
  /** max patches built this frame */
  buildBudget: number;
}

const _v = new Vector3();
const _pc = new Vector3();
const _hit = newHit();
/**
 * extra split reach for patches seen edge-on (factor 1 + k·(1 − |cos|)³, k up to this). It is for the LIMB seen from
 * altitude: from near the ground nearly every distant patch is edge-on, and the full boost there tripled the patch and
 * draw counts of surface views for detail nobody sees, so k fades out below ~a third of a radius of altitude
 * (ChunkLOD.silK; the vertex shader reads the same k from uMorph.w).
 */
export const SILHOUETTE_SPLIT = 2.5;
/** reach of the local horizon occluder profile (rad from the camera) and its number of radial bins */
const LOCAL_OCC = 1.2;
const OCC_BINS = 96;

/** Water and ground arrays the chunk system reads for bounds (kept by FieldTextures). */
export interface ChunkFieldSource {
  surface: ArrayLike<number> | null;
  /** per-cell curvature gradients (4 floats per cell, surface.ts): the curved ground can bulge past its cells */
  grad: ArrayLike<number> | null;
  waterLevel: Float32Array;
  waterDepth: Float32Array;
  geomVersion: number;
}

export class ChunkLOD {
  readonly grid: IcoGrid;
  readonly noise: Noise3;
  readonly radius: number;
  readonly roots: Patch[] = [];
  readonly maxLevel: number;
  /** metres per lattice step at level 0 */
  readonly spacing0: number;
  selected: Patch[] = [];
  /** meshes become children of this group (the planet's body-frame group) */
  private group: Group;
  private mats: ChunkMaterials;
  private fields: ChunkFieldSource;
  private live = new Set<Patch>();
  private built = 0;
  private builtThisFrame = 0;
  /** per LOD level: the terrain batch and the water batch (created on first use) */
  private tBatch: (PatchBatch | null)[] = [];
  private wBatch: (PatchBatch | null)[] = [];
  maxCached = 1400;
  terrainLayerMask = 0;
  castShadows = false;
  waterEnabled = true;
  stats = { patches: 0, waterPatches: 0, builtTotal: 0, horizonCulled: 0 };
  /** this frame's silhouette split boost (see SILHOUETTE_SPLIT), set by select() */
  silK = SILHOUETTE_SPLIT;

  constructor(grid: IcoGrid, noise: Noise3, radius: number, group: Group, mats: ChunkMaterials, fields: ChunkFieldSource) {
    this.grid = grid; this.noise = noise; this.radius = radius; this.group = group; this.mats = mats; this.fields = fields;
    const n = grid.n;
    for (let f = 0; f < 20; f++) this.roots.push(new Patch(f, 0, [0, 0], [n, 0], [0, n]));
    this.spacing0 = (ICO_EDGE * radius) / R;
    // deepest level: lattice spacing ≈ 0.8 m (the 3.2 m detail octave is then fully resolved)
    this.maxLevel = Math.max(0, Math.ceil(Math.log2(this.spacing0 / 0.8)));
  }

  /** metres per lattice step at a level */
  spacing(level: number): number { return this.spacing0 / (1 << level); }
  /** approximate patch edge length (m) */
  size(level: number): number { return this.spacing(level) * R; }

  // ── bounds ──

  private flatDir(face: number, fi: number, fj: number, out: Vector3): Vector3 {
    const fc = this.grid.faceCorners;
    const n = this.grid.n;
    const u = fi / n, v = fj / n;
    const o = face * 9;
    out.set(
      fc[o] + (fc[o + 3] - fc[o]) * u + (fc[o + 6] - fc[o]) * v,
      fc[o + 1] + (fc[o + 4] - fc[o + 1]) * u + (fc[o + 7] - fc[o + 1]) * v,
      fc[o + 2] + (fc[o + 5] - fc[o + 2]) * u + (fc[o + 8] - fc[o + 2]) * v,
    );
    return out.normalize();
  }

  private patchCells(p: Patch): Int32Array {
    if (p.cells) return p.cells;
    const g = this.grid;
    const n = g.n;
    const xs = [p.a[0], p.b[0], p.c[0]], ys = [p.a[1], p.b[1], p.c[1]];
    const i0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), i1 = Math.min(n, Math.ceil(Math.max(...xs)) + 1);
    const j0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), j1 = Math.min(n, Math.ceil(Math.max(...ys)) + 1);
    const out: number[] = [];
    const st = g.gridStride, row = n + 1, base = p.face * st;
    // barycentric inside test with a one-cell margin (so shore cells across the border count)
    const ax = p.a[0], ay = p.a[1];
    const e1x = p.b[0] - ax, e1y = p.b[1] - ay, e2x = p.c[0] - ax, e2y = p.c[1] - ay;
    const det = e1x * e2y - e1y * e2x;
    const size = Math.sqrt(Math.abs(det));
    const margin = 1.6 / Math.max(size, 1e-6);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1 && i + j <= n; i++) {
        const dx = i - ax, dy = j - ay;
        const u = (dx * e2y - dy * e2x) / det;
        const v = (e1x * dy - e1y * dx) / det;
        if (u < -margin || v < -margin || u + v > 1 + margin) continue;
        out.push(g.faceGrid[base + j * row + i]);
      }
    }
    // tiny patches may contain no lattice point: use the cells of the sim triangle under the centroid
    if (out.length === 0) {
      g.locateFaceCoords(p.face, (p.a[0] + p.b[0] + p.c[0]) / 3, (p.a[1] + p.b[1] + p.c[1]) / 3, _hit);
      out.push(_hit.a, _hit.b, _hit.c);
    }
    p.cells = Int32Array.from(out);
    return p.cells;
  }

  private updateBounds(p: Patch): void {
    if (p.boundsVersion === this.fields.geomVersion && p.boundsVersion >= 0) return;
    p.boundsVersion = this.fields.geomVersion;
    const da = this.flatDir(p.face, p.a[0], p.a[1], new Vector3());
    const db = this.flatDir(p.face, p.b[0], p.b[1], new Vector3());
    const dc = this.flatDir(p.face, p.c[0], p.c[1], new Vector3());
    p.centerDir.copy(da).add(db).add(dc).normalize();
    p.angRadius = Math.max(p.centerDir.angleTo(da), p.centerDir.angleTo(db), p.centerDir.angleTo(dc)) * 1.04 + 1e-5;
    const cells = this.patchCells(p);
    const s = this.fields.surface;
    const wl = this.fields.waterLevel, wd = this.fields.waterDepth;
    const G = this.fields.grad;
    let lo = Infinity, hi = -Infinity, water = false, g2 = 0;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const h = s ? s[c] : 0;
      if (G) { const m = G[c * 4] * G[c * 4] + G[c * 4 + 1] * G[c * 4 + 1] + G[c * 4 + 2] * G[c * 4 + 2]; if (m > g2) g2 = m; }
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      if (wd[c] > 0.02 || wl[c] > h - 0.5) {
        water = true;
        if (wl[c] > hi) hi = wl[c];
      }
    }
    // the bounds keep the 1.6-cell margin (shore cells across the border), but whether the patch draws a water sheet
    // at all is decided by the cells its vertices interpolate: the margin flagged every patch within ~80 m of a pond
    // (501 water patches over the mostly dry lookdev city, each a full 2 000-triangle draw of discarded fragments)
    if (water && p.vcells) water = this.vertexWater(p.vcells, s, wl, wd);
    // detail relief (±~2 m), the coarse lattice cutting inside a sim triangle's plane, and the curved ground's bulge
    const bulge = curveMargin(this.grid, this.radius, Math.sqrt(g2));
    p.hMin = lo - 2.5 - bulge;
    p.hMax = hi + 2.5 + bulge;
    p.hasWater = water;
    const rMid = this.radius + 0.5 * (p.hMin + p.hMax);
    const chord = 2 * Math.sin(p.angRadius / 2) * (this.radius + p.hMax);
    p.sphere.center.copy(p.centerDir).multiplyScalar(rMid);
    p.sphere.radius = Math.hypot(chord, 0.5 * (p.hMax - p.hMin)) + this.skirtDepth(p.level);
  }

  /** any of these cells wet, or a shore cell whose extrapolated level is within reach of its ground (same rule as bounds) */
  private vertexWater(cells: Int32Array, s: ArrayLike<number> | null, wl: Float32Array, wd: Float32Array): boolean {
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (wd[c] > 0.02 || wl[c] > (s ? s[c] : 0) - 0.5) return true;
    }
    return false;
  }

  skirtDepth(level: number): number {
    return Math.max(1.5, this.spacing(level) * 1.5);
  }

  /** closest distance from the camera (body frame) to the patch's shell sector */
  private boundDistance(p: Patch, cam: Vector3, rc: number): number {
    const cosT = rc > 0 ? Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc)) : 1;
    const th = Math.max(0, Math.acos(cosT) - p.angRadius);
    const r0 = this.radius + p.hMin, r1 = this.radius + p.hMax;
    const rho = Math.min(r1, Math.max(r0, rc * Math.cos(th)));
    return Math.sqrt(Math.max(0, rc * rc + rho * rho - 2 * rc * rho * Math.cos(th)));
  }

  /** false if the planet itself hides the whole patch (two tangent cones to the occluding sphere) */
  private aboveHorizon(p: Patch, cam: Vector3, rc: number, rOcc: number): boolean {
    if (rc <= rOcc) return true;
    const cosT = Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc));
    const th = Math.max(0, Math.acos(cosT) - p.angRadius);
    const rTop = this.radius + p.hMax;
    if (rTop <= rOcc) return th < 1e-3;
    const aCam = Math.acos(rOcc / rc);
    const aPt = Math.acos(rOcc / rTop);
    return th < aCam + aPt;
  }

  // ── geometry ──

  private buildGeometry(p: Patch): BufferGeometry {
    const g = this.grid;
    const noise = this.noise;
    const radius = this.radius;
    const sp = this.spacing(p.level);
    const [w1, w2] = detailWeights(sp);
    const [pw1, pw2] = p.level > 0 ? detailWeights(sp * 2) : [w1, w2];
    // extended lattice (2 rings beyond the patch) for central-difference gradients at both resolutions
    const E = 2;
    const W = R + 1 + 2 * E;
    const ext = (i: number, j: number) => (j + E) * W + (i + E);
    const dirs = new Float64Array(W * W * 3);
    const dOwn = new Float64Array(W * W);
    const dPar = new Float64Array(W * W);
    // dunes (surface.ts: × the cells' dune amplitude), band-limited per level like the detail
    const uOwn = new Float64Array(W * W);
    const uPar = new Float64Array(W * W);
    const wd = duneWeight(sp), pwd = p.level > 0 ? duneWeight(sp * 2) : wd;
    const has = new Uint8Array(W * W);
    const fiOf = (i: number, j: number) => p.a[0] + ((p.b[0] - p.a[0]) * i) / R + ((p.c[0] - p.a[0]) * j) / R;
    const fjOf = (i: number, j: number) => p.a[1] + ((p.b[1] - p.a[1]) * i) / R + ((p.c[1] - p.a[1]) * j) / R;
    for (let j = -E; j <= R + E; j++) {
      for (let i = -E; i <= R + E; i++) {
        if (i + j > R + E || i + j < -E) continue;
        const k = ext(i, j);
        this.flatDir(p.face, fiOf(i, j), fjOf(i, j), _v);
        dirs[k * 3] = _v.x; dirs[k * 3 + 1] = _v.y; dirs[k * 3 + 2] = _v.z;
        dOwn[k] = filteredDetail(noise, _v.x, _v.y, _v.z, radius, w1, w2);
        dPar[k] = (pw1 === w1 && pw2 === w2) ? dOwn[k] : filteredDetail(noise, _v.x, _v.y, _v.z, radius, pw1, pw2);
        const du = wd > 0 || pwd > 0 ? duneNoise(noise, _v.x, _v.y, _v.z, radius) : 0;
        uOwn[k] = du * wd;
        uPar[k] = du * pwd;
        has[k] = 1;
      }
    }
    // tangent gradient of the detail from lattice differences: solve g·u = Du, g·v = Dv with g in span(u, v)
    const grad = (i: number, j: number, step: number, d: Float64Array, out: number[]): void => {
      const kp = ext(i + step, j), km = ext(i - step, j), lp = ext(i, j + step), lm = ext(i, j - step);
      if (!has[kp] || !has[km] || !has[lp] || !has[lm]) { out[0] = out[1] = out[2] = 0; return; }
      const ux = (dirs[kp * 3] - dirs[km * 3]) * radius, uy = (dirs[kp * 3 + 1] - dirs[km * 3 + 1]) * radius, uz = (dirs[kp * 3 + 2] - dirs[km * 3 + 2]) * radius;
      const vx = (dirs[lp * 3] - dirs[lm * 3]) * radius, vy = (dirs[lp * 3 + 1] - dirs[lm * 3 + 1]) * radius, vz = (dirs[lp * 3 + 2] - dirs[lm * 3 + 2]) * radius;
      const Du = d[kp] - d[km], Dv = d[lp] - d[lm];
      const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const det = uu * vv - uv * uv || 1e-12;
      const a = (Du * vv - Dv * uv) / det;
      const b = (Dv * uu - Du * uv) / det;
      out[0] = a * ux + b * vx; out[1] = a * uy + b * vy; out[2] = a * uz + b * vz;
    };

    const pos = new Float32Array(NVERT * 3);
    const aCells = new Float32Array(NVERT * 4);
    const aMisc = new Float32Array(NVERT * 4);
    const aGrad = new Float32Array(NVERT * 3);
    const aN1 = new Float32Array(NVERT * 4);
    const aN1m = new Float32Array(NVERT * 4);
    const aN1d = new Float32Array(NVERT * 3);
    const aN2 = new Float32Array(NVERT * 4);
    const aN2m = new Float32Array(NVERT * 4);
    const aN2d = new Float32Array(NVERT * 3);
    const aGradM = new Float32Array(NVERT * 3);
    const aGradD = new Float32Array(NVERT * 3);
    const aGradDM = new Float32Array(NVERT * 3);

    // per lattice point: cells / weights (own) — computed once, referenced by neighbours' morph targets
    const cellA = new Float32Array(NPTS), cellB = new Float32Array(NPTS), cellC = new Float32Array(NPTS);
    const wB = new Float32Array(NPTS), wC = new Float32Array(NPTS);
    const gPar = new Float32Array(NPTS * 3);
    const gParD = new Float32Array(NPTS * 3);
    const tmp = [0, 0, 0];
    for (let j = 0; j <= R; j++) {
      for (let i = 0; i + j <= R; i++) {
        const v = ptIndex(i, j);
        g.locateFaceCoords(p.face, fiOf(i, j), fjOf(i, j), _hit);
        cellA[v] = _hit.a; cellB[v] = _hit.b; cellC[v] = _hit.c;
        // locateFaceCoords returns (a, b, c, wa, wb, wc); shaders use wA = 1 − wB − wC
        wB[v] = _hit.wb; wC[v] = _hit.wc;
        if (((i | j) & 1) === 0) {
          grad(i, j, 2, dPar, tmp);
          gPar[v * 3] = tmp[0]; gPar[v * 3 + 1] = tmp[1]; gPar[v * 3 + 2] = tmp[2];
          grad(i, j, 2, uPar, tmp);
          gParD[v * 3] = tmp[0]; gParD[v * 3 + 1] = tmp[1]; gParD[v * 3 + 2] = tmp[2];
        }
      }
    }
    const writeVertex = (dst: number, i: number, j: number, skirt: number): void => {
      const v = ptIndex(i, j);
      const k = ext(i, j);
      pos[dst * 3] = dirs[k * 3]; pos[dst * 3 + 1] = dirs[k * 3 + 1]; pos[dst * 3 + 2] = dirs[k * 3 + 2];
      aCells[dst * 4] = cellA[v]; aCells[dst * 4 + 1] = cellB[v]; aCells[dst * 4 + 2] = cellC[v]; aCells[dst * 4 + 3] = wB[v];
      aMisc[dst * 4] = wC[v]; aMisc[dst * 4 + 1] = dOwn[k]; aMisc[dst * 4 + 2] = skirt; aMisc[dst * 4 + 3] = uOwn[k];
      grad(i, j, 1, dOwn, tmp);
      aGrad[dst * 3] = tmp[0]; aGrad[dst * 3 + 1] = tmp[1]; aGrad[dst * 3 + 2] = tmp[2];
      grad(i, j, 1, uOwn, tmp);
      aGradD[dst * 3] = tmp[0]; aGradD[dst * 3 + 1] = tmp[1]; aGradD[dst * 3 + 2] = tmp[2];
      const [i1, j1, i2, j2] = morphNeighbours(i, j);
      const v1 = ptIndex(i1, j1), v2 = ptIndex(i2, j2);
      const k1 = ext(i1, j1), k2 = ext(i2, j2);
      aN1[dst * 4] = cellA[v1]; aN1[dst * 4 + 1] = cellB[v1]; aN1[dst * 4 + 2] = cellC[v1]; aN1[dst * 4 + 3] = wB[v1];
      aN1m[dst * 4] = wC[v1]; aN1m[dst * 4 + 1] = dPar[k1]; aN1m[dst * 4 + 2] = uPar[k1];
      aN1d[dst * 3] = dirs[k1 * 3]; aN1d[dst * 3 + 1] = dirs[k1 * 3 + 1]; aN1d[dst * 3 + 2] = dirs[k1 * 3 + 2];
      aN2[dst * 4] = cellA[v2]; aN2[dst * 4 + 1] = cellB[v2]; aN2[dst * 4 + 2] = cellC[v2]; aN2[dst * 4 + 3] = wB[v2];
      aN2m[dst * 4] = wC[v2]; aN2m[dst * 4 + 1] = dPar[k2]; aN2m[dst * 4 + 2] = uPar[k2];
      aN2d[dst * 3] = dirs[k2 * 3]; aN2d[dst * 3 + 1] = dirs[k2 * 3 + 1]; aN2d[dst * 3 + 2] = dirs[k2 * 3 + 2];
      aGradM[dst * 3] = 0.5 * (gPar[v1 * 3] + gPar[v2 * 3]);
      aGradM[dst * 3 + 1] = 0.5 * (gPar[v1 * 3 + 1] + gPar[v2 * 3 + 1]);
      aGradM[dst * 3 + 2] = 0.5 * (gPar[v1 * 3 + 2] + gPar[v2 * 3 + 2]);
      aGradDM[dst * 3] = 0.5 * (gParD[v1 * 3] + gParD[v2 * 3]);
      aGradDM[dst * 3 + 1] = 0.5 * (gParD[v1 * 3 + 1] + gParD[v2 * 3 + 1]);
      aGradDM[dst * 3 + 2] = 0.5 * (gParD[v1 * 3 + 2] + gParD[v2 * 3 + 2]);
    };
    for (let j = 0; j <= R; j++) for (let i = 0; i + j <= R; i++) writeVertex(ptIndex(i, j), i, j, 0);
    for (let k = 0; k < NSKIRT; k++) writeVertex(NPTS + k, BOUNDARY[k][0], BOUNDARY[k][1], 1);
    // the distinct cells the vertices interpolate (morph targets are lattice points of this patch too)
    {
      const seen = new Set<number>();
      for (let v = 0; v < NPTS; v++) { seen.add(cellA[v]); seen.add(cellB[v]); seen.add(cellC[v]); }
      p.vcells = Int32Array.from(seen);
    }

    const geo = new BufferGeometry();
    const posAttr = new Float32BufferAttribute(pos, 3);
    geo.setAttribute('position', posAttr);
    // three r186 compiles a MeshStandardMaterial as FLAT_SHADED when the geometry has no `normal` attribute (one
    // face normal per render triangle from screen derivatives): the per-cell normals, the detail gradient and the
    // curved ground then never reach the lighting and the terrain shades as a triangle mosaic. The vertex shader
    // overrides objectNormal anyway (VERT_MAIN), so the unit `position` directions serve as the attribute — the
    // same buffer, no extra memory.
    geo.setAttribute('normal', posAttr);
    geo.setAttribute('aCells', new Float32BufferAttribute(aCells, 4));
    geo.setAttribute('aMisc', new Float32BufferAttribute(aMisc, 4));
    geo.setAttribute('aGrad', new Float32BufferAttribute(aGrad, 3));
    geo.setAttribute('aN1', new Float32BufferAttribute(aN1, 4));
    geo.setAttribute('aN1m', new Float32BufferAttribute(aN1m, 4));
    geo.setAttribute('aN1d', new Float32BufferAttribute(aN1d, 3));
    geo.setAttribute('aN2', new Float32BufferAttribute(aN2, 4));
    geo.setAttribute('aN2m', new Float32BufferAttribute(aN2m, 4));
    geo.setAttribute('aN2d', new Float32BufferAttribute(aN2d, 3));
    geo.setAttribute('aGradM', new Float32BufferAttribute(aGradM, 3));
    geo.setAttribute('aGradD', new Float32BufferAttribute(aGradD, 3));
    geo.setAttribute('aGradDM', new Float32BufferAttribute(aGradDM, 3));
    geo.setIndex(indexBuffer());
    geo.boundingSphere = p.sphere.clone();
    return geo;
  }

  /** the level's terrain (water = false) or water batch, made on first use */
  private batch(level: number, water: boolean): PatchBatch {
    const list = water ? this.wBatch : this.tBatch;
    let b = list[level];
    if (!b) {
      // (dry patches never take a water slot: the water pools start small)
      b = new PatchBatch(water ? this.mats.water(level) : this.mats.terrain(level), water ? 8 : 32, water ? 2 : 0, `${water ? 'water' : 'terrain'}-L${level}`);
      if (!water && this.castShadows) b.mesh.layers.enable(1);
      list[level] = b;
      this.group.add(b.mesh);
    }
    return b;
  }

  private ensureGeometry(p: Patch, budget: boolean): boolean {
    if (p.built) return true;
    if (budget && this.builtThisFrame >= this.buildBudgetNow) return false;
    this.updateBounds(p);
    const geo = this.buildGeometry(p);
    // now that the vertex cells are known, the exact water test (bounds were derived before the build)
    if (p.hasWater && p.vcells) p.hasWater = this.vertexWater(p.vcells, this.fields.surface, this.fields.waterLevel, this.fields.waterDepth);
    this.builtThisFrame++;
    this.built++;
    this.stats.builtTotal++;
    const tb = this.batch(p.level, false);
    p.tSlot = tb.alloc(geo);
    p.mesh = tb.mesh;
    // the water sheet is drawn from a copy of the same vertices in the level's water batch (water pass, layer 2)
    if (p.hasWater) p.wSlot = this.batch(p.level, true).alloc(geo);
    p.built = true;
    this.live.add(p);
    return true;
  }

  private buildBudgetNow = 16;

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.tBatch) {
      if (!b) continue;
      if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1);
    }
  }

  // ── selection ──

  /** radial occluder profile around the camera: prof[i] = the radius of the lowest VISIBLE surface within angle
   * (i + 1)·LOCAL_OCC/OCC_BINS of the camera — the ground, or the water over it (the water sheet is opaque and
   * depth-tested: whatever lies under the sea's horizon is hidden by the sea) — minus what the detail relief, dunes and
   * the curved ground can dig below the cells. A sight line from the camera to a point θ away never leaves the disc of
   * radius θ, so a sphere of radius prof(θ) is a valid occluder for everything within θ: each patch is tested against
   * the tightest sphere its own sight lines allow (recomputed as the camera moves ~25 m or the ground changes) */
  private occ = { prof: new Float64Array(OCC_BINS), x: 0, y: 0, z: 0, version: -1, valid: false };

  private updateLocalOccluder(cam: Vector3, rc: number): void {
    const L = this.occ;
    const s = this.fields.surface;
    if (!s || rc <= 0) { L.valid = false; return; }
    const ux = cam.x / rc, uy = cam.y / rc, uz = cam.z / rc;
    const moved = Math.hypot(ux - L.x, uy - L.y, uz - L.z) * this.radius;
    if (L.valid && L.version === this.fields.geomVersion && moved < 25) return;
    L.x = ux; L.y = uy; L.z = uz; L.version = this.fields.geomVersion;
    const G = this.fields.grad;
    const wl = this.fields.waterLevel, wd = this.fields.waterDepth;
    const P = this.grid.pos;
    const lo = L.prof;
    lo.fill(Infinity);
    let g2 = 0;
    // the cell's own extent: a cell a bin away may still reach into the nearer bin
    const half = this.grid.meanEdgeAngle * 0.6;
    for (const c of this.grid.cellsWithin(ux, uy, uz, LOCAL_OCC + 0.03)) {
      // (a wet cell's surface is its water level; the shore sheet thins out within a metre or so of its edge)
      const top = wd[c] > 0.5 ? Math.max(s[c], wl[c] - 1) : s[c];
      const th = Math.acos(Math.min(1, Math.max(-1, P[c * 3] * ux + P[c * 3 + 1] * uy + P[c * 3 + 2] * uz)));
      const b = Math.max(0, Math.min(OCC_BINS - 1, Math.floor(((th - half) / LOCAL_OCC) * OCC_BINS)));
      if (top < lo[b]) lo[b] = top;
      if (G) { const m = G[c * 4] * G[c * 4] + G[c * 4 + 1] * G[c * 4 + 1] + G[c * 4 + 2] * G[c * 4 + 2]; if (m > g2) g2 = m; }
    }
    const margin = 3 + curveMargin(this.grid, this.radius, Math.sqrt(g2));
    let run = Infinity;
    for (let i = 0; i < OCC_BINS; i++) { run = Math.min(run, lo[i]); lo[i] = run; }
    for (let i = 0; i < OCC_BINS; i++) lo[i] = Number.isFinite(lo[i]) ? this.radius + lo[i] - margin : 0;
    L.valid = true;
  }

  /** the occluder radius valid for sight lines that stay within angle th of the camera (0: none) */
  private occluderWithin(th: number): number {
    const L = this.occ;
    if (!L.valid || th > LOCAL_OCC) return 0;
    return L.prof[Math.min(OCC_BINS - 1, Math.max(0, Math.ceil((th / LOCAL_OCC) * OCC_BINS) - 1))];
  }

  select(ctx: ChunkSelectContext): Patch[] {
    this.builtThisFrame = 0;
    this.buildBudgetNow = ctx.buildBudget;
    this.stats.horizonCulled = 0;
    const out: Patch[] = [];
    const cam = ctx.camBody;
    const rc = cam.length();
    {
      const a = Math.min(1, Math.max(0, ((rc - this.radius) / this.radius - 0.08) / (0.35 - 0.08)));
      this.silK = SILHOUETTE_SPLIT * a * a * (3 - 2 * a);
    }
    // occluder: the lowest ground anywhere (conservative)
    let rOcc = this.radius;
    for (const r of this.roots) { this.updateBounds(r); rOcc = Math.min(rOcc, this.radius + r.hMin); }
    rOcc -= 5;
    // near the ground the planet's lowest point (the sea floor) makes a useless occluder: from 60 m up it leaves
    // ~1.5 km of ground beyond the true horizon "visible". The local occluder profile (updateLocalOccluder) gives each
    // patch the tightest valid sphere for its own sight lines and culls the far side of the horizon
    this.updateLocalOccluder(cam, rc);
    const visit = (p: Patch): void => {
      this.updateBounds(p);
      if (!this.aboveHorizon(p, cam, rc, rOcc)) { p.split = false; return; }
      {
        const cosT = Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc));
        const rLoc = this.occluderWithin(Math.acos(cosT) + p.angRadius);
        if (rLoc > rOcc && rc > rLoc && !this.aboveHorizon(p, cam, rc, rLoc)) { p.split = false; this.stats.horizonCulled++; return; }
      }
      _sphere.copy(p.sphere).applyMatrix4(ctx.bodyToWorld);
      if (!ctx.frustum.intersectsSphere(_sphere)) { p.split = false; return; }
      const d = this.boundDistance(p, cam, rc);
      // silhouette-aware: a patch seen edge-on (the limb from orbit, the horizon from the ground) shows its geometric
      // error as a straight-segmented outline, so it splits up to 3.5× earlier (cubic in the grazing: only patches
      // near the silhouette pay for it, not the whole disc). The vertex shader scales the morph
      // distance by the same factor per vertex (TERRAIN_VERT_CORE), so the geomorph still lands where the coarser
      // neighbour begins
      _pc.copy(p.centerDir).multiplyScalar(this.radius + 0.5 * (p.hMin + p.hMax)).sub(cam);
      const pcl = _pc.length();
      const facing = pcl > 1e-3 ? Math.abs(p.centerDir.dot(_pc) / pcl) : 1;
      const graze = 1 - facing;
      const sil = 1 + this.silK * graze * graze * graze;
      const rSplit = ctx.K * this.size(p.level) * (p.split ? 1.12 : 1.0) * sil;
      let split = p.level < this.maxLevel && d < rSplit;
      if (split) {
        const kids = p.makeChildren();
        // split only when every child can be drawn this frame (never mix a parent with partial children)
        for (const k of kids) if (!this.ensureGeometry(k, true)) { split = false; break; }
      }
      if (split) {
        p.split = true;
        for (const k of p.children!) visit(k);
      } else {
        p.split = false;
        if (this.ensureGeometry(p, p.level > 1)) out.push(p);
        else if (p.level <= 1) out.push(p);
      }
    };
    for (const r of this.roots) visit(r);
    // visibility per batch slot: last frame's patches off, this frame's on (a patch that turned wet since it was
    // built takes a water slot now, copied from its terrain slot; one that dried keeps its slot, hidden)
    for (const p of this.selected) this.showPatch(p, false, false);
    let water = 0;
    for (const p of out) {
      p.lastUsed = ctx.frame;
      if (!p.built) continue;
      const wet = this.waterEnabled && p.hasWater;
      if (wet && p.wSlot < 0) {
        const geo = this.batch(p.level, false).extract(p.tSlot);
        p.wSlot = this.batch(p.level, true).alloc(geo);
      }
      this.showPatch(p, true, wet);
      if (wet) water++;
    }
    this.selected = out;
    this.stats.patches = out.length;
    this.stats.waterPatches = water;
    this.evict(ctx.frame);
    return out;
  }

  /**
   * Shadow cascade k (lights.ts perCascade): leave out the selected patches lying wholly nearer than `nearDepth` along
   * the view direction (body frame) — the pixels there read a finer cascade, and the margin the caller folds into
   * nearDepth covers the shadows those patches throw further out. k < 0 restores every selected patch.
   */
  shadowCascade(k: number, camBody: Vector3, viewDirBody: Vector3, nearDepth: number, cascade?: Frustum, bodyToWorld?: Matrix4): number {
    let drawn = 0;
    for (const p of this.selected) {
      if (!p.built) continue;
      const tb = this.tBatch[p.level]!;
      if (k < 0) { tb.show(p.tSlot, true); drawn++; continue; }
      let on = true;
      if (nearDepth > 0) {
        const depthMax = (p.sphere.center.x - camBody.x) * viewDirBody.x + (p.sphere.center.y - camBody.y) * viewDirBody.y
          + (p.sphere.center.z - camBody.z) * viewDirBody.z + p.sphere.radius;
        on = depthMax >= nearDepth;
      }
      // (the batch is drawn whole: what lies outside this cascade's light box is left out here, as three's per-object
      // culling did for separate patch meshes)
      if (on && cascade && bodyToWorld) on = cascade.intersectsSphere(_sphere.copy(p.sphere).applyMatrix4(bodyToWorld));
      tb.show(p.tSlot, on);
      if (on) drawn++;
    }
    return drawn;
  }

  private showPatch(p: Patch, on: boolean, water: boolean): void {
    if (!p.built) return;
    this.tBatch[p.level]?.show(p.tSlot, on);
    if (p.wSlot >= 0) this.wBatch[p.level]?.show(p.wSlot, on && water);
  }

  /** draw counts of the batches (logical draws: one per non-empty level batch per pass) */
  batchStats(): { terrain: number; water: number } {
    let t = 0, w = 0;
    for (const b of this.tBatch) if (b && b.mesh.visible) t++;
    for (const b of this.wBatch) if (b && b.mesh.visible) w++;
    return { terrain: t, water: w };
  }

  /** drop geometry of long-unused patches when over the cache budget */
  private evict(frame: number): void {
    if (this.live.size <= this.maxCached) return;
    const cands = [...this.live].filter((p) => frame - p.lastUsed > 120 && p.level > 1).sort((a, b) => a.lastUsed - b.lastUsed);
    const drop = this.live.size - this.maxCached + 64;
    for (let i = 0; i < Math.min(drop, cands.length); i++) {
      const p = cands[i];
      this.tBatch[p.level]?.release(p.tSlot);
      if (p.wSlot >= 0) this.wBatch[p.level]?.release(p.wSlot);
      p.tSlot = -1; p.wSlot = -1; p.built = false; p.mesh = null;
      this.live.delete(p);
    }
  }

  /** morph distances for a level: (full-morph distance, morph start) — infinity for level 0 */
  morphRange(level: number, K: number): [number, number] {
    if (level === 0) return [1e30, 1e30];
    const r = K * this.size(level - 1);
    return [r, r * 0.72];
  }

  dispose(): void {
    for (const p of this.live) { p.built = false; p.mesh = null; p.tSlot = -1; p.wSlot = -1; }
    for (const b of [...this.tBatch, ...this.wBatch]) {
      if (!b) continue;
      this.group.remove(b.mesh);
      b.dispose();
    }
    this.tBatch = [];
    this.wBatch = [];
    this.live.clear();
  }
}

const _sphere = new Sphere();
