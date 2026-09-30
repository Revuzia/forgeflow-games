/// <reference types="vite/client" />
// HIT PARADE - GLB cache (CONTRACT §6.1, §6.4, §16 Assets, §17.1).
//
//   * GLTFLoader + MeshoptDecoder (setMeshoptDecoder BEFORE any load; meshopt, not Draco: TECH_REUSE F / E48).
//   * One promise per URL: a fighter / stage / prop GLB is fetched and parsed once; instances are SkeletonUtils clones.
//   * Bone-name safety: three sanitises "mixamorig9:Hips" to "mixamorig9Hips"; every node and track name with a
//     numbered prefix is normalised to "mixamorig<Bone>" (research ROSTER: Ch06 mixamorig9:, Ch08 mixamorig7:, ...),
//     so clips bind by NAME on every body (E45: meshopt duplicates the skin - never key anything by skeleton identity).
//   * Clip hygiene (defensive; ASSETS already ships this per §6.1): scale tracks and non-hips translation tracks are
//     dropped (the body keeps its own proportions), and horizontal hips root motion is removed in the hips' parent
//     space (the sim owns position). Both are no-ops on a conforming GLB.
//   * Skinned meshes: frustumCulled = false (E38, bind-pose bounds lie) - set when instanced (fighters.ts / toon.ts).
//   * URLs: without a base, `new URL(template, import.meta.url)` so Vite emits every art/gltf GLB into dist (hashed);
//     labs pass a base or setUrl() overrides (CONTRACT §17.1).

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export type AssetKind = 'fighter' | 'stage' | 'prop';

export interface FighterAsset {
  id: string;
  url: string;
  /** template scene (never added to a scene; instantiate() clones it) */
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  /** measured standing height of the template (m, bind pose) */
  heightM: number;
  bones: string[];
  bytes: number;
}

export interface StageAsset {
  id: string;
  url: string;
  scene: THREE.Group;
  /** crowd card placements from `crowd_*` empties (world transforms at load) */
  crowd: THREE.Object3D[];
  lights: THREE.Light[];
  bytes: number;
}

export interface PropAttach { bone: string; pos: [number, number, number]; rotDeg: [number, number, number] }

const BONE_PREFIX = /^mixamorig\d*[:_]?/;

function artUrl(kind: AssetKind, id: string): string {
  // one static template per kind so Vite's asset-import-meta-url plugin globs each folder
  switch (kind) {
    case 'fighter': return new URL(`../../../art/gltf/fighters/${id}.glb`, import.meta.url).href;
    case 'stage': return new URL(`../../../art/gltf/stages/${id}.glb`, import.meta.url).href;
    default: return new URL(`../../../art/gltf/props/${id}.glb`, import.meta.url).href;
  }
}

/** normalise a sanitised Mixamo name: "mixamorig9Hips" / "mixamorig:Hips" -> "mixamorigHips" */
export function normBone(name: string): string {
  return BONE_PREFIX.test(name) ? 'mixamorig' + name.replace(BONE_PREFIX, '') : name;
}

function normaliseNames(root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  root.traverse((o) => { if (o.name) o.name = normBone(o.name); });
  for (const c of clips) {
    for (const t of c.tracks) {
      const dot = t.name.indexOf('.');
      if (dot > 0) t.name = normBone(t.name.slice(0, dot)) + t.name.slice(dot);
    }
  }
}

function findHips(root: THREE.Object3D): THREE.Object3D | null {
  let hips: THREE.Object3D | null = null;
  root.traverse((o) => { if (!hips && (o as THREE.Bone).isBone && /hips$/i.test(o.name)) hips = o; });
  return hips;
}

/** drop scale tracks + non-hips translation, remove horizontal hips motion (in the hips' parent space) */
function cleanClips(root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const hips = findHips(root);
  const hipsName = hips ? (hips as THREE.Object3D).name : '';
  const up = new THREE.Vector3(0, 1, 0);
  if (hips && (hips as THREE.Object3D).parent) {
    const p = (hips as THREE.Object3D).parent!;
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix3().setFromMatrix4(p.matrixWorld).invert();
    up.applyMatrix3(inv).normalize();
  }
  for (const c of clips) {
    c.tracks = c.tracks.filter((t) => {
      if (t.name.endsWith('.scale')) return false;
      if (t.name.endsWith('.position')) return t.name === hipsName + '.position';
      return true;
    });
    const tr = c.tracks.find((t) => t.name === hipsName + '.position');
    if (tr && tr.values.length >= 3) {
      const v = tr.values;
      const x0 = v[0], y0 = v[1], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) {
        const dx = v[i] - x0, dy = v[i + 1] - y0, dz = v[i + 2] - z0;
        const a = dx * up.x + dy * up.y + dz * up.z;
        v[i] = x0 + up.x * a; v[i + 1] = y0 + up.y * a; v[i + 2] = z0 + up.z * a;
      }
    }
    c.resetDuration();
  }
}

function measureHeight(root: THREE.Object3D): number {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  let any = false;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      m.computeBoundingBox();
      if (m.boundingBox) { box.union(m.boundingBox.clone().applyMatrix4(m.matrixWorld)); any = true; }
    }
  });
  if (!any) box.setFromObject(root);
  const h = box.max.y - box.min.y;
  return Number.isFinite(h) && h > 0 ? h : 1.8;
}

export class Assets {
  private readonly loader: GLTFLoader;
  private readonly base: URL | null;
  private readonly overrides = new Map<string, string>();
  private readonly cache = new Map<string, Promise<GLTF & { bytes: number }>>();
  private readonly fighters = new Map<string, Promise<FighterAsset>>();
  private readonly stages = new Map<string, Promise<StageAsset>>();
  /** bytes fetched so far (read-back) */
  bytes = 0;

  constructor(base?: URL) {
    this.base = base ?? null;
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  /** lab / tooling override for one asset's URL */
  setUrl(kind: AssetKind, id: string, url: string): void { this.overrides.set(kind + ':' + id, url); }

  url(kind: AssetKind, id: string): string {
    const o = this.overrides.get(kind + ':' + id);
    if (o) return o;
    if (this.base) {
      const dir = kind === 'fighter' ? 'fighters' : kind === 'stage' ? 'stages' : 'props';
      return new URL(`${dir}/${id}.glb`, this.base).href;
    }
    return artUrl(kind, id);
  }

  private gltf(url: string): Promise<GLTF & { bytes: number }> {
    let p = this.cache.get(url);
    if (!p) {
      p = (async () => {
        if (/\/undefined$/.test(url)) throw new Error(`GLB not in art/gltf (no file matched): ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GLB ${url}: HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) throw new Error(`GLB ${url}: got HTML (missing file)`);
        const buf = await res.arrayBuffer();
        this.bytes += buf.byteLength;
        const g = await this.loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
        return Object.assign(g, { bytes: buf.byteLength });
      })();
      this.cache.set(url, p);
      p.catch(() => this.cache.delete(url));
    }
    return p;
  }

  fighter(id: string): Promise<FighterAsset> {
    let p = this.fighters.get(id);
    if (!p) {
      const url = this.url('fighter', id);
      p = this.gltf(url).then((g) => {
        const scene = g.scene;
        normaliseNames(scene, g.animations);
        cleanClips(scene, g.animations);
        const clips = new Map<string, THREE.AnimationClip>();
        for (const c of g.animations) clips.set(c.name, c);
        const bones: string[] = [];
        scene.traverse((o) => {
          if ((o as THREE.Bone).isBone) bones.push(o.name);
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
        });
        return { id, url, scene, clips, heightM: measureHeight(scene), bones, bytes: g.bytes };
      });
      this.fighters.set(id, p);
      p.catch(() => this.fighters.delete(id));
    }
    return p;
  }

  /** a fresh, independently posable copy of a fighter template (own skeleton, shared geometry) */
  instantiate(a: FighterAsset): THREE.Object3D {
    const o = SkeletonUtils.clone(a.scene);
    o.traverse((x) => { if ((x as THREE.SkinnedMesh).isSkinnedMesh) x.frustumCulled = false; });
    return o;
  }

  stage(id: string): Promise<StageAsset> {
    let p = this.stages.get(id);
    if (!p) {
      const url = this.url('stage', id);
      p = this.gltf(url).then((g) => {
        const scene = g.scene;
        const crowd: THREE.Object3D[] = [];
        const lights: THREE.Light[] = [];
        scene.updateWorldMatrix(true, true);
        scene.traverse((o) => {
          if (/^crowd_/i.test(o.name) && !(o as THREE.Mesh).isMesh) crowd.push(o);
          if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
          if ((o as THREE.Mesh).isMesh) { o.receiveShadow = true; o.castShadow = false; }
        });
        return { id, url, scene, crowd, lights, bytes: g.bytes };
      });
      this.stages.set(id, p);
      p.catch(() => this.stages.delete(id));
    }
    return p;
  }

  /** a CLONE of a prop, ready to attach; `userData.attach` carries the §17.1 grip metadata when the GLB has it */
  async prop(id: string): Promise<THREE.Object3D> {
    const g = await this.gltf(this.url('prop', id));
    const o = g.scene.clone(true);
    let attach: PropAttach | null = null;
    g.scene.traverse((x) => { if (!attach && x.userData && x.userData.attach) attach = x.userData.attach as PropAttach; });
    o.userData.attach = attach;
    o.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.receiveShadow = false; } });
    return o;
  }

  async preload(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.fighter(id)));
  }
}
