// HIT PARADE — the Match object and small shared helpers over the state array.
// (match.ts re-exports the public API types; this module exists so the system modules can share
// helpers without import cycles through match.ts.)

import type { AnimRef, GameData } from '../types.ts';
import type { CBrawl, CFighter, CMove, CSys } from './compile.ts';
import { EventRing } from './events.ts';
import { EV } from './events.ts';
import { F, FL, ST, W, fighterBase } from './layout.ts';
import type { CRing } from './ring.ts';
import { Q, alongYaw, cosQ, divRound, isqrt, sinQ } from './fx3d.ts';

export type Scheme = 0 | 1; // 0 SIMPLE, 1 CLASSIC
export interface PlayerCfg {
  fighter: string;
  color: number;
  scheme: Scheme;
  cpu: number; // -1 human, 0..8
}
export interface MatchCfg {
  mode: 'versus' | 'arcade' | 'training' | 'online' | 'brawl' | 'heckler';
  stage: string;
  seed: number;
  p: [PlayerCfg, PlayerCfg];
  rounds?: number;
  timer?: number;
}

export interface MatchTables {
  sfx: string[];
  anims: [AnimRef[], AnimRef[]];
}

export interface Match {
  cfg: MatchCfg;
  s: Int32Array;
  frame(): number;
  events: EventRing;
  // ---- internal (read-only for other lanes)
  data: GameData;
  sys: CSys;
  cf: [CFighter, CFighter];
  tab: MatchTables;
  training: boolean;
  arcade: boolean;
  /** CHANGED(SIM) P2: compiled bonus-round tables in 'brawl' / 'heckler' matches (CONTRACT 28.4), else null */
  bonus?: CBrawl | null;
  /** CHANGED(SIM3D) (CONTRACT §35.2): the compiled ring of this match (from the state's W.ring* fields; constant) */
  ring: CRing;
}

export const FB0 = fighterBase(0);
export const FB1 = fighterBase(1);
export function fb(i: number): number {
  return i === 0 ? FB0 : FB1;
}

export function emit(m: Match, type: number, a: number, b: number, c: number, d: number): void {
  m.events.push(m.s[W.frame], type, a, b, c, d);
}

export function setSt(m: Match, i: number, st: number): void {
  const b = fb(i);
  m.s[b + F.st] = st;
  m.s[b + F.stF] = 0;
}

export function curMove(m: Match, i: number): CMove | null {
  const k = m.s[fb(i) + F.mv];
  return k >= 0 ? m.cf[i].moves[k] : null;
}

/** Clears the running move (interrupted or finished). */
export function clearMove(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  s[b + F.mv] = -1;
  s[b + F.mvF] = 0;
  s[b + F.mvFlags] = 0;
  s[b + F.contact] = 0;
  s[b + F.contactF] = 0;
  s[b + F.hitMask] = 0;
  s[b + F.hitCount] = 0;
  s[b + F.armorLeft] = 0;
  s[b + F.armorAbs] = 0;
  s[b + F.flags] &= ~(FL.THROWING | FL.TAUNTING);
  s[b + F.throwDmgF] = 0;
}

export function isAirborne(s: Int32Array, b: number): boolean {
  return (s[b + F.flags] & FL.AIRBORNE) !== 0;
}

/** SHOWTIME add with METER_BAR events (a = fighter, b = bars now, c = 0). */
export function addShowtime(m: Match, i: number, amount: number): void {
  if (amount === 0) return;
  const s = m.s;
  const b = fb(i);
  const bar = m.sys.raw.showtime.bar;
  const max = bar * m.sys.raw.showtime.bars;
  const before = s[b + F.showtime];
  let v = before + amount;
  if (v > max) v = max;
  if (v < 0) v = 0;
  s[b + F.showtime] = v;
  const b0 = Math.floor(before / bar);
  const b1 = Math.floor(v / bar);
  if (b1 > b0) emit(m, EV.METER_BAR, i, b1, 0, 0);
}

export function nerveMax(m: Match): number {
  return m.sys.raw.nerve.bar * m.sys.raw.nerve.bars;
}

function frightOn(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  if (s[b + F.fright] !== 0) return;
  s[b + F.fright] = 1;
  s[b + F.nerve] = 0;
  emit(m, EV.STAGE_FRIGHT_ON, i, 0, 0, 0);
}

/** Pays NERVE for an action (starts the spend cooldown). */
export function spendNerve(m: Match, i: number, amount: number): void {
  if (amount <= 0) return;
  const s = m.s;
  const b = fb(i);
  s[b + F.nerve] -= amount;
  s[b + F.nerveCd] = m.sys.raw.nerve.spendCooldown;
  if (s[b + F.nerve] <= 0) {
    s[b + F.nerve] = 0;
    frightOn(m, i);
  }
}

/** NERVE lost to blocking / punish counters / parry upkeep. */
export function drainNerve(m: Match, i: number, amount: number): void {
  if (amount <= 0) return;
  const s = m.s;
  const b = fb(i);
  if (s[b + F.fright] !== 0) return;
  s[b + F.nerve] -= amount;
  if (s[b + F.nerve] <= 0) {
    s[b + F.nerve] = 0;
    frightOn(m, i);
  }
}

export function gainNerve(m: Match, i: number, amount: number): void {
  const s = m.s;
  const b = fb(i);
  const max = nerveMax(m);
  s[b + F.nerve] = Math.min(max, s[b + F.nerve] + amount);
  if (s[b + F.fright] !== 0 && s[b + F.nerve] >= max) {
    s[b + F.fright] = 0;
    emit(m, EV.STAGE_FRIGHT_OFF, i, 0, 0, 0);
  }
}

/** Can the fighter pay a NERVE action (any sliver left, not in STAGE FRIGHT)? */
export function canNerve(m: Match, i: number): boolean {
  const b = fb(i);
  return m.s[b + F.fright] === 0 && m.s[b + F.nerve] > 0;
}

export function canAfford(m: Match, i: number, mv: CMove): boolean {
  const b = fb(i);
  if (mv.costShow > 0 && m.s[b + F.showtime] < mv.costShow) return false;
  if (mv.costNerve > 0 && !canNerve(m, i)) return false;
  return true;
}

/** CHANGED(SIM3D): moves fighter block b by `amount` U along yaw `yaw` (negative = backward). */
export function moveAlong(s: Int32Array, b: number, yaw: number, amount: number): void {
  if (amount === 0) return;
  alongYaw(amount, yaw, AL);
  s[b + F.x] += AL[0];
  s[b + F.z] += AL[1];
}
const AL = new Int32Array(2);

/** CHANGED(SIM3D): moves fighter block b by `amount` U along its own forward (negative = backward). */
export function moveFwd(s: Int32Array, b: number, amount: number): void {
  moveAlong(s, b, s[b + F.yaw], amount);
}

/** CHANGED(SIM3D): sets fighter block b's planar velocity to `speed` U/frame along yaw. */
export function setVelAlong(s: Int32Array, b: number, yaw: number, speed: number): void {
  alongYaw(speed, yaw, AL);
  s[b + F.vx] = AL[0];
  s[b + F.vz] = AL[1];
}

/**
 * CHANGED(SIM3D) (CONTRACT §35.3): screen side of a yaw under the camera basis: +1 = faces screen-right, -1 = left, 0 =
 * exactly along the camera axis. Screen-right R = (camN.z, -camN.x).
 */
export function screenSide(s: Int32Array, yaw: number): number {
  const d = sinQ(yaw) * s[W.camNZ] - cosQ(yaw) * s[W.camNX];
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** CHANGED(SIM3D): refresh F.facing (the input-mapping sign, §4.4) from the yaw + camera basis (0 keeps the old sign). */
export function updateFacing(s: Int32Array, b: number): void {
  const sd = screenSide(s, s[b + F.yaw]);
  if (sd !== 0) s[b + F.facing] = sd;
}

/**
 * CHANGED(SIM3D) (CONTRACT §35.3): camera basis camN = the unit perpendicular of (b - a) closest to the previous camN
 * (continuity: never auto-flips; a cross-over swaps screen sides naturally). |b - a| < minSep keeps the previous one.
 */
export function updateCamN(s: Int32Array, ax: number, az: number, bx: number, bz: number, minSep: number): void {
  const dx = bx - ax;
  const dz = bz - az;
  const d2 = dx * dx + dz * dz;
  if (d2 < minSep * minSep || d2 === 0) return;
  const d = isqrt(d2);
  let nx = divRound(-dz * Q, d);
  let nz = divRound(dx * Q, d);
  if (nx * s[W.camNX] + nz * s[W.camNZ] < 0) {
    nx = -nx;
    nz = -nz;
  }
  s[W.camNX] = nx;
  s[W.camNZ] = nz;
}

/** Number of active projectiles owned by `i` spawned by moves with the same projectile limit group. */
export function isFreeState(st: number): boolean {
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}
