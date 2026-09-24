// BLOCKTOOTH — CAISSON-4, the four-legged harbour crane-mech (ai lane, CONTRACT §10).
// THREE-free, DOM-free, deterministic (world.rng.boss only).
//
// Body: gantry body r18 · 4 legs r7 (STRAIN ×2.5) · boom r8 (hp ×0.5) · cab r6 (hp ×1.5).
// Footwork: keeps 60–120 m from the titan at 6 m/s, always turning its boom toward it.
// Attacks (EXACT per phase, §10):
//   P1  hookLane   lane boss→titan, len 160, w 14, 1.8 s, dmg 60 + knock
//       hookDrop   circle r 16 at the titan, 1.5 s, dmg 50 (the hook falls on a cable: a lobbed
//                  'hookDrop' projectile dropped straight down, which paints its own circle)
//   P2  + winchLeash  oval rx 26 / rz 18 around the titan, rotated toward the boss, 2.2 s; titan
//                  inside on fire → titan.leash 3 s pulling toward the boss at 12 m/s (`leash`);
//                  moving against the pull fills STRAIN 0.12/s
//       + boomSweep  cone half 35°, r 110, 1.6 s, dmg 55
//   P3  + legStomp ring 0–50 m around the boss, 1.2 s, dmg 70; cadence 30 % faster;
//                  hookLane fires twice back-to-back (the second re-aims after the first lands)
// Default subtitle "BREAK THE LEGS — BUILD STRAIN" (data/bosses.ts).

import type { BossState, World } from '../../core/types.ts';
import { circleInShape, clamp, dist, wrapAngle } from '../../core/math.ts';
import {
  addMeter, baseBoss, beginAttack, bossHostile, bossTelegraph, bossWindupMul, endAttack, entryPoint, introWalk,
  keepRange, leadPoint, localToWorld, makePart, pickWeighted, releaseLeash, repeatMul, shoveTitan, turnBoss,
} from './index.ts';
import { spawnProjectile } from '../../combat/projectiles.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const WALK = 6, INTRO_WALK = 16, TURN = 0.7, AIM_TURN = 1.1;
const MIN_D = 60, MAX_D = 120;
const GAP = [0, 2.4, 1.4, 1.2] as const;          // base seconds between attacks per phase
const P3_CADENCE = 0.7;                            // "cycle 30 % faster"

const HOOK_LANE = { len: 170, w: 26, windup: 1.8, dmg: 60, recover: 0.7, second: 0.3 };
const HOOK_DROP = { r: 26, windup: 1.5, dmg: 50, y: 70, recover: 0.6 };
const WINCH = { rx: 40, rz: 30, windup: 2.2, leashS: 3, pull: 12, strainPerS: 0.12, miss: 0.5 };
const BOOM = { half: (35 * Math.PI) / 180, r: 110, windup: 1.6, dmg: 55, recover: 0.8 };
const STOMP = { r: 64, windup: 1.2, dmg: 70, recover: 0.8 };
/** Hook knock: shove speed (m/s) per metre of titan height, along the lane. */
const KNOCK_PER_H = 0.9;

const ATTACKS = ['hookLane', 'hookDrop', 'winchLeash', 'boomSweep', 'legStomp'] as const;

const TMP = { x: 0, z: 0 };

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

export function step(w: World, b: BossState): void {
  const T = w.titan;
  if (b.introT > 0) { introWalk(w, b, INTRO_WALK, MAX_D * 0.9); trackHook(b); return; }

  if (!b.attack) {
    keepRange(w, b, MIN_D, MAX_D, WALK, TURN);
    if (b.cd <= 0) decide(w, b);
  } else {
    b.data.speed = 0;
    runAttack(w, b);
  }
  trackHook(b);

  // winch: keep the leash anchored to the boom tip; resisting the pull builds STRAIN
  if (b.data.leash > 0) {
    if (!T.leash) b.data.leash = 0;
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
    d < 75 ? 1.4 : 1.0,                             // hookDrop (punishes hugging the legs)
    P >= 2 ? (d > 80 ? 1.0 : 0.45) : 0,             // winchLeash (reels a kiting titan in)
    P >= 2 ? (d < BOOM.r + 10 ? 1.1 : 0.2) : 0,     // boomSweep
    P >= 3 ? (d < STOMP.r + T.radius + 25 ? 1.8 : 0) : 0,   // legStomp (anti-melee)
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
    windup: HOOK_LANE.windup, dmg: bossHostile(w, HOOK_LANE.dmg), kind: 'hook', tag: 'hookLane',
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
      const tx = L.x + Math.sin(a) * j, tz = L.z + Math.cos(a) * j;
      beginAttack(w, b, id, tx, tz);
      b.data.tx = tx; b.data.tz = tz;
      b.data.dir = Math.atan2(tx - b.x, tz - b.z);
      // the hook plummets straight down onto the spot (lob with zero ground travel); from phase 2
      // the trolley also drops its two counterweights on either side of the titan's path, so a
      // pure sidestep is no longer free (all three shadows are painted for the full windup)
      const drops = b.phase >= 2 ? 3 : 1;
      const T0 = w.titan;
      let px = -(T0.vz || 0), pz = T0.vx || 0;
      const pl = Math.hypot(px, pz);
      if (pl > 1e-3) { px /= pl; pz /= pl; } else { px = Math.cos(a); pz = -Math.sin(a); }
      const side = HOOK_DROP.r * 2.1 + T0.radius * 0.6;
      for (let k = 0; k < drops; k++) {
        const o = k === 0 ? 0 : (k === 1 ? side : -side);
        const hx = tx + px * o, hz = tz + pz * o;
        spawnProjectile(w, {
          owner: 'boss', kind: 'hookDrop', x: hx, z: hz, y: HOOK_DROP.y, vx: 0, vz: 0,
          dmg: bossHostile(w, HOOK_DROP.dmg), lob: true, tx: hx, tz: hz, aoe: HOOK_DROP.r, life: HOOK_DROP.windup * bossWindupMul(b) + k * 0.12,
        });
      }
      break;
    }
    case 'winchLeash': {
      const L = leadPoint(w, b, WINCH.windup, LEAD, 0.5);   // half lead: the oval is big and slow
      const ox = L.x, oz = L.z;
      const rot = Math.atan2(b.x - ox, b.z - oz);   // oval's local +Z points at the boss
      beginAttack(w, b, id, ox, oz);
      b.data.dir = wrapAngle(rot + Math.PI);
      b.data.hooked = 0;
      bossTelegraph(w, {
        style: 'oval', shape: { k: 'oval', x: ox, z: oz, rx: WINCH.rx, rz: WINCH.rz, rot },
        windup: WINCH.windup, dmg: 0, kind: 'hook', tag: 'winch',
        onFire: (w2, tg) => {
          const Tt = w2.titan;
          if (!Tt.alive || !b.alive || b.staggerT > 0 || Tt.dashT > 0) return;
          if (!circleInShape(tg.shape, Tt.x, Tt.z, Tt.radius * 0.5)) return;
          const a = anchor(b);
          Tt.leash = { t: WINCH.leashS, lx: a.x, lz: a.z, strength: WINCH.pull };
          b.data.leash = 1; b.data.hooked = 1;
          w2.events.push({ type: 'leash', on: true, x: a.x, z: a.z });
        },
      });
      break;
    }
    case 'boomSweep': {
      const dir = aimAtTitan(w, b, 0.05, BOOM.windup);
      beginAttack(w, b, id, T.x, T.z);
      b.data.dir = dir;
      bossTelegraph(w, {
        style: 'cone', shape: { k: 'cone', x: b.x, z: b.z, dir, half: BOOM.half, r: BOOM.r },
        windup: BOOM.windup, dmg: bossHostile(w, BOOM.dmg), kind: 'slam', tag: 'boomSweep',
      });
      break;
    }
    case 'legStomp': {
      beginAttack(w, b, id, b.x, b.z);
      b.data.dir = b.heading;
      bossTelegraph(w, {
        style: 'ring', shape: { k: 'ring', x: b.x, z: b.z, r0: 0, r1: STOMP.r },
        windup: STOMP.windup, dmg: bossHostile(w, STOMP.dmg), kind: 'stomp', tag: 'legStomp',
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
      if (t >= HOOK_DROP.windup + HOOK_DROP.recover) endAttack(b, gapFor(w, b));
      break;
    case 'winchLeash': {
      turnBoss(b, b.data.dir, AIM_TURN, w.dt);
      const T = w.titan;
      if (t >= WINCH.windup && b.data.leash > 0) {
        // reel phase: face the catch, hold until the cable runs out
        b.data.dir = Math.atan2(T.x - b.x, T.z - b.z);
        if (!T.leash) { b.data.leash = 0; endAttack(b, gapFor(w, b)); }
        else if (t >= WINCH.windup + WINCH.leashS + 0.2) { releaseLeash(w, b); endAttack(b, gapFor(w, b)); }
      } else if (t >= WINCH.windup + WINCH.miss && !(b.data.hooked > 0)) endAttack(b, gapFor(w, b));
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
