// GENESIS — camps out at distant work sites and on hunting trips (LIVING.md §6.3, AgentFlag2.camp).
//
// The sim says who is camping (AgentFlag2.camp: asleep at a camp or out on a trip); a camp is drawn where its sleepers
// lie: a bedroll (a hide spread with a rolled blanket) under each, and one small campfire per cluster of them (a ring
// of stones, an ember bed, sticks leaning in, a woodpile). The fire's flames, embers, smoke and light come from the
// life layer's particles and night lights (life.ts collectFx reads `fires`). Instanced like the boats (boats.ts): the
// building material and depth, one bucket per prop, grown on demand.
import {
  DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, type BufferGeometry, type IUniform, type Material, type ShaderMaterial,
} from 'three';
import { campMesh, type CampProp } from '../gen/buildinggen.ts';
import { makeBuildingDepthMaterial, makeBuildingMaterial } from './buildingmat.ts';

const PROPS: CampProp[] = ['bedroll', 'fire'];
/** the building material's `working` flag: the ember bed glows day and night */
const WORKING = 64;
/** sleepers within this many metres of each other share a fire */
export const CAMP_CELL_M = 12;

interface Bucket { mesh: InstancedMesh; state: InstancedBufferAttribute; info: InstancedBufferAttribute; geo: BufferGeometry; cap: number; count: number }
/** a campfire in the body frame (m) and its seed */
export interface CampFire { x: number; y: number; z: number; seed: number }

const _m = new Matrix4();

export class Camps {
  readonly group = new Group();
  /** this frame's campfires (life.ts: flames, embers, smoke, light) */
  readonly fires: CampFire[] = [];
  /** bumped whenever the set of campfires changes (life.ts rebuilds its emitters on it) */
  version = 0;
  private sig = 0;
  private nextSig = 0;
  private material: Material;
  private depth: ShaderMaterial;
  private buckets: Bucket[] = [];
  private castShadows = false;

  constructor(shared: Record<string, IUniform>) {
    this.group.name = 'camps';
    this.group.matrixAutoUpdate = false;
    this.material = makeBuildingMaterial(shared, false);
    this.depth = makeBuildingDepthMaterial(shared);
    for (const p of PROPS) this.buckets.push(this.make(campMesh(p, 0), 16));
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

  begin(): void {
    for (const b of this.buckets) b.count = 0;
    this.fires.length = 0;
    this.nextSig = 0;
  }

  /** one prop: a body-frame matrix (column-major 16, radial up) on the ground, and a seed */
  add(prop: CampProp, m: Float32Array, seed: number): void {
    const i = PROPS.indexOf(prop);
    let b = this.buckets[i];
    if (b.count >= b.cap) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
      const nb = this.make(b.geo, b.cap * 2);
      nb.count = b.count;
      this.buckets[i] = b = nb;
    }
    const k = b.count++;
    _m.fromArray(m);
    b.mesh.setMatrixAt(k, _m);
    const fire = prop === 'fire';
    b.state.setXYZW(k, 1, 0, fire ? WORKING : 0, 0);
    b.info.setXYZW(k, fire ? 0.4 : 0.15, fire ? 0.6 : 1.1, fire ? 0.6 : 0.45, seed);
    if (fire) {
      // (the flames rise from the ember bed, a hand's breadth over the ground)
      const l = Math.hypot(m[12], m[13], m[14]) || 1, up = (l + 0.15) / l;
      this.fires.push({ x: m[12] * up, y: m[13] * up, z: m[14] * up, seed });
      // the set's signature: where the fires are, to the half metre
      this.nextSig = (this.nextSig * 31 + Math.round(m[12] * 2) * 7 + Math.round(m[13] * 2) * 13 + Math.round(m[14] * 2)) | 0;
    }
  }

  end(): void {
    for (const b of this.buckets) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count) { b.mesh.instanceMatrix.needsUpdate = true; b.state.needsUpdate = true; b.info.needsUpdate = true; }
    }
    if (this.nextSig !== this.sig) { this.sig = this.nextSig; this.version++; }
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
