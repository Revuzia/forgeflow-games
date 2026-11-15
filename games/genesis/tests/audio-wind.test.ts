// The wind bed (scene.ts lay.wind): owner 2026-11-13 heard the wind "always". In calm air near the ground it must be
// silent (a zero floor, with hysteresis so a breeze at the threshold does not flutter), and still rise with real wind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneProbe, type ScenePlanet, type SceneWorld } from '../src/audio/scene.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import type { FieldName, PlanetParams } from '../src/sim/types.ts';

const R = 3000;
const grid = getGrid(64);

function planet(windSpeed: number): ScenePlanet {
  const fields = new Map<FieldName, Float32Array>();
  const mk = (v: number): Float32Array => new Float32Array(grid.count).fill(v);
  fields.set('biome', mk(7)); fields.set('temperature', mk(21));
  fields.set('windX', mk(windSpeed)); fields.set('windY', mk(0)); fields.set('windZ', mk(0));
  const params = {
    radius: R, gravity: 9.8, dayHours: 24, axialTilt: 0, spin: 0, sunFrozen: false, seasonPinned: null, seaLevel: 0, magnetism: 1,
    atmosphere: { pressure: 1, o2: 0.21, co2: 0.0004, n2: 0.78, methane: 0, dust: 0, tint: null, toxicity: 0 },
    orbit: { parent: -1, a: 1e7, e: 0, inc: 0, phase0: 0, period: 17280, node: 0 }, cloudiness: 0.3, globalWeather: null, kind: 'terran',
    year: 1, dayOfYear: 0, yearDays: 12, hourAtLon0: 12,
  } as PlanetParams;
  return { id: 0, grid, params, fields, settlements: [], weather: [], disasters: [], center: [0, 0, 0], quat: [0, 0, 0, 1], sunDir: [0, 0, 1] };
}

function wind(speed: number, alt: number, probe = new SceneProbe()): number {
  const w: SceneWorld = { planets: [planet(speed)] };
  return probe.probe(w, { pos: [0, 0, R + alt], quat: [0, 0, 0, 1], planet: 0, altitude: alt }).layers.wind;
}

test('calm air near the ground: the wind bed is silent, not a constant hiss', () => {
  for (const alt of [1, 3, 8, 14]) assert.equal(wind(0, alt), 0, `wind bed at ${alt} m in still air`);
});

test('the bed returns with real wind, and with height', () => {
  assert.ok(wind(8, 3) > 0.02, 'a breeze is heard');
  assert.ok(wind(20, 3) > wind(8, 3), 'a gale is louder than a breeze');
  assert.ok(wind(0, 400) > 0.1, 'high above even still air, the sky is heard');
  assert.ok(wind(0, 400) > wind(0, 100), 'and it grows with height');
});

test('hysteresis: a wind hovering at the threshold does not flutter the bed on and off', () => {
  const rising = new SceneProbe();
  assert.equal(wind(2.5, 3, rising), 0, 'a faint stir from silence stays silent');
  const heard = new SceneProbe();
  assert.ok(wind(8, 3, heard) > 0, 'up');
  assert.ok(wind(2.5, 3, heard) > 0, 'the same faint stir stays heard once the bed is up');
  assert.equal(wind(0, 3, heard), 0, 'silent again in still air');
});
