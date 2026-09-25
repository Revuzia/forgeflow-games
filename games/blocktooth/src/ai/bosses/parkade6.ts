// BLOCKTOOTH v2 — PARKADE-6, HALVARD MOBILE PARKING STRUCTURE: GRID-EAST's boss (FEATURES_V2 §10.2, lane L3).
// SIM: THREE-free, DOM-free, deterministic (every roll from w.rng.boss).
//
// A six-legged multi-storey car park that walks: four decks on hydraulic stilts, a toll-booth head with a
// barrier arm, and the TILL — a pay-station drawer that slides out of the booth whenever the garage launches
// traffic (rampLaunch), a moment after a deck slam (deckDrop) and for the whole JAMMED stagger.
//
// Body (boss-local, facing +Z): body r22 · 6 legs r5 (strain 0.8) · booth r7 at (0, 32) (hp ×1.4, strain 1.5)
//   · arm pivot housing r4 at (9, 35) (hp ×0.6, strain 0.3) · the TILL, REWRITTEN EVERY TICK (syncTill):
//     closed = stowed in the booth (0, 30, r 4, y 40–46, hp ×0.3, strain 0) — the booth is always nearer;
//     open   = drawer out 12 m past the booth face (0, 43, r 8, y 30–40, hp ×2.0, strain ×4) — the nearest
//              part surface for a titan in front of the booth, so the planar nearestBossPart picks it.
// Footwork: keepRange(max(70, keep-out + 4), 130, 7 m/s, 0.8 rad/s), the booth always turned toward the
//   titan; while the till is out it turns at HALF rate (the drawer holds its line — get in front of it).
// Keep-out (hard wall, bosses/index.ts pushTitanOut): RIG_R 33 + titan r + 10 (≈ 68 m at Size V).
//   Nose keep-out as CAISSON-4 (a MOLO facing the rig must not push its head through the decks).
// Entrance: reverses in from the nearest city edge (entryPoint), rear first, then swings its booth round
//   in the last 1.4 s of the 4 s intro. b.data.reversing = 1 while backing (view: reversing beeper).
//
// Attacks — geometry in TITAN HEIGHTS (H = bossH), R = titan radius; windups = fairWindup (a reaction + the
// walk-out of the shape for THIS titan), painted with bossTelegraph; damage = min(bossHostile(base), 0.55 ×
// titan max HP) (HIT_CAP). Gaps [_, 2.7, 2.1, 1.9] s × (0.85–1.15), P3 × 0.75; anti-spam repeatMul.
//   P1+ rampLaunch    4 / 5 / 6 cars (P1 / P2 / P3) lobbed off the rear deck ('carLob'; each lob paints its
//                     own circle r 0.35 H): the first on the lead point, the rest on a 0.9 H ring around it
//                     (evenly spread, rng.boss rotation + jitter); windup fair(0.35 H + R, 1.2–2.2) + 0.18 s × i.
//                     OPENS THE TILL for TILL_OPEN_S (3.5 s; P3 2.5 s) from the launch. dmg 16 each.
//   P1+ barrierSwing  cone from the booth, half 40°, reach 2.4 H, windup from the cheaper walk-out (sideways
//                     d·sin 40° + R or out past the reach, 1.1–2.2). dmg 30 + knock 0.8 H/s along the sweep.
//   P2+ towChain      'chain' tell (links every ≈ 0.55 H, 5–10 links, Telegraph.chain = link points; damage =
//                     the capsule booth → 0.8 H past the lead point, r 0.3 H); windup fair(0.3 H + R, 1.0–2.0).
//                     dmg 18; a landed (non-dash) hit TOWS: titan.leash 2.0 s toward the booth at 0.3 H/s
//                     (b.data.tow = 1); pulling against it fills JAM 0.10/s; UPROAR (an `ultFire`) snaps it;
//                     the cable lets go at the keep-out + 6 m (never drags the titan into the rig).
//   P2+ deckDrop      ring 0 → RIG_R + 0.9 H around the rig, windup from the titan's walk to the outer edge
//                     (0.9–2.0); dmg 40; the decks bounce the till OPEN for 2.0 s from the slam.
//   P3  levelCollapse 3 rings A 0 → RIG_R + 0.6 H · B → RIG_R + 1.3 H · C → RIG_R + 2.0 H; A fair (0.9–2.0),
//                     B = A + 0.45 s, C = A + 0.9 s (+1 ms each, so bossTelegraph's same-spot guard reads them
//                     as the three beats they are); dmg 36 each.
//   any dash answer   (watchDash, cd [_, 8, 6, 5]): a 'carLob' wheel clamp r 0.45 H dropped 0.3 (r + R) past
//                     the dash end, fair with k 1 (0.9–2.0); dmg 8 (as CAISSON-4's trolley follow).
// JAM (the meter): the standard rule — dealt × strainMul / (0.45 × maxHp) — so it builds mostly on the OPEN
//   till (×4), a little on the booth (×1.5) and legs (×0.8); + 0.10/s resisting the tow; UPROAR +0.30
//   (bossUltHit). Full → JAMMED (bosses/index.ts: 5 s, ×2 damage); the till is forced OPEN for the stagger.
//   Phases at 66 % / 33 % (index.ts).
// Telemetry (probe_boss3): b.data.part_till / part_booth / part_body / part_legs = titan damage per part group
//   (after part hpMul; the arm counts as body); open_* = the same, only while the till is open; tillOpens =
//   till openings; ramps = rampLaunch casts; jams = JAMMED count.
//
// Measured 2026-09-24 (HEAD 5731402c + L0 + the concurrent C1 lanes' working tree), node _harness/probe_boss3.ts:
//   open-till window (findTarget picks the till): ±34° at the Size V wall (71 m) · ±37° at 90 m · ±41° at 130 m
//   policy duels, 5 seeds Size V + 1 Size IV, god, phases forced every 45 s:
//     tells landed      VOLT-KITE 55/570 = 9.6 %   · MOLO 39/393 = 9.9 %      (band 4–16 %)
//     JAMMED per 150 s  VOLT-KITE 2.99             · MOLO 2.87                (≥ 1)
//     till share open   VOLT-KITE 75.3 %           · MOLO 51.3 %              (≥ 35 %)
//     max hit 55.0 % of max HP (the HIT_CAP) · min windup 0.90 s · every rampLaunch opened the till (55/55, 38/38)
//   full GRID-EAST gate-bot runs (seeds 1337 + 7, UPROAR in use): 7 clears / 1 death, median fight 96 s (70–170)
//   GATE 2 after the flip: fresh and full PASS, 8/12 clears, 4 deaths; GRID-EAST 3 clears + VOLT-KITE dead —
//   the same split CAISSON-4 had on GRID-EAST before the flip (VOLT-KITE over 4 seeds: 2/2 with either boss).
//   HP stays at §10.2's 180 000 (× 1.15 = 207 000 at Size V): no band needed a knob.
//
// NOTE (contract gap, reported): bosses/index.ts calls module.step() only outside the stagger, so the till is
// synced from keepOut() too — the one module callback stepBoss makes on EVERY tick (after refreshParts, before
// the wall). syncTill is idempotent per tick (b.data.tillTick), so the extra call is harmless.

import type { BossState, World } from '../../core/types.ts';
import { clamp, dist, wrapAngle } from '../../core/math.ts';
import {
  addMeter, baseBoss, beginAttack, bossH, bossHostile, bossTelegraph, endAttack, entryPoint, fairWindup,
  keepRange, leadPoint, localToWorld, makePart, moveBoss, pickWeighted, releaseLeash, repeatMul, shoveTitan,
  turnBoss, watchDash,
} from './index.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { titanSpeed } from '../../core/config.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const WALK = 7, TURN = 0.8, AIM_TURN = 1.1;
const MIN_D = 70, MAX_D = 130;
const INTRO_WALK = 16, INTRO_STOP = 117, INTRO_TURN_S = 1.4, INTRO_TURN_RATE = 2.6;
/** Plan-view reach of the rig (m): the corner legs stand at (±20, ±24) with r 5 → ≈ 36 m, the decks ≈ 33 m. */
export const RIG_R = 33;
/** Hard keep-out clearance (m) between the rig footprint and the titan's circle. */
const WALL_CLEAR = 10;
/** The tow cable lets go this far (m) outside the keep-out wall. */
const TOW_CLEAR = 6;
const GAP = [0, 2.7, 2.1, 1.9] as const;
const P3_CADENCE = 0.75;
const HIT_CAP = 0.55;
/** Till window (s) opened by a rampLaunch, per phase. */
export const TILL_OPEN_S: readonly number[] = [0, 3.5, 3.5, 2.5];
/** Till window (s) after a deckDrop slam. */
const DECK_TILL_S = 2.0;

const RAMP = { n: [0, 4, 5, 6] as const, rH: 0.35, ringH: 0.9, stagger: 0.18, dmg: 16, min: 1.2, max: 2.2, recover: 0.5, y: 52, fromZ: -18 };
const BARRIER = { half: (40 * Math.PI) / 180, rH: 2.4, dmg: 30, knockH: 0.8, min: 1.1, max: 2.2, recover: 0.8 };
const TOW = { pastH: 0.8, linkH: 0.55, minLinks: 5, maxLinks: 10, rH: 0.3, dmg: 18, min: 1.0, max: 2.0, leashS: 2.0, pullH: 0.3, jamPerS: 0.10, recover: 0.5 };
const DECK = { rH: 0.9, dmg: 40, min: 0.9, max: 2.0, recover: 0.6 };
const COLLAPSE = { aH: 0.6, bH: 1.3, cH: 2.0, dmg: 36, min: 0.9, max: 2.0, dtB: 0.451, dtC: 0.902, recover: 0.5 };
const DASH_ANSWER = { rH: 0.45, aheadR: 0.3, cd: [0, 8, 6, 5] as const, dmg: 8, min: 0.9, max: 2.0, y: 60 };

/** Till part geometry: [ox, oz, r, y0, y1, hpMul, strainMul]. */
const TILL_CLOSED = [0, 30, 4, 40, 46, 0.3, 0] as const;
const TILL_OPEN = [0, 43, 8, 30, 40, 2.0, 4.0] as const;

const ATTACKS = ['rampLaunch', 'barrierSwing', 'towChain', 'deckDrop', 'levelCollapse'] as const;

const TMP = { x: 0, z: 0 };
const LEAD = { x: 0, z: 0 };

function pkHit(w: World, base: number): number {
  return Math.min(bossHostile(w, base), HIT_CAP * Math.max(1, w.titan.maxHp));
}

// ─────────────────────────────── module contract ───────────────────────────────
export function create(w: World): BossState {
  const E = { x: 0, z: 0, heading: 0 };
  entryPoint(w, false, E);
  const parts = [
    makePart('body', 0, 0, 22, 12, 56, 1, 0.2),
    makePart('legFL', 20, 24, 5, 0, 30, 1, 0.8),
    makePart('legFR', -20, 24, 5, 0, 30, 1, 0.8),
    makePart('legML', 22, 0, 5, 0, 30, 1, 0.8),
    makePart('legMR', -22, 0, 5, 0, 30, 1, 0.8),
    makePart('legBL', 20, -24, 5, 0, 30, 1, 0.8),
    makePart('legBR', -20, -24, 5, 0, 30, 1, 0.8),
    makePart('booth', 0, 32, 7, 38, 52, 1.4, 1.5),
    makePart('arm', 9, 35, 4, 44, 48, 0.6, 0.3),
    makePart('till', TILL_CLOSED[0], TILL_CLOSED[1], TILL_CLOSED[2], TILL_CLOSED[3], TILL_CLOSED[4], TILL_CLOSED[5], TILL_CLOSED[6]),
  ];
  // it REVERSES in: rear first toward the titan, booth swung round at the end of the intro
  const b = baseBoss('parkade6', E.x, E.z, wrapAngle(E.heading + Math.PI), parts);
  b.data.tillOpen = 0; b.data.tow = 0; b.data.deckTilt = 0; b.data.reversing = 0;
  b.data.part_till = 0; b.data.part_booth = 0; b.data.part_body = 0; b.data.part_legs = 0;
  b.data.open_till = 0; b.data.open_booth = 0; b.data.open_body = 0; b.data.open_legs = 0;
  b.data.tillOpens = 0; b.data.ramps = 0; b.data.jams = 0; b.data.tillTick = -1; b.data.wasStag = 0;
  return b;
}

/** Hard keep-out, centre to centre (m). Also the per-tick till sync during the stagger (see header NOTE). */
export function keepOut(w: World, b?: BossState): number {
  if (b) syncTill(w, b);
  return keepOutM(w);
}
/** The keep-out distance itself (pure). */
export function keepOutM(w: World): number {
  return RIG_R + w.titan.radius + WALL_CLEAR;
}

/** Each titan's nose in titan heights ahead of its centre (the CAISSON-4 table, titans/models.ts). */
const NOSE_H: Record<string, number> = { molo: 1.11, voltkite: 0.75, hearthback: 0.8, briarwick: 0.91 };
const NOSE_FRAC = 0.75, NOSE_CLEAR = 4;
export function noseOut(w: World): { reach: number; min: number } {
  const T = w.titan;
  return { reach: NOSE_FRAC * (NOSE_H[T.id] ?? 0.8) * T.height, min: RIG_R + NOSE_CLEAR };
}

export function step(w: World, b: BossState): void {
  const T = w.titan;
  if (b.introT > 0) { intro(w, b); syncTill(w, b); return; }
  b.data.reversing = 0;
  const open = (b.data.tillOpen ?? 0) > 0;
  if (!b.attack) {
    const minD = Math.max(MIN_D, keepOutM(w) + 4);
    keepRange(w, b, minD, Math.max(MAX_D, minD + 60), WALK, TURN * (open ? 0.5 : 1));
    if (b.cd <= 0) decide(w, b);
  } else {
    b.data.speed = 0;
    runAttack(w, b);
  }
  yieldWall(w, b);
  dashAnswer(w, b);
  tow(w, b, T);
  // deck tilt (view): up over 0.3 s at a launch, back down after
  const tiltWant = b.attack === 'rampLaunch' && b.attackT < (b.data.rampEnd ?? 0) - RAMP.recover ? 1 : 0;
  b.data.deckTilt = clamp((b.data.deckTilt ?? 0) + (tiltWant ? w.dt / 0.3 : -w.dt / 0.5), 0, 1);
  syncTill(w, b);
}

/** Per-part-group damage telemetry (b.data.part_* and, while the till is open, open_*). */
export function onDamage(_w: World, b: BossState, part: number, dmg: number): void {
  const name = b.parts[part]?.name ?? 'body';
  const g = name === 'till' ? 'till' : name === 'booth' ? 'booth' : name.startsWith('leg') ? 'legs' : 'body';
  b.data['part_' + g] = (b.data['part_' + g] ?? 0) + dmg;
  if ((b.data.tillOpen ?? 0) > 0 || b.staggerT > 0) b.data['open_' + g] = (b.data['open_' + g] ?? 0) + dmg;
}

// ─────────────────────────────── till ───────────────────────────────
/** Is the till drawer out? */
export function tillIsOpen(b: BossState): boolean {
  return (b.data.tillOpen ?? 0) > 0;
}

/**
 * Once per tick: count the till window down (held open for the whole stagger), then rewrite the till part
 * (local offsets, radius, height span, hpMul, strainMul) and its world position.
 */
function syncTill(w: World, b: BossState): void {
  if (b.data.tillTick === w.tick) return;
  b.data.tillTick = w.tick;
  const was = (b.data.tillOpen ?? 0) > 0;
  let t = Math.max(0, (b.data.tillOpen ?? 0) - w.dt);
  if (t < 1e-6) t = 0;
  if (b.staggerT > 0) {
    t = Math.max(t, b.staggerT);
    if (!(b.data.wasStag > 0)) { b.data.jams = (b.data.jams ?? 0) + 1; b.data.wasStag = 1; }
  } else b.data.wasStag = 0;
  if (!b.alive) t = 0;
  b.data.tillOpen = t;
  if (t > 0 && !was) b.data.tillOpens = (b.data.tillOpens ?? 0) + 1;
  const g = t > 0 ? TILL_OPEN : TILL_CLOSED;
  for (let i = 0; i < b.parts.length; i++) {
    const p = b.parts[i];
    if (p.name !== 'till') continue;
    p.ox = g[0]; p.oz = g[1]; p.r = g[2]; p.y0 = g[3]; p.y1 = g[4]; p.hpMul = g[5]; p.strainMul = g[6];
    localToWorld(b, p.ox, p.oz, p);
    break;
  }
}

/** Open the till for at least `s` seconds. */
function openTill(b: BossState, s: number): void {
  if (!b.alive) return;
  b.data.tillOpen = Math.max(b.data.tillOpen ?? 0, s);
}

/**
 * The hard wall projects the titan out, but bosses/index.ts settles it against the CITY afterwards: a
 * Size IV titan backed onto a building it cannot flatten is pushed back inside the wall (probe_boss3
 * measured up to 6 m). The rig yields instead: whenever the titan stands within 1 m of the wall it backs off,
 * fast enough to clear the overlap within a tick or two (capped at the titan's walk speed: the titan shoves it).
 */
function yieldWall(w: World, b: BossState): void {
  const T = w.titan;
  if (!T.alive) return;
  const keep = keepOutM(w) + 1;
  const dx = b.x - T.x, dz = b.z - T.z, d = Math.hypot(dx, dz);
  if (d >= keep || d < 1e-4) return;
  const sp = clamp((keep - d) / Math.max(1e-3, w.dt), WALK, Math.max(WALK, titanSpeed(T.height)));
  moveBoss(w, b, (dx / d) * sp, (dz / d) * sp);
}

// ─────────────────────────────── intro ───────────────────────────────
function intro(w: World, b: BossState): void {
  const T = w.titan;
  const dx = T.x - b.x, dz = T.z - b.z, d = Math.hypot(dx, dz) || 1;
  const reverse = b.introT > INTRO_TURN_S;
  const face = Math.atan2(dx, dz);
  turnBoss(b, reverse ? wrapAngle(face + Math.PI) : face, reverse ? 1.5 : INTRO_TURN_RATE, w.dt);
  if (reverse && d > INTRO_STOP) { moveBoss(w, b, (dx / d) * INTRO_WALK, (dz / d) * INTRO_WALK); b.data.reversing = 1; }
  else { b.data.speed = 0; b.data.reversing = 0; }
}

// ─────────────────────────────── decision ───────────────────────────────
function gapFor(w: World, b: BossState): number {
  const g = GAP[b.phase] * (0.85 + 0.3 * w.rng.boss());
  return b.phase === 3 ? g * P3_CADENCE : g;
}

function booth(b: BossState): { x: number; z: number } {
  return localToWorld(b, 0, 32, TMP);
}

function decide(w: World, b: BossState): void {
  const T = w.titan, H = bossH(w, b);
  const d = dist(b.x, b.z, T.x, T.z);
  const P = b.phase;
  const bo = booth(b);
  const dB = dist(bo.x, bo.z, T.x, T.z);
  const wts = [
    1.2,                                                                  // rampLaunch (the till opener)
    dB < BARRIER.rH * H - 0.1 * H ? 1.1 : 0.25,                           // barrierSwing (punishes loitering in front)
    P >= 2 ? (d > 2.2 * H ? 1.6 : 0.6) : 0,                               // towChain (reels a kiter in)
    P >= 2 ? (d < RIG_R + DECK.rH * H + T.radius + 0.3 * H ? 1.1 : 0.2) : 0,   // deckDrop (anti-hug)
    P >= 3 ? (d < RIG_R + COLLAPSE.cH * H + T.radius ? 1.2 : 0.3) : 0,    // levelCollapse
  ];
  for (let i = 0; i < wts.length; i++) wts[i] *= repeatMul(b, ATTACKS[i]);
  const id = pickWeighted(w, ATTACKS, wts) ?? 'rampLaunch';
  startAttack(w, b, id);
}

function startAttack(w: World, b: BossState, id: string): void {
  const T = w.titan, H = bossH(w, b), Bd = w.city.bounds;
  switch (id) {
    case 'rampLaunch': {
      const n = RAMP.n[b.phase] ?? 4;
      const r = RAMP.rH * H;
      const wu = fairWindup(w, b, r + T.radius, RAMP.min, RAMP.max);
      const L = leadPoint(w, b, wu, LEAD);
      const cx = L.x, cz = L.z;
      beginAttack(w, b, id, cx, cz);
      b.data.dir = Math.atan2(cx - b.x, cz - b.z);
      const src = localToWorld(b, 0, RAMP.fromZ, { x: 0, z: 0 });
      const a0 = w.rng.boss() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        let tx = cx, tz = cz;
        if (i > 0) {
          const a = a0 + ((i - 1) / (n - 1)) * Math.PI * 2 + (w.rng.boss() - 0.5) * 0.5;
          tx = cx + Math.sin(a) * RAMP.ringH * H; tz = cz + Math.cos(a) * RAMP.ringH * H;
        }
        tx = clamp(tx, Bd.minX, Bd.maxX); tz = clamp(tz, Bd.minZ, Bd.maxZ);
        spawnProjectile(w, {
          owner: 'boss', kind: 'carLob', x: src.x, z: src.z, y: RAMP.y, vx: 0, vz: 0,
          dmg: pkHit(w, RAMP.dmg), lob: true, tx, tz, aoe: r, life: wu + i * RAMP.stagger,
        });
      }
      b.data.rampEnd = wu + (n - 1) * RAMP.stagger + RAMP.recover;
      b.data.ramps = (b.data.ramps ?? 0) + 1;
      openTill(b, TILL_OPEN_S[b.phase] ?? 3.5);
      break;
    }
    case 'barrierSwing': {
      const bo = booth(b);
      const bx = bo.x, bz = bo.z;
      const r = BARRIER.rH * H, d = dist(bx, bz, T.x, T.z);
      const esc = Math.min(d * Math.sin(BARRIER.half) + T.radius, Math.max(0, r - d) + T.radius);
      const wu = fairWindup(w, b, esc, BARRIER.min, BARRIER.max);
      const L = leadPoint(w, b, wu, LEAD);
      const dir = Math.atan2(L.x - bx, L.z - bz) + (w.rng.boss() * 2 - 1) * 0.05;
      beginAttack(w, b, id, T.x, T.z);
      b.data.dir = dir;
      const tg = bossTelegraph(w, {
        style: 'cone', shape: { k: 'cone', x: bx, z: bz, dir, half: BARRIER.half, r },
        windup: wu, dmg: pkHit(w, BARRIER.dmg), kind: 'slam', tag: 'barrierSwing',
        onFire: (w2, tgf) => {
          const Tt = w2.titan;
          if (!tgf.hitTitan || !Tt.alive || Tt.dashT > 0) return;
          // knock along the sweep (the boom swings from dir − half to dir + half): the tangent at the titan
          const a = Math.atan2(Tt.x - bx, Tt.z - bz);
          shoveTitan(b, Math.cos(a), -Math.sin(a), BARRIER.knockH * Tt.height);
        },
      }, false);
      b.data.swingWu = tg.windup;
      break;
    }
    case 'towChain': {
      const bo = booth(b);
      const bx = bo.x, bz = bo.z;
      const lr = TOW.rH * H;
      const wu = fairWindup(w, b, lr + T.radius, TOW.min, TOW.max);
      const L = leadPoint(w, b, wu, LEAD);
      let fx = L.x - bx, fz = L.z - bz;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      const len = fl + TOW.pastH * H;
      const x1 = clamp(bx + fx * len, Bd.minX, Bd.maxX), z1 = clamp(bz + fz * len, Bd.minZ, Bd.maxZ);
      const segL = Math.hypot(x1 - bx, z1 - bz);
      const links = clamp(Math.round(segL / (TOW.linkH * H)), TOW.minLinks, TOW.maxLinks);
      const chain: number[] = [];
      for (let i = 0; i <= links; i++) { const k = i / links; chain.push(bx + (x1 - bx) * k, bz + (z1 - bz) * k); }
      beginAttack(w, b, id, x1, z1);
      b.data.dir = Math.atan2(fx, fz);
      b.data.towHooked = 0;
      const tg = bossTelegraph(w, {
        style: 'chain', shape: { k: 'capsule', x0: bx, z0: bz, x1, z1, r: lr }, chain,
        windup: wu, dmg: pkHit(w, TOW.dmg), kind: 'hook', tag: 'towChain',
        onFire: (w2, tgf) => {
          const Tt = w2.titan;
          if (!tgf.hitTitan || !Tt.alive || !b.alive || b.staggerT > 0 || Tt.dashT > 0) return;
          if ((w2.ult?.invulnT ?? 0) > 0) return;
          if (dist(Tt.x, Tt.z, b.x, b.z) <= keepOutM(w2) + TOW_CLEAR) return;   // already at the rig
          const an = booth(b);
          Tt.leash = { t: TOW.leashS, lx: an.x, lz: an.z, strength: TOW.pullH * bossH(w2, b) };
          b.data.tow = 1; b.data.leash = 1; b.data.towHooked = 1;
          w2.events.push({ type: 'leash', on: true, x: an.x, z: an.z });
        },
      }, false);
      b.data.towWu = tg.windup;
      break;
    }
    case 'deckDrop': {
      const r1 = RIG_R + DECK.rH * H, d = dist(b.x, b.z, T.x, T.z);
      const wu = fairWindup(w, b, Math.max(0, r1 - d) + T.radius, DECK.min, DECK.max);
      beginAttack(w, b, id, b.x, b.z);
      b.data.dir = b.heading;
      const tg = bossTelegraph(w, {
        style: 'ring', shape: { k: 'ring', x: b.x, z: b.z, r0: 0, r1 },
        windup: wu, dmg: pkHit(w, DECK.dmg), kind: 'stomp', tag: 'deckDrop',
        onFire: () => { if (b.alive) openTill(b, DECK_TILL_S); },
      }, false);
      b.data.deckWu = tg.windup;
      break;
    }
    case 'levelCollapse': {
      const rA = RIG_R + COLLAPSE.aH * H, rB = RIG_R + COLLAPSE.bH * H, rC = RIG_R + COLLAPSE.cH * H;
      const d = dist(b.x, b.z, T.x, T.z);
      const wu = fairWindup(w, b, Math.max(0, rA - d) + T.radius, COLLAPSE.min, COLLAPSE.max);
      beginAttack(w, b, id, b.x, b.z);
      b.data.dir = b.heading;
      const dmg = pkHit(w, COLLAPSE.dmg);
      bossTelegraph(w, { style: 'ring', shape: { k: 'ring', x: b.x, z: b.z, r0: 0, r1: rA }, windup: wu, dmg, kind: 'stomp', tag: 'levelCollapse:A' }, false);
      bossTelegraph(w, { style: 'ring', shape: { k: 'ring', x: b.x, z: b.z, r0: rA, r1: rB }, windup: wu + COLLAPSE.dtB, dmg, kind: 'stomp', tag: 'levelCollapse:B' }, false);
      const tc = bossTelegraph(w, { style: 'ring', shape: { k: 'ring', x: b.x, z: b.z, r0: rB, r1: rC }, windup: wu + COLLAPSE.dtC, dmg, kind: 'stomp', tag: 'levelCollapse:C' }, false);
      b.data.collapseEnd = tc.windup + COLLAPSE.recover;
      break;
    }
  }
}

function runAttack(w: World, b: BossState): void {
  const t = b.attackT, T = w.titan;
  const open = (b.data.tillOpen ?? 0) > 0;
  const faceT = Math.atan2(T.x - b.x, T.z - b.z);
  switch (b.attack) {
    case 'rampLaunch':
      turnBoss(b, faceT, AIM_TURN * (open ? 0.5 : 1), w.dt);
      if (t >= (b.data.rampEnd ?? 2)) endAttack(b, gapFor(w, b));
      break;
    case 'barrierSwing': {
      const wu = b.data.swingWu ?? 1.5;
      // the rig squares up to the swing; the boom itself is visual (bossview sweeps it through the cone)
      turnBoss(b, b.data.dir, AIM_TURN * (open ? 0.5 : 1), w.dt);
      if (t >= wu + BARRIER.recover) endAttack(b, gapFor(w, b));
      break;
    }
    case 'towChain': {
      const wu = b.data.towWu ?? 1.5;
      turnBoss(b, b.data.dir, AIM_TURN * (open ? 0.5 : 1), w.dt);
      if (t >= wu && b.data.tow > 0) {
        if (!T.leash) { b.data.tow = 0; b.data.leash = 0; endAttack(b, gapFor(w, b)); }
        else if (t >= wu + TOW.leashS + 0.2) { releaseTow(w, b); endAttack(b, gapFor(w, b)); }
      } else if (t >= wu + TOW.recover) endAttack(b, gapFor(w, b));
      break;
    }
    case 'deckDrop':
      turnBoss(b, faceT, TURN * (open ? 0.5 : 1), w.dt);
      if (t >= (b.data.deckWu ?? 1.2) + DECK.recover) endAttack(b, gapFor(w, b));
      break;
    case 'levelCollapse':
      if (t >= (b.data.collapseEnd ?? 2.5)) endAttack(b, gapFor(w, b));
      break;
    default:
      endAttack(b, 1);
  }
  b.data.attackIdx = ATTACKS.indexOf(b.attack as typeof ATTACKS[number]);
}

// ─────────────────────────────── tow ───────────────────────────────
function releaseTow(w: World, b: BossState): void {
  releaseLeash(w, b);
  b.data.tow = 0;
}

/** Keep the tow anchored on the booth; resisting fills JAM; the keep-out wall or an UPROAR snaps it. */
function tow(w: World, b: BossState, T: World['titan']): void {
  if (!(b.data.tow > 0)) return;
  if (!T.leash) { b.data.tow = 0; b.data.leash = 0; return; }
  for (let i = 0; i < w.events.length; i++) if (w.events[i].type === 'ultFire') { releaseTow(w, b); return; }
  if (dist(T.x, T.z, b.x, b.z) <= keepOutM(w) + TOW_CLEAR) { releaseTow(w, b); return; }
  const a = booth(b);
  T.leash.lx = a.x; T.leash.lz = a.z;
  const dx = T.x - a.x, dz = T.z - a.z, d = Math.hypot(dx, dz) || 1;
  const mx = w.input.mx, mz = w.input.mz, m = Math.hypot(mx, mz);
  if (T.moving && m > 0.1 && (mx * dx + mz * dz) / (m * d) > 0.3) addMeter(w, b, TOW.jamPerS * w.dt);
}

// ─────────────────────────────── dash answer ───────────────────────────────
/** Anti dash-spam (CAISSON-4's rule): a wheel clamp dropped just past the dash end. */
function dashAnswer(w: World, b: BossState): void {
  const e = watchDash(w, b, DASH_ANSWER.cd);
  if (!e) return;
  const T = w.titan, H = bossH(w, b), B = w.city.bounds;
  const r = DASH_ANSWER.rH * H, reach = r + T.radius;
  const dx = e.x1 - e.x0, dz = e.z1 - e.z0, dl = Math.hypot(dx, dz) || 1;
  const ahead = DASH_ANSWER.aheadR * reach;
  const x = clamp(e.x1 + (dx / dl) * ahead, B.minX, B.maxX), z = clamp(e.z1 + (dz / dl) * ahead, B.minZ, B.maxZ);
  const life = fairWindup(w, b, reach, DASH_ANSWER.min, DASH_ANSWER.max, 1);
  spawnProjectile(w, {
    owner: 'boss', kind: 'carLob', x, z, y: DASH_ANSWER.y, vx: 0, vz: 0,
    dmg: pkHit(w, DASH_ANSWER.dmg), lob: true, tx: x, tz: z, aoe: r, life,
  });
  b.data.followX = x; b.data.followZ = z;
}
