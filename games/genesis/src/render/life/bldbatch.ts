// GENESIS — one batch of building geometry (CONTRACT.md §15.6, §20 perf): three's BatchedMesh (WEBGL_multi_draw where
// the browser has it) holding every variant / prop / scaffold / rubble mesh that shares a material and a shadow role,
// drawn in ONE call. A city view had ~280 InstancedMeshes (one per household variant and LOD), ~90 % of its draws.
//
//   * Geometries are added on first use (the batch's buffers grow by doubling) and stay; a per-building geometry (a
//     market paving draped on its own ground, the earthworks under a house on a slope) can be dropped again.
//   * Instances: each full rewrite fills slots 0..n−1 in order (an existing slot takes the new geometry id, the rest
//     are hidden), so nothing is allocated per frame once the town is in.
//   * The per-instance state the building shader reads (iState, iInfo, iFade — see buildingmat.ts) lives in a float
//     texture beside three's matrix and colour textures, 3 texels per instance, read by the instance's batch id.
//   * Per-object frustum culling (also against each shadow cascade's light box) and front-to-back sorting are three's.

import {
  BatchedMesh, DataTexture, FloatType, NearestFilter, RGBAFormat, type BufferGeometry, type Color, type IUniform, type Matrix4,
  type MeshStandardMaterial, type ShaderMaterial,
} from 'three';
import { BLD_INST_PER_ROW, makeBuildingDepthMaterial, makeBuildingMaterial } from './buildingmat.ts';

export class BldBatch {
  readonly mesh: BatchedMesh;
  readonly material: MeshStandardMaterial;
  readonly depth: ShaderMaterial;
  /** casts sun shadows */
  readonly shadow: boolean;
  readonly cut: boolean;
  /** drawn only into the shadow cascades (never in the colour pass) */
  readonly shadowOnly: boolean;
  private texU: IUniform<DataTexture>;
  private data: Float32Array;
  private rows: number;
  private instCap: number;
  private vCap: number;
  private iCap: number;
  private vUsed = 0;
  private iUsed = 0;
  private gids = new Map<BufferGeometry, number>();
  /** instances written in the current rewrite */
  used = 0;
  /** instances visible after the last end() */
  private shown = 0;
  /** instances that exist in the BatchedMesh (slots ever used) */
  private made = 0;

  constructor(name: string, shared: Record<string, IUniform>, cut: boolean, shadow: boolean, instCap = 512, vCap = 1 << 18, shadowOnly = false) {
    this.cut = cut;
    this.shadow = shadow;
    this.shadowOnly = shadowOnly;
    this.instCap = instCap;
    this.vCap = vCap;
    this.iCap = vCap * 2;
    this.rows = Math.ceil(instCap / BLD_INST_PER_ROW);
    this.data = new Float32Array(BLD_INST_PER_ROW * 3 * 4 * this.rows);
    const tex = new DataTexture(this.data, BLD_INST_PER_ROW * 3, this.rows, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    this.texU = { value: tex };
    this.material = makeBuildingMaterial(shared, cut, this.texU);
    this.depth = makeBuildingDepthMaterial(shared, this.texU);
    const m = new BatchedMesh(instCap, this.vCap, this.iCap, this.material);
    m.name = name;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.perObjectFrustumCulled = true;
    m.sortObjects = true;
    m.visible = false;
    m.userData.cut = cut;
    // (a shadow-only batch lives on the casters' layer alone)
    if (shadowOnly) m.layers.set(1);
    this.mesh = m;
  }

  /** the batch's geometry id for a source geometry (added on first use) */
  geom(geo: BufferGeometry): number {
    let id = this.gids.get(geo);
    if (id !== undefined) return id;
    const nv = geo.getAttribute('position').count, ni = geo.index ? geo.index.count : nv;
    if (this.vUsed + nv > this.vCap || this.iUsed + ni > this.iCap) {
      let vc = this.vCap, ic = this.iCap;
      while (this.vUsed + nv > vc) vc *= 2;
      while (this.iUsed + ni > ic) ic *= 2;
      this.mesh.setGeometrySize(vc, ic);
      this.vCap = vc; this.iCap = ic;
    }
    id = this.mesh.addGeometry(geo);
    this.vUsed += nv; this.iUsed += ni;
    this.gids.set(geo, id);
    return id;
  }

  /** forget a per-building geometry (its buffer space is reclaimed when the batch is next compacted) */
  dropGeom(geo: BufferGeometry): void {
    const id = this.gids.get(geo);
    if (id === undefined) return;
    let other = -1;
    for (const [g, gid] of this.gids) if (g !== geo) { other = gid; break; }
    // (three deletes the instances of a deleted geometry, and the slots here must stay: keep a lone geometry)
    if (other < 0) return;
    this.gids.delete(geo);
    // instances still pointing at it are re-pointed by the next rewrite before they draw; hide them meanwhile
    const info = (this.mesh as unknown as { _instanceInfo: { geometryIndex: number; active: boolean }[] })._instanceInfo;
    for (let i = 0; i < info.length; i++) if (info[i].active && info[i].geometryIndex === id) { this.mesh.setGeometryIdAt(i, other); this.mesh.setVisibleAt(i, false); }
    this.mesh.deleteGeometry(id);
  }

  has(geo: BufferGeometry): boolean { return this.gids.has(geo); }

  begin(): void { this.used = 0; }

  /** one instance: returns its slot */
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
    const o = this.offset(i);
    const d = this.data;
    d[o] = s0; d[o + 1] = s1; d[o + 2] = s2; d[o + 3] = s3;
    d[o + 4] = i0; d[o + 5] = i1; d[o + 6] = i2; d[o + 7] = i3;
    d[o + 8] = f0; d[o + 9] = f1; d[o + 10] = f2; d[o + 11] = 0;
    return i;
  }

  /** rewrite one slot's state (progress, damage, flags, light / weathering) */
  setState(i: number, s0: number, s1: number, s2: number, s3: number): void {
    if (i < 0 || i >= this.used) return;
    const o = this.offset(i);
    const d = this.data;
    d[o] = s0; d[o + 1] = s1; d[o + 2] = s2; d[o + 3] = s3;
    this.texU.value.needsUpdate = true;
  }

  end(): void {
    const mesh = this.mesh;
    for (let i = this.used; i < this.shown; i++) mesh.setVisibleAt(i, false);
    this.shown = this.used;
    mesh.visible = this.used > 0;
    this.texU.value.needsUpdate = true;
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
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.depth.dispose();
    this.texU.value.dispose();
  }
}
