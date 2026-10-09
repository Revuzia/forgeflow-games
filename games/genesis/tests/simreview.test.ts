// GENESIS — regressions from the phase-1 sim review: brush bounds, talus that settles, clearing the weather
// everywhere, storm winds that survive the climate pass on staggered planets, the lapse-rate datum under the sea-level
// slider, a pinned season that keeps the hour, the time wheel's overflow list and the keyframe codec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { TimeWheel } from '../src/sim/core/timewheel.ts';
import { packArray, unpackArray } from '../src/sim/core/kfcodec.ts';
import { terrainStep } from '../src/sim/fields/terrain.ts';
import type { Planet } from '../src/sim/world/planet.ts';

function highest(p: Planet): number {
  let best = 0;
  for (let c = 1; c < p.count; c++) if (p.f.surface[c] > p.f.surface[best]) best = c;
  return best;
}
const posOf = (p: Planet, c: number) => [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];

test('brush strengths are bounded per brush, and the ground never leaves ±half the radius', () => {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  const at = posOf(p, highest(p));
  const refuse = (c: Record<string, unknown>, re: RegExp) => {
    const r = sim.applyNow({ k: String(c.k), ...c, pos: at });
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match(r.msg ?? '', re);
  };
  refuse({ k: 'terrain.crater', radius: 250, strength: 2000 }, /at most 5/);
  refuse({ k: 'terrain.flatten', strength: 3 }, /at most 1/);
  refuse({ k: 'terrain.raise', strength: -50 }, /at least 0/);
  refuse({ k: 'terrain.dig-sea', depth: 2000 }, /at most 1000/);
  // the registry exposes the per-brush ranges the palette builds its sliders from
  const sc = (k: string) => sim.registry.schema(k)!.params.strength;
  assert.deepEqual([sc('terrain.crater').min, sc('terrain.crater').max], [0.05, 5]);
  assert.deepEqual([sc('terrain.smooth').min, sc('terrain.smooth').max], [0, 1]);
  assert.equal(sc('terrain.raise').max, 1000);
  // the strongest legal strokes, stacked, stay inside the band
  for (let i = 0; i < 6; i++) {
    assert.ok(sim.applyNow({ k: 'terrain.lower', pos: at, radius: 300, strength: 1000 }).ok);
    assert.ok(sim.applyNow({ k: 'terrain.crater', pos: at, radius: 400, strength: 5 }).ok);
  }
  let lo = Infinity;
  for (let c = 0; c < p.count; c++) lo = Math.min(lo, p.f.surface[c]);
  assert.ok(lo >= -0.5 * p.st.radius - 1e-3, `ground ${lo.toFixed(0)} m stays above -R/2`);
  // one stroke is capped at 0.3 R
  const c0 = highest(p);
  const h0 = p.f.surface[c0];
  assert.ok(sim.applyNow({ k: 'terrain.raise', pos: posOf(p, c0), radius: 200, strength: 1000 }).ok);
  assert.ok(p.f.surface[c0] - h0 <= 0.3 * p.st.radius + 1e-3, `one raise added ${(p.f.surface[c0] - h0).toFixed(0)} m`);
});

test('talus after a big brush settles: no cell stays awake on sub-ulp slopes', () => {
  const sim = new Sim({ seed: 9, scenario: 'barren', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  assert.ok(sim.applyNow({ k: 'terrain.raise', pos: posOf(p, 1234), radius: 260, strength: 600 }).ok);
  sim.step(3000);
  let awake = 0;
  for (let c = 0; c < p.count; c++) if (p.s.tAct[c]) awake++;
  assert.equal(awake, 0, `${awake} talus cells still awake`);
  // and a terrain step on the settled world re-versions nothing
  const v = p.fieldVer.surface;
  terrainStep(sim.u, p);
  assert.equal(p.fieldVer.surface, v, 'no surface bump without a real change');
});

test('clearing the skies everywhere clears every system and the planet-wide weather, at once', () => {
  const sim = new Sim({ seed: 4, scenario: 'sandbox', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  assert.ok(sim.u.focus, 'scenarios set a camera focus');
  sim.applyNow({ k: 'weather.global', kind: 'storm' });
  for (const lon of [-120, 0, 120]) sim.applyNow({ k: 'weather.paint', kind: 'thunderstorm', lat: 20, lon, radius: 500 });
  sim.step(120);
  const wet = () => { let n = 0; for (let c = 0; c < p.count; c++) if (p.f.precip[c] > 0) n++; return n; };
  assert.ok(wet() > p.count * 0.9, 'a planet-wide storm rains everywhere');
  // the parser routes "everywhere" to an explicit flag (a bare clear means "here": every place falls back to the focus)
  const parsed = sim.parse('clear the skies everywhere');
  assert.deepEqual(parsed.resolved, [{ k: 'weather.clear', everywhere: true }]);
  const r = sim.applyNow({ k: 'freeform', text: 'clear the skies everywhere' });
  assert.ok(r.ok, r.msg);
  assert.match(r.msg ?? '', /storm lifts/);
  assert.equal(p.st.globalWeather, null);
  assert.equal(p.weather.length, 0);
  assert.ok(wet() < p.count * 0.5, `the rain stops now (${wet()} cells still wet-skied by the climate)`);
  // a local clear with no system there, under a planet-wide weather: the sky the god looks at IS that weather, and it
  // lifts (a clear that changed nothing would read as a broken word)
  sim.applyNow({ k: 'weather.global', kind: 'rain' });
  const local = sim.applyNow({ k: 'weather.clear', lat: -60, lon: 90, radius: 100 });
  assert.ok(local.ok);
  assert.match(local.msg ?? '', /planet-wide rain lifts/);
  assert.equal(p.st.globalWeather, null);
  // with no weather at all, it says there was none
  const none = sim.applyNow({ k: 'weather.clear', lat: -60, lon: 90, radius: 100 });
  assert.match(none.msg ?? '', /No weather|nothing|clear already|already clear/i);
});

test('storm winds survive the hourly climate pass on every planet (staggered clocks)', () => {
  const sim = new Sim({ seed: 20261008, scenario: 'twoworlds', overrides: { n: 16 } });
  // a pinned sandstorm centred on cell 77: the swirl is calm at the very centre, so watch a cell ~1/3 radius out
  const probe = new Map<number, number>();
  for (const p of sim.u.planets) {
    if (!p.airy) continue;
    sim.applyNow({ k: 'weather.paint', planet: p.id, kind: 'sandstorm', cell: 77, radius: 900, pinned: true, duration: -1 });
    const P = p.grid.pos;
    let best = -1, bd = Infinity;
    for (let c = 0; c < p.count; c++) {
      const ang = Math.acos(Math.min(1, P[c * 3] * P[77 * 3] + P[c * 3 + 1] * P[77 * 3 + 1] + P[c * 3 + 2] * P[77 * 3 + 2]));
      const d = Math.abs(ang * p.st.radius - 300);
      if (d < bd) { bd = d; best = c; }
    }
    probe.set(p.id, best);
  }
  assert.ok(probe.size >= 2, 'two airy worlds');
  sim.step(20);
  let gaps = 0;
  for (let t = 0; t < 80; t++) {
    sim.step(1);
    for (const p of sim.u.planets) {
      if (!p.airy) continue;
      const c = probe.get(p.id)!;
      const d = Math.hypot(p.f.windX[c] - p.s.baseWindX[c], p.f.windY[c] - p.s.baseWindY[c], p.f.windZ[c] - p.s.baseWindZ[c]);
      if (d < 0.5) gaps++;
    }
  }
  assert.equal(gaps, 0, `${gaps} planet-ticks without storm wind under a pinned sandstorm`);
});

test('the sea-level slider does not heat the mountains (fixed lapse-rate datum)', () => {
  const mk = () => new Sim({ seed: 21, scenario: 'sandbox', overrides: { n: 16 } });
  const a = mk(), b = mk();
  const pa = a.u.planets[0], pb = b.u.planets[0];
  // the highest 3 % of the land, all well above the raised sea
  const order = Array.from({ length: pa.count }, (_, c) => c).sort((x, y) => pa.f.surface[y] - pa.f.surface[x]);
  const high = order.slice(0, Math.ceil(pa.count * 0.03)).filter((c) => pa.f.surface[c] > 135);
  assert.ok(high.length > 5, `some highland (${high.length} cells, top at ${pa.f.surface[order[0]].toFixed(0)} m)`);
  assert.ok(b.applyNow({ k: 'water.sea-level', delta: 120 }).ok);
  a.step(1200); b.step(1200);
  const mean = (p: Planet) => high.reduce((s, c) => s + p.f.temperature[c], 0) / high.length;
  const dry = high.filter((c) => !pb.s.ocean[c]).length;
  assert.equal(dry, high.length, 'the highland stays above the sea');
  assert.ok(Math.abs(mean(pb) - mean(pa)) < 1.5, `highland ${mean(pb).toFixed(2)} °C vs control ${mean(pa).toFixed(2)} °C`);
});

test('a pinned season changes the declination, not the hour; the snapshot carries the sun the sim heats by', () => {
  const sim = new Sim({ seed: 1, scenario: 'sandbox', overrides: { n: 16 } });
  const p = sim.u.planets[0];
  sim.step(2000);
  const before = sim.snapshot({ drain: false }).planets[0].params;
  for (const [season, sign] of [['summer', 1], ['winter', -1], ['spring', 0]] as const) {
    assert.ok(sim.applyNow({ k: 'weather.pin-season', season }).ok);
    const pp = sim.snapshot({ drain: false }).planets[0].params;
    assert.ok(Math.abs(pp.hourAtLon0 - before.hourAtLon0) < 1e-9, `${season}: the hour holds (${pp.hourAtLon0} vs ${before.hourAtLon0})`);
    const decl = Math.asin(pp.sunDir![1]);
    if (sign === 0) assert.ok(Math.abs(decl) < 1e-6, 'equinox: the sun over the equator');
    // (the season's middle is a mean anomaly: on an eccentric orbit the solstice is a hair away from it)
    else assert.ok(Math.abs(decl - sign * p.st.axialTilt) < 0.01, `${season}: declination ${decl} vs tilt ${p.st.axialTilt}`);
    const s = sim.u.sun(p, sim.tick).dir;
    assert.deepEqual(pp.sunDir, [s[0], s[1], s[2]]);
  }
  // a frozen sun stands still: the hour holds for a day even as the planet moves along its orbit
  assert.ok(sim.applyNow({ k: 'weather.pin-season', season: 'none' }).ok);
  assert.ok(sim.applyNow({ k: 'time.freeze-sun', on: true }).ok);
  const h0 = sim.snapshot({ drain: false }).planets[0].params.hourAtLon0;
  sim.step(1440);
  const h1 = sim.snapshot({ drain: false }).planets[0].params.hourAtLon0;
  assert.ok(Math.abs(h1 - h0) < 1e-6, `frozen hour ${h0} -> ${h1}`);
});

test('time wheel: an id re-planned far ahead again and again stays one overflow entry', () => {
  const w = new TimeWheel(64);
  for (let i = 0; i < 10000; i++) {
    w.schedule(7, w.now + 500 + (i % 13));
    if (i % 10 === 0) w.drain(w.now);
  }
  assert.equal(w.overflowSize, 1);
  assert.equal(w.count, 1);
  // it still fires exactly once at its last due tick
  const due = w.dueOf(7);
  const fired = w.drain(due + 1);
  assert.deepEqual(fired, [7]);
  assert.equal(w.overflowSize, 0);
});

test('keyframe codec: exact round trips of every array type, with and without a reference', () => {
  let s = 99;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (const T of [Float32Array, Float64Array, Uint8Array, Int8Array, Int16Array, Uint16Array, Int32Array, Uint32Array]) {
    for (const n of [0, 1, 5, 333]) {
      const a = new T(n), b = new T(n);
      for (let i = 0; i < n; i++) { a[i] = rnd() < 0.5 ? 0 : (rnd() - 0.3) * 900; b[i] = rnd() < 0.7 ? a[i] : (rnd() - 0.5) * 200; }
      if (a instanceof Float32Array && n > 3) { a[1] = NaN; a[2] = -0; a[3] = -Infinity; }
      for (const ref of [null, b]) {
        const out = new T(n);
        unpackArray(packArray(a, ref), out, ref);
        assert.deepEqual(new Uint8Array(out.buffer), new Uint8Array(a.buffer), `${T.name}[${n}] ref=${!!ref}`);
      }
    }
  }
  // an unchanged array against itself costs a few bytes
  const f = new Float32Array(40962).map((_, i) => Math.sin(i));
  assert.ok(packArray(f, f).bytes.length < 16);
});
