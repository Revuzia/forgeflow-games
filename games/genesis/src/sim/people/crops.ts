// GENESIS — LIVING LAND (LIVING.md §2.4): crops on a seasonal clock. Crops grew on the wild logistic from 0.06 and had to
// reach 0.55 to be cut — one sowing in five was ever harvested — every crop came in as `grain`, and fields lay on cells
// where their crop could not grow.
//
// Now a field (Settlement.land.fields: FieldState) is sown in its crop's SOWING WINDOW (plants.json `season.sow`,
// fractions of the local year from the spring equinox — the hemisphere's own; within 15° of the equator sowing follows the
// rains: the soil wet enough for the crop), GROWS on a fixed clock of `season.grow` game days scaled hour by hour by how
// well the cell suits it (temperature, moisture, soil: fields/vegetation.ts suitability; no growth while frost holds it),
// and RIPENS; a ripe field is harvested within three days or starts to spoil on the stalk. What the field shows
// (f.crop, drawn by the renderer) follows its growth; what grazing herds, blight, fire or flood take from that cover is
// taken from the field's health and so from its yield. Each crop yields its own items (plants.json `harvest`): wheat
// grain, rice, maize, flax fibre and linseed (an item the content does not have falls back to grain for a food crop).
// Fields are sited by the crop's suitability, never on saturated or salt ground; flax is sown beside the staple when
// fibre is wanted and flax grows within the territory (it has no wild ancestor: someone must have brought it). The
// books keep sowings, harvests and their units by crop, and fields lost before the harvest.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import type { PlantDef } from '../content.ts';
import { ERAS } from '../content.ts';
import { hashFloat } from '../core/rng.ts';
import { NS, SKILL, TASK } from './defs.ts';
import { suitability } from '../fields/vegetation.ts';
import { cellPos, distM, sunAt, spotInCell } from './world.ts';
import { BuildingFlag } from '../types.ts';
import { libHas, libraryEffect } from './knowledge.ts';
import { storeAdd, storeAny, storeHas, storeTakeAny } from './store.ts';
import { practise } from './lifecycle.ts';
import { itemIdx } from './resources.ts';
import { emitSt } from './util.ts';
import { addFood, bump, landOf, ledger, type FieldState } from './ledger.ts';
import { seedItems } from './decide.ts';
import { cohortTotal } from './cohorts.ts';

/** days a ripe field waits for the harvest before it starts to spoil, and the share it loses a day after that */
export const RIPE_DAYS = 3;
export const SPOIL_PER_DAY = 0.15;
/** the season of a crop that has none in its data */
const DEFAULT_SEASON = { sow: [0, 0.25] as [number, number], grow: 4 };
/** the share of the cover blight withers that is lost from the harvest (the rest of the grain ripens all the same) */
export const BLIGHT_COST = 0.3;
/** seed a field takes to sow (units of seed-tagged items) */
export const SEED_UNITS = 3;
/** the crop cover a field shows when sown, and at its ripest */
const SHOW_SOWN = 0.06, SHOW_RIPE = 0.9;


/**
 * The local year's phase at cell c: the fraction of the year since the spring equinox of the cell's own hemisphere
 * (0 spring, 0.25 midsummer, 0.5 autumn, 0.75 midwinter), from the sun's declination now and where it is heading.
 * -1 where the year has no seasons to speak of: a world without axial tilt, or within 15° of the equator.
 */
export function yearPhase(x: PCtx, c: number): number {
  const p = x.p;
  const tilt = Math.abs(p.st.axialTilt || 0);
  if (tilt < 0.05) return -1;
  const lat = p.grid.pos[c * 3 + 1];
  if (Math.abs(lat) < 0.26) return -1;
  const d = sunAt(x.u, p, x.tick).dir[1];
  const d2 = sunAt(x.u, p, x.tick + Math.max(60, Math.round(p.st.orbit.period / 50))).dir[1];
  const s = Math.max(-1, Math.min(1, d / Math.sin(tilt)));
  const a = Math.asin(s) / (Math.PI * 2);
  let ph = d2 >= d ? (a < 0 ? a + 1 : a) : 0.5 - a;
  if (lat < 0) ph += 0.5;
  return ph - Math.floor(ph);
}

/** is fraction `ph` of the year inside the window [from, to] (which may wrap past 1) */
function inWindow(ph: number, w: [number, number]): boolean {
  const [a, b] = w;
  return a <= b ? ph >= a && ph <= b : ph >= a || ph <= b;
}

function seasonOf(def: PlantDef): { sow: [number, number]; grow: number } {
  return def.season ?? DEFAULT_SEASON;
}

/** may crop sp be sown at cell c now (its sowing window; in the tropics and on worlds without seasons, the rains) */
export function sowingTime(x: PCtx, sp: number, c: number): boolean {
  const def = x.c.plants.list[sp];
  if (!def) return false;
  const ph = yearPhase(x, c);
  if (ph < 0) return x.p.f.moisture[c] >= def.moisture[1] && x.p.f.temperature[c] > def.temp[0] + 2;
  return inWindow(ph, seasonOf(def).sow);
}

/** can a field of crop sp lie at cell c: it suits the crop, and the ground is neither saturated nor salt */
export function fieldSite(x: PCtx, sp: number, c: number): number {
  const f = x.p.f;
  const def = x.c.plants.list[sp];
  if (!def) return 0;
  if (f.water[c] > Math.max(0.05, def.water[1]) || f.salinity[c] > def.salinity) return 0;
  if (f.moisture[c] >= 0.9 && def.habitat !== 'shore') return 0;
  return suitability(x.p, x.c.plantTable, sp, c);
}

/** the field state of cell c in st (a field sown before the seasonal clock is adopted with the growth it shows) */
export function fieldOf(x: PCtx, st: Settlement, c: number): FieldState {
  const L = landOf(st);
  for (const fs of L.fields) if (fs.c === c) return fs;
  return adoptField(x, st, c);
}

/** take up a field the seasonal clock does not know yet (a 1.4 save's, or one the god laid out) */
export function adoptField(x: PCtx, st: Settlement, c: number): FieldState {
  const f = x.p.f;
  const sp = f.cropSpecies[c];
  const sown = sp >= 0 && x.c.plants.list[sp]?.domestic && f.crop[c] > 0.03;
  const fs: FieldState = {
    c, sp: sown ? sp : -1, sown: sown ? x.tick : -1, prog: sown ? Math.min(0.99, Math.max(0, (f.crop[c] - SHOW_SOWN) / 0.49)) : 0, q: 1, t: x.tick,
    ripe: -1, shown: f.crop[c],
  };
  const L = landOf(st);
  L.fields.push(fs);
  L.fields.sort((a, b) => a.c - b.c);
  if (!st.fields.includes(c)) { st.fields.push(c); st.fields.sort((a, b) => a - b); }
  return fs;
}

/** the crop cover a field shows */
function shownOf(fs: FieldState): number {
  if (fs.sp < 0) return 0.02;
  return Math.min(SHOW_RIPE, SHOW_SOWN + (SHOW_RIPE - SHOW_SOWN) * Math.min(1, fs.prog)) * Math.max(0.05, fs.q);
}

/**
 * Hourly (people/land.ts, `hours` the window the settlement step stands for): every field grows by the hours since it
 * was last brought up to date, scaled by its suitability; what it lost of its cover since the last hour (grazing,
 * blight, fire, flood) is lost from its health; a ripe field left standing spoils; the cover shown follows.
 */
export function cropsHourly(x: PCtx, st: Settlement): void {
  const L = landOf(st);
  // fields the settlement knows that the clock does not (a field laid out before, or by the god)
  if (st.fields.length !== L.fields.length) {
    for (const c of st.fields) if (!L.fields.some((fs) => fs.c === c)) adoptField(x, st, c);
    if (L.fields.length !== st.fields.length) L.fields = L.fields.filter((fs) => st.fields.includes(fs.c));
  }
  const f = x.p.f;
  const t = x.c.plantTable;
  let bumped = false;
  for (const fs of L.fields) {
    const c = fs.c;
    const dt = x.tick - fs.t;
    fs.t = x.tick;
    if (fs.sp < 0) {
      if (f.crop[c] !== 0.02 || f.cropSpecies[c] !== st.crop) { f.crop[c] = 0.02; if (st.crop >= 0) f.cropSpecies[c] = st.crop; bumped = true; }
      fs.shown = 0.02;
      continue;
    }
    // what the land took from it since the last hour: grazing, fire, flood, or the cell no longer suits it — in full; the
    // part blight withered (life/plants.ts takes up to 3.5 % of the cover an hour at full blight) costs the grain less:
    // the ears ripen on withered leaves, and the farmers cut the sick plants out (tending)
    const now = f.crop[c];
    if (f.cropSpecies[c] !== fs.sp) fs.q = 0;
    else if (now < fs.shown - 0.02) {
      let drop = fs.shown - now;
      const bl = f.blight[c];
      if (bl > 0.02) {
        const byBlight = Math.min(drop, bl * 0.035 * Math.max(1, dt / 60) + 0.01);
        drop -= byBlight * (1 - BLIGHT_COST);
      }
      const kept = Math.max(0, 1 - drop / Math.max(0.01, fs.shown));
      fs.q = Math.round(fs.q * kept * 10000) / 10000;
    }
    if (f.water[c] > 0.3 && t.habitat[fs.sp] !== 1) fs.q *= Math.pow(0.9, dt / 60); // drowned
    const def = x.c.plants.list[fs.sp];
    if (fs.ripe < 0 && dt > 0) {
      const grow = Math.max(0.5, seasonOf(def).grow) * x.day;
      const frost = f.temperature[c] < 3;
      const suit = frost ? 0 : suitability(x.p, t, fs.sp, c);
      fs.prog = Math.min(1, fs.prog + (dt / grow) * suit);
      if (suit < 0.1 && !frost) fs.q *= Math.pow(0.97, dt / 60); // wilting where it should not have been sown
      if (fs.prog >= 1) fs.ripe = x.tick;
    } else if (fs.ripe >= 0 && x.tick - fs.ripe > RIPE_DAYS * x.day && dt > 0) {
      fs.q *= Math.pow(1 - SPOIL_PER_DAY, dt / x.day);
    }
    fs.q = Math.round(fs.q * 10000) / 10000;
    if (fs.q < 0.05) {
      // lost before the harvest: fallow again
      ledger(x, st).spoiled++;
      fallow(fs);
    }
    const show = Math.round(shownOf(fs) * 10000) / 10000;
    if (f.crop[c] !== show || f.cropSpecies[c] !== (fs.sp >= 0 ? fs.sp : st.crop)) {
      f.crop[c] = show;
      f.cropSpecies[c] = fs.sp >= 0 ? fs.sp : st.crop >= 0 ? st.crop : f.cropSpecies[c];
      bumped = true;
    }
    fs.shown = f.crop[c];
  }
  if (bumped) { x.p.bump('crop'); x.p.bump('cropSpecies'); }
}

function fallow(fs: FieldState): void {
  fs.sp = -1; fs.sown = -1; fs.prog = 0; fs.q = 1; fs.ripe = -1; fs.shown = 0.02;
}

/** daily (people/land.ts): fallow fields where the crop can no longer grow (flooded, salted, the climate moved), or
 * that lie on the village's own ground, are given up — the clock forgets them and the land goes wild (settlement.ts
 * daily drops them from st.fields) */
export function pruneFields(x: PCtx, st: Settlement): void {
  const L = st.land;
  if (!L || !L.fields.length || st.crop < 0) return;
  // (and fallow fields on the village's own ground: the houses need it)
  const keep = L.fields.filter((fs) => fs.sp >= 0 || (fieldSite(x, st.crop, fs.c) >= 0.05 && !villageGround(x, st, fs.c)));
  if (keep.length === L.fields.length) return;
  L.fields = keep;
  st.fields = st.fields.filter((c) => keep.some((fs) => fs.c === c));
}

/**
 * The village's own ground: the centre cell and the cells the houses spread over (buildings.ts findSite places them on
 * a spiral out to ~4.2 √(buildings + 90) m), kept free of fields. A town of 52 whose houses burned could not rebuild
 * them for five years: two of the six cells around its centre were fields, and a third of the places the builders
 * looked at lay in them (live/whynosite.ts).
 */
export function villageGround(x: PCtx, st: Settlement, c: number): boolean {
  if (c === st.cell) return true;
  let n = 0;
  for (const b of x.ps.of(st.id)) if (!(b.flags & BuildingFlag.ruined)) n++;
  const reach = 11 + 4.2 * Math.sqrt(n + 90) + x.p.edgeM / 2;
  return distM(x.p, cellPos(x.p, c), st.pos) < reach;
}

/** the best-suited free ground for a new field (suitability > 0.3, not the village's own ground), or -1 */
export function newFieldCell(x: PCtx, st: Settlement): number {
  if (!st.res || st.crop < 0) return -1;
  let best = -1, bv = 0.3;
  for (const c of st.res.fertile) {
    if (st.fields.includes(c)) continue;
    const v = fieldSite(x, st.crop, c);
    if (v > bv && !villageGround(x, st, c)) { bv = v; best = c; }
  }
  return best;
}

/** the most fields a settlement works: 14 by hand and ox; from the age of steam (machines plough and reap) 24 (PUNCH P13:
 * a rocket-age city of 90-139 people farmed 4 cells, about a hectare) */
export const FIELDS_MAX = 14, FIELDS_MAX_MACHINES = 24;
export const MACHINE_ERA = ERAS.indexOf('steam');
export function fieldsMax(st: Settlement): number {
  return st.era >= MACHINE_ERA ? FIELDS_MAX_MACHINES : FIELDS_MAX;
}

/** how many fields st wants (a third of its people, at most fieldsMax) */
export function fieldsWanted(x: PCtx, st: Settlement): number {
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
  return Math.min(fieldsMax(st), 1 + Math.ceil(pop / 3));
}

/** fibre wanted and flax at hand to sow: a flax field beside the staple */
function flaxWanted(x: PCtx, st: Settlement): number {
  const flax = x.c.plants.idx('flax');
  if (flax < 0 || st.crop === flax) return -1;
  const fiber = itemIdx(x, 'fiber');
  if (fiber >= 0 && storeHas(st, fiber) >= 8 && !st.wants.includes(fiber)) return -1;
  // grown here already (sown by the god, or a field of it) — someone brought the seed
  const L = landOf(st);
  if (L.fields.some((fs) => fs.sp === flax)) return flax;
  if (st.recent['flax'] !== undefined) return flax;
  for (const c of st.flow?.cells ?? []) if (x.p.f.cropSpecies[c] === flax && x.p.f.crop[c] > 0.05) { st.recent['flax'] = x.tick; return flax; }
  return -1;
}

/**
 * The farmer's work (decide.ts planFarm): the ripe field longest waiting first; a fallow field sown in its crop's
 * window; a new field laid out (in the window, on the best-suited free ground near home); a growing field tended. Null:
 * nothing in the fields now.
 */
export function farmTask(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const ag = x.rt.byId.get('agriculture');
  if (ag === undefined || !libHas(st, ag) || st.crop < 0) return null;
  const A = x.A;
  const L = landOf(st);
  const at = (c: number, work: number, mode: number, sp = -1): TaskSpec => ({ kind: TASK.farm, goal: spotInCell(x.p, c, A.id[s], 31, [0, 0, 0]), goalCell: c, work, data: sp, data2: mode, target: c });
  // harvest: the field ripe longest
  let ripe: FieldState | null = null;
  for (const fs of L.fields) if (fs.sp >= 0 && fs.ripe >= 0 && (!ripe || fs.ripe < ripe.ripe)) ripe = fs;
  if (ripe) return at(ripe.c, 210, 2);
  const seed = storeAny(st, seedItems(x)) >= SEED_UNITS;
  const flax = flaxWanted(x, st);
  const flaxN = flax >= 0 ? L.fields.filter((fs) => fs.sp === flax).length : 0;
  // sow a fallow field in its window (flax on one or two of them when fibre is wanted)
  if (seed) {
    for (const fs of L.fields) {
      if (fs.sp >= 0 || villageGround(x, st, fs.c)) continue;
      const sp = flax >= 0 && flaxN < 2 && fieldSite(x, flax, fs.c) > 0.3 ? flax : st.crop;
      if (!sowingTime(x, sp, fs.c) || fieldSite(x, sp, fs.c) < 0.15) continue;
      return at(fs.c, 180, 0, sp);
    }
    // lay out a new field: the best-suited free ground the settlement has found, in its sowing window there (LAND round 5:
    // the window was read at the town's own cell — where there are no seasons, sowing follows the soil's wetness, and the
    // dry ground a town stands on never grew wet enough for rice: seed 7's town knew agriculture, kept 170-240 units of
    // seed, named five farmers and laid out no field in eight years, with seven cells around it suiting rice — r5/fprobe.ts)
    if (L.fields.length < fieldsWanted(x, st) && st.res) {
      const best = newFieldCell(x, st);
      if (best >= 0 && sowingTime(x, st.crop, best)) return at(best, 210, 0, st.crop);
    }
  }
  // tend a growing field (weeding, watering, scaring off birds): the one in the worst health, else one in turn
  let worst: FieldState | null = null;
  for (const fs of L.fields) if (fs.sp >= 0 && fs.ripe < 0 && fs.q < 0.95 && (!worst || fs.q < worst.q)) worst = fs;
  if (worst) return at(worst.c, 180, 1);
  const growing = L.fields.filter((fs) => fs.sp >= 0 && fs.ripe < 0);
  if (growing.length && hashFloat(A.id[s], x.tick, 0xfa2) < 0.5) return at(growing[Math.floor(hashFloat(A.id[s], x.tick, 0xfa3) * growing.length)].c, 180, 1);
  return null;
}

/** the end of a farmer's session (work.ts, TASK.farm): sow (data2 0, tData the crop), tend (1), harvest (2) */
export function farmWork(x: PCtx, s: number, st: Settlement | undefined, toolF: number): void {
  const A = x.A;
  if (!st) return;
  const c = A.tTarget[s];
  if (c < 0) return;
  const mode = A.tData2[s];
  const skill = A.skills[s * NS + SKILL.farm];
  const f = x.p.f;
  const L = landOf(st);
  practise(x, s, SKILL.farm, 0.015);
  if (mode === 0) {
    const sp = A.tData[s] >= 0 ? A.tData[s] : st.crop;
    if (sp < 0 || !sowingTime(x, sp, c)) return;
    let fs = L.fields.find((q) => q.c === c);
    if (fs && fs.sp >= 0) return;
    if (storeTakeAny(st, seedItems(x), SEED_UNITS) < SEED_UNITS * 0.99) return;
    // clear, till and sow
    f.tree[c] = 0; f.shrub[c] = 0; f.grass[c] *= 0.3;
    if (!fs) {
      fs = { c, sp: -1, sown: -1, prog: 0, q: 1, t: x.tick, ripe: -1, shown: 0.02 };
      L.fields.push(fs);
      L.fields.sort((a, b) => a.c - b.c);
      if (!st.fields.includes(c)) { st.fields.push(c); st.fields.sort((a, b) => a - b); }
    }
    fs.sp = sp; fs.sown = x.tick; fs.prog = 0; fs.q = 1; fs.t = x.tick; fs.ripe = -1;
    f.cropSpecies[c] = sp;
    f.crop[c] = SHOW_SOWN;
    fs.shown = SHOW_SOWN;
    x.p.bump('crop'); x.p.bump('cropSpecies'); x.p.bump('tree'); x.p.bump('shrub');
    x.p.vegDirty = true;
    bump(ledger(x, st).sowings, x.c.plants.list[sp]?.id ?? String(sp));
    return;
  }
  const fs = L.fields.find((q) => q.c === c);
  if (!fs || fs.sp < 0) return;
  if (mode === 1) {
    // weeding and watering: the field's health back up a little, and it grows on a little faster
    fs.q = Math.min(1, Math.round((fs.q + 0.08 * (0.6 + skill)) * 10000) / 10000);
    if (fs.ripe < 0) fs.prog = Math.min(0.999, fs.prog + 0.02);
    return;
  }
  if (fs.ripe < 0) return;
  // the harvest: each of the crop's yields (plants.json harvest), by the field's health, the hand and the tools
  const def = x.c.plants.list[fs.sp];
  const k = fs.q * (0.7 + 0.8 * skill) * toolF * libraryEffect(x, st, 'yield.farm');
  const row = ledger(x, st);
  let total = 0;
  const yields = def.harvest ?? [{ item: 'grain', qty: 40 }];
  for (const y of yields) {
    let it = itemIdx(x, y.item);
    if (it < 0 && def.edible) it = itemIdx(x, 'grain');
    if (it < 0) continue;
    const units = Math.round(y.qty * k * 100) / 100;
    if (units <= 0) continue;
    const left = A.give(s, it, units);
    if (left > 0) storeAdd(x, st, it, left);
    bump(row.harvestUnits, x.c.items.list[it].id, units);
    addFood(x, st, 'farm', it, units);
    total += units;
  }
  bump(row.harvests, def.id);
  emitSt(x, st, { t: 'harvest', text: def.id, data: { settlement: st.id, crop: def.id, cell: c, units: Math.round(total * 10) / 10 } });
  if (L.firsts[`harvest:${def.id}`] === undefined) L.firsts[`harvest:${def.id}`] = x.tick;
  fallow(fs);
  f.crop[c] = 0.02;
  x.p.bump('crop');
}

/** the ripe and growing fields, for views and tests: [sown, growing, ripe, fallow] */
export function fieldCounts(st: Settlement): [number, number, number, number] {
  let g = 0, r = 0, fa = 0;
  for (const fs of st.land?.fields ?? []) { if (fs.sp < 0) fa++; else if (fs.ripe >= 0) r++; else g++; }
  return [g + r, g, r, fa];
}

