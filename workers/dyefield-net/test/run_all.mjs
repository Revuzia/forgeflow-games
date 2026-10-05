// Runs NET-SERVER T1–T10 (CONTRACT_ONLINE.md §O12.1) against `wrangler dev --local` on 127.0.0.1:8790.
// Each suite gets its own wrangler dev instance (fresh persistence) with the vars it needs.
//   node test/run_all.mjs            all suites
//   node test/run_all.mjs t3 t5      only the named tests
// Report: test/_reports/net_server.json
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const QM_FAST = { QM_FILL_WAIT_S: 2, QM_MAX_WAIT_S: 4, QM_SOLO_WAIT_S: 5, QM_AUTOSTART_S: 2, REMATCH_WINDOW_S: 3 };

const SUITES = [
  { name: 'A-base', vars: { ...QM_FAST }, tests: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't10'] },
  { name: 'B-idle', vars: { PREMATCH_PING_IDLE_S: 3, ROOM_IDLE_CLOSE_MIN: 0.15, PER_IP_ROOM: 2, PER_IP_LOBBY: 1 }, tests: ['t7idle', 't4ip'] },
  { name: 'C-strict', vars: { COUNT_MODE: 'strict', RAW_CAP: 3000, DAILY_UNIT_CAP: 1000000, QM_FILL_WAIT_S: 1 }, tests: ['t8'] },
  { name: 'D-billing20', vars: { COUNT_MODE: 'billing20', RAW_CAP: 1, DAILY_UNIT_CAP: 120 }, tests: ['t8b'] },
  { name: 'E-load', vars: {}, tests: ['t9'] },
];

const want = process.argv.slice(2).map((s) => s.toLowerCase());
const results = [];
const t0 = Date.now();
for (const s of SUITES) {
  const tests = s.tests.filter((t) => !want.length || want.includes(t) || want.includes(t.replace(/[a-z]+$/, '')));
  if (!tests.length) continue;
  console.log(`\n=== suite ${s.name} (vars ${JSON.stringify(s.vars)}) ===`);
  let dev;
  try {
    dev = await L.startDev(s.vars, { label: s.name });
  } catch (e) {
    console.log('  [FAIL] could not start wrangler dev: ' + e.message);
    results.push({ name: s.name, passed: false, n: 1, failed: [{ ok: false, what: 'start wrangler dev', detail: e.message }] });
    continue;
  }
  console.log(`  wrangler dev up in ${dev.startMs} ms`);
  for (const t of tests) {
    const mod = await import('./' + fileFor(t));
    const C = new L.Checks(t.toUpperCase());
    const ts = Date.now();
    console.log(`--- ${t} ---`);
    await C.step(t, () => (mod[runFor(t)] ?? mod.run)(dev, C));
    const sum = { ...C.summary(), suite: s.name, ms: Date.now() - ts, extra: C.extra ?? undefined };
    results.push(sum);
    console.log(`--- ${t}: ${sum.passed ? 'PASS' : 'FAIL'} (${sum.n} checks, ${sum.failed.length} failed, ${sum.ms} ms)`);
  }
  await dev.stop();
}

function fileFor(t) {
  return (
    {
      t1: 't1_rooms.mjs',
      t2: 't2_quick.mjs',
      t3: 't3_routing.mjs',
      t4: 't4_caps.mjs',
      t4ip: 't4_caps.mjs',
      t5: 't5_hostloss.mjs',
      t6: 't6_reconnect.mjs',
      t7: 't7_idle.mjs',
      t7idle: 't7_idle.mjs',
      t8: 't8_meter.mjs',
      t8b: 't8_meter.mjs',
      t9: 't9_load.mjs',
      t10: 't10_hibernate.mjs',
    }[t] ?? t + '.mjs'
  );
}
function runFor(t) {
  return { t4ip: 'runPerIp', t7idle: 'runIdle', t8b: 'runBilling20' }[t] ?? 'run';
}

const out = {
  at: new Date().toISOString(),
  ms: Date.now() - t0,
  passed: results.every((r) => r.passed),
  results,
};
const dir = path.join(L.HERE, '_reports');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'net_server.json'), JSON.stringify(out, null, 2));
console.log(`\n=== ${out.passed ? 'ALL PASS' : 'FAILURES'}: ${results.filter((r) => r.passed).length}/${results.length} tests, ${Math.round(out.ms / 1000)} s ===`);
for (const r of results) if (!r.passed) console.log(`  FAIL ${r.name}: ${r.failed.map((f) => f.what).join(' | ')}`);
process.exit(out.passed ? 0 : 1);
