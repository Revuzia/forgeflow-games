/**
 * FFG runtime — 3d/ffg_navalfree3d.js  (ES module)
 * Render + input + CINEMATIC layer for FREE-MOVEMENT turn-based naval combat
 * ("Tide Breakers"). Binds the pure sim (FFG.sim.NavalFree) to a three.js scene:
 * open reflective ocean (no grid), ships placed by (x,y,heading) using the REUSED
 * iron-tide ship GLBs, a click-driven MOVE preview (reachable disc + heading
 * arrow + destination ghost), a FIRE control (range/arc gizmo + click an enemy in
 * arc), per-shot cannonball arc -> splash/explosion, founder-and-sink, a DOM turn
 * HUD, an "End Turn" flow, and a VISIBLE AI turn (its ships drive + fire on
 * screen). Registers genre "navalfree" into the 3D kernel registry.
 *
 * Shading standard: a real procedural Sky drives the sun + provides an IBL
 * environment (PMREM) so PBR hulls (metalness/low roughness) catch the dusk sky —
 * the kernel has no setEnvironment(), so we build the env map here and assign
 * scene.environment, which is the same outcome. AgX isn't available in three
 * r0.172's tone-mapping enum; the kernel default is ACESFilmic, which we keep and
 * tune the exposure on for a cinematic dusk sea.
 *
 * Exposes controller.__test so the smoke/signature checks can drive it headlessly.
 */
import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { Sky } from "three/addons/objects/Sky.js";
// Version-busted import so a redeploy never serves a STALE sim (a bare import is
// cached under an unversioned URL).
await import("../sim/navalfree.js" + new URL(import.meta.url).search); // sets window.FFG.sim.NavalFree

// Import the kernel with the SAME version query the boot entry used, so genre
// registration targets the same kernel module instance the boot uses.
const { register3d } = await import("./ffg_kernel_3d.js" + new URL(import.meta.url).search);

// Procedural OPEN-OCEAN ambient — UNIQUE to this game (the studio never duplicates
// music across games); replaces the shared music.ogg the shell used to loop.
const { createNavalMusic } = await import("./ffg_navalmusic.js" + new URL(import.meta.url).search);

// World->scene scale: sim units are ~0..220; we render at 1 sim-unit = 1 scene-unit
// but the camera/lighting are tuned for that span. Y up; sim (x,y) maps to scene
// (x, 0, y) so "north" (sim -Y) is -Z (away from the default camera).
const S = 1.0;

register3d("navalfree", async function (kernel, content) {
  const NavalFree = window.FFG.sim.NavalFree;
  const m = content.setup || content;
  const sfx = content.sfx || {};
  const music = (content.audio && content.audio.music) || null; // (legacy file track — superseded by navalMusic)
  const navalMusic = createNavalMusic(0.15); // procedural; unique across the studio

  // Fresh entropy per match so enemy AI + any randomness differs each playthrough;
  // gates build their own sim with a fixed seed for reproducibility.
  const _gameSeed = (function () {
    try { const a = new Uint32Array(1); (self.crypto || window.crypto).getRandomValues(a); return (a[0] >>> 0) || 1; }
    catch (e) { return (((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) || 1; }
  })();

  const ARENA_W = (m.arena && m.arena.width) || 220;
  const ARENA_H = (m.arena && m.arena.height) || 220;

  let sim = null;            // (re)built in beginGame so PLAY always starts clean
  const scene = kernel.scene;
  const reducedMotion = (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let phase = "menu";        // menu | battle | ended
  let busy = false;          // true while an animation/turn is resolving (locks input)
  let selectedId = null;     // currently selected friendly ship
  let beginGame = null;
  // ── online play (lazy; mirror-relay over Supabase Realtime) ──────────────────
  // Both clients run the SAME deterministic sim; each controls its own "player"
  // (south) fleet. A turn's actions are batched + broadcast on End Turn; the peer
  // replays them MIRRORED onto its "enemy" fleet (P-k<->E-k, x->W-x, y->H-y). Host's
  // sim starts firstSide "player" (acts first); guest starts "enemy" (waits first).
  let netMode = false, online = null, _onlineApi = null;
  let myActions = [];        // this turn's local actions, awaiting broadcast
  let netFirstSide = "player";

  // ── Ocean — real reflective water (three.js Water): flowing normal-mapped
  // waves, sun glint, fresnel shine. The normal map is bundled in the runtime.
  const water = new Water(new THREE.PlaneGeometry(4000, 4000), {
    textureWidth: 512, textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      new URL("./textures/waternormals.jpg", import.meta.url).href,
      (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }),
    sunDirection: new THREE.Vector3(0.6, 0.7, 0.4),
    sunColor: 0xffd9a0,
    waterColor: 0x0c3850,
    distortionScale: 3.0,
    fog: false,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.0;
  water.material.uniforms["size"].value = 6.0;
  scene.add(water);
  kernel.onUpdate((dt) => { water.material.uniforms["time"].value += dt * 0.6; });

  // ── Sky + sun (cinematic dusk) + IBL environment ───────────────────────────
  // The kernel ships ACESFilmic tone mapping; pull exposure back for a moody
  // dusk that doesn't blow out the sun glint.
  kernel.renderer.toneMappingExposure = 0.58;
  const sky = new Sky();
  sky.scale.setScalar(20000);
  scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU["turbidity"].value = 8.0;          // hazier, warmer dusk air
  skyU["rayleigh"].value = 2.6;
  skyU["mieCoefficient"].value = 0.006;
  skyU["mieDirectionalG"].value = 0.86;
  const sunPos = new THREE.Vector3();
  const elev = 9;                          // low sun -> long golden light, dusk mood
  const azi = 168;
  const phi = THREE.MathUtils.degToRad(90 - elev);
  const theta = THREE.MathUtils.degToRad(azi);
  sunPos.setFromSphericalCoords(1, phi, theta);
  skyU["sunPosition"].value.copy(sunPos);
  water.material.uniforms["sunDirection"].value.copy(sunPos).normalize();
  if (kernel.sun) {
    kernel.sun.position.copy(sunPos).multiplyScalar(300);
    kernel.sun.color.setHex(0xffd2a1);
    kernel.sun.intensity = 2.0;
  }
  scene.fog = null; // open horizon

  // IBL: render the Sky into an environment map (PMREM) so PBR hulls reflect the
  // real dusk sky. This is the "setEnvironment(skyTexture, ~0.5)" intent — the
  // kernel exposes no such helper, so we do it directly with the same result.
  try {
    const pmrem = new THREE.PMREMGenerator(kernel.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(sky, 0, 0.1, 2000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.5; // r0.172 supports scene.environmentIntensity
    pmrem.dispose();
  } catch (e) { console.warn("[navalfree] IBL env unavailable:", e); }

  // ── Physics (cannon-es) for cannonball ballistics + sink debris ─────────────
  try { await kernel.initPhysics({ gravity: -22 }); }
  catch (e) { console.warn("[navalfree] physics unavailable; tween fallback:", e); }

  // ── coordinate mapping (sim -> scene) ───────────────────────────────────────
  // sim origin (0,0) is a corner; center the arena on the world origin so the
  // camera frames it. sim (x,y) -> scene (x - W/2, 0, y - H/2).
  const OX = -ARENA_W / 2, OZ = -ARENA_H / 2;
  function toScene(x, y) { return new THREE.Vector3((x + OX) * S, 0, (y + OZ) * S); }
  function simHeadingToYaw(h) {
    // sim heading: angle in the (x,y) plane (atan2(dy,dx)). In scene, +x is east,
    // +y(sim) is +z. A ship's forward (model +X after our orient) should point
    // along (cos h, sin h) in sim => (cos h) x + (sin h) z in scene.
    return Math.atan2(Math.sin(h), Math.cos(h)); // identity; kept explicit for clarity
  }

  // ── Arena boundary ring (subtle) — so "open water" still reads as a bounded
  // skirmish zone without a grid. A faint glowing border + corner buoys.
  function buildArenaBounds() {
    const half = new THREE.Vector3(ARENA_W / 2, 0, ARENA_H / 2);
    const mat = new THREE.LineBasicMaterial({ color: 0x39c6e6, transparent: true, opacity: 0.32 });
    const pts = [
      new THREE.Vector3(-half.x, 0.3, -half.z), new THREE.Vector3(half.x, 0.3, -half.z),
      new THREE.Vector3(half.x, 0.3, half.z), new THREE.Vector3(-half.x, 0.3, half.z),
      new THREE.Vector3(-half.x, 0.3, -half.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(geo, mat));
    // corner buoys (cheap PBR markers)
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff6a3d, metalness: 0.2, roughness: 0.5, emissive: 0x3a1404, emissiveIntensity: 0.5 });
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
      const b = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 12), buoyMat);
      b.position.set(sx * half.x, 2.4, sz * half.z); b.castShadow = true; scene.add(b);
    });
  }
  buildArenaBounds();

  // ── Ambient OCEAN LIFE — seagulls glide + flap overhead; a dolphin breaches in
  // arcs, a shark fin cuts the surface, a whale glides just under: a living sea.
  // Cheap low-poly meshes, moved + wrapped each frame (no per-frame allocs/lights).
  function buildOceanLife() {
    const EX = ARENA_W * 0.6, EZ = ARENA_H * 0.6;
    const wrap = (v, lim) => (v > lim ? -lim : v < -lim ? lim : v);
    // seagulls (a shallow-V wing pair each)
    const birdMat = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.7, metalness: 0, emissive: 0x2a323c, emissiveIntensity: 0.25, envMapIntensity: 0.4 });
    const wingGeo = new THREE.ConeGeometry(0.5, 4.0, 4);
    const birds = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const L = new THREE.Mesh(wingGeo, birdMat), R = new THREE.Mesh(wingGeo, birdMat);
      L.rotation.z = Math.PI / 2; R.rotation.z = -Math.PI / 2; L.position.x = -1.8; R.position.x = 1.8;
      g.add(L); g.add(R); g.scale.setScalar(1.3 + (i % 3) * 0.35);
      g.position.set(Math.cos(i * 1.3) * EX * 0.7, 34 + (i % 3) * 9, Math.sin(i * 1.9) * EZ * 0.7);
      scene.add(g); birds.push({ g, L, R, vx: (i % 2 ? 1 : -1) * (7 + i), vz: (i % 2 ? -1 : 1) * (2 + (i % 3)), ph: i });
    }
    // sea creatures
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.5, metalness: 0.12, envMapIntensity: 0.6 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x32424e, roughness: 0.55, metalness: 0.1 });
    const creatures = [];
    const fin = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4, 3), finMat); fin.position.set(-EX * 0.5, 0.9, EZ * 0.25); scene.add(fin);
    creatures.push({ m: fin, vx: 9, vz: 1.4, kind: "fin", base: 0.9 });
    const dolphin = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4, 4, 8), bodyMat); dolphin.rotation.z = Math.PI / 2; dolphin.position.set(EX * 0.4, 0, -EZ * 0.3); scene.add(dolphin);
    creatures.push({ m: dolphin, vx: -12, vz: 2, kind: "dolphin", base: 0, t: 0 });
    const whale = new THREE.Mesh(new THREE.CapsuleGeometry(3.0, 15, 4, 10), bodyMat); whale.rotation.z = Math.PI / 2; whale.position.set(-EX * 0.2, -1.4, -EZ * 0.5); scene.add(whale);
    creatures.push({ m: whale, vx: 5, vz: 0.6, kind: "whale", base: -1.4 });
    let bt = 0;
    kernel.onUpdate((dt) => {
      bt += dt;
      for (const b of birds) {
        b.g.position.x = wrap(b.g.position.x + b.vx * dt, EX);
        b.g.position.z = wrap(b.g.position.z + b.vz * dt, EZ);
        b.g.position.y += Math.sin(bt * 1.1 + b.ph) * dt * 1.4;
        b.g.rotation.y = Math.atan2(b.vz, b.vx);
        const flap = Math.sin(bt * 7 + b.ph) * 0.5;
        b.L.rotation.x = flap; b.R.rotation.x = -flap;
      }
      for (const c of creatures) {
        c.m.position.x = wrap(c.m.position.x + c.vx * dt, EX);
        c.m.position.z = wrap(c.m.position.z + c.vz * dt, EZ);
        if (c.kind === "dolphin") { c.t += dt; c.m.position.y = c.base + Math.max(0, Math.sin(c.t * 1.0)) * 5 - 0.6; c.m.rotation.z = Math.PI / 2 + Math.cos(c.t * 1.0) * 0.55; }
        else if (c.kind === "fin") { c.m.position.y = c.base + Math.sin(bt * 2) * 0.15; }
      }
    });
  }
  buildOceanLife();

  // ── Ship visuals ────────────────────────────────────────────────────────────
  const modelForShip = (s) => {
    const mm = content.ship_models || {};
    // bigger hp/range ship => larger hull model
    if (s.maxHp >= 100) return mm.large || mm.default;
    if (s.maxHp >= 80) return mm.medium || mm.default;
    return mm.small || mm.default;
  };
  // per-ship visual record { group, hull, ring, healthBar, sunk }
  const vis = {};
  const HULL_LEN = { large: 22, medium: 18, small: 14 }; // target on-water length (scene units)

  async function buildShipVisual(s) {
    const url = modelForShip(s);
    let obj = null;
    if (url) { try { obj = await kernel.loadGLTF(url); } catch (e) { obj = null; } }
    if (!obj) obj = proceduralHull(s);

    // PBR pass: give hulls some metalness + lower roughness so they catch the sky
    // IBL (the shading standard). Tint by side so the two fleets read apart.
    const tint = s.side === "player" ? 0xbcd6e6 : 0xe6b9b0;
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material) {
          const mat = o.material.clone();
          mat.metalness = Math.min(1, (mat.metalness != null ? mat.metalness : 0.2) + 0.45);
          mat.roughness = Math.max(0.18, (mat.roughness != null ? mat.roughness : 0.8) - 0.35);
          if (mat.color) mat.color.lerp(new THREE.Color(tint), 0.18);
          mat.envMapIntensity = 0.9;
          o.material = mat;
        }
      }
    });

    // Fit length to a target on-water size (long axis), uniform-ish scale.
    const box0 = new THREE.Box3().setFromObject(obj);
    const dim = box0.getSize(new THREE.Vector3());
    const targetLen = HULL_LEN[s.maxHp >= 100 ? "large" : s.maxHp >= 80 ? "medium" : "small"];
    const longIsX = dim.x >= dim.z;
    const longDim = Math.max(dim.x, dim.z) || 1;
    const scale = targetLen / longDim;
    obj.scale.setScalar(scale);

    // We want the model's LONG axis aligned to +X (so yaw=heading points the bow
    // along the sim heading). If the long axis is Z, rotate 90deg.
    const group = new THREE.Group();
    if (!longIsX) obj.rotation.y = -Math.PI / 2;
    obj.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(obj);
    const ctr = box1.getCenter(new THREE.Vector3());
    obj.position.set(-ctr.x, -box1.min.y, -ctr.z); // center on group origin, seat keel at y=0
    group.add(obj);

    // wake/selection ring (flat torus on the water under the ship)
    const ringMat = new THREE.MeshBasicMaterial({ color: s.side === "player" ? 0x37e0c0 : 0xff7a5a, transparent: true, opacity: 0.0 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.radius * 1.05, s.radius * 1.35, 40), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
    group.add(ring);

    // floating health bar (sprite) above the ship
    const bar = makeHealthBar();
    bar.position.set(0, targetLen * 0.55 + 4, 0);
    group.add(bar);

    const p = toScene(s.x, s.y);
    group.position.set(p.x, 0.2, p.z);
    group.rotation.y = simHeadingToYaw(s.heading);
    scene.add(group);
    vis[s.id] = { group, hull: obj, ring, bar, side: s.side, lastHp: s.hp, maxHp: s.maxHp };
    updateHealthBar(s);
    return group;
  }
  function proceduralHull(s) {
    const g = new THREE.Group();
    const len = HULL_LEN[s.maxHp >= 100 ? "large" : s.maxHp >= 80 ? "medium" : "small"];
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 3.2, len * 0.34),
      new THREE.MeshStandardMaterial({ color: 0x42505e, roughness: 0.55, metalness: 0.55 }));
    hull.position.y = 1.6; g.add(hull);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(len * 0.2, 3.4, len * 0.22),
      new THREE.MeshStandardMaterial({ color: 0x2c343d, roughness: 0.5, metalness: 0.5 }));
    tower.position.y = 3.7; g.add(tower);
    return g;
  }

  // health bar sprite (red/green fill via canvas)
  function makeHealthBar() {
    const cvs = document.createElement("canvas"); cvs.width = 128; cvs.height = 20;
    const tex = new THREE.CanvasTexture(cvs);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    spr.scale.set(12, 1.9, 1);
    spr.userData = { cvs, tex };
    return spr;
  }
  function updateHealthBar(s) {
    const v = vis[s.id]; if (!v) return;
    const { cvs, tex } = v.bar.userData;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = "rgba(6,14,24,0.85)"; roundRect(ctx, 1, 1, cvs.width - 2, cvs.height - 2, 5); ctx.fill();
    const frac = Math.max(0, s.hp / s.maxHp);
    const col = s.side === "player" ? (frac > 0.5 ? "#37e0c0" : frac > 0.25 ? "#ffd166" : "#ff5a5a")
                                    : (frac > 0.5 ? "#ff8a6a" : frac > 0.25 ? "#ffb84d" : "#ff4d4d");
    ctx.fillStyle = col; roundRect(ctx, 3, 3, (cvs.width - 6) * frac, cvs.height - 6, 4); ctx.fill();
    tex.needsUpdate = true;
  }
  function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2; if (h < 2 * r) r = h / 2;
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ── Move-preview + fire gizmos ──────────────────────────────────────────────
  // Reachable area = a translucent disc of radius=speed around the selected ship.
  // Heading arrow = a thin cone showing current bow direction. Destination ghost
  // = a faint ship-sized marker the cursor drags around within reach.
  const reachDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 56),
    new THREE.MeshBasicMaterial({ color: 0x37e0c0, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  reachDisc.rotation.x = -Math.PI / 2; reachDisc.position.y = 0.1; reachDisc.visible = false; scene.add(reachDisc);
  const reachRing = new THREE.Mesh(
    new THREE.RingGeometry(0.97, 1.0, 56),
    new THREE.MeshBasicMaterial({ color: 0x6cf0d8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  reachRing.rotation.x = -Math.PI / 2; reachRing.position.y = 0.11; reachRing.visible = false; scene.add(reachRing);

  // Firing arc gizmo: a flat wedge (range radius, arc width) in front of the bow.
  const arcMesh = new THREE.Mesh(new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xffb24d, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  arcMesh.position.y = 0.13; arcMesh.visible = false; scene.add(arcMesh);

  const destGhost = new THREE.Mesh(new THREE.RingGeometry(4.5, 6.2, 28),
    new THREE.MeshBasicMaterial({ color: 0x9dffd0, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
  destGhost.rotation.x = -Math.PI / 2; destGhost.position.y = 0.14; destGhost.visible = false; scene.add(destGhost);

  function buildArcGeometry(range, arc) {
    // a triangle-fan wedge centered on +X (local), width = arc, radius = range
    const seg = 40, pos = [0, 0, 0];
    const a0 = -arc / 2, a1 = arc / 2;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      pos.push(Math.cos(a) * range, 0, Math.sin(a) * range);
    }
    const idx = [];
    for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function showSelectionGizmos(s) {
    if (!s) { hideGizmos(); return; }
    const p = toScene(s.x, s.y);
    const canMove = s.actionsLeft > 0;
    const canFire = s.actionsLeft > 0;
    reachDisc.visible = reachRing.visible = canMove;
    if (canMove) {
      reachDisc.position.set(p.x, 0.1, p.z); reachDisc.scale.setScalar(s.speed);
      reachRing.position.set(p.x, 0.11, p.z); reachRing.scale.setScalar(s.speed);
    }
    // firing arc wedge
    arcMesh.visible = canFire;
    if (canFire) {
      arcMesh.geometry.dispose();
      arcMesh.geometry = buildArcGeometry(s.gun.range, s.gun.arc);
      arcMesh.position.set(p.x, 0.13, p.z);
      arcMesh.rotation.set(0, -simHeadingToYaw(s.heading), 0); // local +X faces bow
    }
    // pulse the selected ship's ring
    for (const id in vis) vis[id].ring.material.opacity = 0.0;
    if (vis[s.id]) vis[s.id].ring.material.opacity = 0.85;
  }
  function hideGizmos() {
    reachDisc.visible = reachRing.visible = arcMesh.visible = destGhost.visible = false;
    for (const id in vis) if (vis[id]) vis[id].ring.material.opacity = 0.0;
  }

  // ── Combat FX (reused patterns from iron-tide, adapted) ─────────────────────
  // Free a transient mesh's GPU buffers — scene.remove() alone leaks geometry/material
  // (renderer keeps them until dispose()). Called when each VFX finishes.
  function disposeMesh(o) {
    try { if (o.geometry) o.geometry.dispose(); const m = o.material; if (Array.isArray(m)) m.forEach((x) => { if (x) { if (x.map) x.map.dispose(); x.dispose(); } }); else if (m) { if (m.map) m.map.dispose(); m.dispose(); } } catch (e) {}
  }
  function spawnSmoke(pos, dark) {
    const mat = new THREE.MeshBasicMaterial({ color: dark ? 0x222222 : 0xcfd6dd, transparent: true, opacity: 0.7 });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 8), mat);
    puff.position.set(pos.x, pos.y, pos.z); scene.add(puff);
    kernel.tween({ target: puff.scale, to: { x: 4, y: 4, z: 4 }, duration: 1.1 });
    kernel.tween({ target: puff.position, to: { y: pos.y + 6 }, duration: 1.1 });
    kernel.tween({ target: puff.material, to: { opacity: 0 }, duration: 1.1, onComplete: () => { scene.remove(puff); disposeMesh(puff); } });
  }
  function explosion(pos) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
    flash.position.set(pos.x, pos.y + 1.5, pos.z); scene.add(flash);
    kernel.tween({ target: flash.scale, to: { x: 3.4, y: 3.4, z: 3.4 }, duration: 0.4 });
    kernel.tween({ target: flash.material, to: { opacity: 0 }, duration: 0.4, onComplete: () => { scene.remove(flash); disposeMesh(flash); } });
    for (let i = 0; i < 4; i++) spawnSmoke({ x: pos.x, y: pos.y + 1 + i * 0.5, z: pos.z }, i % 2 === 0);
  }
  function splash(pos) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 12),
      new THREE.MeshBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.8 }));
    m.position.set(pos.x, 1.5, pos.z); scene.add(m);
    kernel.tween({ target: m.scale, to: { x: 1.8, y: 1.8, z: 1.8 }, duration: 0.5 });
    kernel.tween({ target: m.material, to: { opacity: 0 }, duration: 0.5, onComplete: () => { scene.remove(m); disposeMesh(m); } });
  }
  // muzzle flash at the firing ship's bow
  function muzzleFX(s) {
    const v = vis[s.id]; if (!v) return;
    const bow = new THREE.Vector3(Math.cos(s.heading) * (s.radius + 2), 2.5, Math.sin(s.heading) * (s.radius + 2));
    const p = v.group.position.clone().add(bow);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.95 }));
    flash.position.copy(p); scene.add(flash);
    kernel.tween({ target: flash.scale, to: { x: 3, y: 3, z: 3 }, duration: 0.18 });
    kernel.tween({ target: flash.material, to: { opacity: 0 }, duration: 0.18, onComplete: () => { scene.remove(flash); disposeMesh(flash); } });
    spawnSmoke({ x: p.x, y: p.y, z: p.z }, false);
    return p;
  }
  // ballistic shell from shooter bow to impact point
  function fireShell(s, toVec, onImpact) {
    const from = muzzleFX(s) || (function () { const a = toScene(s.x, s.y); a.y = 2.5; return a; })();
    if (reducedMotion) { onImpact(); return; }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0c, metalness: 0.6, roughness: 0.4 }));
    ball.position.copy(from); ball.castShadow = true; scene.add(ball);
    const C = kernel.CANNON, T = 0.62;
    if (C && kernel.world) {
      const g = kernel.world.gravity.y;
      const vel = { x: (toVec.x - from.x) / T, y: (toVec.y - from.y) / T - 0.5 * g * T, z: (toVec.z - from.z) / T };
      kernel.addPhysicsBody({ mesh: ball, shape: new C.Sphere(0.55), mass: 3, position: from, velocity: vel, despawnAfter: T + 0.1, removeMesh: true });
      setTimeout(onImpact, T * 1000);
    } else {
      const peak = 14;
      kernel.tween({ target: ball.position, to: { x: toVec.x, z: toVec.z }, duration: 0.6,
        onUpdate: (e) => { ball.position.y = from.y + Math.sin(e * Math.PI) * peak; },
        onComplete: () => { scene.remove(ball); disposeMesh(ball); onImpact(); } });
    }
  }
  // founder + slow sink (reused founder logic, scaled to this game's units)
  function sinkVisual(s) {
    const v = vis[s.id]; if (!v || v._sinking) return;
    v._sinking = true;
    const obj = v.group;
    const startY = obj.position.y;
    const dip = (Math.random() < 0.5 ? 1 : -1) * 0.12;
    const list = (Math.random() - 0.5) * 0.16;
    const WRECK_Y = -2.2, FOUNDER = 2.2, FLOAT = 5.0, RATE = 1.4;
    v.bar.visible = false; v.ring.material.opacity = 0;
    let t = 0;
    kernel.onUpdate((dt) => {
      if (!v._sinking) return;
      t += dt;
      if (t < FOUNDER) {
        const k = t / FOUNDER, e = k * k * (3 - 2 * k);
        obj.position.y = startY + (WRECK_Y - startY) * e;
        obj.rotation.x = dip * e; obj.rotation.z = list * e;
      } else if (t < FOUNDER + FLOAT) {
        obj.position.y = WRECK_Y + Math.sin(t * 1.1) * 0.18;
      } else {
        obj.position.y -= RATE * dt;
        obj.rotation.x = dip * (1 + Math.min(1.6, (t - FOUNDER - FLOAT) * 0.06));
        if (obj.position.y < -22) { obj.visible = false; v._sinking = false; }
      }
    });
  }

  // ── Smoothly drive a ship's visual to its sim pose (move animation) ─────────
  function animateMove(s, done) {
    const v = vis[s.id]; if (!v) { done && done(); return; }
    const target = toScene(s.x, s.y);
    const targetYaw = simHeadingToYaw(s.heading);
    if (reducedMotion) {
      v.group.position.set(target.x, 0.2, target.z); v.group.rotation.y = targetYaw; done && done(); return;
    }
    // rotate first portion then glide; combined via tween on a proxy.
    const startYaw = v.group.rotation.y;
    let dyaw = targetYaw - startYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    // SAIL: a slow, smooth glide (was a 0.85s zip with a frame-rate-dependent lerp).
    // Duration scales with distance; the ship finishes turning early then eases
    // across the water on a smoothstep curve, leaving a wake.
    const startX = v.group.position.x, startZ = v.group.position.z;
    const dist = Math.hypot(target.x - startX, target.z - startZ);
    const dur = Math.max(1.5, Math.min(3.4, dist * 0.07));
    let wakeT = 0; const proxy = { p: 0 };
    kernel.tween({
      target: proxy, to: { p: 1 }, duration: dur,
      onUpdate: (e) => {
        const turnP = Math.min(1, e / 0.3);             // finish the turn in the first 30%
        v.group.rotation.y = startYaw + dyaw * turnP;
        const g = e * e * (3 - 2 * e);                  // smoothstep glide
        v.group.position.x = startX + (target.x - startX) * g;
        v.group.position.z = startZ + (target.z - startZ) * g;
        wakeT += 1;
        if (wakeT % 9 === 0) {
          const stern = new THREE.Vector3(-Math.cos(s.heading) * (s.radius + 1), 0.4, -Math.sin(s.heading) * (s.radius + 1));
          spawnSmoke(v.group.position.clone().add(stern), false);
        }
      },
      onComplete: () => {
        v.group.position.set(target.x, 0.2, target.z); v.group.rotation.y = targetYaw;
        done && done();
      },
    });
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────
  function fleetPips(side) {
    return sim.ships.filter((s) => s.side === side).map((s) => {
      const frac = Math.max(0, s.hp / s.maxHp);
      const col = s.sunk ? "#7a2020" : side === "player" ? "#37e0c0" : "#ff8a6a";
      const w = Math.max(3, Math.round(22 * frac));
      return `<span title="${s.id}: ${s.hp}/${s.maxHp}" style="display:inline-block;height:8px;width:${s.sunk ? 22 : 22}px;margin:0 2px;border-radius:2px;background:#10202e;vertical-align:middle">
        <span style="display:block;height:8px;width:${s.sunk ? 0 : w}px;border-radius:2px;background:${col};box-shadow:${s.sunk ? "none" : "0 0 5px " + col}"></span></span>`;
    }).join("");
  }
  function setHUD(banner) {
    if (!sim) return;
    const sel = selectedId ? sim.shipById(selectedId) : null;
    const yourTurn = sim.turn === "player";
    const turnTag = sim.ended ? "" : yourTurn ? `<span style="color:#37e0c0">YOUR TURN</span>` : `<span style="color:#ff8a6a">ENEMY TURN</span>`;
    const selInfo = sel && !sel.sunk
      ? `<div style="margin-top:4px;font-size:12px">Selected <b>${sel.id}</b> · HP ${sel.hp}/${sel.maxHp} · Actions <b>${sel.actionsLeft}</b>/${sim.actionsPerTurn}<br>
         <span style="opacity:.7">click open water to <b>DRIVE</b> · click an enemy in the amber arc to <b>FIRE</b></span></div>`
      : (yourTurn ? `<div style="margin-top:4px;font-size:12px;opacity:.75">Click one of your <span style="color:#37e0c0">teal</span> ships to select it.</div>` : "");
    const endBtn = (yourTurn && !sim.ended)
      ? `<button id="nf-endturn" style="pointer-events:auto;margin-top:8px;font:bold 13px monospace;padding:7px 16px;border-radius:6px;cursor:pointer;color:#062018;background:linear-gradient(#9dffb6,#4fe084);border:1px solid #7CFC9A">END TURN ▸</button>`
      : "";
    kernel.hud(`
      <div style="position:absolute;top:10px;left:0;right:0;text-align:center;font-size:20px;font-weight:800;letter-spacing:2px;text-shadow:0 2px 10px #000">
        ${content.title || "Tide Breakers"} &nbsp; <span style="font-size:13px;font-weight:600">· Turn ${sim.turnNumber} · ${turnTag}</span>
      </div>
      <div style="position:absolute;top:46px;left:12px;font-size:12px">
        <div><b style="color:#37e0c0">YOUR FLEET</b> &nbsp;${fleetPips("player")}</div>
        <div style="margin-top:3px"><b style="color:#ff8a6a">ENEMY</b> &nbsp;&nbsp;&nbsp;&nbsp;${fleetPips("enemy")}</div>
      </div>
      <div style="position:absolute;left:0;right:0;bottom:16px;text-align:center">
        ${banner ? `<div style="font-size:14px;margin-bottom:4px;opacity:.95">${banner}</div>` : ""}
        ${selInfo}
        ${endBtn}
      </div>`);
    const eb = document.getElementById("nf-endturn");
    if (eb) eb.onclick = () => { if (!busy) endPlayerTurn(); };
  }

  // ── Input: pick water point / ship under the cursor ─────────────────────────
  // We raycast against an invisible "water pick" plane for points, and against
  // ship groups for ship selection/targeting.
  const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.rotation.x = -Math.PI / 2; pickPlane.position.y = 0.05; scene.add(pickPlane);

  function pickWater(clientX, clientY) {
    const hits = kernel.raycast(clientX, clientY, [pickPlane]);
    if (!hits.length) return null;
    const p = hits[0].point; // scene coords
    return { sx: p.x, sz: p.z, simX: p.x / S - OX, simY: p.z / S - OZ };
  }
  function pickShip(clientX, clientY) {
    const groups = Object.keys(vis).filter((id) => { const s = sim.shipById(id); return s && !s.sunk; }).map((id) => vis[id].group);
    const hits = kernel.raycast(clientX, clientY, groups);
    if (!hits.length) return null;
    // walk up to the group we registered
    let o = hits[0].object;
    while (o && !Object.values(vis).some((v) => v.group === o)) o = o.parent;
    if (!o) return null;
    const id = Object.keys(vis).find((k) => vis[k].group === o);
    return id ? sim.shipById(id) : null;
  }

  function onClick(ev) {
    if (phase !== "battle" || busy || !sim || sim.ended || paused()) return;
    if (sim.turn !== "player") return; // only the human acts on clicks
    const ship = pickShip(ev.clientX, ev.clientY);
    // Clicking an ENEMY ship while you have a selected, action-ready ship = FIRE.
    if (ship && ship.side === "enemy" && selectedId) {
      const shooter = sim.shipById(selectedId);
      if (shooter && shooter.actionsLeft > 0) { tryFire(shooter, ship); return; }
    }
    // Clicking a FRIENDLY ship = select it.
    if (ship && ship.side === "player") { selectedId = ship.id; showSelectionGizmos(ship); setHUD(); return; }
    // Clicking open water with a selected ship = DRIVE there.
    if (selectedId) {
      const shooter = sim.shipById(selectedId);
      if (shooter && shooter.actionsLeft > 0) {
        const w = pickWater(ev.clientX, ev.clientY);
        if (w) tryMove(shooter, w.simX, w.simY);
      }
    }
  }
  // hover: drag the destination ghost around within reach
  function onMove(ev) {
    if (phase !== "battle" || busy || !sim || sim.turn !== "player") { destGhost.visible = false; return; }
    const s = selectedId ? sim.shipById(selectedId) : null;
    if (!s || s.actionsLeft <= 0) { destGhost.visible = false; return; }
    const w = pickWater(ev.clientX, ev.clientY);
    if (!w) { destGhost.visible = false; return; }
    // clamp ghost to reach
    const dx = w.simX - s.x, dy = w.simY - s.y;
    const d = Math.hypot(dx, dy);
    const k = d > s.speed ? s.speed / d : 1;
    const gx = s.x + dx * k, gy = s.y + dy * k;
    const p = toScene(gx, gy);
    destGhost.position.set(p.x, 0.14, p.z); destGhost.visible = true;
    destGhost.material.opacity = 0.55;
  }

  function paused() { return window.FFG && window.FFG.shell && window.FFG.shell.phase === "paused"; }

  // ── Action wrappers (sim + animation) ────────────────────────────────────────
  function tryMove(s, simX, simY) {
    const r = sim.moveShip(s.id, { x: simX, y: simY });
    if (!r.ok) { setHUD(reasonText(r.reason)); return; }
    if (netMode) myActions.push({ k: "m", id: s.id, x: r.x, y: r.y }); // relay the RESOLVED pose
    busy = true; hideGizmos(); destGhost.visible = false;
    kernel.playSound(sfx.move || sfx.splash, 0.18);
    animateMove(s, () => {
      busy = false;
      autoSelectNextShip(s.id); // keep this ship if it still has actions, else auto-advance
      maybeAutoEndPlayerTurn();
    });
  }
  function tryFire(shooter, targetShip) {
    // Pre-check so we can explain misses without burning surprise.
    const chk = sim.canFireAt(shooter.id, targetShip.x, targetShip.y, targetShip.id);
    const r = sim.fireAt(shooter.id, targetShip.id);
    if (netMode) myActions.push({ k: "f", id: shooter.id, tid: targetShip.id }); // relay (even a miss burns an action)
    busy = true; hideGizmos();
    kernel.playSound(sfx.fire, 0.5);
    const impact = toScene(targetShip.x, targetShip.y); impact.y = 2.0;
    fireShell(shooter, impact, () => {
      if (r.result === "hit" || r.result === "sink") {
        explosion(impact); kernel.playSound(sfx.hit, 0.5);
        updateHealthBar(sim.shipById(targetShip.id) || targetShip);
        damageText(impact, r.dmg);
        if (r.result === "sink") { kernel.playSound(sfx.sink, 0.6); sinkVisual(targetShip); }
      } else {
        splash(impact); kernel.playSound(sfx.miss || sfx.splash, 0.4);
      }
      busy = false;
      if (sim.ended) { finishMatch(); return; }
      autoSelectNextShip(shooter.id); setHUD(shotBanner(r, chk));
      maybeAutoEndPlayerTurn();
    });
  }
  function shotBanner(r, chk) {
    if (r.result === "sink") return `<span style="color:#ffd166">Direct hit — enemy ${r.target} SUNK!</span>`;
    if (r.result === "hit") return `<span style="color:#9dffd0">Hit ${r.target} for ${r.dmg}.</span>`;
    if (r.result === "invalid") return `<span style="color:#ff8a6a">Shot failed: ${reasonText(r.reason)}.</span>`;
    return `Splash — missed.`;
  }
  function reasonText(reason) {
    return ({ range: "target out of gun range", arc: "target outside firing arc — turn to bring guns to bear",
      los: "line of sight blocked by another hull", "no-actions": "no actions left this turn",
      "not-your-turn": "not your turn" })[reason] || reason || "invalid";
  }
  function damageText(pos, dmg) {
    const spr = makeFloatText("-" + dmg, "#ffd166");
    spr.position.set(pos.x, pos.y + 4, pos.z); scene.add(spr);
    kernel.tween({ target: spr.position, to: { y: pos.y + 12 }, duration: 1.0 });
    kernel.tween({ target: spr.material, to: { opacity: 0 }, duration: 1.0, onComplete: () => { scene.remove(spr); disposeMesh(spr); } });
  }
  function makeFloatText(text, color) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const ctx = c.getContext("2d"); ctx.font = "bold 44px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 5; ctx.strokeStyle = "rgba(4,10,18,0.9)"; ctx.strokeText(text, 64, 32);
    ctx.fillStyle = color || "#fff"; ctx.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(8, 4, 1); return spr;
  }

  // ── Turn flow ─────────────────────────────────────────────────────────────────
  function maybeAutoEndPlayerTurn() {
    if (sim.ended) return;
    if (sim.turn === "player" && sim.sideExhausted("player")) {
      setHUD(`<span style="opacity:.8">All ships have acted — ending your turn…</span>`);
      setTimeout(() => { if (!sim.ended) endPlayerTurn(); }, 700);
    }
  }
  // AUTO-SELECT the ship that should act so you never hand-pick boats one at a time:
  // keep the just-acted ship while it still has actions, else jump to the readiest
  // (most actions, then most movement/speed). The turn auto-ends when none are left.
  function autoSelectNextShip(preferId) {
    if (!sim || sim.ended || sim.turn !== "player") return;
    const ready = sim.shipsOf("player").filter((s) => !s.sunk && s.actionsLeft > 0);
    if (!ready.length) { selectedId = null; hideGizmos(); return; }
    let pick = preferId ? ready.find((s) => s.id === preferId) : null;
    if (!pick) { ready.sort((a, b) => (b.actionsLeft - a.actionsLeft) || (b.speed - a.speed)); pick = ready[0]; }
    selectedId = pick.id; showSelectionGizmos(pick); setHUD();
  }
  function endPlayerTurn() {
    if (sim.ended || sim.turn !== "player" || busy) return;
    selectedId = null; hideGizmos();
    sim.endTurn(); // -> enemy
    if (netMode) {
      // ONLINE: hand the opponent my turn's actions; lock input until theirs arrive.
      const batch = myActions; myActions = [];
      setHUD(`<span style="color:#ff8a6a">Opponent's move…</span>`);
      busy = true;
      if (online) online.localMoved(batch);
      return;
    }
    setHUD(`<span style="color:#ff8a6a">Enemy is maneuvering…</span>`);
    busy = true;
    runAITurn();
  }
  // Play the AI's planned actions VISIBLY, one at a time, with animation.
  function runAITurn() {
    const acts = sim.aiPlan(); // resolves the whole enemy turn in the sim
    let i = 0;
    function step() {
      if (i >= acts.length) {
        // enemy turn done
        if (sim.ended) { busy = false; finishMatch(); return; }
        sim.endTurn(); // -> player
        busy = false;
        setHUD(`<span style="color:#37e0c0">Your move.</span>`);
        autoSelectNextShip(); // auto-pick the first ready ship for the new turn
        return;
      }
      const a = acts[i++];
      const s = sim.shipById(a.id);
      if (!s) { step(); return; }
      if (a.kind === "move") {
        // The sim already moved the ship; animate the visual to its NEW pose.
        animateMove(s, () => setTimeout(step, 180));
      } else if (a.kind === "fire") {
        const tgt = sim.shipById(a.target);
        const impact = tgt ? toScene(tgt.x, tgt.y) : toScene(s.x, s.y); impact.y = 2.0;
        kernel.playSound(sfx.fire, 0.45);
        fireShell(s, impact, () => {
          const res = a.result || {};
          if (res.result === "hit" || res.result === "sink") {
            explosion(impact); kernel.playSound(sfx.hit, 0.5);
            if (tgt) updateHealthBar(tgt);
            damageText(impact, res.dmg);
            if (res.result === "sink" && tgt) { kernel.playSound(sfx.sink, 0.6); sinkVisual(tgt); }
          } else { splash(impact); }
          setHUD(`<span style="color:#ff8a6a">Enemy ${s.id} fires…</span>`);
          if (sim.ended) { busy = false; finishMatch(); return; }
          setTimeout(step, 240);
        });
      } else { step(); }
    }
    // small beat before the enemy acts so the player registers the turn flip
    setTimeout(step, 500);
  }

  function finishMatch() {
    phase = "ended"; hideGizmos();
    const win = sim.winner === "player";
    setHUD("");
    if (window.FFG && window.FFG.shell) {
      const subtitle = win ? `Enemy fleet sunk · Turn ${sim.turnNumber}` : `Your fleet was lost · Turn ${sim.turnNumber}`;
      window.FFG.shell.end(win, subtitle);
    }
    if (netMode && online) { try { online.finish(); } catch (e) {} }
  }

  // ── ONLINE: replay the opponent's relayed turn, MIRRORED onto my enemy fleet ──
  // P-k<->E-k (their player == my enemy) and coords flip across the arena centre, so
  // both deterministic sims stay mirror-consistent (moveShip/fireAt carry no RNG).
  function mirrorId(id) { return id && id[0] === "P" ? "E" + id.slice(1) : "P" + id.slice(1); }
  async function applyRemoteBatch(batch) {
    busy = true;
    const acts = batch || [];
    for (const a of acts) {
      if (sim.ended) break;
      if (a.k === "m") {
        const id = mirrorId(a.id);
        sim.moveShip(id, { x: ARENA_W - a.x, y: ARENA_H - a.y });
        const s = sim.shipById(id);
        if (s) await new Promise((res) => animateMove(s, res));
      } else if (a.k === "f") {
        const sid = mirrorId(a.id), tid = mirrorId(a.tid);
        const shooter = sim.shipById(sid), target = sim.shipById(tid);
        const r = sim.fireAt(sid, tid);
        if (shooter && target) {
          const impact = toScene(target.x, target.y); impact.y = 2.0;
          kernel.playSound(sfx.fire, 0.5);
          await new Promise((res) => fireShell(shooter, impact, () => {
            if (r.result === "hit" || r.result === "sink") {
              explosion(impact); kernel.playSound(sfx.hit, 0.5);
              updateHealthBar(sim.shipById(tid) || target); damageText(impact, r.dmg);
              if (r.result === "sink") { kernel.playSound(sfx.sink, 0.6); sinkVisual(target); }
            } else { splash(impact); kernel.playSound(sfx.miss || sfx.splash, 0.4); }
            res();
          }));
        }
      }
    }
    if (sim.ended) { busy = false; finishMatch(); return; }
    sim.endTurn(); // -> my turn
    busy = false;
    setHUD(`<span style="color:#37e0c0">Your move.</span>`);
    autoSelectNextShip();
  }

  // small online status HUD (turn + 15s timer)
  let _onlineHud = null;
  function onlineStatus(o) {
    if (!o) { if (_onlineHud) _onlineHud.style.display = "none"; return; }
    if (!_onlineHud) {
      _onlineHud = document.createElement("div");
      _onlineHud.style.cssText = "position:absolute;top:60px;left:0;right:0;text-align:center;z-index:40;font-family:'Segoe UI',monospace;pointer-events:none";
      (kernel.parent || document.body).appendChild(_onlineHud);
    }
    _onlineHud.style.display = "block";
    const col = o.myTurn ? "#37e0c0" : "#ff8a6a";
    const clock = o.secsLeft != null ? ` · ⏱ ${o.secsLeft}s` : "";
    _onlineHud.innerHTML = `<div style="display:inline-block;background:rgba(8,16,26,.78);border:1px solid ${col};border-radius:9px;padding:6px 16px;color:${col};font-size:14px;font-weight:700;letter-spacing:1px">${o.banner || ""}${clock}</div>`;
  }

  function buildOnlineIface() {
    return {
      parent: kernel.parent,
      gameId: "tide-breakers",
      onLobbyOpen: () => {},
      onLobbyBack: () => { netMode = false; phase = "menu"; onlineStatus(null); if (window.FFG && window.FFG.shell) window.FFG.shell.start(); },
      startGame: (isHost) => {
        netMode = true; netFirstSide = isHost ? "player" : "enemy"; myActions = [];
        onlineStatus({ myTurn: isHost, banner: isHost ? "You move first" : "Opponent moves first", secsLeft: null });
        beginGame(content.difficulty || "normal");
      },
      isMyTurn: () => !!sim && phase === "battle" && sim.turn === "player",
      isOver: () => !!sim && sim.ended,
      applyRemoteMove: (batch) => applyRemoteBatch(batch),
      randomMove: () => { if (sim && sim.turn === "player" && !busy) endPlayerTurn(); }, // timeout = end my turn
      setStatus: (s) => onlineStatus(s),
      end: (victory, sub) => { phase = "ended"; hideGizmos(); onlineStatus(null); if (window.FFG && window.FFG.shell) window.FFG.shell.end(victory, sub || ""); },
      onError: (msg) => { try { console.warn("[online]", msg); } catch (e) {} },
    };
  }
  async function startOnline() {
    if (!_onlineApi) {
      const mod = await import("../net/ffg_online.js" + new URL(import.meta.url).search);
      _onlineApi = mod.installOnline(buildOnlineIface());
      online = _onlineApi.controller;
    }
    netMode = true;
    _onlineApi.openLobby();
  }

  // ── Camera (orbit + zoom), framed on the arena ──────────────────────────────
  kernel.camera.position.set(0, ARENA_H * 0.62, ARENA_H * 0.78);
  kernel.camera.lookAt(0, 0, 0);
  kernel.enableOrbit({
    rotateButton: "right", enablePan: true, wasdPan: true, panSpeed: 70,
    minDistance: 60, maxDistance: ARENA_H * 1.7,
    target: { x: 0, y: 0, z: 0 },
    minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.46,
  });

  // ── Begin a match (called by the shell's Play button) ───────────────────────
  beginGame = async function (difficulty) {
    // wipe any previous visuals (Play again without reload, defensive)
    for (const id in vis) { if (vis[id] && vis[id].group) scene.remove(vis[id].group); delete vis[id]; }
    selectedId = null; hideGizmos();

    const diff = difficulty || content.difficulty || "normal";
    const fleet = NavalFree.defaultFleet(ARENA_W, ARENA_H);
    // difficulty tweaks the enemy a touch (range/dmg), player unchanged
    if (diff === "hard") fleet.forEach((s) => { if (s.side === "enemy") { s.gun.range *= 1.12; s.gun.dmg = Math.round(s.gun.dmg * 1.18); s.hp = Math.round(s.hp * 1.1); s.maxHp = s.hp; } });
    if (diff === "easy") fleet.forEach((s) => { if (s.side === "enemy") { s.gun.range *= 0.9; s.gun.dmg = Math.round(s.gun.dmg * 0.82); } });

    sim = new NavalFree({ width: ARENA_W, height: ARENA_H, seed: _gameSeed, firstSide: netMode ? netFirstSide : "player", actionsPerTurn: m.actionsPerTurn || 2, ships: fleet });
    for (const s of sim.ships) await buildShipVisual(s);
    phase = "battle"; busy = false;
    // Procedural ocean music. The PLAY click is the user gesture that unlocks audio;
    // it's the ONLY music source now (shell music is null), so no double-play.
    try { navalMusic.start(); } catch (e) {}
    setHUD(`<span style="opacity:.85">Drive and fire. Sink the enemy fleet.</span>`);
    autoSelectNextShip(); // auto-pick the first ship to act (no manual boat-by-boat selecting)
  };

  // ── DOM listeners ─────────────────────────────────────────────────────────────
  const dom = kernel.renderer.domElement;
  dom.addEventListener("click", onClick);
  dom.addEventListener("mousemove", onMove);
  // R = rotate selected ship in place (uses an action) — quick re-aim without driving.
  window.addEventListener("keydown", (e) => {
    if (phase !== "battle" || busy || !sim || sim.turn !== "player") return;
    const s = selectedId ? sim.shipById(selectedId) : null;
    if (!s || s.actionsLeft <= 0) return;
    if (e.key === "q" || e.key === "Q") { sim.rotateShip(s.id, -s.turnRate); animateMove(s, () => { showSelectionGizmos(s); setHUD(); maybeAutoEndPlayerTurn(); }); }
    if (e.key === "e" || e.key === "E") { sim.rotateShip(s.id, s.turnRate); animateMove(s, () => { showSelectionGizmos(s); setHUD(); maybeAutoEndPlayerTurn(); }); }
  });

  // ── Wire the standard shell (menu / pause / win-lose / music) ───────────────
  const ShellCtor = window.FFG && window.FFG.Shell;
  if (ShellCtor) {
    const shell = new ShellCtor({
      parent: kernel.parent,
      title: content.title || "Tide Breakers",
      tagline: content.tagline || "Open-water naval skirmish.",
      music: null, // procedural OPEN-OCEAN loop (createNavalMusic), not a shared file
      menuImage: (content.assets && content.assets.menu_image) || null,
      difficulties: ["easy", "normal", "hard"],
      defaultDifficulty: content.difficulty || "normal",
      howTo: [
        { h: "Goal", p: "Sink the enemy fleet. No grid — your ships drive freely across open water." },
        { h: "Each turn", p: "Every ship gets 2 actions. <b>Driving</b> to a new spot and <b>Firing</b> each cost one action — so a ship can move-then-fire, fire-then-move, or double-move." },
        { h: "Select", p: "Click one of your <b>teal</b> ships. A teal disc shows how far it can drive this action; an amber wedge shows its gun range and firing arc." },
        { h: "Drive", p: "Click open water inside the teal disc. The ship turns toward the heading and steams there (capped by its turn rate + speed)." },
        { h: "Fire", p: "Click an enemy ship that sits inside your amber arc. Out of range / out of arc / blocked by a hull = the shot won't connect, so reposition. <b>Q/E</b> rotate the selected ship in place." },
        { h: "Camera", p: "Right-drag to orbit · scroll to zoom · WASD to pan across the sea." },
        { h: "Play Online", p: "From the title, choose <b>PLAY ONLINE</b> to face a live opponent: <b>Quick Match</b> pairs you with anyone waiting, or <b>Create Room</b> / <b>Join Room</b> with a shared 4-character code to play a friend. Each side commands its own fleet with a <b>15-second turn timer</b>." },
      ],
      onPlay: (d) => { beginGame(d); },
      onPause: () => { try { navalMusic.stop(); } catch (e) {} },
      onResume: () => { try { navalMusic.start(); } catch (e) {} },
    });
    shell.start();

    // Inject a "PLAY ONLINE" button beside PLAY (additive; re-added on each menu render).
    const _origMenu = shell.menu.bind(shell);
    shell.menu = function () {
      _origMenu();
      try {
        if (shell.phase !== "menu" || !shell.ov) return;
        const ob = document.createElement("button");
        ob.textContent = "🌐  PLAY ONLINE";
        ob.style.cssText = "font:bold 15px 'Segoe UI',system-ui,monospace;padding:11px 26px;cursor:pointer;min-width:200px;" +
          "letter-spacing:1px;border-radius:7px;margin-top:8px;color:#06121f;background:linear-gradient(#9fe0ff,#4fb6e0);" +
          "border:1px solid #7fd0f0;box-shadow:0 4px 18px rgba(80,180,224,.32);transition:transform .08s";
        ob.onmouseenter = () => { ob.style.transform = "translateY(-1px)"; };
        ob.onmouseleave = () => { ob.style.transform = "none"; };
        ob.onclick = () => { shell.hide(); shell.phase = "playing"; startOnline(); };
        const playBtn = Array.prototype.find.call(shell.ov.querySelectorAll("button"), (b) => /PLAY/i.test(b.textContent) && !/ONLINE/i.test(b.textContent));
        if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(ob, playBtn.nextSibling);
        else shell.ov.appendChild(ob);
      } catch (e) { /* additive — never block the menu */ }
    };
    if (shell.phase === "menu") shell.menu();
  } else {
    // No shell available — boot straight into a match (headless/test fallback).
    beginGame(content.difficulty || "normal");
  }

  // ── Test hook (headless smoke/signature) ────────────────────────────────────
  const controller = {
    get sim() { return sim; },
    beginGame,
    __test: {
      start: (d) => beginGame(d || "normal"),
      sim: () => sim,
      selectFirstPlayer: () => { const s = sim.shipsOf("player")[0]; selectedId = s ? s.id : null; if (s) showSelectionGizmos(s); setHUD(); return s ? s.id : null; },
      driveSelected: (simX, simY) => { const s = sim.shipById(selectedId); if (s) tryMove(s, simX, simY); },
      fireSelectedAtNearestEnemy: () => {
        const s = sim.shipById(selectedId); if (!s) return null;
        // move close + turn first if needed, but for the smoke test just try the nearest in-arc enemy
        const foe = sim.enemiesOf("player").map((e) => ({ e, d: Math.hypot(e.x - s.x, e.y - s.y) })).sort((a, b) => a.d - b.d)[0];
        if (!foe) return null; tryFire(s, foe.e); return foe.e.id;
      },
      endTurn: () => endPlayerTurn(),
      isBusy: () => busy,
      phase: () => phase,
    },
  };
  return controller;
});
