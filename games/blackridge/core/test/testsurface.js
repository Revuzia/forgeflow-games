// core/test/testsurface.js [A11] — window.__FPS__.__test implementation.
// Architecture §6 as amended R11 (+freeze/hud/give/setAmmo, aliases
// startMatch→startMission, placePlayer→teleport+aim; perfStats member is
// A0's). BOOT SEAM (A0, changelog v2.1b): the createTestSurface(ctx) export
// name is frozen — boot constructs this once and assigns it to __FPS__.__test.
//
// ctx (from boot): THREE, renderer/scene/camera/canvas, settings/setSetting/
// onChange, bus/bridge/input/perf, layout/colliders/nav/content, weapons,
// sim() live getter, startMission(opts), stepFrames(n,dt) — the synchronous
// REAL step+dispatch+render path with gl.finish timing — pauseCtl, V, version.
//
// Doctrine §5 discipline baked in:
//  - fire()/press() dispatch REAL MouseEvent/KeyboardEvent through the input
//    layer — never a sim bypass. pin() (driftwake §0.4) is reserved for HELD
//    state that pointer lock would own (fire/ads/sprint holds).
//  - Everything timed advances by SIM TICKS via a hidden-tab-proof hybrid:
//    if rAF is driving the sim, wait on it; if not (hidden tab, or the
//    scenario holds the pause gate), drive ctx.stepFrames() directly.
//  - capture() renders THROUGH the real frame path (stepFrames → post chain)
//    and reads the default framebuffer back in the SAME synchronous task,
//    then POSTs /__shot/<name> — hidden-tab-proof, never a compositor
//    screenshot, never toDataURL-of-the-live-canvas (colosseum lineage).
//
// The surface ships in production (deployverify drives it), sits behind no
// flag, does nothing until called, and adds no per-frame cost.

export function createTestSurface(ctx) {
  const DT = 1 / 60;
  const F = () => window.__FPS__ || null;

  // ---------------------------------------------------------------- pins
  // Held-input pinning (driftwake pin()): pointer lock cannot be forged and
  // the page's own mouseup/blur handlers clear held flags — a constant getter
  // is the one write nothing can undo. Real EDGE inputs still go through
  // dispatched events; pinning is only for HELD state.
  const pins = new Map(); // key -> pre-pin value

  function pin(key, value = true) {
    const st = ctx.input.state;
    if (!pins.has(key)) pins.set(key, st[key]);
    Object.defineProperty(st, key, { get: () => value, configurable: true, enumerable: true });
  }

  function unpin(key) {
    const st = ctx.input.state;
    if (!pins.has(key)) return;
    const v = pins.get(key);
    pins.delete(key);
    Object.defineProperty(st, key, { value: v, writable: true, enumerable: true, configurable: true });
  }

  function unpinAll() { for (const k of [...pins.keys()]) unpin(k); }

  // ---------------------------------------------------------------- freeze
  // freeze(on): freeze the sim clock + bot AI for framing (harness_plan §1).
  // Implemented as a sim.step no-op patch on the CURRENT sim instance so it
  // needs no cooperation from the frame loop; __test.step() temporarily
  // restores the real step so "advance the FIXED-dt sim n steps while
  // frozen" works exactly as specified. NOTE: boot's frame loop still calls
  // mission.tick each accumulated slot while frozen — with sim.time not
  // advancing that is trigger-idempotent; scenarios that need a total hold
  // use pauseCtl (which gates both) and keep freeze for framing only.
  const frozen = { sim: null, realStep: null };

  function setFreeze(on) {
    const sim = ctx.sim();
    if (on) {
      if (frozen.sim === sim) return;
      if (frozen.sim) setFreeze(false); // stale instance from a previous mission
      frozen.sim = sim;
      frozen.realStep = sim.step;
      sim.step = function frozenStep() { /* frozen for framing (A11 freeze) */ };
    } else if (frozen.sim) {
      if (frozen.sim.step !== frozen.realStep) frozen.sim.step = frozen.realStep;
      frozen.sim = null;
      frozen.realStep = null;
    }
  }

  function stepReal(n, dt) {
    // Drive the real synchronous path even while frozen.
    if (frozen.sim && frozen.sim === ctx.sim()) {
      frozen.sim.step = frozen.realStep;
      try { return ctx.stepFrames(n, dt); }
      finally { frozen.sim.step = function frozenStep() {}; }
    }
    return ctx.stepFrames(n, dt);
  }

  // ---------------------------------------------------------------- ticks
  function raf() {
    return new Promise((resolve) => {
      let done = false;
      requestAnimationFrame(() => { done = true; resolve(); });
      // Hidden tabs never fire rAF — fall through so tickAdvance can drive.
      setTimeout(() => { if (!done) resolve(); }, 50);
    });
  }

  async function tickAdvance(n) {
    // Advance the sim by n ticks: passively if rAF is stepping it, actively
    // via stepFrames when it is not (hidden tab / pause-held scenario).
    const sim0 = ctx.sim();
    const target = sim0.state.tick + n;
    let last = sim0.state.tick;
    let stagnant = 0;
    let guard = 0;
    while (ctx.sim() === sim0 && sim0.state.tick < target) {
      if (++guard > n * 40 + 400) break; // absolute give-up, never hangs
      await raf();
      const t = sim0.state.tick;
      if (t === last) {
        if (++stagnant >= 2) {
          stepReal(Math.min(4, target - t), DT);
          stagnant = 0;
        }
      } else stagnant = 0;
      last = sim0.state.tick;
    }
  }

  // ---------------------------------------------------------------- aim
  function setAimTo(x, y, z) {
    const sim = ctx.sim();
    const p = sim.state.player;
    const ey = p.pos[1] + (p.stance === "crouch" ? 1.10 : 1.62);
    const dx = x - p.pos[0], dy = y - ey, dz = z - p.pos[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-9);
    // input.state.yaw/pitch is the AUTHORITATIVE aim source — the sim copies
    // cmd.yaw every tick (player.js), so writing sim state alone lasts one
    // tick. Look writes are the one sanctioned non-event input path
    // (harness_plan §2.5: pointer lock cannot be forged).
    ctx.input.state.yaw = yaw;
    ctx.input.state.pitch = pitch;
    sim.aimAt(x, y, z); // immediate effect within the current tick too
    return { yaw, pitch };
  }

  function setAimAngles(yaw, pitch) {
    ctx.input.state.yaw = yaw;
    ctx.input.state.pitch = Math.max(-1.55, Math.min(1.55, pitch || 0));
    const sim = ctx.sim();
    sim.state.player.yaw = ctx.input.state.yaw;
    sim.state.player.pitch = ctx.input.state.pitch;
  }

  // ---------------------------------------------------------------- events tracker
  // Harness-facing per-mission counters that the frozen sim counters do not
  // split out (botShotsFired/botShotsHit/botTimeToFirstShotMs — harness_plan
  // §2.5). Registered on the bridge AFTER each __test-driven startMission
  // (bridge.clear() on mission start drops old handlers; stale ones are
  // stamped out). Menu-button missions skip this tracker — the harness
  // always drives through __test.
  const track = {
    stamp: 0, missionStartT: 0,
    playerShotsFired: 0, botShotsFired: 0, botShotsHit: 0,
    grenadesThrown: 0, reloads: 0,
    botFirstShotMs: {}, firstPlayerDamageT: -1,
  };

  function attachTracker() {
    const stamp = ++track.stamp;
    const sim = ctx.sim();
    track.missionStartT = sim.state.time;
    track.playerShotsFired = 0; track.botShotsFired = 0; track.botShotsHit = 0;
    track.grenadesThrown = 0; track.reloads = 0;
    track.botFirstShotMs = {}; track.firstPlayerDamageT = -1;
    ctx.bridge.register("shot", (d) => {
      if (track.stamp !== stamp || !d) return;
      if (d.pen) return; // penetration face FX events, entity always null
      if (d.impactOnly) {
        // late-resolving swept projectile: counts as a HIT record only
        if (d.shooter !== "P" && d.hit && d.hit.entity === "P") track.botShotsHit++;
        return;
      }
      if (d.shooter === "P") track.playerShotsFired++;
      else {
        track.botShotsFired++;
        if (track.botFirstShotMs[d.shooter] == null) {
          track.botFirstShotMs[d.shooter] =
            Math.round((ctx.sim().state.time - track.missionStartT) * 1000);
        }
        if (d.hit && d.hit.entity === "P") track.botShotsHit++;
      }
    });
    ctx.bridge.register("hurt", (d) => {
      if (track.stamp !== stamp || !d) return;
      if (d.victim === "P" && track.firstPlayerDamageT < 0) {
        track.firstPlayerDamageT = ctx.sim().state.time - track.missionStartT;
      }
    });
    ctx.bridge.register("grenade", (d) => {
      if (track.stamp !== stamp || !d) return;
      if (d.phase === "out") track.grenadesThrown++;
    });
    ctx.bridge.register("reload", (d) => {
      if (track.stamp !== stamp || !d) return;
      if (d.who === "P" && d.phase === "done") track.reloads++;
    });
  }

  // ---------------------------------------------------------------- hud sweep
  const HUD_DOM = [
    "#hud", "#crosshair", "#hitmarker", "#killfeed", "#ammo", "#compass",
    "#objective", "#hint", ".overlay", "#perf", "#pause", "#pause-overlay",
    ".pause-overlay", "#damage-vignette", "#threat-ring", "#subtitles",
  ];

  // ---------------------------------------------------------------- surface
  const t = {
    async startMission(opts = {}) {
      setFreeze(false);
      unpinAll();
      const r = await ctx.startMission(opts);
      attachTracker();
      return r;
    },

    state() { return ctx.sim().snapshot(); },

    step(n = 1, dt = DT) { return stepReal(n, dt); },

    spawnBot(archetype, x, z, opts = {}) { return ctx.sim().spawnBot(archetype, x, z, opts); },

    teleport(x, y, z) { ctx.sim().teleport("P", x, y, z); },

    aimAt(x, y, z) { return setAimTo(x, y, z); },

    aimAtBot(botId, part = "body") {
      const b = ctx.sim().state.bots.find((b) => b.id === botId);
      if (!b) return null;
      // HIT_ZONES: head = top fraction; bot capsule ~1.8 m. Aim centers.
      const yOff = part === "head" ? 1.68 : part === "limb" ? 0.6 : 1.05;
      return setAimTo(b.pos[0], b.pos[1] + yOff, b.pos[2]);
    },

    async fire(n = 1) {
      // REAL input path (doctrine §5): mousedown/mouseup MouseEvents on #view
      // spanning n sim ticks. input.js listens mousedown on the canvas and
      // mouseup on window.
      const before = ctx.sim().state.counters.shotsFired;
      ctx.canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      await tickAdvance(Math.max(1, n | 0));
      window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
      return { ticks: n | 0, shotsFired: ctx.sim().state.counters.shotsFired - before };
    },

    fireRaw(ticks = 1) {
      // Fallback: pins input.state.fire for N ticks (synchronous).
      pin("fire", true);
      try { return stepReal(Math.max(1, ticks | 0), DT); }
      finally { unpin("fire"); }
    },

    async press(code, ms = 80) {
      // Real KeyboardEvent down/up (e.g. 'KeyR'), spanning the sim ticks the
      // duration implies — frames, never wall clock.
      window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
      await tickAdvance(Math.max(1, Math.round((ms / 1000) * 60)));
      window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      return true;
    },

    look(dyaw, dpitch) { ctx.input.addLook(dyaw, dpitch); },

    damage(who, amount) { ctx.sim().damage(who, amount, "test"); },
    god(on) { ctx.sim().setGod(!!on); },
    noTarget(on) { ctx.sim().setNoTarget(!!on); },

    counters() {
      return {
        ...ctx.sim().state.counters,
        events: ctx.bus.countsByType(),
        harness: {
          playerShotsFired: track.playerShotsFired,
          botShotsFired: track.botShotsFired,
          botShotsHit: track.botShotsHit,
          grenadesThrown: track.grenadesThrown,
          reloads: track.reloads,
          botTimeToFirstShotMs: { ...track.botFirstShotMs },
          firstPlayerDamageT: track.firstPlayerDamageT,
        },
      };
    },

    resetCounters() { ctx.bus.resetCounters(); },

    // setScenario/autoplay are routed by boot to scenarios.js/autoplay.js
    // (createScenarios/createAutoplay own the implementations); these bodies
    // only exist so the surface is complete if boot's routing ever changes.
    async setScenario() { throw new Error("__test.setScenario not routed (boot wiring missing)"); },
    async autoplay() { throw new Error("__test.autoplay not routed (boot wiring missing)"); },

    /**
     * Render one REAL frame (full step+dispatch+post chain via stepFrames)
     * at w×h/dpr, read the default framebuffer back in the same synchronous
     * task, downscale, and POST /__shot/<name>. Hidden-tab-proof: nothing
     * here depends on rAF or the compositor. If the caller left the sim
     * frozen (scenario hold), the frame renders without advancing the sim.
     *
     * window.__BR_SCENARIO__.captureDrive === 'untilShot' (set by
     * scenarios.js for muzzle-flash framings) makes the capture step until a
     * fresh player shot lands in the FINAL stepped tick, so the flash sprite
     * + leased light are live in the read-back frame (55 ms flash cannot
     * survive real-time settle waits — it must be re-armed at capture time).
     */
    async capture(name = "shot.png", w = 1600, h = 900, opts = {}) {
      const { renderer, camera } = ctx;
      const THREE = ctx.THREE;
      const gl = renderer.getContext();
      const prevPR = renderer.getPixelRatio();
      const prevSize = renderer.getSize(new THREE.Vector2());
      const prevAspect = camera.aspect;
      const dpr = opts.dpr || prevPR;
      const post = ctx.post || (F() && F().post) || null;

      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      if (post && post.resize) post.resize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      let buf, dbw, dbh;
      try {
        // ---- synchronous section: render + read in ONE task -------------
        const drive = (window.__BR_SCENARIO__ && window.__BR_SCENARIO__.captureDrive) || null;
        if (drive === "untilShot") {
          const c0 = ctx.sim().state.counters.shotsFired;
          const max = (window.__BR_SCENARIO__.maxTicks | 0) || 14;
          let stepped = 0;
          while (ctx.sim().state.counters.shotsFired === c0 && stepped < max) {
            stepReal(1, DT);
            stepped++;
          }
          // the shot tick itself rendered with the flash at age <= 1 tick
          if (stepped === 0) stepReal(1, DT);
        } else {
          stepReal(1, DT);
        }
        renderer.setRenderTarget(null);
        dbw = gl.drawingBufferWidth;
        dbh = gl.drawingBufferHeight;
        buf = new Uint8Array(dbw * dbh * 4);
        gl.readPixels(0, 0, dbw, dbh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        // ------------------------------------------------------------------
      } finally {
        renderer.setPixelRatio(prevPR);
        renderer.setSize(prevSize.x, prevSize.y, false);
        if (post && post.resize) post.resize(prevSize.x, prevSize.y);
        camera.aspect = prevAspect;
        camera.updateProjectionMatrix();
      }

      // GL origin is bottom-left; canvas is top-left — flip rows.
      const src = document.createElement("canvas");
      src.width = dbw; src.height = dbh;
      const sctx = src.getContext("2d");
      const img = sctx.createImageData(dbw, dbh);
      const row = dbw * 4;
      for (let y = 0; y < dbh; y++) {
        img.data.set(buf.subarray((dbh - 1 - y) * row, (dbh - y) * row), y * row);
      }
      sctx.putImageData(img, 0, 0);

      // Downscale the DPR-supersampled buffer to the presentation size.
      let out = src;
      if (dbw !== w || dbh !== h) {
        out = document.createElement("canvas");
        out.width = w; out.height = h;
        const octx = out.getContext("2d");
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        octx.drawImage(src, 0, 0, w, h);
      }

      const url = out.toDataURL(opts.jpeg ? "image/jpeg" : "image/png", opts.quality ?? 0.92);
      let server = null;
      try {
        const res = await fetch(`/__shot/${name}`, { method: "POST", body: url });
        server = await res.text();
      } catch (e) {
        server = "POST failed: " + (e && e.message);
      }
      return { name, w, h, bytes: url.length, server };
    },

    pause(on) { on ? ctx.pauseCtl.pause() : ctx.pauseCtl.resume(); },

    setTimeOfDay(k) {
      // 'night' (default) | 'dusk' — night is the only shipped state (R2).
      window.__BR_TIMEOFDAY__ = k;
      const sky = ctx.sky || (F() && F().sky) || null;
      if (sky && typeof sky.setTimeOfDay === "function") sky.setTimeOfDay(k);
      return k;
    },

    // ---- R11 additions ---------------------------------------------------
    freeze(on) { setFreeze(!!on); return !!on; },

    hud(show) {
      const hud = ctx.hud || (F() && F().hud) || null;
      if (hud) { try { show ? hud.show() : hud.hide(); } catch (e) { /* stub */ } }
      for (const sel of HUD_DOM) {
        document.querySelectorAll(sel).forEach((el) => {
          el.style.display = show ? "" : "none";
        });
      }
      return !!show;
    },

    give(weaponId) { ctx.sim().givePlayerWeapon(weaponId); return ctx.sim().state.player.weapon.id; },
    setAmmo(n) { ctx.sim().setAmmo(n); return ctx.sim().state.player.weapon.mag; },

    // ---- private additions (harness helpers — additive, never frozen) ----
    pin, unpin, unpinAll,
    isPaused() { return !!ctx.pauseCtl.active; },
    isFrozen() { return !!frozen.sim; },
    setAimAngles,
    tickAdvance,
  };

  // Compatibility aliases (R11).
  t.startMatch = (opts = {}) => t.startMission(opts);
  t.placePlayer = (x, y, z, yaw = 0, pitch = 0) => {
    t.teleport(x, y, z);
    setAimAngles(yaw, pitch);
  };

  return t;
}
