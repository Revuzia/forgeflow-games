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
// Merge — collapse an N-primitive mesh to ONE
// ---------------------------------------------------------------------------

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Read an accessor into a plain typed array, honouring bufferView byteStride. */
function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const TA = COMP[acc.componentType];
  const n = NCOMP[acc.type];
  const out = new TA(acc.count * n);
  if (acc.bufferView === undefined) return out;         // sparse/zero-filled
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || n * TA.BYTES_PER_ELEMENT;
  for (let i = 0; i < acc.count; i++) {
    const src = new TA(bin.buffer, bin.byteOffset + base + i * stride, n);
    out.set(src, i * n);
  }
  return out;
}

/**
 * Merge every primitive of every mesh into a single primitive per mesh.
 *
 * Poly Pizza / Quaternius rigs arrive split one-primitive-per-material with no
 * textures at all — the horse is 8 primitives purely because it has 8 flat
 * colours. That is 8 draw calls for one animal. Since the colours are flat,
 * they collapse into a COLOR_0 attribute with no loss, which is the same
 * vertex-colour trick actors.js already uses to weld a gladius and a scutum
 * down to one mesh each.
 *
 * JOINTS_n / WEIGHTS_n are carried through untouched and the skin is left
 * alone, so the rig and every clip keep working — decimating or re-indexing a
 * skinned mesh is what destroys weights, and we do neither.
 */
export function mergeGLB(inFile, outFile) {
  const { json, bin } = parseGLB(inFile);
  if (!bin) throw new Error(`${inFile}: no BIN chunk to merge`);

  const chunks = [];          // Buffer pieces for the new BIN
  let byteLen = 0;
  const newViews = [];
  const newAccessors = [];

  const pushAccessor = (typedArray, componentType, type, extra = {}) => {
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const pad = (4 - (byteLen % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLen += pad; }
    newViews.push({ buffer: 0, byteOffset: byteLen, byteLength: buf.length });
    chunks.push(buf);
    byteLen += buf.length;
    newAccessors.push({
      bufferView: newViews.length - 1, componentType, count: typedArray.length / NCOMP[type],
      type, ...extra,
    });
    return newAccessors.length - 1;
  };

  let merged = 0;
  const newMeshes = [];
  for (const mesh of json.meshes || []) {
    const prims = mesh.primitives || [];
    // Only TRIANGLES with matching attribute sets can be concatenated.
    const semantics = [...new Set(prims.flatMap((p) => Object.keys(p.attributes)))];
    const uniform = prims.every((p) => (p.mode === undefined || p.mode === 4)
      && semantics.every((s) => p.attributes[s] !== undefined));
    if (prims.length <= 1 || !uniform) { newMeshes.push(mesh); continue; }

    const acc = {};                       // semantic -> array of chunks
    for (const s of semantics) acc[s] = [];
    const colours = [];
    const indices = [];
    let vertexBase = 0;

    for (const p of prims) {
      const posCount = json.accessors[p.attributes.POSITION].count;
      for (const s of semantics) acc[s].push(readAccessor(json, bin, p.attributes[s]));
      // Bake this primitive's flat base colour into per-vertex colour.
      const mat = p.material !== undefined ? (json.materials || [])[p.material] : null;
      const bcf = (mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) || [1, 1, 1, 1];
      for (let i = 0; i < posCount; i++) colours.push(bcf[0], bcf[1], bcf[2], bcf[3] === undefined ? 1 : bcf[3]);
      // Concatenating vertices shifts every index by the running vertex count.
      const idx = p.indices !== undefined
        ? readAccessor(json, bin, p.indices)
        : Uint32Array.from({ length: posCount }, (_, i) => i);
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexBase);
      vertexBase += posCount;
    }

    const attributes = {};
    for (const s of semantics) {
      const src = json.accessors[prims[0].attributes[s]];
      const TA = COMP[src.componentType];
      const flat = new TA(acc[s].reduce((n, a) => n + a.length, 0));
      let o = 0;
      for (const a of acc[s]) { flat.set(a, o); o += a.length; }
      const extra = {};
      if (s === "POSITION") {                       // POSITION min/max are required
        const n = 3, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < flat.length; i += n) {
          for (let c = 0; c < n; c++) { mn[c] = Math.min(mn[c], flat[i + c]); mx[c] = Math.max(mx[c], flat[i + c]); }
        }
        extra.min = mn; extra.max = mx;
      }
      if (src.normalized) extra.normalized = true;
      attributes[s] = pushAccessor(flat, src.componentType, src.type, extra);
    }
    attributes.COLOR_0 = pushAccessor(new Float32Array(colours), 5126, "VEC4");
    // u16 overflows past 65,535 vertices; pick the width the data needs.
    const wide = vertexBase > 65535;
    const idxArr = wide ? new Uint32Array(indices) : new Uint16Array(indices);

    newMeshes.push({
      ...mesh,
      primitives: [{ attributes, indices: pushAccessor(idxArr, wide ? 5125 : 5123, "SCALAR"), material: 0, mode: 4 }],
    });
    merged += prims.length;
  }

  // Mesh primitives are not the only things that index into `accessors`:
  // skins[].inverseBindMatrices and every animation sampler's input/output do
  // too. Rebuilding the accessor array without remapping those leaves them
  // pointing at rewritten slots — which our own parser happily accepts and
  // GLTFLoader rejects with "Cannot read properties of undefined". Carry each
  // one across and record the new index.
  const carried = new Map();                      // old accessor index -> new
  const carry = (oldIndex) => {
    if (oldIndex === undefined || oldIndex === null) return undefined;
    if (carried.has(oldIndex)) return carried.get(oldIndex);
    const src = json.accessors[oldIndex];
    const data = readAccessor(json, bin, oldIndex);
    const extra = {};
    if (src.normalized) extra.normalized = true;
    if (src.min) extra.min = src.min;
    if (src.max) extra.max = src.max;
    const idx = pushAccessor(data, src.componentType, src.type, extra);
    carried.set(oldIndex, idx);
    return idx;
  };

  const newSkins = (json.skins || []).map((s) => ({
    ...s,
    ...(s.inverseBindMatrices !== undefined ? { inverseBindMatrices: carry(s.inverseBindMatrices) } : {}),
  }));
  const newAnimations = (json.animations || []).map((a) => ({
    ...a,
    samplers: (a.samplers || []).map((sm) => ({ ...sm, input: carry(sm.input), output: carry(sm.output) })),
  }));

  const out = {
    ...json, meshes: newMeshes, accessors: newAccessors, bufferViews: newViews,
    skins: newSkins, animations: newAnimations,
  };
  out.materials = [{
    name: "merged", doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.0, roughnessFactor: 0.82 },
  }];
  delete out.textures; delete out.images; delete out.samplers;
  const newBin = Buffer.concat(chunks);
  out.buffers = [{ byteLength: newBin.length }];

  writeGLB(outFile, out, newBin);
  return { merged, primitives: newMeshes.reduce((n, m) => n + m.primitives.length, 0), bytes: fs.statSync(outFile).size };
}

/** Write { json, bin } back out as a valid GLB. */
export function writeGLB(file, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);   // pad with spaces
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(CHUNK_JSON, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length, 0); bh.writeUInt32LE(CHUNK_BIN, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, jsonChunk, bh, binChunk]));
}

/** Drop animation clips by predicate — dedupes the `Armature|Foo` twins. */
export function filterClips(json, keep) {
  const anims = json.animations || [];
  json.animations = anims.filter((a) => keep(a.name || ""));
  return anims.length - json.animations.length;
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
} else if (cmd === "merge") {
  const [src, dst, ...rest] = args;
  if (!src || !dst) { console.log("usage: merge <in.glb> <out.glb> [--drop-clip-prefix <str>]"); process.exit(2); }
  const before = inventory(src);
  const r = mergeGLB(src, dst);
  // Optional clip pruning: exporters emit `Armature|Gallop` twins of every clip.
  const pi = rest.indexOf("--drop-clip-prefix");
  if (pi !== -1 && rest[pi + 1]) {
    const { json, bin } = parseGLB(dst);
    const dropped = filterClips(json, (n) => !n.startsWith(rest[pi + 1]));
    writeGLB(dst, json, bin);
    if (dropped) console.log(`  dropped ${dropped} clip(s) prefixed "${rest[pi + 1]}"`);
  }
  const after = inventory(dst);
  console.log(`\nmerge ${before.name} -> ${path.basename(dst)}`);
  console.log(`  primitives ${before.primitives} -> ${after.primitives}   (draw calls)`);
  console.log(`  triangles  ${before.triangles} -> ${after.triangles}`);
  console.log(`  clips      ${before.clipCount} -> ${after.clipCount}`);
  console.log(`  joints     ${before.joints} -> ${after.joints}`);
  console.log(`  size       ${before.mb} MB -> ${after.mb} MB`);
  if (after.primitives !== 1) { console.log("  !! still more than one primitive"); process.exit(1); }
  if (after.joints !== before.joints || after.triangles !== before.triangles) {
    console.log("  !! rig or geometry changed — refusing to call this a success"); process.exit(1);
  }
  console.log("  OK — one draw call, rig and geometry intact.");
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
