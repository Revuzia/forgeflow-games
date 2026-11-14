#!/usr/bin/env node
/* core/match/modes/ladder.selftest.cjs [lane modes] — MODE: ASCENT battery.
 *
 * Run: node core/match/modes/ladder.selftest.cjs   → exit 0 on green.
 *  1. interface + purity + registry (borrowed ffa set, perActor, forcedLoadout)
 *     + the rung table (5 weapons, 3 attachment variants, + the KNIFE rung
 *     when the melee verb is present — it is in this tree)
 *  2. rules on a mock facade: every kill promotes and re-arms on the spot;
 *     the kill on the last rung finishes; a knife kill demotes the victim
 *     (never below rung 1); team score == rungs climbed; respawn re-arms
 *  3. win + overtime: finish / horn highest rung / fewer deaths / tie →
 *     overtime: first tied-leader kill / elimination / last leader / cap draw
 *  4. sim hook: setLadderWeapon (one slot, full ammo, attachments in the
 *     effective table, no lethal / tactical / perks; knife rung = empty gun),
 *     forcedLoadout switches off class kits, loot and call-ins
 *  5. AI role unit: a knife-rung bot with a fresh percept closes (LADDER_CLOSE)
 *  6. REAL driver + sim + spawn director + bot AI (flat fixture): terminates
 *     on "ladder complete", every living body holds its rung's weapon, the
 *     knife rung stays empty through the trickle window, no loot, no call-in
 *     earned, watchdog / OOB silent
 *  7. determinism
 */
"use strict";
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
let passed = 0, failed = 0;
function ok(c, msg) { if (c) { passed++; console.log("  PASS  " + msg); } else { failed++; console.error("  FAIL  " + msg); } }
function section(n) { console.log("\n== " + n + " =="); }
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
const DT = 1 / 60;

function flatColliders() {
  return { boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {}, bounds: { min: [-80, -5, -80], max: [80, 30, 80] } };
}
function fixture(arch, rules, extra) {
  const spawnPoints = [];
  const ring = (cluster, cx, cz) => { for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; spawnPoints.push({ id: `${cluster.toLowerCase()}_${i}`, cluster, pos: [cx + Math.cos(a) * 6, 0, cz + Math.sin(a) * 6], yaw: 0, cover: 0.5, modes: ["tdm", "ctf", "ffa"] }); } };
  ring("SC_A", -20, 20); ring("SC_B", 20, -20); ring("SC_C", 20, 20); ring("SC_D", -20, -20); ring("SC_E", 0, 0);
  return Object.assign({
    version: 2, arena: { id: "flat_fixture", bounds: { min: [-79, -2, -79], max: [79, 20, 79] }, outOfBounds: { graceS: 5 } },
    teams: [{ id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a", side: "west" }, { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b", side: "east" }],
    botRoster: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => ({ slot: s, archetype: ["cqb", "rifleman", "rifleman", "marksman"][s % 4] })),
    clusters: { SC_A: { anchor: [-20, 0, 20], side: "west" }, SC_B: { anchor: [20, 0, -20], side: "east" }, SC_C: { anchor: [20, 0, 20], side: "mid" }, SC_D: { anchor: [-20, 0, -20], side: "mid" }, SC_E: { anchor: [0, 0, 0], side: "mid" } },
    spawnPoints,
    flags: [{ id: "flag_amber", team: 0, home: [-30, 0, 30], standR: 1.2, standH: 2.5 }, { id: "flag_slate", team: 1, home: [30, 0, -30], standR: 1.2, standH: 2.5 }],
    modes: { tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ffa: { scoreLimit: 4, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ladder: rules || {} },
    archetypes: arch, pickups: [], scenarios: {},
  }, extra || {});
}
function mock(MODE, WEAPONS) {
  const actors = [];
  for (let i = 0; i < 10; i++) actors.push({ actorId: i, team: i, who: i === 0 ? "P" : "b" + i, kind: i === 0 ? "human" : "bot", alive: true, score: 0, kills: 0, deaths: 0, assists: 0, name: "OP" + i });
  const bodies = actors.map(() => ({ weapon: { id: null }, armed: [] }));
  const events = [];
  const sim = { setLadderWeapon: (b, id, att, knife) => { b.weapon.id = id; b.armed.push([id, (att || []).join("+"), !!knife]); return true; } };
  const teams = actors.map((a) => ({ id: a.actorId, score: 0 }));
  const m = {
    time: 0, phase: "live", timeLeft: 300, rules: { timeLimitS: 480 }, weapons: WEAPONS, sim,
    state: { teams, mode: {} }, actors, bodyOf: (a) => bodies[a.actorId],
    emit: (type, data) => events.push({ type, data }), addScore: () => {}, addTeamScore: (t, p) => { teams[t].score += p; },
  };
  const mode = MODE.createMode({ content: {} });
  mode.start(m);
  const kill = (a, v, weaponId) => { actors[a].kills++; actors[v].deaths++; mode.onKill(m, { attacker: actors[a], victim: actors[v], weaponId: weaponId || "warden", assists: [], t: m.time }); mode.onDeath(m, { actor: actors[v], t: m.time }); };
  return { m, mode, actors, bodies, events, kill, st: mode._st };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const CONTRACT = await import(u("core/match/contract.js"));
  const MODE = await import(u("core/match/modes/ladder.js"));
  const ROLES = await import(u("core/ai/roles/ladder.js"));
  const OBJ = await import(u("core/ai/objective.js"));
  const SP = await import(u("core/match/spawns.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const live = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const W = WD.WEAPONS;

  section("interface + purity + registry + rungs");
  {
    const mode = MODE.createMode({ content: {} });
    ok(mode.id === "ladder" && mode.displayName === "ASCENT" && mode.teamCount === "perActor" && mode.forcedLoadout === true, "id 'ladder', ASCENT, ten teams of one, forcedLoadout");
    const src = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/ladder.js"), "utf8");
    ok(!src.includes("THREE.") && !src.includes("Math.random") && !src.includes("Date.now"), "THREE-free, no wall clock / unseeded rng");
    ok(MATCH.MODE_IDS.includes("ladder") && CONTRACT.pointSetOf("ladder") === "ffa", "registered; spawns on the borrowed ffa set");
    ok(CONTRACT.validateMatchContent(live, { modeIds: MATCH.MODE_IDS }).ok, "LIVE content.json passes the contract gate");
    const base = MODE.LADDER_TIERS;
    const ws = new Set(base.map((t) => t.weapon));
    ok(base.length === 8 && ws.size === 5 && base.filter((t) => t.attach.length).length === 3 && base[base.length - 1].weapon === "pike",
      "8 gun rungs: all five weapons, three attachment variants, the pistol last");
    ok(MODE.meleeVerbId() === "knife", "the melee verb is present in this tree (core/sim/melee.js) → knife rung on");
    const r = MODE.resolveTiers(W, "knife"), r0 = MODE.resolveTiers(W, null);
    ok(r.tiers.length === 9 && r.tiers[8].knife && r.melee && r0.tiers.length === 8 && !r0.melee && !r0.tiers.some((t) => t.knife),
      "with the verb: 9 rungs ending on the KNIFE; without it: 8, ending on the pistol, no demotion");
  }

  section("rules (mock facade)");
  {
    const T = mock(MODE, W);
    const N = T.st.tiers.length;
    ok(T.bodies.every((b) => b.weapon.id === "warden"), "everyone starts on rung 1 (WARDEN)");
    T.kill(0, 1);
    ok(T.st.tier[0] === 1 && T.m.state.teams[0].score === 1 && T.bodies[0].armed.slice(-1)[0][1] === "holo+compensator+grip",
      "a kill promotes AND re-arms on the spot (rung 2: WARDEN · HOLO / COMP / GRIP); team score = rungs");
    ok(T.events.some((e) => e.type === "ladder" && e.data.state === "promoted" && e.data.who === "P" && e.data.tier === 1), "'promoted' event");
    T.kill(3, 0, "knife");
    ok(T.st.tier[0] === 0 && T.m.state.teams[0].score === 0 && T.st.tier[3] === 1 &&
       T.events.some((e) => e.type === "ladder" && e.data.state === "demoted" && e.data.who === "P" && e.data.by === "b3"), "a KNIFE kill demotes the victim one rung (and still promotes the killer)");
    T.kill(4, 0, "knife");
    ok(T.st.tier[0] === 0, "never below rung 1");
    T.mode.onSpawn(T.m, { actor: T.actors[0] });
    ok(T.bodies[0].weapon.id === "warden", "respawn re-arms the current rung");
    for (let k = 0; k < N - 1; k++) T.kill(5, 6);
    ok(T.st.tier[5] === N - 1 && T.bodies[5].armed.slice(-1)[0][2] === true, `rung ${N} is the knife: armed knifeOnly`);
    ok(T.mode.checkWin(T.m) === null, "not finished yet");
    T.kill(5, 7, "knife");
    ok(T.st.finisher === 5 && T.mode.checkWin(T.m).reason === "ladder complete" && T.mode.checkWin(T.m).winnerTeam === 5, "the kill on the last rung finishes → win");
  }

  section("win + overtime");
  {
    const T = mock(MODE, W);
    T.kill(2, 3); T.kill(2, 4); T.kill(6, 7);
    T.m.timeLeft = 0;
    ok(T.mode.checkWin(T.m).reason === "time (highest rung)" && T.mode.checkWin(T.m).winnerTeam === 2, "horn: highest rung wins");
    T.kill(6, 8);
    T.actors[2].deaths = 1;
    { const w = T.mode.checkWin(T.m); ok(w && w.reason === "time tiebreak (fewer deaths)" && w.winnerTeam === 6, "equal rungs → fewer deaths wins"); }
    T.actors[2].deaths = 0; T.actors[6].deaths = 0;
    ok(T.mode.checkWin(T.m) === null, "full tie → null (overtime)");
    T.m.phase = "overtime"; T.m.timeLeft = 100; T.mode.tick(T.m, DT);
    ok(T.st.otTied.join(",") === "2,6", "overtime: the tied leaders are frozen at entry (2, 6)");
    T.kill(9, 1);
    ok(T.mode.checkWin(T.m) === null, "a non-leader's kill wins nothing");
    T.kill(6, 3);
    ok(T.mode.checkWin(T.m).reason === "overtime kill" && T.mode.checkWin(T.m).winnerTeam === 6, "the first tied leader to kill wins it");
    const T2 = mock(MODE, W);
    T2.kill(2, 3); T2.kill(6, 7); T2.m.phase = "overtime"; T2.m.timeLeft = 100; T2.mode.tick(T2.m, DT);
    T2.mode.onDeath(T2.m, { actor: T2.actors[2], t: 1 });
    ok(T2.mode.checkWin(T2.m).reason === "overtime last leader" && T2.mode.checkWin(T2.m).winnerTeam === 6, "a tied leader who dies is out → last leader standing wins");
    T2.st.otTied.length = 0;
    ok(T2.mode.checkWin(T2.m).result === "draw", "…both out → draw");
  }

  section("sim hook (setLadderWeapon + forcedLoadout)");
  {
    const content = fixture(live.archetypes, {}, { pvpClassSelected: { enabled: true } });
    MATCH.registerMode("ladder", MODE.createMode);
    const sim = S.createSim({ content, colliders: flatColliders(), weapons: W, seed: 3, mode: "ladder", tuning: "pvp", matchOpts: { spawnDirectorFactory: SP.makeSpawns } });
    ok(sim.classes.on === false && sim.loot === null && sim.internal.noCallIns === true, "forcedLoadout: class kits OFF even with classes selected, no loot system, no call-ins");
    const b = { weapon: { id: "pike" }, slots: [], grenades: 2, tactical: 2, perks: { scavenger: true } };
    sim.setLadderWeapon(b, "vesper", ["laser", "rapidfire"]);
    const wt = sim.weaponOf(b, "vesper");
    ok(b.weapon.id === "vesper" && b.slots.filter(Boolean).join() === "vesper" && b.weapon.mag === wt.mag && b.weapon.reserve === wt.reserve, "one slot, the rung weapon, full ammo");
    ok(wt !== sim.weapons.vesper && wt.gunsmith && wt.gunsmith.attach.join() === "laser,rapidfire", "the attachments are in the effective table (weaponOf)");
    ok(b.grenades === 0 && b.tactical === 0 && Object.keys(b.perks).length === 0, "no lethal, no tactical, no perks");
    sim.setLadderWeapon(b, "pike", [], true);
    ok(b.weapon.mag === 0 && b.weapon.reserve === 0 && b._knifeOnly === true, "knife rung: the pistol is carried EMPTY (_knifeOnly)");
    sim.setLadderWeapon(b, "warden", []);
    ok(b._knifeOnly === false && b.weapon.mag > 0, "a gun rung clears it");
    MATCH.registerMode("tdm", (await import(u("core/match/modes/tdm.js"))).createMode);
    const sim2 = S.createSim({ content: fixture(live.archetypes, {}, { pvpClassSelected: { enabled: true } }), colliders: flatColliders(), weapons: W, seed: 3, mode: "tdm", tuning: "pvp" });
    ok(sim2.classes.on === true && sim2.loot !== null && !sim2.internal.noCallIns, "control: a SKIRMISH sim keeps classes, loot and call-ins");
  }

  section("AI role unit (roles/ladder.js overlay)");
  {
    const writes = new Map();
    const api = { REASONS: OBJ.REASONS, write: (rec, body, f) => writes.set(body.id, f) };
    const mk = (knife, fresh) => ({ actor: { actorId: 1, team: 1 }, body: { id: 1, pos: [0, 0, 0], _knifeOnly: knife, percept: { target: "P", lastKnown: [3, 0, 4], lastSeenT: fresh ? 9.5 : 1 } }, rec: { route: {} } });
    const ctx = (bots) => ({ t: 10, api, bots, m: {}, rules: {}, _noBase: true });
    writes.clear(); ROLES._overlay(ctx([mk(true, true)]));
    const f = writes.get(1);
    ok(f && f.reason === OBJ.REASONS.LADDER_CLOSE && f.anchor[0] === 3 && f.noRetreat, "knife rung + fresh percept → LADDER_CLOSE on its own lastKnown, no retreat");
    writes.clear(); ROLES._overlay(ctx([mk(true, false)]));
    ok(!writes.size, "stale percept → nothing (no information is granted)");
    writes.clear(); ROLES._overlay(ctx([mk(false, true)]));
    ok(!writes.size, "a gun rung → the FFA pass alone");
  }

  section("REAL driver + sim + spawn director + bot AI (flat fixture)");
  function run(seed, rules) {
    const events = []; let simRef = null; let wrongGun = 0, knifeAmmo = 0, samples = 0;
    const content = fixture(live.archetypes, rules || { timeLimitS: 240, respawnS: 1.5, protectS: 0.5 });
    const sim = S.createSim({ content, colliders: flatColliders(), weapons: W, seed, mode: "ladder", tuning: "pvp",
      matchOpts: { spawnDirectorFactory: SP.makeSpawns }, emit: (type, data) => events.push({ type, data, t: simRef ? simRef.state.time : 0 }) });
    simRef = sim; sim.mission.start(sim);
    const M = sim.state.match; let ticks = 0;
    while (M.phase !== "ended" && ticks < 60 * 420) {
      sim.step(null); ticks++;
      if (ticks % 30 === 0 && M.phase === "live") {
        for (const a of M.actors) {
          if (!a.alive) continue;
          const b = sim.match.m.bodyOf(a); if (!b) continue;
          const tr = M.mode.tiers[Math.min(M.mode.tier[a.actorId], M.mode.tiers.length - 1)];
          samples++;
          if (b.weapon.id !== tr.weapon) wrongGun++;
          if (tr.knife && b.weapon.mag + b.weapon.reserve > 0) knifeAmmo++;
        }
      }
    }
    return { sim, M, events, ticks, wrongGun, knifeAmmo, samples };
  }
  const r1 = run(7);
  {
    const { sim, M, events } = r1;
    ok(M.phase === "ended" && M.result.reason === "ladder complete", `a bot-only ASCENT match ends on the ladder (${sim.state.time.toFixed(1)} s, ${M.result.reason})`);
    ok(r1.samples > 100 && r1.wrongGun === 0, `every living body holds its rung's weapon (${r1.samples} samples, ${r1.wrongGun} wrong)`);
    ok(r1.knifeAmmo === 0, "the knife rung stays empty (no kill refill, no empty-ammo trickle)");
    ok(!events.some((e) => e.type === "streak" && e.data.phase === "earned") && (sim.state.loot || []).length === 0 && !events.some((e) => e.type === "pickup"),
      "no call-in earned, no loot on the floor, no pickups");
    ok(events.filter((e) => e.type === "ladder" && e.data.state === "promoted").length >= 8, "promotions happened");
    ok(!sim.match._ms.watchdogFired && sim.match._ms.oobDeaths === 0, "watchdog + OOB silent");
    const roles = new Set(); for (const e of events) if (e.type === "objrole") roles.add(e.data.reason);
    ok(roles.has("HUNT") || roles.has("LANE_QUOTA"), `the solo commander ran (${[...roles].join(",")})`);
  }

  section("determinism");
  {
    const h = (r) => djb2(JSON.stringify({ e: r.events.filter((e) => e.type === "ladder").map((e) => [e.data.state, e.data.who, e.data.tier, Math.round(e.t * 60)]), n: r.ticks }));
    ok(h(r1) === h(run(7)), "same seed twice → identical ladder log");
    ok(h(run(8)) !== h(r1), "a different seed plays a different match");
  }
  console.log(`\n${failed === 0 ? "GREEN" : "RED"} — ladder.selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
