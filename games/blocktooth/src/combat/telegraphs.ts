// BLOCKTOOTH — ground telegraphs (CONTRACT §5.3, §6.1, §9, combat lane).
// THREE-free, DOM-free, deterministic.
//
// Timing (30 Hz, CONTRACT §2): a telegraph is stepped once per tick starting with the first
// stepTelegraphs AFTER its spawn call (a telegraph spawned from inside stepTelegraphs — e.g. an
// onFire hook — starts next tick). t += dt each step; it FIRES on the step where t ≥ windup
// (so windup 0.6 s = the 18th step). On fire:
//   * titan-owned → damageArea (enemies / boss / city); hostile → the titan (hurtTitan via shape).
//   * `telegraphFire` { id, owner, hit, x, z } (hit = landed on the titan / hit ≥ 1 thing).
//   * onFire(w, tg) is invoked once, after the damage.
//   * active = 0 → one hit, alive = false the same tick.
//   * active > 0 → `dmg` is damage PER SECOND while active: ticks at 5 Hz (first tick on fire,
//     each tick dealing dmg × 0.2) for `active` seconds, then alive = false.

import type { DamageKind, DamageOpts, Owner, Shape, Telegraph, TelegraphStyle, World } from '../core/types.ts';
import { circleInShape, shapeCenter } from '../core/math.ts';
import type { Attacker } from './damage.ts';
import { damageArea, hurtTitanByShape } from './damage.ts';
import { nearestEnemy } from './spatial.ts';

/** Contract spawn record (+ optional titan-side damage modifiers, a superset — callers may omit). */
export type TelegraphSpawn = {
  owner: Owner;
  style: TelegraphStyle;
  shape: Shape;
  windup: number;
  dmg: number;
  kind: DamageKind;
  active?: number;
  onFire?: ((w: World, tg: Telegraph) => void) | null;
  chain?: number[] | null;
  tag?: string;
  /** titan-owned only: knockback impulse (m/s) away from the shape origin */
  knock?: number;
  /** titan-owned only: building/prop damage multiplier (default 1) */
  buildingMul?: number;
  /** titan-owned only: skip the city */
  noCity?: boolean;
  /** titan-owned only: upgrade id that caused it (so triggers do not self-trigger) */
  fromUpgrade?: string;
};

/** Active telegraphs tick at 5 Hz. */
const TICK_S = 0.2;
/** Float slack so windups/landings that are exact multiples of dt fire on the intended tick. */
const EPS = 1e-6;

interface TgExtra {
  opts: DamageOpts | null;       // titan-owned damage opts
  attacker: Attacker;            // hostile: who thorns reflect to
  nextTick: number;              // active: elapsed-since-fire of the next damage tick
}
const extras = new WeakMap<Telegraph, TgExtra>();

/** For hostile lane/cone telegraphs the shooter stands at the origin — remember it for thorns. */
function findAttacker(w: World, owner: Owner, s: Shape, kind: DamageKind): Attacker {
  if (owner === 'boss') return { kind: 'boss' };
  if (owner !== 'enemy') return null;
  let x: number, z: number, r: number;
  let want: string | null = null;
  if (s.k === 'lane' || s.k === 'cone') { x = s.x; z = s.z; r = 4; }
  else if (kind === 'dive' && s.k === 'circle') { x = s.x; z = s.z; r = s.r + 12; want = 'drone'; }
  else if (kind === 'ram' && s.k === 'capsule') { x = s.x0; z = s.z0; r = 8; want = 'elite'; }
  else return null;
  const e = want
    ? nearestEnemy(w, x, z, r, (c) => c.kind === want)
    : nearestEnemy(w, x, z, r);
  return e ? { kind: 'enemy', id: e.id } : null;
}

/** Spawn a telegraph (emits `telegraphStart`). */
export function spawnTelegraph(w: World, t: TelegraphSpawn): Telegraph {
  const tg: Telegraph = {
    id: w.nextId++,   // same semantics as core/world.ts newId
    alive: true,
    owner: t.owner,
    style: t.style,
    shape: t.shape,
    windup: Number.isFinite(t.windup) && t.windup > 0 ? t.windup : 0,
    t: 0,
    active: Number.isFinite(t.active) && (t.active as number) > 0 ? (t.active as number) : 0,
    dmg: Number.isFinite(t.dmg) && t.dmg > 0 ? t.dmg : 0,
    kind: t.kind,
    fired: false,
    hitTitan: false,
    onFire: t.onFire ?? null,
    chain: t.chain ?? null,
    tag: t.tag ?? '',
  };
  let opts: DamageOpts | null = null;
  if (t.owner === 'titan') {
    opts = { src: 'titan', kind: t.kind };
    if (t.knock !== undefined) opts.knock = t.knock;
    if (t.buildingMul !== undefined) opts.buildingMul = t.buildingMul;
    if (t.noCity) opts.noCity = true;
    if (t.fromUpgrade !== undefined) opts.fromUpgrade = t.fromUpgrade;
  }
  const attacker = t.owner === 'titan' ? null : findAttacker(w, t.owner, t.shape, t.kind);
  extras.set(tg, { opts, attacker, nextTick: 0 });
  w.telegraphs.push(tg);
  w.events.push({ type: 'telegraphStart', id: tg.id, owner: tg.owner, style: tg.style });
  return tg;
}

function extraOf(w: World, tg: Telegraph): TgExtra {
  let x = extras.get(tg);
  if (!x) {
    // a telegraph pushed without spawnTelegraph — derive defaults
    x = {
      opts: tg.owner === 'titan' ? { src: 'titan', kind: tg.kind } : null,
      attacker: tg.owner === 'boss' ? { kind: 'boss' } : null,
      nextTick: 0,
    };
    extras.set(tg, x);
  }
  return x;
}

/** One damage application; returns whether it hit (titan for hostile, ≥ 1 thing for titan-owned). */
function applyDamage(w: World, tg: Telegraph, x: TgExtra, dmg: number, first: boolean): boolean {
  if (tg.owner === 'titan') {
    if (!(dmg > 0)) return false;
    let opts = x.opts ?? { src: 'titan', kind: tg.kind };
    // DoT ticks after the first never crit (one crit roll per telegraph at fire)
    if (!first && opts.crit === undefined) opts = { ...opts, noCrit: true };
    return damageArea(w, tg.shape, dmg, opts) > 0;
  }
  const T = w.titan;
  if (!(dmg > 0)) return T.alive && circleInShape(tg.shape, T.x, T.z, T.radius);
  // an active (dps) telegraph is damage-over-time: every tick, including the first, is a DoT tick
  return hurtTitanByShape(w, tg.shape, dmg, tg.kind, x.attacker, tg.active > 0);
}

/** Advance every telegraph: windup → fire (+ 5 Hz active ticks) → dead. */
export function stepTelegraphs(w: World): void {
  const list = w.telegraphs;
  const dt = w.dt;
  const n = list.length;   // telegraphs spawned during this pass start next tick
  for (let i = 0; i < n; i++) {
    const tg = list[i];
    if (!tg.alive) continue;
    tg.t += dt;
    const x = extraOf(w, tg);
    if (!tg.fired) {
      if (tg.t + EPS < tg.windup) continue;
      tg.fired = true;
      const first = applyDamage(w, tg, x, tg.active > 0 ? tg.dmg * TICK_S : tg.dmg, true);
      if (first && tg.owner !== 'titan') tg.hitTitan = true;
      const c = shapeCenter(tg.shape);
      w.events.push({ type: 'telegraphFire', id: tg.id, owner: tg.owner, hit: first, x: c.x, z: c.z });
      if (tg.onFire) tg.onFire(w, tg);
      x.nextTick = TICK_S;
      if (tg.active <= 0) { tg.alive = false; }
      continue;
    }
    // active phase
    const since = tg.t - tg.windup;
    while (tg.alive && x.nextTick < tg.active - EPS && since + EPS >= x.nextTick) {
      const hit = applyDamage(w, tg, x, tg.dmg * TICK_S, false);
      if (hit && tg.owner !== 'titan') tg.hitTitan = true;
      x.nextTick += TICK_S;
    }
    if (since + EPS >= tg.active) tg.alive = false;
  }
}
