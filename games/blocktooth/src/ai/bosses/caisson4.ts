// BLOCKTOOTH — CAISSON-4, the four-legged harbour crane-mech (ai lane, CONTRACT §10).
// THREE-free, DOM-free, deterministic (world.rng.boss only).
//
// Body: gantry body r18 · 4 legs r7 (STRAIN ×2.5) · boom r8 (hp ×0.5) · cab r6 (hp ×1.5).
// Footwork: keeps 60–120 m from the titan at 6 m/s (floor = the keep-out + 4 m, band widened to
//   match), always turning its boom toward it. KEEP-OUT (F10): the titan can never stand closer than
//   the rig footprint (41 m) + titan r + 12 m (≈ 78 m at Size V) — a hard wall (bosses/index.ts
//   pushTitanOut), so the crane never stands inside a Size V body. A winch reel lets go at the rig
//   footprint + titan r + 15 m (≈ 81 m) — the reel never drags the titan into the rig.
// Attacks (§10 shapes; damage and a few sizes re-tuned by the balance passes — see the tuning block):
//   P1  hookLane   lane boss→titan, len 170, w 26, 1.8 s, dmg 30 + knock
//       hookDrop   circle r 26 at the titan's lead point, 1.5 s, dmg 30 (the hook falls on a cable: a
//                  lobbed 'hookDrop' projectile dropped straight down, which paints its own circle)
//   P2+ hookDrop → TROLLEY RUN (PC-02: kiting at range was free — 0/604 drops landed): the trolley
//                  runs the hook down the titan's track, 3 (P3: 4) drops in a row along its
//                  velocity, the far one first; reversing or stopping no longer clears it — only
//                  stepping off the rail (≈ r + titan r sideways) or a dash does.
//   P2  + winchLeash  oval rx 40 / rz 30 around the titan, rotated toward the boss, 2.2 s; titan
//                  inside on fire → titan.leash 3 s pulling toward the boss at 12 m/s (`leash`);
//                  moving against the pull fills STRAIN 0.12/s. The oval TRACKS the titan's lead
//                  (sliding at ≤ 1.1 × its walk speed) until the last WINCH.lock s, then locks — a
//                  kiting titan has to read the lock and dash (PC-02).
//       + boomSweep  cone half 35°, r 110, 1.6 s, dmg 34
//   P2+ DASH FOLLOW (PC-02): when the titan dashes, the trolley runs the hook to where the dash ends
//                  and lets it fall (one lob, r 22, ≈ 1.2–1.4 s scaled to the titan's walk speed,
//                  at most every 6 s / P3 5 s) —
//                  a dash out of the paint is no longer a free reset; walk out, or keep a charge.
//   P3  + legStomp ring 0–64 m around the boss, 1.2 s, dmg 42, recovers in 0.5 s; cadence 30 % faster;
//                  hookLane fires twice back-to-back (the second re-aims after the first lands)
// Default subtitle "BREAK THE LEGS — BUILD STRAIN" (data/bosses.ts).

import type { BossState, Telegraph, World } from '../../core/types.ts';
import { circleInShape, clamp, dist, wrapAngle } from '../../core/math.ts';
import {
  addMeter, baseBoss, beginAttack, bossHostile, bossTelegraph, bossWindupMul, endAttack, entryPoint, introWalk,
  keepRange, leadPoint, localToWorld, makePart, pickWeighted, releaseLeash, repeatMul, shoveTitan, turnBoss,
} from './index.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';
import { titanSpeed } from '../../core/config.ts';
import { titanMaxSpeed } from '../../titans/titansim.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const WALK = 6, INTRO_WALK = 16, TURN = 0.7, AIM_TURN = 1.1;
const MIN_D = 60, MAX_D = 120;
/** Plan-view reach of the rig: the leg pads stand at (±24, ±24) with r 7 → 41 m from the gantry centre. */
const RIG_R = 41;
/** Gantry body collider radius (parts[0]). */
const BODY_R = 18;
/** Clear ground (m) kept between the rig footprint and the titan's circle when a reel lets go. */
const RIG_CLEAR = 15;
/** Hard keep-out clearance (m) between the rig footprint and the titan's circle (F10). A MOLO bite
 *  (0.9 H = 54 m) still reaches the near legs from the wall (≈ 52 m surface distance at Size V). */
const WALL_CLEAR = 12;
const GAP = [0, 2.6, 2.0, 1.9] as const;          // base seconds between attacks per phase (melee titans need a window to bite)
const P3_CADENCE = 0.7;                            // "cycle 30 % faster"

// Damage (PC-02): CAISSON-4's §10 numbers (hookLane 60 · hookDrop 50 · boom 55 · stomp 70) were set
// for a rig that almost never landed a hit — one hit took 60–150 % of a Size V titan (hookLane 60 →
// 972–1458 after BOSS_DMG_MUL × phase × hpMul 9), so the only outcomes were "untouched" or a coin-flip
// one-shot (the gate bot's CAISSON deaths were all a single hook). With trolley runs and dash
// follows landing 10–25 %, each hit is ≈ 25–55 % of a titan instead.
const HOOK_LANE = { len: 170, w: 26, windup: 1.8, dmg: 30, recover: 0.7, second: 0.3 };
const HOOK_DROP = { r: 26, windup: 1.5, dmg: 30, y: 70, recover: 0.6 };
const WINCH = { rx: 40, rz: 30, windup: 2.2, leashS: 3, pull: 12, strainPerS: 0.12, miss: 0.5, lock: [0, 0, 0.9, 0.8] as const, trackMul: 1.1 };
const BOOM = { half: (35 * Math.PI) / 180, r: 110, windup: 1.6, dmg: 34, recover: 0.8 };
const STOMP = { r: 64, windup: 1.2, dmg: 42, recover: 0.5 };
/** P2+ trolley run: drops per run by phase, spacing (× drop r) along the track, landing stagger (s). */
/** windup = base + walkK × (r + titan r) ÷ the titan's walk speed (× P3 mul): an attentive player
 *  can always WALK out of the landing shadow after the dash (slow HEARTHBACK gets longer than
 *  VOLT-KITE) — it punishes a reflex/periodic dash, not the titan's speed. */
const DASH_FOLLOW = { base: 0.52, walkK: 0.85, p3Mul: 0.92, cd: [0, 0, 6, 5] as const, r: 22, lagK: 0.25, dmg: 11 };
/** dmg: base per trolley drop. The lone P1 hook is HOOK_DROP.dmg (≈ 490 at Size V); trolley and dash-follow drops DO land now (the point of PC-02), so each is a bruise
 *  (≈ 260–340 at Size V, a quarter to a third of a titan), not a second health bar. */
const TROLLEY = { n: [0, 1, 3, 4] as const, spacingR: 1.5, stagger: 0.12, dmg: 14 };
/** Hook knock: shove speed (m/s) per metre of titan height, along the lane. */
const KNOCK_PER_H = 0.9;

const ATTACKS = ['hookLane', 'hookDrop', 'winchLeash', 'boomSweep', 'legStomp'] as const;

const TMP = { x: 0, z: 0 };
/** No single CAISSON-4 hit takes more than this share of the titan's max HP (a P3 hook lane is
 *  30 × 2 × 1.35 × 9 = 729 — more than a card-built 632-HP VOLT-KITE — so one lapse was a death). */
const HIT_CAP = 0.55;
function c4Hit(w: World, base: number): number {
  return Math.min(bossHostile(w, base), HIT_CAP * Math.max(1, w.titan.maxHp));
}

/** The live winch oval per boss (its shape slides while tracking; the view copies it every frame). */
const winchTell = new WeakMap<BossState, Telegraph>();

// ─────────────────────────────── module contract ───────────────────────────────
export function create(w: World): BossState {
  const E = { x: 0, z: 0, heading: 0 };
  entryPoint(w, w.city.flooded, E);   // LOCKWATER: wades in from the harbour (−Z) side
  const parts = [
    makePart('body', 0, 0, 18, 34, 62, 1, 0.3),
    makePart('legFL', 24, 24, 7, 0, 46, 1, 2.5),
    makePart('legFR', -24, 24, 7, 0, 46, 1, 2.5),
    makePart('legBL', 24, -24, 7, 0, 46, 1, 2.5),
    makePart('legBR', -24, -24, 7, 0, 46, 1, 2.5),
    makePart('boom', 0, 40, 8, 56, 75, 0.5, 0.3),
    makePart('cab', 0, 14, 6, 50, 64, 1.5, 0.5),
  ];
  const b = baseBoss('caisson4', E.x, E.z, E.heading, parts);
  b.data.hookX = b.x; b.data.hookZ = b.z;
  b.data.lanes = 0; b.data.dir = 0;
  return b;
}

/** Boom tip anchor (winch cable / hook origin), world XZ. */
function anchor(b: BossState): { x: number; z: number } {
  return localToWorld(b, 0, 44, TMP);
}

/**
 * Where a winch reel lets go (centre to centre): the whole rig footprint + the titan's circle + clear
 * ground (≈ 81 m for a Size V titan). The sim itself drags the titan here, so it must never drag it
 * into the rig (it used to reel it to within one titan radius of the boom tip — inside the gantry).
 */
function reelStop(w: World): number {
  return RIG_R + w.titan.radius + RIG_CLEAR;
}
/**
 * Idle footwork floor: gantry body + titan circle + clear ground (58–61 m at Size V, never below the
 * §10 60 m). Deliberately NOT the full reelStop: a rig that back-pedals from anything inside 81 m
 * turns every melee approach into a radial chase straight down its own HOOK LANE (probe: boss-fight
 * hook-lane hits 7 → 16 and 4–5 more deaths per 32 runs), and a MOLO bite (0.9 H = 54 m) must still
 * reach the legs for STRAIN — melee titans close in on purpose.
 */
function footworkMin(w: World): number {
  return Math.max(MIN_D, BODY_R + w.titan.radius + RIG_CLEAR, keepOut(w) + 4);
}

/** Hard keep-out, centre to centre (bosses/index.ts projects the titan back onto it every tick). */
function keepOut(w: World): number {
  return RIG_R + w.titan.radius + WALL_CLEAR;
}
/**
 * Each titan's nose, in titan heights ahead of its centre — measured from the real models
 * (titans/models.ts buildTitanModel(id).size.zMax: MOLO 1.11 · VOLT-KITE 0.75 · HEARTHBACK 0.80 ·
 * BRIARWICK 0.91). The collision circle is only 0.42 H, so a MOLO facing the rig from the body wall
 * still pushed its head through the front legs (F10).
 */
const NOSE_H: Record<string, number> = { molo: 1.11, voltkite: 0.75, hearthback: 0.8, briarwick: 0.91 };
/** Share of the nose kept out (the jaw tip may overhang the leg pads a little; the head may not). */
const NOSE_FRAC = 0.75;
/** Clear ground (m) between the rig footprint and the kept-out part of the nose. */
const NOSE_CLEAR = 4;
function noseOut(w: World): { reach: number; min: number } {
  const T = w.titan;
  return { reach: NOSE_FRAC * (NOSE_H[T.id] ?? 0.8) * T.height, min: RIG_R + NOSE_CLEAR };
}
export { keepOut, noseOut };

export function step(w: World, b: BossState): void {
  const T = w.titan;
  if (b.introT > 0) { introWalk(w, b, INTRO_WALK, MAX_D * 0.9); trackHook(b); return; }

  if (!b.attack) {
    const minD = footworkMin(w);
    keepRange(w, b, minD, Math.max(MAX_D, minD + 60), WALK, TURN);
    if (b.cd <= 0) decide(w, b);
  } else {
    b.data.speed = 0;
    runAttack(w, b);
  }
  trackHook(b);
  dashFollow(w, b);

  // winch: keep the leash anchored to the boom tip; resisting the pull builds STRAIN. The reel stops
  // (cable lets go) once the titan is hauled in to the keep-out distance — never into the rig.
  if (b.data.leash > 0) {
    if (!T.leash) b.data.leash = 0;
    else if (dist(T.x, T.z, b.x, b.z) <= reelStop(w)) releaseLeash(w, b);
    else {
      const a = anchor(b);
      T.leash.lx = a.x; T.leash.lz = a.z;
      const dx = T.x - a.x, dz = T.z - a.z, d = Math.hypot(dx, dz) || 1;
      const mx = w.input.mx, mz = w.input.mz, m = Math.hypot(mx, mz);
      if (T.moving && m > 0.1 && (mx * dx + mz * dz) / (m * d) > 0.3) addMeter(w, b, WINCH.strainPerS * w.dt);
    }
  }
}

export function onDamage(_w: World, b: BossState, part: number, _dmg: number): void {
  // legs record recent hits so the view can buckle the struck leg
  const p = b.parts[part];
  if (p && p.name.startsWith('leg')) b.data['hit_' + p.name] = b.data.t;
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
    1.0,                                            // hookLane
    d < keepOut(w) + 20 ? 1.4 : 1.0,                // hookDrop (punishes hugging the legs)
    P >= 2 ? (d > 130 ? 2.0 : d > 80 ? 1.0 : 0.45) : 0,   // winchLeash (reels a kiting titan in — the tracking oval is the one
                                                    //   tell a 60 m/s kiter can't simply outrun; inside reelStop it paints but does not catch)
    P >= 2 ? (d < BOOM.r + 10 ? 1.1 : 0.2) : 0,     // boomSweep
    P >= 3 ? (d < STOMP.r + T.radius + 25 ? 1.2 : 0) : 0,   // legStomp (anti-melee; not every beat, or melee titans never land a bite)
  ];
  for (let i = 0; i < wts.length; i++) wts[i] *= repeatMul(b, ATTACKS[i]);
  const id = pickWeighted(w, ATTACKS, wts) ?? 'hookLane';
  startAttack(w, b, id);
}

const LEAD = { x: 0, z: 0 };
function aimAtTitan(w: World, b: BossState, jitter: number, windup: number): number {
  // aim (from the gantry centre, where lanes/cones are anchored) at where the titan is heading
  // (leadPoint: a phase-scaled fraction of the windup ahead) with a small latched jitter; the
  // paint is on the ground for the whole windup, so the tell stays honest
  const L = leadPoint(w, b, windup, LEAD);
  return Math.atan2(L.x - b.x, L.z - b.z) + (w.rng.boss() * 2 - 1) * jitter;
}

function castHookLane(w: World, b: BossState): void {
  const dir = aimAtTitan(w, b, 0.035, HOOK_LANE.windup);
  b.data.dir = dir;
  const x = b.x, z = b.z;
  bossTelegraph(w, {
    style: 'lane', shape: { k: 'lane', x, z, dir, len: HOOK_LANE.len, w: HOOK_LANE.w },
    windup: HOOK_LANE.windup, dmg: c4Hit(w, HOOK_LANE.dmg), kind: 'hook', tag: 'hookLane',
    onFire: (w2, tg) => {
      const T = w2.titan;
      if (tg.hitTitan && T.alive && T.dashT <= 0) shoveTitan(b, Math.sin(dir), Math.cos(dir), KNOCK_PER_H * T.height);
    },
  });
  b.data.lanes = (b.data.lanes ?? 0) + 1;
  b.data.laneAt = b.attackT;
}

function startAttack(w: World, b: BossState, id: string): void {
  const T = w.titan;
  switch (id) {
    case 'hookLane': {
      beginAttack(w, b, id, T.x, T.z);
      b.data.lanes = 0;
      castHookLane(w, b);
      break;
    }
    case 'hookDrop': {
      const j = 6 * Math.sqrt(w.rng.boss()), a = w.rng.boss() * Math.PI * 2;
      const L = leadPoint(w, b, HOOK_DROP.windup, LEAD);
      const T0 = w.titan;
      // track direction: the titan's velocity; standing still → the line runs toward the boss
      let fx = T0.vx || 0, fz = T0.vz || 0;
      let fl = Math.hypot(fx, fz);
      const moving = fl > 0.25 * Math.max(1, titanSpeed(T0.height));
      if (!moving) { fx = b.x - T0.x; fz = b.z - T0.z; fl = Math.hypot(fx, fz); }
      if (fl > 1e-3) { fx /= fl; fz /= fl; } else { fx = Math.sin(a); fz = Math.cos(a); }
      const drops = TROLLEY.n[b.phase] ?? 1;
      // P1: one hook on the lead point. P2+: the run is centred between the titan and its lead
      // point, so it covers where it is AND where it is going (a stop or a U-turn is still inside).
      const cx = drops > 1 ? (T0.x + L.x) / 2 : L.x, cz = drops > 1 ? (T0.z + L.z) / 2 : L.z;
      const tx = cx + Math.sin(a) * j, tz = cz + Math.cos(a) * j;
      beginAttack(w, b, id, tx, tz);
      b.data.tx = tx; b.data.tz = tz;
      b.data.dir = Math.atan2(tx - b.x, tz - b.z);
      const sp = HOOK_DROP.r * TROLLEY.spacingR;
      const wm = bossWindupMul(b);
      for (let k = 0; k < drops; k++) {
        // far end (ahead of the titan) lands first; the shadows fall back toward it
        const o = (drops - 1) / 2 - k;
        const hx = tx + fx * o * sp, hz = tz + fz * o * sp;
        spawnProjectile(w, {
          owner: 'boss', kind: 'hookDrop', x: hx, z: hz, y: HOOK_DROP.y, vx: 0, vz: 0,
          dmg: c4Hit(w, drops > 1 ? TROLLEY.dmg : HOOK_DROP.dmg), lob: true, tx: hx, tz: hz, aoe: HOOK_DROP.r,
          life: HOOK_DROP.windup * wm + k * TROLLEY.stagger,
        });
      }
      b.data.drops = drops;
      break;
    }
    case 'winchLeash': {
      const L = leadPoint(w, b, WINCH.windup, LEAD, 0.5);   // half lead: the oval is big and slow
      const ox = L.x, oz = L.z;
      const rot = Math.atan2(b.x - ox, b.z - oz);   // oval's local +Z points at the boss
      beginAttack(w, b, id, ox, oz);
      b.data.dir = wrapAngle(rot + Math.PI);
      b.data.hooked = 0;
      const tell = bossTelegraph(w, {
        style: 'oval', shape: { k: 'oval', x: ox, z: oz, rx: WINCH.rx, rz: WINCH.rz, rot },
        windup: WINCH.windup, dmg: 0, kind: 'hook', tag: 'winch',
        onFire: (w2, tg) => {
          const Tt = w2.titan;
          if (!Tt.alive || !b.alive || b.staggerT > 0 || Tt.dashT > 0) return;
          if (!circleInShape(tg.shape, Tt.x, Tt.z, Tt.radius * 0.5)) return;
          if (dist(Tt.x, Tt.z, b.x, b.z) <= reelStop(w2) + 8) return;   // already at the rig: nothing to reel
          const a = anchor(b);
          Tt.leash = { t: WINCH.leashS, lx: a.x, lz: a.z, strength: WINCH.pull };
          b.data.leash = 1; b.data.hooked = 1;
          w2.events.push({ type: 'leash', on: true, x: a.x, z: a.z });
        },
      });
      winchTell.set(b, tell);
      break;
    }
    case 'boomSweep': {
      const dir = aimAtTitan(w, b, 0.05, BOOM.windup);
      beginAttack(w, b, id, T.x, T.z);
      b.data.dir = dir;
      bossTelegraph(w, {
        style: 'cone', shape: { k: 'cone', x: b.x, z: b.z, dir, half: BOOM.half, r: BOOM.r },
        windup: BOOM.windup, dmg: c4Hit(w, BOOM.dmg), kind: 'slam', tag: 'boomSweep',
      });
      break;
    }
    case 'legStomp': {
      beginAttack(w, b, id, b.x, b.z);
      b.data.dir = b.heading;
      bossTelegraph(w, {
        style: 'ring', shape: { k: 'ring', x: b.x, z: b.z, r0: 0, r1: STOMP.r },
        windup: STOMP.windup, dmg: c4Hit(w, STOMP.dmg), kind: 'stomp', tag: 'legStomp',
      });
      break;
    }
  }
}

function runAttack(w: World, b: BossState): void {
  const t = b.attackT;
  switch (b.attack) {
    case 'hookLane': {
      turnBoss(b, b.data.dir, AIM_TURN, w.dt);
      const want = b.phase === 3 ? 2 : 1;
      const lastAt = b.data.laneAt ?? 0;
      if (b.data.lanes < want && t >= lastAt + HOOK_LANE.windup + HOOK_LANE.second) castHookLane(w, b);
      if (b.data.lanes >= want && t >= lastAt + HOOK_LANE.windup + HOOK_LANE.recover) endAttack(b, gapFor(w, b));
      break;
    }
    case 'hookDrop':
      turnBoss(b, b.data.dir, AIM_TURN, w.dt);
      if (t >= HOOK_DROP.windup * bossWindupMul(b) + ((b.data.drops ?? 1) - 1) * TROLLEY.stagger + HOOK_DROP.recover) endAttack(b, gapFor(w, b));
      break;
    case 'winchLeash': {
      turnBoss(b, b.data.dir, AIM_TURN, w.dt);
      const T = w.titan;
      trackWinch(w, b);
      if (t >= WINCH.windup && b.data.leash > 0) {
        // reel phase: face the catch, hold until the cable runs out
        b.data.dir = Math.atan2(T.x - b.x, T.z - b.z);
        if (!T.leash) { b.data.leash = 0; endAttack(b, gapFor(w, b)); }
        else if (t >= WINCH.windup + WINCH.leashS + 0.2) { releaseLeash(w, b); endAttack(b, gapFor(w, b)); }
      } else if (t >= WINCH.windup && b.data.hooked > 0) endAttack(b, gapFor(w, b));   // reel already let go (reached reelStop)
      else if (t >= WINCH.windup + WINCH.miss && !(b.data.hooked > 0)) endAttack(b, gapFor(w, b));
      break;
    }
    case 'boomSweep':
      // the boom swings through the painted cone as it fires
      if (t < BOOM.windup) turnBoss(b, b.data.dir - BOOM.half * 0.8, AIM_TURN, w.dt);
      else turnBoss(b, b.data.dir + BOOM.half, 2.4, w.dt);
      if (t >= BOOM.windup + BOOM.recover) endAttack(b, gapFor(w, b));
      break;
    case 'legStomp':
      if (t >= STOMP.windup + STOMP.recover) endAttack(b, gapFor(w, b));
      break;
    default:
      endAttack(b, 1);
  }
  b.data.attackIdx = ATTACKS.indexOf(b.attack as typeof ATTACKS[number]);
}

/** P2+: a titan dash is answered by a hook dropped on the dash's end point (see header). */
function dashFollow(w: World, b: BossState): void {
  if (b.phase < 2 || b.staggerT > 0 || !w.titan.alive) return;
  if (w.t < (b.data.followAt ?? 0)) return;
  for (let i = 0; i < w.events.length; i++) {
    const e = w.events[i];
    if (e.type !== 'dash') continue;
    const B = w.city.bounds;
    // the trolley lags the dash a little: the shadow is centred lagK × (r + titan r) short of the
    // dash end, so carrying the dash's momentum out the far side is the natural escape
    const dx = e.x1 - e.x0, dz = e.z1 - e.z0, dl = Math.hypot(dx, dz) || 1;
    const lag = Math.min(dl, DASH_FOLLOW.lagK * (DASH_FOLLOW.r + w.titan.radius));
    const x = clamp(e.x1 - (dx / dl) * lag, B.minX, B.maxX), z = clamp(e.z1 - (dz / dl) * lag, B.minZ, B.maxZ);
    spawnProjectile(w, {
      owner: 'boss', kind: 'hookDrop', x, z, y: HOOK_DROP.y, vx: 0, vz: 0,
      dmg: c4Hit(w, DASH_FOLLOW.dmg), lob: true, tx: x, tz: z, aoe: DASH_FOLLOW.r,
      life: (DASH_FOLLOW.base + DASH_FOLLOW.walkK * (DASH_FOLLOW.r + w.titan.radius) / Math.max(1, titanMaxSpeed(w)))
        * (b.phase >= 3 ? DASH_FOLLOW.p3Mul : 1),
    });
    b.data.followAt = w.t + (DASH_FOLLOW.cd[b.phase] ?? 5);
    b.data.followX = x; b.data.followZ = z;
    return;
  }
}

/** Slide the painted winch oval after the titan's (half) lead until it locks for the last WINCH.lock s. */
function trackWinch(w: World, b: BossState): void {
  const tg = winchTell.get(b);
  if (!tg || !tg.alive || tg.fired) return;
  const s = tg.shape;
  if (s.k !== 'oval') return;
  const lock = WINCH.lock[b.phase] ?? 0.9;
  if (tg.t >= tg.windup - lock) return;
  const L = leadPoint(w, b, tg.windup - tg.t, LEAD, 0.5);
  const dx = L.x - s.x, dz = L.z - s.z, d = Math.hypot(dx, dz);
  const step = WINCH.trackMul * titanSpeed(w.titan.height) * w.dt;
  if (d > 1e-6) { const k = Math.min(1, step / d); s.x += dx * k; s.z += dz * k; }
  s.rot = Math.atan2(b.x - s.x, b.z - s.z);
  b.data.dir = wrapAngle(s.rot + Math.PI);
}

/** Hook/trolley position the view hangs the cable from (lags toward the active target). */
function trackHook(b: BossState): void {
  const a = localToWorld(b, 0, 44, TMP);
  let tx = a.x, tz = a.z;
  if (b.attack === 'hookDrop') { tx = b.data.tx; tz = b.data.tz; }
  const k = 0.12;
  b.data.hookX = Number.isFinite(b.data.hookX) ? b.data.hookX + (tx - b.data.hookX) * k : tx;
  b.data.hookZ = Number.isFinite(b.data.hookZ) ? b.data.hookZ + (tz - b.data.hookZ) * k : tz;
  b.data.hookX = clamp(b.data.hookX, -1e5, 1e5);
  b.data.hookZ = clamp(b.data.hookZ, -1e5, 1e5);
}
