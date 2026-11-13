// HIT PARADE — probe runner (CONTRACT §13: `npm run probe` = `node _harness/run_probes.ts`).
// Auto-discovers every _harness/probe_*.ts, runs each with plain `node` (one process per probe,
// utf-8, sequential), prints each probe's last output line plus a summary table, and exits 1 if
// any probe failed (non-zero exit, timeout or crash). Lanes add probes by adding files.
//
//   node _harness/run_probes.ts            run all
//   node _harness/run_probes.ts moves hits run the probes whose name contains a filter word
//   node _harness/run_probes.ts -v         show every probe's full output

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const filters = args.filter((a) => !a.startsWith('-') && a !== 'all');
const TIMEOUT_MS = 10 * 60 * 1000;

const probes = readdirSync(HERE)
  .filter((f) => /^probe_.+\.ts$/.test(f))
  .filter((f) => filters.length === 0 || filters.some((w) => f.includes(w)))
  .sort();

if (probes.length === 0) {
  console.log(`run_probes: no probes matched ${filters.length ? filters.join(' ') : '(none found)'}`);
  process.exit(1);
}

interface Row {
  name: string;
  ok: boolean;
  ms: number;
  line: string;
}
const rows: Row[] = [];
for (const f of probes) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, f), ...(verbose ? ['-v'] : [])], {
    cwd: join(HERE, '..'),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r/g, '');
  const lines = out.split('\n').filter((l) => l.trim() !== '');
  const timedOut = r.error !== undefined && /ETIMEDOUT/.test(String(r.error));
  const ok = r.status === 0 && !timedOut;
  let line = lines.length ? lines[lines.length - 1] : '(no output)';
  if (timedOut) line = `TIMEOUT after ${TIMEOUT_MS / 1000} s`;
  else if (r.status !== 0 && r.status !== 1) line = `exit ${r.status}${r.signal ? ' ' + r.signal : ''}: ${line}`;
  rows.push({ name: f.replace(/\.ts$/, ''), ok, ms, line });
  if (verbose || !ok) {
    const show = verbose ? lines : lines.slice(-25);
    for (const l of show) console.log(`  | ${l}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(26)} ${(ms / 1000).toFixed(1).padStart(6)} s  ${line}`);
}
const failed = rows.filter((r) => !r.ok);
console.log(`\nrun_probes: ${rows.length - failed.length}/${rows.length} PASS${failed.length ? '  FAILED: ' + failed.map((r) => r.name).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
