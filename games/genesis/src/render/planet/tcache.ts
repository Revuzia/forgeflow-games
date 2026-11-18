// GENESIS — PERF s22 / s26 `?tcache=1` (default OFF): the terrain MATERIAL CACHE — texture-space shading of the ground.
//
// The surface function (terrainmat.ts evalTerrain: ~40-125 simplex evaluations a fragment) is evaluated ONCE per texel
// into per-patch tiles, and again only when its inputs change; the per-frame terrain fragment then takes 3 texture
// taps and runs the unchanged lighting. A patch without a valid tile draws with the full shader (the same picture at
// the old cost).
//
// s26 "lean" layout (SESSION 26 in PERF.md: why s22's tiles came to ~2 MB each at the landing view):
// STORE (3 targets, 16 B a texel + 1 mip): T0 sRGB8_A8 albedo / 1.5, roughness; T1 RGBA16F D (body frame; the shading
// normal is normalize(N - D): the bump height's surface gradient + the micro normal, folded exactly as the live path
// nests them), ao; T2 RGBA8 sky, sward, glint (the share of sparkling facets), 1.
// ONE BAKE PER PATCH, AT THE CAMERA OF THE BAKE: every texel is evaluated with the camera distance, the eye direction
// and the pixel footprint the full shader would give that point from the camera of the bake frame (the footprint is
// the full shader's own length(fwidth(P)), built from the screen axes and the surface plane). So the distance fades,
// the sward's grazing term and every footprint fade are the live ones, texel by texel, and neighbouring patches meet
// without a step. The camera moving or turning makes a tile slow-stale (shown, re-baked at low priority); moved by
// more than 15 % of its distance the patch goes back to the full shader until re-baked. The graze term is also
// corrected per fragment to first order from the bake camera (stored per tile).
// TILES: a patch's triangular lattice fills HALF a square (lower-left, or rotated 180 degrees: upper-right), so two
// patches share a square; each half has a 2-texel border on its legs and a 4.24-texel one on the hypotenuse, so the
// display's taps (mip <= 1) never reach the partner's half. Squares of one size class fill a 288 slab (four by four
// slabs a layer; classes 192 and 576 take a 576 block).
// SIZE: by the patch's real on-screen AREA: edge in texels = tcdens x (patch edge in pixels at its nearest point) x
// sqrt(|n.v| + relief), i.e. texels ~ pixels over the patch (far grazing patches get tiny tiles); the bake's footprint
// is never under the texel's own. PRIORITY: the patches with the most screen pixels first.
// LIVE (full shader): patches with lava or fire (uTime), patches nearer than the largest class resolves, patches
// whose tile is not baked yet / moved out of its bracket / changed by the sim, and what does not fit the memory cap.
import {
  DataArrayTexture, DataTexture, DoubleSide, FloatType, HalfFloatType, LinearFilter, Mesh, RGBAFormat, Scene, SRGBColorSpace,
  UnsignedByteType, Vector3, Vector4, WebGLRenderTarget, NearestFilter,
  type BatchedMesh, type Camera, type IUniform, type Material, type Matrix3, type Texture, type WebGLRenderer,
} from 'three';
import { perfNum, perfSwitch, perfSwitchNote } from '../perfswitch.ts';
import { texUpload } from '../uploadsched.ts';
import { NPTS, NVERT, PATCH_RES } from './patchbuild.ts';
import type { ChunkLOD, Patch } from './chunks.ts';

export const TCACHE = perfSwitch('tcache', false);
/** memory cap (MB) for the tiles + the bake scratch; `?tcmb=` */
const TC_MB = TCACHE ? perfNum('tcmb', 256)! : 256;
/**
 * texels evaluated per frame at most; `?tcbudget=`. A texel costs about one full-shader terrain pixel on the GPU
 * (~0.2 us on the M5 by the round-14 numbers: 64 k texels ~ 13 ms), so this caps the bake's GPU time a frame
 */
const TC_BUDGET = TCACHE ? perfNum('tcbudget', 64000)! : 0;
/** mip bias of the display taps (0 = the footprint's own mip); `?tcbias=` */
const TC_BIAS = TCACHE ? perfNum('tcbias', 0)! : 0;
/** texels per pixel (by area, along the patch's edge) a new tile is given; `?tcdens=` (1.3: Nyquist for the footprint fades) */
const TC_DENS = TCACHE ? Math.min(2.5, Math.max(0.8, perfNum('tcdens', 1.3)!)) : 1.3;

/** layer edge (texels), slab edge, block edge (texels), the tile classes (square edge in texels) */
export const TC_SL = 1152;
const SLAB = 288;
const BLOCK = 576;
const CLASSES = [24, 32, 48, 72, 96, 144, 192, 288, 576];
/** the span a class's squares fill: a slab, or a 2x2 block of slabs */
const span = (c: number): number => (SLAB % CLASSES[c] === 0 ? SLAB : BLOCK);
/** border on the legs (texels), border on the hypotenuse (in x + y: 6 = 4.24 texels across) */
const BORDER = 2;
const HYP = 6;
/** usable leg of a class: S - 2 BORDER - HYP */
const PAD = 2 * BORDER + HYP;
const MIPS = 2;
const BPT = 16 * (1 + 1 / 4);

const R = PATCH_RES;
const f1 = (x: number): string => x.toFixed(4);

/** shared by the display and the bake programs (vertex): the lattice position of a patch vertex from its index */
export const TC_VERT_PARS = /* glsl */ `
#ifdef TC_BAKE
uniform vec4 uTcBake;    // tile edge (texels), half (0 lower-left, 1 upper-right), the slot's first vertex, 0
uniform vec3 uTcEi;      // the patch's lattice steps in the body frame (m): the skirt extrapolates the border with them
uniform vec3 uTcEj;
vec2 tcClip;
#else
flat varying vec4 vTc0;  // layer (-1: no tile, full shader), tile origin (uv), tile edge (uv)
flat varying vec4 vTc1;  // the bake camera (body frame, m), half
varying vec2 vTcUV;
#endif
// lattice (0..1) and the skirt's push (texels, outward in tile space) of a patch vertex
void tcLattice(int lv, out vec2 lat, out vec2 push) {
  push = vec2(0.0);
  if (lv < ${NPTS}) {
    float l = float(lv);
    float j = floor((${f1(2 * R + 3)} - sqrt(${f1((2 * R + 3) ** 2 - 0.25)} - 8.0 * l)) * 0.5);
    lat = vec2(l - j * (${f1(2 * R + 3)} - j) * 0.5, j);
  } else {
    int k = lv - ${NPTS};
    if (k < ${R}) { lat = vec2(float(k), 0.0); push = k == 0 ? vec2(${-BORDER}.0, ${-BORDER}.0) : vec2(0.0, ${-BORDER}.0); }
    else if (k < ${2 * R}) { int j = k - ${R}; lat = vec2(float(${R} - j), float(j)); push = j == 0 ? vec2(${HYP + BORDER}.0, ${-BORDER}.0) : vec2(${f1(HYP / 2)}, ${f1(HYP / 2)}); }
    else { int m = k - ${2 * R}; lat = vec2(0.0, float(${R} - m)); push = m == 0 ? vec2(${-BORDER}.0, ${HYP + BORDER}.0) : vec2(${-BORDER}.0, 0.0); }
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
    vec2 tcQ = (${f1(BORDER)} + tcL * tcLat + tcPush) / uTcBake.x;
    if (uTcBake.y > 0.5) tcQ = 1.0 - tcQ;
    tcClip = tcQ * 2.0 - 1.0;
    // the border: the function just outside the patch (the fields and the normal stay the edge's)
    vBodyPos += (uTcEi * tcPush.x + uTcEj * tcPush.y) * (${f1(R)} / tcL);
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
    vTcUV = vTc1.w > 0.5 ? vTc0.yz + vTc0.w - tcA : vTc0.yz + tcA;
#endif
  }
`;

export const TC_FRAG_PARS = /* glsl */ `
#ifdef TC_BAKE
uniform vec4 uTcBakeF;   // the bake camera (body frame, m), pixels per radian
uniform vec4 uTcBakeK;   // D scale, D offset (8-bit fallback)
#define tcGlintK 1.0
layout(location = 1) out highp vec4 tcOut1;
layout(location = 2) out highp vec4 tcOut2;
#else
flat varying vec4 vTc0;
flat varying vec4 vTc1;
varying vec2 vTcUV;
uniform highp sampler2DArray uTc0;
uniform highp sampler2DArray uTc1;
uniform highp sampler2DArray uTc2;
uniform vec4 uTcK;       // gradient scale (2^bias), D scale, D offset, 0
float tcGlintK = 1.0;
#endif
`;

/** the display fetch (and the bake's footprint): declared after TSurf and uBodyToView */
export const TC_FRAG_FETCH = /* glsl */ `
#ifdef TC_BAKE
// the full shader's footprint length(fwidth(P)) at this point, seen from the bake camera: the screen-space derivatives
// of a point on the surface plane, d/dx = (depth / f) (R - p (n.R) / (n.p)) in view space (p = the point, R / U the
// screen axes), taken back to the body frame (fwidth is per body component)
float tcFwLive(vec3 P) {
  vec3 pv = uBodyToView * (P - uTcBakeF.xyz);
  vec3 nb = cross(dFdx(P), dFdy(P));
  float nl = length(nb);
  vec3 nv = uBodyToView * (nl > 1e-20 ? nb / nl : normalize(P));
  float lp = length(pv);
  float np = dot(nv, pv);
  np = np < 0.0 ? min(np, -1e-3 * lp) : max(np, 1e-3 * lp);
  mat3 vb = transpose(uBodyToView);
  vec3 ex = vb * (vec3(1.0, 0.0, 0.0) - pv * (nv.x / np));
  vec3 ey = vb * (vec3(0.0, 1.0, 0.0) - pv * (nv.y / np));
  return max(-pv.z, 1e-3 * lp) / uTcBakeF.w * length(abs(ex) + abs(ey));
}
#else
TSurf tcFetch(vec2 dx, vec2 dy, float graze, out vec3 D) {
  // the footprint, held to mip 1 (the tile borders: 2 texels on the legs, 4.24 on the hypotenuse, at mip 0)
  vec2 gx = dx * ${f1(TC_SL)}, gy = dy * ${f1(TC_SL)};
  float lx = length(gx), ly = length(gy);
  float eff = max(min(lx, ly), max(lx, ly) * 0.0625) * uTcK.x;
  float sc = uTcK.x * min(1.0, 2.0 / max(eff, 1e-6));
  dx *= sc; dy *= sc;
  vec3 pa = vec3(vTcUV, vTc0.x);
  vec4 c0 = textureGrad(uTc0, pa, dx, dy);
  vec4 c1 = textureGrad(uTc1, pa, dx, dy);
  vec4 c2 = textureGrad(uTc2, pa, dx, dy);
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
  // the sward's grazing tone (groundfloor.ts swardDetail) was baked for the eye at vTc1.xyz: first-order correction
  float gb = 1.0 - clamp(dot(normalize(vBodyPos), normalize(vTc1.xyz - vBodyPos)), 0.0, 1.0);
  s.albedo *= 1.0 + s.sward * (mix(0.94, 1.07, graze) / mix(0.94, 1.07, gb * gb) - 1.0);
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

/** a 288 slab; a class that spans a 576 block keeps its list on the block's first slab (the other three point at it) */
interface Slab { layer: number; x: number; y: number; cls: number; free: number[]; used: number; owner: (Tile | null)[]; head: Slab | null }
interface Tile {
  cls: number; slab: Slab | null; sub: number;
  cam: Vector3; fwd: Vector3; sun: Vector3; year: number; gkey: string;
  baked: boolean; dirty: boolean; stale: boolean; hot: boolean; hotEpoch: number;
  lastUsed: number; dn: number; need: number; area: number; areaW: number;
  /** the lattice corners' unit directions (0,0), (R,0), (0,R) */
  dirs: Float32Array;
}

const _c = new Vector3(), _a = new Vector3(), _b = new Vector3(), _d = new Vector3(), _f = new Vector3();
const classFor = (n: number): number => { let c = 0; while (c < CLASSES.length - 1 && CLASSES[c] - PAD < n) c++; return c; };

/** per-channel change (since the value a tile may have been baked with) that re-bakes the tiles of a cell */
const WATCH: Record<string, [number, number, number, number]> = {
  A: [0.02, 0.02, 0.05, 0.05], N: [0.01, 0.01, 0.01, 0.05], M0: [0.02, 0.02, 0.02, 0.02], M1: [0.004, 0.03, 0.02, 0.02],
  V: [0.02, 0.02, 0.02, 0.02], C: [1.0, 0.03, 0.02, 0.004], S: [0.5, 0.5, 1e9, 0.5], O: [0.02, 0.02, 0.02, 0.02],
  G: [0.01, 0.01, 0.01, 0.01], D: [0.02, 1e9, 1e9, 1e9],
};

export interface TcStats {
  on: boolean; mb: number; layers: number; float: boolean; tiles: number; cached: number; live: number; hot: number; near: number; wide: number; wantN: number; wantMB: number; full: number;
  queued: number; bakes: number; bakesTotal: number; texels: number; rebakeDirty: number; rebakeKnot: number; rebakeClass: number; rebakeSlow: number; globals: number; dirtyCells: number;
  /** s26: estimated terrain screen pixels of the drawn patches, the share of them on a valid tile (%), MB of tiles in use */
  pixAll: number; pixPct: number; usedMB: number; stale: number;
  /** tiles in use by class edge ("24:n/32:n/...") */
  byClass: string;
  /** main-thread ms of this frame's bake call, per tile (running mean), the worst frame so far */
  bakeMs: number; bakeMsPer: number; bakeMsMax: number;
}

export class TerrainCache {
  readonly stats: TcStats = { on: true, mb: 0, layers: 0, float: true, tiles: 0, cached: 0, live: 0, hot: 0, near: 0, wide: 0, wantN: 0, wantMB: 0, full: 0, queued: 0, bakes: 0, bakesTotal: 0, texels: 0, rebakeDirty: 0, rebakeKnot: 0, rebakeClass: 0, rebakeSlow: 0, globals: 0, dirtyCells: 0, pixAll: 0, pixPct: 0, usedMB: 0, stale: 0, byClass: '', bakeMs: 0, bakeMsPer: 0, bakeMsMax: 0 };
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
  private readonly fwd = new Vector3();
  /** bake texels in hand (the budget accrues per frame, so a large tile's turn comes within a few frames) */
  private credit = 0;
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
    const bpt = (4 + (float ? 8 : 4) + 4) * (1 + 1 / 4);
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
    for (let l = 0; l < this.layers; l++) for (let y = 0; y < TC_SL; y += SLAB) for (let x = 0; x < TC_SL; x += SLAB) this.slabs.push({ layer: l, x, y, cls: -1, free: [], used: 0, owner: [], head: null });
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

  /** slab index of (layer, x, y) */
  private slabAt(l: number, x: number, y: number): Slab { const n = TC_SL / SLAB; return this.slabs[(l * n + y / SLAB) * n + x / SLAB]; }

  /** a half square of class cls: the first slab of that class with room, else an empty slab (or 576 block) */
  private alloc(cls: number, t: Tile): { slab: Slab; sub: number } | null {
    const S = CLASSES[cls], sp = span(cls);
    for (const s of this.slabs) if (s.cls === cls && !s.head && s.free.length) { const sub = s.free.pop()!; s.used++; s.owner[sub] = t; return { slab: s, sub }; }
    let head: Slab | null = null;
    if (sp === SLAB) head = this.slabs.find((s) => s.cls < 0) ?? null;
    else {
      for (const s of this.slabs) {
        if (s.x % BLOCK || s.y % BLOCK || s.cls >= 0) continue;
        const o = [this.slabAt(s.layer, s.x + SLAB, s.y), this.slabAt(s.layer, s.x, s.y + SLAB), this.slabAt(s.layer, s.x + SLAB, s.y + SLAB)];
        if (o.some((x) => x.cls >= 0)) continue;
        for (const x of o) { x.cls = cls; x.head = s; }
        head = s;
        break;
      }
    }
    if (!head) return null;
    const n = sp / S;
    head.cls = cls; head.head = null; head.free = []; head.owner = [];
    for (let i = 2 * n * n - 1; i >= 0; i--) head.free.push(i);
    const sub = head.free.pop()!;
    head.used = 1; head.owner[sub] = t;
    return { slab: head, sub };
  }

  private release(t: Tile): void {
    const s = t.slab;
    if (!s) return;
    s.free.push(t.sub);
    s.owner[t.sub] = null;
    if (--s.used <= 0) {
      if (span(s.cls) === BLOCK) for (const x of [this.slabAt(s.layer, s.x + SLAB, s.y), this.slabAt(s.layer, s.x, s.y + SLAB), this.slabAt(s.layer, s.x + SLAB, s.y + SLAB)]) { x.cls = -1; x.head = null; }
      s.cls = -1; s.free = []; s.used = 0; s.owner = [];
    }
    t.slab = null;
    t.baked = false;
  }

  /** the tile's square: texel origin in its layer, and which half */
  private place(t: Tile): { x: number; y: number; half: number; S: number } {
    const S = CLASSES[t.cls], n = span(t.cls) / S, q = t.sub >> 1;
    return { x: t.slab!.x + (q % n) * S, y: t.slab!.y + Math.floor(q / n) * S, half: t.sub & 1, S };
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
  update(camBody: Vector3, pxPerRad: number, frame: number, sunBody: Vector3, yearFrac: number, primary = true, halfH = 0, halfW = 0): void {
    const st = this.stats, u = this.shared;
    this.frame = frame; this.pxPerRad = pxPerRad; this.cam.copy(camBody);
    // the view direction in the body frame (row 2 of body -> view, negated)
    const m = (u.uBodyToView.value as Matrix3).elements;
    this.fwd.set(-m[2], -m[5], -m[8]);
    // (probes: the primary planet's cache)
    if (primary) (globalThis as unknown as { __TCACHE__?: TerrainCache }).__TCACHE__ = this;
    // inputs that are the same for every tile: a change re-bakes everything (full shader meanwhile)
    const vf = u.uVegFade.value as { x: number; y: number }, cf = u.uCanopyFade.value as { x: number; y: number };
    const silt = (u.uSiltK?.value as number[] | undefined)?.reduce((s, x) => s + x, 0) ?? 0;
    const gkey = `${Math.round(pxPerRad)},${Math.round(vf.x)},${Math.round(vf.y)},${Math.round(cf.x)},${Math.round(cf.y)},${u.uShadowOn?.value},${u.uDebug.value},${u.uKind.value},${u.uHasAtmo?.value},${u.uSeasonAmp.value},${Math.round(silt * 20)}`;
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
    const up = _d, f2 = pxPerRad * pxPerRad, rad = this.lod.radius;
    this.queue.length = 0;
    st.cached = 0; st.live = 0; st.hot = 0; st.near = 0; st.wide = 0; st.wantN = 0; st.stale = 0;
    let wantTexels = 0, pixAll = 0, pixC = 0;
    for (const p of this.lod.selected) {
      const mesh = this.lod.tcMesh(p);
      if (!mesh) continue;
      const tab = (mesh as unknown as { _colorsTexture: DataTexture | null })._colorsTexture;
      if (!tab) continue;
      let t = this.tiles.get(p);
      if (!t) {
        t = { dirs: new Float32Array(9), cls: -1, slab: null, sub: 0, cam: new Vector3(), fwd: new Vector3(), sun: new Vector3(), year: 0, gkey: '', baked: false, dirty: false, stale: false, hot: false, hotEpoch: -1, lastUsed: 0, dn: 0, need: 0, area: 0, areaW: 0 };
        // the patch's flat triangle (m^2)
        this.lod.tcCorners(p, _a, _b, _f);
        _a.toArray(t.dirs, 0); _b.toArray(t.dirs, 3); _f.toArray(t.dirs, 6);
        _b.sub(_a); _f.sub(_a);
        t.areaW = 0.5 * _b.cross(_f).length() * rad * rad;
        this.tiles.set(p, t);
      }
      t.lastUsed = frame;
      const sc = p.sphere.center, sr = p.sphere.radius;
      const dc0 = _c.copy(sc).sub(camBody).length();
      // the LOD's shell-sector distance to the patch's nearest point
      const dn = Math.max(this.lod.tcDist(p, camBody), Math.max(0, dc0 - sr), 0.5);
      t.dn = dn;
      // how squarely the patch faces the eye (its relief: slopes face the eye even when the patch's plane does not)
      up.copy(sc).normalize();
      const ndv = dc0 > 1e-3 ? Math.min(1, Math.max(0, -_c.dot(up) / dc0)) : 1;
      const size = this.lod.size(p.level);
      const cEff = Math.min(1, Math.max(0.02, ndv + (p.hMax - p.hMin) / size));
      // the edge (texels) for texels ~ pixels by AREA, at the patch's nearest point (the near end is the densest)
      // what of it is ON SCREEN: 15 points of the triangle (at its mid height) projected; a patch selected because its
      // bounding sphere touches the frustum (the ground under / beside the camera) is sized by its visible part only
      let vis = 0, dMin = 1e30, inv2 = 0;
      {
        const D = t.dirs, hr = rad + 0.5 * (p.hMin + p.hMax), me = m;
        for (let i = 0; i <= 4; i++) for (let j = 0; i + j <= 4; j++) {
          const u1 = i / 4, v1 = j / 4, w1 = 1 - u1 - v1;
          let x = D[0] * w1 + D[3] * u1 + D[6] * v1, y = D[1] * w1 + D[4] * u1 + D[7] * v1, z = D[2] * w1 + D[5] * u1 + D[8] * v1;
          const k = hr / Math.hypot(x, y, z);
          x = x * k - camBody.x; y = y * k - camBody.y; z = z * k - camBody.z;
          const vz = -(me[2] * x + me[5] * y + me[8] * z);
          if (vz < 0.05) continue;
          if (halfH > 0) {
            const sx = pxPerRad * (me[0] * x + me[3] * y + me[6] * z) / vz, sy = pxPerRad * (me[1] * x + me[4] * y + me[7] * z) / vz;
            if (Math.abs(sx) > halfW || Math.abs(sy) > halfH) continue;
          }
          const d2 = x * x + y * y + z * z;
          vis++; dMin = Math.min(dMin, Math.sqrt(d2)); inv2 += 1 / d2;
        }
      }
      // (none of the 15 inside: a sliver at the screen's edge, sized as at its centre)
      const dVis = vis ? Math.max(dn, dMin - 0.3 * size) : Math.max(dn, dc0);
      // the edge (texels) for texels ~ pixels by AREA, at the patch's nearest visible point (the near end is the densest)
      const need = size * pxPerRad / dVis * Math.sqrt(cEff);
      t.need = need;
      // its screen pixels (the triangle's area x |n.v| x mean of 1 / d^2 over the points, the hidden ones as 0)
      t.area = vis ? Math.min(4 * f2, t.areaW * cEff * f2 * inv2 / 15) : t.areaW * cEff * f2 / Math.max(dc0 * dc0, 0.25) / 15;
      pixAll += t.area;
      if (t.hotEpoch !== this.fieldEpoch) { t.hotEpoch = this.fieldEpoch; t.hot = this.isHot(p); }
      let valid = this.enabled && primary && t.baked && !t.dirty && !t.hot && t.gkey === gkey;
      const moved = valid ? t.cam.distanceTo(camBody) / dn : 0;
      const usable = t.cls >= 0 ? CLASSES[t.cls] - PAD : 0;
      // moved far (the distance fades, the footprint): the full shader until re-baked
      if (valid && moved > 0.15) { valid = false; st.rebakeKnot++; }
      // the patch came nearer than its tile resolves (by more than a quarter): the full shader until re-baked
      if (valid && need * TC_DENS > usable * 1.25) { valid = false; st.rebakeClass++; }
      if (valid && !t.stale) {
        // slow-stale: shown, re-baked behind the uncached patches (camera moved / turned, sun, season, class)
        if (moved > 0.03 || t.fwd.dot(this.fwd) < 0.966) { t.stale = true; st.rebakeKnot++; }
        else if (t.sun.dot(sunBody) < 0.9976 || Math.abs(yearFrac - t.year) > 0.004) { t.stale = true; st.rebakeSlow++; }
        // (smaller only when a smaller class fits: 288 -> 576 is a 2x step, a test on the usable edge alone looped)
        else if (need * TC_DENS > usable || (classFor(need * TC_DENS) < t.cls && need * TC_DENS * 1.9 < usable)) { t.stale = true; st.rebakeClass++; }
      }
      // the slot table (two texels): written when it differs (a compacted or re-used slot is caught here too)
      const k = p.tSlot & 15, d = tab.image.data as unknown as Float32Array, o = k * 8;
      let l = -1, ox = 0, oy = 0, sz = 0, hf = 0;
      if (valid && t.slab) {
        const pl = this.place(t);
        l = t.slab.layer; ox = pl.x / TC_SL; oy = pl.y / TC_SL; sz = pl.S / TC_SL; hf = pl.half;
        st.cached++; pixC += t.area;
        if (t.stale) st.stale++;
      } else st.live++;
      // (compared as stored: float32)
      const fr = Math.fround;
      if (d[o] !== l || d[o + 1] !== fr(ox) || d[o + 2] !== fr(oy) || d[o + 3] !== fr(sz) || d[o + 4] !== fr(t.cam.x) || d[o + 5] !== fr(t.cam.y) || d[o + 6] !== fr(t.cam.z) || d[o + 7] !== hf) {
        d[o] = l; d[o + 1] = ox; d[o + 2] = oy; d[o + 3] = sz; d[o + 4] = t.cam.x; d[o + 5] = t.cam.y; d[o + 6] = t.cam.z; d[o + 7] = hf;
        texUpload(tab);
      }
      if (!this.enabled || !primary) continue;
      if (t.hot) { st.hot++; continue; }
      if (need * TC_DENS > CLASSES[CLASSES.length - 1] - PAD) { st.near++; if (!valid && t.slab) this.release(t); continue; }
      { const c = CLASSES[classFor(need * TC_DENS)]; wantTexels += c * c / 2; st.wantN++; }
      if (!valid || t.stale) this.queue.push(p);
    }
    st.queued = this.queue.length;
    st.pixAll = Math.round(pixAll);
    st.pixPct = pixAll > 0 ? Math.round(1000 * pixC / pixAll) / 10 : 0;
    // what this frame's cacheable patches would take at their classes (MB, half squares + mips; slab rounding not counted)
    st.wantMB = Math.round(wantTexels * (this.stats.float ? 16 : 12) * 1.25 / 1048576);
    // patches that left the chunk cache give their tiles back
    if ((frame & 31) === 0) for (const [p, t] of this.tiles) if (!p.built) { this.release(t); this.tiles.delete(p); }
    st.tiles = 0;
    let usedT = 0;
    const by = new Array<number>(CLASSES.length).fill(0);
    for (const s of this.slabs) if (!s.head && s.cls >= 0) { st.tiles += s.used; by[s.cls] += s.used; usedT += s.used * CLASSES[s.cls] ** 2 / 2; }
    st.usedMB = Math.round(usedT * BPT / 104857.6) / 10;
    st.byClass = CLASSES.map((c, i) => (by[i] ? `${c}:${by[i]}` : '')).filter(Boolean).join('/');
    if ((frame & 63) === 0 && this.glTex.length) perfSwitchNote('tcstat', `pix=${st.pixPct}%,used=${st.usedMB}MB,tiles=${st.tiles},cached=${st.cached},live=${st.live},stale=${st.stale},hot=${st.hot},near=${st.near},want=${st.wantN}/${st.wantMB}MB,full=${st.full},bakes=${st.bakesTotal},bakeMs=${st.bakeMsPer.toFixed(2)}/${st.bakeMsMax.toFixed(1)},glob=${st.globals},cls=${st.byClass}`);
    // (the bake wants these again: kept on the instance)
    this.sunNow.copy(sunBody); this.yearNow = yearFrac;
  }
  private sunNow = new Vector3();
  private yearNow = 0;

  /**
   * the frame's bakes, largest screen area first (Renderer: in the frame's uploads slot, before any pass; the forest
   * floor mask reads the shadow maps with their matrices, both still the previous frame's: a consistent pair)
   */
  bake(r: WebGLRenderer, camera: Camera): void {
    const st = this.stats;
    st.bakes = 0; st.texels = 0; st.full = 0;
    if (!this.enabled || !this.queue.length) { st.bakeMs = 0; return; }
    const t0 = performance.now();
    this.ensureGL(r);
    const q = this.queue;
    // not-yet-cached before merely slow-stale, then the most screen pixels first
    q.sort((a, b) => { const ta = this.tiles.get(a)!, tb = this.tiles.get(b)!; const sa = ta.stale && ta.baked && !ta.dirty ? 1 : 0, sb = tb.stale && tb.baked && !tb.dirty ? 1 : 0; return sa - sb || tb.area - ta.area; });
    const gl = r.getContext() as WebGL2RenderingContext;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    r.autoClear = false;
    let spent = 0, held = false;
    const credit0 = this.credit = Math.min(this.credit + TC_BUDGET, Math.max(2 * TC_BUDGET, CLASSES[CLASSES.length - 1] ** 2 * 0.75));
    let credit = credit0;
    const failed: boolean[] = [];
    const bu = this.bakeMat.userData as { uTcBake: IUniform<Vector4>; uTcBakeF: IUniform<Vector4>; uTcEi: IUniform<Vector3>; uTcEj: IUniform<Vector3>; uMorph: IUniform<Vector4> };
    const blit = (x: number, y: number, S: number, L: number, toTile: boolean): void => {
      // level-0 copy of a square between the class's scratch and the tile (all three targets)
      const rt = this.scratch.get(S)!;
      for (let i = 0; i < 3; i++) {
        const sTex = (r.properties.get(rt.textures[i]) as { __webglTexture: WebGLTexture }).__webglTexture;
        if (toTile) {
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sTex, 0);
          gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 0, L);
          gl.blitFramebuffer(0, 0, S, S, x, y, x + S, y + S, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          // mip 1 (2:1 linear = a box filter)
          gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 1, L);
          gl.blitFramebuffer(0, 0, S, S, x / 2, y / 2, (x + S) / 2, (y + S) / 2, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        } else {
          gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glTex[i], 0, L);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sTex, 0);
          gl.blitFramebuffer(x, y, x + S, y + S, 0, 0, S, S, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        }
      }
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    };
    const bind = (): void => {
      r.state.setScissorTest(false);
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbR);
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbD);
    };
    const unbind = (): void => {
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    };
    for (const p of q) {
      const t = this.tiles.get(p)!;
      const cls = classFor(t.need * TC_DENS);
      const S = CLASSES[cls];
      if (S * S / 2 > credit) { if (!held) { held = true; credit *= 0.5; } continue; }
      const range = this.lod.tcRange(p);
      if (!range) continue;
      if (t.slab && t.cls !== cls) this.release(t);
      if (!t.slab) {
        let a = failed[cls] ? null : this.alloc(cls, t);
        if (!a && !failed[cls]) {
          // tiles not drawn this frame first (least recently drawn first)
          const old = [...this.tiles.values()].filter((x) => x.slab && x.lastUsed < this.frame).sort((x, y) => x.lastUsed - y.lastUsed);
          for (const x of old) { this.release(x); a = this.alloc(cls, t); if (a) break; }
        }
        if (!a && !failed[cls]) {
          // full, nothing idle: take the half of a drawn patch of this class with less than half the screen pixels
          const small = [...this.tiles.values()].filter((x) => x.slab && x.cls === cls && x.area < t.area * 0.5).sort((x, y) => x.area - y.area);
          for (let i = 0; i < small.length && i < 12 && !a; i++) { this.release(small[i]); a = this.alloc(cls, t); }
        }
        // (the queue is largest first: once a class finds no room, the smaller ones of that class do not look again)
        if (!a) { failed[cls] = true; st.full++; continue; }
        t.slab = a.slab; t.sub = a.sub; t.cls = cls;
      }
      const pl = this.place(t), L = t.slab.layer;
      // the partner half's texels go into the scratch first (the bake draws one half; the square is copied back whole)
      const partner = t.slab.owner[t.sub ^ 1];
      // (setRenderTarget first: three makes the scratch's GL textures at its first use)
      if (partner && partner.baked) { r.setRenderTarget(this.scratch.get(S)!); bind(); blit(pl.x, pl.y, S, L, false); unbind(); }
      t.cam.copy(this.cam); t.fwd.copy(this.fwd);
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
      bu.uTcBake.value.set(S, pl.half, range.vertexStart, 0);
      bu.uTcBakeF.value.set(this.cam.x, this.cam.y, this.cam.z, this.pxPerRad);
      r.render(this.scene, camera);
      geo.setDrawRange(0, Infinity);
      bind();
      blit(pl.x, pl.y, S, L, true);
      if (!this.checked) {
        const e = gl.getError();
        if (e !== gl.NO_ERROR) console.warn('[genesis] tcache: blit error', e);
        this.checked = true;
      }
      unbind();
      t.baked = true; t.dirty = false; t.stale = false;
      spent += S * S / 2; credit -= S * S / 2;
      st.bakes++; st.bakesTotal++;
    }
    st.texels = spent;
    this.credit = credit0 - spent;
    this.mesh.geometry = undefined as unknown as Mesh['geometry'];
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
    const ms = performance.now() - t0;
    st.bakeMs = ms;
    if (st.bakes) { st.bakeMsPer = st.bakeMsPer ? st.bakeMsPer * 0.9 + 0.1 * ms / st.bakes : ms / st.bakes; st.bakeMsMax = Math.max(st.bakeMsMax, ms); }
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
