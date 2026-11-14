#!/usr/bin/env node
/* core/match/modes/ffa.selftest.cjs [W9] — MODE: FFA battery
 * (PVP_BUILD_PLAN Part 4.1 row W9; modes.md Part 4; C8/C12/C13/C15;
 * GAME_DOCTRINE §2 — no team-radio channel exists in FFA).
 *
 * Run: node core/match/modes/ffa.selftest.cjs   → exit 0 on green.
 *
 * What is proven here, against the REAL driver + REAL sim on the synthetic
 * flat fixture (same fixture family as tdm.selftest.cjs):
 *   - frozen interface: id 'ffa', displayName, teamCount 'perActor', C12
 *     defaults exact incl. leaderMark {atScore:15, orLeadBy:5}; purity
 *     (no imports at all, no wall clock, no Math.random) and the NO-RADIO
 *     bar: the module's CODE contains no radio/comms/lastKnown/blackboard
 *     reads, no state.player, no .hp/.yaw/.weapon reads of any actor
 *   - ten teams of one: 10 roster teams, team === actorId, every pair of
 *     actors mutually hostile, per-bot squad ids (no shared squad = no
 *     token sharing, no shared blackboard), bot-on-bot and self damage
 *     both land (friendly fire is trivially everyone)
 *   - C8 wiring: a REAL spawns.js director attached to a live FFA match
 *     routes every pick through the FFA path (picks counted, points real)
 *   - score-limit win (outright only), the C15 ledger 100/25/+150 marked-
 *     leader kill, §4.2 leader marker arm via orLeadBy + atScore, tie
 *     disarms, leaderMark events
 *   - time-up: outright win, then the §4.1 tie-break chain — fewer
 *     deaths, earliest to the final count, genuine tie → overtime
 *   - §4.5 overtime: only tied leaders can win; first tied-leader kill
 *     wins; a tied leader's death eliminates them; last leader standing
 *     wins immediately; simultaneous elimination → draw; no OT respawns
 *   - COLLAPSE arms at OT+60 s with FULL damage and NO exemptions, zone
 *     death is a death (never a kill) and eliminates a tied leader,
 *     terminating a passive overtime inside the cap; duty → 'collapse'
 *   - duty layer: CLOSED enum {hunt_leader, roam, collapse}; with no
 *     marked leader every duty target is a STATIC anchor (the honesty
 *     bar — death positions are deliberately unused in FFA); with a
 *     marked leader exactly ≤2 hunt_leader (AC-28) tracking the public
 *     chevron and everyone else still on static anchors
 *   - determinism: same seed twice through a REAL unpinned bot-vs-bot
 *     FFA → identical snapshot + duty-log hashes (AC-7); AC-2/AC-8 clean
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
const COLLAPSE_CENTRE = [0, 0, 0]; // fixture override — exercises content.match.collapse

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

function syntheticContent(realArchetypes) {
  const spawnPoints = [];
  for (let c = 0; c < 2; c++) {
    const cz = c === 0 ? 30 : -30;
    for (let i = 0; i < 22; i++) {
      const x = -30 + (i % 11) * 6;
      const z = cz + Math.floor(i / 11) * 4;
      spawnPoints.push({
        id: `sp_${c}_${i}`, cluster: c === 0 ? "SC_A" : "SC_B",
        pos: [x, 0, z], yaw: c === 0 ? Math.PI : 0, team: c,
      });
    }
  }
  return {
    version: 2,
    arena: {
      id: "flat_fixture",
      bounds: { min: [-79, -2, -79], max: [79, 20, 79] },
      outOfBounds: { graceS: 5.0 },
    },
    match: {
      collapse: {
        centre: COLLAPSE_CENTRE.slice(),
        r0: 12, r1: 6, shrinkS: 30, dps0: 5, dps1: 15, rampS: 20, armsAfterOtS: 60,
      },
    },
    teams: [
      { id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a" },
      { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b" },
    ],
    botRoster: [
      { slot: 1, archetype: "cqb" }, { slot: 2, archetype: "rifleman" },
      { slot: 3, archetype: "marksman" }, { slot: 4, archetype: "cqb" },
      { slot: 5, archetype: "rifleman" }, { slot: 6, archetype: "rifleman" },
      { slot: 7, archetype: "cqb" }, { slot: 8, archetype: "rifleman" },
      { slot: 9, archetype: "marksman" },
    ],
    clusters: {
      SC_A: { anchor: [0, 0, 30] },
      SC_B: { anchor: [0, 0, -30] },
    },
    spawnPoints,
    flags: [
      { id: "flag_t0", team: 0, home: [0, 0, 34], yaw: 0 },
      { id: "flag_t1", team: 1, home: [0, 0, -34], yaw: 0 },
    ],
    modes: {
      tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ffa: {
        scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5,
        leaderMark: { atScore: 3, orLeadBy: 2 },
      },
    },
    archetypes: realArchetypes,
    pickups: [],
    scenarios: {},
  };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const MODE = await import(u("core/match/modes/ffa.js"));
  const ROSTER = await import(u("core/match/roster.js"));
  const SPAWNS = await import(u("core/match/spawns.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const D = await import(u("core/sim/damage.js"));
  const liveContent = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const WEAPONS = WD.WEAPONS;

  MATCH.registerMode("ffa", MODE.createMode);
  const fixtureContent = syntheticContent(liveContent.archetypes);

  function makeMatchSim(seed, matchOpts) {
    const events = [];
    const sim = S.createSim({
      content: fixtureContent,
      colliders: flatColliders(),
      weapons: WEAPONS,
      seed,
      mode: "ffa",
      tuning: "pvp",
      matchOpts: matchOpts || {},
      emit: (type, data) => events.push({ type, data }),
    });
    return { sim, events };
  }

  function stepN(sim, n) { for (let i = 0; i < n; i++) sim.step(null); }

  // Pin every bot in a tight disarmed clump at `centre` (grenades ineligible
  // below their 8 m minimum range, mags stripped → no organic kills), pin
  // the human at `humanAt`. Same technique as tdm.selftest §7.
  function pinDisarm(sim, humanAt) {
    const M = sim.state.match;
    const h = humanAt || COLLAPSE_CENTRE;
    sim.teleport("P", h[0], 0, h[2]);
    let i = 0;
    for (const a of M.actors) {
      if (a.kind !== "bot" || !a.alive) continue;
      const b = sim.state.bots.find((x) => x.id === a.who);
      if (!b) continue;
      const x = COLLAPSE_CENTRE[0] + ((i % 3) - 1) * 2;
      const z = COLLAPSE_CENTRE[2] + (Math.floor(i / 3) - 1) * 2;
      sim.teleport(a.who, x, 0, z);
      b.weapon.mag = 0; b.weapon.reserve = 0;
      i++;
    }
  }
  function stepPinned(sim, n, humanAt) {
    for (let i = 0; i < n; i++) { pinDisarm(sim, humanAt); sim.step(null); }
  }
  function livingBot(M, match, opts = {}) {
    return M.actors.find((a) =>
      a.alive && a.kind === "bot" &&
      (opts.not == null || a.actorId !== opts.not) &&
      (opts.not2 == null || a.actorId !== opts.not2) &&
      (!opts.needUnprotected || !match.isProtected(a.who)));
  }
  // wait (pinned) until the victim is unprotected, then land a scripted kill
  function scriptKillPinned(sim, victim, killerWho, humanAt) {
    let guard = 0;
    while (sim.match.isProtected(victim.who) && guard++ < 900) stepPinned(sim, 1, humanAt);
    D.applyDamage(sim, victim.who, 9999, killerWho, "body", "script");
  }
  function startPinned(seed, matchOpts) {
    const r = makeMatchSim(seed, matchOpts);
    r.sim.match.start(r.sim);
    stepPinned(r.sim, 260); // past warmup (3 s) + first-spawn protection (0.5 s)
    r.sim.setNoTarget(true); // hide the player from perception; bots are disarmed anyway
    return r;
  }

  // ============================================================ 1. interface
  section("frozen interface + purity + NO-RADIO (Part 3.5, C12, doctrine §2)");
  {
    const src = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/ffa.js"), "utf8");
    ok(!/^\s*import\s/m.test(src), "zero imports — trivially THREE-free, sibling-free, sim-free");
    ok(!/Math\.random|Date\.now|performance\.now/.test(src),
      "no Math.random, no wall-clock reads (deterministic by construction)");
    // The NO-RADIO bar: strip comments, then grep the CODE. In FFA there is
    // no Tier-R channel (doctrine §2) — this module must never touch one,
    // and must never read another actor's hp/yaw/weapon or state.player.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    ok(!/radio|comms|lastKnown|blackboard|commsGroup/i.test(code),
      "NO TEAM-RADIO: code has no radio/comms/lastKnown/blackboard/commsGroup reference");
    ok(!/state\.player|\.percept\b|\._obj\b/.test(code),
      "no state.player, no bot.percept, no bot._obj reads");
    ok(!/\.hp\b|\.yaw\b|\.weapon\b/.test(code),
      "never reads any actor's hp / yaw / weapon (AC-34 class)");
    const mode = MODE.createMode({ id: "ffa", content: {}, rules: {}, rng: () => 0.5 });
    ok(mode.id === "ffa", "mode.id === 'ffa' (C1)");
    ok(mode.displayName === "FREE-FOR-ALL", "displayName 'FREE-FOR-ALL'");
    ok(mode.teamCount === "perActor",
      "teamCount 'perActor' — ten teams of one; this IS the C8 FFA spawn-path request");
    const d = mode.defaults;
    ok(d.scoreLimit === 25 && d.timeLimitS === 480 && d.respawnS === 3.0 && d.protectS === 2.0,
      "C12 defaults exact: {scoreLimit:25, timeLimitS:480, respawnS:3.0, protectS:2.0}");
    ok(d.leaderMark && d.leaderMark.atScore === 15 && d.leaderMark.orLeadBy === 5,
      "leaderMark defaults {atScore:15, orLeadBy:5} (W9 frozen interface)");
    for (const fn of ["start", "tick", "end", "checkWin", "assignDuties", "onKill", "onDeath", "onSpawn", "spawnVeto", "hudModel", "scoreForKill"]) {
      ok(typeof mode[fn] === "function", `mode.${fn} is a function`);
    }
    ok(mode.spawnVeto() === false, "spawnVeto always false (C7 — ffa has no mode veto)");
  }

  // =============================================== 2. ten teams of one + C8
  section("ten teams of one — everyone hostile, per-bot squads, FFA spawn path (C8)");
  {
    const director = SPAWNS.makeSpawns({
      id: "flat_fixture",
      bounds: fixtureContent.arena.bounds,
      clusters: fixtureContent.clusters,
      spawnPoints: fixtureContent.spawnPoints,
      flags: fixtureContent.flags,
    }, { seed: 42 });
    const { sim } = makeMatchSim(201, { spawnDirector: director });
    sim.match.start(sim);
    const M = sim.state.match;
    ok(M.modeId === "ffa", "state.match.modeId 'ffa'");
    ok(M.teams.length === 10, "10 teams (ten teams of one — Part 3.4)");
    ok(M.actors.every((a) => a.team === a.actorId), "team === actorId for every actor");
    ok(M.actors[0].kind === "human" && M.actors[0].team === 0,
      "the human is actorId 0, team 0 — the same rule, no special case");
    let allHostile = true;
    for (const a of M.actors) for (const b of M.actors) {
      if (a !== b && !ROSTER.areEnemies(a, b)) allHostile = false;
    }
    ok(allHostile, "areEnemies() true for EVERY distinct pair (friendly fire is trivially everyone)");
    const squads = sim.state.bots.map((b) => b.squadId);
    ok(squads.length === 9 && new Set(squads).size === 9 && squads.every((s) => /^ffa_\d$/.test(s)),
      "9 bots, 9 DISTINCT ffa_<actorId> squads — no shared squad, no shared blackboard (C21)");
    const bands = sim.state.bots.map((b) => b.band).sort().join(",");
    ok(/hardened/.test(bands) && /recruit/.test(bands) && /regular/.test(bands),
      "STANDARD FFA band mix present (2 recruit / 4 regular / 3 hardened): " + bands);
    // C8 — the real director served every one of the 10 first spawns
    const snap0 = director.snapshot();
    ok(snap0.picks === 10, `spawns.js director served all 10 first spawns (picks=${snap0.picks})`);
    ok(M.actors.every((a) => a.spawnPointId == null || fixtureContent.spawnPoints.some((p) => p.id === a.spawnPointId)),
      "every director pick is a real authored point");
    // damage gate: bot-on-bot lands, self-damage lands
    stepPinned(sim, 260);
    sim.setNoTarget(true);
    const A = livingBot(M, sim.match, { needUnprotected: true });
    const B = livingBot(M, sim.match, { not: A.actorId, needUnprotected: true });
    const bodyB = sim.state.bots.find((x) => x.id === B.who);
    const hpB = bodyB.hp;
    D.applyDamage(sim, B.who, 15, A.who, "body", "script");
    ok(bodyB.hp === hpB - 15, "bot-on-bot damage LANDS (no sameTeam gate between distinct actors)");
    const bodyA = sim.state.bots.find((x) => x.id === A.who);
    const hpA = bodyA.hp;
    D.applyDamage(sim, A.who, 10, A.who, "body", "grenade");
    ok(bodyA.hp === hpA - 10, "self-damage still lands at 100% (attacker !== who clause)");
  }

  // ================================== 3. score limit + ledger + leader mark
  section("score-limit win, C15 ledger (100/25/+150), §4.2 marker arm/disarm");
  {
    const { sim, events } = startPinned(202);
    const M = sim.state.match;
    ok(sim.match.m.rules.scoreLimit === 4 && sim.match.m.rules.leaderMark.atScore === 3,
      "content.modes.ffa overrides mode defaults through the driver merge");
    ok(M.phase === "live", "match live");
    const markEvents = () => events.filter((e) => e.type === "leaderMark").map((e) => e.data);

    // human kill #1 — no mark yet (max 1, lead 1 < 2, atScore 3 not reached)
    scriptKillPinned(sim, livingBot(M, sim.match, { needUnprotected: true }), "P");
    stepPinned(sim, 4);
    ok(markEvents().length === 0 && M.mode.leader.on === false, "1 kill, lead 1 → no mark");

    // human kill #2 — lead 2 ≥ orLeadBy 2 → HUMAN marked
    scriptKillPinned(sim, livingBot(M, sim.match, { needUnprotected: true }), "P");
    stepPinned(sim, 4);
    let ev = markEvents();
    ok(ev.length === 1 && ev[0].actorId === 0 && ev[0].on === true,
      "2-0 lead → leaderMark {actorId:0, on:true} emitted (§4.2 via orLeadBy)");
    ok(M.mode.leader.on === true && M.mode.leader.actorId === 0,
      "state.mode.leader published for the HUD (YOU ARE MARKED)");
    const hm = sim.match.mode.hudModel(sim.match.m);
    ok(/YOU ARE MARKED/.test(hm.objectives[0].label), "hudModel: 'YOU ARE MARKED' — nobody is tracked silently");
    ok(hm.markers.some((mk) => mk.id === "leader" && mk.actorId === 0), "leader chevron marker present");

    // bot B ties at 2 → a tie DISARMS the mark
    const B = livingBot(M, sim.match, {});
    for (let k = 0; k < 2; k++) {
      scriptKillPinned(sim, livingBot(M, sim.match, { not: B.actorId, needUnprotected: true }), B.who);
      stepPinned(sim, 4);
    }
    ev = markEvents();
    ok(ev.length === 2 && ev[1].actorId === 0 && ev[1].on === false,
      "2-2 tie → leaderMark {actorId:0, on:false} — a tie disarms it (§4.2)");

    // B reaches 3 (atScore) → B marked; the human kills the MARKED leader
    scriptKillPinned(sim, livingBot(M, sim.match, { not: B.actorId, needUnprotected: true }), B.who);
    stepPinned(sim, 4);
    ev = markEvents();
    ok(ev.length === 3 && ev[2].actorId === B.actorId && ev[2].on === true,
      "3 kills → atScore arms the mark on bot " + B.actorId);
    const scoreBefore = M.actors[0].score;
    let guard = 0;
    while (sim.match.isProtected(B.who) && guard++ < 900) stepPinned(sim, 1);
    D.applyDamage(sim, B.who, 9999, "P", "body", "script");
    stepPinned(sim, 4);
    ok(M.actors[0].score - scoreBefore === 250,
      `marked-leader kill pays 100 + 150 = 250 personal (C15 stack): +${M.actors[0].score - scoreBefore}`);
    ok(M.actors[0].kills === 3, "human now on 3 kills");

    // 4th human kill → score limit (outright: 4 vs 3)
    scriptKillPinned(sim, livingBot(M, sim.match, { not: B.actorId, needUnprotected: true }), "P");
    stepPinned(sim, 4);
    ok(M.phase === "ended", "4th kill ends the match at the score limit");
    ok(M.result && M.result.result === "win" && M.result.winnerTeam === 0 && M.result.reason === "score limit",
      "result: win, winnerTeam 0 (the human's team-of-one), reason 'score limit'");
    ok(M.teams[0].score === 4 && M.teams[B.actorId].score === 3,
      "per-actor team scores mirror kills (AC-3 consistency)");
    ok(M.actors[0].score === 550, `personal ledger 100+100+250+100 = 550 (got ${M.actors[0].score})`);
    ok(!sim.match._ms.watchdogFired, "watchdog never fired (AC-2)");
  }

  // ======================================== 4. time-up + §4.1 tie-break chain
  section("time limit — outright win, fewer-deaths break, earliest-to-score break");
  {
    // (a) outright leader at 0:00
    {
      const { sim } = startPinned(203);
      const M = sim.state.match;
      scriptKillPinned(sim, livingBot(M, sim.match, { needUnprotected: true }), "P");
      let guard = 0;
      while (M.phase !== "ended" && guard++ < 60 * 45) stepPinned(sim, 1);
      ok(M.phase === "ended" && M.result.result === "win" && M.result.winnerTeam === 0 &&
         M.result.reason === "time", "1 kill vs 0 at 0:00 → win, reason 'time'");
      ok(sim.state.phase === "won", "human's team-of-one won → sim phase 'won' (C29b)");
    }
    // (b) tied kills → fewer deaths wins
    {
      const { sim } = startPinned(204);
      const M = sim.state.match;
      const B = livingBot(M, sim.match, {});
      const v1 = livingBot(M, sim.match, { not: B.actorId, needUnprotected: true });
      const v2 = livingBot(M, sim.match, { not: B.actorId, not2: v1.actorId, needUnprotected: true });
      D.applyDamage(sim, v1.who, 9999, "P", "body", "script");
      D.applyDamage(sim, v2.who, 9999, B.who, "body", "script"); // same tick → same lastKillT
      stepPinned(sim, 4);
      let guard = 0; // now give B one death — a SUICIDE, so no third actor
      // picks up a kill and joins the tie (§2.2: suicide awards nothing)
      while (sim.match.isProtected(B.who) && guard++ < 900) stepPinned(sim, 1);
      D.applyDamage(sim, B.who, 9999, B.who, "body", "grenade");
      guard = 0;
      while (M.phase !== "ended" && guard++ < 60 * 45) stepPinned(sim, 1);
      ok(M.result && M.result.result === "win" && M.result.winnerTeam === 0 &&
         M.result.reason === "time tiebreak (fewer deaths)",
        "1-1 kills, human 0 deaths vs bot 1 → 'time tiebreak (fewer deaths)'");
    }
    // (c) tied kills, tied deaths → earliest to the final count wins
    {
      const { sim } = startPinned(205);
      const M = sim.state.match;
      const B = livingBot(M, sim.match, {});
      scriptKillPinned(sim, livingBot(M, sim.match, { not: B.actorId, needUnprotected: true }), "P");
      stepPinned(sim, 120); // 2 s later B reaches the same count
      scriptKillPinned(sim, livingBot(M, sim.match, { not: B.actorId, needUnprotected: true }), B.who);
      let guard = 0;
      while (M.phase !== "ended" && guard++ < 60 * 45) stepPinned(sim, 1);
      ok(M.result && M.result.result === "win" && M.result.winnerTeam === 0 &&
         M.result.reason === "time tiebreak (earliest to the score)",
        "1-1, 0-0 deaths, human scored 2 s earlier → 'time tiebreak (earliest to the score)'");
    }
  }

  // ============================================== 5. §4.5 overtime machine
  section("§4.5 overtime — tied leaders only; kill wins; elimination; draw");
  {
    // reach OT with EXACTLY {human, B} tied at 1 kill each (same-tick kills)
    function tieOfTwo(seed) {
      const r = startPinned(seed);
      const M = r.sim.state.match;
      const B = livingBot(M, r.sim.match, {});
      const v1 = livingBot(M, r.sim.match, { not: B.actorId, needUnprotected: true });
      const v2 = livingBot(M, r.sim.match, { not: B.actorId, not2: v1.actorId, needUnprotected: true });
      D.applyDamage(r.sim, v1.who, 9999, "P", "body", "script");
      D.applyDamage(r.sim, v2.who, 9999, B.who, "body", "script");
      let guard = 0;
      while (M.phase !== "overtime" && M.phase !== "ended" && guard++ < 60 * 45) stepPinned(r.sim, 1);
      return Object.assign(r, { M, B });
    }

    // (a) elimination → last leader standing wins immediately
    {
      const { sim, M, B } = tieOfTwo(206);
      ok(M.phase === "overtime", "genuine 1-1 tie (equal deaths, same kill tick) → overtime");
      ok(JSON.stringify(M.mode.overtime.tied) === JSON.stringify([0, B.actorId]),
        `tied leaders published: [0, ${B.actorId}]`);
      const C = livingBot(M, sim.match, { not: B.actorId });
      D.applyDamage(sim, B.who, 9999, C.who, "body", "script");
      stepPinned(sim, 4);
      ok(M.phase === "ended" && M.result.result === "win" && M.result.winnerTeam === 0 &&
         M.result.reason === "overtime last leader",
        "tied leader B dies → eliminated → the human wins as LAST LEADER STANDING");
      ok(!B.alive && B.respawnAtT < 0, "no respawns in overtime — B stays down");
      ok(M.teams[C.actorId].score === (M.actors[C.actorId] ? M.actors[C.actorId].kills : 0),
        "C's kill still counts on C's board — the kingmaker changed nothing about the win rule");
    }
    // (b) first tied-leader kill wins outright
    {
      const { sim, M, B } = tieOfTwo(207);
      ok(M.phase === "overtime", "overtime reached");
      let guard = 0;
      const v = livingBot(M, sim.match, { not: B.actorId });
      while (sim.match.isProtected(v.who) && guard++ < 900) stepPinned(sim, 1);
      D.applyDamage(sim, v.who, 9999, "P", "body", "script");
      stepPinned(sim, 4);
      ok(M.phase === "ended" && M.result.result === "win" && M.result.winnerTeam === 0 &&
         M.result.reason === "overtime kill",
        "the human (tied leader) scores first OT kill → wins immediately");
    }
    // (c) both tied leaders die on the same tick → draw among the tied
    {
      const { sim, M, B } = tieOfTwo(208);
      ok(M.phase === "overtime", "overtime reached");
      const C = livingBot(M, sim.match, { not: B.actorId });
      D.applyDamage(sim, B.who, 9999, C.who, "body", "script");
      D.applyDamage(sim, "P", 9999, C.who, "body", "script");
      stepPinned(sim, 4);
      ok(M.phase === "ended" && M.result.result === "draw" && M.result.winnerTeam === null &&
         M.result.reason === "overtime leaders eliminated",
        "ALL tied leaders dead simultaneously → draw (§4.5)");
    }
  }

  // ================================================ 6. COLLAPSE terminates
  section("COLLAPSE — arms at OT+60 s, FULL damage, NO exemptions, eliminates a leader");
  {
    const { sim, events } = makeMatchSim(209);
    sim.match.start(sim);
    const M = sim.state.match;
    stepPinned(sim, 260);
    sim.setNoTarget(true);
    const B = livingBot(M, sim.match, {});
    const v1 = livingBot(M, sim.match, { not: B.actorId, needUnprotected: true });
    const v2 = livingBot(M, sim.match, { not: B.actorId, not2: v1.actorId, needUnprotected: true });
    D.applyDamage(sim, v1.who, 9999, "P", "body", "script");
    D.applyDamage(sim, v2.who, 9999, B.who, "body", "script");
    // pin variant: B held OUTSIDE the ring at (30,30); everyone else inside
    function stepOut(n) {
      for (let i = 0; i < n; i++) {
        pinDisarm(sim);
        const bb = sim.state.bots.find((x) => x.id === B.who);
        if (bb && bb.alive) { sim.teleport(B.who, 30, 0, 30); bb.weapon.mag = 0; bb.weapon.reserve = 0; }
        sim.step(null);
      }
    }
    let guard = 0;
    while (M.phase !== "overtime" && M.phase !== "ended" && guard++ < 60 * 45) stepOut(1);
    ok(M.phase === "overtime", "1-1 tie → overtime, B pinned outside the future ring");
    const scoresAtOt = M.teams.map((t) => t.score).join(",");
    stepOut(60 * 61);
    ok(M.mode.collapse && M.mode.collapse.armed === true, "state.mode.collapse.armed at OT+60 s");
    ok(events.some((e) => e.type === "collapse" && e.data.armed), "'collapse' event emitted (freeze amendment c)");
    ok(Math.abs(M.mode.collapse.centre[0] - COLLAPSE_CENTRE[0]) < 1e-6,
      "collapse centre honours content.match.collapse override");
    if (M.phase !== "ended") {
      const bots = M.actors.filter((a) => a.alive && a.kind === "bot");
      ok(bots.length > 0 && bots.every((a) => a.duty && a.duty.role === "collapse" && a.duty.urgency === 1.0),
        "all living bots' duty → 'collapse', urgency 1.0");
    } else ok(true, "(duty sample skipped — zone already resolved it)");
    guard = 0;
    while (M.phase !== "ended" && guard++ < 60 * 120) stepOut(1);
    ok(M.phase === "ended", "COLLAPSE terminated the passive overtime");
    ok(M.result.result === "win" && M.result.winnerTeam === 0 && M.result.reason === "overtime last leader",
      "zone killed the tied leader OUTSIDE the ring (full damage, no exemptions) → human is last leader");
    ok(M.teams.map((t) => t.score).join(",") === scoresAtOt,
      "zone death is a death, never a kill — no board moved (§2.2/§4.5)");
    ok(sim.match.snapshot().oobDeaths === 0, "zero out-of-bounds backstop deaths (AC-8)");
    ok(!sim.match._ms.watchdogFired, "watchdog never fired — COLLAPSE is the terminator");
    ok(sim.state.time < 33 + 180, `terminated inside the OT cap: t=${sim.state.time.toFixed(1)}`);
  }

  // ======================================================== 7. duty layer
  section("duty layer — closed enum, static-anchor honesty, ≤2 leader hunters (AC-28)");
  {
    const { sim } = startPinned(210);
    const M = sim.state.match;
    stepPinned(sim, 60 * 5); // ≥10 assignDuties passes, zero kills, no mark
    const ROLES = ["hunt_leader", "roam", "collapse"];
    const bots = M.actors.filter((a) => a.alive && a.kind === "bot");
    ok(bots.length === 9, "9 living bots (pinned + disarmed → nobody died)");
    ok(bots.every((a) => a.duty && ROLES.includes(a.duty.role)),
      "every living bot has a duty from the CLOSED enum {hunt_leader, roam, collapse}");
    ok(M.actors[0].duty === null, "the human's duty stays null — duties steer bots only");
    ok(bots.every((a) => a.duty.role === "roam"), "no marked leader → every duty is 'roam'");
    // THE HONESTY BAR: no radio, no killfeed positions in FFA — with no mark
    // armed, every target must be STATIC data (cluster anchors / centre).
    const allowed = [[0, 0, 30], [0, 0, -30], [0, 0, 0]];
    const nearAllowed = (t) => allowed.some((p) => Math.hypot(t[0] - p[0], t[2] - p[2]) < 0.05);
    ok(bots.every((a) => nearAllowed(a.duty.target)),
      "HONESTY: every duty target is a static anchor — no living-actor reads, no death positions");
    const before = bots.map((a) => a.actorId + ":" + a.duty.role).join(",");
    stepPinned(sim, 30);
    const after = bots.map((a) => a.actorId + ":" + a.duty.role).join(",");
    ok(before === after, "roles stable across a 0.5 s window (4 s latch — no thrash)");

    // arm the mark on the human (2 quick kills), stand the human at (12,0,12)
    scriptKillPinned(sim, livingBot(M, sim.match, { needUnprotected: true }), "P", [12, 0, 12]);
    scriptKillPinned(sim, livingBot(M, sim.match, { needUnprotected: true }), "P", [12, 0, 12]);
    stepPinned(sim, 60 * 5, [12, 0, 12]); // several duty passes with the mark armed
    ok(M.mode.leader.on === true && M.mode.leader.actorId === 0, "human marked (2-0 ≥ orLeadBy)");
    const living = M.actors.filter((a) => a.alive && a.kind === "bot");
    const hunters = living.filter((a) => a.duty && a.duty.role === "hunt_leader");
    ok(hunters.length >= 1 && hunters.length <= 2,
      `1–2 hunt_leader, never more (AC-28 cap): got ${hunters.length}`);
    ok(hunters.every((a) => Math.hypot(a.duty.target[0] - 12, a.duty.target[2] - 12) < 1.0),
      "hunters' targets track the PUBLIC chevron position (12,0,12) — a goal, never an aim point");
    ok(living.filter((a) => a.duty.role === "roam").every((a) => nearAllowed(a.duty.target)),
      "everyone else still on static anchors");
  }

  // ====================================================== 8. determinism
  section("determinism — real unpinned bot-vs-bot FFA, same seed twice (AC-7)");
  {
    function runReal(seed) {
      const { sim } = makeMatchSim(seed);
      sim.match.start(sim);
      const M = sim.state.match;
      const dutyLog = [];
      let ticks = 0;
      const maxTicks = 60 * (3 + 30 + 180 + 30);
      while (M.phase !== "ended" && ticks < maxTicks) {
        sim.step(null);
        ticks++;
        if (ticks % 30 === 0) {
          dutyLog.push(M.actors.map((a) => (a.duty ? a.duty.role[0] : "-")).join(""));
        }
      }
      return {
        snapHash: djb2(JSON.stringify(sim.match.snapshot())),
        dutyHash: djb2(dutyLog.join("|")),
        ended: M.phase === "ended",
        watchdog: sim.match._ms.watchdogFired,
        oob: sim.match.snapshot().oobDeaths,
        kills: M.actors.map((a) => a.kills),
        result: M.result,
      };
    }
    const a = runReal(7), b = runReal(7);
    ok(a.ended && b.ended, "real bot-vs-bot FFA terminates (AC-1)");
    ok(!a.watchdog && !b.watchdog, "watchdog never fired (AC-2)");
    ok(a.oob === 0, "zero OOB backstop deaths (AC-8)");
    ok(a.snapHash === b.snapHash, `same seed → identical snapshot hash (${a.snapHash})`);
    ok(a.dutyHash === b.dutyHash, "same seed → identical duty-assignment log");
    ok(a.result && (a.result.result === "win" || a.result.result === "draw"),
      `clean result: ${a.result.result}${a.result.winnerTeam != null ? " team " + a.result.winnerTeam : ""} (${a.result.reason})`);
    const scorers = a.kills.filter((k) => k > 0).length;
    ok(scorers >= 1, `bots actually fight: ${scorers} actors scored (${a.kills.join(",")})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("selftest crashed:", e); process.exit(1); });
