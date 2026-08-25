#!/usr/bin/env node
/* core/match/match.selftest.cjs [W1] — match core + sim seam battery
 * (PVP_BUILD_PLAN Part 4.1 row W1; the wave-1 gate).
 *
 * Run:  node core/match/match.selftest.cjs --contract   → contract gate +
 *         frozen-surface + seam assertions (W4 also runs this against its
 *         content.json — the live-content half arms automatically the moment
 *         the PVP blocks land; until then it reports PENDING, not PASS).
 *       node core/match/match.selftest.cjs --seeds 20   → N seeded headless
 *         matches: termination (AC-1), watchdog never fires (AC-2), result
 *         consistency (AC-3), snapshot determinism (AC-7), roster identity
 *         survives death, respawn-by-new-botId.
 *       no args → both (--seeds defaults to 6 for the quick loop).
 *
 * HONESTY NOTES:
 * - Mode modules are OTHER lanes (W5/W8/W9). When core/match/modes/<id>.js
 *   exists it is used; otherwise a minimal REFERENCE mode implementing the
 *   frozen Part 3.5 interface is registered in-process so the DRIVER is
 *   testable now. The reference mode lives in this file only — it never
 *   ships and never lands in W5's files.
 * - CTF flag machinery is W8; --seeds exercises tdm + ffa only until it lands.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const HERE = __dirname;
const GAME_DIR = path.resolve(HERE, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0, skipped = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function skip(msg) { skipped++; console.log("  SKIP  " + msg); }
function section(name) { console.log("\n== " + name + " =="); }
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ---------------------------------------------------------------- fixtures
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
  // A schema-complete PVP fixture (C19): 44 points across 2 clusters,
  // 9-slot roster, all three mode blocks, one flag per team.
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
      // short clocks so seeded matches terminate fast; the driver's phase
      // machine and watchdog are what is under test, not the C12 numbers
      tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ffa: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
    },
    archetypes: realArchetypes,
    pickups: [],
    scenarios: {},
  };
}

// Minimal REFERENCE modes (frozen Part 3.5 interface) — driver test only.
function refTdm() {
  return {
    id: "tdm", displayName: "SKIRMISH", teamCount: 2,
    defaults: { scoreLimit: 50, timeLimitS: 480, respawnS: 4.0, protectS: 1.5 },
    state: null,
    start(m) { m.state.mode.refmode = true; },
    tick() {},
    end() {},
    onKill(m, ev) { m.addTeamScore(ev.attacker.team, 1, "kill"); },
    checkWin(m) {
      const [a, b] = m.state.teams;
      const lim = m.rules.scoreLimit;
      if (a.score >= lim || b.score >= lim) {
        return { result: "win", winnerTeam: a.score >= lim ? a.id : b.id, reason: "score limit" };
      }
      if (m.phase === "live" && m.timeLeft <= 0 && a.score !== b.score) {
        return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "time" };
      }
      if (m.phase === "overtime" && a.score !== b.score) {
        return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "overtime" };
      }
      return null;
    },
    hudModel(m) {
      return { headline: "ELIMINATE", clockS: m.timeLeft, us: 0, them: 0,
        objectives: [{ id: "dm_score", label: `ELIMINATE — ${m.rules.scoreLimit}`, state: "active" }],
        markers: [] };
    },
  };
}

function refFfa() {
  return {
    id: "ffa", displayName: "FREE-FOR-ALL", teamCount: "perActor",
    defaults: { scoreLimit: 25, timeLimitS: 480, respawnS: 3.0, protectS: 2.0 },
    start() {}, tick() {}, end() {},
    onKill(m, ev) { m.addTeamScore(ev.attacker.team, 1, "kill"); },
    checkWin(m) {
      let best = null, second = null;
      for (const t of m.state.teams) {
        if (!best || t.score > best.score) { second = best; best = t; }
        else if (!second || t.score > second.score) second = t;
      }
      if (best && best.score >= m.rules.scoreLimit) {
        return { result: "win", winnerTeam: best.id, reason: "score limit" };
      }
      const past = (m.phase === "live" && m.timeLeft <= 0) || m.phase === "overtime";
      if (past && best && second && best.score !== second.score) {
        return { result: "win", winnerTeam: best.id, reason: "time" };
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const argv = process.argv.slice(2);
  const contractOnly = argv.includes("--contract");
  const seedsIx = argv.indexOf("--seeds");
  const seedsOnly = seedsIx >= 0;
  const seedCount = seedsOnly ? parseInt(argv[seedsIx + 1] || "20", 10) : 6;

  const RNG = await import(u("core/rng.js"));
  const TUN = await import(u("core/pvp/pvp_tuning.js"));
  const ROSTER = await import(u("core/match/roster.js"));
  const CONTRACT = await import(u("core/match/contract.js"));
  const MATCH = await import(u("core/match/match.js"));
  const S = await import(u("core/sim/sim.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const liveContent = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const WEAPONS = WD.WEAPONS;

  // register modes: real module if landed, reference otherwise
  const modeSource = {};
  for (const [id, ref] of [["tdm", refTdm], ["ffa", refFfa]]) {
    const p = path.join(GAME_DIR, `core/match/modes/${id}.js`);
    if (fs.existsSync(p)) {
      const mod = await import(u(`core/match/modes/${id}.js`));
      MATCH.registerMode(id, mod.createMode);
      modeSource[id] = "real";
    } else {
      MATCH.registerMode(id, () => ref());
      modeSource[id] = "reference";
    }
  }
  {
    const p = path.join(GAME_DIR, "core/match/modes/ctf.js");
    if (fs.existsSync(p)) {
      const mod = await import(u("core/match/modes/ctf.js"));
      MATCH.registerMode("ctf", mod.createMode);
      modeSource.ctf = "real";
    } else {
      // CTF's flag machinery is W8's — placeholder keeps the registry's
      // both-direction check meaningful; --seeds never starts it.
      MATCH.registerMode("ctf", () => { const r = refTdm(); r.id = "ctf"; return r; });
      modeSource.ctf = "reference(placeholder)";
    }
  }
  console.log("mode sources:", JSON.stringify(modeSource));

  const fixtureContent = syntheticContent(liveContent.archetypes);

  function makeMatchSim(mode, seed, extra = {}) {
    const events = [];
    const sim = S.createSim({
      content: fixtureContent,
      colliders: flatColliders(),
      weapons: WEAPONS,
      seed,
      mode,
      tuning: "pvp",
      matchOpts: extra.matchOpts || {},
      emit: (type, data) => events.push({ type, data }),
    });
    return { sim, events };
  }

  // ================================================================ contract
  if (!seedsOnly) {
    section("rng streams (C26 / freeze amendment f)");
    {
      const a = RNG.makeStreams(7);
      const b = RNG.makeStreams(7);
      for (const k of ["spread", "ai", "mission", "fx", "match", "spawn", "obj"]) {
        ok(typeof a[k] === "function", `stream '${k}' exists`);
      }
      ok(a.match() === b.match() && a.spawn() === b.spawn() && a.obj() === b.obj(),
        "new streams are deterministic per seed");
      const c = RNG.makeStreams(7);
      const preSpread = RNG.makeStreams(7).spread();
      for (let i = 0; i < 50; i++) c.match();
      ok(c.spread() === preSpread, "consuming rng.match never advances rng.spread (fixed-offset independence)");
    }

    section("pvp_tuning — wave-5 delta set LIVE (C25/W11)");
    {
      const sp = TUN.getTuning("sp"), pvp = TUN.getTuning("pvp");
      ok(sp.maxHp === 100 && sp.regenDelayS === 4.5 && sp.regenPerS === 35,
        "sp table matches the pre-PVP constants (100 HP / 4.5 s / 35 HP/s)");
      ok(pvp.maxHp === 110 && pvp.regenDelayS === 5.0 && pvp.regenPerS === 28 &&
         pvp.steadyMult === 1.0,
        "pvp table carries the C25 deltas (110 HP / 5.0 s / 28 HP/s / steadyMult 1.0)");
      ok(sp.weaponDeltas && Object.keys(sp.weaponDeltas).length === 0 &&
         Object.keys(pvp.weaponDeltas).length === 4,
        "sp has NO weapon deltas; pvp overrides all four weapons (§4.3 B2/B3)");
    }

    section("areEnemies — the one truth (Part 3.4)");
    {
      const E = ROSTER.areEnemies;
      const a0 = { team: 0 }, a1 = { team: 1 }, a0b = { team: 0 };
      ok(E(a0, a1) === true, "different teams → enemies");
      ok(E(a0, a0b) === false, "same team → not enemies");
      ok(E(a0, a0) === false, "self → not enemy");
      ok(E(null, a1) === false && E(a0, null) === false, "null-safe");
      const ffa = Array.from({ length: 10 }, (_, i) => ({ team: i }));
      let allHostile = true;
      for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
        if (i !== j && !E(ffa[i], ffa[j])) allHostile = false;
      }
      ok(allHostile, "FFA = ten teams of one: every distinct pair hostile, zero mode branches");
    }

    section("roster (Part 3.3, C2, C11, C21, C29d)");
    {
      const r = ROSTER.makeRoster(fixtureContent, { teamCount: 2, rng: RNG.makeStreams(5).match, difficulty: "standard" });
      ok(r.actors.length === 10, "10 actors");
      ok(r.actors[0].kind === "human" && r.actors[0].team === 0 && r.actors[0].who === "P",
        "human is actorId 0, team 0 (AMBER), who 'P'");
      ok(r.teams.length === 2 && r.teams[0].name === "AMBER" && r.teams[1].name === "SLATE",
        "teams are AMBER/SLATE (C2 — VEKTOR retired)");
      ok(r.teams[0].tint === "#d9a441" && r.teams[1].tint === "#7c9fd0", "C2 tints");
      ok(r.actors.slice(1, 5).every((a) => a.team === 0) && r.actors.slice(5).every((a) => a.team === 1),
        "actors 1–4 team 0, 5–9 team 1");
      const bands = r.actors.slice(1).map((a) => a.band);
      ok(bands.every((b) => ["recruit", "regular", "hardened"].includes(b)),
        "STANDARD preset: no veteran (bands: " + bands.join(",") + ")");
      const r2 = ROSTER.makeRoster(fixtureContent, { teamCount: 2, rng: RNG.makeStreams(5).match, difficulty: "standard" });
      ok(JSON.stringify(r.actors.map((a) => a.name)) === JSON.stringify(r2.actors.map((a) => a.name)),
        "same seed → identical callsign draw (deterministic lobby)");
      const names = new Set(r.actors.slice(1).map((a) => a.name));
      ok(names.size === 9 && [...names].every((n) => ROSTER.CALLSIGNS.includes(n)),
        "9 distinct callsigns from the modes.md 12-name pool");
      const f = ROSTER.makeRoster(fixtureContent, { teamCount: "perActor", rng: RNG.makeStreams(5).match });
      ok(f.actors.every((a) => a.team === a.actorId), "FFA: team === actorId for all ten");
      ok(f.teams.length === 10, "FFA: teams array is 10 × 1");
      ok(f.squadIdOf(3) === "ffa_3" && f.squadIdOf(0) === null, "FFA squad ids ffa_<actorId> (C21)");
      const sq = new Set(r.actors.slice(1).map((a) => r.squadIdOf(a.actorId)));
      ok([...sq].every((s) => /^t[01]_[ab]$/.test(s)), "team-mode squad ids t{0,1}_{a,b} (C21): " + [...sq].join(","));
      const hard = ROSTER.makeRoster(fixtureContent, { teamCount: 2, rng: RNG.makeStreams(5).match, difficulty: "hard" });
      ok(!hard.actors.some((a) => a.band === "veteran"), "HARD without opt-in: veteran slot falls back to hardened");
      const hardV = ROSTER.makeRoster(fixtureContent, { teamCount: 2, rng: RNG.makeStreams(5).match, difficulty: "hard", veteran: true });
      ok(hardV.actors.filter((a) => a.band === "veteran").length === 1,
        "HARD with veteran:true: exactly ONE veteran (C11 cap)");
    }

    section("contract gate (C19) — synthetic fixture + negative controls");
    {
      const V = CONTRACT.validateMatchContent;
      const good = V(fixtureContent, { modeIds: MATCH.MODE_IDS });
      ok(good.ok && !good.pending, "known-good fixture passes" + (good.ok ? "" : ": " + good.errors.join("; ")));

      const dup = JSON.parse(JSON.stringify(fixtureContent));
      dup.spawnPoints[1].id = dup.spawnPoints[0].id;
      ok(!V(dup, { modeIds: MATCH.MODE_IDS }).ok, "rejects duplicate spawn point id");

      const badCl = JSON.parse(JSON.stringify(fixtureContent));
      badCl.spawnPoints[0].cluster = "SC_NOPE";
      ok(!V(badCl, { modeIds: MATCH.MODE_IDS }).ok, "rejects unknown cluster ref");

      const few = JSON.parse(JSON.stringify(fixtureContent));
      few.spawnPoints = few.spawnPoints.filter((p, i) => !(p.cluster === "SC_A" && i > 4));
      ok(!V(few, { modeIds: MATCH.MODE_IDS }).ok, "rejects a cluster under 6 eligible points per mode (C7b class)");

      const modeOnly = JSON.parse(JSON.stringify(fixtureContent));
      for (const p of modeOnly.spawnPoints) if (p.cluster === "SC_A") p.modes = ["tdm", "ffa"];
      const r = V(modeOnly, { modeIds: MATCH.MODE_IDS });
      ok(!r.ok && r.errors.some((e) => e.includes("ctf")), "per-MODE cluster count bites (C7b): CTF loses SC_A");

      const badFlag = JSON.parse(JSON.stringify(fixtureContent));
      badFlag.flags.push({ id: "flag_x", team: 0, home: [1, 0, 1] });
      ok(!V(badFlag, { modeIds: MATCH.MODE_IDS }).ok, "rejects two flags on one team");

      const badRoster = JSON.parse(JSON.stringify(fixtureContent));
      badRoster.botRoster.pop();
      ok(!V(badRoster, { modeIds: MATCH.MODE_IDS }).ok, "rejects botRoster.length !== 9");

      const badMode = JSON.parse(JSON.stringify(fixtureContent));
      badMode.modes.foothold = {};
      ok(!V(badMode, { modeIds: MATCH.MODE_IDS }).ok, "rejects a content.modes key outside the registry (R9)");

      const noBlock = JSON.parse(JSON.stringify(fixtureContent));
      delete noBlock.modes.ffa;
      ok(!V(noBlock, { modeIds: MATCH.MODE_IDS }).ok, "rejects a registry mode with no content.modes block (R9, both directions)");

      const oob = JSON.parse(JSON.stringify(fixtureContent));
      oob.spawnPoints[0].pos = [500, 0, 0];
      ok(!V(oob, { modeIds: MATCH.MODE_IDS }).ok, "rejects a spawn point outside arena.bounds");

      const badW = JSON.parse(JSON.stringify(fixtureContent));
      badW.archetypes = JSON.parse(JSON.stringify(badW.archetypes));
      badW.archetypes.rifleman.weapon = "railgun";
      ok(!V(badW, { modeIds: MATCH.MODE_IDS, weapons: WEAPONS }).ok, "deferred half rejects an unknown weapon");
    }

    section("contract gate — live content.json");
    {
      if (CONTRACT.hasPvpContent(liveContent)) {
        const COL = await import(u("core/level/colliders.js"));
        const NAV = await import(u("core/ai/nav.js"));
        // W4 gate fix: validate against the map the content declares (arena.id),
        // not the campaign default — buildColliders(1) bakes meridian_ward.
        const colliders = COL.buildCollidersFor(
          (liveContent.arena && liveContent.arena.id) || "meridian_ward", 1);
        const nav = NAV.bakeNav(colliders, { cell: 0.75 });
        const res = CONTRACT.validateMatchContent(liveContent, {
          modeIds: MATCH.MODE_IDS, nodes: colliders.nodes, weapons: WEAPONS, nav,
        });
        ok(res.ok, "live content.json PVP blocks validate (W4's gate)" +
          (res.ok ? "" : "\n    " + res.errors.join("\n    ")));
      } else {
        skip("content.json has no PVP blocks yet (W4 concurrent) — live half PENDING, arms automatically");
      }
    }

    section("frozen match surface (Part 3.1/3.5) + sim seam");
    {
      const { sim } = makeMatchSim("tdm", 11);
      ok(sim.match === sim.mission, "sim.match === sim.mission (ONE object, two names — C29a)");
      const match = sim.match;
      for (const memb of ["start", "tick", "forfeit", "onActorDeath", "onPlayerDeath", "freeze",
        "snapshot", "setMode", "drainRadio", "drainSetPieces", "sameTeam", "isProtected", "botsFrozen"]) {
        ok(typeof match[memb] === "function" || memb === "mode", `match.${memb} exists`);
      }
      ok(match.mode && match.mode.id === "tdm", "match.mode is the live mode module");
      ok(Array.isArray(match.drainRadio()) && match.drainRadio().length === 0, "drainRadio() → [] (hud contract survives)");
      ok(Array.isArray(match.drainSetPieces()), "drainSetPieces() → []");
      ok(sim.tuning && sim.tuning.id === "pvp", "createSim({tuning:'pvp'}) resolves the seam");
      ok(sim.state.player.team === 0, "player.team mirror exists (int 0)");
      let threw = false;
      try { S.createSim({ content: fixtureContent, colliders: flatColliders(), weapons: WEAPONS, seed: 1, mode: "nope" }); }
      catch (e) { threw = true; }
      ok(threw, "unknown mode id throws at makeMatch (frozen ids tdm/ctf/ffa — C1)");
    }

    section("match start / warm-up freeze (C14) / roster binding");
    {
      const { sim, events } = makeMatchSim("tdm", 21);
      sim.match.start(sim);
      const M = sim.state.match;
      ok(M && M.modeId === "tdm" && M.phase === "warmup", "state.match block present, phase warmup");
      ok(sim.state.phase === "infil", "warmup maps to sim phase 'infil' (C29b)");
      ok(sim.flags.noTarget === true, "warm-up freeze uses the existing noTarget lever (V9) — ON in warmup");
      ok(sim.state.bots.length === 9, "9 bot bodies spawned");
      ok(M.actors.length === 10 && M.actors.every((a) => a.alive), "all 10 roster slots alive");
      ok(events.some((e) => e.type === "match:start"), "match:start emitted");
      ok(events.some((e) => e.type === "mission:start"), "frozen mission:start ALSO emitted (existing consumers unchanged)");
      ok(events.filter((e) => e.type === "respawn").length === 10, "10 respawn events (first spawns)");
      const posBefore = JSON.stringify(sim.state.bots.map((b) => [b.pos[0], b.pos[2]]));
      for (let i = 0; i < 170; i++) sim.step(null); // ~2.8 s — inside warmup
      const posAfter = JSON.stringify(sim.state.bots.map((b) => [b.pos[0], b.pos[2]]));
      ok(posBefore === posAfter, "bots do not move during warm-up (cmd zeroing between brain and locomotion)");
      ok(sim.state.counters.shotsFired === 0 && sim.internal.shotsAnyTotal === 0, "no shots during warm-up");
      for (let i = 0; i < 20; i++) sim.step(null); // cross 3.0 s
      ok(sim.state.match.phase === "live" && sim.state.phase === "assault",
        "warmup → live at 3.0 s; sim phase 'assault'");
      ok(sim.flags.noTarget === false, "noTarget released at live");
      const teams = new Set(sim.state.bots.map((b) => b.team));
      ok(teams.has(0) && teams.has(1), "bot bodies carry mirrored team ints");
    }

    section("friendly fire OFF / self-damage ON (Part 3.4) + protection");
    {
      const { sim, events } = makeMatchSim("tdm", 31);
      sim.match.start(sim);
      // into live AND past first-spawn protection (warmup 3.0 s + protectS 0.5)
      for (let i = 0; i < 260; i++) sim.step(null);
      const M = sim.state.match;
      const mate = M.actors.find((a) => a.team === 0 && a.kind === "bot" && a.alive);
      const enemy = M.actors.find((a) => a.team === 1 && a.alive);
      const mateBody = sim.state.bots.find((b) => b.id === mate.who);
      const enemyBody = sim.state.bots.find((b) => b.id === enemy.who);
      const D = await import(u("core/sim/damage.js"));
      events.length = 0;
      const hpBefore = mateBody.hp;
      D.applyDamage(sim, mate.who, 30, "P", "body", "test");
      ok(mateBody.hp === hpBefore, "teammate damage from 'P': hp unchanged");
      ok(!events.some((e) => e.type === "hurt"), "…and NO hurt emit (no free wallhack toward the ally)");
      const eHp = enemyBody.hp;
      D.applyDamage(sim, enemy.who, 30, "P", "body", "test");
      ok(enemyBody.hp === eHp - 30, "enemy damage lands in full");
      const ev = events.find((e) => e.type === "hurt" && e.data.victim === enemy.who);
      ok(ev && ev.data.victimActor === enemy.actorId && ev.data.attackerActor === 0 &&
         ev.data.victimTeam === 1 && ev.data.attackerTeam === 0,
        "hurt gains additive actor/team fields (freeze amendment d)");
      const pHp = sim.state.player.hp;
      D.applyDamage(sim, "P", 10, "P", "body", "grenade");
      ok(sim.state.player.hp === pHp - 10, "self-damage still lands at 100%");
      // protection: freshly respawned actor takes no damage
      D.applyDamage(sim, enemy.who, 999, "P", "body", "test");
      ok(!enemyBody.alive, "enemy killed for the respawn test");
      let respawned = null;
      for (let i = 0; i < 90 && !respawned; i++) {
        sim.step(null);
        if (enemy.alive) respawned = sim.state.bots.find((b) => b.id === enemy.who);
      }
      ok(!!respawned, "victim respawned within ~1.5 s (rules.respawnS 1.0)");
      ok(respawned && respawned.id !== enemyBody.id, "respawn is a NEW botId for the same actorId (Part 3.3)");
      if (respawned) {
        const rHp = respawned.hp;
        D.applyDamage(sim, enemy.who, 50, "P", "body", "test");
        ok(respawned.hp === rHp, "spawn protection blocks damage (modes.md §1.3)");
      }
      ok(enemy.deaths === 1 && M.actors[0].kills === 1, "deaths/kills attributed to ACTORS");
      sim.step(null); // commit queued score
      ok(M.actors[0].score >= 100, "kill scored ≥100 personal points via the queue (C15 base ledger)");
      ok(M.teams[0].score === 1, "team score committed via mode.onKill → addTeamScore");
    }

    section("forfeit — the real loss path (doctrine §6)");
    {
      const { sim, events } = makeMatchSim("tdm", 41);
      sim.match.start(sim);
      for (let i = 0; i < 200; i++) sim.step(null);
      sim.mission.forfeit(sim); // boot.js:pauseCtl onAbandon call shape
      ok(sim.state.match.phase === "ended", "forfeit ends the match");
      ok(sim.state.match.result && sim.state.match.result.result === "forfeit", "result 'forfeit'");
      ok(sim.state.phase === "lost", "human's side marked lost");
      const me = events.find((e) => e.type === "mission:end");
      ok(me && me.data.match && me.data.match.modeId === "tdm",
        "mission:end carries the additive match block (freeze amendment d)");
    }
  }

  // ================================================================ seeds
  if (!contractOnly) {
    section(`seeded headless matches ×${seedCount} (AC-1/2/3/7)`);
    const D = await import(u("core/sim/damage.js"));

    function runMatch(mode, seed) {
      const { sim, events } = makeMatchSim(mode, seed);
      sim.match.start(sim);
      const maxTicks = 60 * 240; // watchdog cap + slack
      let ticks = 0;
      const botIdsSeen = new Set(sim.state.bots.map((b) => b.id));
      while (sim.state.match.phase !== "ended" && ticks < maxTicks) {
        sim.step(null);
        ticks++;
        // deterministic scripted pressure so matches END even where bot-vs-bot
        // aim on a flat void is slow: every 2 s the lowest-hp living non-human
        // actor takes 40 scripted damage from the OPPOSING side's first living
        // actor (or 'P' in FFA/when none) — driver-owned pathways only.
        if (ticks % 120 === 0) {
          const M = sim.state.match;
          const living = M.actors.filter((a) => a.alive && a.kind === "bot");
          if (living.length) {
            const victim = living.reduce((v, a) => {
              const bv = sim.state.bots.find((b) => b.id === v.who);
              const ba = sim.state.bots.find((b) => b.id === a.who);
              return (ba ? ba.hp : 999) < (bv ? bv.hp : 999) ? a : v;
            });
            const killer = M.actors.find((a) => a.alive && a.team !== victim.team);
            if (killer) D.applyDamage(sim, victim.who, 40, killer.who, "body", "script");
          }
        }
      }
      const snap = sim.match.snapshot();
      return { snap, ticks, events, watchdogFired: sim.match._ms.watchdogFired };
    }

    let allEnded = true, allConsistent = true, noWatchdog = true, allDeterministic = true;
    let identityHeld = true;
    for (let s = 1; s <= seedCount; s++) {
      const mode = s % 2 === 1 ? "tdm" : "ffa";
      const r1 = runMatch(mode, s);
      const r2 = runMatch(mode, s);
      if (r1.snap.phase !== "ended") { allEnded = false; console.error(`    seed ${s} ${mode}: did not end (t=${r1.snap.time.toFixed(1)})`); }
      if (r1.watchdogFired) { noWatchdog = false; console.error(`    seed ${s} ${mode}: WATCHDOG fired`); }
      const res = r1.snap.result;
      if (!res || !["win", "draw", "forfeit"].includes(res.result)) {
        allConsistent = false; console.error(`    seed ${s} ${mode}: bad result ${JSON.stringify(res)}`);
      } else if (res.result === "win") {
        const winner = r1.snap.teams.find((t) => t.id === res.winnerTeam);
        const maxScore = Math.max(...r1.snap.teams.map((t) => t.score));
        if (!winner || winner.score !== maxScore) {
          allConsistent = false; console.error(`    seed ${s} ${mode}: winnerTeam ${res.winnerTeam} not top score`);
        }
      }
      const h1 = djb2(JSON.stringify(r1.snap)), h2 = djb2(JSON.stringify(r2.snap));
      if (h1 !== h2) { allDeterministic = false; console.error(`    seed ${s} ${mode}: snapshot hash mismatch ${h1} != ${h2}`); }
      // roster identity: 10 actors, kills+deaths bookkeeping sane
      const actors = r1.snap.actors;
      if (actors.length !== 10 || actors.some((a) => a.deaths < 0 || a.kills < 0)) identityHeld = false;
      const totKills = actors.reduce((n, a) => n + a.kills, 0);
      const totDeaths = actors.reduce((n, a) => n + a.deaths, 0);
      if (totKills > totDeaths) { identityHeld = false; console.error(`    seed ${s}: kills ${totKills} > deaths ${totDeaths}`); }
      console.log(`    seed ${s} ${mode}: ended t=${r1.snap.time.toFixed(1)} result=${res && res.result}` +
        ` winner=${res && res.winnerTeam} kills=${totKills} hash=${h1}`);
    }
    ok(allEnded, `every match reached phase 'ended' (AC-1) across ${seedCount} seeds`);
    ok(noWatchdog, "the watchdog never fired (AC-2)");
    ok(allConsistent, "result ∈ win/draw/forfeit and winnerTeam consistent with scores (AC-3)");
    ok(allDeterministic, "same (mode, seed) twice → identical snapshot hash (AC-7)");
    ok(identityHeld, "roster identity survives death: 10 actors, coherent kill/death ledgers");
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("selftest crashed:", e); process.exit(1); });
