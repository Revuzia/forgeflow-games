// Save additions for the three elements (DESIGN-ELEMENTS.md "Save"): two optional fields, `element`
// and `lastBy`. An old water-only save must load with nothing lost, junk in the new fields must be
// tolerated, and nothing about the published v1 fields may change.

import { test, assert, eq } from './lib/harness.js';
import { createSave, sanitize, defaults, SAVE_KEY, SAVE_ELEMENTS } from '../src/save.js';

function memStore(initial) {
  const m = new Map(initial ? [[SAVE_KEY, initial]] : []);
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

// exactly what the v1 water-only build wrote after a few levels
const V1_SAVE = {
  v: 1,
  levels: {
    l01: { done: true, shards: [0, 1, 2], bestMs: 41250 },
    l02: { done: true, shards: [1], bestMs: 88010 },
    l03: { done: false, shards: [0], bestMs: 0 },
  },
  last: 'l03',
  settings: { music: 0.35, sfx: 0.9, muted: true, quality: 'low', invertY: true, sensitivity: 1.7, reducedMotion: true },
};

test('an old water-only save loads with nothing lost and nothing added', () => {
  const st = memStore(JSON.stringify(V1_SAVE));
  const s = createSave(st);
  eq(s.load(), V1_SAVE, 'loaded data is exactly the v1 data');
  eq(s.loadStatus, '');
  eq(s.element(), 'water', 'no element field means water');
  eq(s.lastFor('water'), 'l03', "a v1 save's `last` is Water's last level");
  eq(s.lastFor('fire'), ''); eq(s.lastFor('clay'), '');
  eq(s.level('l01'), { done: true, shards: [0, 1, 2], bestMs: 41250 });
  eq(s.totalShards(), 5);
  // rewriting it (any setting change) still writes only the v1 fields
  s.setSetting('music', 0.4);
  const back = JSON.parse(st.m.get(SAVE_KEY));
  eq(Object.keys(back).sort(), ['last', 'levels', 'settings', 'v']);
  eq(back.levels, V1_SAVE.levels); eq(back.last, 'l03');
});

test('a fresh save has the exact published shape: the new fields are optional and absent', () => {
  const s = createSave(memStore());
  eq(s.load(), defaults());
  eq(Object.keys(defaults()).sort(), ['last', 'levels', 'settings', 'v']);
  eq(s.element(), 'water'); eq(s.lastFor('water'), ''); eq(s.lastFor('fire'), '');
});

test('playing fire adds element and lastBy, keeps water progress, and `last` keeps its meaning', () => {
  const st = memStore(JSON.stringify(V1_SAVE));
  const a = createSave(st); a.load();
  eq(a.setElement('fire'), 'fire');
  a.setLast('f01', 'fire');
  a.recordLevel('f01', { shards: [2, 0], timeMs: 30500.6 });
  a.setLast('f02', 'fire');
  const b = createSave(st); b.load();
  eq(b.data.levels.l01, V1_SAVE.levels.l01, 'water results untouched');
  eq(b.data.levels.f01, { done: true, shards: [0, 2], bestMs: 30501 }, 'fire results live in the same levels map');
  eq(b.data.last, 'f02', '`last` is the last level played, any element');
  eq(b.data.element, 'fire'); eq(b.element(), 'fire');
  eq(b.data.lastBy, { fire: 'f02' });
  eq(b.lastFor('fire'), 'f02');
  eq(b.lastFor('water'), '', 'once lastBy exists, water needs its own entry');
  b.setLast('l02', 'water');
  eq(b.data.lastBy, { fire: 'f02', water: 'l02' }); eq(b.element(), 'water'); eq(b.data.last, 'l02');
  eq(b.shardsIn(['l01', 'l02', 'l03']), 5); eq(b.shardsIn(['f01', 'f02', 'f03']), 2); eq(b.totalShards(), 7);
  eq(b.settings, undefined); eq(b.data.settings, V1_SAVE.settings);
});

test('setLast without an element behaves exactly as in v1 (only `last` changes)', () => {
  const st = memStore();
  const s = createSave(st); s.load();
  s.setLast('l02');
  eq(Object.keys(JSON.parse(st.m.get(SAVE_KEY))).sort(), ['last', 'levels', 'settings', 'v']);
  s.setLast('f01', 'lava');            // unknown element: treated as none
  eq(s.data.lastBy, undefined); eq(s.data.element, undefined);
  s.setLast(42, 'fire'); eq(s.data.last, 'f01');
});

test('junk in the new fields is tolerated: dropped field by field, never thrown on, never copied through', () => {
  for (const junk of [null, 7, 'lava', 'Fire', '', [], {}, true, '__proto__', 'constructor']) {
    const d = sanitize({ ...V1_SAVE, element: junk });
    eq('element' in d, false, `element ${JSON.stringify(junk)} must be dropped`);
    eq(d.levels, V1_SAVE.levels);
  }
  for (const e of SAVE_ELEMENTS) eq(sanitize({ element: e }).element, e);
  for (const junk of [null, 7, 'f01', [], ['f01'], true]) eq('lastBy' in sanitize({ ...V1_SAVE, lastBy: junk }), false, `lastBy ${JSON.stringify(junk)}`);
  const d = sanitize(JSON.parse('{"lastBy":{"water":"l04","fire":12,"clay":null,"lava":"x01","__proto__":{"fire":"f09"},"constructor":"x"},"element":"fire"}'));
  eq(d.lastBy, { water: 'l04' }, 'only valid element keys with string ids survive');
  eq(d.element, 'fire');
  eq({}.fire, undefined, 'Object.prototype must not be polluted');
  eq(sanitize({ lastBy: { fire: '' } }).lastBy, undefined, 'an empty id is no id');
  eq(sanitize({ lastBy: { fire: 'x'.repeat(65) } }).lastBy, undefined, 'an absurdly long id is dropped');
  eq(sanitize({ lastBy: { fire: '__proto__' } }).lastBy, undefined);
  const s = createSave(memStore(JSON.stringify({ ...V1_SAVE, element: { a: 1 }, lastBy: 'nope' })));
  s.load();
  eq(s.element(), 'water'); eq(s.lastFor('fire'), ''); eq(s.lastFor('water'), 'l03');
  eq(s.setElement('lava'), 'water', 'an unknown element is not stored'); eq(s.data.element, undefined);
});

test('lookups are safe for any argument', () => {
  const s = createSave(memStore(JSON.stringify({ lastBy: { fire: 'f02' }, last: 'f02' }))); s.load();
  for (const k of ['lava', '', undefined, null, 3, '__proto__', 'constructor', 'toString']) eq(s.lastFor(k), '', `lastFor(${String(k)})`);
  eq(s.shardsIn([]), 0); eq(s.shardsIn(['nope', '__proto__']), 0);
});

test('a save written now keeps every v1 field with its v1 type, so a reader that ignores the new fields is unaffected', () => {
  const st = memStore();
  const s = createSave(st); s.load();
  s.setElement('fire'); s.setLast('f03', 'fire'); s.recordLevel('f03', { shards: [1], timeMs: 9000 });
  const raw = JSON.parse(st.m.get(SAVE_KEY));
  eq(raw.v, 1);
  assert(typeof raw.last === 'string' && raw.last === 'f03');
  for (const l of Object.values(raw.levels)) {
    eq(Object.keys(l).sort(), ['bestMs', 'done', 'shards']);
    assert(typeof l.done === 'boolean' && Array.isArray(l.shards) && typeof l.bestMs === 'number');
  }
  eq(Object.keys(raw.settings).sort(), Object.keys(defaults().settings).sort());
  eq(Object.keys(raw).sort(), ['element', 'last', 'lastBy', 'levels', 'settings', 'v']);
});

test('resetProgress forgets every campaign but keeps settings and the chosen element', () => {
  const s = createSave(memStore()); s.load();
  s.setLast('f02', 'fire'); s.recordLevel('f01', { shards: [0], timeMs: 5 }); s.setSetting('sfx', 0.1);
  s.resetProgress();
  eq(s.data.levels, {}); eq(s.data.last, ''); eq(s.data.lastBy, undefined);
  eq(s.element(), 'fire'); eq(s.data.settings.sfx, 0.1); eq(s.lastFor('fire'), '');
});
