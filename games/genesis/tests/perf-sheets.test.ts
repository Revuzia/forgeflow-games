// GENESIS — overland sheet flow (SIM perf push 2, src/sim/fields/hydrology.ts "sheets: thin overland flow"): land water
// thinner than SHEET_IN runs as zero-inertia sheet flow until it is deeper than SHEET_OUT, then the pipes (momentum) carry
// it. A film runs downhill and comes to rest, every m³ it moves is accounted, the mode split has its hysteresis, the sea
// is never a sheet, and a save in the middle of a downpour's sheet flow continues identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { activateCell, conservedVolume, hydroStep, DRY, SHEET, SHEET_IN, SHEET_OUT } from '../src/sim/fields/hydrology.ts';
import type { Planet } from '../src/sim/world/planet.ts';

/** a small terran world with no rain and no springs (only the water a test puts down moves on land) */
function quietWorld(seed: number): { sim: Sim; p: Planet } {
  const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  p.cfg.rainScale = 0;
  p.springs = [];
  sim.step(200); // (even: the hydrology steps on even ticks)
  return { sim, p };
}

/** one hydrology step outside the tick loop (as the throughput tests do) */
function hstep(sim: Sim, p: Planet): void {
  hydroStep(sim.u, p);
  sim.u.tick += 2;
}

/** dry land cells whose two rings are dry land and asleep, with the drop to their lowest neighbour in [lo, hi] m */
function slopeCells(p: Planet, lo: number, hi: number): number[] {
  const g = p.grid, surf = p.f.surface, water = p.f.water, ocean = p.s.ocean, act = p.s.hAct;
  const quiet = (c: number): boolean => ocean[c] === 0 && water[c] <= DRY && act[c] === 0;
  const out: number[] = [];
  for (let c = 0; c < p.count; c++) {
    if (!quiet(c)) continue;
    let ok = true, low = Infinity;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1] && ok; e++) {
      const o = g.nbr[e];
      if (!quiet(o)) ok = false;
      if (surf[o] < low) low = surf[o];
      for (let e2 = g.nbrStart[o]; e2 < g.nbrStart[o + 1] && ok; e2++) if (!quiet(g.nbr[e2])) ok = false;
    }
    const drop = surf[c] - low;
    if (ok && drop >= lo && drop <= hi) out.push(c);
  }
  return out;
}

test('sheets: a thin film on a hillside runs downhill as sheet flow, every m³ accounted, and comes to rest', () => {
  const { sim, p } = quietWorld(21);
  const g = p.grid, water = p.f.water, surf = p.f.surface, A = p.cellArea, act = p.s.hAct;
  const cells = slopeCells(p, 2, 40);
  assert.ok(cells.length > 0, 'no dry hillside cell on the test world');
  const c = cells[0];
  const film = 0.015;
  assert.ok(film < SHEET_IN);
  water[c] = film;
  activateCell(p, c);
  const v0 = conservedVolume(p), scale = p.waterVolume();
  const nb: number[] = [];
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) nb.push(g.nbr[e]);
  const before = nb.map((o) => water[o] * A[o]);
  hstep(sim, p);
  // it ran as a sheet, downhill, and exactly what left it arrived in its neighbours (none of them is sea)
  assert.equal(act[c], SHEET, `the film's cell is in mode ${act[c]}, not a sheet`);
  const sent = (film - water[c]) * A[c];
  assert.ok(sent > 0, 'the film did not move');
  const got = nb.reduce((s, o, i) => s + water[o] * A[o] - before[i], 0);
  assert.ok(Math.abs(got - sent) <= 1e-9 * sent, `sent ${sent} m³, the neighbours got ${got} m³`);
  for (let i = 0; i < nb.length; i++) {
    const o = nb[i];
    if (water[o] * A[o] > before[i]) assert.ok(surf[o] < surf[c] + film, `water ran uphill into ${o}`);
  }
  // the velocity points downhill (toward the receivers)
  let dot = 0;
  for (let i = 0; i < nb.length; i++) {
    const o = nb[i], gain = water[o] * A[o] - before[i];
    if (gain <= 0) continue;
    for (let k = 0; k < 3; k++) dot += gain * (g.pos[o * 3 + k] - g.pos[c * 3 + k]) * [p.f.flowX, p.f.flowY, p.f.flowZ][k][c];
  }
  assert.ok(dot > 0, 'the sheet velocity does not point at its receivers');
  // run on: the film leaves the hillside and the books balance to rounding
  for (let i = 0; i < 1500; i++) {
    hstep(sim, p);
    if (i % 100 === 0) for (let k = 0; k < p.count; k++) assert.ok(!(act[k] === SHEET && p.s.ocean[k] !== 0), `sea cell ${k} is a sheet`);
  }
  const drift = Math.abs(conservedVolume(p) - v0) / scale;
  assert.ok(drift < 1e-9, `conserved volume drift ${drift.toExponential(2)} of the water volume`);
  assert.ok(water[c] <= DRY + 1e-12, `${(water[c] * 1000).toFixed(2)} mm left on the hillside cell`);
  assert.equal(act[c], 0, 'the drained hillside cell is still awake');
});

test('sheets: the mode split — thin land water is a sheet, deep water runs in the pipes, with hysteresis', () => {
  const { sim, p } = quietWorld(23);
  const water = p.f.water, act = p.s.hAct;
  const cells = slopeCells(p, 0.3, 3);
  assert.ok(cells.length > 0, 'no gentle hillside cell on the test world');
  const c = cells[0];
  const put = (w: number): void => { water[c] = w; activateCell(p, c); };
  const mode = (): string => (act[c] === SHEET ? 'sheet' : act[c] === 0 ? 'asleep' : 'pipe');
  put(0.015); hstep(sim, p);
  assert.equal(mode(), 'sheet', '1.5 cm on a slope flows as a sheet');
  const mid = (SHEET_IN + SHEET_OUT) / 2; // 3.5 cm: inside the hysteresis band
  put(mid); hstep(sim, p);
  assert.equal(mode(), 'sheet', 'a sheet deepening to 3.5 cm stays a sheet (below SHEET_OUT)');
  put(SHEET_OUT + 0.02); hstep(sim, p);
  assert.equal(mode(), 'pipe', 'a sheet deeper than SHEET_OUT goes to the pipes');
  put(mid); hstep(sim, p);
  assert.equal(mode(), 'pipe', 'a pipe cell thinning to 3.5 cm stays in the pipes (above SHEET_IN)');
  put(0.012); hstep(sim, p);
  assert.equal(mode(), 'sheet', 'a pipe cell thinner than SHEET_IN becomes a sheet');
});

test('sheets: a downpour runs mostly as sheets; the sea never; a save mid-flow continues identically', () => {
  const a = new Sim({ seed: 9, scenario: 'sandbox', overrides: { n: 24 } });
  const p = a.u.planets[0];
  a.step(300);
  assert.ok(a.applyNow({ k: 'weather.global', planet: p.id, kind: 'monsoon' }).ok);
  a.step(400);
  let sheets = 0, pipes = 0;
  for (let c = 0; c < p.count; c++) {
    const m = p.s.hAct[c];
    if (m === SHEET) { sheets++; assert.equal(p.s.ocean[c], 0, `sea cell ${c} is a sheet`); } else if (m !== 0) pipes++;
  }
  assert.ok(sheets > 50 && sheets > pipes / 4, `${sheets} sheets, ${pipes} pipe cells in a downpour`);
  const b = Sim.load(a.save());
  assert.equal(b.hash(), a.hash());
  a.step(301);
  b.step(301);
  assert.equal(b.hash(), a.hash(), 'a save in the middle of sheet flow diverged');
});

/** ground moved by water (sand / soil / ash / rock, not snow or ice) and the mean speed of river cells (> 10 cm deep,
 * faster than 0.3 m/s, sampled hourly) in a 2-day planet-wide monsoon on a small terran world */
function monsoonWork(seed: number, scale: number): { moved: number; speed: number } {
  const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 32 } });
  assert.ok(sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 }).ok);
  if (scale > 1) assert.ok(sim.applyNow({ k: 'time.scale', scale }).ok);
  const p = sim.u.planets[0], f = p.f;
  sim.step(600);
  const s0 = Float32Array.from(f.surface), snow0 = Float32Array.from(f.snow), ice0 = Float32Array.from(f.ice);
  assert.ok(sim.applyNow({ k: 'weather.global', planet: 0, kind: 'monsoon' }).ok);
  let rs = 0, rn = 0;
  for (let t = 0; t < 2880; t += 60) {
    sim.step(60);
    for (let c = 0; c < p.count; c++) {
      if (p.s.ocean[c] || f.water[c] <= 0.1) continue;
      const v = Math.hypot(f.flowX[c], f.flowY[c], f.flowZ[c]);
      if (v > 0.3) { rs += v; rn++; }
    }
  }
  let moved = 0;
  for (let c = 0; c < p.count; c++) moved += Math.abs((f.surface[c] - s0[c]) - ((f.snow[c] - snow0[c]) + (f.ice[c] - ice0[c]))) * p.cellArea[c];
  return { moved, speed: rs / rn };
}

test('sheets: a monsoon carves and the rivers run as with the pipes alone (1x)', { timeout: 300_000 }, () => {
  // References: the same measurement on the pure-pipes model (git HEAD before SIM perf push 2's sheets). Sheets that
  // counted only their outflow in their velocity (half the pipes' through a channel), and rivers that did not see what
  // the sheets fed them, carved ~35 % less (round 2: sheets keep their per-step edge flux; inflow counts).
  const REF: Record<number, { moved: number; speed: number }> = { 1234: { moved: 425.4e3, speed: 8.23 }, 7: { moved: 364.5e3, speed: 4.52 } };
  let m1 = 0, m100 = 0;
  for (const seed of [1234, 7]) {
    const got = monsoonWork(seed, 1), ref = REF[seed];
    const msg = `seed ${seed}: ${(got.moved / 1e3).toFixed(1)}e3 m³ moved, river speed ${got.speed.toFixed(2)} m/s (pure pipes ${(ref.moved / 1e3).toFixed(1)}e3, ${ref.speed})`;
    assert.ok(Math.abs(got.moved / ref.moved - 1) < 0.1, `ground moved: ${msg}`);
    assert.ok(Math.abs(got.speed / ref.speed - 1) < 0.1, `river speed: ${msg}`);
    m1 += got.moved;
    m100 += monsoonWork(seed, 100).moved;
  }
  // time-lapse carves more (bigger rain batches and coarser sheet steps make pulses, and erosion is a threshold of
  // speed): measured +12-26 % at 100x on this world, +15 % on the home world at 100x and 1000x (sim.ts header)
  assert.ok(m100 < 1.35 * m1, `100x moved ${(m100 / 1e3).toFixed(0)}e3 m³, 1x ${(m1 / 1e3).toFixed(0)}e3 m³`);
});
