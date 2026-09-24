// BLOCKTOOTH — HEARTHBACK kit: ERUPTION FORTRESS (CONTRACT §8). Lane titan-sim. THREE-free, deterministic.
//   Auto  MAGMA STOMP  — titan-owned circle telegraph at the target (or 1H ahead while plowing),
//                        erupts after `stompDelay`; knockback; optional magma pool (magmaDuration).
//   Pass  SHELL        — stores 60 % of damage taken (post-armor) + 1 per floor broken, up to
//                        shellCapacity × 0.5 × maxHp. View/HUD read kit.stored / kit.cap.
//   Hook  SHELL VENT   — ring burst sized by the store; heals 15 % of the store; resets it.
// Kit state (titan.kit): stored, cap, floorMark, stompT (windup of the stomp in flight, view: raised foot).

import type { DamageOpts, Enemy, Telegraph, World } from '../../core/types.ts';
import { RANKS } from '../../core/config.ts';
import { headingOf } from '../../core/math.ts';
import { damageArea, titanDamage } from '../../combat/damage.ts';
import { findTarget } from '../../combat/targeting.ts';
import { enemiesInCircle } from '../../combat/spatial.ts';
import { spawnTelegraph } from '../../combat/telegraphs.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { healTitan } from '../titansim.ts';
import {
  S, aimPoint, autoInterval, emitAbility, emitAttack, faceToward, hookCooldown, idleAuto, isPlowing, knockFor, kv,
  rearmAuto,
} from './common.ts';

/** Tuning (balance gate edits these; mutable so probes can sweep them at runtime). */
export const HEARTH = {
  stompEveryS: 1.3,        // ÷ attackRate
  stompRangeH: 2.5,        // × H × attackRange
  stompRH: 1.1,            // × H × area
  stompAheadH: 1.0,        // plowing fallback: 1H ahead
  stompDmg: 30,
  stompKnock: 1.4,
  stompMinWindupS: 0.15,
  magmaDps: 8,             // magma pool dps (titanDamage-scaled) when magmaDuration > 0
  magmaRFrac: 0.8,         // pool radius as a fraction of the stomp radius
  shellStoreFrac: 0.6,     // of post-armor damage taken
  shellPerFloor: 1,
  shellCapFrac: 0.5,       // × shellCapacity × maxHp
  ventCdS: 6,
  ventR0H: 1.5,            // radius = (ventR0H + ventRFillH × fill) × H × area
  ventRFillH: 2.5,
  ventDmg: 20,             // base, × titanDamage
  ventPerStored: 2.5,      // per stored point (rank-normalized: stored ÷ RANKS[rank].hpMul, then × titanDamage)
  ventHealFrac: 0.15,
  ventKnock: 2.0,
};

const enemyBuf: Enemy[] = [];
const aim = { x: 0, z: 0 };
const VENT_OPTS: DamageOpts = { src: 'titan', kind: 'vent' };

export function init(): Record<string, number> {
  return { stored: 0, cap: 1, floorMark: 0, stompT: 0 };
}

function shellCap(w: World): number {
  return Math.max(1, Math.max(0, S(w, 'shellCapacity')) * HEARTH.shellCapFrac * w.titan.maxHp);
}

/** SHELL: bank 60 % of the (post-armor) hit; the hit itself still lands. */
export function onHurt(w: World, dmg: number): number {
  const K = w.titan.kit;
  const cap = shellCap(w);
  K.cap = cap;
  K.stored = Math.min(cap, kv(w, 'stored') + Math.max(0, dmg) * HEARTH.shellStoreFrac);
  return dmg;
}

export function step(w: World): void {
  const T = w.titan, K = T.kit;
  const cap = shellCap(w);
  K.cap = cap;
  // +1 per floor broken by the titan (any source: contact, stomps, pools, triggers) — counter delta
  const floors = T.floorsEaten - kv(w, 'floorMark');
  if (floors > 0) K.stored = kv(w, 'stored') + floors * HEARTH.shellPerFloor;
  K.floorMark = T.floorsEaten;
  K.stored = Math.min(cap, Math.max(0, kv(w, 'stored')));
  K.stompT = Math.max(0, kv(w, 'stompT') - w.dt);

  // ── hook: SHELL VENT ──
  if (w.input.ability && T.abilityCd <= 0) vent(w);

  // ── auto: MAGMA STOMP ──
  if (T.autoCd > 0) return;
  const H = T.height;
  const range = HEARTH.stompRangeH * H * Math.max(0.1, S(w, 'attackRange'));
  const t = findTarget(w, T.x, T.z, range, true);
  let x: number, z: number;
  if (t) {
    aimPoint(w, t, T.x, T.z, aim);
    x = aim.x; z = aim.z;
  } else if (isPlowing(w)) {
    x = T.x + Math.sin(T.heading) * HEARTH.stompAheadH * H;
    z = T.z + Math.cos(T.heading) * HEARTH.stompAheadH * H;
  } else { idleAuto(w); return; }

  const r = HEARTH.stompRH * H * Math.max(0.1, S(w, 'area'));
  const windup = Math.max(HEARTH.stompMinWindupS, S(w, 'stompDelay'));
  spawnTelegraph(w, {
    owner: 'titan', style: 'circle',
    shape: { k: 'circle', x, z, r },
    windup,
    dmg: titanDamage(w, HEARTH.stompDmg),
    kind: 'stomp',
    onFire: stompFire,
    tag: 'magmaStomp',
  });
  K.stompT = windup;
  const dir = headingOf(x - T.x, z - T.z);
  emitAttack(w, 'magmaStomp', x, z, dir, r, 0);
  faceToward(w, dir);
  rearmAuto(w, autoInterval(w, HEARTH.stompEveryS));
}

/** Telegraph onFire (damage already applied by the telegraph system): knockback, eruption fx, magma pool. */
function stompFire(w: World, tg: Telegraph): void {
  const s = tg.shape;
  if (s.k !== 'circle') return;
  w.events.push({ type: 'explosion', x: s.x, z: s.z, r: s.r, kind: 'stomp' });
  const knock = knockFor(w, HEARTH.stompKnock);
  if (knock > 0) {
    enemiesInCircle(w, s.x, s.z, s.r, enemyBuf);
    for (let i = 0; i < enemyBuf.length; i++) {
      const e = enemyBuf[i];
      if (!e.alive) continue;
      const dx = e.x - s.x, dz = e.z - s.z;
      const d = Math.hypot(dx, dz);
      const nx = d > 1e-4 ? dx / d : Math.sin(w.titan.heading), nz = d > 1e-4 ? dz / d : Math.cos(w.titan.heading);
      e.kx += nx * knock; e.kz += nz * knock;
    }
    enemyBuf.length = 0;
  }
  const dur = S(w, 'magmaDuration');
  if (dur > 0) {
    spawnHazard(w, {
      owner: 'titan', kind: 'magma',
      shape: { k: 'circle', x: s.x, z: s.z, r: s.r * HEARTH.magmaRFrac },
      life: dur,
      dps: titanDamage(w, HEARTH.magmaDps),
      data: { h: w.titan.height },
    });
  }
}

function vent(w: World): void {
  const T = w.titan, K = T.kit;
  const cap = shellCap(w);
  const stored = Math.min(cap, Math.max(0, kv(w, 'stored')));
  const fill = cap > 0 ? stored / cap : 0;
  const power = Math.max(0, S(w, 'abilityPower'));
  const r = (HEARTH.ventR0H + HEARTH.ventRFillH * fill) * T.height * Math.max(0.1, S(w, 'area'));
  const base = HEARTH.ventDmg + HEARTH.ventPerStored * (stored / RANKS[T.rank].hpMul);
  VENT_OPTS.knock = knockFor(w, HEARTH.ventKnock);
  const hits = damageArea(w, { k: 'circle', x: T.x, z: T.z, r }, titanDamage(w, base) * power, VENT_OPTS);
  T.abilityCd = hookCooldown(w, HEARTH.ventCdS);
  K.stored = 0;
  w.events.push({ type: 'vent', x: T.x, z: T.z, r, power: fill });
  emitAbility(w, 'hearthback', fill);
  if (stored > 0) healTitan(w, stored * HEARTH.ventHealFrac);
}
