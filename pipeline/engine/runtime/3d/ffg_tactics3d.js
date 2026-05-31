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

  scene.background = new THREE.Color(0x0a1018);
  scene.fog = new THREE.FogExp2(0x0a1018, 0.012);

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
  function buildBoard() {
    // platform base
    const plat = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.6, H + 1.4),
      new THREE.MeshStandardMaterial({ color: 0x0c1626, roughness: 0.9, metalness: 0.2 }));
    plat.position.set(0, -0.35, 0); plat.receiveShadow = true; scene.add(plat);

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const t = mission.grid[y][x];
        const w = cell(x, y);
        if (t === 1) { // WALL — tall steel block, blocks move + LOS
          const m = new THREE.Mesh(new THREE.BoxGeometry(T * 0.98, T * 1.15, T * 0.98),
            new THREE.MeshStandardMaterial({ color: 0x2c3b50, roughness: 0.7, metalness: 0.35 }));
          m.position.set(w.x, T * 0.5, w.z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
          continue;
        }
        // FLOOR tile (beveled panel) for everything walkable
        const checker = (x + y) % 2 === 0 ? 0x18222f : 0x141d29;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(T * 0.96, 0.3, T * 0.96),
          new THREE.MeshStandardMaterial({ color: checker, roughness: 0.85, metalness: 0.25 }));
        tile.position.set(w.x, 0.02, w.z); tile.receiveShadow = true; scene.add(tile);
        // interactive overlay
        const hit = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.96, T * 0.96),
          new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
        hit.rotation.x = -Math.PI / 2; hit.position.set(w.x, 0.2, w.z); hit.userData = { x, y };
        scene.add(hit); floorTargets.push(hit);

        if (t === 2 || t === 3) buildCover(w, t === 3);
        else if (t === 4) buildHazard(w);
      }
    }
  }
  function buildCover(w, full) {
    const s = full ? T * 0.72 : T * 0.56, h = full ? T * 0.95 : T * 0.5, base = full ? 0x7d6428 : 0x5f4d24;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s),
      new THREE.MeshStandardMaterial({ color: base, roughness: 0.7, metalness: 0.3 }));
    m.position.set(w.x, h / 2 + 0.05, w.z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(s, h * 0.16, s),
      new THREE.MeshStandardMaterial({ color: shade(base, 0.3), roughness: 0.6, metalness: 0.4 }));
    cap.position.set(w.x, h + 0.05, w.z); scene.add(cap);
  }
  function buildHazard(w) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(T * 0.96, 0.32, T * 0.96),
      new THREE.MeshStandardMaterial({ color: 0x2a0f0f, emissive: 0xff4010, emissiveIntensity: 0.35, roughness: 0.8 }));
    tile.position.set(w.x, 0.04, w.z); scene.add(tile);
    let tt = Math.random() * 6;
    kernel.onUpdate((dt) => { tt += dt; tile.material.emissiveIntensity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(tt * 3)); });
  }

  // ── Units (procedural low-poly soldiers) ────────────────────────────────────
  function unitColor(u) { return u.tint != null ? new THREE.Color(u.tint).getHex() : (u.side === "player" ? 0x3aa0ff : 0xff5a4a); }
  function makeUnit(u) {
    const w = cell(u.x, u.y);
    const g = new THREE.Group(); g.position.set(w.x, 0.2, w.z);
    const col = unitColor(u), dark = shade(col, -0.5);
    // faction base ring
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.34, T * 0.34, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.5 }));
    ring.position.y = 0.07; g.add(ring);
    // body (tapered) + head — a clean low-poly trooper silhouette
    const bodyMat = new THREE.MeshStandardMaterial({ color: shade(col, -0.15), roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.15, T * 0.22, T * 0.7, 12), bodyMat);
    body.position.y = T * 0.45; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(T * 0.15, 14, 12),
      new THREE.MeshStandardMaterial({ color: shade(col, 0.25), roughness: 0.4, metalness: 0.4 }));
    head.position.y = T * 0.92; head.castShadow = true; g.add(head);
    // weapon nub
    const gun = new THREE.Mesh(new THREE.BoxGeometry(T * 0.5, T * 0.07, T * 0.07),
      new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.5, metalness: 0.6 }));
    gun.position.set(T * 0.22, T * 0.55, 0); g.add(gun);
    // HP bar (billboard)
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.6, 0.16), new THREE.MeshBasicMaterial({ color: 0x0a0f17 }));
    const hpFill = new THREE.Mesh(new THREE.PlaneGeometry(T * 0.56, 0.1), new THREE.MeshBasicMaterial({ color: 0x3ddc84 }));
    hpBg.position.set(0, T * 1.25, 0); hpFill.position.set(0, T * 1.25, 0.01);
    g.add(hpBg); g.add(hpFill);
    scene.add(g);
    kernel.onUpdate(() => { hpBg.quaternion.copy(kernel.camera.quaternion); hpFill.quaternion.copy(kernel.camera.quaternion); });
    unitViews[u.id] = { group: g, ring, hpFill, base: col, dark, hpW: T * 0.56 };
  }
  function refreshUnit(u) {
    const v = unitViews[u.id]; if (!v) return;
    if (u.hp <= 0) { v.group.visible = false; return; }
    const pct = Math.max(0, u.hp / u.maxHp);
    v.hpFill.scale.x = Math.max(0.001, pct);
    v.hpFill.position.x = -(v.hpW * (1 - pct)) / 2;
    v.hpFill.material.color.setHex(pct > 0.5 ? 0x3ddc84 : pct > 0.25 ? 0xf5c518 : 0xff5a5a);
  }

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
  let endBtnEl = null;
  function renderEndBtn(show) {
    if (!endBtnEl) {
      endBtnEl = document.createElement("button");
      Object.assign(endBtnEl.style, { position: "absolute", right: "16px", bottom: "16px", zIndex: "50", font: "bold 13px 'Segoe UI',monospace", letterSpacing: "1px", padding: "10px 20px", borderRadius: "7px", cursor: "pointer", color: "#06101c", background: "linear-gradient(#9dffb6,#4fe084)", border: "1px solid #7CFC9A" });
      endBtnEl.textContent = "END TURN";
      endBtnEl.onclick = () => endTurn();
      kernel.parent.appendChild(endBtnEl);
    }
    endBtnEl.style.display = (show && phase === "battle" && !busy && !sim.ended) ? "block" : "none";
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
  function tryMove(x, y) {
    const u = selected; if (!u || u.actionPoints < 1) return;
    const reach = (sim.reachableTiles(u) || []).some((r) => r.x === x && r.y === y);
    if (!reach) return;
    const path = sim.moveUnit(u.id, x, y); if (!path) return;
    busy = true; clearHighlights();
    const w = cell(x, y);
    kernel.tween({ target: unitViews[u.id].group.position, to: { x: w.x, z: w.z }, duration: 0.32, onComplete: () => { busy = false; if (u.hp > 0 && u.actionPoints > 0) selectUnit(u); else deselect(); } });
    kernel.playSound("", 0);
  }
  function tryAttack(target) {
    const u = selected; if (!u || u.actionPoints < 1) return;
    const r = sim.attackUnit(u.id, target.id); if (!r || r.invalid) return;
    busy = true; clearHighlights();
    const a = unitViews[u.id].group.position.clone(); a.y = T * 0.55;
    const b = unitViews[target.id].group.position.clone(); b.y = T * 0.55;
    // tracer
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: r.hit ? 0xffe066 : 0x88aacc, transparent: true, opacity: 0.95 }));
    scene.add(line); kernel.tween({ target: line.material, to: { opacity: 0 }, duration: 0.3, onComplete: () => scene.remove(line) });
    if (r.hit) {
      floatText(b, "-" + (r.damage != null ? r.damage : ""), 0xff7a6a);
      const burst = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
      burst.position.copy(b); scene.add(burst);
      kernel.tween({ target: burst.scale, to: { x: 3, y: 3, z: 3 }, duration: 0.3 });
      kernel.tween({ target: burst.material, to: { opacity: 0 }, duration: 0.3, onUpdate: () => { burst.material.transparent = true; }, onComplete: () => scene.remove(burst) });
      refreshUnit(target);
      if (r.killed) floatText(b, "DOWN", 0xffffff);
    } else { floatText(b, "MISS", 0xaab4c8); }
    setTimeout(() => { busy = false; if (sim.ended) return showEnd(); if (u.hp > 0 && u.actionPoints > 0) selectUnit(u); else deselect(); }, 380);
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
    drainEvents(() => { busy = false; if (sim.ended) return showEnd(); setHUD(); });
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
      const v = unitViews[e.payload.unit.id], path = e.payload.path || [];
      if (v && path.length) { const last = path[path.length - 1]; const w = cell(last.x, last.y); kernel.tween({ target: v.group.position, to: { x: w.x, z: w.z }, duration: 0.3 }); return Math.min(path.length, 6) * 80 + 60; }
      return 30;
    }
    if (e.type === "attack") {
      const a = unitViews[e.payload.attacker.id], t = unitViews[e.payload.target.id];
      if (a && t) {
        const pa = a.group.position.clone(); pa.y = T * 0.55; const pb = t.group.position.clone(); pb.y = T * 0.55;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), new THREE.LineBasicMaterial({ color: e.payload.hit ? 0xffe066 : 0x88aacc, transparent: true }));
        scene.add(line); kernel.tween({ target: line.material, to: { opacity: 0 }, duration: 0.3, onComplete: () => scene.remove(line) });
        if (e.payload.hit) { floatText(pb, "-" + (e.payload.damage != null ? e.payload.damage : ""), 0xff7a6a); refreshUnit(e.payload.target); if (e.payload.killed) floatText(pb, "DOWN", 0xffffff); }
        else floatText(pb, "MISS", 0xaab4c8);
      }
      return 340;
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

  // ── Boot ────────────────────────────────────────────────────────────────────
  buildSim(); buildBoard();
  sim.allUnits().forEach(makeUnit);
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
