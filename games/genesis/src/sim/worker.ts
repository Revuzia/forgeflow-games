// GENESIS — the sim Web Worker host (CONTRACT.md §14): one Sim, the ToWorker / FromWorker protocol of types.ts.
//
// Pacing: a self-rescheduling loop (MessageChannel when available, else setTimeout 0) runs the sim in short slices. Each
// slice owes `10 × speed` ticks per real second since the last slice (capped so a stall never turns into a burst of
// minutes) and stops at a time budget so messages (commands, snapshot requests) are handled between slices. When the
// sim cannot keep up it simply runs slower: the debt is dropped, never skipped (the sim never skips work), and the
// measured multiplier is reported as achievedSpeed.
//
// Snapshots: on request (the client asks after each rendered frame, ≤ 30 Hz). Fields are sent only when their version
// changed AND their throttle allows: fast fields (water, fire, lava, cloud, precip, snow, ...) at most every ~100 ms,
// slow fields every ~500 ms. Arrays are fresh copies posted as transferables. A `full` request sends everything.
//
// This is the one sim file allowed to touch timers and performance.now (_harness/detban.ts): it only paces the sim; it
// never feeds time into it.

import type { Command, FieldName, FromWorker, Snapshot, ToWorker } from './types.ts';
import { TICKS_PER_SECOND_1X } from './types.ts';
import { Sim } from './sim.ts';
import { FAST_FIELDS } from './world/planet.ts';
import { loadContent, type ContentPack } from './content.ts';
import { BASE_PACK } from '../data/index.ts';

const FAST_MS = 100;
const SLOW_MS = 500;
/** time budget per pacing slice (ms) — leaves the worker responsive to messages */
const SLICE_MS = 12;
/** never owe more than this much real time (s): after a stall we resume, we do not try to catch up minutes */
const MAX_DEBT_S = 0.5;

interface WorkerScope {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

let sim: Sim | null = null;
let speed = 1;
let mods: ContentPack[] = [];
let lastPace = 0;
let debt = 0;
let running = false;
// achieved speed: ticks over a sliding window of real time
let winStart = 0;
let winTicks = 0;
let achieved = 0;
let msPerTick = 0;
// per (planet, field): last version sent and when
const sentVer = new Map<string, number>();
const sentAt = new Map<string, number>();

function now(): number {
  return performance.now();
}

function post(m: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(m, transfer);
}

function fail(e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  post({ type: 'error', msg: err.message, stack: err.stack });
}

// ───────────────────────────── pacing ─────────────────────────────

let channel: MessageChannel | null = null;
function schedule(): void {
  if (running) return;
  running = true;
  if (typeof MessageChannel !== 'undefined') {
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => { running = false; pace(); };
    }
    channel.port2.postMessage(0);
  } else {
    setTimeout(() => { running = false; pace(); }, 0);
  }
}

function pace(): void {
  if (!sim) return;
  const t = now();
  const dt = Math.min(MAX_DEBT_S, Math.max(0, (t - lastPace) / 1000));
  lastPace = t;
  if (speed <= 0) {
    debt = 0;
    measure(t, 0);
    idleLater();
    return;
  }
  debt = Math.min(debt + dt * TICKS_PER_SECOND_1X * speed, TICKS_PER_SECOND_1X * speed * MAX_DEBT_S + 1);
  let done = 0;
  const t0 = now();
  try {
    while (debt >= 1) {
      sim.step(1);
      debt -= 1;
      done++;
      if ((done & 3) === 0 && now() - t0 > SLICE_MS) break;
    }
  } catch (e) {
    fail(e);
    speed = 0;
    return;
  }
  const spent = now() - t0;
  if (done > 0) msPerTick = msPerTick * 0.9 + (spent / done) * 0.1;
  // if we could not pay the debt within the slice, we are running slow: drop the excess (never skip sim work)
  if (debt > TICKS_PER_SECOND_1X * speed * 0.1) debt = Math.min(debt, TICKS_PER_SECOND_1X * speed * 0.1);
  measure(t, done);
  if (debt >= 1 || speed * TICKS_PER_SECOND_1X >= 60) schedule();
  else idleLater();
}

/** low speeds: sleep until the next tick is due (keeps an idle 1x world from spinning a core) */
function idleLater(): void {
  if (running) return;
  running = true;
  const wait = speed > 0 ? Math.max(1, ((1 - debt) / (TICKS_PER_SECOND_1X * speed)) * 1000) : 50;
  setTimeout(() => { running = false; pace(); }, Math.min(100, wait));
}

function measure(t: number, ticks: number): void {
  winTicks += ticks;
  const span = t - winStart;
  if (span >= 1000) {
    achieved = (winTicks / (span / 1000)) / TICKS_PER_SECOND_1X;
    winTicks = 0;
    winStart = t;
  }
}

// ───────────────────────────── snapshots ─────────────────────────────

function snapshot(full: boolean): void {
  if (!sim) return;
  const t = now();
  const include = (planet: number, field: FieldName): boolean => {
    const key = `${planet}:${field}`;
    if (full) return true;
    const ver = sim!.u.planet(planet)?.fieldVer[field] ?? 0;
    if (ver <= (sentVer.get(key) ?? -1)) return false;
    const interval = FAST_FIELDS.has(field) ? FAST_MS : SLOW_MS;
    return t - (sentAt.get(key) ?? -1e9) >= interval;
  };
  sim.speed = speed;
  sim.achievedSpeed = speed > 0 ? achieved : 0;
  sim.msPerTick = msPerTick;
  const snap: Snapshot = sim.snapshot({ full, include });
  const transfer: Transferable[] = [];
  for (const ps of snap.planets) {
    if (!ps.fields) continue;
    for (const [k, arr] of Object.entries(ps.fields) as [FieldName, Float32Array][]) {
      const key = `${ps.id}:${k}`;
      sentVer.set(key, sim.u.planet(ps.id)?.fieldVer[k] ?? 0);
      sentAt.set(key, t);
      transfer.push(arr.buffer);
    }
  }
  post({ type: 'snapshot', snap }, transfer);
}

function resetSent(): void {
  sentVer.clear();
  sentAt.clear();
}

// ───────────────────────────── messages ─────────────────────────────

function handle(m: ToWorker): void {
  switch (m.type) {
    case 'init': {
      const opts = m.options ?? {};
      const packs = Array.isArray(opts.mods) ? (opts.mods as ContentPack[]) : [];
      mods = packs;
      sim = new Sim({ seed: m.seed >>> 0, scenario: m.scenario, content: mods, overrides: (opts.overrides as Record<string, unknown>) ?? undefined });
      if (typeof opts.speed === 'number') speed = Math.max(0, opts.speed);
      resetSent();
      lastPace = now();
      winStart = lastPace;
      post({ type: 'ready', content: sim.content.packs });
      schedule();
      return;
    }
    case 'snapshot':
      snapshot(!!m.full);
      return;
    case 'speed':
      speed = Math.max(0, Number(m.speed) || 0);
      debt = 0;
      lastPace = now();
      schedule();
      return;
  }
  if (!sim) {
    if ('id' in m) post({ type: 'result', id: m.id, result: { ok: false, msg: 'The sim has not started yet.' } });
    return;
  }
  switch (m.type) {
    case 'cmd': {
      const result = sim.applyNow(m.cmd as Command);
      post({ type: 'result', id: m.id, result });
      return;
    }
    case 'parse':
      post({ type: 'parsed', id: m.id, result: sim.parse(m.text) });
      return;
    case 'step': {
      const n = Math.max(0, Math.min(1e6, Math.floor(m.ticks)));
      sim.step(n);
      post({ type: 'stepped', id: m.id, tick: sim.tick });
      return;
    }
    case 'save': {
      const bytes = sim.save();
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'saved', id: m.id, data: buf }, [buf]);
      return;
    }
    case 'load': {
      try {
        sim = Sim.load(new Uint8Array(m.data), mods);
        resetSent();
        post({ type: 'loaded', id: m.id, ok: true });
      } catch (e) {
        post({ type: 'loaded', id: m.id, ok: false, msg: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    case 'rewind': {
      const ok = sim.rewind(m.tick);
      if (ok) resetSent();
      post({ type: 'result', id: m.id, result: { ok, msg: ok ? `Time runs back to tick ${sim.tick}.` : 'That moment is too far back to return to.', tick: sim.tick } });
      return;
    }
    case 'query':
      post({ type: 'answer', id: m.id, data: sim.query(m.q, m.args ?? {}) });
      return;
    case 'mod': {
      // a mod pack: validate now; it takes effect for the next world (content indices must stay stable mid-game)
      try {
        const pack = m.pack as ContentPack;
        const test = [...mods.filter((x) => x.id !== pack.id), pack];
        loadContent([BASE_PACK, ...test]); // throws a readable ContentError listing every problem
        mods = test;
        post({ type: 'result', id: m.id, result: { ok: true, msg: `Mod '${pack.id}' loaded; it shapes the next world you create.` } });
      } catch (e) {
        post({ type: 'result', id: m.id, result: { ok: false, msg: e instanceof Error ? e.message : String(e) } });
      }
      return;
    }
  }
}

scope.onmessage = (ev: MessageEvent) => {
  try {
    handle(ev.data as ToWorker);
  } catch (e) {
    fail(e);
  }
};
