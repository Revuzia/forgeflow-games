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
const { makeInstanced, Assets, charClips, makeTorch } = await import("./assets.js" + V);
const { EnemyPool } = await import("./enemies.js" + V);

const FLOOR_H = 4.4;
const CELL = D.CELL;
const c2w = E.c2w;

const SKINS = ["hero", "marauder", "wizard", "crew"];

export class Escape {
  constructor(game) {
    this.g = game;
    this._listeners = [];
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
    for (let f = 0; f < dungeon.floors.length; f++) this.floorGroups.push(this._buildFloor(f));

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
    this.g.audit("escape.enter seed=" + this.run.runSeed);
  }

  exit() {
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
    const cells = Object.keys(fl.cells);
    const m4 = new THREE.Matrix4();

    const fInst = makeInstanced(this.kit.floor.scene, Math.max(1, cells.length));
    cells.forEach((k, i) => {
      const [x, z] = k.split(",").map(Number);
      m4.makeTranslation(x * CELL + CELL / 2, 0, z * CELL + CELL / 2);
      fInst.setMatrixAt(i, m4);
    });
    fInst.setCount(cells.length); fInst.commit();
    group.add(fInst.group);

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
      if (mesh) { mesh.userData = { id: o.id, f, kind: o.kind }; group.add(mesh); this.objMeshes.set(o.id, mesh); }
    }
    return { group, count: cells.length };
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
        const l = new THREE.PointLight(this.g.look.torch, this.g.look.torchI * 0.35, 13, 1.7);
        l.position.y = 2.7; grp.add(l);
        this.lightPool.push({ light: l, base: this.g.look.torchI * 0.35, grp, f });
        this.g.fx.attachFlame(grp, this.d.theme, 2.45);
        break;
      }
      case "light": {
        const col = new THREE.Color(o.color || (this.d.theme === "scifi" ? "#37e0ff" : "#ff9a3c"));
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.6 }));
        orb.position.y = 3.1; grp.add(orb);
        const l = new THREE.PointLight(col, 9, 14, 1.6); l.position.y = 3.0; grp.add(l);
        this.lightPool.push({ light: l, base: 9, grp, f });
        break;
      }
      case "decor": {
        const tpl = this.props[o.dtype] || this.props.crate;
        add(tpl, null, o.dtype === "pillar" ? 1.4 : o.dtype === "bookshelf" || o.dtype === "terminal" ? 2.2 : 1.8);
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
    Assets.normalizeH(obj, 1.72);
    const grp = new THREE.Group();
    grp.add(obj);
    // weapon in hand (fantasy sword / scifi blaster) — attach to wrist bone if present
    const wpnTpl = this.d.theme === "scifi" ? this.props.blaster : this.props.sword;
    if (wpnTpl) {
      const w = this.g.assets.clone(wpnTpl);
      Assets.normalizeFoot(w, 0.9);
      let hand = null;
      obj.traverse((b) => { if (!hand && b.isBone && /hand.*r|r.*hand|wrist.*r/i.test(b.name)) hand = b; });
      if (hand) { hand.add(w); w.position.set(0, 0.06, 0.02); w.rotation.set(Math.PI / 2, 0, 0); }
    }
    const mixer = new THREE.AnimationMixer(obj);
    const clips = charClips(tpl.animations);
    const actions = {};
    for (const k of Object.keys(clips)) if (clips[k]) { actions[k] = mixer.clipAction(clips[k]); }
    const tag = p.id === this.myId ? null : this._nameTag(p.name);
    if (tag) { tag.position.y = 2.3; grp.add(tag); }
    this.root.add(grp);
    const a = { p, grp, obj, mixer, actions, cur: null, oneshotT: 0 };
    this._playAnim(a, "idle");
    this.actors.set(p.id, a);
    return a;
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

  _playAnim(a, name, oneshot) {
    const act = a.actions[name] || a.actions.idle;
    if (!act || a.cur === act && !oneshot) return;
    if (oneshot) {
      act.reset(); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
      if (a.cur && a.cur !== act) a.cur.crossFadeTo(act, 0.08, false);
      a.oneshotT = (act.getClip().duration || 0.5) * 0.9;
      a.osAct = act;
      return;
    }
    act.reset(); act.setLoop(THREE.LoopRepeat); act.play();
    if (a.cur && a.cur !== act) { a.cur.crossFadeTo(act, 0.18, false); }
    else if (!a.cur) act.fadeIn(0.1);
    a.cur = act;
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
      if (e.button === 2) this._bolt = true;
    });
    on("pointerup", (e) => { if (e.button === 0) this._melee = false; if (e.button === 2) this._bolt = false; });
    on("pointermove", (e) => {
      if (document.pointerLockElement !== el) return;
      this.camYaw -= e.movementX * 0.0024;
      this.camPitch = Math.max(-0.25, Math.min(1.15, this.camPitch + e.movementY * 0.0022));
    });
    on("wheel", (e) => { if (!this.fp) this.camDist = Math.max(3.5, Math.min(13, this.camDist * (e.deltaY > 0 ? 1.1 : 0.92))); }, el);
    on("contextmenu", (e) => e.preventDefault(), el);
    on("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      const p = this.me();
      if (e.code === "KeyE" && p) p.input.interactDown = true;
      if (e.code === "KeyQ" && p) p.input.potionDown = true;
      if (e.code === "KeyV") this.fp = !this.fp;
      if (e.code === "KeyF" && p) this._bolt = true;
      if (e.code === "Escape") { /* pointer lock exits natively */ }
    }, window);
    on("keyup", (e) => { this.keys[e.code] = false; if (e.code === "KeyF") this._bolt = false; }, window);
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
    p.input.mx = Math.sin(yaw) * fz + Math.cos(yaw) * fx;
    p.input.mz = Math.cos(yaw) * fz - Math.sin(yaw) * fx;
    p.input.sprint = !!(this.keys["ShiftLeft"] || this.keys["ShiftRight"]);
    p.input.yaw = yaw;                    // face where the camera looks
    p.input.melee = !!this._melee;
    p.input.bolt = !!this._bolt;
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
          if (a) this._playAnim(a, "attack", true);
          if (ev.id === this.myId) g.audio.sfx("swing");
          break;
        }
        case "bolt": {
          const a = this.actors.get(ev.id);
          if (a) this._playAnim(a, "spell", true);
          g.audio.sfx("bolt");
          break;
        }
        case "boltHit": {
          g.fx.burst(new THREE.Vector3(ev.x, ev.f * FLOOR_H + 1.1, ev.z), this.d.theme === "scifi" ? 0x37e0ff : 0x8f6bff, 8);
          break;
        }
        case "ehit": {
          this.enemies.onHit(ev);
          if (ev.by === this.myId) g.audio.sfx("hit");
          break;
        }
        case "edied": {
          this.enemies.onDeath(ev);
          g.audio.sfx("edie");
          if (ev.key) this._spawnDroppedKey(ev);
          g.fx.burst(new THREE.Vector3(ev.x, ev.f * FLOOR_H + 1, ev.z), 0xff5566, 20);
          break;
        }
        case "phit": {
          if (ev.id === this.myId) { g.hud.damageFlash(); g.audio.sfx("hurt"); }
          const a = this.actors.get(ev.id);
          if (a) this._playAnim(a, "hit", true);
          break;
        }
        case "pdied": {
          if (ev.id === this.myId) { g.hud.toast("You died — respawning…", "warn"); g.audio.sfx("die"); }
          const a = this.actors.get(ev.id);
          if (a) this._playAnim(a, "death", true);
          break;
        }
        case "respawn": {
          const a = this.actors.get(ev.id);
          if (a) this._playAnim(a, "idle");
          if (ev.id === this.myId) this.camYaw = this.me().yaw + Math.PI;
          break;
        }
        case "potion": if (ev.id === this.myId) { g.audio.sfx("potion"); g.hud.toast("🧪 +35 HP", "loot"); } break;
        case "step": if (ev.id === this.myId) g.audio.step(); break;
        case "climb": g.audio.sfx("stairs"); break;
        case "floor": if (ev.id === this.myId) this._syncFloorVis(); break;
        case "aggro": g.audio.sfx("aggro"); break;
        case "eattack": this.enemies.onAttack(ev); break;
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
    if (!this.run) return;
    this._gatherInput();
    E.tick(this.run, dt, { simEnemies: this.simEnemies, localIds: this.localIds });
    this._handleEvents(E.drainEvents(this.run));

    // actors follow sim
    for (const [id, a] of this.actors) {
      const p = a.p;
      const y = p.f * FLOOR_H + (p.climb ? climbY(p) : 0);
      a.grp.position.set(p.x, y, p.z);
      a.grp.rotation.y = p.yaw + Math.PI; // rigs face +Z opposite
      a.grp.visible = p.alive && !p.escaped && (this.me() ? Math.abs(p.f - this.me().f) <= 1 : true);
      a.mixer.update(dt);
      if (a.oneshotT > 0) { a.oneshotT -= dt; if (a.oneshotT <= 0 && a.cur) { a.cur.reset().play(); if (a.osAct) a.osAct.crossFadeTo(a.cur, 0.15, false); } }
      else {
        const moving = Math.hypot(p.input.mx, p.input.mz) > 0.01 || (p.remote && p.netMoving);
        this._playAnim(a, moving ? (p.input.sprint ? "run" : "walk") : "idle");
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

    // spinning keys, portal spin, torch flicker
    const t = performance.now() / 1000;
    for (const [, m] of this.itemMeshes) if (m.userData.spinKey && m.visible) m.children.forEach((c) => { if (!c.isPointLight) c.rotation.y = t * 1.8; });
    for (const [, m] of this.objMeshes) if (m.userData.portal) m.userData.portal.rotation.z = t;
    for (const L of this.lightPool) L.light.intensity = L.base * (1 + Math.sin(t * 8.5 + L.grp.position.x * 2.1) * 0.14);

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
