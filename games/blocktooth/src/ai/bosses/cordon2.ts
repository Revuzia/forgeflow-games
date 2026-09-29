// BLOCKTOOTH — CORDON-2, "HALVARD CROWD-BARRIER UNIT": gatekeeper 2 (LV 16, the Size II ceiling).
// GATEKEEPERS.md §3.0 / §3.2 (lane K1b). SIM: THREE-free, DOM-free, deterministic (every roll from w.rng.boss;
// the enemy spawns themselves roll w.rng.ai inside ai/enemies.ts spawnEnemy, as every spawn does).
//
// A tracked crowd-control unit carrying its own barricade: a curved front WALL of six chevron panels on twin
// tracks, an engine house with two stacks behind it, and the GENERATOR PACK (a cage of teal coils) on its back.
// Tests: a SHIELD you go AROUND.
//
// Authored in titan heights (H = bossH, 10.77 m at home; R = titan radius). Parts (× H) rewritten every tick by
// sync() (called from keepOut, which bosses/index.ts calls on every tick, stagger included):
//   body 0,−.1 r.7 · wallL/R ∓.85,+.55 r.45 (hp .15, strain 0) · wallC 0,+.7 r.5 (hp .15, strain 0)
//   · PACK 0,−.95 r.45 (hp 1.6, strain 3; × 1.25 while OVERHEATED) · trackL/R ∓.85,−.15 r.4.
//   DEVIATION from the §3.2 table (tracks at oz −0.3 H): measured on this geometry, the pack is the planar-nearest
//   part only over ±37° behind at the keep-out (the tracks win beyond), below the ≥ ±40° that §3.2 / §5.4 case 5
//   assert. The track centres move forward to −0.15 H (same r): ±42° (scratch geo.ts).
// Hard keep-out 1.2 H + R (1.62 H). Crush tier 2 (gateCrushTier; 4 in a rematch / RAMMING THROUGH).
// Footwork: band [1.6, 3.5] H: keepRange(1.6 H, 3.5 H, 0.55 × titanWalk, 0.9 / 1.05 / 1.2 rad/s by phase) — the
//   titan orbits at about the same rate, so walking round the wall is a tie: the windows and a dash get you
//   behind it. Past 3.5 H it HUNTS (GATES.huntClose / huntHot × titanWalk, gateUnstick). Intro: 1.4 × titanWalk.
// weakMask = the pack's bit while OVERHEATED, STALLED, or with the titan in the rear arc (> 110° off the facing,
//   probe case 5's "the pack … from behind"): an open weak point in reach is targeted before adds (targeting.ts).
// Attacks (gaps [_, 2.4, 2.0, 1.7] × (0.85–1.15), P3 × P3_GAP 0.65, × (1 − 0.1 pressure); gateWindup; bossTelegraph(…, false);
//   damage = min(bossHostile(base), GATES.hitCap × maxHp)):
//   P1+ shieldShove  lane from the wall face along the facing, w 2.4 H, len 3.2 H (laneClearLen); gateWindup(1.2 H +
//                    R, 1.2, 2.2); dmg 12 + knock 1.0 H/s along the lane. Only with the titan in the front arc (±60°), where it is
//                    preferred 2.4 : 1 over the toss (the OVERHEATED window is the fight's main opening).
//                    On fire the rig LURCHES 2.4 H forward in 0.35 s (clamped by laneClearLen), then OVERHEATED
//                    (beat 'overheated') 2.0 / 1.7 / 1.4 s: stands still, turn × 0.15, pack strain × 1.25.
//   P1+ sawhorseToss 2 / 3 / 4 lobbed 'sawhorse' (capsule len 1.4 H, r 0.25 H, lying ACROSS the volley axis): one
//                    across the lead point, the rest BEYOND it along the axis at 1.6 H spacing (1.1 H gaps); the
//                    axis turns tangential when the lead is closer than keep-out + (0.25 H + R) + 0.2 H (§3.0);
//                    gateWindup(0.25 H + R, 1.1, 2.0) + 0.2 s × i; dmg 8 each. The rig stands still (turn × 0.3).
//   P2+ backfire     a response, not in the cycle: after the titan has been in the rear arc for 1.2 s (P3 0.9 s),
//                    a cone from the pack backwards, half 40°, reach 1.8 H; windup from the SIDESTEP walk-out (square to
//                    the cone's axis, sliding round the keep-out; backfireEscape, circleInShape) at k 1 in every phase
//                    (gateWindupK1, 1.0–1.9); dmg 7. ≥ 3 s apart.
//                    (fx2 lane B retune: 55° / 2.4 H / 11 / 0.8 s trapped the stand-behind-the-rig spot; critic r2/r3.)
//   FLANK WINDOW     while OVERHEATED the pack's hit circle is r 0.6 H at −1.0 H: a 0.9 H bite reaches it from the
//                    keep-out within ±60° of straight behind (outside the BACKFIRE cone from ~±35°).
//   P3  squadBehind  a PICKET SQUAD (5) from the pack side every 14 s (first 3 s into P3), at most 2 of its squads
//                    alive; ids registered as gatekeeper adds (registerGateAdd → gateAddIds); a `bossAttack` event
//                    only (no beat — the rig keeps fighting). The P3 SIGNATURE repeats once per cycle: an OVERHEATED
//                    window or a STALLED that ended with no squad since the last cycle makes one due in 0.5 s; at the
//                    cap (2 squads alive / the city full) it retries every 2 s (fx2 lane B).
//   any dash answer  (watchDash, cd [_, 8, 6, 5]) one 'sawhorse' capsule across the dash end, len 1.2 H, r 0.25 H,
//                    gateWindup at k 1 (0.9–1.8); dmg 5.
// STALL: pack strain 3 (3.75 OVERHEATED). Full → STALLED (bosses/index.ts: 4.5 s, ×2 damage; step() is not called:
//   the tracks stop, turn 0).
// Beats (no event): overheated, stalled (the whole stagger; staggerBeat), reconfiguring, ramming, cutOff (see
//   stencil1.ts gateBeats). REMATCH (slot 0) chasing a running titan (rematchChasing): no decision, chaseStep.
// Telemetry: shoves, overheats, stalls, squads, part_pack / part_other, open_pack / open_all.

import type { BossState, World } from '../../core/types.ts';
import { CITY, RANKS } from '../../core/config.ts';
import { circleInShape, clamp, dist, wrapAngle } from '../../core/math.ts';
import {
  ESCAPE_K, baseBoss, beginAttack, bossH, bossTelegraph, endAttack, gateSettledH, gateWindup, keepRange, laneClearLen,
  leadPoint, localToWorld, makePart, moveBoss, pickWeighted, refreshParts, registerGateAdd, repeatMul, shoveTitan,
  titanWalk, turnBoss, watchDash,
} from './index.ts';
import {
  CHASE_VOLLEY_S, P3_GAP, boundsLen, chaseStep, gateAfterMove, gateBeats, gateGap, gateHit, gateHunt, gateWindupK1, huntSpeed, isMoveBeat,
  rematchChasing, staggerBeat, startBeat, sweepCrush,
} from './stencil1.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { spawnEnemy } from '../enemies.ts';
import { buildingsInRect, resolveCircleVsCity } from '../../city/citysim.ts';

// ─────────────────────────────── tuning (× H unless noted) ───────────────────────────────
export const BAND_MIN_H = 1.6, BAND_MAX_H = 3.5;
export const KEEP_H = 1.2;
const WALK_FRAC = 0.55, HUNT_TURN = 1.5, INTRO_WALK = 1.4;
export const TURN: readonly number[] = [0, 0.9, 1.05, 1.2];
const GAP = [0, 2.4, 2.0, 1.7] as const;
/** Decisions only with the titan inside the band: past band max the rig HUNTS, and an attack started mid-hunt
 *  would reset the stuck rule's progress clock (a rig blocked 0.2 H outside its band tossed forever and never
 *  rammed: §5.4 case 15, CORDON-2 / GRID-EAST). */
const DECIDE_SLACK_H = 0;
/** Rear arc: the titan more than this off the facing (rad). */
export const REAR_ARC = (110 * Math.PI) / 180;
/** Front arc for SHIELD SHOVE (rad). */
const FRONT_ARC = (60 * Math.PI) / 180;
const SHOVE = { wH: 2.4, lenH: 3.2, faceH: 1.2, escH: 1.2, min: 1.2, max: 2.2, dmg: 12, knockH: 1.0, lurchH: 2.4, lurchS: 0.35, minLenH: 1.2 };
export const OVERHEAT_S: readonly number[] = [0, 2.0, 1.7, 1.4];
const OVERHEAT_TURN = 0.15, TOSS_TURN = 0.3;
const TOSS = { n: [0, 2, 3, 4] as const, lenH: 1.4, rH: 0.25, spacingH: 1.6, min: 1.1, max: 2.0, stagger: 0.2, dmg: 8, recover: 0.5, yH: 2.0 };
/** BACKFIRE (fx2 lane B, critic r2/r3): at half 55°, reach 2.4 H, base 11 after 0.8 s behind, the spot the fight teaches
 *  (straight behind the rig, on the pack) was a trap: the cone + the titan's radius spanned 75–89° either side at the
 *  keep-out, the hard keep-out blocked the "sideways" walk-out the windup assumed, and a no-dash walker ate 26–34 %
 *  of max HP several times a fight. Now: half 40°, reach 1.8 H, base 7, a longer dwell (1.2 / 0.9 s), and the windup
 *  is computed from the real walk-out around the keep-out (backfireEscape). */
const BACKFIRE = { half: (40 * Math.PI) / 180, rH: 1.8, min: 1.0, max: 1.9, dmg: 7, recover: 0.5, afterS: [0, 1.2, 1.2, 0.9] as const, cdS: 3 };
/** The FLANK WINDOW: while OVERHEATED the vented pack's hit circle grows (r 0.45 → 0.6 H, centre −0.95 → −1.0 H), so
 *  a 0.9 H bite (MOLO, the shortest reach) lands on it from the keep-out anywhere within ±60° of straight behind —
 *  outside the BACKFIRE cone from about ±35° out. */
const PACK_VENT = { oz: -1.0, r: 0.6 };
const SQUAD = { everyS: 14, firstS: 3, maxAlive: 2, size: 5, backH: 1.8, jitterH: 0.5, cycleS: 0.5, retryS: 2 };
const DASH_ANSWER = { lenH: 1.2, rH: 0.25, aheadR: 0.3, cd: [0, 8, 6, 5] as const, dmg: 5, min: 0.9, max: 1.8, yH: 2.0 };
const PACK_STRAIN = 3.0, OVERHEAT_STRAIN_MUL = 1.25;

/** Parts in H units: [name, ox, oz, r, y0, y1, hpMul, strainMul]. Index 4 is the pack. */
const PARTS_H: readonly (readonly [string, number, number, number, number, number, number, number])[] = [
  ['body', 0, -0.1, 0.7, 0.2, 1.4, 1, 0.2],
  ['wallL', -0.85, 0.55, 0.45, 0, 2.0, 0.15, 0],
  ['wallR', 0.85, 0.55, 0.45, 0, 2.0, 0.15, 0],
  ['wallC', 0, 0.7, 0.5, 0, 2.0, 0.15, 0],
  ['pack', 0, -0.95, 0.45, 0.6, 1.6, 1.6, PACK_STRAIN],
  ['trackL', -0.85, -0.15, 0.4, 0, 0.6, 1, 0.3],
  ['trackR', 0.85, -0.15, 0.4, 0, 0.6, 1, 0.3],
];
export const PACK_IX = 4;

const ATTACKS = ['shieldShove', 'sawhorseToss'] as const;

const LEAD = { x: 0, z: 0 };
const TMP = { x: 0, z: 0 };

// ─────────────────────────────── module contract ───────────────────────────────
export function create(w: World): BossState {
  const H = gateSettledH(w);
  const parts = PARTS_H.map((p) => makePart(p[0], p[1] * H, p[2] * H, p[3] * H, p[4] * H, p[5] * H, p[6], p[7]));
  const b = baseBoss('cordon2', w.titan.x, w.titan.z, 0, parts);
  const d = b.data;
  d.weakMask = 0; d.overheated = 0; d.rear = 0; d.rearT = 0; d.backfireCd = 0; d.squadT = -1; d.squadA = -1; d.squadB = -1;
  d.lurchT = 0; d.lurchV = 0; d.fleeT = 0; d.fleeTick = -1; d.squadCyc = 0;
  d.bandMinH = BAND_MIN_H; d.bandMaxH = BAND_MAX_H;
  d.shoves = 0; d.overheats = 0; d.stalls = 0; d.squads = 0; d.wasStag = 0;
  d.part_pack = 0; d.part_other = 0; d.open_pack = 0; d.open_all = 0;
  d.syncTick = -1;
  return b;
}

/** Hard keep-out 1.2 H + R (centre to centre). Also the per-tick part sync (bosses/index.ts calls it every tick). */
export function keepOut(w: World, b?: BossState): number {
  if (b) sync(w, b);
  const H = b ? bossH(w, b) : Math.max(1, w.titan.height);
  return KEEP_H * H + w.titan.radius;
}

export function step(w: World, b: BossState): void {
  const T = w.titan, d = b.data;
  const H = bossH(w, b);
  const dd = dist(b.x, b.z, T.x, T.z);
  const chasing = rematchChasing(w, b);
  if (b.introT > 0) {
    if (dd > (BAND_MAX_H - 0.3) * H) gateHunt(w, b, INTRO_WALK * titanWalk(w), HUNT_TURN);
    else { turnBoss(b, Math.atan2(T.x - b.x, T.z - b.z), TURN[1], w.dt); b.data.speed = 0; }
    sync(w, b);
    return;
  }
  yieldWall(w, b);
  gateBeats(w, b);
  // rear-arc clock (BACKFIRE's trigger; also the from-behind weak point)
  if (d.rear > 0) d.rearT += w.dt; else d.rearT = 0;
  if (d.backfireCd > 0) d.backfireCd = Math.max(0, d.backfireCd - w.dt);
  squads(w, b);
  if (d.lurchT > 0) { stepLurch(w, b); gateAfterMove(w, b); sync(w, b); return; }
  if (!b.attack || isMoveBeat(b.attack)) {
    if (chasing) chaseStep(w, b, dd, (BAND_MIN_H + 0.5) * H, HUNT_TURN);   // a rematch chasing a runner: no decision
    else if (dd > BAND_MAX_H * H) gateHunt(w, b, huntSpeed(w, b, dd), HUNT_TURN);
    else keepRange(w, b, BAND_MIN_H * H, BAND_MAX_H * H, WALK_FRAC * titanWalk(w), TURN[b.phase] ?? 0.9);
    if (!b.attack && !chasing) {
      if (b.phase >= 2 && d.rearT >= (BACKFIRE.afterS[b.phase] ?? 0.8) && d.backfireCd <= 0 && dd <= BAND_MAX_H * H) backfire(w, b);
      else if (b.cd <= 0 && dd <= (BAND_MAX_H + DECIDE_SLACK_H) * H) decide(w, b);
    }
  } else {
    runAttack(w, b);
  }
  dashAnswer(w, b);
  gateAfterMove(w, b);
  sync(w, b);
}

/** Per-part telemetry (probe_gatekeepers case 5). */
export function onDamage(_w: World, b: BossState, part: number, dmg: number): void {
  const d = b.data;
  if (part === PACK_IX) d.part_pack += dmg; else d.part_other += dmg;
  if ((d.weakMask ?? 0) > 0) { d.open_all += dmg; if (part === PACK_IX) d.open_pack += dmg; }
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
  const dx = b.x - T.x, dz = b.z - T.z, d = Math.hypot(dx, dz);
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
  const d = b.data, T = w.titan;
  const H = bossH(w, b);
  const stag = b.staggerT > 0;
  if (d.syncTick !== w.tick) {
    d.syncTick = w.tick;
    if (stag && !(d.wasStag > 0)) { d.wasStag = 1; d.stalls += 1; d.lurchT = 0; d.overheated = 0; squadCycle(b); }
    else if (!stag) d.wasStag = 0;
  }
  staggerBeat(b, 'stalled');
  if (b.attack !== 'overheated') d.overheated = 0;
  if (b.attack !== 'shieldShove') d.lurchT = 0;
  // rear arc: the titan more than REAR_ARC off the facing
  const a = Math.abs(wrapAngle(Math.atan2(T.x - b.x, T.z - b.z) - b.heading));
  d.rear = a > REAR_ARC ? 1 : 0;
  for (let i = 0; i < b.parts.length && i < PARTS_H.length; i++) {
    const p = b.parts[i], g = PARTS_H[i];
    const vent = i === PACK_IX && d.overheated > 0;
    p.ox = g[1] * H; p.oz = (vent ? PACK_VENT.oz : g[2]) * H; p.r = (vent ? PACK_VENT.r : g[3]) * H; p.y0 = g[4] * H; p.y1 = g[5] * H; p.hpMul = g[6];
    p.strainMul = i === PACK_IX ? PACK_STRAIN * (d.overheated > 0 ? OVERHEAT_STRAIN_MUL : 1) : g[7];
  }
  const open = b.alive && (stag || d.overheated > 0 || d.rear > 0);
  d.weakMask = open ? 1 << PACK_IX : 0;
  refreshParts(b);
}

// ─────────────────────────────── decision ───────────────────────────────
function decide(w: World, b: BossState): void {
  const T = w.titan;
  const off = Math.abs(wrapAngle(Math.atan2(T.x - b.x, T.z - b.z) - b.heading));
  const wts = [
    off <= FRONT_ARC ? 2.4 : 0,   // shieldShove: only at what the wall faces — the OVERHEATED window opener
    1.0,                          // sawhorseToss
  ];
  for (let i = 0; i < wts.length; i++) wts[i] *= repeatMul(b, ATTACKS[i]);
  const id = pickWeighted(w, ATTACKS, wts) ?? 'sawhorseToss';
  if (id === 'shieldShove' && shieldShove(w, b)) return;
  sawhorseToss(w, b);
}

// ─────────────────────────────── SHIELD SHOVE ───────────────────────────────
function shieldShove(w: World, b: BossState): boolean {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  const face = localToWorld(b, 0, SHOVE.faceH * H, TMP);
  const fxW = face.x, fzW = face.z;
  let len = laneClearLen(w, fxW, fzW, fx, fz, SHOVE.lenH * H, 0.5 * SHOVE.wH * H);
  len = Math.min(len, boundsLen(w, fxW, fzW, fx, fz, len, 0));
  if (len < SHOVE.minLenH * H) return false;
  const wu = gateWindup(w, b, SHOVE.escH + R / H, SHOVE.min, SHOVE.max);
  beginAttack(w, b, 'shieldShove', fxW + fx * len * 0.5, fzW + fz * len * 0.5);
  b.data.dir = b.heading;
  b.data.shoves += 1;
  const dir = b.heading;
  const tg = bossTelegraph(w, {
    style: 'lane', shape: { k: 'lane', x: fxW, z: fzW, dir, len, w: SHOVE.wH * H },
    windup: wu, dmg: gateHit(w, SHOVE.dmg), kind: 'ram', tag: 'shieldShove',
    onFire: (w2, tgf) => {
      if (!b.alive || b.staggerT > 0 || b.attack !== 'shieldShove') return;
      const Hh = bossH(w2, b);
      const Tt = w2.titan;
      if (tgf.hitTitan && Tt.alive && Tt.dashT <= 0) shoveTitan(b, Math.sin(dir), Math.cos(dir), SHOVE.knockH * Hh);
      // the lurch: 2.4 H forward in 0.35 s, as far as the street lets it
      const ahead = laneClearLen(w2, b.x, b.z, Math.sin(dir), Math.cos(dir), SHOVE.lurchH * Hh, b.parts[0] ? b.parts[0].r : 0.7 * Hh);
      const L = Math.min(ahead, boundsLen(w2, b.x, b.z, Math.sin(dir), Math.cos(dir), ahead, 0));
      b.data.lurchT = SHOVE.lurchS;
      b.data.lurchV = L / SHOVE.lurchS;
    },
  }, false);
  b.data.shoveWu = tg.windup;
  return true;
}

function stepLurch(w: World, b: BossState): void {
  const d = b.data, H = bossH(w, b);
  const dir = d.dir ?? b.heading;
  b.heading = dir;
  const dtL = Math.min(w.dt, d.lurchT);
  const v = d.lurchV * (dtL / w.dt);
  moveBoss(w, b, Math.sin(dir) * v, Math.cos(dir) * v);
  d.lurchT = Math.max(0, d.lurchT - w.dt);
  refreshParts(b);
  sweepCrush(w, b, b.x + Math.sin(dir) * 0.7 * H, b.z + Math.cos(dir) * 0.7 * H, 1.3 * H);
  if (d.lurchT <= 1e-6) {
    d.lurchT = 0;
    b.data.speed = 0;
    startBeat(b, 'overheated', OVERHEAT_S[b.phase] ?? 2);
    d.overheated = 1;
    d.overheats += 1;
  }
}

// ─────────────────────────────── SAWHORSE TOSS ───────────────────────────────
/** The §3.0 volley axis for a lead point: rig → lead, or tangential (away from the titan's motion) when the
 *  lead is closer than keep-out + (r + R) + 0.2 H. */
function volleyAxis(w: World, b: BossState, lx: number, lz: number, r: number, out: { x: number; z: number }): void {
  const T = w.titan, H = bossH(w, b);
  let ax = lx - b.x, az = lz - b.z;
  const dl = Math.hypot(ax, az);
  if (dl > 1e-6) { ax /= dl; az /= dl; } else { ax = Math.sin(b.heading); az = Math.cos(b.heading); }
  const keep = KEEP_H * H + T.radius;
  if (dl < keep + (r + T.radius) + 0.2 * H) {
    const n1x = az, n1z = -ax;
    const vx = Number.isFinite(T.vx) ? T.vx : 0, vz = Number.isFinite(T.vz) ? T.vz : 0;
    const still = Math.hypot(vx, vz) < 0.1 * titanWalk(w);
    const sgn = still ? (w.rng.boss() < 0.5 ? 1 : -1) : (n1x * vx + n1z * vz > 0 ? -1 : 1);
    ax = n1x * sgn; az = n1z * sgn;
  }
  out.x = ax; out.z = az;
}

const AXIS = { x: 0, z: 0 };
function sawhorseToss(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b), R = T.radius, Bd = w.city.bounds;
  const r = TOSS.rH * H;
  const wu = gateWindup(w, b, TOSS.rH + R / H, TOSS.min, TOSS.max);
  const L = leadPoint(w, b, wu, LEAD);
  const lx = L.x, lz = L.z;
  volleyAxis(w, b, lx, lz, r, AXIS);
  const ax = AXIS.x, az = AXIS.z, px = az, pz = -ax, half = 0.5 * TOSS.lenH * H;
  beginAttack(w, b, 'sawhorseToss', lx, lz);
  b.data.dir = Math.atan2(lx - b.x, lz - b.z);
  const n = TOSS.n[b.phase] ?? 2;
  const src = localToWorld(b, 0, -0.3 * H, TMP);
  const sx = src.x, sz = src.z;
  let end = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const cx = lx + ax * TOSS.spacingH * H * i, cz = lz + az * TOSS.spacingH * H * i;
    if (cx < Bd.minX || cx > Bd.maxX || cz < Bd.minZ || cz > Bd.maxZ) continue;
    const tg = bossTelegraph(w, {
      style: 'lane', shape: { k: 'capsule', x0: cx - px * half, z0: cz - pz * half, x1: cx + px * half, z1: cz + pz * half, r },
      windup: wu + TOSS.stagger * k, dmg: gateHit(w, TOSS.dmg), kind: 'plate', tag: 'lob:sawhorse',
    }, false);
    spawnProjectile(w, {
      owner: 'boss', kind: 'sawhorse', x: sx, z: sz, y: TOSS.yH * H, vx: 0, vz: 0,
      dmg: 0, lob: true, tx: cx, tz: cz, aoe: r, life: tg.windup, tg: tg.id,
    });
    end = Math.max(end, tg.windup);
    k++;
  }
  b.data.attackEnd = end + TOSS.recover;
}

// ─────────────────────────────── BACKFIRE ───────────────────────────────
const ESC = { x: 0, z: 0 };
const CONE: { k: 'cone'; x: number; z: number; dir: number; half: number; r: number } = { k: 'cone', x: 0, z: 0, dir: 0, half: 0, r: 0 };
const WALK_BUF: number[] = [];
/** Walk from the titan along (ux, uz) in 0.05 H steps until its body is out of the cone (circleInShape, THE hit
 *  test); a step that would enter the hard keep-out is projected back onto it (bosses/index.ts does that every tick),
 *  so the walk slides round the rig's back and every step still costs its full length. Infinity past maxL, or when a
 *  step meets a building the titan cannot flatten (tier > canFlatten; its collision circle is the full R: a wall, not an exit). Plowing through a
 *  flattenable one is left to gateWindup's escapeWalk (SMASH_SLOW along the direction it is given). */
function walkOut(w: World, b: BossState, cone: typeof CONE, ux: number, uz: number, maxL: number): number {
  const T = w.titan, H = bossH(w, b), R = T.radius, c = w.city;
  const keep = KEEP_H * H + R, step = 0.05 * H, rc = R;
  const flat = RANKS[clamp(Math.floor(T.rank), 0, RANKS.length - 1)].canFlatten;
  let x = T.x, z = T.z, s = 0;
  while (circleInShape(cone, x, z, R)) {
    if (s >= maxL) return Infinity;
    x += ux * step; z += uz * step; s += step;
    const dx = x - b.x, dz = z - b.z, dd = Math.hypot(dx, dz);
    if (dd < keep && dd > 1e-6) { x = b.x + (dx / dd) * keep; z = b.z + (dz / dd) * keep; }
    if (c && c.buildings) {
      WALK_BUF.length = 0;
      buildingsInRect(c, x - rc, z - rc, x + rc, z + rc, WALK_BUF);
      for (let i = 0; i < WALK_BUF.length; i++) {
        const bd = c.buildings[WALK_BUF[i]];
        if (!bd || bd.collapsed || !(bd.alive > 0) || bd.tier <= flat) continue;
        const qx = clamp(x, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(z, bd.z - bd.d / 2, bd.z + bd.d / 2);
        if (Math.hypot(x - qx, z - qz) < rc) { WALK_BUF.length = 0; return Infinity; }
      }
      WALK_BUF.length = 0;
    }
  }
  return s;
}
/**
 * The BACKFIRE walk-out (m) a player actually takes: the SIDESTEP — perpendicular to the cone's axis, toward the side
 * the titan is already on (either side from dead centre) — sliding round the rig's back on the keep-out. It is never
 * shorter than the best straight walk (also computed, over 32 headings, as the fallback). Writes its heading to ESC.
 * (The old estimate, min(d·sin(half) + R, reach − d + R), assumed a perpendicular step off the cone's EDGE, which from
 * straight behind points INTO the keep-out; the real walk round the ring was about twice as long.)
 */
function backfireEscape(w: World, b: BossState, cone: typeof CONE): number {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const maxL = cone.r + 2 * R + 2 * H;
  const ax = Math.sin(cone.dir), az = Math.cos(cone.dir), px = az, pz = -ax;
  const side = (T.x - cone.x) * px + (T.z - cone.z) * pz;
  let best = Infinity, bx = px, bz = pz;
  // the titan's own side first; the other side only when that one is walled off (or from dead centre)
  const first = side >= 0 ? 1 : -1;
  for (const sg of Math.abs(side) > 1e-6 ? [first, -first] : [1, -1]) {
    const L = walkOut(w, b, cone, px * sg, pz * sg, maxL);
    if (L < best) { best = L; bx = px * sg; bz = pz * sg; }
    if (Number.isFinite(best) && Math.abs(side) > 1e-6) break;
  }
  if (!Number.isFinite(best)) {
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
      const L = walkOut(w, b, cone, ux, uz, Math.min(best, maxL));
      if (L < best) { best = L; bx = ux; bz = uz; }
    }
  }
  ESC.x = bx; ESC.z = bz;
  return Number.isFinite(best) ? best : cone.r + R;
}

function backfire(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b);
  const pk = localToWorld(b, 0, -0.95 * H, TMP);
  const px = pk.x, pz = pk.z;
  const r = BACKFIRE.rH * H;
  const dir = wrapAngle(b.heading + Math.PI);
  CONE.x = px; CONE.z = pz; CONE.dir = dir; CONE.half = BACKFIRE.half; CONE.r = r;
  const esc = backfireEscape(w, b, CONE);
  // k = 1 in every phase (as gateWindupK1; P3's ESCAPE_K 0.9 would make it a dash check): BACKFIRE answers the spot
  // the fight TEACHES you to stand in, so a pure 0.35 s read-and-react walk-out always makes it. The escape heading
  // goes to gateWindup so a sidestep that plows through a flattenable building walks at SMASH_SLOW.
  const wu = gateWindup(w, b, esc / H / (ESCAPE_K[b.phase] ?? 1), BACKFIRE.min, BACKFIRE.max, ESC.x, ESC.z);
  beginAttack(w, b, 'backfire', px, pz);
  b.data.dir = dir;
  const tg = bossTelegraph(w, {
    style: 'cone', shape: { k: 'cone', x: px, z: pz, dir, half: BACKFIRE.half, r },
    windup: wu, dmg: gateHit(w, BACKFIRE.dmg), kind: 'breath', tag: 'backfire',
  }, false);
  b.data.attackEnd = tg.windup + BACKFIRE.recover;
  b.data.rearT = 0;
}

// ─────────────────────────────── SQUAD BEHIND THE LINE ───────────────────────────────
function squadAlive(w: World, sid: number): boolean {
  if (!(sid >= 0)) return false;
  for (let i = 0; i < w.enemies.length; i++) { const e = w.enemies[i]; if (e.alive && e.squad === sid) return true; }
  return false;
}

function squads(w: World, b: BossState): void {
  const d = b.data;
  if (b.phase < 3) return;
  if (d.squadT < 0) { d.squadT = SQUAD.firstS; return; }
  d.squadT -= w.dt;
  if (d.squadT > 0) return;
  const aliveA = squadAlive(w, d.squadA), aliveB = squadAlive(w, d.squadB);
  // at the cap (two squads alive, or the city full): try again shortly, not a whole period later
  if (aliveA && aliveB) { d.squadT = SQUAD.retryS; return; }
  let n = 0;
  for (let i = 0; i < w.enemies.length; i++) if (w.enemies[i].alive) n++;
  if (n + SQUAD.size > CITY.maxEnemies) { d.squadT = SQUAD.retryS; return; }
  d.squadT = SQUAD.everyS;
  d.squadCyc = 1;
  const H = bossH(w, b);
  const sid = w.director.squadSeq++;
  const bx = Math.sin(b.heading), bz = Math.cos(b.heading), rx = bz, rz = -bx;
  const lat = (w.rng.boss() * 2 - 1) * SQUAD.jitterH * H;
  const ox = b.x - bx * SQUAD.backH * H + rx * lat, oz = b.z - bz * SQUAD.backH * H + rz * lat;
  // wedge facing away from the rig (toward whatever is behind the line)
  const h = wrapAngle(b.heading + Math.PI), fx = Math.sin(h), fz = Math.cos(h), qx = -fz, qz = fx;
  for (let s = 0; s < SQUAD.size; s++) {
    const side = s === 0 ? 0 : (s % 2 === 1 ? -1 : 1) * Math.ceil(s / 2);
    const back = Math.ceil(s / 2) * 2.2;
    const x = clamp(ox + qx * side * 2.4 - fx * back, w.city.bounds.minX, w.city.bounds.maxX);
    const z = clamp(oz + qz * side * 2.4 - fz * back, w.city.bounds.minZ, w.city.bounds.maxZ);
    const e = spawnEnemy(w, 'squad', x, z, { squad: sid, slot: s });
    e.heading = e.pheading = h;
    registerGateAdd(b, e.id);
  }
  if (!aliveA) d.squadA = sid; else d.squadB = sid;
  d.squads += 1;
  w.events.push({ type: 'bossAttack', attack: 'squadBehind', x: ox, z: oz });
}

/** An OVERHEATED window or a STALLED stagger ended a cycle: in P3, a cycle with no squad makes one due now (the P3
 *  signature repeats once per cycle — fx2 lane B, critic r1: late phases never showed their kit). */
function squadCycle(b: BossState): void {
  const d = b.data;
  if (b.phase >= 3 && d.squadT >= 0 && !(d.squadCyc > 0)) d.squadT = Math.min(d.squadT, SQUAD.cycleS);
  d.squadCyc = 0;
}

// ─────────────────────────────── attack runner ───────────────────────────────
function runAttack(w: World, b: BossState): void {
  const T = w.titan, t = b.attackT, d = b.data;
  const faceT = Math.atan2(T.x - b.x, T.z - b.z);
  const turn = TURN[b.phase] ?? 0.9;
  b.data.speed = 0;
  switch (b.attack) {
    case 'shieldShove':
      // the crouch: the wall holds its line (no turn) until the lurch
      if (t > (d.shoveWu ?? 2) + SHOVE.lurchS + 2.0) endAttack(b, gateGap(w, b, GAP, P3_GAP));   // fire lost (cancelled)
      break;
    case 'overheated':
      turnBoss(b, faceT, turn * OVERHEAT_TURN, w.dt);
      if (t >= (d.beatS ?? 2)) { d.overheated = 0; squadCycle(b); endAttack(b, gateGap(w, b, GAP, P3_GAP)); }
      break;
    case 'sawhorseToss':
      turnBoss(b, faceT, turn * TOSS_TURN, w.dt);
      if (t >= (d.attackEnd ?? 2) || (t >= CHASE_VOLLEY_S && rematchChasing(w, b))) endAttack(b, gateGap(w, b, GAP, P3_GAP));
      break;
    case 'backfire':
      if (t >= (d.attackEnd ?? 2)) { d.backfireCd = BACKFIRE.cdS; endAttack(b, Math.max(b.cd, 0.6)); }
      break;
    case 'reconfiguring':
      if (t >= (d.beatS ?? 1.2)) endAttack(b, Math.max(0.3, b.cd));
      break;
    default:
      endAttack(b, 1);
  }
}

// ─────────────────────────────── dash answer ───────────────────────────────
function dashAnswer(w: World, b: BossState): void {
  const e = watchDash(w, b, DASH_ANSWER.cd);
  if (!e) return;
  const T = w.titan, H = bossH(w, b), Bd = w.city.bounds;
  const r = DASH_ANSWER.rH * H, reach = r + T.radius;
  const dx = e.x1 - e.x0, dz = e.z1 - e.z0, dl = Math.hypot(dx, dz) || 1;
  const ux = dx / dl, uz = dz / dl, ahead = DASH_ANSWER.aheadR * reach;
  const cx = clamp(e.x1 + ux * ahead, Bd.minX, Bd.maxX), cz = clamp(e.z1 + uz * ahead, Bd.minZ, Bd.maxZ);
  const half = 0.5 * DASH_ANSWER.lenH * H, px = uz, pz = -ux;
  const wu = gateWindupK1(w, b, DASH_ANSWER.rH + T.radius / H, DASH_ANSWER.min, DASH_ANSWER.max);
  const tg = bossTelegraph(w, {
    style: 'lane', shape: { k: 'capsule', x0: cx - px * half, z0: cz - pz * half, x1: cx + px * half, z1: cz + pz * half, r },
    windup: wu, dmg: gateHit(w, DASH_ANSWER.dmg), kind: 'plate', tag: 'lob:sawhorse',
  }, false);
  spawnProjectile(w, {
    owner: 'boss', kind: 'sawhorse', x: b.x, z: b.z, y: DASH_ANSWER.yH * H, vx: 0, vz: 0,
    dmg: 0, lob: true, tx: cx, tz: cz, aoe: r, life: tg.windup, tg: tg.id,
  });
  b.data.followX = cx; b.data.followZ = cz;
}
