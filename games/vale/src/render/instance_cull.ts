// VALE render — scatter culled to what the camera can show (r12 B4 "cull clutter and grass to the camera
// trapezoid + 4 m", "one instanced draw per chunk"). Presentation only.
//
// A CellInstances holds every instance of one geometry, bucketed into CELL-sized ground cells (each cell's
// instances contiguous, in their original order). Each frame `cull` tests every cell's bounding sphere against the
// view frustum (+ `margin`), and — for shadow casters — the sphere grown along the sun's ground offset so a caster
// whose shadow can land in view still draws into the shadow map. The visible cells' matrices (and colours) are
// copied into ONE InstancedMesh (`count` = the visible instances): one draw per geometry for the main pass and one
// for the shadow pass, however many cells are in view. The copy (and its upload) only happens when the visible set
// changes; a still or slow camera costs ~a hundred sphere tests a frame.
//
// LOD (optional, Dialwood): a cell whose centre is farther than `lod.dist` from the camera focus, or that only casts
// a shadow into view (not visible itself), draws the `lod.geometry` instead (a second mesh with the same material).

import {
  type BufferGeometry, DynamicDrawUsage, type Frustum, InstancedBufferAttribute, InstancedMesh, type Material, type Matrix4, Sphere,
  type Color,
} from 'three';

export interface CullView {
  frustum: Frustum;
  /** the camera's ground focus (x, z) */
  fx: number; fz: number;
  /** a shadow's ground offset per metre of caster height (−sun.xz / sun.y; 0, 0 = no shadow reach) */
  sdx: number; sdz: number;
}

interface Cell { s: Sphere; top: number; start: number; n: number }

const _s = new Sphere();

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
  private readonly mats: Float32Array;
  private readonly cols: Float32Array | null;
  private readonly margin: number;
  private readonly shadows: boolean;
  private readonly lodDist: number;
  /** visible cells of the last cull (near list, then a −1 separator, then the LOD list) */
  private last: number[] = [];
  private readonly next: number[] = [];

  constructor(geo: BufferGeometry, mat: Material, items: readonly { m: Matrix4; c?: Color }[], o: CellInstancesOptions) {
    const CELL = o.cell ?? 4;
    this.margin = o.margin ?? 4;
    this.shadows = o.shadows ?? true;
    this.lodDist = o.lod?.dist ?? Infinity;
    // bucket by cell, keeping the original order inside each cell
    const buckets = new Map<string, number[]>();
    items.forEach((it, i) => {
      const k = `${Math.floor(it.m.elements[12] / CELL)}:${Math.floor(it.m.elements[14] / CELL)}`;
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(i);
    });
    const n = items.length;
    const hasCol = items.some((it) => !!it.c);
    this.mats = new Float32Array(n * 16);
    this.cols = hasCol ? new Float32Array(n * 3) : null;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const gs = geo.boundingSphere!;
    let w = 0;
    for (const list of buckets.values()) {
      const cell: Cell = { s: new Sphere(), top: 0, start: w, n: list.length };
      let first = true;
      for (const i of list) {
        const it = items[i];
        it.m.toArray(this.mats, w * 16);
        if (this.cols) { const c = it.c; this.cols[w * 3] = c ? c.r : 1; this.cols[w * 3 + 1] = c ? c.g : 1; this.cols[w * 3 + 2] = c ? c.b : 1; }
        _s.copy(gs).applyMatrix4(it.m);
        if (first) { cell.s.copy(_s); first = false; } else cell.s.union(_s);
        cell.top = Math.max(cell.top, _s.center.y + _s.radius);
        w++;
      }
      this.cells.push(cell);
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
      if (o.depth) im.customDepthMaterial = o.depth;
      im.renderOrder = o.renderOrder ?? 0;
      return im;
    };
    this.mesh = make(geo, o.name);
    this.lodMesh = o.lod ? make(o.lod.geometry, `${o.name}_lod`) : null;
  }

  get size(): number { return this.mats.length / 16; }

  /** pick the cells this frame can show (or shadow into) and refill the instance buffers when the set changed;
   *  null = every cell at full detail (the menu world's free camera) */
  cull(v: CullView | null): void {
    const next = this.next;
    next.length = 0;
    const lodList: number[] = [];
    const sl = v ? Math.hypot(v.sdx, v.sdz) : 0, m = this.margin;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (!v) { next.push(i); continue; }
      _s.center.copy(c.s.center);
      _s.radius = c.s.radius + m;
      let seen = v.frustum.intersectsSphere(_s);
      let shadowOnly = false;
      if (!seen && this.shadows && sl > 0) {
        // the shadow lands up to top × offset away along the sun's ground direction (falling to y 0 at worst)
        const k = c.top * 0.5;
        _s.center.set(c.s.center.x + v.sdx * k, Math.min(c.s.center.y, c.top * 0.5), c.s.center.z + v.sdz * k);
        _s.radius = c.s.radius + sl * k + m;
        seen = shadowOnly = v.frustum.intersectsSphere(_s);
      }
      if (!seen) continue;
      if (this.lodMesh && (shadowOnly || Math.hypot(c.s.center.x - v.fx, c.s.center.z - v.fz) > this.lodDist)) lodList.push(i);
      else next.push(i);
    }
    next.push(-1, ...lodList);
    const last = this.last;
    let same = last.length === next.length;
    for (let i = 0; same && i < next.length; i++) same = last[i] === next[i];
    if (same) return;
    this.last = next.slice();
    const sep = next.indexOf(-1);
    this.fill(this.mesh, next, 0, sep);
    if (this.lodMesh) this.fill(this.lodMesh, next, sep + 1, next.length);
  }

  /** copy the listed cells (list[from..to)) into `im` and mark the used range for upload */
  private fill(im: InstancedMesh, list: readonly number[], from: number, to: number): void {
    const ma = im.instanceMatrix.array as Float32Array, ca = im.instanceColor ? (im.instanceColor.array as Float32Array) : null;
    let k = 0;
    for (let j = from; j < to; j++) {
      const c = this.cells[list[j]];
      ma.set(this.mats.subarray(c.start * 16, (c.start + c.n) * 16), k * 16);
      if (ca && this.cols) ca.set(this.cols.subarray(c.start * 3, (c.start + c.n) * 3), k * 3);
      k += c.n;
    }
    im.count = k;
    im.visible = k > 0;
    im.instanceMatrix.clearUpdateRanges();
    im.instanceMatrix.addUpdateRange(0, Math.max(1, k) * 16);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) { im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, Math.max(1, k) * 3); im.instanceColor.needsUpdate = true; }
  }

  dispose(): void { this.mesh.dispose(); this.lodMesh?.dispose(); }
}

