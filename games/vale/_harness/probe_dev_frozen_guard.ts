// probe (lane TOOLS / controls env): a frozen dev server (VALE_FROZEN=1) cannot quietly outlive its run (orch1 verify r2,
// MAJOR: a frozen vite left on the shared :5190 for 11 h served a src/input/controller.ts without any attack-in-place
// code, so Shift + left-click sent 0 attackAt commands for everyone who played or verified there).
//   header  every response carries X-Vale-Frozen: <start ISO>
//   report  GET /__frozen = { since, ttlMin, changed[] } (the src / public files edited since it started)
//   ttl     it exits by itself after VALE_FROZEN_TTL_MIN minutes
//   live    a non-frozen server answers without the header
// Starts its own servers on free ports (never touches :5190).
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');

function freePort(): Promise<number> {
  return new Promise((res, rej) => { const s = createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function up(port: number, ms: number): Promise<Response | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { return await fetch(`http://127.0.0.1:${port}/`); } catch { await wait(250); }
  }
  return null;
}
function start(port: number, env: Record<string, string>): { child: ChildProcess; exited: Promise<number | null> } {
  const child = spawn(process.execPath, [VITE, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...env } });
  const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  return { child, exited };
}

const results: Array<() => void> = [];
{
  const port = await freePort();
  const s = start(port, { VALE_FROZEN: '1', VALE_FROZEN_TTL_MIN: '0.15' });   // 9 s
  const r = await up(port, 30_000);
  const hdr = r?.headers.get('x-vale-frozen') ?? null;
  type Rep = { since?: string; ttlMin?: number; changed?: unknown };
  const rep: Rep | null = await fetch(`http://127.0.0.1:${port}/__frozen`).then((x) => x.json() as Promise<Rep>).catch(() => null);
  const t0 = Date.now();
  const code = await Promise.race([s.exited, wait(40_000).then(() => 'timeout' as const)]);
  const took = (Date.now() - t0) / 1000;
  if (code === 'timeout') s.child.kill('SIGTERM');
  results.push(() => section('frozen: tagged, reports its staleness, exits on its TTL', () => {
    check('the frozen server answered', !!r && r.ok, r?.status);
    check('X-Vale-Frozen carries its start time', !!hdr && !Number.isNaN(Date.parse(hdr)), hdr);
    check('/__frozen reports since, ttlMin and the changed list', rep !== null && rep.since === hdr && rep.ttlMin === 0.15 && Array.isArray(rep.changed), rep);
    check('it exited by itself on its TTL (well under 40 s)', code !== 'timeout', { code, took });
  }));
}
{
  const port = await freePort();
  const s = start(port, { VALE_FROZEN: '' });
  const r = await up(port, 30_000);
  const hdr = r?.headers.get('x-vale-frozen') ?? null;
  s.child.kill('SIGTERM');
  await Promise.race([s.exited, wait(10_000)]);
  results.push(() => section('live (not frozen): no frozen tag', () => {
    check('the live server answered', !!r && r.ok, r?.status);
    check('no X-Vale-Frozen header', hdr === null, hdr);
  }));
}
for (const f of results) f();
finish('probe_dev_frozen_guard');
