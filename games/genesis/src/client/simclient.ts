// GENESIS — SimClient: the main thread's only door into the simulation (CONTRACT.md §14).
//
// Two interchangeable backends behind one interface:
//   * WorkerBackend — the real sim in a module Web Worker (src/sim/worker.ts), ToWorker / FromWorker messages.
//   * LookdevBackend — a local generator of plausible planet data (src/client/lookdev.ts) for render development.
// `?source=lookdev` forces lookdev; `?source=auto` tries the worker and, if it is missing, throws, or does not say
// 'ready' in time, falls back to lookdev so the app always runs. The living sim itself (`source=worker`, the game) has
// NO fixed deadline (the parity audit: 'Two worlds' took 24 s to build on a loaded machine and the old 20 s timer
// failed it): the boot reports stages — waking the simulation (the worker's module answers a first message once it has
// loaded), building the world (its scenario's own steps, paced by how long this machine took last time, or by the
// worker's own `progress` messages where it sends them) — and says when a build runs long without ever giving up on it;
// only a worker that fails (an error, a crash) ends the boot, with the reason.
//
// The client asks for a snapshot after each rendered frame (at most 30 Hz, one request in flight), mirrors it into a
// WorldView and lets the WorldView interpolate between snapshots.

import type { Command, CommandResult, FromWorker, Snapshot, ToWorker } from '../sim/types.ts';
import { WorldView } from './worldview.ts';

export type SnapshotSink = (snap: Snapshot) => void;

export interface SimBackend {
  readonly kind: 'worker' | 'lookdev';
  /** resolves with the loaded content pack names once the sim is ready */
  init(scenario: string, seed: number, options: Record<string, unknown>, sink: SnapshotSink): Promise<string[]>;
  requestSnapshot(full?: boolean): void;
  setSpeed(x: number): void;
  step(ticks: number): Promise<number>;
  cmd(c: Command): Promise<CommandResult>;
  parse(text: string): Promise<CommandResult>;
  query(q: string, args?: Record<string, unknown>): Promise<unknown>;
  dispose(): void;
}

// ───────────────────────────── worker backend ─────────────────────────────

class WorkerBackend implements SimBackend {
  readonly kind = 'worker' as const;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { ok: (v: unknown) => void; fail: (e: unknown) => void }>();
  private sink: SnapshotSink | null = null;
  private readyResolve: ((c: string[]) => void) | null = null;
  private readyReject: ((e: unknown) => void) | null = null;
  onFatal: ((msg: string) => void) | null = null;
  /** the world being built says how far it is (a worker that sends `{ type: 'progress', stage, frac }`) */
  onProgress: ((stage: string, frac: number) => void) | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      const msg = ev.message || 'the sim worker failed to load';
      // (a worker that fails before it is ready — its module did not load, its world could not be built — ends the
      // boot with the reason: every call waiting on it fails too, so nothing waits forever)
      const failed = this.failPending(msg);
      if (this.readyReject) { this.readyReject(new Error(msg)); this.readyReject = null; this.readyResolve = null; }
      else if (!failed) this.onFatal?.(msg);
    };
    worker.onmessageerror = () => this.onFatal?.('a sim message could not be decoded');
  }

  /** every call still waiting fails with the reason; true when there was one (the boot's first message) */
  private failPending(msg: string): boolean {
    if (!this.pending.size || this.onFatal) return false;
    for (const p of this.pending.values()) p.fail(new Error(msg));
    this.pending.clear();
    return true;
  }

  private post(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  private call<T>(make: (id: number) => ToWorker, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail });
      this.post(make(id), transfer);
    });
  }

  private onMessage(m: FromWorker): void {
    // (additive, forward compatible: a worker that reports the stages of building its world)
    const pm = m as unknown as { type: string; stage?: unknown; frac?: unknown };
    if (pm.type === 'progress') { this.onProgress?.(String(pm.stage ?? ''), Number(pm.frac ?? 0)); return; }
    switch (m.type) {
      case 'ready':
        this.readyResolve?.(m.content);
        this.readyResolve = null; this.readyReject = null;
        return;
      case 'snapshot':
        this.sink?.(m.snap);
        return;
      case 'error':
        if (this.readyReject) { this.readyReject(new Error(m.msg)); this.readyReject = null; this.readyResolve = null; return; }
        if (this.failPending(m.msg)) return;
        console.error('[genesis] sim error:', m.msg, m.stack ?? '');
        this.onFatal?.(m.stack || m.msg);
        return;
      default: {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.type === 'result' || m.type === 'parsed') p.ok(m.result);
        else if (m.type === 'stepped') p.ok(m.tick);
        else if (m.type === 'saved') p.ok(m.data);
        else if (m.type === 'loaded') p.ok({ ok: m.ok, msg: m.msg });
        else if (m.type === 'answer') p.ok(m.data);
      }
    }
  }

  init(scenario: string, seed: number, options: Record<string, unknown>, sink: SnapshotSink): Promise<string[]> {
    this.sink = sink;
    return new Promise<string[]>((ok, fail) => {
      this.readyResolve = ok;
      this.readyReject = fail;
      this.post({ type: 'init', scenario, seed, options });
    });
  }

  /** resolves once the worker's module has loaded and answers (a query before 'init' is answered at once) */
  wake(): Promise<unknown> { return this.call<unknown>((id) => ({ type: 'query', id, q: 'ping' })); }

  requestSnapshot(full = false): void { this.post({ type: 'snapshot', full }); }
  setSpeed(x: number): void { this.post({ type: 'speed', speed: x }); }
  step(ticks: number): Promise<number> { return this.call<number>((id) => ({ type: 'step', id, ticks })); }
  cmd(c: Command): Promise<CommandResult> { return this.call<CommandResult>((id) => ({ type: 'cmd', id, cmd: c })); }
  parse(text: string): Promise<CommandResult> { return this.call<CommandResult>((id) => ({ type: 'parse', id, text })); }
  query(q: string, args?: Record<string, unknown>): Promise<unknown> { return this.call<unknown>((id) => ({ type: 'query', id, q, args })); }
  save(): Promise<ArrayBuffer> { return this.call<ArrayBuffer>((id) => ({ type: 'save', id })); }
  // additive (UI lane, saves panel): restore a saved world in this worker; the ArrayBuffer is transferred
  load(data: ArrayBuffer): Promise<{ ok: boolean; msg?: string }> { return this.call<{ ok: boolean; msg?: string }>((id) => ({ type: 'load', id, data }), [data]); }
  // additive (UI lane, mods panel): a content pack for the running world (validated there; refused in words)
  mod(pack: unknown): Promise<CommandResult> { return this.call<CommandResult>((id) => ({ type: 'mod', id, pack })); }
  dispose(): void {
    for (const p of this.pending.values()) p.fail(new Error('sim worker terminated'));
    this.pending.clear();
    this.worker.terminate();
  }
}

// ───────────────────────────── client ─────────────────────────────

export interface SimClientOptions {
  source: 'auto' | 'worker' | 'lookdev';
  scenario: string;
  seed: number;
  options?: Record<string, unknown>;
  /** ms to wait for the worker's 'ready' before falling back to lookdev (`auto` only: the living sim has no deadline) */
  readyTimeoutMs?: number;
  /** the boot's stages as they pass: what is happening (words) and how far the boot is (0..1) */
  onStage?(label: string, frac: number): void;
  /** the world is taking long to build (called once, then every ~30 s while it still builds): elapsed ms */
  onSlow?(elapsedMs: number): void;
}

/** how long building each scenario took on this machine last time (ms): the build's progress is paced by it */
const BUILD_KEY = 'genesis.buildms.v1';
const BUILD_GUESS: Record<string, number> = { barren: 7000, sandbox: 9000, lookdev: 9000, twoworlds: 24000, 'twoworlds-late': 26000, system: 32000 };
function buildTimes(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BUILD_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function rememberBuild(scenario: string, ms: number): void {
  try { const t = buildTimes(); t[scenario] = Math.round(ms); localStorage.setItem(BUILD_KEY, JSON.stringify(t)); } catch { /* next time guesses again */ }
}

/** what building a world goes through, in order (the sim's own steps: world/scenarios.ts, its climate and life) */
export const BUILD_STAGES = ['Shaping the rock', 'Gathering the seas', 'Warming the air', 'Sowing the land', 'Setting down the peoples', 'Turning the world'];

/** the stage and the bar for a build `t` ms in when it took `expect` ms last time (never quite full before 'ready') */
export function buildProgress(t: number, expect: number): { label: string; frac: number } {
  const k = 1 - Math.exp(-t / Math.max(1500, expect) * 1.25);
  const i = Math.min(BUILD_STAGES.length - 1, Math.floor(k * BUILD_STAGES.length));
  return { label: `${BUILD_STAGES[i]}…`, frac: Math.min(0.97, k) };
}

export class SimClient {
  readonly view = new WorldView();
  backend: SimBackend | null = null;
  source: 'worker' | 'lookdev' = 'lookdev';
  /** set when the backend fails after start: the app shows its fatal card */
  onFatal: ((msg: string) => void) | null = null;
  private inFlight = false;
  private lastRequest = -1e9;
  private requestedAt = 0;
  private snapsThisSecond = 0;
  snapshotHz = 0;
  private hzWindowStart = 0;
  private wantFull = false;

  async start(o: SimClientOptions): Promise<void> {
    const sink: SnapshotSink = (s) => this.receive(s);
    const stage = (label: string, frac: number) => o.onStage?.(label, Math.max(0, Math.min(1, frac)));
    if (o.source !== 'lookdev') {
      try {
        stage('Waking the simulation…', 0.04);
        const { spawnSimWorker } = await import('./workerspawn.ts');
        const wb = new WorkerBackend(spawnSimWorker());
        // the living sim waits as long as the world takes to build; only `auto` gives up and falls back to lookdev
        const deadline = o.source === 'auto' ? (o.readyTimeoutMs ?? 20000) : 0;
        const run = async (): Promise<void> => {
          // the worker's module is loaded (and parsed) once it answers
          await wb.wake();
          stage('Building the world…', 0.0);
          const expect = buildTimes()[o.scenario] ?? BUILD_GUESS[o.scenario] ?? 20000;
          const t0 = performance.now();
          let real = false;
          wb.onProgress = (st, f) => { real = true; stage(st ? `${st}…` : 'Building the world…', f); };
          let slowAt = Math.max(45000, expect * 3);
          const timer = setInterval(() => {
            const t = performance.now() - t0;
            if (!real) { const p = buildProgress(t, expect); stage(p.label, p.frac); }
            if (t > slowAt) { o.onSlow?.(t); slowAt = t + 30000; }
          }, 250);
          try { await wb.init(o.scenario, o.seed, o.options ?? {}, sink); } finally { clearInterval(timer); wb.onProgress = null; }
          rememberBuild(o.scenario, performance.now() - t0);
          stage('The world is made.', 1);
        };
        await (deadline > 0
          ? Promise.race([run(), new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`no 'ready' from the sim worker in ${deadline} ms`)), deadline))])
          : run());
        wb.onFatal = (msg) => this.onFatal?.(msg);
        this.backend = wb;
        this.source = 'worker';
      } catch (e) {
        if (o.source === 'worker') throw e;
        console.warn('[genesis] sim worker unavailable — falling back to the lookdev generator.', e instanceof Error ? e.message : e);
      }
    }
    if (!this.backend) {
      const { LookdevBackend } = await import('./lookdev.ts');
      const lb = new LookdevBackend();
      await lb.init(o.scenario, o.seed, o.options ?? {}, sink);
      this.backend = lb;
      this.source = 'lookdev';
    }
    // first snapshot synchronously-ish so the renderer has a world before the first frame
    await new Promise<void>((ok) => {
      const prev = this.view.snapshots;
      const check = () => (this.view.snapshots > prev ? ok() : setTimeout(check, 10));
      this.backend!.requestSnapshot(true);
      this.inFlight = true;
      check();
    });
  }

  /** callers waiting for a snapshot taken after a moment (see fresh()) */
  private freshWaiters: { after: number; ok: () => void }[] = [];

  /**
   * Resolves when a snapshot asked for now has arrived: the world as it is after every command and step already
   * answered (the worker handles messages in order). Framing a camera on something just made or moved needs it; a
   * slow frame (a software renderer takes seconds) must not stand between the request and the answer.
   */
  fresh(): Promise<void> {
    if (!this.backend) return Promise.resolve();
    const after = performance.now();
    this.backend.requestSnapshot(this.wantFull);
    this.wantFull = false;
    this.inFlight = true;
    this.requestedAt = after;
    this.lastRequest = after;
    return new Promise<void>((ok) => this.freshWaiters.push({ after, ok }));
  }

  private receive(s: Snapshot): void {
    const now = performance.now();
    this.view.apply(s, now);
    this.inFlight = false;
    if (this.freshWaiters.length) {
      for (let i = this.freshWaiters.length - 1; i >= 0; i--) if (this.freshWaiters[i].after < now) { this.freshWaiters[i].ok(); this.freshWaiters.splice(i, 1); }
    }
    this.snapsThisSecond++;
    if (now - this.hzWindowStart > 1000) {
      this.snapshotHz = (this.snapsThisSecond * 1000) / (now - this.hzWindowStart);
      this.snapsThisSecond = 0;
      this.hzWindowStart = now;
    }
  }

  /** call once per rendered frame: asks for the next snapshot (≤ 30 Hz, one in flight; re-asks after a lost reply) */
  pump(now: number): void {
    if (!this.backend) return;
    if (this.inFlight && now - this.requestedAt < 1000) return;
    if (now - this.lastRequest < 1000 / 30) return;
    this.lastRequest = now;
    this.requestedAt = now;
    this.inFlight = true;
    this.backend.requestSnapshot(this.wantFull);
    this.wantFull = false;
  }

  /** ask for every field again (after a load / rewind) */
  requestFull(): void { this.wantFull = true; }

  setSpeed(x: number): void {
    this.backend?.setSpeed(x);
    this.view.speedChanged(x); // optimistic: the clock reacts this frame, the snapshot confirms
  }
  async step(ticks: number): Promise<number> {
    if (!this.backend) return this.view.snapTick;
    const t = await this.backend.step(ticks);
    this.inFlight = false;
    this.lastRequest = -1e9;
    return t;
  }
  cmd(c: Command): Promise<CommandResult> {
    if (!this.backend) return Promise.resolve({ ok: false, msg: 'the sim is not running' });
    return this.backend.cmd(c);
  }
  parse(text: string): Promise<CommandResult> {
    if (!this.backend) return Promise.resolve({ ok: false, msg: 'the sim is not running' });
    return this.backend.parse(text);
  }
  freeform(text: string): Promise<CommandResult> {
    return this.cmd({ k: 'freeform', text });
  }
  query(q: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.backend ? this.backend.query(q, args) : Promise.resolve(null);
  }
  // additive (UI lane, saves panel): the world's save bytes, and a saved world restored (worker backend only)
  save(): Promise<ArrayBuffer | null> {
    const b = this.backend;
    return b instanceof WorkerBackend ? b.save() : Promise.resolve(null);
  }
  // additive (UI lane, mods panel): a content pack sent to the living sim (CommandResult: added now, `deferred` to the
  // next world, or refused with the reasons)
  mod(pack: unknown): Promise<CommandResult> {
    const b = this.backend;
    return b instanceof WorkerBackend ? b.mod(pack) : Promise.resolve({ ok: false, msg: 'Only the living simulation takes mods (this is the lookdev world).' });
  }
  async load(data: ArrayBuffer): Promise<{ ok: boolean; msg?: string }> {
    const b = this.backend;
    if (!(b instanceof WorkerBackend)) return { ok: false, msg: 'only the living simulation can load a save' };
    const r = await b.load(data);
    if (r.ok) { this.requestFull(); this.inFlight = false; this.lastRequest = -1e9; }
    return r;
  }
  dispose(): void { this.backend?.dispose(); this.backend = null; }
}
