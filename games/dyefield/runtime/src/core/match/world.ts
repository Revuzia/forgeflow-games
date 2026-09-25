// DYEFIELD — the deterministic 4 v 4 match (CONTRACT §10.1 / §10.2 / §10.4). THREE-free, DOM-free.
//
// MatchWorld owns the runners, the projectile pool, the clock and the event queue. One step() is
// exactly one TICK (1/60 s). Order inside a live tick (fixed, so a seed replays bit-for-bit):
//   1. dead runners count down to respawn; living runners move (Runner.step: slick/slog/wall-slick,
//      tank refill, pad rules, hidden)
//   2. the sea washes runners below killY
//   3. kits fire (combat/kits.ts) from the post-move positions
//   4. projectiles fly, sweep, paint, drip and hit (combat/projectiles.ts)
//   5. HP regen, then the clock and horns
// Randomness: one mulberry32 stream per runner (spread rolls), seeded from (match seed, runner id).
// The view drains events and never writes gameplay (doctrine §4).

import type { MapDef } from '../data.ts';
import { WEAPONS } from '../data.ts';
import type { MapGeometry } from '../mapgeo.ts';
import type { PhysicsWorld } from '../physics.ts';
import type { Painter } from '../paint/painter.ts';
import type { MoveState, PlayerIntent, Side, TeamId } from '../types.ts';
import { emptyIntent } from '../types.ts';
import { hash32, mulberry32 } from '../rng.ts';
import { COMBAT, HEALTH, HITBOX, MATCH, MOVE, SLICK, TANK, TICK } from '../config.ts';
import { Runner, type PadZone, type SpawnPoint } from '../runner.ts';
import type { RosterEntry } from './roster.ts';
import type { MatchPhase, SimEvent } from './events.ts';
import { ProjectilePool, stepProjectiles, type ProjectileHost, type ProjectileKind } from '../combat/projectiles.ts';
import { projectileKind, specialChargePoints, stepStream, streamFire, kitDef, type KitHost, type StreamFire } from '../combat/kits.ts';

export interface MatchOptions {
  def: MapDef; geo: MapGeometry; physics: PhysicsWorld; painter: Painter; roster: RosterEntry[];
  seed: number; durationS?: number /*180*/; countdownS?: number /*3*/;
}

export interface MatchResult { sun: number; gulf: number; neutral: number; winner: TeamId }

export interface MatchStats {
  shots: number; dry: number; splats: number; hits: number; washes: number; seaWashes: number;
  slicks: number; projectilesDropped: number; eventsDropped: number;
}

const STATE_INDEX: Record<MoveState, number> = { walk: 0, slog: 1, slick: 2, wallslick: 3, air: 4 };
const PHASE_INDEX: Record<MatchPhase, number> = { countdown: 0, live: 1, ended: 2 };

/** Team pads from maps.json spawnpad brushes (mirror rule rot180: (x, y, z) → (−x, y, −z)); spawns as fallback. */
export function padsOf(def: MapDef, geo: MapGeometry): Record<Side, PadZone> {
  const out: Partial<Record<Side, PadZone>> = {};
  for (const raw of (def.brushes ?? []) as Array<Record<string, unknown>>) {
    if (raw['kind'] !== 'spawnpad') continue;
    const c = raw['center'] as number[] | undefined;
    if (!c || c.length < 3) continue;
    const r = typeof raw['radius'] === 'number' ? (raw['radius'] as number) : MATCH.padRadiusFallback;
    const side: Side = raw['team'] === 'B' ? 'B' : 'A';
    out[side] = { x: c[0], y: c[1], z: c[2], r };
    if (raw['mirror']) out[side === 'A' ? 'B' : 'A'] = { x: -c[0], y: c[1], z: -c[2], r };
  }
  for (const s of ['A', 'B'] as Side[]) {
    if (!out[s]) { const sp = geo.spawns[s]; out[s] = { x: sp.x, y: sp.y, z: sp.z, r: MATCH.padRadiusFallback }; }
  }
  return out as Record<Side, PadZone>;
}

export class MatchWorld implements ProjectileHost, KitHost {
  readonly runners: Runner[];
  readonly projectiles: ProjectilePool;
  readonly painter: Painter;
  readonly physics: PhysicsWorld;
  readonly def: MapDef;
  readonly seed: number;
  phase: MatchPhase = 'countdown';
  tick = 0;
  timeLeft: number;
  countdown: number;
  result: MatchResult | null = null;

  // ── §10.4 extras ──
  readonly pads: Record<Side, PadZone>;
  readonly durationS: number;
  readonly countdownS: number;
  readonly stats: MatchStats = {
    shots: 0, dry: 0, splats: 0, hits: 0, washes: 0, seaWashes: 0, slicks: 0, projectilesDropped: 0, eventsDropped: 0,
  };
  // ProjectileHost / KitHost
  readonly killY: number;
  readonly kinds: ProjectileKind[];
  readonly seedWord: number;
  get pool(): ProjectilePool { return this.projectiles; }

  private readonly events: SimEvent[] = [];
  private readonly slots: SpawnPoint[];
  private readonly fire: StreamFire[];
  private readonly rngs: Array<() => number>;
  private readonly charge: number[];
  private readonly specialId: string[];
  private readonly respawnTicks: Int32Array;
  private readonly durTicks: number;
  private countTicks: number;
  private liveTicks = 0;
  private readonly neutral: PlayerIntent = emptyIntent();
  private readonly respawnSeconds: number;
  private readonly specialPts: { perM2: number; perWash: number; keep: number };

  constructor(o: MatchOptions) {
    this.def = o.def;
    this.physics = o.physics;
    this.painter = o.painter;
    this.seed = o.seed | 0;
    this.seedWord = hash32(this.seed, 0x5eed5a17);
    this.durationS = o.durationS ?? MATCH.durationS;
    this.countdownS = o.countdownS ?? MATCH.countdownS;
    this.durTicks = Math.max(1, Math.round(this.durationS / TICK));
    this.countTicks = Math.max(0, Math.round(this.countdownS / TICK));
    this.timeLeft = this.durTicks * TICK;
    this.countdown = this.countTicks * TICK;
    this.killY = o.def.killY ?? -1;
    this.respawnSeconds = WEAPONS.respawnSeconds;
    const sc = WEAPONS.specialCharge;
    this.specialPts = { perM2: sc['pointsPerSquareMetre'] ?? 1, perWash: sc['pointsPerWash'] ?? 20, keep: sc['keepOnWashed'] ?? 0.5 };
    this.pads = padsOf(o.def, o.geo);
    this.projectiles = new ProjectilePool(COMBAT.poolCapacity);

    // projectile kinds: one per kind id (phase 4: MIST-RASP only)
    const mist = streamFire('mist-rasp');
    this.kinds = [projectileKind(mist)];

    const roster = o.roster;
    this.runners = [];
    this.slots = [];
    this.fire = [];
    this.rngs = [];
    this.charge = [];
    this.specialId = [];
    this.respawnTicks = new Int32Array(roster.length);
    const perTeam: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    for (let i = 0; i < roster.length; i++) {
      const e = roster[i];
      if (e.id !== i) throw new Error(`MatchWorld: roster[${i}].id is ${e.id}; ids must equal their index (runners[i] ↔ intents[i])`);
      const side: Side = e.team === 2 ? 'B' : 'A';
      const sp = o.geo.spawns[side];
      const k = perTeam[e.team]++;
      const lat = MATCH.spawnSlots[k % MATCH.spawnSlots.length];
      const slot: SpawnPoint = { x: sp.x - Math.cos(sp.yaw) * lat, y: sp.y, z: sp.z + Math.sin(sp.yaw) * lat, yaw: sp.yaw };
      this.slots.push(slot);
      const f = streamFire(e.kit);
      this.fire.push(f);
      const body = o.physics.createCharacter(MOVE.radius, MOVE.halfHeight);
      const r = new Runner({ id: e.id, name: e.name, team: e.team, kit: e.kit, bot: e.bot }, body, slot, {
        killY: this.killY,
        physics: o.physics,
        ownPad: this.pads[side],
        enemyPad: this.pads[side === 'A' ? 'B' : 'A'],
        autoRespawn: false,
        fireMoveMul: f.moveSpeedWhileFiring,
      });
      this.runners.push(r);
      this.rngs.push(mulberry32(hash32(this.seed, e.id, 0xc0b4a7)));
      this.charge.push(specialChargePoints(e.kit));
      let sid = 'cloudburst';
      try { sid = String(kitDef(e.kit).special); } catch { /* unknown kit → MIST-RASP's special */ }
      this.specialId.push(sid);
    }

    if (this.countTicks === 0) {
      this.phase = 'live';
      this.pushEvent({ t: 'phase', phase: 'live' });
      this.pushEvent({ t: 'horn', kind: 'start' });
    } else {
      this.pushEvent({ t: 'phase', phase: 'countdown' });
    }
  }

  // ── the tick ──────────────────────────────────────────────────────────────────────────────

  step(intents: readonly PlayerIntent[]): void {
    const dt = TICK;
    this.tick++;
    const R = this.runners;

    if (this.phase === 'countdown') {
      // inputs frozen: look around, nothing else
      for (let i = 0; i < R.length; i++) R[i].step(dt, this.frozen(R[i], intents[i]), this.painter, this.events);
      if (this.countTicks > 0) this.countTicks--;
      this.countdown = this.countTicks * TICK;
      if (this.countTicks === 0) {
        this.phase = 'live';
        this.pushEvent({ t: 'phase', phase: 'live' });
        this.pushEvent({ t: 'horn', kind: 'start' });
      }
      this.capEvents();
      return;
    }

    if (this.phase === 'ended') {
      for (let i = 0; i < R.length; i++) R[i].step(dt, this.frozen(R[i], null), this.painter, null);
      return;
    }

    // 1. respawn timers + movement
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.alive) {
        r.px = r.x; r.py = r.y; r.pz = r.z; r.pyaw = r.yaw;
        const left = --this.respawnTicks[i];
        r.respawnT = Math.max(0, left) * TICK;
        if (left <= 0) this.respawnRunner(r);
        continue;
      }
      const s0 = r.slicks;
      r.step(dt, intents[i] ?? this.neutral, this.painter, this.events);
      this.stats.slicks += r.slicks - s0;
    }
    // 2. the sea
    for (let i = 0; i < R.length; i++) if (R[i].alive && R[i].inSea) this.wash(R[i], null, 'sea');
    // 3. kits
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.alive) { r.firing = false; continue; }
      stepStream(r, intents[i] ?? this.neutral, dt, this.fire[i], this.rngs[i], this);
    }
    // 4. projectiles
    stepProjectiles(this.projectiles, dt, this);
    this.stats.projectilesDropped = this.projectiles.dropped;
    // 5. regen
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.alive) continue;
      r.lastHitT += dt;
      if (r.lastHitT >= HEALTH.regenDelay && r.hp < WEAPONS.hp) r.hp = Math.min(WEAPONS.hp, r.hp + HEALTH.regenPerSecond * dt);
    }
    // clock + horns
    this.liveTicks++;
    const left = this.durTicks - this.liveTicks;
    this.timeLeft = Math.max(0, left) * TICK;
    const minute = Math.round(MATCH.minuteHornS / TICK), final10 = Math.round(MATCH.finalHornS / TICK);
    if (this.durTicks > minute && left === minute) this.pushEvent({ t: 'horn', kind: 'minute' });
    if (this.durTicks > final10 && left === final10) this.pushEvent({ t: 'horn', kind: 'final10' });
    if (left <= 0) this.end();
    this.capEvents();
  }

  drainEvents(out: SimEvent[]): number {
    const ev = this.events;
    const n = ev.length;
    for (let i = 0; i < n; i++) out.push(ev[i]);
    ev.length = 0;
    return n;
  }

  onOwnPad(r: Runner): boolean {
    return r.onPad(this.pads[r.side]);
  }

  canSee(viewer: Runner, target: Runner): boolean {
    if (!target.alive || !viewer.alive) return false;
    if (viewer === target || viewer.team === target.team) return true;
    const ey = viewer.y + (viewer.slickForm ? COMBAT.slickEyeHeight : COMBAT.eyeHeight);
    const ty = target.y + target.hitHeight() * 0.5;
    const dx = target.x - viewer.x, dy = ty - ey, dz = target.z - viewer.z;
    const d = Math.hypot(dx, dy, dz);
    if (target.hidden && d > SLICK.hiddenRange) return false;
    if (d < 1e-3) return true;
    const hit = this.physics.raycast(viewer.x, ey, viewer.z, dx, dy, dz, d);
    return !hit || hit.toi >= d - 0.25;
  }

  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      const q = Math.round(v * 1000) | 0;
      h ^= q & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
    };
    mix(this.tick); mix(PHASE_INDEX[this.phase]); mix(this.timeLeft);
    for (const r of this.runners) {
      mix(r.x); mix(r.y); mix(r.z); mix(r.vx); mix(r.vy); mix(r.vz); mix(r.yaw);
      mix(r.tank); mix(r.hp); mix(r.alive ? 1 : 0); mix(STATE_INDEX[r.state]); mix(r.special);
      mix(r.washes); mix(r.washedCount); mix(r.painted); mix(r.shots); mix(r.slickForm ? 1 : 0);
    }
    const p = this.projectiles;
    mix(p.count);
    for (let i = 0; i < p.count; i++) { mix(p.x[i]); mix(p.y[i]); mix(p.z[i]); mix(p.owner[i]); }
    return `${this.painter.hash()}-${(h >>> 0).toString(16).padStart(8, '0')}`;
  }

  /** The runner's own slot on its team pad. */
  spawnFor(r: Runner): SpawnPoint { return { ...this.slots[r.id] }; }

  // ── ProjectileHost ────────────────────────────────────────────────────────────────────────

  paint(owner: number, team: TeamId, x: number, y: number, z: number, r: number,
    nx: number, ny: number, nz: number, minFacing: number, seed: number): number {
    const P = this.painter;
    const before = P.weighted(team);
    const flips = P.splat(x, y, z, { radius: r, team, nx, ny, nz, minFacing, seed });
    const gained = P.weighted(team) - before;
    if (owner >= 0 && owner < this.runners.length && gained > 0) {
      const o = this.runners[owner];
      o.painted += gained;
      this.addSpecial(o, gained * this.specialPts.perM2);
    }
    this.stats.splats++;
    this.pushEvent({ t: 'splat', x, y, z, r, team, nx, ny, nz, flips });
    return flips;
  }

  hit(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number): void {
    if (!victim.alive || this.phase !== 'live') return;
    const a = owner >= 0 && owner < this.runners.length ? this.runners[owner] : null;
    if (a && a.team === victim.team) return;                         // no friendly fire
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastHitT = 0;
    victim.lastAttacker = owner;
    this.stats.hits++;
    this.pushEvent({ t: 'hit', victim: victim.id, by: owner, dmg, x, y, z });
    if (a) {
      this.paint(owner, a.team, victim.x, victim.y + 0.05, victim.z, HITBOX.hitPuddleRadius, 0, 1, 0, 0.3,
        hash32(this.seedWord, victim.id, this.tick));
    }
    if (victim.hp <= 0) this.wash(victim, a ? owner : null, 'dye');
  }

  // ── KitHost ───────────────────────────────────────────────────────────────────────────────

  emit(e: SimEvent): void {
    if (e.t === 'shot') this.stats.shots++;
    else if (e.t === 'dry') this.stats.dry++;
    this.pushEvent(e);
  }

  // ── dev / probe hooks (FRONT exposes them behind ?dev=1) ─────────────────────────────────

  devSetTimeLeft(s: number): void {
    const left = Math.max(0, Math.min(this.durTicks, Math.round(s / TICK)));
    this.liveTicks = this.durTicks - left;
    this.timeLeft = left * TICK;
  }

  devDamage(pid: number, n: number, by: number = -1): void {
    const v = this.runners[pid];
    if (!v || !v.alive) return;
    if (by >= 0 && by < this.runners.length && this.runners[by].team !== v.team) {
      this.hit(v, by, n, v.x, v.y + 0.6, v.z);
      return;
    }
    v.hp = Math.max(0, v.hp - n);
    v.lastHitT = 0;
    if (v.hp <= 0) this.wash(v, null, 'dye');
  }

  devSetTank(pid: number, v: number): void {
    const r = this.runners[pid];
    if (!r) return;
    r.tank = Math.max(0, Math.min(TANK.max, v));
    if (r.tank > TANK.lowRearm) r.lowArmed = true;
  }

  devTeleport(pid: number, x: number, y: number, z: number, yaw?: number): void {
    this.runners[pid]?.teleport(x, y, z, yaw);
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────

  private frozen(r: Runner, src: PlayerIntent | null | undefined): PlayerIntent {
    const n = this.neutral;
    n.moveX = 0; n.moveZ = 0; n.jump = false; n.fire = false; n.slick = false; n.sub = false; n.special = false;
    if (src) {
      n.yaw = src.yaw; n.pitch = src.pitch; n.hasAim = src.hasAim; n.aimX = src.aimX; n.aimY = src.aimY; n.aimZ = src.aimZ;
    } else {
      n.yaw = r.aimYaw; n.pitch = r.aimPitch; n.hasAim = false;
    }
    return n;
  }

  private wash(v: Runner, by: number | null, cause: 'dye' | 'sea' | 'sub' | 'special'): void {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.firing = false;
    v.hidden = false;
    v.washedCount++;
    const i = v.id;
    this.respawnTicks[i] = Math.max(1, Math.round(this.respawnSeconds / TICK));
    v.respawnT = this.respawnTicks[i] * TICK;
    v.special *= this.specialPts.keep;
    if (v.special < 1) v.specialReady = false;
    this.stats.washes++;
    if (cause === 'sea') this.stats.seaWashes++;
    this.pushEvent({ t: 'washed', victim: v.id, by, cause });
    if (by !== null && by >= 0 && by < this.runners.length) {
      const a = this.runners[by];
      a.washes++;
      this.addSpecial(a, this.specialPts.perWash);
      if (cause === 'dye') {
        this.paint(by, a.team, v.x, v.y + 0.05, v.z, HITBOX.washBurstRadius, 0, 1, 0, 0.3, hash32(this.seedWord, v.id, 0xb057 + this.tick));
      }
    }
  }

  private respawnRunner(r: Runner): void {
    r.respawn(this.slots[r.id]);
    this.respawnTicks[r.id] = 0;
    this.pushEvent({ t: 'respawn', pid: r.id });
  }

  private addSpecial(r: Runner, points: number): void {
    if (!(points > 0)) return;
    const c = this.charge[r.id] || 190;
    r.special = Math.min(1, r.special + points / c);
    if (r.special >= 1 && !r.specialReady) {
      r.specialReady = true;
      this.pushEvent({ t: 'special', pid: r.id, id: this.specialId[r.id], phase: 'ready', x: r.x, y: r.y, z: r.z });
    }
  }

  private end(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.timeLeft = 0;
    const c = this.painter.coverage();
    this.result = { sun: c.sun, gulf: c.gulf, neutral: c.neutral, winner: c.sun > c.gulf ? 1 : c.gulf > c.sun ? 2 : 0 };
    this.projectiles.clear();
    // the horn freezes the court: no firing, no coasting (gravity still lands anyone airborne)
    for (const r of this.runners) { r.firing = false; r.vx = 0; r.vz = 0; }
    this.pushEvent({ t: 'horn', kind: 'end' });
    this.pushEvent({ t: 'phase', phase: 'ended' });
  }

  private pushEvent(e: SimEvent): void {
    this.events.push(e);
  }

  private capEvents(): void {
    const over = this.events.length - MATCH.eventCap;
    if (over > 0) { this.events.splice(0, over); this.stats.eventsDropped += over; }
  }
}
