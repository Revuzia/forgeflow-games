// ARC §2.5 (last bullet): the tower's inspector card, in words (pure: decision.ts towerCard), without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towerCard } from '../src/ui/decision.ts';
import type { TowerView } from '../src/sim/types.ts';

const T = (o: Partial<TowerView> = {}): TowerView => ({ id: 4, pos: [1, 0, 0], cell: 9, name: 'the Tower of Kel-Amar', host: 1, league: [1, 2],
  height: 38.4, goal: 80, tiers: 4, material: 'mudbrick', style: 0, status: 'rising', builders: 9, begun: 0, ended: -1, answer: 'none',
  choiceOpen: false, canAnswer: ['confuse', 'strike', 'warn', 'let'], ...o } as TowerView);
const names = new Map([[1, { name: 'Kel-Amar', heart: { pride: 0.82 } }], [2, { name: 'Tesh', prophet: { name: 'Hesh' }, heart: { pride: 0.45 } }]]) as never;

test('a rising tower: height of goal, tiers, builders, years, material, the towns with their pride in words, four answers', () => {
  const c = towerCard(T(), 0, names, 2);
  assert.equal(c.name, 'the Tower of Kel-Amar');
  assert.equal(c.sub, 'At Kel-Amar');
  const rows = Object.fromEntries(c.rows);
  assert.equal(rows.Status, 'Rising');
  assert.equal(rows.Height, '38 m of about 80');
  assert.equal(rows.Tiers, 'four');
  assert.equal(rows['Built of'], 'mud brick');
  assert.equal(rows['Years building'], 'two');
  assert.equal(rows['Builders today'], 'nine');
  assert.equal(rows['Your answer'], 'None yet');
  assert.deepEqual(c.towns.map((t) => [t.name, t.pride]), [['Kel-Amar', 'very proud'], ['Tesh', 'sure of themselves']]);
  assert.deepEqual(c.options.map((o) => o.cmd.k), ['tower.confuse', 'tower.strike', 'tower.warn', 'tower.let']);
  for (const [, v] of c.rows) assert.ok(!/\d\.\d/.test(v), v);
});

test('a standing tower let stand: only strike and confuse remain; a struck one has no buttons', () => {
  const c = towerCard(T({ status: 'finished', height: 80, tiers: 7, answer: 'let', builders: 0, ended: 100, canAnswer: ['confuse', 'strike'] }), 0, names, 5);
  assert.deepEqual(c.options.map((o) => o.id), ['confuse', 'strike']);
  const rows = Object.fromEntries(c.rows);
  assert.equal(rows.Height, '80 m');
  assert.equal(rows['Your answer'], 'You let it stand');
  assert.equal(rows['Builders today'], undefined);
  const s = towerCard(T({ status: 'struck', height: 14, answer: 'strike', canAnswer: [] }), 0, names, 3);
  assert.equal(s.options.length, 0);
  assert.equal(Object.fromEntries(s.rows).Status, 'Struck down');
});
