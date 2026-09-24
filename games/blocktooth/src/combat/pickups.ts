// BLOCKTOOTH — pickups: rubble / scrap (XP + size-mass), heal, chest (CONTRACT §5.3 / §3, combat lane).
// THREE-free, DOM-free, deterministic. The spawn burst direction comes from an integer hash of the
// pickup id + world seed (no RNG stream is consumed, so loot rolls never depend on scatter count).
//
// Lifecycle: spawn → short ballistic burst (lands in ~0.5 s) → rests → once inside the magnet radius
// (stats.pickupRadius × H + 2 m) it latches `magnet` and homes on the titan, accelerating up to at
// least 1.6 × the titan's max speed so it always catches up → collected at the titan's radius.

import type { Pickup, PickupKind, World } from '../core/types.ts';
import { CITY, RANKS } from '../core/config.ts';
import { clamp } from '../core/math.ts';
import { gainMass, gainXp, healTitan, titanMaxSpeed } from '../titans/titansim.ts';
import { stat } from '../upgrades/stats.ts';

// ─────────────────────────────── tuning (lane-local) ───────────────────────────────
/** Burst airtime (s): pickups land ~0.5 s after spawning. */
const AIR_S = 0.5;
/** Base gravity (m/s²) at scale 1; scaled with the titan so bursts read at every camera distance. */
const G0 = 24;
/** Pull speed floor as a multiple of the titan's max speed. */
const PULL_SPEED_MUL = 1.6;
/** Absolute pull-speed floor (m/s). */
const PULL_SPEED_MIN = 10;
/** Pull reaches full speed in ~1/PULL_ACCEL_RATE s. */
const PULL_ACCEL_RATE = 4;
/** Collect margin (m) beyond the titan's body radius. */
const COLLECT_PAD = 0.25;
/** Heal pickups restore this fraction of maxHp. */
const HEAL_FRAC = 0.1;
/** Merge search radius when over the cap (m, × scale). Falls back to the nearest mergeable anywhere. */
const MERGE_R = 12;
/** A pickup must be this old (s) before it can be collected (so the burst reads). */
const MIN_COLLECT_AGE = 0.1;

// ─────────────────────────────── per-world bookkeeping ───────────────────────────────
interface PickBook { alive: number; }
const books = new WeakMap<World, PickBook>();
function bookOf(w: World): PickBook {
  let b = books.get(w);
  if (!b) {
    let n = 0;
    for (let i = 0; i < w.pickups.length; i++) if (w.pickups[i].alive) n++;
    b = { alive: n };
    books.set(w, b);
  }
  return b;
}

/** Deterministic 0..1 hash of two ints (for cosmetic-but-simulated scatter). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Burst/merge scale from the titan's size (1 at Size I … 8 at Size V-ish). */
function scaleOf(w: World): number {
  return clamp(w.titan.height * 0.25, 1, 8);
}

const mergeable = (k: PickupKind): boolean => k === 'rubble' || k === 'scrap';

function mergeTarget(w: World, x: number, z: number): Pickup | null {
  const r = MERGE_R * scaleOf(w);
  let best: Pickup | null = null, bestD = Infinity;
  let near: Pickup | null = null, nearD = r * r;
  const ps = w.pickups;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.alive || !mergeable(p.kind)) continue;
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d <= nearD && (near === null || d < nearD || p.id < near.id)) { near = p; nearD = d; }
    if (d < bestD) { best = p; bestD = d; }
  }
  return near ?? best;
}

// ─────────────────────────────── contract exports ───────────────────────────────

/**
 * Spawn a pickup bursting outward from (x, z) (lands in ~0.5 s). Over CITY.maxPickups a rubble/scrap
 * pickup merges its xp/mass into the nearest existing rubble/scrap pickup instead (totals conserved);
 * heal/chest pickups always spawn.
 */
export function spawnPickup(w: World, kind: PickupKind, x: number, z: number, xp: number, mass: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const xpv = Number.isFinite(xp) && xp > 0 ? xp : 0;
  const mv = Number.isFinite(mass) && mass > 0 ? mass : 0;
  if (mergeable(kind) && xpv === 0 && mv === 0) return;
  const book = bookOf(w);
  if (book.alive >= CITY.maxPickups && mergeable(kind)) {
    const t = mergeTarget(w, x, z);
    if (t) { t.xp += xpv; t.mass += mv; return; }
  }
  const id = w.nextId++;   // same semantics as core/world.ts newId
  const s = scaleOf(w);
  // outward burst, biased away from the spawn point toward the titan so building rubble lands on the street
  const T = w.titan;
  const a = hash01(id, w.seed) * Math.PI * 2;
  let dx = Math.sin(a), dz = Math.cos(a);
  const tx = T.x - x, tz = T.z - z, td = Math.hypot(tx, tz);
  if (td > 1e-3) { dx += (tx / td) * 0.6; dz += (tz / td) * 0.6; }
  const dl = Math.hypot(dx, dz) || 1;
  const spd = (1.5 + 2.5 * hash01(id, w.seed ^ 0x51ed27)) * s;
  const vy = (G0 * s * AIR_S) / 2;
  const p: Pickup = {
    id, alive: true, kind,
    x, z, y: 0.05 * s,
    px: x, pz: z, py: 0.05 * s,
    vx: (dx / dl) * spd, vz: (dz / dl) * spd, vy,
    xp: xpv, mass: mv, t: 0, magnet: false,
  };
  w.pickups.push(p);
  book.alive++;
}

/** Magnet, homing, burst physics and collection. Called once per tick by stepWorld. */
export function stepPickups(w: World): void {
  const book = bookOf(w);
  const T = w.titan;
  const dt = w.dt;
  const ps = w.pickups;
  const s = scaleOf(w);
  const g = G0 * s;
  const H = T.height;
  const magnetR = Math.max(0, stat(w, 'pickupRadius')) * H + 2;
  const magnetR2 = magnetR * magnetR;
  const maxPull = Math.max(PULL_SPEED_MIN, PULL_SPEED_MUL * titanMaxSpeed(w));
  const collectR = T.radius + COLLECT_PAD;
  const carryY = H * 0.35;
  let alive = 0;
  const n = ps.length;
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    if (!p.alive) continue;
    p.t += dt;
    if (T.alive && !p.magnet) {
      const dx = T.x - p.x, dz = T.z - p.z;
      if (dx * dx + dz * dz <= magnetR2) p.magnet = true;
    }
    if (p.magnet && T.alive) {
      // homing: steer the whole velocity at the titan, speed ramps toward maxPull
      const dx = T.x - p.x, dz = T.z - p.z;
      const d = Math.hypot(dx, dz);
      const cur = Math.hypot(p.vx, p.vz);
      const sp = Math.min(maxPull, Math.max(cur, maxPull * 0.25) + maxPull * PULL_ACCEL_RATE * dt);
      if (d <= collectR || d <= sp * dt) {
        if (p.t >= MIN_COLLECT_AGE) { collect(w, p); continue; }
        p.vx = 0; p.vz = 0;
      } else {
        p.vx = (dx / d) * sp; p.vz = (dz / d) * sp;
        p.x += p.vx * dt; p.z += p.vz * dt;
      }
      // rise toward the titan's mouth height while flying in
      p.vy = (carryY - p.y) * Math.min(1, 6 * dt) / dt;
      p.y += p.vy * dt;
      if (p.y < 0) { p.y = 0; p.vy = 0; }
      if (T.alive) {
        const ex = T.x - p.x, ez = T.z - p.z;
        if (ex * ex + ez * ez <= collectR * collectR && p.t >= MIN_COLLECT_AGE) { collect(w, p); continue; }
      }
      alive++;
      continue;
    }
    // ballistic burst, then rest on the ground
    if (p.y > 0 || p.vy > 0) {
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vy -= g * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0; }
    } else if (p.vx !== 0 || p.vz !== 0) {
      p.vx = 0; p.vz = 0;
    }
    alive++;
  }
  for (let i = n; i < ps.length; i++) if (ps[i].alive) alive++;
  book.alive = alive;
}

function collect(w: World, p: Pickup): void {
  const T = w.titan;
  p.alive = false;
  switch (p.kind) {
    case 'rubble':
    case 'scrap': {
      if (p.xp > 0) gainXp(w, p.xp);
      if (p.mass > 0) gainMass(w, p.mass);
      const rh = stat(w, 'rubbleHeal');
      if (rh > 0) healTitan(w, rh * RANKS[T.rank].hpMul);
      break;
    }
    case 'heal':
      healTitan(w, HEAL_FRAC * T.maxHp);
      break;
    case 'chest':
      w.upgrades.chestDrafts++;
      w.events.push({ type: 'chest', x: p.x, z: p.z });
      // the "SUPPLY CRATE RECOVERED" banner (ALERTS.chest) — the only sim point that knows it was collected
      w.events.push({ type: 'alert', key: 'chest' });
      break;
  }
  w.events.push({ type: 'pickup', kind: p.kind, xp: p.xp, x: p.x, z: p.z });
}

/**
 * Latch `magnet` on every alive pickup within `radius` metres of the titan (Infinity = all).
 * Returns how many pickups were NEWLY magnetised by this call (safe to sum per tick).
 */
export function magnetAll(w: World, radius: number): number {
  const T = w.titan;
  const r2 = radius === Infinity ? Infinity : Math.max(0, radius) * Math.max(0, radius);
  let n = 0;
  const ps = w.pickups;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.alive || p.magnet) continue;
    const dx = p.x - T.x, dz = p.z - T.z;
    if (dx * dx + dz * dz <= r2) { p.magnet = true; n++; }
  }
  return n;
}
