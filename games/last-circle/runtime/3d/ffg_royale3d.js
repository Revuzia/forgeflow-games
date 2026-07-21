/**
 * FFG runtime — 3d/ffg_royale3d.js  (Last Circle)
 * Genre "royale": 50-player third-person battle royale shooter.
 *
 * This is the ORCHESTRATOR. All rules live in ../sim/royale.js (deterministic,
 * node-tested); rendering + input + AI live in ./royale/* submodules. This file
 * wires them into the shared world object `W` and owns the frame pipeline:
 *
 *   menu → lobby → drop → match loop → victory/defeat → stats → menu
 *
 * Frame order (update): input/brains → movement+physics → weapons/projectiles
 * → loot → storm → fx → hud. Bots emit the SAME input struct the
 * human's keyboard/mouse produces and run through the same movement/weapon
 * code — "bots are players" is structural, not simulated.
 *
 * Debug hook: window.__LC__ (world, fastForward, state).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
// IMPORTANT: import the kernel WITH the same ?v= query as the boot module —
// a bare "./ffg_kernel_3d.js" would be a SECOND module instance with its own
// (empty) genre registry, and boot3d would never see "royale" registered.
const { register3d } = await import("./ffg_kernel_3d.js" + V);
const [{ MAPS, buildMap, disposeMapResources }, playerMod, weaponsMod, lootMod, stormMod, botsMod, hudMod, audioMod, fxMod, netMod] =
  await Promise.all([
    import("./royale/maps.js" + V),
    import("./royale/player.js" + V),
    import("./royale/weapons.js" + V),
    import("./royale/loot.js" + V),
    import("./royale/storm.js" + V),
    import("./royale/bots.js" + V),
    import("./royale/hud.js" + V),
    import("./royale/audio.js" + V),
    import("./royale/fx.js" + V),
    import("./royale/net.js" + V),
  ]);
// sim/royale.js is a universal script (not an ES module) — load it once via
// a classic <script> tag so it lands on window.FFG.sim.Royale.
await new Promise((res, rej) => {
  if (window.FFG && window.FFG.sim && window.FFG.sim.Royale) return res();
  const s = document.createElement("script");
  s.src = new URL("../sim/royale.js" + V, import.meta.url).href;
  s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});
const SIM = window.FFG.sim.Royale;

register3d("royale", async function (kernel, content) {
  const setup = content.setup || {};

  // ── shared world ────────────────────────────────────────────────────────────
  const W = {
    THREE, kernel, content, SIM,
    scene: kernel.scene, camera: kernel.camera,
    assetBase: new URL("../../", import.meta.url).href, // game dir root
    // match config (set by menu)
    mapId: setup.defaultMap || "isla_viva",
    mode: setup.defaultMode || "standard",
    seed: (content.seed || 1) >>> 0,
    // live state
    phase: "menu",           // menu | lobby | drop | match | over
    t: 0,                    // match seconds
    actors: [], actorById: new Map(),
    player: null,
    map: null,               // built map: heightAt, pois, colliders, harvestables...
    loot: null, stormCtl: null, match: null,
    rng: SIM.mulberry32((content.seed || 1) >>> 0),
    events: mkEmitter(),
    settings: loadSettings(),
    net: null,               // multiplayer session (null = offline)
    stats: { shotsFired: 0, shotsHit: 0 },
    paused: false,
    _groups: {},             // scene groups per system
  };
  W.group = (name) => {
    if (!W._groups[name]) { const g = new THREE.Group(); g.name = name; W.scene.add(g); W._groups[name] = g; }
    return W._groups[name];
  };

  // module init (order matters: audio/fx/hud first — others emit into them)
  audioMod.init(W);
  fxMod.init(W);
  hudMod.init(W);
  playerMod.init(W);
  weaponsMod.init(W);
  lootMod.init(W);
  stormMod.init(W);
  botsMod.init(W);
  netMod.init(W);

  // ── unified graphics authority ──────────────────────────────────────────────
  // ONE place owns visual fidelity so the shell-kernel key (ffg_settings.quality)
  // and the LC key (lc_settings.graphics) can never diverge again. Applied at BOOT
  // (the previous LC "high" only took effect if you re-opened Settings and re-clicked)
  // and drives REAL fidelity per tier — DPR, shadow on/off, shadow-map resolution,
  // and texture anisotropy — not just supersampling. maps.js reads W._texAniso when
  // it builds the terrain/structure/water textures.
  W._texAniso = 4;
  W.applyGraphics = function (tier) {
    tier = tier || W.settings.graphics || "medium";
    const r = kernel.renderer;
    const DPR = { low: 1, medium: 1.5, high: 2 };
    const SHADOW = { low: 0, medium: 2048, high: 4096 };
    const ANISO = { low: 1, medium: 4, high: 8 };
    const BLOOM = { low: 0, medium: 0.14, high: 0.14 };
    const maxA = (r.capabilities && r.capabilities.getMaxAnisotropy) ? r.capabilities.getMaxAnisotropy() : 8;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR[tier] || 1.5));
    const shadows = tier !== "low";
    r.shadowMap.enabled = shadows;
    // Shadow VOLUME lives here rather than in the vendored kernel literal, which
    // hard-codes a +/-80 m box (160 m) around world origin on a 1600 m map — about
    // 1% of the playable area had shadows at all, and the depth pass ran every
    // frame regardless. Tighter extents + a volume that FOLLOWS the player (see
    // the frame pipeline) means medium now looks better than high used to.
    const SHADOW_EXT = { low: 55, medium: 55, high: 70 };
    if (shadows && kernel.sun) {
      const ext = SHADOW_EXT[tier] || 55;
      const sc = kernel.sun.shadow.camera;
      if (sc.right !== ext) {
        sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
        // far was 400, and Isla Viva's high ground already eats ~338 m of that
        // when you stand on it — one hill short of the whole depth pass going
        // dark. 600 leaves real headroom for the ground-anchored focus below.
        sc.near = 1; sc.far = 600;
        sc.updateProjectionMatrix();
      }
      // acne/peter-panning control — neither was ever set
      kernel.sun.shadow.bias = -0.0004;
      kernel.sun.shadow.normalBias = 0.02;
      W._shadowExt = ext;
      if (!kernel.sun.target.parent) W.scene.add(kernel.sun.target);
      const sz = SHADOW[tier] || 2048;
      if (kernel.sun.shadow.mapSize.x !== sz) {
        kernel.sun.shadow.mapSize.set(sz, sz);
        if (kernel.sun.shadow.map) { kernel.sun.shadow.map.dispose(); kernel.sun.shadow.map = null; }
      }
    }
    r.shadowMap.needsUpdate = true;
    W._texAniso = Math.min(ANISO[tier] || 4, maxA);
    // push anisotropy onto already-built textures + refresh materials
    W.scene.traverse((o) => {
      const m = o.material; if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      for (const mm of mats) for (const slot of ["map", "normalMap", "roughnessMap", "emissiveMap"]) if (mm[slot]) { mm[slot].anisotropy = W._texAniso; mm[slot].needsUpdate = true; }
    });
    // Bloom was the one fidelity knob the tier tables never touched: "low"
    // disabled shadows and dropped DPR to 1 but still paid for the full
    // UnrealBloomPass blur chain every frame, even though maps.js turns match
    // bloom down to 0.14 where it is nearly invisible. EffectComposer skips a
    // pass whose `enabled` is false, so the composer stays allocated and
    // medium/high keep the menu's 0.45-strength storm-ring glow. kernel.bloom
    // only exists once the menu world has called enableBloom, hence the guard —
    // the BOOT-time applyGraphics() below runs before that, and the per-match
    // re-apply in _startMatch is what actually lands the low tier's setting.
    if (kernel.bloom) kernel.bloom.enabled = (BLOOM[tier] || 0) > 0;
    // keep the kernel's own quality key in sync (shell buttons + next boot)
    try { const s = JSON.parse(localStorage.getItem("ffg_settings") || "{}"); s.quality = tier === "medium" ? "med" : tier; localStorage.setItem("ffg_settings", JSON.stringify(s)); } catch (e) {}
  };
  W.applyGraphics();          // BOOT-apply the stored tier (the fix)

  // Snapshot the kernel's DEFAULT match lighting now, before the cinematic menu
  // (buildMenuWorld) warms the sun to golden-hour + raises exposure. buildMap
  // restores these each match so every map shows its own daylight, not menu light.
  W._lightDefaults = {
    sunIntensity: kernel.sun.intensity,
    sunColor: kernel.sun.color.getHex(),
    sunPos: kernel.sun.position.clone(),
    exposure: kernel.renderer.toneMappingExposure,
  };

  // ── shadow volume follows the player ────────────────────────────────────────
  // The kernel points its sun at (0,0,0) and nothing ever moved the target, so
  // the shadow box sat over world origin for the whole match. Keep the same sun
  // DIRECTION (offset captured per match, since buildMap re-aims the sun for
  // each map's daylight) and slide the volume with the camera focus. The centre
  // is snapped to whole shadow-texel steps or the map shimmers as you walk.
  const _sunFocus = new THREE.Vector3();
  function followShadow() {
    const sun = kernel.sun;
    if (!sun || !sun.castShadow || !W._sunOff) return;
    const f = W._camFocus || W.player;
    if (!f) return;
    const ext = W._shadowExt || 55;
    const texels = (sun.shadow.mapSize && sun.shadow.mapSize.x) || 2048;
    const step = (ext * 2) / texels;
    // Anchor the volume's HEIGHT to the terrain under the focus, not to the
    // focus itself. The glider drop starts at 240-270 m, and the sun offset is
    // only ~169 m long, so following the player's raw Y lifted the whole shadow
    // camera above the world and the entire descent — the part of the match you
    // spend looking straight down at the map — rendered with no shadows at all.
    const gy = W.map && W.map.groundAt ? W.map.groundAt(f.pos.x, f.pos.z) : 0;
    _sunFocus.set(Math.round(f.pos.x / step) * step, Math.min(f.pos.y, gy + 8), Math.round(f.pos.z / step) * step);
    sun.target.position.copy(_sunFocus);
    sun.target.updateMatrixWorld();
    sun.position.copy(_sunFocus).add(W._sunOff);
  }

  // ── match lifecycle ─────────────────────────────────────────────────────────
  async function startMatch(opts) {
    // re-entrancy guard: this function clears the world and then awaits (map
    // build, model load). A second call landing inside those awaits clears
    // nothing the first one has yet to add, so the two interleave and the
    // match ends up with two full rosters of actors. Double-fire is reachable
    // from a fast double-click on PLAY / PLAY AGAIN.
    if (W._starting) return;
    W._starting = true;
    try {
      return await _startMatch(opts || {});
    } finally { W._starting = false; }
  }
  async function _startMatch(opts) {
    opts = opts || {};
    W.mapId = opts.mapId || W.mapId;
    W.mode = opts.mode || W.mode;
    W.seed = opts.seed != null ? opts.seed : ((Math.random() * 0xffffffff) >>> 0);
    W.rng = SIM.mulberry32(W.seed);
    W.t = 0;
    W.phase = "lobby";
    W.paused = false;
    W.stats = { shotsFired: 0, shotsHit: 0 };

    // clear previous world.
    // DISPOSE BEFORE DROPPING THE ROSTER: every actor registers an
    // AnimationMixer with the kernel, and the kernel only ever removes one on an
    // explicit disposeMixer. Clearing the group detaches the meshes but leaves
    // the mixers in the per-frame update list, so each match played added ~50
    // more skeletons to tick — frame time degraded monotonically, match over
    // match, with no in-game recovery. Nametags are per-actor CanvasTextures
    // and leak the same way.
    for (const a of W.actors) {
      if (a.rig && a.rig.mixer && kernel.disposeMixer) kernel.disposeMixer(a.rig.mixer);
      const tag = a.nameTag;
      if (tag && tag.material) {
        if (tag.material.map) tag.material.map.dispose();
        tag.material.dispose();
      }
    }
    // free the PREVIOUS map's GPU resources before detaching them (clear() only
    // unparents — geometries, materials and per-match textures stayed resident)
    W._lastMapDispose = disposeMapResources(W);
    for (const name in W._groups) { const g = W._groups[name]; g.clear(); }
    W.actors.length = 0; W.actorById.clear();
    W.rangeDummies = null;          // stale refs into the cleared roster
    botsMod.resetBrains();
    weaponsMod.reset(W);            // live rounds otherwise fly on into the next match
    fxMod.reset();                  // damage numbers are DOM nodes; they outlive the match
    if (W.resetInputState) W.resetInputState();

    // build the world
    hudMod.showLoading(W, "Building " + (MAPS[W.mapId] ? MAPS[W.mapId].name : W.mapId) + "…");
    await nextFrame(); // let the loading screen paint
    W.map = await buildMap(W, W.mapId);
    // buildMap re-aims the sun per map. Reset the TARGET to origin first: this
    // subtracted `sun.target.position`, which followShadow had parked at the
    // previous match's player location — a median ~178 m from origin. So from
    // match 2 onward every map was lit from a low raking angle in a random
    // compass direction instead of its intended near-noon key, and when that
    // stale focus exceeded the shadow camera's far plane the match rendered
    // with no shadows at all. Only correct on the first match of a session.
    kernel.sun.target.position.set(0, 0, 0);
    kernel.sun.target.updateMatrixWorld();
    W._sunOff = kernel.sun.position.clone();

    const modeK = SIM.MODE[W.mode] || SIM.MODE.standard;
    W.match = new SIM.Match({ players: modeK.players, mode: W.mode });
    W.stormCtl = stormMod.createStorm(W);
    lootMod.populate(W);

    // actors: slot-based ids s0..s49 — online play maps humans onto slots
    // (each joining friend takes over a bot slot; disconnect re-attaches a brain)
    const total = W.mode === "practice" ? 1 : modeK.players;
    const names = shuffledNames(W);
    const humans = opts.humans || [{ slot: 0, name: W.settings.playerName || "You", self: true }];
    for (let i = 0; i < total; i++) {
      const hu = humans.find((x) => x.slot === i);
      if (hu) {
        const a = playerMod.createActor(W, { id: "s" + i, name: hu.name, isBot: false });
        a.netRemote = !hu.self;
        if (hu.self) W.player = a;
      } else {
        const bot = playerMod.createActor(W, { id: "s" + i, name: names[i % names.length], isBot: true });
        // bots simulate on the authority only; on guest clients they're remote
        if (opts.guestOf) bot.netRemote = true;
        else botsMod.attachBrain(W, bot);
      }
      W.match.register("s" + i);
    }
    // practice range dummies must exist BEFORE models load or they get no rig
    if (W.mode === "practice") playerMod.createPracticeRange(W);
    await playerMod.loadActorModels(W);
    // Re-apply the tier now that the map's textures and the actor GLBs are in
    // the scene. applyGraphics only ever ran at BOOT and on a Settings click, and
    // its anisotropy pass is a one-shot traverse of whatever is in the scene at
    // that moment — so every character and prop texture loaded afterwards kept
    // the GLTFLoader default of 1, and "high" only ever sharpened the terrain.
    // The kernel caches by URL and clones share texture objects, so one traverse
    // here fixes every present and future clone of those assets.
    W.applyGraphics(W.settings.graphics);

    playerMod.spawnAll(W);          // positions actors (glider line or ground by mode)
    if (W.mode === "practice") playerMod.placePracticeRange(W);  // ...then line the range up
    botsMod.assignDrops(W);
    hudMod.showLobby(W, () => {     // lobby → drop select → drop
      const begin = () => {
        W.phase = W.mode === "practice" ? "match" : "drop";
        hudMod.showHUD(W);
        audioMod.startMatchMusic(W);
        if (W.net) netMod.onMatchStart(W);
      };
      // glider modes get the landing-zone map; it auto-locks on a fixed timer
      // so online clients leave the screen together
      if (modeK.drop === "glider" && W.mode !== "practice") {
        hudMod.showDropSelect(W, (t) => { playerMod.setDropTarget(W, t); begin(); });
      } else { W.dropTarget = null; begin(); }   // ground modes: no LZ marker
    });
  }

  function endMatch(victory) {
    if (W.phase === "over") return;
    W.phase = "over";
    const placement = W.match.placementOf(W.player.id) || W.match.aliveCount() + 1;
    // Hold the live world for a beat first. showPostMatch calls hideHUD(), which
    // removes the layer the announcement lives in — so the banner and kill feed
    // for the WINNING kill were created and destroyed in the same frame and the
    // match cut straight from a firefight to a DOM panel. Phase "over" is
    // already whitelisted in the frame gate and already blocks all damage.
    hudMod.announceVictory(W, victory);
    audioMod.onMatchEnd(W, victory);
    const showStats = () => hudMod.showPostMatch(W, buildPostMatch(victory, placement));
    if (W._overT) clearTimeout(W._overT);
    W._overT = setTimeout(showStats, 2600);
    // any key/click skips the beat
    const skip = () => { if (W._overT) { clearTimeout(W._overT); W._overT = null; showStats(); } cleanup(); };
    const cleanup = () => { window.removeEventListener("keydown", skip); window.removeEventListener("mousedown", skip); };
    window.addEventListener("keydown", skip); window.addEventListener("mousedown", skip);
    setTimeout(cleanup, 2700);
  }
  function buildPostMatch(victory, placement) {
    return {
      victory,
      placement,
      kills: W.match.kills[W.player.id] || 0,
      damage: Math.round(W.match.damage[W.player.id] || 0),
      accuracy: W.stats.shotsFired ? Math.round((W.stats.shotsHit / W.stats.shotsFired) * 100) : 0,
      timeS: Math.round(W.t),
      onMenu: () => { W.phase = "menu"; netMod.leave(W); hudMod.showMenu(W, startMatch); },
      // requeue straight into a fresh match (new random map, same mode) without
      // rebuilding the cinematic menu world and re-reading the skin GLBs
      onAgain: () => { netMod.leave(W); startMatch({ mapId: hudMod.randomMap(), mode: W.mode }); },
    };
  }
  W.endMatch = endMatch;

  // ── frame pipeline ──────────────────────────────────────────────────────────
  kernel.onUpdate((dt) => {
    // cinematic menu world (orbit cam, water, storm ring, particles)
    if (W.phase === "menu") {
      hudMod.updateMenuWorld(W, Math.min(dt, 0.05));
      return;
    }
    if (W.paused) return;
    if (W.phase !== "match" && W.phase !== "drop" && W.phase !== "over") return;
    const step = Math.min(dt, 0.05);
    followShadow();
    if (W.phase !== "over") W.t += step;

    botsMod.update(W, step);        // brains → bot input structs (staggered)
    playerMod.update(W, step);      // all actors: movement + physics + camera
    weaponsMod.update(W, step);     // fire/reload/projectiles/damage
    lootMod.update(W, step);        // pickups, chest channels
    stormMod.update(W, step);       // circle, damage ticks, warnings
    fxMod.update(W, step);          // particles, tracers, damage numbers
    hudMod.update(W, step);         // bars, minimap, feed, timers
    if (W.net) netMod.update(W, step);

    // win/lose
    if (W.phase === "match" && W.match && W.match.over) {
      endMatch(W.match.winner === W.player.id);
    }
  });

  // ── menu ───────────────────────────────────────────────────────────────────
  hudMod.showMenu(W, startMatch);

  // ── debug/test hook ─────────────────────────────────────────────────────────
  const controller = {
    W,
    startMatch,
    state: () => ({
      phase: W.phase, t: W.t, alive: W.match ? W.match.aliveCount() : 0,
      player: W.player ? { hp: W.player.hp, shield: W.player.shield, pos: { x: W.player.pos.x, y: W.player.pos.y, z: W.player.pos.z }, weapon: W.player.weapon && W.player.weapon.id } : null,
      map: W.mapId, mode: W.mode, seed: W.seed,
    }),
    // synchronous fast-forward for deterministic tests (no rAF dependency)
    fastForward: (seconds, stepS) => {
      const h = stepS || 1 / 30;
      for (let t = 0; t < seconds; t += h) {
        W.t += h;
        botsMod.update(W, h); playerMod.update(W, h); weaponsMod.update(W, h);
        lootMod.update(W, h); stormMod.update(W, h);
        if (W.match && W.match.over) break;
      }
      return controller.state();
    },
  };
  window.__LC__ = controller;
  return controller;
});

// ── helpers ────────────────────────────────────────────────────────────────
function mkEmitter() {
  const ls = {};
  return {
    on: (ev, fn) => { (ls[ev] = ls[ev] || []).push(fn); },
    emit: (ev, ...args) => { const l = ls[ev]; if (l) for (let i = 0; i < l.length; i++) l[i](...args); },
  };
}
function loadSettings() {
  const def = { masterVol: 0.8, musicVol: 0.5, sfxVol: 0.9, sensitivity: 1.0, adsSensitivity: 0.8, graphics: "medium", playerName: "You", keys: {}, showPerf: false, fov: 57, sprintToggle: true, adsToggle: false };   // SHIFT = click on / click off (owner direction 2026-07-21)
  try {
    const s = Object.assign(def, JSON.parse(localStorage.getItem("lc_settings") || "{}"));
    // Settings persist, so a value dragged to an unusable extreme STAYS broken
    // across reloads — a sensitivity slider pulled to 0 left the mouse unable to
    // turn at all, on every future launch, with no way back except clearing site
    // data. Clamp on load so a bad stored value self-heals.
    s.sensitivity = Math.min(3, Math.max(0.15, +s.sensitivity || 1));
    s.adsSensitivity = Math.min(3, Math.max(0.15, +s.adsSensitivity || 0.8));
    s.fov = Math.min(85, Math.max(50, +s.fov || 57));
    for (const k of ["masterVol", "musicVol", "sfxVol"]) s[k] = Math.min(1, Math.max(0, +s[k] || 0));
    return s;
  } catch (e) { return def; }
}
function shuffledNames(W) {
  const pool = window.FFG.sim.Royale.BOT_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(W.rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  return pool;
}
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
