// After a tsunami the open sea falls calm: a sub-centimetre swell left behind must not keep the whole ocean stepping.
// Before the depth-relative sea quiet bound (hydrology.ts QUIET_SEA) ~2-4k of 6.7k ocean cells on this world stayed
// awake for two game days after one wave (a natural quake at 1 500 agents ran 3.5x slower for 4+ days at 1000x).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';

test('hydrology: the sea goes back to sleep within ~30 game hours of a tsunami (the wave itself still runs)', () => {
  const sim = new Sim({ seed: 1234, scenario: 'sandbox', overrides: { n: 32 } });
  assert.ok(sim.applyNow({ k: 'time.scale', scale: 100 }).ok);
  sim.step(600);
  const p = sim.u.planets[0], f = p.f, s = p.s, P = p.grid.pos;
  let sea = -1, best = 0;
  for (let c = 0; c < p.count; c++) if (s.ocean[c] && f.water[c] > best) { best = f.water[c]; sea = c; }
  const awakeSea = (): number => { let a = 0; for (let c = 0; c < p.count; c++) if (s.hAct[c] && s.ocean[c]) a++; return a; };
  assert.ok(sim.applyNow({ k: 'water.tsunami', planet: p.id, pos: [P[sea * 3], P[sea * 3 + 1], P[sea * 3 + 2]], radius: 300, height: 4 }).ok);
  sim.step(60 * 8);
  const early = awakeSea();
  assert.ok(early > 1000, `the wave is still running 8 game hours on: ${early} ocean cells awake`);
  sim.step(60 * 24);
  const late = awakeSea();
  assert.ok(late < 400, `the sea is calm again 32 game hours on: ${late} ocean cells awake (was ~2 000 before the fix)`);
});
