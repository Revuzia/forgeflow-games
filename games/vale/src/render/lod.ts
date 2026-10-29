// VALE render — triangle LODs (perf PERF-m5): simplified index buffers over a mesh's OWN vertices (meshoptimizer's
// simplifier, WASM), so a LOD shares every vertex attribute with its mesh — positions, normals, UVs and the skin
// weights, which keeps it animating with the same skeleton — and costs one extra index buffer.
//
//   shadow    every shadow caster in the match (fighters, units, structures, landmarks, props, the crowd) draws its
//             depth into the sun's map through a LOD: about a fifth of its triangles, the shape held within 3 cm (under
//             a shadow-map texel at the lane camera, then softened by the PCF filter). The swap happens in the
//             caster's onBeforeShadow / onAfterShadow, so the main pass never sees it. three keys its vertex-array
//             state by (geometry, program) and re-binds when the index differs, and the depth programs never draw
//             the main pass, so the swap costs no re-binding per frame.
//   hull      the crowd (crowd.ts: Wicks and small monsters; Wicks have no face) draws its body, accent and rest-outline
//             hull through one LOD of half the triangles held within 6 mm (under half a pixel at the closest zoom: a
//             Wick is ~70 px tall for ~1.1 m), the same index for all three so the ink hull keeps hugging the body.
//             Fighters and structures keep their full meshes in the main pass.
//
// A mesh with several material groups keeps its full index (a LOD would cross the group ranges). Until the WASM is
// ready (a few ms after boot; the loading screen awaits `lodReady`) nothing is simplified and every mesh draws whole.

import { BufferAttribute, type BufferGeometry, type Camera, type Group, type Material, type Mesh, type Object3D, type WebGLRenderer } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export const LOD = {
  /** sun shadow casters: target share of the triangles and the largest shape error (m, in the mesh's own units) */
  shadow: { ratio: 0.2, errorM: 0.03 },
  /** the crowd's outline hull (main pass) */
  hull: { ratio: 0.5, errorM: 0.006 },
  /** meshes under this many triangles keep their index (the saving would not pay for a second buffer) */
  minTris: 600,
} as const;

let ready = false;
/** resolves when the simplifier can run (the loading screen awaits it) */
export const lodReady: Promise<void> = MeshoptSimplifier.ready.then(() => { ready = true; }, () => { ready = false; });

type Key = 'shadow' | 'hull';
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
 * A LOD index for `g` (`kind`: LOD.shadow or LOD.hull), cached on its source index; null when the mesh is too small,
 * has material groups, is not triangles or the simplifier is not ready (then the caller draws it whole).
 */
export function lodIndex(g: BufferGeometry, kind: Key): BufferAttribute | null {
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
  if (count / 3 < LOD.minTris || count % 3 !== 0) return null;
  const positions = positionsOf(g);
  if (!positions) return null;
  let src: Uint32Array;
  if (g.index) src = g.index.array instanceof Uint32Array ? g.index.array : Uint32Array.from(g.index.array as ArrayLike<number>);
  else { src = new Uint32Array(count); for (let i = 0; i < count; i++) src[i] = i; }
  if (src.length !== count) src = src.subarray(0, count);
  try {
    const scale = MeshoptSimplifier.getScale(positions, 3);
    if (!(scale > 0)) return null;
    const target = Math.max(3, Math.floor((count * cfg.ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(src, positions, 3, target, cfg.errorM / scale, []);
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
/** harness seam (_harness/probe_lod.mjs A/B): false draws every shadow caster whole */
export const lodSwitch = { shadow: true };
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
      const l = lodIndex(g, 'shadow');
      if (!l) return;
      shadowLod.set(g, l);
    }
    hook(m);
  });
}
