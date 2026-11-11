// PERF F5 — per-cell ground change revisions (src/client/groundgrad.ts cellRev / changedSince): every cell whose
// height OR gradient changed between two commits is reported as changed since the first (the buildings re-place only
// those), an identical surface changes nothing (lastCells 0: WorldView then bumps no version), and a full pass counts
// as a change everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { GroundGradients } from '../src/client/groundgrad.ts';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('changedSince covers every cell whose height or gradient changed, and nothing else', () => {
  const grid = getGrid(48);
  const n = grid.count, r = rng(11);
  let s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin(grid.pos[i * 3] * 7) * 900 + r() * 30;
  const gg = new GroundGradients(grid);
  gg.update(s, 3e6);
  for (let round = 0; round < 8; round++) {
    const since = gg.rev, prevS = s, prevG = Float32Array.from(gg.grad!);
    s = Float32Array.from(s);
    const edits = round === 3 ? 0 : 1 + Math.floor(r() * 60);
    for (let e = 0; e < edits; e++) s[Math.floor(r() * n)] += (r() - 0.5) * 40;
    gg.update(s, 3e6);
    if (edits === 0) assert.equal(gg.lastCells, 0, 'an identical surface recomputes nothing');
    let marked = 0;
    for (let c = 0; c < n; c++) {
      const changed = s[c] !== prevS[c] || gg.grad![c * 4] !== prevG[c * 4] || gg.grad![c * 4 + 1] !== prevG[c * 4 + 1]
        || gg.grad![c * 4 + 2] !== prevG[c * 4 + 2] || gg.grad![c * 4 + 3] !== prevG[c * 4 + 3];
      const rep = gg.changedSince(since, [c]);
      if (changed) assert.ok(rep, `round ${round}: cell ${c} changed but is not reported`);
      if (rep) marked++;
    }
    assert.ok(marked <= edits * 12, `round ${round}: ${marked} cells reported for ${edits} edits`);
    assert.equal(gg.changedSince(gg.rev, [0, 1, 2, n - 1]), false);
  }
  // a full pass (new radius) is a change everywhere
  const since = gg.rev;
  gg.update(Float32Array.from(s), 2e6);
  assert.equal(gg.changedSince(since, [5]), true);
});
