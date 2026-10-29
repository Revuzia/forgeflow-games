// VALE render — triangle LODs (perf PERF-m5): simplified index buffers over a mesh's OWN vertices (meshoptimizer's
// simplifier, WASM), so a LOD shares every vertex attribute with its mesh — positions, normals, UVs and the skin
// weights, which keeps it animating with the same skeleton — and costs one extra index buffer.
//
//   shadow    every shadow caster in the match (fighters, units, structures, landmarks, props, the crowd) draws its
//             depth into the sun's map through a LOD: about a fifth of its triangles, the shape held within 3 cm (under
//             a shadow-map texel at the lane camera, then softened by the PCF filter), welded (see lodIndex). The swap
//             happens in the caster's onBeforeShadow / onAfterShadow, so the main pass never sees it. three keys its
//             vertex-array state by (geometry, program) and re-binds when the index differs, and the depth programs
//             never draw the main pass, so the swap costs no re-binding per frame.
//   hull      a per-actor unit's or structure's rest-outline hull (actors.ts): half the triangles within 6 mm, welded.
//             Structures keep their full meshes in the main pass.
//   body      a fighter's textured body in the MATCH (lodSwitch.body; the menu showcase keeps the full mesh) draws
//             a face-locked LOD1 (art/blender/fighters/_lod1.mjs, the chars lane's recipe, ported below as
//             faceLockedLod): 0.4 of the triangles asked, held within 12 mm (a pixel at the default lane zoom, 82 px a
//             metre; the error bound stops it near 0.55), the normals weighted 0.5 and every vertex skinned >= 0.5 to the
//             `head` bone locked, so the face never changes. The hull plan is rebuilt over it (the veil's depth copy
//             draws exactly the body's triangles).
//   ink       a match fighter's rest outline, victim flash and x-ray draw a welded LOD of that LOD1 hull within 8 mm
//             (actors.ts bodyLodOf; the flash slides toward the camera so the coarser shell still covers the body).
//   crowd     the crowd (crowd.ts: Wicks and small monsters; Wicks have no face) draws its body and accents through a
//             LOD held within 12 mm in metres (each mesh's own dequantization, see below; textured, so never welded):
//             ~1 px at the default lane zoom for a 55-65 px Wick; its outline hull is composed of exactly those
//             triangles, so the ink keeps hugging the body.
//
// Positions arrive as GLTFLoader builds them from KHR_mesh_quantization: normalized int16, read back in -1..1, the
// metres per unit living only in the skeleton (dequantUnit). A bound in metres is divided by that unit; a caller that
// passes no unit gets the bound in the mesh's own units (the shadow LOD's 3 cm, set for float meshes; the crowd's
// casters pass theirs).
//
// A mesh with several material groups keeps its full index (a LOD would cross the group ranges). Until the WASM is
// ready (a few ms after boot; the loading screen awaits `lodReady`) nothing is simplified and every mesh draws whole.

import { BufferAttribute, BufferGeometry, type Camera, type Group, type Material, Matrix4, type Mesh, type Object3D, type SkinnedMesh, Vector3, type WebGLRenderer } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export const LOD = {
  /** sun shadow casters: target share of the triangles and the largest shape error (m, in the mesh's own units).
   *  weld: simplified over its positions alone (see lodIndex) */
  shadow: { ratio: 0.2, errorM: 0.03, weld: true },
  /** the per-actor rest outline hull (main pass; units and structures) */
  hull: { ratio: 0.5, errorM: 0.006, weld: true },
  /** the crowd's body, accent and outline hull (main pass): a bound in METRES (each mesh's dequantization); textured, so
   *  never welded (a collapse across a UV seam would smear the texture) */
  crowd: { ratio: 0.25, errorM: 0.012, weld: false },
  /** a fighter's body in the match (faceLockedLod): ratio, bound in metres, normal weight, the locked bone and weight */
  body: { ratio: 0.4, errorM: 0.012, normalW: 0.5, lockBone: 'head', lockW: 0.5 },
  /** a match fighter's ink copies (rest outline, victim flash, x-ray) over its LOD1 hull: a bound in metres */
  ink: { ratio: 0.4, errorM: 0.008, weld: true },
  /** meshes under this many triangles keep their index (the saving would not pay for a second buffer) */
  minTris: 600,
  /** an instanced caster (scatter: trees, rocks) draws its mesh once per instance: a LOD pays from this size */
  minTrisInstanced: 120,
  /** a crowd part (one draw per unit on screen, like an instanced caster) pays from this size */
  minTrisCrowd: 96,
} as const;

let ready = false;
/** resolves when the simplifier can run (the loading screen awaits it) */
export const lodReady: Promise<void> = MeshoptSimplifier.ready.then(() => { ready = true; }, () => { ready = false; });

type Key = 'shadow' | 'hull' | 'crowd' | 'ink';
/** per source index (or position, for a non-indexed mesh) attribute: the LOD per kind, null = not worth one */
const cache = new WeakMap<object, Partial<Record<Key, BufferAttribute | null>>>();

/** positions as a tight Float32Array (de-interleaved when needed) */
function positionsOf(g: BufferGeometry): Float32Array | null {
  const p = g.getAttribute('position');
  if (!p || p.itemSize < 3) return null;
  const n = p.count;
  if (!(p as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute && p.array instanceof Float32Array && p.itemSize === 3) return p.array.subarray(0, n * 3);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = p.getX(i); out[i * 3 + 1] = p.getY(i); out[i * 3 + 2] = p.getZ(i); }
  return out;
}

/**
 * A LOD index for `g` (`kind`: LOD.shadow, LOD.hull, LOD.crowd or LOD.ink), cached on its source index; null when the
 * mesh is too small, has material groups, is not triangles or the simplifier is not ready (then the caller draws it
 * whole). `unitM`: metres per position unit (dequantUnit; 1 = the bound is in the mesh's own units).
 * A welded kind (shadow, hull, ink: draws that read positions, skin and the hull's own welded normals, never a UV) is
 * simplified over its POSITIONS alone: every vertex is first mapped to the first vertex at the same position
 * (generatePositionRemap), so the LOD is watertight by construction (its triangles index only those canonical vertices,
 * whose position and skin the split copies share), and simplified 'Permissive' (the UV and hard-normal seams that split a
 * textured mesh no longer pin it; welding alone left meshopt's seam rules locking them). The fighters' ink over their LOD1
 * hull went 68k -> 44k triangles for ten, their shadow 41k -> 22k, a Wick's shadow 0.6-0.8 -> 0.25 of its body, within the
 * same bounds (integration run 2).
 */
export function lodIndex(g: BufferGeometry, kind: Key, minTris: number = LOD.minTris, unitM = 1): BufferAttribute | null {
  if (!ready) return null;
  const pos = g.getAttribute('position');
  if (!pos) return null;
  const key: object = g.index ?? pos;
  const hit = cache.get(key);
  if (hit && kind in hit) return hit[kind] ?? null;
  const entry = hit ?? {};
  cache.set(key, entry);
  entry[kind] = null;
  if (g.groups.length > 1) return null;
  const cfg = LOD[kind];
  const count = g.index ? g.index.count : pos.count;
  if (count / 3 < minTris || count % 3 !== 0) return null;
  const positions = positionsOf(g);
  if (!positions) return null;
  let src: Uint32Array;
  if (g.index) src = g.index.array instanceof Uint32Array ? g.index.array : Uint32Array.from(g.index.array as ArrayLike<number>);
  else { src = new Uint32Array(count); for (let i = 0; i < count; i++) src[i] = i; }
  if (src.length !== count) src = src.subarray(0, count);
  try {
    if (cfg.weld) {
      const remap = MeshoptSimplifier.generatePositionRemap(positions, 3);
      const w = new Uint32Array(count);
      for (let i = 0; i < count; i++) w[i] = remap[src[i]];
      src = w;
    }
    const scale = MeshoptSimplifier.getScale(positions, 3);
    if (!(scale > 0) || !(unitM > 0)) return null;
    const target = Math.max(3, Math.floor((count * cfg.ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(src, positions, 3, target, cfg.errorM / (unitM * scale), cfg.weld ? ['Permissive'] : []);
    if (!out.length || out.length > count * 0.85) return null;          // not worth a second buffer
    const arr = pos.count < 65536 ? Uint16Array.from(out) : out;
    const attr = new BufferAttribute(arr, 1);
    attr.name = `vale_lod_${kind}`;
    entry[kind] = attr;
    return attr;
  } catch {
    return null;
  }
}

// ── the shadow swap ─────────────────────────────────────────────────────────────────────────────
/** shadow: harness seam (_harness/probe_lod.mjs A/B), false draws every shadow caster whole. outline: whether an actor
 *  built now takes the outline-hull LOD (actors.ts) — the renderer turns it on for a match and off for the menu, whose
 *  showcase fighter stands 4-5x larger on screen than the 6 mm bound was set for. body: whether a fighter built now
 *  draws its face-locked LOD1 (actors.ts; the renderer sets it with `outline`, the menu keeps the full body) */
export const lodSwitch = { shadow: true, outline: false, body: false };
const shadowLod = new WeakMap<BufferGeometry, BufferAttribute>();
let swapped: { g: BufferGeometry; index: BufferAttribute | null } | null = null;

function beforeShadow(_r: WebGLRenderer, _o: Object3D, _c: Camera, _s: Camera, g: BufferGeometry, _m: Material, _grp: Group | null): void {
  const l = lodSwitch.shadow ? shadowLod.get(g) : undefined;
  if (!l) return;
  swapped = { g, index: g.index };
  g.index = l;
}
function afterShadow(_r: WebGLRenderer, _o: Object3D, _c: Camera, _s: Camera, g: BufferGeometry, _m?: Material, _grp?: Group | null): void {
  if (swapped && swapped.g === g) { g.index = swapped.index; swapped = null; }
}

type ShadowHook = (r: WebGLRenderer, o: Object3D, c: Camera, s: Camera, g: BufferGeometry, m: Material, grp: Group | null) => void;
/** install the swap, chained after a hook the mesh already has (instance_cull.ts sets the instance count there) */
function hook(m: Mesh): void {
  const own = (k: 'onBeforeShadow' | 'onAfterShadow'): ShadowHook | null => (Object.prototype.hasOwnProperty.call(m, k) ? (m[k] as ShadowHook) : null);
  const ob = own('onBeforeShadow'), oa = own('onAfterShadow');
  m.onBeforeShadow = ob ? function (this: Mesh, ...a: Parameters<ShadowHook>) { ob.apply(this, a); beforeShadow(...a); } : beforeShadow;
  m.onAfterShadow = oa ? function (this: Mesh, ...a: Parameters<ShadowHook>) { afterShadow(...a); oa.apply(this, a); } : afterShadow;
}

/** give geometry `g` its shadow LOD now (a template's body LOD1, a new crowd set), so the per-second sweep only hooks its
 *  meshes (the sweep's 4 ms budget left a heavy new geometry undone for many sweeps) */
export function prepareShadowLod(g: BufferGeometry, minTris: number = LOD.minTris, unitM = 1): void {
  if (!ready || shadowLod.has(g)) return;
  const l = lodIndex(g, 'shadow', minTris, unitM);
  if (l) shadowLod.set(g, l);
}

const hooked = new WeakSet<Object3D>();
/**
 * Give every shadow caster under `root` its shadow LOD (idempotent; a mesh is looked at once, its geometry's LOD is
 * built once and shared by every clone). `budgetMs` bounds the simplifier time of one call (the per-second sweep);
 * meshes left over are taken by the next call.
 */
export function shadowLods(root: Object3D, budgetMs = Infinity): void {
  if (!ready) return;
  const t0 = performance.now();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.castShadow || hooked.has(m)) return;
    if (performance.now() - t0 > budgetMs) return;
    hooked.add(m);
    const g = m.geometry;
    if (!g) return;
    if (!shadowLod.has(g)) {
      // an instanced caster draws its mesh once per instance, a crowd part (an instanced view) once per unit
      const min = (m as { isInstancedMesh?: boolean }).isInstancedMesh ? LOD.minTrisInstanced
        : (g as { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry ? LOD.minTrisCrowd : LOD.minTris;
      // a caster that knows its dequantization (crowd parts: crowd.ts) takes the 3 cm in metres
      const l = lodIndex(g, 'shadow', min, (m.userData as { valeLodUnit?: number }).valeLodUnit ?? 1);
      if (!l) return;
      shadowLod.set(g, l);
    }
    hook(m);
  });
}

// ── the fighter body's face-locked LOD1 (port of art/blender/fighters/_lod1_three.mjs) ──────────────
const _dq = new Matrix4();
const _dv = new Vector3();
/** metres per position unit of a skinned mesh as GLTFLoader built it (at rest, world matrices current): the
 *  skeleton carries KHR_mesh_quantization's dequantization (bone.matrixWorld x boneInverse x bindMatrix) */
export function dequantUnit(mesh: SkinnedMesh): number {
  const sk = mesh.skeleton;
  if (!sk || !sk.bones.length) return 1;
  _dq.copy(mesh.matrixWorld).invert().multiply(sk.bones[0].matrixWorld).multiply(sk.boneInverses[0]).multiply(mesh.bindMatrix);
  return _dv.setFromMatrixColumn(_dq, 0).length();
}

/**
 * The face-locked LOD1 index of a fighter's textured body (a SkinnedMesh with one material and an index), or null
 * (simplifier not ready, no `head` bone, nothing gained). Call it on the TEMPLATE's body at rest (its world matrices
 * current, never posed): the dequantization is read from its skeleton. LOD.body: 0.4 of the triangles within 12 mm,
 * normals weighted 0.5, every vertex skinned >= 0.5 to `head` locked (the chars lane's _lod1.mjs recipe, which
 * art/blender/fighters/_lod1_three.mjs checks at its own 0.5 / 10 mm). Returns the index (Uint16 under 65,536 vertices)
 * and both triangle counts.
 */
export function faceLockedLod(mesh: SkinnedMesh): { index: BufferAttribute; tris: number; lodTris: number } | null {
  if (!ready) return null;
  const cfg = LOD.body;
  const g = mesh.geometry;
  const P = g.getAttribute('position'), N = g.getAttribute('normal');
  const SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight');
  if (!mesh.isSkinnedMesh || !g.index || !P || !N || !SI || !SW || g.groups.length > 1) return null;
  const head = mesh.skeleton.bones.findIndex((b) => b.name === cfg.lockBone);
  if (head < 0) return null;
  const n = P.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), lock = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i);
    nrm[i * 3] = N.getX(i); nrm[i * 3 + 1] = N.getY(i); nrm[i * 3 + 2] = N.getZ(i);
    let hw = 0;
    for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === head) hw += SW.getComponent(i, k);
    if (hw >= cfg.lockW) lock[i] = 1;
  }
  const src = g.index.array instanceof Uint32Array ? g.index.array : Uint32Array.from(g.index.array as ArrayLike<number>);
  const tris = src.length / 3;
  try {
    const unitM = dequantUnit(mesh);
    const extent = MeshoptSimplifier.getScale(pos, 3);
    if (!(unitM > 0) || !(extent > 0)) return null;
    const target = Math.max(3, Math.floor(tris * cfg.ratio) * 3);
    const w = cfg.normalW;
    const [lod] = MeshoptSimplifier.simplifyWithAttributes(src, pos, 3, nrm, 3, [w, w, w], lock, target, cfg.errorM / (unitM * extent), []);
    if (!lod.length || lod.length >= src.length) return null;
    const attr = new BufferAttribute(n < 65536 ? Uint16Array.from(lod) : lod, 1);
    attr.name = 'vale_lod_body';
    return { index: attr, tris, lodTris: lod.length / 3 };
  } catch {
    return null;
  }
}

/** a geometry drawing `index` over `g`'s own attributes (no copy; the bounds are g's). Disposed with g: three frees
 *  every attribute a disposed geometry holds, so the view must never be disposed while g still draws */
export function indexView(g: BufferGeometry, index: BufferAttribute, name: string): BufferGeometry {
  const v = new BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) v.setAttribute(k, a);
  for (const k of Object.keys(g.morphAttributes) as (keyof BufferGeometry['morphAttributes'])[]) v.morphAttributes[k] = g.morphAttributes[k];
  v.morphTargetsRelative = g.morphTargetsRelative;
  v.setIndex(index);
  if (!g.boundingSphere) g.computeBoundingSphere();
  v.boundingSphere = g.boundingSphere;
  if (g.boundingBox) v.boundingBox = g.boundingBox;
  v.name = name;
  g.addEventListener('dispose', () => v.dispose());
  return v;
}

/** a merged hull's index with some members' triangles swapped for their LOD (`lodOf(mesh)`, null = keep the member's
 *  own): `members` are hullPlan's (actors.ts), each one's mesh, first vertex, first index and index count */
export function composeIndex(g: BufferGeometry, members: readonly { mesh: number; vo: number; io: number; n: number }[], lodOf: (mesh: number) => ArrayLike<number> | null): BufferAttribute | null {
  const src = g.index;
  if (!src) return null;
  let total = 0, swapped = false;
  for (const m of members) { const l = lodOf(m.mesh); if (l) swapped = true; total += l ? l.length : m.n; }
  if (!swapped) return null;
  const I = g.getAttribute('position').count > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let o = 0;
  for (const m of members) {
    const l = lodOf(m.mesh);
    if (l) for (let i = 0; i < l.length; i++) I[o++] = l[i] + m.vo;
    else for (let i = 0; i < m.n; i++) I[o++] = src.getX(m.io + i);
  }
  const attr = new BufferAttribute(I, 1);
  attr.name = 'vale_lod_composed';
  return attr;
}
