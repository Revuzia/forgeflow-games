// HIT PARADE — the Match object and small shared helpers over the state array.
// (match.ts re-exports the public API types; this module exists so the system modules can share
// helpers without import cycles through match.ts.)

import type { AnimRef, GameData } from '../types.ts';
import type { CBrawl, CFighter, CMove, CSys } from './compile.ts';
import { EventRing } from './events.ts';
import { EV } from './events.ts';
import { F, FL, ST, W, fighterBase } from './layout.ts';

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

/** Number of active projectiles owned by `i` spawned by moves with the same projectile limit group. */
export function isFreeState(st: number): boolean {
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}
