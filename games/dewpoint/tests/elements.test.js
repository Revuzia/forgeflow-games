// Elements are data (src/sim/elements/): the registry, the schema every definition must satisfy,
// Water re-expressed with the numbers it always had, the level `element` field, and the
// "press the button of the form you are in = its special" input path.
// The engine itself must never name a form or an element: that is checked here too.

import { test, assert, eq, throws, near } from './lib/harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Sim } from '../src/sim/sim.js';
import { PIECE_TYPES } from '../src/sim/level.js';
import { FORMS, FORM_NAMES, STEAM_MAX, STEAM_REFILL, STEAM_MIN_START, LIQUID_WIND_FACTOR, LIQUID_UPDRAFT_ACCEL, WATER_FLOAT_DEPTH } from '../src/sim/constants.js';
import { ELEMENTS, ELEMENT_IDS, DEFAULT_ELEMENT, ALL_FORMS, getElement, formDef, elementOfForm, allPieceTypes } from '../src/sim/elements/index.js';
import { mini, run } from './lib/mini.js';
import { frun, fmini } from './lib/fire.js';
import l01 from '../src/levels/l01.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('registry: water and fire are registered, water is the default, lookups are safe', () => {
  eq(ELEMENT_IDS.slice(0, 2), ['water', 'fire']);
  eq(DEFAULT_ELEMENT, 'water');
  eq(getElement(undefined), ELEMENTS.water); eq(getElement(null), ELEMENTS.water);
  eq(getElement('fire'), ELEMENTS.fire);
  for (const bad of ['', 'Water', 'lava', 7, {}, '__proto__', 'constructor', 'toString']) eq(getElement(bad), null, `getElement(${JSON.stringify(bad)})`);
  eq(formDef('blaze'), ELEMENTS.fire.formDefs.blaze); eq(formDef('nope'), null); eq(formDef('__proto__'), null);
  eq(elementOfForm('film'), 'water'); eq(elementOfForm('spark'), 'fire'); eq(elementOfForm('constructor'), null);
});

test('schema: every element has four uniquely named forms, a default that spends nothing, a gauge, and pieces it can build', () => {
  const seen = new Set();
  for (const id of ELEMENT_IDS) {
    const E = ELEMENTS[id];
    eq(E.id, id);
    for (const k of ['name', 'hero', 'campaign']) assert(typeof E[k] === 'string' && E[k], `${id}.${k}`);
    eq(E.forms.length, 4, `${id}: four form buttons`);
    assert(E.forms.includes(E.defaultForm));
    assert(!E.formDefs[E.defaultForm].drain, `${id}: the default form must not drain the gauge`);
    assert(E.gauge.max > 0 && E.gauge.start <= E.gauge.max && E.gauge.refill >= 0);
    for (const f of E.forms) {
      assert(!seen.has(f), `form name ${f} is used by two elements`); seen.add(f);
      const F = E.formDefs[f];
      assert(F.r > 0 && F.h > 0 && F.speed > 0 && ['walk', 'slide', 'float'].includes(F.move), `${id}.${f} basics`);
      assert(F.step !== undefined && F.airStep !== undefined, `${id}.${f}: step and airStep (0 is fine)`);
      if (F.move === 'walk') for (const k of ['accel', 'decel', 'airAccel', 'airDecel']) assert(F[k] > 0, `${id}.${f}.${k}`);
      if (F.move === 'slide') for (const k of ['accel', 'friction', 'airAccel', 'maxSpeed', 'launchMin', 'waterGravity']) assert(F[k] > 0, `${id}.${f}.${k}`);
      if (F.move === 'float') for (const k of ['accel', 'drag', 'rise', 'riseAccel', 'windAccel']) assert(F[k] > 0, `${id}.${f}.${k}`);
      if (F.drain) assert(F.minStart > 0 && F.minStart < E.gauge.max, `${id}.${f}: a draining form needs minStart`);
      if (F.special) assert(typeof E.specials[F.special] === 'function', `${id}.${f}: special ${F.special}`);
      if (F.floats) assert(F.floatDepth > 0);
      eq(ALL_FORMS[f], F);
    }
    // every piece a level may use is either shared or built by one of the element's packs
    for (const t of E.pieces) assert(PIECE_TYPES.includes(t) || E.packs.some((k) => k.types.includes(t)), `${id}: nothing builds piece "${t}"`);
    for (const k of E.packs) for (const fn of ['init', 'build']) assert(typeof k[fn] === 'function', `${id}: pack ${k.name} needs ${fn}()`);
  }
  for (const t of PIECE_TYPES) assert(allPieceTypes().includes(t));
});

test('water: the definition carries exactly the v1 numbers, plus flags', () => {
  const W = ELEMENTS.water;
  eq(W.forms, FORM_NAMES);
  eq(W.defaultForm, 'liquid');
  eq(W.gauge, { name: 'steam', max: STEAM_MAX, start: STEAM_MAX, refill: STEAM_REFILL });
  for (const f of FORM_NAMES) for (const [k, v] of Object.entries(FORMS[f])) eq(W.formDefs[f][k], v, `water.${f}.${k}`);
  eq(W.formDefs.steam.drain, 1); eq(W.formDefs.steam.minStart, STEAM_MIN_START);
  eq(W.formDefs.liquid.windCarry, LIQUID_WIND_FACTOR); eq(W.formDefs.liquid.updraftAccel, LIQUID_UPDRAFT_ACCEL);
  eq(W.formDefs.liquid.floatDepth, WATER_FLOAT_DEPTH.liquid); eq(W.formDefs.film.floatDepth, WATER_FLOAT_DEPTH.film);
  eq(FORM_NAMES.map((f) => W.formDefs[f].move), ['walk', 'slide', 'float', 'walk']);
  eq(W.pieces, PIECE_TYPES); eq(W.packs, []); eq(W.specials, {});
  eq(W.kilnFire, 'kill');
  for (const f of FORM_NAMES) assert(!W.formDefs[f].special, 'water defines no specials');
});

test('level.element: defaults to water, selects the hero, and unknown values fail loudly', () => {
  const w = new Sim(mini());
  eq(w.element.id, 'water'); eq(w.player.form, 'liquid'); eq(w.player.gauge, STEAM_MAX); eq(w.level.forms, FORM_NAMES);
  eq(new Sim({ ...l01 }).element.id, 'water', 'a published water level has no element field');
  eq(l01.element, undefined);
  const f = new Sim(fmini());
  eq(f.element.id, 'fire'); eq(f.player.form, 'ember'); eq(f.player.gauge, 10); eq(f.level.forms, ['ember', 'blaze', 'smoke', 'spark']);
  near(f.player.r, 0.30, 1e-12); near(f.player.h, 0.56, 1e-12);
  throws(() => new Sim(mini([], { element: 'lava' })), /unknown element "lava". Known: water, fire/);
  throws(() => new Sim(fmini([], { forms: ['blaze'] })), /must include "ember"/);
  throws(() => new Sim(fmini([], { forms: ['ember', 'ice'] })), /unknown form "ice"/);
  throws(() => new Sim(mini([], { forms: ['liquid', 'ember'] })), /unknown form "ember"/);
});

test('level.startGauge: optional, validated, used at the start and on a respawn without a brazier', () => {
  const r = frun([], { startGauge: 3 });
  eq(r.p.gauge, 3);
  r.restart(); eq(r.p.gauge, 3);
  throws(() => new Sim(fmini([], { startGauge: 11 })), /startGauge must be a number from 0 to 10/);
  throws(() => new Sim(fmini([], { startGauge: -1 })), /startGauge/);
  throws(() => new Sim(fmini([], { startGauge: '5' })), /startGauge/);
});

test('pieces belong to elements: fire pieces are refused in a water level and the other way round', () => {
  throws(() => new Sim(mini([{ type: 'pool', box: [4, 0, -1, 6, 0.5, 1] }])), /"pool" is not a piece Water levels can use/);
  throws(() => new Sim(mini([{ type: 'wood', box: [4, 0, -1, 6, 1, 1] }])), /"wood" is not a piece Water levels can use/);
  for (const piece of [{ type: 'crate', pos: [4, 0, 0] }, { type: 'ember', box: [4, 0, -1, 6, 1, 1] }, { type: 'sprout', pos: [4, 0, 0] },
    { type: 'electrodes', box: [4, 0, 0, 5.4, 0.4, 1], emit: 'e' }, { type: 'hotfloor', box: [4, 0, -1, 6, 0.3, 1] }]) {
    throws(() => new Sim(fmini([piece])), new RegExp(`"${piece.type}" is not a piece Fire levels can use`));
  }
  throws(() => new Sim(fmini([{ type: 'blok', box: [0, 0, 0, 1, 1, 1] }])), /unknown type/);
  eq(PIECE_TYPES.length, 25, 'the shared piece list is unchanged');
});

test('special: pressing the button of the current form does nothing at all for water', () => {
  const r = run();
  const before = r.sim.fingerprint();
  const n0 = r.events.length;
  r.tick(0, 0, false, 'liquid');
  eq(r.events.slice(n0).filter((e) => e.type !== 'sfx' || e.name !== 'x').length, 0, 'no event of any kind');
  r.form('ice');
  const n1 = r.events.length;
  r.tick(0, 0, false, 'ice'); r.tick(0, 0, false, 'ice');
  eq(r.events.slice(n1).length, 0);
  eq(r.p.form, 'ice');
  assert(before !== undefined);
});

test('special: pressing the button of the current form fires its special, with an event; a refusal is a denied cue', () => {
  const r = frun();
  r.tick(0, 0, false, 'ember');
  eq(r.events.filter((e) => e.type === 'special' || e.type === 'denied').length, 0, 'ember has no special: nothing happens');
  r.form('blaze');
  const g = r.p.gauge;
  r.special();
  const ev = r.events.filter((e) => e.type === 'special');
  eq(ev.length, 1); eq(ev[0].name, 'flare'); eq(ev[0].form, 'blaze');
  assert(r.p.gauge < g - 1.9, 'the flare cost heat');
  r.special({ expect: false });                                   // still in the air: refused
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'special');
  eq(r.sfx().filter((n) => n === 'denied').length, 1);
});

test('the engine core names no form and no element', () => {
  for (const f of ['sim.js', 'collide.js', 'level.js', 'signals.js', 'piecetypes.js']) {
    const text = readFileSync(path.join(root, 'src', 'sim', f), 'utf8');
    const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/\bFORMS\b|FORM_NAMES|STEAM_|LIQUID_|WATER_FLOAT/.test(code), `${f} still reads the water constants`);
    for (const n of Object.keys(ALL_FORMS)) {
      // ('ember' is also a shared piece type in the loader: `case 'ember'` and `type === 'ember'` are not forms)
      const re = new RegExp(`===?\\s*'${n}'|'${n}'\\s*===?|\\.${n}\\b(?!\\s*[:(])|\\[\\s*'${n}'\\s*\\]`);
      const hits = code.split('\n').filter((l) => re.test(l) && !/case '|def\.type|\.type === 'ember'/.test(l));
      eq(hits, [], `${f} names the form "${n}"`);
    }
    // (env.water / env.fire are the substances the hero stands in, and 'water' / 'fire' are respawn causes)
    for (const n of ELEMENT_IDS) assert(!new RegExp(`(element|\\.id|E)\\s*[!=]==?\\s*'${n}'`).test(code), `${f} tests for the element "${n}"`);
  }
  // packs react to flags too
  for (const f of ['hazards.js', 'fire.js']) {
    const text = readFileSync(path.join(root, 'src', 'sim', 'packs', f), 'utf8');
    for (const n of Object.keys(ALL_FORMS)) assert(!new RegExp(`form\\s*[!=]==?\\s*'${n}'`).test(text), `packs/${f} tests for form "${n}"`);
  }
});
