// GENESIS — PERF s22 `?tcache=1` (default OFF): the terrain MATERIAL CACHE — texture-space shading of the ground.
//
// The surface function (terrainmat.ts evalTerrain: ~40-125 simplex evaluations a fragment) is evaluated ONCE per texel
// into per-patch tiles, and again only when its inputs change; the per-frame terrain fragment then takes 6 texture
// taps (two distance anchors x three targets) and runs the unchanged lighting. A patch without a valid tile draws with
// the full shader (the same picture at the old cost), so nothing is ever shown stale except the two slow inputs named
// below (sun direction, season).
//
// STORE (3 targets, 16 B a texel + 2 mips): T0 sRGB8_A8 albedo / 1.5, roughness; T1 RGBA16F D (body frame; the
// shading normal is normalize(N - D): the bump height's surface gradient + the micro normal, folded exactly as the
// live path nests them), ao; T2 RGBA8 sky, sward, glint (the share of sparkling facets), 1.
// TILES: one square per patch in a 2D array texture (TC_SL^2 layers cut in slabs of one size class each). The patch's
// triangular lattice fills the lower-left half (anchor A) and, rotated by 180 degrees, the upper-right half (anchor B),
// each with a BORDER-texel margin filled by the patch's own skirt, pushed outward in tile space and EXTRAPOLATED in
// the body frame (so the border texels hold the function just outside the patch, as the neighbour's tile does).
// DISTANCE: evalTerrain's camera-distance fades (crop under-storey, mid-distance breakup, gullies, canopy / shrub
// hand-over) are baked at two fixed distances, the knots of a global ladder 14 * 2^(i/2) m that bracket the patch's
// distance range; the fragment blends the two by its own live camera distance. No re-bake while the patch stays in
// its bracket. EYE: the sward's grazing term is baked at one value per tile (quantised) and corrected per fragment to
// first order. FOOTPRINT: the bake's footprint is the texel's; the tile's size class keeps texels at least as dense
// as the patch's pixels (required = patch edge in pixels at its nearest point); minification goes through mips +
// anisotropic filtering, clamped to the mip the tile borders allow.
// LIVE (full shader): patches with lava or fire (uTime), patches nearer than the largest class resolves, patches
// whose tile is not baked yet / out of its bracket / changed by the sim, and everything once the memory cap is full.
import {
  DataArrayTexture, DataTexture, DoubleSide, FloatType, HalfFloatType, LinearFilter, Mesh, RGBAFormat, Scene, SRGBColorSpace,
  UnsignedByteType, Vector3, Vector4, WebGLRenderTarget, NearestFilter,
  type BatchedMesh, type Camera, type IUniform, type Material, type Texture, type WebGLRenderer,
} from 'three';
import { perfNum, perfSwitch, perfSwitchNote } from '../perfswitch.ts';
import { texUpload } from '../uploadsched.ts';
import { NPTS, NVERT, PATCH_RES } from './patchbuild.ts';
import type { ChunkLOD, Patch } from './chunks.ts';

export const TCACHE = perfSwitch('tcache', false);
/** memory cap (MB) for the tiles + the bake scratch; `?tcmb=` */
const TC_MB = TCACHE ? perfNum('tcmb', 256)! : 256;
/** texels evaluated per frame at most (two anchors count twice); `?tcbudget=` */
const TC_BUDGET = TCACHE ? perfNum('tcbudget', 200000)! : 0;
/** mip bias of the display taps (0 = the footprint's own mip); `?tcbias=` */
const TC_BIAS = TCACHE ? perfNum('tcbias', 0)! : 0;

/** layer edge (texels), slab edge, and the tile classes (edge in texels; SLAB / class tiles a side) */
export const TC_SL = 1152;
const SLAB = 576;
const CLASSES = [96, 144, 192, 288, 576];
const BORDER = 2;
const PAD = BORDER * (2 + Math.SQRT2);
const MIPS = 3;
const KNOT0 = 14;

const R = PATCH_RES;
const f1 = (x: number): string => x.toFixed(4);

/** shared by the display and the bake programs (vertex): the lattice position of a patch vertex from its index */
export const TC_VERT_PARS = /* glsl */ `
#ifdef TC_BAKE
uniform vec4 uTcBake;    // tile edge (texels), anchor (0 A, 1 B), the slot's first vertex, 0
uniform vec3 uTcEi;      // the patch's lattice steps in the body frame (m): the skirt extrapolates the border with them
uniform vec3 uTcEj;
vec2 tcClip;
#else
flat varying vec4 vTc0;  // layer (-1: no tile, full shader), tile origin (uv), tile edge (uv)
flat varying vec4 vTc1;  // knot A (m), knot B (m), baked graze, 0
varying vec4 vTcUV;      // anchor A uv, anchor B uv
#endif
void tcLattice(int lv, out vec2 lat, out vec2 push) {
  push = vec2(0.0);
  if (lv < ${NPTS}) {
    float l = float(lv);
    float j = floor((${f1(2 * R + 3)} - sqrt(${f1((2 * R + 3) ** 2 - 0.25)} - 8.0 * l)) * 0.5);
    lat = vec2(l - j * (${f1(2 * R + 3)} - j) * 0.5, j);
  } else {
    int k = lv - ${NPTS};
    if (k < ${R}) { lat = vec2(float(k), 0.0); push = k == 0 ? vec2(-1.0, -1.0) : vec2(0.0, -1.0); }
    else if (k < ${2 * R}) { int j = k - ${R}; lat = vec2(float(${R} - j), float(j)); push = j == 0 ? vec2(2.41421, -1.0) : vec2(0.70711, 0.70711); }
    else { int m = k - ${2 * R}; lat = vec2(0.0, float(${R} - m)); push = m == 0 ? vec2(-1.0, 2.41421) : vec2(-1.0, 0.0); }
  }
  lat *= ${f1(1 / R)};
}
`;

/** after TERRAIN_VERT_CORE and the varyings (tPos, vBodyPos are set) */
export const TC_VERT_MAIN = /* glsl */ `
  {
#ifdef TC_BAKE
    int tcLv = gl_VertexID - int(uTcBake.z);
    vec2 tcLat, tcPush;
    tcLattice(tcLv, tcLat, tcPush);
    float tcL = uTcBake.x - ${f1(PAD)};
    vec2 tcQ = (${f1(BORDER)} + tcL * tcLat + tcPush * ${f1(BORDER)}) / uTcBake.x;
    if (uTcBake.y > 0.5) tcQ = 1.0 - tcQ;
    tcClip = tcQ * 2.0 - 1.0;
    // the border: the function just outside the patch (the fields and the normal stay the edge's)
    vBodyPos += (uTcEi * tcPush.x + uTcEj * tcPush.y) * (${f1(BORDER * R)} / tcL);
#else
    int tcSlot = gl_VertexID / ${NVERT};
    int tcLv = gl_VertexID - tcSlot * ${NVERT};
    vec2 tcLat, tcPush;
    tcLattice(tcLv, tcLat, tcPush);
#ifdef USE_BATCHING_COLOR
    vTc0 = texelFetch(batchingColorTexture, ivec2((tcSlot % 4) * 2, tcSlot / 4), 0);
    vTc1 = texelFetch(batchingColorTexture, ivec2((tcSlot % 4) * 2 + 1, tcSlot / 4), 0);
#else
    vTc0 = vec4(-1.0, 0.0, 0.0, 0.0);
    vTc1 = vec4(0.0);
#endif
    vec2 tcA = (${f1(BORDER)} + (vTc0.w * ${f1(TC_SL)} - ${f1(PAD)}) * tcLat) * ${(1 / TC_SL).toFixed(8)};
    vTcUV = vec4(vTc0.yz + tcA, vTc0.yz + vTc0.w - tcA);
#endif
  }
`;

export const TC_FRAG_PARS = /* glsl */ `
#ifdef TC_BAKE
uniform vec4 uTcBakeF;   // anchor distance (m), baked graze, 0, 0
uniform vec4 uTcBakeK;   // D scale, D offset (8-bit fallback)
#define tcGlintK 1.0
layout(location = 1) out highp vec4 tcOut1;
layout(location = 2) out highp vec4 tcOut2;
#else
flat varying vec4 vTc0;
flat varying vec4 vTc1;
varying vec4 vTcUV;
uniform highp sampler2DArray uTc0;
uniform highp sampler2DArray uTc1;
uniform highp sampler2DArray uTc2;
uniform vec4 uTcK;       // gradient scale (2^bias), D scale, D offset, 0
float tcGlintK = 1.0;
#endif
`;

/** the display fetch: declared after TSurf; dx / dy are the screen derivatives of anchor A's uv (taken outside the branch) */
export const TC_FRAG_FETCH = /* glsl */ `
#ifndef TC_BAKE
TSurf tcFetch(vec2 dx, vec2 dy, float camDist, float graze, out vec3 D) {
  // the footprint, held to the mip the tile borders allow (2 texels at mip 0: mip 1.5 with 16x anisotropy)
  vec2 gx = dx * ${f1(TC_SL)}, gy = dy * ${f1(TC_SL)};
  float lx = length(gx), ly = length(gy);
  float eff = max(min(lx, ly), max(lx, ly) * 0.0625) * uTcK.x;
  float sc = uTcK.x * min(1.0, 2.83 / max(eff, 1e-6));
  dx *= sc; dy *= sc;
  vec3 pa = vec3(vTcUV.xy, vTc0.x), pb = vec3(vTcUV.zw, vTc0.x);
  float t = clamp((camDist - vTc1.x) / max(vTc1.y - vTc1.x, 1e-3), 0.0, 1.0);
  vec4 c0 = mix(textureGrad(uTc0, pa, dx, dy), textureGrad(uTc0, pb, dx, dy), t);
  vec4 c1 = mix(textureGrad(uTc1, pa, dx, dy), textureGrad(uTc1, pb, dx, dy), t);
  vec4 c2 = mix(textureGrad(uTc2, pa, dx, dy), textureGrad(uTc2, pb, dx, dy), t);
  TSurf s;
  s.albedo = c0.rgb * 1.5;
  s.rough = clamp(c0.a, 0.04, 1.0);
  D = c1.xyz * uTcK.y + uTcK.z;
  s.ao = c1.w;
  s.sky = c2.x;
  s.sward = c2.y;
  tcGlintK = c2.z;
  s.glint = c2.z > 0.004 ? 1.0 : 0.0;
  s.bump = 0.0; s.emis = vec3(0.0); s.microG = vec3(0.0);
  // the sward's grazing tone (groundfloor.ts swardDetail) was baked at vTc1.z: first-order correction to this eye
  s.albedo *= 1.0 + s.sward * (mix(0.94, 1.07, graze) / mix(0.94, 1.07, vTc1.z) - 1.0);
  return s;
}
#endif
`;

/** the bake's outputs: after `TSurf ts = evalTerrain(...)` in the bake program (then main returns) */
export const TC_FRAG_BAKE_OUT = /* glsl */ `
  {
    vec3 tcN = normalize(vBodyN);
    vec3 tcSx = dFdx(vBodyPos), tcSy = dFdy(vBodyPos);
    vec2 tcDh = vec2(dFdx(ts.bump), dFdy(ts.bump));
    vec3 tcR1 = cross(tcSy, tcN), tcR2 = cross(tcN, tcSx);
    float tcDet = dot(tcSx, tcR1);
    vec3 tcG = abs(tcDet) > 1e-20 ? (tcDh.x * tcR1 + tcDh.y * tcR2) / tcDet : vec3(0.0);
    if (any(isnan(tcG))) tcG = vec3(0.0);
    vec3 tcD = tcG + length(tcN - tcG) * ts.microG;
    gl_FragColor = vec4(clamp(ts.albedo * ${f1(1 / 1.5)}, 0.0, 1.0), ts.rough);
    tcOut1 = vec4(tcD * uTcBakeK.x + uTcBakeK.y, ts.ao);
    tcOut2 = vec4(ts.sky, ts.sward, step(0.997, ts.glint), 1.0);
    return;
  }
`;

/** a page's slot table (8 x 4 RGBA32F: two texels a slot), bound by three as the batch's colour texture */
export function tcInitPage(mesh: BatchedMesh): void {
  const data = new Float32Array(8 * 4 * 4);
  for (let k = 0; k < 16; k++) data[k * 8] = -1;
  const t = new DataTexture(data, 8, 4, RGBAFormat, FloatType);
  t.minFilter = NearestFilter; t.magFilter = NearestFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  (mesh as unknown as { _colorsTexture: DataTexture })._colorsTexture = t;
}

interface Slab { layer: number; x: number; y: number; cls: number; free: number[]; used: number }
interface Tile {
  cls: number; slab: Slab | null; sub: number;
  kA: number; kB: number; g: number;
  sun: Vector3; year: number; gkey: string;
  baked: boolean; dirty: boolean; stale: boolean; hot: boolean; hotEpoch: number;
  lastUsed: number; dn: number;
}

const _c = new Vector3(), _a = new Vector3(), _b = new Vector3(), _d = new Vector3();
const knotAt = (i: number): number => KNOT0 * Math.pow(2, i / 2);

/** per-channel change (since the value a tile may have been baked with) that re-bakes the tiles of a cell */
const WATCH: Record<string, [number, number, number, number]> = {
  A: [0.02, 0.02, 0.05, 0.05], N: [0.01, 0.01, 0.01, 0.05], M0: [0.02, 0.02, 0.02, 0.02], M1: [0.004, 0.03, 0.02, 0.02],
  V: [0.02, 0.02, 0.02, 0.02], C: [1.0, 0.03, 0.02, 0.004], S: [0.5, 0.5, 1e9, 0.5], O: [0.02, 0.02, 0.02, 0.02],
  G: [0.01, 0.01, 0.01, 0.01], D: [0.02, 1e9, 1e9, 1e9],
};

export interface TcStats {
  on: boolean; mb: number; layers: number; float: boolean; tiles: number; cached: number; live: number; hot: number; near: number; full: number;
  queued: number; bakes: number; bakesTotal: number; texels: number; rebakeDirty: number; rebakeKnot: number; rebakeClass: number; rebakeSlow: number; globals: number; dirtyCells: number;
}

export class TerrainCache {
  readonly stats: TcStats = { on: true, mb: 0, layers: 0, float: true, tiles: 0, cached: 0, live: 0, hot: 0, near: 0, full: 0, queued: 0, bakes: 0, bakesTotal: 0, texels: 0, rebakeDirty: 0, rebakeKnot: 0, rebakeClass: 0, rebakeSlow: 0, globals: 0, dirtyCells: 0 };
  /** `false` = every patch draws with the full shader (in-page A/B: frame-adjacent pairs) */
  enabled = true;
  private readonly tex: DataArrayTexture[] = [];
  private glTex: WebGLTexture[] = [];
  private layers = 0;
  private slabs: Slab[] = [];
  private tiles = new Map<Patch, Tile>();
  private queue: Patch[] = [];
  private scratch = new Map<number, WebGLRenderTarget>();
  private fbR: WebGLFramebuffer | null = null;
  private fbD: WebGLFramebuffer | null = null;
  private readonly scene = new Scene();
  private readonly mesh: Mesh;
  private readonly bakeMat: Material;
  private readonly lod: ChunkLOD;
  private readonly shared: Record<string, IUniform>;
  private readonly fieldTex: Record<string, DataTexture>;
  private readonly cellCount: number;
  private ref = new Map<string, Float32Array>();
  private seen = new Map<string, number>();
  private dirtyCell: Uint8Array;
  private fieldEpoch = 0;
  private gkey = '';
  private frame = 0;
  private pxPerRad = 0;
  private readonly cam = new Vector3();
  private selfBlit = true;
  private checked = false;
  private levelMorph: (level: number) => IUniform<Vector4>;

  constructor(lod: ChunkLOD, shared: Record<string, IUniform>, fieldTex: Record<string, DataTexture>, cellCount: number, bakeMat: Material, levelMorph: (level: number) => IUniform<Vector4>) {
    this.lod = lod; this.shared = shared; this.fieldTex = fieldTex; this.cellCount = cellCount; this.bakeMat = bakeMat; this.levelMorph = levelMorph;
    this.dirtyCell = new Uint8Array(cellCount);
    for (let i = 0; i < 3; i++) {
      const t = new DataArrayTexture(null, TC_SL, TC_SL, 1);
      t.generateMipmaps = false;
      this.tex.push(t);
    }
    shared.uTc0 = { value: this.tex[0] }; shared.uTc1 = { value: this.tex[1] }; shared.uTc2 = { value: this.tex[2] };
    shared.uTcK = { value: new Vector4(Math.pow(2, TC_BIAS), 1, 0, 0) };
    this.mesh = new Mesh(undefined, bakeMat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.mask = -1;
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.add(this.mesh);
  }

  /** the GL side, made at the first bake: three array textures with MIPS levels, the scratch targets, two framebuffers */
  private ensureGL(r: WebGLRenderer): boolean {
    if (this.glTex.length) return true;
    const gl = r.getContext() as WebGL2RenderingContext;
    const float = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
    this.stats.float = float;
    const bpt = (4 + (float ? 8 : 4) + 4) * (1 + 1 / 4 + 1 / 16);
    const scratchMB = CLASSES.reduce((s, c) => s + c * c, 0) * (4 + (float ? 8 : 4) + 4) / 1048576;
    const layerMB = TC_SL * TC_SL * bpt / 1048576;
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    this.layers = Math.max(1, Math.min(maxLayers, Math.floor((TC_MB - scratchMB) / layerMB)));
    this.stats.layers = this.layers;
    this.stats.mb = Math.round((this.layers * layerMB + scratchMB) * 10) / 10;
    const fmts = [gl.SRGB8_ALPHA8, float ? gl.RGBA16F : gl.RGBA8, gl.RGBA8];
    const aniso = r.extensions.get('EXT_texture_filter_anisotropic') as { TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
    for (let i = 0; i < 3; i++) {
      const t = gl.createTexture()!;
      r.state.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, MIPS, fmts[i], TC_SL, TC_SL, this.layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, MIPS - 1);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, r.capabilities.getMaxAnisotropy()));
      r.state.unbindTexture();
      this.glTex.push(t);
      // (three binds this GL texture for the sampler: version 0 = it never uploads)
      const props = r.properties.get(this.tex[i]) as { __webglTexture?: WebGLTexture; __webglInit?: boolean };
      props.__webglTexture = t;
      props.__webglInit = true;
    }
    // 8-bit D (no float render targets): [-2, 2] in a byte
    const k = this.shared.uTcK.value as Vector4;
    const bk = (this.bakeMat.userData.uTcBakeK as IUniform<Vector4>).value;
    if (float) { k.y = 1; k.z = 0; bk.set(1, 0, 0, 0); } else { k.y = 4; k.z = -2; bk.set(0.25, 0.5, 0, 0); console.warn('[genesis] tcache: no float render targets, 8-bit normals'); }
    for (let l = 0; l < this.layers; l++) for (let y = 0; y < TC_SL; y += SLAB) for (let x = 0; x < TC_SL; x += SLAB) this.slabs.push({ layer: l, x, y, cls: -1, free: [], used: 0 });
    for (const c of CLASSES) {
      const rt = new WebGLRenderTarget(c, c, { count: 3, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
      rt.textures[0].colorSpace = SRGBColorSpace;
      rt.textures[1].type = float ? HalfFloatType : UnsignedByteType;
      this.scratch.set(c, rt);
    }
    this.fbR = gl.createFramebuffer();
    this.fbD = gl.createFramebuffer();
    perfSwitchNote('tcache', `1(${this.stats.mb}MB,${this.layers}L${float ? '' : ',d8'})`);
    return true;
  }

  private alloc(cls: number): { slab: Slab; sub: number } | null {
    const n = SLAB / CLASSES[cls];
    let empty: Slab | null = null;
    for (const s of this.slabs) {
      if (s.cls === cls && s.free.length) { s.used++; return { slab: s, sub: s.free.pop()! }; }
      if (s.cls < 0 && !empty) empty = s;
    }
    if (!empty) return null;
    empty.cls = cls;
    empty.free = [];
    for (let i = n * n - 1; i >= 0; i--) empty.free.push(i);
    empty.used = 1;
    return { slab: empty, sub: empty.free.pop()! };
  }

  private release(t: Tile): void {
    const s = t.slab;
    if (!s) return;
    s.free.push(t.sub);
    if (--s.used <= 0) { s.cls = -1; s.free = []; s.used = 0; }
    t.slab = null;
    t.baked = false;
  }

  /** the sim's fields: cells that moved past WATCH since their reference value (the reference follows them) */
  private watchFields(): boolean {
    let any = false;
    for (const name of Object.keys(WATCH)) {
      const tex = this.fieldTex[name];
      if (!tex) continue;
      const v = tex.version;
      if (this.seen.get(name) === v) continue;
      this.seen.set(name, v);
      const cur = tex.image.data as unknown as Float32Array;
      let ref = this.ref.get(name);
      if (!ref) { this.ref.set(name, cur.slice()); continue; }
      const th = WATCH[name], n = this.cellCount, dc = this.dirtyCell;
      for (let c = 0, o = 0; c < n; c++, o += 4) {
        if (Math.abs(cur[o] - ref[o]) > th[0] || Math.abs(cur[o + 1] - ref[o + 1]) > th[1] || Math.abs(cur[o + 2] - ref[o + 2]) > th[2] || Math.abs(cur[o + 3] - ref[o + 3]) > th[3]) {
          ref[o] = cur[o]; ref[o + 1] = cur[o + 1]; ref[o + 2] = cur[o + 2]; ref[o + 3] = cur[o + 3];
          if (!dc[c]) { dc[c] = 1; this.stats.dirtyCells++; }
          any = true;
        }
      }
    }
    return any;
  }

  private isHot(p: Patch): boolean {
    const cells = p.vcells;
    if (!cells) return false;
    const m1 = this.fieldTex.M1.image.data as unknown as Float32Array, cf = this.fieldTex.C.image.data as unknown as Float32Array;
    for (let i = 0; i < cells.length; i++) { const o = cells[i] * 4; if (m1[o] > 0.004 || Math.abs(cf[o + 3]) > 0.004) return true; }
    return false;
  }

  /**
   * once a frame after the LOD selection and the frame's uniforms: decides each drawn patch (cached / full shader),
   * writes the slot tables, queues the bakes. `pxPerRad`: render pixels per radian.
   */
  update(camBody: Vector3, pxPerRad: number, frame: number, sunBody: Vector3, yearFrac: number, primary = true): void {
    const st = this.stats, u = this.shared;
    this.frame = frame; this.pxPerRad = pxPerRad; this.cam.copy(camBody);
    // (probes: the primary planet's cache)
    if (primary) (globalThis as unknown as { __TCACHE__?: TerrainCache }).__TCACHE__ = this;
    // inputs that are the same for every tile: a change re-bakes everything (full shader meanwhile)
    const vf = u.uVegFade.value as { x: number; y: number }, cf = u.uCanopyFade.value as { x: number; y: number };
    const silt = (u.uSiltK?.value as number[] | undefined)?.reduce((s, x) => s + x, 0) ?? 0;
    const gkey = `${Math.round(vf.x)},${Math.round(vf.y)},${Math.round(cf.x)},${Math.round(cf.y)},${u.uShadowOn?.value},${u.uDebug.value},${u.uKind.value},${u.uHasAtmo?.value},${u.uSeasonAmp.value},${Math.round(silt * 20)}`;
    if (gkey !== this.gkey) { this.gkey = gkey; st.globals++; }
    if (this.watchFields()) {
      this.fieldEpoch++;
      const dc = this.dirtyCell;
      for (const [p, t] of this.tiles) {
        const cells = p.vcells;
        if (!cells) continue;
        for (let i = 0; i < cells.length; i++) if (dc[cells[i]]) { if (t.baked && !t.dirty) st.rebakeDirty++; t.dirty = true; break; }
      }
      dc.fill(0);
    }
    const kMax = Math.max(1300, cf.x < 1e8 ? cf.y : 0, vf.x < 1e8 ? vf.y * 0.44 : 0);
    const iMax = Math.ceil(2 * Math.log2(kMax / KNOT0));
    const up = _d;
    this.queue.length = 0;
    st.cached = 0; st.live = 0; st.hot = 0; st.near = 0; st.full = 0;
    for (const p of this.lod.selected) {
      const mesh = this.lod.tcMesh(p);
      if (!mesh) continue;
      const tab = (mesh as unknown as { _colorsTexture: DataTexture | null })._colorsTexture;
      if (!tab) continue;
      let t = this.tiles.get(p);
      if (!t) {
        t = { cls: -1, slab: null, sub: 0, kA: 0, kB: 0, g: 0, sun: new Vector3(), year: 0, gkey: '', baked: false, dirty: false, stale: false, hot: false, hotEpoch: -1, lastUsed: 0, dn: 0 };
        this.tiles.set(p, t);
      }
      t.lastUsed = frame;
      const sc = p.sphere.center, sr = p.sphere.radius;
      const dc0 = _c.copy(sc).sub(camBody).length();
      const dn = Math.max(0, dc0 - sr), df = dc0 + sr;
      t.dn = dn;
      const need = this.lod.size(p.level) * pxPerRad / Math.max(dn, 0.5);
      // graze^2 of the eye at the patch centre (groundfloor.ts swardDetail)
      up.copy(sc).normalize();
      const ndv = dc0 > 1e-3 ? Math.min(1, Math.max(0, -_c.dot(up) / dc0)) : 1;
      const g = (1 - ndv) * (1 - ndv);
      if (t.hotEpoch !== this.fieldEpoch) { t.hotEpoch = this.fieldEpoch; t.hot = this.isHot(p); }
      let valid = this.enabled && primary && t.baked && !t.dirty && !t.hot && t.gkey === gkey;
      if (valid && need > CLASSES[t.cls] - PAD + 2) { valid = false; st.rebakeClass++; }
      if (valid && (dn < t.kA * 0.98 && t.kA > KNOT0 * 1.01 || df > t.kB * 1.02 && t.kB < knotAt(iMax) * 0.99)) { valid = false; st.rebakeKnot++; }
      if (valid && Math.abs(g - t.g) > 0.2) { valid = false; st.rebakeKnot++; }
      if (valid && !t.stale && (t.sun.dot(sunBody) < 0.9976 || Math.abs(yearFrac - t.year) > 0.004)) { t.stale = true; st.rebakeSlow++; }
      // the slot table (two texels): written when it differs (a compacted or re-used slot is caught here too)
      const k = p.tSlot & 15, d = tab.image.data as unknown as Float32Array, o = k * 8;
      let l = -1, ox = 0, oy = 0, sz = 0;
      if (valid && t.slab) {
        const S = CLASSES[t.cls], n = SLAB / S;
        l = t.slab.layer; ox = (t.slab.x + (t.sub % n) * S) / TC_SL; oy = (t.slab.y + Math.floor(t.sub / n) * S) / TC_SL; sz = S / TC_SL;
        st.cached++;
      } else st.live++;
      if (d[o] !== l || d[o + 1] !== ox || d[o + 2] !== oy || d[o + 3] !== sz || d[o + 4] !== t.kA || d[o + 5] !== t.kB || d[o + 6] !== t.g) {
        d[o] = l; d[o + 1] = ox; d[o + 2] = oy; d[o + 3] = sz; d[o + 4] = t.kA; d[o + 5] = t.kB; d[o + 6] = t.g;
        texUpload(tab);
      }
      if (!this.enabled || !primary) continue;
      if (t.hot) { st.hot++; continue; }
      if (need * 1.1 > CLASSES[CLASSES.length - 1] - PAD) { st.near++; if (!valid && t.slab) this.release(t); continue; }
      if (!valid || t.stale) this.queue.push(p);
    }
    st.queued = this.queue.length;
    // patches that left the chunk cache give their tiles back
    if ((frame & 31) === 0) for (const [p, t] of this.tiles) if (!p.built) { this.release(t); this.tiles.delete(p); }
    st.tiles = 0;
    for (const s of this.slabs) st.tiles += s.used;
    if ((frame & 63) === 0 && this.glTex.length) perfSwitchNote('tcstat', `tiles=${st.tiles},cached=${st.cached},live=${st.live},hot=${st.hot},near=${st.near},full=${st.full},bakes=${st.bakesTotal},glob=${st.globals}`);
    // (the bake wants these again: kept on the instance)
    this.sunNow.copy(sunBody); this.yearNow = yearFrac; this.iMax = iMax;
  }
  private sunNow = new Vector3();
  private yearNow = 0;
  private iMax = 0;

  /** the frame's bakes (after the shadow pass: the forest floor reads this frame's shadow maps), nearest first */
  bake(r: WebGLRenderer, camera: Camera): void {
    const st = this.stats;
    st.bakes = 0; st.texels = 0;
    if (!this.enabled || !this.queue.length) return;
    this.ensureGL(r);
    const q = this.queue;
    // not-yet-cached before merely slow-stale, nearest first
    q.sort((a, b) => { const ta = this.tiles.get(a)!, tb = this.tiles.get(b)!; const sa = ta.stale && ta.baked && !ta.dirty ? 1 : 0, sb = tb.stale && tb.baked && !tb.dirty ? 1 : 0; return sa - sb || ta.dn - tb.dn; });
    const gl = r.getContext() as WebGL2RenderingContext;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    r.autoClear = false;
    let spent = 0;
    const bu = this.bakeMat.userData as { uTcBake: IUniform<Vector4>; uTcBakeF: IUniform<Vector4>; uTcEi: IUniform<Vector3>; uTcEj: IUniform<Vector3>; uMorph: IUniform<Vector4> };
    for (const p of q) {
      const t = this.tiles.get(p)!;
      const need = this.lod.size(p.level) * this.pxPerRad / Math.max(t.dn, 0.5);
      let cls = 0;
      while (cls < CLASSES.length - 1 && CLASSES[cls] - PAD < need * 1.1) cls++;
      const S = CLASSES[cls];
      if (spent > 0 && spent + S * S > TC_BUDGET) break;
      const range = this.lod.tcRange(p);
      if (!range) continue;
      if (t.slab && t.cls !== cls) this.release(t);
      if (!t.slab) {
        let a = this.alloc(cls);
        if (!a) {
          // least recently drawn tiles first (never one drawn this frame)
          const old = [...this.tiles].filter(([, x]) => x.slab && x.lastUsed < this.frame).sort((x, y) => x[1].lastUsed - y[1].lastUsed);
          for (const [, x] of old) { this.release(x); a = this.alloc(cls); if (a) break; }
        }
        if (!a) { st.full++; continue; }
        t.slab = a.slab; t.sub = a.sub; t.cls = cls;
      }
      // the bracket of the distance ladder, the eye's graze (quantised), the slow inputs
      const sr = p.sphere.radius, dc0 = _c.copy(p.sphere.center).sub(this.cam).length();
      const dn = Math.max(0, dc0 - sr), df = dc0 + sr;
      const ia = Math.min(this.iMax, Math.max(0, Math.floor(2 * Math.log2(Math.max(dn, KNOT0) / KNOT0) + 1e-6)));
      const ib = Math.min(this.iMax, Math.max(ia, Math.ceil(2 * Math.log2(Math.max(df, KNOT0) / KNOT0) - 1e-6)));
      t.kA = Math.fround(knotAt(ia)); t.kB = Math.fround(knotAt(ib));
      _d.copy(p.sphere.center).normalize();
      const ndv = dc0 > 1e-3 ? Math.min(1, Math.max(0, -_c.dot(_d) / dc0)) : 1;
      t.g = Math.round((1 - ndv) * (1 - ndv) * 8) / 8;
      t.sun.copy(this.sunNow); t.year = this.yearNow; t.gkey = this.gkey;
      // the draw: the page's geometry, this slot's index range, into the class's scratch target
      const rt = this.scratch.get(S)!;
      const geo = range.mesh.geometry;
      this.mesh.geometry = geo;
      geo.setDrawRange(range.indexStart, range.indexCount);
      this.mesh.matrixWorld.copy(range.mesh.matrixWorld);
      const lm = this.levelMorph(p.level).value;
      bu.uMorph.value.set(lm.x, lm.y, 0, lm.w);
      this.lod.tcCorners(p, _a, _b, _d);
      const rad = this.lod.radius;
      bu.uTcEi.value.copy(_b).sub(_a).multiplyScalar(rad / R);
      bu.uTcEj.value.copy(_d).sub(_a).multiplyScalar(rad / R);
      r.setRenderTarget(rt);
      for (let anchor = 0; anchor < 2; anchor++) {
        bu.uTcBake.value.set(S, anchor, range.vertexStart, 0);
        bu.uTcBakeF.value.set(anchor ? t.kB : t.kA, t.g, 0, 0);
        r.render(this.scene, camera);
      }
      geo.setDrawRange(0, Infinity);
      // scratch -> the tile (mip 0), then its two mips (box filter: 2:1 linear blits)
      const n = SLAB / S, x = t.slab.x + (t.sub % n) * S, y = t.slab.y + Math.floor(t.sub / n) * S, L = t.slab.layer;
      r.state.setScissorTest(false);
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbR);
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbD);
      for (let i = 0; i < 3; i++) {
        const src = (r.properties.get(rt.textures[i]) as { __webglTexture: WebGLTexture }).__webglTexture;
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0);
        gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 0, L);
        gl.blitFramebuffer(0, 0, S, S, x, y, x + S, y + S, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 1, L);
        gl.blitFramebuffer(0, 0, S, S, x / 2, y / 2, (x + S) / 2, (y + S) / 2, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 2, L);
        if (this.selfBlit) {
          gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 1, L);
          gl.blitFramebuffer(x / 2, y / 2, (x + S) / 2, (y + S) / 2, x / 4, y / 4, (x + S) / 4, (y + S) / 4, gl.COLOR_BUFFER_BIT, gl.LINEAR);
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
          gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
        } else gl.blitFramebuffer(0, 0, S, S, x / 4, y / 4, (x + S) / 4, (y + S) / 4, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        if (!this.checked) {
          // (once: a level-to-level blit inside one texture is legal GL ES 3; if this driver refuses it, mip 2 comes
          // straight from the scratch)
          const e = gl.getError();
          if (e !== gl.NO_ERROR) { this.selfBlit = false; console.warn('[genesis] tcache: mip blit error', e, '-> direct'); gl.blitFramebuffer(0, 0, S, S, x / 4, y / 4, (x + S) / 4, (y + S) / 4, gl.COLOR_BUFFER_BIT, gl.LINEAR); }
        }
      }
      this.checked = true;
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      t.baked = true; t.dirty = false; t.stale = false;
      spent += S * S;
      st.bakes++; st.bakesTotal++;
    }
    st.texels = spent;
    this.mesh.geometry = undefined as unknown as Mesh['geometry'];
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
  }

  dispose(r?: WebGLRenderer): void {
    const gl = r?.getContext() as WebGL2RenderingContext | undefined;
    if (gl) { for (const t of this.glTex) gl.deleteTexture(t); if (this.fbR) gl.deleteFramebuffer(this.fbR); if (this.fbD) gl.deleteFramebuffer(this.fbD); }
    this.glTex = [];
    for (const rt of this.scratch.values()) rt.dispose();
    this.scratch.clear();
    this.tiles.clear();
    this.slabs = [];
    const g = globalThis as unknown as { __TCACHE__?: TerrainCache };
    if (g.__TCACHE__ === this) delete g.__TCACHE__;
  }
}

export type { Texture };
export { DoubleSide as TC_BAKE_SIDE };
