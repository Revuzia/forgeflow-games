// DYEFIELD — projectiles (CONTRACT §10.1 / §10.2 / §10.4 + CHANGED(KITSIM)). THREE-free, DOM-free, deterministic.
//
// ProjectilePool is struct-of-arrays with a fixed capacity: no per-shot allocation. Slots [0, count)
// are live; remove() swap-removes, so a slot's (px,py,pz) → (x,y,z) pair always belongs to one droplet
// and the view can draw slot i with the frame alpha.
//
// stepProjectiles advances every FLYING slot one tick and SWEEPS its tick segment:
//   * vs the map: one Rapier raycast along the segment (nothing tunnels, whatever the speed);
//   * vs runners: segment–capsule distance against every living runner of another crew (vertical
//     capsule, HITBOX radius 0.42, 1.2 m tall; 0.5 m in slick form). Allies are passed through.
// The earliest contact wins. Per ProjectileKind.mode:
//   0 droplet (MIST-RASP, SHEET-DRUM flick): a map contact paints an impact (thin-wall-safe rule, §10.4); a
//     runner contact deals damage (lerp damage → damageFar over falloffRange of horizontal travel when set).
//     In flight a droplet drips a small splat under itself every dripEvery s (raycast down).
//   1 burst (POP-WELL): explodes on a runner, on the map, or once it has travelled airburstRange → host.burst.
//   2 lander (JELLY CHARGE, CLOUDBURST cell): ignores runners; the first map contact → host.land, which turns the
//     slot into a resting one (state PUDDLE / HOVER) that the host ticks itself; lost to the sea → host.lost.

import type { TeamId } from '../types.ts';
import type { CastHit, PhysicsWorld } from '../physics.ts';
import type { Runner } from '../runner.ts';
import { COMBAT, HITBOX } from '../config.ts';

/** pool.kind — the view-visible projectile type */
export const KIND_MIST = 0;
export const KIND_FLICK = 1;
export const KIND_BURST = 2;
export const KIND_JELLY = 3;
export const KIND_CLOUD = 4;

/** pool.state */
export const PSTATE_FLY = 0;
export const PSTATE_PUDDLE = 1;
export const PSTATE_HOVER = 2;

/** ProjectileKind.mode */
export const MODE_DROPLET = 0;
export const MODE_BURST = 1;
export const MODE_LANDER = 2;

/** Per-variant flight + paint numbers (built from data/weapons.json by combat/kits.ts / combat/defs.ts). */
export interface ProjectileKind {
  damage: number;
  straightTime: number;   // s of straight flight before gravity + drag
  gravity: number;        // m/s² after straightTime
  drag: number;           // 1/s horizontal decay after straightTime (maxRange is the asymptotic reach)
  impactRadius: number;
  dripEvery: number;      // s (0 = no drips)
  dripRadius: number;
  maxLife: number;        // s
  /** MODE_DROPLET (default) | MODE_BURST | MODE_LANDER */
  mode?: number;
  /** droplet: damage at falloffRange m of horizontal travel (linear from `damage`) */
  damageFar?: number;
  falloffRange?: number;
  /** burst: explode once this far (3-D) from the launch point; 0 / undefined = never */
  airburstRange?: number;
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
  // ── CHANGED(KITSIM) ──
  /** index into the host's ProjectileKind table (per kit); the view reads `kind` */
  readonly variant: Uint8Array;
  /** PSTATE_FLY | PSTATE_PUDDLE (jelly resting) | PSTATE_HOVER (CLOUDBURST cell rising / raining) */
  readonly state: Uint8Array;
  /** resting slots: s left (jelly fuse; CLOUDBURST rise + rain) */
  readonly timer: Float32Array;
  /** flying: the launch point · CLOUDBURST cell: the hover point */
  readonly ox: Float32Array; readonly oy: Float32Array; readonly oz: Float32Array;
  /** jelly puddle: the normal of the surface it rests on */
  readonly nx: Float32Array; readonly ny: Float32Array; readonly nz: Float32Array;

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
    this.variant = new Uint8Array(n);
    this.state = new Uint8Array(n);
    this.timer = new Float32Array(n);
    this.ox = new Float32Array(n); this.oy = new Float32Array(n); this.oz = new Float32Array(n);
    this.nx = new Float32Array(n); this.ny = new Float32Array(n); this.nz = new Float32Array(n);
  }

  /**
   * New projectile at (x, y, z) with velocity v. `variant` indexes the host's ProjectileKind table
   * (default = kind). Returns its slot, or −1 when the pool is full.
   */
  spawn(kind: number, owner: number, team: TeamId, x: number, y: number, z: number,
    vx: number, vy: number, vz: number, seed: number, dripEvery: number, variant: number = kind): number {
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
    this.variant[i] = variant;
    this.state[i] = PSTATE_FLY;
    this.timer[i] = 0;
    this.ox[i] = x; this.oy[i] = y; this.oz[i] = z;
    this.nx[i] = 0; this.ny[i] = 1; this.nz[i] = 0;
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
    this.variant[i] = this.variant[last];
    this.state[i] = this.state[last];
    this.timer[i] = this.timer[last];
    this.ox[i] = this.ox[last]; this.oy[i] = this.oy[last]; this.oz[i] = this.oz[last];
    this.nx[i] = this.nx[last]; this.ny[i] = this.ny[last]; this.nz[i] = this.nz[last];
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
  // ── CHANGED(KITSIM): optional so a droplet-only host still compiles ──
  /** a MODE_BURST slot explodes at (x, y, z): on `victim` (direct hit), on the map (normal n), or in the air */
  burst?(slot: number, x: number, y: number, z: number, victim: Runner | null,
    nx: number, ny: number, nz: number, air: boolean): void;
  /** a MODE_LANDER slot touched the map; returns true when the slot now rests (kept), false = remove it */
  land?(slot: number, hit: CastHit): boolean;
  /** a MODE_LANDER slot expired or fell into the sea before landing (it is removed right after) */
  lost?(slot: number): void;
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
export function paintImpact(host: Pick<ProjectileHost, 'physics' | 'paint'>, owner: number, team: TeamId,
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

/** Advance every FLYING slot one tick: integrate, sweep, collide, paint, drip, explode, land, expire. */
export function stepProjectiles(pool: ProjectilePool, dt: number, host: ProjectileHost): void {
  const ph = host.physics;
  const runners = host.runners;
  const killY = host.killY;
  let i = 0;
  while (i < pool.count) {
    if (pool.state[i] !== PSTATE_FLY) { i++; continue; }      // resting: the host ticks puddles / cells (and their px)
    const ox = pool.x[i], oy = pool.y[i], oz = pool.z[i];
    pool.px[i] = ox; pool.py[i] = oy; pool.pz[i] = oz;
    const k = host.kinds[pool.variant[i]] ?? host.kinds[pool.kind[i]] ?? host.kinds[0];
    const mode = k.mode ?? MODE_DROPLET;
    const team = pool.team[i] as TeamId;
    const owner = pool.owner[i];
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
    let mapHit: CastHit | null = null;
    if (len > 1e-7) {
      mapHit = ph.raycast(ox, oy, oz, sx, sy, sz, len);
      if (mapHit) tMap = mapHit.toi / len;
    }
    let tHit = 2;
    let victim: Runner | null = null;
    if (mode !== MODE_LANDER) {
      for (let r = 0; r < runners.length; r++) {
        const v = runners[r];
        if (!v.alive || v.team === team || v.id === owner) continue;
        const h = v.hitHeight();
        const rad = Math.min(HITBOX.radius, h * 0.5);
        const t = segVerticalCapsuleT(ox, oy, oz, sx, sy, sz, v.x, v.y + rad, v.z, h - 2 * rad, rad);
        if (t >= 0 && t < tHit) { tHit = t; victim = v; }
      }
    }

    if (mode === MODE_BURST) {
      // airburst: the first point of the segment that is airburstRange from the launch point (straight flight)
      let tAir = 2;
      const R = k.airburstRange ?? 0;
      if (R > 0) {
        const d0 = Math.hypot(ox - pool.ox[i], oy - pool.oy[i], oz - pool.oz[i]);
        const d1 = Math.hypot(nx - pool.ox[i], ny - pool.oy[i], nz - pool.oz[i]);
        if (d1 >= R) tAir = d0 >= R ? 0 : (R - d0) / Math.max(1e-9, d1 - d0);
      }
      const t = Math.min(victim ? tHit : 2, mapHit ? tMap : 2, tAir);
      if (t <= 1) {
        const bx = ox + sx * t, by = oy + sy * t, bz = oz + sz * t;
        if (victim && tHit <= t + 1e-9) host.burst?.(i, bx, by, bz, victim, 0, 0, 0, false);
        else if (mapHit && tMap <= t + 1e-9) host.burst?.(i, mapHit.x, mapHit.y, mapHit.z, null, mapHit.nx, mapHit.ny, mapHit.nz, false);
        else host.burst?.(i, bx, by, bz, null, 0, 0, 0, true);
        pool.remove(i);
        continue;
      }
    } else if (mode === MODE_LANDER) {
      if (mapHit) {
        if (host.land && host.land(i, mapHit)) { i++; continue; }
        pool.remove(i);
        continue;
      }
    } else {
      if (victim && tHit <= tMap) {
        const hx = ox + sx * tHit, hy = oy + sy * tHit, hz = oz + sz * tHit;
        let dmg = k.damage;
        if (k.damageFar !== undefined && (k.falloffRange ?? 0) > 0) {
          const travel = Math.hypot(hx - pool.ox[i], hz - pool.oz[i]);
          const f = Math.min(1, Math.max(0, travel / (k.falloffRange as number)));
          dmg = k.damage + (k.damageFar - k.damage) * f;
        }
        host.hit(victim, owner, dmg, hx, hy, hz);
        pool.remove(i);
        continue;
      }
      if (mapHit) {
        paintImpact(host, owner, team, mapHit.x, mapHit.y, mapHit.z, mapHit.nx, mapHit.ny, mapHit.nz,
          k.impactRadius, pool.seed[i], vx, vz);
        pool.remove(i);
        continue;
      }
    }

    pool.x[i] = nx; pool.y[i] = ny; pool.z[i] = nz;

    // ── drips under the flight path
    if (k.dripEvery > 0 && mode === MODE_DROPLET) {
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

    if (age1 > k.maxLife || ny < killY - 1) {
      if (mode === MODE_LANDER) host.lost?.(i);
      pool.remove(i);
      continue;
    }
    i++;
  }
}
