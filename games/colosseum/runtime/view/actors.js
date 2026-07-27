// Colosseum — actor loading and animation.
//
// Two families share one interface so the combat sim never branches on species:
//   Fighter — a Meshy auto-rigged humanoid: base.glb plus armature-only clip
//             GLBs that are retargeted onto it by bone name.
//   Beast   — a Sketchfab quadruped carrying all its clips inside one GLB.
//
// The Meshy rig recipe below is hard-won (see reference_meshy_char_rig_calibration
// in project memory); the comments mark which lines exist because of a specific
// visual failure, so nobody "simplifies" them back into the bug.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { dampAngle, clamp } from "../core/util.js";

// Character GLBs are Draco-compressed (gltf-transform optimize), which cuts a
// rigged gladiator from ~7.9 MB to ~165 KB. Draco needs its decoder wired in or
// GLTFLoader throws "No DRACOLoader instance provided" and every character
// silently fails to load — so it is configured ONCE here, for every consumer.
// The decoder is fetched from the same CDN and version as the three importmap.
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/");
draco.setDecoderConfig({ type: "js" });   // js decoder: no wasm MIME/CORS surprises
loader.setDRACOLoader(draco);

const CACHE = new Map();

function load(url) {
  if (!CACHE.has(url)) {
    CACHE.set(url, new Promise((res, rej) => loader.load(url, res, undefined, rej)));
  }
  return CACHE.get(url);
}

/**
 * Strip the tracks that make Meshy clips misbehave:
 *  - `.scale`  — the idle clip bakes a Hips scale, so the model SHRINKS the
 *    moment it walks.
 *  - `(Shoulder|Arm|Hand).position` — these raise the shoulders and leave the
 *    character in a permanent shrug.
 */
function cleanClip(clip, name) {
  const c = clip.clone();
  c.tracks = c.tracks.filter(
    (t) => !/\.scale$/.test(t.name) && !/(Shoulder|Arm|Hand)\.position$/.test(t.name)
  );
  c.name = name;
  return c;
}

/** Remove GLB-embedded lights and set sane shadow flags. */
function prepScene(scene) {
  const kill = [];
  scene.traverse((o) => {
    if (o.isLight) { kill.push(o); return; }
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      // Characters must take shadow, not just cast it. With this off they
      // never darken under the podium, under the velarium, or under each
      // other, which is half of why they read as pasted onto the scene.
      o.receiveShadow = true;
      // Skinned bounds are computed from the BIND pose, which for these rigs is
      // often degenerate — leaving frustum culling on makes characters vanish
      // at certain camera angles.
      o.frustumCulled = false;
      repairMeshyMaterial(o.material);
    }
  });
  kill.forEach((l) => l.removeFromParent());
  return scene;
}

/**
 * Repair the material Meshy exports. THIS is why the gladiators looked wrong.
 *
 * Dumped straight out of assets/chars/murmillo/base.glb:
 *
 *   { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } },
 *     "emissiveFactor": [1,1,1], "emissiveTexture": { "index": 0 }, ... }
 *
 * Two defects that compound into a fullbright character:
 *
 * 1. metallicFactor and roughnessFactor are ABSENT, and the glTF default for
 *    both is 1.0. three's physical shader computes
 *        diffuseColor = albedo * (1.0 - metalness)
 *    so at metalness 1.0 the diffuse term is exactly ZERO. The DirectionalLight
 *    and HemisphereLight contribute nothing at all to a body; only a
 *    roughness-1 GGX lobe over a dim env map survives, and that is
 *    directionless. No terminator, no form shading, no sense of a light source.
 *
 * 2. emissiveFactor is [1,1,1] with the SAME image as the albedo bound as the
 *    emissive map — the base colour is re-added at full strength as
 *    self-illumination. So the body cannot darken in shadow either, and it
 *    feeds straight into the bloom threshold, which is why white tunics blow
 *    out.
 *
 * Together: the one class of object in the arena that ignores the lighting,
 * standing next to procedurally-built weapons that shade correctly. That
 * contrast is the "these don't look right" everyone was pointing at, and it
 * was never the rig — the skin weights measure fine (3.05-3.85 average bone
 * influences through the shoulder and armpit, weights summing to 1.0, inverse
 * bind matrices reproducing identity to 3.6e-5).
 *
 * Fixed here at load rather than by rewriting eight GLBs, because it is the
 * EXPORTER's output that is wrong and every future generated body will arrive
 * with the same defect. One repair on the way in covers all of them.
 */
function repairMeshyMaterial(mat) {
  if (!mat) return;
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    if (!m || m.userData.__meshyRepaired) continue;
    // Skin, cloth and leather are dielectrics. Metal on these bodies is
    // painted into the albedo, not a metalness channel.
    if (m.metalness !== undefined) m.metalness = 0.0;
    if (m.roughness !== undefined) m.roughness = 0.78;
    // Kill the self-illumination.
    if (m.emissive) m.emissive.setRGB(0, 0, 0);
    if (m.emissiveMap) m.emissiveMap = null;
    if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0;
    // KHR_materials_specular came through as specularColorFactor [2,2,2],
    // i.e. double-strength white specular on flesh.
    if (m.specularIntensity !== undefined) m.specularIntensity = 1.0;
    if (m.specularColor && m.specularColor.setRGB) m.specularColor.setRGB(1, 1, 1);
    m.userData.__meshyRepaired = true;
    m.needsUpdate = true;
  }
}

/**
 * Measure a rig's real extent from BONE world positions.
 *
 * Box3.setFromObject on a SkinnedMesh reads the BIND pose and lies — often
 * reporting a flat or degenerate box. Bones are the truth, and they must be
 * sampled with a clip applied, because several of these rigs have a bind pose
 * that bears no resemblance to the animated silhouette.
 *
 * @returns {{height, length, width, min, span, bones}} all in local units
 */
export function measureRig(root) {
  root.updateMatrixWorld(true);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const v = new THREE.Vector3();
  let bones = 0;
  root.traverse((o) => {
    if (!o.isBone) return;
    bones++;
    o.getWorldPosition(v);
    for (let i = 0; i < 3; i++) {
      const c = i === 0 ? v.x : i === 1 ? v.y : v.z;
      lo[i] = Math.min(lo[i], c);
      hi[i] = Math.max(hi[i], c);
    }
  });
  if (!bones) {
    const bb = new THREE.Box3().setFromObject(root);
    const s = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    return { height: s[1], length: Math.max(s[0], s[2]), width: Math.min(s[0], s[2]), min: bb.min.y, span: s, bones: 0 };
  }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  return {
    // Bones stop at the neck/head joint, not the crown — add a head's worth.
    height: span[1] * 1.09,
    length: Math.max(span[0], span[2]),
    width: Math.min(span[0], span[2]),
    min: lo[1],
    span,
    bones,
  };
}

/** Back-compat alias. */
export const measureRigHeight = measureRig;

/**
 * Lowest world-space Y of any skinned vertex in the model's CURRENT pose.
 *
 * `Box3.setFromObject` cannot do this: for a SkinnedMesh it transforms the
 * BIND-pose bounding box, which for these rigs is frequently wrong by tens of
 * centimetres. `getVertexPosition` applies the live skinning matrices, so this
 * is the true silhouette. Vertices are subsampled — a foot sole is thousands of
 * verts and we only need the extreme.
 */
export function lowestSkinnedY(root, stride = 3) {
  let lo = Infinity;
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i += stride) {
      o.getVertexPosition(i, v);        // local, fully skinned
      v.applyMatrix4(o.matrixWorld);
      if (v.y < lo) lo = v.y;
    }
  });
  return lo;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load a Meshy humanoid: `base.glb` plus a set of armature-only clip files.
 * @returns {{scene: THREE.Object3D, animations: THREE.AnimationClip[]}}
 */
export async function loadFighter(dir, clipNames = [
  "idle", "slash1", "slash2", "parry", "hit", "death", "finisher",
]) {
  const base = await load(`${dir}/base.glb`);
  const anims = [];

  const add = async (file, name) => {
    try {
      const g = await load(`${dir}/${file}`);
      if (g.animations && g.animations[0]) { anims.push(cleanClip(g.animations[0], name)); return true; }
    } catch (e) { /* clip absent — the caller's state machine falls back */ }
    return false;
  };

  if (!(await add("anim_idle.glb", "idle")) && base.animations[0]) {
    anims.push(cleanClip(base.animations[0], "idle"));
  }
  await add("walk_arm.glb", "walk");
  await add("run_arm.glb", "run");
  await Promise.all(clipNames.filter((n) => n !== "idle").map((n) => add(`anim_${n}.glb`, n)));

  return { scene: prepScene(base.scene), animations: anims };
}

/** Load a beast whose clips live inside its own GLB. */
export async function loadBeast(url) {
  const g = await load(url);
  return { scene: prepScene(g.scene), animations: (g.animations || []).map((c) => c.clone()) };
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/**
 * A posed, animated thing standing on the sand. Owns its own root transform,
 * mixer and animation state machine; knows nothing about combat rules.
 *
 * The sim writes `pos`/`facing`/`state`; the actor renders that. Keeping the
 * split clean is what lets a networked client interpolate a remote actor with
 * no sim running at all.
 */
export class Actor {
  /**
   * @param {{scene:THREE.Object3D, animations:THREE.AnimationClip[]}} lib
   * @param {object} opts { height, clipMap, rootMotion }
   */
  constructor(lib, { height = 1.8, length = 0, clipMap = null, name = "actor", restClip = "idle" } = {}) {
    this.root = new THREE.Group();
    this.root.name = name;

    this.model = skeletonClone(lib.scene);
    this.root.add(this.model);

    // SNAPSHOT THE REST POSE BEFORE THE MIXER EXISTS.
    //
    // Equipment solves each attachment's orientation against a reference pose,
    // and the obvious way to get one — THREE.Skeleton.pose() — does not work on
    // these rigs. Measured live: pose() crushes Head, Hips, LeftLeg and
    // RightForeArm to within 1 cm of each other in Y and to an IDENTICAL X,
    // losing the lateral axis outright. That is the same degenerate bind pose
    // prepScene already disables frustum culling for.
    //
    // The glTF node TRS is the real rest pose, and right here — cloned, before
    // any AnimationMixer has touched a bone — is the last moment it is
    // guaranteed intact. Keep it, and solve against this instead.
    const restPose = [];
    this.model.traverse((o) => {
      if (o.isBone) restPose.push({ b: o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
    });
    this.model.userData.restPose = restPose;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.clipMap = clipMap || {};
    for (const clip of lib.animations) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      this.actions[clip.name] = a;
    }

    // MEASURE UNDER A CLIP, NOT IN BIND POSE. Several of these rigs bind in a
    // pose that is nothing like the animated silhouette, so measuring first and
    // animating later produces wildly wrong scale.
    //
    // The rest pose is then LEFT RUNNING rather than stopped. Anything attached
    // afterwards — a shield whose orientation is solved from the arm's actual
    // direction — must see a settled idle, not a T-pose. Solving a scutum
    // against a T-pose arm points it straight out sideways and it ends up
    // slabbed across the body.
    const rest = this._resolve(restClip);
    if (rest) {
      const a = this.actions[rest];
      a.reset();
      a.play();
      this.mixer.update(0.4);
      this.current = a;
      this.currentName = rest;
      this.model.updateMatrixWorld(true);
    }

    const m = measureRig(this.model);
    this.rawMeasure = m;
    this.rawHeight = m.height;

    // Humanoids are normalised by HEIGHT; quadrupeds by BODY LENGTH. Scaling a
    // cat by "height" makes it a kitten, because for a standing quadruped the
    // vertical bone span is the shoulder height, not the animal's size.
    let s = 1;
    if (length > 0 && m.length > 0.01) s = length / m.length;
    else if (m.height > 0.01) s = height / m.height;
    // A degenerate measurement (some rigs collapse) must not produce a 70x
    // scale-up that flings the model off the map.
    if (!isFinite(s) || s <= 0 || s > 200) s = 1;
    this.model.scale.setScalar(s);
    this.scaleApplied = s;

    // GROUND THE MODEL ON ITS SOLES, NOT ITS ANKLES.
    // The lowest BONE is the ankle/foot joint, which sits several centimetres
    // above the sole — grounding on it leaves the character hovering with a
    // visible gap and a detached shadow. SkinnedMesh.getVertexPosition gives
    // the real skinned vertex in the CURRENT pose, so sampling the mesh finds
    // the actual lowest point of the foot.
    this.model.position.y = 0;
    this.model.updateMatrixWorld(true);
    const lowest = lowestSkinnedY(this.model);
    this.model.position.y = isFinite(lowest) ? -lowest : -m.min * s;
    this.height = (length > 0 ? m.height : height) * (length > 0 ? s : 1);
    this.length = m.length * s;

    this.current = null;
    this.currentName = null;
    this._onceEnd = null;
    this.mixer.addEventListener("finished", () => {
      if (this._onceEnd) { const f = this._onceEnd; this._onceEnd = null; f(); }
    });

    // Sim-facing state.
    this.pos = new THREE.Vector3();
    this.facing = 0;
    this.visualFacing = 0;
    this.speed = 0;
  }

  /** Resolve a logical state name ('idle','attack1') to a real clip name. */
  _resolve(logical) {
    const mapped = this.clipMap[logical] || logical;
    if (this.actions[mapped]) return mapped;
    // Fall back to any clip whose name contains the logical token — beast rigs
    // use vendor-specific names like 'LeopardAttack'.
    const lower = String(mapped).toLowerCase();
    for (const k in this.actions) if (k.toLowerCase().includes(lower)) return k;
    return null;
  }

  /** Cross-fade to a looping state. */
  play(logical, { fade = 0.18, timeScale = 1 } = {}) {
    const name = this._resolve(logical);
    if (!name || name === this.currentName) {
      if (name && this.current) this.current.timeScale = timeScale;
      return false;
    }
    const next = this.actions[name];
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.timeScale = timeScale;
    next.fadeIn(fade);
    if (this.current) this.current.fadeOut(fade);
    next.play();
    this.current = next;
    this.currentName = name;
    return true;
  }

  /** Play a one-shot (attack, hit, death) and return to `then` when done. */
  playOnce(logical, { fade = 0.08, timeScale = 1, then = "idle" } = {}) {
    const name = this._resolve(logical);
    if (!name) return false;
    const a = this.actions[name];
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    a.fadeIn(fade);
    if (this.current && this.current !== a) this.current.fadeOut(fade);
    a.play();
    this.current = a;
    this.currentName = name;
    this._onceEnd = then ? () => this.play(then) : null;
    return true;
  }

  /** Duration of a logical clip in seconds (0 if absent). */
  clipDuration(logical) {
    const name = this._resolve(logical);
    return name ? this.actions[name].getClip().duration : 0;
  }

  hasClip(logical) { return !!this._resolve(logical); }

  /**
   * @param {number} dt
   * @param {number} groundSpeed  m/s, used to kill foot-slide on loco clips
   */
  update(dt, groundSpeed = 0) {
    // Meshy locomotion clips cycle in place at a fixed rate, so a character
    // moving at any other speed skates. Scaling timeScale by actual velocity
    // is what plants the feet.
    if (this.current && (this.currentName === "walk" || this.currentName === "run")) {
      const nominal = this.currentName === "run" ? 3.6 : 1.5;
      this.current.timeScale = clamp(groundSpeed / nominal, 0.35, 2.2);
    }
    this.mixer.update(dt);

    // Turning is damped so a fighter pivots with weight instead of snapping.
    this.visualFacing = dampAngle(this.visualFacing, this.facing, 12, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.visualFacing;

    this._combatIdle(dt, groundSpeed);
  }

  /**
   * A living stance. Nobody in an arena stands still.
   *
   * anim_idle is effectively a statue — measured in Blender it moves 0.819 m
   * of total bone path across all 24 bones over 2.37 s, about 3.4 cm per bone
   * per loop, and every archetype ships the same byte-identical clip. So a
   * fighter who is circling slowly, waiting for an opening, or holding an
   * attack token reads as someone who has stopped playing the game, even
   * though the sim has them moving 73-83% of ticks and attacking 17-22%.
   *
   * Rather than author eight new idles, this adds motion the clip lacks: a
   * slow weight shift from foot to foot, a breathing rise, and a small guard
   * sway, applied to the ROOT so it layers over whatever the mixer is doing
   * and costs nothing. It fades out as the fighter picks up speed, because a
   * run clip already carries its own weight.
   *
   * Each actor gets its own phase offset so a line of gladiators never bobs in
   * unison — the single thing that makes a crowd of NPCs look mechanical.
   */
  _combatIdle(dt, groundSpeed) {
    if (this._idlePhase === undefined) this._idlePhase = Math.random() * Math.PI * 2;
    this._idleT = (this._idleT || 0) + dt;
    // Full strength when standing, gone by a walk.
    const w = clamp(1 - groundSpeed / 1.6, 0, 1);
    if (w <= 0.001) return;
    const t = this._idleT;
    const p = this._idlePhase;
    // Weight shift: a slow lateral lean, the way a man rests one leg then the
    // other while watching someone who wants to kill him.
    const shift = Math.sin(t * 0.9 + p) * 0.035 * w;
    // Breathing: a small vertical rise, faster than the weight shift.
    const breath = Math.sin(t * 2.1 + p * 1.7) * 0.012 * w;
    // Guard sway: the torso turning fractionally as the eyes track.
    const sway = Math.sin(t * 0.7 + p * 0.6) * 0.045 * w;

    this.root.position.y += breath;
    this.root.position.x += Math.cos(this.visualFacing) * shift;
    this.root.position.z -= Math.sin(this.visualFacing) * shift;
    this.root.rotation.y += sway;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

/**
 * Attach a weapon to a hand bone.
 *
 * The `palm` offset is the single most important number here: Meshy rigs have
 * no finger bones, so a hand can never close around a grip. Without pushing the
 * weapon along the hand bone's +Y into the fist, it floats at the wrist and
 * reads as held sideways.
 */
export function attachWeapon(actor, mesh, {
  bone = /RightHand|Hand_R|mixamorig.*RightHand/i,
  palm = 0.06,
  rotation = null,
  align = null,          // 'shield' — solve the orientation instead of guessing
} = {}) {
  let target = null;
  actor.model.traverse((o) => {
    if (!target && o.isBone && bone.test(o.name)) target = o;
  });
  if (!target) return null;

  // A bone deep in a scaled hierarchy carries that scale; counter it so the
  // weapon keeps its authored size.
  target.updateWorldMatrix(true, false);
  const bonePos = new THREE.Vector3();
  const boneQuat = new THREE.Quaternion();
  const boneScale = new THREE.Vector3();
  target.matrixWorld.decompose(bonePos, boneQuat, boneScale);
  const counter = boneScale.x > 0.0001 ? 1 / boneScale.x : 1;

  const holder = new THREE.Group();
  holder.name = "weapon_mount";
  holder.position.y = palm * counter;
  holder.scale.setScalar(counter);

  if (align === "shield") {
    // Make sure the rig is in its settled pose before reading the bone.
    actor.model.updateMatrixWorld(true);
    target.updateWorldMatrix(true, false);
    target.matrixWorld.decompose(bonePos, boneQuat, boneScale);
    // SOLVE the mount orientation rather than hand-tuning Euler angles.
    //
    // A scutum must satisfy two constraints in WORLD space: its face normal
    // (local +z) points the way the fighter faces, and its long axis (local +y)
    // stays vertical. Build that world rotation, then express it in the bone's
    // frame — which is what the holder's local rotation has to be.
    //
    // Guessing Euler triples for a bone whose own axes are arbitrary is how
    // this ended up edge-on twice; this cannot be wrong by construction.
    actor.model.updateMatrixWorld(true);
    const modelQuat = new THREE.Quaternion();
    actor.model.getWorldQuaternion(modelQuat);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(modelQuat).setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, forward).normalize();
    const desired = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, forward)
    );
    holder.quaternion.copy(boneQuat).invert().multiply(desired);
  } else if (rotation) {
    holder.rotation.set(rotation[0], rotation[1], rotation[2]);
  }

  holder.add(mesh);
  target.add(holder);
  return holder;
}

// --- procedural weapons -----------------------------------------------------
//
// Every weapon is ONE mesh. Built naively these are 5-9 primitives each, and
// two weapons on one fighter cost 15 draw calls — half the entire arena's
// budget for a sword and a shield. So each part is tinted into vertex colours
// and merged, and all weapons share a single material.
//
// All are built along +Y with the grip at the origin, which is the contract
// attachWeapon() and the palm offset assume.

const WEAPON_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.55, metalness: 0.55, name: "weapon",
});

const STEEL = 0xc9ced6, WOOD = 0x5a3f27, BRASS = 0xb08d46, LEATHER = 0x4a3524, BOARD = 0x8e2f22;

/**
 * Tint a geometry and normalise it for merging.
 *
 * mergeGeometries requires EVERY input to carry an identical attribute set —
 * one geometry missing `uv` makes the whole merge fail (it surfaces as a
 * confusing "cannot read morphAttributes of null" from the returned null).
 * Hand-built geometries here have no UVs, so they get a zero set.
 */
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const n = g.attributes.position.count;

  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));

  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  // Drop anything else (tangents, uv2) so every part matches exactly.
  for (const k of Object.keys(g.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
  }
  return g;
}

function weld(parts) {
  const merged = mergeGeometries(parts, false);
  if (!merged) {
    // Fail loudly: a silent null here becomes an opaque morphAttributes crash
    // three frames later, with nothing pointing at the real cause.
    const shapes = parts.map((p) => Object.keys(p.attributes).sort().join("+"));
    throw new Error(`weld: mergeGeometries returned null — mismatched attributes: ${[...new Set(shapes)].join(" | ")}`);
  }
  parts.forEach((p) => p.dispose());
  const m = new THREE.Mesh(merged, WEAPON_MAT);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/** A gladius: short, leaf-bladed. One draw call. */
export function makeGladius() {
  const parts = [];
  const grip = new THREE.CylinderGeometry(0.021, 0.024, 0.11, 8);
  grip.translate(0, 0.055, 0);
  parts.push(paint(grip, LEATHER));

  const pommel = new THREE.SphereGeometry(0.032, 8, 6);
  pommel.translate(0, -0.01, 0);
  parts.push(paint(pommel, BRASS));

  const guard = new THREE.BoxGeometry(0.11, 0.022, 0.035);
  guard.translate(0, 0.118, 0);
  parts.push(paint(guard, BRASS));

  // leaf blade — swells then points
  const b1 = new THREE.CylinderGeometry(0.028, 0.021, 0.30, 6);
  b1.scale(1, 1, 0.34);
  b1.translate(0, 0.28, 0);
  parts.push(paint(b1, STEEL));

  const b2 = new THREE.ConeGeometry(0.028, 0.16, 6);
  b2.scale(1, 1, 0.34);
  b2.translate(0, 0.50, 0);
  parts.push(paint(b2, STEEL));

  return weld(parts);
}

/**
 * A scutum: the big curved rectangular shield. One draw call.
 *
 * Built as a ring-segment sweep rather than N independent rotated boxes. The
 * box-per-stave version left visible wedge gaps between planks (they rotate
 * about their own centres, so adjacent edges splay apart) and read as a
 * venetian blind. Sweeping a continuous strip guarantees the staves meet.
 *
 * Local frame: the shield face is centred on the origin in XY, curving away
 * along -z, so attachWeapon's forearm rotation presents it forwards.
 */
export function makeScutum({ w = 0.66, h = 1.02, curve = 0.16 } = {}) {
  const parts = [];
  const N = 8;                        // stave count
  const R = (w * w / 4 + curve * curve) / (2 * curve);   // radius through the chord
  const half = Math.asin(clamp(w / 2 / R, -1, 1));

  const pos = [];
  const nor = [];
  const at = (t) => [R * Math.sin(t), -(R * Math.cos(t) - (R - curve))];

  const thick = 0.028;
  for (let i = 0; i < N; i++) {
    const t0 = -half + (2 * half * i) / N;
    const t1 = -half + (2 * half * (i + 1)) / N;
    const [x0, z0] = at(t0);
    const [x1, z1] = at(t1);
    const nx = Math.sin((t0 + t1) / 2);
    const nz = -Math.cos((t0 + t1) / 2);
    // front face
    quadTri(pos, nor, [x0, -h / 2, z0], [x1, -h / 2, z1], [x1, h / 2, z1], [x0, h / 2, z0], [nx, 0, nz]);
    // back face
    quadTri(pos, nor, [x0, h / 2, z0 - thick], [x1, h / 2, z1 - thick], [x1, -h / 2, z1 - thick], [x0, -h / 2, z0 - thick], [-nx, 0, -nz]);
    // top + bottom edges
    quadTri(pos, nor, [x0, h / 2, z0], [x1, h / 2, z1], [x1, h / 2, z1 - thick], [x0, h / 2, z0 - thick], [0, 1, 0]);
    quadTri(pos, nor, [x0, -h / 2, z0 - thick], [x1, -h / 2, z1 - thick], [x1, -h / 2, z1], [x0, -h / 2, z0], [0, -1, 0]);
  }
  const board = new THREE.BufferGeometry();
  board.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  board.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  parts.push(paint(board, BOARD));

  // umbo (the iron boss over the hand grip)
  const boss = new THREE.SphereGeometry(0.088, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  boss.rotateX(-Math.PI / 2);
  boss.translate(0, 0, curve + 0.012);
  parts.push(paint(boss, BRASS));

  // Edge binding along the top and bottom rails.
  //
  // These were straight BoxGeometry bars translated to z = +curve*0.55. The
  // board is an ARC sweeping z from -curve at the centre out toward 0 at the
  // rims, so the rails sat entirely off the front of the shield and, being
  // straight across a curved face, splayed at both ends. In game they read as
  // loose planks floating beside the scutum.
  //
  // They now sweep the SAME arc the staves do, so they meet the board by
  // construction — the identical fix the staves themselves already got.
  const railH = 0.032, railT = 0.05;
  for (const sy of [-1, 1]) {
    const rp = [], rn = [];
    const y0 = sy * (h / 2 - 0.012) - railH / 2;
    const y1 = y0 + railH;
    for (let i = 0; i < N; i++) {
      const t0 = -half + (2 * half * i) / N;
      const t1 = -half + (2 * half * (i + 1)) / N;
      const [x0, z0] = at(t0);
      const [x1, z1] = at(t1);
      const nx = Math.sin((t0 + t1) / 2);
      const nz = -Math.cos((t0 + t1) / 2);
      // Proud of the board by railT along the local surface normal.
      const ox = nx * railT, oz = nz * railT;
      // outer face
      quadTri(rp, rn, [x0 + ox, y0, z0 + oz], [x1 + ox, y0, z1 + oz], [x1 + ox, y1, z1 + oz], [x0 + ox, y1, z0 + oz], [nx, 0, nz]);
      // top and bottom caps back to the board
      quadTri(rp, rn, [x0, y1, z0], [x1, y1, z1], [x1 + ox, y1, z1 + oz], [x0 + ox, y1, z0 + oz], [0, sy, 0]);
      quadTri(rp, rn, [x0 + ox, y0, z0 + oz], [x1 + ox, y0, z1 + oz], [x1, y0, z1], [x0, y0, z0], [0, -sy, 0]);
    }
    const rail = new THREE.BufferGeometry();
    rail.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
    rail.setAttribute("normal", new THREE.Float32BufferAttribute(rn, 3));
    parts.push(paint(rail, BRASS));
  }

  return weld(parts);
}

/** Two triangles for a quad, with a flat normal. */
function quadTri(pos, nor, a, b, c, d, n) {
  pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < 6; i++) nor.push(...n);
}

/** A trident for the retiarius. One draw call. */
export function makeTrident() {
  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.019, 0.022, 1.75, 8);
  shaft.translate(0, 0.875, 0);
  parts.push(paint(shaft, WOOD));

  const head = new THREE.BoxGeometry(0.19, 0.04, 0.03);
  head.translate(0, 1.76, 0);
  parts.push(paint(head, STEEL));

  for (const dx of [-0.075, 0, 0.075]) {
    const p = new THREE.ConeGeometry(0.017, 0.26, 6);
    p.translate(dx, 1.9, 0);
    parts.push(paint(p, STEEL));
  }
  return weld(parts);
}
