// Retarget the shared combat clips onto EVERY body's actual rig.
//
// THE DEFECT, measured live (2026-07-27 audit): all nine anim_*.glb files are
// byte-identical across the 11 archetype dirs, but each Meshy auto-rig carries
// its own bind orientations. A quaternion track is an ABSOLUTE local rotation,
// so the same track on a different bind lands in a different world pose: at
// idle the murmillo floated his LEFT foot 25 cm off the sand, the secutor his
// RIGHT foot 36 cm, while the minotaur stood level by luck. Rest poses were
// clean on all 11 bodies (feet within 2.8 cm) — the drift is entirely
// clip-vs-bind mismatch, which is why it survived every skeleton audit.
//
// THE FIX: treat each clip GLB's own embedded skeleton as the authored ground
// truth, sample its WORLD pose per frame, and re-express that pose in each
// target rig's bind frame:
//
//     local_target(bone) = inverse(worldQ(parent_target)) * worldQ(source bone)
//
// applied parents-first so each solve sees the corrected parent. Hips also
// copies the source's translation track scaled by the rigs' hip-height ratio.
// Everything happens in glTF-native Y-up space inside three.js — no Blender
// axis conversion anywhere in the path (rebake_spine.py documents what a wrong
// axis quietly does).
//
// Run:  node games/colosseum/tools/retarget_clips.mjs [--dry-run]
// Needs: the _decomp/ dir of Draco-decompressed base.glb copies (the shipped
// bases are Draco-compressed and node has no decoder wired); build it with
// gltf-transform first — see build_decomp() invocation in main().

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// GLTFExporter's binary path merges chunks through FileReader, which node
// lacks; Blob it has. onloadend is the only callback the exporter wires.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((ab) => { this.result = ab; this.onloadend && this.onloadend(); });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((ab) => {
        this.result = "data:application/octet-stream;base64," + Buffer.from(ab).toString("base64");
        this.onloadend && this.onloadend();
      });
    }
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CHARS = resolve(HERE, "..", "assets", "chars");
const DECOMP = join(CHARS, "_decomp");
const DRY = process.argv.includes("--dry-run");
const FPS = 24;

const SHARED_CLIPS = [
  "anim_idle", "anim_walk", "anim_run", "anim_hit", "anim_death", "anim_parry",
  "anim_slash1", "anim_slash2", "anim_finisher", "anim_thrust", "anim_cleave",
].filter((c) => existsSync(join(CHARS, "_shared_clips", c + ".glb")));

const BODIES = readdirSync(CHARS).filter((d) =>
  !d.startsWith("_") && existsSync(join(CHARS, d, "base.glb")));

// eques/minotaur/scissor shipped with murmillo's walk/run verbatim (verified
// by hash) — those drift exactly like the shared nine and get the same fix.
const WALK_BORROWERS = ["eques", "minotaur", "scissor"];

const loader = new GLTFLoader();

/**
 * Drop images/textures/materials from a GLB's JSON chunk so GLTFLoader never
 * touches Image/canvas — node has neither, and the skeleton is all we need.
 * The BIN chunk is left as-is; orphaned image bufferViews are dead weight in a
 * temp file, not a correctness problem.
 */
function stripVisuals(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  delete json.images; delete json.textures; delete json.samplers;
  delete json.materials;
  for (const m of json.meshes || []) for (const p of m.primitives || []) delete p.material;
  for (const k of ["extensionsUsed", "extensionsRequired"])
    if (json[k]) json[k] = json[k].filter((e) => !/texture|material/i.test(e));
  let js = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const rest = buf.subarray(20 + jsonLen);            // BIN chunk(s), verbatim
  const out = Buffer.concat([buf.subarray(0, 12), Buffer.alloc(8), js, rest]);
  out.writeUInt32LE(out.length, 8);                   // total length
  out.writeUInt32LE(js.length, 12);                   // JSON chunk length
  out.writeUInt32LE(0x4e4f534a, 16);                  // 'JSON'
  return out;
}

function loadGLB(path, { strip = false } = {}) {
  let buf = readFileSync(path);
  if (strip) buf = stripVisuals(buf);
  return new Promise((res, rej) =>
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "", (g) => res(g), rej));
}

function build_decomp() {
  mkdirSync(DECOMP, { recursive: true });
  for (const b of BODIES) {
    const out = join(DECOMP, b + ".glb");
    if (existsSync(out)) continue;
    execFileSync("gltf-transform.cmd", ["copy", join(CHARS, b, "base.glb"), out],
      { stdio: "pipe" });
    console.log(`  decompressed ${b}`);
  }
}

/** name -> node map of a hierarchy. */
function byName(root) {
  const m = new Map();
  root.traverse((o) => { if (o.name && !m.has(o.name)) m.set(o.name, o); });
  return m;
}

/** DFS order (parents before children), bones only, present in both rigs. */
function boneOrder(targetRoot, srcMap) {
  const order = [];
  targetRoot.traverse((o) => { if (o.isBone && srcMap.has(o.name)) order.push(o); });
  return order;
}

const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

const _wp = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _rq = new THREE.Quaternion();

function worldPos(o, out) { o.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld); }

/** The two Foot nodes of a name->node map (either rig). */
function legs0(map) {
  return ["LeftFoot", "RightFoot"].map((n) => map.get(n)).filter(Boolean);
}

/** Rotate `bone` (in place, via its local quat) so the world vector from
 *  `from` to `mid` becomes the world vector from `from` to `want`. */
function aimBone(bone, from, mid, want) {
  _v1.copy(mid).sub(from).normalize();
  _v2.copy(want).sub(from).normalize();
  if (_v1.lengthSq() < 1e-10 || _v2.lengthSq() < 1e-10) return;
  _rq.setFromUnitVectors(_v1, _v2);
  bone.getWorldQuaternion(_q);
  _q.premultiply(_rq);                                  // desired world rotation
  bone.parent.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(_pq.multiply(_q));
  bone.updateWorldMatrix(false, false);
}

/**
 * Two-bone analytic IK: place the ankle of UpLeg->Leg->Foot at world point D,
 * preserving the knee's current bend plane. The copied joint ANGLES are the
 * authored truth for everything the pose says; this only restores the one
 * thing angles cannot carry across differing leg proportions — where the foot
 * ends up. Runs after the rotation copy, before keyframes are recorded.
 */
function legIK(upLeg, leg, foot, D) {
  const hip = worldPos(upLeg, new THREE.Vector3());
  const knee = worldPos(leg, new THREE.Vector3());
  const ankle = worldPos(foot, new THREE.Vector3());
  const L1 = hip.distanceTo(knee), L2 = knee.distanceTo(ankle);
  if (L1 < 1e-5 || L2 < 1e-5) return;

  // Clamp the target into reach WITHOUT giving up its height: Y is the
  // ground contract, so an over-reach slides the foot HORIZONTALLY toward
  // the hip (a diagonal clamp would lift the foot right back up — measured
  // 22-24 cm residuals doing exactly that).
  const reach = L1 + L2 - 1e-4;
  const dy = D.y - hip.y;
  if (Math.abs(dy) >= reach) D.y = hip.y + Math.sign(dy) * reach * 0.999;
  const horiz = Math.hypot(D.x - hip.x, D.z - hip.z);
  const maxHoriz = Math.sqrt(Math.max(0, reach * reach - (D.y - hip.y) * (D.y - hip.y)));
  if (horiz > maxHoriz) {
    const k = horiz > 1e-6 ? maxHoriz / horiz : 0;
    D.x = hip.x + (D.x - hip.x) * k;
    D.z = hip.z + (D.z - hip.z) * k;
  }
  const toD = new THREE.Vector3().copy(D).sub(hip);
  const d = Math.max(Math.abs(L1 - L2) + 1e-4, toD.length());
  const dir = toD.clone().normalize();
  const target = hip.clone().addScaledVector(dir, d);

  // Bend-plane normal from the CURRENT (copied) pose so the knee keeps
  // pointing the way the animator pointed it.
  const n = new THREE.Vector3().copy(knee).sub(hip)
    .cross(new THREE.Vector3().copy(ankle).sub(hip));
  if (n.lengthSq() < 1e-8) {                            // straight leg: derive
    upLeg.getWorldQuaternion(_q);
    n.set(1, 0, 0).applyQuaternion(_q).cross(dir);
    if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
  }
  n.normalize();

  // Hip interior angle, law of cosines; new knee = dir swung by phi about the
  // bend normal.
  const cosPhi = Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const newKnee = dir.clone()
    .applyQuaternion(_rq.setFromAxisAngle(n, Math.acos(cosPhi)))
    .multiplyScalar(L1).add(hip);

  const footWorldQ = foot.getWorldQuaternion(new THREE.Quaternion());   // keep the copied foot aim
  aimBone(upLeg, hip, knee, newKnee);
  const knee2 = worldPos(leg, new THREE.Vector3());
  const ankle2 = worldPos(foot, new THREE.Vector3());
  aimBone(leg, knee2, ankle2, target);
  // Restore the foot's world orientation under the adjusted knee.
  foot.parent.getWorldQuaternion(_pq).invert();
  foot.quaternion.copy(_pq.multiply(footWorldQ));
  foot.updateWorldMatrix(false, false);
}

async function retargetOne(srcPath, targetScene, targetName) {
  const src = await loadGLB(srcPath);
  const clip = src.animations && src.animations[0];
  if (!clip) throw new Error("no animation in " + srcPath);
  const srcRoot = src.scene;
  const srcMap = byName(srcRoot);

  const tgtMap = byName(targetScene);
  const hipsT = tgtMap.get("Hips"), hipsS = srcMap.get("Hips");
  if (!hipsT || !hipsS) throw new Error("no Hips in rig pair");

  // Rest snapshot of the target so it can be restored for export.
  const rest = [];
  targetScene.traverse((o) => rest.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));

  // Hip-height ratio maps the source's root motion onto the target's legs.
  targetScene.updateMatrixWorld(true);
  srcRoot.updateMatrixWorld(true);
  const hipsRatio = Math.abs(new THREE.Vector3().setFromMatrixPosition(hipsT.matrixWorld).y) /
    Math.max(1e-6, Math.abs(new THREE.Vector3().setFromMatrixPosition(hipsS.matrixWorld).y));

  const order = boneOrder(targetScene, srcMap);

  // WHAT GETS PRESERVED vs CORRECTED — the result of three measured attempts:
  //   1. Absolute world-rotation copy = an identity op (world rotations
  //      compose from locals; binds never enter node math) — drift unchanged.
  //   2. Delta-from-bind copy = wrong reference: an armature-only clip GLB's
  //      default node pose is a POSED frame, not the T-pose bind, so the
  //      deltas collapsed toward identity and every body froze near T-pose.
  //   3. THIS: keep the source's local rotations verbatim — the exact pose
  //      style the game has always shipped — and let leg IK correct the one
  //      thing that is measurably wrong AND objectively defined: foot HEIGHT.
  //      The lateral stance stays as posed; Y comes from the source's own
  //      ground-relative ankle height, so a foot the animator planted stays
  //      planted on every body and a deliberate step-up survives.
  const tgtBindHips = hipsT.getWorldPosition(new THREE.Vector3());
  const srcBindHips = hipsS.getWorldPosition(new THREE.Vector3());

  // Target rest ankle heights = each rig's standing contact level.
  const tgtRestAnkleY = new Map(legs0(tgtMap).map((f) => [f.name, worldPos(f, new THREE.Vector3()).y]));

  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(clip).play();

  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = new Float32Array(n);
  const quats = new Map(order.map((b) => [b.name, new Float32Array(n * 4)]));
  const hipPos = new Float32Array(n * 3);

  // Pre-scan: the source's contact floor = the lowest ankle over the whole
  // cycle. Heights above it are the animator's intent (a step, a kick).
  let srcFloorY = Infinity;
  for (let i = 0; i < n; i++) {
    mixer.setTime(Math.min(clip.duration, i / FPS));
    srcRoot.updateMatrixWorld(true);
    for (const f of legs0(srcMap)) srcFloorY = Math.min(srcFloorY, worldPos(f, _wp).y);
  }

  const legs = [];
  for (const side of ["Left", "Right"]) {
    const upLeg = tgtMap.get(side + "UpLeg"), leg = tgtMap.get(side + "Leg"), foot = tgtMap.get(side + "Foot");
    const sFoot = srcMap.get(side + "Foot"), sUpLeg = srcMap.get(side + "UpLeg");
    if (upLeg && leg && foot && sFoot && sUpLeg) legs.push({ upLeg, leg, foot, sFoot, sUpLeg });
  }

  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i / FPS);
    times[i] = t;
    mixer.setTime(t);
    srcRoot.updateMatrixWorld(true);
    for (const b of order) {
      // Verbatim local rotations — the authored style, exactly as shipped.
      b.quaternion.copy(srcMap.get(b.name).quaternion);
      b.updateWorldMatrix(false, false);
    }

    // FOOT IK — the actual fix. Rotation copy alone is an identity operation
    // between same-named hierarchies (world rotations compose from locals
    // only; binds never enter node math — measured: feet drift unchanged).
    // What differs per body is PROPORTION, so the same joint angles put a
    // murmillo foot 25 cm up. Each foot is re-planted at the source's stance
    // point, expressed RELATIVE TO THE PELVIS — scaling about the origin put
    // the target 20-26 cm outside leg reach on rigs whose hips don't sit at
    // the origin-scaled spot, and the clamp quietly kept the drift.
    // Hips position is bind-relative too: target bind spot + the source's
    // world-space excursion from ITS bind, scaled.
    const srcHipW = hipsS.getWorldPosition(new THREE.Vector3());
    const tgtHipW = srcHipW.clone().sub(srcBindHips).multiplyScalar(hipsRatio).add(tgtBindHips);
    // The solve mimics the runtime: hips FOLLOW the exported position track.
    if (hipsT.parent) {
      const lp = tgtHipW.clone();
      hipsT.parent.updateWorldMatrix(true, false);
      hipsT.parent.worldToLocal(lp);
      hipsT.position.copy(lp);
      hipsT.updateWorldMatrix(false, false);
    }
    // PELVIS LEVELING — the root cause, finally measured: with verbatim
    // locals, this rig's hips world rotation TILTS the pelvis, lifting one
    // hip socket 15-20 cm. The legs hang correctly from tilted sockets, so
    // no foot-level fix can reach the floor (|hip->ground| exceeds leg
    // length; the clamp pinned the foot at full extension at exactly the
    // observed 0.357). Rotate the hips so the socket-to-socket line matches
    // the source's, and counter-rotate the spine root so the torso keeps
    // its authored world pose.
    if (legs.length === 2) {                          // legs[0]=Left, [1]=Right
      const srcLine = legs[1].sUpLeg.getWorldPosition(new THREE.Vector3())
        .sub(legs[0].sUpLeg.getWorldPosition(new THREE.Vector3())).normalize();
      const tgtLine = worldPos(legs[1].upLeg, new THREE.Vector3())
        .sub(worldPos(legs[0].upLeg, new THREE.Vector3())).normalize();
      if (srcLine.lengthSq() > 0.5 && tgtLine.lengthSq() > 0.5) {
        const spine = hipsT.children.find((c) => c.isBone && c !== legs[0].upLeg && c !== legs[1].upLeg);
        const spineW = spine ? spine.getWorldQuaternion(new THREE.Quaternion()) : null;
        const fix = new THREE.Quaternion().setFromUnitVectors(tgtLine, srcLine);
        hipsT.getWorldQuaternion(_q).premultiply(fix);
        if (hipsT.parent) hipsT.parent.getWorldQuaternion(_pq).invert();
        else _pq.identity();
        hipsT.quaternion.copy(_pq.clone().multiply(_q));
        hipsT.updateWorldMatrix(false, false);
        if (spine && spineW) {                       // torso keeps its pose
          spine.parent.getWorldQuaternion(_pq).invert();
          spine.quaternion.copy(_pq.multiply(spineW));
          spine.updateWorldMatrix(false, false);
        }
      }
    }

    for (const { upLeg, leg, foot, sFoot } of legs) {
      // HEIGHT-ONLY target: this body's posed ankle keeps its X/Z (the
      // stance the locals give it) and takes its Y from the source's
      // ground-relative ankle height — planted feet stay planted on every
      // body, deliberate lifts survive, and lateral style is untouched.
      const D = worldPos(foot, new THREE.Vector3());
      const srcRelY = sFoot.getWorldPosition(_wp).y - srcFloorY;
      D.y = tgtRestAnkleY.get(foot.name) + srcRelY * hipsRatio;
      legIK(upLeg, leg, foot, D);
      if (process.env.RT_DEBUG) {
        const got = worldPos(foot, new THREE.Vector3());
        const err = got.distanceTo(D);
        if (err > (retargetOne._worstErr || 0)) { retargetOne._worstErr = err; retargetOne._worstAt = `${foot.name}@f${i}`; }
      }
    }

    for (const b of order) {
      const arr = quats.get(b.name);
      const q = b.quaternion;
      arr[i * 4] = q.x; arr[i * 4 + 1] = q.y; arr[i * 4 + 2] = q.z; arr[i * 4 + 3] = q.w;
    }
    // The exported hips track is exactly what the solve just used, expressed
    // in the parent's local space (roots may carry different scales).
    const wp = tgtHipW.clone();
    if (hipsT.parent) { hipsT.parent.updateWorldMatrix(true, false); hipsT.parent.worldToLocal(wp); }
    hipPos[i * 3] = wp.x; hipPos[i * 3 + 1] = wp.y; hipPos[i * 3 + 2] = wp.z;
  }

  const tracks = [];
  for (const [name, arr] of quats) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, arr));
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", times, hipPos));
  const outClip = new THREE.AnimationClip(clip.name || targetName, times[n - 1], tracks);

  if (process.env.RT_DEBUG) {
    // Round-trip check IN PROCESS: play the freshly built tracks through a
    // mixer on this same rig and measure the feet gap — separates "tracks
    // wrong" from "export wrong" without leaving node.
    const vm = new THREE.AnimationMixer(targetScene);
    vm.clipAction(outClip).play();
    const lf = tgtMap.get("LeftFoot"), rf = tgtMap.get("RightFoot");
    let worst = 0;
    for (let i = 0; i < n; i++) {
      vm.setTime(times[i]);
      targetScene.updateMatrixWorld(true);
      worst = Math.max(worst, Math.abs(worldPos(lf, _v1).y - worldPos(rf, _v2).y));
    }
    vm.stopAllAction(); vm.uncacheRoot(targetScene);
    retargetOne._trackFeetDy = worst;
  }

  // Restore the rest pose, then export the ARMATURE ONLY (top ancestor of
  // Hips inside the scene) with exactly one animation — the same shape as the
  // existing clip files, so loadFighter's animations[0] contract holds.
  for (const r of rest) { r.o.position.copy(r.p); r.o.quaternion.copy(r.q); r.o.scale.copy(r.s); }
  targetScene.updateMatrixWorld(true);
  let top = hipsT;
  while (top.parent && top.parent !== targetScene) top = top.parent;

  const exporter = new GLTFExporter();
  const glb = await new Promise((res, rej) =>
    exporter.parse(top, res, rej, { binary: true, animations: [outClip] }));
  return Buffer.from(glb);
}

async function main() {
  console.log("=== CLIP RETARGET ===");
  build_decomp();
  // The clip's own skeleton is the ground truth — report ITS idle feet gap so
  // the live re-audit has an acceptance number to compare against.
  for (const body of BODIES) {
    const tgt = await loadGLB(join(DECOMP, body + ".glb"), { strip: true });
    // SOURCE = _shared_clips — the ORIGINAL files whose embedded skeleton is
    // the authoring rig. The per-dir copies are retarget OUTPUT (their
    // skeletons are each body's own), so using them as source would measure
    // the drifted pose as truth and solve a no-op.
    const jobs = [...SHARED_CLIPS.map((c) => [join(CHARS, "_shared_clips", c + ".glb"), c])];
    if (WALK_BORROWERS.includes(body))
      jobs.push([join(CHARS, "murmillo", "walk_arm.glb"), "walk_arm"],
        [join(CHARS, "murmillo", "run_arm.glb"), "run_arm"]);
    for (const [srcPath, name] of jobs) {
      if (!existsSync(srcPath)) continue;
      try {
        retargetOne._worstErr = 0; retargetOne._worstAt = "";
        const glb = await retargetOne(srcPath, tgt.scene, name);
        const out = join(CHARS, body, name + ".glb");
        if (!DRY) writeFileSync(out, glb);
        const dbg = process.env.RT_DEBUG ? `  ikErr ${(retargetOne._worstErr * 100).toFixed(1)}cm ${retargetOne._worstAt}  trackFeetDy ${(retargetOne._trackFeetDy ?? -1).toFixed(3)}` : "";
        console.log(`  ${body}/${name}.glb ${(glb.length / 1024).toFixed(0)} KB${DRY ? " (dry)" : ""}${dbg}`);
      } catch (e) {
        console.log(`  ${body}/${name} FAILED: ${e.message}`);
        process.exitCode = 1;
      }
    }
  }
  console.log("RETARGET_DONE");
}

main().catch((e) => { console.error(e); process.exit(1); });
