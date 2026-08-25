// core/match/match.js [W1] — the PVP match driver (PVP_BUILD_PLAN Part 3.1,
// 3.2, 3.5, 3.6; architecture.md Part 1 as amended by owner amendment A1).
// THREE-free, Node-runnable, deterministic, fixed dt = 1/60.
//
// makeMatch(content, emit, opts) exports the SAME frozen triple as
// makeMission — {start, tick, forfeit} — so all four existing call sites
// (sim.js:179/309, boot.js forfeit/start) take it unchanged. When a match is
// active, sim.match === sim.mission: ONE object, two names (C29a).
//
// A1: the campaign driver core/sim/mission.js STAYS WIRED. Exactly one of
// {mission driver, match driver} is constructed per sim — createSim selects
// by opts.mode — and neither ticks while the other runs.
//
// Match tick order (FROZEN — Part 3.6; probes reason about this):
//   1. clock advance; phase transitions (warmup→live→overtime→ended)
//   2. spawn-protection expiry + cancellation (fire / ADS / grenade)
//   3. respawn director: drain the respawn queue
//   4. mode.tick(m, dt)            ← objective entities live here
//      (+ the out-of-bounds BACKSTOP — must never fire once W4's carve lands)
//   5. duty assignment: mode.assignDuties(m) at 2 Hz
//   6. scoring commit (queued deltas → totals, `match:score` events)
//   7. mode.checkWin(m) → non-null ends the match
//   8. influence/danger grid rebuild at 5 Hz (spawn director's hook, W2)
//   9. sim.state.objectives refresh from mode.hudModel(m).objectives
// Nothing in 1–9 allocates per tick after start() on the hot paths.

import { areEnemies, makeRoster, bindBody } from "./roster.js";
import { validateMatchContent, hasPvpContent } from "./contract.js";

const DT = 1 / 60;
const WARMUP_S = 3.0;          // C14 — 3.0 s, mapped onto phase 'infil'
const OVERTIME_CAP_S = 180;    // modes.md §1.4 hard cap
const WATCHDOG_SLACK_S = 15;   // AC-1/AC-2
const ASSIST_WINDOW_S = 5.0;   // modes.md §1.5
const ASSIST_MIN_DMG = 40;
const CORPSE_REAP_S = 8.0;     // corpse splice → soldiers.js reaps (V5)
const OOB_GRACE_S = 5.0;       // C18 backstop — a probe asserts it never kills

// ---------------------------------------------------------------- registry
// C1: code ids are frozen — tdm / ctf / ffa. The registry is filled by
// registerMode() (boot.js imports each landed modes/<id>.js and registers
// it), so a mode lane that has not landed yet is a REPORTED content error at
// makeMatch, never a page-fatal import crash.
export const MODE_IDS = ["tdm", "ctf", "ffa"];
export const MODES = {}; // id → createMode(ctx)

export function registerMode(id, createMode) {
  if (typeof createMode !== "function") throw new Error(`registerMode('${id}'): factory required`);
  MODES[id] = createMode;
}

// Driver-level rule defaults per C12 — a mode module's own `defaults`
// override these, and content.modes[id] overrides both.
const DRIVER_DEFAULTS = {
  tdm: { scoreLimit: 50, timeLimitS: 480, respawnS: 4.0, protectS: 1.5 },
  ctf: { captureLimit: 3, timeLimitS: 720, respawnS: 5.0, respawnPressureS: 8.0, protectS: 1.5 },
  ffa: { scoreLimit: 25, timeLimitS: 480, respawnS: 3.0, protectS: 2.0 },
};

// ---------------------------------------------------------------- makeMatch
// opts: { mode:'tdm'|'ctf'|'ffa', rng (the makeStreams bundle), seed,
//         difficulty:'casual'|'standard'|'hard', veteran:false,
//         spawnDirector (W2's makeSpawns(arena).pick seam — optional) }
export function makeMatch(content, emit, opts = {}) {
  const modeId = opts.mode || "tdm";
  if (!MODE_IDS.includes(modeId)) {
    throw new Error(`makeMatch: unknown mode id '${modeId}' (frozen ids: ${MODE_IDS.join("/")})`);
  }
  const factory = MODES[modeId];
  if (!factory) {
    throw new Error(`makeMatch: mode '${modeId}' is not registered — its lane has not landed ` +
      `core/match/modes/${modeId}.js yet (registerMode wires it at boot)`);
  }

  // content-internal contract gate NOW (throws on dangling — C19).
  const gate = validateMatchContent(content, { modeIds: MODE_IDS });
  if (!gate.ok) {
    throw new Error("PVP content contract gate failed:\n  " + gate.errors.join("\n  "));
  }
  const pvpContentPending = gate.pending; // W4 not landed → flagged fallback arena

  const streams = opts.rng || null;
  const rngMatch = (streams && streams.match) || (() => 0.5);
  const rngSpawn = (streams && streams.spawn) || rngMatch;

  // W2's spawn director seam: either a built director (opts.spawnDirector,
  // interface {pick(m, actor) → {pointId,pos,yaw,stress}}) or a factory
  // (opts.spawnDirectorFactory === makeSpawns) constructed at start() once
  // the arena (possibly the synthesized fallback) is known.
  let director = opts.spawnDirector || null;

  // arena data (W4's blocks), or a loudly-flagged synthetic fallback so the
  // build is playable before W4 lands (boot-without-content philosophy).
  let arena = null;
  if (!pvpContentPending && content.arena) {
    arena = {
      id: content.arena.id || "lanternwalk",
      bounds: content.arena.bounds,
      clusters: content.clusters || {},
      spawnPoints: content.spawnPoints || [],
      flags: content.flags || [],
      outOfBounds: content.arena.outOfBounds || { graceS: OOB_GRACE_S },
    };
  }

  // mode module — ctx built once, BEFORE any sim exists (arch 1.6).
  const rules = Object.assign({}, DRIVER_DEFAULTS[modeId]);
  const modeCtx = { id: modeId, content, arena, rules, rng: rngMatch, log: (...a) => console.warn("[match]", ...a) };
  const mode = factory(modeCtx);
  if (mode.id !== modeId) throw new Error(`mode id '${mode.id}' !== registry id '${modeId}'`);
  Object.assign(rules, mode.defaults || {}, (content.modes && content.modes[modeId]) || {});

  // ---------------------------------------------------------------- state
  const ms = {
    started: false,
    frozen: false,
    phase: "pre", // start() transitions pre → warmup (a real transition, so
                  // the sim phase map + noTarget lever fire on entry)
    phaseClock: 0,
    elapsed: 0,
    startT: 0,
    watchdogAt: Infinity,
    watchdogFired: false,
    result: null,
    scoreQueue: [],          // {actorId|-1, team|-1, points, teamPoints, reason}
    oobSince: new Array(10).fill(-1),
    oobDeaths: 0,
    spawnedT: new Array(10).fill(-1),
    lastPointByActor: new Array(10).fill(null),
    damageRings: [],         // per actorId: [{attacker, amount, t}] (bounded)
    roster: null,            // {teams, actors, squadIdOf}
    seed: opts.seed != null ? opts.seed : 0,
    matchId: null,
  };
  for (let i = 0; i < 10; i++) ms.damageRings.push([]);

  const byWho = new Map();   // 'P'|botId → actor
  const bodyByWho = new Map(); // 'P'|botId → live body
  let SIM = null;            // bound at start(sim)
  const livingScratch = [];  // m.living reuse
  const enemiesScratch = [];

  // ---------------------------------------------------------------- facade
  const m = {
    get sim() { return SIM; },
    get state() { return SIM ? SIM.state.match : null; },
    rules,
    get arena() { return arena; },
    rng: rngMatch,
    get time() { return SIM ? SIM.state.time : 0; },
    get elapsed() { return ms.elapsed; },
    get timeLeft() { return timeLeftNow(); },
    get phase() { return ms.phase; },
    get actors() { return ms.roster ? ms.roster.actors : []; },
    actorOf(who) { return byWho.get(who) || null; },
    bodyOf(actor) { return actor ? (bodyByWho.get(actor.who) || null) : null; },
    posOf(actor) {
      const b = actor ? bodyByWho.get(actor.who) : null;
      if (b) return b.pos;
      return actor && actor._lastPos ? actor._lastPos : null;
    },
    teamOf(who) { const a = byWho.get(who); return a ? a.team : -1; },
    areEnemies,
    living(team) {
      livingScratch.length = 0;
      for (const a of m.actors) if (a.alive && (team == null || a.team === team)) livingScratch.push(a);
      return livingScratch;
    },
    livingEnemiesOf(actor) {
      enemiesScratch.length = 0;
      for (const a of m.actors) if (a.alive && areEnemies(actor, a)) enemiesScratch.push(a);
      return enemiesScratch;
    },
    addScore(actor, points, reason) {
      ms.scoreQueue.push({ actorId: actor.actorId, team: -1, points, teamPoints: 0, reason });
    },
    addTeamScore(team, points, reason) {
      ms.scoreQueue.push({ actorId: -1, team, points: 0, teamPoints: points, reason });
    },
    requestRespawn(actor, delayS) {
      if (ms.phase === "ended") return;
      actor.respawnAtT = m.time + Math.max(0, delayS);
    },
    setDuty(actor, duty) { actor.duty = duty; },
    cancelProtection(actor) { actor.protectedUntilT = -1; },
    objectiveEvent(kind, data) {
      if (mode.onObjectiveEvent) mode.onObjectiveEvent(m, Object.assign({ kind, t: m.time }, data));
      emit(kind, data);
    },
    emit,
    endMatch(outcome) { endMatch(outcome); },
    get world() { return SIM ? SIM.world : null; },
    get nav() { return SIM ? SIM.nav : null; },
    get colliders() { return SIM ? SIM.colliders : null; },
    get weapons() { return SIM ? SIM.weapons : null; },
    get spawnPoints() { return arena ? arena.spawnPoints : []; },
    get clusters() { return arena ? arena.clusters : {}; },
    dist(a, b) {
      const pa = Array.isArray(a) ? a : m.posOf(a);
      const pb = Array.isArray(b) ? b : m.posOf(b);
      if (!pa || !pb) return Infinity;
      return Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
    },
  };

  function timeLeftNow() {
    if (ms.phase === "warmup") return Math.max(0, WARMUP_S - ms.phaseClock);
    if (ms.phase === "live") return rules.timeLimitS > 0 ? Math.max(0, rules.timeLimitS - ms.phaseClock) : 0;
    if (ms.phase === "overtime") return Math.max(0, OVERTIME_CAP_S - ms.phaseClock);
    return 0;
  }

  // ------------------------------------------------------------- phases
  function setSimPhase(sim, phase) {
    const prev = sim.state.phase;
    if (prev === phase) return;
    sim.state.phase = phase;
    emit("mission:phase", { phase, prev });
  }

  function setMatchPhase(sim, phase) {
    const prev = ms.phase;
    if (prev === phase) return;
    ms.phase = phase;
    ms.phaseClock = 0;
    sim.state.match.phase = phase;
    // C29b mapping: warmup→infil, live→assault, overtime→exfil (botfsm's
    // dormancy gate accepts all three, so bots run with zero lines changed).
    if (phase === "warmup") setSimPhase(sim, "infil");
    else if (phase === "live") setSimPhase(sim, "assault");
    else if (phase === "overtime") setSimPhase(sim, "exfil");
    // 'ended' maps in endMatch (won/lost needs the result)
    // C14 warm-up freeze: the existing, tested lever (V9) — no new flag.
    if (phase === "warmup") sim.setNoTarget(true);
    else if (phase === "live") sim.setNoTarget(false);
    emit("match:state", { phase, prev });
  }

  // ------------------------------------------------------------- spawning
  function eligiblePoints(actor) {
    const pts = [];
    for (const p of arena.spawnPoints) {
      if (p.modes && !p.modes.includes(modeId)) continue;
      if (mode.teamCount === 2 && p.team != null && p.team !== actor.team) continue;
      const cl = arena.clusters[p.cluster];
      if (cl && cl.team != null && mode.teamCount === 2 && cl.team !== actor.team) continue;
      pts.push(p);
    }
    return pts.length ? pts : arena.spawnPoints;
  }

  // Minimal fallback picker — REPLACED by W2's director when boot wires
  // opts.spawnDirector (interface: pick(m, actor) → {pointId,pos,yaw,stress}).
  // Deterministic; farthest-from-living-enemies with recency avoidance.
  function fallbackPick(actor) {
    const pts = eligiblePoints(actor);
    if (!pts.length) {
      // never fail to spawn (C7 relaxation ladder terminal rule)
      const ps = (SIM.colliders.spawns && SIM.colliders.spawns.player) || [0, 0, 0];
      return { pointId: null, pos: ps.slice(), yaw: 0, stress: 1 };
    }
    let best = null, bestScore = -Infinity;
    const enemies = m.livingEnemiesOf(actor);
    for (const p of pts) {
      let dMin = Infinity;
      for (const e of enemies) {
        const ep = m.posOf(e);
        if (ep) dMin = Math.min(dMin, Math.hypot(p.pos[0] - ep[0], p.pos[2] - ep[2]));
      }
      if (dMin === Infinity) dMin = 60;
      let score = Math.min(dMin, 55);
      if (ms.lastPointByActor[actor.actorId] === p.id) score -= 25;
      score += rngSpawn() * 6;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return { pointId: best.id, pos: best.pos.slice(), yaw: best.yaw || 0, stress: 0 };
  }

  function pickSpawn(actor) {
    if (director && director.pick) {
      const r = director.pick(m, actor);
      if (r) return r;
    }
    return fallbackPick(actor);
  }

  function spawnActor(sim, actor, { first = false } = {}) {
    const pick = pickSpawn(actor);
    const t = sim.state.time;
    const protectS = rules.protectS || 1.5;
    if (actor.kind === "human") {
      const p = sim.state.player;
      p.pos = pick.pos.slice();
      p.pos[1] = sim.world.sphereGround(p.pos[0], p.pos[2]);
      p.yaw = pick.yaw; p.pitch = 0;
      p.vel = [0, 0, 0];
      p.hp = sim.tuning ? sim.tuning.maxHp : 100;
      p.alive = true;
      p.lastDamageT = -999;
      p.weapon.state = "idle"; p.weapon.stateT = 0; p.weapon.ads = false;
      p.weapon.adsT = 0; p.weapon.recoilIndex = 0;
      if (p._m) p._m = null;
      bindBody(actor, p);
    } else {
      const botId = sim.spawnBotFromSpec({
        archetype: actor.archetype,
        pos: pick.pos.slice(),
        yaw: pick.yaw,
        band: actor.band,
        team: actor.team,
        squad: ms.roster.squadIdOf(actor.actorId),
        alerted: !first, // mid-match respawns come in ready; first wave calm
      });
      const body = sim.state.bots.find((b) => b.id === botId);
      bindBody(actor, body);
      bodyByWho.set(botId, body);
      byWho.set(botId, actor);
    }
    if (actor.kind === "human") { bodyByWho.set("P", sim.state.player); byWho.set("P", actor); }
    actor.respawnAtT = -1;
    actor.spawnPointId = pick.pointId;
    ms.lastPointByActor[actor.actorId] = pick.pointId;
    ms.spawnedT[actor.actorId] = t;
    // protection: through the end of warm-up on first spawn, else from now
    const base = first ? ms.startT + WARMUP_S : t;
    actor.protectedUntilT = base + protectS;
    if (pick.stress) sim.state.match.spawnStress += pick.stress;
    emit("respawn", {
      who: actor.who, actorId: actor.actorId, team: actor.team,
      pointId: pick.pointId, pos: pick.pos.slice(), yaw: pick.yaw,
      protectedUntilT: actor.protectedUntilT,
    });
    if (mode.onSpawn) {
      mode.onSpawn(m, {
        actor, pointId: pick.pointId, pos: pick.pos, yaw: pick.yaw,
        protectedUntilT: actor.protectedUntilT,
      });
    }
  }

  function synthFallbackArena(sim) {
    // Pre-W4 playability only. Loudly flagged: this IS below the asset bar.
    console.warn("[match] content.json has no PVP arena blocks yet (W4) — synthesizing a fallback arena");
    if (typeof window !== "undefined" && window.__FFG_FALLBACKS__) {
      window.__FFG_FALLBACKS__.push("match: synthetic fallback arena (W4 content pending)");
    }
    const c = sim.colliders;
    const ps = (c.spawns && c.spawns.player) || [0, 0, 0];
    const mk = (id, cx, cz, team) => {
      const pts = [];
      const R = 6;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
        pts.push({ id: `${id}_${i}`, cluster: id, pos: [x, 0, z], yaw: Math.atan2(-(cx - x), -(cz - z)), team });
      }
      return pts;
    };
    const a0 = [ps[0], 0, ps[2]];
    const a1 = [ps[0], 0, ps[2] - 40];
    arena = {
      id: "fallback",
      bounds: c.bounds,
      clusters: {
        SC_FB_A: { anchor: a0, team: 0 },
        SC_FB_B: { anchor: a1, team: 1 },
      },
      spawnPoints: [...mk("SC_FB_A", a0[0], a0[2], 0), ...mk("SC_FB_B", a1[0], a1[2], 1)],
      flags: [
        { id: "flag_t0", team: 0, home: a0.slice(), yaw: 0 },
        { id: "flag_t1", team: 1, home: a1.slice(), yaw: 0 },
      ],
      outOfBounds: { graceS: OOB_GRACE_S },
    };
    modeCtx.arena = arena;
  }

  // ------------------------------------------------------------- scoring
  function commitScores(sim) {
    const M = sim.state.match;
    while (ms.scoreQueue.length) {
      const d = ms.scoreQueue.shift();
      if (d.actorId >= 0) {
        const a = ms.roster.actors[d.actorId];
        a.score += d.points;
        emit("match:score", { team: a.team, actorId: d.actorId, points: d.points, reason: d.reason });
      }
      if (d.team >= 0 && d.teamPoints) {
        const t = M.teams.find((t) => t.id === d.team);
        if (t) t.score += d.teamPoints;
        emit("match:score", { team: d.team, actorId: null, points: d.teamPoints, reason: d.reason });
      }
    }
  }

  function computeAssists(victimActorId, killerActorId, t) {
    const ring = ms.damageRings[victimActorId];
    const sums = new Map();
    for (const e of ring) {
      if (t - e.t > ASSIST_WINDOW_S) continue;
      if (e.attacker === killerActorId || e.attacker < 0) continue;
      sums.set(e.attacker, (sums.get(e.attacker) || 0) + e.amount);
    }
    const out = [];
    for (const [aid, dmg] of sums) {
      const a = ms.roster.actors[aid];
      const v = ms.roster.actors[victimActorId];
      if (dmg >= ASSIST_MIN_DMG && a && areEnemies(a, v)) out.push(aid);
    }
    return out;
  }

  // ------------------------------------------------------------- ending
  function endMatch(outcome) {
    if (ms.phase === "ended" || !SIM) return;
    const sim = SIM;
    const M = sim.state.match;
    setMatchPhase(sim, "ended");
    ms.result = {
      result: outcome.result || "win",
      winnerTeam: outcome.winnerTeam != null ? outcome.winnerTeam : null,
      reason: outcome.reason || "",
    };
    M.result = ms.result;
    if (mode.end) mode.end(m, ms.result);
    commitScores(sim);
    // human's side: won ⇔ winnerTeam === human team (0). Draw/forfeit → lost
    // with the result carried (the HUD reads match.result, never phase, for
    // banner text — modes.md §1.4).
    const humanWon = ms.result.result === "win" && ms.result.winnerTeam === 0;
    setSimPhase(sim, humanWon ? "won" : "lost");
    emit("mission:end", {
      result: humanWon ? "won" : "lost",
      stats: JSON.parse(JSON.stringify(sim.state.counters)),
      match: {
        modeId,
        result: ms.result.result,
        winnerTeam: ms.result.winnerTeam,
        teams: JSON.parse(JSON.stringify(M.teams)),
        actors: JSON.parse(JSON.stringify(ms.roster.actors)),
      },
    });
  }

  // ------------------------------------------------------------- the match
  const match = {
    // ---------------------------------------------------------- frozen triple
    start(sim) {
      SIM = sim;
      if (!arena) synthFallbackArena(sim);
      if (!director && opts.spawnDirectorFactory) {
        try {
          director = opts.spawnDirectorFactory(arena, { rng: rngSpawn, mode: modeId });
        } catch (e) {
          console.warn("[match] spawn director init failed — fallback picker:", e && e.message);
        }
      }
      // deferred contract half — node/weapon/nav checks (C19)
      if (!pvpContentPending) {
        const full = validateMatchContent(content, {
          modeIds: MODE_IDS, nodes: sim.colliders.nodes, weapons: sim.weapons, nav: sim.nav,
        });
        if (!full.ok) {
          throw new Error("PVP content contract gate failed at start():\n  " + full.errors.join("\n  "));
        }
      }
      ms.started = true;
      ms.startT = sim.state.time;
      ms.matchId = `${modeId}:${ms.seed}:${sim.epoch || 0}`;
      ms.watchdogAt = ms.startT + WARMUP_S + (rules.timeLimitS || 480) + OVERTIME_CAP_S + WATCHDOG_SLACK_S;

      // roster (deterministic — draws from rng.match)
      ms.roster = makeRoster(content, {
        teamCount: mode.teamCount === "perActor" ? "perActor" : 2,
        rng: rngMatch,
        difficulty: opts.difficulty || "standard",
        veteran: opts.veteran === true,
      });

      // the frozen state block (Part 3.2)
      sim.state.match = {
        modeId,
        phase: "warmup",
        clock: 0, elapsed: 0,
        timeLeft: rules.timeLimitS || 0,
        teams: ms.roster.teams,
        actors: ms.roster.actors,
        flags: [],
        result: null,
        spawnStress: 0,
        mode: {},
      };

      emit("match:start", {
        matchId: ms.matchId, mode: modeId, difficulty: opts.difficulty || "standard",
        teams: ms.roster.teams.map((t) => ({ id: t.id, name: t.name, tint: t.tint })),
        seed: ms.seed, epoch: sim.epoch || 0,
      });
      // the frozen campaign vocabulary too, so every existing consumer
      // (fx pool clear, soldiers clear, hud, audio stinger) is unchanged.
      emit("mission:start", { missionId: `match:${modeId}`, epoch: sim.epoch || 0 });

      setMatchPhase(sim, "warmup");

      // spawn all 10 (first spawn: 0 s delay — C12)
      for (const a of ms.roster.actors) spawnActor(sim, a, { first: true });

      if (mode.start) mode.start(m);
      refreshObjectives(sim);
    },

    tick(sim) {
      if (!ms.started || ms.frozen || ms.phase === "ended") return;
      const M = sim.state.match;
      const t = sim.state.time;

      // -- 1. clock + phase transitions
      ms.phaseClock += DT;
      if (ms.phase === "live" || ms.phase === "overtime") ms.elapsed += DT;
      M.clock = ms.phaseClock;
      M.elapsed = ms.elapsed;
      M.timeLeft = timeLeftNow();
      if (ms.phase === "warmup" && ms.phaseClock >= WARMUP_S) {
        setMatchPhase(sim, "live");
      } else if (ms.phase === "live" && rules.timeLimitS > 0 && ms.phaseClock >= rules.timeLimitS) {
        const w = mode.checkWin(m);
        if (w) { endMatch(w); return; }
        setMatchPhase(sim, "overtime");
      } else if (ms.phase === "overtime" && ms.phaseClock >= OVERTIME_CAP_S) {
        endMatch({ result: "draw", winnerTeam: null, reason: "overtime cap" });
        return;
      }
      // the watchdog (AC-2: exists so a bug produces a finished match and a
      // loud line, not a hung game; a single firing is a FAIL + bug report)
      if (t >= ms.watchdogAt && !ms.watchdogFired) {
        ms.watchdogFired = true;
        console.error(`[match] WATCHDOG FIRED — ${modeId} seed ${ms.seed} did not end by t=${ms.watchdogAt.toFixed(1)}`);
        endMatch({ result: "draw", winnerTeam: null, reason: "watchdog" });
        return;
      }

      // -- 2. spawn protection expiry + cancellation (fire / ADS / grenade)
      for (const a of ms.roster.actors) {
        if (!a.alive || a.protectedUntilT < 0) continue;
        if (t >= a.protectedUntilT) { a.protectedUntilT = -1; continue; }
        const b = bodyByWho.get(a.who);
        if (!b) continue;
        const firedSinceSpawn = b.weapon && (b.weapon.lastShotT ?? -9) >= ms.spawnedT[a.actorId];
        const ads = b.weapon && b.weapon.ads;
        const nading = a.who === "P" ? false : !!(b.cmd && b.cmd.grenade);
        if (firedSinceSpawn || ads || nading) a.protectedUntilT = -1;
      }

      // -- 3. respawn director
      for (const a of ms.roster.actors) {
        if (!a.alive && a.respawnAtT >= 0 && t >= a.respawnAtT && ms.phase !== "overtime") {
          spawnActor(sim, a);
        }
      }
      // corpse reap: splice dead bodies so soldiers.js reaps the view (V5)
      const bots = sim.state.bots;
      for (let i = bots.length - 1; i >= 0; i--) {
        const b = bots[i];
        if (!b.alive && b._reapAtT != null && t >= b._reapAtT) {
          bodyByWho.delete(b.id);
          byWho.delete(b.id);
          bots.splice(i, 1);
        }
      }

      // -- 4. mode tick + the OOB backstop
      if (mode.tick) mode.tick(m, DT);
      oobBackstop(sim, t);

      // -- 5. duty assignment at 2 Hz
      if (mode.assignDuties && sim.state.tick % 30 === 0 && ms.phase !== "warmup") {
        mode.assignDuties(m);
      }

      // -- 6. scoring commit
      commitScores(sim);

      // -- 7. win check
      if (ms.phase === "live" || ms.phase === "overtime") {
        const w = mode.checkWin(m);
        if (w) { endMatch(w); return; }
      }

      // -- 8. influence grid rebuild at 5 Hz (W2's hook, if wired)
      if (director && director.influenceTick && sim.state.tick % 12 === 0) {
        director.influenceTick(m);
      }

      // -- 9. objectives refresh
      if (sim.state.tick % 30 === 7) refreshObjectives(sim);
    },

    forfeit(sim) {
      // the REAL loss path (doctrine §6) — boot.js ESC → Abandon calls it.
      if (!ms.started || ms.phase === "ended") return;
      const enemyTeam = mode.teamCount === 2 ? 1 : null;
      endMatch({ result: "forfeit", winnerTeam: enemyTeam, reason: "forfeit" });
    },

    // ---------------------------------------------------------- additions
    onActorDeath(sim, ev) {
      // ev: {victim:'P'|botId, attacker:'P'|botId|null, part, pos:[3]}
      const victim = byWho.get(ev.victim);
      if (!victim) return;
      const t = sim.state.time;
      victim.alive = false;
      victim.deaths++;
      victim.streak = 0;
      victim._lastPos = ev.pos ? ev.pos.slice() : (m.posOf(victim) || [0, 0, 0]);
      const body = bodyByWho.get(ev.victim);
      if (body && ev.victim !== "P") body._reapAtT = t + CORPSE_REAP_S;
      bodyByWho.delete(victim.who === "P" ? "__never" : victim.who); // bot bodies rotate; 'P' persists

      const killer = ev.attacker != null ? byWho.get(ev.attacker) : null;
      const isKill = killer && areEnemies(killer, victim);
      const assists = computeAssists(victim.actorId, isKill ? killer.actorId : -2, t);
      if (isKill) {
        killer.kills++;
        killer.streak++;
        if (killer.streak > killer.bestStreak) killer.bestStreak = killer.streak;
      }
      for (const aid of assists) ms.roster.actors[aid].assists++;
      ms.damageRings[victim.actorId].length = 0;

      const kev = {
        attacker: isKill ? killer : null,
        victim,
        headshot: !!ev.headshot,
        weaponId: ev.weaponId || null,
        assists,
        attackerTeam: isKill ? killer.team : -1,
        victimTeam: victim.team,
        pos: victim._lastPos,
        t,
      };
      if (isKill && mode.onKill) mode.onKill(m, kev);
      if (mode.onDeath) mode.onDeath(m, { actor: victim, attacker: isKill ? killer : null, pos: victim._lastPos, t });

      // scoring — mode override, else the C15 base ledger (100/25)
      let entries = null;
      if (mode.scoreForKill && isKill) entries = mode.scoreForKill(m, kev);
      if (!entries && isKill) {
        entries = [{ actor: killer, points: 100, reason: "kill" }];
        for (const aid of assists) entries.push({ actor: ms.roster.actors[aid], points: 25, reason: "assist" });
      }
      if (entries) for (const e of entries) m.addScore(e.actor, e.points, e.reason);

      // respawn queue (no respawns in overtime — modes.md §2.3)
      if (ms.phase !== "overtime" && ms.phase !== "ended") {
        victim.respawnAtT = t + (rules.respawnS != null ? rules.respawnS : 4.0);
      }
    },

    onPlayerDeath(sim) {
      // thin alias so damage.js's campaign call-shape needs no rename; the
      // real handling runs through onActorDeath (damage.js calls it with the
      // full event when sim.match is live).
    },

    onDamage(sim, who, amount, attacker, part, src) {
      const victim = byWho.get(who);
      const att = attacker != null ? byWho.get(attacker) : null;
      if (!victim || !att || victim === att) return;
      const ring = ms.damageRings[victim.actorId];
      ring.push({ attacker: att.actorId, amount, t: sim.state.time });
      if (ring.length > 24) ring.splice(0, ring.length - 24);
    },

    sameTeam(aWho, bWho) {
      const a = byWho.get(aWho), b = byWho.get(bWho);
      return !!(a && b && a.team === b.team);
    },
    isProtected(who) {
      const a = byWho.get(who);
      return !!(a && a.protectedUntilT >= 0 && SIM && SIM.state.time < a.protectedUntilT);
    },
    botsFrozen() { return ms.phase === "warmup"; },

    freeze(on) { ms.frozen = !!on; },
    get mode() { return mode; },
    snapshot() {
      return SIM ? JSON.parse(JSON.stringify(Object.assign(
        { tick: SIM.state.tick, time: SIM.state.time, oobDeaths: ms.oobDeaths, watchdogFired: ms.watchdogFired },
        SIM.state.match,
      ))) : null;
    },
    setMode(id) {
      if (ms.started) throw new Error("setMode: match already started");
      if (!MODE_IDS.includes(id)) throw new Error(`setMode: unknown id '${id}'`);
      throw new Error("setMode: construct a new match via startMatch({mode}) — a match binds its mode at makeMatch");
    },
    drainRadio() { return []; },      // hud.js drainRadioInto keeps working
    drainSetPieces() { return []; },  // the A6 blackout drain keeps working
    m,           // the facade (mode modules + probes)
    _ms: ms,     // private — selftest introspection
  };

  function oobBackstop(sim, t) {
    if (!arena || !arena.bounds) return;
    const B = arena.bounds;
    const grace = (arena.outOfBounds && arena.outOfBounds.graceS) || OOB_GRACE_S;
    for (const a of ms.roster.actors) {
      if (!a.alive) { ms.oobSince[a.actorId] = -1; continue; }
      const p = m.posOf(a);
      if (!p) continue;
      const out = p[0] < B.min[0] || p[0] > B.max[0] || p[2] < B.min[2] || p[2] > B.max[2];
      if (!out) { ms.oobSince[a.actorId] = -1; continue; }
      if (ms.oobSince[a.actorId] < 0) ms.oobSince[a.actorId] = t;
      else if (t - ms.oobSince[a.actorId] >= grace) {
        ms.oobSince[a.actorId] = -1;
        ms.oobDeaths++;
        console.error(`[match] OUT-OF-BOUNDS backstop killed actor ${a.actorId} — this must never fire once the carve lands (AC-8)`);
        sim.damage(a.who, 99999, "oob");
      }
    }
  }

  function refreshObjectives(sim) {
    if (!mode.hudModel) return;
    const hm = mode.hudModel(m);
    if (!hm || !hm.objectives) return;
    const objs = hm.objectives;
    if (sim.state.objectives.length !== objs.length) {
      sim.state.objectives = objs.map((o) => ({ id: o.id, label: o.label, state: o.state }));
    } else {
      for (let i = 0; i < objs.length; i++) {
        const dst = sim.state.objectives[i];
        if (dst.state !== objs[i].state) {
          dst.state = objs[i].state;
          emit("objective", { id: objs[i].id, state: objs[i].state, label: objs[i].label });
        }
        dst.label = objs[i].label;
      }
    }
  }

  return match;
}
