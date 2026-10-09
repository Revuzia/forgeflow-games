// GENESIS — the vessels people ride (CONTRACT.md §15.6; sim: AgentFlag.boat — the person is afloat, their `carry` is
// the boat item): rafts of lashed logs, planked rowing boats, sail boats with a mast (render/gen/buildinggen.ts
// vesselMesh), drawn with the building material (wood, cloth, weathering, shadows, night) as instances at the water
// surface under their rider, bow along the rider's heading. Crowds (crowds.ts) seats the rider and calls add().

import {
  DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, type BufferGeometry, type IUniform, type Material, type ShaderMaterial,
} from 'three';
import { vesselMesh } from '../gen/buildinggen.ts';
import { makeBuildingDepthMaterial, makeBuildingMaterial } from './buildingmat.ts';
import { packList } from './catalog.ts';

export type VesselKind = 'raft' | 'boat' | 'sail';
const KINDS: VesselKind[] = ['raft', 'boat', 'sail'];

interface Bucket { mesh: InstancedMesh; state: InstancedBufferAttribute; info: InstancedBufferAttribute; geo: BufferGeometry; cap: number; count: number }

const _m = new Matrix4();
let itemKinds: Map<number, VesselKind> | null = null;

/** the vessel an item is (by its id / name / tags in the base pack): raft, sail(ship), else a boat */
export function vesselOf(item: number): VesselKind {
  if (!itemKinds) {
    itemKinds = new Map();
    const items = packList('items') ?? [];
    items.forEach((it, i) => {
      const id = String(it.id ?? '').toLowerCase(), name = String(it.name ?? '').toLowerCase();
      const tags = Array.isArray(it.tags) ? (it.tags as unknown[]).map((t) => String(t).toLowerCase()) : [];
      if (id.includes('raft') || name.includes('raft')) itemKinds!.set(i, 'raft');
      else if (/sail|ship|galley|junk/.test(id + ' ' + name)) itemKinds!.set(i, 'sail');
      else if (/boat|canoe|kayak|coracle/.test(id + ' ' + name) || tags.includes('boat') || tags.includes('vessel')) itemKinds!.set(i, 'boat');
    });
  }
  return itemKinds.get(item) ?? 'boat';
}

export class Boats {
  readonly group = new Group();
  private material: Material;
  private depth: ShaderMaterial;
  private buckets: Bucket[] = [];
  private castShadows = false;

  constructor(shared: Record<string, IUniform>) {
    this.group.name = 'boats';
    this.group.matrixAutoUpdate = false;
    // the hull is wound both ways in the kit, so the single-sided material shows its inside too
    this.material = makeBuildingMaterial(shared, false);
    this.depth = makeBuildingDepthMaterial(shared);
    for (const k of KINDS) this.buckets.push(this.make(vesselMesh(k, 0), 16));
  }

  private make(geo: BufferGeometry, cap: number): Bucket {
    const state = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const info = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    state.setUsage(DynamicDrawUsage);
    info.setUsage(DynamicDrawUsage);
    geo.setAttribute('iState', state);
    geo.setAttribute('iInfo', info);
    const mesh = new InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    if (this.castShadows) mesh.layers.enable(1);
    this.group.add(mesh);
    return { mesh, state, info, geo, cap, count: 0 };
  }

  begin(): void { for (const b of this.buckets) b.count = 0; }

  /** one vessel: a body-frame matrix (column-major 16, radial up, +Z = bow) at the waterline, and a seed */
  add(kind: VesselKind, m: Float32Array, seed: number): void {
    const i = KINDS.indexOf(kind);
    let b = this.buckets[i];
    if (b.count >= b.cap) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
      const nb = this.make(b.geo, b.cap * 2);
      nb.count = b.count;
      // the old instances are rewritten this frame anyway (begin() .. end() covers every vessel)
      this.buckets[i] = b = nb;
    }
    const k = b.count++;
    _m.fromArray(m);
    b.mesh.setMatrixAt(k, _m);
    b.state.setXYZW(k, 1, 0, 0, 0);
    b.info.setXYZW(k, kind === 'sail' ? 7 : 1.2, kind === 'raft' ? 1 : 1.2, kind === 'sail' ? 3.8 : 2.2, seed);
  }

  end(): void {
    for (const b of this.buckets) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count) { b.mesh.instanceMatrix.needsUpdate = true; b.state.needsUpdate = true; b.info.needsUpdate = true; }
    }
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.buckets) { if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1); }
  }

  swapDepth(depth: boolean): void {
    for (const b of this.buckets) b.mesh.material = depth ? this.depth : this.material;
  }

  dispose(): void {
    for (const b of this.buckets) { b.geo.dispose(); b.mesh.dispose(); }
    this.material.dispose();
    this.depth.dispose();
  }
}
