// GENESIS — release minor item #2, seed-bound hunting blackout (simfix r1): on seed 1 the town "Shenyaar by the Sea" sent
// no hunting party for 17 years — every way to 16 herds on dry land crossed one 1.4 m sea cell, and onFoot refused any sea
// cell over 0.6 m. A hunting party now wades the sea's shallows (<= WADE_M) for a few cells (WADE_CELLS); deep water and
// the open sea stay impassable. Diagnosis and the 8-seed re-measure: _harness/scratch/minor26/simfix.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM, cellPos, isLand } from '../src/sim/people/world.ts';
import { onFoot, parties, WADE_M, WADE_CELLS } from '../src/sim/people/hunt.ts';
import { world, must, people } from './helpers/peoples.ts';

/** a village, and a dry cell 500-700 m off it reached on foot; `moat(lo, hi, depth)` floods the ring lo..hi m round the
 * village into sea `depth` m deep */
function setup() {
  const sim = world(24, 3);
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const st = people(sim, 'plains-folk', 30, { era: 'bronze', settled: true });
  sim.step(30);
  const x = makeCtx(sim.u, sim.u.planets[0]);
  const p = x.p;
  let goal = -1;
  for (let c = 0; c < p.count && goal < 0; c++) {
    if (!isLand(p, c) || p.f.water[c] > 0.05) continue;
    const d = distM(p, cellPos(p, c), st.pos);
    if (d >= 500 && d <= 700 && onFoot(x, st, st.pos, c)) goal = c;
  }
  assert.ok(goal >= 0, 'dry land on foot near the village');
  const moat = (lo: number, hi: number, depth: number) => {
    for (let c = 0; c < p.count; c++) {
      const d = distM(p, cellPos(p, c), st.pos);
      if (d >= lo && d < hi) { p.f.water[c] = depth; p.s.ocean[c] = 1; }
    }
  };
  return { x, st, goal, moat, edge: p.edgeM };
}

test('hunt: a party wades a narrow channel of shallow sea to its game (simfix r1, seed 1)', () => {
  const { x, st, goal, moat, edge } = setup();
  // a channel about two cells wide, 1.4 m deep (seed 1's cell), all the way round the village
  moat(250, 250 + 1.6 * edge, 1.4);
  assert.ok(1.4 <= WADE_M);
  assert.equal(onFoot(x, st, st.pos, goal), true, 'the shallows are waded');
});

test('hunt: deeper sea, or a wide stretch of shallows, is still no way on foot (fix r3 #7 kept)', () => {
  const a = setup();
  a.moat(250, 250 + 1.6 * a.edge, 2.2);
  assert.equal(onFoot(a.x, a.st, a.st.pos, a.goal), false, 'sea past the shallows is not crossed');
  const b = setup();
  b.moat(150, 150 + (WADE_CELLS + 3) * b.edge, 1.0);
  assert.equal(onFoot(b.x, b.st, b.st.pos, b.goal), false, 'kilometres of shallows are not waded');
});

test('hunt: seed 1\'s town by the sea sends a hunting party in its first two years (simfix r1)', () => {
  // the alone-run world (lib.ts world(1, 64) + a band of 30): before the fix, no party for 17 years
  const sim = new Sim({ seed: 1, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'stone', settled: false } as never);
  must(sim, { k: 'time.scale', tps: 3000 } as never);
  const p = sim.u.planets[0];
  const end = 2 * Math.round(p.st.orbit.period);
  let seen = false;
  for (let t = 0; t < end && !seen; t += 360) {
    sim.step(360); sim.drainEvents();
    for (const st of p.people.settlements) if (st.fallen < 0 && !st.band && parties(st).length) seen = true;
  }
  assert.ok(seen, 'a town sends a party within two years');
});
