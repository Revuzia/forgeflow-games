/**
 * CHROMA HIDE — runtime/game.js
 * The match orchestrator: builds the map meshes + actor bodies from the pure
 * sim (match_sim), drives the phase machine each frame, manages cameras (hider
 * third-person / paint-orbit, seeker first- or third-person), wires the paint
 * system to the local hider and a gun raycast to the local seeker, and updates
 * the HUD. Emits onEnd(result) so main.js can show the results screen.
 *
 * All movement/collision/AI live in match_sim (pure); this file is presentation
 * + input. It exposes window.__CHROMA__.game test hooks so a headless/backgrounded
 * pane can drive the local player and assert a round resolves.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createMatch, stepMatch, setLocalInput, seekers, hiders, SIM } from "./sim/match_sim.js";
import { PHASE, ROLE, MODE, sanitizeSettings, DEFAULTS, computeSeekerCount, MODE_INFO } from "./sim/match_core.js";
import { getMap, toSimMap } from "./maps.js";
import { PaintSystem } from "./paint.js";
import { createPaintPanel } from "./paint_ui.js";
import { makeChameleonGeo, addChameleonFace } from "./chameleon.js";
import { GameAudio } from "./audio.js";
import { clamp, hashStr } from "./sim/util.js";

const BODY_R = 0.42, BODY_LEN = 0.9, BODY_Y = BODY_R + BODY_LEN / 2 + 0.02;

export class Game {
  constructor(engine, config, hud, callbacks) {
    this.engine = engine;
    this.hud = hud;
    this.cb = callbacks || {};
    this.mapDef = getMap(config.mapId || "manor");
    this.settings = sanitizeSettings({ ...DEFAULTS, mode: config.mode || MODE.NORMAL });
    this.localRole = config.role || ROLE.HIDER;

    // online plumbing
    this.online = !!config.online;
    this.net = config.net || null;
    this.isHost = this.online ? config.netRole === "host" : false;
    this.paintByActor = new Map();
    this._lastSnap = null; this._pendingShots = []; this._snapAccum = 0; this._paintSent = 0; this._paintThrottle = 0;

    if (this.online) {
      const r = config.roster;
      this.mapDef = getMap(r.mapId || "manor");
      this.settings = sanitizeSettings(r.settings || { ...DEFAULTS });
      this.seed = r.seed >>> 0;
      const myId = this.net.myId();
      const players = r.players.map((p) => ({ id: p.id, isBot: !!p.isBot, role: p.role, name: p.name, isLocal: p.id === myId }));
      this.sim = createMatch({ players, settings: this.settings, map: toSimMap(this.mapDef), seed: this.seed, seekerCount: r.seekerCount });
      this.local = this.sim.actors.find((a) => a.isLocal);
      this.localRole = this.local ? this.local.role : ROLE.HIDER;
      this._names = {}; players.forEach((p) => { this._names[p.id] = p.isLocal ? "You" : (p.name || ("Player-" + String(p.id).slice(-3))); });
      this._wireNet();
    } else {
      const nPlayers = clamp(config.players || 6, 2, 10);
      const seekerCount = computeSeekerCount(nPlayers);
      const players = this._roster(nPlayers, seekerCount);
      this.seed = (hashStr(config.seed || "chroma") + Date.now()) >>> 0;
      this.sim = createMatch({ players, settings: this.settings, map: toSimMap(this.mapDef), seed: this.seed, seekerCount });
      this.local = this.sim.actors.find((a) => a.isLocal);
    }

    this.root = new THREE.Group(); engine.scene.add(this.root);
    this.meshes = new Map();
    this.paint = null; this.paintPanel = null; this.paintMode = false;
    this.keys = new Set();
    // camDist 6 was too far for 8m-deep rooms: the target sat outside the wall, so
    // collision pulled the camera in and the lift flipped it to a top-down view.
    this.camYaw = 0; this.camPitch = 0.34; this.camDist = 4.2;
    this.thirdPerson = this.localRole === ROLE.HIDER;
    this._alive = true; this._ended = false; this._lastPhase = null;
    this._muzzle = 0;

    this.audio = (this.cb && this.cb.audio) || new GameAudio();
    this.audio.loadVolume();

    this._buildMap();
    this._spawnActors();
    this._setupInput();
    this._buildEmoteBar();
    this._unsub = engine.onFrame((dt) => this._update(dt));
    this.hud.show(); this.hud.setRole(this.localRole);
    this.audio.startMusic();
  }

  _roster(n, seekerCount) {
    const players = [];
    let seekersLeft = seekerCount, hidersLeft = n - seekerCount;
    // local first, with its chosen role
    if (this.localRole === ROLE.SEEKER) { players.push({ id: "you", isLocal: true, role: ROLE.SEEKER }); seekersLeft--; }
    else { players.push({ id: "you", isLocal: true, role: ROLE.HIDER }); hidersLeft--; }
    const names = ["Vex", "Rune", "Mica", "Pip", "Sol", "Wisp", "Bram", "Kite", "Fen", "Ivo", "Zed"];
    for (let i = 0; i < n - 1; i++) {
      const role = seekersLeft > 0 ? (ROLE.SEEKER) : ROLE.HIDER;
      if (role === ROLE.SEEKER) seekersLeft--; else hidersLeft--;
      players.push({ id: "bot" + i, isBot: true, role, name: names[i % names.length] });
    }
    this._names = { you: "You" };
    players.forEach((p) => { if (p.name) this._names[p.id] = p.name; });
    return players;
  }

  // ── 3D map from pure data ──────────────────────────────────────────────────
  _buildMap() {
    const m = this.mapDef, g = this.root;
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry((m.bounds.maxX - m.bounds.minX) + 2, (m.bounds.maxZ - m.bounds.minZ) + 2),
      new THREE.MeshStandardMaterial({ color: m.ground.color, roughness: m.ground.roughness, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((m.bounds.minX + m.bounds.maxX) / 2, 0, (m.bounds.minZ + m.bounds.maxZ) / 2);
    floor.receiveShadow = true; g.add(floor); this.floor = floor;
    this.paintable = [floor];

    // per-room themed floor zones (distinct palette per room — the multi-room look)
    if (m.rooms) for (const r of m.rooms) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), new THREE.MeshStandardMaterial({ color: r.floor, roughness: 0.92, metalness: 0.02 }));
      tile.rotation.x = -Math.PI / 2; tile.position.set(r.x, 0.02, r.z); tile.receiveShadow = true; g.add(tile);
    }

    // perimeter walls
    const wh = m.wallHeight, th = m.perimeter.thickness, wm = () => new THREE.MeshStandardMaterial({ color: m.perimeter.color, roughness: m.perimeter.roughness, metalness: 0 });
    const cx = (m.bounds.minX + m.bounds.maxX) / 2, cz = (m.bounds.minZ + m.bounds.maxZ) / 2;
    const W = m.bounds.maxX - m.bounds.minX, D = m.bounds.maxZ - m.bounds.minZ;
    const addWall = (x, z, w, d) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wm()); mesh.position.set(x, wh / 2, z); mesh.receiveShadow = true; g.add(mesh); this.paintable.push(mesh); };
    addWall(cx, m.bounds.minZ - th / 2, W + th * 2, th);
    addWall(cx, m.bounds.maxZ + th / 2, W + th * 2, th);
    addWall(m.bounds.minX - th / 2, cz, th, D);
    addWall(m.bounds.maxX + th / 2, cz, th, D);

    // interior dividing walls with doorway gaps (multi-room maps)
    if (m.walls) for (const iw of m.walls) addWall(iw.x, iw.z, iw.w, iw.d);

    // props (paintable cover). Dense campus maps carry 250-400 props, so share box
    // geometries + materials by value — otherwise every dressing cube allocates its
    // own GPU buffers and the context dies.
    const geoCache = new Map(), matCache = new Map();
    const boxGeo = (w, h, d) => { const k = `${w}|${h}|${d}`; let g2 = geoCache.get(k); if (!g2) { g2 = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g2); } return g2; };
    const boxMat = (c, r, mt) => { const k = `${c}|${r}|${mt}`; let m2 = matCache.get(k); if (!m2) { m2 = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt }); matCache.set(k, m2); } return m2; };
    for (const p of m.props) {
      const mesh = new THREE.Mesh(boxGeo(p.w, p.h, p.d), boxMat(p.color, p.rough, p.metal || 0));
      mesh.position.set(p.x, p.h / 2, p.z); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.prop = p;
      g.add(mesh); this.paintable.push(mesh);
      if (p.model) this._loadProp(p, mesh);   // swap the box for a real furniture GLB when it loads
    }

    // seeker alcove marker
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.6, emissive: 0x14203a }));
    cage.position.set(m.spawn.seeker.x, 0.06, m.spawn.seeker.z); g.add(cage);

    // lights
    for (const l of m.lights) {
      if (l.type === "point") { const pl = new THREE.PointLight(l.color, l.intensity, l.dist, 2); pl.position.set(l.x, l.y, l.z); g.add(pl); }
    }
    this.engine.hemi.intensity = m.ambient.intensity;
    this.engine.hemi.color.setHex(m.ambient.sky); this.engine.hemi.groundColor.setHex(m.ambient.ground);
    this.engine.scene.background = new THREE.Color(m.ambient.ground).multiplyScalar(0.4);
  }

  /** Parse each furniture GLB ONCE and hand back a shared template. Cloning the
   *  template shares geometry + material references, so a model costs one GPU upload
   *  no matter how many props use it. (Loading per-prop parsed a fresh copy every
   *  time — with the dense campus maps that exhausted the GPU and lost the WebGL
   *  context: 200+ duplicate geometry/texture sets.) */
  _glbTemplate(name) {
    if (!this._glbCache) this._glbCache = new Map();
    if (this._glbCache.has(name)) return this._glbCache.get(name);
    if (!this._gltf) this._gltf = new GLTFLoader();
    const pr = new Promise((resolve, reject) => {
      this._gltf.load("assets/models/" + name, (gltf) => {
        const tpl = gltf.scene;
        tpl.traverse((o) => {
          if (o.isLight && o.parent) o.parent.remove(o);       // FFG rule: strip embedded lights
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.side = THREE.FrontSide; }
        });
        tpl.updateMatrixWorld(true);
        const size = new THREE.Box3().setFromObject(tpl).getSize(new THREE.Vector3());
        resolve({ tpl, baseH: Math.max(0.05, size.y) });
      }, undefined, reject);
    });
    this._glbCache.set(name, pr);
    return pr;
  }

  /** Swap a prop's placeholder box for a clone of its GLB, scaled to the prop height
   *  and seated on the floor. The box stays as a fallback if the load fails. */
  _loadProp(p, placeholder) {
    this._glbTemplate(p.model).then(({ tpl, baseH }) => {
      if (!this._alive) return;
      const root = tpl.clone(true);                             // shares geometry + material
      root.rotation.y = p.rot || 0;
      root.scale.setScalar(p.h / baseH);                        // fit the prop's height
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      root.position.set(p.x, -box.min.y, p.z);                  // seat bottom on the floor
      root.userData.prop = p;
      this.root.add(root);
      const i = this.paintable.indexOf(placeholder); if (i >= 0) this.paintable[i] = root; else this.paintable.push(root);
      this.root.remove(placeholder);   // NOTE: don't dispose — box geo/material are shared by value
      this._collidables = null;                                 // recompute camera-collision set to include the model
    }).catch((err) => { console.warn("[chroma] GLB load failed:", p.model, err && err.message); });
  }

  _nearestPropColor(x, z) {
    let best = 0x808080, bd = Infinity;
    for (const p of this.mapDef.props) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p.color; } }
    return best;
  }

  _spawnActors() {
    const geo = makeChameleonGeo();   // shared chameleon body (one merged, UV-atlased mesh)
    for (const a of this.sim.actors) {
      let mesh;
      if (!a.isBot && a.role === ROLE.HIDER) {
        // every HUMAN hider gets a paint surface — the local one is interactive,
        // remote ones receive streamed strokes so their disguise renders too.
        const ps = new PaintSystem(this.engine, { res: a.isLocal ? 1024 : 512 });
        this.paintByActor.set(a.id, ps);
        if (a.isLocal) this.paint = ps;
        mesh = new THREE.Mesh(geo, ps.material); ps.attachBody(mesh);
        addChameleonFace(mesh);
      } else if (a.role === ROLE.HIDER) {
        const c = new THREE.Color(this._nearestPropColor(a.x, a.z)).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05 }));
        addChameleonFace(mesh);
      } else {
        // Seeker — a dark "Hunter" chameleon carrying a gun.
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: a.isLocal ? 0x2b3242 : 0x39303a, roughness: 0.55, metalness: 0.15 }));
        addChameleonFace(mesh, { seeker: true });
        const gun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.7), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.4 }));
        gun.position.set(0.5, -0.1, 0.5); mesh.add(gun); mesh.userData.gun = gun;
      }
      mesh.castShadow = true; mesh.position.set(a.x, BODY_Y, a.z);
      this.root.add(mesh); this.meshes.set(a.id, mesh);
    }
    // the local seeker's gun doubles as a flashlight — essential on dark stages
    this._flashlight = new THREE.PointLight(0xfff2d8, 0, 16, 2);
    this.root.add(this._flashlight);
    this._applyCamStart();
  }

  _applyCamStart() {
    if (this.localRole === ROLE.HIDER) { this.camYaw = Math.PI; this.thirdPerson = true; }
    else { this.thirdPerson = false; }
  }

  // ── input ──────────────────────────────────────────────────────────────────
  _setupInput() {
    const dom = this.engine.renderer.domElement;
    this._onKey = (e, down) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (down) {
        if (e.code === "KeyF" && this.localRole === ROLE.HIDER) { this._togglePaintMode(); e.preventDefault(); return; }
        if (e.code === "Digit1") { this._whistle(); }
        if (e.code === "KeyE") { this._toggleEmoteBar(); e.preventDefault(); return; }
        if (e.code === "KeyR" && this.paintMode) { /* pose cycle hook (M2.1) */ }
      }
      const map = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
      if (map[e.code]) { down ? this.keys.add(map[e.code]) : this.keys.delete(map[e.code]); }
    };
    this._kd = (e) => this._onKey(e, true); this._ku = (e) => this._onKey(e, false);
    window.addEventListener("keydown", this._kd); window.addEventListener("keyup", this._ku);

    this._pd = (e) => {
      if (window.__PAUSE__ && window.__PAUSE__.isPaused()) return;
      if (this.paintMode) { if (e.button === 0) this._painting = true; if (e.button === 1) this._orbiting = true; if (e.button === 2) this._sizing = true; this._lx = e.clientX; this._ly = e.clientY; return; }
      if (this.localRole === ROLE.SEEKER && e.button === 0 && this.sim.phase === PHASE.HUNT) { this._shootRequested = true; }
      if (e.button === 2) this.thirdPerson = !this.thirdPerson;
      this._dragging = true; this._lx = e.clientX; this._ly = e.clientY;
    };
    this._pu = () => { this._painting = this._orbiting = this._sizing = this._dragging = false; };
    this._pm = (e) => {
      const dx = e.clientX - (this._lx || e.clientX), dy = e.clientY - (this._ly || e.clientY); this._lx = e.clientX; this._ly = e.clientY;
      const s = this._sens();
      if (this.paintMode) {
        if (this._painting) this.paint.paintAtPointer();
        else if (this._orbiting) { this.camYaw += dx * 0.006 * s; this.camPitch = clamp(this.camPitch - dy * 0.006 * s, 0.15, 1.4); }
        else if (this._sizing) { this.paint.nudgeSize(dx * 0.6); this.paintPanel && this.paintPanel.refresh(); }
        return;
      }
      // drag-to-look (no pointer lock in-browser). Drag right -> turn right (was inverted).
      if (this._dragging || this.localRole === ROLE.SEEKER) { this.camYaw += dx * 0.004 * s; this.camPitch = clamp(this.camPitch - dy * 0.004 * s, -0.4, 1.2); }
    };
    this._wheel = (e) => { if (this.paintMode || this.thirdPerson) { this.camDist = clamp(this.camDist + e.deltaY * 0.006, 2.5, 12); e.preventDefault(); } };
    dom.addEventListener("pointerdown", this._pd); window.addEventListener("pointerup", this._pu);
    dom.addEventListener("pointermove", this._pm); dom.addEventListener("wheel", this._wheel, { passive: false });
  }

  _togglePaintMode() {
    if (this.local.role !== ROLE.HIDER || !this.local.alive) return;
    this.paintMode = !this.paintMode;
    if (this.paintMode) {
      // frame the body up-close so it's obvious you paint yourself
      this._savedCam = { dist: this.camDist, pitch: this.camPitch };
      this.camDist = 3.4; this.camPitch = 0.42;
      if (!this.paintPanel) { this.paintPanel = createPaintPanel(this.paint, { onEyedrop: () => { this.paint.eyedropAtPointer(this.paintable); this.paintPanel.refresh(); } }); this.engine.container.appendChild(this.paintPanel.el); }
      this.paintPanel.el.style.display = "block"; this.hud.setHint("<b>drag LMB</b> on yourself to paint · <b>Space</b> eyedrop a surface · <b>RMB‑drag</b> brush size · <b>MMB‑drag</b> rotate · <b>F</b> done");
    } else if (this.paintPanel) {
      this.paintPanel.el.style.display = "none";
      if (this._savedCam) { this.camDist = this._savedCam.dist; this.camPitch = this._savedCam.pitch; }
      this.hud.setHint(this._defaultHint());
    }
  }

  _whistle() {
    if (this.local.role !== ROLE.HIDER || !this.local.alive) return;
    this.sim.events.push({ t: "whistle", id: this.local.id, x: this.local.x, z: this.local.z });
    // give nearby seekers a nudge toward us
    for (const k of seekers(this.sim)) k._whistleTarget = { x: this.local.x, z: this.local.z };
    this.hud.toast("whistle!", "#ffd479");
  }

  _sens() { try { const v = parseFloat(localStorage.getItem("chroma_sens")); return isNaN(v) ? 1 : v; } catch (e) { return 1; } }

  _defaultHint() {
    if (this.localRole === ROLE.SEEKER) return this.sim.phase === PHASE.HUNT ? "<b>WASD</b> move · <b>drag mouse</b> to look · <b>LMB</b> shoot · <b>E</b> emote" : "Get ready — the hunt is about to begin…";
    return this.sim.phase === PHASE.PREP ? "<b>F</b> to paint yourself · <b>WASD</b> move to a hiding spot · <b>drag mouse</b> to look" : "Hold still & blend in — you whistle automatically. <b>E</b> emote";
  }

  // ── phase transitions ────────────────────────────────────────────────────────
  _onPhaseChange(from, to) {
    if (to === PHASE.ANSWER_CHECK) this._revealHiders();
    else if (to === PHASE.HUNT) {
      // Double/Reverse decide/flip the local role at hunt start.
      if (this.local && this.local.role !== this.localRole) {
        this.localRole = this.local.role;
        if (this.paintMode) this._togglePaintMode();
        this.thirdPerson = this.localRole === ROLE.HIDER;
        this.hud.setRole(this.localRole);
        this.hud.toast(this.localRole === ROLE.SEEKER ? "You're a SEEKER!" : "You're hiding!", this.localRole === ROLE.SEEKER ? "#ff9d6b" : ACCENT_G);
      }
      this.hud.setHint(this._defaultHint());
    }
  }

  /** Answer Check: reveal every hider's spot; survivors (the "missed spots") glow. */
  _revealHiders() {
    const survivors = this.sim.actors.filter((a) => a.role === ROLE.HIDER && a.alive).length;
    this.hud.setPhase("ANSWER CHECK");
    this.hud.toast(survivors > 0 ? `${survivors} hider${survivors === 1 ? "" : "s"} survived!` : "All hiders found!", survivors > 0 ? ACCENT_G : "#ff9d6b");
    for (const a of this.sim.actors) {
      if (a.role !== ROLE.HIDER) continue;
      const mesh = this.meshes.get(a.id); if (!mesh) continue;
      mesh.visible = true;
      if (mesh.material) {
        mesh.material.transparent = a.caught;
        mesh.material.opacity = a.caught ? 0.55 : 1.0;
        if (mesh.material.emissive) { mesh.material.emissive.setHex(a.alive ? 0x1f6f4f : 0x000000); mesh.material.emissiveIntensity = a.alive ? 0.6 : 0; }
      }
      // survivors get a beacon ring
      if (a.alive && !mesh.userData._beacon) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 24), new THREE.MeshBasicMaterial({ color: 0x7fe3c4, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; mesh.add(ring); mesh.userData._beacon = ring;
      }
    }
  }

  // ── emotes (radial bar; E to open) ───────────────────────────────────────────
  _buildEmoteBar() {
    const EMOJIS = ["👋", "😂", "😮", "🎨", "🔥", "💀", "❤️", "👀"];
    const bar = document.createElement("div");
    bar.style.cssText = "position:absolute;bottom:56px;left:50%;transform:translateX(-50%);z-index:35;display:none;gap:6px;padding:8px 10px;border-radius:14px;background:rgba(12,16,24,.85);backdrop-filter:blur(8px);pointer-events:auto";
    for (const em of EMOJIS) {
      const b = document.createElement("button");
      b.textContent = em; b.style.cssText = "font-size:24px;width:44px;height:44px;border:none;border-radius:9px;background:rgba(255,255,255,.08);cursor:pointer;transition:transform .1s";
      b.onmouseenter = () => b.style.transform = "scale(1.15)"; b.onmouseleave = () => b.style.transform = "";
      b.onclick = () => { this._emote(em); this._toggleEmoteBar(false); };
      bar.appendChild(b);
    }
    this.engine.container.appendChild(bar); this._emoteBar = bar;
  }
  _toggleEmoteBar(on) { if (this._emoteBar) this._emoteBar.style.display = (on == null ? this._emoteBar.style.display === "none" : on) ? "flex" : "none"; }
  _emote(emoji) {
    if (!this.local) return;
    this.floatEmote(this.local.id, emoji);
    if (this.online && this.net) this.net.sendEvent({ t: "emote", id: this.local.id, emoji });
  }
  floatEmote(actorId, emoji) {
    const mesh = this.meshes.get(actorId); if (!mesh) return;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"); g.font = "96px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(emoji, 64, 74);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    spr.scale.set(1, 1, 1); spr.position.set(mesh.position.x, mesh.position.y + 2.1, mesh.position.z);
    this.root.add(spr); (this._emotes = this._emotes || []).push({ spr, actorId, ttl: 1.7, t: 0 });
  }
  _updateEmotes(dt) {
    if (!this._emotes || !this._emotes.length) return;
    for (let i = this._emotes.length - 1; i >= 0; i--) {
      const e = this._emotes[i]; e.t += dt; e.ttl -= dt;
      const mesh = this.meshes.get(e.actorId);
      if (mesh) { e.spr.position.set(mesh.position.x, mesh.position.y + 2.1 + e.t * 0.5, mesh.position.z); }
      e.spr.material.opacity = Math.min(1, e.ttl * 2.5);
      if (e.ttl <= 0) { this.root.remove(e.spr); e.spr.material.map.dispose(); e.spr.material.dispose(); this._emotes.splice(i, 1); }
    }
  }

  _computeLocalInput() {
    let mx = 0, mz = 0;
    const seekerLocked = this.localRole === ROLE.SEEKER && this.sim.phase === PHASE.PREP;
    if (!this.paintMode && !seekerLocked && this.local && this.local.alive) {
      const f = (this.keys.has("f") ? 1 : 0) - (this.keys.has("b") ? 1 : 0);
      const r = (this.keys.has("r") ? 1 : 0) - (this.keys.has("l") ? 1 : 0);
      mx = Math.sin(this.camYaw) * f + Math.cos(this.camYaw) * r;
      mz = Math.cos(this.camYaw) * f - Math.sin(this.camYaw) * r;
    }
    this._moving = (mx !== 0 || mz !== 0);
    return { mx, mz, yaw: this.camYaw, shoot: !!this._shootRequested };
  }

  // ── per-frame ───────────────────────────────────────────────────────────────
  _update(dt) {
    if (!this._alive) return;
    if (window.__PAUSE__ && window.__PAUSE__.isPaused()) return;
    dt = Math.min(dt, 0.05);

    if (!this.online) this._stepOffline(dt);
    else if (this.isHost) this._stepHost(dt);
    else this._stepGuest(dt);

    if (this.sim.phase !== this._lastPhase) { this._onPhaseChange(this._lastPhase, this.sim.phase); this._lastPhase = this.sim.phase; }
    if (this._moving && this.local && this.local.alive && this.sim.phase !== PHASE.RESULTS) this.audio.footstep();
    this._syncActors();
    this._updateEmotes(dt);
    this._updateCamera(dt);
    this._updateHUD();
    if (this.sim.phase === PHASE.RESULTS && !this._ended) { this._ended = true; this._finish(); }
  }

  _stepOffline(dt) {
    if (this.local && this.local.alive) setLocalInput(this.sim, this.local.id, this._computeLocalInput());
    this._shootRequested = false;
    this._handleEvents(stepMatch(this.sim, dt));
  }

  _stepHost(dt) {
    // local + every remote human's input feed the authoritative sim
    if (this.local && this.local.alive) setLocalInput(this.sim, this.local.id, this._computeLocalInput());
    this._shootRequested = false;
    for (const a of this.sim.actors) {
      if (a.isBot || a.isLocal) continue;
      const inp = this.net.takeInput(a.id); if (inp) setLocalInput(this.sim, a.id, { mx: inp.mx, mz: inp.mz, yaw: inp.yaw });
    }
    for (const from of this._pendingShots) setLocalInput(this.sim, from, { shoot: true });
    this._pendingShots.length = 0;

    const events = stepMatch(this.sim, dt);
    this._handleEvents(events);
    for (const e of events) if (e.t === "caught" || e.t === "whistle" || e.t === "win" || e.t === "phase" || e.t === "convert") this.net.sendEvent(e);

    this._snapAccum += dt;
    if (this._snapAccum >= 0.1) { this._snapAccum = 0; this.net.sendSnapshot(this.sim); }
    this._streamPaint();
  }

  _stepGuest(dt) {
    // send my intent to the host; shooting goes as a discrete SHOT
    const inp = this._computeLocalInput();
    this.net.sendInput({ mx: inp.mx, mz: inp.mz, yaw: inp.yaw });
    if (this._shootRequested) { this.net.sendShot(); this._shootRequested = false; }
    // Keep interpolating toward the LATEST snapshot every frame (entity
    // interpolation) — don't discard it, so the guest still converges smoothly
    // when snapshots briefly pause between the host's 10 Hz broadcasts.
    if (this._lastSnap) this._applySnapshot(this._lastSnap);
    this._streamPaint();
  }

  _applySnapshot(snap) {
    this.sim.phase = snap.phase; this.sim.timeLeft = snap.timeLeft;
    for (const ua of snap.actors) {
      const a = this.sim.actors[ua.idx]; if (!a) continue;
      if (a.isLocal) { // trust host for role/alive/ammo/score but keep our own smooth position feel
        a.alive = ua.alive; a.caught = ua.caught; a.role = ua.role; a.ammo = ua.ammo; a.score = ua.score;
        a.x += (ua.x - a.x) * 0.35; a.z += (ua.z - a.z) * 0.35;
      } else {
        a.x += (ua.x - a.x) * 0.5; a.z += (ua.z - a.z) * 0.5; a.yaw = ua.yaw; a.pose = ua.pose;
        a.alive = ua.alive; a.caught = ua.caught; a.hidden = ua.hidden; a.role = ua.role; a.ammo = ua.ammo; a.score = ua.score;
      }
    }
  }

  _applyNetEvent(ev) {
    if (ev.t === "win") { this.sim.result = { winner: ev.winner, reason: ev.reason }; }
    else if (ev.t === "phase" && ev.phase === PHASE.HUNT) { this.hud.toast("HUNT!", "#ff6b6b"); if (this.paintMode) this._togglePaintMode(); }
    else if (ev.t === "caught") { this.audio.gunshot(); this.audio.catchSound(); if (ev.id === this.local?.id) this.hud.toast("Caught!", "#ff6b6b"); }
    else if (ev.t === "miss") this.audio.gunshot();
    else if (ev.t === "emote") this.floatEmote(ev.id, ev.emoji);
    else if (ev.t === "whistle") this.audio.whistle();
  }

  _streamPaint() {
    if (!this.paint || this.local.role !== ROLE.HIDER) return;
    this._paintThrottle++;
    const total = this.paint.strokes.length;
    if (total > this._paintSent && this._paintThrottle >= 6) {
      this._paintThrottle = 0;
      this.net.sendStrokes(this.local.id, this.paint.strokes.slice(this._paintSent));
      this._paintSent = total;
    }
  }

  _wireNet() {
    this.net.on("snapshot", (s) => { this._lastSnap = s; });
    this.net.on("paint", ({ id, strokes }) => { if (id !== this.local?.id) { const ps = this.paintByActor.get(id); if (ps) ps.applyStrokes(strokes); } });
    this.net.on("event", (ev) => this._applyNetEvent(ev));
    if (this.isHost) {
      this.net.on("shot", ({ from }) => { this._pendingShots.push(from); });
      // inputs are pooled inside chromanet (net.takeInput); nothing to do here
    }
  }

  _handleEvents(events) {
    for (const e of events) {
      if (e.t === "phase" && e.phase === PHASE.HUNT) { this.hud.toast("HUNT!", "#ff6b6b"); if (this.paintMode) this._togglePaintMode(); this.hud.setHint(this._defaultHint()); }
      else if (e.t === "caught") {
        this.audio.gunshot(); this.audio.catchSound();
        if (e.id === this.local?.id) this.hud.toast("Caught!", "#ff6b6b");
        else if (e.by === this.local?.id) this.hud.toast("Got one!", ACCENT_G);
      } else if (e.t === "miss") { this.audio.gunshot(); if (e.by === this.local?.id) { this.hud.toast("miss", "#ff9d6b"); this._muzzle = 0.08; } }
      else if (e.t === "whistle") { this.audio.whistle(); }
      else if (e.t === "win") { /* handled by phase RESULTS */ }
    }
  }

  _syncActors() {
    for (const a of this.sim.actors) {
      const mesh = this.meshes.get(a.id); if (!mesh) continue;
      mesh.position.x = a.x; mesh.position.z = a.z;
      // pose
      let sy = 1, py = BODY_Y, rot = 0;
      if (a.role === ROLE.HIDER && a.hidden) {
        if (a.pose === "crouch") { sy = 0.62; py = BODY_Y * 0.7; }
        else if (a.pose === "ball") { sy = 0.75; py = BODY_R + 0.1; }
        else if (a.pose === "lie") { rot = Math.PI / 2; py = BODY_R + 0.05; }
      }
      mesh.scale.y = sy; mesh.position.y = py; mesh.rotation.set(rot, a.yaw, 0);
      if (a.caught && a.role === ROLE.HIDER) { mesh.material.transparent = true; mesh.material.opacity = 0.35; }
      // infection: a converted hider now renders like a seeker (tint)
      if (a.role === ROLE.SEEKER && a._wasHider !== true && a.caught === false && a.isBot && a._converted) { }
    }
    // muzzle flash cooldown
    if (this._muzzle > 0) this._muzzle -= 0.016;
  }

  _updateCamera(dt) {
    const cam = this.engine.camera; if (!this.local) return;
    const bx = this.local.x, by = BODY_Y, bz = this.local.z;
    if (this.localRole === ROLE.SEEKER && !this.thirdPerson && this.sim.phase !== PHASE.RESULTS) {
      // first-person
      cam.position.set(bx, by + 0.55, bz);
      const fx = Math.sin(this.camYaw) * Math.cos(this.camPitch), fy = Math.sin(this.camPitch), fz = Math.cos(this.camYaw) * Math.cos(this.camPitch);
      cam.lookAt(bx + fx, by + 0.55 + fy, bz + fz);
      const gun = this.meshes.get(this.local.id); if (gun) gun.visible = false;
    } else {
      // third-person / paint-orbit follow, WITH camera collision so walls never
      // clip the view (the D-grade "void" bug: hiding near a wall put the camera
      // behind it). Raycast body->desired-camera; pull the camera in on a hit.
      const cp = Math.cos(this.camPitch), d = this.camDist;
      const tx = bx, ty = by + 0.55, tz = bz;
      let camx = bx - Math.sin(this.camYaw) * d * cp;
      let camy = by + 0.7 + d * Math.sin(this.camPitch);
      let camz = bz - Math.cos(this.camYaw) * d * cp;
      // WALLS ONLY. Colliding the camera with furniture is unusable on prop-dense
      // maps — any cluster between body and camera pulled it in and the lift flipped
      // it to a top-down view. Walls still block (that's the original void-bug fix);
      // clutter may briefly occlude, which is normal third-person behaviour.
      const cols = this._collidables || (this._collidables = this.paintable.filter(
        (mm) => mm !== this.floor && !(mm.userData && mm.userData.prop)));
      const dir = new THREE.Vector3(camx - tx, camy - ty, camz - tz);
      const want = dir.length(); dir.normalize();
      const hit = this.engine.raycast(new THREE.Vector3(tx, ty, tz), dir, cols, want)[0];
      let dd = want;
      if (hit) dd = Math.max(0.5, hit.distance - 0.3);   // never sit past/inside the wall
      camx = tx + dir.x * dd; camy = ty + dir.y * dd; camz = tz + dir.z * dd;
      // when jammed close to a wall there's no room behind — lift up and look down so the body stays clear
      if (dd < 1.5) camy = Math.max(camy, ty + (1.5 - dd) * 0.75);   // softer lift — only when genuinely flush
      cam.position.set(camx, Math.max(0.5, camy), camz);
      cam.lookAt(tx, by + 0.4, tz);
      const me = this.meshes.get(this.local.id); if (me) me.visible = true;
    }
    if (this._flashlight) {
      const on = this.localRole === ROLE.SEEKER && this.sim.phase === PHASE.HUNT;
      this._flashlight.intensity = on ? 22 : 0;
      if (on) this._flashlight.position.set(bx + Math.sin(this.camYaw) * 1.5, by + 0.6, bz + Math.cos(this.camYaw) * 1.5);
    }
  }

  _updateHUD() {
    this.hud.setTimer(this.sim.timeLeft);
    this.hud.setPhase(this.sim.phase === PHASE.PREP ? "PREP · paint & hide" : this.sim.phase === PHASE.HUNT ? "HUNT" : this.sim.phase === PHASE.ANSWER_CHECK ? "REVEAL" : "");
    if (this.local) {
      if (this.local.role === ROLE.SEEKER) { this.hud.setAmmo(this.local.ammo, this.settings.startAmmo); this.hud.showCrosshair(!this.thirdPerson && this.sim.phase === PHASE.HUNT); }
      else { this.hud.setScore(this.local.score); this.hud.showCrosshair(false); }
    }
  }

  _finish() {
    const res = this.sim.result || { winner: this.sim.actors.some((a) => a.role === ROLE.HIDER && a.alive) ? "hiders" : "seekers", reason: "time_survived" };
    const scores = this.sim.actors.map((a) => ({ name: this._names[a.id] || a.id, role: a.role, score: a.score, caught: a.caught, isLocal: a.isLocal }));
    this.hud.hide();
    if (this.cb.onEnd) this.cb.onEnd({ winner: res.winner, reason: res.reason, scores });
  }

  // ── test hooks (headless/backgrounded verification) ─────────────────────────
  testAPI() {
    return {
      sim: this.sim, local: this.local,
      phase: () => this.sim.phase, timeLeft: () => this.sim.timeLeft, result: () => this.sim.result,
      moveLocal: (mx, mz) => this.local && setLocalInput(this.sim, this.local.id, { mx, mz, yaw: this.camYaw }),
      enterPaint: () => { if (!this.paintMode) this._togglePaintMode(); }, exitPaint: () => { if (this.paintMode) this._togglePaintMode(); },
      paint: () => this.paint, shoot: () => { this._shootRequested = true; },
      fastForward: (secs, dt = 1 / 30) => { let t = 0; while (t < secs && this.sim.phase !== PHASE.RESULTS) { this._update(dt); t += dt; } return this.sim.phase; },
    };
  }

  destroy() {
    this._alive = false;
    if (this.audio) { try { this.audio.stopMusic(); } catch (e) {} }
    if (this.online && this.net) { try { this.net.leave(); } catch (e) {} }
    if (this._unsub) this._unsub();
    window.removeEventListener("keydown", this._kd); window.removeEventListener("keyup", this._ku);
    const dom = this.engine.renderer.domElement;
    dom.removeEventListener("pointerdown", this._pd); dom.removeEventListener("pointermove", this._pm); dom.removeEventListener("wheel", this._wheel);
    window.removeEventListener("pointerup", this._pu);
    if (this.paintPanel && this.paintPanel.el.parentNode) this.paintPanel.el.parentNode.removeChild(this.paintPanel.el);
    if (this._emoteBar && this._emoteBar.parentNode) this._emoteBar.parentNode.removeChild(this._emoteBar);
    this.engine.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => m.dispose && m.dispose()); } });
  }
}

const ACCENT_G = "#7fe3c4";
