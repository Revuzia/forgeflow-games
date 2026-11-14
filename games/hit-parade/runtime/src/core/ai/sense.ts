// HIT PARADE - what the CPU is allowed to see (lane AI, CONTRACT §11: "reacts only to VISIBLE startup",
// "no input reading ever"). THREE-free, read-only over the sim state.
//
// Everything a watching player could know from the screen: positions, velocities, facing, the pose /
// state and which move is playing (and how far into it), HP, the meters on the HUD, projectiles. The
// opponent's INPUT-DERIVED fields are never read: raw / prevRaw / hHead / hist (input history), bufA /
// bufM / bufAge / bufWin / bufF (buffered action), ageL..ageS (press ages), chB..chDR (charge counters)
// and the ASSIST bit of flags. probe_personas proves it by scrambling exactly those fields before every
// CPU call and requiring an identical match.
//
// The CPU never writes to the state (probe_personas checks the checksum around every call too).
//
// CHANGED(AI3D) (CONTRACT §35.9 / §35.17): the 3D ring. The brain reasons along the FIGHT LINE (the line through both
// fighters): sense() projects both fighters and every projectile onto that line and reports the line's own ring chord
// as a symmetric wall (+-`wall`), so every 1D rule of the brain (reach, pushback, "cornered", block side) stays exact
// off the spawn line. The virtual axis points screen-RIGHT (sigma x the unit vector me -> op), so awayBits() /
// dirBits() keep producing the sim's camera-relative LEFT / RIGHT. On the spawn line (no STEP input ever) the projected
// values are the world x values exactly (probe_personas level lines identical on rust_theater). The world-space
// fields (wx / wz / yaw, the step state, ring distances, a projectile's lateral offset + miss flag) are added for the
// 3D rules (ring3d.ts). Integer math only (fx3d / ring.ts helpers), like the sim.

import { F, FL, HIST, P, PH, PROJ_CAP, ST, W, fighterBase, projBase } from '../sim/layout.ts';
import type { CFighter, CMove } from '../sim/compile.ts';
import type { Match } from '../sim/state.ts';
import { Q, isqrt, normQ, yawToDir } from '../sim/fx3d.ts';
import { ringRay } from '../sim/ring.ts';

export interface FView {
  /** CHANGED(AI3D): position along the fight line (U; screen-right positive, chord centre 0) - the 1D brain's x */
  x: number;
  y: number;
  /** CHANGED(AI3D): velocity along the fight line (U/f, screen-right positive) */
  vx: number;
  vy: number;
  facing: number;
  st: number;
  stF: number;
  mv: number; // compiled move index, -1 none
  mvF: number;
  inst: number; // move instance counter (a new pose = a new attack)
  contact: number; // 0 none, 1 hit, 2 block / parry / armor
  contactF: number;
  hp: number;
  hpMax: number;
  show: number;
  nerve: number;
  fright: boolean;
  stun: number;
  hitstop: number;
  air: boolean;
  crouch: boolean;
  invT: number;
  kd: number;
  combo: number; // hits this fighter has TAKEN in the current combo
  jumpDir: number; // -1 / 0 / +1 (the jump_b / jump_up / jump_f pose)
  cm: CMove | null;
  cf: CFighter;
  // own-only (filled for the CPU's own fighter; zero for the opponent)
  chB: number;
  chBS: number;
  chBR: number;
  chD: number;
  chDS: number;
  chDR: number;
  /**
   * CHANGED(AI) P2: the fighter's §28.2 unique ints (stance / charge / ball / counter / armor / teleport / phase), OWN
   * fighter only (zero for the opponent: a charge kit's u0..u3 mirror its input-derived charge counters, and the
   * opponent's stance / ball / phase are visible through its state and the projectile list anyway).
   */
  uq: [number, number, number, number];
  /** own install frames left (0 = none) */
  instF: number;
  // ---- CHANGED(AI3D): world space (visible: where the body stands, where it faces, which way it circles)
  wx: number;
  wz: number;
  wvx: number;
  wvz: number;
  /** 0..65535 (0 faces +Z, + turns toward +X) */
  yaw: number;
  /** circling sense of a running SIDESTEP / SIDEWALK (+1 = ccw around its opponent, -1 = cw; 0 otherwise) */
  stepDir: number;
  /**
   * where the OTHER fighter stands in this fighter's own frame (U): along its forward, and sideways off its forward
   * line (cross(forward, other - me); the sign says the side) - an attack with a frozen yaw whiffs when |aimLat| is
   * beyond its lateral depth + the other's body
   */
  aimFwd: number;
  aimLat: number;
}

export interface ProjView {
  slot: number;
  owner: number;
  inst: number;
  mv: number;
  /** CHANGED(AI3D): along the fight line (U, like FView.x) */
  x: number;
  y: number;
  /** CHANGED(AI3D): along the fight line (U/f) */
  vx: number;
  w: number;
  h: number;
  age: number;
  kind: number;
  /** CHANGED(AI) P2: vertical speed (U/f), P.mode (kind 1: the ball state, kind 2: heckle object type) */
  vy: number;
  mode: number;
  // ---- CHANGED(AI3D)
  wx: number;
  wz: number;
  wvx: number;
  wvz: number;
  /** signed offset off the fight line (U) */
  lat: number;
  /** half-depth of its hit box across its travel (U; compiled projectile.lateralM, else w / 2) */
  latHalf: number;
  /** its straight path passes clear of MY body where I stand (a sidestep already took me off its line) */
  miss: boolean;
}

export interface Seen {
  frame: number;
  phase: number;
  freeze: number;
  cin: boolean;
  me: FView;
  op: FView;
  /** op.x - me.x (U) = sigma x the planar distance */
  dx: number;
  /** CHANGED(AI3D): planar distance between the two roots (U) = |dx| */
  dist: number;
  /** CHANGED(AI3D): half the fight line's ring chord (U): the virtual walls stand at +-wall (was system stage.wallM) */
  wall: number;
  /** active projectiles (any owner) */
  proj: ProjView[];
  nProj: number;
  // ---- CHANGED(AI3D): the fight line + ring
  /** Q14 unit vector me -> op (world x, z) */
  ux: number;
  uz: number;
  /** +1 / -1: the virtual x axis = sigma x (ux, uz) points screen-right */
  sigma: number;
  /** the sim's camera normal (Q14): STEP_IN circles toward -camN, STEP_OUT toward +camN (§35.3) */
  camNX: number;
  camNZ: number;
  /** my root -> the ring wall behind me along the line (U) */
  backU: number;
  /** the opponent's root -> the ring wall behind IT along the line (U) */
  opBackU: number;
}

function blankF(cf: CFighter): FView {
  return {
    x: 0, y: 0, vx: 0, vy: 0, facing: 1, st: 0, stF: 0, mv: -1, mvF: 0, inst: 0, contact: 0, contactF: 0,
    hp: 0, hpMax: cf.hpMax, show: 0, nerve: 0, fright: false, stun: 0, hitstop: 0, air: false, crouch: false,
    invT: 0, kd: 0, combo: 0, jumpDir: 0, cm: null, cf, chB: 0, chBS: 0, chBR: 0, chD: 0, chDS: 0, chDR: 0,
    uq: [0, 0, 0, 0], instF: 0, wx: 0, wz: 0, wvx: 0, wvz: 0, yaw: 0, stepDir: 0, aimFwd: 0, aimLat: 0,
  };
}

export function newSeen(m: Match, i: number): Seen {
  const proj: ProjView[] = [];
  for (let k = 0; k < PROJ_CAP; k++) {
    proj.push({ slot: k, owner: -1, inst: 0, mv: -1, x: 0, y: 0, vx: 0, w: 0, h: 0, age: 0, kind: 0, vy: 0, mode: 0, wx: 0, wz: 0, wvx: 0, wvz: 0, lat: 0, latHalf: 0, miss: false });
  }
  return {
    frame: 0, phase: 0, freeze: 0, cin: false, me: blankF(m.cf[i]), op: blankF(m.cf[1 - i]), dx: 0, dist: 0,
    wall: m.sys.wall, proj, nProj: 0, ux: Q, uz: 0, sigma: 1, camNX: 0, camNZ: Q, backU: m.sys.wall, opBackU: m.sys.wall,
  };
}

/** Visible fields of fighter `j` (both sides), from the ONE state array. */
function readF(m: Match, j: number, v: FView, own: boolean): void {
  const s = m.s;
  const b = fighterBase(j);
  const cf = m.cf[j];
  v.cf = cf;
  v.wx = s[b + F.x];
  v.wz = s[b + F.z];
  v.y = s[b + F.y];
  v.wvx = s[b + F.vx];
  v.wvz = s[b + F.vz];
  v.vy = s[b + F.vy];
  v.yaw = s[b + F.yaw];
  v.facing = s[b + F.facing];
  v.st = s[b + F.st];
  v.stF = s[b + F.stF];
  v.stepDir = v.st === ST.SIDESTEP || v.st === ST.SIDEWALK ? (s[b + F.stepDir] >= 0 ? 1 : -1) : 0;
  v.mv = s[b + F.mv];
  v.mvF = s[b + F.mvF];
  v.inst = s[b + F.mvInst];
  v.contact = s[b + F.contact];
  v.contactF = s[b + F.contactF];
  v.hp = s[b + F.hp];
  v.hpMax = cf.hpMax;
  v.show = s[b + F.showtime];
  v.nerve = s[b + F.nerve];
  v.fright = s[b + F.fright] !== 0;
  v.stun = s[b + F.stun];
  v.hitstop = s[b + F.hitstop];
  const fl = s[b + F.flags];
  v.air = (fl & FL.AIRBORNE) !== 0;
  v.crouch = (fl & FL.CROUCHING) !== 0;
  v.invT = s[b + F.invT];
  v.kd = s[b + F.kd];
  v.combo = s[b + F.cCount];
  v.jumpDir = s[b + F.jumpDir];
  v.cm = v.mv >= 0 && v.mv < cf.moves.length ? cf.moves[v.mv] : null;
  if (own) {
    // the CPU's OWN charge counters (it knows what it has been holding)
    v.chB = s[b + F.chB];
    v.chBS = s[b + F.chBS];
    v.chBR = s[b + F.chBR];
    v.chD = s[b + F.chD];
    v.chDS = s[b + F.chDS];
    v.chDR = s[b + F.chDR];
    v.uq[0] = s[b + F.uniq];
    v.uq[1] = s[b + F.uniq + 1];
    v.uq[2] = s[b + F.uniq + 2];
    v.uq[3] = s[b + F.uniq + 3];
    v.instF = s[b + F.instF];
  }
}

const U2 = [0, 0];
const FW = [0, 0];

/** where `other` stands in `v`'s own frame (forward / sideways off its forward line) */
function aim(v: FView, other: FView): void {
  yawToDir(v.yaw, FW);
  const rx = other.wx - v.wx;
  const rz = other.wz - v.wz;
  v.aimFwd = Math.round((rx * FW[0] + rz * FW[1]) / Q);
  v.aimLat = Math.round((FW[0] * rz - FW[1] * rx) / Q);
}

/** Fills `out` with what player `i` can see this frame. */
export function sense(m: Match, i: number, out: Seen): Seen {
  const s = m.s;
  out.frame = s[W.frame];
  out.phase = s[W.phase];
  out.freeze = s[W.freeze];
  out.cin = s[W.cinActive] !== 0;
  const me = out.me;
  const op = out.op;
  readF(m, i, me, true);
  readF(m, 1 - i, op, false);
  // ---- CHANGED(AI3D): the fight line (unit me -> op), its screen sense and its ring chord
  const cnx = s[W.camNX];
  const cnz = s[W.camNZ];
  out.camNX = cnx;
  out.camNZ = cnz;
  const rX = cnz; // screen-right R = (camN.z, -camN.x) (§35.13 item 5)
  const rZ = -cnx;
  const dX = op.wx - me.wx;
  const dZ = op.wz - me.wz;
  const f0 = me.facing >= 0 ? 1 : -1;
  const dist = normQ(dX, dZ, U2, 0, rX * f0, rZ * f0);
  const ux = U2[0];
  const uz = U2[1];
  const sd = dX * rX + dZ * rZ;
  const sg = sd > 0 ? 1 : sd < 0 ? -1 : f0;
  const back = ringRay(m.ring, me.wx, me.wz, -ux, -uz);
  const front = ringRay(m.ring, op.wx, op.wz, ux, uz);
  const half = Math.floor((back + dist + front) / 2);
  out.ux = ux;
  out.uz = uz;
  out.sigma = sg;
  out.backU = back;
  out.opBackU = front;
  out.wall = half;
  me.x = sg * (back - half);
  op.x = sg * (back + dist - half);
  me.vx = sg * Math.round((me.wvx * ux + me.wvz * uz) / Q);
  op.vx = sg * Math.round((op.wvx * ux + op.wvz * uz) / Q);
  out.dx = op.x - me.x;
  out.dist = dist;
  aim(me, op);
  aim(op, me);
  const myR = me.cf.hurtStand[0] >> 1;
  let n = 0;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0) continue;
    const p = out.proj[n++];
    p.slot = k;
    p.owner = s[pb + P.owner];
    p.inst = s[pb + P.inst];
    p.mv = s[pb + P.mv];
    p.wx = s[pb + P.x];
    p.wz = s[pb + P.z];
    p.y = s[pb + P.y];
    p.wvx = s[pb + P.vx];
    p.wvz = s[pb + P.vz];
    p.w = s[pb + P.w];
    p.h = s[pb + P.h];
    p.age = s[pb + P.age];
    p.kind = s[pb + P.kind];
    p.vy = s[pb + P.vy];
    p.mode = s[pb + P.mode];
    const rx = p.wx - me.wx;
    const rz = p.wz - me.wz;
    p.x = sg * (Math.round((rx * ux + rz * uz) / Q) + back - half);
    p.vx = sg * Math.round((p.wvx * ux + p.wvz * uz) / Q);
    p.lat = Math.round((ux * rz - uz * rx) / Q);
    const pj = p.owner === 0 || p.owner === 1 ? m.cf[p.owner]?.moves[p.mv]?.proj : null;
    p.latHalf = pj ? Math.max(pj.lat, 1) : p.w >> 1;
    // the closest approach of its straight path to my root (moving projectiles only): clear of my body = a miss
    const v2 = p.wvx * p.wvx + p.wvz * p.wvz;
    if (v2 > 0) {
      const off = Math.abs(p.wvx * rz - p.wvz * rx) / isqrt(v2);
      p.miss = off > p.latHalf + myR + 4000;
    } else p.miss = false;
  }
  out.nProj = n;
  return out;
}

/**
 * Fields probe_personas scrambles on the OPPONENT before each CPU call (the input-derived ones). CHANGED(AI) P2: + the
 * opponent's unique ints (a charge kit mirrors its charge counters there) and the stance down-hold counter `ucnt`.
 * CHANGED(AI3D): unchanged - F.z / F.yaw / F.stepDir are where its body is / faces / circles (on screen).
 */
export const HIDDEN_FIELDS: readonly number[] = (() => {
  const out: number[] = [F.raw, F.prevRaw, F.hHead, F.bufA, F.bufM, F.bufAge, F.bufWin, F.bufF, F.ageL, F.ageM, F.ageH, F.ageS,
    F.chB, F.chBS, F.chBR, F.chD, F.chDS, F.chDR, F.uniq, F.uniq + 1, F.uniq + 2, F.uniq + 3, F.ucnt];
  for (let k = 0; k < HIST; k++) out.push(F.hist + k);
  return out;
})();

export function isFree(st: number): boolean {
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}

/** CHANGED(AI3D): the three step states (SIDESTEP / SIDEWALK / the STEP_END settle) */
export function isStep(st: number): boolean {
  return st === ST.SIDESTEP || st === ST.SIDEWALK || st === ST.STEP_END;
}

export { PH, ST };
