// GENESIS — sim throughput floor (CONTRACT.md §6.1; SIM perf pass). A regression guard, not a benchmark: the terran
// home world (sandbox, n = 64, nothing alive, no agents) must keep stepping well above the phase-1 rate of ~1 100
// ticks/s, and a planet-wide downpour must not collapse it.
//
// Rates are by process CPU time, so time spent descheduled does not count against the sim. What CPU time cannot hide
// is a contended core (a busy hyper-thread sibling, a thrashed cache), and that comes with an oversubscribed machine.
// So the test always measures, and a rate at or above the floor always passes (load only ever slows the sim down); a
// rate below it is re-measured from the same saved state (up to 3 tries, best kept), and a miss that remains counts as
// a failure only if the process had a core while missing: if every try ran descheduled (wall / CPU time above 1.3 —
// the machine is oversubscribed) or the calibration kernel ran far slower than this machine can run it, the test is
// skipped with a warning instead. The calibration kernel is a latency-bound float reduction: ~2.2 ns per element on the
// 4-vCPU 2.1 GHz Xeon build VM, idle or busy, as long as this process gets a core, so it is only a sanity bound, not a
// measure of load. Each measurement is a median of 3 runs after a game day of warm-up (V8 tiers up the hourly kernels
// slowly). The floors are fixed: on the build VM with the renderer's SwiftShader screenshots running the perf pass does
// ~1 450–1 900 ticks/s idle and ~420–540 in the monsoon; phase 1 ran ~850–1 100 and ~220–290. SIM perf push 2 adds the
// same floor at the 1000x preset (the logged time-lapse level, src/sim/perf/lapse.ts) and raises the real-time ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { conservedVolume, hydroStep, rainBatchDue, DRY } from '../src/sim/fields/hydrology.ts';
import { surfaceGradients } from '../src/sim/grid/surface.ts';
import { capCells } from '../src/sim/perf/cap.ts';

interface Calibration {
  /** best CPU ns per element of the kernel */
  ns: number;
  /** wall / CPU time over the calibration window (1.0 = this process was never descheduled) */
  desched: number;
}

/** how much of a core this process gets right now (~0.3 s) */
function calibrate(): Calibration {
  const a = new Float32Array(40962);
  for (let i = 0; i < a.length; i++) a[i] = i * 0.001;
  const b = new Float32Array(a.length);
  const k = (x: Float32Array, y: Float32Array): number => {
    let s = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i]; y[i] = v * 1.0001 + 0.5; s += v; }
    return s;
  };
  for (let j = 0; j < 50; j++) k(a, b); // tier up
  let best = Infinity;
  const all0 = process.cpuUsage(), w0 = performance.now();
  for (let r = 0; r < 5; r++) {
    const c0 = process.cpuUsage();
    let s = 0;
    for (let j = 0; j < 400; j++) s += k(a, b);
    const cu = process.cpuUsage(c0);
    if (s < 0) throw new Error('unreachable');
    best = Math.min(best, ((cu.user + cu.system) * 1000) / (400 * a.length));
  }
  const all = process.cpuUsage(all0), wall = performance.now() - w0;
  return { ns: best, desched: (wall * 1000) / Math.max(1, all.user + all.system) };
}

interface Rate {
  /** median ticks/s by CPU time */
  rate: number;
  /** wall / CPU time over the runs */
  desched: number;
}

/** median ticks/s by CPU time over `reps` runs of `ticks` */
function rate(sim: Sim, ticks: number, reps: number): Rate {
  const r: number[] = [];
  let cpu = 0, wall = 0;
  for (let i = 0; i < reps; i++) {
    const c0 = process.cpuUsage(), w0 = performance.now();
    sim.step(ticks);
    const cu = process.cpuUsage(c0);
    const cs = (cu.user + cu.system) / 1e6;
    wall += (performance.now() - w0) / 1000;
    cpu += cs;
    r.push(ticks / cs);
  }
  r.sort((x, y) => x - y);
  return { rate: r[r.length >> 1], desched: wall / Math.max(1e-9, cpu) };
}

/** the first measurement on `sim`; below `floor`, re-measured on fresh copies of the same state (`bytes`) up to
 * `tries` times in all. Returns the best rate and the least descheduling any try saw (a try that had a core). */
function judge(sim: Sim, bytes: Uint8Array, ticks: number, floor: number, tries: number): Rate & { tries: number } {
  let m = rate(sim, ticks, 3);
  let best = m.rate, desched = m.desched, k = 1;
  while (best < floor && k < tries) {
    const copy = Sim.load(bytes);
    copy.step(120); // the first steps on a loaded copy run cold
    m = rate(copy, ticks, 3);
    best = Math.max(best, m.rate);
    desched = Math.min(desched, m.desched);
    k++;
  }
  return { rate: best, desched, tries: k };
}

/** wall / CPU time beyond which this process is not getting a core (the machine is oversubscribed); at load ~8 on the
 * 4-vCPU build VM (SwiftShader screenshots running) the sim measures 1.0–1.05 and the calibration window ~1.1 */
const DESCHED_OVERLOADED = 1.3;
/** calibration (CPU ns / element) beyond which a core is too contended to judge: ~1.6x the build VM's ~2.2 (a faster
 * machine never gets near it) */
const CALIB_OVERLOADED = 3.5;
/**
 * Floors (SIM perf push 2, re-taken in round 2 with natural disasters off). Real time (1x / 10x): idle ~1 850–2 100
 * measured (1 600 at load ~18, wall/CPU 5), downpour ~560–630 (580 at load ~18) — sheets that keep their edge flux cost
 * ~10 % of the downpour rate of round 1 but carve and run as the pure pipes did. The 1000x time-lapse level
 * (perf/lapse.ts): ~4 400–4 700 idle (3 800 at load ~18) and ~1 400–1 600 in the monsoon (1 290), the 4-tick pipes
 * now only while the sea is calm. Floors ~20–30 % below the loaded measurements.
 */
const IDLE_FLOOR = 1450;
const MONSOON_FLOOR = 450;
const IDLE_FLOOR_1000X = 3000;
const MONSOON_FLOOR_1000X = 900;

test('sim throughput floor: terran home world idle and in a planet-wide monsoon', { timeout: 600_000 }, (t) => {
  floorTest(t, 1, IDLE_FLOOR, MONSOON_FLOOR);
});

test('sim throughput floor at the 1000x preset (time-lapse level 2): idle and monsoon', { timeout: 600_000 }, (t) => {
  floorTest(t, 1000, IDLE_FLOOR_1000X, MONSOON_FLOOR_1000X);
});

function floorTest(t: { diagnostic(s: string): void; skip(s: string): void }, scale: number, IDLE_FLOOR: number, MONSOON_FLOOR: number): void {
  const calib = calibrate();
  const cal = `calibration ${calib.ns.toFixed(2)} ns/element, wall/CPU ${calib.desched.toFixed(2)}`;
  const sim = new Sim({ seed: 1234, scenario: 'sandbox' });
  // natural disasters off (the god layer's law, on by default): a natural quake wakes the whole sea for ~1.5 game days
  // at a third of the idle rate, so a floor measured across one would be luck (perf push 2 round 2)
  assert.ok(sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 }).ok);
  if (scale > 1) assert.ok(sim.applyNow({ k: 'time.scale', scale }).ok);
  sim.step(1440); // warm-up: a game day
  const idle = judge(sim, sim.save(), 1440, IDLE_FLOOR, 3);
  const home = sim.u.planets[0];
  assert.ok(sim.applyNow({ k: 'weather.global', planet: home.id, kind: 'monsoon' }).ok);
  sim.step(600);
  const monsoon = judge(sim, sim.save(), 720, MONSOON_FLOOR, 3);
  const got = `${scale}x: idle ${idle.rate.toFixed(0)} ticks/s (${idle.tries} tries, wall/CPU ${idle.desched.toFixed(2)}), ` +
    `monsoon ${monsoon.rate.toFixed(0)} ticks/s (${monsoon.tries} tries, wall/CPU ${monsoon.desched.toFixed(2)}); ${cal}`;
  t.diagnostic(got);
  // a miss is excused only when every try of that measurement ran descheduled, or the calibration kernel ran far
  // below this machine's speed: then it is someone else's load, not a regression
  const excused = (m: Rate): boolean => m.desched > DESCHED_OVERLOADED || calib.ns > CALIB_OVERLOADED;
  const idleMiss = idle.rate < IDLE_FLOOR, monsoonMiss = monsoon.rate < MONSOON_FLOOR;
  if ((idleMiss || monsoonMiss) && (!idleMiss || excused(idle)) && (!monsoonMiss || excused(monsoon))) {
    t.diagnostic(`below the floor on an overloaded machine (limits wall/CPU ${DESCHED_OVERLOADED}, ${CALIB_OVERLOADED} ns/element): throughput not judged`);
    t.skip(`overloaded machine (${got})`);
    return;
  }
  assert.ok(!idleMiss, `idle below the floor ${IDLE_FLOOR}: ${got}`);
  assert.ok(!monsoonMiss, `monsoon below the floor ${MONSOON_FLOOR}: ${got}`);
}

// ── the perf pass's semantics (fast checks on small worlds) ──

test('batched rain is fully accounted: in a downpour every added and soaked m³ is in the books', () => {
  const sim = new Sim({ seed: 7, scenario: 'sandbox', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  // no sinks that are not accounted per step (evaporation / boiling and the sea relaxation are accounted too; this
  // keeps the check about the rain path)
  p.cfg.evaporation = 0;
  assert.ok(sim.applyNow({ k: 'weather.global', planet: p.id, kind: 'monsoon' }).ok);
  const c0 = conservedVolume(p);
  let batches = 0;
  for (let t = 0; t < 600; t++) { if (rainBatchDue(sim.tick, p.id) && sim.tick % 2 === 0) batches++; sim.step(1); }
  const drift = Math.abs(conservedVolume(p) - c0) / Math.max(1, p.waterVolume());
  assert.ok(batches >= 55 && batches <= 65, `rain fell in ${batches} batches over 600 ticks (one per 10 ticks)`);
  assert.ok(drift < 1e-6, `conserved volume drift ${drift.toExponential(2)} of the water volume`);
});

test('after a hydrology step no awake cell is dry (a dry cell sends nothing and sleeps at once)', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  assert.ok(sim.applyNow({ k: 'weather.global', planet: p.id, kind: 'storm' }).ok);
  sim.step(400);
  for (let k = 0; k < 20; k++) {
    hydroStep(sim.u, p);
    sim.u.tick += 2;
    let dryAwake = 0, awake = 0;
    for (let c = 0; c < p.count; c++) if (p.s.hAct[c]) { awake++; if (p.f.water[c] <= DRY) dryAwake++; }
    assert.equal(dryAwake, 0, `${dryAwake} of ${awake} awake cells are dry`);
  }
});

test('capCells matches IcoGrid.cellsWithin element for element', () => {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 24 } });
  const g = sim.u.planets[0].grid;
  const out = new Int32Array(g.count);
  for (let i = 0; i < 40; i++) {
    const c = (i * 977) % g.count;
    const ang = 0.02 + (i % 7) * 0.09;
    const px = g.pos[c * 3], py = g.pos[c * 3 + 1], pz = g.pos[c * 3 + 2];
    const want = g.cellsWithin(px, py, pz, ang).slice();
    const n = capCells(g, px, py, pz, ang, out);
    assert.deepEqual(Array.from(out.subarray(0, n)), want);
  }
});

test('snapshots carry the ground curvature data when asked (and only then)', () => {
  const sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 16 } });
  const plain = sim.snapshot({ full: true });
  assert.equal(plain.planets[0].grad, undefined);
  const snap = sim.snapshot({ full: true, grad: true });
  const ps = snap.planets[0];
  const surface = ps.fields!.surface!;
  assert.ok(ps.grad instanceof Float32Array && ps.grad.length === surface.length * 4);
  const p = sim.u.planets[0];
  const want = surfaceGradients(p.grid, p.st.radius, surface);
  assert.deepEqual(Array.from(ps.grad), Array.from(want));
  // no surface shipped -> no gradients either
  const quiet = sim.snapshot({ since: snap.planets[0].fieldVersion, grad: true });
  assert.equal(quiet.planets[0].grad, undefined);
});

test('every ground-layer writer keeps surface == the sum of its layers (no full re-sum backs them up any more)', () => {
  // the hourly climate pass re-sums only the cells whose own snow / ice changed, so a writer that forgets
  // p.updSurface leaves a permanently stale ground height (it did: weathering ash, found by the perf review). A busy
  // little world: ash weathering on moist warm land, lava cooling into rock, sand and ash on the wind, a fire.
  const sim = new Sim({ seed: 7, scenario: 'sandbox', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  const f = p.f;
  sim.step(60);
  /** the dry land cell (warmer than `tMin`) with the highest `score` */
  const land = (tMin: number, score: (c: number) => number): number => {
    let best = -1;
    for (let c = 0; c < p.count; c++) {
      if (p.s.ocean[c] || f.water[c] >= 0.01 || f.temperature[c] <= tMin) continue;
      if (best < 0 || score(c) > score(best)) best = c;
    }
    assert.ok(best >= 0, 'no dry land');
    return best;
  };
  const freeze = p.st.liquid.freeze;
  const wetWarm = land(freeze + 5, (c) => f.moisture[c]);
  const dry = land(freeze, (c) => -f.moisture[c]);
  for (const cmd of [
    { k: 'terrain.paint-material', material: 'ash', cell: wetWarm, radius: 3000, depth: 0.4 },
    { k: 'terrain.paint-material', material: 'sand', cell: dry, radius: 2000, depth: 0.6 },
    { k: 'terrain.paint-material', material: 'lava', cell: dry, radius: 300, depth: 2 },
    { k: 'life.forest', cell: wetWarm, radius: 1500 },
  ]) assert.ok(sim.applyNow({ ...cmd, planet: p.id } as never).ok, cmd.k);
  sim.step(120);
  assert.ok(sim.applyNow({ k: 'fire.ignite', planet: p.id, cell: wetWarm, radius: 200 } as never).ok);
  let ashCells = 0;
  for (const T of [300, 900]) {
    sim.step(T);
    let stale = 0, worst = 0, worstC = -1;
    ashCells = 0;
    for (let c = 0; c < p.count; c++) {
      const sum = Math.fround(f.rock[c] + f.soil[c] + f.sand[c] + f.ash[c] + f.snow[c] + f.ice[c]);
      const d = Math.abs(sum - f.surface[c]);
      if (f.ash[c] > 0.01) ashCells++;
      if (d > 1e-4) { stale++; if (d > worst) { worst = d; worstC = c; } }
    }
    assert.equal(stale, 0, `tick ${sim.tick}: ${stale} cells with a stale surface (worst c${worstC}, off by ${worst.toFixed(4)} m)`);
  }
  assert.ok(ashCells > 100, `the ash is still there to weather (${ashCells} cells)`);
});
