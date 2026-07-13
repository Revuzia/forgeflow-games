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
const _V = new URL(import.meta.url).search;           // inherit the ?v= cache-bust
const { floorTexture } = await import("./floor_tex.js" + _V);

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
    return promiseMap(m).then((out) => {
      // procedural breakable props (no GLB assets) — wrapped for the clone path
      for (const n of (t === "fantasy" ? ["pot", "urn", "bones"] : ["canister"])) out[n] = { scene: makeProp(n, t), animations: [] };
      return out;
    });
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
          if (g && g.animations && g.animations[0]) { const c = g.animations[0].clone(); c.tracks = c.tracks.filter((t) => !/\.scale$/.test(t.name) && !/(Shoulder|Arm|Hand)\.position$/.test(t.name)); c.name = name; anims.push(c); return true; } // strip baked bone-scale (idle bakes Hips 1.1765 → shrinks on walk) + arm/shoulder/hand POSITION tracks (they raise the shoulders → the "shrug"; relaxArms only fixes rotation)
          return false;
        };
        // real generated idle (arms down) — falls back to the base bind clip only if missing
        const gotIdle = await addClip(`chars/meshy/${n}/anim_idle.glb`, "Idle");
        if (!gotIdle && base.animations && base.animations[0]) { const c = base.animations[0].clone(); c.tracks = c.tracks.filter((t) => !/\.scale$/.test(t.name) && !/(Shoulder|Arm|Hand)\.position$/.test(t.name)); c.name = "Idle"; anims.push(c); }
        await addClip(`chars/meshy/${n}/walk_arm.glb`, "Walk");
        await addClip(`chars/meshy/${n}/run_arm.glb`, "Run");
        await Promise.all((CLIPS[n] || []).map((cn) => addClip(`chars/meshy/${n}/anim_${cn}.glb`, "C_" + cn)));
        out[n] = { scene: base.scene, animations: anims };
      } catch (e) { console.warn("[assets] char failed:", n, e); }
    }));
    return out;
  }

/** Procedural class weapons — built once, cloned per actor. All modelled along
   *  +Y (grip at the bottom, tip up) so attachWeapon's rest/gripFrac apply.
   *  Ported from ForgeFlow Thronedrift's weapon set (cleaner build than the old
   *  DF axe/staff). */
  static makeClassWeapon(cls) {
    const steel = () => new THREE.MeshStandardMaterial({ color: 0xc8ccd8, metalness: 0.85, roughness: 0.3 });
    const gold = () => new THREE.MeshStandardMaterial({ color: 0xe8b83a, metalness: 0.95, roughness: 0.25 });
    const ember = () => new THREE.MeshStandardMaterial({ color: 0xff5a2a, emissive: 0xff3a10, emissiveIntensity: 1.6 });
    const wood = () => new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.9 });
    const g = new THREE.Group();
    if (cls === "barbarian") {
      // two-handed greatblade
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 8), wood()); grip.position.y = 0.15;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.1), gold()); guard.position.y = 0.46;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.045), steel()); blade.position.y = 1.24;
      const edge = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.3, 4), steel()); edge.scale.z = 0.28; edge.position.y = 2.06; edge.rotation.y = Math.PI / 4;
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.055), ember()); core.position.y = 1.24;
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), gold()); pommel.position.y = -0.14;
      g.add(grip, guard, blade, edge, core, pommel);
    } else if (cls === "sorceress") {
      // arcane staff with a glowing orb
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 1.5, 8), wood()); pole.position.y = 0.5;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x9a6bff, emissive: 0x8f5aff, emissiveIntensity: 2.4 }));
      orb.position.y = 1.34;
      const cage = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 8, 20), gold()); cage.position.y = 1.34;
      g.add(pole, orb, cage); g.userData.orb = orb;
    } else if (cls === "rogue") {
      // dagger
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.2, 8), wood()); grip.position.y = 0.06;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.028, 0.05), gold()); guard.position.y = 0.18;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), steel()); blade.position.y = 0.4;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.12, 4), steel()); tip.scale.z = 0.4; tip.position.y = 0.66; tip.rotation.y = Math.PI / 4;
      g.add(grip, guard, blade, tip);
    } else {
      // knight (default) — arming sword
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.26, 8), wood()); grip.position.y = 0.08;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.07), gold()); guard.position.y = 0.24;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.95, 0.03), steel()); blade.position.y = 0.75;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.18, 4), steel()); tip.scale.z = 0.3; tip.position.y = 1.31; tip.rotation.y = Math.PI / 4;
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), gold()); pommel.position.y = -0.06;
      g.add(grip, guard, blade, tip, pommel);
    }
    return g;
  }

  /** Knight round shield (off arm). Face normal = local +Z; heater-red + gold rim. */
  static makeShield() {
    const gold = () => new THREE.MeshStandardMaterial({ color: 0xe8b83a, metalness: 0.95, roughness: 0.25 });
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 24),
      new THREE.MeshStandardMaterial({ color: 0x7a1f1a, metalness: 0.5, roughness: 0.5 }));
    face.rotation.x = Math.PI / 2;   // disc lies in XY, normal → +Z
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.028, 8, 28), gold());
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), gold()); boss.position.z = 0.05;
    const sig = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0xe8b83a, emissive: 0x6a4a10, emissiveIntensity: 0.5, metalness: 0.9 })); sig.position.z = 0.04;
    g.add(face, rim, boss, sig);
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

// ── NPC canvas textures (module-cached) ─────────────────────────────────────
const _npcTex = {};
function _tex(key, size, draw) {
  if (_npcTex[key]) return _npcTex[key];
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  _npcTex[key] = t; return t;
}
function _rugTex(scifi) {
  return _tex(scifi ? "rug_s" : "rug_f", 256, (g, s) => {
    g.fillStyle = scifi ? "#0d2b36" : "#6d1b22"; g.fillRect(0, 0, s, s);
    g.strokeStyle = scifi ? "#2ee6ff" : "#d9a03f"; g.lineWidth = 9; g.strokeRect(14, 14, s - 28, s - 28);
    g.lineWidth = 3; g.strokeRect(30, 30, s - 60, s - 60);
    g.save(); g.translate(s / 2, s / 2); g.rotate(Math.PI / 4);
    g.strokeStyle = scifi ? "#1fb9d4" : "#c98f2f"; g.lineWidth = 4;
    for (let i = -2; i <= 2; i++) g.strokeRect(i * 40 - 13, -13, 26, 26);
    g.restore();
  });
}
function _runeTex() {
  return _tex("runes", 256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = "rgba(168,120,255,0.95)"; g.lineWidth = 5;
    g.beginPath(); g.arc(s / 2, s / 2, 104, 0, 7); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(s / 2, s / 2, 80, 0, 7); g.stroke();
    g.beginPath();
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 - Math.PI / 2, x = s / 2 + Math.cos(a) * 72, y = s / 2 + Math.sin(a) * 72; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.stroke();
    const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ";
    g.font = "19px serif"; g.fillStyle = "rgba(196,158,255,0.95)"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      g.save(); g.translate(s / 2 + Math.cos(a) * 92, s / 2 + Math.sin(a) * 92); g.rotate(a + Math.PI / 2);
      g.fillText(runes[i], 0, 0); g.restore();
    }
  });
}

/** Distinct hand-crafted 3D NPCs — merchant / blacksmith / sage — shared by the
 *  builder and escape. Stylized flat-shaded low-poly: lathe-curved robes, real
 *  faces (eyes/brows/nose), per-type headwear, posed arms with held items, and
 *  a signature station each (rug + coin counter + scale / stone slab + stump
 *  anvil + brazier / glowing rune circle + staff + floating tome). Theme-swapped
 *  fantasy vs sci-fi. ~2.2 units tall. userData: figure, tint, ember|crystal|tome. */
export function makeNpc(ntype, theme) {
  const scifi = theme === "scifi";
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({
    color: c, flatShading: o.smooth ? false : true,
    roughness: o.r == null ? 0.85 : o.r, metalness: o.m == null ? (scifi ? 0.35 : 0.04) : o.m,
    emissive: o.e == null ? 0x000000 : o.e, emissiveIntensity: o.ei == null ? 1 : o.ei,
    map: o.map || null, transparent: !!o.t, side: o.ds ? THREE.DoubleSide : THREE.FrontSide });
  const skinM = M(scifi ? 0xcfd6e0 : 0xe0b08a, { r: 0.65, m: scifi ? 0.3 : 0, smooth: true });
  const woodM = M(scifi ? 0x31404f : 0x6b4a2c, { r: 0.85, m: scifi ? 0.5 : 0 });
  const ironM = M(scifi ? 0x9aa7b5 : 0x555b66, { r: 0.42, m: 0.85 });
  const goldM = M(scifi ? 0x35e0e8 : 0xd9a03f, { r: 0.3, m: 0.9, e: scifi ? 0x0a5a60 : 0x000000, ei: scifi ? 0.35 : 0 });
  const coinM = M(0xffd769, { r: 0.22, m: 0.92, e: 0xff9d00, ei: 0.45, smooth: true });

  const lathe = (pts, seg, mat) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg || 20), mat);

  // ── shared stylized humanoid ───────────────────────────────────────────────
  // profile: lathe robe/tunic, belt+buckle, chest, neck, head w/ face, headwear,
  // beard, posed arms (upper + forearm group with hand). front = +Z.
  function figure(o) {
    const h = new THREE.Group();
    const robeM = M(o.robeC, { r: 0.88, e: o.robeE || 0x000000, ei: o.robeE ? 0.35 : 0 });
    const innerM = o.innerC ? M(o.innerC, { r: 0.9 }) : robeM;
    const trimM = o.trimC ? M(o.trimC, { r: 0.35, m: 0.8 }) : goldM;

    // lower body: flowing lathe robe or tunic + boots
    if (o.style === "robe") {
      h.add(lathe([[0.02, 0.02], [0.58, 0.02], [0.6, 0.1], [0.42, 0.62], [0.32, 1.06], [0.29, 1.3]], 18, robeM));
      const hem = new THREE.Mesh(new THREE.TorusGeometry(0.585, 0.028, 8, 20), trimM);
      hem.rotation.x = Math.PI / 2; hem.position.y = 0.075; h.add(hem);
    } else {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.5, 10), M(o.legC || 0x3a3230, { r: 0.9 }));
        leg.position.set(sx * 0.17, 0.32, 0); h.add(leg);
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.32), M(o.bootC || 0x2c2320, { r: 0.85 }));
        boot.position.set(sx * 0.17, 0.075, 0.05); h.add(boot);
      }
      h.add((() => { const t = lathe([[0.02, 0.5], [0.44, 0.52], [0.4, 0.9], [0.33, 1.3]], 16, robeM); return t; })());
    }
    // chest + shoulders (wide for the smith)
    const w = o.wide ? 1.28 : 1;
    h.add((() => { const c = lathe([[0.29, 1.28], [0.36 * w, 1.4], [0.4 * w, 1.5], [0.24, 1.61], [0.02, 1.65]], 16, robeM); return c; })());
    // belt + buckle
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.085, 16), M(o.beltC || 0x35281c, { r: 0.7 }));
    belt.position.y = 1.3; h.add(belt);
    const buck = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.03), trimM); buck.position.set(0, 1.3, 0.31); h.add(buck);
    // collar trim
    const col = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 14), trimM);
    col.rotation.x = Math.PI / 2; col.position.y = 1.63; h.add(col);
    // neck + head
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 10), skinM); neck.position.y = 1.68; h.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), skinM); head.position.y = 1.9; head.rotation.x = 0.06; h.add(head);
    // face: eyes + brows + nose (front = +Z)
    const eyeM = M(0x18120e, { r: 0.35, smooth: true });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.031, 8, 8), eyeM);
      eye.position.set(sx * 0.082, 1.92, 0.19); h.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 0.02), M(o.browC || 0x3a2a1a, { r: 0.9 }));
      brow.position.set(sx * 0.085, 1.985, 0.195); brow.rotation.z = sx * -0.15; h.add(brow);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), skinM); nose.position.set(0, 1.875, 0.215); h.add(nose);
    // headwear
    if (o.hood) {
      const hm = M(o.hood, { r: 0.92, ds: true });
      // open-faced cowl: dome tilted BACK so the eyes + beard stay visible
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hm);
      dome.position.set(0, 1.93, -0.05); dome.rotation.x = -0.38; h.add(dome);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10), hm);
      peak.position.set(0, 2.2, -0.12); peak.rotation.x = -0.5; h.add(peak);
      const drape = lathe([[0.26, 0], [0.35, -0.28], [0.31, -0.4]], 14, hm);
      drape.position.set(0, 1.84, -0.02); h.add(drape);
    }
    if (o.cap) {
      const capM = M(o.cap, { r: 0.88 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capM);
      dome.position.y = 1.99; h.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.315, 0.045, 18), capM); brim.position.y = 2.0; h.add(brim);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.242, 0.242, 0.05, 18), trimM); band.position.y = 2.035; h.add(band);
      if (o.feather) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.3, 0.07), M(o.feather, { r: 0.7 }));
        f.position.set(0.19, 2.16, 0); f.rotation.z = -0.45; h.add(f);
      }
    }
    if (o.bandana) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), M(o.bandana, { r: 0.9 }));
      b.position.y = 1.955; h.add(b);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), M(o.bandana, { r: 0.9 })); knot.position.set(0, 1.99, -0.21); h.add(knot);
    }
    // beard
    if (o.beard) {
      const bm = M(o.beard.c, { r: 0.95 });
      const main = new THREE.Mesh(new THREE.ConeGeometry(0.135, o.beard.len, 12), bm);
      main.position.set(0, 1.9 - o.beard.len * 0.42, 0.15); main.rotation.x = 0.32; h.add(main);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.ConeGeometry(0.06, o.beard.len * 0.55, 8), bm);
        side.position.set(sx * 0.1, 1.86 - o.beard.len * 0.22, 0.14); side.rotation.x = 0.3; h.add(side);
      }
      const must = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), bm); must.position.set(0, 1.84, 0.2); h.add(must);
    }
    // arms: upper (robe) + forearm group (skin or sleeve) with mitt hand
    const arms = {};
    for (const sx of [-1, 1]) {
      const key = sx < 0 ? "l" : "r";
      const shX = sx * (0.36 * w);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.082, 0.42, 10), robeM);
      upper.position.set(shX, 1.4, 0.02); upper.rotation.z = sx * 0.28; h.add(upper);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 8, 12), trimM);
      cuff.rotation.x = Math.PI / 2; cuff.position.set(shX + sx * 0.055, 1.22, 0.03); h.add(cuff);
      const fore = new THREE.Group(); fore.position.set(shX + sx * 0.055, 1.2, 0.03);
      const foreM2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.062, 0.38, 10), o.sleeves ? innerM : skinM);
      foreM2.position.y = -0.16; fore.add(foreM2);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(o.gloves ? 0.085 : 0.068, 10, 8), o.gloves ? M(o.gloves, { r: 0.8 }) : skinM);
      hand.position.y = -0.36; fore.add(hand);
      const pose = (o.poses && o.poses[key]) || { x: -0.35, z: 0 };
      fore.rotation.set(pose.x, pose.y || 0, pose.z || 0); h.add(fore);
      arms[key] = fore;
    }
    h.userData.arms = arms;
    return h;
  }

  let fig, tint;
  if (ntype === "blacksmith") {
    // ── BLACKSMITH: stone slab, brawny smith w/ apron + raised hammer, stump
    //    anvil, glowing brazier, quench bucket ──
    tint = 0xff8a3c;
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.1, 0.11, 18), M(scifi ? 0x36414e : 0x4c4f58, { r: 0.95 }));
    slab.position.y = 0.055; g.add(slab);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.9 + 0.4, r = 0.55 + (i % 3) * 0.18;
      const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05), M(i < 2 ? 0xff5a1e : 0x23201e, i < 2 ? { e: 0xff5a1e, ei: 1.6 } : { r: 0.95 }));
      coal.position.set(Math.cos(a) * r, 0.13, Math.sin(a) * r); g.add(coal);
    }
    fig = figure({
      style: "tunic", wide: true, robeC: scifi ? 0x51616f : 0x8a5a34, innerC: scifi ? 0x3a4956 : 0x6b4a2c,
      trimC: scifi ? 0x35e0e8 : 0xb8862f, beltC: 0x2e211a, legC: scifi ? 0x2e3a46 : 0x4a3a30, bootC: 0x241d18,
      bandana: scifi ? 0x1f6f8f : 0x8a2b2b, beard: { c: scifi ? 0x8f9aa8 : 0x4a301c, len: 0.3 },
      browC: scifi ? 0x6a7684 : 0x3a2415, gloves: 0x3a2c22,
      poses: { r: { x: -1.35, z: 0.2 }, l: { x: -0.9, z: -0.3 } },
    });
    // leather apron w/ straps + stitched pocket
    const apM = M(scifi ? 0x2c3b48 : 0x59391f, { r: 0.9 });
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.86, 0.07), apM); apron.position.set(0, 1.05, 0.32); fig.add(apron);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.03), M(scifi ? 0x24313c : 0x4a2f1a, { r: 0.9 })); pocket.position.set(0, 0.88, 0.37); fig.add(pocket);
    for (const sx of [-1, 1]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.03), apM); strap.position.set(sx * 0.16, 1.52, 0.26); strap.rotation.x = -0.12; fig.add(strap); }
    // raised hammer (mid-swing over the anvil)
    const hammer = new THREE.Group();
    hammer.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.62, 8), woodM));
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.32), ironM); hh.position.y = 0.3; hammer.add(hh);
    for (const sz of [-1, 1]) { const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.05, 10), ironM); cap2.rotation.x = Math.PI / 2; cap2.position.set(0, 0.3, sz * 0.185); hammer.add(cap2); }
    hammer.position.set(0, -0.44, 0.05); hammer.rotation.x = -0.5; fig.userData.arms.r.add(hammer);
    fig.rotation.y = -0.4; fig.position.set(-0.24, 0.11, -0.14); g.add(fig);
    // stump + anvil
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.31, 0.5, 12), woodM); stump.position.set(0.6, 0.36, 0.3); g.add(stump);
    const stumpTop = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 12), M(scifi ? 0x445564 : 0x8a6a44, { r: 0.9 })); stumpTop.position.set(0.6, 0.615, 0.3); g.add(stumpTop);
    const anvil = new THREE.Group();
    anvil.add(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.15, 0.26), ironM));
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.36, 10), ironM); horn.rotation.z = -Math.PI / 2; horn.position.set(0.42, 0.01, 0); anvil.add(horn);
    const waist2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), ironM); waist2.position.y = -0.16; anvil.add(waist2);
    const foot2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.26), ironM); foot2.position.y = -0.28; anvil.add(foot2);
    // hot iron bar on the anvil
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.05), M(0xff7a24, { e: 0xff6a1a, ei: 2.2, r: 0.5 })); bar.position.y = 0.1; bar.rotation.y = 0.5; anvil.add(bar);
    anvil.position.set(0.6, 0.98, 0.3); g.add(anvil);
    // brazier with glowing coals
    const brazier = new THREE.Group();
    const bowl = lathe([[0.05, 0], [0.24, 0.05], [0.28, 0.2], [0.24, 0.26], [0.2, 0.22]], 12, ironM); brazier.add(bowl);
    for (let i = 0; i < 3; i++) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 6), ironM); const a = i / 3 * Math.PI * 2; lg.position.set(Math.cos(a) * 0.16, -0.12, Math.sin(a) * 0.16); lg.rotation.z = Math.cos(a) * 0.3; lg.rotation.x = -Math.sin(a) * 0.3; brazier.add(lg); }
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M(0xff5a1e, { e: 0xff5a1e, ei: 2.6, r: 0.4, smooth: true }));
    ember.scale.y = 0.6; ember.position.y = 0.22; brazier.add(ember);
    brazier.position.set(-0.72, 0.38, 0.52); g.add(brazier);
    g.userData.ember = ember;
    // quench bucket
    const bucket = lathe([[0.11, 0], [0.15, 0.02], [0.16, 0.24], [0.13, 0.24], [0.12, 0.04]], 12, woodM);
    bucket.position.set(0.86, 0.11, -0.28); g.add(bucket);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.125, 12), M(0x1a3a52, { r: 0.2, e: 0x0c2436, ei: 0.5 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0.86, 0.3, -0.28); g.add(water);
  } else if (ntype === "sage") {
    // ── SAGE: glowing rune circle, layered hooded robe, long beard, crystal
    //    staff, floating tome + orbiting arcane shards ──
    tint = 0x8f6bff;
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.06, 0.09, 20), M(scifi ? 0x232c46 : 0x2a2142, { r: 0.9 }));
    dais.position.y = 0.045; g.add(dais);
    const rune = new THREE.Mesh(new THREE.CircleGeometry(0.99, 28),
      new THREE.MeshBasicMaterial({ map: _runeTex(), transparent: true, depthWrite: false }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = 0.095; rune.renderOrder = 2; g.add(rune);
    fig = figure({
      style: "robe", robeC: scifi ? 0x4a3d94 : 0x5a46a8, robeE: scifi ? 0x241c72 : 0x1e1452,
      innerC: 0x3a2c78, trimC: scifi ? 0x35e0e8 : 0xc7b2f0, beltC: 0x2c2058,
      hood: scifi ? 0x3a2f80 : 0x443386, beard: { c: scifi ? 0xbfc9e6 : 0xece7da, len: 0.62 }, browC: 0xd8d2c4,
      sleeves: true,
      poses: { r: { x: -1.25, z: -0.12 }, l: { x: -1.05, z: 0.42 } },
    });
    fig.scale.setScalar(1.07); fig.rotation.y = 0.16; fig.position.set(-0.1, 0.1, -0.06); g.add(fig);
    // crystal staff (gnarled shaft + gold claw + glowing octahedron)
    const staff = new THREE.Group();
    staff.add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 2.05, 7), woodM).translateY(1.02));
    for (const yy of [0.55, 1.25]) { const knot = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 6, 10), woodM); knot.rotation.x = Math.PI / 2; knot.position.y = yy; staff.add(knot); }
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.026, 8, 14), goldM); claw.position.y = 2.06; claw.rotation.x = Math.PI / 2; staff.add(claw);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), M(tint, { e: tint, ei: 3.0, r: 0.15, m: 0.1 }));
    crystal.position.y = 2.2; crystal.rotation.y = 0.5; staff.add(crystal);
    staff.position.set(0.52, 0.1, 0.16); staff.rotation.z = -0.06; g.add(staff);
    g.userData.crystal = crystal;
    // floating tome above the open left palm
    const tome = new THREE.Group();
    const covM = M(scifi ? 0x1f2a5e : 0x3a2a6e, { r: 0.7 });
    for (const sx of [-1, 1]) {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.026, 0.4), covM);
      cover.position.set(sx * 0.145, 0, 0); cover.rotation.z = sx * 0.3; tome.add(cover);
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.35), M(0xf3ecd6, { r: 0.85, e: tint, ei: 0.3 }));
      page.position.set(sx * 0.13, 0.024, 0); page.rotation.z = sx * 0.28; tome.add(page);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), goldM); tome.add(spine);
    tome.position.set(-0.66, 1.5, 0.34); tome.rotation.set(0.15, 0.3, 0); g.add(tome);
    g.userData.tome = tome;
    // orbiting arcane shards
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.7;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), M(tint, { e: tint, ei: 2.2, r: 0.2 }));
      shard.position.set(Math.cos(a) * 0.72 - 0.1, 1.15 + i * 0.28, Math.sin(a) * 0.72);
      g.add(shard);
    }
  } else {
    // ── MERCHANT: patterned rug, capped trader w/ coin + ledger, draped
    //    counter w/ coin stacks + brass scale, strongbox, goods sack ──
    tint = 0xffd769;
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.18, 26),
      M(0xffffff, { map: _rugTex(scifi), r: 0.95, smooth: true }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.02; g.add(rug);
    fig = figure({
      style: "robe", robeC: scifi ? 0x1f7d8f : 0x3f8f5a, innerC: scifi ? 0x14545e : 0x2e6b42,
      trimC: scifi ? 0x35e0e8 : 0xd9a03f, beltC: scifi ? 0x0f3a44 : 0x5c3a1e,
      cap: scifi ? 0x124a5e : 0x7a4a22, feather: scifi ? 0x2ee6ff : 0xc23a3a,
      beard: { c: scifi ? 0x9fb2c4 : 0x54381f, len: 0.2 }, browC: 0x3a2415,
      poses: { r: { x: -1.75, z: 0.15 }, l: { x: -1.05, z: -0.25 } },
    });
    fig.rotation.y = 0.1; fig.position.set(0, 0.1, -0.3); g.add(fig);
    // held coin (right hand, offered forward) + ledger (left)
    const heldCoin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 14), coinM);
    heldCoin.rotation.x = Math.PI / 2; heldCoin.position.set(0, -0.42, 0.03); fig.userData.arms.r.add(heldCoin);
    const ledger = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.26), M(scifi ? 0x0f3a44 : 0x6e3b1e, { r: 0.8 }));
    ledger.position.set(0, -0.4, 0.02); fig.userData.arms.l.add(ledger);
    // draped counter
    const counter = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 0.55), woodM); top.position.y = 0.92; counter.add(top);
    const drape = new THREE.Mesh(new THREE.BoxGeometry(1.13, 0.62, 0.045), M(scifi ? 0x11485c : 0x8f2630, { r: 0.92, e: scifi ? 0x06333f : 0x2a0a0e, ei: 0.45 }));
    drape.position.set(0, 0.63, 0.26); counter.add(drape);
    const drapeTrim = new THREE.Mesh(new THREE.BoxGeometry(1.13, 0.07, 0.055), goldM); drapeTrim.position.set(0, 0.9, 0.26); counter.add(drapeTrim);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.88, 0.09), woodM); leg.position.set(sx * 0.5, 0.44, -0.16); counter.add(leg); }
    counter.position.set(0, 0, 0.52); g.add(counter);
    // coin stacks
    const stacks = [[-0.42, 4], [-0.28, 2], [-0.34, 3]];
    for (let s = 0; s < stacks.length; s++) {
      for (let i = 0; i < stacks[s][1]; i++) {
        const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.024, 12), coinM);
        cn.position.set(stacks[s][0], 0.98 + i * 0.026, 0.44 + s * 0.09); g.add(cn);
      }
    }
    // brass balance scale
    const scale = new THREE.Group();
    scale.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.34, 8), goldM).translateY(0.17));
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.022, 0.022), goldM); beam.position.y = 0.35; beam.rotation.z = 0.08; scale.add(beam);
    for (const sx of [-1, 1]) {
      const drop = sx < 0 ? 0.3 : 0.33;
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 4), goldM);
      chain.position.set(sx * 0.215, 0.35 + sx * 0.017 - 0.07, 0); scale.add(chain);
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.025, 12), goldM);
      pan.position.set(sx * 0.215, 0.35 + sx * 0.017 - 0.145, 0); scale.add(pan);
      if (sx > 0) { const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), coinM); c2.position.set(sx * 0.215, 0.36 + sx * 0.017 - 0.13, 0); scale.add(c2); }
    }
    scale.position.set(0.18, 0.965, 0.5); g.add(scale);
    // iron-banded strongbox
    const boxG = new THREE.Group();
    boxG.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.26), M(scifi ? 0x1d3a4a : 0x5c3a1e, { r: 0.85 })));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.36, 10, 1, false, 0, Math.PI), M(scifi ? 0x1d3a4a : 0x5c3a1e, { r: 0.85 }));
    lid.rotation.z = Math.PI / 2; lid.position.y = 0.12; boxG.add(lid);
    for (const sx of [-0.1, 0.1]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.28), ironM); band.position.set(sx * 3.4 * 0.1, 0.02, 0); boxG.add(band); }
    boxG.position.set(0.78, 0.13, -0.32); boxG.rotation.y = -0.5; g.add(boxG);
    // goods sack
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), M(scifi ? 0x35506a : 0x8a6a3e, { r: 0.95 }));
    sack.scale.set(1, 0.85, 1); sack.position.set(-0.78, 0.19, -0.3); g.add(sack);
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.1, 0.12, 8), M(scifi ? 0x2a4256 : 0x6e5230, { r: 0.95 }));
    tie.position.set(-0.78, 0.36, -0.3); g.add(tie);
  }
  g.userData.figure = fig;
  g.userData.tint = tint;
  return g;
}

/** Procedural breakable props (pot / urn / bones / canister) — flat-shaded
 *  low-poly to match the rest, no GLB assets needed. Returned as a group so the
 *  caller wraps it as { scene, animations: [] } for the clone path. */
export function makeProp(type, theme) {
  const scifi = theme === "scifi";
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: !o.smooth, roughness: o.r == null ? 0.88 : o.r, metalness: o.m == null ? (scifi ? 0.4 : 0.02) : o.m, emissive: o.e || 0x000000, emissiveIntensity: o.ei == null ? 1 : o.ei });
  const lathe = (pts, seg, mat) => new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg || 16), mat);
  if (type === "pot") {
    const clay = M(0xb06a3c, { r: 0.9 });
    g.add(lathe([[0.02, 0], [0.34, 0.06], [0.42, 0.32], [0.3, 0.6], [0.25, 0.68], [0.29, 0.76], [0.2, 0.78]], 18, clay));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.032, 8, 18), M(0x8a5230, { r: 0.9 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.78; g.add(rim);
    const crack = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.02), M(0x5a3820)); crack.position.set(0.32, 0.35, 0.12); crack.rotation.z = 0.2; g.add(crack);
  } else if (type === "urn") {
    const cer = M(0x76828e, { r: 0.7, m: 0.12 });
    g.add(lathe([[0.02, 0], [0.2, 0.04], [0.36, 0.42], [0.38, 0.72], [0.22, 0.94], [0.14, 1.02], [0.2, 1.12], [0.12, 1.16]], 18, cer));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.365, 0.16, 18, 1, true), M(0xb4472e, { r: 0.85 })); band.position.y = 0.58; g.add(band);
    for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.024, 6, 10, Math.PI), M(0x4a545e)); h.position.set(sx * 0.32, 0.84, 0); h.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(h); }
  } else if (type === "bones") {
    const bone = M(0xe8e2d0, { r: 0.82 });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), bone); skull.scale.set(1, 0.92, 1.12); skull.position.set(-0.05, 0.17, 0.02); g.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.17), bone); jaw.position.set(-0.05, 0.07, 0.08); g.add(jaw);
    for (const [ex, ez] of [[0.06, -0.05], [-0.16, -0.02]]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), M(0x201a14)); e.position.set(skull.position.x + ex, 0.19, 0.14 + ez); g.add(e); }
    for (const [x, z, rot] of [[0.28, 0.08, 0.5], [0.22, -0.18, -0.6], [-0.02, 0.28, 1.25], [-0.28, -0.12, -0.2]]) {
      const b = new THREE.Group();
      b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.36, 7), bone));
      for (const yy of [-1, 1]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), bone); k.position.y = yy * 0.2; b.add(k); }
      b.position.set(x, 0.05, z); b.rotation.set(Math.PI / 2 * 0.85, rot, rot * 0.4); g.add(b);
    }
  } else { // canister (sci-fi)
    const metal = M(0x8792a0, { r: 0.45, m: 0.8 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.92, 16), metal).translateY(0.46));
    for (const yy of [0.18, 0.74]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 18), M(0x3a4450, { m: 0.7 })); ring.rotation.x = Math.PI / 2; ring.position.y = yy; g.add(ring); }
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.16, 16), M(0x35e0e8, { e: 0x35e0e8, ei: 1.9, r: 0.3, m: 0.1 })); glow.position.y = 0.5; g.add(glow);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.13, 16), M(0x2a3340, { m: 0.8 })); cap.position.y = 0.98; g.add(cap);
  }
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

// Procedural DOOR that fills a wall opening: two stone jambs + a lintel (so it
// reads as "a door set into the wall", replacing a wall segment) plus a styled
// leaf. Types: wood (planked + iron bands), iron (studded slab), bars
// (portcullis — see-through vertical bars), ornate (arched, gold-trimmed).
// Built along local X (the doorway spans X); callers rotate the group onto the
// edge. locked=true shows a barred/lock look. CELL≈4, wall height ≈4.4.
export const DOOR_TYPES = ["wood", "iron", "bars", "ornate"];
export function makeDoor(type, opts = {}) {
  const H = 4.2, W = 3.4, T = 0.34;           // opening height, width, thickness
  const grp = new THREE.Group();
  const stone = () => new THREE.MeshStandardMaterial({ color: 0x5b647a, roughness: 0.9, metalness: 0.05 });
  const iron = () => new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.5, metalness: 0.85 });
  const woodM = () => new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
  const gold = () => new THREE.MeshStandardMaterial({ color: 0xe8b83a, roughness: 0.3, metalness: 0.9 });
  // frame: two jambs + a lintel that clearly seat the door in the wall line
  const jw = 0.55;
  for (const sx of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(jw, H, T + 0.12), stone());
    jamb.position.set(sx * (W / 2 + jw / 2 - 0.05), H / 2, 0); grp.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + jw * 2, 0.6, T + 0.12), stone());
  lintel.position.set(0, H - 0.3, 0); grp.add(lintel);
  // the leaf (hinged on the left jamb → offset the pivot so Rotate/flip reads)
  const leaf = new THREE.Group();
  leaf.position.set(-W / 2, 0, 0);            // hinge at the left jamb
  grp.add(leaf); grp.userData.leaf = leaf;
  const lw = W - 0.15, lh = H - 0.5;
  const mk = (g, m) => { const me = new THREE.Mesh(g, m); leaf.add(me); return me; };
  if (type === "bars") {
    // portcullis: a top rail + vertical bars (see-through)
    mk(new THREE.BoxGeometry(lw, 0.2, T), iron()).position.set(W / 2, lh - 0.1, 0);
    mk(new THREE.BoxGeometry(lw, 0.2, T), iron()).position.set(W / 2, 0.6, 0);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const bar = mk(new THREE.CylinderGeometry(0.09, 0.09, lh, 8), iron());
      bar.position.set(0.3 + i * (lw / (n - 1)) * 0.92, lh / 2 + 0.35, 0);
    }
  } else if (type === "iron") {
    const slab = mk(new THREE.BoxGeometry(lw, lh, T), iron()); slab.position.set(W / 2, lh / 2 + 0.35, 0);
    // rivets
    for (let ix = 0; ix < 3; ix++) for (let iy = 0; iy < 4; iy++) {
      const r = mk(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0ae, metalness: 0.95, roughness: 0.3 }));
      r.position.set(0.7 + ix * (lw - 1.4) / 2, 0.9 + iy * (lh - 0.9) / 3, T / 2);
    }
  } else if (type === "ornate") {
    const slab = mk(new THREE.BoxGeometry(lw, lh, T), woodM()); slab.position.set(W / 2, lh / 2 + 0.35, 0);
    // gold arch trim + central boss
    const arch = mk(new THREE.TorusGeometry(lw / 2.3, 0.08, 8, 20, Math.PI), gold());
    arch.position.set(W / 2, lh + 0.1, T / 2); arch.rotation.z = 0;
    const boss = mk(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16), gold());
    boss.rotation.x = Math.PI / 2; boss.position.set(W / 2, lh / 2 + 0.35, T / 2 + 0.05);
    for (const sy of [0.9, lh - 0.2]) { const band = mk(new THREE.BoxGeometry(lw, 0.14, T + 0.04), gold()); band.position.set(W / 2, sy, 0); }
  } else {
    // wood (default): vertical planks + two iron bands + a ring handle
    const nPl = 5;
    for (let i = 0; i < nPl; i++) {
      const pl = mk(new THREE.BoxGeometry(lw / nPl - 0.04, lh, T), woodM());
      pl.position.set(0.2 + i * (lw / nPl) + (lw / nPl) / 2 - 0.1, lh / 2 + 0.35, 0);
    }
    for (const sy of [1.1, lh - 0.1]) { const band = mk(new THREE.BoxGeometry(lw, 0.18, T + 0.05), iron()); band.position.set(W / 2, sy, 0); }
    const ring = mk(new THREE.TorusGeometry(0.16, 0.045, 8, 16), iron()); ring.position.set(W - 0.5, lh / 2 + 0.35, T / 2 + 0.04);
  }
  if (opts.flip) grp.scale.x = -1;             // Rotate = swap the hinge side
  return grp;
}

// A cluster of pointed steel spikes for the pop-up spike trap — real spikes
// (sharp cones) that sit under the floor and thrust UP when the trap fires,
// not a GLB blob. Built around local origin; the trap render sinks it below the
// floor and animates it up.
export function makeSpikes() {
  const grp = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc8, metalness: 0.9, roughness: 0.32 });
  const tip = new THREE.MeshStandardMaterial({ color: 0xe6e9f0, metalness: 0.95, roughness: 0.2 });
  const rows = [-1.1, 0, 1.1];
  for (const gx of rows) for (const gz of rows) {
    const jx = gx * 0.9 + (gx === 0 ? 0 : 0), jz = gz * 0.9;
    const h = 1.5 + ((gx + gz) % 2 === 0 ? 0.35 : 0);   // slight height variation
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.24, h, 6), steel);
    spike.position.set(jx, h / 2, jz);
    grp.add(spike);
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 6), tip);
    point.position.set(jx, h + 0.16, jz);
    grp.add(point);
  }
  // a dark base plate the spikes retract into
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 3.3),
    new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.95 }));
  base.position.y = -0.15; grp.add(base);
  return grp;
}

// Procedural replacements for decor GLBs whose Kenney export shipped a broken
// 1×1 texture (barrel/bookshelf render flat-untextured). Colored materials, so
// they always look right. ~1.6u tall to match a cell prop.
// A wall-mounted torch: a small bracket + short stub + flame, built facing +Z
// (into the room). The renderer rotates/offsets it onto the cell's wall side.
export function makeWallTorch(theme) {
  const grp = new THREE.Group();
  const fantasy = theme !== "scifi";
  const metal = new THREE.MeshStandardMaterial({ color: fantasy ? 0x2a2620 : 0x2a3340, metalness: 0.7, roughness: 0.45 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.12), metal); back.position.set(0, 0, -0.02); grp.add(back);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), metal);
  arm.rotation.x = -Math.PI / 3.2; arm.position.set(0, 0.14, 0.2); grp.add(arm);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.09, 0.16, 8), metal); cup.position.set(0, 0.35, 0.38); grp.add(cup);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8),
    new THREE.MeshStandardMaterial({ color: fantasy ? 0xffb347 : 0x66eaff, emissive: fantasy ? 0xff8a1f : 0x37e0ff, emissiveIntensity: 2.6 }));
  flame.position.set(0, 0.5, 0.38); flame.scale.y = 1.4; grp.add(flame);
  return grp;
}
export function makeBarrel(theme) {
  const grp = new THREE.Group();
  const scifi = theme === "scifi";
  const wood = new THREE.MeshStandardMaterial({ color: scifi ? 0x3a4656 : 0x6e4a2a, roughness: 0.8, metalness: scifi ? 0.5 : 0 });
  const hoop = new THREE.MeshStandardMaterial({ color: scifi ? 0x8792a0 : 0x4a3524, metalness: 0.8, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.52, 1.5, 16), wood);
  body.position.y = 0.75; grp.add(body);
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.9, 16), wood);
  belly.position.y = 0.75; grp.add(belly);
  for (const y of [0.24, 0.75, 1.26]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(y === 0.75 ? 0.69 : 0.6, 0.05, 8, 20), hoop);
    ring.rotation.x = Math.PI / 2; ring.position.y = y; grp.add(ring);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), new THREE.MeshStandardMaterial({ color: scifi ? 0x2a3340 : 0x5a3c22, roughness: 0.85 }));
  lid.position.y = 1.5; grp.add(lid);
  if (scifi) { const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 16), new THREE.MeshStandardMaterial({ color: 0x35e0e8, emissive: 0x35e0e8, emissiveIntensity: 1.6 })); glow.position.y = 0.9; grp.add(glow); }
  return grp;
}
export function makeBookshelf() {
  const grp = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.85 });
  const W = 1.7, H = 2.4, D = 0.55;
  const panel = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood); m.position.set(x, y, z); grp.add(m); };
  panel(W, 0.12, D, 0, 0.06, 0); panel(W, 0.12, D, 0, H, 0);                 // top + bottom
  panel(0.12, H, D, -W / 2 + 0.06, H / 2, 0); panel(0.12, H, D, W / 2 - 0.06, H / 2, 0); // sides
  panel(W, 0.1, D, 0, H * 0.5, 0);            // middle shelf
  panel(W, H, 0.08, 0, H / 2, -D / 2 + 0.04); // back
  // rows of colored book spines on the two shelves
  const cols = [0x8a2f2f, 0x2f5a8a, 0x2f8a4a, 0xb0862f, 0x6a3a8a, 0x8a5a2f];
  for (const shelfY of [0.35, H * 0.5 + 0.28]) {
    let bx = -W / 2 + 0.2;
    while (bx < W / 2 - 0.2) {
      const bw = 0.1 + (Math.abs(Math.sin(bx * 12)) * 0.09);
      const bh = 0.7 + Math.abs(Math.sin(bx * 7)) * 0.25;
      const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.34),
        new THREE.MeshStandardMaterial({ color: cols[(Math.abs(Math.sin(bx * 20) * cols.length) | 0) % cols.length], roughness: 0.75 }));
      book.position.set(bx + bw / 2, shelfY + bh / 2, 0.05); grp.add(book);
      bx += bw + 0.015;
    }
  }
  return grp;
}
// One place that turns a decor dtype into a mesh — procedural for the broken GLBs
// (torch/wall-torch/barrel/bookshelf), the GLB clone otherwise. `clone` clones a
// loaded template; `props` is the loaded prop set. Returns {mesh, foot} where
// foot is the target height (null = use the mesh as built).
export function decorMesh(dtype, theme, props, clone) {
  if (dtype === "wall-torch") return { mesh: makeWallTorch(theme), foot: null };
  if (dtype === "torch") return { mesh: makeTorch(theme), foot: null };
  if (dtype === "barrel") return { mesh: makeBarrel(theme), foot: null };
  if (dtype === "bookshelf") return { mesh: makeBookshelf(), foot: null };
  const tpl = (props && props[dtype]) || (props && props.crate);
  return { mesh: tpl ? clone(tpl) : null, foot: "glb" };
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
  // corner height comes from the SIM (D.cornerHeight) so the rendered slope and
  // the walk/placement surface (D.surfaceHeightAt) can never disagree
  const cornerH = (cx, cz) => D.cornerHeight(d, f, cx, cz);

  // flat cells (terrain mesh doesn't cover) split by surface: default → kit stone
  // tile; a chosen floor texture → a procedural textured plane laid on the tile top.
  const flat = byType[1].filter(([x, z]) => !terrain.has(D.ck(x, z)));
  const flatDefault = [], flatTex = new Map();
  for (const [x, z] of flat) {
    const t = fl.tex && fl.tex[D.ck(x, z)];
    if (t && t !== "stone") (flatTex.get(t) || flatTex.set(t, []).get(t)).push([x, z]);
    else flatDefault.push([x, z]);
  }
  const kitFloorAt = (list) => {
    const inst = makeInstanced(kit.floor.scene, list.length);
    list.forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, 0, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
    inst.setCount(list.length); inst.commit();
    group.add(inst.group);
  };
  if (flatDefault.length) kitFloorAt(flatDefault);
  if (flatTex.size) {
    kit.floor.scene.updateMatrixWorld(true);
    const topY = (() => { const b = new THREE.Box3().setFromObject(kit.floor.scene); return isFinite(b.max.y) ? b.max.y : 0.2; })();
    const planeGeo = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
    for (const [texId, list] of flatTex) {
      const map = floorTexture(texId);
      if (!map) { kitFloorAt(list); continue; }               // unknown id → kit tile
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.94, metalness: 0.0 });
      const inst = new THREE.InstancedMesh(planeGeo, mat, list.length);
      inst.frustumCulled = false;
      list.forEach(([x, z], i) => { m4.makeTranslation(x * CELL + CELL / 2, topY + 0.012, z * CELL + CELL / 2); inst.setMatrixAt(i, m4); });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
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
