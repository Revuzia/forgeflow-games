// ARC §6.7: the arc stub puts hearts / towers / covenant / age views into snapshots before the sim sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcStub, applyArcStub, arcStubActive } from '../src/client/arcstub.ts';
import type { Snapshot } from '../src/sim/types.ts';

const snap = (): Snapshot => ({
  tick: 10,
  planets: [
    { id: 0, settlements: [{ id: 3, name: 'Aru' }, { id: 4, name: 'Tesh' }],
      agents: { count: 3, id: new Uint32Array([7, 8, 9]) } },
    { id: 1, settlements: [{ id: 9, name: 'Vorn' }] },
  ],
} as unknown as Snapshot);

const heart = { kind: 'fearful', proud: true, devoted: 0.1, fearful: 0.5, restless: 0, defiant: 0, pride: 0.7,
  defiance: 0.1, dusk: 9, duskYearAgo: 24, caption: 'They watch the sky', line: 'In Aru they watch the sky.', remember: [], answered: '' };

test('no stub: the snapshot is untouched', () => {
  assert.equal(arcStubActive(), false);
  const s = snap();
  applyArcStub(s);
  assert.equal((s.planets[0].settlements![0] as { heart?: unknown }).heart, undefined);
});

test('hearts stub patches named towns and agent signs, and clears', () => {
  arcStub('hearts', [{ settlement: 3, heart, defiant: { kind: 'curse', tick: 5 } }]);
  arcStub('hearts', { signs: { 8: 3 } });
  const s = snap();
  applyArcStub(s);
  const [a, b] = s.planets[0].settlements!;
  assert.equal(a.heart?.kind, 'fearful');
  assert.equal(a.defiant?.kind, 'curse');
  assert.equal(b.heart, undefined);
  assert.deepEqual([...s.planets[0].agents!.heart!], [0, 3, 0]);
  arcStub('hearts', null);
  const t = snap();
  applyArcStub(t);
  assert.equal(t.planets[0].settlements![0].heart, undefined);
  assert.equal(t.planets[0].agents!.heart, undefined);
});

test('towers / covenant / age go to the first planet unless named', () => {
  arcStub('towers', [{ id: 1, name: 'the Tower of Kel-Amar', height: 20, goal: 80 }]);
  arcStub('age', { planet: 1, age: { id: 2, name: 'The Age of Plenty', kind: 'plenty', since: 0 }, epithet: 'the Patient' });
  arcStub('covenant', { covenantOffer: { id: 5, name: 'the flood at Aru', dead: 0, towns: [3], until: 99 } });
  const s = snap();
  applyArcStub(s);
  assert.equal(s.planets[0].towers?.[0].name, 'the Tower of Kel-Amar');
  assert.equal(s.planets[1].towers, undefined);
  assert.equal(s.planets[1].age?.kind, 'plenty');
  assert.equal(s.planets[1].epithet, 'the Patient');
  assert.equal(s.planets[0].age, undefined);
  assert.equal(s.planets[0].covenantOffer?.id, 5);
  arcStub('towers', null); arcStub('age', null); arcStub('covenant', null);
  assert.equal(arcStubActive(), false);
});
