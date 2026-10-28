// GENESIS — LIVING LAND (LIVING.md §2): living off the land. Hunting parties that track, camp, stalk and carry the kill
// home; the first herd (the herder named before there is a herd, young brought home from the hunt) and the herds kept;
// fishing from real shoals and the waters' own stocks, which can be fished out and grow back; crops on the season's
// clock; houses that follow the people; wants chained down the recipes; a drought that sends a town to water or kin;
// births spaced and the hazards of childhood; needs that can be met; children's play and chores; festivals, weddings and
// funerals; and the ledger that keeps the books of it all (query 'ledger', SettlementView.livelihood, flags2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { AgentFlag, AgentFlag2 } from '../src/sim/types.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import type { PCtx } from '../src/sim/people/ctx.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { DEATH, MEM, MEMK, ROLE, TASK, SKILL, NS } from '../src/sim/people/defs.ts';
import { NEED_N, STATUS, CURIO } from '../src/sim/people/needs.ts';
import { distM, cellPos, isLand, drinkable, freshWater, sunElevation } from '../src/sim/people/world.ts';
import { spawnHerd, reindexHerds, animalDef, herdPos } from '../src/sim/life/herds.ts';
import { die } from '../src/sim/people/lifecycle.ts';
import { formCouple } from '../src/sim/people/social.ts';
import { abandon, assignRoles, oldAge, planConstruction, settlementStep } from '../src/sim/people/settlement.ts';
import { landOf, ledger, type LedgerYear } from '../src/sim/people/ledger.ts';
import { HUNT_RANGE_M, HUNT_TUNE, carcass, fetchTask, huntEncounter, huntHourly, isGame, huntQuota, parties, partyOf, partyOut } from '../src/sim/people/hunt.ts';
import { daylightLeft } from '../src/sim/perf/pace.ts';
import { herderQuota, herdWork, youngFromHunt } from '../src/sim/people/herding.ts';
import { stockAt, stockFactor, fishWork, THIN } from '../src/sim/people/fishing.ts';
import { cropsHourly, farmTask, farmWork, fieldSite, newFieldCell, pruneFields, sowingTime, villageGround, yearPhase } from '../src/sim/people/crops.ts';
import { seedItems } from '../src/sim/people/decide.ts';
import { ageFertility, birthGap, childhood, childHazard, CHILD_HAZARD, CROWDED_FEVER, mouths, plentyFactor, spaced } from '../src/sim/people/demography.ts';
import { companyNear, fireless, gatheringsHourly, nextGathering, NEAR_M } from '../src/sim/people/gatherings.ts';
import { statusDaily, talkOutlet } from '../src/sim/people/outlets.ts';
import { wantChain, wantPick } from '../src/sim/people/wants.ts';
import { gatherable, itemIdx } from '../src/sim/people/resources.ts';
import { storeAdd } from '../src/sim/people/store.ts';
import { planBuilding, removeBuilding, ruin } from '../src/sim/people/buildings.ts';
import { roofless } from '../src/sim/people/land.ts';
import { world, must, people, membersOf, adultsOf } from './helpers/peoples.ts';

// ───────────────────────────── fixtures ─────────────────────────────

/** a settled village (bronze: hunting, husbandry, farming and fishing known) on the n = 24 sandbox */
function village(era = 'bronze', seed = 20261008, count = 30): { sim: Sim; st: Settlement } {
  const sim = world(24, seed);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', count, { era, settled: true });
  sim.step(30);
  return { sim, st };
}

function cx(sim: Sim): PCtx {
  return makeCtx(sim.u, sim.u.planets[0]);
}

/** a land cell between lo and hi metres from the settlement (the driest, greenest first), or -1 */
function landAt(x: PCtx, st: Settlement, lo: number, hi: number): number {
  const p = x.p;
  let best = -1, bv = -1;
  for (let c = 0; c < p.count; c++) {
    if (!isLand(p, c) || p.f.water[c] > 0.05) continue;
    const d = distM(p, cellPos(p, c), st.pos);
    if (d < lo || d > hi) continue;
    const v = p.f.grass[c] + p.f.shrub[c] - Math.abs(d - (lo + hi) / 2) / 1000;
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

/** no wild beasts on the world (a closed world for the fixture) */
function clearWild(x: PCtx): void {
  x.ps.herds = x.ps.herds.filter((h) => h.owner >= 0);
  x.ps.eco.immigration = false;
  reindexHerds(x);
}

function sumRow(st: Settlement, f: (r: LedgerYear) => number): number {
  return (st.land?.ledger ?? []).reduce((a, r) => a + f(r), 0);
}

// ───────────────────────────── the ledger ─────────────────────────────

test('land: the ledger keeps the books of a settlement-year and query ledger reads them', () => {
  const { sim, st } = village('stone');
  sim.step(1440);
  const q = sim.query('ledger', { settlement: st.id }) as { year: number; settlements: { settlement: number; years: LedgerYear[] }[] };
  assert.equal(q.settlements.length, 1);
  const row = q.settlements[0].years[0];
  assert.ok(row, 'a row for the year');
  assert.equal(row.year, 0);
  assert.ok(Object.keys(row.gathered).length > 0, `gathering is in the books: ${JSON.stringify(row.gathered)}`);
  assert.ok(row.food.forage > 0, 'the food foraged, in food-days');
  assert.ok(row.pop > 0 && row.houses >= 0, 'the daily census of people and houses');
  // a death at home: in the books by cause and age, and a funeral is owed
  const x = cx(sim);
  const before = sumRow(st, (r) => r.homeDeaths);
  const victim = adultsOf(sim, st)[0];
  die(x, victim, DEATH.injury);
  assert.equal(sumRow(st, (r) => r.homeDeaths), before + 1);
  assert.ok((ledger(x, st).deaths.wounds ?? 0) >= 1, 'deaths by cause name');
  assert.ok(landOf(st).gatherings.some((g) => g.kind === 'funeral'), 'a funeral is planned');
  const all = sim.query('ledger') as { settlements: unknown[] };
  assert.ok(all.settlements.length >= 1, 'every settlement without a filter');
  // a time-lapse window replays agents in the past (perf/plapse.ts moves x.tick back): at a year's end entries for the
  // old year and the new one alternate, and each finds its own row — one row a year, in order
  const t0 = x.tick, edge = (Math.floor(t0 / x.year) + 1) * x.year;
  for (let i = 0; i < 6; i++) {
    x.tick = i % 2 ? edge + 30 : edge - 30;
    ledger(x, st).births++;
  }
  x.tick = t0;
  const years = landOf(st).ledger.map((r) => r.year);
  assert.deepEqual(years, [...new Set(years)].sort((a, b) => a - b), `one row a year, in order: ${years.join(',')}`);
  assert.equal(landOf(st).ledger.find((r) => r.year === Math.floor(edge / x.year))?.births, 3);
});

// ───────────────────────────── hunting ─────────────────────────────

test('land: a hunting party tracks game beyond the old reach, camps, stalks it, makes a kill and carries the meat home', () => {
  const { sim, st } = village();
  const x = cx(sim);
  clearWild(x);
  for (const it of x.c.itemsByTag.get('meat') ?? []) st.store[it] = 0;
  // a herd of deer 1.2-1.7 km out: past the 7 cells (~1 050 m at this grid) hunters used to reach, within the 2 km beyond
  const c = landAt(x, st, 1200, 1700);
  assert.ok(c >= 0, 'land for the deer');
  const deer = x.c.animals.idx('deer');
  const h = spawnHerd(x, deer, c, 10);
  assert.ok(huntQuota(x, st, 8) >= 2, 'hunters are wanted with game in range');
  let party = 0, kills = 0;
  for (let t = 0; t < 4 * 1440 && kills === 0; t += 30) {
    sim.step(30);
    const p = st.land?.party;
    if (p) party = Math.max(party, p.members.length);
    kills = sumRow(st, (r) => Object.values(r.kills).reduce((a, b) => a + b, 0));
  }
  assert.ok(party >= 2 && party <= 6, `a party of 2-6 went out (${party})`);
  assert.ok(kills >= 1, 'a kill');
  assert.ok(sumRow(st, (r) => r.huntTrips) >= 1, 'the trip is in the books');
  assert.ok(h.count >= 10 - 2, `never more than a fifth of the herd at once (${h.count} left of 10)`);
  assert.ok(sumRow(st, (r) => r.food.hunt) > 5, 'the meat they carried, in food-days');
  // the hunters carry it home (meat in the store or in their hands)
  const meat = x.c.items.idx('meat');
  const carried = membersOf(sim, st).reduce((a, s) => a + x.A.carried(s, meat), 0);
  sim.step(1440);
  assert.ok((st.store[meat] ?? 0) + carried > 0 || x.A.count === 0, 'the meat came home');
  assert.ok(sim.u.chronicle.some((e) => /deer/.test(e.text)), 'the first deer kill is told');
});

test('land: game — herds under three spared except in famine, dangerous game only for an armed party of four, the sacred animal never', () => {
  const { sim, st } = village();
  const x = cx(sim);
  clearWild(x);
  const c = landAt(x, st, 400, 900);
  const two = spawnHerd(x, x.c.animals.idx('deer'), c, 2);
  assert.equal(isGame(x, st, two, false, false), false, 'a herd of two is spared');
  assert.equal(isGame(x, st, two, false, true), true, 'but not by the starving');
  const auroch = spawnHerd(x, x.c.animals.idx('aurochs'), c, 8);
  assert.equal(isGame(x, st, auroch, false, false), false, 'aurochs are too dangerous for a small party');
  assert.equal(isGame(x, st, auroch, true, false), true, 'a party of four with spears takes them');
  const deer = spawnHerd(x, x.c.animals.idx('deer'), c, 8);
  assert.equal(isGame(x, st, deer, false, false), true);
  st.culture.sacred.push('animal:deer');
  assert.equal(isGame(x, st, deer, false, false), false, 'never the sacred animal');
  // a carcass: the meat by the beast's weight (a deer of 80 kg gives ~34 kg), hides and bones as animals.json lists
  const meat = carcass(animalDef(x, x.c.animals.idx('deer'))).find((g) => g.item === 'meat')!;
  assert.ok(meat.qty >= 30 && meat.qty <= 40, `deer meat ${meat.qty}`);
  assert.ok(HUNT_RANGE_M === 2000);
});

// ───────────────────────────── herds ─────────────────────────────

test('land: the first herd — a herder is named once husbandry is known and a beast to tame lives within reach; young from the hunt become a kept herd', () => {
  const { sim, st } = village();
  const x = cx(sim);
  clearWild(x);
  assert.equal(herderQuota(x, st), 0, 'nothing to keep, nothing to tame');
  spawnHerd(x, x.c.animals.idx('wild-goat'), landAt(x, st, 500, 1500), 8);
  assert.equal(herderQuota(x, st), 1, 'a wild goat herd within hunting range: one herder, before any herd is owned');
  assignRoles(x, st);
  assert.equal(membersOf(sim, st).filter((s) => x.A.role[s] === ROLE.herder).length, 1, 'and the role is given');
  // young brought home from a hunt: a herd of the domestic form, kept by the settlement
  const from = sim.u.chronicle.length;
  youngFromHunt(x, st, animalDef(x, x.c.animals.idx('boar')), 2);
  const pigs = x.ps.herds.find((h) => h.owner === st.id && animalDef(x, h.species).id === 'pig');
  assert.ok(pigs && pigs.count === 2, 'two young pigs kept');
  assert.equal(ledger(x, st).tames.pig, 1, 'a tame in the books');
  assert.ok(sim.u.chronicle.slice(from).some((e) => /first herd/.test(e.text)), 'the first herd is told');
});

test('land: herding — milk taken by the day from the kept herd; beasts beyond what the pens hold are slaughtered', () => {
  const { sim, st } = village();
  const x = cx(sim);
  const goats = spawnHerd(x, x.c.animals.idx('goat'), st.cell, 30, st.id);
  const s = adultsOf(sim, st)[0];
  const A = x.A;
  A.task[s] = TASK.herd; A.tTarget[s] = goats.id; A.tData2[s] = 0;
  landOf(st).milked[String(goats.id)] = x.tick - x.day;
  const milk = x.c.items.idx('milk');
  const before = st.store[milk] ?? 0;
  herdWork(x, s, st);
  const got = (st.store[milk] ?? 0) - before;
  // a day of 30 goats' milk (1 a head × 1.5 a day, capped at 40 head, by the herder's hand)
  assert.ok(got > 20, `a day's milk ${got}`);
  assert.ok(ledger(x, st).food.herd > 0, 'food from the herd in the books');
  assert.ok(goats.count < 30, 'beasts beyond the pens (8 without one) are slaughtered, two at a time');
  assert.ok((ledger(x, st).slaughter.goat ?? 0) >= 1);
  // pigs give no milk: their increase is eaten — a breeding stock is kept (six head, or 60 % of what the pens hold),
  // about a head a day beyond it
  const pens = x.ps.of(st.id).filter((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'pen').length;
  const keep = Math.max(6, Math.round((8 + pens * 10) * 0.6));
  const pigs = spawnHerd(x, x.c.animals.idx('pig'), st.cell, keep + 2, st.id);
  A.tTarget[s] = pigs.id;
  const meat = x.c.items.idx('meat');
  const meat0 = st.store[meat] ?? 0, herd0 = ledger(x, st).food.herd;
  const t0 = x.tick;
  for (let d = 1; d <= 8; d++) { x.tick = t0 + d * x.day; landOf(st).milked[String(pigs.id)] = x.tick - x.day; herdWork(x, s, st); }
  x.tick = t0;
  assert.equal(pigs.count, keep, `the increase eaten down to the breeding stock: ${pigs.count} (keep ${keep})`);
  assert.equal(ledger(x, st).slaughter.pig, 2);
  assert.ok((st.store[meat] ?? 0) > meat0 && ledger(x, st).food.herd > herd0, 'the meat to the store and the books');
});

// ───────────────────────────── fishing ─────────────────────────────

/** a fresh lake or river cell (not the sea) */
function freshWaterCell(x: PCtx): number {
  for (let c = 0; c < x.p.count; c++) if (x.p.f.water[c] > 0.5 && !x.p.s.ocean[c] && x.p.f.salinity[c] < 0.3) return c;
  return -1;
}

test('land: a water body holds a finite stock — fished hard it falls below 30 % and gives less to each session, and grows back within a year', () => {
  const { sim } = village();
  const x = cx(sim);
  const c = freshWaterCell(x);
  assert.ok(c >= 0, 'a lake or river');
  const s = stockAt(x, c);
  assert.ok(s.K > 0 && s.S === s.K, 'a stock at its capacity when first fished');
  assert.equal(stockFactor(s), 1);
  s.S = s.K * 0.12;
  assert.ok(stockFactor(s) < 0.5, `below ${THIN} of capacity a session gives less (${stockFactor(s)})`);
  // a game year later the stock has grown back past 80 %
  const later = { ...x, tick: x.tick + x.year };
  const s2 = stockAt(later, c);
  assert.ok(s2.S >= 0.8 * s2.K, `grown back to ${(s2.S / s2.K).toFixed(2)} of capacity`);
});

test('land: a fishing session draws on the water\'s stock (or a shoal), takes the fish from it, and is in the books', () => {
  const { sim, st } = village();
  const x = cx(sim);
  const c = freshWaterCell(x);
  const s = adultsOf(sim, st)[0];
  const A = x.A;
  A.task[s] = TASK.fish; A.tTarget[s] = c;
  A.cell[s] = c;
  A.skills[s * NS + SKILL.fish] = 0.5;
  const stock = stockAt(x, c);
  const was = stock.S;
  fishWork(x, s, st, 1, () => true);
  const row = ledger(x, st);
  assert.equal(row.fishing.stock + row.fishing.shoal, 1, 'the session drew on a finite stock or a shoal');
  if (row.fishing.stock) assert.ok(stockAt(x, c).S < was, 'the fish caught are gone from the water');
  assert.ok(row.food.fish > 0, 'the catch in food-days');
});

// ───────────────────────────── crops ─────────────────────────────

test('land: crops keep the season\'s clock — sown in the window, ripe after their growing days, harvested as their own crop; no fields on wet or salt ground', () => {
  const { sim, st } = village();
  const x = cx(sim);
  const wheat = x.c.plants.idx('wheat');
  // the hemispheres' years are half a year apart
  const north = (() => { for (let c = 0; c < x.p.count; c++) if (x.p.grid.pos[c * 3 + 1] > 0.6) return c; return -1; })();
  const south = (() => { for (let c = 0; c < x.p.count; c++) if (x.p.grid.pos[c * 3 + 1] < -0.6) return c; return -1; })();
  const d = Math.abs(yearPhase(x, north) - yearPhase(x, south));
  assert.ok(Math.abs(d - 0.5) < 0.02, `north and south half a year apart (${d})`);
  // the sowing window opens and closes through the year
  let open = 0, shut = 0;
  for (let k = 0; k < 24; k++) { const y = { ...x, tick: x.tick + Math.round((k * x.year) / 24) }; if (sowingTime(y, wheat, north)) open++; else shut++; }
  assert.ok(open >= 3 && shut >= 12, `wheat is sown in a part of the year only (${open} of 24)`);
  // never on water, salt or saturated ground
  const water = (() => { for (let c = 0; c < x.p.count; c++) if (x.p.f.water[c] > 0.5) return c; return -1; })();
  assert.equal(fieldSite(x, wheat, water), 0, 'not under water');
  const cells = (st.flow?.cells ?? []).filter((c) => fieldSite(x, wheat, c) > 0);
  assert.ok(cells.length > 0, 'ground fit for wheat in the territory');
  const good = cells.reduce((b, c) => (fieldSite(x, wheat, c) > fieldSite(x, wheat, b) ? c : b), cells[0]);
  const m0 = x.p.f.moisture[good], s0 = x.p.f.salinity[good];
  x.p.f.moisture[good] = 0.95;
  assert.equal(fieldSite(x, wheat, good), 0, 'not on saturated ground');
  x.p.f.moisture[good] = m0; x.p.f.salinity[good] = 0.5;
  assert.equal(fieldSite(x, wheat, good), 0, 'not on salt ground');
  x.p.f.salinity[good] = s0;
  // a field sown now grows on its clock: ripe after `grow` days at full suitability, longer where it suits less
  const L = landOf(st);
  L.fields = [];
  st.fields = [good];
  st.crop = wheat;
  L.fields.push({ c: good, sp: wheat, sown: x.tick, prog: 0, q: 1, t: x.tick, ripe: -1, shown: 0.06 });
  x.p.f.cropSpecies[good] = wheat; x.p.f.crop[good] = 0.06;
  const grow = x.c.plants.list[wheat].season!.grow;
  let ripeAt = -1;
  for (let h = 1; h <= 24 * 30 && ripeAt < 0; h++) {
    const y = { ...x, tick: x.tick + h * 60 };
    x.p.f.temperature[good] = 15; // (a mild season throughout: frost would hold it)
    cropsHourly(y, st);
    if (L.fields[0].ripe >= 0) ripeAt = h;
  }
  assert.ok(ripeAt >= grow * 24 - 2, `ripe no sooner than its ${grow} days (${(ripeAt / 24).toFixed(1)})`);
  assert.ok(x.p.f.crop[good] > 0.5, 'a ripe field shows its crop');
  // the harvest: wheat comes in as grain, in the books by crop
  const s = adultsOf(sim, st)[0];
  x.A.tTarget[s] = good; x.A.tData2[s] = 2; x.A.tData[s] = -1;
  const y = { ...x, tick: x.tick + ripeAt * 60 };
  const grain = itemIdx(x, 'grain');
  const before = (st.store[grain] ?? 0) + x.A.carried(s, grain);
  farmWork(y, s, st, 1);
  assert.ok((st.store[grain] ?? 0) + x.A.carried(s, grain) > before + 10, 'the grain of a field');
  assert.equal(ledger(y, st).harvests.wheat, 1, 'a harvest of wheat in the books');
  assert.equal(L.fields[0].sp, -1, 'the field lies fallow until the next sowing');
});

// ───────────────────────────── demography ─────────────────────────────

test('land: births are spaced two to three years a mother; many children mean fewer births; old age takes no child; childhood has its own hazards', () => {
  const { sim, st } = village('stone', 20261008, 40);
  const x = cx(sim);
  const A = x.A;
  const mother = membersOf(sim, st).find((s) => A.flags[s] & AgentFlag.female && !(A.flags[s] & AgentFlag.child))!;
  const gap = birthGap(x, mother);
  assert.ok(gap >= 2 && gap <= 3, `her gap ${gap}`);
  A.lastBirth[mother] = x.tick;
  assert.equal(spaced(x, mother), false, 'not again so soon');
  assert.equal(spaced({ ...x, tick: x.tick + Math.ceil(gap * x.year) }, mother), true, 'after her gap');
  const f = mouths(x, st);
  assert.ok(f >= 0.3 && f <= 1, `the mouths factor ${f}`);
  // hunger lowers fertility; a granary of 50 days a head does not raise it above nature's rate
  assert.equal(plentyFactor(50, 1), 1);
  assert.equal(plentyFactor(3, 0.5), 1);
  assert.ok(Math.abs(plentyFactor(1.5, 0.5) - 0.5) < 1e-9, 'half fed, half the chance');
  // by age: nothing before maturity, rising over six years (first births come at 18-20), full to 30, none at 45
  assert.equal(ageFertility(13, 45, 14), 0);
  assert.ok(Math.abs(ageFertility(17, 45, 14) - 0.5) < 1e-9, 'half at maturity + 3');
  assert.equal(ageFertility(25, 45, 14), 1);
  assert.ok(ageFertility(38, 45, 14) < 0.5 && ageFertility(38, 45, 14) > 0, 'waning in the late thirties');
  assert.equal(ageFertility(45, 45, 14), 0);
  // old age, rolled for a lifetime at once: every adult may die of it, no child does
  const kids = membersOf(sim, st).filter((s) => A.flags[s] & AgentFlag.child);
  assert.ok(kids.length > 0, 'children in the village');
  oldAge(x, st, 1e6);
  for (const k of kids) assert.ok(A.alive[k], 'old age takes no child');
  // the hazards of childhood, over a lifetime at once: the children die of a childhood fever, in the books
  childhood(x, st, 1e6, die);
  assert.ok(kids.every((k) => !A.alive[k]), 'childhood is not safe');
  assert.ok((ledger(x, st).deaths['a childhood fever'] ?? 0) >= kids.length, 'and the books know of what');
  assert.ok(ledger(x, st).deathsChild >= kids.length);
});

// ───────────────────────────── children, company, needs ─────────────────────────────

test('land: children play and do chores, and wander little; company is sought within 100 m; status and curiosity are met', () => {
  const { sim, st } = village('stone', 20261008, 40);
  const x0 = cx(sim);
  const A = x0.A;
  const t: Record<string, number> = { play: 0, chore: 0, wander: 0, all: 0 };
  for (let k = 0; k < 1440; k += 10) {
    sim.step(10);
    for (const s of membersOf(sim, st)) {
      if (!(A.flags[s] & AgentFlag.child)) continue;
      const age = (sim.u.tick - A.birth[s]) / cx(sim).year;
      if (age < 2) continue;
      t.all++;
      if (A.task[s] === TASK.play) t.play++;
      if (A.task[s] === TASK.chore) t.chore++;
      if (A.task[s] === TASK.wander) t.wander++;
    }
  }
  assert.ok(t.all > 0, 'children sampled');
  assert.ok(t.play / t.all >= 0.05, `play ${(t.play / t.all).toFixed(3)} of the children's time`);
  assert.ok(t.chore / t.all >= 0.03, `chores ${(t.chore / t.all).toFixed(3)}`);
  assert.ok(t.wander / t.all <= 0.1, `wandering ${(t.wander / t.all).toFixed(3)}`);
  // company within reach only
  const x = cx(sim);
  for (const s of adultsOf(sim, st).slice(0, 5)) {
    const m = companyNear(x, s, st);
    if (m < 0) continue;
    const a = [0, 0, 0], b = [0, 0, 0];
    A.posAt(s, x.tick, a); A.posAt(m, x.tick, b);
    assert.ok(distM(x.p, a, b) <= NEAR_M, 'within 100 m');
  }
  // status from standing: the leader, household heads
  const lead = A.slotOf(st.leader);
  A.needs[lead * NEED_N + STATUS] = 0;
  statusDaily(x, st);
  assert.ok(A.needs[lead * NEED_N + STATUS] >= 0.4, 'the leader is held high');
  const low = adultsOf(sim, st).filter((s) => A.needs[s * NEED_N + STATUS] < 0.02).length / adultsOf(sim, st).length;
  assert.ok(low <= 0.2, `adults with no status after a day: ${low.toFixed(2)}`);
  // curiosity from talk with someone who knows what they do not
  const [a1, a2] = adultsOf(sim, st);
  A.needs[a1 * NEED_N + CURIO] = 0;
  A.know[a2 * A.kw] |= ~A.know[a1 * A.kw] & 1;
  A.know[a1 * A.kw] &= ~1;
  A.know[a2 * A.kw] |= 1;
  talkOutlet(x, a1, [a1, a2]);
  assert.ok(A.needs[a1 * NEED_N + CURIO] > 0.1, 'the talk was news');
});

// ───────────────────────────── gatherings ─────────────────────────────

test('land: a wedding the evening a couple forms, a funeral the evening after a death at home; the books count them', () => {
  const { sim, st } = village('stone', 20261008, 40);
  const x = cx(sim);
  const A = x.A;
  const single = (female: boolean) => adultsOf(sim, st).find((s) => !A.partner[s] && ((A.flags[s] & AgentFlag.female) !== 0) === female && !(A.flags[s] & AgentFlag.elder));
  const w = single(true), m = single(false);
  assert.ok(w !== undefined && m !== undefined, 'two unwed grown-ups');
  formCouple(x, st, w!, m!);
  const wed = landOf(st).gatherings.find((g) => g.kind === 'wedding');
  assert.ok(wed, 'a wedding is planned');
  assert.ok(wed!.from - x.tick <= x.day, 'that evening');
  sim.step(1440);
  assert.ok(sumRow(st, (r) => r.weddings) >= 1, 'the wedding was held');
  const x2 = cx(sim);
  const victim = adultsOf(sim, st).find((s) => s !== w && s !== m)!;
  die(x2, victim, DEATH.injury);
  const fun = landOf(st).gatherings.find((g) => g.kind === 'funeral');
  assert.ok(fun && fun.from - x2.tick >= 180, 'a funeral the evening after');
  sim.step(2 * 1440 + 60);
  assert.ok(sumRow(st, (r) => r.funerals) >= 1, 'the funeral was held');
  assert.ok(sumRow(st, (r) => r.couples) >= 1);
  assert.ok(A.memKind.some((k) => k === MEMK.mourned), 'the mourners remember it');
  // a couple that forms in the early night is wed the next evening (at once, the town was asleep), and at 100x-1000x
  // a decision's stretch ends when the evening of a gathering one is called to comes (nextGathering)
  const x3 = cx(sim);
  let t = x3.tick;
  while (sunElevation(sim.u, x3.p, t, st.pos) >= -0.05 || sunElevation(sim.u, x3.p, t - 30, st.pos) < -0.05) t++;
  const night = { ...x3, tick: t + 30 };
  // (two grown-ups made single again: by now the village has paired its unwed)
  const grown = (female: boolean) => adultsOf(sim, st).find((s) => s !== w && s !== m && ((A.flags[s] & AgentFlag.female) !== 0) === female && !(A.flags[s] & AgentFlag.elder));
  const w2 = grown(true), m2 = grown(false);
  assert.ok(w2 !== undefined && m2 !== undefined, 'two more grown-ups');
  for (const s of [w2!, m2!]) { const o = A.slotOf(A.partner[s]); if (o >= 0) A.partner[o] = 0; A.partner[s] = 0; }
  formCouple(night, st, w2!, m2!);
  const wed2 = landOf(st).gatherings.find((g) => g.kind === 'wedding' && g.about.includes(A.id[w2!]))!;
  assert.ok(wed2.from > night.tick + 12 * 60, `the next evening, not in the night (${wed2.from - night.tick} ticks on)`);
  assert.equal(nextGathering(night, w2!, st), wed2.from - 45 - night.tick, 'the bride decides again when it comes');
  assert.equal(nextGathering({ ...night, tick: wed2.until }, w2!, st), Infinity, 'nothing after it');
});

test('land: two festivals a settlement-year, most of the people come, one gathering told in the chronicle', () => {
  const { sim, st } = village('stone', 20261008, 30);
  must(sim, { k: 'time.scale', tps: 3000 });
  const x = cx(sim);
  sim.step(x.year - sim.u.tick % x.year + 60);
  const row = (st.land?.ledger ?? []).find((r) => r.year === 0);
  assert.ok(row, 'the year 0 books');
  assert.ok(row!.festivals >= 2, `festivals in the year: ${row!.festivals}`);
  assert.ok(row!.festivalAttend / row!.festivals >= 0.5, `came on average ${(row!.festivalAttend / row!.festivals).toFixed(2)} of the people`);
  assert.ok(sim.u.chronicle.filter((e) => /danced|feast|midwinter|longest night|rains/.test(e.text)).length >= 1, 'a festival is told');
});

// ───────────────────────────── houses, wants, drought ─────────────────────────────

test('land: the village keeps its own ground — no field is laid out or sown where its houses spread, and a fallow field there is given up', () => {
  // (n = 64: cells of 56 m, so the cells around the centre are where the houses go — a town whose houses burned could
  // not rebuild them for five years while two of those cells were fields)
  const sim = world(64, 20261008);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  sim.step(30);
  const x = cx(sim), p = x.p, g = p.grid;
  const ring: number[] = [];
  for (let e = g.nbrStart[st.cell]; e < g.nbrStart[st.cell + 1]; e++) ring.push(g.nbr[e]);
  assert.ok(villageGround(x, st, st.cell) && ring.every((c) => villageGround(x, st, c)), 'the centre and the cells around it');
  // a new field: never on the village's ground, even where the crop would grow best
  st.res!.fertile = [...ring, ...(st.flow?.cells ?? []).filter((c) => !ring.includes(c) && c !== st.cell)];
  const c = newFieldCell(x, st);
  assert.ok(c < 0 || !villageGround(x, st, c), `a new field off the village ground (${c})`);
  const ringBest = Math.max(...ring.map((r) => fieldSite(x, st.crop, r)));
  assert.ok(ringBest > 0.3, `(a ring cell the crop would suit: ${ringBest.toFixed(2)})`);
  // fallow fields: the one on the village's ground is given up, one beyond it kept
  const L = landOf(st);
  const far = (st.flow?.cells ?? []).find((q) => !villageGround(x, st, q) && fieldSite(x, st.crop, q) >= 0.05)!;
  assert.ok(far !== undefined, 'a field site beyond the village');
  const fallow = (q: number) => ({ c: q, sp: -1, sown: -1, prog: 0, q: 1, t: x.tick, ripe: -1, shown: 0.02 });
  L.fields = [fallow(ring[0]), fallow(far)];
  st.fields = [ring[0], far];
  pruneFields(x, st);
  assert.deepEqual(st.fields, [far], 'the village ground is free again');
});

test('land: a crowded town still finds room for a house — at its edge, when the building spiral has nothing left', () => {
  // (n = 64: the cells around the centre all fields, the centre cell filled with huts: the spiral's 90 places run out —
  // a town of 76 buildings found room for no house for years — and the next house goes up at the edge, beyond the fields)
  const sim = world(64, 20261008);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  sim.step(30);
  const x = cx(sim), p = x.p, g = p.grid;
  const ring: number[] = [];
  for (let e = g.nbrStart[st.cell]; e < g.nbrStart[st.cell + 1]; e++) ring.push(g.nbr[e]);
  st.fields = [...ring];
  const hut = x.c.buildings.idx('hut');
  let placed = 0, outside = 0, inField = 0;
  for (let i = 0; i < 60; i++) {
    const b = planBuilding(x, st, hut, true);
    if (!b) break;
    placed++;
    if (b.cell !== st.cell && !ring.includes(b.cell)) outside++;
    if (st.fields.includes(b.cell)) inField++;
  }
  assert.equal(placed, 60, `every hut found a place (${placed})`);
  assert.ok(outside > 0, `the later ones beyond the fields (${outside})`);
  assert.equal(inField, 0, 'none in a field');
});

test('land: houses follow the people — a third site is opened for a dwelling when two other works are open and beds are short', () => {
  const { sim, st } = village('stone', 20261008, 30);
  const x = cx(sim);
  // two non-dwelling sites open
  st.sites = st.sites.filter((id) => (x.c.buildings.list[x.ps.building(id)!.type].capacity ?? 0) === 0);
  for (const id of ['store-pit', 'shrine', 'hearth']) {
    if (st.sites.length >= 2) break;
    const t = x.c.buildings.idx(id);
    if (t >= 0) planBuilding(x, st, t);
  }
  st.sites = st.sites.filter((id) => (x.c.buildings.list[x.ps.building(id)!.type].capacity ?? 0) === 0).slice(0, 2);
  assert.equal(st.sites.length, 2, 'two works open');
  // more people than beds
  must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 40, settlement: st.id });
  const x2 = cx(sim);
  planConstruction(x2, st);
  const shelters = st.sites.filter((id) => x2.c.buildings.list[x2.ps.building(id)!.type].capacity > 0);
  assert.equal(shelters.length, 1, 'a dwelling is begun beside them');
});

test('land: materials drive gathering — ore in store is wanted smelted: its fuel is wanted from the land, the crafts on the way go on the job list', () => {
  const { sim, st } = village();
  const x = cx(sim);
  const ore = itemIdx(x, 'copper-ore');
  storeAdd(x, st, ore, 20);
  for (let i = 0; i < st.store.length; i++) if ((x.c.items.list[i].fuel ?? 0) >= 0.8) st.store[i] = 0;
  const can = new Set<number>();
  for (const l of gatherable(x, st).values()) for (const it of l) can.add(it);
  const d = wantChain(x, st, can);
  const smelt = [...d.crafts.keys()].find((k) => x.rt.list[k].inputs.some((io) => io.items.includes(ore)));
  assert.ok(smelt !== undefined, 'the smelting of the ore is wanted');
  assert.ok((d.crafts.get(smelt!) ?? 0) >= 1.5, 'wanted hard');
  // its fuel: charcoal from wood, wood from the land
  const wood = itemIdx(x, 'wood');
  assert.ok((d.items.get(wood) ?? 0) > 0, 'wood is wanted from the land for the fuel');
  // a stock of every raw material a known craft takes: none in store, wanted; a store full of it, hardly
  const raw = [...can].filter((it) => st.library.some((k) => x.rt.list[k].kind === 'craft' && x.rt.list[k].inputs.some((io) => io.items.includes(it))));
  assert.ok(raw.length >= 3, `raw materials of known crafts: ${raw.length}`);
  // a dozen of each in store (no recipe is short of it): each is still wanted for the stock, and less the more is kept
  for (const it of raw) st.store[it] = 12;
  const some = wantChain(x, st, can).items;
  const unwanted = raw.filter((it) => (some.get(it) ?? 0) < 0.3).map((it) => x.c.items.list[it].id);
  assert.deepEqual(unwanted, [], 'every raw material of a known craft is wanted for the stock');
  const r0 = raw[0];
  st.store[r0] = 1000;
  const full = wantChain(x, st, can).items.get(r0) ?? 0;
  assert.ok(full < 0.05, `hardly wanted with a store full of it (${full})`);
  // the gatherers share the wants out: the most wanted most often, every one now and then
  const n = 10, hits = new Array<number>(n).fill(0);
  for (let i = 0; i < 2000; i++) hits[wantPick((i + 0.5) / 2000, n)]++;
  assert.ok(hits[0] > hits[1] && hits[1] > hits[4] && hits[9] > 0, `shares ${hits.join(',')}`);
});

test('land: a drought — a town whose water fails goes to its kin where the water runs, and joins them', () => {
  const { sim, st } = village('bronze', 20261008, 20);
  const x = cx(sim);
  // kin: a daughter town of the same people and polity, by water, 0.6-1.8 km away
  let c = -1;
  for (let k = 0; k < x.p.count && c < 0; k++) {
    const d = distM(x.p, cellPos(x.p, k), st.pos);
    if (d < 500 || d > 2500 || !isLand(x.p, k) || x.p.f.water[k] > 0.05) continue;
    if (drinkable(x.p, k)) { c = k; break; }
    const g = x.p.grid;
    for (let e = g.nbrStart[k]; e < g.nbrStart[k + 1]; e++) if (freshWater(x.p, g.nbr[e])) { c = k; break; }
  }
  assert.ok(c >= 0, 'a place by fresh water for the kin');
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 15, era: 'bronze', settled: true, pos: cellPos(x.p, c) });
  const kin = x.ps.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  kin.polity = st.polity;
  sim.step(120);
  const x2 = cx(sim);
  const before = (x2.ps.members.get(kin.id) ?? []).length;
  const band = abandon(x2, st, 'drought');
  assert.equal(band.recent.kin, kin.id, 'they go to their kin');
  // they arrive
  const A = x2.A;
  for (const s of x2.ps.members.get(band.id) ?? []) { A.place(s, kin.pos[0], kin.pos[1], kin.pos[2], x2.tick); A.cell[s] = kin.cell; }
  settlementStep(x2, band);
  assert.ok(band.fallen >= 0, 'the band is no more');
  assert.ok((x2.ps.members.get(kin.id) ?? []).length > before, 'its people live with their kin');
});

// ───────────────────────────── saves and views ─────────────────────────────

test('land: saves — a world with its fields, parties, gatherings, stocks and books saves and loads to the same hash, and goes on the same', () => {
  const { sim, st } = village();
  const x = cx(sim);
  stockAt(x, freshWaterCell(x));
  youngFromHunt(x, st, animalDef(x, x.c.animals.idx('wild-goat')), 2);
  sim.step(1440);
  assert.ok(st.land && st.land.ledger.length > 0, 'land state to save');
  const loaded = Sim.load(sim.save());
  assert.equal(loaded.hash(), sim.hash());
  sim.step(300);
  loaded.step(300);
  assert.equal(loaded.hash(), sim.hash(), 'and lives on the same');
});

test('land: views — the settlement card\'s livelihood and the agents\' flags2', () => {
  const { sim, st } = village();
  sim.step(1440);
  const snap = sim.snapshot({ drain: false });
  const pl = snap.planets.find((p) => p.settlements?.length)!;
  const view = pl.settlements!.find((v) => v.id === st.id)!;
  assert.ok(view.livelihood, 'livelihood on the card');
  const tot = Object.values(view.livelihood!.food).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(tot - 1) < 0.01, `food shares sum to 1 (${tot})`);
  assert.ok(view.livelihood!.under15 >= 0 && view.livelihood!.under15 <= 1);
  const agents = pl.agents!;
  assert.ok(agents.flags2 && agents.flags2.length === agents.count, 'flags2 for every agent');
  const x = cx(sim);
  const herder = membersOf(sim, st).find((s) => x.A.role[s] === ROLE.herder);
  if (herder !== undefined) {
    const i = Array.from(agents.id).indexOf(x.A.id[herder]);
    assert.ok(agents.flags2[i] & AgentFlag2.herder, 'a herder is flagged');
  }
});

// ───────────────────────────── round 5 (2026-10-21) ─────────────────────────────

test('land: a people without fire feasts without one — sworn off fire, its festival lines never speak of the fire', () => {
  const { sim, st } = village();
  sim.step(120);
  const tellAll = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < 10; i++) {
      sim.step(1);
      const x = cx(sim);
      const L = landOf(st);
      const came = membersOf(sim, st).slice(0, 6).map((s) => x.A.id[s]);
      L.told = -1;
      L.gatherings.push({ kind: i % 2 ? 'midwinter' : 'rains', from: x.tick - 20, until: x.tick - 1, cell: st.cell, pos: [st.pos[0], st.pos[1], st.pos[2]], about: [], came });
      const n = sim.u.chronicle.length;
      gatheringsHourly(x, st);
      const told = sim.u.chronicle.slice(n).map((e) => e.text);
      assert.equal(told.length, 1, 'the feast is told');
      out.push(told[0]);
    }
    return out;
  };
  const x = cx(sim);
  assert.ok(st.library.includes(x.rt.byId.get('fire-keeping')!), 'the town keeps fire');
  assert.ok(!fireless(x, st));
  assert.ok(tellAll().some((t) => /fire/.test(t)), 'a town that keeps fire feasts by it (some of the lines say so)');
  st.culture.taboos.push(x.rt.byId.get('fire-making')!);
  assert.ok(fireless(x, st), 'sworn off fire');
  const lines = tellAll();
  assert.ok(lines.every((t) => !/fire/.test(t)), `no fire at the feasts of a people sworn off it: ${lines.filter((t) => /fire/.test(t)).join(' | ')}`);
});

test('land: the day\'s news feeds curiosity — a talk with someone who lived through something today, not stale or shared news', () => {
  const { sim, st } = village();
  const x = cx(sim);
  const A = x.A;
  const [s, o] = adultsOf(sim, st);
  // the same crafts known (nothing new to learn of), no memories
  for (let w = 0; w < A.kw; w++) A.know[s * A.kw + w] = A.know[o * A.kw + w];
  const forget = (a: number) => { for (let k = 0; k < MEM; k++) A.memKind[a * MEM + k] = 0; };
  forget(s); forget(o);
  const cur = () => A.needs[s * NEED_N + CURIO];
  A.needs[s * NEED_N + CURIO] = 0;
  talkOutlet(x, s, [o]);
  assert.equal(cur(), 0, 'nothing to tell');
  A.remember(o, MEMK.hunted, x.tick - 60, 3);
  talkOutlet(x, s, [o]);
  assert.ok(cur() >= 0.07, `today's hunt is news (curiosity ${cur().toFixed(3)})`);
  A.needs[s * NEED_N + CURIO] = 0;
  forget(o);
  A.remember(o, MEMK.hunted, x.tick - 2 * x.day, 3);
  talkOutlet(x, s, [o]);
  assert.equal(cur(), 0, 'a hunt two days past is old news');
  forget(o);
  A.remember(o, MEMK.hunted, x.tick - 60, 3);
  A.remember(s, MEMK.hunted, x.tick - 60, 3);
  talkOutlet(x, s, [o]);
  assert.equal(cur(), 0, 'news they lived through together is no news');
});

test('land: hunters muster at home and take the trip\'s food — two parties after two herds when there are hunters enough', () => {
  const { sim, st } = village();
  const x0 = cx(sim);
  clearWild(x0);
  for (const it of x0.c.itemsByTag.get('meat') ?? []) st.store[it] = 0;
  const deer = x0.c.animals.idx('deer');
  spawnHerd(x0, deer, landAt(x0, st, 500, 800), 10);
  spawnHerd(x0, deer, landAt(x0, st, 900, 1400), 10);
  // a morning (six hours and more of daylight to walk out in)
  const adult = adultsOf(sim, st)[0];
  for (let i = 0; i < 200 && daylightLeft(cx(sim), adult) < 7 * 60; i++) sim.step(15);
  const x = cx(sim);
  const A = x.A;
  assert.ok(daylightLeft(x, adult) >= 6 * 60, 'a morning');
  const L = landOf(st);
  L.party = null; delete L.more;
  // seven hunters with empty hands: six at home, one out in the territory (past the muster's 250 m)
  for (const s of membersOf(sim, st)) if (A.role[s] === ROLE.hunter) A.role[s] = ROLE.gatherer;
  const hunters = adultsOf(sim, st).filter((s) => !A.mission[s] && A.health[s] >= 0.55).slice(0, 7);
  assert.equal(hunters.length, 7, 'seven grown-ups to hunt');
  for (const s of hunters) {
    A.role[s] = ROLE.hunter; A.camp[s] = -1; A.trip[s] = 0;
    A.place(s, st.pos[0], st.pos[1], st.pos[2], x.tick);
    for (const it of x.info[A.species[s]].foods) A.take(s, it, 1e6);
  }
  const fc = landAt(x, st, 300, 900);
  assert.ok(fc >= 0, 'ground out in the territory');
  const fp = cellPos(x.p, fc);
  A.place(hunters[6], fp[0], fp[1], fp[2], x.tick);
  storeAdd(x, st, itemIdx(x, 'wild-grain'), 300);
  const trips0 = sumRow(st, (r) => r.huntTrips);
  huntHourly(x, st);
  const ps = parties(st);
  assert.equal(ps.length, 2, `two parties out (${ps.map((p) => p.members.length).join(', ')})`);
  assert.notEqual(ps[0].herd, ps[1].herd, 'after two herds');
  assert.deepEqual(ps.map((p) => p.members.length), [3, 3], 'of three each');
  assert.equal(sumRow(st, (r) => r.huntTrips) - trips0, 2, 'two trips in the books');
  const ids = ps.flatMap((p) => p.members);
  assert.ok(!ids.includes(A.id[hunters[6]]), 'the hunter far out is not mustered');
  for (const id of ids) {
    const s = A.slotOf(id);
    const sp = x.info[A.species[s]];
    const fd = sp.foods.reduce((a, it) => a + A.carried(s, it) * sp.edible[it], 0);
    assert.ok(fd >= 1, `each takes food for the trip (${fd.toFixed(2)} food-days)`);
  }
  assert.deepEqual([...partyOut(st)].sort(), [...ids].sort(), 'both parties are out (assignRoles keeps them hunters)');
  assert.ok(partyOf(x, st, A.slotOf(ps[1].members[0])) === ps[1], 'a member of the second party is found in it');
  // out of the day: the parties go after their herds and come home, and the books keep them apart
  sim.step(3 * 1440);
  assert.ok(sumRow(st, (r) => r.huntTrips) >= 2);
  const loaded = Sim.load(sim.save());
  assert.equal(loaded.hash(), sim.hash(), 'two parties save and load');
});

test('land: where there are no seasons a new field is sown when its own ground is wet — not the dry ground the town stands on', () => {
  // (n = 64: cells of 56 m, fertile ground beyond the village's own)
  const sim = world(64, 20261008);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  sim.step(30);
  const x = cx(sim);
  const f = x.p.f, sx = x.p.s;
  const rice = x.c.plants.idx('rice');
  x.p.st.axialTilt = 0; // (a world without seasons: sowing follows the soil's wetness — yearPhase −1)
  assert.equal(yearPhase(x, st.cell), -1);
  const L = landOf(st);
  L.fields = []; st.fields = [];
  st.crop = rice;
  for (const it of seedItems(x)) storeAdd(x, st, it, 20);
  // the town's own cell dry; one free cell of its fertile ground wet and warm (rice country), the rest dry
  st.res!.fertile = (st.flow?.cells ?? []).filter((c) => isLand(x.p, c));
  const free = st.res!.fertile.filter((c) => !villageGround(x, st, c));
  assert.ok(free.length >= 1, 'fertile ground beyond the village');
  for (const c of [st.cell, ...free]) { f.moisture[c] = 0.3; f.water[c] = 0; }
  const wet = free[0];
  f.moisture[wet] = 0.88; f.salinity[wet] = 0; f.temperature[wet] = 26; sx.tempYear[wet] = 26; f.soil[wet] = Math.max(f.soil[wet], 1);
  assert.ok(fieldSite(x, rice, wet) > 0.3, `the wet cell suits rice (${fieldSite(x, rice, wet).toFixed(2)})`);
  assert.equal(sowingTime(x, rice, st.cell), false, 'the town\'s own ground is too dry to sow rice');
  assert.equal(sowingTime(x, rice, wet), true, 'the wet ground is ready');
  const farmer = adultsOf(sim, st)[0];
  const t = farmTask(x, farmer, st);
  assert.ok(t && t.kind === TASK.farm && t.data2 === 0 && t.goalCell === wet, `a field is laid out and sown on the wet ground (${t ? `${t.kind}/${t.data2}@${t.goalCell}` : 'nothing'})`);
});

test('land: the rest of a big kill is fetched — what the hunters could not carry is left by it, and they come back for it while it keeps', () => {
  const { sim, st } = village();
  // a morning (the walk back to the kill wants daylight)
  const adult = adultsOf(sim, st)[0];
  for (let i = 0; i < 200 && daylightLeft(cx(sim), adult) < 7 * 60; i++) sim.step(15);
  const x = cx(sim);
  const A = x.A;
  clearWild(x);
  const horse = x.c.animals.idx('wild-horse');
  const h = spawnHerd(x, horse, landAt(x, st, 250, 500), 12);
  const L = landOf(st);
  L.party = null; delete L.more;
  const two = adultsOf(sim, st).slice(0, 2);
  const q = [0, 0, 0];
  herdPos(h, x.tick, q);
  for (const s of two) {
    A.role[s] = ROLE.hunter;
    for (const it of x.info[A.species[s]].foods) A.take(s, it, 1e6);
    A.place(s, q[0], q[1], q[2], x.tick);
    A.task[s] = TASK.hunt; A.tData2[s] = 0; A.tTarget[s] = h.id;
  }
  L.party = { id: 777, members: two.map((s) => A.id[s]), herd: h.id, species: horse, since: x.tick, lastTry: -1, kills: 0 };
  // stalk after stalk until the horse falls
  for (let t = 1; t < 400 && L.party.kills === 0; t++) huntEncounter({ ...x, tick: x.tick + t * 61 }, two[0], st);
  const p = L.party;
  assert.equal(p.kills, 1, 'a wild horse brought down');
  const meat = itemIdx(x, 'meat');
  const carried = two.reduce((a, s) => a + A.carried(s, meat), 0);
  assert.ok(carried > 40 && carried <= 60.5, `two hunters carry a load each (${carried.toFixed(1)} kg of meat)`);
  assert.ok(p.cache && (p.cache.goods.meat ?? 0) > 60, `the rest is left by the kill (${p.cache?.goods.meat} kg of meat)`);
  // home with the load, hands empty: back for the rest
  const y = { ...x, tick: p.cache!.t + 30 };
  const s = two[0];
  A.place(s, st.pos[0], st.pos[1], st.pos[2], y.tick);
  A.take(s, meat, 1e6);
  for (const it of x.c.items.list.keys()) A.take(s, it, 1e6);
  const t = fetchTask(y, s, p);
  assert.ok(t && t.kind === TASK.hunt && t.data2 === 2 && t.goalCell === p.cache!.c, 'a hunter goes back to the kill');
  // at the kill: a load taken up, in the books as the hunt's food
  const food0 = ledger(y, st).food.hunt;
  const left0 = p.cache!.goods.meat;
  A.place(s, p.cache!.pos[0], p.cache!.pos[1], p.cache!.pos[2], y.tick);
  A.tData2[s] = 2;
  huntEncounter(y, s, st);
  assert.ok(A.carried(s, meat) > 20, `a load of the rest carried (${A.carried(s, meat).toFixed(1)})`);
  assert.ok((p.cache?.goods.meat ?? 0) < left0 - 20, 'taken from what was left');
  assert.ok(ledger(y, st).food.hunt > food0 + 10, 'the fetched meat is the hunt\'s food in the books');
  // what is not fetched in time is the scavengers'
  huntHourly({ ...x, tick: p.cache!.t + 2 * x.day }, st);
  assert.ok(!L.party || !L.party.cache, 'a stale kill is given up');
});

test('land: a town that has lost its roofs raises shelter before it mends its stores', () => {
  const { sim, st } = village('stone', 20261008, 30);
  const x = cx(sim);
  const A = x.A;
  // every dwelling burned; ten store pits, half fallen; a hut begun; wood, reeds and sticks by the hundred in the store
  for (const b of x.ps.of(st.id).slice()) if (x.c.buildings.list[b.type].provides.includes('shelter')) { if (b.progress >= 1) ruin(x, st, b, 'fire'); else { st.sites = st.sites.filter((id) => id !== b.id); removeBuilding(x, b); } }
  const pit = x.c.buildings.idx('store-pit');
  for (let i = 0; i < 10; i++) { const b = planBuilding(x, st, pit, true); if (b) b.damage = 0.8; }
  for (const id of ['wood', 'reeds', 'stick', 'stone', 'fiber']) storeAdd(x, st, itemIdx(x, id), 300);
  const hut = planBuilding(x, st, x.c.buildings.idx('hut'));
  assert.ok(hut, 'a hut begun');
  for (const s of adultsOf(sim, st).slice(0, 5)) A.role[s] = ROLE.builder;
  assert.ok(roofless(x, st), 'beds for fewer than half the people, a dwelling begun');
  // a day of work: the hut goes up (its materials hauled, built), the pits wait
  sim.step(1440);
  const h = x.ps.building(hut!.id);
  assert.ok(h && (h.delivered > 0 || h.progress > 0), `the hut is being built (delivered ${h?.delivered}, progress ${h?.progress.toFixed(2)})`);
});

// (fix r1 #11) a farming village went on hunting: hides wanted, the folk hunt, the pack that took its beasts
test('land: a farming town hunts for hides with meat in store, musters a folk hunt of its able adults, and hunts down the pack that took its beasts (fix r1 #11)', (t) => {
  // (the folk hunt and the pack hunt are off by default since they cut births 30-60 % on the 50-year runs — hunt.ts
  // HUNT_TUNE; the mechanism is exercised here at the round's settings)
  const tune = { ...HUNT_TUNE };
  HUNT_TUNE.folkDays = 3; HUNT_TUNE.raidDays = 2;
  t.after(() => Object.assign(HUNT_TUNE, tune));
  const { sim, st } = village();
  const x0 = cx(sim);
  clearWild(x0);
  const deer = spawnHerd(x0, x0.c.animals.idx('deer'), landAt(x0, st, 500, 800), 10);
  const adult = adultsOf(sim, st)[0];
  for (let i = 0; i < 200 && daylightLeft(cx(sim), adult) < 7 * 60; i++) sim.step(15);
  const x = cx(sim);
  const A = x.A;
  const L = landOf(st);
  const heads = membersOf(sim, st).length;
  const home = (s: number) => { A.camp[s] = -1; A.trip[s] = 0; A.place(s, st.pos[0], st.pos[1], st.pos[2], x.tick); for (const it of x.info[A.species[s]].foods) A.take(s, it, 1e6); };
  const able = adultsOf(sim, st).filter((s) => !A.mission[s] && A.health[s] >= 0.55 && A.id[s] !== st.leader);
  assert.ok(able.length >= 8, 'grown-ups enough');
  // meat in store for days, no hides: two hunters go out for hides
  storeAdd(x, st, itemIdx(x, 'meat'), heads * 4);
  for (const id of ['hide', 'fur']) st.store[itemIdx(x, id)] = 0;
  for (const s of membersOf(sim, st)) if (A.role[s] === ROLE.hunter) A.role[s] = ROLE.gatherer;
  for (const s of able.slice(0, 2)) { A.role[s] = ROLE.hunter; home(s); }
  L.party = null; delete L.more;
  huntHourly(x, st);
  assert.equal(parties(st).length, 1, 'hides wanted: a party though meat is in store');
  // hides enough too: the spears rest (and this town does not farm yet: no folk hunt)
  L.party = null;
  storeAdd(x, st, itemIdx(x, 'hide'), heads);
  for (const s of able.slice(0, 2)) home(s);
  huntHourly(x, st);
  assert.equal(parties(st).length, 0, 'meat and hides in store: no party');
  // a farming town (agriculture known, three fields): the folk hunt — hunters with crafters and builders at home
  const ag = x.rt.byId.get('agriculture')!;
  if (!st.library.includes(ag)) { st.library.push(ag); st.library.sort((a, b) => a - b); }
  while (st.fields.length < 3) st.fields.push(landAt(x, st, 60 + st.fields.length * 30, 400));
  for (const [i, s] of able.slice(2, 6).entries()) { A.role[s] = i % 2 ? ROLE.crafter : ROLE.builder; home(s); }
  for (const s of able.slice(0, 2)) home(s);
  delete st.recent.folkHunt;
  huntHourly(x, st);
  const folk = parties(st);
  assert.equal(folk.length, 1, 'the folk hunt sets out');
  assert.ok(folk[0].members.length >= 4, `with others than the hunters (${folk[0].members.length})`);
  assert.ok(folk[0].members.every((id) => A.role[A.slotOf(id)] === ROLE.hunter), 'who carry spears until they are home');
  assert.equal(folk[0].herd, deer.id, 'after the deer');
  assert.ok(st.recent.folkHunt === x.tick, 'and the town will not muster again for three days');
  // a wolf pack took its goats: hunters and herders (armed, four or more) go after that pack, not the deer
  L.party = null;
  const wolves = spawnHerd(x, x.c.animals.idx('wolf'), landAt(x, st, 600, 900), 5);
  storeAdd(x, st, itemIdx(x, 'bronze-spear'), 6);
  for (const [i, s] of able.slice(0, 6).entries()) { A.role[s] = i < 2 ? ROLE.hunter : ROLE.herder; home(s); }
  st.recent.raidAt = x.tick; st.recent.raidBy = wolves.id;
  huntHourly(x, st);
  const hunt = parties(st);
  assert.equal(hunt.length, 1, 'a party after the pack');
  assert.equal(hunt[0].herd, wolves.id, 'the wolves that took the goats');
  assert.ok(hunt[0].members.length >= 4, 'four or more for dangerous game');
  assert.equal(st.recent.raidAt, undefined, 'the raid is answered');
});

test('land: by default a farming town neither musters a folk hunt nor goes after a raiding pack (fix r1, stint 5)', () => {
  assert.deepEqual(HUNT_TUNE, { folkDays: 0, raidDays: 0 }, 'off until re-tuned (LIVING §11.3)');
});

// (fix r1 #13) under-15 deaths ran at 28 % of births (16-44 %) against 12-25 %: lighter when fed and housed, peaks in want
test('land: childhood fevers are lighter in a fed, housed village and peak in crowding and famine (fix r1 #13)', () => {
  const { sim, st } = village();
  const x = cx(sim);
  const [h0, h1, h2] = CHILD_HAZARD;
  const to15 = 1 - (1 - h0) * (1 - h1) ** 4 * (1 - h2) ** 10;
  assert.ok(to15 > 0.1 && to15 < 0.15, `a fed, housed childhood: ${(to15 * 100).toFixed(1)} % die of fever before 15`);
  for (const age of [0.5, 3, 10]) {
    const fed = childHazard(x, st, age), crowded = childHazard(x, st, age, true);
    assert.ok(Math.abs(crowded / fed - CROWDED_FEVER) < 1e-9, `crowded houses: x${CROWDED_FEVER} at age ${age}`);
  }
  const fedBaby = childHazard(x, st, 0.5);
  for (const it of x.info[st.species].foods) st.store[it] = 0;
  st.recent.famineAt = x.tick;
  assert.ok(Math.abs(childHazard(x, st, 0.5) / fedBaby - 2.5) < 1e-9, 'famine: the fever peaks (x2.5)');
  assert.ok(Math.abs(childHazard(x, st, 0.5, true) / fedBaby - 2.5 * CROWDED_FEVER) < 1e-9, 'famine in crowded houses: worse still');
});
