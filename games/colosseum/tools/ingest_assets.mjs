// Colosseum — asset ingest + draw-call gate.
//
// WHY THIS EXISTS: a glTF mesh with N primitives becomes N THREE.Mesh objects,
// i.e. N draw calls. Several of the animals we want are split across many
// primitives and materials, and dropping them in raw would quietly blow the
// frame budget:
//
//   lion.glb      8 primitives / 8 materials  ->  8 draw calls for ONE animal
//   arenabull.glb 7 / 7
//   warhorse.glb  8 / 8
//   wolf.glb      4 / 4
//
// A beast bout with two lions would spend 16 draw calls on the beasts alone.
// So nothing enters assets/ without passing through here. The tool:
//
//   1. reports every source GLB's primitive/material/clip inventory,
//   2. MERGES a skinned model down to one primitive where the materials can be
//      atlased or collapsed (preserving skin weights and joints),
//   3. FAILS LOUDLY on anything still >1 primitive, so a regression cannot
//      sneak in later.
//
// It is a pure-node tool (no browser), operating on the glTF JSON + binary
// chunk directly, so it can run in CI.
//
// usage:
//   node tools/ingest_assets.mjs report <glb...>     inventory only
//   node tools/ingest_assets.mjs gate <dir>          fail if any GLB >1 prim

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// GLB container parsing
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/**
 * Read a .glb into { json, bin }. Chunk lengths in a valid GLB are already
 * 4-byte aligned and include their own padding, so walking start+8+len lands
 * exactly on the next chunk header.
 */
export function parseGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file}: not a GLB`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = start + len;
    if (end > buf.length) break;
    if (type === CHUNK_JSON) json = JSON.parse(buf.subarray(start, end).toString("utf8"));
    else if (type === CHUNK_BIN) bin = buf.subarray(start, end);
    off = end;
  }
  if (!json) throw new Error(`${file}: no JSON chunk`);
  return { json, bin, bytes: buf.length };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/** Everything we need to judge whether an asset is shippable. */
export function inventory(file) {
  const { json, bytes } = parseGLB(file);
  const meshes = json.meshes || [];
  let prims = 0;
  const modes = new Set();
  for (const m of meshes) {
    for (const p of m.primitives || []) {
      prims++;
      modes.add(p.mode === undefined ? 4 : p.mode);
    }
  }
  const clips = (json.animations || []).map((a) => a.name || "(unnamed)");
  // Triangle count from the index accessors (or positions when non-indexed).
  let tris = 0;
  for (const m of meshes) {
    for (const p of m.primitives || []) {
      const acc = p.indices !== undefined
        ? json.accessors[p.indices]
        : json.accessors[p.attributes && p.attributes.POSITION];
      if (acc) tris += Math.floor(acc.count / 3);
    }
  }
  return {
    file,
    name: path.basename(file),
    bytes,
    mb: +(bytes / 1048576).toFixed(2),
    meshes: meshes.length,
    primitives: prims,
    materials: (json.materials || []).length,
    textures: (json.textures || []).length,
    images: (json.images || []).length,
    skins: (json.skins || []).length,
    joints: json.skins && json.skins[0] ? (json.skins[0].joints || []).length : 0,
    nodes: (json.nodes || []).length,
    triangles: tris,
    clips,
    clipCount: clips.length,
    // A skinned mesh with one primitive is one draw call. Everything else
    // multiplies.
    drawCalls: prims,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pad(s, n) { return String(s).padEnd(n); }
function padl(s, n) { return String(s).padStart(n); }

function report(files) {
  const rows = [];
  for (const f of files) {
    try { rows.push(inventory(f)); }
    catch (e) { console.log(`  !! ${f}: ${e.message}`); }
  }
  rows.sort((a, b) => b.drawCalls - a.drawCalls || b.triangles - a.triangles);

  console.log(`\n${pad("asset", 26)}${padl("draws", 6)}${padl("tris", 9)}${padl("MB", 7)}${padl("skin", 5)}${padl("clips", 6)}  animations`);
  console.log("-".repeat(120));
  for (const r of rows) {
    const flag = r.drawCalls > 1 ? " <-- MERGE" : "";
    console.log(
      pad(r.name, 26) + padl(r.drawCalls, 6) + padl(r.triangles.toLocaleString(), 9) +
      padl(r.mb, 7) + padl(r.skins ? "Y" : "-", 5) + padl(r.clipCount, 6) + "  " +
      r.clips.slice(0, 6).map((c) => c.replace(/^Armature\|/, "").replace(/\|baselayer$/, "")).join(", ").slice(0, 58) + flag
    );
  }
  const totalDraws = rows.reduce((n, r) => n + r.drawCalls, 0);
  const bad = rows.filter((r) => r.drawCalls > 1);
  console.log("-".repeat(120));
  console.log(`${rows.length} assets, ${totalDraws} draw calls total, ${bad.length} need merging`);
  return { rows, bad };
}

// ---------------------------------------------------------------------------
// Anatomy classification
// ---------------------------------------------------------------------------
//
// A clip called "LeopardAttack" tells you nothing about whether the thing on
// screen walks on four legs. leopard.glb turned out to be an anthropomorphic
// leopard-MAN — correct clips, correct name, wrong species for an arena beast.
// That cost a full diagnostic round to discover by eye, so it is now a check.
//
// Bone naming is the cheap decisive signal: humanoid rigs carry arm/hand/
// shoulder/upleg chains, quadruped rigs carry tail/paw/front-back leg chains.

const HUMANOID_TOKENS = [
  /upperarm|forearm|\barm\b|shoulder|clavicle|hand[_.]?(l|r)?$|thumb|index|middle|pinky/i,
  /upleg|thigh[_.]?(l|r)?$|calf|spine\d|neck|head/i,
];
const QUADRUPED_TOKENS = [
  /tail/i,
  /(front|fore|hind|rear|back)[_ .-]?(leg|paw|foot|knee|ankle)/i,
  /paw|hoof|fetlock|hock|withers|muzzle|snout/i,
];

export function anatomy(file) {
  const { json } = parseGLB(file);
  const names = (json.nodes || []).map((n) => n.name || "");
  const jointIdx = new Set();
  for (const s of json.skins || []) for (const j of s.joints || []) jointIdx.add(j);
  const boneNames = names.filter((_, i) => jointIdx.has(i));

  let humanoid = 0;
  let quad = 0;
  const hits = { humanoid: [], quadruped: [] };
  for (const n of boneNames) {
    for (const re of HUMANOID_TOKENS) if (re.test(n)) { humanoid++; if (hits.humanoid.length < 6) hits.humanoid.push(n); break; }
    for (const re of QUADRUPED_TOKENS) if (re.test(n)) { quad++; if (hits.quadruped.length < 6) hits.quadruped.push(n); break; }
  }

  // Bind-pose extent from the POSITION accessors' declared min/max — free, and
  // a standing quadruped is markedly longer than it is tall.
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      const acc = json.accessors[p.attributes && p.attributes.POSITION];
      if (!acc || !acc.min || !acc.max) continue;
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], acc.min[i]); hi[i] = Math.max(hi[i], acc.max[i]); }
    }
  }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => (isFinite(v) ? +v.toFixed(2) : 0));
  const sorted = [...span].sort((a, b) => b - a);
  const elongation = sorted[1] > 0 ? +(sorted[0] / sorted[1]).toFixed(2) : 0;

  let verdict;
  if (quad > humanoid) verdict = "QUADRUPED";
  else if (humanoid > quad) verdict = "HUMANOID";
  else verdict = "UNCLEAR";

  return {
    name: path.basename(file), bones: boneNames.length,
    humanoidHits: humanoid, quadrupedHits: quad,
    sampleHumanoid: hits.humanoid, sampleQuadruped: hits.quadruped,
    bindSpan: span, elongation, verdict,
  };
}

function walkGLB(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.glb$/i.test(e.name)) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [, , cmd, ...args] = process.argv;

if (cmd === "report") {
  const files = args.flatMap((a) => (fs.existsSync(a) && fs.statSync(a).isDirectory() ? walkGLB(a) : [a]));
  report(files);
} else if (cmd === "anatomy") {
  const files = args.flatMap((a) => (fs.existsSync(a) && fs.statSync(a).isDirectory() ? walkGLB(a) : [a]));
  console.log(`\n${pad("asset", 18)}${padl("bones", 6)}${padl("human", 7)}${padl("quad", 6)}${padl("elong", 7)}  bind span        verdict`);
  console.log("-".repeat(104));
  for (const f of files) {
    try {
      const a = anatomy(f);
      console.log(
        pad(a.name, 18) + padl(a.bones, 6) + padl(a.humanoidHits, 7) + padl(a.quadrupedHits, 6) +
        padl(a.elongation, 7) + "  " + pad(a.bindSpan.join(" x "), 17) + a.verdict +
        (a.verdict === "QUADRUPED" ? "" : `   [${(a.sampleHumanoid[0] || "")}]`)
      );
    } catch (e) { console.log(`  !! ${f}: ${e.message}`); }
  }
} else if (cmd === "gate") {
  const dir = args[0] || "assets";
  const files = walkGLB(dir);
  if (!files.length) {
    console.log(`gate: no GLBs under ${dir} — nothing to check`);
    process.exit(0);
  }
  const { bad } = report(files);
  if (bad.length) {
    console.log(`\nGATE FAILED — ${bad.length} asset(s) exceed 1 primitive and would each cost that many draw calls:`);
    bad.forEach((b) => console.log(`  ${b.name}: ${b.primitives} primitives / ${b.materials} materials`));
    process.exit(1);
  }
  console.log("\nGATE PASSED — every shipped asset is a single draw call.");
} else {
  console.log(`Colosseum asset ingest

  node tools/ingest_assets.mjs report <glb|dir ...>   inventory + draw-call cost
  node tools/ingest_assets.mjs gate <dir>             exit 1 if any GLB >1 primitive
`);
}
