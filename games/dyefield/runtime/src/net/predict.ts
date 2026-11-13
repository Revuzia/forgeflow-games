// DYEFIELD — ONLINE client prediction (CONTRACT_ONLINE §O5.3 projectile visuals + §O5.5). THREE-free, DOM-free.
//
// The local runner is stepped every client tick with the same Runner.step + stepKit (+ stepSub, for its tank cost) the host
// runs, against the client's map physics and a PredictPainter facade over the paint mirror (own predicted paint counts as
// own dye under the feet and on walls). On each SNAP the state the client predicted for the acknowledged intent is compared
// with the host's; a difference loads the host's state (into the saved prediction state of that seq, so the private
// movement fields stay the client's) and re-steps the unacknowledged intents. Life and death, knockback, leaps and court
// freeze come only through that reconciliation.
//
// Cosmetic projectiles: the container world's pool is fed by the host's PSPAWN records and by the local kit's own predicted
// shots (S2), and stepped every client tick with a no-effect host (paint returns 0 — except that the local runner's own
// droplets register predicted paint shapes —, hits and bursts do nothing, landers rest as puddles / cells and are ticked
// with the same core functions on an empty runner list).

import type { PlayerIntent, TeamId } from '../core/types.ts';
import { TICK, KITS, COMBAT } from '../core/config.ts';
import { hash32 } from '../core/rng.ts';
import type { Painter, SurfaceHit } from '../core/paint/painter.ts';
import type { MatchWorld } from '../core/match/world.ts';
import type { RosterEntry } from '../core/match/roster.ts';
import type { SimEvent } from '../core/match/events.ts';
import type { CastHit, PhysicsWorld } from '../core/physics.ts';
import type { Runner, RunnerNetState } from '../core/runner.ts';
import {
  KIND_BURST, KIND_CLOUD, KIND_FLICK, KIND_JELLY, KIND_MIST, PSTATE_FLY, PSTATE_PUDDLE, ProjectilePool, stepProjectiles,
  type ProjectileHost, type ProjectileKind,
} from '../core/combat/projectiles.ts';
import { kitDef, kitFire, resetKit, stepKit, type KitFire, type KitHost } from '../core/combat/kits.ts';
import { jellyDef, specialDef, type CloudDef, type JellyDef } from '../core/combat/defs.ts';
import { landJelly, stepSub, tickPuddle } from '../core/combat/subs.ts';
import { landCloud, tickCloud, type SpecialHost } from '../core/combat/specials.ts';
import { PRED_PAINT_TTL_MS, seqDiff, type RunnerSnap } from './proto.ts';

// ───────────────────────────── projectile variants (MatchWorld's construction order) ─────────────────────────────
export interface Variants { fire: number[]; sub: number[]; special: number[]; jelly: Map<number, JellyDef>; cloud: Map<number, CloudDef> }

/** The ProjectileKind index of every runner's kit fire / sub / special, rebuilt exactly as MatchWorld's constructor
 *  registers them (variant 0 = MIST-RASP's stream, then per roster entry fire → sub → special, first use wins). */
export function variantsOf(roster: readonly RosterEntry[]): Variants {
  const keys: string[] = ['mist-rasp:stream'];
  const at = (k: string): number => { let i = keys.indexOf(k); if (i < 0) { i = keys.length; keys.push(k); } return i; };
  const out: Variants = { fire: [], sub: [], special: [], jelly: new Map(), cloud: new Map() };
  for (const e of roster) {
    const f = kitFire(e.kit);
    let fv = 0;
    if (f.type === 'stream') fv = at(`${f.kit}:stream`);
    else if (f.type === 'roll') fv = at(`${f.kit}:flick`);
    else if (f.type === 'burst') fv = at(`${f.kit}:burst`);
    out.fire.push(fv);
    let subId = 'jelly-charge', sid = 'cloudburst';
    try { const row = kitDef(e.kit); subId = String(row.sub); sid = String(row.special); } catch { /* MIST-RASP's */ }
    const sub = jellyDef(subId);
    let sv = 0;
    if (sub) { sv = at(`sub:${sub.id}`); out.jelly.set(sv, sub); }
    out.sub.push(sv);
    const sp = specialDef(sid);
    let pv = 0;
    if (sp && sp.type === 'cloudburst') { pv = at(`special:${sp.id}`); out.cloud.set(pv, sp); }
    out.special.push(pv);
  }
  return out;
}

// ───────────────────────────── a seekable mulberry32 (the host's spread stream) ─────────────────────────────
/** mulberry32 whose state can be set to "after k draws" (a = seed + k·0x6d2b79f5) */
export class SeekRng {
  private a = 0;
  private readonly seed: number;
  constructor(seed: number) { this.seed = seed >>> 0; this.a = this.seed; }
  seek(k: number): void { this.a = (this.seed + Math.imul(k | 0, 0x6d2b79f5)) >>> 0; }
  readonly next = (): number => {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── predicted own paint ─────────────────────────────
interface Shape { seq: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; r2: number; cap: boolean }
const TTL_TICKS = Math.round(PRED_PAINT_TTL_MS / 1000 / TICK);

/**
 * The Painter the local runner is stepped with: teamUnder / surfaceAt answer from the mirror, except that a texel inside a
 * live predicted own-paint shape reads as the local runner's team. splat / capsule throw (prediction never paints the
 * mirror). Shapes live PRED_PAINT_TTL_MS or until the mirror shows the local team at their centre.
 */
export class PredictPainter {
  readonly mirror: Painter;
  team: TeamId = 0;
  /** the seq being stepped (shapes registered at a later seq do not count yet) */
  curSeq = 0;
  private readonly shapes: Shape[] = [];
  /** shapes registered so far (read-back) */
  added = 0;
  constructor(mirror: Painter) { this.mirror = mirror; }
  get live(): number { return this.shapes.length; }

  add(seq: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
    if (!(r > 0)) return;
    const cap = (ax - bx) * (ax - bx) + (ay - by) * (ay - by) + (az - bz) * (az - bz) > 1e-12;
    this.shapes.push({ seq, ax, ay, az, bx, by, bz, r2: r * r, cap });
    this.added++;
    if (this.shapes.length > 256) this.shapes.shift();
  }

  /** drop expired shapes and those the mirror already shows in the local team */
  prune(latestSeq: number): void {
    const A = this.mirror.atlas;
    let w = 0;
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      if (seqDiff(latestSeq & 0xffff, s.seq & 0xffff) > TTL_TICKS) continue;
      const cx = (s.ax + s.bx) * 0.5, cy = (s.ay + s.by) * 0.5, cz = (s.az + s.bz) * 0.5;
      const id = this.mirror.nearest(cx, cy, cz, 0.35, 'any');
      if (id >= 0 && A.team[id] === this.team) continue;
      this.shapes[w++] = s;
    }
    this.shapes.length = w;
  }

  clear(): void { this.shapes.length = 0; }

  private covers(x: number, y: number, z: number): boolean {
    const cur = this.curSeq;
    for (const s of this.shapes) {
      if (s.seq > cur) continue;
      let qx = s.ax, qy = s.ay, qz = s.az;
      if (s.cap) {
        const abx = s.bx - s.ax, aby = s.by - s.ay, abz = s.bz - s.az;
        let t = ((x - s.ax) * abx + (y - s.ay) * aby + (z - s.az) * abz) / (abx * abx + aby * aby + abz * abz);
        if (t < 0) t = 0; else if (t > 1) t = 1;
        qx = s.ax + abx * t; qy = s.ay + aby * t; qz = s.az + abz * t;
      }
      const dx = x - qx, dy = y - qy, dz = z - qz;
      if (dx * dx + dy * dy + dz * dz <= s.r2) return true;
    }
    return false;
  }

  teamUnder(x: number, y: number, z: number): TeamId | null {
    const id = this.mirror.nearest(x, y, z, 0.35, 'floor');
    if (id < 0) return null;
    const A = this.mirror.atlas;
    if (this.shapes.length && this.covers(A.px[id], A.py[id], A.pz[id])) return this.team;
    return A.team[id] as TeamId;
  }

  surfaceAt(x: number, y: number, z: number, maxDist: number, kind: 'floor' | 'wall' | 'any'): SurfaceHit | null {
    const h = this.mirror.surfaceAt(x, y, z, maxDist, kind);
    if (h && this.shapes.length && this.covers(h.x, h.y, h.z)) h.team = this.team;
    return h;
  }

  nearest(x: number, y: number, z: number, maxDist: number, kind: 'floor' | 'wall' | 'any'): number { return this.mirror.nearest(x, y, z, maxDist, kind); }
  weighted(team: TeamId): number { return this.mirror.weighted(team); }
  splat(): number { throw new Error('PredictPainter: prediction never paints the mirror'); }
  capsule(): number { throw new Error('PredictPainter: prediction never paints the mirror'); }
  get atlas(): Painter['atlas'] { return this.mirror.atlas; }
}

// ───────────────────────────── the cosmetic projectile host ─────────────────────────────
/**
 * Steps the container world's pool every client tick: flight exactly as the host's, but no effect — paint returns 0 (the
 * local runner's own droplets register predicted shapes), hits and bursts do nothing, landers rest (jelly puddle / CLOUDBURST
 * cell) and are ticked with the core's own tickPuddle / tickCloud on an empty runner list (no damage, no special end).
 */
export class CosmeticPool implements ProjectileHost {
  readonly physics: PhysicsWorld;
  readonly runners: readonly Runner[];
  readonly killY: number;
  readonly kinds: readonly ProjectileKind[];
  readonly pool: ProjectilePool;
  readonly seedWord: number;
  private readonly v: Variants;
  private readonly pp: PredictPainter | null;
  localPid = -1;
  /** the seq of the client tick being stepped (predicted shapes) */
  seq = 0;
  private readonly rest: SpecialHost;
  private readonly noRng = (): number => 0.5;
  constructor(world: MatchWorld, v: Variants, pp: PredictPainter | null) {
    this.physics = world.physics;
    this.runners = world.runners;
    this.killY = world.killY;
    this.kinds = world.kinds;
    this.pool = world.projectiles;
    this.seedWord = world.seedWord;
    this.v = v;
    this.pp = pp;
    const self = this;
    // the resting slots' host: the same pool and physics, no runners (no damage, no endSpecial), no paint
    this.rest = {
      pool: this.pool, seedWord: this.seedWord, physics: this.physics, runners: [],
      emit(): void { /* the host's events drive the FX */ },
      paint(): number { return 0; },
      paintStrip(): number { return 0; },
      damage(): void { /* host only */ },
      lineClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-4) return true;
        const h = self.physics.raycast(ax, ay, az, dx, dy, dz, d);
        return !h || h.toi >= d - 0.05;
      },
      specialRng: () => self.noRng,
    };
  }

  paint(owner: number, _team: TeamId, x: number, y: number, z: number, r: number): number {
    if (owner === this.localPid && this.pp) this.pp.add(this.seq, x, y, z, x, y, z, r);
    return 0;
  }
  hit(): void { /* host only */ }
  burst(): void { /* the host's 'burst' event draws it */ }
  land(slot: number, hit: CastHit): boolean {
    const P = this.pool;
    const k = P.kind[slot], vv = P.variant[slot];
    if (k === KIND_JELLY) { const j = this.v.jelly.get(vv) ?? jellyDef('jelly-charge'); if (!j) return false; landJelly(slot, hit, j, this.rest); return true; }
    if (k === KIND_CLOUD) { const c = this.v.cloud.get(vv) ?? (specialDef('cloudburst') as CloudDef | null); if (!c) return false; landCloud(slot, hit, c, this.rest); return true; }
    return false;
  }
  lost(): void { /* the host's 'special' end event */ }

  /** one client tick: resting slots (fuse / rise + rain), then flying slots */
  step(seq: number): void {
    this.seq = seq;
    const P = this.pool;
    let i = 0;
    while (i < P.count) {
      const st = P.state[i];
      if (st === PSTATE_FLY) { i++; continue; }
      P.px[i] = P.x[i]; P.py[i] = P.y[i]; P.pz[i] = P.z[i];
      const vv = P.variant[i];
      let done: boolean;
      if (st === PSTATE_PUDDLE) { const j = this.v.jelly.get(vv); done = j ? tickPuddle(i, j, this.rest) : true; }
      else { const c = this.v.cloud.get(vv); done = c ? tickCloud(i, c, this.rest) : true; }
      if (done) P.remove(i); else i++;
    }
    stepProjectiles(P, TICK, this);
  }

  /** the host says owner's resting jelly popped / its cell ended: drop the nearest resting slot of that owner + kind */
  dropResting(owner: number, kind: number, x: number, y: number, z: number): void {
    const P = this.pool;
    let best = -1, bd = Infinity;
    for (let i = 0; i < P.count; i++) {
      if (P.owner[i] !== owner || P.kind[i] !== kind || P.state[i] === PSTATE_FLY) continue;
      const d = Math.hypot(P.x[i] - x, P.y[i] - y, P.z[i] - z);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd < 6) P.remove(best);
  }

  /** remove every in-flight droplet (a host migration: the new host's world starts with none, §O5.3) */
  clear(): void { this.pool.clear(); }
}

/** the host's PSPAWN of the local runner's kit projectiles is ignored on the client (S2 predicts them itself) */
export function isKitKind(kind: number): boolean { return kind === KIND_MIST || kind === KIND_FLICK || kind === KIND_BURST; }

// ───────────────────────────── the local predictor ─────────────────────────────
export interface PendingIntent { seq: number; intent: PlayerIntent }

/** events the local prediction emits itself (S2 + §O5.5): the host's copies of these for the local runner are dropped */
export const LOCAL_EVENTS = new Set(['shot', 'dry', 'tankLow', 'roll', 'flick', 'glint', 'beam', 'jump', 'land', 'slick']);

type Phase = 'countdown' | 'live' | 'ended';

/** the prediction KitHost: paint registers predicted shapes and paints nothing; damage does nothing; events go to `out`
 *  (forward ticks only); spawns go to `pool` (the cosmetic pool forward, a discard pool on re-steps / for subs) */
class PredHost implements KitHost {
  pool: ProjectilePool;
  readonly seedWord: number;
  readonly physics: PhysicsWorld;
  readonly runners: readonly Runner[];
  forward = true;
  seq = 0;
  out: SimEvent[] | null = null;
  private readonly pp: PredictPainter;
  constructor(world: MatchWorld, pool: ProjectilePool, pp: PredictPainter) {
    this.pp = pp;
    this.pool = pool; this.seedWord = world.seedWord; this.physics = world.physics; this.runners = world.runners;
  }
  emit(e: SimEvent): void { if (this.forward && this.out) this.out.push(e); }
  paint(_owner: number, _team: TeamId, x: number, y: number, z: number, r: number): number {
    if (this.forward) this.pp.add(this.seq, x, y, z, x, y, z, r);
    return 0;
  }
  paintStrip(_owner: number, _team: TeamId, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
    if (this.forward) this.pp.add(this.seq, ax, ay, az, bx, by, bz, r);
    return 0;
  }
  damage(): void { /* host only */ }
  lineClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const h = this.physics.raycast(ax, ay, az, dx, dy, dz, d);
    return !h || h.toi >= d - 0.05;
  }
}

/** MatchWorld's frozen intent (countdown / after the horn): no movement, aim kept */
export function frozenIntent(r: Runner, src: PlayerIntent | null, n: PlayerIntent): PlayerIntent {
  n.moveX = 0; n.moveZ = 0; n.jump = false; n.fire = false; n.slick = false; n.sub = false; n.special = false;
  if (src) { n.yaw = src.yaw; n.pitch = src.pitch; n.hasAim = src.hasAim; n.aimX = src.aimX; n.aimY = src.aimY; n.aimZ = src.aimZ; }
  else { n.yaw = r.aimYaw; n.pitch = r.aimPitch; n.hasAim = false; }
  return n;
}

const HIST = 256;

export interface PredStats { snaps: number; corrections: number; errs: number[]; resteps: number; maxPending: number;
  /** diagnostics: the largest errors with both states (≤ 20 kept) */
  big: Array<Record<string, unknown>> }

export class LocalPredictor {
  readonly r: Runner;
  readonly world: MatchWorld;
  readonly pp: PredictPainter;
  private readonly fire: KitFire;
  private readonly fireVariant: number;
  private readonly subDef: JellyDef | null;
  private readonly subVariant: number;
  private readonly rng: SeekRng;
  private readonly kitHost: PredHost;
  private readonly subHost: PredHost;
  private readonly discard = new ProjectilePool(64);
  private readonly frozenBuf: PlayerIntent = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, fire: false, slick: false, sub: false, special: false, hasAim: false, aimX: 0, aimY: 0, aimZ: 0 };
  /** unacknowledged intents, oldest first */
  readonly pending: PendingIntent[] = [];
  private readonly hist: Array<RunnerNetState | null> = new Array(HIST).fill(null);
  private readonly histSeq = new Float64Array(HIST).fill(-1);
  /** predicting: the runner is alive and a host baseline exists */
  active = false;
  /** host tick of seq s = s + off (from the latest SNAP) */
  private off = 0;
  private offKnown = false;
  private countEnd = -Infinity;
  private hornTick = Infinity;
  /** the visual error offset (rendered − corrected), decays */
  readonly vis = { x: 0, y: 0, z: 0 };
  readonly stats: PredStats = { snaps: 0, corrections: 0, errs: [], resteps: 0, maxPending: 0, big: [] };
  /** the latest acknowledged seq */
  ack = -1;
  /** events of the forward ticks (drained by the client into the view list) */
  readonly out: SimEvent[] = [];

  constructor(world: MatchWorld, pid: number, roster: readonly RosterEntry[], v: Variants, cosmetic: ProjectilePool, painter: PredictPainter) {
    this.world = world;
    this.r = world.runners[pid];
    this.pp = painter;
    this.pp.team = this.r.team;
    this.fire = kitFire(this.r.kit);
    this.fireVariant = v.fire[pid] ?? 0;
    let subId = 'jelly-charge';
    try { subId = String(kitDef(this.r.kit).sub); } catch { /* MIST-RASP's */ }
    this.subDef = jellyDef(subId);
    this.subVariant = v.sub[pid] ?? 0;
    this.rng = new SeekRng(hash32(world.seed, pid, 0xc0b4a7));
    this.kitHost = new PredHost(world, cosmetic, painter);
    this.kitHost.out = this.out;
    this.subHost = new PredHost(world, this.discard, painter);
    this.subHost.out = this.out;
    void roster;
  }

  /** host tick the intent `seq` will be consumed on (best estimate) */
  hostTickOf(seq: number): number { return seq + this.off; }

  /** the phase of the latest SNAP (used until the seq → host-tick map is known) */
  private latestPhase: Phase = 'countdown';

  private phaseAt(seq: number): Phase {
    if (!this.offKnown) return this.latestPhase;
    const t = seq + this.off;
    if (t <= this.countEnd) return 'countdown';
    if (t > this.hornTick) return 'ended';
    return 'live';
  }

  /** one predicted tick (Runner.step + kit + sub, as MatchWorld's tick does for this runner) */
  private stepOnce(seq: number, it: PlayerIntent, forward: boolean): void {
    const r = this.r;
    const ph = this.phaseAt(seq);
    this.pp.curSeq = seq;
    this.kitHost.forward = forward; this.subHost.forward = forward;
    this.kitHost.seq = seq; this.subHost.seq = seq;
    this.kitHost.pool = forward ? this.kitHost.pool : this.discard;
    const painter = this.pp as unknown as Painter;
    const ev = forward ? this.out : null;
    if (ph === 'countdown') {
      r.specialHeld = !!it.special;
      r.step(TICK, frozenIntent(r, it, this.frozenBuf), painter, ev);
      return;
    }
    if (ph === 'ended') { r.step(TICK, frozenIntent(r, null, this.frozenBuf), painter, null); return; }
    if (!r.alive) return;
    r.step(TICK, it, painter, ev);
    if (r.slamPending || (r.leaping && r.leapT > KITS.leapMaxSeconds)) { r.leaping = false; r.slamPending = false; }
    if (!r.alive || r.inSea) return;
    if (this.fire.type === 'stream') this.rng.seek(2 * r.shots);
    stepKit(r, it, TICK, this.fire, this.fireVariant, this.rng.next, this.kitHost);
    stepSub(r, it, TICK, this.subDef, this.subVariant, this.subHost);
    this.discard.clear();
  }

  private save(seq: number): void {
    const k = ((seq % HIST) + HIST) % HIST;
    this.hist[k] = this.r.netState(this.hist[k] ?? undefined);
    this.histSeq[k] = seq;
  }

  private saved(seq: number): RunnerNetState | null {
    const k = ((seq % HIST) + HIST) % HIST;
    return this.histSeq[k] === seq ? this.hist[k] : null;
  }

  /** a forward client tick: queue the intent and (while predicting) step the runner with it */
  tick(seq: number, it: PlayerIntent, cosmeticPool: ProjectilePool): void {
    this.pending.push({ seq, intent: { ...it } });
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
    this.stats.maxPending = Math.max(this.stats.maxPending, this.pending.length);
    if (!this.active) return;
    this.kitHost.pool = cosmeticPool;
    this.stepOnce(seq, it, true);
    this.save(seq);
    this.pp.prune(seq);
  }

  /**
   * A SNAP arrived: `hs` = the host's block for the local runner, `snapTick` its tick, `ack` the full (unwrapped) acked seq.
   * Phase timing for the seq → host-tick map comes from the SNAP header. Returns the prediction error (m) when one was
   * measured (both sides predicting + alive), else −1.
   */
  reconcile(hs: RunnerSnap, snapTick: number, ack: number, phase: Phase, ticksLeft: number, countdownTicks: number): number {
    const r = this.r;
    this.stats.snaps++;
    this.latestPhase = phase;
    if (ack >= 0) {
      this.off = snapTick - ack;
      this.offKnown = true;
    }
    if (phase === 'countdown') { this.countEnd = snapTick + countdownTicks; this.hornTick = this.countEnd + this.world.netDurTicks; }
    else if (phase === 'live') { this.countEnd = -Infinity; this.hornTick = snapTick + ticksLeft; }
    else { this.countEnd = -Infinity; this.hornTick = Math.min(this.hornTick, snapTick); }
    if (ack > this.ack) this.ack = ack;
    while (this.pending.length && this.pending[0].seq <= this.ack) this.pending.shift();

    if (!hs.alive) {
      if (this.active) { this.active = false; resetKit(r, null); this.pp.clear(); }
      this.authoritative(hs, true);
      return -1;
    }
    if (!this.active) {
      // first SNAP, or the host respawned us: reset the private movement state like Runner.respawn, load, re-step
      r.respawn({ x: hs.x, y: hs.y, z: hs.z, yaw: hs.yaw });
      r.netLoad(this.hostFields(hs));
      this.authoritative(hs, false);
      this.active = true;
      this.restep();
      return -1;
    }
    const pred = this.saved(this.ack);
    let err = -1;
    let differs = true;
    if (pred) {
      const dx = pred.x - hs.x, dy = pred.y - hs.y, dz = pred.z - hs.z;
      err = Math.hypot(dx, dy, dz);
      // the horn freezes the court on the host only (a WASHOUT limit ending is unpredictable): not a prediction error
      if (phase !== 'ended') this.stats.errs.push(err);
      if (this.stats.errs.length > 20000) this.stats.errs.splice(0, 10000);
      if (err > 1 && phase !== 'ended' && this.stats.big.length < 20) {
        this.stats.big.push({
          err: Math.round(err * 1000) / 1000, ack: this.ack, tick: snapTick, phase,
          pred: { x: pred.x, y: pred.y, z: pred.z, state: pred.state, leaping: pred.leaping, ballistic: pred.ballistic, slick: pred.slickForm, vy: pred.vy, alive: pred.alive },
          host: { x: hs.x, y: hs.y, z: hs.z, state: hs.state, leaping: hs.leaping, ballistic: hs.ballistic, slick: hs.slickForm, vy: hs.vy, protectedT: hs.protectedT, specialActive: hs.specialActive },
          pending: this.pending.length,
        });
      }
      const da = Math.abs(((pred.yaw - hs.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      differs = err > 1e-4 || Math.abs(pred.vx - hs.vx) > 2e-3 || Math.abs(pred.vy - hs.vy) > 2e-3 || Math.abs(pred.vz - hs.vz) > 2e-3
        || da > 3e-4 || pred.state !== hs.state || pred.grounded !== hs.grounded || pred.slickForm !== hs.slickForm
        || pred.tall !== hs.tall || pred.firing !== hs.firing || pred.leaping !== hs.leaping || pred.ballistic !== hs.ballistic
        || Math.abs(pred.tank - hs.tank) > 0.05 || Math.abs(pred.surfacing - hs.surfacing) > TICK * 0.5 || pred.courtFrozen !== hs.courtFrozen;
    }
    if (differs) {
      this.stats.corrections++;
      const bx = r.x, by = r.y, bz = r.z;
      const base = pred ?? r.netState();
      r.netLoad(base);
      r.netLoad(this.hostFields(hs));
      if (hs.leaping && !(base.leaping) ) {
        // a leap the client did not predict: its gravity from the special (the host's start)
        const sp = specialDef(r.specialActive || 'wellspring');
        if (sp && sp.type === 'wellspring') { const T = Math.max(0.1, KITS.leapSeconds); r.leapG = 8 * sp.leapHeight / (T * T); r.leapT = hs.specialT; }
      }
      this.restep();
      this.vis.x += bx - r.x; this.vis.y += by - r.y; this.vis.z += bz - r.z;
      if (Math.hypot(this.vis.x, this.vis.y, this.vis.z) > 2) { this.vis.x = 0; this.vis.y = 0; this.vis.z = 0; }
    }
    this.authoritative(hs, false);
    return err;
  }

  /** re-step every unacknowledged intent from the current (corrected) state, saving each result */
  private restep(): void {
    for (const p of this.pending) {
      this.stepOnce(p.seq, p.intent, false);
      this.save(p.seq);
      this.stats.resteps++;
    }
  }

  /** the host's movement fields as a netLoad partial */
  private hostFields(hs: RunnerSnap): Partial<RunnerNetState> {
    return {
      x: hs.x, y: hs.y, z: hs.z, vx: hs.vx, vy: hs.vy, vz: hs.vz, yaw: hs.yaw, aimYaw: hs.aimYaw, aimPitch: hs.aimPitch,
      state: hs.state, grounded: hs.grounded, slickForm: hs.slickForm, tall: hs.tall, firing: hs.firing, hidden: hs.hidden,
      rolling: hs.rolling, flicking: hs.flicking, leaping: hs.leaping, charging: hs.charging, courtFrozen: hs.courtFrozen,
      ballistic: hs.ballistic, tank: hs.tank, surfacing: hs.surfacing, charge: hs.charge, alive: hs.alive,
    };
  }

  /** the host-only fields, loaded on every SNAP (life, health, meters, timers) */
  private authoritative(hs: RunnerSnap, dead: boolean): void {
    const r = this.r;
    r.alive = hs.alive;
    r.hp = hs.hp;
    r.special = hs.special;
    r.specialReady = hs.specialReady;
    r.protectedT = hs.protectedT;
    r.respawnT = hs.respawnT;
    r.specialActive = hs.specialActive;
    r.specialT = hs.specialT;
    r.spawnSite = hs.spawnSite;
    if (dead) {
      r.netLoad({ x: hs.x, y: hs.y, z: hs.z });
      r.px = r.x; r.py = r.y; r.pz = r.z;
      r.vx = 0; r.vy = 0; r.vz = 0;
      r.firing = false; r.hidden = false; r.rolling = false; r.charging = false; r.charge = 0;
      r.state = hs.state;
      this.pending.length = 0;
    }
  }

  /** decay the visual error offset (dt s): 100 ms below 0.5 m, 250 ms above */
  decay(dt: number): void {
    const d = Math.hypot(this.vis.x, this.vis.y, this.vis.z);
    if (d < 1e-5) { this.vis.x = 0; this.vis.y = 0; this.vis.z = 0; return; }
    const k = Math.exp(-dt / (d < 0.5 ? 0.1 : 0.25));
    this.vis.x *= k; this.vis.y *= k; this.vis.z *= k;
  }

  /** forget everything (a migration / keyframe reload): the next SNAP is a fresh baseline */
  reset(): void {
    this.active = false;
    this.offKnown = false;
    this.pending.length = 0;
    this.histSeq.fill(-1);
    this.pp.clear();
    this.vis.x = 0; this.vis.y = 0; this.vis.z = 0;
  }

  /** prediction error percentile (m) over the measured SNAPs */
  pct(p: number): number {
    const a = this.stats.errs.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
  }
}

/** constants re-exported for the client */
export { COMBAT };
