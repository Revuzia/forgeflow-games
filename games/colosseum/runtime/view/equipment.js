// Colosseum — visible equipment.
//
// THE REQUIREMENT: anything the player buys must SHOW on the fighter. That is
// the industry-standard expectation and it is what makes a gold economy feel
// like progression rather than a number going up.
//
// APPROACH: bone-attached procedural armour, not modular body meshes.
//
//   Modular bodies (swap a chest mesh for another chest mesh) need every piece
//   authored against one skeleton with matching weights. We have exactly one
//   rigged gladiator body and no matching modular wardrobe, so that path costs
//   a full character-art pipeline per armour tier.
//
//   Bone attachment costs nothing: a galea is a rigid shell parented to the
//   Head bone, greaves to the shins, a manica to the sword forearm. Rigid armour
//   IS rigid in life, so it reads correctly, it animates for free because the
//   bone animates, and each piece is one merged mesh = one draw call.
//
// The rig (verified from base.glb) is a 24-bone Mixamo-style humanoid:
//   Hips, Spine, Spine01, Spine02, neck, Head, head_end, headfront,
//   Left/RightShoulder, Arm, ForeArm, Hand, Left/RightUpLeg, Leg, Foot, ToeBase

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// One material for all metal armour, tinted per-vertex — keeps a fully kitted
// gladiator at a handful of draw calls instead of a dozen.
const ARMOUR_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.44, metalness: 0.72, name: "armour",
});
const CLOTH_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.92, metalness: 0.0, name: "armour_cloth",
});

const BRONZE = 0xb5893f, IRON = 0x9aa0a8, STEEL = 0xc2c8d0;
const LEATHER = 0x5a3f28, CLOTH_RED = 0x8e2f22, GOLD = 0xd8ad4e;

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const n = g.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
  }
  return g;
}

function weld(parts, mat = ARMOUR_MAT, name = "armour_piece") {
  const merged = mergeGeometries(parts, false);
  if (!merged) {
    const shapes = [...new Set(parts.map((p) => Object.keys(p.attributes).sort().join("+")))];
    throw new Error(`equipment weld failed — attribute mismatch: ${shapes.join(" | ")}`);
  }
  parts.forEach((p) => p.dispose());
  const m = new THREE.Mesh(merged, mat);
  m.name = name;
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// The pieces. Each is authored in BONE-LOCAL space, y-up, origin at the joint.
// ---------------------------------------------------------------------------

/**
 * Galea — the great crested gladiator helmet. Broad brim, closed face with eye
 * holes, and the tall crest that is the single most recognisable silhouette in
 * the whole game.
 */
export function makeGalea({ crest = true, crestColor = CLOTH_RED, metal = BRONZE } = {}) {
  const parts = [];

  // skull bowl
  const bowl = new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  bowl.translate(0, 0.03, 0);
  parts.push(paint(bowl, metal));

  // wide brim — the galea's defining profile
  const brim = new THREE.CylinderGeometry(0.175, 0.145, 0.028, 16);
  brim.translate(0, -0.028, 0.006);
  parts.push(paint(brim, metal));

  // face guard: a front plate with a gap at the eyes
  const upperFace = new THREE.BoxGeometry(0.19, 0.052, 0.02);
  upperFace.translate(0, -0.005, 0.108);
  parts.push(paint(upperFace, metal));
  const lowerFace = new THREE.BoxGeometry(0.185, 0.075, 0.022);
  lowerFace.translate(0, -0.105, 0.10);
  parts.push(paint(lowerFace, metal));

  // cheek pieces
  for (const sx of [-1, 1]) {
    const cheek = new THREE.BoxGeometry(0.028, 0.10, 0.10);
    cheek.translate(sx * 0.092, -0.075, 0.052);
    parts.push(paint(cheek, metal));
  }

  // neck guard flaring at the back
  const neck = new THREE.BoxGeometry(0.20, 0.055, 0.03);
  neck.rotateX(-0.5);
  neck.translate(0, -0.075, -0.10);
  parts.push(paint(neck, metal));

  if (crest) {
    // crest box + plume
    const box = new THREE.BoxGeometry(0.028, 0.038, 0.20);
    box.translate(0, 0.115, 0.006);
    parts.push(paint(box, GOLD));
    const plume = new THREE.CylinderGeometry(0.022, 0.038, 0.155, 8);
    plume.scale(1, 1, 4.1);
    plume.translate(0, 0.195, 0.006);
    parts.push(paint(plume, crestColor));
  }

  return weld(parts, ARMOUR_MAT, "galea");
}

/**
 * Manica — the segmented arm sleeve, banded down the limb. Built along the
 * bone's +Y so it follows the forearm automatically.
 */
export function makeManica({ length = 0.30, radius = 0.062, bands = 7, metal = IRON } = {}) {
  const parts = [];
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const r = radius * (1 - t * 0.22);
    const seg = new THREE.CylinderGeometry(r, r * 1.06, (length / bands) * 0.86, 10, 1, true);
    seg.translate(0, length * t, 0);
    parts.push(paint(seg, metal));
  }
  // leather backing so the gaps between plates do not read as holes
  const backing = new THREE.CylinderGeometry(radius * 0.93, radius * 0.93, length * 1.02, 10, 1, true);
  backing.translate(0, length * 0.5, 0);
  parts.push(paint(backing, LEATHER));
  return weld(parts, ARMOUR_MAT, "manica");
}

/** Ocrea — a bronze greave covering the shin, open at the back. */
export function makeOcrea({ length = 0.36, radius = 0.072, metal = BRONZE } = {}) {
  const parts = [];
  // LIMB-ARMOUR CONVENTION: origin sits at the PARENT joint and the piece
  // extends along +Y toward the child joint — the same convention makeManica
  // uses (wide elbow end at the origin, narrow wrist end at +Y). The ocrea used
  // to be built the other way up, knee cop at +Y, which put the knee cop on the
  // ANKLE once attachToBone(align:"limb") aimed +Y down the shin. Two limb
  // pieces with opposite conventions is the bug; one convention is the fix.
  //
  // So: knee (wide, capped) at the origin, ankle (narrow) at +Y = length.
  const shell = new THREE.CylinderGeometry(radius * 0.82, radius, length, 12, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
  shell.translate(0, length * 0.5, 0);
  parts.push(paint(shell, metal));

  // knee cop — a dome over the knee, so it faces back up the leg (-Y)
  const knee = new THREE.SphereGeometry(radius * 1.12, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  knee.rotateX(Math.PI);
  knee.translate(0, length * 0.03, 0);
  parts.push(paint(knee, metal));

  // two straps
  for (const f of [0.32, 0.7]) {
    const strap = new THREE.TorusGeometry(radius * 1.02, 0.008, 5, 12);
    strap.rotateX(Math.PI / 2);
    strap.translate(0, length * f, 0);
    parts.push(paint(strap, LEATHER));
  }
  return weld(parts, ARMOUR_MAT, "ocrea");
}

/** Lorica squamata — scale cuirass over the torso. */
export function makeLorica({ height = 0.46, radius = 0.19, metal = STEEL } = {}) {
  const parts = [];
  const ROWS = 7, COLS = 14;
  for (let r = 0; r < ROWS; r++) {
    const y = (r / ROWS) * height;
    const rr = radius * (1 - Math.abs(r / ROWS - 0.45) * 0.16);
    for (let c = 0; c < COLS; c++) {
      const a = (c / COLS) * Math.PI * 2 + (r % 2) * (Math.PI / COLS);
      const scale = new THREE.BoxGeometry(0.034, 0.05, 0.012);
      const m = new THREE.Matrix4()
        .makeRotationY(-a)
        .setPosition(Math.sin(a) * rr, y, Math.cos(a) * rr);
      scale.applyMatrix4(m);
      parts.push(paint(scale, metal));
    }
  }
  // shoulder yoke
  for (const sx of [-1, 1]) {
    const pauldron = new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    pauldron.rotateZ(sx * 0.5);
    pauldron.translate(sx * 0.155, height * 0.97, 0);
    parts.push(paint(pauldron, metal));
  }
  return weld(parts, ARMOUR_MAT, "lorica");
}

/** Balteus — the wide studded belt every gladiator wore. */
export function makeBalteus({ radius = 0.155, height = 0.10 } = {}) {
  const parts = [];
  const band = new THREE.CylinderGeometry(radius, radius * 1.02, height, 14, 1, true);
  parts.push(paint(band, LEATHER));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const stud = new THREE.SphereGeometry(0.014, 6, 5);
    stud.translate(Math.sin(a) * radius * 1.02, 0, Math.cos(a) * radius * 1.02);
    parts.push(paint(stud, BRONZE));
  }
  return weld(parts, ARMOUR_MAT, "balteus");
}

/** Subligaculum — the loincloth, worn by everyone under everything. */
export function makeSubligaculum({ radius = 0.16, length = 0.26, color = CLOTH_RED } = {}) {  // fitted from the Hips bone
  const parts = [];
  const skirt = new THREE.CylinderGeometry(radius * 0.98, radius * 1.22, length, 12, 1, true);
  skirt.translate(0, -length * 0.5, 0);
  parts.push(paint(skirt, color));
  return weld(parts, CLOTH_MAT, "subligaculum");
}

// ---------------------------------------------------------------------------
// Slot definitions — bone, fitted offset, and which builder makes the mesh.
// ---------------------------------------------------------------------------

/**
 * `offset` and `rot` are tuned against the verified rig. `scaleTo` optionally
 * fits a piece to the measured limb length so armour tracks body size.
 *
 * `align` picks how attachToBone orients the piece:
 *   "limb" — +Y aimed at the bone's CHILD joint (armour running along a limb)
 *   "tip"  — +Y along PARENT -> bone, for a leaf bone with no child (the head)
 *   "body" — +Y world up, +Z the body's forward (armour girdling the trunk)
 *   omitted — inherit the bone's frame verbatim
 *
 * Nothing inherits any more. Every one of these bones carries arbitrary roll
 * from the Meshy auto-rig, and it differs per body — see verify_equipment.mjs.
 */
export const SLOTS = {
  helmet: {
    bone: /^Head$/i, build: makeGalea, align: "tip",
    offset: [0, 0.085, 0.012], rot: [0, 0, 0],
    desc: "Galea, on the head bone.",
  },
  armArmour: {
    bone: /^RightForeArm$/i, build: makeManica, align: "limb",
    offset: [0, 0.02, 0], rot: [0, 0, 0],
    desc: "Manica down the sword forearm.",
  },
  legArmourL: {
    bone: /^LeftLeg$/i, build: makeOcrea, align: "limb",
    offset: [0, 0.02, 0], rot: [0, 0, 0],
    desc: "Ocrea on the left shin.",
  },
  legArmourR: {
    bone: /^RightLeg$/i, build: makeOcrea, align: "limb",
    offset: [0, 0.02, 0], rot: [0, 0, 0],
    desc: "Ocrea on the right shin.",
  },
  torso: {
    bone: /^Spine01$/i, build: makeLorica, align: "body",
    offset: [0, -0.05, 0], rot: [0, 0, 0],
    desc: "Lorica over the chest.",
  },
  belt: {
    bone: /^Hips$/i, build: makeBalteus, align: "body",
    offset: [0, 0.04, 0], rot: [0, 0, 0],
    desc: "Balteus at the waist.",
  },
  loincloth: {
    bone: /^Hips$/i, build: makeSubligaculum, align: "body",
    offset: [0, 0.0, 0], rot: [0, 0, 0],
    desc: "Subligaculum.",
  },
};

/**
 * Length of a bone, measured to its first child joint, in the bone's own local
 * units. This is what lets armour FIT a skeleton instead of assuming one.
 *
 * Armour authored against one body and hardcoded in metres looks correct on
 * that body and absurd on any other — the first gladiator generated after the
 * knight wore a manica twice the length of his forearm.
 */
export function boneLength(bone, fallback = 0.3) {
  if (!bone || !bone.children || !bone.children.length) return fallback;
  const child = bone.children.find((c) => c.isBone);
  if (!child) return fallback;

  // MEASURE IN WORLD SPACE. `child.position.length()` is in the bone's LOCAL
  // units, and these rigs are authored in centimetre-scale units then scaled
  // down by the Actor — a forearm reads 26.8 locally but 0.27 m in the world.
  // Fitting armour to the local number makes it a hundred times too big.
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
  const b = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
  const d = a.distanceTo(b);
  return d > 0.0001 ? d : fallback;
}

// Scratch for the per-frame body-armour re-solve.
const _abY = new THREE.Vector3();
const _abZ = new THREE.Vector3();
const _abX = new THREE.Vector3();
const _abM = new THREE.Matrix4();
const _abFwd = new THREE.Vector3();
const _abQ = new THREE.Quaternion();
const _abBoneQ = new THREE.Quaternion();
const _abTmp = new THREE.Vector3();
const _abUp = new THREE.Vector3(0, 1, 0);

/**
 * Build a FULL orthonormal basis: +Y along `yDir`, +Z as near `fwd` as the
 * primary axis allows. Returns `out`.
 *
 * THE MINIMAL-ARC VERSION OF THIS WAS THE "HELMET LOOKS SIDEWAYS" BUG.
 * Aiming a single axis with setFromUnitVectors gives the SHORTEST rotation from
 * +Y to yDir, which leaves the roll ABOUT that axis entirely arbitrary — it
 * falls out of whatever the bone's frame happened to be, and these are Meshy
 * auto-rigs whose bone roll differs per bone AND per archetype. On the greaves
 * and manica that is invisible because they are round. On the galea it decides
 * which way the face opening and the crest point, so the helmet sat rotated,
 * and rotated differently on every body.
 *
 * Pinning both axes is well defined because every builder here shares one
 * authoring convention — +Y up, +Z forward (galea: face guard at +z 0.108,
 * neck guard at -z 0.10, crest elongated along z; lorica and subligaculum are
 * radially symmetric so only +Y binds).
 */
export function alignBasis(yDir, fwd, out) {
  const y = _abY.copy(yDir).normalize();
  const z = _abZ.copy(fwd).addScaledVector(y, -_abZ.dot(y));   // project perp. to y
  if (z.lengthSq() < 1e-8) {
    // fwd parallel to the primary axis (a limb pointing dead ahead): any
    // perpendicular will do, so derive one rather than emit NaN.
    z.set(0, 0, 1).addScaledVector(y, -y.z);
    if (z.lengthSq() < 1e-8) z.set(1, 0, 0).addScaledVector(y, -y.x);
  }
  z.normalize();
  _abX.crossVectors(y, z);                                     // right-handed
  return out.setFromRotationMatrix(_abM.makeBasis(_abX, y, z));
}

/** The body's forward, horizontal, taken off the model root. */
function bodyForward(model, out) {
  model.updateWorldMatrix(true, false);
  model.matrixWorld.decompose(_abTmp, _abQ, _abTmp);
  out.set(0, 0, 1).applyQuaternion(_abQ);
  out.y = 0;
  if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
  return out.normalize();
}

/**
 * Put the skeleton into its REST pose, returning a function that restores
 * whatever pose was live. Lets equipment solve attachment frames against one
 * stable reference instead of against whichever animation frame is showing.
 *
 * Uses the rest TRS that Actor snapshots at construction, NOT Skeleton.pose().
 * pose() rebuilds bone transforms from the inverse-bind matrices, and on these
 * Meshy rigs those are degenerate — measured live, it collapsed Head, Hips,
 * LeftLeg and RightForeArm into a 1 cm ball and flattened the X axis to a
 * single value. Solving a greave's direction against that gives a shin vector
 * with no lateral component.
 *
 * No snapshot (a model not built by Actor) means no restore and no rest pose:
 * the caller gets the live pose, which is the old behaviour.
 */
export function restBoneChain(model) {
  const rest = model.userData && model.userData.restPose;
  if (!rest || !rest.length) return () => {};

  const saved = rest.map((t) => ({
    b: t.b, p: t.b.position.clone(), q: t.b.quaternion.clone(), s: t.b.scale.clone(),
  }));
  for (const t of rest) {
    t.b.position.copy(t.p);
    t.b.quaternion.copy(t.q);
    t.b.scale.copy(t.s);
  }
  model.updateMatrixWorld(true);

  return () => {
    for (const t of saved) {
      t.b.position.copy(t.p);
      t.b.quaternion.copy(t.q);
      t.b.scale.copy(t.s);
    }
    model.updateMatrixWorld(true);
  };
}

/** Find a bone by regex. */
export function findBone(model, re) {
  let hit = null;
  model.traverse((o) => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
  return hit;
}

/**
 * Attach a prebuilt mesh to a named bone, countering the bone's inherited
 * scale so the piece keeps its authored size (the same correction attachWeapon
 * makes — a bone deep in a scaled hierarchy carries that scale).
 *
 * @returns {THREE.Group|null} the mount, or null if the bone is absent
 */
export function attachToBone(model, boneRe, mesh, {
  offset = [0, 0, 0], rot = [0, 0, 0], scale = 1, align = null,
} = {}) {
  const bone = findBone(model, boneRe);
  if (!bone) return null;

  bone.updateWorldMatrix(true, false);
  const s = new THREE.Vector3();
  const boneQ = new THREE.Quaternion();
  bone.matrixWorld.decompose(new THREE.Vector3(), boneQ, s);
  const counter = s.x > 0.0001 ? 1 / s.x : 1;

  const mount = new THREE.Group();
  mount.name = "equip_mount";
  mount.scale.setScalar(counter * scale);
  mount.position.set(offset[0] * counter, offset[1] * counter, offset[2] * counter);

  if (align) {
    // SOLVE THE ORIENTATION INSTEAD OF INHERITING IT.
    //
    // Every slot used to attach with rot [0,0,0], which silently assumes each
    // bone's local frame already matches the frame the piece was modelled in.
    // Meshy auto-rigs carry arbitrary bone roll, so that is wrong per-bone and
    // per-archetype. Measured over all 8 shipped bodies by verify_equipment.mjs:
    // 34 of 48 attachment points off-axis, 16 FULLY INVERTED — the greaves sat
    // upside down on BOTH legs of EVERY body (169-171 deg, knee cop on the
    // ankle) and the manica was rolled 89 deg across the forearm.
    //
    // This is the solve attachWeapon(align:"shield") already uses: build the
    // orientation the piece needs in WORLD space, then express it in the bone's
    // frame, so it survives whatever roll that bone happens to carry.
    //
    // Solved against the BIND pose, not the live pose. A bout builds equipment
    // while actors are already idling (bout.js), so the live bone frame is
    // wherever the current animation frame put it — baking that in would make
    // a greave's fit depend on when the player opened the armoury.
    const restore = restBoneChain(model);
    bone.updateWorldMatrix(true, false);
    bone.matrixWorld.decompose(new THREE.Vector3(), boneQ, new THREE.Vector3());

    // The body's forward, taken off the model root — the bone's own frame is
    // precisely the thing that cannot be trusted here.
    model.updateWorldMatrix(true, false);
    const rootQ = new THREE.Quaternion();
    model.matrixWorld.decompose(new THREE.Vector3(), rootQ, new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();

    // Where the piece's +Y must point, per mode.
    const yDir = new THREE.Vector3();
    if (align === "limb") {
      // Limb armour runs ALONG the bone: +Y at the first child joint.
      const child = bone.children.find((c) => c.isBone);
      const from = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      if (child) {
        child.updateWorldMatrix(true, false);
        yDir.setFromMatrixPosition(child.matrixWorld).sub(from);
      }
      if (yDir.lengthSq() < 1e-9) yDir.set(0, 1, 0).applyQuaternion(boneQ);
    } else if (align === "tip") {
      // A LEAF bone has no child, so the axis continues the chain: +Y along
      // parent -> bone. For Head (parent `neck`) that is the skull axis.
      // Measured Head-bone tilt runs 22.8 deg (provocator) to 43.2 deg
      // (crupellarius) across the roster, so inheriting it put the galea
      // crooked, and differently crooked on every body.
      const par = bone.parent && bone.parent.isBone ? bone.parent : null;
      if (par) {
        par.updateWorldMatrix(true, false);
        yDir.setFromMatrixPosition(bone.matrixWorld)
          .sub(new THREE.Vector3().setFromMatrixPosition(par.matrixWorld));
      }
      if (yDir.lengthSq() < 1e-9) yDir.set(0, 1, 0).applyQuaternion(boneQ);
    } else {
      yDir.set(0, 1, 0);                       // body armour: straight up
    }

    const want = alignBasis(yDir, fwd, new THREE.Quaternion());

    // Express the desired WORLD rotation in the bone's local frame:
    //   local = inverse(boneWorld) * want
    mount.quaternion.copy(boneQ.clone().invert().multiply(want));
    // Per-slot tweaks apply ON TOP of the solved frame, not instead of it.
    if (rot[0] || rot[1] || rot[2]) {
      mount.quaternion.multiply(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot[0], rot[1], rot[2])
      ));
    }
    // The offset was tuned as "up/forward on the PIECE" — re-express it in the
    // solved frame too, or a 4 cm belt rise becomes 4 cm sideways on a hip bone
    // whose +Y is 91 deg off vertical.
    mount.position.copy(
      new THREE.Vector3(offset[0], offset[1], offset[2])
        .applyQuaternion(mount.quaternion).multiplyScalar(counter)
    );
    restore();
  } else {
    mount.rotation.set(rot[0], rot[1], rot[2]);
  }

  mount.add(mesh);
  bone.add(mount);
  return mount;
}

/**
 * Per-actor equipment manager. Owns what is currently worn and keeps the 3D
 * representation in sync with the inventory model.
 */
export class Equipment {
  constructor(actor) {
    this.actor = actor;
    this.mounts = new Map();      // slot -> mount Group
  }

  /**
   * Equip a slot, replacing whatever was there.
   *
   * Pieces are FITTED to the skeleton: limb armour takes its length and radius
   * from the bone it rides, and head/torso pieces scale off the rig's actual
   * proportions. Hardcoded metre dimensions only ever fit the one body they
   * were authored against.
   */
  equip(slot, opts = {}) {
    const def = SLOTS[slot];
    if (!def) return null;
    this.unequip(slot);

    const model = this.actor.model;
    const bone = findBone(model, def.bone);
    if (!bone) return null;

    // FIT AND ORIENT AGAINST THE BIND POSE. boneLength() measures to the child
    // joint in world space, so a knee bent by the live animation frame reports
    // a shorter shin and the greave is built too small. Equipping happens both
    // at bout setup and from the armoury mid-career, so "whatever pose it is in"
    // is not a stable reference. attachToBone rest-poses too; nesting is a
    // no-op, and this restore returns the real pose.
    const restorePose = restBoneChain(model);
    const L = boneLength(bone, 0.3);

    // Per-slot fit derived from the real skeleton.
    const fitted = { ...opts };
    if (slot === "armArmour") {
      fitted.length = L * 0.92;
      fitted.radius = L * 0.20;
    } else if (slot === "legArmourL" || slot === "legArmourR") {
      fitted.length = L * 0.88;
      fitted.radius = L * 0.185;
    } else if (slot === "helmet") {
      // The head bone is short; scale off the neck-to-head span instead.
      const head = findBone(model, /^Head$/i);
      const hl = boneLength(head, 0.16);
      fitted.scale = Math.max(0.7, Math.min(1.5, hl / 0.16));
    } else if (slot === "torso") {
      const spine = findBone(model, /^Spine01$/i);
      fitted.height = boneLength(spine, 0.18) * 2.6;
      fitted.radius = boneLength(spine, 0.18) * 1.05;
    } else if (slot === "belt" || slot === "loincloth") {
      const hips = findBone(model, /^Hips$/i);
      const hl = boneLength(hips, 0.11);
      fitted.radius = Math.max(0.11, hl * 1.25);
      if (slot === "loincloth") fitted.length = hl * 2.1;
    }

    const mesh = def.build(fitted);
    const mount = attachToBone(model, def.bone, mesh, {
      offset: [def.offset[0], def.offset[1] * (L / 0.3), def.offset[2]],
      rot: def.rot,
      scale: fitted.scale || 1,
      align: def.align,
    });
    restorePose();
    if (mount) { mount.userData.align = def.align; this.mounts.set(slot, mount); }
    else mesh.geometry.dispose();
    return mount;
  }

  /**
   * Re-solve the world orientation of BODY-aligned pieces, every frame.
   *
   * "body" means world-oriented BY DEFINITION — a belt is level and a cuirass
   * faces where the man faces. Solving that once at attach and then letting the
   * piece inherit the bone was the error: measured live in the idle clip, the
   * Hips mount ended up 58.4 deg off vertical and 77.0 deg off forward, which
   * is why the balteus and subligaculum read as slabs jutting off one hip. The
   * animation moves the pelvis; a belt does not go with it that far.
   *
   * Limb and tip pieces are deliberately NOT re-solved — a greave must follow
   * the shin and a galea must follow the skull. Only the trunk is world-locked.
   */
  refresh() {
    if (!this.mounts.size) return;
    const model = this.actor.model;
    let fwd = null;
    for (const mount of this.mounts.values()) {
      if (mount.userData.align !== "body") continue;
      if (!fwd) fwd = bodyForward(model, _abFwd);
      const bone = mount.parent;
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      bone.matrixWorld.decompose(_abTmp, _abBoneQ, _abTmp);
      alignBasis(_abUp, fwd, _abQ);
      mount.quaternion.copy(_abBoneQ.invert().multiply(_abQ));
    }
  }

  unequip(slot) {
    const m = this.mounts.get(slot);
    if (!m) return false;
    m.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    m.removeFromParent();
    this.mounts.delete(slot);
    return true;
  }

  clear() { for (const s of [...this.mounts.keys()]) this.unequip(s); }

  /**
   * Apply a whole loadout at once. `armour` is the list of armour ids from the
   * inventory model; this maps them onto the visual slots.
   */
  applyLoadout({ armour = [], crestColor = CLOTH_RED } = {}) {
    this.clear();
    // Everyone wears the loincloth and belt.
    this.equip("loincloth", { color: crestColor });
    this.equip("belt");
    const has = (id) => armour.includes(id);
    if (has("galea")) this.equip("helmet", { crestColor });
    if (has("manica")) this.equip("armArmour");
    if (has("ocreae")) { this.equip("legArmourL"); this.equip("legArmourR"); }
    if (has("lorica")) this.equip("torso");
    return this.worn();
  }

  worn() { return [...this.mounts.keys()]; }

  /** Draw calls this equipment contributes (one per piece). */
  drawCalls() { return this.mounts.size; }
}
