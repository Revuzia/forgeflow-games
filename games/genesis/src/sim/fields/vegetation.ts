// GENESIS — vegetation (CONTRACT.md §7, §10; cadence 60, full grid): grass / shrub / tree / crop cover 0..1 with the
// dominant species per functional type, from the tolerances in plants.json.
//
// Per hour and cell: suitability = product of tolerance ramps (slow mean temperature, soil moisture, soil depth,
// salinity, standing water, daily light — day length, aerosols and the eclipse hook all reach plants through light).
// Cover grows logistically toward a capacity (trees shade grass and shrubs) and declines where the place no longer
// suits it; deciduous plants go dormant in the cold. No air or toxic air kills everything slowly; ash smothers low
// plants. Seeds spread to empty neighbours (stateless hashed rolls), and better-suited neighbours slowly take over
// (succession). Burnt scars fade as plants return. Fertility (soil, moisture, ash bonus, salt penalty) is derived here.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { PlantTable } from '../content.ts';
import { hashFloat } from '../core/rng.ts';

export const VEG_CADENCE = 60;
/** vegetation runs half an hour after the climate so the two full-grid passes never share a tick */
export const VEG_OFFSET = 30;

const TYPE_FIELDS = ['grass', 'shrub', 'tree', 'crop'] as const;
const SPECIES_FIELDS = ['grassSpecies', 'shrubSpecies', 'treeSpecies', 'cropSpecies'] as const;

function ramp(x: number, a: number, b: number, c: number, d: number): number {
  if (x <= a || x >= d) return a === b && x === a ? 1 : 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

/** how well species `sp` suits cell c, 0..1 */
export function suitability(p: Planet, t: PlantTable, sp: number, c: number): number {
  const f = p.f, s = p.s;
  const i4 = sp * 4;
  const tf = ramp(s.tempMean[c], t.temp[i4], t.temp[i4 + 1], t.temp[i4 + 2], t.temp[i4 + 3]);
  if (tf <= 0) return 0;
  const w = f.water[c];
  let wf: number;
  if (t.habitat[sp] === 2) {
    // aquatic: needs standing water within its depth band
    const lo = t.waterMin[sp], hi = t.waterMax[sp];
    wf = w < lo ? Math.max(0, w / lo) * (w > 0.5 ? 1 : 0) : w > hi ? Math.max(0, 1 - (w - hi) / (hi * 0.5)) : 1;
    if (wf <= 0) return 0;
    const lf = Math.min(1, s.lightMean[c] / Math.max(0.02, t.light[sp]));
    return tf * wf * lf * (f.salinity[c] <= t.salinity[sp] + 0.01 ? 1 : 0.4);
  }
  const wmax = t.waterMax[sp];
  wf = w <= wmax ? 1 : Math.max(0, 1 - (w - wmax) / 0.3);
  if (wf <= 0) return 0;
  const mf = ramp(f.moisture[c], t.moist[i4], t.moist[i4 + 1], t.moist[i4 + 2], t.moist[i4 + 3] + 1e-6);
  if (mf <= 0) return 0;
  const depth = f.soil[c] + 0.3 * f.sand[c] + 0.5 * f.ash[c];
  const need = t.soil[sp];
  const sf = need <= 0 ? 1 : Math.min(1, Math.sqrt(depth / need));
  const sal = f.salinity[c];
  const saf = sal <= t.salinity[sp] ? 1 : Math.max(0, 1 - (sal - t.salinity[sp]) * 4);
  const lf = Math.min(1, s.lightMean[c] / Math.max(0.02, t.light[sp]));
  const snow = f.snow[c] > 0.6 ? 0.3 : 1;
  return tf * wf * mf * sf * saf * lf * snow;
}

/** can plants live in this air at all */
export function airSupportsLife(p: Planet): boolean {
  const a = p.st.atmosphere;
  return a.pressure >= 0.05 && a.toxicity < 0.6 && (a.co2 > 0 || a.o2 > 0 || a.n2 > 0);
}

/** best wild species of a type for a cell (or -1) */
export function bestSpecies(p: Planet, t: PlantTable, type: number, c: number, includeDomestic = false): { sp: number; suit: number } {
  let best = -1, bs = 0;
  for (const sp of t.byType[type]) {
    if (!includeDomestic && t.domestic[sp]) continue;
    const v = suitability(p, t, sp, c);
    if (v > bs) { bs = v; best = sp; }
  }
  return { sp: best, suit: bs };
}

/** One hourly vegetation pass. */
export function vegetationStep(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid;
  const N = p.count;
  const t = u.content.plantTable;
  const life = airSupportsLife(p);
  const growK = p.cfg.vegGrowth / 24;
  const hour = Math.floor(u.tick / 60);
  const covers = [f.grass, f.shrub, f.tree, f.crop];
  const species = [f.grassSpecies, f.shrubSpecies, f.treeSpecies, f.cropSpecies];
  let total = 0;
  // a lifeless world has nothing to grow or seed: only the derived fields need refreshing
  const lifeless = p.vegTotal <= 0 && !p.vegDirty;
  p.vegDirty = false;
  for (let c = 0; c < N; c++) {
    // pinned biomes hold their painted vegetation (biomes.ts nudges them); others follow the climate
    for (let ti = 0; ti < 4 && !lifeless; ti++) {
      const cov = covers[ti];
      const spf = species[ti];
      let x = cov[c];
      let sp = spf[c];
      if (!life) {
        if (x > 0) { x *= 0.9; if (x < 0.005) { x = 0; } cov[c] = x; }
        continue;
      }
      if (x > 0 && sp >= 0) {
        const suit = suitability(p, t, sp, c);
        const dormant = t.deciduous[sp] && f.temperature[c] < 3;
        let cap = 1;
        if (ti === 0) cap = 1 - 0.55 * f.tree[c] - 0.2 * f.shrub[c];
        else if (ti === 1) cap = 1 - 0.45 * f.tree[c];
        if (cap < 0.05) cap = 0.05;
        let dx = 0;
        if (!dormant) dx += t.growth[sp] * growK * suit * x * (1 - x / cap);
        if (suit < 0.25) dx -= (0.25 - suit) * 0.12 / 24 * 4 * x;
        if (x > cap) dx -= (x - cap) * 0.05;
        if (f.ash[c] > 0.08 && ti !== 2) dx -= 0.04 * x;
        x += dx;
        if (x < 0.003) { x = 0; }
        if (x > 1) x = 1;
        cov[c] = x;
        if (x === 0) spf[c] = -1;
      } else if (ti !== 3) {
        // seeding from the richest neighbour of this type
        let bo = -1, bc = 0.2;
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
          const o = g.nbr[e];
          if (cov[o] > bc && spf[o] >= 0) { bc = cov[o]; bo = o; }
        }
        if (bo >= 0) {
          const so = spf[bo];
          const suit = suitability(p, t, so, c);
          if (suit > 0.08 && hashFloat(c, hour, ti, 0x5eed) < t.spread[so] * bc * suit * 0.35 * p.cfg.vegGrowth) {
            cov[c] = 0.03;
            spf[c] = so;
            x = 0.03;
          }
        }
        if (x === 0) spf[c] = -1;
      }
      // succession: a better-suited neighbouring species slowly takes the cell
      if (x > 0.05 && ti !== 3 && hashFloat(c, hour, ti, 0x5acc) < 0.03) {
        const deg = g.nbrStart[c + 1] - g.nbrStart[c];
        const o = g.nbr[g.nbrStart[c] + ((hour + c) % deg)];
        const so = spf[o];
        if (so >= 0 && so !== spf[c] && cov[o] > 0.3) {
          const cur = suitability(p, t, spf[c], c);
          if (suitability(p, t, so, c) > cur + 0.12) spf[c] = so;
        }
      }
      total += cov[c];
    }
    // scars fade as life returns
    if (f.burnt[c] > 0 && f.fire[c] <= 0) f.burnt[c] = Math.max(0, f.burnt[c] - 0.004 - 0.02 * f.grass[c]);
    // fertility
    if (s.ocean[c] || f.water[c] > 0.5) f.fertility[c] = 0;
    else {
      const soilF = Math.min(1, (f.soil[c] + 0.2 * f.ash[c]) / 0.5);
      let fert = soilF * (0.3 + 0.7 * f.moisture[c]) * (1 - 0.8 * f.salinity[c]);
      if (f.ash[c] > 0.01 && f.moisture[c] > 0.2) fert += 0.25 * Math.min(1, f.ash[c] / 0.15);
      fert -= 0.5 * f.pollution[c];
      f.fertility[c] = fert < 0 ? 0 : fert > 1 ? 1 : fert;
    }
    if (f.pollution[c] > 0) f.pollution[c] = Math.max(0, f.pollution[c] - 0.002);
    if (f.blight[c] > 0) f.blight[c] = Math.max(0, f.blight[c] - 0.01);
  }
  p.vegTotal = total;
  if (total > 0 || life) {
    p.bump('grass'); p.bump('shrub'); p.bump('tree'); p.bump('crop'); p.bump('fertility'); p.bump('burnt');
    p.bump('grassSpecies'); p.bump('shrubSpecies'); p.bump('treeSpecies'); p.bump('cropSpecies');
  }
  // chronicle: the first forest
  if (p.firsts.forest === undefined && life) {
    let forest = 0;
    for (let c = 0; c < N; c += 3) if (f.tree[c] > 0.5) forest++;
    if (forest * 3 > 40) {
      p.firsts.forest = u.tick;
      u.chronicleAdd(p, 'nature', 'The first forest closed its canopy.', 2);
    }
  }
}

/**
 * Plant a species over a disc with smooth falloff (it may die later if the place cannot hold it). Returns the number
 * of cells planted.
 */
export function plantArea(u: Universe, p: Planet, sp: number, pos: ArrayLike<number>, radiusM: number, density: number): number {
  const t = u.content.plantTable;
  const ti = t.type[sp];
  const cov = p.f[TYPE_FIELDS[ti]];
  const spf = p.f[SPECIES_FIELDS[ti]];
  const P = p.grid.pos;
  const ang = Math.max(radiusM / p.st.radius, p.grid.meanEdgeAngle * 0.5);
  let n = 0;
  for (const c of p.cellsNear(pos, radiusM)) {
    if (t.habitat[sp] !== 2 && p.f.water[c] > t.waterMax[sp] + 0.3) continue;
    if (t.habitat[sp] === 2 && p.f.water[c] < 0.5) continue;
    const d = Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
    const k = Math.max(0, 1 - d * d);
    const v = density * (0.35 + 0.65 * k);
    if (v <= 0) continue;
    cov[c] = Math.max(cov[c], Math.min(1, v));
    spf[c] = sp;
    n++;
  }
  p.bump(TYPE_FIELDS[ti]);
  p.bump(SPECIES_FIELDS[ti]);
  p.vegDirty = true;
  return n;
}

/** Grow a forest: the best tree for each cell (or a given species), with understory. Returns cells planted. */
export function forestArea(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, density: number, treeSp = -1): number {
  const t = u.content.plantTable;
  const f = p.f;
  const P = p.grid.pos;
  const ang = Math.max(radiusM / p.st.radius, p.grid.meanEdgeAngle * 0.5);
  let n = 0;
  for (const c of p.cellsNear(pos, radiusM)) {
    if (f.water[c] > 0.3 || p.s.ocean[c]) continue;
    const d = Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
    const k = Math.max(0, 1 - d * d);
    let sp = treeSp;
    if (sp < 0) sp = bestSpecies(p, t, 2, c).sp;
    if (sp < 0) sp = t.byType[2][0];
    f.tree[c] = Math.max(f.tree[c], Math.min(1, density * (0.4 + 0.6 * k)));
    f.treeSpecies[c] = sp;
    const sh = bestSpecies(p, t, 1, c).sp;
    if (sh >= 0) { f.shrub[c] = Math.max(f.shrub[c], 0.3 * density * k); f.shrubSpecies[c] = sh; }
    const gr = bestSpecies(p, t, 0, c).sp;
    if (gr >= 0) { f.grass[c] = Math.max(f.grass[c], 0.4 * density); f.grassSpecies[c] = gr; }
    if (f.soil[c] < 0.3) { f.soil[c] = 0.3; p.updSurface(c); }
    n++;
  }
  p.bump('tree'); p.bump('treeSpecies'); p.bump('shrub'); p.bump('grass'); p.bump('soil'); p.bump('surface');
  p.vegDirty = true;
  return n;
}

/** Initial vegetation for a generated world (amount = the planet kind's vegetation multiplier). */
export function initVegetation(u: Universe, p: Planet, amount: number): void {
  const f = p.f;
  const N = p.count;
  const t = u.content.plantTable;
  const P = p.grid.pos;
  const nz = p.noise;
  if (amount <= 0 || !airSupportsLife(p)) { p.vegTotal = 0; return; }
  const base = [0.85, 0.35, 0.92];
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const patch = 0.5 + 0.5 * nz.fbm(x * 7 + 3, y * 7, z * 7 - 1, 3);
    for (let ti = 0; ti < 3; ti++) {
      const b = bestSpecies(p, t, ti, c);
      if (b.sp < 0 || b.suit < 0.12) continue;
      let v = base[ti] * amount * Math.pow(b.suit, 1.3);
      if (ti === 2) v *= Math.min(1, 0.35 + 1.1 * patch);
      if (ti === 1) v *= 0.5 + patch;
      v = Math.min(1, v);
      if (v < 0.02) continue;
      const cov = f[TYPE_FIELDS[ti]];
      cov[c] = v;
      f[SPECIES_FIELDS[ti]][c] = b.sp;
    }
    // capacities
    f.shrub[c] = Math.min(f.shrub[c], Math.max(0.05, 1 - 0.45 * f.tree[c]));
    f.grass[c] = Math.min(f.grass[c], Math.max(0.05, 1 - 0.55 * f.tree[c] - 0.2 * f.shrub[c]));
  }
  let total = 0;
  for (let c = 0; c < N; c++) total += f.grass[c] + f.shrub[c] + f.tree[c];
  p.vegTotal = total;
  p.bump('grass'); p.bump('shrub'); p.bump('tree');
}

export { TYPE_FIELDS, SPECIES_FIELDS };
