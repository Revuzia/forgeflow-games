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

import { F, FL, HIST, P, PH, PROJ_CAP, ST, W, fighterBase, projBase } from '../sim/layout.ts';
import type { CFighter, CMove } from '../sim/compile.ts';
import type { Match } from '../sim/state.ts';

export interface FView {
  x: number; // U
  y: number;
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
}

export interface ProjView {
  slot: number;
  owner: number;
  inst: number;
  mv: number;
  x: number;
  y: number;
  vx: number;
  w: number;
  h: number;
  age: number;
  kind: number;
}

export interface Seen {
  frame: number;
  phase: number;
  freeze: number;
  cin: boolean;
  me: FView;
  op: FView;
  /** op.x - me.x (U) */
  dx: number;
  /** |dx| */
  dist: number;
  wall: number; // U
  /** active projectiles (any owner) */
  proj: ProjView[];
  nProj: number;
}

function blankF(cf: CFighter): FView {
  return {
    x: 0, y: 0, vx: 0, vy: 0, facing: 1, st: 0, stF: 0, mv: -1, mvF: 0, inst: 0, contact: 0, contactF: 0,
    hp: 0, hpMax: cf.hpMax, show: 0, nerve: 0, fright: false, stun: 0, hitstop: 0, air: false, crouch: false,
    invT: 0, kd: 0, combo: 0, jumpDir: 0, cm: null, cf, chB: 0, chBS: 0, chBR: 0, chD: 0, chDS: 0, chDR: 0,
  };
}

export function newSeen(m: Match, i: number): Seen {
  const proj: ProjView[] = [];
  for (let k = 0; k < PROJ_CAP; k++) proj.push({ slot: k, owner: -1, inst: 0, mv: -1, x: 0, y: 0, vx: 0, w: 0, h: 0, age: 0, kind: 0 });
  return {
    frame: 0, phase: 0, freeze: 0, cin: false, me: blankF(m.cf[i]), op: blankF(m.cf[1 - i]), dx: 0, dist: 0,
    wall: m.sys.wall, proj, nProj: 0,
  };
}

/** Visible fields of fighter `j` (both sides), from the ONE state array. */
function readF(m: Match, j: number, v: FView, own: boolean): void {
  const s = m.s;
  const b = fighterBase(j);
  const cf = m.cf[j];
  v.cf = cf;
  v.x = s[b + F.x];
  v.y = s[b + F.y];
  v.vx = s[b + F.vx];
  v.vy = s[b + F.vy];
  v.facing = s[b + F.facing];
  v.st = s[b + F.st];
  v.stF = s[b + F.stF];
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
  }
}

/** Fills `out` with what player `i` can see this frame. */
export function sense(m: Match, i: number, out: Seen): Seen {
  const s = m.s;
  out.frame = s[W.frame];
  out.phase = s[W.phase];
  out.freeze = s[W.freeze];
  out.cin = s[W.cinActive] !== 0;
  readF(m, i, out.me, true);
  readF(m, 1 - i, out.op, false);
  out.dx = out.op.x - out.me.x;
  out.dist = Math.abs(out.dx);
  let n = 0;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0) continue;
    const p = out.proj[n++];
    p.slot = k;
    p.owner = s[pb + P.owner];
    p.inst = s[pb + P.inst];
    p.mv = s[pb + P.mv];
    p.x = s[pb + P.x];
    p.y = s[pb + P.y];
    p.vx = s[pb + P.vx];
    p.w = s[pb + P.w];
    p.h = s[pb + P.h];
    p.age = s[pb + P.age];
    p.kind = s[pb + P.kind];
  }
  out.nProj = n;
  return out;
}

/** Fields probe_personas scrambles on the OPPONENT before each CPU call (the input-derived ones). */
export const HIDDEN_FIELDS: readonly number[] = (() => {
  const out: number[] = [F.raw, F.prevRaw, F.hHead, F.bufA, F.bufM, F.bufAge, F.bufWin, F.bufF, F.ageL, F.ageM, F.ageH, F.ageS,
    F.chB, F.chBS, F.chBR, F.chD, F.chDS, F.chDR];
  for (let k = 0; k < HIST; k++) out.push(F.hist + k);
  return out;
})();

export function isFree(st: number): boolean {
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}

export { PH, ST };
