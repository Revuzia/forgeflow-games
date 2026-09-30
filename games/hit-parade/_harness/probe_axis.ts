// probe_axis (G2, lane SIM3D): the SIM probes off the x axis (CONTRACT §35). The fixture stage's spawn axis is set by
// env HP_PROBE_AXIS (fixtures/simkit.ts; the probes work in the match's LINE frame), so re-running the system probes
// with the fight line turned 33 deg and 200 deg exercises every system - walks, dashes, jumps, authored travel,
// pushback + corner transfer, throws + carries, projectiles, meters, rounds, bodies, uniques - with both x AND z moving.
// Each child probe must PASS on each axis.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBES = ['moves', 'hits', 'block', 'throws', 'meters', 'rounds', 'projectiles', 'motion', 'bodies', 'uniques'];
const AXES = [33, 200];
const verbose = process.argv.includes('-v');
const bad: string[] = [];
let runs = 0;
let checks = 0;
for (const ax of AXES) {
  for (const p of PROBES) {
    const r = spawnSync(process.execPath, [join(HERE, `probe_${p}.ts`)], {
      cwd: join(HERE, '..'),
      encoding: 'utf8',
      env: { ...process.env, HP_PROBE_AXIS: String(ax), NODE_NO_WARNINGS: '1', FORCE_COLOR: '0' },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    runs++;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r/g, '');
    const lines = out.split('\n').filter((l) => l.trim() !== '');
    const last = lines.length ? lines[lines.length - 1] : '(no output)';
    const m = /(\d+)\/(\d+) checks/.exec(last);
    if (m) checks += Number(m[2]);
    if (r.status !== 0) {
      bad.push(`axis ${ax} ${p}: ${last}`);
      for (const l of lines.filter((q) => q.includes('FAIL')).slice(0, 8)) console.log(`  | axis ${ax} ${l.trim()}`);
    } else if (verbose) console.log(`  ok axis ${ax}: ${last}`);
  }
}
for (const b of bad) console.log(`  FAIL ${b}`);
console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'} probe_axis: ${runs - bad.length}/${runs} probe runs on rotated fight lines (${AXES.join(' / ')} deg; ${checks} checks: ${PROBES.join(' ')})`);
process.exit(bad.length === 0 ? 0 : 1);
