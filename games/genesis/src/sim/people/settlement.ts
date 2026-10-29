// GENESIS — settlements (CONTRACT.md §8.5): bands that wander until they find water + food + shelter and settle there,
// named from their phonology and the site ("Aru by the Falls"); households, roles by need and knowledge, the store,
// what to build next, what to make (jobs) and what to bring in (wants), births, old age, culture (alignment, taboos,
// stories), territory, splits into new named settlements with a drifted language, falls into ruins, resettling ruins.
//
// The settlement step runs hourly per settlement, staggered by id; resource caches and flow fields refresh at fixed
// hours and are saved, so a loaded game makes the very same decisions.

import type { PCtx } from './ctx.ts';
import type { Settlement, Cohort } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { ERAS } from '../content.ts';
import { DEATH, INV, NS, NT, PHASE, ROLE, SKILL, TASK, TRAIT } from './defs.ts';
import { birth, die, ageHazard, spawnAgent, insertSorted, worldSalt } from './lifecycle.ts';
import { accident, computeEra, hiveShare, learn, libHas, refreshLibrary } from './knowledge.ts';
import { planBuilding, canBuild, decayBuildings, hearthAccidents, reviseSite, ruin, styleOf } from './buildings.ts';
import { updateFlow, updateResources, availability, itemIdx, gatherable, territoryRings } from './resources.ts';
import { capacity, foodDays, spoil, storeAdd, storeHas, storeAny } from './store.ts';
import { cellPos, distM, drinkable, freshWater, hollowDepth, isLand, offsetPoint, snowWater, sunAt, wellFlows } from './world.ts';
import { settlementName, rootLanguage, driftLanguage, placeRoot } from './names.ts';
import { tell, remember } from './story.ts';
import { settlementRef, vars, emitSt } from './util.ts';
import { burnHearths } from './fire.ts';
import { cohortStep, cohortTotal } from './cohorts.ts';
import { diseaseStep } from '../life/disease.ts';
import { bandWater, campBeats, inputsAvailable, seedItems } from './decide.ts';
import { interrupt } from './people.ts';
import { placeFor } from './context.ts';
import { FOOD, NEED_N, WARMTH, WATER } from './needs.ts';
import { packColor } from './ctx.ts';
import { recipeTable } from '../recipes/recipes.ts';
import type { Household } from './state.ts';
import { electLeader, factionsDaily, householdsDaily, schismCandidates } from './social.ts';
import { cultureDaily } from './culture.ts';
import { godHooks } from './hooks.ts'; // LIVING RELATIONSHIP: temples where faith holds
import { economyDaily, popOf } from './economy.ts';
import { atWar } from './war.ts';
import { agesDaily, checkWorldEmpty, peopleLeft } from '../chronicle.ts';
import { neighbourContagion } from '../life/disease.ts';
import { bestBoat, boatSeats, boatSwim, routeBetween } from './missions.ts';
import { findPath } from '../grid/pathfind.ts';
import { pathOptsFor } from './resources.ts';
import { recountShelters } from './tasks.ts';
import { planetLevel } from '../perf/lapse.ts';
import { DAY_WALK, WATER_NEAR, lastingWater, reachCost, waterOnFoot, waterReach } from './waterway.ts'; // LIVING.md §2.7: the water a band can walk to
import { LOAD_KG } from '../perf/pace.ts';
// SIM perf push 3 — the coarse settlement step of the peoples' time-lapse (perf/plapse.ts)
import { chanceIn, dueIn, hourly, settleHours } from '../perf/plapse.ts';
import { fireSeen } from './firewatch.ts'; // LIVING PACE: a fire seen is a fire learned
// LIVING LAND (LIVING.md §2): hunting parties and herds in the roles, births spaced, the deaths of childhood, crops,
// gatherings and the books in the hourly and daily steps (people/land.ts and its modules)
import { bandHourly, landDaily, landHourly } from './land.ts';
import { huntQuota, partyOut } from './hunt.ts';
import { herderQuota, ownHerds } from './herding.ts';
import { ageFertility, mouths, plentyFactor, spaced } from './demography.ts';
import { wantChain } from './wants.ts';
import { materialJobs } from '../god/materials.ts';

/** re-planning interval multiplier per time-lapse level (SIM perf push 2: settlementStep; push 3: per world —
 * perf/lapse.ts planetLevel, 3 = a world the camera is not on) */
const REPLAN = [1, 2, 3, 4] as const;

export const SETTLEMENT_CADENCE = 60;

/** a cohort with every key set (a missing key and null hash differently: a loaded copy's hash never matched again) */
export function newCohort(skill = 0.25): Cohort {
  return { n: [0, 0, 0], know: {}, skill, sick: null };
}

function emptyCohort(): Cohort {
  return newCohort();
}

/** a new settlement object (a band until founded) */
export function newSettlement(x: PCtx, species: number, cell: number, band: boolean, parent: Settlement | null): Settlement {
  const id = x.u.ids.alloc('settlement');
  const pos = cellPos(x.p, cell) as [number, number, number];
  const lang = parent ? driftLanguage(parent.langSeed, id) : rootLanguage(x.c.species.list[species].id, x.p.seed) ^ hash32(id, 0x1a);
  const sp = x.c.species.list[species];
  const palette = sp.style.palette ?? ['#c8a060'];
  const st: Settlement = {
    id, name: '', species, cell, pos, founded: band ? -1 : x.tick, band, leader: 0, parent: parent ? parent.id : -1, feature: 'plain',
    language: lang >>> 0, langSeed: lang >>> 0, color: packColor(palette[hash32(id, worldSalt(x, 0xc01)) % palette.length]), polity: parent ? parent.polity : id, fallen: -1,
    store: new Array<number>(x.c.items.size).fill(0), households: [],
    culture: {
      alignment: 0, taboos: parent ? parent.culture.taboos.slice() : x.info[species].taboos.slice(), stories: [],
      sacred: (sp.sacred ?? []).slice(), conservatism: parent ? parent.culture.conservatism * 0.8 : 0.3, mode: hash32(lang, 0x30d) % 7,
    },
    secrets: [], written: [], library: [], era: 0, fields: [], crop: -1, sites: [], target: null, territory: 0, cohort: emptyCohort(),
    res: null, flow: null, stats: { births: 0, deaths: 0, starved: 0, froze: 0, peak: 0, discoveries: 0, lost: 0 }, relations: {}, firsts: {},
    belief: 0, fearGod: 0, nightLight: 0, lastFamine: -1, recent: {}, gifts: 0, seen: [], jobs: [], wants: [], quota: [], worship: 0,
    factions: [], god: -1, faith: [0, 0, 0, 0], langLine: [], contacts: [], age: { kind: '', since: band ? -1 : x.tick, hist: [] }, boatUse: 0,
    traded: 0, besieged: -1, leaderSince: x.tick, worshipBy: [0, 0, 0, 0],
  };
  // a band takes its root name from its language now (its full name comes with the site)
  st.name = placeRoot(x.c, species, st.langSeed, id);
  // its tongue: the parent's line of drifts and one more (language distance reads it)
  st.langLine = parent ? [...(parent.langLine ?? [parent.langSeed]), st.langSeed].slice(-12) : [st.langSeed];
  x.ps.addSettlement(st);
  return st;
}

// ───────────────────────────── sites ─────────────────────────────

/**
 * A cell's temperatures through the year: now (the 3-day mean), the year's mean, the hottest afternoon and coldest night
 * of about the last year (the climate keeps them per cell from what the cell lived through, seeded at the world's making
 * from its sunlight over the orbit), the seasons' daily means between, and the season coming (an eighth of a year on,
 * by the sun's swing — the heat the land and seas hold lags it). Peoples choose homes for the whole year: a valley mild
 * in spring is a grave by midwinter, a desert basin a furnace by midsummer. (The old estimate scaled a terran swing from
 * the 3-day mean: it put the hive's midsummer at 42 °C where it reached 59.)
 */
export function seasonTemps(x: PCtx, c: number): { now: number; winter: number; summer: number; year: number; hot: number; cold: number; ahead: number } {
  const p = x.p, s = p.s;
  const now = s.tempMean[c] || p.f.temperature[c];
  const year = s.tempYear[c] || now;
  const hot = Math.max(s.tHi[c], now), cold = Math.min(s.tLo[c], now);
  // the seasons' daily means sit about two-thirds of the way from the year's mean to its extreme hours
  const winter = year - (year - cold) * 0.62, summer = year + (hot - year) * 0.62;
  let ahead = now;
  const tilt = Math.abs(p.st.axialTilt || 0);
  if (tilt > 0.02) {
    const sinLat = p.grid.pos[c * 3 + 1];
    const d = sunAt(x.u, p, x.tick + Math.round(p.st.orbit.period / 8)).dir[1];
    const phase = Math.max(-1, Math.min(1, d / Math.sin(tilt))) * Math.sign(sinLat) * Math.min(1, Math.abs(sinLat) * 3);
    ahead = phase >= 0 ? year + (summer - year) * phase : year + (year - winter) * phase;
  }
  return { now, winter, summer, year, hot, cold, ahead };
}

/** comfort 0..1 of a temperature for a species (negative beyond its limits) */
function comfortOf(temp: readonly number[], t: number): number {
  const [tMin, lo, hi, tMax] = temp;
  return t < lo ? 1 - (lo - t) / Math.max(1, lo - tMin) : t > hi ? 1 - (t - hi) / Math.max(1, tMax - hi) : 1;
}

/** how good a cell is to settle for this species: water, food, wood, comfort (through the year), room */
export function siteScore(x: PCtx, species: number, c: number, exclude = -1): number {
  const p = x.p, f = p.f, g = p.grid;
  const sp = x.info[species];
  const def = sp.def;
  if (!isLand(p, c) || f.water[c] > 0.15 || f.lava[c] > 0) return -1;
  const [tMin, , , tMax] = def.temp;
  const year = seasonTemps(x, c);
  const t = year.now;
  if (t < tMin + 2 || t > tMax - 2) return -1;
  // a year past the limits is no home: its mean, a whole season beyond them, or an afternoon or night no shade, roof or
  // fire can make up for (shelter and a hearth give back ~18 °C of a cold night; shade little of a hot day)
  const [, lo, hi] = def.temp;
  if (year.year < tMin + (lo - tMin) * 0.5 || year.year > tMax - (tMax - hi) * 0.5) return -1;
  if (year.winter < tMin + (lo - tMin) * 0.25 || year.summer > tMax - (tMax - hi) * 0.25) return -1;
  if (year.hot > tMax + 3 || year.cold < tMin - 18) return -1;
  // now, and the worst of the year weighs as much (a winter past the limit costs dearly)
  const comfort = (comfortOf(def.temp, t) + Math.min(comfortOf(def.temp, year.winter), comfortOf(def.temp, year.summer)) * 2) / 3;
  // water within a ring (drinkers), or the sea for coastal folk
  let water = sp.needW[1] > 0 ? 0 : 1;
  let sea = 0, food = 0, wood = 0, slope = 0;
  const melt = def.habitat.includes('cold');
  const visit = (o: number, w: number) => {
    if (freshWater(p, o)) water = Math.max(water, w);
    else if (drinkable(p, o)) water = Math.max(water, w * 0.7);
    else if (melt && snowWater(p, o)) water = Math.max(water, w * 0.8);
    if (p.s.ocean[o] || f.salinity[o] > 0.5 && f.water[o] > 0.3) sea = Math.max(sea, w);
    if (sp.vegetation) food += (f.grass[o] * 0.4 + f.shrub[o] * 0.6 + f.tree[o] * 0.25) * w;
    wood += f.tree[o] * w;
    slope = Math.max(slope, Math.abs(f.surface[o] - f.surface[c]) / p.edgeM);
  };
  visit(c, 1);
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    visit(o, 0.8);
    for (let e2 = g.nbrStart[o]; e2 < g.nbrStart[o + 1]; e2++) visit(g.nbr[e2], 0.3);
  }
  if (water <= 0) return -1;
  // water more than a short walk away is a hard life (every trip is hours)
  if (water < 0.75) water -= 1;
  if (slope > 0.7) return -1;
  // the bottom of a closed hollow fills when springs and rain feed it (a scenario town drowned under 5 m of its own
  // lake in eight days): deep hollows are no site unless the land is dry enough that nothing pools there
  const hollow = hollowDepth(p, c);
  const wet = f.moisture[c] > 0.3 || p.s.precipMean[c] > 0.05;
  if (hollow > 2 && wet) return -1;
  // (SIM phase 4) ground lower than the water standing beside it floods as soon as the water moves: a scenario city was
  // set a couple of metres under the surface of the spring-fed pond next door and drowned in five days
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const o = g.nbr[e];
    if (f.water[o] > 0.3 && f.surface[o] + f.water[o] > f.surface[c] + 0.25) return -1;
  }
  if (sp.air) food += 3;
  if (sp.sea && sea > 0) food += 2.5 * sea;
  // a place with almost nothing to eat around it is no home, however good its water (a hive settled in bare desert by
  // a spring and ate its stores in six days)
  if (food < 0.4) return -1;
  let score = water * 3 + Math.min(4, food) * 0.9 - (food < 1.2 ? 1.2 - food : 0) * 1.5 + Math.min(2, wood) * 0.5 + comfort * 5 - 2 - slope * 2 - (wet ? Math.min(2, hollow) * 0.6 : 0);
  if (def.habitat.includes('coast')) score += sea * 2.5 - (sea > 0 ? 0 : 2);
  if (f.fertility[c] > 0.4) score += 0.6;
  if (f.oreType[c] > 0) score += 0.3;
  // keep away from other settlements
  for (const o of x.ps.settlements) {
    if (o.id === exclude || o.fallen >= 0 || o.band) continue;
    const d = distM(p, o.pos, cellPos(p, c));
    if (d < 260) score -= (260 - d) / 40;
  }
  // ruins: walls to reuse
  if (x.ps.bByCell.get(c).length) score += 0.5;
  return score;
}

/** the best site within `rings` of cell c (or -1) */
export function searchSite(x: PCtx, species: number, from: number, rings: number, exclude = -1, skip?: (c: number) => boolean): { cell: number; score: number } {
  const g = x.p.grid;
  const seen = new Set<number>([from]);
  let fr = [from];
  let best = -1, bs = -Infinity;
  const tryC = (c: number) => {
    if (skip && skip(c)) return;
    const v = siteScore(x, species, c, exclude);
    if (v > bs) { bs = v; best = c; }
  };
  tryC(from);
  for (let d = 0; d < rings; d++) {
    const nf: number[] = [];
    for (const c of fr) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); nf.push(o); } }
    nf.sort((a, b) => a - b);
    for (const o of nf) tryC(o);
    fr = nf;
  }
  return { cell: best, score: bs };
}

/** the striking feature of a site, for its name */
export function siteFeature(x: PCtx, c: number): string {
  const p = x.p, f = p.f, g = p.grid;
  let river = false, lake = false, sea = false, falls = false, volcano = false, marsh = false, dunes = false, ice = false;
  let relief = 0, forest = 0;
  const near = [c];
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) near.push(g.nbr[e]);
  for (const o of near) {
    const fl = Math.abs(f.flowX[o]) + Math.abs(f.flowY[o]) + Math.abs(f.flowZ[o]);
    if (f.water[o] > 0.05 && fl > 0.004 && !p.s.ocean[o]) {
      river = true;
      for (let e = g.nbrStart[o]; e < g.nbrStart[o + 1]; e++) if (f.water[g.nbr[e]] > 0.05 && f.surface[o] - f.surface[g.nbr[e]] > 6) falls = true;
    }
    if (f.water[o] > 0.3 && !p.s.ocean[o] && fl <= 0.004) lake = true;
    if (p.s.ocean[o]) sea = true;
    if (f.lava[o] > 0 || f.ash[o] > 0.2) volcano = true;
    const b = x.c.biomes.list[f.biome[o]]?.id;
    if (b === 'wetland') marsh = true;
    if (b === 'dune' || f.sand[o] > 1.2) dunes = true;
    if (f.ice[o] > 0.3 || b === 'ice') ice = true;
    relief = Math.max(relief, Math.abs(f.surface[o] - f.surface[c]));
    forest += f.tree[o];
  }
  const alt = f.surface[c] - p.st.seaLevel;
  if (falls) return 'falls';
  if (p.springs.some((sp) => near.includes(sp.cell))) return 'spring';
  if (river) return 'river';
  if (lake) return 'lake';
  if (sea) return 'coast';
  if (volcano) return 'volcano';
  if (alt > 160) return 'mountain';
  if (relief > 12) return 'hills';
  if (marsh) return 'marsh';
  if (ice) return 'ice';
  if (dunes) return 'dunes';
  if (forest / near.length > 0.45) return 'forest';
  return 'plain';
}

/** a band settles at cell c */
export function found(x: PCtx, st: Settlement, c: number, ruinOf: Settlement | null = null): void {
  st.band = false;
  st.founded = x.tick;
  st.cell = c;
  st.pos = cellPos(x.p, c) as [number, number, number];
  st.feature = siteFeature(x, c);
  // a people the god sent to a new place keeps its name there (god/civic.ts settlement.move)
  if (st.recent.keepName === undefined || !st.name) st.name = settlementName(x.c, st.species, st.langSeed, st.id, st.feature);
  delete st.recent.keepName;
  delete st.recent.godSite;
  st.target = null;
  // ruins on the site are taken over
  for (const b of x.ps.buildings) {
    if (b.settlement === st.id || !(b.flags & BuildingFlag.ruined)) continue;
    if (distM(x.p, b.pos, st.pos) > 80) continue;
    b.settlement = st.id;
  }
  updateFlow(x, st);
  updateResources(x, st);
  refreshLibrary(x, st);
  formHouseholds(x, st);
  assignRoles(x, st);
  const members = x.ps.members.get(st.id) ?? [];
  const parent = st.parent >= 0 ? x.ps.settlement(st.parent) : undefined;
  // (a colony come down from the sky is told by space/contact.ts in its own words)
  if (st.recent.spaceColony !== undefined) delete st.recent.spaceColony;
  else if (ruinOf) tell(x.u, x.p, 'resettle', vars(x, st, -1, { other: ruinOf.name }), st, [settlementRef(x, st)]);
  else if (parent && parent.fallen < 0 && st.recent.colony !== undefined) tell(x.u, x.p, 'colony', vars(x, st, -1, { parent: parent.name, count: members.length }), st, [settlementRef(x, st), settlementRef(x, parent)]);
  else if (parent && parent.fallen < 0) tell(x.u, x.p, st.recent.bud !== undefined ? 'bud' : 'split', vars(x, st, -1, { parent: parent.name, count: members.length }), st, [settlementRef(x, st), settlementRef(x, parent)]);
  else tell(x.u, x.p, 'founding', vars(x, st, -1, { count: members.length }), st, [settlementRef(x, st)]);
  emitSt(x, st, { t: 'settlement.founded', text: st.name, data: { species: x.c.species.list[st.species].id } });
  for (const m of members) { x.A.remember(m, 15, x.tick, st.id); x.A.boat[m] = -1; x.A.flags[m] &= ~AgentFlag.boat; }
  if (x.ps.firsts.peopled === undefined) x.ps.firsts.peopled = x.tick;
  updateTerritory(x, st);
  x.ps.version++;
}

/** pair the unpaired adults of a fresh settlement into households (children follow their mothers) */
export function formHouseholds(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const byId = new Map<number, number>();
  for (const m of members) byId.set(A.id[m], m);
  const homeless = members.filter((m) => !st.households.some((h) => h.id === A.household[m]));
  for (const m of homeless) {
    if (st.households.some((h) => h.id === A.household[m])) continue;
    // join a partner's or mother's household
    const kin = A.partner[m] || A.mother[m];
    const ks = kin ? byId.get(kin) : undefined;
    const kh = ks !== undefined ? st.households.find((h) => h.id === A.household[ks]) : undefined;
    if (kh) { insertSorted(kh.members, A.id[m]); A.household[m] = kh.id; continue; }
    const hh = { id: x.u.ids.alloc('household'), members: [A.id[m]], home: -1 };
    st.households.push(hh);
    A.household[m] = hh.id;
  }
}

/** create a wandering band of n people of a species at a cell (god spawn, scenario, split) */
export function createBand(x: PCtx, species: number, cell: number, n: number, opts: { knowledge?: number[]; era?: number; skill?: number; parent?: Settlement | null } = {}): Settlement {
  const st = newSettlement(x, species, cell, true, opts.parent ?? null);
  const def = x.info[species].def;
  const P = x.p.grid.pos;
  // beyond the planet's individual cap the rest live as the settlement's cohort (a core of four is always individual)
  const room = Math.max(0, x.u.settings.maxAgents - x.A.count);
  const individuals = Math.min(n, Math.max(room, Math.min(n, 4)));
  // a living band has a living band's shape, by count: 22 % children, 10 % elders, the rest grown, each age band half
  // women. The world seed draws who is which, how old and where each stands (band ids repeat from world to world —
  // lifecycle.ts worldSalt), not the shape: rolled member by member, a band of 24 came with anything from 2 grown women
  // and 6 elders to 11 women and 1 elder, and a world's first days were a lottery on it. Who is a child or an elder goes
  // by the rank of each member's age roll (the lowest are the children, the highest the elders), so a member keeps the
  // age it rolled unless the count moved it into the next age band; there it takes a fresh age.
  const ageDice = worldSalt(x, 0xa6e), angleDice = worldSalt(x, 0xa6f), distDice = worldSalt(x, 0xa70), movedDice = worldSalt(x, 0xa71);
  const roll: number[] = [];
  for (let i = 0; i < n; i++) roll.push(hashFloat(st.id, i, ageDice));
  const nKids = Math.round(0.22 * n), nElders = Math.min(n - nKids, Math.round(0.1 * n));
  const ageBand = new Array<number>(n);
  Array.from({ length: n }, (_, i) => i).sort((p, q) => roll[p] - roll[q] || p - q)
    .forEach((i, rank) => { ageBand[i] = rank < nKids ? 0 : rank >= n - nElders ? 2 : 1; });
  for (let i = 0; i < n; i++) {
    const b = ageBand[i];
    if (i >= individuals) {
      st.cohort.n[b] += 1;
      continue;
    }
    const r = roll[i];
    const u = hashFloat(st.id, i, movedDice);
    const age = (r < 0.22 ? 0 : r < 0.9 ? 1 : 2) === b
      ? (r < 0.22 ? r / 0.22 * def.maturity * 0.95 : r < 0.9 ? def.maturity + (r - 0.22) / 0.68 * (def.elder - def.maturity) : def.elder + (r - 0.9) * 10 * Math.max(1, def.lifespan - def.elder) * 0.5)
      : b === 0 ? u * def.maturity * 0.95 : b === 1 ? def.maturity + u * (def.elder - def.maturity) : def.elder + u * Math.max(1, def.lifespan - def.elder) * 0.5;
    const a = hashFloat(st.id, i, angleDice) * Math.PI * 2;
    const d = 3 + 18 * Math.sqrt(hashFloat(st.id, i, distDice));
    const pos = [0, 0, 0];
    const ctr = [P[cell * 3], P[cell * 3 + 1], P[cell * 3 + 2]];
    // place around the cell centre
    let ex = ctr[2], ez = -ctr[0];
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = ctr[1] * ez, ny = ctr[2] * ex - ctr[0] * ez, nz = -ctr[1] * ex;
    const k = d / x.p.st.radius;
    pos[0] = ctr[0] + (Math.cos(a) * ex + Math.sin(a) * nx) * k;
    pos[1] = ctr[1] + Math.sin(a) * ny * k;
    pos[2] = ctr[2] + (Math.cos(a) * ez + Math.sin(a) * nz) * k;
    const l = Math.hypot(pos[0], pos[1], pos[2]);
    pos[0] /= l; pos[1] /= l; pos[2] /= l;
    const hiveQueen = def.hive && i === 0 ? def.hive.castes.indexOf(def.hive.queen) : undefined;
    spawnAgent(x, st, { ageYears: age, pos, knowledge: opts.knowledge, skill: opts.skill ?? 0.3, caste: hiveQueen });
  }
  // half of each age band are women (the hive's castes are its sexes): those whose sex roll (lifecycle.ts spawnAgent)
  // came out lowest, so only the members nearest the even line change
  const A = x.A;
  const members = (x.ps.members.get(st.id) ?? []).slice();
  if (!def.hive) {
    const sexDice = worldSalt(x, 0x5e8), oddDice = worldSalt(x, 0x5e9);
    for (let b = 0; b < 3; b++) {
      const flag = b === 0 ? AgentFlag.child : b === 2 ? AgentFlag.elder : 0;
      const of = members.filter((m) => (A.flags[m] & (AgentFlag.child | AgentFlag.elder)) === flag)
        .sort((p, q) => hashFloat(A.id[p], sexDice) - hashFloat(A.id[q], sexDice) || A.id[p] - A.id[q]);
      const women = (of.length >> 1) + (of.length & 1 && hashFloat(st.id, b, oddDice) < 0.5 ? 1 : 0);
      of.forEach((m, j) => { A.flags[m] = j < women ? A.flags[m] | AgentFlag.female : A.flags[m] & ~AgentFlag.female; });
    }
  }
  // couples among the adults
  if (!def.hive) {
    const adults = members.filter((m) => !(A.flags[m] & (AgentFlag.child | AgentFlag.elder)));
    const women = adults.filter((m) => A.flags[m] & AgentFlag.female), men = adults.filter((m) => !(A.flags[m] & AgentFlag.female));
    for (let i = 0; i < Math.min(women.length, men.length) && i < Math.floor(adults.length * 0.4); i++) {
      A.partner[women[i]] = A.id[men[i]];
      A.partner[men[i]] = A.id[women[i]];
    }
    // children belong to a couple
    const kids = members.filter((m) => A.flags[m] & AgentFlag.child);
    kids.forEach((kid, i) => {
      const mom = women[i % Math.max(1, Math.min(women.length, Math.floor(adults.length * 0.4)))];
      if (mom !== undefined) { A.mother[kid] = A.id[mom]; if (A.partner[mom]) A.father[kid] = A.partner[mom]; }
    });
  }
  formHouseholds(x, st);
  st.leader = members.length ? A.id[members.reduce((a, b) => (A.birth[a] <= A.birth[b] ? a : b))] : 0;
  refreshLibrary(x, st);
  st.era = Math.max(st.era, opts.era ?? 0, computeEra(x, st));
  return st;
}

// ───────────────────────────── hourly step ─────────────────────────────

export function settlementStep(x: PCtx, st: Settlement): void {
  // SIM perf push 3 — the peoples' time-lapse (perf/plapse.ts): at 100x / 1000x the step runs every 2 / 4 hours and
  // integrates the hours since the last one (H); at level 0 H is 1 and every line below is the plain hourly step
  const H = settleHours(x, st);
  if (st.fallen >= 0 || H === 0) return;
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length + cohortTotal(st);
  if (pop <= 0.5) { fall(x, st, st.stats.starved > st.stats.deaths * 0.4 ? 'starvation' : 'emptied'); return; }
  st.stats.peak = Math.max(st.stats.peak, Math.round(pop));
  const hour = Math.floor(x.tick / 60);
  // a wandering band grows old as it walks (every hour, a settlement or a band, rolls old age once); births and
  // sickness wait for a home (their rules read the settlement's store, beds, hearths and land)
  if (st.band) { bandStep(x, st, hour); oldAge(x, st, H); bandHourly(x, st, H); return; }
  // SIM perf push 2 — time-lapse (perf/lapse.ts): at 100x / 1000x the re-planning below (caches, roles, work lists) runs
  // 2 / 3 times less often; everything that integrates time (hearths, births, age, sickness, cohorts) covers its hours.
  // (push 3: a periodic task runs when its hour falls inside the H hours this step stands for — dueIn; at H = 1 the
  // plain `(hour + offset) % period === 0`)
  const rp = REPLAN[planetLevel(x.u, x.p)];
  // refresh caches at fixed hours (saved: decisions read them) — and at once after a drink found a drinking place dry
  // (LIVING LAND §2.7: a drought killed a town of thirst with water 50-250 m away while its list held a dried cell)
  if (dueIn(hour + st.id, 8 * rp, H) || !st.res || st.recent.waterStale !== undefined) { updateResources(x, st); delete st.recent.waterStale; }
  if (dueIn(hour + st.id, 24 * rp, H) || !st.flow) updateFlow(x, st);
  burnHearths(x, st, 60 * H);
  refreshLibrary(x, st);
  hiveShare(x, st);
  // (fix r1 #1: a leader who is no longer a member — cast out, fled, gone with a split — is replaced like a dead one)
  { const ls = st.leader ? x.A.slotOf(st.leader) : -1; if (ls < 0 || x.A.settlement[ls] !== st.id) electLeader(x, st); }
  if (dueIn(hour + st.id, rp, H)) assignRoles(x, st);
  // the work lists (saved) are revised every few hours, staggered between settlements
  if (dueIn(hour + st.id, 3 * rp, H)) planJobs(x, st);
  if (dueIn(hour + st.id - 1, 2 * rp, H)) planWants(x, st);
  if (dueIn(hour + st.id, 2 * rp, H)) planConstruction(x, st);
  births(x, st, H);
  oldAge(x, st, H);
  sicknessAndAccidents(x, st, H);
  // (LIVING LAND: crops on the season's clock, the hunting party, gatherings, the deaths of childhood — people/land.ts)
  landHourly(x, st, H);
  hourly(x, st, H, diseaseStep); // (sickness spreads hour by hour, at each hour's own tick)
  hourly(x, st, H, cohortStep); // (the cohort's statistics, hour by hour: nothing to do for most)
  assignHomes(x, st);
  recountShelters(x, st);
  // daily
  if (dueIn(hour + st.id * 5, 24, H)) daily(x, st);
  // (LIVING CONTENT: a house of a glowing stone the god invented lights the night too — materials.json `light`)
  st.nightLight = x.ps.of(st.id).some((b) => b.fuel > 0 || (b.progress >= 1 && (x.c.materials.list[b.material]?.light ?? 0) > 0)) ? 1 : 0;
}

/** a wandering band: the leader picks a site, the band walks there, and settles */
const _bt = [0, 0, 0];
/** (fix r3 #17) a cell within `m` metres of a live town other than `st` (a budding daughter's own rule, BUD_APART) */
function nearTown(x: PCtx, st: Settlement, c: number, m: number): boolean {
  cellPos(x.p, c, _bt);
  return x.ps.settlements.some((o) => o.fallen < 0 && !o.band && o.id !== st.id && distM(x.p, o.pos, _bt) < m);
}
function bandStep(x: PCtx, st: Settlement, hour: number): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  if (!members.length) return;
  let lead = A.slotOf(st.leader);
  if (lead < 0 || A.settlement[lead] !== st.id) { electLeader(x, st); lead = A.slotOf(st.leader); }
  if (lead >= 0 && A.settlement[lead] !== st.id) lead = -1;
  if (lead < 0) return;
  // colonists with boats sail where the way crosses water
  const boat = bestBoat(x, st);
  if (boat >= 0) for (const m of members) A.boat[m] = boat;
  const at = [0, 0, 0];
  A.posAt(lead, x.tick, at);
  const here = x.p.cellAt(at);
  refreshLibrary(x, st);
  // (LIVING.md §2.7: water running within WATER_NEAR's walk of the camp is the band's camp water — decide.ts bandWater —
  // once it is seen, not only once someone has drunk there: a band that lay up through its pond's filling woke to a dry
  // pond and walked off for water 1.5 km away)
  const seen = waterOnFoot(x, A.species[lead], here, false, WATER_NEAR);
  if (seen.drink >= 0) { st.recent.wcell = seen.drink; st.recent.wseen = x.tick; }
  // (the band's camp water came back: members walking out to water farther off are called back to it — by planDrink's
  // own rule, decide.ts campBeats; at time-lapse a walk is lived in legs of hours, too long to wait for the walker's own
  // next look)
  if (bandWater(x, st) >= 0) {
    for (const m of members) {
      const g = A.gcell[m];
      if (A.task[m] !== TASK.drink || A.phase[m] !== PHASE.moving || g < 0 || A.needs[m * NEED_N + WATER] >= 0.3) continue;
      if (campBeats(x, m, st, g)) interrupt(x, m);
    }
  }
  // (fix r3 #17) a budding daughter keeps the bud's own rule wherever the band ends up: a band that lost the ground
  // chosen for it re-searched around where it stood — beside its mother — and a seed-1 daughter was founded 101 m from
  // her (siteScore's keep-away is a soft 260 m): no site within BUD_APART of a live town, and a bud that has found no
  // free ground in BUD_HOME days goes home to its mother (they ask again at her next bud check)
  const bud = st.recent.bud !== undefined;
  if (!st.target && bud && x.tick - st.recent.bud! > BUD_HOME * x.day && st.recent.kin === undefined) {
    const mother = st.parent >= 0 ? x.ps.settlement(st.parent) : undefined;
    if (mother && mother.fallen < 0 && !mother.band) {
      st.target = [mother.pos[0], mother.pos[1], mother.pos[2]];
      st.recent.kin = mother.id;
      st.recent.godSite = x.tick; // (a place chosen for them: not given up for its site score)
      st.recent.tgtAt = x.tick;
      st.recent.tgtBest = Math.round(distM(x.p, at, st.target));
      st.pos = [at[0], at[1], at[2]];
      st.cell = here;
      return;
    }
  }
  if (!st.target) {
    // sites the band found it cannot walk to (across a lake, up a cliff), gave up on or fled are passed over for ten
    // days; the expired marks are forgotten (a band wandering for weeks would otherwise carry them all in its save)
    for (const k of Object.keys(st.recent)) if (k.charCodeAt(0) === 117 /* u */ && /^u\d+$/.test(k) && x.tick - st.recent[k] >= 10 * x.day) delete st.recent[k];
    const skip0 = (c: number) => { const t = st.recent[`u${c}`]; return t !== undefined && x.tick - t < 10 * x.day; };
    // (LIVING.md §2.7: the band judges by the land it can WALK to within three days (waterway.ts) — a site or a bearing
    // across the sea or up a cliff is passed over, not swum for blind)
    waterReach(x, st, here, 3 * DAY_WALK);
    const skip = (c: number) => skip0(c) || reachCost(x, c) === Infinity || (bud && nearTown(x, st, c, BUD_APART));
    let site = searchSite(x, st.species, here, 3, st.id, skip);
    // nothing good within sight: scouts range out over a kilometre before the band moves on blind
    if (!(site.cell >= 0 && site.score >= 3.2)) site = scoutFar(x, st, at, skip);
    if (site.cell >= 0 && site.score >= 3.2 && !reachable(x, st, here, site.cell)) {
      st.recent[`u${site.cell}`] = x.tick;
      site = { cell: -1, score: -Infinity };
    }
    if (site.cell >= 0 && site.score >= 3.2) {
      st.target = cellPos(x.p, site.cell) as [number, number, number];
      delete st.recent.roam;
    } else {
      // nothing good anywhere near: walk on ~8 cells toward the greenest, wettest, flattest land in view, holding a
      // bearing for two days (short random legs went nowhere: a band set down in dry savanna circled for weeks
      // 600 m from good land)
      const base = hashFloat(st.id, Math.floor(x.tick / (2 * x.day)), worldSalt(x, 0xd1e)) * Math.PI * 2;
      const out = [0, 0, 0];
      const f = x.p.f, g = x.p.grid;
      let c = here, bestP = -Infinity;
      for (let k = 0; k < 12; k++) {
        offsetPoint(at, 8 * x.p.edgeM, base + k * (Math.PI / 6), x.p.st.radius, out);
        const o = x.p.cellAt(out);
        if (!isLand(x.p, o) || f.water[o] >= 0.15 || f.lava[o] > 0 || reachCost(x, o) === Infinity) continue;
        let promise = k === 0 ? 0.3 : 0;
        let n = 0;
        const look = (q: number) => {
          promise += f.moisture[q] * 2 + f.grass[q] * 0.6 + f.shrub[q] * 0.8 + f.tree[q] * 0.4 + (drinkable(x.p, q) ? 0.8 : 0) - f.sand[q] * 0.3;
          n++;
        };
        look(o);
        for (let e = g.nbrStart[o]; e < g.nbrStart[o + 1]; e++) look(g.nbr[e]);
        promise = promise / n - Math.abs(f.surface[o] - f.surface[here]) / 150;
        if (promise > bestP) { bestP = promise; c = o; }
      }
      st.target = cellPos(x.p, c) as [number, number, number];
      // a bearing to walk, not a site to settle (re-scoring it would drop it at once)
      st.recent.roam = x.tick;
    }
    st.recent.tgtAt = x.tick;
    st.recent.tgtBest = Math.round(distM(x.p, at, st.target));
    st.pos = [at[0], at[1], at[2]];
    st.cell = here;
    return;
  }
  const tc = x.p.cellAt(st.target);
  const leadD = distM(x.p, at, st.target);
  st.pos = [at[0], at[1], at[2]];
  st.cell = here;
  // the target is looked at again on the way: a site that has flooded (or otherwise spoilt) is given up, and so is one
  // the band makes no headway toward for three days (half of a coastal band kept going back to the sea to bathe; a
  // band walked for weeks toward a cell under 11 m of new lake)
  const roaming = st.recent.roam !== undefined;
  // (a place the god chose is kept unless it floods: the god's word outweighs the band's judgement of the site)
  const godSite = st.recent.godSite !== undefined;
  const spoilt = x.p.f.water[tc] > 0.15 || (!roaming && !godSite && (siteScore(x, st.species, tc, st.id) < 3.2 || (bud && nearTown(x, st, tc, BUD_APART))));
  if (leadD < (st.recent.tgtBest ?? Infinity) - 30) { st.recent.tgtBest = Math.round(leadD); st.recent.tgtAt = x.tick; }
  const stuck = x.tick - (st.recent.tgtAt ?? x.tick) > 3 * x.day;
  // a bearing is judged again every six hours: given up when the band can no longer walk to it (LIVING.md §2.7)
  let lost = false;
  if (roaming && x.tick - (st.recent.wjudged ?? -1e9) >= x.day / 4) {
    st.recent.wjudged = x.tick;
    waterReach(x, st, here, 3 * DAY_WALK);
    lost = reachCost(x, tc) === Infinity;
  }
  if (spoilt || stuck || lost) {
    if (!roaming) st.recent[`u${tc}`] = x.tick;
    delete st.recent.godSite;
    st.target = null;
    delete st.recent.tgtAt; delete st.recent.tgtBest; delete st.recent.roam;
    return;
  }
  // arrived: most of the band near the target, or the leader there with a third of them
  let near = 0;
  const pt = [0, 0, 0];
  for (const m of members) { A.posAt(m, x.tick, pt); if (distM(x.p, pt, st.target) < 60) near++; }
  if (near >= members.length * 0.5 || (leadD < 60 && near * 3 >= members.length)) {
    // (LIVING LAND: drought refugees join their kin — abandon)
    const kin = st.recent.kin !== undefined ? x.ps.settlement(st.recent.kin) : undefined;
    if (kin && kin.fallen < 0 && !kin.band) { joinKin(x, st, kin, bud ? 'bud.home' : 'abandon.joined'); return; }
    const v = siteScore(x, st.species, tc, st.id);
    // (fix r3 #17: a bud never founds where it wandered inside another town's BUD_APART)
    const crowded = bud && !godSite && nearTown(x, st, tc, BUD_APART);
    if (crowded && !roaming) st.recent[`u${tc}`] = x.tick;
    if (!crowded && (v >= 3.2 || godSite || (v > 1 && x.tick - (st.recent.wander ?? x.tick) > 3 * x.day))) {
      // ruins of a fallen settlement here?
      const ruin = x.ps.settlements.find((o) => o.fallen >= 0 && distM(x.p, o.pos, st.target!) < 120);
      delete st.recent.tgtAt; delete st.recent.tgtBest; delete st.recent.roam;
      found(x, st, tc, ruin ?? null);
      return;
    }
    if (st.recent.wander === undefined) st.recent.wander = x.tick;
    st.target = null;
    delete st.recent.tgtAt; delete st.recent.tgtBest; delete st.recent.roam;
  }
}

/** scouts range ~1.2 km out (every third cell, in index order): the best site, nearer ones preferred */
function scoutFar(x: PCtx, st: Settlement, at: ArrayLike<number>, skip: (c: number) => boolean): { cell: number; score: number } {
  const cells = x.p.cellsNear(at, 1200).slice().sort((a, b) => a - b);
  let best = -1, bs = -Infinity, bv = -Infinity;
  for (let i = 0; i < cells.length; i += 3) {
    const c = cells[i];
    if (skip(c)) continue;
    const v = siteScore(x, st.species, c, st.id);
    if (v < 3.2) continue;
    const val = v - distM(x.p, at, cellPos(x.p, c)) / 300;
    if (val > bv) { bv = val; bs = v; best = c; }
  }
  return { cell: best, score: bs };
}

/** can the band get from cell `from` to `to` on foot (swimmers swim; a band with boats may cross water)? */
export function reachable(x: PCtx, st: Settlement, from: number, to: number): boolean {
  if (from === to) return true;
  const opts = pathOptsFor(x, st.species);
  const boat = bestBoat(x, st);
  if (boat >= 0) opts.swim = Math.max(opts.swim, boatSwim(x, boat));
  else if (opts.swim < 1) opts.swim = 0;
  opts.maxExpand = 6000;
  return findPath(x.p, from, to, opts, _reach);
}
const _reach: number[] = [];

// ───────────────────────────── roles ─────────────────────────────

/** roles by need and knowledge (CONTRACT §8.5) */
export function assignRoles(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  // members away on a mission keep its role (trader / soldier) and are not counted here
  const adults = members.filter((m) => !(A.flags[m] & AgentFlag.child) && !A.mission[m]);
  for (const m of members) if (A.flags[m] & AgentFlag.child) A.role[m] = ROLE.child;
  const n = adults.length;
  if (!n) return;
  const lib = (id: string) => { const k = x.rt.byId.get(id); return k !== undefined && st.library.includes(k); };
  const fd = foodDays(x, st);
  const want = members.length * 3;
  const foodShare = Math.max(0.3, Math.min(0.8, 0.4 + (want - fd) / Math.max(1, want) * 0.4));
  const quota = new Array<number>(17).fill(0);
  let food = Math.max(1, Math.round(n * foodShare));
  const res = st.res;
  const foodWorkers = food;
  if (lib('agriculture') && st.crop >= 0) { quota[ROLE.farmer] = Math.max(1, Math.round(food * 0.4)); food -= quota[ROLE.farmer]; }
  // (LIVING LAND: a herder once beasts can be kept and there is a herd to keep or to tame; hunters — 15-30 % of a band's
  // food workers, 5-15 % of a farming town's — when game is within range: people/herding.ts, hunt.ts)
  const herders = Math.min(herderQuota(x, st), Math.max(0, food - 1));
  if (herders > 0) { quota[ROLE.herder] = herders; food -= herders; }
  const hunters = Math.min(huntQuota(x, st, foodWorkers), Math.max(0, food - 1));
  if (hunters > 0) { quota[ROLE.hunter] = hunters; food -= hunters; }
  if (lib('fishing') && res && res.fish.length) { quota[ROLE.fisher] = Math.max(1, Math.round(food * 0.35)); food -= quota[ROLE.fisher]; }
  quota[ROLE.gatherer] = Math.max(1, food);
  let rest = n - quota.reduce((a, b) => a + b, 0);
  const take = (role: number, k: number) => { const v = Math.max(0, Math.min(rest, k)); quota[role] += v; rest -= v; };
  // builders for the sites, and for the upkeep of what stands (with no site open nobody mended a roof, and a village of
  // huts fell to ruin in a couple of months)
  let worn = 0;
  for (const b of x.ps.of(st.id)) if (b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && b.damage >= 0.45) worn++;
  take(ROLE.builder, st.sites.length || worn ? Math.min(3 + st.sites.length + Math.ceil(worn / 3), Math.ceil(n * 0.25)) : 0);
  take(ROLE.crafter, st.jobs.length ? Math.min(st.jobs.length + 1, Math.ceil(n * 0.25)) : 0);
  if (lib('religion')) take(ROLE.priest, Math.max(1, Math.floor(n / 25)));
  if (lib('herbalism')) take(ROLE.healer, Math.floor(n / 30) + (members.some((m) => A.disease[m] >= 0) ? 1 : 0));
  // teachers by need: ideas only one person holds are the ones a death takes (counted over the library)
  let lone = 0;
  for (const k of st.library) {
    let knowers = 0;
    for (const m of adults) if (A.knows(m, k) && ++knowers > 1) break;
    if (knowers === 1) lone++;
  }
  take(ROLE.teacher, Math.floor(n / 14) + (n >= 6 ? Math.min(3, Math.floor(lone / 4)) : 0));
  if (lib('writing')) take(ROLE.scholar, Math.floor(n / 20));
  // at war (or under the threat of raids) some keep watch at home
  if (atWar(x, st) || (st.recent.raided !== undefined && x.tick - st.recent.raided < 2 * x.day)) take(ROLE.soldier, Math.max(1, Math.floor(n / 8)));
  // whoever is left gathers
  quota[ROLE.gatherer] += rest;
  st.quota = quota;
  // assign: keep current roles where quota allows; the best-skilled fill the rest (ascending id order)
  const count = new Array<number>(17).fill(0);
  const pending: number[] = [];
  // (the roles the god gave, `r<agent id>` in st.recent, gathered once — SIM perf push 3: a key built per adult per call)
  const givenRoles = godGivenRoles(st);
  // (LIVING LAND: a hunting party out stays a hunting party until it is home — people/hunt.ts)
  const party = partyOut(st);
  for (const m of adults) {
    if (A.id[m] === st.leader) { A.role[m] = ROLE.leader; continue; }
    // a role the god gave holds (god/civic.ts agent.role)
    const given = givenRoles ? givenRoles.get(A.id[m]) : undefined;
    if (given !== undefined) { A.role[m] = given; count[given]++; continue; }
    if (party.length && A.role[m] === ROLE.hunter && party.includes(A.id[m])) { count[ROLE.hunter]++; continue; }
    const r = A.role[m];
    if (r > 0 && r !== ROLE.child && r !== ROLE.leader && count[r] < quota[r]) { count[r]++; continue; }
    pending.push(m);
  }
  const SK: Record<number, number> = {
    [ROLE.gatherer]: SKILL.gather, [ROLE.hunter]: SKILL.hunt, [ROLE.fisher]: SKILL.fish, [ROLE.farmer]: SKILL.farm, [ROLE.herder]: SKILL.herd,
    [ROLE.crafter]: SKILL.craft, [ROLE.builder]: SKILL.build, [ROLE.teacher]: SKILL.lore, [ROLE.priest]: SKILL.lore, [ROLE.healer]: SKILL.heal,
    [ROLE.scholar]: SKILL.lore, [ROLE.soldier]: SKILL.fight,
  };
  const order = [ROLE.healer, ROLE.priest, ROLE.soldier, ROLE.teacher, ROLE.scholar, ROLE.builder, ROLE.crafter, ROLE.farmer, ROLE.hunter, ROLE.fisher, ROLE.herder, ROLE.gatherer];
  for (const role of order) {
    while (count[role] < quota[role] && pending.length) {
      let bi = 0, bv = -1;
      const sk = SK[role];
      for (let i = 0; i < pending.length; i++) {
        const v = A.skills[pending[i] * NS + sk] + (role === ROLE.priest ? A.traits[pending[i] * NT + TRAIT.piety] : 0) + (role === ROLE.scholar || role === ROLE.teacher ? A.traits[pending[i] * NT + TRAIT.curiosity] * 0.5 : 0)
          + (role === ROLE.soldier ? A.traits[pending[i] * NT + TRAIT.aggression] : 0);
        if (v > bv) { bv = v; bi = i; }
      }
      const m = pending.splice(bi, 1)[0];
      A.role[m] = role;
      count[role]++;
    }
  }
  for (const m of pending) A.role[m] = ROLE.gatherer;
  // (LIVING LAND: a herder or hunters asked for, and nobody free when the roles were dealt — the leader holds one of the
  // quota's places — are found among the gatherers, the most skilled at it first)
  for (const role of [ROLE.herder, ROLE.hunter]) {
    if (!quota[role]) continue;
    let have = 0;
    for (const m of adults) if (A.role[m] === role) have++;
    const sk = role === ROLE.herder ? SKILL.herd : SKILL.hunt;
    while (have < quota[role]) {
      let best = -1, bv = -1;
      for (const m of adults) if (A.role[m] === ROLE.gatherer && A.skills[m * NS + sk] > bv) { bv = A.skills[m * NS + sk]; best = m; }
      if (best < 0) break;
      A.role[best] = role;
      have++;
    }
  }
  // flags for the renderer (mission members keep theirs)
  for (const m of members) {
    if (A.mission[m]) continue;
    let f = A.flags[m] & ~(AgentFlag.priest | AgentFlag.trader | AgentFlag.soldier | AgentFlag.armed);
    if (A.role[m] === ROLE.priest) f |= AgentFlag.priest;
    if (A.role[m] === ROLE.soldier) f |= AgentFlag.soldier | AgentFlag.armed;
    A.flags[m] = f;
  }
}

/** st.recent's `r<agent id>` entries (roles the god gave) as id → role, or null when there are none */
function godGivenRoles(st: Settlement): Map<number, number> | null {
  let out: Map<number, number> | null = null;
  for (const key in st.recent) {
    if (key.charCodeAt(0) !== 114 || key.length < 2) continue;
    const id = Number(key.slice(1));
    if (!Number.isInteger(id) || `r${id}` !== key) continue;
    (out ??= new Map()).set(id, st.recent[key]);
  }
  return out;
}

// ───────────────────────────── jobs and wants ─────────────────────────────

/** what the settlement wants made this hour: tools, clothes, food processing, building materials, books... */
function planJobs(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const jobs: { k: number; n: number; cell: number; building: number }[] = [];
  const has = (k: number) => st.library.includes(k);
  // what the settlement holds, by tag (store + tools in hand + clothes worn), counted once
  const tagCount = new Map<string, number>();
  const bump = (it: number, q: number) => { for (const t of x.c.items.list[it].tags) tagCount.set(t, (tagCount.get(t) ?? 0) + q); };
  for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0) bump(i, st.store[i]);
  for (const m of members) { if (A.tool[m] >= 0) bump(A.tool[m], 1); if (A.gear[m] >= 0) bump(A.gear[m], 1); }
  const count = (tag: string) => tagCount.get(tag) ?? 0;
  let adults = 0;
  for (const m of members) if (!(A.flags[m] & AgentFlag.child)) adults++;
  // places, memoised by what a recipe asks of one (many recipes ask the same: a fire of 200 °C...)
  const placeMemo = new Map<string, { cell: number; building: number } | null>();
  const add = (k: number, n: number) => {
    if (n <= 0 || !has(k) || jobs.some((j) => j.k === k)) return;
    const r = x.rt.list[k];
    if (r.kind !== 'craft') return;
    if (!inputsAvailable(x, st, k)) return;
    const key = `${r.needs.join(',')}|${r.heat}|${r.near.join(',')}|${r.biomes.join(',')}`;
    let place = placeMemo.get(key);
    if (place === undefined) { place = placeFor(x, r, st, String(r.idx)); placeMemo.set(key, place); }
    if (!place) return;
    jobs.push({ k, n, cell: place.cell, building: place.building });
  };
  const producersOf = (tag: string) => producersByTag(x, tag);
  // (LIVING CONTENT §4.1: a people that knows a craft of the god's new material works it — the hands that learned it
  // take it before the everyday crafts that fill the day's twelve jobs (god/materials.ts: at most its few crafts, only
  // while its stock is short)
  for (const k of materialJobs(x, st)) add(k, 1);
  // food processing first: cook raw food, bake, grind, smoke surplus
  for (const k of producersOf('cooked')) add(k, 2);
  for (const k of producersOf('flour')) add(k, 2);
  // tools for the workers
  if (count('tool') < adults * 0.8) for (const k of producersOf('tool')) add(k, Math.ceil(adults * 0.8 - count('tool')));
  if (count('hunt') < Math.max(1, (st.quota[ROLE.hunter] ?? 0))) for (const k of producersOf('hunt')) add(k, 1);
  // clothes when it is cold — or before the winter comes (a town whose winter nights kill made none in summer and froze
  // in its houses at the first frost); never pressure suits for the cold (they are for air that kills: ships.ts)
  const sp = x.info[st.species].def;
  if (Math.min(x.p.s.tempMean[st.cell], seasonTemps(x, st.cell).winter) < sp.temp[1] + 4 && count('clothing') - count('suit') < members.length) {
    for (const k of producersOf('clothing')) if (!x.rt.list[k].outItems.some(([it]) => x.c.items.list[it]?.tags.includes('suit'))) add(k, members.length - count('clothing') + count('suit'));
  }
  // containers
  if (count('container') < Math.max(2, st.households.length)) for (const k of producersOf('container')) add(k, 2);
  // the material the current construction needs
  for (const id of st.sites) {
    const b = x.ps.building(id);
    if (!b) continue;
    for (const io of x.c.materials.list[b.material].items) {
      const it = io.item ? x.c.items.idx(io.item) : -1;
      if (it >= 0 && storeHas(st, it) < io.qty * 4) for (const k of x.rt.producers[it] ?? []) add(k, 3);
    }
  }
  // metals and fuels when their workplaces exist
  for (const tag of ['charcoal', 'metal', 'alloy', 'glass', 'building']) for (const k of producersOf(tag)) add(k, 1);
  // (LIVING LAND §2.6: the crafts on the way to what they want made — charcoal for the smelter, cordage for the spear —
  // most wanted first: people/wants.ts)
  {
    const can = new Set<number>();
    for (const l of gatherable(x, st).values()) for (const it of l) can.add(it);
    const chain = [...wantChain(x, st, can).crafts].filter(([, w]) => w >= 0.5).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [k] of chain) add(k, 2);
  }
  // writing: keep the library written
  for (const k of st.library) if (x.rt.list[k].writes && st.written.length < st.library.length) add(k, 1);
  // everything else they know, now and then (practice keeps skills alive)
  const hour = Math.floor(x.tick / 60);
  const practice = worldSalt(x, 0x10b);
  for (const k of st.library) if (x.rt.list[k].kind === 'craft' && hashFloat(st.id, k, hour, practice) < 0.08) add(k, 1);
  st.jobs = jobs.slice(0, 12);
}

const prodCache = new WeakMap<object, Map<string, number[]>>();
/** recipes producing an item of this tag, best quality first (static per content) */
function producersByTag(x: PCtx, tag: string): number[] {
  let m = prodCache.get(x.c);
  if (!m) { m = new Map(); prodCache.set(x.c, m); }
  let out = m.get(tag);
  if (!out) {
    out = [];
    for (const it of x.c.itemsByTag.get(tag) ?? []) for (const k of x.rt.producers[it] ?? []) if (!out.includes(k)) out.push(k);
    const q = (k: number) => x.c.items.list[x.rt.list[k].outItems[0]?.[0] ?? 0]?.quality ?? 0;
    out.sort((a, b) => q(b) - q(a) || a - b);
    m.set(tag, out);
  }
  return out;
}

/** items gatherers should bring, most wanted first */
let _wantW = new Float64Array(0);
const _wantL: number[] = [];
function planWants(x: PCtx, st: Settlement): void {
  // the weight each item is wanted with (its highest reason), and the items in the order first wanted
  const n = x.c.items.size;
  if (_wantW.length < n) _wantW = new Float64Array(n);
  const W = _wantW;
  const L = _wantL;
  L.length = 0;
  const g = gatherable(x, st);
  const can = new Set<number>();
  for (const l of g.values()) for (const it of l) can.add(it);
  const want = (it: number, w: number) => {
    if (it < 0 || !can.has(it)) return;
    if (W[it] === 0) L.push(it);
    if (w > W[it]) W[it] = w;
  };
  const push = (id: string, w: number) => want(itemIdx(x, id), w);
  const members = (x.ps.members.get(st.id) ?? []).length;
  // fuel for the fires
  const fuel = storeHas(st, itemIdx(x, 'wood'));
  push('wood', fuel < 6 + members * 0.5 ? 3 : 0.5);
  // the current site's material
  for (const id of st.sites) {
    const b = x.ps.building(id);
    if (!b) continue;
    for (const io of x.c.materials.list[b.material].items) {
      const it = io.item ? x.c.items.idx(io.item) : -1;
      if (it >= 0 && storeHas(st, it) < io.qty * 6) want(it, 4);
    }
  }
  // inputs of the jobs
  for (const j of st.jobs) for (const io of x.rt.list[j.k].inputs) for (const it of io.items) if (storeHas(st, it) < io.qty * 3) want(it, 2);
  // raw materials of what they know (clay for potters, fibre for weavers...)
  for (const k of st.library) {
    const r = x.rt.list[k];
    if (r.kind !== 'craft') continue;
    for (const io of r.inputs) for (const it of io.items) if (storeHas(st, it) < io.qty * 2) want(it, 0.6);
  }
  push('stone', storeHas(st, itemIdx(x, 'stone')) < 4 ? 1 : 0.2);
  push('reeds', storeHas(st, itemIdx(x, 'reeds')) < 6 ? 0.8 : 0.1);
  push('fiber', storeHas(st, itemIdx(x, 'fiber')) < 4 ? 0.7 : 0.1);
  // (LIVING LAND §2.6: the shortfalls of what they want made, followed down its recipes — people/wants.ts)
  for (const [it, w] of wantChain(x, st, can).items) want(it, w);
  // most wanted first (ties by item index), only what grows or lies within reach
  const out: number[] = [];
  for (const it of L) if (st.res && (st.res.items[String(it)]?.length ?? 0) > 0) out.push(it);
  out.sort((a, b) => W[b] - W[a] || a - b);
  for (const it of L) W[it] = 0;
  st.wants = out.slice(0, 10);
}

// ───────────────────────────── construction ─────────────────────────────

const SHELTER_PREF = ['house', 'longhouse', 'hive-mound', 'igloo', 'hut', 'lean-to'];
const ONE_EACH = ['hearth', 'kiln', 'furnace', 'forge', 'oven', 'workshop', 'pen', 'well', 'shrine', 'temple', 'library', 'school', 'market', 'dock',
  'shipyard', 'mill', 'observatory', 'lighthouse', 'mine', 'factory', 'powerplant', 'radio-mast', 'refinery', 'lab', 'launchpad', 'aqueduct', 'tower', 'blast-furnace'];

export function planConstruction(x: PCtx, st: Settlement): void {
  // sites whose material can no longer be had are begun again in another, or given up (buildings.ts reviseSite): a
  // stalled site used to hold one of the two open slots for ever
  for (const id of st.sites.slice()) { const b = x.ps.building(id); if (b) reviseSite(x, st, b); else st.sites.splice(st.sites.indexOf(id), 1); }
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length + cohortTotal(st);
  const mine = x.ps.of(st.id).filter((b) => !(b.flags & BuildingFlag.ruined));
  // (LIVING LAND §2.5: houses follow the people — beds against people and households without a home are reckoned
  // before anything else is begun, and a third site may be opened for a dwelling when the two open sites are other
  // works: a town of 77 slept in 50 beds for years while its sites were a kiln and a wall)
  let beds = 0, bedsUp = 0, shelterSites = 0;
  for (const b of mine) {
    // (only a place people can live in has beds — the homes of formHouseholds below; LIVING integration 2026-10-20: a
    // temple's 20 and a school's 10 counted as beds, and a town of 61 with a temple slept in 45 beds for ten years)
    const def = x.c.buildings.list[b.type];
    const cap = def.provides.includes('shelter') ? def.capacity : 0;
    beds += cap;
    if (b.progress >= 1) bedsUp += cap;
    else if (cap > 0) shelterSites++;
  }
  const homeless = st.households.some((h) => h.home < 0 && h.members.length > 0);
  const wantBeds = beds < pop || (homeless && shelterSites === 0 && bedsUp < pop + 6);
  if (st.sites.length >= (wantBeds && shelterSites === 0 ? 3 : 2)) return;
  const have = (id: string) => mine.some((b) => x.c.buildings.list[b.type].id === id);
  const tIdx = (id: string) => x.c.buildings.idx(id);
  const ok = (id: string) => { const t = tIdx(id); return t >= 0 && canBuild(x, st, t); };
  const plan = (id: string) => { const t = tIdx(id); return t >= 0 ? planBuilding(x, st, t) : null; };
  // fire first
  if (ok('hearth') && !have('hearth') && st.sites.length < 2) { if (plan('hearth')) return; }
  // shelter for everyone
  if (wantBeds) {
    const sp = x.c.species.list[st.species].id;
    for (const id of SHELTER_PREF) {
      if (!ok(id)) continue;
      if (id === 'igloo' && !(x.p.f.snow[st.cell] > 0.1 || x.p.f.temperature[st.cell] < -2)) continue;
      if (id === 'hive-mound' && sp !== 'hive') continue;
      if (id === 'longhouse' && pop < 20) continue;
      if (plan(id)) return;
    }
  }
  if (st.sites.length >= 2) return;
  // storage
  const cap = capacity(x, st);
  let stored = 0;
  for (const q of st.store) stored += q;
  if (stored > cap * 0.75) {
    if (ok('granary') && plan('granary')) return;
    if (ok('store-pit') && plan('store-pit')) return;
  }
  // workplaces they know how to build, one of each
  for (const id of ONE_EACH) {
    if (have(id) || !ok(id)) continue;
    const def = x.c.buildings.list[tIdx(id)];
    if (def.cost >= 20 && pop < 25) continue;
    if (id === 'temple' && pop < 30) continue;
    // (LIVING RELATIONSHIP: a temple where faith > 0.4 and loyalty > 0.3; else the shrine serves — god/relationship.ts)
    if (id === 'temple' && godHooks.templeWanted && !godHooks.templeWanted(x, st)) continue;
    // ports emerge from boat use: a shore that boats keep leaving from gets its dock (then a shipyard, a light)
    if ((id === 'dock' || id === 'shipyard' || id === 'lighthouse') && (!(st.res && st.res.fish.length) || (st.boatUse ?? 0) < (id === 'dock' ? 2 : 6))) continue;
    if (id === 'market' && (st.traded ?? 0) < 4 && pop < 40) continue;
    if (id === 'mine' && !Object.keys(st.res?.items ?? {}).some((key) => x.c.items.list[Number(key)].tags.includes('ore') && (st.res!.items[key]?.length ?? 0) > 0)) continue;
    // (LIVING LAND: a pen for a herd kept — the first may come home from a hunt — or one to be tamed nearby)
    if (id === 'pen' && !st.res?.contexts.includes('herds') && !ownHerds(x, st).length) continue;
    if (id === 'well' && st.res && st.res.water.length && distM(x.p, st.pos, cellPos(x.p, st.res.water[0])) < 60) continue;
    if (id === 'tower' && st.res && st.res.danger < 0) continue;
    if (plan(id)) return;
  }
  // walls: predators about, raiders, war, or a fearful culture that walls itself in
  const threatened = (st.res && st.res.danger >= 0) || atWar(x, st) || st.culture.alignment < -0.3 || (st.recent.raided !== undefined && x.tick - st.recent.raided < 4 * x.day);
  if (threatened) {
    const walls = mine.filter((b) => { const f = x.c.buildings.list[b.type].function; return f === 'wall'; }).length;
    const want = st.culture.alignment < -0.3 || atWar(x, st) ? 10 : 6;
    if (walls < want) { if (ok('wall') && plan('wall')) return; if (ok('palisade')) { plan('palisade'); return; } }
    if (atWar(x, st) && ok('tower') && mine.filter((b) => x.c.buildings.list[b.type].id === 'tower').length < 2) plan('tower');
  }
}

/**
 * Households without a home get one: the shelter with room for all of them, else (a family bigger than any free shelter
 * holds) the emptiest one with room for most of them — a family of six used to stay homeless beside a hut for five,
 * and its members crowded into whichever hut was first.
 */
function assignHomes(x: PCtx, st: Settlement): void {
  const living = new Map<number, number>();
  for (const hh of st.households) {
    if (hh.home < 0) continue;
    const b = x.ps.building(hh.home);
    if (!b || b.flags & BuildingFlag.ruined || b.progress < 1) { hh.home = -1; continue; }
    living.set(b.id, (living.get(b.id) ?? 0) + hh.members.length);
  }
  for (const hh of st.households) {
    if (hh.home >= 0 || !hh.members.length) continue;
    let fit: number = -1, roomy = -1, roomyFree = 0;
    for (const b of x.ps.of(st.id)) {
      if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
      const def = x.c.buildings.list[b.type];
      if (!def.provides.includes('shelter') || def.capacity <= 0) continue;
      const free = def.capacity - (living.get(b.id) ?? 0);
      if (free >= hh.members.length) { fit = b.id; break; }
      if (free > roomyFree) { roomyFree = free; roomy = b.id; }
    }
    const home = fit >= 0 ? fit : roomyFree >= Math.min(3, hh.members.length) && (living.get(roomy) ?? 0) === 0 ? roomy : -1;
    if (home < 0) continue;
    const b = x.ps.building(home)!;
    hh.home = home;
    b.household = hh.id;
    living.set(home, (living.get(home) ?? 0) + hh.members.length);
    for (const id of hh.members) { const s = x.A.slotOf(id); if (s >= 0) x.A.home[s] = home; }
  }
}

// ───────────────────────────── births and age ─────────────────────────────

/** births of the last `hours` hours (1: the plain hourly roll; more: the window's chance — perf/plapse.ts) */
function births(x: PCtx, st: Settlement, hours = 1): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  if (!members.length) return;
  const def = x.info[st.species].def;
  const perHour = (60 / x.year) * hours;
  const fd = foodDays(x, st) / Math.max(1, members.length);
  // well fed (a store, or full bellies: foragers keep little in store but eat well)
  let fed = 0;
  for (const m of members) fed += A.needs[m * NEED_N + FOOD];
  fed /= members.length;
  if (fd < 0.8 && fed < 0.5) return;
  const plenty = Math.min(1.4, Math.max(fd / 3, fed * 0.8));
  const atCap = A.count >= x.u.settings.maxAgents;
  const beds = x.ps.of(st.id).filter((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined)).reduce((a, b) => a + x.c.buildings.list[b.type].capacity, 0);
  const crowd = members.length > beds + 4 ? 0.5 : 1;
  // (the world seed's dice: agent and settlement ids and ticks repeat from world to world — lifecycle.ts worldSalt)
  if (def.hive) {
    const queen = members.find((m) => def.hive!.castes[A.caste[m]] === def.hive!.queen);
    if (queen === undefined) {
      // the hive raises a new queen from a worker
      const w = members.find((m) => !(A.flags[m] & AgentFlag.child) && def.hive!.castes[A.caste[m]] === 'worker');
      if (w !== undefined && hashFloat(st.id, x.tick, worldSalt(x, 0x9ee)) < chanceIn(0.05, hours)) A.caste[w] = def.hive.castes.indexOf(def.hive.queen);
      return;
    }
    const p = def.fertility * 8 * perHour * plenty * crowd;
    if (hashFloat(A.id[queen], x.tick, worldSalt(x, 0xb1b)) < p) {
      if (atCap) st.cohort.n[0] += 1; else birth(x, st, queen, -1);
    }
    return;
  }
  const dice = worldSalt(x, 0xb1c);
  // (LIVING LAND §2.8: many children to the adults, fewer births; plenty does not raise a mother's chance above
  // nature's rate — people/demography.ts)
  const fewer = mouths(x, st);
  const fed1 = plentyFactor(fd, fed);
  for (const m of members) {
    if (!(A.flags[m] & AgentFlag.female) || A.flags[m] & (AgentFlag.child | AgentFlag.elder) || !A.partner[m]) continue;
    const f = A.slotOf(A.partner[m]);
    if (f < 0) continue;
    const age = (x.tick - A.birth[m]) / x.year;
    if (age > def.elder - 5) continue;
    // (LIVING LAND: a mother's births 2-3 years apart, her fertility waning after 35 — people/demography.ts)
    if (!spaced(x, m)) continue;
    const p = def.fertility * perHour * fed1 * crowd * (0.5 + A.mood[m]) * fewer * ageFertility(age, def.elder - 5, def.maturity);
    if (hashFloat(A.id[m], x.tick, dice) < p) {
      if (atCap) st.cohort.n[0] += 1; else birth(x, st, m, f);
    }
  }
}

/** deaths of old age over the last `hours` hours (perf/plapse.ts; 1 = the plain hourly roll; exported for tests) */
export function oldAge(x: PCtx, st: Settlement, hours = 1): void {
  const A = x.A;
  const members = (x.ps.members.get(st.id) ?? []).slice();
  const perHour = (60 / x.year) * hours;
  // the world seed's dice (agent ids and ticks repeat from world to world), not the band's age dice
  const dice = worldSalt(x, 0x01da6e);
  for (const m of members) {
    // (LIVING LAND: old age takes no children — childhood has its own hazards, people/demography.ts; three of the
    // census's child deaths were logged as old age)
    if (!A.alive[m] || A.flags[m] & AgentFlag.child) continue;
    const h = ageHazard(x, m) * perHour;
    if (hashFloat(A.id[m], x.tick, dice) < h) die(x, m, DEATH.age);
  }
}

// ───────────────────────────── accidents of daily life ─────────────────────────────

/** the accidents of the last `hours` hours (perf/plapse.ts: each hourly chance becomes the window's; 1 = plain) */
function sicknessAndAccidents(x: PCtx, st: Settlement, hours = 1): void {
  const ctx = st.res?.contexts ?? [];
  const has = (k: string) => ctx.includes(k);
  // (the world seed's dice: settlement ids and ticks repeat from world to world)
  const dice = worldSalt(x, 0xacc);
  const roll = (salt: number, p: number) => hashFloat(st.id, x.tick, salt, dice) < chanceIn(p, hours);
  const lit = x.ps.of(st.id).some((b) => b.fuel > 0);
  const f = x.p.f;
  // a fire burning within sight (LIVING PACE: within 2 km — people/firewatch.ts): someone may carry it home (fire-keeping)
  if (st.recent.wildfire === undefined || x.tick - st.recent.wildfire > x.day) {
    const c = fireSeen(x, st);
    if (c >= 0) accident(x, st, 'wildfire', c);
  }
  if (lit && (has('clay') || storeHas(st, itemIdx(x, 'clay')) >= 1) && roll(1, 0.12)) accident(x, st, 'fire-on-clay', st.cell);
  if (lit && has('copper') && roll(2, 0.05)) accident(x, st, 'copper-in-fire', st.cell);
  if (has('flint') && lit && roll(3, 0.03)) accident(x, st, 'flint-sparks', st.cell);
  if ((st.recent['spilled-seed'] !== undefined && x.tick - st.recent['spilled-seed'] < x.day) || (storeHas(st, itemIdx(x, 'wild-grain')) >= 4 && has('fertile') && roll(4, 0.03))) {
    if (roll(5, 0.25)) accident(x, st, 'spilled-seed', st.cell);
  }
  if (has('predators') && roll(6, 0.012)) accident(x, st, 'wolf-cubs', st.cell);
  if (has('herds') && roll(7, 0.015)) accident(x, st, 'tame-young', st.cell);
  if (has('oil') && roll(8, 0.01)) accident(x, st, 'tar-seep', st.cell);
  if (lit && storeHas(st, itemIdx(x, 'sulfur')) >= 1 && storeHas(st, itemIdx(x, 'saltpeter')) >= 1 && roll(9, 0.03)) accident(x, st, 'firework', st.cell);
  if (f.water[st.cell] > 0.25 && roll(10, 0.3)) accident(x, st, 'flood', st.cell);
  const members = (x.ps.members.get(st.id) ?? []).length;
  if (foodDays(x, st) > members * 6 && roll(11, 0.02)) accident(x, st, 'feast', st.cell);
  if (st.res && st.res.water.length === 0 && roll(12, 0.05)) accident(x, st, 'drought', st.cell);
  // the domesticated crop: what wild grain grows here
  const ag = x.rt.byId.get('agriculture');
  if (ag !== undefined && st.library.includes(ag) && st.crop < 0) st.crop = chooseCrop(x, st);
  // storms at sea with boats
  if (has('dock') && f.precip[st.cell] > 4 && roll(13, 0.05)) accident(x, st, 'storm-at-sea', st.cell);
}

/** the domestic crop a settlement grows: from the wild grain around it (wild grain -> wheat ...) */
export function chooseCrop(x: PCtx, st: Settlement): number {
  const f = x.p.f;
  const cells = st.flow?.cells ?? [st.cell];
  const counts = new Map<number, number>();
  for (const c of cells) {
    const sp = f.grassSpecies[c];
    if (sp < 0 || f.grass[c] < 0.05) continue;
    const def = x.c.plants.list[sp];
    if (!def?.domesticatesTo) continue;
    const to = x.c.plants.idx(def.domesticatesTo);
    if (to >= 0) counts.set(to, (counts.get(to) ?? 0) + f.grass[c]);
  }
  let best = -1, bv = 0;
  for (const [k, v] of [...counts.entries()].sort((a, b) => a[0] - b[0])) if (v > bv) { bv = v; best = k; }
  if (best < 0) {
    // no wild grain here: the first domestic crop that suits the place
    for (const i of x.c.plantTable.byType[3]) if (x.c.plantTable.domestic[i]) { best = i; break; }
  }
  return best;
}

// ───────────────────────────── daily ─────────────────────────────

function daily(x: PCtx, st: Settlement): void {
  // spoilage (rotting grain is the brewing accident)
  const granary = x.ps.of(st.id).some((b) => b.progress >= 1 && x.c.buildings.list[b.type].provides.includes('granary'));
  const rot = spoil(x, st, granary, capacity(x, st));
  if (rot > 0.4) accident(x, st, 'rotten-grain', st.cell);
  decayBuildings(x, st);
  hearthAccidents(x, st);
  // belief, alignment, taboos and sacred things, the parties, households (culture.ts, social.ts)
  cultureDaily(x, st);
  factionsDaily(x, st);
  householdsDaily(x, st);
  // (LIVING LAND: the books' daily census, the status of standing — people/land.ts)
  landDaily(x, st);
  // famine notices
  if (st.stats.starved > 0 && (st.lastFamine < 0 || x.tick - st.lastFamine > 2 * x.day)) {
    const recent = st.stats.starved - (st.recent.starvedSeen ?? 0);
    if (recent >= 2) {
      tell(x.u, x.p, 'famine', vars(x, st, -1, { count: recent }), st, [settlementRef(x, st)]);
      accident(x, st, 'famine', st.cell);
      st.recent.famineAt = x.tick;
    }
    st.recent.starvedSeen = st.stats.starved;
    st.lastFamine = x.tick;
  }
  if (st.stats.froze - (st.recent.frozeSeen ?? 0) >= 2) {
    // 'they had no fire' only when they had none
    tell(x.u, x.p, st.nightLight > 0 ? 'freeze' : 'freeze.dark', vars(x, st, -1, { count: st.stats.froze - (st.recent.frozeSeen ?? 0) }), st, [settlementRef(x, st)]);
    st.recent.frozeSeen = st.stats.froze;
  }
  if ((st.recent.heatDead ?? 0) >= 2) {
    tell(x.u, x.p, 'heatdeath', vars(x, st, -1, { count: st.recent.heatDead }), st, [settlementRef(x, st)]);
    delete st.recent.heatDead;
  }
  // no water, or no food for days: they walk away
  if (abandonCheck(x, st)) return;
  // crowded and quarrelsome: a split; split down the middle: a schism
  // (fix r1 #10/#17: or, before a town ever gets that crowded, young households bud a daughter village nearby)
  if (!splitCheck(x, st)) budCheck(x, st);
  const schism = schismCandidates(x, st);
  if (schism) {
    const child = splitOff(x, st, schism.leaving, 'schism');
    if (child) {
      child.recent.schism = x.tick;
      tell(x.u, x.p, 'schism', vars(x, st, -1, { cause: schism.cause === 'faith' ? 'the gods' : 'war', faction: schism.faction, count: x.ps.members.get(child.id)?.length ?? 0 }), st, [settlementRef(x, st), settlementRef(x, child)], 2);
      accident(x, st, 'schism', st.cell);
    }
  }
  // trade, gifts, tribute, theft (economy.ts); sickness creeping to the neighbours
  economyDaily(x, st);
  neighbourContagion(x, st);
  // abandoned fields go wild (LIVING LAND: a field on the season's clock lies fallow between harvest and sowing, and a
  // flax field beside the staple is a field too — people/crops.ts)
  st.fields = st.fields.filter((c) => x.p.f.cropSpecies[c] === st.crop || x.p.f.crop[c] > 0.02 || !!st.land?.fields.some((fs) => fs.c === c));
  updateTerritory(x, st);
  st.era = computeEra(x, st);
  agesDaily(x, st);
}

/** territory field: cells within the settlement's radius belong to it (first come keeps them) */
export function updateTerritory(x: PCtx, st: Settlement): void {
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
  const r = st.band || st.fallen >= 0 ? 0 : Math.round(60 + 14 * Math.sqrt(pop));
  if (r === st.territory) return;
  const T = x.p.f.territory;
  for (let c = 0; c < T.length; c++) if (T[c] === st.id) T[c] = -1;
  st.territory = r;
  if (r > 0) for (const c of x.p.cellsNear(st.pos, r)) if (T[c] < 0) T[c] = st.id;
  x.p.bump('territory');
}

function splitCheck(x: PCtx, st: Settlement): boolean {
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length;
  const limit = 70 + 18 * st.era;
  if (pop < limit) return false;
  const crowded = foodDays(x, st) < pop * 2 || (st.res?.fertile.length ?? 0) < 2;
  if (!crowded && hashFloat(st.id, x.tick, worldSalt(x, 0x5b1)) > 0.08) return false;
  // a third of the households leave, with what they know
  const leaving = st.households.filter((h, i) => i % 3 === 2 && h.members.length > 0);
  if (!leaving.length) return false;
  return splitOff(x, st, leaving, 'crowding') !== null;
}

/** (fix r1 #10/#17) a village this big presses on its land (the young look for ground of their own) */
export const BUD_POP = 48;
/** (fix r3 #17) a daughter village stands at least this far from every live town (budCheck's rule, kept by the band) */
export const BUD_APART = 600;
/** (fix r3 #17) days a budding band looks for free ground before it goes home to its mother */
export const BUD_HOME = 12;

/**
 * (fix r1 #10/#17, the owner's 'advance as a normal world would' and 'politics from real grievances') Budding: a settled
 * village of BUD_POP or more, five years old, sends some of its young households out to clear land a short walk away
 * (0.7-2.5 km): a daughter village of the same people, tongue and polity. That is how farming villages spread (Neolithic
 * hamlets of a few houses budded daughters a kilometre or two off about once a generation), and it gives a world left
 * alone the neighbours its trade, quarrels, raids and secessions need. Before this only the crowding split above made a
 * second town, at 70 + 18 x era people (~124 in the bronze age), which an unattended village growing ~1.5 %/yr reached
 * at year 125 (acceptance.json §5.1: one settlement at every year end on 8 of 8 seeds).
 *
 * Land pressure (free fertile ground near running out, fewer fields than half the households, or thin stores) makes it
 * likelier on any day (6 % against 2 %); a village buds at most once in eight years. The leavers are whole households
 * (none with a member away), youngest heads first, never the leader's: about a third of the people and at least ten
 * adults, leaving at least 28 at home. Nothing new is saved: `recent.budAt` / `recent.bud` are keys of a saved Record.
 */
function budCheck(x: PCtx, st: Settlement): void {
  if (st.band || st.fallen >= 0 || x.tick - st.founded < 5 * x.year) return;
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length;
  if (pop < BUD_POP) return;
  const last = st.recent.budAt;
  if (last !== undefined && x.tick - last < 8 * x.year) return;
  if (atWar(x, st)) return;
  const pressed = (st.res?.fertile.length ?? 0) < 6 || st.fields.length * 2 < st.households.length || foodDays(x, st) < pop * 6;
  if (hashFloat(st.id, x.tick, worldSalt(x, 0xb0d)) > (pressed ? 0.06 : 0.02)) return;
  const A = x.A;
  const cands: { h: Household; n: number; adults: number; oldest: number }[] = [];
  for (const h of st.households) {
    if (!h.members.length || h.members.includes(st.leader)) continue;
    let n = 0, adults = 0, oldest = 0, away = false;
    for (const id of h.members) {
      const s = A.slotOf(id);
      if (s < 0) continue;
      if (A.settlement[s] !== st.id || A.mission[s]) { away = true; break; }
      n++;
      if (!(A.flags[s] & AgentFlag.child)) { adults++; oldest = Math.max(oldest, x.tick - A.birth[s]); }
    }
    if (!away && adults > 0) cands.push({ h, n, adults, oldest });
  }
  cands.sort((a, b) => a.oldest - b.oldest || a.h.id - b.h.id);
  const want = Math.round(pop * 0.36);
  const leaving: Household[] = [];
  let n = 0, adults = 0;
  for (const c of cands) {
    if (n >= want && adults >= 10) break;
    leaving.push(c.h); n += c.n; adults += c.adults;
  }
  if (adults < 10 || leaving.length < 3 || pop - n < 28) return;
  // the new ground: the best site 0.7-2.5 km off that no other town holds, nearer preferred, that they can walk to
  const p = x.p;
  const cells = p.cellsNear(st.pos, 2500).slice().sort((a, b) => a - b);
  const sites: [number, number][] = [];
  for (let i = hash32(st.id, x.tick) & 1; i < cells.length; i += 2) {
    const c = cells[i];
    if (p.f.territory[c] >= 0) continue;
    const at = cellPos(p, c);
    const d = distM(p, at, st.pos);
    if (d < 700) continue;
    if (x.ps.settlements.some((o) => o.fallen < 0 && !o.band && o.id !== st.id && distM(p, o.pos, at) < BUD_APART)) continue;
    const v = siteScore(x, st.species, c, st.id);
    if (v >= 3.4) sites.push([c, v - d / 1000]);
  }
  sites.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  // (up to six tries, each in a new place: the best few sites often lie together across the same water)
  let site = -1;
  const bad: number[] = [];
  for (const [c] of sites) {
    if (bad.length >= 6) break;
    const at = cellPos(p, c);
    if (bad.some((b) => distM(p, cellPos(p, b), at) < 400)) continue;
    if (reachable(x, st, st.cell, c)) { site = c; break; }
    bad.push(c);
  }
  // no ground to be had: they ask again in two years
  st.recent.budAt = site >= 0 ? x.tick : x.tick - 6 * x.year;
  if (site < 0) return;
  const child = splitOff(x, st, leaving, 'bud', site);
  if (child) child.recent.bud = x.tick;
}

/**
 * Households leave st as a band (crowding, a schism, exile): they take their share of the stores, their knowledge, a
 * drifted tongue, and walk to a good site well away — or, with boats, cross the water to a better one (colonisation).
 */
export function splitOff(x: PCtx, st: Settlement, leaving: Household[], cause: string, site = -1): Settlement | null {
  const A = x.A;
  const movable = (h: Household) => h.members.filter((id) => { const s = A.slotOf(id); return s >= 0 && A.settlement[s] === st.id && !A.mission[s]; });
  let n = 0;
  for (const h of leaving) n += movable(h).length;
  if (n < 2) return null;
  const child = newSettlement(x, st.species, st.cell, true, st);
  child.culture.taboos = st.culture.taboos.slice();
  child.culture.sacred = st.culture.sacred.slice();
  let moved = 0;
  for (const h of leaving) {
    const ids = movable(h);
    for (const id of ids) {
      const s = A.slotOf(id);
      x.ps.removeMember(st.id, s);
      A.settlement[s] = child.id;
      A.home[s] = -1;
      x.ps.addMember(child.id, s);
      moved++;
    }
    h.members = h.members.filter((id) => !ids.includes(id));
    child.households.push({ id: h.id, members: ids, home: -1 });
  }
  st.households = st.households.filter((h) => h.members.length > 0);
  peopleLeft(x, st, moved); // (fix r4 #22) leaving alive is not dwindling
  // supplies for the road: the leavers' share of the stores by head, at least a quarter (fix r2 #14: a flat quarter for
  // 20 of 48 people sent a bud off with ten days' food and no fields, and it starved within the week)
  const share = Math.min(0.5, Math.max(0.25, moved / Math.max(1, moved + (x.ps.members.get(st.id)?.length ?? 0))));
  for (let i = 0; i < st.store.length; i++) {
    const q = Math.round(st.store[i] * share * 1000) / 1000;
    if (q > 0 && !x.c.items.list[i].tags.includes('boat')) { st.store[i] = Math.round((st.store[i] - q) * 1000) / 1000; storeAdd(x, child, i, q); }
  }
  child.leader = 0;
  refreshLibrary(x, child);
  refreshLibrary(x, st);
  child.era = computeEra(x, child);
  // where to: a good site well away from the parent, by land — or over the water when they have boats and it is better
  // (fix r1 #10/#17: a budding daughter village goes to the ground chosen for it, `site`, on foot)
  const far = site >= 0 ? { cell: site, score: Infinity } : searchSite(x, st.species, st.cell, 9, st.id);
  let target = far.cell >= 0 && distM(x.p, cellPos(x.p, far.cell), st.pos) > 250 ? far.cell : -1;
  const boat = site >= 0 ? -1 : bestBoat(x, st);
  if (boat >= 0) {
    const over = colonySite(x, st, boat, target >= 0 ? far.score : -Infinity);
    if (over >= 0) {
      target = over;
      const boats = Math.min(Math.floor(storeHas(st, boat)), Math.ceil(moved / boatSeats(x, boat)));
      st.store[boat] = Math.round((st.store[boat] - boats) * 1000) / 1000;
      storeAdd(x, child, boat, boats);
      child.recent.colony = x.tick;
      st.boatUse = (st.boatUse ?? 0) + 1;
    }
  }
  child.target = target >= 0 ? cellPos(x.p, target) as [number, number, number] : null;
  x.u.emit({ t: 'settlement.split', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], a: moved, ref: settlementRef(x, st), data: { child: child.id, cause, sea: child.recent.colony !== undefined } });
  return child;
}

/**
 * A site across the water worth the voyage: the best site within ~16 rings that the band could not walk to but could
 * sail to, if it beats the best site by land (`landScore`). -1 when there is none.
 */
function colonySite(x: PCtx, st: Settlement, boat: number, landScore: number): number {
  const g = x.p.grid;
  const seen = new Set<number>([st.cell]);
  let fr = [st.cell];
  const cands: [number, number][] = [];
  for (let d = 0; d < 16; d++) {
    const nf: number[] = [];
    for (const c of fr) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); nf.push(o); } }
    nf.sort((a, b) => a - b);
    if (d >= 5) for (let i = d % 2; i < nf.length; i += 2) { const v = siteScore(x, st.species, nf[i], st.id); if (v >= 3.2 && v > landScore + 0.5) cands.push([nf[i], v]); }
    fr = nf;
  }
  cands.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const land = pathOptsFor(x, st.species);
  land.maxExpand = 3000;
  // a family with its goods does not swim a strait (amphibious peoples do)
  if (land.swim < 1) land.swim = 0;
  const sea = pathOptsFor(x, st.species);
  sea.swim = Math.max(sea.swim, 2.2);
  sea.maxExpand = 5000;
  const path: number[] = [];
  for (const [c] of cands.slice(0, 4)) {
    if (findPath(x.p, st.cell, c, land, path)) continue; // walkable: no boats needed
    if (findPath(x.p, st.cell, c, sea, path)) return c;
  }
  return -1;
}

/**
 * A settlement is abandoned when its place fails it: flooded (water over the centre or most of its houses — it used to
 * be called a drought, because flooded cells are no drinking spots), dried out, starving, or too cold or hot to live
 * through (most of them suffering for two days, or deaths from it, with no better season coming). Survivors leave as a
 * band carrying what food they can, for a site chosen for the year ahead.
 */
function abandonCheck(x: PCtx, st: Settlement): boolean {
  const members = x.ps.members.get(st.id) ?? [];
  if (!members.length) return false;
  const f = x.p.f;
  const A = x.A;
  // flood: the centre, or most of the standing buildings, under water
  let built = 0, drowned = 0;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
    built++;
    if (f.water[b.cell] > 0.5) drowned++;
  }
  // (fix r1 #15: the god's flood omen is a sign, not the place failing them — for a day after it (`recent.omenFlood`,
  // stamped by god/omens.ts) its water does not count)
  const omen = st.recent.omenFlood !== undefined && x.tick - st.recent.omenFlood < x.day;
  if (!omen && st.recent.omenFlood !== undefined) delete st.recent.omenFlood;
  const flooded = !omen && (f.water[st.cell] > 0.6 || (built >= 2 && drowned * 2 > built));
  // (its own key, LIVING integration 2026-10-20: `recent.flood` is also the cooldown stamp of the 'flood' discovery
  // accident (knowledge.ts accident), which fires every few hours while water stands at the centre and kept restarting
  // this timer — a town lived 4.6 days in a 5 m crater lake before it was let go)
  if (flooded) st.recent.floodSince = st.recent.floodSince ?? x.tick; else delete st.recent.floodSince;
  const well = x.ps.of(st.id).some((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].provides.includes('water') && wellFlows(x.p, b.cell));
  // (LIVING LAND §2.7: dry means no FRESH water in reach now — the list is hours old, and a drought left it holding
  // dried cells while the town died of thirst)
  const dry = !flooded && !well && st.res !== null && !st.res.water.some((c) => freshAt(x, st, c)) && x.info[st.species].needW[1] > 0;
  if (dry) st.recent.dry = st.recent.dry ?? x.tick; else delete st.recent.dry;
  // starving: the store empty and either deaths from hunger or bellies empty all round (waiting for three deaths let a
  // whole town starve on one day: they all reached the end of their strength together)
  let fed = 0;
  for (const m of members) fed += A.needs[m * NEED_N + FOOD];
  const empty = fed / members.length < 0.2;
  const starving = foodDays(x, st) < members.length * 0.15 && (empty || st.stats.starved - (st.recent.starvedAtCheck ?? 0) >= 3);
  if (starving) st.recent.hungry = st.recent.hungry ?? x.tick; else delete st.recent.hungry;
  if (!starving) st.recent.starvedAtCheck = st.stats.starved;
  // cold or heat: most of them worn down by it (their warmth need spent), or dying of it, and the season ahead no kinder
  const def = x.info[st.species].def;
  const [, lo, hi] = def.temp;
  let suffering = 0;
  for (const m of members) if (A.needs[m * NEED_N + WARMTH] < 0.25) suffering++;
  const season = seasonTemps(x, st.cell);
  const tooCold = season.now < (lo + hi) / 2;
  const kinder = tooCold ? season.ahead >= lo : season.ahead <= hi;
  const dead = (st.recent.thermalDead ?? 0) >= 3 && x.tick - (st.recent.thermalAt ?? -1e9) < 3 * x.day;
  const harsh = (suffering > members.length * 0.4 || dead) && !kinder && !enduresSeason(x, st);
  if (harsh) st.recent.harsh = st.recent.harsh ?? x.tick; else delete st.recent.harsh;
  if (!dead && st.recent.thermalAt !== undefined && x.tick - st.recent.thermalAt >= 3 * x.day) { delete st.recent.thermalDead; delete st.recent.thermalAt; }
  const cause = st.recent.floodSince !== undefined && x.tick - st.recent.floodSince > 0.5 * x.day ? 'flood'
    // (a dry town leaves within the day: thirst kills in two or three, and a people waiting longer died where it stood)
    : st.recent.dry !== undefined && x.tick - st.recent.dry > 0.75 * x.day ? 'drought'
    : st.recent.harsh !== undefined && (x.tick - st.recent.harsh > 2 * x.day || dead) ? (tooCold ? 'cold' : 'heat')
    : st.recent.hungry !== undefined && x.tick - st.recent.hungry > 2 * x.day ? 'famine' : null;
  if (!cause) return false;
  // (LIVING integration, 2026-10-20: water over the heart of a town with dry ground beside it — the pond a default
  // meteor's crater became, a swollen stream — moves the town there, its deep-drowned houses lost, instead of ending it:
  // the seed-4 town of the acceptance sessions walked away from a crater lake and was founded anew 400 m off under a new
  // name, its record with its god left behind. A flood with no dry ground in the town's reach still drives them out)
  if (cause === 'flood' && moveHeart(x, st)) { delete st.recent.floodSince; return false; }
  abandon(x, st, cause);
  return true;
}

/**
 * LIVING integration: the heart of a flooded town moves to dry ground in its own reach — the cell of one of its standing
 * buildings nearest the old centre, else the nearest dry land within its territory — and the houses under deep water
 * (> 1.5 m) are lost (its builders raise new ones about the new heart). The caches that start from the centre (the flow
 * field, the resource lists) are rebuilt; the chronicle tells it. False when there is no dry ground in reach.
 */
export function moveHeart(x: PCtx, st: Settlement, why: 'flood' | 'ruin' = 'flood'): boolean {
  const p = x.p, f = p.f;
  const dry = (c: number) => isLand(p, c) && f.water[c] < 0.05 && f.lava[c] <= 0 && !p.s.ocean[c];
  let best = -1, bd = Infinity;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & BuildingFlag.ruined || b.cell === st.cell || !dry(b.cell)) continue;
    const d = distM(p, b.pos, st.pos);
    if (d < bd || (d === bd && b.cell < best)) { bd = d; best = b.cell; }
  }
  if (best < 0) {
    // (fix r2 #12: at least the ring of cells around the heart — on a coarse world a small town's territory is its own
    // cell, and a rift or a pit at its heart had nowhere to move it)
    for (const c of p.cellsNear(st.pos, Math.max(st.territory, p.edgeM * 1.6))) {
      if (c === st.cell || !dry(c)) continue;
      const d = distM(p, cellPos(p, c), st.pos);
      if (d < bd || (d === bd && c < best)) { bd = d; best = c; }
    }
  }
  if (best < 0) return false;
  for (const b of x.ps.of(st.id)) if (b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && f.water[b.cell] > 1.5) ruin(x, st, b, 'flood');
  st.cell = best;
  st.pos = cellPos(p, best) as [number, number, number];
  // (the territory is reckoned from the centre, as when the god moves a town: god/civic.ts; and the views see the move)
  updateTerritory(x, st);
  updateFlow(x, st);
  updateResources(x, st);
  x.ps.version++;
  // (fix r2 #12: a god-sent disaster below full wrath that leaves lava or a pit at the heart moves it too — 'heart.ruin')
  tell(x.u, x.p, why === 'ruin' ? 'heart.ruin' : 'heart.flood', vars(x, st, -1, {}), st, [settlementRef(x, st)]);
  return true;
}

/**
 * Does a town sit out the cold or heat of a season rather than leave (abandonCheck)? A town with roofs for most of its
 * people does not walk out into the season that hurts it — a band in the open dies of what a town lives through (a city
 * of 75 houses left after a late frost and froze to the last on a bare riverbank the next winter). It leaves only a
 * place whose year itself is past bearing (the world moved, an ice age): the rule a people choosing a site judges by
 * (siteScore).
 */
export function enduresSeason(x: PCtx, st: Settlement): boolean {
  if (st.band) return false;
  const [tMin, lo, hi, tMax] = x.info[st.species].def.temp;
  const season = seasonTemps(x, st.cell);
  if (season.year < tMin + (lo - tMin) * 0.5 || season.year > tMax - (tMax - hi) * 0.5) return false;
  if (season.winter < tMin + (lo - tMin) * 0.25 || season.summer > tMax - (tMax - hi) * 0.25) return false;
  let beds = 0;
  for (const b of x.ps.of(st.id)) if (b.progress >= 1 && !(b.flags & BuildingFlag.ruined)) beds += x.c.buildings.list[b.type].capacity;
  return beds >= (x.ps.members.get(st.id)?.length ?? 0) * 0.6;
}

export function abandon(x: PCtx, st: Settlement, cause: string): Settlement {
  const A = x.A;
  const band = newSettlement(x, st.species, st.cell, true, st);
  // the same people: their language and their name go with them
  band.langSeed = st.langSeed;
  band.language = st.language;
  band.langLine = st.langLine.slice();
  band.name = st.name.split(' ')[0];
  band.culture = JSON.parse(JSON.stringify(st.culture));
  band.parent = -1;
  const members = (x.ps.members.get(st.id) ?? []).slice();
  for (const s of members) {
    x.ps.removeMember(st.id, s);
    A.settlement[s] = band.id;
    A.home[s] = -1;
    x.ps.addMember(band.id, s);
  }
  band.households = st.households.map((h) => ({ id: h.id, members: h.members.slice(), home: -1 }));
  st.households = [];
  // carry food: the foods that feed most first, a share each, up to a load each (LIVING.md §2.7: hands already full of
  // stone and flint carried a little bread away from a town in a dust bowl and left 342 maize in its ruins)
  carryOut(x, st, members);
  st.cohort = newCohort(st.cohort.skill);
  refreshLibrary(x, band);
  band.era = computeEra(x, band);
  // the town's boats go with its people (bandStep sails them where the way crosses water); a town with none that knows
  // raft-making lashes one from its store when no lasting water is left within three days' walk — an island town in a
  // dust bowl (seed 1, year 46) had 150 wood and 38 cordage in its ruins and the mainland 470 m off (LIVING.md §2.7)
  for (const it of x.c.itemsByTag.get('boat') ?? []) if ((st.store[it] ?? 0) >= 1) { const n = Math.floor(st.store[it]); band.store[it] = (band.store[it] ?? 0) + n; st.store[it] -= n; }
  const raft = itemIdx(x, 'raft'), wood = itemIdx(x, 'wood'), cord = itemIdx(x, 'cordage'), raftMaking = x.rt.byId.get('raft-making');
  if (bestBoat(x, band) < 0 && raft >= 0 && wood >= 0 && cord >= 0 && raftMaking !== undefined && libHas(band, raftMaking) && (st.store[wood] ?? 0) >= 4 && (st.store[cord] ?? 0) >= 2) {
    const R = waterReach(x, band, st.cell, 3 * DAY_WALK);
    if (!R.water.some((c) => lastingWater(x, c))) { st.store[wood] -= 4; st.store[cord] -= 2; band.store[raft] = 1; }
  }
  // the place that failed them is not chosen again for a while (a flooded town's band re-founded in its own drowned
  // ruins the next day), nor its neighbourhood when the water took it
  band.recent[`u${st.cell}`] = x.tick;
  if (cause === 'flood') { const g = x.p.grid; for (let e = g.nbrStart[st.cell]; e < g.nbrStart[st.cell + 1]; e++) band.recent[`u${g.nbr[e]}`] = x.tick; }
  // the people leaving judge their next place by what they can walk to (waterway.ts; with the boats and raft they have)
  waterReach(x, band, st.cell, 3 * DAY_WALK);
  const skip = (c: number) => band.recent[`u${c}`] !== undefined || (cause === 'flood' && x.p.f.water[c] > 0.05) || reachCost(x, c) === Infinity;
  const far = searchSite(x, st.species, st.cell, 9, st.id, skip);
  band.target = far.cell >= 0 && far.cell !== st.cell && far.score >= 3.2 ? cellPos(x.p, far.cell) as [number, number, number] : null;
  // (LIVING LAND §2.7: a town the drought drove out goes to its kin within 3 km where the water still runs — they take
  // them in: joinKin when it gets there — else toward the best site the band's own search finds, water weighing in it)
  if (cause === 'drought') {
    const kin = kinWithWater(x, st);
    if (kin) {
      band.target = [kin.pos[0], kin.pos[1], kin.pos[2]];
      band.recent.kin = kin.id;
      band.recent.godSite = x.tick; // (a place chosen for them: not given up for its site score)
    }
  }
  tell(x.u, x.p, `abandon.${cause}`, vars(x, st, -1, { cause }), st, [settlementRef(x, st)]);
  fall(x, st, cause);
  return band;
}

/**
 * What the people leaving a town carry (LIVING.md §2.7): the hands' non-food goods (stone, flint, wood) go back into the
 * old store, then the foods that feed most (quantity x edible) first, a share each, up to a load each (LOAD_KG).
 */
function carryOut(x: PCtx, st: Settlement, members: number[]): void {
  const A = x.A, sp = x.info[st.species], items = x.c.items.list;
  const kinds = sp.foods.filter((it) => (st.store[it] ?? 0) > 0.01).sort((a, b) => st.store[b] * sp.edible[b] - st.store[a] * sp.edible[a] || a - b);
  if (!kinds.length || !members.length) return;
  for (const s of members) {
    for (let k = 0; k < INV; k++) {
      const it = A.invItem[s * INV + k];
      if (it < 0 || sp.edible[it] > 0) continue;
      st.store[it] = (st.store[it] ?? 0) + A.invQty[s * INV + k];
      A.invItem[s * INV + k] = -1; A.invQty[s * INV + k] = 0;
    }
  }
  const kg = (s: number) => { let w = 0; for (let k = 0; k < INV; k++) { const it = A.invItem[s * INV + k]; if (it >= 0) w += A.invQty[s * INV + k] * (items[it].weight ?? 1); } return w; };
  for (const it of kinds) {
    let q = st.store[it];
    const share = q / members.length, wt = Math.max(0.05, items[it].weight ?? 1);
    for (const s of members) {
      const take = Math.min(share, Math.max(0, (LOAD_KG - kg(s)) / wt));
      if (take <= 0.01) continue;
      const left = A.give(s, it, take);
      q -= take - left;
    }
    st.store[it] = Math.max(0, Math.round(q * 1000) / 1000);
  }
}

/** LIVING LAND: fresh water to drink at cell c for the people of st now (the cell or one beside it; snow for the cold) */
function freshAt(x: PCtx, st: Settlement, c: number): boolean {
  const p = x.p;
  if (p.f.water[c] >= 0.6) return false;
  if (drinkable(p, c)) return true;
  if (x.info[st.species].def.habitat.includes('cold') && snowWater(p, c)) return true;
  const g = p.grid;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (freshWater(p, g.nbr[e])) return true;
  return false;
}

/** LIVING LAND: the nearest kin settlement of st (same people and polity, or parent / daughter) within 3 km whose water
 * still runs, or null */
function kinWithWater(x: PCtx, st: Settlement): Settlement | null {
  let best: Settlement | null = null, bd = 3000;
  for (const o of x.ps.settlements) {
    if (o === st || o.fallen >= 0 || o.band || o.species !== st.species) continue;
    if (o.polity !== st.polity && o.parent !== st.id && st.parent !== o.id) continue;
    if (!o.res || !o.res.water.some((c) => freshAt(x, o, c))) continue;
    const d = distM(x.p, st.pos, o.pos);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** LIVING LAND: a band of drought refugees arrives at its kin: its people, households and what they carry join them */
function joinKin(x: PCtx, band: Settlement, kin: Settlement, line = 'abandon.joined'): void {
  const A = x.A;
  for (const s of (x.ps.members.get(band.id) ?? []).slice()) {
    x.ps.removeMember(band.id, s);
    A.settlement[s] = kin.id;
    A.home[s] = -1;
    x.ps.addMember(kin.id, s);
  }
  for (const h of band.households) kin.households.push({ id: h.id, members: h.members.slice(), home: -1 });
  band.households = [];
  for (let i = 0; i < band.store.length; i++) if (band.store[i] > 0) storeAdd(x, kin, i, band.store[i]);
  tell(x.u, x.p, line, vars(x, kin, -1, { other: band.name }), kin, [settlementRef(x, kin)], 1);
  fall(x, band, 'joined');
}

/** the settlement falls: ruins remain */
export function fall(x: PCtx, st: Settlement, cause: string): void {
  if (st.fallen >= 0) return;
  st.fallen = x.tick;
  for (const b of x.ps.of(st.id)) {
    b.flags |= BuildingFlag.abandoned;
    b.flags &= ~(BuildingFlag.lit | BuildingFlag.occupied | BuildingFlag.working);
    b.fuel = 0;
    if (b.progress < 1) b.flags |= BuildingFlag.ruined;
  }
  updateTerritory(x, st);
  for (const h of x.ps.herds) if (h.owner === st.id) h.owner = -1;
  if (!st.band) {
    // an abandonment was told already; an emptied settlement gets its fall
    if (cause !== 'drought' && cause !== 'famine' && cause !== 'god') tell(x.u, x.p, cause === 'starvation' ? 'fall.starvation' : 'fall', vars(x, st, -1, { cause }), st, [settlementRef(x, st)], 3);
    emitSt(x, st, { t: 'settlement.fallen', text: st.name, data: { cause } });
  }
  x.ps.version++;
  checkWorldEmpty(x);
}

/** settle a band at once at its current place (scenario setup, the god's 'found' command) */
export function foundNow(x: PCtx, st: Settlement, cell: number): void {
  found(x, st, cell, null);
}

/** era names for views */
export function eraName(era: number): string {
  return ERAS[Math.max(0, Math.min(ERAS.length - 1, era))];
}

export { styleOf, availability, territoryRings, recipeTable, libHas, learn, seedItems };
