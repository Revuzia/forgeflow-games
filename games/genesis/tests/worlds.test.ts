// GENESIS — worlds as the player's verbs (CONTRACT.md §11.1 worlds, §12): birth (a new world of a kind at an orbit,
// generated, green and peopled if asked), move (the year follows Kepler, the day keeps its hour, the climate follows the
// light), crack (quakes and rifts, a debris ring and moonlets, its people killed and its towns broken), erase (everyone
// on it dies; ships bound for it drift stranded), moon-add and moon-fall (the moon spirals in over days, tides grow,
// then it strikes), seed-species, the star remade or flaring over every world — each changes the sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { late, must, town, until, ship, told, DAY } from './helpers/space.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { AU } from '../src/sim/world/orbits.ts';
import { BuildingFlag } from '../src/sim/types.ts';

function small(scenario = 'sandbox', seed = 11): Sim {
  const sim = new Sim({ seed, scenario, overrides: { n: 16, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  return sim;
}

const meanTemp = (sim: Sim, id: number): number => {
  const p = sim.u.planet(id)!;
  let s = 0, a = 0;
  for (let c = 0; c < p.count; c++) { s += p.f.temperature[c] * p.grid.area[c]; a += p.grid.area[c]; }
  return s / a;
};

test('birth: a new world of a kind at an orbit — generated, green, peopled — and a moon for it', () => {
  const sim = small();
  const n0 = sim.u.planets.length;
  const r = must(sim, { k: 'world.birth', kind: 'ocean', name: 'Thalassa', distance: 1.6, life: 1.2, people: 'coastal-folk', count: 20, n: 16 });
  const id = r.created!.find((e) => e.kind === 'planet')!.id;
  const p = sim.u.planet(id)!;
  assert.equal(sim.u.planets.length, n0 + 1);
  assert.equal(p.st.kind, 'ocean');
  assert.ok(Math.abs(p.st.orbit.a / AU - 1.6) < 1e-9);
  assert.ok(p.hydro.oceanCells > p.count * 0.5, 'an ocean world');
  const t = meanTemp(sim, id);
  assert.ok(t > -5 && t < 35, `temperate at 1.6 AU (${t.toFixed(1)} °C): its greenhouse tuned to its light`);
  assert.ok(p.vegTotal > 1, 'green');
  assert.ok(r.created!.some((e) => e.kind === 'settlement'), 'a people on it');
  assert.ok(p.people.agents.count >= 4);
  assert.match(told(sim).join('\n'), /A new world was born: Thalassa/);
  const m = must(sim, { k: 'world.moon-add', world: id, name: 'Lull' });
  const moon = sim.u.planet(m.created![0].id)!;
  assert.equal(moon.st.orbit.parent, id);
  sim.step(DAY / 2);
  const snap = sim.snapshot();
  assert.ok(snap.planets.some((q) => q.id === id) && snap.planets.some((q) => q.id === moon.id));
  assert.ok(p.people.agents.count >= 4, 'they live there');
});

test('move: the year follows Kepler, the hour holds, and the world cools as it goes out', () => {
  const sim = small();
  const g = sim.u.planets[0];
  const T0 = g.st.orbit.period;
  const sun = sim.u.sun(g, sim.tick);
  const h0 = g.paramsAt(sim.tick, sun).hourAtLon0;
  const c0 = sim.u.centerOf(g, sim.tick, [0, 0, 0]);
  const t0 = meanTemp(sim, g.id);
  must(sim, { k: 'world.move', world: g.id, distance: 1.6 });
  assert.ok(Math.abs(g.st.orbit.period / T0 - Math.pow(1.6, 1.5)) < 0.01, `${g.st.orbit.period / T0}`);
  const h1 = g.paramsAt(sim.tick, sim.u.sun(g, sim.tick)).hourAtLon0;
  assert.ok(Math.abs(h1 - h0) < 0.05, `the hour holds (${h0.toFixed(2)} -> ${h1.toFixed(2)})`);
  const c1 = sim.u.centerOf(g, sim.tick, [0, 0, 0]);
  const ang = (v: number[]) => Math.atan2(v[2], v[0]);
  assert.ok(Math.abs(ang(c1) - ang(c0)) < 0.02, 'it stays where it was on its orbit (farther out)');
  for (let d = 0; d < 4; d++) sim.step(DAY);
  const t1 = meanTemp(sim, g.id);
  assert.ok(t1 < t0 - 2, `colder far out: ${t0.toFixed(1)} -> ${t1.toFixed(1)} °C`);
});

test('crack: quakes and rifts, a debris ring and moonlets; its people die and its towns break', () => {
  const sim = small();
  const g = sim.u.planets[0];
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true });
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  sim.step(60);
  const pop0 = g.people.agents.count;
  const planets0 = sim.u.planets.length;
  const dust0 = g.st.atmosphere.dust;
  const res = must(sim, { k: 'world.crack', world: g.id });
  assert.match(res.msg ?? '', /quakes and rifts/);
  assert.ok(g.people.agents.count < pop0, `deaths: ${pop0} -> ${g.people.agents.count}`);
  assert.ok(g.people.buildings.some((b) => b.settlement === sid && (b.damage > 0.2 || b.flags & BuildingFlag.ruined)), 'buildings broken');
  assert.equal(sim.u.planets.length, planets0 + 2, 'two moonlets');
  assert.ok(g.st.ring && g.st.ring.density > 0 && g.st.ring.outer > g.st.ring.inner, 'a debris ring');
  assert.ok(sim.snapshot().planets[0].params.ring, 'the ring is in the snapshot');
  assert.ok(g.st.atmosphere.dust > dust0);
  assert.ok(sim.u.god.disasters.filter((d) => d.planet === g.id && (d.kind === 'quake' || d.kind === 'rift')).length >= 4);
  const rock0 = Float32Array.from(g.f.rock);
  sim.step(120);
  let moved = 0;
  for (let c = 0; c < g.count; c++) if (Math.abs(g.f.rock[c] - rock0[c]) > 0.5) moved++;
  assert.ok(moved > 0, 'the ground split');
  assert.match(told(sim).join('\n'), /cracked/);
});

test('erase: everyone on the world dies, and a ship bound for it drifts stranded', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!;
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  const r = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: town(sim, gaia.id).id, to: rust.id, purpose: 'trade' });
  const sid = r.created![0].id;
  until(sim, () => ship(sim, sid).phase === 'transfer', 20, 'in flight');
  const crew = ship(sim, sid).crew.length;
  assert.ok(rust.people.agents.count > 0);
  const res = must(sim, { k: 'world.erase', world: rust.id });
  assert.match(res.msg ?? '', /gone .*dead.*stranded/);
  assert.equal(rust.alive, false);
  assert.equal(rust.people.agents.count, 0, 'nobody lives');
  assert.match(told(sim).join('\n'), /Rust was unmade, and \d+ souls with it/);
  assert.equal(ship(sim, sid).phase, 'stranded');
  assert.match(told(sim).join('\n'), /no longer there|should have been/);
  const v0 = sim.snapshot().ships.find((s) => s.id === sid)!;
  assert.equal(v0.phase, 'stranded');
  assert.equal(v0.crew, crew);
  // it drifts on, and its people live on what they carry until it runs out
  sim.step(2 * DAY);
  const v1 = sim.snapshot().ships.find((s) => s.id === sid)!;
  assert.ok(Math.hypot(v1.sysPos[0] - v0.sysPos[0], v1.sysPos[1] - v0.sysPos[1], v1.sysPos[2] - v0.sysPos[2]) > 1000, 'drifting');
  assert.ok(!sim.snapshot().planets.find((p) => p.id === rust.id)!.alive);
  // the gone world takes no more commands
  assert.equal(sim.applyNow({ k: 'weather.global', kind: 'rain', planet: rust.id }).ok, false);
});

test('moon-fall: the moon spirals in over days, the tides grow, then it strikes and is gone', () => {
  const sim = small();
  const g = sim.u.planets[0];
  const moon = sim.u.planets.find((q) => q.st.orbit.parent === g.id)!;
  const a0 = moon.st.orbit.a, T0 = moon.st.orbit.period;
  const r = must(sim, { k: 'world.moon-fall', world: g.id, lat: 10, lon: 20 });
  assert.match(r.msg ?? '', /will strike in \d+ days/);
  const did = r.created![0].id;
  const d = sim.u.god.disaster(did)!;
  const life = d.life;
  const surf0 = Float32Array.from(g.f.surface);
  sim.step(Math.round(life * 0.5));
  assert.ok(moon.alive);
  const aMid = moon.st.orbit.a;
  assert.ok(aMid < a0, `spiralling in: ${a0} -> ${aMid}`);
  assert.ok(moon.st.orbit.period < T0, 'a shorter month');
  sim.step(Math.round(life * 0.4));
  assert.ok(moon.st.orbit.a < aMid, 'closer still');
  sim.step(Math.round(life * 0.1) + 30);
  assert.equal(moon.alive, false, 'the moon is gone');
  assert.equal(sim.u.god.disaster(did), undefined);
  let cratered = 0;
  for (let c = 0; c < g.count; c++) if (g.f.surface[c] < surf0[c] - 2) cratered++;
  assert.ok(cratered > 0, 'a colossal impact');
  assert.match(told(sim).join('\n'), /fell out of the sky/);
});

test('seed a species across a world; a methane people cannot breathe there without suits', () => {
  const sim = small();
  const g = sim.u.planets[0];
  must(sim, { k: 'world.seed-species', world: g.id, species: 'deer', count: 3 });
  assert.ok(g.people.herds.some((h) => sim.u.content.animals.list[h.species]?.id === 'deer'));
  const bare = must(sim, { k: 'world.seed-species', world: g.id, species: 'methane-drifters', count: 1, size: 8 });
  assert.match(bare.msg ?? '', /set down/);
  const suited = must(sim, { k: 'life.spawn-people', species: 'methane-drifters', count: 8, lat: -20, lon: 100 });
  const sid = suited.created!.find((e) => e.kind === 'settlement')!.id;
  const x = makeCtx(sim.u, g);
  const suit = x.c.items.idx('pressure-suit');
  for (const s of x.ps.members.get(sid) ?? []) x.A.gear[s] = suit;
  const drifters = x.c.species.idx('methane-drifters');
  const before = new Map<number, number>();
  for (const st of g.people.settlements) if (st.species === drifters) before.set(st.id, x.ps.members.get(st.id)?.length ?? 0);
  sim.step(2 * DAY);
  const alive = (id: number) => g.people.members.get(id)?.length ?? 0;
  for (const [id, n0] of before) {
    if (id === sid) assert.equal(alive(id), n0, 'suited: all alive');
    else assert.ok(alive(id) < n0, `unsuited drifters die in the oxygen air (${n0} -> ${alive(id)})`);
  }
});

test('the star remade warms every world; a flare storms over every one', () => {
  const sim = small('twoworlds', 12);
  const ids = sim.u.planets.filter((p) => p.st.orbit.parent < 0).map((p) => p.id);
  const t0 = ids.map((id) => meanTemp(sim, id));
  must(sim, { k: 'star.set', luminosity: 2.2 });
  sim.step(2 * DAY);
  ids.forEach((id, i) => assert.ok(meanTemp(sim, id) > t0[i] + 1, `${sim.u.planet(id)!.name} warmer`));
  const r = must(sim, { k: 'star.flare', strength: 1.5 });
  assert.match(r.msg ?? '', /flares/);
  for (const p of sim.u.planets) assert.ok(sim.u.god.disasters.some((d) => d.planet === p.id && d.kind === 'solar-flare'), `a flare over ${p.name}`);
  assert.ok(sim.u.star.activity >= 0.8);
  sim.step(60);
});

test('erase vs ships: a program bound for the gone world is given up, a ship still circling home comes back down, a crew abroad whose home is gone stays where it stands', () => {
  // a program still on the ground: given up, its set-aside goods back in the store
  const a = late();
  const ga = a.u.planets.find((p) => p.name === 'Gaia')!, ra = a.u.planets.find((p) => p.name === 'Rust')!;
  const ha = town(a, ga.id);
  must(a, { k: 'set', path: 'space.drive', value: 0 });
  const steel = a.u.content.items.idx('steel');
  const s0 = ha.store[steel];
  const pa = must(a, { k: 'ship.launch', planet: ga.id, settlement: ha.id, to: ra.id, purpose: 'trade' }).created![0].id;
  assert.ok(ha.store[steel] < s0, 'steel set aside');
  must(a, { k: 'world.erase', world: ra.id });
  assert.equal(ship(a, pa).phase, 'done');
  assert.equal(ship(a, pa).outcome, 'abandoned');
  assert.equal(ha.store[steel], s0, 'the steel is back');

  // in orbit of its own world when its target is unmade: it comes back down by its town, its crew walk home
  const b = late();
  const gb = b.u.planets.find((p) => p.name === 'Gaia')!, rb = b.u.planets.find((p) => p.name === 'Rust')!;
  const hb = town(b, gb.id);
  must(b, { k: 'set', path: 'space.reliability', value: 2 });
  must(b, { k: 'set', path: 'space.drive', value: 0 });
  const pb = must(b, { k: 'ship.launch', planet: gb.id, settlement: hb.id, to: rb.id, purpose: 'trade' }).created![0].id;
  until(b, () => ship(b, pb).phase === 'orbit', 20, 'in orbit');
  const crew = ship(b, pb).crew.map((m) => m.id);
  const r = must(b, { k: 'world.erase', world: rb.id });
  assert.match(r.msg ?? '', /Rust is gone/);
  assert.equal(ship(b, pb).phase, 'descent', 'called back down');
  assert.equal(ship(b, pb).to, gb.id);
  until(b, () => ship(b, pb).crew.length === 0, 1, 'home');
  for (const id of crew) assert.ok(gb.people.agents.slotOf(id) >= 0, `crew member ${id} walks on Gaia again`);
  assert.notEqual(ship(b, pb).phase, 'stranded');

  // a crew on Rust when Gaia is unmade: they stay on Rust (no ship 'done' with its crew still aboard)
  const c = late();
  const gc = c.u.planets.find((p) => p.name === 'Gaia')!, rc = c.u.planets.find((p) => p.name === 'Rust')!;
  const hc = town(c, gc.id);
  must(c, { k: 'set', path: 'space.reliability', value: 2 });
  must(c, { k: 'set', path: 'space.drive', value: 0 });
  const pc = must(c, { k: 'ship.launch', planet: gc.id, settlement: hc.id, to: rc.id, purpose: 'trade' }).created![0].id;
  until(c, () => ship(c, pc).phase === 'landed' && ship(c, pc).to === rc.id, 20, 'on Rust');
  const people = ship(c, pc).crew.map((m) => m.id);
  must(c, { k: 'world.erase', world: gc.id });
  c.step(2 * DAY);
  assert.equal(ship(c, pc).crew.length, 0, 'nobody left aboard');
  for (const id of people) assert.ok(rc.people.agents.slotOf(id) >= 0, `${id} lives on Rust now`);
  assert.match(ship(c, pc).log.join(' | '), /Gaia was gone: they stayed on Rust/);
});

test('move: a ship on its way sets its course again for the moved world (no jump at the end of the crossing)', () => {
  const sim = late();
  const u = sim.u;
  const gaia = u.planets.find((p) => p.name === 'Gaia')!, rust = u.planets.find((p) => p.name === 'Rust')!;
  must(sim, { k: 'set', path: 'space.reliability', value: 2 });
  must(sim, { k: 'set', path: 'space.drive', value: 0 });
  const sid = must(sim, { k: 'ship.launch', planet: gaia.id, settlement: town(sim, gaia.id).id, to: rust.id, purpose: 'trade' }).created![0].id;
  until(sim, () => ship(sim, sid).phase === 'transfer', 20, 'in flight');
  sim.step(DAY);
  must(sim, { k: 'world.move', world: rust.id, distance: 2.4 });
  let prev = sim.snapshot({ drain: false }).ships.find((v) => v.id === sid)!.sysPos;
  let worst = 0;
  while (ship(sim, sid).phase === 'transfer' || (ship(sim, sid).phase === 'descent' && sim.tick < ship(sim, sid).t1 - 10)) {
    sim.step(5);
    const v = sim.snapshot({ drain: false }).ships.find((w) => w.id === sid)!;
    worst = Math.max(worst, Math.hypot(v.sysPos[0] - prev[0], v.sysPos[1] - prev[1], v.sysPos[2] - prev[2]));
    prev = v.sysPos;
  }
  // (the worlds move ~10 km a tick in the system frame; a jump to the moved world would be ~2 500 km)
  assert.ok(worst < 300e3, `largest step over 5 ticks: ${(worst / 1000).toFixed(0)} km`);
  until(sim, () => ship(sim, sid).visits.includes(rust.id), 2, 'it reaches the moved world');
});

test('crack: a third to three-fifths of the people die in the first shock, the rest are hurt; towns are broken', () => {
  const sim = small();
  const g = sim.u.planets[0];
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'iron', settled: true });
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  sim.step(60);
  const pop0 = g.people.members.get(sid)?.length ?? 0;
  const res = must(sim, { k: 'world.crack', world: g.id });
  const pop1 = g.people.members.get(sid)?.length ?? 0;
  const share = 1 - pop1 / pop0;
  assert.ok(share >= 0.25 && share <= 0.65, `${pop0} -> ${pop1} (${(share * 100).toFixed(0)} %)`);
  const m = (res.msg ?? '').match(/(\d+) buildings broken/);
  assert.ok(m && Number(m[1]) > 0, res.msg);
});

test('birth with a people: the new world is made warm or cold enough for them; a people that cannot breathe its air is not set down', () => {
  const sim = small();
  for (const [kind, people] of [['ice', 'cold-folk'], ['methane', 'methane-drifters'], ['desert', 'hive']] as const) {
    const r = must(sim, { k: 'world.birth', kind, distance: 1.2, n: 12, life: 1, people, count: 30, era: 'stone' });
    const st = r.created!.find((e) => e.kind === 'settlement');
    assert.ok(st, `${people} set down on a ${kind} world: ${r.msg}`);
    const p = sim.u.planet(r.created![0].id)!;
    const n0 = p.people.members.get(st!.id)?.length ?? 0;
    sim.step(DAY);
    const n1 = p.people.members.get(st!.id)?.length ?? 0;
    assert.ok(n1 >= n0 - 2, `${people} on ${kind} at 1.2 AU live through their first day (${n0} -> ${n1})`);
  }
  const bad = must(sim, { k: 'world.birth', kind: 'methane', distance: 2, n: 12, people: 'plains-folk', count: 20 });
  assert.ok(!bad.created!.some((e) => e.kind === 'settlement'));
  assert.match(bad.msg ?? '', /cannot breathe its air, so none were set on it/);
});

test('a moon\'s chronicle keeps its world\'s years (its month is no year)', () => {
  const sim = small();
  const g = sim.u.planets[0];
  const moon = sim.u.planets.find((q) => q.st.orbit.parent === g.id)!;
  sim.step(5 * DAY);
  must(sim, { k: 'world.crack', world: moon.id });
  const e = sim.u.chronicle.filter((x) => x.planet === moon.id).pop()!;
  assert.match(e.text, /cracked/);
  assert.equal(e.year, g.calendar(sim.tick).year, `dated in ${g.name}'s years`);
  assert.ok(moon.calendar(sim.tick).year > e.year, 'not in the moon\'s own months');
});
