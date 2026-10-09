// GENESIS — scenarios (CONTRACT.md §12.4): every scenario builds and runs; 'system' is a real solar system with
// peoples at different ages (a people at the edge of rockets, a cold-world people, methane drifters); 'twoworlds-late'
// starts close enough to space that a crossing happens on its own within days (here, in Node; in the browser at 100x
// within half an hour); the barren start announces its milestones (air, the first rain, the first sea, the first
// green, the first people, their first night, their fire, their settlement) once each, and the worlds that start
// alive have theirs marked silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { ERAS } from '../src/sim/content.ts';
import { MILESTONES } from '../src/sim/chronicle.ts';
import { cohortTotal } from '../src/sim/people/cohorts.ts';
import type { Command, SimEvent } from '../src/sim/types.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { siteScore } from '../src/sim/people/settlement.ts';
import { DAY, must, shipsLine, until } from './helpers/space.ts';

const people = (sim: Sim, planet: number): number => {
  const p = sim.u.planets[planet];
  let n = 0;
  for (const st of p.people.settlements) if (st.fallen < 0) n += (p.people.members.get(st.id)?.length ?? 0) + cohortTotal(st);
  return n;
};

test('every scenario builds, runs, and saves', () => {
  const ids = new Sim({ seed: 1, scenario: 'barren', overrides: { n: 8 } }).content.scenarios.ids();
  for (const id of ['barren', 'sandbox', 'twoworlds', 'twoworlds-late', 'system', 'lookdev']) assert.ok(ids.includes(id), id);
  for (const id of ids) {
    const sim = new Sim({ seed: 5, scenario: id, overrides: { n: 12 } });
    const def = sim.content.scenarios.get(id);
    const moons = def.planets.reduce((n, d) => n + (d.moons?.length ?? 0), 0);
    assert.equal(sim.u.planets.length, def.planets.length + moons, `${id}: every world and moon made`);
    for (const pe of (def.peoples ?? []) as { species: string; planet: number }[]) {
      const w = sim.u.planets.findIndex((p) => p.name === def.planets[pe.planet].name);
      assert.ok(w >= 0 && people(sim, w) > 0, `${id}: ${pe.species} on ${def.planets[pe.planet].name}`);
    }
    sim.step(30);
    assert.equal(Sim.load(sim.save()).hash(), sim.hash(), `${id}: saves`);
  }
});

test('system: four to six worlds, peoples at different ages — one at the edge of rockets, a cold people, methane drifters', () => {
  const sim = new Sim({ seed: 99, scenario: 'system', overrides: { n: 16 } });
  const u = sim.u;
  const worlds = u.planets.filter((p) => p.st.orbit.parent < 0);
  assert.ok(worlds.length >= 4 && worlds.length <= 7, `${worlds.length} worlds`);
  const kinds = new Set(worlds.map((p) => p.st.kind));
  assert.ok(kinds.size >= 4, `kinds: ${[...kinds].join(', ')}`);
  const inhabited = u.planets.filter((p) => people(sim, u.planets.indexOf(p)) > 0);
  assert.ok(inhabited.length >= 4, `${inhabited.length} inhabited worlds`);
  const eraOf = (sp: string) => {
    for (const p of u.planets) for (const st of p.people.settlements) if (st.fallen < 0 && sim.content.species.list[st.species].id === sp) return { p, st, era: ERAS[st.era] };
    return null;
  };
  const eras = new Set(['plains-folk', 'coastal-folk', 'hive', 'cold-folk', 'methane-drifters'].map((sp) => eraOf(sp)?.era));
  assert.ok(eras.size >= 3, `ages: ${[...eras].join(', ')}`);
  // the cold people on the ice world, the methane drifters on the methane world
  const cold = eraOf('cold-folk')!, drift = eraOf('methane-drifters')!;
  assert.equal(cold.p.st.kind, 'ice');
  assert.equal(drift.p.st.kind, 'methane');
  // the plains folk: electric, liquid-fuel rockets known, orbital flight not yet
  const gaia = eraOf('plains-folk')!;
  assert.equal(gaia.era, 'electric');
  const chain = sim.query('chain', { planet: gaia.p.id, settlement: gaia.st.id }) as { kind: string; missing: string[]; gaps: string[] }[];
  const rocket = chain.find((c) => c.kind === 'rocket')!;
  assert.ok(!rocket.missing.includes('liquid-fuel-rocket'), 'liquid-fuel rockets known');
  assert.ok(rocket.missing.includes('orbital-rocket'), 'orbital flight still to find');
  assert.ok(rocket.missing.length <= 4, `close: ${rocket.missing.join(', ')}`);
  // everyone lives through the first hours
  sim.step(240);
  for (const p of inhabited) assert.ok(people(sim, u.planets.indexOf(p)) > 0, `${p.name} still peopled`);
});

test('twoworlds-late: a ship crosses to the other world on its own within days', () => {
  const sim = new Sim({ seed: 1, scenario: 'twoworlds-late', overrides: { n: 24 } });
  const t0 = Date.now();
  const gaia = sim.u.planets.find((p) => p.name === 'Gaia')!, rust = sim.u.planets.find((p) => p.name === 'Rust')!;
  const c0 = sim.u.chronicle.length;
  const days = until(sim, () => sim.u.space.ships.some((s) => s.visits.some((w) => w !== s.home)), 20, 'a crossing');
  const sh = sim.u.space.ships.find((s) => s.visits.some((w) => w !== s.home))!;
  const there = sh.visits.find((w) => w !== sh.home)!;
  assert.ok([gaia.id, rust.id].includes(there) && [gaia.id, rust.id].includes(sh.home), shipsLine(sim));
  assert.ok(sim.u.space.firsts.landing !== undefined, 'the first landing is remembered');
  const text = sim.u.chronicle.slice(c0).map((e) => e.text).join('\n');
  assert.match(text, /orbit|sky|climbed|rose/i, 'the chronicle tells the launch');
  // wall clock only reported: Node at n = 24 is not the browser at 100x
  console.log(`# crossing after ${days.toFixed(1)} game days (${((Date.now() - t0) / 1000).toFixed(0)} s in Node): ${shipsLine(sim)}`);
});

test('twoworlds-late at full size and the 1000x preset, on the app\'s own seed: a ship stands on the other world within a fortnight', () => {
  // (the browser's world: Gaia n = 64, Rust n = 48, time-lapse level 2 as the worker sets it at 1000x)
  const t0 = Date.now();
  const sim = new Sim({ seed: 20260, scenario: 'twoworlds-late' });
  must(sim, { k: 'time.scale', scale: 1000 });
  const gaia = sim.u.planets.find((p) => p.name === 'Gaia')!;
  assert.equal(gaia.grid.n, 64);
  const days = until(sim, () => sim.u.space.ships.some((s) => s.visits.some((w) => w !== s.home)), 16, 'a crossing at full size');
  const sh = sim.u.space.ships.find((s) => s.visits.some((w) => w !== s.home))!;
  assert.equal(sh.home, gaia.id);
  console.log(`# full size, 1000x, seed 20260: crossing after ${days.toFixed(1)} game days (${((Date.now() - t0) / 1000).toFixed(0)} s in Node): ${shipsLine(sim)}`);
});

test('barren: the milestones come in order, each once; living worlds have theirs marked silently', () => {
  // a living start: every milestone that already holds is marked, none announced — on EVERY world of it (a desert
  // world's lakes filling in its first hours are not its first sea, a people's first dusk is not their first night)
  for (const scen of ['twoworlds', 'twoworlds-late', 'lookdev']) {
    const live = new Sim({ seed: 3, scenario: scen, overrides: { n: 12 } });
    const e0 = live.drainEvents();
    assert.equal(e0.filter((e) => e.t === 'milestone').length, 0, `${scen}: no fanfare for what was always there`);
    const g = live.u.planets[0];
    for (const k of ['air', 'first-green', 'first-people', 'first-night']) assert.ok(g.firsts[`m:${k}`] !== undefined, `${scen} ${g.name}: ${k} marked`);
    const c0 = live.u.chronicle.length;
    live.step(240);
    const told = live.drainEvents().filter((e) => e.t === 'milestone').map((e) => `${live.u.planet(e.planet ?? -1)?.name}:${(e.data as { kind: string }).kind}`);
    assert.deepEqual(told, [], `${scen}: nothing announced in the first hours`);
    assert.ok(!live.u.chronicle.slice(c0).some((e) => /the first sea lay under the sky|Rain fell for the first time/.test(e.text)), `${scen}: no first sea`);
  }

  const sim = new Sim({ seed: 20260, scenario: 'barren', overrides: { n: 24 } });
  const u = sim.u;
  const p = u.planets[0];
  const day = p.st.dayHours * 60;
  const seen: string[] = [];
  const drain = () => { for (const e of sim.drainEvents() as SimEvent[]) if (e.t === 'milestone') seen.push((e.data as { kind: string }).kind); };
  drain();
  assert.equal(seen.join(), '', 'a dead world: nothing to tell yet');
  must(sim, { k: 'planet.add-air', amount: 1 });
  sim.step(60);
  drain();
  assert.equal(seen.join(), 'air');
  for (let d = 0; d < 14; d++) sim.step(day);
  must(sim, { k: 'weather.global', kind: 'storm' });
  must(sim, { k: 'water.sea-level', value: -40 });
  sim.step(day);
  must(sim, { k: 'weather.global', kind: 'none' });
  sim.step(2 * day);
  drain();
  assert.ok(seen.includes('first-rain') && seen.includes('first-sea'), seen.join(', '));
  must(sim, { k: 'life.plant', species: 'meadow-grass', lat: 0, lon: 0, radius: 12000, density: 0.8 });
  must(sim, { k: 'life.forest', lat: 10, lon: -30, radius: 1400 });
  sim.step(day);
  drain();
  assert.ok(seen.includes('first-green'), seen.join(', '));
  const x = makeCtx(u, p);
  let best = -1, bs = -Infinity;
  for (let c = 0; c < p.count; c++) { const v = siteScore(x, 0, c); if (v > bs) { bs = v; best = c; } }
  const pos = [p.grid.pos[best * 3], p.grid.pos[best * 3 + 1], p.grid.pos[best * 3 + 2]];
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, pos } as Command);
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  must(sim, { k: 'idea.teach', knowledge: 'fire-keeping', settlement: sid } as Command);
  must(sim, { k: 'idea.teach', knowledge: 'fire-making', settlement: sid } as Command);
  sim.step(60);
  drain();
  assert.ok(seen.includes('first-people'), seen.join(', '));
  for (let d = 0; d < 12 && !(seen.includes('first-fire') && seen.includes('first-night') && seen.includes('first-settlement')); d++) { sim.step(day); drain(); }
  for (const k of ['first-night', 'first-fire', 'first-settlement']) assert.ok(seen.includes(k), `${k} (${seen.join(', ')})`);
  // each once, in the order they happened, and only the known kinds
  assert.equal(new Set(seen).size, seen.length, 'each once');
  for (const k of seen) assert.ok((MILESTONES as readonly string[]).includes(k), k);
  assert.ok(seen.indexOf('air') < seen.indexOf('first-rain') && seen.indexOf('first-rain') <= seen.indexOf('first-sea') + 1 && seen.indexOf('first-green') < seen.indexOf('first-people'));
  // the milestones survive a save: no second announcement after loading
  const back = Sim.load(sim.save());
  back.drainEvents();
  back.step(DAY);
  assert.equal(back.drainEvents().filter((e) => e.t === 'milestone' && seen.includes((e.data as { kind: string }).kind)).length, 0);
});
