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
  gunReady: [[-0.22, -0.85, 0.42], [-0.06, 0.1, 0.99], [0.3, -0.8, 0.42], [-0.42, 0.16, 0.88]],
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
  applySpineAim(bones.spine2, pk * 0.3 * sw);
  applySpineAim(bones.spine1, pk * 0.18 * sw);
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
