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

// Scratch objects for _spineFlex, which runs per actor per frame. Allocating
// these inside the loop would put six THREE objects per fighter per frame on
// the GC in the middle of combat.
const DEG = Math.PI / 180;
const _sfA = new THREE.Vector3();
const _sfB = new THREE.Vector3();
const _sfLean = new THREE.Vector3();
const _sfAxis = new THREE.Vector3();
const _sfUp = new THREE.Vector3(0, 1, 0);
const _sfQ = new THREE.Quaternion();
const _sfPQ = new THREE.Quaternion();
const _sfM = new THREE.Quaternion();

// Scratch for twoBoneIK / the guard pose, same reason.
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const _ikT = new THREE.Vector3();
const _ikU = new THREE.Vector3();
const _ikV = new THREE.Vector3();
const _ikN = new THREE.Vector3();
const _ikGoal = new THREE.Vector3();
const _ikQ = new THREE.Quaternion();
const _ikQA = new THREE.Quaternion();
const _ikQB = new THREE.Quaternion();
const _ikPQ = new THREE.Quaternion();
const _ikM = new THREE.Quaternion();
const _ikMat = new THREE.Matrix4();

// Character GLBs are Draco-compressed (gltf-transform optimize), which cuts a
// rigged gladiator from ~7.9 MB to ~165 KB. Draco needs its decoder wired in or
// GLTFLoader throws "No DRACOLoader instance provided" and every character
// silently fails to load — so it is configured ONCE here, for every consumer.
// The decoder is fetched from the same CDN and version as the three importmap.
const loader = new GLTFLoader();
const draco = new DRACOLoader();
// SELF-HOSTED (was the jsdelivr CDN): a CDN outage or block used to take
// every character in the game down with it. Mirrored at the same version.
draco.setDecoderPath("assets/vendor/three/examples/jsm/libs/draco/");
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
 * Rotate a bone by a WORLD-space rotation, preserving its parent chain.
 *
 * A bone's stored quaternion is relative to its parent, so a world rotation Q
 * becomes  local = inv(parentWorld) * Q * parentWorld * local.
 */
function rotateBoneWorld(bone, q) {
  bone.parent.getWorldQuaternion(_ikPQ);
  bone.quaternion.premultiply(_ikM.copy(_ikPQ).invert().multiply(q).multiply(_ikPQ));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: swing `upper` and bend `fore` so `hand` reaches a world target.
 *
 * These rigs ship no IK of any kind, which is why a shield tracks wherever the
 * shared idle clip happens to leave the hand instead of being held where a
 * shield is useful. Standard law-of-cosines solve: set the elbow's interior
 * angle from the target distance, then swing the whole arm onto the target.
 *
 * `weight` blends the solved pose against the animated one, so an attack can
 * take the arm back without a snap.
 */
function twoBoneIK(upper, fore, hand, target, weight) {
  if (weight <= 0.001) return;
  const upQ0 = _ikQA.copy(upper.quaternion);
  const foQ0 = _ikQB.copy(fore.quaternion);

  const A = _ikA.setFromMatrixPosition(upper.matrixWorld);
  const B = _ikB.setFromMatrixPosition(fore.matrixWorld);
  const C = _ikC.setFromMatrixPosition(hand.matrixWorld);

  const L1 = A.distanceTo(B), L2 = B.distanceTo(C);
  if (L1 < 1e-5 || L2 < 1e-5) return;

  const toT = _ikT.copy(target).sub(A);
  // Never let the target exceed reach, or the solve produces a NaN angle and
  // the arm detaches entirely.
  const d = clamp(toT.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);

  // --- elbow: law of cosines gives the interior angle at B for distance d ---
  const cosDes = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
  const u = _ikU.copy(A).sub(B).normalize();          // B -> A
  const v = _ikV.copy(C).sub(B).normalize();          // B -> C
  const cosCur = clamp(u.dot(v), -1, 1);
  // Rotating v about cross(v, u) by a POSITIVE angle swings v toward u, i.e.
  // closes the elbow — so the delta is current-minus-desired, not the reverse.
  const bend = _ikN.copy(v).cross(u);
  if (bend.lengthSq() > 1e-10) {
    bend.normalize();
    rotateBoneWorld(fore, _ikQ.setFromAxisAngle(bend, Math.acos(cosCur) - Math.acos(cosDes)));
  }

  // --- shoulder: swing the (now correctly bent) arm onto the target ---
  C.setFromMatrixPosition(hand.matrixWorld);
  const cur = _ikU.copy(C).sub(A);
  const want = _ikV.copy(target).sub(A);
  if (cur.lengthSq() > 1e-10 && want.lengthSq() > 1e-10) {
    cur.normalize(); want.normalize();
    const axis = _ikN.copy(cur).cross(want);
    if (axis.lengthSq() > 1e-10) {
      rotateBoneWorld(upper, _ikQ.setFromAxisAngle(
        axis.normalize(), Math.acos(clamp(cur.dot(want), -1, 1))
      ));
    }
  }

  if (weight < 0.999) {
    // BLEND TOWARD THE ORIGINAL, NOT slerpQuaternions(orig, this, w).
    //
    // three implements slerpQuaternions(qa, qb, t) as `this.copy(qa).slerp(qb, t)`.
    // Passing the bone's own quaternion as qb aliases it with `this`, so
    // copy(qa) overwrites qb BEFORE the slerp reads it and the result is
    // slerp(qa, qa, t) = qa — the animated pose, with the entire IK solve
    // silently thrown away. _guardW only equals 1 on the very first frame; it
    // decays during every attack and then climbs back asymptotically, so this
    // discarded the guard pose on the overwhelming majority of combat frames.
    //
    // slerp(solved -> original, 1 - weight) is the same interpolation with no
    // aliasing: upQ0/foQ0 are module scratch, distinct from the bone's own.
    upper.quaternion.slerp(upQ0, 1 - weight);
    fore.quaternion.slerp(foQ0, 1 - weight);
    upper.updateMatrixWorld(true);
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
  // Authored 2026-07-27 in Blender (tools/author_clips.py) — the first clips
  // designed for their verb rather than reused slashes.
  "thrust", "cleave",
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
  /**
   * How far the CURRENT pose is from a clip's first frame, in summed radians
   * over the quaternion tracks. A quaternion track's values[0..3] IS its t=0
   * key, so this reads straight off the data with no mixer sampling.
   *
   * This is what adaptive crossfades scale on: the audit measured 0.22-0.89 m
   * of per-bone displacement being covered by fixed 40-120 ms fades on every
   * attack, hit and death — limbs teleporting at 3-5 m/s. A fade should take
   * the time the pose gap needs, not the time the call site guessed.
   */
  _poseDistance(name) {
    const a = this.actions[name];
    if (!a) return 0;
    const clip = a.getClip();
    // AnimationClip carries no userData in this three build; cache per-actor.
    this._t0Cache = this._t0Cache || new Map();
    let t0 = this._t0Cache.get(name);
    if (!t0) {
      t0 = [];
      this._t0Cache.set(name, t0);
      for (const tr of clip.tracks) {
        const m = /^(.*)\.quaternion$/.exec(tr.name);
        if (!m) continue;
        let bone = null;
        this.model.traverse((o) => { if (!bone && o.isBone && o.name === m[1]) bone = o; });
        if (bone) t0.push({ bone, q: new THREE.Quaternion(tr.values[0], tr.values[1], tr.values[2], tr.values[3]) });
      }
    }
    let dist = 0;
    for (const { bone, q } of t0) dist += bone.quaternion.angleTo(q);
    return dist;
  }

  /** Fade long enough for the pose gap: ~60 ms floor, 20 ms per radian, 280 ms cap. */
  _adaptiveFade(name, requested) {
    return clamp(Math.max(requested, 0.06 + this._poseDistance(name) * 0.02), 0.05, 0.28);
  }

  play(logical, { fade = 0.18, timeScale = 1 } = {}) {
    const name = this._resolve(logical);
    if (!name || name === this.currentName) {
      if (name && this.current) this.current.timeScale = timeScale;
      return false;
    }
    const next = this.actions[name];
    const f = this._adaptiveFade(name, fade);
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.timeScale = timeScale;
    next.fadeIn(f);
    if (this.current) this.current.fadeOut(f);
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
    const f = this._adaptiveFade(name, fade);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    a.fadeIn(f);
    if (this.current && this.current !== a) this.current.fadeOut(f);
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
      // locoDir: +1 forward, -1 backpedal (the view sets it from velocity vs
      // facing). The clamp is magnitude-only, so without the sign carried here
      // it would overwrite a reversed cycle back to forward every frame.
      this.current.timeScale = (this.locoDir || 1) * clamp(groundSpeed / nominal, 0.35, 2.2);
    }
    this.mixer.update(dt);
    this._spineFlex();

    // Turning is damped so a fighter pivots with weight instead of snapping.
    this.visualFacing = dampAngle(this.visualFacing, this.facing, 12, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.visualFacing;

    this._guardPose(dt);
    // THE SWORD POSE IS NOT THE SHIELD'S PASSENGER. _swordGuard used to be
    // called from the last line of _guardPose, which returns early for anyone
    // WITHOUT a shield — so every shieldless fighter (the t1 rudis bout, the
    // retiarius, the dimachaerus) never had his blade posed at all and the
    // weapon hung wherever the idle clip left the hand. Player-reported as
    // "weapons are being held wrong"; it is its own limb, so it gets its own
    // call.
    this._swordGuard(dt);
    // Body armour is world-oriented by definition, so it is re-solved every
    // frame rather than inheriting the pelvis. Runs after root.rotation.y is
    // set, because the solve reads the body's forward off the root.
    if (this.equipment && this.equipment.refresh) this.equipment.refresh();
    this._combatIdle(dt, groundSpeed);
  }

  /**
   * Hold the shield where a shield is actually useful.
   *
   * Nothing in the shared clip vocabulary is a guard stance, so the shield arm
   * simply went wherever anim_idle left it — measured in the running game with
   * the fighter at the origin, the scutum's 0.66 m board spanned x 0.06 to 0.72
   * while the torso sits at x ~= 0. It covered NONE of the body: a shield held
   * out to one side at arm's length, which is what "not held properly" looks
   * like from the front.
   *
   * Rather than author eight guard clips, drive the shield arm with IK to a
   * target in the fighter's own frame — slightly across the centreline, chest
   * height, forward of the chest — so the board covers shoulder to thigh. The
   * target is in ROOT space, so it follows facing for free.
   *
   * Fades out during attacks so a swing still throws the arm, and fades back in
   * over ~0.18 s rather than snapping.
   */
  _guardPose(dt) {
    const arm = this._shieldArm !== undefined ? this._shieldArm : (this._shieldArm = (() => {
      // EVERY fighter's off hand gets posed, shield or no shield.
      //
      // This used to bail unless a shield mount existed, and the consequence
      // was the single worst-looking thing in the game: with no shield NOTHING
      // drove the left arm, so it sat wherever the Meshy idle clip left it —
      // straight out to the side, palm splayed. Reported as "our character
      // seems completely broken" and "sometimes gets stuck in a T pose while
      // fighting", and reproduced exactly by unequipping the scutum. A
      // shieldless man does not hold his arm out; he carries it in, close to
      // the ribs, ready to grab or fend. Same two-bone solve, different goal.
      const find = (n) => { let b = null; this.model.traverse((o) => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
      const upper = find("LeftArm"), fore = find("LeftForeArm"), hand = find("LeftHand");
      if (!upper || !fore || !hand) return null;
      let mount = null;
      this.model.traverse((o) => {
        if (!mount && o.name === "weapon_mount" && o.parent && /^LeftHand$/i.test(o.parent.name)) mount = o;
      });
      return { upper, fore, hand, mount };      // mount may be null — free hand
    })());
    if (!arm) return;

    const ATTACK = { slash1: 1, slash2: 1, finisher: 1, stab: 1, cleave: 1, death: 1, hit: 1 };
    const want = ATTACK[this.currentName] ? 0 : 1;
    const k = clamp(dt / 0.18, 0, 1);
    this._guardW = (this._guardW === undefined ? want : this._guardW + (want - this._guardW) * k);
    if (this._guardW <= 0.01) return;

    // Fighter frame: +Z forward, +X his left (verified against the sim, which
    // defines facing = atan2(dx, dz)).
    //
    // THE GUARD LINE IS VISIBLE (audit #11: "no opponent guard stance is
    // ever displayed"): the shield target shifts with blockDir — raised for
    // a high guard, swung wide for the flank lines, dropped and forward
    // against the thrust — so reading WHERE a guard sits (and aiming around
    // it, or feinting it out of line) is played on the body, not the HUD.
    // bout.js feeds actor.blockDir from the sim each frame.
    const gd = this.blockDir;
    if (!arm.mount) {
      // FREE HAND: tucked in at the ribs, elbow down, slightly forward — the
      // off-hand carry of a man with no board to hide behind. Raising it a
      // little when he guards reads as fending with the forearm.
      if (gd) _ikGoal.set(0.24, 1.22, 0.26);
      else _ikGoal.set(0.21, 1.02, 0.16);
    }
    else if (gd === "high") _ikGoal.set(0.06, 1.42, 0.30);
    else if (gd === "left") _ikGoal.set(0.34, 1.14, 0.30);
    else if (gd === "right") _ikGoal.set(-0.16, 1.10, 0.32);
    else if (gd === "thrust") _ikGoal.set(0.10, 0.98, 0.40);
    else _ikGoal.set(0.14, 1.16, 0.34);
    this.root.localToWorld(_ikGoal);
    twoBoneIK(arm.upper, arm.fore, arm.hand, _ikGoal, this._guardW);

    // Stand the shield UP. Putting the hand in the right place is not enough:
    // the mount inherits the hand bone's roll, which in the shared idle clip
    // left the scutum canted about 25 degrees like a dropped door. Solve the
    // board's world orientation — face along the fighter's forward, long axis
    // vertical, with a slight inward cant so it reads as braced rather than
    // parade-flat — then express it in the hand's frame.
    if (arm.mount) {
      arm.hand.updateWorldMatrix(true, false);
      arm.hand.matrixWorld.decompose(_ikA, _ikPQ, _ikB);
      const fwd = _ikU.set(Math.sin(this.visualFacing), 0, Math.cos(this.visualFacing));
      _ikMat.lookAt(_ikV.set(0, 0, 0), _ikN.copy(fwd).negate(), _sfUp);
      _ikQ.setFromRotationMatrix(_ikMat);
      // 10 deg top-inward cant, about the fighter's forward axis.
      _ikQ.multiply(_ikQA.setFromAxisAngle(_ikV.set(0, 0, 1), -10 * DEG));
      arm.mount.quaternion.slerp(_ikQB.copy(_ikPQ).invert().multiply(_ikQ), this._guardW);
    }
  }

  /**
   * Hold the SWORD like a weapon, not like a torch.
   *
   * The sword mount never had any orientation solve — attachWeapon only
   * branches on align:"shield", every sword call site passes only `palm`, so
   * the blade inherited the RightHand bone's raw Meshy roll verbatim. Measured
   * at the attach pose: the blade sat at elevation +39.5 deg on ALL EIGHT
   * archetypes, a straight continuation of the forearm line — which is the
   * "sword not held properly" silhouette.
   *
   * A STATIC rotation cannot fix it: swept, every fixed angle that levels the
   * guard pushes slash2's strike frame outside the sim's own hit cone (tx=+30
   * levels the guard at elev +13 but sends the strike to bearing -62 vs the
   * cone's +/-35.5). So the solve fades exactly like the shield's: at guard the
   * blade is held up-forward at ready; during attack clips the animation owns
   * the arm entirely. `hit` deliberately stays POSED (unlike the shield's set)
   * — releasing on every flinch made the sword flail through 56% of landed
   * hits, since most hits do not interrupt the guard.
   */
  _swordGuard(dt) {
    const sw = this._swordMount !== undefined ? this._swordMount : (this._swordMount = (() => {
      let mount = null, hand = null;
      this.model.traverse((o) => {
        if (!mount && o.name === "weapon_mount" && o.parent && /^RightHand$/i.test(o.parent.name)) {
          mount = o; hand = o.parent;
        }
      });
      return mount ? { mount, hand } : null;
    })());
    if (!sw) return;

    const RELEASE = { slash1: 1, slash2: 1, finisher: 1, stab: 1, cleave: 1, death: 1 };
    const want = RELEASE[this.currentName] ? 0 : 1;
    const k = clamp(dt / 0.18, 0, 1);
    this._swordW = (this._swordW === undefined ? want : this._swordW + (want - this._swordW) * k);
    if (this._swordW <= 0.01) return;

    sw.hand.updateWorldMatrix(true, false);
    sw.hand.matrixWorld.decompose(_ikA, _ikPQ, _ikB);
    // At guard the blade points UP and slightly forward — the high ready of a
    // sword-and-shield fighter: ~24 deg forward of vertical, in the fighter's
    // own frame so it follows facing.
    const s = Math.sin(this.visualFacing), c = Math.cos(this.visualFacing);
    _ikU.set(s * 0.41, 0.91, c * 0.41).normalize();           // blade axis (+Y of the mesh)
    _ikV.set(s, 0, c);                                        // edge toward the enemy
    // Full basis: +Y along the blade axis, +Z as near the facing as possible.
    _ikN.copy(_ikV).addScaledVector(_ikU, -_ikV.dot(_ikU)).normalize();
    _ikT.crossVectors(_ikU, _ikN);
    _ikQ.setFromRotationMatrix(_ikMat.makeBasis(_ikT, _ikU, _ikN));
    sw.mount.quaternion.slerp(_ikQB.copy(_ikPQ).invert().multiply(_ikQ), this._swordW);
  }

  /**
   * Cap how far the trunk pitches forward. This is why gladiators looked like
   * they were folding in half to reach rather than swinging.
   *
   * MEASURED IN THE RUNNING GAME, world angle of hips->neck away from vertical,
   * sampled every frame across a full clip:
   *
   *     idle      4.4 -> 16.0 deg, settles ~15.3
   *     slash1   22.7 -> 46.8 deg peak, holds 45-46 for ~20 frames
   *     slash2   23.5 -> 48.8 deg peak, holds 47-48.5 for the WHOLE clip
   *
   * A swordsman's trunk lean is ~5-10 deg on guard and 20-30 deg at the
   * extreme of a lunge. Forty-eight degrees held flat across an entire swing is
   * a man falling over. slash2 never recovers — it starts bent and stays bent,
   * so there is no pitch-into-the-blow at all.
   *
   * Two earlier Blender measurements of these same clips disagreed with each
   * other (19.0/19.5 deg) and with the research pass (23.2/36.0 deg), and BOTH
   * disagree with the 46.8/48.8 the renderer actually produces. Blender is
   * Z-up, the export is Y-up, and an armature-space angle is not the angle the
   * camera sees; a correction baked to a Blender-space target would not land on
   * the runtime target. So the correction is applied HERE, in the space where
   * the defect is visible and where the same probe can verify it — and it
   * covers all 8 archetypes and every clip at once, including any clip added
   * later, rather than re-baking 24 animation files.
   *
   * Only ever REDUCES pitch, never adds it, so a clip already inside the human
   * band is untouched.
   */
  _spineFlex() {
    const chain = this._spineChain || (this._spineChain = (() => {
      // The rig is REVERSE-NAMED: Hips -> Spine02 -> Spine01 -> Spine -> neck.
      // Spine02 is the LOWEST spine joint. Weighting the bend toward it makes
      // the correction read as a hip hinge instead of a chest hunch — the
      // chest-heavy split is what made it look like folding rather than leaning.
      const want = [["Spine02", 0.45], ["Spine01", 0.33], ["Spine", 0.22]];
      const found = [];
      for (const [name, w] of want) {
        let b = null;
        this.model.traverse((o) => { if (!b && o.isBone && o.name === name) b = o; });
        if (b) found.push({ bone: b, w });
      }
      let hips = null, neck = null, head = null;
      this.model.traverse((o) => {
        if (!o.isBone) return;
        if (!hips && /^Hips$/i.test(o.name)) hips = o;
        if (!neck && /^neck$/i.test(o.name)) neck = o;
        if (!head && /^Head$/i.test(o.name)) head = o;
      });
      return (found.length && hips && neck) ? { spine: found, hips, neck, head } : null;
    })());
    if (!chain) return;

    const A = _sfA, B = _sfB, lean = _sfLean, axis = _sfAxis, q = _sfQ, pq = _sfPQ;
    this.model.updateMatrixWorld(true);
    A.setFromMatrixPosition(chain.hips.matrixWorld);
    B.setFromMatrixPosition(chain.neck.matrixWorld);
    lean.subVectors(B, A);
    if (lean.lengthSq() < 1e-8) return;
    lean.normalize();

    const tilt = Math.acos(clamp(lean.y, -1, 1));          // radians from world up
    const target = this._spineTarget();
    if (tilt <= target + 0.005) return;                     // already human
    const delta = tilt - target;

    // Axis that rotates the lean back toward vertical: cross(leanDir, up).
    axis.set(lean.x, 0, lean.z);
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize().cross(_sfUp).normalize();

    for (const { bone, w } of chain.spine) {
      q.setFromAxisAngle(axis, delta * w);
      bone.parent.getWorldQuaternion(pq);
      // Apply a WORLD rotation to a bone: local = inv(parentWorld) * Q * world
      bone.quaternion.premultiply(_sfM.copy(pq).invert().multiply(q).multiply(pq));
      bone.updateMatrixWorld(true);
    }
    // Bring the head back part-way so straightening the trunk does not leave
    // the fighter staring at the sky.
    if (chain.head) {
      q.setFromAxisAngle(axis, -delta * 0.55);
      chain.head.parent.getWorldQuaternion(pq);
      chain.head.quaternion.premultiply(_sfM.copy(pq).invert().multiply(q).multiply(pq));
      chain.head.updateMatrixWorld(true);
    }
  }

  /**
   * Target trunk pitch in radians for whatever is playing right now.
   *
   * A real swing pitches INTO the blow and recovers; it does not begin folded
   * and stay there. Keyed on normalised clip time so the shape survives the
   * per-weapon timeScale that STRIKE_FRAC applies.
   */
  _spineTarget() {
    const name = this.currentName || "idle";
    const ATTACK = { slash1: 1, slash2: 1, finisher: 1, stab: 1, cleave: 1 };
    if (!ATTACK[name]) return 12 * DEG;      // guard, walk, run, parry, hit
    let u = 0;
    if (this.current && this.current.getClip) {
      const d = this.current.getClip().duration || 1;
      u = clamp((this.current.time || 0) / d, 0, 1);
    }
    // deg: ease in low, pitch through the strike, peak on follow-through, recover
    const curve = [[0, 8], [0.22, 6], [0.40, 18], [0.55, 22], [0.80, 14], [1, 9]];
    for (let i = 1; i < curve.length; i++) {
      if (u <= curve[i][0]) {
        const [t0, v0] = curve[i - 1], [t1, v1] = curve[i];
        return (v0 + (v1 - v0) * ((u - t0) / Math.max(1e-6, t1 - t0))) * DEG;
      }
    }
    return curve[curve.length - 1][1] * DEG;
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
  // INVALIDATE THE POSE MEMOS. _guardPose and _swordGuard cache the resolved
  // {bones, mount} on first use, and syncHeldGear destroys and rebuilds every
  // weapon_mount when the loadout changes — after which the cached mount is a
  // detached Group and the per-frame orientation solve writes into an orphan
  // while the visible weapon keeps only its attach-time pose. Clearing here,
  // at the single place mounts are created, covers every present and future
  // call site.
  if (actor) { actor._shieldArm = undefined; actor._swordMount = undefined; }
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

  // Leaf blade — swells then points. Sized to the historical article: a
  // gladius ran 65-85 cm overall with a 45-68 cm blade (Pompeii/Mainz types).
  // This one is 0.55 m of blade over a 0.13 m grip-and-guard = 0.68 m overall,
  // against a 1.8 m body. The previous 0.46 m blade read like a long knife.
  const b1 = new THREE.CylinderGeometry(0.028, 0.021, 0.36, 6);
  b1.scale(1, 1, 0.34);
  b1.translate(0, 0.31, 0);
  parts.push(paint(b1, STEEL));

  const b2 = new THREE.ConeGeometry(0.028, 0.19, 6);
  b2.scale(1, 1, 0.34);
  b2.translate(0, 0.585, 0);
  parts.push(paint(b2, STEEL));

  return weld(parts);
}

/**
 * Make every triangle's winding agree with the normal it declares.
 *
 * These swept surfaces are built by pushing explicit positions and explicit
 * normals, so "the normal is right, the winding must follow" is well defined —
 * and it is the only part of the pair that is easy to get wrong. Flipping the
 * sign of the scutum's z sweep reversed the handedness of the (x, z) pair and
 * left 32 of 270 triangles wound against their own normals; with the material
 * on FrontSide those strips were culled, so the board showed gaps.
 *
 * Repairing it by construction beats hand-auditing eight quad literals for
 * handedness every time a sign changes — which I did twice, wrongly, before
 * writing this.
 *
 * Operates on a non-indexed position/normal pair, which is what quadTri emits.
 */
function fixWinding(pos, nor) {
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nor[i] + cy * nor[i + 1] + cz * nor[i + 2] >= 0) continue;
    // Swap vertices 1 and 2 — reverses winding, leaves the normals alone.
    for (let k = 0; k < 3; k++) {
      const a = i + 3 + k, b = i + 6 + k;
      const t = pos[a]; pos[a] = pos[b]; pos[b] = t;
      const s = nor[a]; nor[a] = nor[b]; nor[b] = s;
    }
  }
}

/**
 * A scutum: the big curved rectangular shield. One draw call.
 *
 * Built as a ring-segment sweep rather than N independent rotated boxes. The
 * box-per-stave version left visible wedge gaps between planks (they rotate
 * about their own centres, so adjacent edges splay apart) and read as a
 * venetian blind. Sweeping a continuous strip guarantees the staves meet.
 *
 * Local frame: the shield face is centred on the origin in XY and bulges along
 * +z, which attachWeapon presents along the bearer's forward.
 *
 * THE BOARD USED TO BULGE THE OTHER WAY, and that is the "shield is backwards"
 * everyone could see. Measured in the running game with the fighter at the
 * origin: the shield mount sits at x +0.291 and the sword at x -0.542, and the
 * sim defines facing = atan2(dx, dz) — verified against a live match where the
 * player faced 1.571 with the opponent at dx +27 / dz -4.5 — so forward is
 * world +Z. The board's bounding box ran z -0.21 .. 0 (apex at -curve, rims at
 * 0), i.e. the CONVEX face pointed at the bearer's own back and the enemy was
 * shown the hollow. The umbo, at z +0.172, then floated in the middle of that
 * hollow instead of capping the boss.
 *
 * Flipping the sweep fixes both at once, which is the tell that the sign was
 * always the bug: the apex moves to +curve (0.16), the umbo at +0.172 lands
 * just proud of it, the shell's back face at z-thick falls behind the front
 * toward the bearer, and the rails' outward offset follows the same normal.
 */
export function makeScutum({ w = 0.66, h = 1.02, curve = 0.16 } = {}) {
  const parts = [];
  const N = 8;                        // stave count
  const R = (w * w / 4 + curve * curve) / (2 * curve);   // radius through the chord
  const half = Math.asin(clamp(w / 2 / R, -1, 1));

  const pos = [];
  const nor = [];
  const at = (t) => [R * Math.sin(t), R * Math.cos(t) - (R - curve)];

  const thick = 0.028;
  for (let i = 0; i < N; i++) {
    const t0 = -half + (2 * half * i) / N;
    const t1 = -half + (2 * half * (i + 1)) / N;
    const [x0, z0] = at(t0);
    const [x1, z1] = at(t1);
    const nx = Math.sin((t0 + t1) / 2);
    const nz = Math.cos((t0 + t1) / 2);   // outward: the board bulges toward +z
    // Front and back faces, wound to MATCH their declared normals.
    //
    // Flipping the sweep's z sign (above) also flipped the handedness of the
    // (x, z) pair, so these two quads' winding no longer agreed with the normals
    // they declare. Measured on the built mesh: 32 of 270 triangles inverted —
    // exactly 8 staves x 2 quads x 2 triangles — and the material is FrontSide,
    // so the enemy-facing surface of the board was being culled. The top and
    // bottom edge quads are unaffected because their order is driven by +/-h/2,
    // not by z, which is why the count came out at precisely these two.
    // front face
    quadTri(pos, nor, [x0, -h / 2, z0], [x1, -h / 2, z1], [x1, h / 2, z1], [x0, h / 2, z0], [nx, 0, nz]);
    // back face
    quadTri(pos, nor, [x0, h / 2, z0 - thick], [x1, h / 2, z1 - thick], [x1, -h / 2, z1 - thick], [x0, -h / 2, z0 - thick], [-nx, 0, -nz]);
    // top + bottom edges
    quadTri(pos, nor, [x0, h / 2, z0], [x1, h / 2, z1], [x1, h / 2, z1 - thick], [x0, h / 2, z0 - thick], [0, 1, 0]);
    quadTri(pos, nor, [x0, -h / 2, z0 - thick], [x1, -h / 2, z1 - thick], [x1, -h / 2, z1], [x0, -h / 2, z0], [0, -1, 0]);
  }
  fixWinding(pos, nor);
  const board = new THREE.BufferGeometry();
  board.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  board.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  parts.push(paint(board, BOARD));

  // Umbo — the iron boss over the hand grip. SphereGeometry's cap apex is at
  // +Y, so it needs +90 deg about X to point along +z, out of the board's
  // convex face. At -90 the dome pointed straight into the board and the
  // scutum rendered with a bare face and a faint seam where the boss sank in.
  const boss = new THREE.SphereGeometry(0.088, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  boss.rotateX(Math.PI / 2);
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
      const nz = Math.cos((t0 + t1) / 2);   // outward: the board bulges toward +z
      // Proud of the board by railT along the local surface normal.
      const ox = nx * railT, oz = nz * railT;
      // outer face
      quadTri(rp, rn, [x0 + ox, y0, z0 + oz], [x1 + ox, y0, z1 + oz], [x1 + ox, y1, z1 + oz], [x0 + ox, y1, z0 + oz], [nx, 0, nz]);
      // top and bottom caps back to the board
      quadTri(rp, rn, [x0, y1, z0], [x1, y1, z1], [x1 + ox, y1, z1 + oz], [x0 + ox, y1, z0 + oz], [0, sy, 0]);
      quadTri(rp, rn, [x0 + ox, y0, z0 + oz], [x1 + ox, y0, z1 + oz], [x1, y0, z1], [x0, y0, z0], [0, -sy, 0]);
    }
    fixWinding(rp, rn);
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
/**
 * Contus — the jousting lance. Grip at the origin per the weapon contract;
 * ~2.6 m of tapered shaft ahead of the fist, ~0.5 m of counterweight behind,
 * with a vamplate cone guarding the hand. Couched, the point rides ~3.2 m out,
 * which is the sim's JOUST.lanceReach.
 */
export function makeLance() {
  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.016, 0.034, 3.1, 8);
  shaft.translate(0, 1.05, 0);            // spans -0.50 .. +2.60
  parts.push(paint(shaft, WOOD));
  const tip = new THREE.ConeGeometry(0.02, 0.18, 6);
  tip.translate(0, 2.69, 0);
  parts.push(paint(tip, STEEL));
  // vamplate: the flared hand guard
  const guard = new THREE.CylinderGeometry(0.11, 0.03, 0.16, 10, 1, true);
  guard.translate(0, 0.22, 0);
  parts.push(paint(guard, STEEL));
  const butt = new THREE.SphereGeometry(0.045, 8, 6);
  butt.translate(0, -0.5, 0);
  parts.push(paint(butt, BRASS));
  return weld(parts);
}

export function makeTrident() {
  const parts = [];
  // GRIP A THIRD UP THE HAFT, NOT AT THE BUTT. The module contract puts the
  // hand at the origin; this shaft used to span y 0..1.75 with prongs at 1.9,
  // which meant the retiarius held the extreme butt end and the full 2.03 m of
  // pole projected from his fist like a flag. A polearm is gripped where it
  // balances: shaft now spans -0.55..+1.20, prongs at ~1.35, so ~0.55 m of
  // haft trails behind the hand and the reach out front matches how the
  // weapon is actually carried and thrust.
  const shaft = new THREE.CylinderGeometry(0.019, 0.022, 1.75, 8);
  shaft.translate(0, 0.325, 0);
  parts.push(paint(shaft, WOOD));

  const head = new THREE.BoxGeometry(0.19, 0.04, 0.03);
  head.translate(0, 1.21, 0);
  parts.push(paint(head, STEEL));

  for (const dx of [-0.075, 0, 0.075]) {
    const p = new THREE.ConeGeometry(0.017, 0.26, 6);
    p.translate(dx, 1.35, 0);
    parts.push(paint(p, STEEL));
  }
  return weld(parts);
}
