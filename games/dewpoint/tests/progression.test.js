// Progression locks (owner's decision, 2026-11-24): levels open in order, and an element's road
// opens only when the road before it is finished - Water, then Fire, then Clay. A campaign with no
// levels yet is "coming soon". These drive the real Menus methods against the real campaigns.

import { test, assert, eq } from './lib/harness.js';
import { Menus } from '../src/ui/menus.js';
import { campaigns, ELEMENT_ORDER } from '../src/levels/index.js';

/** A Menus with only what the lock logic touches: the campaigns, the order and a save of done ids. */
function menus(done = [], element = 'water') {
  const set = new Set(done);
  const m = Object.create(Menus.prototype);
  m.api = {
    campaigns, order: ELEMENT_ORDER, element: () => element,
    save: { level: (id) => ({ done: set.has(id), shards: [], bestMs: 0 }), lastFor: () => null },
  };
  return m;
}
const ids = (e) => campaigns[e].levels.map((l) => l.id);

test('progression: a fresh save opens only Water level 1; Fire is locked behind Water; Clay is coming soon', () => {
  const m = menus();
  eq(m.elementLock('water'), null);
  eq(m.elementLock('fire'), { why: 'locked', after: 'water' });
  eq(m.elementLock('clay'), { why: 'soon' });
  assert(m.playable('water') && !m.playable('fire') && !m.playable('clay'));
  const w = ids('water');
  eq(w.map((_, i) => m.unlocked(i, 'water')), w.map((_, i) => i === 0), 'only the first Water level is open');
  eq(ids('fire').map((_, i) => m.unlocked(i, 'fire')), ids('fire').map(() => false), 'no Fire level is open, not even the first');
});

test('progression: finishing a level opens exactly the next one', () => {
  const w = ids('water');
  for (let n = 1; n < w.length; n++) {
    const m = menus(w.slice(0, n));
    eq(w.map((_, i) => m.unlocked(i, 'water')), w.map((_, i) => i <= n), `after ${n} levels`);
    assert(!m.playable('fire'), `Fire must stay locked with ${n} of ${w.length} Water levels done`);
  }
});

test('progression: Fire opens only when EVERY Water level is done, then follows its own order', () => {
  const w = ids('water'), f = ids('fire');
  for (const missing of [0, 5, w.length - 1]) {
    const m = menus(w.filter((_, i) => i !== missing));
    eq(m.elementLock('fire'), { why: 'locked', after: 'water' }, `Water level ${missing + 1} not done`);
  }
  let m = menus(w);
  eq(m.elementLock('fire'), null);
  eq(f.map((_, i) => m.unlocked(i, 'fire')), f.map((_, i) => i === 0), 'Fire starts with only its first level open');
  m = menus([...w, f[0], f[1]]);
  eq(f.map((_, i) => m.unlocked(i, 'fire')), f.map((_, i) => i <= 2));
  eq(m.elementLock('clay'), { why: 'soon' }, 'Clay stays "coming soon" until it has levels');
});

test('progression: Fire levels finished out of order (an old save) do not open Fire before Water is done', () => {
  const m = menus([...ids('fire')]);
  assert(!m.playable('fire'));
  eq(m.resume('water').level.id, 'l01');
});

test('progression: Continue goes to the first open unfinished level of the chosen road', () => {
  const w = ids('water');
  eq(menus().resume('water'), { level: campaigns.water.levels[0], fresh: true });
  eq(menus(w.slice(0, 4)).resume('water').level.id, w[4]);
  eq(menus(w).resume('fire').level.id, ids('fire')[0]);
});
