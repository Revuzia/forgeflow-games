// GENESIS — save/load order: the flood all-clear lines ("the water fell back from ...") were told in R.st insertion order, which a
// loaded save (keys sorted on save) does not share with the live world: a long arc run diverged at the first day two towns
// came home in one hour. They are now told in sorted key order, live or loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { twoTowns } from './helpers/god.ts';
import { srel } from '../src/sim/god/regard.ts';
import { evacuationsHourly } from '../src/sim/god/precursors.ts';

test('flood all-clear lines come out in sorted settlement-key order whatever the insertion order', () => {
  const run = (reverse: boolean): { text: string; id: number }[] => {
    const { sim, st, lune } = twoTowns();
    const p = sim.u.planets[0];
    const ids = [st.id, lune.id];
    if (reverse) ids.reverse();
    for (const id of ids) {
      const r = srel(sim.u, p.id, id);
      r.evacuate = { pos: [...st.pos], radius: 300, until: sim.u.tick - 1, disaster: -1, kind: 'flood' };
    }
    // the same save and the same keys, the other insertion order
    const R = sim.u.god.rel!;
    const keys = Object.keys(R.st);
    const flipped: typeof R.st = {};
    for (const k of reverse ? keys.slice().reverse() : keys) flipped[k] = R.st[k];
    R.st = flipped;
    const n0 = sim.u.chronicle.length;
    evacuationsHourly(sim.u, p);
    return sim.u.chronicle.slice(n0).filter((e) => e.text.length).map((e) => ({ text: e.text, id: e.refs?.[0]?.id ?? -1 }));
  };
  const a = run(false), b = run(true);
  assert.equal(a.length, 2);
  assert.deepEqual(a, b);
  void Sim;
});
