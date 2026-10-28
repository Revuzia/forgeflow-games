// GENESIS — the people and their god as the interface reads them (UI lane; LIVING.md §3, hooks H2–H5, H9, H12): the
// words for the four values and the regard bands, the wrath words matching the free text's size words, the prayers in
// order of need and their one-click answer (on the real sim), the tool card's wrath on every harmful power (left at the
// world's law: nothing sent), the god's keys free of conflicts, and the Signs ring holding what the creature's held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regardBand, meterWord, regardSentence, openPrayers, answerCommand, foretellSays, FORETELL, OMEN_NAMES, prophetState } from '../src/ui/living.ts';
import { PowerBook, wrathWord, castValues, autoWords, fmtParam, WRATH_DEFAULT, oreRows } from '../src/ui/powers.ts';
import { ACTIONS, Keybinds } from '../src/ui/keybinds.ts';
import { wrathWords } from '../src/sim/god/wrath.ts';
import type { WorldView } from '../src/client/worldview.ts';
import { town } from './helpers/god.ts';
import { setOverlayOres, overlayOres } from '../src/ui/overlays.ts';

test('living words: regard bands at ±0.33, the four values in words, a sentence for the card', () => {
  assert.equal(regardBand(-0.5), 'feared');
  assert.equal(regardBand(-0.33), 'awed');
  assert.equal(regardBand(0), 'awed');
  assert.equal(regardBand(0.34), 'trusted');
  assert.equal(meterWord('faith', 0.05), 'doubt you');
  assert.equal(meterWord('faith', 0.5), 'believe');
  assert.equal(meterWord('fear', 0.9), 'terrified');
  assert.equal(meterWord('trust', 0.7), 'trust you');
  assert.equal(meterWord('loyalty', 0.2), 'drifting');
  assert.match(regardSentence(0, { faith: 0.5, fear: 0.2, trust: 0.3, loyalty: 0.1, towns: 1, people: 30 }), /^They hold you in awe: they believe, and they are wary\.$/);
  assert.match(regardSentence(-0.6, { faith: 0.5, fear: 0.7, trust: 0.1, loyalty: 0.1, towns: 1, people: 30 }), /^They fear you/);
  assert.match(regardSentence(0, null), /No one lives yet/);
});

test('wrath words: the card says what the free text means (gentle 0.1 · survivable 0.3 · great 0.6 · huge 0.85 · apocalyptic 1)', () => {
  for (const [phrase, word] of [['a gentle storm', 'gentle'], ['a great flood', 'great'], ['a huge meteor', 'huge'], ['an apocalyptic quake', 'apocalyptic']] as const) {
    const w = wrathWords(phrase);
    assert.ok(w !== undefined, phrase);
    assert.equal(wrathWord(w!), word, `${phrase} → ${w}`);
  }
  assert.equal(wrathWord(WRATH_DEFAULT), 'survivable');
  assert.equal(fmtParam('wrath', 0.6), 'great · 0.60');
});

test('the tool card offers its own wrath on every harmful power, left at the law: nothing is sent until it is moved (real sim)', () => {
  const { sim } = town();
  const book = new PowerBook();
  book.setCommands(sim.query('commands'));
  const harmful = book.list.filter((p) => p.schema.wrath);
  assert.ok(harmful.length >= 30, `${harmful.length} powers take a wrath`);
  assert.ok(harmful.some((p) => p.id === 'disaster-meteor'), 'the meteor takes a wrath');
  assert.ok(!book.get('heal-miracle')?.schema.wrath, 'mending is no harm');
  for (const p of harmful) assert.equal(castValues(p, {}).wrath, undefined, `${p.id} sends no wrath by itself`);
  book.wrathLaw = 0.3;
  assert.equal(autoWords(book, book.get('disaster-meteor')!, 'wrath'), 'the world\'s: survivable · 0.30');
  assert.equal(castValues(book.get('disaster-meteor')!, { wrath: 0.85 }).wrath, 0.85);
});

test('prayers: the most pressing first, answered in one click by the sim', () => {
  const { sim, st } = town();
  st.store.fill(0); // a hungry town prays
  sim.step(60 * 30);
  const snap = sim.snapshot() as unknown as { planets: { id: number; settlements: unknown[] }[] };
  const view = { planets: snap.planets.map((p) => ({ id: p.id, settlements: p.settlements })), renderTick: sim.u.tick, planet: () => undefined } as unknown as WorldView;
  const open = openPrayers(view, 0);
  assert.ok(open.length >= 1, 'Aru prays');
  assert.equal(open[0].name, 'Aru');
  for (let i = 1; i < open.length; i++) assert.ok(open[i - 1].urgency >= open[i].urgency, 'most pressing first');
  const c = answerCommand(open[0]);
  assert.deepEqual(c, { k: 'prayer.answer', settlement: st.id, prayer: open[0].id, planet: 0 });
  const r = sim.applyNow(c);
  assert.ok(r.ok, r.msg);
  const left = (sim.query('prayers', { planet: 0 }) as { prayers: { id: number }[] }[]).flatMap((x) => x.prayers).map((p) => p.id);
  assert.ok(!left.includes(open[0].id), 'the prayer answered is no longer open');
});

test('prophets and signs: what a prophet foretells reads as words; their standing; every omen has a name', () => {
  assert.deepEqual(FORETELL.map((f) => f.id), ['rain', 'food', 'healing', 'warmth', 'protection', 'rebuilding', 'harm', 'sign']);
  assert.equal(foretellSays('rain'), 'rain will come');
  assert.deepEqual(prophetState({ agent: 1, planet: 0, settlement: 1, name: 'Hesh', credibility: 0.3, silencedUntil: 100, persecution: 2 }, 50), ['silenced', 'exiled']);
  for (const k of ['eclipse', 'comet', 'flood', 'rainbow', 'lightning', 'aurora', 'red-rain', 'still-sun', 'sacred-animal', 'spring']) assert.ok(OMEN_NAMES[k], k);
});

test('the god\'s keys: a window, a sign, an answer — bound and free of conflicts', () => {
  const kb = new Keybinds(null);
  for (const id of ['ui.god', 'ui.signs', 'god.answer']) {
    assert.ok(ACTIONS.some((a) => a.id === id), id);
    assert.ok(kb.keysOf(id).length > 0, `${id} has a key`);
  }
  const c = kb.conflicts();
  const ours = c.filter((x) => x.actions.some((a) => a === 'ui.god' || a === 'ui.signs' || a === 'god.answer'));
  assert.deepEqual(ours, []);
});

test('H12: an invented material\'s vein crops out in its own colour — the ores query in content order feeds the palette', () => {
  const { sim, st } = town(20261031);
  const before = oreRows(sim.query('ores', {}));
  const r = sim.applyNow({ k: 'content.material', name: 'mithril', settlement: st.id, traits: ['hard', 'light'] });
  assert.ok(r.ok, r.msg);
  const c = sim.u.content;
  const rows = oreRows(sim.query('ores', {}));
  // one row per deposit kind, in content order: oreType i + 1 (what a vein writes) is row i
  assert.equal(rows.length, c.ores.list.length);
  assert.equal(rows.length, before.length + 1, 'the invented deposit kind is added');
  const i = c.ores.idx('mithril');
  assert.equal(rows[i].id, 'mithril');
  assert.match(rows[i].color ?? '', /^#[0-9a-f]{6}$/i, 'the invention has its own colour');
  assert.equal(rows[i].color, c.ores.find('mithril')!.color);
  // the base pack's rows keep their place and colour
  for (let k = 0; k < before.length; k++) assert.deepEqual(rows[k], before[k]);
  let veins = 0;
  const p = sim.u.planets[0];
  for (let k = 0; k < p.count; k++) if (p.f.oreType[k] === i + 1) veins++;
  assert.ok(veins > 0, 'its vein is laid with oreType = row + 1');
  // the Ore overlay paints, names and lists it too (not a nameless "ore" left off the map)
  const base = overlayOres().length;
  setOverlayOres(sim.query('ores', {}));
  assert.equal(overlayOres().length, rows.length);
  assert.ok(overlayOres().length > base);
  assert.equal(overlayOres()[i].color, rows[i].color);
  assert.match(overlayOres()[i].name, /mithril/i);
  setOverlayOres(null);
  assert.equal(overlayOres().length, rows.length, 'a failed query keeps the list');
  assert.deepEqual(oreRows(null), []);
  assert.deepEqual(oreRows([{ id: 7, color: null }]), [{ id: undefined, color: undefined }]);
});
