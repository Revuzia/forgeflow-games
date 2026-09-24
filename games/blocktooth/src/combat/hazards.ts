// BLOCKTOOTH — ground hazards (CONTRACT §5.3, combat lane). THREE-free, DOM-free, deterministic.
//
// Generic behaviour only (kit-specific logic — bloom turret firing, wire detonation — lives in the
// kits and reads/writes Hazard.data):
//   * lifetime: t += dt; alive = false once t ≥ life.
//   * dps: applied to the OPPOSING side at 5 Hz (each tick = dps × 0.2). The first tick lands on the
//     hazard's first step, so stepping into fresh fire hurts immediately.
//       titan-owned → damageArea(src 'hazard', no crits, buildings × 0.5)
//       hostile     → the titan (hurtTitan via the shape)
//   * slow: `frost` hazards (or any hazard with data.slow = fraction) slow the opposing side by 40 %
//     (data.slow overrides): enemies get slowT/slowMul, the titan gets titan.slowT/slowMul.

import type { DamageKind, DamageOpts, Enemy, Hazard, HazardKind, Owner, Shape, World } from '../core/types.ts';
import { circleInShape } from '../core/math.ts';
import { damageArea, hurtTitanByShape } from './damage.ts';
import { enemiesInShape } from './spatial.ts';

export type HazardSpawn = {
  owner: Owner;
  kind: HazardKind;
  shape: Shape;
  life: number;
  dps?: number;
  data?: Record<string, number>;
};

/** Hazards tick at 5 Hz. */
const TICK_S = 0.2;
/** Default slow fraction for frost (40 %). */
const FROST_SLOW = 0.4;
/** Slow duration refreshed every tick while inside (covers the 5 Hz gap + a short linger). */
const SLOW_LINGER_S = 0.35;
/** Titan-owned hazards hit buildings/props at this multiplier (DamageOpts.buildingMul doc). */
const HAZARD_BUILDING_MUL = 0.5;
const EPS = 1e-9;

function damageKindOf(k: HazardKind): DamageKind {
  switch (k) {
    case 'wire': return 'wire';
    case 'magma': return 'magma';
    case 'bloom': return 'seed';
    case 'spore': return 'spore';
    case 'frost': return 'breath';
    case 'fire': return 'magma';
    case 'oil': return 'generic';
  }
  return 'generic';
}

const optsCache = new Map<HazardKind, DamageOpts>();
function titanOpts(k: HazardKind): DamageOpts {
  let o = optsCache.get(k);
  if (!o) {
    o = { src: 'hazard', kind: damageKindOf(k), noCrit: true, buildingMul: HAZARD_BUILDING_MUL };
    optsCache.set(k, o);
  }
  return o;
}

/** Spawn a hazard. `dps` defaults to 0 (pure area/slow/kit marker); `data` is owner-private. */
export function spawnHazard(w: World, h: HazardSpawn): Hazard {
  const hz: Hazard = {
    id: w.nextId++,   // same semantics as core/world.ts newId
    alive: true,
    owner: h.owner,
    kind: h.kind,
    shape: h.shape,
    t: 0,
    life: Number.isFinite(h.life) && h.life > 0 ? h.life : 0.001,
    dps: h.dps !== undefined && Number.isFinite(h.dps) && h.dps > 0 ? h.dps : 0,
    tickT: TICK_S,   // first damage/slow tick on the first step
    data: h.data ?? {},
  };
  w.hazards.push(hz);
  return hz;
}

function slowFrac(h: Hazard): number {
  const d = h.data.slow;
  if (d !== undefined && Number.isFinite(d) && d > 0) return Math.min(0.95, d);
  return h.kind === 'frost' ? FROST_SLOW : 0;
}

const slowList: Enemy[] = [];

function applySlow(w: World, h: Hazard, frac: number): void {
  const mul = 1 - frac;
  if (h.owner === 'titan') {
    enemiesInShape(w, h.shape, slowList);
    for (let i = 0; i < slowList.length; i++) {
      const e = slowList[i];
      if (!e.alive) continue;
      // the stronger slow wins while both are live
      if (e.slowT > 0 && e.slowMul < mul) continue;   // a stronger slow is live; ours re-applies when it lapses
      e.slowT = Math.max(e.slowT, SLOW_LINGER_S);
      e.slowMul = mul;
    }
    slowList.length = 0;
    return;
  }
  const T = w.titan;
  if (!T.alive || !circleInShape(h.shape, T.x, T.z, T.radius)) return;
  if (T.slowT > 0 && T.slowMul < mul) return;
  T.slowT = Math.max(T.slowT, SLOW_LINGER_S);
  T.slowMul = mul;
}

/** Age, expire, and apply generic dps / slows at 5 Hz. */
export function stepHazards(w: World): void {
  const list = w.hazards;
  const dt = w.dt;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const h = list[i];
    if (!h.alive) continue;
    h.t += dt;
    if (h.t >= h.life - EPS) { h.alive = false; continue; }
    h.tickT += dt;
    while (h.tickT + EPS >= TICK_S && h.alive) {
      h.tickT -= TICK_S;
      const frac = slowFrac(h);
      if (frac > 0) applySlow(w, h, frac);
      if (h.dps > 0) {
        const dmg = h.dps * TICK_S;
        if (h.owner === 'titan') damageArea(w, h.shape, dmg, titanOpts(h.kind));
        else hurtTitanByShape(w, h.shape, dmg, damageKindOf(h.kind), null, true);   // DoT tick
      }
    }
  }
}
