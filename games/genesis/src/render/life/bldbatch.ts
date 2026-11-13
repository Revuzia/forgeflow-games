// GENESIS — one batch of building geometry (CONTRACT.md §15.6, §20 perf): three's BatchedMesh (WEBGL_multi_draw where
// the browser has it) holding every variant / prop / scaffold / rubble mesh that shares a material and a shadow role,
// drawn in ONE call. A city view had ~280 InstancedMeshes (one per household variant and LOD), ~90 % of its draws.
//
//   * Geometries are added on first use into fixed-size pages (PERF F21) and stay; a per-building geometry (a
//     market paving draped on its own ground, the earthworks under a house on a slope) can be dropped again.
//   * Instances: each full rewrite fills slots 0..n−1 in order (an existing slot takes the new geometry id, the rest
//     are hidden), so nothing is allocated per frame once the town is in.
//   * The per-instance state the building shader reads (iState, iInfo, iFade — see buildingmat.ts) lives in a float
//     texture beside three's matrix and colour textures, 3 texels per instance, read by the instance's batch id.
//   * Per-object frustum culling (also against each shadow cascade's light box) and front-to-back sorting are three's.

import {
  BatchedMesh, BufferGeometry, Color, Frustum, Sphere, DataTexture, Float32BufferAttribute, FloatType, Group, Layers, Matrix4, NearestFilter, RGBAFormat,
  type IUniform, type Material, type MeshStandardMaterial, type ShaderMaterial,
} from 'three';
import { BLD_INST_PER_ROW, makeBuildingDepthMaterial, makeBuildingMaterial } from './buildingmat.ts';
import { perfSwitch } from '../perfswitch.ts';
import { ringIntercept } from '../bufring.ts';

/** PERF F21 (session 9): geometry PAGES of a fixed size instead of one batch whose buffers double; `?bldpage=0` = old */
const PAGED = perfSwitch('bldpage');
/** slot / geometry ids handed out are page * STRIDE + the page's own id */
const STRIDE = 1 << 20;

/**
 * One page of a batch: a BatchedMesh whose vertex / index buffers have a FIXED size (never setGeometrySize), with its
 * own instances, per-instance state texture and materials (the same program: one cache key).
 */
export class BldPage {
  readonly mesh: BatchedMesh;
  readonly material: MeshStandardMaterial;
  readonly depth: ShaderMaterial;
  readonly vCap: number;
  readonly iCap: number;
  private texU: IUniform<DataTexture>;
  private data: Float32Array;
  private rows: number;
  private instCap: number;
  /** live geometry ids (not the zombie) */
  readonly ids = new Set<number>();
  /** a dropped geometry kept because it was the page's last (three deletes the instances of a deleted geometry) */
  zombie = -1;
  /** reserved vertices / indices of every active geometry (zombie included) */
  liveV = 0;
  liveI = 0;
  used = 0;
  private shown = 0;
  private made = 0;
  private sph: Float32Array;
  private hid: Uint8Array;
  private bs = new Map<number, Sphere>();

  constructor(name: string, shared: Record<string, IUniform>, cut: boolean, instCap: number, vCap: number, iCap: number) {
    this.instCap = instCap;
    this.vCap = vCap;
    this.iCap = iCap;
    this.rows = Math.ceil(instCap / BLD_INST_PER_ROW);
    this.sph = new Float32Array(instCap * 4);
    this.hid = new Uint8Array(instCap);
    this.data = new Float32Array(BLD_INST_PER_ROW * 3 * 4 * this.rows);
    const tex = new DataTexture(this.data, BLD_INST_PER_ROW * 3, this.rows, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    this.texU = { value: tex };
    this.material = makeBuildingMaterial(shared, cut, this.texU);
    this.depth = makeBuildingDepthMaterial(shared, this.texU);
    const m = new BatchedMesh(instCap, vCap, iCap, this.material);
    m.name = name;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.perObjectFrustumCulled = true;
    m.sortObjects = true;
    m.visible = false;
    m.userData.cut = cut;
    this.mesh = m;
    // PERF F19 (session 8): three's BatchedMesh.onBeforeRender compacts the visible, unculled instances into a
    // draw -> instance table (a DataTexture) at EVERY pass — the scene, each shadow cascade (whose cull hides other
    // instances) — and re-uploads it in the middle of that render pass: on ANGLE-Metal each upload of a texture already
    // sampled in the open pass ends the pass (store + reload of the 4096² atlas / the MSAA HDR target), 4 batches x
    // 5-6 passes a frame. Here draw i is always instance i: the table is the identity, uploaded once (again after a
    // grow re-creates it), and an instance that is hidden or outside the pass's frustum gets an empty draw (count 0)
    // in the multi-draw lists — CPU arrays passed with the call. The same instances are drawn (same per-object
    // frustum test, on the same bounding spheres); only three's front-to-back draw order is gone (opaque and depth-
    // tested: the same image).
    m.onBeforeRender = (_r, _s, camera, geometry) => this.prepareDraws(camera, geometry);
  }

  private ringed = false;
  fits(nv: number, ni: number): boolean { return this.mesh.unusedVertexCount >= nv && this.mesh.unusedIndexCount >= ni; }

  /** after compaction the geometry would fit */
  fitsCompacted(nv: number, ni: number): boolean { return this.vCap - this.liveV >= nv && this.iCap - this.liveI >= ni; }

  /** reserved but dead vertices (space a compaction would give back) */
  deadV(): number { return (this.vCap - this.mesh.unusedVertexCount) - this.liveV; }

  addGeom(geo: BufferGeometry, nv: number, ni: number): number {
    const id = this.mesh.addGeometry(geo);
    // (PERF s16) buildings land in pages drawn every frame (a whole-page copy per attribute on ANGLE-Metal): the page's
    // buffers are a ring of 3 (bufring.ts; three's own addUpdateRange calls feed it), made once the attributes exist
    if (!this.ringed) { this.ringed = true; ringIntercept(this.mesh.geometry); }
    this.bs.delete(id);
    this.ids.add(id);
    this.liveV += nv; this.liveI += ni;
    if (this.zombie >= 0) { this.repoint(this.zombie, id); this.delete(this.zombie); this.zombie = -1; }
    return id;
  }

  /** forget geometry `id`: its instances are re-pointed (hidden until the next rewrite), its space freed */
  dropGeom(id: number): void {
    if (!this.ids.delete(id)) return;
    let other = this.zombie;
    for (const g of this.ids) { other = g; break; }
    if (other < 0) { this.zombie = id; this.repoint(id, id); return; }
    this.repoint(id, other);
    this.delete(id);
  }

  private delete(id: number): void {
    const gi = (this.mesh as unknown as { _geometryInfo: { reservedVertexCount: number; reservedIndexCount: number }[] })._geometryInfo[id];
    this.liveV -= gi.reservedVertexCount;
    this.liveI -= Math.max(0, gi.reservedIndexCount);
    this.mesh.deleteGeometry(id);
    this.bs.delete(id);
  }

  private repoint(from: number, to: number): void {
    const info = (this.mesh as unknown as { _instanceInfo: { geometryIndex: number; active: boolean }[] })._instanceInfo;
    for (let i = 0; i < info.length; i++) {
      if (!info[i].active || info[i].geometryIndex !== from) continue;
      if (to !== from) this.mesh.setGeometryIdAt(i, to);
      this.mesh.setVisibleAt(i, false);
      if (i < this.hid.length) this.hid[i] = 2;
    }
  }

  /** old path (?bldpage=0): grow the buffers by doubling (new, bigger GPU buffers) */
  grow(nv: number, ni: number): void {
    let vc = this.vCap, ic = this.iCap;
    const vu = vc - this.mesh.unusedVertexCount, iu = ic - this.mesh.unusedIndexCount;
    while (vu + nv > vc) vc *= 2;
    while (iu + ni > ic) ic *= 2;
    this.mesh.setGeometrySize(vc, ic);
    this.ringed = false;
    (this as { vCap: number }).vCap = vc; (this as { iCap: number }).iCap = ic;
  }

  begin(): void { this.used = 0; }

  add(gid: number, m: Matrix4, color: Color, s0: number, s1: number, s2: number, s3: number, i0: number, i1: number, i2: number, i3: number, f0: number, f1: number, f2: number): number {
    const i = this.used++;
    if (i >= this.instCap) this.growInstances(i + 1);
    const mesh = this.mesh;
    if (i < this.made) {
      mesh.setGeometryIdAt(i, gid);
      mesh.setVisibleAt(i, true);
    } else {
      mesh.addInstance(gid);
      this.made++;
    }
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color);
    this.hid[i] = 0;
    {
      let bs = this.bs.get(gid);
      if (!bs) { bs = this.mesh.getBoundingSphereAt(gid, new Sphere()) ?? new Sphere(); this.bs.set(gid, bs); }
      const e = m.elements, c = bs.center, q = i * 4;
      const sc = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
      this.sph[q] = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12];
      this.sph[q + 1] = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13];
      this.sph[q + 2] = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
      this.sph[q + 3] = bs.radius * sc;
    }
    const o = this.offset(i);
    const d = this.data;
    d[o] = s0; d[o + 1] = s1; d[o + 2] = s2; d[o + 3] = s3;
    d[o + 4] = i0; d[o + 5] = i1; d[o + 6] = i2; d[o + 7] = i3;
    d[o + 8] = f0; d[o + 9] = f1; d[o + 10] = f2; d[o + 11] = 0;
    return i;
  }

  setState(i: number, s0: number, s1: number, s2: number, s3: number): void {
    if (i < 0 || i >= this.used) return;
    const o = this.offset(i);
    const d = this.data;
    d[o] = s0; d[o + 1] = s1; d[o + 2] = s2; d[o + 3] = s3;
    this.texU.value.needsUpdate = true;
  }

  cullShadow(keep: (x: number, y: number, z: number, r: number) => boolean): number {
    let drawn = 0;
    const sph = this.sph, hid = this.hid, mesh = this.mesh;
    for (let i = 0; i < this.used; i++) {
      if (hid[i] === 2) continue;
      const q = i * 4;
      const on = keep(sph[q], sph[q + 1], sph[q + 2], sph[q + 3]);
      if (on) drawn++;
      if (on && hid[i] === 1) { mesh.setVisibleAt(i, true); hid[i] = 0; } else if (!on && hid[i] === 0) { mesh.setVisibleAt(i, false); hid[i] = 1; }
    }
    return drawn;
  }

  uncull(): void {
    const hid = this.hid, mesh = this.mesh;
    for (let i = 0; i < this.used; i++) if (hid[i] === 1) { mesh.setVisibleAt(i, true); hid[i] = 0; }
  }

  end(): void {
    const mesh = this.mesh;
    for (let i = this.used; i < this.shown; i++) mesh.setVisibleAt(i, false);
    if (this.used === 0 && this.shown === 0 && !mesh.visible) return;
    this.shown = this.used;
    mesh.visible = this.used > 0;
    this.texU.value.needsUpdate = true;
  }

  private tableTex: unknown = null;
  private tableN = 0;
  private readonly frustum = new Frustum();
  private readonly fm = new Matrix4();
  private readonly fs = new Sphere();

  /** PERF F19: this pass's multi-draw lists over an identity draw -> instance table (see the constructor) */
  private prepareDraws(camera: { projectionMatrix: Matrix4; matrixWorldInverse: Matrix4 }, geometry: BufferGeometry): void {
    const mesh = this.mesh as unknown as {
      _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
      _geometryInfo: { start: number; count: number }[];
      _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number; _multiDrawBytesPerElement: number;
      _indirectTexture: DataTexture; _visibilityChanged: boolean; perObjectFrustumCulled: boolean; matrixWorld: Matrix4;
    };
    const info = mesh._instanceInfo, gi = mesh._geometryInfo, starts = mesh._multiDrawStarts, counts = mesh._multiDrawCounts;
    const tex = mesh._indirectTexture;
    const n = Math.min(info.length, starts.length);
    if (this.tableTex !== tex || this.tableN < n) {
      const arr = tex.image.data as Uint32Array;
      for (let i = 0; i < arr.length; i++) arr[i] = i;
      tex.needsUpdate = true;
      this.tableTex = tex;
      this.tableN = arr.length;
    }
    const index = geometry.getIndex();
    const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    const cull = mesh.perObjectFrustumCulled;
    if (cull) this.frustum.setFromProjectionMatrix(this.fm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld));
    const sph = this.sph, f = this.frustum, sp = this.fs;
    for (let i = 0; i < n; i++) {
      const it = info[i];
      let on = it.visible && it.active && it.geometryIndex >= 0;
      const g = on ? gi[it.geometryIndex] : null;
      if (on && cull) {
        const q = i * 4;
        sp.center.set(sph[q], sph[q + 1], sph[q + 2]);
        sp.radius = sph[q + 3];
        on = f.intersectsSphere(sp);
      }
      starts[i] = g ? g.start * bpe : 0;
      counts[i] = on && g ? g.count : 0;
    }
    mesh._multiDrawCount = n;
    mesh._multiDrawBytesPerElement = bpe;
    mesh._visibilityChanged = false;
  }

  private offset(i: number): number {
    const row = Math.floor(i / BLD_INST_PER_ROW), col = i % BLD_INST_PER_ROW;
    return (row * BLD_INST_PER_ROW * 3 + col * 3) * 4;
  }

  private growInstances(need: number): void {
    let cap = this.instCap;
    while (cap < need) cap *= 2;
    this.mesh.setInstanceCount(cap);
    const rows = Math.ceil(cap / BLD_INST_PER_ROW);
    const data = new Float32Array(BLD_INST_PER_ROW * 3 * 4 * rows);
    data.set(this.data);
    const old = this.texU.value;
    const tex = new DataTexture(data, BLD_INST_PER_ROW * 3, rows, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    this.texU.value = tex;
    old.dispose();
    this.data = data;
    this.rows = rows;
    this.instCap = cap;
    const sph = new Float32Array(cap * 4); sph.set(this.sph); this.sph = sph;
    const hid = new Uint8Array(cap); hid.set(this.hid); this.hid = hid;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.depth.dispose();
    this.texU.value.dispose();
  }
}

/**
 * A batch of building geometry sharing a material and a shadow role.
 * PERF F21 (session 9; g2u on the CDN tree: 'buildings-far grown: new 4-8 MB attributes', '38 geometries added in 4
 * frames'): the geometry lives in PAGES of a fixed vertex / index size. three's BatchedMesh never reuses the space of a
 * deleted geometry and grew by setGeometrySize = brand-new GPU buffers of a new size for every attribute (on
 * ANGLE-Metal: fresh MTLBuffers, the 64 MB-between-GC wait), and every added per-building geometry was a
 * bufferSubData into the whole multi-MB buffer (= a whole-buffer copy on Metal). Now an added geometry lands in the
 * page last written (so a frame's adds share one page: F16 merges them into one span), else any page with room, else
 * a page whose dropped geometries free enough room is compacted in place (same buffer size), else a new page of the
 * same size (ANGLE's free lists recycle equal sizes). No buffer of a page is ever re-created at another size.
 */
export class BldBatch {
  /** holds the pages' meshes */
  readonly root = new Group();
  readonly cut: boolean;
  /** casts sun shadows */
  readonly shadow: boolean;
  /** drawn only into the shadow cascades (never in the colour pass) */
  readonly shadowOnly: boolean;
  readonly pages: BldPage[] = [];
  private gids = new Map<BufferGeometry, number>();
  private readonly layers = new Layers();
  private depthMode = false;
  private cur = 0;
  private readonly instCap: number;
  private readonly pageV: number;
  /** instances written in the current rewrite (all pages) */
  get used(): number { let n = 0; for (const p of this.pages) n += p.used; return n; }

  private readonly name: string;
  private readonly shared: Record<string, IUniform>;

  constructor(name: string, shared: Record<string, IUniform>, cut: boolean, shadow: boolean, instCap = 512, vCap = 1 << 18, shadowOnly = false) {
    this.name = name;
    this.shared = shared;
    this.cut = cut;
    this.shadow = shadow;
    this.shadowOnly = shadowOnly;
    this.instCap = instCap;
    this.pageV = PAGED ? Math.min(1 << 15, Math.max(1 << 13, vCap >> 2)) : vCap;
    this.root.name = name;
    this.root.matrixAutoUpdate = false;
    // (a shadow-only batch lives on the casters' layer alone)
    if (shadowOnly) this.layers.set(1);
    const p0 = this.newPage(this.pageV, this.pageV * 2);
    this.warm = warmBatch(name, p0.material, p0.depth);
  }
  /** never-drawn holder of this batch's programs (warmBatch) */
  readonly warm: Group;

  /** the page meshes' layers (all pages, and pages made later) */
  setLayers(fn: (l: Layers) => void): void {
    fn(this.layers);
    for (const p of this.pages) p.mesh.layers.mask = this.layers.mask;
  }

  /** draw with the depth (shadow caster) material or the colour material */
  useDepth(on: boolean): void {
    this.depthMode = on;
    for (const p of this.pages) p.mesh.material = on ? p.depth : p.material;
  }

  private newPage(v: number, i: number): BldPage {
    const p = new BldPage(`${this.name}-p${this.pages.length}`, this.shared, this.cut, this.instCap, v, i);
    p.mesh.layers.mask = this.layers.mask;
    if (this.depthMode) p.mesh.material = p.depth;
    this.pages.push(p);
    this.root.add(p.mesh);
    return p;
  }

  /** the batch's geometry id for a source geometry (added on first use) */
  geom(geo: BufferGeometry): number {
    const known = this.gids.get(geo);
    if (known !== undefined) return known;
    const nv = geo.getAttribute('position').count, ni = geo.index ? geo.index.count : nv;
    const k = this.pick(nv, ni);
    const id = this.pages[k].addGeom(geo, nv, ni);
    this.cur = k;
    const gid = k * STRIDE + id;
    this.gids.set(geo, gid);
    return gid;
  }

  private pick(nv: number, ni: number): number {
    const P = this.pages;
    if (P[this.cur].fits(nv, ni)) return this.cur;
    if (!PAGED) { P[0].grow(nv, ni); return 0; }
    for (let k = 0; k < P.length; k++) if (P[k].fits(nv, ni)) return k;
    // compact the page with the most dead space that would then take it (in place: the same buffers)
    let best = -1, bestDead = 0;
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      if (!p.fitsCompacted(nv, ni)) continue;
      const dead = p.deadV();
      if (dead >= Math.max(nv, p.vCap >> 3) && dead > bestDead) { best = k; bestDead = dead; }
    }
    if (best >= 0) { P[best].mesh.optimize(); if (P[best].fits(nv, ni)) return best; }
    let v = this.pageV, i = this.pageV * 2;
    while (v < nv) v *= 2;
    while (i < ni) i *= 2;
    this.newPage(v, i);
    return P.length - 1;
  }

  /** forget a per-building geometry (its space is reclaimed when its page is next compacted) */
  dropGeom(geo: BufferGeometry): void {
    const gid = this.gids.get(geo);
    if (gid === undefined) return;
    this.gids.delete(geo);
    this.pages[Math.floor(gid / STRIDE)].dropGeom(gid % STRIDE);
  }

  has(geo: BufferGeometry): boolean { return this.gids.has(geo); }

  begin(): void { for (const p of this.pages) p.begin(); }

  /** one instance of geometry `gid` (from geom()): returns its slot */
  add(gid: number, m: Matrix4, color: Color, s0: number, s1: number, s2: number, s3: number, i0: number, i1: number, i2: number, i3: number, f0: number, f1: number, f2: number): number {
    const k = Math.floor(gid / STRIDE);
    return k * STRIDE + this.pages[k].add(gid % STRIDE, m, color, s0, s1, s2, s3, i0, i1, i2, i3, f0, f1, f2);
  }

  /** rewrite one slot's state (progress, damage, flags, light / weathering) */
  setState(slot: number, s0: number, s1: number, s2: number, s3: number): void {
    if (slot < 0) return;
    const p = this.pages[Math.floor(slot / STRIDE)];
    if (p) p.setState(slot % STRIDE, s0, s1, s2, s3);
  }

  /**
   * PERF F11 — before a shadow cascade: hide the instances `keep(x, y, z, r)` (body-frame bounding sphere) rejects;
   * uncull() shows them again. Slots hidden for another reason stay hidden.
   */
  cullShadow(keep: (x: number, y: number, z: number, r: number) => boolean): number {
    let drawn = 0;
    for (const p of this.pages) drawn += p.cullShadow(keep);
    return drawn;
  }

  uncull(): void { for (const p of this.pages) p.uncull(); }

  end(): void { for (const p of this.pages) p.end(); }

  dispose(): void {
    for (const p of this.pages) p.dispose();
    for (const w of this.warm.children) (w as BatchedMesh).dispose();
  }
}

/**
 * shader warm-up holder (macfix/smooth.md F12): a batch's program key holds what its geometry and colours look like
 * (batching, per-instance colour, vertex colours and normals), and an empty BatchedMesh has neither until its first
 * building, so Renderer.warmUp's compile linked a different program and the real one linked in the frame the first
 * town (or the first building cut open by a storm or a fire) came into view. A three-vertex batch with one instance and
 * the same materials (colour pass and shadow caster), never drawn, links the very programs at load.
 */
function warmBatch(name: string, material: Material, depth: Material): Group {
  const warm = new Group();
  warm.name = `${name}-warm`;
  warm.visible = false;
  warm.matrixAutoUpdate = false;
  // (the attributes a building mesh has: meshkit.ts toGeometry)
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(6), 2));
  g.setAttribute('aKit', new Float32BufferAttribute(new Float32Array(12), 4));
  g.setIndex([0, 1, 2]);
  for (const mat of [material, depth]) {
    const b = new BatchedMesh(1, 3, 3, mat);
    b.frustumCulled = false;
    b.matrixAutoUpdate = false;
    const i = b.addInstance(b.addGeometry(g));
    b.setMatrixAt(i, new Matrix4());
    b.setColorAt(i, new Color(1, 1, 1));
    warm.add(b);
  }
  g.dispose();
  return warm;
}
