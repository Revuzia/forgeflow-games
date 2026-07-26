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
  // front shell: a half-cylinder, so it reads as strapped on rather than a tube
  const shell = new THREE.CylinderGeometry(radius, radius * 0.82, length, 12, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
  shell.translate(0, length * 0.5, 0);
  parts.push(paint(shell, metal));

  // knee cop
  const knee = new THREE.SphereGeometry(radius * 1.12, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  knee.translate(0, length * 0.97, 0);
  parts.push(paint(knee, metal));

  // two straps
  for (const f of [0.3, 0.68]) {
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
export function makeSubligaculum({ radius = 0.16, length = 0.26, color = CLOTH_RED } = {}) {
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
 */
export const SLOTS = {
  helmet: {
    bone: /^Head$/i, build: makeGalea,
    offset: [0, 0.085, 0.012], rot: [0, 0, 0],
    desc: "Galea, on the head bone.",
  },
  armArmour: {
    bone: /^RightForeArm$/i, build: makeManica,
    offset: [0, 0.02, 0], rot: [0, 0, 0],
    desc: "Manica down the sword forearm.",
  },
  legArmourL: {
    bone: /^LeftLeg$/i, build: makeOcrea,
    offset: [0, 0.02, 0], rot: [0, 0, 0],
    desc: "Ocrea on the left shin.",
  },
  legArmourR: {
    bone: /^RightLeg$/i, build: makeOcrea,
    offset: [0, 0.02, 0], rot: [0, 0, 0],
    desc: "Ocrea on the right shin.",
  },
  torso: {
    bone: /^Spine01$/i, build: makeLorica,
    offset: [0, -0.05, 0], rot: [0, 0, 0],
    desc: "Lorica over the chest.",
  },
  belt: {
    bone: /^Hips$/i, build: makeBalteus,
    offset: [0, 0.04, 0], rot: [0, 0, 0],
    desc: "Balteus at the waist.",
  },
  loincloth: {
    bone: /^Hips$/i, build: makeSubligaculum,
    offset: [0, 0.0, 0], rot: [0, 0, 0],
    desc: "Subligaculum.",
  },
};

/**
 * Attach a prebuilt mesh to a named bone, countering the bone's inherited
 * scale so the piece keeps its authored size (the same correction attachWeapon
 * makes — a bone deep in a scaled hierarchy carries that scale).
 *
 * @returns {THREE.Group|null} the mount, or null if the bone is absent
 */
export function attachToBone(model, boneRe, mesh, { offset = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  let bone = null;
  model.traverse((o) => { if (!bone && o.isBone && boneRe.test(o.name)) bone = o; });
  if (!bone) return null;

  bone.updateWorldMatrix(true, false);
  const s = new THREE.Vector3();
  bone.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  const counter = s.x > 0.0001 ? 1 / s.x : 1;

  const mount = new THREE.Group();
  mount.name = "equip_mount";
  mount.scale.setScalar(counter * scale);
  mount.position.set(offset[0] * counter, offset[1] * counter, offset[2] * counter);
  mount.rotation.set(rot[0], rot[1], rot[2]);
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

  /** Equip a slot, replacing whatever was there. `opts` reaches the builder. */
  equip(slot, opts = {}) {
    const def = SLOTS[slot];
    if (!def) return null;
    this.unequip(slot);
    const mesh = def.build(opts);
    const mount = attachToBone(this.actor.model, def.bone, mesh, {
      offset: def.offset, rot: def.rot, scale: opts.fit || 1,
    });
    if (mount) this.mounts.set(slot, mount);
    else mesh.geometry.dispose();
    return mount;
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
