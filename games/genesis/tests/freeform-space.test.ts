// GENESIS — the worlds and the ships in words (CONTRACT.md §11.6, Pillar 1): a world named in the "do this" field is the
// world acted on ("crack Rust" cracks Rust, never the world under the camera), the verbs of unmaking reach world.erase,
// "seed / populate X with Y" sets a species across X, a new world can be named as it is born; ships are sent TO the
// world named ("launch a rocket to Rust" leaves from the people who can, bound for Rust), called back and struck down by
// name, or — with none named — the one flying; and a pack's disaster is reached by its own name even when a base
// keyword (wind) sits inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import type { ContentPack } from '../src/sim/content.ts';
import { late, must, town, until, ship, DAY } from './helpers/space.ts';

const one = (sim: Sim, text: string): Command => {
  const r = sim.parse(text);
  assert.ok(r.ok, `${text}: ${r.msg}`);
  assert.equal(r.resolved?.length, 1, `${text}: ${JSON.stringify(r.resolved)}`);
  return r.resolved![0];
};

test('a world named is the world acted on: crack, erase, unmake, move, a moon for it, its moon dropped, a species across it', () => {
  const sim = new Sim({ seed: 1, scenario: 'twoworlds-late', overrides: { n: 12 } });
  const rust = sim.u.planets.find((p) => p.name === 'Rust')!.id, gaia = sim.u.planets.find((p) => p.name === 'Gaia')!.id;
  assert.equal(sim.u.focus!.planet, gaia, 'the camera is on Gaia');
  assert.deepEqual(one(sim, 'crack Rust'), { k: 'world.crack', world: rust });
  assert.deepEqual(one(sim, 'destroy the world Rust'), { k: 'world.erase', world: rust });
  assert.deepEqual(one(sim, 'erase Rust'), { k: 'world.erase', world: rust });
  assert.deepEqual(one(sim, 'unmake Rust'), { k: 'world.erase', world: rust });
  assert.deepEqual(one(sim, 'move Rust to 2 au'), { k: 'world.move', world: rust, distance: 2 });
  assert.deepEqual(one(sim, 'give Rust a moon'), { k: 'world.moon-add', world: rust });
  assert.deepEqual(one(sim, 'drop the moon on Gaia'), { k: 'world.moon-fall', world: gaia });
  assert.deepEqual(one(sim, 'seed deer across Rust'), { k: 'world.seed-species', world: rust, species: 'deer' });
  assert.deepEqual(one(sim, 'populate Rust with plains folk'), { k: 'world.seed-species', world: rust, species: 'plains-folk' });
  // the preview names the world
  assert.match(sim.parse('crack Rust').msg ?? '', /crack the world · Rust/);
  // a world born by name, and "a world" is one world (no stray count)
  assert.deepEqual(one(sim, 'create a planet called Eden'), { k: 'world.birth', name: 'Eden', kind: 'terran' });
  assert.deepEqual(one(sim, 'birth a world'), { k: 'world.birth', kind: 'terran' });
  // and they do what they say, on the world named
  const r = sim.applyNow({ k: 'freeform', text: 'crack Rust' });
  assert.ok(r.ok, r.msg);
  assert.ok(sim.u.planet(rust)!.firsts.cracked !== undefined, 'Rust cracked');
  assert.equal(sim.u.planet(gaia)!.firsts.cracked, undefined, 'Gaia did not');
  const e = sim.applyNow({ k: 'freeform', text: 'create a planet called Eden' });
  assert.ok(e.ok && sim.u.planets.some((p) => p.name === 'Eden' && p.alive), e.msg);
  const x = sim.applyNow({ k: 'freeform', text: 'unmake Rust' });
  assert.ok(x.ok, x.msg);
  assert.equal(sim.u.planet(rust)!.alive, false);
  assert.ok(sim.u.planet(gaia)!.alive);
});

test('ships in words: sent TO the world named, called back and struck down by name — or the one flying', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!;
  must(sim, { k: 'set', path: 'space.drive', value: 0 });
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  for (const t of ['launch a rocket to Rust', 'send a rocket to Rust']) assert.deepEqual(one(sim, t), { k: 'ship.launch', kind: 'rocket', to: rust.id }, t);
  for (const t of ['send a ship to Rust', 'launch a ship to Rust']) assert.deepEqual(one(sim, t), { k: 'ship.launch', to: rust.id }, t);
  assert.deepEqual(one(sim, 'send a colony ship to Rust'), { k: 'ship.launch', to: rust.id, purpose: 'colony' });
  // it leaves from the people who can build it (Gaia), bound for Rust
  const r = sim.applyNow({ k: 'freeform', text: 'launch a rocket to Rust' });
  assert.ok(r.ok, r.msg);
  const sh = u.space.ships[u.space.ships.length - 1];
  assert.equal(sh.home, gaia.id);
  assert.equal(sh.to, rust.id);
  until(sim, () => ship(sim, sh.id).phase === 'transfer', 20, 'in flight');
  sim.step(DAY / 2);
  // with one ship flying, "the ship" is that ship; by name it is that ship
  assert.deepEqual(one(sim, 'call the ship back'), { k: 'ship.cancel' });
  assert.deepEqual(one(sim, 'turn the ship back'), { k: 'ship.cancel' });
  assert.deepEqual(one(sim, 'destroy the rocket'), { k: 'ship.destroy' });
  assert.deepEqual(one(sim, `turn ${sh.name} back`), { k: 'ship.cancel', ship: sh.id });
  assert.deepEqual(one(sim, `call the ship ${sh.name} back`), { k: 'ship.cancel', ship: sh.id });
  assert.deepEqual(one(sim, `strike ${sh.name} from the sky`), { k: 'ship.destroy', ship: sh.id });
  const back = sim.applyNow({ k: 'freeform', text: 'call the ship back' });
  assert.ok(back.ok, back.msg);
  assert.match(back.msg ?? '', /turns back for home/);
  assert.equal(ship(sim, sh.id).to, gaia.id);
  const down = sim.applyNow({ k: 'freeform', text: `strike ${sh.name} from the sky` });
  assert.ok(down.ok, down.msg);
  assert.equal(ship(sim, sh.id).phase, 'lost');
  // nothing in the sky: said so
  const none = sim.applyNow({ k: 'freeform', text: 'destroy the rocket' });
  assert.equal(none.ok, false);
  void town;
});

test('a pack\'s disaster by its own name: "salt wind" is the salt wind, not the wind asking where to blow from', () => {
  const salt = JSON.parse(readFileSync(new URL('../mods/disaster-salt-wind.json', import.meta.url), 'utf8')) as ContentPack;
  const sim = new Sim({ seed: 8, scenario: 'sandbox', content: [salt], overrides: { n: 12, vegetation: 1 } });
  for (const t of ['salt wind', 'salt gale', 'brine wind', 'a salt wind here']) {
    const p = sim.parse(t);
    assert.ok(p.ok, `${t}: ${p.msg}`);
    assert.equal(p.resolved?.[0].kind, 'salt-wind', t);
    const r = sim.applyNow({ k: 'freeform', text: t });
    assert.ok(r.ok, `${t}: ${r.msg}`);
  }
  // the plain wind still asks where it should blow from
  assert.match(sim.parse('wind').msg ?? '', /Blow from where/);
  assert.ok(sim.u.god.disasters.filter((d) => d.kind === 'salt-wind').length >= 4);
});

test('worlds named in the words of any act: the act lands there (a place on it when one is needed), a moon let fall by name, the star by its colour', () => {
  const sim = new Sim({ seed: 1, scenario: 'twoworlds-late', overrides: { n: 12 } });
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!, selene = u.planets.find((p) => p.name === 'Selene')!;
  // a world by the first letters of its name, after a verb of unmaking
  assert.deepEqual(one(sim, 'unmake Rus'), { k: 'world.erase', world: rust.id });
  assert.deepEqual(one(sim, 'crack Sele'), { k: 'world.crack', world: selene.id });
  // a moon by name, let fall on its world
  for (const t of ['drop Selene', 'let Selene fall on Gaia', 'crash Selene into Gaia']) assert.deepEqual(one(sim, t), { k: 'world.moon-fall', world: gaia.id, moon: selene.id }, t);
  // a world put nearer its star
  assert.equal(one(sim, 'put Rust closer to the sun').world, rust.id);
  // acts on a world named without a place: on that world, at a place on it
  const rain = one(sim, 'rain on Rust');
  assert.equal(rain.k, 'water.rain');
  assert.equal(rain.planet, rust.id);
  assert.ok(Array.isArray(rain.pos), 'a place on Rust to rain on');
  assert.equal(one(sim, 'teach Rust rockets').planet, rust.id);
  const warm = one(sim, 'make Rust warmer');
  assert.deepEqual([warm.k, warm.path, warm.planet, warm.value], ['set', 'climate.offset', rust.id, rust.st.climateOffset + 5]);
  assert.deepEqual(one(sim, 'kill everyone on Rust'), { k: 'life.kill', species: 'hive', planet: rust.id });
  // a people sent to a world is set down there (not where they came from), a band of them, not one
  const sent = one(sim, 'send the plains folk of Gaia to Rust');
  assert.deepEqual([sent.k, sent.species, sent.planet], ['life.spawn-people', 'plains-folk', rust.id]);
  const band = one(sim, 'set down a people on Rust');
  assert.equal(band.k, 'life.spawn-people');
  assert.equal(band.count, undefined, 'a people is a band (the command\'s own count), not one person');
  assert.equal(band.species, 'hive', 'the people that would fare best there');
  // the star by its colour
  assert.deepEqual(one(sim, 'turn the star red'), { k: 'star.set', kind: 'M' });
  assert.deepEqual(one(sim, 'make the sun blue'), { k: 'star.set', kind: 'B' });
  assert.equal(one(sim, 'make the sky red').k, 'planet.atmosphere', 'a red sky is not a red star');
  // and they do it, on the world named
  const r = sim.applyNow({ k: 'freeform', text: 'drop Selene' });
  assert.ok(r.ok, r.msg);
  assert.ok(u.god.disasters.some((d) => d.kind === 'moon-fall' && d.planet === gaia.id));
  const k = sim.applyNow({ k: 'freeform', text: 'rain on Rust' });
  assert.ok(k.ok, k.msg);
});
