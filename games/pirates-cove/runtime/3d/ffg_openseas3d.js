/**
 * FFG runtime — 3d/ffg_openseas3d.js  (ES module)
 *
 * REAL-TIME open-ocean sandbox ("Pirate's Cove"). Reuses the Tide
 * Breakers substrate — the genre-agnostic three.js kernel, the reflective Water,
 * the dusk Sky/sun/IBL, and the ship GLBs — but the gameplay is LIVE, not turn-based:
 *
 *   • You sail a ship in real time (throttle + rudder), a chase camera trailing you.
 *   • NPC ships patrol a big ocean, wandering on smooth random headings; they can be
 *     hostile (pirates/marauders) and will later trade live cannon fire with you.
 *   • Islands are scattered across the sea. Sail close and DOCK (E) to trigger an
 *     encounter — treasure, a pirate fight, marauders, or castaways to recruit.
 *
 * FOUNDATION SCOPE (this file, first pass): ocean + player sailing + NPC wander +
 * island scatter + dock proximity + HUD. Live D&D combat (reusing navalfree.js's
 * d20/damage-band/crit dice), the island encounters, and the crew system land next.
 *
 * Registers genre "openseas" into the 3D kernel registry.
 */
import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { Sky } from "three/addons/objects/Sky.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";

const V = new URL(import.meta.url).search;
// Reuse the Tide Breakers dice sim for combat later (d20 to-hit, damage bands, crits).
await import("../sim/navalfree.js" + V);                 // sets window.FFG.sim.NavalFree
const { register3d } = await import("./ffg_kernel_3d.js" + V);

register3d("openseas", async function (kernel, content) {
  const THREEc = THREE;
  const m = (content && (content.setup || content)) || {};
  const scene = kernel.scene;

  // ── World scale ──────────────────────────────────────────────────────────────
  // A much larger ocean than the turn-based arena: SEA is the half-extent of the
  // sailable water; islands + NPCs live inside it. The reflective plane is bigger
  // still so the horizon never shows an edge.
  const SEA = (m.sea != null ? m.sea : 1000);            // sailable half-extent
  const rng = mulberry32((m.seed >>> 0) || (Date.now() >>> 0) || 1);

  // ── Ocean — reflective Water (reused verbatim from the naval substrate) ───────
  const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
    textureWidth: 512, textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      new URL("./textures/waternormals.jpg", import.meta.url).href,
      (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }),
    sunDirection: new THREE.Vector3(0.6, 0.7, 0.4),
    sunColor: 0xffd9a0, waterColor: 0x0c3850, distortionScale: 3.2, fog: false,
  });
  water.rotation.x = -Math.PI / 2; water.position.y = 0;
  water.material.uniforms["size"].value = 8.0;
  scene.add(water);

  // ── Sky + sun + IBL (dusk mood, reused) ──────────────────────────────────────
  kernel.renderer.toneMappingExposure = 0.6;
  const sky = new Sky(); sky.scale.setScalar(30000); scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU["turbidity"].value = 8.0; skyU["rayleigh"].value = 2.4;
  skyU["mieCoefficient"].value = 0.006; skyU["mieDirectionalG"].value = 0.86;
  const sunPos = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - 11), theta = THREE.MathUtils.degToRad(160);
  sunPos.setFromSphericalCoords(1, phi, theta);
  skyU["sunPosition"].value.copy(sunPos);
  water.material.uniforms["sunDirection"].value.copy(sunPos).normalize();
  if (kernel.sun) { kernel.sun.position.copy(sunPos).multiplyScalar(400); kernel.sun.color.setHex(0xffd2a1); kernel.sun.intensity = 2.1; }
  // A soft fill light that ramps UP while ashore so the on-foot characters read clearly against the dusk terrain
  // (they were silhouetting into the dark). Off at sea (0), lerped in onUpdate by mode.
  const ashoreFill = new THREE.HemisphereLight(0xd4e6ff, 0x50583a, 0); scene.add(ashoreFill);
  scene.fog = new THREE.Fog(0x9fb6c4, 300, 820);           // linear haze: fully fogged by ~820 so ships culled at distance never pop in (also keeps the draw count sane on weak GPUs)
  // Shadows ON-DEMAND, not every frame: the islands/town are static and the sun is fixed, and the
  // reflective Water already does a full extra scene pass per frame — re-rendering shadows 60x/s on
  // top of that is what choked a large scene. Refresh a few times a second instead (see onUpdate).
  kernel.renderer.shadowMap.autoUpdate = false; kernel.renderer.shadowMap.needsUpdate = true;
  try {
    const pmrem = new THREE.PMREMGenerator(kernel.renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromScene(sky, 0, 0.1, 3000).texture;
    scene.environmentIntensity = 0.5; pmrem.dispose();
  } catch (e) { console.warn("[openseas] IBL env unavailable:", e); }

  // ── NIGHT / BOSS ambience — night is an EVENT (the Dreadmaw's raid), not a passive cycle. `applyEnv()`
  // lerps the whole palette from the captured DAY baseline toward a moonlit dark by `night.t` (0=day,1=night),
  // so t=0 restores the exact dusk look. IBL is baked once (stays dusk) → we lean on exposure/fog/env + a cool
  // fill + a moon instead of re-baking. ────────────────────────────────────────────────────────────────────
  const BASE_EXPOSURE = 0.6, BASE_SUN_I = 2.1, BASE_FOG_FAR = 820, BASE_ENV = 0.5, BASE_RAYLEIGH = 2.4, BASE_TURBIDITY = 8.0;
  const BASE_SUN_COL = new THREE.Color(0xffd2a1), NIGHT_SUN_COL = new THREE.Color(0x7d8cc0);   // warm dusk sun -> cool moonlight
  const BASE_FOG_COL = new THREE.Color(0x9fb6c4), NIGHT_FOG_COL = new THREE.Color(0x0a1424);
  const BASE_WATER_COL = new THREE.Color(0x0c3850), NIGHT_WATER_COL = new THREE.Color(0x050f1c);
  const BASE_WSUN_COL = new THREE.Color(0xffd9a0), NIGHT_WSUN_COL = new THREE.Color(0x9fb0d8);
  const nightAmbient = new THREE.HemisphereLight(0x3a4a72, 0x0a1018, 0); scene.add(nightAmbient);   // cool moonlit fill, 0 by day → lifts night shadows off pitch-black
  const moon = new THREE.Mesh(new THREE.SphereGeometry(58, 22, 16), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0, fog: false }));
  moon.position.set(-1500, 820, -1900); moon.visible = false; scene.add(moon);                     // pale disc revealed at night (also glints in the water)
  const NIGHT_FIRST = 100, NIGHT_GAP_MIN = 220, NIGHT_GAP_MAX = 350, NIGHT_DUR = 120;                 // day/night cadence (sec of sailing): first night, then random day-gaps (~night 30% of the time), night length (long enough to hunt a far boss)
  const SEA_BOSS_CHANCE = 0.2, LAND_BOSS_CHANCE = 0.22;                                                // ~1 in 5 nights the Dreadmaw prowls; ~1 in 5 NIGHT-landings a Dread Captain walks the isle
  const night = { t: 0, target: 0, cool: NIGHT_FIRST, dur: 0 };                                        // t: 0=day .. 1=night (rendered); cool: sec until next nightfall; dur: sec of night remaining
  const boss = { ship: null };                                                                          // the Dreadmaw (sea boss), when one is prowling; null otherwise
  let landBoss = null;                                                                                  // transient ASHORE boss (Dread Captain) — re-rolled each night landing, stripped on leave
  // ── WEATHER — periodic squalls (rain + rough swell + lightning + wind), COMPOSED with night in applyEnv()
  // so neither clobbers the other's palette; storm visuals layer ON TOP of the night lerp. ──────────────────
  const BASE_DISTORT = 3.2, BASE_SIZE = 8.0, STORM_DISTORT = 8.5, STORM_SIZE = 4.2;                    // Water swell: storm makes it rougher (distortion up) + bigger (size down)
  const STORM_FOG_COL = new THREE.Color(0x59636b), STORM_WATER_COL = new THREE.Color(0x0a1a24);        // storm greys the fog + darkens the sea
  const STORM_FIRST = 140, STORM_DUR_MIN = 55, STORM_DUR_MAX = 95, STORM_CALM_MIN = 150, STORM_CALM_MAX = 300, STORM_WIND = 14;   // weather cadence (sec of sailing) + max wind drift (u/s)
  const storm = { intensity: 0, target: 0, nextT: STORM_FIRST, windDir: 0 };                           // intensity 0..1 (rendered), target, onset timer, wind heading
  const _rainDrops = []; let _rainMesh = null, _lightT = 0, _lightFlash = 0;                            // rain InstancedMesh pool + lightning timers
  const _envCol = new THREE.Color();                                                                    // scratch color for applyEnv lerps

  // ── helpers ──────────────────────────────────────────────────────────────────
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rand = (lo, hi) => lo + rng() * (hi - lo);
  const clampSea = (v) => Math.max(-SEA, Math.min(SEA, v));
  function normHull(obj, targetLen) {
    // Center the model on a pivot and scale so its LONGEST horizontal axis == targetLen.
    obj.rotation.set(0, 0, 0); obj.scale.setScalar(1); obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj); const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const len = Math.max(size.x, size.z) || 1; const s = targetLen / len;
    const pivot = new THREE.Group();
    // Center X/Z on the hull, but seat the model vertically so its WATERLINE (~30% up
    // from the keel) sits at the pivot origin (y=0). The reflective Water hides
    // anything below y=0, so this floats the hull with a natural draft instead of
    // burying half of it (which left only masts/sails showing).
    obj.position.x -= center.x; obj.position.z -= center.z;
    // Shallow draft: seat the keel just under the surface (masts are ~60% of the model
    // height, so a small fraction of TOTAL height keeps the hull body proud of the water).
    obj.position.y -= (box.min.y + Math.min(size.y * 0.13, 3.2));
    pivot.add(obj); pivot.scale.setScalar(s);
    pivot.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach((mt) => { mt.metalness = Math.min(1, (mt.metalness ?? 0.2) + 0.25); mt.needsUpdate = true; }); } } });
    // Which world axis is the long (bow-stern) axis after centering? tag it so the
    // caller can set BOW_OFF to face travel; hulls read bow along local +X here.
    pivot.userData.longAxis = (size.x >= size.z) ? "x" : "z";
    return pivot;
  }

  // ── Ships GLBs (reused). small=fast/weak, medium=balanced, large=slow/strong;
  // pirate hulls are the enemy skin. Loaded once, cloned per ship. ──────────────
  const HULLS = {};
  async function loadHull(key, file, len) {
    if (HULLS[key]) return HULLS[key];
    const g = await kernel.loadGLTF(file);
    HULLS[key] = { proto: g, len };
    return HULLS[key];
  }
  function makeShip(hull, shadow) {
    const src = HULLS[hull];
    const clone = src.proto.clone(true);
    clone.traverse((n) => { if (n.isMesh && n.material) n.material = Array.isArray(n.material) ? n.material.map((x) => x.clone()) : n.material.clone(); });
    const pivot = normHull(clone, src.len);
    if (shadow === false) pivot.traverse((n) => { if (n.isMesh) n.castShadow = false; });   // ~80 enemy hulls: skip the shadow pass for perf
    const mats = []; pivot.traverse((n) => { if (n.isMesh && n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((mt) => { if (mt && mt.emissive) mats.push(mt); }); });
    pivot.userData.hullMats = mats;                 // for the on-hit damage-flash (emissive red pulse)
    return pivot;
  }

  // ── VISUAL SHIP UPGRADES — "Blackened Broadside": the ship's LOOK tracks the stat upgrades you buy at
  // Tortuga (rigging → bigger/darker sails, cannon → a broadside of barrels, hull → darker armored paint,
  // crew → more flags, level → sail rank hue + an endgame ship-large hull). applyShipVisuals() re-derives
  // EVERY channel from the CURRENT state (idempotent), so the look can never drift from the numbers.
  // Recolors touch the player ship's per-instance-cloned materials only (makeShip clones per mesh) — the
  // ~48 NPC hulls are untouched. Attached accents parent to the inner hull node (hull-local space) so they
  // ride normHull's pivot scale + the per-frame position/rotation overwrite untouched. ──────────────────
  const HULL_PAINT0 = new THREE.Color(0xc9a86a), HULL_PAINT1 = new THREE.Color(0x2b1f15);   // tan oak -> near-black tar (kept off pure black so plank detail still reads)
  const FLAG_HUES = [0xc62828, 0xd4a017, 0x1f8a8a];                           // crimson / gold / teal as crew grows
  const RANK_HUES = [0xcdbb99, 0x8a2b2b, 0xb02f2f];                           // sail base hue by level band: dun / crimson / crimson-gold
  const _shipColT = new THREE.Color();
  const _shipVis = { cannon: -1 };
  let _gunsMat = null;
  function shipNode(nm) { return player.mesh ? player.mesh.getObjectByName(nm) : null; }
  function shipMeshOf(node) { if (!node) return null; if (node.isMesh) return node; let m = null; node.traverse((n) => { if (!m && n.isMesh) m = n; }); return m; }
  function shipHullMesh() { let h = null; if (player.mesh) player.mesh.traverse((n) => { if (!h && n.isMesh && /^ship-/.test(n.name || "")) h = n; }); return h; }   // hull mesh by name-prefix (NEVER hardcode 'ship-medium' — after the capstone it's 'ship-large')
  function buildCannons(hull, nPer) {                                         // nPer = barrels PER side (0..3); rebuild the whole group so counts stay exact + old geo is freed
    const old = hull.getObjectByName("pc_guns");
    if (old) { old.traverse((n) => { if (n.isMesh && n.geometry) n.geometry.dispose(); }); hull.remove(old); }
    if (nPer <= 0) return;
    if (!_gunsMat) _gunsMat = new THREE.MeshStandardMaterial({ color: 0x171719, metalness: 0.55, roughness: 0.5 });   // one shared dark-iron material for every barrel
    const g = new THREE.Group(); g.name = "pc_guns";
    const geo = new THREE.CylinderGeometry(0.17, 0.2, 1.25, 7);              // one shared low-poly barrel geo (a small accent, not a standalone asset)
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < nPer; i++) {         // s = -1 port (-X) / +1 starboard (+X)
      const b = new THREE.Mesh(geo, _gunsMat); b.castShadow = false;
      const z = nPer === 1 ? 0.4 : (-2.3 + (4.6 * i) / (nPer - 1));           // spaced along midship Z (the hull's long axis)
      b.position.set(s * 2.48, 2.8, z); b.rotation.z = Math.PI / 2;           // barrel axis along ±X -> pokes out the gunwale (y=2.8 seats it on the hull side wall, ~1.5 above the waterline)
      g.add(b);
    }
    hull.add(g);
  }
  function applyShipVisuals() {
    const hull = shipHullMesh(); if (!hull) return;
    const rig = Math.min(upg.rigging, 3), rigT = rig / 3;
    const rank = player.level >= 8 ? 2 : (player.level >= 4 ? 1 : 0);         // LEVEL picks the sail rank hue; RIGGING darkens it toward menace (one combined color so the two channels compose)
    _shipColT.set(RANK_HUES[rank]).multiplyScalar(1 - rigT * 0.4);           // rank picks the hue; RIGGING DARKENS it (preserves hue -> weathered battle canvas, never a black void)
    const sailK = 1 + rig * 0.06;                                            // speed build -> subtly bigger canvas (kept small so tall sails never wall off the chase-cam view)
    ["sail-a", "sail-b"].forEach((nm) => { const node = shipNode(nm); if (!node) return; node.scale.setScalar(sailK); const m = shipMeshOf(node); if (m && m.material) { m.material.color.copy(_shipColT); m.material.metalness = rank === 2 ? 0.28 : 0.08; m.material.needsUpdate = true; } });
    if (hull.material) { const hT = Math.min(upg.hull, 3) / 3; hull.material.color.copy(HULL_PAINT0).lerp(HULL_PAINT1, hT); hull.material.metalness = 0.3 + hT * 0.35; hull.material.needsUpdate = true; }   // armor build -> darker, more metallic hull
    const gunTier = 1 + Math.min(upg.cannon, 2);   // 1 pair of guns even on a plain sloop (it fires 2 balls), up to 3 pairs — ties to the firing volley (2..4)
    if (_shipVis.cannon !== gunTier) { buildCannons(hull, gunTier); _shipVis.cannon = gunTier; }   // rebuild the broadside only when the tier actually changed
    const shown = Math.min(player.crew.length, 2);                            // crew -> revealed + coloured flags (flag-a baseline, flag-b at 1, flag-c at 2)
    ["flag-a", "flag-b", "flag-c"].forEach((nm, i) => { const node = shipNode(nm); if (!node) return; node.visible = (i === 0) || (i <= shown); const m = shipMeshOf(node); if (m && m.material && node.visible) { m.material.color.set(FLAG_HUES[i]); m.material.needsUpdate = true; } });
  }
  function shipVisBoot() {                                                    // one-time after the ship is built: register repainted mats for the damage-flash, then set the tier-0 baseline
    if (!player.mesh) return;
    const reg = player.hullMats || (player.hullMats = []);
    ["sail-a", "sail-b", "flag-a", "flag-b", "flag-c"].forEach((nm) => { const m = shipMeshOf(shipNode(nm)); if (m && m.material && m.material.emissive && !reg.includes(m.material)) reg.push(m.material); });
    const hm = shipHullMesh(); if (hm && hm.material && hm.material.emissive && !reg.includes(hm.material)) reg.push(hm.material);
    _shipVis.cannon = -1;
    applyShipVisuals();
  }
  function maybeSwapFlagship() {                                             // endgame ONE-shot: swap the whole hull to the bigger ship-large.glb (guarded so it fires exactly once)
    if (player._flagship || player.level < 8 || !HULLS["large"] || !player.mesh) return;
    player._flagship = true;
    const old = player.mesh, px = old.position.x, py = old.position.y, pz = old.position.z, ry = old.rotation.y, vis = old.visible;
    const nu = makeShip("large", true); nu.position.set(px, py, pz); nu.rotation.y = ry; nu.visible = vis;
    scene.add(nu); scene.remove(old);
    old.traverse((n) => { if (n.isMesh) { if (n.geometry) n.geometry.dispose(); (Array.isArray(n.material) ? n.material : [n.material]).forEach((mt) => mt && mt.dispose && mt.dispose()); } });
    player.mesh = nu; player.hullMats = nu.userData.hullMats; player.flashT = 0;   // re-point the flash at the new hull's mats (else it writes into freed materials)
    shipVisBoot();                                                          // re-register + re-apply all five channels on the new hull
    banner("🏴‍☠️ Flagship! Your legend earns a bigger war-galleon");
  }

  // The ship GLBs are modelled bow along local +Z, so rotation.y = yaw already points the
  // bow along the heading (forward = (sin yaw, 0, cos yaw)). BOW_OFF = 0. (Verified top-down:
  // a -PI/2 offset sailed the hull broadside — the "horizontal, not facing straight" bug.)
  const BOW_OFF = 0;
  function faceYaw(mesh, yaw) { mesh.rotation.y = yaw + BOW_OFF; }
  const fwd = (yaw) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  // Signed relative bearing of world point (tx,tz) from a ship at (sx,sz) heading `yaw`.
  // Result in (-π,π]: sign = side (>0 STARBOARD, <0 PORT), magnitude = angle off the bow (0=dead ahead, ±π=astern).
  // (forward = (sin,cos); starboard = +90° = (cos,-sin).) Used by the broadside fire arcs.
  function relBearing(sx, sz, yaw, tx, tz) {
    const dx = tx - sx, dz = tz - sz;
    const fwdC = Math.cos(yaw) * dz + Math.sin(yaw) * dx;   // dot with forward
    const stbC = Math.cos(yaw) * dx - Math.sin(yaw) * dz;   // dot with starboard
    return Math.atan2(stbC, fwdC);
  }

  // ── Player ship ──────────────────────────────────────────────────────────────
  const player = { x: 0, z: 0, yaw: 0, speed: 0, throttle: 0, rudder: 0, mesh: null,
    maxSpeed: 46, accel: 26, turnRate: 1.15, hp: 120, hpMax: 120,
    xp: 0, level: 1, gunDmg: 18, evasion: 1, reloadTP: 0, reloadTS: 0, gold: 0, crew: [] };   // reloadTP/TS = port/starboard broadside timers
  // ── Home port TOWN + concentric DIFFICULTY ZONES ──────────────────────────────
  const townPos = { x: 0, z: 0 };
  const TOWN_NAME = "Tortuga";
  // (Synthesized from a 3-lens design panel.) A big SAFE/EASY core around Tortuga, then ONE WIDE BELT
  // per level out to the rim — so the sea ramps up GRADUALLY and each tier is a large explorable region
  // you graduate through. HARD (red) ships live far out (first red ~700u from town, ~570u past the
  // docks) so a new player can't be ambushed at the start. Ships are dealt onto even angular slots per
  // belt with a hard minimum spacing, so the ocean stays OPEN + uncrowded (no random clumps).
  const SAFE_R = 330;                            // no enemies inside this radius (scaled with the bigger SEA; player spawns near Tortuga)
  const MIN_SEP = 110;                           // minimum centre-to-centre spacing between any two ships
  const ZONES = [   // { level, rIn, rOut, count } — neutral Lv1-2 busy near start; HOSTILE belts (Lv3+) cut + WIDENED so a 235u fire-disk spans ~1 belt, not 3
    // Belts rescaled ~1.4x for the bigger SEA (1400): SAME ship counts spread over ~2x the area -> LOWER density (worst-case attackers still <=3).
    { level: 1, rIn: 330, rOut: 490, count: 11 }, { level: 2, rIn: 490, rOut: 660, count: 11 },
    { level: 3, rIn: 660, rOut: 880, count: 6 },  { level: 4, rIn: 880, rOut: 1090, count: 5 },
    { level: 5, rIn: 1090, rOut: 1250, count: 6 },{ level: 6, rIn: 1250, rOut: 1350, count: 5 },
    { level: 7, rIn: 1350, rOut: 1400, count: 4 },
  ];   // 48 ships (26 hostile Lv3+) — outer belts filled out modestly so the far sea isn't empty, tuned to keep worst-case attackers <=3
  function levelForDist(d) { if (d < SAFE_R) return 0; for (const z of ZONES) if (d < z.rOut) return z.level; return 7; }
  function diffOf(level) {
    if (level <= 0) return { tier: "Safe",   color: 0x7fffd4, hex: "#7fffd4" };
    if (level <= 2) return { tier: "Easy",   color: 0x36d46a, hex: "#36d46a" };
    if (level <= 4) return { tier: "Medium", color: 0xffb03a, hex: "#ffb03a" };
    return { tier: "Hard", color: 0xff4d4d, hex: "#ff4d4d" };
  }
  function hullLabel(h) { return h === "small" ? "Sloop" : h === "medium" ? "Brigantine" : h === "pirateMed" ? "Pirate Cutter" : "Marauder Galleon"; }

  // ── Island content scaling (by difficulty level, like the ships). Pirates + chests + island SIZE all grow
  // with level: easy = small island 3 pirates/1 chest near Tortuga; hard = big island 8-9 pirates/4 chests far out. ──
  const REFILL_SECS = 180;   // a plundered island regrows its pirates + treasure after 3 min of world-time
  function islandCounts(level) {
    const nFoes = Math.max(3, Math.min(9, Math.round(2 + level * 0.9)));            // 3 (easy) .. 9 (cap — never over-crowd)
    const nChests = level <= 2 ? 1 : level <= 4 ? 2 : 3 + (level >= 6 ? 1 : 0);
    return { nFoes, nChests };
  }
  function islandRadiusFor(level) { return 90 + level * 13 + rand(-12, 18); }        // island radius grows with level (small easy .. big hard)
  function buildIslandLevelPlan(n) { const p = []; for (let i = 0; i < n; i++) { const t = i / Math.max(1, n - 1); p.push(Math.max(1, Math.min(7, Math.round(1 + t * t * 6)))); } return p; }   // ascending, front-biased to easy levels

  // ── COVE ARENA (PVP) bridge — runtime/net/covenet.js drives online matches
  // through this surface. pvp.active gates the sandbox systems; pvp-flagged
  // entries in npcs[] are REMOTE ships (players/bots) whose movement + hp are
  // owned by the net module — the sandbox must never AI-step or hp-kill them. ──
  const pvp = { active: false, hooks: null };

  // ── NPC ships ────────────────────────────────────────────────────────────────
  const npcs = [];   // { x,z,yaw,speed,mesh,hostile, level, dmg, hp, hpMax, type, rIn, rOut, ... }

  // ── Islands: LARGE heightfield landmasses (rolling hills, beach->grass->rock by height) dressed
  // with real low-poly GLB palms/rocks/trees. Big enough to become on-foot explore zones next. ──
  const islands = [];   // { x,z,r,name,group,dockR }
  const ISLE_N = (m.islands != null ? m.islands : 9);
  const ISLE_NAMES = ["Gullrock", "Saltspit", "Wreckers' Cay", "Palm Hollow", "Bone Atoll",
    "Marlow Key", "The Drowned Bell", "Coral Fang", "Widow's Rock", "Tarhaven",
    "Sunken Chapel", "Mistcove", "Iron Shoal", "Rum Island", "Cutlass Cay", "Barnacle Bar",
    "Kraken Reef", "Gallows Point", "Smuggler's Hollow", "Pelican Spit", "Black Fathom", "Storm Cradle"];

  // Real GLB island dressing (CC0/CC-BY from the Poly.Pizza library), loaded once + cloned.
  const PROPS = {};
  async function loadProp(key, file) { if (PROPS[key] !== undefined) return; try { PROPS[key] = await kernel.loadGLTF(file); } catch (e) { console.warn("[props] load failed", file, e && e.message); PROPS[key] = null; } }
  function makeProp(key, targetH, centerXZ) {
    const src = PROPS[key]; if (!src) return null;
    const o = src.clone(true);
    o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.position.set(0, 0, 0); o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o); const size = new THREE.Vector3(); box.getSize(size);
    const s = targetH / (size.y || 1); const pivot = new THREE.Group();
    o.position.y -= box.min.y;                                // seat the base at pivot y=0
    if (centerXZ) { o.position.x -= (box.min.x + box.max.x) / 2; o.position.z -= (box.min.z + box.max.z) / 2; }   // center horizontally on the pivot: some assets (rocks.glb) sit OFF their own origin, so the pivot must land under the rock's true centre — else placement/collision/tilt all reference a point far from the rock
    pivot.add(o); pivot.scale.setScalar(s);
    pivot.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
    return pivot;
  }

  // ── ANIMATED away-party characters (hero, foot-pirates, crew). The character GLB is a Mixamo-rigged
  // SKINNED mesh with a walk/idle clip — so it must be cloned with SkeletonUtils and driven by its own
  // AnimationMixer (a plain .clone() would freeze the pose). Loaded once; makeCharacter() spins up one
  // independent instance (own mixer) tinted to a side, seated + scaled like makeProp. ─────────────────
  // Distinct animated GLBs per role (CC0 Quaternius RPG cast + a Poly.Pizza skeleton — all rigged, multi-clip).
  const CHAR_URLS = {
    hero: "assets/props/char-hero.glb",         // Ranger  — Bow_Draw/Bow_Shoot + Punch
    pirate: "assets/props/char-pirate.glb",     // Rogue   — Dagger_Attack swashbuckler (foot enemy)
    marauder: "assets/props/char-marauder.glb", // Warrior — Sword_Attack brute (tougher, rendered bigger)
    crew: "assets/props/char-crew.glb",         // Cleric  — Staff_Attack/Spell1 ally
    wizard: "assets/props/char-wizard.glb",     // Wizard  — Spell1/Spell2; the HIRED CREW ally (ranged spell shooter)
    skeleton: "assets/props/char-skeleton.glb", // undead elite (reserved)
  };
  const _charGltf = {};   // role -> loaded gltf
  let _heroIsMeshy = false;   // hero uses the Meshy pirate CAPTAIN (own rig + clips) — skip the Quaternius Sword_Attack borrow
  // Meshy characters ship as a small BASE glb (mesh+skeleton+idle, 512 tex) + tiny CLIP-ONLY glbs (skeleton stripped;
  // just the animation, targeting the same bone names). We append each clip into the base gltf's .animations so the
  // existing makeCharacterRole (mixer + name-based clip pick) drives them exactly like the multi-clip Quaternius files.
  // idle is baked into the base glb. hit/jump are captain Mixamo extras (crew may omit).
  const MESHY_CLIPS = ["walk", "run", "attack", "ranged", "death", "hit", "jump"];
  const MESHY_CREW = ["gunner", "swashbuckler", "bosun"];   // hired pirate crew models, rotated per crew member for variety
  const _MESHY_VER = (import.meta.url.match(/[?&]v=(\w+)/) || [])[1] || "";   // cache-bust the character GLBs with the same ?v= as the module (so a bumped version reloads them)
  const _meshyURL = (p) => new URL(`assets/props/meshy/${p}` + (_MESHY_VER ? `?v=${_MESHY_VER}` : ""), document.baseURI).href;
  async function loadMeshyChar(loader, key) {
    const base = await loader.loadAsync(_meshyURL(`${key}.glb`));
    for (const clip of MESHY_CLIPS) {
      try {
        const g = await loader.loadAsync(_meshyURL(`${key}_${clip}.glb`));
        if (g.animations && g.animations[0]) {
          g.animations[0].name = clip;   // stable names for clipFor pickers
          base.animations.push(g.animations[0]);
        }
      } catch (e) { /* clip absent for this role — fine */ }
    }
    return base;
  }
  let _gunGltf = null;    // the hero's OLD GUN (flintlock pistol) — attached to the hand, replaces the bow
  async function preloadChar() {
    const loader = new GLTFLoader();
    // Captain base is Draco-compressed — same decoder path as kernel.
    try {
      const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
      const draco = new DRACOLoader();
      draco.setDecoderPath("assets/vendor/three/examples/jsm/libs/draco/");
      draco.setDecoderConfig({ type: "js" });
      loader.setDRACOLoader(draco);
    } catch (e) { console.warn("[char] DRACOLoader unavailable", e && e.message); }
    await Promise.all(Object.keys(CHAR_URLS).map(async (role) => {
      try { _charGltf[role] = await loader.loadAsync(new URL(CHAR_URLS[role], document.baseURI).href); }
      catch (e) { console.warn("[char] load failed", role, e && e.message); _charGltf[role] = null; }   // falls back to hero role
    }));
    try { _gunGltf = await loader.loadAsync(new URL("assets/props/cutlass.glb", document.baseURI).href); } catch (e) { _gunGltf = null; }   // pirate CUTLASS (no flintlock in the library) — held in the hand
    try { _charGltf.hero = await loadMeshyChar(loader, "captain"); _heroIsMeshy = true; }   // HERO = Meshy pirate CAPTAIN (replaces the reused Ranger)
    catch (e) { console.warn("[char] captain load failed — keeping Ranger hero", e && e.message); }
    await Promise.all(MESHY_CREW.map(async (key) => {   // hired crew = Meshy PIRATE crew (replaces the out-of-place Wizard mage)
      try { _charGltf[key] = await loadMeshyChar(loader, key); }
      catch (e) { console.warn("[char] crew load failed", key, e && e.message); }
    }));
  }
  // Arm the pirate: hide the Ranger's bow and put a CUTLASS in the RIGHT HAND (bone FistR — the hand, not the forearm).
  let WPN_SIZE = 0.95, WPN_OX = 0.0, WPN_OY = 0.08, WPN_OZ = -0.04, WPN_RX = -1.571, WPN_RY = 2.094, WPN_RZ = 0.524;   // cutlass grip on the Meshy captain's RightHand: grip pulled back to the palm BASE (not pushed past the fingers "in front") + a small into-palm nudge — best-effort on an OPEN hand (rig has no finger bones to close), blade UP+FORWARD
  const FL_SIZE = 0.72, FL_OX = 0.0, FL_OY = 0.06, FL_OZ = -0.04, FL_RX = -2.348, FL_RY = 0.973, FL_RZ = 0.583;       // flintlock grip on the Meshy captain's RightHand: small pistol, grip pulled back to the palm BASE + into-palm nudge (best-effort on the open hand); barrel level & pointing OUTWARD at enemies
  let heroWeapon = "cutlass";   // "cutlass" (melee swing) | "flintlock" (ranged shot) — press Q ashore to switch
  function equipHeroGun(pivot) {   // attach the ACTIVE hero weapon (cutlass or flintlock) to the RIGHT HAND (FistR); hide the bow
    if (!pivot) return;
    pivot.traverse((n) => { if (n.isMesh && /bow/i.test(n.name)) n.visible = false; });   // hide "Ranger_Bow"
    let hand = null; pivot.traverse((n) => { if (n.isBone && /^FistR$|^RightHand$/i.test(n.name)) hand = hand || n; });   // the RIGHT HAND — Quaternius "FistR" OR Meshy "RightHand" (NOT the forearm/elbow)
    if (!hand) { pivot.traverse((n) => { if (n.isBone && /Fist1R|HandR|WristR|righthand|hand_r$/i.test(n.name)) hand = hand || n; }); }
    if (!hand) return;
    for (let i = hand.children.length - 1; i >= 0; i--) { const c = hand.children[i]; if (c.isBone) continue; if (c.userData && c.userData.procedural) c.traverse((n) => { if (n.isMesh) { if (n.geometry) n.geometry.dispose(); (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m && m.dispose && m.dispose()); } }); hand.remove(c); }   // clear prior weapon (dispose the procedural flintlock's fresh geos/mats; the cutlass GLB is SHARED — never dispose it)
    let wpn, size, ox, oy, oz, rx, ry, rz;
    if (heroWeapon === "flintlock") { wpn = makeFlintlock(); size = FL_SIZE; ox = FL_OX; oy = FL_OY; oz = FL_OZ; rx = FL_RX; ry = FL_RY; rz = FL_RZ; }
    else { if (!_gunGltf) return; wpn = _gunGltf.scene.clone(true); size = WPN_SIZE; ox = WPN_OX; oy = WPN_OY; oz = WPN_OZ; rx = WPN_RX; ry = WPN_RY; rz = WPN_RZ; }
    const box = new THREE.Box3().setFromObject(wpn), sz = new THREE.Vector3(); box.getSize(sz);
    // A hand BONE's world scale varies wildly by rig (Quaternius FistR ~5.5, Meshy RightHand ~0.065). Size + offset were
    // authored against the ~5.5x scale, so normalise by the bone's ACTUAL world scale -> the weapon is the same REAL size
    // (and sits the same real distance from the fist) on ANY rig, instead of vanishing to a speck on the Meshy captain.
    hand.updateWorldMatrix(true, false);
    const _hs = new THREE.Vector3(); hand.getWorldScale(_hs); const bscale = (_hs.x + _hs.y + _hs.z) / 3 || 1;
    const k = 5.5 / bscale;
    wpn.scale.setScalar(size / (Math.max(sz.x, sz.y, sz.z) || 1) * k);
    wpn.position.set(ox * k, oy * k, oz * k); wpn.rotation.set(rx, ry, rz);
    wpn.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
    hand.add(wpn);
  }
  function switchWeapon() {   // Q ashore — swap cutlass (melee swing) <-> flintlock (ranged shot)
    if (mode !== "ashore" || !hero.mesh) return;
    heroWeapon = heroWeapon === "cutlass" ? "flintlock" : "cutlass";
    equipHeroGun(hero.mesh);
    banner(heroWeapon === "cutlass" ? "⚔ Cutlass drawn — LEFT-CLICK to swing" : "🔫 Flintlock drawn — LEFT-CLICK to shoot");
  }
  // Procedural Three.js FLINTLOCK pistol (owner asked me to try one — no flintlock exists in the asset library). Low-poly:
  // octagonal barrel + brass muzzle, breech + lock plate + S-cock hammer + frizzen, curved wooden grip + brass butt,
  // trigger + guard + ramrod. Barrel points +Z, grip drops down-back. ─────────────────────────────────────────────
  function makeFlintlock() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x30333a, metalness: 0.8, roughness: 0.38 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, metalness: 0.08, roughness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb0862f, metalness: 0.65, roughness: 0.4 });
    const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.32, 0.38, 6.0, 8), steel, 0, 0.2, 1.5, Math.PI / 2, 0, 0);   // octagonal barrel
    add(new THREE.CylinderGeometry(0.44, 0.44, 0.45, 8), brass, 0, 0.2, 4.4, Math.PI / 2, 0, 0);  // brass muzzle ring
    add(new THREE.BoxGeometry(0.72, 0.9, 1.7), wood, 0, 0.08, -0.9);                              // breech / stock wrist
    add(new THREE.BoxGeometry(0.2, 0.62, 1.0), steel, 0.44, 0.26, -0.7);                          // lock plate (side)
    add(new THREE.BoxGeometry(0.15, 0.75, 0.3), steel, 0.46, 0.72, -1.15, -0.55, 0, 0);           // S-cock hammer
    add(new THREE.BoxGeometry(0.16, 0.5, 0.14), brass, 0.45, 0.56, -0.55, 0.45, 0, 0);            // frizzen
    add(new THREE.BoxGeometry(0.62, 2.5, 0.9), wood, 0, -1.35, -1.75, 0.5, 0, 0);                 // grip (drops down-back)
    add(new THREE.BoxGeometry(0.74, 0.42, 1.05), brass, 0, -2.6, -2.6, 0.5, 0, 0);                // brass butt cap
    add(new THREE.TorusGeometry(0.46, 0.08, 6, 12, Math.PI), brass, 0, -0.72, -1.2, 0, Math.PI / 2, 0);   // trigger guard
    add(new THREE.BoxGeometry(0.1, 0.42, 0.1), steel, 0, -0.55, -1.18);                           // trigger
    add(new THREE.CylinderGeometry(0.07, 0.07, 4.8, 6), wood, 0, -0.28, 1.5, Math.PI / 2, 0, 0);  // ramrod under the barrel
    g.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
    g.userData.procedural = true;   // fresh geos+mats -> safe to dispose on weapon switch (unlike the shared cutlass GLB)
    return g;
  }
  // One independent animated instance of a role: skeleton-clone (skinned), tint, seat + scale, and loop the
  // Idle clip (else Walk/Run, else clip[0]). Its own AnimationMixer (driven per-frame by the caller).
  function makeCharacterRole(role, targetH, tint) {
    const g = _charGltf[role] || _charGltf.hero; if (!g) return null;
    const o = skeletonClone(g.scene);
    const _l = []; o.traverse((n) => { if (n.isLight) _l.push(n); }); _l.forEach((l) => l.parent && l.parent.remove(l));
    // Faction cue ONLY — a FAINT wash toward the tint (was a flat setHex repaint that turned every mesh one dark
    // color -> "black/blue human blocks"). Now the Quaternius meshes keep their real per-part colors (skin/cloth/
    // leather) and read as real characters; friend/foe is signalled by the HP-bar colour, not by recolouring bodies.
    if (tint != null) { const _tc = new THREE.Color(tint); o.traverse((n) => { if (n.isMesh && n.material) { n.material = Array.isArray(n.material) ? n.material.map((x) => x.clone()) : n.material.clone(); (Array.isArray(n.material) ? n.material : [n.material]).forEach((mt) => { if (mt.color) mt.color.lerp(_tc, 0.13); }); } }); }
    o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.position.set(0, 0, 0); o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o); const size = new THREE.Vector3(); box.getSize(size);
    const s = targetH / (size.y || 1); const pivot = new THREE.Group();
    o.position.y -= box.min.y; pivot.add(o); pivot.scale.setScalar(s);
    pivot.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
    const mixer = new THREE.AnimationMixer(o);
    let clips = g.animations || [];
    if (role === "hero" && !_heroIsMeshy && _charGltf.marauder && _charGltf.marauder.animations) {   // the Ranger has NO blade swing — borrow the Warrior's Sword_Attack (shared Quaternius skeleton). The Meshy CAPTAIN has its OWN Sword_Slash on a different rig, so skip the borrow (its clip wouldn't bind to those bones).
      const sw = _charGltf.marauder.animations.find((c) => /sword[_ ]?attack$/i.test(c.name)) || _charGltf.marauder.animations.find((c) => /sword[_ ]?attack/i.test(c.name));
      if (sw && !clips.some((c) => /sword[_ ]?attack/i.test(c.name))) clips = clips.concat(sw);
    }
    const pick = (re) => clips.find((c) => re.test(c.name));
    // Match BOTH the Quaternius RPG clips (Idle, Run/Walk, Sword_Attack, Spell1, Death) AND the Meshy library clips
    // (named "Armature|Idle|baselayer", "|Confident_Walk|", "|RunFast|", "|Right_Hand_Sword_Slash|", "|Cowboy_Quick_Draw_Shooting|",
    // "|Dead|"). Meshy-specific patterns go FIRST (they need surrounding pipes so they never mis-match a Quaternius name).
    const clipFor = {
      idle: pick(/\|idle\|/i) || pick(/^idle$/i) || pick(/^idle_weapon$/i) || clips[0],
      run: pick(/confident_walk|runfast/i) || pick(/^run$/i) || pick(/^walk$/i) || pick(/\brun\b/i) || clips[0],
      attack: pick(/sword_slash|right_hand_sword/i) || pick(/dagger[_ ]?attack|sword[_ ]?attack|staff[_ ]?attack|slash/i) || pick(/^attack$/i) || pick(/^punch$/i) || pick(/^spell1$/i),
      ranged: pick(/quick_draw|shooting|archery/i) || pick(/^ranged$/i) || pick(/bow[_ ]?shoot/i) || pick(/^spell[12]$/i) || pick(/staff[_ ]?attack/i) || pick(/bow/i),
      death: pick(/\|dead\||death|die/i) || pick(/^death$/i),
      hit: pick(/^hit$/i) || pick(/hit|hurt|react/i),
      jump: pick(/^jump$/i) || pick(/jump/i),
    };
    const actions = {};
    for (const k in clipFor) if (clipFor[k]) actions[k] = mixer.clipAction(clipFor[k]);
    if (!actions.ranged) actions.ranged = actions.attack;   // melee-only class -> reuse the swing for a "loose"
    if (!actions.attack) actions.attack = actions.ranged || actions.idle;
    let current = null;
    function play(name, opts) {   // crossfade to a named action; opts.once = play through then hold last frame
      opts = opts || {}; const next = actions[name] || actions.idle; if (!next || (current === next && !opts.force)) return;
      if (current) current.fadeOut(0.15);
      next.reset(); next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = !!opts.once; next.timeScale = opts.timeScale || 1; next.fadeIn(0.15).play();
      current = next;
    }
    play("idle");
    return { pivot, mixer, play, hasAnim: clips.length > 0 };
  }
  function makeCharacter(targetH, tint) { return makeCharacterRole("hero", targetH, tint); }   // back-compat (hero role)

  // cheap 2D value-noise + 4-octave fbm for rolling terrain
  function _vn(x, z) { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const h = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function _fbm(x, z) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += amp * _vn(x * f, z * f); f *= 2; amp *= 0.5; } return s; }
  // island surface height at LOCAL (lx,lz): a smoothstep dome (flat beach at the shore, hilly inland)
  // modulated by fbm; beyond the shore radius it dives underwater (hidden by the reflective water).
  // `sh` (optional per-island shape) nudges the SILHOUETTE so no two islands read the same:
  //   p = dome exponent (<1 broad plateau top .. >1 sharp central peak), a = hill amplitude, f = relief frequency.
  //   MUST be passed to every _isleH call for an island (on-foot ground height depends on it) — stored as is.sh.
  function _isleH(lx, lz, r, ox, oz, sh) {
    const rr = Math.hypot(lx, lz); if (rr >= r) return -3;
    const p = sh ? sh.p : 1, a = sh ? sh.a : 0.95, f = sh ? sh.f : 0.016;
    let fall = 1 - rr / r; fall = fall * fall * (3 - 2 * fall);
    fall = p === 1 ? fall : Math.pow(fall, p);                 // p<1 flattens the top (more dry land), p>1 sharpens the peak
    const hill = _fbm((lx + ox) * f, (lz + oz) * f);
    return fall * (r * 0.5) * (0.3 + a * hill) - 1.2;
  }
  // deterministic per-island shape (seeded rng — world stays reproducible). Kept subtle so every island is still foot-landable.
  function pickIslandShape() { return { p: 0.74 + rng() * 0.82, a: 0.80 + rng() * 0.30, f: 0.012 + rng() * 0.009 }; }

  function buildIsland(x, z, r, name, level) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const ox = rng() * 900, oz = rng() * 900, hMax = r * 0.5;             // per-island noise offset -> varied shapes
    const sh = pickIslandShape();                                        // per-island silhouette (dome/relief) — threaded into every _isleH for this island
    // per-island palette nudge (coherent across the bands, distinct island-to-island) + vegetation bias
    const dh = (rng() - 0.5) * 0.06, ds = (rng() - 0.5) * 0.16, dl = (rng() - 0.5) * 0.10, veg = rng();
    const SEG = Math.max(24, Math.min(60, Math.round(r / 3)));            // terrain resolution scales with size
    const geo = new THREE.PlaneGeometry(r * 2, r * 2, SEG, SEG); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = [];
    const sand = new THREE.Color(0xd9c78c).offsetHSL(dh * 0.5, ds * 0.4, dl * 0.5),
          grass = new THREE.Color(0x5f7d3a).offsetHSL(dh, ds, dl * 0.7),
          grassHi = new THREE.Color(0x3d5b2a).offsetHSL(dh, ds, dl * 0.7),
          rock = new THREE.Color(0x867c6b).offsetHSL(dh * 0.3, ds * 0.2, dl * 0.4), cc = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i), hh = _isleH(lx, lz, r, ox, oz, sh);
      pos.setY(i, hh);
      if (hh < 1.6) cc.copy(sand);
      else if (hh < hMax * 0.66) cc.copy(grass).lerp(grassHi, Math.min(1, (hh - 1.6) / (hMax * 0.6)));
      else cc.copy(rock);
      col.push(cc.r, cc.g, cc.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    land.receiveShadow = true; g.add(land);
    // dress the surface with real GLB palms / trees / rocks (skip the waterline + bare peaks). Density + mix vary per island:
    // veg<0.38 tropical palm cay · 0.38-0.72 wooded · >0.72 rocky crag (mostly bare rock).
    const nprops = Math.round(r / 15 * (0.7 + rng() * 0.95)), rocks = [], placed = [];
    for (let i = 0; i < nprops; i++) {
      const a = rng() * 6.28, rd = r * (0.12 + rng() * 0.62), lx = Math.cos(a) * rd, lz = Math.sin(a) * rd, hh = _isleH(lx, lz, r, ox, oz, sh);
      if (hh < 1.4 || hh > hMax * 0.82) continue;
      const roll = rng();
      const kind = veg < 0.38 ? (roll < 0.78 ? "palm" : roll < 0.9 ? "tree" : "rocks")
                 : veg < 0.72 ? (roll < 0.35 ? "palm" : roll < 0.85 ? "tree" : "rocks")
                 :              (roll < 0.15 ? "palm" : roll < 0.4 ? "tree" : "rocks");
      const th = kind === "rocks" ? 3 + rng() * 5 : 10 + rng() * 8;
      const fr = kind === "rocks" ? 2.2 + th * 0.32 : 2.2;            // footprint radius: rocks are WIDE, palm/tree = a narrow trunk
      if (placed.some((q) => Math.hypot(q.x - lx, q.z - lz) < (fr + q.fr) * 0.9)) continue;   // SPACING — never clip into an already-placed prop
      const p = makeProp(kind, th, kind === "rocks"); if (!p) continue;   // rocks: center the off-origin cluster on the pivot (see makeProp) so it sits AT (lx,lz) and the collision disc matches
      p.rotation.y = rng() * 6.28;
      if (kind === "rocks") {
        // Seat the (now centered) rock FLAT at the LOWEST point of its footprint, so it's embedded into the uphill
        // slope and never floats on the downhill edge. NO slope-tilt: rocks.glb sits off its own origin, so rotating
        // the pivot swung the rock through a huge arc and flung parts 100-200u into the sky (the floating-rocks bug).
        const d = fr * 0.85;
        const hE = _isleH(lx + d, lz, r, ox, oz, sh), hW = _isleH(lx - d, lz, r, ox, oz, sh), hN = _isleH(lx, lz + d, r, ox, oz, sh), hS = _isleH(lx, lz - d, r, ox, oz, sh);
        const hMin = Math.min(hh, hE, hW, hN, hS), hRange = Math.max(hh, hE, hW, hN, hS) - hMin;
        if (hMin < 1.0) continue;                                      // footprint must stay clear of the waterline
        if (hRange > th) continue;                                     // slope across the footprint steeper than the rock is tall -> a flat rock would bury; skip (place it on gentler ground)
        p.position.set(lx, hMin - 0.3, lz);
      } else {
        p.position.set(lx, hh - 0.4, lz);                             // narrow trunk: seat on the centre height
      }
      g.add(p);
      placed.push({ x: lx, z: lz, fr });
      if (kind === "rocks") rocks.push({ x: lx, z: lz, cr: fr });     // LOCAL pos + collision radius = the exact footprint used for placement
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 30, 0.9, 6, 48), new THREE.MeshBasicMaterial({ color: 0x39c6e6, transparent: true, opacity: 0.15 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.4; g.add(ring);
    scene.add(g);
    const lv = level != null ? level : Math.max(1, levelForDist(Math.hypot(x, z)));
    const is = { x, z, r, name, group: g, dockR: r + 36, ox, oz, sh, rocks,   // ox/oz/sh let _isleH be recomputed for on-foot ground height; rocks = LOCAL collision discs
      level: lv, tier: diffOf(lv), foes: [], chests: [], populated: false, active: false, refillT: 0 };
    planIslandContent(is);                                          // seed persistent pirates + chests (data only; meshes lazy on cull-in)
    return is;
  }
  // Seed an island's persistent content (DATA only — meshes are built lazily when the island culls in).
  // Anchored on the island CENTER (no landing yet at world-gen). Counts + kinds scale with island level.
  function planIslandContent(is) {
    const { nFoes, nChests } = islandCounts(is.level);
    is.foes = []; is.chests = [];
    // foes are melee only: a couple tough MARAUDERS (lv>=4), rest PIRATES. (The wizard/caster is an ALLY — hired crew.)
    // Made STRONGER (owner) — more hull + hit harder; marauders are proper bruisers.
    for (let i = 0; i < nFoes; i++) {
      const marauder = is.level >= 4 && i < 2;
      const sp = _spotNear(is, is.x, is.z, is.r * 0.15, is.r * 0.85);
      const baseHp = 44 + is.level * 14, hpm = marauder ? Math.round(baseHp * 1.85) : baseHp;
      is.foes.push({ x: sp.x, z: sp.z, yaw: rng() * 6.28, hp: hpm, hpMax: hpm, dmg: Math.round((6 + is.level * 1.4) * (marauder ? 1.7 : 1)), level: is.level, kind: marauder ? "marauder" : "pirate", mesh: null, mixer: null, atkT: rng() * 1.5, alive: true });
    }
    for (let i = 0; i < nChests; i++) {
      const sp = _spotNear(is, is.x, is.z, is.r * 0.1, is.r * 0.85);
      is.chests.push({ x: sp.x, z: sp.z, mesh: null, gold: 20 + Math.floor(rng() * 30) + is.level * 10, taken: false });
    }
  }
  // Build the island's character/chest MESHES (once, on first cull-in). Scene-parented (world coords) so the
  // on-foot movement code is unchanged; visibility is toggled by activate/deactivate.
  function buildIslandMeshes(is) {
    if (is.populated) return;
    for (const f of is.foes) {
      const c = f.kind === "marauder" ? makeCharacterRole("marauder", 12.8, 0x6a121a) : makeCharacterRole("pirate", 9, 0x7a2f1a);   // marauders render clearly bigger + a deeper faction cast
      if (!c) continue; f.mesh = c.pivot; f.mixer = c.mixer; f.play = c.play;
      f.mesh.position.set(f.x, groundYOn(is, f.x, f.z), f.z); f.mesh.rotation.y = f.yaw + HERO_OFF; f.mesh.visible = f.alive; scene.add(f.mesh);
    }
    for (const c of is.chests) {
      const mesh = makeProp("chest", 6); if (!mesh) continue; c.mesh = mesh;
      mesh.position.set(c.x, groundYOn(is, c.x, c.z), c.z); mesh.rotation.y = rng() * 6.28; mesh.visible = !c.taken; scene.add(mesh);
    }
    is.populated = true;
  }
  function activateIsland(is) {
    if (is.isTown) return;
    if (!is.populated) buildIslandMeshes(is);
    is.active = true;
    for (const f of is.foes) if (f.mesh) f.mesh.visible = f.alive;   // show its pirates (so you SEE them from the boat)
    for (const c of is.chests) if (c.mesh) c.mesh.visible = !c.taken;
  }
  function deactivateIsland(is) {
    is.active = false;
    for (const f of is.foes) if (f.mesh) f.mesh.visible = false;     // hide when the island is far (scene-parented, so not covered by group cull)
    for (const c of is.chests) if (c.mesh) c.mesh.visible = false;
  }
  function refillIsland(is, near) {
    for (const f of is.foes) if (f.mesh) scene.remove(f.mesh);
    for (const c of is.chests) if (c.mesh) scene.remove(c.mesh);
    planIslandContent(is); is.populated = false;
    if (near) { buildIslandMeshes(is); is.active = true; }
  }
  function stepIslandChars(dt) {   // idle-animate pirates on NEAR islands (so they look alive from the boat); NO AI at sea
    for (const is of islands) { if (!is.active || is.isTown || is === ashoreIsle) continue; for (const f of is.foes) if (f.alive && f.mixer) f.mixer.update(dt); }
  }
  function jitter(geo, amt) {   // (still used by the town base)
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { p.setX(i, p.getX(i) + (rng() - 0.5) * amt); p.setZ(i, p.getZ(i) + (rng() - 0.5) * amt); }
    p.needsUpdate = true; geo.computeVertexNormals();
  }
  function scatterIslands() {
    const plan = buildIslandLevelPlan(ISLE_N);              // ascending levels — easy-small near Tortuga, hard-big far out
    let placed = 0;
    for (const lv of plan) {
      const zone = ZONES[lv - 1] || ZONES[ZONES.length - 1];
      const r = islandRadiusFor(lv);
      const rIn = Math.max(zone.rIn, 300 + r);              // keep the harbour clear: the island's INNER EDGE (centre-r) stays >=300 from origin so it never reaches the spawn/docks
      let ok = false, x = 0, z = 0;
      for (let t = 0; t < 80 && !ok; t++) {
        const ang = rng() * 6.28, hi = Math.max(rIn + 1, zone.rOut), dist = Math.sqrt(rIn * rIn + rng() * (hi * hi - rIn * rIn));   // area-uniform inside the level's belt
        x = Math.cos(ang) * dist; z = Math.sin(ang) * dist;
        ok = Math.hypot(x, z) - r >= 300 && !islands.some((is) => Math.hypot(is.x - x, is.z - z) < is.r + r + 120);   // inner edge clears the harbour + spacing
      }
      if (!ok) continue;                                    // couldn't fit cleanly -> skip (sparse > crowded)
      islands.push(buildIsland(x, z, r, ISLE_NAMES[placed % ISLE_NAMES.length], lv));
      placed++;
    }
  }

  function overlapsLand(x, z, pad) { return islands.some((is) => Math.hypot(is.x - x, is.z - z) < is.r + (pad || 0)); }
  // A spawn spot just off the Tortuga docks in OPEN water — fan out from due-south, stepping outward, until clear of the
  // town AND every island footprint (a near island can otherwise reach the docks and GROUND the ship at spawn/respawn).
  function harborSpawn() {
    let best = { x: townPos.x, z: townPos.z + 300, yaw: 0, clearD: -1 };
    for (let sd = 280; sd < 620; sd += 30)
      for (let k = 0; k < 15; k++) {
        const ang = Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 9);
        const sx = townPos.x + Math.cos(ang) * sd, sz = townPos.z + Math.sin(ang) * sd;
        if (overlapsLand(sx, sz, 14)) continue;
        const away = Math.atan2(sx - townPos.x, sz - townPos.z);          // point the bow away from town, then find the clearest CHANNEL
        for (let h = 0; h < 11; h++) {
          const hy = away + (h % 2 ? 1 : -1) * Math.ceil(h / 2) * (Math.PI / 12), dx = Math.sin(hy), dz = Math.cos(hy);
          let clearD = 0; for (let d = 25; d <= 260; d += 25) { if (overlapsLand(sx + dx * d, sz + dz * d, 10)) break; clearD = d; }
          if (clearD >= 220) return { x: sx, z: sz, yaw: hy };            // a clear lane to open sea -> spawn facing it
          if (clearD > best.clearD) best = { x: sx, z: sz, yaw: hy, clearD };
        }
      }
    return best;
  }
  // Line-of-sight at SEA: is the segment (ax,az)->(bx,bz) blocked by an island? (an island can't be shot through) —
  // keeps combat honest so a boat hidden behind land can't fire on you, and reduces distant pile-ons.
  function segBlockedByIsland(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    for (const is of islands) {
      let t = ((is.x - ax) * dx + (is.z - az) * dz) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + dx * t - is.x, cz = az + dz * t - is.z;
      if (cx * cx + cz * cz < is.r * is.r) return true;   // island disk crosses the sight line
    }
    return false;
  }

  // The HOME PORT — a bigger island with a green, cabins with pitched roofs, and wooden
  // piers reaching into the water. It's dockable (trade/upgrade/hire later) and is the
  // anchor point that enemy difficulty scales away from.
  function buildTown(x, z) {
    const r = 84, g = new THREE.Group(); g.position.set(x, 0, z);
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 0.95 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x6b8a45, roughness: 1 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.14, 3.4, 28, 1), sandMat);
    base.position.y = 0.6; base.receiveShadow = true; jitter(base.geometry, 1.0); g.add(base);
    const green = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.86, 2.6, 26), grassMat);
    green.position.y = 2.3; green.receiveShadow = true; g.add(green);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, 24, 18), grassMat);
    hill.position.set(-r * 0.28, 3.4, -r * 0.32); hill.castShadow = true; jitter(hill.geometry, 2.2); g.add(hill);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcaa06a, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8c3b2c, roughness: 1 });
    for (let i = 0; i < 11; i++) {                                   // clustered cabins
      const ba = rng() * 6.28, bd = r * (0.18 + rng() * 0.5);
      const bw = 6 + rng() * 5, bh = 6 + rng() * 5, bp = 6 + rng() * 5;
      const bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd, ry = rng() * 6.28;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bp), wallMat);
      wall.position.set(bx, 3.2 + bh / 2, bz); wall.rotation.y = ry; wall.castShadow = true; g.add(wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(bw, bp) * 0.82, 4.6, 4), roofMat);
      roof.position.set(bx, 3.2 + bh + 1.7, bz); roof.rotation.y = ry + Math.PI / 4; roof.castShadow = true; g.add(roof);
    }
    const dockMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
    for (let d = -1; d <= 1; d++) {                                  // three piers on the seaward side
      const pier = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 48), dockMat);
      pier.position.set(d * 22, 1.4, r * 0.88 + 22); pier.castShadow = true; g.add(pier);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 36, 1.1, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.3 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.7; g.add(ring);
    scene.add(g);
    return { x, z, r, name: TOWN_NAME, group: g, dockR: r + 40, isTown: true };
  }

  async function spawnNPCs() {
    const placed = [];   // {x,z} for the min-spacing test (across ALL zones, so belt seams don't clump)
    const farEnough = (x, z) => { for (const p of placed) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < MIN_SEP * MIN_SEP) return false; } return true; };
    for (const zone of ZONES) {
      const slot = (2 * Math.PI) / zone.count;                        // even angular slots per belt => no clumping by construction
      for (let k = 0; k < zone.count; k++) {
        let x = 0, z = 0, ok = false;
        for (let t = 0; t < 40 && !ok; t++) {
          const ang = k * slot + slot * 0.5 + (rng() - 0.5) * 0.72 * slot;                                   // jitter within the ship's OWN slot
          const r = Math.sqrt(zone.rIn * zone.rIn + rng() * (zone.rOut * zone.rOut - zone.rIn * zone.rIn));  // area-uniform radius (no inner-edge bunching)
          x = clampSea(Math.cos(ang) * r); z = clampSea(Math.sin(ang) * r);
          ok = !overlapsLand(x, z, 55) && farEnough(x, z);
        }
        if (!ok) continue;                                            // couldn't fit cleanly -> skip (sparse > crowded)
        placed.push({ x, z });
        const level = zone.level;
        const hull = level <= 2 ? (rng() < 0.5 ? "small" : "medium") : level <= 4 ? "pirateMed" : "pirateLg";
        const hostile = level >= 3;                                   // Lv1-2 (the near-start EASY belts) are NEUTRAL traders; only Lv3+ attack on sight
        const hpMax = 45 + level * 30;
        const evasion = hull === "small" ? 3 : hull === "pirateMed" ? 2 : hull === "medium" ? 1 : 0;   // small/fast = harder to hit
        const mesh = makeShip(hull, false); mesh.position.set(x, 0, z); scene.add(mesh);
        npcs.push({ x, z, yaw: rand(-Math.PI, Math.PI), wanderYaw: rand(-Math.PI, Math.PI), speed: rand(8, 18),
          maxSpeed: 14 + rng() * 6 + level * 0.5, turnRate: 0.45 + rng() * 0.4, retargetT: rand(2, 6),
          mesh, hostile, bob: rng() * 6.28, level, dmg: 6 + level * 4, hp: hpMax, hpMax, type: hullLabel(hull),
          rIn: zone.rIn, rOut: zone.rOut,                             // remember the belt so we can leash it there
          evasion, reloadT: rng() * NPC_RELOAD, alive: true, sinkT: 0, flashT: 0, hullMats: mesh.userData.hullMats,   // combat state (+ damage-flash mats)
          idx: npcs.length, orbitSide: rng() < 0.5 ? -1 : 1, orbitHystT: 0, engaged: false });   // circling AI: stable index + seeded orbit side
      }
    }
  }

  // ── Input (real-time steering) ───────────────────────────────────────────────
  const keys = {};
  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab"].includes(k)) e.preventDefault();   // TAB = lock a foe ashore (don't let it shift browser focus)
    if (!gameStarted) { if (down && (k === "enter" || k === " ")) startGame(); return; }   // title screen parks all input until "Set Sail"
    if (down && k === "escape") { if (shopOpen) { closeShop(); return; } if (paused && _pauseView !== "menu") { _pauseView = "menu"; renderPause(); return; } togglePause(); return; }   // Esc — pause (or step back a menu view)
    keys[k] = down;
    if (down) resumeAudio();                                          // first keypress unlocks the AudioContext + starts music
    if (down && (k === "e") && !paused) tryDock();                   // E — dock / enter / leave (not while paused)
    if (down && (k === "f")) tryDig();                               // F — dig the treasure-map X (tryDig itself guards paused/shop)
    if (down && (k === "q") && mode === "ashore" && !paused && !shopOpen) switchWeapon();   // Q — swap cutlass <-> flintlock (ashore)
    if (down && (k === "m")) toggleMute();
    if (down && (k === "r")) resetLook();                            // R — snap the free-look camera back to the chase view
    if (down && (k === "c")) toggleRoster();                         // C — crew roster (moved off R)
    if (down && (k === "tab") && mode === "ashore" && !paused && !shopOpen) cycleFoe();   // TAB — cycle-lock the nearest island enemies
    if (down && (k === " ")) { if (mode === "ashore") { if (selectedFoe && selectedFoe.alive) heroAttack(selectedFoe.x - hero.x, selectedFoe.z - hero.z); else heroShootForward(); } else fireAtSelected(); }   // SPACE — ashore: attack your LOCKED foe (or straight ahead) · at sea: broadside the SELECTED ship
  };
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));

  let gameStarted = false;    // false until the title-screen "Set Sail" is pressed (an attract-mode world runs behind it)
  let _probeHideShips = false; // debug-only: force ALL ship meshes hidden (faceProbe), overriding stepNPC's per-frame cull
  let dockTarget = null;      // nearest dockable island (within dock radius)
  let scoutTarget = null;     // nearest island within SCOUT_RANGE — its pirate/chest count is shown so you know the challenge before docking
  const SCOUT_RANGE = 320;
  function tryDock() {
    if (shopOpen) { closeShop(); return; }                           // E closes the harbour shop
    if (mode === "ashore") { leaveIsland(); return; }               // already ashore -> back to the ship
    if (!dockTarget) return;
    if (dockTarget.isTown) { openShop(); return; }                  // Tortuga -> repair / upgrade / hire
    enterIsland(dockTarget);                                          // drop the away party onto the island
  }

  // ── Selection: click an enemy ship to inspect it. A colour ring (green=easy /
  // orange=medium / red=hard, by the ship's level) drops under it + an info card
  // shows its type, level, hull HP, and damage. ──────────────────────────────────
  let selected = null, _downX = 0, _downY = 0, _infoEl = null;
  const selRing = new THREE.Mesh(new THREE.TorusGeometry(15, 1.0, 8, 44), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }));
  selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);
  function deselect() { selected = null; selRing.visible = false; if (_infoEl) _infoEl.style.display = "none"; }
  function selectAt(clientX, clientY) {
    const meshes = npcs.filter((n) => n.mesh && n.mesh.visible).map((n) => n.mesh);   // only ships actually on screen
    const hits = kernel.raycast(clientX, clientY, meshes);   // kernel method is raycast() — pickAt() never existed, so clicks silently threw
    if (hits && hits.length) {
      let o = hits[0].object; while (o && meshes.indexOf(o) < 0) o = o.parent;
      const n = o && npcs.find((q) => q.mesh === o);
      if (n) { selected = n; refreshInfo(); return; }
    }
    deselect();
  }
  // ── ASHORE target-lock: TAB cycles the nearby island enemies (the on-foot parallel to clicking a ship at sea). A red ring
  // marks the locked foe; SPACE then swings/shoots at it. LEFT-CLICK still free-aims a strike toward the cursor.
  let selectedFoe = null;
  const foeRing = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.6, 8, 30), new THREE.MeshBasicMaterial({ color: 0xff5a44, transparent: true, opacity: 0.92 }));
  foeRing.rotation.x = -Math.PI / 2; foeRing.visible = false; scene.add(foeRing);
  function deselectFoe() { selectedFoe = null; foeRing.visible = false; }
  function cycleFoe() {
    if (mode !== "ashore") return;
    const near = footFoes.filter((f) => f.alive).map((f) => ({ f, d: Math.hypot(f.x - hero.x, f.z - hero.z) })).filter((o) => o.d < 220).sort((a, b) => a.d - b.d).map((o) => o.f);
    if (!near.length) { deselectFoe(); banner("No enemies nearby"); return; }
    const i = selectedFoe ? near.indexOf(selectedFoe) : -1;
    selectedFoe = near[(i + 1) % near.length];
    banner("🎯 Target locked — SPACE to attack");
  }
  function refreshInfo() {
    if (!selected) return;
    const df = diffOf(selected.level);
    selRing.material.color.setHex(df.color); selRing.visible = true;
    if (!_infoEl) { _infoEl = document.createElement("div"); _infoEl.style.cssText = "position:absolute;right:14px;top:66px;z-index:55;pointer-events:none;font:600 13px 'Segoe UI',monospace;color:#eaf3ff;background:rgba(8,18,28,.86);border-radius:10px;padding:10px 14px;min-width:196px;box-shadow:0 4px 18px rgba(0,0,0,.5)"; (kernel.parent || document.body).appendChild(_infoEl); }
    _infoEl.style.display = "block"; _infoEl.style.border = "1px solid " + df.hex;
    const hpPct = Math.max(0, Math.round(100 * selected.hp / selected.hpMax));
    _infoEl.innerHTML =
      `<div style="font-weight:800;color:${df.hex};letter-spacing:.4px">${selected.type} <span style="opacity:.7;font-weight:600;color:#dff1ff">· Lv ${selected.level}</span></div>
       <div style="margin-top:6px;display:flex;align-items:center;gap:8px"><span style="width:11px;height:11px;border-radius:50%;background:${df.hex};display:inline-block;box-shadow:0 0 8px ${df.hex}"></span><b>${df.tier}</b></div>
       <div style="margin-top:7px">❤ Hull <b>${Math.max(0, Math.round(selected.hp))}</b>/${selected.hpMax}
         <div style="height:6px;border-radius:4px;background:#22323c;margin-top:3px;overflow:hidden"><div style="height:100%;width:${hpPct}%;background:${df.hex}"></div></div></div>
       <div style="margin-top:7px">⚔ Damage <b>${selected.dmg}</b> &nbsp;·&nbsp; ${selected.hostile ? '<span style="color:#ff8a6a">Hostile</span>' : '<span style="color:#7fffd4">Neutral</span>'}</div>`;
  }
  { const dom = kernel.renderer.domElement;
    dom.addEventListener("contextmenu", (e) => e.preventDefault());   // RIGHT-drag is free-look, not the browser menu
    dom.addEventListener("wheel", (e) => { e.preventDefault(); _camZoom = Math.max(0.5, Math.min(2.4, _camZoom * (1 + (e.deltaY > 0 ? 0.12 : -0.12)))); }, { passive: false });   // mouse WHEEL = zoom the chase camera in/out
    dom.addEventListener("pointerdown", (e) => { _downX = e.clientX; _downY = e.clientY; resumeAudio(); if (e.button === 2) { _looking = true; try { dom.setPointerCapture(e.pointerId); } catch (_) {} } else if (e.button === 0) startCharge(); });   // LEFT-press ashore begins CHARGING; release decides quick vs charged
    dom.addEventListener("pointermove", (e) => { if (!_looking) return; _lookYaw -= (e.movementX || 0) * 0.006; _lookPitch += (e.movementY || 0) * 0.005; _lookPitch = Math.max(-0.5, Math.min(0.75, _lookPitch)); });   // hold RIGHT + drag to look around
    window.addEventListener("pointerup", (e) => {
      if (e.button === 2) { _looking = false; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} return; }   // release right button -> stop looking (offset persists until R)
      if (e.button !== 0) return;                                     // left button = ATTACK
      if (!gameStarted || shopOpen || paused) { _charging = false; hideChargeFx(); return; }
      if (mode === "ashore") { releaseCharge(e.clientX, e.clientY); return; }   // ashore: quick-tap = fast strike · HOLD = charged sweep (aiming-drag is fine)
      if (Math.hypot(e.clientX - _downX, e.clientY - _downY) >= 6) return;   // sea: a drag = camera look, ignore
      selectAt(e.clientX, e.clientY);                                // LEFT-CLICK at sea = SELECT the clicked ship as your target (does NOT fire — SPACE fires at the selection)
    });
    dom.addEventListener("pointercancel", () => { if (_charging) { _charging = false; hideChargeFx(); } });   // touch/pen interrupted -> cancel the charge
    window.addEventListener("blur", () => { if (_charging) { _charging = false; hideChargeFx(); } });          // alt-tab / focus loss while holding the button -> cancel (no stuck orb)
  }
  let _bannerEl = null, _bannerT = 0;
  function banner(text) {
    if (!_bannerEl) { _bannerEl = document.createElement("div"); _bannerEl.style.cssText = "position:absolute;left:50%;top:14%;transform:translateX(-50%);z-index:60;pointer-events:none;font:800 18px 'Segoe UI',monospace;color:#ffe8b0;background:rgba(8,20,28,.82);border:1px solid #caa24d;border-radius:10px;padding:8px 20px;box-shadow:0 4px 18px rgba(0,0,0,.5);opacity:0;transition:opacity .18s"; (kernel.parent || document.body).appendChild(_bannerEl); }
    _bannerEl.textContent = text; _bannerEl.style.opacity = "1"; _bannerT = 2.4;
  }

  // ── Camera (chase) ───────────────────────────────────────────────────────────
  const camAim = new THREE.Vector3(), camPos = new THREE.Vector3();
  let _freeCam = false;   // debug: when true, updateCamera yields so a test can frame the scene
  // FREE-LOOK: hold RIGHT MOUSE + drag to orbit the camera in ANY direction around you; R snaps back to the chase view.
  let _lookYaw = 0, _lookPitch = 0, _looking = false;
  function orbitOffset(pos, aim) {   // rotate the cam offset (cam→aim) by the free-look yaw/pitch about the focus point
    if (!_lookYaw && !_lookPitch) return pos;
    const dx = pos.x - aim.x, dy = pos.y - aim.y, dz = pos.z - aim.z, r = Math.hypot(dx, dy, dz) || 1;
    const az = Math.atan2(dx, dz) + _lookYaw, el = Math.max(0.12, Math.min(1.32, Math.asin(Math.max(-1, Math.min(1, dy / r))) + _lookPitch)), ce = Math.cos(el);
    return new THREE.Vector3(aim.x + r * ce * Math.sin(az), aim.y + r * Math.sin(el), aim.z + r * ce * Math.cos(az));
  }
  function resetLook() { _lookYaw = 0; _lookPitch = 0; }
  // On release of right-mouse, EASE the free-look offset back to the chase view (keeps the player centered/behind).
  function decayLook(dt) { if (_looking) return; const k = Math.max(0, 1 - dt * 5); _lookYaw *= k; _lookPitch *= k; if (Math.abs(_lookYaw) < 0.002) _lookYaw = 0; if (Math.abs(_lookPitch) < 0.002) _lookPitch = 0; }
  // ── Camera zoom transition: the boat cam is ship-scale (an island looks small on the horizon); DOCK smoothly
  // ZOOMS to the tight character cam (dolly 58->32, FOV 50->42) so the island feels MUCH bigger as you go
  // "into" it on foot; leaving reverses it. camMode drives which cam runs. ─────────────────────────────────
  let camMode = "sail", camT = 0, _lastAshoreIsle = null;   // "sail" | "zoomIn" | "ashore" | "zoomOut"
  const ZOOM_DUR = 1.0, FOV_SAIL = 50, FOV_HERO = 42;
  let _camZoom = 1;   // mouse-WHEEL zoom multiplier on the chase distance (1 = default; <1 closer, >1 farther)
  // aim only a SHORT distance ahead so the player sits near screen-CENTER (a big look-ahead threw them to the far corner)
  function shipCamPoints() { const f = fwd(player.yaw), z = _camZoom, aim = new THREE.Vector3(player.x + f.x * 6, 6, player.z + f.z * 6), pos = new THREE.Vector3(player.x - f.x * 58 * z, 42 * z, player.z - f.z * 58 * z); return { pos: orbitOffset(pos, aim), aim }; }
  function heroCamPoints() { const is = ashoreIsle || _lastAshoreIsle, f = fwd(hero.yaw), z = _camZoom, gy = is ? groundYOn(is, hero.x, hero.z) : 0, aim = new THREE.Vector3(hero.x + f.x * 4, gy + 9, hero.z + f.z * 4), pos = new THREE.Vector3(hero.x - f.x * 32 * z, gy + 21 * z, hero.z - f.z * 32 * z); return { pos: orbitOffset(pos, aim), aim }; }
  function blendCam(dt, to) {
    if (_freeCam) return;
    decayLook(dt);
    camT = Math.min(1, camT + dt / ZOOM_DUR);
    const k = camT * camT * (3 - 2 * camT), kk = to === "hero" ? k : 1 - k;   // smoothstep; easing lives in camT (no double-smoothing)
    const s = shipCamPoints(), h = heroCamPoints();
    kernel.camera.position.copy(s.pos.lerp(h.pos, kk)); camAim.copy(s.aim.lerp(h.aim, kk)); kernel.camera.lookAt(camAim);
    kernel.camera.fov = FOV_SAIL + (FOV_HERO - FOV_SAIL) * kk; kernel.camera.updateProjectionMatrix();
    if (camT >= 1) { camMode = to === "hero" ? "ashore" : "sail"; kernel.camera.fov = to === "hero" ? FOV_HERO : FOV_SAIL; kernel.camera.updateProjectionMatrix(); }
  }
  function updateCamera(dt) {
    if (_freeCam) return;
    decayLook(dt);
    const p = shipCamPoints();
    kernel.camera.position.lerp(p.pos, Math.min(1, dt * 3.2));
    camAim.lerp(p.aim, Math.min(1, dt * 4)); kernel.camera.lookAt(camAim);
  }

  // ── ON-FOOT away party: DOCK (E) at an island to drop ashore and explore its heightfield on foot;
  // press E again to return to the ship. The character walks the terrain (ground height via _isleH). ──
  let mode = "sail";                    // "sail" | "ashore"
  let ashoreIsle = null;
  const hero = { x: 0, z: 0, yaw: 0, mesh: null, walk: 36, turn: 2.6, hp: 100, hpMax: 100, atkT: 0, ev: 1 };
  const HERO_OFF = 0;                    // character art-forward correction (verified top-down like the ships)
  function groundYOn(is, wx, wz) { return _isleH(wx - is.x, wz - is.z, is.r, is.ox, is.oz, is.sh); }
  function hitsRock(is, wx, wz) {   // is the WORLD point inside any of the island's rock collision discs?
    const rk = is.rocks; if (!rk) return false; const lx = wx - is.x, lz = wz - is.z;
    for (let i = 0; i < rk.length; i++) { const dx = lx - rk[i].x, dz = lz - rk[i].z; if (dx * dx + dz * dz < rk[i].cr * rk[i].cr) return true; }
    return false;
  }
  function heroCanGo(is, wx, wz) { return _isleH(wx - is.x, wz - is.z, is.r, is.ox, is.oz, is.sh) > 0.6 && !hitsRock(is, wx, wz); }   // dry land AND not inside a rock
  // ── ASHORE BOSS ("Dread Captain") — FULLY RANDOM each NIGHT landing (~1 in 5), on ANY island. A bigger,
  // darker, much tougher marauder; transient (re-rolled every landing, stripped on leave). Big bounty. ──
  function spawnLandBossOn(is) {                                        // force-spawn a Dread Captain on `is` (the night + roll guards live in maybeLandBoss)
    const sp = _spotNear(is, is.x, is.z, is.r * 0.25, is.r * 0.7);
    const hpm = Math.round((44 + is.level * 14) * 2.7), dmg = Math.round((6 + is.level * 1.4) * 2.2);   // tankier + harder-hitting than a marauder
    const f = { x: sp.x, z: sp.z, yaw: rng() * 6.28, hp: hpm, hpMax: hpm, dmg, level: is.level, kind: "marauder",
      mesh: null, mixer: null, play: null, atkT: rng() * 1.2, alive: true, aggro: false, boss: true, bossName: "Dread Captain" };
    const c = makeCharacterRole("marauder", 17.5, 0x2a0810);           // clearly bigger + a dark, cursed cast
    if (!c) return null;
    f.mesh = c.pivot; f.mixer = c.mixer; f.play = c.play;
    f.mesh.position.set(f.x, groundYOn(is, f.x, f.z), f.z); f.mesh.rotation.y = f.yaw + HERO_OFF; f.mesh.visible = true; scene.add(f.mesh);
    is.foes.push(f); landBoss = f;                                      // footFoes aliases is.foes -> the ashore AI + arrowStrike/crewCastSpell handle it
    banner("☠ A Dread Captain stalks this island…"); addShake(0.8);
    return f;
  }
  function maybeLandBoss(is) {                                          // FULLY RANDOM each NIGHT landing (~1 in 5), on ANY island
    landBoss = null;
    if (night.t < 0.5) return;                                          // day landing -> no captain (they walk only at night)
    if (Math.random() > LAND_BOSS_CHANCE) return;                       // most night landings -> quiet
    spawnLandBossOn(is);
  }
  function landBossReward(f) {
    const g = 200 + f.level * 30; player.gold += g; gainXP(80 + f.level * 8); addShake(1.0);
    banner(`☠ ${f.bossName || "Dread Captain"} is slain! +${g} gold`);
    if (landBoss === f) landBoss = null;
  }
  function stripLandBoss(is) {                                          // remove the transient captain (killed or not) so each landing re-rolls
    if (is && is.foes) for (let i = is.foes.length - 1; i >= 0; i--) { const f = is.foes[i]; if (f.boss) { if (f.mesh) scene.remove(f.mesh); is.foes.splice(i, 1); } }
    landBoss = null;
  }
  function enterIsland(is) {
    if (!hero.mesh) { const c = makeCharacter(10); if (c) { hero.mesh = c.pivot; hero.mixer = c.mixer; hero.play = c.play; hero.mesh.traverse((n) => { if (n.isMesh) n.castShadow = true; }); equipHeroGun(hero.mesh); scene.add(hero.mesh); } }
    if (!hero.mesh) { banner("⚓ Docked at " + is.name); return; }   // model missing -> just acknowledge
    mode = "ashore"; ashoreIsle = is; _lastAshoreIsle = is; deselect(); player.speed = 0;
    camMode = "zoomIn"; camT = 0;                                   // dolly the camera down INTO the island
    const ang = Math.atan2(player.x - is.x, player.z - is.z);       // drop on the beach nearest the ship
    let rr = is.r - 6;
    for (let k = 0; k < 14; k++) { if (_isleH(Math.sin(ang) * rr, Math.cos(ang) * rr, is.r, is.ox, is.oz, is.sh) > 1.5) break; rr -= 6; }
    hero.x = is.x + Math.sin(ang) * rr; hero.z = is.z + Math.cos(ang) * rr; hero.yaw = ang + Math.PI;   // face inland
    hero.mesh.visible = true; is.group.visible = true; hero.hp = hero.hpMax;
    activateIsland(is);                                              // the island's PERSISTENT pirates + chests (built at world-gen, already visible from the boat)
    footFoes = is.foes; footChests = is.chests;                      // alias the ashore combat code onto this island's content
    for (const f of is.foes) f.aggro = false;                        // fresh sight-based encounter each landing (no pre-alerted swarm)
    maybeLandBoss(is);                                               // NIGHT only, ~1 in 5: a Dread Captain (transient) joins the isle's foes
    spawnQuestX(is);                                                 // if this is the treasure-map target isle, plant the X-marks-the-spot
    spawnCrewParty(is);                                              // hired crew land WITH you and fight alongside the hero
    banner("⚓ Ashore at " + is.name + " — WASD move · LEFT-CLICK attack · Q swap ⚔/🔫 · E return to ship");
  }
  function leaveIsland() { const is = ashoreIsle; mode = "sail"; ashoreIsle = null; camMode = "zoomOut"; camT = 0; if (hero.mesh) hero.mesh.visible = false; deselectFoe(); _charging = false; hideChargeFx(); stripLandBoss(is); stripQuestMesh(); if (is) is.refillT = REFILL_SECS; clearCrewParty(); clearOverlay(); banner("⛵ Back aboard"); }   // strip the transient captain + quest marker (quest stays active until dug)   // content PERSISTS; camera pulls back out to sea
  function stepHero(dt) {
    const is = ashoreIsle; if (!is) return;
    const turn = (keys["a"] || keys["arrowleft"]) ? 1 : (keys["d"] || keys["arrowright"]) ? -1 : 0;
    hero.yaw += turn * hero.turn * dt;
    const go = (keys["w"] || keys["arrowup"]) ? 1 : (keys["s"] || keys["arrowdown"]) ? -0.6 : 0;
    const f = fwd(hero.yaw);
    const nx = hero.x + f.x * hero.walk * go * dt, nz = hero.z + f.z * hero.walk * go * dt;
    if (heroCanGo(is, nx, nz)) { hero.x = nx; hero.z = nz; }                 // dry land + clear of rocks
    else if (heroCanGo(is, nx, hero.z)) hero.x = nx;                          // blocked -> slide along the obstacle
    else if (heroCanGo(is, hero.x, nz)) hero.z = nz;
    const gy = groundYOn(is, hero.x, hero.z);
    hero.mesh.position.set(hero.x, gy, hero.z);
    hero.mesh.rotation.y = hero.yaw + HERO_OFF;
    hero.animT = (hero.animT || 0) - dt; if (hero.play && hero.animT <= 0) hero.play(go !== 0 ? "run" : "idle");   // run when walking, idle when still (attack holds via animT)
    if (hero.mixer) hero.mixer.update(dt);            // drive the animation
  }
  function updateHeroCamera(dt) {
    if (_freeCam || !ashoreIsle) return;
    decayLook(dt);
    const p = heroCamPoints();
    kernel.camera.position.lerp(p.pos, Math.min(1, dt * 4));
    camAim.lerp(p.aim, Math.min(1, dt * 5)); kernel.camera.lookAt(camAim);
  }

  // ── LIVE CANNON COMBAT — reuses the Tide Breakers d20 / damage-band / crit DICE. To-hit is a d20
  // vs a target number that rises with RANGE + the target's EVASION; nat-1 always misses, nat-20 always
  // hits + crits (x1.5); damage is a bell-weighted band ±30% of nominal. Real-time (reload cooldowns),
  // not turn-based. Sink -> the ship respawns in its own difficulty belt so the zones never empty. ──
  // ── AUDIO: a tiny WebAudio SFX pool for OVERLAPPING one-shots (many cannons can bang at once — a single
  // <audio> element can't overlap itself) + a looping ambient music bed. The AudioContext starts SUSPENDED
  // (browser autoplay policy) and is resumed on the first key/click; missing/undecodable files no-op. ─────
  const SFX_SRC = (content && content.sfx) || {};
  // Two looping music BEDS — a calm EXPLORE track and an intense BATTLE track — crossfaded by combat state.
  const MUSIC_EXPLORE_URL = (content.music && content.music.explore) || "assets/audio/music_explore.ogg";
  const MUSIC_BATTLE_URL = (content.music && content.music.battle) || "assets/audio/music_battle.ogg";
  const MUSIC_BED_VOL = 1.0, MUSIC_FADE = 1.5, COMBAT_HOLD = 5.0, MUSIC_MASTER = 0.30;   // crossfade time; no-combat hold; overall music level (present, not background wallpaper)
  const audio = { ctx: null, buffers: {}, master: null, musicGain: null, ready: false, started: false, muted: false };
  const music = { state: "explore", combatT: 999, explore: null, battle: null };   // .explore/.battle = { src, gain }
  // ── Player-settable audio levels (Settings panel). master scales the SFX bus (audio.master) AND music; music/sfx are
  // per-bus. Persisted in localStorage 'pc_audio'. applyAudio() writes both gain nodes from the current levels + mute. ──
  let masterVol = 1, musicVol = 1, sfxVol = 1;
  try { const s = JSON.parse(localStorage.getItem("pc_audio") || "{}"); if (typeof s.master === "number") masterVol = s.master; if (typeof s.music === "number") musicVol = s.music; if (typeof s.sfx === "number") sfxVol = s.sfx; if (s.muted) audio.muted = true; } catch (e) {}
  function applyAudio() {
    if (audio.master) audio.master.gain.value = 0.6 * masterVol * sfxVol;                               // SFX/one-shot bus (all playSfx/playGunshot route here)
    if (audio.musicGain) audio.musicGain.gain.value = audio.muted ? 0 : MUSIC_MASTER * musicVol * masterVol;
  }
  function saveAudio() { try { localStorage.setItem("pc_audio", JSON.stringify({ master: masterVol, music: musicVol, sfx: sfxVol, muted: audio.muted })); } catch (e) {} }
  async function initAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.6; audio.master.connect(audio.ctx.destination);
      audio.musicGain = audio.ctx.createGain(); audio.musicGain.gain.value = MUSIC_MASTER; audio.musicGain.connect(audio.ctx.destination);
      applyAudio();                                                    // honour saved Settings levels/mute from the start
      const urls = {}; for (const k in SFX_SRC) urls[SFX_SRC[k]] = true; urls[MUSIC_EXPLORE_URL] = true; urls[MUSIC_BATTLE_URL] = true;   // decode each DISTINCT file once
      await Promise.all(Object.keys(urls).map(async (url) => {
        // assets/* live at the GAME ROOT (like the GLBs loadGLTF fetches), NOT next to this module — resolve against the PAGE, not import.meta.url.
        try { const r = await fetch(new URL(url, document.baseURI).href); if (!r.ok) throw new Error("HTTP " + r.status); const ab = await r.arrayBuffer(); audio.buffers[url] = await audio.ctx.decodeAudioData(ab); }
        catch (e) { console.warn("[audio] decode failed", url, e && e.message); audio.buffers[url] = null; }
      }));
      audio.ready = true;
    } catch (e) { console.warn("[audio] init failed", e && e.message); }
  }
  function playSfx(name, vol, rate) {   // fire-and-forget overlapping one-shot
    if (!audio.ready || audio.muted || !audio.ctx || audio.ctx.state !== "running") return;
    const url = SFX_SRC[name], buf = url && audio.buffers[url]; if (!buf) return;
    const src = audio.ctx.createBufferSource(); src.buffer = buf; if (rate) src.playbackRate.value = rate;
    const g = audio.ctx.createGain(); g.gain.value = vol == null ? 1 : vol;
    src.connect(g); g.connect(audio.master); src.start();
  }
  function sfxAt(name, x, z, baseVol) {   // world-positioned one-shot: attenuate by distance from the listener (player at sea / hero ashore)
    const lx = mode === "ashore" ? hero.x : player.x, lz = mode === "ashore" ? hero.z : player.z;
    const v = Math.max(0, 1 - Math.hypot(x - lx, z - lz) / 320) * (baseVol == null ? 1 : baseVol);
    if (v > 0.02) playSfx(name, v, 0.9 + rng() * 0.2);
  }
  // Synthesized OLD-GUN (flintlock) shot — a sharp band-passed noise CRACK + a short low BOOM. No audio file needed,
  // and it sounds nothing like the cannon broadside (which reuses cannon.ogg).
  function playGunshot(vol) {
    if (!audio.ready || audio.muted || !audio.ctx || audio.ctx.state !== "running") return;
    const ctx = audio.ctx, t = ctx.currentTime, v = vol == null ? 0.85 : vol;
    const nlen = Math.floor(ctx.sampleRate * 0.22), buf = ctx.createBuffer(1, nlen, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < nlen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / nlen);   // decaying white noise
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(v, t + 0.004); ng.gain.exponentialRampToValueAtTime(0.0006, t + 0.19);
    noise.connect(bp); bp.connect(ng); ng.connect(audio.master); noise.start(t); noise.stop(t + 0.22);
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(v * 0.6, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    osc.connect(og); og.connect(audio.master); osc.start(t); osc.stop(t + 0.16);
  }
  function gunshotAt(x, z, baseVol) { const lx = mode === "ashore" ? hero.x : player.x, lz = mode === "ashore" ? hero.z : player.z; const v = Math.max(0, 1 - Math.hypot(x - lx, z - lz) / 320) * (baseVol == null ? 1 : baseVol); if (v > 0.02) playGunshot(v); }
  function playSwing(vol) {   // a short blade WHOOSH (swept band-passed noise) — the cutlass cutting air, NOT a gunshot
    if (!audio.ready || audio.muted || !audio.ctx || audio.ctx.state !== "running") return;
    const ctx = audio.ctx, t = ctx.currentTime, v = vol == null ? 0.5 : vol;
    const nlen = Math.floor(ctx.sampleRate * 0.2), buf = ctx.createBuffer(1, nlen, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < nlen; i++) d[i] = (Math.random() * 2 - 1);
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3.2;
    bp.frequency.setValueAtTime(480, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.09); bp.frequency.exponentialRampToValueAtTime(700, t + 0.19);   // sweep up→down = a whoosh
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(v, t + 0.03); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
    noise.connect(bp); bp.connect(ng); ng.connect(audio.master); noise.start(t); noise.stop(t + 0.21);
  }
  function _makeBed(url, vol) {   // a looping music bed with its own gain (child of musicGain, so mute still works)
    const buf = audio.buffers[url]; if (!buf) return null;
    const src = audio.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = audio.ctx.createGain(); gain.gain.value = vol; src.connect(gain); gain.connect(audio.musicGain); src.start();
    return { src, gain };
  }
  function startMusic() {
    if (!audio.ready || music.explore || music.battle) return;
    music.explore = _makeBed(MUSIC_EXPLORE_URL, MUSIC_BED_VOL);   // calm bed up
    music.battle = _makeBed(MUSIC_BATTLE_URL, 0);                 // battle bed silent until combat
    music.state = "explore"; music.combatT = 999;
  }
  function setMusicState(next) {   // crossfade the two beds
    if (music.state === next) return; music.state = next;
    const t = audio.ctx.currentTime;
    [music.explore, music.battle].forEach((bed, i) => {
      if (!bed) return; const target = (i === 0 ? "explore" : "battle") === next ? MUSIC_BED_VOL : 0;
      bed.gain.gain.cancelScheduledValues(t); bed.gain.gain.setValueAtTime(bed.gain.gain.value, t); bed.gain.gain.linearRampToValueAtTime(target, t + MUSIC_FADE);
    });
  }
  function _combatActiveNow() {
    if (mode === "ashore") {
      if (hero.atkT > 0) return true;
      if (ashoreIsle) for (const f of ashoreIsle.foes) if (f.alive) { const dx = f.x - hero.x, dz = f.z - hero.z; if (dx * dx + dz * dz < 60 * 60) return true; }
      return false;
    }
    if (player.reloadTP > PLAYER_RELOAD - 0.25 || player.reloadTS > PLAYER_RELOAD - 0.25) return true;   // you just fired
    for (const n of npcs) if (n.alive && n.hostile) { const dx = n.x - player.x, dz = n.z - player.z; if (dx * dx + dz * dz < FIRE_RANGE * FIRE_RANGE) return true; }
    return false;
  }
  function updateMusicState(dt) {
    if (!audio.started) return;
    if (_combatActiveNow()) music.combatT = 0; else music.combatT += dt;
    if (music.combatT === 0) setMusicState("battle"); else if (music.combatT >= COMBAT_HOLD) setMusicState("explore");   // instant into battle, lazy (5s) back to calm
  }
  // AMBIENT SEA BED — a very soft looping filtered-noise wash (waves) with a slow swell LFO, under the music. Routed
  // through audio.master (the SFX bus) so the Master + SFX sliders govern it. Synthesized, no file, no health framing.
  function startAmbient() {
    if (!audio.ctx || audio._ambient) return;
    const ctx = audio.ctx, len = Math.floor(ctx.sampleRate * 4), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;                 // white noise (cosmetic -> Math.random)
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 480; lp.Q.value = 0.4;   // muffled wash = distant surf
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lfoG = ctx.createGain(); lfoG.gain.value = 0.028; lfo.connect(lfoG); lfoG.connect(g.gain);   // slow swell/lull
    src.connect(lp); lp.connect(g); g.connect(audio.master); src.start(); lfo.start();
    audio._ambient = { src, g, lfo };
  }
  function resumeAudio() { if (!audio.ctx) return; if (audio.ctx.state === "suspended") audio.ctx.resume(); if (!audio.started) { audio.started = true; startMusic(); startAmbient(); } }
  function toggleMute() { audio.muted = !audio.muted; applyAudio(); saveAudio(); if (_pauseView === "settings" && _pauseEl && _pauseEl.style.display !== "none") renderPause(); banner(audio.muted ? "🔇 Muted" : "🔊 Sound on"); }

  const FIRE_RANGE = 235, PLAYER_RELOAD = 1.0, NPC_RELOAD = 2.6;
  // ── Engagement: only the nearest few hostiles CIRCLE + press the attack, so you never face a scrum. ──
  const ENGAGE_R = 300;     // a hostile only "engages" (circles) inside this; > FIRE_RANGE so it lines up BEFORE it can shoot
  const ENGAGE_CAP = 3;     // HARD cap: at most this many hostiles circle the player at once
  const ORBIT_HYST = 0.8;   // seconds a hostile keeps its chosen orbit side before it may flip (no jitter)
  const ABEAM_R = 55 * Math.PI / 180;   // engaged ships only fire when the player is within 55° of abeam
  // ── BROADSIDE arcs: cannons fire from the SIDES, not the bow. A side "bears" when the target's
  // absolute bearing off the bow is in [35°,145°] — a wide abeam wedge with modest 35° dead zones fore
  // & aft (so you must turn to bring guns to bear, but never thread a needle). Player + NPC share it. ──
  const ARC_MIN = 35, ARC_MAX = 145;
  const ARC_MIN_R = ARC_MIN * Math.PI / 180, ARC_MAX_R = ARC_MAX * Math.PI / 180;
  const VOLLEY_N = 4;            // balls per broadside (reuse the _shots pool)
  const GUN_SPAN = 11;          // half-length of the gun line along the hull (muzzles spaced fore→aft)
  const GUN_BEAM = 6;           // outboard offset of the gun line from the centreline
  const HIT_RADIUS = 15;        // a shot only connects if the target is within this of where the ball LANDED — steer clear to DODGE
  function rollShot(nom, evasion, rangeFrac) {
    const toHit = Math.max(2, Math.min(19, 3 + Math.round(6 * rangeFrac) + (evasion || 0)));
    const d20 = 1 + Math.floor(rng() * 20);
    const hit = d20 === 20 || (d20 !== 1 && d20 >= toHit), crit = d20 === 20;
    let dmg = 0;
    if (hit) { const lo = nom * 0.7, hi = nom * 1.3; dmg = Math.round((lo + ((rng() + rng()) / 2) * (hi - lo)) * (crit ? 1.5 : 1)); }
    return { hit, crit, dmg, d20 };
  }
  const _shots = [], _fx = [];
  const _ballGeo = new THREE.SphereGeometry(1.2, 8, 6), _ballMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, metalness: 0.1 });
  function spawnShot(fx, fz, tx, tz, onLand) {
    const mesh = new THREE.Mesh(_ballGeo, _ballMat); mesh.position.set(fx, 6, fz); scene.add(mesh);
    _shots.push({ fx, fz, tx, tz, t: 0, dur: 0.3 + Math.hypot(tx - fx, tz - fz) / 520, mesh, onLand });
  }
  function updateShots(dt) {
    for (let i = _shots.length - 1; i >= 0; i--) { const s = _shots[i]; s.t += dt / s.dur;
      if (s.t >= 1) { scene.remove(s.mesh); _shots.splice(i, 1); if (s.onLand) s.onLand(); continue; }
      s.mesh.position.set(s.fx + (s.tx - s.fx) * s.t, 6 + Math.sin(s.t * Math.PI) * 24, s.fz + (s.tz - s.fz) * s.t); }
  }
  function burst(x, z, hit, crit) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(hit ? (crit ? 7 : 5) : 3, 10, 8), new THREE.MeshBasicMaterial({ color: hit ? (crit ? 0xffef8a : 0xff7a2a) : 0xbfe0ff, transparent: true, opacity: 0.92 }));
    m.position.set(x, 3, z); scene.add(m); _fx.push({ mesh: m, life: 1 });
  }
  function updateFx(dt) { for (let i = _fx.length - 1; i >= 0; i--) { const f = _fx[i]; f.life -= dt * (f.fast ? 4.4 : 2.4); f.mesh.material.opacity = Math.max(0, f.life) * (f.fast ? 0.95 : 1); f.mesh.scale.setScalar((f.fast ? 0.6 : 1) + (1 - f.life) * (f.fast ? 1.4 : 2.6)); if (f.life <= 0) { scene.remove(f.mesh); if (f.mesh.geometry) f.mesh.geometry.dispose(); (Array.isArray(f.mesh.material) ? f.mesh.material : [f.mesh.material]).forEach((m) => m && m.dispose && m.dispose()); _fx.splice(i, 1); } } }   // dispose the per-instance geo+mat (burst/muzzle/slashFx all alloc fresh) — no GPU leak on repeated swings/hits

  // ── FEEL FX: ship wakes, sink debris + foam ring, on-hit screen shake. All purely COSMETIC -> Math.random (not seeded rng). ──
  const _wakeGeo = new THREE.CircleGeometry(1, 14);                 // flat disc laid on the water; scaled/faded per instance
  const _wakes = [];
  function spawnWake(x, z, size, life, grow, op) {
    if (_wakes.length >= 90) { const old = _wakes.shift(); scene.remove(old.mesh); old.mesh.material.dispose(); }   // evict oldest so the NEWEST (incl. player) always shows
    const m = new THREE.Mesh(_wakeGeo, new THREE.MeshBasicMaterial({ color: 0xe6f2f7, transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.55, z); m.scale.setScalar(size * (0.75 + Math.random() * 0.5));
    scene.add(m); _wakes.push({ mesh: m, life, life0: life, grow, op });
  }
  function shipWake(x, z, yaw, size) { const f = fwd(yaw); spawnWake(x - f.x * 12, z - f.z * 12, size, 1.1, size * 1.5, 0.42); }   // foam at the STERN
  function updateWakes(dt) {
    for (let i = _wakes.length - 1; i >= 0; i--) { const w = _wakes[i]; w.life -= dt;
      if (w.life <= 0) { scene.remove(w.mesh); w.mesh.material.dispose(); _wakes.splice(i, 1); continue; }
      w.mesh.scale.setScalar(w.mesh.scale.x + w.grow * dt); w.mesh.material.opacity = (w.life / w.life0) * w.op; }
  }
  const _debrisGeo = new THREE.BoxGeometry(1.7, 1.0, 3.4), _debrisMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 1 });
  const _debris = [];
  function sinkSplash(x, z, big) {                                  // two expanding foam rings + tumbling plank debris
    spawnWake(x, z, big ? 7 : 5, 1.5, big ? 22 : 16, 0.6);
    spawnWake(x, z, big ? 4 : 3, 2.2, big ? 30 : 22, 0.5);
    const n = big ? 9 : 6;
    for (let i = 0; i < n; i++) { const d = new THREE.Mesh(_debrisGeo, _debrisMat), a = Math.random() * 6.28, sp = 5 + Math.random() * 11;
      d.position.set(x, 2.5, z); d.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      scene.add(d); _debris.push({ mesh: d, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 9 + Math.random() * 8, spin: (Math.random() - 0.5) * 6, life: 1.9 }); }
  }
  function updateDebris(dt) {
    for (let i = _debris.length - 1; i >= 0; i--) { const d = _debris[i]; d.life -= dt;
      if (d.life <= 0) { scene.remove(d.mesh); _debris.splice(i, 1); continue; }
      d.vy -= 26 * dt; d.mesh.position.x += d.vx * dt; d.mesh.position.z += d.vz * dt; d.mesh.position.y += d.vy * dt;
      if (d.mesh.position.y < 0.4) { d.mesh.position.y = 0.4; d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; }
      d.mesh.rotation.x += d.spin * dt; d.mesh.rotation.z += d.spin * 0.7 * dt; }
  }
  let _shake = 0, _wakeAcc = 0;
  function addShake(a) { _shake = Math.min(1.4, _shake + a); }      // a small camera kick when YOUR ship is hit; decays fast in updateCamera path
  // MUZZLE FLASH — a brief bright puff at the firing ship, biased toward the target (deck height).
  function muzzle(fx, fz, tx, tz) {
    const dx = tx - fx, dz = tz - fz, d = Math.hypot(dx, dz) || 1, ox = fx + dx / d * 7, oz = fz + dz / d * 7;
    const m = new THREE.Mesh(new THREE.SphereGeometry(3.0, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.95 }));
    m.position.set(ox, 6, oz); scene.add(m); _fx.push({ mesh: m, life: 1, fast: true });
  }
  // HULL DAMAGE-FLASH — pulse a ship's hull emissive red for a beat when it takes a hit.
  function damageFlash(ship) { if (ship) ship.flashT = 0.26; }
  function stepFlash(ship, dt) {
    if (!ship || !ship.hullMats || ship.flashT <= 0) return;
    ship.flashT -= dt; const done = ship.flashT <= 0, k = done ? 0 : ship.flashT / 0.26;
    // Restore toward the mat's RESTING emissive (0 for normal hulls; the Dreadmaw's ghost-glow for the boss)
    // and add the red flash ON TOP — else the decay-to-black would permanently wipe the boss's baseline glow.
    for (const mt of ship.hullMats) { if (!mt.emissive) continue; const b = mt.userData._baseEmis;
      if (b) { if (done) mt.emissive.copy(b); else mt.emissive.setRGB(Math.min(1, b.r + k * 0.95), b.g, b.b); }
      else mt.emissive.setRGB(done ? 0 : k * 0.95, 0, 0); }
  }
  // ── DODGEABLE cannon shot (non-homing). The ball is LOFTED at the target's PREDICTED spot (lead by its
  // velocity) plus a dice-quality scatter, then flies a FIXED arc — it never seeks. On impact we re-check the
  // target's LIVE position: a dice-hit only connects if the target is still within HIT_RADIUS of where the ball
  // came down, so steering OFF your predicted course DODGES it. Miss/crit/damage are the D&D dice (rollShot). ──
  // ASYMMETRIC lead: ENEMY shots at YOU under-lead (0.35) so you can DODGE by speed/turning; YOUR shots at enemies lead
  // WELL (0.9) so a moving target is still hittable (else your own broadsides feel useless). Default = the dodgeable enemy value.
  const LEAD = 0.35, PLAYER_LEAD = 0.9;
  function fireBall(fx, fz, tgt, roll, onHit, onMiss, lead) {
    const L = lead == null ? LEAD : lead;
    const dist0 = Math.hypot(tgt.x - fx, tgt.z - fz), tt = 0.3 + dist0 / 520;   // ~flight time (matches spawnShot dur)
    const vx = Math.sin(tgt.yaw) * (tgt.speed || 0), vz = Math.cos(tgt.yaw) * (tgt.speed || 0);   // lead the target
    const scat = roll.crit ? 0 : roll.hit ? 4 : 22;                            // tight when the dice aim true, wide on a miss
    const ax = tgt.x + vx * tt * L + (Math.random() * 2 - 1) * scat;           // cosmetic scatter -> Math.random; NON-homing (fixed landing)
    const az = tgt.z + vz * tt * L + (Math.random() * 2 - 1) * scat;
    spawnShot(fx, fz, ax, az, () => {
      const d = Math.hypot(tgt.x - ax, tgt.z - az);                            // where the ball came down vs the target NOW
      if (roll.hit && d < HIT_RADIUS) onHit(ax, az); else onMiss(ax, az);      // dodged if it steered clear of the splash
    });
  }

  function xpForLevel(l) { return 20 + l * 15; }
  function gainXP(n) {
    player.xp += n; const _lv0 = player.level;
    while (player.xp >= xpForLevel(player.level)) { player.xp -= xpForLevel(player.level); player.level++; player.hpMax += 20; player.hp = player.hpMax; player.gunDmg += 3; player.maxSpeed += 1; banner(`⭐ Level ${player.level}! Ship upgraded — +hull, +cannon`); }
    if (player.level !== _lv0) { applyShipVisuals(); maybeSwapFlagship(); }   // veteran sail-rank hue + the Lv8 flagship capstone
  }
  function playerFire() {
    if (shopOpen || mode !== "sail") return;
    // Scan hostiles in range; sort each into the broadside that BEARS on it (or flag a dead-zone target).
    let anyInRange = false, needTurn = false;
    const portHits = [], stbdHits = [], R2 = FIRE_RANGE * FIRE_RANGE;
    for (const n of npcs) {
      if (!n.alive) continue;                                         // you're a PIRATE — you can fire on ANY ship, even neutral traders
      const dx = n.x - player.x, dz = n.z - player.z, d2 = dx * dx + dz * dz;
      if (d2 >= R2) continue;
      anyInRange = true;
      const b = relBearing(player.x, player.z, player.yaw, n.x, n.z), ab = Math.abs(b);
      if (ab < ARC_MIN_R || ab > ARC_MAX_R) { needTurn = true; continue; }   // fore/aft dead zone — no gun bears
      (b < 0 ? portHits : stbdHits).push({ n, d2 });
    }
    if (!anyInRange) return;                                          // empty sea — no nag
    const canPort = portHits.length && player.reloadTP <= 0, canStbd = stbdHits.length && player.reloadTS <= 0;
    if (!canPort && !canStbd) {                                       // in range but can't shoot: tell the sailor why
      if (needTurn && !portHits.length && !stbdHits.length) fireFeedback("turn");
      else fireFeedback("reload");
      return;
    }
    if (canPort) fireBroadside(-1, portHits);
    if (canStbd) fireBroadside(+1, stbdHits);
  }
  // Fire one side's VOLLEY: muzzles spaced fore→aft along that beam, each ball rolled vs a hostile it bears on.
  function fireBroadside(side, hits) {
    if (side < 0) player.reloadTP = PLAYER_RELOAD; else player.reloadTS = PLAYER_RELOAD;
    playSfx("fire", 0.9, 0.95 + Math.random() * 0.1);                 // cosmetic pitch -> Math.random (no rng desync)
    // Cove Arena: let every other client RENDER this volley (muzzles + balls) —
    // damage still flows shooter→victim via the hit path; this is pure visuals.
    if (pvp.active && pvp.hooks && pvp.hooks.localVolley) { try { pvp.hooks.localVolley(side, hits.map((h) => h.n)); } catch (e) {} }
    const volleyN = 2 + Math.min(upg.cannon, 2);                      // balls per broadside START at 2, +1 per "Bigger Cannons" tier up to 4 (was a flat 4 -> too strong from the start; now it's an UPGRADE)
    const yaw = player.yaw, fX = Math.sin(yaw), fZ = Math.cos(yaw);   // forward unit
    const bX = Math.cos(yaw) * side, bZ = -Math.sin(yaw) * side;      // beam (port/starboard) unit
    hits.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < volleyN; i++) {
      const along = GUN_SPAN * (volleyN > 1 ? (i / (volleyN - 1) * 2 - 1) : 0);   // -GUN_SPAN..+GUN_SPAN (guard N=1)
      const mx = player.x + fX * along + bX * GUN_BEAM, mz = player.z + fZ * along + bZ * GUN_BEAM;
      const tgt = hits[i % hits.length].n;
      muzzle(mx, mz, tgt.x, tgt.z);
      const res = rollShot(player.gunDmg, tgt.evasion, Math.hypot(tgt.x - player.x, tgt.z - player.z) / FIRE_RANGE);
      fireBall(mx, mz, tgt, res,
        () => { if (!tgt.alive) return;
          if (tgt.pvp) { damageFlash(tgt); burst(tgt.x, tgt.z, true, res.crit); sfxAt("hit", tgt.x, tgt.z, res.crit ? 1 : 0.85); if (pvp.hooks && pvp.hooks.localHit) pvp.hooks.localHit(tgt, res); return; }   // arena: the victim applies the damage
          tgt.hp -= res.dmg; if (!tgt.hostile) tgt.hostile = true; damageFlash(tgt); burst(tgt.x, tgt.z, true, res.crit); sfxAt("hit", tgt.x, tgt.z, res.crit ? 1 : 0.85); if (tgt.hp <= 0) sinkNPC(tgt); else if (selected === tgt) refreshInfo(); },   // attacking a neutral PROVOKES it
        (ax, az) => { burst(ax, az, false, false); sfxAt("miss", ax, az, 0.7); }, PLAYER_LEAD);   // YOUR guns lead well -> moving enemies are hittable
    }
  }
  let _fireMsgT = 0;
  function fireFeedback(kind) {   // "adjustment for the boat sailor": tell them to turn / wait (throttled)
    if (_fireMsgT > 0) return;
    _fireMsgT = 0.9;
    if (kind === "turn") banner("↩ Bring your guns to bear — turn to point a SIDE at them");
    else if (kind === "reload") banner("⏳ Guns reloading — hold your line");
    else if (kind === "select") banner("🎯 Click an enemy ship to target it, then SPACE to fire");
    else if (kind === "range") banner("🎯 Target out of range — close the distance");
  }
  // SPACE fires ONLY at the ship you've CLICKED to select — no target, no shot (so you never spray every ship in range).
  function fireAtSelected() {
    if (shopOpen || mode !== "sail") return;
    if (!selected || selected.hp <= 0 || npcs.indexOf(selected) < 0) { fireFeedback("select"); return; }   // must pick a target first
    const dx = selected.x - player.x, dz = selected.z - player.z, d2 = dx * dx + dz * dz;
    if (d2 >= FIRE_RANGE * FIRE_RANGE) { fireFeedback("range"); return; }                                    // selected ship too far to fire on
    const b = relBearing(player.x, player.z, player.yaw, selected.x, selected.z), ab = Math.abs(b);
    if (ab < ARC_MIN_R || ab > ARC_MAX_R) { fireFeedback("turn"); return; }                                  // fore/aft dead zone -> turn to bring a beam onto the target
    const side = b < 0 ? -1 : 1;                                                                              // the broadside that bears on the selected ship
    if ((side < 0 ? player.reloadTP : player.reloadTS) > 0) { fireFeedback("reload"); return; }               // that side still reloading
    fireBroadside(side, [{ n: selected, d2 }]);                                                               // volley the SELECTED ship only
  }
  function enemyFire(n, dt) {
    if (n.pvp) return;   // arena ships never use sandbox AI fire
    if (!n.alive || !n.hostile) return;
    if (mode !== "sail") return;                                     // HARD ASHORE GUARANTEE: no fire while you're on land (reload doesn't even tick)
    n.reloadT -= dt;
    if (Math.hypot(player.x - townPos.x, player.z - townPos.z) < SAFE_R) return;   // truly safe harbour — no fire on you here
    const dx = player.x - n.x, dz = player.z - n.z, d2 = dx * dx + dz * dz;
    if (d2 >= FIRE_RANGE * FIRE_RANGE || n.reloadT > 0 || segBlockedByIsland(n.x, n.z, player.x, player.z)) return;   // range + reload + LINE OF SIGHT (no firing through islands)
    if (n.engaged) { const off = Math.abs(relBearing(n.x, n.z, n.yaw, player.x, player.z)); if (Math.abs(off - Math.PI / 2) > ABEAM_R) return; }   // a circler must present a SIDE (abeam) to fire
    {
      n.reloadT = NPC_RELOAD * (0.8 + rng() * 0.5);
      sfxAt("fire", n.x, n.z, 0.6);                                   // enemy broadside — quieter, falls off with range
      muzzle(n.x, n.z, player.x, player.z);
      const res = rollShot(n.dmg, player.evasion, Math.sqrt(d2) / FIRE_RANGE);
      fireBall(n.x, n.z, player, res,                                 // DODGEABLE: leads your course; steer off it to evade
        () => { player.hp -= res.dmg; damageFlash(player); addShake(res.crit ? 1.0 : 0.55); burst(player.x, player.z, true, res.crit); sfxAt("hit", player.x, player.z, res.crit ? 1 : 0.85); if (player.hp <= 0) sinkPlayer(); },
        (ax, az) => { burst(ax, az, false, false); sfxAt("miss", ax, az, 0.7); });
    }
  }
  function sinkNPC(n) {
    if (n.pvp) { if (pvp.hooks && pvp.hooks.pvpEntrySunk) pvp.hooks.pvpEntrySunk(n); return; }   // authority for arena ships lives on the net module
    n.alive = false; n.hp = 0; n.sinkT = 0;
    burst(n.x, n.z, true, false); sinkSplash(n.x, n.z, (n.level || 1) >= 4); sfxAt("sink", n.x, n.z, 1);
    if (selected === n) deselect();
    if (n.boss) { onBossDefeated(n); return; }                          // the Dreadmaw: big reward + dawn (no normal XP line, no respawn)
    gainXP(6 + n.level * 5);
  }
  // ── SHIP RAMMING (owner-confirmed): hulls that touch damage BOTH. NPCs already steer to AVOID each other (the separation
  // pass in stepNPC), but in a melee they clash. Your RAM power scales UP and the damage you take scales DOWN with the HULL
  // upgrade, so "attack by hitting with your ship" is a real, upgrade-driven tactic. A short per-ship cooldown stops a scrape
  // from draining HP every frame; an overlap always shoves the hulls apart so they can't pass through each other.
  const SHIP_COLL_R = 12, RAM_BASE = 11, RAM_CD = 0.7;   // DR = 2*R = 24 (hull lengths are 16..30) — ram/collide only on near-contact, not from far off
  function _shipVel(s) { return { x: Math.sin(s.yaw) * (s.speed || 0), z: Math.cos(s.yaw) * (s.speed || 0) }; }
  function stepCollisions(dt) {
    if (mode !== "sail" || !gameStarted) return;   // never ram the FROZEN player behind the title/attract screen (that damage would carry into the game)
    const DR = SHIP_COLL_R * 2, DR2 = DR * DR;
    if ((player.collCD || 0) > 0) player.collCD -= dt;
    for (const n of npcs) {                                     // player <-> ships
      if (!n.alive) continue; if ((n.collCD || 0) > 0) n.collCD -= dt;
      const dx = n.x - player.x, dz = n.z - player.z, d2 = dx * dx + dz * dz;
      if (d2 >= DR2 || d2 < 1) continue;
      const d = Math.sqrt(d2), ux = dx / d, uz = dz / d, push = (DR - d) * 0.5;   // shove the hulls apart — SOLID, no pass-through
      player.x -= ux * push; player.z -= uz * push; n.x += ux * push; n.z += uz * push;
      if ((player.collCD || 0) > 0 || (n.collCD || 0) > 0) continue;             // still ringing from the last impact
      const pv = _shipVel(player), nv = _shipVel(n), closing = Math.abs((pv.x - nv.x) * ux + (pv.z - nv.z) * uz) + 5;
      const base = RAM_BASE * (0.5 + Math.min(1.7, closing / 26)), hull = (upg.hull || 0);
      const nRes = 1 + (n.level || 1) * 0.13, nRam = 1 + (n.level || 1) * 0.11;   // higher-level ships = TOUGHER hull + ram HARDER (they carry upgrades)
      if (n.pvp) { damageFlash(n); if (pvp.hooks && pvp.hooks.localRam) pvp.hooks.localRam(n, Math.round(base * (1 + hull * 0.6) / nRes)); }   // arena: route ram damage to the owner
      else { n.hp -= Math.round(base * (1 + hull * 0.6) / nRes); n.hostile = true; damageFlash(n); }   // your reinforced bow hits harder; their tougher hull takes less
      player.hp -= Math.round(base * nRam / (1 + hull * 0.5)); damageFlash(player);            // a bigger enemy rams YOU harder; your hull upgrade absorbs it
      player.speed = player.speed > 2 ? -5 : player.speed;                        // SOLID impact — a forward ram bounces you back; you must reverse to peel off
      n.speed *= 0.4;
      burst((player.x + n.x) / 2, (player.z + n.z) / 2, true, false); sfxAt("hit", n.x, n.z, 0.9); addShake(1.0);
      player.collCD = n.collCD = RAM_CD;
      if (!n.pvp && n.hp <= 0) { banner("💥 Rammed her under!"); if (selected === n) deselect(); sinkNPC(n); }
      if (player.hp <= 0) { sinkPlayer(); return; }
    }
    for (let i = 0; i < npcs.length; i++) { const a = npcs[i]; if (!a.alive || !a.mesh.visible) continue;   // ship <-> ship (near only)
      for (let j = i + 1; j < npcs.length; j++) { const b = npcs[j]; if (!b.alive || !b.mesh.visible) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz; if (d2 >= DR2 || d2 < 1) continue;
        const d = Math.sqrt(d2), ux = dx / d, uz = dz / d, push = (DR - d) * 0.5;
        a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
        if (a.pvp || b.pvp) continue;   // arena ships: push-apart only — hp is owned remotely
        if ((a.collCD || 0) > 0 || (b.collCD || 0) > 0) continue;
        const av = _shipVel(a), bv = _shipVel(b), closing = Math.abs((av.x - bv.x) * ux + (av.z - bv.z) * uz) + 4;
        const dmg = RAM_BASE * 0.45 * (0.5 + Math.min(1.5, closing / 26));
        a.hp -= Math.max(1, Math.round(dmg / (1 + (a.level || 1) * 0.13))); b.hp -= Math.max(1, Math.round(dmg / (1 + (b.level || 1) * 0.13)));
        damageFlash(a); damageFlash(b); burst((a.x + b.x) / 2, (a.z + b.z) / 2, true, false); a.speed *= 0.5; b.speed *= 0.5;
        a.collCD = b.collCD = RAM_CD;
        if (a.hp <= 0) { if (selected === a) deselect(); sinkNPC(a); }
        if (b.hp <= 0) { if (selected === b) deselect(); sinkNPC(b); }
      }
    }
  }
  function respawnNPC(n) {
    let x = n.x, z = n.z;
    for (let t = 0; t < 30; t++) { const a = rng() * 6.28, r = Math.sqrt(n.rIn * n.rIn + rng() * (n.rOut * n.rOut - n.rIn * n.rIn)); const nx = clampSea(Math.cos(a) * r), nz = clampSea(Math.sin(a) * r); if (!overlapsLand(nx, nz, 55) && Math.hypot(nx - player.x, nz - player.z) > 260) { x = nx; z = nz; break; } }
    n.x = x; n.z = z; n.hp = n.hpMax; n.alive = true; n.sinkT = 0; n.reloadT = rng() * NPC_RELOAD;
    n.mesh.visible = true; n.mesh.rotation.z = 0; n.mesh.position.set(x, 0, z);   // (scale is baked into the pivot — leave it)
  }
  function sinkPlayer() {
    if (pvp.active) { if (pvp.hooks && pvp.hooks.meSunk) pvp.hooks.meSunk(); return; }   // arena: spectate + match logic, no harbor respawn
    playSfx("sink", 1, 0.9);
    banner(`💀 Your ship was sunk! Back to ${TOWN_NAME}.`);
    if (mode === "ashore") leaveIsland();
    player.hp = player.hpMax; player.speed = 0;
    sinkSplash(player.x, player.z, true); addShake(1.3);
    { const s = harborSpawn(); player.x = s.x; player.z = s.z; player.yaw = s.yaw; }   // respawn in clear water, not grounded in the harbour
    burst(player.x, player.z, false, false);
  }

  // ── NIGHT + BOSS ("The Dreadmaw") — a recurring night raid. After a stretch of open-water sailing, night
  // descends and a big dark ghost-lit pirateLg surfaces near you; sink it for gold+XP (dawn returns), or flee
  // to safe harbour / die and it submerges. It's a normal NPC (reuses stepNPC/enemyFire/computeEngageSet, so
  // the ≤3-attacker cap still holds) but hits HARD (high hp+dmg, not faster). ─────────────────────────────
  const _bossGrave = [];   // defeated bosses sinking, reaped (spliced) in stepBoss OUTSIDE the npc loop
  function applyEnv() {   // ONE place folds the DAY baseline + NIGHT (night.t) + STORM (storm.intensity) so they COMPOSE, never clobber
    const t = night.t, s = storm.intensity;
    let exp = (BASE_EXPOSURE + (0.26 - BASE_EXPOSURE) * t) * (1 - 0.34 * s);   // night darkens; storm darkens further
    if (_lightFlash > 0) exp += _lightFlash * 5.5;                            // lightning: a brief bright pop
    kernel.renderer.toneMappingExposure = exp;
    if (kernel.sun) { kernel.sun.intensity = (BASE_SUN_I + (0.5 - BASE_SUN_I) * t) * (1 - 0.55 * s); kernel.sun.color.copy(BASE_SUN_COL).lerp(NIGHT_SUN_COL, Math.max(t, s * 0.65)); }
    if (scene.fog) { _envCol.copy(BASE_FOG_COL).lerp(NIGHT_FOG_COL, t).lerp(STORM_FOG_COL, s * 0.85); scene.fog.color.copy(_envCol); const nf = BASE_FOG_FAR + (600 - BASE_FOG_FAR) * t; scene.fog.far = nf - (nf - 330) * s; }   // storm pulls the fog wall in
    scene.environmentIntensity = (BASE_ENV + (0.16 - BASE_ENV) * t) * (1 - 0.42 * s);
    const wu = water.material.uniforms;
    if (wu["waterColor"]) { _envCol.copy(BASE_WATER_COL).lerp(NIGHT_WATER_COL, t).lerp(STORM_WATER_COL, s * 0.7); wu["waterColor"].value.copy(_envCol); }
    if (wu["sunColor"]) wu["sunColor"].value.copy(BASE_WSUN_COL).lerp(NIGHT_WSUN_COL, Math.max(t, s * 0.6));
    if (wu["distortionScale"]) wu["distortionScale"].value = BASE_DISTORT + (STORM_DISTORT - BASE_DISTORT) * s;   // rougher swell
    if (wu["size"]) wu["size"].value = BASE_SIZE + (STORM_SIZE - BASE_SIZE) * s;                                 // bigger waves
    skyU["rayleigh"].value = BASE_RAYLEIGH + (0.7 - BASE_RAYLEIGH) * t;
    skyU["turbidity"].value = (BASE_TURBIDITY + (3.0 - BASE_TURBIDITY) * t) + 10 * s;                            // storm hazes the sky
    nightAmbient.intensity = 0.36 * t;
    moon.visible = t > 0.02 && s < 0.75; moon.material.opacity = Math.min(1, t * 1.25) * (1 - Math.min(1, s * 1.3));   // storm clouds swallow the moon
  }
  function stepNight(dt) {
    const rate = night.target > night.t ? 0.30 : 0.22;                 // descend faster than it lifts (dramatic fall, gentle dawn)
    night.t += Math.max(-rate * dt, Math.min(rate * dt, night.target - night.t));
    storm.intensity += (storm.target - storm.intensity) * Math.min(1, dt * 0.5);   // ramp the storm visuals (renders during pause too, like night)
    if (_lightFlash > 0) _lightFlash = Math.max(0, _lightFlash - dt * 3.2);
    applyEnv();
  }
  // ── RAIN (one InstancedMesh = one draw call) + LIGHTNING + squall scheduling ──
  const RAIN_N = 175; const _rainDummy = new THREE.Object3D();
  function ensureRain() {
    if (_rainMesh) return;
    const geo = new THREE.BoxGeometry(0.16, 6.5, 0.16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd2e4f4, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    _rainMesh = new THREE.InstancedMesh(geo, mat, RAIN_N); _rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _rainMesh.frustumCulled = false; _rainMesh.castShadow = false; _rainMesh.visible = false; scene.add(_rainMesh);
    const cx = kernel.camera.position.x, cz = kernel.camera.position.z;
    for (let i = 0; i < RAIN_N; i++) _rainDrops.push({ x: cx + (Math.random() - 0.5) * 90, y: 4 + Math.random() * 75, z: cz + (Math.random() - 0.5) * 90, vy: 66 + Math.random() * 45 });
  }
  function updateRain(dt) {
    const active = storm.intensity > 0.12 && mode === "sail";
    if (!_rainMesh) { if (!active) return; ensureRain(); }
    _rainMesh.visible = active; if (!active) return;
    const cam = kernel.camera.position, tilt = Math.sin(storm.windDir) * 0.28, push = storm.intensity * 12;
    for (let i = 0; i < RAIN_N; i++) { const d = _rainDrops[i];
      d.y -= d.vy * dt; d.x += Math.sin(storm.windDir) * push * dt; d.z += Math.cos(storm.windDir) * push * dt;
      if (d.y < 1.5 || Math.abs(d.x - cam.x) > 85 || Math.abs(d.z - cam.z) > 85) { d.x = cam.x + (Math.random() - 0.5) * 90; d.z = cam.z + (Math.random() - 0.5) * 90; d.y = 45 + Math.random() * 55; d.vy = 66 + Math.random() * 45; }
      _rainDummy.position.set(d.x, d.y, d.z); _rainDummy.rotation.set(tilt, 0, tilt); _rainDummy.updateMatrix(); _rainMesh.setMatrixAt(i, _rainDummy.matrix);
    }
    _rainMesh.instanceMatrix.needsUpdate = true;
  }
  function lightningFlash() { _lightFlash = 0.11 + Math.random() * 0.06; addShake(0.45 + Math.random() * 0.4); }   // brief bright pop + thunder shake
  function stepStorm(dt) {
    if (mode === "sail") {                                             // the weather clock only advances at sea (frozen ashore, like the night cycle)
      storm.nextT -= dt;
      if (storm.nextT <= 0) {
        if (storm.target > 0.4) { storm.target = 0; storm.nextT = STORM_CALM_MIN + Math.random() * (STORM_CALM_MAX - STORM_CALM_MIN); }   // squall passes -> calm gap
        else { storm.target = 0.62 + Math.random() * 0.33; storm.windDir = Math.random() * 6.28; storm.nextT = STORM_DUR_MIN + Math.random() * (STORM_DUR_MAX - STORM_DUR_MIN); banner("⛈ A squall rolls in…"); }   // a storm builds
      }
    }
    updateRain(dt);
    if (mode === "sail" && storm.intensity > 0.42) { _lightT -= dt; if (_lightT <= 0) { _lightT = 1.6 + Math.random() * 4.5; lightningFlash(); } }   // lightning at SEA only (like rain + the HUD badge) — no flash/shake on foot ashore
  }
  function disposeShip(mesh) { mesh.traverse((n) => { if (n.isMesh && n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((mt) => mt && mt.dispose && mt.dispose()); }); }   // dispose per-instance CLONED materials only — the hull geometry is SHARED from the proto (never per-ship), so leave it
  function dawnBreak() { night.target = 0; night.dur = 0; night.cool = NIGHT_GAP_MIN + Math.random() * (NIGHT_GAP_MAX - NIGHT_GAP_MIN); }   // end the night (survived/killed) + schedule the next
  function startNight() {
    night.target = 1; night.dur = NIGHT_DUR;
    banner("🌙 Night falls over the water…");
    if (!boss.ship && Math.random() < SEA_BOSS_CHANCE) riseBoss();      // ~1 in 5 nights: the Dreadmaw prowls (spawns FAR — a hunt, not an ambush)
  }
  function endNight() { if (boss.ship && boss.ship.alive) despawnBoss("🌅 Dawn breaks — the Dreadmaw dives deep…"); else dawnBreak(); }
  function riseBoss() {   // spawn the Dreadmaw FAR from the player (a hunt); the day/night clock is owned by the cycle, not here
    if (boss.ship) return;
    let sx, sz, ok = false;
    for (let t = 0; t < 40 && !ok; t++) { const a = rng() * 6.28, r = 820 + rng() * 340; const cx = clampSea(player.x + Math.cos(a) * r), cz = clampSea(player.z + Math.sin(a) * r); if (!overlapsLand(cx, cz, 70) && Math.hypot(cx - townPos.x, cz - townPos.z) > SAFE_R + 140) { sx = cx; sz = cz; ok = true; } }
    if (!ok) return;   // no clear far-water spot -> no boss this night (never ground the Dreadmaw on a rejected point); commit only on success, like respawnNPC
    const lvl = Math.max(5, player.level + 2), hpMax = 420 + player.level * 45;
    const mesh = makeShip("pirateLg", true); mesh.position.set(sx, 0, sz); mesh.scale.multiplyScalar(1.28);   // bigger + menacing than any belt pirate
    mesh.traverse((n) => { if (n.isMesh && n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((mt) => { if (mt.color) mt.color.multiplyScalar(0.42); if (mt.emissive) mt.emissive.setHex(0x37060a); }); });   // dark hull + faint ghostly red glow
    mesh.userData.hullMats.forEach((mt) => { if (mt.emissive) mt.userData._baseEmis = mt.emissive.clone(); });   // snapshot the ghost-glow as the flash-restore baseline
    scene.add(mesh);
    const b = { x: sx, z: sz, yaw: Math.atan2(player.x - sx, player.z - sz), wanderYaw: 0, speed: 10, maxSpeed: 15, turnRate: 0.5, retargetT: rand(2, 5),
      mesh, hostile: true, bob: rng() * 6.28, level: lvl, dmg: 22 + player.level * 2, hp: hpMax, hpMax, type: "The Dreadmaw",
      rIn: 0, rOut: SEA, evasion: 0, reloadT: 1.6, alive: true, sinkT: 0, flashT: 0, hullMats: mesh.userData.hullMats,
      idx: npcs.length, orbitSide: rng() < 0.5 ? -1 : 1, orbitHystT: 0, engaged: false, boss: true };
    npcs.push(b); boss.ship = b;
    banner("🌑 The sea turns black — a vast dread prowls the deep…"); addShake(0.7);   // vague: HUNT it via the minimap skull + the ☠ bar's distance
    if (typeof setMusicState === "function") setMusicState("battle");
  }
  function onBossDefeated(n) {
    const reward = 320 + n.level * 45;
    player.gold += reward; gainXP(120 + n.level * 12);
    banner(`☠ The Dreadmaw is vanquished! +${reward} gold`); addShake(1.2);
    boss.ship = null; _bossGrave.push(n); dawnBreak();   // let its mesh sink (reaped in stepBoss); dawn breaks on victory; never respawns
  }
  function despawnBoss(msg) {
    const b = boss.ship; if (!b) return;
    scene.remove(b.mesh); disposeShip(b.mesh); const i = npcs.indexOf(b); if (i >= 0) npcs.splice(i, 1);
    boss.ship = null; dawnBreak(); if (msg) banner(msg);
  }
  function stepBoss(dt) {
    for (let i = _bossGrave.length - 1; i >= 0; i--) { const b = _bossGrave[i]; if (b.sinkT > 9) { scene.remove(b.mesh); disposeShip(b.mesh); const j = npcs.indexOf(b); if (j >= 0) npcs.splice(j, 1); _bossGrave.splice(i, 1); } }   // reap sunk bosses (safe: outside the npc loop)
    if (mode !== "sail") return;                                        // the day/night clock only advances at sea (frozen ashore, so a night landing stays night)
    if (boss.ship && boss.ship.alive && Math.hypot(player.x - townPos.x, player.z - townPos.z) < SAFE_R) { despawnBoss("🌅 You reach safe harbour — the Dreadmaw slips into the deep…"); return; }   // fled to harbour -> it submerges + dawn
    if (night.target < 0.5) { night.cool -= dt; if (night.cool <= 0 && night.t < 0.05) startNight(); }   // DAY: count down to nightfall (wait for the last dawn to finish fading)
    else { night.dur -= dt; if (night.dur <= 0) endNight(); }                                             // NIGHT: count down to dawn
  }

  // ── ON-ISLAND ASHORE CONTENT: enemy foot-pirates to fight (same d20 rollShot dice) + treasure
  // chests for gold/XP. Spawned when you go ashore, cleared when you leave. Harder (further-out)
  // islands field more + tougher pirates. ──────────────────────────────────────────────────────
  let footFoes = [], footChests = [];   // ALIASES for the current ashore island's is.foes / is.chests (set in enterIsland)
  const HERO_ATK = 22, ARROW_HITR = 9, FOE_ATK_RANGE = 15, FOE_AGGRO = 70;   // a foe only WAKES when the hero is within this AND in line of sight — so you fight nearby pirates, not the whole island at once

  // ── ASHORE COMBAT UI + RANGED ─────────────────────────────────────────────────
  // A projected DOM overlay draws a floating HP bar over every away-party member + engaged foe, and rising
  // D&D damage numbers (grey MISS / white hit / gold CRIT) over whoever is struck — hero, recruits, OR pirates.
  // The hero wields a pirate CUTLASS: LEFT-CLICK/SPACE swings it in a frontal arc and strikes the nearest foe in reach (melee).
  // The HIRED CREW are wizards — allies that lob glowing SPELL ORBS at foes. Both are visible flying projectiles (_bolts).
  const BOW_RANGE = 145, BOW_CD = 0.75, ARROW_SPD = 130, GUN_SPD = 300;   // (legacy gun — kept for debug hooks; the live ashore attack is now a CUTLASS melee)
  const MELEE_RANGE = 18, MELEE_ARC = 0.25, SLASH_CD = 0.55;              // cutlass reach + frontal cone (dot>0.25 ≈ ±76°) + swing cooldown
  const SPELL_SPD = 78;                                                     // crew wizard orbs fly slow + readable (big glowing orb + tail)
  let _ovlEl = null; const _bars = new Map(), _dmgN = [], _bolts = []; const _projV = new THREE.Vector3();
  const FAC_COL = { hero: "#46e07a", crew: "#4aa8ff", pirate: "#ff6a6a", marauder: "#ff2f2f" };   // HP-bar colour = faction (friend green/blue, foe red)
  function _overlay() { if (!_ovlEl) { _ovlEl = document.createElement("div"); _ovlEl.style.cssText = "position:absolute;inset:0;z-index:53;pointer-events:none;overflow:hidden"; (kernel.parent || document.body).appendChild(_ovlEl); } return _ovlEl; }
  function _proj(wx, wy, wz) {   // world -> overlay px; null if behind the camera
    _projV.set(wx, wy, wz).project(kernel.camera); if (_projV.z > 1) return null;
    const c = kernel.renderer.domElement; return { x: (_projV.x * 0.5 + 0.5) * c.clientWidth, y: (-_projV.y * 0.5 + 0.5) * c.clientHeight };
  }
  function _bar(ent) { let b = _bars.get(ent); if (!b) { const el = document.createElement("div"); el.style.cssText = "position:absolute;width:44px;height:6px;transform:translate(-50%,-50%);border:1px solid rgba(0,0,0,.7);border-radius:3px;background:rgba(0,0,0,.5);box-shadow:0 1px 3px rgba(0,0,0,.6);display:none"; const fill = document.createElement("div"); fill.style.cssText = "height:100%;border-radius:2px;width:100%"; el.appendChild(fill); _overlay().appendChild(el); b = { el, fill }; _bars.set(ent, b); } return b; }
  function _showBar(ent, wx, wz, hp, hpMax, headY, fac) {
    const b = _bar(ent), gy = ashoreIsle ? groundYOn(ashoreIsle, wx, wz) : 0, p = _proj(wx, gy + headY, wz);
    if (!p || hp <= 0) { b.el.style.display = "none"; return; }
    b.el.style.display = "block"; b.el.style.left = p.x + "px"; b.el.style.top = p.y + "px";
    b.fill.style.width = (Math.max(0, Math.min(1, hp / hpMax)) * 100) + "%"; b.fill.style.background = FAC_COL[fac] || "#ff6a6a";
  }
  function popDamage(wx, wy, wz, text, kind) {
    const st = kind === "miss" ? "color:#c2cdd6;font-size:13px" : kind === "crit" ? "color:#ffd84a;font-size:19px" : kind === "heal" ? "color:#7dff9a;font-size:14px" : "color:#fff;font-size:15px";
    const el = document.createElement("div"); el.style.cssText = "position:absolute;transform:translate(-50%,-50%);font-weight:800;font-family:'Segoe UI',sans-serif;text-shadow:0 1px 3px #000,0 0 6px rgba(0,0,0,.6);white-space:nowrap;" + st;
    el.textContent = text; _overlay().appendChild(el); _dmgN.push({ el, wx, wy, wz, life: 0.95, life0: 0.95 });
  }
  function popRoll(wx, wy, wz, res) { if (!res.hit) popDamage(wx, wy, wz, "MISS", "miss"); else popDamage(wx, wy, wz, (res.crit ? "CRIT " : "") + Math.max(1, Math.round(res.dmg)), res.crit ? "crit" : "hit"); }
  function clearOverlay() { for (const [, b] of _bars) b.el.remove(); _bars.clear(); for (const d of _dmgN) d.el.remove(); _dmgN.length = 0; for (const a of _bolts) scene.remove(a.mesh); _bolts.length = 0; for (const t of _trail) scene.remove(t.mesh); _trail.length = 0; for (const s of _gunsmoke) scene.remove(s.mesh); _gunsmoke.length = 0; }
  function updateOverlay(dt) {
    const seen = new Set();
    if (hero.hp > 0) { _showBar(hero, hero.x, hero.z, hero.hp, hero.hpMax, 13, "hero"); seen.add(hero); }
    for (const c of crewParty) { if (c.down) continue; _showBar(c, c.x, c.z, c.hp, c.hpMax, 11, "crew"); seen.add(c); }
    for (const f of footFoes) { if (!f.alive) continue; const near = f.aggro || (f.x - hero.x) * (f.x - hero.x) + (f.z - hero.z) * (f.z - hero.z) < 140 * 140; if (!near) continue; _showBar(f, f.x, f.z, f.hp, f.hpMax, f.kind === "marauder" ? 15 : 12, f.kind); seen.add(f); }
    for (const [ent, b] of _bars) if (!seen.has(ent)) { b.el.remove(); _bars.delete(ent); }
    for (let i = _dmgN.length - 1; i >= 0; i--) { const d = _dmgN[i]; d.life -= dt; if (d.life <= 0) { d.el.remove(); _dmgN.splice(i, 1); continue; } d.wy += 14 * dt; const p = _proj(d.wx, d.wy, d.wz); if (!p) { d.el.style.display = "none"; continue; } d.el.style.display = "block"; d.el.style.left = p.x + "px"; d.el.style.top = p.y + "px"; d.el.style.opacity = Math.min(1, d.life / d.life0 * 1.6); }
    updateBolts(dt); updateTrail(dt);
  }
  // ── Visible projectiles ────────────────────────────────────────────────────────
  function makeArrowMesh() {   // a chunky, readable arrow: shaft + bright metal head + fletching
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 9, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a24, roughness: 1 })); shaft.rotation.x = Math.PI / 2; g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.6, roughness: 0.4 })); head.rotation.x = Math.PI / 2; head.position.z = 5.2; g.add(head);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.2, 4), new THREE.MeshStandardMaterial({ color: 0xe8402e, roughness: 1 })); fl.rotation.x = -Math.PI / 2; fl.position.z = -4; g.add(fl);
    return g;
  }
  function makeBulletMesh() {   // a lead MUSKET BALL with a warm tracer glow so you can see the shot fly
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshStandardMaterial({ color: 0x28282a, metalness: 0.5, roughness: 0.5 })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })));
    return g;
  }
  function heroMuzzleFlash(mx, my, mz) {   // a bright flash + a LINGERING drifting gunsmoke cloud at the gun barrel
    const f = new THREE.Mesh(new THREE.SphereGeometry(1.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.set(mx, my, mz); scene.add(f); _fx.push({ mesh: f, life: 1, fast: true });
    puffSmoke(mx, my + 0.4, mz);
  }
  // A soft grey powder-smoke cloud that HANGS + drifts up + slowly fades (a few puffs) — cosmetic -> Math.random.
  const _gunsmoke = [];
  function puffSmoke(x, y, z) {
    if (_gunsmoke.length > 40) return;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.0 + Math.random() * 0.7, 7, 6), new THREE.MeshBasicMaterial({ color: 0xb9bec2, transparent: true, opacity: 0.42, depthWrite: false }));
      m.position.set(x + (Math.random() - 0.5) * 1.6, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.6); scene.add(m);
      _gunsmoke.push({ mesh: m, life: 1.2 + Math.random() * 0.5, life0: 1.5, vy: 2.2 + Math.random() * 1.6, grow: 2.6 + Math.random() });
    }
  }
  function updateGunsmoke(dt) {
    for (let i = _gunsmoke.length - 1; i >= 0; i--) { const s = _gunsmoke[i]; s.life -= dt;
      if (s.life <= 0) { scene.remove(s.mesh); s.mesh.material.dispose(); _gunsmoke.splice(i, 1); continue; }
      s.mesh.position.y += s.vy * dt; s.mesh.scale.setScalar(s.mesh.scale.x + s.grow * dt); s.mesh.material.opacity = Math.min(0.42, (s.life / s.life0) * 0.5); }
  }
  function makeSpellMesh() {   // a BIG glowing arcane orb with a bright core + soft halo — unmistakably a "spell"
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(2.3, 14, 12), new THREE.MeshBasicMaterial({ color: 0xe8d4ff })));                                   // bright white-violet core
    g.add(new THREE.Mesh(new THREE.SphereGeometry(3.3, 14, 12), new THREE.MeshBasicMaterial({ color: 0xb37bff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(5.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0x7a3dff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));   // wide glow halo
    return g;
  }
  // a glowing tail so you SEE the spell fly: small additive dots dropped behind each spell orb, fading fast.
  const _trailGeo = new THREE.SphereGeometry(1, 8, 6); const _trail = [];
  function spawnTrail(x, y, z) { if (_trail.length > 70) return; const m = new THREE.Mesh(_trailGeo, new THREE.MeshBasicMaterial({ color: 0xb37bff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.set(x, y, z); m.scale.setScalar(2.2); scene.add(m); _trail.push({ mesh: m, life: 0.45 }); }
  function updateTrail(dt) { for (let i = _trail.length - 1; i >= 0; i--) { const t = _trail[i]; t.life -= dt; if (t.life <= 0) { scene.remove(t.mesh); t.mesh.material.dispose(); _trail.splice(i, 1); continue; } const k = t.life / 0.45; t.mesh.material.opacity = k * 0.6; t.mesh.scale.setScalar(2.2 * k); } }
  // spawn a flying bolt (arrow or spell) from (sx,sy,sz) to a live target; onArrive rolls the dice + applies it.
  function spawnBolt(kind, sx, sy, sz, tx, ty, tz, spd, onArrive) {
    const mesh = kind === "spell" ? makeSpellMesh() : makeArrowMesh(); mesh.position.set(sx, sy, sz); scene.add(mesh);
    const dur = Math.max(0.18, Math.hypot(tx - sx, tz - sz) / spd);
    _bolts.push({ kind, mesh, sx, sy, sz, tx, ty, tz, t: 0, dur, spin: kind === "spell" ? 3.5 : 0, onArrive });
  }
  function updateBolts(dt) {
    for (let i = _bolts.length - 1; i >= 0; i--) {
      const a = _bolts[i]; a.t += dt / a.dur; const k = Math.min(1, a.t);
      const x = a.sx + (a.tx - a.sx) * k, y = a.sy + (a.ty - a.sy) * k + Math.sin(k * Math.PI) * (a.kind === "spell" ? 2 : 3.5), z = a.sz + (a.tz - a.sz) * k;
      a.mesh.position.set(x, y, z);
      if (a.kind === "spell") { a.mesh.rotation.y += a.spin * dt; spawnTrail(x, y, z); } else a.mesh.lookAt(a.tx, a.ty, a.tz);
      // PLAYER ARROW: dodgeable ballistic collision — strike the FIRST foe in its flight path, then stop.
      if (a.collide && ashoreIsle) {
        let struck = null; for (const f of footFoes) { if (!f.alive) continue; const dx = f.x - x, dz = f.z - z; if (dx * dx + dz * dz < ARROW_HITR * ARROW_HITR) { struck = f; break; } }
        if (struck) { arrowStrike(struck, a); scene.remove(a.mesh); _bolts.splice(i, 1); continue; }
      }
      if (a.t < 1) continue;
      scene.remove(a.mesh); _bolts.splice(i, 1); if (ashoreIsle && a.onArrive) a.onArrive();
    }
  }
  // DIRECTIONAL arrow (owner: no LOCK-IN, no heat-seeking). It flies straight along (dirx,dirz) to max range and
  // strikes the FIRST foe it passes through — so you AIM (turn / click a spot), and a foe can step aside to DODGE.
  function fireArrowDir(dirx, dirz, chargeMult) {   // fire the OLD GUN: a fast musket ball, muzzle flash + smoke, and a gunshot crack (chargeMult>1 = a charged shot)
    const dd = Math.hypot(dirx, dirz) || 1; dirx /= dd; dirz /= dd;
    hero.yaw = Math.atan2(dirx, dirz); if (hero.play) hero.play("ranged", { once: true, timeScale: 2.0 }); hero.animT = 0.7;   // the quick-draw shot plays through fast instead of freezing mid-draw
    const sx = hero.x + dirx * 5, sz = hero.z + dirz * 5, sy = groundYOn(ashoreIsle, hero.x, hero.z) + 9;   // muzzle just ahead of the hero
    const tx = hero.x + dirx * BOW_RANGE, tz = hero.z + dirz * BOW_RANGE, ty = groundYOn(ashoreIsle, tx, tz) + 5;
    const b = { kind: "arrow", mesh: makeBulletMesh(), sx, sy, sz, tx, ty, tz, t: 0, dur: Math.max(0.12, BOW_RANGE / GUN_SPD), spin: 0, collide: true, chargeMult: chargeMult || 1 };
    b.mesh.position.set(sx, sy, sz); scene.add(b.mesh); _bolts.push(b);
    heroMuzzleFlash(sx, sy, sz); playGunshot(0.85);
  }
  const FOE_ALERT_R = 55;   // getting shot/hit wakes the foe AND its nearby mates -> no more picking pirates off from safe range
  function alertFoes(f) {   // a foe the hero attacked (even a MISS aimed at it) instantly engages, and alerts its neighbours
    if (f) f.aggro = true;
    for (const o of footFoes) { if (o !== f && o.alive && !o.aggro && f) { const dx = o.x - f.x, dz = o.z - f.z; if (dx * dx + dz * dz < FOE_ALERT_R * FOE_ALERT_R) o.aggro = true; } }
  }
  function arrowStrike(f, a) {   // a player arrow reached a foe: roll the D&D dice (a dice-miss can still whiff)
    alertFoes(f);              // being shot AT wakes it — it charges you instead of standing there to be farmed
    const res = rollShot(HERO_ATK * (a.chargeMult || 1), 1, Math.min(0.9, Math.hypot(f.x - a.sx, f.z - a.sz) / BOW_RANGE));   // chargeMult>1 = a charged musket ball
    popRoll(f.x, groundYOn(ashoreIsle, f.x, f.z) + (f.kind === "marauder" ? 15 : 11), f.z, res);
    if (!res.hit) { sfxAt("miss", f.x, f.z, 0.5); return; }
    burst(f.x, groundYOn(ashoreIsle, f.x, f.z) + 3, true, res.crit); sfxAt("hit", f.x, f.z, res.crit ? 0.9 : 0.7);
    if ((f.hp -= res.dmg) <= 0) { f.alive = false; f.deathT = 1.1; if (f.play) f.play("death", { once: true }); sfxAt("sink", f.x, f.z, 0.5);
      if (f.boss) landBossReward(f); else { const g = 5 + f.level * 3; gainXP(4 + f.level * 3); player.gold += g; banner("🏹 Pirate down! +" + g + " gold"); } }
  }
  function crewCastSpell(c, foe) {   // a hired WIZARD crew-mate lobs a glowing spell orb at an enemy
    if (c.play) c.play("ranged", { once: true }); c.animT = 0.7;
    const sy = groundYOn(ashoreIsle, c.x, c.z) + 11, ty = groundYOn(ashoreIsle, foe.x, foe.z) + (foe.kind === "marauder" ? 8 : 6);
    spawnBolt("spell", c.x, sy, c.z, foe.x, ty, foe.z, SPELL_SPD, () => {
      if (!foe.alive || !ashoreIsle) return;
      alertFoes(foe);            // crew fire also wakes the target + its mates
      const res = rollShot(c.dmg, 1, 0.25);
      popRoll(foe.x, groundYOn(ashoreIsle, foe.x, foe.z) + (foe.kind === "marauder" ? 15 : 11), foe.z, res);
      if (!res.hit) { sfxAt("miss", foe.x, foe.z, 0.5); return; }
      burst(foe.x, groundYOn(ashoreIsle, foe.x, foe.z) + 3, true, res.crit); sfxAt("hit", foe.x, foe.z, res.crit ? 0.85 : 0.6);
      if ((foe.hp -= res.dmg) <= 0) { foe.alive = false; foe.deathT = 1.1; if (foe.play) foe.play("death", { once: true }); sfxAt("sink", foe.x, foe.z, 0.5);
        if (foe.boss) landBossReward(foe); else { const g = 4 + foe.level * 3; player.gold += g; crewGainXP(c.ref, 4 + foe.level * 3); banner("✨ " + c.name + " blasted a pirate! +" + g + "g"); } }
    });
    sfxAt("fire", c.x, c.z, 0.45);
  }
  // Terrain line-of-sight on an island: false if a hill rises above the sight line between two points.
  function losTerrain(is, ax, az, bx, bz) {
    const ya = groundYOn(is, ax, az) + 3, yb = groundYOn(is, bx, bz) + 3;   // ~eye height
    for (let t = 0.2; t < 0.99; t += 0.2) { const sight = ya + (yb - ya) * t; if (groundYOn(is, ax + (bx - ax) * t, az + (bz - az) * t) > sight + 2) return false; }
    return true;
  }
  function _spotNear(is, cx, cz, minR, maxR) {   // a DRY-LAND point within [minR,maxR] of (cx,cz)
    for (let t = 0; t < 32; t++) { const a = rng() * 6.28, r = minR + rng() * (maxR - minR), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (_isleH(x - is.x, z - is.z, is.r, is.ox, is.oz, is.sh) > 1.2) return { x, z }; }
    return { x: cx, z: cz };
  }
  // ashore attack = LEFT-CLICK looses an arrow toward the CURSOR point; SPACE looses one straight AHEAD. No auto-lock.
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _aimPlane = new THREE.Plane(), _aimPt = new THREE.Vector3();
  function groundPointAt(clientX, clientY) {   // world (x,z) under the cursor, on a horizontal plane at ~hero chest height
    const el = kernel.renderer.domElement, r = el.getBoundingClientRect();
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_ndc, kernel.camera);
    const gy = ashoreIsle ? groundYOn(ashoreIsle, hero.x, hero.z) : 0;
    _aimPlane.set(new THREE.Vector3(0, 1, 0), -(gy + 3));
    return _ray.ray.intersectPlane(_aimPlane, _aimPt) ? { x: _aimPt.x, z: _aimPt.z } : null;
  }
  function slashFx(x, z, yaw) {   // a brief bright cutlass arc in front of the hero (cosmetic; reuses the _fx fast-fade pool)
    const f = fwd(yaw), gx = x + f.x * 6, gz = z + f.z * 6, gy = groundYOn(ashoreIsle, gx, gz) + 6;
    const m = new THREE.Mesh(new THREE.RingGeometry(2.4, 4.6, 14, 1, -1.1, 2.2), new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(gx, gy, gz); m.rotation.y = -yaw; m.rotation.x = -0.9;
    scene.add(m); _fx.push({ mesh: m, life: 1, fast: true });
  }
  function heroStrike(f, mult) {   // resolve a CUTLASS hit on a foe (mult>1 = a CHARGED strike hits harder)
    alertFoes(f);              // a struck foe (and its mates) engages immediately
    const res = rollShot(HERO_ATK * (mult || 1), 1, 0.12);   // point-blank -> reliable to-hit
    popRoll(f.x, groundYOn(ashoreIsle, f.x, f.z) + (f.kind === "marauder" ? 15 : 11), f.z, res);
    if (!res.hit) { sfxAt("miss", f.x, f.z, 0.5); return; }
    burst(f.x, groundYOn(ashoreIsle, f.x, f.z) + 3, true, res.crit); sfxAt("hit", f.x, f.z, res.crit ? 0.9 : 0.7);
    if ((f.hp -= res.dmg) <= 0) { f.alive = false; f.deathT = 1.1; if (f.play) f.play("death", { once: true }); sfxAt("sink", f.x, f.z, 0.5);
      if (f.boss) landBossReward(f); else { const g = 5 + f.level * 3; gainXP(4 + f.level * 3); player.gold += g; banner("⚔ Pirate down! +" + g + " gold"); } }
  }
  function heroSlash(dirx, dirz) {   // the CUTLASS swing (guard/cooldown owned by heroAttack): frontal arc, strike the NEAREST foe in reach
    const dd = Math.hypot(dirx, dirz) || 1; dirx /= dd; dirz /= dd;
    hero.yaw = Math.atan2(dirx, dirz); if (hero.play) hero.play("attack", { once: true, timeScale: 1.9 }); hero.animT = 0.8;   // FULL swing, sped up — the 1.53s slash now plays through in ~0.8s instead of being cut off at 1/3
    slashFx(hero.x, hero.z, hero.yaw); playSwing(0.55);                       // a blade WHOOSH, not the cannon boom
    let best = null, bd = MELEE_RANGE * MELEE_RANGE;
    for (const f of footFoes) { if (!f.alive) continue; const fx = f.x - hero.x, fz = f.z - hero.z, d2 = fx * fx + fz * fz; if (d2 > bd) continue; const dm = Math.sqrt(d2) || 1; if ((fx / dm) * dirx + (fz / dm) * dirz < MELEE_ARC) continue; bd = d2; best = f; }   // nearest LIVING foe inside the frontal cone
    if (best) heroStrike(best);
  }
  function heroAttack(dx, dz) {   // route the ashore attack to the ACTIVE weapon: flintlock -> ranged shot; cutlass -> melee swing
    if (mode !== "ashore" || hero.atkT > 0) return;
    if (heroWeapon === "flintlock") { hero.atkT = BOW_CD; fireArrowDir(dx, dz); }   // fireArrowDir = the gun shot (musket ball + muzzle flash + gunshot)
    else { hero.atkT = SLASH_CD; heroSlash(dx, dz); }
  }
  function heroShootForward() { const f = fwd(hero.yaw); heroAttack(f.x, f.z); }                    // SPACE — attack straight ahead
  function heroShootAt(clientX, clientY) {                                                          // LEFT-CLICK — attack toward the cursor
    const gp = groundPointAt(clientX, clientY);
    if (gp && (gp.x !== hero.x || gp.z !== hero.z)) heroAttack(gp.x - hero.x, gp.z - hero.z); else { const f = fwd(hero.yaw); heroAttack(f.x, f.z); }
  }
  // ── QUICK-TAP vs HOLD-TO-CHARGE (owner): a quick LEFT-CLICK = fast strike; HOLD builds a CHARGED attack — a growing WebGL
  // orb + ground ring on the sword hand — and RELEASE unleashes a heavier, WIDER sweep (or a boosted shot) with a shockwave.
  const CHARGE_MIN = 0.2, CHARGE_FULL = 1.0;   // hold < MIN = quick tap; MIN..FULL builds; FULL = max power
  let _charging = false, _chargeT = 0, _chargeOrb = null, _chargeRing = null;
  function startCharge() { if (mode === "ashore" && gameStarted && !shopOpen && !paused) { _charging = true; _chargeT = 0; } }
  function hideChargeFx() { if (_chargeOrb) { _chargeOrb.visible = false; _chargeRing.visible = false; } }
  function updateChargeFx(dt) {   // grow + colour the charge orb (cyan→gold) on the hero's weapon hand while holding
    if (_charging) _chargeT += dt;
    if (!_chargeOrb) {
      _chargeOrb = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      _chargeRing = new THREE.Mesh(new THREE.TorusGeometry(4, 0.35, 8, 30), new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0, depthWrite: false }));
      _chargeRing.rotation.x = -Math.PI / 2; scene.add(_chargeOrb); scene.add(_chargeRing);
    }
    const on = _charging && mode === "ashore" && _chargeT > CHARGE_MIN * 0.55;
    _chargeOrb.visible = on; _chargeRing.visible = on; if (!on) return;
    const c = Math.min(1, _chargeT / CHARGE_FULL);
    let hx = hero.x, hy = (ashoreIsle ? groundYOn(ashoreIsle, hero.x, hero.z) : 0) + 9, hz = hero.z, hand = null;
    if (hero.mesh) { hero.mesh.traverse((n) => { if (!hand && n.isBone && /^RightHand$/i.test(n.name)) hand = n; }); if (hand) { hand.updateWorldMatrix(true, false); const e = hand.matrixWorld.elements; hx = e[12]; hy = e[13]; hz = e[14]; } }
    const col = new THREE.Color().setHSL(0.55 - c * 0.42, 1, 0.6), pulse = c >= 1 ? 1 + Math.sin(_chargeT * 22) * 0.14 : 1;
    _chargeOrb.position.set(hx, hy, hz); _chargeOrb.scale.setScalar((0.5 + c * 1.8) * pulse); _chargeOrb.material.color.copy(col); _chargeOrb.material.opacity = 0.4 + c * 0.55;
    const gy = (ashoreIsle ? groundYOn(ashoreIsle, hero.x, hero.z) : 0) + 0.6;
    _chargeRing.position.set(hero.x, gy, hero.z); _chargeRing.rotation.z = _chargeT * 3.5; _chargeRing.scale.setScalar(0.7 + c * 0.6); _chargeRing.material.color.copy(col); _chargeRing.material.opacity = c * 0.75;
  }
  function chargeShockwave(x, z, charge) {   // release burst: an expanding gold ring + a flash (rides the _fx grow+fade pool)
    const gy = (ashoreIsle ? groundYOn(ashoreIsle, x, z) : 0) + 1.2;
    const m = new THREE.Mesh(new THREE.TorusGeometry(3.5 + charge * 3, 0.6 + charge * 0.5, 8, 34), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.set(x, gy, z); m.rotation.x = -Math.PI / 2; scene.add(m); _fx.push({ mesh: m, life: 1 });
    burst(x, z, true, true);
  }
  function releaseCharge(clientX, clientY) {   // LEFT-CLICK up ashore: quick tap strikes fast; a held press unleashes a CHARGED attack
    if (!_charging) return; const held = _chargeT; _charging = false; hideChargeFx();
    const gp = groundPointAt(clientX, clientY); let dx, dz;
    if (gp && (gp.x !== hero.x || gp.z !== hero.z)) { dx = gp.x - hero.x; dz = gp.z - hero.z; } else { const f = fwd(hero.yaw); dx = f.x; dz = f.z; }
    if (held < CHARGE_MIN) { heroAttack(dx, dz); return; }                     // quick tap -> the normal fast attack
    heroChargedAttack(dx, dz, Math.min(1, (held - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN)));
  }
  function heroChargedAttack(dirx, dirz, charge) {   // heavier WIDE cutlass sweep (hits every foe in a broad cone) or a boosted shot
    if (mode !== "ashore" || hero.atkT > 0) return;
    const dd = Math.hypot(dirx, dirz) || 1; dirx /= dd; dirz /= dd; hero.yaw = Math.atan2(dirx, dirz);
    if (heroWeapon === "flintlock") {
      hero.atkT = BOW_CD * 1.2; fireArrowDir(dirx, dirz, 1 + charge * 1.6); chargeShockwave(hero.x + dirx * 5, hero.z + dirz * 5, charge * 0.6);
    } else {
      hero.atkT = SLASH_CD * 1.4; if (hero.play) hero.play("attack", { once: true, timeScale: 1.25 }); hero.animT = 1.0;   // heavier, fuller swing
      slashFx(hero.x, hero.z, hero.yaw); playSwing(0.85); chargeShockwave(hero.x, hero.z, charge);
      const range = MELEE_RANGE * (1 + charge * 0.8), arc = MELEE_ARC - charge * 0.35;   // charge WIDENS the arc + EXTENDS reach
      for (const f of footFoes) { if (!f.alive) continue; const fx = f.x - hero.x, fz = f.z - hero.z, d2 = fx * fx + fz * fz; if (d2 > range * range) continue; const dm = Math.sqrt(d2) || 1; if ((fx / dm) * dirx + (fz / dm) * dirz < arc) continue; heroStrike(f, 1 + charge * 1.6); }   // SWEEP every foe in the wide cone
    }
  }
  function nearestTarget(x, z) {   // a foe's target: the closest LIVING away-party member (hero or an up crew hand)
    let best = null, bd = 1e9;
    if (hero.hp > 0) { const d = (hero.x - x) * (hero.x - x) + (hero.z - z) * (hero.z - z); bd = d; best = { x: hero.x, z: hero.z, isHero: true }; }
    for (const c of crewParty) { if (c.down) continue; const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z); if (d < bd) { bd = d; best = { x: c.x, z: c.z, crew: c }; } }
    return best;
  }
  function foeHit(tgt, res, is) {   // land a foe's hit on whichever party member it aimed at; return true if the WHOLE party wiped
    if (tgt.isHero) {
      hero.hp -= res.dmg; burst(hero.x, groundYOn(is, hero.x, hero.z) + 3, true, res.crit); sfxAt("hit", hero.x, hero.z, res.crit ? 0.9 : 0.7);
      if (hero.play) { hero.play("hit", { once: true }); hero.animT = 0.45; }
      if (hero.hp <= 0) { banner("💀 Away party overwhelmed — back to the ship!"); leaveIsland(); return true; }
    } else if (tgt.crew) {
      const c = tgt.crew; c.hp -= res.dmg; burst(c.x, groundYOn(is, c.x, c.z) + 3, true, res.crit); sfxAt("hit", c.x, c.z, 0.6);
      if (c.hp <= 0) { c.down = true; c.mesh.visible = false; sfxAt("sink", c.x, c.z, 0.6); banner("🩸 " + c.name + " is down — revives back aboard"); }
    }
    return false;
  }
  function stepFoot(dt) {
    const is = ashoreIsle; if (!is) return;
    hero.atkT -= dt;
    for (const f of footFoes) {
      if (!f.alive) {                                   // play out the death animation, then hide
        if (f.deathT > 0) { f.deathT -= dt; if (f.mixer) f.mixer.update(dt); if (f.deathT <= 0 && f.mesh) f.mesh.visible = false; }
        continue;
      }
      const tgt = nearestTarget(f.x, f.z); if (!tgt) continue;
      const dx = tgt.x - f.x, dz = tgt.z - f.z, d = Math.hypot(dx, dz);
      if (!f.aggro && d < FOE_AGGRO && losTerrain(is, f.x, f.z, tgt.x, tgt.z)) f.aggro = true;   // wakes only when it can SEE you; then it stays engaged
      let moving = false;
      if (f.aggro) {
        f.yaw = Math.atan2(dx, dz);
        if (d > FOE_ATK_RANGE) { const spd = 14 * dt, nx = f.x + Math.sin(f.yaw) * spd, nz = f.z + Math.cos(f.yaw) * spd; if (_isleH(nx - is.x, nz - is.z, is.r, is.ox, is.oz, is.sh) > 0.6) { f.x = nx; f.z = nz; moving = true; } }
        else { f.atkT -= dt; if (f.atkT <= 0) { f.atkT = 1.9 + rng() * 1.0; f.animT = 0.7; if (f.play) f.play("attack", { once: true }); const res = rollShot(f.dmg, tgt.isHero ? hero.ev : 1, 0.2); popRoll(tgt.x, groundYOn(is, tgt.x, tgt.z) + (tgt.isHero ? 13 : 11), tgt.z, res); if (res.hit && foeHit(tgt, res, is)) return; } }
      }
      f.mesh.position.set(f.x, groundYOn(is, f.x, f.z), f.z); f.mesh.rotation.y = f.yaw + HERO_OFF;
      f.animT = (f.animT || 0) - dt; if (f.play && f.animT <= 0) f.play(moving ? "run" : "idle");   // run when chasing, idle otherwise (attack holds via animT)
      if (f.mixer) f.mixer.update(dt);
    }
    if (activeQuest && activeQuest.mesh && ashoreIsle === activeQuest.isle) { activeQuest.mesh.rotation.y += dt * 0.7; activeQuest.mesh.scale.setScalar(1 + Math.sin(kernel.clock.elapsedTime * 3) * 0.09); }   // pulse + spin the X so it draws the eye
    for (const c of footChests) { if (!c.taken && Math.hypot(c.x - hero.x, c.z - hero.z) < 14) { c.taken = true; c.mesh.visible = false; player.gold += c.gold; gainXP(3); banner("💰 Treasure! +" + c.gold + " gold"); } }
    if (selectedFoe && (!selectedFoe.alive || footFoes.indexOf(selectedFoe) < 0)) deselectFoe();   // drop the lock if the foe died/left
    if (selectedFoe) { foeRing.position.set(selectedFoe.x, groundYOn(is, selectedFoe.x, selectedFoe.z) + 0.6, selectedFoe.z); foeRing.visible = true; }
    updateChargeFx(dt);                                             // grow the hold-to-charge orb + ring on the sword hand
  }

  // ── AWAY-TEAM CREW: the crew you HIRE at the Tortuga shop are WIZARDS — they DROP ASHORE with the hero and
  // fight beside you at RANGE, keeping their distance from foes and lobbing glowing spell orbs (same d20 dice).
  // They take damage, can be knocked DOWN for the landing (they revive back aboard), and earn XP + you gold on kills.
  const ALLY_TINT = 0x3a86ff;   // bright friendly blue — reads instantly as ally vs the grass AND vs enemy red
  const CREW_CAST_RANGE = 112, CREW_CAST_CD = 1.5, CREW_ENGAGE = 150, CREW_FOLLOW = 17, CREW_SPD = 15;   // wizard crew engage + cast at range
  let crewParty = [];
  function crewStats(cm) { return { hpMax: 45 + (cm.level || 1) * 10, dmg: 10 + (cm.level || 1) * 3 }; }
  function crewNeed(cm) { return 18 + (cm.level || 1) * 12; }
  function crewGainXP(cm, n) { cm.xp = (cm.xp || 0) + n; while (cm.xp >= crewNeed(cm)) { cm.xp -= crewNeed(cm); cm.level = (cm.level || 1) + 1; banner("⭐ " + cm.name + " is now Lv " + cm.level + "!"); } }
  function spawnCrewParty(is) {
    clearCrewParty();
    const f = fwd(hero.yaw);
    player.crew.forEach((cm, i) => {
      // Fan out INLAND + beside the hero — the hero lands facing inland, so forward is the dry side
      // (spawning behind would drop them in the surf and stack them all on the hero's tile).
      const st = crewStats(cm), lane = (i % 2 ? 1 : -1) * (8 + Math.floor(i / 2) * 6), ahead = 7 + Math.floor(i / 2) * 6;
      let x = hero.x + f.x * ahead + Math.cos(hero.yaw) * lane, z = hero.z + f.z * ahead - Math.sin(hero.yaw) * lane;
      if (_isleH(x - is.x, z - is.z, is.r, is.ox, is.oz, is.sh) < 0.6) { x = hero.x + f.x * 4; z = hero.z + f.z * 4; }   // that spot is water -> just inland of the hero
      const role = _charGltf.gunner ? MESHY_CREW[i % MESHY_CREW.length] : "wizard";   // hired help = rotating Meshy PIRATE crew (Gunner/Swashbuckler/Bosun); Wizard only as a load fallback
      const cc = makeCharacterRole(role, 9.5, _charGltf.gunner ? null : ALLY_TINT); if (!cc) return;   // pirate crew keep their real colours — the blue crew HP-bar marks them ally
      cc.pivot.position.set(x, groundYOn(is, x, z), z); scene.add(cc.pivot);
      crewParty.push({ ref: cm, name: cm.name, x, z, yaw: hero.yaw, hp: st.hpMax, hpMax: st.hpMax, dmg: st.dmg, mesh: cc.pivot, mixer: cc.mixer, play: cc.play, atkT: rng() * CREW_CAST_CD, down: false });
    });
  }
  function clearCrewParty() { for (const c of crewParty) scene.remove(c.mesh); crewParty = []; }
  function stepCrew(dt) {
    const is = ashoreIsle; if (!is) return;
    for (const c of crewParty) {
      if (c.down) continue;
      c.atkT -= dt;
      let foe = null, bd = CREW_ENGAGE * CREW_ENGAGE;
      for (const ff of footFoes) { if (!ff.alive) continue; const dx = ff.x - c.x, dz = ff.z - c.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; foe = ff; } }
      let tx, tz, moving = false;
      if (foe) {
        // WIZARD ally: keep the cast distance — close in if too far, back off if a foe gets near, hold in the band.
        const fd = Math.sqrt(bd); c.yaw = Math.atan2(foe.x - c.x, foe.z - c.z);
        if (fd > CREW_CAST_RANGE) { tx = foe.x; tz = foe.z; }
        else if (fd < CREW_CAST_RANGE * 0.5) { tx = c.x - (foe.x - c.x); tz = c.z - (foe.z - c.z); }   // kite away
        else { tx = c.x; tz = c.z; }
        if (fd <= CREW_CAST_RANGE && c.atkT <= 0 && losTerrain(is, c.x, c.z, foe.x, foe.z)) { c.atkT = CREW_CAST_CD + rng() * 0.5; c.animT = 0.7; crewCastSpell(c, foe); }
      } else { const f = fwd(hero.yaw); tx = hero.x - f.x * CREW_FOLLOW; tz = hero.z - f.z * CREW_FOLLOW; }   // no foe -> trail the hero
      const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
      if (!foe) c.yaw = Math.atan2(dx, dz);
      if (dist > 3) { const yaw = Math.atan2(dx, dz), spd = CREW_SPD * dt, nx = c.x + Math.sin(yaw) * spd, nz = c.z + Math.cos(yaw) * spd; if (_isleH(nx - is.x, nz - is.z, is.r, is.ox, is.oz, is.sh) > 0.6) { c.x = nx; c.z = nz; moving = true; } }
      c.mesh.position.set(c.x, groundYOn(is, c.x, c.z), c.z); c.mesh.rotation.y = c.yaw + HERO_OFF;
      c.animT = (c.animT || 0) - dt; if (c.play && c.animT <= 0) c.play(moving ? "run" : "idle");
      if (c.mixer) c.mixer.update(dt);                  // animate the wizard crew-mate
    }
  }

  // ── TORTUGA SHOP: dock the home port to REPAIR, UPGRADE the ship, and HIRE CREW (spend gold). ──
  let shopOpen = false, _shopEl = null;
  const upg = { hull: 0, cannon: 0, rigging: 0 };
  const CREW_NAMES = ["Bess", "One-Eye Jack", "Salt Meg", "Cutlass Sam", "Old Finn", "Red Nell", "Barnaby", "Squint", "Mad Dog", "Pegleg Pru", "Gunner Cole", "Sly Ravi"];
  function shopCost(kind) {
    if (kind === "repair") return Math.max(0, Math.ceil((player.hpMax - player.hp) * 0.6));
    if (kind === "hull") return 40 + upg.hull * 35;
    if (kind === "cannon") return 55 + upg.cannon * 40;
    if (kind === "rigging") return 40 + upg.rigging * 30;
    if (kind === "crew") return 60 + player.crew.length * 45;
    if (kind === "map") return MAP_COST;
    return 9999;
  }
  function buy(kind) {
    const c = shopCost(kind); if (player.gold < c) return;
    if (kind === "repair" && player.hp >= player.hpMax) return;
    if (kind === "map" && activeQuest) return;                        // one treasure map at a time
    player.gold -= c;
    if (kind === "repair") player.hp = player.hpMax;
    else if (kind === "hull") { upg.hull++; player.hpMax += 25; player.hp = player.hpMax; }
    else if (kind === "cannon") { upg.cannon++; player.gunDmg += 4; }
    else if (kind === "rigging") { upg.rigging++; player.maxSpeed += 3; }
    else if (kind === "crew") { player.crew.push({ name: CREW_NAMES[player.crew.length % CREW_NAMES.length], level: 1, xp: 0 }); player.hpMax += 8; player.hp += 8; }
    else if (kind === "map") startQuest();                           // buy a treasure map -> marks a random isle to dig
    if (kind !== "repair" && kind !== "map") applyShipVisuals();      // repaint the ship so a SHIP upgrade is VISIBLE, not just numeric
    renderShop();
  }
  function openShop() { shopOpen = true; player.speed = 0; renderShop(); }
  function closeShop() { shopOpen = false; if (_shopEl) _shopEl.style.display = "none"; }
  function renderShop() {
    if (!_shopEl) {
      _shopEl = document.createElement("div");
      _shopEl.style.cssText = "position:absolute;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(6,14,26,.4),rgba(5,11,20,.82));font-family:'Segoe UI',system-ui,monospace;color:#eaf3ff";
      (kernel.parent || document.body).appendChild(_shopEl);
      _shopEl.addEventListener("click", (e) => { const b = e.target.closest("[data-buy]"); if (b) buy(b.getAttribute("data-buy")); if (e.target.closest("[data-close]")) closeShop(); });
    }
    _shopEl.style.display = "flex";
    const row = (kind, icon, name, desc) => { const c = shopCost(kind), can = player.gold >= c && !(kind === "repair" && player.hp >= player.hpMax);
      return `<div style="display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:9px;background:rgba(10,22,34,.7);margin:6px 0"><div style="font-size:22px">${icon}</div><div style="flex:1"><div style="font-weight:800">${name}</div><div style="font-size:12px;opacity:.7">${desc}</div></div><button data-buy="${kind}" ${can ? "" : "disabled"} style="font:700 13px monospace;padding:8px 14px;border-radius:7px;cursor:${can ? "pointer" : "not-allowed"};border:1px solid ${can ? "#7CFC9A" : "#456"};background:${can ? "linear-gradient(#9dffb6,#4fe084)" : "rgba(40,49,62,.6)"};color:${can ? "#062018" : "#8aa"}">💰 ${c}</button></div>`; };
    _shopEl.innerHTML = `<div style="width:min(450px,92%);background:rgba(8,18,30,.95);border:1px solid #caa24d;border-radius:14px;padding:18px 20px;box-shadow:0 10px 44px rgba(0,0,0,.6)">
      <div style="font:900 22px Georgia,serif;background:linear-gradient(#fff0c8,#f0c065,#c98a32);-webkit-background-clip:text;background-clip:text;color:transparent">Tortuga — Harbour Master</div>
      <div style="margin:4px 0 10px;opacity:.9">Purse: <b style="color:#ffd36a">💰 ${player.gold} gold</b> &nbsp;·&nbsp; Ship Lv ${player.level} &nbsp;·&nbsp; Crew ${player.crew.length}</div>
      ${row("repair", "🛠️", "Repair Hull", `Restore hull to full (now ${Math.max(0, Math.round(player.hp))}/${player.hpMax})`)}
      ${row("hull", "🛡️", "Reinforce Hull", `+25 max hull → ${player.hpMax + 25}`)}
      ${row("cannon", "💥", "Bigger Cannons", `${upg.cannon < 2 ? "+1 broadside gun & " : ""}+4 damage → ${player.gunDmg + 4}`)}
      ${row("rigging", "⛵", "Better Rigging", `+3 top speed → ${player.maxSpeed + 3}`)}
      ${row("crew", "🧑‍✈️", "Hire Crew", `Recruit a hand (+8 hull; joins your away party)`)}
      ${player.crew.length ? `<div style="margin-top:8px;font-size:12px;opacity:.8">🧑‍✈️ Crew: ${player.crew.map((c) => c.name).join(", ")}</div>` : ""}
      ${activeQuest && !activeQuest.dug
        ? `<div style="display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:9px;background:rgba(42,33,10,.6);margin:6px 0;border:1px solid #caa24d66"><div style="font-size:22px">🗺</div><div style="flex:1"><div style="font-weight:800;color:#ffd36a">Treasure Map — active</div><div style="font-size:12px;opacity:.8">Sail to <b style="color:#ffe8b0">${activeQuest.isle.name}</b> and dig the X ashore (press F)</div></div></div>`
        : row("map", "🗺", "Treasure Map", "Buy a chart to a buried hoard on a distant isle")}
      <div style="text-align:center;margin-top:14px"><button data-close="1" style="font:800 14px monospace;padding:10px 26px;border-radius:8px;cursor:pointer;border:1px solid #3a6c8c;background:rgba(28,49,72,.9);color:#dfeaff">⚓ Set Sail</button></div>
    </div>`;
  }

  // ── TREASURE-MAP QUEST — buy a map at Tortuga, follow the GOLD marker to a distant isle, dig the X ashore
  // for a big hoard. ONE quest at a time; persists across landings until dug; the X mesh is rebuilt each landing. ──
  const MAP_COST = 120;
  let activeQuest = null;   // { isle, dug, spot:{x,z}, mesh }
  function startQuest() {
    if (activeQuest) return;
    const cands = islands.filter((is) => !is.isTown && is !== ashoreIsle && (Math.hypot(is.x, is.z) - is.r) <= SEA - 40);   // only REACHABLE isles (near edge inside the sail box) — never soft-lock the quest on an isle the ship can't reach
    if (!cands.length) return;
    const isle = cands[Math.floor(Math.random() * cands.length)];     // cosmetic-ish (which isle) -> Math.random, like the boss/weather rolls
    activeQuest = { isle, dug: false, spot: null, mesh: null };
    banner(`🗺 A treasure map! The X is on ${isle.name} — sail there and dig ashore (F).`);
  }
  function disposeQuestMesh(g) { g.traverse((n) => { if (n.isMesh) { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); } }); }
  function spawnQuestX(is) {                                          // build the X-marks-the-spot on the quest island (once per landing)
    if (!activeQuest || activeQuest.dug || activeQuest.isle !== is || activeQuest.mesh) return;
    if (!activeQuest.spot) activeQuest.spot = _spotNear(is, is.x, is.z, is.r * 0.22, is.r * 0.72);
    const sp = activeQuest.spot, g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.55, 8, 26), new THREE.MeshStandardMaterial({ color: 0xffcf4a, emissive: 0x5a3d00, metalness: 0.45, roughness: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; g.add(ring);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x5c3218, roughness: 0.8 });
    for (const ry of [Math.PI / 4, -Math.PI / 4]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 0.9), barMat); bar.rotation.y = ry; bar.position.y = 0.55; g.add(bar); }   // two crossed stakes = X
    g.traverse((n) => { if (n.isMesh) n.castShadow = false; });
    g.position.set(sp.x, groundYOn(is, sp.x, sp.z), sp.z);
    scene.add(g); activeQuest.mesh = g;
  }
  function stripQuestMesh() { if (activeQuest && activeQuest.mesh) { scene.remove(activeQuest.mesh); disposeQuestMesh(activeQuest.mesh); activeQuest.mesh = null; } }   // remove the marker on leave; the QUEST stays active until dug
  function tryDig() {
    if (paused || shopOpen || mode !== "ashore" || !activeQuest || activeQuest.dug || ashoreIsle !== activeQuest.isle || !activeQuest.spot) return false;   // no digging while the sim is frozen (pause/shop)
    if (Math.hypot(hero.x - activeQuest.spot.x, hero.z - activeQuest.spot.z) > 15) return false;   // must be standing on the X
    activeQuest.dug = true;
    const lvl = ashoreIsle.level || 1, reward = 250 + Math.floor(Math.random() * 220) + lvl * 45;
    player.gold += reward; gainXP(60 + lvl * 7); addShake(0.8);
    const sy = groundYOn(ashoreIsle, activeQuest.spot.x, activeQuest.spot.z);
    burst(activeQuest.spot.x, sy + 4, true, true); sfxAt("sink", activeQuest.spot.x, activeQuest.spot.z, 0.7);
    banner(`💰 Buried hoard! +${reward} gold`);
    if (activeQuest.mesh) { scene.remove(activeQuest.mesh); disposeQuestMesh(activeQuest.mesh); }
    activeQuest = null;
    return true;
  }

  // ── PAUSE / SETTINGS overlay (Esc). ONE persistent pointer-events:auto element (like _shopEl), NOT in kernel.hud().
  // Three swappable views (menu / settings / controls / confirm-title). Freezes the whole sim via `paused` (see onUpdate). ──
  let paused = false, _pauseEl = null, _pauseView = "menu";
  const _GOLD_HEAD = "font:900 30px Georgia,serif;letter-spacing:1px;background:linear-gradient(#fff2cf,#f1c368,#b9822c);-webkit-background-clip:text;background-clip:text;color:transparent";
  const _SHEET = "background:linear-gradient(180deg,rgba(14,30,46,.97),rgba(9,20,32,.97));border:1px solid rgba(255,224,138,.35);border-radius:16px;box-shadow:0 12px 44px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,246,216,.15);padding:24px 22px";
  const _MENU_BTN = "display:block;width:100%;text-align:left;padding:12px 16px;border-radius:10px;background:rgba(28,49,72,.9);border:1px solid #3a6c8c;color:#ffe8b0;font:800 15px 'Segoe UI';cursor:pointer;margin-top:12px";
  function togglePause() { if (paused) closePause(); else openPause(); }
  function openPause() { paused = true; player.speed = 0; _charging = false; hideChargeFx(); _pauseView = "menu"; renderPause(); }   // cancel any in-progress charge so its orb doesn't freeze visible behind the pause menu (updateChargeFx is gated on !paused)
  function closePause() { paused = false; if (_pauseEl) _pauseEl.style.display = "none"; }
  function _kbd(k) { return `<kbd style="background:#1c3148;border:1px solid #3a6c8c;border-radius:5px;padding:1px 6px;font:700 11px monospace;color:#ffe8b0">${k}</kbd>`; }
  function _slider(id, icon, name, val) { const pct = Math.round(val * 100);
    return `<div style="display:flex;align-items:center;gap:10px;margin:12px 0;${audio.muted ? "opacity:.4" : ""}"><div style="width:92px;font:700 13px 'Segoe UI';color:#dff1ff">${icon} ${name}</div><input class="pc-range" data-vol="${id}" type="range" min="0" max="100" value="${pct}" ${audio.muted ? "disabled" : ""} style="flex:1;--pct:${pct}%"><div style="width:38px;text-align:right;font:700 12px 'Segoe UI';color:#ffe8b0">${pct}%</div></div>`;
  }
  function renderPause() {
    if (!_pauseEl) {
      _pauseEl = document.createElement("div");
      _pauseEl.style.cssText = "position:absolute;inset:0;z-index:130;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 34%,rgba(10,28,44,.55),rgba(4,10,18,.9));backdrop-filter:blur(3px);font-family:'Segoe UI',system-ui,sans-serif";
      const st = document.createElement("style"); st.textContent = ".pc-range{appearance:none;-webkit-appearance:none;height:6px;border-radius:3px;background:linear-gradient(90deg,#f0c065 var(--pct),#22323c var(--pct));outline:none;cursor:pointer}.pc-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#f0c065;box-shadow:0 0 4px rgba(0,0,0,.5);cursor:pointer}.pc-range::-moz-range-thumb{width:16px;height:16px;border:none;border-radius:50%;background:#f0c065;box-shadow:0 0 4px rgba(0,0,0,.5);cursor:pointer}#pc-pause-btns button:hover{border-color:#ffe08a !important;background:linear-gradient(#ffe9a8,#f0b64e) !important;color:#3a2408 !important}"; document.head.appendChild(st);
      (kernel.parent || document.body).appendChild(_pauseEl);
      _pauseEl.addEventListener("click", (e) => {
        if (e.target === _pauseEl) { closePause(); return; }             // click the dimmed backdrop = resume
        const a = e.target.closest("[data-act]"); if (!a) return;
        const act = a.getAttribute("data-act");
        if (act === "resume") closePause();
        else if (act === "settings" || act === "controls" || act === "confirm" || act === "menu") { _pauseView = act === "confirm" ? "confirm" : act === "menu" ? "menu" : act; renderPause(); }
        else if (act === "back") { _pauseView = "menu"; renderPause(); }
        else if (act === "mute") toggleMute();
        else if (act === "title") { gameStarted = false; if (_titleEl) _titleEl.style.display = ""; closePause(); deselect(); if (shopOpen) closeShop(); if (rosterOpen) toggleRoster(); resetLook(); }
      });
      _pauseEl.addEventListener("input", (e) => { const r = e.target.closest(".pc-range"); if (!r) return; const v = (+r.value) / 100, id = r.getAttribute("data-vol");
        if (id === "master") masterVol = v; else if (id === "music") musicVol = v; else if (id === "sfx") sfxVol = v;
        r.style.setProperty("--pct", r.value + "%"); if (r.nextElementSibling) r.nextElementSibling.textContent = r.value + "%"; applyAudio(); saveAudio();
      });
      _pauseEl.addEventListener("change", (e) => { const r = e.target.closest(".pc-range"); if (!r) return; resumeAudio(); playSfx(r.getAttribute("data-vol") === "music" ? "move" : "hit", 0.85); });
    }
    _pauseEl.style.display = "flex";
    const backLink = `<span data-act="back" style="cursor:pointer;color:#ffd36a;font:700 14px 'Segoe UI'">‹ Back</span>`;
    let body;
    if (_pauseView === "settings") {
      body = `<div style="width:min(380px,92vw);${_SHEET}">
          <div style="display:flex;align-items:center;gap:12px">${backLink}<div style="${_GOLD_HEAD};font-size:24px">SETTINGS</div></div>
          <div style="margin-top:14px">${_slider("master", "🔊", "Master", masterVol)}${_slider("music", "🎵", "Music", musicVol)}${_slider("sfx", "💥", "SFX", sfxVol)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;padding-top:12px;border-top:1px solid #ffffff14"><div style="font:700 13px 'Segoe UI';color:#dff1ff">🔇 Mute all</div>
            <button data-act="mute" style="cursor:pointer;border:none;border-radius:999px;padding:5px 18px;font:800 13px 'Segoe UI';${audio.muted ? "background:linear-gradient(#ffe9a8,#f0b64e);color:#3a2408" : "background:rgba(40,49,62,.8);color:#9fbdcf"}">${audio.muted ? "ON" : "OFF"}</button></div></div>`;
    } else if (_pauseView === "controls") {
      const rows = [["W / S", "Sail (throttle)"], ["A / D", "Steer (rudder)"], ["LEFT-CLICK", "Target a ship — click it to select (sea) · attack toward cursor (ashore)"], ["TAB", "Lock / cycle nearby enemies (on foot)"], ["SPACE", "Broadside your SELECTED ship (sea) · attack your LOCKED foe / ahead (on foot)"], ["Q", "Swap weapon ashore: ⚔ Cutlass (swing) ↔ 🔫 Flintlock (shoot)"], ["MOUSE-WHEEL", "Zoom the camera"], ["E", "Dock island · Tortuga shop · return to ship"], ["F", "Dig the treasure X (on a map isle)"], ["right-drag", "Look around"], ["R", "Reset view"], ["C", "Crew roster"], ["M", "Mute"], ["Esc", "Pause"]];
      body = `<div style="width:min(440px,92vw);${_SHEET}">
          <div style="display:flex;align-items:center;gap:12px">${backLink}<div style="${_GOLD_HEAD};font-size:24px">CONTROLS</div></div>
          <div style="margin-top:16px;display:grid;grid-template-columns:auto 1fr;gap:9px 14px;align-items:center;font:600 13px 'Segoe UI';color:#dff1ff">${rows.map((r) => `<div style="text-align:right">${_kbd(r[0])}</div><div style="opacity:.85">${r[1]}</div>`).join("")}</div></div>`;
    } else if (_pauseView === "confirm") {
      body = `<div style="width:min(340px,92vw);${_SHEET};text-align:center">
          <div style="font:800 17px 'Segoe UI';color:#ffe8b0">Abandon voyage?</div><div style="margin-top:6px;font:600 13px 'Segoe UI';color:#9fbdcf">Return to the title screen.</div>
          <div style="display:flex;gap:10px;margin-top:18px"><button data-act="title" style="flex:1;padding:11px;border-radius:9px;border:1px solid #ff8a6a;background:rgba(60,26,22,.8);color:#ffbfae;font:800 14px 'Segoe UI';cursor:pointer">Yes, return</button><button data-act="menu" style="flex:1;padding:11px;border-radius:9px;border:1px solid #3a6c8c;background:rgba(28,49,72,.9);color:#ffe8b0;font:800 14px 'Segoe UI';cursor:pointer">Cancel</button></div></div>`;
    } else {
      body = `<div id="pc-pause-btns" style="width:min(340px,92vw);text-align:center">
          <div style="${_GOLD_HEAD}">⚓ PAUSED</div>
          <div style="margin-top:20px"><button data-act="resume" style="${_MENU_BTN}">▶ Resume</button><button data-act="settings" style="${_MENU_BTN}">⚙ Settings</button><button data-act="controls" style="${_MENU_BTN}">⌨ Controls</button><button data-act="confirm" style="${_MENU_BTN}">⚓ Return to Title</button></div></div>`;
    }
    _pauseEl.innerHTML = body;
  }

  // ── HUD — "Charted Ledger + Bearing Ribbon" (design-panel synth). A clean, constant-height status card of
  // iconized PIPS (top-left); the live aim as a top-center BEARING RIBBON; waters as a caption over the minimap;
  // scout/dock as transient bottom-center pills. All emitted through the ONE kernel.hud(html) string. ─────────
  function _pnl(op) { return `background:rgba(8,18,28,${op});border:1px solid rgba(130,185,215,.24);border-radius:12px;backdrop-filter:blur(3px);box-shadow:0 4px 16px rgba(0,0,0,.4)`; }
  function _hpTint(r) { return r > 0.5 ? "#46e07a" : r > 0.25 ? "#f0c065" : "#ff6a6a"; }
  function _microbar(pct, col, w) { return `<div style="height:3px;width:${w || 34}px;border-radius:2px;background:#22323c;margin-top:2px;overflow:hidden"><div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${col}"></div></div>`; }
  function _pip(icon, val, col, sub) { return `<div style="display:flex;flex-direction:column;align-items:flex-start"><div style="font:800 16px 'Segoe UI';color:${col || "#ffe8b0"};white-space:nowrap;text-shadow:0 1px 3px #000"><span style="font-size:14px">${icon}</span> ${val}</div>${sub || ""}</div>`; }
  function drawHUD() {
    const ashore = mode === "ashore" && ashoreIsle;
    // ── STATUS CARD (top-left) ──
    let caption = "", pips = [];
    if (ashore) {
      const r = hero.hp / hero.hpMax, hc = _hpTint(r);
      const foesLeft = footFoes.filter((f) => f.alive).length, chestsLeft = footChests.filter((c) => !c.taken).length, crewUp = crewParty.filter((c) => !c.down).length;
      caption = `<div style="margin-top:2px;font:600 11px 'Segoe UI';opacity:.72;color:#dff1ff">🏝 ${ashoreIsle.name} &nbsp;·&nbsp; <span style="color:#ffe8b0">${heroWeapon === "cutlass" ? "⚔ Cutlass" : "🔫 Flintlock"}</span> <span style="opacity:.6">(Q swap)</span></div>`;
      pips = [_pip("❤", Math.max(0, Math.round(hero.hp)), hc, _microbar(100 * r, hc)), _pip("💰", player.gold, "#f0c065"),
        _pip("⚔", foesLeft || "✔", foesLeft ? "#ff8a6a" : "#7fffd4"), _pip("🎁", chestsLeft, "#ffe8b0")];
      if (crewParty.length) pips.push(_pip("🧑‍✈️", crewUp + "/" + crewParty.length, crewUp ? "#8effb0" : "#ff8a6a"));
    } else {
      const r = player.hp / player.hpMax, hc = _hpTint(r);
      pips = [_pip("❤", Math.max(0, Math.round(player.hp)), hc, _microbar(100 * r, hc)), _pip("💰", player.gold, "#f0c065"),
        _pip("⭐", player.level, "#ffe8b0", _microbar(100 * player.xp / xpForLevel(player.level), "#f0c065", 30)),
        _pip("⛵", Math.round(player.speed) + `<span style="font-size:10px;opacity:.55;margin-left:1px">kn</span>`, "#ffe8b0")];
      if (player.crew.length) pips.push(_pip("🧑‍✈️", player.crew.length, "#ffe8b0"));
    }
    const statusCard = `<div style="position:absolute;left:14px;top:12px;${_pnl(".62")};padding:9px 12px;font-family:'Segoe UI'">
        <div style="font:800 13px 'Segoe UI';letter-spacing:1px;color:#ffe8b0;text-shadow:0 1px 3px #000">PIRATE'S COVE <span style="opacity:.45;font-weight:600;font-size:11px">${ashore ? "· ashore" : "· open seas"}</span></div>
        ${caption}<div style="display:flex;align-items:flex-end;gap:14px;margin-top:7px">${pips.join("")}</div></div>`;

    // ── WATERS CAPTION (bottom-right, over the minimap) — sea only ──
    let waters = "";
    if (!ashore) {
      const pd = Math.hypot(player.x - townPos.x, player.z - townPos.z), lvl = levelForDist(pd), df = diffOf(lvl);
      waters = `<div style="position:absolute;right:14px;bottom:152px;${_pnl(".55")};padding:3px 9px;font:600 11px 'Segoe UI';color:#dff1ff;opacity:.92;white-space:nowrap">
          <span style="width:9px;height:9px;border-radius:50%;background:${df.hex};box-shadow:0 0 8px ${df.hex};display:inline-block;vertical-align:middle"></span>
          <span style="color:${df.hex};font-weight:800">${df.tier}</span> <span style="opacity:.6">${lvl <= 0 ? "Safe Harbor" : "Lv " + lvl}</span> · 🏴 ${npcs.filter((n) => n.alive).length}</div>`;
    }

    // ── BEARING RIBBON (top-center) — sea only. Keys off your SELECTED target (SPACE fires at it), or prompts you to pick one. ──
    let ribbon = "";
    if (!ashore) {
      const tgt = (selected && selected.hp > 0 && npcs.indexOf(selected) >= 0) ? selected : null;
      let txt = "", col = "";
      if (tgt) {
        const dx = tgt.x - player.x, dz = tgt.z - player.z, inRange = (dx * dx + dz * dz) < FIRE_RANGE * FIRE_RANGE;
        const b = relBearing(player.x, player.z, player.yaw, tgt.x, tgt.z), ab = Math.abs(b), bears = ab >= ARC_MIN_R && ab <= ARC_MAX_R;
        const side = b < 0 ? "PORT" : "STBD", cold = (b < 0 ? player.reloadTP : player.reloadTS) > 0, arrow = b < 0 ? "◀" : "▶";
        if (!inRange) { txt = `🎯 ${tgt.type} — close the distance`; col = "#ff9a5a"; }
        else if (bears && !cold) { txt = `🎯 ${arrow} ${side} — SPACE to FIRE`; col = "#8effb0"; }
        else if (bears && cold) { txt = `🎯 ${side} ⟳ reloading`; col = "#ffcf6a"; }
        else { txt = "↩ turn to bring guns to bear"; col = "#ff9a5a"; }
      } else {                                                          // no target picked — nudge the player to select one if a ship is near
        let near = false; for (const n of npcs) { if (!n.alive) continue; const dx = n.x - player.x, dz = n.z - player.z; if (dx * dx + dz * dz < FIRE_RANGE * FIRE_RANGE) { near = true; break; } }
        if (near) { txt = "🎯 Click a ship to target it"; col = "#bfe0ef"; }
      }
      if (txt) ribbon = `<div style="position:absolute;left:50%;top:11%;transform:translateX(-50%);${_pnl(".6")};border-color:${col};padding:5px 15px;border-radius:999px;font:800 13px 'Segoe UI';color:${col};white-space:nowrap">${txt}</div>`;
    }

    // ── SCOUT + DOCK pills (bottom-center) — sea only ──
    let stack = "";
    if (!ashore && scoutTarget) { const sf = scoutTarget.foes.filter((f) => f.alive).length, sc = scoutTarget.chests.filter((c) => !c.taken).length, cleared = sf === 0 && sc === 0;
      stack += `<div style="${_pnl(".6")};border-color:${scoutTarget.tier.hex};padding:4px 12px;border-radius:10px;font:700 12px 'Segoe UI';color:#dff1ff;white-space:nowrap">🔭 ${scoutTarget.name} ${cleared ? "— Plundered" : `&nbsp; ⚔${sf} · 🎁${sc} &nbsp;<span style="color:${scoutTarget.tier.hex};font-weight:800">${scoutTarget.tier.tier}</span>`}</div>`; }
    if (!ashore && dockTarget) stack += `<div style="${_pnl(".6")};border-color:#caa24d;padding:4px 12px;border-radius:10px;font:700 12px 'Segoe UI';color:#7fffd4;white-space:nowrap">⚓ Near ${dockTarget.name} — press E to ${dockTarget.isTown ? "visit port" : "dock"}</div>`;
    if (stack) stack = `<div style="position:absolute;left:50%;bottom:13%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px">${stack}</div>`;

    // ── COMPASS CHEVRON (top-center-top) — points toward the nearest UNPLUNDERED island so the big map is navigable. Sea only. ──
    let compass = "";
    if (!ashore) {
      let best = null, bd = 1e18;
      for (const is of islands) { if (is.isTown) continue; const unplundered = is.foes.some((f) => f.alive) || is.chests.some((c) => !c.taken); if (!unplundered) continue; const dx = is.x - player.x, dz = is.z - player.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = is; } }
      if (best) { const dx = best.x - player.x, dz = best.z - player.z, dist = Math.round(Math.sqrt(bd)), deg = (Math.atan2(dx, dz) - player.yaw) * 180 / Math.PI;
        compass = `<div style="position:absolute;left:50%;top:3.4%;transform:translateX(-50%);${_pnl(".5")};padding:3px 11px;font:700 11px 'Segoe UI';color:#dff1ff;white-space:nowrap">🧭 <span style="display:inline-block;transform:rotate(${deg.toFixed(0)}deg);color:#ffd36a;font-size:13px;vertical-align:middle">↑</span> <span style="color:#ffe8b0">${best.name}</span> <span style="opacity:.6">${dist}m</span></div>`;
      }
    }
    // ── TREASURE-MAP quest chevron (GOLD) — replaces the nav compass while a map is active; sea only ──
    if (!ashore && activeQuest && !activeQuest.dug) {
      const qis = activeQuest.isle, dx = qis.x - player.x, dz = qis.z - player.z, dist = Math.round(Math.hypot(dx, dz)), deg = (Math.atan2(dx, dz) - player.yaw) * 180 / Math.PI;
      compass = `<div style="position:absolute;left:50%;top:3.4%;transform:translateX(-50%);${_pnl(".5")};border-color:#ffcf4a;padding:3px 11px;font:700 11px 'Segoe UI';color:#ffe8b0;white-space:nowrap">🗺 <span style="display:inline-block;transform:rotate(${deg.toFixed(0)}deg);color:#ffcf4a;font-size:13px;vertical-align:middle">↑</span> <span style="color:#ffcf4a">${qis.name}</span> <span style="opacity:.6">${dist}m · dig the X</span></div>`;
    }
    // ── DIG prompt (ashore, on the quest isle) ──
    let digPrompt = "";
    if (ashore && activeQuest && !activeQuest.dug && ashoreIsle === activeQuest.isle && activeQuest.spot) {
      const near = Math.hypot(hero.x - activeQuest.spot.x, hero.z - activeQuest.spot.z) < 15;
      digPrompt = near
        ? `<div style="position:absolute;left:50%;bottom:15%;transform:translateX(-50%);${_pnl(".62")};border-color:#ffcf4a;padding:5px 16px;border-radius:999px;font:800 13px 'Segoe UI';color:#ffcf4a;white-space:nowrap">🗺 Press F to DIG the hoard</div>`
        : `<div style="position:absolute;left:50%;bottom:15%;transform:translateX(-50%);${_pnl(".5")};padding:4px 12px;border-radius:10px;font:700 12px 'Segoe UI';color:#ffe8b0;white-space:nowrap">🗺 The X is on this isle — find + dig it (F)</div>`;
    }

    // ── BOSS HEALTH BAR (top-center) — while the Dreadmaw is alive at sea ──
    let bossHud = "";
    if (!ashore && boss.ship && boss.ship.alive) {
      const r = Math.max(0, boss.ship.hp) / boss.ship.hpMax, dist = Math.round(Math.hypot(boss.ship.x - player.x, boss.ship.z - player.z));
      bossHud = `<div style="position:absolute;left:50%;top:6.2%;transform:translateX(-50%);width:min(430px,84%);text-align:center;font-family:'Segoe UI'">
          <div style="font:800 14px 'Segoe UI';color:#ff6a6a;text-shadow:0 1px 5px #000;letter-spacing:1.5px">☠ THE DREADMAW <span style="opacity:.55;font-weight:600;font-size:11px">· ${dist}m</span></div>
          <div style="margin-top:3px;height:12px;border-radius:6px;background:rgba(26,5,5,.85);border:1px solid #7a1616;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.55)">
            <div style="height:100%;width:${(r * 100).toFixed(1)}%;background:linear-gradient(90deg,#7a0c0c,#ff3b3b);box-shadow:0 0 10px #ff3b3b88"></div></div></div>`;
    }
    // ── WEATHER badge (sea only, when a squall is up) ──
    let weather = "";
    if (!ashore && storm.intensity > 0.18) weather = `<div style="position:absolute;right:14px;bottom:176px;${_pnl(".55")};padding:3px 9px;font:700 11px 'Segoe UI';color:#cfe0ee;white-space:nowrap">⛈ Squall ${Math.round(storm.intensity * 100)}%</div>`;
    kernel.hud(statusCard + waters + ribbon + stack + compass + bossHud + weather + digPrompt);
  }

  // ── TITLE SCREEN + MINIMAP ────────────────────────────────────────────────────
  // The world boots straight into an ATTRACT-MODE background (ocean + ships animate; the camera slow-orbits
  // the docked ship at Tortuga) with a title overlay on top until "Set Sail". A north-up, PLAYER-CENTRIC
  // minimap in the corner shows Tortuga (gold), islands (tan) and nearby ships coloured by difficulty tier. ─
  let _titleEl = null, _titleAng = 0;
  function buildTitle() {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0;z-index:120;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:'Segoe UI',system-ui,sans-serif;background:radial-gradient(ellipse at 50% 34%,rgba(10,28,44,.5),rgba(4,10,18,.9))";
    el.innerHTML = `
      <div style="font:900 clamp(34px,7vw,64px) Georgia,serif;letter-spacing:2px;background:linear-gradient(#fff2cf,#f1c368,#b9822c);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 3px 22px rgba(0,0,0,.5)">PIRATE'S COVE</div>
      <div style="margin-top:8px;font-size:clamp(13px,2.3vw,19px);color:#bfe0ef;letter-spacing:4px;opacity:.9">☠ SAIL &nbsp;·&nbsp; PLUNDER &nbsp;·&nbsp; RECRUIT ☠</div>
      <button id="pc-play" style="margin-top:28px;font:800 20px 'Segoe UI';padding:14px 48px;border-radius:12px;cursor:pointer;border:1px solid #ffe08a;background:linear-gradient(#ffe9a8,#f0b64e);color:#3a2408;box-shadow:0 6px 26px rgba(0,0,0,.5),inset 0 1px 0 #fff6d8">▶ Set Sail</button>
      <button id="pc-arena" style="margin-top:12px;font:800 16px 'Segoe UI';padding:11px 40px;border-radius:12px;cursor:pointer;border:1px solid #7fd7ff;background:linear-gradient(#bfe9ff,#4f9fd0);color:#082438;box-shadow:0 6px 26px rgba(0,0,0,.5),inset 0 1px 0 #eaf8ff">⚔ Cove Arena — PVP</button>
      <div style="margin-top:24px;font-size:12.5px;color:#9fbdcf;line-height:1.8;opacity:.85">
        <b>W/S</b> sail &nbsp; <b>A/D</b> steer &nbsp; <b>LEFT-CLICK</b> target a ship &nbsp; <b>SPACE</b> fire &nbsp; <b>E</b> dock &nbsp; <b>right-drag</b> look<br>
        Dock islands to explore on foot · dock <b style="color:#ffd36a">Tortuga</b> to upgrade &amp; hire crew</div>`;
    (kernel.parent || document.body).appendChild(el);
    el.querySelector("#pc-play").addEventListener("click", startGame);
    el.querySelector("#pc-arena").addEventListener("click", () => { startGame(); (window.__PC_ARENA__ && window.__PC_ARENA__.openMenu) ? window.__PC_ARENA__.openMenu() : banner("⚠ Arena module still loading — try again in a second"); });
    _titleEl = el;
  }
  function startGame() { if (gameStarted) return; gameStarted = true; if (_titleEl) _titleEl.style.display = "none"; resumeAudio(); banner("⚓ Fair winds, Captain!"); }
  function titleCam(dt) {   // slow cinematic orbit of the docked ship while the title is up
    _titleAng += dt * 0.12;
    const r = 150, cx = player.x, cz = player.z;
    kernel.camera.position.set(cx + Math.sin(_titleAng) * r, 58, cz + Math.cos(_titleAng) * r);
    kernel.camera.lookAt(cx, 5, cz);
  }

  let _mmEl = null, _mmCtx = null;
  const MM_SIZE = 150, MM_R = 69, MM_RANGE = SEA;   // player-centric radar scaled to the WHOLE map (SEA) so far islands plot near the rim
  function buildMinimap() {
    const c = document.createElement("canvas"); c.width = MM_SIZE; c.height = MM_SIZE;
    c.style.cssText = `position:absolute;right:12px;bottom:12px;z-index:52;width:${MM_SIZE}px;height:${MM_SIZE}px;border-radius:50%;box-shadow:0 4px 18px rgba(0,0,0,.55);border:1px solid rgba(130,185,215,.4);background:rgba(6,16,26,.5);pointer-events:none;display:none`;
    (kernel.parent || document.body).appendChild(c); _mmEl = c; _mmCtx = c.getContext("2d");
  }
  function drawMinimap() {
    if (!_mmCtx) return;
    const show = gameStarted && mode === "sail";
    _mmEl.style.display = show ? "block" : "none"; if (!show) return;
    const g = _mmCtx, cx = MM_SIZE / 2, cy = MM_SIZE / 2, sc = MM_R / MM_RANGE;
    g.clearRect(0, 0, MM_SIZE, MM_SIZE);
    g.save(); g.beginPath(); g.arc(cx, cy, MM_R, 0, 7); g.clip();
    g.fillStyle = "rgba(12,42,60,.72)"; g.fillRect(0, 0, MM_SIZE, MM_SIZE);
    g.strokeStyle = "rgba(130,185,215,.16)"; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, MM_R * 0.5, 0, 7); g.stroke();
    const plot = (wx, wz) => { const mx = cx + (wx - player.x) * sc, my = cy + (wz - player.z) * sc; return [mx, my, (mx - cx) * (mx - cx) + (my - cy) * (my - cy) <= MM_R * MM_R]; };
    for (const is of islands) { const [mx, my, inR] = plot(is.x, is.z); if (!inR) continue;
      if (is.isTown) { g.fillStyle = "#ffd36a"; g.beginPath(); g.arc(mx, my, 4.2, 0, 7); g.fill(); g.lineWidth = 1.4; g.strokeStyle = "#6d4d0e"; g.stroke(); }
      else { g.fillStyle = "rgba(200,180,120,.92)"; g.beginPath(); g.arc(mx, my, Math.max(2.4, is.r * sc), 0, 7); g.fill(); } }
    for (const n of npcs) { if (!n.alive) continue; const [mx, my, inR] = plot(n.x, n.z); if (!inR) continue;
      g.fillStyle = diffOf(n.level).hex; g.beginPath(); g.arc(mx, my, n.hostile ? 2.5 : 1.8, 0, 7); g.fill(); }
    if (boss.ship && boss.ship.alive) {                                // the Dreadmaw: a bright HUNT-marker (clamped to the rim if beyond range so its direction always shows)
      let [mx, my, inR] = plot(boss.ship.x, boss.ship.z);
      if (!inR) { const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1; mx = cx + dx / d * (MM_R - 4); my = cy + dy / d * (MM_R - 4); }
      g.fillStyle = "rgba(255,60,60,.28)"; g.beginPath(); g.arc(mx, my, 8, 0, 7); g.fill();
      g.fillStyle = "#ff2b2b"; g.beginPath(); g.arc(mx, my, 4.4, 0, 7); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.3; g.stroke(); }
    if (activeQuest && !activeQuest.dug) {                              // treasure-map target: a gold X marker (clamped to the rim if beyond range)
      let [mx, my, inR] = plot(activeQuest.isle.x, activeQuest.isle.z);
      if (!inR) { const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1; mx = cx + dx / d * (MM_R - 4); my = cy + dy / d * (MM_R - 4); }
      g.fillStyle = "rgba(255,207,74,.3)"; g.beginPath(); g.arc(mx, my, 7, 0, 7); g.fill();
      g.fillStyle = "#ffcf4a"; g.beginPath(); g.arc(mx, my, 3.8, 0, 7); g.fill(); g.strokeStyle = "#5a3d00"; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = "#3a2600"; g.font = "bold 7px monospace"; g.textAlign = "center"; g.fillText("X", mx, my + 2.4); }
    g.restore();
    const f = fwd(player.yaw), ax = f.x, ay = f.z, px = -ay, py = ax;   // player arrow at centre, pointing along heading
    g.fillStyle = "#eaf3ff"; g.strokeStyle = "#0a1622"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx + ax * 9, cy + ay * 9); g.lineTo(cx - ax * 5 + px * 5, cy - ay * 5 + py * 5); g.lineTo(cx - ax * 5 - px * 5, cy - ay * 5 - py * 5); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "rgba(205,222,236,.7)"; g.font = "bold 8px monospace"; g.textAlign = "center"; g.fillText("N", cx, 10);
  }

  // ── CREW ROSTER panel (toggle R) — your hired hands with level + XP. ───────────
  let rosterOpen = false, _rosterEl = null;
  function toggleRoster() { rosterOpen = !rosterOpen; renderRoster(); }
  function renderRoster() {
    if (!_rosterEl) { _rosterEl = document.createElement("div"); _rosterEl.style.cssText = "position:absolute;left:14px;bottom:14px;z-index:54;pointer-events:none;font:600 12px 'Segoe UI',monospace;color:#eaf3ff;background:rgba(8,18,28,.88);border:1px solid #3a6c8c;border-radius:10px;padding:9px 13px;min-width:158px;box-shadow:0 4px 18px rgba(0,0,0,.5)"; (kernel.parent || document.body).appendChild(_rosterEl); }
    if (!rosterOpen) { _rosterEl.style.display = "none"; return; }
    _rosterEl.style.display = "block";
    const rows = player.crew.length
      ? player.crew.map((c, i) => `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:${i ? 4 : 6}px"><span>🧑‍✈️ ${c.name}</span><span style="opacity:.85">Lv ${c.level || 1} <span style="opacity:.55">${c.xp || 0}xp</span></span></div>`).join("")
      : `<div style="opacity:.6;margin-top:6px">No crew yet — hire at Tortuga</div>`;
    _rosterEl.innerHTML = `<div style="font-weight:800;color:#ffe8b0;letter-spacing:.5px">⚓ Crew Roster <span style="opacity:.5;font-weight:600">(${player.crew.length})</span></div>${rows}<div style="margin-top:7px;opacity:.5;font-size:10.5px">press R to close</div>`;
  }

  // ── Sim step ─────────────────────────────────────────────────────────────────
  function stepPlayer(dt) {
    const frozen = shopOpen || !gameStarted || paused;                // frozen while shopping, paused, or on the title screen
    const th = frozen ? 0 : (keys["w"] || keys["arrowup"]) ? 1 : (keys["s"] || keys["arrowdown"]) ? -0.4 : 0;
    player.throttle = th;
    const targetSpeed = th * player.maxSpeed;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * (player.accel / player.maxSpeed));
    const steer = frozen ? 0 : (keys["a"] || keys["arrowleft"]) ? 1 : (keys["d"] || keys["arrowright"]) ? -1 : 0;
    // rudder authority scales with how fast you're moving (no turning dead in the water)
    player.yaw += steer * player.turnRate * dt * Math.min(1, Math.abs(player.speed) / 12 + 0.15);
    const f = fwd(player.yaw);
    let nx = player.x + f.x * player.speed * dt, nz = player.z + f.z * player.speed * dt;
    if (!frozen && storm.intensity > 0.1) { const w = storm.intensity * STORM_WIND * dt; nx += Math.sin(storm.windDir) * w; nz += Math.cos(storm.windDir) * w; }   // storm wind DRIFT (steer to hold heading); NOT while shopping/paused/title (frozen), else the ship slides off the dock
    if (overlapsLand(nx, nz, 8)) { player.speed *= 0.3; nx = player.x; nz = player.z; }   // grounded — bleed speed
    player.x = clampSea(nx); player.z = clampSea(nz);
    player.mesh.position.set(player.x, Math.sin(kernel.clock.elapsedTime * 1.4) * 0.5, player.z);
    faceYaw(player.mesh, player.yaw);
    player.mesh.rotation.z = -steer * 0.06 + Math.sin(kernel.clock.elapsedTime * 1.1) * 0.02;   // heel into turns + roll
    if (player.flashT > 0) stepFlash(player, dt);     // decay the on-hit damage-flash
  }
  // Decide (once per frame, O(N)) which ≤ENGAGE_CAP nearest hostiles CIRCLE + press the attack. Everyone else
  // wanders their belt. While the player is ASHORE, NOBODY engages — a hard guarantee boats ignore you on land.
  const _engageScan = [];
  function computeEngageSet() {
    _engageScan.length = 0;
    if (mode !== "sail") { for (const n of npcs) n.engaged = false; return; }   // ASHORE: clear all — no circling toward the parked ship
    const E2 = ENGAGE_R * ENGAGE_R;
    for (const n of npcs) {
      n.engaged = false;
      if (!n.alive || !n.hostile) continue;
      const dx = n.x - player.x, dz = n.z - player.z, d2 = dx * dx + dz * dz;
      if (d2 < E2 && !segBlockedByIsland(n.x, n.z, player.x, player.z)) _engageScan.push({ n, d2 });   // only ships with LINE OF SIGHT are eligible
    }
    _engageScan.sort((a, b) => a.d2 - b.d2);
    for (let i = 0, k = Math.min(ENGAGE_CAP, _engageScan.length); i < k; i++) _engageScan[i].n.engaged = true;   // nearest few only
  }
  function stepNPC(n, dt) {
    if (n.pvp) return;   // arena ships: net module owns movement
    if (n.flashT > 0) stepFlash(n, dt);               // decay the on-hit damage-flash
    if (!n.alive) {                                   // sinking -> heel over + go down, then respawn in-belt
      n.sinkT += dt;
      if (n.sinkT < 2.2) { n.mesh.rotation.z += dt * 0.8; n.mesh.position.y -= dt * 7; }
      else { n.mesh.visible = false; if (n.sinkT > 8 && !n.boss) respawnNPC(n); }   // bosses never respawn (reaped in stepBoss)
      return;
    }
    n.retargetT -= dt;
    if (n.retargetT <= 0) { n.wanderYaw = n.yaw + rand(-1.0, 1.0); n.retargetT = rand(3, 7); }
    // LOOK-AHEAD avoidance: probe a point ahead along the heading. If land or the world edge
    // is coming up, steer toward open water NOW (curve away) instead of driving into it and
    // wedging. The old code froze position + decayed speed on contact -> ships went dead in
    // the water; this keeps them making way and turning off obstacles before they arrive.
    const look = 80 + n.speed * 1.4;
    const fx = Math.sin(n.yaw), fz = Math.cos(n.yaw);
    const edgeAhead = Math.abs(n.x + fx * look) > SEA * 0.97 || Math.abs(n.z + fz * look) > SEA * 0.97;
    const landAhead = overlapsLand(n.x + fx * look, n.z + fz * look, 60) || overlapsLand(n.x + fx * look * 0.5, n.z + fz * look * 0.5, 45);
    // SEPARATION + ISLAND REPULSION: steer away from ships crowding us AND from nearby island shores, so ships
    // never pile up and never pack onto one flank of an island. ONE O(N) ship loop + a tiny O(ISLE_N) island pass.
    let sx = 0, sz = 0, crowd = 0;
    for (const o of npcs) { if (o === n || !o.alive) continue; const ox = n.x - o.x, oz = n.z - o.z, od = ox * ox + oz * oz;
      if (od < 95 * 95 && od > 1) { const inv = 1 / Math.sqrt(od); sx += ox * inv; sz += oz * inv; crowd++; } }
    for (const is of islands) { const ix = n.x - is.x, iz = n.z - is.z, id = Math.hypot(ix, iz), edge = id - is.r;
      if (edge < 90 && id > 1) { const k = 1 - Math.max(0, edge) / 90, inv = 2.4 / id; sx += ix * inv * k; sz += iz * inv * k; if (edge < 40) crowd++; } }   // push off shorelines
    // LEASH each ship to its difficulty belt so the zone gradient never smears, and keep the safe core clear.
    const rr = Math.hypot(n.x, n.z);
    const tooFar = rr > n.rOut + 45, tooClose = rr < Math.max(n.rIn - 45, SAFE_R - 8);
    // BROADSIDE CIRCLING — only the ≤ENGAGE_CAP engaged ships (set by computeEngageSet): present a SIDE + spiral to a
    // STAGGERED orbit radius so the ≤3 attackers form a loose firing line, not a stack.
    let orbitYaw = n.wanderYaw;
    if (n.engaged) {
      const orbitR = 150 + ((n.idx % 5) - 2) * 26 + (n.level % 3) * 8;
      const pdx = player.x - n.x, pdz = player.z - n.z, distP = Math.hypot(pdx, pdz) || 1, bearToPlayer = Math.atan2(pdx, pdz);
      n.orbitHystT -= dt; if (n.orbitHystT <= 0) n.orbitHystT = ORBIT_HYST;
      const spiral = Math.max(-0.6, Math.min(0.6, (distP - orbitR) / orbitR));
      orbitYaw = bearToPlayer + n.orbitSide * (Math.PI / 2 - spiral);   // ±90° tangent -> a side bears; spiral converges to the ring
    }
    const avoiding = edgeAhead || landAhead || tooFar || tooClose || crowd || n.engaged;
    let targetYaw = n.wanderYaw;
    if (landAhead || edgeAhead) targetYaw = Math.atan2(-n.x, -n.z);       // SAFETY FIRST — outranks crowd (fixes the crowd-into-land freeze + pile-up)
    else if (n.engaged) targetYaw = orbitYaw;                            // present a broadside
    else if (crowd) targetYaw = Math.atan2(sx, sz);                      // peel away from the pack + island shores
    else if (tooClose) targetYaw = Math.atan2(n.x, n.z);               // steer OUTWARD into the belt
    else if (tooFar) targetYaw = Math.atan2(-n.x, -n.z);               // steer toward centre
    const dy = ((targetYaw - n.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turn = avoiding ? n.turnRate * 2.4 : n.turnRate;
    n.yaw += Math.max(-turn * dt, Math.min(turn * dt, dy));
    const wantSpeed = n.engaged ? n.maxSpeed * 0.8 : avoiding ? n.maxSpeed * 0.55 : n.maxSpeed;
    n.speed += (wantSpeed - n.speed) * Math.min(1, dt * 0.7);
    n.speed = Math.max(n.speed, 6);                                     // FLOOR: never dead in the water
    const f = fwd(n.yaw);
    let nx = n.x + f.x * n.speed * dt, nz = n.z + f.z * n.speed * dt;
    if (storm.intensity > 0.1) { const w = storm.intensity * STORM_WIND * dt; nx += Math.sin(storm.windDir) * w; nz += Math.cos(storm.windDir) * w; }   // same wind drift on NPC ships (parity)
    // Last-ditch land contact: DON'T freeze (that was the pile-up anchor). Slide straight out from the island + keep headway.
    if (overlapsLand(nx, nz, 16)) {
      let ox = n.x, oz = n.z;
      for (const is of islands) { if (Math.hypot(is.x - nx, is.z - nz) < is.r + 16) { ox = n.x - is.x; oz = n.z - is.z; break; } }
      const om = Math.hypot(ox, oz) || 1, ux = ox / om, uz = oz / om;
      n.yaw = Math.atan2(ux, uz); nx = n.x + ux * Math.max(n.speed, 8) * dt; nz = n.z + uz * Math.max(n.speed, 8) * dt;
      if (overlapsLand(nx, nz, 16)) { nx = n.x; nz = n.z; }             // truly wedged (rare) -> hold this frame
    }
    n.x = clampSea(nx); n.z = clampSea(nz);
    n.mesh.position.set(n.x, Math.sin(kernel.clock.elapsedTime * 1.3 + n.bob) * 0.5, n.z);
    faceYaw(n.mesh, n.yaw);
    { const ddx = n.x - player.x, ddz = n.z - player.z; n.mesh.visible = !_probeHideShips && (ddx * ddx + ddz * ddz) < 850 * 850; }   // CULL past the fog wall: still simulate, just don't draw it (or its water reflection) — keeps ~80 ships cheap
  }
  function updateDock() {
    dockTarget = null; scoutTarget = null; let best = 1e9, sbest = 1e9;
    for (const is of islands) {
      const d = Math.hypot(is.x - player.x, is.z - player.z);
      if (d < is.dockR && d < best) { best = d; dockTarget = is; }
      if (!is.isTown) { const edge = d - is.r; if (edge < SCOUT_RANGE && edge < sbest) { sbest = edge; scoutTarget = is; } }   // scout by EDGE distance so big islands read sooner
    }
  }

  // ── Boot the world ───────────────────────────────────────────────────────────
  await Promise.all([
    loadHull("small", "assets/ship-small.glb", 16),
    loadHull("medium", "assets/ship-medium.glb", 22),
    loadHull("pirateMed", "assets/ship-pirate-medium.glb", 22),
    loadHull("pirateLg", "assets/ship-pirate-large.glb", 30),
    loadHull("large", "assets/ship-large.glb", 26),     // endgame flagship hull (bigger than the Brigantine) — preloaded so the Lv8 capstone swap never hitches mid-game
    loadProp("palm", "assets/props/palm.glb"),          // real CC0 island dressing (Poly.Pizza)
    loadProp("tree", "assets/props/tree.glb"),
    loadProp("rocks", "assets/props/rocks.glb"),
    loadProp("chest", "assets/props/chest.glb"),        // treasure chests to loot ashore
    preloadChar(),                                       // ANIMATED away-party character (hero / foot-pirates / crew) — skinned + Mixamo clip
  ]);
  initAudio();                                     // fire-and-forget: decode SFX + music while the world builds (resumes on first input)
  const town = buildTown(townPos.x, townPos.z);
  islands.push(town);                              // dockable hub + counts as land for avoidance
  scatterIslands();
  await spawnNPCs();
  player.mesh = makeShip("medium", true); scene.add(player.mesh);
  player.hullMats = player.mesh.userData.hullMats; player.flashT = 0;          // on-hit damage-flash
  shipVisBoot();                                                               // "Blackened Broadside" — establish the visual-upgrade baseline (hide spare flags, register repainted mats for the flash)
  { const s = harborSpawn(); player.x = s.x; player.z = s.z; player.yaw = s.yaw; }   // spawn in clear open water off Tortuga
  player.mesh.position.set(player.x, 0, player.z); faceYaw(player.mesh, player.yaw);

  let _hudAcc = 0, _infoAcc = 0, _shadowAcc = 0, _isleCullAcc = 0, _mmAcc = 0;
  kernel.onUpdate((dt) => {
    water.material.uniforms["time"].value += dt * 0.6;
    ashoreFill.intensity += ((mode === "ashore" ? 1.55 : 0) - ashoreFill.intensity) * Math.min(1, dt * 3);   // brighten on foot so characters pop, dark at sea
    if (!pvp.active) stepNight(dt);                                   // day<->night palette tween (frozen during arena matches) (renders even while paused, like the fill above)
    _shadowAcc += dt; if (_shadowAcc > 0.33) { _shadowAcc = 0; kernel.renderer.shadowMap.needsUpdate = true; }   // on-demand shadows (see setup)
    if (!paused) {   // ⏸ PAUSE freezes the ENTIRE sim; the still scene + camera + HUD below keep rendering behind the menu
    if (mode === "sail") { player.reloadTP -= dt; player.reloadTS -= dt; stepPlayer(dt); } else { stepHero(dt); stepCrew(dt); stepFoot(dt); updateOverlay(dt); }
    if (mode === "sail" && player.speed > 10) { _wakeAcc += dt; if (_wakeAcc > 0.10) { _wakeAcc = 0; shipWake(player.x, player.z, player.yaw, 3.4); } }   // foam trail behind YOUR ship
    if (_fireMsgT > 0) _fireMsgT -= dt;
    computeEngageSet();                                              // O(N): pick the ≤3 circlers for this frame (none while ashore)
    for (const n of npcs) { stepNPC(n, dt); enemyFire(n, dt);          // ships wander + circle + shoot back
      if (n.alive && n.mesh.visible && n.speed > 10) { const ddx = n.x - player.x, ddz = n.z - player.z; if (ddx * ddx + ddz * ddz < 520 * 520) { n.wakeT = (n.wakeT || 0) - dt; if (n.wakeT <= 0) { n.wakeT = 0.22; shipWake(n.x, n.z, n.yaw, 2.6); } } } }   // foam behind TRULY-NEAR moving ships only (keeps the pool for the player)
    stepCollisions(dt);                                             // ship-on-ship RAMMING: hull collisions damage both (upgrade-scaled)
    if (pvp.active && pvp.hooks && pvp.hooks.step) pvp.hooks.step(dt);   // Cove Arena: net sync + bots + bounds + win checks
    if (!pvp.active) stepBoss(dt);                                                    // Dreadmaw rise/hunt/flee + reap sunk bosses (AFTER the npc loop so splicing npcs[] is safe)
    if (!pvp.active) stepStorm(dt);                                  // squall onset/pass + rain + lightning (the intensity RAMP + palette live in stepNight/applyEnv, pre-!paused)
    updateShots(dt); updateFx(dt); updateWakes(dt); updateDebris(dt); updateGunsmoke(dt);  // cannonballs + flashes + wakes + sink debris + gunsmoke
    updateMusicState(dt);                                             // crossfade explore <-> battle music by combat state
    // cull far islands (their terrain + props) — fog hides them anyway; keeps the big scene cheap.
    // Anchor on the hero when ashore so the island you're on never culls out from under you.
    stepIslandChars(dt);                                             // idle-animate pirates on NEAR islands (alive-looking from the boat)
    _isleCullAcc += dt; if (_isleCullAcc > 0.4) { _isleCullAcc = 0; const cx = mode === "ashore" ? hero.x : player.x, cz = mode === "ashore" ? hero.z : player.z;
      for (const is of islands) { const dx = is.x - cx, dz = is.z - cz, near = (dx * dx + dz * dz) < 1050 * 1050; is.group.visible = near;
        if (!is.isTown) {
          if (near && !is.active) activateIsland(is); else if (!near && is.active) deactivateIsland(is);   // build/show content on approach, hide when far
          if (is.refillT > 0 && is !== ashoreIsle) { is.refillT -= 0.4; if (is.refillT <= 0) refillIsland(is, near); }   // regrow plundered islands
        } } }
    }   // ── end if(!paused): everything below (camera, HUD, minimap, banner) still runs while paused ──
    if (!gameStarted) titleCam(dt);                                   // attract-mode orbit until "Set Sail"
    else if (camMode === "zoomIn") blendCam(dt, "hero");             // dock: dolly from ship-scale down into the island
    else if (camMode === "zoomOut") { updateDock(); blendCam(dt, "ship"); }
    else if (camMode === "ashore") updateHeroCamera(dt);
    else { updateDock(); updateCamera(dt); }                         // "sail"
    if (_shake > 0.001 && !_freeCam) { _shake = Math.max(0, _shake - dt * 4.5); const s = _shake * 3.2;   // on-hit screen kick (fast decay; skipped in debug free-cam)
      kernel.camera.position.x += (Math.random() - 0.5) * s; kernel.camera.position.y += (Math.random() - 0.5) * s * 0.7; kernel.camera.position.z += (Math.random() - 0.5) * s; }
    // keep the selection ring under the inspected ship; drop it if the ship is gone/sunk
    if (mode === "sail" && selected) {
      if (npcs.indexOf(selected) < 0 || selected.hp <= 0) deselect();
      else { selRing.position.set(selected.x, 1.1, selected.z);
        _infoAcc += dt; if (_infoAcc > 0.25) { _infoAcc = 0; refreshInfo(); } }
    }
    if (_bannerT > 0) { _bannerT -= dt; if (_bannerT <= 0 && _bannerEl) _bannerEl.style.opacity = "0"; }
    _hudAcc += dt; if (_hudAcc > 0.15) { _hudAcc = 0; drawHUD(); if (rosterOpen) renderRoster(); }
    _mmAcc += dt; if (_mmAcc > 0.12) { _mmAcc = 0; drawMinimap(); }
  });
  drawHUD();
  buildTitle(); buildMinimap();                    // title overlay (up until "Set Sail") + corner radar

  // ── Cove Arena bridge: everything covenet.js needs, read-mostly. ──
  if (typeof window !== "undefined") {
    window.__PC_ARENA__ = Object.assign(window.__PC_ARENA__ || {}, {
      pvp, THREE, scene,
      get player() { return player; },
      get npcs() { return npcs; },
      get islandsXZR() { return islands.map((i) => ({ x: i.x, z: i.z, r: i.r })); },
      get mode() { return mode; },
      get gameStarted() { return gameStarted; },
      get SEA() { return SEA; },
      get FIRE_RANGE() { return FIRE_RANGE; },
      townPos, makeShip, faceYaw, fwd, relBearing, banner, damageFlash, addShake,
      burst, muzzle, sinkSplash, sfxAt, playSfx, rollShot, fireBall, clampSea,
      startGame, sinkPlayer,
      hideSandboxShips() { for (const n of npcs) { if (!n.pvp) { n._stashAlive = n.alive; n.alive = false; if (n.mesh) n.mesh.visible = false; } } },
      restoreSandboxShips() { for (const n of npcs) { if (!n.pvp) { if (n._stashAlive) n.alive = true; delete n._stashAlive; if (n.mesh) n.mesh.visible = true; } } },
      removePvpEntries() { for (let i = npcs.length - 1; i >= 0; i--) { const n = npcs[i]; if (n.pvp) { if (n.mesh) { scene.remove(n.mesh); n.mesh.traverse((o) => { if (o.isMesh) { o.geometry && o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => mt && mt.dispose && mt.dispose()); } }); } npcs.splice(i, 1); } } },
    });
  }

  // Headless-test / debug hook.
  if (typeof window !== "undefined") {
    window.__PC__ = {
      player, npcs, islands, keys, hero, get crewParty() { return crewParty; }, get footFoes() { return footFoes; },
      state: () => ({ px: +player.x.toFixed(1), pz: +player.z.toFixed(1), yaw: +player.yaw.toFixed(2), speed: +player.speed.toFixed(1), npcs: npcs.length, islands: islands.length, dock: dockTarget ? dockTarget.name : null }),
      npcState: () => npcs.map((n, i) => ({ i, x: +n.x.toFixed(1), z: +n.z.toFixed(1), spd: +n.speed.toFixed(1), hostile: n.hostile, level: n.level, hp: n.hp, dmg: n.dmg, type: n.type })),
      levelHistogram: () => { const h = {}; npcs.forEach((n) => { h[n.level] = (h[n.level] || 0) + 1; }); return h; },
      town: () => ({ name: TOWN_NAME, x: townPos.x, z: townPos.z }),
      forceAshore: (i) => { const is = islands.filter((x) => !x.isTown)[i || 0]; if (!is) return null; player.x = is.x; player.z = is.z + is.r + 30; enterIsland(is); return hero.mesh ? { isle: is.name, mode, heroAt: [+hero.x.toFixed(0), +hero.z.toFixed(0)], groundY: +groundYOn(is, hero.x, hero.z).toFixed(1) } : "no hero mesh"; },
      leaveIsle: () => { leaveIsland(); return mode; },
      islandsInfo: () => islands.filter((is) => !is.isTown).map((is) => ({ name: is.name, lvl: is.level, r: +is.r.toFixed(0), dist: +Math.hypot(is.x, is.z).toFixed(0), foes: is.foes.length, chests: is.chests.length, marauders: is.foes.filter((f) => f.kind === "marauder").length, rocks: (is.rocks || []).length, shape: is.sh ? { p: +is.sh.p.toFixed(2), a: +is.sh.a.toFixed(2), f: +is.sh.f.toFixed(3) } : null, active: is.active, populated: is.populated, foeMeshes: is.foes.filter((f) => f.mesh).length })),
      rockProbe: () => { const is = ashoreIsle; if (!is) return "not ashore"; const rk = is.rocks || []; return { rocks: rk.length, sample: rk.slice(0, 3).map((r) => ({ x: Math.round(r.x), z: Math.round(r.z), cr: +r.cr.toFixed(1) })) }; },
      rockCollideTest: () => {   // place the hero just outside a rock, aim at it, and walk forward -> should be blocked before the centre
        const is = ashoreIsle; if (!is || !(is.rocks || []).length) return "no rocks ashore"; const rk = is.rocks[0], wx = is.x + rk.x, wz = is.z + rk.z;
        hero.x = wx - (rk.cr + 8); hero.z = wz; hero.yaw = Math.PI / 2;       // face +x straight at the rock
        const startDist = Math.hypot(hero.x - wx, hero.z - wz);
        for (let s = 0; s < 60; s++) { const f = fwd(hero.yaw), nx = hero.x + f.x * hero.walk * (1 / 60), nz = hero.z + f.z * hero.walk * (1 / 60); if (heroCanGo(is, nx, nz)) { hero.x = nx; hero.z = nz; } else if (heroCanGo(is, nx, hero.z)) hero.x = nx; else if (heroCanGo(is, hero.x, nz)) hero.z = nz; }
        const endDist = Math.hypot(hero.x - wx, hero.z - wz), insideRock = heroCanGo(is, wx, wz) === false;
        return { rockCR: +rk.cr.toFixed(1), startDist: +startDist.toFixed(1), endDist: +endDist.toFixed(1), heroBlockedOutsideRock: endDist >= rk.cr - 0.5, rockCentreIsSolid: insideRock };
      },
      feelProbe: () => ({ wakes: _wakes.length, debris: _debris.length, shake: +_shake.toFixed(2), playerSpeed: +player.speed.toFixed(1) }),
      hitMe: (crit) => { addShake(crit ? 1.0 : 0.55); return { shake: +_shake.toFixed(2) }; },
      sinkTest: () => { let b = null, bd = 1e9; for (const n of npcs) { if (!n.alive) continue; const d = Math.hypot(n.x - player.x, n.z - player.z); if (d < bd) { bd = d; b = n; } } if (!b) return null; b.hp = 1; sinkNPC(b); return { sank: b.type, wakes: _wakes.length, debris: _debris.length }; },
      charClips: () => {   // what animation clip each ashore character is currently playing (verifies anim wiring)
        const active = (mx) => { if (!mx || !mx._actions) return null; const a = mx._actions.filter((x) => x.isRunning && x.isRunning() && x.getEffectiveWeight() > 0.5); return a.map((x) => x.getClip().name); };
        return { ashoreFill: +ashoreFill.intensity.toFixed(2), hero: hero.mixer ? active(hero.mixer) : null, foes: (ashoreIsle ? ashoreIsle.foes : []).slice(0, 6).map((f) => ({ kind: f.kind, alive: f.alive, deathT: +(f.deathT || 0).toFixed(1), aggro: !!f.aggro, clip: active(f.mixer) })) };
      },
      faceProbe: (yaw, off) => {   // clean facing check: park ashore, CLEAR foes/crew + HIDE all ships, face a set yaw, camera close BEHIND
        startGame();               // hide the title overlay
        if (mode !== "ashore") { const is = islands.find((x) => !x.isTown); player.x = is.x; player.z = is.z + is.r + 30; enterIsland(is); }
        if (ashoreIsle) for (const f of ashoreIsle.foes) if (f.mesh) f.mesh.visible = false;   // hide foes for a clean hero-only frame
        clearCrewParty();
        _probeHideShips = true; if (player.mesh) player.mesh.visible = false;   // only the hero in frame (flag survives stepNPC's per-frame cull)
        hero.yaw = yaw == null ? 0 : yaw; hero.hp = hero.hpMax;
        const useOff = off == null ? HERO_OFF : off, f = fwd(hero.yaw), gy = groundYOn(ashoreIsle, hero.x, hero.z);
        hero.mesh.position.set(hero.x, gy, hero.z); hero.mesh.rotation.y = hero.yaw + useOff;
        _freeCam = true; kernel.camera.up.set(0, 1, 0);
        kernel.camera.position.set(hero.x - f.x * 11, gy + 7, hero.z - f.z * 11);   // close BEHIND along heading -> should see the hero's BACK if the offset is right
        kernel.camera.lookAt(hero.x + f.x * 5, gy + 6, hero.z + f.z * 5);
        return { heroYaw: +hero.yaw.toFixed(2), offsetApplied: +useOff.toFixed(2), isle: ashoreIsle ? ashoreIsle.name : null };
      },
      heroState: () => ({ mode, x: +hero.x.toFixed(1), z: +hero.z.toFixed(1), yaw: +hero.yaw.toFixed(2), isle: ashoreIsle ? ashoreIsle.name : null, groundY: ashoreIsle ? +groundYOn(ashoreIsle, hero.x, hero.z).toFixed(1) : null }),
      fire: () => { player.reloadTP = 0; player.reloadTS = 0; playerFire(); return { shots: _shots.length, reloadTP: +player.reloadTP.toFixed(2), reloadTS: +player.reloadTS.toFixed(2) }; },
      stepColl: (dt) => { stepCollisions(dt == null ? 0.1 : dt); return true; },   // debug: run one ship-collision pass (the headless loop is throttled)
      ramSet: (hull) => { if (hull != null) upg.hull = hull; return { hull: upg.hull }; },
      foeLock: () => selectedFoe ? { kind: selectedFoe.kind, alive: selectedFoe.alive, dist: +Math.hypot(selectedFoe.x - hero.x, selectedFoe.z - hero.z).toFixed(0) } : null,
      chargeTest: (charge, quick) => { const foes = footFoes.filter((f) => f.alive).slice(0, 4); if (foes.length < 2) return "need >=2 foes"; hero.yaw = 0; hero.atkT = 0; heroWeapon = "cutlass"; foes.forEach((f, i) => { f.x = hero.x + (i - 1) * 5; f.z = hero.z + 12 + i * 3; f.hp = f.hpMax = 300; f.alive = true; }); const hp0 = foes.map((f) => f.hp); if (quick) heroAttack(0, 1); else heroChargedAttack(0, 1, charge == null ? 1 : charge); return { attack: quick ? "quick" : "charged(" + (charge == null ? 1 : charge) + ")", foesHurt: foes.filter((f, i) => f.hp < hp0[i]).length, dmgEach: foes.map((f, i) => +(hp0[i] - f.hp).toFixed(0)), chargingState: _charging }; },
      chargeState: () => ({ charging: _charging, chargeT: +_chargeT.toFixed(2), orbExists: !!_chargeOrb, orbVisible: !!(_chargeOrb && _chargeOrb.visible) }),
      tabFoe: () => { cycleFoe(); return window.__PC__.foeLock(); },
      fireArc: () => {   // report, per nearest hostiles, which side bears (broadside arc debug)
        const out = []; for (const n of npcs) { if (!n.alive || !n.hostile) continue; const dx = n.x - player.x, dz = n.z - player.z, d = Math.hypot(dx, dz); if (d > FIRE_RANGE) continue; const b = relBearing(player.x, player.z, player.yaw, n.x, n.z), ab = Math.abs(b) * 180 / Math.PI; out.push({ type: n.type, dist: +d.toFixed(0), bearingDeg: +(b * 180 / Math.PI).toFixed(0), side: b < 0 ? "PORT" : "STBD", bears: ab >= ARC_MIN && ab <= ARC_MAX }); }
        return { inRange: out.length, targets: out.slice(0, 8) };
      },
      combat: () => ({ hp: player.hp, hpMax: player.hpMax, level: player.level, xp: player.xp, gunDmg: player.gunDmg, aliveShips: npcs.filter((n) => n.alive).length, sinking: npcs.filter((n) => !n.alive).length, hostileInRange: npcs.filter((n) => n.alive && n.hostile && Math.hypot(n.x - player.x, n.z - player.z) < FIRE_RANGE).length, shots: _shots.length }),
      killNearest: () => { let b = null, bd = 1e9; for (const n of npcs) { if (!n.alive) continue; const d = Math.hypot(n.x - player.x, n.z - player.z); if (d < bd) { bd = d; b = n; } } if (!b) return null; const before = player.xp, lv = player.level; b.hp = 1; sinkNPC(b); return { killed: b.type, xpBefore: before, xpAfter: player.xp, level: lv + "->" + player.level }; },
      ashoreState: () => ({ mode, isle: ashoreIsle ? ashoreIsle.name : null, heroHp: hero.hp + "/" + hero.hpMax, gold: player.gold, foesAlive: footFoes.filter((f) => f.alive).length, foesTotal: footFoes.length, chestsLeft: footChests.filter((c) => !c.taken).length }),
      attack: (rangeAway) => { const f = footFoes.find((x) => x.alive); if (!f) return "no live foe"; const d = rangeAway == null ? 10 : rangeAway; hero.x = f.x - d; hero.z = f.z; hero.atkT = 0; const hp0 = f.hp; const bolts0 = _bolts.length; heroAttack(f.x - hero.x, f.z - hero.z); return { weapon: heroWeapon, foeHpBefore: hp0, foeHpAfter: f.hp, meleeHit: (f.hp < hp0 || !f.alive), boltsFired: _bolts.length - bolts0, foesAlive: footFoes.filter((x) => x.alive).length, gold: player.gold, xp: player.xp, fx: _fx.length }; },
      overlayProbe: () => ({ bars: _bars.size, dmgNums: _dmgN.length, bolts: _bolts.length, arrows: _bolts.filter((b) => b.kind === "arrow").length, spells: _bolts.filter((b) => b.kind === "spell").length, ashore: mode === "ashore" }),
      bowTest: () => { const f = footFoes.find((x) => x.alive); if (!f) return null; hero.x = f.x - 90; hero.z = f.z; hero.atkT = 0; fireArrowDir(f.x - hero.x, f.z - hero.z); return { flew: _bolts.some((b) => b.kind === "arrow"), dist: 90, bolts: _bolts.length, foeHp: f.hp }; },
      clipNames: () => Object.fromEntries(Object.keys(_charGltf).map((r) => [r, (_charGltf[r] && _charGltf[r].animations || []).map((c) => c.name)])),
      castTest: () => { const c = crewParty.find((x) => !x.down); const foe = footFoes.find((x) => x.alive); if (!c || !foe) return "need a crew wizard + a live foe"; c.atkT = 0; crewCastSpell(c, foe); return { cast: true, spells: _bolts.filter((b) => b.kind === "spell").length, crewAt: [Math.round(c.x), Math.round(c.z)], foeAt: [Math.round(foe.x), Math.round(foe.z)] }; },
      freezeBolts: () => { for (const b of _bolts) { b.t = 0.5; b.dur = 1e9; } return { frozen: _bolts.length, kinds: _bolts.map((b) => b.kind) }; },   // park bolts mid-flight for a screenshot
      spawnBothProjectiles: () => {   // hero arrow + crew-wizard spell, frozen mid-flight in front of the hero
        const foe = footFoes.find((f) => f.alive), c = crewParty.find((x) => !x.down);
        const yaw = hero.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
        if (foe) { foe.x = hero.x + fx * 60; foe.z = hero.z + fz * 60; foe.hp = 9999; }
        if (c) { c.x = hero.x - fx * 4 + fz * 16; c.z = hero.z - fz * 4 - fx * 16; }
        hero.atkT = 0; if (foe) fireArrowDir(foe.x - hero.x, foe.z - hero.z); if (c && foe) { c.atkT = 0; crewCastSpell(c, foe); }
        for (const b of _bolts) { b.t = 0.45; b.dur = 1e9; }
        return { bolts: _bolts.length, kinds: _bolts.map((b) => b.kind) };
      },
      charColorProbe: () => {   // sample a foe's mesh material colors -> confirm they're NOT a single flat dark block
        const f = (ashoreIsle ? ashoreIsle.foes : []).find((x) => x.mesh); if (!f) return "no foe mesh";
        const cols = []; f.mesh.traverse((n) => { if (n.isMesh && n.material) { const m = Array.isArray(n.material) ? n.material[0] : n.material; if (m.color) cols.push("#" + m.color.getHexString()); } });
        return { kind: f.kind, distinctColors: new Set(cols).size, sample: cols.slice(0, 8) };
      },
      grabChest: () => { const c = footChests.find((x) => !x.taken); if (!c) return null; hero.x = c.x; hero.z = c.z; const g0 = player.gold; stepFoot(0.001); return { goldBefore: g0, goldAfter: player.gold }; },
      shootTest: (shots) => { const f = footFoes.find((x) => x.alive); if (!f) return null; hero.x = f.x - 40; hero.z = f.z; hero.hp = 9999; const before = f.hp, g0 = player.gold, x0 = player.xp; for (let i = 0; i < (shots || 8); i++) { hero.atkT = 0; hero.yaw = Math.atan2(f.x - hero.x, f.z - hero.z); fireArrowDir(f.x - hero.x, f.z - hero.z); for (let s = 0; s < 30; s++) updateBolts(1 / 60); } return { foe: "lv" + f.level + " " + before + "hp", foeHpAfter: f.hp, foeKilled: !f.alive, goldGained: player.gold - g0, xpGained: player.xp - x0 }; },
      shopState: () => ({ open: shopOpen, gold: player.gold, hpMax: player.hpMax, gunDmg: player.gunDmg, maxSpeed: player.maxSpeed, crew: player.crew.length, upg: { ...upg } }),
      giveCrew: (n) => { for (let i = 0; i < (n || 1); i++) player.crew.push({ name: CREW_NAMES[player.crew.length % CREW_NAMES.length], level: 1, xp: 0 }); if (mode === "ashore" && ashoreIsle) spawnCrewParty(ashoreIsle); return { roster: player.crew.map((c) => c.name), ashore: crewParty.length }; },
      crewState: () => ({ roster: player.crew.map((c) => c.name + " Lv" + (c.level || 1) + " (" + (c.xp || 0) + "xp)"), ashore: crewParty.length, up: crewParty.filter((c) => !c.down).length, members: crewParty.map((c) => ({ name: c.name, hp: Math.max(0, Math.round(c.hp)) + "/" + c.hpMax, dmg: c.dmg, down: c.down, x: +c.x.toFixed(0), z: +c.z.toFixed(0), distHero: +Math.hypot(c.x - hero.x, c.z - hero.z).toFixed(0) })) }),
      crewFight: (secs) => { if (mode !== "ashore" || !crewParty.length) return "not ashore with crew"; const f0 = footFoes.filter((x) => x.alive).length, g0 = player.gold, xp0 = player.crew.map((c) => (c.xp || 0)); const N = Math.round((secs || 6) / (1 / 60)); for (let i = 0; i < N; i++) { stepCrew(1 / 60); stepFoot(1 / 60); } return { simSecs: secs || 6, foesBefore: f0, foesAfter: footFoes.filter((x) => x.alive).length, crewUp: crewParty.filter((c) => !c.down).length + "/" + crewParty.length, goldGained: player.gold - g0, crewXpGained: player.crew.map((c, i) => (c.xp || 0) - xp0[i]) }; },
      openShop: (giveGold) => { if (giveGold) player.gold += giveGold; openShop(); return { open: shopOpen, gold: player.gold }; },
      buy: (kind) => { const g0 = player.gold, s0 = { hpMax: player.hpMax, gunDmg: player.gunDmg, maxSpeed: player.maxSpeed, crew: player.crew.length }; buy(kind); return { kind, cost: shopCost(kind), spent: g0 - player.gold, gold: player.gold, before: s0, after: { hpMax: player.hpMax, gunDmg: player.gunDmg, maxSpeed: player.maxSpeed, crew: player.crew.length } }; },
      closeShop: () => { closeShop(); return { open: shopOpen }; },
      audioState: () => ({ ready: audio.ready, ctx: audio.ctx ? audio.ctx.state : null, started: audio.started, muted: audio.muted, musicState: music.state, ambient: !!audio._ambient, ambientGain: audio._ambient ? +audio._ambient.g.gain.value.toFixed(3) : null, exploreVol: music.explore ? +music.explore.gain.gain.value.toFixed(2) : null, battleVol: music.battle ? +music.battle.gain.gain.value.toFixed(2) : null, buffers: Object.fromEntries(Object.keys(audio.buffers).map((k) => [k, audio.buffers[k] ? +audio.buffers[k].duration.toFixed(2) + "s" : "FAILED"])) }),
      audioResume: () => { resumeAudio(); return { ctx: audio.ctx ? audio.ctx.state : null, music: music.state, started: audio.started }; },
      musicState: (s) => { if (s) setMusicState(s); return { state: music.state, combatT: +music.combatT.toFixed(1), exploreVol: music.explore ? +music.explore.gain.gain.value.toFixed(2) : null, battleVol: music.battle ? +music.battle.gain.gain.value.toFixed(2) : null }; },
      playSfx: (name, vol) => { resumeAudio(); playSfx(name, vol == null ? 1 : vol); return { played: name, src: SFX_SRC[name] || null, haveBuffer: !!(SFX_SRC[name] && audio.buffers[SFX_SRC[name]]), ctx: audio.ctx ? audio.ctx.state : null }; },
      muteToggle: () => { toggleMute(); return { muted: audio.muted }; },
      pauseState: () => ({ paused, view: _pauseView, shown: !!(_pauseEl && _pauseEl.style.display !== "none") }),
      pause: () => { togglePause(); return { paused, view: _pauseView }; },
      setPauseView: (v) => { if (!paused) openPause(); _pauseView = v; renderPause(); return { view: _pauseView }; },
      setVolume: (m, mu, s) => { if (m != null) masterVol = m; if (mu != null) musicVol = mu; if (s != null) sfxVol = s; applyAudio(); saveAudio(); return { masterVol, musicVol, sfxVol, masterGain: audio.master ? +audio.master.gain.value.toFixed(3) : null, musicGain: audio.musicGain ? +audio.musicGain.gain.value.toFixed(3) : null }; },
      titleState: () => ({ started: gameStarted, titleShown: !!(_titleEl && _titleEl.style.display !== "none"), minimapShown: !!(_mmEl && _mmEl.style.display === "block"), playBtn: !!(_titleEl && _titleEl.querySelector("#pc-play")) }),
      play: () => { startGame(); return { started: gameStarted, titleShown: !!(_titleEl && _titleEl.style.display !== "none") }; },
      minimapPixels: () => { if (!_mmCtx) return null; const d = _mmCtx.getImageData(0, 0, MM_SIZE, MM_SIZE).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20) lit++; return { nonEmptyPx: lit, shown: _mmEl.style.display }; },
      roster: () => { toggleRoster(); return { open: rosterOpen, shown: _rosterEl ? _rosterEl.style.display : null, crew: player.crew.length, html: _rosterEl && rosterOpen ? _rosterEl.textContent.slice(0, 120) : null }; },
      fxProbe: () => ({ activeFx: _fx.length, muzzles: _fx.filter((f) => f.fast).length, shots: _shots.length }),
      flashProbe: () => {   // fire at the nearest ship, then report its damage-flash state + fresh muzzle count
        let b = null, bd = 1e9; for (const n of npcs) { if (!n.alive) continue; const d = Math.hypot(n.x - player.x, n.z - player.z); if (d < bd) { bd = d; b = n; } }
        if (!b) return "no target"; player.x = b.x - 100; player.z = b.z; player.yaw = 0; player.reloadTP = 0; player.reloadTS = 0; const fx0 = _fx.length;   // yaw 0 -> target at +x sits on the STARBOARD beam, so guns bear
        playerFire();
        const em = b.hullMats && b.hullMats[0] && b.hullMats[0].emissive;
        return { firedAt: b.type, muzzleSpawned: _fx.length > fx0, targetFlashTAfterFire: +(b.flashT || 0).toFixed(2), note: "flashT is set on IMPACT (when the ball lands), not at fire", hasHullMats: !!(b.hullMats && b.hullMats.length), emissiveNow: em ? [+em.r.toFixed(2), +em.g.toFixed(2), +em.b.toFixed(2)] : null };
      },
      selectIndex: (i) => { selected = npcs[i] || null; if (selected) { refreshInfo(); selRing.position.set(selected.x, 1.1, selected.z); return { type: selected.type, level: selected.level, hp: selected.hp, hpMax: selected.hpMax, dmg: selected.dmg, diff: diffOf(selected.level).tier }; } deselect(); return null; },
      press: (k, v) => { keys[String(k).toLowerCase()] = v !== false; },
      teleport: (x, z) => { player.x = x; player.z = z; },
      // debug: freeze the chase cam and look straight down on a world point (to verify hull facing)
      topDown: (cx, cz, h) => { _freeCam = true; const x = cx != null ? cx : player.x, z = cz != null ? cz : player.z; kernel.camera.position.set(x, h || 140, z + 0.01); kernel.camera.up.set(0, 0, -1); kernel.camera.lookAt(x, 0, z); },
      chase: () => { _freeCam = false; kernel.camera.up.set(0, 1, 0); },
      wcam: (dist, aimY, side) => { _freeCam = true; kernel.camera.up.set(0, 1, 0); const f = fwd(hero.yaw), d = dist || 7, s = side == null ? 1 : side; const rx = Math.cos(hero.yaw) * s, rz = -Math.sin(hero.yaw) * s; const gy = (mode === "ashore" && ashoreIsle) ? groundYOn(ashoreIsle, hero.x, hero.z) : 0; kernel.camera.position.set(hero.x + f.x * d * 0.55 + rx * d, gy + (aimY == null ? 8 : aimY) + 1.5, hero.z + f.z * d * 0.55 + rz * d); kernel.camera.lookAt(hero.x, gy + (aimY == null ? 8 : aimY), hero.z); },   // 3/4 front-side inspection cam for the weapon in hand
      reWeapon: (size, ox, oy, oz, rx, ry, rz) => {   // live-tune the cutlass on the HAND bone (FistR): size + offset + rotation, then bake into WPN_*
        if (!hero.mesh || !_gunGltf) return "no hero/weapon";
        if (size != null) WPN_SIZE = size; if (ox != null) WPN_OX = ox; if (oy != null) WPN_OY = oy; if (oz != null) WPN_OZ = oz; if (rx != null) WPN_RX = rx; if (ry != null) WPN_RY = ry; if (rz != null) WPN_RZ = rz;
        equipHeroGun(hero.mesh);
        let hand = null; hero.mesh.traverse((n) => { if (n.isBone && /^FistR$/i.test(n.name)) hand = hand || n; });
        return { WPN_SIZE, off: [WPN_OX, WPN_OY, WPN_OZ], rot: [WPN_RX, WPN_RY, WPN_RZ], handBone: hand ? hand.name : null, attached: hand ? hand.children.filter((c) => !c.isBone).length : 0 };
      },
      weaponInfo: () => { if (!_gunGltf) return "no weapon glb"; const box = new THREE.Box3().setFromObject(_gunGltf.scene), sz = new THREE.Vector3(); box.getSize(sz); return { size: [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)], min: [+box.min.x.toFixed(2), +box.min.y.toFixed(2), +box.min.z.toFixed(2)], max: [+box.max.x.toFixed(2), +box.max.y.toFixed(2), +box.max.z.toFixed(2)], longestAxis: (sz.x >= sz.y && sz.x >= sz.z) ? "x" : (sz.y >= sz.z ? "y" : "z") }; },
      showFlintlock: (size, ox, oy, oz, rx, ry, rz) => { if (!hero.mesh) return "no hero"; let hand = null; hero.mesh.traverse((n) => { if (n.isBone && /^FistR$/i.test(n.name)) hand = hand || n; }); if (!hand) return "no hand"; for (let i = hand.children.length - 1; i >= 0; i--) if (!hand.children[i].isBone) hand.remove(hand.children[i]); const fl = makeFlintlock(); const box = new THREE.Box3().setFromObject(fl), sz = new THREE.Vector3(); box.getSize(sz); fl.scale.setScalar((size == null ? 1.3 : size) / (Math.max(sz.x, sz.y, sz.z) || 1)); fl.position.set(ox || 0, oy || 0, oz || 0); fl.rotation.set(rx || 0, ry || 0, rz || 0); hand.add(fl); return { shown: true, glbSize: [+sz.x.toFixed(1), +sz.y.toFixed(1), +sz.z.toFixed(1)] }; },
      swapWeapon: () => { switchWeapon(); return window.__PC__.weaponState(); },
      weaponState: () => { let h = null; if (hero.mesh) hero.mesh.traverse((n) => { if (n.isBone && /^FistR$/i.test(n.name)) h = h || n; }); const w = h && h.children.find((c) => !c.isBone); return { weapon: heroWeapon, heldMeshes: h ? h.children.filter((c) => !c.isBone).length : -1, heldIsProcedural: w ? !!(w.userData && w.userData.procedural) : null }; },
      setWeapon: (which) => { if (which !== heroWeapon && (which === "cutlass" || which === "flintlock")) switchWeapon(); return window.__PC__.weaponState(); },
      shipTree: () => { const out = []; if (player.mesh) player.mesh.traverse((n) => { out.push({ name: n.name || "(unnamed)", type: n.type, mesh: !!n.isMesh, vis: n.visible, mat: n.material && n.material.uuid ? n.material.uuid.slice(0, 8) : null, color: n.material && n.material.color ? "#" + n.material.color.getHexString() : null }); }); return out; },
      shipVisState: () => { const hull = shipHullMesh(); const sm = shipMeshOf(shipNode("sail-a")); const guns = hull && hull.getObjectByName("pc_guns"); const sn = shipNode("sail-a"); return { upg: { ...upg }, crew: player.crew.length, level: player.level, flagship: !!player._flagship, hull: hull ? hull.name : null, sailColor: sm && sm.material ? "#" + sm.material.color.getHexString() : null, sailScale: sn ? +sn.scale.x.toFixed(2) : null, hullColor: hull && hull.material ? "#" + hull.material.color.getHexString() : null, cannons: guns ? guns.children.length : 0, flagsVisible: ["flag-a", "flag-b", "flag-c"].filter((nm) => { const nd = shipNode(nm); return nd && nd.visible; }).length, hullMats: (player.hullMats || []).length }; },
      buyViz: (kind, n) => { player.gold += 1e6; for (let i = 0; i < (n || 1); i++) buy(kind); return window.__PC__.shipVisState(); },
      setLevel: (l) => { let guard = 0; while (player.level < (l || 1) && guard++ < 40) gainXP(xpForLevel(player.level) + 1); return window.__PC__.shipVisState(); },
      forceFlagship: () => { player.level = Math.max(player.level, 8); player._flagship = false; maybeSwapFlagship(); return window.__PC__.shipVisState(); },
      showShip: (yaw) => { startGame(); if (mode === "ashore") leaveIsland(); _probeHideShips = true; player.speed = 0; player.throttle = 0; player.yaw = yaw == null ? 0.85 : yaw; if (player.mesh) { player.mesh.visible = true; player.mesh.position.set(player.x, 0, player.z); faceYaw(player.mesh, player.yaw); } const f = fwd(player.yaw); _freeCam = true; kernel.camera.up.set(0, 1, 0); kernel.camera.position.set(player.x - f.x * 27 + f.z * 7, 15, player.z - f.z * 27 - f.x * 7); kernel.camera.lookAt(player.x, 4.5, player.z); return { yaw: +player.yaw.toFixed(2), hull: shipHullMesh() ? shipHullMesh().name : null, vis: player.mesh ? player.mesh.visible : null }; },
      nightState: () => ({ t: +night.t.toFixed(2), target: night.target, cool: +night.cool.toFixed(0), dur: +night.dur.toFixed(0), exposure: +kernel.renderer.toneMappingExposure.toFixed(2), sunI: kernel.sun ? +kernel.sun.intensity.toFixed(2) : null, fogFar: +scene.fog.far.toFixed(0), env: +scene.environmentIntensity.toFixed(2), moonVis: moon.visible, bossAlive: !!(boss.ship && boss.ship.alive), bossHp: boss.ship ? boss.ship.hp + "/" + boss.ship.hpMax : null, bossDist: boss.ship ? Math.round(Math.hypot(boss.ship.x - player.x, boss.ship.z - player.z)) : null, landBoss: landBoss ? { hp: landBoss.hp + "/" + landBoss.hpMax, dmg: landBoss.dmg, at: [Math.round(landBoss.x), Math.round(landBoss.z)] } : null, npcs: npcs.length }),
      setNight: (t) => { night.t = night.target = Math.max(0, Math.min(1, t == null ? 1 : t)); applyEnv(); return window.__PC__.nightState(); },
      nightNow: () => { startGame(); startNight(); return window.__PC__.nightState(); },   // force nightfall now (natural path — rolls the sea boss ~1 in 5)
      riseBoss: () => { startGame(); night.t = night.target = 1; night.dur = 9999; applyEnv(); if (boss.ship) return "boss already up"; riseBoss(); return window.__PC__.nightState(); },
      hurtBoss: (d) => { if (!boss.ship || !boss.ship.alive) return "no boss"; boss.ship.hp -= (d || 100); if (boss.ship.hp <= 0) sinkNPC(boss.ship); return window.__PC__.nightState(); },
      killBoss: () => { if (!boss.ship || !boss.ship.alive) return "no boss"; boss.ship.hp = 1; sinkNPC(boss.ship); return { defeated: true, gold: player.gold, level: player.level, nightTarget: night.target }; },
      spawnLandBoss: () => { if (mode !== "ashore" || !ashoreIsle) return "not ashore"; if (landBoss) return "captain already here"; const f = spawnLandBossOn(ashoreIsle); return f ? { spawned: true, hp: f.hp, dmg: f.dmg, at: [Math.round(f.x), Math.round(f.z)] } : "no char model"; },
      killLandBoss: () => { const f = landBoss; if (!f) return "no land boss"; f.alive = false; f.deathT = 1.1; if (f.play) f.play("death", { once: true }); landBossReward(f); return { gold: player.gold, landBossGone: !landBoss }; },
      setStorm: (i) => { startGame(); storm.target = storm.intensity = Math.max(0, Math.min(1, i == null ? 0.85 : i)); if (i != null && i > 0.1 && !storm.windDir) storm.windDir = 1.2; applyEnv(); return window.__PC__.stormState(); },
      stormState: () => ({ intensity: +storm.intensity.toFixed(2), target: +storm.target.toFixed(2), nextT: +storm.nextT.toFixed(0), windDir: +storm.windDir.toFixed(2), rainOn: !!(_rainMesh && _rainMesh.visible), rainInstances: _rainMesh ? RAIN_N : 0, lightFlash: +_lightFlash.toFixed(2), exposure: +kernel.renderer.toneMappingExposure.toFixed(2), fogFar: +scene.fog.far.toFixed(0), waterDistort: +water.material.uniforms["distortionScale"].value.toFixed(2), waterSize: +water.material.uniforms["size"].value.toFixed(2) }),
      lightning: () => { lightningFlash(); return { lightFlash: +_lightFlash.toFixed(2) }; },
      startQuest: () => { if (activeQuest) return "quest already active"; player.gold += MAP_COST; buy("map"); return window.__PC__.questState(); },
      questState: () => (activeQuest ? { isle: activeQuest.isle.name, isleAt: [Math.round(activeQuest.isle.x), Math.round(activeQuest.isle.z)], dug: activeQuest.dug, spot: activeQuest.spot ? [Math.round(activeQuest.spot.x), Math.round(activeQuest.spot.z)] : null, markerBuilt: !!activeQuest.mesh, gold: player.gold } : { active: false, gold: player.gold }),
      digHere: () => { if (!activeQuest || activeQuest.dug) return "no active un-dug quest"; if (mode !== "ashore" || ashoreIsle !== activeQuest.isle) return "not ashore on the quest isle"; if (activeQuest.spot) { hero.x = activeQuest.spot.x; hero.z = activeQuest.spot.z; } const g0 = player.gold; const ok = tryDig(); return { dug: ok, goldGained: player.gold - g0, questCleared: !activeQuest }; },
      camera: kernel.camera, scene,
    };
  }
  console.log("[pirates-cove] world ready:", npcs.length, "ships,", islands.length, "islands, sea half-extent", SEA);
});
