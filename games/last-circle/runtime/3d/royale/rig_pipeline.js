import * as THREE from "three";

/** ── RIG PIPELINE — inspection, attachment, validation ─────────────────────
 *
 *  Every character in this game is a Meshy.ai auto-rigged GLB. Those rigs are
 *  NOT uniform: hand-bone orientation differs per skin (soldier's RightHand +Z
 *  points forward, juggernaut's points straight down), bone world scale varies
 *  ~500x between rig families (Meshy ~0.01, Quaternius ~5.5), and clips bake
 *  root translation that must be stripped (player.js stripRootMotion). Until
 *  this module, the knowledge of "what a valid rig looks like" lived as
 *  scattered assumptions inside player.js/pose.js — nothing ever AUDITED a rig
 *  against the contract, and nothing prevented a future attachment (armor, hat,
 *  backpack) from being parented to the wrong bone. The classic Meshy failure
 *  mode — gear glued to the face because someone picked the first bone whose
 *  name matched /head|helmet/i — was not structurally impossible; it was just
 *  not yet written.
 *
 *  Three jobs, all cheap enough to run at load:
 *    inspectRig(root, label)      audit the bone hierarchy + skinning against
 *                                 EXPECTED_SKELETON; returns a report and
 *                                 console.warns on any violation
 *    attachToBone(actor, obj,     THE one sanctioned way to parent anything to
 *                 boneName, opts) a skeleton. Whitelisted bones per attachment
 *                                 kind; wrong bone = throw. Applies the scale
 *                                 compensation and local offset the inline
 *                                 weapon-holder code proved out.
 *    validateAttachments(actor)   audit a live actor: holder under a legal hand
 *                                 bone, scale compensation within tolerance,
 *                                 weapon length inside its class band.
 */

/** The skeleton contract every playable Meshy rig must satisfy.
 *  Names verified against all 5 shipping skins (65 GLBs decoded 2026-07-22:
 *  identical hierarchies, 24 bound bones per clip, zero missing targets). */
export const EXPECTED_SKELETON = {
  required: [
    "Hips", "Spine02", "Spine01", "Spine", "Head",
    "RightArm", "RightForeArm", "RightHand",
    "LeftArm", "LeftForeArm", "LeftHand",
    "RightUpLeg", "RightLeg", "RightFoot",
    "LeftUpLeg", "LeftLeg", "LeftFoot",
  ],
  // neck is lowercase on some Meshy exports — accept either, require one
  oneOf: [["neck", "Neck"]],
  // legal attachment points per kind. THIS is what makes "armor on the face"
  // impossible by construction: chest gear may only land on the spine chain,
  // weapons only in a hand, head cosmetics only on the head.
  attachPoints: {
    weapon: ["RightHand", "FistR"],
    armor:  ["Spine", "Spine01"],          // chest plate / vest anchors
    back:   ["Spine"],                     // backpack
    head:   ["Head"],                      // helmet / cap — cosmetic ONLY
  },
  // weapon child length bands (m) after grip anchoring — proportions are
  // deliberately stylized-compact (weapons.js normalizes to target lengths at
  // load: pistol 0.34, shotgun 0.8); the band catches a broken normalization,
  // not a style choice.
  weaponLengthBand: { min: 0.2, max: 1.1 },
};

/** Walk a rig and audit it against EXPECTED_SKELETON.
 *  Returns { ok, missing, bones, handBone, boneWorldScale, skinnedMeshes,
 *  boundBones } and warns once per violation — a rig that fails here will
 *  misbehave in pose.js (aim chain) and player.js (weapon holder), so the
 *  warning names the downstream victim. */
export function inspectRig(root, label) {
  const bones = new Map();
  let skinnedMeshes = 0;
  const boundBones = new Set();
  root.traverse((o) => {
    if (o.isBone) bones.set(o.name, o);
    if (o.isSkinnedMesh) {
      skinnedMeshes++;
      if (o.skeleton) for (const b of o.skeleton.bones) boundBones.add(b.name);
    }
  });
  const missing = EXPECTED_SKELETON.required.filter((n) => !bones.has(n));
  for (const group of EXPECTED_SKELETON.oneOf) {
    if (!group.some((n) => bones.has(n))) missing.push(group.join("|"));
  }
  const handBone = bones.get("RightHand") || bones.get("FistR") || null;
  let boneWorldScale = 1;
  if (handBone) {
    handBone.updateWorldMatrix(true, false);
    boneWorldScale = handBone.getWorldScale(new THREE.Vector3()).x;
  }
  const ok = missing.length === 0 && skinnedMeshes > 0 && !!handBone;
  if (!ok) {
    console.warn(
      `[rig] ${label || "rig"} FAILS the skeleton contract — missing: [${missing.join(", ")}]` +
      `, skinnedMeshes: ${skinnedMeshes}, handBone: ${handBone ? handBone.name : "NONE"}. ` +
      `Downstream: pose.js aim chain and the weapon holder will misbehave on this rig.`);
  }
  return { ok, missing, bones, handBone, boneWorldScale, skinnedMeshes,
           boundBones: boundBones.size };
}

/** Parent `obj` to a named bone of `actor`'s rig — the ONLY sanctioned path.
 *
 *  kind selects the whitelist row (weapon/armor/back/head). A bone outside the
 *  whitelist THROWS: the wrong-bone class of bug is rejected at the call site
 *  instead of shipping as gear glued to a face.
 *
 *  Handles the two Meshy traps the inline weapon code learned the hard way:
 *    - bone world scale varies wildly between rig families, so the holder is
 *      counter-scaled (1/worldScale) — children then live in world-metre units
 *    - the local offset is applied in the COUNTER-SCALED space, so offsets are
 *      also real metres, not bone units
 *  Returns the holder Group; the caller parents its content to that. */
export function attachToBone(actor, obj, boneName, opts) {
  const kind = (opts && opts.kind) || "weapon";
  const legal = EXPECTED_SKELETON.attachPoints[kind];
  if (!legal) throw new Error(`[rig] unknown attachment kind "${kind}"`);
  if (!legal.includes(boneName)) {
    throw new Error(
      `[rig] REFUSED: kind "${kind}" may not attach to bone "${boneName}" ` +
      `(legal: ${legal.join(", ")}). This guard exists because auto-rigged ` +
      `gear glued to the wrong bone is the classic Meshy failure mode.`);
  }
  let bone = null;
  actor.rig.scene.traverse((o) => { if (o.isBone && o.name === boneName && !bone) bone = o; });
  if (!bone) throw new Error(`[rig] bone "${boneName}" not found on ${actor.skin || "actor"}`);
  const holder = new THREE.Group();
  bone.add(holder);
  actor.obj.updateMatrixWorld(true);
  const ws = Math.max(1e-4, bone.getWorldScale(new THREE.Vector3()).x);
  holder.scale.setScalar(1 / ws);                     // children are in metres
  if (opts && opts.localPos) holder.position.copy(opts.localPos).multiplyScalar(1 / ws);
  if (opts && opts.localRot) holder.rotation.copy(opts.localRot);
  if (obj) holder.add(obj);
  holder.userData._rigAttachment = { kind, bone: boneName };
  return holder;
}

/** Audit a live actor's attachments. Cheap (no traversal of the weapon mesh
 *  beyond a bbox), safe to run once per equip in dev. */
export function validateAttachments(actor) {
  const issues = [];
  if (actor.hand) {
    const parent = actor.hand.parent;
    const legal = EXPECTED_SKELETON.attachPoints.weapon;
    if (!parent || !parent.isBone || !legal.includes(parent.name)) {
      issues.push(`weapon holder parented to "${parent ? parent.name : "nothing"}" — legal: ${legal.join(", ")}`);
    }
    if (parent && parent.isBone) {
      parent.updateWorldMatrix(true, false);
      const ws = parent.getWorldScale(new THREE.Vector3()).x;
      const comp = actor.hand.scale.x;
      // holder scale must invert the bone world scale to ~10%
      if (ws > 1e-4 && Math.abs(comp * ws - 1) > 0.1) {
        issues.push(`holder scale ${comp.toFixed(3)} does not invert bone world scale ${ws.toFixed(4)}`);
      }
    }
    const wm = actor.weaponMesh || actor.hand.children[0];
    if (wm) {
      // refreshWeaponMesh is ASYNC (the weapon protos are GLBs still loading at
      // first equip), so the holder can legitimately hold an empty group here.
      // A zero-geometry subtree is "pending", not "broken" — only measure once
      // real geometry exists, or this check cries wolf on every fresh spawn.
      let hasGeometry = false;
      wm.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.geometry) hasGeometry = true; });
      if (hasGeometry) {
        // Box3.setFromObject reads matrixWorld, which is only refreshed by the
        // render pass — measured stale, the 0.62 m AR reported 0.01 m because
        // the holder's 1/boneScale counter-scale was not yet baked in. The
        // validator must not depend on a render having happened between the
        // equip and the audit.
        actor.obj.updateMatrixWorld(true);
        const size = new THREE.Box3().setFromObject(wm).getSize(new THREE.Vector3());
        const len = Math.max(size.x, size.y, size.z);
        const band = EXPECTED_SKELETON.weaponLengthBand;
        if (len < band.min || len > band.max) {
          issues.push(`weapon length ${len.toFixed(2)}m outside band [${band.min}, ${band.max}] — normalization broke`);
        }
      }
    }
  }
  if (issues.length) console.warn(`[rig] ${actor.skin || "actor"} attachment issues:`, issues);
  return { ok: issues.length === 0, issues };
}
