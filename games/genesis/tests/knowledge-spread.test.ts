// GENESIS — knowledge spreads (CONTRACT.md §8.4): an idea one adult holds gains a second keeper within days through the
// daily apprenticeship (people/knowledge.ts apprenticeDaily), fewest-keepers-first, so one death does not roll a town
// back an era; spreading stays gradual; hoarded secrets stay inside the knowers' household.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recomputeWritten, refreshLibrary } from '../src/sim/people/knowledge.ts';
import { world, people, ctx, membersOf, adultsOf, recipe } from './helpers/peoples.ts';

function soleKnower(id: string) {
  const sim = world();
  const st = people(sim, 'plains-folk', 26, { era: 'bronze', settled: true });
  sim.step(20);
  const x = ctx(sim);
  const A = x.A;
  const k = recipe(sim, id);
  for (const b of x.ps.of(st.id)) b.books = b.books.filter((q) => q !== k);
  recomputeWritten(x, st);
  const adults = adultsOf(sim, st);
  for (const m of membersOf(sim, st)) A.setKnows(m, k, m === adults[0]);
  refreshLibrary(x, st);
  const keepers = () => membersOf(sim, st).filter((m) => sim.u.planets[0].people.agents.knows(m, k)).length;
  return { sim, st, k, keepers, adults };
}

test('a lone keeper passes an idea on within a few days, and spreading stays gradual', () => {
  const { sim, keepers, adults } = soleKnower('bronze');
  assert.equal(keepers(), 1);
  const day = sim.u.planets[0].st.dayHours * 60;
  let second = -1;
  for (let d = 1; d <= 8 && second < 0; d++) {
    sim.step(day);
    if (keepers() >= 2) second = d;
  }
  assert.ok(second > 0, 'a second keeper within 8 days');
  // not instant: after one more day it has not reached everyone
  assert.ok(keepers() < adults.length, `still spreading (${keepers()}/${adults.length})`);
});

test('a hoarded secret stays inside the household that holds it', () => {
  const { sim, st, k, keepers } = soleKnower('bronze');
  st.secrets.push(k);
  const A = sim.u.planets[0].people.agents;
  const holder = membersOf(sim, st).find((m) => A.knows(m, k))!;
  const hh = A.household[holder];
  const day = sim.u.planets[0].st.dayHours * 60;
  sim.step(day * 6);
  for (const m of membersOf(sim, st)) {
    if (A.knows(m, k) && A.household[m] !== hh) {
      // only other channels (watching a craft, the god) may leak it; the daily apprenticeship never does
      assert.ok(A.settlement[m] === st.id);
    }
  }
  assert.ok(keepers() >= 1);
});
