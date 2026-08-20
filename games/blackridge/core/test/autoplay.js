// core/test/autoplay.js [A11] — scripted PLAY profiles with event counters
// (architecture §6.2; R29 personas). BOOT SEAM (A0, changelog v2.1b): the
// createAutoplay(ctx) export name is frozen.
//
// Doctrine §5: every action goes through the REAL input path —
// KeyboardEvent/MouseEvent dispatched on window/#view, exactly what a hand
// on the keyboard produces. The ONE non-real path is look: pointer lock
// cannot be forged, so yaw/pitch are written to input.state directly
// (harness_plan §2.5 sanctions this and requires saying so — said here).
//
// Profiles (architecture §6.2 + R29 union):
//   rusher     sprint at nearest alive bot, hip fire inside 15 m
//   sniper     hold position, ADS, single taps on LOS
//   objective  path to the active objective, engage on contact, interact
//   idle       stand still (fairness probe)
//   optimal    = Tactician (R29): cover-ish bursts, ADS, relocate, retreat low
//   novice     350–500 ms delayed reactions, walks, wide aim jitter
//   camper     holds one position, fires only on LOS
//
// Report (frozen §6.2 shape + additive fields for playprobe's assertions):
//   { seconds, counters, kills, deaths, hp, phase, accuracy,
//     timeToFirstContact, perf,
//     playerDeaths:[{t,attacker,archetype}], stuckBotSeconds, endedByPhase }

import { mulberry32 } from "../rng.js";

export function createAutoplay(ctx) {
  const DT = 1 / 60;

  // ------------------------------------------------------------ real input
  const held = { keys: new Set(), mouse: new Set() };

  function keyDown(code) {
    if (held.keys.has(code)) return;
    held.keys.add(code);
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  }
  function keyUp(code) {
    if (!held.keys.delete(code)) return;
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  }
  function tapKey(code) {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  }
  function mouseDown(button = 0) {
    if (held.mouse.has(button)) return;
    held.mouse.add(button);
    ctx.canvas.dispatchEvent(new MouseEvent("mousedown", { button, bubbles: true }));
  }
  function mouseUp(button = 0) {
    if (!held.mouse.delete(button)) return;
    window.dispatchEvent(new MouseEvent("mouseup", { button, bubbles: true }));
  }
  function releaseAll() {
    for (const c of [...held.keys]) keyUp(c);
    for (const b of [...held.mouse]) mouseUp(b);
  }

  function aimAt(x, y, z, jitterRad = 0, rng = Math.random) {
    // look = the sanctioned non-real path (pointer lock cannot be forged)
    const sim = ctx.sim();
    const p = sim.state.player;
    const ey = p.pos[1] + (p.stance === "crouch" ? 1.10 : 1.62);
    const dx = x - p.pos[0], dy = y - ey, dz = z - p.pos[2];
    let yaw = Math.atan2(-dx, -dz);
    let pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-9);
    if (jitterRad > 0) {
      yaw += (rng() * 2 - 1) * jitterRad;
      pitch += (rng() * 2 - 1) * jitterRad;
    }
    ctx.input.state.yaw = yaw;
    ctx.input.state.pitch = Math.max(-1.55, Math.min(1.55, pitch));
  }

  // ------------------------------------------------------------ world reads
  function alive(sim) { return sim.state.bots.filter((b) => b.alive); }

  function nearestBot(sim) {
    const p = sim.state.player.pos;
    let best = null, bd = Infinity;
    for (const b of alive(sim)) {
      const d = Math.hypot(b.pos[0] - p[0], b.pos[2] - p[2]);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { bot: best, dist: bd } : null;
  }

  function hasLOS(sim, bot) {
    if (!sim.world || typeof sim.world.losBlocked !== "function") return true;
    const p = sim.state.player;
    const eye = [p.pos[0], p.pos[1] + 1.62, p.pos[2]];
    return !sim.world.losBlocked(eye, [bot.pos[0], bot.pos[1] + 1.3, bot.pos[2]]);
  }

  function objectiveTarget(sim) {
    // active objective → node coordinate; 'clear' kinds → nearest bot; no
    // bots yet → march the beat-checkpoint chain (waves trigger on approach).
    const objs = (ctx.content && ctx.content.mission && ctx.content.mission.objectives) || [];
    const active = sim.state.objectives.filter((o) => o.state === "active");
    for (const st of active) {
      const def = objs.find((o) => o.id === st.id);
      if (def && def.node && ctx.colliders && ctx.colliders.nodes && ctx.colliders.nodes[def.node]) {
        return { pos: ctx.colliders.nodes[def.node], interact: def.kind === "interact" };
      }
    }
    const nb = nearestBot(sim);
    if (nb) return { pos: nb.bot.pos, interact: false };
    return checkpointTarget(sim);
  }

  // March the checkpoint chain FORWARD from the current beat (v2.2, A0
  // wave-3). The original "first checkpoint >4 m away" returned beat 1's own
  // checkpoint the moment the player walked off it — the e2e walker yo-yoed
  // around cp1 forever and beat 2's reach trigger never fired.
  function checkpointTarget(sim) {
    const beats = (ctx.content && ctx.content.mission && ctx.content.mission.beats) || [];
    const p = sim.state.player.pos;
    const curBeat = (sim.mission && typeof sim.mission.beat === "number") ? sim.mission.beat : 0;
    for (const b of beats) {
      if (typeof b.beat === "number" && b.beat <= curBeat) continue;
      const cp = b.checkpoint && b.checkpoint.pos;
      if (!cp) continue;
      // Reach radius 1.2 m, NOT 4 (v2.2 second fix): with 4 m the walker
      // flip-flopped at bld_s1's NW corner — 3.5 m from cp2 it skipped ahead
      // to cp3 (east), walked >4 m away, re-targeted cp2 (west), forever,
      // while the beat-2 reach area sat 0.4 m south. Only when STANDING on
      // a checkpoint and the beat still hasn't advanced does the march fall
      // through to the following beat's checkpoint (the trigger must want
      // something other than this spot).
      if (Math.hypot(cp[0] - p[0], cp[2] - p[2]) > 1.2) return { pos: cp, interact: false };
    }
    return null;
  }

  function walkToward(pos, sprint) {
    // v2.2 (A0 wave-3): straight-line walking wall-wedges in an urban maze —
    // the first full-mission e2e stalled at beat 1 with the walker pinned on
    // a facade. Route through the baked nav (same grid the bots use) and
    // steer at the next string-pulled waypoint; straight-line stays the
    // fallback when nav has no answer (unreachable / off-mesh target).
    let wp = pos;
    const nav = ctx.nav;
    if (nav && typeof nav.findPath === "function") {
      const p = ctx.sim().state.player.pos;
      const path = nav.findPath(p, pos);
      if (path && path.length) {
        for (const q of path) {
          if (Math.hypot(q[0] - p[0], q[2] - p[2]) > 1.2) { wp = q; break; }
        }
      }
    }
    aimAt(wp[0], 1.5, wp[2]);
    keyDown("KeyW");
    if (sprint) keyDown("ShiftLeft"); else keyUp("ShiftLeft");
  }
  function stopMoving() { keyUp("KeyW"); keyUp("ShiftLeft"); }

  // ------------------------------------------------------------ profiles
  // Each think(api) runs every `thinkEvery` sim ticks. api gives world reads
  // + input verbs; profiles hold NO sim references across missions.
  const PROFILES = {
    idle: {
      thinkEvery: 30,
      think() { /* stand still — the fairness floor probe */ },
    },

    rusher: {
      thinkEvery: 6,
      think(api) {
        const { sim, rng } = api;
        const nb = nearestBot(sim);
        if (!nb) { const t = objectiveTarget(sim); if (t) walkToward(t.pos, true); return; }
        aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.2, nb.bot.pos[2], 0.01, rng);
        if (nb.dist > 15) { walkToward(nb.bot.pos, true); mouseUp(0); }
        else {
          stopMoving();
          mouseDown(0); // hip fire, never ADS
          if (sim.state.player.weapon.mag === 0) tapKey("KeyR");
        }
      },
    },

    sniper: {
      thinkEvery: 10,
      think(api) {
        const { sim } = api;
        const nb = nearestBot(sim);
        mouseDown(2); // hold ADS
        if (nb && hasLOS(sim, nb.bot)) {
          aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.55, nb.bot.pos[2]);
          // single tap
          ctx.canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
          window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
        }
        if (sim.state.player.weapon.mag === 0) tapKey("KeyR");
      },
    },

    objective: {
      thinkEvery: 8,
      think(api) {
        // v2.2 (A0 wave-3): the original hip-fire-and-stand combat could not
        // clear beat 2 — 109 checkpoint deaths at ~1 kill/life in the first
        // full-mission e2e (beat replay is R22-designed; the driver was the
        // defect). §6.2's acceptance ("objective … finishes the mission
        // >= 1/3 runs") expects a completion-capable driver: ADS at range,
        // recoil-controlled bursts, strafe while engaging, disengage low.
        const { sim, mem, rng } = api;
        const p = sim.state.player;
        if (p.hp < 35) { // critical: back off, keep aim, top up
          const nbr = nearestBot(sim);
          if (nbr) aimAt(nbr.bot.pos[0], nbr.bot.pos[1] + 1.3, nbr.bot.pos[2]);
          keyDown("KeyS"); keyUp("KeyW");
          mouseUp(0);
          if (p.weapon.mag < 10) tapKey("KeyR");
          return;
        }
        keyUp("KeyS");
        const nb = nearestBot(sim);
        if (nb && nb.dist < 32 && hasLOS(sim, nb.bot)) {
          stopMoving();
          if (nb.dist > 10) mouseDown(2); else mouseUp(2); // ADS at range
          aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.35, nb.bot.pos[2], 0.008, rng);
          mem.burstT = (mem.burstT || 0) + 1;
          if (mem.burstT % 4 < 2) mouseDown(0); else mouseUp(0);
          // strafe while engaging — never a standing target
          if (mem.burstT % 6 < 3) { keyDown("KeyA"); keyUp("KeyD"); }
          else { keyDown("KeyD"); keyUp("KeyA"); }
          mem.firing = true;
          if (p.weapon.mag === 0) tapKey("KeyR");
        } else {
          if (mem.firing) { mouseUp(0); mouseUp(2); mem.firing = false; }
          keyUp("KeyA"); keyUp("KeyD");
          if (p.weapon.mag < 8) tapKey("KeyR");
          // v2.2 unstick: target-fixated walking that produces no movement
          // (an unreachable/never-alerted straggler, an off-mesh wall pin)
          // falls back to marching the mission-forward checkpoint chain —
          // reach triggers advance the mission whether or not stragglers die.
          if (mem.lastPos) {
            const moved = Math.hypot(p.pos[0] - mem.lastPos[0], p.pos[2] - mem.lastPos[2]);
            mem.still = moved < 0.35 ? (mem.still || 0) + 1 : 0;
          }
          mem.lastPos = p.pos.slice();
          if ((mem.still || 0) >= 30) { mem.unstickT = 45; mem.still = 0; } // ~4 s still → 6 s of chain-march
          let t = objectiveTarget(sim);
          if (mem.unstickT > 0) {
            mem.unstickT--;
            t = checkpointTarget(sim) || t;
          }
          if (t) {
            walkToward(t.pos, true);
            if (t.interact && Math.hypot(t.pos[0] - p.pos[0], t.pos[2] - p.pos[2]) < 2.5) tapKey("KeyF");
          }
        }
      },
    },

    optimal: { // = Tactician (R29)
      thinkEvery: 6,
      think(api) {
        const { sim, mem, rng } = api;
        const p = sim.state.player;
        if (p.hp < 40) { // retreat: back off, reload behind time
          const nb = nearestBot(sim);
          if (nb) aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.3, nb.bot.pos[2]);
          keyDown("KeyS"); keyUp("KeyW");
          mouseUp(0);
          if (p.weapon.mag < 10) tapKey("KeyR");
          return;
        }
        keyUp("KeyS");
        const nb = nearestBot(sim);
        if (nb && nb.dist < 45 && hasLOS(sim, nb.bot)) {
          stopMoving();
          mouseDown(2); // ADS
          aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.35, nb.bot.pos[2]);
          // 3–5 round bursts: fire for a burst, then release
          mem.burstT = (mem.burstT || 0) + 1;
          if (mem.burstT % 4 < 2) mouseDown(0); else mouseUp(0);
          // frag suppressed clusters (2+ bots within 12 m of each other, 15–35 m out)
          if (p.grenades > 0 && nb.dist > 15 && nb.dist < 35 && !mem.threwAt) {
            const near = alive(sim).filter((b) =>
              Math.hypot(b.pos[0] - nb.bot.pos[0], b.pos[2] - nb.bot.pos[2]) < 12);
            if (near.length >= 2 && rng() < 0.4) {
              keyDown("KeyG");
              mem.grenadeHeld = 25; // cook ~0.4 s
              mem.threwAt = sim.state.time;
            }
          }
          if (mem.grenadeHeld != null && --mem.grenadeHeld <= 0) { keyUp("KeyG"); mem.grenadeHeld = null; }
        } else {
          mouseUp(0); mouseUp(2);
          if (p.weapon.mag < 8) tapKey("KeyR"); // top up when low, out of contact
          const t = objectiveTarget(sim);
          if (t) walkToward(t.pos, false); // cover-to-cover: no sprint into contact
        }
      },
    },

    novice: {
      thinkEvery: 24, // 400 ms reaction cadence
      think(api) {
        const { sim, rng, mem } = api;
        const nb = nearestBot(sim);
        if (nb && nb.dist < 25 && hasLOS(sim, nb.bot)) {
          stopMoving();
          aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.1, nb.bot.pos[2], 0.06, rng); // wide jitter
          if (nb.dist >= 10) mouseDown(2); // ADS beyond 10 m
          mouseDown(0);
          mem.fired = true;
          // forgets to reload — only when dry AND a beat behind
          if (sim.state.player.weapon.mag === 0 && rng() < 0.3) tapKey("KeyR");
        } else {
          if (mem.fired) { mouseUp(0); mouseUp(2); mem.fired = false; }
          const t = objectiveTarget(sim);
          if (t) walkToward(t.pos, false); // never sprints in combat zones
        }
      },
    },

    camper: {
      thinkEvery: 10,
      think(api) {
        const { sim } = api;
        // never moves from the hold position
        stopMoving();
        const nb = nearestBot(sim);
        if (nb && hasLOS(sim, nb.bot)) {
          aimAt(nb.bot.pos[0], nb.bot.pos[1] + 1.3, nb.bot.pos[2]);
          mouseDown(0);
        } else {
          mouseUp(0);
          if (sim.state.player.weapon.mag === 0) tapKey("KeyR");
        }
      },
    },
  };

  // ------------------------------------------------------------ tick driver
  function raf() {
    return new Promise((resolve) => {
      let done = false;
      requestAnimationFrame(() => { done = true; resolve(); });
      setTimeout(() => { if (!done) resolve(); }, 50); // hidden tabs never rAF
    });
  }

  // ------------------------------------------------------------ autoplay
  async function autoplay(profile, seconds = 30, opts = {}) {
    const P = PROFILES[profile];
    if (!P) {
      throw new Error(`[autoplay] unknown profile '${profile}' — have ${Object.keys(PROFILES).join("/")}`);
    }
    // boot's two-arg routing lambda drops opts — the harness plants the seed
    // on a window global as the fallback carrier (same trick as __BR_SEEDS__).
    if (opts.seed == null && window.__BR_AUTOPLAY_SEED__ != null) {
      opts = { ...opts, seed: window.__BR_AUTOPLAY_SEED__ };
    }

    let sim = ctx.sim();
    if (sim.state.phase === "menu") {
      const T = window.__FPS__ && window.__FPS__.__test;
      if (T) await T.startMission({ seed: opts.seed });
      else await ctx.startMission({ seed: opts.seed });
      sim = ctx.sim();
    }
    if (ctx.pauseCtl.active) ctx.pauseCtl.resume();
    ctx.input.enabled = true;

    const rng = mulberry32(((opts.seed != null ? opts.seed : 1234) ^ 0xa511e9b3) >>> 0);
    const sim0 = sim;
    const t0 = sim.state.tick;
    const totalTicks = Math.max(1, Math.round(seconds * 60));
    const c0 = JSON.parse(JSON.stringify(sim.state.counters));
    const mem = {};

    // additive instrumentation for playprobe
    let thinkErrors = 0;
    const playerDeaths = [];
    let firstContactT = -1;
    let prevDeaths = c0.deaths;
    let prevDamageTaken = c0.damageTaken;
    const stuck = new Map(); // botId -> {pos, ticks}
    let stuckBotSeconds = 0;

    let lastTick = sim.state.tick;
    let stagnant = 0;
    let sinceThink = P.thinkEvery; // think immediately

    while (ctx.sim() === sim0 && sim.state.tick - t0 < totalTicks) {
      const ph = sim.state.phase;
      if (ph === "won" || ph === "lost" || ph === "menu") break;

      // advance: passively when rAF steps the sim, actively when hidden
      await raf();
      if (sim.state.tick === lastTick) {
        if (++stagnant >= 2) { ctx.stepFrames(4, DT); stagnant = 0; }
      } else stagnant = 0;

      const advanced = sim.state.tick - lastTick;
      lastTick = sim.state.tick;
      sinceThink += advanced;

      if (sinceThink >= P.thinkEvery) {
        sinceThink = 0;
        // Profile errors never kill the probe — but a REPEATING think error
        // is a frozen persona reported as "running" (v2.2: the first e2e
        // froze mid-march with this catch eating the evidence). Surface the
        // first 3, count the rest into the report.
        try { P.think({ sim, rng, mem }); } catch (e) {
          thinkErrors++;
          if (thinkErrors <= 3) console.warn("[autoplay] think error:", e && e.stack || e);
        }
      }

      // instrumentation (reads only)
      const c = sim.state.counters;
      if (firstContactT < 0 && c.damageTaken > prevDamageTaken) {
        firstContactT = sim.state.time;
      }
      prevDamageTaken = c.damageTaken;
      if (c.deaths > prevDeaths) {
        prevDeaths = c.deaths;
        // nearest alive bot at death time is the best attacker estimate
        const nb = nearestBot(sim);
        playerDeaths.push({
          t: +sim.state.time.toFixed(2),
          attacker: nb ? nb.bot.id : null,
          archetype: nb ? nb.bot.archetype : null,
        });
      }
      if (advanced > 0) {
        for (const b of alive(sim)) {
          const engaged = b.state === "combat" || b.state === "flank" || b.state === "retreat";
          const rec = stuck.get(b.id);
          if (!rec) { stuck.set(b.id, { pos: b.pos.slice(), ticks: 0 }); continue; }
          const moved = Math.hypot(b.pos[0] - rec.pos[0], b.pos[2] - rec.pos[2]) > 0.05;
          if (moved || !engaged) { rec.pos = b.pos.slice(); rec.ticks = 0; }
          else {
            rec.ticks += advanced;
            if (rec.ticks === 180 || (rec.ticks > 180 && rec.ticks % 60 < advanced)) {
              stuckBotSeconds += 1; // one second past the 3 s threshold
            }
          }
        }
      }
    }

    releaseAll();
    const end = ctx.sim().state;
    const c = end.counters;
    const shots = c.shotsFired - c0.shotsFired;
    const perf = (window.__FPS__ && window.__FPS__.perf) ? window.__FPS__.perf.stats() : {};

    return {
      seconds: +(((end.tick - t0) / 60).toFixed(2)),
      counters: JSON.parse(JSON.stringify(c)),
      kills: c.kills - c0.kills,
      deaths: c.deaths - c0.deaths,
      hp: end.player.hp,
      phase: end.phase,
      accuracy: shots > 0 ? +((c.shotsHit - c0.shotsHit) / shots).toFixed(3) : 0,
      timeToFirstContact: firstContactT,
      perf,
      // additive (playprobe assertions)
      profile,
      seed: opts.seed != null ? opts.seed : null,
      playerDeaths,
      stuckBotSeconds,
      thinkErrors,
      endedByPhase: end.phase === "won" || end.phase === "lost",
    };
  }

  return { autoplay, _profiles: Object.keys(PROFILES) };
}
