// Verify that equipment CAN be attached correctly to a rig.
//
// WHY THIS EXISTS
// Armour pieces are parented to bones with `rot: [0,0,0]` (equipment.js SLOTS),
// which silently assumes every attachment bone's local axes match the frame the
// piece was modelled in. Meshy auto-rigged skeletons carry arbitrary bone roll,
// so that assumption is wrong per-bone and per-archetype, and it shows up in
// game as a chest plate facing backwards or an arm passing through a shield.
//
// Nothing in the existing toolchain could see this. probe_* run with no THREE
// at all, ingest_assets counts primitives, verify_rig proves a clip deforms a
// bone. None of them look at ORIENTATION, and orientation is the whole failure.
//
// Reads the glTF node hierarchy directly rather than going through GLTFLoader:
// the shipped bodies are Draco-compressed with WebP textures, and GLTFLoader in
// node demands a Draco decoder, an Image, createImageBitmap and `self` before
// it will hand over a skeleton it has already parsed. The skeleton is plain
// JSON — a node tree of TRS transforms — so this walks it.
//
// run: node games/colosseum/tools/verify_equipment.mjs [archetype ...]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGLB } from "./ingest_assets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHARS = path.join(HERE, "..", "assets", "chars");

/** The bones equipment.js actually attaches to, and what each piece needs. */
const SLOTS = [
  { slot: "helmet", bone: /^Head$/i, needs: "up along the head, face forward" },
  { slot: "armArmour", bone: /^RightForeArm$/i, needs: "long axis down the forearm" },
  { slot: "legArmourL", bone: /^LeftLeg$/i, needs: "long axis down the shin" },
  { slot: "legArmourR", bone: /^RightLeg$/i, needs: "long axis down the shin" },
  { slot: "torso", bone: /^Spine01$/i, needs: "plate faces body FORWARD, long axis up" },
  { slot: "belt", bone: /^Hips$/i, needs: "ring axis = body up" },
];

// --- tiny mat4 helpers (column-major, glTF convention) ----------------------
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function fromTRS(t, q, s) {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
const nodeLocal = (n) => (n.matrix ? n.matrix.slice()
  : fromTRS(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]));

/** Transform a direction by a matrix (translation ignored) and normalise. */
function dir(m, v) {
  const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
  const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
  const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
  const L = Math.hypot(x, y, z) || 1;
  return [x / L, y / L, z / L];
}
const angleDeg = (a, b) => {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
};

/** World matrix per node, by walking the scene graph from the roots. */
function worldMatrices(json) {
  const nodes = json.nodes || [];
  const world = new Array(nodes.length).fill(null);
  const parentOf = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));
  const resolve = (i) => {
    if (world[i]) return world[i];
    const local = nodeLocal(nodes[i]);
    const p = parentOf.get(i);
    world[i] = p === undefined ? local : mul(resolve(p), local);
    return world[i];
  };
  nodes.forEach((_, i) => resolve(i));
  return world;
}

const UP = [0, 1, 0];
const FWD = [0, 0, 1];

function inspect(archetype) {
  const file = path.join(CHARS, archetype, "base.glb");
  if (!fs.existsSync(file)) return null;
  const { json } = parseGLB(file);
  const world = worldMatrices(json);
  const nodes = json.nodes || [];

  console.log(`\n=== ${archetype} ===`);
  console.log("  slot         bone              +Y vs UP   +Z vs FWD   verdict");

  const rows = [];
  for (const s of SLOTS) {
    const idx = nodes.findIndex((n) => n.name && s.bone.test(n.name));
    if (idx < 0) { console.log(`  ${s.slot.padEnd(12)} (bone not found)`); continue; }
    const m = world[idx];
    const yUp = angleDeg(dir(m, [0, 1, 0]), UP);
    const zFwd = angleDeg(dir(m, [0, 0, 1]), FWD);
    // A piece attached with rot [0,0,0] inherits these axes verbatim. If +Y is
    // not roughly world up, a Y-up piece arrives tilted or upside down; if +Z
    // is not roughly forward, a plate faces the wrong way round the body.
    const verdict = (yUp > 135 || zFwd > 135) ? "INVERTED"
      : (yUp > 35 || zFwd > 35) ? "off-axis" : "ok";
    rows.push({ slot: s.slot, bone: nodes[idx].name, yUp, zFwd, verdict });
    console.log(`  ${s.slot.padEnd(12)} ${String(nodes[idx].name).padEnd(17)} ` +
      `${yUp.toFixed(1).padStart(6)}d   ${zFwd.toFixed(1).padStart(7)}d   ${verdict}`);
  }
  return rows;
}

const args = process.argv.slice(2);
const list = args.length ? args
  : fs.readdirSync(CHARS).filter((d) => !d.startsWith("_") &&
      fs.existsSync(path.join(CHARS, d, "base.glb")));

console.log("EQUIPMENT ATTACHMENT ORIENTATION AUDIT");
console.log("equipment.js attaches every piece with rot [0,0,0] — it INHERITS the");
console.log("bone's orientation. That is only correct where the bone's frame already");
console.log("matches the frame the piece was modelled in.");

let bad = 0, total = 0, inverted = 0;
for (const a of list) {
  const rows = inspect(a);
  if (!rows) continue;
  for (const r of rows) {
    total++;
    if (r.verdict !== "ok") bad++;
    if (r.verdict === "INVERTED") inverted++;
  }
}

console.log(`\n${bad} of ${total} attachment points are off-axis; ${inverted} fully INVERTED.`);
if (bad) {
  console.log("Each one wearing a world-axis piece shows it rotated on the body.");
  console.log("The fix is the solve the SHIELD already uses (actors.js attachWeapon,");
  console.log("align:'shield'): build the desired WORLD rotation and express it in");
  console.log("the bone's frame, instead of trusting the bone's frame.");
}
process.exit(bad ? 1 : 0);
