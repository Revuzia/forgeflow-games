// BLOCKTOOTH — IRON GULLY, the pale ridge-backed quadruped of WHITE STACKS (ai lane, CONTRACT §10).
// THREE-free, DOM-free, deterministic (world.rng.boss only).
//
// Body: body r20 · beaked head r8 (hp ×1.6, FRACTURE ×2.0) · scrap-plate sail r10 (FRACTURE ×2.5)
// · 4 legs r6. Footwork: closes to 50–80 m at 9 m/s, always facing the titan.
// Attacks — §10's shapes, AUTHORED IN TITAN HEIGHTS (PC-02, same rule as CAISSON-4): H = the titan's
// height at spawn (bossH), R = its radius (0.42 H); windups are fairWindup (0.35 s reaction + 0.15 s
// acceleration + the shape's walk-out ÷ this titan's walk speed × ESCAPE_K[phase]). §10's metre sizes
// left a Size V titan (H 60, ≈ 53 m/s) untouched by 94–100 % of tells. Size V numbers for H 60:
//   P1  coneBreath  cone half 28°, reach 3.0 H (180 m) from the beak, windup from the cheaper walk-out
//                   (sideways d·sin 28° + R, or out past the reach), then 1.2 s active (dps); leaves
//                   frost hazards (slow) along the sightline
//       pawSlam     ring 0–1.1 H (66 m), then ring 1.1–2.0 H (66–120 m) 0.5 s later (both painted at
//                   once — different bands, so they read as a sequence). The inner windup is long
//                   enough to walk straight out past BOTH rings (inner windup + 0.5 s ≥ the walk-out
//                   of the outer band) — or dash through the ring.
//   P2  + plateVolley  6–10 lobbed 'plate' projectiles with circle tells r 0.4 H around the titan's lead
//                   (first on it, the rest ≥ 1 H apart inside 1.7 H), windup from r + R
//       + ridgeCharge  lane w 0.7 H, long enough to pass the titan by 1.5 H (3–5.5 H), then it charges
//                   down the lane at 1.25 H/s (contact dmg, side-swipe shove, flattens the city)
//   P3  breath→slam combo (breathSlam: the slam rings are painted only after the breath ends);
//       plate volley density ×2
//   SCRAP FLICK (anti dash-spam, no attack id — it is a reflex, not a procedure): a dash is answered
//                   by one plate flicked from the sail to just past the dash end (r 0.5 H), windup a fair
//                   walk-out from dead centre (never tighter, even in P3). P1 answers only a hot dash
//                   (a second one inside ≈ 2.5 s); P2+ any dash, at most every 8 / 6 / 5 s ÷ dash heat (≤ 2×),
//                   and every dash out of live boss paint (≥ 0.8 s apart; bosses/index.ts watchDash).
//                   A bruise: base 8 (≈ 130–195 at Size V).
// Measured (fullrun-policy bot port, god, 5 seeds, LV 34): tells landed VOLT-KITE 4.3 %, MOLO 10.8 %.
// No single hit takes more than HIT_CAP of the titan's max HP (a paw slam was 1 080 at Size V — more
// than a whole VOLT-KITE — so once tells can land, a lapse must be a bruise, not a death).
// Default subtitle "CRACK THE SAIL — BUILD FRACTURE" (data/bosses.ts).

import type { BossState, World } from '../../core/types.ts';
import { TAU, clamp, dist, dist2 } from '../../core/math.ts';
import {
  baseBoss, beginAttack, bossH, bossHostile, bossTelegraph, endAttack, entryPoint, fairWindup, introWalk,
  keepRange, leadPoint, localToWorld, makePart, moveBoss, pickWeighted, repeatMul, shoveTitan, turnBoss,
  watchDash,
} from './index.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { damageTitanArea } from '../../combat/damage.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const WALK = 9, INTRO_WALK = 20, TURN = 0.9, AIM_TURN = 1.4;
const MIN_D = 50, MAX_D = 80;
const GAP = [0, 2.8, 2.1, 2.0] as const;
const P3_CADENCE = 0.75;

// Geometry: every length ending in H is × bossH (titan heights); min/max clamp the fair windup (s).
const BREATH = { half: (28 * Math.PI) / 180, rH: 3.0, active: 1.2, dps: 50, recover: 0.6, frostLife: 7, min: 1.2, max: 2.4 };
const SLAM = { r0H: 1.1, r1H: 2.0, gap: 0.5, dmgIn: 60, dmgOut: 45, recover: 0.7, min: 1.0, max: 2.2 };
const PLATES = { min: 6, max: 10, rH: 0.4, stagger: 0.07, dmg: 30, spreadH: 1.7, spacingH: 1.0, recover: 0.6, wuMin: 1.0, wuMax: 2.0 };
const CHARGE = { wH: 0.7, pastH: 1.5, minLenH: 3, maxLenH: 5.5, speedH: 1.25, hitRH: 0.4, dmg: 70, recover: 1.1, shovePerH: 1.1, min: 1.1, max: 2.2 };
/** Scrap flick (see header): plate r, centre ahead of the dash end (× (r + R)), cooldown per phase (s). */
const FLICK = { rH: 0.5, aheadR: 0.3, cd: [0, 8, 6, 5] as const, dmg: 8, min: 0.9, max: 2.0 };
/** No single IRON GULLY hit takes more than this share of the titan's max HP. */
const HIT_CAP = 0.55;
function igHit(w: World, base: number): number {
  return Math.min(bossHostile(w, base), HIT_CAP * Math.max(1, w.titan.maxHp));
}

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
    if (b.attack !== 'ridgeCharge' || b.attackT < (b.data.chargeWu ?? 1.5)) b.data.speed = 0;
    runAttack(w, b);
  }
  scrapFlick(w, b);
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
  const T = w.titan, H = bossH(w, b);
  const d = dist(b.x, b.z, T.x, T.z);
  const P = b.phase;
  const wts = [
    P >= 3 ? 0.5 : (d > 0.7 * H ? 1.0 : 0.5),       // coneBreath (P3 prefers the combo)
    (d < SLAM.r1H * H + T.radius ? 1.5 : 0.4) * (P >= 3 ? 0.6 : 1),   // pawSlam (only reaches the near fight)
    P >= 2 ? 1.0 : 0,                               // plateVolley
    P >= 2 ? (d > 1.0 * H ? 1.0 : 0.5) : 0,         // ridgeCharge
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
  const T = w.titan, H = bossH(w, b);
  const o = beak(b);
  const ox = o.x, oz = o.z;
  const r = BREATH.rH * H, d = dist(ox, oz, T.x, T.z);
  // walk-out: the cheaper of sideways out of the sightline and outward past the reach
  const wu = fairWindup(w, b, Math.min(d * Math.sin(BREATH.half) + T.radius, Math.max(0, r - d) + T.radius), BREATH.min, BREATH.max);
  const dir = aim(w, b, 0.04, wu);
  b.data.dir = dir;
  const tg = bossTelegraph(w, {
    style: 'cone', shape: { k: 'cone', x: ox, z: oz, dir, half: BREATH.half, r },
    windup: wu, active: BREATH.active, dmg: bossHostile(w, BREATH.dps), kind: 'breath', tag: 'coneBreath',
    onFire: (w2) => {
      if (!b.alive) return;
      b.data.breath = 1;
      // frost patches settle along the sightline (slow only — they mark where the breath went)
      const fx = Math.sin(dir), fz = Math.cos(dir);
      const Bd = w2.city.bounds;
      for (let k = 0; k < 4; k++) {
        const along = r * (0.2 + 0.2 * k);
        const fr = Math.min(0.45 * H, Math.tan(BREATH.half) * along * 0.75 + 0.07 * H);
        const x = ox + fx * along, z = oz + fz * along;
        if (x < Bd.minX - fr || x > Bd.maxX + fr || z < Bd.minZ - fr || z > Bd.maxZ + fr) continue;
        spawnHazard(w2, { owner: 'boss', kind: 'frost', shape: { k: 'circle', x, z, r: fr }, life: BREATH.frostLife, data: { slow: 0.4 } });
      }
    },
  }, false);
  b.data.breathAt = b.attackT;
  b.data.breathWu = tg.windup;
}

function castSlam(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b);
  const x = b.x, z = b.z;
  const r0 = SLAM.r0H * H, r1 = SLAM.r1H * H, d = dist(x, z, T.x, T.z);
  // inner windup: out of the inner disc, AND (with the 0.5 s gap) straight on out past the outer band
  const wIn = fairWindup(w, b, Math.max(0, r0 - d) + T.radius, SLAM.min, SLAM.max);
  const wOut = fairWindup(w, b, Math.max(0, r1 - d) + T.radius, SLAM.min, SLAM.max + SLAM.gap);
  const wu = Math.max(wIn, wOut - SLAM.gap);
  const tg = bossTelegraph(w, {
    style: 'ring', shape: { k: 'ring', x, z, r0: 0, r1: r0 },
    windup: wu, dmg: igHit(w, SLAM.dmgIn), kind: 'slam', tag: 'pawSlamInner',
  }, false);
  bossTelegraph(w, {
    style: 'ring', shape: { k: 'ring', x, z, r0, r1 },
    windup: tg.windup + SLAM.gap, dmg: igHit(w, SLAM.dmgOut), kind: 'slam', tag: 'pawSlamOuter',
  }, false);
  b.data.slamAt = b.attackT;
  b.data.slamWu = tg.windup;
}

const SPOTS: number[] = [];
function castPlates(w: World, b: BossState): void {
  const T = w.titan, r = w.rng.boss, H = bossH(w, b);
  let n = PLATES.min + Math.floor(r() * (PLATES.max - PLATES.min + 1));
  if (b.phase === 3) n *= 2;
  const pr = PLATES.rH * H, spacing = PLATES.spacingH * H;
  const spread = PLATES.spreadH * H * (b.phase === 3 ? 1.3 : 1);
  const wu = fairWindup(w, b, pr + T.radius, PLATES.wuMin, PLATES.wuMax);
  const Bd = w.city.bounds;
  SPOTS.length = 0;
  // first plate on the titan's lead (latched jitter), the rest scattered around it with spacing
  const j = 0.08 * H * Math.sqrt(r()), ja = r() * TAU;
  const L = leadPoint(w, b, wu, LEAD);
  SPOTS.push(L.x + Math.sin(ja) * j, L.z + Math.cos(ja) * j);
  const sp2 = spacing * spacing;
  for (let tries = 0; tries < n * 30 && SPOTS.length < n * 2; tries++) {
    const a = r() * TAU, d = spacing + (spread - spacing) * Math.sqrt(r());
    const x = L.x + Math.sin(a) * d, z = L.z + Math.cos(a) * d;
    if (x < Bd.minX || x > Bd.maxX || z < Bd.minZ || z > Bd.maxZ) continue;
    let ok = true;
    for (let k = 0; k < SPOTS.length; k += 2) if (dist2(x, z, SPOTS[k], SPOTS[k + 1]) < sp2) { ok = false; break; }
    if (ok) SPOTS.push(x, z);
  }
  const sail = localToWorld(b, 0, -6, { x: 0, z: 0 });
  const dmg = igHit(w, PLATES.dmg);
  for (let k = 0, i = 0; k < SPOTS.length; k += 2, i++) {
    const tx = SPOTS[k], tz = SPOTS[k + 1];
    const life = wu + i * PLATES.stagger;
    spawnProjectile(w, {
      owner: 'boss', kind: 'plate', x: sail.x, z: sail.z, y: 58,
      vx: (tx - sail.x) / life, vz: (tz - sail.z) / life,
      dmg, lob: true, tx, tz, aoe: pr, life,
    });
  }
  b.data.plates = SPOTS.length / 2;
  b.data.platesEnd = wu + (SPOTS.length / 2) * PLATES.stagger;
}

function startAttack(w: World, b: BossState, id: string): void {
  const T = w.titan, H = bossH(w, b);
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
      const lw = CHARGE.wH * H;
      const wu = fairWindup(w, b, lw / 2 + T.radius, CHARGE.min, CHARGE.max);
      const dir = aim(w, b, 0.03, wu);
      beginAttack(w, b, id, T.x, T.z);
      b.data.dir = dir;
      b.data.travel = 0; b.data.rammed = 0;
      // long enough to run PAST the titan (a kiting VOLT-KITE fights from ≈ 2.9 H)
      const len = clamp(dist(b.x, b.z, LEAD.x, LEAD.z) + CHARGE.pastH * H, CHARGE.minLenH * H, CHARGE.maxLenH * H);
      b.data.chargeLen = len;
      const chargeS = len / (CHARGE.speedH * H);
      // the lane stays painted (no damage of its own) for the whole run so the path reads
      const tg = bossTelegraph(w, {
        style: 'lane', shape: { k: 'lane', x: b.x, z: b.z, dir, len, w: lw },
        windup: wu, active: chargeS, dmg: 0, kind: 'ram', tag: 'ridgeCharge',
      }, false);
      b.data.chargeWu = tg.windup;
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
    case 'coneBreath': {
      turnBoss(b, b.data.dir, AIM_TURN, dt);
      const end = (b.data.breathWu ?? 1.8) + BREATH.active;
      if (t >= end) b.data.breath = 0;
      if (t >= end + BREATH.recover) endAttack(b, gapFor(w, b));
      break;
    }
    case 'pawSlam':
      if (t >= (b.data.slamWu ?? 1.3) + SLAM.gap + SLAM.recover) endAttack(b, gapFor(w, b));
      break;
    case 'plateVolley':
      if (t >= (b.data.platesEnd ?? 1.6) + PLATES.recover) endAttack(b, gapFor(w, b));
      break;
    case 'ridgeCharge': {
      const dir = b.data.dir;
      turnBoss(b, dir, AIM_TURN * 2, dt);
      if (t < (b.data.chargeWu ?? 1.5)) break;
      const H = bossH(w, b);
      const left = (b.data.chargeLen ?? 3 * H) - b.data.travel;
      const Bd = w.city.bounds;
      const blocked = b.x <= Bd.minX + 1 || b.x >= Bd.maxX - 1 || b.z <= Bd.minZ + 1 || b.z >= Bd.maxZ - 1;
      if (left > 0 && !(blocked && b.data.travel > 5)) {
        b.heading = dir;
        const v = Math.min(CHARGE.speedH * H, left / dt);
        moveBoss(w, b, Math.sin(dir) * v, Math.cos(dir) * v);
        b.data.travel += v * dt;
        b.data.charge = 1;
        if (!(b.data.rammed > 0) && T.alive) {
          const h = localToWorld(b, 0, 16, TMP);
          if (damageTitanArea(w, { k: 'circle', x: h.x, z: h.z, r: CHARGE.hitRH * H }, igHit(w, CHARGE.dmg), 'slam')) {
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
      const breathEnd = (b.data.breathWu ?? 1.8) + BREATH.active;
      if (t >= breathEnd) b.data.breath = 0;
      if (!(b.data.combo > 0) && t >= breathEnd) { b.data.combo = 1; castSlam(w, b); }
      if (b.data.combo > 0 && t >= (b.data.slamAt ?? breathEnd) + (b.data.slamWu ?? 1.3) + SLAM.gap + SLAM.recover) endAttack(b, gapFor(w, b));
      break;
    }
    default:
      endAttack(b, 1);
  }
  b.data.attackIdx = ATTACKS.indexOf(b.attack as typeof ATTACKS[number]);
}

/** Anti dash-spam (see header): a dash is answered by one plate flicked just past its end point. */
function scrapFlick(w: World, b: BossState): void {
  const e = watchDash(w, b, FLICK.cd);
  if (!e) return;
  const T = w.titan, H = bossH(w, b), B = w.city.bounds;
  const r = FLICK.rH * H, reach = r + T.radius;
  const dx = e.x1 - e.x0, dz = e.z1 - e.z0, dl = Math.hypot(dx, dz) || 1;
  const ahead = FLICK.aheadR * reach;
  const x = clamp(e.x1 + (dx / dl) * ahead, B.minX, B.maxX), z = clamp(e.z1 + (dz / dl) * ahead, B.minZ, B.maxZ);
  // the paint appears at the dash START (the reaction overlaps the dash); exactly walkable in every
  // phase (k fixed at 1)
  const life = fairWindup(w, b, reach, FLICK.min, FLICK.max, 1);
  const sail = localToWorld(b, 0, -6, TMP);
  spawnProjectile(w, {
    owner: 'boss', kind: 'plate', x: sail.x, z: sail.z, y: 58,
    vx: (x - sail.x) / life, vz: (z - sail.z) / life,
    dmg: igHit(w, FLICK.dmg), lob: true, tx: x, tz: z, aoe: r, life,
  });
  b.data.followX = x; b.data.followZ = z;
}
