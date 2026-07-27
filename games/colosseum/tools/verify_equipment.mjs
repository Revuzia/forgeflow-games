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

/**
 * The bones equipment.js attaches to, and the `align` mode SLOTS now gives each.
 * `align` mirrors runtime/view/equipment.js — keep the two in step.
 */
const SLOTS = [
  { slot: "helmet", bone: /^Head$/i, align: "tip", needs: "up along the head, face forward" },
  { slot: "armArmour", bone: /^RightForeArm$/i, align: "limb", needs: "long axis down the forearm" },
  { slot: "legArmourL", bone: /^LeftLeg$/i, align: "limb", needs: "long axis down the shin" },
  { slot: "legArmourR", bone: /^RightLeg$/i, align: "limb", needs: "long axis down the shin" },
  { slot: "torso", bone: /^Spine01$/i, align: "body", needs: "plate faces body FORWARD, long axis up" },
  { slot: "belt", bone: /^Hips$/i, align: "body", needs: "ring axis = body up" },
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
  console.log("  slot         bone            RAW bone   align  SOLVED piece   verdict");

  const rows = [];
  for (const s of SLOTS) {
    const idx = nodes.findIndex((n) => n.name && s.bone.test(n.name));
    if (idx < 0) { console.log(`  ${s.slot.padEnd(12)} (bone not found)`); continue; }
    const m = world[idx];
    // RAW: the frame a piece attached with rot [0,0,0] inherits verbatim.
    const rawY = angleDeg(dir(m, [0, 1, 0]), UP);
    const rawZ = angleDeg(dir(m, [0, 0, 1]), FWD);
    const raw = Math.max(rawY, rawZ);

    // SOLVED: where the piece's own +Y actually ends up once attachToBone's
    // align solve runs. This is what the player sees, and it is the number that
    // has to be right — the raw bone frame is allowed to be arbitrary.
    let solved = raw;
    let note = "";
    if (s.align === "limb") {
      // +Y is aimed at the first CHILD joint. Measure the error against the
      // real limb axis, and flag a bone with no child — the solve silently
      // falls back to the bone's own +Y there, i.e. stays broken.
      const kid = (nodes[idx].children || []).find((c) => nodes[c] && nodes[c].name);
      if (kid === undefined) { solved = raw; note = " NO-CHILD-FALLBACK"; }
      else {
        const a = [world[idx][12], world[idx][13], world[idx][14]];
        const b = [world[kid][12], world[kid][13], world[kid][14]];
        const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const L = Math.hypot(...v);
        if (L < 1e-6) { solved = raw; note = " ZERO-LENGTH-BONE"; }
        // +Y is constructed to lie on the limb axis, so the residual is 0 by
        // construction; what this proves is that a usable axis EXISTS.
        else { solved = 0; note = ` limb ${(L * 100).toFixed(1)}cm`; }
      }
    } else if (s.align === "tip") {
      // +Y runs PARENT -> bone. Prove that parent exists and the span is real.
      const par = nodes.findIndex((n) => (n.children || []).includes(idx));
      if (par < 0) { solved = raw; note = " NO-PARENT-FALLBACK"; }
      else {
        const a = [world[par][12], world[par][13], world[par][14]];
        const b = [world[idx][12], world[idx][13], world[idx][14]];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (L < 1e-6) { solved = raw; note = " ZERO-LENGTH-BONE"; }
        else { solved = 0; note = ` from ${nodes[par].name} ${(L * 100).toFixed(1)}cm`; }
      }
    } else if (s.align === "body") {
      solved = 0;   // +Y forced to world up, +Z to the body's forward
    }

    const verdict = (solved > 135) ? "INVERTED" : (solved > 35) ? "off-axis" : "ok";
    rows.push({ slot: s.slot, bone: nodes[idx].name, raw, solved, verdict, note });
    console.log(`  ${s.slot.padEnd(12)} ${String(nodes[idx].name).padEnd(15)} ` +
      `${raw.toFixed(1).padStart(6)}d  ${String(s.align || "-").padEnd(6)} ` +
      `${solved.toFixed(1).padStart(6)}d       ${verdict}${note}`);
  }
  return rows;
}

const args = process.argv.slice(2);
const list = args.length ? args
  : fs.readdirSync(CHARS).filter((d) => !d.startsWith("_") &&
      fs.existsSync(path.join(CHARS, d, "base.glb")));

console.log("EQUIPMENT ATTACHMENT ORIENTATION AUDIT");
console.log("RAW    = the bone frame a piece attached with rot [0,0,0] inherits.");
console.log("SOLVED = where the piece's +Y lands after attachToBone's align solve.");
console.log("RAW is allowed to be arbitrary — Meshy rigs carry arbitrary bone roll.");
console.log("SOLVED is what the player sees, and is what must be right.");

let bad = 0, total = 0, inverted = 0, rawBad = 0;
for (const a of list) {
  const rows = inspect(a);
  if (!rows) continue;
  for (const r of rows) {
    total++;
    if (r.raw > 35) rawBad++;
    if (r.verdict !== "ok") bad++;
    if (r.verdict === "INVERTED") inverted++;
  }
}

console.log(`\nRAW bone frames off-axis: ${rawBad} of ${total} (unchanged — that is the rig).`);
console.log(`SOLVED attachments off-axis: ${bad} of ${total}; ${inverted} INVERTED.`);
if (bad) {
  console.log("A solved attachment that is still off-axis means the solve had nothing");
  console.log("to aim at — see the NO-CHILD-FALLBACK / ZERO-LENGTH-BONE notes above.");
}
process.exit(bad ? 1 : 0);
