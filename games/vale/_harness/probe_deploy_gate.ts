// VALE harness (lane W1-E, TECH-12): tools/package_deploy.ts refuses to stage without a green browser gate for this
// HEAD and these shipped sources; --override "<reason>" stages anyway and logs. Runs the real tool against a temp
// report folder (VALE_GATE_DIR) and a temp --out, so nothing in the project changes.
//
//   node _harness/probe_deploy_gate.ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish } from './fixtures/sim_fixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'vale-gate-'));
const gateDir = join(tmp, 'reports');
process.env.VALE_GATE_DIR = gateDir;
const { dirtyHash, gatePath, headSha, gateProblem } = await import('../tools/gate_fingerprint.ts');
const head = headSha();
const dirty = dirtyHash();
const out = join(tmp, 'deploy');
const run = (...extra: string[]) => {
  const r = spawnSync(process.execPath, ['tools/package_deploy.ts', '--dist', join(tmp, 'nodist'), '--catalog', join(tmp, 'nocat'), '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, VALE_GATE_DIR: gateDir } });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
};
const write = (o: object): void => { writeFileSync(gatePath(head), JSON.stringify({ head, dirty, ok: true, at: 'now', steps: [], ...o })); };
const mk = (): void => { spawnSync('mkdir', ['-p', gateDir]); };
mk();

let r = run();
check('no gate report: refused (exit 1, names the gate)', r.code === 1 && /browser gate: no browser gate report/.test(r.text), r.text.slice(0, 200));
write({ ok: false, steps: [{ name: 'ship', cmd: 'x', code: 1, seconds: 1 }] });
r = run();
check('red gate report: refused and names the failing step', r.code === 1 && /is red: ship/.test(r.text), r.text.slice(0, 200));
write({ dirty: 'deadbeefdeadbeef' });
r = run();
check('green report taken on other sources: refused as stale', r.code === 1 && /different shipped sources/.test(r.text), r.text.slice(0, 200));
write({ head: 'a'.repeat(40) });
r = run();
check('report naming another HEAD: refused', r.code === 1 && /names HEAD/.test(r.text), r.text.slice(0, 200));
write({});
check('green report for this tree: gateProblem() is null', gateProblem() === null, gateProblem());
r = run();
check('green report: the gate passes (the run goes on to the dist/catalog checks and fails there)', !/browser gate/.test(r.text) && /index\.html missing/.test(r.text), r.text.slice(0, 200));
r = run('--override', 'short');
check('--override with a short reason is a usage error', r.code === 2 && /at least 8/.test(r.text), r.text.slice(0, 200));
rmSync(gatePath(head), { force: true });
r = run('--override', 'probe: staging a known-red tree on purpose');
const log = existsSync(join(gateDir, 'deploy_overrides.log')) ? readFileSync(join(gateDir, 'deploy_overrides.log'), 'utf8') : '';
check('--override with a reason goes past the gate with a warning', /gate overridden/.test(r.text) && /index\.html missing/.test(r.text), r.text.slice(0, 240));
check('--override is logged with reason, HEAD and the gate problem', log.includes('probe: staging a known-red tree on purpose') && log.includes(head) && /no browser gate report/.test(log), log.slice(0, 200));
rmSync(tmp, { recursive: true, force: true });
finish('probe_deploy_gate');
