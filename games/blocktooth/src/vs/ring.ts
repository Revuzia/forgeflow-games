// BLOCKTOOTH VS — the CONDEMNATION ORDER ring (vs_design.md §5). Lane B-VS.
// THREE-free, deterministic (no rng: the centre is a pure function of the city layout).
//
//   * the centre is the tallest-tier block cluster (the downtown towers), picked once at match start;
//   * 4 steps on the match clock (VS.ring.steps: 7:00 75 %, 8:00 50 %, 9:00 30 %, 10:00 15 % of the city half-width),
//     each shrinking over VS.ring.shrinkS;
//   * from 7:00 a titan OUTSIDE the ring is hit by STILT MORTAR shells aimed at it every VS.ring.mortarEveryS: a ground
//     circle telegraph (so every bot's THREAT layer dodges it like any other paint), landing 4 % maxHp (+1 % per step,
//     +2 % per 5 s of LAST CALL). Leaving the ring is a choice, not instant death.
// Demolition crews (cosmetic: condemned buildings come down outside the ring) read ringOf / ringOutside in city/citysim.ts
// (B-WORLD). Mortar damage is applied HERE through hurtTitan inside withPlayer; the telegraph carries dmg 0 so no
// hostile-shape path double-hits.

import { VS } from '../core/config.ts';
import { hypot } from '../core/detmath.ts';
import type { CityLayout, Telegraph, World } from '../core/types.ts';
import { emitAs, withPlayer } from '../core/players.ts';
import { hurtTitan } from '../titans/titansim.ts';
import { spawnTelegraph } from '../combat/telegraphs.ts';
import { mortarFrac } from './formula.ts';
import { matchClock } from './clock.ts';

/** The live ring as plain numbers (minimap, bots, crews). `r` is the CURRENT radius (shrinking mid-step). */
export interface RingView { cx: number; cz: number; r: number; r0: number; step: number; shrinking: boolean; toR: number }

export function ringOf(w: World): RingView {
  const R = (w.vs as NonNullable<World['vs']>).ring;
  return { cx: R.cx, cz: R.cz, r: R.r, r0: R.r0, step: R.step, shrinking: w.t < R.t1, toR: R.toR };
}

/** true when (x, z) is outside the live ring by more than `pad` metres (pad > 0 = a margin you must be inside by). */
export function ringOutside(w: World, x: number, z: number, pad = 0): boolean {
  if (!w.vs) return false;
  const R = w.vs.ring;
  return hypot(x - R.cx, z - R.cz) > R.r - pad;
}

/** Radius the NEXT step will settle at (the live toR while a step shrinks; else the next scheduled one; else the live r). */
export function nextRingRadius(w: World): number {
  const R = (w.vs as NonNullable<World['vs']>).ring;
  const next = R.step + 1;
  if (w.t < R.t1) return Math.min(R.r, R.toR);
  if (next < VS.ring.steps.length) return R.r0 * VS.ring.steps[next].frac;
  return R.r;
}

/**
 * The ring centre: the tallest-tier block cluster of the city. Pure + deterministic: buildings of the city's top tier
 * are binned on a 2-pitch grid weighted by floor count; the 3 x 3 cell neighbourhood with the most floors wins (ties:
 * the first in row-major order) and the centre is that neighbourhood's floor-weighted centroid, clamped so the FINAL
 * ring (15 %) fits inside the playable bounds.
 */
export function pickRingCentre(city: CityLayout, finalR: number): { cx: number; cz: number } {
  const b = city.bounds;
  let maxTier = 0;
  for (let i = 0; i < city.buildings.length; i++) { const t = city.buildings[i].tier; if (t > maxTier) maxTier = t; }
  const cell = Math.max(1, 2 * city.pitch);
  const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / cell)), nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell));
  const sum = new Float64Array(nx * nz);
  const cellOf = (x: number, z: number): number => {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - b.minX) / cell)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((z - b.minZ) / cell)));
    return iz * nx + ix;
  };
  for (let i = 0; i < city.buildings.length; i++) {
    const bd = city.buildings[i];
    if (bd.tier !== maxTier) continue;
    sum[cellOf(bd.x, bd.z)] += bd.floors;
  }
  let best = -1, bestV = -1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      let v = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        v += sum[jz * nx + jx];
      }
      if (v > bestV) { bestV = v; best = iz * nx + ix; }
    }
  }
  let cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  if (best >= 0 && bestV > 0) {
    const bix = best % nx, biz = (best - bix) / nx;
    let sw = 0, sx = 0, sz = 0;
    for (let i = 0; i < city.buildings.length; i++) {
      const bd = city.buildings[i];
      if (bd.tier !== maxTier) continue;
      const c = cellOf(bd.x, bd.z);
      const cx2 = c % nx, cz2 = (c - cx2) / nx;
      if (Math.abs(cx2 - bix) > 1 || Math.abs(cz2 - biz) > 1) continue;
      sw += bd.floors; sx += bd.x * bd.floors; sz += bd.z * bd.floors;
    }
    if (sw > 0) { cx = sx / sw; cz = sz / sw; }
  }
  const fx = Math.min(finalR, (b.maxX - b.minX) / 2), fz = Math.min(finalR, (b.maxZ - b.minZ) / 2);
  cx = Math.min(b.maxX - fx, Math.max(b.minX + fx, cx));
  cz = Math.min(b.maxZ - fz, Math.max(b.minZ + fz, cz));
  return { cx, cz };
}

/** Called once at the first VS tick: pin the ring centre from the city. */
export function initRing(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  if (vs.data.ringInit === 1) return;
  vs.data.ringInit = 1;
  const R = vs.ring;
  const finalFrac = VS.ring.steps[VS.ring.steps.length - 1].frac;
  const c = pickRingCentre(w.city, R.r0 * finalFrac);
  R.cx = c.cx; R.cz = c.cz;
}

/**
 * Advance the ring schedule (called every tick from vsBeginTick, after the phase machine): starts each step whose time
 * has come (one `ringStep` event per step) and lerps the radius through the running step.
 */
export function stepRing(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  const R = vs.ring;
  const c = matchClock(w);
  const steps = VS.ring.steps;
  while (R.step + 1 < steps.length && c >= steps[R.step + 1].atS) {
    const i = R.step + 1;
    R.step = i;
    R.fromR = R.r;
    R.toR = R.r0 * steps[i].frac;
    R.t0 = w.t; R.t1 = w.t + VS.ring.shrinkS;
    emitAs(w, -1, { type: 'ringStep', step: i, r: R.toR });
  }
  if (R.step >= 0) {
    if (w.t >= R.t1) R.r = R.toR;
    else {
      const u = (w.t - R.t0) / Math.max(1e-6, R.t1 - R.t0);
      R.r = R.fromR + (R.toR - R.fromR) * u;
    }
  }
}

/** Radius of a mortar shell's circle for a titan of height H (m): a quarter of the body, 4..12 m. */
function shellRadius(H: number): number { return Math.min(12, Math.max(4, 0.25 * H)); }

/** The shell lands: every live titan whose body overlaps the circle takes the step's share of ITS max HP. */
function shellLands(w: World, x: number, z: number, r: number): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'over') return;
  const frac = mortarFrac(matchClock(w));
  for (let i = 0; i < w.players.length; i++) {
    const P = w.players[i];
    const T = P.titan;
    if (P.vs.eliminated || !T.alive) continue;
    if (hypot(T.x - x, T.z - z) > r + T.radius) continue;
    withPlayer(w, i, () => hurtTitan(w, frac * T.maxHp, 'mortar', x, z));
  }
  emitAs(w, -1, { type: 'explosion', x, z, r, kind: 'mortar' });
}

/**
 * FINAL NOTICE / LAST CALL mortar barrage (called from vsAfterTitans). Each seat outside the ring gets one shell aimed at
 * its position every VS.ring.mortarEveryS (the first lands VS.ring.mortarEveryS / 2 after it steps outside). Slot order.
 */
export function stepMortar(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  if (vs.phase !== 'final' && vs.phase !== 'last') return;
  const R = vs.ring;
  for (let i = 0; i < w.players.length; i++) {
    const P = w.players[i];
    const T = P.titan;
    const D = P.vs.data;
    if (P.vs.eliminated || !T.alive || hypot(T.x - R.cx, T.z - R.cz) <= R.r) { D.mortarNext = 0; continue; }
    if (!(D.mortarNext > 0)) { D.mortarNext = w.t + VS.ring.mortarEveryS * 0.5; continue; }
    if (w.t < D.mortarNext) continue;
    D.mortarNext = w.t + VS.ring.mortarEveryS;
    const sx = T.x, sz = T.z, sr = shellRadius(T.height);
    spawnTelegraph(w, {
      owner: 'enemy', style: 'circle', shape: { k: 'circle', x: sx, z: sz, r: sr },
      windup: 1.0, dmg: 0, kind: 'mortar', tag: 'condemn',
      onFire: (w2: World, _tg: Telegraph) => { shellLands(w2, sx, sz, sr); },
    });
  }
}
