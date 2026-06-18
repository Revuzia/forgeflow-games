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
  // ranking (online-only, vs logged-in players)
  let myProfile = null, oppProfile = null, matchNonce = null, _ratings = null, _rankLine = "", _lastStatus = null;

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
    // sim heading h: forward = (cos h, sin h) in sim; sim +y maps to scene +z (no
    // flip). three.js rotation.y=θ sends model +X (the bow) to (cos θ, 0, -sin θ),
    // so to face (cos h, 0, sin h) we need θ = -h. (The hull + move-anim were using
    // +h while only the arc used -h — that mismatch made ships look broadside-on /
    // "sideways". Now everything uses this one correct value.)
    return -h;
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

  // ── Ambient OCEAN LIFE — REAL low-poly creature models (from the ForgeFlow CC0/
  // CC-BY creature library) replace the old procedural primitives the user rejected.
  // A flock of seagulls glides + banks overhead; dolphins breach nose-first in arcs
  // and splash on re-entry; a shark cruises with its dorsal slicing the surface
  // (periodic lunges show the back); a whale rises from the deep to show its back +
  // a blowhole spout; a manta ray glides at the surface and breaches. Each real GLB
  // is NORMALIZED (centered on a pivot via its native box, scaled so its body length
  // == a target, nose rotated to +X) then wrapped in an outer group the per-frame
  // code moves/orients. The reflective Water hides anything below y=0, so sea
  // creatures break the surface to read (and show as dark forms — how you spot real
  // sea life from above); the gull keeps its light plumage against the sky. NO
  // creature casts a shadow; clones share geometry; NO lights are added (shader
  // freeze); all transforms via .position.set / .rotation. Models + per-type config
  // come from content.ocean_life (pipeline-wired), with a built-in default.
  const OCEAN_LIFE_DEFAULT = {
    gull:    { model: "assets/creatures/bird.glb",    length: 4.6, rotY: -Math.PI / 2, count: 5, air: true, animated: true, clip: "Fly" },
    dolphin: { model: "assets/creatures/dolphin.glb", length: 8,   rotY: Math.PI / 2, count: 2 },
    shark:   { model: "assets/creatures/shark.glb",   length: 13,  rotY: Math.PI / 2, count: 1 },
    whale:   { model: "assets/creatures/whale.glb",   length: 24,  rotY: Math.PI / 2, count: 1 },
    manta:   { model: "assets/creatures/manta.glb",   length: 11,  rotY: Math.PI / 2, count: 1 },
  };
  async function buildOceanLife() {
    const EX = ARENA_W * 0.62, EZ = ARENA_H * 0.62;
    const wrap = (v, lim) => (v > lim ? -lim : v < -lim ? lim : v);
    const cfg = Object.assign({}, OCEAN_LIFE_DEFAULT, (content.ocean_life || {}));

    // Load + normalize: measure the NATIVE box (a post-rotation setFromObject does
    // NOT reliably reflect the rotation here, which silently mis-scaled ~2.6x), pick
    // the native axis that becomes world-X after the Y-rotation as the body length,
    // center the model on a PIVOT (bulletproof — scaling/rotating the pivot keeps the
    // body centered), then darken sea creatures for contrast / keep the gull light.
    async function loadCreature(c) {
      if (!c || !c.model) return null;
      let m;
      try { m = await kernel.loadGLTF(c.model); }
      catch (e) { console.warn("[ocean-life] load failed:", c.model, e && e.message); return null; }
      const rotY = c.rotY || 0;
      m.rotation.set(0, 0, 0); m.scale.setScalar(1); m.position.set(0, 0, 0);
      m.updateMatrixWorld(true);
      const nbox = new THREE.Box3().setFromObject(m);
      const nsize = new THREE.Vector3(); nbox.getSize(nsize);
      const nctr = new THREE.Vector3(); nbox.getCenter(nctr);
      const bodyLen = (Math.abs(Math.cos(rotY)) * nsize.x + Math.abs(Math.sin(rotY)) * nsize.z) || 1;
      m.position.set(-nctr.x, -nctr.y, -nctr.z);
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false; o.receiveShadow = false;
        const mat = o.material; if (!mat) return;
        if (c.air) {                                   // bird against the sky: keep light, faint emissive lift
          if (mat.emissive) { mat.emissive.copy(mat.color || mat.emissive); mat.emissiveIntensity = 0.12; }
        } else {                                       // sea creature: dark form reads against the bright water
          if (mat.color) mat.color.lerp(new THREE.Color(0x1d2a33), 0.42);
          if (mat.emissive) { mat.emissive.setHex(0x0a1014); mat.emissiveIntensity = 0.12; }
          if (mat.roughness != null) mat.roughness = Math.min(mat.roughness, 0.5);
          if (mat.metalness != null) mat.metalness = Math.max(mat.metalness, 0.12);
        }
        mat.envMapIntensity = 1.0;
      });
      const pivot = new THREE.Group(); pivot.add(m);
      pivot.scale.setScalar((c.length || 6) / bodyLen);
      pivot.rotation.y = rotY;
      return pivot;
    }
    function spawn(tpl, x, y, z, name) {
      const g = new THREE.Group(); g.add(tpl.clone(true)); g.position.set(x, y, z); g.name = name || "ocean"; scene.add(g); return g;
    }
    // Animated BIRD (rigged) via loadCharacter so the wings actually FLAP — a static
    // mesh can't. Each call returns a fresh rigged instance with its OWN mixer
    // (auto-updated by the kernel), normalized into a pivot like the static creatures.
    // Skinned meshes can't be plain-cloned, so we build one per gull (loadCharacter
    // caches the parse; extra instances are cheap skeleton clones).
    async function makeBird(c) {
      let ch;
      try { ch = await kernel.loadCharacter(c.model); }
      catch (e) { console.warn("[ocean-life] bird load failed:", c.model, e && e.message); return null; }
      const m = ch.scene, rotY = c.rotY || 0;
      m.rotation.set(0, 0, 0); m.scale.setScalar(1); m.position.set(0, 0, 0); m.updateMatrixWorld(true);
      const nb = new THREE.Box3().setFromObject(m), ns = new THREE.Vector3(); nb.getSize(ns);
      const nc = new THREE.Vector3(); nb.getCenter(nc);
      const bodyLen = (Math.abs(Math.cos(rotY)) * ns.x + Math.abs(Math.sin(rotY)) * ns.z) || 1;
      m.position.set(-nc.x, -nc.y, -nc.z);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; if (o.material) o.material.envMapIntensity = 1.0; } });
      const pivot = new THREE.Group(); pivot.add(m);
      pivot.scale.setScalar((c.length || 4) / bodyLen); pivot.rotation.y = rotY;
      const clip = (ch.animations || []).find((a) => new RegExp(c.clip || "fly", "i").test(a.name)) || (ch.animations || [])[0];
      if (clip && ch.play) ch.play(clip.name, { fade: 0, timeScale: 0.85 + Math.random() * 0.4 }); // desync the flock's wingbeats
      return pivot;
    }

    const gullAnimated = cfg.gull && (cfg.gull.animated || cfg.gull.clip);
    const [gullT, dolphinT, sharkT, whaleT, mantaT] = await Promise.all([
      gullAnimated ? null : loadCreature(cfg.gull), loadCreature(cfg.dolphin), loadCreature(cfg.shark), loadCreature(cfg.whale), loadCreature(cfg.manta),
    ]);

    const birds = [];
    const gullCount = (cfg.gull && cfg.gull.count) || 0;
    // build the flock: rigged FLAPPING birds (one mixer each) when animated, else cloned static
    const gullInstances = await Promise.all(Array.from({ length: gullCount }, () => gullAnimated ? makeBird(cfg.gull) : Promise.resolve(gullT && gullT.clone(true))));
    for (let i = 0; i < gullCount; i++) {
      const inst = gullInstances[i]; if (!inst) continue;
      const g = new THREE.Group(); g.add(inst);
      g.position.set(Math.cos(i * 1.7) * EX * 0.7, 14 + (i % 3) * 10, Math.sin(i * 2.3) * EZ * 0.7); g.name = "ocean_gull";
      g.scale.setScalar(1 + (i % 3) * 0.3); scene.add(g);
      birds.push({ g, vx: (i % 2 ? 1 : -1) * (10 + i * 1.6), vz: (i % 2 ? -1 : 1) * (4 + (i % 3) * 1.8), ph: i * 1.7, baseY: g.position.y });
    }
    const dolphins = [];
    if (dolphinT) for (let i = 0; i < (cfg.dolphin.count || 0); i++) {
      const g = spawn(dolphinT, (i ? 1 : -1) * EX * 0.4, -2.2, (i ? -1 : 1) * EZ * 0.35, "ocean_dolphin");
      dolphins.push({ g, vx: (i ? -1 : 1) * 14, vz: (i ? 2 : -2.2), t: i * 2.4, period: 5.5 + i * 1.3, arc: 7 + i });
    }
    const sharks = [];
    if (sharkT) for (let i = 0; i < (cfg.shark.count || 0); i++) {
      const g = spawn(sharkT, -EX * 0.5, -1.6, EZ * 0.2, "ocean_shark");
      sharks.push({ g, vx: 9 + i * 2, baseY: -1.6, t: i * 1.5 });   // dorsal sits ~+0.8 above the surface at rest
    }
    const whales = [];
    if (whaleT) for (let i = 0; i < (cfg.whale.count || 0); i++) {
      const g = spawn(whaleT, EX * 0.35, -4.4, -EZ * 0.45, "ocean_whale");
      whales.push({ g, vx: -5.5, baseY: -4.4, t: i * 3, spoutAt: -99 });  // deep at rest; rises to show its back
    }
    const mantas = [];
    if (mantaT) for (let i = 0; i < (cfg.manta.count || 0); i++) {
      const g = spawn(mantaT, -EX * 0.3, 0.4, -EZ * 0.3, "ocean_manta");
      mantas.push({ g, vx: 7, vz: 3.5, baseY: 0.4, t: i * 2 });    // glides with its back at the surface
    }
    try { window.__OCEAN__ = { birds, dolphins, sharks, whales, mantas }; } catch (e) {}

    let bt = 0;
    kernel.onUpdate((dt) => {
      bt += dt;
      // seagulls: glide + bob, yaw to heading, bank/roll into the lateral component of travel
      for (const b of birds) {
        b.g.position.set(wrap(b.g.position.x + b.vx * dt, EX), b.baseY + Math.sin(bt * 0.7 + b.ph) * 1.7, wrap(b.g.position.z + b.vz * dt, EZ));
        b.g.rotation.set(0, -Math.atan2(b.vz, b.vx), 0); // -atan2: face travel (three.js rotation.y sign)
        b.g.rotateX(Math.sin(bt * 0.7 + b.ph) * -0.10);
        b.g.rotateZ(-0.4 * (b.vz / (Math.abs(b.vx) + Math.abs(b.vz) + 1e-3)) + Math.sin(bt * 2.1 + b.ph) * 0.06);
      }
      // dolphins: cruise the surface, leap nose-first in an arc, re-enter with a splash
      for (const d of dolphins) {
        d.t += dt;
        d.g.position.set(wrap(d.g.position.x + d.vx * dt, EX), 0, wrap(d.g.position.z + d.vz * dt, EZ));
        const phase = (d.t % d.period) / d.period, breach = Math.sin(phase * Math.PI), air = breach > 0.02;
        d.g.position.y = air ? (breach * d.arc - 1.0) : -0.7; // cruise shallow + VISIBLE between leaps (was hidden at -2.4)
        d.g.rotation.set(0, -Math.atan2(d.vz, d.vx), 0); // -atan2: swim nose-first
        d.g.rotateZ(air ? Math.cos(phase * Math.PI) * 0.95 : 0);
        if (d._wasAir && !air) splash({ x: d.g.position.x, y: 0, z: d.g.position.z });
        d._wasAir = air;
      }
      // shark: cruises with its dorsal slicing the surface, weaving; periodic surface lunges lift the back clear
      for (const sh of sharks) {
        sh.t += dt;
        const weaveVz = Math.sin(sh.t * 0.5) * 9;
        const lunge = Math.pow(Math.max(0, Math.sin(sh.t * 0.27)), 3);
        sh.g.position.set(wrap(sh.g.position.x + sh.vx * dt, EX), sh.baseY + lunge * 1.9, wrap(sh.g.position.z + weaveVz * dt, EZ));
        sh.g.rotation.set(0, -Math.atan2(weaveVz, sh.vx), 0);
        sh.g.rotateZ(Math.sin(sh.t * 0.5) * 0.06);
        sh.g.rotateX(lunge * 0.14);
      }
      // whale: a long majestic cycle — rises from the deep to show its back + a blowhole spout, then sounds (dives)
      for (const w of whales) {
        w.t += dt;
        const c = Math.sin(w.t * 0.11);
        const rise = c > 0 ? c : c * 0.12;
        w.g.position.set(wrap(w.g.position.x + w.vx * dt, EX), w.baseY + rise * 5.4, wrap(w.g.position.z + Math.sin(w.t * 0.08) * 1.5 * dt, EZ));
        w.g.rotation.set(0, -Math.atan2(0.0001, w.vx), 0);
        w.g.rotateZ(rise * 0.10);
        if (c > 0.86 && w.t - w.spoutAt > 5) { w.spoutAt = w.t; splash({ x: w.g.position.x, y: 0, z: w.g.position.z }); }
      }
      // manta: glides with its back at the surface banking its broad wings; periodic graceful breach lifts it clear
      for (const mt of mantas) {
        mt.t += dt;
        const weave = Math.sin(mt.t * 0.4);
        const breach = Math.pow(Math.max(0, Math.sin(mt.t * 0.33)), 2);
        mt.g.position.set(wrap(mt.g.position.x + mt.vx * dt, EX), mt.baseY + breach * 2.6, wrap(mt.g.position.z + (mt.vz + weave * 4) * dt, EZ));
        mt.g.rotation.set(0, -Math.atan2(mt.vz + weave * 4, mt.vx), 0);
        mt.g.rotateZ(Math.sin(mt.t * 0.8) * 0.28);
        mt.g.rotateX(-breach * 0.5);
        if (mt._wasUp && breach < 0.05) splash({ x: mt.g.position.x, y: 0, z: mt.g.position.z });
        mt._wasUp = breach > 0.5;
      }
    });
  }
  buildOceanLife();

  // ── Ship visuals ────────────────────────────────────────────────────────────
  // The five classes map to DISTINCT pirate-kit hulls so no two ships look alike —
  // and each NAMED ship (P-battleship, E-cruiser, …) is visually identifiable. We
  // derive the class from the ship id ("P-battleship" -> "battleship").
  const shipClass = (s) => (s && s.id ? String(s.id).replace(/^[PE]-/, "") : "");
  // class -> target on-water length (scene units); bigger class = bigger hull.
  const CLASS_LEN = { battleship: 26, cruiser: 23, destroyer: 19, frigate: 16, gunboat: 13 };
  const modelForShip = (s) => {
    const mm = content.ship_models || {};
    const cls = shipClass(s);
    if (mm[cls]) return mm[cls];                       // distinct hull per class (preferred)
    // legacy fallback: bigger hp => larger hull
    if (s.maxHp >= 100) return mm.large || mm.default;
    if (s.maxHp >= 80) return mm.medium || mm.default;
    return mm.small || mm.default;
  };
  const targetLenForShip = (s) => {
    const cls = shipClass(s);
    if (CLASS_LEN[cls] != null) return CLASS_LEN[cls];
    return s.maxHp >= 100 ? 22 : s.maxHp >= 80 ? 18 : 14;
  };
  // per-ship visual record { group, hull, ring, healthBar, sunk }
  const vis = {};
  const HULL_LEN = { large: 22, medium: 18, small: 14 }; // (legacy procedural fallback sizes)

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

    // Fit length to a target on-water size (long axis), uniform-ish scale. Bigger
    // CLASS -> bigger hull, so the 5 ships read apart by silhouette + size both.
    const box0 = new THREE.Box3().setFromObject(obj);
    const dim = box0.getSize(new THREE.Vector3());
    const targetLen = targetLenForShip(s);
    const longIsX = dim.x >= dim.z;
    const longDim = Math.max(dim.x, dim.z) || 1;
    const scale = targetLen / longDim;
    obj.scale.setScalar(scale);

    // Align the model's LONG axis to +X so yaw=heading points the BOW along travel.
    // The +Math.PI turns the hull around: these pirate hulls model their bow at the
    // -X end, so without it the ship drove stern-first ("boats face/drive backwards").
    const group = new THREE.Group();
    obj.rotation.y = (longIsX ? 0 : -Math.PI / 2) + Math.PI;
    obj.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(obj);
    const ctr = box1.getCenter(new THREE.Vector3());
    obj.position.set(-ctr.x, -box1.min.y, -ctr.z); // center on group origin, seat keel at y=0
    group.add(obj);

    // Side ID flag — a small pennant on a thin mast so player (teal) vs enemy (red)
    // reads instantly even on hulls of similar palette. No light, no shadow.
    const hullH = (box1.max.y - box1.min.y) || 4;
    const flagCol = s.side === "player" ? 0x37e0c0 : 0xff5a4a;
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8, metalness: 0.1 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, hullH * 0.95 + 4, 6), mastMat);
    mast.position.set(targetLen * 0.04, hullH + (hullH * 0.95 + 4) / 2 - 0.5, 0);
    mast.castShadow = false; mast.receiveShadow = false; group.add(mast);
    const flagMat = new THREE.MeshStandardMaterial({ color: flagCol, roughness: 0.6, metalness: 0, emissive: flagCol, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), flagMat);
    flag.position.set(targetLen * 0.04 - 1.35, hullH + (hullH * 0.95 + 4) - 1.4, 0);
    flag.castShadow = false; flag.receiveShadow = false; group.add(flag);

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
    const len = targetLenForShip(s);
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
      arcMesh.rotation.set(0, simHeadingToYaw(s.heading), 0); // local +X faces bow (now consistent with the hull)
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
    // FREEZE FIX (owner: "game freezes sometimes on firing cannon"): tryFire() gates all input on busy=true and only
    // clears it from THIS callback. If addPhysicsBody/tween ever threw, the impact callback never fired and the game
    // hung. Now onImpact is fired exactly ONCE — guaranteed by a safety timeout + a try/catch — so busy always clears.
    let fired = false;
    const fire = () => { if (fired) return; fired = true; clearTimeout(safety); try { onImpact(); } catch (e) {} };
    const safety = setTimeout(fire, 1400);   // hard guarantee: release within 1.4s no matter what stalled
    const from = muzzleFX(s) || (function () { const a = toScene(s.x, s.y); a.y = 2.5; return a; })();
    if (reducedMotion) { fire(); return; }
    let ball = null;
    try {
      ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x0c0c0c, metalness: 0.6, roughness: 0.4 }));
      ball.position.copy(from); ball.castShadow = true; scene.add(ball);
      const C = kernel.CANNON, T = 0.62;
      if (C && kernel.world) {
        const g = kernel.world.gravity.y;
        const vel = { x: (toVec.x - from.x) / T, y: (toVec.y - from.y) / T - 0.5 * g * T, z: (toVec.z - from.z) / T };
        kernel.addPhysicsBody({ mesh: ball, shape: new C.Sphere(0.55), mass: 3, position: from, velocity: vel, despawnAfter: T + 0.1, removeMesh: true });
        setTimeout(fire, T * 1000);
      } else {
        const peak = 14;
        kernel.tween({ target: ball.position, to: { x: toVec.x, z: toVec.z }, duration: 0.6,
          onUpdate: (e) => { ball.position.y = from.y + Math.sin(e * Math.PI) * peak; },
          onComplete: () => { try { scene.remove(ball); disposeMesh(ball); } catch (e) {} fire(); } });
      }
    } catch (e) { try { if (ball) scene.remove(ball); } catch (_) {} fire(); }   // physics/visual failure must NOT hang the turn
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
    // FREEZE-PROOF: guarantee done() fires exactly ONCE even if the glide tween never completes
    // (a throttled/hidden tab drops rAF frames, etc.). Without this, a stalled move tween hangs the
    // entire enemy turn — fireShell already does this; animateMove did not. Snaps to the final pose.
    const v = vis[s.id];
    let fin = false, safety = null;
    const finish = () => { if (fin) return; fin = true; if (safety) clearTimeout(safety);
      try { if (v) { const tt = toScene(s.x, s.y); v.group.position.set(tt.x, 0.2, tt.z); v.group.rotation.y = simHeadingToYaw(s.heading); } } catch (e) {}
      try { done && done(); } catch (e) {} };
    if (!v) { finish(); return; }
    const target = toScene(s.x, s.y);
    const targetYaw = simHeadingToYaw(s.heading);
    if (reducedMotion) { finish(); return; }
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
    safety = setTimeout(finish, dur * 1000 + 700);   // hard guarantee the move resolves even if the tween stalls
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
      onComplete: () => { finish(); },
    });
  }

  // ── HUD (DOM via kernel.hud; on-brand dusk/teal) ─────────────────────────────
  const CLASS_LABEL = { battleship: "Battleship", cruiser: "Cruiser", destroyer: "Destroyer", frigate: "Frigate", gunboat: "Gunboat" };
  const classOf = (s) => String(s.id || "").replace(/^[PE]-/, "");
  const classLabel = (s) => CLASS_LABEL[classOf(s)] || classOf(s) || "Ship";

  // class strength rank (for ordering strongest -> weakest) + a parametric ship
  // SILHOUETTE so each portrait card shows the actual hull class (bigger class =
  // bigger ship, more turrets), tinted by side.
  const CLASS_RANK = { battleship: 5, cruiser: 4, destroyer: 3, frigate: 2, gunboat: 1 };
  function shipSVG(s, col) {
    const rank = CLASS_RANK[classLabel(s).toLowerCase()] || 2;
    const turrets = rank >= 5 ? 3 : rank >= 3 ? 2 : 1;
    const W = 84, H = 30, hullW = 30 + rank * 9, x0 = (W - hullW) / 2;
    let t = "";
    for (let i = 0; i < turrets; i++) {
      const tx = x0 + hullW * (turrets === 1 ? 0.5 : 0.26 + 0.48 * (i / (turrets - 1)));
      t += `<rect x="${(tx - 2.5).toFixed(1)}" y="9" width="5" height="6" rx="1" fill="${col}"/>`;
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <polygon points="${x0},19 ${x0 + hullW},19 ${x0 + hullW - 6},26 ${x0 + 6},26" fill="${col}" opacity="0.92"/>
      <rect x="${(x0 + hullW * 0.36).toFixed(1)}" y="10" width="${(hullW * 0.26).toFixed(1)}" height="9" rx="1.5" fill="${col}" opacity="0.82"/>
      ${t}
      <line x1="${(x0 + hullW * 0.49).toFixed(1)}" y1="3" x2="${(x0 + hullW * 0.49).toFixed(1)}" y2="10" stroke="${col}" stroke-width="1.3"/>
    </svg>`;
  }
  // Fleet COLUMN of PORTRAIT cards (silhouette + class + HP + DEF badge), ordered
  // STRONGEST -> WEAKEST. Mine on the LEFT, enemy on the RIGHT. Sunk ships dim; the
  // selected ship glows; a defending ship gets a gold outline.
  function fleetColumn(side) {
    const teal = side === "player";
    const accent = teal ? "#37e0c0" : "#ff8a6a";
    const order = sim.ships.filter((s) => s.side === side).sort((a, b) => (b.maxHp - a.maxHp) || (CLASS_RANK[classLabel(b).toLowerCase()] || 0) - (CLASS_RANK[classLabel(a).toLowerCase()] || 0));
    return order.map((s) => {
      const frac = Math.max(0, s.hp / s.maxHp);
      const hpCol = s.sunk ? "#5a2030" : frac > 0.5 ? accent : frac > 0.25 ? "#ffd166" : "#ff5a5a";
      const isSel = !s.sunk && s.id === selectedId;
      const bd = isSel ? accent : (s.defending && !s.sunk ? "#7fc8ff" : (s.overwatch && !s.sunk ? "#ffd166" : "rgba(120,150,170,.26)"));   // shield=blue, overwatch=amber
      const bg = isSel ? "rgba(40,80,90,.55)" : "rgba(9,20,30,.66)";
      return `<div title="${s.id} · HP ${s.hp}/${s.maxHp} · range ${Math.round(s.gun.range)}" style="opacity:${s.sunk ? 0.32 : 1};width:94px;padding:5px 6px 6px;border:1px solid ${bd};border-radius:8px;background:${bg};${isSel ? "box-shadow:0 0 10px " + accent + "66;" : ""}">
        <div style="height:30px;display:flex;align-items:center;justify-content:center;${s.sunk ? "filter:grayscale(1)" : ""}">${shipSVG(s, s.sunk ? "#6a7480" : accent)}</div>
        <div style="font-size:10px;font-weight:700;color:${s.sunk ? "#8a93a0" : "#e7f1f6"};text-align:center;white-space:nowrap;${s.sunk ? "text-decoration:line-through;" : ""}">${classLabel(s)}</div>
        <div style="margin-top:3px;height:6px;border-radius:3px;background:#0b1722;overflow:hidden">
          <div style="height:6px;width:${Math.round(100 * (s.sunk ? 0 : frac))}%;background:${hpCol};${s.sunk ? "" : "box-shadow:0 0 5px " + hpCol}"></div></div>
        <div style="margin-top:2px;font-size:9px;text-align:center;color:#9fb0be">${s.sunk ? "SUNK" : "HP " + s.hp + "/" + s.maxHp}${s.defending && !s.sunk ? ' · <b style="color:#7fc8ff">🛡</b>' : (s.overwatch && !s.sunk ? ' · <b style="color:#ffd166">🎯</b>' : "")}</div>
      </div>`;
    }).join("");
  }

  function setHUD(banner) {
    if (!sim) return;
    const sel = selectedId ? sim.shipById(selectedId) : null;
    const yourTurn = sim.turn === "player";
    const alpHp = (side) => sim.shipsOf(side).reduce((a, s) => a + Math.max(0, s.hp), 0);
    const aliveCt = (side) => sim.shipsOf(side).length;
    // Big, unmistakable turn banner.
    const turnBanner = sim.ended ? ""
      : yourTurn
        ? `<span style="color:#06231c;background:linear-gradient(#7fffd4,#37e0c0);padding:3px 14px;border-radius:20px;font-weight:800;letter-spacing:1.5px;box-shadow:0 2px 12px rgba(55,224,192,.45)">YOUR TURN</span>`
        : `<span style="color:#2a0e0a;background:linear-gradient(#ffb199,#ff6a4d);padding:3px 14px;border-radius:20px;font-weight:800;letter-spacing:1.5px;box-shadow:0 2px 12px rgba(255,90,74,.4)">ENEMY TURN</span>`;
    // Selected-ship stat panel.
    const selInfo = sel && !sel.sunk
      ? `<div style="display:inline-block;margin-top:6px;padding:7px 14px;border:1px solid rgba(55,224,192,.5);border-radius:9px;background:rgba(8,24,30,.72);font-size:14px;text-align:left;min-width:300px">
           <div style="font-size:13px;font-weight:800;color:#9dffd0;letter-spacing:.4px">${sel.id} <span style="opacity:.8;font-weight:600">· ${classLabel(sel)}</span></div>
           <div style="margin-top:4px;display:flex;gap:14px;flex-wrap:wrap">
             <span>HP <b style="color:#cdeee2">${sel.hp}<span style="opacity:.6">/${sel.maxHp}</span></b></span>
             <span>Actions <b style="color:${sel.actionsLeft > 0 ? "#7fffd4" : "#ff8a6a"}">${sel.actionsLeft}</b><span style="opacity:.6">/${sim.actionsPerTurn}</span></span>
             <span>Range <b style="color:#ffd79a">${Math.round(sel.gun.range)}</b></span>
             <span>Speed <b style="color:#bcdcff">${Math.round(sel.speed)}</b></span>
           </div>
           ${sel.actionsLeft > 0 && yourTurn && !sel.defending && !sel.overwatch ? `<div style="margin-top:7px;display:flex;gap:8px"><button id="nf-defend" style="pointer-events:auto;font:800 13px 'Segoe UI',monospace;letter-spacing:.5px;padding:6px 14px;border-radius:7px;cursor:pointer;color:#06231c;background:linear-gradient(#9bdcff,#4db4ff);border:1px solid #7fc8ff;box-shadow:0 3px 12px rgba(77,180,255,.3)">🛡 DEFEND</button><button id="nf-overwatch" style="pointer-events:auto;font:800 13px 'Segoe UI',monospace;letter-spacing:.5px;padding:6px 14px;border-radius:7px;cursor:pointer;color:#1c1605;background:linear-gradient(#ffe08a,#ffc14d);border:1px solid #ffd166;box-shadow:0 3px 12px rgba(255,209,102,.3)">🎯 OVERWATCH</button></div>` : (sel.defending ? `<div style="margin-top:7px;font-size:13px;font-weight:800;color:#7fc8ff">🛡 DEFENDING — incoming fire halved</div>` : (sel.overwatch ? `<div style="margin-top:7px;font-size:13px;font-weight:800;color:#ffd166">🎯 OVERWATCH — fires on enemies entering arc</div>` : ""))}
         </div>`
      : (yourTurn && !sim.ended ? `<div style="display:inline-block;margin-top:6px;font-size:12px;opacity:.8;padding:6px 12px;border-radius:8px;background:rgba(8,24,30,.6)">Click one of your <span style="color:#37e0c0;font-weight:700">teal</span> ships to select it.</div>` : "");
    const endBtn = (yourTurn && !sim.ended)
      ? `<button id="nf-endturn" style="pointer-events:auto;display:block;margin:8px auto 0;font:800 13px 'Segoe UI',monospace;letter-spacing:1px;padding:8px 22px;border-radius:8px;cursor:pointer;color:#06231c;background:linear-gradient(#9dffb6,#3fd97f);border:1px solid #7CFC9A;box-shadow:0 4px 16px rgba(63,217,127,.35)">END TURN ▸</button>`
      : "";
    kernel.hud(`
      <div style="position:absolute;top:9px;left:0;right:0;text-align:center;text-shadow:0 2px 10px #000;font-family:'Segoe UI',system-ui,sans-serif">
        <div style="font-size:19px;font-weight:800;letter-spacing:2px">${content.title || "Tide Breakers"}</div>
        <div style="margin-top:4px;font-size:12px;font-weight:600">Turn ${sim.turnNumber} &nbsp; ${turnBanner}</div>
      </div>
      <div style="position:absolute;top:50px;left:10px;font-family:'Segoe UI',system-ui,sans-serif">
        <div style="font-size:11px;font-weight:800;color:#37e0c0;letter-spacing:1px;margin-bottom:5px;text-shadow:0 1px 4px #000">YOUR FLEET <span style="opacity:.6;font-weight:600">· ${aliveCt("player")} afloat</span></div>
        <div style="display:flex;flex-direction:column;gap:5px">${fleetColumn("player")}</div>
      </div>
      <div style="position:absolute;top:50px;right:10px;text-align:right;font-family:'Segoe UI',system-ui,sans-serif">
        <div style="font-size:11px;font-weight:800;color:#ff8a6a;letter-spacing:1px;margin-bottom:5px;text-shadow:0 1px 4px #000">ENEMY FLEET <span style="opacity:.6;font-weight:600">· ${aliveCt("enemy")} afloat</span></div>
        <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">${fleetColumn("enemy")}</div>
      </div>
      <div style="position:absolute;left:0;right:0;bottom:16px;text-align:center;font-family:'Segoe UI',system-ui,sans-serif;text-shadow:0 1px 6px #000">
        ${banner ? `<div style="font-size:14px;margin-bottom:2px;opacity:.95">${banner}</div>` : ""}
        ${selInfo}
        ${endBtn}
      </div>`);
    const eb = document.getElementById("nf-endturn");
    if (eb) eb.onclick = () => { if (!busy) endPlayerTurn(); };
    const db = document.getElementById("nf-defend");
    if (db) db.onclick = () => { if (!busy && sel) defendShip(sel); };
    const ob = document.getElementById("nf-overwatch");
    if (ob) ob.onclick = () => { if (!busy && sel) overwatchShip(sel); };
  }
  // DEFEND: raise a SHIELD — the ship braces, taking HALF damage from incoming fire this
  // round (no reaction fire). Spends its remaining actions (ends its turn). Clears when your
  // next turn begins.
  function defendShip(s) {
    if (!s || s.sunk || sim.turn !== "player" || s.actionsLeft <= 0) return;
    s.defending = true; s.overwatch = false; s.actionsLeft = 0;
    banner(`${s.id} braces — SHIELD UP (½ damage)`, 0x4db4ff, 900);
    autoSelectNextShip(); // advance to the next ready ship (or end turn if none)
    setHUD();
  }
  // OVERWATCH: hold position and fire a preemptive reaction shot at any enemy that moves into
  // this ship's range + arc + LOS during the enemy turn (no shield). Spends its actions.
  function overwatchShip(s) {
    if (!s || s.sunk || sim.turn !== "player" || s.actionsLeft <= 0) return;
    s.overwatch = true; s._reacted = false; s.actionsLeft = 0;
    banner(`${s.id} holds — OVERWATCH`, 0xffd166, 900);
    autoSelectNextShip();
    setHUD();
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
      triggerEnemyOverwatch(s, () => {   // an enemy on OVERWATCH may fire on the player moving into its arc
        busy = false;
        autoSelectNextShip(s.id); // keep this ship if it still has actions, else auto-advance
        maybeAutoEndPlayerTurn();
      });
    });
  }
  function tryFire(shooter, targetShip) {
    // Pre-check so we can explain misses without burning surprise.
    const chk = sim.canFireAt(shooter.id, targetShip.x, targetShip.y, targetShip.id);
    const r = sim.fireAt(shooter.id, targetShip.id);
    // Relay the AUTHORITATIVE rolled outcome (the remote applies it without re-rolling,
    // so dice can't desync online). Even a miss burns the action.
    if (netMode) myActions.push({ k: "f", id: shooter.id, tid: targetShip.id, res: { result: r.result, dmg: r.dmg, crit: r.crit, d20: r.d20, toHit: r.toHit, sunk: r.sunk } });
    busy = true; hideGizmos();
    kernel.playSound(sfx.fire, 0.25);
    const impact = toScene(targetShip.x, targetShip.y); impact.y = 2.0;
    fireShell(shooter, impact, () => {
      if (r.result === "hit" || r.result === "sink") {
        explosion(impact); kernel.playSound(sfx.hit, r.crit ? 0.7 : 0.5);
        updateHealthBar(sim.shipById(targetShip.id) || targetShip);
        resultFloat(impact, r);
        if (r.result === "sink") { kernel.playSound(sfx.sink, 0.6); sinkVisual(targetShip); }
      } else {
        splash(impact); kernel.playSound(sfx.miss || sfx.splash, 0.4);
        resultFloat(impact, r);   // shows "MISS" on a rolled miss
      }
      busy = false;
      if (sim.ended) { finishMatch(); return; }
      autoSelectNextShip(shooter.id); setHUD(shotBanner(r, chk));
      maybeAutoEndPlayerTurn();
    });
  }
  function shotBanner(r, chk) {
    const roll = r.d20 != null ? ` <span style="opacity:.7">(d20 ${r.d20} vs ${r.toHit})</span>` : "";
    if (r.result === "sink") return `<span style="color:#ffd166">${r.crit ? "CRITICAL hit — " : "Direct hit — "}enemy ${r.target} SUNK!</span>${roll}`;
    if (r.result === "hit" && r.crit) return `<span style="color:#ff7a4a">CRITICAL HIT — ${r.target} takes ${r.dmg}!</span>${roll}`;
    if (r.result === "hit") return `<span style="color:#9dffd0">Hit ${r.target} for ${r.dmg}.</span>${roll}`;
    if (r.result === "invalid") return `<span style="color:#ff8a6a">Shot failed: ${reasonText(r.reason)}.</span>`;
    if (r.result === "miss") return `<span style="color:#ff8a6a">Missed ${r.target}!</span>${roll}`;
    return `Splash — missed.`;
  }
  function reasonText(reason) {
    return ({ range: "target out of gun range", arc: "target outside firing arc — turn to bring guns to bear",
      los: "line of sight blocked by another hull", "no-actions": "no actions left this turn",
      "not-your-turn": "not your turn" })[reason] || reason || "invalid";
  }
  // Rising world-space label. `big` crits float higher + linger.
  function floatAt(pos, text, color, big) {
    const spr = makeFloatText(text, color);
    if (big) spr.scale.multiplyScalar(1.35);
    spr.position.set(pos.x, pos.y + 4, pos.z); scene.add(spr);
    const dur = big ? 1.4 : 1.0;
    kernel.tween({ target: spr.position, to: { y: pos.y + (big ? 15 : 12) }, duration: dur });
    kernel.tween({ target: spr.material, to: { opacity: 0 }, duration: dur, onComplete: () => { scene.remove(spr); disposeMesh(spr); } });
  }
  // Show the DICE outcome over the target: a CRIT! pops bright, a normal hit shows
  // the rolled damage, a rolled MISS shows "MISS". (Blocked/invalid shots: nothing.)
  function resultFloat(pos, r) {
    if (!r) return;
    if (r.result === "miss") { floatAt(pos, "MISS", "#8fb0c4"); return; }
    if (r.result === "hit" || r.result === "sink") {
      if (r.crit) floatAt(pos, "CRIT! -" + r.dmg, "#ff5a3c", true);
      else floatAt(pos, "-" + r.dmg, "#ffd166");
    }
  }
  function damageText(pos, dmg) { floatAt(pos, "-" + dmg, "#ffd166"); }
  function makeFloatText(text, color) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const ctx = c.getContext("2d"); ctx.font = "bold 44px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 5; ctx.strokeStyle = "rgba(4,10,18,0.9)"; ctx.strokeText(text, 64, 32);
    ctx.fillStyle = color || "#fff"; ctx.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(8, 4, 1); return spr;
  }
  // Transient on-screen BANNER for stance/overwatch callouts. MUST NEVER THROW — it runs inside the
  // enemy-turn playback chain, and an UNDEFINED `banner` (added in e6d8a5e but never defined) was the
  // ReferenceError that froze the whole enemy turn the instant a ship took a Guard/Overwatch stance.
  let _bannerEl = null, _bannerTimer = null;
  function banner(text, color, ms) {
    try {
      const col = (typeof color === "number") ? ("#" + (color >>> 0).toString(16).padStart(6, "0")) : (color || "#ffd166");
      if (!_bannerEl) {
        _bannerEl = document.createElement("div");
        _bannerEl.style.cssText = "position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:60;pointer-events:none;font:800 17px 'Segoe UI',monospace;letter-spacing:.4px;padding:7px 18px;border-radius:10px;background:rgba(8,20,28,.82);box-shadow:0 4px 18px rgba(0,0,0,.45);opacity:0;transition:opacity .16s";
        document.body.appendChild(_bannerEl);
      }
      _bannerEl.textContent = text; _bannerEl.style.color = col; _bannerEl.style.border = "1px solid " + col; _bannerEl.style.opacity = "1";
      clearTimeout(_bannerTimer);
      _bannerTimer = setTimeout(() => { if (_bannerEl) _bannerEl.style.opacity = "0"; }, ms || 850);
    } catch (e) {}
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
  // OVERWATCH: after an enemy ship moves, any DEFENDING player ship that now has it
  // in range + arc + LOS fires a preemptive reaction shot (no action cost). Each
  // defender reacts at most once per enemy turn. Reactions play out sequentially,
  // then `done()` continues the AI playback.
  function triggerOverwatch(enemyShip, done) {
    if (!enemyShip || enemyShip.sunk || sim.ended) { done(); return; }
    const defenders = sim.shipsOf("player").filter((d) => d.overwatch && !d.sunk && !d._reacted && sim.canFireAt(d.id, enemyShip.x, enemyShip.y, enemyShip.id).ok);
    if (!defenders.length) { done(); return; }
    let j = 0;
    (function fireNext() {
      if (j >= defenders.length || enemyShip.sunk || sim.ended) { done(); return; }
      const d = defenders[j++];
      d._reacted = true;
      const res = sim.reactionFire(d.id, enemyShip.id);
      if (!res || !res.ok) { fireNext(); return; }
      const impact = toScene(enemyShip.x, enemyShip.y); impact.y = 2.0;
      banner(`${d.id} OVERWATCH!`, 0xffd166, 800);
      try { kernel.playSound(sfx.fire, 0.21); } catch (e) {}
      fireShell(d, impact, () => {
        if (res.result === "miss") {
          splash(impact); try { kernel.playSound(sfx.miss || sfx.splash, 0.4); } catch (e) {}
          resultFloat(impact, res);
        } else {
          explosion(impact); try { kernel.playSound(sfx.hit, res.crit ? 0.7 : 0.5); } catch (e) {}
          updateHealthBar(enemyShip); resultFloat(impact, res);
          if (res.result === "sink") { try { kernel.playSound(sfx.sink, 0.6); } catch (e) {} sinkVisual(enemyShip); }
        }
        setHUD();
        if (sim.ended) { busy = false; finishMatch(); return; }
        setTimeout(fireNext, 220);
      });
    })();
  }
  // ENEMY OVERWATCH (mirror): after the PLAYER ship moves, any enemy that is on OVERWATCH and now has it in
  // range+arc+LOS fires a preemptive reaction shot (no action cost), once per player turn. (owner: "enemy can do the same")
  function triggerEnemyOverwatch(playerShip, done) {
    if (!playerShip || playerShip.sunk || sim.ended) { done(); return; }
    const watchers = sim.shipsOf("enemy").filter((d) => d.overwatch && !d.sunk && !d._reacted && sim.canFireAt(d.id, playerShip.x, playerShip.y, playerShip.id).ok);
    if (!watchers.length) { done(); return; }
    let j = 0;
    (function fireNext() {
      if (j >= watchers.length || playerShip.sunk || sim.ended) { done(); return; }
      const d = watchers[j++]; d._reacted = true;
      const res = sim.reactionFire(d.id, playerShip.id);
      if (!res || !res.ok) { fireNext(); return; }
      const impact = toScene(playerShip.x, playerShip.y); impact.y = 2.0;
      banner(`${d.id} OVERWATCH!`, 0xffd166, 800);
      try { kernel.playSound(sfx.fire, 0.21); } catch (e) {}
      fireShell(d, impact, () => {
        if (res.result === "miss") {
          splash(impact); try { kernel.playSound(sfx.miss || sfx.splash, 0.4); } catch (e) {}
          resultFloat(impact, res);
        } else {
          explosion(impact); try { kernel.playSound(sfx.hit, res.crit ? 0.7 : 0.5); } catch (e) {}
          updateHealthBar(playerShip); resultFloat(impact, res);
          if (res.result === "sink") { try { kernel.playSound(sfx.sink, 0.6); } catch (e) {} sinkVisual(playerShip); }
        }
        setHUD();
        if (sim.ended) { busy = false; finishMatch(); return; }
        setTimeout(fireNext, 220);
      });
    })();
  }
  // End-of-enemy-turn covering fire: each DEFENDING ship that hasn't reacted yet
  // fires once at the NEAREST enemy still in its range + arc + LOS. Guarantees Defend
  // pays off whenever a target sits in the watched zone (not only on a move into it).
  function coveringFire(done) {
    const defenders = sim.shipsOf("player").filter((d) => d.overwatch && !d.sunk && !d._reacted);
    let j = 0;
    (function next() {
      if (j >= defenders.length || sim.ended) { done(); return; }
      const d = defenders[j++];
      const targets = sim.shipsOf("enemy").filter((e) => !e.sunk && sim.canFireAt(d.id, e.x, e.y, e.id).ok);
      if (!targets.length) { next(); return; }
      targets.sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y));
      const tgt = targets[0];
      d._reacted = true;
      const res = sim.reactionFire(d.id, tgt.id);
      if (!res || !res.ok) { next(); return; }
      const impact = toScene(tgt.x, tgt.y); impact.y = 2.0;
      banner(`${d.id} OVERWATCH!`, 0xffd166, 800);
      try { kernel.playSound(sfx.fire, 0.21); } catch (e) {}
      fireShell(d, impact, () => {
        if (res.result === "miss") {
          splash(impact); try { kernel.playSound(sfx.miss || sfx.splash, 0.4); } catch (e) {}
          resultFloat(impact, res);
        } else {
          explosion(impact); try { kernel.playSound(sfx.hit, res.crit ? 0.7 : 0.5); } catch (e) {}
          updateHealthBar(tgt); resultFloat(impact, res);
          if (res.result === "sink") { try { kernel.playSound(sfx.sink, 0.6); } catch (e) {} sinkVisual(tgt); }
        }
        setHUD();
        if (sim.ended) { busy = false; finishMatch(); return; }
        setTimeout(next, 220);
      });
    })();
  }
  // Play the AI's planned actions VISIBLY, one at a time, with animation.
  function runAITurn() {
    let acts = [];
    try { acts = sim.aiPlan() || []; } catch (e) { console.warn("[tide] aiPlan threw — ending enemy turn safely", e); acts = []; } // resolves the whole enemy turn in the sim
    let i = 0;
    function step() {
      if (i >= acts.length) {
        // enemy turn done
        if (sim.ended) { busy = false; finishMatch(); return; }
        // END-OF-TURN OVERWATCH: any DEFENDING ship that didn't already react fires on
        // an enemy still sitting in its range+arc+LOS — so Defend reliably does
        // something even when enemies kited/fired from range instead of charging in.
        coveringFire(() => {
          if (sim.ended) { busy = false; finishMatch(); return; }
          sim.endTurn(); // -> player
          busy = false;
          setHUD(`<span style="color:#37e0c0">Your move.</span>`);
          autoSelectNextShip(); // auto-pick the first ready ship for the new turn
        });
        return;
      }
      try {
      const a = acts[i++];
      const s = sim.shipById(a.id);
      if (!s || s.sunk) { step(); return; } // a defender's overwatch may have sunk it mid-turn
      if (a.kind === "move") {
        // The sim already moved the ship; animate the visual to its NEW pose, THEN let
        // any DEFENDING player ship that now has it in range/arc take a reaction shot.
        animateMove(s, () => triggerOverwatch(s, () => setTimeout(step, 180)));
      } else if (a.kind === "fire") {
        const tgt = sim.shipById(a.target);
        const impact = tgt ? toScene(tgt.x, tgt.y) : toScene(s.x, s.y); impact.y = 2.0;
        kernel.playSound(sfx.fire, 0.225);
        fireShell(s, impact, () => {
          const res = a.result || {};
          if (res.result === "hit" || res.result === "sink") {
            explosion(impact); kernel.playSound(sfx.hit, res.crit ? 0.7 : 0.5);
            if (tgt) updateHealthBar(tgt);
            resultFloat(impact, res);
            if (res.result === "sink" && tgt) { kernel.playSound(sfx.sink, 0.6); sinkVisual(tgt); }
          } else { splash(impact); kernel.playSound(sfx.miss || sfx.splash, 0.4); resultFloat(impact, res); }
          setHUD(res.crit ? `<span style="color:#ff7a4a">Enemy ${s.id} CRITS for ${res.dmg}!</span>`
                          : res.result === "miss" ? `<span style="color:#9dffd0">Enemy ${s.id} missed.</span>`
                          : `<span style="color:#ff8a6a">Enemy ${s.id} fires…</span>`);
          if (sim.ended) { busy = false; finishMatch(); return; }
          setTimeout(step, 240);
        });
      } else if (a.kind === "defend" || a.kind === "overwatch") {   // enemy GUARD / OVERWATCH stance (sim already set the flag; show it)
        const guard = a.kind === "defend";
        banner(`${s.id} ${guard ? "braces — SHIELD UP" : "holds — OVERWATCH"}`, guard ? 0x4db4ff : 0xffd166, 850);
        setHUD(`<span style="color:#ff8a6a">Enemy ${s.id} ${guard ? "shields" : "watches"}…</span>`);
        setTimeout(step, 300);
      } else { step(); }
      } catch (e) { console.warn("[tide] AI step threw — advancing safely", e); setTimeout(step, 60); }
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
    if (netMode && online) { try { online.finish(); } catch (e) {} try { reportOnlineResult(win); } catch (e) {} }
  }

  // ── ranking glue (W/L + Elo, online vs logged-in players only) ──────────────
  async function loadRatings() {
    if (!_ratings) _ratings = await import("../net/ffg_ratings.js" + new URL(import.meta.url).search);
    return _ratings;
  }
  async function setupRatingHandshake(isHost) {
    myProfile = null; oppProfile = null; matchNonce = isHost ? Math.random().toString(36).slice(2, 10) : null;
    try {
      const R = await loadRatings();
      myProfile = await R.currentPlayer();
      if (online) online.sendRaw("hello", { id: myProfile ? myProfile.id : null, name: myProfile ? myProfile.username : null, nonce: matchNonce });
      if (myProfile) { const r = await R.getRating(myProfile.id, "tide-breakers"); const tier = R.rankTier(r.rating);
        _rankLine = `${myProfile.username} · ${r.rating} ${tier.name} · ${r.wins}W-${r.losses}L`; }
      else { _rankLine = "Playing unrated — sign in on the site to rank up"; }
      if (_lastStatus) onlineStatus(_lastStatus);
    } catch (e) {}
  }
  function reportOnlineResult(iWon) {
    if (!netMode || !myProfile || !oppProfile || !matchNonce || !online) return;
    const room = online.net ? online.net.room : "r";
    const matchId = "tide-breakers:" + room + ":" + matchNonce;
    const result = online.isHost ? (iWon ? "white" : "black") : (iWon ? "black" : "white");
    const whiteId = online.isHost ? myProfile.id : oppProfile.id;
    const blackId = online.isHost ? oppProfile.id : myProfile.id;
    loadRatings().then((R) => R.reportResult("tide-breakers", whiteId, blackId, result, matchId).then((res) => {
      if (!res) return;
      const mine = online.isHost ? res.white : res.black;
      const after = mine && mine.after != null ? mine.after : null;
      const delta = mine && mine.delta != null ? mine.delta : (after != null && mine.before != null ? after - mine.before : 0);
      if (after != null) { const tier = R.rankTier(after);
        setHUD(`<span style="color:${delta >= 0 ? "#7CFC9A" : "#ff8a6a"}">${delta >= 0 ? "+" : ""}${delta} → ${after} (${tier.name})</span>`); }
    }));
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
        // Apply the shooter's RELAYED roll (no re-roll -> dice stay in sync online).
        const r = sim.applyFireResult(sid, tid, a.res);
        if (shooter && target) {
          const impact = toScene(target.x, target.y); impact.y = 2.0;
          kernel.playSound(sfx.fire, 0.25);
          await new Promise((res) => fireShell(shooter, impact, () => {
            if (r.result === "hit" || r.result === "sink") {
              explosion(impact); kernel.playSound(sfx.hit, r.crit ? 0.7 : 0.5);
              updateHealthBar(sim.shipById(tid) || target); resultFloat(impact, r);
              if (r.result === "sink") { kernel.playSound(sfx.sink, 0.6); sinkVisual(target); }
            } else { splash(impact); kernel.playSound(sfx.miss || sfx.splash, 0.4); resultFloat(impact, r); }
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
    _onlineHud.style.display = "block"; _lastStatus = o;
    const col = o.myTurn ? "#37e0c0" : "#ff8a6a";
    const clock = o.secsLeft != null ? ` · ⏱ ${o.secsLeft}s` : "";
    const rank = _rankLine ? `<div style="font-size:11px;opacity:.8;margin-top:3px;color:#bcd">${_rankLine}</div>` : "";
    _onlineHud.innerHTML = `<div style="display:inline-block;background:rgba(8,16,26,.78);border:1px solid ${col};border-radius:9px;padding:6px 16px;color:${col};font-size:14px;font-weight:700;letter-spacing:1px">${o.banner || ""}${clock}${rank}</div>`;
  }

  function buildOnlineIface() {
    return {
      parent: kernel.parent,
      gameId: "tide-breakers",
      onLobbyOpen: () => {},
      onLobbyBack: () => { netMode = false; phase = "menu"; onlineStatus(null); if (window.FFG && window.FFG.shell) window.FFG.shell.start(); },
      onPeerMessage: (t, d) => { if (t === "hello" && d) { oppProfile = d.id ? { id: d.id, username: d.name || "Opponent" } : null; if (d.nonce && !matchNonce) matchNonce = d.nonce; } },
      startGame: (isHost) => {
        netMode = true; netFirstSide = isHost ? "player" : "enemy"; myActions = [];
        onlineStatus({ myTurn: isHost, banner: isHost ? "You move first" : "Opponent moves first", secsLeft: null });
        beginGame(content.difficulty || "normal");
        setupRatingHandshake(isHost);
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
    // Difficulty buffs the ENEMY fleet only (player untouched). Tuned UP after the
    // owner found the NPC "playing weak" on medium: NORMAL now gets a real edge,
    // HARD gets a bigger range/dmg/hp edge AND an extra action per ship per turn
    // (more salvos/maneuvers) plus a smarter AI persona. Online play is always
    // unbuffed (both sides run the identical deterministic sim).
    // Tuning note: combat is swingy + the PLAYER always acts first, so an unbuffed
    // enemy (even with the smart AI) loses the opening exchange. The smart AI is the
    // QUALITATIVE upgrade (focus-fire, kiting, threat targeting — vs the old passive
    // "close & plink nearest"); a MODEST stat edge then makes it a genuine threat.
    // HARD additionally gets an extra action/turn (more salvos) + the "hard" AI
    // persona. Buffs were kept moderate so HARD is a real fight, not a 4-turn stomp.
    let enemyActionsBonus = 0, aiSkill = "normal";
    if (!netMode) {
      if (diff === "hard") {
        fleet.forEach((s) => { if (s.side === "enemy") { s.gun.range = Math.round(s.gun.range * 1.12); s.gun.dmg = Math.round(s.gun.dmg * 1.18); s.hp = Math.round(s.hp * 1.15); s.maxHp = s.hp; s.speed = Math.round(s.speed * 1.05); s.turnRate = s.turnRate * 1.05; } });
        enemyActionsBonus = 1; aiSkill = "hard";
      } else if (diff === "easy") {
        fleet.forEach((s) => { if (s.side === "enemy") { s.gun.range = Math.round(s.gun.range * 0.9); s.gun.dmg = Math.round(s.gun.dmg * 0.8); } });
        aiSkill = "easy";
      } else { // normal / MEDIUM — EVEN: enemy stats are IDENTICAL to the player (owner: "on medium it should be even, all the same"). The smart AI (focus-fire/kiting) is the ONLY edge; no stat buff.
        aiSkill = "normal";
      }
    }

    sim = new NavalFree({ width: ARENA_W, height: ARENA_H, seed: _gameSeed, firstSide: netMode ? netFirstSide : "player", actionsPerTurn: m.actionsPerTurn || 2, enemyActionsBonus, aiSkill, ships: fleet });
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
    // Launcher deep-link. ?mode=ai -> SHOW THE MENU (so the difficulty picker + music
    // appear; the PLAY gesture is what lets audio play). ?mode=online opens the vs-People
    // flow. (Auto-starting on ?mode=ai skipped the menu — the _play.html launch bug.)
    try {
      const _m = new URLSearchParams(location.search).get("mode");
      if (_m === "online") { shell.hide(); shell.phase = "playing"; startOnline(); }
      // _m === "ai" (or none): leave the menu up; PLAY starts the vs-Computer match.
    } catch (e) { /* deep-link is optional — never block boot */ }
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
      // play a FRESH battle out to a resolution — BOTH fleets driven by the smart
      // sim AI (aiPlanSide) so the feel-gate certifies tide reaches an end state.
      // Pure sim — never touches the live battle. Guaranteed terminating: each side
      // either acts (consuming actions) or the per-ship guard / turn cap stops it.
      autoResolve: () => {
        try {
          const g = new NavalFree({ width: ARENA_W, height: ARENA_H, seed: _gameSeed, firstSide: "player", actionsPerTurn: (m.actionsPerTurn || 2), aiSkill: "normal", ships: NavalFree.defaultFleet(ARENA_W, ARENA_H) });
          let turns = 0;
          while (!g.ended && turns++ < 120) {
            g.aiPlanSide(g.turn);   // smart planner drives whichever side is active
            if (!g.ended) g.endTurn();
          }
          return { ended: !!g.ended, victory: g.winner === "player", winner: g.winner || null, turns: g.turnNumber };
        } catch (e) { return { ended: false, err: String(e) }; }
      },
    },
  };
  return controller;
});
