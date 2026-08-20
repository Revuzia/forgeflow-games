// core/chars/actor.js [A8] — Meshy Actor (architecture §3.15; doctrine §1 IN
// FULL). Ports the colosseum Actor discipline + last-circle's rig calibration.
// Every non-obvious line exists because of a specific, already-paid-for visual
// failure — the comments name them so nobody "simplifies" back into the bug.
//
// Doctrine §1 checklist implemented here:
//   - material repair at load (metalness 0, roughness .78, emissive black+map
//     null, specular 1.0) — the exporter's materials are wrong EVERY time
//   - TRS snapshot BEFORE any mixer touches a bone (the only trustworthy pose)
//   - strip .scale tracks and (Shoulder|Arm|Hand).position tracks from clips
//   - frustumCulled = false on skinned meshes (bind-pose bounds lie)
//   - strip GLB-embedded lights (light count is a shader-permutation key)
//   - NEVER the bind pose: idle plays + settles inside the constructor
// Plus LD §5.4's wet-shoulder override ON TOP of the repair (shoulders/head
// roughness pulled to ~0.35 via one shared shader variant — a single
// customProgramCacheKey so all soldier materials compile ONE extra program,
// prewarmed by soldiers.ready() before the mission starts).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { CLIP_FILES, ANIMS } from "./anim_map.js";

// ---------------------------------------------------------------------------
// Loader (Draco decoder is vendored — a CDN outage must never take the
// characters down; js decoder: no wasm MIME/CORS surprises. Colosseum lesson.)
// ---------------------------------------------------------------------------
// Asset URLs resolve against THIS MODULE, not the page — the game root is two
// levels up from core/chars/. Page-relative paths break the moment any harness
// page outside the root imports these modules (measured: a _shots/ dev page
// 404'd every body).
const GAME_ROOT = new URL("../../", import.meta.url);

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath(new URL("assets/vendor/draco/", GAME_ROOT).href);
draco.setDecoderConfig({ type: "js" });
loader.setDRACOLoader(draco);

const CACHE = new Map(); // url -> Promise<gltf>
/** Cached GLB load — shared with soldiers.js (one Draco decoder for the lane).
 *  Game-root-relative paths ("assets/chars/x.glb") resolve via GAME_ROOT. */
export function loadGLB(url) {
  const abs = new URL(url, GAME_ROOT).href;
  if (!CACHE.has(abs)) {
    CACHE.set(abs, new Promise((res, rej) => loader.load(abs, res, undefined, rej)));
  }
  return CACHE.get(abs);
}
const load = loadGLB;

// Body name -> GLB path (content.json archetypes carry bodyGlb; these are the
// R15 repack filenames — flagged to A2 as the frozen pair).
const BODY_GLB = {
  soldier: "assets/chars/soldier.glb",
  juggernaut: "assets/chars/juggernaut.glb",
};

// ---------------------------------------------------------------------------
// TWO-HAND WEAPON HOLD (iter06 — ranked fix 7, unactioned x3)
// ---------------------------------------------------------------------------
// This USED to be a pair of hand-bone-local Euler constants ported from
// last-circle (HAND_GRIP_ROT). The port's premise — "a holder rigidly attached
// to the hand keeps its grip correct in every pose" — is true for the FIRING
// hand and false for everything else, and the constants were never re-solved
// against THIS clip set. Measured live this session on the S9 pose: the bore
// came out 28.8 deg off the firing-fist -> support-fist line and tilted UP,
// which is exactly the critics' "the muzzle points up across his own face",
// and it left the support hand 14.3 cm BELOW the handguard holding nothing —
// "splayed open in mid-air", flagged by 3/3 critics for three iterations.
//
// A constant cannot fix that, because the two hands move relative to each
// other between clips. So the basis is SOLVED, every frame, from the rig
// itself: the bore is the ray from the grip holder through the support hand's
// middle knuckle, and weapon-up is world-up projected off that ray. The
// support hand is then ON the handguard BY CONSTRUCTION in every clip, in
// every body, and for any weapon a later wave attaches — the defect class is
// closed at the generator, not patched per-shot.
//
// GRIP_Y: metres from the wrist joint toward the knuckles (measured: the
// knuckle line sits 0.133 m out on this rig), i.e. the weapon origin — which
// prepWeaponProto puts at the pistol-grip anchor — lands in the palm.
const GRIP_Y = 0.05;
// Below this hand separation the ray is noise (hands crossed, arms tucked, a
// death slump): keep the last good basis rather than spinning the weapon.
const GRIP_MIN_SPAN = 0.12;

// SUPPORT-HAND CURL — BAKED INTO THE CLIPS, never applied per frame.
// The Mixamo rifle clips DO animate fingers (verified: all 7 shipped clips
// carry all 15 left-hand rotation tracks), but the support hand's authored
// pose is a loose open cradle — LeftHandMiddle2 at 48 deg against the firing
// hand's 103 deg fist — because in Mixamo's source a handguard already fills
// it. At 2 m that reads as an open palm held in the air.
//
// The obvious implementation — multiply the curl onto the bone quaternion
// after mixer.update() — is a TRAP, and it was measured failing this session
// (LeftHandMiddle2 walked to 153 deg, a different value every frame). THREE's
// PropertyMixer.apply() writes to the scene graph only when the accumulated
// clip value CHANGED since the last apply; on a held battery frame, or any
// frame where a track is momentarily flat, it skips the write, the bone keeps
// the value WE wrote, and the next multiply compounds it. So the curl is
// composed into the clip tracks once, at load, where the mixer then owns the
// result absolutely: q_track * q_curl, post-multiplied = a rotation in the
// bone's own frame (+X closes on both hands on this rig — verified from the
// clip's own quaternions, which are X-dominant and positive on both).
const CURL = { 1: 0.50, 2: 0.55, 3: 0.35 };
const CURL_THUMB = { 1: 0.18, 2: 0.32, 3: 0.26 };
// glTF node names carry a colon ("mixamorig:LeftHandIndex1") that THREE's
// PropertyBinding.sanitizeNodeName strips, so match both spellings.
const SUPPORT_TRACK = /LeftHand(Index|Middle|Ring|Pinky|Thumb)([123])\.quaternion$/;

// ---------------------------------------------------------------------------
// Clip hygiene
// ---------------------------------------------------------------------------

/**
 * Pick the real animation out of a clip GLB. The repacked rifle clips carry a
 * ZERO-DURATION "mixamo.com" ghost animation next to the real "clip" (measured
 * this session: clip_rifle_idle "clip" dur 2.133 s vs "mixamo.com" dur 0.000).
 * animations[0] is a trap (doctrine §1's purge-actions lesson) — the longest
 * duration is the only robust selector across the three naming schemes in the
 * set ("clip", "mixamo.com", "Armature|mixamo.com|Layer0").
 */
function pickClip(gltf) {
  let best = null;
  for (const c of gltf.animations || []) {
    if (!best || c.duration > best.duration) best = c;
  }
  return best;
}

/**
 * Strip the tracks that make Meshy/Mixamo clips misbehave (doctrine §1):
 *  - `.scale` — a baked Hips scale SHRINKS the model the moment it moves
 *  - ALL `.position` tracks except Hips — skeletal animation is rotation +
 *    root translation; every other translation track is exporter junk in a
 *    foreign armature space. Measured this session: death_b/c carry position
 *    tracks on all 65 nodes and the raw clip flings the HEAD to y=15.85 m.
 *    (This is the stronger form of the Shoulder|Arm|Hand rule — same class
 *    of defect, whole skeleton.)
 * Hips.position survives (death falls, locomotion sway need it).
 */
function cleanClip(clip, name) {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => {
    if (/\.scale$/.test(t.name)) return false;
    if (/\.position$/.test(t.name) && !/Hips\.position$/.test(t.name)) return false;
    return true;
  });
  curlSupportHand(c);
  c.name = name;
  return c;
}

/**
 * Close the SUPPORT (left) hand around the handguard, in place, on every
 * keyframe of every finger track. See the CURL note above for why this is a
 * load-time clip edit and not a post-mixer bone edit.
 */
function curlSupportHand(clip) {
  for (const t of clip.tracks) {
    const m = SUPPORT_TRACK.exec(t.name);
    if (!m) continue;
    const amt = (m[1] === "Thumb" ? CURL_THUMB : CURL)[m[2]];
    if (!amt) continue;
    const bx = Math.sin(amt / 2), bw = Math.cos(amt / 2); // curl about local +X
    const v = t.values;
    for (let i = 0; i + 3 < v.length; i += 4) {
      const ax = v[i], ay = v[i + 1], az = v[i + 2], aw = v[i + 3];
      v[i] = ax * bw + aw * bx;
      v[i + 1] = ay * bw + az * bx;
      v[i + 2] = az * bw - ay * bx;
      v[i + 3] = aw * bw - ax * bx;
    }
  }
}

// ---------------------------------------------------------------------------
// Material repair + wet-shoulder override
// ---------------------------------------------------------------------------

/**
 * Doctrine §1 repair — Meshy omits metallicFactor/roughnessFactor (glTF
 * defaults both to 1.0 → diffuse = albedo×(1−metalness) = ZERO; bodies ignore
 * every light) and binds the albedo as a full-strength emissive (bodies can't
 * darken in shadow and feed the bloom threshold). Repair at load, once, for
 * every body — the next generated body arrives broken the same way.
 */
export function repairMeshyMaterial(mat) {
  if (!mat) return;
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    if (!m || m.userData.__meshyRepaired) continue;
    if (m.metalness !== undefined) m.metalness = 0.0;
    if (m.roughness !== undefined) m.roughness = 0.78;
    if (m.emissive) m.emissive.setRGB(0, 0, 0);
    if (m.emissiveMap) m.emissiveMap = null;
    if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0;
    // KHR_materials_specular has shipped as [2,2,2] before — double-strength
    // white specular on cloth.
    if (m.specularIntensity !== undefined) m.specularIntensity = 1.0;
    if (m.specularColor && m.specularColor.setRGB) m.specularColor.setRGB(1, 1, 1);
    m.userData.__meshyRepaired = true;
    m.needsUpdate = true;
  }
}

/**
 * LD §5.4 wet-shoulder override, ON TOP of the repair: "rim-spec boost +
 * roughness 0.35 on shoulders/helmets of all bodies … shoulders/head only".
 * Implemented as a height-band roughness pull in ONE shared shader variant:
 * every soldier material returns the same customProgramCacheKey, so the whole
 * cast costs exactly one extra program (compiled inside soldiers.ready(),
 * before the mission — programs delta stays 0 during play, the FAIL gate).
 * vBrWetY is the post-skinning object-space height; these rigs are authored at
 * real metres with feet at y=0 (last-circle 26 m-giant lesson), so the
 * 1.05→1.42 m band is the chest→shoulder ramp on both bodies.
 */
export function applyWetShoulder(mat) {
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    if (!m || m.userData.__brWet) continue;
    m.userData.__brWet = true;
    m.envMapIntensity = 1.25; // the rim/spec boost half of the override
    m.customProgramCacheKey = () => "br_soldier_wet";
    m.onBeforeCompile = (sh) => {
      sh.vertexShader =
        "varying float vBrWetY;\n" +
        sh.vertexShader.replace(
          "#include <skinning_vertex>",
          "#include <skinning_vertex>\n\tvBrWetY = transformed.y;"
        );
      sh.fragmentShader =
        "varying float vBrWetY;\n" +
        sh.fragmentShader.replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n" +
          "\tfloat brWet = smoothstep(1.05, 1.42, vBrWetY);\n" +
          "\troughnessFactor = mix(roughnessFactor, 0.35, brWet * 0.85);"
        );
    };
    m.needsUpdate = true;
  }
}

/** Strip embedded lights; shadow + culling flags per doctrine §1/§3. */
function prepScene(scene) {
  const kill = [];
  scene.traverse((o) => {
    if (o.isLight) { kill.push(o); return; }
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      // Characters must RECEIVE shadow too, or they never darken under the
      // arcade balcony / each other and read as pasted onto the scene.
      o.receiveShadow = true;
      // Skinned bounds come from the BIND pose, which on these rigs is
      // degenerate — culling on makes characters vanish at camera angles.
      o.frustumCulled = false;
      repairMeshyMaterial(o.material);
      applyWetShoulder(o.material);
    }
  });
  kill.forEach((l) => l.removeFromParent());
  return scene;
}

// ---------------------------------------------------------------------------
// Skinned-silhouette measurement (Box3.setFromObject reads the BIND pose and
// lies — colosseum's measured failure; the mesh in its CURRENT pose is truth)
// ---------------------------------------------------------------------------
function lowestSkinnedY(root, stride = 3) {
  let lo = Infinity;
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i += stride) {
      o.getVertexPosition(i, v); // local, fully skinned
      v.applyMatrix4(o.matrixWorld);
      if (v.y < lo) lo = v.y;
    }
  });
  return lo;
}

// ---------------------------------------------------------------------------
// loadBody — cached proto per name (frozen signature)
// ---------------------------------------------------------------------------
const PROTO_CACHE = new Map();
let clipSetPromise = null;

/** Load the shared clip set ONCE (armature-only GLBs, retarget by bone name). */
function loadClipSet() {
  if (!clipSetPromise) {
    clipSetPromise = (async () => {
      const clips = [];
      for (const [name, url] of Object.entries(CLIP_FILES)) {
        const g = await load(`./${url}`);
        const raw = pickClip(g);
        if (raw) clips.push(cleanClip(raw, name));
        else console.error(`[actor] clip GLB ${url} carries no animation`);
      }
      return clips;
    })();
  }
  return clipSetPromise;
}

/**
 * @param {string} name  'soldier' | 'juggernaut' | an assets/chars path
 * @returns {Promise<{name, scene, animations, clipNames}>}  cached per name
 */
export async function loadBody(name) {
  const key = String(name || "soldier");
  if (!PROTO_CACHE.has(key)) {
    PROTO_CACHE.set(key, (async () => {
      const short = key.replace(/^.*\/|\.glb$/g, "");
      const url = BODY_GLB[short] || (key.endsWith(".glb") ? key : BODY_GLB.soldier);
      const [gltf, clips] = await Promise.all([load(`./${url}`), loadClipSet()]);
      const scene = prepScene(gltf.scene);
      return {
        name: short,
        scene,
        animations: clips, // shared set — same mixamorig skeleton on both bodies
        clipNames: clips.map((c) => c.name),
      };
    })());
  }
  return PROTO_CACHE.get(key);
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

// Module scratch — createActor/update run per bot per frame; allocating these
// in the loop would GC-storm mid-firefight (doctrine §3: 0 allocs in update).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);

/** Rotate a bone by a WORLD-space quaternion, preserving its parent chain
 *  (doctrine §1: solve in world space, express in the bone's frame). */
function rotateBoneWorld(bone, q) {
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.premultiply(_q3.copy(_q2).invert().multiply(q).multiply(_q2));
}

/**
 * createActor(proto) → actor (frozen signature §3.15).
 * The actor owns model, mixer, clips, grip, aim-blend; soldiers.js owns the
 * root transform (position/yaw), anim selection and lifecycle.
 */
export function createActor(proto) {
  const root = new THREE.Group();
  root.name = `actor_${proto ? proto.name : "missing"}`;

  // Missing proto → honest dev placeholder (caller pushes __FFG_FALLBACKS__).
  if (!proto || !proto.scene) {
    const geo = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.9;
    root.add(mesh);
    return {
      root, placeholder: true,
      play() {}, playOnce() {}, update() {}, aimBlend() {},
      attachWeapon() { return null; }, setTint() {}, setFlash() {},
      currentName: null, crouchW: 0, groundSpeed: 0,
      dispose() { root.removeFromParent(); geo.dispose(); mat.dispose(); },
    };
  }

  const model = skeletonClone(proto.scene);
  root.add(model);

  // SNAPSHOT THE REST POSE BEFORE THE MIXER EXISTS (doctrine §1): the glTF
  // node TRS is the last guaranteed-intact pose. Skeleton.pose() measurably
  // collapses these rigs into a ball — never use it.
  const restPose = [];
  model.traverse((o) => {
    if (o.isBone) restPose.push({ b: o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
  });
  model.userData.restPose = restPose;

  // PER-ACTOR MATERIALS: tint variants + the 70 ms flinch flash are per-actor
  // uniforms, so materials must not be shared between clones (a shared
  // material would flash the whole squad). Clones share the compiled program
  // (same cache key) and the texture objects — programs and VRAM stay flat.
  const mats = [];
  model.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const out = src.map((m) => {
      const c = m.clone();
      // clone() copies userData by reference-shallow; re-mark + re-hook so the
      // shared cache key + wet override survive on the clone.
      c.userData = { __meshyRepaired: true };
      applyWetShoulder(c);
      mats.push(c);
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  const baseColor = new THREE.Color(1, 1, 1);

  // Bones (mixamorig: prefix — THREE sanitizes the colon away; normalize like
  // last-circle's findArmBones or every lookup silently no-ops).
  const bones = {};
  const byName = new Map();
  model.traverse((o) => {
    if (!o.isBone) return;
    const nm = o.name.replace(/^mixamorig:?/i, "");
    byName.set(nm, o);
    if (nm === "Hips") bones.hips = o;
    else if (nm === "Spine1") bones.spine1 = o;
    else if (nm === "Spine2") bones.spine2 = o;
    else if (nm === "Neck") bones.neck = o;
    else if (nm === "RightHand") bones.rHand = o;
    else if (nm === "LeftHand") bones.lHand = o;
  });
  // Middle knuckle = the point a handguard rests against; it is the aim target
  // for the bore solve. Falls back to the wrist on a rig without fingers.
  bones.rKnuckle = byName.get("RightHandMiddle1") || bones.rHand;
  bones.lKnuckle = byName.get("LeftHandMiddle1") || bones.lHand;
  const grips = [];  // attached weapon holders, re-solved every update()

  /**
   * Seat the weapon in both hands. The firing palm holds the weapon ORIGIN,
   * which prepWeaponProto put at the pistol-grip anchor — well BELOW the bore.
   * So the palm→support-knuckle line is not the bore: it rises toward the
   * muzzle by the height of the handguard above the pistol grip (h.hold,
   * measured off the weapon's own geometry at load). Aligning the bore with
   * that line directly is what left the first attempt's handguard floating
   * ~9 cm over the support hand in the live capture. Instead the weapon is
   * pitched down by asin(hold/span) so that the LOCAL point (0, hold, z*) —
   * the underside of the handguard — lands exactly on the knuckle.
   *
   * Full basis, all three axes pinned: a one-axis setFromUnitVectors solve
   * leaves roll free, which is the sideways-weapon bug.
   */
  function solveGrip(h) {
    const { holder, bone, support } = h;
    if (!support) return;
    // Both matrixWorlds are stale inside update() (the mixer writes local TRS
    // only), so refresh just these two chains — ~20 matrix composes per bot,
    // versus a full-skeleton updateMatrixWorld the renderer is about to do
    // anyway. Ancestors first: worldToLocal-free, no allocation.
    support.updateWorldMatrix(true, false);
    holder.updateWorldMatrix(true, false);
    _v2.setFromMatrixPosition(support.matrixWorld);
    _v3.setFromMatrixPosition(holder.matrixWorld);
    _v4.subVectors(_v2, _v3);
    const span = _v4.length();
    if (span < GRIP_MIN_SPAN) return;   // keep the last good basis
    _v4.multiplyScalar(1 / span);       // bore, world
    // world-up unless the bore IS vertical (a rifle pointed at the sky)
    _v5.crossVectors(Math.abs(_v4.y) > 0.94 ? _AXIS_Z : _AXIS_Y, _v4);
    if (_v5.lengthSq() < 1e-8) return;
    _v5.normalize();                    // weapon right
    _v1.crossVectors(_v4, _v5);         // weapon up (already unit: two unit ⟂)
    _m1.makeBasis(_v5, _v1, _v4);
    _q1.setFromRotationMatrix(_m1);
    // pitch down so the handguard underside, not the grip axis, meets the hand
    const s = h.hold / span;
    _q3.setFromAxisAngle(_AXIS_X, Math.asin(s > 0.5 ? 0.5 : s < -0.5 ? -0.5 : s));
    _q1.multiply(_q3);
    bone.getWorldQuaternion(_q2);
    holder.quaternion.copy(_q2.invert().multiply(_q1));
  }
  const hipsRestY = bones.hips ? bones.hips.position.y : 0;

  // Mixer + actions. Clips arrive pre-cleaned + renamed from loadClipSet().
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of proto.animations) actions[clip.name] = mixer.clipAction(clip);

  // NEVER THE BIND POSE: settle the idle immediately, before any measurement
  // or attachment solve (colosseum: measuring/solving against bind pose is
  // how shields ended up slabbed across bodies).
  const idleName = ANIMS.idle;
  if (actions[idleName]) {
    const a = actions[idleName];
    a.reset(); a.play();
    mixer.update(0.35);
    model.updateMatrixWorld(true);
  }

  // Meshy rigs are authored at REAL METRES, feet at y=0 — do NOT bbox-
  // normalize (last-circle's 26 m-giant lesson). Ground on the SOLES: the
  // lowest bone is the ankle, several cm above the sole; the skinned vertex
  // sweep finds the true lowest point in the settled pose.
  const lowest = lowestSkinnedY(model);
  if (isFinite(lowest)) model.position.y = -lowest;

  const actor = {
    root,
    placeholder: false,
    currentName: idleName,
    crouchW: 0,      // soldiers.js drives: 1 while crouch_walk (procedural hip drop)
    groundSpeed: 0,  // soldiers.js drives: m/s, kills foot-slide on loco clips
    _aimW: 0,
    _current: actions[idleName] || null,
    _onceEnd: null,

    /** Cross-fade to a looping semantic state (resolves through ANIMS). */
    play(logical, { fade = 0.14, timeScale = 1 } = {}) {
      const name = ANIMS[logical] || logical;
      const a = actions[name];
      if (!a) return false;
      if (name === actor.currentName) {
        if (actor._current) actor._current.timeScale = timeScale;
        return false;
      }
      a.reset();
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = false;
      a.timeScale = timeScale;
      a.fadeIn(fade);
      if (actor._current && actor._current !== a) actor._current.fadeOut(fade);
      a.play();
      actor._current = a;
      actor.currentName = name;
      actor._onceEnd = null;
      return true;
    },

    /** One-shot (hit, deaths). clampWhenFinished holds the final frame — a
     *  dead body stays in its slump (persistence, VT §7 / D6). */
    playOnce(logical, { fade = 0.10, timeScale = 1, then = null } = {}) {
      const name = ANIMS[logical] || logical;
      const a = actions[name];
      if (!a) return false;
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.timeScale = timeScale;
      a.fadeIn(fade);
      if (actor._current && actor._current !== a) actor._current.fadeOut(fade);
      a.play();
      actor._current = a;
      actor.currentName = name;
      actor._onceEnd = then ? () => actor.play(then) : null;
      return true;
    },

    /**
     * Aim-pose blend (VT §7): pitch the spine chain toward the target so a bot
     * aiming up at a balcony / down from the platform reads in the body, not
     * just the muzzle. World-space solve split over Spine1+Spine2 (half each —
     * one joint doing all of it reads as a hinge), expressed per-bone-frame.
     * yawDelta is the clamped chest correction toward aimAt beyond body yaw.
     */
    aimBlend(pitch, yawDelta, w) {
      actor._aimW += (w - actor._aimW) * 0.18;
      const k = actor._aimW;
      if (k < 0.01 || !bones.spine1 || !bones.spine2) return;
      root.updateMatrixWorld(false);
      // actor-right axis in world (root yaw only — root never pitches/rolls)
      const ry = root.rotation.y;
      _v1.set(Math.cos(ry), 0, -Math.sin(ry));
      _q1.setFromAxisAngle(_v1, -pitch * 0.5 * k);
      rotateBoneWorld(bones.spine1, _q1);
      rotateBoneWorld(bones.spine2, _q1);
      if (yawDelta) {
        _v1.set(0, 1, 0);
        _q1.setFromAxisAngle(_v1, yawDelta * 0.5 * k);
        rotateBoneWorld(bones.spine1, _q1);
        rotateBoneWorld(bones.spine2, _q1);
      }
    },

    /**
     * attachWeapon(group, hand='R') — holder on the FIRING hand bone,
     * counter-scaled so children live in world metres (bone world scale varies
     * wildly across Meshy rig families). The grip basis is not a constant: see
     * the TWO-HAND WEAPON HOLD note at the top of this file. The holder is
     * registered here and re-solved every update() so the bore always runs
     * from the palm through the support hand's knuckle, and the support hand
     * is told to close (its clip pose is an open cradle).
     */
    attachWeapon(group, hand = "R") {
      const firing = hand === "L" ? bones.lHand : bones.rHand;
      const support = hand === "L" ? bones.rKnuckle : bones.lKnuckle;
      if (!firing) return null;
      const holder = new THREE.Group();
      firing.add(holder);
      root.updateMatrixWorld(true);
      firing.getWorldScale(_v1);
      const ws = Math.max(1e-4, _v1.x);
      holder.scale.setScalar(1 / ws); // children are in metres
      holder.position.set(0, GRIP_Y / ws, 0);
      if (group) holder.add(group);
      // hold = handguard underside above the grip anchor, measured off the
      // weapon's own geometry by prepWeaponProto (numbers only in userData —
      // Object3D.copy JSON-round-trips it on every clone).
      const hold = (group && group.userData && +group.userData.brHold) || 0;
      const h = { holder, bone: firing, support, hold };
      grips.push(h);
      // Solve once NOW: the actor is already settled into idle, so the very
      // first rendered frame is correct — never one frame of the bind basis.
      solveGrip(h);
      return holder;
    },

    /** Faction tint (R15): multiplies the albedo map. The raw archetype hexes
     *  are dark military tones that would crush a night frame at full
     *  strength, so the multiplier is the tint pulled 35% toward white — hue
     *  survives, readability survives. */
    setTint(hex) {
      baseColor.set(hex).lerp(_WHITE, 0.35);
      for (const m of mats) m.color.copy(baseColor);
    },

    /** Flinch flash (VT §7): 70 ms COLOR-MULTIPLY — never emissive (emissive
     *  feeds bloom and violates the Meshy repair). soldiers.js times it. */
    setFlash(on) {
      for (const m of mats) {
        if (on) m.color.copy(baseColor).multiplyScalar(1.6);
        else m.color.copy(baseColor);
      }
    },

    /** Advance animation. Foot-planting: loco clips cycle at a fixed rate, so
     *  timeScale rides actual ground speed (colosseum trick) — sliding feet
     *  are a D10 hard-cap. */
    update(dt) {
      // NEVER feed the mixer a negative dt: a LoopOnce action driven backward
      // hits time<0, fires 'finished' and clampWhenFinished PAUSES it at
      // frame 0 forever — measured this session (rAF's first timestamp can
      // precede the performance.now() captured at init, making the first
      // frame delta negative; every death played that frame froze standing).
      dt = Math.max(0, dt);
      const cn = actor.currentName;
      if (actor._current && (cn === "rifle_walk" || cn === "rifle_run")) {
        const nominal = cn === "rifle_run" ? 3.6 : 1.5;
        actor._current.timeScale = Math.min(2.2, Math.max(0.35, actor.groundSpeed / nominal));
      }
      mixer.update(dt);
      // Procedural crouch-walk hip drop (see anim_map.js): rifle_walk keeps
      // the feet stepping; the drop reads as the crouch.
      if (bones.hips && actor.crouchW > 0.01) {
        bones.hips.position.y = hipsRestY - 0.32 * actor.crouchW;
      }
      // POST-MIXER: re-seat the weapon against the pose the mixer just wrote.
      // Runs on a held frame too (dt === 0) — the battery's frozen pose has to
      // be as correct as a moving one, and holder.quaternion is ASSIGNED (not
      // accumulated), so re-running it on an unchanged pose is a no-op.
      for (let i = 0; i < grips.length; i++) solveGrip(grips[i]);
    },

    dispose() {
      root.removeFromParent();
      mixer.stopAllAction();
      // geometry + textures are the proto's (shared); only the clones die
      for (const m of mats) m.dispose();
    },
  };

  mixer.addEventListener("finished", () => {
    if (actor._onceEnd) { const f = actor._onceEnd; actor._onceEnd = null; f(); }
  });

  return actor;
}

const _WHITE = new THREE.Color(1, 1, 1);
