// BLOCKTOOTH — STENCIL-1, "HALVARD ROAD-MARKING UNIT": gatekeeper 1 (LV 7, the Size I ceiling).
// GATEKEEPERS.md §3.0 / §3.1 (lane K1b). SIM: THREE-free, DOM-free, deterministic (every roll from w.rng.boss).
//
// A three-wheeled line-painting cart bolted up to twice its height: cream chassis, bubble cab with two
// headlamp eyes, a PAINT DRUM on a tilting cradle at the back, a spray boom on the right. Tests: read a LANE,
// then punish the REFILL.
//
// Everything is authored in titan heights: H = bossH (the settled Size ceiling, 3.125 m at home, 60–67 m in an
// EXTENDED COVERAGE rematch); R = titan radius. Parts (boss-local, facing +Z, × H) are REWRITTEN EVERY TICK by
// sync() from PARTS_H and the drum state (closed / open), so a mid-fight H re-latch rescales the rig too.
//   body 0,0 r.85 · cab 0,+1 r.45 · boom +.85,+.7 r.3 · drum closed 0,−1 r.55 (hp .5, strain 0) / OPEN 0,−1.25
//   r.65 (hp 2, strain 4) · wheelL/R ∓.8,−.35 r.35 · wheelF 0,+1.25 r.3.
// Collision: no hard keep-out (the eased body push-out, parts[0] r .85 H + .7 R), so MOLO can stand behind the
//   drum. Crush tier 1 (gateCrushTier; 4 in a rematch or while RAMMING THROUGH).
// Footwork: band [3.0, 6.0] H. Inside: keepRange(3 H, 6 H, 0.75 × titanWalk, 2.2 rad/s). Past 6 H: HUNT at up
//   to GATES.huntClose (huntHot from pressure 2) × titanWalk (gap-ramped, huntSpeed) with the stuck rule. Intro: drives in at
//   1.4 × titanWalk until inside the band. b.data.bandMinH / bandMaxH publish the band for meta/gates.ts.
// Attacks (gaps [_, 2.2, 1.8, 1.5] s × (0.85–1.15), P3 × P3_GAP 0.65 (was 0.8), × (1 − 0.1 pressure); repeatMul anti-spam; tells
//   are gateWindup (§3.0) and bossTelegraph(…, false); damage = min(bossHostile(base), GATES.hitCap × maxHp)):
//   P1+ stripeRun    lane from the nose through the lead point, w 1.7 H (= 2 × parts[0].r), len clamp(d + 3 H,
//                    5 H, 9 H) then laneClearLen; windup gateWindup(0.85 H + R, 1.1, 1.9); dmg 10 + knock 0.5 H/s
//                    sideways. On fire the cart RACES the lane's centre line end-to-end in 0.4 s (b.data.raceT > 0:
//                    bosses/index.ts suspends pushTitanOut) and leaves WET PAINT along the centre (hazard 'paint',
//                    capsule r 0.35 H, 5 s, slow 0.35). Then REFILL (beat 'refill') 3.0 / 2.6 / 2.2 s: drumOpen,
//                    no movement, turn 0.4 rad/s — the cart ends past the titan facing away, drum toward it.
//   P1+ paintBuckets 3 / 4 / 5 lobbed 'paintCan' (circle r 0.45 H): the lead on the lead point, the rest by
//                    volleyPoints (beyond the lead, ±60°, ≥ 1.84 H apart); gateWindup(0.45 H + R, 1.0, 1.8) + 0.15 s × i;
//                    dmg 6 each; each splash leaves a WET PAINT puddle (circle r 0.45 H, 4 s, slow 0.35).
//   P2+ doubleLine   2 lanes perpendicular to the cart→lead axis, len 8 H, w 0.5 H: one on the lead point, the other
//                    2.0 H to one side along the axis (rng.boss) → a 1.5 H dry median; gateWindup(0.25 H + R, 1.0,
//                    1.8); dmg 8; both lines stay as WET PAINT (capsule r 0.25 H, 4 s).
//   P3  uTurn        a STRIPE RUN, then a second one re-aimed from the first lane's end (painted as the first
//                    fires); the REFILL comes only after the second race. dmg 10 each. The P3 SIGNATURE: the first
//                    P3 decision, and the first decision after every REFILL (not one that followed a U-TURN) or
//                    TIPPED OVER, is a U-TURN (fx2 lane B; weighted picks as before otherwise).
//   any dash answer  (watchDash, cd [_, 7, 5, 4]) one 'paintCan' circle r 0.4 H at the dash end + 0.3 (r + R) ahead,
//                    gateWindup at k 1 (0.9–1.8); dmg 4.
// SPILL (the meter): the standard rule — almost only from the OPEN drum (strain 4) and a little from the cab (0.5).
//   Full → TIPPED OVER (bosses/index.ts: GATES.staggerS 4.5 s, ×2 damage): the drum is forced open and gushes a
//   WET PAINT pool (circle r 0.8 H behind it, for the stagger). weakMask = the drum's bit while it is open.
// Beats (b.attack WITHOUT a bossAttack event; subtitles in data/bosses.ts BOSS_BEAT_SUBTITLE): tippedOver (the whole
//   stagger, set by staggerBeat from sync), refill,
//   reconfiguring (1.2 s after a phase change), ramming (the stuck rule's RAMMING THROUGH; the hunt keeps moving),
//   cutOff (1.5 s after a `gateReposition`; the hunt keeps moving).
// Telemetry (probes read, views ignore): refills, tipped, stripes, part_drum / part_other (titan damage after hpMul),
//   open_drum / open_all (the same, only while the drum is open), lastRefillSpill (SPILL gained in the last REFILL).
//
// This file also exports the GATEKEEPER MODULE KIT used by cordon2.ts and switchboard5.ts (gateHit, gateGap,
// gateWindupK1, startBeat, isMoveBeat, gateHunt, huntSpeed, gateBeats, gateAfterMove, sweepCrush, boundsLen) — lane-internal helpers
// that sit on top of the bosses/index.ts toolkit (K1b owns only the three gatekeeper modules).

import type { BossState, DamageOpts, World } from '../../core/types.ts';
import { GATES } from '../../core/config.ts';
import { clamp, dist } from '../../core/math.ts';
import {
  ESCAPE_K, baseBoss, beginAttack, bossH, bossHostile, bossTelegraph, endAttack, gateCrushTier, gateSettledH,
  gateUnstick, gateWindup, keepRange, laneClearLen, leadPoint, makePart, moveBoss, pickWeighted, refreshParts,
  repeatMul, shoveTitan, titanWalk, turnBoss, volleyPoints, watchDash, denialRing,
} from './index.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { buildingsInRect, damageBuilding, damageProp, propsInRect } from '../../city/citysim.ts';

// ═══════════════════════════════ GATEKEEPER MODULE KIT (shared by the three modules) ═══════════════════════════════
/** Gatekeeper hit: min(bossHostile(base × GATES.dmgBaseMul), GATES.hitCap × titan max HP) (§3.0; §5.1 risk-1 knob). */
export function gateHit(w: World, base: number): number {
  return Math.min(bossHostile(w, base * GATES.dmgBaseMul), GATES.hitCap * Math.max(1, w.titan.maxHp));
}

/** The next decision gap: gaps[phase] × (0.85–1.15, rng.boss) × p3 in P3 × (1 − gapPer × pressure) (home fights). */
export function gateGap(w: World, b: BossState, gaps: readonly number[], p3: number): number {
  const g = (gaps[b.phase] ?? 2) * (0.85 + 0.3 * w.rng.boss());
  const pr = b.slot === 0 ? 0 : clamp(Number.isFinite(w.gates.pressure) ? w.gates.pressure : 0, 0, 3);
  return (b.phase === 3 ? g * p3 : g) * (1 - GATES.pressure.gapPer * pr);
}

/** gateWindup at a fixed k = 1 (the dash answers): the escape is divided by ESCAPE_K[phase], which gateWindup
 *  multiplies back in; its slow-aware walk and pace-scaled max clamp are unchanged. */
export function gateWindupK1(w: World, b: BossState, escapeH: number, min: number, max: number): number {
  return gateWindup(w, b, escapeH / (ESCAPE_K[b.phase] ?? 1), min, max);
}

/** Start a module BEAT: b.attack = id for s seconds, without a `bossAttack` event (subtitle from the beat table). */
export function startBeat(b: BossState, id: string, s: number): void {
  b.attack = id;
  b.attackT = 0;
  b.data.beatS = s;
}

/** Beats during which the rig keeps hunting (no decisions are taken). */
export function isMoveBeat(a: string | null): boolean {
  return a === 'ramming' || a === 'cutOff';
}

/** The hunt's floor, as a fraction of the full hunt speed (see huntSpeed). */
export const HUNT_FLOOR = 0.8;
/**
 * Hunt speed (§2.4: "closes at UP TO GATES.huntClose × the titan's walk, huntHot from pressure 2"): the full
 * speed from (band max + engageMarginH) × H + band max × H out, easing to HUNT_FLOOR × that at the engagement
 * edge, like keepRange's gap-ramped close. So a titan walking straight away is never run down into the
 * engagement ring (0.8 × 1.05 = 0.84 × its walk there: §5.4 case 7's avoider stays unengaged even at pressure
 * 3), a titan that stops is still caught (the floor), and a rematch rig still covers > 5 H in 10 s behind a
 * walking titan (case 12: ≥ 0.76 × walk). Home fights only get huntHot (a rematch has no pressure).
 */
export function huntSpeed(w: World, b: BossState, d: number): number {
  const hot = b.slot !== 0 && w.gates.pressure >= 2;
  const H = bossH(w, b), bandMax = (b.data.bandMaxH > 0 ? b.data.bandMaxH : 4) * H;
  const edge = bandMax + GATES.engageMarginH * H;
  const over = clamp((d - edge) / Math.max(1e-6, bandMax), 0, 1);
  return (hot ? GATES.huntHot : GATES.huntClose) * titanWalk(w) * Math.max(HUNT_FLOOR, over);
}

/**
 * One hunt step: the stuck rule (gateUnstick), then drive at `speed` toward the titan — along the DETOUR heading
 * while one is live, straight at the titan while RAMMING THROUGH — turning at `turn` rad/s.
 */
export function gateHunt(w: World, b: BossState, speed: number, turn: number): void {
  gateUnstick(w, b);
  const T = w.titan, d = b.data;
  d.huntTick = w.tick;
  let hx = T.x - b.x, hz = T.z - b.z;
  if (!(d.ramT > 0) && d.detourT > 0 && Number.isFinite(d.detourX) && Number.isFinite(d.detourZ)) { hx = d.detourX; hz = d.detourZ; }
  const m = Math.hypot(hx, hz);
  if (!(m > 1e-6)) { b.data.speed = 0; return; }
  hx /= m; hz /= m;
  turnBoss(b, Math.atan2(hx, hz), turn, w.dt);
  moveBoss(w, b, hx * speed, hz * speed);
}

/**
 * The shared beats, called once per tick from each module's step (outside the intro): a cut-off re-entry
 * (gateReenter's cutOffTick stamp, this tick or the previous one) → beat cutOff (1.5 s) unless a real attack is live; RAMMING THROUGH (b.data.ramT > 0) → beat ramming;
 * a phase change → beat reconfiguring (1.2 s) as soon as no attack is live. Ends finished move beats.
 */
export function gateBeats(w: World, b: BossState): void {
  const d = b.data;
  if (!(d.phaseSeen >= 1)) d.phaseSeen = b.phase;
  if (b.phase !== d.phaseSeen) { d.phaseSeen = b.phase; d.reconf = 1; }
  // a cut-off re-entry this tick or the previous one (gateReenter stamps cutOffTick; it can run after this call in the
  // same step — gateUnstick from the move — so the tick's events are gone by the next gateBeats). Consumed once.
  const repo = d.cutOffTick !== undefined && d.cutOffTick >= w.tick - 1;
  if (repo) d.cutOffTick = -1;
  const free = !b.attack || isMoveBeat(b.attack);
  if (repo && free) startBeat(b, 'cutOff', 1.5);
  else if (d.ramT > 0 && free && b.attack !== 'cutOff') startBeat(b, 'ramming', d.ramT);
  if (isMoveBeat(b.attack) && b.attackT >= (d.beatS ?? 0)) endAttack(b, Math.max(b.cd, 0.2));
  if (!b.attack && d.reconf > 0) { d.reconf = 0; startBeat(b, 'reconfiguring', 1.2); }
}

/** P3 cadence (fx2 lane B, critic r1: strong builds turned the late phases into damage races — STENCIL-1 made 6
 *  attacks in 35 s and DOUBLE LINE / U-TURN never appeared): every gatekeeper's P3 decision gap × this (was 0.8 for
 *  STENCIL-1 only, 1.0 for the other two). */
export const P3_GAP = 0.65;

/**
 * The stagger BEAT (fx2 lane B): while the rig is staggered (TIPPED OVER / STALLED / LINES DOWN) b.attack holds the
 * module's stagger beat id, so the nameplate subtitle (bosses/index.ts: bossSubtitle(b.id, b.attack) after the
 * per-tick sync hook) says what to do NOW instead of the default "wait for the window" hint. Called from each
 * module's sync() on every tick (bosses/index.ts calls it through keepOut / noseOut, stagger included); step() is
 * not called during a stagger, and the beat is cleared on the first tick after it (the rig then waits ≥ 0.9 s, as
 * bosses/index.ts sets at the stagger's end). Views gate every pose on staggerT, never on this id.
 */
export function staggerBeat(b: BossState, id: string): void {
  if (b.alive && b.staggerT > 0) {
    if (b.attack !== id) { b.attack = id; b.attackT = 0; b.data.beatS = b.staggerT; }
  } else if (b.attack === id) endAttack(b, Math.max(b.cd, 0.9));
}

/** EXTENDED COVERAGE chase (rematches only): the titan counts as RUNNING after it has walked away from the rig
 *  (velocity along rig → titan ≥ fleeFrac × titanWalk) for fleeS; it stops counting once that has stayed below
 *  calmFrac × titanWalk for calmS (it stood, turned to fight, or circled — a runner rounding a corner is not). */
const CHASE = { fleeFrac: 0.4, calmFrac: 0.15, fleeS: 0.6, calmS: 1.0, pullPerS: 1.0 };
/**
 * Is a REMATCH rig (slot 0) chasing a running titan? (fx2 lane B, §5.4 case 12.) At home a runner is answered by
 * containment pressure and the cut-off (§2.4), and HUNT_FLOOR keeps the hunt from running it down; a rematch has no
 * pressure, so the rig itself must keep up. Measured before this rule: a Size V titan walking away plows at
 * 0.54 H/s (SMASH_SLOW), the floor hunt closed on it at 0.09 H/s, and then the rig stood still for a 2.5 s toss or a
 * plant while the titan walked off again (CORDON-2 3.8 H, SWITCHBOARD-5 3.7 H in the first 10 s; fx2/B/rematch_diag.ts).
 * While this is true the rig takes no standing decision (no toss, no plant, no attack): it drives (chaseStep).
 * Updates its clock once per tick (call it every tick, intro included). Home fights: always false.
 */
/** A rematch chasing a runner does not stand and watch a thrown volley land: once this long into a VOLLEY attack
 *  (every tell of it is already out — telegraphs and lobs live on their own) the attack ends and the chase goes on. */
export const CHASE_VOLLEY_S = 0.4;
export function rematchChasing(w: World, b: BossState): boolean {
  const d = b.data;
  if (b.slot !== 0 || !w.titan.alive) { d.fleeT = 0; return false; }
  if (d.fleeTick !== w.tick) {
    d.fleeTick = w.tick;
    const T = w.titan;
    const dx = T.x - b.x, dz = T.z - b.z, m = Math.hypot(dx, dz);
    const vx = Number.isFinite(T.vx) ? T.vx : 0, vz = Number.isFinite(T.vz) ? T.vz : 0;
    const vr = m > 1e-6 ? (vx * dx + vz * dz) / m : 0;
    const walk = titanWalk(w);
    if (vr >= CHASE.fleeFrac * walk) { d.fleeT = (d.fleeT ?? 0) + w.dt; d.calmT = 0; }
    else if (vr < CHASE.calmFrac * walk) {
      d.calmT = (d.calmT ?? 0) + w.dt;
      if (d.calmT >= CHASE.calmS) d.fleeT = 0;
    }
  }
  return (d.fleeT ?? 0) >= CHASE.fleeS;
}

/**
 * One chase step (rematch, crush tier 4 so the city cannot pin it: no stuck rule needed). Beyond `stopD`: drive at
 * the titan at GATES.huntClose × titanWalk (the full hunt, no HUNT_FLOOR ramp — that ramp only exists to keep a home
 * avoider out of the engagement ring for pressure). Within it: SHADOW the titan — take its velocity (so a runner
 * rounding a corner is followed round it, not watched) plus a gentle pull back to `stopD` — capped at the full hunt,
 * so the rig never drives into the keep-out and never out-runs its own hunt.
 */
export function chaseStep(w: World, b: BossState, dd: number, stopD: number, turn: number): void {
  const T = w.titan;
  const dx = T.x - b.x, dz = T.z - b.z, m = Math.hypot(dx, dz);
  if (!(m > 1e-6)) { b.data.speed = 0; return; }
  const ux = dx / m, uz = dz / m;
  const cap = GATES.huntClose * titanWalk(w);
  let vx = ux * cap, vz = uz * cap;
  if (dd <= stopD) {
    const tvx = Number.isFinite(T.vx) ? T.vx : 0, tvz = Number.isFinite(T.vz) ? T.vz : 0;
    const pull = clamp((dd - stopD) * CHASE.pullPerS, -0.25 * cap, 0.25 * cap);
    vx = tvx + ux * pull; vz = tvz + uz * pull;
    const sp = Math.hypot(vx, vz);
    if (sp > cap) { vx *= cap / sp; vz *= cap / sp; }
  }
  turnBoss(b, Math.atan2(ux, uz), turn, w.dt);
  moveBoss(w, b, vx, vz);
}

/** End of every module step: gateUnstick only counts its DETOUR / RAMMING THROUGH timers down while it is
 *  called (i.e. while hunting), so a hunt that ended mid-ram would keep crush tier 4 forever — decay them here
 *  on every tick the rig did not hunt. */
export function gateAfterMove(w: World, b: BossState): void {
  const d = b.data;
  if (d.huntTick === w.tick) return;
  if (d.ramT > 0) d.ramT = Math.max(0, d.ramT - w.dt);
  if (d.detourT > 0) d.detourT = Math.max(0, d.detourT - w.dt);
}

const crushOpts: DamageOpts = { src: 'boss', kind: 'slam', noCrit: true };
const crushBuf: number[] = [];
/** Crush props and buildings up to the rig's crush tier under a circle (a racing / lurching body). */
export function sweepCrush(w: World, b: BossState, x: number, z: number, r: number): void {
  const c = w.city, tier = gateCrushTier(b);
  crushBuf.length = 0;
  buildingsInRect(c, x - r, z - r, x + r, z + r, crushBuf);
  for (let k = 0; k < crushBuf.length; k++) {
    const bd = c.buildings[crushBuf[k]];
    if (!bd || bd.collapsed || bd.tier > tier) continue;
    const qx = clamp(x, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(z, bd.z - bd.d / 2, bd.z + bd.d / 2);
    if (Math.hypot(x - qx, z - qz) > r) continue;
    damageBuilding(w, bd.id, bd.floorHpMax * 2.5, crushOpts);
  }
  crushBuf.length = 0;
  propsInRect(c, x - r, z - r, x + r, z + r, crushBuf);
  for (let k = 0; k < crushBuf.length; k++) {
    const pr = c.props[crushBuf[k]];
    if (pr && pr.alive && pr.tier <= tier && dist(pr.x, pr.z, x, z) <= r) damageProp(w, pr.id, 1e6, crushOpts);
  }
  crushBuf.length = 0;
}

/** Longest distance (≤ len) from (x, z) along (fx, fz) that stays inside the city bounds less `pad`. */
export function boundsLen(w: World, x: number, z: number, fx: number, fz: number, len: number, pad: number): number {
  const B = w.city.bounds;
  let L = len;
  if (fx > 1e-9) L = Math.min(L, (B.maxX - pad - x) / fx); else if (fx < -1e-9) L = Math.min(L, (B.minX + pad - x) / fx);
  if (fz > 1e-9) L = Math.min(L, (B.maxZ - pad - z) / fz); else if (fz < -1e-9) L = Math.min(L, (B.minZ + pad - z) / fz);
  return Math.max(0, L);
}

// ═══════════════════════════════ STENCIL-1 ═══════════════════════════════
// ─────────────────────────────── tuning (× H unless noted) ───────────────────────────────
export const BAND_MIN_H = 3.0, BAND_MAX_H = 6.0;
const WALK_FRAC = 0.75, TURN = 2.2, AIM_TURN = 4.0, INTRO_WALK = 1.4;
const GAP = [0, 2.2, 1.8, 1.5] as const;
const P3_CADENCE = P3_GAP;
/** Decisions are taken only with the titan within band max + this (H); farther, it hunts. */
/** Decisions only with the titan inside the band: past band max the rig HUNTS, and an attack started mid-hunt
 *  would reset the stuck rule's progress clock (a rig blocked 0.2 H outside its band tossed forever and never
 *  rammed: §5.4 case 15, CORDON-2 / GRID-EAST). */
const DECIDE_SLACK_H = 0;
const STRIPE = { wH: 1.7, escH: 0.85, lenPastH: 3, minLenH: 5, maxLenH: 9, minClearH: 3, min: 1.1, max: 1.9, dmg: 10, knockH: 0.5, raceS: 0.4, paintRH: 0.35, paintS: 5, recover: 0.2 };
export const REFILL_S: readonly number[] = [0, 3.0, 2.6, 2.2];
const REFILL_TURN = 0.4;
const BUCKET = { n: [0, 3, 4, 5] as const, rH: 0.45, min: 1.0, max: 1.8, stagger: 0.15, dmg: 6, puddleS: 4, recover: 0.5, yH: 1.8 };
const DLINE = { lenH: 8, wH: 0.5, sepH: 2.0, min: 1.0, max: 1.8, dmg: 8, paintS: 4, recover: 0.5 };
const DASH_ANSWER = { rH: 0.4, aheadR: 0.3, cd: [0, 7, 5, 4] as const, dmg: 4, min: 0.9, max: 1.8, yH: 1.8 };
const TIPPED_POOL = { ozH: -1.6, rH: 0.8 };
/** TITAN PASS D2 (GATEKEEPERS §3.6): which tells carry a SPLASH RING (bosses/index.ts denialRing). */
const SPLASH = { buckets: true, dash: true, dashPhase: 3, dmgMul: 0.5 };
const PAINT_SLOW = 0.35;
/** Nose offset (the front caster) in H: lanes start here. */
const NOSE_H = 1.25;

/** Parts in H units: [name, ox, oz, r, y0, y1, hpMul, strainMul]. Index 3 is the drum (closed geometry). */
const PARTS_H: readonly (readonly [string, number, number, number, number, number, number, number])[] = [
  ['body', 0, 0, 0.85, 0.3, 1.5, 1, 0.2],
  ['cab', 0, 1.0, 0.45, 0.4, 1.4, 1.2, 0.5],
  ['boom', 0.85, 0.7, 0.3, 1.2, 2.1, 0.6, 0.3],
  ['drum', 0, -1.0, 0.55, 0.9, 1.9, 0.5, 0],
  ['wheelL', -0.8, -0.35, 0.35, 0, 0.7, 1, 0.3],
  ['wheelR', 0.8, -0.35, 0.35, 0, 0.7, 1, 0.3],
  ['wheelF', 0, 1.25, 0.3, 0, 0.6, 1, 0.3],
];
export const DRUM_IX = 3;
const DRUM_OPEN = [0, -1.25, 0.65, 0.6, 1.6, 2.0, 4.0] as const;

const ATTACKS = ['stripeRun', 'paintBuckets', 'doubleLine', 'uTurn'] as const;

const LEAD = { x: 0, z: 0 };
const VOLLEY = new Float32Array(16);

// ─────────────────────────────── module contract ───────────────────────────────
export function create(w: World): BossState {
  const H = gateSettledH(w);
  const parts = PARTS_H.map((p) => makePart(p[0], p[1] * H, p[2] * H, p[3] * H, p[4] * H, p[5] * H, p[6], p[7]));
  const b = baseBoss('stencil1', w.titan.x, w.titan.z, 0, parts);
  const d = b.data;
  d.drumOpen = 0; d.weakMask = 0; d.raceT = 0; d.raceV = 0; d.raceX = 0; d.raceZ = 0;
  d.bandMinH = BAND_MIN_H; d.bandMaxH = BAND_MAX_H;
  d.refills = 0; d.tipped = 0; d.stripes = 0; d.wasStag = 0;
  d.part_drum = 0; d.part_other = 0; d.open_drum = 0; d.open_all = 0; d.lastRefillSpill = 0; d.refillMeter0 = 0;
  d.p3Seen = 0; d.sigDue = 0; d.refillUT = 0; d.fleeT = 0; d.fleeTick = -1;
  d.syncTick = -1;
  return b;
}

/**
 * No hard keep-out (the eased body push-out). bosses/index.ts calls noseOut() on EVERY tick with the titan alive
 * (after refreshParts, stagger included — step() is not called during TIPPED OVER), so it is this module's per-tick
 * sync hook; it returns null (pushTitanOut ignores the nose on the eased path anyway).
 */
export function noseOut(w: World, b?: BossState): null {
  if (b) sync(w, b);
  return null;
}

export function step(w: World, b: BossState): void {
  const T = w.titan, d = b.data;
  const H = bossH(w, b);
  const chasing = rematchChasing(w, b);
  if (b.introT > 0) {
    const dd = dist(b.x, b.z, T.x, T.z);
    if (dd > (BAND_MAX_H - 0.5) * H) gateHunt(w, b, INTRO_WALK * titanWalk(w), TURN);
    else { turnBoss(b, Math.atan2(T.x - b.x, T.z - b.z), TURN, w.dt); b.data.speed = 0; }
    sync(w, b);
    return;
  }
  gateBeats(w, b);
  if (d.raceT > 0) { stepRace(w, b); dashAnswer(w, b); gateAfterMove(w, b); sync(w, b); return; }
  if (!b.attack || isMoveBeat(b.attack)) {
    const dd = dist(b.x, b.z, T.x, T.z);
    if (chasing) chaseStep(w, b, dd, (BAND_MIN_H + 0.5) * H, TURN);   // a rematch chasing a runner: no decision
    else if (dd > BAND_MAX_H * H) gateHunt(w, b, huntSpeed(w, b, dd), TURN);
    else keepRange(w, b, BAND_MIN_H * H, BAND_MAX_H * H, WALK_FRAC * titanWalk(w), TURN);
    if (!chasing && !b.attack && b.cd <= 0 && dd <= (BAND_MAX_H + DECIDE_SLACK_H) * H) decide(w, b);
  } else {
    runAttack(w, b);
  }
  dashAnswer(w, b);
  gateAfterMove(w, b);
  sync(w, b);
}

/** Per-part telemetry (probe_gatekeepers case 5; views ignore). */
export function onDamage(_w: World, b: BossState, part: number, dmg: number): void {
  const d = b.data;
  if (part === DRUM_IX) d.part_drum += dmg; else d.part_other += dmg;
  if ((d.drumOpen ?? 0) > 0) { d.open_all += dmg; if (part === DRUM_IX) d.open_drum += dmg; }
}

// ─────────────────────────────── drum / part sync ───────────────────────────────
/** Is the drum open (REFILL or TIPPED OVER)? */
export function drumIsOpen(b: BossState): boolean {
  return (b.data.drumOpen ?? 0) > 0;
}

/**
 * Rewrite every part from PARTS_H × H and the drum state (open during the REFILL beat and the whole TIPPED OVER
 * stagger), the weakMask, and the world positions. The stagger edge (TIPPED OVER) is handled once per tick.
 */
function sync(w: World, b: BossState): void {
  const d = b.data;
  const H = bossH(w, b);
  const stag = b.staggerT > 0;
  if (d.syncTick !== w.tick) {
    d.syncTick = w.tick;
    if (stag && !(d.wasStag > 0)) {
      d.wasStag = 1;
      d.tipped += 1;
      if (b.phase >= 3) d.sigDue = 1;   // a TIPPED OVER ends a cycle: the next P3 decision is a U-TURN
      // the drum gushes: a WET PAINT pool behind the cart for the stagger
      const c = Math.cos(b.heading), s = Math.sin(b.heading), oz = TIPPED_POOL.ozH * H;
      spawnHazard(w, { owner: 'boss', kind: 'paint', shape: { k: 'circle', x: b.x + oz * s, z: b.z + oz * c, r: TIPPED_POOL.rH * H }, life: Math.max(0.5, b.staggerT), data: { slow: PAINT_SLOW } });
    } else if (!stag) d.wasStag = 0;
    // a race only runs inside its own attack (a stagger or a kill ends the attack mid-race)
    if (d.raceT > 0 && (stag || !b.alive || (b.attack !== 'stripeRun' && b.attack !== 'uTurn'))) { d.raceT = 0; d.raceV = 0; }
  }
  staggerBeat(b, 'tippedOver');
  const open = b.alive && (stag || b.attack === 'refill');
  d.drumOpen = open ? 1 : 0;
  for (let i = 0; i < b.parts.length && i < PARTS_H.length; i++) {
    const p = b.parts[i], g = PARTS_H[i];
    if (i === DRUM_IX && open) {
      p.ox = DRUM_OPEN[0] * H; p.oz = DRUM_OPEN[1] * H; p.r = DRUM_OPEN[2] * H; p.y0 = DRUM_OPEN[3] * H; p.y1 = DRUM_OPEN[4] * H;
      p.hpMul = DRUM_OPEN[5]; p.strainMul = DRUM_OPEN[6];
    } else {
      p.ox = g[1] * H; p.oz = g[2] * H; p.r = g[3] * H; p.y0 = g[4] * H; p.y1 = g[5] * H; p.hpMul = g[6]; p.strainMul = g[7];
    }
  }
  d.weakMask = open ? 1 << DRUM_IX : 0;
  refreshParts(b);
}

// ─────────────────────────────── decision ───────────────────────────────
function decide(w: World, b: BossState): void {
  const P = b.phase, d = b.data;
  // P3 signature: U-TURN on the first P3 decision and once per REFILL / TIPPED OVER cycle after that (a cycle
  // whose REFILL followed a U-TURN has shown it: fx2 lane B, critic r1 "U-TURN never appeared")
  if (P >= 3 && !(d.p3Seen > 0)) { d.p3Seen = 1; d.sigDue = 1; }
  if (P >= 3 && d.sigDue > 0) {
    d.sigDue = 0;
    if (startAttack(w, b, 'uTurn')) return;
  }
  const wts = [
    1.5,                    // stripeRun (the REFILL opener: the lesson)
    0.5,                    // paintBuckets (a 3–5 tell volley whose secondaries sit off the exit by design: kept rarer)
    P >= 2 ? 1.3 : 0,       // doubleLine
    P >= 3 ? 1.3 : 0,       // uTurn
  ];
  for (let i = 0; i < wts.length; i++) wts[i] *= repeatMul(b, ATTACKS[i]);
  for (let guard = 0; guard < 4; guard++) {
    const id = pickWeighted(w, ATTACKS, wts) ?? 'paintBuckets';
    if (startAttack(w, b, id)) return;
    wts[ATTACKS.indexOf(id as typeof ATTACKS[number])] = 0;   // a blocked lane: pick again
  }
  if (!startAttack(w, b, 'paintBuckets')) endAttack(b, 0.5);
}

/** Start an attack; false when it cannot be placed (a STRIPE RUN lane blocked by the city). */
function startAttack(w: World, b: BossState, id: string): boolean {
  switch (id) {
    case 'stripeRun':
    case 'uTurn': {
      const lane = planStripe(w, b, b.x, b.z);
      if (!lane) return false;
      beginAttack(w, b, id, lane.ex, lane.ez);
      b.data.stripes += 1;
      b.data.runN = 0;                              // races completed in this attack
      b.data.runs = id === 'uTurn' ? 2 : 1;
      paintStripe(w, b, lane, id === 'uTurn' ? 'uTurn:1' : 'stripeRun');
      return true;
    }
    case 'paintBuckets': { buckets(w, b); return true; }
    case 'doubleLine': { doubleLine(w, b); return true; }
  }
  return false;
}

// ─────────────────────────────── STRIPE RUN / U-TURN ───────────────────────────────
interface StripePlan { x: number; z: number; dir: number; len: number; wu: number; ex: number; ez: number; cx: number; cz: number }
const PLAN: StripePlan = { x: 0, z: 0, dir: 0, len: 0, wu: 0, ex: 0, ez: 0, cx: 0, cz: 0 };

/**
 * A stripe lane for a cart whose centre is (cx, cz): aimed from that centre through the lead point, starting at
 * the nose (1.25 H ahead along the aim), len clamp(d + 3 H, 5 H, 9 H) clamped by laneClearLen (the cart's body
 * r 0.85 H) and the city bounds. null when less than 3 H of lane is clear.
 */
function planStripe(w: World, b: BossState, cx: number, cz: number): StripePlan | null {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const wu = gateWindup(w, b, STRIPE.escH + R / H, STRIPE.min, STRIPE.max);
  const L = leadPoint(w, b, wu, LEAD);
  let fx = L.x - cx, fz = L.z - cz;
  const fl = Math.hypot(fx, fz);
  if (fl > 1e-6) { fx /= fl; fz /= fl; } else { fx = Math.sin(b.heading); fz = Math.cos(b.heading); }
  const nx = cx + fx * NOSE_H * H, nz = cz + fz * NOSE_H * H;
  const dN = Math.max(0, fl - NOSE_H * H);
  let len = clamp(dN + STRIPE.lenPastH * H, STRIPE.minLenH * H, STRIPE.maxLenH * H);
  len = laneClearLen(w, nx, nz, fx, fz, len, 0.5 * STRIPE.wH * H);
  len = Math.min(len, boundsLen(w, nx, nz, fx, fz, len, 0.5 * STRIPE.wH * H));
  if (len < STRIPE.minClearH * H) return null;
  PLAN.x = nx; PLAN.z = nz; PLAN.dir = Math.atan2(fx, fz); PLAN.len = len; PLAN.wu = wu;
  PLAN.ex = nx + fx * len; PLAN.ez = nz + fz * len;
  PLAN.cx = cx + fx * len; PLAN.cz = cz + fz * len;   // the cart centre at the end of the race
  return PLAN;
}

/** Paint a planned stripe lane; its fire starts the race (and, for the first lane of a U-TURN, paints the second). */
function paintStripe(w: World, b: BossState, lane: StripePlan, tag: string): void {
  const H = bossH(w, b);
  const x0 = lane.x, z0 = lane.z, dir = lane.dir, len = lane.len;
  const ex = lane.cx, ez = lane.cz;
  b.data.dir = dir;
  const tg = bossTelegraph(w, {
    style: 'lane', shape: { k: 'lane', x: x0, z: z0, dir, len, w: STRIPE.wH * H },
    windup: lane.wu, dmg: gateHit(w, STRIPE.dmg), kind: 'ram', tag,
    onFire: (w2, tgf) => {
      if (!b.alive || b.staggerT > 0 || (b.attack !== 'stripeRun' && b.attack !== 'uTurn')) return;
      const Tt = w2.titan;
      if (tgf.hitTitan && Tt.alive && Tt.dashT <= 0) {
        // knock sideways, away from the lane's centre line
        const fx = Math.sin(dir), fz = Math.cos(dir);
        const side = (Tt.x - x0) * fz - (Tt.z - z0) * fx;
        const sg = side >= 0 ? 1 : -1;
        shoveTitan(b, fz * sg, -fx * sg, STRIPE.knockH * bossH(w2, b));
      }
      // the race: the cart drives the lane's centre line end to end in 0.4 s (index.ts suspends the push-out)
      b.heading = dir;
      b.data.raceT = STRIPE.raceS;
      b.data.raceX = ex; b.data.raceZ = ez;
      b.data.raceV = Math.hypot(ex - b.x, ez - b.z) / STRIPE.raceS;
      // the wet stripe along the centre line (narrower than the damage lane: the tyre track)
      const Hh = bossH(w2, b);
      spawnHazard(w2, {
        owner: 'boss', kind: 'paint', life: STRIPE.paintS,
        shape: { k: 'capsule', x0, z0, x1: x0 + Math.sin(dir) * len, z1: z0 + Math.cos(dir) * len, r: STRIPE.paintRH * Hh },
        data: { slow: PAINT_SLOW, reveal: STRIPE.raceS },
      });
      // U-TURN: the second run is painted as the first fires, re-aimed from the first lane's end
      if (b.attack === 'uTurn' && (b.data.runN ?? 0) === 0) {
        const lane2 = planStripe(w2, b, ex, ez);
        if (lane2) { b.data.runs = 2; paintStripe(w2, b, lane2, 'uTurn:2'); }
        else b.data.runs = 1;
      }
    },
  }, false);
  b.data.stripeWu = tg.windup;
}

/** The race: move along the centre line to the end point; on arrival, the next run or the REFILL. */
function stepRace(w: World, b: BossState): void {
  const d = b.data, H = bossH(w, b);
  const dx = d.raceX - b.x, dz = d.raceZ - b.z, m = Math.hypot(dx, dz);
  const stepL = d.raceV * w.dt;
  d.raceT = Math.max(0, d.raceT - w.dt);
  if (m <= stepL + 1e-6 || d.raceT <= 1e-6) {
    b.x = d.raceX; b.z = d.raceZ;
    b.data.speed = 0;
    d.raceT = 0; d.raceV = 0;
    d.runN = (d.runN ?? 0) + 1;
    if (d.runN >= (d.runs ?? 1)) {
      // REFILL: the cart ends past the titan facing away, so the open drum faces it
      d.refillUT = b.attack === 'uTurn' ? 1 : 0;
      startBeat(b, 'refill', REFILL_S[b.phase] ?? 3);
      d.refills += 1;
      d.refillMeter0 = b.meter;
    } else {
      b.data.speed = 0;
    }
  } else {
    moveBoss(w, b, (dx / m) * d.raceV, (dz / m) * d.raceV);
  }
  refreshParts(b);
  sweepCrush(w, b, b.x, b.z, 0.85 * H);
}

// ─────────────────────────────── PAINT BUCKETS / DOUBLE LINE ───────────────────────────────
function buckets(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const r = BUCKET.rH * H;
  const wu = gateWindup(w, b, BUCKET.rH + R / H, BUCKET.min, BUCKET.max);
  const L = leadPoint(w, b, wu, LEAD);
  beginAttack(w, b, 'paintBuckets', L.x, L.z);
  b.data.dir = Math.atan2(L.x - b.x, L.z - b.z);
  const n = volleyPoints(w, b, L.x, L.z, BUCKET.n[b.phase] ?? 3, r, VOLLEY);
  // the rack sits on the cart's back, beside the drum
  const c = Math.cos(b.heading), s = Math.sin(b.heading);
  const sx = b.x + 0.45 * H * c - 0.4 * H * s, sz = b.z - 0.45 * H * s - 0.4 * H * c;
  let end = 0;
  for (let i = 0; i < n; i++) {
    const tx = VOLLEY[2 * i], tz = VOLLEY[2 * i + 1];
    const tg = bossTelegraph(w, {
      style: 'circle', shape: { k: 'circle', x: tx, z: tz, r },
      windup: wu + BUCKET.stagger * i, dmg: gateHit(w, BUCKET.dmg), kind: 'plate', tag: 'lob:paintCan',
      onFire: (w2) => {
        spawnHazard(w2, { owner: 'boss', kind: 'paint', shape: { k: 'circle', x: tx, z: tz, r }, life: BUCKET.puddleS, data: { slow: PAINT_SLOW } });
      },
    }, false);
    spawnProjectile(w, {
      owner: 'boss', kind: 'paintCan', x: sx, z: sz, y: BUCKET.yH * H, vx: 0, vz: 0,
      dmg: 0, lob: true, tx, tz, aoe: r, life: tg.windup, tg: tg.id,
    });
    end = Math.max(end, tg.windup);
    // TITAN PASS D2 (GATEKEEPERS §3.6): the lead bucket's SPLASH RING — step out and stop; a blind dash lands in it
    if (i === 0 && SPLASH.buckets) end = Math.max(end, denialRing(w, b, tx, tz, r, tg.windup, gateHit(w, BUCKET.dmg * SPLASH.dmgMul), 'plate', 'splash')?.windup ?? 0);
  }
  b.data.attackEnd = end + BUCKET.recover;
}

function doubleLine(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b), R = T.radius;
  const wu = gateWindup(w, b, 0.5 * DLINE.wH + R / H, DLINE.min, DLINE.max);
  const L = leadPoint(w, b, wu, LEAD);
  let ax = L.x - b.x, az = L.z - b.z;
  const am = Math.hypot(ax, az);
  if (am > 1e-6) { ax /= am; az /= am; } else { ax = Math.sin(b.heading); az = Math.cos(b.heading); }
  const px = az, pz = -ax;                               // along the lines
  const sg = w.rng.boss() < 0.5 ? -1 : 1;                // the second line toward or away from the cart
  beginAttack(w, b, 'doubleLine', L.x, L.z);
  b.data.dir = Math.atan2(ax, az);
  const dir = Math.atan2(px, pz), half = 0.5 * DLINE.lenH * H;
  let end = 0;
  for (let k = 0; k < 2; k++) {
    const cx = L.x + ax * sg * DLINE.sepH * H * k, cz = L.z + az * sg * DLINE.sepH * H * k;
    const x0 = cx - px * half, z0 = cz - pz * half, x1 = cx + px * half, z1 = cz + pz * half;
    const tg = bossTelegraph(w, {
      style: 'lane', shape: { k: 'lane', x: x0, z: z0, dir, len: DLINE.lenH * H, w: DLINE.wH * H },
      windup: wu, dmg: gateHit(w, DLINE.dmg), kind: 'generic', tag: 'doubleLine:' + k,
      onFire: (w2) => {
        spawnHazard(w2, { owner: 'boss', kind: 'paint', shape: { k: 'capsule', x0, z0, x1, z1, r: 0.5 * DLINE.wH * bossH(w2, b) }, life: DLINE.paintS, data: { slow: PAINT_SLOW } });
      },
    }, false);
    end = Math.max(end, tg.windup);
  }
  b.data.attackEnd = end + DLINE.recover;
}

// ─────────────────────────────── attack runner ───────────────────────────────
function runAttack(w: World, b: BossState): void {
  const T = w.titan, t = b.attackT, d = b.data;
  const faceT = Math.atan2(T.x - b.x, T.z - b.z);
  b.data.speed = 0;
  switch (b.attack) {
    case 'stripeRun':
    case 'uTurn': {
      // squaring up to the lane (from the first run's end for the second U-TURN run)
      turnBoss(b, d.dir ?? b.heading, AIM_TURN, w.dt);
      // a lane whose fire was lost (cancelled): give up after a generous wait
      if (t > (d.stripeWu ?? 2) + 3 * STRIPE.raceS + 2.5) endAttack(b, gateGap(w, b, GAP, P3_CADENCE));
      break;
    }
    case 'refill':
      turnBoss(b, faceT, REFILL_TURN, w.dt);
      if (t >= (d.beatS ?? 3)) {
        d.lastRefillSpill = Math.max(0, b.meter - (d.refillMeter0 ?? 0));
        if (b.phase >= 3 && !(d.refillUT > 0)) d.sigDue = 1;   // a P3 cycle without the U-TURN: it comes next
        endAttack(b, gateGap(w, b, GAP, P3_CADENCE));
      }
      break;
    case 'paintBuckets':
    case 'doubleLine':
      turnBoss(b, faceT, TURN * 0.5, w.dt);
      if (t >= (d.attackEnd ?? 2) || (t >= CHASE_VOLLEY_S && rematchChasing(w, b))) endAttack(b, gateGap(w, b, GAP, P3_CADENCE));
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
  const ahead = DASH_ANSWER.aheadR * reach;
  const x = clamp(e.x1 + (dx / dl) * ahead, Bd.minX, Bd.maxX), z = clamp(e.z1 + (dz / dl) * ahead, Bd.minZ, Bd.maxZ);
  const wu = gateWindupK1(w, b, DASH_ANSWER.rH + T.radius / H, DASH_ANSWER.min, DASH_ANSWER.max);
  const tg = bossTelegraph(w, {
    style: 'circle', shape: { k: 'circle', x, z, r },
    windup: wu, dmg: gateHit(w, DASH_ANSWER.dmg), kind: 'plate', tag: 'lob:paintCan',
  }, false);
  spawnProjectile(w, {
    owner: 'boss', kind: 'paintCan', x: b.x, z: b.z, y: DASH_ANSWER.yH * H, vx: 0, vz: 0,
    dmg: 0, lob: true, tx: x, tz: z, aoe: r, life: tg.windup, tg: tg.id,
  });
  if (SPLASH.dash && b.phase >= SPLASH.dashPhase) denialRing(w, b, x, z, r, tg.windup, gateHit(w, DASH_ANSWER.dmg * SPLASH.dmgMul), 'plate', 'splash:dash');
  b.data.followX = x; b.data.followZ = z;
}
