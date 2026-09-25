// DYEFIELD — the tide-runner sim (CONTRACT §10.1 / §10.2 / §10.4). THREE-free, DOM-free, deterministic.
//
// One Runner = one kinematic Rapier capsule driven by a PlayerIntent per 60 Hz tick. Phase 3 state
// machine (DESIGN §4):
//
//   WALK       neutral floor               MOVE.walk 5.2, jump 6.2
//   SLOG       enemy dye underfoot         MOVE.slog 2.0, jump 3.8, cannot slick, no refill
//   SLICK      SHIFT on own dye / own pad  MOVE.slick 8.4, jump 7.0, capsule shrinks, tank +36/s, no firing
//   WALLSLICK  SHIFT + pushing into a wall whose texel at the contact (≤ 0.5 m) is own dye:
//              climbs at MOVE.wallSlick with gravity off, pops over the ledge at the top, drops
//              when the wall under it loses its dye
//   AIR        not grounded (a slick jump keeps the submerged form while SHIFT is held)
//
// Releasing SHIFT (or leaving own dye) starts a 0.12 s surfacing: firing stays blocked, and the capsule
// grows back only when a sphere sweep finds head clearance. Hidden = SLICK/WALLSLICK and not faster
// than 1.5 m/s. An enemy inside this runner's team pad is shoved out; a runner on its own pad counts
// as standing in its own dye (CONTRACT §7 note: the pad itself is unpaintable).
//
// Firing is NOT here: MatchWorld runs combat/kits.ts after every runner has moved. A standalone Runner
// (probe_move, the phase-2 Player shim) can still run the phase-2 DEV_BRUSH (opts.devBrush).

import type { MoveState, PlayerIntent, Side, TeamId } from './types.ts';
import type { CharacterBody, PhysicsWorld } from './physics.ts';
import type { Painter } from './paint/painter.ts';
import type { SimEvent } from './match/events.ts';
import { COMBAT, DEV_BRUSH, HITBOX, MATCH, MOVE, SLICK, TANK, TICK } from './config.ts';
import { WEAPONS } from './data.ts';

export interface SpawnPoint { x: number; y: number; z: number; yaw: number }
/** A team spawn pad: top-centre + radius. */
export interface PadZone { x: number; y: number; z: number; r: number }
export interface RunnerIdentity { id: number; name: string; team: TeamId; kit: string; bot: boolean }

export interface RunnerOptions {
  /** feet below this y → sea (default −1) */
  killY?: number;
  /** wall-slick casts + head clearance (null: no wall-slick, the capsule regrows unchecked) */
  physics?: PhysicsWorld | null;
  /** own team pad: counts as own dye (slick + refill) */
  ownPad?: PadZone | null;
  /** enemy team pad: this runner is pushed back out of it */
  enemyPad?: PadZone | null;
  /** standalone default true: below killY → respawn at once. MatchWorld passes false and washes (cause 'sea'). */
  autoRespawn?: boolean;
  /** phase-2 DEV_BRUSH: while fire is held, dye the floor under the feet */
  devBrush?: boolean;
  /** speed factor while firing (kit moveSpeedWhileFiring) */
  fireMoveMul?: number;
}

const TAU = Math.PI * 2;

/** shortest signed angle a → b */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

export function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

const fin = (v: number, d: number): number => (Number.isFinite(v) ? v : d);

/** wall probe results */
const WALL_NONE = 0;   // no steep surface in reach (or it faces away)
const WALL_OWN = 1;    // steep surface whose texel at the contact is own dye
const WALL_OTHER = 2;  // steep surface, but neutral / enemy / unpaintable at the contact

export class Runner {
  readonly id: number;
  readonly name: string;
  readonly team: TeamId;
  readonly side: Side;
  readonly kit: string;
  readonly bot: boolean;
  /** the other crew */
  readonly enemy: TeamId;

  x = 0; y = 0; z = 0;              // feet
  vx = 0; vy = 0; vz = 0;
  yaw = 0;                          // body facing
  px = 0; py = 0; pz = 0; pyaw = 0; // previous tick (interpolation)
  aimYaw = 0; aimPitch = 0;         // current aim (view: upper body + kit)
  state: MoveState = 'walk';
  grounded = false;
  tank: number = TANK.max;
  hp: number = WEAPONS.hp;
  alive = true;
  respawnT = 0;
  hidden = false;
  special = 0;
  firing = false;
  lastAttacker = -1;
  lastHitT = 1e9;
  washes = 0; washedCount = 0; painted = 0;
  landings = 0; jumps = 0;

  // ── §10.4 read-outs ──
  slickForm = false;
  surfacing = 0;
  speed = 0;
  airTime = 0;
  respawns = 0;
  brushing = false;
  wallNx = 0; wallNz = 0;
  inSea = false;
  shots = 0; dries = 0; slicks = 0; refillsFromLow = 0;
  /** dev-brush splats made (phase-2 shim) */
  splats = 0;
  ticks = 0;
  killY: number;

  // ── kit state (combat/kits.ts) ──
  /** @internal s until the next shot may leave */
  fireCd = 0;
  /** @internal s until the next dry click */
  dryCd = 0;
  /** @internal tankLow may fire */
  lowArmed = true;
  /** @internal special 'ready' already announced */
  specialReady = false;

  readonly body: CharacterBody;
  readonly physics: PhysicsWorld | null;
  ownPad: PadZone | null;
  enemyPad: PadZone | null;
  readonly autoRespawn: boolean;
  readonly devBrush: boolean;
  fireMoveMul: number;

  private spawn: SpawnPoint;
  private tall = true;              // capsule at full height
  private coyote = 0;
  private jumpBuf = 0;
  private prevJump = false;
  private prevFire = false;
  private brushClock = 0;
  private lastGround: 'walk' | 'slog' | 'slick' = 'walk';
  private offDyeT = 0;
  private wallCd = 0;
  private refilling = false;
  private probeNx = 0; private probeNz = 0;

  constructor(who: RunnerIdentity, body: CharacterBody, spawn: SpawnPoint, opts: RunnerOptions = {}) {
    this.id = who.id;
    this.name = who.name;
    this.team = who.team;
    this.side = who.team === 2 ? 'B' : 'A';
    this.enemy = who.team === 1 ? 2 : who.team === 2 ? 1 : 0;
    this.kit = who.kit;
    this.bot = who.bot;
    this.body = body;
    this.physics = opts.physics ?? null;
    this.ownPad = opts.ownPad ?? null;
    this.enemyPad = opts.enemyPad ?? null;
    this.autoRespawn = opts.autoRespawn ?? true;
    this.devBrush = opts.devBrush ?? false;
    this.fireMoveMul = opts.fireMoveMul ?? 1;
    this.killY = opts.killY ?? -1;
    this.spawn = { ...spawn };
    this.respawn(spawn);
    this.respawns = 0;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────

  /** Full reset onto a spawn point: hp 100, tank 100, alive, tall capsule, at rest. */
  respawn(spawn?: SpawnPoint): void {
    if (spawn) this.spawn = { ...spawn };
    const s = this.spawn;
    if (!this.tall) { this.body.setShape(MOVE.radius, MOVE.halfHeight); this.tall = true; }
    this.body.setFeet(s.x, s.y + MOVE.skin, s.z);
    const f = this.body.feet();
    this.x = f.x; this.y = f.y; this.z = f.z;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = s.yaw; this.pyaw = s.yaw;
    this.aimYaw = s.yaw; this.aimPitch = 0;
    this.grounded = true;
    this.state = 'walk';
    this.slickForm = false;
    this.surfacing = 0;
    this.coyote = MOVE.coyote;
    this.jumpBuf = 0;
    this.airTime = 0;
    this.speed = 0;
    this.brushClock = 0;
    this.lastGround = 'walk';
    this.offDyeT = 0;
    this.wallCd = 0;
    this.refilling = false;
    this.hp = WEAPONS.hp;
    this.tank = TANK.max;
    this.alive = true;
    this.respawnT = 0;
    this.hidden = false;
    this.firing = false;
    this.lastAttacker = -1;
    this.lastHitT = 1e9;
    this.inSea = false;
    this.fireCd = 0;
    this.dryCd = 0;
    this.lowArmed = true;
    this.respawns++;
  }

  /** Teleport (dev / harness): keeps the current spawn, hp and tank. */
  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.body.setFeet(x, y + MOVE.skin, z);
    const f = this.body.feet();
    this.x = f.x; this.y = f.y; this.z = f.z;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    if (yaw !== undefined) { this.yaw = yaw; this.pyaw = yaw; this.aimYaw = yaw; }
    if (this.state === 'wallslick') this.state = 'air';
    this.airTime = 0;
  }

  /** The spawn this runner returns to. */
  spawnPoint(): SpawnPoint { return { ...this.spawn }; }

  // ── queries ───────────────────────────────────────────────────────────────────────────────

  /** alive, tall form, surfaced and not on a wall */
  canFire(): boolean {
    return this.alive && !this.slickForm && this.tall && this.surfacing <= 0 && this.state !== 'wallslick';
  }

  /** feet inside the pad disc (horizontal) and at its height */
  onPad(p: PadZone | null): boolean {
    if (!p) return false;
    const dx = this.x - p.x, dz = this.z - p.z;
    return dx * dx + dz * dz <= p.r * p.r && Math.abs(this.y - p.y) < 0.6;
  }

  /** projectile hit volume height (CONTRACT §10.1): 1.2 m tall, 0.5 m in slick form */
  hitHeight(): number { return this.slickForm ? HITBOX.slickHeight : HITBOX.height; }

  /** capsule full height right now (KCC) */
  capsuleHeight(): number {
    return 2 * ((this.tall ? MOVE.halfHeight : MOVE.slickHalfHeight) + MOVE.radius);
  }

  // ── the tick ──────────────────────────────────────────────────────────────────────────────

  step(dt: number, intent: PlayerIntent, painter: Painter, events: SimEvent[] | null = null): void {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw;
    this.ticks++;
    this.inSea = false;
    if (!this.alive) { this.firing = false; this.hidden = false; this.brushing = false; return; }

    // ── wish direction (camera-relative): forward = (sin yaw, 0, cos yaw), right = (−cos yaw, 0, sin yaw)
    let ix = fin(intent.moveX, 0);
    let iz = fin(intent.moveZ, 0);
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const cy = fin(intent.yaw, this.yaw);
    const fx = Math.sin(cy), fz = Math.cos(cy);
    const rx = -fz, rz = fx;
    const wx = fx * iz + rx * ix;
    const wz = fz * iz + rz * ix;
    const wlen = Math.hypot(wx, wz);            // 0..1 (analog magnitude)
    const dirx = wlen > 1e-6 ? wx / wlen : 0, dirz = wlen > 1e-6 ? wz / wlen : 0;

    // ── aim: toward the aim point when there is one, else along camera yaw / pitch
    this.aimYaw = cy;
    this.aimPitch = fin(intent.pitch, 0);
    if (intent.hasAim && Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY) && Number.isFinite(intent.aimZ)) {
      const ax = intent.aimX - this.x, ay = intent.aimY - (this.y + COMBAT.muzzleHeight), az = intent.aimZ - this.z;
      const h = Math.hypot(ax, az);
      if (Math.hypot(h, ay) > COMBAT.minAimDist) { this.aimYaw = Math.atan2(ax, az); this.aimPitch = Math.atan2(ay, h); }
    }

    // ── jump input: rising edge → buffer
    if (intent.jump && !this.prevJump) this.jumpBuf = MOVE.jumpBuffer;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.prevJump = !!intent.jump;
    this.wallCd = Math.max(0, this.wallCd - dt);

    // ── ground context (from the last tick's contact)
    const onOwnPad = this.grounded && this.onPad(this.ownPad);
    const under = this.grounded ? painter.teamUnder(this.x, this.y, this.z) : null;
    const ownGround = this.grounded && (onOwnPad || under === this.team);
    const enemyGround = this.grounded && !onOwnPad && under === this.enemy && this.enemy !== 0;
    const wantSlick = !!intent.slick;

    // ── WALL-SLICK
    let onWall = this.state === 'wallslick';
    let popped = false;
    if (onWall) {
      if (!wantSlick || !this.physics) {
        if (!wantSlick) this.exitSlick(events);   // first, so leaveWall sees the tall form (one 'slick' off event)
        this.leaveWall(events);
        onWall = false;
      } else if (this.jumpBuf > 0) {
        // jump off the wall: up and away
        this.vy = SLICK.wallJumpVy;
        this.vx = this.wallNx * SLICK.wallJumpOut;
        this.vz = this.wallNz * SLICK.wallJumpOut;
        this.jumpBuf = 0;
        this.coyote = 0;
        this.jumps++;
        if (events) events.push({ t: 'jump', pid: this.id });
        this.leaveWall(events);
        onWall = false;
        popped = true;              // velocity already set this tick: skip the ground/air steering
      } else if (wlen > 0.1 && dirx * this.wallNx + dirz * this.wallNz > -SLICK.wallHoldDot) {
        this.leaveWall(events);     // pulling away from the wall
        onWall = false;
      } else {
        const code = this.probeWall(-this.wallNx, -this.wallNz, painter);
        if (code === WALL_OWN) {
          this.wallNx = this.probeNx; this.wallNz = this.probeNz;
        } else if (code === WALL_NONE && this.vy > 0) {
          // the wall ended under a climbing runner: pop over the lip
          this.vy = SLICK.ledgePopVy;
          this.vx = -this.wallNx * SLICK.ledgePopForward;
          this.vz = -this.wallNz * SLICK.ledgePopForward;
          this.leaveWall(events);
          onWall = false;
          popped = true;
        } else {
          // the dye under us is gone (or the wall is): drop
          this.vy = Math.min(this.vy, 0);
          this.leaveWall(events);
          onWall = false;
        }
      }
    } else if (wantSlick && this.physics && wlen > 0.1 && this.wallCd <= 0 && this.enemy !== 0) {
      const code = this.probeWall(dirx, dirz, painter);
      if (code === WALL_OWN && -(dirx * this.probeNx + dirz * this.probeNz) > SLICK.wallPushDot) {
        this.wallNx = this.probeNx; this.wallNz = this.probeNz;
        if (!this.slickForm) this.enterSlick(events, true);
        else if (events) events.push({ t: 'slick', pid: this.id, on: true, wall: true });
        this.state = 'wallslick';
        this.grounded = false;
        this.vy = Math.max(this.vy, 0);
        onWall = true;
      }
    }

    // ── form transitions off the wall
    if (!onWall) {
      if (this.grounded) {
        if (wantSlick && ownGround) {
          this.offDyeT = 0;
          if (!this.slickForm) this.enterSlick(events, false);
        } else if (this.slickForm) {
          // organic dye edges: a few ticks over neutral texels are forgiven; enemy dye / release is instant
          this.offDyeT += dt;
          if (!wantSlick || enemyGround || this.offDyeT > SLICK.edgeGrace) this.exitSlick(events);
        }
      } else if (this.slickForm && !wantSlick) {
        this.exitSlick(events);
      }
    }
    if (!this.slickForm && !this.tall) this.tryGrow();

    const firingHeld = !!intent.fire && this.canFire();
    let wantX = 0, wantZ = 0, dy = 0;
    let jumpedNow = false;
    const vyBefore = this.vy;

    if (onWall) {
      // ── climb / cling: gravity off, pressed into the wall, a little sideways crawl
      const nx = this.wallNx, nz = this.wallNz;
      const pushing = wlen > 0.1 && -(dirx * nx + dirz * nz) > 0.3;
      this.vy = pushing ? MOVE.wallSlick * Math.min(1, wlen) : 0;
      const along = dirx * nx + dirz * nz;
      const tx = (dirx - along * nx) * MOVE.wallSlick * SLICK.wallStrafe * wlen;
      const tz = (dirz - along * nz) * MOVE.wallSlick * SLICK.wallStrafe * wlen;
      this.vx = tx - nx * SLICK.wallPush;
      this.vz = tz - nz * SLICK.wallPush;
      wantX = this.vx * dt; wantZ = this.vz * dt; dy = this.vy * dt;
      this.coyote = 0;
    } else {
      // ── horizontal velocity
      let ground: 'walk' | 'slog' | 'slick' = 'walk';
      if (this.grounded) {
        ground = this.slickForm ? 'slick' : enemyGround ? 'slog' : 'walk';
        this.lastGround = ground;
      }
      if (!popped) {
        let maxSpeed = ground === 'slick' ? MOVE.slick : ground === 'slog' ? MOVE.slog : MOVE.walk;
        if (!this.grounded) maxSpeed = this.slickForm ? MOVE.slick : MOVE.walk;
        if (firingHeld) maxSpeed *= this.fireMoveMul;
        const tx = wx * maxSpeed, tz = wz * maxSpeed;
        if (this.grounded) {
          const acc = ground === 'slick' ? SLICK.accel : MOVE.accel;
          const rate = wlen > 1e-3 ? acc : Math.max(MOVE.decel, acc * 0.75);
          this.approach(tx, tz, rate * dt);
        } else if (wlen > 1e-3) {
          this.approach(tx, tz, MOVE.airAccel * dt);
        } else {
          const k = Math.exp(-MOVE.airDrag * dt);
          this.vx *= k; this.vz *= k;
        }
      }

      // ── vertical: coyote + buffered jump, gravity
      if (this.grounded) this.coyote = MOVE.coyote;
      else this.coyote = Math.max(0, this.coyote - dt);
      if (!popped && this.jumpBuf > 0 && this.coyote > 0) {
        this.vy = this.lastGround === 'slick' ? MOVE.jumpSlick : this.lastGround === 'slog' ? MOVE.jumpSlog : MOVE.jump;
        this.jumpBuf = 0;
        this.coyote = 0;
        this.grounded = false;
        jumpedNow = true;
        this.jumps++;
        if (events) events.push({ t: 'jump', pid: this.id });
      }
      if (this.grounded && !jumpedNow && !popped) {
        this.vy = 0;
        dy = -MOVE.groundStick * dt;
      } else {
        const v0 = this.vy;
        this.vy = Math.max(-MOVE.maxFall, this.vy - MOVE.gravity * dt);
        dy = 0.5 * (v0 + this.vy) * dt;          // trapezoid: exact apex for constant gravity
      }
      wantX = this.vx * dt; wantZ = this.vz * dt;
    }

    // ── enemy pad: cancel inward velocity and shove outward (no spawn camping)
    const ep = this.enemyPad;
    if (ep) {
      const ddx = this.x - ep.x, ddz = this.z - ep.z;
      const d = Math.hypot(ddx, ddz);
      const R = ep.r + MOVE.radius;
      if (d < R && this.y > ep.y - 0.8 && this.y < ep.y + 3) {
        let nx: number, nz: number;
        if (d > 1e-4) { nx = ddx / d; nz = ddz / d; } else { nx = 0; nz = ep.z > 0 ? -1 : 1; }
        const vin = this.vx * nx + this.vz * nz;
        if (vin < 0) { this.vx -= vin * nx; this.vz -= vin * nz; }
        const winIn = wantX * nx + wantZ * nz;
        if (winIn < 0) { wantX -= winIn * nx; wantZ -= winIn * nz; }
        const push = Math.min(R - d, MATCH.padPushSpeed * dt);
        wantX += nx * push; wantZ += nz * push;
      }
    }

    // ── collide + slide (Rapier KCC)
    const res = this.body.move(wantX, dy, wantZ);
    const f = this.body.feet();
    this.x = f.x; this.y = f.y; this.z = f.z;

    const wasGrounded = this.grounded;
    if (onWall) {
      this.grounded = false;
      // bonked a ceiling while climbing → hold
      if (this.vy > 0 && dy > 1e-5 && res.dy < dy * 0.5) this.vy = 0;
    } else {
      this.grounded = res.grounded && this.vy <= 0.01;
      if (this.grounded) {
        if (!wasGrounded) {
          this.landings++;
          if (events) events.push({ t: 'land', pid: this.id, hard: -vyBefore > MATCH.hardLandingSpeed });
        }
        this.vy = 0;
        this.airTime = 0;
      } else {
        this.airTime += dt;
        if (this.vy > 0 && dy > 1e-5 && res.dy < dy * 0.5) this.vy = 0;   // ceiling bonk
      }
      // hard-blocked by a wall / crate: adopt the KCC's slide so velocity never builds into it
      const wantLen = Math.hypot(wantX, wantZ);
      const gotLen = Math.hypot(res.dx, res.dz);
      const climbed = res.dy > dy + 1e-4;
      if (wantLen > 1e-6 && gotLen < wantLen * 0.5 && !climbed) {
        if (gotLen > 1e-6) { this.vx = res.dx / dt; this.vz = res.dz / dt; }
        else { this.vx = 0; this.vz = 0; }
      }
    }
    this.speed = Math.hypot(res.dx, res.dz) / dt;
    const speed3 = Math.hypot(res.dx, res.dy, res.dz) / dt;

    // ── facing: toward the aim while firing, the wall while on it, else the move direction
    const brushing = this.devBrush && !!intent.fire;
    this.brushing = brushing;
    let targetYaw: number | null = null;
    let rate = MOVE.turnRate;
    if (firingHeld || brushing) { targetYaw = this.aimYaw; rate = MOVE.aimTurnRate; }
    else if (onWall) targetYaw = Math.atan2(-this.wallNx, -this.wallNz);
    else if (wlen > 0.05) targetYaw = Math.atan2(wx, wz);
    if (targetYaw !== null) {
      const k = 1 - Math.exp(-rate * dt);
      this.yaw = wrapAngle(this.yaw + angleDelta(this.yaw, targetYaw) * k);
    }

    // ── state
    if (onWall) this.state = 'wallslick';
    else if (!this.grounded) this.state = 'air';
    else if (this.slickForm) this.state = 'slick';
    else if (enemyGround) this.state = 'slog';
    else this.state = 'walk';

    // ── tank: refills only while SLICK (own dye / own pad). No passive regen anywhere else.
    if (this.state === 'slick' && this.tank < TANK.max) {
      if (!this.refilling && this.tank < TANK.low) this.refillsFromLow++;
      this.refilling = true;
      this.tank = Math.min(TANK.max, this.tank + TANK.refillPerSecond * dt);
    } else {
      this.refilling = false;
    }
    if (this.tank > TANK.lowRearm) this.lowArmed = true;

    this.hidden = (this.state === 'slick' || this.state === 'wallslick') && speed3 <= SLICK.hiddenSpeed;

    // ── phase-2 DEV_BRUSH (standalone / shim only)
    if (brushing) {
      if (!this.prevFire) this.brushClock = 0;
      this.brushClock -= dt;
      const period = 1 / DEV_BRUSH.perSecond;
      let guard = 4;
      while (this.brushClock <= 1e-9 && guard-- > 0) {
        this.brushClock += period;
        this.splats++;
        const before = painter.weighted(this.team);
        painter.splat(this.x, this.y, this.z, {
          radius: DEV_BRUSH.radius, team: this.team, nx: 0, ny: 1, nz: 0,
          minFacing: DEV_BRUSH.minFacing, seed: (this.splats * 2654435761) >>> 0,
        });
        this.painted += Math.max(0, painter.weighted(this.team) - before);
      }
    }
    this.prevFire = !!intent.fire;

    // ── surfacing clock (counted from the release tick itself)
    if (this.surfacing > 0) {
      this.surfacing -= dt;
      if (this.surfacing < 1e-6) this.surfacing = 0;
    }

    // ── out of bounds
    if (this.y < this.killY) {
      if (this.autoRespawn) this.respawn();
      else this.inSea = true;
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────

  private enterSlick(events: SimEvent[] | null, wall: boolean): void {
    this.slickForm = true;
    this.surfacing = 0;
    this.offDyeT = 0;
    this.slicks++;
    if (this.tall) { this.body.setShape(MOVE.radius, MOVE.slickHalfHeight); this.tall = false; }
    if (events) events.push({ t: 'slick', pid: this.id, on: true, wall });
  }

  private exitSlick(events: SimEvent[] | null): void {
    if (!this.slickForm) return;
    this.slickForm = false;
    this.surfacing = Math.max(1, Math.round(SLICK.surfaceTime / TICK)) * TICK;   // whole ticks: 7 × 1/60 ≈ 0.117 s
    this.offDyeT = 0;
    if (events) events.push({ t: 'slick', pid: this.id, on: false, wall: false });
    this.tryGrow();
  }

  private leaveWall(events: SimEvent[] | null): void {
    this.state = 'air';
    this.wallCd = 0.2;
    if (this.slickForm && events) events.push({ t: 'slick', pid: this.id, on: true, wall: false });
  }

  /** Grow back to full height when a sphere sweep finds head clearance. */
  private tryGrow(): boolean {
    if (this.tall) return true;
    const ph = this.physics;
    if (ph) {
      const topY = this.y + MOVE.radius + 2 * MOVE.slickHalfHeight;          // top sphere centre of the slick capsule
      const need = 2 * (MOVE.halfHeight - MOVE.slickHalfHeight) + MOVE.skin + SLICK.headroomMargin;
      if (ph.sphereCast(this.x, topY, this.z, 0, 1, 0, MOVE.radius - 0.02, need)) return false;
    }
    this.body.setShape(MOVE.radius, MOVE.halfHeight);
    this.tall = true;
    return true;
  }

  /** @internal true once the capsule is back at full height */
  get isTall(): boolean { return this.tall; }

  /**
   * Short sphere cast from the capsule centre along (dx, dz). Fills probeNx/Nz with the horizontal
   * wall normal. Own dye at the contact (painter.surfaceAt(contact, 0.5, 'wall')) → WALL_OWN.
   */
  private probeWall(dx: number, dz: number, painter: Painter): number {
    const ph = this.physics;
    if (!ph) return WALL_NONE;
    const cr = SLICK.wallCastRadius;
    const cy = this.y + MOVE.radius + (this.tall ? MOVE.halfHeight : MOVE.slickHalfHeight);
    const hit = ph.sphereCast(this.x, cy, this.z, dx, 0, dz, cr, SLICK.wallCastDist);
    if (!hit) return WALL_NONE;
    if (Math.abs(hit.ny) >= SLICK.wallMaxNy) return WALL_NONE;
    const hl = Math.hypot(hit.nx, hit.nz);
    if (hl < 1e-6) return WALL_NONE;
    const nx = hit.nx / hl, nz = hit.nz / hl;
    if (dx * nx + dz * nz > -0.3) return WALL_NONE;           // not facing the push
    this.probeNx = nx; this.probeNz = nz;
    const cx = hit.x - hit.nx * cr, cyy = hit.y - hit.ny * cr, cz = hit.z - hit.nz * cr;
    const s = painter.surfaceAt(cx, cyy, cz, SLICK.wallTexelDist, 'wall');
    return s && s.team === this.team ? WALL_OWN : WALL_OTHER;
  }

  /** move (vx, vz) toward (tx, tz) by at most maxDelta (m/s) */
  private approach(tx: number, tz: number, maxDelta: number): void {
    const ddx = tx - this.vx, ddz = tz - this.vz;
    const d = Math.hypot(ddx, ddz);
    if (d <= maxDelta || d < 1e-9) { this.vx = tx; this.vz = tz; return; }
    const s = maxDelta / d;
    this.vx += ddx * s; this.vz += ddz * s;
  }
}
