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
    }
  });
  return (b.rArm && b.lArm) ? b : null;
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
  gunReady: [[-0.22, -0.85, 0.42], [-0.06, 0.1, 0.99], [0.3, -0.8, 0.42], [-0.42, 0.16, 0.88]],
  // belly-down skydive: arms swept out and back, legs arched back in a spread
  skydive: [[-0.9, -0.1, -0.3], [-0.95, 0.05, -0.25], [0.9, -0.1, -0.3], [0.95, 0.05, -0.25],
            [-0.3, -0.85, -0.35], [-0.32, -0.7, -0.6], [0.3, -0.85, -0.35], [0.32, -0.7, -0.6]],
  // under canopy: both hands up on the risers, legs together hanging straight
  hang: [[-0.3, 0.95, 0.05], [-0.12, 0.99, 0.04], [0.3, 0.95, 0.05], [0.12, 0.99, 0.04],
         [-0.1, -0.99, 0.03], [-0.08, -0.96, -0.15], [0.1, -0.99, 0.03], [0.08, -0.96, -0.15]],
  // reload: muzzle dips, left hand works at the receiver
  reload: [[-0.2, -0.7, 0.6], [-0.05, -0.25, 0.95], [0.28, -0.75, 0.5], [-0.3, -0.15, 0.9]],
};

/**
 * Apply an arm pose over the current animation frame.
 * obj = the actor root (its world quaternion defines "local"), bones from
 * findArmBones, mode = key of POSES, weight 0..1.
 */
export function applyArmPose(obj, bones, mode, weight) {
  if (!bones || weight <= 0) return;
  const P = POSES[mode];
  if (!P) return;
  obj.getWorldQuaternion(_oq);
  const bl = 0.92 * Math.min(1, weight);
  aim(bones.rArm, bones.rFore, _oq, P[0][0], P[0][1], P[0][2], bl);
  aim(bones.lArm, bones.lFore, _oq, P[2][0], P[2][1], P[2][2], bl);
  const bf = 0.88 * Math.min(1, weight);
  aim(bones.rFore, bones.rHand, _oq, P[1][0], P[1][1], P[1][2], bf);
  aim(bones.lFore, bones.lHand, _oq, P[3][0], P[3][1], P[3][2], bf);
  if (P.length > 4) {   // legs too (skydive / canopy — clip legs read wrong mid-air)
    aim(bones.rUpLeg, bones.rLeg, _oq, P[4][0], P[4][1], P[4][2], bl);
    aim(bones.rLeg, bones.rFoot, _oq, P[5][0], P[5][1], P[5][2], bf);
    aim(bones.lUpLeg, bones.lLeg, _oq, P[6][0], P[6][1], P[6][2], bl);
    aim(bones.lLeg, bones.lFoot, _oq, P[7][0], P[7][1], P[7][2], bf);
  }
}
