// GENESIS — biomes (CONTRACT.md §7.1; cadence 720): classification of every cell from its climate and ground by the
// ordered, data-driven rules in biomes.json (first match wins), plus painting and pinning.
//
// Painting a biome sets the cell's vegetation, soil, sand, snow, ice, ash, moisture and water toward the biome's
// `paint` targets. Unpinned cells then live under their real climate and drift back (vegetation dies or spreads,
// snow melts, the classifier re-reads the result). Pinned cells keep their biome: every biome pass nudges them back
// toward the painted state, so a pinned rainforest in a desert stays green.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { BiomeDef, BiomeRule, Content } from '../content.ts';
import { BIOME_VARS } from '../content.ts';
import { bestSpecies, SPECIES_FIELDS, TYPE_FIELDS } from './vegetation.ts';
import { activateCell } from './hydrology.ts';

export const BIOME_CADENCE = 720;

interface CompiledRule {
  biome: number;
  all: Float64Array; // triples (var, op, value)
  any: Float64Array;
}

const OPS = ['<', '<=', '>', '>=', '==', '!='];
const compiled = new WeakMap<Content, CompiledRule[]>();

function compile(content: Content): CompiledRule[] {
  let r = compiled.get(content);
  if (r) return r;
  const pack = (conds: BiomeRule['all']) => {
    const a = new Float64Array((conds?.length ?? 0) * 3);
    (conds ?? []).forEach((c, i) => {
      a[i * 3] = BIOME_VARS.indexOf(c[0]);
      a[i * 3 + 1] = OPS.indexOf(c[1]);
      a[i * 3 + 2] = c[2];
    });
    return a;
  };
  r = content.biomeRules.map((rule) => ({ biome: content.biomes.idx(rule.biome), all: pack(rule.all), any: pack(rule.any) }));
  compiled.set(content, r);
  return r;
}

function test(v: number, op: number, x: number): boolean {
  switch (op) {
    case 0: return v < x;
    case 1: return v <= x;
    case 2: return v > x;
    case 3: return v >= x;
    case 4: return v === x;
    default: return v !== x;
  }
}

const vars = new Float64Array(BIOME_VARS.length);

/** fill the classifier variables for a cell */
function readVars(p: Planet, c: number): void {
  const f = p.f, s = p.s, g = p.grid;
  const air = p.st.atmosphere;
  let mx = 0, coast = 0;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    const d = Math.abs(f.surface[o] - f.surface[c]);
    if (d > mx) mx = d;
    if (s.ocean[o] && !s.ocean[c]) coast = 1;
  }
  vars[0] = air.pressure;
  vars[1] = air.toxicity;
  vars[2] = s.ocean[c];
  vars[3] = coast;
  vars[4] = f.water[c];
  vars[5] = s.seaIce[c];
  vars[6] = s.tempYear[c];
  vars[7] = f.moisture[c];
  vars[8] = f.surface[c] - p.st.seaLevel;
  vars[9] = mx / p.edgeM;
  vars[10] = f.sand[c];
  vars[11] = f.snow[c];
  vars[12] = f.ice[c];
  vars[13] = f.lava[c];
  vars[14] = f.ash[c];
  vars[15] = f.soil[c];
  vars[16] = f.salinity[c];
  vars[17] = f.tree[c];
  vars[18] = f.shrub[c];
  vars[19] = f.grass[c];
}

/** classify one cell (biome index) */
export function classifyCell(u: Universe, p: Planet, c: number): number {
  const rules = compile(u.content);
  readVars(p, c);
  for (const r of rules) {
    let ok = true;
    for (let i = 0; i < r.all.length; i += 3) if (!test(vars[r.all[i]], r.all[i + 1], r.all[i + 2])) { ok = false; break; }
    if (!ok) continue;
    if (r.any.length) {
      let anyOk = false;
      for (let i = 0; i < r.any.length; i += 3) if (test(vars[r.any[i]], r.any[i + 1], r.any[i + 2])) { anyOk = true; break; }
      if (!anyOk) continue;
    }
    return r.biome;
  }
  return 0;
}

/** the compiled rules flattened into typed arrays (per content; a cache): per rule its biome and the [start, end) of its
 * `all` and `any` triples in `conds` */
interface FlatRules { n: number; biome: Int32Array; allS: Int32Array; allE: Int32Array; anyS: Int32Array; anyE: Int32Array; conds: Float64Array }
const flatCache = new WeakMap<Content, FlatRules>();
function flatRules(content: Content): FlatRules {
  let f = flatCache.get(content);
  if (f) return f;
  const rules = compile(content);
  let total = 0;
  for (const r of rules) total += r.all.length + r.any.length;
  const n = rules.length;
  f = { n, biome: new Int32Array(n), allS: new Int32Array(n), allE: new Int32Array(n), anyS: new Int32Array(n), anyE: new Int32Array(n), conds: new Float64Array(total) };
  let k = 0;
  rules.forEach((r, i) => {
    f!.biome[i] = r.biome;
    f!.allS[i] = k; f!.conds.set(r.all, k); k += r.all.length; f!.allE[i] = k;
    f!.anyS[i] = k; f!.conds.set(r.any, k); k += r.any.length; f!.anyE[i] = k;
  });
  flatCache.set(content, f);
  return f;
}

/** classifyCell's rule walk over flattened rules and filled variables (first match wins; 0 when none) */
function classifyFlat(fr: FlatRules, v: Float64Array): number {
  const conds = fr.conds;
  for (let r = 0; r < fr.n; r++) {
    let ok = true;
    for (let i = fr.allS[r], e = fr.allE[r]; i < e; i += 3) if (!test(v[conds[i]], conds[i + 1], conds[i + 2])) { ok = false; break; }
    if (!ok) continue;
    const a0 = fr.anyS[r], a1 = fr.anyE[r];
    if (a1 > a0) {
      let anyOk = false;
      for (let i = a0; i < a1; i += 3) if (test(v[conds[i]], conds[i + 1], conds[i + 2])) { anyOk = true; break; }
      if (!anyOk) continue;
    }
    return fr.biome[r];
  }
  return 0;
}

/** Re-classify every cell; pinned cells keep their biome and are nudged back toward its painted state. (readVars and
 * classifyCell, with the planet's arrays read once and the rules flattened — same variables, same rule order.) */
export function biomeStep(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid;
  const N = p.count;
  const fr = flatRules(u.content);
  const v = vars;
  const air = p.st.atmosphere;
  const seaLevel = p.st.seaLevel, edgeM = p.edgeM;
  const nbrStart = g.nbrStart, nbr = g.nbr;
  const surface = f.surface, ocean = s.ocean, water = f.water, seaIce = s.seaIce, tempMean = s.tempYear;
  const moisture = f.moisture, sand = f.sand, snow = f.snow, ice = f.ice, lava = f.lava, ash = f.ash, soil = f.soil;
  const salinity = f.salinity, tree = f.tree, shrub = f.shrub, grass = f.grass, pinnedBiome = s.pinnedBiome, biome = f.biome;
  for (let c = 0; c < N; c++) {
    const pin = pinnedBiome[c];
    if (pin >= 0) {
      biome[c] = pin;
      applyPaint(u, p, c, u.content.biomes.list[pin], 0.25, false);
      continue;
    }
    let mx = 0, coast = 0;
    const sc = surface[c];
    const oc = ocean[c];
    const e1 = nbrStart[c + 1];
    for (let e = nbrStart[c]; e < e1; e++) {
      const o = nbr[e];
      const d = Math.abs(surface[o] - sc);
      if (d > mx) mx = d;
      if (ocean[o] && !oc) coast = 1;
    }
    v[0] = air.pressure;
    v[1] = air.toxicity;
    v[2] = oc;
    v[3] = coast;
    v[4] = water[c];
    v[5] = seaIce[c];
    v[6] = tempMean[c];
    v[7] = moisture[c];
    v[8] = sc - seaLevel;
    v[9] = mx / edgeM;
    v[10] = sand[c];
    v[11] = snow[c];
    v[12] = ice[c];
    v[13] = lava[c];
    v[14] = ash[c];
    v[15] = soil[c];
    v[16] = salinity[c];
    v[17] = tree[c];
    v[18] = shrub[c];
    v[19] = grass[c];
    biome[c] = classifyFlat(fr, v);
  }
  p.bump('biome');
}

/** move a cell toward a biome's paint targets by fraction k (1 = set) */
function applyPaint(u: Universe, p: Planet, c: number, def: BiomeDef, k: number, allowWater: boolean): void {
  const f = p.f;
  const t = u.content.plantTable;
  const pt = def.paint;
  const lerp = (a: number, b: number) => a + (b - a) * k;
  for (let ti = 0; ti < 4; ti++) {
    const key = TYPE_FIELDS[ti];
    const target = pt[key];
    if (target === undefined) continue;
    const cov = f[key];
    cov[c] = Math.max(0, Math.min(1, lerp(cov[c], target)));
    const spf = f[SPECIES_FIELDS[ti]];
    if (cov[c] > 0.001) {
      const want = pt.species?.[key];
      const idx = want ? u.content.plants.idx(want) : -1;
      if (idx >= 0) spf[c] = idx;
      else if (spf[c] < 0) {
        const b = bestSpecies(p, t, ti, c, ti === 3);
        spf[c] = b.sp >= 0 ? b.sp : t.byType[ti][0] ?? -1;
      }
    } else { cov[c] = 0; spf[c] = -1; }
  }
  let ground = false;
  for (const key of ['soil', 'sand', 'snow', 'ice', 'ash'] as const) {
    const target = pt[key];
    if (target === undefined) continue;
    const v = Math.max(0, lerp(f[key][c], target));
    if (v !== f[key][c]) { f[key][c] = v; ground = true; }
  }
  if (pt.moisture !== undefined) f.moisture[c] = Math.max(0, Math.min(1, lerp(f.moisture[c], pt.moisture)));
  if (allowWater && pt.water !== undefined && f.water[c] < pt.water) {
    const add = (pt.water - f.water[c]) * k;
    f.water[c] += add;
    p.hydro.sourced += add * p.cellArea[c];
    activateCell(p, c);
  }
  if (ground) { p.updSurface(c); activateCell(p, c); }
}

/** Paint a biome over a disc (smooth edge). Pinned: the cells keep it. Returns cells painted. */
export function paintBiome(u: Universe, p: Planet, biome: number, pos: ArrayLike<number>, radiusM: number, pinned: boolean, strength = 1): number {
  const def = u.content.biomes.list[biome];
  if (!def) return 0;
  const P = p.grid.pos;
  const ang = Math.max(radiusM / p.st.radius, p.grid.meanEdgeAngle * 0.5);
  const cells = p.cellsNear(pos, radiusM).slice();
  for (const c of cells) {
    const d = Math.acos(Math.min(1, P[c * 3] * pos[0] + P[c * 3 + 1] * pos[1] + P[c * 3 + 2] * pos[2])) / ang;
    const k = Math.min(1, Math.max(0, (1.15 - d) / 0.4)) * strength;
    if (k <= 0) continue;
    applyPaint(u, p, c, def, k, true);
    p.vegDirty = true;
    p.f.biome[c] = biome;
    if (pinned) p.s.pinnedBiome[c] = biome;
  }
  for (const k of ['grass', 'shrub', 'tree', 'crop', 'grassSpecies', 'shrubSpecies', 'treeSpecies', 'cropSpecies', 'soil', 'sand', 'snow', 'ice', 'ash', 'moisture', 'surface', 'water', 'biome'] as const) p.bump(k);
  return cells.length;
}

/** pin (keep) or unpin the biome of every cell in a disc; returns cells changed */
export function pinBiome(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, on: boolean): number {
  let n = 0;
  for (const c of p.cellsNear(pos, radiusM)) {
    const v = on ? p.f.biome[c] : -1;
    if (p.s.pinnedBiome[c] !== v) { p.s.pinnedBiome[c] = v; n++; }
  }
  return n;
}

/** classify everything once (generation) */
export function initBiomes(u: Universe, p: Planet): void {
  for (let c = 0; c < p.count; c++) p.f.biome[c] = classifyCell(u, p, c);
  p.bump('biome');
}
