// BLOCKTOOTH — IRON GULLY, the pale ridge-backed quadruped of WHITE STACKS (ai lane, CONTRACT §10).
// THREE-free, DOM-free, deterministic (world.rng.boss only).
//
// Body: body r20 · beaked head r8 (hp ×1.6, FRACTURE ×2.0) · scrap-plate sail r10 (FRACTURE ×2.5)
// · 4 legs r6. Footwork: closes to 50–80 m at 9 m/s, always facing the titan.
// Attacks (EXACT per phase, §10):
//   P1  coneBreath  cone half 28°, r 140, 1.8 s windup then 1.2 s active (dps); leaves frost
//                   hazards (slow) along the sightline
//       pawSlam     ring 0–60 m at 1.3 s, then ring 60–110 m 0.5 s later (both painted at once —
//                   different bands, so they read as a sequence: dash through, or stand clear)
//   P2  + plateVolley  6–10 lobbed 'plate' projectiles with circle tells r 12 around the titan,
//                   1.6 s (spaced so no two circles stack on one spot)
//       + ridgeCharge  lane len 180, w 30, 1.5 s, then it charges down the lane (contact dmg,
//                   side-swipe shove, flattens the city in its path)
//   P3  breath→slam combo (breathSlam: the slam rings are painted only after the breath ends);
//       plate volley density ×2
// Default subtitle "CRACK THE SAIL — BUILD FRACTURE" (data/bosses.ts).

import type { BossState, World } from '../../core/types.ts';
import { TAU, dist, dist2 } from '../../core/math.ts';
import {
  baseBoss, beginAttack, bossHostile, bossTelegraph, bossWindupMul, endAttack, entryPoint, introWalk, keepRange,
  leadPoint, localToWorld, makePart, moveBoss, pickWeighted, repeatMul, shoveTitan, turnBoss,
} from './index.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { damageTitanArea } from '../../combat/damage.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const WALK = 9, INTRO_WALK = 20, TURN = 0.9, AIM_TURN = 1.4;
const MIN_D = 50, MAX_D = 80;
const GAP = [0, 2.8, 2.1, 2.0] as const;
const P3_CADENCE = 0.75;

const BREATH = { half: (28 * Math.PI) / 180, r: 140, windup: 1.8, active: 1.2, dps: 50, recover: 0.6, frostLife: 7 };
const SLAM = { r0: 60, r1: 110, windup: 1.3, gap: 0.5, dmgIn: 60, dmgOut: 45, recover: 0.7 };
const PLATES = { min: 6, max: 10, r: 18, windup: 1.6, stagger: 0.07, dmg: 30, spread: 95, spacing: 30, recover: 0.6 };
const CHARGE = { len: 190, w: 40, windup: 1.5, speed: 72, dmg: 70, recover: 1.1, shovePerH: 1.1 };

const ATTACKS = ['coneBreath', 'pawSlam', 'plateVolley', 'ridgeCharge', 'breathSlam'] as const;
const TMP = { x: 0, z: 0 };

// ─────────────────────────────── module contract ───────────────────────────────
export function create(w: World): BossState {
  const E = { x: 0, z: 0, heading: 0 };
  entryPoint(w, false, E);
  const parts = [
    makePart('body', 0, 0, 20, 18, 50, 1, 0.3),
    makePart('head', 0, 34, 8, 28, 50, 1.6, 2.0),
    makePart('sail', 0, -6, 10, 48, 70, 1, 2.5),
    makePart('legFL', 14, 20, 6, 0, 30, 1, 0.5),
    makePart('legFR', -14, 20, 6, 0, 30, 1, 0.5),
    makePart('legBL', 14, -20, 6, 0, 30, 1, 0.5),
    makePart('legBR', -14, -20, 6, 0, 30, 1, 0.5),
  ];
  const b = baseBoss('irongully', E.x, E.z, E.heading, parts);
  b.data.dir = E.heading;
  return b;
}

/** Beak tip (breath origin), world XZ. */
function beak(b: BossState): { x: number; z: number } {
  return localToWorld(b, 0, 40, TMP);
}

export function step(w: World, b: BossState): void {
  if (b.introT > 0) { introWalk(w, b, INTRO_WALK, MAX_D + 30); return; }
  if (!b.attack) {
    keepRange(w, b, MIN_D, MAX_D, WALK, TURN);
    if (b.cd <= 0) decide(w, b);
  } else {
    if (b.attack !== 'ridgeCharge' || b.attackT < CHARGE.windup) b.data.speed = 0;
    runAttack(w, b);
  }
}

export function onDamage(_w: World, b: BossState, part: number, _dmg: number): void {
  const p = b.parts[part];
  if (p) b.data['hit_' + p.name] = b.data.t;
}

// ─────────────────────────────── decision ───────────────────────────────
function gapFor(w: World, b: BossState): number {
  const g = GAP[b.phase] * (0.85 + 0.3 * w.rng.boss());
  return b.phase === 3 ? g * P3_CADENCE : g;
}

function decide(w: World, b: BossState): void {
  const T = w.titan;
  const d = dist(b.x, b.z, T.x, T.z);
  const P = b.phase;
  const wts = [
    P >= 3 ? 0.5 : (d > 40 ? 1.0 : 0.5),           // coneBreath (P3 prefers the combo)
    (d < 90 + T.radius ? 1.5 : 0.7) * (P >= 3 ? 0.6 : 1),   // pawSlam
    P >= 2 ? 1.0 : 0,                               // plateVolley
    P >= 2 ? (d > 60 ? 1.0 : 0.5) : 0,              // ridgeCharge
    P >= 3 ? 1.5 : 0,                               // breathSlam
  ];
  for (let i = 0; i < wts.length; i++) wts[i] *= repeatMul(b, ATTACKS[i]);
  const id = pickWeighted(w, ATTACKS, wts) ?? 'coneBreath';
  startAttack(w, b, id);
}

const LEAD = { x: 0, z: 0 };
/** Heading from the body to where the titan is heading (leadPoint), with a latched jitter. */
function aim(w: World, b: BossState, jitter: number, windup: number): number {
  const L = leadPoint(w, b, windup, LEAD);
  return Math.atan2(L.x - b.x, L.z - b.z) + (w.rng.boss() * 2 - 1) * jitter;
}

function castBreath(w: World, b: BossState): void {
  const dir = aim(w, b, 0.04, BREATH.windup);
  b.data.dir = dir;
  const o = beak(b);
  const ox = o.x, oz = o.z;
  bossTelegraph(w, {
    style: 'cone', shape: { k: 'cone', x: ox, z: oz, dir, half: BREATH.half, r: BREATH.r },
    windup: BREATH.windup, active: BREATH.active, dmg: bossHostile(w, BREATH.dps), kind: 'breath', tag: 'coneBreath',
    onFire: (w2) => {
      if (!b.alive) return;
      b.data.breath = 1;
      // frost patches settle along the sightline (slow only — they mark where the breath went)
      const fx = Math.sin(dir), fz = Math.cos(dir);
      const Bd = w2.city.bounds;
      for (let k = 0; k < 4; k++) {
        const along = 32 + k * 30;
        const r = Math.min(26, Math.tan(BREATH.half) * along * 0.75 + 4);
        const x = ox + fx * along, z = oz + fz * along;
        if (x < Bd.minX - r || x > Bd.maxX + r || z < Bd.minZ - r || z > Bd.maxZ + r) continue;
        spawnHazard(w2, { owner: 'boss', kind: 'frost', shape: { k: 'circle', x, z, r }, life: BREATH.frostLife, data: { slow: 0.4 } });
      }
    },
  });
  b.data.breathAt = b.attackT;
}

function castSlam(w: World, b: BossState): void {
  const x = b.x, z = b.z;
  bossTelegraph(w, {
    style: 'ring', shape: { k: 'ring', x, z, r0: 0, r1: SLAM.r0 },
    windup: SLAM.windup, dmg: bossHostile(w, SLAM.dmgIn), kind: 'slam', tag: 'pawSlamInner',
  });
  bossTelegraph(w, {
    style: 'ring', shape: { k: 'ring', x, z, r0: SLAM.r0, r1: SLAM.r1 },
    windup: SLAM.windup + SLAM.gap, dmg: bossHostile(w, SLAM.dmgOut), kind: 'slam', tag: 'pawSlamOuter',
  });
  b.data.slamAt = b.attackT;
}

const SPOTS: number[] = [];
function castPlates(w: World, b: BossState): void {
  const T = w.titan, r = w.rng.boss;
  let n = PLATES.min + Math.floor(r() * (PLATES.max - PLATES.min + 1));
  if (b.phase === 3) n *= 2;
  const spread = PLATES.spread * (b.phase === 3 ? 1.3 : 1);
  const Bd = w.city.bounds;
  SPOTS.length = 0;
  // first plate on the titan (latched jitter), the rest scattered around it with spacing
  const j = 5 * Math.sqrt(r()), ja = r() * TAU;
  const L = leadPoint(w, b, PLATES.windup, LEAD);
  SPOTS.push(L.x + Math.sin(ja) * j, L.z + Math.cos(ja) * j);
  const sp2 = PLATES.spacing * PLATES.spacing;
  for (let tries = 0; tries < n * 30 && SPOTS.length < n * 2; tries++) {
    const a = r() * TAU, d = PLATES.spacing + (spread - PLATES.spacing) * Math.sqrt(r());
    const x = L.x + Math.sin(a) * d, z = L.z + Math.cos(a) * d;
    if (x < Bd.minX || x > Bd.maxX || z < Bd.minZ || z > Bd.maxZ) continue;
    let ok = true;
    for (let k = 0; k < SPOTS.length; k += 2) if (dist2(x, z, SPOTS[k], SPOTS[k + 1]) < sp2) { ok = false; break; }
    if (ok) SPOTS.push(x, z);
  }
  const sail = localToWorld(b, 0, -6, { x: 0, z: 0 });
  const dmg = bossHostile(w, PLATES.dmg);
  for (let k = 0, i = 0; k < SPOTS.length; k += 2, i++) {
    const tx = SPOTS[k], tz = SPOTS[k + 1];
    const life = PLATES.windup * bossWindupMul(b) + i * PLATES.stagger;
    spawnProjectile(w, {
      owner: 'boss', kind: 'plate', x: sail.x, z: sail.z, y: 58,
      vx: (tx - sail.x) / life, vz: (tz - sail.z) / life,
      dmg, lob: true, tx, tz, aoe: PLATES.r, life,
    });
  }
  b.data.plates = SPOTS.length / 2;
  b.data.platesEnd = PLATES.windup + (SPOTS.length / 2) * PLATES.stagger;
}

function startAttack(w: World, b: BossState, id: string): void {
  const T = w.titan;
  switch (id) {
    case 'coneBreath':
      beginAttack(w, b, id, T.x, T.z);
      castBreath(w, b);
      break;
    case 'pawSlam':
      beginAttack(w, b, id, b.x, b.z);
      castSlam(w, b);
      break;
    case 'plateVolley':
      beginAttack(w, b, id, T.x, T.z);
      castPlates(w, b);
      break;
    case 'ridgeCharge': {
      const dir = aim(w, b, 0.03, CHARGE.windup);
      beginAttack(w, b, id, T.x, T.z);
      b.data.dir = dir;
      b.data.travel = 0; b.data.rammed = 0;
      const chargeS = CHARGE.len / CHARGE.speed;
      // the lane stays painted (no damage of its own) for the whole run so the path reads
      bossTelegraph(w, {
        style: 'lane', shape: { k: 'lane', x: b.x, z: b.z, dir, len: CHARGE.len, w: CHARGE.w },
        windup: CHARGE.windup, active: chargeS, dmg: 0, kind: 'ram', tag: 'ridgeCharge',
      });
      break;
    }
    case 'breathSlam':
      beginAttack(w, b, id, T.x, T.z);
      b.data.combo = 0;
      castBreath(w, b);
      break;
  }
}

function runAttack(w: World, b: BossState): void {
  const t = b.attackT, dt = w.dt, T = w.titan;
  switch (b.attack) {
    case 'coneBreath':
      turnBoss(b, b.data.dir, AIM_TURN, dt);
      if (t >= BREATH.windup + BREATH.active) b.data.breath = 0;
      if (t >= BREATH.windup + BREATH.active + BREATH.recover) endAttack(b, gapFor(w, b));
      break;
    case 'pawSlam':
      if (t >= SLAM.windup + SLAM.gap + SLAM.recover) endAttack(b, gapFor(w, b));
      break;
    case 'plateVolley':
      if (t >= (b.data.platesEnd ?? PLATES.windup) + PLATES.recover) endAttack(b, gapFor(w, b));
      break;
    case 'ridgeCharge': {
      const dir = b.data.dir;
      turnBoss(b, dir, AIM_TURN * 2, dt);
      if (t < CHARGE.windup) break;
      const left = CHARGE.len - b.data.travel;
      const Bd = w.city.bounds;
      const blocked = b.x <= Bd.minX + 1 || b.x >= Bd.maxX - 1 || b.z <= Bd.minZ + 1 || b.z >= Bd.maxZ - 1;
      if (left > 0 && !(blocked && b.data.travel > 5)) {
        b.heading = dir;
        const v = Math.min(CHARGE.speed, left / dt);
        moveBoss(w, b, Math.sin(dir) * v, Math.cos(dir) * v);
        b.data.travel += v * dt;
        b.data.charge = 1;
        if (!(b.data.rammed > 0) && T.alive) {
          const h = localToWorld(b, 0, 16, TMP);
          if (damageTitanArea(w, { k: 'circle', x: h.x, z: h.z, r: 24 }, bossHostile(w, CHARGE.dmg), 'slam')) {
            b.data.rammed = 1;
            // side-swipe: thrown clear of the lane, away from the ridge's line
            const fx = Math.sin(dir), fz = Math.cos(dir);
            const side = (T.x - b.x) * fz - (T.z - b.z) * fx >= 0 ? 1 : -1;
            if (T.dashT <= 0) shoveTitan(b, fz * side + fx * 0.4, -fx * side + fz * 0.4, CHARGE.shovePerH * T.height);
          }
        }
        b.data.chargeEnd = t;
      } else {
        b.data.charge = 0;
        b.data.speed = 0;
        const endAt = b.data.chargeEnd ?? t;
        if (t >= endAt + CHARGE.recover) endAttack(b, gapFor(w, b));
      }
      break;
    }
    case 'breathSlam': {
      turnBoss(b, b.data.dir, AIM_TURN, dt);
      const breathEnd = BREATH.windup + BREATH.active;
      if (t >= breathEnd) b.data.breath = 0;
      if (!(b.data.combo > 0) && t >= breathEnd) { b.data.combo = 1; castSlam(w, b); }
      if (b.data.combo > 0 && t >= (b.data.slamAt ?? breathEnd) + SLAM.windup + SLAM.gap + SLAM.recover) endAttack(b, gapFor(w, b));
      break;
    }
    default:
      endAttack(b, 1);
  }
  b.data.attackIdx = ATTACKS.indexOf(b.attack as typeof ATTACKS[number]);
}
