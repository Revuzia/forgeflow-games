// DYEFIELD — ONLINE remote-runner interpolation and the host clock (CONTRACT_ONLINE §O5.6). THREE-free, DOM-free.
//
// Snapshots are buffered with their host tick and arrival time. The host tick is estimated as lastSnapTick +
// (now − arrival)/TICK, smoothed with an EWMA of α 0.1. Remote runners render at estimatedHostTick − INTERP_DELAY
// (100 ms by default, clamped 66–150 ms, set to 1.5× the measured p90 snapshot gap): positions lerp, angles take the
// shortest arc, discrete flags follow the newer snapshot. With the buffer empty: extrapolate ≤ 100 ms, then hold.

import { TICK } from '../core/config.ts';
import type { Runner } from '../core/runner.ts';
import { angleDelta, wrapAngle } from '../core/runner.ts';
import { INTERP_DELAY_MS, INTERP_MAX_MS, INTERP_MIN_MS, type RunnerSnap } from './proto.ts';

const TICK_MS = TICK * 1000;

interface Frame { tick: number; at: number; runners: RunnerSnap[] }

export class HostClock {
  private baseTick = 0;
  private baseAt = 0;
  private known = false;
  private lastAt = -1;
  private readonly gaps: number[] = [];
  delayMs = INTERP_DELAY_MS;

  /** a SNAP of tick `tick` arrived at `now` (ms) */
  observe(tick: number, now: number): void {
    if (this.lastAt >= 0) {
      const g = now - this.lastAt;
      this.gaps.push(g);
      if (this.gaps.length > 60) this.gaps.shift();
      if (this.gaps.length >= 10) {
        const s = this.gaps.slice().sort((a, b) => a - b);
        const p90 = s[Math.floor(0.9 * (s.length - 1))];
        this.delayMs = Math.max(INTERP_MIN_MS, Math.min(INTERP_MAX_MS, 1.5 * p90));
      }
    }
    this.lastAt = now;
    if (!this.known) { this.baseTick = tick; this.baseAt = now; this.known = true; return; }
    const pred = this.estimate(now);
    const err = tick - pred;
    if (Math.abs(err) > 60) { this.baseTick = tick; this.baseAt = now; return; }
    this.baseTick = pred + 0.1 * err;
    this.baseAt = now;
  }

  /** the host tick now (fractional) */
  estimate(now: number): number { return this.known ? this.baseTick + (now - this.baseAt) / TICK_MS : 0; }
  /** the tick remote runners and FX render at */
  renderTick(now: number): number { return this.estimate(now) - this.delayMs / TICK_MS; }
  get ready(): boolean { return this.known; }
  reset(): void { this.known = false; this.lastAt = -1; this.gaps.length = 0; }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Interp {
  private readonly frames: Frame[] = [];
  readonly clock = new HostClock();
  /** frames kept */
  max = 24;

  push(tick: number, now: number, runners: readonly RunnerSnap[]): void {
    this.clock.observe(tick, now);
    const last = this.frames[this.frames.length - 1];
    if (last && tick <= last.tick) {
      // out of order or duplicate: replace an equal tick, drop an older one
      if (tick === last.tick) last.runners = runners.map((r) => ({ ...r }));
      return;
    }
    this.frames.push({ tick, at: now, runners: runners.map((r) => ({ ...r })) });
    if (this.frames.length > this.max) this.frames.shift();
  }

  reset(): void { this.frames.length = 0; this.clock.reset(); }

  get newest(): Frame | null { return this.frames[this.frames.length - 1] ?? null; }

  /** write the interpolated state of every runner but `skip` into `runners` */
  apply(now: number, runners: readonly Runner[], skip: number): number {
    const F = this.frames;
    if (!F.length) return 0;
    const rt = this.clock.renderTick(now);
    let a: Frame | null = null, b: Frame | null = null;
    for (let i = F.length - 1; i >= 0; i--) {
      if (F[i].tick <= rt) { a = F[i]; b = F[i + 1] ?? null; break; }
    }
    if (!a) { a = F[0]; b = null; }
    let t = 0;
    let extra = 0;
    if (b) t = Math.max(0, Math.min(1, (rt - a.tick) / Math.max(1, b.tick - a.tick)));
    else extra = Math.max(0, Math.min(100 / TICK_MS, rt - a.tick)) * TICK;   // extrapolate ≤ 100 ms, then hold
    for (let i = 0; i < runners.length; i++) {
      if (i === skip) continue;
      const s0 = a.runners[i];
      if (!s0) continue;
      const s1 = b ? b.runners[i] : null;
      writeRunner(runners[i], s0, s1, t, extra);
    }
    return rt;
  }
}

/** set a container runner from snapshot s0 (→ s1 at t; or s0 extrapolated `extra` s); px = x so the view's alpha is a no-op */
export function writeRunner(r: Runner, s0: RunnerSnap, s1: RunnerSnap | null, t: number, extra: number): void {
  const n = s1 ?? s0;
  let x: number, y: number, z: number;
  if (s1) {
    // never lerp across a respawn / teleport (death → alive, or a jump of > 6 m in one gap)
    const jump = s0.alive !== s1.alive || Math.hypot(s1.x - s0.x, s1.y - s0.y, s1.z - s0.z) > 6;
    if (jump) { const s = t < 0.5 ? s0 : s1; x = s.x; y = s.y; z = s.z; }
    else { x = lerp(s0.x, s1.x, t); y = lerp(s0.y, s1.y, t); z = lerp(s0.z, s1.z, t); }
  } else if (s0.alive && extra > 0) {
    x = s0.x + s0.vx * extra; y = s0.y + Math.max(-30, s0.vy) * extra; z = s0.z + s0.vz * extra;
  } else { x = s0.x; y = s0.y; z = s0.z; }
  r.x = x; r.y = y; r.z = z;
  r.px = x; r.py = y; r.pz = z;
  r.vx = s1 ? lerp(s0.vx, s1.vx, t) : s0.vx; r.vy = s1 ? lerp(s0.vy, s1.vy, t) : s0.vy; r.vz = s1 ? lerp(s0.vz, s1.vz, t) : s0.vz;
  const yaw = s1 ? wrapAngle(s0.yaw + angleDelta(s0.yaw, s1.yaw) * t) : s0.yaw;
  r.yaw = yaw; r.pyaw = yaw;
  r.aimYaw = s1 ? wrapAngle(s0.aimYaw + angleDelta(s0.aimYaw, s1.aimYaw) * t) : s0.aimYaw;
  r.aimPitch = s1 ? lerp(s0.aimPitch, s1.aimPitch, t) : s0.aimPitch;
  r.state = n.state; r.alive = n.alive; r.slickForm = n.slickForm; r.firing = n.firing; r.hidden = n.hidden; r.grounded = n.grounded;
  r.rolling = n.rolling; r.flicking = n.flicking; r.leaping = n.leaping; r.charging = n.charging; r.specialReady = n.specialReady;
  r.courtFrozen = n.courtFrozen; r.ballistic = n.ballistic;
  r.hp = n.hp; r.tank = n.tank; r.special = n.special; r.charge = n.charge; r.respawnT = n.respawnT; r.protectedT = n.protectedT;
  r.surfacing = n.surfacing; r.specialActive = n.specialActive; r.specialT = n.specialT; r.spawnSite = n.spawnSite; r.subCooldown = n.subCooldown;
  r.speed = Math.hypot(r.vx, r.vz);
  if (n.state === 'wallslick') { r.wallNx = -Math.sin(yaw); r.wallNz = -Math.cos(yaw); }
  // counters (mod 256 on the wire): keep them monotonic for the view's "did it grow" checks
  r.launches = grow(r.launches, n.launches); r.lastSpring = n.lastSpring;
  r.jumps = grow(r.jumps, n.jumps); r.landings = grow(r.landings, n.landings);
}

/** a counter that is `wire` mod 256 and never goes down */
function grow(cur: number, wire: number): number {
  const d = (wire - (cur & 0xff) + 256) & 0xff;
  return cur + d;
}
