// art_a_make_clips.mjs - ART-A / plan P1.1: build ONE shared clip GLB per MESHY_CLIPS name.
//
//   node art_a_make_clips.mjs --quant [--skin soldier] [--out ../assets/chars/clips] [--tol 1e-4] [--log stats.json]
//   (shipped build: --quant, no --tol. --tol is lossy: up to 0.27 deg on one bone of rifle_reload, so it is NOT used.)
//
// Source: assets/chars/meshy/<skin>_<clip>.glb (the 17 clips are md5-identical across all five skins; this script
// re-verifies that and refuses to run if they are not). Output per clip: a clip-only GLB with
//   * exactly ONE animation (animations[0], the only one the runtime reads; the 0-duration "mixamo.com" placeholder
//     that 10 of the 17 files carried is dropped), named after the clip;
//   * translation and scale tracks removed on every node EXCEPT Hips (player.js stripRootMotion drops them at load
//     anyway; they were the bone lengths of the SOURCE skeleton);
//   * unanimated leaf nodes (fingertip / HeadTop_End / Mesh) and the empty skin removed - the animated bone names and the
//     Hips parent chain (which player.js rebaseRootTracks reads) are untouched;
//   * optional keyframe reduction (--tol): gltf-transform resample, per-component tolerance, and optional int16
//     normalised rotation outputs (--quant).
// Nothing in assets/chars/meshy is modified or deleted (the PLAYER lane falls back to the per-skin originals).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = "C:/Users/TestRun/AppData/Roaming/npm/node_modules/@gltf-transform/cli/";
const req = createRequire(CLI + "package.json");
const { NodeIO } = req("@gltf-transform/core");
const { resample, prune, dedup } = req("@gltf-transform/functions");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes("--" + k);
const SKIN = opt("skin", "soldier");
const OUT = path.resolve(HERE, opt("out", "../assets/chars/clips"));
const TOL = parseFloat(opt("tol", "0"));
const QUANT = flag("quant");
const SKINS = ["athlete", "juggernaut", "soldier", "viper", "wraith"];
// = player.js MESHY_CLIPS after P1.6 (death2 / death3 were dropped there: Meshy-library actions, against the Mixamo-only rule)
const CLIPS = ["idle", "walk", "run", "death", "hit", "dance", "cheer", "jump", "swim", "crouch",
  "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch"];
const SRC = path.join(ROOT, "assets/chars/meshy");
mkdirSync(OUT, { recursive: true });

const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
const isHips = (n) => /(^|:)?(mixamorig:?)?Hips$/i.test(n || "");

const io = new NodeIO();
const rows = [];
let totalOld = 0, totalNew = 0;
for (const clip of CLIPS) {
  // 1. identical across skins?
  const hashes = SKINS.map((s) => md5(path.join(SRC, `${s}_${clip}.glb`)));
  if (new Set(hashes).size !== 1) { console.error(`ABORT: ${clip} differs between skins`, hashes); process.exit(1); }
  const srcPath = path.join(SRC, `${SKIN}_${clip}.glb`);
  const oldBytes = statSync(srcPath).size;
  const doc = await io.read(srcPath);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  const a0 = anims[0];
  for (let i = 1; i < anims.length; i++) { anims[i].listChannels().forEach((c) => c.dispose()); anims[i].listSamplers().forEach((x) => x.dispose()); anims[i].dispose(); }
  a0.setName(clip);
  let dropped = 0, kept = 0, hipsT = 0, hipsS = 0;
  for (const ch of a0.listChannels()) {
    const p = ch.getTargetPath();
    const node = ch.getTargetNode();
    const nm = node ? node.getName() : "";
    if ((p === "translation" || p === "scale") && !isHips(nm)) {
      const s = ch.getSampler(); ch.dispose(); if (s && s.listParents().filter((x) => x.propertyType === "AnimationChannel").length === 0) s.dispose();
      dropped++;
    } else { kept++; if (isHips(nm) && p === "translation") hipsT++; if (isHips(nm) && p === "scale") hipsS++; }
  }
  // 2. unanimated leaf nodes + skins
  for (const sk of root.listSkins()) sk.dispose();
  const animated = new Set(a0.listChannels().map((c) => c.getTargetNode()));
  const keepNode = (n) => animated.has(n) || n.listChildren().some(keepNode);
  let removedNodes = 0;
  for (const n of root.listNodes()) {
    if (!keepNode(n) && n.listParents().some((p) => p.propertyType === "Node")) { n.dispose(); removedNodes++; }
  }
  // 3. optional keyframe reduction
  if (TOL > 0) await doc.transform(resample({ tolerance: TOL }));
  if (QUANT) {
    for (const s of a0.listSamplers()) {
      const ch = a0.listChannels().find((c) => c.getSampler() === s);
      if (ch && ch.getTargetPath() === "rotation") {
        const acc = s.getOutput(); const f = acc.getArray();
        const q = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(f[i] * 32767)));
        acc.setArray(q); acc.setNormalized(true);
      }
    }
  }
  await doc.transform(dedup(), prune());
  const outPath = path.join(OUT, `${clip}.glb`);
  await io.write(outPath, doc);
  const newBytes = statSync(outPath).size;
  totalOld += oldBytes; totalNew += newBytes;
  const tn = a0.listChannels().length;
  rows.push({ clip, oldBytes, newBytes, channels: tn, dropped, hipsT, hipsS, removedNodes });
  console.log(`${clip.padEnd(13)} ${String(oldBytes).padStart(7)} -> ${String(newBytes).padStart(7)} B  channels ${kept} (hips t=${hipsT} s=${hipsS}) dropped ${dropped} tracks, ${removedNodes} nodes`);
}
console.log(`TOTAL per skin ${totalOld} B -> shared ${totalNew} B  (x5 skins before = ${totalOld * 5} B)`);
if (opt("log", null)) writeFileSync(opt("log"), JSON.stringify({ skin: SKIN, tol: TOL, quant: QUANT, totalOld, totalNew, rows }, null, 1));
