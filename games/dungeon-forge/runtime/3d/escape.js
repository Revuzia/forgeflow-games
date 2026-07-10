/**
 * Dungeon Forge — runtime/3d/escape.js
 * ESCAPE MODE: renders the active floor of the dungeon, drives the headless
 * escape sim from player input (pointer-lock mouse look + WASD), third-person
 * chase camera with a first-person toggle, animated player characters and
 * enemies, doors/chests/keys/traps/portal visuals, and multiplayer co-op
 * (own player broadcast; host-fed enemies; relayed world events).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const D = await import("../sim/dungeon.js" + V);
const E = await import("../sim/escape_sim.js" + V);
const { makeInstanced, Assets, charClips, makeTorch, makeCellSurfaces, makeNpc, findArmBones, relaxArms } = await import("./assets.js" + V);
const { EnemyPool } = await import("./enemies.js" + V);

const FLOOR_H = 4.4;
const CELL = D.CELL;
const c2w = E.c2w;
const _swingAxis = new THREE.Vector3(); // scratch: character right-vector for gait arm-swing

const SKINS = ["knight", "barbarian", "sorceress", "rogue"];
const TIER_COLORS = [0x8a6a4a, 0xcfd6e4, 0xffd769]; // bronze / steel / gold

// Per-class weapon grip: all class weapons are modelled along local +Y. gripFrac
// = where along the weapon's height the fist closes (0 = butt, 1 = tip); rest =
// the desired world direction of the +Y shaft in the character's frame (+Z fwd,
// +Y up) at the idle stance. The grip is placed at the hand and the shaft is
// oriented from the hand-bone's real world basis, so it stops clipping the hip.
// palm = how far to push the grip INTO the fist along the hand bone (Thronedrift's
// missing-in-DF calibration — without it the weapon floats at the wrist joint).
const WEAPON_CFG = {
  knight:    { scale: 1.0, gripFrac: 0.14, palm: 0.12, rest: [0.12, 0.90, 0.42] }, // sword: blade UP-fwd
  barbarian: { scale: 1.0, gripFrac: 0.13, palm: 0.13, rest: [0.10, 0.95, 0.30] }, // greatblade: up
  sorceress: { scale: 1.0, gripFrac: 0.44, palm: 0.12, rest: [0.05, 0.99, 0.14] }, // staff: orb up
  rogue:     { scale: 0.95, gripFrac: 0.20, palm: 0.10, rest: [0.10, 0.55, 0.83] }, // dagger: fwd-up
};
// Rigs regenerated from clean T-pose art: their idle clip stands naturally, so we
// DON'T relaxArms at rest (only during walk/run) and compute the grip on the real
// idle pose. Old rigs + enemies (no idle clip) keep relax-always. Add each class
// here as it is regenerated through meshy_chars_img.py.
const CLEAN_RIGS = new Set(["knight", "barbarian", "sorceress", "rogue"]);
const _wq = new THREE.Quaternion(), _wq2 = new THREE.Quaternion(), _wv = new THREE.Vector3(), _wy = new THREE.Vector3(0, 1, 0), _wz = new THREE.Vector3(0, 0, 1);
const _wp = new THREE.Vector3(), _wsc = new THREE.Vector3();
/** Scale a holder to cancel a bone's ACTUAL world scale (Meshy armatures bind
 *  bones at ~0.01 and rigScale does not match it — measure it directly). */
function boneCounterScale(bone) { bone.matrixWorld.decompose(_wp, _wq, _wsc); return 1 / Math.max(1e-5, _wsc.x); }

export class Escape {
  constructor(game) {
    this.g = game;
    this._listeners = [];
    // input/camera state must exist before the first update() — the game loop
    // can tick us mid-load, before the async enter() finishes _bindInput().
    this.keys = {};
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.ready = false;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async enter(dungeon, opts = {}) {
    this.d = dungeon;
    this.opts = opts;
    this.session = opts.session || null;
    this.returnTo = opts.returnTo || "menu"; // builder test-play returns to builder
    this.fp = false;

    const players = opts.players || [{ id: "me", name: opts.playerName || "Adventurer", skin: opts.skin || 0 }];
    this.myId = opts.myId || players[0].id;
    this.run = E.newRun(dungeon, opts.runSeed != null ? opts.runSeed : ((Math.random() * 0xffffffff) >>> 0), players);
    this.simEnemies = this.session ? this.session.isHost() : true;
    this.localIds = new Set([this.myId]);

    this.kit = await this.g.assets.kit(dungeon.theme);
    this.props = await this.g.assets.props(dungeon.theme);
    this.items = await this.g.assets.items();
    this.charTpls = await this.g.assets.chars();

    this.root = new THREE.Group();
    this.g.world.add(this.root);
    this.floorGroups = [];
    this.objMeshes = new Map();
    this.doorLeafs = new Map();   // door id → {leaf, bars, mixer, openClip, closeClip, open}
    this.itemMeshes = new Map();  // key id → mesh (floor keys + dropped)
    this.lightPool = [];
    this.lavaMats = []; this.waterMats = []; this.lavaSpots = [];
    this.target = null;           // soft-locked enemy
    for (let f = 0; f < dungeon.floors.length; f++) this.floorGroups.push(this._buildFloor(f));

    // target highlight ring (one shared mesh, repositioned under the lock)
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.05, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5566, transparent: true, opacity: 0.85, depthWrite: false }));
    this.targetRing.visible = false;
    this.root.add(this.targetRing);

    // players
    this.actors = new Map();
    for (const p of this.run.players) await this._makeActor(p);

    // enemies
    this.enemies = new EnemyPool(this.g, this.root, this.d);
    await this.enemies.init(this.run);

    // camera
    this.camYaw = this.run.players[0].yaw + Math.PI;
    this.camPitch = 0.42;
    this.camDist = 7.5;

    this._bindInput();
    this.g.hud.showEscape(this);
    if (this.session) this.session.bindEscape(this);
    this._syncFloorVis(true);
    this.ready = true;   // now safe for update() to run the sim + read input
    this.g.audit("escape.enter seed=" + this.run.runSeed);
  }

  exit() {
    this.ready = false;
    this._unbindInput();
    document.exitPointerLock && document.exitPointerLock();
    this.g.hud.hideEscape();
    if (this.session) this.session.bindEscape(null);
    this.g.world.remove(this.root);
    this.objMeshes.clear(); this.doorLeafs.clear(); this.itemMeshes.clear();
  }

  me() { return this.run.players.find((p) => p.id === this.myId); }

  // ── world build (mirrors builder rendering, play-flavored) ─────────────────
  _buildFloor(f) {
    const fl = this.d.floors[f];
    const group = new THREE.Group();
    group.position.y = f * FLOOR_H;
    this.root.add(group);
    const m4 = new THREE.Matrix4();

    // cell surfaces: stone / lava / water / raised+steps
    const surf = makeCellSurfaces(D, this.d, f, this.kit);
    group.add(surf.group);
    if (surf.lavaMat) this.lavaMats.push(surf.lavaMat);
    if (surf.waterMat) this.waterMats.push(surf.waterMat);
    for (const [x, z] of surf.lavaCells) this.lavaSpots.push({ x: x * CELL + CELL / 2, z: z * CELL + CELL / 2, f });

    const segs = D.wallSegments(this.d, f);
    const wInst = makeInstanced(this.kit.wall.scene, Math.max(1, segs.length));
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    segs.forEach((s, i) => {
      const dir = D.DIRS[s.side];
      pos.set(s.x * CELL + CELL / 2 + dir.dx * (CELL / 2 - 0.12), 0, s.z * CELL + CELL / 2 + dir.dz * (CELL / 2 - 0.12));
      const yaw = s.side === 0 ? Math.PI : s.side === 1 ? -Math.PI / 2 : s.side === 2 ? 0 : Math.PI / 2;
      q.setFromAxisAngle(up, yaw);
      m4.compose(pos, q, one);
      wInst.setMatrixAt(i, m4);
    });
    wInst.setCount(segs.length); wInst.commit();
    group.add(wInst.group);

    // ceiling for escape mode (floor tiles of the level above OR a dark plane) — skip: fog + darkness read as ceiling

    for (const o of fl.objects) {
      const mesh = this._objMesh(o, f);
      if (mesh) {
        mesh.position.y += D.cellHeight(this.d, f, o.x, o.z); // raised platforms lift objects
        mesh.userData = { id: o.id, f, kind: o.kind };
        group.add(mesh);
        this.objMeshes.set(o.id, mesh);
      }
    }
    return { group, count: Object.keys(fl.cells).length };
  }

  _objMesh(o, f) {
    const A = this.g.assets;
    const grp = new THREE.Group();
    grp.position.set(o.x * CELL + CELL / 2, 0, o.z * CELL + CELL / 2);
    grp.rotation.y = -(o.rot || 0) * Math.PI / 2;
    const add = (tpl, h, foot) => {
      if (!tpl) return null;
      const m = A.clone(tpl);
      if (h) Assets.normalizeH(m, h); else if (foot) Assets.normalizeFoot(m, foot);
      grp.add(m); return m;
    };
    switch (o.kind) {
      case "door": {
        grp.rotation.y = D.doorAxis(this.d, f, o.x, o.z) === 0 ? -Math.PI / 2 : 0; // face the doorway
        add(this.kit.gate);
        const leafTpl = this.kit.gateDoor;
        const leaf = A.clone(leafTpl); grp.add(leaf);
        let mixer = null, openClip = null, closeClip = null;
        if (leafTpl.animations && leafTpl.animations.length) {
          mixer = new THREE.AnimationMixer(leaf);
          openClip = leafTpl.animations.find((a) => a.name === "open") || leafTpl.animations[0];
          closeClip = leafTpl.animations.find((a) => a.name === "close");
        }
        let bars = null;
        if (o.locked) { bars = add(this.kit.gateLocked); bars.position.z += 0.03; }
        const lock = o.locked ? this._sprite("🔒", 1.2, 4.5) : null;
        if (lock) grp.add(lock);
        this.doorLeafs.set(o.id, { grp, leaf, bars, lock, mixer, openClip, closeClip, open: false });
        break;
      }
      case "stairs": {
        const m = add(this.kit.stairs);
        if (m) {
          const b = new THREE.Box3().setFromObject(m); const size = b.getSize(new THREE.Vector3());
          m.scale.multiplyScalar(Math.min((CELL * 2) / Math.max(size.z, 0.01), (FLOOR_H + 0.15) / Math.max(size.y, 0.01)));
          const b2 = new THREE.Box3().setFromObject(m); m.position.y -= b2.min.y;
          m.position.z += CELL / 2;
        }
        break;
      }
      case "chest": {
        const m = add(this.props.chest || this.props.chestShared, 1.5);
        grp.userData.lid = m;
        break;
      }
      case "key": {
        // floor keys only (bound keys appear via chest/enemy)
        const bound = D.objsAt(this.d, f, o.x, o.z).some((c) => c.kind === "chest" || c.kind === "enemy");
        if (!bound) {
          const k = add(this.items.key, null, 1.0);
          if (k) k.position.y = 0.85;
          const gl = new THREE.PointLight(0xffd769, 5, 6); gl.position.y = 1.2; grp.add(gl);
          grp.userData.spinKey = true;
          this.itemMeshes.set(o.id, grp);
        } else return null;
        break;
      }
      case "enemy": return null; // EnemyPool owns these
      case "trap": {
        if (o.ttype === "vent") {
          const hot = this.d.theme === "scifi" ? 0xff2244 : 0xff6a00;
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 20),
            new THREE.MeshStandardMaterial({ color: 0x2a2a33, emissive: hot, emissiveIntensity: 0.25 }));
          disc.position.y = 0.06; grp.add(disc);
          grp.userData.ventDisc = disc;
        } else {
          const m = add(this.props.spikeShared || this.props["spike-trap"], null, CELL * 0.82);
          grp.userData.spikes = m;
          if (m) m.position.y = -0.9; // hidden; rises when active
        }
        break;
      }
      case "torch": {
        grp.add(makeTorch(this.d.theme));
        const l = new THREE.PointLight(this.g.look.torch, this.g.look.torchI * 0.35, 18, 1.35);
        l.position.y = 2.7; grp.add(l);
        this.lightPool.push({ light: l, base: this.g.look.torchI * 0.35, grp, f });
        this.g.fx.attachFlame(grp, this.d.theme, 2.45);
        break;
      }
      case "light": {
        // toned down (was intensity 11 + emissive 2.6 → blinding bloom halos)
        const col = new THREE.Color(o.color || (this.d.theme === "scifi" ? "#37e0ff" : "#ff9a3c"));
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1 }));
        orb.position.y = 3.1; grp.add(orb);
        const l = new THREE.PointLight(col, 4.5, 15, 1.5); l.position.y = 3.0; grp.add(l);
        this.lightPool.push({ light: l, base: 4.5, grp, f });
        break;
      }
      case "decor": {
        const tpl = this.props[o.dtype] || this.props.crate;
        const m = add(tpl, null, D.DECOR_FOOT[o.dtype] || 1.8);
        if (m) m.userData.decorId = o.id;
        break;
      }
      case "npc": {
        const T = D.NPC_TYPES[o.ntype] || D.NPC_TYPES.merchant;
        grp.add(makeNpc(o.ntype, this.d.theme));
        grp.add(this._sprite(T.icon, 0.8, 3.2));
        const l = new THREE.PointLight(T.tint || 0xffd769, this.g.look.torchI * 0.3, 12, 1.4);
        l.position.y = 2.7; grp.add(l);
        this.lightPool.push({ light: l, base: this.g.look.torchI * 0.3, grp, f });
        grp.userData.merchant = true;
        break;
      }
      case "spawn": {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 28).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x59ff9c, transparent: true, opacity: 0.25 }));
        ring.position.y = 0.05; grp.add(ring);
        break;
      }
      case "exit": {
        const torus = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.18, 12, 36),
          new THREE.MeshStandardMaterial({ color: 0x111122, emissive: this.g.look.portal, emissiveIntensity: 3.2 }));
        torus.position.y = 1.8; grp.add(torus);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.28, 30),
          new THREE.MeshBasicMaterial({ color: this.g.look.portal, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
        disc.position.y = 1.8; grp.add(disc);
        const l = new THREE.PointLight(this.g.look.portal, 14, 16, 1.5); l.position.y = 2; grp.add(l);
        grp.userData.portal = torus;
        this.g.fx.attachPortal(grp, this.g.look.portal);
        break;
      }
      default: return null;
    }
    return grp;
  }

  _sprite(ch, scale, y) {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const g2 = c.getContext("2d"); g2.font = "72px serif"; g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillText(ch, 48, 54);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(scale, scale, 1); spr.position.y = y;
    return spr;
  }

  // ── actors (players) ───────────────────────────────────────────────────────
  async _makeActor(p) {
    const skin = SKINS[(p.skin || 0) % SKINS.length];
    const tpl = this.charTpls[skin] || Object.values(this.charTpls)[0];
    const obj = this.g.assets.clone(tpl);
    // pose before measuring — several of these rigs bind lying flat (see poseRig)
    const { poseRig } = await import("./assets.js" + V);
    const posed = poseRig(obj, tpl.animations, THREE);
    obj.scale.multiplyScalar(1.72 / posed.height);
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    if (isFinite(bb.min.y)) obj.position.y -= Math.max(-2, Math.min(2, bb.min.y));
    const grp = new THREE.Group();
    grp.add(obj);

    // find rig attachment bones once (hand for weapons, spine/head for armor)
    const bones = { hand: null, handL: null, spine: null, head: null, shoulderL: null, shoulderR: null };
    obj.traverse((b) => {
      if (!b.isBone) return;
      const n = b.name.toLowerCase();
      if (!bones.hand && /(hand|wrist|fist).*(r|right)|(r|right).*(hand|wrist|fist)/.test(n)) bones.hand = b;
      if (!bones.handL && /(hand|wrist|fist).*(l|left)|(l|left).*(hand|wrist|fist)/.test(n) && !/right/.test(n)) bones.handL = b;
      if (!bones.spine && /spine|chest|torso/.test(n)) bones.spine = b;
      if (!bones.head && /head/.test(n)) bones.head = b;
      if (!bones.shoulderL && /(shoulder|upper_?arm|clavicle).*(l|left)|(l|left).*(shoulder|upper_?arm|clavicle)/.test(n)) bones.shoulderL = b;
      if (!bones.shoulderR && /(shoulder|upper_?arm|clavicle).*(r|right)|(r|right).*(shoulder|upper_?arm|clavicle)/.test(n)) bones.shoulderR = b;
    });

    const mixer = posed.mixer || new THREE.AnimationMixer(obj);
    const clips = charClips(tpl.animations);
    const actions = {};
    for (const k of Object.keys(clips)) if (clips[k]) { actions[k] = mixer.clipAction(clips[k]); }
    // Walk-only rigs: run = walk at higher speed
    if (actions.run && clips.run === clips.walk) actions.run.timeScale = 1.5;
    // Register the Meshy COMBAT clips (C_slash1/C_slash2/C_finisher/C_parry/
    // C_melee/C_cast1/C_cast2/C_hit/C_death) by their raw names — charClips only
    // maps the idle/walk/run/death locomotion set, so without this every attack
    // fell back to the crude procedural swing instead of the real animation.
    for (const clip of (tpl.animations || [])) {
      if (/^C_/.test(clip.name) && !actions[clip.name]) actions[clip.name] = mixer.clipAction(clip);
    }
    const tag = p.id === this.myId ? null : this._nameTag(p.name);
    if (tag) { tag.position.y = 2.3; grp.add(tag); }
    this.root.add(grp);
    const a = { p, grp, obj, mixer, actions, cur: null, oneshotT: 0, bones, armBones: findArmBones(obj), relaxW: 0, rigScale: obj.scale.x, equip: {}, cleanRig: CLEAN_RIGS.has(p.cls) };
    this._refreshEquip(a);
    this._playAnim(a, "idle");
    this.actors.set(p.id, a);
    return a;
  }

  /** (Re)build visible equipment on the rig — weapon in hand, armor on body.
   *  Everything parents to BONES so it rides every animation. */
  _refreshEquip(a) {
    const p = a.p;
    // clear old
    for (const k of Object.keys(a.equip)) { const m = a.equip[k]; if (m && m.parent) m.parent.remove(m); delete a.equip[k]; }
    const cls = p.cls || "knight";
    const tierTint = (root) => {
      if (p.weaponTier > 0) {
        const col = TIER_COLORS[Math.min(2, p.weaponTier - 1)];
        root.traverse((m) => { if (m.isMesh && m.material) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(col); m.material.emissiveIntensity = 0.55; } });
      }
    };
    const mount = (mesh, bone, scale) => {
      a.obj.updateMatrixWorld(true);
      const holder = new THREE.Group();
      holder.scale.setScalar(boneCounterScale(bone) * (scale || 1));
      holder.add(mesh);
      bone.add(holder);
      return holder;
    };
    // class weapons — gripped in the fist + oriented from the hand-bone world
    // basis (a blind Euler pointed the Meshy hand's arbitrary axes through the
    // hip). Pose the rig at its idle/relaxed rest first so the grip transform
    // matches how the player actually stands.
    if (a.bones.hand) {
      // settle the idle clip so the grip is computed at how the player really stands.
      // Clean T-pose rigs stand naturally → no relaxArms at rest; old rigs still relax.
      if (a.actions && a.actions.idle) { a.actions.idle.reset().play(); a.mixer.update(a.cleanRig ? 0.35 : 0); }
      a.obj.updateMatrixWorld(true);
      if (a.armBones && !a.cleanRig) { relaxArms(a.armBones, 1); a.obj.updateMatrixWorld(true); }
      const cfg = WEAPON_CFG[cls] || WEAPON_CFG.knight;
      // every class uses a proper procedural weapon now (Thronedrift set) — the
      // knight no longer falls back to the untextured Kenney prop.
      const main = Assets.makeClassWeapon(cls);
      main.scale.setScalar(1 + 0.06 * (p.weaponTier || 0));   // cfg.scale applied by _gripMount
      tierTint(main);
      a.equip.weapon = this._gripMount(a, main, a.bones.hand, cfg);
      if (cls === "rogue" && a.bones.handL) {
        const off = Assets.makeClassWeapon("rogue");
        off.scale.setScalar(1 + 0.06 * (p.weaponTier || 0));
        tierTint(off);
        a.equip.offhand = this._gripMount(a, off, a.bones.handL, cfg);
      }
      if (cls === "knight" && a.bones.handL) {
        // Shield: strap to the off hand, broad face pointing FORWARD. makeShield's
        // face normal is local +Z, so map +Z → the character's forward (rig-independent,
        // unlike the old raw local rotation that assumed the previous rig's hand axes).
        const sh = Assets.makeShield();
        const holder = new THREE.Group();
        a.obj.updateMatrixWorld(true);
        holder.scale.setScalar(boneCounterScale(a.bones.handL));
        holder.add(sh);
        a.bones.handL.add(holder);
        a.obj.updateMatrixWorld(true);
        a.bones.handL.getWorldQuaternion(_wq);
        _wv.set(0.25, 0.05, 1).normalize();                       // forward + slight outward
        _wq2.setFromUnitVectors(_wz, _wv);                        // shield +Z (face) → forward
        holder.quaternion.copy(_wq.invert().multiply(_wq2));
        sh.position.set(0.04, 0, 0.05);
        a.equip.shield = holder;
      }
    }
    // armor — chest plate + shoulder pads once found
    if (p.armorTier > 0 && a.bones.spine) {
      const col = TIER_COLORS[Math.min(2, p.armorTier - 1)];
      const mat = new THREE.MeshStandardMaterial({ color: col, metalness: 0.85, roughness: 0.35, emissive: col, emissiveIntensity: 0.12 });
      a.obj.updateMatrixWorld(true);
      const holder = new THREE.Group();
      holder.scale.setScalar(boneCounterScale(a.bones.spine));
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.5, 10, 1, true, -Math.PI * 0.7, Math.PI * 1.4), mat);
      plate.position.set(0, 0.12, 0.1);
      holder.add(plate);
      for (const side of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        pad.position.set(0.3 * side, 0.36, 0.02);
        holder.add(pad);
      }
      a.bones.spine.add(holder);
      a.equip.armor = holder;
    }
  }

  /** Grip a shaft weapon in the fist: place its grip at the hand and point its
   *  +Y shaft along cfg.rest (world dir in the character frame, +Z fwd / +Y up)
   *  using the hand bone's real world basis, computed once at the idle pose so it
   *  then follows every animation without clipping the body. */
  _gripMount(a, mesh, bone, cfg) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const h = Math.max(0.001, box.max.y - box.min.y);
    mesh.position.y -= box.min.y + h * (cfg.gripFrac != null ? cfg.gripFrac : 0.2); // grip → holder origin
    const counter = boneCounterScale(bone);           // cancel the bone's true world scale
    const holder = new THREE.Group();
    holder.scale.setScalar(counter * (cfg.scale || 1));
    // hand-bone origin = the WRIST; push the grip up into the palm/fist along the
    // bone's local +Y (scaled back into bone-local units) so it doesn't float.
    holder.position.y = (cfg.palm != null ? cfg.palm : 0.1) * counter;
    a.obj.updateMatrixWorld(true);
    holder.add(mesh);
    bone.add(holder);
    a.obj.updateMatrixWorld(true);
    bone.getWorldQuaternion(_wq);                     // hand world orientation
    _wv.fromArray(cfg.rest).normalize();              // desired shaft dir (char frame)
    _wq2.setFromUnitVectors(_wy, _wv);                // world quat mapping +Y → rest dir
    holder.quaternion.copy(_wq.invert().multiply(_wq2)); // → hand-bone local, follows animation
    return holder;
  }

  _nameTag(name) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.font = "700 30px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(20, 8, 216, 46);
    g.fillStyle = "#c9f7ff"; g.fillText((name || "friend").slice(0, 13), 128, 32);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(2.8, 0.7, 1);
    return spr;
  }

  /** Resolve a combat event to this class's Meshy clip name. */
  _clipFor(a, ev, stage) {
    const cls = a.p.cls || "knight";
    if (ev === "swing") {
      if (cls === "sorceress") return "C_melee";
      return stage === 3 ? "C_finisher" : stage === 2 ? "C_slash2" : "C_slash1";
    }
    if (ev === "bash") return "C_parry";
    if (ev === "crush") return "C_finisher";
    if (ev === "fire") return "C_cast1";
    if (ev === "frost") return "C_cast2";
    if (ev === "knife") return "C_slash1";
    if (ev === "hit") return "C_hit";
    if (ev === "death") return "C_death";
    return null;
  }

  /** Combo swing — plays the class's stage-1/2/finisher clip, fit to its cd. */
  _playCombo(a, stage) {
    const M = (E.CLASSES[a.p.cls] || E.CLASSES.knight).melee;
    this._playCombat(a, "swing", stage, (M.cd || 0.5) * 0.95);
  }

  /** Play a combat clip fitted into `fitS` seconds (or procedural fallback). */
  _playCombat(a, ev, stage, fitS) {
    const name = this._clipFor(a, ev, stage);
    const act = name && a.actions[name];
    if (!act) {
      this._procStart(a, ev === "swing" || ev === "crush" ? "attack" : ev === "bash" ? "attack" : ev);
      return;
    }
    const dur = act.getClip().duration || 1;
    act.timeScale = fitS ? Math.max(1, dur / fitS) : 1;
    act.reset(); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = ev === "death"; act.play();
    if (a.cur && a.cur !== act) a.cur.crossFadeTo(act, 0.07, false);
    a.oneshotT = (dur / act.timeScale) * 0.92;
    a.osAct = act;
  }

  _playAnim(a, name, oneshot) {
    const act = a.actions[name];
    if (!act) {
      // Meshy rigs ship Walk/Run/Idle only — attack/hit/death run as
      // procedural bone overlays on top of whatever loop is playing
      if (oneshot && ["attack", "spell", "hit", "death"].includes(name)) this._procStart(a, name);
      if (oneshot) return;
    }
    const fallback = a.actions.idle || Object.values(a.actions)[0];
    const use = act || fallback;
    if (!use || (a.cur === use && !oneshot)) return;
    if (oneshot) {
      use.reset(); use.setLoop(THREE.LoopOnce); use.clampWhenFinished = true; use.play();
      if (a.cur && a.cur !== use) a.cur.crossFadeTo(use, 0.08, false);
      a.oneshotT = (use.getClip().duration || 0.5) * 0.9;
      a.osAct = use;
      return;
    }
    use.reset(); use.setLoop(THREE.LoopRepeat); use.play();
    if (a.cur && a.cur !== use) { a.cur.crossFadeTo(use, 0.18, false); }
    else if (!a.cur) use.fadeIn(0.1);
    a.cur = use;
  }

  /** Procedural one-shots on the rig: weapon swing, flinch, death fall. */
  _procStart(a, name) {
    if (name === "attack" || name === "spell") {
      a.proc = { type: "swing", t: 0, dur: 0.32 };
      if (name === "spell") a.proc.dur = 0.26;
    } else if (name === "hit") {
      a.proc = { type: "flinch", t: 0, dur: 0.3 };
    } else if (name === "death") {
      a.proc = { type: "death", t: 0, dur: 0.85 };
    }
  }

  _procUpdate(a, dt) {
    // recover from death pose on respawn
    if (a.p.alive && a._deadPose) { a._deadPose = false; a.obj.rotation.x = 0; a.obj.position.z = 0; }
    if (!a.proc) return;
    const pr = a.proc;
    pr.t += dt;
    const k = Math.min(1, pr.t / pr.dur);
    if (pr.type === "swing") {
      // arc the weapon holder through a chop
      const w = a.equip.weapon;
      if (w) {
        const swing = Math.sin(k * Math.PI);
        w.rotation.x = -swing * 1.7;
        w.rotation.z = swing * 0.5;
      }
      const arm = a.bones.shoulderR;
      if (arm) arm.rotation.x = -Math.sin(k * Math.PI) * 1.1;
      if (k >= 1) { if (w) { w.rotation.x = 0; w.rotation.z = 0; } if (arm) arm.rotation.x = 0; a.proc = null; }
    } else if (pr.type === "flinch") {
      const s = a.bones.spine;
      if (s) s.rotation.x = Math.sin(k * Math.PI) * 0.35;
      if (k >= 1) { if (s) s.rotation.x = 0; a.proc = null; }
    } else if (pr.type === "death") {
      a.obj.rotation.x = -k * Math.PI / 2;
      if (k >= 1) { a.proc = null; a._deadPose = true; }
    }
  }

  // ── input ──────────────────────────────────────────────────────────────────
  _bindInput() {
    const el = this.g.renderer.domElement;
    const on = (t, fn, tgt) => { (tgt || el).addEventListener(t, fn); this._listeners.push([t, fn, tgt || el]); };
    this.keys = {};
    on("pointerdown", (e) => {
      if (this.g.hud.modalOpen) return;
      if (document.pointerLockElement !== el) { el.requestPointerLock(); return; }
      if (e.button === 0) this._melee = true;
      if (e.button === 2) this._special = true;
    });
    on("pointerup", (e) => { if (e.button === 0) this._melee = false; if (e.button === 2) this._special = false; });
    on("pointermove", (e) => {
      if (document.pointerLockElement !== el) return;
      const s = this.g.settings || { sens: 1, invertY: false };
      this.camYaw -= e.movementX * 0.0024 * s.sens;
      const dy = e.movementY * 0.0022 * s.sens * (s.invertY ? -1 : 1);
      this.camPitch = Math.max(-0.25, Math.min(1.15, this.camPitch + dy));
    });
    // industry-standard pause: releasing pointer lock (Esc) opens the pause overlay
    on("pointerlockchange", () => {
      if (document.pointerLockElement !== el && !this.g.hud.modalOpen && !this.run.over && !this._finished) {
        this.g.menu.pauseOverlay(this);
      }
    }, document);
    on("wheel", (e) => { if (!this.fp) this.camDist = Math.max(3.5, Math.min(13, this.camDist * (e.deltaY > 0 ? 1.1 : 0.92))); }, el);
    on("contextmenu", (e) => e.preventDefault(), el);
    on("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      const p = this.me();
      if (e.code === "KeyE" && p) {
        const merch = E.nearestMerchant(this.run, p);
        if (merch && !this.g.hud.modalOpen) { this._openShop(merch); }
        else p.input.interactDown = true;
      }
      if (e.code === "KeyQ" && p) p.input.potionDown = true;
      if (e.code === "KeyX" && p) p.input.manaDown = true;
      if (e.code === "KeyV") this.fp = !this.fp;
      if (e.code === "KeyF" && p) this._special = true;
      if (e.code === "KeyR" && p) this._frost = true;
      if (e.code === "KeyC" && !e.repeat && p) this._chain = true; // Sorceress chain lightning (edge-triggered)
      const dm = e.code.match(/^Digit([1-9])$/); // hotbar: number keys fire the mapped slot
      if (dm && p && !e.repeat) { const s = E.hotbar(p)[+dm[1] - 1]; if (s) this._hotkey = s.act; }
      // TAB target cycling: first press locks the nearest enemy, each press cycles
      // outward; past the last one it UNLOCKS and frees the player (owner spec).
      if (e.code === "Tab" && p && !e.repeat) {
        e.preventDefault();
        const near = this.run.enemies
          .filter((x) => x.alive && x.f === p.f && ((x.x - p.x) ** 2 + (x.z - p.z) ** 2) < 16 * 16)
          .sort((a, b) => ((a.x - p.x) ** 2 + (a.z - p.z) ** 2) - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
        if (!near.length) { this.lockedId = null; }
        else {
          const i = near.findIndex((x) => x.id === this.lockedId);
          const nxt = i + 1;                    // -1 (none locked) → 0 = nearest
          if (nxt >= near.length) { this.lockedId = null; this.g.audio.sfx("ui"); }
          else { this.lockedId = near[nxt].id; this.g.audio.sfx("confirm"); }
        }
      }
      if (e.code === "Escape") { /* pointer lock exits natively */ }
    }, window);
    on("keyup", (e) => { this.keys[e.code] = false; if (e.code === "KeyF") this._special = false; if (e.code === "KeyR") this._frost = false; }, window);
  }
  _unbindInput() {
    for (const [t, fn, tgt] of this._listeners) tgt.removeEventListener(t, fn);
    this._listeners = [];
  }

  _gatherInput() {
    const p = this.me();
    if (!p) return;
    // camera-relative movement
    let fx = 0, fz = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) fz += 1;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) fz -= 1;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) fx -= 1;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) fx += 1;
    const yaw = this.camYaw;
    p.input.mx = Math.sin(yaw) * fz - Math.cos(yaw) * fx; // fx strafe = camera screen-right (was inverted)
    p.input.mz = Math.cos(yaw) * fz + Math.sin(yaw) * fx;
    p.input.sprint = !!(this.keys["ShiftLeft"] || this.keys["ShiftRight"]);
    p.input.yaw = yaw;                    // face where the camera looks
    // soft aim assist: attacking with a lock pulls your facing onto the target
    if (this.target && (this._melee || this._special || this._frost)) {
      const ty = Math.atan2(this.target.x - p.x, this.target.z - p.z);
      let d = ty - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 0.55) p.input.yaw = ty;
    }
    p.input.melee = !!this._melee;
    p.input.special = !!this._special;
    p.input.frost = !!this._frost;
    p.input.chain = !!this._chain; this._chain = false; // consume the edge-trigger
    // hotbar number-key: fire the mapped slot's action once
    if (this._hotkey) {
      const act = this._hotkey; this._hotkey = null;
      if (act === "melee") p.input.melee = true;
      else if (act === "special") p.input.special = true;
      else if (act === "frost") p.input.frost = true;
      else if (act === "chain") p.input.chain = true;
      else if (act === "potion") p.input.potionDown = true;
      else if (act === "mana") p.input.manaDown = true;
    }
  }

  /** Interact with an NPC — sage grants a one-time blessing, merchant/blacksmith
   *  open a shop (pointer lock released so the player can click). */
  _openShop(merch) {
    if (this._shopOpen) return;
    const T = D.NPC_TYPES[merch.ntype] || D.NPC_TYPES.merchant;
    if (T.blessing) {
      const res = E.blessPlayer(this.run, this.me(), merch);
      if (res.ok) { this._handleEvents(E.drainEvents(this.run)); this.g.audio.sfx("confirm"); this.g.hud.toast(`📜 The sage blesses you — +${T.blessing.maxHp} max HP!`, "info"); }
      else this.g.hud.toast(res.err === "used" ? "The sage has already blessed you" : "Nothing happens", "warn");
      return;
    }
    this._shopOpen = true;
    this._shopNpc = merch;
    document.exitPointerLock && document.exitPointerLock();
    this.g.audio.sfx("confirm");
    this.g.hud.showShop(this, merch, this.me());
  }
  buy(itemId) {
    const p = this.me();
    const res = E.buyItem(this.run, p, itemId, this._shopNpc);
    if (res.ok) { this._handleEvents(E.drainEvents(this.run)); this.g.audio.sfx("key"); }
    else { this.g.audio.sfx("error"); this.g.hud.toast(res.err === "poor" ? "Not enough gold 💰" : res.err === "maxed" ? "Already at max tier" : "Can't buy that", "warn"); }
    return res;
  }
  closeShop() {
    this._shopOpen = false;
    const el = this.g.renderer.domElement;
    if (!this.run.over && !this._finished) el.requestPointerLock && el.requestPointerLock();
  }

  // ── event fan-out: sim events → visuals/audio/net ──────────────────────────
  _handleEvents(evs, fromNet) {
    const g = this.g;
    for (const ev of evs) {
      switch (ev.type) {
        case "door": {
          this._setDoorVisual(ev.id, ev.open);
          g.audio.sfx(ev.open ? "door_open" : "door_close");
          break;
        }
        case "unlock": {
          const dl = this.doorLeafs.get(ev.id);
          if (dl) { if (dl.bars) dl.bars.visible = false; if (dl.lock) dl.lock.visible = false; }
          g.audio.sfx("unlock");
          if (ev.by === this.myId) g.hud.toast("Door unlocked — key used", "info");
          break;
        }
        case "denied": g.audio.sfx("error"); g.hud.toast("Locked. Find a key 🗝️", "warn"); break;
        case "chest": {
          const m = this.objMeshes.get(ev.id);
          if (m && m.userData.lid) { m.userData.lid.rotation.x = -0.6; }
          g.audio.sfx("chest");
          if (ev.by === this.myId) {
            const labels = ev.items.map((i) => i.kind === "gold" ? `💰 ${i.n} gold` : i.kind === "potion" ? "🧪 potion" : i.kind === "mana" ? "🔷 energy" : i.kind === "charm" ? "✨ charm (+20% dmg)" : "🗝️ KEY").join("  ·  ");
            g.hud.toast("Chest: " + labels, "loot");
          }
          const mm = this.objMeshes.get(ev.id);
          if (mm) g.fx.burst(mm.getWorldPosition(new THREE.Vector3()), 0xffd769, 14);
          break;
        }
        case "keyTake": {
          const m = this.itemMeshes.get(ev.id);
          if (m) { m.visible = false; }
          // dropped-key world mesh
          const dm = this.itemMeshes.get("drop:" + ev.id);
          if (dm) dm.visible = false;
          g.audio.sfx("key");
          if (ev.by === this.myId) g.hud.toast("🗝️ Key acquired!", "loot");
          break;
        }
        case "swing": {
          const a = this.actors.get(ev.id);
          if (a) this._playCombo(a, ev.stage);
          if (ev.id === this.myId) g.audio.sfx("swing");
          break;
        }
        case "bash": {
          const a = this.actors.get(ev.id);
          if (a) { this._playCombat(a, "bash", 0, 0.4); const wp = a.grp.position.clone().add(new THREE.Vector3(Math.sin(a.p.yaw) * 1.4, 0.5, Math.cos(a.p.yaw) * 1.4)); g.fx.shockwave(wp, 0xffe08a); }
          g.audio.sfx("bash"); if (ev.id === this.myId) g.hud.shake(0.35);
          break;
        }
        case "crush": {
          const a = this.actors.get(ev.id);
          if (a) { this._playCombat(a, "crush", 0, 0.5); const wp = a.grp.position.clone().add(new THREE.Vector3(Math.sin(a.p.yaw) * 1.5, 0.2, Math.cos(a.p.yaw) * 1.5)); g.fx.shockwave(wp, 0xffaa55); g.fx.burst(wp, 0xffaa55, 16); }
          g.audio.sfx("crush"); if (ev.id === this.myId) g.hud.shake(0.5);
          break;
        }
        case "cast": {
          const a = this.actors.get(ev.id);
          if (a) this._playCombat(a, ev.kind, 0, 0.4);
          g.audio.sfx(ev.kind === "knife" ? "swing" : ev.kind === "fire" ? "fire" : ev.kind === "frost" ? "frost" : "bolt");
          break;
        }
        case "boltHit": {
          const at = new THREE.Vector3(ev.x, ev.f * FLOOR_H + 1.1, ev.z);
          const col = ev.elem === "fire" ? 0xff6a1f : ev.elem === "frost" ? 0x5ad6ff : ev.elem === "knife" ? 0x7dff8f : 0x8f6bff;
          if (ev.elem === "fire") g.fx._fireImpact(at);
          else if (ev.elem === "frost") g.fx._frostImpact(at);
          else g.fx.elementBurst(at, ev.elem || "arcane");
          if (ev.elem === "knife" && !ev.wall) g.fx.poisonCloud(new THREE.Vector3(ev.x, ev.f * FLOOR_H + 1.0, ev.z), 2.0, 4.5);
          if (ev.wall) g.fx.burst(at, col, 6);
          break;
        }
        case "chain": {
          const pts = ev.pts || [];
          const toWorld = (q) => new THREE.Vector3(q.x, (q.f == null ? (ev.f || 0) : q.f) * FLOOR_H + 1.2, q.z);
          for (let i = 0; i < pts.length - 1; i++) g.fx.chainLightning(toWorld(pts[i]), toWorld(pts[i + 1]));
          if (pts.length > 1) { g.audio.sfx("bolt"); if (ev.id === this.myId) g.hud.shake(0.2); }
          break;
        }
        case "estatus": {
          this.enemies.setStatus(ev.id, ev.kind, ev.dur);
          break;
        }
        case "blocked": {
          const a = this.actors.get(ev.id);
          if (a) { g.audio.sfx("hit"); g.fx.burst(a.grp.position.clone().add(new THREE.Vector3(Math.sin(a.p.yaw)*0.6, 1.1, Math.cos(a.p.yaw)*0.6)), 0xcfd6e4, 8); }
          if (ev.id === this.myId) g.hud.toast("🛡 Blocked!", "info");
          break;
        }
        case "ehit": {
          this.enemies.onHit(ev);
          if (ev.by === this.myId) g.audio.sfx("hit");
          const en = this.run.enemies.find((x) => x.id === ev.id);
          const ecol = ev.elem === "burn" ? 0xff7a1f : ev.elem === "poison" ? 0x8fe04a : ev.elem === "frost" ? 0x5ad6ff : 0xffd769;
          if (en && ev.dmg) g.fx.damageNumber(new THREE.Vector3(en.x, en.f * FLOOR_H + 2.1, en.z), Math.round(ev.dmg), ecol);
          break;
        }
        case "edied": {
          this.enemies.onDeath(ev);
          g.audio.sfx("edie");
          if (ev.key) this._spawnDroppedKey(ev);
          g.fx.burst(new THREE.Vector3(ev.x, ev.f * FLOOR_H + 1, ev.z), 0xff5566, 20);
          break;
        }
        case "levelup": {
          if (ev.id === this.myId) {
            g.hud.toast(`⭐ Level ${ev.level}! +HP, stronger attacks`, "loot");
            g.audio.sfx("confirm");
          }
          const a = this.actors.get(ev.id);
          if (a && a.grp) g.fx.burst(a.grp.position.clone().setY(a.grp.position.y + 1.1), 0xffe27a, 34);
          break;
        }
        case "decorBreak": {
          if (this.run) this.run.brokenDecor && this.run.brokenDecor.add(ev.id);
          const m = this.objMeshes.get(ev.id);
          if (m) m.visible = false;
          const col = (ev.dtype === "pot" || ev.dtype === "urn") ? 0xb06a3c : ev.dtype === "bones" ? 0xe8e2d0 : ev.dtype === "canister" ? 0x8792a0 : 0x8a5a34;
          const at = new THREE.Vector3(ev.x, ev.f * FLOOR_H + 0.7, ev.z);
          g.fx.burst(at, col, 20);
          g.fx.burst(at.clone().setY(ev.f * FLOOR_H + 0.5), 0xffd769, 8); // gold sparkle
          g.audio.sfx("erase");
          if (ev.by === this.myId && ev.gold) g.hud.toast(`💰 +${ev.gold} gold`, "info");
          break;
        }
        case "phit": {
          if (ev.id === this.myId) { g.hud.damageFlash(); g.audio.sfx("hurt"); }
          const a = this.actors.get(ev.id);
          if (a) {
            this._playCombat(a, "hit", 0, 0.3);
            if (ev.dmg) g.fx.damageNumber(a.grp.position.clone().add(new THREE.Vector3(0, 2.1, 0)), Math.round(ev.dmg), 0xff5566);
          }
          break;
        }
        case "pdied": {
          if (ev.id === this.myId) { g.hud.toast("You died — respawning…", "warn"); g.audio.sfx("die"); }
          const a = this.actors.get(ev.id);
          if (a) this._playCombat(a, "death", 0, 0);
          break;
        }
        case "respawn": {
          const a = this.actors.get(ev.id);
          if (a) this._playAnim(a, "idle");
          if (ev.id === this.myId) this.camYaw = this.me().yaw + Math.PI;
          break;
        }
        case "equip": {
          const a = this.actors.get(ev.id);
          if (a) this._refreshEquip(a);
          if (ev.id === this.myId) {
            g.audio.sfx("confirm");
            const it = ev.item, ic = ev.slot === "weapon" ? "⚔" : "🛡";
            g.hud.toast(it ? `${ic} ${it.name}${it.affixes && it.affixes.length ? " · " + it.affixes.map((x) => x.label).join(", ") : ""}`
                           : `${ic} ${ev.slot} tier ${ev.tier}!`, "loot");
          }
          break;
        }
        case "loot": {
          if (ev.id === this.myId && ev.item) g.hud.toast(`📦 ${ev.item.name} → stash`, "info");
          break;
        }
        case "bought": {
          if (ev.id === this.myId) { const s = D.SHOP[ev.item]; g.hud.toast(`Bought ${s ? s.icon + " " + s.label : ev.item} (−${ev.price}💰)`, "loot"); }
          break;
        }
        case "potion": if (ev.id === this.myId) { g.audio.sfx("potion"); g.hud.toast("🧪 +35 HP", "loot"); } break;
        case "manapot": if (ev.id === this.myId) { g.audio.sfx("potion"); g.hud.toast("🔷 +60 Mana", "loot"); } break;
        case "step": if (ev.id === this.myId) g.audio.step(); break;
        case "climb": g.audio.sfx("stairs"); break;
        case "floor": if (ev.id === this.myId) this._syncFloorVis(); break;
        case "aggro": g.audio.sfx("aggro"); break;
        case "eattack": {
          this.enemies.onAttack(ev);
          // audible enemy swings when they're near the player
          const en = this.run.enemies.find((x) => x.id === ev.id), meS = this.me();
          if (en && meS && en.f === meS.f && ((en.x - meS.x) ** 2 + (en.z - meS.z) ** 2) < 12 * 12) g.audio.sfx("eattack");
          break;
        }
        case "eshoot": g.audio.sfx("bolt"); break;
        case "escape": {
          const p = this.run.players.find((pl) => pl.id === ev.id);
          if (ev.id === this.myId) {
            g.audio.sfx("win");
            g.fx.confetti(this.g.camera.position.clone());
          }
          g.hud.toast((p ? p.name : "player") + " escaped in " + fmtTime(ev.t) + "!", "loot");
          break;
        }
        case "runOver": {
          this._finish();
          break;
        }
      }
      // net fan-out: my authoritative events go to peers
      if (this.session && !fromNet) this.session.relayEvent(ev, this.myId);
    }
  }

  _setDoorVisual(id, open) {
    const dl = this.doorLeafs.get(id);
    if (!dl) return;
    dl.open = open;
    if (dl.mixer && dl.openClip) {
      dl.mixer.stopAllAction();
      const clip = open ? dl.openClip : (dl.closeClip || dl.openClip);
      const act = dl.mixer.clipAction(clip);
      act.reset(); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true;
      if (!open && !dl.closeClip) { act.timeScale = -1; act.time = clip.duration; }
      act.play();
    } else if (dl.leaf) {
      dl.leaf.visible = !open;
    }
  }

  _spawnDroppedKey(ev) {
    const grp = new THREE.Group();
    grp.position.set(ev.x, (ev.f || 0) * FLOOR_H, ev.z);
    const k = this.g.assets.clone(this.items.key);
    Assets.normalizeFoot(k, 1.0);
    k.position.y = 0.85;
    grp.add(k);
    const gl = new THREE.PointLight(0xffd769, 5, 6); gl.position.y = 1.2; grp.add(gl);
    grp.userData = { spinKey: true };
    this.root.add(grp);
    this.itemMeshes.set("drop:" + ev.key, grp);
  }

  _syncFloorVis(force) {
    const p = this.me();
    const f = p ? p.f : 0;
    this.floorGroups.forEach((gr, i) => { gr.group.visible = Math.abs(i - f) <= 1; });
    this.g.hud.setFloor(f + 1, this.d.floors.length);
  }

  _finish() {
    if (this._finished) return;
    this._finished = true;
    const res = this.run.result;
    this.g.audio.music("victory");
    // best-time bookkeeping + leaderboard submit happen in hud/menu (cloud.js)
    this.g.hud.showResults(this, res);
  }

  // ── frame ──────────────────────────────────────────────────────────────────
  update(dt) {
    if (!this.run || !this.ready) return;
    this._gatherInput();
    E.tick(this.run, dt, { simEnemies: this.simEnemies, localIds: this.localIds });
    this._handleEvents(E.drainEvents(this.run));

    // actors follow sim (smooth step up/down onto raised platforms; wade dip in water)
    for (const [id, a] of this.actors) {
      const p = a.p;
      const ct = D.cellType(this.d, p.f, E.w2c(p.x), E.w2c(p.z));
      const surfY = D.cellHeight(this.d, p.f, E.w2c(p.x), E.w2c(p.z)) + (ct === D.CT.WATER ? -0.25 : 0);
      a.surfY = a.surfY == null ? surfY : a.surfY + (surfY - a.surfY) * Math.min(1, dt * 10);
      const y = p.f * FLOOR_H + (p.climb ? climbY(p) : 0) + a.surfY;
      a.grp.position.set(p.x, y, p.z);
      a.grp.rotation.y = p.yaw; // Meshy char rigs face +Z = the yaw/look direction (away from the chase cam)
      a.grp.visible = (p.alive || a.proc || a._deadPose) && !p.escaped && (this.me() ? Math.abs(p.f - this.me().f) <= 1 : true);
      a.mixer.update(dt);
      this._procUpdate(a, dt);
      let relaxTarget = 0, locomote = false, sprinting = false;
      if (a.oneshotT > 0) { a.oneshotT -= dt; if (a.oneshotT <= 0 && a.cur) { a.cur.reset().play(); if (a.osAct) a.osAct.crossFadeTo(a.cur, 0.15, false); } }
      else {
        locomote = Math.hypot(p.input.mx, p.input.mz) > 0.01 || (p.remote && p.netMoving);
        sprinting = !!p.input.sprint;
        this._playAnim(a, locomote ? (sprinting ? "run" : "walk") : "idle");
        // FOOT-SLIDE FIX: the Meshy walk/run clips cycle in place, so if the clip
        // cadence doesn't match the ground speed the feet skate. Scale the clip's
        // timeScale by the actor's real horizontal velocity (clip stride ≈ 2.3 u/s).
        if (locomote) {
          const gs = a._pp ? Math.hypot(p.x - a._pp.x, p.z - a._pp.z) / Math.max(1e-4, dt) : 0;
          const act = a.actions[sprinting ? "run" : "walk"];
          if (act) act.timeScale = Math.max(0.8, Math.min(2.8, gs / 2.3));
        }
        // Old rigs: relax arms at idle AND locomotion (their clips fling arms out).
        // Clean T-pose rigs: idle stands naturally → relax ONLY during locomotion.
        relaxTarget = a.cleanRig ? (locomote ? 1 : 0) : 1;
      }
      a._pp = { x: p.x, z: p.z };
      // Meshy auto-rigged every clip in an A-pose: idle, walk AND run all fling
      // the arms out (radial ≥0.9 torso-heights). Pull the arms down to the
      // sides EVERY frame — not just when standing — then add a procedural gait
      // swing so walking/running still reads as motion. Fades to 0 during attack
      // one-shots so the swing clips play unmodified. Skips procedural rigs.
      if (a.armBones && !a.proc) {
        a.relaxW += (relaxTarget - a.relaxW) * Math.min(1, dt * 12);
        if (a.relaxW > 0.02) {
          a.obj.updateMatrixWorld(true);
          relaxArms(a.armBones, a.relaxW);
          if (locomote) {
            a.gait = (a.gait || 0) + dt * (sprinting ? 12.5 : 8.5);
            const sw = Math.sin(a.gait) * (sprinting ? 0.6 : 0.42) * a.relaxW;
            _swingAxis.set(1, 0, 0).applyQuaternion(a.grp.quaternion); // world right-vector
            const b = a.armBones;
            b.rArm.rotateOnWorldAxis(_swingAxis, sw);  b.rArm.updateMatrixWorld(true);
            b.lArm.rotateOnWorldAxis(_swingAxis, -sw); b.lArm.updateMatrixWorld(true);
            b.rFore.rotateOnWorldAxis(_swingAxis, sw * 0.35);
            b.lFore.rotateOnWorldAxis(_swingAxis, -sw * 0.35);
          }
        }
      }
      if (id === this.myId) a.obj.visible = !this.fp;
    }

    // enemies visuals
    this.enemies.update(dt, this.run, this.me());

    // bolts render
    this.g.fx.syncBolts(this.run.bolts, FLOOR_H, this.d.theme);

    // traps animate from sim phase
    for (const t of this.run.traps) {
      const m = this.objMeshes.get(t.id);
      if (!m) continue;
      if (m.userData.spikes) {
        const target = t.state === "on" ? 0 : t.state === "warn" ? -0.55 : -0.95;
        m.userData.spikes.position.y += (target - m.userData.spikes.position.y) * Math.min(1, dt * (t.state === "on" ? 22 : 6));
      }
      if (m.userData.ventDisc) {
        const mat = m.userData.ventDisc.material;
        mat.emissiveIntensity = t.state === "on" ? 2.6 : t.state === "warn" ? 1.1 : 0.25;
        if (t.state === "on") this.g.fx.ventJet(m.getWorldPosition(new THREE.Vector3()), this.d.theme);
      }
    }

    // door mixers
    for (const [, dl] of this.doorLeafs) if (dl.mixer) dl.mixer.update(dt);

    // lava/water sheet animation + lava embers
    const t = performance.now() / 1000;
    for (const m of this.lavaMats) if (m.uniforms) m.uniforms.uTime.value = t;
    for (const m of this.waterMats) if (m.uniforms) m.uniforms.uTime.value = t;
    if (this.lavaSpots.length && Math.random() < 0.3) {
      const s = this.lavaSpots[(Math.random() * this.lavaSpots.length) | 0];
      const me0 = this.me();
      if (me0 && s.f === me0.f && Math.abs(s.x - me0.x) < 30 && Math.abs(s.z - me0.z) < 30)
        this.g.fx.spawn(new THREE.Vector3(s.x + (Math.random() - .5) * 2.6, s.f * FLOOR_H + 0.3, s.z + (Math.random() - .5) * 2.6),
          new THREE.Vector3((Math.random() - .5) * .4, 1.4 + Math.random(), (Math.random() - .5) * .4), 0.7, 2.0, 0xff7a22);
    }

    // target lock: TAB hard-lock (cycles nearby enemies) beats the soft auto-pick
    const meT = this.me();
    if (meT && meT.alive && !meT.escaped) {
      if (this.lockedId) {
        const le = this.run.enemies.find((x) => x.id === this.lockedId);
        if (le && le.alive && le.f === meT.f && ((le.x - meT.x) ** 2 + (le.z - meT.z) ** 2) < 20 * 20) this.target = le;
        else { this.lockedId = null; this.target = E.pickTarget(this.run, meT); }
      } else this.target = E.pickTarget(this.run, meT);
      if (this.target) {
        const e = this.target;
        const ect = D.cellType(this.d, e.f, E.w2c(e.x), E.w2c(e.z));
        this.targetRing.visible = true;
        this.targetRing.position.set(e.x, e.f * FLOOR_H + D.cellHeight(this.d, e.f, E.w2c(e.x), E.w2c(e.z)) + 0.06, e.z);
        this.targetRing.material.opacity = 0.6 + Math.sin(t * 6) * 0.25;
        this.g.hud.setTarget(e, this.d);
      } else {
        this.targetRing.visible = false;
        this.g.hud.setTarget(null);
      }
    } else { this.targetRing.visible = false; this.g.hud.setTarget(null); }
    for (const [, m] of this.itemMeshes) if (m.userData.spinKey && m.visible) m.children.forEach((c) => { if (!c.isPointLight) c.rotation.y = t * 1.8; });
    for (const [, m] of this.objMeshes) if (m.userData.portal) m.userData.portal.rotation.z = t;
    // big-map perf: only the ~10 nearest lights burn fragments; the rest sleep
    this._lightT = (this._lightT || 0) - dt;
    const meL = this.me();
    if (meL && this._lightT <= 0) {
      this._lightT = 0.25;
      const wp = new THREE.Vector3();
      const scored = this.lightPool.map((L) => {
        L.grp.getWorldPosition(wp);
        return { L, d2: (wp.x - meL.x) ** 2 + (wp.z - meL.z) ** 2 + (L.f !== meL.f ? 1e6 : 0) };
      }).sort((a, b) => a.d2 - b.d2);
      scored.forEach((s, i) => { s.L.light.visible = i < 10 && s.d2 < 3600; });
    }
    for (const L of this.lightPool) if (L.light.visible) L.light.intensity = L.base * (1 + Math.sin(t * 8.5 + L.grp.position.x * 2.1) * 0.14);

    // camera
    const p = this.me();
    if (p) {
      const py = p.f * FLOOR_H + (p.climb ? climbY(p) : 0);
      if (this.fp) {
        const eye = new THREE.Vector3(p.x, py + 1.62, p.z);
        this.g.camera.position.copy(eye);
        const look = new THREE.Vector3(
          p.x + Math.sin(this.camYaw) * Math.cos(this.camPitch),
          py + 1.62 - Math.sin(this.camPitch),
          p.z + Math.cos(this.camYaw) * Math.cos(this.camPitch));
        this.g.camera.lookAt(look);
      } else {
        const back = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
        const target = new THREE.Vector3(p.x, py + 1.5, p.z);
        const desired = target.clone()
          .addScaledVector(back, this.camDist * Math.cos(this.camPitch))
          .add(new THREE.Vector3(0, this.camDist * Math.sin(this.camPitch) * 0.9 + 0.4, 0));
        // simple camera collision: pull in if a wall cell blocks the ray
        this.g.camera.position.lerp(desired, Math.min(1, dt * 10));
        this.g.camera.lookAt(target);
      }
      // net: my state out
      if (this.session) this.session.sendPlayerState(p);
      // HUD
      this.g.hud.updateEscape(this, p);
    }
  }

  // net feeds
  netPlayerState(id, s) {
    const p = this.run.players.find((pl) => pl.id === id);
    if (!p) return;
    p.remote = true;
    p.x = s.x; p.z = s.z; p.yaw = s.yaw; p.f = s.f;
    p.hp = s.hp; p.alive = s.a !== 0; p.escaped = !!s.esc;
    p.netMoving = !!s.mv;
    p.input.sprint = !!s.sp;
    // visible gear follows the wearer across the wire
    if ((s.wt || 0) !== (p.weaponTier || 0) || (s.at || 0) !== (p.armorTier || 0)) {
      p.weaponTier = s.wt || 0; p.armorTier = s.at || 0;
      const a = this.actors.get(id);
      if (a) this._refreshEquip(a);
    }
  }
  netEvent(ev) {
    // phit aimed at ME: the host's enemy sim hit my player — apply the damage
    // to my own (authoritative) sim; the sim will emit its own phit for display
    if (ev.type === "phit" && ev.id === this.myId) {
      const me = this.me();
      if (me) E.damagePlayer(this.run, me, ev.dmg, ev.src);
      return;
    }
    if (ev.type === "eshoot" && ev.bid && !this.simEnemies) {
      // spawn the hostile bolt locally as a visual (damage is host-authority)
      if (!this.run.bolts.some((b) => b.id === ev.bid))
        this.run.bolts.push({ id: ev.bid, owner: ev.id, hostile: true, f: ev.f, x: ev.x, z: ev.z, vx: ev.vx, vz: ev.vz, ttl: 1.6, dmg: 0 });
    }
    this._applyRemoteEventLocal(ev);
    this._handleEvents([ev], true);
  }
  _applyRemoteEventLocal(ev) {
    const st = this.run;
    if (ev.type === "door") { if (ev.open) st.openDoors.add(ev.id); else st.openDoors.delete(ev.id); }
    if (ev.type === "unlock") st.unlockedDoors.add(ev.id);
    if (ev.type === "chest") st.openedChests.add(ev.id);
    if (ev.type === "keyTake") st.takenItems.add(ev.id);
    if (ev.type === "decorBreak") st.brokenDecor && st.brokenDecor.add(ev.id);
    if (ev.type === "ehit") { const e = st.enemies.find((x) => x.id === ev.id); if (e) { e.hp = ev.hp; e.hurtT = 0.25; if (e.hp <= 0 && e.alive) { e.alive = false; if (e.key) { e.droppedKey = e.key; e.key = null; } } } }
    if (ev.type === "edied") { const e = st.enemies.find((x) => x.id === ev.id); if (e && e.alive) { e.alive = false; if (e.key) { e.droppedKey = e.key; e.key = null; } } }
    if (ev.type === "escape") { const p = st.players.find((x) => x.id === ev.by || x.id === ev.id); if (p) p.escaped = true; }
  }

  // enemy state from host (guest side)
  netEnemies(list) {
    for (const row of list) {
      const [id, x, z, yaw, hp, alive, state, f] = row;
      const e = this.run.enemies.find((en) => en.id === id);
      if (!e) continue;
      e.x = x; e.z = z; e.yaw = yaw; e.hp = hp; e.f = f;
      e.state = state === 1 ? "chase" : "patrol";
      if (!alive && e.alive) { e.alive = false; if (e.key) { e.droppedKey = e.key; e.key = null; } this.enemies.onDeath({ id: e.id, x: e.x, z: e.z, f: e.f, key: e.droppedKey }); }
      e.moving = true;
    }
  }
  packEnemies() {
    return this.run.enemies.filter((e) => e.alive || e._sentDead !== true).map((e) => {
      if (!e.alive) e._sentDead = true;
      return [e.id, +e.x.toFixed(2), +e.z.toFixed(2), +e.yaw.toFixed(2), Math.round(e.hp), e.alive ? 1 : 0, e.state === "chase" ? 1 : 0, e.f];
    });
  }

  state() {
    const p = this.me();
    return p ? {
      x: p.x, z: p.z, f: p.f, hp: p.hp, keys: p.keys, gold: p.gold, potions: p.potions,
      alive: p.alive, escaped: p.escaped, time: this.run.time,
      enemies: this.run.enemies.filter((e) => e.alive).length,
      doorsOpen: [...this.run.openDoors], over: this.run.over,
    } : null;
  }
}

/** During a stair climb the render Y lerps between the two floors while the
 *  sim's p.f flips at the halfway point — return the offset vs p.f*FLOOR_H. */
function climbY(p) {
  const k = Math.max(0, Math.min(1, p.climb.t));
  const f0 = p.f === p.climb.tf ? (p.climb.up ? p.climb.tf - 1 : p.climb.tf + 1) : p.f;
  const worldY = (f0 + (p.climb.tf - f0) * k) * FLOOR_H;
  return worldY - p.f * FLOOR_H;
}

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 10);
  return (m ? m + ":" + String(s).padStart(2, "0") : s + "") + "." + ms + (m ? "" : "s");
}
