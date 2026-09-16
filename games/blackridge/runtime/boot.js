// runtime/boot.js [A0] — the only entry module, the only rAF, the only
// renderer.info.reset(). Architecture §5 (boot phases) + §6 (__FPS__) as
// amended by BUILD_PLAN Part 8. index.html injects this as
// `./runtime/boot.js?v=N` — bump N EVERY iteration; V propagates to every
// dynamic import below so one number busts the whole graph (no-store dev
// serving via _harness/shotserver.py on port 8841, R12/R20).

const V = new URL(import.meta.url).search; // "?v=N"
const VN = (V.match(/[?&]v=(\d+)/) || [, "0"])[1];
const PARAMS = new URLSearchParams(location.search);

// Boot forensics: every uncaught error and rejection lands here so a stalled
// boot is diagnosed from the console, never guessed at (colosseum pattern).
window.__BOOT_ERRORS__ = window.__BOOT_ERRORS__ || [];
window.addEventListener("error", (e) => window.__BOOT_ERRORS__.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) =>
  window.__BOOT_ERRORS__.push("rejection: " + String((e.reason && e.reason.message) || e.reason)));

// Ship blocker registry (doctrine §7): any lane that falls back below the
// asset bar pushes a string here; ship is BLOCKED while non-empty.
window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || [];

// ---------------------------------------------------------------------------
// Boot UI helpers — never a silent dead bar.
// ---------------------------------------------------------------------------
const bootEl = document.getElementById("boot");
const barEl = document.getElementById("boot-bar");
const phaseEl = document.getElementById("boot-phase");
const PHASES = 6;

function phase(n, text) {
  if (phaseEl) phaseEl.textContent = text;
  if (barEl) barEl.style.width = `${Math.round((n / PHASES) * 100)}%`;
}

function fail(msg) {
  console.error("[boot] FAILED:", msg);
  if (bootEl) bootEl.remove();
  const panel = document.getElementById("nogpu");
  if (panel) {
    panel.classList.add("show");
    const b = panel.querySelector("b");
    if (b) b.textContent = "BLACKRIDGE failed to start.";
    const d = panel.querySelector("div");
    if (d) {
      const line = document.createElement("div");
      line.style.cssText = "margin-top:1em;font-size:11px;opacity:.8";
      line.textContent = String(msg);
      d.appendChild(line);
    }
  }
}

try {
  // -------------------------------------------------------------------------
  // Phase 1 — initialising: params, renderer, settings.
  // -------------------------------------------------------------------------
  phase(1, "initialising");
  const fixtureName = PARAMS.get("fixture");
  const isBench = PARAMS.get("bench") === "1";
  const seedParam = parseInt(PARAMS.get("seed") || "1", 10) || 1;

  const [gfxMod, settingsMod] = await Promise.all([
    import(`../core/gfx.js${V}`),
    import(`../core/settings.js${V}`),
  ]);
  const { initRenderer } = gfxMod;
  const { S, set: setSetting, onChange } = settingsMod;

  const canvas = document.getElementById("view");
  const renderer = initRenderer(canvas);

  // -------------------------------------------------------------------------
  // Phase 2 — loading core: the WHOLE module graph, parallel, V-suffixed.
  // Importing every module (including lane-internal ones) means a syntax
  // error in ANY stub or lane commit fails bootcheck immediately with a
  // named module, instead of hiding until its first lazy use.
  // -------------------------------------------------------------------------
  phase(2, "loading core");
  const [
    THREE,
    { makeBus }, { makeStreams }, { createPerf }, { createInput }, { makeBridge },
    { createSim }, /*player*/, /*ballistics*/, /*damage*/, /*worldMod*/, { makeMission }, /*grenades*/,
    { bakeNav }, /*perception*/, /*botfsm*/, /*squad*/,
    { WEAPONS }, { createViewmodel }, { createRecoil }, { loadWeaponGLB },
    { buildLayout, buildLayoutFor, setActiveMap, getActiveMap }, { buildColliders, buildCollidersFor }, { buildLevel }, { buildProps }, /*materials*/,
    { createSky }, { createLights }, { createPost }, { prewarm }, { createDynres }, { createWeather }, { createReflect },
    { createFx }, /*muzzle*/, /*tracers*/, /*impacts*/, /*decals*/, /*casings*/, /*explosions*/,
    /*actor*/, /*anim_map*/, { createSoldiers },
    { createAudio }, /*sfx*/, /*ambience*/, /*music*/,
    { createHud }, { createMenu }, { createPause }, { createSettingsUI },
    { createTestSurface }, { createScenarios }, { createAutoplay },
  ] = await Promise.all([
    import("three"),
    import(`../core/events.js${V}`), import(`../core/rng.js${V}`), import(`../core/perf.js${V}`),
    import(`../core/input.js${V}`), import(`../core/view/bridge.js${V}`),
    import(`../core/sim/sim.js${V}`), import(`../core/sim/player.js${V}`),
    import(`../core/sim/ballistics.js${V}`), import(`../core/sim/damage.js${V}`),
    import(`../core/sim/world.js${V}`), import(`../core/sim/mission.js${V}`),
    import(`../core/sim/grenades.js${V}`),
    import(`../core/ai/nav.js${V}`), import(`../core/ai/perception.js${V}`),
    import(`../core/ai/botfsm.js${V}`), import(`../core/ai/squad.js${V}`),
    import(`../core/weapons/weapon_data.js${V}`), import(`../core/weapons/viewmodel.js${V}`),
    import(`../core/weapons/recoil.js${V}`), import(`../core/weapons/weapon_meshes.js${V}`),
    import(`../core/level/layout.js${V}`), import(`../core/level/colliders.js${V}`),
    import(`../core/level/level.js${V}`), import(`../core/level/props.js${V}`),
    import(`../core/level/materials.js${V}`),
    import(`../core/render/sky.js${V}`), import(`../core/render/lighting.js${V}`),
    import(`../core/render/post.js${V}`), import(`../core/render/prewarm.js${V}`),
    import(`../core/render/dynres.js${V}`), import(`../core/render/weather.js${V}`),
    import(`../core/render/reflect.js${V}`),
    import(`../core/fx/fx.js${V}`), import(`../core/fx/muzzle.js${V}`),
    import(`../core/fx/tracers.js${V}`), import(`../core/fx/impacts.js${V}`),
    import(`../core/fx/decals.js${V}`), import(`../core/fx/casings.js${V}`),
    import(`../core/fx/explosions.js${V}`),
    import(`../core/chars/actor.js${V}`), import(`../core/chars/anim_map.js${V}`),
    import(`../core/chars/soldiers.js${V}`),
    import(`../core/audio/audio.js${V}`), import(`../core/audio/sfx.js${V}`),
    import(`../core/audio/ambience.js${V}`), import(`../core/audio/music.js${V}`),
    import(`../core/hud/hud.js${V}`), import(`../core/hud/menu.js${V}`),
    import(`../core/hud/pause.js${V}`), import(`../core/hud/settings_ui.js${V}`),
    import(`../core/test/testsurface.js${V}`), import(`../core/test/scenarios.js${V}`),
    import(`../core/test/autoplay.js${V}`),
  ]);

  // ---- PVP match core (W1) — own modules, imported eagerly so a syntax
  // error fails bootcheck with a named module (same policy as above).
  const matchMod = await import(`../core/match/match.js${V}`);
  await import(`../core/match/roster.js${V}`);
  await import(`../core/match/contract.js${V}`);
  await import(`../core/pvp/pvp_tuning.js${V}`);

  // Mode modules + spawn director land in CONCURRENT lanes (W5/W8/W9, W2).
  // Probe with fetch first (a plain 404, no console error), import + register
  // what exists; a missing lane is a warn, never a crash (arch 1.6 rule 5).
  async function importIfPresent(fetchRel, importRel) {
    try {
      const res = await fetch(fetchRel + V, { cache: "no-store" });
      if (!res.ok) return null;
      return await import(importRel + V);
    } catch (e) {
      console.warn(`[boot] optional module ${importRel} failed to import:`, e && e.message);
      return null;
    }
  }
  for (const id of ["tdm", "ctf", "ffa"]) {
    const mm = await importIfPresent(`./core/match/modes/${id}.js`, `../core/match/modes/${id}.js`);
    if (mm && mm.createMode) matchMod.registerMode(id, mm.createMode);
    else console.warn(`[boot] mode '${id}' not landed yet — its lane registers it via core/match/modes/${id}.js`);
  }
  const spawnsMod = await importIfPresent("./core/match/spawns.js", "../core/match/spawns.js");

  // [multi-arena amendment] the persisted MAP choice. Imported WITHOUT the ?v=
  // suffix on purpose: core/hud/menu.js's own `import "./mode_select.js"` has
  // no suffix either, so this resolves to the SAME module instance the MAP row
  // writes through (the value itself lives in localStorage, like difficulty).
  const { loadMap } = await import("../core/hud/mode_select.js");

  // -------------------------------------------------------------------------
  // Phase 3 — building world.
  // -------------------------------------------------------------------------
  phase(3, "building world");

  // content.json is A2's file. The skeleton must boot with or without it —
  // parallel lanes land in any order — so a miss falls back to a minimal
  // inline mission (flagged in console, never silently).
  let content;
  try {
    const res = await fetch(`./content.json${V}`);
    if (res.ok) content = await res.json();
  } catch (e) { /* fall through */ }
  if (!content) {
    console.warn("[boot] content.json not found — using inline fallback (A2 lands the real one)");
    content = {
      mission: { id: "meridian_ward", phases: ["infil", "assault", "exfil"], objectives: [], spawns: { waves: [] } },
      archetypes: {}, scenarios: {}, signage: [], pickups: [],
    };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    S.fov, window.innerWidth / window.innerHeight, 0.05, 600); // VERTICAL deg (R9)
  camera.position.set(0, 1.7, 0);
  scene.add(camera);

  const bus = makeBus();
  const bridge = makeBridge();
  const input = createInput(canvas, S);
  const perf = createPerf(renderer);

  let layout = buildLayout(seedParam);
  let colliders = buildColliders(seedParam);
  // C20/R4: cell 0.75 so the arena's 2.0 m pier gaps stay walkable —
  // default 1.0 with FOOT_R 0.2 can silently sever the north artery.
  let nav = bakeNav(colliders, { cell: 0.75 });
  let levelOut = await buildLevel({ THREE, renderer, scene, layout, settings: S });
  scene.add(levelOut.group);
  let propsOut = buildProps(layout, { THREE, scene, settings: S });
  scene.add(propsOut.group);

  // W1 (wave-2 gate fix) — live map swap. Matches play on the arena carve
  // (content.arena.id → 'lanternwalk'); the campaign plays on meridian_ward
  // (Amendment A1). Each map is built at most once and its scene groups are
  // swapped in/out of the scene — no disposal churn, and returning to the
  // campaign swaps straight back. layout.js's header names this exact call
  // order: setActiveMap → rebuild layout/colliders/nav (cell 0.75, C20/R4)
  // → level + props rebuild.
  const worldCache = new Map();
  worldCache.set(getActiveMap(), { layout, colliders, nav, levelOut, propsOut });
  async function setWorldMap(mapId) {
    if (getActiveMap() === mapId) return;
    scene.remove(levelOut.group);
    scene.remove(propsOut.group);
    setActiveMap(mapId);
    let w = worldCache.get(mapId);
    if (!w) {
      // EXPLICIT-map builders, never the ACTIVE-map ones: boot's layout.js is
      // the ?v=N instance while colliders.js imports bare './layout.js' — TWO
      // module instances, TWO ACTIVE variables. setActiveMap above flips only
      // boot's; buildColliders(seed) would silently build the OLD map's
      // colliders against the NEW map's visuals (the exact wave-2 gate
      // failure: lanternwalk level, meridian_ward nodes).
      const wLayout = buildLayoutFor(mapId, seedParam);
      const wColliders = buildCollidersFor(mapId, seedParam);
      const wNav = bakeNav(wColliders, { cell: 0.75 });
      const wLevel = await buildLevel({ THREE, renderer, scene, layout: wLayout, settings: S });
      const wProps = buildProps(wLayout, { THREE, scene, settings: S });
      w = { layout: wLayout, colliders: wColliders, nav: wNav, levelOut: wLevel, propsOut: wProps };
      worldCache.set(mapId, w);
    }
    ({ layout, colliders, nav, levelOut, propsOut } = w);
    scene.add(levelOut.group);
    scene.add(propsOut.group);
    ctx.layout = layout; ctx.colliders = colliders; ctx.nav = nav;
    // Re-bind the fixed spot pool to this map's practicals (decor is built
    // once — the carve shares the ward's district, so fixtures stay valid).
    if (ctx.lights) ctx.lights.bindStatic(levelOut.staticLightSpecs);
    console.log(`[boot] world map → ${mapId}`);
  }

  // Shared view context. Modules take what they need; sim stays THREE-free.
  const ctx = {
    THREE, renderer, scene, camera, canvas,
    settings: S, setSetting, onChange,
    bus, bridge, input, perf,
    layout, colliders, nav, content,
    weapons: WEAPONS,
    V, version: `v${VN}`,
    sim: () => sim, // live getter — mission restarts swap the instance
  };

  const sky = createSky(ctx);
  if (sky.mesh) scene.add(sky.mesh);
  const lights = createLights(ctx);
  ctx.lights = lights; // v2.2: the lease-API seam (A7 needsElsewhere)
  lights.bindStatic(levelOut.staticLightSpecs);
  const weather = createWeather(ctx);
  const reflect = createReflect(ctx);
  // Kill cam — owns the camera ONLY during the respawn wait, a window the
  // viewmodel rig already leaves unowned (it stops driving once p.alive is
  // false). Imported on its own rather than taking a slot in the positional
  // destructure above: that list is index-matched to its Promise.all, and a
  // miscount there cross-wires two modules silently.
  const { createKillCam } = await import(`../core/render/killcam.js${V}`);
  const killcam = createKillCam(ctx);

  // Menu-state sim: exists from boot so __FPS__.sim is truthy for the ready
  // expression; startMission() replaces it with a fresh epoch.
  let epoch = 0;
  let sim = createSim({ content, colliders, nav, weapons: WEAPONS, seed: seedParam, emit: bus.emit });
  sim.epoch = epoch;
  // v2.2 integrator amendment (A1's offered simplification): the DRIVEN mission
  // instance IS sim.mission — sim.step ticks it internally (sim.js tick slot 6),
  // and its drainRadio()/drainSetPieces() queues are what A10's hud and A6's
  // lighting poll. Boot never ticks it a second time. makeMission stays the
  // fallback for a content-less boot only.
  let mission = sim.mission || makeMission(content, bus.emit);

  // -------------------------------------------------------------------------
  // Phase 4 — loading weapons (mission loadout ONLY: warden + pike, R26).
  // -------------------------------------------------------------------------
  phase(4, "loading weapons");
  await Promise.all([loadWeaponGLB("warden"), loadWeaponGLB("pike")]);
  const vm = createViewmodel(ctx);
  const recoil = createRecoil(input);
  const fx = createFx(ctx);
  const soldiers = createSoldiers(ctx);
  const audio = createAudio(ctx);
  const hud = createHud(ctx);
  const post = createPost(ctx);
  ctx.post = post; // v2.2 (A11: capture()/post.resize seam)
  const dynres = createDynres(renderer, perf);

  const pauseCtl = createPause(ctx, {
    onResume() { acc = 0; }, // resume must not fast-forward (doctrine §5)
    onAbandon() { mission.forfeit(sim); }, // real loss path (doctrine §6)
  });
  window.__PAUSE__ = {
    pause: () => pauseCtl.pause(),
    resume: () => pauseCtl.resume(),
    toggle: () => pauseCtl.toggle(),
  };

  const menu = createMenu(ctx, {
    onStartMission: () => startMission({}),
    onSettings: () => settingsUI.show(),
    onQuality: (q) => setSetting("quality", q),
  });
  const settingsUI = createSettingsUI(ctx);
  ctx.menu = menu; // v2.2 (A11: 'menu' scenario returns to title)
  ctx.mission = () => mission; // v2.2 (A10 radio subtitles; A11 scenario hold)

  function attachAll() {
    fx.attach(bridge);
    soldiers.attach(bridge);
    audio.attach(bridge);
    hud.attach(bridge);
    // A0 wiring per architecture §3.11: player shots kick recoil + viewmodel.
    // v2.2 swept-projectile convention: impactOnly resolution replays and
    // pen entry/exit events must NOT kick (a Warden hit past ~12 m would
    // double-kick otherwise — A1/A4 needsElsewhere).
    bridge.register("shot", (d) => {
      if (d && d.shooter === "P" && !d.impactOnly && !d.pen) {
        recoil.kick(d.weaponId); vm.kick(d.weaponId);
      }
    });
    // bridge.clear() wipes handlers on every match start, so the kill cam
    // re-registers here with everything else rather than once at boot.
    killcam.reset();
    killcam.attach(bridge);
  }
  attachAll();

  onChange("fov", (v) => { camera.fov = v; camera.updateProjectionMatrix(); });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    post.resize(window.innerWidth, window.innerHeight);
  });

  // startMission — the real path (§5), used by menu AND __test.
  async function startMission(opts = {}) {
    // Amendment A1: the campaign plays on meridian_ward. A prior match leaves
    // the arena carve active — swap back before rebuilding the sim.
    await setWorldMap("meridian_ward");
    epoch++;
    bus.resetCounters();
    sim = createSim({
      content, colliders, nav, weapons: WEAPONS,
      seed: opts.seed ?? seedParam, emit: bus.emit,
    });
    sim.epoch = epoch;
    bridge.clear();
    attachAll();
    // Mission-gate loading MAY wait on fat assets; the title screen never
    // does (doctrine §3). requiredBodies pattern inside soldiers.ready.
    // Underscore keys (A2's "_comment") are schema annotations, not archetypes.
    const archetypes = content.archetypes
      ? Object.keys(content.archetypes).filter((k) => !k.startsWith("_")) : [];
    await soldiers.ready(archetypes);
    mission = sim.mission || makeMission(content, bus.emit); // driven instance = sim.mission (v2.2)
    mission.start(sim);
    menu.hide();
    hud.show();
    input.enabled = true;
    return true;
  }

  // startMatch — the PVP entry (W1; owner amendment A1: matches start ONLY
  // here — startMission keeps its campaign behaviour unchanged, so the 11
  // harness callers, six of them aim-wave probes, keep the exact semantics
  // they were written against).
  let defaultModeId = "tdm";

  // [multi-arena amendment] content.json now carries BOTH an arena REGISTRY
  // (content.arenas[<id>] = {arena, spawnPoints, clusters, flags}, written by
  // tools/probe_arena.mjs --emit) and the FLAT keys content.arena/.clusters/
  // .spawnPoints/.flags. The flat keys are the "currently selected arena", and
  // they stay the ONLY thing core/match/{contract,match}.js and modes/ctf.js
  // read — those three consumers are deliberately untouched. Selecting an
  // arena therefore means copying its registry block onto the flat keys
  // BEFORE createSim, so the contract gate validates the arena the player
  // picked against the geometry setWorldMap is about to build.
  const FLAT_KEYS = ["arena", "spawnPoints", "clusters", "flags"];
  function snapshotFlat() {
    const o = {};
    for (const k of FLAT_KEYS) o[k] = content[k];
    return o;
  }
  function restoreFlat(snap) {
    for (const k of FLAT_KEYS) if (snap[k] !== undefined) content[k] = snap[k];
  }
  function selectArena(id) {
    const blk = content.arenas && content.arenas[id];
    if (!blk) return false; // registry-less content (or a map not probed yet):
    for (const k of FLAT_KEYS) if (blk[k] !== undefined) content[k] = blk[k];
    return true;          // leave the flat keys alone and let setWorldMap rule
  }

  async function startMatch(opts = {}) {
    const modeId = opts.mode || defaultModeId;
    const prevMap = getActiveMap();
    const arenaId = opts.map || (content.arena && content.arena.id) || "lanternwalk";
    const prevFlat = snapshotFlat();
    try {
      // Point the flat "currently selected arena" view at this match's arena,
      // then swap the live world (layout/colliders/nav/level/props) BEFORE
      // creating the sim so match.start's contract gate validates against
      // matching geometry. An id with no registry block and no registered
      // layout throws out of setWorldMap into the catch below.
      selectArena(arenaId);
      await setWorldMap(arenaId);
      const newSim = createSim({
        content, colliders, nav, weapons: WEAPONS,
        seed: opts.seed ?? seedParam, emit: bus.emit,
        mode: modeId,
        tuning: "pvp", // C25 seam — identity delta set until wave 5
        matchOpts: {
          difficulty: opts.difficulty,
          veteran: opts.veteran,
          spawnDirectorFactory: spawnsMod && spawnsMod.makeSpawns ? spawnsMod.makeSpawns : null,
        },
      });
      epoch++;
      bus.resetCounters();
      sim = newSim;
      sim.epoch = epoch;
      bridge.clear();
      attachAll();
      const archetypes = content.archetypes
        ? Object.keys(content.archetypes).filter((k) => !k.startsWith("_")) : [];
      await soldiers.ready(archetypes);
      mission = sim.mission; // sim.match === sim.mission (one object, two names)
      mission.start(sim); // INSIDE the guard: a contract-gate throw here is a
      // reported error, never an unhandled rejection (arch 1.6 rule 5)
    } catch (e) {
      // a missing mode lane (W5/W8/W9 not landed) or a contract-gate failure
      // is a reported error, never a page crash (arch 1.6 rule 5)
      // keep the STACK: message-only made a spawn-table indexing bug in one
      // arena un-localizable (it reports as a bare "reading '0'").
      console.error("[boot] startMatch failed:", e && e.message, e && e.stack);
      // roll back BOTH halves: the built world AND the flat arena view, or the
      // next start would validate the failed arena's data against prevMap.
      restoreFlat(prevFlat);
      try { await setWorldMap(prevMap); } catch (_) { /* keep the page alive */ }
      return false;
    }
    menu.hide();
    hud.show();
    input.enabled = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Frame stepping — shared by the rAF loop and the synchronous test path.
  // ---------------------------------------------------------------------------
  const DT = 1 / 60;
  let acc = 0;
  let last = performance.now();
  let simStepsDropped = 0; // C27 counter — perf gate AC-48 reads it via stats()
  let renderAlpha = 0;     // last LIVE interpolation factor (see frame(), pause)

  // ---- PLAYER CAMERA TICK HISTORY (RENDER-ONLY) -----------------------------
  // The sim is a fixed 60 Hz lockstep; the display is not. Bot bodies have
  // always lerped their last two ticks by the frame's `alpha`
  // (core/chars/soldiers.js, "interpolated position reads"), but the
  // first-person camera was written straight off the CURRENT tick —
  // viewmodel.js `camera.position.set(p.pos[0] + …, p.pos[1] + eyeH + …, …)` —
  // so on a 144 Hz panel it held one world position for 2-3 frames and then
  // jumped, in an uneven 1-2-1-1-2 pattern, while mouse-look stayed perfectly
  // smooth and raw. Even rotation over uneven translation is the perceptual
  // signature of gliding/skating, and it is the dominant cause of it here.
  //
  // WHERE THE HISTORY LIVES, AND WHY IT CANNOT TOUCH DETERMINISM: a view-side
  // 2-slot ring in THIS closure, not sim state. Nothing writes back into the
  // sim, nothing here is read by sim.step, serialised, checkpointed or sent to
  // a peer — the sim cannot observe it at all, so the tick is byte-identical
  // and lockstep is untouched. The alternative — parking prev/curr on
  // state.player — would add a field to the object the sim owns and
  // checkpoints, which every restore and every peer would then have to keep
  // consistent; that is exactly the class of change the brief rules out.
  //
  // It is filled by stepSim(), which is now the ONLY place sim.step() is
  // called (both the rAF loop and the synchronous stepFrames path). That makes
  // "captured exactly once per SIM TICK" structural rather than a convention
  // two call sites have to remember — and it cannot drift the way a per-frame
  // sampler keyed on st.tick does when a frame takes 2-3 catch-up steps.
  const camHist = {
    prev: [0, 0, 0],
    curr: [0, 0, 0],
    have: false,  // no sample yet — first tick of a fresh sim
    owner: null,  // the sim INSTANCE these samples belong to
    out: [0, 0, 0],
  };
  // One tick of legitimate locomotion cannot approach this. The fastest ground
  // speed in the sim is MOVE.SLIDE_ENTRY 7.8 m/s = 0.130 m/tick, and free-fall
  // (MOVE.GRAV -20, no terminal clamp) would need 60 m/s — a ~90 m drop — to
  // cover 1.0 m inside 1/60 s. Both teleport paths jump the body far further
  // AND zero p.vel on the way: sim.teleport() (core/sim/sim.js, the scenario
  // and harness path) and match.js spawnActor's respawn (`p.pos =
  // pick.pos.slice()`). Lerping across either would smear the camera across
  // the map for a frame, so they snap instead.
  const TELEPORT_M2 = 1.0 * 1.0;

  function captureTick() {
    const p = sim && sim.state && sim.state.player;
    if (!p || !p.pos) { camHist.have = false; camHist.owner = sim; return; }
    // A new sim instance (startMission / startMatch) shares no history with the
    // old one, so its first tick is a teleport by definition.
    const fresh = !camHist.have || camHist.owner !== sim;
    const c = camHist.curr, pv = camHist.prev;
    pv[0] = c[0]; pv[1] = c[1]; pv[2] = c[2];
    // COPY, never alias: player.js reassigns `p.pos = res.pos` every tick.
    c[0] = p.pos[0]; c[1] = p.pos[1]; c[2] = p.pos[2];
    const dx = c[0] - pv[0], dy = c[1] - pv[1], dz = c[2] - pv[2];
    if (fresh || dx * dx + dy * dy + dz * dz > TELEPORT_M2) {
      pv[0] = c[0]; pv[1] = c[1]; pv[2] = c[2]; // snap — never lerp across a jump
    }
    camHist.have = true;
    camHist.owner = sim;
  }

  // THE one sim.step() call site. input.buildCmd() carries edge latches that
  // survive "until buildCmd() has carried it" (core/input.js), so it must run
  // exactly once per tick — another reason the tick lives in one function.
  function stepSim() {
    bus.now = sim.state.time;
    sim.step(input.buildCmd()); // sim.step ticks sim.mission internally (v2.2)
    captureTick();
  }

  // Render-time player position: the last two ticks lerped by this frame's
  // alpha. Returns null before the live sim's first tick — viewmodel.js then
  // falls back to the raw current position, i.e. exactly today's behaviour.
  ctx.playerRenderPos = function playerRenderPos(alpha, out) {
    if (!camHist.have || camHist.owner !== sim) return null;
    const a = alpha >= 0 ? (alpha <= 1 ? alpha : 1) : 0; // also traps NaN
    const o = out || camHist.out;
    const pv = camHist.prev, c = camHist.curr;
    o[0] = pv[0] + (c[0] - pv[0]) * a;
    o[1] = pv[1] + (c[1] - pv[1]) * a;
    o[2] = pv[2] + (c[2] - pv[2]) * a;
    return o;
  };

  function viewUpdates(dt, alpha) {
    recoil.update(dt);
    vm.update(dt, alpha); // alpha drives the camera's POSITION only — never
    // yaw/pitch, which stay raw off input.state (interpolating look would buy
    // smoothness with input latency, which is the worse trade).
    // AFTER vm.update: while you are dead the rig early-outs without touching
    // the camera, so this writes into a genuinely free slot rather than
    // overwriting the rig's work every frame.
    killcam.update(dt);
    soldiers.update(dt, alpha);
    fx.update(dt);
    hud.update(dt);
    audio.update(dt);
    sky.update(dt);
    weather.update(dt);
    reflect.update(dt);
  }

  // Synchronous step+dispatch+render with gl.finish timing — hidden tabs have
  // no rAF; without this every automated check sees a dead game (§6, colosseum
  // pattern). Exposed to A11 through ctx.stepFrames.
  function stepFrames(n = 1, dtStep = DT) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      renderer.info.reset();
      stepSim();
      bridge.dispatch(bus.drain());
      // alpha 1 = the tick just stepped, so the interpolated base position is
      // IDENTICAL to p.pos and every captured battery frame is unchanged.
      viewUpdates(dtStep, 1);
      post.render(scene, camera);
    }
    const gl = renderer.getContext();
    if (gl && gl.finish) gl.finish();
    const totalMs = performance.now() - t0;
    const r = renderer.info.render;
    return {
      frames: n, totalMs: Math.round(totalMs * 100) / 100,
      msPerFrame: Math.round((totalMs / Math.max(1, n)) * 100) / 100,
      drawCalls: r ? r.calls : 0, triangles: r ? r.triangles : 0,
    };
  }

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const dtMs = nowMs - last;
    last = nowMs;
    // Lower clamp: the first rAF timestamp can precede the captured `last`,
    // and a negative dt freezes any LoopOnce mixer action at frame 0 (A8's
    // measured death-anim freeze). Never step time backwards.
    const dt = Math.min(Math.max(dtMs, 0) / 1000, 0.25);

    renderer.info.reset(); // autoReset=false discipline — once, here only

    if (pauseCtl.active) {
      acc = 0; // paused ⇒ no steps AND accumulator discarded (doctrine §5)
    } else {
      acc += dt;
      let steps = 0;
      // C27: clamp 3, not 5 — at 30 fps the normal case is 2 steps/frame, so
      // 3 gives one step of catch-up headroom; 5 permitted a 2.5× sim burst
      // on any hitch, which is how a hitch spirals into a stall.
      while (acc >= DT && steps < 3) {
        stepSim(); // steps the sim AND captures the camera's tick history
        acc -= DT;
        steps++;
      }
      if (steps === 3 && acc >= DT) {
        simStepsDropped += Math.floor(acc / DT); // AC-48 asserts this stays 0
        acc = 0; // clamp discards the remainder
      }
    }

    bridge.dispatch(bus.drain());
    // PAUSE: the branch above discards the accumulator (doctrine §5), so
    // acc/DT reads 0 while paused — which would yank every interpolated view
    // back a full tick on the frame the menu opens (up to 13 cm of camera at
    // slide speed, and the same backward hop the bot bodies already take
    // today). Nothing is stepping, so holding the last LIVE factor is exactly
    // "freeze the frame". The sim is untouched either way: alpha is a render
    // input only, and no sim step happens while paused.
    if (!pauseCtl.active) renderAlpha = acc / DT;
    const alpha = renderAlpha;
    viewUpdates(dt, alpha);
    dynres.update();
    post.render(scene, camera);
    perf.frame(dtMs);
  }

  // -------------------------------------------------------------------------
  // Phase 5 — compiling shaders (RT-bound pass + draws, then canvas pass).
  // -------------------------------------------------------------------------
  phase(5, "compiling shaders");
  await prewarm(renderer, scene, camera, [
    ...fx.prewarmables(),
    ...(vm.prewarmables ? vm.prewarmables() : []),
    ...(weather.prewarmables ? weather.prewarmables() : []),
  ]);

  // -------------------------------------------------------------------------
  // Phase 6 — ready.
  // -------------------------------------------------------------------------
  phase(6, "ready");
  if (bootEl) {
    bootEl.classList.add("gone");
    setTimeout(() => bootEl.remove(), 6000); // driftwake loading.js pattern
  }
  const hintEl = document.getElementById("hint");
  if (hintEl) hintEl.classList.add("show");
  menu.show("title");

  // Test surface + global — assigned at the END of phase 6 (§6).
  ctx.startMission = startMission;
  // [multi-arena amendment] W6's mode-select owns the MAP row and persists the
  // choice under "blackridge.map.v1"; its CALLERS (core/hud/menu.js startMatch,
  // core/hud/scoreboard.js rematch) still pass only {mode, difficulty}. Rather
  // than edit those two files, the arena rides the SAME localStorage channel
  // the difficulty row already uses to reach the campaign briefing (mode_select
  // H2): ctx.startMatch fills opts.map from loadMap(content.arenas) whenever
  // the caller omits it, and an explicit opts.map always wins. __test and any
  // future caller that passes `map` are unaffected.
  ctx.startMatch = (opts = {}) =>
    startMatch("map" in opts ? opts : Object.assign({}, opts, { map: loadMap(content.arenas) }));
  ctx.stepFrames = stepFrames;
  ctx.pauseCtl = pauseCtl;
  const scenarios = createScenarios(ctx);
  const autoplayCtl = createAutoplay(ctx);
  const __test = createTestSurface(ctx);
  // Route the shared members through their owning modules (A11 refines).
  // v2.2: forward ALL args — setScenario takes (name, seedObj) per R21,
  // autoplay takes (profile, seconds, opts).
  __test.setScenario = (name, seedObj) => scenarios.setScenario(name, seedObj);
  __test.autoplay = (profile, seconds, opts) => autoplayCtl.autoplay(profile, seconds, opts);
  // PVP surface (freeze amendment g, as amended by A1): startMission keeps
  // its campaign behaviour UNCHANGED; matches start only via startMatch.
  // These boot-side routes override testsurface's provisional
  // startMatch→startMission alias; W10 may later move them in-module.
  __test.startMatch = (opts) => startMatch(opts || {});
  __test.matchState = () =>
    sim.state.match ? JSON.parse(JSON.stringify(sim.state.match)) : null;
  __test.setMode = (id) => { defaultModeId = id; return defaultModeId; };
  __test.endMatch = (outcome) => {
    if (sim.match) sim.match.m.endMatch(outcome || { result: "forfeit", winnerTeam: null, reason: "test" });
    return !!sim.match;
  };

  window.__FPS__ = window.__FFG3D__ = {
    renderer, scene, camera,
    get sim() { return sim; },
    lights, fx, hud, vm, soldiers, audio,
    settings: S,
    version: `v${VN}`, // MUST equal the boot.js?v number
    _bridge: bridge, // private extra (v2.2): harness/diagnostic event taps —
    // not part of the frozen member set; register() handlers see the same
    // R13 event stream the view modules consume.
    perf,
    perfStats: perf.live, // R11: live counter object
    stats() {
      const s = perf.stats();
      return {
        fps: s.fps, frameMs: perf.live.frameMs,
        p50: s.p50, p95: s.p95, p99: s.p99, hitches: s.hitches,
        dpr: renderer.getPixelRatio(),
        drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs,
        geometries: s.geometries, textures: s.textures,
        bots: soldiers.count(), phase: sim.state.phase, frames: s.frames,
        simStepsDropped, // C27/AC-48 — must stay 0 over a full match
        match: sim.state.match ? { modeId: sim.state.match.modeId, phase: sim.state.match.phase } : null,
        version: `v${VN}`,
      };
    },
    __test,
  };
  console.log(`[boot] COMPLETE — __FPS__ assigned (v${VN})`);

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

  // ?fixture=<scenario>: skip menu, pose the world (names contract-gated
  // against content.json scenarios once A2/A11 land). ?bench=1 = S1 fixture +
  // autoplay('objective', 30) + benchDump (R10).
  if (isBench) {
    await __test.setScenario("S1");
    const report = await __test.autoplay("objective", 30);
    window.__BENCH__ = { report, perf: JSON.parse(perf.benchDump()) };
    try {
      await fetch("/__shot/bench.json", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(window.__BENCH__),
      });
    } catch (e) { console.warn("[bench] no shot server:", e && e.message); }
  } else if (fixtureName) {
    if (content.scenarios && !(fixtureName in content.scenarios)) {
      console.warn(`[boot] fixture '${fixtureName}' not in content.scenarios`);
    }
    await __test.setScenario(fixtureName);
  }
} catch (err) {
  fail(err && err.stack ? err.stack : err);
}
