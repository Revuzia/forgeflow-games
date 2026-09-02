// runtime/hazards/launch.js
// CRESTBOUND — the two "you are cargo now" hazards (CONTRACT §21):
//
//   cannon — a barrel you climb into. Its trigger volume puts the hero into the `cannon` state;
//            the CONTROLLER owns the flight, and this hazard owns the aim: it publishes
//            `aim` (unit Vector3), `launchSpeed` (m/s) and `launchVelocity(out)`, plus the
//            ghost arc that shows where the shot lands. `fire(player)` pops the muzzle.
//   rings  — a chain of hoops. Passing them IN ORDER within `limitMs` emits `ringsDone` with
//            the trigger id (so a `secret` crest can hang off it, CONTRACT §22); every pass
//            emits `ringPass`, and a pass taken while the hero is in the `fly` state REFRESHES
//            the flight (the wing-power gauntlet in azure-3 is built on exactly this).
//
// DETERMINISM (CONTRACT §21): the cannon's aim, barrel pose and arc are closed-form in `def`
// and the course clock; the recoil is a pure function of `t - firedT`. `rings` tracks ordered
// progress, which is by definition a function of where the player has been — it is reset to
// pristine (nothing passed, every hoop dim) by `reset(t)`, and its per-ring visual state is a
// pure function of `t` and that progress.
//
// AIMING MATHS: the shot is integrated under CRESTBOUND's ASYMMETRIC gravity (§0: gravRise 34
// on the way up, gravFall 46 on the way down). Solving `target` therefore cannot use the
// textbook symmetric range formula — `solveSpeedForTarget` bisects the real trajectory.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { TUNE, headingFromYaw } from '../core/tuning.js';
import {
  Hazard, num, v3, sizeVec, dirVec, palette, hazMat, additiveMaterial, makeGlowSprite,
  bevelBox, mergeAll, makeCollider, makeVolume, buildEmitterGeometry,
  hazSfx, hazBurst, hazStinger, hazEvent, hazTrigger, hazRandom, qualityOf,
  resolvePlayer, hazShake,
} from './lasers.js';
// The world builders are authored by another slice; imported as a NAMESPACE so a missing
// export degrades into a local procedural fallback instead of a hard link error.
import * as builders from '../world/builders.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

/** A chamfered slab pre-translated into local space. */
function slab(w, h, d, x, y, z, bevel = 0.02, detail = 1) {
  const g = bevelBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), bevel, 1.7, detail);
  g.translate(x, y, z);
  return g;
}

/* ======================================================================================
   BALLISTICS (asymmetric gravity — CONTRACT §0)
   ====================================================================================== */

/**
 * Height above the launch point after `t` seconds, launching at vertical speed `vy` under
 * gravRise then gravFall. Closed form, no integration.
 */
export function ballisticY(vy, t) {
  const tr = Math.max(0, vy) / TUNE.gravRise;
  if (t <= tr) return vy * t - 0.5 * TUNE.gravRise * t * t;
  const apex = (vy * vy) / (2 * TUNE.gravRise);
  const td = t - tr;
  return apex - 0.5 * TUNE.gravFall * td * td;
}

/**
 * The launch SPEED (m/s along the aim) that lands a shot fired at `pitch` radians on a target
 * `range` metres away horizontally and `dy` metres up (+) or down (−).
 *
 * `y(v)` is monotonically increasing in `v` for a fixed range (a faster shot spends less time
 * falling), so a plain bisection converges reliably and deterministically. Returns NaN when
 * even the fastest legal shot cannot reach — the caller then falls back to `def.power`.
 */
export function solveSpeedForTarget(range, dy, pitch, vMax = 80) {
  const cosP = Math.cos(pitch);
  if (!(range > 0.05) || cosP < 1e-3) return NaN;
  const yAt = (v) => {
    const vx = v * cosP;
    if (vx < 1e-4) return -1e9;
    return ballisticY(v * Math.sin(pitch), range / vx);
  };
  let lo = 1, hi = vMax;
  if (yAt(hi) < dy) return NaN;                  // out of range at any legal speed
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    if (yAt(mid) < dy) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/* ======================================================================================
   CANNON
   ====================================================================================== */

class CannonHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'cannon');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);            // the BREECH (where the hero climbs in)
    this.radius = clamp(num(def.r, 0.85), 0.4, 3);
    this.barrelLen = clamp(num(def.len, this.radius * 4.2), 1.2, 14);

    // `yaw` follows the game-wide convention (§: yaw 0 faces −Z, +yaw turns CCW from above) and
    // is RADIANS unless `yawDeg` is authored. `pitch` is RADIANS above the horizon.
    this.yaw = def.yawDeg !== undefined ? num(def.yawDeg, 0) * Math.PI / 180 : num(def.yaw, 0);
    this.pitch = def.pitchDeg !== undefined
      ? num(def.pitchDeg, 45) * Math.PI / 180
      : clamp(num(def.pitch, Math.PI * 0.25), -1.35, 1.45);
    /** `power` is the launch SPEED in m/s along the aim (a `target` overrides it). */
    this.power = clamp(num(def.power, 22), 3, 70);

    this.target = def.target ? v3(def.target, 0, 0, 0).clone() : null;
    this._resolveAim();

    this.accent = new THREE.Color(pal.accent !== undefined ? pal.accent : 0x5ec8ff);
    this.hotColor = new THREE.Color(pal.killGlow !== undefined ? pal.killGlow : 0xff8a2b);

    /** Course-clock time of the last shot; null while cold. */
    this.firedT = null;
    /** The Player currently loaded, or null. The CONTROLLER owns the `cannon` state. */
    this.loaded = null;
    this._loadT = null;
    this.cooldown = Math.max(0.1, num(def.cooldown, 0.8));
    /** Seconds after loading before the cannon fires itself (0 = never; the player fires). */
    this.autoFire = Math.max(0, num(def.autoFire, 0));
    this._lastEnter = null;

    this._buildBarrel(q);
    this._buildArc();
    this._buildTrigger();
    this.reset(0);
  }

  /** Recompute `aim`, `launchSpeed` and `mouth` from yaw/pitch/power/target. */
  _resolveAim() {
    this.aim = this.aim || new THREE.Vector3();
    this.mouth = this.mouth || new THREE.Vector3();

    if (this.target) {
      _v.subVectors(this.target, this.center);
      _v2.set(_v.x, 0, _v.z);
      const range = _v2.length();
      if (range > 0.05) this.yaw = Math.atan2(-_v2.x, -_v2.z);   // §: yawFromHeading
      const solved = solveSpeedForTarget(range, _v.y, this.pitch);
      this.launchSpeed = Number.isFinite(solved) ? solved : this.power;
      this.targetReachable = Number.isFinite(solved);
    } else {
      this.launchSpeed = this.power;
      this.targetReachable = true;
    }

    headingFromYaw(this.yaw, _v);                 // ONE conversion, ONE place (core/util.js)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.aim.set(_v.x * cp, sp, _v.z * cp).normalize();
    // The muzzle sits one barrel length up the aim from the breech.
    this.mouth.copy(this.center).addScaledVector(this.aim, this.barrelLen);
    this.barrelQuat = this.barrelQuat || new THREE.Quaternion();
    this.barrelQuat.setFromUnitVectors(UPV, this.aim);
  }

  /** The velocity to hand the hero on firing. Allocation-free. */
  launchVelocity(out) {
    return (out || new THREE.Vector3()).copy(this.aim).multiplyScalar(this.launchSpeed);
  }

  _buildBarrel(q) {
    const R = this.radius, L = this.barrelLen;

    // ---- BREECH / CARRIAGE (static, sits at `p` and does not aim) --------------------------
    const baseParts = [];
    const plinth = new THREE.CylinderGeometry(R * 1.45, R * 1.75, R * 0.55, 20);
    plinth.translate(0, -R * 0.95, 0);
    baseParts.push(plinth);
    baseParts.push(slab(R * 3.4, R * 0.28, R * 3.4, 0, -R * 1.32, 0, R * 0.05));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(R * 0.09, R * 0.11, R * 0.20, 6);
      bolt.translate(Math.cos(a) * R * 1.42, -R * 1.30, Math.sin(a) * R * 1.42);
      baseParts.push(bolt);
    }
    // trunnion cheeks the barrel pivots between
    for (const s of [1, -1]) {
      const cheek = bevelBox(R * 0.42, R * 1.9, R * 1.5, R * 0.06, 1.7, 1);
      cheek.translate(0, -R * 0.35, s * R * 1.15);
      baseParts.push(cheek);
      const pin = new THREE.CylinderGeometry(R * 0.22, R * 0.22, R * 0.5, 12);
      pin.rotateX(Math.PI * 0.5);
      pin.translate(0, 0, s * R * 1.15);
      baseParts.push(pin);
    }
    // elevation quadrant (a toothed arc) — the mechanism that explains the pitch
    const quad = new THREE.TorusGeometry(R * 1.25, R * 0.10, 6, 22, Math.PI * 0.75);
    quad.rotateZ(-Math.PI * 0.2);
    quad.translate(0, -R * 0.2, R * 1.42);
    baseParts.push(quad);

    // The carriage is yawed with the barrel but never pitched — a real gun carriage.
    this.carriage = new THREE.Mesh(mergeAll(baseParts), hazMat(this.ctx, 'metal'));
    this.carriage.castShadow = true;
    this.carriage.receiveShadow = true;
    this.carriage.position.copy(this.center);
    this.carriage.quaternion.setFromAxisAngle(UPV, this.yaw);
    this.add(this.carriage);

    // ---- BARREL (aims) ------------------------------------------------------------------------
    this.barrelGroup = new THREE.Group();
    this.barrelGroup.position.copy(this.center);
    this.barrelGroup.quaternion.copy(this.barrelQuat);
    this.add(this.barrelGroup);

    const tubeParts = [];
    // A stepped, banded tube in three sections, not a single cylinder.
    tubeParts.push(new THREE.CylinderGeometry(R * 1.02, R * 1.16, L * 0.28, 22).translate(0, L * 0.14, 0));
    tubeParts.push(new THREE.CylinderGeometry(R * 0.92, R * 1.02, L * 0.36, 22).translate(0, L * 0.46, 0));
    tubeParts.push(new THREE.CylinderGeometry(R * 0.88, R * 0.92, L * 0.30, 22).translate(0, L * 0.79, 0));
    // reinforcing rings
    for (const u of [0.06, 0.28, 0.50, 0.72]) {
      const ring = new THREE.TorusGeometry(R * lerp(1.16, 0.92, u), R * 0.075, 6, 24);
      ring.rotateX(Math.PI * 0.5);
      ring.translate(0, L * u, 0);
      tubeParts.push(ring);
    }
    // flared muzzle + lip
    const flare = new THREE.CylinderGeometry(R * 1.10, R * 0.88, L * 0.10, 24, 1, true);
    flare.translate(0, L * 0.99, 0);
    tubeParts.push(flare);
    const lip = new THREE.TorusGeometry(R * 1.10, R * 0.065, 6, 26);
    lip.rotateX(Math.PI * 0.5);
    lip.translate(0, L * 1.04, 0);
    tubeParts.push(lip);
    // sight rail along the top of the tube
    for (let i = 0; i < 4; i++) {
      const post = slab(R * 0.09, R * 0.22, R * 0.09, 0, L * (0.24 + i * 0.22), R * 1.0, R * 0.02, 0.4);
      tubeParts.push(post);
    }

    this.barrel = new THREE.Mesh(mergeAll(tubeParts), hazMat(this.ctx, 'copper'));
    this.barrel.castShadow = true;
    this.barrel.receiveShadow = true;
    this.barrelGroup.add(this.barrel);

    // The emitter housing from the shared kit doubles as the breech block.
    const em = buildEmitterGeometry(R * 1.15, 0.7);
    if (em && em.housing) {
      this.breech = new THREE.Mesh(em.housing, hazMat(this.ctx, 'metal'));
      this.breech.castShadow = true;
      this.barrelGroup.add(this.breech);
      if (em.rotor) {
        this.breechRotor = new THREE.Mesh(em.rotor, hazMat(this.ctx, 'panel'));
        this.barrelGroup.add(this.breechRotor);
      }
      if (em.lens) em.lens.dispose();
    }

    // Bore glow: the read that says "this end is where you come out".
    const boreGeo = new THREE.CylinderGeometry(R * 0.84, R * 0.84, 0.02, 24);
    boreGeo.translate(0, L * 1.02, 0);
    this.boreMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.55 });
    this.own(this.boreMat);
    this.bore = new THREE.Mesh(boreGeo, this.boreMat);
    this.bore.renderOrder = 5;
    this.barrelGroup.add(this.bore);

    // A ring of chevrons around the breech mouth — the "step in here" invitation.
    const chevParts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const g = bevelBox(R * 0.14, R * 0.05, R * 0.34, R * 0.02, 1.7, 0.4);
      g.rotateY(-a);
      g.translate(Math.cos(a) * R * 1.22, -R * 0.55, Math.sin(a) * R * 1.22);
      chevParts.push(g);
    }
    this.collarMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.6 });
    this.own(this.collarMat);
    this.collar = new THREE.Mesh(mergeAll(chevParts), this.collarMat);
    this.collar.renderOrder = 5;
    this.collar.position.copy(this.center);
    this.collar.quaternion.setFromAxisAngle(UPV, this.yaw);
    this.add(this.collar);

    // muzzle flash sprite
    this.flash = makeGlowSprite(this.hotColor.getHex(), R * 5.0, 0, 2.2);
    this.own(this.flash.material);
    this.flash.position.copy(this.mouth);
    this.flash.renderOrder = 7;
    this.add(this.flash);

    // smoke ring that expands off the muzzle after a shot
    const ringGeo = new THREE.TorusGeometry(R * 1.0, R * 0.16, 6, 24);
    this.smokeMat = additiveMaterial(0xbfc7d4, { cached: false, opacity: 0, side: THREE.DoubleSide });
    this.own(this.smokeMat);
    this.smoke = new THREE.Mesh(ringGeo, this.smokeMat);
    this.smoke.renderOrder = 6;
    this.add(this.smoke);

    // ---- physics: the machine is solid, the bore is not ------------------------------------
    // One collider on the carriage (so you can stand on it and climb in from above) and one on
    // the barrel's mid-section (so it reads as a real obstacle rather than a hologram).
    this.colliders.push(makeCollider({
      center: _v.copy(this.center).setY(this.center.y - R * 0.95),
      half: _v2.set(R * 1.6, R * 0.55, R * 1.6),
      surface: 'normal', ref: this, group: 'hazard',
      props: { stepSfx: 'step_metal', stepRate: 1.0 },
    }));
    _v.copy(this.center).addScaledVector(this.aim, L * 0.5);
    this.barrelCollider = makeCollider({
      center: _v,
      half: _v2.set(R * 0.95, L * 0.5, R * 0.95),
      quat: this.barrelQuat,
      surface: 'nostick', ref: this, group: 'hazard',
      props: { stepSfx: 'step_metal', stepRate: 1.0 },
    });
    this.colliders.push(this.barrelCollider);
  }

  _buildArc() {
    // A ghost arc of the actual shot, drawn faintly when cold and brightly when loaded, so a
    // cannon is never a leap of faith. Deterministic: it is the closed-form trajectory.
    this.arcCount = 22;
    const geo = new THREE.OctahedronGeometry(0.10, 0);
    this.arcMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.22 });
    this.own(this.arcMat);
    this.arcMesh = new THREE.InstancedMesh(geo, this.arcMat, this.arcCount);
    this.arcMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arcMesh.frustumCulled = false;
    this.arcMesh.renderOrder = 5;
    this.add(this.arcMesh);

    // Impact marker at the landing point. Built BEFORE the first _writeArc(): that call parks
    // the marker on the solved landing point, so it has to exist by then.
    this.marker = makeGlowSprite(this.accent.getHex(), Math.max(1.2, this.radius * 2.0), 0.18, 2.8);
    this.own(this.marker.material);
    this.marker.renderOrder = 6;
    this.add(this.marker);

    this._writeArc();
  }

  /** Lay the ghost markers along the shot and park the impact marker where it lands. */
  _writeArc() {
    const vy = this.aim.y * this.launchSpeed;
    const hs = Math.hypot(this.aim.x, this.aim.z) * this.launchSpeed;
    // Flight time: to the target when one is authored, else until it falls 12 m below the muzzle.
    let total;
    if (this.target && this.targetReachable && hs > 1e-3) {
      _v.subVectors(this.target, this.center);
      total = Math.hypot(_v.x, _v.z) / hs;
    } else {
      const tr = Math.max(0, vy) / TUNE.gravRise;
      const apex = (vy * vy) / (2 * TUNE.gravRise);
      total = tr + Math.sqrt(2 * (apex + 12) / TUNE.gravFall);
    }
    this.flightTime = total;
    for (let i = 0; i < this.arcCount; i++) {
      const u = (i + 1) / (this.arcCount + 1);
      const tt = u * total;
      _v.set(
        this.center.x + this.aim.x * this.launchSpeed * tt,
        this.center.y + ballisticY(vy, tt),
        this.center.z + this.aim.z * this.launchSpeed * tt,
      );
      const fade = Math.sin(u * Math.PI) * 0.8 + 0.2;
      _s.setScalar(clamp(fade, 0.2, 1) * lerp(1.2, 0.55, u));
      _q.identity();
      _m.compose(_v, _q, _s);
      this.arcMesh.setMatrixAt(i, _m);
    }
    this.arcMesh.instanceMatrix.needsUpdate = true;
    this.landing = this.landing || new THREE.Vector3();
    this.landing.set(
      this.center.x + this.aim.x * this.launchSpeed * total,
      this.center.y + ballisticY(vy, total),
      this.center.z + this.aim.z * this.launchSpeed * total,
    );
    if (this.marker) this.marker.position.copy(this.landing);
  }

  _buildTrigger() {
    // A trigger Volume at the breech: entering it with interact / jump is what the controller
    // watches for to put the hero into the `cannon` state (CONTRACT §11).
    const R = this.radius;
    this.volume = makeVolume({
      center: _v.copy(this.center).setY(this.center.y + R * 0.2),
      half: _v2.set(R * 1.25, R * 1.5, R * 1.25),
      kind: 'trigger',
      ref: this,
      props: {
        id: this.def.id || 'cannon',
        cannon: true, hazard: this,
        aim: this.aim, speed: this.launchSpeed,
        mouth: this.mouth, landing: this.landing,
        enter: (player) => this.enter(player),
        fire: (player) => this.fire(player),
      },
    });
    this.volumes.push(this.volume);
  }

  /** Ready at course time `t` (out of cooldown and not already holding someone). */
  readyAt(t) {
    if (this.loaded) return false;
    if (this.firedT === null) return true;
    return (t - this.firedT) >= this.cooldown || t < this.firedT;
  }

  /**
   * Load the hero. The CONTROLLER owns the `cannon` state and the camera; this just latches
   * the barrel, plays the clunk and announces it so the game can switch state.
   */
  enter(player) {
    if (!this.readyAt(this.time)) return false;
    this.loaded = player || resolvePlayer(this.ctx, this.__player) || true;
    this._loadT = this.time;
    if (!this._silent) {
      hazSfx(this.ctx, 'gate_open', { gain: 0.6, rate: 1.25, pos: this.center, ref: 9, max: 36 });
      hazBurst(this.ctx, 'dust', this.center, { count: 8, speed: 2.0, spread: this.radius });
    }
    hazEvent(this.ctx, 'cannonEnter', this, player || null);
    return true;
  }

  /**
   * FIRE. Hands the hero `launchVelocity()` through whichever API the controller exposes, pops
   * the muzzle and announces it. Safe to call when nothing is loaded (it just fires blank).
   */
  fire(player) {
    const pl = player || (this.loaded && this.loaded.pos ? this.loaded : null)
      || resolvePlayer(this.ctx, this.__player);
    this.firedT = this.time;
    this.loaded = null;
    this._loadT = null;

    if (pl && pl.pos) {
      this.launchVelocity(_v);
      // Put the hero at the muzzle so the shot never starts inside the barrel.
      if (typeof pl.launch === 'function') pl.launch(this.mouth, _v, this);
      else {
        if (pl.__test && typeof pl.__test.teleport === 'function') pl.__test.teleport(this.mouth);
        else if (typeof pl.teleport === 'function') pl.teleport(this.mouth);
        else if (pl.pos && pl.pos.copy) pl.pos.copy(this.mouth);
        if (pl.__test && typeof pl.__test.setVel === 'function') pl.__test.setVel(_v);
        else if (typeof pl.setVel === 'function') pl.setVel(_v);
        else if (pl.vel && pl.vel.copy) pl.vel.copy(_v);
        if (typeof pl.setFacing === 'function') pl.setFacing(this.yaw);
        else if (pl.__test && typeof pl.__test.setFacing === 'function') pl.__test.setFacing(this.yaw);
      }
    }

    if (!this._silent) {
      hazSfx(this.ctx, 'cannon_fire', { gain: 1, rate: clamp(1.25 - this.launchSpeed * 0.006, 0.75, 1.25), pos: this.mouth, ref: 14, max: 90 });
      hazBurst(this.ctx, 'spark', this.mouth, { count: 26, speed: 11, dir: this.aim, color: this.hotColor.getHex() });
      hazBurst(this.ctx, 'dust', this.mouth, { count: 16, speed: 5, dir: this.aim });
      hazShake(this.ctx, 0.45, 220);
    }
    hazEvent(this.ctx, 'cannonFire', this, pl || null);
    return true;
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;

    // --- recoil: pure in (t - firedT) --------------------------------------------------------
    let recoil = 0;
    if (this.firedT !== null && t >= this.firedT) {
      const age = t - this.firedT;
      if (age < 0.55) {
        recoil = age < 0.05
          ? age / 0.05
          : Math.cos((age - 0.05) / 0.5 * Math.PI * 2.2) * Math.exp(-(age - 0.05) * 6.5);
      }
    }
    this.barrelGroup.position.copy(this.center).addScaledVector(this.aim, -recoil * this.radius * 0.9);
    if (this.breechRotor) this.breechRotor.setRotationFromAxisAngle(UPV, t * 1.4 + recoil * 6);

    // --- loaded state: the barrel breathes and the arc brightens -------------------------------
    const loaded = !!this.loaded;
    const ready = this.readyAt(t);
    const pulse = 0.5 + 0.5 * Math.sin(t * (loaded ? 9.5 : 2.2));
    this.boreMat.opacity = (loaded ? 0.75 : ready ? 0.45 : 0.14) + pulse * (loaded ? 0.25 : 0.14);
    this.collarMat.opacity = (loaded ? 0.85 : ready ? 0.48 : 0.12) + pulse * 0.18;
    this.arcMat.opacity = (loaded ? 0.55 : 0.16) + pulse * (loaded ? 0.22 : 0.06);
    this.marker.material.opacity = (loaded ? 0.40 : 0.14) + pulse * 0.10;
    this.marker.scale.setScalar(Math.max(1.2, this.radius * 2.0) * (1 + pulse * 0.12));

    // --- muzzle flash + smoke ring ----------------------------------------------------------
    const age = this.firedT === null ? 99 : t - this.firedT;
    this.flash.position.copy(this.mouth).addScaledVector(this.aim, this.radius * 0.5 - recoil * this.radius * 0.9);
    this.flash.material.opacity = clamp(1 - age / 0.20, 0, 1) * 0.95;
    this.flash.scale.setScalar(this.radius * (3.4 + clamp(1 - age / 0.20, 0, 1) * 4.0));
    if (age >= 0 && age < 0.75) {
      const k = smoothstep(0, 1, clamp(age / 0.75, 0, 1));
      this.smoke.visible = true;
      this.smoke.position.copy(this.mouth).addScaledVector(this.aim, 0.4 + k * 4.5);
      this.smoke.quaternion.copy(this.barrelQuat).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 0.5));
      this.smoke.scale.setScalar(0.5 + k * 2.6);
      this.smokeMat.opacity = (1 - k) * 0.32;
    } else if (this.smoke.visible) {
      this.smoke.visible = false;
      this.smokeMat.opacity = 0;
    }

    // --- auto-fire ----------------------------------------------------------------------------
    if (loaded && this.autoFire > 0 && this._loadT !== null && (t - this._loadT) >= this.autoFire) {
      this.fire(null);
    }

    for (let i = 0; i < this.colliders.length; i++) this.colliders[i].active = this.enabled;
    this.volume.active = this.enabled;
  }

  /** Interact / jump on the collar is one legal way in; a stand on the carriage is another. */
  onStand(player) {
    if (this.readyAt(this.time) && this.edge(this, '_lastEnter', Math.floor(this.time * 4))) {
      hazEvent(this.ctx, 'cannonNear', this, player || null);
    }
  }

  onPound() { if (this.loaded) this.fire(null); }

  onTouch(info) {
    if (!info) return;
    if (info.type === 'enter' || info.type === 'interact') this.enter(info.player || null);
    else if (info.type === 'fire') this.fire(info.player || null);
  }

  reset(t) {
    this.firedT = null;
    this.loaded = null;
    this._loadT = null;
    if (this.smoke) { this.smoke.visible = false; this.smokeMat.opacity = 0; }
    super.reset(t);
  }
}

/**
 * A barrel that fires the hero.
 * `{kind:'cannon', p:[BREECH], yaw|yawDeg, pitch|pitchDeg, power:m/s, target?:[x,y,z],
 *   r?, len?, cooldown?:SECONDS, autoFire?:SECONDS, id?}`
 *
 * `yaw` is RADIANS in the game convention (0 faces −Z, +yaw turns CCW from above); `pitch` is
 * RADIANS above the horizon; `power` is the launch SPEED IN m/s along the aim. Authoring a
 * `target` overrides both yaw and power: the yaw is aimed at it and the speed is SOLVED against
 * the asymmetric gravity so the shot actually lands there (`hazard.targetReachable` is false
 * when it cannot, and `power` is used instead).
 *
 * The hazard publishes `aim` (unit Vector3), `launchSpeed`, `launchVelocity(out)`, `mouth`,
 * `landing` and `flightTime`, plus a trigger Volume with `props.cannon = true` carrying
 * `enter(player)` / `fire(player)`. The CONTROLLER owns the `cannon` player state and the
 * flight; this owns the aim, the art and the bang.
 */
export function cannon(def, ctx) { return new CannonHazard(def, ctx); }

/* ======================================================================================
   RINGS
   ====================================================================================== */

class RingsHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'rings');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.radius = clamp(num(def.r, 2.2), 0.6, 12);
    this.triggerId = def.trigger || def.id || 'rings';
    /** Milliseconds allowed between the FIRST pass and the last (0 = untimed). */
    this.limitMs = Math.max(0, num(def.limitMs, num(def.time, 0) * 1000));
    /** Seconds a `fly` pass adds back to the flight timer (published, controller applies). */
    this.flyRefresh = Math.max(0, num(def.flyRefresh, 3.0));

    this.dimColor = new THREE.Color(pal.accent !== undefined ? pal.accent : 0x5ec8ff);
    this.litColor = new THREE.Color(pal.crest !== undefined ? pal.crest : 0xffe066);

    // ---- points -------------------------------------------------------------------------------
    const pts = Array.isArray(def.pts) ? def.pts : [];
    this.points = [];
    for (let i = 0; i < pts.length; i++) this.points.push(v3(pts[i], 0, 0, 0).clone());
    if (this.points.length < 2) {
      // A one-ring chain is legal but pointless; give a degenerate def a second hoop so the
      // hazard still builds instead of throwing inside a course load.
      const base = this.points[0] || new THREE.Vector3();
      this.points = [base.clone(), base.clone().add(new THREE.Vector3(0, 0, -6))];
    }
    this.count = this.points.length;

    /** How many rings have been passed IN ORDER. Reset to 0 by reset(t) or a timeout. */
    this.progress = 0;
    /** Course-clock time of the first pass in the current attempt, or null. */
    this.startT = null;
    this.lastPassT = null;
    this.done = false;

    this._prevPlayer = new THREE.Vector3();
    this._havePrev = false;

    this._buildRings(q);
    this._buildVolumes();
    this.reset(0);
  }

  _buildRings(q) {
    this.rings = [];
    this.group = new THREE.Group();
    this.add(this.group);

    const haloParts = [];
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i];
      // Face the ring along the path: toward the next hoop (or back from the previous one).
      const a = i < this.count - 1 ? this.points[i + 1] : p;
      const b = i < this.count - 1 ? p : this.points[i - 1];
      _v.subVectors(a, b);
      if (_v.lengthSq() < 1e-8) _v.set(0, 0, -1);
      const normal = _v.clone().normalize();
      // buildRing authors the hoop in the XY plane, so its local +Z is the hole's axis.
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

      let mesh = null;
      if (typeof builders.buildRing === 'function') {
        try {
          const built = builders.buildRing({
            kind: 'rings', p: [0, 0, 0], r: this.radius,
            tube: Math.max(0.10, this.radius * 0.085),
            mat: 'copper', struts: 0, glow: 1, solid: false,
          }, this.ctx && this.ctx.theme, this.ctx && this.ctx.mats);
          if (built && built.mesh) mesh = built.mesh;
        } catch (e) { mesh = null; }
      }
      if (!mesh) mesh = this._fallbackRing();
      mesh.position.copy(p);
      mesh.quaternion.copy(quat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);

      // Owned additive halo: buildRing's materials are shared/cached and must NOT be mutated,
      // so the lit state lives on a hoop of our own laid over the machined one.
      const haloGeo = new THREE.TorusGeometry(this.radius * 1.012, Math.max(0.045, this.radius * 0.05), 6, 40);
      const halo = new THREE.Mesh(haloGeo, null);       // material assigned below (per ring)
      halo.position.copy(p);
      halo.quaternion.copy(quat);
      halo.renderOrder = 6;
      haloParts.push(halo);

      this.rings.push({
        p: p.clone(), normal, quat, mesh, halo,
        haloMat: null, glow: null, passedAt: null, plane: normal.dot(p),
      });
    }

    // One material per ring so each can light independently — 13 additive materials is nothing
    // next to a per-ring geometry clone, and the "which hoop is next" read depends on it.
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.haloMat = additiveMaterial(this.dimColor.getHex(), { cached: false, opacity: 0.35, side: THREE.DoubleSide });
      this.own(r.haloMat);
      r.halo.material = r.haloMat;
      this.group.add(r.halo);

      r.glow = makeGlowSprite(this.dimColor.getHex(), this.radius * 1.6, 0.10, 2.8);
      this.own(r.glow.material);
      r.glow.position.copy(r.p);
      r.glow.renderOrder = 7;
      this.group.add(r.glow);
    }

    // Guide motes drifting from hoop to hoop so the ROUTE is legible before you commit.
    const seg = this.count - 1;
    const per = clamp(Math.round(6 * clamp(q.particles, 0.3, 1)), 2, 8);
    this.moteCount = seg * per;
    this.motePer = per;
    const mg = new THREE.OctahedronGeometry(0.09, 0);
    this.moteMat = additiveMaterial(this.dimColor.getHex(), { cached: false, opacity: 0.45 });
    this.own(this.moteMat);
    this.motes = new THREE.InstancedMesh(mg, this.moteMat, Math.max(1, this.moteCount));
    this.motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.add(this.motes);

    const rnd = hazRandom(this.def, 733);
    this.moteData = [];
    for (let i = 0; i < this.moteCount; i++) {
      this.moteData.push({ seg: Math.floor(i / per), off: rnd(), speed: lerp(0.22, 0.42, rnd()), scale: lerp(0.6, 1.3, rnd()) });
    }
  }

  /** A machined hoop, used when world/builders.js has no `buildRing` yet. */
  _fallbackRing() {
    const R = this.radius, tube = Math.max(0.10, R * 0.085);
    const parts = [];
    parts.push(new THREE.TorusGeometry(R, tube, 8, 44));
    parts.push(new THREE.TorusGeometry(R - tube * 0.55, tube * 0.30, 6, 40));
    parts.push(new THREE.TorusGeometry(R + tube * 0.72, tube * 0.24, 6, 40));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const g = bevelBox(tube * 0.9, tube * 2.4, tube * 0.6, tube * 0.14, 1.7, 0.6);
      g.rotateZ(a + Math.PI * 0.5);
      g.translate(Math.cos(a) * (R + tube * 0.5), Math.sin(a) * (R + tube * 0.5), 0);
      parts.push(g);
    }
    const m = new THREE.Mesh(mergeAll(parts), hazMat(this.ctx, 'copper'));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  _buildVolumes() {
    // A trigger Volume per hoop so a host that walks `volumes` can see the gates. The
    // AUTHORITATIVE pass test is the plane crossing in update() — a volume overlap test would
    // miss a hero flying through at 30 m/s between two frames.
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const vol = makeVolume({
        center: r.p,
        half: _v.set(this.radius, this.radius, Math.max(0.3, this.radius * 0.25)),
        quat: r.quat,
        kind: 'trigger',
        ref: this,
        props: { id: this.triggerId + ':' + i, ring: i, hazard: this, flyRefresh: this.flyRefresh },
      });
      this.volumes.push(vol);
      r.volume = vol;
    }
  }

  /** Milliseconds left in the current attempt, or -1 when untimed / not started. */
  remainingMs(t) {
    if (this.limitMs <= 0 || this.startT === null) return -1;
    return Math.max(0, this.limitMs - (t - this.startT) * 1000);
  }

  /**
   * Did the segment from `a` to `b` cross ring `i`'s disc? A plane-crossing test with a radial
   * check at the crossing point — tunnelling-proof at any flight speed, allocation-free.
   */
  _crossed(r, a, b) {
    const da = r.normal.dot(a) - r.plane;
    const db = r.normal.dot(b) - r.plane;
    if (da === db) return false;
    if ((da > 0) === (db > 0)) return false;
    const f = da / (da - db);
    _v3.lerpVectors(a, b, f).sub(r.p);
    const along = r.normal.dot(_v3);
    _v3.addScaledVector(r.normal, -along);           // project onto the hoop's plane
    return _v3.lengthSq() <= this.radius * this.radius;
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;

    // --- timeout ---------------------------------------------------------------------------
    if (!this.done && this.limitMs > 0 && this.startT !== null && (t - this.startT) * 1000 > this.limitMs) {
      this._fail(t);
    }

    // --- pass detection ---------------------------------------------------------------------
    const pl = resolvePlayer(this.ctx, player || this.__player);
    if (pl && pl.pos && this.enabled && !this.done) {
      if (this._havePrev) {
        const r = this.rings[this.progress];
        if (r && this._crossed(r, this._prevPlayer, pl.pos)) this._pass(t, pl);
      }
      this._prevPlayer.copy(pl.pos);
      this._havePrev = true;
    } else if (!pl || !pl.pos) {
      this._havePrev = false;
    }

    // --- ring visuals -------------------------------------------------------------------------
    const remain = this.remainingMs(t);
    const urgency = (this.limitMs > 0 && remain >= 0) ? clamp(1 - remain / this.limitMs, 0, 1) : 0;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const passed = i < this.progress;
      const isNext = i === this.progress && !this.done;
      // Just-passed flare, then a steady lit hoop.
      const flare = r.passedAt !== null ? clamp(1 - (t - r.passedAt) / 0.45, 0, 1) : 0;
      const beat = 0.5 + 0.5 * Math.sin(t * (isNext ? 5.5 + urgency * 8 : 1.7) + i * 0.7);
      const lit = passed || this.done;
      r.haloMat.color.copy(lit ? this.litColor : this.dimColor);
      r.haloMat.opacity = (lit ? 0.55 : isNext ? 0.42 : 0.14) + beat * (isNext ? 0.32 : 0.10) + flare * 0.9;
      r.glow.material.color.copy(r.haloMat.color);
      r.glow.material.opacity = (lit ? 0.20 : isNext ? 0.18 : 0.05) + beat * 0.06 + flare * 0.55;
      r.glow.scale.setScalar(this.radius * (1.5 + flare * 1.4));
    }

    // --- guide motes travel from hoop to hoop --------------------------------------------------
    for (let i = 0; i < this.moteCount; i++) {
      const md = this.moteData[i];
      const a = this.points[md.seg], b = this.points[md.seg + 1];
      const u = (md.off + t * md.speed) % 1;
      _v.lerpVectors(a, b, u);
      const fade = Math.sin(u * Math.PI);
      _s.setScalar(md.scale * clamp(fade, 0.05, 1) * (md.seg < this.progress ? 0.6 : 1));
      _q.identity();
      _m.compose(_v, _q, _s);
      this.motes.setMatrixAt(i, _m);
    }
    if (this.moteCount > 0) this.motes.instanceMatrix.needsUpdate = true;
    this.moteMat.color.copy(this.done ? this.litColor : this.dimColor);
    this.moteMat.opacity = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 2.4)) + urgency * 0.2;
  }

  _pass(t, pl) {
    const idx = this.progress;
    const r = this.rings[idx];
    r.passedAt = t;
    this.progress++;
    this.lastPassT = t;
    if (this.startT === null) this.startT = t;

    if (!this._silent) {
      hazSfx(this.ctx, 'ring_pass', { gain: 0.8, rate: clamp(0.9 + idx * 0.06, 0.9, 1.6), pos: r.p, ref: 10, max: 44 });
      hazBurst(this.ctx, 'ringPass', r.p, { count: 18, speed: 6, color: this.litColor.getHex(), normal: r.normal });
    }
    hazEvent(this.ctx, 'ringPass', this.triggerId, idx, this);

    // A pass taken in the `fly` state refreshes the flight (CONTRACT §21). The controller owns
    // the timer; we call whichever API it exposes and always announce it.
    const flying = pl && (pl.state === 'fly' || pl.flying === true);
    if (flying) {
      try {
        if (typeof pl.refreshFlight === 'function') pl.refreshFlight(this.flyRefresh);
        else if (typeof pl.addFlight === 'function') pl.addFlight(this.flyRefresh);
      } catch (e) { /* an optional controller hook must never break the chain */ }
      hazEvent(this.ctx, 'flyRefresh', this.flyRefresh, this);
      if (!this._silent) hazBurst(this.ctx, 'wingGust', r.p, { count: 14, speed: 5, color: this.litColor.getHex() });
    }

    if (this.progress >= this.count) this._complete(t);
  }

  _complete(t) {
    this.done = true;
    if (!this._silent) {
      hazStinger(this.ctx, 'sigilsDone');
      const last = this.rings[this.rings.length - 1];
      hazBurst(this.ctx, 'crestGrand', last.p, { count: 40, speed: 8, color: this.litColor.getHex() });
    }
    hazEvent(this.ctx, 'ringsDone', this.triggerId, this);
    hazTrigger(this.ctx, this.triggerId, { kind: 'rings', count: this.count, ms: this.startT === null ? 0 : (t - this.startT) * 1000 });
  }

  /** Ran out of time: every hoop goes dark and the chain must be run again from the first. */
  _fail(t) {
    this.progress = 0;
    this.startT = null;
    for (let i = 0; i < this.rings.length; i++) this.rings[i].passedAt = null;
    if (!this._silent) {
      hazSfx(this.ctx, 'ui_back', { gain: 0.55, rate: 0.7, pos: this.points[0], ref: 12, max: 60 });
    }
    hazEvent(this.ctx, 'ringsReset', this.triggerId, this);
  }

  onStand() {}
  onPound() {}
  onTouch() {}

  reset(t) {
    this.progress = 0;
    this.startT = null;
    this.lastPassT = null;
    this.done = false;
    this._havePrev = false;
    for (let i = 0; i < this.rings.length; i++) this.rings[i].passedAt = null;
    super.reset(t);
  }
}

/**
 * A chain of hoops that must be flown in order.
 * `{kind:'rings', pts:[[x,y,z], …], r?:METRES (default 2.2), limitMs?:MS | time?:SECONDS,
 *   trigger?:string, id?:string, flyRefresh?:SECONDS}`
 *
 * Each hoop is a `buildRing` mesh oriented along the path with its own trigger Volume, and the
 * pass test is a PLANE CROSSING between the hero's previous and current position — so a hoop
 * cannot be tunnelled through at any flight speed. Every pass emits `ringPass(triggerId, index,
 * hazard)`; completing the chain emits `ringsDone(triggerId, hazard)` AND fires the named
 * trigger, so a `secret` crest (§22) can hang off it. `limitMs` is measured from the FIRST pass;
 * running out dims every hoop and restarts the chain. A pass taken while the hero is in the
 * `fly` state calls `player.refreshFlight(flyRefresh)` and emits `flyRefresh`.
 */
export function rings(def, ctx) { return new RingsHazard(def, ctx); }
