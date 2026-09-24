// BLOCKTOOTH — MOLO kit: SMASH TANK (CONTRACT §8). Lane titan-sim. THREE-free, deterministic.
//   Auto  CURB BITE      — cone snap, head turns ±70° to catch a target, bites ahead while plowing.
//   Pass  FOOT-PULSE     — every `pulseEvery` footsteps: ring damage around the feet.
//   Hook  GULLET VACUUM  — 1.2 s inhale: pickups fly in (3× speed, +25 % raw mass), small foes are
//                          dragged to the jaws and chewed; on release a shield scaled by the haul.
// Kit state (titan.kit): vacuumT (view: inhale anim), vacAfterT, vacCount, vacTick, pulseMark, headTurn.

import type { DamageOpts, Enemy, Shape, World } from '../../core/types.ts';
import { circleInShape, headingOf, rectInShape, wrapAngle } from '../../core/math.ts';
import { damageArea, damageEnemy, titanDamage } from '../../combat/damage.ts';
import { findTarget } from '../../combat/targeting.ts';
import { enemiesInCircle, enemiesInShape } from '../../combat/spatial.ts';
import { magnetAll } from '../../combat/pickups.ts';
import { buildingsInRect, propsInRect } from '../../city/citysim.ts';
import { ENEMIES } from '../../data/enemies.ts';
import { titanMaxSpeed } from '../titansim.ts';
import {
  S, aimPoint, autoInterval, emitAbility, emitAttack, faceToward, hookCooldown, idleAuto, isPlowing, knockFor, kv,
  propRadius, rearmAuto, setMoveMul,
} from './common.ts';

type ConeShape = Extract<Shape, { k: 'cone' }>;

/** Tuning (balance gate edits these; mutable so probes can sweep them at runtime). */
export const MOLO = {
  biteEveryS: 0.75,        // ÷ attackRate
  biteRangeH: 0.9,         // × H × attackRange
  biteHalfDeg: 50,         // + biteCleaveDeg × biteCleave
  biteCleaveDeg: 10,
  biteMaxHalfDeg: 170,
  biteDmg: 22,
  biteAimDeg: 70,          // head turns this far to catch a target
  biteKnock: 0.6,
  pulseRH: 1.4,            // × H × area
  pulseDmg: 6,
  pulseKnock: 0.8,
  vacCdS: 9,
  vacChannelS: 1.2,
  vacRH: 6,                // × H × vacuumRadius × area
  vacPullMul: 3,           // pickups magnetize at this × the normal pull speed
  vacBasePullPerMaxSpeed: 1.6, // normal pickup pull = max(vacBasePullMin, this × titanMaxSpeed) (combat/pickups.ts)
  vacBasePullMin: 10,
  vacDragHPerS: 1.5,       // crushable foes dragged to the jaws (H/s)
  vacDps: 12,
  vacTickS: 0.2,           // vacuum chew ticks at 5 Hz
  vacShieldBase: 0.04,     // × maxHp
  vacShieldPer: 0.002,     // × maxHp per pickup vacuumed
  vacShieldCap: 0.4,
  vacMassMul: 1.25,        // × growth XP while inhaling (SIZE is level-driven since 2026-09-24)
  vacAfterS: 0.75,         // the +XP window after release (pickups still in flight)
  vacMoveMul: 0.5,         // MOLO plants its feet while inhaling
};

const DEG = Math.PI / 180;
const enemyBuf: Enemy[] = [];
const idBuf: number[] = [];
const aim = { x: 0, z: 0 };
/** scratch forward cone (no per-tick allocation) */
const FWD: ConeShape = { k: 'cone', x: 0, z: 0, dir: 0, half: 0, r: 0 };
const BITE_OPTS: DamageOpts = { src: 'titan', kind: 'bite' };
const PULSE_OPTS: DamageOpts = { src: 'titan', kind: 'pulse' };
const CHEW_OPTS: DamageOpts = { src: 'titan', kind: 'bite', noCity: true, noCrit: true };
/** pickups pulled by the current vacuum (distinct ids), per world */
const vacuumed = new WeakMap<World, Set<number>>();

export function init(): Record<string, number> {
  return { vacuumT: 0, vacAfterT: 0, vacCount: 0, vacTick: 0, pulseMark: 0, headTurn: 0 };
}

export function massMul(w: World): number {
  return kv(w, 'vacuumT') > 0 || kv(w, 'vacAfterT') > 0 ? MOLO.vacMassMul : 1;
}

/** Auto-attack reach (m) right now — pickups.ts latches drops inside ~1.2 × this (kits/index kitReach). */
export function reach(w: World): number {
  return MOLO.biteRangeH * w.titan.height * Math.max(0.1, S(w, 'attackRange'));
}

export function step(w: World): void {
  const T = w.titan, K = T.kit;
  K.vacAfterT = Math.max(0, kv(w, 'vacAfterT') - w.dt);
  K.headTurn *= 0.85;

  // ── hook: GULLET VACUUM ──
  if (kv(w, 'vacuumT') > 0) channel(w);
  else if (w.input.ability && T.abilityCd <= 0) startVacuum(w);

  // ── passive: FOOT-PULSE every `pulseEvery` footsteps ──
  const steps = kv(w, 'sim_steps');
  const every = Math.max(1, Math.round(S(w, 'pulseEvery')));
  if (steps - kv(w, 'pulseMark') >= every) {
    K.pulseMark = steps;
    footPulse(w);
  } else if (steps < kv(w, 'pulseMark')) K.pulseMark = steps;

  // ── auto: CURB BITE (the mouth is busy while inhaling) ──
  if (kv(w, 'vacuumT') > 0) { idleAuto(w); return; }
  if (T.autoCd > 0) return;
  const reach = MOLO.biteRangeH * T.height * Math.max(0.1, S(w, 'attackRange'));
  const half = biteHalf(w);
  const t = findTarget(w, T.x, T.z, reach, true);
  let dir: number | null = null;
  if (t) {
    aimPoint(w, t, T.x, T.z, aim);
    const a = headingOf(aim.x - T.x, aim.z - T.z);
    const off = wrapAngle(a - T.heading);
    if (Math.abs(off) <= MOLO.biteAimDeg * DEG) dir = a;
    else faceToward(w, a);                               // swivel toward it while idle
  }
  if (dir === null) {
    // "else ahead": snap straight ahead — but only at something real (never a swing at air):
    // the walls it is grinding through, or anything already inside the forward cone.
    FWD.x = T.x; FWD.z = T.z; FWD.dir = T.heading; FWD.half = half; FWD.r = reach;
    if (isPlowing(w) || (t !== null && coneHasTarget(w, FWD))) dir = T.heading;
  }
  if (dir === null) { idleAuto(w); return; }
  bite(w, dir, reach, half);
  rearmAuto(w, autoInterval(w, MOLO.biteEveryS));
}

function biteHalf(w: World): number {
  return Math.min(MOLO.biteMaxHalfDeg, MOLO.biteHalfDeg + MOLO.biteCleaveDeg * Math.max(0, S(w, 'biteCleave'))) * DEG;
}

/** Anything hittable inside the cone? (enemy body, boss part, standing building, live prop) */
function coneHasTarget(w: World, s: ConeShape): boolean {
  const n = enemiesInShape(w, s, enemyBuf).length;
  enemyBuf.length = 0;
  if (n > 0) return true;
  const B = w.boss;
  if (B && B.alive && B.introT <= 0) {
    for (let i = 0; i < B.parts.length; i++) if (circleInShape(s, B.parts[i].x, B.parts[i].z, B.parts[i].r)) return true;
  }
  buildingsInRect(w.city, s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const b = w.city.buildings[idBuf[i]];
    if (b && !b.collapsed && b.alive > 0 && rectInShape(s, b.x, b.z, b.w, b.d)) return true;
  }
  propsInRect(w.city, s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const p = w.city.props[idBuf[i]];
    if (p && p.alive && circleInShape(s, p.x, p.z, propRadius(p))) return true;
  }
  return false;
}

function bite(w: World, dir: number, reach: number, half: number): void {
  const T = w.titan;
  const shape: Shape = { k: 'cone', x: T.x, z: T.z, dir, half, r: reach };
  BITE_OPTS.knock = knockFor(w, MOLO.biteKnock);
  const hits = damageArea(w, shape, titanDamage(w, MOLO.biteDmg), BITE_OPTS);
  T.kit.headTurn = wrapAngle(dir - T.heading);
  emitAttack(w, 'curbBite', T.x, T.z, dir, reach, hits);
}

function footPulse(w: World): void {
  const T = w.titan;
  const r = MOLO.pulseRH * T.height * Math.max(0.1, S(w, 'area'));
  PULSE_OPTS.knock = knockFor(w, MOLO.pulseKnock);
  damageArea(w, { k: 'circle', x: T.x, z: T.z, r }, titanDamage(w, MOLO.pulseDmg), PULSE_OPTS);
  w.events.push({ type: 'pulse', x: T.x, z: T.z, r });
}

function vacRadius(w: World): number {
  return MOLO.vacRH * w.titan.height * Math.max(0.1, S(w, 'vacuumRadius')) * Math.max(0.1, S(w, 'area'));
}

function startVacuum(w: World): void {
  const T = w.titan, K = T.kit;
  K.vacuumT = MOLO.vacChannelS;
  K.vacCount = 0;
  K.vacTick = 0;
  let set = vacuumed.get(w);
  if (!set) { set = new Set<number>(); vacuumed.set(w, set); }
  set.clear();
  T.abilityCd = hookCooldown(w, MOLO.vacCdS);
  setMoveMul(w, MOLO.vacMoveMul);
  emitAbility(w, 'molo', Math.max(0, S(w, 'abilityPower')));
}

function channel(w: World): void {
  const T = w.titan, K = T.kit;
  const dt = w.dt;
  const R = vacRadius(w);
  const power = Math.max(0, S(w, 'abilityPower'));
  const mouthX = T.x + Math.sin(T.heading) * T.radius;
  const mouthZ = T.z + Math.cos(T.heading) * T.radius;
  setMoveMul(w, MOLO.vacMoveMul);

  // pickups: flag them magnetized (pickups lane pulls + collects), then add the extra 2× pull here
  magnetAll(w, R);
  const set = vacuumed.get(w);
  const extra = (MOLO.vacPullMul - 1) * Math.max(MOLO.vacBasePullMin, MOLO.vacBasePullPerMaxSpeed * titanMaxSpeed(w)) * dt;
  const R2 = R * R;
  for (let i = 0; i < w.pickups.length; i++) {
    const p = w.pickups[i];
    if (!p.alive) continue;
    const dx = mouthX - p.x, dz = mouthZ - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > R2) continue;
    p.magnet = true;
    if (set && !set.has(p.id)) set.add(p.id);
    const d = Math.sqrt(d2);
    const room = d - T.radius * 0.35;
    if (room > 0) {
      const s = Math.min(extra, room) / (d || 1);
      p.x += dx * s; p.z += dz * s;
    }
  }
  K.vacCount = set ? set.size : 0;

  // small foes: dragged to the jaws, chewed at 5 Hz
  K.vacTick = kv(w, 'vacTick') + dt;
  const chew = K.vacTick >= MOLO.vacTickS;
  if (chew) K.vacTick -= MOLO.vacTickS;
  const drag = MOLO.vacDragHPerS * T.height * dt;
  const chewDmg = titanDamage(w, MOLO.vacDps * MOLO.vacTickS) * power;
  enemiesInCircle(w, T.x, T.z, R, enemyBuf);
  for (let i = 0; i < enemyBuf.length; i++) {
    const e = enemyBuf[i];
    if (!e.alive || e.elite) continue;
    const def = ENEMIES[e.kind];
    if (!def || !def.crushable) continue;
    const dx = mouthX - e.x, dz = mouthZ - e.z;
    const d = Math.hypot(dx, dz);
    const room = d - (T.radius * 0.5 + e.radius);
    if (room > 0) { const s = Math.min(drag, room) / d; e.x += dx * s; e.z += dz * s; }
    if (chew && chewDmg > 0) damageEnemy(w, e, chewDmg, CHEW_OPTS);
  }
  enemyBuf.length = 0;

  // release
  K.vacuumT = kv(w, 'vacuumT') - dt;
  if (K.vacuumT <= 0) {
    K.vacuumT = 0;
    K.vacAfterT = MOLO.vacAfterS;
    setMoveMul(w, 1);
    const n = K.vacCount;
    const frac = Math.min(MOLO.vacShieldCap, MOLO.vacShieldBase + MOLO.vacShieldPer * n) * power;
    if (frac > 0 && T.maxHp > 0) w.upgrades.shield += T.maxHp * frac;
    if (set) set.clear();
  }
}
