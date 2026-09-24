// DYEFIELD — MapView: loads art/gltf/map_<id>.glb with GLTFLoader and applies the prefix rules of
// CONTRACT §3.1 to every mesh:
//
//   | prefix   | visible | shadows                         | material                                  |
//   | paint_*  | yes     | cast + receive                  | surfaces.materialFor(M_*) + applyDye(dye) |
//   | solid_*  | yes     | cast + receive                  | surfaces.materialFor(M_*)                 |
//   | deco_*   | yes     | receive; cast only when near    | surfaces.materialFor(M_*)                 |
//   | col_*    | hidden  | —                               | —                                         |
//   | water_*  | hidden  | —  (the runtime's water is used)| —                                         |
//
// The prefix is read from the node name (GLTFLoader keeps the original in userData.name and a
// sanitized copy in .name; a multi-primitive mesh becomes a Group whose children carry the mesh
// name), so the lookup walks up to the first ancestor with a contract prefix. Exported lights and
// cameras are stripped (doctrine §3). Paint materials are created separately from non-paint ones,
// so the dye layer can never leak onto a mesh without an atlas UV (uv1).

import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { artUrl } from '../core/glb.ts';
import type { MapDef } from '../core/data.ts';
import { materialFor, applyDye, type DyeUniforms } from './surfaces.ts';

export type MapPrefix = 'paint' | 'solid' | 'deco' | 'col' | 'water';
const PREFIXES: MapPrefix[] = ['paint', 'solid', 'deco', 'col', 'water'];

export interface MapView {
  root: THREE.Group;
  paintMeshes: THREE.Mesh[];
  counts: Record<MapPrefix | 'other', number>;
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

export async function loadMapView(loader: GLTFLoader, def: MapDef, dye: DyeUniforms, onProgress?: (f: number) => void): Promise<MapView> {
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
    if (pre === 'deco') {
      box.setFromObject(mesh);
      box.getCenter(ctr);
      const near = ctr.x > bmin[0] - MARGIN && ctr.x < bmax[0] + MARGIN && ctr.z > bmin[2] - MARGIN && ctr.z < bmax[2] + MARGIN;
      mesh.castShadow = near;
      if (!near) mesh.receiveShadow = false;
    } else {
      mesh.castShadow = true;
    }
  }
  if (!paintMeshes.length) warnings.push('map has no paint_* meshes');

  // static scenery: freeze matrices
  root.updateMatrixWorld(true);
  root.traverse((o) => { o.matrixAutoUpdate = false; });

  return {
    root,
    paintMeshes,
    counts,
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
