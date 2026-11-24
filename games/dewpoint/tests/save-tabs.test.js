// Two tabs on one save (src/save.js): neither tab's progress may be lost to the other's last write.
// Each store below is a separate createSave() on ONE shared storage - exactly two browser tabs of the game.

import { test, assert, eq } from './lib/harness.js';
import { createSave, SAVE_KEY } from '../src/save.js';

function sharedStore() {
  const m = new Map(), listeners = [];
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); for (const l of listeners) l(k, String(v)); },
    removeItem: (k) => m.delete(k),
    raw: () => JSON.parse(m.get(SAVE_KEY)),
    listeners,
  };
}
/** Two tabs, both loaded before either plays. */
function twoTabs() {
  const st = sharedStore();
  const a = createSave(st), b = createSave(st);
  a.load(); b.load();
  return { st, a, b };
}

test('two tabs: progress made in each survives the other writing last (done, collectibles, best time)', () => {
  const { st, a, b } = twoTabs();
  a.recordLevel('l01', { shards: [0], timeMs: 90000 });
  b.recordLevel('l02', { shards: [2], timeMs: 80000 });              // b never saw a's write before this
  b.recordLevel('l01', { shards: [1], timeMs: 95000 });              // same level, other shard, slower
  const s = st.raw();
  eq(s.levels.l01, { done: true, shards: [0, 1], bestMs: 90000 }, 'l01: done, both shards, the faster time');
  eq(s.levels.l02, { done: true, shards: [2], bestMs: 80000 });
  a.setSetting('music', 0.3);                                       // a writes again: must not drop b's l02
  eq(Object.keys(st.raw().levels).sort(), ['l01', 'l02']);
  eq(a.level('l02').shards, [2], 'and a now knows about it too');
});

test('two tabs: a setting changed in one tab is not reverted by the other tab writing progress', () => {
  const { st, a, b } = twoTabs();
  a.setSetting('invertY', true);
  b.recordLevel('f01', { shards: [], timeMs: 61000 });
  eq(st.raw().settings.invertY, true, "b's write kept a's setting");
  b.setSetting('sfx', 0.2);
  const s = st.raw().settings;
  eq([s.invertY, s.sfx], [true, 0.2], 'each tab\'s own change wins for that setting');
});

test('two tabs: the last level and element are the most recent choice, whichever tab made it', () => {
  const { st, a, b } = twoTabs();
  a.setLast('l03', 'water');
  b.setLast('f02', 'fire');
  a.recordLevel('l03', { shards: [0], timeMs: 1000 });               // a writes again without choosing anything
  const s = st.raw();
  eq([s.last, s.element, s.lastBy.water, s.lastBy.fire], ['f02', 'fire', 'l03', 'f02']);
});

test('two tabs: a reset in one tab is not undone by the other tab still holding the old progress', () => {
  const { st, a, b } = twoTabs();
  a.recordLevel('l01', { shards: [0, 1, 2], timeMs: 5000 });
  b.sync();
  eq(b.level('l01').done, true, 'b synced the progress');
  a.resetProgress();
  b.setSetting('music', 0.1);                                       // b writes with its stale copy of l01
  eq(st.raw().levels, {}, 'the reset stands');
  eq(b.level('l01').done, false, 'and b dropped its stale copy');
  b.recordLevel('l02', { shards: [1], timeMs: 3000 });              // new progress after the reset is kept
  a.setSetting('sfx', 0.5);
  eq(Object.keys(st.raw().levels), ['l02']);
});

test('two tabs: listen() merges the other tab\'s writes as they happen (storage event)', () => {
  const st = sharedStore();
  const a = createSave(st), b = createSave(st);
  a.load(); b.load();
  const handlers = [];
  const target = { addEventListener: (t, fn) => { if (t === 'storage') handlers.push(fn); } };
  let changed = 0;
  b.listen(target, () => { changed++; });
  st.listeners.push((key, value) => { for (const h of handlers) h({ key, newValue: value }); });   // the browser fires it in the OTHER tab
  a.recordLevel('f03', { shards: [2], timeMs: 7000 });
  eq(b.level('f03'), { done: true, shards: [2], bestMs: 7000 }, 'b sees a\'s progress without reloading');
  assert(changed >= 1, 'and is told so (the title screen redraws)');
  for (const h of handlers) h({ key: 'something.else', newValue: '{}' });
  for (const h of handlers) h({ key: SAVE_KEY, newValue: 'not json' });
  eq(b.level('f03').done, true, 'junk and other keys are ignored');
});

test('two tabs: the save key and the meaning of every field are unchanged (only resetAt is added, after a reset)', () => {
  const { st, a } = twoTabs();
  a.recordLevel('l01', { shards: [0], timeMs: 1 });
  const s = st.raw();
  eq(Object.keys(s).sort(), ['last', 'levels', 'settings', 'v'].sort());
  a.resetProgress();
  assert(typeof st.raw().resetAt === 'number', 'resetAt stamps a reset');
  eq(SAVE_KEY, 'dewpoint.save.v1');
});
