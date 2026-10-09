// GENESIS — contact between worlds follows both cultures (CONTRACT.md §12), reached through what happens to a people and
// what the visitors came for — never by editing a trait: a people the god has terrorised for days meets visitors with
// spears (war); settlers who come down beside a big town of their own kind join it (merger); strangers of another body
// and another breath are met with silence; an electric-age hive trades with traders; a stone-age people worships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { late, must, town, ctx, until, ship, told, DAY } from './helpers/space.ts';
import { storeAdd } from '../src/sim/people/store.ts';

let base: Uint8Array | null = null;
/** the late two-world system, flights reliable and quick (the meeting is the point here, not the voyage) */
function quick(): Sim {
  if (!base) {
    const sim = late();
    must(sim, { k: 'set', path: 'space.drive', value: 0 });
    must(sim, { k: 'set', path: 'space.reliability', value: 2 });
    must(sim, { k: 'set', path: 'space.speed', value: 20 });
    base = sim.save();
  }
  return Sim.load(base);
}

/** a new world with a people of `species` on it; a ship from Gaia's town goes there for `purpose`; its outcome */
function meet(birth: Record<string, unknown>, purpose: string, prep: (sim: Sim, world: number, natives: number) => void, toward = false): { outcome: string; sim: Sim; sid: number; world: number; natives: number } {
  const sim = quick();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  const b = must(sim, { k: 'world.birth', name: 'Other', distance: 1.2, n: 12, life: 1, count: 40, ...birth });
  const world = b.created![0].id;
  const nat = b.created!.find((e) => e.kind === 'settlement');
  assert.ok(nat, `a people on the new world (${b.msg})`);
  prep(sim, world, nat!.id);
  const x = ctx(sim, gaia.id);
  storeAdd(x, home, u.content.items.idx('orbital-rocket'), 1);
  storeAdd(x, home, u.content.items.idx('rocket-fuel'), 60);
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: world, purpose, ...(toward ? { toward: nat!.id } : {}) });
  const sid = r.created![0].id;
  until(sim, () => ship(sim, sid).visits.includes(world) || ['lost', 'done'].includes(ship(sim, sid).phase), 20, 'arrival');
  assert.ok(ship(sim, sid).visits.includes(world), `it came down (${ship(sim, sid).log.join(' | ')})`);
  return { outcome: ship(sim, sid).outcome, sim, sid, world, natives: nat!.id };
}

/** the god's terror over a town for three days (fear, harm, wonder): its culture turns cruel and afraid */
const terror = (sim: Sim, world: number, natives: number) => {
  for (let k = 0; k < 6; k++) { must(sim, { k: 'belief.sway', planet: world, settlement: natives, feeling: 'fear', amount: 3 }); sim.step(DAY / 2); }
};

test('war: a hive the god has terrorised falls on the visitors', () => {
  const { outcome, sim, sid, world, natives } = meet({ kind: 'desert', people: 'hive', era: 'electric' }, 'curiosity', terror);
  const st = sim.u.planet(world)!.people.settlement(natives)!;
  assert.ok(st.culture.alignment < -0.2, `a cruel, fearful culture (${st.culture.alignment})`);
  assert.match(outcome, /^war/, ship(sim, sid).log.join(' | '));
  assert.match(told(sim).join('\n'), /fell on the visitors|fought: \d+ dead/);
  assert.ok(sim.u.space.relations.some((r) => r.war >= 0));
});

test('merger: settlers come down beside a big town of their own kind and join it', () => {
  const { outcome, sim, sid, world, natives } = meet({ kind: 'terran', people: 'plains-folk', era: 'electric', count: 60 }, 'colony', () => {}, true);
  assert.match(outcome, /merger/, ship(sim, sid).log.join(' | '));
  // the newcomers live in the natives' town now (one town of both), the crew of the ship set down there
  const p = sim.u.planet(world)!;
  assert.equal(ship(sim, sid).crew.length, 0, 'nobody left aboard');
  assert.ok((p.people.members.get(natives)?.length ?? 0) >= 40, 'one town of both');
  assert.ok(!sim.u.space.colonies.some((c) => c.ship === sid), 'no town of their own');
  assert.match(told(sim).join('\n'), /joined the .* of |became its people/);
});

test('silence: strangers of another body and another breath are not spoken to', () => {
  const { outcome, sim, sid } = meet({ kind: 'methane', people: 'methane-drifters', era: 'classical' }, 'curiosity', () => {});
  assert.match(outcome, /^silence/, ship(sim, sid).log.join(' | '));
  assert.match(told(sim).join('\n'), /would not speak to them|hid from the visitors/);
});

test('trade: an electric-age hive trades with traders, goods both ways', () => {
  const { outcome, sim, sid } = meet({ kind: 'desert', people: 'hive', era: 'electric' }, 'trade', () => {});
  assert.match(outcome, /^trade/, ship(sim, sid).log.join(' | '));
  assert.match(ship(sim, sid).log.join(' | '), /Traded .* for .* at /);
});
