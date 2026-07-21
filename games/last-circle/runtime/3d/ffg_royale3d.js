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
const [{ MAPS, buildMap }, playerMod, weaponsMod, lootMod, stormMod, botsMod, hudMod, audioMod, fxMod, netMod] =
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
    const maxA = (r.capabilities && r.capabilities.getMaxAnisotropy) ? r.capabilities.getMaxAnisotropy() : 8;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR[tier] || 1.5));
    const shadows = tier !== "low";
    r.shadowMap.enabled = shadows;
    if (shadows && kernel.sun) {
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
      for (const mm of mats) for (const slot of ["map", "normalMap", "roughnessMap"]) if (mm[slot]) { mm[slot].anisotropy = W._texAniso; mm[slot].needsUpdate = true; }
    });
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

    // clear previous world
    for (const name in W._groups) { const g = W._groups[name]; g.clear(); }
    W.actors.length = 0; W.actorById.clear();
    botsMod.resetBrains();
    if (W.resetInputState) W.resetInputState();

    // build the world
    hudMod.showLoading(W, "Building " + (MAPS[W.mapId] ? MAPS[W.mapId].name : W.mapId) + "…");
    await nextFrame(); // let the loading screen paint
    W.map = await buildMap(W, W.mapId);

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
    await playerMod.loadActorModels(W);

    playerMod.spawnAll(W);          // positions actors (glider line or ground by mode)
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
    hudMod.showPostMatch(W, {
      victory,
      placement,
      kills: W.match.kills[W.player.id] || 0,
      damage: Math.round(W.match.damage[W.player.id] || 0),
      accuracy: W.stats.shotsFired ? Math.round((W.stats.shotsHit / W.stats.shotsFired) * 100) : 0,
      timeS: Math.round(W.t),
      onMenu: () => { W.phase = "menu"; hudMod.showMenu(W, startMatch); },
    });
    audioMod.onMatchEnd(W, victory);
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
  const def = { masterVol: 0.8, musicVol: 0.5, sfxVol: 0.9, sensitivity: 1.0, adsSensitivity: 0.8, graphics: "medium", playerName: "You", keys: {} };
  try { return Object.assign(def, JSON.parse(localStorage.getItem("lc_settings") || "{}")); } catch (e) { return def; }
}
function shuffledNames(W) {
  const pool = window.FFG.sim.Royale.BOT_NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(W.rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  return pool;
}
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
