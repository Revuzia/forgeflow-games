// ARC §4 (stage C), the UI side, coded to the §6 contracts ahead of the sim: the covenant's offer on the Decision card
// (four vows, Say nothing, Decide later, the pill), the confirm a refused cast shows and the command Break it resends,
// the wrath slider's notch under "always gentle", the Promises rows, the inspector's line, and the stub's refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DecisionState } from '../src/ui/decision.ts';
import {
  covenantChoice, declineCommand, covenantRefusal, breakCommand, confirmWords, covenantTownNames, wrathNotch, covenantRows, promiseLine,
  underPromise, joinNames, theName, VOW_LABEL, VOWS,
} from '../src/ui/book.ts';
import { arcStub, arcStubCmd, arcStubQuery } from '../src/client/arcstub.ts';
import { cueFor } from '../src/audio/eventmap.ts';

const names = new Map([[1, { name: 'Aru' }], [2, { name: 'Tesh' }], [3, { name: 'Vorn' }]]);
const offer = { id: 7, name: 'Flood of Aru', dead: 61, towns: [1, 2, 3], household: 'the house of Hesh', until: 99999 };

test('the covenant card says §4.5: after the flood, the dead, the towns, the household; four vows as covenant.make', () => {
  const c = covenantChoice(offer, 0, names);
  assert.equal(c.id, 'covenant:7');
  assert.equal(c.title, 'After the Flood of Aru');
  assert.equal(c.pill, 'After the Flood of Aru');
  assert.equal(c.meta, '61 dead · three towns struck · the house of Hesh came through it whole');
  assert.equal(c.why, 'The survivors of Aru, Tesh and Vorn look to the sky.');
  assert.deepEqual(c.options.map((o) => [o.key, o.label]), [['1', 'Never again by water'], ['2', 'Never again so many'], ['3', 'Always gentle'], ['4', 'Always warn first']]);
  assert.deepEqual(c.options.map((o) => o.cmd), VOWS.map((vow) => ({ k: 'covenant.make', vow, offer: 7, planet: 0 })));
  assert.deepEqual(declineCommand(offer, 0), { k: 'covenant.decline', offer: 7, planet: 0 });
  // numbers in words up to twelve; no one dead (the debug offer) says so
  const small = covenantChoice({ ...offer, name: 'the Burning of Tesh', dead: 0, towns: [2], household: undefined }, 0, names);
  assert.equal(small.title, 'After the Burning of Tesh');
  assert.equal(small.meta, 'no one died · one town struck');
  // the voice: every line short, no placeholder, no slider number
  for (const s of [c.title, c.meta, c.why, ...c.options.flatMap((o) => [o.label, o.says])]) {
    assert.ok(s.length <= 140 && !/[{}]/.test(s) && !/0\.\d/.test(s), s);
  }
});

test('the offer opens the card once, Decide later leaves the pill, the card closes when the offer goes', () => {
  const d = new DecisionState();
  assert.equal(d.step(['covenant:7'], ['covenant:7'], 100, true), 10);
  assert.equal(d.open, 'covenant:7');
  assert.equal(d.putOff(), 100);
  assert.deepEqual([...d.later], ['covenant:7']);
  d.step(['covenant:7'], ['covenant:7'], 10, true);
  assert.equal(d.open, null); // a pill, not reopened by itself
  d.step([], [], 10, true);
  assert.deepEqual([...d.later], []);
});

test('a covenant refusal: the confirm says §4.4, Break it resends with covenant: break (words get the clause)', () => {
  const r = { ok: false, msg: 'You promised...', refusal: { kind: 'covenant', covenant: 3, vow: 'no-flood' } };
  assert.deepEqual(covenantRefusal(r as never), { kind: 'covenant', covenant: 3, vow: 'no-flood' });
  assert.equal(covenantRefusal({ ok: false, msg: 'no' }), null);
  assert.equal(covenantRefusal({ ok: false, refusal: { kind: 'other' } } as never), null);
  const cast = { k: 'disaster.spawn', kind: 'flood', planet: 0, pos: [1, 0, 0] };
  assert.deepEqual(breakCommand(cast), { ...cast, covenant: 'break' });
  assert.deepEqual(breakCommand({ k: 'freeform', text: 'flood Aru.' }), { k: 'freeform', text: 'flood Aru, and break my covenant' });
  assert.deepEqual(breakCommand({ k: 'freeform', text: 'flood Aru and break my promise' }), { k: 'freeform', text: 'flood Aru and break my promise' });
  const w = confirmWords(['Aru'], 'no-flood');
  assert.equal(w.text, 'This breaks your promise to the people of Aru. They will remember.');
  assert.equal(w.vow, 'You promised: never again by water.');
  assert.equal(confirmWords(['Aru', 'Tesh'], 'gentle').text, 'This breaks your promise to the people of Aru and Tesh. They will remember.');
  const pv = { covenant: { id: 3, vow: 'no-flood' as const, status: 'kept' as const, years: 4, towns: [2, 1] }, settlements: [{ id: 1, name: 'Aru' }, { id: 2, name: 'Tesh' }] };
  assert.deepEqual(covenantTownNames(pv, 3), ['Tesh', 'Aru']);
  assert.deepEqual(covenantTownNames({ settlements: [{ id: 1, name: 'Aru', covenant: { id: 5, vow: 'gentle', status: 'kept', year: 9 } }] }, 5), ['Aru']);
});

test('the app shows the confirm for a refused button cast, never for a quiet one or one already breaking (wiring)', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /const refused = covenantRefusal\(r\);\s*\n\s*if \(refused && !opts\.quiet && c\.covenant !== 'break' && this\.ui\?\.covenant\)/);
  assert.match(app, /this\.ui\.covenant\.show\(confirmWords\(covenantTownNames\(pv, refused\.covenant\), refused\.vow\), \(\) => this\.cmd\(breakCommand\(c\), opts\)\)/);
});

test('the stub refuses harmful casts as the pre-check would, lets a break through, answers the covenants query', () => {
  assert.equal(arcStubCmd({ k: 'disaster.spawn', kind: 'flood' }), null);
  arcStub('refusal', { covenant: 3, vow: 'no-flood' });
  const r = arcStubCmd({ k: 'disaster.spawn', kind: 'flood' });
  assert.deepEqual(covenantRefusal(r), { kind: 'covenant', covenant: 3, vow: 'no-flood' });
  assert.equal(arcStubCmd({ k: 'disaster.spawn', kind: 'flood', covenant: 'break' }), null);
  assert.equal(arcStubCmd({ k: 'weather.paint', kind: 'rain' }), null);
  assert.equal(arcStubCmd({ k: 'defiance.answer', how: 'mercy' }), null);
  assert.ok(arcStubCmd({ k: 'defiance.answer', how: 'wrath' }));
  arcStub('refusal', null);
  assert.equal(arcStubCmd({ k: 'disaster.spawn' }), null);
  assert.equal(arcStubQuery('covenants', {}), undefined);
  arcStub('covenants', { covenants: [{ id: 1 }] });
  assert.deepEqual(arcStubQuery('covenants', { planet: 0 }), { covenants: [{ id: 1 }] });
  arcStub('covenants', null);
  assert.equal(arcStubQuery('covenants', {}), undefined);
});

test('the wrath notch shows at 0.3 only under a kept gentle promise', () => {
  const cov = { id: 1, vow: 'gentle' as const, status: 'kept' as const, years: 3, towns: [1] };
  assert.deepEqual(wrathNotch(cov, ['Aru']), { at: 0.3, title: 'Your promise to Aru: always gentle' });
  assert.equal(wrathNotch({ ...cov, vow: 'no-flood' }, ['Aru']), null);
  assert.equal(wrathNotch({ ...cov, status: 'broken' }, ['Aru']), null);
  assert.equal(wrathNotch(null, []), null);
  const living = readFileSync(new URL('../src/ui/living.ts', import.meta.url), 'utf8');
  assert.match(living, /gn-wrath-notch/);
});

test('Promises: the vow in words, kept so many years or broken in year N, the household, the towns', () => {
  const rows = covenantRows({ covenants: [
    { id: 2, planet: 0, made: 2000, vow: 'gentle', after: 'Burning of Tesh', settlements: [2], status: 'broken', broken: 9000, townNames: ['Tesh'] },
    { id: 1, planet: 0, made: 1000, vow: 'no-flood', after: 'Flood of Aru', settlements: [1, 3], household: { id: 4, name: 'the house of Hesh' }, status: 'kept', broken: -1, yearsKept: 14 },
    { id: 9, planet: 1, made: 10, vow: 'gentle', after: 'x', settlements: [], status: 'kept', broken: -1 },
  ], offers: [] }, 0);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
  const yearOf = (t: number) => Math.floor(t / 100);
  const a = promiseLine(rows[0], yearOf, 120, names);
  assert.deepEqual([a.vow, a.status, a.after, a.household, a.towns, a.kept], ['Never again by water', 'kept 14 years', 'after the Flood of Aru', 'the house of Hesh', 'Aru and Vorn', true]);
  const b = promiseLine(rows[1], yearOf, 120, names);
  assert.deepEqual([b.vow, b.status, b.towns, b.kept], ['Always gentle', 'broken in year 90', 'Tesh', false]);
  assert.equal(promiseLine({ ...rows[0], yearsKept: 1 }, yearOf, 120, names).status, 'kept one year');
  assert.deepEqual(covenantRows([{ id: 5, planet: 0, made: 1, vow: 'gentle' }]).map((r) => r.id), [5]);
  assert.deepEqual(covenantRows(null), []);
  assert.equal(underPromise({ id: 1, vow: 'no-flood', status: 'kept', year: 140 }), 'Under the promise of year 140 (kept)');
  assert.equal(underPromise({ id: 1, vow: 'no-flood', status: 'broken', year: 140 }), 'Under the promise of year 140 (broken)');
  assert.equal(underPromise(undefined), '');
  assert.equal(joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C and two more');
  assert.equal(theName('The Flood of Aru'), 'the Flood of Aru');
  assert.equal(Object.keys(VOW_LABEL).length, 4);
});

test('audio: the covenant cues stay new SFX (never an authored stinger), the offer is silent, a refusal is ui.deny', () => {
  const at = { planet: 0, tick: 1 };
  assert.equal(cueFor({ ...at, t: 'covenant.offered', data: {} } as never), null);
  assert.equal(cueFor({ ...at, t: 'covenant.bow', data: {} } as never)?.cue, 'covenant.chime');
  assert.equal(cueFor({ ...at, t: 'covenant.broken', data: {} } as never)?.cue, 'covenant.chime.broken');
  assert.equal(cueFor({ ...at, t: 'covenant.kept', data: {} } as never)?.cue, 'ui.great');
  assert.equal(cueFor({ ...at, t: 'covenant.refused', data: {} } as never)?.cue, 'ui.deny');
});
