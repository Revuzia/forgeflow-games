// fix-r3 (item 6): a loaded Two worlds game continues exactly like the world it was saved from. The bug: hydrology's
// sheet pass woke a higher sleeper straight to "awake" without collecting it, so inflow sent to it later in the same
// step sat in the scratch dV (outside the save) until the next step — a loaded game lost it and diverged one tick
// after loading (live: twoworlds seed 20261104 at 1000x had a pending dV from tick 361 on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim.ts';

const SEED = 20261104;

function twoworlds(): Sim {
  const sim = new Sim({ seed: SEED, scenario: 'twoworlds' });
  sim.step(5);
  sim.applyNow({ k: 'time.scale', tps: 3000 } as never);
  return sim;
}

test('save/continue: hydrology leaves no pending water between steps (Two worlds at 1000x, 600 ticks)', () => {
  const sim = twoworlds();
  for (let t = 0; t < 600; t++) {
    sim.step(1);
    for (const p of sim.u.planets) {
      const d = (p as unknown as { scratch: { dV: Float64Array } }).scratch.dV;
      for (let c = 0; c < d.length; c++) {
        if (d[c] !== 0) assert.fail(`tick ${sim.u.tick} planet ${p.id} cell ${c}: ${d[c]} m³ pending outside the save`);
      }
    }
  }
});

test('save/continue: a Two worlds save loaded in a fresh process continues tick for tick', () => {
  const sim = twoworlds();
  sim.step(361 - sim.u.tick); // (the tick the old code first left water pending)
  const dir = mkdtempSync(join(tmpdir(), 'genesis-sc-'));
  try {
    const file = join(dir, 'tw.sav');
    writeFileSync(file, sim.save());
    const marks = [1, 2, 10, 50, 300];
    const live: string[] = [];
    const t0 = sim.u.tick;
    for (const m of marks) { sim.step(t0 + m - sim.u.tick); live.push(sim.hash()); }
    const simUrl = new URL('../src/sim/sim.ts', import.meta.url).href;
    const code = `import { readFileSync } from 'node:fs'; const { Sim } = await import(${JSON.stringify(simUrl)});
      const sim = Sim.load(new Uint8Array(readFileSync(${JSON.stringify(file)}))); const t0 = sim.u.tick; const out = [];
      for (const m of ${JSON.stringify(marks)}) { sim.step(t0 + m - sim.u.tick); out.push(sim.hash()); } console.log(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 300_000 });
    assert.equal(r.status, 0, r.stderr);
    const loaded = JSON.parse(r.stdout.trim().split('\n').pop()!) as string[];
    marks.forEach((m, i) => assert.equal(loaded[i], live[i], `+${m} ticks after loading`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
