// Runs every _harness/probe_*.ts under plain `node` (type stripping), sequentially, and fails if any probe fails.
// Browser-driven probes live in *.mjs files (probe_audio.mjs, browser_*.mjs) and are run on demand, not here.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const probes = readdirSync(here).filter((f) => /^probe_.*\.ts$/.test(f)).sort();
// Per-probe arguments: probe_truecut.ts (CUT2 task P1b) is a long probe (50 species x 23 planes + the red-team families + nested trees: tens of minutes on a busy
// machine); here it runs its --quick set (8 species). The full run is `node _harness/probe_truecut.ts`.
// probe_many.ts (CUT3 PHYS: detail by share, sleep / wake, the broad phase, the budget) runs its --quick set here (about 2.5 minutes); the full run is `node _harness/probe_many.ts`.
const ARGS: Record<string, string[]> = { 'probe_truecut.ts': ['--quick'], 'probe_many.ts': ['--quick'] };
let failed = 0;
for (const p of probes) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [resolve(here, p), ...(ARGS[p] ?? [])], { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(`\n${probes.length - failed}/${probes.length} probes passed`);
process.exit(failed ? 1 : 0);
