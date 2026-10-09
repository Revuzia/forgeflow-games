// GENESIS — ecology (CONTRACT.md §10): predators and prey live together on a world nobody touches; take the predators
// away and the prey boom (and overshoot); a herd cut off from its kind for years becomes a species of its own.
// Closed worlds (no herds drifting in), so what is measured is the dynamics, not immigration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { animalDef, habitatFit } from '../src/sim/life/herds.ts';

/** a small living world emptied of animals, with a patch of good country for deer and wolves; returns spots in it */
function closedWorld(seed = 11): { sim: Sim; at: (k: number) => number[] } {
  const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 24, vegetation: 1 } });
  const p = sim.u.planets[0];
  const ps = p.people;
  ps.eco.immigration = false;
  ps.herds = [];
  ps.hIndex.clear();
  ps.eco.seen = {};
  const x = makeCtx(sim.u, p);
  const P = p.grid.pos;
  const deer = x.c.animals.idx('deer'), wolf = x.c.animals.idx('wolf');
  const good = (c: number) => habitatFit(x, deer, c) > 0.5 && habitatFit(x, wolf, c) > 0.5;
  let centre = -1, best = -1;
  for (let c = 0; c < p.count; c += 5) {
    if (!good(c)) continue;
    let v = 0;
    for (const o of p.cellsNear([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], 900)) if (good(o)) v++;
    if (v > best) { best = v; centre = c; }
  }
  const ring = p.cellsNear([P[centre * 3], P[centre * 3 + 1], P[centre * 3 + 2]], 900).filter(good).sort((a, b) => a - b);
  assert.ok(ring.length > 40, `a patch of good country (${ring.length} cells)`);
  const at = (k: number) => { const c = ring[(k * 2654435761 >>> 0) % ring.length]; return [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]; };
  return { sim, at };
}

function populate(sim: Sim, at: (k: number) => number[], packs: number): void {
  for (let k = 0; k < 8; k++) assert.ok(sim.applyNow({ k: 'life.spawn-animal', species: 'deer', count: 9, pos: at(k) }).ok);
  for (let k = 12; k < 12 + packs; k++) assert.ok(sim.applyNow({ k: 'life.spawn-animal', species: 'wolf', count: 4, pos: at(k) }).ok);
  // they belong here (not invaders with no enemies)
  for (const h of sim.u.planets[0].people.herds) h.inv = -1;
}

/** head counts by kind: prey (grazers) and predators */
function census(sim: Sim): { prey: number; pred: number } {
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  let prey = 0, pred = 0;
  for (const h of p.people.herds) {
    const a = animalDef(x, h.species);
    if (a.kind === 'predator') pred += h.count; else if (a.kind === 'herbivore') prey += h.count;
  }
  return { prey, pred };
}

test('predators and prey coexist for five game years on a closed world', () => {
  const { sim, at } = closedWorld();
  populate(sim, at, 2);
  const year = sim.u.planets[0].st.orbit.period;
  const log: string[] = [];
  for (let q = 1; q <= 20; q++) {
    sim.step(Math.round(year / 4));
    const c = census(sim);
    log.push(`y${(q / 4).toFixed(2)} prey ${c.prey.toFixed(0)} predators ${c.pred.toFixed(1)}`);
    assert.ok(c.pred >= 2, `predators still hunting: ${log.join(' | ')}`);
    assert.ok(c.prey >= 10, `prey still grazing: ${log.join(' | ')}`);
  }
  const lines = sim.u.chronicle.map((e) => e.text);
  assert.ok(!lines.some((t) => /(wolves|deer) .* (died|gone)/i.test(t) && /last/i.test(t)), `no extinction: ${lines.filter((t) => /last/.test(t)).join(' / ')}`);
});

test('without predators the prey boom', () => {
  const peak = (packs: number, cull: boolean): number => {
    const { sim, at } = closedWorld();
    populate(sim, at, packs);
    if (cull) assert.ok(sim.applyNow({ k: 'life.cull', species: 'wolf' }).ok);
    const year = sim.u.planets[0].st.orbit.period;
    let max = 0;
    for (let q = 1; q <= 10; q++) { sim.step(Math.round(year / 4)); max = Math.max(max, census(sim).prey); }
    if (!cull) assert.ok(census(sim).pred >= 2, 'the predators lived');
    return max;
  };
  const hunted = peak(3, false);
  const free = peak(3, true);
  assert.ok(free > hunted * 1.2, `prey peak without predators ${free.toFixed(0)} vs with ${hunted.toFixed(0)}`);
});

test('a herd cut off from its kind for years becomes a new species', () => {
  const { sim, at } = closedWorld(5);
  assert.ok(sim.applyNow({ k: 'life.spawn-animal', species: 'deer', count: 10, pos: at(3) }).ok);
  const p = sim.u.planets[0];
  for (const h of p.people.herds) h.inv = -1;
  const x = makeCtx(sim.u, p);
  const year = p.st.orbit.period;
  let born: string | null = null;
  for (let q = 1; q <= 28 && !born; q++) {
    sim.step(Math.round(year / 4));
    const d = p.people.species[0];
    if (d) born = d.def.name;
  }
  assert.ok(born, 'a new species arose within seven years of isolation');
  const d = p.people.species[0];
  assert.equal(animalDef(x, d.idx).name, born);
  assert.ok(d.idx >= x.c.animals.size, 'a species index of its own');
  assert.equal(x.c.animals.list[d.base].id, 'deer', 'drawn as its ancestor');
  assert.ok(p.people.herds.some((h) => h.species === d.idx), 'herds of the new species live');
  const line = sim.u.chronicle.find((e) => e.kind === 'speciation');
  assert.ok(line && line.text.toLowerCase().includes(born!.toLowerCase()), `chronicled: ${line?.text}`);
  // the snapshot shows it with its ancestor's body
  const snap = sim.snapshot({ full: true });
  const block = snap.planets[0].animals!;
  assert.ok(block.count > 0);
  for (let i = 0; i < block.count; i++) assert.ok(block.species[i] < x.c.animals.size, 'snapshot species are drawable bodies');
  // the inspector knows where it came from
  const eco = sim.query('ecology') as { species: { name: string; bornHere: { from: string } | null }[] };
  assert.ok(eco.species.some((s) => s.name === born && s.bornHere?.from === 'Deer'));
});
