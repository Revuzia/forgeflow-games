// VALE render — the VFX system v2 (CONTRACT §9.5 v2 vocabulary; STYLE_BIBLE "VFX"; tokens.json `vfx`).
//
// Layers come parsed from defs.ts (v1 burst/trail/ring/flash keep their meaning through the parser).
// Elements and their draws (one instanced draw per kind, premultiplied "over" so additive light and
// ink share a draw; manual soft depth against the composer's scene depth):
//   emitter   pooled SoA CPU particles: count / bursts / rate / perMeter emission; point · sphere ·
//             ring · disc · cone · line · path · aura shapes; up/out/in/forward/back/down/normal/random
//             directions; drag, gravity, turbulence, orbit, radial pull, ground bounce; size / alpha /
//             emissive / erode curves over life, gradients baked per spawn (team / element resolve here);
//             flipbooks, variants, velocity stretch, ground / axis / camera alignment, local space
//   ribbon    CPU strips that follow an anchor (projectiles, dashes, weapon sockets); camera or ground
//   beam      instanced noise-displaced strips source → target
//   shockwave instanced ground (or camera-facing) rings with a bright leading edge
//   decal     instanced ground marks (plain · scorch · crack · ink · frost · light)
//   mesh      instanced FX shells per shape (fresnel rim, noise, dissolve edge, masks, wobble, twist)
//   light     pooled point lights in the WORLD scene (a fixed count per tier: no shader recompiles)
//   feel      camera shake (via onFeel)        distort  accepted, drawn by a later refraction pass
// The VFX meshes live in `scene` (drawn by the post chain's VFX pass after AO, before bloom, so HDR
// emissive blooms and the grade applies); pooled lights live in `group` (added to the world scene).
//
// Bible rules: emissive caps by tier T0–T4 = 0.8 · 1.5 · 3 · 6 · ≥10; only T4 reaches white (near-white
// colours below T4 become Dawnglass); allies' effects at 65 % opacity with half the secondary
// particles; own T1 at 85 %; quality changes particle DENSITY only.

import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Euler, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, Matrix4, Mesh, type PerspectiveCamera, PlaneGeometry, PointLight, Quaternion, Scene, ShaderMaterial,
  type Texture, Vector3, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import type { VfxDefT } from '../../contracts/catalog.ts';
import { VfxTextures } from './atlas.ts';
import { type ColorRef, evalCurve, GradientPool } from './curves.ts';
import {
  type Anchor, type BeamL, type Def, DIR, type DecalL, type EmitterL, type FeelL, type Layer, type LightL, MESH_ALIGN, type MeshL,
  parseDef, type RibbonL, SHAPE, type ShockwaveL,
} from './defs.ts';
import {
  BEAM_FRAG, BEAM_VERT, DECAL_FRAG, DECAL_VERT, MESH_FRAG, MESH_VERT, PARTICLE_FRAG, PARTICLE_VERT, PREMUL, RIBBON_FRAG, RIBBON_VERT,
  RING_FRAG, RING_VERT, vfxUniforms,
} from './shaders.ts';
import { buildShape, SHAPE_KIND, VFX_SHAPES } from './shapes.ts';

export type VfxAnchor = 'origin' | 'target' | 'path' | 'ground';
export type Tier = 0 | 1 | 2 | 3 | 4;
const TIER_CAP = [0.8, 1.5, 3, 6, 10];
const DAWNGLASS = new Color().setStyle('#BFD3E6');

/** what the VFX system needs from the world (implemented by the renderer) */
export interface VfxWorld {
  /** body-centre world position of an entity (false when it is gone) */
  entityPos(id: number, out: Vector3): boolean;
  /** world position of a named fighter socket (weapon, head, hand_r …); optional */
  socketPos?(id: number, socket: string, out: Vector3): boolean;
}

export interface SpawnOpts {
  tier: Tier;
  team: Color;
  element: Color | null;
  /** ally (not self) effects render at 65 % */
  ally: boolean;
  /** own basic attacks at 85 % */
  ownT1?: boolean;
  origin?: Vector3 | null;
  target?: Vector3 | null;
  ground?: Vector3 | null;
  /** area radius (ground-anchored radius-like values scale with it) */
  scale?: number;
  /** horizontal facing (radians, sim convention) */
  dir?: number;
  follow?: number;
  targetId?: number;
  /** the source entity (sockets, `at: caster` tracking) */
  sourceId?: number;
  /** the default anchor for layers without `at` */
  anchor?: VfxAnchor;
  /** loop the def while this entity exists (zones) */
  loopWhile?: number;
  /** which layers fire: the anticipation (windup) layers or the main ones */
  phase?: 'main' | 'windup';
}

export interface FeelEvent { shake: number; all: boolean; hitFlash: number; hitStop: number; squash: number; at: Vector3 }

// ── pools ─────────────────────────────────────────────────────────────────────────────────────────
const P_MAX = 8000;
const RIB_MAX = 96;
const RIB_PTS = 48;
const BEAM_MAX = 64;
const RING_MAX = 192;
const DECAL_MAX = 160;
const MESH_PER_SHAPE = 48;

class Inst {
  def!: Def;
  t = 0;
  tier: Tier = 2;
  opacity = 1;
  density = 1;
  secondary = 1;
  team = new Color();
  element = new Color();
  origin = new Vector3();
  target = new Vector3();
  ground = new Vector3();
  head = new Vector3();
  prevHead = new Vector3();
  vel = new Vector3();
  scale = 1;
  dir = 0;
  follow = -1;
  following = false;
  targetId = -1;
  sourceId = -1;
  loopWhile = -1;
  anchor: VfxAnchor = 'origin';
  phase: 'main' | 'windup' = 'main';
  active = false;
  fired = new Uint8Array(0);
  acc = new Float32Array(0);
  last = new Float32Array(0);           // per layer: last emit position (x, y, z) for perMeter (3 per layer)
  el = new Int32Array(0);               // per layer: element index (ribbon / mesh)
  grad = new Int32Array(0);             // per layer: baked gradient slot
}

interface Ribbon {
  on: boolean; inst: Inst | null; layer: RibbonL | null; n: number; xs: Float32Array; ys: Float32Array; zs: Float32Array; ts: Float32Array; ds: Float32Array;
  slot: number; opacity: number; cap: number; seed: number; rim: Color; born: number;
}
interface Beam { on: boolean; inst: Inst | null; l: BeamL | null; a: Vector3; b: Vector3; age: number; slot: number; opacity: number; cap: number; seed: number }
interface Ring { on: boolean; l: ShockwaveL | null; x: number; y: number; z: number; age: number; s: number; slot: number; opacity: number; cap: number; seed: number }
interface Decal { on: boolean; l: DecalL | null; x: number; z: number; rot: number; age: number; s: number; slot: number; opacity: number; cap: number; seed: number; rim: Color }
interface MeshEl {
  on: boolean; l: MeshL | null; inst: Inst | null; pos: Vector3; q: Quaternion; age: number; s: number; slot: number; opacity: number; cap: number;
  spinA: number; seed: number; rim: Color; edge: Color; follow: boolean;
}
interface LightEl { light: PointLight; age: number; life: number; attack: number; peak: number; flicker: number }

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _m = new Matrix4();
const _s = new Vector3();
const _c = new Color();
const _rgb = new Float32Array(3);
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3(0, 0, 1);

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

function mkAttr(n: number, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
}
function flush(attrs: (InstancedBufferAttribute | BufferAttribute)[], n: number): void {
  for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * a.itemSize); a.needsUpdate = true; }
}
function material(vert: string, frag: string, extra: Record<string, { value: unknown }> = {}, side = 0): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { ...vfxUniforms, ...extra }, ...PREMUL, side: side as 0 });
}

// cheap smooth 3D noise field for turbulence (deterministic, allocation-free)
function turb(x: number, y: number, z: number, t: number, out: Float32Array): void {
  out[0] = Math.sin(y * 1.7 + t * 1.3) + Math.sin(z * 2.3 - t * 0.7) * 0.6;
  out[1] = Math.sin(z * 1.9 + t * 1.1) * 0.5 + Math.sin(x * 2.1 + t * 0.9) * 0.4;
  out[2] = Math.sin(x * 1.5 - t * 1.2) + Math.sin(y * 2.7 + t * 0.6) * 0.6;
}
const _tb = new Float32Array(3);

export class VfxSystem {
  /** pooled point lights (add to the WORLD scene) */
  readonly group = new Group();
  /** the VFX draws (rendered by the post chain's VFX pass) */
  readonly scene = new Scene();
  readonly textures = new VfxTextures();
  budget = 4000;
  density = 1;
  onFeel: ((e: FeelEvent) => void) | null = null;

  private readonly defs = new Map<string, Def>();
  private readonly world: VfxWorld;
  private camera: PerspectiveCamera | null = null;
  private readonly insts: Inst[] = [];
  private readonly free: Inst[] = [];
  private readonly grads = new GradientPool();
  private now = 0;

  // particles (SoA)
  private pn = 0;
  private readonly P = {
    x: new Float32Array(P_MAX), y: new Float32Array(P_MAX), z: new Float32Array(P_MAX),
    vx: new Float32Array(P_MAX), vy: new Float32Array(P_MAX), vz: new Float32Array(P_MAX),
    age: new Float32Array(P_MAX), life: new Float32Array(P_MAX), sv: new Float32Array(P_MAX), rot: new Float32Array(P_MAX), spin: new Float32Array(P_MAX),
    seed: new Float32Array(P_MAX), slot: new Int32Array(P_MAX), layer: new Int32Array(P_MAX), op: new Float32Array(P_MAX), cap: new Float32Array(P_MAX),
    cx: new Float32Array(P_MAX), cy: new Float32Array(P_MAX), cz: new Float32Array(P_MAX), cell: new Float32Array(P_MAX), rim: new Int32Array(P_MAX),
  };
  /** local-space particles ride their instance's anchor (sprites, `space: local`, `follow`) */
  private readonly pInst: (Inst | null)[] = new Array(P_MAX).fill(null);
  /** emitter layers referenced by particles (index → layer); rim colours resolved per spawn */
  private readonly emitters: EmitterL[] = [];
  private readonly emitterIndex = new Map<EmitterL, number>();
  private readonly rimPool = new Float32Array(1024 * 3);
  private rimNext = 0;
  private readonly pDraw: { geo: InstancedBufferGeometry; mesh: Mesh; aPos: InstancedBufferAttribute; aCol: InstancedBufferAttribute; aVel: InstancedBufferAttribute; aTex: InstancedBufferAttribute; aPar: InstancedBufferAttribute; aRim: InstancedBufferAttribute };

  // ribbons
  private readonly ribbons: Ribbon[] = [];
  private readonly ribDraw: { mesh: Mesh; geo: BufferGeometry; pos: BufferAttribute; col: BufferAttribute; uv: BufferAttribute; prm: BufferAttribute; rim: BufferAttribute };
  // beams / rings / decals
  private readonly beams: Beam[] = [];
  private readonly beamDraw: { mesh: Mesh; geo: InstancedBufferGeometry; aA: InstancedBufferAttribute; aB: InstancedBufferAttribute; aC: InstancedBufferAttribute; aD: InstancedBufferAttribute; aE: InstancedBufferAttribute };
  private readonly rings: Ring[] = [];
  private readonly ringDraw: { mesh: Mesh; geo: InstancedBufferGeometry; aPos: InstancedBufferAttribute; aSty: InstancedBufferAttribute; aCol: InstancedBufferAttribute; aMisc: InstancedBufferAttribute };
  private readonly decals: Decal[] = [];
  private readonly decalDraw: { mesh: Mesh; geo: InstancedBufferGeometry; aPos: InstancedBufferAttribute; aRot: InstancedBufferAttribute; aCol: InstancedBufferAttribute; aMisc: InstancedBufferAttribute; aRimC: InstancedBufferAttribute };
  // meshes
  private readonly meshEls: MeshEl[] = [];
  private readonly shapeDraws = new Map<number, { mesh: InstancedMesh; n: number; aColor: InstancedBufferAttribute; aRimC: InstancedBufferAttribute; aEdge: InstancedBufferAttribute; aNoise: InstancedBufferAttribute; aDiss: InstancedBufferAttribute; aMisc: InstancedBufferAttribute }>();
  // lights
  private lights: LightEl[] = [];

  constructor(defs: readonly VfxDefT[], world: VfxWorld) {
    this.world = world;
    for (const d of defs) {
      const def = parseDef(d);
      this.defs.set(d.id, def);
      for (const l of def.layers) if (l.type === 'emitter' && !this.emitterIndex.has(l)) { this.emitterIndex.set(l, this.emitters.length); this.emitters.push(l); }
    }
    this.group.name = 'vale_vfx_lights';
    this.scene.name = 'vale_vfx';
    vfxUniforms.uAtlas.value = this.textures.atlas;
    vfxUniforms.uNoise.value = this.textures.noise;
    const quad = new PlaneGeometry(1, 1);
    const instGeo = (): InstancedBufferGeometry => {
      const g = new InstancedBufferGeometry();
      g.index = quad.index; g.setAttribute('position', quad.getAttribute('position')); g.instanceCount = 0;
      return g;
    };
    {
      const geo = instGeo();
      const aPos = mkAttr(P_MAX, 4), aCol = mkAttr(P_MAX, 4), aVel = mkAttr(P_MAX, 4), aTex = mkAttr(P_MAX, 4), aPar = mkAttr(P_MAX, 4), aRim = mkAttr(P_MAX, 4);
      for (const [k, a] of Object.entries({ aPos, aCol, aVel, aTex, aPar, aRim })) geo.setAttribute(k, a);
      const mesh = new Mesh(geo, material(PARTICLE_VERT, PARTICLE_FRAG));
      mesh.frustumCulled = false; mesh.renderOrder = 12;
      this.scene.add(mesh);
      this.pDraw = { geo, mesh, aPos, aCol, aVel, aTex, aPar, aRim };
    }
    {
      const max = RIB_MAX * RIB_PTS * 2;
      const geo = new BufferGeometry();
      const mk = (n: number): BufferAttribute => { const a = new BufferAttribute(new Float32Array(max * n), n); a.setUsage(DynamicDrawUsage); return a; };
      const pos = mk(3), col = mk(4), uv = mk(4), prm = mk(4), rim = mk(4);
      geo.setAttribute('position', pos); geo.setAttribute('aCol', col); geo.setAttribute('aUv', uv); geo.setAttribute('aPrm', prm); geo.setAttribute('aRimC', rim);
      const idx: number[] = [];
      for (let t = 0; t < RIB_MAX; t++) for (let k = 0; k < RIB_PTS - 1; k++) { const b = (t * RIB_PTS + k) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      geo.setIndex(idx);
      geo.setDrawRange(0, 0);
      const mesh = new Mesh(geo, material(RIBBON_VERT, RIBBON_FRAG, {}, 2));
      mesh.frustumCulled = false; mesh.renderOrder = 10;
      this.scene.add(mesh);
      this.ribDraw = { mesh, geo, pos, col, uv, prm, rim };
      for (let i = 0; i < RIB_MAX; i++) this.ribbons.push({ on: false, inst: null, layer: null, n: 0, xs: new Float32Array(RIB_PTS), ys: new Float32Array(RIB_PTS), zs: new Float32Array(RIB_PTS), ts: new Float32Array(RIB_PTS), ds: new Float32Array(RIB_PTS), slot: 0, opacity: 1, cap: 1, seed: 0, rim: new Color(), born: 0 });
    }
    {
      // beam strip: 32 segments along x ∈ [0, 1], y ∈ [-0.5, 0.5]
      const seg = 32;
      const pos: number[] = [], idx: number[] = [];
      for (let i = 0; i <= seg; i++) { pos.push(i / seg, -0.5, 0, i / seg, 0.5, 0); }
      for (let i = 0; i < seg; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      const geo = new InstancedBufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(idx);
      geo.instanceCount = 0;
      const aA = mkAttr(BEAM_MAX, 4), aB = mkAttr(BEAM_MAX, 4), aC = mkAttr(BEAM_MAX, 4), aD = mkAttr(BEAM_MAX, 4), aE = mkAttr(BEAM_MAX, 4);
      for (const [k, a] of Object.entries({ aA, aB, aC, aD, aE })) geo.setAttribute(k, a);
      const mesh = new Mesh(geo, material(BEAM_VERT, BEAM_FRAG, {}, 2));
      mesh.frustumCulled = false; mesh.renderOrder = 12;
      this.scene.add(mesh);
      this.beamDraw = { mesh, geo, aA, aB, aC, aD, aE };
      for (let i = 0; i < BEAM_MAX; i++) this.beams.push({ on: false, inst: null, l: null, a: new Vector3(), b: new Vector3(), age: 0, slot: 0, opacity: 1, cap: 1, seed: 0 });
    }
    {
      const geo = instGeo();
      const aPos = mkAttr(RING_MAX, 4), aSty = mkAttr(RING_MAX, 4), aCol = mkAttr(RING_MAX, 4), aMisc = mkAttr(RING_MAX, 4);
      for (const [k, a] of Object.entries({ aPos, aSty, aCol, aMisc })) geo.setAttribute(k, a);
      const mesh = new Mesh(geo, material(RING_VERT, RING_FRAG, {}, 2));
      mesh.frustumCulled = false; mesh.renderOrder = 9;
      this.scene.add(mesh);
      this.ringDraw = { mesh, geo, aPos, aSty, aCol, aMisc };
      for (let i = 0; i < RING_MAX; i++) this.rings.push({ on: false, l: null, x: 0, y: 0, z: 0, age: 0, s: 1, slot: 0, opacity: 1, cap: 1, seed: 0 });
    }
    {
      const geo = instGeo();
      const aPos = mkAttr(DECAL_MAX, 4), aRot = mkAttr(DECAL_MAX, 4), aCol = mkAttr(DECAL_MAX, 4), aMisc = mkAttr(DECAL_MAX, 4), aRimC = mkAttr(DECAL_MAX, 4);
      for (const [k, a] of Object.entries({ aPos, aRot, aCol, aMisc, aRimC })) geo.setAttribute(k, a);
      const mesh = new Mesh(geo, material(DECAL_VERT, DECAL_FRAG, {}, 2));
      mesh.frustumCulled = false; mesh.renderOrder = 8;
      this.scene.add(mesh);
      this.decalDraw = { mesh, geo, aPos, aRot, aCol, aMisc, aRimC };
      for (let i = 0; i < DECAL_MAX; i++) this.decals.push({ on: false, l: null, x: 0, z: 0, rot: 0, age: 0, s: 1, slot: 0, opacity: 1, cap: 1, seed: 0, rim: new Color() });
    }
    for (let i = 0; i < 192; i++) {
      this.meshEls.push({ on: false, l: null, inst: null, pos: new Vector3(), q: new Quaternion(), age: 0, s: 1, slot: 0, opacity: 1, cap: 1, spinA: 0, seed: 0, rim: new Color(), edge: new Color(), follow: false });
    }
  }

  has(id: string | undefined | null): boolean { return !!id && this.defs.has(id); }
  def(id: string): Def | undefined { return this.defs.get(id); }
  get ids(): string[] { return [...this.defs.keys()]; }
  setCamera(c: PerspectiveCamera): void { this.camera = c; }

  /** fixed pool of point lights (0 on Low) */
  setLightCount(n: number): void {
    for (const l of this.lights) { this.group.remove(l.light); l.light.dispose(); }
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const light = new PointLight(0xffffff, 0, 6, 2);
      light.castShadow = false;
      this.group.add(light);
      this.lights.push({ light, age: 1, life: 0, attack: 0, peak: 0, flicker: 0 });
    }
  }

  get particleCount(): number { return this.pn; }
  get instanceCount(): number { return this.insts.length; }

  // ── spawning ─────────────────────────────────────────────────────────────────────────────────
  spawn(id: string | undefined | null, o: SpawnOpts): boolean {
    if (!id) return false;
    const def = this.defs.get(id);
    if (!def) return false;
    const it = this.free.pop() ?? new Inst();
    it.def = def;
    it.t = 0;
    it.tier = o.tier;
    it.opacity = o.ally ? 0.65 : o.ownT1 ? 0.85 : 1;
    it.secondary = o.ally ? 0.5 : 1;
    it.density = this.density * (o.ally ? 0.75 : 1);
    it.team.copy(o.team);
    it.element.copy(o.element ?? o.team);
    const fallback = o.ground ?? o.origin ?? o.target ?? _v.set(0, 0, 0);
    it.origin.copy(o.origin ?? fallback);
    it.target.copy(o.target ?? fallback);
    it.ground.copy(o.ground ?? fallback);
    it.ground.y = 0;
    it.scale = o.scale && o.scale > 0 ? o.scale : 1;
    it.dir = o.dir ?? 0;
    // entity ids are >= 0; the renderer's test movers (VFX gallery) use ids <= -1000
    it.follow = o.follow ?? -1;
    it.following = it.follow !== -1;
    it.targetId = o.targetId ?? -1;
    it.sourceId = o.sourceId ?? -1;
    it.loopWhile = o.loopWhile ?? -1;
    it.anchor = o.anchor ?? 'origin';
    it.phase = o.phase ?? 'main';
    if (it.following && this.world.entityPos(it.follow, it.head)) it.prevHead.copy(it.head);
    else { it.head.copy(it.origin); it.prevHead.copy(it.origin); }
    it.vel.set(0, 0, 0);
    const n = def.layers.length;
    if (it.fired.length < n) {
      it.fired = new Uint8Array(n); it.acc = new Float32Array(n); it.last = new Float32Array(n * 3); it.el = new Int32Array(n); it.grad = new Int32Array(n);
    }
    it.fired.fill(0); it.acc.fill(0); it.el.fill(-1); it.grad.fill(-1);
    it.active = true;
    this.insts.push(it);
    return true;
  }

  // ── colour helpers ───────────────────────────────────────────────────────────────────────────
  private resolve(ref: ColorRef | null, it: Inst, out: Color): Color {
    if (!ref || ref.k === 1) out.copy(it.team);
    else if (ref.k === 0) out.copy(ref.c);
    else out.copy(it.element);
    if (it.tier < 4 && out.r > 0.88 && out.g > 0.88 && out.b > 0.88) out.copy(DAWNGLASS);
    return out;
  }

  private bake(it: Inst, li: number, g: import('./curves.ts').Gradient): number {
    if (it.grad[li] >= 0) return it.grad[li];
    const slot = this.grads.bake(g, (r, out) => this.resolve(r, it, out));
    it.grad[li] = slot;
    return slot;
  }

  private rimSlot(c: Color): number {
    const s = this.rimNext;
    this.rimNext = (this.rimNext + 1) % 1024;
    this.rimPool[s * 3] = c.r; this.rimPool[s * 3 + 1] = c.g; this.rimPool[s * 3 + 2] = c.b;
    return s;
  }

  private cap(it: Inst): number { return TIER_CAP[it.tier]; }
  private capE(it: Inst, e: number): number { return it.tier >= 4 ? Math.max(e, 0) : Math.min(TIER_CAP[it.tier], e); }

  /** the anchor position of a layer (+ socket, + offset in the facing frame) */
  private anchorPos(it: Inst, l: Layer, out: Vector3): Vector3 {
    const at: Anchor = l.at ?? (l.type === 'ribbon' ? 'path' : it.anchor);
    switch (at) {
      case 'target': out.copy(it.target); break;
      case 'path': out.copy(it.head); break;
      case 'ground': out.copy(it.ground); break;
      case 'caster': if (!(it.sourceId >= 0 && this.world.entityPos(it.sourceId, out))) out.copy(it.origin); break;
      default: out.copy(it.origin);
    }
    if (l.socket && this.world.socketPos) {
      const id = at === 'target' ? it.targetId : it.sourceId >= 0 ? it.sourceId : it.follow;
      if (id >= 0) this.world.socketPos(id, l.socket, out);
    }
    if (l.offset) {
      const f = l.offset[0], u = l.offset[1], r = l.offset[2];
      const cx = Math.cos(it.dir), sz = Math.sin(it.dir);
      out.x += cx * f - sz * r; out.y += u; out.z += sz * f + cx * r;
    }
    return out;
  }

  private atOf(it: Inst, l: Layer): Anchor { return l.at ?? (l.type === 'ribbon' ? 'path' : it.anchor); }
  private fitOf(it: Inst, l: Layer): number { const at = this.atOf(it, l); return (l.fit ?? at === 'ground') ? it.scale : 1; }

  // ── emitters ─────────────────────────────────────────────────────────────────────────────────
  private emit(it: Inst, li: number, l: EmitterL, count: number): void {
    if (count <= 0) return;
    const P = this.P;
    const at = this.atOf(it, l);
    const c = this.anchorPos(it, l, _v3);
    if (at === 'ground') c.y = Math.max(c.y, 0.06);
    const s = this.fitOf(it, l);
    const slot = this.bake(it, li, l.color);
    const rim = l.rim ? this.rimSlot(this.resolve(l.rim, it, _c)) : -1;
    const li2 = this.emitterIndex.get(l) ?? 0;
    const fx = Math.cos(it.dir), fz = Math.sin(it.dir);
    // base direction for path layers: against travel
    let tx = 0, ty = 0, tz = 0;
    if (it.vel.lengthSq() > 1e-4) { _v2.copy(it.vel).normalize(); tx = _v2.x; ty = _v2.y; tz = _v2.z; }
    const legacyScale = l.legacy && at === 'ground' ? Math.min(2.5, Math.max(1, it.scale * 0.5)) : 1;
    for (let k = 0; k < count; k++) {
      if (this.pn >= Math.min(P_MAX, this.budget)) return;
      const i = this.pn++;
      // spawn position by shape (local: x right, y up, z forward around the anchor)
      let px = 0, py = 0, pz = 0, nx = 0, ny = 1, nz = 0;
      const R = l.radius * s;
      switch (l.shape) {
        case SHAPE.sphere: {
          const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
          nx = rr * Math.cos(ph); ny = u; nz = rr * Math.sin(ph);
          const rad = l.surface ? R : R * Math.cbrt(Math.random());
          px = nx * rad; py = ny * rad; pz = nz * rad;
          break;
        }
        case SHAPE.ring: case SHAPE.disc: case SHAPE.aura: {
          const ph = Math.random() * Math.PI * 2;
          const inner = l.shape === SHAPE.ring ? Math.max(l.radiusInner * s, R * 0.92) : l.radiusInner * s;
          const rad = l.shape === SHAPE.ring || l.surface ? rnd(inner, R) : Math.sqrt(rnd((inner / Math.max(R, 1e-4)) ** 2, 1)) * R;
          nx = Math.cos(ph); nz = Math.sin(ph); ny = 0;
          px = nx * rad; pz = nz * rad;
          py = l.shape === SHAPE.aura ? Math.random() * (l.height || 1.6) : 0;
          break;
        }
        case SHAPE.cone: {
          const a = l.angle * 0.5, ang = rnd(-a, a), d = Math.random() * l.length * s;
          const lx = Math.sin(ang), lz = Math.cos(ang);
          px = lz * d * fx - lx * d * fz; pz = lz * d * fz + lx * d * fx;
          nx = px; nz = pz; ny = 0; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          break;
        }
        case SHAPE.line: {
          const d = Math.random() * l.length * s, w = (Math.random() - 0.5) * l.width * s;
          px = fx * d - fz * w; pz = fz * d + fx * w; nx = fx; nz = fz; ny = 0;
          break;
        }
        case SHAPE.path: {
          // between the previous head and the current one (fills fast projectiles)
          const f = Math.random();
          px = (it.prevHead.x - it.head.x) * f; py = (it.prevHead.y - it.head.y) * f; pz = (it.prevHead.z - it.head.z) * f;
          break;
        }
        default:
          if (l.legacy && at === 'ground') { px = (Math.random() - 0.5) * 0.3 * it.scale; pz = (Math.random() - 0.5) * 0.3 * it.scale; }
      }
      P.x[i] = c.x + px; P.y[i] = c.y + py; P.z[i] = c.z + pz;
      P.cx[i] = c.x; P.cy[i] = c.y; P.cz[i] = c.z;
      // direction
      let bx = 0, by = 1, bz = 0;
      switch (l.dir) {
        case DIR.out: { const nl = Math.hypot(nx, ny, nz); if (nl > 1e-4) { bx = nx / nl; by = ny / nl; bz = nz / nl; } break; }
        case DIR.in: { const nl = Math.hypot(nx, ny, nz); if (nl > 1e-4) { bx = -nx / nl; by = -ny / nl; bz = -nz / nl; } break; }
        case DIR.forward: bx = fx; by = 0; bz = fz; break;
        case DIR.back: if (tx || ty || tz) { bx = -tx; by = -ty * 0.5 + 0.2; bz = -tz; } else { bx = -fx; by = 0; bz = -fz; } break;
        case DIR.down: by = -1; break;
        case DIR.normal: bx = nx; by = ny; bz = nz; break;
        case DIR.random: { const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u); bx = rr * Math.cos(ph); by = u; bz = rr * Math.sin(ph); break; }
        case DIR.none: bx = 0; by = 0; bz = 0; break;
        default: break;
      }
      let dx = bx, dy = by, dz = bz;
      const bl = Math.hypot(bx, by, bz);
      if (bl > 1e-4 && l.spread > 0) {
        bx /= bl; by /= bl; bz /= bl;
        const ca = Math.cos(Math.random() * l.spread * 0.5), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
        const ph = Math.random() * Math.PI * 2;
        let ox = 1, oy = 0, oz = 0;
        if (Math.abs(bx) > 0.9) { ox = 0; oy = 1; }
        let ux = by * oz - bz * oy, uy = bz * ox - bx * oz, uz = bx * oy - by * ox;
        const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
        const wx = by * uz - bz * uy, wy = bz * ux - bx * uz, wz = bx * uy - by * ux;
        dx = bx * ca + (ux * Math.cos(ph) + wx * Math.sin(ph)) * sa;
        dy = by * ca + (uy * Math.cos(ph) + wy * Math.sin(ph)) * sa;
        dz = bz * ca + (uz * Math.cos(ph) + wz * Math.sin(ph)) * sa;
      }
      const sp = rnd(l.speed[0], l.speed[1]) * legacyScale * (l.legacy ? 1 : Math.max(1, Math.sqrt(s)));
      const vf = l.velocity[0], vu = l.velocity[1], vr = l.velocity[2];
      P.vx[i] = dx * sp + fx * vf - fz * vr + it.vel.x * l.inherit;
      P.vy[i] = dy * sp + vu + it.vel.y * l.inherit;
      P.vz[i] = dz * sp + fz * vf + fx * vr + it.vel.z * l.inherit;
      P.age[i] = 0;
      P.life[i] = rnd(l.life[0], l.life[1]);
      P.sv[i] = rnd(l.sizeVar[0], l.sizeVar[1]) * (l.legacy ? 1 : Math.min(2.5, Math.sqrt(s)));
      P.rot[i] = rnd(l.rot[0], l.rot[1]);
      P.spin[i] = rnd(l.spin[0], l.spin[1]);
      P.seed[i] = Math.random();
      P.slot[i] = slot;
      P.layer[i] = li2;
      P.op[i] = it.opacity;
      P.cap[i] = it.tier >= 4 ? 1e3 : this.cap(it);
      P.cell[i] = l.tex.cell + (l.tex.variants ? Math.floor(Math.random() * l.tex.frames) : 0) + (l.frame >= 0 && !l.tex.variants ? Math.min(l.frame, l.tex.frames - 1) : 0);
      P.rim[i] = rim;
      this.pInst[i] = l.local || l.follow ? it : null;
    }
  }

  private fireEmitter(it: Inst, li: number, l: EmitterL, d: number, t: number): void {
    const den = it.density * (l.secondary ? it.secondary : 1);
    const at = this.atOf(it, l);
    if (!it.fired[li]) {
      it.fired[li] = 1;
      if (Math.random() > l.chance) { it.acc[li] = -1; return; }
      const p = this.anchorPos(it, l, _v);
      it.last[li * 3] = p.x; it.last[li * 3 + 1] = p.y; it.last[li * 3 + 2] = p.z;
      // legacy path bursts emit along the path while followed
      if (!(l.legacy && at === 'path' && it.following)) this.emit(it, li, l, Math.max(l.count > 0 ? 1 : 0, Math.round(l.count * den)));
    }
    if (it.acc[li] < 0) return;
    const local = t;
    // scheduled bursts
    for (const [bt, n] of l.bursts) if (local - d < bt && local >= bt) this.emit(it, li, l, Math.max(1, Math.round(n * den)));
    // rate over the emission window
    const win = l.duration >= 0 ? l.duration : it.def.duration;
    let rate = l.rate;
    if (l.legacy && at === 'path' && it.following) rate = Math.max(1, Math.round(l.count * den)) / Math.max(0.2, it.def.duration);
    if (rate > 0 && (local <= win || (at === 'path' && it.following) || it.loopWhile >= 0)) {
      it.acc[li] += rate * (l.legacy ? 1 : den) * d;
      const k = Math.floor(it.acc[li]);
      if (k > 0) { it.acc[li] -= k; this.emit(it, li, l, k); }
    }
    if (l.perMeter > 0) {
      const p = this.anchorPos(it, l, _v);
      const lx = it.last[li * 3], ly = it.last[li * 3 + 1], lz = it.last[li * 3 + 2];
      const dist = Math.hypot(p.x - lx, p.y - ly, p.z - lz);
      it.acc[li] += dist * l.perMeter * den;
      it.last[li * 3] = p.x; it.last[li * 3 + 1] = p.y; it.last[li * 3 + 2] = p.z;
      const k = Math.floor(it.acc[li]);
      if (k > 0) { it.acc[li] -= k; this.emit(it, li, l, Math.min(k, 64)); }
    }
  }

  // ── other layers ─────────────────────────────────────────────────────────────────────────────
  private fireLayer(it: Inst, li: number, d: number): void {
    const l = it.def.layers[li];
    if (l.windup !== (it.phase === 'windup')) return;
    const t = it.t - l.delay;
    if (l.type === 'emitter') { this.fireEmitter(it, li, l, d, t); return; }
    const at = this.atOf(it, l);
    if (l.type === 'ribbon' || (l.type === 'mesh' && (at === 'path' || l.follow))) {
      if (it.fired[li]) { this.trackElement(it, li, l); return; }
    } else if (it.fired[li]) return;
    it.fired[li] = 1;
    if (Math.random() > l.chance) return;
    const s = this.fitOf(it, l);
    switch (l.type) {
      case 'ribbon': {
        const r = this.ribbons.find((x) => !x.on);
        if (!r) return;
        r.on = true; r.inst = it; r.layer = l; r.n = 0; r.slot = this.bake(it, li, l.color); r.opacity = it.opacity; r.cap = this.cap(it); r.seed = Math.random(); r.born = this.now;
        if (l.rim) this.resolve(l.rim, it, r.rim);
        it.el[li] = this.ribbons.indexOf(r);
        this.ribPush(r, this.anchorPos(it, l, _v));
        return;
      }
      case 'beam': {
        const b = this.beams.find((x) => !x.on);
        if (!b) return;
        b.on = true; b.inst = it; b.l = l; b.age = 0; b.slot = this.bake(it, li, l.color); b.opacity = it.opacity; b.cap = this.cap(it); b.seed = Math.random();
        this.beamEnds(it, b);
        return;
      }
      case 'shockwave': {
        const r = this.rings.find((x) => !x.on);
        if (!r) return;
        const p = this.anchorPos(it, l, _v);
        r.on = true; r.l = l; r.x = p.x; r.y = l.vertical ? p.y : (at === 'path' ? p.y : 0.06); r.z = p.z;
        r.age = 0; r.s = s; r.slot = this.bake(it, li, l.color); r.opacity = it.opacity; r.cap = this.cap(it); r.seed = Math.random();
        return;
      }
      case 'decal': {
        if (it.tier <= 1) return; // T1: no decals
        const dc = this.decals.find((x) => !x.on);
        if (!dc) return;
        const p = this.anchorPos(it, l, _v);
        dc.on = true; dc.l = l; dc.x = p.x; dc.z = p.z; dc.rot = it.dir + (l.spinRandom ? Math.random() * Math.PI * 2 : 0);
        dc.age = 0; dc.s = s; dc.slot = this.bake(it, li, l.color); dc.opacity = it.opacity; dc.cap = this.cap(it); dc.seed = Math.random();
        this.resolve(l.rim ?? null, it, dc.rim);
        if (!l.rim) dc.rim.copy(it.team);
        return;
      }
      case 'mesh': {
        const e = this.meshEls.find((x) => !x.on);
        if (!e) return;
        const p = this.anchorPos(it, l, _v);
        e.on = true; e.l = l; e.inst = at === 'path' || l.follow ? it : null; e.follow = at === 'path' || l.follow;
        e.pos.copy(p); if (at === 'ground') e.pos.y = 0.02;
        e.age = 0; e.s = s; e.slot = this.bake(it, li, l.color); e.opacity = it.opacity; e.cap = this.cap(it); e.spinA = 0; e.seed = Math.random();
        if (l.rim) this.resolve(l.rim, it, e.rim); else e.rim.setRGB(0, 0, 0);
        if (l.edge) this.resolve(l.edge, it, e.edge); else e.edge.copy(it.team);
        this.orientMesh(e, it, l);
        it.el[li] = this.meshEls.indexOf(e);
        return;
      }
      case 'light': this.fireLight(it, l); return;
      case 'feel': this.fireFeel(it, l); return;
      default: return; // distort: drawn by the refraction pass (not yet)
    }
  }

  private trackElement(it: Inst, li: number, l: Layer): void {
    const ei = it.el[li];
    if (ei < 0 || !it.following && this.atOf(it, l) === 'path') return;
    if (l.type === 'ribbon') { const r = this.ribbons[ei]; if (r.on && r.inst === it) this.ribPush(r, this.anchorPos(it, l, _v)); }
    else if (l.type === 'mesh') { const e = this.meshEls[ei]; if (e.on && e.inst === it) { this.anchorPos(it, l, e.pos); this.orientMesh(e, it, l); } }
  }

  private orientMesh(e: MeshEl, it: Inst, l: MeshL): void {
    if (l.align === MESH_ALIGN.velocity || (this.atOf(it, l) === 'path' && it.vel.lengthSq() > 1e-4)) {
      _v2.copy(it.vel);
      if (_v2.lengthSq() < 1e-6) _v2.set(Math.cos(it.dir), 0, Math.sin(it.dir));
      e.q.setFromUnitVectors(_fwd, _v2.normalize());
    } else if (l.align === MESH_ALIGN.up) {
      e.q.identity();
    } else {
      // dir / flat / camera: yaw to the facing (the camera case orients per frame in the draw)
      e.q.setFromAxisAngle(_up, Math.PI / 2 - it.dir);
    }
    if (l.rotate[0] || l.rotate[1] || l.rotate[2]) e.q.multiply(_q.setFromEuler(_e.set(l.rotate[0], l.rotate[1], l.rotate[2])));
  }

  private beamEnds(it: Inst, b: Beam): void {
    const l = b.l!;
    const fromL = { ...l, at: l.from } as Layer;
    this.anchorPos(it, fromL, b.a);
    if (l.to) this.anchorPos(it, { ...l, at: l.to, offset: null } as Layer, b.b);
    else b.b.copy(it.targetId >= 0 || it.anchor === 'target' ? it.target : it.head);
    if (b.b.distanceToSquared(b.a) < 1e-4) b.b.copy(b.a).add(_v2.set(Math.cos(it.dir), 0, Math.sin(it.dir)).multiplyScalar(4));
  }

  private fireLight(it: Inst, l: LightL): void {
    if (!this.lights.length) return;
    const le = this.lights.find((x) => x.age >= x.life) ?? this.lights.reduce<LightEl | null>((a, b) => (!a || b.peak < a.peak ? b : a), null);
    if (!le) return;
    const p = this.anchorPos(it, l, _v);
    le.light.position.copy(p).y += this.atOf(it, l) === 'ground' ? 0.6 : 0.3;
    this.resolve(l.color, it, le.light.color);
    le.light.distance = l.radius * Math.max(1, Math.sqrt(this.fitOf(it, l)));
    le.age = 0; le.life = l.life; le.attack = l.attack; le.flicker = l.flicker;
    le.peak = Math.min(l.intensity, it.tier >= 4 ? 40 : TIER_CAP[it.tier] * 5) * it.opacity;
  }

  private fireFeel(it: Inst, l: FeelL): void {
    if (!this.onFeel) return;
    this.onFeel({ shake: l.shake, all: l.who === 1, hitFlash: l.hitFlash, hitStop: l.hitStop, squash: l.squash, at: this.anchorPos(it, l, new Vector3()) });
  }

  private ribPush(r: Ribbon, p: Vector3): void {
    const l = r.layer!;
    if (r.n > 0) {
      const j = r.n - 1;
      const dd = Math.hypot(p.x - r.xs[j], p.y - r.ys[j], p.z - r.zs[j]);
      if (dd < l.minDist && r.n > 1) { r.xs[j] = p.x; r.ys[j] = p.y; r.zs[j] = p.z; r.ts[j] = this.now; r.ds[j] = r.ds[j - 1] + Math.hypot(p.x - r.xs[j - 1], p.y - r.ys[j - 1], p.z - r.zs[j - 1]); return; }
    }
    if (r.n >= RIB_PTS) {
      for (const a of [r.xs, r.ys, r.zs, r.ts, r.ds]) a.copyWithin(0, 1);
      r.n = RIB_PTS - 1;
    }
    const k = r.n;
    r.xs[k] = p.x; r.ys[k] = l.flat ? 0.05 : p.y; r.zs[k] = p.z; r.ts[k] = this.now;
    r.ds[k] = k > 0 ? r.ds[k - 1] + Math.hypot(p.x - r.xs[k - 1], r.ys[k] - r.ys[k - 1], p.z - r.zs[k - 1]) : 0;
    r.n++;
  }

  // ── per frame ────────────────────────────────────────────────────────────────────────────────
  update(dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.now += d;
    vfxUniforms.uTime.value = this.now;
    for (let k = this.insts.length - 1; k >= 0; k--) {
      const it = this.insts[k];
      it.t += d;
      if (it.following) {
        it.prevHead.copy(it.head);
        if (this.world.entityPos(it.follow, it.head)) {
          if (d > 0) it.vel.copy(it.head).sub(it.prevHead).divideScalar(d);
        } else {
          it.following = false;
          it.head.copy(it.prevHead);
          for (let li = 0; li < it.def.layers.length; li++) {
            const ei = it.el[li];
            const l = it.def.layers[li];
            if (ei >= 0 && l.type === 'mesh') { const e = this.meshEls[ei]; if (e.inst === it) { e.inst = null; e.follow = false; e.age = Math.max(e.age, (l.life) - 0.1); } }
          }
        }
      }
      if (it.targetId >= 0) this.world.entityPos(it.targetId, it.target);
      const layers = it.def.layers;
      for (let li = 0; li < layers.length; li++) if (it.t >= layers[li].delay) this.fireLayer(it, li, d);
      // beams track their ends
      for (const b of this.beams) if (b.on && b.inst === it) this.beamEnds(it, b);
      if (it.loopWhile >= 0 && it.t >= it.def.duration) {
        if (this.world.entityPos(it.loopWhile, _v)) {
          it.t = 0; it.fired.fill(0); it.acc.fill(0); it.grad.fill(-1);
          it.ground.set(_v.x, 0, _v.z);
          continue;
        }
        it.loopWhile = -1;
      }
      if (!it.following && it.loopWhile < 0 && it.t >= it.def.span + 0.05) {
        for (const r of this.ribbons) if (r.inst === it) r.inst = null;
        for (const e of this.meshEls) if (e.inst === it) { e.inst = null; e.follow = false; }
        for (const b of this.beams) if (b.inst === it) b.inst = null;
        it.active = false;
        this.insts.splice(k, 1);
        this.free.push(it);
      }
    }
    this.updateParticles(d);
    this.updateRibbons();
    this.updateElements(d);
    for (const le of this.lights) {
      if (le.age >= le.life) { le.light.intensity = 0; continue; }
      le.age += d;
      const x = le.age / Math.max(1e-3, le.life);
      const a = le.attack > 0 ? Math.min(1, le.age / le.attack) : 1;
      const f = le.flicker > 0 ? 1 - le.flicker * (0.5 + 0.5 * Math.sin(this.now * 37 + le.peak)) : 1;
      le.light.intensity = le.peak * a * (1 - x) * (1 - x) * f;
    }
  }

  private updateParticles(d: number): void {
    const P = this.P;
    let n = this.pn;
    for (let i = 0; i < n; i++) {
      P.age[i] += d;
      if (P.age[i] >= P.life[i]) {
        n--;
        if (i !== n) this.moveParticle(n, i);
        i--;
        continue;
      }
      const l = this.emitters[P.layer[i]];
      const owner = this.pInst[i];
      if (owner) {
        if (owner.active && owner.def.layers.includes(l)) {
          const a = this.anchorPos(owner, l, _v);
          if (this.atOf(owner, l) === 'ground') a.y = Math.max(a.y, 0.06);
          P.x[i] += a.x - P.cx[i]; P.y[i] += a.y - P.cy[i]; P.z[i] += a.z - P.cz[i];
          P.cx[i] = a.x; P.cy[i] = a.y; P.cz[i] = a.z;
        } else this.pInst[i] = null;
      }
      const dr = l.drag > 0 ? Math.exp(-l.drag * d) : 1;
      P.vx[i] *= dr; P.vy[i] *= dr; P.vz[i] *= dr;
      P.vy[i] -= l.gravity * d;
      if (l.turb > 0) {
        turb(P.x[i] * l.turbScale, P.y[i] * l.turbScale, P.z[i] * l.turbScale, this.now + P.seed[i] * 10, _tb);
        P.vx[i] += _tb[0] * l.turb * d; P.vy[i] += _tb[1] * l.turb * d; P.vz[i] += _tb[2] * l.turb * d;
      }
      if (l.orbit !== 0 || l.radial !== 0) {
        const rx = P.x[i] - P.cx[i], rz = P.z[i] - P.cz[i];
        const rl = Math.hypot(rx, rz);
        if (rl > 1e-4) {
          if (l.orbit !== 0) { const w = l.orbit * d; const c = Math.cos(w), s = Math.sin(w); P.x[i] = P.cx[i] + rx * c - rz * s; P.z[i] = P.cz[i] + rx * s + rz * c; }
          if (l.radial !== 0) { P.vx[i] += (rx / rl) * l.radial * d; P.vz[i] += (rz / rl) * l.radial * d; }
        }
      }
      P.x[i] += P.vx[i] * d; P.y[i] += P.vy[i] * d; P.z[i] += P.vz[i] * d;
      if (l.collide && P.y[i] < 0.02) { P.y[i] = 0.02; P.vy[i] *= -l.bounce; P.vx[i] *= 0.6; P.vz[i] *= 0.6; }
      P.rot[i] += P.spin[i] * d;
    }
    this.pn = n;
    const D = this.pDraw;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const l = this.emitters[P.layer[i]];
      const t = Math.min(1, P.age[i] / P.life[i]);
      const size = evalCurve(l.size, t) * P.sv[i];
      const a = Math.max(0, evalCurve(l.alpha, t)) * P.op[i];
      if (a < 0.003 || size <= 0) continue;
      const e = Math.min(P.cap[i], Math.max(0, evalCurve(l.emissive, t)));
      this.grads.sample(P.slot[i], t, _rgb, 0);
      let cell = P.cell[i], blend = 0;
      if (l.tex.frames > 1 && !l.tex.variants && l.frame < 0) {
        const fr = l.fps > 0 ? (P.age[i] * l.fps) % l.tex.frames : t * (l.tex.frames - 1);
        cell = l.tex.cell + Math.floor(fr); blend = fr - Math.floor(fr);
        if (cell >= l.tex.cell + l.tex.frames - 1) blend = 0;
      }
      D.aPos.setXYZW(j, P.x[i], P.y[i], P.z[i], size);
      D.aCol.setXYZW(j, _rgb[0] * e, _rgb[1] * e, _rgb[2] * e, a);
      D.aVel.setXYZW(j, P.vx[i], P.vy[i], P.vz[i], l.stretch);
      D.aTex.setXYZW(j, cell, blend, P.rot[i], Math.max(0, evalCurve(l.erode, t)));
      D.aPar.setXYZW(j, l.soft, l.rimAmt, l.blend, l.align);
      const r = P.rim[i];
      if (r >= 0) D.aRim.setXYZW(j, this.rimPool[r * 3] * 1.5, this.rimPool[r * 3 + 1] * 1.5, this.rimPool[r * 3 + 2] * 1.5, l.aspect);
      else D.aRim.setXYZW(j, 1, 1, 1, l.aspect);
      j++;
    }
    D.geo.instanceCount = j;
    flush([D.aPos, D.aCol, D.aVel, D.aTex, D.aPar, D.aRim], j);
    D.mesh.visible = j > 0;
  }

  private moveParticle(from: number, to: number): void {
    const P = this.P;
    for (const k of Object.keys(P) as (keyof typeof P)[]) P[k][to] = P[k][from];
    this.pInst[to] = this.pInst[from];
    this.pInst[from] = null;
  }

  private updateRibbons(): void {
    const R = this.ribDraw;
    const cam = this.camera;
    let slot = 0;
    for (const r of this.ribbons) {
      if (!r.on) continue;
      const l = r.layer!;
      let drop = 0;
      while (drop < r.n && this.now - r.ts[drop] > l.life) drop++;
      if (drop > 0) { for (const a of [r.xs, r.ys, r.zs, r.ts, r.ds]) a.copyWithin(0, drop); r.n -= drop; }
      if (r.n === 0 && !r.inst) { r.on = false; continue; }
      if (r.n < 2 || !cam || slot >= RIB_MAX) continue;
      const base = slot * RIB_PTS * 2;
      const head = r.ds[r.n - 1];
      for (let j = 0; j < RIB_PTS; j++) {
        const jj = Math.min(j, r.n - 1);
        const x = r.xs[jj], y = r.ys[jj], z = r.zs[jj];
        const a0 = Math.max(0, jj - 1), b0 = Math.min(r.n - 1, jj + 1);
        _v.set(r.xs[b0] - r.xs[a0], r.ys[b0] - r.ys[a0], r.zs[b0] - r.zs[a0]);
        if (l.flat) _v2.set(0, 1, 0);
        else _v2.set(cam.position.x - x, cam.position.y - y, cam.position.z - z);
        _v.cross(_v2);
        if (_v.lengthSq() < 1e-8) _v.set(1, 0, 0); else _v.normalize();
        const age = Math.min(1, (this.now - r.ts[jj]) / l.life);
        const u = jj / Math.max(1, r.n - 1);
        const w = evalCurve(l.width, u) * 0.5 * (1 - age * 0.5);
        const al = Math.max(0, evalCurve(l.alpha, u)) * (1 - age) * r.opacity;
        this.grads.sample(r.slot, 1 - u, _rgb, 0);
        const e = Math.min(r.cap, l.emissive);
        const vi = base + j * 2;
        R.pos.setXYZ(vi, x + _v.x * w, y + _v.y * w, z + _v.z * w);
        R.pos.setXYZ(vi + 1, x - _v.x * w, y - _v.y * w, z - _v.z * w);
        for (const k of [vi, vi + 1]) {
          R.col.setXYZW(k, _rgb[0] * e, _rgb[1] * e, _rgb[2] * e, al);
          R.prm.setXYZW(k, l.blend, l.noise, l.scroll, l.tile);
          R.rim.setXYZW(k, r.rim.r * 1.4, r.rim.g * 1.4, r.rim.b * 1.4, l.rimAmt);
        }
        R.uv.setXYZW(vi, u, 0, head - r.ds[jj], r.seed);
        R.uv.setXYZW(vi + 1, u, 1, head - r.ds[jj], r.seed);
      }
      slot++;
    }
    R.geo.setDrawRange(0, slot * (RIB_PTS - 1) * 6);
    flush([R.pos, R.col, R.uv, R.prm, R.rim], slot * RIB_PTS * 2);
    R.mesh.visible = slot > 0;
  }

  private updateElements(d: number): void {
    // beams
    let nb = 0;
    const B = this.beamDraw;
    for (const b of this.beams) {
      if (!b.on) continue;
      const l = b.l!;
      b.age += d;
      if (b.age >= l.life) { b.on = false; b.inst = null; continue; }
      const t = b.age / l.life;
      this.grads.sample(b.slot, t, _rgb, 0);
      const e = Math.min(b.cap, l.emissive);
      const a = Math.max(0, evalCurve(l.alpha, t)) * b.opacity;
      B.aA.setXYZW(nb, b.a.x, b.a.y, b.a.z, l.width);
      B.aB.setXYZW(nb, b.b.x, b.b.y, b.b.z, l.noise);
      B.aC.setXYZW(nb, _rgb[0] * e, _rgb[1] * e, _rgb[2] * e, a);
      B.aD.setXYZW(nb, l.scroll, l.freq, b.seed, l.blend);
      B.aE.setXYZW(nb, l.core, l.taper[0], l.taper[1], t);
      nb++;
    }
    B.geo.instanceCount = nb; flush([B.aA, B.aB, B.aC, B.aD, B.aE], nb); B.mesh.visible = nb > 0;
    // rings
    let nr = 0;
    const G = this.ringDraw;
    for (const r of this.rings) {
      if (!r.on) continue;
      const l = r.l!;
      r.age += d;
      if (r.age >= l.life) { r.on = false; continue; }
      const t = r.age / l.life;
      this.grads.sample(r.slot, t, _rgb, 0);
      const e = Math.min(r.cap, Math.max(0, evalCurve(l.emissive, t)));
      G.aPos.setXYZW(nr, r.x, r.y, r.z, Math.max(0.01, evalCurve(l.radius, t) * r.s));
      G.aSty.setXYZW(nr, Math.max(0.01, evalCurve(l.width, t) * Math.max(1, Math.sqrt(r.s) * 0.8)), Math.max(0, evalCurve(l.alpha, t)) * r.opacity, l.sharp, l.noise);
      G.aCol.setXYZW(nr, _rgb[0] * e, _rgb[1] * e, _rgb[2] * e, l.blend);
      G.aMisc.setXYZW(nr, l.vertical ? 1 : 0, r.seed, l.inner, t);
      nr++;
    }
    G.geo.instanceCount = nr; flush([G.aPos, G.aSty, G.aCol, G.aMisc], nr); G.mesh.visible = nr > 0;
    // decals
    let nd = 0;
    const DD = this.decalDraw;
    for (const dc of this.decals) {
      if (!dc.on) continue;
      const l = dc.l!;
      dc.age += d;
      if (dc.age >= l.life) { dc.on = false; continue; }
      const t = dc.age / l.life;
      this.grads.sample(dc.slot, t, _rgb, 0);
      const e = Math.min(dc.cap, Math.max(0, evalCurve(l.emissive, t)));
      const rad = Math.max(0.01, (l.shape >= 3 ? Math.max(l.length * 0.5, evalCurve(l.radius, t)) : evalCurve(l.radius, t)) * dc.s);
      const param = l.shape === 2 ? l.angle : l.shape >= 3 ? Math.max(0.05, (l.width || rad * 0.3) / Math.max(1e-3, rad * 2)) : 0;
      DD.aPos.setXYZW(nd, dc.x, 0.035, dc.z, rad);
      DD.aRot.setXYZW(nd, dc.rot, l.shape, l.style, Math.max(0, evalCurve(l.alpha, t)) * dc.opacity);
      DD.aCol.setXYZW(nd, _rgb[0], _rgb[1], _rgb[2], e);
      DD.aMisc.setXYZW(nd, t, dc.seed, param, l.tex.cell + (l.tex.variants ? Math.floor(dc.seed * l.tex.frames) : 0));
      DD.aRimC.setXYZW(nd, dc.rim.r, dc.rim.g, dc.rim.b, 0.8);
      nd++;
    }
    DD.geo.instanceCount = nd; flush([DD.aPos, DD.aRot, DD.aCol, DD.aMisc, DD.aRimC], nd); DD.mesh.visible = nd > 0;
    // meshes
    for (const sd of this.shapeDraws.values()) sd.n = 0;
    const cam = this.camera;
    for (const e of this.meshEls) {
      if (!e.on) continue;
      const l = e.l!;
      if (e.inst) e.age = Math.min(e.age + d, l.life * l.hold); else e.age += d;
      if (!e.inst && e.age >= l.life) { e.on = false; continue; }
      const t = Math.min(1, e.age / l.life);
      const sd = this.shapeDraw(l.shape);
      if (sd.n >= MESH_PER_SHAPE) continue;
      e.spinA += l.spin * d;
      const sc = Math.max(0.001, evalCurve(l.scale, t) * e.s);
      if (l.align === MESH_ALIGN.camera && cam) _q.copy(cam.quaternion);
      else _q.setFromAxisAngle(_up, e.spinA).premultiply(e.q);
      _s.set(sc * l.stretch[0], sc * l.stretch[1], sc * l.stretch[2]);
      _m.compose(e.pos, _q, _s);
      sd.mesh.setMatrixAt(sd.n, _m);
      this.grads.sample(e.slot, t, _rgb, 0);
      const em = Math.min(e.cap, Math.max(0, evalCurve(l.emissive, t)));
      const legacyAdd = l.legacy && l.blend === 0 ? Math.min(e.cap, 1.6) : em;
      const a = Math.max(0, evalCurve(l.alpha, t)) * e.opacity;
      sd.aColor.setXYZW(sd.n, _rgb[0] * legacyAdd, _rgb[1] * legacyAdd, _rgb[2] * legacyAdd, a);
      const re = Math.min(e.cap, l.rimEmissive);
      sd.aRimC.setXYZW(sd.n, e.rim.r * re, e.rim.g * re, e.rim.b * re, l.rimPow);
      const ee = Math.min(e.cap, l.edgeEmissive);
      sd.aEdge.setXYZW(sd.n, e.edge.r * ee, e.edge.g * ee, e.edge.b * ee, l.edgeWidth);
      sd.aNoise.setXYZW(sd.n, l.noiseScale, l.scroll[0], l.scroll[1], l.noise);
      sd.aDiss.setXYZW(sd.n, Math.max(0, evalCurve(l.dissolve, t)), l.mask, evalCurve(l.maskParam, t), l.blend);
      sd.aMisc.setXYZW(sd.n, l.wobble, l.twist, l.angle, e.seed);
      sd.n++;
    }
    for (const sd of this.shapeDraws.values()) {
      sd.mesh.count = sd.n;
      sd.mesh.visible = sd.n > 0;
      sd.mesh.instanceMatrix.clearUpdateRanges(); sd.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, sd.n) * 16); sd.mesh.instanceMatrix.needsUpdate = true;
      flush([sd.aColor, sd.aRimC, sd.aEdge, sd.aNoise, sd.aDiss, sd.aMisc], sd.n);
    }
  }

  private shapeDraw(shape: number): { mesh: InstancedMesh; n: number; aColor: InstancedBufferAttribute; aRimC: InstancedBufferAttribute; aEdge: InstancedBufferAttribute; aNoise: InstancedBufferAttribute; aDiss: InstancedBufferAttribute; aMisc: InstancedBufferAttribute } {
    let sd = this.shapeDraws.get(shape);
    if (sd) return sd;
    const name = VFX_SHAPES[shape];
    const geo = buildShape(name);
    const aColor = mkAttr(MESH_PER_SHAPE, 4), aRimC = mkAttr(MESH_PER_SHAPE, 4), aEdge = mkAttr(MESH_PER_SHAPE, 4), aNoise = mkAttr(MESH_PER_SHAPE, 4), aDiss = mkAttr(MESH_PER_SHAPE, 4), aMisc = mkAttr(MESH_PER_SHAPE, 4);
    for (const [k, a] of Object.entries({ aColor, aRimC, aEdge, aNoise, aDiss, aMisc })) geo.setAttribute(k, a);
    const mat = material(MESH_VERT, MESH_FRAG, { uShapeKind: { value: SHAPE_KIND[name] ?? 0 } }, 2);
    const mesh = new InstancedMesh(geo, mat, MESH_PER_SHAPE);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 11;
    this.scene.add(mesh);
    sd = { mesh, n: 0, aColor, aRimC, aEdge, aNoise, aDiss, aMisc };
    this.shapeDraws.set(shape, sd);
    return sd;
  }

  // ── drawing (the post chain's VFX pass) ──────────────────────────────────────────────────────
  /** draw every VFX element into `target` (the composer's current buffer), depth-tested by hand */
  draw(renderer: WebGLRenderer, target: WebGLRenderTarget | null, depth: Texture | null): void {
    const cam = this.camera;
    if (!cam) return;
    this.textures.generate(renderer);
    vfxUniforms.uDepth.value = depth;
    vfxUniforms.uHasDepth.value = depth ? 1 : 0;
    if (target) vfxUniforms.uRes.value.set(target.width, target.height);
    else renderer.getDrawingBufferSize(vfxUniforms.uRes.value);
    vfxUniforms.uNear.value = cam.near;
    vfxUniforms.uFar.value = cam.far;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
    renderer.autoClear = prevAuto;
  }

  clear(): void {
    for (const it of this.insts) { it.active = false; this.free.push(it); }
    this.insts.length = 0;
    this.pn = 0;
    this.pInst.fill(null);
    for (const r of this.ribbons) { r.on = false; r.inst = null; r.n = 0; }
    for (const b of this.beams) { b.on = false; b.inst = null; }
    for (const r of this.rings) r.on = false;
    for (const dc of this.decals) dc.on = false;
    for (const e of this.meshEls) { e.on = false; e.inst = null; }
    for (const l of this.lights) { l.age = l.life = 1; l.light.intensity = 0; }
  }

  dispose(): void {
    this.clear();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); }
    });
    for (const l of this.lights) l.light.dispose();
    this.textures.dispose();
    this.group.removeFromParent();
  }
}
