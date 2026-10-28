// VALE render — scatter culled to what the camera can show (r12 B4 "cull clutter and grass to the camera
// trapezoid + 4 m", "one instanced draw per chunk", "Dialwood LOD"). Presentation only.
//
// A CellInstances holds every instance of one geometry, bucketed into CELL-sized ground cells (each cell's
// instances contiguous, in their original order). Each frame `cull` tests every cell's bounding sphere against the
// view frustum (+ `margin`) and, for shadow casters, the sphere grown along the sun's ground offset, so a caster
// whose shadow can land in view still draws into the shadow map. The cells it keeps are copied into ONE
// InstancedMesh: one draw per geometry for the main pass and one for the shadow pass, however many cells are in
// view. The copy (and its upload) only happens when the kept set changes; a still or slow camera costs a few
// hundred sphere tests a frame.
//
// Per pass: a cell that only SHADOWS into view sits at the end of the instance list, and the mesh's `count` is
// set per pass (onBeforeRender: the visible instances only; onBeforeShadow: all of them), so a shadow-only
// caster never costs the main pass a vertex.
// LOD (Dialwood): shadow-only cells, and visible cells farther than `lod.dist` from the camera focus, draw the
// `lod.geometry` instead (a second mesh, same material and attribute layout, so the same programs).

import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, type Frustum, InstancedBufferAttribute, InstancedMesh, type Material, type Matrix4,
  Sphere, type Color,
} from 'three';
import { shadowDepth } from './ink.ts';

export interface CullView {
  frustum: Frustum;
  /** the camera's ground focus (x, z) */
  fx: number; fz: number;
  /** a shadow's ground offset per metre of caster height (−sun.xz / sun.y; 0, 0 = no shadow reach) */
  sdx: number; sdz: number;
  /** bumped whenever any of the above changed: a set already culled for this version skips the work */
  version: number;
}

interface Cell { s: Sphere; top: number; start: number; n: number }
/** BLOCK × BLOCK cells: tested first, so a frame tests a few dozen blocks and only the cells of the ones in reach */
interface Block { s: Sphere; top: number; c0: number; c1: number }
const BLOCK = 8;
/** an instance buffer's split: [0, main) drawn in the main pass, [0, all) in the shadow pass */
interface Split { main: number; all: number }

const _s = new Sphere();
/** the frustum's six planes (nx, ny, nz, d) flattened for the inner loop */
const _P = new Float64Array(24);
function planesOf(f: Frustum): Float64Array {
  for (let i = 0; i < 6; i++) { const p = f.planes[i]; _P[i * 4] = p.normal.x; _P[i * 4 + 1] = p.normal.y; _P[i * 4 + 2] = p.normal.z; _P[i * 4 + 3] = p.constant; }
  return _P;
}
/** Frustum.intersectsSphere on the flattened planes */
function hits(P: Float64Array, x: number, y: number, z: number, r: number): boolean {
  for (let i = 0; i < 24; i += 4) if (P[i] * x + P[i + 1] * y + P[i + 2] * z + P[i + 3] < -r) return false;
  return true;
}

export interface CellInstancesOptions {
  name: string;
  cell?: number;
  margin?: number;
  shadows?: boolean;
  depth?: Material;
  renderOrder?: number;
  lod?: { geometry: BufferGeometry; dist: number } | null;
}

export class CellInstances {
  readonly mesh: InstancedMesh;
  readonly lodMesh: InstancedMesh | null;
  private readonly cells: Cell[] = [];
  private readonly blocks: Block[] = [];
  private readonly mats: Float32Array;
  private readonly cols: Float32Array | null;
  private readonly margin: number;
  private readonly shadows: boolean;
  private readonly lodDist: number;
  /** the kept cells of the last cull, as one key list (near · −1 · shadow-only · −2 · far · −3 · LOD shadow-only) */
  private last: number[] = [];
  private readonly next: number[] = [];
  private readonly near: number[] = [];
  private readonly shade: number[] = [];
  private readonly far: number[] = [];
  private readonly farShade: number[] = [];

  constructor(geo: BufferGeometry, mat: Material, items: readonly { m: Matrix4; c?: Color }[], o: CellInstancesOptions) {
    const CELL = o.cell ?? 4;
    this.margin = o.margin ?? 4;
    this.shadows = o.shadows ?? true;
    this.lodDist = o.lod?.dist ?? Infinity;
    // bucket by cell, keeping the original order inside each cell; cells grouped by block
    const blockOf = new Map<string, Map<string, number[]>>();
    items.forEach((it, i) => {
      const cx = Math.floor(it.m.elements[12] / CELL), cz = Math.floor(it.m.elements[14] / CELL);
      const bk = `${Math.floor(cx / BLOCK)}:${Math.floor(cz / BLOCK)}`, k = `${cx}:${cz}`;
      let cellsOf = blockOf.get(bk);
      if (!cellsOf) { cellsOf = new Map(); blockOf.set(bk, cellsOf); }
      let b = cellsOf.get(k);
      if (!b) { b = []; cellsOf.set(k, b); }
      b.push(i);
    });
    const n = items.length;
    const hasCol = items.some((it) => !!it.c);
    this.mats = new Float32Array(n * 16);
    this.cols = hasCol ? new Float32Array(n * 3) : null;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const gs = geo.boundingSphere!;
    let w = 0;
    for (const cellsOf of blockOf.values()) {
      const block: Block = { s: new Sphere(), top: 0, c0: this.cells.length, c1: this.cells.length };
      for (const list of cellsOf.values()) {
        const cell: Cell = { s: new Sphere(), top: 0, start: w, n: list.length };
        list.forEach((i, j) => {
          const it = items[i];
          it.m.toArray(this.mats, w * 16);
          if (this.cols) { const c = it.c; this.cols[w * 3] = c ? c.r : 1; this.cols[w * 3 + 1] = c ? c.g : 1; this.cols[w * 3 + 2] = c ? c.b : 1; }
          _s.copy(gs).applyMatrix4(it.m);
          if (j === 0) cell.s.copy(_s); else cell.s.union(_s);
          cell.top = Math.max(cell.top, _s.center.y + _s.radius);
          w++;
        });
        if (block.c1 === block.c0) block.s.copy(cell.s); else block.s.union(cell.s);
        block.top = Math.max(block.top, cell.top);
        this.cells.push(cell);
        block.c1 = this.cells.length;
      }
      this.blocks.push(block);
    }
    const make = (g: BufferGeometry, name: string): InstancedMesh => {
      const im = new InstancedMesh(g, mat, Math.max(1, n));
      im.name = name;
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      if (this.cols) { im.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3); im.instanceColor.setUsage(DynamicDrawUsage); }
      im.count = 0;
      im.visible = false;
      im.frustumCulled = false;                     // culled here, per cell
      im.castShadow = this.shadows; im.receiveShadow = true;
      // the shadow pass draws through the ink program (ink.ts), never three's MeshDepthMaterial variants
      im.customDepthMaterial = o.depth ?? shadowDepth('rigid', true);
      im.renderOrder = o.renderOrder ?? 0;
      const split: Split = { main: 0, all: 0 };
      im.userData.split = split;
      // the draw reads `count` after these hooks (three renderObject / WebGLShadowMap): main pass the visible
      // instances, shadow pass all of them (a zero count draws nothing)
      im.onBeforeRender = () => { im.count = split.main; };
      im.onBeforeShadow = () => { im.count = split.all; };
      return im;
    };
    this.mesh = make(geo, o.name);
    this.lodMesh = o.lod ? make(o.lod.geometry, `${o.name}_lod`) : null;
  }

  get size(): number { return this.mats.length / 16; }

  /** keep the cells this frame can show (or shadow into) and refill the instance buffers when the set changed;
   *  null = every cell at full detail (the menu world's free camera) */
  cull(v: CullView | null): void {
    const { near, shade, far, farShade } = this;
    near.length = shade.length = far.length = farShade.length = 0;
    const lod = !!this.lodMesh;
    const sl = v ? Math.hypot(v.sdx, v.sdz) : 0, m = this.margin, sh = this.shadows && sl > 0;
    const P = v ? planesOf(v.frustum) : _P, sdx = v ? v.sdx : 0, sdz = v ? v.sdz : 0;
    /** 2 in view (+ margin), 1 only its shadow can reach the view, 0 neither */
    const reach = (sp: Sphere, top: number): 0 | 1 | 2 => {
      const c = sp.center;
      if (hits(P, c.x, c.y, c.z, sp.radius + m)) return 2;
      if (!sh) return 0;
      // the shadow lands up to top × offset away along the sun's ground direction (falling to y 0 at worst)
      const k = top * 0.5;
      return hits(P, c.x + sdx * k, Math.min(c.y, k), c.z + sdz * k, sp.radius + sl * k + m) ? 1 : 0;
    };
    for (const b of this.blocks) {
      if (v && reach(b.s, b.top) === 0) continue;
      for (let i = b.c0; i < b.c1; i++) {
        const c = this.cells[i];
        if (!v) { near.push(i); continue; }
        const r = reach(c.s, c.top);
        if (r === 2) (lod && Math.hypot(c.s.center.x - v.fx, c.s.center.z - v.fz) > this.lodDist ? far : near).push(i);
        else if (r === 1) (lod ? farShade : shade).push(i);
      }
    }
    const next = this.next;
    next.length = 0;
    next.push(...near, -1, ...shade, -2, ...far, -3, ...farShade);
    const last = this.last;
    let same = last.length === next.length;
    for (let i = 0; same && i < next.length; i++) same = last[i] === next[i];
    if (same) return;
    this.last = next.slice();
    this.fill(this.mesh, near, shade);
    if (this.lodMesh) this.fill(this.lodMesh, far, farShade);
  }

  /** copy the main-pass cells, then the shadow-only ones, into `im`; set its per-pass split; mark the upload */
  private fill(im: InstancedMesh, main: readonly number[], shadowOnly: readonly number[]): void {
    const ma = im.instanceMatrix.array as Float32Array, ca = im.instanceColor ? (im.instanceColor.array as Float32Array) : null;
    let k = 0;
    const copy = (list: readonly number[]): void => {
      for (const i of list) {
        const c = this.cells[i];
        ma.set(this.mats.subarray(c.start * 16, (c.start + c.n) * 16), k * 16);
        if (ca && this.cols) ca.set(this.cols.subarray(c.start * 3, (c.start + c.n) * 3), k * 3);
        k += c.n;
      }
    };
    copy(main);
    const split = im.userData.split as Split;
    split.main = k;
    copy(shadowOnly);
    split.all = k;
    im.count = k;
    im.visible = k > 0;
    im.instanceMatrix.clearUpdateRanges();
    im.instanceMatrix.addUpdateRange(0, Math.max(1, k) * 16);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) { im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, Math.max(1, k) * 3); im.instanceColor.needsUpdate = true; }
  }

  dispose(): void { this.mesh.dispose(); this.lodMesh?.dispose(); }
}

/**
 * A low-detail copy of a prop for its LOD (vertex clustering): vertices snap into the finest grid that keeps the
 * triangle count ≤ `maxTris`, each cluster at the mean of its vertices (colour and gloss averaged too), degenerate
 * and repeated triangles dropped, normals recomputed. Same attributes and item sizes as the source (position,
 * normal, color), so it shares the source's programs. Deterministic.
 */
export function decimate(src: BufferGeometry, maxTris: number): BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.getAttribute('position') as BufferAttribute;
  const col = g.getAttribute('color') as BufferAttribute | undefined;
  const nTri = Math.floor(pos.count / 3);
  if (nTri <= maxTris) { if (g !== src) g.dispose(); return src.clone(); }
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z, 1e-3);
  const cs = col ? col.itemSize : 0;
  const build = (h: number): { tris: number[][]; cp: Float32Array; cc: Float32Array | null } => {
    const id = new Map<string, number>();
    const sum: number[] = [], csum: number[] = [], cnt: number[] = [];
    const vid = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const key = `${Math.floor((x - bb.min.x) / h)},${Math.floor((y - bb.min.y) / h)},${Math.floor((z - bb.min.z) / h)}`;
      let k = id.get(key);
      if (k === undefined) { k = cnt.length; id.set(key, k); cnt.push(0); sum.push(0, 0, 0); for (let c = 0; c < cs; c++) csum.push(0); }
      cnt[k]++; sum[k * 3] += x; sum[k * 3 + 1] += y; sum[k * 3 + 2] += z;
      for (let c = 0; c < cs; c++) csum[k * cs + c] += col!.getComponent(i, c);
      vid[i] = k;
    }
    const seen = new Set<string>();
    const tris: number[][] = [];
    for (let t = 0; t < nTri; t++) {
      const a = vid[t * 3], b = vid[t * 3 + 1], c = vid[t * 3 + 2];
      if (a === b || b === c || a === c) continue;
      const key = [a, b, c].sort((p, q) => p - q).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      tris.push([a, b, c]);
    }
    const cp = new Float32Array(cnt.length * 3), cc = cs ? new Float32Array(cnt.length * cs) : null;
    for (let k = 0; k < cnt.length; k++) {
      for (let c = 0; c < 3; c++) cp[k * 3 + c] = sum[k * 3 + c] / cnt[k];
      if (cc) for (let c = 0; c < cs; c++) cc[k * cs + c] = csum[k * cs + c] / cnt[k];
    }
    return { tris, cp, cc };
  };
  // the finest grid that meets the budget (bisection on the cell size)
  let lo = ext / 256, hi = ext / 2, best = build(hi);
  for (let it = 0; it < 18; it++) {
    const mid = (lo + hi) / 2, r = build(mid);
    if (r.tris.length <= maxTris) { best = r; hi = mid; } else lo = mid;
  }
  const n = best.tris.length;
  const p = new Float32Array(n * 9), c = cs ? new Float32Array(n * 3 * cs) : null;
  best.tris.forEach((t, i) => {
    for (let v = 0; v < 3; v++) {
      p.set(best.cp.subarray(t[v] * 3, t[v] * 3 + 3), (i * 3 + v) * 3);
      if (c && best.cc) c.set(best.cc.subarray(t[v] * cs, t[v] * cs + cs), (i * 3 + v) * cs);
    }
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(p, 3));
  if (c) out.setAttribute('color', new BufferAttribute(c, cs));
  out.computeVertexNormals();
  if (g !== src) g.dispose();
  return out;
}

/**
 * Split a large static mesh into CELL-sized ground chunks (triangles by centroid, attributes copied, nothing
 * moved), so three's own frustum test drops the chunks the view and the shadow map cannot see (r12 B4: the
 * cliffs were one 55k-triangle draw in both passes wherever the camera stood). Same vertices, same pixels.
 * A triangle longer than a cell (a border wall's cap spans the map) would blow its chunk's bounds up to the whole
 * map: those (a few hundred) share one chunk of their own.
 */
export function splitGeometry(src: BufferGeometry, cell: number): BufferGeometry[] {
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.getAttribute('position') as BufferAttribute;
  const nTri = Math.floor(pos.count / 3);
  const buckets = new Map<string, number[]>();
  const edge = (a: number, b: number): number => Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
  for (let t = 0; t < nTri; t++) {
    const x = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3;
    const z = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
    const long = Math.max(edge(t * 3, t * 3 + 1), edge(t * 3 + 1, t * 3 + 2), edge(t * 3 + 2, t * 3)) > cell;
    const k = long ? 'long' : `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(t);
  }
  const out: BufferGeometry[] = [];
  for (const tris of buckets.values()) {
    const part = new BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes) as [string, BufferAttribute][]) {
      const s = attr.itemSize, src3 = attr.array as Float32Array;
      const a = new (src3.constructor as Float32ArrayConstructor)(tris.length * 3 * s);
      tris.forEach((t, i) => a.set(src3.subarray(t * 3 * s, (t + 1) * 3 * s), i * 3 * s));
      part.setAttribute(name, new BufferAttribute(a, s, attr.normalized));
    }
    part.computeBoundingSphere();
    out.push(part);
  }
  if (g !== src) g.dispose();
  return out;
}
