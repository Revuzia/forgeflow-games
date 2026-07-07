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

  enemies(theme) {
    const t = theme === "scifi" ? "scifi" : "fantasy";
    const names = t === "fantasy"
      ? ["spider", "skeleton", "zombie", "ghost", "slime", "orc", "demon"]
      : ["drone", "robot", "android", "turret", "mech", "alien"];
    const m = {};
    for (const n of names) m[n] = n === "turret"
      ? this.load("props/scifi/turret.glb")
      : this.load(`enemies/${t}/${n}.glb`);
    return promiseMap(m);
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

/** Procedural merchant stall + shopkeeper — reads clearly as a vendor in both
 *  the builder and escape, no character rig required. Returns a group ~2 cells. */
export function makeMerchant(theme) {
  const g = new THREE.Group();
  const scifi = theme === "scifi";
  const woodC = scifi ? 0x2a3340 : 0x6a4326, clothC = scifi ? 0x1f6f8f : 0x8a2b2b;
  const wood = new THREE.MeshStandardMaterial({ color: woodC, roughness: 0.85, metalness: scifi ? 0.6 : 0 });
  const cloth = new THREE.MeshStandardMaterial({ color: clothC, roughness: 0.9, emissive: scifi ? 0x0a3a4a : 0x1a0505, emissiveIntensity: scifi ? 0.4 : 0.1 });
  // counter
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.9), wood); top.position.set(0, 1.0, 0.5); g.add(top);
  for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), wood); leg.position.set(sx * 1.05, 0.5, 0.5); g.add(leg); }
  // awning
  const awn = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.1, 1.2), cloth); awn.position.set(0, 2.5, 0.2); awn.rotation.x = -0.18; g.add(awn);
  for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), wood); post.position.set(sx * 1.2, 1.25, 0.6); g.add(post); }
  // striped awning trim
  for (let i = -5; i <= 5; i++) { if (i % 2) continue; const s = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.02), new THREE.MeshStandardMaterial({ color: 0xf0e4c8 })); s.position.set(i * 0.24, 2.34, 0.82); g.add(s); }
  // gold coins on the counter
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd769, metalness: 0.9, roughness: 0.25, emissive: 0xffb000, emissiveIntensity: 0.35 });
  for (let i = 0; i < 5; i++) { const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 14), coinMat); cn.position.set(-0.7 + i * 0.12, 1.1, 0.4 + (i % 2) * 0.12); g.add(cn); }
  // shopkeeper figure (simple, behind the counter)
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a97e, roughness: 0.7 });
  const robe = new THREE.MeshStandardMaterial({ color: scifi ? 0x35506a : 0x3a5a3a, roughness: 0.85 });
  const fig = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.95, 12), robe); body.position.y = 0.62; fig.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skin); head.position.y = 1.28; fig.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.34, 12), new THREE.MeshStandardMaterial({ color: scifi ? 0x223a4a : 0x5a3a22, roughness: 0.9 })); hat.position.y = 1.5; fig.add(hat);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), robe); arm.position.set(sx * 0.3, 0.75, 0.05); arm.rotation.z = sx * 0.5; fig.add(arm); }
  fig.position.set(0, 0.14, -0.15);
  g.add(fig);
  g.userData.figure = fig;
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
    idle: findClip(animations, "idle", "flying_idle", "robot_idle", "slime_idle", "spider_idle"),
    walk: findClip(animations, "walk", "walking", "robot_walking", "slime_walk", "spider_walk", "fast_flying", "run", "running"),
    run: findClip(animations, "run", "running", "robot_running", "fast_flying", "walk"),
    attack: findClip(animations, "attack", "punch", "robot_punch", "bite_front", "headbutt", "slime_attack", "spider_attack", "kick", "shoot_small"),
    death: findClip(animations, "death", "robot_death", "slime_death", "spider_death"),
    hit: findClip(animations, "hitrecieve", "hitreact", "hitrecieve_1", "recievehit"),
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

  // stone floor tiles: type 1 at y0, type 4 at +RH (same kit tile)
  const m4 = new THREE.Matrix4();
  const stone = byType[1].map(([x, z]) => [x, z, 0]).concat(byType[4].map(([x, z]) => [x, z, RH]));
  if (stone.length) {
    const inst = makeInstanced(kit.floor.scene, stone.length);
    stone.forEach(([x, z, y], i) => { m4.makeTranslation(x * CELL + CELL / 2, y, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
    inst.setCount(stone.length); inst.commit();
    group.add(inst.group);
  }

  // raised skirts + step wedges toward every lower walkable neighbor
  if (byType[4].length) {
    const skirtGeo = new THREE.BoxGeometry(CELL, RH, CELL);
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x4a4a58, roughness: 0.9 });
    const skirts = new THREE.InstancedMesh(skirtGeo, skirtMat, byType[4].length);
    byType[4].forEach(([x, z], i) => {
      m4.makeTranslation(x * CELL + CELL / 2, RH / 2 - 0.02, z * CELL + CELL / 2);
      skirts.setMatrixAt(i, m4);
    });
    skirts.instanceMatrix.needsUpdate = true;
    group.add(skirts);
    // steps: 3-step wedge, instanced, rotated toward the lower neighbor
    const stepGeo = mergeSteps(CELL);
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x5a5a6a, roughness: 0.85 });
    const spots = [];
    for (const [x, z] of byType[4]) {
      for (let s = 0; s < 4; s++) {
        const nx = x + D.DIRS[s].dx, nz = z + D.DIRS[s].dz;
        const nt = fl.cells[D.ck(nx, nz)] | 0;
        if (nt && nt !== 4) spots.push([x, z, s]);
      }
    }
    if (spots.length) {
      const steps = new THREE.InstancedMesh(stepGeo, stepMat, spots.length);
      const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      spots.forEach(([x, z, s], i) => {
        const yaw = s === 0 ? 0 : s === 1 ? Math.PI / 2 : s === 2 ? Math.PI : -Math.PI / 2;
        pos.set(x * CELL + CELL / 2, 0, z * CELL + CELL / 2);
        q.setFromAxisAngle(up, yaw);
        m4.compose(pos, q, one);
        steps.setMatrixAt(i, m4);
      });
      steps.instanceMatrix.needsUpdate = true;
      group.add(steps);
    }
  }

  // lava sheet — one merged plane set, emissive, animated in update
  let lavaMat = null;
  if (byType[2].length) {
    lavaMat = new THREE.MeshStandardMaterial({
      color: 0x35100a, emissive: 0xff5a1f, emissiveIntensity: 1.6, roughness: 0.7,
    });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 0.22, CELL), lavaMat, byType[2].length);
    byType[2].forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, 0.02, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // water sheet — translucent, animated
  let waterMat = null;
  if (byType[3].length) {
    waterMat = new THREE.MeshStandardMaterial({
      color: 0x1a4a66, emissive: 0x0c2a44, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1,
    });
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
