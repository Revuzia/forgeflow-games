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
import { Water } from "three/addons/objects/Water.js";
import { Sky } from "three/addons/objects/Sky.js";
// Version-busted so a redeploy never serves a STALE sim (a bare import is cached
// under an unversioned URL — that shipped an old sim with no playerMultiFire, so
// the fire-abilities silently threw in already-loaded browsers).
await import("../sim/battleship.js" + new URL(import.meta.url).search); // sets window.FFG.sim.Battleship

// Import the kernel with the SAME version query the boot entry used, so genre
// registration targets the same kernel module instance the boot uses.
const { register3d } = await import("./ffg_kernel_3d.js" + new URL(import.meta.url).search);

const CELL = 2.4;

register3d("battleship", async function (kernel, content) {
  const Battleship = window.FFG.sim.Battleship;
  const m = content.setup || content;
  const size = m.board_size || 10;
  // ALWAYS random per game (enemy layout, AI targeting, auto-placement differ
  // every playthrough). crypto.getRandomValues is genuine entropy — robust even
  // where Math.random/Date is deterministic per page-load. Gates build their own
  // sim with a fixed rng, so verification stays reproducible.
  const _gameSeed = (function () {
    try { const a = new Uint32Array(1); (self.crypto || window.crypto).getRandomValues(a); return (a[0] >>> 0) || 1; }
    catch (e) { return (((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) || 1; }
  })();
  const sim = new Battleship({
    size: size,
    fleet: m.fleet,
    seed: _gameSeed,
    player_placements: m.player_placements,
    // NEVER use a fixed enemy layout — the content shipped a hardcoded
    // enemy_placements which made the enemy fleet identical every game. null =
    // seeded-random placement, so each match's enemy layout is fresh.
    enemy_placements: null,
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

  // ── Ocean — real reflective water (three.js Water): flowing normal-mapped
  // waves, sun glint, fresnel shine. Flat plane (shader-faked waves), so it
  // never clips the boards. The normal map is bundled in the runtime (NOT a
  // CDN) — a missing normal map collapses the shader to a flat sky-mirror that
  // reads as "blank background", the exact bug this replaced.
  const waterGeo = new THREE.PlaneGeometry(2000, 2000);
  const _texURL = new URL("./textures/waternormals.jpg", import.meta.url).href;
  const water = new Water(waterGeo, {
    textureWidth: 512, textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      _texURL, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }),
    sunDirection: new THREE.Vector3(0.6, 0.8, 0.4),
    sunColor: 0xffe7b3,
    waterColor: 0x0f4a6e,
    distortionScale: 3.4,
    fog: scene.fog !== undefined,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.05;
  water.material.uniforms["size"].value = 4.0; // finer, more frequent waves on our scale
  scene.add(water);
  kernel.onUpdate((dt) => { water.material.uniforms["time"].value += dt * 0.8; });

  // Sky + sun — a real procedural sky for the water to reflect (late-afternoon
  // clear tone, not a hazy white-out) plus a proper sun glint. Drives the
  // water's sunDirection. Exposure pulled back so neither sky nor sea blows out.
  kernel.renderer.toneMappingExposure = 0.62;
  const sky = new Sky();
  sky.scale.setScalar(14000);
  scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU["turbidity"].value = 4.0;
  skyU["rayleigh"].value = 1.4;
  skyU["mieCoefficient"].value = 0.004;
  skyU["mieDirectionalG"].value = 0.85;
  const sunPos = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - 24);   // sun elevation ~24° (afternoon)
  const theta = THREE.MathUtils.degToRad(150);
  sunPos.setFromSphericalCoords(1, phi, theta);
  skyU["sunPosition"].value.copy(sunPos);
  water.material.uniforms["sunDirection"].value.copy(sunPos).normalize();
  if (kernel.sun) kernel.sun.position.copy(sunPos).multiplyScalar(120); // match shadow light to the sun
  scene.fog = null; // let the sky show on the horizon

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
  function makeBoard(side, tint, rimColor) {
    const g = new THREE.Group();
    const o = boardOrigin(side);
    const cx = o.x + boardSpan / 2, cz = o.z + boardSpan / 2;
    // Translucent tactical surface — the living sea shows through, so the board
    // reads as a lit "zone of the ocean", not a dead opaque panel floating on it.
    const surf = new THREE.Mesh(
      new THREE.PlaneGeometry(boardSpan, boardSpan),
      new THREE.MeshStandardMaterial({
        color: tint, transparent: true, opacity: 0.5, roughness: 0.45, metalness: 0.15,
        emissive: tint, emissiveIntensity: 0.18, side: THREE.DoubleSide, depthWrite: false,
      }));
    surf.rotation.x = -Math.PI / 2; surf.position.set(cx, 0.16, cz); surf.receiveShadow = true; g.add(surf);
    // Glowing tactical grid (unlit lines read at full colour regardless of light).
    const grid = new THREE.GridHelper(boardSpan, size,
      side === "player" ? 0x8fefff : 0xffc070,
      side === "player" ? 0x3f7da0 : 0x9a5a36);
    grid.material.transparent = true; grid.material.opacity = 0.92; grid.material.depthWrite = false;
    grid.position.set(cx, 0.2, cz); g.add(grid);
    // Beveled gunmetal rim — frames the zone so it reads as a deliberate object.
    const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, metalness: 0.85, roughness: 0.35, emissive: rimColor, emissiveIntensity: 0.06 });
    const T = 0.5, H = 0.55, L = boardSpan + T * 2;
    const mkBar = (w, d, px, pz) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), rimMat); b.position.set(px, 0.18, pz); b.castShadow = true; b.receiveShadow = true; g.add(b); };
    mkBar(L, T, cx, cz - boardSpan / 2 - T / 2);
    mkBar(L, T, cx, cz + boardSpan / 2 + T / 2);
    mkBar(T, boardSpan, cx - boardSpan / 2 - T / 2, cz);
    mkBar(T, boardSpan, cx + boardSpan / 2 + T / 2, cz);
    scene.add(g);
    return g;
  }
  makeBoard("player", 0x103f58, 0x2b3540);
  makeBoard("enemy", 0x5a1f2a, 0x3c2b2b);

  // Big board title sprite, seated just off the outer edge (not floating mid-air).
  function label(side, text) {
    const c = cellWorld(side, (size - 1) / 2, side === "player" ? size + 1.1 : -2.1);
    const sprite = makeTextSprite(text, { glow: side === "player" ? "#8fefff" : "#ffc070" });
    sprite.position.set(c.x, 1.4, c.z);
    scene.add(sprite);
  }

  // Coordinate labels (A–J across the front, 1–10 down the left edge) — standard
  // Battleship, and a real usability win for calling/reading shots.
  const COLS = "ABCDEFGHIJ".split("");
  function coordLabels(side) {
    const o = boardOrigin(side);
    const col = side === "player" ? "#bfe6ff" : "#ffd9b0";
    for (let x = 0; x < size; x++) {
      const w = cellWorld(side, x, 0);
      const s = makeTextSprite(COLS[x], { sx: 1.5, sy: 1.5, color: col, font: "bold 40px monospace" });
      s.position.set(w.x, 0.55, o.z - 1.0); scene.add(s);
    }
    for (let y = 0; y < size; y++) {
      const w = cellWorld(side, 0, y);
      const s = makeTextSprite(String(y + 1), { sx: 1.5, sy: 1.5, color: col, font: "bold 40px monospace" });
      s.position.set(o.x - 1.0, 0.55, w.z); scene.add(s);
    }
  }
  coordLabels("player"); coordLabels("enemy");

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
    // Fit the model to its ACTUAL footprint: a length-N ship must visibly span
    // N cells along its axis and ~1 cell across. The long and short axes are
    // scaled INDEPENDENTLY (warships are long + narrow, so this reads naturally)
    // so a "5" really fills 5 squares. The old uniform scale used 62% of the
    // length AND a width clamp, collapsing every hull to ~2 cells regardless of
    // its claimed size — the bug this fixes.
    const box0 = new THREE.Box3().setFromObject(obj);
    const dim = box0.getSize(new THREE.Vector3());
    const longIsX = dim.x >= dim.z;
    const footLong = ship.len * CELL * 0.94; // ~94% of len cells (thin gutter)
    const footShort = CELL * 0.84;           // ~84% of one cell across
    let sx, sz, rotY = 0;
    if (ship.horizontal) {                    // long axis runs along world X
      if (longIsX) { rotY = 0;           sx = footLong / dim.x; sz = footShort / dim.z; }
      else         { rotY = Math.PI / 2; sz = footLong / dim.z; sx = footShort / dim.x; }
    } else {                                  // long axis runs along world Z
      if (longIsX) { rotY = Math.PI / 2; sx = footLong / dim.x; sz = footShort / dim.z; }
      else         { rotY = 0;           sz = footLong / dim.z; sx = footShort / dim.x; }
    }
    obj.scale.set(sx, (sx + sz) / 2, sz);
    obj.rotation.y = rotY;
    // Recenter on the cell span and seat the hull on the surface — the model's
    // pivot isn't its centroid, so position by the post-transform AABB.
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(obj);
    const ctr = box1.getCenter(new THREE.Vector3());
    obj.position.set(center.x - ctr.x, 0.2 - box1.min.y, center.z - ctr.z);
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

  label("player", "YOUR FLEET");
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
    // Concise contextual prompt only — full rules/controls live in How-to-Play.
    kernel.hud(`<div style="position:absolute;top:10px;left:12px;font-size:15px"><b>${content.title || "Iron Tide"}</b></div>
      <div style="position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:14px">
        ${spec ? `Place your <b>${spec.name}</b> <span style="opacity:.7">(${spec.len})</span> &nbsp;·&nbsp; <b>R</b> rotate &nbsp; <b>A</b> auto-place` : "Ready"}
      </div>
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
    kernel.playSound(sfx.fire, 0.55);
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
  beginGame = () => { if (typeof orbit !== "undefined" && orbit) orbit.autoRotate = false; if (placementEnabled) beginPlacement(); else beginBattleDirect(); };
  {
    const dom0 = kernel.renderer.domElement;
    // Hover preview only (the ghost). Clicks are handled by the unified
    // click-vs-drag detector below so dragging rotates the camera, not fires.
    dom0.addEventListener("pointermove", (ev) => { if (phase !== "placement" || paused) return; const h = kernel.raycast(ev.clientX, ev.clientY, playerCells); if (h.length) showGhost(h[0].object.userData.x, h[0].object.userData.y); });
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
  kernel.camera.fov = 42;
  kernel.camera.updateProjectionMatrix();
  // Tighter default framing: both boards fill the frame with little dead water,
  // player board in the foreground (target biased toward +z).
  kernel.camera.position.set(0, boardSpan * 1.35, boardSpan * 1.62);
  const LOOK_Z = boardSpan * 0.06;
  // Camera: RIGHT-drag rotates, WASD glides across the battlefield, scroll zooms
  // (left click stays free to fire). Wide range so you can pull back and survey
  // the full enemy fleet / both boards in a landscape view.
  const orbit = kernel.enableOrbit({
    target: { x: 0, y: 0, z: LOOK_Z },
    minDistance: boardSpan * 0.55, maxDistance: boardSpan * 4.2,
    minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.47,
    rotateButton: "right", wasdPan: true, panSpeed: boardSpan * 1.1,
    autoRotate: true, autoRotateSpeed: 0.5,
  });
  const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (reducedMotion) orbit.autoRotate = false;

  // ── Pegs + effects ─────────────────────────────────────────────────────────
  // Colorblind-safe markers: differ by SHAPE, not just colour.
  //   hit  = stubby glowing-red peg + hot impact disc   miss = white disc + ring
  // Both are sized/lit to POP against the dark translucent board — the previous
  // markers were tiny and dark and got lost on the enemy grid.
  const hitGeo = new THREE.ConeGeometry(0.4, 0.7, 18);
  function placePeg(side, x, y, hit) {
    const w = cellWorld(side, x, y);
    if (hit) {
      const peg = new THREE.Mesh(hitGeo, new THREE.MeshStandardMaterial({ color: 0xff4334, emissive: 0xff2a18, emissiveIntensity: 0.95, roughness: 0.45 }));
      peg.position.set(w.x, 0.5, w.z); peg.castShadow = true; scene.add(peg);
      // Hot impact disc — flat additive glow on the cell so the hit reads from any angle.
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24),
        new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(w.x, 0.27, w.z); scene.add(glow);
    } else {
      // White peg DOME (rounded) — distinct shape from the pointed red hit
      // (colorblind-safe) and reads from any angle, unlike a flat disc.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0x9fc4e6, emissiveIntensity: 0.6, roughness: 0.3 }));
      dome.position.set(w.x, 0.32, w.z); dome.castShadow = true; scene.add(dome);
      // Cool glow disc so a miss reads at distance too (the hit has a hot one).
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.66, 24),
        new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(w.x, 0.27, w.z); scene.add(glow);
    }
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
  // Persistent damage: a smouldering scorch + slow rising smoke at a hit cell,
  // so a hit reads as a hit (enemy ships are hidden, so the marker must carry
  // it). When the hit lands on a VISIBLE ship (the player's own fleet) we raise
  // it to deck height and add a blown-out "hole" (dark recessed disc), a glowing
  // ember + fire light, and a longer-burning smoke column so it reads as a
  // damaged, smoking hull — not just a scorch on the water.
  function spawnSmokePuff(pos, dark) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35 + Math.random() * 0.25, 8, 8),
      new THREE.MeshStandardMaterial({ color: dark ? 0x2a2a2a : 0x4a4a4a, transparent: true, opacity: 0.6, depthWrite: false }));
    puff.position.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.4, pos.z + (Math.random() - 0.5) * 0.6);
    scene.add(puff);
    const dur = 2.6 + Math.random() * 1.6;
    kernel.tween({ target: puff.position, to: { y: puff.position.y + 4.2 }, duration: dur });
    kernel.tween({ target: puff.scale, to: { x: 2.4, y: 2.4, z: 2.4 }, duration: dur });
    kernel.tween({ target: puff.material, to: { opacity: 0 }, duration: dur, onComplete: () => scene.remove(puff) });
  }
  function damageMarker(pos, onShip) {
    const y = onShip ? 0.62 : 0.4;
    // Blown-out hole: a dark recessed disc reads as a hull breach / scorch crater.
    const hole = new THREE.Mesh(new THREE.CircleGeometry(onShip ? 0.42 : 0.55, 18),
      new THREE.MeshBasicMaterial({ color: 0x0a0604, transparent: true, opacity: 0.92 }));
    hole.rotation.x = -Math.PI / 2; hole.position.set(pos.x, y, pos.z); scene.add(hole);
    if (onShip) {
      // Charred lip around the hole + a glowing ember + firelight in the breach.
      const lip = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 18),
        new THREE.MeshBasicMaterial({ color: 0x21130b, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      lip.rotation.x = -Math.PI / 2; lip.position.set(pos.x, y + 0.01, pos.z); scene.add(lip);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xff6320 }));
      ember.position.set(pos.x, y + 0.08, pos.z); scene.add(ember);
      let emT = 0; const emU = (dt) => { emT += dt; ember.material.color.setHSL(0.05, 1, 0.45 + 0.12 * Math.sin(emT * 9)); };
      kernel.onUpdate(emU);
      const fire = new THREE.PointLight(0xff7a2a, 2.2, 8); fire.position.set(pos.x, y + 0.6, pos.z); scene.add(fire);
      // Burning column: re-emit puffs for a few seconds, not one burst.
      let n = 0; const iv = setInterval(() => { if (n++ > 9) { clearInterval(iv); return; } spawnSmokePuff({ x: pos.x, y: y, z: pos.z }, true); }, 380);
    } else {
      for (let i = 0; i < 3; i++) spawnSmokePuff({ x: pos.x, y: y + i * 0.25, z: pos.z }, false);
    }
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
    const pip = (bg, glow) => `<span style="display:inline-block;width:9px;height:9px;margin:0 1.5px;border-radius:2px;background:${bg};box-shadow:${glow ? "0 0 5px " + glow : "none"}"></span>`;
    // Your fleet: per-cell damage (you know your own ships).
    const mine = ps.map((s) => {
      let cells = ""; for (let i = 0; i < s.len; i++) cells += pip(s.sunk ? "#7a2020" : i < s.hits ? "#ff5a5a" : "#7CFC9A", s.sunk ? null : i < s.hits ? "#ff5a5a" : "#7CFC9A");
      return `<div style="margin:2px 0;${s.sunk ? "opacity:.45" : ""}"><span style="font-size:10px;opacity:.75;display:inline-block;width:66px;text-align:right;margin-right:7px">${s.name}${s.sunk ? " ✖" : ""}</span>${cells}</div>`;
    }).join("");
    // Enemy fleet: one pip per ship (afloat/sunk) — don't leak their layout.
    const foe = es.map((s) => pip(s.sunk ? "#7a2020" : "#9fb4c8", s.sunk ? null : "#9fb4c8")).join("");
    const foeSunk = es.filter((s) => s.sunk).length;
    const playerTurn = sim.turn === "player";
    let banner = msg || (playerTurn ? "Your move — click enemy waters" : "Enemy firing…");
    let bc = playerTurn ? "#7CFC9A" : "#ffb454";
    if (armed) { banner = "ARMED: " + ABILITY[armed].label + " — click a target (Esc to cancel)"; bc = ABILITY[armed].color; }
    kernel.hud(`
      <div style="position:absolute;top:12px;left:14px;font-family:'Segoe UI',system-ui,monospace">
        <div style="font-size:19px;font-weight:800;letter-spacing:2px;text-shadow:0 2px 10px #000">${content.title || "Iron Tide"}</div>
        <div style="margin-top:7px;display:inline-block;background:rgba(8,18,32,.72);border:1px solid ${bc}55;border-left:3px solid ${bc};border-radius:4px;padding:5px 13px;font-size:13px">
          <span style="opacity:.7">Turn ${sim.turnNumber}</span> &nbsp;·&nbsp; <span style="color:${bc};font-weight:700">${banner}</span>
        </div>
      </div>
      <div style="position:absolute;top:12px;right:14px;font-family:'Segoe UI',system-ui,monospace;background:rgba(8,18,32,.62);border:1px solid #2a4458;border-radius:9px;padding:9px 13px;text-align:right">
        <div style="font-size:10px;letter-spacing:1.5px;opacity:.7">ENEMY FLEET <span style="color:#ffb454;opacity:.85">[${(sim.difficulty || "normal").toUpperCase()}]</span> <span style="opacity:.6">${foeSunk}/${es.length} sunk</span></div>
        <div style="margin:3px 0 7px">${foe}</div>
        <div style="font-size:10px;letter-spacing:1.5px;opacity:.7;text-align:left">YOUR FLEET</div>
        <div style="text-align:left;margin-top:2px">${mine}</div>
      </div>
      <div style="position:absolute;bottom:10px;left:14px;font-size:11px;opacity:.55;font-family:monospace">Right-drag: rotate · WASD: move · Scroll: zoom · Esc: pause</div>
    `);
  }
  if (phase === "battle") setHUD(); // placement phase keeps its own HUD until Ready

  // ── Upgrade-on-sink abilities ────────────────────────────────────────────────
  // Sinking an enemy ship awards a one-use ability. Bigger hull = bigger upgrade.
  // A COMBO meter scales potency and is ORDER-SENSITIVE (each successive sink is
  // worth more), so sinking 5→2 differs from 2→5.
  const ABILITY = {
    scan:    { label: "RECON SCAN", color: "#5fd0ff" },
    barrage: { label: "BARRAGE",    color: "#ff7a3c" },
    salvo:   { label: "SALVO",      color: "#ffd166" },
    sonar:   { label: "SONAR PING", color: "#7CFC9A" },
    double:  { label: "DOUBLE TAP", color: "#c9a0ff" },
  };
  const SHIP_ABILITY = { carrier: "scan", battleship: "barrage", cruiser: "salvo", submarine: "sonar", destroyer: "double" };
  const ammo = { scan: 0, barrage: 0, salvo: 0, sonar: 0, double: 0 };
  let comboPower = 0, comboChain = 0, armed = null;
  let enemyCharges = 0; // banked bonus shots the AI earns by sinking your ships
  const salvoShots = () => Math.max(2, Math.min(6, 2 + Math.floor(comboPower / 6)));
  const scanR = () => (comboPower >= 14 ? 2 : 1);

  // bottom ability bar (own DOM layer so setHUD()'s innerHTML reset can't wipe it)
  const abilityBarEl = document.createElement("div");
  Object.assign(abilityBarEl.style, { position: "absolute", left: "0", right: "0", bottom: "44px", display: "flex", justifyContent: "center", gap: "8px", pointerEvents: "none", fontFamily: "'Segoe UI',system-ui,monospace", zIndex: "50" });
  kernel.parent.appendChild(abilityBarEl);

  // Whoever sinks a ship earns an upgrade. The player banks usable abilities; the
  // AI banks bonus shots (bigger hull sunk = more), so the enemy gets stronger as
  // it sinks your fleet — symmetric escalation.
  function grantUpgrade(ship, side) {
    if (side === "enemy") {
      // Difficulty makes the enemy's salvage tangibly different: EASY enemies
      // squander it (no bonus), NORMAL bank it, HARD weaponise it harder.
      const mult = sim.difficulty === "hard" ? 1.6 : sim.difficulty === "easy" ? 0 : 1;
      const gained = Math.round((ship.len >= 5 ? 3 : ship.len >= 4 ? 2 : 1) * mult);
      enemyCharges += gained;
      if (gained > 0) flashToast(ship.name + " lost — enemy salvages a SALVO", "#ff6a5a");
      return;
    }
    const ab = SHIP_ABILITY[ship.id] || "salvo";
    ammo[ab] = (ammo[ab] || 0) + 1;
    comboChain++; comboPower += ship.len * (1 + 0.25 * (comboChain - 1));
    flashUpgrade(ab, ship);
    renderAbilityBar();
  }
  function flashToast(text, color) {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, { position: "absolute", left: "0", right: "0", top: "30%", textAlign: "center", color: color || "#eaf3ff", fontFamily: "'Segoe UI',monospace", fontSize: "20px", fontWeight: "700", textShadow: "0 2px 10px #000", pointerEvents: "none", zIndex: "55", transition: "opacity .5s", opacity: "0" });
    kernel.parent.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = "1"; });
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 500); }, 1400);
  }
  function renderAbilityBar() {
    const keys = Object.keys(ABILITY).filter((k) => ammo[k] > 0);
    if (!keys.length) { abilityBarEl.innerHTML = ""; return; }
    const meter = comboPower > 0 ? `<span style="align-self:center;font-size:11px;letter-spacing:1px;color:#ffd166;margin-right:4px">COMBO ${comboPower.toFixed(0)}</span>` : "";
    abilityBarEl.innerHTML = meter + keys.map((k) => {
      const on = armed === k, c = ABILITY[k].color;
      return `<button data-ab="${k}" style="pointer-events:auto;font:bold 12px 'Segoe UI',monospace;letter-spacing:1px;padding:7px 12px;border-radius:7px;cursor:pointer;color:${on ? "#06101c" : c};background:${on ? c : "rgba(10,20,34,.82)"};border:1px solid ${c};box-shadow:${on ? "0 0 12px " + c : "none"}">${ABILITY[k].label} <b>×${ammo[k]}</b></button>`;
    }).join("");
    Array.prototype.forEach.call(abilityBarEl.querySelectorAll("button"), (b) => { b.onclick = () => armAbility(b.dataset.ab); });
  }
  function armAbility(k) { if (!ammo[k] || busy || phase !== "battle") return; armed = (armed === k) ? null : k; renderAbilityBar(); setHUD(); }
  function flashUpgrade(ab, ship) {
    const el = document.createElement("div");
    el.innerHTML = `<div style="font-size:13px;opacity:.85">${ship.name} sunk — upgrade acquired</div><div style="font-size:26px;font-weight:800;color:${ABILITY[ab].color};text-shadow:0 2px 10px #000">${ABILITY[ab].label}</div>`;
    Object.assign(el.style, { position: "absolute", left: "0", right: "0", top: "38%", textAlign: "center", color: "#eaf3ff", fontFamily: "'Segoe UI',monospace", pointerEvents: "none", zIndex: "55", transition: "opacity .5s,transform .5s", opacity: "0", transform: "translateY(8px)" });
    kernel.parent.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 500); }, 1500);
  }

  // cell helpers (enemy board)
  const _unshot = (x, y) => x >= 0 && y >= 0 && x < size && y < size && sim.enemy.shots[y][x] === 0;
  function areaCells(x, y, r) { const a = []; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < size && ny < size) a.push({ x: nx, y: ny }); } return a; }
  function rowCells(y) { const a = []; for (let x = 0; x < size; x++) a.push({ x, y }); return a; }
  function plusCells(x, y) { return [{ x, y }, { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }].filter((c) => _unshot(c.x, c.y)); }
  function pickUnshot(x, y, n) {
    const all = []; for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) if (_unshot(xx, yy)) all.push({ x: xx, y: yy });
    all.sort((a, b) => (Math.abs(a.x - x) + Math.abs(a.y - y)) - (Math.abs(b.x - x) + Math.abs(b.y - y)));
    return all.slice(0, n);
  }
  function revealIntel(cells) {
    let found = 0;
    cells.forEach((c) => {
      if (!_unshot(c.x, c.y)) return;
      const hasShip = sim.enemy.ships.some((s) => !s.sunk && s.cells.some((cc) => cc.x === c.x && cc.y === c.y));
      const w = cellWorld("enemy", c.x, c.y);
      const m = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.32, 4), new THREE.MeshBasicMaterial({ color: hasShip ? 0xff4d4d : 0x66ccff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4; m.position.set(w.x, 0.4, w.z); scene.add(m);
      kernel.tween({ target: m.material, to: { opacity: hasShip ? 0.95 : 0.35 }, duration: 0.4 });
      if (hasShip) {
        found++;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.55 }));
        beam.position.set(w.x, 1.6, w.z); scene.add(beam);
        kernel.tween({ target: beam.material, to: { opacity: 0 }, duration: 1.3, onComplete: () => scene.remove(beam) });
      }
    });
    kernel.playSound(sfx.miss, 0.4);
    return found;
  }
  function animateResults(resp) {
    const pr = resp.player || []; let i = 0;
    const nextP = () => { if (i >= pr.length) return afterP(); resolveShot("player", pr[i++], nextP); };
    const afterP = () => { if (sim.ended || !resp.ai) { busy = false; setHUD(); return; } setHUD("Enemy firing…"); resolveShot("enemy", resp.ai, () => { runEnemyBonus(() => { busy = false; setHUD(); if (sim.ended) showEnd(sim.winner === "player"); }); }); };
    nextP();
  }
  function useAbilityAt(x, y) {
    const k = armed; if (!k || !ammo[k] || busy || phase !== "battle" || sim.ended || sim.turn !== "player") return false;
    if (k === "scan" || k === "sonar") { // intel only — does not consume a turn
      ammo[k]--; armed = null;
      revealIntel(k === "sonar" ? rowCells(y) : areaCells(x, y, scanR()));
      renderAbilityBar(); setHUD(); return true;
    }
    let cells;
    if (k === "barrage") cells = plusCells(x, y);
    else if (k === "double") cells = pickUnshot(x, y, 2);
    else cells = pickUnshot(x, y, salvoShots());
    if (!cells.length) return false;
    ammo[k]--; armed = null; busy = true; renderAbilityBar();
    animateResults(sim.playerMultiFire(cells));
    return true;
  }

  function resolveShot(side, r, after) {
    const to = cellWorld(side === "player" ? "enemy" : "player", r.x, r.y);
    kernel.playSound(sfx.fire, 0.9); // gun report on launch
    fireCannonball(side, to, () => {
      // Fail-safe: a VFX exception must NEVER strand the turn (the enemy-impact
      // freeze). Whatever happens, `after` always runs so `busy` is released.
      try {
        if (r.result === "miss") { splash(to); placePeg(side === "player" ? "enemy" : "player", r.x, r.y, false); kernel.playSound(sfx.miss, 0.5); }
        else { explosion(to); damageMarker(to, side === "enemy"); placePeg(side === "player" ? "enemy" : "player", r.x, r.y, true); kernel.playSound(sfx.hit, 0.6); }
        if (r.result === "sink") {
          const tb = side === "player" ? "enemy" : "player";
          const ship = sim.boardOf(tb).ships.find((s) => s.id === r.ship);
          if (ship) revealAndSink(tb, ship);
          kernel.playSound(sfx.sink, 0.7);
          // Salvage: whoever sinks a ship earns a one-use ability (player AND AI).
          if (ship) grantUpgrade(ship, side);
        }
        setHUD();
        if (sim.ended) showEnd(sim.winner === "player");
      } catch (e) { console.error("[battleship] resolveShot VFX error (recovered):", e); }
      setTimeout(after, reducedMotion ? 50 : (r.result === "sink" ? 900 : 450));
    });
  }

  // The enemy cashes its banked salvage (bonus shots) after its normal shot.
  function runEnemyBonus(done) {
    if (enemyCharges <= 0 || sim.ended) { done(); return; }
    const k = Math.min(enemyCharges, 2); enemyCharges -= k;
    const shots = sim.aiBonusShots(k);
    if (!shots.length) { done(); return; }
    flashToast("ENEMY SALVO! ×" + shots.length, "#ff6a5a");
    let i = 0;
    const next = () => { if (i >= shots.length) { done(); return; } resolveShot("enemy", shots[i++], next); };
    next();
  }
  function doPlayerFire(x, y) {
    if (phase !== "battle" || busy || sim.ended || sim.turn !== "player") return false;
    // peek validity without mutating: check shots grid
    if (sim.enemy.shots[y][x] !== 0) return false;
    busy = true;
    // Run sim (mutates), then animate sequentially.
    const resp = window.__bs_playerFire(sim, x, y);
    resolveShot("player", resp.player, () => {
      if (sim.ended || !resp.ai) { busy = false; setHUD(); return; }
      setHUD("Enemy firing…");
      resolveShot("enemy", resp.ai, () => {
        runEnemyBonus(() => { busy = false; setHUD(); if (sim.ended) showEnd(sim.winner === "player"); });
      });
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
  // Unified click-vs-drag: a drag rotates the orbit camera; a click (little
  // movement) acts on the board (place in placement, fire in battle).
  let _down = null;
  dom.addEventListener("pointerdown", (ev) => { _down = { x: ev.clientX, y: ev.clientY, button: ev.button }; });
  dom.addEventListener("pointerup", (ev) => {
    if (!_down) return;
    const moved = Math.hypot(ev.clientX - _down.x, ev.clientY - _down.y);
    const wasLeft = _down.button === 0;
    _down = null;
    if (!wasLeft || moved > 6 || paused) return; // right/middle = camera; drag = rotate — ignore
    if (phase === "placement") {
      const h = kernel.raycast(ev.clientX, ev.clientY, playerCells);
      if (h.length) commit(h[0].object.userData.x, h[0].object.userData.y);
    } else if (phase === "battle" && !busy && !sim.ended) {
      const h = kernel.raycast(ev.clientX, ev.clientY, cellMeshes);
      if (h.length) {
        const cx = h[0].object.userData.x, cy = h[0].object.userData.y;
        if (armed) useAbilityAt(cx, cy); else doPlayerFire(cx, cy);
      }
    }
  });

  // Keyboard targeting (a11y) — ARROW keys move a cursor on enemy waters,
  // Enter/Space fires (or triggers the armed ability). WASD is reserved for the
  // camera now, so the cursor uses arrows only. Number keys 1-5 arm abilities,
  // Esc cancels an armed ability.
  const cellMeshAt = (x, y) => cellMeshes.find((c) => c.userData.x === x && c.userData.y === y);
  const kbCursor = { x: 0, y: 0 };
  function showCursor() {
    cellMeshes.forEach((c) => { if (c !== hovered) c.material.opacity = 0.0; });
    const c = cellMeshAt(kbCursor.x, kbCursor.y);
    if (c && sim.enemy.shots[kbCursor.y][kbCursor.x] === 0) { c.material.color.set(0x66e0ff); c.material.opacity = 0.5; }
  }
  window.addEventListener("keydown", (e) => {
    if (phase !== "battle" || sim.ended) return;
    const k = e.key;
    if (k === "Escape" && armed) { armed = null; renderAbilityBar(); setHUD(); e.stopImmediatePropagation(); e.preventDefault(); return; } // disarm only — don't let the shell pause
    // number keys 1-5 arm the earned abilities, in display order
    if (/^[1-5]$/.test(k)) {
      const earned = Object.keys(ABILITY).filter((a) => ammo[a] > 0);
      const pick = earned[parseInt(k, 10) - 1];
      if (pick) { e.preventDefault(); armAbility(pick); }
      return;
    }
    if (sim.turn !== "player") return;
    const nav = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (nav[k]) {
      e.preventDefault();
      kbCursor.x = Math.max(0, Math.min(size - 1, kbCursor.x + nav[k][0]));
      kbCursor.y = Math.max(0, Math.min(size - 1, kbCursor.y + nav[k][1]));
      if (!busy) showCursor();
    } else if (k === " " || k === "Enter") {
      e.preventDefault();
      if (!busy) { if (armed) useAbilityAt(kbCursor.x, kbCursor.y); else doPlayerFire(kbCursor.x, kbCursor.y); }
    }
  });

  // ── Standard game shell (menu / pause / win-lose / music) — engine-provided.
  // The genre only supplies hooks; FFG.Shell renders the rest the same for every
  // game (2D or 3D).
  const shell = new FFG.Shell({
    parent: kernel.parent,
    title: content.title || "Iron Tide",
    tagline: content.tagline || "Call your salvos. Sink the enemy fleet.",
    music: music,
    menuImage: (content.assets && content.assets.menu_image) || content.menu_image || null,
    difficulties: ["easy", "normal", "hard"],
    defaultDifficulty: sim.difficulty || "normal",
    howTo: [
      { h: "GOAL", p: "Sink the enemy's entire fleet before they sink yours. Each ship occupies a row of cells; sink one by hitting every cell it covers." },
      { h: "YOUR FLEET", p: "Carrier (5) · Battleship (4) · Cruiser (3) · Submarine (3) · Destroyer (2)." },
      { h: "PLACING SHIPS", p: "Click a cell on your waters to drop the current ship. Press <b>R</b> to rotate it, or <b>A</b> to auto-place the rest of the fleet." },
      { h: "FIRING", p: "On your turn, left-click a cell on the enemy waters (the far board) to fire. A red marker means a hit, a white disc a miss. Hit ships smoke and burn; a sunk ship rolls under." },
      { h: "UPGRADES", p: "Sink an enemy ship to earn a one-use ability — the bigger the hull, the bigger the upgrade (Carrier → Recon Scan, Battleship → Barrage, Cruiser → Salvo, Submarine → Sonar, Destroyer → Double Tap). A COMBO meter scales their power, and sink ORDER matters. Click an ability in the bottom bar (or press 1–5) to arm it, then click a target." },
      { h: "CAMERA", p: "<b>Right-drag</b> to rotate, <b>WASD</b> to move around, scroll to zoom — survey the whole battlefield. Press <b>Esc</b> to pause." },
    ],
    onPlay: (diff) => { sim.difficulty = diff; beginGame(); },
    onPause: () => { paused = true; kernel.stop(); },
    onResume: () => { paused = false; kernel.start(); },
  });
  function showEnd(victory) {
    shell.end(victory, (victory ? "Enemy fleet destroyed" : "Your fleet was sunk") + " · " + sim.turnNumber + " turns");
  }
  shell.start(); // boot into the title menu

  // ── controller + test hooks ─────────────────────────────────────────────────
  const controller = {
    sim, shell,
    __test: {
      sim,
      start: () => { shell.hide(); shell.phase = "playing"; shell._playMusic(); return beginGame(); },
      menuPlay: () => { shell.hide(); shell.phase = "playing"; shell._playMusic(); return beginGame(); },
      pause: () => shell.pause(), resume: () => shell.resume(),
      isPaused: () => shell.phase === "paused",
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
      // abilities (verification)
      abilityState: () => ({ ammo: { ...ammo }, comboPower: +comboPower.toFixed(1), comboChain, armed }),
      grantTestUpgrade: (shipId) => { const s = sim.enemy.ships.find((z) => z.id === shipId) || sim.enemy.ships[0]; grantUpgrade(s); return { ...ammo }; },
      armAbility: (k) => armAbility(k),
      useAbilityAt: (x, y) => useAbilityAt(x, y),
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
      // Standard cross-genre hook (alias of playToEnd) for the feel gate.
      autoResolve: () => controller.__test.playToEnd(),
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
function makeTextSprite(text, opts) {
  opts = opts || {};
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = opts.font || "bold 34px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = 14; }
  ctx.fillStyle = opts.color || "#eaf3ff";
  ctx.fillText(text, 128, 32);
  if (opts.glow) { ctx.shadowBlur = 0; ctx.fillText(text, 128, 32); } // double-pass for a crisp glowing core
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(opts.sx != null ? opts.sx : 8, opts.sy != null ? opts.sy : 2, 1);
  return spr;
}
