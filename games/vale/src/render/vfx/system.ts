// VALE render — the VFX system (CONTRACT §9.5; STYLE_BIBLE "VFX"; tokens.json `vfx`).
//
// A VfxDef is { id, duration, teamTint, layers[] }; every layer type of the contract is implemented:
//   burst   CPU particles (pooled SoA, one instanced draw per blend), velocity-stretched sparks
//   trail   camera-facing ribbon that follows a projectile or a dash (one dynamic mesh per blend)
//   ring    flat expanding ground ring (instanced)
//   beam    camera-facing strip source → target (instanced)
//   flash   glow sprite (HDR, blooms) + a pooled point light (fixed count per tier: no recompiles)
//   mesh    procedural orb/blade/shard/cone/pillar/disc/spiral/crescent/spike (instanced per shape)
//   decal   ground mark circle/ring/cone/rect/line × texture (instanced)
// Anchors: origin (caster), target (hit unit), path (a followed projectile / dash), ground (area
// centre; `radius` style values scale with the area). Colours: #hex, "team" (the source's readability
// colour for THIS viewer), "element" (fighter palette primary, or the skin's vfxTint).
//
// Bible rules enforced here: emissive caps by tier T0–T4 = 0.8 · 1.5 · 3 · 6 · ≥10 (flash intensity);
// only T4 reaches white (near-white colours below T4 become Dawnglass); allies' effects at 65 %
// opacity with half the secondary particles; own T1 at 85 %; quality changes particle DENSITY only.
// Triggers come from SimEvents with catalog Present ids (projectile, hit, area, dash, cast, basic-attack
// hits from attack.present.hitVfx) plus an optional world-event map for events that carry no id.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, NormalBlending, type PerspectiveCamera, PlaneGeometry, PointLight,
  Quaternion, ShaderMaterial, type Texture, Vector3,
} from 'three';
import type { VfxDefT } from '../../contracts/catalog.ts';
import { buildVfxAtlas, textureIndex } from './textures.ts';
import { buildShape, shapeIndex, VFX_SHAPES } from './shapes.ts';

export type VfxAnchor = 'origin' | 'target' | 'path' | 'ground';
export type Tier = 0 | 1 | 2 | 3 | 4;
const TIER_CAP = [0.8, 1.5, 3, 6, 10];

type ColorRef = { k: 0; c: Color } | { k: 1 } | { k: 2 };
interface LayerBase { type: string; delay: number; at: VfxAnchor | null }
interface BurstL extends LayerBase { type: 'burst'; count: number; life: [number, number]; speed: [number, number]; spread: number; size: [number, number]; c0: ColorRef; c1: ColorRef; alpha: [number, number]; gravity: number; drag: number; add: boolean; tex: number }
interface TrailL extends LayerBase { type: 'trail'; width: number; life: number; color: ColorRef; alpha: number; tex: number; add: boolean }
interface RingL extends LayerBase { type: 'ring'; radius: [number, number]; width: number; life: number; color: ColorRef; alpha: [number, number]; add: boolean }
interface BeamL extends LayerBase { type: 'beam'; width: number; life: number; color: ColorRef; tex: number; add: boolean }
interface FlashL extends LayerBase { type: 'flash'; radius: number; life: number; color: ColorRef; intensity: number }
interface MeshL extends LayerBase { type: 'mesh'; shape: number; scale: [number, number]; life: number; color: ColorRef; alpha: [number, number]; spin: number; add: boolean }
interface DecalL extends LayerBase { type: 'decal'; shape: number; radius: number; life: number; color: ColorRef; alpha: [number, number]; tex: number }
type Layer = BurstL | TrailL | RingL | BeamL | FlashL | MeshL | DecalL;
interface Def { id: string; duration: number; teamTint: boolean; layers: Layer[]; span: number }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pair = (v: unknown, d: [number, number]): [number, number] => {
  if (Array.isArray(v) && v.length >= 2) return [num(v[0], d[0]), num(v[1], d[1])];
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v];
  return d;
};
function colorRef(v: unknown): ColorRef {
  if (v === 'team') return { k: 1 };
  if (v === 'element') return { k: 2 };
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return { k: 0, c: new Color().setStyle(v) };
  return { k: 1 };
}
const anchorOf = (v: unknown): VfxAnchor | null => (v === 'origin' || v === 'target' || v === 'path' || v === 'ground' ? v : null);
const DECAL_SHAPES = ['circle', 'ring', 'cone', 'rect', 'line'];

function parseDef(d: VfxDefT): Def {
  const layers: Layer[] = [];
  let span = d.duration;
  for (const raw of d.layers) {
    const r = raw as Record<string, unknown>;
    const base = { delay: Math.max(0, num(r.delay, 0)), at: anchorOf(r.at) };
    const add = r.blend !== 'alpha';
    let l: Layer | null = null;
    switch (r.type) {
      case 'burst': {
        const col = Array.isArray(r.color) ? r.color : [r.color, r.color];
        l = { ...base, type: 'burst', count: Math.max(0, Math.round(num(r.count, 8))), life: pair(r.life, [0.2, 0.4]), speed: pair(r.speed, [1, 2]),
          spread: num(r.spreadDeg, 60), size: pair(r.size, [0.1, 0.05]), c0: colorRef(col[0]), c1: colorRef(col[1] ?? col[0]),
          alpha: pair(r.alpha, [1, 0]), gravity: num(r.gravity, 0), drag: num(r.drag, 0), add, tex: textureIndex(r.texture ?? 'spark') };
        span = Math.max(span, base.delay + l.life[1]);
        break;
      }
      case 'trail': l = { ...base, type: 'trail', width: num(r.width, 0.2), life: num(r.life, 0.2), color: colorRef(r.color), alpha: num(Array.isArray(r.alpha) ? r.alpha[0] : r.alpha, 0.6), tex: textureIndex(r.texture ?? 'streak'), add }; break;
      case 'ring': l = { ...base, type: 'ring', radius: pair(r.radius, [0.3, 1]), width: num(r.width, 0.1), life: num(r.life, 0.3), color: colorRef(r.color), alpha: pair(r.alpha, [1, 0]), add }; break;
      case 'beam': l = { ...base, type: 'beam', width: num(r.width, 0.2), life: num(r.life, 0.2), color: colorRef(r.color), tex: textureIndex(r.texture ?? 'streak'), add }; break;
      case 'flash': l = { ...base, type: 'flash', radius: num(r.radius, 0.5), life: num(r.life, 0.06), color: colorRef(r.color), intensity: num(r.intensity, 1.5) }; break;
      case 'mesh': l = { ...base, type: 'mesh', shape: shapeIndex(r.shape), scale: pair(r.scale, [0.5, 0.5]), life: num(r.life, 0.3), color: colorRef(r.color), alpha: pair(r.alpha, [1, 0]), spin: num(r.spinDeg, 0) * Math.PI / 180, add }; break;
      case 'decal': l = { ...base, type: 'decal', shape: Math.max(0, DECAL_SHAPES.indexOf(String(r.shape ?? 'circle'))), radius: num(r.radius, 1), life: num(r.life, 0.8), color: colorRef(r.color), alpha: pair(r.alpha, [0.5, 0]), tex: textureIndex(r.texture ?? 'crack') }; break;
      default: l = null; // unknown layer types are ignored (the content build flags them)
    }
    if (l) {
      if (l.type !== 'burst') span = Math.max(span, l.delay + ('life' in l ? (l.life as number) : 0));
      layers.push(l);
    }
  }
  return { id: d.id, duration: d.duration, teamTint: d.teamTint, layers, span };
}

/** what the VFX system needs from the world (implemented by the renderer) */
export interface VfxWorld {
  /** body-centre world position of an entity (false when it is gone) */
  entityPos(id: number, out: Vector3): boolean;
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
  /** the default anchor for layers without `at` */
  anchor?: VfxAnchor;
  /** loop the def while this entity exists (zones) */
  loopWhile?: number;
}

// ── instance + element pools ───────────────────────────────────────────────────────────────────────
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
  loopWhile = -1;
  anchor: VfxAnchor = 'origin';
  fired: Uint8Array = new Uint8Array(0);
  acc: Float32Array = new Float32Array(0);
  trail: Int16Array = new Int16Array(0);
  meshEl: Int16Array = new Int16Array(0);
  active = false;
}

interface RingEl { on: boolean; x: number; y: number; z: number; age: number; life: number; r0: number; r1: number; w: number; a0: number; a1: number; c: Color; add: boolean }
interface MeshEl { on: boolean; shape: number; add: boolean; pos: Vector3; q: Quaternion; s0: number; s1: number; age: number; life: number; a0: number; a1: number; c: Color; spin: number; spinA: number; inst: Inst | null; layer: number; flat: boolean }
interface DecalEl { on: boolean; x: number; z: number; rot: number; r: number; shape: number; tex: number; age: number; life: number; a0: number; a1: number; c: Color }
interface BeamEl { on: boolean; a: Vector3; b: Vector3; w: number; age: number; life: number; c: Color; alpha: number; tex: number; add: boolean }
interface TrailEl { on: boolean; inst: Inst | null; n: number; xs: Float32Array; ys: Float32Array; zs: Float32Array; ts: Float32Array; width: number; life: number; c: Color; alpha: number; tex: number; add: boolean; lastT: number }
interface LightEl { light: PointLight; age: number; life: number; peak: number }

const P_MAX = 3000;
const TRAIL_PTS = 24;

const PARTICLE_VERT = /* glsl */`
attribute vec4 aPos;   // xyz, size
attribute vec4 aCol;   // rgb (HDR), alpha
attribute vec4 aVel;   // velocity xyz, stretch
attribute vec2 aTex;   // atlas index, rotation
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec4 mv = viewMatrix * vec4( aPos.xyz, 1.0 );
  vec2 corner = position.xy;
  float size = aPos.w;
  vec2 offs;
  if ( aVel.w > 0.0 ) {
    vec3 vv = ( viewMatrix * vec4( aVel.xyz, 0.0 ) ).xyz;
    float l = length( vv.xy );
    vec2 ax = l > 1e-4 ? vv.xy / l : vec2( 1.0, 0.0 );
    vec2 ay = vec2( -ax.y, ax.x );
    float len = size * ( 1.0 + min( l * 0.06, 2.5 ) * aVel.w );
    offs = ax * corner.x * len + ay * corner.y * size * 0.45;
  } else {
    float c = cos( aTex.y ), s = sin( aTex.y );
    offs = mat2( c, s, -s, c ) * corner * size;
  }
  mv.xy += offs;
  gl_Position = projectionMatrix * mv;
  float ti = aTex.x;
  vec2 cell = vec2( mod( ti, 4.0 ), floor( ti / 4.0 ) );
  vUv = vec2( cell.x + corner.x + 0.5, cell.y + 0.5 - corner.y ) / 4.0;
  vCol = aCol;
}`;
const TEX_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vCol.rgb * t.rgb, a );
}`;
const TRAIL_VERT = /* glsl */`
attribute vec4 aCol;
attribute vec2 aUv;
uniform float uTex;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec2 cell = vec2( mod( uTex, 4.0 ), floor( uTex / 4.0 ) );
  vUv = ( cell + vec2( 0.04 + aUv.x * 0.92, 0.3 + aUv.y * 0.4 ) ) / 4.0;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 );
}`;
const RING_VERT = /* glsl */`
attribute vec4 aPos;    // xyz, radius
attribute vec4 aStyle;  // width, alpha
attribute vec3 aCol;
varying vec2 vL; varying vec4 vS; varying vec3 vC; varying float vR;
void main() {
  float ext = aPos.w + aStyle.x * 2.0 + 0.05;
  vec3 wp = aPos.xyz + vec3( position.x * ext * 2.0, 0.0, -position.y * ext * 2.0 );
  vL = wp.xz - aPos.xz; vS = aStyle; vC = aCol; vR = aPos.w;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;
const RING_FRAG = /* glsl */`
varying vec2 vL; varying vec4 vS; varying vec3 vC; varying float vR;
void main() {
  float d = abs( length( vL ) - vR );
  float hw = vS.x * 0.5;
  float a = ( 1.0 - smoothstep( hw * 0.4, hw, d ) ) * vS.y;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vC, a );
}`;
const DECAL_VERT = /* glsl */`
attribute vec4 aPos;    // x, y, z, radius
attribute vec4 aRot;    // rotation, shape, tex, alpha
attribute vec3 aCol;
varying vec2 vL; varying vec4 vR; varying vec3 vC; varying vec2 vUv;
void main() {
  float r = aPos.w;
  vec2 q = position.xy * 2.0 * r;
  float c = cos( aRot.x ), s = sin( aRot.x );
  vec2 w = vec2( c * q.x - s * q.y, s * q.x + c * q.y );
  vec3 wp = vec3( aPos.x + w.x, aPos.y, aPos.z - w.y );
  vL = position.xy * 2.0; vR = aRot; vC = aCol;
  float ti = aRot.z;
  vec2 cell = vec2( mod( ti, 4.0 ), floor( ti / 4.0 ) );
  vUv = vec2( cell.x + position.x + 0.5, cell.y + 0.5 - position.y ) / 4.0;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;
const DECAL_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vL; varying vec4 vR; varying vec3 vC; varying vec2 vUv;
void main() {
  float shape = vR.y;
  float d = length( vL );
  float m;
  if ( shape < 0.5 ) m = 1.0 - smoothstep( 0.85, 1.0, d );
  else if ( shape < 1.5 ) m = ( 1.0 - smoothstep( 0.85, 1.0, d ) ) * smoothstep( 0.55, 0.7, d );
  else if ( shape < 2.5 ) { float an = abs( atan( vL.y, vL.x ) ); m = ( 1.0 - smoothstep( 0.85, 1.0, d ) ) * ( 1.0 - smoothstep( 0.48, 0.55, an ) ) * step( 0.0, vL.x ); }
  else if ( shape < 3.5 ) m = ( 1.0 - smoothstep( 0.9, 1.0, abs( vL.x ) ) ) * ( 1.0 - smoothstep( 0.4, 0.5, abs( vL.y ) ) );
  else m = ( 1.0 - smoothstep( 0.9, 1.0, abs( vL.x ) ) ) * ( 1.0 - smoothstep( 0.08, 0.14, abs( vL.y ) ) );
  float t = texture2D( uAtlas, vUv ).a;
  float a = m * mix( 0.35, 1.0, t ) * vR.w;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vC, a );
}`;
const BEAM_VERT = /* glsl */`
attribute vec4 aA;    // start xyz, width
attribute vec4 aB;    // end xyz, tex
attribute vec4 aCol;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec3 a = aA.xyz, b = aB.xyz;
  vec3 mid = mix( a, b, position.x + 0.5 );
  vec3 dir = normalize( b - a + 1e-5 );
  vec3 toCam = normalize( cameraPosition - mid );
  vec3 side = normalize( cross( dir, toCam ) + 1e-5 );
  vec3 wp = mid + side * position.y * aA.w;
  float ti = aB.w;
  vec2 cell = vec2( mod( ti, 4.0 ), floor( ti / 4.0 ) );
  vUv = ( cell + vec2( 0.05 + ( position.x + 0.5 ) * 0.9, 0.5 - position.y ) ) / 4.0;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;
const MESH_VERT = /* glsl */`
attribute vec4 aColor;
varying vec3 vN; varying vec3 vV; varying vec4 vC;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4( position, 1.0 );
  vec4 mv = viewMatrix * wp;
  vN = normalize( mat3( viewMatrix ) * mat3( m ) * normal );
  vV = normalize( -mv.xyz );
  vC = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const MESH_FRAG = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec4 vC;
void main() {
  float f = pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), 2.0 );
  float a = vC.a * ( 0.55 + 0.45 * f );
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vC.rgb * ( 0.7 + 0.6 * f ), a );
}`;

const DAWNGLASS = new Color().setStyle('#DCE8EE');
const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3(0, 0, 1);

function mkAttr(n: number, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
}
function flush(attrs: InstancedBufferAttribute[], count: number): void {
  for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, count) * a.itemSize); a.needsUpdate = true; }
}

export class VfxSystem {
  readonly group = new Group();
  private readonly defs = new Map<string, Def>();
  private readonly atlas: Texture;
  private readonly world: VfxWorld;
  private camera: PerspectiveCamera | null = null;
  private now = 0;
  /** tokens vfx.rules.screenParticleBudget and particle density (quality) */
  budget = 2000;
  density = 1;
  /** spectators and hidden effects are filtered by the caller; this only renders */
  private readonly insts: Inst[] = [];
  private readonly free: Inst[] = [];
  // particles (SoA)
  private pn = 0;
  private readonly P = {
    x: new Float32Array(P_MAX), y: new Float32Array(P_MAX), z: new Float32Array(P_MAX),
    vx: new Float32Array(P_MAX), vy: new Float32Array(P_MAX), vz: new Float32Array(P_MAX),
    age: new Float32Array(P_MAX), life: new Float32Array(P_MAX), s0: new Float32Array(P_MAX), s1: new Float32Array(P_MAX),
    r0: new Float32Array(P_MAX), g0: new Float32Array(P_MAX), b0: new Float32Array(P_MAX),
    r1: new Float32Array(P_MAX), g1: new Float32Array(P_MAX), b1: new Float32Array(P_MAX),
    a0: new Float32Array(P_MAX), a1: new Float32Array(P_MAX), grav: new Float32Array(P_MAX), drag: new Float32Array(P_MAX),
    tex: new Float32Array(P_MAX), rot: new Float32Array(P_MAX), rotV: new Float32Array(P_MAX), add: new Uint8Array(P_MAX), stretch: new Float32Array(P_MAX),
  };
  private readonly pMeshes: { mesh: Mesh; geo: InstancedBufferGeometry; aPos: InstancedBufferAttribute; aCol: InstancedBufferAttribute; aVel: InstancedBufferAttribute; aTex: InstancedBufferAttribute }[] = [];
  // rings
  private readonly rings: RingEl[] = [];
  private readonly ringMeshes: { mesh: Mesh; geo: InstancedBufferGeometry; aPos: InstancedBufferAttribute; aStyle: InstancedBufferAttribute; aCol: InstancedBufferAttribute }[] = [];
  // decals
  private readonly decals: DecalEl[] = [];
  private readonly decalMesh: { mesh: Mesh; geo: InstancedBufferGeometry; aPos: InstancedBufferAttribute; aRot: InstancedBufferAttribute; aCol: InstancedBufferAttribute };
  // beams
  private readonly beams: BeamEl[] = [];
  private readonly beamMeshes: { mesh: Mesh; geo: InstancedBufferGeometry; aA: InstancedBufferAttribute; aB: InstancedBufferAttribute; aCol: InstancedBufferAttribute }[] = [];
  // meshes
  private readonly meshEls: MeshEl[] = [];
  private readonly shapeMeshes = new Map<string, { mesh: InstancedMesh; aColor: InstancedBufferAttribute; n: number }>();
  // trails
  private readonly trails: TrailEl[] = [];
  private readonly trailMeshes: { mesh: Mesh; geo: BufferGeometry; pos: BufferAttribute; col: BufferAttribute; uv: BufferAttribute; mat: ShaderMaterial }[] = [];
  // lights
  private lights: LightEl[] = [];

  constructor(defs: readonly VfxDefT[], world: VfxWorld) {
    this.world = world;
    for (const d of defs) this.defs.set(d.id, parseDef(d));
    this.group.name = 'vale_vfx';
    this.atlas = buildVfxAtlas();
    const quad = new PlaneGeometry(1, 1);
    const instGeo = (): InstancedBufferGeometry => { const g = new InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position')); g.instanceCount = 0; return g; };
    // particles: [0] additive, [1] alpha
    for (const add of [true, false]) {
      const geo = instGeo();
      const aPos = mkAttr(P_MAX, 4), aCol = mkAttr(P_MAX, 4), aVel = mkAttr(P_MAX, 4), aTex = mkAttr(P_MAX, 2);
      geo.setAttribute('aPos', aPos); geo.setAttribute('aCol', aCol); geo.setAttribute('aVel', aVel); geo.setAttribute('aTex', aTex);
      const mat = new ShaderMaterial({ vertexShader: PARTICLE_VERT, fragmentShader: TEX_FRAG, uniforms: { uAtlas: { value: this.atlas } },
        transparent: true, depthWrite: false, blending: add ? AdditiveBlending : NormalBlending });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = add ? 12 : 11;
      this.group.add(mesh);
      this.pMeshes.push({ mesh, geo, aPos, aCol, aVel, aTex });
    }
    for (const add of [true, false]) {
      const geo = instGeo();
      const aPos = mkAttr(160, 4), aStyle = mkAttr(160, 4), aCol = mkAttr(160, 3);
      geo.setAttribute('aPos', aPos); geo.setAttribute('aStyle', aStyle); geo.setAttribute('aCol', aCol);
      const mat = new ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false,
        blending: add ? AdditiveBlending : NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 9;
      this.group.add(mesh);
      this.ringMeshes.push({ mesh, geo, aPos, aStyle, aCol });
    }
    {
      const geo = instGeo();
      const aPos = mkAttr(128, 4), aRot = mkAttr(128, 4), aCol = mkAttr(128, 3);
      geo.setAttribute('aPos', aPos); geo.setAttribute('aRot', aRot); geo.setAttribute('aCol', aCol);
      const mat = new ShaderMaterial({ vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, uniforms: { uAtlas: { value: this.atlas } },
        transparent: true, depthWrite: false, blending: NormalBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 8;
      this.group.add(mesh);
      this.decalMesh = { mesh, geo, aPos, aRot, aCol };
    }
    for (const add of [true, false]) {
      const geo = instGeo();
      const aA = mkAttr(48, 4), aB = mkAttr(48, 4), aCol = mkAttr(48, 4);
      geo.setAttribute('aA', aA); geo.setAttribute('aB', aB); geo.setAttribute('aCol', aCol);
      const mat = new ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: TEX_FRAG, uniforms: { uAtlas: { value: this.atlas } },
        transparent: true, depthWrite: false, blending: add ? AdditiveBlending : NormalBlending });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 12;
      this.group.add(mesh);
      this.beamMeshes.push({ mesh, geo, aA, aB, aCol });
    }
    for (const add of [true, false]) {
      const max = 96 * TRAIL_PTS * 2;
      const geo = new BufferGeometry();
      const pos = new BufferAttribute(new Float32Array(max * 3), 3); pos.setUsage(DynamicDrawUsage);
      const col = new BufferAttribute(new Float32Array(max * 4), 4); col.setUsage(DynamicDrawUsage);
      const uv = new BufferAttribute(new Float32Array(max * 2), 2); uv.setUsage(DynamicDrawUsage);
      geo.setAttribute('position', pos); geo.setAttribute('aCol', col); geo.setAttribute('aUv', uv);
      const idx: number[] = [];
      for (let t = 0; t < 96; t++) for (let k = 0; k < TRAIL_PTS - 1; k++) {
        const b = (t * TRAIL_PTS + k) * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      geo.setIndex(idx);
      geo.setDrawRange(0, 0);
      const mat = new ShaderMaterial({ vertexShader: TRAIL_VERT, fragmentShader: TEX_FRAG, uniforms: { uAtlas: { value: this.atlas }, uTex: { value: 5 } },
        transparent: true, depthWrite: false, side: 2, blending: add ? AdditiveBlending : NormalBlending });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 10;
      this.group.add(mesh);
      this.trailMeshes.push({ mesh, geo, pos, col, uv, mat });
    }
    for (let i = 0; i < 96; i++) this.trails.push({ on: false, inst: null, n: 0, xs: new Float32Array(TRAIL_PTS), ys: new Float32Array(TRAIL_PTS), zs: new Float32Array(TRAIL_PTS), ts: new Float32Array(TRAIL_PTS), width: 0.2, life: 0.2, c: new Color(), alpha: 1, tex: 5, add: true, lastT: 0 });
    for (let i = 0; i < 160; i++) this.rings.push({ on: false, x: 0, y: 0, z: 0, age: 0, life: 1, r0: 0, r1: 1, w: 0.1, a0: 1, a1: 0, c: new Color(), add: true });
    for (let i = 0; i < 128; i++) this.decals.push({ on: false, x: 0, z: 0, rot: 0, r: 1, shape: 0, tex: 10, age: 0, life: 1, a0: 1, a1: 0, c: new Color() });
    for (let i = 0; i < 48; i++) this.beams.push({ on: false, a: new Vector3(), b: new Vector3(), w: 0.2, age: 0, life: 0.2, c: new Color(), alpha: 1, tex: 5, add: true });
    for (let i = 0; i < 128; i++) this.meshEls.push({ on: false, shape: 0, add: true, pos: new Vector3(), q: new Quaternion(), s0: 1, s1: 1, age: 0, life: 1, a0: 1, a1: 0, c: new Color(), spin: 0, spinA: 0, inst: null, layer: -1, flat: false });
  }

  has(id: string | undefined | null): boolean { return !!id && this.defs.has(id); }
  setCamera(c: PerspectiveCamera): void { this.camera = c; }

  /** fixed pool of point lights for flashes (0 on Low) */
  setLightCount(n: number): void {
    for (const l of this.lights) { this.group.remove(l.light); l.light.dispose(); }
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const light = new PointLight(0xffffff, 0, 6, 2);
      light.castShadow = false;
      this.group.add(light);
      this.lights.push({ light, age: 1, life: 0, peak: 0 });
    }
  }

  get particleCount(): number { return this.pn; }
  get instanceCount(): number { return this.insts.length; }

  /** spawn a def; returns false for an unknown id */
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
    it.team.copy(def.teamTint ? o.team : o.team);
    it.element.copy(o.element ?? o.team);
    const fallback = o.ground ?? o.origin ?? o.target ?? _v.set(0, 0, 0);
    it.origin.copy(o.origin ?? fallback);
    it.target.copy(o.target ?? fallback);
    it.ground.copy(o.ground ?? fallback);
    it.ground.y = 0;
    it.scale = o.scale && o.scale > 0 ? o.scale : 1;
    it.dir = o.dir ?? 0;
    it.follow = o.follow ?? -1;
    it.following = it.follow >= 0;
    it.targetId = o.targetId ?? -1;
    it.loopWhile = o.loopWhile ?? -1;
    it.anchor = o.anchor ?? 'origin';
    if (it.following && this.world.entityPos(it.follow, it.head)) it.prevHead.copy(it.head);
    else { it.head.copy(it.origin); it.prevHead.copy(it.origin); }
    it.vel.set(0, 0, 0);
    const n = def.layers.length;
    if (it.fired.length < n) { it.fired = new Uint8Array(n); it.acc = new Float32Array(n); it.trail = new Int16Array(n); it.meshEl = new Int16Array(n); }
    it.fired.fill(0); it.acc.fill(0); it.trail.fill(-1); it.meshEl.fill(-1);
    it.active = true;
    this.insts.push(it);
    return true;
  }

  // ── colour helpers ───────────────────────────────────────────────────────────────────────────
  private resolve(ref: ColorRef, it: Inst, out: Color): Color {
    if (ref.k === 0) out.copy(ref.c);
    else if (ref.k === 1) out.copy(it.team);
    else out.copy(it.element);
    // only T4 reaches white
    if (it.tier < 4 && out.r > 0.88 && out.g > 0.88 && out.b > 0.88) out.copy(DAWNGLASS);
    return out;
  }

  private anchorPos(it: Inst, at: VfxAnchor, out: Vector3): Vector3 {
    switch (at) {
      case 'target': return out.copy(it.target);
      case 'path': return out.copy(it.head);
      case 'ground': return out.copy(it.ground);
      default: return out.copy(it.origin);
    }
  }

  // ── emitters ────────────────────────────────────────────────────────────────────────────────
  private emitParticles(it: Inst, l: BurstL, at: VfxAnchor, count: number): void {
    const P = this.P;
    const pos = this.anchorPos(it, at, _v);
    if (at === 'ground') pos.y = 0.08;
    const c0 = this.resolve(l.c0, it, _c0), c1 = this.resolve(l.c1, it, _c1);
    const spread = (Math.min(360, Math.max(0, l.spread)) * Math.PI) / 180;
    // base direction: up for ground / origin / target, against travel for path layers
    let bx = 0, by = 1, bz = 0;
    if (at === 'path' && it.vel.lengthSq() > 1e-4) { _v2.copy(it.vel).normalize().multiplyScalar(-1); bx = _v2.x; by = _v2.y * 0.5 + 0.2; bz = _v2.z; const l2 = Math.hypot(bx, by, bz); bx /= l2; by /= l2; bz /= l2; }
    const stretch = l.tex === 0 || l.tex === 5 ? 1 : 0;
    const scl = at === 'ground' ? Math.min(2.5, Math.max(1, it.scale * 0.5)) : 1;
    for (let k = 0; k < count; k++) {
      if (this.pn >= Math.min(P_MAX, this.budget)) return;
      const i = this.pn++;
      // direction within a cone of `spread` around the base direction
      const ca = Math.cos(Math.random() * spread * 0.5), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
      const ph = Math.random() * Math.PI * 2;
      // orthonormal basis around b
      let tx = 1, ty = 0, tz = 0;
      if (Math.abs(bx) > 0.9) { tx = 0; ty = 1; }
      // t = normalize(cross(b, t0)); s = cross(b, t)
      let ux = by * tz - bz * ty, uy = bz * tx - bx * tz, uz = bx * ty - by * tx;
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const wx = by * uz - bz * uy, wy = bz * ux - bx * uz, wz = bx * uy - by * ux;
      const dx = bx * ca + (ux * Math.cos(ph) + wx * Math.sin(ph)) * sa;
      const dy = by * ca + (uy * Math.cos(ph) + wy * Math.sin(ph)) * sa;
      const dz = bz * ca + (uz * Math.cos(ph) + wz * Math.sin(ph)) * sa;
      const sp = (l.speed[0] + Math.random() * (l.speed[1] - l.speed[0])) * scl;
      P.x[i] = pos.x + (at === 'ground' ? (Math.random() - 0.5) * 0.3 * it.scale : 0);
      P.y[i] = pos.y;
      P.z[i] = pos.z + (at === 'ground' ? (Math.random() - 0.5) * 0.3 * it.scale : 0);
      P.vx[i] = dx * sp; P.vy[i] = dy * sp; P.vz[i] = dz * sp;
      if (at === 'path') { P.vx[i] += it.vel.x * 0.15; P.vy[i] += it.vel.y * 0.15; P.vz[i] += it.vel.z * 0.15; }
      P.age[i] = 0;
      P.life[i] = l.life[0] + Math.random() * (l.life[1] - l.life[0]);
      P.s0[i] = l.size[0]; P.s1[i] = l.size[1];
      P.r0[i] = c0.r; P.g0[i] = c0.g; P.b0[i] = c0.b; P.r1[i] = c1.r; P.g1[i] = c1.g; P.b1[i] = c1.b;
      P.a0[i] = l.alpha[0] * it.opacity; P.a1[i] = l.alpha[1] * it.opacity;
      P.grav[i] = l.gravity; P.drag[i] = l.drag;
      P.tex[i] = l.tex; P.rot[i] = Math.random() * Math.PI * 2; P.rotV[i] = (Math.random() - 0.5) * 6;
      P.add[i] = l.add ? 1 : 0;
      P.stretch[i] = stretch;
    }
  }

  private glow(pos: Vector3, radius: number, color: Color, intensity: number, life: number, opacity: number): void {
    const P = this.P;
    if (this.pn >= Math.min(P_MAX, this.budget + 64)) return;
    const i = this.pn++;
    P.x[i] = pos.x; P.y[i] = pos.y; P.z[i] = pos.z;
    P.vx[i] = P.vy[i] = P.vz[i] = 0;
    P.age[i] = 0; P.life[i] = Math.max(0.03, life);
    P.s0[i] = radius * 2.2; P.s1[i] = radius * 2.6;
    P.r0[i] = P.r1[i] = color.r * intensity; P.g0[i] = P.g1[i] = color.g * intensity; P.b0[i] = P.b1[i] = color.b * intensity;
    P.a0[i] = opacity; P.a1[i] = 0;
    P.grav[i] = 0; P.drag[i] = 0; P.tex[i] = 1; P.rot[i] = 0; P.rotV[i] = 0; P.add[i] = 1; P.stretch[i] = 0;
  }

  private fireLayer(it: Inst, li: number, dt: number): void {
    const l = it.def.layers[li];
    const at: VfxAnchor = l.at ?? (l.type === 'trail' ? 'path' : it.anchor);
    const path = at === 'path';
    if (path && !it.following && it.fired[li]) return;
    switch (l.type) {
      case 'burst': {
        const n = Math.max(1, Math.round(l.count * it.density * (l.add ? 1 : it.secondary)));
        if (path && it.following) {
          const rate = n / Math.max(0.2, it.def.duration);
          it.acc[li] += rate * dt;
          const k = Math.floor(it.acc[li]);
          if (k > 0) { it.acc[li] -= k; this.emitParticles(it, l, at, k); }
          it.fired[li] = 1;
        } else if (!it.fired[li]) { it.fired[li] = 1; this.emitParticles(it, l, at, n); }
        break;
      }
      case 'trail': {
        if (it.fired[li]) break;
        it.fired[li] = 1;
        const t = this.trails.find((x) => !x.on);
        if (!t) break;
        t.on = true; t.inst = it; t.n = 0; t.width = l.width; t.life = Math.max(0.05, l.life);
        this.resolve(l.color, it, t.c); t.alpha = l.alpha * it.opacity; t.tex = l.tex; t.add = l.add; t.lastT = -1;
        it.trail[li] = this.trails.indexOf(t);
        this.trailPush(t, it.head);
        break;
      }
      case 'ring': {
        if (it.fired[li]) break;
        it.fired[li] = 1;
        const r = this.rings.find((x) => !x.on);
        if (!r) break;
        const p = this.anchorPos(it, at, _v);
        const s = at === 'ground' ? it.scale : 1;
        r.on = true; r.x = p.x; r.y = at === 'ground' || at === 'origin' || at === 'target' ? 0.06 : p.y; r.z = p.z;
        r.age = 0; r.life = Math.max(0.04, l.life); r.r0 = l.radius[0] * s; r.r1 = l.radius[1] * s; r.w = l.width * Math.max(1, Math.sqrt(s) * 0.8);
        r.a0 = l.alpha[0] * it.opacity; r.a1 = l.alpha[1] * it.opacity; this.resolve(l.color, it, r.c); r.add = l.add;
        break;
      }
      case 'beam': {
        if (it.fired[li]) break;
        it.fired[li] = 1;
        const b = this.beams.find((x) => !x.on);
        if (!b) break;
        b.on = true; b.a.copy(it.origin); b.b.copy(it.targetId >= 0 || it.anchor === 'target' ? it.target : it.head);
        b.w = l.width; b.age = 0; b.life = Math.max(0.04, l.life); this.resolve(l.color, it, b.c); b.alpha = it.opacity; b.tex = l.tex; b.add = l.add;
        break;
      }
      case 'flash': {
        if (it.fired[li]) break;
        it.fired[li] = 1;
        const p = this.anchorPos(it, at, _v);
        if (at === 'ground') p.y = 0.35;
        const cap = TIER_CAP[it.tier];
        const inten = it.tier >= 4 ? Math.max(cap, l.intensity) : Math.min(cap, l.intensity);
        const c = this.resolve(l.color, it, _c0);
        const rad = l.radius * (at === 'ground' ? Math.max(1, Math.sqrt(it.scale)) : 1);
        this.glow(p, rad, c, inten, l.life + 0.04, it.opacity);
        const le = this.lights.find((x) => x.age >= x.life) ?? this.lights.reduce<LightEl | null>((a, b) => (!a || b.peak < a.peak ? b : a), null);
        if (le && inten >= 1.2) {
          le.light.position.copy(p).y += 0.4;
          le.light.color.copy(c);
          le.light.distance = Math.max(2, rad * 6);
          le.age = 0; le.life = Math.max(0.06, l.life * 1.6); le.peak = inten * 4 * it.opacity;
        }
        break;
      }
      case 'mesh': {
        if (it.fired[li] && !path) break;
        if (it.fired[li] && path) {
          const ei = it.meshEl[li];
          if (ei >= 0) { const e = this.meshEls[ei]; if (e.on && e.inst === it) this.alignMesh(e, it); }
          break;
        }
        it.fired[li] = 1;
        const e = this.meshEls.find((x) => !x.on);
        if (!e) break;
        const p = this.anchorPos(it, at, _v);
        const s = at === 'ground' ? it.scale : 1;
        e.on = true; e.shape = l.shape; e.add = l.add; e.pos.copy(p); if (at === 'ground') e.pos.y = 0.02;
        e.s0 = l.scale[0] * s; e.s1 = l.scale[1] * s; e.age = 0; e.life = Math.max(0.04, l.life);
        e.a0 = l.alpha[0] * it.opacity; e.a1 = l.alpha[1] * it.opacity; this.resolve(l.color, it, e.c);
        const cap = TIER_CAP[it.tier];
        e.c.multiplyScalar(l.add ? Math.min(cap, 1.6) : 1);
        e.spin = l.spin; e.spinA = 0; e.inst = path ? it : null; e.layer = li;
        const name = VFX_SHAPES[l.shape];
        e.flat = name === 'disc' || name === 'crescent';
        _q.setFromAxisAngle(_up, Math.PI / 2 - it.dir);
        e.q.copy(_q);
        it.meshEl[li] = this.meshEls.indexOf(e);
        if (path) this.alignMesh(e, it);
        break;
      }
      case 'decal': {
        if (it.fired[li]) break;
        it.fired[li] = 1;
        if (it.tier <= 1) break; // T1: no decals
        const d = this.decals.find((x) => !x.on);
        if (!d) break;
        const p = this.anchorPos(it, at, _v);
        const s = at === 'ground' ? it.scale : 1;
        d.on = true; d.x = p.x; d.z = p.z; d.rot = it.dir + (l.shape === 0 || l.shape === 1 ? Math.random() * Math.PI * 2 : 0);
        d.r = l.radius * s; d.shape = l.shape; d.tex = l.tex; d.age = 0; d.life = Math.max(0.05, l.life);
        d.a0 = l.alpha[0] * it.opacity; d.a1 = l.alpha[1] * it.opacity; this.resolve(l.color, it, d.c);
        break;
      }
    }
  }

  private alignMesh(e: MeshEl, it: Inst): void {
    e.pos.copy(it.head);
    if (it.vel.lengthSq() > 1e-4) { _v2.copy(it.vel).normalize(); e.q.setFromUnitVectors(_fwd, _v2); }
  }

  private trailPush(t: TrailEl, p: Vector3): void {
    if (t.n > 0) {
      const j = t.n - 1;
      const d = Math.hypot(p.x - t.xs[j], p.y - t.ys[j], p.z - t.zs[j]);
      if (d < 0.12 && t.n > 1) { t.xs[j] = p.x; t.ys[j] = p.y; t.zs[j] = p.z; t.ts[j] = this.now; return; }
    }
    if (t.n >= TRAIL_PTS) {
      t.xs.copyWithin(0, 1); t.ys.copyWithin(0, 1); t.zs.copyWithin(0, 1); t.ts.copyWithin(0, 1);
      t.n = TRAIL_PTS - 1;
    }
    t.xs[t.n] = p.x; t.ys[t.n] = p.y; t.zs[t.n] = p.z; t.ts[t.n] = this.now;
    t.n++;
  }

  // ── per frame ────────────────────────────────────────────────────────────────────────────────
  update(dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    this.now += d;
    // instances
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
          // the followed body ended: path meshes fade out quickly
          for (let li = 0; li < it.def.layers.length; li++) {
            const ei = it.meshEl[li];
            if (ei >= 0) { const e = this.meshEls[ei]; if (e.inst === it) { e.inst = null; e.age = 0; e.life = 0.08; e.s1 = e.s0; e.a1 = 0; } }
          }
        }
      }
      if (it.targetId >= 0) this.world.entityPos(it.targetId, it.target);
      const layers = it.def.layers;
      for (let li = 0; li < layers.length; li++) if (it.t >= layers[li].delay) this.fireLayer(it, li, d);
      // trails follow the head
      for (let li = 0; li < layers.length; li++) {
        const ti = it.trail[li];
        if (ti >= 0 && it.following) { const t = this.trails[ti]; if (t.on && t.inst === it) this.trailPush(t, it.head); }
      }
      // looping (zones): restart while the zone exists
      if (it.loopWhile >= 0 && it.t >= it.def.duration) {
        if (this.world.entityPos(it.loopWhile, _v)) { it.t = 0; it.fired.fill(0); it.ground.set(_v.x, 0, _v.z); continue; }
        it.loopWhile = -1;
      }
      const done = !it.following && it.loopWhile < 0 && it.t >= it.def.span + 0.05;
      if (done) {
        for (let li = 0; li < layers.length; li++) {
          const ti = it.trail[li];
          if (ti >= 0 && this.trails[ti].inst === it) this.trails[ti].inst = null;
          const ei = it.meshEl[li];
          if (ei >= 0 && this.meshEls[ei].inst === it) this.meshEls[ei].inst = null;
        }
        it.active = false;
        this.insts.splice(k, 1);
        this.free.push(it);
      }
    }
    this.updateParticles(d);
    this.updateElements(d);
    this.updateTrails();
    for (const le of this.lights) {
      if (le.age >= le.life) { le.light.intensity = 0; continue; }
      le.age += d;
      const k = Math.max(0, 1 - le.age / le.life);
      le.light.intensity = le.peak * k * k;
    }
  }

  private updateParticles(d: number): void {
    const P = this.P;
    // integrate + compact
    let n = this.pn;
    for (let i = 0; i < n; i++) {
      P.age[i] += d;
      if (P.age[i] >= P.life[i]) {
        n--;
        if (i !== n) this.moveParticle(n, i);
        i--;
        continue;
      }
      const dr = Math.exp(-P.drag[i] * d);
      P.vx[i] *= dr; P.vz[i] *= dr; P.vy[i] = P.vy[i] * dr - P.grav[i] * d;
      P.x[i] += P.vx[i] * d; P.y[i] += P.vy[i] * d; P.z[i] += P.vz[i] * d;
      if (P.y[i] < 0.02) { P.y[i] = 0.02; P.vy[i] *= -0.25; P.vx[i] *= 0.6; P.vz[i] *= 0.6; }
      P.rot[i] += P.rotV[i] * d;
    }
    this.pn = n;
    // write instance buffers
    let na = 0, nb = 0;
    const A = this.pMeshes[0], B = this.pMeshes[1];
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, P.age[i] / P.life[i]);
      const dst = P.add[i] ? A : B;
      const j = P.add[i] ? na++ : nb++;
      const size = P.s0[i] + (P.s1[i] - P.s0[i]) * t;
      const a = P.a0[i] + (P.a1[i] - P.a0[i]) * t;
      dst.aPos.setXYZW(j, P.x[i], P.y[i], P.z[i], size);
      dst.aCol.setXYZW(j, P.r0[i] + (P.r1[i] - P.r0[i]) * t, P.g0[i] + (P.g1[i] - P.g0[i]) * t, P.b0[i] + (P.b1[i] - P.b0[i]) * t, a);
      dst.aVel.setXYZW(j, P.vx[i], P.vy[i], P.vz[i], P.stretch[i]);
      dst.aTex.setXY(j, P.tex[i], P.rot[i]);
    }
    A.geo.instanceCount = na; B.geo.instanceCount = nb;
    flush([A.aPos, A.aCol, A.aVel, A.aTex], na);
    flush([B.aPos, B.aCol, B.aVel, B.aTex], nb);
    A.mesh.visible = na > 0; B.mesh.visible = nb > 0;
  }

  private moveParticle(from: number, to: number): void {
    const P = this.P;
    for (const k of Object.keys(P) as (keyof typeof P)[]) P[k][to] = P[k][from];
  }

  private updateElements(d: number): void {
    // rings
    const R = this.ringMeshes;
    const cnt = [0, 0];
    for (const r of this.rings) {
      if (!r.on) continue;
      r.age += d;
      if (r.age >= r.life) { r.on = false; continue; }
      const t = r.age / r.life;
      const e = 1 - (1 - t) * (1 - t);
      const m = R[r.add ? 0 : 1];
      const j = cnt[r.add ? 0 : 1]++;
      m.aPos.setXYZW(j, r.x, r.y, r.z, r.r0 + (r.r1 - r.r0) * e);
      m.aStyle.setXYZW(j, r.w, r.a0 + (r.a1 - r.a0) * t, 0, 0);
      m.aCol.setXYZ(j, r.c.r, r.c.g, r.c.b);
    }
    for (let k = 0; k < 2; k++) { R[k].geo.instanceCount = cnt[k]; flush([R[k].aPos, R[k].aStyle, R[k].aCol], cnt[k]); R[k].mesh.visible = cnt[k] > 0; }
    // decals
    let nd = 0;
    const D = this.decalMesh;
    for (const dc of this.decals) {
      if (!dc.on) continue;
      dc.age += d;
      if (dc.age >= dc.life) { dc.on = false; continue; }
      const t = dc.age / dc.life;
      D.aPos.setXYZW(nd, dc.x, 0.035, dc.z, dc.r);
      D.aRot.setXYZW(nd, dc.rot, dc.shape, dc.tex, dc.a0 + (dc.a1 - dc.a0) * t);
      D.aCol.setXYZ(nd, dc.c.r, dc.c.g, dc.c.b);
      nd++;
    }
    D.geo.instanceCount = nd; flush([D.aPos, D.aRot, D.aCol], nd); D.mesh.visible = nd > 0;
    // beams
    const bc = [0, 0];
    for (const b of this.beams) {
      if (!b.on) continue;
      b.age += d;
      if (b.age >= b.life) { b.on = false; continue; }
      const t = b.age / b.life;
      const m = this.beamMeshes[b.add ? 0 : 1];
      const j = bc[b.add ? 0 : 1]++;
      m.aA.setXYZW(j, b.a.x, b.a.y, b.a.z, b.w * (1 - t * 0.5));
      m.aB.setXYZW(j, b.b.x, b.b.y, b.b.z, b.tex);
      m.aCol.setXYZW(j, b.c.r * 1.5, b.c.g * 1.5, b.c.b * 1.5, b.alpha * (1 - t));
    }
    for (let k = 0; k < 2; k++) { const m = this.beamMeshes[k]; m.geo.instanceCount = bc[k]; flush([m.aA, m.aB, m.aCol], bc[k]); m.mesh.visible = bc[k] > 0; }
    // meshes
    for (const sm of this.shapeMeshes.values()) sm.n = 0;
    for (const e of this.meshEls) {
      if (!e.on) continue;
      if (e.inst) { e.age = Math.min(e.age + d, e.life * 0.5); } else e.age += d;
      if (!e.inst && e.age >= e.life) { e.on = false; continue; }
      const t = Math.min(1, e.age / e.life);
      const sm = this.shapeMesh(e.shape, e.add);
      if (sm.n >= 32) continue;
      e.spinA += e.spin * d;
      const s = e.s0 + (e.s1 - e.s0) * (1 - (1 - t) * (1 - t));
      _q.setFromAxisAngle(_up, e.spinA).premultiply(e.q);
      _s.setScalar(Math.max(0.001, s));
      _m.compose(e.pos, e.inst ? e.q : _q, _s);
      sm.mesh.setMatrixAt(sm.n, _m);
      const a = e.inst ? e.a0 : e.a0 + (e.a1 - e.a0) * t;
      sm.aColor.setXYZW(sm.n, e.c.r, e.c.g, e.c.b, a);
      sm.n++;
    }
    for (const sm of this.shapeMeshes.values()) {
      sm.mesh.count = sm.n;
      sm.mesh.visible = sm.n > 0;
      sm.mesh.instanceMatrix.clearUpdateRanges(); sm.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, sm.n) * 16); sm.mesh.instanceMatrix.needsUpdate = true;
      flush([sm.aColor], sm.n);
    }
  }

  private shapeMesh(shape: number, add: boolean): { mesh: InstancedMesh; aColor: InstancedBufferAttribute; n: number } {
    const key = `${shape}:${add ? 1 : 0}`;
    let sm = this.shapeMeshes.get(key);
    if (sm) return sm;
    const geo = buildShape(VFX_SHAPES[shape]);
    const aColor = mkAttr(32, 4);
    geo.setAttribute('aColor', aColor);
    const mat = new ShaderMaterial({ vertexShader: MESH_VERT, fragmentShader: MESH_FRAG, transparent: true, depthWrite: false, side: 2,
      blending: add ? AdditiveBlending : NormalBlending });
    const mesh = new InstancedMesh(geo, mat, 32);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 12;
    this.group.add(mesh);
    sm = { mesh, aColor, n: 0 };
    this.shapeMeshes.set(key, sm);
    return sm;
  }

  private updateTrails(): void {
    const cam = this.camera;
    const counts = [0, 0];
    for (let k = 0; k < 2; k++) this.trailMeshes[k].geo.setDrawRange(0, 0);
    if (!cam) return;
    const camPos = cam.position;
    let slot = [0, 0];
    for (const t of this.trails) {
      if (!t.on) continue;
      // drop expired points from the tail
      let drop = 0;
      while (drop < t.n && this.now - t.ts[drop] > t.life) drop++;
      if (drop > 0) { t.xs.copyWithin(0, drop); t.ys.copyWithin(0, drop); t.zs.copyWithin(0, drop); t.ts.copyWithin(0, drop); t.n -= drop; }
      if (t.n === 0 && !t.inst) { t.on = false; continue; }
      if (t.n < 2) continue;
      const k = t.add ? 0 : 1;
      if (slot[k] >= 96) continue;
      const m = this.trailMeshes[k];
      m.mat.uniforms.uTex.value = t.tex;
      const base = slot[k] * TRAIL_PTS * 2;
      for (let j = 0; j < TRAIL_PTS; j++) {
        const jj = Math.min(j, t.n - 1);
        const x = t.xs[jj], y = t.ys[jj], z = t.zs[jj];
        const a = Math.max(0, jj - 1), b = Math.min(t.n - 1, jj + 1);
        _v.set(t.xs[b] - t.xs[a], t.ys[b] - t.ys[a], t.zs[b] - t.zs[a]);
        _v2.set(camPos.x - x, camPos.y - y, camPos.z - z);
        _v.cross(_v2).normalize();
        const age = Math.min(1, (this.now - t.ts[jj]) / t.life);
        const along = jj / Math.max(1, t.n - 1);
        const w = t.width * 0.5 * (0.35 + 0.65 * along) * (1 - age * 0.6);
        const al = t.alpha * (1 - age) * (0.25 + 0.75 * along);
        const vi = base + j * 2;
        m.pos.setXYZ(vi, x + _v.x * w, y + _v.y * w, z + _v.z * w);
        m.pos.setXYZ(vi + 1, x - _v.x * w, y - _v.y * w, z - _v.z * w);
        m.col.setXYZW(vi, t.c.r, t.c.g, t.c.b, al); m.col.setXYZW(vi + 1, t.c.r, t.c.g, t.c.b, al);
        m.uv.setXY(vi, along, 0); m.uv.setXY(vi + 1, along, 1);
      }
      slot[k]++;
      counts[k] = slot[k];
    }
    for (let k = 0; k < 2; k++) {
      const m = this.trailMeshes[k];
      const n = counts[k];
      m.geo.setDrawRange(0, n * (TRAIL_PTS - 1) * 6);
      for (const a of [m.pos, m.col, m.uv]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n * TRAIL_PTS * 2) * a.itemSize); a.needsUpdate = true; }
      m.mesh.visible = n > 0;
    }
    slot = [0, 0];
  }

  clear(): void {
    this.insts.length = 0;
    this.pn = 0;
    for (const r of this.rings) r.on = false;
    for (const d of this.decals) d.on = false;
    for (const b of this.beams) b.on = false;
    for (const e of this.meshEls) { e.on = false; e.inst = null; }
    for (const t of this.trails) { t.on = false; t.inst = null; t.n = 0; }
    for (const l of this.lights) { l.age = l.life = 1; l.light.intensity = 0; }
  }

  dispose(): void {
    this.clear();
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); }
    });
    for (const l of this.lights) l.light.dispose();
    this.atlas.dispose();
    this.group.removeFromParent();
  }
}

const _c0 = new Color();
const _c1 = new Color();
