// GENESIS — climate (CONTRACT.md §7.3, §19): an airless world swings hundreds of degrees between day and night and
// never rains; air moderates it; poles are colder than the equator; seasons flip between hemispheres with the tilt;
// the sun can be frozen and the season pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import { homesteadCell } from '../src/client/poi.ts';

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

// (sim-fix-r2 #2) a heavy snowfall in a mild place locked itself in: the pack's albedo held the cell just under freezing,
// the degree-hour melt never ran, and the opening band's lakeshore (seed 3) stayed white for good and froze. Snow lying
// in sunlit air a little under freezing melts by the sunlight it absorbs.
test('sunlit snow just under freezing melts by the sun it absorbs (no snow-albedo lock)', () => {
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 32 } });
  const p = sim.u.planets[0];
  sim.step(60);
  const sun = sim.u.sun(p, sim.u.tick).dir, P = p.grid.pos;
  const cells: number[] = [];
  for (let c = 0; c < p.count; c++) {
    if (p.s.ocean[c] || p.f.water[c] > 0.05) continue;
    const mu = P[c * 3] * sun[0] + P[c * 3 + 1] * sun[1] + P[c * 3 + 2] * sun[2];
    const T = p.f.temperature[c];
    if (mu > 0.3 && T > -3.5 && T < -0.3) cells.push(c);
  }
  assert.ok(cells.length >= 5, `sunlit land a little under freezing: ${cells.length} cells`);
  for (const c of cells) p.f.snow[c] = 1;
  sim.step(120);
  let melted = 0, stillCold = 0;
  for (const c of cells) { if (p.f.snow[c] < 0.995) melted++; if (p.f.temperature[c] <= 0) stillCold++; }
  assert.ok(stillCold >= cells.length * 0.5, `the air stays under freezing over the pack (${stillCold}/${cells.length})`);
  assert.ok(melted >= cells.length * 0.8, `and the sun melts it anyway: ${melted} of ${cells.length}`);
});

test('a snowed-under patch in a mild region melts: the region\'s warm air reaches it (no snow-locked climate step)', () => {
  // the opening world of seed 3 (barren + air, as src/ui/opening.ts makes it): the lakeshore camp under 1.8 m of snow
  // sat on its own albedo for good (-17 °C year mean while the ground a km off read ~0 °C) before the warm-air melt
  const sim = new Sim({ seed: 3, scenario: 'barren' });
  const u = sim.u, p = u.planets[0], g = p.grid, P = g.pos;
  const day = p.st.dayHours * 60;
  const must = (c: object) => { const r = sim.applyNow(c as never); assert.ok(r.ok, r.msg); };
  must({ k: 'planet.add-air', amount: 1 });
  sim.step(Math.round(day * 0.3));
  must({ k: 'weather.global', kind: 'storm' });
  must({ k: 'water.sea-level', value: -40 });
  sim.step(day);
  const here = [...u.sun(p, u.tick).dir];
  must({ k: 'weather.global', kind: 'none' });
  must({ k: 'life.plant', species: 'meadow-grass', pos: here, radius: 12000, density: 0.8 });
  must({ k: 'life.forest', pos: here, radius: 1400 });
  sim.step(Math.round(day * 0.5));
  // the homestead the opening picks on seed 3 (src/client/poi.ts homesteadCell over the sunlit morning face)
  const fields = new Map<string, Float32Array>();
  for (const [k, v] of Object.entries(p.f)) if (v instanceof Float32Array) fields.set(k, v); else if (v instanceof Float64Array) fields.set(k, Float32Array.from(v));
  const sun = u.sun(p, u.tick).dir, t0f = fields.get('temperature')!, tm = new Float32Array(t0f.length);
  for (let c = 0; c < tm.length; c++) {
    const el = P[c * 3] * sun[0] + P[c * 3 + 1] * sun[1] + P[c * 3 + 2] * sun[2], east = P[c * 3] * sun[2] - P[c * 3 + 2] * sun[0];
    tm[c] = el > 0.25 && east < 0.15 ? t0f[c] : -99;
  }
  fields.set('temperature', tm);
  const c0 = homesteadCell({ grid: g, params: { radius: p.radius }, fields, settlements: [] } as never).cell;
  assert.ok(c0 >= 0, 'a homestead on the morning face');
  let ring = [c0];
  const patch = new Set(ring);
  for (let r = 0; r < 4; r++) {
    const nx: number[] = [];
    for (const c of ring) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (!patch.has(o) && !p.s.ocean[o] && p.f.water[o] < 0.05) { patch.add(o); nx.push(o); }
    }
    ring = nx;
  }
  for (const c of patch) p.f.snow[c] = 1.8;
  sim.step(Math.round(p.st.orbit.period * 0.9));
  let white = 0;
  for (const c of patch) if (p.f.snow[c] > 0.05) white++;
  assert.ok(white <= patch.size * 0.2, `a mild region's snow patch melts within the year: ${white}/${patch.size} cells still white`);
  assert.ok(p.f.snow[c0] < 0.05, `the patch's centre clears (snow ${p.f.snow[c0].toFixed(2)} m, T ${p.f.temperature[c0].toFixed(1)} °C)`);
});
