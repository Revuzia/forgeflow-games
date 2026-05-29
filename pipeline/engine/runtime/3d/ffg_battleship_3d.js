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
  });

  const scene = kernel.scene;
  const boardSpan = size * CELL;

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
      p[i + 1] = Math.sin(x * 0.08 + t * 1.1) * 0.35 + Math.cos(z * 0.11 + t * 0.9) * 0.3;
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

  // place the player's fleet (visible). Enemy fleet stays hidden until sunk.
  for (const ship of sim.player.ships) await placeShip("player", ship);
  label("player", content.title || "YOUR FLEET");
  label("enemy", "ENEMY WATERS");

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
  let camIdle = 0;
  kernel.onUpdate((dt) => { camIdle += dt; kernel.camera.position.x = Math.sin(camIdle * 0.12) * 1.5; kernel.camera.lookAt(0, 0, LOOK_Z); });

  // ── Pegs + effects ─────────────────────────────────────────────────────────
  const pegGeo = new THREE.SphereGeometry(0.5, 12, 12);
  function placePeg(side, x, y, hit) {
    const w = cellWorld(side, x, y);
    const peg = new THREE.Mesh(pegGeo, new THREE.MeshStandardMaterial({ color: hit ? 0xff3b30 : 0xf2f2f2, emissive: hit ? 0x551111 : 0x000000 }));
    peg.position.set(w.x, 0.6, w.z); peg.castShadow = true; scene.add(peg);
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
      ${sim.ended ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:52px;color:${sim.winner === "player" ? "#7CFC9A" : "#ff5a5a"}">${sim.winner === "player" ? "VICTORY" : "DEFEAT"}</div>` : ""}
    `);
  }
  setHUD();

  function resolveShot(side, r, after) {
    const to = cellWorld(side === "player" ? "enemy" : "player", r.x, r.y);
    fireCannonball(side, to, () => {
      if (r.result === "miss") { splash(to); placePeg(side === "player" ? "enemy" : "player", r.x, r.y, false); }
      else { explosion(to); placePeg(side === "player" ? "enemy" : "player", r.x, r.y, true); }
      if (r.result === "sink") {
        const tb = side === "player" ? "enemy" : "player";
        const ship = sim.boardOf(tb).ships.find((s) => s.id === r.ship);
        if (ship) revealAndSink(tb, ship);
      }
      setHUD();
      setTimeout(after, r.result === "sink" ? 900 : 450);
    });
  }

  function doPlayerFire(x, y) {
    if (busy || sim.ended || sim.turn !== "player") return false;
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
    if (busy || sim.ended) return;
    const hits = kernel.raycast(ev.clientX, ev.clientY, cellMeshes);
    if (hovered) { hovered.material.opacity = 0.0; hovered = null; }
    if (hits.length) {
      const c = hits[0].object;
      if (sim.enemy.shots[c.userData.y][c.userData.x] === 0) { c.material.color.set(0xffd166); c.material.opacity = 0.28; hovered = c; }
    }
  });
  dom.addEventListener("pointerdown", (ev) => {
    if (busy || sim.ended) return;
    const hits = kernel.raycast(ev.clientX, ev.clientY, cellMeshes);
    if (hits.length) { const c = hits[0].object; doPlayerFire(c.userData.x, c.userData.y); }
  });

  // ── controller + test hooks ─────────────────────────────────────────────────
  const controller = {
    sim,
    __test: {
      sim,
      state: () => ({
        turn: sim.turn, turnNumber: sim.turnNumber, ended: sim.ended, winner: sim.winner,
        playerAlive: sim.alive("player"), enemyAlive: sim.alive("enemy"),
        sceneChildren: scene.children.length,
        cellTargets: cellMeshes.length,
      }),
      // drive logic without animation (instant) for gates/play-bot
      fireInstant: (x, y) => window.__bs_playerFire(sim, x, y),
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
