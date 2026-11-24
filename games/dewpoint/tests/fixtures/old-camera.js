// MUTATION FIXTURE - the follow camera as it was before 2026-11-23, verbatim in behaviour (extracted from the
// renderer's old _updateCamera / _updateFade). NOT used by the game. The camera tests run their checks against it
// to prove they fail on the bugs the new rig (src/render/camera.js) fixes: the f01 kiln jam (a side feeler that
// started inside the kiln hauled the camera to 1.4 m), the camera left inside walls, and strafing swinging the yaw.
import { isThinWall, segHitsBox } from '../../src/render/occlude.js';
// Camera framing
export const CAM = {
  dist: 7.6, distPortrait: 9.9, attractExtra: 1.5,
  pitch: 0.42, pitchPortrait: 0.5, pitchSteam: 0.3,
  pitchMin: -0.12, pitchMax: 1.2,
  minDist: 1.4,
  lead: 0.3, leadMax: 1.4, leadMaxPortrait: 1.9,   // look-ahead: seconds of velocity, metres cap
  squeezeLead: 0.7, squeezeTilt: 0.72,              // backed against a wall: slide framing forward, rise and look down
  fadeTo: 0.86, fadeIn: 5.5, fadeOut: 2.4,          // how much of a faded wall is cut away, and how fast it comes and goes (1/s)
};

export class OldRig {
  get controlYaw() { return this.yaw; }          // the old game read the stick against the live yaw
  set controlYaw(v) { /* (no such thing then) */ }
  orbit(dx, dy, sens = 1, inv = false) { const k = 0.0052 * sens; this.yaw -= dx * k; this.pitch = Math.max(CAM.pitchMin, Math.min(CAM.pitchMax, this.pitch + dy * k * (inv ? -1 : 1))); this.manualT = 0; }
  orbitRate() {}
  follow(p) { this.target.x = p.x; this.target.y = p.y + 0.9; this.target.z = p.z; this.look = { ...this.target }; this.lead = { x: 0, y: 0, z: 0 }; }
  constructor() {
    this.yaw = -Math.PI / 2; this.pitch = CAM.pitch; this.lift = 0; this.closeLift = 0; this.lookDrop = 0; this.dist = CAM.dist; this.curDist = CAM.dist;
    this.target = {x:0,y:0,z:0}; this.look = {x:0,y:0,z:0}; this.lead = {x:0,y:0,z:0}; this.pos = {x:0,y:0,z:0};
    this.manualT = 9; this.outHold = 0; this.celebrate = 0; this.squeeze = 0;
    this.mode = 'play'; this.portrait = false; this.reducedMotion = false; this.sim = null; this.thin = []; this.thinSet = new Set(); this.fades = new Map();
  }
  setLevel(sim) { this.sim = sim; this.thin = sim.solids.filter(isThinWall); this.thinSet = new Set(this.thin); this.fades.clear(); this.yaw = sim.level.camYaw * Math.PI / 180; this.pitch = this.defaultPitch(); this.lift = 0; this.closeLift = 0; this.celebrate = 0; }
  snap(p) { this.target.x = p.x; this.target.y = p.y + 0.9; this.target.z = p.z; this.look = {...this.target}; this.lead = {x:0,y:0,z:0}; this.curDist = this.wantDist(); this.manualT = 9; this.outHold = 0; this.squeeze = 0;
    const cp = Math.cos(this.pitch); this.pos = { x: this.target.x + Math.sin(this.yaw)*cp*this.curDist, y: this.target.y + Math.sin(this.pitch)*this.curDist, z: this.target.z + Math.cos(this.yaw)*cp*this.curDist }; }
  wantDist() { return (this.portrait ? CAM.distPortrait : CAM.dist) + (this.mode === 'attract' ? CAM.attractExtra : 0); }
  defaultPitch(form) { const F = form && this.sim ? this.sim.F[form] : null; return F && F.move === 'float' ? CAM.pitchSteam : (this.portrait ? CAM.pitchPortrait : CAM.pitch); }
  update(dt, moveX, m) {
    const c = this, sim = this.sim, p = sim.player;
    THIN = this.mode === 'play' && !sim.completed ? this.thinSet : NO_WALLS;   // thin walls only fade while playing; menus and the finish orbit treat them as walls
    const rm = this.reducedMotion;
    c.manualT += dt;
    if (this.mode === 'attract') {
      c.yaw += dt * 0.07;
      c.pitch += (0.2 - c.pitch) * Math.min(1, dt);
    } else if (sim.completed) {
      // level complete: settle into a slow, low orbit round Mote and the glowing kiln door
      c.celebrate = Math.min(1, c.celebrate + dt * 0.8);
      if (!rm) c.yaw += dt * 0.22 * c.celebrate;
      c.pitch += (0.3 - c.pitch) * Math.min(1, dt * 1.2);
    } else {
      // gentle auto-recentre: strafing swings the camera behind the direction of travel
      const sp = Math.hypot(p.vx, p.vz);
      if (c.manualT > 0.8 && sp > 0.5 && Math.abs(moveX) > 0.05) {
        c.yaw -= moveX * Math.min(1, sp / 4) * (rm ? 0.35 : 0.85) * dt;
      }
      if (c.manualT > 3) c.pitch += (this.defaultPitch(p.form) - c.pitch) * Math.min(1, dt * 0.6);
    }

    // How squeezed is the camera? Measured from Mote itself (not from the camera target, which
    // the answer moves), straight back along the view at the un-squeezed pitch.
    let want = this.wantDist();
    if (sim.completed && this.mode === 'play') want *= 1 - 0.22 * c.celebrate;
    let squeeze = 0;
    if (this.mode === 'play' && !sim.completed) {
      const bp = Math.min(1.35, c.pitch + c.lift), bq = Math.cos(bp);
      const freeM = sim.raycast(m.x, m.y + 0.9, m.z, Math.sin(c.yaw) * bq, Math.sin(bp), Math.cos(c.yaw) * bq, want + 0.4, camBlocks);
      squeeze = Math.max(0, Math.min(1, (want - freeM + 0.3) / (want - CAM.minDist)));
    }
    c.squeeze += (squeeze - c.squeeze) * Math.min(1, dt * 2.5);

    // look-ahead: lead the framing a little in the direction of travel (so more of the path ahead
    // is on screen), never into a wall. Backed against a wall, the framing also slides forward
    // (away from the wall), which gives the camera room to sit back and look down over Mote
    // instead of pressing up against its back.
    const leadMax = (this.portrait ? CAM.leadMaxPortrait : CAM.leadMax) * (rm ? 0.6 : 1);
    let lx = 0, lz = 0;
    if (this.mode === 'play' && !sim.completed) {
      lx = p.vx * CAM.lead; lz = p.vz * CAM.lead;
      const ll = Math.hypot(lx, lz);
      if (ll > leadMax) { lx *= leadMax / ll; lz *= leadMax / ll; }
      const push = c.squeeze * CAM.squeezeLead;
      lx -= Math.sin(c.yaw) * push; lz -= Math.cos(c.yaw) * push;
      const l2 = Math.hypot(lx, lz);
      if (l2 > 0.05) {
        const free = sim.raycast(m.x, m.y + 0.9, m.z, lx / l2, 0, lz / l2, l2 + 0.4, camBlocks) - 0.4;
        if (free < l2) { const k = Math.max(0, free) / l2; lx *= k; lz *= k; }
      }
    }
    const kl = Math.min(1, dt * (rm ? 1.2 : 2.0));
    c.lead.x += (lx - c.lead.x) * kl; c.lead.z += (lz - c.lead.z) * kl;

    // target follows Mote with a little lag; vertical lag is softer so jumps do not shake the view
    const _v = { x: m.x + c.lead.x, y: m.y + 0.9, z: m.z + c.lead.z };
    const kxz = Math.min(1, dt * 10), ky = Math.min(1, dt * (p.grounded ? 8 : 4.5));
    c.target.x += (_v.x - c.target.x) * kxz; c.target.z += (_v.z - c.target.z) * kxz;
    c.target.y += (_v.y - c.target.y) * ky;
    if ((c.target.x-_v.x)**2+(c.target.y-_v.y)**2+(c.target.z-_v.z)**2 > 400) { c.target.x=_v.x; c.target.y=_v.y; c.target.z=_v.z; }

    // Film under a low wall: the point the camera orbits is inside that wall. Let the camera
    // ignore solids that contain it (Mote's see-through silhouette keeps it readable) instead of
    // slamming in to arm's length.
    SKIP.clear();
    for (const s of sim.solids) {
      if (s.active && c.target.x > s.x0 && c.target.x < s.x1 && c.target.y > s.y0 && c.target.y < s.y1 && c.target.z > s.z0 && c.target.z < s.z1 && !(s.kind === 'ramp' && aboveSlope(s, c.target))) SKIP.add(s);
    }
    const cast = (pitch, ox = 0, oz = 0, len = want + 0.4) => {
      const cq = Math.cos(pitch);
      return sim.raycast(c.target.x + ox, c.target.y, c.target.z + oz, Math.sin(c.yaw) * cq, Math.sin(pitch), Math.cos(c.yaw) * cq, len, camBlocks);
    };
    // A low wall between the camera and Mote hides the body even though the line to its head is
    // clear. Tilt the view up over the obstacle until Mote's feet are visible, and relax after.
    if (this.mode === 'play' && SKIP.size === 0) {
      const feetY = m.y + 0.2;
      const blocked = (lift) => {
        const pt = Math.min(1.35, c.pitch + lift + c.closeLift), cq = Math.cos(pt);
        const px = c.target.x + Math.sin(c.yaw) * cq * c.curDist, py = c.target.y + Math.sin(pt) * c.curDist, pz = c.target.z + Math.cos(c.yaw) * cq * c.curDist;
        const dx = px - m.x, dy = py - feetY, dz = pz - m.z, len = Math.hypot(dx, dy, dz);
        return sim.raycast(m.x, feetY, m.z, dx / len, dy / len, dz / len, len, camBlocks) < len - 0.05;
      };
      if (blocked(c.lift)) c.lift = Math.min(0.75, c.lift + dt * 1.8);
      else if (c.lift > 0 && !blocked(Math.max(0, c.lift - 0.1))) c.lift = Math.max(0, c.lift - dt * 0.7);
    } else if (this.mode !== 'play') { c.lift = 0; }
    // Squeezed by a wall behind: rise and look down on Mote rather than at its back.
    c.closeLift += ((this.mode === 'play' ? CAM.squeezeTilt * c.squeeze : 0) - c.closeLift) * Math.min(1, dt * 1.6);

    // desired offset, then keep the camera out of level geometry
    const pitch = Math.max(CAM.pitchMin, Math.min(1.35, c.pitch + c.lift + c.closeLift));
    const cp = Math.cos(pitch), ox = Math.sin(c.yaw) * cp, oy = Math.sin(pitch), oz = Math.cos(c.yaw) * cp;
    const centre = cast(pitch);
    // a ray aimed a little lower: a wall that would fill the bottom of the picture pulls the camera
    // in front of it instead of letting it peek over the top
    const low = cast(pitch - 0.14);
    // feelers either side stop the view clipping a wall edge; they only nudge, they do not yank
    const sx = Math.cos(c.yaw) * 0.32, sz = -Math.sin(c.yaw) * 0.32;
    const side = Math.min(cast(pitch, sx, sz), cast(pitch, -sx, -sz));
    const allowed = Math.max(CAM.minDist, Math.min(want, centre - 0.3, low - 0.25, side + 0.15));
    const hard = Math.max(CAM.minDist * 0.8, centre - 0.12);   // never inside a wall, whatever the easing says
    if (allowed < c.curDist - 0.01) {
      c.outHold = 0.35;
      c.curDist += (allowed - c.curDist) * Math.min(1, dt * 9);
    } else {
      // wait a moment before easing back out, so walking past a gap or a pillar does not pump
      c.outHold -= dt;
      if (c.outHold <= 0) c.curDist += (allowed - c.curDist) * Math.min(1, dt * 1.7);
    }
    // Geometry suddenly between camera and target (falling past a ledge, a door closing):
    // close the gap fast but over a few frames, so it reads as a quick move, not a cut. Only
    // when it is right on top of the target does it snap.
    if (c.curDist > hard) c.curDist = hard < 0.7 ? hard : c.curDist + (hard - c.curDist) * Math.min(1, dt * 22);
    c.pos.x = c.target.x + ox * c.curDist; c.pos.y = c.target.y + oy * c.curDist; c.pos.z = c.target.z + oz * c.curDist;
    const kk = Math.min(1, dt * 14); c.look.x += (c.target.x - c.look.x) * kk; c.look.y += (c.target.y - c.look.y) * kk; c.look.z += (c.target.z - c.look.z) * kk;
    this._updateFade(dt, m);
    // behind the title menu, slide the picture up so Mote sits in the clear upper part of the screen;
    // in portrait play, slide it down a touch so more of the way ahead is in view
    const drop = this.mode === 'attract' ? (this.portrait ? 0.3 : 0.24) : (this.portrait && !sim.completed ? -0.07 : 0);
    c.lookDrop += (drop - c.lookDrop) * Math.min(1, dt * 3);
  }

  /**
   * Occluder fading. Thin walls between the camera and Mote (the camera ignores them, see camBlocks)
   * are cut away in a soft tube round the line of sight, so the camera can keep its distance instead
   * of pressing against the wall behind Mote. Thick geometry still pulls the camera in as before.
   * A wall comes in over ~0.2 s and leaves over ~0.4 s, and only walls actually on the line are
   * touched, so a wall that hides something from the side stays solid: nothing is revealed that
   * Mote itself could not already see.
   */
  _updateFade(dt, m0) {
    const f = this.fades;
    const want = new Set();
    if (this.mode === 'play' && !this.sim.completed && this.thin.length) {
      const P = this.pos, m = m0;
      // sight lines to Mote's feet, middle and head, and to either side of its body
      const vx = P.x - m.x, vz = P.z - m.z, vl = Math.hypot(vx, vz) || 1, lx = -vz / vl * 0.35, lz = vx / vl * 0.35;
      for (const s of this.thin) {
        if (!s.active) continue;
        if (segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.15, m.z) || segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.55, m.z) || segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.95, m.z)
          || segHitsBox(s, P.x, P.y, P.z, m.x + lx, m.y + 0.55, m.z + lz) || segHitsBox(s, P.x, P.y, P.z, m.x - lx, m.y + 0.55, m.z - lz)) want.add(s);
      }
    }
    for (const s of want) { let e = f.get(s); if (!e) { e = { a: 0, goal: 0 }; f.set(s, e); } e.goal = CAM.fadeTo; }
    for (const [s, e] of f) {
      if (!want.has(s)) e.goal = 0;
      const d = e.goal - e.a;
      e.a += Math.sign(d) * Math.min(Math.abs(d), dt * (d > 0 ? CAM.fadeIn : CAM.fadeOut));
      if (e.goal === 0 && e.a < 0.004) f.delete(s);
    }
  }
}
const SKIP = new Set();
const NO_WALLS = new Set();
let THIN = NO_WALLS;       // walls that fade instead of blocking the camera (while playing)


/** Is point p above the sloped surface of a ramp solid (inside its box, but in the open air)? */
function aboveSlope(s, p) {
  let u;
  switch (s.up) {
    case '+x': u = (p.x - s.x0) / (s.x1 - s.x0); break;
    case '-x': u = (s.x1 - p.x) / (s.x1 - s.x0); break;
    case '+z': u = (p.z - s.z0) / (s.z1 - s.z0); break;
    default: u = (s.z1 - p.z) / (s.z1 - s.z0);
  }
  return p.y > s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, u));
}

export function camBlocks(s) {
  if (SKIP.has(s) || THIN.has(s)) return false;    // walls in THIN fade away instead (_updateFade)
  // thin or see-through things should not yank the camera around (a grate still counts as a
  // wall, otherwise the camera stays behind and watches Mote through the bars)
  if (s.oneWay) return false;
  const t = s.owner && s.owner.type;
  if (t === 'prop') return s.owner.kind === 'kiln' || s.owner.kind === 'chimney' || s.owner.kind === 'shelf';
  return t !== 'pane' && t !== 'crate' && t !== 'plate' && t !== 'slot';
}
