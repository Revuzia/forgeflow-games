// DYEFIELD — MapView: loads art/gltf/map_<id>.glb with GLTFLoader and applies the prefix rules of
// CONTRACT §3.1 + CONTRACT_ART_P6_8 §14.2 to every node:
//
//   | prefix      | visible | shadows                                          | material                                  |
//   | paint_*     | yes     | cast + receive                                   | surfaces.materialFor(M_*) + applyDye(dye) + AO |
//   | solid_*     | yes     | cast + receive (a small prop off the court: no cast) | surfaces.materialFor(M_*)             |
//   | deco_*      | yes     | receive; cast only when near (and not small + off-court) | surfaces.materialFor(M_*)         |
//   | grate_*     | yes     | cast (holes discarded in the shadow pass too) + receive | surfaces.grateMaterial (alpha-tested grid) |
//   | conveyor_*  | yes     | cast + receive                                   | surfaces.beltMaterial per mesh (scrolls along df_conveyor) |
//   | spring_*    | yes     | receive                                          | surfaces.springMaterial per pad (pulsing glow) |
//   | col_*       | hidden  | —                                                | —                                         |
//   | oob_*       | hidden  | —  (a volume trigger for the sim)                | —                                         |
//   | water_*     | hidden  | —  (the runtime's water is used)                 | —                                         |
//   | light_* (empty) | —   | —                                                | → the fixed point-light pool (below)      |
//
// Emissive / glazing materials (M_glass, M_skylight, M_strip, M_lamp) never cast: a skylight pane
// must let the interior key light through.
//
// AO (§14.3): mapinfo.df_ao names an 8-bit grey PNG baked in the atlas (TEXCOORD_1) space. It is
// loaded linear (NoColorSpace), flipY false (glTF orientation: PNG row 0 = v 0), and set as aoMap on
// every paint material with aoMap.channel = 1 (uv1) and aoMapIntensity AO_INTENSITY — three then
// multiplies the indirect (hemisphere / ambient) light by it.
//
// Point lights (§14.2 light_*): the empties' df_light {color, intensity, range} become a FIXED pool
// of min(6, count) PointLights created at load (the light count never changes, so there is no shader
// permutation churn). Every 0.5 s the pool is re-assigned to the empties nearest the camera; a slot
// that changes empty fades out, jumps, and fades back in (no pops). The pool is driven from the paint
// meshes' onBeforeRender (once per rendered frame, guarded by renderer.info.render.frame), so it needs
// no wiring; MapView.update(dt, camera) is the explicit alternative (calling it disables the auto
// driver).
//
// Shore map: for a map with ground below its water level (Cinder Reef's channels + sandbars) the
// top of the non-bridge paint_/solid_ geometry is rasterised into a 0.5 m depth-below-water grid
// (root.userData.dfShore) that water.ts samples for its shallow tint and shoreline foam.
//
// Draw-call budget: after the material swap, the static solid_* / deco_* meshes that share one
// material instance (and the same shadow flags and vertex layout) are merged into ONE mesh with
// their world transforms baked in (winding flipped for mirrored nodes). paint_* meshes are never
// merged (each keeps its own atlas uv1 and dye material), nor are the feature meshes (grate,
// conveyor, spring), transparent, skinned, instanced or multi-material meshes. `?dev=1&merge=0`
// turns the merge off for A/B checks.
//
// The prefix is read from the node name (GLTFLoader keeps the original in userData.name and a
// sanitized copy in .name; a multi-primitive mesh becomes a Group whose children carry the mesh
// name), so the lookup walks up to the first ancestor with a contract prefix — node extras live on
// that ancestor too. Exported lights and cameras are stripped (doctrine §3). Paint materials are
// created separately from non-paint ones, so the dye layer can never leak onto a mesh without an
// atlas UV (uv1).

import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { artUrl } from '../core/glb.ts';
import type { MapDef } from '../core/data.ts';
import {
  materialFor, applyDye, beltMaterial, springMaterial, grateMaterial, grateDepthMaterial, type DyeUniforms,
} from './surfaces.ts';

export type MapPrefix = 'paint' | 'solid' | 'deco' | 'col' | 'water' | 'grate' | 'conveyor' | 'spring' | 'oob' | 'light';
const PREFIXES: MapPrefix[] = ['paint', 'solid', 'deco', 'col', 'water', 'grate', 'conveyor', 'spring', 'oob', 'light'];

/** aoMap strength on paint surfaces (CONTRACT_P6_11 §19: ≈ 0.8) */
export const AO_INTENSITY = 0.8;
/** the fixed point-light pool (CONTRACT_ART_P6_8 §14.2: ≤ 6 real lights) */
export const LIGHT_POOL = {
  max: 6,
  /** seconds between re-assignments to the empties nearest the camera */
  period: 0.5,
  /** fade time (s) when a slot moves to another empty */
  fade: 0.3,
  /** df_light intensity → three candela (decay 2, distance = df range): a warm pool under each lamp */
  gain: 28,
} as const;

/** materials that never cast shadows (glazing and light sources) */
const NO_CAST = new Set(['M_glass', 'M_skylight', 'M_strip', 'M_lamp']);
/** materials of floating structures left out of the shore map (bridges over the channels) */
const SHORE_SKIP = new Set(['M_plank', 'M_boardwalk', 'M_grate', 'M_belt']);

export interface MapViewOptions {
  /** merge static solid_/deco_ meshes that share a material (default true) */
  mergeStatic?: boolean;
}

export interface MergeReport {
  /** visible static (solid_/deco_) meshes before and after the merge */
  before: number;
  after: number;
  /** merged meshes built, and how many source meshes went into them */
  merged: number;
  sources: number;
  /** static meshes that cast shadows, before and after */
  castersBefore: number;
  castersAfter: number;
}

export interface LightEmpty { name: string; pos: THREE.Vector3; color: THREE.Color; intensity: number; range: number }

/** what the phase 7–8 features resolved to on this map (bench / F1 / look report) */
export interface MapFeatures {
  grates: number;
  conveyors: number;
  springs: number;
  oob: number;
  /** light_ empties found, and the real point lights in the fixed pool */
  lightEmpties: number;
  lightPool: number;
  /** AO map applied to the paint materials (its file name), or null */
  ao: string | null;
  /** shore depth map built for the water (grid size), or null */
  shore: [number, number] | null;
}

/** root.userData.dfShore — read by water.ts */
export interface ShoreMap {
  tex: THREE.DataTexture;
  /** grid size in texels [x, z] (0.5 m cells) */
  size: [number, number];
  /** world XZ rect [minX, minZ, maxX, maxZ] the texture covers */
  rect: [number, number, number, number];
  /** texel value v → depth below the water (m) = v * range − land */
  range: number;
  land: number;
  waterY: number;
}

export interface MapView {
  root: THREE.Group;
  paintMeshes: THREE.Mesh[];
  counts: Record<MapPrefix | 'other', number>;
  merge: MergeReport;
  triangles: number;
  paintTriangles: number;
  materials: string[];
  warnings: string[];
  features: MapFeatures;
  lights: THREE.PointLight[];
  /**
   * Optional explicit per-frame driver (dt s, the render camera): re-assigns the light pool every
   * 0.5 s and steps its fades. Once called, the built-in onBeforeRender driver stands down.
   */
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

function origName(o: THREE.Object3D): string {
  return (o.userData && typeof o.userData.name === 'string') ? o.userData.name : o.name;
}

function prefixOf(o: THREE.Object3D | null): MapPrefix | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const n = origName(p);
    for (const pre of PREFIXES) if (n.startsWith(pre + '_')) return pre;
  }
  return null;
}

/** the node that carries the contract prefix (and the node extras) for this object */
function prefixNode(o: THREE.Object3D): THREE.Object3D {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const n = origName(p);
    for (const pre of PREFIXES) if (n.startsWith(pre + '_')) return p;
  }
  return o;
}

function baseMatName(m: THREE.Material): string {
  return (m.name || '').replace(/\.\d{3,}$/, '');
}

/** Material.clone() drops onBeforeCompile / customProgramCacheKey — carry the surface shader hooks over. */
function cloneWithHooks<T extends THREE.Material>(m: T): T {
  const c = m.clone() as T;
  c.onBeforeCompile = m.onBeforeCompile;
  c.customProgramCacheKey = m.customProgramCacheKey;
  return c;
}

function triCount(g: THREE.BufferGeometry): number {
  return Math.floor((g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3);
}

/** vertex-layout signature (null = not mergeable: interleaved or morph attributes) */
function layoutOf(g: THREE.BufferGeometry): string | null {
  if (Object.keys(g.morphAttributes).length) return null;
  const parts: string[] = [];
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
    const b = a as THREE.BufferAttribute;
    parts.push(`${name}:${b.itemSize}:${b.normalized ? 'n' : 'r'}:${b.array.constructor.name}`);
  }
  return parts.join(',') + (g.index ? '|idx' : '|flat');
}

/** reverse every triangle (a mirrored node's baked geometry would otherwise face inward) */
function flipWinding(g: THREE.BufferGeometry): void {
  if (g.index) {
    const ix = g.index;
    for (let i = 0; i + 2 < ix.count; i += 3) {
      const b = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, b);
    }
    ix.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as unknown as { [k: number]: number };
    for (let v = 0; v + 2 < a.count; v += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (v + 1) * n + k, i2 = (v + 2) * n + k;
        const t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t;
      }
    }
    a.needsUpdate = true;
  }
}

/**
 * Merge static meshes that share a material instance, shadow flags and vertex layout into one mesh
 * each (world transforms baked). Returns the meshes that now draw the static set.
 */
function mergeStaticMeshes(root: THREE.Group, statics: THREE.Mesh[], warnings: string[]): { draw: THREE.Mesh[]; merged: number; sources: number } {
  const groups = new Map<string, THREE.Mesh[]>();
  const keep: THREE.Mesh[] = [];
  for (const m of statics) {
    const mat = m.material;
    const layout = layoutOf(m.geometry as THREE.BufferGeometry);
    if (Array.isArray(mat) || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh
      || !m.visible || mat.transparent || !layout) { keep.push(m); continue; }
    const key = `${mat.uuid}|${m.castShadow ? 'c' : '-'}${m.receiveShadow ? 'r' : '-'}|${m.renderOrder}|${layout}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(m);
  }
  const draw: THREE.Mesh[] = [...keep];
  const dropped = new Set<THREE.BufferGeometry>();
  let merged = 0, sources = 0;
  for (const group of groups.values()) {
    if (group.length < 2) { draw.push(...group); continue; }
    const geos = group.map((m) => {
      const g = (m.geometry as THREE.BufferGeometry).clone();
      g.applyMatrix4(m.matrixWorld);
      if (m.matrixWorld.determinant() < 0) flipWinding(g);
      return g;
    });
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const first = group[0];
    const matName = (first.material as THREE.Material).name || 'unnamed';
    if (!geo) {
      warnings.push(`static merge of ${group.length} '${matName}' meshes failed — kept them separate`);
      draw.push(...group);
      continue;
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, first.material);
    const pre = group.some((m) => prefixOf(m) === 'solid') ? 'solid' : 'deco';
    mesh.name = `${pre}_merged_${matName}`;
    mesh.userData = { name: mesh.name, mergedFrom: group.map((m) => origName(m)) };
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    for (const m of group) {
      m.removeFromParent();
      dropped.add(m.geometry as THREE.BufferGeometry);
    }
    root.add(mesh);
    draw.push(mesh);
    merged++;
    sources += group.length;
  }
  // free source geometries nothing draws any more (none has reached the GPU yet)
  const live = new Set<THREE.BufferGeometry>();
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) live.add(m.geometry as THREE.BufferGeometry); });
  for (const g of dropped) if (!live.has(g)) g.dispose();
  return { draw, merged, sources };
}

// ── plank orientation (per-vertex `dfAxis`) ───────────────────────────────────────────────────

/**
 * Write a per-vertex float attribute `dfAxis` = 1 when the connected piece the vertex belongs to is
 * longer in world X than in Z (else 0). The plank surface lays its boards across that long axis, so
 * each bridge gets boards across its walkway whatever its heading. Pieces are joined by welded
 * positions (glTF splits vertices at UV / normal seams).
 */
function writePlankAxis(mesh: THREE.Mesh): void {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute('position');
  if (!pos) return;
  const n = pos.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const unite = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const weld = new Map<string, number>();
  const v = new THREE.Vector3();
  const world: number[] = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z;
    const key = `${Math.round(v.x * 200)},${Math.round(v.y * 200)},${Math.round(v.z * 200)}`;
    const w = weld.get(key);
    if (w === undefined) weld.set(key, i); else unite(i, w);
  }
  const idx = g.index;
  const tris = idx ? idx.count : n;
  for (let t = 0; t + 2 < tris; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    unite(a, b); unite(b, c);
  }
  const box = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const x = world[i * 3], z = world[i * 3 + 2];
    const bb = box.get(r);
    if (!bb) box.set(r, [x, z, x, z]);
    else { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], z); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], z); }
  }
  const axis = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const bb = box.get(find(i))!;
    axis[i] = (bb[2] - bb[0]) > (bb[3] - bb[1]) ? 1 : 0;
  }
  g.setAttribute('dfAxis', new THREE.BufferAttribute(axis, 1));
}

// ── shore depth map ───────────────────────────────────────────────────────────────────────────

const SHORE_CELL = 0.5;
const SHORE_RANGE = 4.5;     // texel 1.0 ↔ 4 m below the water
const SHORE_LAND = 0.5;      // texel 0.0 ↔ 0.5 m above the water (land)

/**
 * Rasterise the top of the ground (paint_ / solid_ minus bridges) into a depth-below-water grid.
 * Returns null when the map has (almost) no ground under its water (Pier 18: open sea → the water
 * keeps its foam rectangle look).
 */
function buildShoreMap(meshes: THREE.Mesh[], waterY: number, bmin: number[], bmax: number[]): ShoreMap | null {
  const M = 14;
  const x0 = bmin[0] - M, z0 = bmin[2] - M, x1 = bmax[0] + M, z1 = bmax[2] + M;
  const W = Math.min(512, Math.ceil((x1 - x0) / SHORE_CELL));
  const H = Math.min(512, Math.ceil((z1 - z0) / SHORE_CELL));
  const cx = (x1 - x0) / W, cz = (z1 - z0) / H;
  const top = new Float32Array(W * H).fill(-Infinity);
  const cap = waterY + SHORE_LAND;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) continue;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    const mw = mesh.matrixWorld;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(mw);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(mw);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(mw);
      if (Math.min(a.y, b.y, c.y) > cap + 6) continue;
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / cx - 0.5));
      const i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x, c.x) - x0) / cx - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / cz - 0.5));
      const j1 = Math.min(H - 1, Math.ceil((Math.max(a.z, b.z, c.z) - z0) / cz - 0.5));
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * cz;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * cx;
          const l1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d;
          const l2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = Math.min(cap, l1 * a.y + l2 * b.y + l3 * c.y);
          const k = j * W + i;
          if (y > top[k]) top[k] = y;
        }
      }
    }
  }
  // depth below the water (m), land clamped to −SHORE_LAND, open water = the range floor
  const depth = new Float32Array(W * H);
  let submerged = 0;
  for (let k = 0; k < W * H; k++) {
    const y = top[k];
    const dd = Number.isFinite(y) ? Math.min(SHORE_RANGE - SHORE_LAND, waterY - y) : SHORE_RANGE - SHORE_LAND;
    depth[k] = dd;
    if (Number.isFinite(y) && dd > 0.02 && dd < 3.5) submerged++;
  }
  if (submerged / (W * H) < 0.03) return null;
  // one 3×3 box blur: soft shoreline gradients (the grid is 0.5 m)
  const blur = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= W) continue;
          s += depth[jj * W + ii]; n++;
        }
      }
      blur[j * W + i] = s / n;
    }
  }
  const data = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) data[k] = Math.max(0, Math.min(255, Math.round(((blur[k] + SHORE_LAND) / SHORE_RANGE) * 255)));
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.name = 'df_shore_depth';
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { tex, size: [W, H], rect: [x0, z0, x1, z1], range: SHORE_RANGE, land: SHORE_LAND, waterY };
}

// ── point-light pool ──────────────────────────────────────────────────────────────────────────

class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private readonly slot: Array<{ cur: number; def: number; next: number }> = [];
  private acc = 0;
  private first = true;
  private readonly cam = new THREE.Vector3();

  readonly empties: LightEmpty[];

  constructor(empties: LightEmpty[], parent: THREE.Object3D) {
    this.empties = empties;
    const n = Math.min(LIGHT_POOL.max, empties.length);
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = `df_light_pool_${i}`;
      l.castShadow = false;
      parent.add(l);
      l.matrixAutoUpdate = true;
      this.lights.push(l);
      this.slot.push({ cur: 0, def: -1, next: -1 });
    }
  }

  private place(i: number, d: number): void {
    const l = this.lights[i];
    const e = this.empties[d];
    l.position.copy(e.pos);
    l.color.copy(e.color);
    l.distance = e.range;
    l.updateMatrix();
  }

  private assign(): void {
    const e = this.empties;
    const n = this.lights.length;
    // nearest first; a bigger light reaches further, so it ranks a little closer
    const order = e.map((_, i) => i).sort((p, q) =>
      (e[p].pos.distanceTo(this.cam) - 0.35 * e[p].range) - (e[q].pos.distanceTo(this.cam) - 0.35 * e[q].range));
    const want = new Set(order.slice(0, n));
    const held = new Set<number>();
    for (const s of this.slot) {
      if (want.has(s.next)) held.add(s.next);
      else s.next = -1;
    }
    let k = 0;
    for (const d of order.slice(0, n)) {
      if (held.has(d)) continue;
      while (k < n && this.slot[k].next !== -1) k++;
      if (k >= n) break;
      this.slot[k].next = d;
      held.add(d);
    }
    if (this.first) {
      this.first = false;
      for (let i = 0; i < n; i++) {
        const s = this.slot[i];
        s.def = s.next;
        s.cur = s.def >= 0 ? 1 : 0;
        if (s.def >= 0) this.place(i, s.def);
      }
    }
  }

  update(dt: number, camPos: THREE.Vector3): void {
    if (!this.lights.length) return;
    this.cam.copy(camPos);
    this.acc += Math.max(0, Math.min(dt, 1));
    if (this.first || this.acc >= LIGHT_POOL.period) { this.acc = 0; this.assign(); }
    const step = dt / LIGHT_POOL.fade;
    for (let i = 0; i < this.lights.length; i++) {
      const s = this.slot[i];
      if (s.next !== s.def) {
        s.cur -= step;
        if (s.cur <= 0) {
          s.cur = 0;
          s.def = s.next;
          if (s.def >= 0) this.place(i, s.def);
        }
      } else if (s.def >= 0) {
        s.cur = Math.min(1, s.cur + step);
      }
      const l = this.lights[i];
      l.intensity = s.def >= 0 ? s.cur * this.empties[s.def].intensity * LIGHT_POOL.gain : 0;
    }
  }
}

function readLightEmpties(scene: THREE.Object3D, warnings: string[]): LightEmpty[] {
  const out: LightEmpty[] = [];
  const wp = new THREE.Vector3();
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) return;
    const name = origName(o);
    if (!name.startsWith('light_')) return;
    const dl = o.userData?.df_light as { color?: string; intensity?: number; range?: number } | undefined;
    if (!dl || typeof dl !== 'object') { warnings.push(`light empty '${name}' has no df_light extras — skipped`); return; }
    o.getWorldPosition(wp);
    out.push({
      name,
      pos: wp.clone(),
      color: new THREE.Color(typeof dl.color === 'string' ? dl.color : '#FFB35C'),
      intensity: typeof dl.intensity === 'number' ? dl.intensity : 2,
      range: typeof dl.range === 'number' && dl.range > 0 ? dl.range : 10,
    });
  });
  out.sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : 0));
  return out;
}

/** mapinfo extras → df_ao (the baked AO png next to the GLB), or null */
function aoNameOf(scene: THREE.Object3D): string | null {
  let out: string | null = null;
  scene.traverse((o) => {
    if (out === null && origName(o) === 'mapinfo' && typeof o.userData?.df_ao === 'string') out = o.userData.df_ao as string;
  });
  return out;
}

function v3Of(v: unknown): THREE.Vector3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? new THREE.Vector3(v[0], v[1], v[2]) : null;
}

export async function loadMapView(loader: GLTFLoader, def: MapDef, dye: DyeUniforms, onProgress?: (f: number) => void,
  options: MapViewOptions = {}): Promise<MapView> {
  const url = artUrl(`map_${def.id}.glb`);
  const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>((ok, fail) => {
    loader.load(url, ok, (e) => { if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total); },
      (err) => fail(new Error(`failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`)));
  });
  const root = new THREE.Group();
  root.name = `map_${def.id}`;
  const scene = gltf.scene;
  root.add(scene);

  // strip exported lights / cameras
  const drop: THREE.Object3D[] = [];
  scene.traverse((o) => { if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) drop.push(o); });
  for (const o of drop) o.parent?.remove(o);

  const counts: Record<MapPrefix | 'other', number> = {
    paint: 0, solid: 0, deco: 0, col: 0, water: 0, grate: 0, conveyor: 0, spring: 0, oob: 0, light: 0, other: 0,
  };
  const paintMeshes: THREE.Mesh[] = [];
  const warnings: string[] = [];
  const opts = { mapId: def.id, courtLines: def.courtLines };
  const paintMats = new Map<string, THREE.MeshStandardMaterial>();
  const plainMats = new Map<string, THREE.MeshStandardMaterial>();
  const featureMats: THREE.Material[] = [];
  const dyed = new Set<THREE.Material>();
  const plain = new Set<THREE.Material>();
  const names = new Set<string>();
  // map extent (bounds) for the near/far deco rule
  const bmin = def.bounds?.min ?? [-40, -2, -50];
  const bmax = def.bounds?.max ?? [40, 12, 50];
  const MARGIN = 8;
  let triangles = 0, paintTriangles = 0;

  scene.updateMatrixWorld(true);
  const empties = readLightEmpties(scene, warnings);
  counts.light = empties.length;
  const aoName = aoNameOf(scene);

  const meshes: Array<{ mesh: THREE.Mesh; pre: MapPrefix | null }> = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push({ mesh: m, pre: prefixOf(m) });
  });
  // non-paint first: a surfaces cache shared across prefixes then hands paint a clone, never the reverse
  meshes.sort((a, b) => (a.pre === 'paint' ? 1 : 0) - (b.pre === 'paint' ? 1 : 0));

  const swap = (src: THREE.Material, isPaint: boolean, hasColor: boolean): THREE.Material => {
    const name = src.name || '(unnamed)';
    names.add(name);
    const key = `${name}|${hasColor ? 'vc' : '-'}`;
    const cache = isPaint ? paintMats : plainMats;
    const hit = cache.get(key);
    if (hit) return hit;
    let mat: THREE.MeshStandardMaterial = materialFor(name, src, opts);
    if (isPaint) {
      if (plain.has(mat)) {
        const w = `surfaces.materialFor('${name}') returned a shared instance already used on a non-paint mesh — dye would leak; cloning for paint`;
        warnings.push(w);
        console.warn('[mapview]', w);
        mat = cloneWithHooks(mat);
      }
      applyDye(mat, dye);
      dyed.add(mat);
    } else if (dyed.has(mat)) {
      const w = `surfaces.materialFor('${name}') returned the dyed paint instance for a non-paint mesh`;
      warnings.push(w);
      console.warn('[mapview]', w);
    } else {
      plain.add(mat);
    }
    cache.set(key, mat);
    return mat;
  };

  const box = new THREE.Box3();
  const ctr = new THREE.Vector3();
  const size = new THREE.Vector3();
  // a static prop this small (bounding radius, m) casts only while it stands inside the court bounds
  const SMALL_PROP_R = 1.5;
  const statics: THREE.Mesh[] = [];
  const shoreSrc: THREE.Mesh[] = [];
  let grateDepth: THREE.MeshDepthMaterial | null = null;
  const matNamesOf = (m: THREE.Mesh): string[] => (Array.isArray(m.material) ? m.material : [m.material]).map(baseMatName);

  for (const { mesh, pre } of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const tris = triCount(g);
    if (!pre) {
      counts.other++;
      warnings.push(`mesh '${origName(mesh)}' has no contract prefix — treated as solid`);
    } else counts[pre]++;
    if (pre === 'col' || pre === 'water' || pre === 'oob' || pre === 'light') {
      mesh.visible = false;
      continue;
    }
    triangles += tris;
    const srcNames = matNamesOf(mesh);
    const node = prefixNode(mesh);

    // ── feature meshes: their own per-mesh materials, never merged ──
    if (pre === 'grate' || pre === 'conveyor' || pre === 'spring') {
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      for (const n of srcNames) names.add(n);
      box.setFromObject(mesh);
      box.getCenter(ctr);
      box.getSize(size);
      let mat: THREE.MeshStandardMaterial;
      if (pre === 'grate') {
        mat = grateMaterial(src.name || 'M_grate', src);
        grateDepth ??= grateDepthMaterial();
        mesh.customDepthMaterial = grateDepth;
        mesh.castShadow = true;
      } else if (pre === 'conveyor') {
        const v = v3Of(node.userData?.df_conveyor);
        if (!v) warnings.push(`conveyor '${origName(node)}' has no df_conveyor [vx, vy, vz] — drawn static`);
        const vel = v ?? new THREE.Vector3(0, 0, 0);
        const flat = new THREE.Vector3(vel.x, 0, vel.z);
        const dir = vel.lengthSq() > 1e-8 ? vel.clone().normalize() : new THREE.Vector3(0, 0, 1);
        const side = flat.lengthSq() > 1e-8 ? new THREE.Vector3(-flat.z, 0, flat.x).normalize() : new THREE.Vector3(1, 0, 0);
        const halfWidth = Math.abs(side.x) * size.x * 0.5 + Math.abs(side.z) * size.z * 0.5;
        mat = beltMaterial(src.name || 'M_belt', src, { dir, speed: vel.length(), center: ctr.clone(), halfWidth });
        mesh.castShadow = true;
      } else {
        if (!v3Of(node.userData?.df_launch)) warnings.push(`spring '${origName(node)}' has no df_launch [vx, vy, vz]`);
        mat = springMaterial(src.name || 'M_spring', src, {
          center: new THREE.Vector3(ctr.x, box.max.y, ctr.z), radius: Math.max(0.3, Math.min(size.x, size.z) * 0.5),
        });
        mesh.castShadow = false;
      }
      mesh.material = mat;
      mesh.receiveShadow = true;
      featureMats.push(mat);
      continue;
    }

    const isPaint = pre === 'paint';
    if (isPaint) {
      paintTriangles += tris;
      paintMeshes.push(mesh);
      if (!g.getAttribute('uv1')) {
        const w = `paint mesh '${origName(mesh)}' has no uv1 (TEXCOORD_1) — the dye layer cannot sample the atlas`;
        warnings.push(w);
        console.warn('[mapview]', w);
      }
    }
    if (srcNames.includes('M_plank')) writePlankAxis(mesh);
    if ((pre === 'paint' || pre === 'solid' || !pre) && !srcNames.some((n) => SHORE_SKIP.has(n)) && !/bridge/.test(origName(node))) {
      shoreSrc.push(mesh);
    }
    const hasColor = !!g.getAttribute('color');
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((mm) => swap(mm, isPaint, hasColor))
      : swap(mesh.material, isPaint, hasColor);
    mesh.receiveShadow = true;
    if (isPaint) {
      mesh.castShadow = true;
      continue;
    }
    box.setFromObject(mesh);
    box.getCenter(ctr);
    const small = box.getSize(size).length() / 2 < SMALL_PROP_R;
    const inside = ctr.x > bmin[0] && ctr.x < bmax[0] && ctr.z > bmin[2] && ctr.z < bmax[2];
    if (pre === 'deco') {
      const near = ctr.x > bmin[0] - MARGIN && ctr.x < bmax[0] + MARGIN && ctr.z > bmin[2] - MARGIN && ctr.z < bmax[2] + MARGIN;
      mesh.castShadow = near && (inside || !small);
      if (!near) mesh.receiveShadow = false;
    } else {
      mesh.castShadow = inside || !small;
    }
    // glazing and light sources let the light through
    if (srcNames.length && srcNames.every((n) => NO_CAST.has(n))) mesh.castShadow = false;
    statics.push(mesh);
  }
  if (!paintMeshes.length) warnings.push('map has no paint_* meshes');

  // ── AO (CONTRACT_ART_P6_8 §14.3): the baked atlas-space occlusion on every paint material ──
  let aoApplied: string | null = null;
  let aoTex: THREE.Texture | null = null;
  if (aoName) {
    try {
      aoTex = await new THREE.TextureLoader().loadAsync(artUrl(aoName));
      aoTex.name = `df_ao_${def.id}`;
      aoTex.flipY = false;                  // glTF orientation: PNG row 0 = TEXCOORD_1 v 0
      aoTex.colorSpace = THREE.NoColorSpace; // linear 8-bit data
      aoTex.channel = 1;                    // sample with uv1 (the atlas UV)
      aoTex.wrapS = THREE.ClampToEdgeWrapping;
      aoTex.wrapT = THREE.ClampToEdgeWrapping;
      aoTex.anisotropy = 4;
      aoTex.needsUpdate = true;
      for (const m of paintMats.values()) {
        m.aoMap = aoTex;
        m.aoMapIntensity = AO_INTENSITY;
        m.needsUpdate = true;
      }
      aoApplied = aoName;
    } catch (e) {
      const w = `AO map '${aoName}' failed to load (${e instanceof Error ? e.message : String(e)}) — paint drawn without AO`;
      warnings.push(w);
      console.warn('[mapview]', w);
    }
  } else {
    warnings.push('mapinfo has no df_ao — paint drawn without AO');
  }

  // shore depth map for the water — built before the merge removes source meshes (world matrices)
  const waterY = def.waterY ?? -1.4;
  const shore = buildShoreMap(shoreSrc, waterY, bmin, bmax);
  if (shore) root.userData.dfShore = shore;

  // draw-call budget: merge the static set by material
  const castersBefore = statics.filter((m) => m.castShadow).length;
  let drawStatics = statics;
  let mergedN = 0, sourcesN = 0;
  if (options.mergeStatic !== false) {
    const r = mergeStaticMeshes(root, statics, warnings);
    drawStatics = r.draw;
    mergedN = r.merged;
    sourcesN = r.sources;
  }
  const merge: MergeReport = {
    before: statics.length, after: drawStatics.length, merged: mergedN, sources: sourcesN,
    castersBefore, castersAfter: drawStatics.filter((m) => m.castShadow).length,
  };

  // static scenery: freeze matrices
  root.updateMatrixWorld(true);
  root.traverse((o) => { o.matrixAutoUpdate = false; });

  // ── the fixed point-light pool, driven once per rendered frame ──
  const pool = new LightPool(empties, root);
  let explicit = false;
  let lastFrame = -1;
  let lastT = -1;
  const camPos = new THREE.Vector3();
  const drive = (renderer: THREE.WebGLRenderer, camera: THREE.Camera): void => {
    if (explicit || !pool.lights.length) return;
    const f = renderer.info.render.frame;
    if (f === lastFrame) return;
    lastFrame = f;
    const now = performance.now() / 1000;
    const dt = lastT < 0 ? 0 : Math.min(0.25, now - lastT);
    lastT = now;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    pool.update(dt, camPos);
  };
  if (pool.lights.length) {
    for (const m of paintMeshes) m.onBeforeRender = (r, _s, cam) => drive(r, cam);
  }

  const features: MapFeatures = {
    grates: counts.grate, conveyors: counts.conveyor, springs: counts.spring, oob: counts.oob,
    lightEmpties: empties.length, lightPool: pool.lights.length,
    ao: aoApplied, shore: shore ? shore.size : null,
  };

  return {
    root,
    paintMeshes,
    counts,
    merge,
    triangles,
    paintTriangles,
    materials: [...names].sort(),
    warnings,
    features,
    lights: pool.lights,
    update(dt: number, camera: THREE.Camera): void {
      explicit = true;
      camPos.setFromMatrixPosition(camera.matrixWorld);
      pool.update(dt, camPos);
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const m of [...paintMats.values(), ...plainMats.values(), ...featureMats]) m.dispose();
      grateDepth?.dispose();
      aoTex?.dispose();
      shore?.tex.dispose();
      for (const l of pool.lights) l.dispose();
    },
  };
}
