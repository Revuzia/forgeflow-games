// Thronedrift — character/enemy model loading + Actor animation wrapper.
// Heroes are Meshy auto-rigged humanoids (base.glb + armature-only clips)
// retargeted by bone name. Recipe (proven in Dungeon Forge): strip baked
// .scale tracks (idle bakes Hips scale → model shrinks on walk) and strip
// Shoulder/Arm/Hand .position tracks (they raise shoulders → permanent shrug).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skClone } from "three/addons/utils/SkeletonUtils.js";

const loader = new GLTFLoader();
const CACHE = {};

function load(rel) {
  if (!CACHE[rel]) CACHE[rel] = new Promise((res, rej) => loader.load(`assets/${rel}`, res, undefined, rej));
  return CACHE[rel];
}

function cleanClip(clip, name) {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => !/\.scale$/.test(t.name) && !/(Shoulder|Arm|Hand)\.position$/.test(t.name));
  c.name = name;
  return c;
}

function prepScene(scene) {
  scene.traverse((o) => {
    if (o.isLight) { o.removeFromParent(); return; }  // GLB punctual lights tank fps
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
  });
  return scene;
}

// ---------- hero + enemy libraries ---------------------------------------

const HERO_CLIPS = {
  knight: ["slash1", "slash2", "finisher", "parry", "hit", "death"],
  barbarian: ["slash1", "slash2", "finisher", "hit", "death"],
  sorceress: ["melee", "cast1", "cast2", "hit", "death"],
  rogue: ["slash1", "slash2", "finisher", "hit", "death"],
};

export async function loadHeroes(names, onProgress) {
  const out = {};
  let done = 0;
  await Promise.all(names.map(async (n) => {
    const base = await load(`chars/meshy/${n}/base.glb`);
    const anims = [];
    const add = async (rel, name) => {
      const g = await load(rel).catch(() => null);
      if (g && g.animations && g.animations[0]) { anims.push(cleanClip(g.animations[0], name)); return true; }
      return false;
    };
    if (!(await add(`chars/meshy/${n}/anim_idle.glb`, "Idle")) && base.animations[0])
      anims.push(cleanClip(base.animations[0], "Idle"));
    await add(`chars/meshy/${n}/walk_arm.glb`, "Walk");
    await add(`chars/meshy/${n}/run_arm.glb`, "Run");
    await Promise.all((HERO_CLIPS[n] || []).map((cn) => add(`chars/meshy/${n}/anim_${cn}.glb`, "C_" + cn)));
    out[n] = { scene: prepScene(base.scene), animations: anims };
    onProgress && onProgress(++done / names.length);
  }));
  return out;
}

export async function loadEnemyModels(names, onProgress) {
  const out = {};
  let done = 0;
  await Promise.all(names.map(async (n) => {
    try {
      const g = await load(`enemies/${n}.glb`);
      out[n] = { scene: prepScene(g.scene), animations: g.animations || [] };
    } catch (e) { console.warn("[chars] enemy load failed:", n, e); }
    onProgress && onProgress(++done / names.length);
  }));
  return out;
}

// ---------- actor ----------------------------------------------------------

export class Actor {
  constructor(lib, { height = 1.7, tint = null } = {}) {
    this.root = new THREE.Group();                 // world transform lives here
    this.model = skClone(lib.scene);
    this.root.add(this.model);
    this.height = height;

    if (tint) this.model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color && o.material.color.lerp(new THREE.Color(tint), 0.22);
      }
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of lib.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this._oneShot = null;
    this.armBones = findArmBones(this.model);   // Meshy humanoids only; null for creatures
    this.relaxW = 0;

    // find generic locomotion clips for library enemies (clip names vary)
    if (!this.actions.Walk) {
      for (const clip of lib.animations) {
        const n = clip.name.toLowerCase();
        if (/walk|run|move|fly/.test(n) && !this.actions.Walk) this.actions.Walk = this.mixer.clipAction(clip);
        if (/idle|stand/.test(n) && !this.actions.Idle) this.actions.Idle = this.mixer.clipAction(clip);
        if (/attack|bite|punch|hit(?!_react)/.test(n) && !this.actions.C_attack) this.actions.C_attack = this.mixer.clipAction(clip);
      }
      if (!this.actions.Idle && lib.animations[0]) this.actions.Idle = this.mixer.clipAction(lib.animations[0]);
      if (!this.actions.Walk) this.actions.Walk = this.actions.Idle;
    }

    // --- normalize to target height, feet at y=0 -------------------------
    // Meshy/library skinned rigs: geometry bounds are bind-pose garbage and
    // Box3 ignores bone transforms — pose one frame, then measure from BONE
    // world positions (padded; bones carry no mesh volume). Static meshes
    // fall back to Box3. (Dungeon Forge poseRig recipe.)
    const probe = this.actions.Idle || Object.values(this.actions)[0];
    if (probe) { probe.play(); this.mixer.update(0.05); }
    this.model.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity, hasBones = false;
    const v = new THREE.Vector3();
    this.model.traverse((o) => {
      if (o.isBone) { hasBones = true; o.getWorldPosition(v); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
    });
    let srcH, groundY;
    if (hasBones) {
      srcH = Math.max(0.25, maxY - minY) * 1.25;
      groundY = Math.min(0, minY);
    } else {
      const box = new THREE.Box3().setFromObject(this.model);
      srcH = Math.max(0.2, box.max.y - box.min.y);
      groundY = box.min.y;
    }
    const s = height / srcH;
    this.model.scale.setScalar(s);
    this.model.position.y = -groundY * s;
    if (probe) probe.stop();
  }

  play(name, { fade = 0.12, timeScale = 1 } = {}) {
    const a = this.actions[name];
    if (!a || a === this.current) { if (a) a.timeScale = timeScale; return; }
    a.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  /** play a combat clip once, then resume locomotion; returns clip duration/timeScale */
  playOnce(name, { timeScale = 1, fade = 0.06 } = {}) {
    const a = this.actions[name];
    if (!a) return 0.4;
    a.reset().setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
    a.setEffectiveTimeScale(timeScale).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current && this.current !== a) this.current.fadeOut(fade);
    this._oneShot = a; this.current = a;
    return a.getClip().duration / timeScale;
  }

  update(dt) { this.mixer.update(dt); }

  /**
   * Per-frame arm relax + procedural gait swing (Dungeon Forge recipe).
   * Meshy auto-rigged every clip in an A-pose — idle/walk/run all fling the
   * arms outward, which reads as "broken". Pull the arms down EVERY frame,
   * fading to 0 while combat one-shots play so swing clips run unmodified.
   * Call AFTER mixer.update().
   */
  updateRelax(dt, target, moving, sprint) {
    if (!this.armBones) return;
    this.relaxW += (target - this.relaxW) * Math.min(1, dt * 12);
    if (this.relaxW <= 0.02) return;
    this.model.updateMatrixWorld(true);
    relaxArms(this.armBones, this.relaxW);
    if (moving) {
      this.gait = (this.gait || 0) + dt * (sprint ? 12.5 : 8.5);
      const sw = Math.sin(this.gait) * (sprint ? 0.6 : 0.42) * this.relaxW;
      this.root.getWorldQuaternion(_gq);
      _swingAxis.set(1, 0, 0).applyQuaternion(_gq); // world right-vector
      const b = this.armBones;
      b.rArm.rotateOnWorldAxis(_swingAxis, sw); b.rArm.updateMatrixWorld(true);
      b.lArm.rotateOnWorldAxis(_swingAxis, -sw); b.lArm.updateMatrixWorld(true);
      b.rFore.rotateOnWorldAxis(_swingAxis, sw * 0.35);
      b.lFore.rotateOnWorldAxis(_swingAxis, -sw * 0.35);
    }
  }

  _findBone(side, rx) {
    let bone = null;
    this.model.traverse((o) => { if (!bone && o.isBone && o.name.includes(side) && rx.test(o.name)) bone = o; });
    return bone;
  }

  /**
   * Grip a +Y-shafted weapon in the fist (DF _gripMount): place its grip point
   * at the hand, cancel the bone's TRUE world scale (Meshy armatures bind at
   * ~0.01 — countering only the model normalization leaves props ~100× small),
   * and orient the shaft along cfg.rest from the hand bone's real world basis,
   * computed at the posed idle stance so it follows every animation.
   */
  attachWeapon(mesh, side, cfg) {
    const bone = this._findBone(side, /Hand/) || this._findBone(side, /hand|wrist/i);
    if (!bone) { this.root.add(mesh); return null; }
    // snapshot the hand basis at the AUTHORED idle pose (settled mid-clip) —
    // the idle clip is what plays at rest, so the grip must be computed there.
    // (No relaxArms here: relax now only runs during walk/run.)
    if (this.actions.Idle) { this.actions.Idle.reset().play(); this.mixer.update(cfg.poseT ?? 0.35); }
    this.model.updateMatrixWorld(true);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const h = Math.max(0.001, box.max.y - box.min.y);
    mesh.position.y -= box.min.y + h * (cfg.gripFrac ?? 0.2);   // grip → holder origin
    if (cfg.roll) mesh.rotation.y = cfg.roll;                   // spin about the shaft (bow arc facing, edge alignment)
    const counter = boneCounterScale(bone);
    const holder = new THREE.Group();
    holder.scale.setScalar(counter * (cfg.scale || 1));
    // hand-bone origin = wrist joint; push the grip into the palm along the
    // bone's local axis (scaled back up into bone-local units)
    holder.position.y = (cfg.palm ?? 0.1) * counter;
    holder.add(mesh);
    bone.add(holder);
    this.model.updateMatrixWorld(true);
    bone.getWorldQuaternion(_gq);                                // hand world orientation
    _gv.fromArray(cfg.rest).normalize();                         // desired shaft dir
    _gq2.setFromUnitVectors(_gy, _gv);                           // +Y → rest (world)
    holder.quaternion.copy(_gq.invert().multiply(_gq2));         // → bone local
    return holder;
  }

  /** strap a shield to the left hand (counter-scaled holder, DF offsets) */
  attachShield(mesh) {
    const bone = this._findBone("Left", /Hand/) || this._findBone("Left", /hand|wrist/i);
    if (!bone) { this.root.add(mesh); return null; }
    const holder = new THREE.Group();
    holder.scale.setScalar(boneCounterScale(bone));
    mesh.position.set(0, 0.12, 0.03);
    holder.add(mesh);
    bone.add(holder);
    return holder;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}

// ---------- Meshy rig helpers (ported from Dungeon Forge assets.js) ---------

const _gq = new THREE.Quaternion(), _gq2 = new THREE.Quaternion();
const _gv = new THREE.Vector3(), _gy = new THREE.Vector3(0, 1, 0);
const _swingAxis = new THREE.Vector3();
const _rp1 = new THREE.Vector3(), _rp2 = new THREE.Vector3(), _rt = new THREE.Vector3();
const _rq1 = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rq3 = new THREE.Quaternion();

/** Cancel a bone's ACTUAL world scale (Meshy armatures bind bones at ~0.01). */
function boneCounterScale(bone) {
  bone.matrixWorld.decompose(_rp1, _rq1, _rt);
  return 1 / Math.max(1e-5, _rt.x);
}

/** Cache the six arm-chain bones (by Meshy rig name) for relaxArms(). */
export function findArmBones(root) {
  const b = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    switch (o.name) {
      case "RightArm": b.rArm = o; break;
      case "RightForeArm": b.rFore = o; break;
      case "RightHand": b.rHand = o; break;
      case "LeftArm": b.lArm = o; break;
      case "LeftForeArm": b.lFore = o; break;
      case "LeftHand": b.lHand = o; break;
    }
  });
  return (b.rArm && b.lArm) ? b : null;
}

function _relaxOne(arm, fore, tx, ty, tz, blend) {
  if (!arm || !fore) return;
  arm.getWorldPosition(_rp1); fore.getWorldPosition(_rp2);
  _rp2.sub(_rp1); if (_rp2.lengthSq() < 1e-8) return;
  _rp2.normalize(); _rt.set(tx, ty, tz).normalize();
  _rq1.setFromUnitVectors(_rp2, _rt);        // world-space correction (current → target dir)
  arm.getWorldQuaternion(_rq2);
  _rq1.multiply(_rq2);                        // new desired world quat
  arm.parent.getWorldQuaternion(_rq3);
  _rq3.invert().multiply(_rq1);               // → local space of the arm bone
  arm.quaternion.slerp(_rq3, blend);
  arm.updateMatrixWorld(true);
}

/** Force the arms to hang relaxed at the sides (amount 0..1 blends). */
export function relaxArms(b, amount) {
  if (!b) return;
  const a = amount == null ? 1 : Math.max(0, Math.min(1, amount));
  if (a <= 0) return;
  _relaxOne(b.rArm, b.rFore, -0.28, -1, 0.02, 0.92 * a);
  _relaxOne(b.lArm, b.lFore, 0.28, -1, 0.02, 0.92 * a);
  _relaxOne(b.rFore, b.rHand, -0.08, -1, 0.05, 0.85 * a);
  _relaxOne(b.lFore, b.lHand, 0.08, -1, 0.05, 0.85 * a);
}

// ---------- weapon props (thronedrift styling: crimson / steel / gold) -------

const steel = () => new THREE.MeshStandardMaterial({ color: 0xc8ccd8, metalness: 0.85, roughness: 0.3 });
const gold = () => new THREE.MeshStandardMaterial({ color: 0xe8b83a, metalness: 0.95, roughness: 0.25 });
const ember = () => new THREE.MeshStandardMaterial({ color: 0xff5a2a, emissive: 0xff3a10, emissiveIntensity: 1.6 });
const wood = () => new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.9 });

export function makeGreatblade() {
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 8), wood()); grip.position.y = 0.15;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.1), gold()); guard.position.y = 0.46;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.045), steel()); blade.position.y = 1.24;
  const edge = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.3, 4), steel()); edge.scale.z = 0.28; edge.position.y = 2.06; edge.rotation.y = Math.PI / 4;
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.055), ember()); core.position.y = 1.24;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), gold()); pommel.position.y = -0.14;
  g.add(grip, guard, blade, edge, core, pommel);
  return g;
}

export function makeSword() {
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.26, 8), wood()); grip.position.y = 0.08;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.07), gold()); guard.position.y = 0.24;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.95, 0.03), steel()); blade.position.y = 0.75;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.18, 4), steel()); tip.scale.z = 0.3; tip.position.y = 1.31; tip.rotation.y = Math.PI / 4;
  g.add(grip, guard, blade, tip);
  return g;
}

export function makeShield() {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 24),
    new THREE.MeshStandardMaterial({ color: 0x7a1f1a, metalness: 0.55, roughness: 0.45 }));
  face.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 28), gold());
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), gold()); boss.position.z = 0.05;
  const sig = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 6, 20), ember()); sig.position.z = 0.04;
  g.add(face, rim, boss, sig);
  g.rotation.y = Math.PI / 2;
  return g;
}

export function makeBow() {
  const g = new THREE.Group();
  const limb = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.024, 8, 24, Math.PI * 0.85), wood());
  limb.rotation.z = -Math.PI * 0.925;   // arc symmetric about the string (+Y)
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xf2e8c8 });
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.92, 4), stringMat);
  const tipA = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), gold()); tipA.position.y = 0.46;
  const tipB = tipA.clone(); tipB.position.y = -0.46;
  g.add(limb, str, tipA, tipB);
  return g;
}

/** real arrow (shaft + steel head + fletching), built along +Z for lookAt flight */
export function makeArrow(tint = 0xffc060) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6),
    new THREE.MeshBasicMaterial({ color: 0x8a5c30 }));
  shaft.rotation.x = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6),
    new THREE.MeshBasicMaterial({ color: 0xd8dce8 }));
  head.rotation.x = Math.PI / 2; head.position.z = 0.42;
  const fMat = new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.16), fMat);
    f.position.z = -0.3;
    f.rotation.z = (i / 3) * Math.PI * 2;
    f.rotation.x = 0.25;
    g.add(f);
  }
  g.add(shaft, head);
  return g;
}

/** spinning blade-trail ring for Whirlwind (additive arc sweep, spun by the sim) */
export function makeSpinTrail(color = 0xff5a3a) {
  const g = new THREE.Group();
  const mk = (rad, h, op) => {
    const geo = new THREE.CylinderGeometry(rad, rad, h, 40, 1, true, 0, Math.PI * 1.35);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: op, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  };
  const outer = mk(2.9, 0.5, 0.55); outer.position.y = 1.0;
  const inner = mk(2.1, 0.32, 0.35); inner.position.y = 1.15; inner.rotation.y = Math.PI * 0.8;
  const gold = mk(3.1, 0.14, 0.7); gold.material.color = new THREE.Color(0xffd24a); gold.position.y = 0.95;
  g.add(outer, inner, gold);
  return g;
}

/** one-shot crescent swipe arc (2H swings / sword strikes) — sim fades+sweeps it */
export function makeSwipeArc(color = 0xff5a3a, radius = 2.6, arc = 2.4) {
  const geo = new THREE.RingGeometry(radius * 0.45, radius, 28, 1, -arc / 2, arc);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function makeStaff() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 1.55, 8), wood()); pole.position.y = 0.5;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x9a5dff, emissive: 0x8a4dff, emissiveIntensity: 2.6 }));
  orb.position.y = 1.36;
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 20), gold()); cage.position.y = 1.36;
  const cage2 = cage.clone(); cage2.rotation.x = Math.PI / 2;
  g.add(pole, orb, cage, cage2);
  return g;
}
