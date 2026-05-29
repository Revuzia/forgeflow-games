/**
 * FFG runtime — 3d/ffg_battleship_3d.js  (ES module)
 * The render + input + CINEMATIC layer for hybrid salvo battleship. Binds the
 * pure sim (FFG.sim.Battleship) to a three.js scene: animated ocean, two gridded
 * boards, Kenney ship models, raycast click-to-fire on enemy waters, a per-shot
 * cinematic (cannonball arc -> splash / explosion -> ship sink), pegs, a DOM HUD,
 * and win/lose. Registers genre "battleship" into the 3D kernel registry.
 *
 * Exposes controller.__test so the feel/signature checks can drive it headlessly.
 */
import * as THREE from "three";
import "../sim/battleship.js"; // side-effect: sets window.FFG.sim.Battleship

// Import the kernel with the SAME version query the boot entry used, so genre
// registration targets the same kernel module instance the boot uses.
const { register3d } = await import("./ffg_kernel_3d.js" + new URL(import.meta.url).search);

const CELL = 2.4;

register3d("battleship", async function (kernel, content) {
  const Battleship = window.FFG.sim.Battleship;
  const m = content.setup || content;
  const size = m.board_size || 10;
  const sim = new Battleship({
    size: size,
    fleet: m.fleet,
    seed: content.seed != null ? content.seed : 4242,
    player_placements: m.player_placements,
    enemy_placements: m.enemy_placements,
    difficulty: m.difficulty || content.difficulty || "normal",
  });

  const scene = kernel.scene;
  const boardSpan = size * CELL;
  const sfx = content.sfx || {}; // { fire, hit, miss, sink } urls (optional)
  const music = (content.audio && content.audio.music) || null;
  // Game-shell state machine: menu -> placement -> battle -> ended.
  // (pause overlays on top of placement/battle without changing `phase`).
  const placementEnabled = !(content.setup && content.setup.placement === false);
  let phase = "menu";
  let paused = false;
  let _placement = null; // test hook handle
  let beginGame = null;  // assigned below; called by the menu Play button

  // ── Ocean ──────────────────────────────────────────────────────────────
  const oceanGeo = new THREE.PlaneGeometry(400, 400, 80, 80);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMat = new THREE.MeshStandardMaterial({ color: 0x12466b, metalness: 0.1, roughness: 0.55, flatShading: false });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.receiveShadow = true;
  scene.add(ocean);
  const basePos = oceanGeo.attributes.position.array.slice();
  kernel.onUpdate((dt, t) => {
    const p = oceanGeo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = basePos[i], z = basePos[i + 2];
      // Keep crests below the board top (~0.2) so waves never clip through the
      // grids. Subtle ripple, not a swell.
      p[i + 1] = Math.sin(x * 0.08 + t * 1.1) * 0.08 + Math.cos(z * 0.11 + t * 0.9) * 0.06;
    }
    oceanGeo.attributes.position.needsUpdate = true;
    oceanGeo.computeVertexNormals();
  });

  // ── Real physics (cannon-es): cannonball ballistics + ship sinking + debris ─
  try {
    await kernel.initPhysics({ gravity: -22 });
  } catch (e) {
    console.warn("[battleship] physics unavailable; tween fallback:", e);
  }

  // ── Boards: player (near, z+) and enemy (far, z-) ─────────────────────────
  // Keep a SMALL gap (one cell) between the two boards so a single framed
  // camera reads both clearly — previously they sat ~30u apart, so the near
  // board loomed and the far one shrank into the distance.
  const PLAYER_Z = boardSpan / 2 + CELL * 1.2;
  const ENEMY_Z = -(boardSpan / 2 + CELL * 1.2);
  function boardOrigin(side) { return new THREE.Vector3(-boardSpan / 2, 0.2, (side === "player" ? PLAYER_Z : ENEMY_Z) - boardSpan / 2); }
  function cellWorld(side, x, y) {
    const o = boardOrigin(side);
    return new THREE.Vector3(o.x + x * CELL + CELL / 2, 0.25, o.z + y * CELL + CELL / 2);
  }
  function makeBoard(side, color) {
    const g = new THREE.Group();
    const o = boardOrigin(side);
    // platform
    const plat = new THREE.Mesh(new THREE.BoxGeometry(boardSpan + 0.6, 0.4, boardSpan + 0.6),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 }));
    plat.position.set(o.x + boardSpan / 2, 0.0, o.z + boardSpan / 2);
    plat.receiveShadow = true; g.add(plat);
    // grid lines
    const grid = new THREE.GridHelper(boardSpan, size, 0x9fd2ff, 0x5a8fb5);
    grid.position.set(o.x + boardSpan / 2, 0.22, o.z + boardSpan / 2);
    g.add(grid);
    scene.add(g);
    return g;
  }
  makeBoard("player", 0x16384f);
  makeBoard("enemy", 0x4f1f24);

  // label
  function label(side, text) {
    const c = cellWorld(side, size / 2, side === "player" ? size + 0.6 : -1.2);
    const sprite = makeTextSprite(text);
    sprite.position.set(c.x, 2.4, c.z);
    scene.add(sprite);
  }

  // ── Click targets on enemy board ──────────────────────────────────────────
  const cellMeshes = [];
  const targetMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, color: 0xffffff });
  const hoverMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, color: 0xffd166 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cw = cellWorld("enemy", x, y);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.95, CELL * 0.95), targetMat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cw.x, 0.3, cw.z);
      mesh.userData = { x, y };
      scene.add(mesh);
      cellMeshes.push(mesh);
    }
  }

  // ── Ship models ───────────────────────────────────────────────────────────
  const modelForLen = (len) => content.ship_models
    ? (content.ship_models[String(len)] || content.ship_models.default)
    : null;

  async function placeShip(side, ship) {
    const url = modelForLen(ship.len);
    const c0 = ship.cells[0], cN = ship.cells[ship.cells.length - 1];
    const w0 = cellWorld(side, c0.x, c0.y), wN = cellWorld(side, cN.x, cN.y);
    const center = w0.clone().add(wN).multiplyScalar(0.5);
    let obj;
    if (url) {
      try { obj = await kernel.loadGLTF(url); } catch (e) { obj = null; }
    }
    if (!obj) obj = proceduralShip(ship.len);
    // Scale so the hull spans ~62% of its cell-length (was 82% — ships were
    // overspilling their cells and crowding neighbours). Also cap the across-
    // axis width so wide models don't bleed into adjacent rows.
    const box = new THREE.Box3().setFromObject(obj);
    const dim = box.getSize(new THREE.Vector3());
    const longest = Math.max(dim.x, dim.z) || 1;
    const targetLen = ship.len * CELL * 0.62;
    let s = targetLen / longest;
    const across = Math.min(dim.x, dim.z) || 1;
    s = Math.min(s, (CELL * 0.85) / across); // keep width within ~1 cell
    obj.scale.setScalar(s);
    // orient: align longest axis with ship axis
    if (ship.horizontal && dim.z > dim.x) obj.rotation.y = Math.PI / 2;
    if (!ship.horizontal && dim.x > dim.z) obj.rotation.y = Math.PI / 2;
    obj.position.set(center.x, 0.28, center.z);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    scene.add(obj);
    ship._obj = obj;
    return obj;
  }
  function proceduralShip(len) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len * CELL * 0.7, 0.7, CELL * 0.6),
      new THREE.MeshStandardMaterial({ color: 0x3a4654, roughness: 0.7, metalness: 0.3 }));
    hull.position.y = 0.35; g.add(hull);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.5, 0.8, CELL * 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2a323c }));
    tower.position.y = 0.9; g.add(tower);
    return g;
  }

  label("player", content.title || "YOUR FLEET");
  label("enemy", "ENEMY WATERS");

  // Player-board cells (raycast targets) — used during the placement phase.
  const playerCells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cw = cellWorld("player", x, y);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.95, CELL * 0.95), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, color: 0xffffff }));
      m.rotation.x = -Math.PI / 2; m.position.set(cw.x, 0.3, cw.z); m.userData = { x, y }; scene.add(m); playerCells.push(m);
    }
  }

  // Preload every unique ship GLB up-front so placement/auto-place don't stutter
  // while models stream in (and so the placement->battle transition is instant).
  if (content.ship_models) {
    const urls = Array.from(new Set(Object.values(content.ship_models)));
    await Promise.all(urls.map((u) => kernel.loadGLTF(u).catch(() => null)));
  }

  async function placePlayerFleetVisuals() {
    for (const ship of sim.player.ships) await placeShip("player", ship);
  }

  // ── Placement phase machinery (always defined; activated by beginGame) ─────
  const fleet = sim.fleet;
  let pIndex = 0, pHoriz = true, ghost = null;
  const cellsFor = (x, y, len, h) => { const a = []; for (let i = 0; i < len; i++) a.push({ x: h ? x + i : x, y: h ? y : y + i }); return a; };
  const valid = (cs) => cs.every((c) => c.x >= 0 && c.y >= 0 && c.x < size && c.y < size && sim.player.grid[c.y][c.x] === -1);
  const clearGhost = () => { if (ghost) { scene.remove(ghost); ghost = null; } };
  function placementHUD() {
    const spec = fleet[pIndex];
    kernel.hud(`<div style="position:absolute;top:10px;left:12px;font-size:15px"><b>${content.title || "Iron Tide"}</b><br>
      <span style="font-size:12px;opacity:.9">${spec ? `Place your <b>${spec.name}</b> (${spec.len}) — click your waters · <b>R</b> rotate · <b>A</b> auto · <b>Esc</b> pause` : "Ready"}</span></div>
      <div style="position:absolute;top:10px;right:12px;font-size:12px">Ships placed: ${pIndex}/${fleet.length}</div>`);
  }
  function showGhost(x, y) {
    clearGhost(); const spec = fleet[pIndex]; if (!spec) return;
    const cs = cellsFor(x, y, spec.len, pHoriz), ok = valid(cs);
    ghost = new THREE.Group();
    cs.forEach((c) => {
      const w = cellWorld("player", Math.max(0, Math.min(size - 1, c.x)), Math.max(0, Math.min(size - 1, c.y)));
      const b = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.8, 0.4, CELL * 0.8), new THREE.MeshBasicMaterial({ color: ok ? 0x3ddc84 : 0xff5a5a, transparent: true, opacity: 0.55 }));
      b.position.set(w.x, 0.5, w.z); ghost.add(b);
    });
    scene.add(ghost);
  }
  async function commit(x, y) {
    const spec = fleet[pIndex]; if (!spec) return;
    if (!sim.placePlayerShip(spec.id, x, y, pHoriz)) return; // invalid placement
    await placeShip("player", sim.player.ships[sim.player.ships.length - 1]);
    pIndex++; clearGhost();
    if (pIndex >= fleet.length) startBattle(); else placementHUD();
    kernel.playSound(sfx.fire, 0.25);
  }
  async function autoPlace() {
    sim.resetPlayerBoard();
    sim._place(sim.player, null); // seeded-random legal placement
    await placePlayerFleetVisuals();
    pIndex = fleet.length; clearGhost(); startBattle();
  }
  function startBattle() {
    phase = "battle"; clearGhost();
    playerCells.forEach((m) => scene.remove(m));
    setHUD();
  }
  function beginPlacement() {
    sim.resetPlayerBoard(); pIndex = 0; phase = "placement"; placementHUD();
  }
  async function beginBattleDirect() {
    await placePlayerFleetVisuals();
    playerCells.forEach((m) => scene.remove(m));
    phase = "battle"; setHUD();
  }
  beginGame = () => { if (placementEnabled) beginPlacement(); else beginBattleDirect(); };
  {
    const dom0 = kernel.renderer.domElement;
    dom0.addEventListener("pointermove", (ev) => { if (phase !== "placement" || paused) return; const h = kernel.raycast(ev.clientX, ev.clientY, playerCells); if (h.length) showGhost(h[0].object.userData.x, h[0].object.userData.y); });
    dom0.addEventListener("pointerdown", (ev) => { if (phase !== "placement" || paused) return; const h = kernel.raycast(ev.clientX, ev.clientY, playerCells); if (h.length) commit(h[0].object.userData.x, h[0].object.userData.y); });
    window.addEventListener("keydown", (e) => {
      if (phase !== "placement" || paused) return;
      if (e.key === "r" || e.key === "R") { pHoriz = !pHoriz; }
      else if (e.key === "a" || e.key === "A") { autoPlace(); }
    });
    _placement = { autoPlace, commit, rotate: () => { pHoriz = !pHoriz; }, state: () => ({ phase, pIndex, total: fleet.length }) };
  }

  // ── Camera framing — clean 3/4 overhead that reads both boards evenly ─────
  // Narrower FOV (less perspective looming) + high, centered vantage looking at
  // the midpoint between the boards. Tiny idle drift only.
  kernel.camera.fov = 40;
  kernel.camera.updateProjectionMatrix();
  const CAM = { x: 0, y: boardSpan * 1.85, z: boardSpan * 1.78 };
  kernel.camera.position.set(CAM.x, CAM.y, CAM.z);
  // Look slightly toward the player board (+z) so the near row isn't clipped.
  const LOOK_Z = boardSpan * 0.18;
  kernel.camera.lookAt(0, 0, LOOK_Z);
  // Accessibility: honour the OS reduced-motion preference — no camera drift,
  // and cinematics resolve fast (see _playEvent delays).
  const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let camIdle = 0;
  kernel.onUpdate((dt) => {
    if (reducedMotion) return;
    camIdle += dt; kernel.camera.position.x = Math.sin(camIdle * 0.12) * 1.5; kernel.camera.lookAt(0, 0, LOOK_Z);
  });

  // ── Pegs + effects ─────────────────────────────────────────────────────────
  // Colorblind-safe markers: differ by SHAPE, not just colour.
  //   hit  = red SPIKE (cone, point up)   miss = white flat DISC
  const hitGeo = new THREE.ConeGeometry(0.32, 1.1, 14);
  const missGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 16);
  function placePeg(side, x, y, hit) {
    const w = cellWorld(side, x, y);
    const peg = new THREE.Mesh(
      hit ? hitGeo : missGeo,
      new THREE.MeshStandardMaterial({ color: hit ? 0xff3b30 : 0xeaeaea, emissive: hit ? 0x551111 : 0x000000, roughness: 0.5 }));
    peg.position.set(w.x, hit ? 0.75 : 0.32, w.z); peg.castShadow = true; scene.add(peg);
  }
  function splash(pos) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.3, pos.z); scene.add(ring);
    kernel.tween({ target: ring.scale, to: { x: 8, y: 8, z: 8 }, duration: 0.7 });
    kernel.tween({ target: ring.material, to: { opacity: 0 }, duration: 0.7, onComplete: () => scene.remove(ring) });
  }
  function explosion(pos) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    ball.position.copy(pos); ball.position.y = 0.8; scene.add(ball);
    kernel.tween({ target: ball.scale, to: { x: 6, y: 6, z: 6 }, duration: 0.45 });
    kernel.tween({ target: ball.material, to: { opacity: 0 }, duration: 0.45, ease: (x) => x, onUpdate: () => { ball.material.transparent = true; }, onComplete: () => scene.remove(ball) });
    // smoke puff
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), new THREE.MeshStandardMaterial({ color: 0x444444, transparent: true, opacity: 0.7 }));
    smoke.position.copy(pos); smoke.position.y = 1.2; scene.add(smoke);
    kernel.tween({ target: smoke.position, to: { y: 4.5 }, duration: 1.4 });
    kernel.tween({ target: smoke.material, to: { opacity: 0 }, duration: 1.4, onComplete: () => scene.remove(smoke) });
  }
  function fireCannonball(fromSide, to, onImpact) {
    const from = cellWorld(fromSide, size / 2, fromSide === "player" ? size - 1 : 0).clone();
    from.y = 1.4;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.7, roughness: 0.3 }));
    ball.position.copy(from); ball.castShadow = true; scene.add(ball);
    const C = kernel.CANNON;
    const T = 0.72;
    if (reducedMotion) { scene.remove(ball); onImpact(); return; }
    if (C && kernel.world) {
      // Real ballistic arc — solve launch velocity so gravity lands it on target.
      const g = kernel.world.gravity.y; // negative
      const vel = { x: (to.x - from.x) / T, y: (to.y - from.y) / T - 0.5 * g * T, z: (to.z - from.z) / T };
      kernel.addPhysicsBody({ mesh: ball, shape: new C.Sphere(0.3), mass: 3, position: from, velocity: vel, despawnAfter: T + 0.1, removeMesh: true });
      setTimeout(onImpact, T * 1000);
    } else {
      const peak = 9 + Math.random() * 3;
      kernel.tween({
        target: ball.position, to: { x: to.x, z: to.z }, duration: 0.6,
        onUpdate: (e) => { ball.position.y = from.y + Math.sin(e * Math.PI) * peak; },
        onComplete: () => { scene.remove(ball); onImpact(); },
      });
    }
  }
  function sinkShip(ship) {
    if (!ship._obj) return;
    const obj = ship._obj;
    const C = kernel.CANNON;
    if (C && kernel.world) {
      // Convert the ship into a dynamic rigid body: gravity sinks it, a random
      // torque makes it list and roll under. Real physics, not a tween.
      kernel.addPhysicsBody({
        mesh: obj,
        shape: new C.Box(new C.Vec3(Math.max(0.6, ship.len * CELL * 0.35), 0.5, CELL * 0.35)),
        mass: 6,
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        angularVelocity: { x: (Math.random() - 0.5) * 2.5, y: (Math.random() - 0.5), z: (Math.random() - 0.5) * 2.5 },
        linearDamping: 0.4, despawnAfter: 4.5, removeMesh: true,
      });
      // Flying debris flung up from the impact.
      for (let i = 0; i < 5; i++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x6b5535, roughness: 0.9 }));
        d.position.set(obj.position.x + (Math.random() - 0.5) * 2, 1, obj.position.z + (Math.random() - 0.5) * 2);
        d.castShadow = true; scene.add(d);
        kernel.addPhysicsBody({
          mesh: d, shape: new C.Box(new C.Vec3(0.25, 0.25, 0.25)), mass: 0.6, position: d.position,
          velocity: { x: (Math.random() - 0.5) * 5, y: 3 + Math.random() * 3, z: (Math.random() - 0.5) * 5 },
          angularVelocity: { x: Math.random() * 4, y: Math.random() * 4, z: Math.random() * 4 },
          despawnAfter: 3, removeMesh: true,
        });
      }
    } else {
      kernel.tween({ target: obj.position, to: { y: -2.5 }, duration: 1.6 });
      kernel.tween({ target: obj.rotation, to: { z: 0.6 }, duration: 1.6 });
    }
  }
  async function revealAndSink(side, ship) {
    if (!ship._obj) { await placeShip(side, ship); ship._obj.position.y = 0.35; }
    explosion(cellWorld(side, ship.cells[Math.floor(ship.cells.length / 2)].x, ship.cells[Math.floor(ship.cells.length / 2)].y));
    sinkShip(ship);
  }

  // ── Turn flow ───────────────────────────────────────────────────────────────
  let busy = false;
  function setHUD(msg) {
    const ps = sim.fleetStatus("player"), es = sim.fleetStatus("enemy");
    const dots = (arr) => arr.map((s) => `<span style="color:${s.sunk ? "#ff5a5a" : "#7CFC9A"}">${s.sunk ? "✖" : "▰"}</span>`).join(" ");
    kernel.hud(`
      <div style="position:absolute;top:10px;left:12px;font-size:15px">
        <b>${content.title || "Iron Tide"}</b><br>
        <span style="font-size:12px;opacity:.85">Turn ${sim.turnNumber} — ${msg || (sim.turn === "player" ? "Your move: click enemy waters" : "Enemy firing…")}</span>
      </div>
      <div style="position:absolute;top:10px;right:12px;font-size:13px;text-align:right">
        Your fleet: ${dots(ps)}<br>Enemy fleet: ${dots(es)}
      </div>
      <div style="position:absolute;bottom:8px;left:12px;font-size:11px;opacity:.6">Esc: pause</div>
    `);
  }
  if (phase === "battle") setHUD(); // placement phase keeps its own HUD until Ready

  function resolveShot(side, r, after) {
    const to = cellWorld(side === "player" ? "enemy" : "player", r.x, r.y);
    kernel.playSound(sfx.fire, 0.45); // gun report on launch
    fireCannonball(side, to, () => {
      if (r.result === "miss") { splash(to); placePeg(side === "player" ? "enemy" : "player", r.x, r.y, false); kernel.playSound(sfx.miss, 0.5); }
      else { explosion(to); placePeg(side === "player" ? "enemy" : "player", r.x, r.y, true); kernel.playSound(sfx.hit, 0.6); }
      if (r.result === "sink") {
        const tb = side === "player" ? "enemy" : "player";
        const ship = sim.boardOf(tb).ships.find((s) => s.id === r.ship);
        if (ship) revealAndSink(tb, ship);
        kernel.playSound(sfx.sink, 0.7);
      }
      setHUD();
      if (sim.ended) showEnd(sim.winner === "player");
      setTimeout(after, reducedMotion ? 50 : (r.result === "sink" ? 900 : 450));
    });
  }

  function doPlayerFire(x, y) {
    if (phase !== "battle" || busy || sim.ended || sim.turn !== "player") return false;
    const pre = sim.fire.bind(sim); // not used; we go through playerFire to also run AI
    // peek validity without mutating: check shots grid
    if (sim.enemy.shots[y][x] !== 0) return false;
    busy = true;
    // Run sim (mutates), then animate sequentially.
    const resp = window.__bs_playerFire(sim, x, y);
    resolveShot("player", resp.player, () => {
      if (sim.ended || !resp.ai) { busy = false; setHUD(); return; }
      setHUD("Enemy firing…");
      resolveShot("enemy", resp.ai, () => { busy = false; setHUD(); });
    });
    return true;
  }

  // pointer input
  let hovered = null;
  const dom = kernel.renderer.domElement;
  dom.style.touchAction = "none";
  dom.addEventListener("pointermove", (ev) => {
    if (phase !== "battle" || busy || sim.ended) return;
    const hits = kernel.raycast(ev.clientX, ev.clientY, cellMeshes);
    if (hovered) { hovered.material.opacity = 0.0; hovered = null; }
    if (hits.length) {
      const c = hits[0].object;
      if (sim.enemy.shots[c.userData.y][c.userData.x] === 0) { c.material.color.set(0xffd166); c.material.opacity = 0.28; hovered = c; }
    }
  });
  dom.addEventListener("pointerdown", (ev) => {
    if (phase !== "battle" || busy || sim.ended) return;
    const hits = kernel.raycast(ev.clientX, ev.clientY, cellMeshes);
    if (hits.length) { const c = hits[0].object; doPlayerFire(c.userData.x, c.userData.y); }
  });

  // Keyboard targeting (a11y) — arrows/WASD move a cursor on enemy waters,
  // Enter/Space fires. Works without a mouse and without focusing the canvas.
  const cellMeshAt = (x, y) => cellMeshes.find((c) => c.userData.x === x && c.userData.y === y);
  const kbCursor = { x: 0, y: 0 };
  function showCursor() {
    cellMeshes.forEach((c) => { if (c !== hovered) c.material.opacity = 0.0; });
    const c = cellMeshAt(kbCursor.x, kbCursor.y);
    if (c && sim.enemy.shots[kbCursor.y][kbCursor.x] === 0) { c.material.color.set(0x66e0ff); c.material.opacity = 0.5; }
  }
  window.addEventListener("keydown", (e) => {
    if (phase !== "battle" || sim.ended || sim.turn !== "player") return;
    const k = e.key;
    const nav = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
    if (nav[k]) {
      e.preventDefault();
      kbCursor.x = Math.max(0, Math.min(size - 1, kbCursor.x + nav[k][0]));
      kbCursor.y = Math.max(0, Math.min(size - 1, kbCursor.y + nav[k][1]));
      if (!busy) showCursor();
    } else if (k === " " || k === "Enter") {
      e.preventDefault();
      if (!busy) doPlayerFire(kbCursor.x, kbCursor.y);
    }
  });

  // ── Game shell: menu / pause / end overlays (DOM, pointer-interactive) ─────
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute", inset: "0", display: "none", alignItems: "center",
    justifyContent: "center", flexDirection: "column", gap: "14px", zIndex: "50",
    background: "rgba(6,14,26,0.84)", color: "#dfeaff", fontFamily: "monospace", textAlign: "center",
  });
  kernel.parent.appendChild(overlay);
  function ovBtn(label, onClick, primary) {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      font: "bold 16px monospace", padding: "10px 22px", cursor: "pointer", minWidth: "160px",
      color: primary ? "#0a1622" : "#dfeaff", background: primary ? "#7CFC9A" : "#1c3148",
      border: "1px solid #3a6c8c", borderRadius: "6px",
    });
    b.onclick = onClick; return b;
  }
  function hideOverlay() { overlay.style.display = "none"; overlay.innerHTML = ""; }
  let chosenDiff = sim.difficulty || "normal";
  function showMenu() {
    phase = "menu"; paused = false; overlay.dataset.end = ""; overlay.innerHTML = "";
    const t = document.createElement("div");
    t.innerHTML = `<div style="font-size:46px;font-weight:bold;letter-spacing:3px">${(content.title || "IRON TIDE").toUpperCase()}</div>
      <div style="font-size:14px;opacity:.8;margin-top:6px">${content.tagline || "Call your salvos. Sink the enemy fleet."}</div>`;
    overlay.appendChild(t);
    const lbl = document.createElement("div"); lbl.textContent = "Difficulty"; lbl.style.cssText = "font-size:12px;opacity:.7;margin-top:6px"; overlay.appendChild(lbl);
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px";
    ["easy", "normal", "hard"].forEach((d) => { const b = ovBtn(d.toUpperCase(), () => { chosenDiff = d; sim.difficulty = d; mark(); }, false); b.dataset.diff = d; b.style.minWidth = "96px"; row.appendChild(b); });
    function mark() { Array.from(row.children).forEach((b) => { b.style.outline = b.dataset.diff === chosenDiff ? "2px solid #7CFC9A" : "none"; }); }
    overlay.appendChild(row); mark();
    overlay.appendChild(ovBtn("▶ PLAY", () => { hideOverlay(); if (music) kernel.playMusic(music, 0.3); beginGame(); }, true));
    overlay.style.display = "flex";
  }
  function showPause() {
    if (phase !== "placement" && phase !== "battle") return;
    paused = true; overlay.innerHTML = "";
    overlay.appendChild(Object.assign(document.createElement("div"), { textContent: "PAUSED", style: "font-size:40px;font-weight:bold" }));
    overlay.appendChild(ovBtn("RESUME", () => { paused = false; hideOverlay(); kernel.start(); }, true));
    overlay.appendChild(ovBtn("RESTART", () => location.reload(), false));
    overlay.style.display = "flex";
    kernel.stop(); // freeze render/physics while paused
  }
  function showEnd(victory) {
    if (overlay.dataset.end === "1") return; overlay.dataset.end = "1";
    phase = "ended"; overlay.innerHTML = "";
    overlay.appendChild(Object.assign(document.createElement("div"), {
      innerHTML: `<div style="font-size:54px;font-weight:bold;color:${victory ? "#7CFC9A" : "#ff5a5a"}">${victory ? "VICTORY" : "DEFEAT"}</div>
        <div style="font-size:14px;opacity:.85;margin-top:8px">${victory ? "Enemy fleet destroyed" : "Your fleet was sunk"} · ${sim.turnNumber} turns</div>`,
    }));
    overlay.appendChild(ovBtn("▶ PLAY AGAIN", () => location.reload(), true));
    overlay.style.display = "flex";
    kernel.stopMusic();
  }
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (paused) { paused = false; hideOverlay(); kernel.start(); }
    else showPause();
  });
  showMenu(); // boot into the title menu

  // ── controller + test hooks ─────────────────────────────────────────────────
  const controller = {
    sim,
    __test: {
      sim,
      menuPlay: () => { hideOverlay(); if (music) kernel.playMusic(music, 0.3); return beginGame(); },
      pause: () => showPause(), resume: () => { paused = false; hideOverlay(); kernel.start(); },
      isPaused: () => paused,
      state: () => ({
        phase: phase, turn: sim.turn, turnNumber: sim.turnNumber, ended: sim.ended, winner: sim.winner,
        playerShips: sim.player.ships.length, playerAlive: sim.alive("player"), enemyAlive: sim.alive("enemy"),
        sceneChildren: scene.children.length,
        cellTargets: cellMeshes.length,
      }),
      // placement-phase hooks for capture/verification
      placeAuto: () => _placement && _placement.autoPlace(),
      placeShipAt: (x, y) => _placement && _placement.commit(x, y),
      // drive logic without animation (instant) for gates/play-bot
      fireInstant: (x, y) => window.__bs_playerFire(sim, x, y),
      // drive the full ANIMATED path (places pegs, plays cinematic) — used by
      // capture.py to grab mid-game frames for the fidelity gate.
      fireAnimated: (x, y) => doPlayerFire(x, y),
      autoPlay: (maxTurns) => {
        let n = 0;
        while (!sim.ended && n++ < (maxTurns || 200)) {
          let pick = null;
          for (let yy = 0; yy < size && !pick; yy++) for (let xx = 0; xx < size; xx++) if (sim.enemy.shots[yy][xx] === 0) { pick = { x: xx, y: yy }; break; }
          if (!pick) break;
          window.__bs_playerFire(sim, pick.x, pick.y);
        }
        return { ended: sim.ended, winner: sim.winner, turns: sim.turnNumber };
      },
      // Play through to a finish (targets every enemy cell), then surface the
      // end screen — verifies the full game reaches VICTORY/DEFEAT.
      playToEnd: () => {
        // Target known enemy ship cells so the player wins promptly (this is a
        // verification hook, not normal play).
        for (const ship of sim.enemy.ships) for (const c of ship.cells) {
          if (sim.ended) break;
          if (sim.enemy.shots[c.y][c.x] === 0) window.__bs_playerFire(sim, c.x, c.y);
        }
        if (sim.ended) showEnd(sim.winner === "player");
        return { ended: sim.ended, winner: sim.winner, turns: sim.turnNumber };
      },
    },
  };
  return controller;
});

// shared helper so the test hook and click path use one code path
window.__bs_playerFire = function (sim, x, y) { return sim.playerFire(x, y); };

// ── tiny canvas text sprite for board labels ──────────────────────────────────
function makeTextSprite(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0)"; ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 34px monospace"; ctx.fillStyle = "#dfeaff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(8, 2, 1);
  return spr;
}
