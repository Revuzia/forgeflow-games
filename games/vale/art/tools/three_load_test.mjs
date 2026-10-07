#!/usr/bin/env node
// VALE art: load a fighter GLB with three.js r186 GLTFLoader in plain Node and check that it
// will work in the client (CONTRACT §9 characters, §12 rig/clips).
//
//   node art/tools/three_load_test.mjs art/out/_proof/_proof_mannequin.glb [--skin-only] [--budget-kb 1172]
//
// Checks: parses; SkinnedMesh(es) bound to one skeleton with every VALE_BIPED_1 bone; inverse
// bind matrices invertible; skin indices in range and weights normalised; required clips present;
// EVERY track of EVERY clip resolves to a node in the scene (PropertyBinding) and to a bone of
// the skeleton; an AnimationMixer actually moves bones; SkeletonUtils.clone() gives an
// independent copy that binds the same clips; the `accent` material is emissive.
// Texture decoding is stubbed (no DOM in Node): a GLTFLoader plugin returns placeholder textures
// sized from the GLB's image headers, so material wiring is still exercised.
//
// NOTE for the RENDER lane: three sanitises node names (PropertyBinding.sanitizeNodeName strips
// '.', so Blender's `prop.R` is `propR` in three). Look sockets up with
// THREE.PropertyBinding.sanitizeNodeName(name).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { readFileSync } from 'node:fs';

const STANDARD = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'toe.L', 'thigh.R', 'shin.R',
  'foot.R', 'toe.R', 'prop.R', 'prop.L'];
const REQUIRED = ['idle', 'run', 'attack1', 'attack2', 'cast_a1', 'cast_a2', 'cast_a3', 'cast_ult', 'death', 'recall',
  'idle_lobby', 'victory'];

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--budget-kb');
const skinOnly = args.includes('--skin-only');
if (!file) {
  console.error('usage: node art/tools/three_load_test.mjs file.glb [--skin-only]');
  process.exit(2);
}

const errors = [];
const fail = (m) => errors.push(m);

// GLB JSON for image sizes
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const jlen = buf.readUInt32LE(12);
const gltfJson = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
const bin = buf.subarray(20 + jlen + 8);
function imgBytes(i) {
  const img = gltfJson.images?.[i];
  if (!img || img.bufferView === undefined) return null;
  const bv = gltfJson.bufferViews[img.bufferView];
  return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
}
function webpSize(b) {
  // RIFF....WEBP + VP8 (lossy) | VP8L (lossless) | VP8X (extended)
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (fourcc === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (fourcc === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  return null;
}
function imgSize(i) {
  const b = imgBytes(i);
  if (!b) return [1, 1];
  const w = webpSize(b);
  if (w) return w;
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let k = 2; k < b.length - 9;) {
    if (b[k] !== 0xff) { k++; continue; }
    const m = b[k + 1];
    const len = b.readUInt16BE(k + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(k + 7), b.readUInt16BE(k + 5)];
    k += 2 + len;
  }
  return [1, 1];
}

class StubTextures {
  // registered under the texture-extension names too, so it REPLACES GLTFLoader's built-in
  // EXT_texture_webp / EXT_texture_avif / KHR_texture_basisu handlers (no image decoders in Node;
  // three_snapshot.mjs decodes the real WebP in Chromium)
  constructor(parser, name = 'vale_stub_textures') { this.parser = parser; this.name = name; }
  loadTexture(index) {
    const def = this.parser.json.textures[index];
    const ext = def.extensions ?? {};
    const srcIdx = ext.EXT_texture_webp?.source ?? ext.EXT_texture_avif?.source ?? ext.KHR_texture_basisu?.source ?? def.source;
    const [w, h] = imgSize(srcIdx);
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    tex.userData.sourceSize = [w, h];
    tex.name = gltfJson.images?.[srcIdx]?.name ?? `tex${index}`;
    tex.userData.mimeType = gltfJson.images?.[srcIdx]?.mimeType;
    tex.flipY = false;
    tex.needsUpdate = true;
    return Promise.resolve(tex);
  }
}

const loader = new GLTFLoader();
for (const n of ['EXT_texture_webp', 'EXT_texture_avif', 'KHR_texture_basisu', 'vale_stub_textures']) {
  loader.register((parser) => new StubTextures(parser, n));
}
// EXT_texture_webp: declared, and every image it points at really is a WebP with sane dimensions
const extUsed = gltfJson.extensionsUsed ?? [];
const webpInfo = [];
if (extUsed.includes('EXT_texture_webp')) {
  for (const t of gltfJson.textures ?? []) {
    const si = t.extensions?.EXT_texture_webp?.source;
    if (si === undefined) { errors.push(`texture ${t.name ?? ''} lacks EXT_texture_webp.source`); continue; }
    const im = gltfJson.images[si];
    const wh = webpSize(imgBytes(si) ?? Buffer.alloc(0));
    if (im.mimeType !== 'image/webp' || !wh) errors.push(`image ${im.name}: not a valid WebP (${im.mimeType})`);
    else webpInfo.push(`${im.name} ${wh.join('x')} ${(imgBytes(si).length / 1024).toFixed(0)}K`);
  }
}
const budgetKb = args.includes('--budget-kb') ? Number(args[args.indexOf('--budget-kb') + 1]) : null;
if (budgetKb && buf.length > budgetKb * 1024) errors.push(`GLB is ${(buf.length / 1024).toFixed(0)} KiB > budget ${budgetKb} KiB`);
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
const root = gltf.scene;
root.updateMatrixWorld(true);
// bind-pose measurements (before any mixer touches the scene)
const sanN = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const bone = (o, n) => o.getObjectByName(sanN(n));
const bindBox = new THREE.Box3().setFromObject(root);
const bindSize = bindBox.getSize(new THREE.Vector3());
const toeMid = wpos(bone(root, 'toe.L')).add(wpos(bone(root, 'toe.R'))).multiplyScalar(0.5);
const ankMid = wpos(bone(root, 'foot.L')).add(wpos(bone(root, 'foot.R'))).multiplyScalar(0.5);
const fwd = toeMid.clone().sub(ankMid).setY(0).normalize();
const headY = wpos(bone(root, 'head')).y;
const rootAt = wpos(bone(root, 'root')).length();

// skinned meshes + skeleton
const skinned = [];
root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
if (!skinned.length) fail('no SkinnedMesh in scene');
const san = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
let boneNames = new Set();
for (const m of skinned) {
  const sk = m.skeleton;
  if (!sk) { fail(`${m.name}: no skeleton`); continue; }
  boneNames = new Set(sk.bones.map((b) => b.name));
  for (const b of STANDARD) if (!boneNames.has(san(b))) fail(`${m.name}: skeleton lacks bone ${b} (three name ${san(b)})`);
  if (sk.boneInverses.length !== sk.bones.length) fail(`${m.name}: ${sk.boneInverses.length} inverses for ${sk.bones.length} bones`);
  for (const inv of sk.boneInverses) if (Math.abs(inv.determinant()) < 1e-8) fail(`${m.name}: singular inverse bind matrix`);
  const si = m.geometry.getAttribute('skinIndex');
  const sw = m.geometry.getAttribute('skinWeight');
  if (!si || !sw) { fail(`${m.name}: missing skinIndex/skinWeight`); continue; }
  let badW = 0, badI = 0;
  for (let v = 0; v < sw.count; v++) {
    const s = sw.getX(v) + sw.getY(v) + sw.getZ(v) + sw.getW(v);
    if (Math.abs(s - 1) > 0.02) badW++;
    for (const c of [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)]) if (c >= sk.bones.length) badI++;
  }
  if (badW) fail(`${m.name}: ${badW} vertices with weights not summing to 1`);
  if (badI) fail(`${m.name}: ${badI} skin indices out of range`);
}
const skeletons = new Set(skinned.map((m) => m.skeleton?.bones.map((b) => b.uuid).join()));
if (skeletons.size > 1) fail(`skinned meshes use ${skeletons.size} different skeletons (expected one shared rig)`);

// materials
const mats = new Map();
root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) mats.set(m.name, m); });
const accent = mats.get('accent');
if (!accent) fail("no 'accent' material");
else if (accent.emissive.r + accent.emissive.g + accent.emissive.b <= 0) fail("'accent' material has no emissive colour");
const texInfo = [];
for (const m of mats.values()) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
  if (m[k]) texInfo.push(`${m.name}.${k}=${m[k].userData.sourceSize?.join('x')}`);
}

// clips: every track must resolve to a node and to a skeleton bone
const clipNames = gltf.animations.map((c) => c.name);
if (!skinOnly) for (const r of REQUIRED) if (!clipNames.includes(r)) fail(`missing clip ${r}`);
let tracks = 0;
for (const clip of gltf.animations) {
  for (const t of clip.tracks) {
    tracks++;
    const p = THREE.PropertyBinding.parseTrackName(t.name);
    const node = THREE.PropertyBinding.findNode(root, p.nodeName);
    if (!node) fail(`${clip.name}: track ${t.name} targets missing node ${p.nodeName}`);
    else if (!node.isBone) fail(`${clip.name}: track ${t.name} targets non-bone ${p.nodeName}`);
    else if (!boneNames.has(node.name)) fail(`${clip.name}: track ${t.name} bone not in skeleton`);
    if (!t.validate()) fail(`${clip.name}: track ${t.name} failed validate()`);
  }
}

// mixer actually moves bones; clone binds independently
function poseSignature(obj) {
  let s = 0;
  obj.traverse((o) => { if (o.isBone) { s += o.quaternion.x * 3 + o.quaternion.y * 5 + o.quaternion.z * 7 + o.position.y; } });
  return s;
}
if (gltf.animations.length) {
  const mixer = new THREE.AnimationMixer(root);
  const before = poseSignature(root);
  const clip = THREE.AnimationClip.findByName(gltf.animations, 'attack1') ?? gltf.animations[0];
  mixer.clipAction(clip).play();
  mixer.update(clip.duration * 0.4);
  const after = poseSignature(root);
  if (Math.abs(after - before) < 1e-6) fail(`AnimationMixer: ${clip.name} at 40% did not move any bone`);
  const clone = SkeletonUtils.clone(root);
  const cm = [];
  clone.traverse((o) => { if (o.isSkinnedMesh) cm.push(o); });
  if (cm.length !== skinned.length) fail('SkeletonUtils.clone lost skinned meshes');
  if (cm.length && skinned.length && cm[0].skeleton.bones[0] === skinned[0].skeleton.bones[0]) fail('clone shares bones with the source');
  const m2 = new THREE.AnimationMixer(clone);
  for (const c of gltf.animations) {
    const a = m2.clipAction(c);
    a.play();
    m2.update(c.duration * 0.5);
    a.stop();
  }
}

// ── contract checks in three's own space ──────────────────────────────────────────────────────
// +Z forward (CONTRACT §2): toes ahead of the ankles in the bind pose
if (fwd.z < 0.95) fail(`model faces (${fwd.x.toFixed(2)}, ${fwd.z.toFixed(2)}) in three, not +Z`);
if (rootAt > 1e-3) fail('root bone is not at the origin');
if (bindBox.min.y < -0.02) fail(`mesh reaches ${bindBox.min.y.toFixed(3)} m below the ground in the bind pose`);
// colour spaces: base colour sRGB, every data map linear (GLTFLoader decides by slot)
for (const m of mats.values()) {
  if (m.map && m.map.colorSpace !== THREE.SRGBColorSpace) fail(`${m.name}.map colorSpace ${m.map.colorSpace} (want srgb)`);
  for (const k of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'])
    if (m[k] && m[k].colorSpace === THREE.SRGBColorSpace) fail(`${m.name}.${k} is sRGB (data maps must be linear)`);
  if (m.name === 'accent' && (m.map || m.emissiveMap)) fail('accent must be factor-only (the renderer tints it)');
}
// clips in three: loops close, durations sane, the run's planted foot moves at runRefSpeed
const extras = (() => { let e = {}; root.traverse((o) => { if (o.userData?.vale_run_ref_speed) e = o.userData; }); return e; })();
const runRef = extras.vale_run_ref_speed;
const LOOP = ['idle', 'run', 'recall', 'idle_lobby', 'channel', 'stunned'];
const clipStats = {};
if (!skinOnly && gltf.animations.length) {
  const probe = SkeletonUtils.clone(root);
  const pose = (o) => { const a = []; o.traverse((b) => { if (b.isBone) a.push(b.quaternion.clone(), b.position.clone()); }); return a; };
  for (const clip of gltf.animations) {
    const mx = new THREE.AnimationMixer(probe);
    const act = mx.clipAction(clip);
    act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
    mx.setTime(0); probe.updateMatrixWorld(true); const p0 = pose(probe);
    mx.setTime(clip.duration); probe.updateMatrixWorld(true); const p1 = pose(probe);
    let seam = 0;
    for (let i = 0; i < p0.length; i++) seam = Math.max(seam, p0[i].isQuaternion ? 1 - Math.abs(p0[i].dot(p1[i])) : p0[i].distanceTo(p1[i]));
    if (clip.duration < 0.2 || clip.duration > 6) fail(`${clip.name}: duration ${clip.duration.toFixed(2)} s out of range`);
    if (LOOP.includes(clip.name) && seam > 1e-4) fail(`${clip.name}: loop seam ${seam.toExponential(2)} (first != last pose)`);
    const st = { duration: +clip.duration.toFixed(3), frames: Math.round(clip.duration * 30) };
    if (/^(attack|cast|crit)/.test(clip.name) && st.frames % 5) fail(`${clip.name}: ${st.frames} frames (impact at 40 % needs a multiple of 5)`);
    if (clip.name === 'run' && runRef) {
      // planted foot: the lowest foot moves backward (-Z) at runRefSpeed while it is down
      const n = st.frames, dt = clip.duration / n, track = { L: [], R: [] }, toes = { L: [], R: [] };
      for (let f = 0; f <= n; f++) {
        act.reset(); act.play(); mx.setTime(f * dt); probe.updateMatrixWorld(true);   // reset: un-clamp
        for (const s of ['L', 'R']) { track[s].push(wpos(bone(probe, `foot.${s}`))); toes[s].push(wpos(bone(probe, `toe.${s}`))); }
      }
      const errs = [];
      for (const s of ['L', 'R']) {
        // planted = ball on the ground and the ankle level (heel-strike / toe-off roll excluded)
        const toeLo = Math.min(...toes[s].map((p) => p.y));
        const cand = toes[s].map((p) => p.y < toeLo + 0.04);     // stance: the ball within 4 cm of its lowest (swing clears >= 7 cm; a heel-strike dip is tolerated)
        const ankLo = Math.min(...track[s].filter((_, f) => cand[f]).map((p) => p.y));
        const planted = track[s].map((p, f) => cand[f] && Math.abs(p.y - ankLo) < 0.025);
        if (process.env.VALE_RUN_DEBUG) console.log(s, track[s].map((p, f) => `${f}:${p.y.toFixed(3)}/${toes[s][f].y.toFixed(3)}/${p.z.toFixed(3)}${planted[f] ? '*' : ''}`).join(' '));
        const lvl = track[s].map((p) => p.y);
        // central difference over 3 planted frames; light fighters (short contact, ~2 flat frames at
        // 30 fps) fall back to a forward difference over 2 consecutive level planted frames
        let central = 0;
        for (let f = 1; f < n; f++) {
          if (planted[f - 1] && planted[f] && planted[f + 1] && Math.abs(lvl[f + 1] - lvl[f - 1]) < 0.004) {
            const v = -(track[s][f + 1].z - track[s][f - 1].z) / (2 * dt);
            errs.push(Math.abs(v - runRef) / runRef);
            central++;
          }
        }
        if (!central) {
          for (let f = 0; f < n; f++) {
            if (planted[f] && planted[f + 1] && Math.abs(lvl[f + 1] - lvl[f]) < 0.003) {
              const v = -(track[s][f + 1].z - track[s][f].z) / dt;
              errs.push(Math.abs(v - runRef) / runRef);
            }
          }
        }
      }
      st.plantedSamples = errs.length;
      st.footSlidePct = errs.length ? +(100 * Math.max(...errs)).toFixed(1) : null;
      if (!errs.length) fail('run: no planted-foot frames found');
      else if (Math.max(...errs) > 0.08) fail(`run: planted foot speed off runRefSpeed by ${st.footSlidePct}% (foot slide)`);
    }
    clipStats[clip.name] = st;
    act.stop(); mx.uncacheRoot(probe);
  }
}

const size = bindSize;
let tris = 0;
root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });
console.log(`[three] ${file} (${(buf.length / 1024).toFixed(0)} KiB; extensions: ${extUsed.join(', ') || '-'})`);
if (webpInfo.length) console.log(`  webp: ${webpInfo.join(', ')}`);
console.log(`  skinned meshes: ${skinned.map((m) => `${m.name}(${m.geometry.getAttribute('position').count}v)`).join(', ')}`);
console.log(`  bones: ${boneNames.size} (${[...boneNames].join(' ')})`);
console.log(`  clips: ${gltf.animations.map((c) => `${c.name}:${c.duration.toFixed(3)}s/${c.tracks.length}tr`).join(', ')}`);
console.log(`  tracks checked: ${tracks}; materials: ${[...mats.keys()].join(', ')}; textures: ${texInfo.join(', ')}`);
console.log(`  tris: ${tris}; bind-pose bounds (three units, Y up): ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}; ` +
  `facing (${fwd.x.toFixed(2)}, ${fwd.z.toFixed(2)}); head bone y ${headY.toFixed(2)}; runRefSpeed ${runRef ?? '-'}`);
if (clipStats.run) console.log(`  run: ${clipStats.run.frames} f, planted samples ${clipStats.run.plantedSamples}, max foot-speed error ${clipStats.run.footSlidePct}%`);
// FighterArt.height (art.json next to the GLB) should match the model's top (health bar placement)
try {
  const artPath = file.replace(/[^/\\]+\.glb$/, 'art.json');
  const art = JSON.parse(readFileSync(artPath, 'utf8'));
  if (!skinOnly && Math.abs(art.height - size.y) > 0.06) fail(`art.json height ${art.height} vs model top ${size.y.toFixed(2)} m`);
} catch { /* no art.json (units, maps) */ }
if (errors.length) {
  console.log(`[three] FAIL (${errors.length})`);
  for (const e of errors.slice(0, 40)) console.log('  - ' + e);
  process.exit(1);
}
console.log('[three] OK: skeleton binds, every clip track targets an existing bone, mixer + clone work');
