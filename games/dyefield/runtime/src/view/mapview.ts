// DYEFIELD — MapView: loads art/gltf/map_<id>.glb with GLTFLoader and applies the prefix rules of
// CONTRACT §3.1 to every mesh:
//
//   | prefix   | visible | shadows                                          | material                                  |
//   | paint_*  | yes     | cast + receive                                   | surfaces.materialFor(M_*) + applyDye(dye) |
//   | solid_*  | yes     | cast + receive (a small prop off the court: no cast) | surfaces.materialFor(M_*)             |
//   | deco_*   | yes     | receive; cast only when near (and not small + off-court) | surfaces.materialFor(M_*)         |
//   | col_*    | hidden  | —                                                | —                                         |
//   | water_*  | hidden  | —  (the runtime's water is used)                 | —                                         |
//
// Draw-call budget: after the material swap, the static solid_* / deco_* meshes that share one
// material instance (and the same shadow flags and vertex layout) are merged into ONE mesh with
// their world transforms baked in (winding flipped for mirrored nodes). paint_* meshes are never
// merged (each keeps its own atlas uv1 and dye material), nor are transparent, skinned, instanced or
// multi-material meshes. `?dev=1&merge=0` turns the merge off for A/B checks.
//
// The prefix is read from the node name (GLTFLoader keeps the original in userData.name and a
// sanitized copy in .name; a multi-primitive mesh becomes a Group whose children carry the mesh
// name), so the lookup walks up to the first ancestor with a contract prefix. Exported lights and
// cameras are stripped (doctrine §3). Paint materials are created separately from non-paint ones,
// so the dye layer can never leak onto a mesh without an atlas UV (uv1).

import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { artUrl } from '../core/glb.ts';
import type { MapDef } from '../core/data.ts';
import { materialFor, applyDye, type DyeUniforms } from './surfaces.ts';

export type MapPrefix = 'paint' | 'solid' | 'deco' | 'col' | 'water';
const PREFIXES: MapPrefix[] = ['paint', 'solid', 'deco', 'col', 'water'];

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

export interface MapView {
  root: THREE.Group;
  paintMeshes: THREE.Mesh[];
  counts: Record<MapPrefix | 'other', number>;
  merge: MergeReport;
  triangles: number;
  paintTriangles: number;
  materials: string[];
  warnings: string[];
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

  const counts: Record<MapPrefix | 'other', number> = { paint: 0, solid: 0, deco: 0, col: 0, water: 0, other: 0 };
  const paintMeshes: THREE.Mesh[] = [];
  const warnings: string[] = [];
  const opts = { mapId: def.id, courtLines: def.courtLines };
  const paintMats = new Map<string, THREE.MeshStandardMaterial>();
  const plainMats = new Map<string, THREE.MeshStandardMaterial>();
  const dyed = new Set<THREE.Material>();
  const plain = new Set<THREE.Material>();
  const names = new Set<string>();
  // map extent (bounds) for the near/far deco rule
  const bmin = def.bounds?.min ?? [-40, -2, -50];
  const bmax = def.bounds?.max ?? [40, 12, 50];
  const MARGIN = 8;
  let triangles = 0, paintTriangles = 0;

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
  scene.updateMatrixWorld(true);
  for (const { mesh, pre } of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const tris = triCount(g);
    if (!pre) {
      counts.other++;
      warnings.push(`mesh '${origName(mesh)}' has no contract prefix — treated as solid`);
    } else counts[pre]++;
    if (pre === 'col' || pre === 'water') {
      mesh.visible = false;
      continue;
    }
    triangles += tris;
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
    statics.push(mesh);
  }
  if (!paintMeshes.length) warnings.push('map has no paint_* meshes');

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

  return {
    root,
    paintMeshes,
    counts,
    merge,
    triangles,
    paintTriangles,
    materials: [...names].sort(),
    warnings,
    dispose() {
      root.removeFromParent();
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const m of [...paintMats.values(), ...plainMats.values()]) m.dispose();
    },
  };
}
