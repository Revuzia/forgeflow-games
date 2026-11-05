// GENESIS — the sim items left after the post-release punch (ledger _harness/scratch/postrel/simfix.md): each test
// fails on the tree before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// SIMFIX 0 (P22 follow-up): a town's fisher is not lent the boat while it storms on the water, and a fisher out in the
// town's boat when a storm comes up breaks off and rows in for shelter like everyone else (a band's and a mission's
// crews keep to their boats). Before: fishTask lent the boat in any weather and stormBreaks skipped anyone holding a
// boat, so boat fishers fished on through storms and capsized (8-seed postrel alone.ts: 0 drownings -> 3 -> 7).
test('SIMFIX0 no boat is lent into a storm, and a town fisher afloat breaks for shelter', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { storeAdd } = await import('../src/sim/people/store.ts');
  const { TASK } = await import('../src/sim/people/defs.ts');
  const { fishTask } = await import('../src/sim/people/fishing.ts');
  const { stormBreaks } = await import('../src/sim/people/shelter.ts');
  const w = twoTowns();
  const sim = w.sim, p = sim.u.planets[0], ps = p.people!;
  const lune = ps.settlement(w.lune.id)!;
  const x = makeCtx(sim.u, p), A = x.A;
  assert.ok(lune.res && lune.res.fish.some((c) => p.f.water[c] > 0.6), 'Lune has open water to fish');
  const boat = x.c.items.idx('boat');
  storeAdd(x, lune, boat, 2);
  const members = (ps.members.get(lune.id) ?? []).filter((s) => A.alive[s] && !A.mission[s]);
  const nearest = () => -1;
  // fair weather: some fishers are lent the boat (the P22 behaviour stays)
  let lentFair = 0;
  for (const s of members) { A.boat[s] = -1; if (fishTask(x, s, lune, nearest)) { if (A.boat[s] >= 0) lentFair++; A.boat[s] = -1; } }
  assert.ok(lentFair > 0, `in fair weather the boat is lent (${lentFair} of ${members.length})`);
  // a storm over the planet: nobody is lent the boat
  p.st.globalWeather = 'storm';
  for (const c of lune.res!.fish) p.f.precip[c] = Math.max(p.f.precip[c], 20);
  let lentStorm = 0;
  for (const s of members) { A.boat[s] = -1; if (fishTask(x, s, lune, nearest)) { if (A.boat[s] >= 0) lentStorm++; A.boat[s] = -1; } }
  assert.equal(lentStorm, 0, 'no boat is lent into a storm');
  // a fisher already out in the boat breaks off for shelter
  const s = members[0];
  A.task[s] = TASK.fish; A.boat[s] = boat; A.inside[s] = -1;
  const hit: number[] = [];
  stormBreaks(x, lune, (_x, q) => { hit.push(q); });
  assert.ok(hit.includes(s), 'the town fisher in the lent boat breaks for shelter');
  p.st.globalWeather = null;
});

// SIMFIX 2: a stone-age band the god sets down (the opening's 'people' power, life.spawn-people) knows hunting and
// fishing from day 1 — hunter-gatherers do; before, only the two scenario rows carried knowledge ['hunting'] and a
// fresh sandbox band showed no hunting for years with game beside camp.
test('SIMFIX2 a stone-age band set down by the god knows hunting and fishing', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { spawnPeople } = await import('../src/sim/people/spawn.ts');
  const { isLand } = await import('../src/sim/people/world.ts');
  for (const species of ['plains-folk', 'coastal-folk', 'cold-folk']) {
    const sim = new Sim({ seed: 7, scenario: 'sandbox' });
    const p = sim.u.planets[0];
    let cell = -1;
    for (let c = 0; c < p.grid.n && cell < 0; c++) if (isLand(p, c) && p.f.water[c] < 0.1 && p.f.temperature[c] > 8 && p.f.temperature[c] < 24) cell = c;
    const st = spawnPeople(sim.u, p, { species, count: 20, cell, era: 'stone', band: true })!;
    assert.ok(st, `${species} set down`);
    const x = makeCtx(sim.u, p);
    for (const id of ['hunting', 'spear-making', 'fishing']) {
      const k = x.rt.byId.get(id)!;
      assert.ok(st.library.includes(k), `${species} knows ${id} from the start`);
    }
  }
});

// SIMFIX 3: a person keeps their name when they move to another settlement. agentName read the CURRENT settlement's
// tongue (langSeed), so a prophet driven out of one town was chronicled in the next under a new name (y50 seed 5:
// 'drove the prophet Beir out of Mashnam', then 'Than of Mashnam foretold rain'); a daughter village's people too.
test('SIMFIX3 a prophet driven out, and the people of a daughter village, keep their names', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { exile } = await import('../src/sim/god/prophets.ts');
  const { agentName, vars } = await import('../src/sim/people/util.ts');
  const w = twoTowns();
  const sim = w.sim, p = sim.u.planets[0], ps = p.people!;
  const lune = ps.settlement(w.lune.id)!, aru = ps.settlement(w.st.id)!;
  const x = makeCtx(sim.u, p), A = x.A;
  if (lune.langSeed === aru.langSeed) aru.langSeed = (aru.langSeed + 7919) >>> 0;
  const movers = (ps.members.get(lune.id) ?? []).filter((s) => A.alive[s]).slice(0, 6);
  assert.ok(movers.length >= 3, 'Lune has people');
  const before = movers.map((s) => agentName(x, s));
  for (const s of movers) exile(x, s, lune, aru);
  assert.ok(movers.every((s) => A.settlement[s] === aru.id), 'they live in Aru now');
  const after = movers.map((s) => agentName(x, s));
  assert.deepEqual(after, before, 'the same names in the new town');
  assert.equal(vars(x, aru, movers[0]).agent, before[0], 'and in the chronicle');
});

// SIMFIX 1: a town's crafters make goods, not only food. planJobs put cooking, milling and baking first and planCraft
// took the first doable job, so a town with a grain store never made pots, baskets, cordage, spears — or a raft for
// its fishers (y50 seed 1: 0 rafts in 3 lake/sea towns that know raft-making; boat fishing came only from an 8 %
// practice roll). Now: food processing only while its output is short, a fishing town short of boats queues a raft,
// and each crafter starts the queue at its own place.
test('SIMFIX1 a fishing town with a full larder queues a raft and its crafters make more than food', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { storeAdd } = await import('../src/sim/people/store.ts');
  const { planJobs } = await import('../src/sim/people/settlement.ts');
  const { planCraft } = await import('../src/sim/people/decide.ts');
  const w = twoTowns();
  const sim = w.sim, p = sim.u.planets[0], ps = p.people!;
  const lune = ps.settlement(w.lune.id)!;
  const x = makeCtx(sim.u, p), A = x.A;
  const I = (id: string) => x.c.items.idx(id);
  for (const it of x.c.itemsByTag.get('boat') ?? []) lune.store[it] = 0;
  const members = (ps.members.get(lune.id) ?? []).filter((s) => A.alive[s] && !A.mission[s]);
  const n = members.length;
  storeAdd(x, lune, I('cooked-meat'), n * 6); storeAdd(x, lune, I('meat'), n * 4);
  storeAdd(x, lune, I('grain'), n * 6); storeAdd(x, lune, I('flour'), n * 4);
  storeAdd(x, lune, I('wood'), 60); storeAdd(x, lune, I('cordage'), 12); storeAdd(x, lune, I('clay'), 30); storeAdd(x, lune, I('stick'), 20);
  const ks = ['cooking', 'fire-keeping', 'milling', 'baking', 'cordage', 'woodcutting', 'raft-making', 'pottery', 'basketry', 'spear-making'];
  for (const id of ks) { const k = x.rt.byId.get(id); if (k !== undefined && !lune.library.includes(k)) lune.library.push(k); }
  planJobs(x, lune);
  const names = lune.jobs.map((j) => x.rt.list[j.k].id);
  assert.ok(names.includes('raft-making'), `a fishing town without a boat queues a raft: ${names.join(', ')}`);
  // the crafters (knowing all of it) pick across the queue, not only the food jobs at its head
  const FOOD = new Set(['cooking', 'milling', 'baking', 'fish-roasting', 'root-roasting', 'salting', 'smoking']);
  const crafter = members.slice(0, 8);
  for (const s of crafter) for (const id of ks) { const k = x.rt.byId.get(id); if (k !== undefined) A.setKnows(s, k, true); }
  let goods = 0, food = 0;
  for (let h = 0; h < 24; h++) {
    x.tick += 60;
    for (const s of crafter) { const t = planCraft(x, s, lune); if (!t) continue; if (FOOD.has(x.rt.list[t.data as number].id)) food++; else goods++; }
  }
  assert.ok(goods >= (goods + food) * 0.4, `crafters make goods too: ${goods} goods, ${food} food`);
});
