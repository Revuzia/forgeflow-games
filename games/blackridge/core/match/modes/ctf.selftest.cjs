#!/usr/bin/env node
/* core/match/modes/ctf.selftest.cjs [W8] — MODE: CTF battery
 * (PVP_BUILD_PLAN Part 4.1 row W8; modes.md Part 3 in full; C4/C7/C7b/C12/
 * C13/C15; AC-5/AC-6 at mode level).
 *
 * Run: node core/match/modes/ctf.selftest.cjs   → exit 0 on green.
 *
 * Proven here against the REAL driver + REAL sim + REAL spawn director on
 * the synthetic flat fixture (same fixture family as tdm.selftest.cjs):
 *   - frozen interface: id 'ctf', displayName, teamCount 2, C12 defaults
 *     exact incl. respawnPressureS; purity of ctf.js AND flags.js
 *   - the flag state machine end to end: stand grab (+50) → carry (pos
 *     tracks the carrier) → capture (+500, team score, both flags home)
 *   - capture requires OWN flag AT_STAND: flag:captureBlocked (rate-limited
 *     1/3 s), then the §3.8 return-then-capture on ONE tick, and the C15
 *     stack (kill+carrier+defend = 300 on one bullet; full ledger = 950)
 *   - drop on death → dropPoint → enemy ground pickup (NO grab points,
 *     reveal clock restarts) → teammate touch return (+100)
 *   - DROPPED auto-return at 30 s; stuck validation (3 strikes → force
 *     return, flagStuckResets counted)
 *   - carrier reveal at 8.0 s; the beacon (6 m quantised, ≤3 s fresh);
 *     the 120 s carry cap force return
 *   - carrier restrictions: human grenades stashed to 0 and restored, no
 *     regen while carrying, regen resumes after the carry ends
 *   - PRESSURE at 60 s (respawn/protect rules swapped, both carriers
 *     revealed) and the 90 s stalemate force reset (≤1 — AC-6)
 *   - the C7 ctf V7 spawn veto: 12 m of either flag's CURRENT pos, 15 m of
 *     own stand while own flag CARRIED, the side lock, the 20 s trap window
 *   - the duty layer: closed enum, §5.4 rows, interceptor gated on the
 *     BEACON (never a live carried-flag pos), carrier override, honesty
 *     (every duty target is a PUBLIC point)
 *   - 0:00 tie-break chain led by flag pressure (anti-turtle: the team that
 *     carried closer wins a 0–0)
 *   - overtime: all-tied 0:00 → OT (flags force-reset, PRESSURE from the
 *     first second) → golden capture ends it; COLLAPSE arms at OT+60 with
 *     the carrier + 8 m stand exemptions
 *   - a natural bot-only match terminates (AC-1), watchdog silent (AC-2),
 *     zero invariant violations (AC-5), zero OOB deaths (AC-8)
 *   - [P2] kill resupply adopted from tdm.js (by copy — purity): +1 mag on
 *     kill capped at the start reserve, bots through the same hook, and the
 *     live content rule pk_ammo_kill_refill declares 'ctf'
 *   - determinism: same seed twice → identical snapshot + flag-log hashes
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const HERE = __dirname;
const GAME_DIR = path.resolve(HERE, "..", "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const DT = 1 / 60;
const FLAG_A = [0, 0, 44];   // team 0 (AMBER) stand
const FLAG_B = [0, 0, -44];  // team 1 (SLATE) stand

function flatColliders() {
  return {
    boxes: [],
    groundY: () => 0,
    spawns: { player: [0, 0, 0], playerYaw: 0 },
    cover: [],
    nodes: {},
    bounds: { min: [-80, -5, -80], max: [80, 30, 80] },
  };
}

function syntheticContent(realArchetypes, timeLimitS) {
  const spawnPoints = [];
  const mkRow = (cluster, team, cz, n, x0, step) => {
    for (let i = 0; i < n; i++) {
      spawnPoints.push({
        id: `${cluster.toLowerCase()}_${i}`, cluster,
        pos: [x0 + (i % 11) * step, 0, cz + Math.floor(i / 11) * 4],
        yaw: team === 0 ? Math.PI : 0, cover: 0.5,
        modes: ["tdm", "ctf", "ffa"],
      });
    }
  };
  mkRow("SC_A", 0, 28, 18, -30, 6);   // 48 points total — contract: 40–50
  mkRow("SC_A2", 0, 18, 6, -15, 6);
  mkRow("SC_B", 1, -32, 18, -30, 6);
  mkRow("SC_B2", 1, -22, 6, -15, 6);
  return {
    version: 2,
    arena: {
      id: "flat_fixture",
      bounds: { min: [-79, -2, -79], max: [79, 20, 79] },
      outOfBounds: { graceS: 5.0 },
    },
    match: {
      collapse: { centre: [0, 0, 0], r0: 12, r1: 6, shrinkS: 30, dps0: 5, dps1: 15, rampS: 20, armsAfterOtS: 60 },
    },
    teams: [
      { id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a" },
      { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b" },
    ],
    botRoster: [
      { slot: 1, archetype: "cqb" }, { slot: 2, archetype: "rifleman" },
      { slot: 3, archetype: "rifleman" }, { slot: 4, archetype: "marksman" },
      { slot: 5, archetype: "cqb" }, { slot: 6, archetype: "rifleman" },
      { slot: 7, archetype: "rifleman" }, { slot: 8, archetype: "rifleman" },
      { slot: 9, archetype: "marksman" },
    ],
    clusters: {
      SC_A: { anchor: [0, 0, 30], team: 0 },
      SC_A2: { anchor: [0, 0, 18], team: 0 },
      SC_B: { anchor: [0, 0, -30], team: 1 },
      SC_B2: { anchor: [0, 0, -22], team: 1 },
    },
    spawnPoints,
    flags: [
      { id: "flag_amber", team: 0, home: FLAG_A.slice(), standR: 1.2, standH: 2.5 },
      { id: "flag_slate", team: 1, home: FLAG_B.slice(), standR: 1.2, standH: 2.5 },
    ],
    modes: {
      tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ctf: {
        captureLimit: 3, timeLimitS, respawnS: 1.0, protectS: 0.5,
        respawnPressureS: 2.0, protectPressureS: 0.25,
        sideClusters: { 0: ["SC_A", "SC_A2"], 1: ["SC_B", "SC_B2"] },
      },
      ffa: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
    },
    archetypes: realArchetypes,
    pickups: [],
    scenarios: {},
  };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const MODE = await import(u("core/match/modes/ctf.js"));
  const SP = await import(u("core/match/spawns.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const D = await import(u("core/sim/damage.js"));
  const liveContent = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const WEAPONS = WD.WEAPONS;

  MATCH.registerMode("ctf", MODE.createMode);
  // long fixture for the flag-machine scenarios (the 120 s carry cap and the
  // 90 s stalemate must fit inside regulation); short fixture for the
  // termination / overtime / determinism scenarios.
  const contentLong = syntheticContent(liveContent.archetypes, 300);
  const contentShort = syntheticContent(liveContent.archetypes, 30);

  function makeMatchSim(seed, short) {
    const events = [];
    const sim = S.createSim({
      content: short ? contentShort : contentLong,
      colliders: flatColliders(),
      weapons: WEAPONS,
      seed,
      mode: "ctf",
      tuning: "pvp",
      matchOpts: { spawnDirectorFactory: SP.makeSpawns },
      emit: (type, data) => events.push({ type, data }),
    });
    return { sim, events };
  }

  function stepN(sim, n) { for (let i = 0; i < n; i++) sim.step(null); }
  const flagEvents = (events, state) => events.filter((e) => e.type === "flag" && e.data.state === state);

  // hold a set of actors at fixed spots while stepping (bots drift otherwise)
  function stepHeld(sim, n, holds) {
    for (let i = 0; i < n; i++) {
      for (const h of holds) sim.teleport(h[0], h[1], 0, h[2]);
      sim.step(null);
    }
  }

  // pin-and-disarm: noTarget hides only the PLAYER — bot-vs-bot combat is
  // live, so long scripted holds get participants shot mid-scenario. Pin
  // every non-participant bot into one tight clump (grenades need >=8 m of
  // range — a 0 m clump is ineligible) with zero ammo, hold the
  // participants at their spots, step.
  function holdWorld(sim, n, holds, exclude) {
    const ex = new Set((exclude || []).concat(holds.map((h) => h[0])));
    for (let i = 0; i < n; i++) {
      for (const b of sim.state.bots) {
        if (!b.alive || ex.has(b.id)) continue;
        sim.teleport(b.id, -60, 0, -60);
        if (b.weapon) { b.weapon.mag = 0; b.weapon.reserve = 0; }
      }
      for (const h of holds) sim.teleport(h[0], h[1], 0, h[2]);
      sim.step(null);
    }
  }

  function livingBot(M, team, match, needUnprotected) {
    return M.actors.find((a) =>
      a.alive && a.kind === "bot" && a.team === team &&
      (!needUnprotected || !match.isProtected(a.who)));
  }

  // boot a match past warmup + first-spawn protection, combat frozen
  function liveMatch(seed, short) {
    const r = makeMatchSim(seed, short);
    r.sim.match.start(r.sim);
    r.M = r.sim.state.match;
    stepN(r.sim, 260);
    r.sim.setNoTarget(true);
    return r;
  }

  // ============================================================ 1. interface
  section("frozen interface + purity (Part 3.5, C12, W8 row)");
  {
    const srcMode = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/ctf.js"), "utf8");
    const srcFlags = fs.readFileSync(path.join(GAME_DIR, "core/match/flags.js"), "utf8");
    for (const [name, src] of [["ctf.js", srcMode], ["flags.js", srcFlags]]) {
      ok(!/from\s+["'][^"']*(three|\/sim\/|botfsm|\/hud\/|\/view\/|\/render\/|\/fx\/|\/chars\/|modes\/(tdm|ffa))/.test(src),
        `${name}: no forbidden imports (THREE / sim.js / botfsm / hud / view / render / fx / chars / sibling modes)`);
      ok(!/Math\.random|Date\.now|performance\.now/.test(src),
        `${name}: no Math.random, no wall-clock reads`);
    }
    const mode = MODE.createMode({ id: "ctf", content: {}, rules: {}, rng: () => 0.5 });
    ok(mode.id === "ctf", "mode.id === 'ctf' (C1)");
    ok(mode.displayName === "CAPTURE THE FLAG", "displayName 'CAPTURE THE FLAG'");
    ok(mode.teamCount === 2, "teamCount 2");
    const d = mode.defaults;
    ok(d.captureLimit === 3 && d.timeLimitS === 720 && d.respawnS === 5.0 &&
       d.respawnPressureS === 8.0 && d.protectS === 1.5 && d.protectPressureS === 0.75,
      "C12 defaults exact: {captureLimit:3, timeLimitS:720, respawnS:5.0, respawnPressureS:8.0, protectS:1.5, protectPressureS:0.75}");
    for (const fn of ["start", "tick", "end", "checkWin", "assignDuties", "onKill", "onDeath", "onSpawn", "spawnVeto", "scoreForKill", "hudModel"]) {
      ok(typeof mode[fn] === "function", `mode.${fn} is a function`);
    }
  }

  // ==================================================== 2. wiring + flags[]
  section("state wiring — m.state.flags, content override merge, side lock");
  {
    const { sim, M } = liveMatch(201);
    ok(sim.match.m.rules.captureLimit === 3 && sim.match.m.rules.timeLimitS === 300,
      "content.modes.ctf overrides mode defaults through the driver merge");
    ok(sim.match.m.mode === sim.match.mode,
      "mode attached to the facade at start() — V7 wired for the director (seam repair)");
    ok(Array.isArray(M.flags) && M.flags.length === 2, "sim.state.match.flags has both flags (Part 3.2)");
    ok(M.flags[0].team === 0 && M.flags[1].team === 1, "flags sorted by team");
    ok(M.flags.every((f) => f.state === "AT_STAND"), "both AT_STAND after warmup");
    ok(M.flags.every((f, i) => Math.hypot(f.pos[0] - f.home[0], f.pos[2] - f.home[2]) < 0.01),
      "pos === home at stand");
    ok(Array.isArray(M.mode.carryS) && M.mode.carryS.length === 10, "carry-time ledger published (§7.3)");
    // POST-START picks (every respawn) go through V7 → side lock + the 12 m
    // flag rule hold. (The INITIAL wave spawns before mode.start and is NOT
    // side-locked until W1 exposes `mode` on the facade — lane report gap.)
    // The director locks each team to the cluster of its FIRST pick, made
    // BEFORE mode.start (V7 unreachable — W1 seam, lane report). When that
    // lock contradicts the side rule, the mode's defuse stands the side
    // lock down after 2 centroid fallbacks instead of fighting forever.
    let respawns = 0, flagRuleOk = true;
    const centroid = [0, 0];
    for (let k = 0; k < 8; k++) {
      const v = livingBot(M, k % 2, sim.match, true);
      D.applyDamage(sim, v.who, 9999, k % 2 === 0 ? livingBot(M, 1, sim.match, false).who : "P", "body", "script");
      stepN(sim, 90); // respawnS 1.0 → back up
      if (!v.alive) continue;
      respawns++;
      if (!v.spawnPointId) {
        // Attribute the fallback the way the mode's own bookkeeping does
        // (ctf.js noteSpawn): a fallback during an active trap window is the
        // director avoiding a compromised zone, not the side lock fighting —
        // only trap-free fallbacks count against the defuse bound. (Final-proof
        // fix: seed 201 team 1 took a 3rd, trap-caused fallback at t=15.83
        // AFTER its side lock was already defused.)
        const sT = sim.match._ms.spawnedT[v.actorId];
        const trapped = (M.mode.spawnCompromised || [])
          .some((c) => c.team === v.team && sT < c.untilT);
        if (!trapped) centroid[v.team]++;
        continue;
      }
      const pt = contentLong.spawnPoints.find((p) => p.id === v.spawnPointId);
      for (const f of contentLong.flags) {
        if (Math.hypot(pt.pos[0] - f.home[0], pt.pos[2] - f.home[2]) < 12) flagRuleOk = false;
      }
    }
    ok(respawns >= 6, `scripted kills produced respawns to audit (${respawns})`);
    ok(centroid[0] <= 2 && centroid[1] <= 2,
      `side-lock defuse bounds centroid fallbacks to <=2 per team (got ${centroid[0]}/${centroid[1]})`);
    ok(flagRuleOk, "no pointed respawn within 12 m of a flag stand (C7 V7 through the director)");
    ok(M.result === null && M.phase === "live", "match live");
  }

  // ====================================== 3. grab → carry → capture (C29c)
  section("stand grab (+50) → carry → capture (+500, team score) — the spine");
  {
    const { sim, M, events } = liveMatch(202);
    const B1 = livingBot(M, 1, sim.match, true);
    const preScore = B1.score;
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    const fA = M.flags[0];
    ok(fA.state === "CARRIED" && fA.carrier === B1.who, "SLATE bot grabbed the AMBER flag from its stand");
    ok(flagEvents(events, "taken").length === 1 && flagEvents(events, "taken")[0].data.reason === "stand",
      "flag:taken emitted, reason 'stand'");
    stepN(sim, 2);
    ok(B1.score - preScore === 50, `grab pays exactly +50 (got ${B1.score - preScore})`);
    // carried flag tracks the carrier
    sim.teleport(B1.who, 20, 0, 0);
    stepN(sim, 2);
    ok(Math.hypot(fA.pos[0] - 20, fA.pos[2] - 0) < 2.5, "flag.pos follows the carrier (C22 render truth)");
    ok(fA.pubPos === null, "carried + unrevealed → pubPos null (Part 3.8 — position is EARNED)");
    // capture at own stand (own flag is home)
    sim.teleport(B1.who, FLAG_B[0], 0, FLAG_B[2]);
    stepN(sim, 3);
    ok(flagEvents(events, "captured").length === 1, "flag:captured emitted");
    ok(fA.state === "AT_STAND" && Math.hypot(fA.pos[0] - FLAG_A[0], fA.pos[2] - FLAG_A[2]) < 0.01,
      "captured flag reset to its own stand");
    ok(M.teams[1].score === 1 && M.teams[1].captures === 1, "team score = captures = 1");
    ok(B1.captures === 1, "actor.captures incremented");
    ok(B1.score - preScore === 550, `grab+capture personal points = 550 (got ${B1.score - preScore})`);
    ok(M.mode.carryS[B1.actorId] > 0, "carry time accrued for the carrier");
  }

  // ==================== 4. captureBlocked + return-then-capture + C15 stack
  section("§3.3 captureBlocked (1/3 s) → §3.8 return-then-capture on ONE tick → C15 stack");
  {
    const { sim, M, events } = liveMatch(203);
    const A = livingBot(M, 0, sim.match, true);   // AMBER attacker
    const B1 = livingBot(M, 1, sim.match, true);  // SLATE carrier
    // A grabs the SLATE flag; B1 grabs the AMBER flag
    sim.teleport(A.who, FLAG_B[0], 0, FLAG_B[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    ok(M.flags[0].state === "CARRIED" && M.flags[1].state === "CARRIED", "both flags carried — the standoff");
    // B1 stands on its own stand: own (SLATE) flag is away → blocked
    const preBlocked = flagEvents(events, "captureBlocked").length;
    stepHeld(sim, 120, [[B1.who, FLAG_B[0], FLAG_B[2]], [A.who, 15, 15]]); // 2.0 s on the stand
    const blocked2s = flagEvents(events, "captureBlocked").length - preBlocked;
    ok(blocked2s === 1, `captureBlocked fired exactly once in 2 s (rate limit 3 s) — got ${blocked2s}`);
    ok(M.teams[1].score === 0, "no capture while own flag is away (C29c)");
    stepHeld(sim, 120, [[B1.who, FLAG_B[0], FLAG_B[2]], [A.who, 15, 15]]); // past 3 s
    ok(flagEvents(events, "captureBlocked").length - preBlocked === 2,
      "second captureBlocked after the 3 s window (teaching moment repeats, never spams)");
    // kill A right beside the SLATE stand — B1 is the killer:
    // C15 stack on one bullet = kill 100 + carrier kill 150 + defend kill 50
    const b1Before = B1.score;
    sim.teleport(A.who, FLAG_B[0] + 0.6, 0, FLAG_B[2]);
    sim.teleport(B1.who, FLAG_B[0], 0, FLAG_B[2]);
    D.applyDamage(sim, A.who, 9999, B1.who, "body", "script");
    stepN(sim, 2);
    ok(M.flags[1].state === "AT_STAND" || M.flags[1].state === "DROPPED",
      "SLATE flag dropped on the carrier's death (§3.3)");
    // the drop landed inside B1's stand trigger → B1 (teammate) returns it,
    // and B1 is standing in its own stand carrying the AMBER flag → the
    // §3.8 return-then-capture resolves on the SAME tick.
    stepN(sim, 3);
    ok(M.flags[1].state === "AT_STAND", "own flag returned by teammate touch");
    ok(M.flags[0].state === "AT_STAND" && M.teams[1].score === 1 && M.teams[1].captures === 1,
      "…and the capture resolved (return first, then capture — the mode's best moment)");
    stepN(sim, 2);
    const gained = B1.score - b1Before;
    // 100 kill + 150 carrier + 50 defend + 100 return + 500 capture = 900
    ok(gained === 900, `C15 ledger stack: kill+carrier+defend+return+capture = 900 (got ${gained})`);
    ok(B1.returns === 1 && B1.captures === 1, "actor.returns / actor.captures both counted");
  }

  // ========================== 5. drop → ground pickup → teammate return
  section("drop on death → ground pickup (no grab points, reveal restart) → touch return (+100)");
  {
    const { sim, M, events } = liveMatch(204);
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, 10, 0, 5);
    stepN(sim, 2);
    D.applyDamage(sim, B1.who, 9999, "P", "body", "script");
    stepN(sim, 2);
    const fA = M.flags[0];
    ok(fA.state === "DROPPED", "flag DROPPED where the carrier died");
    ok(Math.hypot(fA.pos[0] - 10, fA.pos[2] - 5) < 6.5, "drop point at/near the death (§3.4 dropPoint)");
    ok(fA.returnAtT > sim.state.time && fA.returnAtT - sim.state.time <= 30.01, "30 s auto-return armed");
    // enemy ground pickup: NO grab points, reveal clock restarts
    const B2 = livingBot(M, 1, sim.match, true);
    const b2Pre = B2.score;
    sim.teleport(B2.who, fA.pos[0], 0, fA.pos[2]);
    stepN(sim, 2);
    ok(fA.state === "CARRIED" && fA.carrier === B2.who, "second SLATE bot picked it off the ground");
    ok(flagEvents(events, "taken").some((e) => e.data.reason === "ground"), "flag:taken reason 'ground'");
    stepN(sim, 2);
    ok(B2.score - b2Pre === 0, "ground pickup pays NOTHING (only stand grabs pay 50)");
    ok(fA.revealed === false, "reveal clock restarted — a fresh carrier is a fresh problem");
    // kill the new carrier; an AMBER teammate touches → instant return +100
    sim.teleport(B2.who, -10, 0, 10);
    stepN(sim, 2);
    D.applyDamage(sim, B2.who, 9999, "P", "body", "script");
    stepN(sim, 2);
    const A1 = livingBot(M, 0, sim.match, true);
    const a1Pre = A1.score;
    sim.teleport(A1.who, fA.pos[0], 0, fA.pos[2]);
    stepN(sim, 3);
    ok(fA.state === "AT_STAND", "teammate touch → instant return");
    stepN(sim, 2);
    ok(A1.score - a1Pre === 100 && A1.returns === 1, "return pays +100 and counts");
    ok(flagEvents(events, "returned").some((e) => e.data.reason === "touch"), "flag:returned reason 'touch'");
  }

  // ================================================= 6. auto-return timeout
  section("DROPPED auto-return after 30 s untouched");
  {
    const { sim, M, events } = liveMatch(205);
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, 25, 0, 0);
    stepN(sim, 2);
    D.applyDamage(sim, B1.who, 9999, "P", "body", "script");
    stepN(sim, 2);
    ok(M.flags[0].state === "DROPPED", "dropped");
    stepN(sim, 60 * 31);
    ok(M.flags[0].state === "AT_STAND", "auto-returned after 30 s");
    ok(flagEvents(events, "returned").some((e) => e.data.reason === "timeout"), "flag:returned reason 'timeout'");
  }

  // ==================================== 7. reveal + beacon + 120 s carry cap
  section("reveal at 8 s; beacon 6 m-quantised ≤3 s fresh; 120 s carry cap");
  {
    const { sim, M, events } = liveMatch(206);
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    const fA = M.flags[0];
    holdWorld(sim, 60 * 7, [[B1.who, 21, 3]]);
    ok(fA.revealed === false, "not yet revealed at ~7 s");
    holdWorld(sim, 60 * 2, [[B1.who, 21, 3]]);
    ok(fA.revealed === true, "revealed after 8.0 s of continuous carry");
    ok(flagEvents(events, "revealed").length === 1, "flag:revealed emitted once");
    ok(fA.beacon && fA.beacon.pos.every((v) => Math.abs(v / 6 - Math.round(v / 6)) < 1e-9),
      "beacon position quantised to the 6 m grid (Part 3.8 fidelity)");
    ok(sim.state.time - fA.beacon.t <= 3.01, "beacon sample ≤3.0 s old");
    ok(fA.pubPos === fA.beacon.pos, "pubPos IS the beacon while revealed — never the live pos");
    const drift = Math.hypot(fA.beacon.pos[0] - 21, fA.beacon.pos[2] - 3);
    ok(drift <= 8.6, `beacon within quantisation error of the carrier (${drift.toFixed(1)} m)`);
    // carry cap: run the carry out to 120 s total
    holdWorld(sim, 60 * 112, [[B1.who, 21, 3]]);
    ok(fA.state === "AT_STAND", "flag force-returned at the 120 s carry cap");
    ok(flagEvents(events, "returned").some((e) => e.data.reason === "expired"),
      "flag:returned reason 'expired' (HUD: FLAG RECOVERED — CARRY EXPIRED)");
    ok(sim.state.match.mode.counters.expiredCarries === 1, "expiredCarries counted");
  }

  // ================================================== 8. stuck validation
  section("§3.4 stuck flag — 3 strikes at 1 Hz → force return");
  {
    const { sim, M, events } = liveMatch(207);
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, 79.7, 0, 0); // inside colliders (±80), OUTSIDE arena AABB (±79)
    stepN(sim, 2);
    D.applyDamage(sim, B1.who, 9999, "P", "body", "script");
    stepN(sim, 2);
    ok(M.flags[0].state === "DROPPED", "dropped outside the arena AABB");
    stepN(sim, 60 * 4);
    ok(M.flags[0].state === "AT_STAND", "3 failed 1 Hz validations → force return");
    ok(flagEvents(events, "returned").some((e) => e.data.reason === "stuck"), "flag:returned reason 'stuck'");
    ok(sim.state.match.mode.counters.flagStuckResets === 1, "flagStuckResets counted (probe gate feed)");
  }

  // ======================================== 9. carrier restrictions (human)
  section("§3.5 carrier restrictions — grenades stashed, regen suppressed, then restored");
  {
    const { sim, M } = liveMatch(208);
    const P = sim.state.player;
    const preG = P.grenades || 0;
    ok(preG > 0, `human starts with grenades (${preG})`);
    sim.teleport("P", FLAG_B[0], 0, FLAG_B[2]); // human (AMBER) grabs SLATE flag
    stepN(sim, 2);
    ok(M.flags[1].state === "CARRIED" && M.flags[1].carrier === "P", "human carries the SLATE flag");
    ok((P.grenades || 0) === 0, "carrier grenades stashed to 0 (§3.5.2)");
    if (P._m) ok(P._m.tacLeft === 0, "tac-sprint tank drained while carrying (§3.5.1)");
    else ok(true, "(no movement machine in headless idle — tac assert skipped)");
    D.applyDamage(sim, "P", 50, null, "body", "script");
    const hpAfterHit = P.hp;
    holdWorld(sim, 60 * 6, [["P", FLAG_B[0], FLAG_B[2] + 6]]); // > 4.5 s regen delay
    ok(P.hp <= hpAfterHit + 0.01, `NO regen while carrying (hp ${P.hp.toFixed(1)} vs ${hpAfterHit.toFixed(1)})`);
    // capture (own AMBER flag is home) → carry ends → grenades + regen back
    sim.teleport("P", FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 3);
    ok(M.flags[1].state === "AT_STAND" && M.teams[0].captures === 1, "human captured");
    ok((P.grenades || 0) === preG, "grenades restored when the carry ended");
    stepN(sim, 60 * 6);
    ok(P.hp > hpAfterHit + 5, `regen resumed after the carry (hp ${P.hp.toFixed(1)})`);
  }

  // ================================================ 10. PRESSURE + stalemate
  section("§3.6 PRESSURE at 60 s (rules swap, reveal) → 90 s stalemate reset (AC-6)");
  {
    const { sim, M, events } = liveMatch(209);
    const rules = sim.match.m.rules;
    ok(rules.respawnS === 1.0 && rules.protectS === 0.5, "base rules before pressure");
    const A = livingBot(M, 0, sim.match, true);
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(A.who, FLAG_B[0], 0, FLAG_B[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    ok(M.flags[0].state === "CARRIED" && M.flags[1].state === "CARRIED", "both flags out");
    holdWorld(sim, 60 * 61, [[A.who, 18, 18], [B1.who, -18, -18]]);
    ok(M.mode.pressure.active === true, "PRESSURE entered at 60 s both-off-stand");
    ok(events.some((e) => e.type === "pressure" && e.data.on === true), "'pressure' {on:true} emitted (amendment c)");
    ok(rules.respawnS === 2.0 && rules.protectS === 0.25,
      "respawn 1.0→2.0 (fixture respawnPressureS), protect 0.5→0.25 during PRESSURE");
    ok(M.flags[0].revealed && M.flags[1].revealed, "both carriers revealed regardless of the 8 s rule");
    holdWorld(sim, 60 * 30, [[A.who, 18, 18], [B1.who, -18, -18]]);
    ok(M.flags[0].state === "AT_STAND" && M.flags[1].state === "AT_STAND",
      "90 s → both flags force-returned (FLAGS RESET — STALEMATE)");
    ok(M.mode.counters.forcedResets === 1, "stalemate reset counted once (AC-6 ≤1/match)");
    stepN(sim, 5);
    ok(M.mode.pressure.active === false, "PRESSURE ended after the reset");
    ok(rules.respawnS === 1.0 && rules.protectS === 0.5, "rules restored");
  }

  // ==================================================== 11. spawn veto V7
  section("C7 V7 — flag 12 m, own-stand 15 m while CARRIED, side lock, trap window");
  {
    const { sim, M } = liveMatch(210);
    const mode = sim.match.mode;
    const m = sim.match.m;
    const a0 = M.actors[1]; // an AMBER bot
    const mk = (x, z, cluster) => ({ id: "probe", pos: [x, 0, z], cluster: cluster || "SC_A" });
    ok(mode.spawnVeto(m, a0, mk(FLAG_A[0] + 5, FLAG_A[2])) === true, "point 5 m from a flag → vetoed (12 m rule)");
    ok(mode.spawnVeto(m, a0, mk(0, 28)) === false, "clean own-side point → allowed");
    ok(mode.spawnVeto(m, a0, mk(0, -28, "SC_B")) === true, "enemy-side cluster → vetoed (side lock)");
    // own flag CARRIED → own stand excluded to 15 m (the escaping-carrier rule)
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, 20, 0, 20);
    stepN(sim, 2);
    ok(mode.spawnVeto(m, a0, mk(FLAG_A[0] + 13, FLAG_A[2])) === true,
      "13 m from own stand while own flag CARRIED → vetoed (15 m escape rule)");
    // 12 m follows the flag's CURRENT position (the carrier)
    ok(mode.spawnVeto(m, a0, mk(24, 22)) === true, "point near the CARRIER (flag current pos) → vetoed");
    // trap window: 3 fast spawn-deaths → 20 s kill-zone veto + HUD flag
    // 4 kill cycles: the first death may sit >6 s after the INITIAL spawn
    // (not a trap death); the three respawn-kills that follow are, and 3 of
    // the last 5 spawn records arms the window.
    const victim = M.actors.find((a) => a.kind === "bot" && a.team === 1 && a.who !== B1.who);
    for (let k = 0; k < 4; k++) {
      let guard = 0;
      // wait for respawn AND for spawn protection to lapse — a protected
      // victim shrugs the scripted kill off (correct game behaviour)
      while ((!victim.alive || sim.match.isProtected(victim.who)) && guard++ < 600) sim.step(null);
      const p = m.posOf(victim);
      D.applyDamage(sim, victim.who, 9999, "P", "body", "script");
      stepN(sim, 3);
      if (k === 3) {
        ok(sim.state.time < mode._st.trapUntil[1], "3-of-5 fast spawn-deaths → 20 s trap window armed");
        ok(M.mode.spawnCompromised.length > 0 && M.mode.spawnCompromised[0].team === 1,
          "spawnCompromised published (SPAWN COMPROMISED — FALLING BACK)");
        ok(mode.spawnVeto(m, victim, mk(p[0], p[2], "SC_B")) === true,
          "points inside the camper's kill zone vetoed during the window");
      }
      stepN(sim, 10);
    }
    stepN(sim, 60 * 21);
    ok(sim.state.time >= mode._st.trapUntil[1], "trap window expired after 20 s");
  }

  // ======================================================= 12. duty layer
  section("§5.4 duty layer — rows, closed enum, beacon-gated interceptors, honesty");
  {
    const { sim, M } = liveMatch(211);
    stepN(sim, 60 * 3); // several 2 Hz passes
    const ROLES = ["carrier", "runner", "escort", "defender", "interceptor", "returner", "support"];
    const bots = M.actors.filter((a) => a.alive && a.kind === "bot");
    ok(bots.length === 9, "9 living bots under noTarget");
    ok(bots.every((a) => a.duty && ROLES.includes(a.duty.role)), "every bot has a duty from the CLOSED enum");
    ok(M.actors[0].duty === null, "human duty stays null");
    for (const team of [0, 1]) {
      const tb = bots.filter((a) => a.team === team);
      const runners = tb.filter((a) => a.duty.role === "runner");
      ok(runners.length === 2, `team ${team}: exactly 2 runners with both flags home (§3.4 anti-turtle floor) — got ${runners.length}`);
      const ef = M.flags[1 - team];
      ok(runners.every((a) => Math.hypot(a.duty.target[0] - ef.home[0], a.duty.target[2] - ef.home[2]) < 0.1),
        `team ${team}: runner targets = the enemy stand`);
      ok(tb.some((a) => a.duty.role === "defender"), `team ${team}: has a defender`);
    }
    // grab: AMBER flag taken by SLATE → team 0 rows flip to intercept/defend
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    holdWorld(sim, 45, [[B1.who, 10, -10]]); // < 8 s: unrevealed
    let t0bots = M.actors.filter((a) => a.alive && a.kind === "bot" && a.team === 0);
    ok(t0bots.every((a) => a.duty.role !== "interceptor"),
      "NO interceptors before the reveal — the beacon is the only legal position source");
    holdWorld(sim, 60 * 8, [[B1.who, 10, -10]]); // past reveal
    t0bots = M.actors.filter((a) => a.alive && a.kind === "bot" && a.team === 0);
    const ints = t0bots.filter((a) => a.duty.role === "interceptor");
    ok(ints.length >= 2, `interceptors assigned once the beacon exists (got ${ints.length})`);
    const bc = M.flags[0].beacon;
    ok(bc && ints.every((a) => Math.hypot(a.duty.target[0] - bc.pos[0], a.duty.target[2] - bc.pos[2]) < 0.1),
      "interceptor targets = the BEACON sample (±6 m quantised), never the live carrier pos");
    ok(ints.every((a) => a.duty.targetHint === "cutoff"), "interceptor targetHint 'cutoff' (W7 refines to a path node)");
    // the SLATE carrier bot: forced carrier duty at its own stand
    const cd = M.actors.find((a) => a.who === B1.who).duty;
    ok(cd && cd.role === "carrier" && Math.hypot(cd.target[0] - FLAG_B[0], cd.target[2] - FLAG_B[2]) < 0.1,
      "bot carrier's duty forced to 'carrier', target its OWN stand (§5.4 override)");
    // honesty sweep: every duty target is a PUBLIC point — or, for the
    // carrier's own TEAMMATES (escorts), the carrier's exact pos (Tier R:
    // a team reads its own members exactly; the ENEMY team gets the beacon)
    const m12 = sim.match.m;
    const carrierPos = m12.posOf(m12.actorOf(B1.who));
    const allowedPts = [FLAG_A, FLAG_B, bc.pos, carrierPos,
      [FLAG_A[0] * 0.4 + FLAG_B[0] * 0.6, 0, FLAG_A[2] * 0.4 + FLAG_B[2] * 0.6],
      [FLAG_B[0] * 0.4 + FLAG_A[0] * 0.6, 0, FLAG_B[2] * 0.4 + FLAG_A[2] * 0.6]];
    const nearAllowed = (tp) => allowedPts.some((p) => Math.hypot(tp[0] - p[0], tp[2] - p[2]) < 0.1);
    const bots2 = M.actors.filter((a) => a.alive && a.kind === "bot" && a.who !== B1.who);
    ok(bots2.every((a) => nearAllowed(a.duty.target)),
      "HONESTY: every duty target is a stand, the beacon, or the support midpoint — no live-enemy reads");
  }

  // ============================================= 13. 0:00 tie-break chain
  section("§3.7 tie-break at 0:00 — flag pressure beats the turtle, no overtime");
  {
    const { sim, M } = liveMatch(212, true);
    // SLATE makes one real attempt: grabs and carries the AMBER flag 24 m
    // from home before dying; AMBER never attacks.
    const B1 = livingBot(M, 1, sim.match, true);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    stepHeld(sim, 90, [[B1.who, 0, -20]]); // ≥1 s so the 1 Hz sampler sees it
    D.applyDamage(sim, B1.who, 9999, "P", "body", "script");
    stepN(sim, 2);
    stepN(sim, 60 * 31); // flag times out home; clock runs out
    let guard = 0;
    while (M.phase !== "ended" && guard++ < 60 * 40) sim.step(null);
    ok(M.phase === "ended", "match ended at 0:00");
    ok(M.result && M.result.result === "win" && M.result.winnerTeam === 1,
      "0–0 decided by FLAG PRESSURE — the team that carried closer wins");
    ok(/flag pressure/.test(M.result.reason), `reason names the tie-break (${M.result && M.result.reason})`);
    ok(!sim.match._ms.watchdogFired, "watchdog silent");
  }

  // ========================================= 14. overtime golden capture
  section("§3.7 overtime — all tied → OT (reset + PRESSURE from second one) → golden capture");
  {
    const { sim, M, events } = liveMatch(213, true);
    let guard = 0;
    while (M.phase === "live" && guard++ < 60 * 40) sim.step(null);
    ok(M.phase === "overtime", "all five tie-break steps tied → OVERTIME");
    ok(flagEvents(events, "reset").length >= 2, "both flags force-reset at OT start");
    stepN(sim, 5);
    ok(M.mode.pressure.active === true, "PRESSURE active from the first second of OT");
    ok(sim.match.m.rules.protectS === 0.25, "OT protection = pressure protection");
    const B1 = livingBot(M, 1, sim.match, false);
    sim.teleport(B1.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    sim.teleport(B1.who, FLAG_B[0], 0, FLAG_B[2]);
    stepN(sim, 3);
    ok(M.phase === "ended" && M.result && M.result.result === "win" && M.result.winnerTeam === 1 &&
       M.result.reason === "golden capture",
      "first OT capture wins it — golden capture");
  }

  // ==================================== 15. OT COLLAPSE with CTF exemptions
  section("§3.7 COLLAPSE at OT+60 — carrier + 8 m stand exemptions; match still terminates");
  {
    const { sim, M } = liveMatch(214, true);
    let guard = 0;
    while (M.phase === "live" && guard++ < 60 * 40) sim.step(null);
    ok(M.phase === "overtime", "overtime reached");
    const carrier = livingBot(M, 1, sim.match, false);
    sim.teleport(carrier.who, FLAG_A[0], 0, FLAG_A[2]);
    stepN(sim, 2);
    ok(M.flags[0].carrier === carrier.who, "a SLATE bot carries in OT");
    const standGuard = M.actors.find((a) => a.alive && a.kind === "bot" && a.team === 1 && a !== carrier);
    // hold: carrier far outside the ring; a stand guard 4 m from the SLATE
    // stand (exempt); everything else sits wherever it spawned (outside the
    // ring → zone-damaged once armed).
    const holds = [[carrier.who, 30, 30], [standGuard.who, FLAG_B[0], FLAG_B[2] + 4], ["P", 0, 0]];
    holdWorld(sim, 60 * 66, holds); // to OT+66 — armed at +60
    ok(M.mode.collapse.armed === true, "COLLAPSE armed at OT+60");
    const cBody = sim.state.bots.find((b) => b.id === carrier.who);
    const gBody = sim.state.bots.find((b) => b.id === standGuard.who);
    ok(!!(cBody && cBody.alive && cBody.hp >= 99.9),
      `flag carrier outside the ring takes NO ring damage (hp ${cBody ? cBody.hp.toFixed(1) : "?"})`);
    ok(gBody && gBody.alive && gBody.hp >= 99.9,
      `actor within 8 m of a stand takes NO ring damage (hp ${gBody ? gBody.hp.toFixed(1) : "?"})`);
    const unexempt = M.actors.filter((a) => a.kind === "bot" && a !== carrier && a !== standGuard &&
      (!a.alive || (sim.state.bots.find((b) => b.id === a.who) || { hp: 100 }).hp < 99.9));
    ok(unexempt.length > 0, `unexempt actors outside the ring ARE burned (${unexempt.length} hurt/dead)`);
    guard = 0;
    while (M.phase !== "ended" && guard++ < 60 * 130) holdWorld(sim, 1, holds);
    ok(M.phase === "ended", "OT terminates inside the cap (chain at the cap or golden capture)");
    ok(!sim.match._ms.watchdogFired, "watchdog silent — COLLAPSE + the cap chain are the terminators");
    ok(M.flags.every((f) => f.state === "AT_STAND" || f.state === "CARRIED"),
      "every flag ends AT_STAND or CARRIED (AC-5)");
  }

  // ================================================ 16. natural bot match
  section("natural bot-only run — AC-1 termination, AC-2 watchdog, AC-5 invariant, AC-8 OOB");
  {
    const { sim, events } = makeMatchSim(215, true);
    sim.match.start(sim);
    const M = sim.state.match;
    let ticks = 0;
    const maxTicks = 60 * 260; // 3 warmup + 30 regulation + 180 OT + slack
    while (M.phase !== "ended" && ticks++ < maxTicks) sim.step(null);
    ok(M.phase === "ended", `natural match ended (t=${sim.state.time.toFixed(1)} s)`);
    ok(M.result !== null && ["win", "draw", "forfeit"].includes(M.result.result), "result well-formed (AC-3)");
    ok(!sim.match._ms.watchdogFired, "watchdog never fired (AC-2)");
    const snap = sim.match.snapshot();
    ok(snap.oobDeaths === 0, "zero out-of-bounds backstop deaths (AC-8)");
    ok(M.mode.counters.invariantViolations === 0, "zero flag-invariant violations across the match (AC-5)");
    ok(M.mode.counters.flagStuckResets === 0, "zero stuck-flag resets in a natural match (AC-5)");
    ok(M.mode.counters.forcedResets <= 1, "stalemate reset ≤1 (AC-6)");
    ok(M.flags.every((f) => f.state === "AT_STAND" || f.state === "CARRIED"), "flags end AT_STAND or CARRIED");
  }

  // ================================================ 16b. kill resupply
  section("[P2] kill resupply adopted — +1 mag on kill, reserve cap, bots too, content declares ctf");
  {
    const { sim, events } = makeMatchSim(216);
    sim.match.start(sim);
    const M = sim.state.match;
    stepN(sim, 260);
    sim.setNoTarget(true);
    ok(M.phase === "live", "match live");

    // the live content rule this mechanism reads is authored for ctf
    const rule = (liveContent.pickups || []).find((p) => p.id === "pk_ammo_kill_refill");
    ok(!!rule && rule.kind === "ammo_rule" && rule.magsPerKill === 1 &&
       Array.isArray(rule.modes) && rule.modes.includes("ctf"),
      "live content.json pk_ammo_kill_refill {ammo_rule, magsPerKill:1} declares 'ctf'");

    // (1) player: empty reserve + a kill → exactly one mag back, mirror moves
    const p = sim.state.player;
    const wt = WEAPONS[p.weapon.id];
    p.weapon.reserve = 0;
    if (p._slotAmmo && p._slotAmmo[p.weapon.id]) p._slotAmmo[p.weapon.id].reserve = 0;
    D.applyDamage(sim, livingBot(M, 1, sim.match, true).who, 9999, "P", "body", "script");
    stepN(sim, 2);
    const expect1 = Math.min(wt.reserve, wt.mag);
    ok(p.weapon.reserve === expect1,
      `player kill at 0 reserve → +1 mag: reserve ${p.weapon.reserve} === ${expect1}`);
    ok(p._slotAmmo[p.weapon.id].reserve === p.weapon.reserve,
      "_slotAmmo mirror moved with the live reserve (grantAmmoMag discipline)");
    ok(events.some((e) => e.type === "resupply" && e.data && e.data.who === "P"),
      "'resupply' event emitted for the player");

    // (2) cap: a full reserve gains nothing from the held weapon
    p.weapon.reserve = wt.reserve;
    if (p._slotAmmo && p._slotAmmo[p.weapon.id]) p._slotAmmo[p.weapon.id].reserve = wt.reserve;
    stepN(sim, 120);
    D.applyDamage(sim, livingBot(M, 1, sim.match, true).who, 9999, "P", "body", "script");
    stepN(sim, 2);
    ok(p.weapon.reserve === wt.reserve,
      `reserve CAPPED at the weapon-table start reserve (${wt.reserve})`);

    // (3) bots use the same mechanism through the same onKill hook
    stepN(sim, 120);
    const killerBot = livingBot(M, 1, sim.match, false);
    const kb = sim.match.m.bodyOf(killerBot);
    const bwt = WEAPONS[kb.weapon.id];
    kb.weapon.reserve = 0;
    D.applyDamage(sim, livingBot(M, 0, sim.match, true).who, 9999, killerBot.who, "body", "script");
    stepN(sim, 2);
    const expectB = Math.min(bwt.reserve, bwt.mag);
    ok(kb.weapon.reserve === expectB,
      `bot killer at 0 reserve → +1 mag: reserve ${kb.weapon.reserve} === ${expectB}`);
    ok(!sim.match._ms.watchdogFired, "watchdog silent through the resupply battery");
  }

  // ================================================== 17. determinism
  section("determinism — same seed twice → identical snapshot + flag-log hashes (AC-7)");
  {
    function runScripted(seed) {
      const { sim } = makeMatchSim(seed, true);
      sim.match.start(sim);
      const M = sim.state.match;
      let ticks = 0;
      const maxTicks = 60 * 260;
      while (M.phase !== "ended" && ticks < maxTicks) {
        sim.step(null);
        ticks++;
        if (ticks % 300 === 0) { // scripted asymmetric damage, deterministic
          const living = M.actors.filter((a) => a.alive && a.kind === "bot" && a.team === 1);
          if (living.length) {
            const D2 = D;
            D2.applyDamage(sim, living[0].who, 60, "P", "body", "script");
          }
        }
      }
      return {
        snapHash: djb2(JSON.stringify(sim.match.snapshot())),
        logHash: djb2(JSON.stringify(M.mode.flagLog)),
        ended: M.phase === "ended",
        watchdog: sim.match._ms.watchdogFired,
      };
    }
    const a = runScripted(9), b = runScripted(9);
    ok(a.ended && b.ended, "scripted matches terminate (AC-1)");
    ok(!a.watchdog && !b.watchdog, "watchdog never fired (AC-2)");
    ok(a.snapHash === b.snapHash, `same seed → identical snapshot hash (${a.snapHash})`);
    ok(a.logHash === b.logHash, "same seed → identical flag event log");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("selftest crashed:", e); process.exit(1); });
