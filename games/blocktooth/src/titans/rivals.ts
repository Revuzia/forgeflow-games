// BLOCKTOOTH — titan-vs-titan targeting + the PvP call site (lane B-TITAN, online VS; vs_design.md §6).
// THREE-free, deterministic. VS ONLY: every export returns "nothing" at once when `w.mode !== 'vs'`, so a solo world never
// reaches a rival (GATE 2 hashes stay byte-identical).
//
// The split with B-VS (see _harness/scratch/partb/NOTES.md): the KITS decide what hit whom (shape tests, which kit % applies,
// aim preference) and call `rivalHit` / `hitRivalsInShape` here; B-VS's `pvpHit` (src/vs/pvp.ts) decides how much it hurts
// (the §6.1 formula, the OPEN HOUSE shove-only rule, spawn protection, KO credit, thorns / lifesteal) and `pvpCc` does the
// CC accounting (§6.2 rule 7). THIS FILE IS THE ONLY PLACE B-TITAN CODE TOUCHES THE PvP API, so a signature change on
// their side is a one-file change here.
//
// All functions work for the BOUND player (w.cur / w.titan = the attacker) except where a slot is named.

import type { DamageKind, Shape, TitanState, World } from '../core/types.ts';
import { VS } from '../core/config.ts';
import { circleInShape } from '../core/math.ts';
import { hypot } from '../core/detmath.ts';
import { pvpCc, pvpHit } from '../vs/pvp.ts';          // B-VS owns both (the contract in _harness/scratch/partb/NOTES.md)
import type { PvpHit } from '../vs/pvp.ts';
import { pvpOnIn } from '../vs/clock.ts';
import { pullTitan, rootTitan, slowTitan } from './titanfx.ts';

export type { PvpHit } from '../vs/pvp.ts';

/** Knockback distance of a rival hit, in attacker body heights (OPEN HOUSE rival hits still SHOVE: vs_design §6.3). */
export const RIVAL_KNOCK_H = { auto: 0.08, hook: 0.4, ult: 0.8, dash: VS.contact.shoveKnockH };

const HIT: PvpHit = { kind: 'generic', tag: '', x: 0, z: 0, knock: 0, dot: false };
const slotBuf: number[] = [];

/** PvP damage is on (HOSTILE TAKEOVER onward). In OPEN HOUSE rival hits shove only and autos never aim at a rival. */
export function pvpLive(w: World): boolean {
  return w.mode === 'vs' && w.vs !== null && pvpOnIn(w.vs.phase);
}
/** alias used by the NOTES contract */
export const rivalsLive = pvpLive;

/** A seat that can be hit right now: in the match, titan alive. */
function targetable(w: World, slot: number): boolean {
  const p = w.players[slot];
  return !!p && !p.vs.eliminated && p.titan.alive;
}

/** Slots (slot order) of every OTHER seat the bound titan can hit (alive, not eliminated). Fills and returns `out`. */
export function rivalSlots(w: World, out: number[] = slotBuf): number[] {
  out.length = 0;
  if (w.mode !== 'vs') return out;
  for (let i = 0; i < w.players.length; i++) if (i !== w.cur && targetable(w, i)) out.push(i);
  return out;
}

/** Nearest rival (surface-to-surface distance ≤ reach, spawn-protected seats skipped) or -1. Ties: lower slot. Only while PvP is live
 *  — OPEN HOUSE autos never aim at a rival. `anyPhase` skips that gate (bots scouting). */
export function nearestRival(w: World, reach: number, anyPhase = false): number {
  if (w.mode !== 'vs' || (!anyPhase && !pvpLive(w))) return -1;
  const T = w.titan;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < w.players.length; i++) {
    if (i === w.cur || !targetable(w, i)) continue;
    const p = w.players[i];
    if (p.vs.spawnProtT > 0) continue;
    const d = hypot(p.titan.x - T.x, p.titan.z - T.z) - p.titan.radius;
    if (d <= reach && d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** One rival hit through B-VS: `pct` of the victim's maxHp (before power / size edge / phase). Returns HP lost. */
export function rivalHit(w: World, victim: number, pct: number, kind: DamageKind, tag: string, x: number, z: number, knockH = 0, dot = false): number {
  if (!(pct > 0) && !(knockH > 0)) return 0;
  const T = w.titan;
  HIT.kind = kind; HIT.tag = tag; HIT.x = x; HIT.z = z; HIT.knock = knockH * T.height; HIT.dot = dot;
  return pvpHit(w, w.cur, victim, pct, HIT);
}

/** Rivals (slot order) whose body touches `shape`. Fills `out`; returns it. */
export function rivalsInShape(w: World, shape: Shape, out: number[] = slotBuf): number[] {
  out.length = 0;
  if (w.mode !== 'vs') return out;
  for (let i = 0; i < w.players.length; i++) {
    if (i === w.cur || !targetable(w, i)) continue;
    const R = w.players[i].titan;
    if (circleInShape(shape, R.x, R.z, R.radius)) out.push(i);
  }
  return out;
}

/** Hit every rival touching `shape` for `pct` each. Returns the number of rivals hit. The impact point is the rival's own
 *  position (knockback pushes it away from the ATTACKER, B-VS decides direction from hit.x/z vs the victim). */
export function hitRivalsInShape(w: World, shape: Shape, pct: number, kind: DamageKind, tag: string, knockH: number): number {
  if (w.mode !== 'vs') return 0;
  const hit = rivalsInShape(w, shape, slotBuf);
  if (hit.length === 0) return 0;
  const T = w.titan;
  // copy: a pvpHit may re-enter rivalSlots / slotBuf users through events
  const n = hit.length;
  const list: number[] = [];
  for (let i = 0; i < n; i++) list.push(hit[i]);
  for (let i = 0; i < n; i++) rivalHit(w, list[i], pct, kind, tag, T.x, T.z, knockH);
  return n;
}

/** CC on a rival through B-VS accounting; returns the seconds granted and applies the effect for them. */
export function rivalSlow(w: World, victim: number, speedMul: number, seconds: number): number {
  if (!pvpLive(w)) return 0;               // OPEN HOUSE rival hits shove only: no CC either
  const g = pvpCc(w, w.cur, victim, 'slow', seconds);
  if (g > 0) slowTitan(w, victim, speedMul, g);
  return g;
}
export function rivalRoot(w: World, victim: number, seconds: number): number {
  if (!pvpLive(w)) return 0;
  const g = pvpCc(w, w.cur, victim, 'root', seconds);
  if (g > 0) rootTitan(w, victim, g);
  return g;
}
/** One tick of a drag toward (x, z): `distM` metres if B-VS still grants pull time (`dt` seconds per tick). */
export function rivalPull(w: World, victim: number, x: number, z: number, distM: number, dt: number, stop: number): number {
  if (!pvpLive(w)) return 0;
  const g = pvpCc(w, w.cur, victim, 'pull', dt);
  if (!(g > 0)) return 0;
  return pullTitan(w, victim, x, z, distM * (g / dt), stop);
}

// ─────────────────────────────── the dash body-check (called from stepTitan, VS only) ───────────────────────────────
/** VS.kitPct[kit].dash: MOLO LOW TACKLE 5 %, HEARTHBACK CALDERA SHOVE 6 %; VOLT-KITE / BRIARWICK dashes do no damage. */
function dashPct(T: TitanState): number {
  const k = VS.kitPct[T.id] as { dash?: number };
  return k.dash ?? 0;
}

/**
 * A dashing titan runs into a rival's body: ONE hit per rival per dash (bit mask in kit.sim_dashHit, reset when a dash
 * starts): the kit's dash % + a 1.5 H shove (B-VS applies the shove, so OPEN HOUSE = shove only). A kit with no dash %
 * (VOLT-KITE, BRIARWICK) still gets the generic push-apart from resolveTitanBodies, nothing here.
 */
export function dashHitRivals(w: World): void {
  const T = w.titan;
  const pct = dashPct(T);
  if (!(pct > 0)) return;
  const K = T.kit;
  let mask = K.sim_dashHit ?? 0;
  for (let i = 0; i < w.players.length; i++) {
    if (i === w.cur || (mask & (1 << i)) !== 0 || !targetable(w, i)) continue;
    const R = w.players[i].titan;
    if (hypot(R.x - T.x, R.z - T.z) > T.radius + R.radius) continue;
    mask |= 1 << i;
    rivalHit(w, i, pct, 'smash', T.id + '.dash', T.x, T.z, RIVAL_KNOCK_H.dash);
  }
  K.sim_dashHit = mask;
}
