// DYEFIELD — projectiles (CONTRACT §10.1 / §10.2 / §10.4). THREE-free, DOM-free, deterministic.
//
// ProjectilePool is struct-of-arrays with a fixed capacity: no per-shot allocation. Slots [0, count)
// are live; remove() swap-removes, so a slot's (px,py,pz) → (x,y,z) pair always belongs to one droplet
// and the view can draw slot i with the frame alpha.
//
// stepProjectiles advances every droplet one tick and SWEEPS its tick segment:
//   * vs the map: one Rapier raycast along the segment (nothing tunnels, whatever the speed);
//   * vs runners: segment–capsule distance against every living runner of another crew (vertical
//     capsule, HITBOX radius 0.42, 1.2 m tall; 0.5 m in slick form). Allies are passed through.
// The earliest contact wins. A map contact paints an impact (thin-wall-safe rule, §10.4); a runner
// contact deals damage (the host splats a puddle under the victim). In flight a droplet drips a small
// splat under itself every dripEvery s (raycast down).

import type { TeamId } from '../types.ts';
import type { PhysicsWorld } from '../physics.ts';
import type { Runner } from '../runner.ts';
import { COMBAT, HITBOX } from '../config.ts';

/** kind 0 = MIST-RASP droplet (phase 6 adds kinds) */
export const KIND_MIST = 0;

/** Per-kind flight + paint numbers (built from data/weapons.json by combat/kits.ts). */
export interface ProjectileKind {
  damage: number;
  straightTime: number;   // s of straight flight before gravity + drag
  gravity: number;        // m/s² after straightTime
  drag: number;           // 1/s horizontal decay after straightTime (maxRange is the asymptotic reach)
  impactRadius: number;
  dripEvery: number;      // s (0 = no drips)
  dripRadius: number;
  maxLife: number;        // s
}

export class ProjectilePool {
  readonly capacity: number;
  count = 0;
  /** spawns refused because the pool was full */
  dropped = 0;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly drip: Float32Array;
  readonly team: Uint8Array;
  readonly kind: Uint8Array;
  readonly owner: Int16Array;
  readonly seed: Uint32Array;

  constructor(capacity: number = COMBAT.poolCapacity) {
    const n = Math.max(1, capacity | 0);
    this.capacity = n;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.drip = new Float32Array(n);
    this.team = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.owner = new Int16Array(n);
    this.seed = new Uint32Array(n);
  }

  /** New droplet at (x, y, z) with velocity v. Returns its slot, or −1 when the pool is full. */
  spawn(kind: number, owner: number, team: TeamId, x: number, y: number, z: number,
    vx: number, vy: number, vz: number, seed: number, dripEvery: number): number {
    if (this.count >= this.capacity) { this.dropped++; return -1; }
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0;
    this.drip[i] = dripEvery > 0 ? dripEvery : 1e9;
    this.team[i] = team;
    this.kind[i] = kind;
    this.owner[i] = owner;
    this.seed[i] = seed >>> 0;
    return i;
  }

  /** Swap-remove slot i (the last live slot moves into i). */
  remove(i: number): void {
    const last = --this.count;
    if (i === last || i < 0 || i > last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.age[i] = this.age[last];
    this.drip[i] = this.drip[last];
    this.team[i] = this.team[last];
    this.kind[i] = this.kind[last];
    this.owner[i] = this.owner[last];
    this.seed[i] = this.seed[last];
  }

  clear(): void { this.count = 0; }
}

/** What the pool needs from the match (MatchWorld implements it). */
export interface ProjectileHost {
  readonly physics: PhysicsWorld;
  readonly runners: readonly Runner[];
  readonly killY: number;
  readonly kinds: readonly ProjectileKind[];
  /** paint one splat for `owner` (credits painted area + special; emits the 'splat' event); returns flips */
  paint(owner: number, team: TeamId, x: number, y: number, z: number, r: number,
    nx: number, ny: number, nz: number, minFacing: number, seed: number): number;
  /** a droplet of `owner` touched `victim` at (x, y, z) */
  hit(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number): void;
}

/** floor-ness threshold of an impact normal (maps.json scoring.floorMinNy on Pier 18) */
const FLOOR_NY = 0.45;

/**
 * Closest approach of segment P0 + t·S (t ∈ [0,1]) to the vertical segment A + u·(0,h,0) (u ∈ [0,1]).
 * Returns the entry parameter t where the segment first comes within r (≈, exact for perpendicular
 * approach), or −1 when it never does. Ericson, Real-Time Collision Detection §5.1.9.
 */
export function segVerticalCapsuleT(
  p0x: number, p0y: number, p0z: number, sx: number, sy: number, sz: number,
  ax: number, ay: number, az: number, h: number, r: number,
): number {
  // d1 = S, d2 = (0, h, 0), rr = P0 − A
  const rx = p0x - ax, ry = p0y - ay, rz = p0z - az;
  const a = sx * sx + sy * sy + sz * sz;      // |d1|²
  const e = h * h;                            // |d2|²
  const f = h * ry;                           // d2 · rr
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = sx * rx + sy * ry + sz * rz;    // d1 · rr
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = h * sy;                        // d1 · d2
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const qx = p0x + sx * s - ax, qy = p0y + sy * s - (ay + h * t), qz = p0z + sz * s - az;
  const d2 = qx * qx + qy * qy + qz * qz;
  if (d2 > r * r) return -1;
  if (a <= 1e-12) return 0;
  const back = Math.sqrt(Math.max(0, r * r - d2) / a);
  return Math.max(0, s - back);
}

/**
 * Impact paint that never bleeds through a thin wall (§10.4):
 *   floor / ramp hit → radius clamped to (distance to a wall ahead + wallClampPad);
 *   wall hit         → wall-facing texels only, plus a smaller floor splat pushed out along the
 *                       wall normal onto the near-side floor (only when the hit is low enough);
 *   ceiling hit      → plain splat with the hit normal.
 */
export function paintImpact(host: ProjectileHost, owner: number, team: TeamId,
  hx: number, hy: number, hz: number, nx: number, ny: number, nz: number,
  r: number, seed: number, dirx: number, dirz: number): void {
  const ph = host.physics;
  if (ny >= FLOOR_NY) {
    let rr = r;
    const dl = Math.hypot(dirx, dirz);
    if (dl > 1e-6) {
      const w = ph.raycast(hx, hy + 0.15, hz, dirx / dl, 0, dirz / dl, r * 1.2);
      if (w && Math.abs(w.ny) < 0.5) rr = Math.max(0.35, Math.min(r, w.toi + COMBAT.wallClampPad));
    }
    host.paint(owner, team, hx, hy, hz, rr, nx, ny, nz, -0.1, seed);
  } else if (ny <= -FLOOR_NY) {
    host.paint(owner, team, hx, hy, hz, r, nx, ny, nz, -0.1, seed);
  } else {
    host.paint(owner, team, hx, hy, hz, r, nx, ny, nz, COMBAT.wallMinFacing, seed);
    const hl = Math.hypot(nx, nz);
    if (hl > 1e-6) {
      const ox = hx + (nx / hl) * COMBAT.wallFloorPush, oz = hz + (nz / hl) * COMBAT.wallFloorPush;
      const g = ph.raycast(ox, hy, oz, 0, -1, 0, r * 1.5);
      if (g && g.ny >= FLOOR_NY) {
        host.paint(owner, team, g.x, g.y, g.z, r * COMBAT.wallFloorScale, 0, 1, 0, 0.35, (seed ^ 0x9e3779b9) >>> 0);
      }
    }
  }
}

/** Advance every live droplet one tick: integrate, sweep, collide, paint, drip, expire. */
export function stepProjectiles(pool: ProjectilePool, dt: number, host: ProjectileHost): void {
  const ph = host.physics;
  const runners = host.runners;
  const killY = host.killY;
  let i = 0;
  while (i < pool.count) {
    const k = host.kinds[pool.kind[i]] ?? host.kinds[0];
    const team = pool.team[i] as TeamId;
    const owner = pool.owner[i];
    const ox = pool.x[i], oy = pool.y[i], oz = pool.z[i];
    pool.px[i] = ox; pool.py[i] = oy; pool.pz[i] = oz;
    const age0 = pool.age[i];
    const age1 = age0 + dt;
    pool.age[i] = age1;

    // ── integrate: straight, then gravity + horizontal drag (only the part of the tick past straightTime)
    let vx = pool.vx[i], vy = pool.vy[i], vz = pool.vz[i];
    const vy0 = vy;
    const ballistic = age1 > k.straightTime ? Math.min(dt, age1 - k.straightTime) : 0;
    if (ballistic > 0) {
      vy -= k.gravity * ballistic;
      const dk = Math.exp(-k.drag * ballistic);
      vx *= dk; vz *= dk;
    }
    const nx = ox + vx * dt, ny = oy + 0.5 * (vy0 + vy) * dt, nz = oz + vz * dt;
    pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;

    // ── sweep the tick segment
    const sx = nx - ox, sy = ny - oy, sz = nz - oz;
    const len = Math.hypot(sx, sy, sz);
    let tMap = 2;
    let mapHit: ReturnType<PhysicsWorld['raycast']> = null;
    if (len > 1e-7) {
      mapHit = ph.raycast(ox, oy, oz, sx, sy, sz, len);
      if (mapHit) tMap = mapHit.toi / len;
    }
    let tHit = 2;
    let victim: Runner | null = null;
    for (let r = 0; r < runners.length; r++) {
      const v = runners[r];
      if (!v.alive || v.team === team || v.id === owner) continue;
      const h = v.hitHeight();
      const rad = Math.min(HITBOX.radius, h * 0.5);
      const t = segVerticalCapsuleT(ox, oy, oz, sx, sy, sz, v.x, v.y + rad, v.z, h - 2 * rad, rad);
      if (t >= 0 && t < tHit) { tHit = t; victim = v; }
    }

    if (victim && tHit <= tMap) {
      host.hit(victim, owner, k.damage, ox + sx * tHit, oy + sy * tHit, oz + sz * tHit);
      pool.remove(i);
      continue;
    }
    if (mapHit) {
      paintImpact(host, owner, team, mapHit.x, mapHit.y, mapHit.z, mapHit.nx, mapHit.ny, mapHit.nz,
        k.impactRadius, pool.seed[i], vx, vz);
      pool.remove(i);
      continue;
    }

    pool.x[i] = nx; pool.y[i] = ny; pool.z[i] = nz;

    // ── drips under the flight path
    if (k.dripEvery > 0) {
      let d = pool.drip[i] - dt;
      if (d <= 0) {
        d += k.dripEvery;
        const g = ph.raycast(nx, ny, nz, 0, -1, 0, COMBAT.dripMaxDrop);
        if (g) {
          const s = (pool.seed[i] + Math.round(age1 * 1000) * 2654435761) >>> 0;
          host.paint(owner, team, g.x, g.y, g.z, k.dripRadius, g.nx, g.ny, g.nz, -0.1, s);
        }
      }
      pool.drip[i] = d;
    }

    if (age1 > k.maxLife || ny < killY - 1) { pool.remove(i); continue; }
    i++;
  }
}
