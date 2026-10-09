// GENESIS — terrain (CONTRACT.md §7.2; cadence 10): the player's brushes and the slow movers of the ground.
//
//   * Brushes with smooth falloff: raise, lower, flatten, smooth, noise, crater, mountain range (along a great-circle
//     segment), dig-sea, carve a river path, paint material (soil / sand / snow / ash / ice / rock / lava).
//   * Talus relaxation (active set): slopes steeper than the angle of repose of their top material shed it downhill —
//     landslides after brushes, slip faces on dunes, scree under cliffs.
//   * Sand saltation: in dry, bare, windy cells sand hops one cell downwind -> dunes; it buries roads and crops.
//   * Ash weathers into soil (fertility) where it is moist; dry ash blows like light sand.
//   * Lava (active set): viscous (Bingham) flow downhill, cools into rock (builds land; faster in water, boiling it
//     to steam), burns what it touches, ignites neighbours. Vents keep volcanic worlds alive.
// Every edit wakes the hydrology (activateCell) and marks the sea mask dirty when it touches the shore.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { activateCell, DRY } from './hydrology.ts';
import { igniteCell } from './fire.ts';
import { stampCrater, smoothstep } from '../world/gen.ts';
import { collectFlags } from '../core/activeset.ts';
import { lapseCadence, lapseDue, stagger, LAPSE_SAND } from '../perf/lapse.ts';

/** called when something strikes the ground (crater brush, meteors later): peoples are hurt, star iron falls */
export const impactHooks: ((u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, meteor: boolean) => void)[] = [];

export const TERRAIN_CADENCE = 10;

export type BrushKind =
  | 'raise' | 'lower' | 'flatten' | 'smooth' | 'noise' | 'crater' | 'mountain-range' | 'dig-sea' | 'river' | 'paint-material';

export const MATERIALS = ['soil', 'sand', 'snow', 'ash', 'ice', 'rock', 'lava'] as const;
export type Material = (typeof MATERIALS)[number];

export interface BrushOpts {
  /** second point for mountain-range / river */
  to?: ArrayLike<number>;
  /** flatten target height (m above datum); default: the height at the brush centre */
  height?: number;
  /** dig-sea depth below sea level (m) */
  depth?: number;
  material?: Material;
  /** noise frequency (cycles per radius) */
  frequency?: number;
}

/** smooth brush falloff for normalised distance d (0 centre, 1 edge) */
function falloff(d: number): number {
  if (d >= 1) return 0;
  const t = 1 - d * d;
  return t * t;
}

/** largest height change of one brush stroke, as a fraction of the planet radius */
const HEIGHT_PER_STROKE = 0.3;
/** the ground never leaves this band around the datum sphere (fraction of the planet radius), whatever a brush asks:
 * a schema-valid stack of brushes must not dig below the planet's centre or raise a spire into orbit */
const GROUND_LIMIT = 0.5;

function touched(p: Planet, cells: Iterable<number>): void {
  const s = p.s, f = p.f;
  let shore = false;
  const sea = p.hydro.seaNow;
  const lim = GROUND_LIMIT * p.st.radius;
  for (const c of cells) {
    p.updSurface(c);
    const h = f.surface[c];
    if (h < -lim || h > lim) {
      f.rock[c] += (h < -lim ? -lim : lim) - h;
      p.updSurface(c);
    }
    activateCell(p, c);
    s.tAct[c] = 1;
    if (s.ocean[c] || p.f.surface[c] < sea + 1) shore = true;
  }
  if (shore) p.hydro.maskDirty = true;
  for (const k of ['surface', 'rock', 'soil', 'sand', 'snow', 'ash', 'ice', 'lava', 'water'] as const) p.bump(k);
}

/**
 * Apply a brush. `strength` is metres for height brushes (raise / lower / noise / mountain height / material depth),
 * 0..1 blend for flatten / smooth, depth scale for craters. Returns the number of cells changed.
 */
export function brush(u: Universe, p: Planet, kind: BrushKind, pos: ArrayLike<number>, radiusM: number, strength: number, o: BrushOpts = {}): number {
  const f = p.f, g = p.grid;
  const P = g.pos;
  const R = p.st.radius;
  const ang = Math.max(radiusM / R, g.meanEdgeAngle * 0.6);
  const dist = (c: number) => Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
  // one stroke never moves the ground more than this (m): the command schemas bound the inputs, this bounds them on
  // smaller worlds too (a 400 m cut on a 600 m moon is not a brush stroke, it is a hole through the world)
  const hMax = HEIGHT_PER_STROKE * R;
  const clampH = (v: number) => (v > hMax ? hMax : v < -hMax ? -hMax : v);
  switch (kind) {
    case 'raise':
    case 'lower': {
      const cells = p.cellsNear(pos, radiusM).slice();
      const sgn = kind === 'raise' ? 1 : -1;
      const amt = clampH(strength);
      for (const c of cells) {
        let dh = sgn * amt * falloff(dist(c));
        if (dh < 0) {
          // lowering strips the loose cover first
          for (const layer of ['snow', 'sand', 'ash', 'soil'] as const) {
            const m = Math.min(f[layer][c], -dh);
            f[layer][c] -= m;
            dh += m;
            if (dh >= 0) break;
          }
        }
        f.rock[c] += dh;
      }
      touched(p, cells);
      return cells.length;
    }
    case 'flatten': {
      const center = p.cellAt(pos);
      const target = o.height ?? f.surface[center];
      const cells = p.cellsNear(pos, radiusM).slice();
      for (const c of cells) {
        const k = Math.min(1, Math.max(0, strength) * falloff(dist(c)) * 1.5);
        f.rock[c] += (target - f.surface[c]) * k;
      }
      touched(p, cells);
      return cells.length;
    }
    case 'smooth': {
      const cells = p.cellsNear(pos, radiusM).slice();
      const mean = new Float64Array(cells.length);
      cells.forEach((c, i) => {
        let s = 0, k = 0;
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { s += f.surface[g.nbr[e]]; k++; }
        mean[i] = s / k;
      });
      cells.forEach((c, i) => {
        const k = Math.min(1, Math.max(0, strength) * falloff(dist(c)));
        f.rock[c] += (mean[i] - f.surface[c]) * k;
      });
      touched(p, cells);
      return cells.length;
    }
    case 'noise': {
      const cells = p.cellsNear(pos, radiusM).slice();
      const fr = (o.frequency ?? 3) / ang;
      const amp = clampH(strength);
      for (const c of cells) {
        const n = p.noise.fbm(P[c * 3] * fr + 11, P[c * 3 + 1] * fr, P[c * 3 + 2] * fr - 7, 3);
        f.rock[c] += amp * n * falloff(dist(c));
      }
      touched(p, cells);
      return cells.length;
    }
    case 'crater': {
      const h = new Float32Array(p.count);
      const cells: number[] = [];
      stampCrater(g, h, pos[0], pos[1], pos[2], ang, R, null, 0.2 * Math.min(5, Math.max(0.05, strength)), cells);
      const list = cells.slice();
      for (const c of list) {
        let dh = h[c];
        if (dh < 0) {
          for (const layer of ['snow', 'sand', 'ash', 'soil'] as const) {
            const m = Math.min(f[layer][c], -dh);
            f[layer][c] -= m;
            dh += m;
            if (dh >= 0) break;
          }
        }
        f.rock[c] += clampH(dh);
        // the blast strips plants from the bowl and scorches the rim
        const d = dist(c);
        if (d < 1.4) { f.grass[c] = 0; f.shrub[c] = 0; f.tree[c] *= d < 1 ? 0 : 0.3; f.crop[c] = 0; f.burnt[c] = Math.max(f.burnt[c], 1 - d * 0.5); }
      }
      touched(p, list);
      u.emit({ t: 'impact', planet: p.id, pos: [pos[0], pos[1], pos[2]], a: radiusM, b: strength });
      for (const h of impactHooks) h(u, p, pos, radiusM, false);
      return list.length;
    }
    case 'mountain-range': {
      const to = o.to ?? pos;
      const height = clampH(strength);
      const prof = new Map<number, number>();
      const ax = pos[0], ay = pos[1], az = pos[2];
      const bx = to[0], by = to[1], bz = to[2];
      const span = Math.acos(Math.min(1, ax * bx + ay * by + az * bz));
      const steps = Math.max(1, Math.ceil(span / (ang * 0.35)));
      const sinS = Math.sin(span);
      const pt = [0, 0, 0];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (span < 1e-6 || sinS < 1e-9) { pt[0] = ax; pt[1] = ay; pt[2] = az; }
        else {
          const wa = Math.sin((1 - t) * span) / sinS, wb = Math.sin(t * span) / sinS;
          pt[0] = ax * wa + bx * wb; pt[1] = ay * wa + by * wb; pt[2] = az * wa + bz * wb;
        }
        const taper = smoothstep(0, 0.18, t) * smoothstep(1, 0.82, t) * 0.75 + 0.25;
        for (const c of g.cellsWithin(pt[0], pt[1], pt[2], ang * 1.6, p.scratch.cells)) {
          const d = Math.acos(Math.min(1, P[c * 3] * pt[0] + P[c * 3 + 1] * pt[1] + P[c * 3 + 2] * pt[2])) / ang;
          const ridge = p.noise.ridged(P[c * 3] * 9 / ang * 0.05 + 3, P[c * 3 + 1] * 9 / ang * 0.05, P[c * 3 + 2] * 9 / ang * 0.05, 4);
          const v = height * taper * Math.exp(-d * d * 2.2) * (0.55 + 0.45 * ridge);
          const prev = prof.get(c);
          if (prev === undefined || v > prev) prof.set(c, v);
        }
      }
      const cells = [...prof.keys()].sort((x, y) => x - y);
      for (const c of cells) f.rock[c] += prof.get(c)!;
      touched(p, cells);
      return cells.length;
    }
    case 'dig-sea': {
      const depth = clampH(Math.abs(o.depth ?? Math.max(5, strength)));
      const sea = p.hydro.seaNow;
      const cells = p.cellsNear(pos, radiusM).slice();
      for (const c of cells) {
        const k = falloff(dist(c) * 0.85);
        const target = sea - depth * k;
        if (f.surface[c] > target) {
          let dh = target - f.surface[c];
          for (const layer of ['snow', 'sand', 'ash', 'soil', 'ice'] as const) {
            const m = Math.min(f[layer][c], -dh);
            f[layer][c] -= m;
            dh += m;
            if (dh >= 0) break;
          }
          f.rock[c] += dh;
        }
        p.updSurface(c);
        // the new basin holds sea water
        const fill = Math.max(0, sea - f.surface[c]) - f.water[c];
        if (fill > 0) { f.water[c] += fill; p.hydro.sourced += fill * p.cellArea[c]; }
        f.salinity[c] = 1;
        f.grass[c] = 0; f.shrub[c] = 0; f.tree[c] = 0; f.crop[c] = 0;
      }
      touched(p, cells);
      // "dig a sea": the new basin IS sea (computeOcean keeps marked cells below the level as ocean seeds), however far
      // it lies from the old coast — and the old ocean stays ocean (it is seeded from the previous mask too)
      for (const c of cells) if (f.surface[c] < sea - 0.05) p.s.ocean[c] = 1;
      p.hydro.maskDirty = true;
      return cells.length;
    }
    case 'river': {
      // carve a channel from pos toward `to` (or straight downhill), keeping the bed falling all the way
      const path = riverPath(p, pos, o.to ?? null);
      const depth = Math.max(0.5, strength || 2);
      let bed = Infinity;
      for (const c of path) {
        const want = Math.min(f.surface[c] - depth, bed - 0.05);
        bed = want;
        let dh = want - f.surface[c];
        for (const layer of ['snow', 'sand', 'ash', 'soil'] as const) {
          const m = Math.min(f[layer][c], -dh);
          f[layer][c] -= m;
          dh += m;
          if (dh >= 0) break;
        }
        f.rock[c] += dh;
        // banks: widen gently into the neighbours
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
          const nb = g.nbr[e];
          if (path.includes(nb)) continue;
          const nd = Math.max(0, f.surface[nb] - (want + depth * 0.5));
          f.rock[nb] -= Math.min(nd * 0.4, depth * 0.5);
          p.updSurface(nb);
          activateCell(p, nb);
        }
      }
      if (path.length) {
        p.springs.push({ id: u.ids.alloc('spring'), cell: path[0], rate: 60 * (p.edgeM / 52) ** 2, life: -1 });
      }
      touched(p, path);
      return path.length;
    }
    case 'paint-material': {
      const mat = o.material ?? 'soil';
      const cells = p.cellsNear(pos, radiusM).slice();
      for (const c of cells) {
        const dv = strength * falloff(dist(c));
        if (mat === 'lava') {
          f.lava[c] = Math.max(0, f.lava[c] + dv);
          p.s.lAct[c] = 1;
          continue;
        }
        const arr = f[mat];
        arr[c] = mat === 'rock' ? arr[c] + dv : Math.max(0, arr[c] + dv);
        if (mat === 'ash' && dv > 0) { f.grass[c] *= 0.7; f.crop[c] *= 0.7; }
      }
      touched(p, cells);
      if (mat === 'lava') { p.bump('lava'); u.emit({ t: 'eruption', planet: p.id, pos: [pos[0], pos[1], pos[2]], a: strength }); }
      return cells.length;
    }
  }
  return 0;
}

/** cells along a great-circle path (deduplicated, in order) or, without a target, the steepest-descent path */
function riverPath(p: Planet, from: ArrayLike<number>, to: ArrayLike<number> | null): number[] {
  const g = p.grid, f = p.f;
  const out: number[] = [];
  if (to) {
    const ax = from[0], ay = from[1], az = from[2];
    const span = Math.acos(Math.min(1, ax * to[0] + ay * to[1] + az * to[2]));
    const steps = Math.max(1, Math.ceil(span / (g.meanEdgeAngle * 0.4)));
    const sinS = Math.sin(span);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x = ax, y = ay, z = az;
      if (sinS > 1e-9) {
        const wa = Math.sin((1 - t) * span) / sinS, wb = Math.sin(t * span) / sinS;
        x = ax * wa + to[0] * wb; y = ay * wa + to[1] * wb; z = az * wa + to[2] * wb;
      }
      const c = g.nearestCell(x, y, z);
      if (out[out.length - 1] !== c && !out.includes(c)) out.push(c);
    }
    return out;
  }
  let c = p.cellAt(from);
  out.push(c);
  for (let k = 0; k < 400; k++) {
    if (p.s.ocean[c]) break;
    let best = -1, bh = f.surface[c] + f.water[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      const h = f.surface[o];
      if (h < bh && !out.includes(o)) { bh = h; best = o; }
    }
    if (best < 0) {
      // a pit: cut through the lowest rim neighbour
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (out.includes(o)) continue;
        if (best < 0 || f.surface[o] < f.surface[best]) best = o;
      }
      if (best < 0) break;
    }
    c = best;
    out.push(c);
  }
  return out;
}

// ───────────────────────────── the slow ground step ─────────────────────────────

/** angle of repose (rise/run) of the top material of a cell */
function repose(p: Planet, c: number): number {
  const f = p.f;
  if (f.snow[c] > 0.02) return 0.75;
  if (f.sand[c] > 0.02) return 0.62;
  if (f.ash[c] > 0.02) return 0.7;
  if (f.soil[c] > 0.02) return 0.9;
  return 1.5;
}

/** remove up to `m` metres of loose cover (top first) or rock; returns [amount, layerIndex] in out */
function takeTop(p: Planet, c: number, m: number): number {
  const f = p.f;
  for (const layer of ['snow', 'sand', 'ash', 'soil'] as const) {
    if (f[layer][c] > 0.02) {
      const t = Math.min(f[layer][c], m);
      f[layer][c] -= t;
      return t * (layer === 'snow' ? -1 : 1);
    }
  }
  f.rock[c] -= m;
  return m;
}

export function terrainStep(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid, geo = p.geo, cfg = p.cfg;
  const N = p.count;
  const R = p.st.radius;
  let changed = false;

  // vents feed lava
  for (const v of p.vents) {
    f.lava[v.cell] += v.rate;
    s.lAct[v.cell] = 1;
    if (v.life > 0) v.life = Math.max(0, v.life - TERRAIN_CADENCE);
  }
  if (p.vents.some((v) => v.life === 0)) p.vents = p.vents.filter((v) => v.life !== 0);

  // 1. lava
  const list = p.scratch.list;
  let n = collectFlags(s.lAct, list, N);
  if (n) {
    lavaFlow(u, p, list, n);
    changed = true;
  }

  // 2. talus relaxation
  n = collectFlags(s.tAct, list, N);
  let slid = 0;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    let moved = false;
    // A slope within a few float32 ulps of its angle of repose is at rest: the excess there is rounding, and moving
    // sub-ulp amounts changes nothing while keeping the cell (and its neighbours' hydrology) awake forever and
    // re-versioning every ground field each step. Count only moves that really change the ground.
    const eps = 2e-6 * Math.max(16, Math.abs(f.surface[c]));
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      const drop = f.surface[c] - f.surface[o];
      if (drop <= 0) continue;
      const lim = repose(p, c) * geo.len[e] * R;
      if (drop <= lim) continue;
      const m = Math.min((drop - lim) * 0.25, 4);
      if (m <= eps) continue;
      const sc = f.surface[c], so = f.surface[o];
      const t = takeTop(p, c, m);
      if (t < 0) f.snow[o] += -t; // snow slides as snow
      else f.sand[o] += t; // everything else lands as loose debris
      p.updSurface(c);
      p.updSurface(o);
      if (f.surface[c] === sc && f.surface[o] === so) continue;
      s.tAct[o] = 1;
      activateCell(p, o);
      moved = true;
      slid += Math.abs(t);
    }
    if (!moved) s.tAct[c] = 0;
    else { activateCell(p, c); changed = true; }
  }
  if (slid > 25) {
    const c = list[0];
    const P = g.pos;
    u.emit({ t: 'landslide', planet: p.id, pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], a: slid });
  }

  // 3. wind on sand and ash; ash weathering — a third of the grid per step (contiguous thirds in turn) at three times
  // the per-step rates, so every cell is visited every 3 steps (30 ticks): dunes grow over days, and the full-grid
  // scan was a fixed cost of every terrain step on every world with sand (SIM perf pass)
  // (time-lapse, perf/lapse.ts: every 20 / 30 ticks at 100x / 1000x, each pass moving the elapsed time's worth)
  // (asked every terrain step, airless or not: a time-lapse record is consumed on schedule)
  const dtS = lapseDue(u, p, LAPSE_SAND, u.tick + stagger(p), 5);
  if (dtS && p.airy) {
    const part = Math.floor((u.tick + p.id * 13 + 5) / lapseCadence(u, LAPSE_SAND)) % SAND_SPLIT;
    const from = Math.floor((N * part) / SAND_SPLIT), to = Math.floor((N * (part + 1)) / SAND_SPLIT);
    if (sandKernel(p, from, to, (SAND_SPLIT * dtS) / TERRAIN_CADENCE)) changed = true;
  }
  if (changed) {
    for (const k of ['surface', 'rock', 'sand', 'soil', 'ash', 'snow', 'lava', 'road'] as const) p.bump(k);
  }
}

/** cells per sand / ash pass: each terrain step handles one contiguous part */
const SAND_SPLIT = 3;

/** wind on sand and ash, ash weathering, over cells [from, to) with `scale` steps' worth of transport; true if anything
 * moved */
function sandKernel(p: Planet, from: number, to: number, scale: number): boolean {
  const f = p.f, s = p.s, g = p.grid, geo = p.geo;
  const freeze = p.st.liquid.freeze;
  const k = 0.0004 * p.cfg.sandTransport * scale;
  const sandA = f.sand, ashA = f.ash, moisture = f.moisture, temperature = f.temperature, soil = f.soil;
  const water = f.water, snow = f.snow, ice = f.ice, grass = f.grass, shrub = f.shrub, tree = f.tree, crop = f.crop;
  const windX = f.windX, windY = f.windY, windZ = f.windZ, road = f.road, tAct = s.tAct;
  const nbrStart = g.nbrStart, nbr = g.nbr, tx = geo.tx, ty = geo.ty, tz = geo.tz;
  let changed = false;
  for (let c = from; c < to; c++) {
    const sand = sandA[c], ash = ashA[c];
    if (sand < 0.02 && ash < 0.01) continue;
    if (ash > 0 && moisture[c] > 0.2 && temperature[c] > freeze) {
      // ash weathers into soil (the fertility bonus is read by vegetation)
      const w = Math.min(ash, 0.00025 * moisture[c] * scale);
      ashA[c] -= w;
      soil[c] += w * 0.8;
      // the layer sum shrank (0.2 of the weathered ash is lost): keep `surface` exact — nothing re-sums every cell
      // any more (the hourly climate pass only re-sums cells whose own snow / ice changed)
      p.updSurface(c);
      changed = true;
    }
    if (water[c] > DRY || moisture[c] > 0.3 || snow[c] > 0.05 || temperature[c] < freeze - 5 && ice[c] > 0) continue;
    const veg = grass[c] + shrub[c] + tree[c] + crop[c];
    if (veg > 0.6) continue;
    const wx = windX[c], wy = windY[c], wz = windZ[c];
    const ws = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const thr = sand >= 0.02 ? 5 : 3;
    if (ws <= thr) continue;
    let best = -1, bd = 0.3 * ws;
    const e1 = nbrStart[c + 1];
    for (let e = nbrStart[c]; e < e1; e++) {
      const d = tx[e] * wx + ty[e] * wy + tz[e] * wz;
      if (d > bd) { bd = d; best = e; }
    }
    if (best < 0) continue;
    const o = nbr[best];
    const q = k * (ws - thr) * (1 - Math.min(1, veg));
    if (sand >= 0.02) {
      const m = Math.min(sand, q * Math.min(1, sand / 0.2));
      sandA[c] -= m;
      sandA[o] += m;
      if (m > 0.0005) { road[o] *= 1 - Math.min(0.5, m * 30); crop[o] *= 1 - Math.min(0.5, m * 8); }
    } else {
      const m = Math.min(ashA[c], q * 1.5);
      ashA[c] -= m;
      ashA[o] += m;
    }
    p.updSurface(c);
    p.updSurface(o);
    tAct[o] = 1;
    changed = true;
  }
  return changed;
}

/** viscous lava flow, cooling, steam and burning over the lava active set */
function lavaFlow(u: Universe, p: Planet, list: Int32Array, n: number): void {
  const f = p.f, s = p.s, g = p.grid;
  const dL = p.scratch.dV; // reused as a lava delta buffer (hydrology clears its own entries after use)
  const YIELD = 0.35;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const L = f.lava[c];
    if (L <= 0) continue;
    const Hc = f.surface[c] + L;
    let total = 0;
    const e0 = g.nbrStart[c], e1 = g.nbrStart[c + 1];
    for (let e = e0; e < e1; e++) {
      const o = g.nbr[e];
      const dh = Hc - (f.surface[o] + f.lava[o]) - YIELD;
      if (dh > 0) total += dh;
    }
    if (total <= 0) continue;
    const out = Math.min(L * 0.6, total * 0.12);
    for (let e = e0; e < e1; e++) {
      const o = g.nbr[e];
      const dh = Hc - (f.surface[o] + f.lava[o]) - YIELD;
      if (dh <= 0) continue;
      const m = (out * dh) / total;
      dL[c] -= m;
      dL[o] += m;
    }
  }
  const cool = 0.004 * p.cfg.lavaCooling;
  let steam = 0;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (dL[o] !== 0) { f.lava[o] = Math.max(0, f.lava[o] + dL[o]); dL[o] = 0; if (f.lava[o] > 0) s.lAct[o] = 1; }
    }
    if (dL[c] !== 0) { f.lava[c] = Math.max(0, f.lava[c] + dL[c]); dL[c] = 0; }
  }
  // cooling, steam, burning: over the (possibly grown) set
  const cool2 = p.scratch.list2;
  const nc = collectFlags(s.lAct, cool2, p.count);
  for (let i = 0; i < nc; i++) {
    const c = cool2[i];
    let L = f.lava[c];
    if (L <= 0.005) {
      f.rock[c] += L;
      f.lava[c] = 0;
      s.lAct[c] = 0;
      p.updSurface(c);
      continue;
    }
    let k = cool * (1 + Math.max(0, -f.temperature[c]) / 40);
    if (f.water[c] > 0.01) {
      const boil = Math.min(f.water[c], 0.25);
      f.water[c] -= boil;
      p.hydro.sourced -= boil * p.cellArea[c];
      steam += boil;
      k += 0.05;
      activateCell(p, c);
    }
    const m = Math.min(L, k);
    L -= m;
    f.lava[c] = L;
    f.rock[c] += m; // cooled lava builds land
    p.updSurface(c);
    activateCell(p, c);
    // nothing grows in lava; neighbours catch fire
    if (f.grass[c] + f.shrub[c] + f.tree[c] + f.crop[c] > 0) {
      f.grass[c] = 0; f.shrub[c] = 0; f.tree[c] = 0; f.crop[c] = 0;
      f.burnt[c] = 1;
    }
    f.snow[c] = 0;
    f.ice[c] = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (f.fire[o] <= 0 && f.grass[o] + f.shrub[o] + f.tree[o] + f.crop[o] > 0.1) igniteCell(u, p, o, 0.7, 'lava');
    }
  }
  if (steam > 0.5) {
    const c = list[0];
    const P = g.pos;
    u.emit({ t: 'steam', planet: p.id, pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], a: steam });
  }
  p.bump('lava');
}
