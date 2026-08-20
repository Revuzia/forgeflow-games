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
    { buildLayout }, { buildColliders }, { buildLevel }, { buildProps }, /*materials*/,
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

  const layout = buildLayout(seedParam);
  const colliders = buildColliders(seedParam);
  const nav = bakeNav(colliders);
  const levelOut = await buildLevel({ THREE, renderer, scene, layout, settings: S });
  scene.add(levelOut.group);
  const propsOut = buildProps(layout, { THREE, scene, settings: S });
  scene.add(propsOut.group);

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

  // ---------------------------------------------------------------------------
  // Frame stepping — shared by the rAF loop and the synchronous test path.
  // ---------------------------------------------------------------------------
  const DT = 1 / 60;
  let acc = 0;
  let last = performance.now();

  function viewUpdates(dt, alpha) {
    recoil.update(dt);
    vm.update(dt);
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
      bus.now = sim.state.time;
      sim.step(input.buildCmd()); // sim.step ticks sim.mission internally (v2.2)
      bridge.dispatch(bus.drain());
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
      while (acc >= DT && steps < 5) {
        bus.now = sim.state.time;
        sim.step(input.buildCmd()); // sim.step ticks sim.mission internally (v2.2)
        acc -= DT;
        steps++;
      }
      if (steps === 5) acc = 0; // clamp discards the remainder
    }

    bridge.dispatch(bus.drain());
    const alpha = acc / DT;
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
