// POWERS-GROWTH v3 §2, §3.1: the measure, the two roads (and a person on both), rise and fall with grace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentFlag } from '../src/sim/types.ts';
import { REACH } from '../src/sim/god/reach.ts';
import { world, ctx } from './reach-helpers.ts';

test('reach: the measure counts grown believers of towns that have seen the god; belief no one witnessed counts for nothing', () => {
  const sim = world();
  const x = ctx(sim);
  assert.ok(x.grown.length >= 14, `needs a town of grown people (${x.grown.length})`);
  x.clear();
  assert.equal(x.day().following, 0);
  for (let i = 0; i < 3; i++) x.set(x.grown[i], 0.4);
  let v = x.day();
  assert.equal(v.following, 0, 'faith that rose with no act of the god witnessed does not count');
  x.seen();
  v = x.day();
  assert.equal(v.believers, 3);
  assert.equal(v.following, 3);
  // a child never counts; faith under the line never counts; fear or trust without belief counts for nothing
  x.A.flags[x.grown[3]] |= AgentFlag.child;
  x.set(x.grown[3], 0.9, 0.9, 0);
  x.set(x.grown[4], 0.29, 0.9, 0);
  x.set(x.grown[5], 0, 0, 0.9);
  v = x.day();
  assert.equal(v.following, 3);
  x.A.flags[x.grown[3]] &= ~AgentFlag.child;
});

test('reach: each road counts double, a person on both roads counts the same as on one, and neither road erases the other', () => {
  const sim = world();
  const x = ctx(sim);
  x.clear(); x.seen();
  const [a, b, c, d] = x.grown;
  x.set(a, 0.5);            // believer, no road
  x.set(b, 0.5, 0.5, 0);    // the road of trust
  x.set(c, 0.5, 0, 0.35);   // the road of fear
  x.set(d, 0.5, 0.8, 0.8);  // both
  let v = x.day();
  assert.equal(v.believers, 4);
  assert.equal(v.following, 1 + 2 + 2 + 2);
  assert.equal(v.trust, 2, 'the trust bar counts the person on both roads');
  assert.equal(v.fear, 2, 'the fear bar counts the person on both roads');
  assert.equal(v.both, 1);
  assert.ok(v.trustShare > 0 && v.fearShare > 0);
  // a mixed people is not weaker than a pure one: n on trust + n on fear = 2n on one road
  const n = 6;
  const F = (mix: (i: number) => [number, number]) => { x.clear(); for (let i = 0; i < 2 * n; i++) { const [t, f] = mix(i); x.set(x.grown[i], 0.6, t, f); } return x.day().following; };
  const pureT = F(() => [0.7, 0]), pureF = F(() => [0, 0.7]), mixed = F((i) => (i % 2 ? [0.7, 0] : [0, 0.7])), bothAll = F(() => [0.7, 0.7]);
  assert.equal(pureT, 4 * n);
  assert.equal(pureF, pureT, 'the road of fear earns the same standing as the road of trust');
  assert.equal(mixed, pureT, 'a mixed people counts the same');
  assert.equal(bothAll, pureT, 'holding both is capped at the count of one road');
  // the keep lines: fear holds its road down to fearKeep, trust down to trustKeep
  x.clear();
  x.set(a, 0.5, 0, 0.4); x.day();
  x.set(a, 0.5, 0, 0.1);
  assert.equal(x.day().fear, 1, 'fear that has faded is still the road of fear down to the keep line');
  x.set(a, 0.5, 0, REACH.fearKeep - 0.01);
  v = x.day();
  assert.equal(v.fear, 0);
  assert.equal(v.following, 1, 'still a believer');
  x.set(b, 0.5, 0, 0.1);
  assert.equal(x.day().fear, 0, 'fear under the line that was never on the road does not enter it');
});

test('reach: in a bound world help does not wipe fear and a warned harm does not cost trust (unbound: the arc numbers stand)', () => {
  const run = (bound: boolean) => {
    const sim = world(bound, 9);
    const x = ctx(sim);
    x.clear();
    for (const s of x.grown) x.set(s, 0.6, 0.5, 0.6);
    // a harm, then help within three days: the mercy rule
    x.pool(1000);
    assert.ok(x.cast({ k: 'miracle.lightning', pos: x.at, wrath: 0.3 }).ok);
    const fearAfterHarm = x.grown.map((s) => x.A.fear[s * 4]);
    const r = x.cast({ k: 'settlement.gift', settlement: x.st.id, items: { bread: 6 } });
    assert.ok(r.ok, r.msg);
    let dropped = 0;
    x.grown.forEach((s, i) => { if (x.A.fear[s * 4] < fearAfterHarm[i] - 1e-6) dropped++; });
    return dropped;
  };
  assert.equal(run(true), 0, 'bound: mercy leaves fear where it was');
  assert.ok(run(false) > 0, 'unbound: the mercy rule still eases fear, as the arc was tuned');
});

test('reach: standing rises one step at a time after the hold, falls one step after the grace, and says so', () => {
  const sim = world();
  const x = ctx(sim);
  x.clear(); x.seen();
  sim.drainEvents();
  for (let i = 0; i < 3; i++) x.set(x.grown[i], 0.5);
  let v = x.day();
  assert.equal(v.standing, 'Whispered', 'three believers held a day');
  assert.equal(v.best, 1);
  let ev = sim.drainEvents().filter((e) => e.t.startsWith('reach.'));
  assert.deepEqual(ev.map((e) => e.t), ['reach.rose']);
  assert.equal((ev[0].data as { to: number }).to, 1);
  // the whole town on a road: Known needs its hold (30 days, quicker with a larger Following, never under half)
  for (const s of x.grown) x.set(s, 0.8, 0.8, 0);
  v = x.day();
  assert.equal(v.tier, 1, 'no jump: the line must hold');
  assert.ok(v.next && v.next.tier === 2 && v.next.held > 0 && v.next.hold === REACH.hold[2]);
  let days = 1;
  while (x.day().tier < 2 && days < 100) days++;
  assert.ok(days + 1 >= REACH.hold[2] / 2 && days + 1 <= REACH.hold[2], `Known after ${days + 1} days`);
  assert.equal(x.day().tier, 2, 'one step at a time: not Worshipped');
  // the Following collapses: a warning on the first day, the standing kept through the grace, then one step down
  x.clear();
  sim.drainEvents();
  v = x.day();
  assert.equal(v.tier, 2);
  assert.equal(v.falling, REACH.grace - 1);
  assert.deepEqual(sim.drainEvents().filter((e) => e.t.startsWith('reach.')).map((e) => e.t), ['reach.falling']);
  // belief returning inside the grace stops the fall
  for (const s of x.grown) x.set(s, 0.8, 0, 0.8);
  assert.equal(x.day().falling, 0, 'the road of fear holds the standing as well as trust did');
  x.clear();
  v = x.day(REACH.grace - 1);
  assert.equal(v.tier, 2);
  v = x.day();
  assert.equal(v.tier, 1, 'one step down after the grace');
  ev = sim.drainEvents().filter((e) => e.t === 'reach.fell');
  assert.equal(ev.length, 1);
  v = x.day(REACH.grace);
  assert.equal(v.tier, 0);
  assert.equal(v.best, 2, 'the best standing is remembered');
});
