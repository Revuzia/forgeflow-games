// GENESIS — knowledge loss (CONTRACT.md §8.4, §16.1): knowledge lives in heads, in readable books and in cohorts. When
// the last knower dies (or the god silences them) the settlement loses it and the chronicle names them — "The secret
// of bronze died with Hesh of Aru." Written knowledge outlives its knowers while someone can read; burned with its
// library, or unreadable once writing itself is forgotten, it is gone. Valuable finds may be hoarded by a house.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { BuildingFlag } from '../src/sim/types.ts';
import { recomputeWritten, refreshLibrary, learn, libHas } from '../src/sim/people/knowledge.ts';
import { ruin } from '../src/sim/people/buildings.ts';
import { NT, TRAIT } from '../src/sim/people/defs.ts';
import { world, people, must, ctx, membersOf, adultsOf, recipe, chronicleSince } from './helpers/peoples.ts';

/** a bronze-age town where exactly one person (renamed Hesh, of Aru) knows `id` and nothing of it is written */
function lastKnower(id = 'bronze'): { sim: Sim; st: Settlement; k: number; hesh: number; heshId: number } {
  const sim = world();
  const st = people(sim, 'plains-folk', 26, { era: 'bronze', settled: true });
  sim.step(20);
  const x = ctx(sim);
  const A = x.A;
  const k = recipe(sim, id);
  for (const b of x.ps.of(st.id)) b.books = b.books.filter((q) => q !== k);
  recomputeWritten(x, st);
  const adults = adultsOf(sim, st);
  const hesh = adults[0];
  for (const m of membersOf(sim, st)) A.setKnows(m, k, m === hesh);
  refreshLibrary(x, st);
  assert.ok(libHas(st, k), `${id} is known in the town`);
  must(sim, { k: 'agent.rename', id: A.id[hesh], name: 'Hesh' } as unknown as Command);
  must(sim, { k: 'settlement.rename', settlement: st.id, name: 'Aru' } as unknown as Command);
  return { sim, st, k, hesh, heshId: A.id[hesh] };
}

test('the last knower dies: the town loses the secret and the chronicle names them', () => {
  const { sim, st, k, heshId } = lastKnower('bronze');
  const c0 = sim.u.chronicle.length;
  const e0 = sim.u.events.length;
  must(sim, { k: 'agent.kill', id: heshId } as unknown as Command);
  assert.ok(!st.library.includes(k), 'bronze left the library');
  assert.ok(st.stats.lost >= 1);
  const lines = chronicleSince(sim, c0);
  const line = lines.find((t) => /bronze/i.test(t) && /Hesh/.test(t));
  assert.ok(line, `a chronicle line names Hesh and bronze: ${JSON.stringify(lines)}`);
  assert.match(line!, /died with Hesh of Aru|When Hesh died, Aru forgot/);
  assert.ok(sim.u.events.slice(e0).some((e) => e.t === 'loss' && e.a === k), 'a loss event for the inspector / toasts');
  // nobody can work it now
  const A = sim.u.planets[0].people.agents;
  for (const m of membersOf(sim, st)) assert.ok(!A.knows(m, k));
  // and the loss is final until rediscovered: an hour on, the library still lacks it
  sim.step(90);
  assert.ok(!st.library.includes(k));
});

test('written down, it survives the death of its last knower; burned with its library, it is lost', () => {
  const { sim, st, k, heshId } = lastKnower('bronze');
  const x = ctx(sim);
  const A = x.A;
  // a reader, and a book of bronze in a standing house
  const writing = recipe(sim, 'writing');
  const reader = adultsOf(sim, st)[1];
  A.setKnows(reader, writing, true);
  const lib = x.ps.of(st.id).find((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].provides.includes('shelter'));
  assert.ok(lib, 'a standing house to keep the book');
  lib!.books.push(k);
  lib!.books.sort((a, b) => a - b);
  recomputeWritten(x, st);
  refreshLibrary(x, st);
  assert.ok(st.written.includes(k));
  const c0 = sim.u.chronicle.length;
  must(sim, { k: 'agent.kill', id: heshId } as unknown as Command);
  assert.ok(st.library.includes(k), 'the book keeps bronze');
  assert.ok(!chronicleSince(sim, c0).some((t) => /bronze/i.test(t) && /died with|forgot/.test(t)), 'no loss line while it is written');
  // the house burns
  const c1 = sim.u.chronicle.length;
  ruin(ctx(sim), st, lib!, 'fire');
  assert.ok(!st.written.includes(k), 'the book burned');
  assert.ok(!st.library.includes(k), 'and with it, bronze');
  assert.ok(chronicleSince(sim, c1).some((t) => /bronze/i.test(t)), `the burning is chronicled: ${JSON.stringify(chronicleSince(sim, c1))}`);
});

test('books nobody can read keep nothing: when the last reader dies, the written craft fades from the library', () => {
  const { sim, st, k, heshId } = lastKnower('bronze');
  const x = ctx(sim);
  const A = x.A;
  const writing = recipe(sim, 'writing');
  // exactly one reader
  for (const m of membersOf(sim, st)) A.setKnows(m, writing, false);
  const reader = adultsOf(sim, st)[1];
  A.setKnows(reader, writing, true);
  const lib = x.ps.of(st.id).find((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].provides.includes('shelter'))!;
  lib.books.push(k);
  recomputeWritten(x, st);
  refreshLibrary(x, st);
  must(sim, { k: 'agent.kill', id: heshId } as unknown as Command);
  assert.ok(st.library.includes(k), 'readable: kept');
  must(sim, { k: 'agent.kill', id: A.id[reader] } as unknown as Command);
  sim.step(120); // the hourly library refresh
  assert.ok(!st.library.includes(writing), 'writing died with the reader');
  assert.ok(st.written.includes(k), 'the book still stands...');
  assert.ok(!st.library.includes(k), '...but nobody can read it');
});

test('the god silences the last knower: the town loses it and the chronicle says so', () => {
  const { sim, st, k, heshId } = lastKnower('pottery');
  const c0 = sim.u.chronicle.length;
  must(sim, { k: 'agent.silence', id: heshId, knowledge: 'pottery' } as unknown as Command);
  assert.ok(!st.library.includes(k));
  const A = sim.u.planets[0].people.agents;
  assert.ok(!A.knows(A.slotOf(heshId), k));
  assert.ok(chronicleSince(sim, c0).some((t) => /pottery/i.test(t)), `chronicled: ${JSON.stringify(chronicleSince(sim, c0))}`);
});

test('hoarding: a reserved finder hides a valuable secret within their house; "They hid it."', () => {
  const sim = world();
  const st = people(sim, 'plains-folk', 24, { era: 'bronze', settled: true });
  sim.step(20);
  const x = ctx(sim);
  const A = x.A;
  // the most reserved adult
  const adults = adultsOf(sim, st);
  const finder = adults.reduce((a, b) => (A.traits[a * NT + TRAIT.sociability] <= A.traits[b * NT + TRAIT.sociability] ? a : b));
  const secrets = ['brewing', 'jewellery', 'iron-smelting', 'glassmaking', 'steel', 'gunpowder'].map((id) => recipe(sim, id));
  const c0 = sim.u.chronicle.length;
  let hidden = -1;
  for (let attempt = 0; attempt < 60 && hidden < 0; attempt++) {
    const k = secrets[attempt % secrets.length];
    // nobody in town knows it yet
    for (const m of membersOf(sim, st)) A.setKnows(m, k, false);
    refreshLibrary(x, st);
    x.tick = sim.u.tick + attempt;
    learn(x, finder, k, 'experiment');
    if (st.secrets.includes(k)) hidden = k;
  }
  assert.ok(hidden >= 0, 'a reserved finder hid one of six valuable secrets within 60 finds');
  assert.ok(chronicleSince(sim, c0).some((t) => /hid it|a secret/.test(t)), 'the hoard is chronicled');
  // the secret is the house's: when its only knower dies, it dies too, and is no longer listed as a secret
  for (const m of membersOf(sim, st)) if (m !== finder) A.setKnows(m, hidden, false);
  refreshLibrary(x, st);
  must(sim, { k: 'agent.kill', id: A.id[finder] } as unknown as Command);
  assert.ok(!st.library.includes(hidden));
  assert.ok(!st.secrets.includes(hidden));
  const info = sim.query('settlement', { id: st.id }) as { secrets: string[] };
  assert.ok(Array.isArray(info.secrets));
});
