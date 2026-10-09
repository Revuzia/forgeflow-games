// GENESIS — every kind of ship flies (CONTRACT.md §12): an uncrewed orbiter set circling for good (its people then see
// every world); an airship over its own world — its settlers found a town far from home, its traders meet a neighbour
// people as neighbours do, never as a meeting of worlds, and the airship that came home flies again; a star gate whose
// ring rises for days while the program waits on it, then a crossing in minutes; a generation ship that takes whole
// families, never a partner without the other. Each is a recipe chain its people must know, built at its own pad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { late, must, town, ctx, until, ship, told, shipsLine, DAY } from './helpers/space.ts';
import { storeAdd } from '../src/sim/people/store.ts';
import { sightLevel } from '../src/sim/space/ships.ts';
import { distM } from '../src/sim/people/world.ts';
import { relationOf } from '../src/sim/people/war.ts';
import type { Sim } from '../src/sim/sim.ts';

const give = (sim: Sim, planet: number, sid: number, items: Record<string, number>) => {
  const x = ctx(sim, planet);
  const st = x.ps.settlement(sid)!;
  for (const [id, q] of Object.entries(items)) storeAdd(x, st, sim.u.content.items.idx(id), q);
};

test('an orbiter goes up with nobody aboard and stays up: its people see every world of the sky', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'idea.teach', planet: gaia.id, settlement: home.id, knowledge: 'orbiters', force: true });
  give(sim, gaia.id, home.id, { radio: 2 });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, kind: 'orbiter' });
  const sid = r.created![0].id;
  assert.equal(ship(sim, sid).purpose, 'survey');
  until(sim, () => ship(sim, sid).phase === 'orbit', 25, 'in orbit');
  const sh = ship(sim, sid);
  assert.equal(sh.crew.length, 0, 'nobody aboard');
  assert.equal(sh.crewIds.length, 0);
  assert.ok(sh.log.includes('Launched with 0 aboard.'), sh.log.join(' | '));
  sim.step(2 * DAY);
  assert.equal(ship(sim, sid).phase, 'orbit', 'it stays up');
  assert.equal(sightLevel(u, ctx(sim, gaia.id), home), 3, 'its people see every world clearly');
  assert.match(told(sim).join('\n'), /orbiter .* circling|went up and stayed up/);
  const view = sim.snapshot().ships.find((v) => v.id === sid)!;
  assert.equal(view.phase, 'orbit');
  assert.equal(view.planet, gaia.id);
});

test('an airship: settlers come down far from home and found a town; traders meet a neighbour as neighbours; the airship flies again', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  // what a gas bag over a steam engine is made of, and coal to burn (both ways)
  give(sim, gaia.id, home.id, { cloth: 30, rope: 12, coal: 30 });
  const c0 = u.chronicle.length;
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, kind: 'airship', purpose: 'colony' });
  const sid = r.created![0].id;
  assert.equal(ship(sim, sid).to, gaia.id, 'an airship stays over its own world');
  const days = until(sim, () => u.space.colonies.some((c) => c.ship === sid), 40, 'an air colony');
  const col = u.space.colonies.find((c) => c.ship === sid)!;
  assert.equal(col.planet, gaia.id);
  const st = gaia.people.settlement(col.settlement)!;
  assert.ok(st.fallen < 0 && (gaia.people.members.get(st.id)?.length ?? 0) >= 3, 'the colony stands');
  const away = distM(gaia, st.pos, home.pos);
  assert.ok(away >= 800, `well away from home (${away.toFixed(0)} m)`);
  assert.ok(gaia.people.buildings.some((b) => b.settlement === home.id && u.content.buildings.list[b.type].id === 'airship-mast' && b.progress >= 1), 'a mast was raised');
  // over its own world: no meeting of worlds, no first contact, no relation between worlds
  assert.equal(u.space.firsts.contact, undefined);
  assert.equal(u.space.relations.length, 0);
  assert.ok(!told(sim, c0).some((t) => /First contact between worlds|two worlds met/.test(t)));
  assert.match(told(sim, c0).join('\n'), /airship .* cast off|sailed into the sky aboard the airship/);
  console.log(`# air colony after ${days.toFixed(1)} days, ${away.toFixed(0)} m from home`);

  // a people of another polity on the same world: the traders' airship meets them as neighbours
  const far = must(sim, { k: 'life.spawn-people', planet: gaia.id, species: 'plains-folk', count: 30, era: 'iron', settled: true, lat: -35, lon: 140 });
  const nid = far.created!.find((e) => e.kind === 'settlement')!.id;
  const nb = gaia.people.settlement(nid)!;
  assert.notEqual(nb.polity, home.polity);
  give(sim, gaia.id, home.id, { coal: 30, cloth: 30, rope: 12 });
  const r2 = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, kind: 'airship', purpose: 'trade' });
  const s2 = r2.created![0].id;
  until(sim, () => ship(sim, s2).outcome.includes('trade') || ship(sim, s2).phase === 'done', 30, 'a trade flight');
  assert.match(ship(sim, s2).log.join(' | '), /Traded .* at /);
  const rel = relationOf(ctx(sim, gaia.id), home.polity, nb.polity);
  assert.ok(rel && rel.trade > 0, 'the two polities traded (a relation of their own world)');
  assert.equal(u.space.relations.length, 0, 'still no meeting of worlds');
  until(sim, () => ship(sim, s2).outcome.includes('home'), 10, 'home again');
  // the airship that came home stands ready: the next flight needs only its coal
  assert.ok((home.store[u.content.items.idx('airship')] ?? 0) >= 1, 'the airship is theirs again');
});

test('a star gate: the ring rises for days while its program waits on it, then the crossing takes minutes', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  for (const k of ['gate-theory', 'star-gates']) must(sim, { k: 'idea.teach', planet: gaia.id, settlement: home.id, knowledge: k, force: true });
  give(sim, gaia.id, home.id, { steel: 300, concrete: 300, battery: 30 });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, kind: 'gate', to: rust.id, purpose: 'trade' });
  const sid = r.created![0].id;
  const t0 = sim.tick;
  until(sim, () => ship(sim, sid).phase !== 'building', 60, `the gate rises (${shipsLine(sim)})`);
  const built = (sim.tick - t0) / DAY;
  assert.notEqual(ship(sim, sid).phase, 'done', `not given up: ${ship(sim, sid).log.join(' | ')}`);
  assert.ok(gaia.people.buildings.some((b) => b.settlement === home.id && u.content.buildings.list[b.type].id === 'star-gate' && b.progress >= 1));
  until(sim, () => ship(sim, sid).phase === 'transfer', 10, 'through the gate');
  const sh = ship(sim, sid);
  assert.ok(sh.t1 - sh.t0 <= 0.05 * DAY, `a fold, not a voyage (${sh.t1 - sh.t0} ticks)`);
  until(sim, () => ship(sim, sid).visits.includes(rust.id), 1, 'standing on Rust');
  assert.match(ship(sim, sid).outcome, /trade|worship|silence|war|merger/);
  console.log(`# the gate stood after ${built.toFixed(1)} days`);
});

test('a generation ship takes whole households — nobody leaves a partner behind — and comes down on its new world', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'set', path: 'space.speed', value: 4 });
  must(sim, { k: 'idea.teach', planet: gaia.id, settlement: home.id, knowledge: 'generation-ship', force: true });
  give(sim, gaia.id, home.id, { 'orbital-rocket': 4, steel: 80, grain: 60, medicine: 20, 'rocket-fuel': 80 });
  const haven = must(sim, { k: 'world.birth', kind: 'terran', name: 'Haven', distance: 1.1, n: 16, life: 1 }).created![0].id;
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, kind: 'generation-ship', to: haven, purpose: 'colony' });
  const sid = r.created![0].id;
  until(sim, () => ['ascent', 'orbit', 'transfer'].includes(ship(sim, sid).phase), 40, 'launch');
  const sh = ship(sim, sid);
  assert.ok(sh.crew.length >= 12, `${sh.crew.length} aboard`);
  // a family together or not at all: every partner of someone aboard who still lives at home is... nobody
  const x = ctx(sim, gaia.id);
  const left = sh.crew.filter((m) => m.partner && x.A.slotOf(m.partner) >= 0);
  assert.deepEqual(left.map((m) => m.id), [], 'no partner left behind on Gaia');
  until(sim, () => u.space.colonies.some((c) => c.ship === sid), 30, 'the colony on Haven');
  const col = u.space.colonies.find((c) => c.ship === sid)!;
  assert.equal(col.planet, haven);
  const st = u.planet(haven)!.people.settlement(col.settlement)!;
  assert.ok((u.planet(haven)!.people.members.get(st.id)?.length ?? 0) >= 12);
  assert.match(told(sim).join('\n'), /founded .* on Haven|came down from the sky of Haven and founded/);
});
