/**
 * Dungeon Forge — runtime/3d/assets.js
 * GLB loading, caching, normalization and cloning. Kenney modular kits are
 * authored at exactly CELL=4 units so structure needs no rescale; creatures
 * and characters get normalized to a target height at load (their GLTF node
 * scales vary wildly). All embedded lights are stripped (FFG FPS rule) — the
 * game owns its lighting.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const REL = new URL("../../", import.meta.url).href; // game root

export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();       // url → Promise<{scene, animations}>
    this.onProgress = null;
    this._loaded = 0; this._total = 0;
  }

  load(rel) {
    const url = REL + "assets/" + rel;
    if (!this.cache.has(url)) {
      this._total++;
      this.cache.set(url, new Promise((res, rej) => {
        this.loader.load(url, (g) => {
          stripLights(g.scene);
          g.scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = false; o.receiveShadow = false;
              if (o.material) {
                o.material.side = THREE.FrontSide;
                if (o.material.map) o.material.map.anisotropy = 2;
              }
            }
          });
          this._loaded++;
          if (this.onProgress) this.onProgress(this._loaded, this._total);
          res({ scene: g.scene, animations: g.animations || [] });
        }, undefined, (e) => { console.warn("[assets] failed:", rel, e); rej(e); });
      }));
    }
    return this.cache.get(url);
  }

  /** Deep clone with skeleton support; returns fresh root. */
  clone(tpl) { return SkeletonUtils.clone(tpl.scene); }

  /** Uniformly scale obj so its bbox height equals h; ground it at y=0. */
  static normalizeH(obj, h) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const s = h / Math.max(0.0001, size.y);
    obj.scale.multiplyScalar(s);
    const box2 = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box2.min.y;
    return s;
  }

  /** Scale to a footprint (max of x/z) — for props sized to cell fractions. */
  static normalizeFoot(obj, w) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const s = w / Math.max(0.0001, Math.max(size.x, size.z));
    obj.scale.multiplyScalar(s);
    const box2 = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box2.min.y;
    return s;
  }

  // ── themed bundles ─────────────────────────────────────────────────────────

  kit(theme) {
    const t = theme === "scifi" ? "scifi" : "fantasy";
    return promiseMap({
      floor: this.load(`kits/${t}/template-floor.glb`),
      wall: this.load(`kits/${t}/template-wall.glb`),
      wallCorner: this.load(`kits/${t}/template-wall-corner.glb`),
      gate: this.load(`kits/${t}/gate.glb`),
      gateDoor: this.load(`kits/${t}/gate-door.glb`),
      gateLocked: this.load(`kits/${t}/gate-locked.glb`),
      stairs: this.load(`kits/${t}/stairs.glb`),
    });
  }

  props(theme) {
    const t = theme === "scifi" ? "scifi" : "fantasy";
    const names = t === "fantasy"
      ? ["torch", "wall-torch", "barrel", "crate", "bookshelf", "pillar", "coffin", "debris", "candles", "lantern", "chest", "spike-trap", "sword"]
      : ["crate", "terminal", "barrier", "cables", "turret", "blaster"];
    const m = {};
    for (const n of names) m[n] = this.load(`props/${t}/${n}.glb`);
    // shared
    m.chestShared = this.load("props/fantasy/chest.glb");
    m.spikeShared = this.load("props/fantasy/spike-trap.glb");
    return promiseMap(m);
  }

  async enemies(theme) {
    const t = theme === "scifi" ? "scifi" : "fantasy";
    const names = t === "fantasy"
      ? ["spider", "skeleton", "zombie", "ghost", "slime", "orc", "imp", "myconid", "cyclops", "demon",
         "bat", "skull", "wisp", "frog", "cactoro", "gargoyle", "ninja", "cthulhu", "brute", "yeti", "giant", "dragon"]
      : ["drone", "robot", "android", "turret", "mech", "blob", "warbot", "xeno", "alien",
         "xenosmall", "floater", "striker", "warframe", "xenobig"];
    const m = {};
    for (const n of names) m[n] = n === "turret"
      ? this.load("props/scifi/turret.glb")
      : this.load(`enemies/${t}/${n}.glb`);
    const out = await promiseMap(m);
    // original Meshy-generated enemies (rigged humanoids: textured base + walk/run
    // clips; no idle clip, so the renderer relaxes their arms while standing).
    const meshy = t === "fantasy" ? ["cultist", "ogre"] : ["cyborg", "sentinel"];
    await Promise.all(meshy.map(async (nm) => {
      try {
        const base = await this.load(`enemies/meshy/${nm}/base.glb`);
        const anims = [];
        for (const [rel, cn] of [["walk", "Walk"], ["run", "Run"]]) {
          const g = await this.load(`enemies/meshy/${nm}/${rel}.glb`).catch(() => null);
          if (g && g.animations && g.animations[0]) { const c = g.animations[0].clone(); c.name = cn; anims.push(c); }
        }
        out[nm] = { scene: base.scene, animations: anims, meshy: true };
      } catch (e) { console.warn("[assets] meshy enemy failed:", nm, e); }
    }));
    return out;
  }

  async chars() {
    // Meshy-generated dungeon party, auto-rigged (24-joint humanoid). Each
    // character = textured base + armature-only clips (walk/run from rigging,
    // combat set from the Meshy animation library) retargeted by bone name.
    const names = ["knight", "barbarian", "sorceress", "rogue"];
    const CLIPS = {
      knight: ["slash1", "slash2", "finisher", "parry", "hit", "death"],
      barbarian: ["slash1", "slash2", "finisher", "hit", "death"],
      sorceress: ["melee", "cast1", "cast2", "hit", "death"],
      rogue: ["slash1", "slash2", "finisher", "hit", "death"],
    };
    const out = {};
    await Promise.all(names.map(async (n) => {
      try {
        const base = await this.load(`chars/meshy/${n}/base.glb`);
        const anims = [];
        const addClip = async (rel, name, fallbackFirst) => {
          const g = await this.load(rel).catch(() => null);
          if (g && g.animations && g.animations[0]) { const c = g.animations[0].clone(); c.name = name; anims.push(c); return true; }
          return false;
        };
        // real generated idle (arms down) — falls back to the base bind clip only if missing
        const gotIdle = await addClip(`chars/meshy/${n}/anim_idle.glb`, "Idle");
        if (!gotIdle && base.animations && base.animations[0]) { const c = base.animations[0].clone(); c.name = "Idle"; anims.push(c); }
        await addClip(`chars/meshy/${n}/walk_arm.glb`, "Walk");
        await addClip(`chars/meshy/${n}/run_arm.glb`, "Run");
        await Promise.all((CLIPS[n] || []).map((cn) => addClip(`chars/meshy/${n}/anim_${cn}.glb`, "C_" + cn)));
        out[n] = { scene: base.scene, animations: anims };
      } catch (e) { console.warn("[assets] char failed:", n, e); }
    }));
    return out;
  }

/** Procedural class weapons — built once, cloned per actor. */
  static makeClassWeapon(cls) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd8, metalness: 0.85, roughness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85 });
    if (cls === "barbarian") {
      // two-handed war axe
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 8), wood);
      haft.position.y = 0.45;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.07, 20, 1, false, -Math.PI * 0.42, Math.PI * 0.84), metal);
      head.rotation.z = Math.PI / 2;
      head.position.set(0, 1.05, 0.13);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8), metal);
      spike.position.y = 1.3;
      g.add(haft, head, spike);
    } else if (cls === "sorceress") {
      // arcane staff with a glowing orb
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.55, 8), wood);
      pole.position.y = 0.5;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x9a6bff, emissive: 0x8f5aff, emissiveIntensity: 2.4 }));
      orb.position.y = 1.34;
      const cage = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 8, 20), metal);
      cage.position.y = 1.34;
      g.add(pole, orb, cage);
      g.userData.orb = orb;
    } else if (cls === "rogue") {
      // curved dagger
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.22, 8), wood);
      grip.position.y = 0.1;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.05), metal);
      guard.position.y = 0.23;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.5, 4), metal);
      blade.scale.z = 0.4;
      blade.position.y = 0.5;
      g.add(grip, guard, blade);
    }
    return g;
  }

  /** Knight round shield (left arm). */
  static makeShield() {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 22),
      new THREE.MeshStandardMaterial({ color: 0x3a4a6a, metalness: 0.6, roughness: 0.4 }));
    face.rotation.x = Math.PI / 2;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8c46a, metalness: 0.9, roughness: 0.25 }));
    boss.position.z = 0.05;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 8, 26),
      new THREE.MeshStandardMaterial({ color: 0xd8c46a, metalness: 0.9, roughness: 0.3 }));
    g.add(face, boss, rim);
    return g;
  }

  items() {
    return promiseMap({
      key: this.load("items/key-gold.glb"),
      coin: this.load("items/coin.glb"),
    });
  }
}

async function promiseMap(obj) {
  const out = {};
  const ks = Object.keys(obj);
  const vs = await Promise.all(ks.map((k) => obj[k].catch(() => null)));
  ks.forEach((k, i) => { if (vs[i]) out[k] = vs[i]; });
  return out;
}

/**
 * Skinned rigs (Poly Pizza / Quaternius) often bind-pose lying flat and only
 * stand upright once a clip plays — and Box3 ignores bone transforms entirely.
 * So: start the idle clip, advance one frame, then measure height from BONE
 * world positions (padded — bones carry no mesh volume). Returns the running
 * mixer so callers keep the pose alive.
 */
export function poseRig(obj, animations, THREE_) {
  const T = THREE_ || THREE;
  let mixer = null;
  if (animations && animations.length) {
    mixer = new T.AnimationMixer(obj);
    const clips = creatureClips(animations);
    const clip = clips.idle || animations[0];
    if (clip) { const a = mixer.clipAction(clip); a.play(); mixer.update(0.05); }
  }
  obj.updateMatrixWorld(true);
  let minY = Infinity, maxY = -Infinity, bones = false;
  const v = new T.Vector3();
  obj.traverse((o) => {
    if (o.isBone) { bones = true; o.getWorldPosition(v); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
  });
  let height = bones ? Math.max(0.25, (maxY - minY)) * 1.25 : null;
  if (!height) {
    const box = new T.Box3().setFromObject(obj);
    height = Math.max(0.2, box.max.y - box.min.y);
  }
  return { mixer, height, groundY: bones ? Math.min(0, minY) : 0 };
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

// scratch objects (module-local, reused every frame — no per-call allocation)
const _rp1 = new THREE.Vector3(), _rp2 = new THREE.Vector3(), _rt = new THREE.Vector3();
const _rq1 = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rq3 = new THREE.Quaternion();
function _relaxOne(arm, fore, tx, ty, tz, blend) {
  if (!arm || !fore) return;
  arm.getWorldPosition(_rp1); fore.getWorldPosition(_rp2);
  _rp2.sub(_rp1); if (_rp2.lengthSq() < 1e-8) return;
  _rp2.normalize(); _rt.set(tx, ty, tz).normalize();
  _rq1.setFromUnitVectors(_rp2, _rt);        // world-space correction (current → target dir)
  arm.getWorldQuaternion(_rq2);
  _rq1.multiply(_rq2);                        // new desired world quat
  arm.parent.getWorldQuaternion(_rq3);
  _rq3.invert().multiply(_rq1);              // → local space of the arm bone
  arm.quaternion.slerp(_rq3, blend);
  arm.updateMatrixWorld(true);               // so the forearm reads the corrected parent
}

/**
 * Force the arms to hang relaxed at the sides. The Meshy auto-rig bound every
 * character in an A-pose, and its ENTIRE idle-animation library keeps the arms
 * flung outward (verified: all presets land at radial ≥0.9 torso-heights). So
 * we correct the pose after the mixer runs: rotate each upper arm to point down
 * (+ slightly out to clear the torso) and each forearm nearly straight down.
 * `amount` (0..1) scales the blend for smooth fade-in/out. Call every frame
 * AFTER mixer.update() and after the skeleton's world matrices are current.
 */
export function relaxArms(b, amount) {
  if (!b) return;
  const a = amount == null ? 1 : Math.max(0, Math.min(1, amount));
  if (a <= 0) return;
  _relaxOne(b.rArm, b.rFore, -0.28, -1, 0.02, 0.92 * a);
  _relaxOne(b.lArm, b.lFore,  0.28, -1, 0.02, 0.92 * a);
  _relaxOne(b.rFore, b.rHand, -0.08, -1, 0.05, 0.85 * a);
  _relaxOne(b.lFore, b.lHand,  0.08, -1, 0.05, 0.85 * a);
}

/** Clone + pose + scale a creature template to a target height. */
export function makeCreature(assets, tpl, targetH, THREE_) {
  const obj = assets.clone(tpl);
  const { mixer, height } = poseRig(obj, tpl.animations, THREE_);
  const s = targetH / height;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  // ground: measure posed bone/box minimum after scaling
  const box = new (THREE_ || THREE).Box3().setFromObject(obj);
  if (isFinite(box.min.y)) obj.position.y -= Math.max(-2, Math.min(2, box.min.y));
  return { obj, mixer };
}

/** Distinct hand-built 3D NPCs — merchant, blacksmith, sage — for both the
 *  builder and escape. Each reads at a glance from its silhouette + signature
 *  station (coin stall / anvil+forge / arcane staff+tome), theme-swapped for
 *  fantasy vs sci-fi. ~1.9 units tall on a small round base. Replaces the old
 *  one-size-fits-all stall. userData.figure = the humanoid (for the idle bob). */
export function makeNpc(ntype, theme) {
  const scifi = theme === "scifi";
  const g = new THREE.Group();
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({
    color: c, roughness: o.r == null ? 0.82 : o.r, metalness: o.m == null ? (scifi ? 0.45 : 0) : o.m,
    emissive: o.e == null ? 0x000000 : o.e, emissiveIntensity: o.ei == null ? 1 : o.ei });
  const skinM = mat(scifi ? 0xc2c9d2 : 0xd9a97e, { r: 0.7, m: scifi ? 0.3 : 0 });
  const woodM = mat(scifi ? 0x2a3340 : 0x5a3f28, { r: 0.85, m: scifi ? 0.55 : 0 });
  const ironM = mat(scifi ? 0x8792a0 : 0x3b3f47, { r: 0.5, m: 0.85 });
  const coinM = mat(0xffd769, { r: 0.25, m: 0.9, e: 0xffb000, ei: 0.4 });

  // round base so each NPC reads as a station
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.04, 0.12, 24),
    mat(scifi ? 0x28313d : 0x362a20, { r: 0.95, m: scifi ? 0.5 : 0, e: scifi ? 0x0a2833 : 0x000000, ei: scifi ? 0.35 : 0 }));
  base.position.y = 0.06; g.add(base);

  // ── shared humanoid ──────────────────────────────────────────────────────
  function humanoid({ robeC, robeE, hoodC, beardC, capC, wide, hands }) {
    const h = new THREE.Group();
    const robe = mat(robeC, { r: 0.85, e: robeE || 0x000000, ei: robeE ? 0.3 : 0 });
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(wide ? 0.56 : 0.46, 1.15, 16), robe); skirt.position.y = 0.66; h.add(skirt);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(wide ? 0.36 : 0.28, wide ? 0.44 : 0.34, 0.66, 14), robe); torso.position.y = 1.28; h.add(torso);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(wide ? 0.42 : 0.33, 14, 10), robe); sh.position.y = 1.56; sh.scale.y = 0.55; h.add(sh);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), skinM); head.position.y = 1.9; h.add(head);
    if (hoodC) { const hd = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(hoodC, { r: 0.9 })); hd.position.y = 1.95; h.add(hd); }
    if (capC) { const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.34, 14), mat(capC, { r: 0.9 })); cap.position.y = 2.12; h.add(cap);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 14), mat(capC, { r: 0.9 })); brim.position.y = 1.96; h.add(brim); }
    if (beardC) { const bd = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 12), mat(beardC, { r: 0.95 })); bd.position.set(0, 1.74, 0.11); bd.rotation.x = 0.12; h.add(bd); }
    const arms = {};
    for (const sx of [-1, 1]) {
      const key = sx < 0 ? "l" : "r";
      const shoulderX = sx * (wide ? 0.44 : 0.35);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.44, 8), robe); upper.position.set(shoulderX, 1.36, 0.02); upper.rotation.z = sx * 0.2; h.add(upper);
      const fore = new THREE.Group(); fore.position.set(shoulderX + sx * 0.05, 1.16, 0.03);
      const foreM = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.4, 8), skinM); foreM.position.y = -0.17; fore.add(foreM);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skinM); hand.position.y = -0.38; fore.add(hand);
      const pose = (hands && hands[key]) || { x: -0.5, z: 0 };
      fore.rotation.set(pose.x, 0, pose.z); h.add(fore);
      arms[key] = fore;
    }
    h.userData.arms = arms;
    return h;
  }

  let fig, tint;
  if (ntype === "blacksmith") {
    // ── BLACKSMITH: burly, leather apron, hammer, anvil + forge glow ──
    tint = 0xff8a3c;
    fig = humanoid({ robeC: scifi ? 0x39434f : 0x5b4636, wide: true, capC: scifi ? 0x22303c : 0x2c1f16,
      hands: { r: { x: -1.15, z: 0.1 }, l: { x: -0.55, z: 0 } } });
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.1), mat(scifi ? 0x2a3946 : 0x3a2418, { r: 0.9, m: scifi ? 0.4 : 0 }));
    apron.position.set(0, 1.1, 0.32); fig.add(apron);
    // hammer in the right hand
    const hammer = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), woodM); hammer.add(handle);
    const headH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.28), ironM); headH.position.y = 0.3; hammer.add(headH);
    hammer.position.set(0, -0.5, 0.02); hammer.rotation.x = 0.2; fig.userData.arms.r.add(hammer);
    fig.position.set(-0.18, 0.12, -0.12); g.add(fig);
    // anvil
    const anvil = new THREE.Group();
    anvil.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), ironM)); // top
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 10), ironM); horn.rotation.z = -Math.PI / 2; horn.position.set(0.38, 0, 0); anvil.add(horn);
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.2), ironM); waist.position.y = -0.19; anvil.add(waist);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.28), ironM); foot.position.y = -0.36; anvil.add(foot);
    anvil.position.set(0.62, 0.7, 0.34); g.add(anvil);
    // forge ember on the anvil + warm light
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(0xff5a1e, { e: 0xff5a1e, ei: 2.4, r: 0.4 }));
    ember.position.set(0.62, 0.82, 0.34); g.add(ember); g.userData.ember = ember;
  } else if (ntype === "sage") {
    // ── SAGE: tall, hooded robe, white beard, glowing staff + floating tome ──
    tint = 0x8f6bff;
    fig = humanoid({ robeC: scifi ? 0x2b2350 : 0x33285e, robeE: scifi ? 0x2a1e66 : 0x1c1440,
      hoodC: scifi ? 0x241d45 : 0x271e4d, beardC: scifi ? 0xbfc6e0 : 0xe6e2d6,
      hands: { r: { x: -0.35, z: -0.15 }, l: { x: -0.7, z: 0.1 } } });
    fig.scale.setScalar(1.06);
    fig.position.set(-0.12, 0.12, -0.05); g.add(fig);
    // staff held in the right hand, standing tall
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 2.2, 8), woodM); shaft.position.y = 1.1; staff.add(shaft);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat(tint, { e: tint, ei: 2.6, r: 0.2, m: 0.1 })); crystal.position.y = 2.28; staff.add(crystal);
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 16), ironM); claw.position.y = 2.16; claw.rotation.x = Math.PI / 2; staff.add(claw);
    staff.position.set(0.5, 0.12, 0.12); g.add(staff);
    g.userData.crystal = crystal;
    // floating open tome beside the sage
    const tome = new THREE.Group();
    for (const sx of [-1, 1]) { const pg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.34), mat(0xf3ecd6, { r: 0.8, e: tint, ei: 0.25 })); pg.position.set(sx * 0.15, 0, 0); pg.rotation.z = sx * 0.25; tome.add(pg); }
    tome.position.set(-0.62, 1.35, 0.2); g.add(tome); g.userData.tome = tome;
  } else {
    // ── MERCHANT: trader with a coin counter, goods sack, coin pouch ──
    tint = 0xffd769;
    fig = humanoid({ robeC: scifi ? 0x1f6f8f : 0x3a5a3a, capC: scifi ? 0x124a5e : 0x6a3f1e,
      hands: { r: { x: -0.9, z: 0.15 }, l: { x: -0.85, z: -0.15 } } });
    fig.position.set(0, 0.12, -0.28); g.add(fig);
    // sash across the chest
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.72, 0.36), mat(scifi ? 0x0d3a4a : 0x8a2b2b, { r: 0.85, e: scifi ? 0x0a3a4a : 0x000000, ei: scifi ? 0.4 : 0 }));
    sash.position.set(0.02, 1.2, 0.02); sash.rotation.z = 0.5; fig.add(sash);
    // coin counter in front
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.5), woodM); counter.position.set(0, 0.86, 0.5); g.add(counter);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), woodM); leg.position.set(sx * 0.42, 0.4, 0.5); g.add(leg); }
    // stacked coins + a small goods sack on the counter
    for (let i = 0; i < 3; i++) { const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.028, 14), coinM); cn.position.set(-0.3, 0.95 + i * 0.03, 0.5); g.add(cn); }
    for (let i = 0; i < 4; i++) { const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.026, 14), coinM); cn.position.set(-0.05 + (i % 2) * 0.16, 0.95, 0.42 + Math.floor(i / 2) * 0.14); g.add(cn); }
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(scifi ? 0x35506a : 0x7a5a34, { r: 0.9 })); sack.scale.y = 0.85; sack.position.set(0.32, 1.02, 0.5); g.add(sack);
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.1, 8), mat(scifi ? 0x35506a : 0x5a4326)); tie.position.set(0.32, 1.14, 0.5); g.add(tie);
    // coin pouch in the merchant's right hand
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0x8a5a2a, { r: 0.9 })); pouch.scale.y = 0.9; pouch.position.set(0, -0.42, 0); fig.userData.arms.r.add(pouch);
  }
  g.userData.figure = fig;
  g.userData.tint = tint;
  return g;
}

/** Procedural torch: wooden pole/metal rod + glowing head. Cleaner than any
 *  library blob and identical across themes (color-swapped). */
export function makeTorch(theme) {
  const grp = new THREE.Group();
  const fantasy = theme !== "scifi";
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(fantasy ? 0.07 : 0.06, fantasy ? 0.11 : 0.1, 2.3, 8),
    new THREE.MeshStandardMaterial({ color: fantasy ? 0x4a3122 : 0x2a3340, roughness: 0.85, metalness: fantasy ? 0 : 0.7 }));
  pole.position.y = 1.15;
  grp.add(pole);
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.12, 0.3, 6, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
  cage.position.y = 2.32;
  grp.add(cage);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 10, 8),
    new THREE.MeshStandardMaterial({
      color: fantasy ? 0xffb347 : 0x66eaff,
      emissive: fantasy ? 0xff8a1f : 0x37e0ff, emissiveIntensity: 2.6,
    }));
  flame.position.y = 2.55;
  flame.scale.y = 1.5;
  grp.add(flame);
  return grp;
}

export function stripLights(root) {
  const dead = [];
  root.traverse((o) => { if (o.isLight) dead.push(o); });
  dead.forEach((l) => l.parent && l.parent.remove(l));
}

/** Find an animation clip whose name ends with any of the given suffixes. */
export function findClip(animations, ...suffixes) {
  for (const suf of suffixes) {
    const c = animations.find((a) => a.name.toLowerCase().endsWith(suf.toLowerCase()));
    if (c) return c;
  }
  return null;
}

/** Standard creature clip set (Quaternius naming variants). */
export function creatureClips(animations) {
  return {
    idle: findClip(animations, "idle", "flying_idle", "robot_idle", "slime_idle", "spider_idle", "flying", "hover", "float", "fly"),
    walk: findClip(animations, "walk", "walking", "robot_walking", "slime_walk", "spider_walk", "fast_flying", "run", "running", "flying", "fly", "move"),
    run: findClip(animations, "run", "running", "robot_running", "fast_flying", "walk", "flying", "fly"),
    attack: findClip(animations, "attack", "punch", "robot_punch", "bite_front", "bite", "headbutt", "slime_attack", "spider_attack", "kick", "shoot_small", "shoot", "cast", "spell"),
    death: findClip(animations, "death", "robot_death", "slime_death", "spider_death", "die"),
    hit: findClip(animations, "hitrecieve", "hitreact", "hitrecieve_1", "recievehit", "hit", "damage"),
  };
}

/** Character (player) clip set — covers the Adventurer (Sword_Slash/Roll),
 *  RPG Monk (Attack/Attack2) and Ultimate-Monsters humanoids (Bite_Front,
 *  Walk-only rigs fall back to a sped-up walk for run). */
export function charClips(animations) {
  const walk = findClip(animations, "walk", "walking");
  return {
    idle: findClip(animations, "idle_neutral", "idle"),
    walk,
    run: findClip(animations, "run", "running") || walk,
    attack: findClip(animations, "sword_slash", "sword_attack", "attack2", "attack", "staff_attack", "punch_right", "punch", "bite_front", "headbutt"),
    spell: findClip(animations, "spell1", "attack2", "punch_left", "staff_attack", "punch", "bite_front"),
    death: findClip(animations, "death"),
    hit: findClip(animations, "recievehit", "hitrecieve", "hitreact"),
    pickup: findClip(animations, "pickup", "interact"),
    roll: findClip(animations, "roll"),
  };
}

// Shared GLSL: cheap value-noise + fbm, and per-instance world position so
// adjacent painted cells tile as one continuous surface.
const _NOISE_GLSL = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.02; a*=0.5; } return v; }`;
const _SURF_VERT = `
  varying vec3 vWorld; varying vec3 vNrm; varying vec3 vView; uniform float uTime; uniform float uWave;
  void main(){
    vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0);
    vec3 t = position;
    if (uWave > 0.5 && normal.y > 0.5) t.y += (sin(wp.x*1.4+uTime*2.0)+cos(wp.z*1.6+uTime*1.7))*0.035;
    vec4 wp2 = modelMatrix * instanceMatrix * vec4(t,1.0);
    vWorld = wp2.xyz; vNrm = normalize(mat3(instanceMatrix)*normal); vView = normalize(cameraPosition - wp2.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp2;
  }`;

/** Glowing, flowing lava — hot veins over a dark crust, gentle pulse. */
export function makeLavaMaterial(THREE_) {
  const T = THREE_ || THREE;
  return new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWave: { value: 0 } },
    vertexShader: _SURF_VERT,
    fragmentShader: _NOISE_GLSL + `
      varying vec3 vWorld; varying vec3 vNrm; varying vec3 vView; uniform float uTime;
      void main(){
        vec2 uv = vWorld.xz*0.28;
        float flow = fbm(uv + vec2(uTime*0.06, uTime*0.045));
        float veins = fbm(uv*1.8 - vec2(uTime*0.05, uTime*0.03));
        float hot = smoothstep(0.42,0.72,flow) + 0.45*smoothstep(0.58,0.9,veins);
        vec3 crust = vec3(0.13,0.03,0.012);
        vec3 lava = mix(vec3(0.95,0.28,0.04), vec3(1.0,0.86,0.25), clamp(hot,0.0,1.0));
        vec3 col = mix(crust, lava, clamp(hot,0.0,1.0));
        col *= 0.85 + 0.22*sin(uTime*2.0 + flow*6.0);
        col = mix(col*0.28, col, smoothstep(0.3,0.8,vNrm.y));   // sides dark
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** Rippling translucent water — moving highlights + view-angle fresnel. */
export function makeWaterMaterial(THREE_) {
  const T = THREE_ || THREE;
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uWave: { value: 1 } },
    vertexShader: _SURF_VERT,
    fragmentShader: _NOISE_GLSL + `
      varying vec3 vWorld; varying vec3 vNrm; varying vec3 vView; uniform float uTime;
      void main(){
        vec2 uv = vWorld.xz*0.5;
        float r = (vnoise(uv + vec2(uTime*0.14, uTime*0.1)) + vnoise(uv*1.9 - vec2(uTime*0.11, -uTime*0.08)))*0.5;
        vec3 deep = vec3(0.03,0.16,0.29), shallow = vec3(0.11,0.42,0.58);
        vec3 col = mix(deep, shallow, r);
        col += pow(smoothstep(0.62,0.95,r),3.0)*0.55;            // glints
        float fres = pow(1.0 - clamp(vView.y,0.0,1.0), 2.5);
        float top = smoothstep(0.3,0.8,vNrm.y);
        col = mix(col*0.5, col + fres*0.25, top);
        gl_FragColor = vec4(col, mix(0.82, mix(0.72,0.95,fres), top));
      }`,
  });
}

/**
 * Cell SURFACES for one dungeon floor: kit-tile instancing for stone +
 * raised platforms (with skirts and auto step wedges at their edges), an
 * animated emissive LAVA sheet and a translucent WATER sheet. Shared by the
 * builder and escape renderers so the two modes can never disagree.
 * Returns a group; caller adds it to the floor group. `lavaMat`/`waterMat`
 * are exposed for per-frame animation.
 */
export function makeCellSurfaces(D, d, f, kit) {
  const group = new THREE.Group();
  const fl = d.floors[f];
  const cells = Object.keys(fl.cells);
  const CELL = D.CELL, RH = D.RAISED_H;
  const byType = { 1: [], 2: [], 3: [], 4: [] };
  for (const k of cells) {
    const [x, z] = k.split(",").map(Number);
    (byType[fl.cells[k] | 0] || byType[1]).push([x, z]);
  }

  // ── SMOOTH ROLLING TERRAIN ────────────────────────────────────────────────
  // Cells raised/lowered by the height tool (and legacy RAISED platforms) form a
  // continuous heightmap mesh with sloped, rounded transitions — no voxel boxes.
  // Flat (level-0, non-adjacent) floor tiles keep the crisp kit stone.
  const m4 = new THREE.Matrix4();
  const isFloorish = (cx, cz) => { const t = fl.cells[D.ck(cx, cz)] | 0; return t === 1 || t === 4; };
  const hAt = (cx, cz) => (fl.cells[D.ck(cx, cz)] ? D.cellHeight(d, f, cx, cz) : 0);
  const anyHeight = cells.some((k) => { const [x, z] = k.split(",").map(Number); return isFloorish(x, z) && hAt(x, z) !== 0; });
  const terrain = new Set();
  if (anyHeight) {
    for (const [x, z] of byType[1].concat(byType[4])) {
      let near = hAt(x, z) !== 0;
      for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++)
        if (isFloorish(x + dx, z + dz) && hAt(x + dx, z + dz) !== 0) near = true;
      if (near) terrain.add(D.ck(x, z));
    }
  }
  // corner height = average of the up-to-4 real floor cells meeting that corner
  const cornerH = (cx, cz) => {
    let s = 0, n = 0;
    for (const [ox, oz] of [[cx - 1, cz - 1], [cx, cz - 1], [cx - 1, cz], [cx, cz]])
      if (isFloorish(ox, oz)) { s += hAt(ox, oz); n++; }
    return n ? s / n : 0;
  };

  // flat kit tiles for level-0 cells the terrain mesh doesn't cover
  const flat = byType[1].filter(([x, z]) => !terrain.has(D.ck(x, z)));
  if (flat.length) {
    const inst = makeInstanced(kit.floor.scene, flat.length);
    flat.forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, 0, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
    inst.setCount(flat.length); inst.commit();
    group.add(inst.group);
  }

  // rolling heightmap mesh over the elevated region — solid stone tinted per theme
  if (terrain.size) {
    const SUB = 3, row = SUB + 1;
    const pos = [], idx = [];
    let vb = 0;
    for (const k of terrain) {
      const [x, z] = k.split(",").map(Number);
      const h00 = cornerH(x, z), h10 = cornerH(x + 1, z), h01 = cornerH(x, z + 1), h11 = cornerH(x + 1, z + 1);
      for (let iz = 0; iz <= SUB; iz++) for (let ix = 0; ix <= SUB; ix++) {
        const fx = ix / SUB, fz = iz / SUB;
        const h = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
        pos.push((x + fx) * CELL, h, (z + fz) * CELL);
      }
      for (let iz = 0; iz < SUB; iz++) for (let ix = 0; ix < SUB; ix++) {
        const a = vb + iz * row + ix, b = a + 1, c = a + row, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
      vb += row * row;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: d.theme === "scifi" ? 0x51606e : 0x8a5836, roughness: 0.96, metalness: 0.0, flatShading: false,
    });
    const tmesh = new THREE.Mesh(geo, mat);
    group.add(tmesh);
  }

  // lava sheet — flowing procedural shader, animated via uTime in update
  let lavaMat = null;
  if (byType[2].length) {
    lavaMat = makeLavaMaterial(THREE);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 0.22, CELL), lavaMat, byType[2].length);
    byType[2].forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, 0.02, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // water sheet — rippling procedural shader, animated via uTime in update
  let waterMat = null;
  if (byType[3].length) {
    waterMat = makeWaterMaterial(THREE);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 0.16, CELL), waterMat, byType[3].length);
    byType[3].forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, 0.0, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    // stone base under the water so the pool has a floor
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 0.06, CELL),
      new THREE.MeshStandardMaterial({ color: 0x22222c, roughness: 1 }), byType[3].length);
    byType[3].forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, -0.1, z * CELL + CELL / 2); base.setMatrixAt(i, m4); });
    base.instanceMatrix.needsUpdate = true;
    group.add(base);
  }

  return { group, lavaMat, waterMat, lavaCells: byType[2], waterCells: byType[3] };
}

function mergeSteps(CELL) {
  // 3 shallow steps hugging one cell edge (local -Z edge before rotation)
  const geo = new THREE.BufferGeometry();
  const boxes = [];
  const RH = 1.1, n = 3;
  for (let i = 0; i < n; i++) {
    const h = (RH / n) * (i + 1);
    const depth = 0.42;
    const b = new THREE.BoxGeometry(CELL * 0.98, h, depth);
    b.translate(0, h / 2, -CELL / 2 + depth / 2 + i * depth);
    boxes.push(b);
  }
  // manual merge (BufferGeometryUtils not imported): concat positions/normals/uv/index
  let pos = [], norm = [], uv = [], idx = [], off = 0;
  for (const b of boxes) {
    pos.push(...b.attributes.position.array);
    norm.push(...b.attributes.normal.array);
    uv.push(...b.attributes.uv.array);
    const bi = b.index.array;
    for (let i = 0; i < bi.length; i++) idx.push(bi[i] + off);
    off += b.attributes.position.count;
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/**
 * Build an InstancedMesh set from a kit template: merges the template's
 * meshes into (geometry, material) pairs, one InstancedMesh per pair, sharing
 * a single matrix list. Kenney kit pieces are single-mesh, so this stays 1-2
 * draw calls per module type per floor.
 */
export function makeInstanced(tplScene, count) {
  const parts = [];
  tplScene.updateMatrixWorld(true);
  tplScene.traverse((o) => {
    if (o.isMesh) {
      const im = new THREE.InstancedMesh(o.geometry, o.material, count);
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parts.push({ im, bind: o.matrixWorld.clone() });
    }
  });
  return {
    parts,
    group: (() => { const g = new THREE.Group(); parts.forEach((p) => g.add(p.im)); return g; })(),
    setCount(n) { this.parts.forEach((p) => { p.im.count = n; }); },
    setMatrixAt(i, m) {
      const tmp = new THREE.Matrix4();
      this.parts.forEach((p) => { tmp.multiplyMatrices(m, p.bind); p.im.setMatrixAt(i, tmp); });
    },
    commit() { this.parts.forEach((p) => { p.im.instanceMatrix.needsUpdate = true; p.im.computeBoundingSphere?.(); }); },
  };
}
