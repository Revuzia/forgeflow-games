// GENESIS — belief (CONTRACT.md §8.8, §11.1, §11.4): every god act is WITNESSED. Help adds love, harm adds fear, wonder
// some of both, by distance, species bias and each witness's piety and nerve (people/culture.ts witness). This module
// is the god layer's door to that hook: it tallies each god's own record (help / harm / wonder -> the god's alignment,
// which tints the hand and steers rivals), lets the creature watch, and keeps the worship pool:
//
//   worship    generated at shrines and temples (people/work.ts) into each planet's pool per god. Miracles SPEND what is
//              there for bonus potency (up to +50 %) and NEVER fail for lack of it in the default mode.
//   restraint  off by default (pillar 1). When on, a power has a worship cost and a cooldown (powers.json), and an act
//              the god cannot pay for is refused with a readable reason.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { PowerDef } from '../content.ts';
import { witness, type WitnessKind } from '../people/culture.ts';
import { creaturesWatch } from './watch.ts';

export interface ActMagnitudes {
  help?: number;
  harm?: number;
  wonder?: number;
}

/**
 * A god act at `pos` on planet p: the people around see it (love / fear), the god's own record moves, creatures nearby
 * watch (a miracle cast near a creature can be learned). Returns the number of witnesses.
 */
export function godAct(u: Universe, p: Planet, pos: ArrayLike<number> | null, radius: number, m: ActMagnitudes, god = 0, miracle?: string): number {
  const g = u.god.god(god);
  const gain = u.god.law('belief.gain');
  let n = 0;
  const kinds: [WitnessKind, number][] = [['help', m.help ?? 0], ['harm', m.harm ?? 0], ['wonder', m.wonder ?? 0]];
  for (const [k, v] of kinds) {
    if (v <= 0) continue;
    if (pos) n = Math.max(n, witness(p, pos, radius, k, Math.min(2, v * gain), god));
    if (g) g[k] = round2(g[k] + v);
  }
  if (g) {
    g.acts++;
    // alignment: help against harm, remembered with a long tail
    const delta = (m.help ?? 0) - (m.harm ?? 0);
    g.alignment = round3(Math.max(-1, Math.min(1, g.alignment * 0.985 + delta * 0.08)));
  }
  if (pos && miracle) creaturesWatch(u, p, pos, miracle, god);
  return n;
}

/** total worship pooled for a god across every world */
export function worshipOf(u: Universe, god = 0): number {
  let w = 0;
  for (const pl of u.planets) w += pl.people?.worship[god] ?? 0;
  return round2(w);
}

/**
 * Spend up to `amount` worship of a god (the act's own world first, then the others in id order). Returns what was
 * spent. Deterministic: pools are rounded to hundredths like the generation side.
 */
export function spendWorship(u: Universe, god: number, amount: number, first?: Planet): number {
  let left = Math.max(0, amount);
  const order = first ? [first, ...u.planets.filter((q) => q !== first)] : u.planets;
  for (const pl of order) {
    const pool = pl.people?.worship;
    if (!pool || left <= 0) continue;
    const take = Math.min(pool[god] ?? 0, left);
    pool[god] = round2((pool[god] ?? 0) - take);
    left = round2(left - take);
  }
  return round2(Math.max(0, amount) - left);
}

/**
 * Bonus potency for a miracle: spends worship (never more than `cost`) and returns a multiplier 1 .. 1.5. In the
 * default (omnipotent) mode a miracle with no worship behind it still works at full strength (multiplier 1).
 */
export function miraclePotency(u: Universe, p: Planet, god: number, cost: number): number {
  const base = u.god.law('miracles.potency');
  if (cost <= 0) return base;
  if (u.settings.restraint) return base; // in restraint the cost was already paid up front (restraintCheck)
  const spent = spendWorship(u, god, cost * 0.5, p);
  return base * (1 + 0.5 * Math.min(1, spent / Math.max(1e-6, cost * 0.5)));
}

/**
 * Restraint mode (off by default): a power costs worship and has a cooldown. Returns null when the act may go ahead
 * (and charges it), else the reason it is refused. Rivals pay the same way.
 */
export function restraintCheck(u: Universe, power: PowerDef | undefined, god: number, p: Planet | undefined): string | null {
  if (!u.settings.restraint || !power) return null;
  const cost = Math.round((power.cost ?? 0) * u.god.law('restraint.costScale') * 100) / 100;
  const cd = power.cooldown ?? 0;
  const key = `${god}:${power.id}`;
  const ready = u.god.cooldowns[key] ?? -1;
  if (ready > u.tick) {
    const h = Math.ceil((ready - u.tick) / 60);
    return `${power.name} is still gathering strength (${h} hour${h === 1 ? '' : 's'} more). Restraint is on.`;
  }
  if (cost > 0) {
    const have = worshipOf(u, god);
    if (have + 1e-9 < cost) return `${power.name} needs ${cost} worship; you have ${have}. Restraint is on — turn it off for omnipotence.`;
    spendWorship(u, god, cost, p);
  }
  if (cd > 0) u.god.cooldowns[key] = u.tick + cd;
  return null;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
