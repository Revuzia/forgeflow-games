// GENESIS — peoples core (CONTRACT.md §8, §9, §11.1): content floors and the tech tree, the agent store, pathfinding,
// a band's first day (drink, eat, sleep), determinism with agents (hash, chunking, save/load, rewind), the god's
// commands over people, the snapshot blocks and the inspector queries, cohorts beyond the cap and the focus command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { loadContent } from '../src/sim/content.ts';
import { BASE_PACK } from '../src/data/index.ts';
import { recipeTable } from '../src/sim/recipes/recipes.ts';
import { AgentStore } from '../src/sim/people/agents.ts';
import { findPath, buildFlowField, flowPath } from '../src/sim/grid/pathfind.ts';
import { TASK, TASK_NAMES, NN } from '../src/sim/people/defs.ts';
import { cohortTotal } from '../src/sim/people/cohorts.ts';
import { isLand, sunElevation } from '../src/sim/people/world.ts';
import { world, people, must, membersOf, adultsOf, chronicleSince } from './helpers/peoples.ts';

test('content: the peoples\' data meets its floors and the tech tree climbs from stone to the generation ship', () => {
  const c = loadContent([BASE_PACK]);
  assert.equal(c.species.list.length, 5, 'five peoples');
  for (const id of ['plains-folk', 'coastal-folk', 'hive', 'cold-folk', 'methane-drifters']) assert.ok(c.species.idx(id) >= 0, id);
  assert.ok(c.items.list.length >= 80, `${c.items.list.length} items`);
  assert.ok(c.recipes.list.length >= 80, `${c.recipes.list.length} recipes`);
  assert.ok(c.buildings.list.length >= 30, `${c.buildings.list.length} buildings`);
  assert.ok(c.animals.list.length >= 16, `${c.animals.list.length} animals`);
  assert.ok(c.diseases.list.length >= 6, `${c.diseases.list.length} diseases`);
  assert.ok(c.materials.list.length >= 10, `${c.materials.list.length} materials`);
  assert.ok(c.events.list.length >= 30, `${c.events.list.length} chronicle templates`);
  // every people can climb from what it is born knowing to the stars, one prerequisite at a time
  const t = recipeTable(c);
  for (const sp of ['plains-folk', 'hive', 'coastal-folk']) {
    const si = c.species.idx(sp);
    const known = new Set<number>(c.species.list[si].start.map((id) => t.byId.get(id)!));
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of t.list) {
        if (known.has(r.idx) || (r.species && !r.species.includes(si))) continue;
        if (r.preList.every((k) => known.has(k))) { known.add(r.idx); changed = true; }
      }
    }
    for (const id of ['fire-making', 'agriculture', 'pottery', 'bronze', 'iron-smelting', 'writing', 'steam-engine', 'electricity', 'orbital-rocket', 'generation-ship']) {
      assert.ok(known.has(t.byId.get(id)!), `${sp} can reach ${id}`);
    }
  }
});

test('agent store: slots are reused through the free list and the store survives a JSON + array round trip', () => {
  const A = new AgentStore(4, 2);
  const a = A.alloc(101), b = A.alloc(102), c = A.alloc(103);
  A.setKnows(b, 37, true);
  A.give(b, 5, 3);
  assert.equal(A.count, 3);
  assert.ok(A.knows(b, 37) && !A.knows(a, 37));
  assert.equal(A.carried(b, 5), 3);
  A.release(a);
  assert.equal(A.count, 2);
  assert.equal(A.slotOf(101), -1);
  const d = A.alloc(104);
  assert.equal(d, a, 'the freed slot is reused');
  assert.ok(!A.knows(d, 37) && A.carried(d, 5) === 0, 'a reused slot starts clean');
  // grow past the capacity
  for (let i = 0; i < 20; i++) A.alloc(200 + i);
  assert.equal(A.count, 23);
  assert.ok(A.cap >= 23);
  assert.ok(A.knows(b, 37), 'growth keeps the knowledge bits');
  // round trip
  const B = AgentStore.fromJson(JSON.parse(JSON.stringify(A.toJson())));
  const src = new Map(A.arrays());
  for (const [name, arr] of B.arrays()) arr.set(src.get(name)!);
  B.reindex();
  assert.equal(B.count, A.count);
  assert.equal(B.slotOf(103), c);
  assert.ok(B.knows(B.slotOf(102), 37));
  assert.equal(B.carried(B.slotOf(102), 5), 3);
});

test('pathfinding: A* walks land cell by cell; the flow field leads every reached cell home', () => {
  const sim = world();
  const p = sim.u.planets[0];
  const g = p.grid;
  const st = people(sim, 'plains-folk', 8, { settled: true });
  const home = st.cell;
  const opts = { swim: 0, fly: false, maxExpand: 6000 };
  const ff = buildFlowField(p, home, 8, opts);
  assert.ok(ff.cells.length >= 8, `${ff.cells.length} cells in the field`);
  assert.ok(ff.cells.includes(home));
  for (let i = 1; i < ff.cells.length; i++) assert.ok(ff.cells[i] > ff.cells[i - 1], 'cells ascend (canonical, searchable)');
  // the farthest reached cells (by travel cost): route to them both ways
  // (a field also holds wet cells one may wade OUT of toward home; a walker cannot walk into them)
  const far = ff.cells.map((c, i) => [c, ff.cost[i]]).filter(([c]) => p.f.water[c] <= 0.6 && c !== home)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(([c]) => c);
  assert.ok(far.length >= 3);
  for (const to of far) {
    const path: number[] = [];
    assert.ok(findPath(p, home, to, opts, path), `A* ${home} -> ${to}`);
    assert.equal(path[path.length - 1], to);
    let prev = home;
    for (const c of path) {
      let adj = c === prev;
      for (let e = g.nbrStart[prev]; e < g.nbrStart[prev + 1]; e++) if (g.nbr[e] === c) adj = true;
      assert.ok(adj, 'every step is to a neighbouring cell');
      assert.ok(isLand(p, c), 'a walker without swimming stays on land');
      prev = c;
    }
    const fp: number[] = [];
    assert.ok(flowPath(ff, to, home, fp), 'the flow field leads home');
    assert.equal(fp[fp.length - 1], home);
  }
  // determinism: the same query gives the same path
  const a: number[] = [], b: number[] = [];
  findPath(p, home, far[0], opts, a);
  findPath(p, home, far[0], opts, b);
  assert.deepEqual(a, b);
});

test('a band\'s first day and night: they drink, eat and sleep; nobody dies; time wheel keeps everyone busy', () => {
  const sim = world();
  const p = sim.u.planets[0];
  const st = people(sim, 'plains-folk', 20);
  const A = p.people.agents;
  const seen = new Set<number>();
  let sleepingAtNight = 0;
  for (let h = 0; h < 30; h++) {
    sim.step(60);
    for (const s of membersOf(sim, st)) {
      seen.add(A.task[s]);
      // every living agent has a future turn
      assert.ok(A.next[s] >= sim.tick, `agent ${A.id[s]} has a turn ahead (${A.next[s]} < ${sim.tick})`);
    }
  }
  for (let h = 0; h < 24; h++) {
    sim.step(60);
    for (const s of membersOf(sim, st)) {
      seen.add(A.task[s]);
      if (A.task[s] === TASK.sleep) sleepingAtNight++;
    }
  }
  const names = [...seen].map((t) => TASK_NAMES[t]);
  for (const t of ['drink', 'eat', 'sleep']) assert.ok(names.includes(t), `someone did ${t}: ${names.join(', ')}`);
  assert.ok(sleepingAtNight > 0, 'they sleep');
  assert.equal(A.count, membersOf(sim, st).length);
  assert.ok(A.count >= 20, `${A.count} alive after a day and a half`);
  // needs stay in range
  for (const s of membersOf(sim, st)) for (let i = 0; i < NN; i++) {
    const v = A.needs[s * NN + i];
    assert.ok(v >= 0 && v <= 1, `need ${i} = ${v}`);
  }
});

test('people sleep when their planet is dark: day sleepers by day are few, nocturnal drifters invert', () => {
  const sim = world();
  const p = sim.u.planets[0];
  const st = people(sim, 'plains-folk', 24);
  const A = p.people.agents;
  let asleepDay = 0, asleepNight = 0, dayN = 0, nightN = 0;
  for (let i = 0; i < 96; i++) {
    sim.step(30);
    const pos = [0, 0, 0];
    for (const s of membersOf(sim, st)) {
      A.posAt(s, sim.tick, pos);
      const night = sunUp(sim, pos) < -0.05;
      const day = sunUp(sim, pos) > 0.15;
      if (night) { nightN++; if (A.task[s] === TASK.sleep) asleepNight++; }
      if (day) { dayN++; if (A.task[s] === TASK.sleep) asleepDay++; }
    }
  }
  assert.ok(nightN > 0 && dayN > 0);
  assert.ok(asleepNight / nightN > 2 * (asleepDay / dayN), `asleep at night ${(asleepNight / nightN).toFixed(2)} vs by day ${(asleepDay / dayN).toFixed(2)}`);
  // the drifters are nocturnal by nature
  assert.equal(sim.content.species.get('methane-drifters').nocturnal, true);
  assert.equal(sim.content.species.get('plains-folk').nocturnal, false);
});

/** sun elevation (sine) at a unit vector on planet 0 now */
function sunUp(sim: Sim, pos: number[]): number {
  return sunElevation(sim.u, sim.u.planets[0], sim.tick, pos);
}

// ───────────────────────────── determinism with agents ─────────────────────────────

const OPTS = { seed: 4242, scenario: 'sandbox', overrides: { n: 24, vegetation: 1 } };
const SCRIPT: [number, Command][] = [
  [5, { k: 'life.spawn-people', species: 'plains-folk', count: 18, lat: 10, lon: 20 } as unknown as Command],
  [6, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true } as unknown as Command],
  [200, { k: 'weather.paint', kind: 'thunderstorm', lat: 10, lon: 20, radius: 600, duration: 300 }],
  [420, { k: 'settlement.gift', settlement: 2, items: { grain: 40, wood: 20 } } as unknown as Command],
  [500, { k: 'idea.teach', knowledge: 'pottery', settlement: 2 } as unknown as Command],
];

function run(ticks: number, chunk: number): Sim {
  const sim = new Sim(OPTS);
  let si = 0;
  while (sim.tick < ticks) {
    while (si < SCRIPT.length && SCRIPT[si][0] === sim.tick) {
      sim.applyNow(SCRIPT[si][1]);
      si++;
    }
    const next = si < SCRIPT.length ? SCRIPT[si][0] : ticks;
    sim.step(Math.min(chunk, next - sim.tick, ticks - sim.tick));
  }
  return sim;
}

test('determinism with people: same seed and commands give the same hash; chunking is invisible', () => {
  const a = run(900, 900);
  const b = run(900, 900);
  assert.ok(a.u.planets[0].people.agents.count >= 40, 'the people are there');
  assert.equal(a.hash(), b.hash());
  const c = run(900, 37);
  assert.equal(c.hash(), a.hash(), 'chunks of 37');
  const d = run(900, 1);
  assert.equal(d.hash(), a.hash(), 'tick by tick');
});

test('determinism with people: save/load mid-life continues identically; rewind replays to the same state', () => {
  const a = run(700, 50);
  const bytes = a.save();
  const b = Sim.load(bytes);
  assert.equal(b.hash(), a.hash(), 'loaded copy hashes the same');
  for (const sim of [a, b]) {
    sim.applyNow({ k: 'idea.teach', knowledge: 'fire-keeping', settlement: 1 } as unknown as Command);
    sim.step(400);
    sim.applyNow({ k: 'agent.kill', id: sim.u.planets[0].people.agents.id[membersOf(sim, sim.u.planets[0].people.settlements[0])[0]] } as unknown as Command);
    sim.step(500);
  }
  assert.equal(b.hash(), a.hash(), 'both continue identically');
  // rewind
  const r = new Sim(OPTS);
  r.keyframeEvery = 300;
  let si = 0;
  let at650 = '';
  while (r.tick < 1000) {
    while (si < SCRIPT.length && SCRIPT[si][0] === r.tick) r.applyNow(SCRIPT[si++][1]);
    r.step(1);
    if (r.tick === 650) at650 = r.hash();
  }
  assert.ok(r.rewind(650));
  assert.equal(r.hash(), at650, 'rewound state equals the lived one');
});

// ───────────────────────────── commands ─────────────────────────────

test('commands over people: spawn, move, rename, age, heal, make a disciple, kill; gifts; teaching may be refused', () => {
  const sim = world();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const st = people(sim, 'plains-folk', 16, { settled: true });
  sim.step(30);
  const s = adultsOf(sim, st)[0];
  const id = A.id[s];
  // rename and age
  must(sim, { k: 'agent.rename', id, name: 'Hesh' } as unknown as Command);
  const bio = sim.query('agent', { id }) as { name: string; age: number };
  assert.equal(bio.name, 'Hesh');
  const age0 = bio.age;
  must(sim, { k: 'agent.age', id, years: 10 } as unknown as Command);
  assert.ok((sim.query('agent', { id }) as { age: number }).age >= age0 + 9);
  // wound then heal
  A.health[s] = 0.3;
  must(sim, { k: 'agent.heal', id } as unknown as Command);
  assert.ok(A.health[s] > 0.95);
  // disciple
  must(sim, { k: 'agent.make-disciple', id } as unknown as Command);
  assert.ok(A.flags[s] & AgentFlag.disciple);
  // move somewhere near
  const P = p.grid.pos;
  const to = [P[st.cell * 3], P[st.cell * 3 + 1], P[st.cell * 3 + 2]];
  must(sim, { k: 'agent.move', id, pos: to } as unknown as Command);
  // gifts land in the store
  const grain = sim.content.items.idx('grain');
  const before = st.store[grain] ?? 0;
  must(sim, { k: 'settlement.gift', settlement: st.id, items: { grain: 25 } } as unknown as Command);
  assert.ok((st.store[grain] ?? 0) >= before + 24.9);
  // the god teaches what they cannot yet grasp: refused, with a reason and a chronicle line
  const c0 = sim.u.chronicle.length;
  const r = sim.applyNow({ k: 'idea.teach', knowledge: 'steam-engine', settlement: st.id } as unknown as Command);
  assert.equal(r.ok, false);
  assert.match(r.msg ?? '', /refused|cannot grasp/);
  assert.ok(chronicleSince(sim, c0).length >= 1, 'the refusal is chronicled');
  // kill: a death event, the agent is gone, the household mourns
  const ev0 = sim.u.events.length;
  must(sim, { k: 'agent.kill', id } as unknown as Command);
  assert.equal(A.slotOf(id), -1);
  assert.ok(sim.u.events.slice(ev0).some((e) => e.t === 'death'), 'a death event');
  assert.ok(!membersOf(sim, st).includes(s));
});

test('snapshot: a mover per living agent on the surface, building and settlement views, population by species', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 30, { era: 'clay', settled: true });
  sim.step(120);
  const snap = sim.snapshot({ full: true });
  const ps = snap.planets[0];
  const A = sim.u.planets[0].people.agents;
  assert.ok(ps.agents);
  assert.equal(ps.agents!.count, A.count);
  for (let i = 0; i < ps.agents!.count; i++) {
    const l = Math.hypot(ps.agents!.pos[i * 3], ps.agents!.pos[i * 3 + 1], ps.agents!.pos[i * 3 + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3, 'positions are unit vectors');
  }
  assert.ok(ps.buildings && ps.buildings.count >= 3, `${ps.buildings?.count} buildings`);
  const view = ps.settlements!.find((v) => v.id === st.id)!;
  assert.ok(view);
  assert.equal(view.name, st.name);
  assert.equal(view.agents, membersOf(sim, st).length);
  assert.ok(['clay', 'fire', 'stone', 'bronze'].includes(view.era), view.era);
  const plains = sim.content.species.idx('plains-folk');
  assert.equal(ps.population![plains], view.population);
  assert.ok(ps.animals && ps.animals.count > 0, 'herds on a living world');
});

test('queries: agent biography, settlement, species, recipes and knowledge for the inspector', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 20, { era: 'bronze', settled: true });
  sim.step(60);
  const A = sim.u.planets[0].people.agents;
  const id = A.id[adultsOf(sim, st)[0]];
  const bio = sim.query('agent', { id }) as Record<string, unknown>;
  assert.ok(bio && typeof bio.name === 'string' && Array.isArray(bio.knowledge) && typeof bio.doing === 'string');
  const set = sim.query('settlement', { id: st.id }) as Record<string, unknown>;
  assert.equal(set.name, st.name);
  assert.ok(Array.isArray(set.library));
  const sp = sim.query('species', { id: 'hive' }) as Record<string, unknown>;
  assert.ok(sp && sp.name);
  const rs = sim.query('recipes') as unknown[];
  assert.ok(rs.length >= 80);
  const k = sim.query('knowledge', { id: 'bronze' }) as { settlements: { id: number }[] };
  assert.ok(k.settlements.some((e) => e.id === st.id), 'bronze is known in the bronze-age settlement');
});

test('cohorts: a people beyond the planet cap lives as cohorts; the focus command makes some of them individuals', () => {
  const sim = world();
  sim.u.settings.maxAgents = 40;
  const st = people(sim, 'plains-folk', 120, { era: 'clay', settled: true });
  const ps = sim.u.planets[0].people;
  assert.ok(ps.agents.count <= 40, `${ps.agents.count} individuals at a cap of 40`);
  assert.ok(cohortTotal(st) >= 75, `${cohortTotal(st)} in the cohort`);
  const view = sim.snapshot({ full: true }).planets[0].settlements!.find((v) => v.id === st.id)!;
  assert.equal(view.population, 120);
  // the cohort lives: an hour of cohort statistics keeps them fed from the store
  sim.step(180);
  assert.ok(cohortTotal(st) >= 70);
  // raise the cap and look at them: some become individuals
  sim.u.settings.maxAgents = 100;
  const n0 = ps.agents.count;
  must(sim, { k: 'focus', pos: st.pos } as unknown as Command);
  assert.ok(ps.agents.count > n0, `${ps.agents.count} individuals after focus (was ${n0})`);
  assert.ok(ps.agents.count <= 100);
  sim.step(120);
});

test('every task kind has a name; agents of all five peoples can be set down on fitting worlds', () => {
  for (const [k, v] of Object.entries(TASK)) assert.equal(TASK_NAMES[v], k.replace(/([A-Z])/g, '-$1').toLowerCase());
  assert.equal(TASK_NAMES[TASK.tendFire], 'tend-fire');
  const sim = new Sim({ seed: 99, scenario: 'system' });
  // the system scenario seeds a people on each kind of world
  const bySpecies = new Map<string, number>();
  for (const p of sim.u.planets) for (const st of p.people.settlements) {
    const id = sim.content.species.list[st.species].id;
    bySpecies.set(id, (bySpecies.get(id) ?? 0) + (p.people.members.get(st.id)?.length ?? 0) + cohortTotal(st));
  }
  for (const id of ['plains-folk', 'coastal-folk', 'hive', 'cold-folk', 'methane-drifters']) assert.ok((bySpecies.get(id) ?? 0) > 0, `${id} placed`);
  sim.step(240);
  let alive = 0;
  for (const p of sim.u.planets) alive += p.people.agents.count;
  assert.ok(alive > 100, `${alive} alive after 4 hours`);
});
