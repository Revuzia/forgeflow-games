// POSTREL perf (release item 1, speed floors): at the 1000x preset (time-lapse level 1: a day passes in 1.4 real
// seconds, the renderer's snapshots are game hours apart) a walk that ends at the task's goal goes straight on into the
// work, as at 3000x — the arrival's own turn bought nothing anyone could see. A flight from fire still wakes on
// arrival (plapse.ts mergeArrival), and the plain sim (1x-300x) is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { bestSiteOnPlanet, spawnPeople } from '../src/sim/people/spawn.ts';
import { mergeArrival, LEG, STRETCH } from '../src/sim/perf/plapse.ts';
import { TASK } from '../src/sim/people/defs.ts';

function must(sim: Sim, c: Command): void {
  const r = sim.applyNow(c);
  assert.ok(r.ok, r.msg);
}

test('peoples time-lapse: at the 1000x preset an errand walks straight into its work (not a flight from fire); 1x-300x plain', () => {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 16 } });
  const x = makeCtx(sim.u, sim.u.planets[0]);
  for (const tps of [1, 300]) {
    must(sim, { k: 'time.scale', tps });
    assert.equal(mergeArrival(x, TASK.forage), false, `${tps}x is the plain sim`);
  }
  for (const tps of [1000, 3000]) {
    must(sim, { k: 'time.scale', tps });
    assert.equal(mergeArrival(x, TASK.forage), true, `${tps}x merges the arrival into the work`);
    assert.equal(mergeArrival(x, TASK.flee), false, `${tps}x: a flight from fire wakes on arrival`);
  }
  assert.equal(LEG[1], LEG[2], 'the walking legs of 1000x are those of 3000x');
  assert.ok(STRETCH[1] <= STRETCH[2]);
});

test('peoples time-lapse: decisions per tick at the 1000x preset come within 30 % of 3000x (were ~2x)', { timeout: 120_000 }, () => {
  const turns = (tps: number): number => {
    const sim = new Sim({ seed: 1234, scenario: 'sandbox', overrides: { n: 32, vegetation: 1 } });
    const p = sim.u.planets[0];
    let made = 0, k = 0;
    while (made < 240 && k < 100) {
      const cell = bestSiteOnPlanet(makeCtx(sim.u, p), 0, 1000 + k++);
      if (spawnPeople(sim.u, p, { species: 'plains-folk', count: 60, cell, era: 'clay', settled: true })) made += 60;
    }
    assert.equal(made, 240);
    must(sim, { k: 'time.scale', tps });
    sim.step(600);
    const t0 = p.people.counters.turns;
    sim.step(1440);
    return (p.people.counters.turns - t0) / 1440;
  };
  const l1 = turns(1000), l2 = turns(3000);
  assert.ok(l1 < l2 * 1.3, `1000x ${l1.toFixed(2)} turns/tick vs 3000x ${l2.toFixed(2)}`);
});
