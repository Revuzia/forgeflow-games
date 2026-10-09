// GENESIS — scenario peoples survive their first weeks (phase-2 review: every scenario's peoples died out within weeks —
// cold nights in finished huts, thirst beside lakes, sites picked in places no one could live). A short, coarse run
// of the two-world scenario: each people keeps most of its number, and nobody dies of thirst while water is at hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';

test('twoworlds: both peoples are alive and mostly whole after three weeks; thirst kills almost no one', () => {
  const sim = new Sim({ seed: 3, scenario: 'twoworlds', overrides: { n: 32 } });
  const u = sim.u;
  const start = new Map(u.planets.filter((p) => p.people && p.people.agents.count > 0).map((p) => [p.name, p.people.agents.count + cohort(p)]));
  assert.ok(start.size >= 2, 'two peopled worlds');
  const deaths = new Map<string, number>();
  for (let h = 0; h < 21 * 24; h++) {
    sim.step(60);
    for (const e of sim.drainEvents()) {
      if (e.t !== 'death') continue;
      const p = u.planets.find((q) => q.id === e.planet);
      if (p) deaths.set(`${p.name}:${e.text}`, (deaths.get(`${p.name}:${e.text}`) ?? 0) + 1);
    }
  }
  for (const [name, n0] of start) {
    const p = u.planets.find((q) => q.name === name)!;
    const n = p.people.agents.count + cohort(p);
    const thirst = deaths.get(`${name}:thirst`) ?? 0;
    assert.ok(n >= n0 * 0.6, `${name}: ${n0} -> ${n} (deaths ${JSON.stringify(Object.fromEntries(deaths))})`);
    assert.ok(thirst <= Math.max(2, n0 * 0.08), `${name}: ${thirst} died of thirst`);
  }
});

/** people living as a settlement's cohort (beyond the individual cap) */
function cohort(p: { people: { settlements: { cohort?: { n: number[] } }[] } }): number {
  let n = 0;
  for (const st of p.people.settlements) for (const k of st.cohort?.n ?? []) n += k;
  return Math.round(n);
}
