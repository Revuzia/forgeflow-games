// VALE render — ambient life (r12 M14): the T0 tier of the world. Presentation only: the sim never reads any of it,
// it never sits on a lane or in a fight zone, and nothing here moves for a unit the viewer cannot see.
//
// Driven by map.art.ambient (content/maps/*.json):
//   effects   T0 `amb_*` VfxDefs (content/vfx.json) at authored points [x, y, height above the ground]. Their
//             emitter / sprite layers are parsed by vfx/defs.ts (the same keys and curves as every effect) and run
//             here as CLOSED-FORM GPU particles: a particle's position, size, colour and alpha are pure functions
//             of (its seed, the clock), so a looping effect is always "warm" (no fill-in when the camera arrives),
//             costs no CPU per particle, and a capture at a given clock is bit-exact. Every particle cycles its
//             `life`; each cycle re-hashes its spawn point inside the layer's shape (point · disc · ring · sphere ·
//             aura · line). Motion: `velocity` drift + a wander of amplitude `turbulence` built from two partials
//             at ≤ 0.5 Hz + `orbitDeg` about the emitter's axis; `size` / `alpha` / `emissive` curves and the
//             `color` gradient over life; `texture` cells from the VFX atlas (flipbooks by `fps`); `blend` add or
//             alpha (premultiplied, one draw for both). T0 law (tokens vfx.tiers.T0): emissive ≤ 0.8, ≤ 0.5 Hz
//             (lives ≥ 2 s, wander ≤ 0.5 Hz, orbit ≤ 180°/s: the content build checks the defs).
//             Density by tier: Low 0.4 · Medium 0.7 · High / Ultra 1 (a particle's index decides, so the same
//             particles stay). Off-screen emitters are culled (bounding sphere vs the frustum; the instance buffer is
//             repacked only when the visible set changes).
//   critters  rigged GLBs (art/blender/props/critters.py: clips idle / flee / settle) at seeded spots. A `flier`
//             takes off when a unit the viewer SEES comes within `flee` m (default 3) and flies an arc to another
//             perch clear of units, landing with `settle`; a `runner` scurries 2.5–4 m away from the unit and
//             settles. Idle hops and turns on a seeded clock. Off-screen critters keep their (cheap) state machine but
//             skip the mixer and are not drawn.
//   props     static vertex-coloured GLBs (art/blender/props/ambient_props.py: banners, resin lamps, bunting,
//             lanterns), instanced per model, double-sided, drawn with a slow cloth sway in the vertex shader
//             (the `_SWAY` vertex weight × `sway` metres: ≤ 0.41 Hz partials and a ripple that runs down the
//             cloth; the shadow pass runs the same motion). A prop's `fx` puts an effect at an offset on every
//             placement (a lamp's flame).
//
// Determinism: every choice (critter spots, idle timers, flee directions) comes from a seeded PRNG (map seed +
// index) and the frame's dt, every particle from its seed and the clock: captures repeat. The `ambientEffects`
// video setting turns effects and critters off (props stay: they are scenery).

import {
  AddEquation, AnimationMixer, type AnimationAction, type AnimationClip, BufferAttribute, type BufferGeometry, Color, CustomBlending, DataTexture,
  DoubleSide, DynamicDrawUsage, FloatType, Frustum, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, LoopOnce,
  LoopRepeat, type Material, Matrix4, Mesh, MeshStandardMaterial, NearestFilter, type Object3D, OneFactor, OneMinusSrcAlphaFactor,
  type PerspectiveCamera, PlaneGeometry, RGBAFormat, ShaderMaterial, Sphere, type Texture, Vector3, type WebGLProgramParametersWithUniforms,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { MapDefT, VfxDefT } from '../contracts/catalog.ts';
import { motionDepthMaterial } from './terrain_brush.ts';
import { CURVE_N, evalCurve, type Gradient } from './vfx/curves.ts';
import { type EmitterL, parseDef } from './vfx/defs.ts';
import { patchWorldMaterial, WORLD_FOG_PARS, worldUniforms } from './world_material.ts';

type ModelLoad = (ref: string) => Promise<{ gltf: { scene: Object3D; animations: AnimationClip[] }; renderable: boolean } | null>;

/** T0 caps (tokens vfx.tiers.T0) */
export const T0 = { maxEmissive: 0.8, loopHzMax: 0.5 } as const;
/** density by quality tier (count multiplier; critters use the same share) */
export const AMBIENT_DENSITY: Readonly<Record<string, number>> = { low: 0.4, medium: 0.7, high: 1, ultra: 1 };
const FLEE_M = 3;

// ── content (defensive: art is data) ─────────────────────────────────────────────────────────────
interface EffectSpec { vfx: string; at: [number, number, number][]; scale: number }
interface CritterSpec { id: string; model: string; kind: 'flier' | 'runner' | 'circler'; scale: number; count: number; flee: number; height: number; spots: [number, number, number][] }
interface PropSpec { model: string; at: [number, number, number][]; scale: number; value: number; sway: number; fx: { vfx: string; offset: [number, number, number] } | null }
interface AmbientSpec { seed: number; effects: EffectSpec[]; critters: CritterSpec[]; props: PropSpec[] }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pts = (v: unknown, n: number): number[][] => (Array.isArray(v) ? v.filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && p.every((x) => typeof x === 'number')).map((p) => Array.from({ length: n }, (_, i) => p[i] ?? 0)) : []);

export function ambientSpec(map: MapDefT): AmbientSpec {
  const a = ((map.art as Record<string, unknown>).ambient ?? {}) as Record<string, unknown>;
  const list = (k: string): Record<string, unknown>[] => (Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  return {
    seed: Math.round(num(a.seed, 1)),
    effects: list('effects').filter((e) => typeof e.vfx === 'string').map((e) => ({ vfx: e.vfx as string, at: pts(e.at, 3) as [number, number, number][], scale: num(e.scale, 1) })),
    critters: list('critters').filter((c) => typeof c.model === 'string' && typeof c.id === 'string').map((c) => ({
      id: c.id as string, model: c.model as string, kind: c.kind === 'runner' ? 'runner' : c.kind === 'circler' ? 'circler' : 'flier', scale: num(c.scale, 1),
      count: Math.max(0, Math.round(num(c.count, 1))), flee: num(c.flee, FLEE_M), height: num(c.height, 0), spots: pts(c.spots, 3).map((p) => [p[0], p[1], p[2] || 1.5]) as [number, number, number][],
    })),
    props: list('props').filter((p) => typeof p.model === 'string').map((p) => {
      const fx = (p.fx && typeof p.fx === 'object' ? p.fx : null) as Record<string, unknown> | null;
      const off = fx ? pts([fx.offset], 3)[0] : null;
      return {
        model: p.model as string, at: pts(p.at, 3) as [number, number, number][], scale: num(p.scale, 1), value: num(p.value, 1), sway: num(p.sway, 0),
        fx: fx && typeof fx.vfx === 'string' && off ? { vfx: fx.vfx, offset: off as [number, number, number] } : null,
      };
    }),
  };
}

/** mulberry32: the presentation PRNG (seeded; never the sim's) */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── closed-form particles ────────────────────────────────────────────────────────────────────────
/** per-layer data texture: 8 parameter texels, then CURVE_N (size, alpha, emissive) and CURVE_N colour texels */
const PCOL = 8;
const ROW_W = PCOL + CURVE_N * 2;

const PARTICLE_VERT = /* glsl */`
uniform sampler2D uLayers;
uniform float uAmbT;
uniform float uGrid;
attribute vec4 aA;   // anchor x, y, z, seed
attribute vec4 aB;   // layer row, anchor yaw, scale, -
varying vec2 vUv; varying vec4 vCol; varying float vMode; varying vec3 vWorld;
vec4 L( int c ) { return texelFetch( uLayers, ivec2( c, int( aB.x + 0.5 ) ), 0 ); }
float H( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
vec2 cellUv( float c, vec2 local ) { vec2 cell = vec2( mod( c, uGrid ), floor( c / uGrid ) ); return ( cell + 0.006 + local * 0.988 ) / uGrid; }
void main() {
  vec4 p0 = L( 0 ), p1 = L( 1 ), p2 = L( 2 ), p3 = L( 3 ), p4 = L( 4 ), p5 = L( 5 ), p6 = L( 6 );
  float seed = aA.w;
  float sc = aB.z;
  float life = mix( p0.x, p0.y, H( seed * 3.17 ) );
  float x = uAmbT / life + H( seed * 5.71 );
  float cyc = floor( x ), ph = fract( x );
  float s2 = seed * 1.618 + cyc * 7.31;
  float age = ph * life;
  // the spawn point in the layer's shape (re-hashed every cycle)
  float r1 = H( s2 + 0.11 ), r2 = H( s2 + 0.37 ), r3 = H( s2 + 0.73 );
  float shape = p0.w;
  float R = p1.x * sc, Ri = p1.y * sc, Hh = p1.z * sc, Ln = p1.w * sc;
  vec3 off = vec3( 0.0 );
  float ang = r1 * 6.2831853;
  if ( shape > 0.5 && shape < 1.5 ) {                       // sphere
    float u = r2 * 2.0 - 1.0; float rr = sqrt( max( 0.0, 1.0 - u * u ) );
    off = vec3( rr * cos( ang ), u, rr * sin( ang ) ) * R * pow( r3, 0.3333 );
  } else if ( shape > 1.5 && shape < 2.5 ) {                // ring
    off = vec3( cos( ang ), 0.0, sin( ang ) ) * R;
  } else if ( shape > 2.5 && shape < 3.5 ) {                // disc
    off = vec3( cos( ang ), 0.0, sin( ang ) ) * mix( Ri, R, sqrt( r2 ) );
  } else if ( shape > 4.5 && shape < 5.5 ) {                // line (along the anchor's yaw)
    float yw = aB.y;
    off = vec3( cos( yw ), 0.0, sin( yw ) ) * ( r2 - 0.5 ) * Ln + vec3( -sin( yw ), 0.0, cos( yw ) ) * ( r3 - 0.5 ) * R;
  } else if ( shape > 6.5 ) {                                // aura: a column of radius R, height H
    off = vec3( cos( ang ), 0.0, sin( ang ) ) * R * sqrt( r2 );
  }
  if ( Hh > 0.0 ) off.y += r3 * Hh;
  // motion: drift, a slow wander (two partials, <= 0.5 Hz), an orbit about the anchor's axis
  vec3 pos = off + p2.xyz * age * sc;
  float w = p2.w * sc;
  float f1 = 0.13 + 0.12 * H( s2 + 1.9 ), f2 = 0.27 + 0.2 * H( s2 + 2.3 );
  float q1 = H( s2 + 3.1 ) * 6.2831853, q2 = H( s2 + 4.7 ) * 6.2831853;
  pos += w * vec3( sin( 6.2831853 * f1 * uAmbT + q1 ) + 0.5 * sin( 6.2831853 * f2 * uAmbT + q2 ),
                   0.45 * sin( 6.2831853 * f2 * uAmbT + q1 * 1.7 ),
                   cos( 6.2831853 * f1 * uAmbT + q2 ) + 0.5 * cos( 6.2831853 * f2 * uAmbT + q1 ) );
  float orb = p3.x * age;
  if ( abs( orb ) > 0.0 ) { float c = cos( orb ), s = sin( orb ); pos.xz = mat2( c, s, -s, c ) * pos.xz; }
  pos += aA.xyz;
  vWorld = pos;
  // curves over life
  float tc = ph * float( ${CURVE_N - 1} );
  int i0 = int( floor( tc ) ); int i1 = min( i0 + 1, ${CURVE_N - 1} ); float fr = fract( tc );
  vec4 cv = mix( L( ${PCOL} + i0 ), L( ${PCOL} + i1 ), fr );
  vec4 cc = mix( L( ${PCOL + CURVE_N} + i0 ), L( ${PCOL} + ${CURVE_N} + i1 ), fr );
  float size = cv.x * mix( p4.x, p4.y, H( s2 + 5.3 ) ) * sc;
  float e = min( cv.z, p6.y );
  vCol = vec4( cc.rgb * e, max( 0.0, cv.y ) );
  vMode = p6.x;
  float rot = mix( p4.z, p4.w, H( s2 + 6.1 ) ) + mix( p3.y, p3.z, H( s2 + 6.9 ) ) * age;
  vec2 corner = position.xy;
  float c = cos( rot ), s = sin( rot );
  vec2 q = mat2( c, s, -s, c ) * corner * size;
  vec4 mv;
  if ( p3.w > 1.5 ) mv = viewMatrix * vec4( pos + vec3( q.x, 0.0, -q.y ), 1.0 );   // flat on the ground
  else { mv = viewMatrix * vec4( pos, 1.0 ); mv.xy += q; }
  gl_Position = size > 0.0 && vCol.a > 0.002 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
  // flipbook (fps > 0: by age; else over life) or a variant picked per cycle
  float cell = p5.x;
  if ( p5.y > 1.5 ) {
    if ( p5.w > 0.5 ) cell += floor( H( s2 + 7.7 ) * p5.y );
    else cell += min( p5.y - 1.0, floor( p5.z > 0.0 ? mod( age * p5.z, p5.y ) : ph * ( p5.y - 1.0 ) ) );
  }
  vUv = cellUv( cell, corner + 0.5 );
}`;

const PARTICLE_FRAG = /* glsl */`
uniform sampler2D uAtlas;
${WORLD_FOG_PARS}
varying vec2 vUv; varying vec4 vCol; varying float vMode; varying vec3 vWorld;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.002 ) discard;
  // the world's fog of war dims the ambient like the ground under it (value x0.55 display = x0.268 linear); below the
  // ground (a gorge) it thins into the drop's own mist (~0.06 / m, the gorge's density)
  float vis = mix( 0.268, 1.0, valeVision( vWorld.xz ) ) * exp( 0.06 * min( vWorld.y + 1.0, 0.0 ) );
  if ( vMode < 0.5 ) gl_FragColor = vec4( vCol.rgb * ( 0.3 + 0.7 * t.r ) * a * vis, 0.0 );
  else gl_FragColor = vec4( vCol.rgb * ( 0.72 + 0.28 * t.r ) * a * vis, a );
}`;

interface Emitter { row: number; x: number; y: number; z: number; yaw: number; scale: number; count: number; reach: number; first: number; def: string }

class AmbientParticles {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly aA: InstancedBufferAttribute;
  private readonly aB: InstancedBufferAttribute;
  private readonly layers: DataTexture;
  readonly emitters: readonly Emitter[];
  private readonly master: { a: Float32Array; b: Float32Array };
  private visKey = '';
  density = 1;
  /** particles drawn last repack, and per def on screen */
  drawn = 0;
  readonly onScreen = new Map<string, number>();
  readonly uniforms: Record<string, { value: unknown }>;

  constructor(rows: EmitterL[], emitters: Emitter[], atlas: Texture | null, grid: number) {
    this.emitters = emitters;
    // the layer table
    const data = new Float32Array(ROW_W * Math.max(1, rows.length) * 4);
    rows.forEach((l, r) => {
      const o = r * ROW_W * 4;
      const set = (c: number, a: number, b: number, cc: number, d: number): void => { data.set([a, b, cc, d], o + c * 4); };
      const life0 = Math.max(2, l.life[0]), life1 = Math.max(life0, l.life[1]);
      set(0, life0, life1, l.count, l.shape);
      set(1, l.radius, l.radiusInner, l.height, l.length);
      set(2, l.velocity[0], l.velocity[1], l.velocity[2], l.turb);
      const lim = (v: number): number => Math.max(-Math.PI, Math.min(Math.PI, v));     // ≤ 0.5 turns per second
      set(3, lim(l.orbit), lim(l.spin[0]), lim(l.spin[1]), l.align);
      set(4, l.sizeVar[0], l.sizeVar[1], l.rot[0], l.rot[1]);
      set(5, l.tex.cell, l.tex.frames, l.fps, l.tex.variants ? 1 : 0);
      set(6, l.blend === 0 ? 0 : 1, T0.maxEmissive, 0, 0);
      for (let i = 0; i < CURVE_N; i++) {
        const t = i / (CURVE_N - 1);
        set(PCOL + i, evalCurve(l.size, t), evalCurve(l.alpha, t), evalCurve(l.emissive, t), 0);
        const c = gradientAt(l.color, t);
        set(PCOL + CURVE_N + i, c.r, c.g, c.b, 1);
      }
    });
    this.layers = new DataTexture(data, ROW_W, Math.max(1, rows.length), RGBAFormat, FloatType);
    this.layers.minFilter = this.layers.magFilter = NearestFilter;
    this.layers.needsUpdate = true;
    // master instance data: every emitter's particles at full density, contiguous
    let total = 0;
    for (const e of emitters) { e.first = total; total += e.count; }
    const a = new Float32Array(total * 4), b = new Float32Array(total * 4);
    for (const e of emitters) {
      for (let i = 0; i < e.count; i++) {
        const k = (e.first + i) * 4;
        // the seed: the emitter's position and the particle's index (stable across reloads and repacks)
        const seed = ((e.x * 7.13 + e.z * 3.71 + e.y * 1.37) % 97) + i * 1.618 + e.row * 0.37;
        a.set([e.x, e.y, e.z, seed], k);
        b.set([e.row, e.yaw, e.scale, 0], k);
      }
    }
    this.master = { a, b };
    const quad = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.aA = new InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 4), 4);
    this.aB = new InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 4), 4);
    this.aA.setUsage(DynamicDrawUsage); this.aB.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('aA', this.aA);
    this.geo.setAttribute('aB', this.aB);
    this.geo.instanceCount = 0;
    this.uniforms = {
      uLayers: { value: this.layers }, uAmbT: { value: 0 }, uAtlas: { value: atlas }, uGrid: { value: grid },
      ...worldUniforms,
    };
    const mat = new ShaderMaterial({
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true, side: DoubleSide,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.name = 'vale_ambient_particles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** cull emitters against the frustum; repack the instance buffer when the visible set changed */
  update(time: number, frustum: Frustum | null): void {
    this.uniforms.uAmbT.value = time;
    let key = '';
    const vis: Emitter[] = [];
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      _sphere.center.set(e.x, e.y, e.z); _sphere.radius = e.reach;
      if (frustum && !frustum.intersectsSphere(_sphere)) continue;
      vis.push(e);
      key += i.toString(36) + ',';
    }
    key += this.density;
    if (key === this.visKey) return;
    this.visKey = key;
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array;
    let n = 0;
    this.onScreen.clear();
    for (const e of vis) {
      const k = Math.max(1, Math.round(e.count * this.density));
      A.set(this.master.a.subarray(e.first * 4, (e.first + k) * 4), n * 4);
      B.set(this.master.b.subarray(e.first * 4, (e.first + k) * 4), n * 4);
      n += k;
      this.onScreen.set(e.def, (this.onScreen.get(e.def) ?? 0) + k);
    }
    this.geo.instanceCount = n;
    this.drawn = n;
    this.aA.clearUpdateRanges(); this.aB.clearUpdateRanges();
    this.aA.addUpdateRange(0, n * 4); this.aB.addUpdateRange(0, n * 4);
    this.aA.needsUpdate = true; this.aB.needsUpdate = true;
    this.mesh.visible = n > 0;
  }

  /** force a repack (density or visibility changed outside update) */
  invalidate(): void { this.visKey = ''; }

  dispose(): void {
    this.geo.dispose(); this.layers.dispose(); (this.mesh.material as Material).dispose();
  }
}

const _c = new Color();
function gradientAt(g: Gradient, t: number): Color {
  // T0 colours are literal hex (no team / element refs); a ref resolves to a neutral chalk
  const col = (i: number): Color => { const r = g.c[i]; return r && r.k === 0 ? r.c : _chalk; };
  if (!g.t.length) return _c.copy(_chalk);
  if (t <= g.t[0]) return _c.copy(col(0));
  for (let i = 1; i < g.t.length; i++) {
    if (t <= g.t[i]) { const u = (t - g.t[i - 1]) / Math.max(1e-6, g.t[i] - g.t[i - 1]); return _c.copy(col(i - 1)).lerp(col(i), u); }
  }
  return _c.copy(col(g.t.length - 1));
}
const _chalk = new Color(0.5, 0.48, 0.44);
const _sphere = new Sphere();

// ── critters ─────────────────────────────────────────────────────────────────────────────────────
type CState = 'idle' | 'flee' | 'settle';
interface Threat { x: number; y: number; r: number }

class Critter {
  readonly root: Object3D;
  readonly mixer: AnimationMixer;
  readonly act: Partial<Record<'idle' | 'flee' | 'settle', AnimationAction>>;
  readonly spec: CritterSpec;
  private readonly rnd: () => number;
  private readonly groundAt: (x: number, y: number) => number;
  x: number; y: number; h: number; heading: number;
  state: CState = 'idle';
  private cur: AnimationAction | null = null;
  private nextIdle: number;
  // a move (flight / scurry / hop / turn): from → to over dur
  private mv: { x0: number; y0: number; h0: number; x1: number; y1: number; h1: number; arc: number; t: number; dur: number; kind: 'fly' | 'run' | 'hop' | 'turn'; yaw0: number; yaw1: number } | null = null;
  private settleT = 0;
  flights = 0;
  // a circler's own clock and its circle (centre, radius, angular speed, phase)
  private clock = 0;
  private circ: { cx: number; cy: number; r: number; w: number; ph: number } | null = null;

  constructor(spec: CritterSpec, scene: Object3D, clips: AnimationClip[], rnd: () => number, groundAt: (x: number, y: number) => number, at: [number, number]) {
    this.spec = spec;
    this.rnd = rnd;
    this.groundAt = groundAt;
    this.root = cloneSkinned(scene);
    this.root.scale.setScalar(spec.scale);
    this.root.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.mixer = new AnimationMixer(this.root);
    this.act = {};
    for (const name of ['idle', 'flee', 'settle'] as const) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (name === 'settle') { a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(LoopRepeat, Infinity);
      this.act[name] = a;
    }
    this.x = at[0]; this.y = at[1];
    this.h = groundAt(this.x, this.y);
    this.heading = rnd() * Math.PI * 2;
    this.nextIdle = 1 + rnd() * 3;
    this.root.rotation.order = 'YXZ';
    if (spec.kind === 'circler') {
      // wheel round the spot nearest the start: ~3.6 m/s, either way round, a phase of its own
      const s = spec.spots.reduce((b, q) => (Math.hypot(q[0] - at[0], q[1] - at[1]) < Math.hypot(b[0] - at[0], b[1] - at[1]) ? q : b), spec.spots[0]);
      const r = Math.max(2, s[2] * (0.6 + 0.4 * rnd()));
      this.circ = { cx: s[0], cy: s[1], r, w: (3.6 / r) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * Math.PI * 2 };
      this.clock = rnd() * 20;
      this.state = 'flee';
      this.play('flee', 0);
    } else {
      this.play('idle', 0);
      const idle = this.act.idle;
      if (idle) idle.time = rnd() * idle.getClip().duration;
    }
    this.place();
  }

  /** a circler: a slow wheel at its height, beats for ~1.2 s then glides ~2.3 s (wings held level), banking in */
  private wheel(dt: number, animate: boolean): void {
    const c = this.circ!;
    this.clock += dt;
    const a = c.ph + c.w * this.clock;
    this.x = c.cx + Math.cos(a) * c.r; this.y = c.cy + Math.sin(a) * c.r;
    this.h = this.groundAt(c.cx, c.cy) + this.spec.height + 0.7 * Math.sin(0.21 * this.clock + c.ph);
    // the tangent (three: heading = atan2(dx, dz))
    const dx = -Math.sin(a) * c.w, dz = Math.cos(a) * c.w;
    this.heading = Math.atan2(dx, dz);
    this.place();
    this.root.rotation.z = Math.sign(c.w) * 0.32;
    const flee = this.act.flee;
    if (flee) {
      const cyc = (this.clock + c.ph) % 3.5;
      // glide: hold the beat where the wings pass level (phase ~0.27), else beat
      if (cyc > 1.2) { flee.timeScale = 0; flee.time = 0.27 * flee.getClip().duration; } else flee.timeScale = 1;
    }
    if (animate) this.mixer.update(dt);
  }

  private play(name: 'idle' | 'flee' | 'settle', fade: number): void {
    const a = this.act[name];
    if (!a || a === this.cur) return;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.cur && fade > 0) a.crossFadeFrom(this.cur, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = a;
  }

  private place(): void {
    this.root.position.set(this.x, this.h, this.y);
    this.root.rotation.y = this.heading;
  }

  /** nearest visible unit within the flee radius (or null) */
  private threat(threats: readonly Threat[]): Threat | null {
    let best: Threat | null = null, bd = Infinity;
    for (const t of threats) {
      const d = Math.hypot(t.x - this.x, t.y - this.y) - t.r;
      if (d < this.spec.flee && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  private clearOf(x: number, y: number, threats: readonly Threat[], m: number): boolean {
    for (const t of threats) if (Math.hypot(t.x - x, t.y - y) < m + t.r) return false;
    return true;
  }

  private startFlight(threats: readonly Threat[], from: Threat): void {
    const S = this.spec.spots;
    // another perch 7-26 m off, clear of every unit; the seeded order decides among the candidates
    let pick: [number, number] | null = null;
    for (let n = 0; n < 16 && !pick; n++) {
      const s = S[Math.floor(this.rnd() * S.length)];
      const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * s[2];
      const x = s[0] + Math.cos(a) * r, y = s[1] + Math.sin(a) * r;
      const d = Math.hypot(x - this.x, y - this.y);
      if (d < 7 || d > 26) continue;
      if (!this.clearOf(x, y, threats, this.spec.flee + 2)) continue;
      pick = [x, y];
    }
    if (!pick) {                                  // nowhere clear: away from the unit, 9 m
      const a = Math.atan2(this.y - from.y, this.x - from.x) + (this.rnd() - 0.5) * 0.8;
      pick = [this.x + Math.cos(a) * 9, this.y + Math.sin(a) * 9];
    }
    const d = Math.hypot(pick[0] - this.x, pick[1] - this.y);
    const h1 = this.groundAt(pick[0], pick[1]);
    this.mv = {
      // the arc clears a cliff block and its crowns on the way (blocks ~3 m, crowns ~4 m over the lip)
      x0: this.x, y0: this.y, h0: this.h, x1: pick[0], y1: pick[1], h1, arc: Math.min(8, Math.max(5, d * 0.3)),
      t: 0, dur: Math.max(1.3, d / 6.5), kind: 'fly', yaw0: this.heading, yaw1: Math.atan2(pick[0] - this.x, pick[1] - this.y),
    };
    this.state = 'flee';
    this.flights++;
    this.play('flee', 0.08);
  }

  private startRun(threats: readonly Threat[], from: Threat): void {
    const away = Math.atan2(this.y - from.y, this.x - from.x);
    const h0 = this.h;
    let pick: [number, number] | null = null;
    for (let n = 0; n < 10 && !pick; n++) {
      const a = away + (this.rnd() - 0.5) * 1.4;
      const d = 2.5 + this.rnd() * 1.5;
      const x = this.x + Math.cos(a) * d, y = this.y + Math.sin(a) * d;
      if (Math.abs(this.groundAt(x, y) - h0) > 0.05) continue;          // stays on its own level (no wall climbs)
      // and near its home spots (never out onto a lane)
      if (!this.spec.spots.some((s) => Math.hypot(x - s[0], y - s[1]) < s[2] * 1.6 + 1)) continue;
      pick = [x, y];
    }
    if (!pick) pick = [this.x + Math.cos(away) * 1.5, this.y + Math.sin(away) * 1.5];
    const d = Math.hypot(pick[0] - this.x, pick[1] - this.y);
    this.mv = { x0: this.x, y0: this.y, h0, x1: pick[0], y1: pick[1], h1: h0, arc: 0, t: 0, dur: Math.max(0.45, d / 3.4), kind: 'run', yaw0: this.heading, yaw1: Math.atan2(pick[0] - this.x, pick[1] - this.y) };
    this.state = 'flee';
    this.flights++;
    this.play('flee', 0.06);
  }

  update(dt: number, threats: readonly Threat[], animate: boolean): void {
    if (this.circ) { this.wheel(dt, animate); return; }
    const fl = this.spec.kind === 'flier';
    if (this.state !== 'flee') {
      const th = this.threat(threats);
      if (th) { if (fl) this.startFlight(threats, th); else this.startRun(threats, th); }
    }
    const m = this.mv;
    if (m) {
      m.t += dt;
      const u = Math.min(1, m.t / m.dur);
      if (m.kind === 'fly') {
        // a steep climb out, a long glide, a braking drop onto the perch
        const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        const ue = 0.15 * u + 0.85 * e;
        this.x = m.x0 + (m.x1 - m.x0) * ue; this.y = m.y0 + (m.y1 - m.y0) * ue;
        this.h = m.h0 + (m.h1 - m.h0) * ue + m.arc * Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.8;
        this.heading = turnTo(this.heading, m.yaw1, dt * 9);
        if (u > 0.82 && this.state === 'flee') { this.state = 'settle'; this.settleT = 0; this.play('settle', 0.12); }
      } else if (m.kind === 'run') {
        const e = 1 - (1 - u) * (1 - u);
        this.x = m.x0 + (m.x1 - m.x0) * e; this.y = m.y0 + (m.y1 - m.y0) * e;
        this.heading = turnTo(this.heading, m.yaw1, dt * 14);
        if (u >= 1 && this.state === 'flee') { this.state = 'settle'; this.settleT = 0; this.play('settle', 0.1); }
      } else if (m.kind === 'hop') {
        this.x = m.x0 + (m.x1 - m.x0) * u; this.y = m.y0 + (m.y1 - m.y0) * u;
        this.h = m.h0 + m.arc * Math.sin(Math.PI * u);
      } else {
        this.heading = m.yaw0 + (m.yaw1 - m.yaw0) * (u * u * (3 - 2 * u));
      }
      if (u >= 1) { if (m.kind === 'fly' || m.kind === 'hop') this.h = m.h1; this.mv = null; }
    }
    if (this.state === 'settle') {
      this.settleT += dt;
      const d = this.act.settle?.getClip().duration ?? 0.8;
      if (!this.mv && this.settleT >= d) { this.state = 'idle'; this.play('idle', 0.15); this.nextIdle = 1 + this.rnd() * 3; }
    } else if (this.state === 'idle' && !this.mv) {
      this.nextIdle -= dt;
      if (this.nextIdle <= 0) {
        this.nextIdle = 1.5 + this.rnd() * 3.5;
        const r = this.rnd();
        if (fl && r < 0.55) {
          // a short hop
          const a = this.heading + (this.rnd() - 0.5) * 1.2;
          const d = 0.12 + this.rnd() * 0.16;
          const x = this.x + Math.sin(a) * d, y = this.y + Math.cos(a) * d;
          if (Math.abs(this.groundAt(x, y) - this.h) < 0.05) this.mv = { x0: this.x, y0: this.y, h0: this.h, x1: x, y1: y, h1: this.h, arc: 0.05, t: 0, dur: 0.2, kind: 'hop', yaw0: this.heading, yaw1: this.heading };
        } else {
          const turn = (this.rnd() - 0.5) * (fl ? 2.0 : 1.2);
          this.mv = { x0: this.x, y0: this.y, h0: this.h, x1: this.x, y1: this.y, h1: this.h, arc: 0, t: 0, dur: fl ? 0.25 : 0.5, kind: 'turn', yaw0: this.heading, yaw1: this.heading + turn };
        }
      }
    }
    this.place();
    if (animate) this.mixer.update(dt);
  }

  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

// ── props: cloth sway ────────────────────────────────────────────────────────────────────────────
/** the cloth sway's constants (≤ 0.5 Hz, tokens vfx.tiers.T0): two partials, the free edge lags the attached one */
export const CLOTH = { hz: [0.23, 0.41] as const, w: [0.75, 0.25] as const, lag: 2.1, across: 0.3 } as const;
const f = (x: number): string => x.toFixed(4);
const CLOTH_PARS = /* glsl */`
attribute float _sway;
uniform float uAmbT;
uniform float uSwayAmp;`;
const CLOTH_MAIN = /* glsl */`
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float ph = 6.2831853 * fract( sin( dot( ip.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  float w = _sway;
  float t = uAmbT * 6.2831853;
  float a = ${f(CLOTH.w[0])} * sin( ${f(CLOTH.hz[0])} * t + ph - ${f(CLOTH.lag)} * w ) + ${f(CLOTH.w[1])} * sin( ${f(CLOTH.hz[1])} * t + ph * 1.7 - ${f(CLOTH.lag * 1.6)} * w );
  float b = sin( ${f(CLOTH.hz[1])} * t + ph * 2.3 - ${f(CLOTH.lag)} * w );
  float amp = uSwayAmp * w;
  // the cloth swings out of its plane (local z), a little across it, and lifts as it swings
  transformed += vec3( ${f(CLOTH.across)} * b * amp, -0.35 * a * a * amp * w, a * amp );
}
#endif`;

function clothMaterial(amp: number, value: number): { mat: MeshStandardMaterial; depth: Material | null } {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: DoubleSide });
  mat.color.setScalar(value);
  const u = { uAmbT: worldUniforms.valeTime, uSwayAmp: { value: amp } };
  if (amp > 0) {
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${CLOTH_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CLOTH_MAIN}`);
    };
    mat.customProgramCacheKey = () => 'vale_amb_cloth_v1';
  }
  patchWorldMaterial(mat);
  return { mat, depth: amp > 0 ? motionDepthMaterial(CLOTH_PARS, CLOTH_MAIN, u, 'vale_amb_cloth_depth_v1') : null };
}

// ── the layer ────────────────────────────────────────────────────────────────────────────────────
export interface AmbientStats {
  on: boolean; density: number; ms: number; emitters: number; particles: number; onScreen: Record<string, number>;
  critters: number; crittersDrawn: number; flights: number; props: number;
}

export class AmbientLayer {
  readonly group = new Group();
  private readonly spec: AmbientSpec;
  private particles: AmbientParticles | null = null;
  private readonly critters: Critter[] = [];
  private readonly propMeshes: InstancedMesh[] = [];
  private readonly propMats: Material[] = [];
  private on = true;
  private density = 1;
  private ms = 0;
  private readonly frustum = new Frustum();
  private readonly m4 = new Matrix4();
  private disposed = false;
  private crittersDrawn = 0;
  /** called with each part as it lands (critters, props, the particles): the renderer warms its programs */
  onPart: ((o: Object3D) => void) | null = null;

  constructor(map: MapDefT, defs: readonly VfxDefT[], atlas: Texture | null, grid: number, load: ModelLoad, groundAt: (x: number, y: number) => number) {
    this.group.name = 'vale_ambient';
    this.spec = ambientSpec(map);
    const byId = new Map(defs.map((d) => [d.id, d]));
    // effects: authored points + every prop placement's fx
    const pointsByDef = new Map<string, { x: number; y: number; z: number; yaw: number; scale: number }[]>();
    const push = (id: string, x: number, y: number, z: number, yaw: number, scale: number): void => {
      if (!byId.has(id)) return;
      const l = pointsByDef.get(id) ?? [];
      l.push({ x, y, z, yaw, scale });
      pointsByDef.set(id, l);
    };
    for (const e of this.spec.effects) for (const [x, y, h] of e.at) push(e.vfx, x, groundAt(x, y) + h, y, 0, e.scale);
    for (const p of this.spec.props) {
      if (!p.fx) continue;
      for (const [x, y, rot] of p.at) {
        const a = (rot * Math.PI) / 180, [ox, oy, oz] = p.fx.offset;
        // the offset in the prop's frame (three: x right, y up, z = -Blender y), turned by its rotation about y
        const wx = x + (Math.cos(a) * ox + Math.sin(a) * oz) * p.scale, wz = y + (-Math.sin(a) * ox + Math.cos(a) * oz) * p.scale;
        push(p.fx.vfx, wx, groundAt(x, y) + oy * p.scale, wz, a, 1);
      }
    }
    const rows: EmitterL[] = [];
    const emitters: Emitter[] = [];
    for (const [id, list] of pointsByDef) {
      const def = parseDef(byId.get(id)!);
      for (const l of def.layers) {
        if (l.type !== 'emitter') continue;
        const row = rows.length;
        rows.push(l);
        const life = Math.max(2, l.life[1]);
        const drift = Math.hypot(l.velocity[0], l.velocity[1], l.velocity[2]) * life;
        for (const p of list) {
          const reach = (Math.max(l.radius, l.length / 2) + l.height + drift + l.turb * 1.5) * p.scale + curveMaxSize(l) * p.scale + 0.5;
          const count = l.count > 0 ? l.count : Math.max(1, Math.round(l.rate * life));
          emitters.push({ row, x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale, count, reach, first: 0, def: id });
        }
      }
    }
    if (emitters.length) {
      this.particles = new AmbientParticles(rows, emitters, atlas, grid);
      this.group.add(this.particles.mesh);
    }
    void Promise.resolve().then(() => { if (this.particles && !this.disposed) this.onPart?.(this.particles.mesh); });
    void this.loadCritters(load, groundAt);
    void this.loadProps(load, groundAt);
  }

  /** every model ref the layer loads (the loading screen preloads them) */
  static refs(map: MapDefT): string[] {
    const s = ambientSpec(map);
    return [...new Set([...s.critters.map((c) => c.model), ...s.props.map((p) => p.model)])];
  }

  private async loadCritters(load: ModelLoad, groundAt: (x: number, y: number) => number): Promise<void> {
    let ci = 0;
    for (const spec of this.spec.critters) {
      const m = await load(spec.model);
      if (this.disposed || !m?.renderable || !spec.spots.length) { ci++; continue; }
      const mats = new Set<Material>();
      m.gltf.scene.traverse((o) => { const mesh = o as Mesh; if (mesh.isMesh) for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mats.add(mt); });
      for (const mt of mats) { (mt as MeshStandardMaterial).side = DoubleSide; patchWorldMaterial(mt); }
      const rnd = prng(this.spec.seed * 7919 + ci * 104729);
      for (let i = 0; i < spec.count; i++) {
        const s = spec.spots[i % spec.spots.length];
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s[2];
        const c = new Critter(spec, m.gltf.scene, m.gltf.animations, prng(this.spec.seed * 31 + ci * 1009 + i * 7), groundAt, [s[0] + Math.cos(a) * r, s[1] + Math.sin(a) * r]);
        (c.root as Object3D & { userData: { ambIndex: number } }).userData.ambIndex = i;
        this.critters.push(c);
        this.group.add(c.root);
        if (i === 0) this.onPart?.(c.root);
      }
      ci++;
    }
    this.applyOn();
  }

  private async loadProps(load: ModelLoad, groundAt: (x: number, y: number) => number): Promise<void> {
    for (const p of this.spec.props) {
      if (!p.at.length) continue;
      const m = await load(p.model);
      if (this.disposed || !m?.renderable) continue;
      let geo: BufferGeometry | null = null;
      m.gltf.scene.updateMatrixWorld(true);
      m.gltf.scene.traverse((o) => { const mesh = o as Mesh; if (mesh.isMesh && !geo) { geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld); } });
      if (!geo) continue;
      const g = geo as BufferGeometry;
      if (!g.getAttribute('_sway')) g.setAttribute('_sway', new BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
      const { mat, depth } = clothMaterial(p.sway, p.value);
      this.propMats.push(mat);
      if (depth) this.propMats.push(depth);
      const im = new InstancedMesh(g, mat, p.at.length);
      im.name = 'vale_ambient_props';
      if (depth) im.customDepthMaterial = depth;
      im.castShadow = true; im.receiveShadow = true;
      const q = new Matrix4(), s = new Vector3(p.scale, p.scale, p.scale);
      p.at.forEach(([x, y, rot], i) => {
        q.makeRotationY((rot * Math.PI) / 180).scale(s).setPosition(x, groundAt(x, y), y);
        im.setMatrixAt(i, q);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.propMeshes.push(im);
      this.group.add(im);
      this.onPart?.(im);
    }
  }

  /** the ambientEffects setting and the quality tier's density */
  configure(on: boolean, tier: string): void {
    this.on = on;
    this.density = AMBIENT_DENSITY[tier] ?? 1;
    if (this.particles) { this.particles.density = this.density; this.particles.invalidate(); }
    this.applyOn();
  }

  private applyOn(): void {
    if (this.particles) this.particles.mesh.visible = this.on && this.particles.drawn > 0;
    const keep = (i: number, n: number): boolean => i < Math.max(1, Math.round(n * this.density));
    for (const c of this.critters) c.root.visible = this.on && keep((c.root.userData as { ambIndex: number }).ambIndex, c.spec.count);
  }

  /** one frame: `threats` are the units the viewer SEES (alive, on the map) */
  update(time: number, dt: number, camera: PerspectiveCamera, threats: readonly Threat[]): void {
    const t0 = performance.now();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (this.on && this.particles) { this.particles.update(time, this.frustum); this.particles.mesh.visible = this.particles.drawn > 0; }
    let drawn = 0;
    if (this.on) {
      for (const c of this.critters) {
        const idx = (c.root.userData as { ambIndex: number }).ambIndex;
        if (idx >= Math.max(1, Math.round(c.spec.count * this.density))) { c.root.visible = false; continue; }
        _sphere.center.set(c.x, c.h + 0.2, c.y); _sphere.radius = 1;
        const vis = this.frustum.intersectsSphere(_sphere);
        c.update(Math.min(dt, 0.1), threats, vis);
        c.root.visible = vis;
        if (vis) drawn++;
      }
    }
    this.crittersDrawn = drawn;
    const ms = performance.now() - t0;
    this.ms = this.ms ? this.ms * 0.9 + ms * 0.1 : ms;
  }

  stats(): AmbientStats {
    const P = this.particles;
    return {
      on: this.on, density: this.density, ms: Math.round(this.ms * 1000) / 1000, emitters: P ? P.emitters.length : 0,
      particles: this.on && P ? P.drawn : 0, onScreen: this.on && P ? Object.fromEntries(P.onScreen) : {},
      critters: this.critters.length, crittersDrawn: this.on ? this.crittersDrawn : 0,
      flights: this.critters.reduce((s, c) => s + c.flights, 0), props: this.propMeshes.reduce((s, m) => s + m.count, 0),
    };
  }

  /** harness seam: every critter's state and place */
  critterStates(): { id: string; x: number; y: number; h: number; state: string; visible: boolean }[] {
    return this.critters.map((c) => ({ id: c.spec.id, x: c.x, y: c.y, h: c.h, state: c.state, visible: c.root.visible }));
  }

  dispose(): void {
    this.disposed = true;
    this.particles?.dispose();
    for (const c of this.critters) c.dispose();
    for (const m of this.propMeshes) { m.geometry.dispose(); m.dispose(); }
    for (const m of this.propMats) m.dispose();
    this.group.clear();
  }
}

function curveMaxSize(l: EmitterL): number {
  let m = 0;
  for (let i = 0; i < CURVE_N; i++) m = Math.max(m, l.size[i]);
  return m * Math.max(l.sizeVar[0], l.sizeVar[1]);
}

