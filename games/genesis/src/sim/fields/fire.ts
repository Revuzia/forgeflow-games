// GENESIS — fire (CONTRACT.md §7, cadence 5, active set): a per-cell intensity 0..1 fed by vegetation fuel (and later
// buildings through `fuelHooks`), throttled by dryness, spread to neighbours with wind (downwind much faster than
// upwind) and slope (uphill faster), embers jumping downwind ahead of strong fires, put out by standing water and rain,
// leaving a burnt scar and ash that later weathers into fertile soil. The `fire` field doubles as the smoke source for
// the renderer. Events: 'fire.start' (a new fire from lightning, lava, a command...) and 'fire.out' (the last flame on
// a planet died). `heatAt` answers "how hot is it here" for recipes later (kiln / cooking contexts).
//
// Determinism: spread and ember rolls use stateless hashes of (cell, neighbour, tick), and new ignitions are applied
// after the sweep, so the result never depends on iteration order.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { collectFlags } from '../core/activeset.ts';

export const FIRE_CADENCE = 5;

/** extra fuel providers (buildings, stores) — phase 2 registers one; each returns fuel 0..∞ at a cell */
export const fuelHooks: ((p: Planet, c: number) => number)[] = [];

/** vegetation fuel at a cell (plus hooks) */
export function fuelAt(p: Planet, c: number): number {
  const f = p.f;
  let fuel = f.grass[c] * 0.3 + f.shrub[c] * 0.6 + f.tree[c] * 1.0 + f.crop[c] * 0.4;
  for (const h of fuelHooks) fuel += h(p, c);
  return fuel;
}

/** 0 (soaked) .. 1 (tinder dry) */
export function dryness(p: Planet, c: number): number {
  const f = p.f;
  if (f.water[c] > 0.03 || f.snow[c] > 0.05) return 0;
  let d = 1 - f.moisture[c] * 1.15 - f.wetness[c] * 0.45 - Math.max(0, f.humidity[c] - 0.55) * 0.6;
  if (f.precip[c] > 0 && f.precipType[c] !== 2) d -= 0.5;
  if (f.temperature[c] > 28) d += 0.12;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** mean flammability of what grows in the cell (species data) */
function flammability(p: Planet, c: number, flam: Float32Array): number {
  const f = p.f;
  let w = 0, s = 0;
  const add = (cover: number, sp: number) => { if (cover > 0 && sp >= 0) { s += cover * flam[sp]; w += cover; } };
  add(f.grass[c], f.grassSpecies[c]);
  add(f.shrub[c], f.shrubSpecies[c]);
  add(f.tree[c], f.treeSpecies[c]);
  add(f.crop[c], f.cropSpecies[c]);
  return w > 0 ? s / w : 0.5;
}

/** can this planet burn at all (oxygen) */
export function canBurn(p: Planet): boolean {
  const a = p.st.atmosphere;
  return a.pressure * a.o2 >= 0.04;
}

/** Start (or feed) a fire at a cell. Returns true if it caught. */
export function igniteCell(u: Universe, p: Planet, c: number, strength: number, cause: string): boolean {
  if (!canBurn(p) && p.f.lava[c] <= 0) return false;
  const f = p.f;
  if (f.water[c] > 0.03) return false;
  if (fuelAt(p, c) < 0.03) return false;
  const was = f.fire[c] > 0;
  f.fire[c] = Math.max(f.fire[c], Math.min(1, strength));
  p.s.fAct[c] = 1;
  if (!was) {
    const P = p.grid.pos;
    u.emit({ t: 'fire.start', planet: p.id, pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], a: f.fire[c], text: cause, data: { cell: c, cause } });
    if (p.firsts.fire === undefined) {
      p.firsts.fire = u.tick;
      u.chronicleAdd(p, 'nature', cause === 'lightning' ? 'Lightning struck the dry land, and for the first time the world burned.' : 'For the first time, fire ran over the world.', 2);
    }
  }
  p.bump('fire');
  return true;
}

/** ignite every cell in a disc (fire.ignite command); returns cells lit */
export function igniteArea(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, strength: number): number {
  let n = 0;
  const cells = p.cellsNear(pos, radiusM).slice();
  for (const c of cells) if (igniteCell(u, p, c, strength, 'god')) n++;
  return n;
}

/** put out fires in a disc (and wet the ground a little) */
export function extinguishArea(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number): number {
  let n = 0;
  for (const c of p.cellsNear(pos, radiusM)) {
    if (p.f.fire[c] > 0) n++;
    p.f.fire[c] = 0;
    p.s.fAct[c] = 0;
    p.f.moisture[c] = Math.min(1, p.f.moisture[c] + 0.3);
    p.f.wetness[c] = Math.max(p.f.wetness[c], 0.6);
  }
  if (n) p.bump('fire');
  return n;
}

/** temperature (°C) a recipe or agent feels at a cell: fire, lava or the air */
export function heatAt(p: Planet, c: number): number {
  const f = p.f;
  let t = f.temperature[c];
  if (f.fire[c] > 0) t = Math.max(t, 250 + 650 * f.fire[c]);
  if (f.lava[c] > 0.01) t = Math.max(t, 1050);
  return t;
}

const pendingCells: number[] = [];
const pendingStr: number[] = [];

/** One fire step over the active set. */
export function fireStep(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid, geo = p.geo;
  const N = p.count;
  const list = p.scratch.list;
  const n = collectFlags(s.fAct, list, N);
  if (n === 0) return;
  const burnable = canBurn(p);
  const flam = u.content.plantTable.flammability;
  const tick = u.tick;
  const spreadK = p.cfg.fireSpread;
  pendingCells.length = 0;
  pendingStr.length = 0;
  let ashAdded = false;
  let alive = 0;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    let fi = f.fire[c];
    if (fi <= 0) { s.fAct[c] = 0; continue; }
    if (!burnable && f.lava[c] <= 0.01) { f.fire[c] = 0; s.fAct[c] = 0; continue; }
    const fuel = fuelAt(p, c);
    const dry = dryness(p, c);
    // quench by standing water / rain
    let quench = 0;
    if (f.water[c] > 0.03) quench += 1;
    if (f.precip[c] > 0 && f.precipType[c] !== 2 && f.precipType[c] !== 4 && f.precipType[c] !== 7) quench += 0.06 * f.precip[c];
    if (f.snow[c] > 0.05) quench += 0.5;
    const target = Math.min(1, fuel * (0.35 + dry));
    fi += (target - fi) * 0.35 - quench - (fuel < 0.04 ? 0.3 : 0);
    if (fi <= 0.01) {
      f.fire[c] = 0;
      s.fAct[c] = 0;
      continue;
    }
    if (fi > 1) fi = 1;
    f.fire[c] = fi;
    alive++;
    // consume fuel: grass flashes, trees smoulder
    const ws = Math.sqrt(f.windX[c] * f.windX[c] + f.windY[c] * f.windY[c] + f.windZ[c] * f.windZ[c]);
    const burn = fi * 0.07 * (1 + ws / 12);
    const g0 = f.grass[c], s0 = f.shrub[c], t0 = f.tree[c], c0 = f.crop[c];
    f.grass[c] = Math.max(0, g0 - burn * 2.2);
    f.shrub[c] = Math.max(0, s0 - burn * 1.3);
    f.tree[c] = Math.max(0, t0 - burn * 0.55);
    f.crop[c] = Math.max(0, c0 - burn * 2.2);
    const burned = (g0 - f.grass[c]) * 0.3 + (s0 - f.shrub[c]) * 0.6 + (t0 - f.tree[c]) + (c0 - f.crop[c]) * 0.4;
    if (burned > 0) {
      f.ash[c] += burned * 0.02;
      ashAdded = true;
      p.updSurface(c);
    }
    if (f.burnt[c] < 0.55 + 0.45 * fi) f.burnt[c] = 0.55 + 0.45 * fi;
    f.moisture[c] = Math.max(0, f.moisture[c] - 0.02 * fi);
    // spread to neighbours
    const wx = f.windX[c], wy = f.windY[c], wz = f.windZ[c];
    const wn = ws > 1e-6 ? 1 / ws : 0;
    const wStr = Math.min(1, ws / 8);
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (f.fire[o] > 0) continue;
      const fo = fuelAt(p, o);
      if (fo < 0.04) continue;
      const dro = dryness(p, o);
      if (dro <= 0.02) continue;
      const align = (geo.tx[e] * wx + geo.ty[e] * wy + geo.tz[e] * wz) * wn;
      // downwind up to ~3.5x, upwind down to ~0.1x in a strong wind
      const windF = Math.max(0.08, 1 + wStr * (align > 0 ? 2.5 * align : 0.92 * align));
      const rise = (f.surface[o] - f.surface[c]) / (geo.len[e] * p.st.radius);
      const slopeF = Math.max(0.5, Math.min(2.2, 1 + rise * 3));
      const prob = 0.5 * fi * Math.min(1, fo) * dro * (0.4 + flammability(p, o, flam)) * windF * slopeF * spreadK;
      if (hashFloat(c, o, tick, 0xf17e) < prob) { pendingCells.push(o); pendingStr.push(0.25 + 0.3 * fi); }
    }
    // embers leap downwind ahead of strong, wind-driven fires
    if (fi > 0.55 && ws > 5 && hashFloat(c, tick, 0xe1be) < 0.06 * fi * Math.min(2, ws / 10) * spreadK) {
      let cur = c;
      const hops = 2 + (hash32(c, tick, 0xb0b) % 3);
      for (let k = 0; k < hops; k++) {
        let best = -1, bd = 0.2;
        for (let e = g.nbrStart[cur]; e < g.nbrStart[cur + 1]; e++) {
          const d = (geo.tx[e] * wx + geo.ty[e] * wy + geo.tz[e] * wz) * wn;
          if (d > bd) { bd = d; best = g.nbr[e]; }
        }
        if (best < 0) break;
        cur = best;
      }
      if (cur !== c && f.fire[cur] <= 0 && fuelAt(p, cur) > 0.1 && dryness(p, cur) > 0.35) { pendingCells.push(cur); pendingStr.push(0.3); }
    }
  }
  for (let i = 0; i < pendingCells.length; i++) {
    const o = pendingCells[i];
    if (f.fire[o] > 0 || f.water[o] > 0.03) continue;
    f.fire[o] = pendingStr[i];
    s.fAct[o] = 1;
    alive++;
  }
  if (alive === 0) {
    // the last flame on this world went out
    let any = false;
    for (let i = 0; i < n; i++) if (f.fire[list[i]] > 0) { any = true; break; }
    if (!any) u.emit({ t: 'fire.out', planet: p.id });
  }
  p.bump('fire');
  p.bump('burnt');
  if (ashAdded) { p.bump('ash'); p.bump('surface'); p.bump('grass'); p.bump('shrub'); p.bump('tree'); p.bump('crop'); }
}
