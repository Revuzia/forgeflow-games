// GENESIS — the creature is gone (LIVING.md §0.1 decision 6, §3.5). The giant learning creature was fantasy and Black &
// White's signature; the god's lever of influence is now prophets and signs (tests/living-relationship.test.ts). Here:
// no `creature.*` command or power, no creature in a snapshot or a query; a save from before 1.5 holding a creature (one
// leashed, one held by the hand, one in flight) loads without it — the hand let go, nothing in the air — with faith and
// loyalty filled from its old love and fear, and its hash is stable over save → load; "give me a creature" answers
// with the prophet hint, never an invented animal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town } from './helpers/god.ts';
import { Sim } from '../src/sim/sim.ts';
import { readSave, SaveWriter, SAVE_MAJOR } from '../src/sim/core/serialize.ts';
import { POWER_CATEGORIES } from '../src/sim/content.ts';
import { GODS } from '../src/sim/people/defs.ts';

/** rewrite a save as a 1.4 save that still held the creature (its state, the hand holding it, one in flight) */
function legacyWithCreature(bytes: Uint8Array): Uint8Array {
  const f = readSave(bytes);
  const h = f.header as Record<string, unknown> & { god: Record<string, unknown> };
  const creature = {
    id: 99, planet: 0, name: 'Grom', template: 'ape', god: 0, settlement: -1, pos: [0, 0, 1], from: [0, 0, 1], to: [0, 0, 1], t0: 0, t1: 0,
    heading: 0, height: 9, growth: 0.4, alignment: 0.2, hunger: 0.3, energy: 0.8, strength: 3, intelligence: 4, desires: { eat: 0.5 },
    miracles: { heal: 0.3 }, last: { kind: 'eat', tick: 0, target: -1, obj: '' }, doing: { kind: 'sleep', until: 0, target: -1, obj: '', at: null, acted: false },
    upd: 0, leash: { mode: 'tend', settlement: 1, point: null, length: 900 }, activity: 'sleeping', anim: 6, held: null, trust: 0.6, next: 0, born: 0, counts: {}, alive: true,
  };
  h.god.creatures = [creature, { ...creature, id: 100, name: 'Ruk' }];
  h.god.hands = [{ god: 0, planet: 0, pos: [0, 0, 1], alt: 8, held: { kind: 'creature', id: 100 }, pose: 'grab', poseUntil: 0, prev: [0, 0, 1], prevTick: 0 }];
  h.god.projectiles = [{ id: 7, planet: 0, pos: [0, 0, 1], alt: 30, vel: [0, 0, 0], payload: { kind: 'creature', id: 99 }, god: 0, t0: 0, from: [0, 0, 1] }];
  h.god.laws = { ...(h.god.laws as Record<string, number>), 'creature.learning': 2, 'creature.growth': 3 };
  delete (h.god as Record<string, unknown>).rel;
  const w = new SaveWriter();
  for (const [name, arr] of f.blobs) if (!/\.a\.(faith|loyalty)$/.test(name)) w.blob(name, arr);
  const out = w.finish(h);
  new DataView(out.buffer).setUint16(4, (SAVE_MAJOR << 8) | 4, true);
  return out;
}

test('no creature command, power, view or query is left', () => {
  const { sim } = town();
  assert.deepEqual(sim.registry.kinds().filter((k) => k.startsWith('creature.')), [], 'no creature.* command');
  assert.ok(!(POWER_CATEGORIES as readonly string[]).includes('Creature') && (POWER_CATEGORIES as readonly string[]).includes('Signs'), 'the Signs category replaces it');
  assert.deepEqual(sim.u.content.powers.list.filter((pw) => pw.command.startsWith('creature.') || pw.category === ('Creature' as never)).map((pw) => pw.id), []);
  assert.ok(!sim.u.content.powers.list.some((pw) => /creature/i.test(pw.desc)), 'no power describes a creature');
  const snap = sim.snapshot();
  assert.equal(snap.creatures, undefined, 'Snapshot.creatures is never sent');
  assert.ok(!('creatures' in snap));
  assert.equal(typeof (sim.query('creatures') as { error?: string }).error, 'string', 'no creatures query');
  assert.ok(!('creatures' in sim.u.god), 'the god state holds no creatures');
  const r = sim.applyNow({ k: 'creature.adopt', template: 'ape' });
  assert.equal(r.ok, false);
});

test('a 1.4 save holding a creature loads without it, the hand empty and nothing in flight, and keeps its hash over save → load', () => {
  const { sim } = town();
  const old = legacyWithCreature(sim.save());
  const a = Sim.load(old);
  assert.equal(a.u.god.hands[0].held, null, 'the hand let go');
  assert.equal(a.u.god.hands[0].pose, 'open');
  assert.equal(a.u.god.projectiles.length, 0, 'the creature in flight is gone');
  assert.ok(!Object.keys(a.u.god.laws).some((k) => k.startsWith('creature.')), 'its laws are gone');
  assert.equal(a.snapshot().creatures, undefined);
  // faith and loyalty were filled from the old love and fear (LIVING §3.1)
  const A = a.u.planets[0].people.agents;
  let checked = 0;
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    const i = s * GODS;
    assert.ok(Math.abs(A.faith[i] - Math.min(1, A.love[i] + A.fear[i])) < 1e-6 || (A.love[i] + A.fear[i] === 0 && A.faith[i] > 0), `faith of slot ${s}`);
    assert.ok(Math.abs(A.loyalty[i] - 0.5 * A.love[i]) < 1e-6, `loyalty of slot ${s}`);
    checked++;
  }
  assert.ok(checked >= 20);
  const b = Sim.load(a.save());
  assert.equal(b.hash(), a.hash(), 'stable over save → load');
  a.step(120);
  b.step(120);
  assert.equal(b.hash(), a.hash(), 'and lives the same future');
});

test('asking for a creature answers with the prophet hint, never an invented animal', () => {
  const { sim } = town();
  for (const t of ['give me a creature', 'adopt an ape', 'leash the creature to Aru', 'make the creature bigger', 'I want a pet titan']) {
    const r = sim.parse(t);
    assert.equal(r.ok, false, t);
    assert.match(r.msg ?? '', /no great creature/i, t);
    assert.match(r.msg ?? '', /prophet/i, t);
    assert.ok(!(r.resolved ?? []).some((c) => c.k === 'content.animal' || c.k.startsWith('creature.')), `${t}: ${JSON.stringify(r.resolved)}`);
  }
});
