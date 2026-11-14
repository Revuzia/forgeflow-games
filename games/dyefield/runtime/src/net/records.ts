// DYEFIELD — ONLINE record stream (CONTRACT_ONLINE §O5.3). THREE-free, DOM-free.
//
// HOST: RecordTap wraps three INSTANCE methods — painter.splat, painter.capsule and world.projectiles.spawn — and appends
// one record per call (exact arguments, the call's own return). Each wrapper calls through unchanged (same arguments, same
// return), so the sim is byte-identical with or without it. After each tick the host appends the tick's drained events
// (all but 'splat': clients regenerate it from the paint ops). The wrappers are installed only for the host session's
// lifetime and removed at dispose (one Painter serves every session of an arena, the lobby backdrop included).
//
// CLIENT: applyPaint replays a paint record with the same Painter call and arguments, in order; a sphere synthesizes the
// 'splat' event MatchWorld.paint pushed on the host, with the flips of the client's own call (a flip count different from
// the record's is an immediate desync signal).

import type { Painter, SplatOpts } from '../core/paint/painter.ts';
import type { ProjectilePool } from '../core/combat/projectiles.ts';
import type { SimEvent } from '../core/match/events.ts';
import { Writer, writeEvent, writePaint, writeSpawn, paintOpts, type PaintRec } from './proto.ts';

type SplatFn = Painter['splat'];
type CapsuleFn = Painter['capsule'];
type SpawnFn = ProjectilePool['spawn'];

export class RecordTap {
  private readonly w = new Writer(16384);
  private n = 0;
  /** ticks after the previous SNAP's tick of the tick being stepped (set by the host before each step) */
  offset = 1;
  private painter: Painter | null = null;
  private pool: ProjectilePool | null = null;
  private own = { splat: false, capsule: false, spawn: false };
  private prev: { splat: SplatFn | null; capsule: CapsuleFn | null; spawn: SpawnFn | null } = { splat: null, capsule: null, spawn: null };
  /** records written since the last take() (diagnostics) */
  get count(): number { return this.n; }
  get bytes(): number { return this.w.pos; }
  /** counters for __NET__.stats() */
  readonly totals = { paints: 0, spawns: 0, events: 0 };

  install(painter: Painter, pool: ProjectilePool): void {
    this.uninstall();
    this.painter = painter;
    this.pool = pool;
    const p = painter as unknown as Record<string, unknown>;
    const q = pool as unknown as Record<string, unknown>;
    this.own = {
      splat: Object.prototype.hasOwnProperty.call(p, 'splat'),
      capsule: Object.prototype.hasOwnProperty.call(p, 'capsule'),
      spawn: Object.prototype.hasOwnProperty.call(q, 'spawn'),
    };
    const splat = painter.splat, capsule = painter.capsule, spawn = pool.spawn;
    this.prev = { splat, capsule, spawn };
    const tap = this;
    (painter as { splat: SplatFn }).splat = function (x: number, y: number, z: number, o: SplatOpts): number {
      const f = splat.call(painter, x, y, z, o);
      writePaint(tap.w, tap.offset, false, o.team, x, y, z, x, y, z, o, f);
      tap.n++; tap.totals.paints++;
      return f;
    };
    (painter as { capsule: CapsuleFn }).capsule = function (ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: SplatOpts): number {
      const f = capsule.call(painter, ax, ay, az, bx, by, bz, o);
      writePaint(tap.w, tap.offset, true, o.team, ax, ay, az, bx, by, bz, o, f);
      tap.n++; tap.totals.paints++;
      return f;
    };
    (pool as { spawn: SpawnFn }).spawn = function (kind: number, owner: number, team: number, x: number, y: number, z: number,
      vx: number, vy: number, vz: number, seed: number, dripEvery: number, variant: number = kind): number {
      const i = spawn.call(pool, kind, owner, team, x, y, z, vx, vy, vz, seed, dripEvery, variant);
      if (i >= 0) {
        writeSpawn(tap.w, tap.offset, kind, owner, team, x, y, z, vx, vy, vz, seed, dripEvery, variant);
        tap.n++; tap.totals.spawns++;
      }
      return i;
    };
  }

  uninstall(): void {
    const p = this.painter, q = this.pool;
    if (p) {
      const rp = p as unknown as Record<string, unknown>;
      if (this.own.splat && this.prev.splat) rp.splat = this.prev.splat; else delete rp.splat;
      if (this.own.capsule && this.prev.capsule) rp.capsule = this.prev.capsule; else delete rp.capsule;
    }
    if (q) {
      const rq = q as unknown as Record<string, unknown>;
      if (this.own.spawn && this.prev.spawn) rq.spawn = this.prev.spawn; else delete rq.spawn;
    }
    this.painter = null;
    this.pool = null;
  }

  get installed(): boolean { return this.painter !== null; }

  /** the tick's drained events (all but 'splat') */
  addEvents(ev: readonly SimEvent[], from = 0): void {
    for (let i = from; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'splat') continue;
      if (writeEvent(this.w, this.offset, e)) { this.n++; this.totals.events++; }
    }
  }

  /** hand the pending records out (count + bytes) and start a new batch */
  take(): { n: number; bytes: Uint8Array } {
    const out = { n: this.n, bytes: this.w.view().slice() };
    this.w.reset();
    this.n = 0;
    return out;
  }

  /** drop the pending records (a migration discards a half-written batch) */
  clear(): void { this.w.reset(); this.n = 0; }
}

/** replay one paint record on the client's mirror painter. Returns the synthesized 'splat' event (spheres) or null
 *  (capsules — MatchWorld.paintStrip pushes none), and whether the flips matched the host's. */
export function applyPaint(painter: Painter, p: PaintRec): { e: SimEvent | null; flips: number; ok: boolean } {
  const o = paintOpts(p) as SplatOpts;
  if (p.type === 2) {
    const f = painter.capsule(p.ax, p.ay, p.az, p.bx, p.by, p.bz, o);
    return { e: null, flips: f, ok: f === p.flips };
  }
  const f = painter.splat(p.ax, p.ay, p.az, o);
  const e: SimEvent = { t: 'splat', x: p.ax, y: p.ay, z: p.az, r: p.radius, team: p.team, nx: o.nx ?? 0, ny: o.ny ?? 0, nz: o.nz ?? 0, flips: f };
  return { e, flips: f, ok: f === p.flips };
}
