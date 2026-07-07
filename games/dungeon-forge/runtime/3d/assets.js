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
    // character = textured base + armature-only Walk/Run clips retargeted by
    // bone name. Attack/death are procedural bone overlays (escape.js).
    const names = ["knight", "barbarian", "sorceress", "rogue"];
    const out = {};
    await Promise.all(names.map(async (n) => {
      try {
        const base = await this.load(`chars/meshy/${n}/base.glb`);
        const wa = await this.load(`chars/meshy/${n}/walk_arm.glb`).catch(() => null);
        const ra = await this.load(`chars/meshy/${n}/run_arm.glb`).catch(() => null);
        const anims = [];
        if (base.animations && base.animations[0]) { const c = base.animations[0].clone(); c.name = "Idle"; anims.push(c); }
        if (wa && wa.animations[0]) { const c = wa.animations[0].clone(); c.name = "Walk"; anims.push(c); }
        if (ra && ra.animations[0]) { const c = ra.animations[0].clone(); c.name = "Run"; anims.push(c); }
        out[n] = { scene: base.scene, animations: anims };
      } catch (e) { console.warn("[assets] char failed:", n, e); }
    }));
    return out;
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
