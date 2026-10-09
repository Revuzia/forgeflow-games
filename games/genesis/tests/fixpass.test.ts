// GENESIS — phase-2 review fixes (sim): shelters keep their sleepers warm, occupancy follows the building entered, a
// drink needs water, couples form, every settlement rolls for outbreaks, a save right after an abandonment keeps the
// hash, a stalled building site is revised, and the long walk is lived leg by leg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { AgentFlag, BuildingFlag } from '../src/sim/types.ts';
import { TASK, PHASE } from '../src/sim/people/defs.ts';
import { NEED_N, WARMTH, WATER } from '../src/sim/people/needs.ts';
import { startTask, MAX_LEG } from '../src/sim/people/tasks.ts';
import { abandon } from '../src/sim/people/settlement.ts';
import { reviseSite, siteObtainable, planBuilding } from '../src/sim/people/buildings.ts';
import { outbreakDue } from '../src/sim/life/disease.ts';
import { drinkable, freshWater } from '../src/sim/people/world.ts';
import { decide, waterHere } from '../src/sim/people/decide.ts';
import { FOOD } from '../src/sim/people/needs.ts';
import { computeEra } from '../src/sim/people/knowledge.ts';
import { ecoStep, speciate } from '../src/sim/life/ecology.ts';
import { animalIdx, spawnHerd } from '../src/sim/life/herds.ts';
import { world, people, ctx, membersOf, adultsOf } from './helpers/peoples.ts';

/** a settled clay-age village on the small test world (huts already standing) */
function village(n = 24, count = 30) {
  const sim = world(n);
  const st = people(sim, 'plains-folk', count, { era: 'clay', settled: true });
  return { sim, st };
}

test('a night in a hut keeps its sleepers warm where the open air chills them (needs integrated while inside)', () => {
  const { sim, st } = village();
  const x = ctx(sim);
  const p = sim.u.planets[0];
  const A = x.A;
  const hut = x.ps.of(st.id).find((b) => b.progress >= 1 && x.c.buildings.list[b.type].provides.includes('shelter') && x.c.buildings.list[b.type].capacity >= 4);
  assert.ok(hut, 'a finished shelter');
  // the village's fires are out and there is nothing to burn (a hearth in the hut's cell would warm its sleepers by
  // itself: the test is about the roof)
  for (const it of x.c.itemsByTag.get('fuel') ?? []) st.store[it] = 0;
  const heated = (c: number) => x.ps.bByCell.get(c).some((id) => { const b = x.ps.building(id); return !!b && b.fuel > 0; });
  const [, lo] = x.info[st.species].def.temp;
  // a night well below comfort, everywhere (the planet's own climate offset, so the hourly climate keeps it)
  p.st.climateOffset += lo - 14 - p.f.temperature[hut!.cell];
  sim.step(61);
  const members = adultsOf(sim, st);
  assert.ok(members.length >= 8);
  const inside = members.slice(0, 4), outside = members.slice(4, 8);
  const x2 = ctx(sim);
  const put = (s: number, target: number) => {
    A.place(s, hut!.pos[0], hut!.pos[1], hut!.pos[2], x2.tick);
    A.cell[s] = hut!.cell;
    x2.ps.buckets.move(s, hut!.cell);
    A.needs[s * NEED_N + WARMTH] = 1;
    A.needT[s] = x2.tick;
    A.health[s] = 1;
    x2.ps.wheel.cancel(A.id[s]);
    startTask(x2, s, { kind: TASK.sleep, goal: null, goalCell: hut!.cell, work: 480, target });
  };
  // no clothes, and no fire anywhere (a hearth in the hut's cell warmed its sleepers by itself)
  for (const s of [...inside, ...outside]) A.gear[s] = -1;
  for (const b of x2.ps.of(st.id)) { b.fuel = 0; b.flags &= ~BuildingFlag.lit; }
  for (const s of inside) put(s, hut!.id);
  for (const s of outside) put(s, -1);
  // the others sleep under the sky in a cell with no roof and no fire beside the village
  const g = p.grid;
  let open = -1;
  for (let e = g.nbrStart[hut!.cell]; e < g.nbrStart[hut!.cell + 1] && open < 0; e++) {
    const o = g.nbr[e];
    if (!x2.ps.bByCell.get(o).length && !heated(o) && p.f.water[o] < 0.1) open = o;
  }
  assert.ok(open >= 0, 'open ground by the village');
  for (const s of outside) {
    A.place(s, g.pos[open * 3], g.pos[open * 3 + 1], g.pos[open * 3 + 2], x2.tick);
    A.cell[s] = open;
    x2.ps.buckets.move(s, open);
  }
  for (const s of inside) assert.ok(A.inside[s] === hut!.id && A.flags[s] & AgentFlag.sleepingIndoors, 'in the hut');
  assert.equal(hut!.occupants, 4);
  const t0 = sim.u.tick;
  sim.step(482);
  const cold = p.f.temperature[hut!.cell];
  assert.ok(cold < lo - 3, `a cold night (${cold.toFixed(1)} °C, comfort from ${lo} °C)`);
  const warmIn = inside.filter((s) => A.alive[s]).map((s) => A.needs[s * NEED_N + WARMTH]);
  const warmOut = outside.filter((s) => A.alive[s]).map((s) => A.needs[s * NEED_N + WARMTH]);
  const mean = (l: number[]) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
  assert.ok(warmIn.length === 4 && mean(warmIn) > 0.85, `the sleepers in the hut stayed warm (${warmIn.map((v) => v.toFixed(2)).join(' ')})`);
  assert.ok(mean(warmOut) < mean(warmIn) - 0.3, `the sleepers outside did not (${warmOut.map((v) => v.toFixed(2)).join(' ')})`);
  void t0;
});

test('shelter occupancy follows the building entered: no leak through a death or a change of home', () => {
  const { sim, st } = village();
  sim.step(1440 + 60 * 22); // into the second night
  const x = ctx(sim);
  const A = x.A;
  const count = () => {
    const m = new Map<number, number>();
    for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.inside[s] >= 0) m.set(A.inside[s], (m.get(A.inside[s]) ?? 0) + 1);
    return m;
  };
  const check = (when: string) => {
    const m = count();
    for (const b of x.ps.of(st.id)) assert.equal(b.occupants, m.get(b.id) ?? 0, `${when}: building ${b.id} counts ${b.occupants}, ${m.get(b.id) ?? 0} inside`);
  };
  check('at night');
  // nobody crowds a hut beyond its beds while others stand empty
  for (const b of x.ps.of(st.id)) {
    const def = x.c.buildings.list[b.type];
    if (!def.provides.includes('shelter')) continue;
    assert.ok(b.occupants <= def.capacity + 2, `${def.id} holds ${b.occupants} of ${def.capacity}`);
  }
  // a sleeper dies in bed; another's home changes under them
  const sleepers = membersOf(sim, st).filter((s) => A.inside[s] >= 0);
  assert.ok(sleepers.length >= 2, 'people asleep indoors');
  A.home[sleepers[1]] = -1;
  const r = sim.applyNow({ k: 'agent.kill', id: A.id[sleepers[0]] });
  assert.ok(r.ok, r.msg);
  check('after a death in bed');
  sim.step(600);
  check('the next morning');
});

test('a drink needs water: where there is none, thirst stays', () => {
  const sim = world(24);
  const st = people(sim, 'plains-folk', 6, { settled: true });
  const x = ctx(sim);
  const p = sim.u.planets[0];
  const A = x.A;
  // a dry cell far from any water
  let dry = -1;
  for (let c = 0; c < p.count && dry < 0; c++) {
    if (p.f.water[c] > 0 || p.s.ocean[c] || drinkable(p, c)) continue;
    let near = false;
    for (const o of p.cellsNear([p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]], 350)) if (drinkable(p, o) || freshWater(p, o) || p.s.ocean[o]) { near = true; break; }
    if (!near) dry = c;
  }
  assert.ok(dry >= 0, 'a dry place');
  const s = membersOf(sim, st)[0];
  const P = p.grid.pos;
  A.place(s, P[dry * 3], P[dry * 3 + 1], P[dry * 3 + 2], x.tick);
  A.cell[s] = dry;
  x.ps.buckets.move(s, dry);
  A.needs[s * NEED_N + WATER] = 0.3;
  A.needT[s] = x.tick;
  x.ps.wheel.cancel(A.id[s]);
  startTask(x, s, { kind: TASK.drink, goal: null, goalCell: dry, work: 15, data: 1 });
  sim.step(16);
  assert.ok(A.needs[s * NEED_N + WATER] < 0.35, `no water, no drink (${A.needs[s * NEED_N + WATER].toFixed(2)})`);
});

test('couples form among unpartnered grown-ups within days', () => {
  const sim = world(24);
  const st = people(sim, 'plains-folk', 24, { settled: true });
  const x = ctx(sim);
  const A = x.A;
  const adults = adultsOf(sim, st).filter((s) => !(A.flags[s] & AgentFlag.elder));
  for (const s of membersOf(sim, st)) A.partner[s] = 0;
  const women = adults.filter((s) => A.flags[s] & AgentFlag.female).length, men = adults.length - women;
  assert.ok(women >= 2 && men >= 2, `${women} women, ${men} men`);
  sim.step(4 * 1440);
  let couples = 0;
  for (const s of membersOf(sim, st)) if (A.partner[s] && A.flags[s] & AgentFlag.female) couples++;
  assert.ok(couples >= Math.min(women, men) * 0.5, `${couples} couples of ${Math.min(women, men)} possible`);
  // partners share a household
  for (const s of membersOf(sim, st)) {
    if (!A.partner[s]) continue;
    const o = A.slotOf(A.partner[s]);
    if (o >= 0) assert.equal(A.household[s], A.household[o]);
  }
});

test('every settlement rolls for outbreaks twice a day (the old gate opened only for ids that were multiples of 15)', () => {
  for (const day of [1440, 1560, 1800]) {
    for (let id = 1; id <= 60; id++) {
      let n = 0;
      // the settlement step runs when (t + id·7) % 60 == 0
      for (let t = 0; t < day * 4; t++) if ((t + id * 7) % 60 === 0 && outbreakDue({ tick: t, day }, { id })) n++;
      assert.equal(n, 8, `settlement ${id}, ${day / 60} h days: ${n} rolls in 4 days`);
    }
  }
});

test('a save right after an abandonment loads with the same hash', () => {
  const { sim, st } = village();
  sim.step(200);
  const x = ctx(sim);
  abandon(x, st, 'drought');
  const h = sim.hash();
  const loaded = Sim.load(sim.save());
  assert.equal(loaded.hash(), h, 'round trip after abandon');
  sim.step(300);
  loaded.step(300);
  assert.equal(loaded.hash(), sim.hash(), 'and they go on alike');
});

test('a building site whose material can no longer be had is begun again in another, or given up', () => {
  const { sim, st } = village();
  const x = ctx(sim);
  const hutT = x.c.buildings.idx('hut');
  const b = planBuilding(x, st, hutT);
  assert.ok(b, 'a hut site');
  // the material it was begun in vanishes: none in store, none growing in reach, no recipe makes it
  const mat = x.c.materials.list[b!.material];
  for (const io of mat.items) {
    const it = x.c.items.idx(io.item!);
    st.store[it] = 0;
    if (st.res) st.res.items[String(it)] = [];
  }
  const stillMakeable = mat.items.some((io) => (x.rt.producers[x.c.items.idx(io.item!)] ?? []).some((k) => st.library.includes(k)));
  if (!stillMakeable) assert.equal(siteObtainable(x, st, b!), false, `${mat.id} cannot be had`);
  // what they do have: stone and wood aplenty
  for (const id of ['stone', 'wood', 'stick', 'reeds', 'hide', 'clay', 'mudbrick']) { const it = x.c.items.idx(id); if (it >= 0) st.store[it] = 200; }
  const kept = reviseSite(x, st, b!);
  if (kept) {
    assert.ok(siteObtainable(x, st, b!), `revised to ${x.c.materials.list[b!.material].id}, which they can get`);
    assert.ok(st.sites.includes(b!.id));
  } else assert.ok(!st.sites.includes(b!.id), 'given up');
  assert.ok(stillMakeable || kept ? true : !x.ps.building(b!.id), 'no stalled site left behind');
  void BuildingFlag;
});

test('a long walk is lived leg by leg: needs are integrated on the road', () => {
  const sim = world(24);
  const st = people(sim, 'plains-folk', 6, { settled: true });
  const x = ctx(sim);
  const A = x.A;
  const p = sim.u.planets[0];
  const s = membersOf(sim, st)[0];
  // a goal a long way off (an explore errand)
  const P = p.grid.pos;
  let far = -1, best = 0;
  for (let c = 0; c < p.count; c++) {
    if (p.f.water[c] > 0.1 || p.s.ocean[c]) continue;
    const d = Math.acos(Math.min(1, P[c * 3] * st.pos[0] + P[c * 3 + 1] * st.pos[1] + P[c * 3 + 2] * st.pos[2])) * p.st.radius;
    if (d > best && d < 700) { best = d; far = c; }
  }
  assert.ok(far >= 0 && best > 300, `a far goal (${best.toFixed(0)} m)`);
  x.ps.wheel.cancel(A.id[s]);
  startTask(x, s, { kind: TASK.explore, goal: [P[far * 3], P[far * 3 + 1], P[far * 3 + 2]], goalCell: far, work: 30, target: far });
  assert.equal(A.phase[s], PHASE.moving);
  const t0 = A.needT[s];
  // a leg is one cell (a coarse test world's cells are ~150 m: most of a day's walk) — walked in parts of at most
  // MAX_LEG, the walker's needs brought up to date on the way
  sim.step(4 * MAX_LEG + 5);
  assert.ok(A.alive[s] && A.task[s] === TASK.explore && A.phase[s] === PHASE.moving, 'still on the road');
  assert.ok(A.needT[s] >= t0 + 3 * MAX_LEG, `needs were brought up to date on the way (${A.needT[s] - t0} ticks on)`);
});

test('a parched and hungry person standing by fresh water drinks first (thirst kills sooner than hunger)', () => {
  const { sim, st } = village(24, 12);
  const x = ctx(sim);
  const p = sim.u.planets[0];
  const A = x.A;
  const w = st.res?.water.find((c) => drinkable(p, c) || freshWater(p, c));
  assert.ok(w !== undefined, 'the village has a drinking place');
  const s = adultsOf(sim, st)[0];
  const P = p.grid.pos;
  A.place(s, P[w! * 3], P[w! * 3 + 1], P[w! * 3 + 2], x.tick);
  A.cell[s] = w!;
  x.ps.buckets.move(s, w!);
  x.ps.wheel.cancel(A.id[s]);
  assert.ok(waterHere(x, s), 'water at hand');
  A.needs[s * NEED_N + WATER] = 0.05;
  A.needs[s * NEED_N + FOOD] = 0.04;
  A.needT[s] = x.tick;
  decide(x, s);
  assert.equal(A.task[s], TASK.drink, `drinks (task ${A.task[s]})`);
});

test('eras are climbed, not skipped: two later recipes without the era before do not lift a settlement', () => {
  const { sim, st } = village(24, 8);
  const x = ctx(sim);
  const byEra = (e: number) => x.rt.list.filter((r) => r.era === e && r.base > 0 && (!r.species || r.species.includes(st.species))).map((r) => r.idx);
  const lib = [...byEra(0), ...byEra(1)];
  st.library = [...lib, ...byEra(6).slice(0, 3)].sort((a, b) => a - b);
  const e = computeEra(x, st);
  assert.ok(e <= 2, `era ${e}: the gap below era 6 holds it back`);
  // with most of every era up to 5, the three era-6 recipes count
  st.library = [...lib, ...[2, 3, 4, 5].flatMap((k) => byEra(k)), ...byEra(6).slice(0, 3)].sort((a, b) => a - b);
  assert.equal(computeEra(x, st), 6);
});

test('a sea creature speciates under a sea name; the place-fed have a carrying capacity', () => {
  const sim = world(24);
  people(sim, 'plains-folk', 4);
  const x = ctx(sim);
  const p = sim.u.planets[0];
  let sea = -1;
  for (let c = 0; c < p.count && sea < 0; c++) if (p.s.ocean[c] && p.f.water[c] > 20) sea = c;
  assert.ok(sea >= 0, 'open sea');
  const whale = animalIdx(x, 'whale');
  assert.ok(whale >= 0);
  const h = spawnHerd(x, whale, sea, 3);
  const idx = speciate(x, h);
  const name = x.ps.species.find((d) => d.idx === idx)!.def.name;
  assert.ok(!/^(Snow|Frost|Woolly|Pale|Dune|Desert|Sun|Red|Forest|Plains)/.test(name), `a sea name: ${name}`);
  // ten big shoals crowded into one stretch of water go hungry instead of breeding on
  const fish = animalIdx(x, 'fish-shoal');
  let lake = -1;
  for (let c = 0; c < p.count && lake < 0; c++) if (p.f.water[c] > 2 && p.f.salinity[c] < 0.3 && !p.s.ocean[c]) lake = c;
  const at = lake >= 0 ? lake : sea;
  const shoals = Array.from({ length: 10 }, () => spawnHerd(x, fish, at, 120));
  for (const o of shoals) { o.hunger = 0.1; o.t1 = x.tick + 1e6; }
  for (let i = 0; i < 6; i++) ecoStep(x);
  for (const o of shoals) assert.ok(o.hunger > 0.2, `a crowded shoal is hungry (${o.hunger.toFixed(2)})`);
});
