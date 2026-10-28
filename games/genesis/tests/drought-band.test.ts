// GENESIS — LIVING.md §2.7, water in a drought: a village driven out by a dust bowl walks to water it can REACH.
// In the 50-year world of seed 1 a dust bowl dried a cliff-bound plateau in year 46; the town fell and its band of 47 lost
// 10 to thirst and 4 to hunger within the year: the band carried a little bread and left 342 maize behind, roamed on
// bearings chosen for green land, and every fresh-water cell within 2.5 km was below the cliffs, out of its reach.
// The miniature (the drought fixture): a 30-person stone-age village on the n = 64 sandbox, a dust bowl 1.5 km across held
// over it for 96 hours, six days watched. (n = 32 does not reproduce the drought: the village finds water at hand.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { world, people, must, ctx, membersOf } from './helpers/peoples.ts';
import { INV, TASK } from '../src/sim/people/defs.ts';
import { NEED_N, WATER } from '../src/sim/people/needs.ts';
import { decide, waterHere } from '../src/sim/people/decide.ts';
import { finishTask } from '../src/sim/people/work.ts';
import { abandon } from '../src/sim/people/settlement.ts';
import { itemIdx } from '../src/sim/people/resources.ts';
import { ROAD_W, soakable, waterOnFoot } from '../src/sim/people/waterway.ts';
import { LOAD_KG } from '../src/sim/perf/pace.ts';
import { distM } from '../src/sim/people/world.ts';

interface DustBowl { sim: Sim; town: Settlement; fellH: number; deaths: Record<string, number>; alive: number; road: { keep: number; drink: number } }

/** the drought fixture set down: village, a day at 3000x; `dry` is the god holding the dust bowl (call it every hour) */
function dustBowlStart(seed: number, radius = 1500): { sim: Sim; town: Settlement; dry: (on: Sim) => void } {
  const sim = world(64, seed);
  people(sim, 'plains-folk', 30, { era: 'stone', settled: true });
  must(sim, { k: 'time.scale', tps: 3000 });
  sim.step(1440);
  const town = sim.u.planets[0].people.settlements.find((s) => s.fallen < 0 && !s.band);
  assert.ok(town, `seed ${seed}: a village stands after a day`);
  const disc = sim.u.planets[0].cellsNear(town.pos.slice(), radius).slice();
  const dry = (on: Sim) => {
    const p = on.u.planets[0], f = p.f;
    for (const c of disc) { if (p.s.ocean[c]) continue; f.water[c] = 0; f.moisture[c] = 0; f.aquifer[c] = 0; f.wetness[c] = 0; f.precip[c] = 0; }
  };
  sim.drainEvents();
  return { sim, town, dry };
}

/** the drought fixture: the dust bowl held for `hold` h over the village, `hours` h watched; on the band's first day,
 * how many members with water to spare (>= ROAD_W) keep to the band's road and how many are off on drink trips */
function dustBowl(seed: number, hours = 144, hold = 96, radius = 1500): DustBowl {
  const { sim, town, dry } = dustBowlStart(seed, radius);
  const ps = sim.u.planets[0].people, A = ps.agents;
  const deaths: Record<string, number> = {};
  const road = { keep: 0, drink: 0 };
  let fellH = -1;
  for (let h = 0; h < hours; h++) {
    if (h < hold) dry(sim);
    sim.step(60);
    for (const e of sim.drainEvents()) if (e.t === 'death') { const k = String((e.data as { cause?: string } | undefined)?.cause ?? '?'); deaths[k] = (deaths[k] ?? 0) + 1; }
    if (fellH < 0 && town.fallen >= 0) fellH = h + 1;
    if (fellH >= 0 && h + 1 - fellH < 24) {
      for (const b of ps.settlements) {
        if (!b.band || b.fallen >= 0) continue;
        for (const m of ps.members.get(b.id) ?? []) {
          if (A.needs[m * NEED_N + WATER] < ROAD_W) continue;
          if (A.task[m] === TASK.drink) road.drink++; else road.keep++;
        }
      }
    }
  }
  let alive = 0;
  for (const s of ps.settlements) if (s.fallen < 0) alive += ps.members.get(s.id)?.length ?? 0;
  return { sim, town, fellH, deaths, alive, road };
}

// seeds 11 and 16 under a held 1.5 km dust bowl: 30 and 14 died of thirst before the change (the band roamed and swam
// blind, carried nothing, searched rings that crossed cliffs); after it, at most 2. Over seeds 1-16 the held disc cost
// 208 to thirst before and 87 after (_harness/scratch/living/drought/build/LEDGER.md). Seed 1 is no test seed: a
// cliff-ringed plateau whose band has nothing to walk to (7 before, 6 after).
for (const seed of [11, 16]) {
  test(`a village driven out by a dust bowl walks to water it can reach (seed ${seed})`, () => {
    const r = dustBowl(seed);
    assert.ok(r.fellH >= 0, `seed ${seed}: the dust bowl drives the village out (it fell at h${r.fellH})`);
    assert.ok((r.deaths.thirst ?? 0) <= 2, `seed ${seed}: at most 2 die of thirst (deaths ${JSON.stringify(r.deaths)})`);
    const ps = r.sim.u.planets[0].people;
    assert.ok(ps.settlements.some((s) => s.fallen < 0 && (ps.members.get(s.id)?.length ?? 0) > 0), `seed ${seed}: a band or a new town lives on (${r.alive} alive)`);
    // the road guard: on the band's first day, those with water to spare keep to the band's road (without it, 21-32 of 46
    // were off on drink trips at once and the band never got anywhere)
    assert.ok(r.road.keep + r.road.drink > 0 && r.road.drink * 2 <= r.road.keep + r.road.drink, `seed ${seed}: on the band's first day most keep to its road (${r.road.keep} on it, ${r.road.drink} on drink trips, member-hours)`);
  });
}

// ───────────────────────── the parts, one at a time (n = 24: quick) ─────────────────────────

/** an island: the village's ground within `r1` m dried out, ringed out to `r2` m by a salt strait no walker crosses, with
 * a seep just across it (drinkable: what the rings around a thirsty body used to pick); `apply` again to hold it */
function island(sim: Sim, at: number[], r1 = 300, r2 = 650) {
  const p = sim.u.planets[0], f = p.f;
  const inside = new Set<number>(p.cellsNear(at.slice(), r1));
  const ring = new Set<number>(p.cellsNear(at.slice(), r2));
  const moat = [...ring].filter((c) => !inside.has(c));
  const seep = p.cellsNear(at.slice(), r2 + 300).find((c) => !ring.has(c) && !p.s.ocean[c]);
  assert.ok(seep !== undefined && moat.length > 0, 'room for a moat and a seep');
  const apply = () => {
    for (const c of moat) { f.water[c] = 1; f.salinity[c] = 1; }
    for (const c of inside) { if (p.s.ocean[c]) continue; f.water[c] = 0; f.moisture[c] = 0; f.aquifer[c] = 0; f.wetness[c] = 0; f.precip[c] = 0; f.snow[c] = 0; f.ice[c] = 0; }
    f.moisture[seep!] = 0.9; f.aquifer[seep!] = 1; f.water[seep!] = 0; f.salinity[seep!] = 0;
  };
  apply();
  return { inside, moat: new Set(moat), seep: seep!, apply };
}

/** a stone-age village of 12 on the n = 24 sandbox, a little settled in */
function village(seed = 20261008) {
  const sim = world(24, seed);
  const st = people(sim, 'plains-folk', 12, { era: 'stone', settled: true });
  sim.step(30);
  return { sim, st, p: sim.u.planets[0] };
}

test('the walk to water never crosses a strait: no water across it, no drink there, no band target beyond it', () => {
  const { sim, st, p } = village();
  const A = p.people.agents, x0 = ctx(sim);
  const isle = island(sim, st.pos);
  // waterOnFoot from the island's heart finds nothing (the seep is across the strait)
  const r = waterOnFoot(x0, st.species, st.cell, true);
  assert.notEqual(r.drink, isle.seep, 'the seep across the strait is not water on foot');
  assert.ok(r.drink < 0 || isle.inside.has(r.drink), `no water outside the island (found ${r.drink})`);
  // the village leaves; its band never sets out for a site or a bearing beyond the strait
  const band = abandon(ctx(sim), st, 'drought');
  const onIsle = (t: number[] | null) => !t || isle.inside.has(p.cellAt(t));
  assert.ok(onIsle(band.target), `the band leaving sets no target beyond the strait (${band.target && p.cellAt(band.target)})`);
  // a parched member (the band has nowhere to go) digs a soak or finds nothing — never walks for the seep
  const s = membersOf(sim, band).find((m) => !(A.flags[m] & 1) && A.boat[m] < 0)!;
  const damp = [...isle.inside].find((c) => c !== st.cell && !p.s.ocean[c])!;
  const tryDrink = (soakAt: number) => {
    sim.step(1); // (a new tick: a body's search is remembered for the tick it ran in)
    isle.apply();
    if (soakAt >= 0) { p.f.moisture[soakAt] = 0.4; p.f.aquifer[soakAt] = 0.1; }
    band.target = null;
    const N = A.needs, nb = s * NEED_N;
    for (let k = 0; k < NEED_N; k++) N[nb + k] = Math.max(N[nb + k], 0.9);
    N[nb + WATER] = 0.1;
    A.task[s] = TASK.idle; A.pathLen[s] = 0;
    decide(ctx(sim), s);
    return A.task[s] === TASK.drink ? A.gcell[s] : -1;
  };
  const dry = tryDrink(-1);
  assert.ok(dry < 0 || isle.inside.has(dry), `with no water on the island, no drink across the strait (went for ${dry}, seep ${isle.seep})`);
  const soak = tryDrink(damp);
  assert.equal(A.task[s], TASK.drink, 'with damp ground on the island, a parched body digs a soak');
  assert.equal(A.tData[s], 3, 'a soak');
  assert.ok(isle.inside.has(soak), `the soak is on the island (cell ${soak})`);
  // a day on the island: every target the band takes stays on it
  for (let i = 0; i < 144; i++) {
    isle.apply();
    sim.step(10);
    assert.ok(onIsle(band.target), `h${(i / 6).toFixed(1)}: the band sets out for ${band.target && p.cellAt(band.target)}, beyond the strait`);
  }
});

test('an island town in a dust bowl lashes a raft as it leaves; one with a lasting spring does not', () => {
  for (const spring of [false, true]) {
    const { sim, st, p } = village();
    const x = ctx(sim);
    const isle = island(sim, st.pos);
    if (spring) { const c = [...isle.inside].find((o) => o !== st.cell && !p.s.ocean[o])!; p.f.water[c] = 0.3; p.f.salinity[c] = 0; }
    const wood = itemIdx(x, 'wood'), cord = itemIdx(x, 'cordage'), raft = itemIdx(x, 'raft');
    // (they know raft-making: the band's library is what its members know)
    const rm = x.rt.byId.get('raft-making')!, A = p.people.agents, kw = A.kw;
    for (const m of membersOf(sim, st)) A.know[m * kw + (rm >>> 5)] |= 1 << (rm & 31);
    st.store[wood] = 10; st.store[cord] = 5;
    const band = abandon(x, st, 'drought');
    if (!spring) {
      assert.equal(band.store[raft], 1, 'the band carries a raft');
      assert.equal(st.store[wood], 6, 'four wood went into it');
      assert.equal(st.store[cord], 3, 'and two cordage');
    } else {
      assert.ok(!(band.store[raft] > 0), 'with a lasting spring on the island no raft is lashed');
      assert.equal(st.store[wood], 10, 'and the wood stays');
    }
  }
});

test('the people leaving a town carry its food, the most feeding first, and leave stone and flint behind', () => {
  const { sim, st, p } = village();
  const x = ctx(sim), A = p.people.agents;
  const maize = itemIdx(x, 'maize'), roots = itemIdx(x, 'roots'), bread = itemIdx(x, 'bread'), stone = itemIdx(x, 'stone'), flint = itemIdx(x, 'flint');
  const items = x.c.items.list, sp = x.info[st.species];
  for (const it of sp.foods) delete st.store[it];
  st.store[maize] = 342; st.store[roots] = 44; st.store[bread] = 2;
  const members = membersOf(sim, st);
  const stone0 = st.store[stone] ?? 0, flint0 = st.store[flint] ?? 0;
  let held = 0;
  for (const s of members) {
    for (let k = 0; k < INV; k++) { A.invItem[s * INV + k] = -1; A.invQty[s * INV + k] = 0; }
    A.give(s, stone, 2); A.give(s, flint, 1); held++;
  }
  const stockKg = 342 * items[maize].weight! + 44 * items[roots].weight! + 2 * items[bread].weight!;
  abandon(x, st, 'drought');
  let kg = 0, maizeHands = 0;
  for (const s of members) {
    for (let k = 0; k < INV; k++) {
      const it = A.invItem[s * INV + k];
      if (it < 0) continue;
      assert.ok(it !== stone && it !== flint, 'no stone or flint in the hands of the people leaving');
      if (sp.edible[it] > 0) kg += A.invQty[s * INV + k] * (items[it].weight ?? 1);
      if (it === maize) maizeHands++;
    }
  }
  assert.equal(st.store[stone], stone0 + 2 * held, 'the stone went into the old store');
  assert.equal(st.store[flint], flint0 + held, 'and the flint');
  const perHead = kg / members.length;
  assert.ok(perHead >= Math.min(LOAD_KG, stockKg / members.length) - 0.5, `each carries ${perHead.toFixed(1)} kg of food (stock ${(stockKg / members.length).toFixed(1)} kg a head, load ${LOAD_KG})`);
  assert.equal(maizeHands, members.length, 'everyone carries maize (the most feeding: quantity x edible)');
  assert.ok((st.store[maize] ?? 0) < 342 * 0.05, `the maize is carried away (${st.store[maize]} left)`);
});

test('a soak draws the ground down: about 17 drinks from a damp hollow, then dry until it rains', () => {
  const { sim, st, p } = village();
  const x = ctx(sim), A = p.people.agents, f = p.f;
  const s = membersOf(sim, st).find((m) => !(A.flags[m] & 1))!;
  const c = A.cell[s];
  const g = p.grid;
  for (const o of [c, ...Array.from(g.nbr.subarray(g.nbrStart[c], g.nbrStart[c + 1]))]) { f.water[o] = 0; f.moisture[o] = 0; f.wetness[o] = 0; f.aquifer[o] = 0; f.precip[o] = 0; f.salinity[o] = 0; }
  f.moisture[c] = 0.4; f.aquifer[c] = 0.1;
  A.boat[s] = -1; A.mission[s] = 0; A.trip[s] = 0;
  let draws = 0;
  while (soakable(x, c) && draws < 100) {
    const m0 = f.moisture[c], a0 = f.aquifer[c];
    A.task[s] = TASK.drink; A.tData[s] = 3; A.needs[s * NEED_N + WATER] = 0.1;
    finishTask(x, s);
    assert.ok(A.needs[s * NEED_N + WATER] > 0.4, 'the soak quenches');
    assert.ok(Math.abs(m0 - f.moisture[c] - 0.006) < 1e-6 && Math.abs(Math.max(0, a0 - 0.003) - f.aquifer[c]) < 1e-6, `each drink draws 0.006 moisture and 0.003 aquifer (${m0} -> ${f.moisture[c]}, ${a0} -> ${f.aquifer[c]})`);
    draws++;
  }
  assert.ok(draws >= 12 && draws <= 22, `${draws} drinks before the hollow is dry`);
  const m1 = f.moisture[c], a1 = f.aquifer[c];
  A.task[s] = TASK.drink; A.tData[s] = 3; A.needs[s * NEED_N + WATER] = 0.1;
  finishTask(x, s);
  assert.ok(f.moisture[c] === m1 && f.aquifer[c] === a1, 'a dry hollow gives nothing (and is drawn no further)');
  f.moisture[c] = 0.5; // rain
  assert.ok(soakable(x, c), 'rain fills it again');
});

test('a boat\'s water casks serve only afloat', () => {
  const { sim, st, p } = village();
  const A = p.people.agents, f = p.f, x = ctx(sim);
  const s = membersOf(sim, st).find((m) => !(A.flags[m] & 1))!;
  const c = A.cell[s];
  const g = p.grid;
  const near = [c, ...Array.from(g.nbr.subarray(g.nbrStart[c], g.nbrStart[c + 1]))];
  for (const o of near) { f.water[o] = 0; f.moisture[o] = 0; f.wetness[o] = 0; f.aquifer[o] = 0; f.precip[o] = 0; }
  A.boat[s] = itemIdx(x, 'raft'); A.mission[s] = 0; A.trip[s] = 0;
  assert.equal(waterHere(x, s, c), false, 'a raft carried over dry land is no water at hand');
  A.needs[s * NEED_N + WATER] = 0.2;
  decide(ctx(sim), s);
  assert.ok(A.needs[s * NEED_N + WATER] < 0.75, `on dry land the casks do not water them (${A.needs[s * NEED_N + WATER]})`);
  f.water[c] = 1;
  assert.equal(waterHere(x, s, c), true, 'afloat, the casks are at hand');
  A.needs[s * NEED_N + WATER] = 0.2;
  A.task[s] = TASK.idle;
  decide(ctx(sim), s);
  assert.ok(A.needs[s * NEED_N + WATER] >= 0.75, 'afloat, the casks water them');
});

test('a save in the dust bowl loads and runs on alike (thirsty bodies searching on foot, soaks dug)', () => {
  const { sim, dry } = dustBowlStart(11);
  for (let h = 0; h < 50; h++) { dry(sim); sim.step(60); }
  const copy = Sim.load(sim.save());
  assert.equal(copy.hash(), sim.hash(), 'the round trip');
  for (let h = 0; h < 24; h++) { dry(sim); dry(copy); sim.step(60); copy.step(60); }
  assert.equal(copy.hash(), sim.hash(), 'a day on, the same world');
  const A = sim.u.planets[0].people.agents, B = copy.u.planets[0].people.agents;
  const a = [0, 0, 0], b = [0, 0, 0];
  let n = 0;
  for (let s = 0; s < A.alive.length; s++) {
    if (!A.alive[s]) continue;
    assert.ok(B.alive[s], `slot ${s} lives in both`);
    A.posAt(s, sim.tick, a); B.posAt(s, copy.tick, b);
    assert.deepEqual(b, a, `slot ${s} stands in the same place`);
    n++;
  }
  assert.ok(n > 0);
});

test('the search for water on foot stops at the walk a body will risk, and the answer does not depend on who searched first', () => {
  const { sim, town, dry } = dustBowlStart(11);
  for (let h = 0; h < 30; h++) { dry(sim); sim.step(60); }
  const a = sim, b = Sim.load(sim.save());
  const p = a.u.planets[0], q = b.u.planets[0];
  // cells of the dried village and around it (the parched search from where they stand)
  const cells = p.cellsNear(town.pos.slice(), 1200).filter((c) => !p.s.ocean[c]).slice(0, 40);
  assert.ok(cells.length >= 20);
  const pick = (r: { drink: number; drinkCost: number; soak: number; soakCost: number }, budget: number) =>
    [r.drink >= 0 && r.drinkCost <= budget ? r.drink : -1, r.soak >= 0 && r.soakCost <= budget ? r.soak : -1];
  let found = 0;
  for (const c of cells) {
    // world a: a townsman's short search first, then a parched band member's long one; world b: the other way round
    const xa = ctx(a), xb = ctx(b);
    const aShort = waterOnFoot(xa, town.species, c, true, 600), aLong = waterOnFoot(xa, town.species, c, true, 3000);
    const bLong = waterOnFoot(xb, town.species, c, true, 3000), bShort = waterOnFoot(xb, town.species, c, true, 600);
    assert.ok(aShort.drink < 0 || aShort.drinkCost <= 600, `the short search stops at its budget (cell ${c}: ${aShort.drinkCost})`);
    assert.deepEqual(pick(bShort, 600), pick(aShort, 600), `cell ${c}: the same water within 600 whoever searched first`);
    assert.deepEqual(pick(bLong, 3000), pick(aLong, 3000), `cell ${c}: the same water within 3000 whoever searched first`);
    if (pick(aLong, 3000)[0] >= 0 || pick(aLong, 3000)[1] >= 0) found++;
  }
  assert.ok(found > 0, 'some water or soak is found within two days\' walk');
  assert.equal(b.hash(), a.hash(), 'searching changes nothing in the world');
});

// the verifiers' 'pond-bare' fixture in miniature: the dust bowl held, the ground bare, and once the town falls a pond at the
// band's camp that fills every hour and drains in about twenty minutes. Before the camp-water memory (decide.ts bandWater)
// the parched walked out for water 1.5 km off and the band went with its leader (village sizes 28-32: the camp up to
// 1541 m from the pond, 746-1195 member-hours beyond 450 m, 0-2 thirst deaths); the game before the drought change stayed
// within 458 m (150-294 member-hours) and lost no one (_harness/scratch/living/drought/build/LEDGER.md, round 2)
test('a band in a dust bowl waits at its camp\'s pond that fills and drains, and does not walk off for far water', () => {
  const { sim, town, dry } = dustBowlStart(11);
  const p = sim.u.planets[0], ps = p.people, A = ps.agents, f = p.f, g = p.grid;
  const disc = p.cellsNear(town.pos.slice(), 1500).slice();
  const deaths: Record<string, number> = {};
  let pond: number[] = [], at: number[] | null = null, farH = 0, maxD = 0;
  const q = [0, 0, 0];
  for (let h = 0; h < 96; h++) {
    dry(sim);
    for (const c of disc) if (!p.s.ocean[c]) { f.grass[c] = 0; f.shrub[c] = 0; f.tree[c] = 0; }
    for (const c of pond) { f.water[c] = 0.3; f.salinity[c] = 0; }
    sim.step(60);
    for (const e of sim.drainEvents()) if (e.t === 'death') { const k = String((e.data as { cause?: string } | undefined)?.cause ?? '?'); deaths[k] = (deaths[k] ?? 0) + 1; }
    const b = ps.settlements.find((s) => s.fallen < 0 && s.band);
    if (!at && town.fallen >= 0 && b) {
      pond = [b.cell];
      for (let e = g.nbrStart[b.cell]; e < g.nbrStart[b.cell + 1]; e++) if (!p.s.ocean[g.nbr[e]]) pond.push(g.nbr[e]);
      at = b.pos.slice();
    }
    if (at && b) {
      for (const m of ps.members.get(b.id) ?? []) { A.posAt(m, sim.u.tick, q); if (distM(p, q, at) > 450) farH++; }
      maxD = Math.max(maxD, distM(p, b.pos, at));
    }
  }
  assert.ok(at, 'the dust bowl drives the village out');
  const tell = `deaths ${JSON.stringify(deaths)}, camp at most ${Math.round(maxD)} m from the pond, ${farH} member-hours beyond 450 m`;
  assert.equal(deaths.thirst ?? 0, 0, `no one dies of thirst (${tell})`);
  assert.ok(maxD <= 600, `the band keeps its camp by the pond (${tell})`);
  assert.ok(farH <= 500, `few walk far from it (${tell})`);
});
