// GENESIS — plant disease (CONTRACT.md §10 "Blight spreads in crops/forests (moisture + monoculture)"): the `blight`
// field 0..1 on the cells where it is active. Blight breaks out where one crop or one kind of tree covers the land
// wall to wall and the ground is wet; it grows with damp and warmth, withers its host (fields fail within days, forests
// thin over weeks) and jumps to neighbouring cells of the same host species. Crop rotation (recipe effect 'blight')
// keeps fields healthier. vegetation.ts lets the field fade by itself where nothing feeds it.
//
//   hourly  active cells: grow, damage the host, spread (the active list is saved, ascending)
//   daily   outbreaks: settlements' monoculture fields, and a sample of dense single-species forests

import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { tell } from '../people/story.ts';
import { accident, libraryEffect } from '../people/knowledge.ts';
import { settlementRef, vars } from '../people/util.ts';
import type { Content } from '../content.ts';
import type { Planet } from '../world/planet.ts';
import { suitability } from '../fields/vegetation.ts';

/** blight multiplier from what a settlement knows (crop rotation, ...) */
function rotation(x: PCtx, st: Settlement | undefined): number {
  if (!st) return 1;
  return libraryEffect(x, st, 'blight');
}

/** the host of a cell: 3 = crop, 2 = tree, -1 none; and its species */
function host(x: PCtx, c: number): { type: number; sp: number; cover: number } {
  const f = x.p.f;
  if (f.crop[c] > 0.03 && f.cropSpecies[c] >= 0) return { type: 3, sp: f.cropSpecies[c], cover: f.crop[c] };
  if (f.tree[c] > 0.2 && f.treeSpecies[c] >= 0) return { type: 2, sp: f.treeSpecies[c], cover: f.tree[c] };
  return { type: -1, sp: -1, cover: 0 };
}

/** cells with active blight at most (a blight that big has made its point) */
const MAX_ACTIVE = 500;

function warmth(t: number): number {
  return t < 2 ? 0 : t < 12 ? (t - 2) / 10 : t < 30 ? 1 : Math.max(0, 1 - (t - 30) / 10);
}

function addActive(x: PCtx, c: number): void {
  const l = x.ps.blight;
  let lo = 0, hi = l.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < c) lo = m + 1; else hi = m; }
  if (l[lo] !== c) l.splice(lo, 0, c);
}

/** hourly: active blight grows with damp and warmth, withers its host, spreads to the same host next door */
export function blightStep(x: PCtx): void {
  const l = x.ps.blight;
  if (!l.length) return;
  const f = x.p.f, g = x.p.grid;
  const B = f.blight;
  let touched = false;
  const spread: number[] = [];
  const keep: number[] = [];
  for (const c of l) {
    const hst = host(x, c);
    const st = f.territory[c] >= 0 ? x.ps.settlement(f.territory[c]) : undefined;
    if (hst.type < 0) {
      B[c] = Math.max(0, B[c] - 0.05);
    } else {
      const moist = Math.min(1, f.moisture[c] + (f.precip[c] > 0.5 ? 0.3 : 0));
      // fields are soft; a forest fights back (it only loses ground where it is wet and warm, and recovers elsewhere)
      const grow = 0.045 * moist * warmth(f.temperature[c]) * Math.min(1, hst.cover * 1.5) * rotation(x, st) - (hst.type === 2 ? 0.022 : 0);
      B[c] = Math.max(0, Math.min(1, B[c] + grow));
      // the host withers
      if (hst.type === 3) f.crop[c] = Math.max(0, f.crop[c] - B[c] * 0.035);
      else f.tree[c] = Math.max(0, f.tree[c] - B[c] * 0.003);
      touched = true;
      // spores on the wind and the rain: the same species next door
      if (B[c] > 0.15 && l.length < MAX_ACTIVE) {
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
          const o = g.nbr[e];
          if (B[o] >= 0.08) continue;
          const ho = host(x, o);
          if (ho.type < 0 || (ho.type === 2 && x.p.f.tree[o] < 0.5)) continue;
          const same = ho.type === hst.type && ho.sp === hst.sp ? 1 : 0.15;
          const k = hst.type === 3 ? 0.12 : 0.05;
          if (hashFloat(c, o, x.tick, 0xb119) < B[c] * k * same * Math.min(1, f.moisture[o] * 1.5)) spread.push(o);
        }
      }
    }
    if (B[c] > 0.01) keep.push(c); else B[c] = 0;
  }
  x.ps.blight = keep;
  for (const o of spread) { if (B[o] < 0.08) B[o] = 0.08; addActive(x, o); }
  if (touched || spread.length) { x.p.bump('blight'); x.p.bump('crop'); }
}

/** start blight at cell c */
export function blightAt(x: PCtx, c: number, level = 0.15): void {
  const B = x.p.f.blight;
  B[c] = Math.max(B[c], level);
  addActive(x, c);
  x.p.bump('blight');
}

/** daily: outbreaks in monoculture fields and dense single-species forests */
export function blightDaily(x: PCtx): void {
  const f = x.p.f, g = x.p.grid;
  // fields: one crop wall to wall, wet ground
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || st.band || st.fields.length < 3) continue;
    let same = 0, moist = 0, sick = 0;
    for (const c of st.fields) {
      if (f.cropSpecies[c] === st.crop) same++;
      moist += f.moisture[c];
      if (f.blight[c] > 0.05) sick++;
    }
    if (sick) continue;
    const mono = (same / st.fields.length) * Math.min(1, st.fields.length / 8);
    const wet = moist / st.fields.length;
    const p = 0.03 * mono * Math.max(0, wet - 0.25) * 2 * rotation(x, st);
    if (hashFloat(st.id, x.tick, 0xb11a) >= p) continue;
    const c = st.fields[hash32(st.id, x.tick, 0xb11b) % st.fields.length];
    blightAt(x, c, 0.2);
    const crop = x.c.plants.list[st.crop]?.name.toLowerCase() ?? 'crops';
    tell(x.u, x.p, 'blight', vars(x, st, -1, { crop }), st, [settlementRef(x, st)]);
    x.u.emit({ t: 'blight', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { crop } });
    accident(x, st, 'blight', c);
  }
  // forests: a sample of cells; a stand of one tree species on wet ground may sicken
  const N = x.p.count;
  for (let k = 0; k < 48; k++) {
    const c = hash32(x.tick, x.p.seed, k, 0xb11c) % N;
    if (f.tree[c] < 0.6 || f.moisture[c] < 0.55 || f.blight[c] > 0) continue;
    const sp = f.treeSpecies[c];
    let mono = 0, deg = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { deg++; const o = g.nbr[e]; if (f.treeSpecies[o] === sp && f.tree[o] > 0.5) mono++; }
    if (mono < deg - 1) continue;
    if (hashFloat(c, x.tick, 0xb11d) < 0.02 && x.ps.blight.length < MAX_ACTIVE) blightAt(x, c, 0.12);
  }
}

/** share of a settlement's fields that are blighted (famine warnings, inspector) */
export function blightedShare(x: PCtx, st: Settlement): number {
  if (!st.fields.length) return 0;
  let n = 0;
  for (const c of st.fields) if (x.p.f.blight[c] > 0.1) n++;
  return n / st.fields.length;
}

// ───────────────────────────── LIVING CONTENT (§4.3): what the wild plants give ─────────────────────────────
//
// Fruit trees give their fruit in season (plants.json `fruit`), wild herbs, mushrooms and the seed of wild grasses
// are gathered where they grow (`gather`). A plant that holds its layer's dominant slot at a cell gives there in full; a
// plant that suits a cell without holding it grows scattered through the cover (wild apples in the woods, figs along
// the scrub, mushrooms under the trees): a share by how well it suits the place. Understory plants (mushrooms, wild
// herbs) never hold the slot (content.ts compilePlants): they are always the scattered kind. people/resources.ts asks
// plantYield for every item that has no availability rule of its own.


/** one plant source of an item: the plant, its layer (0 grass, 1 shrub, 2 tree), how much it gives, its season */
interface PlantSource { sp: number; layer: number; qty: number; season: [number, number] | null; understory: boolean; shade: boolean }

const srcCache = new WeakMap<Content, Map<number, PlantSource[]>>();

/** item index -> its plant sources (fruit and gather of every plant), per content */
export function plantSources(c: Content): Map<number, PlantSource[]> {
  let m = srcCache.get(c);
  if (m) return m;
  m = new Map();
  const add = (it: number, s: PlantSource) => { if (it < 0) return; let l = m!.get(it); if (!l) m!.set(it, (l = [])); l.push(s); };
  c.plants.list.forEach((pl, sp) => {
    if (pl.type === 'crop') return;
    const layer = pl.type === 'tree' ? 2 : pl.type === 'shrub' ? 1 : 0;
    const base = { sp, layer, understory: !!pl.understory, shade: !!pl.understory && pl.light < 0.1 };
    if (pl.fruit) add(c.items.idx(pl.fruit.item), { ...base, qty: pl.fruit.qty, season: pl.fruit.season ?? null });
    for (const g of pl.gather ?? []) add(c.items.idx(g.item), { ...base, qty: g.qty, season: g.season ?? null });
  });
  srcCache.set(c, m);
  return m;
}

/** does item `it` come from a plant (a fruit or something gathered) */
export function plantSourced(c: Content, it: number): boolean {
  return plantSources(c).has(it);
}

/** the wild grasses whose seed is gathered as `item` (people/resources.ts: wild grain from wild barley, sorghum, lentils) */
export function plantsGiving(c: Content, item: string): number[] {
  const it = c.items.idx(item);
  return (plantSources(c).get(it) ?? []).map((s) => s.sp);
}

const phaseCache = new WeakMap<Planet, { hour: number; ph: number }>();

/**
 * The local year's phase at cell c of p (0 spring equinox, 0.25 midsummer, 0.5 autumn, 0.75 midwinter of the cell's own
 * hemisphere), from the sun's declination and where it is heading (as people/crops.ts yearPhase, computed once an hour
 * per world); -1 where the year has no seasons (no axial tilt, or within 15° of the equator).
 */
export function seasonPhase(u: { sun(p: Planet, tick: number): { dir: ArrayLike<number> } }, p: Planet, tick: number, c: number): number {
  const tilt = Math.abs(p.st.axialTilt || 0);
  if (tilt < 0.05) return -1;
  const lat = p.grid.pos[c * 3 + 1];
  if (Math.abs(lat) < 0.26) return -1;
  const hour = Math.floor(tick / 60);
  let e = phaseCache.get(p);
  if (!e || e.hour !== hour) {
    const t = hour * 60;
    const d = u.sun(p, t).dir[1];
    const d2 = u.sun(p, t + Math.max(60, Math.round(p.st.orbit.period / 50))).dir[1];
    const s = Math.max(-1, Math.min(1, d / Math.sin(tilt)));
    const a = Math.asin(s) / (Math.PI * 2);
    const ph = d2 >= d ? (a < 0 ? a + 1 : a) : 0.5 - a;
    e = { hour, ph: ph - Math.floor(ph) };
    phaseCache.set(p, e);
  }
  let ph = e.ph;
  if (lat < 0) ph += 0.5;
  return ph - Math.floor(ph);
}

function inSeason(ph: number, w: [number, number]): boolean {
  return w[0] <= w[1] ? ph >= w[0] && ph <= w[1] : ph >= w[0] || ph <= w[1];
}

/** the share of a full stand a plant that suits a cell gives where it grows scattered through other cover */
export const SCATTERED = 0.18;

/**
 * How much of item `it` a gatherer finds at cell c from the wild plants (0 none .. 1 rich): for each plant source, its
 * stand where it holds the layer (the layer's cover), else its scattered share (SCATTERED × suitability × the cover it
 * grows under: the woods for shade plants, the herb and shrub layers for the rest); fruit only in its season (half as
 * much all year where the year has no seasons), nothing on frozen ground.
 */
export function plantYield(x: PCtx, it: number, c: number): number {
  const srcs = plantSources(x.c).get(it);
  if (!srcs) return 0;
  const p = x.p, f = p.f;
  if (f.temperature[c] < 1 || f.water[c] > 0.3) return 0;
  const t = x.c.plantTable;
  let v = 0;
  let ph = -2;
  for (const s of srcs) {
    let k = 1;
    if (s.season) {
      if (ph === -2) ph = seasonPhase(x.u, p, x.tick, c);
      k = ph < 0 ? 0.5 : inSeason(ph, s.season) ? 1 : 0;
      if (!k) continue;
    }
    const cover = s.layer === 2 ? f.tree[c] : s.layer === 1 ? f.shrub[c] : f.grass[c];
    const dom = s.layer === 2 ? f.treeSpecies[c] : s.layer === 1 ? f.shrubSpecies[c] : f.grassSpecies[c];
    let a: number;
    if (!s.understory && dom === s.sp) a = cover * 0.9;
    else {
      const under = s.shade ? f.tree[c] : s.understory ? Math.max(f.grass[c], f.shrub[c]) : Math.max(cover, s.layer === 2 ? f.shrub[c] * 0.5 : 0);
      if (under < 0.05) continue;
      const suit = suitability(p, t, s.sp, c);
      if (suit < 0.2) continue;
      a = SCATTERED * suit * under * (s.understory ? 3 : 1);
    }
    v += a * k * Math.min(1.5, s.qty);
  }
  return v > 1 ? 1 : v;
}
