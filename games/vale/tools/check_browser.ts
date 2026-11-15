// VALE tools — the browser gate (TECH-12): `npm run check:browser` (wraps this in the heavy-slot queue).
//
//   node tools/check_browser.ts [--only <step>]…        (use `npm run check:browser`, which takes the heavy slot)
//
// Steps, each a harness script against the dev server (started here on :5190 when nothing answers there, stopped at
// the end; VALE_FROZEN=1 so edits by other hands never reload a page under a journey):
//   flow    node _harness/e2e.mjs flow      the queue flow's exits (dodge, ready check, net down), 0 console errors
//   ship    node _harness/e2e_ship.mjs      device plate (render=0, touch), two tabs, fault injection
// Writes _harness/_reports/gate_<HEAD>.json {head, dirty, ok, steps}; tools/package_deploy.ts reads it.
// Exit 0 = every step passed, 1 = a step failed, 2 = the dev server did not start.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirtyHash, gatePath, headSha, REPORTS, ROOT, type GateReport } from './gate_fingerprint.ts';

const STEPS: { name: string; args: string[] }[] = [
  { name: 'flow', args: ['_harness/e2e.mjs', 'flow'] },
  { name: 'ship', args: ['_harness/e2e_ship.mjs'] },
];
const URL_ = process.env.VALE_URL ?? 'http://localhost:5190';

const only: string[] = [];
for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--only' && process.argv[i + 1]) only.push(process.argv[++i]);
const steps = only.length ? STEPS.filter((s) => only.includes(s.name)) : STEPS;
if (only.length && only.length !== steps.length) { console.error(`unknown step in --only (have: ${STEPS.map((s) => s.name).join(', ')})`); process.exit(2); }

async function up(): Promise<boolean> {
  try { const r = await fetch(`${URL_}/`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}

function run(args: string[]): Promise<number | null> {
  return new Promise((done) => {
    const c = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VALE_URL: URL_ } });
    c.on('close', (code) => done(code));
  });
}

async function main(): Promise<number> {
  const head = headSha();
  const dirty = dirtyHash();
  let server: ChildProcess | null = null;
  if (!(await up())) {
    server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js')], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VALE_FROZEN: '1' } });
    for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await up())) { server.kill(); console.error(`dev server did not answer on ${URL_}`); return 2; }
  }
  const report: GateReport = { head, dirty, ok: true, at: new Date().toISOString(), steps: [] };
  try {
    for (const s of steps) {
      const t0 = Date.now();
      console.log(`\n== check:browser ${s.name}: node ${s.args.join(' ')}`);
      const code = await run(s.args);
      report.steps.push({ name: s.name, cmd: `node ${s.args.join(' ')}`, code, seconds: Math.round((Date.now() - t0) / 100) / 10 });
      if (code !== 0) report.ok = false;
    }
  } finally { server?.kill(); }
  // a partial run (--only) is a diagnostic, never a gate: it must not stand in for the full set
  if (steps.length === STEPS.length) { mkdirSync(REPORTS, { recursive: true }); writeFileSync(gatePath(head), `${JSON.stringify(report, null, 2)}\n`); }
  console.log(`\ncheck:browser ${report.ok ? 'GREEN' : 'RED'} for HEAD ${head.slice(0, 10)} dirty ${dirty}${steps.length === STEPS.length ? ` -> ${gatePath(head).slice(ROOT.length + 1)}` : ' (partial run, no report written)'}`);
  return report.ok ? 0 : 1;
}

process.exitCode = await main();
