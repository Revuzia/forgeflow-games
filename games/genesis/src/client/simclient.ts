// GENESIS — SimClient: the main thread's only door into the simulation (CONTRACT.md §14).
//
// Two interchangeable backends behind one interface:
//   * WorkerBackend — the real sim in a module Web Worker (src/sim/worker.ts), ToWorker / FromWorker messages.
//   * LookdevBackend — a local generator of plausible planet data (src/client/lookdev.ts) for render development.
// `?source=lookdev` forces lookdev; otherwise the worker is tried first and, if it is missing, throws, or does not say
// 'ready' in time, the client warns and falls back to lookdev so the app always runs.
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

  constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      const msg = ev.message || 'the sim worker failed to load';
      if (this.readyReject) { this.readyReject(new Error(msg)); this.readyReject = null; this.readyResolve = null; }
      else this.onFatal?.(msg);
    };
    worker.onmessageerror = () => this.onFatal?.('a sim message could not be decoded');
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

  requestSnapshot(full = false): void { this.post({ type: 'snapshot', full }); }
  setSpeed(x: number): void { this.post({ type: 'speed', speed: x }); }
  step(ticks: number): Promise<number> { return this.call<number>((id) => ({ type: 'step', id, ticks })); }
  cmd(c: Command): Promise<CommandResult> { return this.call<CommandResult>((id) => ({ type: 'cmd', id, cmd: c })); }
  parse(text: string): Promise<CommandResult> { return this.call<CommandResult>((id) => ({ type: 'parse', id, text })); }
  query(q: string, args?: Record<string, unknown>): Promise<unknown> { return this.call<unknown>((id) => ({ type: 'query', id, q, args })); }
  save(): Promise<ArrayBuffer> { return this.call<ArrayBuffer>((id) => ({ type: 'save', id })); }
  // additive (UI lane, saves panel): restore a saved world in this worker; the ArrayBuffer is transferred
  load(data: ArrayBuffer): Promise<{ ok: boolean; msg?: string }> { return this.call<{ ok: boolean; msg?: string }>((id) => ({ type: 'load', id, data }), [data]); }
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
  /** ms to wait for the worker's 'ready' before falling back (auto mode) */
  readyTimeoutMs?: number;
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
    if (o.source !== 'lookdev') {
      try {
        const { spawnSimWorker } = await import('./workerspawn.ts');
        const wb = new WorkerBackend(spawnSimWorker());
        const timeout = o.readyTimeoutMs ?? 20000;
        await Promise.race([
          wb.init(o.scenario, o.seed, o.options ?? {}, sink),
          new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`no 'ready' from the sim worker in ${timeout} ms`)), timeout)),
        ]);
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
  async load(data: ArrayBuffer): Promise<{ ok: boolean; msg?: string }> {
    const b = this.backend;
    if (!(b instanceof WorkerBackend)) return { ok: false, msg: 'only the living simulation can load a save' };
    const r = await b.load(data);
    if (r.ok) { this.requestFull(); this.inFlight = false; this.lastRequest = -1e9; }
    return r;
  }
  dispose(): void { this.backend?.dispose(); this.backend = null; }
}
