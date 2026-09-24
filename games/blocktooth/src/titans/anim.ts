// BLOCKTOOTH — procedural titan animation (lane titan-view; CONTRACT §6).
//
// One TitanAnimator per mounted model. Everything is procedural and driven by AnimState:
//   * gaits phase-locked to distance travelled (body-heights), feet PLANTED by analytic 2-bone IK
//     (the foot target lives in model space, so bob / lean / rear-up never make feet skate or sink),
//   * MOLO: sprawling diagonal-pair walk with a lateral spine + tail S-wave,
//     VOLT-KITE: bounding trot with a suspension beat, HEARTHBACK: slow lateral-sequence stomp with
//     shell sway, BRIARWICK: lumbering amble with shoulder roll,
//   * idle breathing, blinks, tail sway, look-around, turn lean,
//   * attack poses keyed to attack id + attackT, dash stretch, hurt flinch + white flash, per-kit
//     ability poses, rank-up squash-and-stretch, a death slump and a portrait "hero" pose.
// Time fields in AnimState are "seconds SINCE the thing started" (< 0 = inactive).
// No per-frame allocation: all scratch math objects are module-level and reused.

import * as THREE from 'three';
import type { TitanId } from '../core/types.ts';
import type { LegDef, TitanModel } from './models.ts';

export interface AnimState {
  /** 0..1 of the titan's current top speed */
  speed01: number;
  moving: boolean;
  /** signed turn rate (rad/s); + = heading increasing = turning toward the titan's left (+X) */
  turn: number;
  /** auto-attack id from the last `titanAttack` event ('curbBite' | 'forkArc' | 'magmaStomp' | 'vineLash') */
  attack: string | null;
  /** seconds since that attack started (< 0 = none) */
  attackT: number;
  /** seconds since the dash started (< 0 = none; a dash lasts 0.22 s) */
  dashT: number;
  /** seconds since the last hit landed (< 0 = none) */
  hurtT: number;
  /** seconds since the hook ability fired (< 0 = none) */
  abilityT: number;
  /** seconds since the last rank-up (< 0 = none; the sim grow tween lasts 0.9 s) */
  growT: number;
  /** cosmetic clock (s) */
  t: number;
  /** titan.kit (read-only): molo vacuumT/vacAfterT/headTurn · voltkite wires · hearthback stored/cap/stompT · briarwick sowT/turrets */
  kit: Record<string, number>;
  // ── optional lane extras ──
  /** actual ground speed in body-heights per second (phase-locks the gait). Default: speed01 × 2.5 */
  speedH?: number;
  /** 0..1 severity of the last hit (flinch size) */
  hurtAmt?: number;
  /** settings.reduceFlashing: no white flash */
  noFlash?: boolean;
  /** seconds since death (undefined / < 0 = alive) — drives the DEFEAT pose: stagger, topple onto
   *  the side (see `downSide`), bounce, eyes shut, legs out stiff (cartoon, never gory) */
  deadT?: number;
  /** which flank the defeated titan lands on: +1 = its right (-X, the default), -1 = its left */
  downSide?: number;
  /** seconds since the run was CLEARED (undefined / < 0 = no) — the victory roar (rear up, jaw wide, crest flared) */
  clearT?: number;
  /** 0..1 portrait hero pose */
  hero?: number;
  /** yaw (rad, titan-relative, + = left) the head should look toward, e.g. the auto-attack aim */
  aim?: number;
}

interface GaitCfg {
  /** body-heights travelled per full gait cycle */
  stride: number;
  /** stance fraction while walking / at full speed */
  dutyWalk: number; dutyRun: number;
  /** phase offset per leg */
  offs: Record<string, number>;
  /** foot lift (body-heights) */
  lift: number;
  /** vertical bob amplitude and bobs per cycle */
  bob: number; bobN: number;
  /** lateral spine S-wave (MOLO) */
  spineYaw: number;
  /** tail wave amplitude and per-joint phase lag */
  tailWave: number; tailLag: number;
  /** body roll per cycle (amble / shell sway) */
  roll: number;
  /** body pitch rock per cycle (bounding) */
  rock: number;
  /** turn lean (rad per rad/s) */
  lean: number;
  /** breathing depth */
  breath: number;
  /** head counter-stabilisation (0 = head rides the chest, 1 = head holds still) */
  headStab: number;
  /** cycles/s cap: beyond it the stride stretches instead (keeps tiny titans from blurring) */
  maxCadence: number;
}

const GAITS: Record<TitanId, GaitCfg> = {
  molo: {
    stride: 0.7, dutyWalk: 0.64, dutyRun: 0.5, offs: { legFL: 0, legBR: 0.03, legFR: 0.5, legBL: 0.53 },
    lift: 0.09, bob: 0.014, bobN: 2, spineYaw: 0.17, tailWave: 0.24, tailLag: 0.75, roll: 0.03, rock: 0,
    lean: 0.05, breath: 0.022, headStab: 0.7, maxCadence: 5.5,
  },
  voltkite: {
    stride: 1.1, dutyWalk: 0.5, dutyRun: 0.36, offs: { legFL: 0, legBR: 0.1, legFR: 0.5, legBL: 0.6 },
    lift: 0.13, bob: 0.03, bobN: 2, spineYaw: 0.03, tailWave: 0.12, tailLag: 0.55, roll: 0.02, rock: 0.05,
    lean: 0.07, breath: 0.018, headStab: 0.55, maxCadence: 4.4,
  },
  hearthback: {
    stride: 0.45, dutyWalk: 0.74, dutyRun: 0.55, offs: { legBL: 0, legFL: 0.25, legBR: 0.5, legFR: 0.75 },
    lift: 0.075, bob: 0.012, bobN: 4, spineYaw: 0, tailWave: 0.1, tailLag: 0.5, roll: 0.045, rock: 0,
    lean: 0.03, breath: 0.012, headStab: 0.4, maxCadence: 6.6,
  },
  briarwick: {
    stride: 0.7, dutyWalk: 0.68, dutyRun: 0.52, offs: { legBL: 0, legFL: 0.18, legBR: 0.5, legFR: 0.68 },
    lift: 0.1, bob: 0.02, bobN: 2, spineYaw: 0.02, tailWave: 0.1, tailLag: 0.5, roll: 0.055, rock: 0.02,
    lean: 0.05, breath: 0.02, headStab: 0.5, maxCadence: 5,
  },
};

// ─────────────────────────────── helpers ───────────────────────────────
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sat = (v: number) => clamp(v, 0, 1);
const smooth = (t: number) => { const u = sat(t); return u * u * (3 - 2 * u); };
const frac = (v: number) => v - Math.floor(v);
/** finite or default */
const fin = (v: number | undefined, d: number) => (v !== undefined && Number.isFinite(v) ? v : d);
const EMPTY_KIT: Record<string, number> = {};
/** attack envelope: 0 before a, rises to 1 at b, holds to c, falls to 0 at d */
function env(t: number, a: number, b: number, c: number, d: number): number {
  if (t < a || t > d) return 0;
  if (t < b) return smooth((t - a) / Math.max(1e-4, b - a));
  if (t <= c) return 1;
  return 1 - smooth((t - c) / Math.max(1e-4, d - c));
}
/** exponential approach factor for a time constant */
const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

// scratch (module-level, never reallocated)
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _pp = new THREE.Vector3(), _ps = new THREE.Vector3(), _pq = new THREE.Quaternion(), _pqi = new THREE.Quaternion();
const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _b = new THREE.Vector3(), _k = new THREE.Vector3(), _e = new THREE.Vector3();
const _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3(), _pole = new THREE.Vector3();
const _v0 = new THREE.Vector3(), _w0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _w1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qf = new THREE.Quaternion();
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** topple transform (model space) applied to the leg IK targets so the legs go down WITH the body */
const _topM = new THREE.Matrix4(), _topR = new THREE.Matrix4();

/**
 * DEFEAT timeline (seconds since death). The app photographs the aftermath at END_DELAY_S = 2.5 s
 * (game.ts), so the whole fall — stagger, topple, bounce, settle — must land well before that.
 */
export const DEFEAT = {
  /** knees buckle + dizzy wobble */
  staggerEnd: 0.4,
  /** the topple starts (overlaps the end of the stagger) */
  toppleStart: 0.32,
  /** flank hits the ground — the view kicks its dust skirt here */
  impact: 0.9,
  /** resting roll (rad): on the flank, belly turned up a little, legs out */
  roll: 1.42,
} as const;

/** rotation that carries the frame (u0, p0⊥u0) onto (u1, p1⊥u1) */
function basisRot(u0: THREE.Vector3, p0: THREE.Vector3, u1: THREE.Vector3, p1: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _v0.copy(p0).addScaledVector(u0, -p0.dot(u0));
  if (_v0.lengthSq() < 1e-10) _v0.set(0, 0, 1).addScaledVector(u0, -u0.z);
  _v0.normalize();
  _w0.crossVectors(u0, _v0);
  _v1.copy(p1).addScaledVector(u1, -p1.dot(u1));
  if (_v1.lengthSq() < 1e-10) _v1.copy(_v0);
  _v1.normalize();
  _w1.crossVectors(u1, _v1);
  _m0.makeBasis(u0, _w0, _v0).transpose();
  _m1.makeBasis(u1, _w1, _v1).multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

interface LegRt {
  def: LegDef;
  up: THREE.Bone; low: THREE.Bone; foot: THREE.Bone; parent: THREE.Bone;
  hip: THREE.Vector3;         // hip position in parent space (up.position at rest)
  l1: number; l2: number;
  u0: THREE.Vector3;          // rest knee direction (upper-bone local)
  u0L: THREE.Vector3;         // rest ankle direction (lower-bone local)
  pole: THREE.Vector3;        // rest bend direction (model-aligned)
  lastBend: THREE.Vector3;
  ankle: THREE.Vector3;       // rest ankle, model space
  off: number;
  target: THREE.Vector3;
}

interface Channels {
  bodyX: number; bodyY: number; bodyZ: number; bodyPitch: number; bodyRoll: number; bodyYaw: number;
  chestPitch: number; chestYaw: number; hipsPitch: number; hipsYaw: number;
  neckPitch: number; neckYaw: number; neckZ: number; headPitch: number; headYaw: number; headRoll: number; jaw: number;
  tailLift: number; tailYaw: number; tailCurl: number; tailStiff: number;
  sq: number; st: number;
  frontLift: number; frontReach: number; hindLift: number; hindReach: number; feetOut: number;
  eyeClose: number; breath: number; throat: number;
  /** DEFEAT topple: roll (rad) about the model's forward axis, pivoting on the down-side foot edge */
  topple: number;
  mane: number; ears: number; wings: number;
  shellY: number; shellPitch: number; shellRoll: number; shellScale: number; crater: number;
  ruff: number; flash: number;
}
function zeroChannels(c: Channels): void {
  c.bodyX = 0; c.bodyY = 0; c.bodyZ = 0; c.bodyPitch = 0; c.bodyRoll = 0; c.bodyYaw = 0;
  c.chestPitch = 0; c.chestYaw = 0; c.hipsPitch = 0; c.hipsYaw = 0;
  c.neckPitch = 0; c.neckYaw = 0; c.neckZ = 0; c.headPitch = 0; c.headYaw = 0; c.headRoll = 0; c.jaw = 0;
  c.tailLift = 0; c.tailYaw = 0; c.tailCurl = 0; c.tailStiff = 0;
  c.sq = 1; c.st = 1;
  c.frontLift = 0; c.frontReach = 0; c.hindLift = 0; c.hindReach = 0; c.feetOut = 0;
  c.eyeClose = 0; c.breath = 0; c.throat = 1;
  c.topple = 0;
  c.mane = 1; c.ears = 0; c.wings = 0;
  c.shellY = 0; c.shellPitch = 0; c.shellRoll = 0; c.shellScale = 1; c.crater = 1;
  c.ruff = 1; c.flash = 0;
}

// ─────────────────────────────── animator ───────────────────────────────
export class TitanAnimator {
  private readonly model: TitanModel;
  private readonly id: TitanId;
  private readonly g: GaitCfg;
  private readonly bone: Record<string, THREE.Bone | undefined> = {};
  private readonly restPos = new Map<THREE.Bone, THREE.Vector3>();
  private readonly legs: LegRt[] = [];
  private readonly tail: THREE.Bone[] = [];
  private readonly ch: Channels = {} as Channels;
  private phase = 0;
  private gaitW = 0;
  private spd = 0;
  private turnS = 0;
  private aimS = 0;
  private duty = 0.6;
  // blinks + cosmetic randomness (deterministic per titan so snapshots are reproducible)
  private seed: number;
  private blinkIn = 1.6;
  private blinkT = -1;
  private blinkDouble = false;
  private lookT = 0; private lookYaw = 0; private lookPitch = 0; private lookYawS = 0; private lookPitchS = 0;
  private earT = 0.8; private earFlick = -1; private earSide = 1;
  // attack bookkeeping
  private lastAttackT = -1;
  private windup = 0.6;
  private flinchSign = 1;
  private lastHurtT = -1;
  /** sanitised copy of the caller's AnimState (reused every frame, never reallocated) */
  private readonly s: AnimState & { speedH: number; hurtAmt: number; deadT: number; hero: number; aim: number; downSide: number; clearT: number } = {
    speed01: 0, moving: false, turn: 0, attack: null, attackT: -1, dashT: -1, hurtT: -1, abilityT: -1, growT: -1, t: 0, kit: {},
    speedH: 0, hurtAmt: 0.6, noFlash: false, deadT: -1, hero: 0, aim: 0, downSide: 1, clearT: -1,
  };
  /** half the footprint width (height-1 units): the topple pivots on that foot edge */
  private readonly halfW: number;

  constructor(model: TitanModel, id: TitanId) {
    this.model = model;
    this.id = id;
    this.g = GAITS[id];
    let s = 0x9e3779b9;
    for (let i = 0; i < id.length; i++) s = Math.imul(s ^ id.charCodeAt(i), 0x01000193) >>> 0;
    this.seed = s || 1;
    this.halfW = Math.max(0.1, (model.size?.width ?? 0.6) * 0.5);
    for (const name in model.joints) {
      const b = model.joints[name] as THREE.Bone;
      this.bone[name] = b;
      b.rotation.order = 'YXZ';
      this.restPos.set(b, b.position.clone());
    }
    for (const n of model.tail) { const b = this.bone[n]; if (b) this.tail.push(b); }
    for (const def of model.legs) {
      const up = this.bone[def.up], low = this.bone[def.low], foot = this.bone[def.foot], parent = this.bone[def.parent];
      if (!up || !low || !foot || !parent) continue;
      const hip = up.position.clone();
      const l1 = low.position.length(), l2 = foot.position.length();
      const pole = new THREE.Vector3(def.pole[0], def.pole[1], def.pole[2]).normalize();
      this.legs.push({
        def, up, low, foot, parent, hip, l1, l2,
        u0: low.position.clone().normalize(), u0L: foot.position.clone().normalize(),
        pole, lastBend: pole.clone(),
        ankle: model.rest[def.foot].clone(),
        off: this.g.offs[def.name] ?? 0,
        target: new THREE.Vector3(),
      });
    }
    zeroChannels(this.ch);
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(input: AnimState, dt: number): void {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    // Sanitise every numeric input into a private copy (a single NaN from upstream must never
    // poison the smoothed state or the skeleton), and self-heal internal state if it ever broke.
    const a = this.sanitize(input);
    if (!Number.isFinite(this.spd + this.turnS + this.phase + this.gaitW + this.aimS + this.duty)) {
      this.spd = 0; this.turnS = 0; this.phase = 0; this.gaitW = 0; this.aimS = 0; this.duty = this.g.dutyWalk;
    }
    const g = this.g, c = this.ch, kit = a.kit;
    zeroChannels(c);
    const dead = a.deadT !== undefined && a.deadT >= 0;

    // ── smoothed locomotion inputs ──
    const speedH = dead ? 0 : Math.max(0, a.speedH ?? a.speed01 * 2.5);
    this.spd += (speedH - this.spd) * approach(dt, 0.1);
    this.turnS += ((dead ? 0 : clamp(a.turn, -6, 6)) - this.turnS) * approach(dt, 0.18);
    const moveW = sat(this.spd / 0.25);
    this.gaitW += ((a.moving || this.spd > 0.12 ? moveW : 0) - this.gaitW) * approach(dt, 0.12);
    const s01 = sat(a.speed01);
    this.duty += (g.dutyWalk + (g.dutyRun - g.dutyWalk) * s01 - this.duty) * approach(dt, 0.3);
    const dashing = a.dashT >= 0 && a.dashT < 0.22;
    let cadence = this.spd / g.stride + Math.abs(this.turnS) * 0.18 * (1 - moveW);
    if (cadence > g.maxCadence) cadence = g.maxCadence;
    if (dashing) cadence *= 0.25;
    this.phase = frac(this.phase + cadence * dt);
    const stride = cadence > 1e-4 ? Math.min(this.spd / cadence, g.stride * 1.35) : g.stride;
    const gw = this.gaitW;
    const cyc = this.phase * Math.PI * 2;

    // ── gait body motion ──
    c.bodyY -= g.bob * gw * (0.5 - 0.5 * Math.cos(cyc * g.bobN)) * (0.6 + 0.4 * s01);
    c.bodyRoll += g.roll * gw * Math.sin(cyc);
    c.bodyPitch += g.rock * gw * Math.sin(cyc * 2) * s01;
    c.chestYaw += g.spineYaw * gw * Math.sin(cyc);
    c.hipsYaw -= g.spineYaw * gw * Math.sin(cyc);
    c.neckYaw -= g.spineYaw * gw * Math.sin(cyc) * g.headStab;
    c.headPitch += g.bob * gw * 1.5 * Math.cos(cyc * g.bobN) * (1 - g.headStab);
    c.tailYaw += 0;   // per-joint wave applied below
    if (this.id === 'hearthback') {
      c.shellRoll += 0.035 * gw * Math.sin(cyc * 2);
      c.shellPitch += 0.02 * gw * Math.sin(cyc * 4);
    }
    // turn lean: roll into the turn, head leads, tail swings out
    const tn = clamp(this.turnS, -4, 4);
    c.bodyRoll -= g.lean * tn * (0.4 + 0.6 * moveW);
    c.neckYaw += 0.08 * tn;
    c.headYaw += 0.06 * tn;
    c.tailYaw -= 0.07 * tn;

    // ── idle life ──
    const t = a.t;
    const br = Math.sin(t * 2 * Math.PI / 3.1);
    c.breath = br * g.breath;
    c.bodyY += br * g.breath * 0.25;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.4 + this.rand() * 2.8;
      this.lookYaw = (this.rand() - 0.5) * 0.7;
      this.lookPitch = (this.rand() - 0.5) * 0.18;
    }
    this.lookYawS += (this.lookYaw - this.lookYawS) * approach(dt, 0.45);
    this.lookPitchS += (this.lookPitch - this.lookPitchS) * approach(dt, 0.45);
    const idleW = 1 - gw;
    const aim = clamp(a.aim ?? 0, -1.2, 1.2);
    this.aimS += (aim - this.aimS) * approach(dt, 0.07);
    c.neckYaw += this.lookYawS * idleW * 0.45 + this.aimS * 0.45;
    c.headYaw += this.lookYawS * idleW * 0.55 + this.aimS * 0.4;
    c.headPitch += this.lookPitchS * idleW;
    c.tailYaw += Math.sin(t * 0.9) * 0.1 * (0.4 + 0.6 * idleW);
    // blinks (occasionally double)
    this.blinkIn -= dt;
    if (this.blinkIn <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkDouble = this.rand() < 0.25;
      this.blinkIn = 2.2 + this.rand() * 3.4;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b1 = env(this.blinkT, 0, 0.05, 0.07, 0.14);
      const b2 = this.blinkDouble ? env(this.blinkT, 0.2, 0.25, 0.27, 0.34) : 0;
      c.eyeClose = Math.max(b1, b2);
      if (this.blinkT > 0.4) this.blinkT = -1;
    }
    // ear twitch (VOLT-KITE)
    this.earT -= dt;
    if (this.earT <= 0) { this.earT = 1.2 + this.rand() * 3; this.earFlick = 0; this.earSide = this.rand() < 0.5 ? 1 : -1; }
    if (this.earFlick >= 0) { this.earFlick += dt; if (this.earFlick > 0.3) this.earFlick = -1; }

    // ── per-kit idle extras ──
    if (this.id === 'voltkite') { c.mane = 1 + 0.035 * Math.sin(t * 13) * Math.sin(t * 3.1); c.wings = 0.06 * Math.sin(t * 1.7); }
    if (this.id === 'hearthback') { c.crater = 1 + 0.03 * Math.sin(t * 4.3); c.shellY += 0.004 * br; }
    if (this.id === 'briarwick') { c.ruff = 1 + 0.02 * br; }

    // ── overlays: attack, dash, hurt, ability, grow, hero, death ──
    this.attackPose(a, kit);
    this.dashPose(a);
    this.abilityPose(a, kit);
    this.growPose(a);
    this.hurtPose(a);
    if (a.hero && a.hero > 0) this.heroPose(a.hero);
    if (fin(a.clearT, -1) >= 0 && !dead) this.victoryPose(a.clearT!);
    if (dead) this.deathPose(a.deadT ?? 0);

    // ── write bones ──
    this.writeSpine(cyc, gw);
    this.solveLegs(cyc, gw, stride, dashing);
    this.writeFlash(a);
  }

  private sanitize(a: AnimState): AnimState {
    const s = this.s;
    const timer = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : -1);
    s.speed01 = fin(a.speed01, 0);
    s.moving = a.moving === true;
    s.turn = fin(a.turn, 0);
    s.attack = typeof a.attack === 'string' ? a.attack : null;
    s.attackT = timer(a.attackT);
    s.dashT = timer(a.dashT);
    s.hurtT = timer(a.hurtT);
    s.abilityT = timer(a.abilityT);
    s.growT = timer(a.growT);
    s.t = fin(a.t, 0);
    s.kit = a.kit ?? EMPTY_KIT;
    s.speedH = a.speedH !== undefined && Number.isFinite(a.speedH) ? a.speedH : s.speed01 * 2.5;
    s.hurtAmt = fin(a.hurtAmt, 0.6);
    s.noFlash = a.noFlash === true;
    s.deadT = timer(a.deadT);
    s.downSide = fin(a.downSide, 1) < 0 ? -1 : 1;
    s.clearT = timer(a.clearT);
    s.hero = fin(a.hero, 0);
    s.aim = a.aim !== undefined && Number.isFinite(a.aim) ? a.aim : fin(s.kit.headTurn, 0);
    return s;
  }

  // ─────────────── overlays ───────────────
  private attackPose(a: AnimState, kit: Record<string, number>): void {
    const c = this.ch;
    if (!a.attack || a.attackT < 0) { this.lastAttackT = -1; return; }
    const t = a.attackT;
    if (t < this.lastAttackT || this.lastAttackT < 0) {
      // new attack: latch the hearthback stomp windup from the kit
      this.windup = kit.stompT && kit.stompT > 0.05 ? kit.stompT + t : 0.6;
    }
    this.lastAttackT = t;
    switch (a.attack) {
      case 'curbBite': {             // MOLO: jaw gapes, head snaps forward, jaw slams shut
        const open = env(t, 0, 0.045, 0.07, 0.12);
        const lunge = env(t, 0.03, 0.09, 0.13, 0.42);
        c.jaw += 0.75 * open;
        c.headPitch -= 0.22 * open;
        c.neckPitch += 0.12 * lunge;
        c.headPitch += 0.1 * lunge;
        c.neckZ += 0.07 * lunge;
        c.bodyZ += 0.05 * lunge;
        c.chestPitch += 0.05 * lunge;
        c.frontReach += 0.03 * lunge;
        c.sq *= 1 - 0.03 * lunge;
        break;
      }
      case 'forkArc': {              // VOLT-KITE: mane flares, head thrusts, jaw crackles open
        const flare = env(t, 0, 0.06, 0.12, 0.45);
        const thrust = env(t, 0.02, 0.08, 0.14, 0.4);
        c.mane *= 1 + 0.55 * flare;
        c.ears -= 0.7 * flare;
        c.neckPitch -= 0.15 * thrust;
        c.headPitch += 0.18 * thrust;
        c.neckZ += 0.05 * thrust;
        c.jaw += 0.4 * thrust;
        c.bodyY -= 0.02 * thrust;
        c.tailLift += 0.12 * flare;
        c.wings += 0.35 * flare;
        break;
      }
      case 'magmaStomp': {           // HEARTHBACK: rear up through the windup, slam on fire, shell jiggles
        const W = clamp(this.windup, 0.25, 1.4);
        const rear = t < W - 0.08 ? smooth(t / Math.max(0.1, W - 0.08)) : 1 - smooth((t - (W - 0.08)) / 0.08);
        const after = t > W ? t - W : -1;
        c.bodyPitch -= 0.3 * rear;
        c.bodyY += 0.05 * rear;
        c.bodyZ -= 0.03 * rear;
        c.frontLift += 0.2 * rear;
        c.frontReach += 0.04 * rear;
        c.headPitch -= 0.25 * rear;
        c.jaw += 0.25 * rear;
        if (after >= 0 && after < 0.6) {
          const k = Math.exp(-after * 7);
          c.sq *= 1 - 0.08 * k;
          c.shellRoll += 0.08 * Math.sin(after * 38) * k;
          c.shellPitch += 0.06 * Math.sin(after * 31 + 1) * k;
          c.shellY -= 0.02 * k;
          c.bodyPitch += 0.06 * k;
          c.crater *= 1 + 0.25 * k;
        }
        break;
      }
      case 'vineLash': {             // BRIARWICK: horns wind up to one side, then sweep through
        const wind = env(t, 0, 0.08, 0.1, 0.2);
        const sweep = env(t, 0.08, 0.22, 0.26, 0.55);
        const dir = t < 0.16 ? 1 : 1 - 2 * smooth((t - 0.1) / 0.14);
        c.headYaw += 0.55 * dir * Math.max(wind, sweep);
        c.neckYaw += 0.3 * dir * Math.max(wind, sweep);
        c.neckPitch += 0.14 * sweep;
        c.headRoll -= 0.2 * dir * sweep;
        c.bodyRoll += 0.05 * dir * sweep;
        c.jaw += 0.2 * sweep;
        c.frontReach += 0.03 * sweep;
        break;
      }
      default: {                     // generic swipe (upgrades / unknown attack ids)
        const k = env(t, 0, 0.06, 0.1, 0.35);
        c.headPitch += 0.12 * k; c.jaw += 0.35 * k; c.neckZ += 0.04 * k;
      }
    }
  }

  private dashPose(a: AnimState): void {
    const c = this.ch;
    if (a.dashT < 0 || a.dashT > 0.5) return;
    const t = a.dashT;
    const fly = env(t, 0, 0.04, 0.2, 0.26);
    const land = env(t, 0.2, 0.26, 0.28, 0.46);
    c.st *= 1 + 0.18 * fly;
    c.sq *= (1 - 0.08 * fly) * (1 - 0.1 * land);
    c.bodyPitch += 0.06 * fly;
    c.bodyY -= 0.02 * fly + 0.03 * land;
    c.frontReach += 0.22 * fly;
    c.hindReach -= 0.2 * fly;
    c.frontLift += 0.07 * fly;
    c.hindLift += 0.05 * fly;
    c.tailStiff = Math.max(c.tailStiff, fly);
    c.tailLift += 0.12 * fly;
    c.ears -= 0.8 * fly;
    c.wings += 0.5 * fly;
    c.mane *= 1 + 0.2 * fly;
    c.neckPitch += 0.08 * fly;
  }

  private hurtPose(a: AnimState): void {
    const c = this.ch;
    if (a.hurtT < 0 || a.hurtT > 0.45) { this.lastHurtT = -1; return; }
    const t = a.hurtT;
    if (this.lastHurtT < 0 || t < this.lastHurtT) this.flinchSign = this.rand() < 0.5 ? -1 : 1;
    this.lastHurtT = t;
    const amt = clamp(a.hurtAmt ?? 0.6, 0.25, 1);
    const k = env(t, 0, 0.035, 0.06, 0.4) * amt;
    c.bodyPitch -= 0.12 * k;
    c.bodyRoll += 0.1 * k * this.flinchSign;
    c.bodyZ -= 0.04 * k;
    c.headPitch -= 0.28 * k;
    c.headYaw += 0.2 * k * this.flinchSign;
    c.jaw += 0.3 * k;
    c.eyeClose = Math.max(c.eyeClose, env(t, 0, 0.02, 0.12, 0.2));
    c.sq *= 1 - 0.05 * k;
    c.tailLift += 0.1 * k;
    c.ears -= 0.6 * k;
    c.flash = t < 0.14 ? 1 - t / 0.14 : 0;
  }

  private abilityPose(a: AnimState, kit: Record<string, number>): void {
    const c = this.ch;
    const t = a.abilityT;
    switch (this.id) {
      case 'molo': {                 // GULLET VACUUM: jaw wide, inhale, braced; then a gulp
        const channel = (kit.vacuumT ?? 0) > 0 ? 1 : 0;
        const k = t >= 0 && t < 1.35 ? env(t, 0, 0.12, 1.15, 1.3) : 0;
        const v = Math.max(channel, k);
        if (v > 0) {
          const flutter = Math.sin(a.t * 34) * 0.5 + 0.5;
          c.jaw += 0.85 * v;
          c.headPitch -= 0.12 * v;
          c.neckPitch += 0.12 * v;
          c.neckZ += 0.03 * v;
          c.throat *= 1 + (0.14 + 0.05 * flutter) * v;
          c.breath += 0.05 * v;
          c.bodyY -= 0.03 * v;
          c.feetOut += 0.05 * v;
          c.tailStiff = Math.max(c.tailStiff, v * 0.7);
          c.tailLift += 0.06 * v;
          c.eyeClose = Math.max(c.eyeClose, 0.35 * v);
        }
        const after = (kit.vacAfterT ?? 0) > 0 || (t >= 1.2 && t < 1.7);
        if (after && channel === 0) {
          const gt = t >= 1.2 ? t - 1.2 : 0.2;
          const gulp = env(gt, 0, 0.06, 0.12, 0.45);
          c.sq *= 1 + 0.06 * gulp;
          c.throat *= 1 + 0.2 * env(gt, 0, 0.05, 0.1, 0.3);
          c.headPitch -= 0.1 * gulp;
        }
        break;
      }
      case 'voltkite': {             // RECAST: DETONATE — crouch, then a mane-blazing howl
        if (t < 0 || t > 0.8) break;
        const crouch = env(t, 0, 0.06, 0.08, 0.16);
        const howl = env(t, 0.08, 0.16, 0.42, 0.75);
        c.bodyY -= 0.05 * crouch;
        c.sq *= 1 - 0.08 * crouch;
        c.neckPitch -= 0.35 * howl;
        c.headPitch -= 0.3 * howl;
        c.jaw += 0.55 * howl;
        c.mane *= 1 + 0.8 * Math.max(howl, crouch * 0.5);
        c.ears -= 0.9 * howl;
        c.wings += 0.9 * howl;
        c.tailLift += 0.25 * howl;
        c.bodyPitch -= 0.06 * howl;
        break;
      }
      case 'hearthback': {           // SHELL VENT — squat, shell heaves, crater flares, head tucks
        if (t < 0 || t > 1.0) break;
        const heave = env(t, 0, 0.08, 0.22, 0.8);
        const pop = t < 0.9 ? Math.exp(-t * 5) : 0;
        c.bodyY -= 0.05 * heave;
        c.sq *= 1 - 0.06 * heave;
        c.shellY += 0.07 * heave;
        c.shellScale *= 1 + 0.06 * heave;
        c.shellRoll += 0.05 * Math.sin(t * 40) * pop;
        c.crater *= 1 + 0.45 * heave;
        c.neckZ -= 0.1 * heave;
        c.headPitch += 0.12 * heave;
        c.eyeClose = Math.max(c.eyeClose, 0.6 * heave);
        c.feetOut += 0.03 * heave;
        break;
      }
      case 'briarwick': {            // SOW — ruff blooms, stamp, proud head raise
        const cloud = (kit.sowT ?? 0) > 0 ? 1 : 0;
        if ((t < 0 || t > 1.3) && !cloud) break;
        const tt = t < 0 ? 1 : t;
        const bloom = Math.max(env(tt, 0, 0.14, 0.9, 1.25), cloud * 0.6);
        const stamp = env(tt, 0.02, 0.1, 0.12, 0.22);
        const proud = env(tt, 0.2, 0.4, 0.8, 1.2);
        c.ruff *= 1 + 0.5 * bloom;
        c.frontLift += 0.1 * stamp;
        c.bodyPitch -= 0.08 * stamp - 0.04 * env(tt, 0.2, 0.24, 0.26, 0.4);
        c.headPitch -= 0.25 * proud - 0.2 * stamp;
        c.jaw += 0.25 * proud;
        c.neckPitch -= 0.1 * proud;
        break;
      }
    }
  }

  private growPose(a: AnimState): void {
    const c = this.ch;
    if (a.growT < 0 || a.growT > 1.4) return;
    const t = a.growT;
    const wob = Math.sin(t * Math.PI * 3.4) * Math.exp(-t * 2.4);
    c.sq *= 1 + 0.16 * wob;
    c.st *= 1 - 0.06 * wob;
    const roar = env(t, 0.15, 0.3, 0.85, 1.25);
    c.headPitch -= 0.35 * roar;
    c.neckPitch -= 0.15 * roar;
    c.jaw += 0.7 * roar;
    c.bodyPitch -= 0.08 * roar;
    c.mane *= 1 + 0.6 * roar;
    c.ruff *= 1 + 0.3 * roar;
    c.crater *= 1 + 0.3 * roar;
    c.tailLift += 0.15 * roar;
    c.eyeClose = Math.max(c.eyeClose, 0.5 * roar);
  }

  private heroPose(h: number): void {
    const c = this.ch;
    c.bodyPitch -= 0.05 * h;
    c.headPitch -= 0.1 * h;
    c.neckPitch -= 0.05 * h;
    c.jaw += 0.2 * h;
    c.tailCurl += 0.45 * h;
    c.mane *= 1 + 0.25 * h;
    c.ruff *= 1 + 0.1 * h;
    c.crater *= 1 + 0.1 * h;
    c.ears += 0.1 * h;
    c.wings += 0.25 * h;
    c.eyeClose = 0;
  }

  /**
   * DEFEAT (F18): the knees buckle and the head wobbles (dizzy, eyes half shut), then the titan
   * topples onto its flank (accelerating, like a felled tree), lands with a bounce the view dusts
   * over (DEFEAT.impact), and lies there legs-out and stiff, eyes shut, jaw slack, crest deflated,
   * with one comic tail twitch. Cartoon — nothing breaks, nothing bleeds.
   */
  private deathPose(t: number): void {
    const c = this.ch, D = DEFEAT;
    const side = this.s.downSide;
    // 1. stagger
    const k1 = smooth(t / D.staggerEnd);
    const wob = Math.sin(t * 15) * (1 - smooth((t - 0.1) / 0.5)) * k1;
    c.bodyY -= 0.07 * k1;
    c.sq *= 1 - 0.07 * k1;
    c.bodyRoll += 0.09 * wob;
    c.headRoll += 0.3 * wob;
    c.headPitch += 0.22 * k1;
    c.neckPitch += 0.18 * k1;
    c.jaw += 0.3 * k1;
    c.eyeClose = Math.max(c.eyeClose, 0.55 * k1);
    c.ears += 0.5 * k1;              // ears droop
    // 2. topple: accelerate over (impact - start), then a damped bounce off the flank
    let roll: number;
    if (t < D.toppleStart) roll = 0;
    else if (t < D.impact) { const u = (t - D.toppleStart) / (D.impact - D.toppleStart); roll = D.roll * u * u * (1.35 - 0.35 * u); }
    else { const a = t - D.impact; roll = D.roll * (1 - 0.1 * Math.abs(Math.sin(a * 8.5)) * Math.exp(-a * 5)); }
    c.topple = roll * side;
    const down = sat(roll / D.roll);
    // 3. limp: legs out stiff and splayed, head lolls to the ground, tail flat, crest deflated
    c.feetOut += 0.07 * down;
    c.frontReach += 0.09 * down;
    c.hindReach -= 0.08 * down;
    c.frontLift += 0.03 * down;
    c.neckPitch += 0.12 * down;
    c.headPitch += 0.1 * down;
    c.headRoll += 0.25 * down * side;
    c.jaw += 0.12 * down;
    c.tailLift -= 0.12 * down;
    c.tailStiff = Math.max(c.tailStiff, down);
    c.eyeClose = Math.max(c.eyeClose, t >= D.impact ? 1 : 0.55 + 0.45 * down);
    // one comic twitch of the tail and front feet after the dust settles
    const tw = env(t, 1.65, 1.72, 1.8, 1.95);
    c.tailLift += 0.35 * tw;
    c.frontLift += 0.06 * tw;
    c.mane *= 1 - 0.45 * down;
    c.ruff *= 1 - 0.25 * down;
    c.crater *= 1 - 0.35 * down;
    c.wings = c.wings * (1 - down) - 0.15 * down;
    c.breath *= 1 - down;
  }

  /**
   * CLEAR: the victory roar. A short gather (crouch), then the titan rears up on its hind legs,
   * throws its head back with the jaw wide and every crest flared (mane / ruff / crater / wings),
   * tail up — and HOLDS it with a roaring quiver through the aftermath, so the front-page photo
   * (taken 2.5 s in) catches the roar. After ~4 s it settles into the proud hero stance.
   */
  private victoryPose(t: number): void {
    const c = this.ch;
    const gather = env(t, 0, 0.18, 0.24, 0.42);
    const rear = t < 4 ? smooth((t - 0.22) / 0.4) : 1 - smooth((t - 4) / 0.8);
    const quiver = t > 0.55 ? Math.sin(t * 38) * 0.5 + Math.sin(t * 23 + 1) * 0.5 : 0;
    c.bodyY -= 0.05 * gather;
    c.sq *= 1 - 0.08 * gather;
    c.bodyPitch -= 0.3 * rear;
    c.bodyY += 0.05 * rear;
    c.bodyZ -= 0.03 * rear;
    c.frontLift += 0.22 * rear;
    c.frontReach += 0.06 * rear;
    c.feetOut += 0.03 * rear;
    c.neckPitch -= 0.28 * rear;
    c.headPitch -= 0.42 * rear;
    c.headRoll += 0.03 * quiver * rear;
    c.jaw += (0.88 + 0.07 * quiver) * rear;
    c.throat *= 1 + 0.08 * rear;
    c.mane *= 1 + 0.75 * rear;
    c.ruff *= 1 + 0.4 * rear;
    c.crater *= 1 + 0.4 * rear;
    c.wings += 0.85 * rear;
    c.ears -= 0.8 * rear;
    c.tailLift += 0.3 * rear;
    c.tailCurl += 0.35 * rear;
    c.eyeClose = Math.max(c.eyeClose * (1 - rear), 0.35 * rear);   // squinting into the roar, not blinking
    if (t >= 4) this.heroPose(smooth((t - 4) / 0.8));
  }

  // ─────────────── bone writers ───────────────
  private setBone(name: string, px: number, py: number, pz: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1): void {
    const b = this.bone[name];
    if (!b) return;
    const r = this.restPos.get(b)!;
    b.position.set(r.x + px, r.y + py, r.z + pz);
    b.rotation.set(rx, ry, rz);
    b.scale.set(sx, sy, sz);
  }

  private writeSpine(cyc: number, gw: number): void {
    const c = this.ch, g = this.g;
    // base: squash & stretch around the feet
    const sq = clamp(c.sq, 0.6, 1.5), st = clamp(c.st, 0.7, 1.5);
    const sx = 1 / Math.sqrt(sq * st);          // keep volume: squash widens, stretch thins
    // DEFEAT topple: roll about the model's forward (Z) axis, pivoting near the down-side foot edge
    // (x = -side * 0.6 halfW), so the titan tips over its own feet instead of spinning in place
    const tp = c.topple;
    if (tp !== 0) {
      const px = (tp > 0 ? -this.halfW : this.halfW) * 0.6;   // near the foot edge: tips over, does not slide off
      const cs = Math.cos(tp), sn = Math.sin(tp);
      this.setBone('base', px - px * cs, -px * sn, 0, 0, 0, tp, sx, sq, st);
    } else {
      this.setBone('base', 0, 0, 0, 0, 0, 0, sx, sq, st);
    }
    this.setBone('body', c.bodyX, c.bodyY, c.bodyZ, c.bodyPitch, c.bodyYaw, c.bodyRoll);
    const bs = 1 + c.breath;
    this.setBone('chest', 0, 0, 0, c.chestPitch, c.chestYaw, 0, bs, bs, 1 + c.breath * 0.4);
    this.setBone('hips', 0, 0, 0, c.hipsPitch, c.hipsYaw, 0);
    const th = c.throat;
    this.setBone('neck', 0, 0, c.neckZ, c.neckPitch, c.neckYaw, 0, th, th, 1);
    this.setBone('head', 0, 0, 0, c.headPitch, c.headYaw, c.headRoll, 1 / Math.sqrt(th), 1 / Math.sqrt(th), 1);
    this.setBone('jaw', 0, 0, 0, clamp(c.jaw, 0, 1.0), 0, 0);
    const eye = 1 - 0.9 * sat(c.eyeClose);
    this.setBone('eyeL', 0, 0, 0, 0, 0, 0, 1, eye, 1);
    this.setBone('eyeR', 0, 0, 0, 0, 0, 0, 1, eye, 1);
    // tail: wave travels toward the tip, amplitude grows along it; stiffness damps it
    const n = this.tail.length;
    const loose = 1 - sat(c.tailStiff);
    for (let i = 0; i < n; i++) {
      const b = this.tail[i];
      const u = (i + 1) / n;
      const wave = g.tailWave * gw * Math.sin(cyc - (i + 1) * g.tailLag) * (0.5 + u) * loose;
      const yaw = (c.tailYaw * (0.6 + 0.4 * u) + c.tailCurl * u * 0.9) * (0.4 + 0.6 * loose) + wave;
      const lift = c.tailLift * (1 - 0.4 * u);
      const r = this.restPos.get(b)!;
      b.position.copy(r);
      b.rotation.set(-lift, yaw, 0);
      b.scale.set(1, 1, 1);
    }
    // kit parts
    const m = clamp(c.mane, 0.5, 2.2);
    this.setBone('maneN', 0, 0, 0, -0.1 * (m - 1), 0, 0, m, m, m);
    this.setBone('maneS', 0, 0, 0, -0.1 * (m - 1), 0, 0, m, m, m);
    const ef = this.earFlick >= 0 ? Math.sin(sat(this.earFlick / 0.3) * Math.PI) * 0.45 : 0;
    this.setBone('earL', 0, 0, 0, c.ears + (this.earSide > 0 ? -ef : 0), 0, 0);
    this.setBone('earR', 0, 0, 0, c.ears + (this.earSide < 0 ? -ef : 0), 0, 0);
    this.setBone('wingL', 0, 0, 0, 0, 0, -c.wings);
    this.setBone('wingR', 0, 0, 0, 0, 0, c.wings);
    const ss = clamp(c.shellScale, 0.8, 1.3);
    this.setBone('shell', 0, c.shellY, 0, c.shellPitch, 0, c.shellRoll, ss, ss, ss);
    const cr = clamp(c.crater, 0.5, 2);
    this.setBone('crater', 0, 0, 0, 0, 0, 0, cr, 1 + (cr - 1) * 0.6, cr);
    const rf = clamp(c.ruff, 0.6, 2);
    this.setBone('ruff', 0, 0, 0, 0, 0, 0, rf, rf, 1 + (rf - 1) * 0.5);
    for (const name in this.bone) this.bone[name]!.updateMatrix();
  }

  /** model-space matrix of a bone: product of local matrices up to the skinned mesh */
  private modelMatrix(b: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    out.copy(b.matrix);
    let p = b.parent;
    while (p && (p as THREE.Bone).isBone) { out.premultiply(p.matrix); p = p.parent; }
    return out;
  }

  private solveLegs(cyc: number, gw: number, stride: number, dashing: boolean): void {
    const c = this.ch;
    const duty = clamp(this.duty, 0.3, 0.85);
    const stepLen = stride * duty * gw;
    const lift = this.g.lift * gw * (dashing ? 0.3 : 1);
    void cyc;
    let lastParent: THREE.Bone | null = null;
    const toppled = c.topple !== 0;
    if (toppled) {
      // base's transform without its squash scale: T(base.position - rest) * R(topple)
      const base = this.bone.base;
      const r = base ? this.restPos.get(base) : undefined;
      _topR.makeRotationZ(c.topple);
      _topM.makeTranslation(base && r ? base.position.x - r.x : 0, base && r ? base.position.y - r.y : 0, 0).multiply(_topR);
    }
    for (const L of this.legs) {
      if (L.parent !== lastParent) {
        this.modelMatrix(L.parent, _m);
        _m.decompose(_pp, _pq, _ps);
        _inv.copy(_m).invert();
        _pqi.copy(_pq).invert();
        lastParent = L.parent;
      }
      // foot target (model space)
      const ph = frac(this.phase + L.off);
      let fwd: number, up = 0, toe = 0;
      if (ph < duty) {
        fwd = (0.5 - ph / duty) * stepLen;
      } else {
        const s = (ph - duty) / (1 - duty);
        fwd = (-0.5 + smooth(s)) * stepLen;
        up = Math.sin(Math.PI * s) * lift;
        toe = -0.35 * Math.sin(Math.PI * s) * gw;
      }
      const front = L.def.front;
      _t.copy(L.ankle);
      _t.x += L.def.side * c.feetOut;
      _t.y += up + (front ? c.frontLift : c.hindLift);
      _t.z += fwd + (front ? c.frontReach : c.hindReach);
      if (_t.y < L.ankle.y) _t.y = L.ankle.y;
      if (toppled) _t.applyMatrix4(_topM);     // the legs go down WITH the body
      L.target.copy(_t);
      // → parent space
      _t.applyMatrix4(_inv);
      _pole.copy(L.pole).applyQuaternion(_pqi);
      // 2-bone IK
      _d.subVectors(_t, L.hip);
      let dl = _d.length();
      if (dl < 1e-6) { _d.set(0, -1, 0); dl = 1e-6; } else _d.multiplyScalar(1 / dl);
      const l1 = L.l1, l2 = L.l2;
      const cl = clamp(dl, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9995);
      const cosA = clamp((l1 * l1 + cl * cl - l2 * l2) / (2 * l1 * cl), -1, 1);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      _b.copy(_pole).addScaledVector(_d, -_pole.dot(_d));
      if (_b.lengthSq() < 1e-10) _b.copy(L.lastBend); else { _b.normalize(); L.lastBend.copy(_b); }
      _k.copy(L.hip).addScaledVector(_d, l1 * cosA).addScaledVector(_b, l1 * sinA);
      _e.copy(L.hip).addScaledVector(_d, cl);
      _u1.subVectors(_k, L.hip).normalize();
      basisRot(L.u0, L.pole, _u1, _b, _q1);
      L.up.quaternion.copy(_q1);
      _u2.subVectors(_e, _k).normalize();
      basisRot(L.u0L, L.pole, _u2, _b, _q2);
      L.low.quaternion.copy(_q1).invert().multiply(_q2);
      // foot: flat on the ground in model space (+ toe roll during swing)
      _qf.setFromAxisAngle(X_AXIS, toe);
      L.foot.quaternion.copy(_q2).invert().multiply(_pqi).multiply(_qf);
      L.up.updateMatrix(); L.low.updateMatrix(); L.foot.updateMatrix();
    }
    void _eu;
  }

  private writeFlash(a: AnimState): void {
    const f = a.noFlash ? 0 : this.ch.flash;
    const e = this.model.skin.emissive;
    if (f > 0.001) { e.setRGB(f * 0.7, f * 0.7, f * 0.7); }
    else if (e.r !== 0 || e.g !== 0 || e.b !== 0) e.setRGB(0, 0, 0);
  }
}
