/**
 * vehicle_physics.js — Arcade driving model for Mario Kart / Out Run / etc.
 * 2D top-down OR pseudo-3D mode-7 rendering. Per-game tracks passed as config.
 *
 * API:
 *   const car = new Vehicle({topSpeed, accel, turnRate, drift_factor});
 *   car.update(delta, input);  // input = {throttle, brake, steer, handbrake}
 *   car.checkCheckpoint(track); // auto-detects lap completion
 */
class Vehicle {
  constructor(cfg = {}) {
    this.x = cfg.x ?? 0; this.y = cfg.y ?? 0;
    this.heading = cfg.heading ?? 0;
    this.speed = 0;
    this.topSpeed = cfg.topSpeed ?? 260;
    this.accel = cfg.accel ?? 200;
    this.brake = cfg.brake ?? 400;
    this.turnRate = cfg.turnRate ?? 2.2;
    this.drift = cfg.drift_factor ?? 0.3;
    this.grip = cfg.grip ?? 0.92;
    this.lap = 0;
    this.checkpointIdx = 0;
    this.vx = 0; this.vy = 0;
  }
  update(dt, input) {
    if (input.throttle) this.speed = Math.min(this.topSpeed, this.speed + this.accel * dt);
    else if (input.brake) this.speed = Math.max(-this.topSpeed * 0.4, this.speed - this.brake * dt);
    else this.speed *= Math.pow(this.grip, dt * 60);
    if (Math.abs(this.speed) > 5) {
      this.heading += input.steer * this.turnRate * dt * Math.sign(this.speed);
    }
    const driftMix = input.handbrake ? this.drift : 0;
    this.vx = Math.cos(this.heading) * this.speed * (1 - driftMix) + this.vx * driftMix;
    this.vy = Math.sin(this.heading) * this.speed * (1 - driftMix) + this.vy * driftMix;
    this.x += this.vx * dt; this.y += this.vy * dt;
  }
  applyBoost(multiplier = 1.5, duration = 1.0) {
    this.speed = Math.min(this.topSpeed * multiplier, this.speed + 100);
    this._boostUntil = performance.now() + duration * 1000;
  }
  checkCheckpoint(track) {
    const cp = track.checkpoints[this.checkpointIdx];
    if (!cp) return;
    if (Math.hypot(this.x - cp.x, this.y - cp.y) < cp.radius) {
      this.checkpointIdx++;
      if (this.checkpointIdx >= track.checkpoints.length) {
        this.checkpointIdx = 0; this.lap++;
        return { event: "lap_complete", lap: this.lap };
      }
      return { event: "checkpoint", idx: this.checkpointIdx };
    }
    return null;
  }
}
class AIRacer extends Vehicle {
  update(dt, track) {
    const cp = track.checkpoints[this.checkpointIdx];
    if (!cp) return;
    const dx = cp.x - this.x, dy = cp.y - this.y;
    const targetHeading = Math.atan2(dy, dx);
    let delta = targetHeading - this.heading;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const steer = Math.max(-1, Math.min(1, delta * 2));
    super.update(dt, { throttle: true, steer, handbrake: Math.abs(delta) > 0.8 });
    this.checkCheckpoint(track);
  }
}
if (typeof window !== "undefined") { window.Vehicle = Vehicle; window.AIRacer = AIRacer; }
