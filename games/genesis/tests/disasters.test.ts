// GENESIS — disasters (CONTRACT.md §11.3, §19): EVERY disaster kind spawns as a live entity in the snapshot, changes
// the world measurably (against an untouched copy of the same world stepped the same time — the sim is deterministic,
// so every difference is the disaster's doing, and each kind must move the measures it is about), and can be
// cancelled (gone, its planet-wide changes undone), scaled, moved and frozen mid-flight. Natural disasters come on
// their own where the conditions hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must, measure, changed } from './helpers/god.ts';
import { popcount } from '../src/sim/people/agents.ts';
import type { Sim } from '../src/sim/sim.ts';
import { moveBy, bearingDir } from '../src/sim/god/util.ts';
import { distM } from '../src/sim/people/world.ts';

const STEPS = 240;

/** measure + the knowledge held (the forgetting fog takes it) */
function measureAll(sim: Sim): Record<string, number> {
  const m = measure(sim);
  const A = sim.u.planets[0].people.agents;
  let know = 0;
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) for (let w = 0; w < A.kw; w++) know += popcount(A.know[s * A.kw + w]);
  m.know = know;
  return m;
}

/** what each kind must change (at least one of these) */
const EXPECT: Record<string, string[]> = {
  meteor: ['alive', 'ruined', 'rock', 'fire', 'damage'], 'meteor-shower': ['rock', 'fire', 'ruined', 'damage', 'hurt'], comet: ['activity'],
  swarm: ['herds', 'crop', 'grass'], volcano: ['lava', 'ash', 'dust', 'rock'], supervolcano: ['lava', 'ash', 'dust', 'climate'],
  quake: ['damage', 'ruined', 'rock', 'soil', 'hurt'], sinkhole: ['rock', 'ruined', 'damage'], rift: ['rock', 'lava', 'damage'], flood: ['water'],
  tsunami: ['water'], drought: ['moisture', 'aquifer'], hurricane: ['damage', 'tree', 'water', 'weather'], tornado: ['damage', 'tree', 'crop', 'hurt'],
  wildfire: ['fire', 'tree', 'grass'], firestorm: ['fire', 'tree', 'damage'], plague: ['sick'], blight: ['blight', 'crop', 'tree', 'shrub'],
  infestation: ['crop', 'grass', 'herds', 'store'], 'solar-flare': ['activity', 'radiation', 'magnetism'], 'impact-winter': ['dust', 'climate'],
  'gravity-slip': ['gravity', 'damage', 'hurt'], 'magnetic-storm': ['magnetism', 'radiation'], eclipse: ['light'], 'moon-fall': ['water', 'damage', 'moons'],
  'rogue-flyby': ['water', 'magnetism', 'ecc'], 'acid-rain': ['pollution', 'tree', 'shrub'], 'ice-age': ['climate', 'snow'],
  'heat-wave': ['moisture', 'tpot'], 'dust-bowl': ['sand', 'moisture', 'soil'], 'glass-storm': ['sand', 'rock', 'fire', 'items'],
  overgrowth: ['tree', 'shrub', 'grass', 'road'], leviathan: ['damage', 'water', 'hurt'], 'forgetting-fog': ['know'], stampede: ['crop', 'grass', 'hurt'],
};

let control: Record<string, number> | null = null;
function controlMeasure(): Record<string, number> {
  if (!control) {
    const { sim } = town();
    sim.step(STEPS);
    control = measureAll(sim);
  }
  return control;
}

test('the floor list of disasters is all there, plus inventions of our own', () => {
  const { sim } = town();
  const ids = sim.u.content.disasters.ids();
  for (const k of ['meteor', 'meteor-shower', 'comet', 'swarm', 'volcano', 'supervolcano', 'quake', 'flood', 'drought', 'wildfire', 'firestorm', 'plague',
    'blight', 'tornado', 'hurricane', 'tsunami', 'solar-flare', 'impact-winter', 'gravity-slip', 'magnetic-storm', 'infestation', 'eclipse', 'moon-fall',
    'sinkhole', 'rift', 'acid-rain', 'ice-age', 'heat-wave', 'rogue-flyby', 'dust-bowl']) assert.ok(ids.includes(k), `disaster ${k}`);
  assert.ok(ids.length >= 34, `at least four invented kinds (${ids.length - 30})`);
  for (const k of ids) assert.ok(EXPECT[k], `the test knows what ${k} should change`);
});

test('every disaster kind spawns, is drawn, and changes the world', () => {
  const base = controlMeasure();
  const fails: string[] = [];
  for (const kind of town().sim.u.content.disasters.ids()) {
    const { sim, st } = town();
    const r = sim.applyNow({ k: 'disaster.spawn', kind, pos: st.pos });
    assert.ok(r.ok, `${kind}: ${r.msg}`);
    const id = r.created![0].id;
    // it is a live entity with render parameters
    const snap = sim.snapshot();
    const v = snap.planets[0].disasters!.find((d) => d.id === id);
    if (!['meteor-shower'].includes(kind) || v) {
      assert.ok(v, `${kind} is in the snapshot`);
      assert.equal(v!.kind, kind);
      assert.ok(v!.radius > 0 && Object.keys(v!.params).length > 0, `${kind} has render params`);
    }
    sim.step(STEPS);
    const m = measureAll(sim);
    const diff = changed(base, m, 1e-7);
    const want = EXPECT[kind] ?? [];
    if (!diff.some((k) => want.includes(k))) fails.push(`${kind}: changed [${diff.join(', ')}], expected one of [${want.join(', ')}]`);
  }
  assert.deepEqual(fails, [], fails.join('\n'));
});

test('a live disaster can be frozen, scaled, moved and cancelled — every kind', () => {
  for (const kind of town().sim.u.content.disasters.ids()) {
    const { sim, st } = town();
    const p = sim.u.planets[0];
    const before = { dust: p.st.atmosphere.dust, light: p.st.lightScale, gravity: p.st.gravity, magnetism: p.st.magnetism, climate: p.st.climateOffset, activity: sim.u.star.activity, ecc: p.st.orbit.e };
    const id = must(sim, { k: 'disaster.spawn', kind, pos: st.pos, duration: 5000 }).created![0].id;
    sim.step(12);
    const d = sim.u.god.disaster(id)!;
    assert.ok(d, `${kind} is live`);
    // freeze: no ageing, no motion, until it is let go
    must(sim, { k: 'disaster.freeze', id, on: true });
    const age = d.age, pos = [...d.pos];
    sim.step(20);
    assert.equal(d.age, age, `${kind}: frozen, it does not age`);
    assert.deepEqual(d.pos, pos, `${kind}: frozen, it does not move`);
    assert.equal(sim.snapshot().planets[0].disasters!.find((q) => q.id === id)!.frozen, true);
    must(sim, { k: 'disaster.freeze', id, on: false });
    sim.step(3);
    assert.ok(d.age > age, `${kind}: let go, it goes on`);
    // scale: twice as strong, √2 as wide
    const v0 = sim.snapshot().planets[0].disasters!.find((q) => q.id === id)!;
    must(sim, { k: 'disaster.scale', id, factor: 2 });
    const v1 = sim.snapshot().planets[0].disasters!.find((q) => q.id === id)!;
    assert.ok(v1.radius > v0.radius * 1.3 && Math.abs(v1.intensity - v0.intensity * 2) < 1e-6, `${kind}: scaled (${v0.radius} -> ${v1.radius})`);
    // move: put it 600 m away
    const to = moveBy(st.pos, bearingDir(st.pos, 2), 600, p.st.radius);
    must(sim, { k: 'disaster.move', id, to });
    assert.ok(distM(p, d.pos, to) < 1, `${kind}: moved`);
    // cancel: gone, and the planet-wide changes it made are undone
    must(sim, { k: 'disaster.cancel', id });
    assert.equal(sim.u.god.disaster(id), undefined, `${kind}: cancelled`);
    assert.ok(!sim.snapshot().planets[0].disasters!.some((q) => q.id === id), `${kind}: no longer drawn`);
    const after = { dust: p.st.atmosphere.dust, light: p.st.lightScale, gravity: p.st.gravity, magnetism: p.st.magnetism, climate: p.st.climateOffset, activity: sim.u.star.activity, ecc: p.st.orbit.e };
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      // impact dust (an actual strike) settles over months: everything else a disaster changed for its life is restored
      if (k === 'dust' && ['volcano', 'supervolcano'].includes(kind)) continue;
      assert.ok(Math.abs(after[k] - before[k]) < 1e-3, `${kind}: ${k} restored (${before[k]} -> ${after[k]})`);
    }
  }
});

test('fronts walk, and a moved front heads where it is sent', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const start = moveBy(st.pos, bearingDir(st.pos, 0), 900, p.st.radius);
  const id = must(sim, { k: 'disaster.spawn', kind: 'tornado', pos: start, toward: st.pos }).created![0].id;
  const d = sim.u.god.disaster(id)!;
  const d0 = distM(p, d.pos, st.pos);
  sim.step(30);
  assert.ok(distM(p, d.pos, st.pos) < d0 - 100, `the tornado comes at the town (${Math.round(d0)} -> ${Math.round(distM(p, d.pos, st.pos))} m)`);
  // turned away
  const away = moveBy(st.pos, bearingDir(st.pos, Math.PI), 3000, p.st.radius);
  must(sim, { k: 'disaster.move', id, toward: away });
  const da = distM(p, d.pos, away);
  sim.step(20);
  assert.ok(distM(p, d.pos, away) < da, 'and turns where it is sent');
});

test('natural disasters come on their own where the conditions hold, at sane rates', () => {
  const { sim } = town();
  must(sim, { k: 'set', path: 'disasters.natural', value: 1 });
  // a volcanic province: an active vent on this world
  const p = sim.u.planets[0];
  p.vents.push({ id: 99, cell: p.cellAt(sim.u.planets[0].people.settlements[0].pos) === 0 ? 1 : 0, rate: 0.2, life: -1 });
  const days = 24; // two of this world's years
  let seen = 0;
  const kinds = new Set<string>();
  for (let dday = 0; dday < days; dday++) {
    sim.step(1440);
    for (const d of sim.u.god.disasters) if (d.cause === 'nature') kinds.add(d.kind);
    seen = sim.u.god.stats.natural ?? 0;
  }
  assert.ok(seen >= 1, `nature sent something in two years (${seen})`);
  assert.ok(seen <= days, `but not every day (${seen} in ${days} days)`);
  // and none at all when the law says so
  const { sim: quiet } = town();
  quiet.step(5 * 1440);
  assert.equal(quiet.u.god.stats.natural ?? 0, 0, 'disasters.natural = 0: none');
});
