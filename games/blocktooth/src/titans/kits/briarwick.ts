// BLOCKTOOTH — BRIARWICK kit: AREA CONTROL (CONTRACT §8, TITAN PASS kit C). Lane titan-sim. THREE-free, deterministic.
// Plant, ripen, burst in chain reactions.
//   Auto  BURR LASH     — lane toward the target (hits everything in it) and plants a SEED POD at the target.
//   Pass  RIPENING      — pods ripen in 2 s; a ripe pod bursts when a foe / boss part touches it (or when it
//                         goes to seed at end of life). A burst tangles (stuns) foes, heals the titan a little,
//                         and sets off every RIPE pod near it (a chain: +10 % per link). Broken floors near the
//                         titan sprout pods (35 %; collapses always), so bursts that break floors re-seed the block.
//   Hook  POP-UP PARK   — horn stamp (ring burst) + a 4-seed volley at the nearest foes + EVERY pod within 12 H
//                         ripens and detonates as one outward cascade (+10 % per link, cap x2).
//   Dash  BRAMBLE BOUND — the shared bound; it drops 2 unripe pods along its path.
// Pods are titan-owned `bloom` hazards (the same kind the bloom upgrade cards and GREENBELT DECREE plant, so
// those cards plant pods). Kit state (titan.kit): pods, ripe, turrets (= pods, legacy HUD), chain (last cascade
// length, view), bloomT (hook anim), sowT (legacy view key = bloomT).
// Events: `bloomSpawn` per pod planted, `bloomBurst {x, z, r, link, ripe}` per pod burst, `rooted {id, x, z, t}`
// per foe a TANGLE stuns (bosses are never stunned), `rootSnap {x, y, z, r, h}` per foe a burst / horn stamp KILLED
// inside its circle (view only), `explosion 'seed'` per burst and per horn stamp.
// Tuning (CONTRACT §8 G3): every BRIARWICK change stays in `BRIAR` below — never through BOSS_KIND_MUL.

import { cos, hypot, sin } from '../../core/detmath.ts';
import type { DamageOpts, Enemy, Hazard, World } from '../../core/types.ts';
import { circleInShape, headingOf, wrapAngle } from '../../core/math.ts';
import { damageArea, titanDamage } from '../../combat/damage.ts';
import { findTarget } from '../../combat/targeting.ts';
import type { Target } from '../../combat/targeting.ts';
import { enemiesInCircle, nearestEnemies } from '../../combat/spatial.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { buildingsInRect } from '../../city/citysim.ts';
import { healTitan } from '../titansim.ts';
import { VS, titanSpeed } from '../../core/config.ts';
import {
  S, aimPoint, autoInterval, closestOnBuilding, distToBuilding, emitAbility, emitAttack, faceToward, hookCooldown,
  idleAuto, knockFor, kv, rearmAuto, titanHazards,
} from './common.ts';
import { RIVAL_KNOCK_H, hitRivalsInShape, nearestRival, pvpLive, rivalHit, rivalSlow, rivalSlots, rivalsInShape } from '../rivals.ts';   // B-TITAN (VS): BURR LASH / pods / POP-UP PARK vs a rival

/** Tuning (mutable so probes can sweep them at runtime). Ranges/radii in titan heights H, times in s. */
export const BRIAR = {
  // ── auto: BURR LASH ──
  lashEveryS: 1.0,         // ÷ attackRate
  lashLenH: 3.2,           // × H × vineLength × attackRange (× size1LenMul at Size I)
  lashWH: 0.55,            // × H × area
  lashDmg: 14,
  lashKnock: 0.5,
  size1LenMul: 1.8,        // Size I only (× the lash length; the volley range uses it too)
  // BURR LASH aim (fb3, owner playtest 2026-09-30: "the tongue just goes out in all directions"). The old pick was the
  // nearest thing in reach every cast, in any direction: 52 % of lashes left more than 60° off the move direction
  // (P-human, current pacing, 24 runs; _harness/scratch/fb3/BRIAR). Now, while the titan walks, the whip only cracks
  // AHEAD — inside ±aimArcDeg of the move direction — down a lane that hits foes, staying with the last crack's lane (or
  // the nearest lane to it: last ± trackDeg × 1..trackN, or any foe's) among the lanes scoring ≥ goodFrac × the best
  // (score = hits × (1 − aimEdgeLoss × off / arc)); a foe at the titan's skin (closeH) inside the arc must be in the
  // lane. The horn wind-up commits the lane windS before the crack and the crack goes exactly there. Foes in reach but
  // none ahead: the whip HOLDS (no swing at the city, no whip back at a rig being fled). With no foe in reach it keeps
  // cracking down the same block while something stands in that lane. Standing still (idleAnyDir) or stuck (slower than
  // blockedFrac × the base walk) the arc is the full circle: it whips whatever is nearest / pressing on it
  // and turns to face it. A boss with no foe in reach (findTarget's pick) is lashed in any direction (bossArcDeg 180).
  aimCands: 24,            // candidate lanes: toward each of this many nearest foes in reach (+ the last lane, neighbours)
  aimArcDeg: 45,           // the forward arc (± this of the move direction / facing) the lash whips inside
  aimEdgeLoss: 0.25,       // a lane at the arc's edge scores (1 − this) × its hits (centred lanes win ties)
  aimBossHit: 1,           // a lane through a boss part counts this many extra hits (one shape = one hit's worth)
  goodFrac: 0.6,           // the lane nearest the last crack among those scoring ≥ this × the best (0 = always the best)
  trackN: 2,               // extra candidate lanes beside the last crack: last ± k × trackDeg, k = 1..trackN
  trackDeg: 8,
  closeH: 0.8,             // a foe within this × H of the titan's surface (inside the arc) must be in the lane taken
  bossArcDeg: 180,         // while steering a boss part is lashed only within this of the move direction (180 = anywhere)
  blockedFrac: 0.2,        // stick held but slower than this × the base walk (stuck / hemmed in): the arc is the full circle
  idleAnyDir: 1,           // 1: with the stick idle the whip cracks in any direction (the titan then turns to face it)
  keepS: 2.0,              // the last crack's lane counts for this long (s)
  windS: 0.2,              // the horn wind-up: the lane is committed this long before the crack (kit.lashWind; view)
  // Size I lash floor (m from the titan's centre, before × vineLength × attackRange): the Size I shooters stand at their
  // range off the titan's SURFACE (android 9, squad 12 + 0.2 H; ai/enemies.ts reach/surfDist), so the lash reaches
  // size1ReachM + the titan's radius. Measured (critic 2026-09-30): at H 1.2 the 6.9 m lash reached 0 of 101 shooter
  // shots fired from 7.97-12.27 m. From about H 2.3 the lash formula itself is longer and the floor stops mattering.
  size1ReachM: 12.5,
  // ── pods ──
  podRH: 0.3,              // footprint (view / hazard shape) × H at plant time
  podLifeS: 9,
  ripenS: 2.0,             // ÷ turretRate
  triggerRH: 0.9,          // a RIPE pod bursts when a foe / boss part comes within this (× H)
  burstRH: 1.1,            // × H × area (× size1BurstRMul at Size I)
  size1BurstRMul: 1.3,
  burstDmg: 18,
  burstKnock: 0.8,
  greenMul: 0.6,           // an unripe pod forced to pop (cap overflow / end of life before ripe)
  tangleS: 0.6,            // stun on foes caught in a burst (elites × 0.3, heavies × 0.6)
  chainRH: 2.4,            // ripe pods within this of a burst chain (× H × area × chainRange)
  chainDelayS: 0.1,
  linkBonus: 0.1,          // + per chain link
  linkCap: 1.0,            // max bonus (×2)
  greenRipenOnChain: 0.5,  // unripe pods inside a chain radius gain this much ripeness (the spores ripen them)
  healFrac: 0.004,         // × maxHp × sporeHeal per pod burst
  healCapPerS: 0.015,      // × maxHp, per rolling 1 s window
  bloomNearH: 3,           // floor breaks within this many H sprout pods
  bloomFloorChance: 0.35,
  // ── hook: POP-UP PARK ──
  hookCdS: 8,
  hookRH: 12,              // every pod within this (× H) joins the cascade
  ringRH: 1.6,             // × H × area (× size1BurstRMul at Size I)
  ringDmg: 24,             // × abilityPower
  ringKnock: 1.2,
  ringTangleS: 1.0,
  volleyN: 4,              // + round(2 × (abilityPower − 1)), 3..10
  volleyRH: 6,             // × H (× size1LenMul at Size I)
  volleyFlightS: 0.3,
  cascadeStartS: 0.15,
  rippleS: 0.06,           // per pod, outward by distance from the titan
  hookBurstMul: 1.0,       // × abilityPower on hook-cascade bursts
  // ── dash: BRAMBLE BOUND seed trail ──
  dashPods: 2,
};

/** Size-I multiplier (1 from Size II on). */
function s1(w: World, mul: number): number { return w.titan.rank === 0 ? mul : 1; }

const DEG = Math.PI / 180;
const SRC_PASSIVE = 0, SRC_HOOK = 1, SRC_DASH = 2, SRC_UPG = 3;
const hazBuf: Hazard[] = [];
const podBuf: Hazard[] = [];
const enemyBuf: Enemy[] = [];
const snapBuf: Enemy[] = [];
const idBuf: number[] = [];
const aim = { x: 0, z: 0 };
const pt = { x: 0, z: 0 };
const LASH_OPTS: DamageOpts = { src: 'titan', kind: 'vine' };
const BURST_OPTS: DamageOpts = { src: 'titan', kind: 'seed' };
const RING_OPTS: DamageOpts = { src: 'titan', kind: 'seed' };

/** Floor-break detection by footprint diff (catches breaks from every source and every point of the
 *  tick — contact, lash, bursts, triggers): building id → alive floors / last tick seen, per world. */
interface BreakCache { alive: Map<number, number>; seen: Map<number, number>; }
const caches = new WeakMap<object, BreakCache>();   // B-CORE: keyed by the TitanState (per player), not the World

export function init(): Record<string, number> {
  return {
    pods: 0, ripe: 0, turrets: 0, chain: 0, bloomT: 0, sowT: 0, healWin: 0, healT: 0,
    // BURR LASH aim: the last crack's heading + its age (s); the committed lash heading, its pod distance and kind (0 foe,
    // 1 boss, 2 city); the wind-up time left (s, -1 = not winding), the horn it cracks from (+1 = the left horn, model +X;
    // -1 = the right), the lane width (m) and how many things the last lash hit (view)
    prevDir: 0, lashAge: 99, lashDir: 0, lashD: 0, lashKind: 0, lashWind: -1, lashSide: 1, lashW: 0, lashN: 0,
  };
}

/** Auto-attack (BURR LASH) reach (m) right now, incl. the Size I floor (size1ReachM). */
export function reach(w: World): number {
  const T = w.titan;
  let len = BRIAR.lashLenH * s1(w, BRIAR.size1LenMul) * T.height;
  if (T.rank === 0) len = Math.max(len, BRIAR.size1ReachM + Math.max(0, T.radius));
  return len * Math.max(0.1, S(w, 'vineLength')) * Math.max(0.1, S(w, 'attackRange'));
}

/** Drop-latch reach (m) — pickups.ts latches drops inside ~1.2 × this (kits/index kitLatchReach). The lash formula
 *  WITHOUT the Size I floor (Gate 2026-09-30): the floor is a combat fix for the Size I shooters' standoff; feeding it
 *  to the pickup latch too roughly doubled BRIARWICK's Size I vacuum radius and sped its growth (probe_meta perk band
 *  'Size III at 189 s, outside 210-380 s'). */
export function latchReach(w: World): number {
  return BRIAR.lashLenH * s1(w, BRIAR.size1LenMul) * w.titan.height
    * Math.max(0.1, S(w, 'vineLength')) * Math.max(0.1, S(w, 'attackRange'));
}

function podCap(w: World): number { return Math.max(1, Math.floor(S(w, 'turretCap'))); }
function ripenTime(w: World): number { return BRIAR.ripenS / Math.max(0.1, S(w, 'turretRate')); }

export function step(w: World): void {
  const T = w.titan, K = T.kit;
  K.bloomT = Math.max(0, kv(w, 'bloomT') - w.dt);
  K.sowT = K.bloomT;
  K.healT = kv(w, 'healT') - w.dt;
  if (K.healT <= 0) { K.healT = 1; K.healWin = 0; }

  detectBreaks(w);
  stepPods(w);

  if (w.input.ability && T.abilityCd <= 0) popUpPark(w);

  // ── auto: BURR LASH (the lane is committed windS before the crack: the view winds the horn up toward it) ──
  K.lashAge = kv(w, 'lashAge', 99) + w.dt;
  if (T.autoCd <= 0) lash(w);
  else if (T.autoCd <= BRIAR.windS && kv(w, 'lashWind', -1) < 0) windUp(w);
  else if (kv(w, 'lashWind', -1) >= 0) K.lashWind = Math.max(0, T.autoCd);

  const pods = titanHazards(w, 'bloom', hazBuf);
  let ripe = 0;
  for (const h of pods) if ((h.data.ripe ?? 0) >= 1) ripe++;
  K.pods = pods.length; K.turrets = pods.length; K.ripe = ripe;
}

/** Lane width (m) of the BURR LASH right now. */
function lashWidth(w: World): number { return BRIAR.lashWH * w.titan.height * Math.max(0.1, S(w, 'area')); }

const cand: Enemy[] = [];
const pool: Enemy[] = [];
const LANE = { k: 'lane' as const, x: 0, z: 0, dir: 0, len: 0, w: 0 };
/** the chosen lash: heading, distance to the aim point (the pod lands there), what it is aimed at (KIND_*) */
const pick = { dir: 0, d: 0, kind: 0 };
const KIND_FOE = 0, KIND_BOSS = 1, KIND_CITY = 2, KIND_RIVAL = 3;   // KIND_RIVAL: VS only (a rival titan in reach)
/** laneHits side output: distance along the lane of the nearest foe in it */
let laneNear = 0;

/** Foes (+ aimBossHit if a boss part is in it) inside the lash lane at heading `dir` (damageArea's own test). */
function laneHits(w: World, dir: number): number {
  LANE.dir = dir;
  const fx = sin(dir), fz = cos(dir);
  let n = 0;
  laneNear = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    if (!e.alive || !circleInShape(LANE, e.x, e.z, e.radius)) continue;
    n++;
    const along = (e.x - LANE.x) * fx + (e.z - LANE.z) * fz;
    if (along < laneNear) laneNear = along;
  }
  const B = w.boss;
  if (n > 0 && BRIAR.aimBossHit > 0 && B && B.alive && B.introT <= 0) {
    for (let i = 0; i < B.parts.length; i++) if (circleInShape(LANE, B.parts[i].x, B.parts[i].z, B.parts[i].r)) { n += BRIAR.aimBossHit; break; }
  }
  return n;
}

/** True while the stick is held. */
function steering(w: World): boolean {
  const I = w.input;
  return !!I && hypot(I.mx, I.mz) > 0.25;
}

/** The forward arc (rad) right now: aimArcDeg, or the full circle with the stick idle (idleAnyDir) or while the stick is
 *  held but the titan is stuck (slower than blockedFrac × its base walk: hemmed in, it whips at whatever holds it). */
function arcNow(w: World): number {
  const T = w.titan;
  if (BRIAR.idleAnyDir > 0 && !steering(w)) return Math.PI;
  if (BRIAR.blockedFrac > 0 && steering(w) && T.dashT <= 0 && T.speed < BRIAR.blockedFrac * titanSpeed(T.height)) return Math.PI;
  return BRIAR.aimArcDeg * DEG;
}

/** The aim reference: the move direction while the stick is held, else the facing (which swivels to the target). */
function aimRef(w: World): number {
  const I = w.input;
  return steering(w) ? headingOf(I.mx, I.mz) : w.titan.heading;
}

/** The last crack's heading while it is recent (keepS), else null. */
function lastLane(w: World): number | null {
  return kv(w, 'lashAge', 99) <= BRIAR.keepS ? kv(w, 'prevDir') : null;
}

const LC_MAX = 64;
const lcDir = new Float64Array(LC_MAX), lcOff = new Float64Array(LC_MAX), lcD = new Float64Array(LC_MAX);
const lcSc = new Float64Array(LC_MAX), lcTurn = new Float64Array(LC_MAX);

/**
 * The foe lane inside the forward arc (±aimArcDeg of the aim reference). Candidates: the lane toward each of the nearest
 * foes in reach, the last crack's lane and its neighbours (last ± k × trackDeg). Every candidate that hits a foe scores
 * hits × (1 − aimEdgeLoss × off / arc); the pick is the one nearest the last crack among those scoring ≥ goodFrac × the
 * best (the whip tracks the crowd instead of jumping to the single best lane; no recent crack: the best). Ties: the
 * higher score, then the smaller angle off the aim. Fills `pick`; false when no lane inside the arc hits a foe.
 */
function aimAtFoes(w: World, len: number, width: number): boolean {
  const T = w.titan;
  nearestEnemies(w, T.x, T.z, len, BRIAR.aimCands, cand);
  if (!cand.length) return false;
  enemiesInCircle(w, T.x, T.z, len + width, pool);
  LANE.x = T.x; LANE.z = T.z; LANE.len = len; LANE.w = width;
  const ref = aimRef(w), arc = arcNow(w);
  const last = lastLane(w);
  const nTrack = last !== null ? 1 + 2 * Math.max(0, Math.round(BRIAR.trackN)) : 0;
  // a foe at the titan's skin (within closeH × H of its surface) inside the arc must be in the lane: it is what is biting
  const n0 = cand[0];
  const close = BRIAR.closeH > 0 && n0.alive && hypot(n0.x - T.x, n0.z - T.z) - n0.radius - T.radius <= BRIAR.closeH * T.height
    && Math.abs(wrapAngle(headingOf(n0.x - T.x, n0.z - T.z) - ref)) <= arc ? n0 : null;
  let nc = 0, top = 0;
  for (let i = 0; i < cand.length + nTrack && nc < LC_MAX; i++) {
    let dir: number;
    if (i < cand.length) { const e = cand[i]; if (!e.alive) continue; dir = headingOf(e.x - T.x, e.z - T.z); }
    else { const k = i - cand.length; dir = (last as number) + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * BRIAR.trackDeg * DEG); }
    const off = Math.abs(wrapAngle(dir - ref));
    if (off > arc) continue;
    const hits = laneHits(w, dir);
    if (hits <= 0) continue;
    if (close && !circleInShape(LANE, close.x, close.z, close.radius)) continue;
    lcDir[nc] = dir; lcOff[nc] = off; lcD[nc] = Math.min(len, Math.max(0, laneNear));
    lcSc[nc] = hits * (1 - BRIAR.aimEdgeLoss * (off / arc));
    lcTurn[nc] = last === null ? 0 : Math.abs(wrapAngle(dir - last));
    if (lcSc[nc] > top) top = lcSc[nc];
    nc++;
  }
  cand.length = 0; pool.length = 0;
  if (nc === 0) return false;
  const floor = (last !== null && BRIAR.goodFrac > 0 ? BRIAR.goodFrac : 1) * top - 1e-9;
  let bi = -1, bt = Infinity, bv = -Infinity, bo = Infinity;
  for (let i = 0; i < nc; i++) {
    if (lcSc[i] < floor) continue;
    if (lcTurn[i] < bt - 1e-9 || (Math.abs(lcTurn[i] - bt) <= 1e-9 && (lcSc[i] > bv + 1e-9 || (Math.abs(lcSc[i] - bv) <= 1e-9 && lcOff[i] < bo - 1e-9)))) {
      bi = i; bt = lcTurn[i]; bv = lcSc[i]; bo = lcOff[i];
    }
  }
  pick.dir = lcDir[bi]; pick.d = lcD[bi]; pick.kind = KIND_FOE;
  return true;
}

/** Nearest boss part in reach inside the arc (arcNow) of the aim reference; fills `pick`. */
function aimAtBoss(w: World, len: number): boolean {
  const B = w.boss, T = w.titan;
  if (!B || !B.alive || B.introT > 0) return false;
  const ref = aimRef(w), arc = arcNow(w);
  let best = -1, bd = Infinity;
  for (let i = 0; i < B.parts.length; i++) {
    const p = B.parts[i];
    const dd = Math.max(0, hypot(p.x - T.x, p.z - T.z) - p.r);
    if (dd > len || dd >= bd) continue;
    if (Math.abs(wrapAngle(headingOf(p.x - T.x, p.z - T.z) - ref)) > arc) continue;
    bd = dd; best = i;
  }
  if (best < 0) return false;
  const p = B.parts[best];
  pick.dir = headingOf(p.x - T.x, p.z - T.z); pick.d = hypot(p.x - T.x, p.z - T.z); pick.kind = KIND_BOSS;
  return true;
}

const CITY_US = [0.3, 0.55, 0.8];
/** A building / prop inside the forward arc: while something stands IN the last crack's lane (recent, inside the arc)
 *  the whip cracks down that lane again (it keeps chewing the same block); else the one nearest a point 0.45 × reach
 *  down the aim; else `t` itself when it is inside the arc. Fills `pick`. */
function aimAtCity(w: World, t: Target | null, len: number): boolean {
  const T = w.titan, ref = aimRef(w), arc = arcNow(w);
  const last = lastLane(w);
  if (last !== null && arc < Math.PI - 1e-9 && Math.abs(wrapAngle(last - ref)) <= arc) {
    const half = 0.5 * lashWidth(w);
    for (const u of CITY_US) {
      const c = findTarget(w, T.x + sin(last) * len * u, T.z + cos(last) * len * u, half, true);
      if (!c || (c.kind !== 'building' && c.kind !== 'prop')) continue;
      pick.dir = last; pick.d = len * u; pick.kind = KIND_CITY;
      return true;
    }
  }
  // stuck or idle (the arc is the full circle): the nearest thing first — what the titan is pressed against
  const free = arc >= Math.PI - 1e-9;
  const t2 = free && t ? null : findTarget(w, T.x + sin(ref) * len * 0.45, T.z + cos(ref) * len * 0.45, len * 0.55, true);
  for (const c of [t2, t]) {
    if (!c || (c.kind !== 'building' && c.kind !== 'prop')) continue;
    aimPoint(w, c, T.x, T.z, aim);
    const dir = headingOf(aim.x - T.x, aim.z - T.z);
    if (Math.abs(wrapAngle(dir - ref)) > arc) continue;
    pick.dir = dir; pick.d = hypot(aim.x - T.x, aim.z - T.z); pick.kind = KIND_CITY;
    return true;
  }
  return false;
}

/**
 * Choose the BURR LASH (fills `pick`; false = hold it). findTarget decides what the titan is fighting: an open
 * gatekeeper weak point or a boss with no foe in reach → the boss (anywhere while bossArcDeg is 180; else, steering,
 * the part findTarget names if it is within bossArcDeg, else the nearest part inside the arc); foes in reach → the foe
 * lane inside the arc (arcNow), else a boss part inside it, else HOLD; only
 * the city in reach → the city inside the arc. Holding with the stick idle swivels the titan toward the target (with
 * idleAnyDir the arc is already the full circle).
 */
function selectLash(w: World, len: number, width: number): boolean {
  const T = w.titan;
  const t = findTarget(w, T.x, T.z, len, true);
  const rv = nearestRival(w, len);            // VS (PvP live): a rival inside the lash's reach is whipped before anything else
  if (rv >= 0) {
    const Rt = w.players[rv].titan;
    pick.dir = headingOf(Rt.x - T.x, Rt.z - T.z); pick.d = Math.min(len, hypot(Rt.x - T.x, Rt.z - T.z)); pick.kind = KIND_RIVAL;
    return true;
  }
  if (!t) return false;
  if (t.kind === 'boss') {
    aimPoint(w, t, T.x, T.z, aim);
    const dir = headingOf(aim.x - T.x, aim.z - T.z);
    if (BRIAR.bossArcDeg >= 180 || !steering(w) || Math.abs(wrapAngle(dir - aimRef(w))) <= Math.max(arcNow(w), BRIAR.bossArcDeg * DEG)) {
      pick.dir = dir; pick.d = hypot(aim.x - T.x, aim.z - T.z); pick.kind = KIND_BOSS;
      return true;
    }
    if (aimAtBoss(w, len)) return true;
  } else if (t.kind === 'enemy') {
    if (aimAtFoes(w, len, width) || aimAtBoss(w, len)) return true;
  } else if (aimAtCity(w, t, len)) return true;
  aimPoint(w, t, T.x, T.z, aim);
  faceToward(w, headingOf(aim.x - T.x, aim.z - T.z));       // nothing ahead: swivel toward it while the stick is idle
  return false;
}

/** The committed lane still worth the crack? A foe lane must still hit a foe; a boss lane always is (0.2 s); a city lane
 *  only while the stick is held or no foe is in reach (released over foes, the titan turns to them instead). */
function committedOk(w: World, len: number, width: number): boolean {
  if (kv(w, 'lashWind', -1) < 0) return false;
  const T = w.titan, dir = kv(w, 'lashDir');
  if (kv(w, 'lashKind') === KIND_CITY && !steering(w)) {
    const t = findTarget(w, T.x, T.z, len, true);
    if (t && t.kind === 'enemy') return false;
  }
  if (kv(w, 'lashKind') !== KIND_FOE) {
    pick.dir = dir; pick.d = Math.min(len, kv(w, 'lashD', len)); pick.kind = kv(w, 'lashKind');
    return true;
  }
  enemiesInCircle(w, T.x, T.z, len + width, pool);
  LANE.x = T.x; LANE.z = T.z; LANE.len = len; LANE.w = width;
  const hits = laneHits(w, dir);
  pool.length = 0;
  if (hits <= 0) return false;
  pick.dir = dir; pick.d = Math.min(len, Math.max(0, laneNear)); pick.kind = KIND_FOE;
  return true;
}

/** The horn the lash cracks from: the one on the target's side (alternating when it is dead ahead). */
function hornSide(w: World, dir: number): number {
  const off = wrapAngle(dir - w.titan.heading);
  if (Math.abs(off) < 0.15) return kv(w, 'lashSide', 1) > 0 ? -1 : 1;
  return off > 0 ? 1 : -1;
}

/** windS before the crack: commit the lane so the view can wind the horn up toward it (no damage, no events). */
function windUp(w: World): void {
  const T = w.titan, K = T.kit;
  if (!selectLash(w, reach(w), lashWidth(w))) return;
  K.lashDir = pick.dir; K.lashD = pick.d; K.lashKind = pick.kind;
  K.lashSide = hornSide(w, pick.dir);
  K.lashWind = Math.max(0, T.autoCd);
}

function lash(w: World): void {
  const T = w.titan, K = T.kit;
  const len = reach(w);
  const width = lashWidth(w);
  // the wind-up committed a lane: the crack goes exactly where the horn was cocked (what you see is what you hit)
  const held = committedOk(w, len, width);
  if (!held && !selectLash(w, len, width)) { idleAuto(w); K.lashWind = -1; return; }
  const dir = pick.dir, d = Math.min(len, pick.d);
  if (!held) K.lashSide = hornSide(w, dir);
  K.lashDir = dir; K.lashWind = -1; K.lashW = width; K.prevDir = dir; K.lashAge = 0;
  LASH_OPTS.knock = knockFor(w, BRIAR.lashKnock);
  const hits = damageArea(w, { k: 'lane', x: T.x, z: T.z, dir, len, w: width }, titanDamage(w, BRIAR.lashDmg), LASH_OPTS);
  if (w.mode === 'vs') hitRivalsInShape(w, { k: 'lane', x: T.x, z: T.z, dir, len, w: width }, VS.kitPct.briarwick.auto, 'vine', 'briar.auto', RIVAL_KNOCK_H.auto);   // BURR LASH: 3 % of a rival's max HP
  K.lashN = hits;
  // the view draws the whip + crack along exactly this lane (x0,z0 → x1,z1, width kit.lashW) and flashes the foes in it
  const x1 = T.x + sin(dir) * len, z1 = T.z + cos(dir) * len;
  w.events.push({ type: 'vine', x0: T.x, z0: T.z, x1, z1 });
  // the burr: a pod where the lash struck (the target / the first foe in the lane)
  plantPod(w, T.x + sin(dir) * d, T.z + cos(dir) * d, SRC_PASSIVE, 0);
  emitAttack(w, 'vineLash', T.x, T.z, dir, len, hits);
  faceToward(w, dir);
  rearmAuto(w, autoInterval(w, BRIAR.lashEveryS));
}

// ─────────────────────────────── pods ───────────────────────────────
/** Plant a pod. At the cap the OLDEST unfused pod bursts early (overgrowth) instead of being deleted. */
function plantPod(w: World, x: number, z: number, src: number, ripe: number, bypassCap = false): Hazard {
  const T = w.titan;
  if (!bypassCap) {
    const pods = titanHazards(w, 'bloom', podBuf);
    let live = 0;
    for (const h of pods) if ((h.data.fuse ?? -1) < 0 && !h.data.vol) live++;
    let excess = live - (podCap(w) - 1);
    for (let i = 0; i < pods.length && excess > 0; i++) {
      const h = pods[i];
      if ((h.data.fuse ?? -1) >= 0 || h.data.vol) continue;
      burst(w, h, 0, h.data.src ?? SRC_PASSIVE);
      excess--;
    }
  }
  const h = spawnHazard(w, {
    owner: 'titan', kind: 'bloom',
    shape: { k: 'circle', x, z, r: Math.max(0.3, BRIAR.podRH * T.height) },
    life: BRIAR.podLifeS,
    dps: 0,
    data: { pod: 1, ripe, fuse: -1, link: 0, src, h: T.height, vol: bypassCap ? 1 : 0 },
  });
  w.events.push({ type: 'bloomSpawn', id: h.id, x, z });
  return h;
}

function adopt(h: Hazard): void {
  // blooms planted by upgrade cards / GREENBELT DECREE become pods
  const d = h.data;
  d.pod = 1; d.ripe = 0; d.fuse = -1; d.link = 0; d.src = SRC_UPG; d.vol = 0;
}

let w0x = 0, w0z = 0;
function podXZ(h: Hazard): { x: number; z: number } {
  const s = h.shape;
  if (s.k === 'circle') { pt.x = s.x; pt.z = s.z; } else { pt.x = w0x; pt.z = w0z; }
  return pt;
}

function stepPods(w: World): void {
  const T = w.titan;
  const dt = w.dt;
  const H = T.height;
  w0x = T.x; w0z = T.z;
  const rip = ripenTime(w);
  const pods = titanHazards(w, 'bloom', podBuf).slice();
  for (let i = 0; i < pods.length; i++) {
    const h = pods[i];
    if (!h.alive) continue;
    const d = h.data;
    if (d.pod !== 1) adopt(h);
    if (d.ripe < 1) d.ripe = Math.min(1, d.ripe + dt / rip);
    if (d.fuse >= 0) {
      d.fuse -= dt;
      if (d.fuse <= 0) burst(w, h, d.link, d.src);
      continue;
    }
    // expires in stepHazards this tick → go to seed now
    if (h.t + dt >= h.life - 1e-6) { burst(w, h, 0, d.src); continue; }
    if (d.ripe >= 1 && foeNear(w, podXZ(h), BRIAR.triggerRH * H)) burst(w, h, 0, d.src);
  }
}

function foeNear(w: World, p: { x: number; z: number }, r: number): boolean {
  const px = p.x, pz = p.z;
  if (w.mode === 'vs' && rivalNear(w, px, pz, r)) return true;   // VS: a rival touching a RIPE pod sets it off (PvP live only)
  enemiesInCircle(w, px, pz, r, enemyBuf);
  for (let i = 0; i < enemyBuf.length; i++) if (enemyBuf[i].alive && enemyBuf[i].hp > 0) return true;
  const B = w.boss;
  if (B && B.alive && B.introT <= 0) {
    for (const part of B.parts) if (hypot(part.x - px, part.z - pz) - part.r <= r) return true;
  }
  return false;
}

/** VS: a rival titan's body within `r` of (x, z) while PvP is live (OPEN HOUSE pods ignore rivals). */
function rivalNear(w: World, x: number, z: number, r: number): boolean {
  if (!pvpLive(w)) return false;
  const slots = rivalSlots(w);
  for (let i = 0; i < slots.length; i++) {
    const p = w.players[slots[i]];
    if (p.vs.spawnProtT > 0) continue;
    if (hypot(p.titan.x - x, p.titan.z - z) - p.titan.radius <= r) return true;
  }
  return false;
}

const RIV: number[] = [];
const RIV_SHAPE = { k: 'circle' as const, x: 0, z: 0, r: 0 };
/** per-rival counters of pods that reached it in the CURRENT POP-UP PARK cascade (index = slot): at most podChainMax count */
const CHAIN_KEY = ['sim_chainHit0', 'sim_chainHit1', 'sim_chainHit2', 'sim_chainHit3'];

/**
 * VS: a pod burst / the horn ring reaches rivals standing in the circle: `pct` of their max HP (before power / edge / phase) and a
 * TANGLE (40 % slow for tangleS; CC rules apply, so B-VS caps it and grants CLEARED). `chained` = a POP-UP PARK cascade pod: at most
 * VS.kitPct.briarwick.podChainMax pods count per rival per cascade.
 */
function burstRivals(w: World, x: number, z: number, r: number, pct: number, tag: string, knockH: number, chained: boolean): void {
  RIV_SHAPE.x = x; RIV_SHAPE.z = z; RIV_SHAPE.r = r;
  rivalsInShape(w, RIV_SHAPE, RIV);
  const n = RIV.length;
  if (n === 0) return;
  const list: number[] = [];
  for (let i = 0; i < n; i++) list.push(RIV[i]);
  const K = w.titan.kit, KB = VS.kitPct.briarwick;
  for (let i = 0; i < n; i++) {
    const v = list[i];
    if (chained) {
      const c = K[CHAIN_KEY[v]] ?? 0;
      if (c >= KB.podChainMax) continue;
      K[CHAIN_KEY[v]] = c + 1;
    }
    // a cascade pod is a SLICE (dot): it neither waits on nor grants i-frames, so the pods 0.06 s apart each count (up to the cap)
    rivalHit(w, v, pct, 'seed', tag, x, z, knockH, chained);
    rivalSlow(w, v, 1 - KB.tangleSlow, KB.tangleS);
  }
}

/** Burst one pod: circle damage, tangle, heal, and set off the ripe pods around it (chain). */
function burst(w: World, h: Hazard, link: number, src: number): void {
  if (!h.alive) return;
  h.alive = false;
  const T = w.titan;
  const H = T.height;
  const d = h.data;
  const p = podXZ(h);
  const x = p.x, z = p.z;
  const area = Math.max(0.1, S(w, 'area'));
  const r = BRIAR.burstRH * s1(w, BRIAR.size1BurstRMul) * H * area;
  const ripeness = Math.max(0, Math.min(1, d.ripe ?? 0));
  const ripe = ripeness >= 1;
  let mul = (ripe ? 1 : BRIAR.greenMul) * (1 + Math.min(BRIAR.linkCap, BRIAR.linkBonus * link));
  if (src === SRC_HOOK) mul *= BRIAR.hookBurstMul * Math.max(0.25, S(w, 'abilityPower'));
  BURST_OPTS.knock = knockFor(w, BRIAR.burstKnock);
  snapBefore(w, x, z, r);
  damageArea(w, { k: 'circle', x, z, r }, titanDamage(w, BRIAR.burstDmg) * mul, BURST_OPTS);
  snapAfter(w);
  tangle(w, x, z, r, BRIAR.tangleS);
  // VS: a pod reaches a rival: kitPct.briarwick.pod (3 %, x greenMul if unripe) + TANGLE; a hook cascade counts <= podChainMax pods per rival
  if (w.mode === 'vs') burstRivals(w, x, z, r, VS.kitPct.briarwick.pod * (ripe ? 1 : BRIAR.greenMul), src === SRC_HOOK ? 'briar.chain' : 'briar.pod', RIVAL_KNOCK_H.auto, src === SRC_HOOK);
  w.events.push({ type: 'explosion', x, z, r, kind: 'seed' });
  w.events.push({ type: 'bloomBurst', x, z, r, link, ripe: ripeness });
  // spores drift back to the titan
  const heal = T.maxHp * BRIAR.healFrac * Math.max(0, S(w, 'sporeHeal'));
  const room = T.maxHp * BRIAR.healCapPerS - kv(w, 'healWin');
  if (heal > 0 && room > 0) { const a = Math.min(room, heal); T.kit.healWin = kv(w, 'healWin') + a; healTitan(w, a); }
  // chain: ripe neighbours go off next; unripe neighbours ripen
  const cr = BRIAR.chainRH * H * area * Math.max(0.1, S(w, 'chainRange'));
  const pods = titanHazards(w, 'bloom', hazBuf);
  for (let i = 0; i < pods.length; i++) {
    const o = pods[i];
    if (o === h || !o.alive || o.shape.k !== 'circle') continue;
    const od = o.data;
    if (od.pod !== 1) adopt(o);
    if (od.fuse >= 0) continue;
    if (hypot(o.shape.x - x, o.shape.z - z) > cr) continue;
    if (od.ripe >= 1) { od.fuse = BRIAR.chainDelayS; od.link = link + 1; od.src = src === SRC_HOOK ? SRC_HOOK : od.src; }
    else od.ripe = Math.min(1, od.ripe + BRIAR.greenRipenOnChain);
  }
}

/** TANGLE: stun the foes in a circle (elites × 0.3, heavies × 0.6; the boss is never an Enemy, so never stunned).
 *  Every foe whose stun this lengthens gets a `rooted` event (the view draws root coils for `t` s). */
function tangle(w: World, x: number, z: number, r: number, s: number): void {
  enemiesInCircle(w, x, z, r, enemyBuf);
  for (let i = 0; i < enemyBuf.length; i++) {
    const e = enemyBuf[i];
    if (!e.alive) continue;
    const k = e.elite || e.kind === 'elite' ? 0.3 : e.radius >= 2.4 ? 0.6 : 1;
    const t = s * k;
    if (t > e.stun) w.events.push({ type: 'rooted', id: e.id, x: e.x, z: e.z, t });
    e.stun = Math.max(e.stun, t);
  }
  enemyBuf.length = 0;
}

/** View only (CFIX 2026-09-30): at Size I most foes in a burst die to its damage before tangle() can root them, so the
 *  coils were never seen. snapBefore lists the living foes in the circle; snapAfter emits a `rootSnap` for each one the
 *  damage killed (the view springs a coil shut where it stood). Reads the world, writes only events: the sim is unchanged. */
function snapBefore(w: World, x: number, z: number, r: number): void { enemiesInCircle(w, x, z, r, snapBuf); }
function snapAfter(w: World): void {
  for (let i = 0; i < snapBuf.length; i++) {
    const e = snapBuf[i];
    if (!e.alive) w.events.push({ type: 'rootSnap', x: e.x, y: e.y, z: e.z, r: e.radius, h: e.height });
  }
  snapBuf.length = 0;
}

// ─────────────────────────────── floor breaks sprout pods ───────────────────────────────
function detectBreaks(w: World): void {
  const T = w.titan;
  let c = caches.get(w.titan);
  if (!c) { c = { alive: new Map(), seen: new Map() }; caches.set(w.titan, c); }
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
    if (prev === undefined || seenTick !== w.tick - 1 || b.alive >= prev) continue;
    if (distToBuilding(b, T.x, T.z) > near) continue;
    if (b.collapsed || b.alive <= 0) { plantPod(w, b.x, b.z, SRC_PASSIVE, 0); continue; }
    const broken = prev - b.alive;
    for (let k = 0; k < broken; k++) {
      if (w.rng.combat() < BRIAR.bloomFloorChance) {
        closestOnBuilding(b, T.x, T.z, pt);
        plantPod(w, pt.x, pt.z, SRC_PASSIVE, 0);
        break;
      }
    }
  }
}

// ─────────────────────────────── hook: POP-UP PARK ───────────────────────────────
const order: { h: Hazard; d: number }[] = [];
function popUpPark(w: World): void {
  const T = w.titan, K = T.kit;
  const H = T.height;
  const power = Math.max(0, S(w, 'abilityPower'));
  const area = Math.max(0.1, S(w, 'area'));
  T.abilityCd = hookCooldown(w, BRIAR.hookCdS);
  // 1) horn stamp
  const rr = BRIAR.ringRH * s1(w, BRIAR.size1BurstRMul) * H * area;
  RING_OPTS.knock = knockFor(w, BRIAR.ringKnock);
  snapBefore(w, T.x, T.z, rr);
  damageArea(w, { k: 'circle', x: T.x, z: T.z, r: rr }, titanDamage(w, BRIAR.ringDmg * power), RING_OPTS);
  snapAfter(w);
  tangle(w, T.x, T.z, rr, BRIAR.ringTangleS);
  if (w.mode === 'vs') {
    // a new cascade: every rival's pod-chain count starts again; the horn ring itself: ringPop (6 %) + TANGLE
    for (let i = 0; i < CHAIN_KEY.length; i++) if (K[CHAIN_KEY[i]] !== undefined) K[CHAIN_KEY[i]] = 0;
    burstRivals(w, T.x, T.z, rr, VS.kitPct.briarwick.ringPop, 'briar.ring', RIVAL_KNOCK_H.hook, false);
  }
  w.events.push({ type: 'explosion', x: T.x, z: T.z, r: rr, kind: 'seed' });
  // 2) seed volley at the nearest foes (then the nearest boss part, then a fan ahead)
  const n = Math.max(3, Math.min(10, BRIAR.volleyN + Math.round(2 * (power - 1))));
  const vr = BRIAR.volleyRH * s1(w, BRIAR.size1LenMul) * H;
  nearestEnemies(w, T.x, T.z, vr, n, enemyBuf);
  let planted = 0;
  for (let i = 0; i < enemyBuf.length && planted < n; i++) {
    const e = enemyBuf[i];
    if (!e.alive) continue;
    plantPod(w, e.x, e.z, SRC_HOOK, 1, true); planted++;
  }
  enemyBuf.length = 0;
  const B = w.boss;
  if (planted < n && B && B.alive && B.introT <= 0) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < B.parts.length; i++) {
      const p = B.parts[i];
      const dd = hypot(p.x - T.x, p.z - T.z) - p.r;
      if (dd <= vr && dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) {
      const p = B.parts[best];
      while (planted < n) { plantPod(w, p.x, p.z, SRC_HOOK, 1, true); planted++; }
    }
  }
  for (let i = 0; planted < n; i++, planted++) {
    const a = T.heading + (i - (n - planted - 1) / 2) * 0.5;
    plantPod(w, T.x + sin(a) * 2.5 * H, T.z + cos(a) * 2.5 * H, SRC_HOOK, 1, true);
  }
  // 3) every pod within reach ripens and detonates, outward
  const hr = BRIAR.hookRH * H;
  const pods = titanHazards(w, 'bloom', hazBuf);
  order.length = 0;
  for (const h of pods) {
    if (h.shape.k !== 'circle') continue;
    const dd = hypot(h.shape.x - T.x, h.shape.z - T.z);
    if (dd <= hr) order.push({ h, d: dd });
  }
  order.sort((a, b) => a.d - b.d || a.h.id - b.h.id);
  for (let i = 0; i < order.length; i++) {
    const d = order[i].h.data;
    if (d.pod !== 1) adopt(order[i].h);
    d.ripe = 1;
    d.src = SRC_HOOK;
    d.link = i;
    d.fuse = (d.vol ? BRIAR.volleyFlightS : BRIAR.cascadeStartS) + BRIAR.rippleS * i;
  }
  K.chain = order.length;
  K.bloomT = 0.6 + BRIAR.rippleS * order.length;
  emitAbility(w, 'briarwick', power);
}

// ─────────────────────────────── dash: BRAMBLE BOUND seed trail ───────────────────────────────
export function onDash(w: World, x0: number, z0: number, x1: number, z1: number): void {
  const n = BRIAR.dashPods;
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1);
    plantPod(w, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, SRC_DASH, 0);
  }
}
