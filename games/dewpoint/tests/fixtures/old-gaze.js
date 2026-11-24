// MUTATION FIXTURE - HeroView._gaze as it was in the v2 snapshot, before the facing fix: moving toward or across
// the view the face turned only a capped three-quarter of the way, moving away it looked back over its shoulder
// at the camera, and standing still it swung round to the camera. Players read that as the hero facing the wrong
// way. NOT used by the game: tests/play/play.js installs it (&mutate=gaze) to prove the facing suite catches it.

const TURN = 0.55, AWAY = 0.6, IDLE_LOOK = 0.6;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function oldGaze(sim, dt, x, y, z, sp, camAz) {
  const p = sim.player, rm = this.reduced;
  let target = p.facing, ty = 0, rel;
  if (sp > 0.6 || !p.grounded) {
    this.idleT = 0; this.gazeMode = 'travel';
    const r = wrap(p.facing - camAz), a = Math.abs(r);
    if (a < 1.9) {
      this.gazeSide = r >= 0 ? 1 : -1;
      rel = this.gazeSide * TURN * Math.tanh(a / TURN);
      this.glance = 0; this.glanceT = Math.max(this.glanceT, 1.2);
    } else {
      rel = this.gazeSide * AWAY;
      if (!rm) {
        this.glanceT -= dt;
        if (this.glance > 0) { this.glance -= dt; rel = this.gazeSide * 0.1; target = camAz; }
        else if (this.glanceT <= 0) { this.glance = 0.75; this.glanceT = 2.2 + this.particles.rnd() * 2.2; }
      }
    }
  } else {
    this.idleT += dt; this.gazeT -= dt;
    if (this.idleT > 0.25 && this.gazeT <= 0) {
      const thing = this._interest(sim, x, y, z);
      if (this.gazeMode !== 'camera') { this.gazeMode = 'camera'; this.gazeT = 1.6 + this.particles.rnd() * 1.8; }
      else if (thing) { this.gazeMode = 'thing'; this.gazeThing = thing; this.gazeT = 1.2 + this.particles.rnd(); }
      else { this.gazeMode = 'around'; this.gazeAround = camAz + (this.particles.rnd() < 0.5 ? -0.9 : 0.9); this.gazeT = 0.9; }
    }
    if (this.gazeMode === 'camera') target = camAz;
    else if (this.gazeMode === 'thing' && this.gazeThing) { const t = this.gazeThing; target = Math.atan2(t[0] - x, t[2] - z); ty = Math.max(-1, Math.min(1, (t[1] - y - 0.4) / Math.max(1, Math.hypot(t[0] - x, t[2] - z)))); }
    else if (this.gazeMode === 'around') target = this.gazeAround;
  }
  if (sim.completed) target = camAz;
  if (rel === undefined || sim.completed) {
    rel = wrap(target - camAz);
    if (Math.abs(rel) > 2.7) rel = this.gazeSide * Math.abs(rel); else this.gazeSide = rel >= 0 ? 1 : -1;
    rel = Math.max(-IDLE_LOOK, Math.min(IDLE_LOOK, rel));
  }
  const clamped = camAz + rel;
  const k = Math.min(1, dt * (this.gazeMode === 'travel' ? 8 : 6));
  this.eyeYaw += wrap(clamped - this.eyeYaw) * k;
  const rest = wrap(target - this.eyeYaw);
  const px = Math.max(-0.32, Math.min(0.32, rest * 0.3)), py = Math.max(-0.28, Math.min(0.3, ty * 0.3 + Math.max(-1, Math.min(1, p.vy * 0.08)) * 0.2));
  this.pupil.x += (px - this.pupil.x) * Math.min(1, dt * 14);
  this.pupil.y += (py - this.pupil.y) * Math.min(1, dt * 14);
}
