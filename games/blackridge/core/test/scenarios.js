// core/test/scenarios.js [A11] — deterministic scenario poses for the R10
// battery (ids S1–S9/C1/menu/bench). BOOT SEAM (A0, changelog v2.1b): the
// createScenarios(ctx) export name is frozen; boot routes
// __test.setScenario → this module.
//
// TWO data sources, one vocabulary (R10/R21):
//   - content.json `scenarios` (A2) — the POSES: camera, player, bots,
//     worldState. Contract-gated: an unknown id throws.
//   - _harness/shots.js SCENARIOS (A11) — the SEED TABLE + capture params.
//     The harness passes that object as the second argument
//     (setScenario(id, seedObj)), or pre-plants it as window.__BR_SEEDS__
//     (shotbattery does both — boot's one-arg routing lambda drops extra
//     args, so the window fallback is what actually carries it until A0
//     forwards the second parameter). Where both define a value the
//     HARNESS seed table wins (R21: "the per-scenario seed table lives in
//     shots.js").
//
// setScenario is ATOMIC per R21: full real mission start on the scenario
// seed (fresh sim ⇒ zeroed clock/transients), every mulberry32 stream
// re-seeded explicitly, sky/rain phase frozen via A6 hooks when present,
// bots posed with PINNED cmd structs (posed under running clips via the
// real locomotion path — never thinking, so an A5 AI change can never move
// a framed bot between critic iterations), then the world is HELD via the
// pause gate (frame loop takes zero sim steps; capture()'s stepFrames path
// still advances exactly the ticks it needs).
//
// KNOWN SEAMS (flagged as needsElsewhere, coded defensively here):
//   - boot's external `mission` closure still ticks inside stepFrames while
//     capture drives frames; with the pause hold engaged the rAF loop takes
//     no steps, so exposure is ≤ the handful of capture ticks (deterministic
//     per seed, but a reach-trigger CAN fire during them — bounded, logged).
//   - weather/sky/post/menu are not on ctx or __FPS__ yet; every hook call
//     below is optional-chained and reported in the returned `warnings`.

import { mulberry32 } from "../rng.js";

export function createScenarios(ctx) {
  const DT = 1 / 60;

  const surface = () => (window.__FPS__ && window.__FPS__.__test) || null;

  // ------------------------------------------------------------ helpers
  function resolvePose(name) {
    const table = (ctx.content && ctx.content.scenarios) || {};
    let pose = table[name];
    if (!pose) {
      throw new Error(
        `[scenarios] unknown scenario id '${name}' — not in content.json scenarios ` +
        `(have: ${Object.keys(table).filter((k) => !k.startsWith("_")).join(", ")})`);
    }
    if (pose.extends) {
      const base = table[pose.extends];
      if (!base) throw new Error(`[scenarios] '${name}' extends unknown '${pose.extends}'`);
      pose = { ...base, ...pose };
    }
    return pose;
  }

  function resolveSeedObj(name, seedObj) {
    if (seedObj && typeof seedObj === "object") return seedObj;
    const t = window.__BR_SEEDS__;
    return (t && t[name]) || null;
  }

  // Find a named mission spawn (scenario bots reference wave spawn ids).
  function findSpawn(id) {
    const waves = (ctx.content && ctx.content.mission && ctx.content.mission.spawns
      && ctx.content.mission.spawns.waves) || [];
    for (const w of waves) {
      for (const b of w.bots || []) if (b.id === id) return b;
    }
    return null;
  }

  function eyeOf(p) {
    return [p.pos[0], p.pos[1] + (p.stance === "crouch" ? 1.10 : 1.62), p.pos[2]];
  }

  function yawPitchFromTo(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.max(-1.55, Math.min(1.55, Math.atan2(dy, Math.hypot(dx, dz) || 1e-9))),
    };
  }

  // Despawn every mission-spawned bot (scenarios pose their OWN cast) and
  // dispatch the pending event backlog minus the spawn events of the bots
  // that no longer exist — soldiers must never learn of them.
  function clearMissionBots(warnings) {
    const sim = ctx.sim();
    const removed = new Set(sim.state.bots.map((b) => b.id));
    sim.state.bots.length = 0;
    if (sim.squad && typeof sim.squad.reset === "function") sim.squad.reset();
    if (sim.internal) {
      if (Array.isArray(sim.internal.projectiles)) sim.internal.projectiles.length = 0;
      if (Array.isArray(sim.internal.grenades)) sim.internal.grenades.length = 0;
    }
    const evs = ctx.bus.drain().filter(
      (e) => !(e.type === "spawn" && e.data && removed.has(e.data.botId)));
    ctx.bridge.dispatch(evs);
    if (removed.size) warnings.push(`despawned ${removed.size} mission bots for the pose`);
  }

  // Pose one scenario bot: spawn through the real sim path, then PIN its cmd
  // (Object.defineProperty — same discipline as input pinning) so the brain
  // cannot repose it; anim comes from the REAL locomotion/weapon paths.
  function poseBot(spec, playerEye, warnings) {
    const sim = ctx.sim();
    let base = null;
    if (spec.spawn) {
      base = findSpawn(spec.spawn);
      if (!base) {
        warnings.push(`bot spawn id '${spec.spawn}' not found in mission waves — skipped`);
        return null;
      }
    }
    const archetype = spec.archetype || (base && base.archetype) || "rifleman";
    const pos = spec.pos || (base && base.pos) || [0, 0, 0];
    const yaw = spec.yaw != null ? spec.yaw : (base && base.yaw) || 0;
    const band = (base && base.band) || "regular";
    const id = sim.spawnBot(archetype, pos[0], pos[2], {
      y: pos[1], yaw, alerted: true, band,
    });
    const bot = sim.state.bots.find((b) => b.id === id);
    if (!bot) return null;

    if (spec.state) bot.state = spec.state;
    // Aim the framed bot at the player (combat poses read as engaged).
    const aim = yawPitchFromTo([bot.pos[0], bot.pos[1] + 1.62, bot.pos[2]], playerEye);
    bot.yaw = spec.yaw != null ? spec.yaw : aim.yaw;
    if (spec.state === "combat") bot.aimAt = playerEye.slice();

    const frozenCmd = {
      moveX: 0,
      moveZ: spec.moving || spec.anim === "run" || spec.anim === "walk" ? 1 : 0,
      yaw: bot.yaw, pitch: spec.state === "combat" ? aim.pitch : 0,
      jump: false, crouch: !!spec.crouch,
      sprint: spec.anim === "run" || !!spec.moving,
      fire: !!spec.firing, ads: !!spec.firing,
      reload: false, switchTo: null, interact: false, grenade: false,
    };
    try {
      Object.defineProperty(bot, "cmd", {
        get: () => frozenCmd,
        set: () => { /* scenario-pinned: the brain may not repose a framed bot */ },
        configurable: true,
      });
      bot._scenarioPinned = true;
    } catch (e) {
      warnings.push(`could not pin bot ${id} cmd: ${e.message}`);
    }
    return id;
  }

  function applyWorldHooks(pose, seedObj, warnings) {
    const F = window.__FPS__ || {};
    const rainPhase = (seedObj && seedObj.rainPhase != null) ? seedObj.rainPhase
      : (pose.rainPhase != null ? pose.rainPhase : 0.25);
    const timeOfDay = (seedObj && seedObj.timeOfDay) || pose.timeOfDay || "night";

    const weather = ctx.weather || F.weather || null;
    if (weather && typeof weather.setPhase === "function") {
      weather.setPhase(rainPhase);
      if (typeof weather.freeze === "function") weather.freeze(true);
    } else {
      warnings.push("weather phase-freeze hook unavailable (A6 setPhase/freeze pending) — rain not phase-locked");
    }

    const sky = ctx.sky || F.sky || null;
    if (sky && typeof sky.setTimeOfDay === "function") sky.setTimeOfDay(timeOfDay);
    if (sky && typeof sky.freeze === "function") sky.freeze(true);
    else warnings.push("sky freeze hook unavailable (A6 pending) — cloud scroll not pinned");

    if (pose.worldState && pose.worldState.blackout != null) {
      const lights = F.lights || null;
      if (lights && typeof lights.setBlackout === "function") {
        lights.setBlackout(!!pose.worldState.blackout);
      } else if (pose.worldState.blackout) {
        warnings.push("blackout requested but lights.setBlackout unavailable (A6 pending)");
      }
    }
    return { rainPhase, timeOfDay };
  }

  function applyCamera(pose, sim, botIds) {
    const cam = ctx.camera;
    const c = pose.camera || {};
    if (c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    if (pose.cameraDetached && c.pos && c.lookAt) {
      window.__BR_CAMDETACH__ = true; // camera-rig lanes must respect this
      ctx.cameraDetached = true;      // v2.2: A4's rig gates on ctx.cameraDetached
      // v2.3 (F4): relToBot — pos/lookAt become OFFSETS from a posed bot's
      // POST-SETTLE position. Pinned running bots displace during the settle
      // ticks (locomotion is real, R21), so an absolute close-up camera
      // drifts off its subject; anchoring to the bot keeps the authored
      // framing distance exact regardless of clip speed.
      let base = [0, 0, 0];
      if (c.relToBot != null && botIds && botIds[c.relToBot] != null) {
        const b = sim.state.bots.find((x) => x.id === botIds[c.relToBot]);
        if (b) base = b.pos;
      }
      cam.position.set(base[0] + c.pos[0], base[1] + c.pos[1], base[2] + c.pos[2]);
      cam.lookAt(base[0] + c.lookAt[0], base[1] + c.lookAt[1], base[2] + c.lookAt[2]);
      return;
    }
    window.__BR_CAMDETACH__ = false;
    ctx.cameraDetached = false;
    // First-person: camera at the player eye, oriented from sim yaw/pitch.
    // (No camera rig exists yet in the skeleton; when one lands it writes the
    // same values each frame — this seeds the correct pose either way.)
    const p = sim.state.player;
    const eye = eyeOf(p);
    cam.position.set(eye[0], eye[1], eye[2]);
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = "YXZ";
    cam.rotation.y = p.yaw;
    cam.rotation.x = p.pitch;
  }

  function stepTicks(n) {
    const T = surface();
    if (T) return T.step(n, DT);       // freeze-aware real path
    return ctx.stepFrames(n, DT);
  }

  // ------------------------------------------------------------ unstick
  // A pose may place the player INSIDE static geometry. The sim handles that
  // the only way it can — the capsule is blocked on every axis, so the move
  // solver rejects the whole displacement and zeroes velocity — and the
  // player is welded in place for the rest of the take with no error
  // anywhere. That is how C1 shipped a "6-second sprint capture" of a man
  // standing still through iterations 3 and 4: its authored start
  // (-14, 0, 34) sits 0.35 m inside collider `bld_s1` (x -41..-14,
  // z 18..42), exactly one capsule radius past the building's east face.
  //
  // setScenario is the generator for every captured frame, so it refuses to
  // emit an unsatisfiable pose: the player is pushed to the nearest clear
  // standing spot and the correction is reported LOUDLY in warnings +
  // console, because the durable fix is the authored pose in content.json
  // and a silent nudge would hide it forever.
  const CAPSULE_R = 0.35;   // MOVE.CAPSULE_R (core/sim/player.js)
  const STAND_H = 1.8;      // MOVE.STAND_H

  function unstickPlayer(sim, warnings) {
    const w = sim.world;
    if (!w || typeof w.capsuleBlocked !== "function") {
      warnings.push("spawn-clearance check skipped — sim.world.capsuleBlocked unavailable");
      return null;
    }
    const p = sim.state.player;
    const at = (x, z) => w.capsuleBlocked(x, p.pos[1], z, CAPSULE_R, STAND_H);
    const hit = at(p.pos[0], p.pos[2]);
    if (!hit) return null;

    const from = p.pos.slice();
    // Ring search outward from the authored point: nearest clear spot wins,
    // so the framing moves as little as the geometry allows.
    for (let rad = 0.25; rad <= 4.0 + 1e-6; rad += 0.25) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = from[0] + Math.cos(a) * rad;
        const z = from[2] + Math.sin(a) * rad;
        if (!at(x, z)) {
          sim.teleport("P", x, from[1], z);
          const info = {
            from, to: [+x.toFixed(3), from[1], +z.toFixed(3)],
            movedM: +rad.toFixed(2),
            blockedBy: (hit && (hit.id || hit.kind)) || "unknown",
            bbox: hit && hit.min && hit.max ? [hit.min, hit.max] : null,
          };
          const msg =
            `SPAWN INSIDE GEOMETRY: authored player pos [${from}] is inside ` +
            `collider '${info.blockedBy}' — the capsule is blocked on every ` +
            `axis, so the move solver zeroes velocity and the player CANNOT ` +
            `move for the whole take. Nudged ${info.movedM} m to ` +
            `[${info.to}]. FIX THE POSE in content.json.`;
          warnings.push(msg);
          console.warn("[scenarios] " + msg);
          return info;
        }
      }
    }
    const msg = `SPAWN INSIDE GEOMETRY and no clear standing spot within 4 m ` +
                `of [${from}] (collider '${(hit && (hit.id || hit.kind)) || "unknown"}') ` +
                `— the player will not move in this scenario.`;
    warnings.push(msg);
    console.warn("[scenarios] " + msg);
    return { from, to: null, movedM: null,
             blockedBy: (hit && (hit.id || hit.kind)) || "unknown" };
  }

  // ------------------------------------------------------------ setScenario
  async function setScenario(name, seedObj) {
    const warnings = [];
    const pose = resolvePose(name);
    const cap = resolveSeedObj(name, seedObj);
    const seed = (cap && cap.seed != null) ? cap.seed : (pose.seed != null ? pose.seed : 1);
    const botSeed = (cap && cap.botSeed != null) ? cap.botSeed : seed + 1000;
    const hudOn = (cap && cap.hud != null) ? !!cap.hud : !!pose.hud;

    const T = surface();
    if (!T) throw new Error("[scenarios] __FPS__.__test not assigned yet");

    // Reset any prior scenario residue.
    T.freeze(false);
    T.unpinAll();
    window.__BR_SCENARIO__ = null;
    if (ctx.pauseCtl.active) ctx.pauseCtl.resume();
    if (ctx.settings && window.__BR_FOV0__ != null) {
      ctx.settings.fov = window.__BR_FOV0__; // restore pre-scenario base FOV
      window.__BR_FOV0__ = null;
    }

    // ---- cinematic FOV (F4, iter01 fix): the viewmodel rig re-writes
    // camera.fov EVERY driven frame from its base = settings.fov (74) blended
    // toward the weapon's adsFov — so a pose's camera.fov never survives to
    // the capture on first-person scenarios (iter01 S1/S3/S4 all rendered at
    // 74, not their authored 55/58/44). The rig's own base channel IS the
    // sanctioned input: write the pose fov to settings.fov directly (a plain
    // mutable object; bypassing set() on purpose — battery framings may sit
    // below the player-facing 60–90 clamp, and a direct write never touches
    // localStorage or listeners). Restored on the next setScenario; battery
    // page-reloads reset it anyway. ADS poses are unaffected: at adsT=1 the
    // rig's fov = adsFov regardless of base. Detached poses keep applyCamera's
    // direct write (the rig does not drive while ctx.cameraDetached).
    if (ctx.settings && pose.camera && pose.camera.fov && !pose.cameraDetached) {
      window.__BR_FOV0__ = ctx.settings.fov;
      ctx.settings.fov = pose.camera.fov;
    }

    // ---- menu: no mission. Fresh page loads sit on the title screen; if a
    // mission is already live we cannot return to menu from here (menu ref
    // not exposed) — reported honestly.
    if (pose.kind === "menu") {
      const live = ctx.sim().state.phase !== "menu";
      if (live) warnings.push("mission already live — menu scenario needs a fresh page load");
      T.hud(false);
      return { name, seed, botSeed, kind: "menu", warnings };
    }

    // ---- full real mission start on the scenario seed (fresh sim: clock 0,
    // zero transients; mission:start clears fx pools per the event table).
    await T.startMission({ seed });
    const sim = ctx.sim();

    // ---- re-seed EVERY stream atomically (R21). ai gets the independent
    // botSeed so bot rolls never depend on spread-stream ordering. Streams
    // are read at call time (verified: sim.rng.spread at player.js:553).
    sim.rng.spread = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    sim.rng.ai = mulberry32(botSeed >>> 0);
    sim.rng.mission = mulberry32((seed ^ 0xc2b2ae35) >>> 0);
    sim.rng.fx = mulberry32((seed ^ 0x27d4eb2f) >>> 0);

    // ---- clear the mission's own cast; pose ours.
    clearMissionBots(warnings);

    // ---- player pose
    const pp = pose.player || {};
    if (pp.pos) sim.teleport("P", pp.pos[0], pp.pos[1], pp.pos[2]);
    if (pp.weapon && sim.state.player.weapon.id !== pp.weapon) {
      sim.givePlayerWeapon(pp.weapon);
    }
    if (pp.god) sim.setGod(true);
    if (pp.noTarget) sim.setNoTarget(true);

    // Clearance BEFORE aim/bots/camera: an unstick moves the eye, and
    // everything downstream is computed from the player's final position.
    const unstuck = unstickPlayer(sim, warnings);

    // aim: camera lookAt is authoritative (A2 contract note); fall back to yaw.
    if (pose.camera && pose.camera.pos && pose.camera.lookAt && !pose.cameraDetached) {
      const a = yawPitchFromTo(pose.camera.pos, pose.camera.lookAt);
      T.setAimAngles(a.yaw, a.pitch);
    } else if (pp.yaw != null) {
      T.setAimAngles(pp.yaw, pp.pitch || 0);
    }

    // ---- world hooks (rain phase, time of day, blackout)
    const world = applyWorldHooks(pose, cap, warnings);

    // ---- bots
    const playerEye = eyeOf(sim.state.player);
    const botIds = [];
    for (const spec of pose.bots || []) {
      const id = poseBot(spec, playerEye, warnings);
      if (id != null) botIds.push(id);
    }

    // ---- the pose OWNS the cast: when `bots` is declared (even empty),
    // the live mission's wave spawner may not repopulate the frame. iter01
    // C1 lesson: the scripted sprint crossed the infil→assault reach
    // trigger, wave bots spawned mid-capture and killed the player
    // mid-reload, so `until: reloads > 0` could never fire and the frame
    // was a different scene every run. Installed AFTER poseBot (which
    // spawns through the same seam); dies with this sim instance — every
    // setScenario/startMission builds a fresh sim. Autoplay poses (bench)
    // keep the spawner: their live combat IS the fixture.
    if (Array.isArray(pose.bots) && !pose.autoplay) {
      const realSpawnFromSpec = sim.spawnBotFromSpec;
      let dropped = 0;
      sim._scenarioCastLock = true;
      sim.spawnBotFromSpec = function (spec) {
        if (sim._scenarioCastLock && !(spec && spec._scenarioPose)) { dropped++; return null; }
        return realSpawnFromSpec.call(this, spec);
      };
      sim._scenarioSpawnsDropped = () => dropped;
      warnings.push("mission wave spawner locked — the pose owns the cast");
    }

    // ---- viewmodel state
    const F = window.__FPS__ || {};
    if (pp.lowered && F.vm) {
      if (typeof F.vm.setLowered === "function") F.vm.setLowered(true);
      else if (typeof F.vm.setVisible === "function") F.vm.setVisible(false);
    }

    // ---- C1 / bench: LIVE scenarios — the battery script (C1) or autoplay
    // (bench) drives from here; no hold, no action steps. content.json's C1
    // `script` is pose metadata; the driving script lives in shots.js and is
    // dispatched by shotbattery.py through real events.
    const live = !!pose.captureSeconds || !!pose.autoplay || name === "C1" || name === "bench";
    if (live) {
      ctx.input.enabled = true;
      T.hud(hudOn);
      stepTicks(6); // one breath so state derives before the script starts
      return { name, seed, botSeed, ...world, bots: botIds.length, live: true,
               unstuck, startPos: sim.state.player.pos.map((v) => +v.toFixed(3)),
               warnings };
    }

    // ---- action: ADS settle / fire burst
    if (pp.ads) {
      T.pin("ads", true);
      let guard = 0;
      while (sim.state.player.weapon.adsT < 0.99 && guard++ < 90) stepTicks(1);
      if (sim.state.player.weapon.adsT < 0.99) warnings.push("adsT never reached 1 within 90 ticks");
    }
    if (pp.action === "fireBurst") {
      T.pin("fire", true);
      const want = Math.max(1, (pp.rounds || 4) - 1); // leave the LAST round for capture time
      let guard = 0;
      const c0 = sim.state.counters.shotsFired;
      while (sim.state.counters.shotsFired - c0 < want && guard++ < 180) stepTicks(1);
      if (sim.state.counters.shotsFired === c0) warnings.push("fireBurst: no shots fired in 180 ticks");
      // capture() steps until a FRESH shot lands in its final tick so the
      // 55 ms flash + leased light are live in the read-back frame.
      window.__BR_SCENARIO__ = { captureDrive: "untilShot", maxTicks: 20 };
    } else {
      // settle the posed world a fixed tick count (deterministic per seed)
      stepTicks(30);
    }

    // ---- paused overlay (S6) — REAL ESC path first, pauseCtl fallback.
    if (pose.paused || pose.overlay === "pause") {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape", bubbles: true }));
      if (!ctx.pauseCtl.active) {
        warnings.push("ESC dispatch did not pause (pause.js pending) — engaged pauseCtl directly");
        ctx.pauseCtl.pause();
      }
    } else {
      // HOLD: the frame loop takes zero sim steps while paused (accumulator
      // discarded); capture()'s stepFrames path advances exactly what it
      // needs. Beauty shots sweep the pause overlay away via hud(false).
      ctx.pauseCtl.pause();
    }
    // The capture-time driven ticks still build cmds; pause implementations
    // may gate input.enabled — re-enable so pinned fire reaches the sim.
    ctx.input.enabled = true;

    // ---- camera LAST (action steps may have nudged the player pose)
    applyCamera(pose, sim, botIds);

    // ---- HUD per the merged flag (battery re-applies its own cap after).
    T.hud(hudOn);

    return {
      name, seed, botSeed, ...world, bots: botIds.length, unstuck,
      held: true, paused: ctx.pauseCtl.active,
      playerPos: sim.state.player.pos.map((v) => +v.toFixed(3)),
      yaw: +sim.state.player.yaw.toFixed(4),
      pitch: +sim.state.player.pitch.toFixed(4),
      warnings,
    };
  }

  return { setScenario };
}
