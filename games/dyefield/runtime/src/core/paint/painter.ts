// DYEFIELD — painting, coverage and surface queries over the paint atlas (CONTRACT §4.6).
// THREE-free, DOM-free, Node-safe, deterministic (no Math.random; noise is hashed).
//
// * splat / capsule visit ONLY the grid cells their (noise-inflated) volume overlaps, never the
//   whole atlas. Membership: |p − c| ≤ r·(1 − e + 2e·noise) with e = edgeNoise, so every texel
//   within r·(1 − e) is painted and none beyond r·(1 + e). `noise` ∈ [0, 1) mixes a smooth 3-D
//   value noise over the texel's world position (lobes ≈ r/1.6 wide, so the outline is organic
//   rather than speckled) with a per-texel hash of the texel's linear index; both are keyed by
//   `seed`, so the same splat always paints the same texels.
// * facing filter: when the hit normal n is given, a texel paints only if dot(texelN, n) >
//   minFacing (default −0.1). A splat on one face of a thin wall never dyes the back face.
// * weighted totals Σ area·weight per team are Float64 and update O(1) per flip.
// * dirty tracking: per atlas row an inclusive [x0, x1] span (Int32 min/max) plus a list of dirty
//   rows. A flip marks its own texel AND its gutter mirrors. takeDirty hands the spans out in
//   ascending row order, as cb(row, x0, x1) with x1 INCLUSIVE, and clears them.
// * onFlip(id, from, to) fires once per texel whose team actually changes (after the change).

import type { Coverage, TeamId } from '../types.ts';
import { hash32 } from '../rng.ts';
import type { PaintAtlas } from './atlas.ts';

export interface SplatOpts {
  radius: number; team: TeamId;
  nx?: number; ny?: number; nz?: number;   // surface normal of the hit; enables the facing filter
  minFacing?: number;                      // dot(texelN, n) must be > this (default -0.1)
  edgeNoise?: number;                      // fraction of radius (default 0.18) for organic edges
  seed?: number;
}

export interface SurfaceHit { id: number; team: TeamId; dist: number; x: number; y: number; z: number }

/** Value-noise lobes across one splat radius (outline wobble frequency). */
const LOBES_PER_RADIUS = 1.6;
/** Blend of smooth value noise vs per-texel hash in the edge noise. */
const SMOOTH_SHARE = 0.7;
const INV_U32 = 1 / 4294967296;

function smooth(t: number): number { return t * t * (3 - 2 * t); }

/** Smooth 3-D value noise in [0, 1), keyed by `key`. */
function valueNoise3(x: number, y: number, z: number, key: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const tx = smooth(x - x0), ty = smooth(y - y0), tz = smooth(z - z0);
  const kx = (x0 + key) | 0, kx1 = (kx + 1) | 0;
  const y1 = y0 + 1, z1 = z0 + 1;
  const c000 = hash32(kx, y0, z0), c100 = hash32(kx1, y0, z0);
  const c010 = hash32(kx, y1, z0), c110 = hash32(kx1, y1, z0);
  const c001 = hash32(kx, y0, z1), c101 = hash32(kx1, y0, z1);
  const c011 = hash32(kx, y1, z1), c111 = hash32(kx1, y1, z1);
  const a00 = c000 + (c100 - c000) * tx, a10 = c010 + (c110 - c010) * tx;
  const a01 = c001 + (c101 - c001) * tx, a11 = c011 + (c111 - c011) * tx;
  const b0 = a00 + (a10 - a00) * ty, b1 = a01 + (a11 - a01) * ty;
  return (b0 + (b1 - b0) * tz) * INV_U32;
}

export class Painter {
  readonly atlas: PaintAtlas;
  onFlip: ((id: number, from: TeamId, to: TeamId) => void) | null = null;
  /** Diagnostics: texels examined by the last splat/capsule (all items of the touched cells). */
  lastVisited = 0;

  private readonly w = new Float64Array(3);
  private readonly rowMin: Int32Array;
  private readonly rowMax: Int32Array;
  private readonly rows: Int32Array;
  private nRows = 0;
  private flipCount = 0;

  constructor(atlas: PaintAtlas) {
    this.atlas = atlas;
    this.rowMin = new Int32Array(atlas.size);
    this.rowMax = new Int32Array(atlas.size).fill(-1);
    this.rows = new Int32Array(atlas.size);
    this.recount();
  }

  get flips(): number { return this.flipCount; }

  // ── painting ──────────────────────────────────────────────────────────────────────────────

  splat(x: number, y: number, z: number, o: SplatOpts): number {
    return this.paintVolume(x, y, z, x, y, z, o);
  }

  capsule(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: SplatOpts): number {
    return this.paintVolume(ax, ay, az, bx, by, bz, o);
  }

  /** Shared sphere (a == b) / capsule painter. */
  private paintVolume(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: SplatOpts): number {
    this.lastVisited = 0;
    const A = this.atlas;
    const r = o.radius;
    if (!(r > 0) || A.count === 0) return 0;
    const to = o.team;
    let e = o.edgeNoise ?? 0.18;
    if (!(e >= 0)) e = 0; else if (e > 0.95) e = 0.95;
    const reach = r * (1 + e), inner = r * (1 - e);
    const reach2 = reach * reach, inner2 = inner * inner;
    const twoE = 2 * e, oneMinusE = 1 - e;

    let useFacing = false, fx = 0, fy = 0, fz = 0;
    if (o.nx !== undefined || o.ny !== undefined || o.nz !== undefined) {
      fx = o.nx ?? 0; fy = o.ny ?? 0; fz = o.nz ?? 0;
      const l = Math.hypot(fx, fy, fz);
      if (l > 1e-9) { fx /= l; fy /= l; fz /= l; useFacing = true; }
    }
    const minFacing = o.minFacing ?? -0.1;
    const seed = (o.seed ?? 0) | 0;
    const key = hash32(seed, 0x51ed2701);
    const freq = LOBES_PER_RADIUS / r;

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz;
    const isCapsule = len2 > 1e-12;
    const invLen2 = isCapsule ? 1 / len2 : 0;

    const g = A.grid, cell = g.cell, inv = 1 / cell;
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - g.ox) * inv));
    const iy0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - g.oy) * inv));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - g.oz) * inv));
    const ix1 = Math.min(g.nx - 1, Math.floor((Math.max(ax, bx) + reach - g.ox) * inv));
    const iy1 = Math.min(g.ny - 1, Math.floor((Math.max(ay, by) + reach - g.oy) * inv));
    const iz1 = Math.min(g.nz - 1, Math.floor((Math.max(az, bz) + reach - g.oz) * inv));
    if (ix0 > ix1 || iy0 > iy1 || iz0 > iz1) return 0;

    const { start, items } = g;
    const { px, py, pz, nx, ny, nz, team, lin } = A;
    const half = 0.5 * cell;
    const cellSkip = reach + half * Math.sqrt(3);
    const cellSkip2 = cellSkip * cellSkip;
    let flipped = 0, visited = 0;

    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const c = (iz * g.ny + iy) * g.nx + ix;
          const s = start[c], end = start[c + 1];
          if (s === end) continue;
          // reject cells whose centre is farther than reach + half-diagonal from the volume
          {
            const ccx = g.ox + (ix + 0.5) * cell, ccy = g.oy + (iy + 0.5) * cell, ccz = g.oz + (iz + 0.5) * cell;
            let qx = ax, qy = ay, qz = az;
            if (isCapsule) {
              let t = ((ccx - ax) * abx + (ccy - ay) * aby + (ccz - az) * abz) * invLen2;
              if (t < 0) t = 0; else if (t > 1) t = 1;
              qx = ax + abx * t; qy = ay + aby * t; qz = az + abz * t;
            }
            const dx = ccx - qx, dy = ccy - qy, dz = ccz - qz;
            if (dx * dx + dy * dy + dz * dz > cellSkip2) continue;
          }
          visited += end - s;
          for (let k = s; k < end; k++) {
            const id = items[k];
            const tx = px[id], ty = py[id], tz = pz[id];
            let qx = ax, qy = ay, qz = az;
            if (isCapsule) {
              let t = ((tx - ax) * abx + (ty - ay) * aby + (tz - az) * abz) * invLen2;
              if (t < 0) t = 0; else if (t > 1) t = 1;
              qx = ax + abx * t; qy = ay + aby * t; qz = az + abz * t;
            }
            const dx = tx - qx, dy = ty - qy, dz = tz - qz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > reach2) continue;
            if (team[id] === to) continue;
            if (useFacing && nx[id] * fx + ny[id] * fy + nz[id] * fz <= minFacing) continue;
            if (d2 > inner2) {
              const n = SMOOTH_SHARE * valueNoise3(tx * freq, ty * freq, tz * freq, key)
                + (1 - SMOOTH_SHARE) * (hash32(lin[id], seed, 0x2c1b3c6d) * INV_U32);
              const lim = r * (oneMinusE + twoE * n);
              if (d2 > lim * lim) continue;
            }
            this.flip(id, to);
            flipped++;
          }
        }
      }
    }
    this.lastVisited = visited;
    return flipped;
  }

  private flip(id: number, to: TeamId): void {
    const A = this.atlas;
    const from = A.team[id] as TeamId;
    const wv = A.area[id] * A.weight[id];
    this.w[from] -= wv;
    this.w[to] += wv;
    A.team[id] = to;
    this.flipCount++;
    this.markLin(A.lin[id]);
    for (let k = A.mirrorStart[id], e = A.mirrorStart[id + 1]; k < e; k++) this.markLin(A.mirrorItems[k]);
    if (this.onFlip) this.onFlip(id, from, to);
  }

  private markLin(l: number): void {
    const S = this.atlas.size;
    const row = (l / S) | 0;
    const x = l - row * S;
    if (this.rowMax[row] < 0) {
      this.rows[this.nRows++] = row;
      this.rowMin[row] = x;
      this.rowMax[row] = x;
    } else {
      if (x < this.rowMin[row]) this.rowMin[row] = x;
      if (x > this.rowMax[row]) this.rowMax[row] = x;
    }
  }

  // ── queries ───────────────────────────────────────────────────────────────────────────────

  /** Nearest texel id of `kind` within maxDist (ties → lowest id), or −1. */
  nearest(x: number, y: number, z: number, maxDist: number, kind: 'floor' | 'wall' | 'any'): number {
    const A = this.atlas;
    if (A.count === 0 || !(maxDist >= 0)) return -1;
    const g = A.grid, inv = 1 / g.cell;
    const ix0 = Math.max(0, Math.floor((x - maxDist - g.ox) * inv));
    const iy0 = Math.max(0, Math.floor((y - maxDist - g.oy) * inv));
    const iz0 = Math.max(0, Math.floor((z - maxDist - g.oz) * inv));
    const ix1 = Math.min(g.nx - 1, Math.floor((x + maxDist - g.ox) * inv));
    const iy1 = Math.min(g.ny - 1, Math.floor((y + maxDist - g.oy) * inv));
    const iz1 = Math.min(g.nz - 1, Math.floor((z + maxDist - g.oz) * inv));
    const { start, items } = g;
    const { px, py, pz, floor } = A;
    const wantFloor = kind === 'floor' ? 1 : kind === 'wall' ? 0 : -1;
    let best = -1, bestD2 = maxDist * maxDist;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const c = (iz * g.ny + iy) * g.nx + ix;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const id = items[k];
            if (wantFloor >= 0 && floor[id] !== wantFloor) continue;
            const dx = px[id] - x, dy = py[id] - y, dz = pz[id] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || id < best))) { best = id; bestD2 = d2; }
          }
        }
      }
    }
    return best;
  }

  surfaceAt(x: number, y: number, z: number, maxDist: number, kind: 'floor' | 'wall' | 'any'): SurfaceHit | null {
    const id = this.nearest(x, y, z, maxDist, kind);
    if (id < 0) return null;
    const A = this.atlas;
    const hx = A.px[id], hy = A.py[id], hz = A.pz[id];
    return { id, team: A.team[id] as TeamId, dist: Math.hypot(hx - x, hy - y, hz - z), x: hx, y: hy, z: hz };
  }

  /** Team of the nearest floor texel within 0.35 m (DESIGN §4), or null when there is none. */
  teamUnder(x: number, y: number, z: number): TeamId | null {
    const id = this.nearest(x, y, z, 0.35, 'floor');
    return id < 0 ? null : (this.atlas.team[id] as TeamId);
  }

  coverage(): Coverage {
    const total = this.w[0] + this.w[1] + this.w[2];
    if (!(total > 0)) return { sun: 0, gulf: 0, neutral: 1 };
    const sun = Math.max(0, this.w[1] / total);
    const gulf = Math.max(0, this.w[2] / total);
    return { sun, gulf, neutral: Math.max(0, 1 - sun - gulf) };
  }

  weighted(team: TeamId): number {
    return this.w[team];
  }

  takeDirty(cb: (row: number, x0: number, x1: number) => void): void {
    const n = this.nRows;
    if (n === 0) return;
    const list = this.rows.slice(0, n).sort();
    this.nRows = 0;
    for (let i = 0; i < n; i++) {
      const row = list[i];
      const x0 = this.rowMin[row], x1 = this.rowMax[row];
      this.rowMax[row] = -1;
      cb(row, x0, x1);
    }
  }

  /** Back to all-neutral. Every changed texel goes through the normal flip path (dirty + onFlip). */
  reset(): void {
    const team = this.atlas.team;
    for (let id = 0; id < this.atlas.count; id++) {
      if (team[id] !== 0) this.flip(id, 0);
    }
    this.flipCount = 0;
    this.recount();
  }

  /** FNV-1a (32-bit) of team[], 8 lowercase hex digits. */
  hash(): string {
    const team = this.atlas.team;
    let h = 0x811c9dc5;
    for (let i = 0; i < team.length; i++) {
      h ^= team[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /** Recompute the weighted totals from the arrays (removes any Float64 drift). */
  recount(): void {
    const A = this.atlas;
    this.w[0] = 0; this.w[1] = 0; this.w[2] = 0;
    for (let i = 0; i < A.count; i++) this.w[A.team[i]] += A.area[i] * A.weight[i];
  }
}
