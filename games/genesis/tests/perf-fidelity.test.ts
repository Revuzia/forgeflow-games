// GENESIS — time-lapse fidelity (SIM perf push 2, round 2; src/sim/perf/lapse.ts, CONTRACT §5 note): what the coarser
// cadences of 100x / 1000x and of dormant worlds must keep from real time.
//   * the sea: after a tsunami it calms at 1000x as at 1x (the pipes take 4-tick steps only while the sea is calm);
//   * the energy balance: a multi-hour climate pass steps its hours one by one — a dead moon on its 6-hour dormant passes,
//     an airless world at 1000x and a living world's day / night envelopes keep their real-time temperatures;
//   * the soil: evaporation and infiltration stay hourly (climate.ts soilHour), so soils and wetlands do not dry out.
// Reference values are this file's own 1x runs (same seed, same build), tolerances from measured scatter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Planet } from '../src/sim/world/planet.ts';

function world(seed: number, n: number, scale: number, scenario = 'sandbox'): Sim {
  const sim = new Sim({ seed, scenario, overrides: { n } });
  // natural disasters are random load and random waves: off (the god layer's law)
  assert.ok(sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 }).ok);
  if (scale > 1) assert.ok(sim.applyNow({ k: 'time.scale', scale }).ok);
  return sim;
}

/** area-mean of a per-cell field over the cells `pick` accepts */
function areaMean(p: Planet, a: ArrayLike<number>, pick: (c: number) => boolean = () => true): number {
  let s = 0, w = 0;
  for (let c = 0; c < p.count; c++) if (pick(c)) { s += a[c] * p.cellArea[c]; w += p.cellArea[c]; }
  return s / w;
}

/** sea cells awake every 6 game hours after an 6 m tsunami in the open sea of a small terran world */
function tsunamiAwake(scale: number): number[] {
  const sim = world(1234, 32, scale);
  sim.step(600);
  const p = sim.u.planets[0], P = p.grid.pos;
  let sea = -1;
  for (let c = 0; c < p.count && sea < 0; c++) if (p.s.ocean[c] && p.f.water[c] > 30) sea = c;
  assert.ok(sim.applyNow({ k: 'water.tsunami', planet: p.id, pos: [P[sea * 3], P[sea * 3 + 1], P[sea * 3 + 2]], radius: 300, height: 6 }).ok);
  const out: number[] = [];
  for (let h = 6; h <= 48; h += 6) {
    sim.step(360);
    let k = 0;
    for (let c = 0; c < p.count; c++) if (p.s.hAct[c] && p.s.ocean[c]) k++;
    out.push(k);
  }
  return out;
}

test('time-lapse fidelity: after a tsunami the sea calms at 1000x as it does at 1x', () => {
  // (the 4-tick pipes of 1000x took a quarter of the 1x friction per game tick: the whole sea of this world was still
  // awake two days later, and after a quake on the home world 1000x ran at a third of its speed for days)
  const ref = tsunamiAwake(1), got = tsunamiAwake(1000);
  const sea = 6703;
  assert.ok(ref[2] > sea / 2, `the wave crossed the sea at 1x (${ref.join(' ')})`);
  assert.ok(got[2] > sea / 2, `and at 1000x (${got.join(' ')})`);
  for (const i of [5, 6, 7]) {
    assert.ok(got[i] <= Math.max(120, 2 * ref[i]), `${(i + 1) * 6} h after: ${got[i]} sea cells awake at 1000x, ${ref[i]} at 1x (1x: ${ref.join(' ')}; 1000x: ${got.join(' ')})`);
  }
});

/** the dead moon's area-mean temperature over its third day (hourly samples), and its year mean / envelopes then */
function moonClimate(focusMoon: boolean): { T: number; tYear: number; tHi: number; tLo: number; dormantRuns: number } {
  const sim = world(1234, 16, 1);
  const moon = sim.u.planets.find((p) => !p.airy)!;
  // the camera on the moon keeps it on hourly passes (a watched world is never dormant): the reference
  if (focusMoon) assert.ok(sim.applyNow({ k: 'focus', planet: moon.id, lat: 0, lon: 0 }).ok);
  sim.step(2880);
  let T = 0, runs = 0;
  const key = `${moon.id}:clim`;
  let lastRec = sim.u.settings.lapse?.run[key];
  for (let h = 0; h < 24; h++) {
    sim.step(60);
    T += areaMean(moon, moon.f.temperature) / 24;
    const r = sim.u.settings.lapse?.run[key];
    if (r !== undefined && r !== lastRec) { runs++; lastRec = r; }
  }
  return { T, tYear: areaMean(moon, moon.s.tempYear), tHi: areaMean(moon, moon.s.tHi), tLo: areaMean(moon, moon.s.tLo), dormantRuns: runs };
}

test('dormant worlds: the dead moon on 6-hour passes keeps the temperatures of hourly passes', () => {
  // (one 6-hour semi-implicit step linearised at the starting temperature overshot radiative equilibrium on airless
  // ground: the dormant moon ran ~30 °C warm, its year mean ~25 °C)
  const hourly = moonClimate(true), dormant = moonClimate(false);
  assert.ok(dormant.dormantRuns >= 3, `the moon ran its climate ${dormant.dormantRuns} times on its dormant schedule in a day`);
  const d = (k: 'T' | 'tYear' | 'tHi' | 'tLo') => Math.abs(dormant[k] - hourly[k]);
  const msg = `dormant T ${dormant.T.toFixed(2)} tYear ${dormant.tYear.toFixed(2)} tHi ${dormant.tHi.toFixed(2)} tLo ${dormant.tLo.toFixed(2)} | ` +
    `hourly ${hourly.T.toFixed(2)} ${hourly.tYear.toFixed(2)} ${hourly.tHi.toFixed(2)} ${hourly.tLo.toFixed(2)}`;
  assert.ok(d('T') < 1.5, `day-mean temperature: ${msg}`);
  assert.ok(d('tYear') < 1, `year mean: ${msg}`);
  assert.ok(d('tHi') < 2 && d('tLo') < 2, `the year's envelopes: ${msg}`);
});

/** a world's area-mean temperature over its third day (hourly samples) */
function dayMeanT(scenario: string, scale: number, n: number): number {
  const sim = world(1234, n, scale, scenario);
  sim.step(2880);
  const p = sim.u.planets[0];
  let T = 0;
  for (let h = 0; h < 24; h++) { sim.step(60); T += areaMean(p, p.f.temperature) / 24; }
  return T;
}

test('time-lapse fidelity: an airless world keeps its temperature at 100x and 1000x', () => {
  // (the barren opening world, in focus: 1x -42.6 °C; one 6-hour step per pass gave -36 at 100x and -2 at 1000x)
  const ref = dayMeanT('barren', 1, 16);
  for (const scale of [100, 1000]) {
    const got = dayMeanT('barren', scale, 16);
    assert.ok(Math.abs(got - ref) < 1, `${scale}x: ${got.toFixed(2)} °C, 1x ${ref.toFixed(2)} °C`);
  }
});

/** a terran world's land climate: the year envelopes and mean after two days, and the day / night range of the
 * temperature field over the third (sampled every 10 ticks, as a player or a system reading it sees it) */
function landClimate(scale: number): { tHi: number; tLo: number; tYear: number; range: number } {
  const sim = world(1234, 32, scale);
  sim.step(2880);
  const p = sim.u.planets[0];
  const land = (c: number) => p.s.ocean[c] === 0;
  const out = { tHi: areaMean(p, p.s.tHi, land), tLo: areaMean(p, p.s.tLo, land), tYear: areaMean(p, p.s.tempYear, land), range: 0 };
  const mx = new Float64Array(p.count).fill(-1e9), mn = new Float64Array(p.count).fill(1e9);
  for (let i = 0; i < 144; i++) {
    sim.step(10);
    for (let c = 0; c < p.count; c++) { const T = p.f.temperature[c]; if (T > mx[c]) mx[c] = T; if (T < mn[c]) mn[c] = T; }
  }
  const r = new Float64Array(p.count);
  for (let c = 0; c < p.count; c++) r[c] = mx[c] - mn[c];
  out.range = areaMean(p, r, land);
  return out;
}

test('time-lapse fidelity: a living world keeps its day / night envelopes at 1000x', () => {
  // (the multi-hour step flattened every day / night cycle: land range 10.5 °C at 1x, 8.0 at 1000x, the envelopes with
  // it). The temperature FIELD at 1000x changes four times a day — its sampled range is that much narrower; what the
  // sim's systems read over time (the year mean, the hot / cold envelopes) must match.
  const ref = landClimate(1), got = landClimate(1000);
  const msg = `1000x tHi ${got.tHi.toFixed(2)} tLo ${got.tLo.toFixed(2)} tYear ${got.tYear.toFixed(2)} range ${got.range.toFixed(2)} | ` +
    `1x ${ref.tHi.toFixed(2)} ${ref.tLo.toFixed(2)} ${ref.tYear.toFixed(2)} ${ref.range.toFixed(2)}`;
  assert.ok(Math.abs(got.tHi - ref.tHi) < 0.5 && Math.abs(got.tLo - ref.tLo) < 0.5, `envelopes: ${msg}`);
  assert.ok(Math.abs(got.tYear - ref.tYear) < 0.5, `year mean: ${msg}`);
  assert.ok(got.range > 0.75 * ref.range, `day / night range of the field: ${msg}`);
});

/** mean land soil moisture and the wetland count after 12 days */
function soils(scale: number, seed: number): { soil: number; wetland: number } {
  const sim = world(seed, 32, scale);
  sim.step(12 * 1440);
  const p = sim.u.planets[0];
  const wet = sim.u.content.biomes.idx('wetland');
  let soil = 0, n = 0, wetland = 0;
  for (let c = 0; c < p.count; c++) {
    if (p.s.ocean[c]) continue;
    soil += p.f.moisture[c]; n++;
    if (p.f.biome[c] === wet) wetland++;
  }
  return { soil: soil / n, wetland };
}

test('time-lapse fidelity: soils and wetlands at 1000x stay with real time over 12 days', { timeout: 300_000 }, () => {
  // (one 6-hour evaporation / infiltration against the water standing at the instant of the pass missed most of the
  // rain that runs off in between: on this world -18 % wetland and -0.013 soil moisture at day 12; the soil hour keeps
  // them hourly)
  let w1 = 0, w2 = 0, s1 = 0, s2 = 0;
  for (const seed of [1234, 7]) {
    const a = soils(1, seed), b = soils(1000, seed);
    w1 += a.wetland; w2 += b.wetland; s1 += a.soil / 2; s2 += b.soil / 2;
  }
  assert.ok(Math.abs(s2 - s1) < 0.006, `soil moisture ${s2.toFixed(4)} at 1000x, ${s1.toFixed(4)} at 1x`);
  assert.ok(Math.abs(w2 - w1) < 0.1 * w1, `wetland ${w2} cells at 1000x, ${w1} at 1x`);
});

test('time-lapse fidelity: in a downpour the sea stays asleep (sediment into the sea displaces it)', () => {
  // (deltas raised the sea surface over themselves and kept hundreds of sea cells stepping all monsoon — and with them
  // the 1000x pipes on their 2-tick steps)
  const sim = world(9, 32, 1000);
  const p = sim.u.planets[0];
  sim.step(300);
  assert.ok(sim.applyNow({ k: 'weather.global', planet: p.id, kind: 'monsoon' }).ok);
  let worst = 0, coarse = 0, steps = 0;
  const key = `${p.id}:hydro`;
  for (let i = 0; i < 360; i++) {
    sim.step(4);
    let k = 0;
    for (let c = 0; c < p.count; c++) if (p.s.hAct[c] && p.s.ocean[c]) k++;
    if (i >= 60) { worst = Math.max(worst, k); steps++; if (sim.u.settings.lapse?.run[key] !== undefined) coarse++; }
  }
  assert.ok(worst < p.hydro.oceanCells / 50, `up to ${worst} of ${p.hydro.oceanCells} sea cells awake in the monsoon`);
  assert.ok(coarse > 0.8 * steps, `the pipes took 4-tick steps ${coarse} of ${steps} times`);
});
