// POWERS-GROWTH review 3 (2026-11-16): the confirmed sim findings, one regression each. A bound world prices every size a
// cast can be made bigger by; the player-set cost law cannot make a bound power free; the founded are made people too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { REACH, credit, reachDaily } from '../src/sim/god/reach.ts';
import { world, ctx } from './reach-helpers.ts';

const price = (sim: Sim, id: string, extra: Record<string, unknown> = {}) => sim.query('reach.price', { id, ...extra }) as { priceNow: number; basePrice: number; size: number; cooldown: number };

test('review 3: a people set down is priced by head count, and the founded start with no regard', () => {
  const sim = world();
  const x = ctx(sim);
  // (a) the default 20 cost the price; 1 500 cost 75 x and are refused at the starting pool, nothing changed
  assert.equal(price(sim, 'people', { planet: x.p.id }).priceNow, 25);
  assert.equal(price(sim, 'people', { planet: x.p.id, count: 1500 }).priceNow, 25 * 75);
  const n0 = x.A.count;
  let r = x.cast({ k: 'life.spawn-people', settlement: x.st.id, count: 1500 });
  assert.equal(r.ok, false);
  assert.match(String(r.msg), /needs 1875 worship/);
  assert.equal(x.A.count, n0);
  assert.equal(x.pool(), REACH.start);
  // (b) founding: 12 is the default; 2 000 is refused; with the pool to pay, the founded are made people (0 / 0 / 0)
  assert.equal(price(sim, 'found', { planet: x.p.id, count: 24 }).priceNow, 10);
  const far = (() => { const v = [-x.at[1], x.at[0], x.at[2]]; const m = Math.hypot(v[0] + x.at[0] * 30, v[1] + x.at[1] * 30, v[2] + x.at[2] * 30); return [(v[0] + x.at[0] * 30) / m, (v[1] + x.at[1] * 30) / m, (v[2] + x.at[2] * 30) / m]; })();
  r = x.cast({ k: 'settlement.found', pos: x.at, species: 'plains-folk', count: 2000 });
  assert.equal(r.ok, false);
  assert.match(String(r.msg), /needs 833.33 worship/);
  let top = 0;
  for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s] && x.A.id[s] > top) top = x.A.id[s];
  for (const at of [far, x.at]) { r = x.cast({ k: 'settlement.found', pos: at, species: 'plains-folk', count: 12 }); if (r.ok) break; }
  assert.ok(r.ok, r.msg);
  assert.equal(x.pool(), REACH.start - 5);
  let made = 0;
  for (let s = 0; s < x.A.hi; s++) {
    if (!x.A.alive[s] || x.A.id[s] <= top) continue;
    made++;
    assert.equal(x.A.faith[s * 4], 0); assert.equal(x.A.love[s * 4], 0); assert.equal(x.A.fear[s * 4], 0);
  }
  assert.ok(made >= 12);
  // introduce a people: by qty against the 8 it sets down by default
  const one = price(sim, 'introduce-people', { planet: x.p.id }).priceNow;
  assert.equal(price(sim, 'introduce-people', { planet: x.p.id, people: 'plains-folk', qty: 80 }).priceNow, one * 10);
});

test('review 3: the cost law cannot make a bound power free; it only scales the Strict floor', () => {
  const sim = world();
  const x = ctx(sim);
  assert.equal(price(sim, 'cure', { planet: x.p.id }).priceNow, 4);
  assert.ok(x.cast({ k: 'set', path: 'restraint.costScale', value: 0 }).ok);
  assert.equal(price(sim, 'cure', { planet: x.p.id }).priceNow, 4);
  assert.equal(price(sim, 'cure', { planet: x.p.id }).basePrice, 4);
  x.pool(0);
  assert.equal(x.cast({ k: 'life.cure', settlement: x.st.id }).ok, false);
  // Strict: never less than the old cost x the law, never less than the price
  assert.ok(x.cast({ k: 'meta.reach', bound: true, strict: true }).ok);
  assert.equal(price(sim, 'cure', { planet: x.p.id }).priceNow, 4);
  assert.ok(x.cast({ k: 'set', path: 'restraint.costScale', value: 1 }).ok);
  assert.equal(price(sim, 'cure', { planet: x.p.id }).priceNow, 8);
});

test('review 3: the free plant rests after a cast and is priced by size; one tick of casts cannot fill a town', () => {
  const sim = world();
  const x = ctx(sim);
  const mean = () => { let f = 0; for (const i of x.grown) f += x.A.faith[i * 4]; return f / x.grown.length; };
  let n = 0;
  for (let i = 0; i < 300; i++) if (x.cast({ k: 'life.plant', pos: x.at }).ok) n++;
  assert.equal(n, 1);
  assert.ok(mean() < 0.3, `one plant does not make a town of believers (${mean()})`);
  assert.equal(price(sim, 'plant', { planet: x.p.id }).cooldown, REACH.freeCooldown.plant);
  assert.equal(price(sim, 'plant', { planet: x.p.id }).priceNow, 0);
  assert.ok(price(sim, 'plant', { planet: x.p.id, radius: 20000 }).priceNow > 200);
  assert.ok(price(sim, 'plant', { planet: x.p.id, everywhere: true }).priceNow > 200);
  sim.step(REACH.freeCooldown.plant);
  x.pool(0);
  assert.equal(x.cast({ k: 'life.plant', everywhere: true }).ok, false);
  assert.ok(x.cast({ k: 'life.plant', pos: x.at }).ok, 'at its own size it is free again after the rest');
  // the hurl is witnessed too: it rests as well
  assert.ok(REACH.freeCooldown.throw > 0);
});

test('review 3: the free basics are free at their own size only (gift units, rain length and weight, lightning wrath)', () => {
  const sim = world();
  const x = ctx(sim);
  x.pool(0);
  const bi = sim.u.content.items.idx('bread');
  const bread = () => Number(x.st.store[bi] ?? 0);
  const b0 = bread();
  let r = x.cast({ k: 'settlement.gift', settlement: x.st.id, items: { bread: 1000000 } });
  assert.equal(r.ok, false);
  assert.match(String(r.msg), /at this size needs/);
  assert.equal(bread(), b0);
  assert.equal(price(sim, 'gift', { planet: x.p.id, items: { bread: REACH.giftFree } }).priceNow, 0);
  assert.equal(price(sim, 'gift', { planet: x.p.id, items: { bread: 30, fish: 10 } }).priceNow, 6);
  assert.equal(x.cast({ k: 'water.rain', pos: x.at, duration: 1000000, intensity: 3 }).ok, false);
  assert.equal(price(sim, 'rain', { planet: x.p.id, duration: 1440, intensity: 2 }).priceNow, 12);
  assert.equal(x.cast({ k: 'miracle.lightning', pos: x.at, wrath: 1 }).ok, false);
  assert.equal(price(sim, 'lightning', { planet: x.p.id, wrath: 0.6 }).priceNow, 10);
  // the wrath law itself raised: the default stroke is no longer the free one
  assert.equal(price(sim, 'lightning', { planet: x.p.id }).priceNow, 0);
  assert.ok(x.cast({ k: 'set', path: 'god.wrath', value: 0.9 }).ok);
  assert.equal(price(sim, 'lightning', { planet: x.p.id }).priceNow, 15);
  assert.ok(x.cast({ k: 'set', path: 'god.wrath', value: 0.3 }).ok);
  // at their own size all three still cast with an empty pool (the no-dead-end guarantee)
  for (const c of [{ k: 'settlement.gift', settlement: x.st.id, items: { bread: 6 } }, { k: 'water.rain', pos: x.at }, { k: 'miracle.lightning', pos: x.at, wrath: 0.3 }]) {
    r = x.cast(c);
    assert.ok(r.ok, r.msg);
  }
  assert.equal(x.pool(), 0);
});

test('review 3: unbinding and binding again does not open the day\'s measure a second time', () => {
  const sim = world();
  const x = ctx(sim);
  for (const i of x.grown) x.set(i, 0.9, 0.9, 0);
  x.seen(); reachDaily(sim.u);
  const key = `${x.p.id}:${x.st.id}`;
  const m = sim.u.god.reach!.towns[key].m;
  assert.ok(m > 0);
  x.pool(0);
  let tot = 0;
  for (let k = 0; k < 5; k++) { tot += credit(sim.u, x.p, x.st.id, 1e6); x.cast({ k: 'meta.reach', bound: false }); x.cast({ k: 'meta.reach', bound: true }); }
  assert.ok(tot <= m + 1e-9, `${tot} paid against a measure of ${m}`);
});
