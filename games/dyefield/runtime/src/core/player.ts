// DYEFIELD — the tide-runner sim (CONTRACT §4.8). THREE-free, DOM-free, deterministic.
//
// Phase 2 scope: WALK / AIR movement on the Rapier kinematic capsule, camera-relative, with
// ground/air acceleration, coyote time + jump buffer, smooth body yaw, killY respawn, and the
// DEV_BRUSH (HOLD LMB = dye the floor under the feet, SUNCREW for a side-A runner).
// SLOG / SLICK / WALL-SLICK and the tank economy arrive in phase 3 (MOVE already carries their numbers).

import type { MoveState, PlayerIntent, Side, TeamId } from './types.ts';
import type { CharacterBody } from './physics.ts';
import type { Painter } from './paint/painter.ts';
import { MOVE, DEV_BRUSH } from './config.ts';

export interface SpawnPoint { x: number; y: number; z: number; yaw: number }

export interface PlayerOptions {
  /** feet below this y → respawn (maps.json killY; phase 5 turns it into WASHED) */
  killY?: number;
}

const TAU = Math.PI * 2;

/** shortest signed angle a → b */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

export class Player {
  readonly team: TeamId;
  readonly side: Side;
  x = 0; y = 0; z = 0;              // feet
  vx = 0; vy = 0; vz = 0;
  yaw = 0;                          // body facing (turns toward move/aim direction)
  state: MoveState = 'walk';
  grounded = false;
  tank = 100;

  // ── previous tick pose (render interpolation) ──
  px = 0; py = 0; pz = 0; pyaw = 0;
  // ── read-outs for the view / HUD / harness ──
  /** true while the dev brush is held (drives the upper-body 'brush' layer) */
  brushing = false;
  /** horizontal speed (m/s) after collision */
  speed = 0;
  /** seconds since the last take-off (0 while grounded) */
  airTime = 0;
  /** increments on every landing (the view plays 'land' when it changes) */
  landings = 0;
  /** increments on every jump take-off */
  jumps = 0;
  /** increments on every respawn */
  respawns = 0;
  /** texels flipped by this runner's brush */
  painted = 0;
  /** brush splats made */
  splats = 0;
  /** ticks simulated */
  ticks = 0;
  killY: number;

  private readonly body: CharacterBody;
  private spawn: SpawnPoint;
  private coyote = 0;
  private jumpBuf = 0;
  private prevJump = false;
  private prevFire = false;
  private brushClock = 0;

  constructor(team: TeamId, body: CharacterBody, spawn: SpawnPoint, opts: PlayerOptions = {}) {
    this.team = team;
    this.side = team === 2 ? 'B' : 'A';
    this.body = body;
    this.spawn = { ...spawn };
    this.killY = opts.killY ?? -1;
    this.respawn(spawn);
    this.respawns = 0;
  }

  /** Put the runner back on a spawn point at rest. */
  respawn(spawn: SpawnPoint): void {
    this.spawn = { ...spawn };
    this.body.setFeet(spawn.x, spawn.y + MOVE.skin, spawn.z);
    const f = this.body.feet();
    this.x = f.x; this.y = f.y; this.z = f.z;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = spawn.yaw; this.pyaw = spawn.yaw;
    this.grounded = true;
    this.state = 'walk';
    this.coyote = MOVE.coyote;
    this.jumpBuf = 0;
    this.airTime = 0;
    this.speed = 0;
    this.brushClock = 0;
    this.respawns++;
  }

  /** Teleport (dev / harness): keeps the current spawn. */
  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.body.setFeet(x, y + MOVE.skin, z);
    const f = this.body.feet();
    this.x = f.x; this.y = f.y; this.z = f.z;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    if (yaw !== undefined) { this.yaw = yaw; this.pyaw = yaw; }
    this.airTime = 0;
  }

  /** One fixed tick: phase 2 = walk/air + DEV_BRUSH under the feet while intent.fire. */
  step(dt: number, intent: PlayerIntent, painter: Painter): void {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw;
    this.ticks++;

    // ── wish direction (camera-relative): forward = (sin yaw, 0, cos yaw), right = (−cos yaw, 0, sin yaw)
    let ix = Number.isFinite(intent.moveX) ? intent.moveX : 0;
    let iz = Number.isFinite(intent.moveZ) ? intent.moveZ : 0;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const cy = Number.isFinite(intent.yaw) ? intent.yaw : this.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    const rx = -fz, rz = fx;
    const wx = fx * iz + rx * ix;
    const wz = fz * iz + rz * ix;
    const wlen = Math.hypot(wx, wz);            // 0..1 (analog magnitude)

    // ── jump input: rising edge → buffer
    if (intent.jump && !this.prevJump) this.jumpBuf = MOVE.jumpBuffer;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.prevJump = intent.jump;

    // ── horizontal velocity
    const maxSpeed = MOVE.walk;
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    if (this.grounded) {
      const rate = wlen > 1e-3 ? MOVE.accel : MOVE.decel;
      this.approach(tx, tz, rate * dt);
    } else if (wlen > 1e-3) {
      this.approach(tx, tz, MOVE.airAccel * dt);
    } else {
      const k = Math.exp(-MOVE.airDrag * dt);
      this.vx *= k; this.vz *= k;
    }

    // ── vertical: coyote + buffered jump, gravity
    if (this.grounded) this.coyote = MOVE.coyote;
    else this.coyote = Math.max(0, this.coyote - dt);
    let jumpedNow = false;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = MOVE.jump;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
      jumpedNow = true;
      this.jumps++;
    }
    let dy: number;
    if (this.grounded && !jumpedNow) {
      this.vy = 0;
      dy = -MOVE.groundStick * dt;             // keep contact; the KCC's snap-to-ground does the rest
    } else {
      const v0 = this.vy;
      this.vy = Math.max(-MOVE.maxFall, this.vy - MOVE.gravity * dt);
      dy = 0.5 * (v0 + this.vy) * dt;          // trapezoid: exact apex for constant gravity
    }

    // ── collide + slide (Rapier KCC)
    const want = { x: this.vx * dt, z: this.vz * dt };
    const res = this.body.move(want.x, dy, want.z);
    const f = this.body.feet();
    this.x = f.x; this.y = f.y; this.z = f.z;

    const wasGrounded = this.grounded;
    this.grounded = res.grounded && this.vy <= 0.01;
    if (this.grounded) {
      if (!wasGrounded) this.landings++;
      this.vy = 0;
      this.airTime = 0;
    } else {
      this.airTime += dt;
      // bonked a ceiling on the way up → start falling
      if (this.vy > 0 && dy > 1e-5 && res.dy < dy * 0.5) this.vy = 0;
    }
    // Hard-blocked by a wall / crate (lost most of the step without climbing): adopt the slide the
    // KCC chose so velocity never builds up into the obstacle. Partial losses (ramps, bevels, a pad
    // rim, a step being climbed) are NOT fed back — that feedback compounds tick over tick and
    // turns every bump into a stall; the stick's target speed bounds the velocity anyway.
    const wantLen = Math.hypot(want.x, want.z);
    const gotLen = Math.hypot(res.dx, res.dz);
    const climbed = res.dy > dy + 1e-4;
    if (wantLen > 1e-6 && gotLen < wantLen * 0.5 && !climbed) {
      if (gotLen > 1e-6) { this.vx = res.dx / dt; this.vz = res.dz / dt; }
      else { this.vx = 0; this.vz = 0; }
    }
    this.speed = Math.hypot(res.dx, res.dz) / dt;

    // ── facing: toward the move direction, or toward the camera while brushing
    const brushing = !!intent.fire;
    this.brushing = brushing;
    let targetYaw: number | null = null;
    let rate = MOVE.turnRate;
    if (brushing) { targetYaw = cy; rate = MOVE.aimTurnRate; }
    else if (wlen > 0.05) targetYaw = Math.atan2(wx, wz);
    if (targetYaw !== null) {
      const k = 1 - Math.exp(-rate * dt);
      this.yaw = wrapAngle(this.yaw + angleDelta(this.yaw, targetYaw) * k);
    }

    this.state = this.grounded ? 'walk' : 'air';

    // ── DEV_BRUSH: a splat at the feet every 1/perSecond s while held (the first one on the press)
    if (brushing) {
      if (!this.prevFire) this.brushClock = 0;
      this.brushClock -= dt;
      const period = 1 / DEV_BRUSH.perSecond;
      let guard = 4;
      while (this.brushClock <= 1e-9 && guard-- > 0) {
        this.brushClock += period;
        this.splats++;
        this.painted += painter.splat(this.x, this.y, this.z, {
          radius: DEV_BRUSH.radius,
          team: this.team,
          nx: 0, ny: 1, nz: 0,
          minFacing: DEV_BRUSH.minFacing,
          seed: (this.splats * 2654435761) >>> 0,
        });
      }
    }
    this.prevFire = brushing;

    // ── out of bounds
    if (this.y < this.killY) this.respawn(this.spawn);
  }

  /** move (vx, vz) toward (tx, tz) by at most maxDelta (m/s) */
  private approach(tx: number, tz: number, maxDelta: number): void {
    const ddx = tx - this.vx, ddz = tz - this.vz;
    const d = Math.hypot(ddx, ddz);
    if (d <= maxDelta || d < 1e-9) { this.vx = tx; this.vz = tz; return; }
    const s = maxDelta / d;
    this.vx += ddx * s; this.vz += ddz * s;
  }

  /** The spawn this runner returns to. */
  spawnPoint(): SpawnPoint { return { ...this.spawn }; }
}
