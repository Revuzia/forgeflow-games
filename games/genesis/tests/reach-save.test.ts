// POWERS-GROWTH v3 §7.6-7.7: an old save (no reach state) loads UNBOUND and writes nothing new; a bound world is
// deterministic, also across a save in the middle of a day with a part-used measure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { GodState } from '../src/sim/god/state.ts';
import { world, ctx } from './reach-helpers.ts';

test('reach: an unbound world keeps no reach state, and a save without it loads unbound', () => {
  const sim = world(false);
  const x = ctx(sim);
  assert.ok(x.cast({ k: 'miracle.food', pos: x.at }).ok);
  sim.step(1500);
  const j = sim.u.god.toJson() as unknown as Record<string, unknown>;
  assert.equal('reach' in j, false, 'no reach state is written for a world that was never bound');
  assert.equal('reach.bound' in (j.laws as object), false);
  assert.equal(sim.u.god.law('reach.bound'), 1, 'law() reads 1 for a missing key: the switch must be key presence');
  assert.equal(sim.u.god.bound, false);
  // what an old save holds: no reach, no law
  const old = GodState.fromJson(JSON.parse(JSON.stringify(j)));
  assert.equal(old.bound, false);
  assert.equal(old.reach, undefined);
  const loaded = Sim.load(sim.save());
  assert.equal(loaded.u.god.bound, false);
  assert.equal(loaded.hash(), sim.hash());
  assert.equal((loaded.query('reach') as { bound: boolean }).bound, false);
  // the setting switches it: bound keeps what was gathered, unbound is the sandbox again and the state is kept
  assert.ok(loaded.applyNow({ k: 'meta.reach', bound: true } as never).ok);
  assert.equal(loaded.u.god.bound, true);
  assert.equal((loaded.query('reach') as { bound: boolean; standing: string }).standing, 'Unknown');
  assert.ok(loaded.applyNow({ k: 'meta.reach', bound: false } as never).ok);
  assert.equal(loaded.u.god.bound, false);
  assert.ok(loaded.u.god.reach, 'once bound, the state is kept for good');
  assert.ok(loaded.applyNow({ k: 'disaster.spawn', kind: 'quake', pos: ctx(loaded).at } as never).ok, 'unbound: every power, now');
});

function play(sim: Sim, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    const x = ctx(sim);
    const acts: Record<string, unknown>[] = [{ k: 'water.rain', pos: x.at }, { k: 'settlement.gift', settlement: x.st.id, items: { bread: 6 } }, { k: 'miracle.lightning', pos: x.at, wrath: 0.3 }, { k: 'miracle.water', pos: x.at }];
    sim.applyNow(acts[i % acts.length] as never);
    sim.step(500);
  }
}

test('reach: a bound world is deterministic, and a save mid-day continues tick for tick (spending included)', () => {
  const a = world(true, 21), b = world(true, 21);
  play(a, 0, 7); play(b, 0, 7);
  assert.equal(a.hash(), b.hash(), 'same seed, same acts, same world');
  const ra = a.u.god.reach!;
  assert.ok(ra.believers > 0 && Object.keys(ra.towns).length > 0, 'the measure is in use at the save');
  const c = Sim.load(a.save());
  assert.equal(c.hash(), a.hash());
  assert.deepEqual(c.query('reach'), a.query('reach'));
  play(a, 7, 14); play(c, 7, 14);
  assert.equal(c.hash(), a.hash(), 'the loaded world continues exactly');
  assert.deepEqual(c.query('reach'), a.query('reach'));
  assert.ok((a.query('reach') as { pool: number }).pool >= 0);
});
