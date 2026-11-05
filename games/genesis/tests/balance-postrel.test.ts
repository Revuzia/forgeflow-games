// GENESIS — post-release balance fixes (release item 4: punch P02 / P11 / P25 / P26). Each test failed on the tree
// before its fix; the 8-seed measurements are in _harness/scratch/postrel/balance.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PCtx } from '../src/sim/people/ctx.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM, cellPos } from '../src/sim/people/world.ts';
import { spawnHerd, reindexHerds, herdArrivals, animalDef, landGame, MAX_LAND_HERDS, GAME_NEAR_M } from '../src/sim/life/herds.ts';
import { isGame, onFoot, wetBetween } from '../src/sim/people/hunt.ts';

/** metres from cell c to the nearest standing settlement */
function peopleM(x: PCtx, c: number): number {
  let d = Infinity;
  for (const st of x.ps.settlements) if (st.fallen < 0) d = Math.min(d, distM(x.p, cellPos(x.p, c), st.pos));
  return d;
}

// (punch P02) game is drawn to a town's edge in a land already holding MAX_LAND_HERDS herds, and only where its hunters can
// walk. Before: gameToPeople returned at once on a full land (every grown world held 138-166 wild land herds against 90),
// and it counted game across a lake as near (seed 2's lakeside town of 74 sent no party in 25 years). twoTowns: Lune has
// land on foot all round; Aru stands on an islet (no dry cell past 300 m on foot) with land across the water.
test('balance: in a full land a far herd of game moves to the edge of a town where its hunters walk, never across the water (postrel P02)', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const w = twoTowns();
  const x = makeCtx(w.sim.u, w.sim.u.planets[0]);
  const aru = x.ps.settlement(w.st.id)!, lune = x.ps.settlement(w.lune.id)!;
  const p = x.p;
  x.ps.herds = x.ps.herds.filter((h) => h.owner >= 0);
  reindexHerds(x);
  x.ps.eco.immigration = true;
  const deer = x.c.animals.idx('deer');
  // game across the water within GAME_NEAR_M of Aru (the only game near it)
  let across = -1;
  for (let c = 0; c < p.count && across < 0; c++) {
    if (p.f.water[c] > 0.05 || p.s.ocean[c]) continue;
    const d = distM(p, cellPos(p, c), aru.pos);
    if (d >= 400 && d <= GAME_NEAR_M - 100 && wetBetween(x, aru.pos, cellPos(p, c)) && !onFoot(x, aru, aru.pos, c)) across = c;
  }
  assert.ok(across >= 0, 'land across the water within a kilometre of Aru');
  const ac = spawnHerd(x, deer, across, 8);
  // the rest of the land full of game far from every people
  for (let c = 0; c < p.count && x.ps.herds.length < MAX_LAND_HERDS + 5; c += 2) {
    if (p.f.water[c] > 0.05 || p.s.ocean[c] || peopleM(x, c) < 5000) continue;
    spawnHerd(x, deer, c, 6);
  }
  const game = () => x.ps.herds.filter((h) => h.owner < 0 && landGame(animalDef(x, h.species)));
  const before = game().length;
  assert.ok(before >= MAX_LAND_HERDS, `the land is full (${before} herds of game)`);
  const walkable = (st: typeof aru) => game().filter((h) => isGame(x, st, h, false, false) && distM(p, cellPos(p, h.cell), st.pos) <= GAME_NEAR_M && onFoot(x, st, st.pos, h.cell));
  assert.equal(walkable(lune).length, 0, 'no game Lune can walk to at the start');
  const nearAru = () => game().filter((h) => h !== ac && distM(p, cellPos(p, h.cell), aru.pos) <= GAME_NEAR_M).length;
  assert.equal(nearAru(), 0);
  herdArrivals(x);
  assert.ok(walkable(lune).length >= 1, 'a herd of game stands within a kilometre of Lune, where its hunters walk');
  assert.ok(game().length <= before, `a full land: a far herd moved, none made (${before} -> ${game().length})`);
  assert.equal(nearAru(), 0, 'nothing is set down across the water from Aru (no cell there is on foot)');
  assert.equal(ac.cell, across, 'the herd across the water stays where it is');
});

// (punch P02, "hunting known at the start of stone-age scenarios") every stone-age people of the scenarios that hunts on
// foot knows hunting when the game begins: "Two worlds" had it (sim-punch P02); the Living system's coastal folk did not.
test('balance: every stone-age people of the scenarios that can hunt knows hunting at the start (postrel P02)', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { ERAS } = await import('../src/sim/content.ts');
  for (const scenario of ['twoworlds', 'system']) {
    const sim = new Sim({ seed: 1, scenario });
    let seen = 0;
    for (const p of sim.u.planets) {
      const x = makeCtx(sim.u, p);
      const k = x.rt.byId.get('hunting')!;
      for (const st of p.people.settlements) {
        const sp = x.c.species.list[st.species].id;
        if (st.fallen >= 0 || !['plains-folk', 'coastal-folk', 'cold-folk'].includes(sp) || ERAS[st.era] !== 'stone') continue;
        seen++;
        assert.ok(st.library.includes(k), `${scenario}: the ${sp} of ${st.name} know hunting`);
      }
    }
    assert.ok(seen >= 1, `${scenario}: a stone-age people`);
  }
});

// (punch P02) a party weighs more than the three best herds before it gives up on game it can walk to. Before: gameOnFoot
// tried 3; seed 1's "Hogan in the Hills" (y25) had game on foot at 334 m and three richer herds across the water ranked
// above it, so no party set out for years with its hunters idle at home.
test('balance: a party finds the game on its own shore past four richer herds across the water (postrel P02)', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { gameOnFoot, huntRange } = await import('../src/sim/people/hunt.ts');
  const w = twoTowns();
  const x = makeCtx(w.sim.u, w.sim.u.planets[0]);
  const lune = x.ps.settlement(w.st.id)!; // Aru, on its islet: game across the water all round
  const p = x.p;
  x.ps.herds = x.ps.herds.filter((h) => h.owner >= 0);
  reindexHerds(x);
  const deer = x.c.animals.idx('deer');
  const range = huntRange(lune);
  const across: number[] = [];
  let shore = -1;
  for (let c = 0; c < p.count; c++) {
    if (p.f.water[c] > 0.05 || p.s.ocean[c]) continue;
    const d = distM(p, cellPos(p, c), lune.pos);
    if (d > range - 200) continue;
    const foot = onFoot(x, lune, lune.pos, c);
    if (!foot && d > 400 && across.length < 5 && across.every((q) => distM(p, cellPos(p, q), cellPos(p, c)) > 150)) across.push(c);
    if (foot && d > 80 && shore < 0) shore = c;
  }
  assert.ok(across.length >= 4, `land in range of Lune across the water (${across.length})`);
  assert.ok(shore >= 0, 'land on foot on Aru\'s islet');
  // rich herds across the water (count 30) rank above a small one on Aru's islet
  for (const c of across) spawnHerd(x, deer, c, 30);
  const own = spawnHerd(x, deer, shore, 3);
  const g = gameOnFoot(x, lune, lune.pos, 20, false);
  assert.ok(g, 'a herd to walk to');
  assert.equal(g!.id, own.id, 'the herd on its own side of the water');
});

// (punch P11) a town with roofs for under 0.6 of its people begins the quick shelters first. Before: the planner began
// houses (700 work each) first everywhere; seed 5's daughter village of 19, founded two days before the year end, slept
// in the open past it (round-4 'housed at every year end' missed on every seed, mostly in such young towns).
test('balance: a town far short of roofs begins huts before houses (postrel P11)', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { planConstruction } = await import('../src/sim/people/settlement.ts');
  const { ruin } = await import('../src/sim/people/buildings.ts');
  const w = twoTowns();
  const p = w.sim.u.planets[0];
  const x = makeCtx(w.sim.u, p);
  const st = x.ps.settlement(w.lune.id)!;
  const C = w.sim.u.content.buildings;
  for (const id of st.sites.slice()) { const b = p.people.building(id); if (b) ruin(x, st, b, 'test'); }
  st.sites.length = 0;
  for (const b of p.people.of(st.id)) if (C.list[b.type].provides.includes('shelter')) ruin(x, st, b, 'test');
  for (const hh of st.households) hh.home = -1;
  const pop = p.people.members.get(st.id)?.length ?? 0;
  assert.ok(pop >= 8, `people (${pop})`);
  const k = x.rt.byId.get('house-building') ?? x.rt.byId.get('mudbrick');
  if (k !== undefined && !st.library.includes(k)) st.library.push(k);
  planConstruction(x, st);
  const homes = st.sites.map((id) => C.list[p.people.building(id)!.type].id).filter((id) => C.list[C.idx(id)].provides.includes('shelter'));
  assert.ok(homes.length >= 1, `a shelter begun (sites ${st.sites.map((id) => C.list[p.people.building(id)!.type].id).join(', ') || 'none'})`);
  for (const id of homes) assert.ok(['hut', 'lean-to', 'igloo'].includes(id), `the quick shelters first: ${homes.join(', ')}`);
});

// (punch P25) year-50 prophet credibility after three fulfilled prophecies: 0.56-0.65 on 3 of 8 seeds (round 4). Two
// losses between the god's own words: (a) every third lapsed prayer of the town ("the god is deaf") took 0.1 from a
// prophet whose word had come true the day before; (b) the prophet read an open prayer on their own while the god's word
// through them was still open, the prayer lapsed and the failure took 0.25.
async function prophetTown() {
  const { town, must } = await import('./helpers/god.ts');
  const { relOf } = await import('../src/sim/god/regard.ts');
  const { sim, st } = town();
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const s = (ps.members.get(st.id) ?? []).find((q) => !(A.flags[q] & 1) && A.id[q] !== st.leader && (sim.u.tick - A.birth[q]) / sim.u.planets[0].st.orbit.period >= 18)!;
  const who = A.id[s];
  must(sim, { k: 'prophet.call', agent: who });
  const R = relOf(sim.u);
  const ph = R.prophets.find((q) => q.agent === who)!;
  return { sim, st, who, R, ph, must };
}

test('balance: a prophet whose word came true yesterday keeps their credibility when the town finds the god deaf (postrel P25)', async () => {
  const { srel } = await import('../src/sim/god/regard.ts');
  const { sim, st, who, ph, must } = await prophetTown();
  must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 2 });
  must(sim, { k: 'miracle.water', pos: st.pos });
  assert.equal(ph.fulfilled, 1, 'the word came true');
  const c0 = ph.credibility;
  // the town's third unanswered prayer lapses within the day
  const r = srel(sim.u, 0, st.id);
  r.lapses = 2;
  r.prayers.push({ id: 9001, kind: 'food', since: sim.u.tick, until: sim.u.tick + 30, urgency: 0.5, god: 0 });
  sim.step(120);
  assert.equal(r.lapses, 3, 'the third lapse');
  assert.equal(ph.credibility, c0, `credibility held (${c0} -> ${ph.credibility})`);
  // three days on, with no word of the god's open, the next deaf lapse costs them 0.1 — once as many of their words
  // failed as came true (postrel SIMFIX r2: a record ahead keeps them clear of the god's silence)
  sim.step(Math.round(3 * sim.u.planets[0].st.dayHours * 60));
  ph.failed = ph.fulfilled;
  const c1 = ph.credibility;
  r.lapses = 5;
  r.prayers.push({ id: 9002, kind: 'food', since: sim.u.tick, until: sim.u.tick + 30, urgency: 0.5, god: 0 });
  sim.step(120);
  assert.ok(ph.credibility < c1 - 0.05, `later a deaf god costs the prophet (${c1} -> ${ph.credibility})`);
});

test('balance: a prophet waiting on the god\'s word does not read open prayers on their own (postrel P25)', async () => {
  const { srel } = await import('../src/sim/god/regard.ts');
  const { sim, st, who, R, ph, must } = await prophetTown();
  ph.credibility = 1;
  must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 3 });
  const r = srel(sim.u, 0, st.id);
  for (let i = 0; i < 8; i++) r.prayers.push({ id: 9100 + i, kind: i % 2 ? 'healing' : 'warmth', since: sim.u.tick, until: sim.u.tick + 2000, urgency: 0.5, god: 0 });
  sim.step(180);
  const own = R.prophecies.filter((q) => q.agent === who && q.by === 'prophet');
  assert.equal(own.length, 0, `no reading of their own while the god's word is open (${own.map((q) => q.kind).join(', ')})`);
});

// (punch P26, LIVING §2.8) old age as hunter-gatherers age (Gurven & Kaplan 2007: a 15-year-old's modal age at death is
// 68-78; ~1 %/yr at 40, doubling every ~7-9 years). Before: the hazard jumped to 2 % at 70 % of the lifespan (43 of 62)
// and doubled every ~5 years — 6 % of 15-year-olds reached 65 on old age alone, a village had 4 % of its people past 50
// (8 seeds x 25 years) and the under-15 share stood at 0.48 against 0.35-0.45.
test('balance: old age lets a third or more of the young reach 65 and few pass 80 (postrel P26)', async () => {
  const { ageHazard } = await import('../src/sim/people/lifecycle.ts');
  const year = 1000;
  const fake = (age: number) => ({ A: { species: [0], caste: [0], birth: [0] }, info: [{ def: { lifespan: 62, hive: undefined } }], tick: Math.round(age * year), year }) as unknown as PCtx;
  const reach = (to: number) => { let s = 1; for (let a = 15; a < to; a += 0.1) s *= 1 - ageHazard(fake(a), 0) * 0.1; return s; };
  const r45 = reach(45), r65 = reach(65), r80 = reach(80);
  assert.ok(r45 >= 0.88, `15 -> 45 on old age alone: ${r45.toFixed(3)}`);
  assert.ok(r65 >= 0.3 && r65 <= 0.6, `15 -> 65 on old age alone: ${r65.toFixed(3)}`);
  assert.ok(r80 <= 0.1, `15 -> 80 on old age alone: ${r80.toFixed(3)}`);
  assert.ok(ageHazard(fake(30), 0) <= 0.003, `a 30-year-old: ${ageHazard(fake(30), 0)}`);
  assert.ok(ageHazard(fake(190), 0) === 1, 'three lifespans: certain');
});
