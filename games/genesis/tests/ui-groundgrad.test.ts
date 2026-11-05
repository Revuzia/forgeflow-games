// GENESIS — the client's incremental ground gradients (src/client/groundgrad.ts, macfix 2026-11) must equal a full
// surfaceGradients pass bit for bit after every new surface array: sparse edits (recomputed in place), wide edits (full
// pass), a radius change, and through WorldView.apply on a real sim's snapshots (picking reads pv.ground.grad).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { surfaceGradients } from '../src/sim/grid/surface.ts';
import { GroundGradients } from '../src/client/groundgrad.ts';
import { Sim } from '../src/sim/sim.ts';
import { WorldView } from '../src/client/worldview.ts';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const same = (a: Float32Array, b: Float32Array) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

test('incremental ground gradients are bit-identical to a full pass, edit after edit', () => {
  const grid = getGrid(64);
  const n = grid.count, r = rng(5);
  let s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin(grid.pos[i * 3] * 7) * 900 + Math.cos(grid.pos[i * 3 + 2] * 5) * 400 + r() * 30;
  const gg = new GroundGradients(grid);
  let radius = 6.4e6;
  for (let round = 0; round < 12; round++) {
    s = Float32Array.from(s); // each arrival is a fresh array, as from the worker
    const edits = round === 5 ? n >> 2 : round === 0 ? 0 : 1 + Math.floor(r() * 200);
    for (let e = 0; e < edits; e++) s[Math.floor(r() * n)] += (r() - 0.5) * 50;
    if (round === 9) radius = 3.4e6;
    gg.update(s, radius);
    const full = surfaceGradients(grid, radius, s);
    assert.ok(same(gg.grad!, full), `round ${round}: gradients differ from the full pass`);
    let lo = Infinity, hi = -Infinity, gm = 0;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, s[i]); hi = Math.max(hi, s[i]); }
    for (let i = 0; i < full.length; i += 4) gm = Math.max(gm, full[i] ** 2 + full[i + 1] ** 2 + full[i + 2] ** 2);
    assert.equal(gg.minSurface, lo); assert.equal(gg.maxSurface, hi); assert.equal(gg.maxGrad, Math.sqrt(gm));
    if (round > 0 && round !== 5 && round !== 9) assert.ok(gg.lastCells < n / 8, `round ${round}: a sparse edit recomputed ${gg.lastCells} cells`);
    if (round === 5 || round === 9) assert.equal(gg.lastCells, n, `round ${round}: wide edit / new radius takes the full pass`);
  }
});

test('WorldView keeps pv.ground.grad equal to a full pass over its surface on a running sim', () => {
  const sim = new Sim({ seed: 7, scenario: 'twoworlds' } as never);
  sim.step(30);
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  for (let k = 0; k < 6; k++) {
    sim.step(40);
    view.apply(sim.snapshot({ full: true }), k + 1);
  }
  for (const p of sim.u.planets) {
    const pv = view.planet(p.id)!;
    const full = surfaceGradients(pv.grid, pv.ground.radius, pv.ground.surface);
    assert.ok(same(pv.ground.grad as Float32Array, full), `planet ${p.id}`);
  }
});

test('a surface worked off in slices commits heights and gradients together, and a newer one waits its turn', () => {
  const grid = getGrid(64);
  const n = grid.count, r = rng(9), radius = 6.4e6;
  const s0 = new Float32Array(n);
  for (let i = 0; i < n; i++) s0[i] = Math.sin(grid.pos[i * 3 + 1] * 6) * 700 + r() * 20;
  const gg = new GroundGradients(grid);
  gg.update(s0, radius);
  const before = Float32Array.from(gg.grad!);
  const s1 = Float32Array.from(s0); for (let e = 0; e < 150; e++) s1[Math.floor(r() * n)] += 40;
  const s2 = Float32Array.from(s1); for (let i = 0; i < n; i += 3) s2[i] -= 25; // wide: the full pass
  gg.offer(s1, radius);
  gg.offer(s2, radius);
  let calls = 0, commits = 0;
  while (gg.pending()) {
    if (gg.step(0)) {
      commits++;
      const want = commits === 1 ? s1 : s2;
      assert.equal(gg.surface, want, `commit ${commits} carries its own heights`);
      assert.ok(same(gg.grad!, surfaceGradients(grid, radius, want)), `commit ${commits}: gradients match its heights`);
    } else assert.ok(same(gg.grad!, commits === 0 ? before : surfaceGradients(grid, radius, s1)), 'nothing changes before a commit');
    calls++;
  }
  assert.equal(commits, 2);
  assert.ok(calls > 6, `a zero budget advances one slice per call (${calls} calls)`);
});
