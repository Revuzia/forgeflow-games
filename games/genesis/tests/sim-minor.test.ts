// GENESIS — the sim minors left after the 1.0 CDN preview (release.md "Remaining minor items" 5; ledger
// _harness/scratch/postrel/simminor.md): each test fails on the tree before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MAMMAL = /^(quadruped-|small-hopper$|primate$|camel$)/;

// P16: the sacred-animal sign sends the town a herd it can see and name: the largest grazing land mammal of its country
// (a mallard flock by the houses loses to the deer out on the hill), and the god's word names them in the plural.
test('P16 the sacred-animal sign prefers the largest land mammal near the town and names it in the plural', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { spawnHerd } = await import('../src/sim/life/herds.ts');
  const { distM } = await import('../src/sim/people/world.ts');
  const sim = new Sim({ seed: 1, scenario: 'lookdev', overrides: { n: 12 } });
  const p = sim.u.planets.find((q) => q.people && q.people.settlements.some((s) => s.fallen < 0))!;
  const ps = p.people!;
  const st = ps.settlements.find((s) => s.fallen < 0)!;
  st.culture.sacred = st.culture.sacred.filter((q) => !q.startsWith('animal:'));
  const x = makeCtx(sim.u, p);
  const A = sim.u.content.animals;
  // a flock of mallards right by the town: the nearest wild herd of all
  spawnHerd(x, A.idx('mallard'), p.cellAt(st.pos), 8);
  const near = (h: { owner: number; from: ArrayLike<number> }) => h.owner < 0 && distM(p, h.from, st.pos) < 3000;
  let biggest = 0;
  for (const h of ps.herds) if (near(h) && A.list[h.species].habitat === 'land' && A.list[h.species].kind === 'herbivore' && MAMMAL.test(A.list[h.species].body)) biggest = Math.max(biggest, A.list[h.species].size);
  if (biggest === 0) {
    // make sure a land mammal lives within reach (a deer herd by the town)
    spawnHerd(x, A.idx('deer'), p.cellAt(st.pos), 6);
    biggest = A.find('deer')!.size;
  }
  const r = sim.applyNow({ k: 'god.omen', planet: p.id, settlement: st.id, kind: 'sacred-animal' } as never) as { ok: boolean; msg?: string };
  assert.equal(r.ok, true, JSON.stringify(r));
  const tag = st.culture.sacred.find((q) => q.startsWith('animal:'))!.slice(7);
  const def = A.find(tag)!;
  assert.ok(MAMMAL.test(def.body) && def.habitat === 'land', `revered ${tag} (${def.body})`);
  assert.equal(def.size, biggest, `revered ${tag} is the largest land mammal near ${st.name}`);
  const { plural } = await import('../src/sim/life/ecology.ts');
  assert.ok(r.msg?.includes(`sacred ${plural(def.name)} come`), r.msg);
});

test('P16 animal plurals read right', async () => {
  const { plural } = await import('../src/sim/life/ecology.ts');
  assert.equal(plural('Musk ox'), 'musk oxen');
  assert.equal(plural('Moose'), 'moose');
  assert.equal(plural('Wolf'), 'wolves');
  assert.equal(plural('Wild boar'), 'wild boars');
  assert.equal(plural('Fox'), 'foxes');
  assert.equal(plural('Mallard'), 'mallards');
  assert.equal(plural('Honey bees'), 'honey bees');
  assert.equal(plural('Shellfish bed'), 'shellfish beds');
  assert.equal(plural('Macaque'), 'macaques');
});

// P27: a band's camp water is water someone of the band drank at (work.ts records it), kept fresh while the leader sees
// it running again (a pond that fills and drains, LIVING §2.7). Water the leader merely sees is not camp water: it may be
// water no one can reach or use, and in a large town's drought it held the band to it.
test('P27 water the band leader only sees is not camp water; water they drank at is, while it runs', async () => {
  const { world, people, ctx, membersOf } = await import('./helpers/peoples.ts');
  const { bandWater } = await import('../src/sim/people/decide.ts');
  const { waterOnFoot, WATER_NEAR } = await import('../src/sim/people/waterway.ts');
  const { NEED_N, WATER } = await import('../src/sim/people/needs.ts');
  const tried: string[] = [];
  for (const seed of [20261008, 3, 5, 7, 11]) {
    const sim = world(32, seed);
    const st = people(sim, 'plains-folk', 12, { era: 'stone' });
    assert.ok(st.band, 'a stone-age people set down without a town is a band');
    const x = ctx(sim), A = x.A;
    const lead = A.slotOf(st.leader);
    if (lead < 0) { tried.push(`${seed}: no leader`); continue; }
    const at = [0, 0, 0];
    A.posAt(lead, x.tick, at);
    const seen = waterOnFoot(x, A.species[lead], x.p.cellAt(at), false, WATER_NEAR);
    if (seen.drink < 0) { tried.push(`${seed}: no water in sight`); continue; }
    // no one is thirsty this hour, so no one drinks: the water is only seen
    delete st.recent.wcell; delete st.recent.wseen;
    for (let i = 0; i < 6; i++) { for (const m of membersOf(sim, st)) A.needs[m * NEED_N + WATER] = 1; sim.step(10); }
    assert.equal(st.recent.wcell, undefined, `seed ${seed}: seen water is not recorded as camp water`);
    assert.equal(bandWater(ctx(sim), st), -1, `seed ${seed}: no camp water`);
    // they drank at it a day ago: seen running again, it is their camp water again
    A.posAt(lead, sim.u.tick, at);
    const again = waterOnFoot(ctx(sim), A.species[lead], x.p.cellAt(at), false, WATER_NEAR);
    if (again.drink < 0) { tried.push(`${seed}: water out of sight after the hour`); continue; }
    st.recent.wcell = again.drink; st.recent.wseen = sim.u.tick - ctx(sim).day;
    for (let i = 0; i < 6; i++) { for (const m of membersOf(sim, st)) A.needs[m * NEED_N + WATER] = 1; sim.step(10); }
    assert.ok(bandWater(ctx(sim), st) >= 0, `seed ${seed}: the water they drank at, seen again, is camp water`);
    return;
  }
  assert.fail(`no seed with water in the band leader's sight: ${tried.join('; ')}`);
});

// P28: a daughter village of any cause — the households a crowded town sends off, a schism's — keeps 600 m (BUD_APART)
// from every live town, as a bud does (fix r3 #17); before, a site 250 m from her mother was enough.
test('P28 a crowded town\'s daughter village is founded at least 600 m from every town', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { must } = await import('./helpers/peoples.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { splitOff, BUD_APART } = await import('../src/sim/people/settlement.ts');
  const { distM } = await import('../src/sim/people/world.ts');
  const seen: string[] = [];
  for (const seed of [20261008, 1, 2, 3]) {
    const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
    must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
    const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 56, era: 'bronze', settled: true });
    const p = sim.u.planets[0], ps = p.people;
    const st = ps.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
    sim.step(1440);
    const leave = st.households.filter((h) => h.members.length && !h.members.includes(st.leader)).slice(0, 4);
    const a = splitOff(makeCtx(sim.u, p), st, leave, 'crowding');
    if (!a) { seen.push(`${seed}: no split`); continue; }
    for (let d = 0; d < 16 && a.band && a.fallen < 0; d++) sim.step(1440);
    if (a.fallen >= 0 || a.band) { seen.push(`${seed}: ${a.fallen >= 0 ? 'went home' : 'still a band'}`); continue; }
    for (const o of ps.settlements) if (o.fallen < 0 && !o.band && o.id !== a.id) {
      const d = Math.round(distM(p, o.pos, a.pos));
      seen.push(`${seed}: ${a.name} ${d} m from ${o.name}`);
      assert.ok(d >= BUD_APART, seen.join('; '));
    }
  }
  assert.ok(seen.some((s) => / m from /.test(s)), `a daughter was founded on some seed: ${seen.join('; ')}`);
});

// P22: people take to the water. A fishing town with a boat in its store sends its fishers out on it — onto open water
// (the render draws the boat under them: AgentFlag.boat, carry = the boat) — and leaves the boat at the shore when they
// step back on land; without a boat they fish from the bank as before.
test('P22 fishers with a boat fish afloat on open water and leave the boat at the shore', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { storeAdd } = await import('../src/sim/people/store.ts');
  const { TASK } = await import('../src/sim/people/defs.ts');
  const { AgentFlag } = await import('../src/sim/types.ts');
  const w = twoTowns();
  const sim = w.sim, p = sim.u.planets[0], ps = p.people!;
  const lune = ps.settlement(w.lune.id)!;
  const x = makeCtx(sim.u, p), A = x.A;
  assert.ok(lune.res && lune.res.fish.some((c) => p.f.water[c] > 0.6), 'Lune has open water to fish');
  storeAdd(x, lune, x.c.items.idx('boat'), 2);
  // an empty larder: the town goes fishing
  for (let i = 0; i < lune.store.length; i++) if (x.c.items.list[i].tags.includes('food')) lune.store[i] = 0;
  let afloatH = 0, fishH = 0;
  const strayed: string[] = [];
  for (let h = 0; h < 48; h++) {
    sim.step(60);
    for (const s of ps.members.get(lune.id) ?? []) {
      if (!A.alive[s] || A.mission[s]) continue;
      if (A.task[s] === TASK.fish) { fishH++; if (A.flags[s] & AgentFlag.boat && A.boat[s] >= 0 && p.f.water[A.cell[s]] > 0.6) afloatH++; }
      else if (A.boat[s] >= 0 && p.f.water[A.cell[s]] <= 0.6) strayed.push(`${A.id[s]} task ${A.task[s]} at h${h}`);
    }
  }
  assert.ok(fishH > 0, 'Lune fishes');
  assert.ok(afloatH >= fishH * 0.3, `fishers go out in the boats: ${afloatH} of ${fishH} fisher-hours afloat`);
  assert.ok(strayed.length <= 2, `the boat is left at the shore once they are on land: ${strayed.slice(0, 5).join('; ')}`);
});

// P22 (travellers): a townsman whose way leads onto open water takes the town's boat at the water's edge instead of
// swimming, and leaves it at the far shore; a bather still goes in to swim.
test('P22 a townsman whose way crosses open water takes the town boat, not a swim', async () => {
  const { twoTowns } = await import('./helpers/god.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { storeAdd } = await import('../src/sim/people/store.ts');
  const { TASK } = await import('../src/sim/people/defs.ts');
  const { startTask } = await import('../src/sim/people/tasks.ts');
  const { spotInCell } = await import('../src/sim/people/world.ts');
  const { AgentFlag } = await import('../src/sim/types.ts');
  const w = twoTowns();
  const sim = w.sim, p = sim.u.planets[0], ps = p.people!;
  const lune = ps.settlement(w.lune.id)!;
  const x = makeCtx(sim.u, p), A = x.A, g = p.grid;
  storeAdd(x, lune, x.c.items.idx('boat'), 1);
  const s = (ps.members.get(lune.id) ?? []).find((m) => A.alive[m] && !A.mission[m])!;
  // a shore cell of Lune's water and the open water beside it
  let land = -1, wet = -1;
  for (const o of lune.res!.fish) {
    if (p.f.water[o] <= 0.6) continue;
    for (let e = g.nbrStart[o]; e < g.nbrStart[o + 1]; e++) if (p.f.water[g.nbr[e]] < 0.3) { land = g.nbr[e]; wet = o; break; }
    if (land >= 0) break;
  }
  assert.ok(land >= 0, 'Lune has a shore');
  const put = (task: number) => {
    A.boat[s] = -1; A.flags[s] &= ~AgentFlag.boat;
    const at = spotInCell(p, land, A.id[s], 3, [0, 0, 0]);
    A.cell[s] = land; A.tx[s] = at[0]; A.ty[s] = at[1]; A.tz[s] = at[2];
    startTask(x, s, { kind: task, goal: spotInCell(p, wet, A.id[s], 5, [0, 0, 0]), goalCell: wet, work: 60 });
  };
  put(TASK.explore);
  assert.ok(A.boat[s] >= 0, `the walker onto the water takes the boat (boat ${A.boat[s]})`);
  assert.ok(A.flags[s] & AgentFlag.boat, 'and sits in it');
  put(TASK.bathe);
  assert.equal(A.boat[s], -1, 'a bather swims');
  // the town over two days: nobody but bathers swims out while a boat is in the store
  let afloat = 0, swim = 0;
  for (let h = 0; h < 48; h++) {
    sim.step(60);
    for (const m of ps.members.get(lune.id) ?? []) {
      if (!A.alive[m] || A.mission[m] || A.task[m] === TASK.bathe || p.f.water[A.cell[m]] <= 0.6) continue;
      if (A.boat[m] >= 0) afloat++; else swim++;
    }
  }
  assert.ok(swim <= afloat * 0.1, `on the water in a boat ${afloat} person-hours, swimming ${swim}`);
  console.log(`# P22 travellers: afloat ${afloat}, swimming ${swim}`);
});
