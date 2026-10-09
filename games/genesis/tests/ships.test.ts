// GENESIS — ships between the worlds (CONTRACT.md §12, §19): the recipe chain is the law (no chain, no launch — not by
// nature, not by the god's push, not without fuel); with it a people builds, fuels and crews a ship that launches,
// circles its world, crosses on a curve to the other world's predicted place and comes down; there it meets whoever
// lives there — goods of two worlds change hands both ways, sicknesses cross both ways, faith crosses both ways — or
// founds a colony with what its crew know; a stone-age people takes the visitors for gods; flights can fail; and a
// world saved with a ship between the worlds loads and lives on identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { late, must, town, ctx, until, ship, told, shipsLine, DAY } from './helpers/space.ts';
import { seedDisease } from '../src/sim/life/disease.ts';
import { storeTake, storeAdd } from '../src/sim/people/store.ts';
import { reliabilityOf } from '../src/sim/space/flight.ts';
import { shipWhere } from '../src/sim/space/transit.ts';
import { GODS, NS, SKILL } from '../src/sim/people/defs.ts';

const meanLove = (sim: Sim, planet: number, sid: number, g: number): number => {
  const x = ctx(sim, planet);
  let s = 0, n = 0;
  for (const m of x.ps.members.get(sid) ?? []) { s += x.A.love[m * GODS + g]; n++; }
  return n ? s / n : 0;
};

test('no chain, no launch: a stone-age system never flies, and the god\'s push is refused with what is missing', () => {
  const sim = new Sim({ seed: 5, scenario: 'twoworlds', overrides: { n: 16 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  must(sim, { k: 'set', path: 'space.drive', value: 20 });
  for (let d = 0; d < 6; d++) sim.step(DAY);
  assert.equal(sim.u.space.ships.length, 0, 'nobody built a ship');
  assert.equal(sim.snapshot().ships.length, 0);
  const gaia = sim.u.planets.find((p) => p.name === 'Gaia')!;
  const r = sim.applyNow({ k: 'ship.launch', planet: gaia.id });
  assert.equal(r.ok, false);
  assert.match(r.msg ?? '', /cannot build a ship: .*do not know .*orbital rockets/i);
  assert.match(r.msg ?? '', /an airship: /);
  assert.doesNotMatch(r.msg ?? '', /\ba (airship|orbiter)\b/);
  assert.equal(sim.u.space.ships.length, 0);
});

test('no chain, no launch: one idea short of the chain, or no fuel, and the rocket never leaves the ground', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  // the god takes guidance away: the chain is broken
  must(sim, { k: 'settlement.withdraw', planet: gaia.id, settlement: home.id, idea: 'guidance-systems' });
  const x = ctx(sim, gaia.id);
  assert.ok(!home.library.includes(x.rt.byId.get('guidance-systems')!), 'guidance is gone from the library');
  const r = sim.applyNow({ k: 'ship.launch', planet: gaia.id, settlement: home.id, kind: 'rocket' });
  assert.equal(r.ok, false, r.msg);
  assert.match(r.msg ?? '', /guidance/i);
  // and on its own (eager as can be) it does not start one either
  must(sim, { k: 'set', path: 'space.drive', value: 20 });
  for (let d = 0; d < 4; d++) sim.step(DAY);
  assert.ok(!u.space.ships.some((s) => s.kind === 'rocket'), shipsLine(sim));

  // a people that knows everything but has no fuel: the program waits at the pad, and never launches
  const sim2 = late();
  const g2 = sim2.u.planets.find((p) => p.name === 'Gaia')!;
  const h2 = town(sim2, g2.id);
  const fuel = sim2.u.content.items.idx('rocket-fuel');
  storeTake(h2, fuel, 1e9);
  // (no oil to refine into more)
  storeTake(h2, sim2.u.content.items.idx('crude-oil'), 1e9);
  must(sim2, { k: 'set', path: 'space.drive', value: 0 });
  const rr = must(sim2, { k: 'ship.launch', planet: g2.id, settlement: h2.id, to: sim2.u.planets.find((p) => p.name === 'Rust')!.id });
  const sid = rr.created![0].id;
  for (let d = 0; d < 8; d++) { sim2.step(DAY); storeTake(h2, fuel, 1e9); }
  const sh = ship(sim2, sid);
  assert.ok(['building', 'fuelling', 'done'].includes(sh.phase), `still on the ground: ${sh.phase}`);
  assert.equal(sh.launchTick, -1, 'it never launched');
  assert.equal(sh.crew.length, 0);
});

test('with the chain: a rocket is built, fuelled, crewed, launched, crosses, meets the hive — goods, sickness and faith cross both ways — and comes home', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!;
  const home = town(sim, gaia.id), hive = town(sim, rust.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  // the plains folk worship the player; the hive is given a god of its own
  must(sim, { k: 'belief.sway', planet: gaia.id, settlement: home.id, feeling: 'worship' });
  must(sim, { k: 'rival.add', planet: rust.id, settlement: hive.id, name: 'Kesh', temperament: 'benevolent' });
  must(sim, { k: 'belief.sway', planet: rust.id, settlement: hive.id, feeling: 'convert', toGod: 1 });
  const from = u.chronicle.length;
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: rust.id, purpose: 'trade' });
  const sid = r.created!.find((e) => e.kind === 'ship')!.id;
  const sh = () => ship(sim, sid);
  // built by its people: the hull made at the pad from the store, fuelled, crewed
  until(sim, () => sh().phase === 'fuelling', 12, 'the hull is made');
  until(sim, () => ['ascent', 'orbit', 'transfer'].includes(sh().phase), 12, 'launch');
  assert.ok(sh().crew.length >= 3, `${sh().crew.length} aboard`);
  assert.ok(sh().reliability > 0.9);
  // the crew are no longer agents of Gaia
  for (const m of sh().crew) assert.equal(gaia.people.agents.slotOf(m.id), -1);
  // a sickness aboard (the flux: any people can catch it)
  const flux = u.content.diseases.idx('bloody-flux');
  const m0 = sh().crew[0];
  m0.disease = flux; m0.infectT = sim.tick; m0.sickEnd = sim.tick + 25 * DAY;
  // in orbit, then on its curve between the worlds (system frame), then near Rust (its body frame)
  until(sim, () => sh().phase === 'transfer', 2, 'transfer');
  const mid = Math.round((sh().t0 + sh().t1) / 2);
  const w = shipWhere(u, sh(), mid, 'interplanetary');
  assert.equal(w.planet, -1, 'between the worlds');
  const end = shipWhere(u, sh(), sh().t1, 'interplanetary');
  assert.equal(end.planet, rust.id, 'the curve ends at Rust where it will be');
  // a plague rages on Rust as they arrive
  until(sim, () => sim.tick >= sh().arriveTick - 1.5 * DAY, 10, 'nearly there');
  assert.ok(seedDisease(ctx(sim, rust.id), hive, u.content.diseases.idx('plague'), 40, 'rats') > 0);
  const love0 = meanLove(sim, rust.id, hive.id, 0);
  const hiveStore0 = hive.store.slice();
  until(sim, () => sh().phase === 'landed' && sh().to === rust.id, 4, 'arrival on Rust');
  const lines = told(sim, from).join('\n');
  assert.match(lines, /first ship ever to leave Gaia|For the first time a ship left Gaia/);
  assert.match(lines, /first orbit/);
  assert.match(lines, /another world/);
  assert.match(lines, /two worlds met|First contact between worlds/);
  assert.equal(sh().outcome, 'trade');
  assert.ok(u.space.relations.length === 1 && u.space.relations[0].trade > 0, 'a relation between the worlds, with trade');
  // goods of Gaia in the hive's store
  const gained = hive.store.map((q, i) => (q ?? 0) - (hiveStore0[i] ?? 0)).map((d, i) => [i, d] as [number, number]).filter(([, d]) => d > 0.4);
  assert.ok(gained.length >= 1, 'the hive got goods of another world');
  // a sickness crossed to the natives, and one crossed to the crew
  assert.match(lines, /visitors from Gaia carried bloody flux|bloody flux/i);
  // (natives -> crew, said in the ship's log and the chronicle the moment it happens)
  assert.match(sh().log.join(' | '), /\d+ of the crew caught the black plague at /, sh().log.join(' | '));
  assert.match(lines, /caught the black plague/);
  // faith crossed: the hive warmed to the visitors' god; the crew took the hive's god to heart
  assert.ok(meanLove(sim, rust.id, hive.id, 0) > love0 + 0.02, `${love0} -> ${meanLove(sim, rust.id, hive.id, 0)}`);
  assert.ok(sh().crew.every((m) => m.love[1] >= 0.1), 'the crew love Kesh now');
  // home again, with the goods, the sickness and the faith of Rust (unloaded into the store the tick it lands)
  until(sim, () => sh().phase === 'descent' && sh().to === gaia.id, 12, 'coming down at home');
  while (sh().phase === 'descent' && sim.tick < sh().t1) sim.step(1);
  // (what is left of the crew's food is eaten at once: the goods are what came from Rust)
  const back = sh().cargo.filter(([i]) => !u.content.items.list[i].tags.includes('food')).map(([i, q]) => [i, q] as [number, number]);
  assert.ok(back.length >= 1, 'goods of Rust aboard');
  const homeStore0 = home.store.slice();
  sim.step(1);
  assert.equal(sh().phase, 'landed');
  assert.match(told(sim, from).join('\n'), /came home to .* from Rust, laden with/);
  for (const [i, q] of back) assert.ok((home.store[i] ?? 0) - (homeStore0[i] ?? 0) >= q * 0.9, `${u.content.items.list[i].id} in the home store`);
  const x = ctx(sim, gaia.id);
  const returned = (x.ps.members.get(home.id) ?? []).filter((s) => x.A.love[s * GODS + 1] >= 0.1);
  assert.ok(returned.length >= 1, 'people of Gaia now love the god of Rust');
  assert.ok(sh().visits.includes(rust.id));
});

test('a stone-age people takes the visitors for gods (a visitor pseudo-god when the visitors have none), and settlers found a colony with their knowledge', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  // the plains folk of Gaia worship no god at all
  home.god = -1;
  const xg = ctx(sim, gaia.id);
  for (const m of xg.ps.members.get(home.id) ?? []) for (let g = 0; g < GODS; g++) xg.A.love[m * GODS + g] = 0;
  const eden = must(sim, { k: 'world.birth', kind: 'terran', name: 'Eden', distance: 1.15, n: 20, life: 1, people: 'plains-folk', count: 24 }).created![0].id;
  const nat = u.planet(eden)!.people.settlements[0];
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: eden, purpose: 'curiosity' });
  const sid = r.created![0].id;
  // (the god's own push stirs their hearts: before they come down they have forgotten it, a people of no faith)
  until(sim, () => ship(sim, sid).phase === 'transfer' && sim.tick >= ship(sim, sid).t1 - 90, 30, 'nearly at Eden');
  home.god = -1;
  for (const m of xg.ps.members.get(home.id) ?? []) for (let g = 0; g < GODS; g++) xg.A.love[m * GODS + g] = 0;
  for (const m of ship(sim, sid).crew) m.love = m.love.map(() => 0);
  until(sim, () => ship(sim, sid).phase === 'landed' && ship(sim, sid).to === eden, 30, 'arrival on Eden');
  assert.equal(ship(sim, sid).outcome, 'worship');
  const vg = u.god.gods.find((g) => g.kind === 'visitor');
  assert.ok(vg, 'a visitor pseudo-god');
  assert.match(vg!.name, /Sky-Folk of Gaia/);
  assert.equal(nat.god, vg!.id);
  assert.ok(meanLove(sim, eden, nat.id, vg!.id) > 0.3, 'they love the sky-folk');
  assert.ok(nat.culture.sacred.includes(`god:${vg!.id}`));
  assert.match(told(sim).join('\n'), /began to worship|were gods/);

  // settlers: a colony on an empty green world, with what the crew know
  const haven = must(sim, { k: 'world.birth', kind: 'terran', name: 'Haven', distance: 0.9, n: 20, life: 1 }).created![0].id;
  const r2 = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: haven, purpose: 'colony' });
  const s2 = r2.created![0].id;
  until(sim, () => ship(sim, s2).phase === 'transfer' && sim.tick >= ship(sim, s2).t1 - 60, 40, 'nearly at Haven');
  // what the crew know is what the colony knows (each of them, whole households)
  const known = new Set<number>();
  for (const m of ship(sim, s2).crew) for (const k of m.know) known.add(k);
  assert.ok(known.size > 20, `${known.size} ideas aboard`);
  until(sim, () => ship(sim, s2).phase === 'landed' && ship(sim, s2).to === haven, 5, 'arrival on Haven');
  const col = u.space.colonies.find((c) => c.planet === haven);
  assert.ok(col, 'a colony record');
  const hp = u.planet(haven)!;
  const st = hp.people.settlement(col!.settlement)!;
  assert.ok(st && !st.band && st.fallen < 0, 'the colony stands');
  assert.ok((hp.people.members.get(st.id)?.length ?? 0) >= 3);
  for (const k of known) assert.ok(st.library.includes(k), `they brought ${ctx(sim, haven).rt.list[k].id} with them`);
  assert.ok(st.library.includes(ctx(sim, haven).rt.byId.get('astronomy')!), 'a rocket people know the sky');
  assert.match(told(sim).join('\n'), /founded .* on Haven|came down from the sky of Haven and founded/);
  assert.equal(st.species, home.species);
  // the colony keeps its people's tongue (drifted) and culture
  assert.notEqual(st.langSeed, home.langSeed);
  assert.deepEqual(st.langLine.slice(0, home.langLine.length), home.langLine);
});

test('flights can fail: no reliability and the ship is lost with all aboard; an unskilled crew is less reliable', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 0 });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: u.planets.find((p) => p.name === 'Rust')!.id });
  const sid = r.created![0].id;
  const from = u.chronicle.length;
  until(sim, () => ship(sim, sid).phase === 'lost', 20, 'lost');
  const sh = ship(sim, sid);
  assert.ok(sh.dead >= 3, `${sh.dead} died`);
  assert.equal(sh.crew.length, 0);
  assert.ok(sh.lostAt, 'where it was lost');
  assert.match(told(sim, from).join('\n'), /exploded|broke apart|lost|crashed|never reached|fell silent/);
  assert.ok(sim.snapshot().ships.some((v) => v.id === sid && v.phase === 'lost'), 'the wreck is drawn');
  // skill matters: the same crew with no skill flies less reliably
  const x = ctx(sim, gaia.id);
  const crew = (x.ps.members.get(home.id) ?? []).slice(0, 4);
  const def = u.content.ships.get('rocket');
  must(sim, { k: 'set', path: 'space.reliability', value: 1 });
  const skilled = reliabilityOf(u, x, home, crew, def);
  for (const s of crew) { x.A.skills[s * NS + SKILL.sail] = 0; x.A.skills[s * NS + SKILL.lore] = 0; }
  const green = reliabilityOf(u, x, home, crew, def);
  assert.ok(green < skilled, `${green} < ${skilled}`);
  assert.ok(skilled < 1 && green > 0.3);
});

test('a world saved with a ship between the worlds (and two peopled worlds) loads identically and lives on identically', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: u.planets.find((p) => p.name === 'Rust')!.id, purpose: 'trade' });
  const sid = r.created![0].id;
  until(sim, () => ship(sim, sid).phase === 'transfer', 20, 'in flight');
  sim.step(DAY);
  assert.equal(ship(sim, sid).phase, 'transfer');
  assert.ok(u.planets.filter((p) => p.people.agents.count > 0).length >= 2, 'two peopled worlds');
  const bytes = sim.save();
  const back = Sim.load(bytes);
  assert.equal(back.hash(), sim.hash(), 'the same world');
  assert.deepEqual(back.snapshot().ships, sim.snapshot({ drain: false }).ships);
  for (let i = 0; i < 6; i++) { sim.step(DAY / 2); back.step(DAY / 2); }
  assert.equal(back.hash(), sim.hash(), 'and the same future (arrival, contact, crew set down)');
  assert.equal(back.u.space.ship(sid)!.phase, sim.u.space.ship(sid)!.phase);
});

test('the hull\'s goods are set aside at the pad: a town that spends every bar of steel it has still finishes its rocket; given up, they go back', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'set', path: 'space.drive', value: 0 });
  const steel = u.content.items.idx('steel'), engine = u.content.items.idx('rocket-engine');
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: rust.id, purpose: 'trade' });
  const sid = r.created![0].id;
  const sh = ship(sim, sid);
  // the hour it starts: the parts of the hull are the ship's own, out of the store
  const set = (it: number) => sh.stock.filter(([i]) => i === it).reduce((q, [, n]) => q + n, 0);
  assert.equal(set(steel), 20);
  assert.equal(set(engine), 3);
  // the builders and smiths take every bar left in the store, day after day
  for (let d = 0; d < 4 && sh.phase === 'building'; d++) { storeTake(home, steel, 1e9); sim.step(DAY); }
  assert.notEqual(sh.phase, 'building', `the hull was made of the steel set aside (${sh.log.join(' | ')})`);
  assert.ok(sh.hull >= 0);
  // a chain read for the launch counts what is set aside as theirs
  const chain = sim.query('chain', { planet: gaia.id, settlement: home.id }) as { kind: string; gaps: string[] }[];
  assert.deepEqual(chain.find((c) => c.kind === 'rocket')!.gaps, [], 'nothing missing for a launch');
  // and a program given up gives everything back
  const r2 = must(sim, { k: 'ship.cancel', ship: sid });
  assert.match(r2.msg ?? '', /will not fly/);
  assert.equal(sh.stock.length, 0);
  assert.ok((home.store[u.content.items.idx('orbital-rocket')] ?? 0) >= 1, 'the hull stands in the store again');
});

test('settlers go to a world whose air would kill them only sealed: suits for every one, water to drink, a dome begun', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'set', path: 'space.speed', value: 10 });
  must(sim, { k: 'set', path: 'space.drive', value: 0 });
  // a green world with water, and air without oxygen
  const mire = must(sim, { k: 'world.birth', kind: 'terran', name: 'Mire', distance: 1.05, n: 16, life: 1 }).created![0].id;
  must(sim, { k: 'planet.atmosphere', planet: mire, o2: 0, n2: 0.9, co2: 0.1 });
  // no suits: they will not go (in words)
  const no = sim.applyNow({ k: 'ship.launch', planet: gaia.id, settlement: home.id, to: mire, purpose: 'colony' });
  assert.equal(no.ok, false);
  assert.match(no.msg ?? '', /will not settle Mire: its air would kill them, and 0 pressure suits for \d+ settlers/);
  // suits for all, and the making of a dome
  const x = ctx(sim, gaia.id);
  storeAdd(x, home, u.content.items.idx('pressure-suit'), 30);
  storeAdd(x, home, u.content.items.idx('concrete'), 40);
  storeAdd(x, home, u.content.items.idx('orbital-rocket'), 1);
  must(sim, { k: 'idea.teach', planet: gaia.id, settlement: home.id, knowledge: 'habitat-domes', force: true });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: mire, purpose: 'colony' });
  const sid = r.created![0].id;
  until(sim, () => ['ascent', 'orbit', 'transfer'].includes(ship(sim, sid).phase), 20, 'launch');
  const aboard = ship(sim, sid).crew.length;
  const suits = ship(sim, sid).cargo.filter(([i]) => u.content.items.list[i].tags.includes('suit')).reduce((q, [, n]) => q + n, 0);
  assert.ok(suits >= aboard, `a suit for each of the ${aboard} (${suits})`);
  until(sim, () => u.space.colonies.some((c) => c.ship === sid), 20, 'the colony on Mire');
  const col = u.space.colonies.find((c) => c.ship === sid)!;
  const mp = u.planet(mire)!;
  const xm = ctx(sim, mire);
  const members = xm.ps.members.get(col.settlement) ?? [];
  const suitT = u.content.items.idx('pressure-suit');
  assert.ok(members.length >= 3 && members.every((s) => xm.A.gear[s] === suitT), 'everyone in a suit');
  assert.ok(mp.people.buildings.some((b) => b.settlement === col.settlement && u.content.buildings.list[b.type].id === 'habitat-dome'), 'a dome begun');
  assert.match(told(sim).join('\n'), /founded .* in sealed suits; they began to raise a dome|walk in sealed suits while their first dome rises/);
  const n0 = members.length;
  sim.step(4 * DAY);
  const n1 = xm.ps.members.get(col.settlement)?.length ?? 0;
  assert.ok(n1 >= n0 - 1, `they live sealed (${n0} -> ${n1})`);
});

test('a visit with no fuel to fly home on an airless world: its crew stay sealed in the ship, and the chronicle says so', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, selene = u.planets.find((p) => p.name === 'Selene')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'set', path: 'space.drive', value: 0 });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: selene.id, purpose: 'curiosity' });
  const sid = r.created![0].id;
  until(sim, () => ship(sim, sid).phase === 'descent', 20, 'coming down on Selene');
  assert.ok(ship(sim, sid).fuelBack.length > 0, 'a visit carries its fuel home');
  // the fuel for the way back leaks away on the way down
  ship(sim, sid).fuelBack = [];
  until(sim, () => ship(sim, sid).phase === 'landed', 1, 'landed');
  const sh = ship(sim, sid);
  assert.equal(sh.outcome, 'outpost');
  assert.equal(sh.t1, -1);
  assert.ok(sh.crew.length >= 3, 'still aboard');
  assert.ok(!u.space.colonies.some((c) => c.ship === sid), 'no colony in the vacuum');
  assert.match(told(sim).join('\n'), /stayed sealed inside|could neither breathe nor leave/);
  assert.ok(sim.snapshot().ships.some((v) => v.id === sid && v.phase === 'landed' && v.crew === sh.crew.length));
});

test('a visit waits for fuel to fly home; with fuel for one way only it goes only to a world its crew could live on', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, selene = u.planets.find((p) => p.name === 'Selene')!;
  const home = town(sim, gaia.id);
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'set', path: 'space.drive', value: 0 });
  const fuel = u.content.items.idx('rocket-fuel');
  // the hull's fuel and one way's worth: no more (and no oil to refine)
  storeTake(home, u.content.items.idx('crude-oil'), 1e9);
  storeTake(home, fuel, 1e9);
  storeAdd(ctx(sim, gaia.id), home, fuel, 40);
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: home.id, to: selene.id, purpose: 'curiosity' });
  const sid = r.created![0].id;
  // (and no more fuel will come: the god takes refining away from them)
  must(sim, { k: 'settlement.withdraw', planet: gaia.id, settlement: home.id, idea: 'oil-refining' });
  for (let d = 0; d < 16; d++) sim.step(DAY);
  const sh = ship(sim, sid);
  assert.equal(sh.launchTick, -1, `never launched toward an airless moon on one way's fuel (${sh.phase}: ${sh.log.join(' | ')})`);
  assert.ok(['fuelling', 'done'].includes(sh.phase));
  // toward a green world they could live on, it goes when the fuel for the way home does not come
  const sim2 = late();
  const g2 = sim2.u.planets.find((p) => p.name === 'Gaia')!;
  const h2 = town(sim2, g2.id);
  must(sim2, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim2, { k: 'set', path: 'space.drive', value: 0 });
  storeTake(h2, sim2.u.content.items.idx('crude-oil'), 1e9);
  storeTake(h2, fuel, 1e9);
  storeAdd(ctx(sim2, g2.id), h2, fuel, 40);
  const haven = must(sim2, { k: 'world.birth', kind: 'terran', name: 'Haven', distance: 1.1, n: 16, life: 1 }).created![0].id;
  const r2 = must(sim2, { k: 'ship.launch', planet: g2.id, settlement: h2.id, to: haven, purpose: 'curiosity' });
  const s2 = r2.created![0].id;
  must(sim2, { k: 'settlement.withdraw', planet: g2.id, settlement: h2.id, idea: 'oil-refining' });
  until(sim2, () => ship(sim2, s2).launchTick >= 0, 25, 'one way to Haven');
  assert.match(ship(sim2, s2).log.join(' | '), /Fuel for the way out only: they mean to stay/);
  until(sim2, () => ship(sim2, s2).visits.includes(haven), 15, 'on Haven');
  until(sim2, () => ship(sim2, s2).crew.length === 0, 3, 'they stay');
  assert.ok(sim2.u.space.colonies.some((c) => c.ship === s2 && c.planet === haven), 'they made a home there');
});

test('left alone, the late two worlds trade again and again, and sickness and faith cross between them', () => {
  const sim = late();
  const u = sim.u;
  const rust = u.planets.find((p) => p.name === 'Rust')!;
  const c0 = u.chronicle.length;
  let trades = 0, launches = 0;
  for (let d = 0; d < 32; d++) {
    sim.step(DAY);
    for (const e of sim.drainEvents()) {
      if (e.t === 'trade' && (e.data as { worlds?: boolean })?.worlds) trades++;
      if (e.t === 'launch') launches++;
    }
  }
  const lines = told(sim, c0).join('\n');
  console.log(`# ${trades} trade meetings, ${launches} launches in 32 days`);
  assert.ok(trades >= 2, `trade runs once the road is known (${trades})`);
  assert.ok(u.space.relations.some((r) => r.trade > 0 && (r.b.startsWith(`${rust.id}:`) || r.a.startsWith(`${rust.id}:`))));
  // sickness crossed (either way), faith crossed
  assert.match(lines, /visitors from Gaia carried|caught .* among the hive|visitors from Gaia caught|crew back from Rust/);
  assert.match(lines, /spoke of .* and some there listened|began to worship|Sky-Folk/);
});
