// GENESIS — the sim Web Worker host (CONTRACT.md §14): one Sim, the ToWorker / FromWorker protocol of types.ts.
//
// Pacing: the sim runs in short slices, each owing `10 × speed` ticks per real second since the last slice (capped so a
// stall never turns into a burst of minutes) and stopping at a time budget so messages (commands, snapshot requests)
// are handled between slices. When the sim keeps up, the worker SLEEPS until the next tick is due (setTimeout, ≥ 4 ms:
// at high speeds one wake runs a batch of ticks) — it never spins a core for a sim that needs 1 % of it. Only when it
// is behind does it continue at once: through MessageChannel in a browser (prompt, unthrottled) and setImmediate in
// Node, where a MessagePort drains its whole queue before the parent's messages and a self-posting loop starved them
// for seconds. When the sim cannot keep up it simply runs slower: the debt is dropped, never skipped (the sim never
// skips work), and the measured multiplier is reported as achievedSpeed (ticks over a ~3 s window, timed at slice
// ends, so a steady 1x reads 1.00, not 0.91 / 1.10 from whole ticks counted in 1 s boxes).
//
// Snapshots: on request (the client asks after each rendered frame, ≤ 30 Hz). Fields are sent only when their version
// changed AND their throttle allows: fast fields (water, fire, lava, cloud, precip, snow, ...) at most every ~100 ms,
// slow fields every ~500 ms. Arrays are fresh copies posted as transferables. A `full` request sends everything.
// With the init option `grad: true` every snapshot that carries `surface` also carries the ground's curvature data
// (PlanetSnap.grad, the sim's own Planet.ground() gradients), so the main thread need not refit them.
//
// Time-lapse (SIM perf push 2, perf/lapse.ts): the speed preset decides the sim's time-lapse level (1x / 10x real time,
// 100x and 1000x coarser fixed cadences). The level is a LOGGED sim input: whenever the preset (or a god-layer
// `time.speed` act, or a load / rewind that restored another level) leaves the sim on a level that differs from the
// preset's, the worker issues `time.scale` at the current tick boundary — recorded in the command log, saved, replayed.
// Pausing keeps the level (stepping a paused 1000x world steps it in time-lapse).
//
// This is the one sim file allowed to touch timers and performance.now (_harness/detban.ts): it only paces the sim; it
// never feeds time into it.

import type { Command, FieldName, FromWorker, Snapshot, ToWorker } from './types.ts';
import { TICKS_PER_SECOND_1X } from './types.ts';
import { Sim } from './sim.ts';
import { FAST_FIELDS } from './world/planet.ts';
import { loadContent, type ContentPack } from './content.ts';
import { lapseLevel, levelOfScale } from './perf/lapse.ts';
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
let achieved = 0;
let msPerTick = 0;
/** the client asked for the ground's curvature data with every surface update (init option `grad: true`) */
let wantGrad = false;
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

/** never sleep less than this (ms): browsers clamp nested timers to 4 ms anyway, and at 100x a wake runs ~4 ticks */
const MIN_SLEEP_MS = 4;
/** while paused, look at the clock this often (ms) */
const IDLE_MS = 50;

// one pending wake at a time: `gen` invalidates a superseded one (a speed change re-paces at once)
let gen = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let channel: MessageChannel | null = null;
type Immediate = (cb: () => void) => unknown;
const immediate: Immediate | null = typeof (globalThis as { setImmediate?: Immediate }).setImmediate === 'function'
  ? (globalThis as unknown as { setImmediate: Immediate }).setImmediate : null;

function cancelWake(): void {
  gen++;
  if (timer !== null) { clearTimeout(timer); timer = null; }
}

/** run pace() again after `ms` (0 = as soon as pending messages are handled) */
function wake(ms: number): void {
  cancelWake();
  const g = gen;
  if (ms > 0) {
    timer = setTimeout(() => { timer = null; if (g === gen) pace(); }, ms);
  } else if (immediate) {
    immediate(() => { if (g === gen) pace(); });
  } else if (typeof MessageChannel !== 'undefined') {
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = (ev: MessageEvent) => { if (ev.data === gen) pace(); };
    }
    channel.port2.postMessage(g);
  } else {
    timer = setTimeout(() => { timer = null; if (g === gen) pace(); }, 0);
  }
}

function pace(): void {
  if (!sim) return;
  const t = now();
  const dt = Math.min(MAX_DEBT_S, Math.max(0, (t - lastPace) / 1000));
  lastPace = t;
  if (speed <= 0) {
    debt = 0;
    resetMeasure(t);
    wake(IDLE_MS);
    return;
  }
  const rate = TICKS_PER_SECOND_1X * speed;
  debt = Math.min(debt + dt * rate, rate * MAX_DEBT_S + 1);
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
  const t1 = now();
  if (done > 0) msPerTick = msPerTick * 0.9 + ((t1 - t0) / done) * 0.1;
  // if we could not pay the debt within the slice, we are running slow: drop the excess (never skip sim work)
  if (debt > rate * 0.1) debt = Math.min(debt, rate * 0.1);
  measure(t1, done);
  if (debt >= 1) wake(0); // behind: continue as soon as messages are handled
  else wake(Math.max(MIN_SLEEP_MS, ((1 - debt) / rate) * 1000)); // keeping up: sleep until the next tick is due
}

// achieved speed: (time, cumulative ticks) at slice ends, ~3 s of them; the rate is measured between the window's
// first and last slice ends, so whole-tick quantisation does not show (10 ticks over exactly 1.0 s reads 1.00)
const WIN_MS = 3000;
const MS_N = 256;
const msT = new Float64Array(MS_N);
const msK = new Float64Array(MS_N);
let msHead = 0, msLen = 0, cumTicks = 0;

/** restart the window (speed change, pause); the last reading stands until the new window is long enough */
function resetMeasure(t: number): void {
  msHead = 0; cumTicks = 0;
  msT[0] = t; msK[0] = 0; msLen = 1;
}

function measure(t: number, ticks: number): void {
  cumTicks += ticks;
  // samples are kept ≥ ~12 ms apart (a fast worker ends a slice every few ms): a newer slice end replaces the newest
  // sample instead, so the ring always ends at the latest slice and still spans the whole window
  const last = (msHead + msLen - 1) % MS_N;
  if (msLen >= 2 && t - msT[(msHead + msLen - 2) % MS_N] < 12) {
    msT[last] = t; msK[last] = cumTicks;
  } else {
    const at = (msHead + msLen) % MS_N;
    msT[at] = t; msK[at] = cumTicks;
    if (msLen < MS_N) msLen++; else msHead = (msHead + 1) % MS_N;
  }
  while (msLen > 2 && t - msT[(msHead + 1) % MS_N] >= WIN_MS) { msHead = (msHead + 1) % MS_N; msLen--; }
  const span = t - msT[msHead];
  if (span < 250) return; // too short to say (just started / speed changed)
  achieved = (cumTicks - msK[msHead]) / (span / 1000) / TICKS_PER_SECOND_1X;
  // within one tick of the requested pace over the window is the requested pace (wake-up jitter moves a tick across
  // the window edge: ±3 % at 1x); anything further off is real and shown as it is
  const oneTick = 1.05 / ((span / 1000) * TICKS_PER_SECOND_1X);
  if (Math.abs(achieved - speed) <= oneTick) achieved = speed;
}

// ───────────────────────────── time-lapse level ─────────────────────────────

/** put the sim on the time-lapse level of the current speed preset (a logged `time.scale` command when it differs) */
function syncLapse(): void {
  if (!sim || speed <= 0) return; // paused: the level stays (a step at 1000x is a time-lapse step)
  if (lapseLevel(sim.u) === levelOfScale(speed)) return;
  const r = sim.applyNow({ k: 'time.scale', scale: speed });
  if (!r.ok) post({ type: 'error', msg: `time.scale: ${r.msg ?? 'refused'}` });
}

/** a new speed preset: re-pace at once and match the time-lapse level */
function setSpeed(x: number): void {
  speed = Math.max(0, Number(x) || 0);
  debt = 0;
  lastPace = now();
  resetMeasure(lastPace);
  syncLapse();
  wake(0);
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
  const snap: Snapshot = sim.snapshot({ full, include, grad: wantGrad });
  const transfer: Transferable[] = [];
  for (const ps of snap.planets) {
    if (ps.grad) transfer.push(ps.grad.buffer);
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
      wantGrad = opts.grad === true;
      resetSent();
      lastPace = now();
      resetMeasure(lastPace);
      syncLapse();
      post({ type: 'ready', content: sim.content.packs });
      wake(0);
      return;
    }
    case 'snapshot':
      snapshot(!!m.full);
      return;
    case 'speed':
      setSpeed(m.speed);
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
      // a time act the host honours (CommandResult.control): the pace of `time.speed`; after a rewind / edit of the past
      // the restored world may stand on another time-lapse level than the preset
      const ctl = result.control;
      if (ctl && typeof ctl.speed === 'number') setSpeed(ctl.speed);
      else if (ctl && (ctl.rewind !== undefined || ctl.edit !== undefined)) { resetSent(); syncLapse(); }
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
        syncLapse();
        post({ type: 'loaded', id: m.id, ok: true });
      } catch (e) {
        post({ type: 'loaded', id: m.id, ok: false, msg: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    case 'rewind': {
      const ok = sim.rewind(m.tick);
      if (ok) { resetSent(); syncLapse(); }
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
