// GENESIS — water "at hand" is where the body stands (people/decide.ts waterHere): a walker is booked into its leg's far
// cell while its body is still on the way (tasks.ts nextSegment). A thirsty walker stopped short of water must walk to
// it — not start a drink "right here" from the booked cell's water, work it where the body really is (beginWork books
// the true cell), find none, and wander off (townsfolk on a meteor crater's floor died of thirst under the rim this way).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, TASK } from '../src/sim/people/defs.ts';
import { NEED_N, WATER } from '../src/sim/people/needs.ts';
import { decide } from '../src/sim/people/decide.ts';
import { distM } from '../src/sim/people/world.ts';
import { world, people, membersOf, ctx } from './helpers/peoples.ts';

test('a thirsty walker booked beside water it has not reached walks to water instead of drinking where it stands', () => {
  const sim = world(24, 20261008);
  const st = people(sim, 'plains-folk', 12, { settled: true });
  sim.step(30);
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const g = p.grid, P = g.pos, f = p.f;
  const nbrs = (c: number): number[] => { const o: number[] = []; for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) o.push(g.nbr[e]); return o; };
  const at = (c: number): number[] => [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  // a stretch of open land far from the village (no wells), dried out: the body's cell D, the booked cell B beside it,
  // and a spring W beside B that is not beside D
  let D = -1, B = -1, W = -1;
  for (let c = 0; c < p.count && D < 0; c++) {
    if (p.s.ocean[c] || distM(p, at(c), st.pos) < 1500) continue;
    const ring = [c, ...nbrs(c)];
    if (ring.some((q) => p.s.ocean[q] || f.water[q] > 0.05)) continue;
    for (const b of nbrs(c)) {
      const w = nbrs(b).find((q) => q !== c && !nbrs(c).includes(q) && !p.s.ocean[q] && f.water[q] < 0.05);
      if (w !== undefined) { D = c; B = b; W = w; break; }
    }
  }
  assert.ok(D >= 0, 'found open land for the test');
  const dry = new Set<number>([D, B, ...nbrs(D), ...nbrs(B), ...nbrs(D).flatMap(nbrs), ...nbrs(B).flatMap(nbrs)]);
  for (const c of dry) { f.moisture[c] = 0; f.wetness[c] = 0; f.water[c] = 0; f.aquifer[c] = 0; f.precip[c] = 0; f.snow[c] = 0; f.ice[c] = 0; }
  f.moisture[W] = 0.9; f.aquifer[W] = 1; // a seep: drinkable, not open water
  const s = membersOf(sim, st).find((m) => A.alive[m] && !(A.flags[m] & 1) && !A.mission[m] && A.boat[m] < 0)!;
  // the body stands in D; its bookkeeping is a cell ahead, in B (as on a leg toward B)
  A.place(s, ...(at(D) as [number, number, number]), sim.tick);
  A.cell[s] = B;
  p.people.buckets.move(s, B);
  A.needs[s * NEED_N + WATER] = 0.05;
  A.task[s] = TASK.idle;
  A.pathLen[s] = 0;
  decide(ctx(sim), s);
  assert.equal(A.task[s], TASK.drink, 'a parched body goes for water');
  assert.equal(A.phase[s], PHASE.moving, `it walks to water (it started a drink in place, in cell ${A.cell[s]} where there is none)`);
});
