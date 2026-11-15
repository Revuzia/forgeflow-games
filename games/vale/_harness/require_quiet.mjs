// VALE harness — orch1 TECH-03: the quiet-machine precondition, mechanical. Shared by perf_1080 and probe_match_memory
// (--require-quiet) and usable alone:  node _harness/require_quiet.mjs [--wait-min N] [--poll-s 10]   (exit 0 quiet, 2 refused)
//
// QUIET means all three hold at once:
//   - 1-minute load average < 2.5
//   - no Google Chrome GPU helper OUTSIDE the harness (the owner's own Chrome, a reviewer's tab) burns more than 5 % CPU
//     (read with `top`, second sample: ps's %cpu is a lifetime average on macOS)
//   - no heavy slot is held by anyone but this process, its ancestors (the heavy.py wrapper) or its descendants
// It only WAITS and READS. It never signals, closes or kills any process. A harness Chrome is one with a playwright /
// --remote-debugging-pipe / --enable-automation ancestor in its command line.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const QUIET = { loadBelow: 2.5, outsideChromeGpuCpuMax: 5 };

const sh = (cmd, args, timeout = 20000) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 16 << 20 }); } catch { return ''; } };

/** pid -> { ppid, cmd } for every process */
function procTable() {
  const t = new Map();
  for (const l of sh('ps', ['-ww', '-Ao', 'pid=,ppid=,command=']).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return t;
}
const ancestors = (t, pid) => { const a = []; for (let p = pid, n = 0; p > 1 && n < 40; n++) { a.push(p); p = t.get(p)?.ppid ?? 0; } return a; };
const HARNESS_CMD = /playwright|--remote-debugging-pipe|--enable-automation|--headless/i;
const isGpuHelper = (cmd) => /Google Chrome Helper \(GPU\)|--type=gpu-process/.test(cmd);

/** %CPU per pid from the SECOND `top` sample (a 1 s interval; the first sample is a since-boot average) */
function cpuByPid() {
  const out = sh('top', ['-l', '2', '-s', '1', '-n', '40', '-o', 'cpu', '-stats', 'pid,cpu'], 30000);
  const blocks = out.split(/\n(?=Processes:)/);
  const last = blocks[blocks.length - 1] ?? '';
  const m = new Map();
  for (const l of last.split('\n')) { const r = /^\s*(\d+)\s+([\d.]+)\s*$/.exec(l); if (r) m.set(Number(r[1]), Number(r[2])); }
  return m;
}

/** heavy-slot holders other than this process, its ancestors and descendants */
function heavyOthers(t) {
  const dir = process.env.VALE_HEAVY_DIR || '/tmp/vale_heavy';
  const slots = Math.max(1, Number(process.env.VALE_HEAVY_SLOTS || 3) || 3);
  const mine = new Set(ancestors(t, process.pid));
  const out = [];
  for (let i = 0; i < slots; i++) {
    let o; try { o = readFileSync(join(dir, `slot${i}`, 'owner'), 'utf8').trim(); } catch { continue; }
    const pid = Number(o.split(' ')[0]);
    if (!pid) continue;
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') continue; }      // owner gone: a stale slot holds no load
    if (mine.has(pid) || ancestors(t, pid).includes(process.pid)) continue;
    out.push(`slot${i}: ${o.split(' ').slice(2).join(' ').slice(0, 90)}`);
  }
  return out;
}

/** heavy-slot holders other than this run's own chain (the heavy.py wrapper is an ancestor); shared with perf_1080 and probe_match_memory */
export const otherHeavySlots = () => heavyOthers(procTable());

/** one reading. quiet = all three conditions hold. Always carries load1 for the report. */
export function quietState() {
  const t = procTable();
  const load1 = +loadavg()[0].toFixed(2);
  const cpu = cpuByPid();
  const mine = new Set(ancestors(t, process.pid));
  const outside = [];
  for (const [pid, p] of t) {
    if (!isGpuHelper(p.cmd)) continue;
    const anc = ancestors(t, pid);
    if (anc.some((a) => a !== pid && HARNESS_CMD.test(t.get(a)?.cmd ?? ''))) continue;      // a harness browser (any lane's)
    if (anc.some((a) => mine.has(a) && a !== 1)) continue;                                   // started under this very run
    outside.push({ pid, cpu: cpu.get(pid) ?? 0 });
  }
  const outsideGpuCpu = +Math.max(0, ...outside.map((o) => o.cpu)).toFixed(1);
  const heavy = heavyOthers(t);
  const reasons = [];
  if (load1 >= QUIET.loadBelow) reasons.push(`load1 ${load1} >= ${QUIET.loadBelow}`);
  if (outsideGpuCpu > QUIET.outsideChromeGpuCpuMax) reasons.push(`outside Chrome GPU helper ${outsideGpuCpu} % CPU > ${QUIET.outsideChromeGpuCpuMax} %`);
  if (heavy.length) reasons.push(`heavy slot held: ${heavy.join('; ')}`);
  return { at: new Date().toISOString(), load1, outsideChromeGpu: outside, outsideChromeGpuCpu: outsideGpuCpu, heavyOthers: heavy, quiet: reasons.length === 0, reasons };
}

/** Wait (never kill) until quiet or maxMin minutes pass; maxMin 0 = one reading, refuse at once when busy.
 *  A start needs two quiet readings 10 s apart (a one-second dip is not a quiet window).
 *  Returns { ok, state, waitedS, readings } where state is the last reading. */
export async function waitQuiet({ maxMin = 0, pollS = 10, log = console.log } = {}) {
  const t0 = Date.now(), end = t0 + maxMin * 60000;
  let readings = 0, streak = 0, st;
  for (;;) {
    st = quietState(); readings++;
    streak = st.quiet ? streak + 1 : 0;
    if (streak >= (maxMin > 0 ? 2 : 1)) return { ok: true, state: st, waitedS: Math.round((Date.now() - t0) / 1000), readings };
    if (Date.now() >= end) return { ok: false, state: st, waitedS: Math.round((Date.now() - t0) / 1000), readings };
    if (readings === 1 || readings % 6 === 0) log(`[quiet] waiting: ${st.reasons.join(' | ') || 'confirming'}`);
    await new Promise((r) => setTimeout(r, pollS * 1000));
  }
}

/** flag helper for a script: --require-quiet [--quiet-wait-min N]. Returns null when the flag is absent, else the
 *  waitQuiet result (the caller exits 2 with the reasons when !ok). */
export async function requireQuietFromArgs(args, log = console.log) {
  if (!args.includes('--require-quiet')) return null;
  const i = args.indexOf('--quiet-wait-min');
  const r = await waitQuiet({ maxMin: i >= 0 ? Number(args[i + 1]) || 0 : 0, log });
  log(`[quiet] ${r.ok ? 'quiet' : 'REFUSED'}: load1 ${r.state.load1}, outside Chrome GPU ${r.state.outsideChromeGpuCpu} % CPU, ${r.state.heavyOthers.length} other heavy slot(s); waited ${r.waitedS} s${r.ok ? '' : `; ${r.state.reasons.join(' | ')}`}`);
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--wait-min'), j = a.indexOf('--poll-s');
  const r = await waitQuiet({ maxMin: i >= 0 ? Number(a[i + 1]) : 0, pollS: j >= 0 ? Number(a[j + 1]) : 10 });
  console.log(JSON.stringify({ ok: r.ok, waitedS: r.waitedS, ...r.state }, null, 1));
  process.exit(r.ok ? 0 : 2);
}
