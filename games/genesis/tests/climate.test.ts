// GENESIS — climate (CONTRACT.md §7.3, §19): an airless world swings hundreds of degrees between day and night and
// never rains; air moderates it; poles are colder than the equator; seasons flip between hemispheres with the tilt;
// the sun can be frozen and the season pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Planet } from '../src/sim/world/planet.ts';

function equatorCell(p: Planet): number {
  let eq = 0;
  for (let c = 0; c < p.count; c++) if (Math.abs(p.grid.lat[c]) < Math.abs(p.grid.lat[eq])) eq = c;
  return eq;
}

/** min / max temperature of a cell over `ticks`, sampled hourly; also counts precipitation and weather */
function watch(sim: Sim, p: Planet, c: number, ticks: number): { lo: number; hi: number; rain: number; weather: number } {
  let lo = Infinity, hi = -Infinity, rain = 0, weather = 0;
  for (let t = 0; t < ticks; t += 60) {
    sim.step(60);
    const T = p.f.temperature[c];
    if (T < lo) lo = T;
    if (T > hi) hi = T;
    for (let k = 0; k < p.count; k++) if (p.f.precip[k] > 0) rain++;
    weather += p.weather.length;
  }
  return { lo, hi, rain, weather };
}

test('an airless world: a huge day/night swing and no rain; air moderates it', () => {
  const sim = new Sim({ seed: 7, scenario: 'barren', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  assert.equal(p.st.atmosphere.pressure, 0);
  const eq = equatorCell(p);
  const day = Math.round(p.st.dayHours * 60);
  const bare = watch(sim, p, eq, day);
  assert.ok(bare.hi - bare.lo > 150, `airless swing ${(bare.hi - bare.lo).toFixed(0)} K (${bare.lo.toFixed(0)}..${bare.hi.toFixed(0)} °C)`);
  assert.ok(bare.hi > 50 && bare.lo < -80, 'scorching day, frozen night');
  assert.equal(bare.rain, 0, 'no rain without air');
  assert.equal(bare.weather, 0, 'no weather without air');
  for (let c = 0; c < p.count; c++) assert.equal(p.f.cloud[c], 0);
  // breathe on it
  const r = sim.applyNow({ k: 'planet.add-air', amount: 1 });
  assert.ok(r.ok, r.msg);
  assert.ok(sim.u.chronicle.some((e) => /Air came to the world/.test(e.text) && /^Year 1\./.test(e.text)), 'chronicled');
  sim.step(day * 2);
  const air = watch(sim, p, eq, day);
  assert.ok(air.hi - air.lo < 0.25 * (bare.hi - bare.lo), `air moderates the swing: ${(air.hi - air.lo).toFixed(1)} K`);
  assert.ok(air.lo > -40, 'nights no longer fall to deep cold');
});

test('poles are colder than the equator', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  sim.step(1440);
  let eq = 0, ne = 0, po = 0, np = 0;
  for (let c = 0; c < p.count; c++) {
    const la = Math.abs(p.grid.lat[c]) * 180 / Math.PI;
    if (la < 20) { eq += p.s.tempMean[c]; ne++; }
    if (la > 65) { po += p.s.tempMean[c]; np++; }
  }
  eq /= ne; po /= np;
  assert.ok(eq - po > 20, `equator ${eq.toFixed(1)} °C vs poles ${po.toFixed(1)} °C`);
  assert.ok(po < 0, 'polar cold');
});

/** northern minus southern mean temperature (cells beyond 20° latitude) */
function hemiDiff(p: Planet): number {
  let n = 0, s = 0, nn = 0, ns = 0;
  for (let c = 0; c < p.count; c++) {
    const la = p.grid.lat[c] * 180 / Math.PI;
    if (la > 20) { n += p.f.temperature[c]; nn++; } else if (la < -20) { s += p.f.temperature[c]; ns++; }
  }
  return n / nn - s / ns;
}

test('seasons flip between the hemispheres with axial tilt (and vanish without it)', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  const year = p.st.orbit.period;
  const yf = () => ((p.st.orbit.phase0 + (2 * Math.PI * sim.tick) / year) / (2 * Math.PI)) % 1;
  // northern summer (with the thermal lag of seas: ~0.45 of the year) vs northern winter (~0.95)
  while (yf() < 0.45) sim.step(240);
  const summer = hemiDiff(p);
  while (yf() < 0.95) sim.step(240);
  const winter = hemiDiff(p);
  assert.ok(summer - winter > 6, `N-S difference swings from ${summer.toFixed(1)} K (northern summer) to ${winter.toFixed(1)} K (northern winter)`);
  // without tilt the hemispheres stay alike through the year
  const flat = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 16, axialTilt: 0 } });
  const q = flat.u.planets[0];
  const diffs: number[] = [];
  for (let k = 0; k < 8; k++) { flat.step(Math.round(year / 8)); diffs.push(hemiDiff(q)); }
  const range = Math.max(...diffs) - Math.min(...diffs);
  assert.ok(range < 0.5 * (summer - winter), `no-tilt seasonal swing ${range.toFixed(1)} K`);
});

test('a pinned season holds, and a frozen sun stops the day', () => {
  const sim = new Sim({ seed: 13, scenario: 'sandbox', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  let r = sim.applyNow({ k: 'weather.pin-season', season: 'summer' });
  assert.ok(r.ok, r.msg);
  sim.step(4 * 1440);
  const pinnedSummer = hemiDiff(p);
  r = sim.applyNow({ k: 'weather.pin-season', season: 'winter' });
  assert.ok(r.ok, r.msg);
  sim.step(4 * 1440);
  assert.ok(pinnedSummer - hemiDiff(p) > 4, 'pinned summer then pinned winter flip the hemispheres');
  // freeze the sun at noon over longitude 0: the sub-solar side keeps heating, the far side keeps cooling
  r = sim.applyNow({ k: 'time.set-hour', hour: 12 });
  assert.ok(r.ok, r.msg);
  r = sim.applyNow({ k: 'time.freeze-sun', on: true });
  assert.ok(r.ok, r.msg);
  const P = p.grid.pos;
  let noon = 0, midnight = 0;
  for (let c = 0; c < p.count; c++) {
    if (P[c * 3 + 2] > P[noon * 3 + 2]) noon = c; // +Z = longitude 0
    if (P[c * 3 + 2] < P[midnight * 3 + 2]) midnight = c;
  }
  const t0n = p.f.temperature[noon], t0m = p.f.temperature[midnight];
  sim.step(1440);
  assert.ok(p.f.temperature[noon] > t0n, 'the noon side warms under a standing sun');
  assert.ok(p.f.temperature[midnight] < t0m, 'the night side cools in an endless night');
  const params = sim.snapshot({ drain: false }).planets[0].params;
  assert.equal(params.sunFrozen, true);
  assert.ok(Math.abs(params.hourAtLon0 / params.dayHours * 24 - 12) < 0.6, `hour stays at noon (${params.hourAtLon0})`);
});
