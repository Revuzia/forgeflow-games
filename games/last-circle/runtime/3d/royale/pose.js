import * as THREE from "three";
/**
 * royale/pose.js — runtime arm-pose layer (Dungeon Forge relaxArms technique).
 *
 * Meshy's animation library retargets unreliably on these rigs: "Alert" folded
 * both arms across the face, idles keep the arms held out radially — the
 * "broken bone" look from the owner's screenshots. Clips can't be trusted for
 * the arms, so every frame AFTER the mixer runs (the kernel updates mixers
 * before game updaters) we steer each arm chain toward a world-space target
 * direction per state: relaxed, weapon-ready, skydive, canopy hang, reload.
 * Legs/torso keep the authored animation; arms always read correctly.
 */

/** Cache the arm + leg chain bones by Meshy rig name (Mixamo-style). */
export function findArmBones(root) {
  const b = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    switch (o.name) {
      case "RightArm": b.rArm = o; break;
      case "RightForeArm": b.rFore = o; break;
      case "RightHand": b.rHand = o; break;
      case "LeftArm": b.lArm = o; break;
      case "LeftForeArm": b.lFore = o; break;
      case "LeftHand": b.lHand = o; break;
      case "RightUpLeg": b.rUpLeg = o; break;
      case "RightLeg": b.rLeg = o; break;
      case "RightFoot": b.rFoot = o; break;
      case "LeftUpLeg": b.lUpLeg = o; break;
      case "LeftLeg": b.lLeg = o; break;
      case "LeftFoot": b.lFoot = o; break;
      case "Spine01": b.spine1 = o; break;
      case "Spine02": b.spine2 = o; break;
      case "Spine": b.spine = o; break;
      case "Hips": b.hips = o; break;
      case "neck": case "Neck": b.neck = o; break;
      case "Head": b.head = o; break;
    }
  });
  return (b.rArm && b.lArm) ? b : null;
}

// Measure a rig's forward torso lean (radians from vertical) in its current
// pose — used at load to detect defective slouching rigs (Meshy shipped the
// drifter at ~27° while the rest sit at 1-5°).
export function measureLean(bones) {
  if (!bones || !bones.hips || !bones.head) return 0;
  bones.head.getWorldPosition(_p1); bones.hips.getWorldPosition(_p2);
  const dx = _p1.x - _p2.x, dy = _p1.y - _p2.y, dz = _p1.z - _p2.z;
  return Math.atan2(Math.hypot(dx, dz), Math.max(0.01, dy));
}

// Rotate the base Spine so the head sits back over the hips — straightens a
// slouched rig to a natural ~4° stance. Runs after the mixer, before render.
const _upTarget = [0, 1, 0.07];   // actor-local: mostly up, hair of forward lean
/**
 * Crouch stance, applied AFTER the mixer like every other layer here.
 *
 * The sim shrinks a crouching actor's hit capsule to 62% of standing height, so
 * the model has to actually come down — otherwise you would be shooting at a
 * head that is no longer hittable. There is no crouch clip in the Meshy library
 * for these rigs, so it is authored procedurally: drop the hips, fold the legs,
 * settle the torso forward over them.
 *
 * Deltas are RELATIVE to whatever the animation posed this frame (the same
 * approach as the sprint straightening), because the bind poses differ per skin
 * and absolute angles do not transfer.
 */
export function uprightTorso(obj, bones, weight) {
  if (!bones || !bones.spine || !bones.neck || weight <= 0) return;
  obj.getWorldQuaternion(_oq);
  aim(bones.spine, bones.neck, _oq, _upTarget[0], _upTarget[1], _upTarget[2], Math.min(1, weight) * 0.9);
}

// scratch (module-local, reused every frame — no per-call allocation)
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _t = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _oq = new THREE.Quaternion();

/** Slerp `arm` so the arm→child segment points along local dir (tx,ty,tz),
 *  where local = the actor object's frame (+Z forward, +Y up). */
function aim(arm, child, oq, tx, ty, tz, blend) {
  if (!arm || !child || blend <= 0) return;
  arm.getWorldPosition(_p1); child.getWorldPosition(_p2);
  _p2.sub(_p1); if (_p2.lengthSq() < 1e-8) return;
  _p2.normalize();
  _t.set(tx, ty, tz).normalize().applyQuaternion(oq);   // local → world
  _q1.setFromUnitVectors(_p2, _t);                       // world-space correction
  arm.getWorldQuaternion(_q2);
  _q1.multiply(_q2);
  arm.parent.getWorldQuaternion(_q3);
  _q3.invert().multiply(_q1);                            // → bone-local
  arm.quaternion.slerp(_q3, blend);
}

// Per-mode target dirs, actor-local (+Z = facing, +X = model left, tuned live):
//   [rArmDir, rForeDir, lArmDir, lForeDir] + optional legs
//   [rUpLegDir, rLegDir, lUpLegDir, lLegDir]
export const POSES = {
  // arms hang at the sides (menu, unarmed)
  relax: [[-0.28, -1, 0.02], [-0.1, -1, 0.06], [0.28, -1, 0.02], [0.1, -1, 0.06]],
  // two-handed gun at chest: right forearm forward (gun points +Z), left hand
  // reaches to the weapon's fore-end
  // rArm was [-0.22,-0.85,0.42]: the firing elbow floated forward and away from
  // the ribs, which held the weapon at arm's length — measured, the right hand
  // sat 0.628 m from the LEFT shoulder while that arm is only 0.558 m long, so
  // the support hand could not reach the handguard at all and hung in mid-air.
  // Tucking the elbow toward the side (the real rifle carry: stock in the
  // shoulder pocket, weapon close to the chest) pulls the hand to 0.579 m and
  // makes a natural 50%-along grip point reachable. Measured across candidates:
  //   [-0.22,-0.85,0.42] -> 0.628 m, only 35% along reachable
  //   [-0.14,-0.97,0.18] -> 0.579 m, 50% along reachable   <- chosen
  //   [-0.10,-0.99,0.08] -> 0.557 m, 55% (elbow pinned vertical, reads stiff)
  gunReady: [[-0.14, -0.97, 0.18], [-0.06, 0.1, 0.99], [0.3, -0.8, 0.42], [-0.42, 0.16, 0.88]],
  // relaxed carry OUT of combat: gun lowered ~30° muzzle-down, both hands still on it
  // (snaps up to gunReady on ADS/fire) — 50 actors all holding a rigid ready-pose read robotic
  lowReady: [[-0.2, -0.92, 0.30], [-0.05, -0.52, 0.85], [0.26, -0.86, 0.32], [-0.34, -0.42, 0.83]],
  // belly-down skydive "box/arch": upper arms out to the sides at shoulder
  // level, forearms bent ~90° at the elbow so the hands come up & forward
  // (not one rigid spread-eagle line); thighs splayed back, knees bent so the
  // shins kick up behind — the classic stable freefall arch, not a stiff X.
  skydive: [[-0.90, 0.12, 0.20], [-0.30, 0.44, 0.85], [0.90, 0.12, 0.20], [0.30, 0.44, 0.85],
            [-0.42, -0.78, -0.46], [-0.30, 0.06, -0.86], [0.42, -0.78, -0.46], [0.30, 0.06, -0.86]],
  // under canopy: upper arms reach up & OUT toward the risers, forearms angle
  // back up to the toggles → bent elbows (a relaxed hang, not arms rammed
  // straight up); legs dangle with a slight knee bend, feet drifting forward.
  hang: [[-0.60, 0.78, 0.10], [-0.20, 0.97, 0.08], [0.60, 0.78, 0.10], [0.20, 0.97, 0.08],
         [-0.14, -0.97, 0.10], [-0.12, -0.86, -0.34], [0.14, -0.97, 0.10], [0.12, -0.86, -0.34]],
  // reload: muzzle dips, left hand works at the receiver
  reload: [[-0.2, -0.7, 0.6], [-0.05, -0.25, 0.95], [0.28, -0.75, 0.5], [-0.3, -0.15, 0.9]],
};

/**
 * Apply an arm pose over the current animation frame.
 * obj = the actor root (its world quaternion defines "local"), bones from
 * findArmBones, mode = key of POSES, weight 0..1.
 */
/** Tilt an actor-local dir up/down by `pitch` (rotate the y/z components). */
function tiltDir(d, pitch) {
  const c = Math.cos(pitch), s = Math.sin(pitch);
  return [d[0], d[1] * c + d[2] * s, d[2] * c - d[1] * s];
}


// ── TWO-BONE IK ─────────────────────────────────────────────────────────────
// The left hand was posed from the same direction table as everything else and
// simply landed wherever the numbers put it — measured 0.418 m off the foregrip
// on a 0.62 m rifle, i.e. completely off the gun. A rifle with no support hand
// reads as broken no matter how correctly the barrel points.
//
// The fix is the standard one: the WEAPON is the anchor, and the support arm is
// solved onto it. Analytic two-bone IK (law of cosines) — the same formulation
// ozz-animation's IKTwoBoneJob uses, whose defaults this borrows: reach clamped
// to 0.99 of full extension so the elbow never locks straight, and the elbow
// interior angle clamped to the AAOS elbow range (30-164 deg) so it can neither
// hyperextend nor fold through itself.
const IK = { reachClamp: 0.99, elbowMinDeg: 30, elbowMaxDeg: 164, eps: 1e-6 };
const _ikA = new THREE.Vector3(), _ikB = new THREE.Vector3(), _ikC = new THREE.Vector3();
const _ikAB = new THREE.Vector3(), _ikCB = new THREE.Vector3(), _ikAC = new THREE.Vector3();
const _ikAT = new THREE.Vector3(), _ikAxis = new THREE.Vector3();
const _ikQ = new THREE.Quaternion(), _ikPW = new THREE.Quaternion(), _ikBW = new THREE.Quaternion();
const _IDENT = new THREE.Quaternion();   // hoisted: the blend<1 path slerps toward it

/** Rotate a bone by a world-space quaternion, converting into its parent space. */
function rotateBoneWorld(bone, worldQ) {
  if (!bone || !bone.parent) return;
  bone.getWorldQuaternion(_ikBW);
  _ikQ.copy(worldQ).multiply(_ikBW);          // desired world orientation
  bone.parent.getWorldQuaternion(_ikPW);
  bone.quaternion.copy(_ikPW.invert().multiply(_ikQ));
}

/** Solve root->mid->tip so `tip` reaches `target` (a world Vector3).
 *  Optional `pole` (world Vector3): after solving, the arm plane is spun
 *  about the shoulder->tip axis so the elbow points toward it — without a
 *  pole the bend plane is inherited from whatever the clip left, and the
 *  support elbow can read as pointing up/inward (Unity's TwoBoneIKConstraint
 *  hint and ozz's pole vector exist for exactly this). The spin axis passes
 *  through the tip, so the hand stays ON the target.
 *  Returns the residual distance from tip to target after solving. */
export function twoBoneIK(root, mid, tip, target, blend, pole) {
  if (!root || !mid || !tip || !target || blend <= 0) return -1;
  // (true, TRUE): parents for a correct world transform AND children, so the
  // mid/tip positions we sample are this frame's, not last frame's.
  root.updateWorldMatrix(true, true);
  root.getWorldPosition(_ikA); mid.getWorldPosition(_ikB); tip.getWorldPosition(_ikC);
  const lAB = _ikA.distanceTo(_ikB), lBC = _ikB.distanceTo(_ikC);
  if (lAB < IK.eps || lBC < IK.eps) return -1;
  // clamp the reach so the arm never snaps to a locked-straight pose
  const maxReach = (lAB + lBC) * IK.reachClamp;
  _ikAT.copy(target).sub(_ikA);
  let lAT = _ikAT.length();
  if (lAT < IK.eps) return -1;
  if (lAT > maxReach) lAT = maxReach;
  const minReach = Math.abs(lAB - lBC) + IK.eps;
  if (lAT < minReach) lAT = minReach;

  // current interior angles
  _ikAB.copy(_ikB).sub(_ikA); _ikCB.copy(_ikC).sub(_ikB); _ikAC.copy(_ikC).sub(_ikA);
  const cosCur = THREE.MathUtils.clamp(
    (lAB * lAB + lBC * lBC - _ikAC.lengthSq()) / (2 * lAB * lBC), -1, 1);
  // desired elbow interior angle from the law of cosines, clamped to AAOS range
  let cosWant = THREE.MathUtils.clamp(
    (lAB * lAB + lBC * lBC - lAT * lAT) / (2 * lAB * lBC), -1, 1);
  const wantDeg = THREE.MathUtils.clamp(
    Math.acos(cosWant) * 180 / Math.PI, IK.elbowMinDeg, IK.elbowMaxDeg);
  const curDeg = Math.acos(cosCur) * 180 / Math.PI;

  // bend axis = normal of the current arm plane; fall back to a stable axis if
  // the arm is dead straight (cross product degenerate)
  _ikAxis.crossVectors(_ikAB, _ikCB);
  if (_ikAxis.lengthSq() < IK.eps) _ikAxis.crossVectors(_ikAB, _ikAT);
  if (_ikAxis.lengthSq() < IK.eps) return -1;
  _ikAxis.normalize();

  // 1) bend the elbow to the desired interior angle. Sign convention, verified
  //    numerically on the live rig: +rotation of the forearm about the arm-plane
  //    normal (AB x CB) CLOSES the interior angle (Rodrigues on CB: interior
  //    goes 90-d for +d). So closing from cur to want needs +(cur - want). The
  //    original (want - cur) drove the elbow the WRONG WAY by exactly the
  //    intended magnitude every call (measured live: 94.3 -> 116.8 -> 161.8
  //    across passes, each +|want-cur| instead of -). The shoulder swing then
  //    partially recovered, which made the standalone test look convergent
  //    (0.511 -> 0.128) while in-game per-frame solves oscillated and the
  //    integration read as "the hand never moved".
  const dElbow = (curDeg - wantDeg) * Math.PI / 180;
  if (Math.abs(dElbow) > IK.eps) {
    _ikQ.setFromAxisAngle(_ikAxis, dElbow * blend);
    rotateBoneWorld(mid, _ikQ);
    root.updateWorldMatrix(true, true);
    tip.getWorldPosition(_ikC);                 // tip moved — resample
  }
  // 2) swing the shoulder so the tip lands on the target
  _ikAC.copy(_ikC).sub(_ikA);
  _ikAT.copy(target).sub(_ikA);
  if (_ikAC.lengthSq() > IK.eps && _ikAT.lengthSq() > IK.eps) {
    _ikQ.setFromUnitVectors(_ikAC.normalize(), _ikAT.normalize());
    if (blend < 1) _ikQ.slerp(_IDENT, 1 - blend);
    rotateBoneWorld(root, _ikQ);
    root.updateWorldMatrix(true, true);
  }
  // 3) pole spin — rotate the whole arm about the shoulder->tip line so the
  //    elbow lands on the pole side. Signed angle via atan2 so a 179-degree
  //    correction doesn't pick the wrong direction.
  if (pole) {
    tip.getWorldPosition(_ikC); mid.getWorldPosition(_ikB);
    _ikAxis.copy(_ikC).sub(_ikA);
    const axLen2 = _ikAxis.lengthSq();
    if (axLen2 > IK.eps) {
      _ikAxis.multiplyScalar(1 / Math.sqrt(axLen2));
      // elbow and pole, each projected off the axis
      _ikAB.copy(_ikB).sub(_ikA);
      _ikAB.addScaledVector(_ikAxis, -_ikAB.dot(_ikAxis));
      _ikCB.copy(pole).sub(_ikA);
      _ikCB.addScaledVector(_ikAxis, -_ikCB.dot(_ikAxis));
      if (_ikAB.lengthSq() > IK.eps && _ikCB.lengthSq() > IK.eps) {
        _ikAB.normalize(); _ikCB.normalize();
        _ikAC.crossVectors(_ikAB, _ikCB);
        const spin = Math.atan2(_ikAC.dot(_ikAxis), _ikAB.dot(_ikCB));
        if (Math.abs(spin) > 1e-3) {
          _ikQ.setFromAxisAngle(_ikAxis, spin * blend);
          rotateBoneWorld(root, _ikQ);
          root.updateWorldMatrix(true, true);
        }
      }
    }
  }
  tip.getWorldPosition(_ikC);
  return _ikC.distanceTo(target);
}

/** ── AIM RIG ──────────────────────────────────────────────────────────────
 *  Replaces two hand-tuned spine gains with a sourced, clamped aim chain.
 *
 *  THE NUMBER THAT DRIVES ALL OF THIS: the trunk physically cannot supply a
 *  large up-aim. Thoracic extension tops out at ~22 deg and lumbar at ~31 deg
 *  (in-vivo ROM, anatomystandard.com), so ~53 deg is the absolute ceiling at
 *  95th-percentile flexibility. Routing aim pitch mainly through the spine is
 *  therefore GUARANTEED to hyperextend — which is exactly what this rig did,
 *  and why the character read as having a broken back.
 *
 *  So the pitch is split across two SEPARATE chains, the way shipping engines
 *  do it:
 *    TRUNK — takes a minority share, hard-clamped and asymmetric, because
 *      extension (up) is far more limited than flexion (down). Weights
 *      0.333/0.444/0.222 root->tip.
 *    GAZE — neck + head, deliberately NOT part of the aim solve (CryEngine's
 *      AimIK definition excludes them: Additive="0" Primary="0"). They carry
 *      what the trunk cannot, which is why a real shooter's head tracks the
 *      target while the spine stays civil. Ours were frozen — measured at a
 *      constant 21.7 deg head / -5.6 deg neck regardless of aim.
 *  Per-axis clamps follow Unity's shipping humanoid (neck and head +/-40 each)
 *  and AAOS cervical norms (flex/ext 45, rotation 60). */
const AIM = {
  trunkShare: 0.45,          // fraction of pitch the spine is allowed to take
  trunkUpMax: -20,           // deg, extension — the tight one
  trunkDownMax: 45,          // deg, flexion — thoracic 26 + lumbar 65, taken at ~50%
  trunkW: { spine2: 0.333, spine1: 0.444, spine: 0.222 },
  gazeSumMax: 60,            // |neck| + |head| ceiling, under both AAOS totals
  neckW: 0.40, neckMax: 25,  // deg
  headW: 0.60, headMax: 35,  // deg (Unity clamps each cervical axis at 40)
};
const _d2r = Math.PI / 180, _r2d = 180 / Math.PI;
const _clampD = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function applyAimChain(bones, pitchRad, weight) {
  const deg = pitchRad * _r2d;
  // trunk takes a minority share and is clamped to the anatomical budget
  const trunk = _clampD(deg * AIM.trunkShare, AIM.trunkUpMax, AIM.trunkDownMax);
  applySpineAim(bones.spine2, trunk * AIM.trunkW.spine2 * _d2r * weight);
  applySpineAim(bones.spine1, trunk * AIM.trunkW.spine1 * _d2r * weight);
  applySpineAim(bones.spine,  trunk * AIM.trunkW.spine  * _d2r * weight);
  // whatever the trunk could not supply goes to the gaze chain, so the head
  // actually looks where the weapon points instead of riding the chest
  const gaze = _clampD(deg - trunk, -AIM.gazeSumMax, AIM.gazeSumMax);
  applySpineAim(bones.neck, _clampD(gaze * AIM.neckW, -AIM.neckMax, AIM.neckMax) * _d2r * weight);
  applySpineAim(bones.head, _clampD(gaze * AIM.headW, -AIM.headMax, AIM.headMax) * _d2r * weight);
}

/** Absolute (not cumulative) spine aim-bend.
 *  The first call caches the bone's rest rotation.x; every later call assigns
 *  rest + offset, so the pose can never compound frame over frame and always
 *  returns to rest when the offset is 0. */
function applySpineAim(bone, off) {
  if (!bone) return;
  if (bone.userData._aimBaseX === undefined) bone.userData._aimBaseX = bone.rotation.x;
  bone.rotation.x = bone.userData._aimBaseX + (off || 0);
}

export function applyArmPose(obj, bones, mode, weight, pitch) {
  if (!bones || weight <= 0) return;
  const P = POSES[mode];
  if (!P) return;
  obj.getWorldQuaternion(_oq);
  // AIM PITCH (AAA upper-body layer): the gun and torso track the camera's
  // vertical aim — only for weapon poses, capped so the spine stays sane
  const pk = (mode === "gunReady" || mode === "reload") ? Math.max(-0.9, Math.min(0.9, pitch || 0)) : 0;
  const T = pk ? P.map((d) => tiltDir(d, pk * 0.85)) : P;
  // scale the spine aim-bend by the pose weight so it fades in/out with the arms
  // (the mixer re-keys Spine01/02 each frame, so the += stays bounded)
  const sw = Math.min(1, weight);
  // These used to be `+=`, on the stated assumption that "the mixer re-keys
  // Spine01/02 each frame, so the += stays bounded". That assumption is FALSE on
  // these Meshy rigs — the locomotion clips do not key the spine chain at all,
  // so nothing ever restored it and the offset compounded every single frame.
  // Measured while holding an upward aim: spine2.rotation.x ran 3.8 -> 14.6 ->
  // 25.4 -> ... -> 68.6 radians (~3930 deg, ten full revolutions) and NEVER came
  // back down after the aim was released — the fighter stayed arched backwards,
  // head to the sky, for the rest of the match.
  // Capture the un-posed value once per bone and SET an absolute offset instead.
  applyAimChain(bones, pk, sw);
  const bl = 0.92 * Math.min(1, weight);
  aim(bones.rArm, bones.rFore, _oq, T[0][0], T[0][1], T[0][2], bl);
  aim(bones.lArm, bones.lFore, _oq, T[2][0], T[2][1], T[2][2], bl);
  const bf = 0.88 * Math.min(1, weight);
  aim(bones.rFore, bones.rHand, _oq, T[1][0], T[1][1], T[1][2], bf);
  aim(bones.lFore, bones.lHand, _oq, T[3][0], T[3][1], T[3][2], bf);
  if (P.length > 4) {   // legs too (skydive / canopy — clip legs read wrong mid-air)
    aim(bones.rUpLeg, bones.rLeg, _oq, P[4][0], P[4][1], P[4][2], bl);
    aim(bones.rLeg, bones.rFoot, _oq, P[5][0], P[5][1], P[5][2], bf);
    aim(bones.lUpLeg, bones.lLeg, _oq, P[6][0], P[6][1], P[6][2], bl);
    aim(bones.lLeg, bones.lFoot, _oq, P[7][0], P[7][1], P[7][2], bf);
  }
}
