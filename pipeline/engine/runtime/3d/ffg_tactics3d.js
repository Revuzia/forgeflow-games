/**
 * FFG runtime — 3d/ffg_tactics3d.js  (ES module)
 * 3D ISOMETRIC tactical renderer (XCOM-style) on the ffg_kernel_3d substrate.
 * Consumes the SAME tactics mission content (grid + player_units + enemy_units)
 * as the 2D renderer, but draws it as a lit 3D scene with an angled, rotatable
 * camera — the presentation the 2D top-down grid couldn't deliver.
 *
 * Phase 1 (this file): 3D board (floor / walls / cover / hazard), 3D soldier
 * units, iso camera (right-drag rotate, WASD pan, scroll zoom), select → move →
 * fire against the shared tactical_grid sim, DOM HUD, win/lose. Deeper XCOM
 * systems (overwatch, flanking crit, classes/abilities) layer onto the sim next.
 */
import * as THREE from "three";
// Resolve from the SAME (version-matched) URLs the boot used — a bare import is a
// different kernel instance (empty genre registry) and a cache-stale sim.
const _V = new URL(import.meta.url).search;
await import("../sim/tactical_grid.js" + _V); // sets window.FFG.sim.TacticalBattle
const { register3d } = await import("./ffg_kernel_3d.js" + _V);

const T = 2.4;            // world units per tile
const TILE_TINT = { 0: 0x1b2738, 1: 0x39506b, 2: 0x6b5a30, 3: 0x877046, 4: 0x401818 };

function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= (1 + f); g *= (1 + f); b *= (1 + f); }
  const c = (v) => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

register3d("tactics3d", async (kernel, content) => {
  const scene = kernel.scene;
  const TB = window.FFG.sim.TacticalBattle;
  const missions = (content.missions && content.missions.length) ? content.missions : [content];
  let missionIndex = Math.max(0, Math.min((window.__FFG_TACTICS_MISSION__ | 0), missions.length - 1));
  let mission = missions[missionIndex];

  const gridH = mission.grid.length, gridW = mission.grid[0].length;
  const W = gridW * T, H = gridH * T;
  // world position of a tile centre (board centred on origin; +z = "south")
  const cell = (x, y) => new THREE.Vector3((x + 0.5) * T - W / 2, 0, (y + 0.5) * T - H / 2);

  scene.background = new THREE.Color(0x0b1420);
  scene.fog = new THREE.FogExp2(0x0b1420, 0.008);
  // Cinematic facility lighting: a warm key from one side, a cool fill from the
  // other, + a soft top light — far less flat/dark than the bare kernel rig.
  const key = new THREE.DirectionalLight(0xfff0d8, 1.25); key.position.set(40, 60, 25); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -60; key.shadow.camera.right = 60; key.shadow.camera.top = 60; key.shadow.camera.bottom = -60; key.shadow.camera.far = 220;
  scene.add(key);
  scene.add(new THREE.DirectionalLight(0x4f78c8, 0.55).translateX(-40).translateY(35).translateZ(-25));
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x0a0f18, 0.55));
  // HDR bloom over the emissive sci-fi elements (grid seams, cover trim, hazard,
  // tracers, unit accents) — a big step toward a polished, lit XCOM look.
  kernel.renderer.toneMapping = THREE.ACESFilmicToneMapping; kernel.renderer.toneMappingExposure = 1.0;
  if (kernel.enableBloom) kernel.enableBloom({ strength: 0.7, radius: 0.6, threshold: 0.8 });

  let sim, events = [], busy = false, selected = null, phase = "menu";
  const unitViews = {}; // id -> { group, ring, hpFill, base }
  let highlights = [], rangeTargets = [];

  function buildSim() {
    events = [];
    sim = new TB({
      grid: mission.grid, player_units: mission.player_units, enemy_units: mission.enemy_units,
      seed: content.seed != null ? content.seed : 12345,
      onEvent: (type, payload) => events.push({ type, payload }),
    });
  }

  // ── Board ─────────────────────────────────────────────────────────────────
  const floorTargets = []; // interactive tile meshes for raycasting
  async function buildBoard() {
    // Real textured sci-fi floor panels (modular-space-kit GLB) instead of plain
    // boxes — a genuine facility floor. Walls/cover/hazard stay procedural.
    const SK = new URL("./spacekit/", import.meta.url).href;
    let floorProto = null, floorScale = 1, floorTop = 0.18;
    try {
      floorProto = await kernel.loadGLTF(SK + "template-floor.glb");
      const bb = new THREE.Box3().setFromObject(floorProto); const d = bb.getSize(new THREE.Vector3());
      floorScale = (T * 0.99) / (Math.max(d.x, d.z) || 1);
      floorTop = (d.y || 0.2) * floorScale; // panel thickness after scaling
    } catch (e) { floorProto = null; }

    const plat = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.6, H + 1.4),
      new THREE.MeshStandardMaterial({ color: 0x0c1626, roughness: 0.9, metalness: 0.2 }));
    plat.position.set(0, -0.35, 0); plat.receiveShadow = true; scene.add(plat);

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const t = mission.grid[y][x];
        const w = cell(x, y);
        if (t === 1) { // WALL — tall steel block with a cyan tech seam, blocks move + LOS
          const m = new THREE.Mesh(new THREE.BoxGeometry(T * 0.98, T * 1.2, T * 0.98),
            new THREE.MeshStandardMaterial({ color: 0x39506b, roughness: 0.55, metalness: 0.55 }));
          m.position.set(w.x, T * 0.55, w.z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
          const seam = new THREE.Mesh(new THREE.BoxGeometry(T * 1.0, 0.06, T * 1.0),
            new THREE.MeshBasicMaterial({ color: 0x4fd0ff }));
          seam.position.set(w.x, T * 1.15, w.z); scene.add(seam);
          continue;
        }
        // FLOOR — textured GLB panel (fallback: a lit tech box).
        if (floorProto) {
          const f = floorProto.clone(true); f.scale.setScalar(floorScale);
          f.position.set(w.x, 0, w.z); f.traverse((o) => { if (o.isMesh) o.receiveShadow = true; }); scene.add(f);
        } else {
          const checker = (x + y) % 2 === 0 ? 0x223044 : 0x1a2636;
          const tile = new THREE.Mesh(new THREE.BoxGeometry(T * 0.97, 0.3, T * 0.97),
            new THREE.MeshStandardMaterial({ color: checker, roughness: 0.6, metalness: 0.5 }));
          tile.position.set(w.x, 0.02, w.z); tile.receiveShadow = true; scene.add(tile);
        }
        const edge = new THREE.Mesh(new THREE.RingGeometry(T * 0.46, T * 0.485, 4),
          new THREE.MeshBasicMaterial({ color: 0x2f6c8f, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        edge.rotation.x = -Math.PI / 2; edge.rotation.z = Math.PI / 4; edge.position.set(w.x, floorTop + 0.02, w.z); scene.add(edge);
        // interactive overlay
        const hit = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.96, T * 0.96),
          new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
        hit.rotation.x = -Math.PI / 2; hit.position.set(w.x, floorTop + 0.03, w.z); hit.userData = { x, y };
        scene.add(hit); floorTargets.push(hit);

        if (t === 2 || t === 3) buildCover(w, t === 3);
        else if (t === 4) buildHazard(w);
      }
    }
  }
  function buildCover(w, full) {
    // Sci-fi crate/barricade: dark metal body, beveled lit cap + an emissive trim
    // line (amber=full cover, cyan=half) so cover reads at a glance.
    const s = full ? T * 0.74 : T * 0.6, h = full ? T * 1.0 : T * 0.52;
    const base = full ? 0x3a4658 : 0x33414f, trim = full ? 0xffae5a : 0x5fd0ff;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s),
      new THREE.MeshStandardMaterial({ color: base, roughness: 0.5, metalness: 0.6 }));
    m.position.set(w.x, h / 2 + 0.05, w.z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(s * 1.04, h * 0.14, s * 1.04),
      new THREE.MeshStandardMaterial({ color: shade(base, 0.35), roughness: 0.4, metalness: 0.7 }));
    cap.position.set(w.x, h + 0.05, w.z); cap.castShadow = true; scene.add(cap);
    const trimBand = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, h * 0.08, s * 1.02),
      new THREE.MeshBasicMaterial({ color: trim }));
    trimBand.position.set(w.x, h * 0.62 + 0.05, w.z); scene.add(trimBand);
  }
  function buildHazard(w) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(T * 0.96, 0.32, T * 0.96),
      new THREE.MeshStandardMaterial({ color: 0x2a0f0f, emissive: 0xff4010, emissiveIntensity: 0.35, roughness: 0.8 }));
    tile.position.set(w.x, 0.04, w.z); scene.add(tile);
    let tt = Math.random() * 6;
    kernel.onUpdate((dt) => { tt += dt; tile.material.emissiveIntensity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(tt * 3)); });
  }

  // ── Units (REAL rigged + animated characters) ───────────────────────────────
  // Players = an animated soldier; enemies = an animated combat robot, tinted +
  // scaled per class so they read as distinct, escalating threats.
  const SOLDIER_URL = new URL("./characters/soldier.glb", import.meta.url).href;
  const ROBOT_URL = new URL("./characters/robot.glb", import.meta.url).href;
  const CLIPS = { // map our intents to each model's clip names
    soldier: { idle: "Idle", walk: "Walk", run: "Run", die: null, attack: null },
    robot: { idle: "Idle", walk: "Walking", run: "Running", die: "Death", attack: "Punch" },
  };
  // enemy class -> { tint, scale } for visual variety + escalation
  function enemyStyle(u) {
    const s = ((u.sprite || "") + " " + (u.name || "")).toLowerCase();
    if (/sniper|marksman/.test(s)) return { tint: 0xb86bff, scale: 0.95 };   // purple sniper-bot
    if (/defender|heavy|mech|tank|brute|elite/.test(s)) return { tint: 0xff5a3c, scale: 1.25 }; // big red heavy
    if (/drone|assault/.test(s)) return { tint: 0xff9a3c, scale: 0.9 };       // orange drone
    return { tint: 0xff6a5a, scale: 1.0 };
  }
  function unitColor(u) { return u.tint != null ? new THREE.Color(u.tint).getHex() : (u.side === "player" ? 0x3aa0ff : 0xff5a4a); }

  async function makeUnit(u) {
    const w = cell(u.x, u.y);
    const g = new THREE.Group(); g.position.set(w.x, 0.2, w.z);
    const col = unitColor(u), dark = shade(col, -0.5);
    // faction base ring (selection + team id)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.36, T * 0.36, 0.1, 26),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.5 }));
    ring.position.y = 0.06; g.add(ring);

    const isPlayer = u.side === "player";
    const url = isPlayer ? SOLDIER_URL : ROBOT_URL;
    const clips = isPlayer ? CLIPS.soldier : CLIPS.robot;
    let char = null;
    try { char = await kernel.loadCharacter(url); } catch (e) { char = null; }
    if (char) {
      const mdl = char.scene;
      g.add(mdl);
      // Skinned-mesh clones carry stale bounding volumes -> the renderer culls
      // them even when on-screen (and Box3.setFromObject mis-measures them). Use
      // the models' KNOWN native heights (feet at origin) for a correct scale.
      mdl.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
      const NATIVE_H = isPlayer ? 1.82 : 4.38; // measured: Soldier.glb / RobotExpressive.glb
      const targetH = T * (isPlayer ? 1.45 : 1.05) * (isPlayer ? 1 : enemyStyle(u).scale);
      mdl.scale.setScalar(targetH / NATIVE_H);
      mdl.position.y = 0.05; // model origin is at the feet -> sit on the base ring
      // enemy class tint; players get a faint team-coloured emissive so the dark
      // camo soldier reads against the dark board.
      const accent = isPlayer ? col : enemyStyle(u).tint;
      mdl.traverse((o) => {
        if ((o.isMesh || o.isSkinnedMesh) && o.material) {
          o.material = o.material.clone();
          if (!isPlayer && o.material.color) o.material.color.lerp(new THREE.Color(accent), 0.6);
          o.material.emissive = new THREE.Color(accent).multiplyScalar(isPlayer ? 0.22 : 0.18);
        }
      });
      char.play(clips.idle, { fade: 0 });
    } else {
      // fallback: simple capsule so the unit still exists if the GLB fails
      const body = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.16, T * 0.22, T * 0.8, 10), new THREE.MeshStandardMaterial({ color: col }));
      body.position.y = T * 0.5; g.add(body);
    }
    // HP bar (billboard)
    const hpY = T * 1.7;
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.62, 0.16), new THREE.MeshBasicMaterial({ color: 0x0a0f17 }));
    const hpFill = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.58, 0.1), new THREE.MeshBasicMaterial({ color: 0x3ddc84 }));
    hpBg.position.set(0, hpY, 0); hpFill.position.set(0, hpY, 0.01);
    g.add(hpBg); g.add(hpFill);
    // Cover-shield badge (the iconic XCOM read): solid = full cover, half = half.
    const cover = makeShieldSprite(); cover.position.set(0, hpY + 0.55, 0); cover.visible = false; g.add(cover);
    scene.add(g);
    kernel.onUpdate(() => { hpBg.quaternion.copy(kernel.camera.quaternion); hpFill.quaternion.copy(kernel.camera.quaternion); cover.quaternion.copy(kernel.camera.quaternion); });
    unitViews[u.id] = { group: g, ring, hpFill, cover, base: col, dark, hpW: T * 0.58, char, clips, dead: false };
    faceUnit(u, isPlayer ? -1 : 1); // players look "north" toward the enemy, enemies "south"
    updateCover(u);
  }
  // Show each unit's best available cover as an XCOM-style shield over its head.
  function updateCover(u) {
    const v = unitViews[u.id]; if (!v || !v.cover) return;
    if (u.hp <= 0) { v.cover.visible = false; return; }
    const cov = sim.coverAt(u); // 0 none / 1 half / 2 full (best adjacent)
    if (cov === 0) { v.cover.visible = false; return; }
    v.cover.visible = true; v.cover.material.map = shieldTex(cov === 2); v.cover.material.needsUpdate = true;
  }
  function refreshAllCover() { sim.allUnits().forEach((u) => { if (u.hp > 0) updateCover(u); }); }
  function faceUnit(u, dir) { const v = unitViews[u.id]; if (v && v.char) v.char.scene.rotation.y = dir > 0 ? 0 : Math.PI; }
  function faceToward(u, tx, ty) {
    const v = unitViews[u.id]; if (!v || !v.char) return;
    const a = Math.atan2(tx - u.x, ty - u.y); // grid +z is "down"; model faces +z at rot 0
    v.char.scene.rotation.y = a;
  }
  function anim(u, intent, opts) { const v = unitViews[u.id]; if (v && v.char && v.clips[intent]) v.char.play(v.clips[intent], opts); }
  function refreshUnit(u) {
    const v = unitViews[u.id]; if (!v) return;
    if (u.hp <= 0) { killUnit(u); return; }
    const pct = Math.max(0, u.hp / u.maxHp);
    v.hpFill.scale.x = Math.max(0.001, pct);
    v.hpFill.position.x = -(v.hpW * (1 - pct)) / 2;
    v.hpFill.material.color.setHex(pct > 0.5 ? 0x3ddc84 : pct > 0.25 ? 0xf5c518 : 0xff5a5a);
    updateCover(u);
  }
  function killUnit(u) {
    const v = unitViews[u.id]; if (!v || v.dead) return; v.dead = true;
    v.hpFill.visible = false;
    if (v.char && v.clips.die) { v.char.play(v.clips.die, { once: true, fade: 0.15 }); kernel.tween({ target: v.group.position, to: { y: v.group.position.y }, duration: 1.0, onComplete: () => fadeOut(v) }); }
    else { kernel.tween({ target: v.group.rotation, to: { z: Math.PI / 2 }, duration: 0.5 }); kernel.tween({ target: v.group.position, to: { y: -0.4 }, duration: 0.8, onComplete: () => fadeOut(v) }); }
  }
  function fadeOut(v) { setTimeout(() => { v.group.visible = false; }, 700); }

  // ── Camera (iso, rotatable) ─────────────────────────────────────────────────
  const span = Math.max(W, H);
  kernel.camera.fov = 38; kernel.camera.updateProjectionMatrix();
  kernel.camera.position.set(span * 0.9, span * 1.0, span * 0.9);
  const orbit = kernel.enableOrbit({
    target: { x: 0, y: 0, z: 0 },
    minDistance: span * 0.5, maxDistance: span * 2.4,
    minPolarAngle: 0.25, maxPolarAngle: Math.PI * 0.46,
    rotateButton: "right", wasdPan: true, panSpeed: span * 0.9,
    autoRotate: true, autoRotateSpeed: 0.4,
  });

  // ── Highlights + selection ──────────────────────────────────────────────────
  function clearHighlights() { highlights.forEach((h) => scene.remove(h)); highlights = []; rangeTargets = []; }
  function selectUnit(u) {
    if (!u || u.side !== "player" || u.hp <= 0) return;
    selected = u; clearHighlights();
    const v = unitViews[u.id]; if (v) v.ring.material.emissiveIntensity = 1.0;
    (sim.reachableTiles(u) || []).forEach((r) => {
      const w = cell(r.x, r.y);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.84, T * 0.84),
        new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: u.actionPoints > 0 ? 0.22 : 0.08, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(w.x, 0.24, w.z); scene.add(m); highlights.push(m);
    });
    setHUD();
  }
  function deselect() {
    if (selected) { const v = unitViews[selected.id]; if (v) v.ring.material.emissiveIntensity = 0.35; }
    selected = null; clearHighlights(); setHUD();
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────
  function setHUD(msg) {
    const me = sim.aliveAllies().length, foe = sim.aliveEnemies().length;
    const ph = sim.currentPhase === "player";
    const banner = msg || (ph ? "Your phase — select a soldier" : "Enemy phase…");
    const bc = ph ? "#7CFC9A" : "#ffb454";
    const sel = selected ? `<div style="margin-top:6px;background:rgba(8,18,32,.7);border-left:3px solid ${"#" + unitViews[selected.id].base.toString(16).padStart(6, "0")};padding:5px 12px;border-radius:4px;font-size:12px">
        <b>${selected.name}</b> &nbsp; HP ${selected.hp}/${selected.maxHp} &nbsp; AP ${selected.actionPoints}/${selected.maxAP} &nbsp; AIM ${Math.round(selected.aim * 100)}%</div>` : "";
    kernel.hud(`
      <div style="position:absolute;top:12px;left:14px;font-family:'Segoe UI',system-ui,monospace">
        <div style="font-size:19px;font-weight:800;letter-spacing:2px;text-shadow:0 2px 10px #000">${content.title || "Operation"}</div>
        <div style="margin-top:6px;display:inline-block;background:rgba(8,18,32,.72);border:1px solid ${bc}55;border-left:3px solid ${bc};border-radius:4px;padding:5px 13px;font-size:13px">
          ${missions.length > 1 ? `<span style="opacity:.7">Mission ${missionIndex + 1}/${missions.length}</span> · ` : ""}<span style="opacity:.7">Turn ${sim.turnNumber}</span> · <span style="color:${bc};font-weight:700">${banner}</span>
        </div>${sel}
      </div>
      <div style="position:absolute;top:12px;right:14px;font-family:'Segoe UI',monospace;background:rgba(8,18,32,.62);border:1px solid #2a4458;border-radius:9px;padding:9px 13px;text-align:right;font-size:12px">
        <div style="color:#7CFC9A">SQUAD ${me}</div><div style="color:#ff7a6a;margin-top:3px">HOSTILES ${foe}</div>
        <div style="font-size:11px;opacity:.6;margin-top:5px">Objective: ${mission.objective || "Eliminate all hostiles"}</div>
      </div>
      <div style="position:absolute;bottom:10px;left:14px;font-size:11px;opacity:.55;font-family:monospace">Click soldier → move/shoot · Right-drag: rotate · WASD: move · Esc: pause</div>
    `);
    renderEndBtn(ph);
  }
  let endBtnEl = null, owBtnEl = null;
  function renderEndBtn(show) {
    if (!endBtnEl) {
      endBtnEl = document.createElement("button");
      Object.assign(endBtnEl.style, { position: "absolute", right: "16px", bottom: "16px", zIndex: "50", font: "bold 13px 'Segoe UI',monospace", letterSpacing: "1px", padding: "10px 20px", borderRadius: "7px", cursor: "pointer", color: "#06101c", background: "linear-gradient(#9dffb6,#4fe084)", border: "1px solid #7CFC9A" });
      endBtnEl.textContent = "END TURN";
      endBtnEl.onclick = () => endTurn();
      kernel.parent.appendChild(endBtnEl);
      owBtnEl = document.createElement("button");
      Object.assign(owBtnEl.style, { position: "absolute", right: "140px", bottom: "16px", zIndex: "50", font: "bold 13px 'Segoe UI',monospace", letterSpacing: "1px", padding: "10px 18px", borderRadius: "7px", cursor: "pointer", color: "#06101c", background: "linear-gradient(#bfe6ff,#5fb0e0)", border: "1px solid #9fd0ff" });
      owBtnEl.textContent = "OVERWATCH (Y)";
      owBtnEl.onclick = () => overwatchSelected();
      kernel.parent.appendChild(owBtnEl);
    }
    const playable = show && phase === "battle" && !busy && !sim.ended;
    endBtnEl.style.display = playable ? "block" : "none";
    owBtnEl.style.display = (playable && selected && selected.actionPoints > 0) ? "block" : "none";
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function onTileClick(x, y) {
    if (phase !== "battle" || busy || sim.ended || sim.currentPhase !== "player") return;
    const occupant = sim.allUnits().find((u) => u.hp > 0 && u.x === x && u.y === y);
    if (occupant && occupant.side === "player") { selectUnit(occupant); return; }
    if (!selected) return;
    if (occupant && occupant.side === "enemy") { tryAttack(occupant); return; }
    tryMove(x, y);
  }
  // All actions flow through the sim then animate the resulting EVENT queue, so
  // reaction fire (enemy overwatch on a player move) is shown automatically.
  function afterAction(u) {
    busy = false; refreshAllCover();
    if (sim.ended) return showEnd();
    if (u && u.hp > 0 && u.actionPoints > 0 && u.side === "player") selectUnit(u); else deselect();
  }
  function tryMove(x, y) {
    const u = selected; if (!u || u.actionPoints < 1) return;
    if (!(sim.reachableTiles(u) || []).some((r) => r.x === x && r.y === y)) return;
    const path = sim.moveUnit(u.id, x, y); if (!path) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  function tryAttack(target) {
    const u = selected; if (!u || u.actionPoints < 1) return;
    const r = sim.attackUnit(u.id, target.id); if (!r || !r.success) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  function overwatchSelected() {
    const u = selected; if (!u || u.actionPoints < 1 || busy || sim.ended) return;
    if (!sim.overwatchUnit(u.id)) return;
    busy = true; clearHighlights();
    drainEvents(() => afterAction(u));
  }
  function floatText(pos, txt, color) {
    const spr = makeTextSprite(txt, color);
    spr.position.copy(pos); spr.position.y += 1.2; scene.add(spr);
    kernel.tween({ target: spr.position, to: { y: spr.position.y + 1.6 }, duration: 0.8 });
    kernel.tween({ target: spr.material, to: { opacity: 0 }, duration: 0.8, onComplete: () => scene.remove(spr) });
  }
  function endTurn() {
    if (phase !== "battle" || busy || sim.ended || sim.currentPhase !== "player") return;
    deselect(); busy = true; setHUD("Enemy phase…");
    sim.endTurn();
    drainEvents(() => { busy = false; refreshAllCover(); if (sim.ended) return showEnd(); setHUD(); });
  }
  function drainEvents(done) {
    const q = events.slice(); events = []; let i = 0;
    const next = () => {
      if (i >= q.length) return done && done();
      const e = q[i++]; const d = playEvent(e); setTimeout(next, d);
    };
    next();
  }
  function playEvent(e) {
    if (e.type === "move") {
      const mu = e.payload.unit, v = unitViews[mu.id], path = e.payload.path || [];
      if (v && path.length) {
        const last = path[path.length - 1], w = cell(last.x, last.y);
        faceToward(mu, last.x, last.y); anim(mu, "walk", { fade: 0.15 });
        const dur = Math.max(0.3, Math.min(1.1, path.length * 0.16));
        kernel.tween({ target: v.group.position, to: { x: w.x, z: w.z }, duration: dur, onComplete: () => anim(mu, "idle", { fade: 0.2 }) });
        return dur * 1000 + 60;
      }
      return 30;
    }
    if (e.type === "attack") {
      const p = e.payload, au = p.attacker, tu = p.target;
      const a = unitViews[au.id], t = unitViews[tu.id];
      if (a && t) {
        faceToward(au, tu.x, tu.y);
        if (a.clips && a.clips.attack) { anim(au, "attack", { once: true, fade: 0.1 }); setTimeout(() => { if (!a.dead) anim(au, "idle", { fade: 0.2 }); }, 520); }
        else { const gp = a.group.position, ox = gp.x, oz = gp.z, dx = Math.sign(tu.x - au.x) * 0.18, dz = Math.sign(tu.y - au.y) * 0.18; kernel.tween({ target: gp, to: { x: ox - dx, z: oz - dz }, duration: 0.07, onComplete: () => kernel.tween({ target: gp, to: { x: ox, z: oz }, duration: 0.13 }) }); }
        const pa = a.group.position.clone(); pa.y = T * 0.6; const pb = t.group.position.clone(); pb.y = T * 0.6;
        const col = p.reaction ? 0x9fd0ff : p.crit ? 0xff5a3c : p.hit ? 0xffe066 : 0x8aa0bc;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), new THREE.LineBasicMaterial({ color: col, transparent: true }));
        scene.add(line); kernel.tween({ target: line.material, to: { opacity: 0 }, duration: 0.3, onComplete: () => scene.remove(line) });
        if (p.reaction) floatText({ x: pa.x, y: pa.y + 0.4, z: pa.z }, "OVERWATCH!", 0x9fd0ff);
        if (p.hit) {
          const big = !!p.crit;
          const burst = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.6 : 0.4, 12, 12), new THREE.MeshBasicMaterial({ color: big ? 0xff5a3c : 0xffd27a }));
          burst.position.copy(pb); scene.add(burst);
          kernel.tween({ target: burst.scale, to: { x: big ? 4 : 3, y: big ? 4 : 3, z: big ? 4 : 3 }, duration: 0.3 });
          kernel.tween({ target: burst.material, to: { opacity: 0 }, duration: 0.3, onUpdate: () => { burst.material.transparent = true; }, onComplete: () => scene.remove(burst) });
          floatText(pb, (p.crit ? "CRIT −" : "−") + (p.damage != null ? p.damage : ""), p.crit ? 0xff5a3c : 0xff7a6a);
          if (p.flanked && !p.crit) floatText({ x: pb.x, y: pb.y + 0.5, z: pb.z }, "FLANKED", 0xffae5a);
          refreshUnit(tu);
          if (p.killed) floatText({ x: pb.x, y: pb.y + 0.8, z: pb.z }, "ELIMINATED", 0xffffff);
        } else floatText(pb, "MISS", 0xaab4c8);
      }
      return p.crit ? 460 : 340;
    }
    if (e.type === "overwatch") {
      const v = unitViews[e.payload.unit.id];
      if (v) floatText({ x: v.group.position.x, y: T, z: v.group.position.z }, "OVERWATCH", 0x9fd0ff);
      return 150;
    }
    if (e.type === "end") { return 100; }
    return 20;
  }

  // ── Pointer ─────────────────────────────────────────────────────────────────
  const dom = kernel.renderer.domElement; dom.style.touchAction = "none";
  let down = null;
  dom.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY, b: ev.button }; });
  dom.addEventListener("pointerup", (ev) => {
    if (!down) return; const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y); const left = down.b === 0; down = null;
    if (!left || moved > 6) return; // right/drag = camera
    const hit = kernel.raycast(ev.clientX, ev.clientY, floorTargets);
    if (hit.length) onTileClick(hit[0].object.userData.x, hit[0].object.userData.y);
  });
  // Hover hit-preview: standing over an enemy with a soldier selected shows the
  // shot odds + FLANKED, the XCOM targeting read.
  let hoverTip = null;
  dom.addEventListener("pointermove", (ev) => {
    if (phase !== "battle" || busy || sim.ended || sim.currentPhase !== "player" || !selected) { if (hoverTip) { scene.remove(hoverTip); hoverTip = null; } return; }
    const hit = kernel.raycast(ev.clientX, ev.clientY, floorTargets);
    if (hoverTip) { scene.remove(hoverTip); hoverTip = null; }
    if (!hit.length) return;
    const { x, y } = hit[0].object.userData;
    const occ = sim.allUnits().find((u) => u.hp > 0 && u.x === x && u.y === y && u.side === "enemy");
    if (!occ) return;
    const bd = sim.hitBreakdown(selected, occ); const los = sim.hasLineOfSight(selected.x, selected.y, occ.x, occ.y);
    const label = !los ? "NO LOS" : !bd.inRange ? "OUT OF RANGE" : Math.round(bd.chance * 100) + "%" + (bd.flanked ? " ⚑FLANK" : "");
    const col = !los || !bd.inRange ? 0xff8888 : bd.flanked ? 0xffae5a : bd.chance >= 0.7 ? 0x88ff88 : 0xffe066;
    hoverTip = makeTextSprite(label, col); const w = cell(x, y); hoverTip.position.set(w.x, T * 1.9, w.z); hoverTip.scale.set(3.4, 0.85, 1); scene.add(hoverTip);
  });
  window.addEventListener("keydown", (e) => {
    if (phase !== "battle" || sim.ended) return;
    const k = (e.key || "").toLowerCase();
    if (k === "y") { e.preventDefault(); overwatchSelected(); }
    else if (k === "escape" && selected) { e.stopImmediatePropagation(); e.preventDefault(); deselect(); }
  });

  // ── Boot ────────────────────────────────────────────────────────────────────
  buildSim(); await buildBoard();
  for (const u of sim.allUnits()) await makeUnit(u); // load + instance the animated models
  sim.allUnits().forEach(refreshUnit);

  let shell = null;
  function beginBattle() { phase = "battle"; orbit.autoRotate = false; setHUD(); }
  function showEnd() {
    const win = sim.aliveAllies().length > 0;
    window.__FFG_RESULT__ = { victory: win, turns: sim.turnNumber };
    if (shell) shell.end(win, win ? "Mission complete · " + sim.turnNumber + " turns" : "Squad eliminated");
  }
  if (window.FFG && window.FFG.Shell) {
    shell = new window.FFG.Shell({
      parent: kernel.parent, title: content.title || "Operation",
      tagline: content.tagline || "Lead the squad. Take the map.",
      music: (content.audio && content.audio.music) || null,
      menuImage: (content.assets && content.assets.menu_image) || null,
      howTo: [
        { h: "GOAL", p: (mission.objective || "Eliminate all hostiles") + "." },
        { h: "ORDERS", p: "Click a soldier to select, click a glowing tile to move, click an enemy in range to fire. Each soldier has action points (AP)." },
        { h: "COVER", p: "Stand beside cover (crates/walls) to cut the enemy's hit chance. Move carefully — open ground is deadly." },
        { h: "CAMERA", p: "<b>Right-drag</b> rotate, <b>WASD</b> move, scroll zoom. <b>Esc</b> pauses." },
      ],
      onPlay: () => beginBattle(),
      onPause: () => kernel.stop(), onResume: () => kernel.start(),
    });
    shell.start();
  } else { beginBattle(); }

  const controller = {
    sim,
    __test: {
      start: () => { if (shell) { shell.hide(); shell.phase = "playing"; } beginBattle(); },
      state: () => ({ phase, turn: sim.turnNumber, ended: sim.ended, allies: sim.aliveAllies().length, enemies: sim.aliveEnemies().length, sceneChildren: scene.children.length }),
      select: (id) => { selectUnit(sim.getUnit(id)); return !!sim.getUnit(id); },
      move: (id, x, y) => { selectUnit(sim.getUnit(id)); return !!sim.moveUnit(id, x, y); },
      attack: (aid, tid) => sim.attackUnit(aid, tid),
      overwatch: (id) => { if (id) selectUnit(sim.getUnit(id)); overwatchSelected(); },
      endTurn: () => endTurn(),
      autoResolve: (maxTurns) => {
        let n = 0;
        while (!sim.ended && n++ < (maxTurns || 40)) {
          if (sim.currentPhase !== "player") { sim.endTurn(); continue; }
          const allies = sim.aliveAllies();
          for (const ai of allies) {
            const u = sim.getUnit(ai.id); let guard = 0;
            while (u.actionPoints > 0 && guard++ < 4 && !sim.ended) {
              const es = sim.aliveEnemies(); if (!es.length) break;
              es.sort((p, q) => (Math.abs(p.x - u.x) + Math.abs(p.y - u.y)) - (Math.abs(q.x - u.x) + Math.abs(q.y - u.y)));
              const e = es[0], d = Math.abs(e.x - u.x) + Math.abs(e.y - u.y);
              if (d <= u.range && sim.hasLineOfSight(u.x, u.y, e.x, e.y)) { sim.attackUnit(u.id, e.id); }
              else { const p = sim.findPath(u.x, u.y, e.x, e.y); if (!p || !p.length) break; const s = Math.min(p.length, u.movement); let dst = p[s - 1]; if (dst.x === e.x && dst.y === e.y) { if (s < 2) break; dst = p[s - 2]; } if (!sim.moveUnit(u.id, dst.x, dst.y)) break; }
            }
          }
          sim.endTurn();
        }
        sim.allUnits().forEach(refreshUnit);
        if (sim.ended) showEnd();
        return { ended: sim.ended, victory: sim.aliveAllies().length > 0, turns: sim.turnNumber };
      },
    },
  };
  return controller;
});

function makeTextSprite(text, colorHex) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "bold 44px 'Segoe UI',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#000"; ctx.fillText(text, 130, 36);
  ctx.fillStyle = "#" + (colorHex || 0xffffff).toString(16).padStart(6, "0"); ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(2.6, 0.65, 1);
  return spr;
}

// XCOM-style cover shield: a crisp white shield, full (solid) or half (split).
const _shieldTexCache = {};
function shieldTex(full) {
  const key = full ? "full" : "half";
  if (_shieldTexCache[key]) return _shieldTexCache[key];
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d");
  function shieldPath() { ctx.beginPath(); ctx.moveTo(32, 6); ctx.lineTo(56, 16); ctx.lineTo(56, 34); ctx.quadraticCurveTo(56, 52, 32, 60); ctx.quadraticCurveTo(8, 52, 8, 34); ctx.lineTo(8, 16); ctx.closePath(); }
  // glow backing
  ctx.shadowColor = full ? "#bfe9ff" : "#ffd27a"; ctx.shadowBlur = 10;
  shieldPath(); ctx.fillStyle = full ? "#dff4ff" : "#3a2c14"; ctx.fill();
  ctx.shadowBlur = 0;
  if (!full) { ctx.save(); shieldPath(); ctx.clip(); ctx.fillStyle = "#ffcf6a"; ctx.fillRect(0, 34, 64, 30); ctx.restore(); }
  shieldPath(); ctx.lineWidth = 4; ctx.strokeStyle = full ? "#7fd6ff" : "#ffb454"; ctx.stroke();
  const tex = new THREE.CanvasTexture(c); _shieldTexCache[key] = tex; return tex;
}
function makeShieldSprite() {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: shieldTex(true), transparent: true, depthTest: false }));
  spr.scale.set(0.9, 0.9, 1);
  return spr;
}
