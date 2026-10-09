// GENESIS — time-lapse level of detail (SIM perf push 2, src/sim/perf/lapse.ts; CONTRACT §5 note): the speed preset is
// a logged sim input. Level 0 (1x, 10x) is the plain sim; 100x / 1000x run the slow systems on
// coarser fixed cadences with proportionally larger steps. Same seed + same command log (speed changes included) =>
// same hash; save / load and rewind mid time-lapse continue identically; water stays conserved; every scheduled
// system integrates exactly the time that passed across level changes; the climate and the water keep their character.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { Sim } from '../src/sim/sim.ts';
import type { Command, FromWorker } from '../src/sim/types.ts';
import { conservedVolume } from '../src/sim/fields/hydrology.ts';
import { planetArrays } from '../src/sim/world/planet.ts';
import { Hasher } from '../src/sim/core/hash.ts';
import type { Universe } from '../src/sim/world/universe.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import {
  dormant, lapseDue, lapseLevel, levelOfScale, setTimeScale, stagger, LAPSE_BIOME, LAPSE_CLIMATE, LAPSE_HYDRO, LAPSE_RAIN, LAPSE_SAND, LAPSE_SHEETS,
  LAPSE_VEG, LAPSE_WEATHER, type LapseSys,
} from '../src/sim/perf/lapse.ts';

/** run `ticks` ticks applying `script` commands at their ticks, stepping in chunks of `chunk`, optionally saving and
 * loading at `saveAt`; returns the sim */
function play(script: [number, Command][], ticks: number, chunk: number, saveAt = -1, n = 24): Sim {
  let sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n } });
  let si = 0;
  while (sim.tick < ticks) {
    while (si < script.length && script[si][0] === sim.tick) {
      const r = sim.applyNow(script[si][1]);
      assert.ok(r.ok, r.msg);
      si++;
    }
    if (sim.tick === saveAt) sim = Sim.load(sim.save());
    let k = chunk;
    if (si < script.length) k = Math.min(k, script[si][0] - sim.tick);
    if (saveAt > sim.tick) k = Math.min(k, saveAt - sim.tick);
    sim.step(Math.min(k, ticks - sim.tick));
  }
  return sim;
}

/** hash of every planet's arrays (fields, solver state, agents) */
function worldHash(sim: Sim): string {
  const h = new Hasher();
  for (const p of sim.u.planets) for (const [name, arr] of planetArrays(p)) { h.str(name); h.typed(arr); }
  return h.hex();
}

const SCRIPT: [number, Command][] = [
  [50, { k: 'time.scale', scale: 1000 }],
  [130, { k: 'weather.global', planet: 0, kind: 'monsoon' }],
  [601, { k: 'time.scale', scale: 100 }],
  [907, { k: 'time.scale', scale: 10 }],
  [1203, { k: 'time.scale', scale: 1000 }],
];

test('time-lapse: the levels of the speed presets; level 0 is the plain sim and keeps no state for a living world', () => {
  assert.equal(levelOfScale(1), 0);
  assert.equal(levelOfScale(10), 0);
  assert.equal(levelOfScale(100), 1);
  assert.equal(levelOfScale(1000), 2);
  const a = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 16 } });
  const b = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 16 } });
  assert.ok(b.applyNow({ k: 'time.scale', scale: 10 }).ok);
  // (the dead moon keeps its own coarse schedule: dormant worlds, perf/lapse.ts — the home world keeps none)
  const homeRecords = (sim: Sim) => Object.keys(sim.u.settings.lapse?.run ?? {}).filter((k) => k.startsWith('0:'));
  assert.deepEqual(homeRecords(b), []);
  assert.equal(lapseLevel(b.u), 0);
  a.step(400); b.step(400);
  // (the whole hash is not compared: the god layer counts every accepted command in its act statistics)
  assert.equal(worldHash(a), worldHash(b), 'a 10x preset is the plain sim');
  // up to 1000x and back to 1x: the records are consumed and the state is dropped again
  assert.ok(b.applyNow({ k: 'time.scale', scale: 1000 }).ok);
  assert.equal(lapseLevel(b.u), 2);
  b.step(300);
  assert.ok(b.applyNow({ k: 'time.scale', scale: 1 }).ok);
  b.step(800); // (the biomes' half-day pass is the last to run)
  assert.deepEqual(homeRecords(b), [], 'back at level 0 every system of the home world consumed its record');
});

test('time-lapse: same seed + same command log (speed changes included) => same hash; chunked stepping and save/load mid time-lapse identical', () => {
  const a = play(SCRIPT, 1500, 1).hash();
  const b = play(SCRIPT, 1500, 97).hash();
  const c = play(SCRIPT, 1500, 1500, 777).hash();
  const d = play(SCRIPT, 1500, 64, 1250).hash();
  assert.equal(a, b, 'chunked stepping');
  assert.equal(a, c, 'save / load at tick 777 (100x)');
  assert.equal(a, d, 'save / load at tick 1250 (1000x)');
  // and the log carries the speed changes
  const sim = play(SCRIPT, 1300, 50);
  assert.equal(sim.u.log.filter((e) => e.cmd.k === 'time.scale').length, 4);
});

test('time-lapse: rewind across speed changes replays the log to the lived state', () => {
  const sim = new Sim({ seed: 8, scenario: 'sandbox', overrides: { n: 24 } });
  sim.keyframeEvery = 240;
  const at: Record<number, string> = {};
  const script = new Map<number, Command>(SCRIPT);
  for (let t = 0; t < 1500; t++) {
    const cmd = script.get(sim.tick);
    if (cmd) assert.ok(sim.applyNow(cmd).ok);
    if (sim.tick % 100 === 37) at[sim.tick] = sim.hash();
    sim.step(1);
  }
  for (const t of [1137, 937, 637]) {
    if (t < sim.rewindRange()[0]) continue;
    assert.ok(sim.rewind(t), `rewind to ${t}`);
    assert.equal(sim.hash(), at[t], `rewound to ${t} (level ${lapseLevel(sim.u)})`);
    // and lived forward again it is the same world
    sim.step(1500 - t);
  }
});

test('time-lapse: water is conserved at 1000x (monsoon, sea-level move, flood)', () => {
  const sim = new Sim({ seed: 9, scenario: 'sandbox', overrides: { n: 32 } });
  assert.ok(sim.applyNow({ k: 'time.scale', scale: 1000 }).ok);
  sim.step(200);
  const p = sim.u.planets[0];
  // sinks off: what is left must be exactly what the sources put in
  p.cfg.evaporation = 0;
  p.cfg.infiltration = 0;
  assert.ok(sim.applyNow({ k: 'weather.global', planet: p.id, kind: 'monsoon' }).ok);
  const v0 = conservedVolume(p);
  sim.step(700);
  assert.ok(sim.applyNow({ k: 'water.sea-level', planet: p.id, delta: 3 }).ok);
  assert.ok(sim.applyNow({ k: 'water.flood', planet: p.id, lat: 10, lon: 20, radius: 300, height: 3 }).ok);
  sim.step(500);
  const drift = Math.abs(conservedVolume(p) - v0) / p.waterVolume();
  assert.ok(drift < 1e-9, `conserved volume drift ${drift.toExponential(2)}`);
});

test('time-lapse: every scheduled system integrates exactly the time since it last ran, across level changes', () => {
  // a bare universe: the schedule only reads tick, settings, planet ids — and, for the hydrology's state-dependent
  // 1000x cadence (4 ticks only while the sea is calm), the awake flags of a small sea that wakes and calms on its own
  const mk = (id: number): Planet => {
    const ocean = new Uint8Array(256);
    ocean.fill(1, 0, 200);
    return { id, airy: true, count: 256, hydro: { oceanCells: 200 }, s: { hAct: new Uint8Array(256), ocean } } as unknown as Planet;
  };
  const planets = [mk(0), mk(1), mk(2)];
  const u = { tick: 0, settings: { maxAgents: 0, restraint: false }, planets } as unknown as Universe;
  const systems: [LapseSys, number, boolean, number][] = [
    // system, phase, staggered, the tick grid its caller runs on
    [LAPSE_CLIMATE, 0, true, 1], [LAPSE_VEG, 30, true, 1], [LAPSE_WEATHER, 0, true, 1], [LAPSE_SAND, 5, true, 1], [LAPSE_BIOME, 360, true, 1],
    [LAPSE_HYDRO, 0, false, 1], [LAPSE_RAIN, 0, true, 2], [LAPSE_SHEETS, 0, false, 2],
  ];
  // (round 2: 100x -> 1000x on ticks = 2 mod 4 — 1702, 3306 — used to lose up to a base period of the systems whose
  // level-1 multiplier is 1)
  const switches = new Map<number, number>([[97, 1000], [530, 100], [1201, 1], [1449, 1000], [1450, 100], [1702, 1000], [2333, 10], [2900, 100], [3306, 1000], [4001, 1]]);
  const last = new Map<string, number>();
  let runs = 0, fine = 0, coarse = 0;
  for (let t = 0; t < 5000; t++) {
    u.tick = t;
    const s = switches.get(t);
    if (s !== undefined) setTimeScale(u, s);
    for (const p of planets) {
      // waves on the sea (150 of 200 cells awake) or calm, flipping every few dozen ticks per planet
      p.s.hAct.fill(((Math.floor(t / 37) * 7 + p.id * 131) % 997) < 300 ? 1 : 0, 0, 150);
      let hydroRan = false;
      for (const [sys, phase, st, grid] of systems) {
        if (t % grid !== 0) continue;
        if (sys === LAPSE_SAND && (t + stagger(p) + 5) % 10 !== 0) continue; // terrainStep's own cadence
        // called from the hydrology step only
        if ((sys === LAPSE_SHEETS || sys === LAPSE_RAIN) && !hydroRan) continue;
        const dt = lapseDue(u, p, sys, t + (st ? stagger(p) : 0), phase);
        if (!dt) continue;
        if (sys === LAPSE_HYDRO) { hydroRan = true; if (lapseLevel(u) === 2) { if (dt === 2) fine++; else coarse++; } }
        const key = `${p.id}:${sys.key}`;
        const prev = last.get(key);
        if (prev !== undefined) assert.equal(t - dt, prev, `${key} at tick ${t}: ran ${dt} ticks after ${prev}`);
        last.set(key, t);
        runs++;
      }
    }
  }
  assert.ok(runs > 3000);
  assert.ok(fine > 100 && coarse > 100, `at 1000x the hydrology ran ${fine} 2-tick and ${coarse} 4-tick steps`);
  assert.equal(u.settings.lapse, undefined, 'back at level 0 for good: no state left');
});

/** hourly means over a day after a day's spin-up */
function climateMeans(scale: number, seed: number): Record<string, number> {
  const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 32 } });
  if (scale > 1) assert.ok(sim.applyNow({ k: 'time.scale', scale }).ok);
  sim.step(1440);
  const p = sim.u.planets[0], f = p.f, A = p.grid.area;
  const m: Record<string, number> = { T: 0, q: 0, cloud: 0, precip: 0 };
  for (let h = 0; h < 24; h++) {
    sim.step(60);
    let a = 0;
    const s: Record<string, number> = { T: 0, q: 0, cloud: 0, precip: 0 };
    for (let c = 0; c < p.count; c++) {
      a += A[c];
      s.T += f.temperature[c] * A[c]; s.q += f.humidity[c] * A[c]; s.cloud += f.cloud[c] * A[c]; s.precip += f.precip[c] * A[c];
    }
    for (const k of Object.keys(m)) m[k] += s[k] / a / 24;
  }
  return m;
}

test('time-lapse: the climate at 100x and 1000x stays within tolerance of real time', () => {
  for (const seed of [1, 2]) {
    const ref = climateMeans(1, seed);
    for (const scale of [100, 1000]) {
      const m = climateMeans(scale, seed);
      assert.ok(Math.abs(m.T - ref.T) < 1, `seed ${seed} ${scale}x: mean temperature ${m.T.toFixed(2)} vs ${ref.T.toFixed(2)}`);
      assert.ok(Math.abs(m.q - ref.q) < 0.04, `seed ${seed} ${scale}x: humidity ${m.q.toFixed(3)} vs ${ref.q.toFixed(3)}`);
      assert.ok(Math.abs(m.cloud - ref.cloud) < 0.08, `seed ${seed} ${scale}x: cloud ${m.cloud.toFixed(3)} vs ${ref.cloud.toFixed(3)}`);
      assert.ok(Math.abs(m.precip - ref.precip) < 0.6 * ref.precip + 0.02, `seed ${seed} ${scale}x: precip ${m.precip.toFixed(3)} vs ${ref.precip.toFixed(3)}`);
    }
  }
});

/** land cells with running water (> 5 cm, > 0.1 m/s) after a day */
function running(sim: Sim): number {
  const p = sim.u.planets[0], f = p.f, s = p.s;
  let n = 0;
  for (let c = 0; c < p.count; c++) if (!s.ocean[c] && f.water[c] > 0.05 && Math.hypot(f.flowX[c], f.flowY[c], f.flowZ[c]) > 0.1) n++;
  return n;
}

test('time-lapse: at 1000x rivers still run, a flood spreads and drains, a tsunami still crosses the sea', () => {
  const ref = new Sim({ seed: 1234, scenario: 'sandbox', overrides: { n: 32 } });
  ref.step(1440);
  const sim = new Sim({ seed: 1234, scenario: 'sandbox', overrides: { n: 32 } });
  assert.ok(sim.applyNow({ k: 'time.scale', scale: 1000 }).ok);
  sim.step(1440);
  const p = sim.u.planets[0], f = p.f, s = p.s;
  assert.ok(running(sim) >= Math.max(2, running(ref) / 2), `running water at 1000x: ${running(sim)} cells (1x: ${running(ref)})`);
  // a flood on the flattest dry lowland runs off (here: into the sea) — at half the 1x wave speed in game time
  let best = -1, rel = Infinity;
  for (let c = 0; c < p.count; c++) {
    if (s.ocean[c] || f.water[c] > 0.01 || f.surface[c] < p.st.seaLevel + 3 || f.surface[c] > p.st.seaLevel + 20) continue;
    let r = 0;
    for (let e = p.grid.nbrStart[c]; e < p.grid.nbrStart[c + 1]; e++) r = Math.max(r, Math.abs(f.surface[p.grid.nbr[e]] - f.surface[c]));
    if (r < rel) { rel = r; best = c; }
  }
  const P = p.grid.pos;
  const pos = [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]];
  const near = p.cellsNear(pos, 800).slice();
  const landWater = (): number => { let v = 0; for (const c of near) if (!s.ocean[c]) v += f.water[c] * p.cellArea[c]; return v; };
  const v00 = landWater();
  assert.ok(sim.applyNow({ k: 'water.flood', planet: p.id, pos, radius: 200, height: 2 }).ok);
  const v0 = landWater() - v00;
  sim.step(20);
  const v20 = landWater() - v00;
  sim.step(280);
  const v300 = landWater() - v00;
  assert.ok(v20 < 0.95 * v0, `the flood moves: ${v0.toFixed(0)} -> ${v20.toFixed(0)} m³ near its source after 20 ticks`);
  assert.ok(v300 < 0.1 * v0, `and runs off: ${v300.toFixed(0)} m³ of ${v0.toFixed(0)} left after 300 ticks`);
  // a tsunami in the open sea moves its water away from where it rose
  let sea = -1;
  for (let c = 0; c < p.count && sea < 0; c++) if (s.ocean[c] && f.water[c] > 30) sea = c;
  const sp = [P[sea * 3], P[sea * 3 + 1], P[sea * 3 + 2]];
  assert.ok(sim.applyNow({ k: 'water.tsunami', planet: p.id, pos: sp, radius: 300, height: 4 }).ok);
  const H = (c: number) => f.surface[c] + f.water[c];
  const h0 = H(sea);
  sim.step(80);
  assert.ok(H(sea) < h0 - 1, `the mound left its centre: ${h0.toFixed(2)} -> ${H(sea).toFixed(2)}`);
});

test('time-lapse: the worker puts the sim on the level of its speed preset (a logged time.scale)', async () => {
  const w = new Worker(new URL('./helpers/workerboot.ts', import.meta.url));
  const waiting: { pred: (m: FromWorker) => boolean; ok: (m: FromWorker) => void }[] = [];
  w.on('message', (m: FromWorker) => {
    for (let i = 0; i < waiting.length; i++) if (waiting[i].pred(m)) { waiting[i].ok(m); waiting.splice(i, 1); return; }
  });
  const next = <T extends FromWorker>(pred: (m: FromWorker) => boolean): Promise<T> =>
    new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('timeout waiting for the worker')), 60000);
      waiting.push({ pred, ok: (m) => { clearTimeout(t); ok(m as T); } });
    });
  try {
    await next((m) => (m as { type: string }).type === '__booted');
    const ready = next((m) => m.type === 'ready');
    w.postMessage({ type: 'init', scenario: 'sandbox', seed: 4, options: { overrides: { n: 16 }, speed: 0 } });
    await ready;
    const saved = async (id: number): Promise<Sim> => {
      const p = next<{ type: 'saved'; id: number; data: ArrayBuffer }>((m) => m.type === 'saved' && (m as { id: number }).id === id);
      w.postMessage({ type: 'save', id });
      return Sim.load(new Uint8Array((await p).data));
    };
    w.postMessage({ type: 'speed', speed: 1000 });
    let s = await saved(1);
    assert.equal(lapseLevel(s.u), 2, '1000x: deep time-lapse');
    w.postMessage({ type: 'speed', speed: 0 });
    s = await saved(2);
    assert.equal(lapseLevel(s.u), 2, 'paused: the level stays');
    w.postMessage({ type: 'speed', speed: 10 });
    s = await saved(3);
    assert.equal(lapseLevel(s.u), 0, '10x: real time');
    const scales = s.u.log.filter((e) => e.cmd.k === 'time.scale').map((e) => e.cmd.scale);
    assert.deepEqual(scales, [1000, 10], 'each level change is in the command log');
    // a god-layer time act (`time.speed`, CommandResult.control.speed) paces the worker and sets the level too
    const res = next<{ type: 'result'; id: number; result: { ok: boolean; control?: Record<string, number> } }>((m) => m.type === 'result' && (m as { id: number }).id === 9);
    w.postMessage({ type: 'cmd', id: 9, cmd: { k: 'time.speed', speed: 100 } });
    const r = await res;
    if (r.result.ok && r.result.control?.speed === 100) {
      s = await saved(4);
      assert.equal(lapseLevel(s.u), 1, 'time.speed 100: time-lapse level 1');
    }
  } finally {
    await w.terminate();
  }
});

test('dormant worlds: a dead moon runs its slow passes every 6 hours and wakes exactly when it comes alive', () => {
  const sim = new Sim({ seed: 12, scenario: 'sandbox', overrides: { n: 16 } });
  const moon = sim.u.planets.find((p) => !p.airy)!;
  assert.ok(moon, 'the sandbox has a dead moon');
  assert.ok(dormant(sim.u, moon));
  assert.ok(!dormant(sim.u, sim.u.planets[0]), 'the home world is alive');
  const key = `${moon.id}:clim`;
  const runs: number[] = [];
  let lastSeen = -1;
  for (let i = 0; i < 1500; i++) {
    sim.step(1);
    const r = sim.u.settings.lapse?.run[key];
    if (r !== undefined && r !== lastSeen) { runs.push(r); lastSeen = r; }
  }
  assert.ok(runs.length >= 3, `the moon's climate ran ${runs.length} times in 1500 ticks`);
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i] - runs[i - 1], 360, 'every 6 hours');
  // air wakes it: within the hour its climate is hourly again (the record consumed by the first hourly pass)
  assert.ok(sim.applyNow({ k: 'planet.add-air', planet: moon.id, amount: 1 }).ok);
  sim.step(61);
  assert.ok(!dormant(sim.u, moon));
  assert.equal(sim.u.settings.lapse?.run[key], undefined, 'back on hourly passes');
  // the world the camera is on is never dormant (the barren opening is watched)
  const barren = new Sim({ seed: 2, scenario: 'barren', overrides: { n: 16 } });
  assert.ok(!barren.u.planets[0].airy);
  assert.ok(!dormant(barren.u, barren.u.planets[0]), 'the focused dead world');
});
