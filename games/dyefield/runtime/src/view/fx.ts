// DYEFIELD — match FX (CONTRACT §11 view/fx.ts; phase 6: CONTRACT_P6_11 §18.2). Fixed pools, no
// per-event allocation.
//
//   * Projectile pool (the sim's ProjectilePool, 512 slots), drawn by kind:
//       0 MIST droplet · 1 flick droplet · 2 burst ball → ONE InstancedMesh of glossy team drops (size by
//         kind), stretched along their flight, interpolated between ticks;
//       3 JELLY CHARGE → the sub_jelly_charge model tumbling in flight; state 1 (puddle) → the
//         jelly_puddle model on its surface normal, wobbling faster and swelling as the fuse runs out;
//       4 CLOUDBURST cell → the special_cloudburst model (small while thrown, growing through the rise,
//         the buoy core spinning), with rain streaks from its belly and a shadow disk of soakRadius on
//         the floor while it rains.
//     Every model is an InstancedMesh (opaque + alpha-blended parts) with the crew dye per instance on
//     the M_kit_dye parts → a handful of draw calls, only while such slots exist.
//   * Beams: ONE instanced ribbon draw (additive, camera-facing, with a minimum pixel width): the
//     NEEDLE-GLINT glint line (scope → aim point while charging, brighter with charge, pulsing at full;
//     every runner's, so enemies see it) and the beam flash on release (fades in ~0.3 s).
//   * Particles: ONE GPU ring buffer (InstancedBufferGeometry of quads, 4096 slots, one draw call).
//     An emitter only writes a slot (start position, velocity, start time, life, sizes, colour, kind,
//     gravity, drag); the vertex shader integrates the motion from uTime, so nothing is touched per
//     frame on the CPU except the slots written since the last upload (addUpdateRange).
//     A slot may start in the future (t0 > now): delayed particles are how the tide-spout column and
//     the staggered washed burst are scheduled without timers.
//     kinds: 0 glossy droplet (sphere-shaded billboard) · 1 soft mist puff · 2 ring (oriented to a
//            normal) · 3 spark streak (stretched along its velocity) · 4 flat glossy splash (oriented)
//            · 5 flare (a bright four-point glint)
//   * Emitters: splat (impact / drip), muzzle mist, dry-click puff, hit sparks, slick splash rings,
//     wakes, faint ripples, the WASHED burst, the tide-spout; phase 6: the roller sheet spray, the flick
//     fan, the charger scope glint + beam flash, blaster burst rings, the jelly land / pop, the
//     CLOUDBURST rain + dissipate, the WELLSPRING take-off splash + slam ring wave, leap drips.
// Colours are the teams.json dyes (linear). Math.random is fine here (view only, never core).

import * as THREE from 'three';
import { teamById, WEAPONS } from '../core/data.ts';
import { TICK, KITS } from '../core/config.ts';
import type { TeamId } from '../core/types.ts';
import { bakeModel, type BakedModel, type KitArt } from './players.ts';

/** the slice of core/combat/projectiles.ts ProjectilePool the view reads (CONTRACT §10.2 + CHANGED(KITSIM)) */
export interface ProjectileLike {
  count: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  team: Uint8Array;
  kind?: Uint8Array;
  state?: Uint8Array;
  /** resting slots: whole ticks left (jelly fuse; cloud rise + rain) */
  timer?: Float32Array;
  age?: Float32Array;
  /** CLOUDBURST cell: the hover point */
  ox?: Float32Array; oy?: Float32Array; oz?: Float32Array;
  /** jelly puddle: the surface normal */
  nx?: Float32Array; ny?: Float32Array; nz?: Float32Array;
}

/** baked FX models (fx.setModels) */
export interface FxModels {
  jelly: BakedModel | null;
  puddle: BakedModel | null;
  cloud: BakedModel | null;
  buoy: BakedModel | null;
  /** cell-local offsets: the buoy core and the rain emitter (belly) */
  buoyOffset: [number, number, number];
  rainOffset: [number, number, number];
}

const CAP = 4096;
const DROPS = 512;
const KIND_BLOB = 0, KIND_PUFF = 1, KIND_RING = 2, KIND_SPARK = 3, KIND_SPLASH = 4, KIND_FLARE = 5;
/** sim projectile kinds (core/combat/projectiles.ts) */
const P_MIST = 0, P_FLICK = 1, P_BURST = 2, P_JELLY = 3, P_CLOUD = 4;
const PSTATE_FLY = 0, PSTATE_PUDDLE = 1, PSTATE_HOVER = 2;
const DROP_R = [0.075, 0.11, 0.17];
const BEAMS = 32;
const GLINTS = 16;
const MODEL_CAP = { jelly: 24, puddle: 24, cloud: 8 };

// the numbers the view needs (weapons.json / config.ts KITS)
const jellyRow = WEAPONS.subs.find((s) => s.id === 'jelly-charge') as Record<string, unknown> | undefined;
const cloudRow = WEAPONS.specials.find((s) => s.id === 'cloudburst') as Record<string, unknown> | undefined;
const numOf = (o: Record<string, unknown> | undefined, k: string, d: number): number => (typeof o?.[k] === 'number' ? o[k] as number : d);
const JELLY_FUSE_TICKS = Math.max(1, Math.round(numOf(jellyRow, 'puddleFuse', 0.8) / TICK));
const CLOUD_RISE_TICKS = Math.max(1, Math.round(KITS.cloudRiseSeconds / TICK));
const CLOUD_RAIN_TICKS = Math.max(1, Math.round(numOf(cloudRow, 'duration', 6) / TICK));
const CLOUD_SOAK = numOf(cloudRow, 'soakRadius', 5);
const CLOUD_HOVER = numOf(cloudRow, 'hoverHeight', 2.8);
const JELLY_BLAST = numOf(jellyRow, 'blastRadius', 3);
/** the cell drawn over the 10 m soak disk reads better a size up from the 2.4 m authored model */
const CLOUD_SCALE = 1.5;

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iNrm;   // normal xyz (oriented kinds), kind
attribute vec4 iT;     // t0, life, size0, size1
attribute vec4 iCol;   // linear rgb, alpha
attribute vec2 iPhys;  // gravity (m/s^2), drag (1/s)
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vK;
varying float vKind;
#include <fog_pars_vertex>
void main() {
  float age = uTime - iT.x;
  float k = age / max(iT.y, 1e-3);
  if (age < 0.0 || k >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vK = 1.0; return; }
  float drag = iPhys.y;
  float te = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = iPos + iVel * te - vec3(0.0, 0.5 * iPhys.x * age * age, 0.0);
  float size = mix(iT.z, iT.w, k);
  float kind = iNrm.w;
  // per-instance rotation of the quad (variety for splashes / puffs); sparks and flares stay upright
  float ang = fract(sin(dot(iPos, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  bool upright = (kind > 2.5 && kind < 3.5) || kind > 4.5;
  vec2 c = upright ? corner : vec2(ca * corner.x - sa * corner.y, sa * corner.x + ca * corner.y);
  vec4 mv;
  if ((kind > 1.5 && kind < 2.5) || (kind > 3.5 && kind < 4.5)) {
    vec3 n = normalize(iNrm.xyz);
    vec3 t = normalize(cross(abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
    vec3 b = cross(n, t);
    p += (t * c.x + b * c.y) * size + n * 0.018;
    mv = viewMatrix * vec4(p, 1.0);
  } else if (kind > 2.5 && kind < 3.5) {
    vec3 vel = iVel * (drag > 0.0 ? exp(-drag * age) : 1.0) - vec3(0.0, iPhys.x * age, 0.0);
    mv = viewMatrix * vec4(p, 1.0);
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 d = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
    vec2 side = vec2(-d.y, d.x);
    mv.xy += d * c.x * size * 3.0 + side * c.y * size * 0.45;
  } else {
    mv = viewMatrix * vec4(p, 1.0);
    mv.xy += c * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = corner;
  vCol = iCol;
  vK = k;
  vKind = kind;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunV;
varying vec2 vUv;
varying vec4 vCol;
varying float vK;
varying float vKind;
#include <fog_pars_fragment>
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vK >= 1.0) discard;
  vec3 col = vCol.rgb;
  float a = vCol.a;
  float fade = 1.0 - smoothstep(0.6, 1.0, vK);
  if (vKind < 0.5) {
    // glossy droplet: a lit sphere impostor
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r2)));
    float dif = 0.5 + 0.5 * max(dot(n, uSunV), 0.0);
    float spec = pow(max(dot(reflect(-uSunV, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    float rim = pow(1.0 - n.z, 3.0);
    col = col * dif * (1.0 - 0.35 * rim) + vec3(0.9) * spec;
    a *= smoothstep(1.0, 0.82, r2);
    fade = 1.0 - smoothstep(0.85, 1.0, vK);
  } else if (vKind < 1.5) {
    float s = 1.0 - r2;
    a *= s * s;
  } else if (vKind < 2.5) {
    float r = sqrt(r2);
    a *= smoothstep(0.58, 0.8, r) * (1.0 - smoothstep(0.9, 1.0, r));
    fade = 1.0 - vK;
  } else if (vKind < 3.5) {
    a *= 1.0 - r2;
    col = mix(col, vec3(1.0), 0.45);
  } else if (vKind < 4.5) {
    // flat glossy splash with a lobed, organic edge
    float r = sqrt(r2);
    float ang = atan(vUv.y, vUv.x);
    float edge = 0.8 + 0.1 * sin(ang * 5.0) + 0.07 * sin(ang * 11.0 + 1.7);
    a *= 1.0 - smoothstep(edge - 0.08, edge, r);
    vec3 n = normalize(vec3(vUv * 0.9, 1.0));
    float spec = pow(max(dot(reflect(-uSunV, n), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);
    col = col * (0.8 + 0.2 * (1.0 - r)) + vec3(0.6) * spec;
  } else {
    // flare: a hot core + four thin arms
    float arms = max(exp(-abs(vUv.y) * 22.0) * (1.0 - abs(vUv.x)), exp(-abs(vUv.x) * 22.0) * (1.0 - abs(vUv.y)));
    float glow = exp(-r2 * 9.0);
    a *= clamp(arms + glow, 0.0, 1.0);
    col = mix(col, vec3(1.0), clamp(glow * 0.9 + arms * 0.6, 0.0, 1.0));
    fade = 1.0 - smoothstep(0.5, 1.0, vK);
  }
  gl_FragColor = vec4(col, a * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// camera-facing ribbons (glint lines, beam flashes)
const BEAM_VERT = /* glsl */ `
attribute vec2 corner;   // along (0..1), side (-1..1)
attribute vec4 iA;       // start xyz, world width
attribute vec4 iB;       // end xyz, alpha
attribute vec4 iC;       // linear rgb, min width in px
uniform float uPx;       // world size of one px at view depth 1
varying float vS;
varying float vT;
varying vec4 vCol;
void main() {
  vec3 a = (viewMatrix * vec4(iA.xyz, 1.0)).xyz;
  vec3 b = (viewMatrix * vec4(iB.xyz, 1.0)).xyz;
  const float nearZ = -0.08;
  if (a.z > nearZ && b.z > nearZ) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  if (a.z > nearZ) a = mix(a, b, (a.z - nearZ) / (a.z - b.z));
  if (b.z > nearZ) b = mix(b, a, (b.z - nearZ) / (b.z - a.z));
  vec3 p = mix(a, b, corner.x);
  vec3 side = cross(b - a, p);
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = max(iA.w, iC.w * uPx * -p.z);
  p += side * w * corner.y;
  vS = corner.y;
  vT = corner.x;
  vCol = vec4(iC.rgb, iB.w);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
varying float vS;
varying float vT;
varying vec4 vCol;
void main() {
  // alpha-blended (an additive glow disappears against the bright harbour): a saturated dye edge, a hot core
  float core = exp(-vS * vS * 3.2);
  float hot = exp(-vS * vS * 26.0);
  vec3 col = mix(vCol.rgb * 0.72, mix(vCol.rgb, vec3(1.0), 0.6), hot);
  float a = clamp(vCol.a * core * smoothstep(0.0, 0.02, vT), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

interface Attr { a: THREE.InstancedBufferAttribute; arr: Float32Array; n: number }

/** one instanced model (opaque + alpha-blended parts share the instance transforms and colours) */
class ModelPool {
  readonly meshes: THREE.InstancedMesh[] = [];
  n = 0;
  readonly name: string;
  private readonly teams: Uint8Array;
  private readonly colors: Record<number, THREE.Color>;
  private colorDirty = false;
  constructor(name: string, m: BakedModel, cap: number, colors: Record<number, THREE.Color>, parent: THREE.Object3D) {
    this.name = name;
    this.colors = colors;
    this.teams = new Uint8Array(cap).fill(255);
    for (const [g, blend] of [[m.opaque, false], [m.blend, true]] as Array<[THREE.BufferGeometry | null, boolean]>) {
      if (!g) continue;
      const mesh = new THREE.InstancedMesh(g, fxModelMaterial(blend, blend ? m.blendOpacity : 1), cap);
      mesh.name = `fx_${name}${blend ? '_glass' : ''}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = !blend;
      mesh.receiveShadow = false;
      mesh.renderOrder = blend ? 4 : 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) mesh.setColorAt(i, colors[1]);
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      parent.add(mesh);
    }
  }
  get cap(): number { return this.teams.length; }
  begin(): void { this.n = 0; }
  push(m4: THREE.Matrix4, team: number): number {
    const i = this.n;
    if (i >= this.teams.length) return -1;
    this.n++;
    for (const mesh of this.meshes) mesh.setMatrixAt(i, m4);
    if (this.teams[i] !== team) {
      this.teams[i] = team;
      for (const mesh of this.meshes) mesh.setColorAt(i, this.colors[team] ?? this.colors[0]);
      this.colorDirty = true;
    }
    return i;
  }
  /** like push(), with an explicit per-instance dye (a blinking puddle) */
  pushColor(m4: THREE.Matrix4, col: THREE.Color): number {
    const i = this.n;
    if (i >= this.teams.length) return -1;
    this.n++;
    for (const mesh of this.meshes) { mesh.setMatrixAt(i, m4); mesh.setColorAt(i, col); }
    this.teams[i] = 254;
    this.colorDirty = true;
    return i;
  }
  commit(): void {
    for (const mesh of this.meshes) {
      mesh.count = this.n;
      if (this.n > 0) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (this.colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.colorDirty = false;
  }
  dispose(): void {
    for (const m of this.meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.removeFromParent(); }
  }
}

/** instanced model material: vertex colours, the per-instance crew dye on the team-masked parts, a dye glow */
function fxModelMaterial(blend: boolean, opacity: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0, transparent: blend, opacity, depthWrite: !blend,
  });
  m.name = blend ? 'fx_model_glass' : 'fx_model';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTone;\nvarying vec4 vTone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTone = aTone;')
      // onBeforeCompile sees the #include, not the chunk body: re-derive vColor after it (dye only where masked)
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aTone.x);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vTone;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vTone.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vTone.z;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTone.x * diffuseColor.rgb * 0.45;');
  };
  m.customProgramCacheKey = () => `df-fxmodel-v2-${blend ? 'b' : 'o'}`;
  return m;
}

function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  const san = THREE.PropertyBinding.sanitizeNodeName(name);
  root.traverse((o) => {
    const on = o.userData && typeof o.userData.name === 'string' ? o.userData.name : o.name;
    if (!hit && (on === name || o.name === san)) hit = o;
  });
  return hit;
}

/** Bake the sub / special GLBs into instancing-ready models (once, at boot). */
export function bakeFxModels(art: KitArt): FxModels {
  const out: FxModels = { jelly: null, puddle: null, cloud: null, buoy: null, buoyOffset: [0, -0.34, 0], rainOffset: [0, -0.03, 0] };
  if (art.jelly) {
    const s = art.jelly.scene;
    s.updateMatrixWorld(true);
    const j = findNode(s, 'sub_jelly_charge'), p = findNode(s, 'jelly_puddle');
    if (j) out.jelly = bakeModel(j, j, { exclude: ['jelly_puddle'] });
    if (p) out.puddle = bakeModel(p, p);
  }
  if (art.cloud) {
    const s = art.cloud.scene;
    s.updateMatrixWorld(true);
    const c = findNode(s, 'special_cloudburst') ?? s;
    const core = findNode(s, 'core');
    const rain = findNode(s, 'rain');
    out.cloud = bakeModel(c, c, { exclude: ['core'] });
    if (core) {
      out.buoy = bakeModel(core, core);
      out.buoyOffset = [core.position.x, core.position.y, core.position.z];
    }
    if (rain) out.rainOffset = [rain.position.x, rain.position.y, rain.position.z];
  }
  return out;
}

/** a radial disk texture: a dark tinted fill + a bright rim at the soak radius (linear data) */
function diskTexture(): THREE.DataTexture {
  const N = 64;
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      const r = Math.sqrt(u * u + v * v);
      const i = (y * N + x) * 4;
      const rim = r > 0.86 && r < 1 ? Math.sin(((r - 0.86) / 0.14) * Math.PI) : 0;
      const fill = r < 1 ? 0.34 * (1 - 0.35 * r * r) : 0;
      const g = 0.32 + 0.68 * rim;
      d[i] = d[i + 1] = d[i + 2] = Math.round(g * 255);
      d[i + 3] = Math.round(Math.min(1, fill + rim * 0.8) * 255);
    }
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface Glint { on: boolean; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; c: number; team: number }
interface Flash { t0: number; life: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; c: number; team: number }

export class Fx {
  readonly root = new THREE.Group();
  readonly drops: THREE.InstancedMesh;
  readonly particles: THREE.Mesh;
  readonly beams: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly beamGeo: THREE.InstancedBufferGeometry;
  private readonly bA: Attr; private readonly bB: Attr; private readonly bC: Attr;
  private readonly aPos: Attr; private readonly aVel: Attr; private readonly aNrm: Attr;
  private readonly aT: Attr; private readonly aCol: Attr; private readonly aPhys: Attr;
  private head = 0;
  private dirtyLo = -1;
  private dirtyN = 0;
  private time = 0;
  private readonly sunDir: THREE.Vector3;
  private readonly teamCol: Record<number, THREE.Color>;
  private readonly teamLight: Record<number, THREE.Color>;
  private readonly teamDark: Record<number, THREE.Color>;
  private readonly white = new THREE.Color(0xf4fbff);
  private readonly mist = new THREE.Color(0xe8f6ff);
  private readonly grey = new THREE.Color(0x9aa3ad);
  private readonly cloudWhite = new THREE.Color(0xdfe9f5);
  private readonly tmpC = new THREE.Color();
  // drops scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly n3 = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  private static readonly Y = new THREE.Vector3(0, 1, 0);
  private static readonly X = new THREE.Vector3(1, 0, 0);
  private lastDropTeams = new Uint8Array(DROPS);
  private wakeN = 0;
  // models
  private jelly: ModelPool | null = null;
  private puddle: ModelPool | null = null;
  private cloud: ModelPool | null = null;
  private buoy: ModelPool | null = null;
  private readonly disks: THREE.InstancedMesh;
  private buoyOff: [number, number, number] = [0, -0.34, 0];
  private rainOff: [number, number, number] = [0, -0.03, 0];
  private rainAcc = new Float32Array(8);
  // beams
  private readonly glints: Glint[] = [];
  private readonly flashes: Flash[] = [];
  private flashHead = 0;
  /** emitted particle count (stats) */
  emitted = 0;
  /** skipped emissions (beyond the FX range) */
  culled = 0;
  /** live counts of the last update (harness read-back) */
  readonly live = { drops: 0, jelly: 0, puddles: 0, cells: 0, raining: 0, glints: 0, flashes: 0 };
  /** the view height in CSS px (the beams' minimum pixel widths); game.ts keeps it current */
  viewHeight = 720;
  /** camera position of the last update (emitters cull by distance: no fill spent on far FX) */
  private readonly eye = new THREE.Vector3(0, 1e6, 0);

  constructor(sunDir: THREE.Vector3) {
    this.sunDir = sunDir;
    this.root.name = 'fx';
    const c1 = new THREE.Color(teamById(1).dye), c2 = new THREE.Color(teamById(2).dye);
    const n = new THREE.Color(0xdfe6ee);
    this.teamCol = { 0: n, 1: c1, 2: c2 };
    this.teamLight = { 0: n, 1: c1.clone().lerp(new THREE.Color(teamById(1).dyeGloss), 0.35), 2: c2.clone().lerp(new THREE.Color(teamById(2).dyeGloss), 0.35) };
    this.teamDark = { 0: n.clone().multiplyScalar(0.5), 1: c1.clone().multiplyScalar(0.55), 2: c2.clone().multiplyScalar(0.55) };

    // ── projectile droplets
    const dropGeo = new THREE.IcosahedronGeometry(1, 1);
    const dropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0 });
    dropMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor * 0.35;\n#endif');
    };
    dropMat.customProgramCacheKey = () => 'df-drop-v1';
    this.drops = new THREE.InstancedMesh(dropGeo, dropMat, DROPS);
    this.drops.name = 'fx_drops';
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.drops.castShadow = false;
    this.drops.receiveShadow = false;
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < DROPS; i++) { this.drops.setColorAt(i, this.teamLight[1]); this.lastDropTeams[i] = 1; }
    this.drops.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    // ── particle ring buffer
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (geo: THREE.InstancedBufferGeometry, cap: number, name: string, n: number): Attr => {
      const arr = new Float32Array(cap * n);
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return { a, arr, n };
    };
    this.aPos = mk(g, CAP, 'iPos', 3); this.aVel = mk(g, CAP, 'iVel', 3); this.aNrm = mk(g, CAP, 'iNrm', 4);
    this.aT = mk(g, CAP, 'iT', 4); this.aCol = mk(g, CAP, 'iCol', 4); this.aPhys = mk(g, CAP, 'iPhys', 2);
    // every slot starts dead (t0 far in the past, life tiny)
    for (let i = 0; i < CAP; i++) { this.aT.arr[i * 4] = -1e6; this.aT.arr[i * 4 + 1] = 0.001; }
    g.instanceCount = CAP;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSunV: { value: new THREE.Vector3(0, 1, 0) } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mat.name = 'fx_particles';
    this.particles = new THREE.Mesh(g, this.mat);
    this.particles.name = 'fx_particles';
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;

    // ── beams (glint lines + release flashes): one instanced ribbon draw
    const bg = new THREE.InstancedBufferGeometry();
    bg.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2));
    bg.setIndex([0, 1, 2, 0, 2, 3]);
    this.bA = mk(bg, BEAMS, 'iA', 4); this.bB = mk(bg, BEAMS, 'iB', 4); this.bC = mk(bg, BEAMS, 'iC', 4);
    bg.instanceCount = 0;
    bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.beamGeo = bg;
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 0.001 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.beamMat.name = 'fx_beams';
    this.beams = new THREE.Mesh(bg, this.beamMat);
    this.beams.name = 'fx_beams';
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 6;
    for (let i = 0; i < GLINTS; i++) this.glints.push({ on: false, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, c: 0, team: 1 });
    for (let i = 0; i < BEAMS - GLINTS; i++) this.flashes.push({ t0: -1e6, life: 0.3, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, c: 0, team: 1 });

    // ── CLOUDBURST shadow disks
    const diskMat = new THREE.MeshBasicMaterial({
      map: diskTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    diskMat.name = 'fx_disk';
    this.disks = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), diskMat, MODEL_CAP.cloud);
    this.disks.name = 'fx_cloud_disks';
    this.disks.count = 0;
    this.disks.frustumCulled = false;
    this.disks.renderOrder = 3;
    this.disks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MODEL_CAP.cloud; i++) this.disks.setColorAt(i, this.teamCol[1]);

    this.root.add(this.drops, this.disks, this.particles, this.beams);
  }

  /** hand over the baked sub / special models (main.ts, once) */
  setModels(m: FxModels): void {
    if (m.jelly) this.jelly = new ModelPool('jelly', m.jelly, MODEL_CAP.jelly, this.teamCol, this.root);
    if (m.puddle) this.puddle = new ModelPool('puddle', m.puddle, MODEL_CAP.puddle, this.teamCol, this.root);
    if (m.cloud) this.cloud = new ModelPool('cloud', m.cloud, MODEL_CAP.cloud, this.teamCol, this.root);
    if (m.buoy) this.buoy = new ModelPool('buoy', m.buoy, MODEL_CAP.cloud, this.teamCol, this.root);
    this.buoyOff = m.buoyOffset;
    this.rainOff = m.rainOffset;
  }

  /** shader pre-warm: show one instance of every pooled mesh (compileAsync), then hide them again */
  prewarm(on: boolean): void {
    for (const pool of [this.jelly, this.puddle, this.cloud, this.buoy]) {
      if (!pool) continue;
      for (const mesh of pool.meshes) mesh.count = on ? 1 : 0;
    }
    this.disks.count = on ? 1 : 0;
    this.beamGeo.instanceCount = on ? 1 : 0;
    this.drops.count = on ? 1 : 0;
  }

  // ───────────────────────────── low level ─────────────────────────────
  private slot(px: number, py: number, pz: number, vx: number, vy: number, vz: number,
    kind: number, life: number, s0: number, s1: number, col: THREE.Color, alpha: number,
    grav: number, drag: number, nx = 0, ny = 0, nz = 0, delay = 0): void {
    const i = this.head;
    this.head = (this.head + 1) % CAP;
    this.aPos.arr[i * 3] = px; this.aPos.arr[i * 3 + 1] = py; this.aPos.arr[i * 3 + 2] = pz;
    this.aVel.arr[i * 3] = vx; this.aVel.arr[i * 3 + 1] = vy; this.aVel.arr[i * 3 + 2] = vz;
    this.aNrm.arr[i * 4] = nx; this.aNrm.arr[i * 4 + 1] = ny; this.aNrm.arr[i * 4 + 2] = nz; this.aNrm.arr[i * 4 + 3] = kind;
    this.aT.arr[i * 4] = this.time + delay; this.aT.arr[i * 4 + 1] = life; this.aT.arr[i * 4 + 2] = s0; this.aT.arr[i * 4 + 3] = s1;
    this.aCol.arr[i * 4] = col.r; this.aCol.arr[i * 4 + 1] = col.g; this.aCol.arr[i * 4 + 2] = col.b; this.aCol.arr[i * 4 + 3] = alpha;
    this.aPhys.arr[i * 2] = grav; this.aPhys.arr[i * 2 + 1] = drag;
    if (this.dirtyN === 0) this.dirtyLo = i;
    this.dirtyN = Math.min(CAP, this.dirtyN + 1);
    this.emitted++;
  }

  private col(team: number): THREE.Color { return this.teamCol[team] ?? this.teamCol[0]; }
  private light(team: number): THREE.Color { return this.teamLight[team] ?? this.col(team); }

  /** squared distance from the camera (last frame) */
  private d2(x: number, y: number, z: number): number {
    const dx = x - this.eye.x, dy = y - this.eye.y, dz = z - this.eye.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** random unit vector in the hemisphere around n, biased toward it (k = spread 0..1) */
  private hemi(nx: number, ny: number, nz: number, k: number): void {
    for (let t = 0; t < 6; t++) {
      const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      const l = x * x + y * y + z * z;
      if (l > 1 || l < 1e-4) continue;
      const il = 1 / Math.sqrt(l);
      let dx = nx * (1 - k) + x * il * k, dy = ny * (1 - k) + y * il * k, dz = nz * (1 - k) + z * il * k;
      if (dx * nx + dy * ny + dz * nz < 0) { dx = -dx + 2 * nx; dy = -dy + 2 * ny; dz = -dz + 2 * nz; }
      const dl = Math.hypot(dx, dy, dz) || 1;
      this.d.set(dx / dl, dy / dl, dz / dl);
      return;
    }
    this.d.set(nx, ny, nz);
  }

  // ───────────────────────────── emitters ─────────────────────────────
  /** impact (r ≥ 0.7) or drip splat on a surface: a flat glossy splash + flying droplets */
  splat(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, team: TeamId): void {
    const d2 = this.d2(x, y, z);
    const big = r >= 0.7;
    // beyond 55 m nothing reads; beyond 30 m only an impact's splash; drips only within 22 m
    if (d2 > 55 * 55 || (!big && d2 > 22 * 22)) { this.culled++; return; }
    const c = this.col(team);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) { nx = 0; ny = 1; nz = 0; } else { nx /= nl; ny /= nl; nz /= nl; }
    this.slot(x, y, z, 0, 0, 0, KIND_SPLASH, big ? 0.3 : 0.22, r * 0.35, r * (big ? 0.9 : 0.7), c, 0.9, 0, 0, nx, ny, nz);
    if (d2 > 30 * 30) return;
    const drops = big ? (d2 < 12 * 12 ? 6 : 4) : 1;
    for (let i = 0; i < drops; i++) {
      this.hemi(nx, ny, nz, 0.75);
      const sp = (big ? 2.2 : 1.2) + Math.random() * (big ? 3.2 : 1.4);
      const sz = (big ? 0.05 : 0.035) + Math.random() * 0.045;
      this.slot(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, this.d.x * sp, this.d.y * sp, this.d.z * sp,
        KIND_BLOB, 0.35 + Math.random() * 0.3, sz, sz * 0.5, c, 1, 14, 0.6);
    }
    if (big && d2 < 18 * 18) this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.26, r * 0.3, r * 1.1, this.light(team), 0.5, 0, 0, nx, ny, nz);
  }

  /** muzzle mist along the shot direction (k scales it: POP-WELL bursts are bigger) */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, team: TeamId, k = 1): void {
    if (this.d2(x, y, z) > 35 * 35) { this.culled++; return; }
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const c = this.light(team);
    const n = k > 1.2 ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const sp = (1.6 + Math.random() * 1.8) * Math.sqrt(k);
      const jx = (Math.random() - 0.5) * 0.8, jy = (Math.random() - 0.5) * 0.8, jz = (Math.random() - 0.5) * 0.8;
      this.slot(x, y, z, (dx + jx * 0.3 * k) * sp, (dy + jy * 0.3 * k) * sp + 0.2, (dz + jz * 0.3 * k) * sp, KIND_PUFF,
        0.22 + Math.random() * 0.1, 0.05 * k, 0.24 * k, this.mist, 0.4, -0.5, 4);
    }
    this.slot(x, y, z, dx * 3, dy * 3, dz * 3, KIND_BLOB, 0.12, 0.06 * k, 0.03 * k, c, 1, 0, 6);
    if (k > 1.2) this.slot(x, y, z, 0, 0, 0, KIND_FLARE, 0.1, 0.25 * k, 0.12 * k, c, 1, 0, 0);
  }

  /** empty-tank click: a small grey puff + two dull drips at the muzzle */
  dryPuff(x: number, y: number, z: number): void {
    this.slot(x, y, z, 0, 0.35, 0, KIND_PUFF, 0.35, 0.05, 0.2, this.grey, 0.55, -0.4, 3);
    for (let i = 0; i < 2; i++) {
      this.slot(x, y, z, (Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6, KIND_BLOB, 0.4, 0.025, 0.015, this.grey, 1, 9, 1);
    }
  }

  /** a hit on a runner: sparks + a burst of the attacker's dye */
  hitSparks(x: number, y: number, z: number, team: TeamId): void {
    const c = this.col(team);
    for (let i = 0; i < 7; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 3 + Math.random() * 3.5;
      this.slot(x, y, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_SPARK, 0.18 + Math.random() * 0.1, 0.035, 0.012, this.white, 0.95, 8, 3);
    }
    for (let i = 0; i < 4; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 2 + Math.random() * 2.5;
      this.slot(x, y, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_BLOB, 0.4, 0.06, 0.03, c, 1, 14, 0.5);
    }
  }

  /** slick in / out (big = the respawn landing): a ring on the floor + a splash of droplets */
  slickRing(x: number, y: number, z: number, team: TeamId, big: boolean): void {
    const c = this.col(team);
    this.slot(x, y, z, 0, 0, 0, KIND_RING, big ? 0.55 : 0.4, 0.15, big ? 1.8 : 1.05, this.light(team), 0.85, 0, 0, 0, 1, 0);
    this.slot(x, y, z, 0, 0, 0, KIND_SPLASH, big ? 0.5 : 0.3, 0.2, big ? 1.1 : 0.6, c, 0.85, 0, 0, 0, 1, 0);
    const n = big ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (big ? 2.4 : 1.5) + Math.random() * 1.5;
      this.slot(x, y + 0.05, z, Math.cos(a) * sp, 2 + Math.random() * 2.5, Math.sin(a) * sp, KIND_BLOB, 0.45, 0.05, 0.025, c, 1, 16, 0.4);
    }
  }

  /** a moving slicker's wake: a flat splash in its dye + a kicked droplet (vertical = wall-slick) */
  wake(x: number, y: number, z: number, vx: number, vz: number, team: TeamId, strength: number, wall: boolean): void {
    const c = this.col(team);
    const l = Math.hypot(vx, vz) || 1;
    if (wall) {
      this.slot(x, y, z, 0, -0.2, 0, KIND_SPLASH, 0.35, 0.12, 0.3, c, 0.75, 0, 0, -vx / l, 0, -vz / l);
      this.slot(x, y, z, (Math.random() - 0.5) * 0.8, -0.5, (Math.random() - 0.5) * 0.8, KIND_BLOB, 0.4, 0.04, 0.02, c, 1, 12, 0.5);
      return;
    }
    const d2 = this.d2(x, y, z);
    if (d2 > 60 * 60) { this.culled++; return; }
    this.slot(x, y, z, 0, 0, 0, KIND_SPLASH, 0.45, 0.12 + 0.1 * strength, 0.32 + 0.18 * strength, c, 0.7, 0, 0, 0, 1, 0);
    this.wakeN++;
    if ((this.wakeN & 1) === 0 && d2 < 30 * 30) this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.5, 0.16, 0.45 + 0.25 * strength, this.light(team), 0.28 * strength + 0.12, 0, 0, 0, 1, 0);
    if (d2 < 25 * 25 && Math.random() < 0.5) {
      const sx = -vx / l, sz = -vz / l;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.slot(x, y + 0.05, z, (sx * 0.8 + sz * side * 0.9) * 1.6, 1.4 + Math.random() * 1.4, (sz * 0.8 - sx * side * 0.9) * 1.6,
        KIND_BLOB, 0.4, 0.045, 0.02, c, 1, 14, 0.4);
    }
  }

  /** the faint ripple of a still (or hidden) slicker */
  ripple(x: number, y: number, z: number, team: TeamId, alpha: number): void {
    this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.9, 0.12, 0.7, this.light(team), alpha, 0, 0, 0, 1, 0);
  }

  /** WASHED: a big burst of the attacker's dye (team = the attacker's crew) */
  washedBurst(x: number, y: number, z: number, team: TeamId): void {
    const c = this.col(team);
    const cy = y + 0.6;
    for (let i = 0; i < 34; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 2.5 + Math.random() * 5.5;
      const sz = 0.04 + Math.random() * 0.06;
      this.slot(x, cy, z, this.d.x * sp, this.d.y * sp + 1.2, this.d.z * sp, KIND_BLOB, 0.55 + Math.random() * 0.45, sz, sz * 0.4, c, 1, 15, 0.5, 0, 0, 0, i < 12 ? 0 : Math.random() * 0.06);
    }
    for (let i = 0; i < 6; i++) {
      this.hemi(0, 1, 0, 1);
      this.slot(x, cy, z, this.d.x * 1.5, this.d.y * 1.5, this.d.z * 1.5, KIND_PUFF, 0.5, 0.25, 0.9, this.light(team), 0.55, -0.3, 2.5);
    }
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_RING, 0.5, 0.3, 2.6, this.light(team), 0.9, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.02, z, 0, 0, 0, KIND_SPLASH, 0.7, 0.4, 1.9, c, 0.9, 0, 0, 0, 1, 0);
    for (let i = 0; i < 10; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 5 + Math.random() * 4;
      this.slot(x, cy, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_SPARK, 0.22, 0.05, 0.015, this.white, 1, 6, 2.5);
    }
  }

  /** the tide-spout respawn: a rising column of dye + sea spray over ~0.6 s, then a splash */
  spout(x: number, y: number, z: number, team: TeamId): void {
    const c = this.col(team);
    for (let i = 0; i < 26; i++) {
      const delay = (i / 26) * 0.5;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.35;
      this.slot(x + Math.cos(a) * rr, y + 0.05, z + Math.sin(a) * rr, Math.cos(a) * 0.4, 5 + Math.random() * 4, Math.sin(a) * 0.4,
        KIND_BLOB, 0.5 + Math.random() * 0.2, 0.07 + Math.random() * 0.06, 0.03, i % 3 === 0 ? this.white : c, 1, 12, 0.3, 0, 0, 0, delay);
    }
    for (let i = 0; i < 6; i++) {
      this.slot(x, y + 0.2 + i * 0.4, z, 0, 1.5, 0, KIND_PUFF, 0.6, 0.3, 0.7, this.mist, 0.35, -0.2, 2, 0, 0, 0, i * 0.06);
    }
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_RING, 0.7, 0.3, 1.6, this.light(team), 0.8, 0, 0, 0, 1, 0);
  }

  // ── phase 6 ──────────────────────────────────────────────────────────────────────────────────
  /** SHEET-DRUM sheet spray at the drum contact (≈ 30 Hz while rolling): a sheet of dye kicked off the drum */
  rollSpray(x: number, y: number, z: number, mx: number, mz: number, speed: number, team: TeamId): void {
    const d2 = this.d2(x, y, z);
    if (d2 > 40 * 40) { this.culled++; return; }
    const c = this.col(team);
    // the drum axis is across the motion
    const ax = mz, az = -mx;
    const u = (Math.random() * 2 - 1) * 0.9;
    this.slot(x + ax * u, y, z + az * u, 0, 0, 0, KIND_SPLASH, 0.32, 0.2, 0.5, c, 0.85, 0, 0, 0, 1, 0);
    const n = d2 < 18 * 18 ? 3 : 1;
    const fwd = 1.2 + speed * 0.55;
    for (let i = 0; i < n; i++) {
      const w = (Math.random() * 2 - 1) * 0.95;
      const side = (Math.random() * 2 - 1) * 1.3;
      const sz = 0.04 + Math.random() * 0.04;
      this.slot(x + ax * w, y + 0.12, z + az * w, mx * fwd + ax * side, 1.6 + Math.random() * 2.2, mz * fwd + az * side,
        KIND_BLOB, 0.35 + Math.random() * 0.2, sz, sz * 0.5, c, 1, 15, 0.5);
    }
    if (d2 < 18 * 18 && Math.random() < 0.35) {
      this.slot(x + ax * u, y + 0.1, z + az * u, mx * 1.2, 0.6, mz * 1.2, KIND_PUFF, 0.35, 0.12, 0.45, this.light(team), 0.35, -0.3, 3);
    }
  }

  /** SHEET-DRUM flick release: a vertical fan of mist + dye flung off the drum along the aim */
  flickFan(x: number, y: number, z: number, dx: number, dy: number, dz: number, team: TeamId): void {
    if (this.d2(x, y, z) > 40 * 40) { this.culled++; return; }
    const l = Math.hypot(dx, dz) || 1;
    const hx = dx / l, hz = dz / l;
    const c = this.col(team), cl = this.light(team);
    for (let i = 0; i < 7; i++) {
      const up = 0.15 + i * 0.16 + Math.max(0, dy) * 0.5;
      const sp = 4 + Math.random() * 2.5;
      this.slot(x, y + 0.2, z, hx * sp, up * sp, hz * sp, KIND_PUFF, 0.32, 0.1, 0.55, this.mist, 0.45, -0.3, 4.5);
      this.slot(x, y + 0.2, z, hx * sp * 1.3 + (Math.random() - 0.5), up * sp * 1.3, hz * sp * 1.3 + (Math.random() - 0.5),
        KIND_BLOB, 0.45, 0.07, 0.035, i & 1 ? c : cl, 1, 18, 0.6);
    }
  }

  /**
   * NEEDLE-GLINT glint (per frame while charging, per runner slot): the thin team line scope → aim point
   * plus a flare at the scope. Everyone's is drawn (the glint is visible to enemies, §18.1).
   */
  glint(slot: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, charge: number, team: TeamId): void {
    const g = this.glints[slot % GLINTS];
    g.on = true; g.x0 = x0; g.y0 = y0; g.z0 = z0; g.x1 = x1; g.y1 = y1; g.z1 = z1; g.c = charge; g.team = team;
    if (this.d2(x0, y0, z0) > 80 * 80) return;
    const full = charge >= 0.999;
    const pulse = full ? 0.8 + 0.2 * Math.sin(this.time * 22) : 1;
    const sz = (0.1 + 0.16 * charge + (full ? 0.12 : 0)) * pulse;
    this.slot(x0, y0, z0, 0, 0, 0, KIND_FLARE, 0.045, sz, sz, full ? this.white : this.light(team), 0.75 + 0.25 * charge, 0, 0);
  }

  /** NEEDLE-GLINT release: a bright beam flash along the shot + flares at both ends + mist along it */
  beamFlash(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, charge: number, team: TeamId): void {
    const f = this.flashes[this.flashHead];
    this.flashHead = (this.flashHead + 1) % this.flashes.length;
    f.t0 = this.time; f.life = 0.24 + 0.16 * charge;
    f.x0 = x0; f.y0 = y0; f.z0 = z0; f.x1 = x1; f.y1 = y1; f.z1 = z1; f.c = charge; f.team = team;
    const cl = this.light(team);
    this.slot(x0, y0, z0, 0, 0, 0, KIND_FLARE, 0.14, 0.5 + 0.4 * charge, 0.2, this.white, 1, 0, 0);
    this.slot(x1, y1, z1, 0, 0, 0, KIND_FLARE, 0.2, 0.7 + 0.5 * charge, 0.25, cl, 1, 0, 0);
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const steps = Math.min(14, Math.floor(L / 1.6));
    for (let i = 1; i <= steps; i++) {
      const k = i / (steps + 1);
      const px = x0 + (x1 - x0) * k, py = y0 + (y1 - y0) * k, pz = z0 + (z1 - z0) * k;
      if (this.d2(px, py, pz) > 45 * 45) continue;
      this.slot(px, py, pz, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, KIND_PUFF, 0.35 + Math.random() * 0.15, 0.06, 0.28, this.mist, 0.35, -0.2, 2);
    }
  }

  /** POP-WELL burst: a camera-facing shock ring of splashRadius (+ a floor ring for an airburst), a flash, dye */
  burst(x: number, y: number, z: number, r: number, air: boolean, team: TeamId): void {
    const d2 = this.d2(x, y, z);
    if (d2 > 65 * 65) { this.culled++; return; }
    const c = this.col(team), cl = this.light(team);
    this.n3.set(this.eye.x - x, this.eye.y - y, this.eye.z - z).normalize();
    this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.24, 0.4, r * 1.05, cl, 1, 0, 0, this.n3.x, this.n3.y, this.n3.z);
    this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.34, 0.3, r * 0.8, this.white, 0.7, 0, 0, this.n3.x, this.n3.y, this.n3.z, 0.04);
    if (air) this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.38, 0.2, r * 0.95, cl, 0.75, 0, 0, 0, 1, 0);
    this.slot(x, y, z, 0, 0, 0, KIND_FLARE, 0.14, r * 0.55, r * 0.3, this.white, 1, 0, 0);
    if (d2 > 45 * 45) return;
    for (let i = 0; i < 6; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = r * 2.2;
      this.slot(x, y, z, this.d.x * sp, this.d.y * sp * 0.6, this.d.z * sp, KIND_PUFF, 0.42, 0.25, 0.85, cl, 0.55, -0.2, 5);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const e = (Math.random() - 0.3) * 0.9;
      const sp = r * (2.6 + Math.random() * 1.6);
      const sz = 0.05 + Math.random() * 0.05;
      this.slot(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, KIND_BLOB, 0.5, sz, sz * 0.5, c, 1, 12, 2.2);
    }
  }

  /** JELLY CHARGE lands: a small splat of the thrower's dye */
  jellyLand(x: number, y: number, z: number, team: TeamId): void {
    if (this.d2(x, y, z) > 45 * 45) { this.culled++; return; }
    const c = this.col(team);
    this.slot(x, y + 0.02, z, 0, 0, 0, KIND_SPLASH, 0.4, 0.2, 0.7, c, 0.9, 0, 0, 0, 1, 0);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.slot(x, y + 0.1, z, Math.cos(a) * 1.6, 1.5 + Math.random() * 1.5, Math.sin(a) * 1.6, KIND_BLOB, 0.4, 0.05, 0.025, c, 1, 15, 0.4);
    }
  }

  /** JELLY CHARGE pops: flash, a blast ring of blastRadius, a dye crown and mist */
  jellyPop(x: number, y: number, z: number, r: number, team: TeamId): void {
    const d2 = this.d2(x, y, z);
    if (d2 > 65 * 65) { this.culled++; return; }
    const c = this.col(team), cl = this.light(team);
    this.slot(x, y + 0.4, z, 0, 0, 0, KIND_FLARE, 0.16, r * 0.6, r * 0.25, this.white, 1, 0, 0);
    this.slot(x, y + 0.05, z, 0, 0, 0, KIND_RING, 0.38, 0.3, r * 1.05, cl, 1, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.05, z, 0, 0, 0, KIND_RING, 0.5, 0.2, r * 0.7, this.white, 0.6, 0, 0, 0, 1, 0, 0.07);
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_SPLASH, 0.6, 0.5, r * 0.55, c, 0.9, 0, 0, 0, 1, 0);
    this.n3.set(this.eye.x - x, this.eye.y - y, this.eye.z - z).normalize();
    this.slot(x, y + 0.6, z, 0, 0, 0, KIND_RING, 0.3, 0.3, r * 0.9, cl, 0.8, 0, 0, this.n3.x, this.n3.y, this.n3.z);
    if (d2 > 45 * 45) return;
    for (let i = 0; i < 34; i++) {
      this.hemi(0, 1, 0, 0.95);
      const sp = 3 + Math.random() * 5;
      const sz = 0.05 + Math.random() * 0.07;
      this.slot(x, y + 0.3, z, this.d.x * sp, this.d.y * sp + 1.5, this.d.z * sp, KIND_BLOB, 0.6 + Math.random() * 0.3, sz, sz * 0.4, c, 1, 15, 0.4);
    }
    for (let i = 0; i < 8; i++) {
      this.hemi(0, 1, 0, 1);
      this.slot(x, y + 0.4, z, this.d.x * 2.5, this.d.y * 1.5, this.d.z * 2.5, KIND_PUFF, 0.55, 0.3, 1.2, cl, 0.5, -0.3, 3);
    }
    for (let i = 0; i < 10; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 6 + Math.random() * 4;
      this.slot(x, y + 0.3, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_SPARK, 0.22, 0.06, 0.02, this.white, 1, 6, 2.5);
    }
  }

  /** CLOUDBURST ends: the cell dissipates into mist */
  cloudEnd(x: number, y: number, z: number, team: TeamId): void {
    if (this.d2(x, y, z) > 70 * 70) { this.culled++; return; }
    for (let i = 0; i < 12; i++) {
      this.hemi(0, 1, 0, 1);
      this.slot(x + this.d.x * 0.8, y + 0.3, z + this.d.z * 0.8, this.d.x * 1.6, this.d.y * 0.6, this.d.z * 1.6, KIND_PUFF,
        0.9 + Math.random() * 0.4, 0.5, 1.5, this.cloudWhite, 0.55, -0.3, 1.5);
    }
    this.slot(x, y, z, 0, 0, 0, KIND_FLARE, 0.2, 0.6, 0.2, this.light(team), 0.9, 0, 0);
  }

  /**
   * CHANGED(INTEGRATE) phases 7–8: a spring pad launch (CONTRACT_P6_11 §19 "splash on launch"): team-neutral —
   * a foam ring the size of the pad, a white splash sheet and a column of spray thrown along the launch
   * direction (lx, lz = the horizontal launch unit, 0 = straight up). game.ts calls it when runner.launches grows.
   */
  springSplash(x: number, y: number, z: number, r: number, lx = 0, lz = 0): void {
    if (this.d2(x, y, z) > 70 * 70) { this.culled++; return; }
    const w = this.white, m = this.mist;
    this.slot(x, y + 0.04, z, 0, 0, 0, KIND_RING, 0.5, r * 0.5, r * 1.6, w, 0.95, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_SPLASH, 0.4, r * 0.4, r * 1.1, m, 0.8, 0, 0, 0, 1, 0);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const rr = r * (0.3 + 0.6 * Math.random());
      const up = 4 + Math.random() * 5, out = 0.8 + Math.random() * 1.6;
      this.slot(x + Math.cos(a) * rr, y + 0.08, z + Math.sin(a) * rr,
        Math.cos(a) * out + lx * up * 0.35, up, Math.sin(a) * out + lz * up * 0.35,
        KIND_BLOB, 0.55 + Math.random() * 0.25, 0.05 + Math.random() * 0.05, 0.02, i % 2 ? w : m, 1, 14, 0.5);
    }
    for (let i = 0; i < 4; i++) this.slot(x, y + 0.3 + i * 0.3, z, lx * 1.2, 1.4, lz * 1.2, KIND_PUFF, 0.7, 0.35, 1.0, m, 0.4, -0.2, 2, 0, 0, 0, i * 0.05);
  }

  /** WELLSPRING take-off: a splash ring and dye kicked down and out */
  leapBurst(x: number, y: number, z: number, team: TeamId): void {
    if (this.d2(x, y, z) > 60 * 60) { this.culled++; return; }
    const c = this.col(team);
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_RING, 0.45, 0.2, 1.7, this.light(team), 0.9, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.02, z, 0, 0, 0, KIND_SPLASH, 0.45, 0.3, 1.0, c, 0.85, 0, 0, 0, 1, 0);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const sp = 2 + Math.random() * 2;
      this.slot(x, y + 0.1, z, Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp, KIND_BLOB, 0.5, 0.06, 0.03, c, 1, 15, 0.4);
    }
  }

  /** WELLSPRING slam: the ring wave out to ringRadius + a crown of dye + a central spout */
  ringWave(x: number, y: number, z: number, r: number, team: TeamId): void {
    const d2 = this.d2(x, y, z);
    if (d2 > 70 * 70) { this.culled++; return; }
    const c = this.col(team), cl = this.light(team);
    // the wave front in white (it reads over the ring of fresh dye it paints), then dye rings behind it
    this.slot(x, y + 0.06, z, 0, 0, 0, KIND_RING, 0.45, 0.5, r * 1.08, this.white, 1, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.06, z, 0, 0, 0, KIND_RING, 0.55, 0.4, r * 0.85, cl, 0.95, 0, 0, 0, 1, 0, 0.05);
    this.slot(x, y + 0.06, z, 0, 0, 0, KIND_RING, 0.65, 0.3, r * 0.58, this.white, 0.6, 0, 0, 0, 1, 0, 0.11);
    this.slot(x, y + 0.04, z, 0, 0, 0, KIND_SPLASH, 0.7, 0.5, r * 0.42, c, 0.9, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.5, z, 0, 0, 0, KIND_FLARE, 0.18, 1.6, 0.4, this.white, 1, 0, 0);
    if (d2 > 50 * 50) return;
    // the crown: dye thrown outward from a ring that races out with the wave
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + Math.random() * 0.1;
      const sp = r * (1.1 + Math.random() * 0.5);
      const sz = 0.06 + Math.random() * 0.06;
      this.slot(x + Math.cos(a) * 0.6, y + 0.1, z + Math.sin(a) * 0.6, Math.cos(a) * sp, 3 + Math.random() * 3.5, Math.sin(a) * sp,
        KIND_BLOB, 0.65 + Math.random() * 0.2, sz, sz * 0.5, i % 4 === 0 ? this.white : c, 1, 16, 1.2);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.slot(x, y + 0.2, z, Math.cos(a) * 0.8, 6 + Math.random() * 4, Math.sin(a) * 0.8, KIND_BLOB, 0.7, 0.09, 0.04, c, 1, 16, 0.3, 0, 0, 0, i * 0.01);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.slot(x, y + 0.3, z, Math.cos(a) * r * 0.9, 0.4, Math.sin(a) * r * 0.9, KIND_PUFF, 0.6, 0.3, 1.1, cl, 0.45, -0.2, 2.5);
    }
  }

  /** one falling drip of dye (WELLSPRING leap trail) */
  drip(x: number, y: number, z: number, team: TeamId): void {
    if (this.d2(x, y, z) > 35 * 35) return;
    const s = 0.04 + Math.random() * 0.04;
    this.slot(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3, 0, -1, 0, KIND_BLOB, 0.5, s, s * 0.6, this.col(team), 1, 14, 0.2);
  }

  // ───────────────────────────── per frame ─────────────────────────────
  /** advance the particle clock, upload the written slots, place the projectile drops / models and the beams */
  update(dt: number, camera: THREE.Camera, drops: ProjectileLike | null, alpha: number): void {
    this.time += dt;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.mat.uniforms.uTime.value = this.time;
    (this.mat.uniforms.uSunV.value as THREE.Vector3).copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    this.placePool(drops, alpha, dt);
    this.placeBeams(camera);
    if (this.dirtyN > 0) {
      const lo = this.dirtyLo, n = this.dirtyN;
      for (const at of [this.aPos, this.aVel, this.aNrm, this.aT, this.aCol, this.aPhys]) {
        at.a.clearUpdateRanges();
        if (lo + n <= CAP) at.a.addUpdateRange(lo * at.n, n * at.n);
        else { at.a.addUpdateRange(lo * at.n, (CAP - lo) * at.n); at.a.addUpdateRange(0, (lo + n - CAP) * at.n); }
        at.a.needsUpdate = true;
      }
      this.dirtyN = 0;
    }
  }

  private placeBeams(camera: THREE.Camera): void {
    const cam = camera as THREE.PerspectiveCamera;
    const h = Math.max(1, this.viewHeight);
    const p11 = cam.projectionMatrix.elements[5] || 1;
    this.beamMat.uniforms.uPx.value = 2 / (p11 * h);
    let n = 0;
    const put = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, a: number, col: THREE.Color, minPx: number): void => {
      if (n >= BEAMS) return;
      const A = this.bA.arr, B = this.bB.arr, C = this.bC.arr;
      A[n * 4] = x0; A[n * 4 + 1] = y0; A[n * 4 + 2] = z0; A[n * 4 + 3] = w;
      B[n * 4] = x1; B[n * 4 + 1] = y1; B[n * 4 + 2] = z1; B[n * 4 + 3] = a;
      C[n * 4] = col.r; C[n * 4 + 1] = col.g; C[n * 4 + 2] = col.b; C[n * 4 + 3] = minPx;
      n++;
    };
    let glints = 0, flashes = 0;
    for (const g of this.glints) {
      if (!g.on) continue;
      g.on = false;
      glints++;
      const full = g.c >= 0.999;
      const pulse = full ? 0.85 + 0.15 * Math.sin(this.time * 22) : 1;
      this.tmpC.copy(this.light(g.team)).lerp(this.white, full ? 0.18 : 0);
      put(g.x0, g.y0, g.z0, g.x1, g.y1, g.z1, 0.012 + 0.014 * g.c + (full ? 0.01 : 0), (0.45 + 0.45 * g.c + (full ? 0.2 : 0)) * pulse, this.tmpC,
        1.6 + 1.2 * g.c + (full ? 1.0 : 0));
    }
    for (const f of this.flashes) {
      const k = (this.time - f.t0) / f.life;
      if (k < 0 || k >= 1) continue;
      flashes++;
      const fade = (1 - k) * (1 - k);
      this.tmpC.copy(this.light(f.team)).lerp(this.white, 0.15);
      put(f.x0, f.y0, f.z0, f.x1, f.y1, f.z1, (0.07 + 0.09 * f.c) * (1 - 0.5 * k), fade * 1.4, this.tmpC, (5 + 5 * f.c) * (1 - 0.6 * k));
    }
    this.live.glints = glints; this.live.flashes = flashes;
    this.beamGeo.instanceCount = n;
    if (n > 0) {
      for (const at of [this.bA, this.bB, this.bC]) {
        at.a.clearUpdateRanges();
        at.a.addUpdateRange(0, n * 4);
        at.a.needsUpdate = true;
      }
    }
  }

  private placePool(pool: ProjectileLike | null, alpha: number, dt: number): void {
    const dm = this.drops;
    const n = pool ? pool.count : 0;
    let colorDirty = false;
    let nd = 0;
    this.jelly?.begin(); this.puddle?.begin(); this.cloud?.begin(); this.buoy?.begin();
    let disks = 0, cells = 0, raining = 0;
    for (let i = 0; i < n; i++) {
      const p = pool!;
      const kind = p.kind ? p.kind[i] : P_MIST;
      const t = p.team[i];
      const x0 = p.px[i], y0 = p.py[i], z0 = p.pz[i];
      const x = x0 + (p.x[i] - x0) * alpha, y = y0 + (p.y[i] - y0) * alpha, z = z0 + (p.z[i] - z0) * alpha;
      if (kind === P_JELLY) {
        const st = p.state ? p.state[i] : PSTATE_FLY;
        if (st === PSTATE_PUDDLE && this.puddle) {
          const left = p.timer ? p.timer[i] : JELLY_FUSE_TICKS;
          const u = clamp01(1 - left / JELLY_FUSE_TICKS);
          const w = Math.sin(this.time * (9 + 22 * u)) * (0.05 + 0.1 * u);
          const swell = 1.7 * (1 + 0.28 * u * u);
          this.n3.set(p.nx ? p.nx[i] : 0, p.ny ? p.ny[i] : 1, p.nz ? p.nz[i] : 0);
          if (this.n3.lengthSq() < 1e-6) this.n3.set(0, 1, 0);
          this.q.setFromUnitVectors(Fx.Y, this.n3.normalize());
          this.q2.setFromAxisAngle(Fx.Y, (i * 1.7) % 6.28);
          this.q.multiply(this.q2);
          this.p.set(x, y, z);
          this.s.set(swell * (1 + w), swell * (1 - 1.6 * w) * (1 + 0.6 * u), swell * (1 + w));
          this.m4.compose(this.p, this.q, this.s);
          // its dye core blinks toward white, faster as the fuse runs out (it reads even on its own crew's dye)
          const blink = Math.pow(0.5 + 0.5 * Math.sin(this.time * (8 + 26 * u)), 2) * (0.55 + 0.35 * u);
          this.puddle.pushColor(this.m4, this.tmpC.copy(this.col(t)).lerp(this.white, blink));
          // the warning pulse: a ring out to the blast radius, faster as the fuse runs out
          const f = 2.5 + 7 * u;
          if (dt > 0 && Math.floor(this.time * f) !== Math.floor((this.time - dt) * f) && this.d2(x, y, z) < 50 * 50) {
            this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.34, 0.25, JELLY_BLAST * 0.95, this.light(t), 0.35 + 0.4 * u, 0, 0, this.n3.x, this.n3.y, this.n3.z);
          }
        } else if (this.jelly) {
          const age = p.age ? p.age[i] : this.time;
          this.d.set(p.x[i] - x0, 0, p.z[i] - z0);
          if (this.d.lengthSq() < 1e-8) this.d.set(1, 0, 0);
          this.d.normalize();
          this.n3.set(this.d.z, 0, -this.d.x);           // tumble about the horizontal axis across the flight
          this.q.setFromAxisAngle(this.n3, age * 9);
          this.p.set(x, y, z);
          this.s.set(1.5, 1.5, 1.5);
          this.m4.compose(this.p, this.q, this.s);
          this.jelly.push(this.m4, t);
          // a dye trail behind it
          if (dt > 0 && this.d2(x, y, z) < 40 * 40 && Math.random() < dt * 40) {
            this.slot(x, y, z, 0, 0, 0, KIND_BLOB, 0.28, 0.07, 0.02, this.col(t), 1, 6, 0);
          }
        }
        continue;
      }
      if (kind === P_CLOUD) {
        cells++;
        const st = p.state ? p.state[i] : PSTATE_FLY;
        let scale = 0.35, rain = false, since = 0;
        if (st === PSTATE_HOVER) {
          const left = p.timer ? p.timer[i] : CLOUD_RAIN_TICKS;
          since = (CLOUD_RISE_TICKS + CLOUD_RAIN_TICKS - left) * TICK;
          const k = smooth01(since / (CLOUD_RISE_TICKS * TICK));
          scale = (0.35 + 0.65 * k) * CLOUD_SCALE;
          rain = left <= CLOUD_RAIN_TICKS && left > 0;
        }
        const bob = st === PSTATE_HOVER ? Math.sin(this.time * 1.8 + i) * 0.07 : 0;
        const spin = st === PSTATE_FLY ? this.time * 5 : this.time * 0.25 + i;
        this.p.set(x, y + bob, z);
        this.q.setFromAxisAngle(Fx.Y, spin);
        this.s.set(scale, scale, scale);
        this.m4.compose(this.p, this.q, this.s);
        this.cloud?.push(this.m4, t);
        if (this.buoy) {
          const bo = this.buoyOff;
          this.p.set(x + bo[0] * scale, y + bob + bo[1] * scale, z + bo[2] * scale);
          this.q.setFromAxisAngle(Fx.Y, this.time * 3.2 + i);
          this.m4.compose(this.p, this.q, this.s);
          this.buoy.push(this.m4, t);
        }
        if (st === PSTATE_HOVER) {
          const hx = p.ox ? p.ox[i] : x, hy = p.oy ? p.oy[i] : y, hz = p.oz ? p.oz[i] : z;
          const floorY = hy - CLOUD_HOVER;
          const k = smooth01(since / (CLOUD_RISE_TICKS * TICK));
          if (disks < MODEL_CAP.cloud && (rain || k < 1)) {
            this.p.set(hx, floorY + 0.04, hz);
            this.q.identity();
            const rr = CLOUD_SOAK * (0.3 + 0.7 * k);
            this.s.set(rr, 1, rr);
            this.m4.compose(this.p, this.q, this.s);
            this.disks.setMatrixAt(disks, this.m4);
            this.disks.setColorAt(disks, this.col(t));
            disks++;
          }
          if (rain) { raining++; this.rain(i % 8, x, y + bob + this.rainOff[1], z, floorY, t, dt); }
        }
        continue;
      }
      if (nd >= DROPS) continue;
      this.p.set(x, y, z);
      this.d.set(p.x[i] - x0, p.y[i] - y0, p.z[i] - z0);
      const len = this.d.length();
      const r = DROP_R[kind] ?? DROP_R[0];
      if (len > 1e-5) {
        this.d.multiplyScalar(1 / len);
        this.q.setFromUnitVectors(Fx.Z, this.d);
        this.s.set(r * 0.85, r * 0.85, r * Math.min(kind === P_BURST ? 1.6 : 2.6, 1 + len * 3));
      } else {
        this.q.identity();
        this.s.set(r, r, r);
      }
      this.m4.compose(this.p, this.q, this.s);
      dm.setMatrixAt(nd, this.m4);
      const tc = kind === P_BURST ? t + 8 : t;       // burst balls: the full dye (brighter read), droplets: the light dye
      if (tc !== this.lastDropTeams[nd]) {
        this.lastDropTeams[nd] = tc;
        dm.setColorAt(nd, kind === P_BURST ? this.col(t) : this.light(t));
        colorDirty = true;
      }
      nd++;
    }
    dm.count = nd;
    if (nd > 0) {
      dm.instanceMatrix.clearUpdateRanges();
      dm.instanceMatrix.addUpdateRange(0, nd * 16);
      dm.instanceMatrix.needsUpdate = true;
    }
    if (colorDirty && dm.instanceColor) dm.instanceColor.needsUpdate = true;
    this.jelly?.commit(); this.puddle?.commit(); this.cloud?.commit(); this.buoy?.commit();
    this.disks.count = disks;
    if (disks > 0) {
      this.disks.instanceMatrix.needsUpdate = true;
      if (this.disks.instanceColor) this.disks.instanceColor.needsUpdate = true;
    }
    this.live.drops = nd; this.live.jelly = this.jelly?.n ?? 0; this.live.puddles = this.puddle?.n ?? 0;
    this.live.cells = cells; this.live.raining = raining;
  }

  /** CLOUDBURST rain: streaks from the cell's belly over the soak disk down to the floor */
  private rain(slot: number, x: number, y: number, z: number, floorY: number, team: number, dt: number): void {
    const d2 = this.d2(x, y, z);
    if (d2 > 70 * 70) return;
    const rate = d2 < 35 * 35 ? 170 : 60;
    this.rainAcc[slot] += rate * dt;
    const fall = Math.max(0.5, y - floorY);
    const v = 11;
    const cl = this.light(team);
    let guard = 12;
    while (this.rainAcc[slot] >= 1 && guard-- > 0) {
      this.rainAcc[slot] -= 1;
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * CLOUD_SOAK * 0.92;
      this.slot(x + Math.cos(a) * rr, y - 0.1, z + Math.sin(a) * rr, 0, -v, 0, KIND_SPARK, fall / v, 0.13, 0.13, cl, 1, 0, 0);
    }
    if (this.rainAcc[slot] > 4) this.rainAcc[slot] = 0;
  }

  /** kill every live particle (match restart) */
  clear(): void {
    for (let i = 0; i < CAP; i++) { this.aT.arr[i * 4] = -1e6; this.aT.arr[i * 4 + 1] = 0.001; }
    this.aT.a.clearUpdateRanges();
    this.aT.a.needsUpdate = true;
    this.dirtyN = 0;
    this.drops.count = 0;
    for (const g of this.glints) g.on = false;
    for (const f of this.flashes) f.t0 = -1e6;
    this.beamGeo.instanceCount = 0;
  }

  dispose(): void {
    this.drops.geometry.dispose();
    (this.drops.material as THREE.Material).dispose();
    this.particles.geometry.dispose();
    this.mat.dispose();
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.disks.geometry.dispose();
    (this.disks.material as THREE.Material).dispose();
    for (const pool of [this.jelly, this.puddle, this.cloud, this.buoy]) pool?.dispose();
    this.root.removeFromParent();
  }
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth01(v: number): number { const t = clamp01(v); return t * t * (3 - 2 * t); }
