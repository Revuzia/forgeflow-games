// Machine-wide heavy-process slots for harness browsers (same protocol as art/blender/common/heavy.py:
// a slot is the directory $VALE_HEAVY_DIR/slot<i> made with mkdir, its `owner` file "<pid> <time> <label>";
// a slot whose owner process is gone is reclaimed). One slot per Node process however many browsers it
// opens, so a harness that drives two browsers can never deadlock against another one.
//
//   import { holdHeavy } from './heavy_slot.mjs';
//   const release = await holdHeavy('shot_map rift');   // blocks until a slot is free
//   ...; release();                                     // also released at process exit

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.VALE_HEAVY_DIR || '/tmp/vale_heavy';
const SLOTS = Math.max(1, Number(process.env.VALE_HEAVY_SLOTS || 3) || 3);
const MIN_FREE = Number(process.env.VALE_HEAVY_MIN_FREE || 12) || 12;
const MEM_WAIT_MAX_S = 180;

let held = null;   // { path, refs }

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const owner = (path) => {
  try { const [pid, ts, ...l] = readFileSync(join(path, 'owner'), 'utf8').split(' '); return { pid: Number(pid), ts: Number(ts), label: l.join(' ') }; }
  catch { return null; }
};
const stale = (path) => {
  const o = owner(path);
  if (!o) { try { return Date.now() / 1000 - statSync(path).mtimeMs / 1000 > 30; } catch { return false; } }
  return !alive(o.pid);
};
const freeLevel = () => { try { return Number(execFileSync('sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' }).trim()) || 100; } catch { return 100; } };
const holders = () => Array.from({ length: SLOTS }, (_, i) => { const o = owner(join(DIR, `slot${i}`)); return o ? `slot${i}: pid ${o.pid} ${o.label}` : null; }).filter(Boolean).join('; ');

/** wait for a slot; returns a release function (idempotent). Nested calls in one process share the slot */
export async function holdHeavy(label = 'harness') {
  const release = () => {
    if (!held || --held.refs > 0) return;
    const o = owner(held.path);
    if (o && o.pid === process.pid) rmSync(held.path, { recursive: true, force: true });
    held = null;
  };
  let done = false;
  const once = () => { if (!done) { done = true; release(); } };
  if (process.env.VALE_HEAVY_HELD === '1') return () => {};
  if (held) { held.refs++; return once; }
  mkdirSync(DIR, { recursive: true });
  const t0 = Date.now(); let said = 0, memWait = 0;
  for (;;) {
    const low = freeLevel() < MIN_FREE && memWait < MEM_WAIT_MAX_S;
    if (!low) {
      for (let i = 0; i < SLOTS; i++) {
        const path = join(DIR, `slot${i}`);
        try { if (statSync(path).isDirectory() && stale(path)) rmSync(path, { recursive: true, force: true }); } catch { /* absent */ }
        try { mkdirSync(path); } catch { continue; }
        writeFileSync(join(path, 'owner'), `${process.pid} ${Math.round(Date.now() / 1000)} node:${label}`);
        held = { path, refs: 1 };
        if (Date.now() - t0 > 5000) console.error(`[heavy] ${label}: got slot${i} after ${Math.round((Date.now() - t0) / 1000)}s`);
        return once;
      }
    }
    if (Date.now() - said > 60000) { console.error(`[heavy] ${label}: waiting (${low ? `memory free < ${MIN_FREE}%` : `all ${SLOTS} slots busy`}) — ${holders()}`); said = Date.now(); }
    await new Promise((r) => setTimeout(r, 3000));
    if (low) memWait += 3;
  }
}

process.on('exit', () => { if (held) { const o = owner(held.path); if (o && o.pid === process.pid) rmSync(held.path, { recursive: true, force: true }); } });
