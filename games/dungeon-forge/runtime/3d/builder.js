/**
 * Dungeon Forge — runtime/3d/builder.js
 * BUILD MODE: top-down orbit camera, click/drag cell painting, object
 * placement with ghost preview, selection panel (rotate / delete / door LOCK
 * toggle / enemy type), floor switching, live validation, and real-time
 * co-building (ops relayed through the session; remote cursors shown).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const D = await import("../sim/dungeon.js" + V);
const { makeInstanced, Assets, creatureClips, makeTorch, makeCreature, makeCellSurfaces, makeNpc } = await import("./assets.js" + V);

const FLOOR_H = 4.4;
const CELL = D.CELL;

export const TOOLS = [
  { id: "select", icon: "🖱️", label: "Select" },
  { id: "floor", icon: "⬜", label: "Floor" },   // → floor / lava / water paint + raise / lower
  { id: "erase", icon: "🧹", label: "Erase" },
  { id: "door", icon: "🚪", label: "Door" },
  { id: "stairs", icon: "🪜", label: "Stairs" },
  { id: "props", icon: "🎁", label: "Props" },   // → chest / key / trap / light / decor
  { id: "enemy", icon: "👹", label: "Enemy" },
  { id: "npc", icon: "🧙", label: "NPC" },
  { id: "spawn", icon: "🚩", label: "Spawn" },
  { id: "exit", icon: "🌀", label: "Exit" },
];

// The Props category expands to these placement tools in the sub-palette.
export const PROP_TOOLS = [
  { id: "chest", icon: "🧰", label: "Chest" },
  { id: "key", icon: "🗝️", label: "Key" },
  { id: "trap", icon: "🕸️", label: "Trap" },
  { id: "torch", icon: "🔥", label: "Light" },
  { id: "decor", icon: "🏺", label: "Decor" },
];
export const PROP_TOOL_IDS = PROP_TOOLS.map((t) => t.id);

// The Floor tool's sub-modes: three surface paints + a height sculpt pair.
export const FLOOR_MODES = [
  { id: "floor", icon: "⬜", label: "Floor" },
  { id: "lava", icon: "🌋", label: "Lava" },
  { id: "water", icon: "💧", label: "Water" },
  { id: "raise", icon: "🔼", label: "Raise" },
  { id: "lower", icon: "🔽", label: "Lower" },
];
const FLOOR_CT = { floor: 1, lava: 2, water: 3 };

const PAINT_CT = { floor: 1, lava: 2, water: 3, raise: 4 };

export class Builder {
  constructor(game) {
    this.g = game;
    this.tool = "floor";
    this.toolOpt = {};           // {etype, ttype, dtype, color}
    this.rot = 0;
    this.floor = 0;
    this.sel = null;             // selected object id
    this.hover = null;           // {x,z}
    this.drag = null;
    this.groups = [];            // per-floor render groups
    this.objMeshes = new Map();  // id → group
    this.peerCursors = new Map();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._listeners = [];
    // camera/input state must exist before the first update() — the game loop can
    // tick the builder mid-load, before async enter() runs _bindInput(). Without
    // this, update() throws on this.keys/this.camDist every frame and the builder
    // never comes up (the "can't enter builder" bug).
    this.keys = {};
    this.camYaw = 0; this.camPitch = 1.05; this.camDist = 42;
    this.camT = { x: 0, z: 0 };
    this.ready = false;
    this._undo = []; this._redo = []; this._noUndo = false; this._moveDrag = null;
  }

  // ── undo / redo (snapshot based — simple + always correct) ───────────────────
  _pushUndo() {
    if (this._noUndo) return;
    try {
      this._undo.push(JSON.stringify(D.serialize(this.d)));
      if (this._undo.length > 50) this._undo.shift();
      this._redo.length = 0;
      if (this.g.hud.refreshBuilderUndo) this.g.hud.refreshBuilderUndo(this);
    } catch (e) {}
  }
  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }
  undo() {
    if (!this._undo.length) return;
    this._redo.push(JSON.stringify(D.serialize(this.d)));
    this._restoreSnap(this._undo.pop());
  }
  redo() {
    if (!this._redo.length) return;
    this._undo.push(JSON.stringify(D.serialize(this.d)));
    this._restoreSnap(this._redo.pop());
  }
  _restoreSnap(json) {
    const d = D.sanitize(JSON.parse(json));
    // mutate in place so external references (game/session) stay valid
    this.d.floors = d.floors;
    if (d.difficulty != null) this.d.difficulty = d.difficulty;
    this.sel = null;
    this.floor = Math.min(this.floor, this.d.floors.length - 1);
    this.rebuildAll();
    this.g.hud.hideSelection && this.g.hud.hideSelection();
    this.g.hud.refreshValidate(this);
    this.g.hud.refreshBuilder(this);
    if (this.g.hud.refreshBuilderUndo) this.g.hud.refreshBuilderUndo(this);
    // co-build note: undo is local; peers reconcile on the next relayed op.
    if (this.session && this.session.sendFullState) this.session.sendFullState(this.d);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  async enter(dungeon, opts = {}) {
    this.d = dungeon;
    this.session = opts.session || this.g.session || null;
    this.floor = 0; this.sel = null; this.tool = "floor"; this.rot = 0;
    this.kit = await this.g.assets.kit(dungeon.theme);
    this.props = await this.g.assets.props(dungeon.theme);
    this.enemyTpls = await this.g.assets.enemies(dungeon.theme);
    this.items = await this.g.assets.items();

    this.root = new THREE.Group();
    this.g.world.add(this.root);

    // camera state
    const c = this._centerOfMass();
    this.camT = { x: c.x, z: c.z };
    this.camYaw = 0; this.camPitch = 1.05; this.camDist = 42;

    // grid + hover highlight
    this.gridHelper = this._makeGrid();
    this.root.add(this.gridHelper);
    this.hoverQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.25, depthWrite: false }));
    this.hoverQuad.visible = false;
    this.root.add(this.hoverQuad);
    this.ghost = null;

    this.rebuildAll();
    this._bindInput();
    this.g.hud.showBuilder(this);
    if (this.session) this.session.bindBuilder(this);
    this.ready = true;   // now safe for update() to run
    this.g.audit("builder.enter");
  }

  exit() {
    this.ready = false;
    this._unbindInput();
    this.g.hud.hideBuilder();
    if (this.session) this.session.bindBuilder(null);
    this.g.world.remove(this.root);
    this.objMeshes.clear();
    this.peerCursors.clear();
  }

  _centerOfMass() {
    const cells = Object.keys(this.d.floors[0].cells);
    if (!cells.length) return { x: D.SIZE / 2 * CELL, z: D.SIZE / 2 * CELL };
    let sx = 0, sz = 0;
    cells.forEach((k) => { const [x, z] = k.split(",").map(Number); sx += x; sz += z; });
    return { x: (sx / cells.length + 0.5) * CELL, z: (sz / cells.length + 0.5) * CELL };
  }

  _makeGrid() {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x8888aa, transparent: true, opacity: 0.14 });
    const pts = [];
    for (let i = 0; i <= D.SIZE; i++) {
      pts.push(new THREE.Vector3(i * CELL, 0, 0), new THREE.Vector3(i * CELL, 0, D.SIZE * CELL));
      pts.push(new THREE.Vector3(0, 0, i * CELL), new THREE.Vector3(D.SIZE * CELL, 0, i * CELL));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    g.add(new THREE.LineSegments(geo, mat));
    return g;
  }

  // ── rendering ───────────────────────────────────────────────────────────────
  rebuildAll() {
    for (const gr of this.groups) this.root.remove(gr.group);
    this.groups = [];
    this.objMeshes.clear();
    for (let f = 0; f < this.d.floors.length; f++) this.groups.push(this._buildFloor(f));
    this._applyFloorVisibility();
    this.g.hud.refreshBuilder(this);
  }

  rebuildFloor(f) {
    if (!this.groups[f]) return this.rebuildAll();
    this.root.remove(this.groups[f].group);
    for (const [id, m] of [...this.objMeshes]) if (m.userData.f === f) this.objMeshes.delete(id);
    this.groups[f] = this._buildFloor(f);
    this._applyFloorVisibility();
    this.g.hud.refreshBuilder(this);
  }

  _buildFloor(f) {
    const fl = this.d.floors[f];
    const group = new THREE.Group();
    group.position.y = f * FLOOR_H;
    this.root.add(group);
    const cells = Object.keys(fl.cells);
    const m4 = new THREE.Matrix4();

    // cell surfaces: stone / lava / water / raised+steps
    const surf = makeCellSurfaces(D, this.d, f, this.kit);
    group.add(surf.group);
    this._surfMats = this._surfMats || [];
    this._surfMats[f] = [surf.lavaMat, surf.waterMat].filter(Boolean);

    // walls — every floor↔void edge gets one; the gate module carries its own
    // wall plane inside the door cell, so no edge filtering is needed
    const segs = D.wallSegments(this.d, f);
    const wInst = makeInstanced(this.kit.wall.scene, Math.max(1, segs.length));
    // builder shows LOW walls so you can always see inside your dungeon
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 0.42, 1);
    segs.forEach((s, i) => {
      const cx = s.x * CELL + CELL / 2, cz = s.z * CELL + CELL / 2;
      const dir = D.DIRS[s.side];
      // wall plane sits on the cell edge, facing inward
      pos.set(cx + dir.dx * (CELL / 2 - 0.12), 0, cz + dir.dz * (CELL / 2 - 0.12));
      const yaw = s.side === 0 ? Math.PI : s.side === 1 ? -Math.PI / 2 : s.side === 2 ? 0 : Math.PI / 2;
      q.setFromAxisAngle(up, yaw);
      m4.compose(pos, q, scl);
      wInst.setMatrixAt(i, m4);
    });
    wInst.setCount(segs.length); wInst.commit();
    group.add(wInst.group);

    // objects (sit on the cell's walk surface — raised platforms lift them)
    for (const o of fl.objects) {
      const mesh = this._objMesh(o, f);
      if (mesh) {
        mesh.position.y += D.cellHeight(this.d, f, o.x, o.z);
        mesh.userData = { id: o.id, f, kind: o.kind };
        group.add(mesh);
        this.objMeshes.set(o.id, mesh);
      }
    }
    return { group, surf, wInst };
  }

  _objMesh(o, f) {
    const A = this.g.assets;
    const grp = new THREE.Group();
    const cx = o.x * CELL + CELL / 2, cz = o.z * CELL + CELL / 2;
    grp.position.set(cx, 0, cz);
    grp.rotation.y = -(o.rot || 0) * Math.PI / 2;
    const add = (tpl, h, foot) => {
      if (!tpl) return null;
      const m = A.clone(tpl);
      if (h) Assets.normalizeH(m, h);
      else if (foot) Assets.normalizeFoot(m, foot);
      grp.add(m);
      return m;
    };
    switch (o.kind) {
      case "door": {
        grp.rotation.y = D.doorAxis(this.d, this.floor, o.x, o.z) === 0 ? -Math.PI / 2 : 0; // face the doorway
        add(this.kit.gate);
        if (o.locked) { const bars = add(this.kit.gateLocked); bars.name = "bars"; bars.position.z += 0.02; }
        else { const leaf = add(this.kit.gateDoor); leaf.name = "leaf"; }
        if (o.locked) grp.add(this._lockIcon());
        break;
      }
      case "stairs": {
        const m = add(this.kit.stairs);
        // kit stairs span 2 cells deep rising one floor; recenter across cell + landing
        if (m) { const b = new THREE.Box3().setFromObject(m); const size = b.getSize(new THREE.Vector3());
          m.scale.multiplyScalar(Math.min((CELL * 2) / Math.max(size.z, 0.01), (FLOOR_H + 0.15) / Math.max(size.y, 0.01)));
          const b2 = new THREE.Box3().setFromObject(m); m.position.y -= b2.min.y;
          m.position.z += CELL / 2; }
        break;
      }
      case "chest": add(this.props.chest || this.props.chestShared, 1.5); break;
      case "key": {
        const k = add(this.items.key, null, 1.0);
        if (k) { k.position.y = 0.8; grp.userData.spin = k; }
        const glow = new THREE.PointLight(0xffd769, 4, 5); glow.position.y = 1.2; grp.add(glow);
        break;
      }
      case "enemy": {
        const tpl = this.enemyTpls[o.etype] || Object.values(this.enemyTpls)[0];
        const K = (D.ENEMIES[this.d.theme] || {})[o.etype] || {};
        if (tpl) {
          const h = K.boss ? 2.6 : o.etype === "spider" || o.etype === "drone" ? 1.1 : o.etype === "turret" ? 1.5 : 1.7;
          const { obj, mixer } = makeCreature(A, tpl, h, THREE);
          if (K.fly || o.etype === "android" || o.etype === "drone") obj.position.y += 0.9;
          grp.add(obj);
          if (mixer) grp.userData.mixer = mixer;
        }
        // key badge if a key shares this cell
        if (D.objsAt(this.d, f, o.x, o.z).some((k) => k.kind === "key")) grp.add(this._keyBadge());
        break;
      }
      case "trap": {
        if (o.ttype === "vent") {
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 20),
            new THREE.MeshStandardMaterial({ color: 0x333340, emissive: this.d.theme === "scifi" ? 0xff2244 : 0xff6a00, emissiveIntensity: 0.6 }));
          disc.position.y = 0.06; grp.add(disc);
        } else {
          add(this.props.spikeShared || this.props["spike-trap"], null, CELL * 0.8);
        }
        break;
      }
      case "torch": {
        grp.add(makeTorch(this.d.theme));
        const l = new THREE.PointLight(this.g.look.torch, 8, 12, 1.6); l.position.y = 2.6; grp.add(l);
        grp.userData.flicker = l;
        break;
      }
      case "light": {
        const col = new THREE.Color(o.color || (this.d.theme === "scifi" ? "#37e0ff" : "#ff9a3c"));
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.4 }));
        orb.position.y = 3.1; grp.add(orb);
        const l = new THREE.PointLight(col, 10, 13, 1.5); l.position.y = 3.0; grp.add(l);
        break;
      }
      case "decor": {
        const tpl = this.props[o.dtype] || this.props.crate;
        add(tpl, null, o.dtype === "pillar" ? 1.4 : o.dtype === "bookshelf" || o.dtype === "terminal" ? 2.2 : 1.8);
        break;
      }
      case "npc": {
        const T = D.NPC_TYPES[o.ntype] || D.NPC_TYPES.merchant;
        grp.add(makeNpc(o.ntype, this.d.theme));
        grp.add(this._merchBadge(T.icon));
        const l = new THREE.PointLight(T.tint || 0xffd769, 6, 8); l.position.y = 2.7; grp.add(l);
        break;
      }
      case "spawn": {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.5, 28).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x59ff9c, transparent: true, opacity: 0.85 }));
        ring.position.y = 0.06; grp.add(ring);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 4),
          new THREE.MeshBasicMaterial({ color: 0x59ff9c }));
        arrow.position.set(0, 0.5, 0.9); arrow.rotation.x = Math.PI / 2; grp.add(arrow);
        break;
      }
      case "exit": {
        const torus = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.18, 12, 36),
          new THREE.MeshStandardMaterial({ color: 0x111122, emissive: this.g.look.portal, emissiveIntensity: 2.6 }));
        torus.position.y = 1.8; grp.add(torus);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.28, 30),
          new THREE.MeshBasicMaterial({ color: this.g.look.portal, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        disc.position.y = 1.8; grp.add(disc);
        grp.userData.portal = torus;
        const l = new THREE.PointLight(this.g.look.portal, 12, 14, 1.6); l.position.y = 2; grp.add(l);
        break;
      }
      default: return null;
    }
    return grp;
  }

  _lockIcon() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTexture(), transparent: true, depthTest: false }));
    spr.scale.set(1.4, 1.4, 1);
    spr.position.y = 4.4;
    spr.name = "lockicon";
    return spr;
  }
  _keyBadge() {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: keyTexture(), transparent: true, depthTest: false }));
    spr.scale.set(1.1, 1.1, 1);
    spr.position.y = 2.6;
    return spr;
  }
  _merchBadge(icon) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(icon || "🛒"), transparent: true, depthTest: false }));
    spr.scale.set(1.4, 1.4, 1);
    spr.position.y = 3.1;
    return spr;
  }

  _applyFloorVisibility() {
    this.groups.forEach((gr, f) => {
      const isCur = f === this.floor;
      const isBelow = f === this.floor - 1;   // one faint ghost floor beneath for alignment
      gr.group.visible = isCur || isBelow;
      gr.group.traverse((o) => {
        if (o.isMesh) {
          if (isBelow) {
            // swap to a dimmed clone so the lower floor reads as a faint reference,
            // not a second floor stacked on the current one (materials are shared
            // across floors, so we must clone rather than mutate in place)
            if (!o.userData._origMat) o.userData._origMat = o.material;
            if (!o.userData._ghostMat) {
              const mk = (m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.14; c.depthWrite = false; return c; };
              const src = o.userData._origMat;
              o.userData._ghostMat = Array.isArray(src) ? src.map(mk) : mk(src);
            }
            o.material = o.userData._ghostMat;
          } else if (o.userData._origMat) {
            o.material = o.userData._origMat;   // full strength on the active floor
          }
        } else if (o.isSprite) {
          o.material.opacity = isBelow ? 0.2 : 1;
        } else if (o.isLight) {
          o.visible = isCur;                    // only the active floor's lights illuminate
        }
      });
    });
    this.gridHelper.position.y = this.floor * FLOOR_H + 0.02;
    this.hoverQuad.position.y = this.floor * FLOOR_H + 0.05;
  }

  // ── input ───────────────────────────────────────────────────────────────────
  _bindInput() {
    const el = this.g.renderer.domElement;
    const on = (t, fn, tgt) => { (tgt || el).addEventListener(t, fn); this._listeners.push([t, fn, tgt || el]); };
    this.keys = {};
    on("pointerdown", (e) => this._onDown(e));
    on("pointermove", (e) => this._onMove(e));
    on("pointerup", (e) => this._onUp(e));
    on("wheel", (e) => { this.camDist = Math.max(10, Math.min(120, this.camDist * (e.deltaY > 0 ? 1.12 : 0.9))); e.preventDefault(); }, el);
    on("contextmenu", (e) => e.preventDefault(), el);
    on("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") { e.preventDefault(); this.redo(); return; }
      if (e.code === "KeyR") { this.rot = (this.rot + 1) % 4; if (this.sel) this._editSel({ rot: (D.objById(this.d, this.sel)?.obj.rot + 1) % 4 }); }
      if (e.code === "Delete" || e.code === "Backspace") { if (this.sel) this.deleteSelected(); }
      if (e.code === "Tab") { e.preventDefault(); this.setFloor((this.floor + 1) % this.d.floors.length); }
      if (e.code === "Escape") this.select(null);
    }, window);
    on("keyup", (e) => { this.keys[e.code] = false; }, window);
  }
  _unbindInput() {
    for (const [t, fn, tgt] of this._listeners) tgt.removeEventListener(t, fn);
    this._listeners = [];
  }

  _pointerCell(e) {
    const el = this.g.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.g.camera);
    this._plane.constant = -this.floor * FLOOR_H;
    const pt = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._plane, pt)) return null;
    const x = Math.floor(pt.x / CELL), z = Math.floor(pt.z / CELL);
    if (!D.inBounds(x, z)) return null;
    return { x, z, px: pt.x, pz: pt.z, ndc };
  }

  _pickObject(e) {
    const el = this.g.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.g.camera);
    const grp = this.groups[this.floor];
    if (!grp) return null;
    const hits = this._raycaster.intersectObjects(grp.group.children.filter((c) => c.userData && c.userData.id), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !(o.userData && o.userData.id)) o = o.parent;
      if (o) return o.userData.id;
    }
    return null;
  }

  _onDown(e) {
    if (e.button === 2 || e.button === 1) { this._orbit = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.shiftKey }; return; }
    const cell = this._pointerCell(e);
    if (!cell) return;
    if (this.tool === "select") {
      const id = this._pickObject(e);
      this.select(id);
      // start a move-drag on the picked object (drag it to a new cell)
      if (id) {
        this._pushUndo();
        this._noUndo = true;                       // suppress per-frame snapshots while dragging
        this._moveDrag = { id, moved: false, startCell: cell };
      }
      return;
    }
    // Floor tool: floor/lava/water paint a rectangle (single click = one cell);
    // raise/lower sculpt each dragged cell's height. (Room tool merged in here.)
    if (this.tool === "floor" || this.tool === "room") {
      const mode = this.toolOpt.floorMode || "floor";
      this._pushUndo();
      if (mode === "raise" || mode === "lower") {
        this._noUndo = true;
        this.drag = { height: mode, done: new Set() };
        this._heightPaint(cell);
      } else {
        this.drag = { room: cell, ct: FLOOR_CT[mode] || 1 };
      }
      return;
    }
    if (PAINT_CT[this.tool] || this.tool === "erase") {   // erase paints free-form
      this._pushUndo();
      this._noUndo = true;                          // whole paint-drag = one undo step
      this.drag = { paint: true };
      this._paint(cell);
      return;
    }
    this._pushUndo();
    this._placeAt(cell);
  }

  _onMove(e) {
    if (this._orbit) {
      const dx = e.clientX - this._orbit.x, dy = e.clientY - this._orbit.y;
      this._orbit.x = e.clientX; this._orbit.y = e.clientY;
      if (this._orbit.pan) {
        const s = this.camDist / 500;
        const cos = Math.cos(this.camYaw), sin = Math.sin(this.camYaw);
        this.camT.x -= (dx * cos - dy * sin) * s * 1.4;
        this.camT.z -= (dx * sin + dy * cos) * s * 1.4;
      } else {
        this.camYaw -= dx * 0.005;
        this.camPitch = Math.max(0.25, Math.min(1.45, this.camPitch + dy * 0.004));
      }
      return;
    }
    const cell = this._pointerCell(e);
    this.hover = cell;
    if (cell && this.drag && this.drag.paint) this._paint(cell);
    if (cell && this.drag && this.drag.height) this._heightPaint(cell);
    // drag a selected object onto a new cell (must land on existing floor)
    if (cell && this._moveDrag) {
      const o = D.objById(this.d, this._moveDrag.id);
      if (o && (o.obj.x !== cell.x || o.obj.z !== cell.z) && D.hasCell(this.d, this.floor, cell.x, cell.z)) {
        this.applyLocal({ t: "objEdit", id: this._moveDrag.id, p: { x: cell.x, z: cell.z } });
        this._moveDrag.moved = true;
        this.g.hud.showSelection(this, D.objById(this.d, this._moveDrag.id));
      }
    }
    // live room-rectangle preview while dragging the Room tool
    if (cell && this.drag && this.drag.room) this._updateRoomPreview(this.drag.room, cell);
    if (this.session && cell) this.session.sendCursor(this.floor, cell.x, cell.z);
  }

  _onUp(e) {
    if (this._orbit) { this._orbit = null; return; }
    if (this._moveDrag) {
      // if the object never actually moved, drop the snapshot we pushed on down
      if (!this._moveDrag.moved && this._undo.length) this._undo.pop();
      this._moveDrag = null; this._noUndo = false;
      if (this.g.hud.refreshBuilderUndo) this.g.hud.refreshBuilderUndo(this);
    }
    if (this.drag && this.drag.height) { this._noUndo = false; if (this.g.hud.refreshBuilderUndo) this.g.hud.refreshBuilderUndo(this); }
    if (this.drag && this.drag.room) {
      const a = this.drag.room, b = this.hover || a;   // click with no drag = single cell
      const x0 = Math.min(a.x, b.x), z0 = Math.min(a.z, b.z);
      const w = Math.abs(a.x - b.x) + 1, h = Math.abs(a.z - b.z) + 1;
      const ops = D.stampRoom(this.d, this.floor, x0, z0, w, h, this.drag.ct || 1);
      if (ops.length) { ops.forEach((op) => this._broadcast(op)); this.rebuildFloor(this.floor); this.g.audio.sfx("place"); }
      else if (this._undo.length) this._undo.pop();   // nothing changed → drop the snapshot
    }
    this._clearRoomPreview();
    if (this.drag && this.drag.paint) { this._noUndo = false; if (this.g.hud.refreshBuilderUndo) this.g.hud.refreshBuilderUndo(this); }
    this.drag = null;
  }

  // translucent rectangle covering the Room drag so you see the area before release
  _updateRoomPreview(a, b) {
    const x0 = Math.min(a.x, b.x), z0 = Math.min(a.z, b.z);
    const w = Math.abs(a.x - b.x) + 1, h = Math.abs(a.z - b.z) + 1;
    if (!this.roomPreview) {
      this.roomPreview = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.28, depthWrite: false }));
      this.root.add(this.roomPreview);
    }
    this.roomPreview.visible = true;
    this.roomPreview.scale.set(w * CELL, 1, h * CELL);
    this.roomPreview.position.set((x0 + w / 2) * CELL, this.floor * FLOOR_H + 0.06, (z0 + h / 2) * CELL);
  }
  _clearRoomPreview() { if (this.roomPreview) this.roomPreview.visible = false; }

  // raise/lower a cell's height once per drag gesture (rolling terrain sculpt)
  _heightPaint(cell) {
    const k = D.ck(cell.x, cell.z);
    if (!this.drag || !this.drag.done || this.drag.done.has(k)) return;
    this.drag.done.add(k);
    const op = { t: this.drag.height, f: this.floor, x: cell.x, z: cell.z };
    const res = D.applyOp(this.d, op);
    if (res.ok) { this._broadcast(op); this.rebuildFloor(this.floor); this.g.audio.sfx("place"); this.g.hud.refreshValidate(this); }
  }

  _paint(cell) {
    if (this.tool === "erase") {
      // erase object first if present, then the cell itself
      const objs = D.objsAt(this.d, this.floor, cell.x, cell.z);
      if (objs.length) { this.applyLocal({ t: "obj-", id: objs[objs.length - 1].id }); return; }
      if (!D.hasCell(this.d, this.floor, cell.x, cell.z)) return;
      this.applyLocal({ t: "cell-", f: this.floor, x: cell.x, z: cell.z });
      return;
    }
    const ct = PAINT_CT[this.tool] || 1;
    if (D.cellType(this.d, this.floor, cell.x, cell.z) === ct) return; // already painted
    this.applyLocal({ t: "cell+", f: this.floor, x: cell.x, z: cell.z, ct });
  }

  _placeAt(cell) {
    const o = { kind: this.tool, x: cell.x, z: cell.z, rot: this.rot };
    if (this.tool === "enemy") o.etype = this.toolOpt.etype || Object.keys(D.ENEMIES[this.d.theme])[0];
    if (this.tool === "trap") o.ttype = this.toolOpt.ttype || "spikes";
    if (this.tool === "decor") o.dtype = this.toolOpt.dtype || D.DECOR[this.d.theme][0];
    if (this.tool === "npc") { o.ntype = this.toolOpt.ntype || "merchant"; o.stock = D.SHOP_IDS.slice(); }
    if (this.tool === "light") o.color = this.toolOpt.color;
    if (this.tool === "torch") o.kind = "torch";
    const op = { t: "obj+", f: this.floor, o };
    const res = this.applyLocal(op);
    if (!res.ok) { this.g.hud.toast(placeError(res.err), "warn"); this.g.audio.sfx("error"); }
    else {
      this.g.audio.sfx("place");
      if (this.tool === "stairs") this._ensureLanding(cell);
      if (this.tool === "door") this.select(res.id); // immediately show the lock toggle
    }
  }

  _ensureLanding(cell) {
    // auto-create the landing cell one floor up so stairs "just work"
    const dir = D.DIRS[this.rot % 4];
    if (this.floor + 1 >= this.d.floors.length) {
      if (this.d.floors.length < D.MAX_FLOORS) { this.applyLocal({ t: "floor+" }); this.g.hud.toast("Added floor " + (this.d.floors.length) + " for the stairs", "info"); }
      else return;
    }
    const lx = cell.x + dir.dx, lz = cell.z + dir.dz;
    if (!D.hasCell(this.d, this.floor + 1, lx, lz)) {
      this.applyLocal({ t: "cell+", f: this.floor + 1, x: lx, z: lz });
      this.g.hud.toast("Landing tile added on the floor above", "info");
    }
  }

  // ── op plumbing (local + remote) ───────────────────────────────────────────
  applyLocal(op) {
    const res = D.applyOp(this.d, op);
    if (res.ok) {
      this._broadcast(op);
      this.rebuildFloor(op.f != null ? op.f : this.floor);
      if (op.t === "floor+" || op.t === "floor-") this.rebuildAll();
      this.g.hud.refreshValidate(this);
    }
    return res;
  }
  _broadcast(op) { if (this.session) this.session.sendOp(op); }
  applyRemoteOp(op) {
    const res = D.applyOp(this.d, op);
    if (res.ok) {
      this.rebuildAll();
      this.g.hud.refreshValidate(this);
    }
    return res;
  }

  // ── selection ───────────────────────────────────────────────────────────────
  select(id) {
    this.sel = id;
    this.g.hud.showSelection(this, id ? D.objById(this.d, id) : null);
  }
  _editSel(p) {
    if (!this.sel) return;
    this._pushUndo();
    this.applyLocal({ t: "objEdit", id: this.sel, p });
    this.g.hud.showSelection(this, D.objById(this.d, this.sel));
  }
  toggleLock() {
    if (!this.sel) return;
    const hit = D.objById(this.d, this.sel);
    if (!hit || hit.obj.kind !== "door") return;
    this._editSel({ locked: !hit.obj.locked });
    this.g.audio.sfx(hit.obj.locked ? "unlock" : "lock");
  }
  rotateSelected() {
    if (!this.sel) return;
    const hit = D.objById(this.d, this.sel);
    if (hit) this._editSel({ rot: ((hit.obj.rot || 0) + 1) % 4 });
  }
  deleteSelected() {
    if (!this.sel) return;
    this._pushUndo();
    this.applyLocal({ t: "obj-", id: this.sel });
    this.select(null);
    this.g.audio.sfx("erase");
  }

  setFloor(f) {
    this.floor = Math.max(0, Math.min(this.d.floors.length - 1, f));
    this._applyFloorVisibility();
    this.g.hud.refreshBuilder(this);
  }
  addFloor() {
    this._pushUndo();
    const res = this.applyLocal({ t: "floor+" });
    if (res.ok) this.setFloor(this.d.floors.length - 1);
  }
  setTool(t, opt) {
    // "props" is a category — activate the last-used prop tool (default chest)
    if (t === "props") t = PROP_TOOL_IDS.includes(this._lastProp) ? this._lastProp : "chest";
    if (PROP_TOOL_IDS.includes(t)) this._lastProp = t;
    this.tool = t;
    if (opt) Object.assign(this.toolOpt, opt);
    this.select(null);
    this.g.hud.refreshBuilder(this);
  }

  validateNow() { return D.validate(this.d); }

  // ── remote cursors ──────────────────────────────────────────────────────────
  showPeerCursor(peerId, name, f, x, z, color) {
    let c = this.peerCursors.get(peerId);
    if (!c) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: color || 0xffaa33, transparent: true, opacity: 0.4, depthWrite: false }));
      const spr = makeTextSprite(name || "friend");
      spr.position.y = 2.2;
      const grp = new THREE.Group(); grp.add(quad, spr);
      this.root.add(grp);
      c = { grp, at: 0 };
      this.peerCursors.set(peerId, c);
    }
    c.grp.position.set(x * CELL + CELL / 2, f * FLOOR_H + 0.08, z * CELL + CELL / 2);
    c.grp.visible = f === this.floor;
    c.at = performance.now();
  }

  // ── per-frame ───────────────────────────────────────────────────────────────
  update(dt) {
    if (!this.ready) return;   // don't tick until async enter() has finished loading
    // animate lava/water shaders
    const st = performance.now() / 1000;
    for (const arr of (this._surfMats || [])) if (arr) for (const m of arr) if (m && m.uniforms) m.uniforms.uTime.value = st;
    // camera
    const sp = this.camDist * 0.9 * dt;
    const cos = Math.cos(this.camYaw), sin = Math.sin(this.camYaw);
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) { this.camT.x -= sin * sp; this.camT.z -= cos * sp; }
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) { this.camT.x += sin * sp; this.camT.z += cos * sp; }
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) { this.camT.x -= cos * sp; this.camT.z += sin * sp; }
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) { this.camT.x += cos * sp; this.camT.z -= sin * sp; }
    const y = this.floor * FLOOR_H;
    const cx = this.camT.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const cz = this.camT.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const cy = y + Math.sin(this.camPitch) * this.camDist;
    this.g.camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 8));
    this.g.camera.lookAt(this.camT.x, y, this.camT.z);

    // hover highlight + ghost
    if (this.hover && this.tool !== "select") {
      this.hoverQuad.visible = true;
      this.hoverQuad.position.x = this.hover.x * CELL + CELL / 2;
      this.hoverQuad.position.z = this.hover.z * CELL + CELL / 2;
      const valid = PAINT_CT[this.tool] || this.tool === "room" || this.tool === "erase"
        ? true : D.hasCell(this.d, this.floor, this.hover.x, this.hover.z);
      this.hoverQuad.material.color.set(valid ? 0x66ffcc : 0xff5566);
    } else this.hoverQuad.visible = false;

    // animated bits: torch flicker, key spin, portal spin, enemy idle mixers
    const t = performance.now() / 1000;
    for (const [, m] of this.objMeshes) {
      if (m.userData) {
        if (m.userData.mixer) m.userData.mixer.update(dt);
        const flk = m.children.find((c) => c.isPointLight);
        if (flk && m.userData.kind === "torch") flk.intensity = 7 + Math.sin(t * 9 + m.position.x) * 1.6;
        if (m.userData.kind === "key") m.children.forEach((c) => { if (!c.isPointLight && !c.isSprite) c.rotation.y = t * 1.6; });
        if (m.userData.kind === "exit") m.children.forEach((c) => { if (c.geometry && c.geometry.type === "TorusGeometry") c.rotation.z = t * 0.8; });
      }
    }
    // expire stale cursors
    for (const [id, c] of this.peerCursors) {
      if (performance.now() - c.at > 6000) { this.root.remove(c.grp); this.peerCursors.delete(id); }
    }
  }

  // test hook used by the preview harness (pointer events don't reach us there)
  testPlace(tool, x, z, opt) {
    this.setTool(tool, opt);
    this._placeAt({ x, z });
    return D.objsAt(this.d, this.floor, x, z).map((o) => o.id);
  }
  testPaint(x, z, erase) {
    this.setTool(erase ? "erase" : "floor");
    this._paint({ x, z });
  }
  state() {
    return {
      tool: this.tool, floor: this.floor, floors: this.d.floors.length,
      cells: Object.keys(this.d.floors[this.floor].cells).length,
      objects: this.d.floors[this.floor].objects.length,
      sel: this.sel, validate: D.validate(this.d),
    };
  }
}

function placeError(err) {
  return {
    nocell: "Place floor tiles first — objects need ground under them",
    occupied: "That tile is already taken",
    oob: "Outside the buildable area",
    maxfloors: "Max " + D.MAX_FLOORS + " floors",
    notempty: "Clear the top floor before removing it",
  }[err] || ("Can't place: " + err);
}

let _lockTex, _keyTex;
function lockTexture() {
  if (_lockTex) return _lockTex;
  _lockTex = emojiTexture("🔒");
  return _lockTex;
}
function keyTexture() {
  if (_keyTex) return _keyTex;
  _keyTex = emojiTexture("🗝️");
  return _keyTex;
}
function emojiTexture(ch) {
  const c = document.createElement("canvas"); c.width = c.height = 96;
  const g = c.getContext("2d");
  g.font = "72px serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(ch, 48, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeTextSprite(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "700 30px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(0,0,0,.55)"; roundRect(g, 8, 8, 240, 48, 12); g.fill();
  g.fillStyle = "#ffe9b0"; g.fillText(text.slice(0, 14), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(3.4, 0.85, 1);
  return spr;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
