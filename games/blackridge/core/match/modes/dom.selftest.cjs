#!/usr/bin/env node
/* core/match/modes/dom.selftest.cjs [lane dom] — MODE: STRONGHOLD battery.
 *
 * Run: node core/match/modes/dom.selftest.cjs   → exit 0 on green.
 *
 *  1. interface + purity: id 'dom', STRONGHOLD, teamCount 2, defaults; the
 *     registry (MODE_IDS), the borrowed tdm point set and the contract gate
 *     against the LIVE content.json; zone data for all three arenas.
 *  2. capture math on a mock facade (exact tick counts): presence rate by
 *     operator count (1/2/3/4/5), contested = frozen, empty decay, holders
 *     wipe enemy progress, neutralise-before-capture with the event order,
 *     a different team's partial bar drains first, spawn protection given up.
 *  3. scoring: +1 per held zone per scoreTickS (live AND overtime, never in
 *     warm-up), personal points (capture / neutralise / defend kill).
 *  4. win + overtime: score limit, same-tick limit tie = draw, the horn, tie
 *     → null (driver overtime), overtime lead, overtime elimination, the
 *     overtime-cap tie-break chain (zones held → captures → kills → draw).
 *  5. the spawn rule (V7 hook + bias): never inside a zone you do not hold,
 *     never near an enemy-held / contested / threatened zone, own half unless
 *     forward of a held zone; bias prefers held zones.
 *  6. the REAL driver + sim + spawn director + bot AI on a flat fixture: a
 *     bot-only match terminates, both teams capture, the watchdog and the OOB
 *     backstop stay silent, every live respawn obeys the spawn rule, and a
 *     scripted 0-0 goes to overtime and ends on the first lead.
 *  7. determinism: same seed twice → identical zone-event log + score hash.
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

// ---------------------------------------------------------------- fixtures
const ZA = [0, 0, 10], ZB = [0, 0, 0], ZC = [0, 0, -12];

function flatColliders() {
  return {
    boxes: [], groundY: () => 0,
    spawns: { player: [0, 0, 0], playerYaw: 0 },
    cover: [], nodes: {},
    bounds: { min: [-80, -5, -80], max: [80, 30, 80] },
  };
}

function syntheticContent(realArchetypes, domRules) {
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
  mkRow("SC_A", 0, 28, 18, -30, 6);
  mkRow("SC_A2", 0, 20, 6, -15, 6);
  mkRow("SC_B", 1, -32, 18, -30, 6);
  mkRow("SC_B2", 1, -24, 6, -15, 6);
  return {
    version: 2,
    arena: {
      id: "flat_fixture",
      bounds: { min: [-79, -2, -79], max: [79, 20, 79] },
      outOfBounds: { graceS: 5.0 },
      zones: [{ id: "A", pos: ZA, r: 4 }, { id: "B", pos: ZB, r: 4 }, { id: "C", pos: ZC, r: 4 }],
    },
    teams: [
      { id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a", side: "west" },
      { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b", side: "east" },
    ],
    botRoster: [
      { slot: 1, archetype: "cqb" }, { slot: 2, archetype: "rifleman" },
      { slot: 3, archetype: "rifleman" }, { slot: 4, archetype: "marksman" },
      { slot: 5, archetype: "cqb" }, { slot: 6, archetype: "rifleman" },
      { slot: 7, archetype: "rifleman" }, { slot: 8, archetype: "rifleman" },
      { slot: 9, archetype: "marksman" },
    ],
    clusters: {
      SC_A: { anchor: [0, 0, 30], team: 0, side: "west" },
      SC_A2: { anchor: [0, 0, 20], team: 0, side: "west" },
      SC_B: { anchor: [0, 0, -30], team: 1, side: "east" },
      SC_B2: { anchor: [0, 0, -24], team: 1, side: "east" },
    },
    spawnPoints,
    flags: [
      { id: "flag_amber", team: 0, home: [0, 0, 44], standR: 1.2, standH: 2.5 },
      { id: "flag_slate", team: 1, home: [0, 0, -44], standR: 1.2, standH: 2.5 },
    ],
    modes: {
      tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      ffa: { scoreLimit: 4, timeLimitS: 30, respawnS: 1.0, protectS: 0.5 },
      dom: domRules,
    },
    archetypes: realArchetypes,
    pickups: [],
    scenarios: {},
  };
}

// mock facade: 10 actors (0..4 team 0, 5..9 team 1), positions settable
function makeMock(MODE, rules, content) {
  const actors = [];
  for (let i = 0; i < 10; i++) {
    actors.push({
      actorId: i, team: i < 5 ? 0 : 1, who: i === 0 ? "P" : "b" + i, kind: i === 0 ? "human" : "bot",
      alive: true, score: 0, kills: 0, deaths: 0, assists: 0, captures: 0, protectedUntilT: -1,
      _p: [60 + i, 0, 60],
    });
  }
  const events = [];
  const m = {
    time: 0, phase: "live", timeLeft: 300,
    rules: Object.assign({ scoreLimit: 200, timeLimitS: 600 }, rules || {}),
    state: { teams: [{ id: 0, score: 0, captures: 0 }, { id: 1, score: 0, captures: 0 }], mode: {} },
    actors,
    posOf: (a) => a._p,
    emit: (type, data) => events.push({ type, data, t: m.time }),
    addScore: (a, p) => { a.score += p; },
    addTeamScore: (t, p) => { m.state.teams[t].score += p; },
    cancelProtection: (a) => { a.protectedUntilT = -1; },
    clusters: (content && content.clusters) || {},
    arena: { id: "flat_fixture", bounds: { min: [-79, -2, -79], max: [79, 20, 79] } },
  };
  const mode = MODE.createMode({ content: content || {} });
  mode.start(m);
  const step = (n) => { for (let i = 0; i < n; i++) { m.time += DT; mode.tick(m, DT); } };
  const put = (ids, p) => { for (const id of ids) actors[id]._p = [p[0], p[1] || 0, p[2]]; };
  const away = () => { for (const a of actors) a._p = [60 + a.actorId, 0, 60]; };
  const zone = (id) => mode._st.zones.find((z) => z.id === id);
  const ticksUntil = (fn, max) => { for (let i = 1; i <= max; i++) { step(1); if (fn()) return i; } return -1; };
  return { m, mode, actors, events, step, put, away, zone, ticksUntil };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const CONTRACT = await import(u("core/match/contract.js"));
  const MODE = await import(u("core/match/modes/dom.js"));
  const SP = await import(u("core/match/spawns.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const liveContent = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));

  // ================================================== 1. interface
  section("interface + purity + registry + contract + zone data");
  const fxContent = syntheticContent(liveContent.archetypes, {});
  {
    const mode = MODE.createMode({ content: fxContent });
    ok(mode.id === "dom", "id is 'dom'");
    ok(mode.displayName === "STRONGHOLD", "display name STRONGHOLD (original — not used by any other mode)");
    ok(mode.teamCount === 2, "teamCount 2 (5v5)");
    const d = mode.defaults;
    ok(d.scoreLimit === 200 && d.timeLimitS === 600 && d.respawnS === 4 && d.protectS === 1.5 && d.scoreTickS === 2.5,
      `defaults 200 pts / 10:00 / 4.0 s respawn / 1.5 s protect / +1 per zone per 2.5 s`);
    ok(MODE.DOM_DEFAULTS.captureS === 10 && MODE.DOM_DEFAULTS.neutraliseS === 5 && MODE.DOM_DEFAULTS.zoneR === 4,
      "capture 10 s, neutralise 5 s, ring r 4 m (one operator)");
    const src = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/dom.js"), "utf8");
    ok(!/from\s+["']three["']/.test(src) && !src.includes("THREE."), "dom.js is THREE-free");
    ok(!src.includes("Math.random") && !src.includes("Date.now") && !src.includes("performance.now"),
      "dom.js draws no wall clock and no unseeded randomness");
    ok(MATCH.MODE_IDS.includes("dom"), "MODE_IDS registers 'dom' next to tdm/ctf/ffa");
    ok(CONTRACT.BORROWED_POINT_SETS.dom === "tdm" && CONTRACT.pointSetOf("dom") === "tdm" && CONTRACT.pointSetOf("ctf") === "ctf",
      "STRONGHOLD spawns on the tdm point set (borrowed, lender unchanged)");
    const gate = CONTRACT.validateMatchContent(liveContent, { modeIds: MATCH.MODE_IDS });
    ok(gate.ok, "LIVE content.json passes the contract gate with 'dom' registered" + (gate.ok ? "" : " — " + gate.errors.join("; ")));
    const bad = JSON.parse(JSON.stringify(liveContent)); delete bad.modes.tdm;
    ok(!CONTRACT.validateMatchContent(bad, { modeIds: MATCH.MODE_IDS }).ok, "the gate still rejects a missing LENDER block (tdm)");
    for (const id of ["lanternwalk", "switchyard", "saltmarket"]) {
      const zs = MODE.zonesFor({}, id);
      const blk = liveContent.arenas[id];
      const B = blk.arena.bounds;
      const inB = zs.every((z) => z.pos[0] > B.min[0] && z.pos[0] < B.max[0] && z.pos[2] > B.min[2] && z.pos[2] < B.max[2]);
      const ids = zs.map((z) => z.id).join("");
      let minSpawn = Infinity;
      for (const z of zs) for (const p of blk.spawnPoints) minSpawn = Math.min(minSpawn, Math.hypot(p.pos[0] - z.pos[0], p.pos[2] - z.pos[2]));
      const fl0 = blk.flags.find((f) => f.team === 0).home, fl1 = blk.flags.find((f) => f.team === 1).home;
      const dA0 = Math.hypot(zs[0].pos[0] - fl0[0], zs[0].pos[2] - fl0[2]), dA1 = Math.hypot(zs[0].pos[0] - fl1[0], zs[0].pos[2] - fl1[2]);
      const dC0 = Math.hypot(zs[2].pos[0] - fl0[0], zs[2].pos[2] - fl0[2]), dC1 = Math.hypot(zs[2].pos[0] - fl1[0], zs[2].pos[2] - fl1[2]);
      ok(zs.length === 3 && ids === "ABC" && inB && minSpawn >= 5 && dA0 < dA1 && dC1 < dC0,
        `${id}: 3 zones A/B/C inside bounds, >= 5 m off every spawn point (min ${minSpawn.toFixed(1)}), A nearer AMBER's stand, C nearer SLATE's`);
    }
    const ov = MODE.zonesFor({ modes: { dom: { zones: { lanternwalk: [{ id: "A", pos: [1, 0, 2] }] } } } }, "lanternwalk");
    ok(ov.length === 1 && ov[0].pos[0] === 1, "content.modes.dom.zones[arena] overrides the map data");
  }

  // ================================================== 2. capture math
  section("capture math (mock facade, exact tick counts)");
  {
    const rates = [];
    for (const n of [1, 2, 3, 4, 5]) {
      const T = makeMock(MODE, {}, fxContent);
      T.put([0, 1, 2, 3, 4].slice(0, n), ZB);
      const ticks = T.ticksUntil(() => T.zone("B").owner === 0, 2000);
      rates.push(ticks);
    }
    ok(Math.abs(rates[0] - 600) <= 1, `1 operator captures neutral B in 10.0 s (${rates[0]} ticks)`);
    ok(Math.abs(rates[1] - 400) <= 1, `2 operators: 6.67 s (${rates[1]} ticks, x1.5)`);
    ok(Math.abs(rates[2] - 334) <= 1, `3 operators: 5.56 s (${rates[2]} ticks, x1.8)`);
    ok(Math.abs(rates[3] - 300) <= 1 && rates[4] === rates[3], `4+ operators saturate at 5.0 s (${rates[3]} / ${rates[4]} ticks, x2.0)`);
  }
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZB);
    T.step(300);
    const p0 = T.zone("B").prog;
    T.put([6], [1, 0, 1]);
    T.step(300);
    const zB = T.zone("B");
    ok(Math.abs(p0 - 0.5) < 0.01 && Math.abs(zB.prog - p0) < 1e-9 && zB.contested && zB.phase === "contested",
      `contested (both teams inside) freezes the bar at ${p0.toFixed(2)}`);
    ok(T.events.filter((e) => e.type === "zonecap" && e.data.state === "contested").length === 1,
      "exactly one 'contested' event on the edge (not per tick)");
    T.put([6], [60, 0, 60]);
    T.step(300);
    ok(T.zone("B").owner === 0 && !T.zone("B").contested, "the enemy leaves → the capture resumes and completes");
  }
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZB); T.step(300); T.away(); T.step(300);
    ok(Math.abs(T.zone("B").prog - 0.25) < 0.01, `an EMPTY zone's partial bar decays (0.50 → ${T.zone("B").prog.toFixed(3)} in 5 s, decayS 20)`);
    T.step(600);
    ok(T.zone("B").prog === 0 && T.zone("B").capTeam === -1, "…to zero, then the capture team clears");
  }
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZB); T.ticksUntil(() => T.zone("B").owner === 0, 700); T.away();
    T.events.length = 0;
    T.put([6], ZB); T.step(60);
    const pE = T.zone("B").prog;
    T.away(); T.put([2], ZB);
    const wipe = T.ticksUntil(() => T.zone("B").prog === 0, 200);
    ok(Math.abs(pE - 0.2) < 0.01 && T.zone("B").owner === 0 && Math.abs(wipe - 60) <= 1,
      `the holders wipe enemy progress at their own rate (${pE.toFixed(2)} gone in ${wipe} ticks)`);
  }
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZB); T.ticksUntil(() => T.zone("B").owner === 0, 700); T.away();
    T.events.length = 0;
    T.actors[6].protectedUntilT = 999;
    T.put([6], ZB);
    const tN = T.ticksUntil(() => T.zone("B").owner === -1, 700);
    const tC = T.ticksUntil(() => T.zone("B").owner === 1, 1000);
    const seq = T.events.filter((e) => e.type === "zonecap").map((e) => e.data.state).join(",");
    ok(Math.abs(tN - 300) <= 1 && Math.abs(tC - 600) <= 1,
      `enemy zone: NEUTRALISE first (${(tN / 60).toFixed(2)} s) then capture (${(tC / 60).toFixed(2)} s more)`);
    ok(seq === "capturing,neutralised,captured", `event order: ${seq}`);
    ok(T.actors[6].score === 75 + 150 && T.actors[6].captures === 1, `personal points: neutralise 75 + capture 150 (got ${T.actors[6].score})`);
    ok(T.actors[6].protectedUntilT === -1, "working an objective gives up spawn protection");
    const cap = T.events.find((e) => e.data.state === "captured").data;
    ok(cap.zone === "B" && cap.team === 1 && cap.owner === 1 && cap.prevOwner === -1 && cap.byWho[0] === "b6",
      "zonecap payload: {zone, team, owner, prevOwner, byWho}");
  }
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZB); T.step(300); T.away();
    T.put([6], ZB);
    const drain = T.ticksUntil(() => T.zone("B").capTeam === 1, 400);
    ok(Math.abs(drain - 300) <= 2 && T.zone("B").owner === -1,
      `a different team's partial bar drains before the newcomer builds (${drain} ticks)`);
  }

  // ================================================== 3. scoring
  section("scoring");
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZA); T.ticksUntil(() => T.zone("A").owner === 0, 700);
    T.put([1], ZB); T.ticksUntil(() => T.zone("B").owner === 0, 700);
    T.away();
    const s0 = T.m.state.teams[0].score, s1 = T.m.state.teams[1].score;
    T.step(25 * 60);
    ok(T.m.state.teams[0].score - s0 === 20 && T.m.state.teams[1].score === s1,
      `holding 2 zones for 25 s = +20 (10 ticks × 2); the other team +0 (got +${T.m.state.teams[0].score - s0})`);
    T.m.phase = "overtime"; T.step(150);
    ok(T.m.state.teams[0].score - s0 === 22, "overtime keeps scoring (+2 on the next tick)");
    T.m.phase = "warmup"; const w0 = T.m.state.teams[0].score; T.put([6], ZA); T.step(600);
    ok(T.m.state.teams[0].score === w0 && T.zone("A").owner === 0, "warm-up: no capture, no score");
  }
  {
    const T = makeMock(MODE, {}, fxContent);
    T.put([1], ZB); T.ticksUntil(() => T.zone("B").owner === 0, 700);
    const killer = T.actors[1], victim = T.actors[7];
    const kev = { attacker: killer, victim, assists: [], pos: [1, 0, 2], t: T.m.time };
    const e = T.mode.scoreForKill(T.m, kev);
    ok(e.length === 2 && e[1].reason === "defend" && e[1].points === 50 && killer.defends === 1,
      "a kill inside a zone you hold = kill 100 + DEFEND 50 (defends counted)");
    ok(T.events.some((x) => x.type === "zonecap" && x.data.state === "defended" && x.data.byWho[0] === "b1"), "'defended' zonecap event");
    const e2 = T.mode.scoreForKill(T.m, { attacker: killer, victim, assists: [], pos: [40, 0, 40], t: T.m.time });
    ok(e2.length === 1 && e2[0].points === 100, "a kill far from any held zone = kill 100 only");
  }

  // ================================================== 4. win / overtime
  section("win + overtime");
  {
    const T = makeMock(MODE, {}, fxContent);
    const tm = T.m.state.teams;
    tm[0].score = 200; tm[1].score = 150;
    ok(T.mode.checkWin(T.m).winnerTeam === 0, "score limit → win");
    tm[1].score = 200;
    ok(T.mode.checkWin(T.m).result === "draw", "both at the limit on the same tick, equal → draw");
    tm[0].score = 120; tm[1].score = 100; T.m.timeLeft = 0;
    const w = T.mode.checkWin(T.m);
    ok(w && w.winnerTeam === 0 && w.reason === "time", "the horn: higher score wins");
    tm[1].score = 120;
    ok(T.mode.checkWin(T.m) === null, "a tie at the horn → null (the driver goes to overtime)");
    T.m.phase = "overtime"; T.m.timeLeft = 100;
    ok(T.mode.checkWin(T.m) === null, "overtime, still tied, both sides standing → play on");
    tm[1].score = 121;
    ok(T.mode.checkWin(T.m).reason === "overtime lead" && T.mode.checkWin(T.m).winnerTeam === 1, "overtime: the first lead wins");
    tm[1].score = 120;
    for (const a of T.actors) if (a.team === 0) a.alive = false;
    ok(T.mode.checkWin(T.m).reason === "overtime elimination" && T.mode.checkWin(T.m).winnerTeam === 1, "overtime: no respawns — a wiped side loses");
    for (const a of T.actors) a.alive = true;
    T.m.timeLeft = DT;
    T.zone("A").owner = 0;
    ok(T.mode.checkWin(T.m).reason === "overtime (zones held)", "overtime cap: zones held breaks the tie");
    T.zone("A").owner = -1;
    T.mode._st.caps[1] = 2;
    ok(T.mode.checkWin(T.m).reason === "overtime (captures)", "…then captures");
    T.mode._st.caps[1] = 0; T.actors[3].kills = 2;
    ok(T.mode.checkWin(T.m).reason === "overtime (kills)", "…then kills");
    T.actors[3].kills = 0;
    ok(T.mode.checkWin(T.m) === null, "…all equal → null (the driver's draw)");
  }

  // ================================================== 5. spawn rule
  section("spawn rule (V7 hook + bias)");
  {
    const T = makeMock(MODE, {}, fxContent);
    const a0 = T.actors[1], a1 = T.actors[6];
    const pt = (x, z, cluster) => ({ pos: [x, 0, z], cluster: cluster || null });
    ok(T.mode.spawnVeto(T.m, a0, pt(1, 1)) === true, "inside a NEUTRAL zone → vetoed");
    T.put([1], ZB); T.ticksUntil(() => T.zone("B").owner === 0, 700); T.away();
    ok(T.mode.spawnVeto(T.m, a0, pt(1, 1)) === false, "inside your OWN zone → allowed");
    ok(T.mode.spawnVeto(T.m, a1, pt(1, 1)) === true, "inside the ENEMY's zone → vetoed");
    ok(T.mode.spawnVeto(T.m, a1, pt(0, -10)) === true, "10 m from an enemy-held zone → vetoed");
    ok(T.mode.spawnVeto(T.m, a1, pt(8, -16, "SC_B2")) === false, "17.9 m from it on your own half (and clear of neutral C) → allowed");
    T.put([7], [0, 0, 3.5]); T.step(1);
    ok(T.zone("B").capTeam === 1 && T.mode.spawnVeto(T.m, a0, pt(0, 9)) === true,
      "your zone under attack → no spawn within 12 m of it (even your own)");
    T.away(); T.step(1);
    ok(T.mode.spawnVeto(T.m, a0, pt(0, -30, "SC_B")) === true, "the ENEMY half, far from anything you hold → vetoed (side rule)");
    T.put([1], ZC); T.ticksUntil(() => T.zone("C").owner === 0, 1200); T.away();
    ok(T.mode.spawnVeto(T.m, a0, pt(10, -30, "SC_B")) === false, "…but forward ground within 22 m of a zone you hold → allowed");
    const bNear = T.mode.spawnBias(T.m, a0, pt(0, 20, "SC_A2"));
    const bFar = T.mode.spawnBias(T.m, a0, pt(70, 70, "SC_A"));
    ok(bNear > bFar && bNear <= 1 && bFar >= 0, `bias prefers ground near held zones (${bNear.toFixed(2)} > ${bFar.toFixed(2)}, in 0..1)`);
  }

  // ================================================== 6. the real driver
  section("REAL driver + sim + spawn director + bot AI (flat fixture)");
  const domRules = { scoreLimit: 60, timeLimitS: 150, respawnS: 1.5, protectS: 0.5, scoreTickS: 1.0, captureS: 5, neutraliseS: 2.5 };
  const contentLive = syntheticContent(liveContent.archetypes, domRules);
  MATCH.registerMode("dom", MODE.createMode);

  function runMatch(seed, content, opts) {
    const events = [];
    let simRef = null;
    const sim = S.createSim({
      content, colliders: flatColliders(), weapons: WD.WEAPONS, seed, mode: "dom", tuning: "pvp",
      matchOpts: { spawnDirectorFactory: SP.makeSpawns },
      emit: (type, data) => {
        if (type === "respawn" && simRef && simRef.state.match && simRef.state.match.phase !== "warmup") {
          const zs = simRef.state.match.mode.zones || [];
          let bad = false;
          for (const z of zs) {
            const d = Math.hypot(data.pos[0] - z.pos[0], data.pos[2] - z.pos[2]);
            if (z.owner !== data.team && d < z.r) bad = true;
            if (((z.owner >= 0 && z.owner !== data.team) || z.contested) && d < 10) bad = true;
          }
          events.push({ type: "respawnCheck", data: { bad, pointId: data.pointId } });
        }
        events.push({ type, data, t: simRef ? simRef.state.time : 0 });
      },
    });
    simRef = sim;
    sim.mission.start(sim);
    const M = sim.state.match;
    let ticks = 0;
    const cap = (opts && opts.maxTicks) || 60 * 420;
    while (M.phase !== "ended" && ticks < cap) {
      if (opts && opts.each) opts.each(sim, ticks);
      sim.step(null);
      ticks++;
    }
    return { sim, M, events, ticks };
  }

  const r1 = runMatch(7, contentLive);
  {
    const { sim, M, events } = r1;
    const zc = events.filter((e) => e.type === "zonecap");
    const caps = [0, 0];
    for (const e of zc) if (e.data.state === "captured") caps[e.data.team]++;
    const checks = events.filter((e) => e.type === "respawnCheck");
    const badSpawns = checks.filter((e) => e.data.bad).length;
    ok(M.phase === "ended", `a bot-only STRONGHOLD match terminates (${(sim.state.time).toFixed(1)} s, ${M.result.reason}, ${M.teams[0].score}:${M.teams[1].score})`);
    ok(caps[0] > 0 && caps[1] > 0, `both teams capture zones (AMBER ${caps[0]}, SLATE ${caps[1]})`);
    ok(!sim.match._ms.watchdogFired && sim.match._ms.oobDeaths === 0, "watchdog silent, OOB backstop silent");
    ok(checks.length > 5 && badSpawns === 0, `every live respawn obeys the zone spawn rule (${checks.length} respawns, ${badSpawns} violations)`);
    const teamScore = M.teams[0].score + M.teams[1].score;
    const zoneEvents = events.filter((e) => e.type === "match:score" && e.data.reason === "zone" && e.data.actorId == null);
    let zs = 0; for (const e of zoneEvents) zs += e.data.points;
    ok(zs === teamScore, `team score is ONLY zone points (sum ${zs} === ${teamScore}); kills never touch it`);
    const vocab = new Set(zc.map((e) => e.data.state));
    ok([...vocab].every((s) => ["capturing", "neutralised", "captured", "contested", "defended"].includes(s)),
      `zonecap states in the closed set (${[...vocab].join(",")})`);
    const roles = new Set();
    for (const e of events) if (e.type === "objrole") roles.add(e.data.reason);
    ok([...roles].some((r) => r.startsWith("ZONE_")), `the commander issued zone roles (${[...roles].join(",")})`);
  }

  // scripted 0-0 → overtime → the first lead ends it
  {
    const rules = Object.assign({}, domRules, { timeLimitS: 6, scoreLimit: 999 });
    const content = syntheticContent(liveContent.archetypes, rules);
    let otSeen = false;
    const r = runMatch(3, content, {
      maxTicks: 60 * 120,
      each: (sim) => {
        const M = sim.state.match;
        if (M.phase === "overtime") otSeen = true;
        // pin every bot far from the zones (no captures, no fights) until
        // overtime; then walk one AMBER bot onto B alone
        let k = 0;
        for (const b of sim.state.bots) {
          if (!b.alive) continue;
          if (otSeen && b.team === 0 && k === 0) { sim.teleport(b.id, 0.5, 0, 0.5); k++; continue; }
          sim.teleport(b.id, b.team === 0 ? -60 + (k++ * 3) : 60 - (k++ * 3), 0, b.team === 0 ? 60 : -60);
          if (b.weapon) { b.weapon.mag = 0; b.weapon.reserve = 0; }
        }
        sim.teleport("P", -70, 0, 70);
      },
    });
    ok(otSeen, "a 0-0 at the horn goes to overtime");
    ok(r.M.phase === "ended" && r.M.result.reason === "overtime lead" && r.M.result.winnerTeam === 0,
      `overtime ends on the first lead (${r.M.result.reason}, winner ${r.M.result.winnerTeam}, ${r.M.teams[0].score}:${r.M.teams[1].score})`);
  }

  // ================================================== 7. determinism
  section("determinism");
  {
    const hashOf = (r) => djb2(JSON.stringify({
      z: r.events.filter((e) => e.type === "zonecap").map((e) => [e.data.zone, e.data.state, e.data.team, Math.round(e.t * 60)]),
      s: r.M.teams.map((t) => t.score),
      a: r.M.actors.map((a) => [a.kills, a.deaths, a.score, a.captures]),
      ticks: r.ticks,
    }));
    const r2 = runMatch(7, contentLive);
    const h1 = hashOf(r1), h2 = hashOf(r2);
    ok(h1 === h2, `same seed twice → identical zone log + scores (${h1} / ${h2})`);
    const r3 = runMatch(8, contentLive);
    ok(hashOf(r3) !== h1, "a different seed plays a different match");
  }

  console.log(`\n${failed === 0 ? "GREEN" : "RED"} — dom.selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
