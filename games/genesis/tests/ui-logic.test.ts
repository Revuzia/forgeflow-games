// GENESIS — the UI's logic in Node (UI lane; CONTRACT §16, §19): the palette's fuzzy matching, the gesture recogniser,
// the keybind registry (defaults without conflicts, rebinding, conflicts found), and that EVERY power of powers.json is
// reachable from the UI: it has a tool mode, an icon, and the command the tool card would send for it is accepted by
// the real command registry (schema validation: no unknown parameters, every value in range).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzy, fuzzyAny, highlight } from '../src/ui/fuzzy.ts';
import { Unistroke, SHAPES, type Pt } from '../src/ui/unistroke.ts';
import { Keybinds, ACTIONS, comboOf, comboLabel } from '../src/ui/keybinds.ts';
import { PowerBook, toolMode, buildCommand, defaultValue, missingRequired, entityKey, isSelector, CATEGORIES, type Power } from '../src/ui/powers.ts';
import { placeWords, humanize, tollOf, stripYear, fmtDuration, unitOf, latLonText, areaText } from '../src/ui/words.ts';
import { hasIcon, categoryIcon } from '../src/ui/icons.ts';
import { town } from './helpers/god.ts';

test('fuzzy: exact names first, words in any order, synonyms count, misses are null', () => {
  const names = ['Rain', 'Acid rain', 'Blood rain', 'Rain strength', 'Drain', 'Raise land'];
  const ranked = names.map((n) => ({ n, s: fuzzy('rain', n)?.score ?? -Infinity })).sort((a, b) => b.s - a.s);
  assert.equal(ranked[0].n, 'Rain');
  assert.ok(fuzzy('blood rain', 'Blood rain'), 'two words');
  assert.ok(fuzzy('rain blood', 'Blood rain'), 'any order');
  assert.ok(fuzzy('rsl', 'Raise land'), 'initials as a subsequence');
  assert.equal(fuzzy('xyz', 'Rain'), null);
  const s = fuzzyAny('quake', 'Earthquake', ['shake the ground']);
  assert.ok(s && s.score > 0);
  const viaSyn = fuzzyAny('tremor', 'Earthquake', ['tremor', 'quake']);
  assert.equal(viaSyn?.via, 'tremor');
  assert.equal(highlight('Rain', [0, 1]), '<mark>Ra</mark>in');
});

test('gestures: every shape is recognised drawn larger, smaller, tilted, backwards and unevenly', () => {
  const u = new Unistroke();
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let ok = 0, n = 0;
  const misses: string[] = [];
  for (const [name, pts] of Object.entries(SHAPES)) {
    for (let t = 0; t < 12; t++) {
      const s = 0.4 + rnd() * 1.8, a = (rnd() - 0.5) * 0.3, sy = s * (0.8 + rnd() * 0.4);
      let p: Pt[] = pts.map(([x, y]) => [x * s * Math.cos(a) - y * sy * Math.sin(a) + 500 + (rnd() - 0.5) * 6, x * s * Math.sin(a) + y * sy * Math.cos(a) + 400 + (rnd() - 0.5) * 6] as Pt);
      if (rnd() < 0.5) p = p.reverse();
      p = p.filter(() => rnd() > 0.2);
      const r = u.recognize(p);
      n++;
      if (r?.name === name) ok++; else misses.push(`${name}→${r?.name}`);
    }
  }
  assert.ok(ok / n >= 0.95, `recognised ${ok}/${n}: ${misses.join(', ')}`);
  // a V and a caret are the same stroke turned over: orientation matters
  assert.equal(u.recognize(SHAPES.v)?.name, 'v');
  assert.equal(u.recognize(SHAPES.caret)?.name, 'caret');
  // a scribble too short to mean anything
  assert.equal(u.recognize([[0, 0], [1, 1], [2, 2]]), null);
});

test('gestures: every gesture a power uses has a shape', () => {
  const book = new PowerBook();
  for (const g of book.gestures().keys()) assert.ok(SHAPES[g], `no template for gesture '${g}'`);
  assert.ok(book.gestures().size >= 14);
});

test('keybinds: the defaults have no conflicts; a rebinding that collides is found; bindings persist', () => {
  const mem = new Map<string, unknown>();
  const storage = { get: <T>(k: string, d: T) => (mem.has(k) ? mem.get(k) as T : d), set: (k: string, v: unknown) => { mem.set(k, JSON.parse(JSON.stringify(v))); } };
  const kb = new Keybinds(storage);
  assert.deepEqual(kb.conflicts(), [], 'default keys conflict');
  // every action is listed once, and every press action has a key or a pad button by default
  assert.equal(new Set(ACTIONS.map((a) => a.id)).size, ACTIONS.length);
  for (const a of ACTIONS) assert.ok(a.keys.length || (a.pad ?? []).length, `${a.id} has no default binding`);
  // rebinding the chronicle to Q (the radial's hold key) conflicts
  kb.setKey('ui.chronicle', 0, 'KeyQ');
  const c = kb.conflictsOf('ui.chronicle');
  assert.ok(c.includes('ui.radial'), `conflicts: ${c}`);
  // persisted: a new registry over the same storage has the rebinding
  const kb2 = new Keybinds(storage);
  assert.deepEqual(kb2.keysOf('ui.chronicle'), ['KeyQ']);
  kb2.reset('ui.chronicle');
  assert.deepEqual(kb2.keysOf('ui.chronicle'), ['KeyC']);
  // combos
  const ev = { code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
  assert.equal(comboOf(ev), 'Ctrl+KeyK');
  assert.deepEqual(kb2.pressActions(ev), ['ui.palette']);
  assert.equal(comboLabel('Shift+Period'), '⇧ .');
  // hold keys run with Shift held (faster camera), not with Ctrl
  assert.deepEqual(kb2.holdActions({ code: 'KeyW', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false }), ['cam.forward']);
  assert.deepEqual(kb2.holdActions({ code: 'KeyW', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), []);
  assert.ok(kb2.modifierDown('hand.slapMod', { altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }));
});

test('powers: every power has a tool mode, an icon and a category the radial shows', () => {
  const book = new PowerBook();
  assert.ok(book.list.length >= 196, `${book.list.length} powers`);
  for (const p of book.list) {
    assert.ok(toolMode(p), p.id);
    assert.ok(hasIcon(p.icon), `power '${p.id}' has no icon '${p.icon}'`);
    assert.ok(CATEGORIES.includes(p.category), `power '${p.id}': category '${p.category}' is not on the radial`);
  }
  for (const c of CATEGORIES) assert.ok(categoryIcon(c).includes('<path') || categoryIcon(c).includes('<circle'), c);
});

/** a value for a required parameter the card would ask the player to type */
function fillRequired(k: string, type: string, pos: number[]): unknown {
  const words: Record<string, unknown> = { name: 'Test', path: 'planet.gravity', to: 'Bo', text: 'rain', substance: 'chocolate', from: 'east', species: 'wolf', value: 3, cmd: { k: 'water.rain', pos }, items: [{ item: 'bread', qty: 5 }], tags: ['food'] };
  if (k in words) return words[k];
  return type === 'number' || type === 'int' ? 1 : type === 'boolean' ? true : 'x';
}

test('powers: the command the tool card sends for every power is accepted by the sim', () => {
  const { sim, st } = town();
  const u = sim.u;
  const p0 = u.planets[0];
  // things to aim at: the town, one of its people, a creature, a live disaster
  const pos = [...st.pos];
  const A = p0.people.agents;
  let agent = -1;
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) { agent = A.id[s]; break; }
  assert.ok(agent >= 0);
  const cr = sim.applyNow({ k: 'creature.adopt', template: 'ape', pos });
  const creature = cr.created?.find((e) => e.kind === 'creature')?.id ?? 1;
  const ds = sim.applyNow({ k: 'disaster.spawn', kind: 'quake', pos });
  const disaster = ds.created?.find((e) => e.kind === 'disaster')?.id ?? 1;
  const ids: Record<string, unknown> = { settlement: st.id, agent, creature, disaster, planet: p0.id, ship: 1, god: 1, building: p0.people.buildings[0]?.id ?? 1, animal: 1 };
  const book = new PowerBook();
  // as the App does: the commands' own schemas say what each power's command requires
  book.setCommands(sim.query('commands'));
  const failures: string[] = [];
  for (const p of book.list) {
    const values: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(p.schema)) {
      if (s.type === 'pos' || s.type === 'entity' || s.type === 'vec3') continue;
      const v = p.params[k] !== undefined ? p.params[k] : defaultValue(k, s);
      if (v !== undefined) values[k] = v;
    }
    for (const k of missingRequired(p, values)) values[k] = fillRequired(k, p.schema[k].type, pos);
    // what the pointer would pick: a place, a second place, and the things the power takes
    const refs: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(p.schema)) {
      if (s.type !== 'entity') continue;
      const kind = (s.entity ?? [])[0];
      if (k === 'target' && (s.cmdType === 'any' || s.cmdType === undefined)) refs.target = { kind: 'agent', id: agent };
      else if (kind && ids[kind] !== undefined) refs[k] = ids[kind];
    }
    if (entityKey(p, 'settlement') && p.schema.other) refs.other = st.id;
    const hit = { planet: p0.id, dir: pos };
    const there = { planet: p0.id, dir: [pos[0] * 0.99 + 0.01, pos[1], pos[2]] };
    const mode = toolMode(p);
    const place = mode === 'instant' || mode === 'world' || mode === 'settlement' || mode === 'agent' || mode === 'entity'
      ? { refs, planet: p0.id, hit: p.schema.pos ? hit : null }
      : { hit, to: p.schema.to ? there : null, toward: p.schema.toward ? there : null, refs };
    const c = buildCommand(p as Power, values, place, 200, p0.id);
    const v = sim.registry.validate(u, c);
    if (!v.ok) failures.push(`${p.id} (${mode}): ${v.msg}`);
  }
  assert.deepEqual(failures, [], `${failures.length} powers send commands the sim refuses:\n${failures.join('\n')}`);
});

test('words: places by the nearest town, durations in hours, the year a header already says, the toll of an act', () => {
  const aru = unitOf(10, 20);
  const view = { planet: (id: number) => (id === 0 ? { id: 0, params: { radius: 3000, dayHours: 24 }, settlements: [{ id: 1, name: 'Aru', pos: aru, flags: 0 }, { id: 2, name: 'Old Bo', pos: unitOf(-40, 100), flags: 2 }] } : undefined) };
  assert.equal(placeWords(view, 0, aru).text, 'at Aru');
  assert.equal(placeWords(view, 0, unitOf(10, 50)).text, '1.5 km east of Aru');
  assert.equal(placeWords(view, 0, unitOf(20, 20)).kind, 'near');
  // "here" on a town is the town; "here" in the wilds is "here"
  assert.equal(placeWords(view, 0, aru, { planet: 0, dir: aru }).text, 'at Aru');
  assert.equal(placeWords(view, 0, unitOf(60, 150), { planet: 0, dir: unitOf(60, 150) }).text, 'here');
  // a fallen town names nothing; a world with no town keeps coordinates
  assert.equal(placeWords({ planet: () => ({ id: 0, params: { radius: 3000 }, settlements: [] }) }, 0, aru).kind, 'coords');
  assert.equal(latLonText(unitOf(-12, -34)), '12°S 34°W');
  // the sim's lines, for people
  assert.equal(humanize(view, 0, `Rain gathers at ${latLonText(unitOf(10, 20))}.`), 'Rain gathers at Aru.');
  assert.match(humanize(view, 0, `Blood rain at ${latLonText(unitOf(20, 20))}.`), /^Blood rain near Aru\.$/);
  assert.equal(humanize(view, 0, 'Tornado on Aru (243 minutes).'), 'Tornado on Aru (4 h).');
  assert.equal(humanize(view, 0, 'You hurl the agent (16 m/s).', { name: 'Kek' }), 'You hurl Kek (16 m/s).');
  assert.equal(humanize(view, 0, 'You set the agent down gently.'), 'You set them down gently.');
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(36 * 60), '1.5 days');
  assert.equal(stripYear('Year 4. Meteor shower over Selene.'), 'Meteor shower over Selene.');
  assert.equal(stripYear('A quiet year.'), 'A quiet year.');
  assert.deepEqual(tollOf('Lightning strikes on Kibahaath by the Lake: 44 killed.'), { dead: 44, ruined: 0 });
  assert.deepEqual(tollOf('The meteor falls: 12 dead, 7 buildings ruined.'), { dead: 12, ruined: 7 });
  assert.deepEqual(tollOf('Rain begins.'), { dead: 0, ruined: 0 });
  assert.equal(humanize(view, 0, 'Meteor on Aru (138.89 days).'), 'Meteor on Aru (139 days).');
  // a world nobody lives on yet: its name says where (a heading keeps its coordinates); cells read as an area
  const empty = { planet: () => ({ id: 0, name: 'Cinder', grid: { count: 40962 }, params: { radius: 3000 }, settlements: [] }) };
  assert.equal(humanize(empty, 0, 'Meadow grass planted at 27°N 177°W (31047 cells).'), 'Meadow grass planted on Cinder (86 km²).');
  assert.equal(humanize(empty, 0, 'The storm is moved to 27°N 177°W.'), 'The storm is moved to 27°N 177°W.');
  assert.equal(areaText(5000), '5,000 m²');
  assert.equal(areaText(4e5), '40 ha');
  assert.equal(areaText(2.34e6), '2.3 km²');
  assert.equal(areaText(1.5e9), '1,500 km²');
});

test('powers: moving a thing is one pick and one place; a filter enum on a power that picks a thing stays unset', () => {
  const book = new PowerBook();
  const move = book.get('move-disaster')!;
  assert.equal(toolMode(move), 'move', 'the line target of `to` does not make a disaster move a two-click line');
  assert.equal(isSelector(move, 'kind'), true, 'which kind of disaster to move is a filter');
  const star = book.get('star-kind');
  if (star) assert.equal(isSelector(star, 'kind'), false, 'the star\'s kind is the value being set');
  const c = buildCommand(move, {}, { refs: { id: 7 }, to: { planet: 0, dir: [0, 1, 0] } }, null, 0);
  assert.equal(c.id, 7);
  assert.deepEqual(c.to, [0, 1, 0]);
  assert.equal(c.kind, undefined);
});
