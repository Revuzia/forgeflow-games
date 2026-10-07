// VALE — probe runner (CONTRACT §13: `npm run probe`). Lane TOOLS.
//
//   node _harness/run_probes.ts                    run every _harness/probe_*.ts, sorted by name
//   node _harness/run_probes.ts --only content     only probes whose file name contains "content"
//   flags: --only <substring> (repeatable; any match) · --verbose (stream probe output live)
//          --timeout <seconds> (per probe, default 900) · --list (print what would run)
//
// PROBE PROTOCOL: a probe is a standalone `node <file>.ts` script (Node 22 type stripping). Exit 0 =
// PASS, exit 77 = SKIP (it could not run meaningfully, e.g. its content does not exist yet; it must
// print why), anything else = FAIL. Probes run SEQUENTIALLY, each in its own process, with the
// project root as cwd, so one probe's globals, timers or crashes cannot leak into the next.
// The runner prints a PASS/SKIP/FAIL table (with the tail of each failing probe's output), writes
// _harness/_reports/probes.json, and exits 1 if any probe failed (2 if nothing matched --only).

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HARNESS, '..');
const SKIP_CODE = 77;

interface Result { probe: string; status: 'PASS' | 'SKIP' | 'FAIL'; code: number | null; signal: string | null; ms: number; tail: string[] }

function parse(argv: string[]): { only: string[]; verbose: boolean; timeout: number; list: boolean } | string {
  const o = { only: [] as string[], verbose: false, timeout: 900, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only' && argv[i + 1]) o.only.push(argv[++i]);
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--list') o.list = true;
    else if (a === '--timeout' && Number(argv[i + 1]) > 0) o.timeout = Number(argv[++i]);
    else if (a === '-h' || a === '--help') return 'usage: node _harness/run_probes.ts [--only <substring>]… [--verbose] [--timeout <s>] [--list]';
    else return `unknown or incomplete argument "${a}"`;
  }
  return o;
}

function runOne(file: string, verbose: boolean, timeoutS: number): Promise<Result> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VALE_PROBE: '1' } });
    const lines: string[] = [];
    const take = (buf: Buffer, stream: NodeJS.WriteStream): void => {
      if (verbose) stream.write(buf);
      for (const l of buf.toString('utf8').split('\n')) if (l.trim()) lines.push(l);
      if (lines.length > 400) lines.splice(0, lines.length - 400);
    };
    child.stdout.on('data', (b: Buffer) => take(b, process.stdout));
    child.stderr.on('data', (b: Buffer) => take(b, process.stderr));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutS * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) lines.push(`(killed after ${timeoutS}s timeout)`);
      const status = code === 0 ? 'PASS' : code === SKIP_CODE ? 'SKIP' : 'FAIL';
      done({ probe: file.slice(HARNESS.length + 1), status, code, signal, ms: Date.now() - started, tail: lines.slice(-40) });
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const o = parse(argv);
  if (typeof o === 'string') { console.error(o); return o.startsWith('usage') ? 0 : 2; }
  const probes = readdirSync(HARNESS)
    .filter((f) => /^probe_.*\.ts$/.test(f))
    .filter((f) => o.only.length === 0 || o.only.some((s) => f.includes(s)))
    .sort();
  if (probes.length === 0) { console.error(`no probes match${o.only.length ? ` --only ${o.only.join(', ')}` : ''}`); return 2; }
  if (o.list) { for (const p of probes) console.log(p); return 0; }

  const results: Result[] = [];
  for (const p of probes) {
    const live = !o.verbose && process.stdout.isTTY;   // transient "running" line only on a terminal
    if (live) process.stdout.write(`…     ${p}`);
    else if (o.verbose) console.log(`\n──── ${p}`);
    const r = await runOne(join(HARNESS, p), o.verbose, o.timeout);
    results.push(r);
    if (live) process.stdout.write('\x1b[2K\r');
    console.log(`${r.status === 'PASS' ? 'PASS' : r.status === 'SKIP' ? 'SKIP' : 'FAIL'}  ${p.padEnd(44)} ${(r.ms / 1000).toFixed(1).padStart(6)}s`);
    if (r.status === 'SKIP' && r.tail.length) console.log(`      ${r.tail[r.tail.length - 1]}`);
    if (r.status === 'FAIL' && !o.verbose) for (const l of r.tail) console.log(`      │ ${l}`);
  }
  const n = (s: Result['status']): number => results.filter((r) => r.status === s).length;
  console.log(`\n${n('PASS')} passed, ${n('SKIP')} skipped, ${n('FAIL')} failed (${results.length} probes, ${(results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)}s)`);
  try {
    const dir = join(HARNESS, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'probes.json'), JSON.stringify({ at: new Date().toISOString(), only: o.only, results }, null, 2) + '\n');
  } catch { /* the report is a convenience; never fail the run over it */ }
  return n('FAIL') ? 1 : 0;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
