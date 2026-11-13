// art_a_make_deaths.mjs - ART-A / plan P1.6: bake the seven Mixamo death clips to shared, clip-only GLBs IN METRES.
//
//   node art_a_make_deaths.mjs [--out ../assets/chars/clips] [--log stats.json]
//
// Sources (Mixamo, royalty-free in games; the raw FBX files are never redistributed, only these baked clips):
//   Rifle_8-Way_Locomotion_Pack/{death from the front, death from the back, death from right, death from front headshot,
//                                death from back headshot, death crouching headshot front}.fbx   (6)
//   Shooter_Pack/walking to dying.fbx                                                           (1)
// RETARGET (recovered from the shipped data, see REPORT.md): the shipped soldier_rifle_*.glb clips are the Mixamo FBX
// retargeted "rest-delta, rotations only, against the game rig (= the soldier skin)":
//        q_out(t) = rest_soldier[bone] * inverse(rest_fbx[bone]) * q_fbx(t)
// (verified: mean error 0.008 deg over all 52 bones of rifle_idle vs idle.fbx). The same maths is used here for the
// rotations. Unlike the standing-rifle clips (constant hips), a death needs the Hips to fall, so the Hips position is
// the FBX Hips position converted centimetres -> METRES and scaled by the rest-height ratio
//        k = soldier_hips_standing_height / fbx_hips_rest_height = 1.0179 / 1.042749
// (the same "rest-height scaling" retarget_clips_v3.py uses), which puts the standing start frame on the ground.
// The container is the shipped GameRig clip tree (root "GameRig", 52 mixamorig:* bones, rest TRS of the soldier skin),
// so the Hips parent is an identity node: player.js rebaseRootTracks is a no-op and the unit guard (mean hips Y in
// [0.2, 3]) is satisfied (every clip has mean hips Y 0.45-0.62 m).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CLI = "C:/Users/TestRun/AppData/Roaming/npm/node_modules/@gltf-transform/cli/";
const req = createRequire(CLI + "package.json");
const { NodeIO } = req("@gltf-transform/core");
const { dedup, prune } = req("@gltf-transform/functions");
const THREE_ROOT = "C:/Users/TestRun/Claude Claw/forgeflow-games/node_modules/three/";
const THREE = await import(pathToFileURL(THREE_ROOT + "build/three.module.js").href);
const { FBXLoader } = await import(pathToFileURL(THREE_ROOT + "examples/jsm/loaders/FBXLoader.js").href);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(HERE, opt("out", "../assets/chars/clips"));
mkdirSync(OUT, { recursive: true });
const MIX = "F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/";
const DEATHS = [
  ["death_front",       "Rifle_8-Way_Locomotion_Pack/death from the front.fbx"],
  ["death_front_head",  "Rifle_8-Way_Locomotion_Pack/death from front headshot.fbx"],
  ["death_back",        "Rifle_8-Way_Locomotion_Pack/death from the back.fbx"],
  ["death_back_head",   "Rifle_8-Way_Locomotion_Pack/death from back headshot.fbx"],
  ["death_right",       "Rifle_8-Way_Locomotion_Pack/death from right.fbx"],
  ["death_crouch_head", "Rifle_8-Way_Locomotion_Pack/death crouching headshot front.fbx"],
  ["death_walking",     "Shooter_Pack/walking to dying.fbx"],
];
const TEMPLATE = path.join(ROOT, "assets/chars/meshy/soldier_rifle_idle.glb");
const clean = (n) => String(n || "").replace(/:/g, "");
const io = new NodeIO();
const stats = [];

for (const [clip, rel] of DEATHS) {
  // ---- source FBX (cm, Mixamo frames) ----
  const buf = readFileSync(MIX + rel);
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const restX = new Map(); let hipsRestY = null;
  fbx.traverse((o) => { if (o.isBone) { restX.set(clean(o.name), o.quaternion.clone()); if (/Hips$/.test(o.name)) hipsRestY = o.position.y; } });
  const src = fbx.animations[0];
  const trk = new Map(src.tracks.map((t) => [t.name, t]));

  // ---- container: the shipped GameRig tree (soldier rest TRS) ----
  const doc = await io.read(TEMPLATE);
  const root = doc.getRoot();
  const tmplAnim = root.listAnimations()[0];
  let standY = null;
  for (const ch of tmplAnim.listChannels()) {
    if (ch.getTargetPath() === "translation" && /Hips$/.test(ch.getTargetNode().getName())) standY = ch.getSampler().getOutput().getArray()[1];
  }
  for (const a of root.listAnimations()) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((x) => x.dispose()); a.dispose(); }
  const k = standY / (hipsRestY * 0.01);
  const buffer = root.listBuffers()[0];
  const anim = doc.createAnimation(clip);
  let nRot = 0;
  const bones = root.listNodes().filter((n) => n.getName() && n.getName() !== "GameRig");
  for (const node of bones) {
    const nm = clean(node.getName());
    const t = trk.get(nm + ".quaternion");
    if (!t) { console.error("ABORT " + clip + ": no FBX rotation track for " + nm); process.exit(1); }
    const rs = new THREE.Quaternion(...node.getRotation());                // rest of the game rig (soldier)
    const rxInv = restX.get(nm).clone().invert();                          // rest of the FBX source
    const n = t.times.length, out = new Float32Array(n * 4), q = new THREE.Quaternion(), qp = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      q.fromArray(t.values, i * 4);
      q.premultiply(rxInv).premultiply(rs).normalize();                    // rs * inv(rx) * q
      if (i > 0 && q.dot(qp) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }   // shortest-path continuity
      q.toArray(out, i * 4); qp.copy(q);
    }
    const qi = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) qi[i] = Math.max(-32767, Math.min(32767, Math.round(out[i] * 32767)));
    const acc = doc.createAccessor().setType("VEC4").setArray(qi).setNormalized(true).setBuffer(buffer);
    const times = doc.createAccessor().setType("SCALAR").setArray(new Float32Array(t.times)).setBuffer(buffer);
    const samp = doc.createAnimationSampler().setInput(times).setOutput(acc).setInterpolation("LINEAR");
    anim.addSampler(samp).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath("rotation").setSampler(samp));
    nRot++;
  }
  // Hips position: cm -> m, rest-height ratio
  const hp = trk.get("mixamorigHips.position");
  const hips = bones.find((n) => /Hips$/.test(n.getName()));
  const hv = new Float32Array(hp.values.length);
  for (let i = 0; i < hv.length; i++) hv[i] = hp.values[i] * 0.01 * k;
  const hsamp = doc.createAnimationSampler()
    .setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array(hp.times)).setBuffer(buffer))
    .setOutput(doc.createAccessor().setType("VEC3").setArray(hv).setBuffer(buffer)).setInterpolation("LINEAR");
  anim.addSampler(hsamp).addChannel(doc.createAnimationChannel().setTargetNode(hips).setTargetPath("translation").setSampler(hsamp));
  anim.setExtras({ source: "Mixamo (Adobe) " + rel, licence: "Mixamo royalty-free for use in games; baked clip only, raw FBX not redistributed",
    retarget: "rest-delta rotations vs soldier rig, hips cm->m x rest-height ratio", hipsHeightRatio: k });
  await doc.transform(dedup(), prune());
  const outPath = path.join(OUT, clip + ".glb");
  await io.write(outPath, doc);
  let sumY = 0, minY = 1e9; for (let i = 1; i < hv.length; i += 3) { sumY += hv[i]; minY = Math.min(minY, hv[i]); }
  const row = { clip, bytes: statSync(outPath).size, rotTracks: nRot, hipsKeys: hv.length / 3, duration: src.duration, hipsStartY: hv[1], hipsEndY: hv[hv.length - 2], hipsMeanY: sumY / (hv.length / 3), hipsMinY: minY, k };
  stats.push(row);
  console.log(clip.padEnd(18) + String(row.bytes).padStart(6) + " B  rot " + nRot + "  dur " + row.duration.toFixed(3) + "s  hipsY start " + row.hipsStartY.toFixed(3) + " end " + row.hipsEndY.toFixed(3) + " mean " + row.hipsMeanY.toFixed(3) + " min " + minY.toFixed(3) + "  k=" + k.toFixed(5));
}
if (opt("log", null)) writeFileSync(opt("log"), JSON.stringify(stats, null, 1));
