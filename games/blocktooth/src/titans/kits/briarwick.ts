// BLOCKTOOTH — BRIARWICK kit: AREA CONTROL (CONTRACT §8). Lane titan-sim. THREE-free, deterministic.
//   Auto  VINE LASH      — lane from the titan toward the target; hits everything in the lane.
//   Pass  BLOOM TURRETS  — floor breaks within 3H root a `bloom` hazard turret on the rubble (35 %,
//                          collapses 100 %); turrets spit `seed` projectiles and pulse healing spores.
//   Hook  SOW            — up to 3 nearby rubble sites sprout turrets now; a spore cloud heals over 3 s
//                          and slows foes 40 %.
// Kit state (titan.kit): turrets (live bloom count), sowT (cloud time left, view).

import type { Building, DamageOpts, Enemy, Hazard, World } from '../../core/types.ts';
import { headingOf } from '../../core/math.ts';
import { damageArea, rollCrit, titanDamage } from '../../combat/damage.ts';
import { findTarget } from '../../combat/targeting.ts';
import { nearestEnemy } from '../../combat/spatial.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { buildingsInRect, nearestRubble } from '../../city/citysim.ts';
import { healTitan } from '../titansim.ts';
import {
  S, aimPoint, autoInterval, closestOnBuilding, distToBuilding, emitAbility, emitAttack, faceToward, hookCooldown,
  idleAuto, knockFor, kv, makeRoom, rearmAuto, titanHazards,
} from './common.ts';

/** Tuning (balance gate edits these; mutable so probes can sweep them at runtime). */
export const BRIAR = {
  vineEveryS: 1.0,         // ÷ attackRate
  vineLenH: 2.6,           // × H × vineLength × attackRange
  vineWH: 0.35,            // × H × area
  vineDmg: 17,
  vineKnock: 0.5,
  bloomNearH: 3,           // floor breaks within this many H root turrets
  bloomFloorChance: 0.35,  // per floor broken (collapse: always)
  bloomLifeS: 20,
  bloomRH: 0.3,            // turret footprint (visual / hazard shape), × H at spawn
  bloomFirstShotS: 0.4,
  seedRangeH: 3.5,
  seedEveryS: 1.2,         // ÷ turretRate
  seedRetryS: 0.25,        // no target in range: look again this soon
  seedDmg: 8,
  seedSpeedH: 7,           // H/s (min seedMinSpeed m/s)
  seedMinSpeed: 10,
  seedRH: 0.12,            // hit radius × H (min 0.3 m)
  seedLifePad: 1.4,
  sporeEveryS: 4,
  sporeNearH: 2,
  sporeHealFrac: 0.01,     // × maxHp × sporeHeal
  sowCdS: 10,
  sowRangeH: 5,
  sowMax: 3,
  cloudRH: 2.5,            // × H × area
  cloudS: 3,
  cloudHealFrac: 0.08,     // × maxHp × sporeHeal, spread over cloudS
  cloudTickS: 0.5,
  cloudSlowMul: 0.6,       // foes move at 60 % (40 % slow) — via the hazard's data.slow
};

const hazBuf: Hazard[] = [];
const idBuf: number[] = [];
const rubbleBuf: number[] = [];
const aim = { x: 0, z: 0 };
const pt = { x: 0, z: 0 };
const VINE_OPTS: DamageOpts = { src: 'titan', kind: 'vine' };

/** Floor-break detection by footprint diff (catches breaks from every source and every point of the
 *  tick — contact, lash, seeds, triggers): building id → alive floors / last tick seen, per world. */
interface BreakCache { alive: Map<number, number>; seen: Map<number, number>; }
const caches = new WeakMap<World, BreakCache>();

export function init(): Record<string, number> {
  return { turrets: 0, sowT: 0 };
}

/** Auto-attack reach (m) right now — pickups.ts latches drops inside ~1.2 × this (kits/index kitReach). */
export function reach(w: World): number {
  return BRIAR.vineLenH * w.titan.height * Math.max(0.1, S(w, 'vineLength')) * Math.max(0.1, S(w, 'attackRange'));
}

export function step(w: World): void {
  const T = w.titan, K = T.kit;
  K.sowT = Math.max(0, kv(w, 'sowT') - w.dt);

  detectBreaks(w);
  stepTurrets(w);
  stepClouds(w);

  // ── hook: SOW ──
  if (w.input.ability && T.abilityCd <= 0) sow(w);
  K.turrets = titanHazards(w, 'bloom', hazBuf).length;

  // ── auto: VINE LASH ──
  if (T.autoCd > 0) return;
  const H = T.height;
  const len = BRIAR.vineLenH * H * Math.max(0.1, S(w, 'vineLength')) * Math.max(0.1, S(w, 'attackRange'));
  const t = findTarget(w, T.x, T.z, len, true);
  if (!t) { idleAuto(w); return; }
  aimPoint(w, t, T.x, T.z, aim);
  const dir = headingOf(aim.x - T.x, aim.z - T.z);
  const width = BRIAR.vineWH * H * Math.max(0.1, S(w, 'area'));
  VINE_OPTS.knock = knockFor(w, BRIAR.vineKnock);
  const hits = damageArea(w, { k: 'lane', x: T.x, z: T.z, dir, len, w: width }, titanDamage(w, BRIAR.vineDmg), VINE_OPTS);
  const x1 = T.x + Math.sin(dir) * len, z1 = T.z + Math.cos(dir) * len;
  w.events.push({ type: 'vine', x0: T.x, z0: T.z, x1, z1 });
  emitAttack(w, 'vineLash', T.x, T.z, dir, len, hits);
  faceToward(w, dir);
  rearmAuto(w, autoInterval(w, BRIAR.vineEveryS));
}

// ─────────────────────────────── bloom turrets ───────────────────────────────
function spawnTurret(w: World, x: number, z: number): void {
  const T = w.titan;
  const cap = Math.max(1, Math.round(S(w, 'turretCap')));
  makeRoom(titanHazards(w, 'bloom', hazBuf), cap);       // oldest replaced
  const h = spawnHazard(w, {
    owner: 'titan', kind: 'bloom',
    shape: { k: 'circle', x, z, r: BRIAR.bloomRH * T.height },
    life: BRIAR.bloomLifeS,
    dps: 0,
    data: { cd: BRIAR.bloomFirstShotS, spore: BRIAR.sporeEveryS, h: T.height, shots: 0 },
  });
  w.events.push({ type: 'bloomSpawn', id: h.id, x, z });
}

function detectBreaks(w: World): void {
  const T = w.titan;
  let c = caches.get(w);
  if (!c) { c = { alive: new Map(), seen: new Map() }; caches.set(w, c); }
  if (c.alive.size > 4096) { c.alive.clear(); c.seen.clear(); }
  const near = BRIAR.bloomNearH * T.height;
  buildingsInRect(w.city, T.x - near, T.z - near, T.x + near, T.z + near, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const id = idBuf[i];
    const b = w.city.buildings[id];
    if (!b) continue;
    const prev = c.alive.get(id);
    const seenTick = c.seen.get(id);
    c.alive.set(id, b.alive);
    c.seen.set(id, w.tick);
    // only trust the diff if we watched this building last tick (no stale credit on re-entry)
    if (prev === undefined || seenTick !== w.tick - 1 || b.alive >= prev) continue;
    if (distToBuilding(b, T.x, T.z) > near) continue;
    if (b.collapsed || b.alive <= 0) { spawnTurret(w, b.x, b.z); continue; }
    const broken = prev - b.alive;
    for (let k = 0; k < broken; k++) {
      if (w.rng.combat() < BRIAR.bloomFloorChance) {
        rubbleSpot(b, T.x, T.z);
        spawnTurret(w, pt.x, pt.z);
        break;                                            // one sprout per building per tick
      }
    }
  }
}

/** Rubble spills at the footprint edge nearest the titan (CONTRACT §5.4). */
function rubbleSpot(b: Building, fx: number, fz: number): void {
  closestOnBuilding(b, fx, fz, pt);
}

function stepTurrets(w: World): void {
  const T = w.titan;
  const dt = w.dt;
  const H = T.height;
  const range = BRIAR.seedRangeH * H;
  const rate = Math.max(0.1, S(w, 'turretRate'));
  const sporeR = BRIAR.sporeNearH * H;
  const turrets = titanHazards(w, 'bloom', hazBuf);
  for (let i = 0; i < turrets.length; i++) {
    const h = turrets[i];
    const s = h.shape;
    const hx = s.k === 'circle' ? s.x : T.x, hz = s.k === 'circle' ? s.z : T.z;
    const d = h.data;
    d.cd = (d.cd ?? 0) - dt;
    if (d.cd <= 0) {
      const e = nearestEnemy(w, hx, hz, range);
      // d.shots counts seeds actually fired: the view keys the pod's petal-open/recoil off it (A1) —
      // a no-target retry re-arms d.cd too, so a cooldown jump alone is not a shot
      if (e) { fireSeed(w, hx, hz, e, range); d.cd = BRIAR.seedEveryS / rate; d.shots = (d.shots ?? 0) + 1; }
      else d.cd = BRIAR.seedRetryS;
    }
    d.spore = (d.spore ?? BRIAR.sporeEveryS) - dt;
    if (d.spore <= 0) {
      d.spore += BRIAR.sporeEveryS;
      w.events.push({ type: 'spore', x: hx, z: hz, r: sporeR });
      const dx = T.x - hx, dz = T.z - hz;
      if (Math.hypot(dx, dz) <= sporeR + T.radius) {
        healTitan(w, T.maxHp * BRIAR.sporeHealFrac * Math.max(0, S(w, 'sporeHeal')));
      }
    }
  }
}

function fireSeed(w: World, x: number, z: number, e: Enemy, range: number): void {
  const H = w.titan.height;
  const dx = e.x - x, dz = e.z - z;
  const d = Math.hypot(dx, dz) || 1;
  const speed = Math.max(BRIAR.seedMinSpeed, BRIAR.seedSpeedH * H);
  const c = rollCrit(w, titanDamage(w, BRIAR.seedDmg));
  spawnProjectile(w, {
    owner: 'titan', kind: 'seed',
    x, z, y: Math.max(0.3, 0.35 * H),
    vx: (dx / d) * speed, vz: (dz / d) * speed,
    dmg: c.dmg, crit: c.crit,
    r: Math.max(0.3, BRIAR.seedRH * H),
    life: ((range + e.radius) / speed) * BRIAR.seedLifePad,
    pierce: 0,
  });
}

// ─────────────────────────────── SOW + spore clouds ───────────────────────────────
function sow(w: World): void {
  const T = w.titan, K = T.kit;
  const H = T.height;
  const power = Math.max(0, S(w, 'abilityPower'));
  T.abilityCd = hookCooldown(w, BRIAR.sowCdS);
  nearestRubble(w.city, T.x, T.z, BRIAR.sowRangeH * H, BRIAR.sowMax, rubbleBuf);
  let planted = 0;
  for (let i = 0; i < rubbleBuf.length && planted < BRIAR.sowMax; i++) {
    const b = w.city.buildings[rubbleBuf[i]];
    if (!b) continue;
    spawnTurret(w, b.x, b.z);
    planted++;
  }
  if (planted === 0) {
    // no rubble in reach: one sprout right ahead so the button always does something
    spawnTurret(w, T.x + Math.sin(T.heading) * H, T.z + Math.cos(T.heading) * H);
  }
  const r = BRIAR.cloudRH * H * Math.max(0.1, S(w, 'area'));
  spawnHazard(w, {
    owner: 'titan', kind: 'spore',
    shape: { k: 'circle', x: T.x, z: T.z, r },
    life: BRIAR.cloudS,
    dps: 0,
    data: { heal: T.maxHp * BRIAR.cloudHealFrac * Math.max(0, S(w, 'sporeHeal')) * Math.max(0.25, power), tick: 0, slow: 1 - BRIAR.cloudSlowMul },
  });
  K.sowT = BRIAR.cloudS;
  w.events.push({ type: 'spore', x: T.x, z: T.z, r });
  emitAbility(w, 'briarwick', power);
}

/** Titan-owned spore clouds heal the titan over the cloud's life (the 40 % slow on foes is the generic
 *  hazard slow: the cloud carries data.slow, applied by combat/hazards.ts at 5 Hz). */
function stepClouds(w: World): void {
  const T = w.titan;
  const clouds = titanHazards(w, 'spore', hazBuf);
  for (let i = 0; i < clouds.length; i++) {
    const h = clouds[i];
    const s = h.shape;
    if (s.k !== 'circle') continue;
    const d = h.data;
    d.tick = (d.tick ?? 0) + w.dt;
    while (d.tick >= BRIAR.cloudTickS) {
      d.tick -= BRIAR.cloudTickS;
      if (Math.hypot(T.x - s.x, T.z - s.z) <= s.r + T.radius) {
        healTitan(w, (d.heal ?? 0) * (BRIAR.cloudTickS / BRIAR.cloudS));
      }
    }
  }
}
