/**
 * flight_physics.js — Arcade flight simulation (Pilotwings-class, not full-realism).
 * Lift/drag/thrust model + pitch/roll/yaw controls. Works with Three.js.
 *
 * API:
 *   const plane = new Aircraft({mass, wingArea, maxThrust, dragCoef});
 *   plane.update(dt, input); // input = {pitch, roll, yaw, throttle}
 *   plane.mesh = threeObject; // attach to renderable
 */
class Aircraft {
  constructor(cfg = {}) {
    this.position = cfg.position || [0, 100, 0];
    this.velocity = [0, 0, 0];
    this.euler = [0, 0, 0]; // pitch, yaw, roll
    this.mass = cfg.mass ?? 1000;
    this.wingArea = cfg.wingArea ?? 16;
    this.maxThrust = cfg.maxThrust ?? 15000;
    this.dragCoef = cfg.dragCoef ?? 0.02;
    this.liftCoef = cfg.liftCoef ?? 1.2;
    this.throttle = 0;
    this.stallSpeed = cfg.stallSpeed ?? 30;
    this.mesh = null;
  }
  update(dt, input) {
    // Controls
    this.euler[0] += (input.pitch ?? 0) * 1.5 * dt;
    this.euler[1] += (input.yaw   ?? 0) * 1.2 * dt;
    this.euler[2] += (input.roll  ?? 0) * 2.5 * dt;
    this.throttle = Math.max(0, Math.min(1, this.throttle + (input.throttle ?? 0) * dt));
    // Forward direction from euler
    const [pitch, yaw, roll] = this.euler;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw),   sy = Math.sin(yaw);
    const forward = [cp * sy, sp, cp * cy];
    const up      = [-Math.sin(roll) * cy + 0, Math.cos(roll) * cp, -Math.sin(roll) * sy + 0];
    // Speed along forward
    const speed = Math.sqrt(this.velocity[0]**2 + this.velocity[1]**2 + this.velocity[2]**2);
    // Thrust
    const thrust = this.maxThrust * this.throttle / this.mass;
    // Lift (∝ speed^2, wingArea, cos(pitch)) — simplified
    const liftMag = speed > this.stallSpeed ? this.liftCoef * this.wingArea * speed * speed * 0.001 : this.liftCoef * this.wingArea * speed * 0.3;
    // Drag (∝ speed^2)
    const dragMag = this.dragCoef * speed * speed * 0.01;
    // Apply forces
    for (let i = 0; i < 3; i++) {
      this.velocity[i] += forward[i] * thrust * dt;
      this.velocity[i] += up[i] * liftMag * dt;
      this.velocity[i] -= this.velocity[i] * dragMag * dt * 0.1;
    }
    // Gravity
    this.velocity[1] -= 9.8 * dt;
    // Integrate position
    for (let i = 0; i < 3; i++) this.position[i] += this.velocity[i] * dt;
    // Ground collision
    if (this.position[1] < 0) { this.position[1] = 0; this.velocity[1] = 0; }
    // Update mesh
    if (this.mesh) {
      this.mesh.position.set(this.position[0], this.position[1], this.position[2]);
      this.mesh.rotation.set(this.euler[0], this.euler[1], this.euler[2]);
    }
  }
  getAltitude() { return this.position[1]; }
  getAirspeed() { return Math.sqrt(this.velocity[0]**2 + this.velocity[1]**2 + this.velocity[2]**2); }
  isStalling() { return this.getAirspeed() < this.stallSpeed && this.position[1] > 10; }
}
if (typeof window !== "undefined") window.Aircraft = Aircraft;
