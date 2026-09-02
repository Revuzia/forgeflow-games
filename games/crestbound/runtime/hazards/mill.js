// runtime/hazards/mill.js
// CRESTBOUND — `mill`: the windmill you RIDE (CONTRACT §21).
//
// A stone mill tower with a timber cap and `def.arms` lattice sails turning about a HORIZONTAL
// axis once every `def.period` seconds. Unlike `rotor` style 'windmill' (which is lethal), every
// sail here is a SOLID SHELF the hero can stand on, and the shelf's face points along the
// direction of travel — so it carries you round the top and PUSHES you when it comes at you.
//
// SAIL FRAME (the whole design in one paragraph): each sail is authored in a frame where
//   X = radial (outward along the arm, length `len`)
//   Y = tangential (the direction of travel — the shelf's OWN up, thickness `thick`)
//   Z = the spin axis (the sail's chord, width `chord`)
// so at the 3-o'clock and 9-o'clock positions the shelf face is horizontal and standable, and
// on the way over the top it tips you off exactly the way a real sail would. That is why the
// mill teaches itself: you can see, from the ground, which sail will be flat when you arrive.
//
// DETERMINISM LAW (CONTRACT §21): the sail angle is
//     theta(t) = TAU * (t / period + phase) * dir        [phase = FRACTION of a revolution]
// and every collider, transform and light derives from theta by closed form. There is no
// integration; `reset(t)` is `update(t, 0)`.
//
// CARRY: the mill publishes `linVel = 0`, `angVel = omega`, `angAxis = axis`,
// `angCenter = hub` and `velocityAtPoint(p, out)` — the exact interface
// runtime/player/collide.js reads for `platformVel` (CONTRACT §10).

import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';
import { headingFromYaw } from '../core/tuning.js';
import {
  Hazard, num, v3, dirVec, palette, hazMat, additiveMaterial, makeGlowSprite,
  bevelBox, mergeAll, makeCollider, setColliderBox, hazSfx, hazBurst,
  hazRandom, qualityOf, resolvePlayer, standingOn,
} from './lasers.js';

const TAU = Math.PI * 2;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UPV = new THREE.Vector3(0, 1, 0);

/** A chamfered slab pre-translated into local space. */
function slab(w, h, d, x, y, z, bevel = 0.02, detail = 1) {
  const g = bevelBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), bevel, 1.7, detail);
  g.translate(x, y, z);
  return g;
}

/* ======================================================================================
   MILL HAZARD
   ====================================================================================== */

class MillHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'mill');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.hub = v3(def.p, 0, 0, 0);                  // the AXLE, not the tower base
    this.arms = clamp(Math.round(num(def.arms, 4)), 1, 8);
    this.len = clamp(num(def.len, 7), 1.2, 30);     // sail length, hub -> tip
    this.period = Math.max(0.6, num(def.period, 8)); // SECONDS per revolution
    this.phase = num(def.phase, 0);                  // FRACTION of a revolution
    this.dirSign = num(def.dir, 1) < 0 ? -1 : 1;
    this.omega = (TAU / this.period) * this.dirSign;

    this.chord = clamp(num(def.chord, num(def.w, Math.max(1.5, this.len * 0.26))), 0.6, 12);
    this.thick = clamp(num(def.thick, 0.34), 0.10, 1.6);
    this.innerR = clamp(num(def.inner, Math.max(0.5, this.len * 0.12)), 0.2, this.len * 0.6);
    this.towerH = Math.max(0, num(def.tower, this.len * 1.15));
    this.towerR = clamp(num(def.towerR, Math.max(1.4, this.len * 0.34)), 0.6, 14);

    // The mill FACES `yaw` (game convention: yaw 0 faces −Z, +yaw turns CCW from above), and
    // the spin axis is that facing. `axis` overrides it outright when authored.
    this.yaw = def.yawDeg !== undefined ? num(def.yawDeg, 0) * Math.PI / 180 : num(def.yaw, 0);
    if (def.axis !== undefined) {
      this.axis = dirVec(def.axis, 0, 0, -1);
    } else {
      headingFromYaw(this.yaw, _v);                 // ONE conversion, ONE place
      this.axis = _v.clone().normalize();
    }
    // A mill's axle is horizontal by definition; flatten a sloppy authored axis rather than
    // silently building a helicopter.
    if (Math.abs(this.axis.y) > 0.92) this.axis.set(0, 0, -1);
    this.axis.y *= 0.25;
    this.axis.normalize();

    this.woodColor = new THREE.Color(pal.deco !== undefined ? pal.deco : 0x8a6740);
    this.safeColor = new THREE.Color(pal.safeEdge !== undefined ? pal.safeEdge : 0x7ef0ff);
    this.accent = new THREE.Color(pal.accent !== undefined ? pal.accent : 0x5ec8ff);

    // Canonical(+Y) -> world(axis). Sails are authored in the canonical frame and the whole
    // spinner is oriented once, exactly like ./rotors.js.
    this.alignQ = new THREE.Quaternion().setFromUnitVectors(UPV, this.axis);
    // The mill's fixed yaw: local -Z faces along the axle, so local +X is the RADIAL-HORIZONTAL
    // (the direction a sail points at 3 o'clock). Tower, cap and gondolas all share it.
    this.yawQ = new THREE.Quaternion().setFromAxisAngle(UPV, Math.atan2(-this.axis.x, -this.axis.z));

    /* GONDOLA DECKS — `deck:{w, d, t, r?}`, optional.
       A sail shelf's own up is the direction of travel, so it is horizontal at 3 and 9 o'clock
       and VERTICAL at 6 and 12: a mill with bare sails can only be boarded level with its axle.
       An authored `deck` pins a GIMBALLED platform to each arm tip — it stays horizontal through
       the whole revolution, like a wheel gondola — which is what makes "jump on at the bottom of
       the sweep and ride it round" a real move. `w` spans the axle, `d` runs along the arm (the
       edge you step off), `t` is its thickness and `r` its radius from the axle (default `len`).
       Still a closed form of theta, so DETERMINISM (CONTRACT §21) is untouched. */
    const dk = def.deck;
    this.deck = dk ? {
      w: clamp(num(dk.w, 2.0), 0.6, 8),
      d: clamp(num(dk.d, 1.6), 0.6, 8),
      t: clamp(num(dk.t, 0.4), 0.10, 1.2),
      r: clamp(num(dk.r, this.len), 0.5, this.len + 2),
    } : null;

    this.armPhase = new Float64Array(this.arms);
    for (let i = 0; i < this.arms; i++) this.armPhase[i] = (i / this.arms) * TAU;

    this.linVel = new THREE.Vector3();
    this.angVel = this.omega;
    this.angAxis = this.axis.clone();
    this.angCenter = this.hub.clone();

    this._bpFailed = false;
    this._lastRev = null;
    this._lastCreak = -9;

    this._buildTower();
    this._buildHub();
    this._buildSails(q);
    this._buildDecks();
    this.reset(0);
  }

  /* ------------------------------------------------------------------------------------ */
  /*  TOWER — a real mill, not a post holding up a fan                                     */
  /* ------------------------------------------------------------------------------------ */
  _buildTower() {
    if (this.towerH <= 0.2) return;
    const H = this.towerH, R = this.towerR;
    // Owned, not scratch: `base` is read all the way through this builder.
    const base = this.hub.clone().addScaledVector(UPV, -H);

    const stone = [];
    const timber = [];
    const trim = [];

    // Tapered stone drum in three courses, so the silhouette has a shoulder.
    const courses = 3;
    for (let i = 0; i < courses; i++) {
      const u0 = i / courses, u1 = (i + 1) / courses;
      const r0 = lerp(R, R * 0.78, u0), r1 = lerp(R, R * 0.78, u1);
      const g = new THREE.CylinderGeometry(r1, r0, H / courses, 22, 1, false);
      g.translate(0, H * (u0 + u1) * 0.5, 0);
      stone.push(g);
      // string course between drums
      const band = new THREE.TorusGeometry(lerp(R, R * 0.78, u1) * 1.02, R * 0.045, 6, 26);
      band.rotateX(Math.PI * 0.5);
      band.translate(0, H * u1, 0);
      stone.push(band);
    }
    // plinth
    const plinth = new THREE.CylinderGeometry(R * 1.06, R * 1.18, H * 0.07, 24);
    plinth.translate(0, H * 0.035, 0);
    stone.push(plinth);

    // Door on the downwind side + two windows, so the tower has scale cues.
    const doorW = Math.min(R * 0.7, 1.1);
    timber.push(slab(doorW, doorW * 1.9, 0.16, 0, doorW * 0.95, -(R * 0.985), 0.03));
    for (let i = 0; i < 2; i++) {
      const a = Math.PI * (0.35 + i * 0.9);
      const y = H * (0.42 + i * 0.24);
      const rr = lerp(R, R * 0.78, y / H) * 0.985;
      const win = slab(0.62, 0.78, 0.14, Math.cos(a) * rr, y, Math.sin(a) * rr, 0.02);
      win.rotateY(-a);
      timber.push(win);
    }

    // Gallery: a walkable ring balcony two-thirds up, with a railing. This is a real platform —
    // a mill with no landing is a mill you can only look at.
    const galY = H * 0.68;
    const galR = lerp(R, R * 0.78, 0.68) + Math.max(0.7, R * 0.42);
    const galInner = lerp(R, R * 0.78, 0.68);
    const galRing = new THREE.CylinderGeometry(galR, galR, 0.22, 26, 1, false);
    galRing.translate(0, galY, 0);
    timber.push(galRing);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const brace = slab(0.16, 0.9, 0.16, Math.cos(a) * (galInner + (galR - galInner) * 0.6), galY - 0.5, Math.sin(a) * (galInner + (galR - galInner) * 0.6), 0.02, 0.5);
      brace.rotateY(-a);
      timber.push(brace);
      const post = slab(0.11, 0.85, 0.11, Math.cos(a) * (galR - 0.14), galY + 0.53, Math.sin(a) * (galR - 0.14), 0.02, 0.5);
      timber.push(post);
    }
    const rail = new THREE.TorusGeometry(galR - 0.14, 0.07, 6, 30);
    rail.rotateX(Math.PI * 0.5);
    rail.translate(0, galY + 0.95, 0);
    timber.push(rail);
    // safe-edge stripe on the gallery deck (CONTRACT hard rule 2)
    const stripe = new THREE.TorusGeometry(galR - 0.05, 0.035, 5, 34);
    stripe.rotateX(Math.PI * 0.5);
    stripe.translate(0, galY + 0.13, 0);
    trim.push(stripe);

    // Timber cap: a boat-shaped roof that reads as the thing the sails hang off.
    const capR = lerp(R, R * 0.78, 1) * 1.06;
    const cap = new THREE.SphereGeometry(capR, 22, 12, 0, TAU, 0, Math.PI * 0.5);
    cap.scale(1, 1.25, 1.12);
    cap.translate(0, H, 0);
    timber.push(cap);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const rib = slab(0.10, capR * 1.2, 0.10, Math.cos(a) * capR * 0.72, H + capR * 0.62, Math.sin(a) * capR * 0.72, 0.02, 0.4);
      rib.rotateZ(Math.cos(a) * 0.34);
      rib.rotateX(Math.sin(a) * 0.34);
      timber.push(rib);
    }
    // tail pole (the fantail that keeps the cap into the wind)
    const tail = slab(0.16, 0.16, capR * 2.6, 0, H + capR * 0.3, -capR * 1.5, 0.03);
    timber.push(tail);
    timber.push(slab(0.9, 0.06, 1.3, 0, H + capR * 0.3, -capR * 2.5, 0.02, 0.6));

    // Orient the tower so its +Y is world up and its -Z faces the mill's facing.
    const yawQ = this.yawQ;

    this.tower = new THREE.Mesh(mergeAll(stone), hazMat(this.ctx, 'stone'));
    this.tower.castShadow = true;
    this.tower.receiveShadow = true;
    this.tower.position.copy(base);
    this.tower.quaternion.copy(yawQ);
    this.add(this.tower);

    this.timber = new THREE.Mesh(mergeAll(timber), hazMat(this.ctx, 'wood'));
    this.timber.castShadow = true;
    this.timber.receiveShadow = true;
    this.timber.position.copy(base);
    this.timber.quaternion.copy(yawQ);
    this.add(this.timber);

    this.trimMat = additiveMaterial(this.safeColor.getHex(), { cached: false, opacity: 0.6 });
    this.own(this.trimMat);
    this.trimMesh = new THREE.Mesh(mergeAll(trim), this.trimMat);
    this.trimMesh.renderOrder = 5;
    this.trimMesh.position.copy(base);
    this.trimMesh.quaternion.copy(yawQ);
    this.add(this.trimMesh);

    // ---- static colliders: the drum, and the gallery you can actually land on -------------
    this.colliders.push(makeCollider({
      center: _v2.copy(base).addScaledVector(UPV, H * 0.5),
      half: _v3.set(R * 0.80, H * 0.5, R * 0.80),
      surface: 'normal', ref: this, group: 'hazard',
      props: { stepSfx: 'step_stone', stepRate: 1.0 },
    }));
    // The gallery is approximated by four chords rather than a ring: four boxes read as a ring
    // to the resolver, cost nothing, and never open an inside-corner seam.
    const gh = 0.14;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI * 0.25;
      const cx = Math.cos(a) * (galInner + (galR - galInner) * 0.62);
      const cz = Math.sin(a) * (galInner + (galR - galInner) * 0.62);
      _v2.set(cx, galY + gh, cz).applyQuaternion(yawQ).add(base);
      _q.setFromAxisAngle(UPV, -a).premultiply(yawQ);
      this.colliders.push(makeCollider({
        center: _v2,
        half: _v3.set((galR - galInner) * 0.62, gh, galR * 0.78),
        quat: _q,
        surface: 'normal', ref: this, group: 'hazard',
        props: { stepSfx: 'step_wood', stepRate: 1.0 },
      }));
    }
  }

  /* ------------------------------------------------------------------------------------ */
  /*  HUB — an exposed gear train, so the mechanism is READABLE                             */
  /* ------------------------------------------------------------------------------------ */
  _buildHub() {
    const R = Math.max(0.45, this.innerR);
    const stat = [];
    const spinParts = [];
    const glows = [];

    // static bearing block behind the wheel
    stat.push(slab(R * 2.2, R * 2.0, R * 1.5, 0, 0, -R * 1.3, R * 0.1));
    const collar = new THREE.TorusGeometry(R * 0.9, R * 0.16, 8, 22);
    collar.rotateX(Math.PI * 0.5);
    collar.translate(0, -R * 0.55, 0);
    stat.push(collar);

    // the brake wheel: a real toothed gear that turns with the sails
    const wheel = new THREE.CylinderGeometry(R * 1.55, R * 1.55, R * 0.34, 26, 1, false);
    spinParts.push(wheel);
    const wheelRim = new THREE.TorusGeometry(R * 1.58, R * 0.13, 7, 30);
    wheelRim.rotateX(Math.PI * 0.5);
    spinParts.push(wheelRim);
    const nTeeth = 18;
    for (let i = 0; i < nTeeth; i++) {
      const a = (i / nTeeth) * TAU;
      const tooth = slab(R * 0.20, R * 0.30, R * 0.18, Math.cos(a) * R * 1.70, 0, Math.sin(a) * R * 1.70, R * 0.03, 0.4);
      tooth.rotateY(-a);
      spinParts.push(tooth);
    }
    // spokes + boss
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const spoke = slab(R * 1.5, R * 0.20, R * 0.20, Math.cos(a) * R * 0.75, 0, Math.sin(a) * R * 0.75, R * 0.03, 0.5);
      spoke.rotateY(-a);
      spinParts.push(spoke);
    }
    const boss = new THREE.CylinderGeometry(R * 0.62, R * 0.7, R * 1.4, 16);
    spinParts.push(boss);
    // nose cone out the front, the classic mill "windshaft" cap
    const nose = new THREE.ConeGeometry(R * 0.66, R * 1.5, 16);
    nose.translate(0, R * 1.35, 0);
    spinParts.push(nose);
    // an emissive index band so the rotation rate is legible at a glance
    const idx = slab(R * 0.16, R * 0.36, R * 0.16, R * 1.35, R * 0.22, 0, R * 0.03, 0.5);
    glows.push(idx);
    const ring = new THREE.TorusGeometry(R * 0.75, R * 0.05, 5, 24);
    ring.rotateX(Math.PI * 0.5);
    ring.translate(0, R * 0.62, 0);
    glows.push(ring);

    for (const g of stat) g.applyQuaternion(this.alignQ);
    this.hubStatic = new THREE.Mesh(mergeAll(stat), hazMat(this.ctx, 'wood'));
    this.hubStatic.castShadow = true;
    this.hubStatic.receiveShadow = true;
    this.hubStatic.position.copy(this.hub);
    this.add(this.hubStatic);

    this.spinner = new THREE.Group();
    this.spinner.position.copy(this.hub);
    this.add(this.spinner);

    this.gear = new THREE.Mesh(mergeAll(spinParts), hazMat(this.ctx, 'copper'));
    this.gear.castShadow = true;
    this.gear.receiveShadow = true;
    this.spinner.add(this.gear);

    this.indexMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.7 });
    this.own(this.indexMat);
    this.indexMesh = new THREE.Mesh(mergeAll(glows), this.indexMat);
    this.indexMesh.renderOrder = 5;
    this.spinner.add(this.indexMesh);

    this.hubGlow = makeGlowSprite(this.accent.getHex(), R * 3.0, 0.10, 2.8);
    this.own(this.hubGlow.material);
    this.hubGlow.position.copy(this.hub);
    this.add(this.hubGlow);
  }

  /* ------------------------------------------------------------------------------------ */
  /*  SAILS — lattice frames that are also rideable shelves                                 */
  /* ------------------------------------------------------------------------------------ */
  _buildSails(q) {
    const L = this.len - this.innerR;
    const C = this.chord, T = this.thick;
    const frame = [];
    const canvas = [];
    const stripes = [];

    // SAIL-LOCAL FRAME (see the file header): X = radial (length), Y = the shelf's own up
    // (thickness, and the direction of travel), Z = the spin axis (chord). A sail is authored
    // once in that frame and mapped into the canonical spinner frame by `makeBasis(r, tg, +Y)`,
    // which is right-handed because r x tg == the canonical spin axis for every slot angle.
    const rHat = new THREE.Vector3();
    const tHat = new THREE.Vector3();
    const faceSign = this.dirSign;      // stripes ride the face that leads into the travel
    for (let i = 0; i < this.arms; i++) {
      const phi = this.armPhase[i];
      // canonical radial for this slot, and the tangential (axis x radial) that goes with it
      rHat.set(Math.cos(phi), 0, -Math.sin(phi));
      tHat.set(-Math.sin(phi), 0, -Math.cos(phi));
      const local = [];
      const localCanvas = [];
      const localStripe = [];

      // whip (the main spar) + two stocks
      local.push(slab(L, T * 0.9, C * 0.16, this.innerR + L * 0.5, 0, 0, T * 0.2));
      for (const s of [1, -1]) {
        local.push(slab(L * 0.98, T * 0.55, C * 0.10, this.innerR + L * 0.5, T * 0.24, s * C * 0.40, T * 0.12, 0.6));
      }
      // sail bars: the rungs of the lattice, thinning toward the tip
      const nBar = clamp(Math.round(L / 0.75), 3, 22);
      for (let k = 0; k < nBar; k++) {
        const u = (k + 0.5) / nBar;
        const cw = C * lerp(1.0, 0.62, u);
        local.push(slab(L * 0.035, T * 0.42, cw, this.innerR + L * u, T * 0.16, 0, T * 0.10, 0.34));
      }
      // canvas: the cloth panels the wind pushes on (decorative, on the leeward face)
      for (let k = 0; k < 3; k++) {
        const u0 = 0.10 + k * 0.29, u1 = u0 + 0.24;
        const um = (u0 + u1) * 0.5;
        localCanvas.push(slab(L * (u1 - u0), T * 0.10, C * lerp(0.95, 0.60, um),
          this.innerR + L * um, -T * 0.30, C * 0.06, T * 0.04, 0.5));
      }
      // tip board + heel plate
      local.push(slab(L * 0.05, T * 1.05, C * 0.66, this.innerR + L * 0.985, 0, 0, T * 0.16, 0.6));
      local.push(slab(L * 0.06, T * 1.15, C * 0.9, this.innerR + L * 0.02, 0, 0, T * 0.18, 0.6));

      // Safe-edge stripes along BOTH long edges of the shelf face, plus a tip chevron — this is
      // what lets you pick, from the ground, which sail will be flat when you get there.
      for (const s of [1, -1]) {
        localStripe.push(slab(L * 0.97, 0.035, C * 0.05, this.innerR + L * 0.5, faceSign * (T * 0.5 + 0.012), s * (C * 0.5 - C * 0.04), 0.008, 0.4));
      }
      localStripe.push(slab(L * 0.04, 0.035, C * 0.86, this.innerR + L * 0.94, faceSign * (T * 0.5 + 0.012), 0, 0.008, 0.4));

      // Sail-local (radial, shelf-up, chord) -> canonical spinner space, in ONE matrix.
      _m.makeBasis(rHat, tHat, UPV);
      for (const g of local) { g.applyMatrix4(_m); frame.push(g); }
      for (const g of localCanvas) { g.applyMatrix4(_m); canvas.push(g); }
      for (const g of localStripe) { g.applyMatrix4(_m); stripes.push(g); }
    }

    this.sailFrame = new THREE.Mesh(mergeAll(frame), hazMat(this.ctx, 'wood'));
    this.sailFrame.castShadow = true;
    this.sailFrame.receiveShadow = true;
    this.spinner.add(this.sailFrame);

    this.canvasMesh = new THREE.Mesh(mergeAll(canvas), hazMat(this.ctx, 'cloth'));
    this.canvasMesh.castShadow = true;
    this.canvasMesh.receiveShadow = true;
    this.spinner.add(this.canvasMesh);

    this.stripeMat = additiveMaterial(this.safeColor.getHex(), { cached: false, opacity: 0.65 });
    this.own(this.stripeMat);
    this.stripeMesh = new THREE.Mesh(mergeAll(stripes), this.stripeMat);
    this.stripeMesh.renderOrder = 5;
    this.spinner.add(this.stripeMesh);

    // ---- one solid shelf collider per sail -------------------------------------------------
    // half = (length/2 along the radial, thickness/2 along the shelf normal, chord/2 along the
    // axis). `nostick` so a rider is never welded to a face that has rotated past vertical.
    this.sailColliders = [];
    for (let i = 0; i < this.arms; i++) {
      const c = makeCollider({
        center: this.hub,
        half: _v.set(L * 0.5 + this.thick, this.thick * 0.5, this.chord * 0.5),
        surface: 'nostick',
        ref: this,
        group: 'hazard',
        props: { stepSfx: 'step_wood', stepRate: 1.0, mill: true, arm: i },
      });
      this.colliders.push(c);
      this.sailColliders.push(c);
    }

    // Dust shed off the tips — pure in t, and only worth drawing at all on a spinning mill.
    const n = clamp(Math.round(this.arms * 4 * clamp(q.particles, 0.25, 1)), 4, 40);
    this.moteCount = n;
    const mg = new THREE.OctahedronGeometry(0.07, 0);
    this.moteMat = additiveMaterial(this.woodColor.getHex(), { cached: false, opacity: 0.28 });
    this.own(this.moteMat);
    this.motes = new THREE.InstancedMesh(mg, this.moteMat, n);
    this.motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.add(this.motes);
    const rnd = hazRandom(this.def, 1201);
    this.moteData = [];
    for (let i = 0; i < n; i++) {
      this.moteData.push({
        arm: i % this.arms, off: rnd(), life: lerp(0.8, 1.8, rnd()),
        lat: (rnd() * 2 - 1) * this.chord * 0.45, scale: lerp(0.5, 1.4, rnd()),
      });
    }
  }

  /** The world radial direction of arm `i` at rotor angle `theta`. Allocation-free. */
  /* ------------------------------------------------------------------------------------ */
  /*  GONDOLA DECKS — the level platforms you actually ride                                 */
  /* ------------------------------------------------------------------------------------ */
  _buildDecks() {
    this.deckMeshes = [];
    this.deckColliders = [];
    if (!this.deck) return;
    const { w, d, t } = this.deck;

    // One geometry, `arms` instances. Authored with X along the arm (the edge you step off),
    // Z across the axle; `this.yawQ` puts that into world space and never changes again.
    const parts = [];
    parts.push(slab(d, t, w, 0, 0, 0, Math.min(0.06, t * 0.3)));                  // the deck plank
    for (const sg of [1, -1]) {                                                    // kerb rails
      parts.push(slab(d, t * 0.55, 0.12, 0, t * 0.55, sg * (w * 0.5 - 0.06), 0.02, 0.6));
      parts.push(slab(0.12, t * 0.55, w, sg * (d * 0.5 - 0.06), t * 0.55, 0, 0.02, 0.6));
    }
    for (const sg of [1, -1]) {                                                    // hanger straps
      parts.push(slab(0.12, t * 2.4, 0.12, 0, t * 1.5, sg * (w * 0.5 - 0.22), 0.02, 0.5));
    }
    const geo = mergeAll(parts);

    // The stripe that says "this is where you stand" (CONTRACT hard rule 2).
    const stripes = [];
    for (const sg of [1, -1]) {
      stripes.push(slab(d * 0.94, 0.035, 0.07, 0, t * 0.5 + 0.02, sg * (w * 0.5 - 0.16), 0.008, 0.4));
    }
    this.deckStripeMat = additiveMaterial(this.safeColor.getHex(), { cached: false, opacity: 0.7 });
    this.own(this.deckStripeMat);
    const stripeGeo = mergeAll(stripes);

    const deckMat = hazMat(this.ctx, 'wood');
    for (let i = 0; i < this.arms; i++) {
      const m = new THREE.Mesh(geo, deckMat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.quaternion.copy(this.yawQ);
      this.add(m);
      const st = new THREE.Mesh(stripeGeo, this.deckStripeMat);
      st.renderOrder = 5;
      st.quaternion.copy(this.yawQ);
      this.add(st);
      this.deckMeshes.push([m, st]);

      const c = makeCollider({
        center: this.hub,
        half: _v.set(d * 0.5, t * 0.5, w * 0.5),
        quat: this.yawQ,
        surface: 'normal',
        ref: this,
        group: 'hazard',
        props: { stepSfx: 'step_wood', stepRate: 1.0, mill: true, deck: true, arm: i },
      });
      this.colliders.push(c);
      this.deckColliders.push(c);
    }
  }

  armDir(i, theta, out) {
    const a = this.armPhase[i] + theta;
    out.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(this.alignQ);
    return out;
  }

  /**
   * Orthonormal shelf frame for a sail: X = radial, Y = tangential (the shelf's up), Z = axis.
   * Right-handed by construction — `radial x (axis x radial) == axis` for any radial
   * perpendicular to the axis — so the quaternion is always valid and the collider box is
   * exactly (len/2, thick/2, chord/2) in that order.
   */
  sailQuat(radial, out) {
    _v3.crossVectors(this.axis, radial).normalize();     // direction of travel
    _m.makeBasis(radial, _v3, this.axis);
    return out.setFromRotationMatrix(_m);
  }

  _refreshBroad(c) {
    if (this._bpFailed || !this.ctx.broadphase || typeof this.ctx.broadphase.refresh !== 'function') return;
    try { this.ctx.broadphase.refresh(c); } catch (err) { this._bpFailed = true; }
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    const theta = TAU * (t / this.period + this.phase) * this.dirSign;

    this.spinner.quaternion.copy(this.alignQ).multiply(_q2.setFromAxisAngle(UPV, theta));

    this.angVel = this.omega;
    this.angAxis.copy(this.axis);
    this.angCenter.copy(this.hub);
    this.linVel.set(0, 0, 0);

    // --- sail colliders ---------------------------------------------------------------------
    const L = this.len - this.innerR;
    for (let i = 0; i < this.arms; i++) {
      this.armDir(i, theta, _v);
      this.sailQuat(_v, _q);
      _v2.copy(this.hub).addScaledVector(_v, this.innerR + L * 0.5);
      _v3.set(L * 0.5 + this.thick, this.thick * 0.5, this.chord * 0.5);
      const c = this.sailColliders[i];
      setColliderBox(c, _v2, _v3, _q);
      c.active = this.enabled;
      this._refreshBroad(c);
    }

    // --- gondola decks: pinned to the tip, GIMBALLED (never rotate with the arm) --------------
    if (this.deck) {
      const R = this.deck.r;
      const half = _v3.set(this.deck.d * 0.5, this.deck.t * 0.5, this.deck.w * 0.5);
      for (let i = 0; i < this.arms; i++) {
        this.armDir(i, theta, _v);
        _v2.copy(this.hub).addScaledVector(_v, R);
        const pair = this.deckMeshes[i];
        pair[0].position.copy(_v2);
        pair[1].position.copy(_v2);
        const c = this.deckColliders[i];
        setColliderBox(c, _v2, half, this.yawQ);
        c.active = this.enabled;
        this._refreshBroad(c);
      }
    }

    // --- tip dust ------------------------------------------------------------------------------
    const tipSpeed = Math.abs(this.omega) * this.len;
    for (let i = 0; i < this.moteCount; i++) {
      const md = this.moteData[i];
      const k = ((md.off + t / md.life) % 1 + 1) % 1;
      this.armDir(md.arm, theta - k * 0.55 * this.dirSign, _v);
      _v3.crossVectors(this.angAxis, _v).multiplyScalar(this.dirSign).normalize();
      _v2.copy(this.hub).addScaledVector(_v, this.len * (0.92 + k * 0.16))
        .addScaledVector(this.angAxis, md.lat)
        .addScaledVector(_v3, k * tipSpeed * 0.10);
      const fade = Math.sin(k * Math.PI);
      const sc = md.scale * clamp(fade, 0.02, 1) * clamp(tipSpeed / 6, 0.2, 1.4);
      _q.identity();
      _v3.setScalar(sc);
      _m.compose(_v2, _q, _v3);
      this.motes.setMatrixAt(i, _m);
    }
    this.motes.instanceMatrix.needsUpdate = true;
    this.moteMat.opacity = 0.10 + clamp(tipSpeed / 14, 0, 1) * 0.24;

    // --- readability ------------------------------------------------------------------------------
    const beat = 0.5 + 0.5 * Math.sin(theta * this.arms);
    this.stripeMat.opacity = 0.44 + 0.22 * beat;
    this.indexMat.opacity = 0.48 + 0.34 * (0.5 + 0.5 * Math.sin(theta * 3));
    if (this.trimMat) this.trimMat.opacity = 0.38 + 0.20 * (0.5 + 0.5 * Math.sin(t * 1.9));
    this.hubGlow.material.opacity = 0.07 + 0.05 * beat;

    // --- audio: one deep tick per revolution, plus a creak while somebody is riding ---------
    if (this.edge(this, '_lastRev', Math.floor(theta / TAU))) {
      hazSfx(this.ctx, 'gate_open', {
        gain: clamp(0.22 + tipSpeed * 0.012, 0.2, 0.5),
        rate: clamp(0.42 + 2.2 / this.period, 0.4, 1.1),
        pos: this.hub, ref: 14, max: 80,
      });
      hazBurst(this.ctx, 'dust', this.hub, { count: 5, speed: 1.4, spread: this.innerR * 1.4 });
    }
    if (this._silent) return;
    const ridable = this.deckColliders && this.deckColliders.length
      ? this.sailColliders.concat(this.deckColliders) : this.sailColliders;
    const rider = standingOn(resolvePlayer(this.ctx, player || this.__player), ridable, 0.28);
    if (rider && t - this._lastCreak > 0.45) {
      this._lastCreak = t;
      hazSfx(this.ctx, 'step_wood', {
        gain: 0.30, rate: clamp(0.48 + tipSpeed * 0.02, 0.45, 0.9),
        pos: this.hub, ref: 10, max: 36,
      });
    }
  }

  reset(t) {
    this._lastCreak = -9;
    super.reset(t);
  }

  /** CONTRACT §10 carry: v = linVel + angVel * (angAxis x (p - angCenter)). */
  velocityAtPoint(p, out) {
    out.copy(this.linVel);
    _v.subVectors(p, this.angCenter);
    _v2.crossVectors(this.angAxis, _v).multiplyScalar(this.angVel);
    return out.add(_v2);
  }

  onStand() {}
  onPound() {}
  onTouch() {}
}

/**
 * A windmill whose sails you ride.
 * `{kind:'mill', p:[HUB], arms?:int (default 4), len?:METRES (default 7),
 *   period:SECONDS PER REVOLUTION, phase?:FRACTION OF A REV, dir?:±1,
 *   yaw|yawDeg?, axis?:[x,y,z], chord?|w?:METRES, thick?:METRES, inner?:METRES,
 *   tower?:METRES (0 = no tower), towerR?:METRES,
 *   deck?:{w, d, t, r?} (a GIMBALLED gondola at every arm tip — see the constructor)}`
 *
 * `p` is the AXLE, not the tower base — the tower is built `tower` metres DOWN from it. `period`
 * is SECONDS PER REVOLUTION and `phase` is a FRACTION of one (not seconds, not radians), exactly
 * as `rotor` and `mover` use it. The axle is horizontal by construction: an authored `axis` with
 * |y| > 0.92 is rejected and replaced with the mill's facing.
 *
 * Every sail is a SOLID shelf (`props.mill = true`) whose face points along the direction of
 * travel, and the mill publishes `angVel` / `angAxis` / `angCenter` / `velocityAtPoint(p, out)`
 * so a standing hero is carried round. The tower drum and its gallery balcony are solid too.
 */
export function mill(def, ctx) { return new MillHazard(def, ctx); }
