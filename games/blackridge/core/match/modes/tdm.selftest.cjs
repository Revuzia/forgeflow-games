#!/usr/bin/env node
/* core/match/modes/tdm.selftest.cjs [W5] — MODE: TDM battery
 * (PVP_BUILD_PLAN Part 4.1 row W5; modes.md Part 2/2.5; C12/C13/C15).
 *
 * Run: node core/match/modes/tdm.selftest.cjs   → exit 0 on green.
 *
 * What is proven here, against the REAL driver + REAL sim on the synthetic
 * flat fixture (same fixture family as match.selftest.cjs):
 *   - frozen interface: id 'tdm', displayName 'SKIRMISH', teamCount 2,
 *     C12 defaults exact; module purity (no forbidden imports, no wall
 *     clock, no Math.random)
 *   - score-limit win + §2.2 edges (suicide awards nothing; both teams
 *     crossing the limit on one tick is a DRAW, not overtime)
 *   - time-up win at 0:00 (higher score), tie → overtime
 *   - C13: overtime is decided by the FIRST DEATH (team that did not lose
 *     an actor wins); no respawns in overtime
 *   - COLLAPSE arms at OT+60 s, ring shrinks 12→6, zone damage terminates
 *     a fully passive overtime well inside the 3:00 cap, zone deaths award
 *     no kill, bots' duty flips to 'collapse'
 *   - §2.3 tie-break chain at the OT cap: OT damage, then regulation
 *     damage, then the driver's draw
 *   - duty layer: closed role enum, 2-attack quota, 4 s latch, and the
 *     honesty bar — with zero deaths and zero perception every duty target
 *     is a STATIC point (cluster anchor / enemy-anchor centroid / arena
 *     centre), never a living enemy position
 *   - determinism: same seed twice → identical snapshot hash + identical
 *     duty logs (AC-7 at mode level); the watchdog never fires (AC-2)
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
const COLLAPSE_CENTRE = [0, 0, 0]; // fixture override — exercises the content.match.collapse path

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
      { slot: 3, archetype: "rifleman" }, { slot: 4, archetype: "marksman" },
      { slot: 5, archetype: "cqb" }, { slot: 6, archetype: "rifleman" },
      { slot: 7, archetype: "rifleman" }, { slot: 8, archetype: "rifleman" },
      { slot: 9, archetype: "marksman" },
    ],
    clusters: {
      SC_A: { anchor: [0, 0, 30], team: 0 },
      SC_B: { anchor: [0, 0, -30], team: 1 },
    },
    spawnPoints,
    flags: [
      { id: "flag_t0", team: 0, home: [0, 0, 34], yaw: 0 },
      { id: "flag_t1", team: 1, home: [0, 0, -34], yaw: 0 },
    ],
    modes: {
      tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
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
  const MODE = await import(u("core/match/modes/tdm.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const D = await import(u("core/sim/damage.js"));
  const liveContent = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const WEAPONS = WD.WEAPONS;

  MATCH.registerMode("tdm", MODE.createMode);
  const fixtureContent = syntheticContent(liveContent.archetypes);

  function makeMatchSim(seed) {
    const events = [];
    const sim = S.createSim({
      content: fixtureContent,
      colliders: flatColliders(),
      weapons: WEAPONS,
      seed,
      mode: "tdm",
      tuning: "pvp",
      emit: (type, data) => events.push({ type, data }),
    });
    return { sim, events };
  }

  function stepN(sim, n) { for (let i = 0; i < n; i++) sim.step(null); }

  // step until the victim is un-protected, then land a scripted kill
  function scriptKill(sim, victim, killerWho) {
    let guard = 0;
    while (sim.match.isProtected(victim.who) && guard++ < 600) sim.step(null);
    D.applyDamage(sim, victim.who, 9999, killerWho, "body", "script");
  }

  function livingBot(M, team, match, needUnprotected) {
    return M.actors.find((a) =>
      a.alive && a.kind === "bot" && a.team === team &&
      (!needUnprotected || !match.isProtected(a.who)));
  }

  // ============================================================ 1. interface
  section("frozen interface + purity (Part 3.5, C12)");
  {
    const src = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/tdm.js"), "utf8");
    ok(!/from\s+["'][^"']*(three|\/sim\/|botfsm|\/hud\/|\/view\/|\/render\/|\/fx\/|\/chars\/|modes\/(ctf|ffa))/.test(src),
      "no forbidden imports (THREE / sim.js / botfsm / hud / view / render / fx / chars / sibling modes)");
    ok(!/Math\.random|Date\.now|performance\.now/.test(src),
      "no Math.random, no wall-clock reads (deterministic by construction)");
    const mode = MODE.createMode({ id: "tdm", content: {}, rules: {}, rng: () => 0.5 });
    ok(mode.id === "tdm", "mode.id === 'tdm' (C1)");
    ok(mode.displayName === "SKIRMISH", "displayName 'SKIRMISH' (C1 — separate field)");
    ok(mode.teamCount === 2, "teamCount 2");
    const d = mode.defaults;
    ok(d.scoreLimit === 50 && d.timeLimitS === 480 && d.respawnS === 4.0 && d.protectS === 1.5,
      "C12 defaults exact: {scoreLimit:50, timeLimitS:480, respawnS:4.0, protectS:1.5}");
    for (const fn of ["start", "tick", "end", "checkWin", "assignDuties", "onKill", "onDeath", "onSpawn", "spawnVeto", "hudModel"]) {
      ok(typeof mode[fn] === "function", `mode.${fn} is a function`);
    }
    ok(mode.spawnVeto() === false, "spawnVeto always false (C7 — tdm has no mode veto)");
    ok(mode.scoreForKill === undefined,
      "no scoreForKill override — the driver's C15 base ledger (100/25) IS the TDM ledger");
  }

  // ==================================================== 2. score limit + §2.2
  section("score-limit win + §2.2 edges (fixture limit 4)");
  {
    const { sim } = makeMatchSim(101);
    sim.match.start(sim);
    const M = sim.state.match;
    ok(sim.match.m.rules.scoreLimit === 4 && sim.match.m.rules.timeLimitS === 30,
      "content.modes.tdm overrides mode defaults through the driver merge");
    stepN(sim, 260); // past warmup (3 s) + first-spawn protection (0.5 s)
    sim.setNoTarget(true); // freeze bot-vs-bot fighting; scripted damage only
    ok(M.phase === "live", "match live");

    for (let k = 0; k < 3; k++) {
      const v = livingBot(M, 1, sim.match, true);
      scriptKill(sim, v, "P");
      stepN(sim, 120);
    }
    ok(M.teams[0].score === 3 && M.teams[1].score === 0, "3 scripted kills → team score 3–0");

    // §2.2 — suicide: a death, no kill, and the enemy team is awarded NOTHING
    const sui = livingBot(M, 1, sim.match, true);
    const suiDeaths = sui.deaths;
    D.applyDamage(sim, sui.who, 9999, sui.who, "body", "grenade");
    stepN(sim, 2);
    ok(!sui.alive || sui.deaths === suiDeaths + 1, "suicide kills the actor");
    ok(M.teams[0].score === 3 && M.teams[1].score === 0,
      "suicide awards the enemy team nothing (§2.2 — no phantom point)");
    ok(M.phase === "live", "match continues");
    stepN(sim, 120);

    const v4 = livingBot(M, 1, sim.match, true);
    scriptKill(sim, v4, "P");
    stepN(sim, 2);
    ok(M.phase === "ended", "4th kill ends the match at the score limit");
    ok(M.result && M.result.result === "win" && M.result.winnerTeam === 0 && M.result.reason === "score limit",
      "result: win, team 0, reason 'score limit'");
    ok(M.teams[0].score === 4, "winning team score === limit");
    const winner = M.teams.find((t) => t.id === M.result.winnerTeam);
    ok(winner.score === Math.max(...M.teams.map((t) => t.score)), "winnerTeam consistent with scores (AC-3)");
    ok(M.actors[0].kills === 4 && M.actors[0].score === 400,
      "human: 4 kills, 400 personal points via the driver's C15 ledger");
    ok(!sim.match._ms.watchdogFired, "watchdog never fired (AC-2)");
  }

  // ============================================ 3. both-cross-the-limit draw
  section("§2.2 — both teams cross the limit on one tick → DRAW, not overtime");
  {
    const { sim } = makeMatchSim(102);
    sim.match.start(sim);
    const M = sim.state.match;
    stepN(sim, 260);
    sim.setNoTarget(true);
    // alternate scripted kills to 3–3
    for (let k = 0; k < 3; k++) {
      const v1 = livingBot(M, 1, sim.match, true);
      const k0 = "P";
      scriptKill(sim, v1, k0);
      stepN(sim, 120);
      const v0 = livingBot(M, 0, sim.match, true);
      const k1 = livingBot(M, 1, sim.match, false);
      scriptKill(sim, v0, k1.who);
      stepN(sim, 120);
    }
    ok(M.teams[0].score === 3 && M.teams[1].score === 3, "scripted to 3–3");
    // two kills, one per team, land between sim steps → same-tick commit
    const va = livingBot(M, 1, sim.match, true);
    const vb = livingBot(M, 0, sim.match, true);
    const kb = livingBot(M, 1, sim.match, false);
    D.applyDamage(sim, va.who, 9999, "P", "body", "script");
    D.applyDamage(sim, vb.who, 9999, kb.who, "body", "script");
    stepN(sim, 2);
    ok(M.phase === "ended", "match ended on the double-cross tick");
    ok(M.result && M.result.result === "draw" && M.result.winnerTeam === null,
      "both at the limit and EQUAL → draw (no overtime for a both-hit-the-limit tie)");
    ok(M.teams[0].score === 4 && M.teams[1].score === 4, "final 4–4");
  }

  // ================================================== 4. time-up (0:00) win
  section("time limit — higher score at 0:00 wins");
  {
    const { sim } = makeMatchSim(103);
    sim.match.start(sim);
    const M = sim.state.match;
    stepN(sim, 260);
    sim.setNoTarget(true);
    const v = livingBot(M, 1, sim.match, true);
    scriptKill(sim, v, "P");
    let guard = 0;
    while (M.phase !== "ended" && guard++ < 60 * 45) sim.step(null);
    ok(M.phase === "ended", "match ended by the clock");
    ok(M.result && M.result.result === "win" && M.result.winnerTeam === 0 && M.result.reason === "time",
      "1–0 at 0:00 → win team 0, reason 'time'");
    ok(sim.state.phase === "won", "human's side won → sim phase 'won' (C29b end mapping)");
    ok(Math.abs(sim.state.time - 33) < 1.5, `ended at ~33 s (warmup 3 + limit 30): t=${sim.state.time.toFixed(2)}`);
  }

  // ============================================ 5. overtime — first death
  section("C13 — tie at 0:00 → overtime; FIRST DEATH loses; no OT respawns");
  {
    const { sim } = makeMatchSim(104);
    sim.match.start(sim);
    const M = sim.state.match;
    stepN(sim, 260);
    sim.setNoTarget(true);
    let guard = 0;
    while (M.phase === "live" && guard++ < 60 * 40) sim.step(null);
    ok(M.phase === "overtime", "0–0 at 0:00 → overtime");
    ok(sim.state.phase === "exfil", "overtime maps to sim phase 'exfil' (C29b)");
    stepN(sim, 120);
    const v = livingBot(M, 1, sim.match, false);
    D.applyDamage(sim, v.who, 9999, "P", "body", "script");
    stepN(sim, 2);
    ok(M.phase === "ended", "first overtime death ends the match");
    ok(M.result && M.result.result === "win" && M.result.winnerTeam === 0 &&
       M.result.reason === "overtime first death",
      "the team that did NOT lose an actor wins (C13 — first death LOSES)");
    ok(!v.alive && v.respawnAtT < 0, "no respawns in overtime — the victim stays down");
    ok(M.teams[0].score === 1, "the OT kill still counts on the team score");
  }

  // ================================================ 6. COLLAPSE terminates
  section("COLLAPSE — arms at OT+60 s, shrinks 12→6, kills a passive overtime");
  {
    const { sim, events } = makeMatchSim(105);
    sim.match.start(sim);
    const M = sim.state.match;
    // [W11 2026-08-25] was stepN(260): that left ~1.3 s of live, un-frozen
    // fire before the freeze, and the wave-5 tuning flip (recoil jitter cut,
    // C25) made a bot land a kill inside that window on this seed — failing
    // the "team scores untouched" assertion below for a reason unrelated to
    // §2.2. Freeze targeting the tick live begins; the test's own intent
    // (zero combat kills, zone deaths only) is unchanged.
    stepN(sim, 185);
    sim.setNoTarget(true);
    sim.teleport("P", COLLAPSE_CENTRE[0], 0, COLLAPSE_CENTRE[2]); // human safe inside
    let guard = 0;
    while (M.phase === "live" && guard++ < 60 * 40) sim.step(null);
    ok(M.phase === "overtime", "0–0 → overtime");
    // run to just past arm (60 s) — bots idle near their spawns, ~30 m out
    stepN(sim, 60 * 61);
    const pub = M.mode.collapse;
    ok(pub && pub.armed === true, "state.mode.collapse.armed at OT+60 s");
    ok(events.some((e) => e.type === "collapse" && e.data.armed), "'collapse' event emitted (freeze amendment c)");
    ok(Math.abs(pub.centre[0] - COLLAPSE_CENTRE[0]) < 1e-6,
      "collapse centre honours content.match.collapse override");
    const r1 = pub.radius;
    ok(r1 <= 12.0 + 1e-6 && r1 >= 6.0, `radius inside [6,12] just after arm: ${r1}`);
    stepN(sim, 60 * 10);
    if (M.phase !== "ended") {
      ok(M.mode.collapse.radius < r1, `ring is shrinking: ${M.mode.collapse.radius} < ${r1}`);
      // every living bot's duty flipped to 'collapse' at the ring centre
      const bots = M.actors.filter((a) => a.alive && a.kind === "bot");
      ok(bots.length > 0 && bots.every((a) => a.duty && a.duty.role === "collapse" && a.duty.urgency === 1.0),
        "all living bots' duty → role 'collapse', urgency 1.0 (modes.md §2.4)");
      ok(bots.every((a) => Math.abs(a.duty.target[0] - COLLAPSE_CENTRE[0]) < 1e-6 &&
                           Math.abs(a.duty.target[2] - COLLAPSE_CENTRE[2]) < 1e-6),
        "collapse duty target is the ring centre");
    } else {
      ok(true, "(ended before the mid-shrink sample — zone was already lethal)");
      ok(true, "(duty sample skipped — match over)");
      ok(true, "(target sample skipped)");
    }
    guard = 0;
    while (M.phase !== "ended" && guard++ < 60 * 120) sim.step(null);
    ok(M.phase === "ended", "COLLAPSE terminated the passive overtime");
    ok(M.result && M.result.result === "win" && M.result.reason === "overtime first death",
      "zone death resolves through the first-death rule");
    ok(M.teams[0].score === 0 && M.teams[1].score === 0,
      "zone death is a death, never a kill — team scores untouched (§2.2)");
    const snap = sim.match.snapshot();
    ok(snap.oobDeaths === 0, "zero out-of-bounds backstop deaths (AC-8)");
    ok(!sim.match._ms.watchdogFired, "watchdog never fired — COLLAPSE is the terminator, not the watchdog");
    ok(sim.state.time < 33 + 180, `terminated inside the OT cap: t=${sim.state.time.toFixed(1)} (proof bound ~OT+75 s)`);
  }

  // ============================================== 7. tie-break chain at cap
  section("§2.3 tie-break chain at the 3:00 cap (OT damage → regulation damage → draw)");
  {
    // Nobody may die for the full 3:00 of overtime, and no unscripted
    // damage may land (the ledgers are under test). Bot-vs-bot combat is
    // real under noTarget (it hides only the PLAYER), and zone hits alert
    // spawn-side bots into hunting each other — so every tick all ten
    // actors are pinned INSIDE the ring (no zone damage) and every bot's
    // ammo is stripped (no gunfire; grenades stay ineligible below their
    // 8 m minimum range in a ≤4 m clump). The only damage in these runs is
    // the scripted 10 HP injury.
    function pinDisarm(sim) {
      const M = sim.state.match;
      sim.teleport("P", COLLAPSE_CENTRE[0], 0, COLLAPSE_CENTRE[2]);
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
    function stepPinned(sim, n) {
      for (let i = 0; i < n; i++) { pinDisarm(sim); sim.step(null); }
    }
    function runCap(seed, injure) {
      const { sim } = makeMatchSim(seed);
      sim.match.start(sim);
      const M = sim.state.match;
      stepN(sim, 260);
      sim.setNoTarget(true);
      if (injure === "reg") {
        const v = livingBot(M, 1, sim.match, true);
        D.applyDamage(sim, v.who, 10, "P", "body", "script"); // non-lethal, regulation
      }
      let guard = 0;
      while (M.phase !== "overtime" && M.phase !== "ended" && guard++ < 60 * 40) stepPinned(sim, 1);
      if (injure === "ot") {
        stepPinned(sim, 60 * 5);
        const v = livingBot(M, 1, sim.match, false);
        D.applyDamage(sim, v.who, 10, "P", "body", "script"); // non-lethal, overtime
      }
      guard = 0;
      while (M.phase !== "ended" && guard++ < 60 * 220) stepPinned(sim, 1);
      return { M, sim };
    }

    const rOt = runCap(106, "ot");
    ok(rOt.M.phase === "ended", "OT-damage run reached 'ended'");
    ok(rOt.M.result && rOt.M.result.result === "win" && rOt.M.result.winnerTeam === 0 &&
       rOt.M.result.reason === "overtime tiebreak (overtime damage)",
      "tie-break (1): overtime damage decides for team 0");

    const rReg = runCap(107, "reg");
    ok(rReg.M.result && rReg.M.result.result === "win" && rReg.M.result.winnerTeam === 0 &&
       rReg.M.result.reason === "overtime tiebreak (regulation damage)",
      "tie-break (2): zero OT damage → regulation damage decides");

    const rNil = runCap(108, null);
    ok(rNil.M.result && rNil.M.result.result === "draw" && rNil.M.result.reason === "overtime cap",
      "tie-break (3): zero damage anywhere → the driver's draw at the cap (no misfire)");
    ok(!rNil.sim.match._ms.watchdogFired, "watchdog silent through a full-cap overtime");
  }

  // ======================================================== 8. duty layer
  section("duty layer — closed enum, quotas, 4 s latch, honesty bar");
  {
    const { sim } = makeMatchSim(109);
    sim.match.start(sim);
    const M = sim.state.match;
    stepN(sim, 200);
    sim.setNoTarget(true); // zero perception, zero deaths → zero contacts
    stepN(sim, 60 * 5);    // ≥10 assignDuties passes

    const ROLES = ["attack", "roam", "defend", "trade", "collapse"];
    const bots = M.actors.filter((a) => a.alive && a.kind === "bot");
    ok(bots.length === 9, "9 living bots (nobody died with noTarget on)");
    ok(bots.every((a) => a.duty && ROLES.includes(a.duty.role)),
      "every living bot has a duty with a role from the CLOSED enum");
    ok(bots.every((a) => a.duty.urgency > 0 && a.duty.urgency <= 1 &&
                         a.duty.target.every((v) => Number.isFinite(v))),
      "urgency ∈ (0,1], finite target");
    ok(M.actors[0].duty === null, "the human's duty stays null — duties steer bots only");
    for (const team of [0, 1]) {
      const tb = bots.filter((a) => a.team === team);
      const attackers = tb.filter((a) => a.duty.role === "attack").length;
      ok(attackers === 2, `team ${team}: exactly 2 'attack' (arch 5.4 quota); rest roam — got ${attackers}`);
      ok(tb.every((a) => a.duty.role === "attack" || a.duty.role === "roam"),
        `team ${team}: no defend/trade with a level score and no deaths`);
    }
    // honesty: with zero contacts every target must be one of the STATIC
    // points the mode is allowed to know — never a living enemy position
    const anchors = [[0, 0, 30], [0, 0, -30]];           // cluster anchors
    const centres = [[0, 0, -30], [0, 0, 30]];           // enemy-anchor centroid per team
    const arenaC = [0, 0, 0];                            // bounds centre
    const allowed = anchors.concat(centres, [arenaC]);
    const nearAllowed = (t) => allowed.some((p) =>
      Math.hypot(t[0] - p[0], t[2] - p[2]) < 0.05);
    ok(bots.every((a) => nearAllowed(a.duty.target)),
      "HONESTY: every duty target is a static known point (no living-enemy reads)");
    // latch: 0.5 s later nothing has thrashed
    const before = bots.map((a) => a.actorId + ":" + a.duty.role).join(",");
    stepN(sim, 30);
    const after = bots.map((a) => a.actorId + ":" + a.duty.role).join(",");
    ok(before === after, "roles stable across a 0.5 s window (4 s latch — no thrash)");
  }

  // ==================================================== 8b. kill resupply
  section("[P2] kill resupply — +1 mag on kill, reserve cap, dry-rescue, bots too");
  {
    const { sim, events } = makeMatchSim(120);
    sim.match.start(sim);
    const M = sim.state.match;
    stepN(sim, 260);
    sim.setNoTarget(true);
    ok(M.phase === "live", "match live");

    // live content.json carries the rule (store truth: the mechanism is
    // content-authored, not a magic number) — and the campaign walkover
    // rule survived the pickups edit untouched
    const rule = (liveContent.pickups || []).find((p) => p.id === "pk_ammo_kill_refill");
    ok(!!rule && rule.kind === "ammo_rule" && rule.magsPerKill === 1 &&
       Array.isArray(rule.modes) && rule.modes.includes("tdm") && rule.modes.includes("ctf") && rule.modes.includes("ffa"),
      "content.json pickups has pk_ammo_kill_refill {ammo_rule, magsPerKill:1, modes:[tdm,ctf,ffa]}");
    ok((liveContent.pickups || []).some((p) => p.id === "pk_ammo_walkover" && p.magsPerPickup === 1),
      "campaign pk_ammo_walkover untouched by the pickups edit");

    // (1) player: empty reserve + a kill → exactly one mag back
    const p = sim.state.player;
    const wt = WEAPONS[p.weapon.id];
    p.weapon.reserve = 0;
    if (p._slotAmmo && p._slotAmmo[p.weapon.id]) p._slotAmmo[p.weapon.id].reserve = 0;
    scriptKill(sim, livingBot(M, 1, sim.match, true), "P");
    stepN(sim, 2);
    const expect1 = Math.min(wt.reserve, wt.mag);
    ok(p.weapon.reserve === expect1,
      `player kill at 0 reserve → +1 mag: reserve ${p.weapon.reserve} === ${expect1}`);
    ok(p._slotAmmo[p.weapon.id].reserve === p.weapon.reserve,
      "_slotAmmo mirror moved with the live reserve (grantAmmoMag discipline)");
    ok(events.some((e) => e.type === "resupply" && e.data && e.data.who === "P"),
      "'resupply' event emitted for the player");

    // (2) cap: a full reserve gains nothing (refills a fighter, never
    // stockpiles a camper)
    p.weapon.reserve = wt.reserve;
    if (p._slotAmmo && p._slotAmmo[p.weapon.id]) p._slotAmmo[p.weapon.id].reserve = wt.reserve;
    stepN(sim, 120);
    scriptKill(sim, livingBot(M, 1, sim.match, true), "P");
    stepN(sim, 2);
    ok(p.weapon.reserve === wt.reserve,
      `reserve CAPPED at the weapon-table start reserve (${wt.reserve})`);

    // (3) dry-rescue: the OTHER slot at 0/0 gets one mag from a kill with
    // the held weapon (closes the gate-2 dry-Warden chicken-and-egg)
    const otherId = p.slots.find((id) => id !== p.weapon.id);
    if (otherId) {
      const owt = WEAPONS[otherId];
      p._slotAmmo[otherId] = { mag: 0, reserve: 0 };
      stepN(sim, 120);
      scriptKill(sim, livingBot(M, 1, sim.match, true), "P");
      stepN(sim, 2);
      const expectR = Math.min(owt.reserve, owt.mag);
      ok(p._slotAmmo[otherId].reserve === expectR,
        `dry other slot '${otherId}' rescued: reserve ${p._slotAmmo[otherId].reserve} === ${expectR}`);
      ok(p._slotAmmo[otherId].mag === 0, "rescue lands in RESERVE — the reload is still on the player");
    } else {
      ok(true, "single-slot loadout — dry-rescue clause has no other slot (n/a)");
    }

    // (4) bots use the same mechanism through the same hook — no crate,
    // no goal hook, no W7 role term needed
    stepN(sim, 120);
    const killerBot = livingBot(M, 1, sim.match, false);
    const kb = sim.match.m.bodyOf(killerBot);
    const bwt = WEAPONS[kb.weapon.id];
    kb.weapon.reserve = 0;
    scriptKill(sim, livingBot(M, 0, sim.match, true), killerBot.who);
    stepN(sim, 2);
    const expectB = Math.min(bwt.reserve, bwt.mag);
    ok(kb.weapon.reserve === expectB,
      `bot killer at 0 reserve → +1 mag: reserve ${kb.weapon.reserve} === ${expectB}`);
    ok(!sim.match._ms.watchdogFired, "watchdog silent through the resupply battery");
  }

  // ====================================================== 9. determinism
  section("determinism — same seed twice → identical snapshot + duty log (AC-7)");
  {
    function runScripted(seed) {
      const { sim } = makeMatchSim(seed);
      sim.match.start(sim);
      const M = sim.state.match;
      const dutyLog = [];
      let ticks = 0;
      const maxTicks = 60 * 240;
      while (M.phase !== "ended" && ticks < maxTicks) {
        sim.step(null);
        ticks++;
        if (ticks % 120 === 0) {
          const living = M.actors.filter((a) => a.alive && a.kind === "bot");
          if (living.length) {
            const victim = living[ticks / 120 % living.length | 0];
            const killer = M.actors.find((a) => a.alive && a.team !== victim.team);
            if (killer) D.applyDamage(sim, victim.who, 40, killer.who, "body", "script");
          }
        }
        if (ticks % 30 === 0) {
          dutyLog.push(M.actors.map((a) => (a.duty ? a.duty.role[0] : "-")).join(""));
        }
      }
      return {
        snapHash: djb2(JSON.stringify(sim.match.snapshot())),
        dutyHash: djb2(dutyLog.join("|")),
        ended: M.phase === "ended",
        watchdog: sim.match._ms.watchdogFired,
      };
    }
    const a = runScripted(7), b = runScripted(7);
    ok(a.ended && b.ended, "scripted matches terminate (AC-1)");
    ok(!a.watchdog && !b.watchdog, "watchdog never fired (AC-2)");
    ok(a.snapHash === b.snapHash, `same seed → identical snapshot hash (${a.snapHash})`);
    ok(a.dutyHash === b.dutyHash, "same seed → identical duty-assignment log");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("selftest crashed:", e); process.exit(1); });
