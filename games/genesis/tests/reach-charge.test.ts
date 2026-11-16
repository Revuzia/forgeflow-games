// POWERS-GROWTH v3 §3.6-3.7, §7.3: every power costs worship by size except the free list; the gate refuses in plain
// words and charges nothing on a refusal or a failed cast; and the no-dead-end guarantee (owner 2026-11-16, second ruling:
// no income without believers, so the free basics must be able to start a god again from nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { REACH } from '../src/sim/god/reach.ts';
import { world, ctx } from './reach-helpers.ts';

const powers = (sim: Sim) => sim.query('powers') as { id: string; tier: number; price: number; free?: boolean; priceNow?: number; locked?: boolean; affordable?: boolean; reason?: string | null }[];

test('reach: a new bound world starts with a pool; a power is charged its price, by size, once it has worked', () => {
  const sim = world();
  const x = ctx(sim);
  assert.equal(x.pool(), REACH.start);
  sim.drainEvents();
  let r = x.cast({ k: 'god.omen', kind: 'aurora', settlement: x.st.id });
  if (!r.ok) r = x.cast({ k: 'life.cure', settlement: x.st.id });
  assert.ok(r.ok, r.msg);
  const first = REACH.start - x.pool();
  assert.ok(first > 0, 'a priced power was charged');
  const spent = sim.drainEvents().filter((e) => e.t === 'worship.spent');
  assert.equal(spent.length, 1);
  assert.equal((spent[0].data as { amount: number }).amount, first);
  // size: twice the default radius costs twice
  const before = x.pool();
  r = x.cast({ k: 'terrain.raise', pos: x.at, radius: 500 });
  assert.ok(r.ok, r.msg);
  assert.equal(x.pool(), before - 4);
  // the catalogue the UI reads: tier, price, and the live state
  const list = powers(sim);
  for (const p of list) {
    assert.ok(typeof p.tier === 'number' && p.tier >= 0 && p.tier <= 4, `${p.id} has a tier`);
    assert.ok(p.free ? p.price === 0 : p.price > 0, `${p.id}: every power that is not free has a price`);
    assert.equal(typeof p.priceNow, 'number');
  }
  const byTier = (t: number) => list.filter((p) => p.tier === t && !p.free).map((p) => p.price);
  assert.ok(Math.max(...byTier(0)) <= REACH.start, 'a new world can afford any one of the basics');
  for (let t = 1; t <= 4; t++) assert.ok(Math.min(...byTier(t)) >= Math.min(...byTier(t - 1)), 'bigger bands cost more');
  const quake = list.find((p) => p.id === 'disaster-quake')!;
  assert.equal(quake.locked, true);
  assert.match(String(quake.reason), /Beyond your reach.*Worshipped/);
});

test('reach: out of reach, unaffordable and failed casts are refused in plain words and cost nothing', () => {
  const sim = world();
  const x = ctx(sim);
  // two bands up: refused whatever the pool
  x.pool(5000);
  let r = x.cast({ k: 'miracle.food', pos: x.at });
  assert.equal(r.ok, false);
  assert.match(String(r.msg), /^Beyond your reach\. .* opens when you are Known: 30 follow, 0 now\.$/);
  assert.equal(x.pool(), 5000);
  // one band up: three times the price
  r = x.cast({ k: 'miracle.water', pos: x.at });
  assert.ok(r.ok, r.msg);
  assert.equal(x.pool(), 5000 - 30);
  // not enough gathered: refused, nothing taken, no cooldown started
  x.pool(1);
  r = x.cast({ k: 'terrain.raise', pos: x.at });
  assert.equal(r.ok, false);
  assert.match(String(r.msg), /needs 2 worship; 1 is gathered\. No one gives to you yet\./);
  assert.equal(x.pool(), 1);
  x.pool(2);
  // a free spell is free at its own size; cast ten times as wide it is priced, and refused when the pool is short
  r = x.cast({ k: 'fire.ignite', pos: x.at, radius: 600 });
  assert.equal(r.ok, false);
  assert.match(String(r.msg), /at this size needs 30 worship/);
  assert.equal(x.pool(), 2);
  // a cast the handler itself refuses (a rainbow needs the sun; an unknown idea) charges nothing
  x.pool(100);
  r = x.cast({ k: 'idea.teach', settlement: x.st.id, knowledge: 'no-such-idea' });
  assert.equal(r.ok, false, String(r.msg));
  assert.doesNotMatch(String(r.msg), /worship|reach/);
  assert.equal(x.pool(), 100);
  assert.equal(sim.u.god.cooldowns['0:teach'], undefined);
  assert.ok(x.pool() >= 0);
});

test('reach: the clock, the Hand, the answers and the very basic spells are free; the free spells need time between casts', () => {
  const sim = world();
  const x = ctx(sim);
  x.pool(0);
  const list = powers(sim);
  const free = new Set(list.filter((p) => p.free).map((p) => p.id));
  for (const id of ['speed', 'save', 'load', 'grab', 'place', 'slap', 'stroke', 'possess-move', 'answer-prayer', 'tower-warn', 'vow-gentle', 'answer-mercy', 'rain', 'heal-person', 'plant', 'lightning', 'gift', 'ignite', 'extinguish']) assert.ok(free.has(id), `${id} is free`);
  // the free list holds a small help, a small harm and a small wonder (a way to earn belief by each road)
  assert.ok(free.has('rain') && free.has('gift') && free.has('lightning') && free.has('ignite'));
  assert.equal(free.has('omen-rainbow'), false, 'the rainbow is a sign and is priced (owner 2026-11-16, third)');
  assert.equal(list.find((p) => p.id === 'omen-rainbow')!.price, 5);
  assert.ok(x.cast({ k: 'water.rain', pos: x.at }).ok);
  const again = x.cast({ k: 'water.rain', pos: x.at });
  assert.equal(again.ok, false);
  assert.match(String(again.msg), /still gathering strength/);
  assert.ok(x.cast({ k: 'miracle.lightning', pos: x.at }).ok);
  assert.ok(x.cast({ k: 'time.speed', speed: 1 }).ok);
  sim.step(61);
  assert.ok(x.cast({ k: 'water.rain', pos: x.at }).ok, 'ready again after its hour');
  assert.equal(x.pool(), 0);
});

test('reach: free clay stays free, and an unbound world is the sandbox it always was', () => {
  const clay = new Sim({ seed: 3, scenario: 'barren', overrides: { n: 16 }, bound: true });
  for (const q of clay.u.planets) q.people.worship[0] = 0;
  const p0 = clay.u.planets[0];
  const at = [0, 0, 1];
  let r = clay.applyNow({ k: 'terrain.raise', pos: at, planet: p0.id } as never);
  assert.ok(r.ok, r.msg);
  r = clay.applyNow({ k: 'disaster.spawn', kind: 'quake', pos: at, planet: p0.id } as never);
  assert.ok(r.ok, `a world no one has lived on is free clay at any standing: ${r.msg}`);
  const open = new Sim({ seed: 5, scenario: 'shore', overrides: { n: 20 } });
  const x = ctx(open);
  assert.equal(open.u.god.bound, false);
  const w0 = x.ps.worship[0];
  r = x.cast({ k: 'miracle.food', pos: x.at });
  assert.ok(r.ok, r.msg);
  assert.ok(x.ps.worship[0] <= w0);
  assert.equal(powers(open)[0].priceNow, undefined);
  assert.equal(open.snapshot({ drain: false }).reach, undefined);
});

test('reach: no dead end. Empty pool and no believers: nothing refills; the free spells alone make believers; then the pool refills', () => {
  const sim = world(true, 11);
  const x = ctx(sim);
  x.clear();
  x.pool(0);
  // (1) no trickle: with no believers the pool does not refill by itself
  sim.step(3 * 1440);
  let v = sim.query('reach') as { believers: number; pool: number; following: number; standing: string };
  assert.equal(v.believers, 0);
  assert.equal(v.pool, 0, 'the pool cannot refill without believers');
  // (2) everything priced is refused; the free spells still work
  assert.equal(x.cast({ k: 'terrain.raise', pos: x.at }).ok, false);
  let cast = 0;
  for (let d = 0; d < 12 && (v.believers === 0 || v.pool <= 0); d++) {
    for (let h = 0; h < 4; h++) {
      for (const c of [{ k: 'settlement.gift', settlement: x.st.id, items: { bread: 6 } }, { k: 'water.rain', pos: [...x.st.pos] }, { k: 'miracle.lightning', pos: [...x.st.pos], wrath: 0.3 }]) if (x.cast(c).ok) cast++;
      assert.equal(x.pool() >= 0, true);
      sim.step(360);
    }
    v = sim.query('reach') as typeof v;
  }
  assert.ok(cast > 0);
  assert.ok(v.believers > 0, 'free spells alone made believers');
  assert.ok(v.pool > 0, `the people's giving refilled the pool (${v.pool})`);
  assert.notEqual(v.standing, 'Unknown');
  // (3) and with it a priced power is in reach again
  if (v.pool < 3) sim.step(2 * 1440);
  const r = x.cast({ k: 'terrain.raise', pos: x.at });
  assert.ok(r.ok, r.msg);
});
