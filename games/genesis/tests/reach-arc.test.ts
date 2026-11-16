// POWERS-GROWTH v3, stint 3 (the pieces §9 listed as not built): the arc hooks on the count and the measure (§2.3),
// the link (§3.6), the per-town view, the first deed in answer (§3.6), the made-person rule (§2.2), the offering at
// the door (TASK.offer), miracle widening (§3.3), scenario standings (§7.5), Strict and the legacy label (§3.7), and
// the powers query's clay / cooldown / size fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { TASK, TASK_NAMES } from '../src/sim/people/defs.ts';
import { REACH, doorOffering, offersToday, reachWiden, startStanding, type ReachView, type TownReach } from '../src/sim/god/reach.ts';
import { srel } from '../src/sim/god/regard.ts';
import { world, ctx } from './reach-helpers.ts';

type P = { id: string; tier: number; price: number; cost?: number; free?: boolean; priceNow: number; locked: boolean; affordable: boolean; clay: boolean; size: number;
  basePrice: number; cooldown: number; readyIn: number; cooldownText: string | null; readyAt?: number; freeDeed?: boolean; strict: boolean };
const powers = (sim: Sim, args: Record<string, unknown> = {}) => sim.query('powers', args) as P[];
const reach = (sim: Sim) => sim.query('reach') as ReachView;
const town = (sim: Sim): TownReach => reach(sim).towns![0];

/** a town of believers on the road of trust that has seen the god; returns the day's view */
function faithful(sim: Sim, fear = 0, trust = 0.8) {
  const x = ctx(sim);
  x.clear();
  for (const s of x.grown) x.set(s, 0.8, trust, fear);
  x.seen();
  x.pool(0);
  return x;
}

test('reach arc: pride counts a road single, open defiance counts and gives nothing, the god\'s broken covenant halves', () => {
  const sim = world();
  const x = faithful(sim);
  const n = x.grown.length;
  let v = x.day();
  assert.equal(v.following, 2 * n);
  const t0 = town(sim);
  assert.equal(t0.believers, n); assert.equal(t0.trust, n); assert.equal(t0.fear, 0); assert.equal(t0.both, 0);
  assert.ok(t0.attended && !t0.unseen && !t0.proud && !t0.defiant && !t0.brokenCovenant);
  const m0 = t0.measure;
  assert.ok(m0 > 0);
  const r = srel(sim.u, x.p.id, x.st.id);
  // pride: the count is single, the measure is not touched
  r.pride = 0.7;
  const lines = sim.u.chronicle.length;
  v = x.day();
  assert.equal(v.following, n);
  assert.equal(town(sim).measure, m0);
  assert.ok(town(sim).proud);
  assert.ok(sim.u.chronicle.slice(lines).some((e) => /grown proud/.test(e.text)), 'the chronicle says the town grew proud');
  // open defiance: 0 and nothing given
  r.pride = 0; r.answer = { tick: sim.u.tick, kind: 'curse' };
  v = x.day();
  assert.equal(v.following, 0);
  assert.equal(town(sim).measure, 0);
  assert.ok(town(sim).defiant && town(sim).freeDeed);
  assert.equal(v.believers, n, 'they still believe: the bars do not move');
  // the god broke its covenant with the town: a road counts 1, it gives half
  r.answer = null;
  const cov = { id: 999, planet: x.p.id, made: 0, vow: 'gentle' as const, after: 'the flood', settlements: [x.st.id], status: 'broken' as const, broken: sim.u.tick, signAt: -1, told: 0, halved: false };
  (sim.u.god.rel!.covenants ??= []).push(cov);
  v = x.day();
  assert.equal(v.following, n);
  assert.ok(Math.abs(town(sim).measure - m0 / 2) < 0.02);
  assert.ok(town(sim).brokenCovenant && town(sim).givesHalf);
  // after 12 days the count is whole again; the giving stays halved for a year, then that ends too
  cov.broken = sim.u.tick - 13 * 1440;
  v = x.day();
  assert.equal(v.following, 2 * n);
  assert.ok(!town(sim).brokenCovenant && town(sim).givesHalf);
  cov.broken = sim.u.tick - (REACH.brokenGive + 1) * 1440;
  x.day();
  assert.equal(town(sim).measure, m0);
  // a plain believer (on no road) counts 0 under a fresh break
  cov.broken = sim.u.tick;
  for (const s of x.grown) x.set(s, 0.8, 0.1, 0);
  assert.equal(x.day().following, 0);
});

test('reach arc: the town gives more as it connects (trade, pilgrims), by neither road; the town view carries its parts', () => {
  const sim = world();
  const x = faithful(sim);
  x.day();
  const m0 = town(sim).measure;
  assert.equal(town(sim).link, 1);
  x.st.traded = REACH.tradeFull;
  x.day();
  assert.equal(town(sim).link, 1.15);
  assert.deepEqual(town(sim).linkParts, { trade: 1, pilgrims: 0, kin: 0 });
  assert.ok(Math.abs(town(sim).measure - m0 * 1.15) < 0.02);
  srel(sim.u, x.p.id, x.st.id).since.pilgrimFrom = sim.u.tick;
  x.day();
  assert.equal(town(sim).link, 1.3);
  // the same link for a town on the road of fear
  for (const s of x.grown) x.set(s, 0.8, 0, 0.6);
  x.day();
  assert.equal(town(sim).link, 1.3);
  assert.equal(town(sim).fear, x.grown.length);
  // what it gave yesterday, by road, and what is left of today's measure
  const t = town(sim);
  assert.equal(t.left, t.measure - t.given);
  x.day();
  const y = town(sim).gaveYesterday;
  assert.ok(y.total > 0 && y.fear === y.total && y.trust === 0, 'a town on the road of fear gave by fear (the offering at the door)');
  // the inspector reads the same object
  sim.step(1);
  const sv = (sim.snapshot().planets.find((q) => q.id === x.p.id)!.settlements ?? []).find((s) => s.id === x.st.id)!;
  assert.equal(sv.reach?.believers, town(sim).believers);
  assert.equal(sv.reach?.link, 1.3);
});

test('reach arc: the offering at the door is a visible task that pays the person\'s own part, once an evening', () => {
  const sim = world();
  const x = faithful(sim, 0.6, 0);
  x.day();
  assert.equal(TASK_NAMES[TASK.offer], 'offer');
  const s = x.grown[0];
  const before = town(sim);
  assert.ok(offersToday(sim.u, x.p, x.st.id, s));
  assert.ok(!offersToday(sim.u, x.p, x.st.id, s), 'once an evening');
  const paid = doorOffering(sim.u, x.p, x.st.id, s);
  assert.ok(paid > 0 && paid < before.measure);
  assert.ok(Math.abs(town(sim).given - paid) < 0.011);
  // the day's end pays the rest: the day's total is the measure, as it was without the task
  x.day();
  assert.ok(Math.abs(town(sim).gaveYesterday.total - before.measure) < 0.011);
  // a person on the road of trust alone leaves none
  for (const q of x.grown) x.set(q, 0.8, 0.8, 0);
  x.day();
  assert.ok(!offersToday(sim.u, x.p, x.st.id, x.grown[1]));
  // an unbound world never offers
  const free = world(false);
  const y = ctx(free);
  assert.ok(!offersToday(free.u, y.p, y.st.id, y.grown[0]));
});

test('reach arc: the first deed in answer to an open question is free, once; a person the god makes must be won', () => {
  const sim = world();
  const x = faithful(sim);
  x.day();
  x.pool(0);
  const r = srel(sim.u, x.p.id, x.st.id);
  r.answer = { tick: sim.u.tick, kind: 'curse' };
  let q = sim.query('reach.price', { id: 'heal-miracle', planet: x.p.id, pos: x.at }) as P;
  assert.ok(q.freeDeed && q.priceNow === 0 && !q.locked && q.affordable);
  const res = x.cast({ k: 'miracle.heal', pos: x.at });
  assert.ok(res.ok, res.msg);
  assert.equal(x.pool(), 0);
  r.answer = { tick: sim.u.tick, kind: 'curse' }; // (the act answered it; the same question put again is still the one deed)
  q = sim.query('reach.price', { id: 'heal-miracle', planet: x.p.id, pos: x.at }) as P;
  assert.ok(!q.freeDeed);
  const again = x.cast({ k: 'miracle.heal', pos: x.at });
  assert.ok(!again.ok, 'the second deed is priced like any other');
  // made by the god's hand: no faith, no trust, no fear, and none taken up from the town
  r.answer = null;
  x.pool(40);
  const ids = new Set<number>();
  for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s]) ids.add(x.A.id[s]);
  const mk = x.cast({ k: 'life.spawn-people', settlement: x.st.id, count: 3 });
  assert.ok(mk.ok, mk.msg);
  sim.step(90);
  let made = 0;
  for (let s = 0; s < x.A.hi; s++) {
    if (!x.A.alive[s] || ids.has(x.A.id[s]) || x.A.birth[s] > sim.u.tick - 100) continue;
    made++;
    assert.ok(x.A.faith[s * 4] < 0.3, `a made person does not start as a believer (faith ${x.A.faith[s * 4]})`);
  }
  assert.ok(made >= 1);
});

test('reach arc: a miracle widens with standing; a scenario standing is a floor for its days', () => {
  const sim = world();
  const x = faithful(sim);
  const R = sim.u.god.reach!;
  assert.equal(reachWiden(sim.u, 0, 0), 1);
  R.tier = 4;
  assert.equal(reachWiden(sim.u, 0, 0), 2);
  assert.equal(reachWiden(sim.u, 0, 1), 1.75);
  assert.equal(reachWiden(sim.u, 0, 3), 1.25);
  assert.equal(reachWiden(sim.u, 1, 0), 1, 'rivals are not widened');
  assert.equal(reachWiden(world(false).u, 0, 0), 1, 'an unbound world is not widened');
  R.tier = 0;
  // the floor: no believers at all, and still the standing holds for its days, then falls by the usual grace
  x.clear();
  startStanding(sim.u, 2, 3);
  let v = reach(sim);
  assert.equal(v.tier, 2);
  assert.deepEqual(v.floor, { tier: 2, days: 3 });
  assert.equal(v.pool, v.cap / 2);
  v = x.day(3 + REACH.grace - 1);
  assert.equal(v.tier, 2);
  assert.equal(v.floor, null);
  v = x.day(1);
  assert.equal(v.tier, 1, 'after the floor the real measure rules');
  // the data: developed scenarios carry a standing, the small ones none
  const sc = sim.content.scenarios;
  assert.deepEqual(['babel', 'coldforge', 'twoworlds-late', 'system', 'lookdev', 'shore'].map((id) => [sc.find(id)?.standing ?? 0, sc.find(id)?.standingDays ?? 0]),
    [[1, 60], [1, 60], [2, 60], [2, 60], [4, 0], [0, 0]]);
});

test('reach arc: the powers query says free clay, the cooldown in words and the price at a size; Strict and the legacy label', () => {
  const sim = world();
  const x = faithful(sim);
  x.day();
  const v = reach(sim);
  assert.deepEqual(v.freeBasics, ['rain', 'heal-person', 'plant', 'gift', 'extinguish', 'lightning', 'ignite']);
  assert.ok(v.worlds!.some((w) => w.planet === x.p.id && !w.clay));
  assert.equal(v.clayAll, false);
  assert.ok(v.strict === false && v.legacy === false);
  const list = powers(sim, { planet: x.p.id });
  for (const id of v.freeBasics!) assert.ok(list.find((p) => p.id === id)?.free, `${id} is free`);
  // an empty world of the system, if there is one, is free clay for everything below the last band
  const empty = v.worlds!.find((w) => w.clay);
  if (empty) {
    const there = powers(sim, { planet: empty.planet });
    assert.ok(there.filter((p) => p.tier < 4).every((p) => p.clay && p.priceNow === 0 && !p.locked));
  }
  // size: the query prices what the cast would cost (the same number the gate charges)
  const raise = list.find((p) => p.id === 'raise-land' || (p as unknown as { command: string }).command === 'terrain.raise')!;
  const sized = sim.query('reach.price', { id: raise.id, planet: x.p.id, radius: 500 }) as P;
  assert.equal(sized.size, 2);
  assert.equal(sized.priceNow, raise.priceNow * 2);
  x.pool(40);
  const before = x.pool();
  assert.ok(x.cast({ k: 'terrain.raise', pos: x.at, radius: 500 }).ok);
  assert.equal(before - x.pool(), sized.priceNow);
  // cooldown: a free basic just cast says when it is ready
  assert.ok(x.cast({ k: 'miracle.lightning', pos: x.at }).ok);
  const l = powers(sim, { planet: x.p.id }).find((p) => p.id === 'lightning')!;
  assert.equal(l.readyIn, REACH.freeCooldown.lightning);
  assert.equal(l.readyAt, sim.u.tick + REACH.freeCooldown.lightning);
  assert.match(l.cooldownText!, /^Ready in /);
  assert.equal(l.cooldown, REACH.freeCooldown.lightning);
  // Strict: no power costs less than it did under restraint; the free basics stay free
  const dear = list.find((p) => !p.free && p.tier === 0 && (p.cost ?? 0) > p.price)!;
  assert.ok(dear, 'some basic power cost more under restraint');
  assert.ok(x.cast({ k: 'meta.reach', bound: true, strict: true }).ok);
  assert.equal(reach(sim).strict, true);
  const strict = powers(sim, { planet: x.p.id });
  assert.equal(strict.find((p) => p.id === dear.id)!.priceNow, dear.cost);
  assert.equal(strict.find((p) => p.id === 'rain')!.priceNow, 0);
  assert.ok(x.cast({ k: 'meta.reach', bound: true, strict: false }).ok);
  assert.equal(powers(sim, { planet: x.p.id }).find((p) => p.id === dear.id)!.priceNow, dear.price);
  // the legacy state: an unbound world with restraint on; leaving it for the bounds is one-way
  const old = world(false);
  const y = ctx(old);
  assert.ok(y.cast({ k: 'meta.restraint', on: true }).ok);
  let o = reach(old);
  assert.ok(!o.bound && o.legacy === true && o.strict === false);
  assert.equal(powers(old)[0].priceNow, undefined, 'an unbound world carries no reach fields');
  assert.ok(y.cast({ k: 'meta.reach', bound: true }).ok);
  o = reach(old);
  assert.ok(o.bound && o.legacy === false && o.strict === false);
  assert.equal(old.u.settings.restraint, false);
});
