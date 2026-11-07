// ARC §2.5 / §8.2 T10 (UI side): the Decision card's words, timing, pill and slow-down, without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionState, towerChoice, numWords } from '../src/ui/decision.ts';
import type { TowerView } from '../src/sim/types.ts';

const T = (o: Partial<TowerView> = {}): TowerView => ({ id: 4, pos: [1, 0, 0], cell: 9, name: 'the Tower of Kel-Amar', host: 1, league: [1, 2, 3],
  height: 38.4, goal: 80, tiers: 4, material: 'mudbrick', style: 0, status: 'rising', builders: 9, begun: 0, ended: -1, answer: 'none',
  choiceOpen: true, canAnswer: ['confuse', 'strike', 'warn', 'let'], ...o } as TowerView);
const names = new Map([[1, { name: 'Kel-Amar' }], [2, { name: 'Tesh', prophet: { name: 'Hesh' } }], [3, { name: 'Vorn' }]] as [number, { name: string; prophet?: { name: string } }][]);

test('the tower card says what the spec says, in words, with the four answers as commands', () => {
  const c = towerChoice(T(), 0, names as never, 2);
  assert.equal(c.title, 'A tower rises at Kel-Amar');
  assert.equal(c.meta, 'year two of the work · 38 m of about 80 · three towns of one speech');
  assert.equal(c.pill, 'The tower at Kel-Amar');
  assert.deepEqual(c.options.map((o) => [o.key, o.label]), [['1', 'Confuse their tongues'], ['2', 'Strike it down'], ['3', 'Send a prophet to warn them'], ['4', 'Let it stand']]);
  assert.deepEqual(c.options.map((o) => o.cmd.k), ['tower.confuse', 'tower.strike', 'tower.warn', 'tower.let']);
  assert.ok(c.options.every((o) => (o.cmd as unknown as { tower: number }).tower === 4 && !o.disabled));
  assert.match(c.options[2].says, /Hesh will go/);
  for (const s of [c.title, c.meta, c.why, ...c.options.map((o) => o.says)]) assert.ok(s.length <= 140 && !/\{|\}/.test(s), s);
  assert.equal(numWords(12), 'twelve');
  assert.equal(numWords(13), '13');
});

test('warn is disabled with a reason: the sim\'s, or no prophet among the builders', () => {
  const blocked = towerChoice(T({ canAnswer: ['confuse', 'strike', 'let'], warnBlocked: 'They would not hear a prophet again this year.' }), 0, names as never, 1);
  assert.equal(blocked.options[2].disabled, 'They would not hear a prophet again this year.');
  const none = towerChoice(T({ canAnswer: ['confuse', 'strike', 'let'] }), 0, new Map([[1, { name: 'Kel-Amar' }]]) as never, 1);
  assert.match(none.options[2].disabled!, /No prophet speaks for you among the builders/);
});

test('timing: a card per fresh offer (25 %, then once more at 75 %), a pill after "Decide later", gone when it closes', () => {
  const s = new DecisionState();
  assert.equal(s.step([], [], 1, true), null);
  assert.equal(s.open, null);
  s.step(['tower:4'], ['tower:4'], 1, true);
  assert.equal(s.open, 'tower:4', 'opens at the offer');
  s.putOff();
  assert.equal(s.open, null);
  assert.deepEqual([...s.later], ['tower:4'], 'a pill');
  s.step(['tower:4'], ['tower:4'], 1, true);
  assert.equal(s.open, null, 'the same offer does not reopen by itself');
  s.reopen('tower:4');
  assert.equal(s.open, 'tower:4', 'the pill reopens it');
  s.putOff();
  s.step([], ['tower:4'], 1, true); // the offer closes (25 % window over)
  assert.deepEqual([...s.later], [], 'the pill lasts only while the choice is offered');
  s.step(['tower:4'], ['tower:4'], 1, true); // offered again at 75 %
  assert.equal(s.open, 'tower:4', 'the 75 % offer opens it again');
  s.answered();
  s.step([], [], 1, true);
  assert.equal(s.open, null);
});

test('slow down for great moments: above 30x eases to 10x, restored on answer or later; not at 30x or with the pref off', () => {
  const s = new DecisionState();
  assert.equal(s.step(['tower:4'], ['tower:4'], 100, true), 10);
  assert.equal(s.putOff(), 100);
  const a = new DecisionState();
  assert.equal(a.step(['tower:1'], ['tower:1'], 300, true), 10);
  assert.equal(a.answered(), 300);
  assert.equal(new DecisionState().step(['tower:1'], ['tower:1'], 30, true), null);
  assert.equal(new DecisionState().step(['tower:1'], ['tower:1'], 100, false), null);
  const e = new DecisionState();
  e.step(['tower:1'], ['tower:1'], 100, true);
  assert.equal(e.step([], [], 10, true), 100, 'an offer that expires under the card gives the speed back');
});

test('the tower card reopens a standing tower that can still be answered (forced), and closes when it cannot', () => {
  const s = new DecisionState();
  s.reopen('tower:4', true);
  s.step([], ['tower:4'], 1, true);
  assert.equal(s.open, 'tower:4');
  s.step([], [], 1, true);
  assert.equal(s.open, null);
});
