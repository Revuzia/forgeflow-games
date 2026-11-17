// core/chars/hold.js — THIRD-PERSON WEAPON HOLD (2026-11-15 hold pass)
//
// WHY THIS EXISTS. Until v152 the 3P gun followed the hands: actor.js aimed the
// bore from the firing palm through the support hand's knuckle, wherever the
// shared Mixamo rifle clips (plus the life layer's arm channels) happened to put
// the two hands. Those clips were authored for ONE rifle, so every other gun —
// and every state the clips do not cover — came out wrong. Captured in the kill
// cam (_shots/v152/rkc_sheet.png): the rifle angled up beside the face, the stock
// floating, the support hand off the handguard; the pistol held at the chin; the
// launcher carried across the chest like a rifle.
//
// WHAT IT DOES NOW. The gun leads and the arms follow:
//   1. a target transform for the WEAPON is built from the body every frame —
//      aimed: the sight line on the eye, muzzle along the aim, butt in the
//      shoulder (cheek on the comb, clavicle up); ready / carry / sprint / reload
//      poses pivot about the shoulder pocket or the hip; the life layer's recoil,
//      hunt, flinch and knife thrust are applied to the GUN, not to the arms;
//   2. both arms are solved onto it with an analytic two-bone IK (elbow poles per
//      weapon class), and both hands are given the gun-relative orientation they
//      had in the authored rifle grip (captured once at attach), so the right
//      palm sits on the pistol grip and the support knuckle on that weapon's own
//      handguard / pump / tube / the firing hand (pistol, mirrored grip).
//   3. the weapon holder stays a rigid child of the firing hand: when the IK
//      reaches, the gun is exactly where step 1 put it; when it cannot, the gun
//      stays IN the hand rather than floating.
// Per-weapon numbers live in HOLD below, in the bot proto's frame (origin = the
// pistol-grip anchor, +Z muzzle, +Y up, +X = the gun's LEFT side), measured off
// the generated 3P GLBs (tools/a5_build_guns.py `3p:<id>`).
//
// View-only: reads the same sim-published state the life layer reads (aim, ready,
// stance, speed, reload overlay, recoil springs); writes bones only.

import * as THREE from "three";

// eye  : where the shooter's (right) eye sits in gun space when the gun is up
// butt : the point that rides the shoulder pocket in the ready poses
// sup  : the support hand's MIDDLE KNUCKLE on the gun (handguard / pump / tube)
// mag  : the reload hand's target (magwell / loading port / tube breech)
// ready: low-ready (or carry) pose: pivot "shoulder" (butt in the pocket) or
//        "hip" (grip at the hip), muzzle pitch/yaw(inward +)/roll in rad
// pocket: aimed long guns are placed partly from the eye and partly from the
//        butt-in-the-shoulder-pocket constraint (0 = eye only); the head then
//        tilts onto the comb by however far the sight line ended up below the eye
// run  : the moving carry (walk/run) — same fields as ready, blended by speed
// sprint: the sprint carry
// cheek: weight of the head-on-stock tilt when aimed (0 = upright head)
// clav : right clavicle lift when aimed (rad) — gets the pocket under the butt
export const HOLD = {
  ar: {
    eye: [0.02, 0.122, -0.035], butt: [0, 0.035, -0.255], sup: [0.034, 0.042, 0.330], mag: [0.0, -0.05, 0.13],
    ready: { pivot: "shoulder", pitch: -0.62, yaw: 0.32, roll: 0.12 },
    run: { pivot: "shoulder", pitch: -0.50, yaw: 0.40, roll: 0.18 },
    sprint: { pivot: "chest", pitch: -0.55, yaw: 0.95, roll: 0.55, at: [0.04, -0.20, 0.27] },
    cheek: 1, clav: 0.12, pocket: 0.45, poleR: [0.45, -0.9, -0.2], poleL: [0.25, -1, 0.1],
  },
  smg: {
    eye: [0.02, 0.112, -0.035], butt: [0, 0.030, -0.245], sup: [0.032, 0.036, 0.255], mag: [0.0, -0.05, 0.08],
    ready: { pivot: "shoulder", pitch: -0.62, yaw: 0.30, roll: 0.10 },
    run: { pivot: "shoulder", pitch: -0.48, yaw: 0.38, roll: 0.16 },
    sprint: { pivot: "chest", pitch: -0.55, yaw: 0.95, roll: 0.55, at: [0.04, -0.20, 0.25] },
    cheek: 1, clav: 0.12, pocket: 0.45, poleR: [0.45, -0.9, -0.2], poleL: [0.25, -1, 0.1],
  },
  sniper: {
    eye: [0.02, 0.150, -0.115], butt: [0, 0.035, -0.335], sup: [0.036, 0.040, 0.400], mag: [0.0, -0.05, 0.10],
    ready: { pivot: "shoulder", pitch: -0.62, yaw: 0.30, roll: 0.12 },
    run: { pivot: "shoulder", pitch: -0.52, yaw: 0.38, roll: 0.16 },
    sprint: { pivot: "chest", pitch: -0.55, yaw: 0.95, roll: 0.55, at: [0.04, -0.20, 0.28] },
    cheek: 1, clav: 0.12, pocket: 0.45, poleR: [0.45, -0.9, -0.2], poleL: [0.25, -1, 0.1],
  },
  shotgun: {
    eye: [0.02, 0.135, -0.020], butt: [0, 0.020, -0.235], sup: [0.034, 0.050, 0.330], mag: [0.0, -0.02, 0.12],
    ready: { pivot: "shoulder", pitch: -0.62, yaw: 0.30, roll: 0.12 },
    run: { pivot: "shoulder", pitch: -0.50, yaw: 0.40, roll: 0.18 },
    sprint: { pivot: "chest", pitch: -0.55, yaw: 0.95, roll: 0.55, at: [0.04, -0.20, 0.27] },
    cheek: 1, clav: 0.12, pocket: 0.45, poleR: [0.45, -0.9, -0.2], poleL: [0.25, -1, 0.1],
  },
  // heavier, lower carry: the ready and moving poses are a hip carry (grip at the
  // hip, muzzle a touch down), shouldered only when it fires
  lmg: {
    eye: [0.02, 0.150, -0.110], butt: [0, 0.030, -0.335], sup: [0.040, 0.050, 0.330], mag: [0.05, -0.04, 0.10],
    ready: { pivot: "hip", pitch: -0.20, yaw: 0.22, roll: 0.05, at: [0.02, -0.40, 0.16] },
    run: { pivot: "hip", pitch: -0.24, yaw: 0.30, roll: 0.08, at: [0.03, -0.42, 0.14] },
    sprint: { pivot: "hip", pitch: -0.40, yaw: 0.55, roll: 0.20, at: [0.06, -0.44, 0.12] },
    cheek: 1, clav: 0.12, pocket: 0.45, reloadLift: 0.22, poleR: [0.85, -0.6, -0.3], poleL: [0.2, -1, 0.05],
  },
  // on the shoulder when it fires (tube on top of the right shoulder, the eye
  // along its left side), carried low when it does not
  launcher: {
    eye: [0.085, 0.175, -0.10], butt: [0, 0.10, -0.40], sup: [0.030, 0.050, 0.300], mag: [0.0, 0.10, -0.42],
    ready: { pivot: "hip", pitch: -0.16, yaw: 0.20, roll: 0.0, at: [0.02, -0.40, 0.14] },
    run: { pivot: "hip", pitch: -0.22, yaw: 0.28, roll: 0.05, at: [0.03, -0.42, 0.12] },
    sprint: { pivot: "hip", pitch: -0.35, yaw: 0.50, roll: 0.15, at: [0.05, -0.44, 0.10] },
    cheek: 0.6, clav: 0.12, reloadLift: 0.12, poleR: [0.9, -0.7, -0.2], poleL: [0.3, -1, 0.0],
  },
  // two-handed pistol: isosceles when it fires (arms out, sights at the eye),
  // compressed low ready otherwise; the support hand wraps the firing hand
  pistol: {
    eye: [0, 0.095, -0.44], butt: [0, 0, 0], sup: null, mag: [0.0, -0.10, -0.01],
    ready: { pivot: "chest", pitch: -0.75, yaw: 0.10, roll: 0.0, at: [0.06, -0.10, 0.30] },
    run: { pivot: "chest", pitch: -0.85, yaw: 0.12, roll: 0.0, at: [0.07, -0.14, 0.28] },
    sprint: { pivot: "chest", pitch: -1.05, yaw: 0.15, roll: 0.0, at: [0.12, -0.24, 0.22] },
    cheek: 0, clav: 0.05, poleR: [0.35, -1, -0.1], poleL: [0.35, -1, -0.1],
    // support hand: the firing hand's grip mirrored across the gun's mid-plane,
    // then moved onto the off side of the grip, a little low and forward
    wrapOff: [0.026, -0.018, 0.012],
  },
};

// scratch (module-level, zero allocations per frame)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3();
const _F = new THREE.Vector3(), _L = new THREE.Vector3(), _U = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _P1 = new THREE.Vector3(), _P2 = new THREE.Vector3(), _P3 = new THREE.Vector3();
const _W = new THREE.Vector3(), _S = new THREE.Vector3(), _K = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _Q1 = new THREE.Quaternion(), _Q2 = new THREE.Quaternion(), _Q3 = new THREE.Quaternion();
const _QH = new THREE.Quaternion(), _QL = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** World quaternion for a gun whose muzzle points along `d` (unit) with `roll`
 *  about it (+ = top of the gun toward the shooter's left). */
function gunBasis(d, roll, out) {
  _x.crossVectors(_U, d);                       // gun LEFT, horizontal
  if (_x.lengthSq() < 1e-8) _x.copy(_L);
  _x.normalize();
  _y.crossVectors(d, _x);                       // gun up
  _m.makeBasis(_x, _y, d);
  out.setFromRotationMatrix(_m);
  if (roll) out.multiply(_qa.setFromAxisAngle(_AZ, -roll));
  return out;
}
const _AZ = new THREE.Vector3(0, 0, 1);

/** Unit muzzle direction: chest forward turned `yaw` toward the left, `pitch` up. */
function dirOf(yaw, pitch, out) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  out.set(
    (_F.x * cy + _L.x * sy) * cp,
    sp,
    (_F.z * cy + _L.z * sy) * cp,
  );
  return out.normalize();
}

// ---- world-matrix helpers (PERF). The solve reads and writes ~14 bones per actor per
// frame; Object3D.getWorldPosition/Quaternion walk every ancestor and updateMatrixWorld(true)
// re-composes whole subtrees (fingers, the gun), which measured ~0.07 ms/actor. Instead the
// chains the solve touches are refreshed ONCE, in order, parent first (wupd), and reads come
// straight off matrixWorld. The renderer's own scene update fills in everything else.
const _dp = new THREE.Vector3(), _ds = new THREE.Vector3();
function wupd(b) {
  if (!b) return;
  b.updateMatrix();
  b.matrixWorld.multiplyMatrices(b.parent.matrixWorld, b.matrix);
}
function wpos(b, out) { return out.setFromMatrixPosition(b.matrixWorld); }
function wquat(b, out) { b.matrixWorld.decompose(_dp, out, _ds); return out; }

function setWorldQuat(bone, q) {
  wquat(bone.parent, _qb);
  bone.quaternion.copy(_qb.invert().multiply(q));
}

/** Rotate `bone` by the world-space swing taking direction `from` to `to`. */
function swing(bone, from, to) {
  _q.setFromUnitVectors(from, to);
  wquat(bone, _qa);
  _qa.premultiply(_q);
  setWorldQuat(bone, _qa);
  wupd(bone);
}

/**
 * Analytic two-bone IK: put the wrist (hand bone origin) on `target`, elbow in
 * the half-plane of `pole` (world direction). arm/fore/hand are bones whose
 * matrixWorld is current (wupd chain).
 */
function twoBone(arm, fore, hand, target, pole) {
  wpos(arm, _a);
  wpos(fore, _b);
  wpos(hand, _c);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  _u.subVectors(target, _a);
  let d = _u.length();
  if (d < 1e-5) return;
  _u.multiplyScalar(1 / d);
  d = Math.min((l1 + l2) * 0.9995, Math.max(Math.abs(l1 - l2) + 1e-3, d));
  _p.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_p.lengthSq() < 1e-8) { _p.set(0, -1, 0).addScaledVector(_u, -_u.y); }
  _p.normalize();
  const ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  _e.copy(_a).addScaledVector(_u, l1 * ca).addScaledVector(_p, l1 * sa);   // new elbow
  _d0.subVectors(_b, _a).normalize();
  _d1.subVectors(_e, _a).normalize();
  swing(arm, _d0, _d1);
  wupd(fore); wupd(hand);
  wpos(fore, _b);
  wpos(hand, _c);
  _t.copy(_a).addScaledVector(_u, d);                                     // reachable wrist
  _d0.subVectors(_c, _b).normalize();
  _d1.subVectors(_t, _b).normalize();
  swing(fore, _d0, _d1);
  wupd(hand);
}

/**
 * Move half of the hand's twist about the forearm axis into the forearm, so the
 * wrist skin does not candy-wrap (the rig has no twist bones). Wrist position is
 * unchanged (rotation about the forearm's own axis). `ref` is the authored
 * forearm->hand quaternion captured from the settled idle.
 */
const _tw = new THREE.Quaternion(), _ax = new THREE.Vector3();
function shareTwist(fore, hand, ref, share) {
  // hand rotation relative to the forearm, minus the authored relation
  wquat(fore, _qa);
  wquat(hand, _Q3);
  _tw.copy(_qa).invert().multiply(_Q3).multiply(_Q1.copy(ref).invert()); // extra, forearm frame
  // swing-twist decomposition about the forearm's bone axis (+Y on this rig)
  _ax.set(_tw.x, _tw.y, _tw.z);
  const proj = _ax.y;
  _Q2.set(0, proj, 0, _tw.w);
  const n = Math.hypot(_Q2.y, _Q2.w);
  if (n < 1e-6) return;
  _Q2.y /= n; _Q2.w /= n;
  if (_Q2.w < 0) { _Q2.y = -_Q2.y; _Q2.w = -_Q2.w; }
  const ang = 2 * Math.atan2(_Q2.y, _Q2.w) * share;
  _Q2.setFromAxisAngle(_AY, ang);              // twist share, forearm-local
  // forearm gets it; the hand keeps its WORLD rotation
  fore.quaternion.multiply(_Q2);
  wupd(fore);
  setWorldQuat(hand, _Q3);
  wupd(hand);
}
const _AY = new THREE.Vector3(0, 1, 0);

/**
 * createHold(rig) — per actor. rig = { root, bones, byName, grips } (actor.js
 * internals). Returns { attach(h, kind), solve(s, dt) , active }.
 */
export function createHold(rig) {
  const { bones } = rig;
  const B = {
    rArm: bones.rArm, rFore: bones.rFore, rHand: bones.rHand,
    lArm: bones.lArm, lFore: bones.lFore, lHand: bones.lHand,
    lK: bones.lKnuckle, head: bones.head, neck: bones.neck,
    // HeadTop_End is an Object3D leaf, not a Bone (actor.js byName holds bones only)
    headTop: bones.head ? bones.head.children.find((c) => /HeadTop/i.test(c.name)) || null : null,
    rClav: rig.byName.get("RightShoulder") || null,
    lClav: bones.lArm ? bones.lArm.parent : null,
    spine2: bones.spine2 || bones.spine1, hips: bones.hips,
  };
  const ok = !!(B.rArm && B.rFore && B.rHand && B.lArm && B.lFore && B.lHand && B.head && B.spine2);
  const st = {
    ok, kind: null, h: null, spec: null,
    qHold: new THREE.Quaternion(),     // holder in hand frame (rigid)
    gripY: 0,                          // palm offset along the hand bone, metres
    qL: new THREE.Quaternion(),        // support hand in gun frame
    kL: new THREE.Vector3(),           // wrist -> middle knuckle, hand frame (metres)
    refR: new THREE.Quaternion(), refL: new THREE.Quaternion(),   // forearm->hand authored
    w: 0,                              // eased on/off
    runW: 0, sprintW: 0, reloadW: 0,
    // the authored arm pose (pre-IK) for the on/off ease
    pre: [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(),
          new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
    // last solved weapon pose (world), exposed for muzzle queries / debug
    wp: new THREE.Vector3(), wq: new THREE.Quaternion(),
  };

  // The AUTHORED GRIP, captured once per actor from the settled rifle idle (call
  // capture() right after the idle settle, before anything else poses the arms):
  // the firing hand's rotation relative to a gun whose bore runs from the palm
  // through the support knuckle (actor.solveGrip's construction, canonical 5 cm
  // handguard height), and the support hand's pose in that gun's frame. Every
  // weapon reuses it — a hand closes on a pistol grip the same way on any gun.
  const cap = {
    qHold: new THREE.Quaternion(), qL: new THREE.Quaternion(), kL: new THREE.Vector3(),
    refR: new THREE.Quaternion(), refL: new THREE.Quaternion(), done: false,
  };
  function capture(gripY) {
    if (!ok) return;
    rig.root.updateMatrixWorld(true);
    st.gripY = gripY;
    B.rHand.getWorldQuaternion(_Q2);
    B.rHand.getWorldPosition(_c);
    _P1.set(0, gripY, 0).applyQuaternion(_Q2).add(_c);         // palm
    (B.lK || B.lHand).getWorldPosition(_K);
    _dir.subVectors(_K, _P1);
    const span = _dir.length();
    _dir.multiplyScalar(1 / Math.max(1e-4, span));
    _x.crossVectors(Math.abs(_dir.y) > 0.94 ? _AZ : _U, _dir).normalize();
    _y.crossVectors(_dir, _x);
    _m.makeBasis(_x, _y, _dir);
    _Q1.setFromRotationMatrix(_m);
    const sn = Math.min(0.5, 0.05 / Math.max(0.12, span));
    _Q1.multiply(_qa.setFromAxisAngle(_AX, Math.asin(sn)));     // gun world (idle)
    cap.qHold.copy(_Q2).invert().multiply(_Q1);
    B.lHand.getWorldQuaternion(_Q3);
    cap.qL.copy(_Q1).invert().multiply(_Q3);
    if (B.lK) {
      B.lK.getWorldPosition(_K); B.lHand.getWorldPosition(_c);
      cap.kL.subVectors(_K, _c).applyQuaternion(_qb.copy(_Q3).invert());
    }
    B.rFore.getWorldQuaternion(_Q1);
    cap.refR.copy(_Q1).invert().multiply(_Q2);
    B.lFore.getWorldQuaternion(_Q1);
    cap.refL.copy(_Q1).invert().multiply(_Q3);
    cap.done = true;
  }

  function attach(h, kind) {
    st.kind = kind; st.h = h;
    st.spec = HOLD[kind] || HOLD.ar;
    if (!ok || !cap.done) return;
    st.qHold.copy(cap.qHold);
    st.kL.copy(cap.kL);
    st.refR.copy(cap.refR); st.refL.copy(cap.refL);
    if (st.spec.sup === null) {
      // PISTOL support hand: mirror the firing hand's gun-relative rotation across
      // the gun's mid-plane (x, -y, -z, w) — the rig's L/R rests are mirror images
      _q.copy(st.qHold).invert();                        // firing hand in gun frame
      st.qL.set(_q.x, -_q.y, -_q.z, _q.w);
    } else {
      st.qL.copy(cap.qL);
    }
  }

  /**
   * s: { ry, aimYaw, aimPitch, aimW, readyW, speed, crouch, armK, engA, flinch,
   *      melee, reload (0..1 phase or -1), on (bool) }
   */
  function solve(s, dt) {
    if (!ok || !st.h) return false;
    const k = dt > 0 ? 1 - Math.exp(-9 * dt) : 1;
    st.w += ((s.on ? 1 : 0) - st.w) * (s.on && st.w === 0 ? 1 : k);
    if (st.w < 0.002) { st.w = 0; return false; }
    const S0 = st.spec;
    // refresh exactly the chains the solve reads (see the PERF note on wupd)
    B.spine2.updateWorldMatrix(true, false);
    wupd(B.neck); wupd(B.head); wupd(B.headTop);
    wupd(B.rClav); wupd(B.rArm); wupd(B.rFore); wupd(B.rHand);
    wupd(B.lClav); wupd(B.lArm); wupd(B.lFore); wupd(B.lHand);

    // ---- body frame: chest yaw (aim yaw folded in), world up -------------
    const ry = s.ry + s.aimYaw;
    _F.set(Math.sin(ry), 0, Math.cos(ry));
    _L.crossVectors(_U, _F);                             // his left

    // gait weights (eased): moving carry and sprint carry
    const kk = dt > 0 ? 1 - Math.exp(-7 * dt) : 1;
    const runWant = Math.min(1, Math.max(0, (s.speed - 0.8) / 1.6));
    const sprWant = Math.min(1, Math.max(0, (s.speed - 4.4) / 0.8));
    st.runW += (runWant - st.runW) * kk;
    st.sprintW += (sprWant - st.sprintW) * kk;
    st.reloadW += ((s.reload >= 0 ? 1 : 0) - st.reloadW) * (dt > 0 ? 1 - Math.exp(-10 * dt) : 1);

    // recoil (armK > 0 climbs), hunt, flinch -> rotation about the butt
    const recoilP = s.armK * 0.55 + s.engA * 0.30;

    // ---- AIMED pose: sight line on the eye ---------------------------------
    // eye: the Head joint is the skull base (jaw level on this rig) and HeadTop the
    // crown; the eyes sit ~45% of the way up, ~9 cm forward, the right one 3 cm over
    wpos(B.head, _W);
    if (B.headTop) {
      wpos(B.headTop, _t);
      _W.lerp(_t, 0.5);
    } else _W.addScaledVector(_U, 0.11);
    _W.addScaledVector(_F, 0.070).addScaledVector(_L, -0.025);
    dirOf(0, s.aimPitch + recoilP, _dir);
    gunBasis(_dir, 0, _QH);
    _P1.set(S0.eye[0], S0.eye[1], S0.eye[2]).applyQuaternion(_QH);
    _P1.subVectors(_W, _P1);                              // gun origin from the eye
    if (S0.pocket) {
      // ...and from the butt in the shoulder pocket (same orientation)
      wpos(B.rArm, _S);
      _S.addScaledVector(_L, 0.07).addScaledVector(_F, 0.05).addScaledVector(_U, 0.03);
      _t.set(S0.butt[0], S0.butt[1], S0.butt[2]).applyQuaternion(_QH);
      _S.sub(_t);
      _P1.lerp(_S, S0.pocket);
    }
    // how far below the eye the sight line now runs (drives the cheek tilt)
    _t.set(S0.eye[0], S0.eye[1], S0.eye[2]).applyQuaternion(_QH).add(_P1);
    const eyeDrop = Math.max(0, _W.y - _t.y);
    _Q1.copy(_QH);

    // ---- READY / RUN / SPRINT carry ---------------------------------------
    const carry = (spec, outP, outQ) => {
      dirOf(spec.yaw, spec.pitch + recoilP * 0.6, _dir);
      gunBasis(_dir, spec.roll, outQ);
      if (spec.pivot === "shoulder") {
        // butt in the shoulder pocket: inboard of the joint, a touch forward
        wpos(B.rArm, _S);
        _S.addScaledVector(_L, 0.075).addScaledVector(_F, 0.06).addScaledVector(_U, 0.01);
        _t.set(S0.butt[0], S0.butt[1], S0.butt[2]).applyQuaternion(outQ);
        outP.subVectors(_S, _t);
      } else {
        // grip at a body point: hip = from the right shoulder down; chest = spine2
        const at = spec.at;
        if (spec.pivot === "hip") wpos(B.rArm, _S);
        else wpos(B.spine2, _S);
        _S.addScaledVector(_L, -at[0]).addScaledVector(_U, at[1]).addScaledVector(_F, at[2]);
        outP.copy(_S);
      }
    };
    carry(S0.ready, _P2, _Q2);
    if (st.runW > 0.001) {
      carry(S0.run, _P3, _Q3);
      _P2.lerp(_P3, st.runW); _Q2.slerp(_Q3, st.runW);
    }
    if (st.sprintW > 0.001) {
      carry(S0.sprint, _P3, _Q3);
      _P2.lerp(_P3, st.sprintW); _Q2.slerp(_Q3, st.sprintW);
    }
    // aimed vs carried (readyW is the sim's aim/combat state, eased by actor.js)
    // a reload brings the gun DOWN off the shoulder (to the ready pose, below)
    const up = s.readyW * (1 - st.sprintW) * (1 - st.reloadW);
    st.wp.lerpVectors(_P2, _P1, up);
    st.wq.slerpQuaternions(_Q2, _Q1, up);

    // ---- reload: cant the gun, bring it in toward the chest -----------------
    if (st.reloadW > 0.001) {
      const r = st.reloadW;
      // from the ready pose: muzzle back up to just under level, canted top-right
      // so the mag well faces the left hand, the gun drawn in to the chest
      _qa.setFromAxisAngle(_AZ, 0.55 * r);
      _qb.setFromAxisAngle(_AX, -(S0.reloadLift != null ? S0.reloadLift : 0.50) * r);
      st.wq.multiply(_qb).multiply(_qa);
      st.wp.addScaledVector(_F, -0.04 * r).addScaledVector(_U, 0.04 * r).addScaledVector(_L, 0.05 * r);
    }
    // ---- knife thrust: the gun punches out along its own line --------------
    if (s.melee) {
      _t.set(0, 0, 1).applyQuaternion(st.wq);
      st.wp.addScaledVector(_t, 0.30 * s.melee);
    }

    // ---- head on the stock, clavicle up (aimed long guns) -------------------
    const cheekW = up * (1 - st.reloadW) * S0.cheek;
    if (cheekW > 0.001 && B.neck) {
      // pitch forward and roll toward the stock (about the chest's axes)
      _q.setFromAxisAngle(_L, Math.min(0.42, 0.10 + eyeDrop * 3.0) * cheekW);  // + about LEFT = chin down
      rotW(B.neck, _q);
      _q.setFromAxisAngle(_F, 0.14 * cheekW);            // roll the head toward his right
      rotW(B.neck, _q);
    }
    if (B.rClav && S0.clav) {
      _q.setFromAxisAngle(_F, -S0.clav * up);            // lift the right shoulder
      rotW(B.rClav, _q);
      wupd(B.rArm); wupd(B.rFore); wupd(B.rHand);
    }

    // ---- remember the authored arm pose for the on/off ease -----------------
    const ease = st.w < 0.999;
    if (ease) {
      st.pre[0].copy(B.rArm.quaternion); st.pre[1].copy(B.rFore.quaternion); st.pre[2].copy(B.rHand.quaternion);
      st.pre[3].copy(B.lArm.quaternion); st.pre[4].copy(B.lFore.quaternion); st.pre[5].copy(B.lHand.quaternion);
    }

    // ---- RIGHT arm: wrist onto the grip, hand in the authored grip rotation --
    _QH.copy(st.wq).multiply(_qa.copy(st.qHold).invert());   // hand world rotation
    _t.set(0, st.gripY, 0).applyQuaternion(_QH);
    _t.subVectors(st.wp, _t);                             // wrist target
    vec(S0.poleR, _p);
    twoBone(B.rArm, B.rFore, B.rHand, _t, _p);
    setWorldQuat(B.rHand, _QH);
    wupd(B.rHand);
    shareTwist(B.rFore, B.rHand, st.refR, 0.5);

    // ---- LEFT arm: support knuckle on the gun ------------------------------
    _QL.copy(st.wq).multiply(st.qL);                       // support hand world rotation
    if (S0.sup) {
      _K.set(S0.sup[0], S0.sup[1], S0.sup[2]);
    } else {
      // pistol: the firing hand's wrist point mirrored to the off side + wrap offset,
      // expressed as the knuckle point so the same path below places it
      _t.set(0, -st.gripY, 0).applyQuaternion(_qa.copy(st.qHold).invert());  // R wrist, gun frame
      _K.set(-_t.x + S0.wrapOff[0], _t.y + S0.wrapOff[1], _t.z + S0.wrapOff[2]);
      _t.copy(st.kL).applyQuaternion(st.qL);
      _K.add(_t);
    }
    // reload: knuckle path handguard -> magwell -> pouch -> magwell -> handguard
    if (st.reloadW > 0.001 && s.reload >= 0) {
      const ph = s.reload;
      const seg = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
      const sm = (x) => x * x * (3 - 2 * x);
      _P3.set(S0.mag[0] + 0.03, S0.mag[1], S0.mag[2]);    // magwell (gun frame)
      const toMag = sm(seg(0.02, 0.16, ph)) * (1 - sm(seg(0.80, 0.96, ph)));
      const toPouch = sm(seg(0.18, 0.34, ph)) * (1 - sm(seg(0.40, 0.58, ph)));
      _K.lerp(_P3, toMag * st.reloadW);
      _K.applyQuaternion(st.wq).add(st.wp);                // -> world
      if (toPouch > 0) {
        // pouch on the left front of the belt
        wpos(B.hips, _S);
        _S.addScaledVector(_L, 0.16).addScaledVector(_F, 0.14).addScaledVector(_U, 0.02);
        _K.lerp(_S, toPouch * st.reloadW);
      }
    } else {
      _K.applyQuaternion(st.wq).add(st.wp);
    }
    _t.copy(st.kL).applyQuaternion(_QL);
    _t.subVectors(_K, _t);                                // wrist target
    vec(S0.poleL, _p);
    twoBone(B.lArm, B.lFore, B.lHand, _t, _p);
    setWorldQuat(B.lHand, _QL);
    wupd(B.lHand);
    shareTwist(B.lFore, B.lHand, st.refL, 0.5);

    if (ease) {
      const w = st.w;
      B.rArm.quaternion.slerpQuaternions(st.pre[0], B.rArm.quaternion, w);
      B.rFore.quaternion.slerpQuaternions(st.pre[1], B.rFore.quaternion, w);
      B.rHand.quaternion.slerpQuaternions(st.pre[2], B.rHand.quaternion, w);
      B.lArm.quaternion.slerpQuaternions(st.pre[3], B.lArm.quaternion, w);
      B.lFore.quaternion.slerpQuaternions(st.pre[4], B.lFore.quaternion, w);
      B.lHand.quaternion.slerpQuaternions(st.pre[5], B.lHand.quaternion, w);
    }
    // the holder stays rigid in the firing hand: gun = hand * qHold
    st.h.holder.quaternion.copy(st.qHold);
    return true;
  }

  // body-frame direction -> world (x = his RIGHT, y = up, z = forward)
  function vec(v, out) {
    return out.set(0, 0, 0).addScaledVector(_L, -v[0]).addScaledVector(_U, v[1]).addScaledVector(_F, v[2]).normalize();
  }
  function rotW(bone, q) {
    wquat(bone.parent, _qb);
    // world rotation q applied to the bone: local = parent^-1 * q * parent * local
    _Q3.copy(_qb).invert().multiply(q).multiply(_qb);
    bone.quaternion.premultiply(_Q3);
    wupd(bone);
  }

  return { capture, attach, solve, state: st, get active() { return st.w > 0.5; } };
}
const _AX = new THREE.Vector3(1, 0, 0);
