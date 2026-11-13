// BLOCKTOOTH — SWITCHBOARD-5, "HALVARD MOBILE SWITCHBOARD": gatekeeper 3 (LV 27, the Size III ceiling).
// GATEKEEPERS.md §3.0 / §3.3 (lane K1b). SIM: THREE-free, DOM-free, deterministic: fight AI rolls w.rng.boss, the
// adds it summons roll their positions from w.rng.spawn (spawnEnemy itself rolls w.rng.ai, as every spawn does).
//
// A wide four-track crawler base with four outrigger feet, a lattice mast, a slowly turning crown with THREE RELAY
// DISHES on arms, a NOW SERVING board and a cluster of horns ON THE BASE DECK (never on top: no head-like crown).
// Tests: ADDS to manage and a CHASE.
//
// Authored in titan heights (H = bossH, 25.6 m at home; R = titan radius). Parts (× H) rewritten every tick by
// sync() (called from keepOut, which bosses/index.ts calls on every tick, stagger included):
//   base 0,0 r.8 (strain .15) · dishA/B/C unfolded at 0.95 H × (sin, cos)(θ + 0/120/240°), r.35, y 2.2–2.7, hp 1.5,
//   strain 2.5 · folded (PACKING UP / driving / PLANTING) at 0.25 H, r.12, y 1.9–2.2, hp .5, strain 0 ·
//   outriggers ±.85,±.85 r.2 (r 0 while lifted). θ = b.data.crown turns at 0.35 / 0.45 / 0.55 rad/s by phase while
//   planted. LINES DOWN (the stagger) keeps the dishes OUT (drooped, still hittable).
// Hard keep-out 1.25 H + R (1.67 H). Crush tier 3 (gateCrushTier; 4 in a rematch / RAMMING THROUGH).
// Modes (b.data.mode): 0 PLANTED (no translation, the crown turns, the base turns to the titan at 0.6 rad/s) ·
//   1 PACKING UP for a hunt (1.0 s) · 2 HUNT drive (huntClose / huntHot × titanWalk, gateUnstick) until within
//   3.0 H · 3 PLANTING (1.0 s) · 4 RELOCATE packing (1.0 s) · 5 RELOCATE drive · 6 RELOCATE planting (1.0 s, or
//   0.6 s when CAUGHT). Band [1.67, 4.5] H: the hunt starts after the titan has been farther than 4.5 H for 1.5 s.
//   Dishes are folded (unhittable, weakMask 0) in modes 1, 2, 3, 4, 5, 6; unfolded (weakMask = the three dish
//   bits) while planted and during LINES DOWN.
// Behaviours (gaps [_, 2.3, 1.9, 1.6] × (0.85–1.15), P3 × P3_GAP 0.65, × (1 − 0.1 pressure); gateWindup; bossTelegraph(…, false);
//   damage = min(bossHostile(base), GATES.hitCap × maxHp)); only while planted:
//   P1+ callIn      3 / 4 / 5 lobbed 'callFlare' (circle r 0.5 H): the lead on the lead point, the rest by
//                   volleyPoints (beyond the lead, ±60°, ≥ 1.94 H apart); gateWindup(0.5 H + R, 1.1, 2.0) + 0.15 s × i;
//                   dmg 12 each.
//   P1+ putThrough  its own timer 13 / 11 / 9 s × (1 − 0.1 pressure) (b.data.putT; a probe may force it to 0):
//                   P1 a PICKET SQUAD (5) + 3 CROSSING WARDENs; P2 + 3 GNATs; P3 + 1 HOPPER, at the spawn ring on the
//                   titan's far side from the tower (rng.spawn), at most 14 of its adds alive (gateAddIds). A 1.0 s
//                   subtitle beat with a `bossAttack` event (the NOW SERVING board ticks: b.data.serving).
//   P2+ holdMusic   ring around the base 0 → 2.0 H, only with the titan within 2.1 H; gateWindup(2.0 H − d + R,
//                   1.0, 1.9); dmg 14 + knock 0.8 H/s outward. The P3 SIGNATURE: once per cycle (P3 entry, then
//                   after each PUT THROUGH, RELOCATE or LINES DOWN) it is due and fires at the next gap, before a
//                   relocation, whenever the ring can reach the titan's body (within 2.0 H + R) (fx2 lane B).
//                   Never cast when the straight-out walk (±20°) meets a building the titan cannot flatten
//                   (holdEscape; the signature then waits up to 1.5 s of decision time for the titan to step off
//                   the wall); the windup is floored by the walk at SMASH_SLOW when the way out plows (holdWindup).
//   P1+ relocate    after the titan has spent 5 / 4 / 3 s within 2.6 H since the last relocation (≥ 12 s ago), no
//                   attack live: PACKING UP 1.0 s, then drives to the best of 8 points 7 H around the titan (in bounds
//                   by 3 H, clear along laneClearLen; the side away from the titan first; rng.boss tie-break) at
//                   0.8 / 0.85 / 0.9 × titanWalk for ≤ 6 s, dropping a 'callFlare' (circle r 0.4 H, gateWindup(0.4 H +
//                   R, 0.9, 1.8), dmg 10) behind it every 1.2 s (one live at a time, ≥ 1.8 H apart along the path).
//                   CAUGHT (the titan pressing against the base's wall, see below) → plants in 0.6 s; arrival or the
//                   6 s limit → plants in 1.0 s.
//   any dash answer (watchDash, cd [_, 8, 6, 5]) one 'callFlare' circle r 0.45 H past the dash end, gateWindup at
//                   k 1 (0.9–1.8); dmg 6.
// FEEDBACK: the DISHES (strain 2.5). Full → LINES DOWN (bosses/index.ts: 4.5 s, ×2 damage): the dishes droop (still
//   out) and every add it summoned that is alive is stunned 3 s (CALL DROPPED).
// CAUGHT distance (contract gap, reported): §3.3 says "a titan within 1.5 H of the moving base", but the hard
//   keep-out holds the titan's centre at ≥ 1.67 H, so 1.5 H centre-to-centre can never happen, and 1.5 H from
//   the base's EDGE (2.3 H centre) is inside the 2.6 H camping radius: every relocation would be caught 0.3 s
//   after it starts driving, with no chase at all. Built as: the titan's centre within keep-out + CATCH_H
//   (0.35 H) of the base's centre (pressing against the wall), after ≥ 0.3 s of driving.
// Beats (no event): packUp / planting (hunt), caught, linesDown (the whole stagger; staggerBeat), reconfiguring,
//   ramming, cutOff. REMATCH (slot 0) chasing a running titan (rematchChasing): packs up at once, drives and trails
//   it (chaseStep), never plants or attacks while it runs.
// Telemetry: callIns, relocates, caught, putThroughs, addsSummoned, linesDown, serving, part_dish / part_other,
//   open_dish / open_all.

import { atan2, cos, hypot, sin } from '../../core/detmath.ts';
import type { BossState, EnemyKind, World } from '../../core/types.ts';
import { CITY, RANKS, SMASH_SLOW } from '../../core/config.ts';
import { clamp, dist, wrapAngle } from '../../core/math.ts';
import {
  ESCAPE_K, REACT_S, baseBoss, beginAttack, bossH, bossTelegraph, endAttack, gateAddIds, gateRing, gateSettledH, gateWindup,
  laneClearLen, leadPoint, makePart, moveBoss, refreshParts, registerGateAdd, repeatMul, pickWeighted, shoveTitan,
  fairLossS, titanWalk, turnBoss, volleyPoints, watchDash, denialRing,
} from './index.ts';
import {
  CHASE_VOLLEY_S, P3_GAP, chaseStep, gateAfterMove, gateBeats, gateGap, gateHit, gateHunt, gateWindupK1, huntSpeed, isMoveBeat,
  rematchChasing, staggerBeat, startBeat,
} from './stencil1.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { spawnEnemy } from '../enemies.ts';
import { buildingsInRect, resolveCircleVsCity } from '../../city/citysim.ts';
import { TURN_RATE_I, TURN_RATE_V } from '../../titans/titansim.ts';
import { stat } from '../../upgrades/stats.ts';

// ─────────────────────────────── tuning (× H unless noted) ───────────────────────────────
export const BAND_MIN_H = 1.67, BAND_MAX_H = 4.5;
export const KEEP_H = 1.25;
const CROWN: readonly number[] = [0, 0.35, 0.45, 0.55];
const BASE_TURN = 0.6, HUNT_TURN = 1.2, INTRO_WALK = 1.4;
const GAP = [0, 2.3, 1.9, 1.6] as const;
const HUNT = { farS: 1.5, packS: 1.0, plantS: 1.0, stopH: 3.0 };
const CALLIN = { n: [0, 3, 4, 5] as const, rH: 0.5, min: 1.1, max: 2.0, stagger: 0.15, dmg: 12, recover: 0.5, yH: 2.6 };
const HOLD = { rH: 2.0, triggerH: 2.1, min: 1.0, max: 1.9, dmg: 14, knockH: 0.8, recover: 0.5, waitS: 1.5 };
const RELOC = {
  campH: 2.6, campS: [0, 5, 4, 3] as const, everyS: 12, packS: 1.0, ringH: 7, boundsPadH: 3, speed: [0, 0.8, 0.85, 0.9] as const,
  maxS: 6, arriveH: 0.3, plantS: 1.0, caughtPlantS: 0.6, flareEveryS: 1.2, flareRH: 0.4, flareGapH: 1.8, flareMin: 0.9,
  flareMax: 1.8, flareDmg: 10,
};
/** CAUGHT: the titan's centre within keep-out + this (H) of the moving base (see the header note). */
export const CATCH_H = 0.35;
const PUT = { everyS: [0, 13, 11, 9] as const, maxAdds: 14, beatS: 1.0 };
const DASH_ANSWER = { rH: 0.45, aheadR: 0.3, cd: [0, 8, 6, 5] as const, dmg: 6, min: 0.9, max: 1.8, yH: 2.6 };
/** TITAN PASS D2 (GATEKEEPERS §3.6): which tells carry a RINGBACK (bosses/index.ts denialRing). */
const RINGBACK = { callIn: true, dash: true, dashPhase: 1 };
const STUN_S = 3;

/** Dish part geometry (H units): [radial, r, y0, y1, hpMul, strainMul]. */
const DISH_OUT = [0.95, 0.35, 2.2, 2.7, 1.5, 2.5] as const;
const DISH_FOLD = [0.25, 0.12, 1.9, 2.2, 0.5, 0] as const;
export const DISH_IX: readonly number[] = [1, 2, 3];
const DISH_DEG = [0, 120, 240] as const;
const OUTRIGGERS: readonly (readonly [string, number, number])[] = [
  ['outriggerFL', -0.85, 0.85], ['outriggerFR', 0.85, 0.85], ['outriggerBL', -0.85, -0.85], ['outriggerBR', 0.85, -0.85],
];

const LEAD = { x: 0, z: 0 };
const VOLLEY = new Float32Array(16);

// ─────────────────────────────── module contract ───────────────────────────────
export function create(w: World): BossState {
  const H = gateSettledH(w);
  const parts = [makePart('base', 0, 0, 0.8 * H, 0, 0.6 * H, 1, 0.15)];
  for (let i = 0; i < 3; i++) {
    const a = (DISH_DEG[i] * Math.PI) / 180;
    parts.push(makePart(['dishA', 'dishB', 'dishC'][i], DISH_OUT[0] * H * sin(a), DISH_OUT[0] * H * cos(a), DISH_OUT[1] * H, DISH_OUT[2] * H, DISH_OUT[3] * H, DISH_OUT[4], DISH_OUT[5]));
  }
  for (const o of OUTRIGGERS) parts.push(makePart(o[0], o[1] * H, o[2] * H, 0.2 * H, 0, 0.3 * H, 1, 0.3));
  const b = baseBoss('switchboard5', w.titan.x, w.titan.z, 0, parts);
  const d = b.data;
  d.crown = 0; d.folded = 0; d.lifted = 0; d.weakMask = 0;
  d.mode = 0; d.modeT = 0; d.farT = 0; d.campT = 0; d.lastRelocT = -1e9;
  d.putT = PUT.everyS[1]; d.serving = 5;   // the first crew comes one full P1 timer in (§3.3)
  d.bandMinH = BAND_MIN_H; d.bandMaxH = BAND_MAX_H;
  d.destX = 0; d.destZ = 0; d.flareT = 0; d.flareId = -1; d.flareX = NaN; d.flareZ = NaN;
  d.callIns = 0; d.relocates = 0; d.caught = 0; d.putThroughs = 0; d.addsSummoned = 0; d.linesDown = 0; d.wasStag = 0;
  d.part_dish = 0; d.part_other = 0; d.open_dish = 0; d.open_all = 0;
  d.p3Seen = 0; d.holdDue = 0; d.fleeT = 0; d.fleeTick = -1;
  d.syncTick = -1;
  return b;
}

/** Hard keep-out 1.25 H + R (centre to centre). Also the per-tick part sync (bosses/index.ts calls it every tick). */
export function keepOut(w: World, b?: BossState): number {
  if (b) sync(w, b);
  const H = b ? bossH(w, b) : Math.max(1, w.titan.height);
  return KEEP_H * H + w.titan.radius;
}

export function step(w: World, b: BossState): void {
  const T = w.titan, d = b.data;
  const H = bossH(w, b);
  const dd = dist(b.x, b.z, T.x, T.z);
  d.modeT += w.dt;
  const chasing = rematchChasing(w, b);
  if (b.introT > 0) {
    // drives in folded, plants as the intro ends (a rematch chasing a runner keeps driving: no plant at its back)
    if (chasing && dd <= (BAND_MAX_H - 1.0) * H) { setMode(b, 2); chaseStep(w, b, dd, (BAND_MIN_H + 0.5) * H, HUNT_TURN); }
    else if (dd > (BAND_MAX_H - 1.0) * H) { setMode(b, 2); gateHunt(w, b, INTRO_WALK * titanWalk(w), HUNT_TURN); }
    else { if (d.mode === 2) setMode(b, 3); b.data.speed = 0; turnBoss(b, atan2(T.x - b.x, T.z - b.z), BASE_TURN, w.dt); }
    if (d.mode === 3 && d.modeT >= HUNT.plantS) setMode(b, 0);
    sync(w, b);
    return;
  }
  if (d.mode === 2 && b.attack === null && dd <= HUNT.stopH * H && !chasing) setMode(b, 3);   // an intro that ended mid-drive
  yieldWall(w, b);
  gateBeats(w, b);
  putThroughTimer(w, b);
  // camping clock (RELOCATE) and the far clock (HUNT)
  if (dd <= RELOC.campH * H) d.campT += w.dt;
  d.farT = dd > BAND_MAX_H * H ? d.farT + w.dt : 0;

  if (b.attack === 'relocate' || b.attack === 'caught') runRelocate(w, b);
  else if (!b.attack || isMoveBeat(b.attack) || b.attack === 'packUp' || b.attack === 'planting') moveModes(w, b, dd, chasing);
  else runAttack(w, b);
  dashAnswer(w, b);
  gateAfterMove(w, b);
  sync(w, b);
}

/** Per-part telemetry (probe_gatekeepers case 5). */
export function onDamage(_w: World, b: BossState, part: number, dmg: number): void {
  const d = b.data;
  const dish = part === 1 || part === 2 || part === 3;
  if (dish) d.part_dish += dmg; else d.part_other += dmg;
  if ((d.weakMask ?? 0) > 0) { d.open_all += dmg; if (dish) d.open_dish += dmg; }
}

// ─────────────────────────────── modes ───────────────────────────────
function setMode(b: BossState, m: number): void {
  if (b.data.mode === m) return;
  b.data.mode = m;
  b.data.modeT = 0;
}

/** Planted / hunt modes (no real attack live). */
function moveModes(w: World, b: BossState, dd: number, chasing: boolean): void {
  const T = w.titan, d = b.data, H = bossH(w, b);
  if (b.phase >= 3 && !(d.p3Seen > 0)) { d.p3Seen = 1; d.holdDue = 1; d.holdWaitT = 0; }
  switch (d.mode) {
    case 0: {   // PLANTED
      b.data.speed = 0;
      turnBoss(b, atan2(T.x - b.x, T.z - b.z), BASE_TURN, w.dt);
      d.crown = wrapAngle((d.crown ?? 0) + (CROWN[b.phase] ?? 0.35) * w.dt);
      if (b.attack) break;   // a move beat (cutOff / ramming) while planted: nothing else
      // a rematch chasing a runner packs up at once (no 1.5 s far clock, no attack at its back)
      if (d.farT >= HUNT.farS || (chasing && dd > (BAND_MIN_H + 0.5) * H)) { setMode(b, 1); startBeat(b, 'packUp', HUNT.packS); break; }
      if (d.putDue > 0) { putThrough(w, b); break; }
      // P3 SIGNATURE: HOLD MUSIC once per cycle (P3 entry, then after each PUT THROUGH, RELOCATE or LINES DOWN)
      // whenever the ring can reach the titan's body — it waits for its gap here instead of relocating first
      if (b.phase >= 3 && d.holdDue > 0 && dd <= HOLD.rH * H + T.radius && b.staggerT <= 0) {
        if (holdEscape(w, b, dd)) {
          if (b.cd <= 0) { d.holdDue = 0; d.holdWaitT = 0; holdMusic(w, b, dd); }
          break;
        }
        // the titan's straight way out is walled (holdEscape): the ring would not be fair right now — give it up to
        // HOLD.waitS of its decision time to step off the wall before the rig calls in flares instead
        if (b.cd <= 0 && (d.holdWaitT = (d.holdWaitT ?? 0) + w.dt) < HOLD.waitS) break;
      }
      if (d.campT >= (RELOC.campS[b.phase] ?? 5) && w.t - d.lastRelocT >= RELOC.everyS && b.staggerT <= 0) { startRelocate(w, b); break; }
      if (b.cd <= 0) decide(w, b, dd);
      break;
    }
    case 1:     // PACKING UP for the hunt (the beat ends it)
      b.data.speed = 0;
      if (d.modeT >= HUNT.packS) { if (b.attack === 'packUp') endAttack(b, Math.max(b.cd, 0.2)); setMode(b, 2); }
      break;
    case 2:     // HUNT drive (a rematch chasing a runner keeps driving, trailing it inside stopH: chaseStep)
      if (chasing) { chaseStep(w, b, dd, (BAND_MIN_H + 0.5) * H, HUNT_TURN); break; }
      if (dd <= HUNT.stopH * H) { setMode(b, 3); startBeat(b, 'planting', HUNT.plantS); b.data.speed = 0; break; }
      gateHunt(w, b, huntSpeed(w, b, dd), HUNT_TURN);
      break;
    case 3:     // PLANTING
      b.data.speed = 0;
      turnBoss(b, atan2(T.x - b.x, T.z - b.z), BASE_TURN, w.dt);
      if (d.modeT >= HUNT.plantS) { if (b.attack === 'planting') endAttack(b, Math.max(b.cd, 0.4)); setMode(b, 0); }
      break;
    default:    // a relocate mode without its attack (interrupted by a stagger): plant again
      setMode(b, 3);
  }
}

/**
 * bosses/index.ts projects the titan onto the hard keep-out, then settles it against the CITY: a titan pinned
 * against a building it cannot flatten can end the tick inside the wall. The rig yields instead: at the start of
 * its step it backs straight off by the overlap (never shoves the titan through a building) — ONLY in that pinned
 * case (the keep-out point the titan would be put back on lies inside a building it cannot flatten, the same test
 * probe_gatekeepers uses to classify a pin). fx2 lane B: it used to yield to ANY overlap, so a titan simply walking
 * into the rig pushed it along at walk speed — the wall you are meant to go AROUND could be bulldozed, and a titan
 * holding the stick toward the weak point during a tell carried the rig (and itself) deeper into a telegraph that
 * stays where it was cast (BACKFIRE's cone, HOLD MUSIC's ring; fx2/B/bf_walker.ts).
 */
const PIN = { x: 0, z: 0, bumpTier: -1 };
function yieldWall(w: World, b: BossState): void {
  const T = w.titan;
  if (!T.alive) return;
  const keep = KEEP_H * bossH(w, b) + T.radius;
  const dx = b.x - T.x, dz = b.z - T.z, d = hypot(dx, dz);
  if (d >= keep - 1e-3 || d < 1e-4) return;
  const wx = b.x - (dx / d) * keep, wz = b.z - (dz / d) * keep;
  const flat = RANKS[clamp(Math.floor(T.rank), 0, RANKS.length - 1)].canFlatten;
  if (!resolveCircleVsCity(w.city, wx, wz, T.radius, flat, PIN)) return;   // open ground: pushTitanOut puts it back
  const need = keep - d;
  b.x += (dx / d) * need; b.z += (dz / d) * need;
  refreshParts(b);
}

// ─────────────────────────────── sync ───────────────────────────────
function sync(w: World, b: BossState): void {
  const d = b.data;
  const H = bossH(w, b);
  const stag = b.staggerT > 0;
  if (d.syncTick !== w.tick) {
    d.syncTick = w.tick;
    if (stag && !(d.wasStag > 0)) {
      d.wasStag = 1;
      d.linesDown += 1;
      // CALL DROPPED: every add it summoned that is still alive is stunned 3 s
      const ids = gateAddIds(w);
      for (let k = 0; k < ids.length; k++) {
        for (let i = 0; i < w.enemies.length; i++) {
          const e = w.enemies[i];
          if (e.id === ids[k]) { if (e.alive) e.stun = Math.max(e.stun, STUN_S); break; }
        }
      }
      // a relocation interrupted by the stagger plants where it stands
      if (d.mode >= 1) setMode(b, 3);
      if (b.phase >= 3) { d.holdDue = 1; d.holdWaitT = 0; }   // LINES DOWN ends a cycle
    } else if (!stag) d.wasStag = 0;
  }
  staggerBeat(b, 'linesDown');
  const folded = !stag && d.mode !== 0 && b.alive;
  d.folded = folded ? 1 : 0;
  d.lifted = folded && d.mode !== 3 && d.mode !== 6 ? 1 : 0;
  const g = folded ? DISH_FOLD : DISH_OUT;
  const th = d.crown ?? 0;
  const p0 = b.parts[0];
  if (p0) { p0.ox = 0; p0.oz = 0; p0.r = 0.8 * H; p0.y0 = 0; p0.y1 = 0.6 * H; }
  for (let i = 0; i < 3; i++) {
    const p = b.parts[DISH_IX[i]];
    if (!p) continue;
    const a = th + (DISH_DEG[i] * Math.PI) / 180;
    p.ox = g[0] * H * sin(a); p.oz = g[0] * H * cos(a); p.r = g[1] * H; p.y0 = g[2] * H; p.y1 = g[3] * H;
    p.hpMul = g[4]; p.strainMul = g[5];
  }
  for (let i = 0; i < OUTRIGGERS.length; i++) {
    const p = b.parts[4 + i];
    if (!p) continue;
    p.ox = OUTRIGGERS[i][1] * H; p.oz = OUTRIGGERS[i][2] * H; p.r = d.lifted > 0 ? 0 : 0.2 * H; p.y0 = 0; p.y1 = 0.3 * H;
  }
  d.weakMask = !folded && b.alive ? (1 << DISH_IX[0]) | (1 << DISH_IX[1]) | (1 << DISH_IX[2]) : 0;
  refreshParts(b);
}

// ─────────────────────────────── decision ───────────────────────────────
const ATTACKS = ['callIn', 'holdMusic'] as const;
function decide(w: World, b: BossState, dd: number): void {
  const H = bossH(w, b);
  const wts = [
    1.0,                                                        // callIn
    // holdMusic (anti-camping) — never at a titan walled in against a building it cannot flatten (holdEscape)
    b.phase >= 2 && dd <= HOLD.triggerH * H && holdEscape(w, b, dd) ? 2.0 : 0,
  ];
  for (let i = 0; i < wts.length; i++) wts[i] *= repeatMul(b, ATTACKS[i]);
  const id = pickWeighted(w, ATTACKS, wts) ?? 'callIn';
  if (id === 'holdMusic') holdMusic(w, b, dd); else callIn(w, b);
}

function callIn(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const r = CALLIN.rH * H;
  const wu = gateWindup(w, b, CALLIN.rH + R / H, CALLIN.min, CALLIN.max);
  const L = leadPoint(w, b, wu, LEAD);
  beginAttack(w, b, 'callIn', L.x, L.z);
  b.data.dir = atan2(L.x - b.x, L.z - b.z);
  b.data.callIns += 1;
  const n = volleyPoints(w, b, L.x, L.z, CALLIN.n[b.phase] ?? 3, r, VOLLEY);
  let end = 0;
  for (let i = 0; i < n; i++) {
    const tx = VOLLEY[2 * i], tz = VOLLEY[2 * i + 1];
    const tg = bossTelegraph(w, {
      style: 'circle', shape: { k: 'circle', x: tx, z: tz, r },
      windup: wu + CALLIN.stagger * i, dmg: gateHit(w, CALLIN.dmg), kind: 'shell', tag: 'lob:callFlare',
    }, false);
    spawnProjectile(w, {
      owner: 'boss', kind: 'callFlare', x: b.x, z: b.z, y: CALLIN.yH * H, vx: 0, vz: 0,
      dmg: 0, lob: true, tx, tz, aoe: r, life: tg.windup, tg: tg.id,
    });
    end = Math.max(end, tg.windup);
    // TITAN PASS D2 (GATEKEEPERS §3.6): the lead flare's RINGBACK — step out and stop; a blind dash lands in it
    if (i === 0 && RINGBACK.callIn) end = Math.max(end, denialRing(w, b, tx, tz, r, tg.windup, gateHit(w, CALLIN.dmg), 'shell', 'ringback')?.windup ?? 0);
  }
  b.data.attackEnd = end + CALLIN.recover;
}

const HM_BUF: number[] = [];
/** Does a straight walk of len from (x, z) along (ux, uz) meet a building the titan cannot flatten (its full collision
 *  radius; 0.25 R steps)? */
function walled(w: World, x: number, z: number, ux: number, uz: number, len: number): boolean {
  const T = w.titan, c = w.city, R = T.radius;
  if (!c || !c.buildings) return false;
  const flat = RANKS[clamp(Math.floor(T.rank), 0, RANKS.length - 1)].canFlatten;
  const step = Math.max(0.25, 0.25 * R);
  for (let s = step; s <= len + 1e-9; s += step) {
    const px = x + ux * s, pz = z + uz * s;
    HM_BUF.length = 0;
    buildingsInRect(c, px - R, pz - R, px + R, pz + R, HM_BUF);
    for (let i = 0; i < HM_BUF.length; i++) {
      const bd = c.buildings[HM_BUF[i]];
      if (!bd || bd.collapsed || bd.tier <= flat) continue;
      const qx = clamp(px, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(pz, bd.z - bd.d / 2, bd.z + bd.d / 2);
      // 5 % skin: a titan resting against a wall (resolved to exactly R) that walks PARALLEL to it is not walled
      if (hypot(px - qx, pz - qz) < 0.95 * R) { HM_BUF.length = 0; return true; }
    }
  }
  HM_BUF.length = 0;
  return false;
}
const HM_ESC = { len: 0, x: 0, z: 0, turn: 0 };
/**
 * HOLD MUSIC's walk-out (fx2 lane B; probe case 6c: a 0.35 s no-dash walker ate 29 of 50 rings, and fx2/B/hm_walker.ts
 * found why: a titan backed against a building it cannot flatten has NO radial way out). Over 17 headings within ±80°
 * of straight away from the base (never back past it), the shortest straight walk that takes the whole body out of
 * the disc (to r1 + R from the base's centre) without meeting such a building. Writes length, heading and the extra
 * turn it needs beyond the 90° pivot fairLossS allows (the titan faces the base: straight away is a 180° reversal).
 * false = the straight-out walk (±20°) meets such a building, or every heading does (then there is no fair ring: the
 * rig calls in flares instead).
 */
function holdEscape(w: World, b: BossState, dd: number): boolean {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const rOut = HOLD.rH * H + R;
  if (dd >= rOut) { HM_ESC.len = 0; HM_ESC.x = T.x - b.x; HM_ESC.z = T.z - b.z; HM_ESC.turn = 0; return true; }
  const rx = (T.x - b.x) / Math.max(1e-6, dd), rz = (T.z - b.z) / Math.max(1e-6, dd);
  let best = Infinity;
  for (let k = -8; k <= 8; k++) {
    const th = (k / 8) * (80 * Math.PI / 180);
    const c = cos(th), sn = sin(th);
    const ux = rx * c - rz * sn, uz = rx * sn + rz * c;
    // ray from the titan (at dd from the base's centre) to the circle rOut: s = −dd·cosθ + √(rOut² − dd²·sin²θ)
    const L = Math.sqrt(Math.max(0, rOut * rOut - dd * dd * sn * sn)) - dd * c;
    if (!(L >= 0)) continue;
    // the READ of a ring is "walk straight out": within ±20° of straight away (a keyboard player's nearest key) the way
    // out must be open, or the titan backed against a building it cannot flatten slides along it at a fraction of its
    // walk (fx2/B/hm_walker.ts: RADIAL walkers pressed into a tier-3 wall, velocity turned 60° off the input) -> no ring
    if (Math.abs(k) <= 2) { if (walled(w, T.x, T.z, ux, uz, L)) return false; }
    else if (L >= best || walled(w, T.x, T.z, ux, uz, L)) continue;
    if (L >= best) continue;
    best = L; HM_ESC.x = ux; HM_ESC.z = uz; HM_ESC.turn = Math.max(0, Math.PI / 2 - Math.abs(th));
  }
  if (!Number.isFinite(best)) return false;
  HM_ESC.len = best;
  return true;
}
/** HOLD MUSIC's windup from holdEscape: the extra reversal turn at the titan's turn rate is added as walk distance, the
 *  heading goes to gateWindup for its plow check, and k = 1 in every phase (an anti-camping answer is a read, not a
 *  dash check). Call holdEscape first. */
function holdWindup(w: World, b: BossState): number {
  const T = w.titan, H = bossH(w, b);
  const r = clamp(Math.floor(Number.isFinite(T.rank) ? T.rank : 0), 0, 4);
  const turn = TURN_RATE_I + (TURN_RATE_V - TURN_RATE_I) * (r / 4);
  const pivotM = (HM_ESC.turn / turn) * titanWalk(w);
  const wu = gateWindup(w, b, (HM_ESC.len + pivotM) / H / (ESCAPE_K[b.phase] ?? 1), HOLD.min, HOLD.max, HM_ESC.x, HM_ESC.z);
  // floor: the walk-out grinds through a flattenable building inside the titan's PLOW reach (titansim contactRadius,
  // wider than the collision radius escapeWalk marches with) -> the whole walk at SMASH_SLOW (fx2/B/hm_walker.ts: the
  // walker slowed 0.88 -> 0.64 H/s mid-walk and a 1.59 s ring landed by 0.05 H)
  if (!(HM_ESC.len > 0) || !plowsInReach(w, HM_ESC.x, HM_ESC.z, HM_ESC.len)) return wu;
  const slow = T.slowT > 0 ? clamp(Number.isFinite(T.slowMul) ? T.slowMul : 1, 0.1, 1) : 1;
  const fair = REACT_S + fairLossS(w) + HM_ESC.turn / turn + HM_ESC.len / Math.max(1e-3, titanWalk(w) * slow * SMASH_SLOW);
  return Math.max(wu, fair);
}
/** titansim's plow reach (contactRadius: R × smashRadius + 0.06 H): does a straight walk of len from the titan along
 *  (ux, uz) pass a standing building it flattens inside that reach (0.25 R steps)? titansim then walks it at SMASH_SLOW. */
function plowsInReach(w: World, ux: number, uz: number, len: number): boolean {
  const T = w.titan, c = w.city;
  if (!c || !c.buildings) return false;
  const m = hypot(ux, uz);
  if (!(m > 1e-9)) return false;
  const fx = ux / m, fz = uz / m, R = T.radius;
  const reach = R * Math.max(0.2, stat(w, 'smashRadius')) + 0.06 * T.height;
  const flat = RANKS[clamp(Math.floor(T.rank), 0, RANKS.length - 1)].canFlatten;
  const step = Math.max(0.25, 0.25 * R);
  for (let s = 0; s <= len + 1e-9; s += step) {
    const px = T.x + fx * s, pz = T.z + fz * s;
    HM_BUF.length = 0;
    buildingsInRect(c, px - reach, pz - reach, px + reach, pz + reach, HM_BUF);
    for (let i = 0; i < HM_BUF.length; i++) {
      const bd = c.buildings[HM_BUF[i]];
      if (!bd || bd.collapsed || !(bd.alive > 0) || bd.tier > flat) continue;
      const qx = clamp(px, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(pz, bd.z - bd.d / 2, bd.z + bd.d / 2);
      if (hypot(px - qx, pz - qz) <= reach) { HM_BUF.length = 0; return true; }
    }
  }
  HM_BUF.length = 0;
  return false;
}

function holdMusic(w: World, b: BossState, dd: number): void {
  const H = bossH(w, b);
  const r1 = HOLD.rH * H;
  const wu = holdWindup(w, b);
  beginAttack(w, b, 'holdMusic', b.x, b.z);
  const bx = b.x, bz = b.z;
  const tg = bossTelegraph(w, {
    style: 'ring', shape: { k: 'ring', x: bx, z: bz, r0: 0, r1 },
    windup: wu, dmg: gateHit(w, HOLD.dmg), kind: 'shockwave', tag: 'holdMusic',
    onFire: (w2, tgf) => {
      const Tt = w2.titan;
      if (!tgf.hitTitan || !Tt.alive || Tt.dashT > 0) return;
      shoveTitan(b, Tt.x - bx, Tt.z - bz, HOLD.knockH * bossH(w2, b));
    },
  }, false);
  b.data.attackEnd = tg.windup + HOLD.recover;
}

function runAttack(w: World, b: BossState): void {
  const t = b.attackT, d = b.data;
  b.data.speed = 0;
  d.crown = wrapAngle((d.crown ?? 0) + (CROWN[b.phase] ?? 0.35) * w.dt);
  switch (b.attack) {
    case 'callIn':
    case 'holdMusic':
      if (t >= (d.attackEnd ?? 2) || (b.attack === 'callIn' && t >= CHASE_VOLLEY_S && rematchChasing(w, b))) endAttack(b, gateGap(w, b, GAP, P3_GAP));
      break;
    case 'putThrough':
    case 'reconfiguring':
      if (t >= (d.beatS ?? 1)) endAttack(b, Math.max(0.3, b.cd));
      break;
    default:
      endAttack(b, 1);
  }
}

// ─────────────────────────────── PUT THROUGH ───────────────────────────────
function putThroughTimer(w: World, b: BossState): void {
  const d = b.data;
  if (d.putDue > 0) return;
  d.putT -= w.dt;
  if (d.putT > 0) return;
  d.putDue = 1;
}

function addsAlive(w: World): number {
  const ids = gateAddIds(w);
  let n = 0;
  for (let k = 0; k < ids.length; k++) {
    for (let i = 0; i < w.enemies.length; i++) { const e = w.enemies[i]; if (e.id === ids[k]) { if (e.alive) n++; break; } }
  }
  return n;
}

const CREW: readonly (readonly EnemyKind[])[] = [
  [],
  ['squad', 'android', 'android', 'android'],
  ['squad', 'android', 'android', 'android', 'drone', 'drone', 'drone'],
  ['squad', 'android', 'android', 'android', 'drone', 'drone', 'drone', 'buggy'],
];
const SQUAD_SIZE = 5;

function putThrough(w: World, b: BossState): void {
  const d = b.data, T = w.titan, rs = w.rng.spawn, Bd = w.city.bounds;
  d.putDue = 0;
  const pr = b.slot === 0 ? 0 : clamp(w.gates.pressure, 0, 3);
  d.putT = (PUT.everyS[b.phase] ?? 13) * (1 - 0.1 * pr);
  let room = Math.max(0, PUT.maxAdds - addsAlive(w));
  let all = 0;
  for (let i = 0; i < w.enemies.length; i++) if (w.enemies[i].alive) all++;
  room = Math.min(room, Math.max(0, CITY.maxEnemies - all));
  // the crew arrives at the spawn ring on the titan's far side from the tower
  const ring = gateRing(w);
  const away = atan2(T.x - b.x, T.z - b.z);
  let spawned = 0;
  if (room > 0) {
    const crew = CREW[b.phase] ?? CREW[1];
    for (let c = 0; c < crew.length && spawned < room; c++) {
      const kind = crew[c];
      const a = away + (rs() - 0.5) * 1.4;
      const rr = ring * (1.0 + 0.15 * rs());
      const px = clamp(T.x + sin(a) * rr, Bd.minX, Bd.maxX), pz = clamp(T.z + cos(a) * rr, Bd.minZ, Bd.maxZ);
      if (kind === 'squad') {
        const sid = w.director.squadSeq++;
        const h = atan2(T.x - px, T.z - pz), fx = sin(h), fz = cos(h), qx = -fz, qz = fx;
        for (let s = 0; s < SQUAD_SIZE && spawned < room; s++) {
          const side = s === 0 ? 0 : (s % 2 === 1 ? -1 : 1) * Math.ceil(s / 2);
          const back = Math.ceil(s / 2) * 2.2;
          const e = spawnEnemy(w, 'squad', px + qx * side * 2.4 - fx * back, pz + qz * side * 2.4 - fz * back, { squad: sid, slot: s });
          e.heading = e.pheading = h;
          registerGateAdd(b, e.id);
          spawned++;
        }
      } else {
        const e = spawnEnemy(w, kind, px, pz);
        registerGateAdd(b, e.id);
        spawned++;
      }
    }
  }
  d.addsSummoned += spawned;
  d.putThroughs += 1;
  if (b.phase >= 3) { d.holdDue = 1; d.holdWaitT = 0; }   // a PUT THROUGH ends a cycle
  d.serving = (d.serving ?? 5) + 1;
  beginAttack(w, b, 'putThrough', b.x, b.z);
  b.data.beatS = PUT.beatS;
}

// ─────────────────────────────── RELOCATE ───────────────────────────────
function startRelocate(w: World, b: BossState): void {
  beginAttack(w, b, 'relocate', b.x, b.z);
  setMode(b, 4);
  b.data.relocates += 1;
  b.data.campT = 0;
  b.data.flareId = -1; b.data.flareX = NaN; b.data.flareZ = NaN;
}

/** Best of 8 points RELOC.ringH around the titan: in bounds by 3 H, clear along laneClearLen from the base; the side
 *  away from the titan first (it is running from a camper), rng.boss tie-break. false = nowhere to go. */
function pickDestination(w: World, b: BossState): boolean {
  const T = w.titan, H = bossH(w, b), Bd = w.city.bounds, pad = RELOC.boundsPadH * H;
  const r = b.parts[0] ? b.parts[0].r : 0.8 * H;
  const ax = b.x - T.x, az = b.z - T.z, am = hypot(ax, az) || 1;
  const a0 = w.rng.boss() * Math.PI * 2;
  let best = -Infinity, bx = NaN, bz = NaN;
  for (let i = 0; i < 8; i++) {
    const a = a0 + (i * Math.PI) / 4;
    const px = T.x + sin(a) * RELOC.ringH * H, pz = T.z + cos(a) * RELOC.ringH * H;
    if (px < Bd.minX + pad || px > Bd.maxX - pad || pz < Bd.minZ + pad || pz > Bd.maxZ - pad) continue;
    const dx = px - b.x, dz = pz - b.z, L = hypot(dx, dz);
    if (!(L > 1e-6)) continue;
    const clear = laneClearLen(w, b.x, b.z, dx / L, dz / L, L, r) >= L - 0.25 * H ? 1 : 0;
    // away from the titan, and not through it
    const awayCos = ((px - T.x) * ax + (pz - T.z) * az) / (RELOC.ringH * H * am);
    const sc = clear * 10 + awayCos + 0.01 * w.rng.boss();
    if (sc > best) { best = sc; bx = px; bz = pz; }
  }
  if (!Number.isFinite(bx)) return false;
  b.data.destX = bx; b.data.destZ = bz;
  return true;
}

function runRelocate(w: World, b: BossState): void {
  const T = w.titan, d = b.data, H = bossH(w, b);
  switch (d.mode) {
    case 4:   // PACKING UP
      b.data.speed = 0;
      if (d.modeT >= RELOC.packS) {
        if (pickDestination(w, b)) { setMode(b, 5); d.flareT = RELOC.flareEveryS * 0.5; }
        else { setMode(b, 6); }
      }
      break;
    case 5: { // drive (the chase)
      const dx = d.destX - b.x, dz = d.destZ - b.z, L = hypot(dx, dz);
      const keep = KEEP_H * H + T.radius;
      const caught = d.modeT >= 0.3 && dist(b.x, b.z, T.x, T.z) <= keep + CATCH_H * H;
      if (caught) { d.caught += 1; setMode(b, 6); d.plantS = RELOC.caughtPlantS; b.data.speed = 0; startBeat(b, 'caught', RELOC.caughtPlantS); break; }
      if (L <= RELOC.arriveH * H || d.modeT >= RELOC.maxS) { setMode(b, 6); d.plantS = RELOC.plantS; b.data.speed = 0; break; }
      const sp = Math.min((RELOC.speed[b.phase] ?? 0.8) * titanWalk(w), L / w.dt);
      turnBoss(b, atan2(dx, dz), HUNT_TURN, w.dt);
      moveBoss(w, b, (dx / L) * sp, (dz / L) * sp);
      trailFlare(w, b, dx / L, dz / L);
      break;
    }
    case 6:   // planting (arrival, the limit, or CAUGHT)
      b.data.speed = 0;
      turnBoss(b, atan2(T.x - b.x, T.z - b.z), BASE_TURN, w.dt);
      if (d.modeT >= (d.plantS ?? RELOC.plantS)) {
        setMode(b, 0);
        d.lastRelocT = w.t;
        d.campT = 0;
        if (b.phase >= 3) { d.holdDue = 1; d.holdWaitT = 0; }   // a RELOCATE ends a cycle
        endAttack(b, gateGap(w, b, GAP, P3_GAP));
      }
      break;
    default:
      setMode(b, 6);
  }
}

/** A 'callFlare' dropped behind the driving base every 1.2 s: one live at a time, ≥ 1.8 H from the last one. */
function trailFlare(w: World, b: BossState, fx: number, fz: number): void {
  const d = b.data, T = w.titan, H = bossH(w, b);
  d.flareT -= w.dt;
  if (d.flareT > 0) return;
  // one at a time: the last flare's telegraph must be gone
  if (d.flareId >= 0) {
    for (let i = 0; i < w.telegraphs.length; i++) { const t = w.telegraphs[i]; if (t.id === d.flareId && t.alive && !t.fired) return; }
  }
  const r = RELOC.flareRH * H;
  const back = (b.parts[0] ? b.parts[0].r : 0.8 * H) + r + 0.2 * H;
  const x = b.x - fx * back, z = b.z - fz * back;
  if (Number.isFinite(d.flareX) && dist(x, z, d.flareX, d.flareZ) < RELOC.flareGapH * H) return;
  const Bd = w.city.bounds;
  if (x < Bd.minX || x > Bd.maxX || z < Bd.minZ || z > Bd.maxZ) return;
  const wu = gateWindup(w, b, RELOC.flareRH + T.radius / H, RELOC.flareMin, RELOC.flareMax);
  const tg = bossTelegraph(w, {
    style: 'circle', shape: { k: 'circle', x, z, r },
    windup: wu, dmg: gateHit(w, RELOC.flareDmg), kind: 'shell', tag: 'lob:callFlare:trail',
  }, false);
  spawnProjectile(w, {
    owner: 'boss', kind: 'callFlare', x: b.x, z: b.z, y: CALLIN.yH * H, vx: 0, vz: 0,
    dmg: 0, lob: true, tx: x, tz: z, aoe: r, life: tg.windup, tg: tg.id,
  });
  d.flareId = tg.id; d.flareX = x; d.flareZ = z;
  d.flareT = RELOC.flareEveryS;
}

// ─────────────────────────────── dash answer ───────────────────────────────
function dashAnswer(w: World, b: BossState): void {
  const e = watchDash(w, b, DASH_ANSWER.cd);
  if (!e) return;
  const T = w.titan, H = bossH(w, b), Bd = w.city.bounds;
  const r = DASH_ANSWER.rH * H, reach = r + T.radius;
  const dx = e.x1 - e.x0, dz = e.z1 - e.z0, dl = hypot(dx, dz) || 1;
  const ahead = DASH_ANSWER.aheadR * reach;
  const x = clamp(e.x1 + (dx / dl) * ahead, Bd.minX, Bd.maxX), z = clamp(e.z1 + (dz / dl) * ahead, Bd.minZ, Bd.maxZ);
  const wu = gateWindupK1(w, b, DASH_ANSWER.rH + T.radius / H, DASH_ANSWER.min, DASH_ANSWER.max);
  const tg = bossTelegraph(w, {
    style: 'circle', shape: { k: 'circle', x, z, r },
    windup: wu, dmg: gateHit(w, DASH_ANSWER.dmg), kind: 'shell', tag: 'lob:callFlare:dash',
  }, false);
  spawnProjectile(w, {
    owner: 'boss', kind: 'callFlare', x: b.x, z: b.z, y: DASH_ANSWER.yH * H, vx: 0, vz: 0,
    dmg: 0, lob: true, tx: x, tz: z, aoe: r, life: tg.windup, tg: tg.id,
  });
  if (RINGBACK.dash && b.phase >= RINGBACK.dashPhase) denialRing(w, b, x, z, r, tg.windup, gateHit(w, DASH_ANSWER.dmg), 'shell', 'ringback:dash');
  b.data.followX = x; b.data.followZ = z;
}
