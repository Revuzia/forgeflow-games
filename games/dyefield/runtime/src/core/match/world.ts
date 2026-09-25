// DYEFIELD — the deterministic 4 v 4 match (CONTRACT §10.1 / §10.2 / §10.4 + CHANGED(KITSIM)). THREE-free, DOM-free.
//
// MatchWorld owns the runners, the projectile pool, the clock and the event queue. One step() is
// exactly one TICK (1/60 s). Order inside a live tick (fixed, so a seed replays bit-for-bit):
//   1. dead runners count down to respawn; living runners move (Runner.step: slick/slog/wall-slick,
//      tank refill, pad rules, hidden); a WELLSPRING leaper that landed slams right after its move
//   2. the sea washes runners below killY
//   3. per runner: kit (combat/kits.ts: stream / roll / charge / burst), sub (combat/subs.ts), special
//      start (combat/specials.ts), from the post-move positions
//   4. resting slots tick: jelly puddles (fuse → pop) and CLOUDBURST cells (rise → rain → end); then flying
//      projectiles fly, sweep, paint, drip, hit, burst and land (combat/projectiles.ts)
//   5. HP regen and special clocks, then the clock and horns
// Randomness: per runner one mulberry32 stream for spread rolls and one for its special (CLOUDBURST
// drops), both seeded from (match seed, runner id). The view drains events and never writes gameplay.
//
// CHANGED(MAPSIM) (CONTRACT_P6_11 §19): runners get the map's features (conveyors, springs, oob_ volumes:
// feet inside one → the sea, step 2); a map-level `mist` (maps.json `mist.hideRange`) hides every SLICK
// enemy (slick form: moving or not, floor or wall) beyond hideRange in canSee, on top of the phase-3 rule
// (hidden = slick and slow → unseen beyond SLICK.hiddenRange).

import type { MapDef } from '../data.ts';
import { WEAPONS } from '../data.ts';
import type { MapGeometry } from '../mapgeo.ts';
import { featuresOf } from '../mapgeo.ts';
import type { CastHit, PhysicsWorld } from '../physics.ts';
import type { Painter } from '../paint/painter.ts';
import type { MoveState, PlayerIntent, Side, TeamId } from '../types.ts';
import { emptyIntent } from '../types.ts';
import { hash32, mulberry32 } from '../rng.ts';
import { COMBAT, HEALTH, HITBOX, KITS, MATCH, MOVE, SLICK, TANK, TICK } from '../config.ts';
import { Runner, type PadZone, type SpawnPoint } from '../runner.ts';
import type { RosterEntry } from './roster.ts';
import type { MatchPhase, SimEvent } from './events.ts';
import {
  KIND_CLOUD, KIND_JELLY, PSTATE_FLY, PSTATE_PUDDLE, ProjectilePool, paintImpact, stepProjectiles,
  type ProjectileHost, type ProjectileKind,
} from '../combat/projectiles.ts';
import {
  axisDistance, kitFire, projectileKind, resetKit, specialChargePoints, stepKit, streamFire, kitDef,
  type DamageCause, type KitFire, type KitHost,
} from '../combat/kits.ts';
import {
  burstKind, cloudKind, flickKind, jellyDef, jellyKind, specialDef,
  type BurstFire, type CloudDef, type JellyDef, type SpecialDef,
} from '../combat/defs.ts';
import { landJelly, stepSub, tickPuddle } from '../combat/subs.ts';
import { endSpecial, landCloud, slam, stepSpecialInput, tickCloud, type SpecialHost } from '../combat/specials.ts';

export interface MatchOptions {
  def: MapDef; geo: MapGeometry; physics: PhysicsWorld; painter: Painter; roster: RosterEntry[];
  seed: number; durationS?: number /*180*/; countdownS?: number /*3*/;
}

export interface MatchResult { sun: number; gulf: number; neutral: number; winner: TeamId }

export interface MatchStats {
  shots: number; dry: number; splats: number; hits: number; washes: number; seaWashes: number;
  slicks: number; projectilesDropped: number; eventsDropped: number;
  // CHANGED(KITSIM): counted from the events of the same name
  flicks: number; beams: number; bursts: number; subs: number; pops: number; specials: number;
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

export class MatchWorld implements ProjectileHost, KitHost, SpecialHost {
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
    flicks: 0, beams: 0, bursts: 0, subs: 0, pops: 0, specials: 0,
  };
  /** CHANGED(MAPSIM): maps.json map-level mist.hideRange (m): SLICK enemies beyond it are unseen; Infinity = no mist */
  readonly mistRange: number;
  // ProjectileHost / KitHost
  readonly killY: number;
  /** projectile variants (index = pool.variant): 0 = MIST-RASP, then one per kit fire / sub / special in roster order */
  readonly kinds: ProjectileKind[];
  readonly seedWord: number;
  get pool(): ProjectilePool { return this.projectiles; }

  private readonly events: SimEvent[] = [];
  private readonly slots: SpawnPoint[];
  private readonly fire: KitFire[];
  private readonly fireVariant: number[];
  private readonly subDefs: Array<JellyDef | null>;
  private readonly subVariant: number[];
  private readonly specialDefs: Array<SpecialDef | null>;
  private readonly specialVariant: number[];
  private readonly variantBurst: Array<BurstFire | null> = [];
  private readonly variantJelly: Array<JellyDef | null> = [];
  private readonly variantCloud: Array<CloudDef | null> = [];
  private readonly variantKey = new Map<string, number>();
  private readonly specialRngs: Array<() => number>;
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
    const mist = (o.def as unknown as { mist?: { hideRange?: unknown } }).mist;
    this.mistRange = mist && typeof mist.hideRange === 'number' && mist.hideRange > 0 ? mist.hideRange : Infinity;
    this.respawnSeconds = WEAPONS.respawnSeconds;
    const sc = WEAPONS.specialCharge;
    this.specialPts = { perM2: sc['pointsPerSquareMetre'] ?? 1, perWash: sc['pointsPerWash'] ?? 20, keep: sc['keepOnWashed'] ?? 0.5 };
    this.pads = padsOf(o.def, o.geo);
    this.projectiles = new ProjectilePool(COMBAT.poolCapacity);

    // projectile variants: 0 = MIST-RASP (the fallback of every droplet), then per kit / sub / special
    this.kinds = [];
    this.variant('mist-rasp:stream', projectileKind(streamFire('mist-rasp')));

    const roster = o.roster;
    this.runners = [];
    this.slots = [];
    this.fire = [];
    this.fireVariant = [];
    this.subDefs = [];
    this.subVariant = [];
    this.specialDefs = [];
    this.specialVariant = [];
    this.specialRngs = [];
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
      const f = kitFire(e.kit);
      this.fire.push(f);
      let fv = 0;
      if (f.type === 'stream') fv = this.variant(`${f.kit}:stream`, projectileKind(f));
      else if (f.type === 'roll') fv = this.variant(`${f.kit}:flick`, flickKind(f));
      else if (f.type === 'burst') { fv = this.variant(`${f.kit}:burst`, burstKind(f)); this.variantBurst[fv] = f; }
      this.fireVariant.push(fv);
      let subId = 'jelly-charge', sid = 'cloudburst';
      try { const row = kitDef(e.kit); subId = String(row.sub); sid = String(row.special); } catch { /* unknown kit → MIST-RASP's sub + special */ }
      const sub = jellyDef(subId);
      this.subDefs.push(sub);
      let sv = 0;
      if (sub) { sv = this.variant(`sub:${sub.id}`, jellyKind(sub)); this.variantJelly[sv] = sub; }
      this.subVariant.push(sv);
      const spec = specialDef(sid);
      this.specialDefs.push(spec);
      let pv = 0;
      if (spec && spec.type === 'cloudburst') { pv = this.variant(`special:${spec.id}`, cloudKind(spec)); this.variantCloud[pv] = spec; }
      this.specialVariant.push(pv);
      const body = o.physics.createCharacter(MOVE.radius, MOVE.halfHeight);
      const r = new Runner({ id: e.id, name: e.name, team: e.team, kit: e.kit, bot: e.bot }, body, slot, {
        killY: this.killY,
        physics: o.physics,
        ownPad: this.pads[side],
        enemyPad: this.pads[side === 'A' ? 'B' : 'A'],
        autoRespawn: false,
        fireMoveMul: f.moveSpeedWhileFiring,
        fireSpeedCap: f.type === 'roll' ? f.rollSpeed : undefined,
        faceMotionWhileFiring: f.type === 'roll',
        features: featuresOf(o.geo),
      });
      this.runners.push(r);
      this.rngs.push(mulberry32(hash32(this.seed, e.id, 0xc0b4a7)));
      this.specialRngs.push(mulberry32(hash32(this.seed, e.id, 0x5bec1a1)));
      this.charge.push(specialChargePoints(e.kit));
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
      if (r.slamPending || (r.leaping && r.leapT > KITS.leapMaxSeconds)) this.doSlam(r);
    }
    // 2. the sea
    for (let i = 0; i < R.length; i++) if (R[i].alive && R[i].inSea) this.wash(R[i], null, 'sea');
    // 3. kits, subs, specials
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.alive) { r.firing = false; continue; }
      const it = intents[i] ?? this.neutral;
      stepKit(r, it, dt, this.fire[i], this.fireVariant[i], this.rngs[i], this);
      stepSub(r, it, dt, this.subDefs[i], this.subVariant[i], this);
      stepSpecialInput(r, it, this.specialDefs[i], this.specialVariant[i], this);
    }
    // 4. projectiles: resting slots (jelly puddles, CLOUDBURST cells), then flying ones — a slot that lands
    //    this tick starts its fuse / rise on the next tick (fuse and rain last exactly their whole ticks)
    this.stepResting();
    stepProjectiles(this.projectiles, dt, this);
    this.stats.projectilesDropped = this.projectiles.dropped;
    // 5. regen + special clocks
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (r.specialActive !== '') r.specialT += dt;
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
    if (target.slickForm && d > this.mistRange) return false;          // CHANGED(MAPSIM): map mist
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
    this.credit(owner, P.weighted(team) - before);
    this.stats.splats++;
    this.pushEvent({ t: 'splat', x, y, z, r, team, nx, ny, nz, flips });
    return flips;
  }

  hit(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number): void {
    this.damage(victim, owner, dmg, x, y, z, 'dye', true);
  }

  /** A MODE_BURST slot explodes: direct damage, line-of-sight splash with linear falloff, paint. */
  burst(slot: number, x: number, y: number, z: number, victim: Runner | null,
    nx: number, ny: number, nz: number, air: boolean): void {
    const P = this.projectiles;
    const bf = this.variantBurst[P.variant[slot]];
    if (!bf) return;
    const owner = P.owner[slot], team = P.team[slot] as TeamId;
    this.emit({ t: 'burst', pid: owner, x, y, z, r: bf.splashRadius, air });
    if (victim) this.damage(victim, owner, bf.directDamage, x, y, z, 'dye');
    const onMap = !air && !victim;
    const lx = onMap ? x + nx * 0.08 : x, ly = onMap ? y + ny * 0.08 : y, lz = onMap ? z + nz * 0.08 : z;
    const R = this.runners;
    for (let i = 0; i < R.length; i++) {
      const v = R[i];
      if (!v.alive || v.team === team || v === victim) continue;
      const d = axisDistance(v, x, y, z);
      if (d > bf.splashRadius) continue;
      const cy = v.y + v.hitHeight() * 0.5;
      if (!this.lineClear(lx, ly, lz, v.x, cy, v.z)) continue;
      const dmg = bf.splashDamage * (1 - (1 - KITS.splashEdgeFactor) * (d / bf.splashRadius));
      this.damage(v, owner, dmg, v.x, cy, v.z, 'dye');
    }
    const seed = P.seed[slot];
    if (onMap) {
      paintImpact(this, owner, team, x, y, z, nx, ny, nz, bf.impactRadius, seed, P.vx[slot], P.vz[slot]);
    } else {
      const g = this.physics.raycast(x, y, z, 0, -1, 0, COMBAT.dripMaxDrop);
      if (g) this.paint(owner, team, g.x, g.y, g.z, air ? bf.airburstRadius : bf.impactRadius, g.nx, g.ny, g.nz, -0.1, seed);
    }
  }

  /** A MODE_LANDER slot touched the map: a jelly becomes a puddle, a CLOUDBURST cell starts to rise. */
  land(slot: number, hit: CastHit): boolean {
    const P = this.projectiles;
    const k = P.kind[slot], v = P.variant[slot];
    if (k === KIND_JELLY) {
      const j = this.variantJelly[v];
      if (!j) return false;
      landJelly(slot, hit, j, this);
      return true;
    }
    if (k === KIND_CLOUD) {
      const c = this.variantCloud[v];
      if (c) { landCloud(slot, hit, c, this); return true; }
      this.lost(slot);
    }
    return false;
  }

  /** A lander expired / fell into the sea: a lost CLOUDBURST cell ends its special. */
  lost(slot: number): void {
    const P = this.projectiles;
    if (P.kind[slot] !== KIND_CLOUD) return;
    const r = this.runners[P.owner[slot]];
    if (r) endSpecial(r, P.x[slot], P.y[slot], P.z[slot], this);
  }

  // ── KitHost ───────────────────────────────────────────────────────────────────────────────

  emit(e: SimEvent): void {
    switch (e.t) {
      case 'shot': this.stats.shots++; break;
      case 'dry': this.stats.dry++; break;
      case 'flick': this.stats.flicks++; break;
      case 'beam': this.stats.beams++; break;
      case 'burst': this.stats.bursts++; break;
      case 'sub': if (e.phase === 'throw') this.stats.subs++; else if (e.phase === 'pop') this.stats.pops++; break;
      case 'special': if (e.phase === 'start') this.stats.specials++; break;
      default: break;
    }
    this.pushEvent(e);
  }

  paintStrip(owner: number, team: TeamId, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r: number, seed: number): number {
    const P = this.painter;
    const before = P.weighted(team);
    const flips = P.capsule(ax, ay, az, bx, by, bz, {
      radius: r, team, nx: 0, ny: 1, nz: 0, minFacing: KITS.rollMinFacing, edgeNoise: KITS.rollEdgeNoise, seed,
    });
    this.credit(owner, P.weighted(team) - before);
    return flips;
  }

  damage(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number, cause: DamageCause, puddle: boolean = true): void {
    if (!victim.alive || this.phase !== 'live' || victim.leaping) return;   // WELLSPRING leapers can't be interrupted
    const a = owner >= 0 && owner < this.runners.length ? this.runners[owner] : null;
    if (a && a.team === victim.team) return;                         // no friendly fire
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastHitT = 0;
    victim.lastAttacker = owner;
    this.stats.hits++;
    this.pushEvent({ t: 'hit', victim: victim.id, by: owner, dmg, x, y, z });
    if (a && puddle) {
      this.paint(owner, a.team, victim.x, victim.y + 0.05, victim.z, HITBOX.hitPuddleRadius, 0, 1, 0, 0.3,
        hash32(this.seedWord, victim.id, this.tick));
    }
    if (victim.hp <= 0) this.wash(victim, a ? owner : null, cause);
  }

  lineClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const h = this.physics.raycast(ax, ay, az, dx, dy, dz, d);
    return !h || h.toi >= d - 0.05;
  }

  // ── SpecialHost ───────────────────────────────────────────────────────────────────────────

  specialRng(pid: number): () => number {
    return this.specialRngs[pid] ?? this.specialRngs[0];
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
    resetKit(v, this);
    this.stats.washes++;
    if (cause === 'sea') this.stats.seaWashes++;
    this.pushEvent({ t: 'washed', victim: v.id, by, cause });
    if (by !== null && by >= 0 && by < this.runners.length) {
      const a = this.runners[by];
      a.washes++;
      this.addSpecial(a, this.specialPts.perWash);
      if (cause !== 'sea') {
        this.paint(by, a.team, v.x, v.y + 0.05, v.z, HITBOX.washBurstRadius, 0, 1, 0, 0.3, hash32(this.seedWord, v.id, 0xb057 + this.tick));
      }
    }
  }

  private respawnRunner(r: Runner): void {
    r.respawn(this.slots[r.id]);
    this.respawnTicks[r.id] = 0;
    this.pushEvent({ t: 'respawn', pid: r.id });
  }

  /** register a projectile variant once per key; returns its index */
  private variant(key: string, k: ProjectileKind): number {
    const hit = this.variantKey.get(key);
    if (hit !== undefined) return hit;
    const i = this.kinds.length;
    if (i > 255) throw new Error('MatchWorld: more than 256 projectile variants');
    this.kinds.push(k);
    this.variantBurst[i] = null; this.variantJelly[i] = null; this.variantCloud[i] = null;
    this.variantKey.set(key, i);
    return i;
  }

  /** credit newly dyed weighted m² to `owner` (painted + special meter) */
  private credit(owner: number, gained: number): void {
    if (owner >= 0 && owner < this.runners.length && gained > 0) {
      const o = this.runners[owner];
      o.painted += gained;
      this.addSpecial(o, gained * this.specialPts.perM2);
    }
  }

  /** tick the resting slots: jelly puddles (fuse → pop) and CLOUDBURST cells (rise → rain → end) */
  private stepResting(): void {
    const P = this.projectiles;
    let i = 0;
    while (i < P.count) {
      const st = P.state[i];
      if (st === PSTATE_FLY) { i++; continue; }
      P.px[i] = P.x[i]; P.py[i] = P.y[i]; P.pz[i] = P.z[i];
      const v = P.variant[i];
      let done: boolean;
      if (st === PSTATE_PUDDLE) {
        const j = this.variantJelly[v];
        done = j ? tickPuddle(i, j, this) : true;
      } else {
        const c = this.variantCloud[v];
        done = c ? tickCloud(i, c, this) : true;
        if (!c) this.lost(i);
      }
      if (done) P.remove(i); else i++;
    }
  }

  /** the WELLSPRING slam of a leaper that landed (or gave up) */
  private doSlam(r: Runner): void {
    const sp = this.specialDefs[r.id];
    if (sp && sp.type === 'wellspring') { slam(r, sp, this); return; }
    r.leaping = false; r.slamPending = false;
    endSpecial(r, r.x, r.y, r.z, this);
  }

  private addSpecial(r: Runner, points: number): void {
    if (!(points > 0)) return;
    if (r.specialActive !== '') return;                               // no charge while the special runs
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
    // the horn freezes the court: no firing, no coasting (gravity still lands anyone airborne); running
    // specials end, kits reset, a leaper falls with normal gravity and never slams
    for (const r of this.runners) {
      if (r.specialActive !== '') endSpecial(r, r.x, r.y, r.z, this);
      resetKit(r, this);
      r.leaping = false; r.slamPending = false;
      r.firing = false; r.vx = 0; r.vz = 0;
    }
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
