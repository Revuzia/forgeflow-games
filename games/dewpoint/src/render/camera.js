// The follow camera's rig: where the camera sits and what it looks at, every frame, and which walls are
// cut away. Pure maths over the sim's solids - no three.js, no DOM - so the very code the game runs is
// also run in Node by tests/camera.test.js, on every level, along its scripted route and walked into
// every big prop and wall.
//
// How it frames the hero (DESIGN.md "Camera"):
//   - It follows a point just above the hero, a little ahead of where it is going, from `want` metres
//     back (7.6 m; 9.9 m on a portrait phone) at the pitch the player chose.
//   - Thin walls between the camera and the hero are cut away (a soft window, geo.js FADE) so the
//     camera keeps its distance; thick geometry pulls the camera in - but NEVER closer than
//     CAM.minDist (3 m). A third-person camera that ends up at arm's length shows nothing but the hero.
//   - When the way back is blocked closer than that, the camera RISES over the obstacle (the
//     smallest extra pitch that gives a clear view from at least minDist), and comes back down only
//     when the way is clear all the way down. A kiln, a shelf, a wall at the hero's back: the camera
//     looks over it.
//   - When even rising does not clear it (a tall cliff at the hero's back, a low roof), the camera
//     stays at minDist in open air and whatever thick thing stands between it and the hero is cut
//     away like a thin wall.
//   - Only the player turns the camera (a drag, the right stick). There is no automatic recentre: the
//     stick is camera-relative, and the yaw it is read against (controlYaw) moves only when the player
//     orbits. (The old rig swung the yaw while strafing and read the stick against the swinging yaw: a
//     held D walked the hero in a circle - 48 degrees a second - and keyboard routes that are exact with
//     a still camera fell apart with the real one.) When the camera has to swing round a wall to find a
//     place to stand, that swing is a small offset of the PICTURE (yawOff, at most 35 degrees, easing
//     back when no longer needed) - the controls stay where the player put them.
//   - It is never inside geometry: the point it sits at is checked every frame against every solid
//     (with room for the near plane), and if it ever would be, it is pulled in front of the wall
//     at once - in practice this only happens in a space too tight to stand back in at all.
// The old rig (before 2026-11-23) let a side "feeler" ray that started inside a prop the hero was
// touching (the f01 kiln) haul the camera to 1.4 m, and its floor distance could leave the camera
// inside a wall the hero was backed against.

import { isThinWall, segHitsBox } from './occlude.js';
import { raycast } from '../sim/collide.js';

export const CAM = {
  dist: 7.6, distPortrait: 9.9, attractExtra: 1.5,
  pitch: 0.42, pitchPortrait: 0.5, pitchSteam: 0.3,
  pitchMin: -0.12, pitchMax: 1.2,
  minDist: 3.0,                                     // the camera never comes closer to the hero's middle than this (but see "never inside geometry")
  topPitch: 1.3,                                    // the highest the camera rises to see over something (75 degrees)
  riseRate: 2.6, sinkRate: 0.75, sinkHold: 0.45,    // how fast it rises over an obstacle and settles back (rad/s), and the wait before settling
  clearance: 0.22,                                  // the camera's point stays this far outside every solid (the near plane is 0.15 m)
  lead: 0.3, leadMax: 1.4, leadMaxPortrait: 1.9,    // look-ahead: seconds of velocity, metres cap
  squeezeLead: 0.7, squeezeTilt: 0.72,              // backed against a wall: slide framing forward, rise and look down
  yawOffMax: 0.6, yawOffBack: 0.5, yawOffHold: 0.6,  // the picture's own swing round an obstacle: most (rad), easing back (rad/s), the wait first (s)
  steerResync: 0.14,                                // a held direction is "the same" while it stays within this (radians, ~8 degrees)
  fadeTo: 0.86, fadeIn: 8, fadeOut: 2.4,            // how much of a faded wall is cut away, and how fast it comes and goes (1/s)
};
const LIFT_STEP = 0.08;                             // the rise is searched in steps of this many radians

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  constructor() {
    this.yaw = -Math.PI / 2; this.pitch = CAM.pitch; this.lift = 0; this.closeLift = 0; this.lookDrop = 0;
    this.dist = CAM.dist; this.curDist = CAM.dist;
    this.target = v3(); this.look = v3(); this.lead = v3(); this.pos = v3();
    this.manualT = 9; this.outHold = 0; this.celebrate = 0; this.squeeze = 0; this.sinkT = 0;
    this.controlYaw = this.yaw;                      // the yaw the stick is read against (see steer)
    this.yawOff = 0; this.yawOffT = 0;               // how far the picture is swung round an obstacle (not the controls), and since when
    this.hold = null;                                // the camera-space direction being held, { x, y } unit, or null
    this.cut = false;                                // looking through something thick (it is being cut away)
    this.mode = 'play'; this.portrait = false; this.reducedMotion = false;
    this.sim = null;
    this.thin = []; this.thinSet = new Set(); this.fades = new Map();
    this.near = { solids: [] };                      // the solids round the camera this frame (raycasts only look at these)
  }

  setLevel(sim) {
    this.sim = sim;
    this.thin = sim.solids.filter(isThinWall);
    this.thinSet = new Set(this.thin);
    this.fades.clear();
    this.yaw = sim.level.camYaw * Math.PI / 180; this.controlYaw = this.yaw; this.hold = null; this.yawOff = 0;
    this.pitch = this.defaultPitch(); this.lift = 0; this.closeLift = 0; this.celebrate = 0; this.cut = false;
  }

  /** Jump straight to the hero (level start, teleport): no easing in from wherever the camera was. */
  snap(hero) {
    const p = hero || this.sim.player;
    this.target.x = p.x; this.target.y = p.y + 0.9; this.target.z = p.z;
    this.look.x = this.target.x; this.look.y = this.target.y; this.look.z = this.target.z;
    this.lead.x = this.lead.y = this.lead.z = 0;
    this.curDist = this.wantDist();
    this.manualT = 9; this.outHold = 0; this.squeeze = 0; this.lift = 0; this.closeLift = 0; this.sinkT = 0; this.yawOff = 0;
    if (this.sim) this._place(1, 0, p, true);
  }

  /** After a respawn: follow quickly rather than cutting (keeps orientation, avoids a long pan). */
  follow(p) {
    this.target.x = p.x; this.target.y = p.y + 0.9; this.target.z = p.z;
    this.look.x = this.target.x; this.look.y = this.target.y; this.look.z = this.target.z;
    this.lead.x = this.lead.y = this.lead.z = 0;
  }

  /**
   * The camera-space stick for this frame (x right, y forward; keys, touch stick and pad merged), BEFORE the
   * sim reads it. A new direction (or none) re-reads the camera's yaw; the same direction held keeps the
   * yaw it was pressed against, so whatever the camera does meanwhile, the hero keeps going straight.
   */
  steer(x, y) {
    const l = Math.hypot(x, y);
    if (l < 0.05) { this.hold = null; this.controlYaw = this.yaw; return; }
    const ux = x / l, uy = y / l;
    if (!this.hold || Math.acos(Math.max(-1, Math.min(1, ux * this.hold.x + uy * this.hold.y))) > CAM.steerResync) {
      this.hold = { x: ux, y: uy }; this.controlYaw = this.yaw;
    }
  }

  orbit(dxPx, dyPx, sensitivity = 1, invertY = false) {
    const k = 0.0052 * sensitivity;
    this.yaw -= dxPx * k; this.controlYaw = this.yaw;     // dragging the camera turns the controls with it
    this.pitch += dyPx * k * (invertY ? -1 : 1);
    this.pitch = Math.max(CAM.pitchMin, Math.min(CAM.pitchMax, this.pitch));
    this.manualT = 0;
  }

  orbitRate(rx, ry, dt, sensitivity = 1, invertY = false) {
    if (Math.abs(rx) < 0.01 && Math.abs(ry) < 0.01) return;
    this.yaw -= rx * 2.4 * dt * sensitivity; this.controlYaw = this.yaw;
    this.pitch += ry * 1.6 * dt * sensitivity * (invertY ? -1 : 1);
    this.pitch = Math.max(CAM.pitchMin, Math.min(CAM.pitchMax, this.pitch));
    this.manualT = 0;
  }

  wantDist() { return (this.portrait ? CAM.distPortrait : CAM.dist) + (this.mode === 'attract' ? CAM.attractExtra : 0); }
  defaultPitch(form) {
    const F = form && this.sim ? this.sim.F[form] : null;
    return F && F.move === 'float' ? CAM.pitchSteam : (this.portrait ? CAM.pitchPortrait : CAM.pitch);
  }

  /** One frame. m = the hero's drawn position {x,y,z}. (The stick reaches the rig through steer(), before the sim steps.) */
  update(dt, moveX, m) {
    const c = this, sim = this.sim, p = sim.player;
    const playing = this.mode === 'play' && !sim.completed;
    THIN = playing ? this.thinSet : NO_WALLS;
    const rm = this.reducedMotion;
    c.manualT += dt;
    if (this.mode === 'attract') {
      c.yaw += dt * 0.07;
      c.pitch += (0.2 - c.pitch) * Math.min(1, dt);
    } else if (sim.completed) {
      // level complete: settle into a slow, low orbit round the hero and the exit
      c.celebrate = Math.min(1, c.celebrate + dt * 0.8);
      if (!rm) c.yaw += dt * 0.22 * c.celebrate;
      c.pitch += (0.3 - c.pitch) * Math.min(1, dt * 1.2);
    } else {
      if (c.manualT > 3) c.pitch += (this.defaultPitch(p.form) - c.pitch) * Math.min(1, dt * 0.6);
    }
    this._gather(m);
    // the picture's swing round an obstacle eases back once it has not been needed for a moment
    c.yawOffT += dt;
    if (c.yawOff && c.yawOffT > CAM.yawOffHold) c.yawOff -= Math.sign(c.yawOff) * Math.min(Math.abs(c.yawOff), dt * CAM.yawOffBack);
    if (this.mode !== 'play' || sim.completed) c.yawOff = 0;
    const Y = c.yaw + c.yawOff;

    // How squeezed is the camera? Measured from the hero itself (not from the camera target, which
    // the answer moves), straight back along the view at the un-squeezed pitch.
    let want = this.wantDist();
    if (sim.completed && this.mode === 'play') want *= 1 - 0.22 * c.celebrate;
    let squeeze = 0;
    if (playing) {
      const bp = Math.min(1.35, c.pitch + c.lift), bq = Math.cos(bp);
      const freeM = this._ray(m.x, m.y + 0.9, m.z, Math.sin(Y) * bq, Math.sin(bp), Math.cos(Y) * bq, want + 0.4, camBlocks);
      squeeze = Math.max(0, Math.min(1, (want - freeM + 0.3) / (want - CAM.minDist)));
    }
    c.squeeze += (squeeze - c.squeeze) * Math.min(1, dt * 2.5);

    // look-ahead: lead the framing a little in the direction of travel, never into a wall. Backed
    // against a wall, the framing also slides forward (away from the wall).
    const leadMax = (this.portrait ? CAM.leadMaxPortrait : CAM.leadMax) * (rm ? 0.6 : 1);
    let lx = 0, lz = 0;
    if (playing) {
      lx = p.vx * CAM.lead; lz = p.vz * CAM.lead;
      const ll = Math.hypot(lx, lz);
      if (ll > leadMax) { lx *= leadMax / ll; lz *= leadMax / ll; }
      const push = c.squeeze * CAM.squeezeLead;
      lx -= Math.sin(Y) * push; lz -= Math.cos(Y) * push;
      // risen to look down over something, the camera looks nearly straight down: a point far ahead
      // of the hero would put the hero off the bottom of the picture, so the lead shrinks as it rises
      const shrink = 1 / (1 + 2.2 * Math.max(0, c.closeLift));
      lx *= shrink; lz *= shrink;
      const l2 = Math.hypot(lx, lz);
      if (l2 > 0.05) {
        // (any wall stops it, thin ones too: the point the camera orbits must stay on the hero's side)
        const free = this._ray(m.x, m.y + 0.9, m.z, lx / l2, 0, lz / l2, l2 + 0.4, anyWall) - 0.4;
        if (free < l2) { const k = Math.max(0, free) / l2; lx *= k; lz *= k; }
      }
    }
    const kl = Math.min(1, dt * (rm ? 1.2 : 2.0));
    c.lead.x += (lx - c.lead.x) * kl; c.lead.z += (lz - c.lead.z) * kl;

    // the target follows the hero with a little lag; vertical lag is softer so jumps do not shake the view
    const vx = m.x + c.lead.x, vy = m.y + 0.9, vz = m.z + c.lead.z;
    const kxz = Math.min(1, dt * 10), ky = Math.min(1, dt * (p.grounded ? 8 : 4.5));
    c.target.x += (vx - c.target.x) * kxz; c.target.z += (vz - c.target.z) * kxz;
    c.target.y += (vy - c.target.y) * ky;
    if ((c.target.x - vx) ** 2 + (c.target.y - vy) ** 2 + (c.target.z - vz) ** 2 > 400) { c.target.x = vx; c.target.y = vy; c.target.z = vz; }

    this._place(dt, want, m, false);
    const kk = Math.min(1, dt * 14);
    c.look.x += (c.target.x - c.look.x) * kk; c.look.y += (c.target.y - c.look.y) * kk; c.look.z += (c.target.z - c.look.z) * kk;
    this.updateFade(dt, m);
    // behind the title menu the picture slides up (the hero sits in the clear upper part of the screen);
    // in portrait play, down a touch so more of the way ahead is in view (the renderer applies it)
    const drop = this.mode === 'attract' ? (this.portrait ? 0.3 : 0.24) : (this.portrait && !sim.completed ? -0.07 : 0);
    c.lookDrop += (drop - c.lookDrop) * Math.min(1, dt * 3);
  }

  /** The solids within reach of the camera this frame (the rays and the inside test look only at these). */
  _gather(m) {
    const out = this.near.solids; out.length = 0;
    // round the point the camera orbits (it lags the hero in a fall), far enough to take in the hero too
    const T = this.target, lag = Math.hypot(T.x - m.x, T.y - m.y - 0.9, T.z - m.z);
    const r = this.wantDist() + 2.5 + lag, cx = T.x, cy = T.y, cz = T.z;
    for (const s of this.sim.solids) {
      if (!s.active) continue;
      const dx = Math.max(s.x0 - cx, 0, cx - s.x1), dy = Math.max(s.y0 - cy, 0, cy - s.y1), dz = Math.max(s.z0 - cz, 0, cz - s.z1);
      if (dx * dx + dy * dy + dz * dz < r * r) out.push(s);
    }
  }
  _ray(ox, oy, oz, dx, dy, dz, len, filter) { return raycast(this.near, ox, oy, oz, dx, dy, dz, len, filter); }

  /** Is the camera point (x, y, z) in open air - at least CAM.clearance outside every solid? */
  _free(x, y, z) { return !this._blockerAt(x, y, z); }
  /** The solid the point (x, y, z) is in (or within CAM.clearance of), or null. */
  _blockerAt(x, y, z) {
    const e = CAM.clearance;
    let thin = null;
    for (const s of this.near.solids) {
      if (s.oneWay) continue;         // (a roof the hero is under counts too: the camera may look through it, never sit in it)
      if (x > s.x0 - e && x < s.x1 + e && y > s.y0 - e && y < s.y1 + e && z > s.z0 - e && z < s.z1 + e) {
        if (s.kind === 'ramp' && aboveSlope(s, { x, y: y - e, z })) continue;
        if (!this.thinSet.has(s)) return s;
        thin = s;
      }
    }
    return thin;
  }

  /**
   * Decide the rise (closeLift) and the distance (curDist), and put the camera there. Over `dt`
   * seconds both ease toward what is wanted; `instant` (a snap) goes straight there.
   */
  _place(dt, want, m, instant, depth = 0) {
    const c = this, sim = this.sim, T = c.target;
    if (!want) want = this.wantDist();
    const playing = this.mode === 'play' && !sim.completed;
    THIN = playing ? this.thinSet : NO_WALLS;
    if (instant) this._gather(m);

    // Film under a low wall: the point the camera orbits is inside that wall. The camera ignores
    // solids that contain it (the hero's see-through silhouette keeps it readable).
    SKIP.clear();
    for (const s of this.near.solids) {
      if (T.x > s.x0 && T.x < s.x1 && T.y > s.y0 && T.y < s.y1 && T.z > s.z0 && T.z < s.z1 && !(s.kind === 'ramp' && aboveSlope(s, T))) SKIP.add(s);
    }
    const Y = c.yaw + c.yawOff;                 // the picture's yaw: the player's, plus any swing round an obstacle
    const sy = Math.sin(Y), cy = Math.cos(Y);
    /** Swing the picture (never the controls) by `d` radians, within its limit. */
    const swing = (d) => { c.yawOff = Math.max(-CAM.yawOffMax, Math.min(CAM.yawOffMax, c.yawOff + d)); c.yawOffT = 0; };
    const cast = (pitch, ox = 0, oz = 0) => {
      const cq = Math.cos(pitch);
      return this._ray(T.x + ox, T.y, T.z + oz, sy * cq, Math.sin(pitch), cy * cq, want + 0.4, camBlocks);
    };
    // the side feelers start 0.32 m either side of the target; one that starts inside something (the
    // hero is pressed against a kiln) says nothing about the view, so it is not counted
    const fx = cy * 0.32, fz = -sy * 0.32;
    const feelers = [];
    for (const k of [1, -1]) if (!this._insideBlocker(T.x + fx * k, T.y, T.z + fz * k)) feelers.push(k);
    const pointAt = (pitch, d) => { const cq = Math.cos(pitch); return [T.x + sy * cq * d, T.y + Math.sin(pitch) * d, T.z + cy * cq * d]; };
    // how far back the camera can sit at this pitch with a clear view (rays against thick things only)
    const clearDist = (pitch) => {
      let side = Infinity;
      for (const k of feelers) side = Math.min(side, cast(pitch, fx * k, fz * k));
      return Math.min(want, cast(pitch) - 0.3, cast(pitch - 0.14) - 0.25, side + 0.15);
    };

    // A low wall between the camera and the hero hides the body even though the line to its head is
    // clear. Tilt the view up over it until the feet are visible, and relax after.
    if (this.mode === 'play' && SKIP.size === 0 && !instant && depth === 0) {
      const feetY = m.y + 0.2;
      const blocked = (lift) => {
        const [px, py, pz] = pointAt(Math.min(1.35, c.pitch + lift + c.closeLift), c.curDist);
        const dx = px - m.x, dy = py - feetY, dz = pz - m.z, len = Math.hypot(dx, dy, dz);
        return this._ray(m.x, feetY, m.z, dx / len, dy / len, dz / len, len, camBlocks) < len - 0.05;
      };
      // (not while the camera is looking through something it cuts away - the feet show through the cut -
      // and never up into a roof: only while the point it would rise to is open air)
      const up = Math.min(0.75, c.lift + dt * 1.8), qa = pointAt(Math.min(1.35, c.pitch + up + c.closeLift), c.curDist);
      if (!c.cut && blocked(c.lift) && this._free(qa[0], qa[1], qa[2])) c.lift = up;
      else if (c.lift > 0 && (c.cut || !blocked(Math.max(0, c.lift - 0.1)))) c.lift = Math.max(0, c.lift - dt * 0.7);
    } else if (this.mode !== 'play') { c.lift = 0; }

    const base = Math.max(CAM.pitchMin, Math.min(CAM.topPitch, c.pitch + c.lift));
    const maxE = Math.max(0, CAM.topPitch - base);
    const minE = Math.min(0, CAM.pitchMin - base);      // the camera may also come down lower behind the hero (a ceiling over its head)
    // minDist is from the hero, not from the point the camera orbits: when the framing leads ahead of the hero
    // (away from the camera), the camera stands back that much further
    const ahead = Math.max(0, -(c.lead.x * sy + c.lead.z * cy)) * Math.cos(base);
    const minD = Math.min(CAM.minDist + ahead, want);
    // how far out along the view the camera point stays in open air without a break (up to `max`)
    // A thin wall on the way is fine - it is cut away - as long as the camera does not stop inside it, and can get
    // to the far side without passing through it (it is already there, or it is a snap).
    const P0 = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
    const reachable = (q) => instant || this._ray(P0.x, P0.y, P0.z, q[0] - P0.x, q[1] - P0.y, q[2] - P0.z, 1, solidWall) >= 1;
    const freeRun = (pitch, max) => {
      let last = 0, strict = -1;
      for (let d = 0.6; d <= max + 1e-6; d += 0.25) {
        const q = pointAt(pitch, d), b = this._blockerAt(q[0], q[1], q[2]);
        if (!b) last = d;
        else { if (strict < 0) strict = last; if (!playing || !this.thinSet.has(b)) break; }
      }
      if (last >= max - 0.25) { const q = pointAt(pitch, max); if (this._free(q[0], q[1], q[2])) last = max; }
      if (strict < 0 || last <= strict) return last;
      return reachable(pointAt(pitch, last)) ? last : strict;
    };
    // memo per frame: e (extra rise) -> distance with a clear view and the camera in open air, or 0
    const memo = new Map();
    const clearAt = (e) => {
      const key = Math.round(e * 1000);
      if (memo.has(key)) return memo.get(key);
      const pt = base + e;
      let d = clearDist(pt), ok = 0;
      if (d >= minD) {
        // rays only see thick things; the camera must not end up inside a pot, a crate or a thin wall either -
        // nor pass through one on its way out: open air all the way from the hero to where it stands
        d = Math.min(d, freeRun(pt, d));
        // and the camera must be able to get there from where it is without passing through anything (the hero
        // walked out from behind a block the camera is looking through: it stays out there, see cutAt)
        if (d >= minD && (instant || reachable(pointAt(pt, d)))) ok = d;
      }
      memo.set(key, ok);
      return ok;
    };
    // an open-air point at least minD back at this rise (the view to the hero may be blocked: it is cut away).
    // With `reach`, only one the camera can move to from where it is without passing through anything, and of
    // those the one nearest its present distance (the camera stays on its side of the wall and barely moves).
    const cutAt = (e, reach = false) => {
      const pt = base + e;
      let best = 0;
      for (let d = minD; d <= want + 1e-6; d += 0.5) {
        const q = pointAt(pt, d);
        if (!this._free(q[0], q[1], q[2])) continue;
        if (!reach) return d;
        if (this._ray(P0.x, P0.y, P0.z, q[0] - P0.x, q[1] - P0.y, q[2] - P0.z, 1, solidWall) < 1) continue;
        if (!best || Math.abs(d - c.curDist) < Math.abs(best - c.curDist)) best = d;
      }
      return best;
    };

    // --- the rise
    let goal = Math.max(minE, Math.min(maxE, c.closeLift)), dist = 0, cut = false, orbiting = depth > 0;
    const urgent = !clearAt(goal);
    this.why = 'clear';                                  // (which way the rig decided this frame: for tools and tests)
    if (!urgent) {
      // clear where it is: settle back toward the player's own pitch as far as stays clear all the way
      if (goal > 0) while (goal > 1e-6 && clearAt(Math.max(0, goal - LIFT_STEP))) goal = Math.max(0, goal - LIFT_STEP);
      else while (goal < -1e-6 && clearAt(Math.min(0, goal + LIFT_STEP))) goal = Math.min(0, goal + LIFT_STEP);
    } else {
      let found = null;
      // rising over it first (looking down over the hero reads best), then lower behind it
      for (let e = goal + LIFT_STEP; e <= maxE + 1e-6 && found === null; e += LIFT_STEP) if (clearAt(Math.min(e, maxE))) found = Math.min(e, maxE);
      for (let e = goal - LIFT_STEP; e >= minE - 1e-6 && found === null; e -= LIFT_STEP) if (clearAt(Math.max(minE, e))) found = Math.max(minE, e);
      if (found !== null) { goal = found; this.why = 'rise'; }
      else {
        // Nothing gives a clear view from minD. If there is an open-air point at least minD back that
        // the camera can get to from where it is without passing through anything (it is already on
        // that side: the hero walked behind a pillar), stay out there and cut away what is in between.
        // Choose the one nearest the current rise.
        let best = null, bestD = 0;
        if (playing) {
          for (let e = minE; e <= maxE + 1e-6; e += LIFT_STEP) {
            const ee = Math.min(e, maxE);
            if (best !== null && Math.abs(ee - goal) >= Math.abs(best - goal)) continue;
            const d = cutAt(ee, !instant);
            if (d) { best = ee; bestD = d; }
          }
        }
        if (best !== null) { goal = best; dist = bestD; cut = true; this.why = 'cut'; }
        else if (playing && !instant && depth === 0) {
          // No open-air spot at this yaw at all (a corner, the camera looking along a tall wall): orbit round
          // the obstacle to the nearest yaw that has one (quickly but not in a jump), and hold still meanwhile.
          let off = 0;
          for (const o of [0.12, -0.12, 0.25, -0.25, 0.4, -0.4, 0.6, -0.6, 0.9, -0.9]) if (Math.abs(c.yawOff + o) <= CAM.yawOffMax && this._probeYaw(Y + o, base, goal, minD, want, P0)) { off = o; break; }
          if (off) {
            this.why = 'orbit';
            swing(Math.max(-3 * dt, Math.min(3 * dt, off)));
            return this._place(dt, want, m, instant, 1);
          }
          // Nowhere to go from here without passing through something (the hero came out from under a tall
          // block the camera was looking through): CUT to where a snap would put the camera, rather than dive
          // in front of the wall at arm's length. A cut, deliberately - not a sweep through the wall.
          this.cuts = (this.cuts || 0) + 1;
          this._place(dt, want, m, true, 1);
          this.why = 'camera-cut';
          return;
        }
        if (best === null && !orbiting) {
          // A space too tight to stand back in (a kiln chamber with a roof, the camera turned toward
          // its closed end): rise to wherever there is the most room. Thick geometry pulls the camera in.
          this.why = orbiting ? 'orbit-hold' : 'room';
          let bestRoom = -1;
          for (let e = minE; e <= maxE + 1e-6; e += LIFT_STEP) {
            const ee = Math.min(e, maxE), room = clearDist(base + ee);
            if (room > bestRoom + 0.05) { bestRoom = room; goal = ee; }
          }
        }
      }
    }
    // Skimming along a wall (the view grazes it, so the camera can only stand close): if turning a little
    // gives a lot more room, orbit gently that way - never while the player is steering the camera.
    if (playing && !instant && depth === 0 && c.manualT > 1.5 && !cut) {
      const here = clearAt(goal) || 0;
      if (here < want * 0.75) {
        let bestO = 0, bestRoom = here + 1.5;
        for (const o of [0.15, -0.15, 0.3, -0.3]) { if (Math.abs(c.yawOff + o) > CAM.yawOffMax) continue; const r = this._room(Y + o, base + goal, want, minD); if (r > bestRoom) { bestRoom = r; bestO = o; } }
        if (bestO) swing(Math.sign(bestO) * Math.min(Math.abs(bestO), dt * 0.8));
      }
    }
    // backed toward a wall (but with room): rise a little anyway and look down over the hero rather than at its back
    const tilt = playing ? Math.min(maxE, CAM.squeezeTilt * c.squeeze) : 0;
    if (!cut && tilt > goal && clearAt(tilt)) goal = tilt;
    // ease the rise: quickly when the view is blocked where it is (or rising over something), gently, after a
    // moment, when it is only settling back
    const toward = (rate) => { c.closeLift += Math.max(-dt * rate, Math.min(dt * rate, goal - c.closeLift)); };
    if (instant) c.closeLift = goal;
    else if (urgent || (goal > c.closeLift && c.closeLift >= 0)) { toward(CAM.riseRate); c.sinkT = CAM.sinkHold; }
    else { c.sinkT -= dt; if (c.sinkT <= 0) toward(CAM.sinkRate); }

    // --- the distance, at the pitch the camera is actually at this frame
    const pitch = Math.max(CAM.pitchMin, Math.min(1.35, base + Math.max(minE, Math.min(maxE, c.closeLift))));
    const eNow = pitch - base;
    let allowed = clearAt(eNow);
    c.cut = false;
    if (!allowed) {
      // No clear view from minD at this pitch: the rise is still on its way to one, or there is none. Stay
      // where the camera is in open air - at the point chosen above, or the reachable one nearest its present
      // distance - and cut away what is between. Only when there is no such point at all (a space too tight to
      // stand back in) does it come in front of what is behind, with the most room there is.
      const d = (cut && Math.abs(eNow - goal) < 1e-6 && dist) ? dist : (playing ? cutAt(eNow, !instant) : 0);
      if (d) { allowed = d; c.cut = true; }
      else if (orbiting) { allowed = c.curDist; c.cut = playing; }      // swinging round: keep the distance (the open-air check below still applies)
      else allowed = Math.max(0.3, clearDist(pitch));
    }
    if (instant) c.curDist = allowed;
    else if (allowed < c.curDist - 0.01) {
      c.outHold = 0.35;
      c.curDist += (allowed - c.curDist) * Math.min(1, dt * 9);
    } else {
      // wait a moment before easing back out, so walking past a gap or a pillar does not pump
      c.outHold -= dt;
      if (c.outHold <= 0) c.curDist += (allowed - c.curDist) * Math.min(1, dt * 1.7);
    }
    // never inside geometry, whatever the easing says: if the point is not in open air, move to the nearest
    // point that is - nearer along the view, further back, or a little higher (a roof the camera is skimming
    // over, a door sliding into it). It is usually a nudge of centimetres, never a dive into a wall.
    let q = pointAt(pitch, c.curDist);
    if (!this._free(q[0], q[1], q[2])) {
      let best = null, bd = Infinity;
      // the nearest open-air point: a slight turn round the hero (the camera skimming a wall it runs alongside),
      // a little higher or lower, or nearer along the view - whichever moves the camera least
      const T2 = c.target, consider = (yw, pk, d) => {
        const cq = Math.cos(pk), r = [T2.x + Math.sin(yw) * cq * d, T2.y + Math.sin(pk) * d, T2.z + Math.cos(yw) * cq * d];
        const dd = (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2 + (r[2] - q[2]) ** 2;
        if (dd < bd && this._free(r[0], r[1], r[2])) { bd = dd; best = { yw, pk, d, r }; }
      };
      for (const o of [0.01, -0.01, 0.02, -0.02, 0.04, -0.04, 0.07, -0.07, 0.12, -0.12, 0.2, -0.2]) if (Math.abs(c.yawOff + o) <= CAM.yawOffMax) consider(Y + o, pitch, c.curDist);
      for (let k = -6; k <= 10; k++) if (k) consider(Y, Math.max(CAM.pitchMin, Math.min(1.35, pitch + k * 0.05)), c.curDist);
      for (let d = 0.3; d <= want + 1e-6; d += 0.1) consider(Y, pitch, d);
      if (!best) for (let k = -6; k <= 10; k++) for (let d = 0.3; d <= want + 1e-6; d += 0.1) consider(Y, Math.max(CAM.pitchMin, Math.min(1.35, pitch + k * 0.05)), d);
      // the only open air left is at arm's length (something moved into the camera, or the hero came out from
      // under something the camera was looking through): cut to a proper framing instead, if a snap finds one
      if ((!best || best.d < minD - 0.5) && playing && !instant && depth === 0) {
        const keep = { d: c.curDist, cl: c.closeLift, x: c.pos.x, y: c.pos.y, z: c.pos.z };
        this._place(dt, want, m, true, 1);
        if (Math.hypot(c.pos.x - m.x, c.pos.y - m.y - 0.45, c.pos.z - m.z) >= minD - 0.3) { this.cuts = (this.cuts || 0) + 1; this.why = 'camera-cut'; return; }
        c.curDist = keep.d; c.closeLift = keep.cl; c.pos.x = keep.x; c.pos.y = keep.y; c.pos.z = keep.z;
      }
      if (best) { c.curDist = best.d; c.closeLift += best.pk - pitch; if (best.yw !== Y) swing(best.yw - Y); q = best.r; }
    }
    c.pos.x = q[0]; c.pos.y = q[1]; c.pos.z = q[2];
  }

  /** How far back the camera could stand with a clear view, in open air, at this yaw and pitch (0: not even minD). */
  _room(yaw, pitch, want, minD) {
    const T = this.target, sy = Math.sin(yaw), cy = Math.cos(yaw), cq = Math.cos(pitch), sp = Math.sin(pitch);
    const ray = (ox, oz, p) => { const q2 = Math.cos(p); return this._ray(T.x + ox, T.y, T.z + oz, sy * q2, Math.sin(p), cy * q2, want + 0.4, camBlocks); };
    const fx = cy * 0.32, fz = -sy * 0.32;
    let side = Infinity;
    for (const k of [1, -1]) if (!this._insideBlocker(T.x + fx * k, T.y, T.z + fz * k)) side = Math.min(side, ray(fx * k, fz * k, pitch));
    const d = Math.min(want, ray(0, 0, pitch) - 0.3, ray(0, 0, pitch - 0.14) - 0.25, side + 0.15);
    let last = 0;
    for (let t = 0.6; t <= d + 1e-6; t += 0.25) {
      const b = this._blockerAt(T.x + sy * cq * t, T.y + sp * t, T.z + cy * cq * t);
      if (!b) last = t; else if (!this.thinSet.has(b)) break;
    }
    return last >= minD ? last : 0;
  }

  /** Is there an open-air point minD..want back at this yaw (at the current rise, level, or halfway up) that the camera can reach from P? */
  _probeYaw(yaw, base, goal, minD, want, P) {
    const T = this.target, sy = Math.sin(yaw), cy = Math.cos(yaw);
    for (const e of [goal, 0, (CAM.topPitch - base) / 2]) {
      const pt = base + e, cq = Math.cos(pt);
      for (let d = minD; d <= want + 1e-6; d += 0.5) {
        const x = T.x + sy * cq * d, y = T.y + Math.sin(pt) * d, z = T.z + cy * cq * d;
        if (this._free(x, y, z) && this._ray(P.x, P.y, P.z, x - P.x, y - P.y, z - P.z, 1, solidWall) >= 1) return true;
      }
    }
    return false;
  }

  /** Is (x, y, z) inside - or touching, within 5 cm - something the camera's rays treat as a wall? (A feeler that starts on a face says nothing either.) */
  _insideBlocker(x, y, z) {
    const e = 0.05;
    for (const s of this.near.solids) {
      if (!camBlocks(s)) continue;
      if (x > s.x0 - e && x < s.x1 + e && y > s.y0 - e && y < s.y1 + e && z > s.z0 - e && z < s.z1 + e && !(s.kind === 'ramp' && aboveSlope(s, { x, y, z }))) return true;
    }
    return false;
  }

  /**
   * Occluder fading. Walls between the camera and the hero are cut away in a soft tube round the line
   * of sight: every thin wall on any of five sight lines (feet, middle, head, either side), and thick
   * things that rise above its feet on the lines to its feet, middle and head - when the camera is
   * looking through them because there was no clear place to stand (see _place), or when they are the
   * roof of a low passage the hero is in. A wall comes
   * in over ~0.2 s and leaves over ~0.4 s, and only walls actually on the line are touched, so a wall
   * that hides something from the side stays solid.
   */
  updateFade(dt, m) {
    const f = this.fades;
    const want = new Set();
    if (this.mode === 'play' && !this.sim.completed) {
      const P = this.pos;
      const vx = P.x - m.x, vz = P.z - m.z, vl = Math.hypot(vx, vz) || 1, lx = -vz / vl * 0.35, lz = vx / vl * 0.35;
      for (const s of this.thin) {
        if (!s.active) continue;
        if (segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.15, m.z) || segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.55, m.z) || segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.95, m.z)
          || segHitsBox(s, P.x, P.y, P.z, m.x + lx, m.y + 0.55, m.z + lz) || segHitsBox(s, P.x, P.y, P.z, m.x - lx, m.y + 0.55, m.z - lz)) want.add(s);
      }
      // thick things on the line to the hero: when the camera is looking through them on purpose (cut), and
      // always the roof of a low passage the hero is under (the camera orbits a point inside it and ignores
      // it, so without the cut the player would see only the roof - f05's flue tunnel)
      for (const s of this.near.solids) {
        if (this.thinSet.has(s) || s.kind !== 'box' || s.oneWay || !(s.y1 > m.y + 0.1)) continue;
        if (!(SKIP.has(s) || (this.cut && camBlocks(s)))) continue;
        const t = s.owner && s.owner.type;
        if (t === 'pane' || t === 'crate' || t === 'plate' || s.pass) continue;
        if (segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.15, m.z) || segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.55, m.z) || segHitsBox(s, P.x, P.y, P.z, m.x, m.y + 0.95, m.z)) want.add(s);
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

/** Any solid wall at all (for paths the camera itself moves along, and for the point it orbits). */
function anyWall(s) { return !s.oneWay && !SKIP.has(s); }
/** Something the camera may not pass through on its way somewhere (a pane or a crate counts; a cut-away thin wall does too). */
function solidWall(s) { return !s.oneWay && !SKIP.has(s); }

/** Does a solid stop the camera (pull it in), rather than being ignored or cut away? */
export function camBlocks(s) {
  if (SKIP.has(s) || THIN.has(s)) return false;    // walls in THIN are cut away instead (updateFade)
  // thin or see-through things should not yank the camera around (a grate still counts as a
  // wall, otherwise the camera stays behind and watches the hero through the bars)
  if (s.oneWay) return false;
  const t = s.owner && s.owner.type;
  if (t === 'prop') return s.owner.kind === 'kiln' || s.owner.kind === 'chimney' || s.owner.kind === 'shelf';
  return t !== 'pane' && t !== 'crate' && t !== 'plate' && t !== 'slot';
}
