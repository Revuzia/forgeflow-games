// art_a_make_loco8.mjs - parity lane P1-F: bake the P1 Mixamo clip set (8-way rifle strafes, crouch strafes, pistol
// strafes, jump up/loop/down, falling idle, hard landing, grenade toss, DBNO crawl/injured idle, emotes) to shared,
// clip-only GLBs IN METRES, plus a SIDECAR manifest (manifest_p1f.json; the live manifest.json is not touched).
// NO RUNTIME WIRING: nothing in player.js loads these yet (P2-A wires them).
//
//   node art_a_make_loco8.mjs [--out ../assets/chars/clips] [--manifest manifest_p1f.json] [--only a,b] [--check-only]
//
// Derived from art_a_make_deaths.mjs (same source library, same container, same retarget):
//   source  F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/<pack>/<clip>.fbx (Adobe Mixamo, royalty-free
//           for games; only the baked clips ship, the raw FBX files are never redistributed)
//   rotations  rest-delta against the game rig (= the soldier skin):  q_out(t) = rest_soldier * inv(rest_fbx) * q_fbx(t)
//           (ART-A recovered it from the shipped data: 0.008 deg mean over the 52 bones of rifle_idle vs idle.fbx;
//           re-checked by this script on every run, see RETARGET CHECK below - the bake aborts above 0.01 deg)
//   hips    FBX Hips position cm -> m x the rest-height ratio k = soldier standing hips (1.0179) / FBX rest hips (1.04275 m),
//           so the Mixamo feet stay on the ground (the death clips use the same rule).
//           LOOPING locomotion: the linear root travel is removed from X/Z (the clip plays in place; the travel is
//           recorded as rootSpeed / stride in the sidecar), the per-step sway and the vertical bob are kept.
//           One-shots keep their X/Z as authored (player.js stripRootMotion flattens X/Z at load anyway).
//   container  the shipped GameRig clip tree (root "GameRig", 52 mixamorig:* bones, soldier rest TRS), exactly ONE
//           animation named after the clip, rotations as int16 normalised (ART-A P1.1: 0.0033 deg), times shared (dedup).
//
// STRIDE (measured at bake time, on the GAME rig): forward kinematics of the soldier rest skeleton driven by the baked
// tracks, sampled at 120 Hz. rootSpeed = FBX root travel (m, after k) / cycle; contactSpeed = how fast the planted foot
// slides backwards relative to the hips during ground contact (the speed the clip "wants" when played in place);
// skateRatio = planted-foot world speed WITH the root travel re-added / rootSpeed (0 = perfectly planted).
// P2-A's play rate for a clip = actor ground speed / contactSpeed.
//
// RETARGET CHECK: the shipped rifle_idle.glb (and, as corroboration, rifle_walk/run/crouch/reload) is compared with the
// same FBX baked through THIS script's retarget function: mean and max angular error over all 52 bones sampled at 120 Hz.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
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
const flag = (k) => args.includes("--" + k);
const OUT = path.resolve(HERE, opt("out", "../assets/chars/clips"));
const MANIFEST = path.join(OUT, opt("manifest", "manifest_p1f.json"));
const ONLY = opt("only", null) ? new Set(opt("only").split(",")) : null;
const CHECK_ONLY = flag("check-only");
const MAX_RETARGET_DEG = 0.01;
const HIPS_MEAN_FLOOR = 0.21;
const MAX_LOOP_SEAM_DEG = 30;   // the largest FBX seam seen on a real Mixamo cycle here is 23 deg (running crawl, one fast frame)   // player.js stripRootMotion unit guard trips under a 0.2 m mean (see 3b)
// Optional key reduction (default OFF): Mixamo keys are already sparse, and per-track time arrays cost more than the
// keys a 0.01 deg tolerance removes (measured: dbno_crawl 85.9 -> 99.9 KB). The error is recorded per clip when used.
const TOL_DEG = parseFloat(opt("tol-deg", "0"));
const MIX = "F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/";
const R8 = "Rifle_8-Way_Locomotion_Pack/";

// [clip, source, kind, loop, group, extra]
//   group "rifle_strafe" = the set the 260 KB budget applies to; every clip counts toward the 700 KB total.
const CLIPS = [
  ["rifle_walk_left",    R8 + "walk left.fbx",                 "strafe",        true,  "rifle_strafe"],
  ["rifle_walk_right",   R8 + "walk right.fbx",                "strafe",        true,  "rifle_strafe"],
  ["rifle_walk_back",    R8 + "walk backward.fbx",             "strafe",        true,  "rifle_strafe"],
  ["rifle_run_left",     R8 + "run left.fbx",                  "strafe",        true,  "rifle_strafe"],
  ["rifle_run_right",    R8 + "run right.fbx",                 "strafe",        true,  "rifle_strafe"],
  ["rifle_run_back",     R8 + "run backward.fbx",              "strafe",        true,  "rifle_strafe"],
  ["rifle_crouch_left",  R8 + "walk crouching left.fbx",       "crouch_strafe", true,  "rifle_strafe"],
  ["rifle_crouch_right", R8 + "walk crouching right.fbx",      "crouch_strafe", true,  "rifle_strafe"],
  ["rifle_crouch_back",  R8 + "walk crouching backward.fbx",   "crouch_strafe", true,  "rifle_strafe"],
  ["pistol_strafe_left", "Pistol_Handgun_Locomotion_Pack/pistol strafe.fbx",     "pistol_strafe", true, "other"],
  ["pistol_strafe_right","Pistol_Handgun_Locomotion_Pack/pistol strafe (2).fbx", "pistol_strafe", true, "other"],
  ["jump_up",            R8 + "jump up.fbx",                   "air",           false, "other"],
  ["jump_loop",          R8 + "jump loop.fbx",                 "air",           true,  "other"],
  ["jump_down",          R8 + "jump down.fbx",                 "air",           false, "other"],
  ["fall_idle",          "Action_Adventure_Pack/falling idle.fbx", "air",       true,  "other"],
  ["land_hard",          "Action_Adventure_Pack/hard landing.fbx", "land",      false, "other"],
  ["toss_grenade",       "Basic_Shooter_Pack/toss grenade.fbx",    "throw",     false, "other"],
  ["dbno_crawl",         "Scary_Zombie_Pack/zombie crawl.fbx",     "dbno",      true,  "other", { gatedBy: "OD-3" }],
  ["dbno_crawl_fast",    "Scary_Zombie_Pack/running crawl.fbx",    "dbno",      true,  "other", { gatedBy: "OD-3" }],
  ["injured_idle",       "Male_Injured_Pack/injured idle.fbx",     "dbno",      true,  "other", { gatedBy: "OD-3" }],
  ["emote_cocky",        "Gestures_Pack_Basic/being cocky.fbx",    "emote",     false, "other"],
  ["emote_uprock",       "Breakdance_Pack/breakdance uprock.fbx",  "emote",     true,  "other"],
  ["emote_footwork",     "Breakdance_Pack/breakdance footwork 2.fbx", "emote",  true,  "other"],
  ["emote_flair",        "Breakdance_Pack/flair.fbx",              "emote",     false, "other"],
];
// shipped clip -> the FBX it was baked from (retarget check; rifle_idle is the gate, the rest corroborate)
const CHECKS = [
  ["rifle_idle",   R8 + "idle.fbx", true],
  ["rifle_walk",   R8 + "walk forward.fbx", false],
  ["rifle_run",    R8 + "run forward.fbx", false],
  ["rifle_crouch", R8 + "walk crouching forward.fbx", false],
  ["rifle_reload", "Basic_Shooter_Pack/reloading.fbx", false],
];

const TEMPLATE = path.join(ROOT, "assets/chars/meshy/soldier_rifle_idle.glb");
const clean = (n) => String(n || "").replace(/:/g, "");
const io = new NodeIO();

function parseFbx(rel) {
  const buf = readFileSync(MIX + rel);
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const restX = new Map(); let hipsRestY = null;
  fbx.traverse((o) => { if (o.isBone) { restX.set(clean(o.name), o.quaternion.clone()); if (/Hips$/.test(o.name)) hipsRestY = o.position.y; } });
  const src = fbx.animations[0];
  return { restX, hipsRestY, src, trk: new Map(src.tracks.map((t) => [t.name, t])) };
}

async function openTemplate() {
  const doc = await io.read(TEMPLATE);
  const root = doc.getRoot();
  let standY = null;
  for (const ch of root.listAnimations()[0].listChannels()) {
    if (ch.getTargetPath() === "translation" && /Hips$/.test(ch.getTargetNode().getName())) standY = ch.getSampler().getOutput().getArray()[1];
  }
  for (const a of root.listAnimations()) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((x) => x.dispose()); a.dispose(); }
  const bones = root.listNodes().filter((n) => n.getName() && n.getName() !== "GameRig");
  return { doc, root, standY, bones };
}

/** rest-delta retarget of one bone's FBX rotation track -> Float32Array of quats (shortest-path continuous) */
function retargetRot(node, t, restX) {
  const nm = clean(node.getName());
  const rs = new THREE.Quaternion(...node.getRotation());
  const rxInv = restX.get(nm).clone().invert();
  const n = t.times.length, out = new Float32Array(n * 4), q = new THREE.Quaternion(), qp = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    q.fromArray(t.values, i * 4);
    q.premultiply(rxInv).premultiply(rs).normalize();
    if (i > 0 && q.dot(qp) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
    q.toArray(out, i * 4); qp.copy(q);
  }
  return out;
}
const quant = (f) => { const q = new Int16Array(f.length); for (let i = 0; i < f.length; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(f[i] * 32767))); return q; };
const dequant = (q) => { const f = new Float32Array(q.length); for (let i = 0; i < q.length; i++) f[i] = Math.max(-1, q[i] / 32767); return f; };

/** Douglas-Peucker style key reduction of a quaternion track: keeps the end keys and every key whose removal would
 *  put the slerp between its neighbours more than tolDeg away from it. Returns the kept indices. */
function reduceQuat(times, vals, tolDeg) {
  const n = times.length;
  if (tolDeg <= 0 || n <= 2) return [...Array(n).keys()];
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qk = new THREE.Quaternion(), qi = new THREE.Quaternion();
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); if (j - i < 2) continue;
    qa.fromArray(vals, i * 4); qb.fromArray(vals, j * 4);
    let worst = -1, we = 0;
    for (let k2 = i + 1; k2 < j; k2++) {
      qi.copy(qa).slerp(qb, (times[k2] - times[i]) / (times[j] - times[i]));
      const e = angDeg(qi, qk.fromArray(vals, k2 * 4)); if (e > we) { we = e; worst = k2; }
    }
    if (we > tolDeg) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
  }
  return [...Array(n).keys()].filter((x) => keep[x]);
}
function reduceVec3(times, vals, tolM) {
  const n = times.length;
  if (tolM <= 0 || n <= 2) return [...Array(n).keys()];
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); if (j - i < 2) continue;
    let worst = -1, we = 0;
    for (let k2 = i + 1; k2 < j; k2++) {
      const u = (times[k2] - times[i]) / (times[j] - times[i]);
      let e = 0; for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(vals[i * 3 + c] + (vals[j * 3 + c] - vals[i * 3 + c]) * u - vals[k2 * 3 + c]));
      if (e > we) { we = e; worst = k2; }
    }
    if (we > tolM) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
  }
  return [...Array(n).keys()].filter((x) => keep[x]);
}
const pick = (arr, idx, w) => { const o = new Float32Array(idx.length * w); idx.forEach((ix, m) => { for (let c = 0; c < w; c++) o[m * w + c] = arr[ix * w + c]; }); return o; };
const rnd = (v, d) => v.map((x) => { const r = Math.round(x * d) / d; return Math.abs(r) < 0.5 / d ? 0 : r; });

/** bake one clip into a fresh GameRig container.
 *  opts.loop  : looping clip (root travel removed from X/Z; a missing wrap frame is closed, see 2.)
 *  opts.tolDeg: key-reduction tolerance per bone in degrees (0 = every FBX key kept)
 *  Returns the doc plus the tracks exactly as the runtime will read them (dequantised) for the measurements. */
async function bake(clip, rel, opts) {
  const loop = !!opts.loop, tolDeg = opts.tolDeg || 0, tolM = tolDeg > 0 ? 0.0005 : 0;
  const F = parseFbx(rel);
  const T = await openTemplate();
  const { doc, root, bones } = T;
  const k = T.standY / (F.hipsRestY * 0.01);
  const buffer = root.listBuffers()[0];
  const anim = doc.createAnimation(clip);
  // 1. retarget every bone (float)
  const src = new Map();
  for (const node of bones) {
    const nm = clean(node.getName());
    const t = F.trk.get(nm + ".quaternion");
    if (!t) throw new Error("ABORT " + clip + ": no FBX rotation track for " + nm);
    src.set(nm, { node, times: Float32Array.from(t.times), vals: retargetRot(node, t, F.restX) });
  }
  // REST TRS of the container, written lean (JSON is ~70 % of a short clip's bytes). Every one of the 52 bones carries a
  // rotation track, so a node's rest ROTATION is never shown by anything that plays the clip; it is dropped (identity)
  // once the retarget above has used it. Rest translations (bone lengths) stay, at 0.1 mm. The runtime binds the tracks
  // by bone NAME and reads only the Hips parent (GameRig, identity) from a clip file (player.js rebaseRootTracks), so
  // neither changes anything it reads.
  for (const nd of root.listNodes()) { nd.setTranslation(rnd(nd.getTranslation(), 1e4)); if (src.has(clean(nd.getName()))) nd.setRotation([0, 0, 0, 1]); nd.setScale(rnd(nd.getScale(), 1e4)); }
  const hp = F.trk.get("mixamorigHips.position");
  const t0 = hp.times[0];
  const tEnd = Math.max(hp.times[hp.times.length - 1], ...[...src.values()].map((x) => x.times[x.times.length - 1]));
  const dur = tEnd - t0;
  // 2. LOOP SEAM. Several Mixamo loops end ONE frame before the wrap (the last key is not the first pose again; the
  //    seam angle is the size of an ordinary frame step). Played as-is, the mixer jumps last -> first in zero time: a
  //    one-frame hitch per loop. Close the loop with a key equal to the first pose, placed so that no bone moves faster
  //    over the closing step than its own fastest frame anywhere in the clip (whole 30 fps frames, 1..6).
  let seamDeg = 0, closeS = 0;
  if (loop) {
    let frames = 0;
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
    for (const [, tr] of src) {
      const n = tr.times.length; if (n < 2) continue;
      qa.fromArray(tr.vals, 0); qb.fromArray(tr.vals, (n - 1) * 4);
      const seam = angDeg(qa, qb); seamDeg = Math.max(seamDeg, seam);
      // this bone's fastest per-frame (1/30 s) motion anywhere in the clip
      let step = 0;
      for (let i = 1; i < n; i++) { qb.fromArray(tr.vals, (i - 1) * 4); qc.fromArray(tr.vals, i * 4); step = Math.max(step, angDeg(qb, qc) / Math.max(1e-6, (tr.times[i] - tr.times[i - 1]) * 30)); }
      if (seam > 1.5) frames = Math.max(frames, Math.ceil(seam / Math.max(step, 0.5) - 1e-6));
    }
    // a "loop" whose last pose is far from its first is not a cycle at all (flair: 141 deg): refuse, mark it a one-shot
    if (seamDeg > MAX_LOOP_SEAM_DEG) throw new Error("ABORT " + clip + ": not cyclic (last vs first key " + seamDeg.toFixed(1) + " deg > " + MAX_LOOP_SEAM_DEG + "); bake it as a one-shot");
    if (frames > 0) closeS = Math.min(6, Math.max(1, frames)) / 30;
  }
  const cycle = dur + closeS;
  if (closeS > 0) {
    for (const [, tr] of src) {
      const n = tr.times.length; if (n < 2) continue;
      // a track whose keys stop before the clip end HOLDS its last value until tEnd (as the FBX plays): keep that hold,
      // then close over [tEnd, tEnd + closeS]
      const hold = tr.times[n - 1] < tEnd - 1e-5 ? 1 : 0;
      const times = new Float32Array(n + hold + 1); times.set(tr.times);
      const vals = new Float32Array((n + hold + 1) * 4); vals.set(tr.vals);
      if (hold) { times[n] = tEnd; for (let c = 0; c < 4; c++) vals[n * 4 + c] = tr.vals[(n - 1) * 4 + c]; }
      times[n + hold] = t0 + cycle;
      const q = new THREE.Quaternion().fromArray(tr.vals, 0), ql = new THREE.Quaternion().fromArray(tr.vals, (n - 1) * 4);
      if (q.dot(ql) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
      q.toArray(vals, (n + hold) * 4);
      tr.times = times; tr.vals = vals;
    }
  }
  // 3. Hips position: cm -> m x k; loops: the linear root travel is removed from X/Z (for a closed loop the travel
  //    is extrapolated over the closing interval, so the next cycle starts where this one ends)
  const nh = hp.times.length;
  const raw = new Float32Array(hp.values.length);
  for (let i = 0; i < raw.length; i++) raw[i] = hp.values[i] * 0.01 * k;
  const tr0 = [raw[(nh - 1) * 3] - raw[0], raw[(nh - 1) * 3 + 1] - raw[1], raw[(nh - 1) * 3 + 2] - raw[2]];
  const hdur = hp.times[nh - 1] - t0;
  const travel = loop && hdur > 0 ? tr0.map((x) => x * cycle / hdur) : tr0;
  let hTimes = Float32Array.from(hp.times), hv = new Float32Array(raw);
  if (loop) {
    for (let i = 0; i < nh; i++) {
      const u = cycle > 0 ? (hp.times[i] - t0) / cycle : 0;
      hv[i * 3] = raw[i * 3] - travel[0] * u;
      hv[i * 3 + 2] = raw[i * 3 + 2] - travel[2] * u;
    }
    if (closeS > 0 && nh >= 2) {
      const t2 = new Float32Array(nh + 1); t2.set(hTimes); t2[nh] = t0 + cycle; hTimes = t2;
      const v2 = new Float32Array((nh + 1) * 3); v2.set(hv); v2[nh * 3] = hv[0]; v2[nh * 3 + 1] = hv[1]; v2[nh * 3 + 2] = hv[2]; hv = v2;
    }
  }
  // 3b. UNIT GUARD. player.js stripRootMotion rescales any root track whose MEAN height is under 0.2 m to a 0.99 m
  //     mean (its foreign-unit guard, meant for centimetre-authored files). A prone clip (zombie crawl: hips mean
  //     0.17 m) trips it and would play ~0.8 m in the air. Lift such a clip to a 0.21 m mean: measured in the game
  //     page (probe_clips.py), the zombie crawl as authored sinks 1-15 cm into y=0 on every skin in every phase, so
  //     the ~5 cm lift also grounds it better. Recorded per clip as hipsLiftM.
  let hipsLift = 0;
  { let sy = 0; const nk = hv.length / 3; for (let i = 0; i < nk; i++) sy += hv[i * 3 + 1];
    const mean = sy / nk; if (mean < HIPS_MEAN_FLOOR) { hipsLift = HIPS_MEAN_FLOOR - mean; for (let i = 0; i < nk; i++) hv[i * 3 + 1] += hipsLift; } }
  // 4. key reduction + int16, write
  const rot = new Map(), exact = new Map();
  let keysIn = 0, keysOut = 0;
  for (const [nm, tr] of src) {
    const idx = reduceQuat(tr.times, tr.vals, tolDeg);
    keysIn += tr.times.length; keysOut += idx.length;
    const times = pick(tr.times, idx, 1), qi = quant(pick(tr.vals, idx, 4));
    rot.set(nm, { times, values: dequant(qi) });
    exact.set(nm, { times: tr.times, values: dequant(quant(tr.vals)) });
    const acc = doc.createAccessor().setType("VEC4").setArray(qi).setNormalized(true).setBuffer(buffer);
    const tacc = doc.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
    const samp = doc.createAnimationSampler().setInput(tacc).setOutput(acc).setInterpolation("LINEAR");
    anim.addSampler(samp).addChannel(doc.createAnimationChannel().setTargetNode(tr.node).setTargetPath("rotation").setSampler(samp));
  }
  const hidx = reduceVec3(hTimes, hv, tolM);
  const hTimesR = pick(hTimes, hidx, 1), hvR = pick(hv, hidx, 3);
  const hips = bones.find((nd) => /Hips$/.test(nd.getName()));
  const hsamp = doc.createAnimationSampler()
    .setInput(doc.createAccessor().setType("SCALAR").setArray(hTimesR).setBuffer(buffer))
    .setOutput(doc.createAccessor().setType("VEC3").setArray(hvR).setBuffer(buffer)).setInterpolation("LINEAR");
  anim.addSampler(hsamp).addChannel(doc.createAnimationChannel().setTargetNode(hips).setTargetPath("translation").setSampler(hsamp));
  anim.setExtras({ source: "Mixamo (Adobe) " + rel, licence: "Mixamo royalty-free for use in games; baked clip only, raw FBX not redistributed",
    retarget: "rest-delta rotations vs soldier rig, hips cm->m x rest-height ratio" + (loop ? ", loop in place (root travel removed from X/Z)" : "") +
      (closeS > 0 ? ", loop closed +" + Math.round(closeS * 30) + " frame(s)" : "") +
      (hipsLift > 0 ? ", hips lifted " + hipsLift.toFixed(3) + " m (runtime unit guard)" : ""),
    hipsHeightRatio: +k.toFixed(6) });
  return { doc, root, bones, rot, exact, hipsTimes: hTimesR, hipsIn: hvR, travel, dur: cycle, srcDur: dur, closeS, seamDeg, hipsLift, k, keysIn, keysOut, src: F.src };
}

// ---------- sampling helpers ----------
function sampQ(tr, t, out) {
  const ts = tr.times, v = tr.values, n = ts.length;
  // normalised: int16 keys are not exactly unit length, and |q|^2 < 1 reads as a false angle in angDeg
  if (t <= ts[0] || n === 1) return out.fromArray(v, 0).normalize();
  if (t >= ts[n - 1]) return out.fromArray(v, (n - 1) * 4).normalize();
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  const a = (t - ts[lo]) / (ts[hi] - ts[lo]);
  const q0 = new THREE.Quaternion().fromArray(v, lo * 4), q1 = new THREE.Quaternion().fromArray(v, hi * 4);
  return out.copy(q0.normalize()).slerp(q1.normalize(), a).normalize();
}
function sampV(times, v, t, out) {
  const n = times.length;
  if (t <= times[0] || n === 1) return out.fromArray(v, 0);
  if (t >= times[n - 1]) return out.fromArray(v, (n - 1) * 3);
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const a = (t - times[lo]) / (times[hi] - times[lo]);
  return out.set(v[lo * 3] + (v[hi * 3] - v[lo * 3]) * a, v[lo * 3 + 1] + (v[hi * 3 + 1] - v[lo * 3 + 1]) * a, v[lo * 3 + 2] + (v[hi * 3 + 2] - v[lo * 3 + 2]) * a);
}
const angDeg = (a, b) => { const d = Math.min(1, Math.abs(a.dot(b))); return 2 * Math.acos(d) * 180 / Math.PI; };

/** FK rig of the soldier rest skeleton (template nodes) */
function buildRig(bones, root) {
  const objs = new Map();
  const top = new THREE.Object3D();
  const mk = (node, parent) => {
    const o = new THREE.Object3D(); o.name = clean(node.getName());
    o.position.fromArray(node.getTranslation()); o.quaternion.fromArray(node.getRotation()); o.scale.fromArray(node.getScale());
    parent.add(o); objs.set(o.name, o);
    for (const c of node.listChildren()) mk(c, o);
  };
  const gameRig = root.listNodes().find((nd) => nd.getName() === "GameRig");
  for (const c of gameRig.listChildren()) mk(c, top);
  return { top, objs };
}

/** stride / contact / seam metrics on the game rig */
function measure(B, loop) {
  const { top, objs } = buildRig(B.bones, B.root);
  const hips = objs.get("mixamorigHips");
  const feet = ["mixamorigLeftToeBase", "mixamorigRightToeBase"].map((nm) => objs.get(nm));
  const ankles = ["mixamorigLeftFoot", "mixamorigRightFoot"].map((nm) => objs.get(nm));
  const dt = 1 / 120, N = Math.max(2, Math.round(B.dur / dt) + 1);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), w = new THREE.Vector3();
  const rows = [];
  let headMinY = 1e9, headMaxY = -1e9;
  const head = objs.get("mixamorigHead");
  for (let i = 0; i < N; i++) {
    const t = B.hipsTimes[0] + Math.min(B.dur, i * dt);
    for (const [nm, tr] of B.rot) { const o = objs.get(nm); if (o) o.quaternion.copy(sampQ(tr, t, q)); }
    sampV(B.hipsTimes, B.hipsIn, t, p); hips.position.copy(p);
    top.updateMatrixWorld(true);
    const u = B.dur > 0 ? (t - B.hipsTimes[0]) / B.dur : 0;
    const r = { t, hips: p.clone(), toe: [], ank: [] };
    for (let f = 0; f < 2; f++) { r.toe.push(feet[f].getWorldPosition(new THREE.Vector3())); r.ank.push(ankles[f].getWorldPosition(new THREE.Vector3())); }
    r.u = u;
    const hy = head.getWorldPosition(w).y; headMinY = Math.min(headMinY, hy); headMaxY = Math.max(headMaxY, hy);
    rows.push(r);
  }
  const travelXZ = Math.hypot(B.travel[0], B.travel[2]);
  const rootSpeed = loop && B.dur > 0 ? travelXZ / B.dur : 0;
  const rootVel = loop && B.dur > 0 ? [B.travel[0] / B.dur, B.travel[2] / B.dur] : [0, 0];
  // ground contact: a foot is planted when its lowest point (min of toe/ankle Y) is within 2.5 cm of that foot's minimum
  let footMinY = 1e9;
  const contactSpeeds = [], skate = [];
  for (let f = 0; f < 2; f++) {
    const lowY = rows.map((r) => Math.min(r.toe[f].y, r.ank[f].y));
    const mn = Math.min(...lowY); footMinY = Math.min(footMinY, mn);
    for (let i = 1; i < rows.length; i++) {
      if (lowY[i] - mn > 0.025 || lowY[i - 1] - mn > 0.025) continue;
      const a = rows[i - 1], b = rows[i], ddt = b.t - a.t; if (ddt <= 0) continue;
      // in place (as baked): ankle horizontal speed
      contactSpeeds.push(Math.hypot(b.ank[f].x - a.ank[f].x, b.ank[f].z - a.ank[f].z) / ddt);
      // world (root travel re-added): residual slide
      const wx = (b.ank[f].x + rootVel[0] * b.t) - (a.ank[f].x + rootVel[0] * a.t), wz = (b.ank[f].z + rootVel[1] * b.t) - (a.ank[f].z + rootVel[1] * a.t);
      skate.push(Math.hypot(wx, wz) / ddt);
    }
  }
  const med = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  // loop seam: max bone angle between the first and last key
  let seamDeg = 0;
  if (loop) for (const [, tr] of B.rot) { const n = tr.times.length; const a = new THREE.Quaternion().fromArray(tr.values, 0).normalize(), b = new THREE.Quaternion().fromArray(tr.values, (n - 1) * 4).normalize(); seamDeg = Math.max(seamDeg, angDeg(a, b)); }
  // key-reduction error: the shipped (reduced) tracks vs every FBX key kept, both int16, sampled at 120 Hz
  let reduceMaxDeg = 0; const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  for (const [nm, tr] of B.rot) { const ex = B.exact.get(nm); for (let t = B.hipsTimes[0]; t <= B.hipsTimes[0] + B.dur + 1e-9; t += 1 / 120) reduceMaxDeg = Math.max(reduceMaxDeg, angDeg(sampQ(tr, t, qa), sampQ(ex, t, qb))); }
  const hy = Array.from({ length: B.hipsIn.length / 3 }, (_, i) => B.hipsIn[i * 3 + 1]);
  const contactSpeed = med(contactSpeeds), skateMed = med(skate);
  return {
    rootSpeed: +rootSpeed.toFixed(3),
    rootDirDeg: loop && travelXZ > 0.05 ? ((d) => (d === -180 ? 180 : d))(Math.round(Math.atan2(B.travel[0], B.travel[2]) * 180 / Math.PI)) : null,   // 0 = forward (+Z), 90 = character's left (+X)
    strideM: loop ? +travelXZ.toFixed(3) : 0,
    contactSpeed: contactSpeed == null ? null : +contactSpeed.toFixed(3),
    skateRatio: rootSpeed > 0.2 && skateMed != null ? +(skateMed / rootSpeed).toFixed(3) : null,
    footMinY: +footMinY.toFixed(3),
    hipsY: [+Math.min(...hy).toFixed(3), +Math.max(...hy).toFixed(3)],
    headY: [+headMinY.toFixed(3), +headMaxY.toFixed(3)],
    seamDeg: loop ? +seamDeg.toFixed(2) : null,           // last key vs first key as shipped (0 when the loop was closed)
    srcSeamDeg: loop ? +B.seamDeg.toFixed(2) : null,      // the FBX's own last-vs-first key
    closedFrames: Math.round(B.closeS * 30),
    hipsLiftM: +B.hipsLift.toFixed(3),
    keys: [B.keysIn, B.keysOut],                          // rotation keys over all bones: FBX -> shipped
    reduceMaxDeg: +reduceMaxDeg.toFixed(4),
  };
}

// ---------- RETARGET CHECK ----------
async function readShipped(name) {
  const d = await io.read(path.join(ROOT, "assets/chars/clips", name + ".glb"));
  const a = d.getRoot().listAnimations()[0];
  const m = new Map();
  for (const ch of a.listChannels()) {
    if (ch.getTargetPath() !== "rotation") continue;
    const s = ch.getSampler(); const acc = s.getOutput();
    let v = acc.getArray(); if (acc.getNormalized()) v = dequant(v);
    m.set(clean(ch.getTargetNode().getName()), { times: s.getInput().getArray(), values: Float32Array.from(v) });
  }
  return m;
}
async function retargetCheck() {
  const rows = [];
  for (const [ship, rel, gate] of CHECKS) {
    const shipped = await readShipped(ship);
    const B = await bake(ship + "__check", rel, { loop: false, tolDeg: 0 });
    // The shipped rifle clips were exported from Blender starting at frame 1, so their keys sit one 30 fps frame
    // LATER than the FBX keys (shipped t = FBX t + 1/30). Both alignments are scored; the better one is reported.
    const shEnd = Math.max(...[...shipped.values()].map((x) => x.times[x.times.length - 1]));
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    let best = null;
    for (const off of [0, 1 / 30]) {
      let sum = 0, cnt = 0, mx = 0, worst = "", perBoneMax = 0;
      for (const [nm, tr] of B.rot) {
        const sh = shipped.get(nm); if (!sh) continue;
        let bs = 0, bc = 0;
        for (let t = 0; t <= B.dur + 1e-9; t += 1 / 120) {
          if (t + off > shEnd + 1e-6) break;
          const e = angDeg(sampQ(tr, t, qa), sampQ(sh, t + off, qb));
          sum += e; cnt++; bs += e; bc++;
          if (e > mx) { mx = e; worst = nm + "@" + t.toFixed(3); }
        }
        perBoneMax = Math.max(perBoneMax, bs / bc);
      }
      if (!best || sum / cnt < best.sum / best.cnt) best = { off, sum, cnt, mx, worst, perBoneMax };
    }
    const { off, sum, cnt, mx, worst, perBoneMax } = best;
    const mean = sum / cnt;
    rows.push({ shipped: ship, fbx: rel, bones: B.rot.size, compared: [...B.rot.keys()].filter((n) => shipped.has(n)).length, shippedLagS: +off.toFixed(4), meanDeg: +mean.toFixed(4), worstBoneMeanDeg: +perBoneMax.toFixed(4), maxDeg: +mx.toFixed(3), worst, gate });
    console.log("RETARGET " + ship.padEnd(13) + " vs " + rel.padEnd(52) + " mean " + mean.toFixed(4) + " deg  worst-bone mean " + perBoneMax.toFixed(4) + "  max " + mx.toFixed(3) + " (" + worst + ")  shipped lag " + (off * 1000).toFixed(1) + " ms" + (gate ? "  [GATE <= " + MAX_RETARGET_DEG + "]" : ""));
  }
  return rows;
}

// ---------- main ----------
const check = await retargetCheck();
const g = check.find((r) => r.gate);
if (!(g.meanDeg <= MAX_RETARGET_DEG)) { console.error("ABORT: retarget error " + g.meanDeg + " deg > " + MAX_RETARGET_DEG + " vs rifle_idle"); process.exit(1); }
if (CHECK_ONLY) process.exit(0);
mkdirSync(OUT, { recursive: true });
const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
const clipsOut = prev && ONLY ? prev.clips : {};
for (const [clip, rel, kind, loop, group, extra] of CLIPS) {
  if (ONLY && !ONLY.has(clip)) continue;
  const B = await bake(clip, rel, { loop, tolDeg: TOL_DEG });
  const m = measure(B, loop);
  await B.doc.transform(dedup(), prune());
  const outPath = path.join(OUT, clip + ".glb");
  await io.write(outPath, B.doc);
  const row = Object.assign({ bytes: statSync(outPath).size, kind, group, loop, duration: +B.dur.toFixed(3),
    source: "Mixamo (Adobe) " + rel, licence: "Mixamo royalty-free for use in games; baked clip only" }, m, extra || {});
  clipsOut[clip] = row;
  console.log(clip.padEnd(20) + String(row.bytes).padStart(7) + " B  " + (loop ? "loop" : "once") + "  dur " + row.duration.toFixed(3) + "s keys " + row.keys.join("->") + " red " + row.reduceMaxDeg + " closed " + row.closedFrames +
    "  root " + row.rootSpeed + " m/s dir " + row.rootDirDeg + "  stride " + row.strideM + "  contact " + row.contactSpeed + "  skate " + row.skateRatio +
    "  footMinY " + row.footMinY + "  hipsY " + row.hipsY.join("..") + "  seam " + row.seamDeg);
}
const sum = (grp) => Object.values(clipsOut).filter((r) => !grp || r.group === grp).reduce((s, r) => s + r.bytes, 0);
const man = {
  about: "P1-F sidecar clip manifest (parity Wave P1). NOT read by the runtime; the live manifest.json is unchanged. Rig space: +Y up, character faces +Z, +X = character's left. " +
    "rootSpeed/strideM = the Mixamo root travel per loop on the game rig (m/s, m; the authored speed: P2-A play rate = ground speed / rootSpeed), rootDirDeg 0 = forward, 90 = character's left, 180 = back; " +
    "contactSpeed = planted-foot backwards speed when played in place (information: noisy, the 2.5 cm contact window includes heel roll); skateRatio = residual planted-foot slide with the root travel re-added / rootSpeed; footMinY = lowest toe/ankle joint Y (m) over the clip on the soldier rest skeleton. " +
    "gatedBy = owner decision that must be answered before P2/P3 wires the clip.",
  tool: "_tools/art_a_make_loco8.mjs",
  forP2: [
    "Not loaded by the runtime yet: wiring = add the names to player.js ALL_CLIPS (shared files, no per-skin fallback, like DEATH_CLIPS) plus exact-anchored classifyClips patterns.",
    "Hips: these clips carry the Mixamo hips height (feet on the ground; lowest vertex -0.10..+0.07 m on the soldier). The SHIPPED rifle_idle/walk/run/crouch carry a constant 1.0179 m hips, measured in the game page (probe_clips.py, soldier): lowest vertex +0.065 idle, +0.10..+0.18 walk, +0.01..+0.17 run, +0.21..+0.31 crouch-walk. Blending a shipped forward clip with a new strafe pops the body 0.1-0.3 m: re-bake the forward rifle set with this tool (same sources, see retargetCheck) before blending.",
    "pistol_strafe_*: the Mixamo pistol arms carry the gun at face height (owner rejected that carry, player.js gunFamily); use the lower-body tracks only under the procedural pistol pose.",
    "dbno_crawl: hips lifted by hipsLiftM (0.052 m) to a 0.21 m mean so player.js stripRootMotion's unit guard (mean < 0.2 m -> rescale to 0.99 m) does not throw it into the air; dbno_* and injured_idle wait for owner decision OD-3.",
    "jump_up/jump_loop/jump_down/fall_idle/land_hard keep their authored hips Y; stripRootMotion flattens Y only for the clip named exactly 'jump', so the engine-owned arc must flatten these too if wired as in-air states.",
  ],
  retargetCheck: check,
  budget: { rifleStrafeBytes: sum("rifle_strafe"), rifleStrafeLimit: 260000, totalBytes: sum(null), totalLimit: 700000 },
  clips: clipsOut,
};
writeFileSync(MANIFEST, JSON.stringify(man, null, 1));
console.log("rifle strafe set " + man.budget.rifleStrafeBytes + " B (limit " + man.budget.rifleStrafeLimit + ")  all clips " + man.budget.totalBytes + " B (limit " + man.budget.totalLimit + ")");
