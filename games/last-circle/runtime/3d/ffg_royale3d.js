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

  // ── portal surface (LOCAL ONLY — no SDK, no network, no third party) ────────
  // The shell control bar drives window.__PAUSE__ for its Pause button and for the
  // auto-pause when the player leaves fullscreen (game_controls.js:199, 229-230).
  // Nothing ever assigned it, so both were silent. hud owns the pause menu and its
  // online-safe path (it must NOT freeze the sim online — W.paused skips
  // netMod.update and the host's silent-guest watchdog swaps you for a bot), so
  // this is a binding, not a second implementation. Same shape as cosmic-coils.
  // Guarded: hud.js exports requestPause in a parallel change, and an unguarded
  // call would turn a dead button into a thrown error.
  window.__PAUSE__ = {
    toggle: () => { if (hudMod.requestPause) hudMod.requestPause(W); },
    pause: () => { if (hudMod.requestPause) hudMod.requestPause(W, true); },
    isPaused: () => !!W.paused,
  };
  // Four lifecycle boundaries, named as INERT NO-OPS. These are the four points any
  // portal integration is defined in terms of, and all four already exist as single
  // clean call sites in this file — begin() is the exact moment the player takes
  // control, endMatch the exact moment they lose it. Naming them now costs six
  // lines; deriving the lifecycle again later costs a re-read of the whole match
  // flow. Nothing is wired to them and nothing may be without owner sign-off —
  // every real integration needs an account and sends data off-machine.
  W.hooks = {
    loadingStart: () => {},
    loadingStop: () => {},
    gameplayStart: () => {},
    gameplayStop: () => {},
  };

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
    // Draw-call knobs. Everything above scales FILL, and the frame is not fill
    // bound: the same view rendered at 64x36 cost 3.54 ms against 3.33 ms at
    // 1280x720 — deleting 99.9% of the pixels changed nothing — while 1280x720 to
    // 1920x1080 (5x the pixels) cost 1.7x the time. A full three-tier sweep on
    // ashgrid moved 319 calls / 4.06 ms to 276 / 3.08 ms, under 1 ms, because every
    // knob in the tables aims at a bottleneck that does not exist. These two are the
    // levers that actually remove submissions from the frame. The spread is kept
    // narrow on purpose (120-200 m, not 90-250 m): loot draw distance is competitive
    // information in a BR and the tier is player-selectable.
    const LOOT_CULL = { low: 120, medium: 150, high: 200 };
    const WPN_LOD   = { low: 70,  medium: 110, high: 160 };
    W.lootCull = LOOT_CULL[tier] || 150;
    W.wpnLOD = WPN_LOD[tier] || 110;
    const maxA = (r.capabilities && r.capabilities.getMaxAnisotropy) ? r.capabilities.getMaxAnisotropy() : 8;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR[tier] || 1.5));
    const shadows = tier !== "low";
    r.shadowMap.enabled = shadows;
    // Shadow VOLUME lives here rather than in the vendored kernel literal, which
    // hard-codes a +/-80 m box (160 m) around world origin on a 1600 m map — about
    // 1% of the playable area had shadows at all, and the depth pass ran every
    // frame regardless. Tighter extents + a volume that FOLLOWS the player (see
    // the frame pipeline) means medium now looks better than high used to.
    // Then the extents overcorrected: sized for a fixed +/-80 m kernel box, 55 m
    // put the shadow boundary a visible three ground-planes away — a crisp fully-lit
    // circle around you — so no building on any map cast onto the ground it stands
    // on. Widening costs almost nothing: the casters are submitted every frame
    // whatever the extent (maps.js sizes each InstancedMesh to the whole 1600 m map,
    // so the +/-55 m frustum could never reject one), and rasterisation is bounded by
    // the fixed map resolution. Texel density stays finer than the old medium tier —
    // medium 220 m/2048 = 10.7 cm, high 300 m/4096 = 7.3 cm — for 2-3x the radius.
    // widened again 2026-07-27 (rescore held the visuals band partly on shadow
    // radius): high 160->220 (440 m span / 4096 = 10.7 cm/texel — exactly the
    // texel density medium shipped at, so quality precedent exists), medium
    // 110->150. normalBias 0.05 below is the walk-up the earlier comment
    // prescribed for wider extents.
    const SHADOW_EXT = { low: 55, medium: 150, high: 220 };
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
      // normalBias is in WORLD units and was tuned against the old 5.4 cm texel;
      // at the wider extents above one texel covers ~2x the ground, so 0.02 no
      // longer clears self-shadow acne on the terrain. Walk it back toward 0.03 if
      // contact shadows detach from wall bases (peter-panning) when facing the sun.
      kernel.sun.shadow.normalBias = 0.05;   // one texel now covers ~1.4x the ground of the 160 m tune
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
  // hud.js's MAIN MENU path has to run the SAME disposal the match teardown
  // does, but it cannot import maps.js/loot.js without creating a second
  // uninitialized module copy — so hand it the functions instead of the modules.
  W._disposeMap = disposeMapResources;
  W._disposeLoot = (w) => (lootMod.disposeLootResources ? lootMod.disposeLootResources(w) : null);

  async function _startMatch(opts) {
    opts = opts || {};
    W.mapId = opts.mapId || W.mapId;
    W.mode = opts.mode || W.mode;
    W.seed = opts.seed != null ? opts.seed : ((Math.random() * 0xffffffff) >>> 0);
    W.rng = SIM.mulberry32(W.seed);
    W.t = 0;
    W.phase = "lobby";
    W.paused = false;
    // The challenge pool could only ever read three numbers — W.t, match.kills,
    // match.damage — which is why it was five cards deep. Every counter added here
    // is one increment on an event that already fires (hud.js wireEvents), so an
    // expanded objective set needs no new instrumentation anywhere in the sim.
    W.stats = { shotsFired: 0, shotsHit: 0, heads: 0, chests: 0, heals: 0, stormDmg: 0, legendaries: 0, longestKillM: 0, killsByCls: {} };
    // Feel state lives on W, not inside a module's reset() — fx.js reset() takes no
    // W argument (fx.js:197), so there is nowhere else that can clear it. Dying
    // inside an explosion leaves residual camShake behind, and nothing decays it
    // while the post-match panel and the menu are up (the frame gate returns before
    // fx.update on phase "menu"), so the NEXT match opened already shaking.
    W.camShake = 0; W.fovPunch = 0; W.hitstopT = 0;
    W._winHold = false; W._winOrbit = 0; W._winDist = 0;
    W._reportedMatch = false;   // portal leaderboard bridge fires once per match

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
    W._lastLootDispose = lootMod.disposeLootResources ? lootMod.disposeLootResources(W) : null;
    for (const name in W._groups) { const g = W._groups[name]; g.clear(); }
    W.actors.length = 0; W.actorById.clear();
    W.rangeDummies = null;          // stale refs into the cleared roster
    botsMod.resetBrains();
    weaponsMod.reset(W);            // live rounds otherwise fly on into the next match
    fxMod.reset();                  // damage numbers are DOM nodes; they outlive the match
    if (W.resetInputState) W.resetInputState();

    // build the world
    W.hooks.loadingStart();
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
    // teamOf is resolved LAZILY, at elimination time: the actors it reads are
    // created below this line, so a table built here would be empty. Without a
    // team-aware win condition, friendly-fire suppression hangs the match forever
    // at two surviving squadmates — Match.eliminate ends on one team left, and with
    // no resolver every player is their own team (sim/royale.js:499-506).
    W.match = new SIM.Match({
      players: modeK.players, mode: W.mode,
      teamOf: (id) => { const a = W.actorById.get(id); return (a && a.teamId) || id; },
    });
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
        // Every human in the lobby is one squad. A solo match has exactly one human,
        // so teamId stays null and teamOf falls back to the actor's own id —
        // nothing about offline play changes.
        const a = playerMod.createActor(W, { id: "s" + i, name: hu.name, isBot: false, teamId: humans.length > 1 ? "sq" : null });
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
    // SHADER PRE-WARM (see fx.js prewarm): compile every program now — map,
    // skins, FX pools — instead of paying a first-draw stall mid-firefight.
    if (fxMod.prewarm) fxMod.prewarm(W);
    W.hooks.loadingStop();          // last asset fetch of the match is done here
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
    // Warm the shader cache while the loading screen is already up. Programs went
    // 0 -> 86 across match 1, every one compiled the first time its material
    // appeared on screen — and compilation is SYNCHRONOUS inside the render call,
    // so each first-encounter was a frame spike during the drop, i.e. the first 30
    // seconds a new player judges the game on. This has to sit after spawnAll so the
    // rigs are positioned and visible (compileAsync walks the scene as it stands),
    // and before showLobby so the loading layer is still what's on screen.
    try {
      if (kernel.renderer.compileAsync) await kernel.renderer.compileAsync(W.scene, W.camera);
      else kernel.renderer.compile(W.scene, W.camera);
    } catch (e) { /* an optimisation only — never block a match start on it */ }
    botsMod.assignDrops(W);
    hudMod.showLobby(W, () => {     // lobby → drop select → drop
      const begin = () => {
        W.phase = W.mode === "practice" ? "match" : "drop";
        W.hooks.gameplayStart();    // drop-select closed; the player has control
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
    W.hooks.gameplayStop();
    const placement = W.match.placementOf(W.player.id) || W.match.aliveCount() + 1;
    // Hold the live world for a beat first. showPostMatch calls hideHUD(), which
    // removes the layer the announcement lives in — so the banner and kill feed
    // for the WINNING kill were created and destroyed in the same frame and the
    // match cut straight from a firefight to a DOM panel. Phase "over" is
    // already whitelisted in the frame gate and already blocks all damage.
    hudMod.announceVictory(W, victory);
    audioMod.onMatchEnd(W, victory);
    // The most-screenshotted moment of the match was that banner over a motionless
    // world — the winner stood still while text sat on top of him. The 2600 ms hold
    // below is already paid for, so spend it: _winHold drives the camera orbit in
    // the frame pipeline, and the cheer is the clip already bound to the emote wheel,
    // replayed through the exact path net.js uses for a peer's emote.
    // fxMod.fireworks is called defensively — it lands in fx.js alongside this and a
    // throw inside a bare setTimeout would take the victory beat down with it.
    if (victory && W.player && W.player.alive) {
      W._winHold = true;
      if (W.playRemoteEmote) W.playRemoteEmote(W.player, "cheer");
      const wp = W.player.pos;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          if (W.phase === "over" && fxMod.fireworks) fxMod.fireworks(W, wp.x + (i - 1.5) * 3, wp.y + 12, wp.z + (i % 2 ? 2.5 : -2.5));
        }, 180 + i * 420);
      }
    }
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
    // W.t is match WALL-CLOCK and keeps advancing while you SPECTATE — the frame
    // loop only stops it on phase "over". So dying at 0:45 of a 12:55 match printed
    // "Survived 12:55", paid timeS/4 XP for twelve minutes of watching, and banked
    // all of it into career.timeAliveS (the lifetime hours on the menu). Match
    // .eliminate already stamps the true time into the feed (sim/royale.js:502);
    // the winner never appears there, so the W.t fallback is right for a victory.
    const elim = W.match.feed.find((f) => f.victim === W.player.id);
    // PORTAL BRIDGE (same convention as cosmic-coils): the game holds no
    // auth/DB code — the forgeflowgames.com player shell listens for
    // forgeflow:game_over (src/lib/gameBridge.ts:126) and upserts
    // leaderboard_scores best-of-week for SIGNED-IN accounts; guests and
    // standalone (window.parent === window) are harmless no-ops. Score:
    // placement dominates, kills pay, a victory crowns —
    // (50-placement)*100 + kills*200 + victory*1500, max ~14k.
    if (!W._reportedMatch) {
      W._reportedMatch = true;
      try {
        if (window.parent && window.parent !== window) {
          const sc = (50 - Math.min(50, Math.max(1, placement))) * 100 +
                     (W.match.kills[W.player.id] || 0) * 200 + (victory ? 1500 : 0);
          window.parent.postMessage({ type: "forgeflow:game_over", score: sc }, "*");
        }
      } catch (e) {}
    }
    return {
      victory,
      placement,
      kills: W.match.kills[W.player.id] || 0,
      damage: Math.round(W.match.damage[W.player.id] || 0),
      accuracy: W.stats.shotsFired ? Math.round((W.stats.shotsHit / W.stats.shotsFired) * 100) : 0,
      timeS: Math.round(elim ? elim.t : W.t),
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
    // Victory hold: ~120° of orbit and a slow pull-back across the 2600 ms beat
    // endMatch already pays for. Read by player.js updateCamera — the winning
    // frame used to be a 34 px banner over a motionless world at the default
    // third-person 4.2 m.
    if (W._winHold) {
      W._winOrbit = (W._winOrbit || 0) + Math.min(dt, 0.05) * 0.8;
      W._winDist = Math.min(1.3, (W._winDist || 0) + Math.min(dt, 0.05) * 0.55);
    }
    let step = Math.min(dt, 0.05);
    // HITSTOP — the one Vlambeer technique this build shipped none of; nothing in
    // runtime/ scaled frame dt on impact (the only timeScale-shaped code was the
    // animation-mixer LOD in player.js). SOLO ONLY: net.js broadcasts at 12 Hz and
    // the host swaps a silent guest for a bot after 12 s, so slowing the sim on one
    // client drifts it off the link and reads as a dropout. Decremented with the
    // REAL dt so the freeze is the same wall-clock length whatever scale is applied.
    if (W.hitstopT > 0) {
      W.hitstopT = Math.max(0, W.hitstopT - dt);
      if (!W.net) step *= 0.12;
    }
    followShadow();
    if (W.phase !== "over") W.t += step;

    botsMod.update(W, step);        // brains → bot input structs (staggered)
    playerMod.update(W, step);      // all actors: movement + physics + camera
    weaponsMod.update(W, step);     // fire/reload/projectiles/damage
    lootMod.update(W, step);        // pickups, chest channels
    stormMod.update(W, step);       // circle, damage ticks, warnings
    fxMod.update(W, step);          // particles, tracers, damage numbers
    hudMod.update(W, step);         // bars, minimap, feed, timers
    // audio.js had NO per-frame hook at all — it exported only init/setVolumes/
    // startMenuMusic/startMatchMusic/onMatchEnd, so listener sync, the storm bed,
    // ambience and the music duck had nowhere to live. Deliberately NOT added to
    // the fastForward loop below: that path is the deterministic test harness and
    // must stay silent and rAF-free. Guarded because audio.js lands `update` in a
    // parallel change and an unguarded call here would throw every frame.
    if (audioMod.update) audioMod.update(W, step);
    if (W.net) netMod.update(W, step);

    // win/lose
    if (W.phase === "match" && W.match && W.match.over) {
      // isWinner, not `winner === id`: the scalar is only the FIRST survivor of a
      // winning squad, so the second squadmate got the defeat screen.
      endMatch(W.match.isWinner(W.player.id));
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
  const def = { masterVol: 0.8, musicVol: 0.5, sfxVol: 0.9, sensitivity: 1.0, adsSensitivity: 0.8, graphics: "medium", playerName: "You", keys: {}, showPerf: false, fov: 57, sprintToggle: true, adsToggle: false, shake: 1 };   // SHIFT = click on / click off (owner direction 2026-07-21)
  try {
    const s = Object.assign(def, JSON.parse(localStorage.getItem("lc_settings") || "{}"));
    // Settings persist, so a value dragged to an unusable extreme STAYS broken
    // across reloads — a sensitivity slider pulled to 0 left the mouse unable to
    // turn at all, on every future launch, with no way back except clearing site
    // data. Clamp on load so a bad stored value self-heals.
    s.sensitivity = Math.min(3, Math.max(0.15, +s.sensitivity || 1));
    s.adsSensitivity = Math.min(3, Math.max(0.15, +s.adsSensitivity || 0.8));
    s.fov = Math.min(85, Math.max(50, +s.fov || 57));
    // Camera shake is a motion-sickness accommodation the same way FOV and the
    // sprint/ADS toggles are, so 0 has to be reachable — and `|| 1` would bounce a
    // deliberate 0 straight back to full. Same persistence trap as the sliders above.
    s.shake = (s.shake == null || !isFinite(+s.shake)) ? 1 : Math.min(1, Math.max(0, +s.shake));
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
