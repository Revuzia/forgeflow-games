// GENESIS — ecology (CONTRACT.md §10): predators and prey live together on a world nobody touches; take the predators
// away and the prey boom (and overshoot); a herd cut off from its kind for years in a new home becomes a species of its own.
// Closed worlds (no herds drifting in), so what is measured is the dynamics, not immigration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { animalDef, habitatFit } from '../src/sim/life/herds.ts';
import { newHome } from '../src/sim/life/ecology.ts';
import type { Herd } from '../src/sim/people/state.ts';

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

test('a herd cut off from its kind for years in a country its kind is not made for becomes a new species', () => {
  // (LIVING §4.5: 6-12 years of isolation, and a home outside its kind's biomes or comfort — here a forest warmer than a
  // deer's: the year it splits is the lineage's own, 6-12 years in)
  const { sim } = closedWorld(5);
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const P = p.grid.pos;
  const deer = x.c.animals.idx('deer');
  const away = (c: number) => habitatFit(x, deer, c) > 0.4 && newHome(x, { cell: c, envT: p.s.tempMean[c] } as Herd, animalDef(x, deer));
  let centre = -1, best = -1;
  for (let c = 0; c < p.count; c += 5) {
    if (!away(c)) continue;
    let v = 0;
    for (const o of p.cellsNear([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], 900)) if (away(o)) v++;
    if (v > best) { best = v; centre = c; }
  }
  assert.ok(best > 40, `a patch of new country (${best} cells)`);
  assert.ok(sim.applyNow({ k: 'life.spawn-animal', species: 'deer', count: 10, pos: [P[centre * 3], P[centre * 3 + 1], P[centre * 3 + 2]] }).ok);
  // (LIVING CONTENT r2) the rest of its kind lives on far away, in deer country: a herd is cut off FROM its kind — the
  // last deer of a world are the kind itself, not a population cut off from it
  const dot = (a: number, b: number) => P[a * 3] * P[b * 3] + P[a * 3 + 1] * P[b * 3 + 1] + P[a * 3 + 2] * P[b * 3 + 2];
  const farDot = Math.cos(6000 / p.st.radius);
  let home = -1, hb = 0;
  for (let c = 0; c < p.count; c += 3) {
    if (dot(c, centre) > farDot || newHome(x, { cell: c, envT: p.s.tempMean[c] } as Herd, animalDef(x, deer))) continue;
    const v = habitatFit(x, deer, c);
    if (v > hb) { hb = v; home = c; }
  }
  assert.ok(home >= 0 && hb > 0.5, `deer country far away (fit ${hb.toFixed(2)})`);
  const homeRing = p.cellsNear([P[home * 3], P[home * 3 + 1], P[home * 3 + 2]], 400).filter((c) => habitatFit(x, deer, c) > 0.4);
  for (let k = 0; k < 3; k++) { const c = homeRing[(k * 7919) % homeRing.length]; assert.ok(sim.applyNow({ k: 'life.spawn-animal', species: 'deer', count: 9, pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]] }).ok); }
  for (const h of p.people.herds) h.inv = -1;
  const year = p.st.orbit.period;
  let born: string | null = null, when = 0;
  for (let q = 1; q <= 52 && !born; q++) {
    sim.step(Math.round(year / 4));
    const d = p.people.species[0];
    if (d) { born = d.def.name; when = q / 4; }
  }
  assert.ok(born, 'a new species arose within thirteen years of isolation');
  assert.ok(when >= 6, `not before six years (${when})`);
  const d = p.people.species[0];
  assert.equal(animalDef(x, d.idx).name, born);
  assert.ok(d.idx >= x.c.animals.size, 'a species index of its own');
  assert.equal(x.c.animals.list[d.base].id, 'deer', 'drawn as its ancestor');
  assert.ok(p.people.herds.some((h) => h.species === d.idx), 'herds of the new species live');
  assert.ok(p.people.herds.some((h) => h.species === deer && h.count >= 1), 'and the deer live on in their own country');
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
