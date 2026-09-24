// BLOCKTOOTH — shared materials (CONTRACT.md §6, §6.1). render-core lane.
//
// The look is "a Saturday-morning kaiju comic as a clean 3D diorama":
//   * MeshToonMaterial + a 3-band ramp (toonRamp) + painted vertex colours.
//   * Facets BY CONSTRUCTION. three r186's MeshToonMaterial has NO `flatShading` property
//     (setValues warns and ignores it), so geometry is made non-indexed with per-face normals
//     via `facet(geo)`. `makeToon({flat: true})` is the material-side fallback: it defines
//     FLAT_SHADED so the toon shader derives face normals from screen-space derivatives
//     (works on any geometry, incl. shared indexed geometry on an InstancedMesh).
//   * Ink outlines: an inverted hull drawn with BackSide, extruded in CLIP space along the
//     projected smooth `outlineNormal`, so the line width is constant in screen pixels at every
//     camera distance (a 30x zoom range in this game). Faceted hard edges do not split the
//     silhouette because the hull uses the welded, averaged `outlineNormal`, not `normal`.
//
// ─── How an outline hull stays in sync with an InstancedMesh (callers read this) ───
// `addOutline(instancedMesh)` returns a child InstancedMesh whose `instanceMatrix`, `count`,
// `geometry`, `boundingSphere`, `boundingBox` and `frustumCulled` are ACCESSORS onto the
// source mesh. The hull therefore uses the very same InstancedBufferAttribute object: callers
// update the SOURCE only (setMatrixAt …; source.instanceMatrix.needsUpdate = true;
// source.count = n; source.computeBoundingSphere()) and the hull follows automatically — one
// GPU buffer, one upload, no second bookkeeping pass. Replacing the source's instanceMatrix
// attribute or its geometry is also followed (the hull re-reads them every frame). The hull
// is a child with an identity transform, so it inherits visibility and the world matrix.

import * as THREE from 'three';

/** Ink colour for every outline in the game. */
export const INK = '#1b1426';

/** Outline widths (CSS px, scaled by the renderer DPR) — CONTRACT §6.1. */
export const OUTLINE_PX = { titan: 3.0, boss: 3.0, enemy: 2.0, vehicle: 2.0, building: 1.6, prop: 1.6 } as const;

// ─────────────────────────────── toon ramp ───────────────────────────────
// The toon shader samples the ramp at u = dot(N, L) * 0.5 + 0.5 (red channel).
// Three bands: SHADE (turned away from the light: only fill light — matches cast shadows, so
// form shadow and cast shadow read as ONE flat comic tone), HALF (grazing), LIT.
// Thresholds are in ramp-u space: u < RAMP_T0 → SHADE, u < RAMP_T1 → HALF, else LIT.
const RAMP_N = 64;
const RAMP_T0 = 0.49;   // dot(N,L) < -0.02
const RAMP_T1 = 0.62;   // dot(N,L) <  0.24
const RAMP_SHADE = 0.0;
const RAMP_HALF = 0.5;
const RAMP_LIT = 1.0;

let rampTex: THREE.DataTexture | null = null;

/** Shared 3-band toon gradient (NearestFilter, no mipmaps). One texture for the whole game. */
export function toonRamp(): THREE.Texture {
  if (rampTex) return rampTex;
  const data = new Uint8Array(RAMP_N * 4);
  for (let i = 0; i < RAMP_N; i++) {
    const u = (i + 0.5) / RAMP_N;
    const v = u < RAMP_T0 ? RAMP_SHADE : u < RAMP_T1 ? RAMP_HALF : RAMP_LIT;
    const b = Math.round(v * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, RAMP_N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'toonRamp';
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  rampTex = tex;
  return tex;
}

// ─────────────────────────────── toon material ───────────────────────────────
export interface ToonOpts {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  /** derive face normals in the fragment shader (FLAT_SHADED) — use when the geometry is not
   *  already faceted by construction (see `facet`). */
  flat?: boolean;
}

/** Toon material on the shared 3-band ramp. Receives fog + shadows (set receiveShadow on meshes). */
export function makeToon(opts: ToonOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: opts.vertexColors === true,
    gradientMap: toonRamp(),
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  if (opts.flat) {
    // r186 builds `#define FLAT_SHADED` only from material.flatShading, which MeshToonMaterial
    // does not declare; a custom define reaches both shader stages identically.
    m.defines = { ...(m.defines ?? {}), FLAT_SHADED: '' };
  }
  return m;
}

// ─────────────────────────────── geometry helpers ───────────────────────────────
/**
 * Faceted copy of a geometry: non-indexed, one normal per face (the r186 toon look is faceted
 * BY CONSTRUCTION). Every other attribute (colour, uv, an already-baked outlineNormal) is
 * carried over. The input is not modified.
 */
export function facet(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (g.getAttribute('normal')) g.deleteAttribute('normal');
  g.computeVertexNormals();          // non-indexed → each triangle gets its own face normal
  return g;
}

/**
 * Adds a smooth `outlineNormal` attribute (itemSize 3): vertices are welded by quantised
 * position and the ANGLE-weighted face normals of every triangle touching the welded point are
 * averaged (angle weighting makes a box corner come out as the true (1,1,1)/√3 regardless of how
 * its faces were triangulated). Works on indexed and non-indexed geometry. Returns `geo`
 * (mutated) for chaining. Idempotent: re-baking overwrites the attribute.
 */
export function bakeOutlineNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return geo;
  const n = pos.count;
  const index = geo.index;

  // weld tolerance relative to the geometry's size
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const diag = Math.max(1e-6, Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z));
  const inv = 1 / Math.max(diag * 1e-5, 1e-7);

  const group = new Int32Array(n);
  const map = new Map<string, number>();
  let groups = 0;
  for (let i = 0; i < n; i++) {
    const key = Math.round(pos.getX(i) * inv) + '|' + Math.round(pos.getY(i) * inv) + '|' + Math.round(pos.getZ(i) * inv);
    let g = map.get(key);
    if (g === undefined) { g = groups++; map.set(key, g); }
    group[i] = g;
  }

  const acc = new Float64Array(groups * 3);
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(n / 3);
  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
    // face normal (b-a) × (c-a)
    let fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-12) continue;        // degenerate triangle
    fx /= fl; fy /= fl; fz /= fl;
    const lab = Math.hypot(abx, aby, abz), lac = Math.hypot(acx, acy, acz), lbc = Math.hypot(bcx, bcy, bcz);
    if (lab < 1e-12 || lac < 1e-12 || lbc < 1e-12) continue;
    const angA = Math.acos(clamp1((abx * acx + aby * acy + abz * acz) / (lab * lac)));
    const angB = Math.acos(clamp1((-abx * bcx - aby * bcy - abz * bcz) / (lab * lbc)));
    const angC = Math.max(0, Math.PI - angA - angB);
    const ga = group[ia] * 3, gb = group[ib] * 3, gc = group[ic] * 3;
    acc[ga] += fx * angA; acc[ga + 1] += fy * angA; acc[ga + 2] += fz * angA;
    acc[gb] += fx * angB; acc[gb + 1] += fy * angB; acc[gb + 2] += fz * angB;
    acc[gc] += fx * angC; acc[gc + 1] += fy * angC; acc[gc + 2] += fz * angC;
  }

  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = group[i] * 3;
    let x = acc[g], y = acc[g + 1], z = acc[g + 2];
    let l = Math.hypot(x, y, z);
    if (l < 1e-8) {
      // opposing faces cancelled (thin double-sided sheet) → own normal, else up
      if (nrm) { x = nrm.getX(i); y = nrm.getY(i); z = nrm.getZ(i); l = Math.hypot(x, y, z); }
      if (l < 1e-8) { x = 0; y = 1; z = 0; l = 1; }
    }
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  geo.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  return geo;
}

function clamp1(v: number): number { return v < -1 ? -1 : v > 1 ? 1 : v; }

// ─────────────────────────────── outline material ───────────────────────────────
const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 outlineNormal;
uniform float uWidthPx;     // requested width in CSS px
uniform float uPxScale;     // device px per CSS px for the current target (DPR for the canvas, 1 for RTs)
uniform vec2 uResolution;   // current viewport size in device px
void main() {
  vec3 objectNormal = outlineNormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 n = objectNormal;
  #ifdef USE_INSTANCING
    // inverse-transpose of a rotation*scale instance matrix (same trick as three's defaultnormal_vertex)
    mat3 im = mat3( instanceMatrix );
    n /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
    n = im * n;
  #endif
  vec3 viewN = normalMatrix * n;
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  // Extrude in clip space along the SCREEN projection of the normal, by a constant pixel width.
  float nl = length( viewN );
  if ( nl > 1e-6 && gl_Position.w > 0.0 ) {
    viewN /= nl;
    float s = max( abs( mvPosition.z ), 1e-3 ) * 0.01;
    vec4 c1 = projectionMatrix * vec4( mvPosition.xyz + viewN * s, 1.0 );
    if ( c1.w > 0.0 ) {
      vec2 d = ( c1.xy / c1.w - gl_Position.xy / gl_Position.w ) * uResolution;
      float dl = length( d );
      if ( dl > 1e-6 ) {
        gl_Position.xy += ( d / dl ) * ( 2.0 * uWidthPx * uPxScale / uResolution ) * gl_Position.w;
      }
    }
  }
  #include <fog_vertex>
}
`;

const OUTLINE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface OutlineOpts {
  /** screen width in CSS px (× renderer DPR on the canvas). Default 2.0. */
  widthPx?: number;
  color?: THREE.ColorRepresentation;
  /** Accepted for API symmetry. The shader self-selects: three defines USE_INSTANCING for an
   *  InstancedMesh (and USE_SKINNING for a SkinnedMesh), so one material serves Mesh,
   *  InstancedMesh and SkinnedMesh; three keeps one program variant per object type. */
  instanced?: boolean;
}

const _vp = new THREE.Vector4();

/** Keeps uResolution / uPxScale in step with whatever target+viewport is being drawn. */
function outlineBeforeRender(this: THREE.ShaderMaterial, renderer: THREE.WebGLRenderer,
  _scene: THREE.Scene, _camera: THREE.Camera, geometry: THREE.BufferGeometry): void {
  if (!geometry.getAttribute('outlineNormal') && geometry.getAttribute('position')) bakeOutlineNormals(geometry);
  renderer.getCurrentViewport(_vp);
  const rt = renderer.getRenderTarget();
  const w = Math.max(1, _vp.z), h = Math.max(1, _vp.w);
  const s = rt ? 1 : renderer.getPixelRatio();
  const u = this.uniforms;
  const res = u.uResolution.value as THREE.Vector2;
  if (res.x !== w || res.y !== h || u.uPxScale.value !== s) {
    res.set(w, h);
    u.uPxScale.value = s;
    this.uniformsNeedUpdate = true;
  }
}

/** Inverted-hull ink outline (BackSide, depthWrite on, constant pixel width, fogged, exact INK). */
export function makeOutlineMaterial(opts: OutlineOpts = {}): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uColor: { value: new THREE.Color(opts.color ?? INK) },
      uWidthPx: { value: opts.widthPx ?? 2.0 },
      uPxScale: { value: 1 },
      uResolution: { value: new THREE.Vector2(1280, 720) },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    name: 'inkOutline',
    uniforms,
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    depthWrite: true,
    depthTest: true,
    fog: true,
    toneMapped: false,          // INK reads exactly #1b1426 on screen
  });
  mat.userData.instancedHint = opts.instanced === true;
  mat.onBeforeRender = outlineBeforeRender as unknown as THREE.Material['onBeforeRender'];
  return mat;
}

/** Outline materials are shared per (width, colour) so hulls batch on one program + material. */
const outlineCache = new Map<string, THREE.ShaderMaterial>();
function sharedOutline(widthPx: number, color: THREE.ColorRepresentation = INK): THREE.ShaderMaterial {
  const key = widthPx.toFixed(3) + '|' + new THREE.Color(color).getHexString();
  let m = outlineCache.get(key);
  if (!m) { m = makeOutlineMaterial({ widthPx, color }); outlineCache.set(key, m); }
  return m;
}

function noRaycast(): void { /* hulls are never picked */ }

/**
 * Adds an ink hull as a CHILD of `mesh` (identity transform, renderOrder −1, no shadows,
 * not raycastable) and returns it. Geometry is shared (an `outlineNormal` attribute is baked
 * onto it if missing). For an InstancedMesh the hull mirrors instanceMatrix/count/bounds/
 * frustumCulled by accessor — see the header comment. For a SkinnedMesh the hull binds to the
 * same skeleton.
 */
export function addOutline(mesh: THREE.Mesh | THREE.InstancedMesh, widthPx: number = 2.0): THREE.Mesh {
  const src = mesh as THREE.Mesh;
  if (!src.geometry.getAttribute('outlineNormal')) bakeOutlineNormals(src.geometry);
  const mat = sharedOutline(widthPx);
  let hull: THREE.Mesh;

  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const inst = mesh as THREE.InstancedMesh;
    const h = new THREE.InstancedMesh(inst.geometry, mat, 0);
    Object.defineProperty(h, 'instanceMatrix', { configurable: true, get: () => inst.instanceMatrix, set: () => { /* follows source */ } });
    Object.defineProperty(h, 'count', { configurable: true, get: () => inst.count, set: () => { /* follows source */ } });
    Object.defineProperty(h, 'boundingSphere', {
      configurable: true, get: () => inst.boundingSphere,
      set: (v: THREE.Sphere | null) => { inst.boundingSphere = v; },
    });
    Object.defineProperty(h, 'boundingBox', {
      configurable: true, get: () => inst.boundingBox,
      set: (v: THREE.Box3 | null) => { inst.boundingBox = v; },
    });
    hull = h;
  } else if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const sk = mesh as THREE.SkinnedMesh;
    const h = new THREE.SkinnedMesh(sk.geometry, mat);
    h.bindMode = sk.bindMode;
    h.bind(sk.skeleton, sk.bindMatrix);
    hull = h;
  } else {
    hull = new THREE.Mesh(src.geometry, mat);
  }

  Object.defineProperty(hull, 'geometry', { configurable: true, get: () => src.geometry, set: () => { /* follows source */ } });
  Object.defineProperty(hull, 'frustumCulled', { configurable: true, get: () => src.frustumCulled, set: () => { /* follows source */ } });
  hull.name = (mesh.name || mesh.type) + ':ink';
  hull.renderOrder = -1;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.matrixAutoUpdate = false;            // identity local transform, forever
  hull.raycast = noRaycast;
  hull.userData.isOutline = true;
  hull.userData.outlineOf = mesh;
  mesh.add(hull);
  return hull;
}
