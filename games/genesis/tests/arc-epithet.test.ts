// GENESIS — Lane C task 2: epithetOf is cached per tick (snapshots ask for it every tick); the cache must give exactly the
// uncached scan's value, also when a command changes the god's record inside one tick, and across a save/load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { epithetOf, epithetUncached } from '../src/sim/god/story.ts';

test('epithet cache: equals the uncached scan every step of a run with covenant, break, strikes and mercy; and inside a tick', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  const seen = new Set<string>();
  const same = (what: string): void => {
    const c = epithetOf(sim.u, p.id);
    assert.equal(c, epithetUncached(sim.u, p.id), `${what} @${sim.u.tick}`);
    assert.equal(epithetOf(sim.u, p.id), c, 'a second ask in the tick gives the same');
    seen.add(c);
  };
  same('start');
  must(sim, { k: 'covenant.offer', settlement: st.id } as never);
  same('offer, same tick');
  sim.step(4 * day);
  must(sim, { k: 'covenant.make', vow: 'gentle' } as never);
  same('covenant made, same tick');
  for (let i = 0; i < 60; i++) {
    sim.step(day * 3);
    same('day');
    if (i % 7 === 3) { sim.applyNow({ k: 'miracle.lightning', pos: [...st.pos], wrath: 0.7, ...(i === 10 ? { covenant: 'break' } : {}) } as never); same('after a strike, same tick'); }
    if (i % 5 === 1) { sim.applyNow({ k: 'miracle.food', pos: [...st.pos], radius: 300 } as never); same('after food, same tick'); }
    if (i % 9 === 4) { sim.applyNow({ k: 'god.omen', settlement: st.id } as never); same('after an omen, same tick'); }
  }
  assert.ok(seen.size >= 2, `the epithet changed during the run: ${[...seen].join(' | ')}`);
  const back = Sim.load(sim.save());
  assert.equal(epithetOf(back.u, p.id), epithetUncached(back.u, p.id), 'after a load');
  assert.equal(epithetOf(back.u, p.id), epithetOf(sim.u, p.id));
});
