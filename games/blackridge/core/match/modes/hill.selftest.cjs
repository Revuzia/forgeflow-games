#!/usr/bin/env node
/* core/match/modes/hill.selftest.cjs [lane modes] — MODE: OUTPOST battery.
 *
 * Run: node core/match/modes/hill.selftest.cjs   → exit 0 on green.
 *  1. interface + purity + registry (borrowed tdm set) + the LIVE contract
 *     gate + site data for all three arenas (4-5 sites, inside bounds, off
 *     the spawn points)
 *  2. rules math on a mock facade: 1 point per full second of SOLE hold,
 *     contested = no score and the partial second is lost, empty = nothing,
 *     rotation every 60 s through the list (wrapping), the preview window
 *     (last 10 s), warm-up never scores, personal points, events
 *  3. win + overtime: score limit / same-tick tie / horn / tie → overtime,
 *     overtime lead / elimination / cap tie-break (hill time → kills → draw)
 *  4. spawn rule: never within 16 m of the live hill, never within 10 m of
 *     the previewed next one; bias prefers own side at a fighting distance
 *  5. REAL driver + sim + spawn director + bot AI (flat fixture): terminates,
 *     both teams hold the hill, the AI issues every HILL_* role, no live
 *     respawn inside 16 m of the live hill, watchdog / OOB silent
 *  6. AI role unit (roles/hill.js on a stub ctx): capture when not ours,
 *     hold when ours, rotate early in the preview window, one anchor when
 *     ahead with bodies to spare, everyone on the hill in overtime
 *  7. determinism: same seed twice → identical event log + scores
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
const H1 = [0, 0, 0], H2 = [0, 0, 20], H3 = [0, 0, -20];

function flatColliders() {
  return { boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {}, bounds: { min: [-80, -5, -80], max: [80, 30, 80] } };
}
function fixture(arch, rules) {
  const spawnPoints = [];
  const row = (cluster, team, cz, n, x0, step) => { for (let i = 0; i < n; i++) spawnPoints.push({ id: `${cluster.toLowerCase()}_${i}`, cluster, pos: [x0 + (i % 11) * step, 0, cz + Math.floor(i / 11) * 4], yaw: team === 0 ? Math.PI : 0, cover: 0.5, modes: ["tdm", "ctf", "ffa"] }); };
  row("SC_A", 0, 40, 18, -30, 6); row("SC_A2", 0, 30, 6, -45, 6); row("SC_B", 1, -44, 18, -30, 6); row("SC_B2", 1, -34, 6, -45, 6);
  return {
    version: 2,
    arena: { id: "flat_fixture", bounds: { min: [-79, -2, -79], max: [79, 20, 79] }, outOfBounds: { graceS: 5 },
      hills: [{ id: "1", name: "ONE", pos: H1, r: 4 }, { id: "2", name: "TWO", pos: H2, r: 4 }, { id: "3", name: "THREE", pos: H3, r: 4 }] },
    teams: [{ id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a", side: "west" }, { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b", side: "east" }],
    botRoster: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => ({ slot: s, archetype: ["cqb", "rifleman", "rifleman", "marksman"][s % 4] })),
    clusters: { SC_A: { anchor: [0, 0, 42], team: 0, side: "west" }, SC_A2: { anchor: [-30, 0, 30], team: 0, side: "west" }, SC_B: { anchor: [0, 0, -46], team: 1, side: "east" }, SC_B2: { anchor: [-30, 0, -34], team: 1, side: "east" } },
    spawnPoints,
    flags: [{ id: "flag_amber", team: 0, home: [0, 0, 50], standR: 1.2, standH: 2.5 }, { id: "flag_slate", team: 1, home: [0, 0, -50], standR: 1.2, standH: 2.5 }],
    modes: { tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ffa: { scoreLimit: 4, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, hill: rules || {} },
    archetypes: arch, pickups: [], scenarios: {},
  };
}
function mock(MODE, rules, content) {
  const actors = [];
  for (let i = 0; i < 10; i++) actors.push({ actorId: i, team: i < 5 ? 0 : 1, who: i === 0 ? "P" : "b" + i, kind: i === 0 ? "human" : "bot", alive: true, score: 0, kills: 0, deaths: 0, assists: 0, protectedUntilT: -1, _p: [60 + i, 0, 60], name: "OP" + i });
  const events = [];
  const m = {
    time: 0, phase: "live", timeLeft: 300, rules: Object.assign({ scoreLimit: 250, timeLimitS: 600 }, rules || {}),
    state: { teams: [{ id: 0, score: 0 }, { id: 1, score: 0 }], mode: {} }, actors,
    posOf: (a) => a._p, emit: (type, data) => events.push({ type, data, t: m.time }),
    addScore: (a, p) => { a.score += p; }, addTeamScore: (t, p) => { m.state.teams[t].score += p; },
    cancelProtection: (a) => { a.protectedUntilT = -1; }, clusters: content.clusters, arena: { id: "flat_fixture", bounds: content.arena.bounds },
  };
  const mode = MODE.createMode({ content });
  mode.start(m);
  const step = (n) => { for (let i = 0; i < n; i++) { m.time += DT; mode.tick(m, DT); } };
  const put = (ids, p) => { for (const id of ids) actors[id]._p = [p[0], p[1] || 0, p[2]]; };
  const away = () => { for (const a of actors) a._p = [60 + a.actorId, 0, 60]; };
  return { m, mode, actors, events, step, put, away, st: mode._st };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const CONTRACT = await import(u("core/match/contract.js"));
  const MODE = await import(u("core/match/modes/hill.js"));
  const ROLES = await import(u("core/ai/roles/hill.js"));
  const OBJ = await import(u("core/ai/objective.js"));
  const SP = await import(u("core/match/spawns.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const live = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const fx = fixture(live.archetypes, {});

  section("interface + purity + registry + contract + site data");
  {
    const mode = MODE.createMode({ content: fx });
    ok(mode.id === "hill" && mode.displayName === "OUTPOST" && mode.teamCount === 2, "id 'hill', OUTPOST, 5v5");
    const d = mode.defaults;
    ok(d.scoreLimit === 250 && d.timeLimitS === 600 && d.respawnS === 4 && d.rotateS === 60 && d.previewS === 10, "defaults 250 / 10:00 / 4 s respawn / rotate 60 s / preview 10 s");
    const src = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/hill.js"), "utf8");
    ok(!/from\s+["']three["']/.test(src) && !src.includes("THREE."), "THREE-free");
    ok(!src.includes("Math.random") && !src.includes("Date.now") && !src.includes("performance.now"), "no wall clock, no unseeded randomness");
    ok(MATCH.MODE_IDS.includes("hill") && CONTRACT.pointSetOf("hill") === "tdm", "registered; spawns on the borrowed tdm set");
    const gate = CONTRACT.validateMatchContent(live, { modeIds: MATCH.MODE_IDS });
    ok(gate.ok, "LIVE content.json passes the contract gate" + (gate.ok ? "" : " — " + gate.errors.join("; ")));
    for (const id of ["lanternwalk", "switchyard", "saltmarket"]) {
      const hs = MODE.hillsFor({}, id), blk = live.arenas[id], B = blk.arena.bounds;
      let minSp = Infinity;
      for (const h of hs) for (const p of blk.spawnPoints) minSp = Math.min(minSp, Math.hypot(p.pos[0] - h.pos[0], p.pos[2] - h.pos[2]));
      const inB = hs.every((h) => h.pos[0] > B.min[0] && h.pos[0] < B.max[0] && h.pos[2] > B.min[2] && h.pos[2] < B.max[2]);
      let minPair = Infinity;
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) minPair = Math.min(minPair, Math.hypot(hs[i].pos[0] - hs[j].pos[0], hs[i].pos[2] - hs[j].pos[2]));
      ok(hs.length >= 4 && hs.length <= 5 && inB && minSp >= 5 && minPair >= 14, `${id}: ${hs.length} sites inside bounds, >= 5 m off spawns (${minSp.toFixed(1)}), >= 14 m apart (${minPair.toFixed(1)})`);
    }
  }

  section("rules math (mock facade)");
  {
    const T = mock(MODE, {}, fx);
    ok(T.st.zone.pos[2] === 0 && T.m.state.mode.zones.length === 1, "site 1 live at start; zones[] = the live hill only");
    T.put([1, 2], H1); T.step(60 * 10);
    ok(T.m.state.teams[0].score === 10 && T.m.state.teams[1].score === 0, `sole hold for 10 s = +10 (got ${T.m.state.teams[0].score})`);
    ok(T.actors[1].score === 100 && T.actors[2].score === 100 && Math.abs(T.actors[1].hillS - 10) < 0.05, "personal +10 per point for each operator inside; TIME tracked");
    ok(T.events.some((e) => e.type === "hill" && e.data.state === "held" && e.data.team === 0) &&
       T.events.filter((e) => e.type === "hill" && e.data.state === "hold").length === 2, "'held' on taking it, 'hold' every 5 points");
    T.step(30); // half a second toward the next point
    T.put([7], [1, 0, 1]); T.step(60 * 5);
    ok(T.m.state.teams[0].score === 10 && T.m.state.teams[1].score === 0 && T.st.contested, "contested: nobody scores");
    ok(T.events.filter((e) => e.type === "hill" && e.data.state === "contested").length === 1, "one 'contested' event on the edge");
    T.put([7], [60, 0, 60]); T.step(59);
    ok(T.m.state.teams[0].score === 10, "the partial second from before the contest was lost (59 ticks clean → still 10)");
    T.step(1);
    ok(T.m.state.teams[0].score === 11, "…and the 60th tick scores");
  }
  {
    const T = mock(MODE, {}, fx);
    T.step(60 * 49);
    ok(!T.st.previewOn && T.m.state.mode.zones.length === 1, "no preview before the last 10 s");
    T.step(60 * 1 + 1);
    ok(T.st.previewOn && T.m.state.mode.zones.length === 2 && T.m.state.mode.zones[1].preview && T.m.state.mode.zones[1].pos[2] === 20,
      "last 10 s: the NEXT site (2) is published with preview:true");
    T.step(60 * 10);
    ok(T.st.idx === 1 && T.st.zone.pos[2] === 20 && !T.st.previewOn, "at 60 s the hill rotates to site 2");
    T.step(60 * 120);
    ok(T.st.idx === 0 && T.st.rotations === 3, "…3 → wraps to site 1 (3 rotations)");
    ok(T.events.filter((e) => e.type === "hill" && e.data.state === "active").length === 4 &&
       T.events.filter((e) => e.type === "hill" && e.data.state === "preview").length === 3, "'active' at the horn + one 'active' and one 'preview' per rotation");
    T.put([1], T.st.zone.pos); T.m.phase = "warmup"; const s0 = T.m.state.teams[0].score; T.step(600);
    ok(T.m.state.teams[0].score === s0, "warm-up never scores");
  }
  {
    const T = mock(MODE, {}, fx);
    T.put([1], H1); T.step(5);
    const kev = { attacker: T.actors[1], victim: T.actors[6], assists: [], pos: [2, 0, 2], t: T.m.time };
    const e = T.mode.scoreForKill(T.m, kev);
    ok(e.length === 2 && e[1].reason === "hill kill" && e[1].points === 50 && T.actors[1].objKills === 1, "a kill on the hill = kill 100 + objective 50");
    T.away(); T.put([1], [40, 0, 40]);
    ok(T.mode.scoreForKill(T.m, { attacker: T.actors[1], victim: T.actors[6], assists: [], pos: [41, 0, 40], t: 1 }).length === 1, "a kill away from it = kill only");
  }

  section("win + overtime");
  {
    const T = mock(MODE, {}, fx); const tm = T.m.state.teams;
    tm[0].score = 250; tm[1].score = 100;
    ok(T.mode.checkWin(T.m).winnerTeam === 0 && T.mode.checkWin(T.m).reason === "score limit", "score limit → win");
    tm[1].score = 250; ok(T.mode.checkWin(T.m).result === "draw", "same-tick equal at the limit → draw");
    tm[0].score = 120; tm[1].score = 100; T.m.timeLeft = 0;
    ok(T.mode.checkWin(T.m).reason === "time", "horn: higher score wins");
    tm[1].score = 120; ok(T.mode.checkWin(T.m) === null, "tie at the horn → null (driver overtime)");
    T.m.phase = "overtime"; T.m.timeLeft = 100;
    ok(T.mode.checkWin(T.m) === null, "overtime tied, both standing → play on");
    tm[0].score = 121; ok(T.mode.checkWin(T.m).reason === "overtime lead", "overtime: the next point wins");
    tm[0].score = 120; for (const a of T.actors) if (a.team === 1) a.alive = false;
    ok(T.mode.checkWin(T.m).reason === "overtime elimination" && T.mode.checkWin(T.m).winnerTeam === 0, "overtime: a wiped side loses");
    for (const a of T.actors) a.alive = true;
    T.m.timeLeft = DT; T.st.held[1] = 5;
    ok(T.mode.checkWin(T.m).reason === "overtime (hill time)" && T.mode.checkWin(T.m).winnerTeam === 1, "cap: hill time breaks it");
    T.st.held[1] = 0; T.actors[2].kills = 3;
    ok(T.mode.checkWin(T.m).reason === "overtime (kills)", "…then kills");
    T.actors[2].kills = 0; ok(T.mode.checkWin(T.m) === null, "…all equal → null (the driver's draw)");
  }

  section("spawn rule");
  {
    const T = mock(MODE, {}, fx);
    const a = T.actors[1], pt = (x, z, c) => ({ pos: [x, 0, z], cluster: c || null });
    ok(T.mode.spawnVeto(T.m, a, pt(10, 10)) === true, "14 m from the live hill → vetoed");
    ok(T.mode.spawnVeto(T.m, a, pt(17, 0)) === false, "17 m from it → allowed");
    T.step(60 * 51);
    ok(T.mode.spawnVeto(T.m, a, pt(8, 22)) === true && T.mode.spawnVeto(T.m, a, pt(12, 30)) === false, "preview: within 10 m of the next site vetoed, 15.6 m allowed");
    const T2 = mock(MODE, {}, fx);
    const own = T2.mode.spawnBias(T2.m, a, pt(0, 30, "SC_A")), theirs = T2.mode.spawnBias(T2.m, a, pt(0, -30, "SC_B")), far = T2.mode.spawnBias(T2.m, a, pt(70, 70, "SC_A"));
    ok(own > theirs && own > far && own <= 1 && far >= 0, `bias: own side at fighting range (${own.toFixed(2)}) > enemy side (${theirs.toFixed(2)}) / across the map (${far.toFixed(2)})`);
  }

  section("AI roles (roles/hill.js on a stub ctx)");
  {
    const writes = new Map();
    const mkCtx = (hill, zones, opts) => {
      const bots = [];
      for (let i = 1; i <= 4; i++) bots.push({ actor: { actorId: i, team: 0 }, body: { id: i, pos: [i * 3, 0, 30], archetype: "rifleman" }, rec: { route: null, routeAt: -9, holdUntil: -9, role: null } });
      writes.clear();
      const api = {
        REASONS: OBJ.REASONS, hdist: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]), navDist: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]),
        buildRoute: () => null, followRoute: () => null, routeCost: () => null, engagedNow: () => false, latched: () => false,
        write: (rec, body, f) => writes.set(body.id, f),
      };
      return { m: { state: { mode: { hill, zones } }, phase: (opts && opts.phase) || "live", clusters: fx.clusters, posOf: () => null },
        t: 100, api, bots, human: null, team: 0, sit: { us: (opts && opts.us) || 0, them: (opts && opts.them) || 0 }, posture: "balanced", latchS: { route: 5 } };
    };
    const zLive = { id: "hill", label: "1", pos: [0, 0, 0], r: 4, owner: -1 };
    const zNext = { id: "hill_next", label: "2", pos: [0, 0, 20], r: 4, preview: true };
    const R = OBJ.REASONS;
    const reasons = () => [...writes.values()].map((f) => f.reason);
    ROLES.assign(mkCtx({ holder: -1, contested: false, previewOn: false, timeLeftS: 40 }, [zLive]));
    ok(reasons().every((r) => r === R.HILL_CAPTURE) && writes.size === 4, "not ours, no preview → all four capture");
    ROLES.assign(mkCtx({ holder: 0, contested: false, previewOn: false, timeLeftS: 40 }, [zLive], { us: 20, them: 10 }));
    ok(reasons().filter((r) => r === R.HILL_HOLD).length === 3 && reasons().filter((r) => r === R.HILL_ANCHOR).length === 1, "ours + ahead → three hold, one anchors the enemy approach");
    ROLES.assign(mkCtx({ holder: 0, contested: false, previewOn: true, timeLeftS: 8 }, [zLive, zNext], { us: 20, them: 10 }));
    ok(reasons().filter((r) => r === R.HILL_ROTATE).length === 1, "preview window, ours → one rotates early to the next site");
    ROLES.assign(mkCtx({ holder: 1, contested: false, previewOn: true, timeLeftS: 6 }, [zLive, zNext]));
    ok(reasons().filter((r) => r === R.HILL_ROTATE).length >= 3, "theirs with 6 s left → most of us get ahead to the next site");
    ROLES.assign(mkCtx({ holder: 0, contested: false, previewOn: false, timeLeftS: 40 }, [zLive], { phase: "overtime", us: 5, them: 5 }));
    ok(reasons().every((r) => r === R.HILL_HOLD), "overtime → no anchor, everyone on the hill");
    const allIn = [...writes.values()].every((f) => Math.hypot(f.anchor[0], f.anchor[2]) <= 4);
    ok(allIn, "hill orders put feet inside the ring (spread spots)");
    ok(Object.values(R).includes("HILL_ANCHOR") && Object.isFrozen(R), "HILL_* reasons are in the frozen closed vocabulary");
  }

  section("REAL driver + sim + spawn director + bot AI (flat fixture)");
  MATCH.registerMode("hill", MODE.createMode);
  const rules = { scoreLimit: 80, timeLimitS: 150, respawnS: 1.5, protectS: 0.5, rotateS: 30, previewS: 8 };
  function run(seed, content) {
    const events = []; let simRef = null;
    const sim = S.createSim({
      content, colliders: flatColliders(), weapons: WD.WEAPONS, seed, mode: "hill", tuning: "pvp",
      matchOpts: { spawnDirectorFactory: SP.makeSpawns },
      emit: (type, data) => {
        if (type === "respawn" && simRef && simRef.state.match && simRef.state.match.phase !== "warmup") {
          const z = simRef.state.match.mode.zones[0];
          events.push({ type: "spawnCheck", data: { bad: Math.hypot(data.pos[0] - z.pos[0], data.pos[2] - z.pos[2]) < 16 } });
        }
        events.push({ type, data, t: simRef ? simRef.state.time : 0 });
      },
    });
    simRef = sim;
    sim.mission.start(sim);
    const M = sim.state.match; let ticks = 0;
    while (M.phase !== "ended" && ticks < 60 * 420) { sim.step(null); ticks++; }
    return { sim, M, events, ticks };
  }
  const content = fixture(live.archetypes, rules);
  const r1 = run(7, content);
  {
    const { sim, M, events } = r1;
    const held = [0, 0]; for (const e of events) if (e.type === "hill" && e.data.state === "held") held[e.data.team]++;
    const checks = events.filter((e) => e.type === "spawnCheck"), bad = checks.filter((e) => e.data.bad).length;
    const roles = new Set(); for (const e of events) if (e.type === "objrole") roles.add(e.data.reason);
    ok(M.phase === "ended", `a bot-only OUTPOST match terminates (${sim.state.time.toFixed(1)} s, ${M.result.reason}, ${M.teams[0].score}:${M.teams[1].score})`);
    ok(held[0] > 0 && held[1] > 0, `both teams take the hill (AMBER ${held[0]}, SLATE ${held[1]} holds)`);
    ok(!sim.match._ms.watchdogFired && sim.match._ms.oobDeaths === 0, "watchdog + OOB backstop silent");
    ok(checks.length > 5 && bad === 0, `no live respawn within 16 m of the live hill (${checks.length} respawns, ${bad} violations)`);
    ok(["HILL_CAPTURE", "HILL_HOLD", "HILL_ROTATE"].every((r) => roles.has(r)), `the commander issued hill roles (${[...roles].filter((r) => r.startsWith("HILL")).join(",")})`);
    const hs = events.filter((e) => e.type === "match:score" && e.data.reason === "hill" && e.data.actorId == null).reduce((s, e) => s + e.data.points, 0);
    ok(hs === M.teams[0].score + M.teams[1].score, "team score is ONLY hill points; kills never touch it");
    ok(events.filter((e) => e.type === "hill" && e.data.state === "active").length >= 3, "the hill rotated through the match");
  }
  {
    const c2 = fixture(live.archetypes, Object.assign({}, rules, { timeLimitS: 6, scoreLimit: 999 }));
    let ot = false;
    const events = [];
    const sim = S.createSim({ content: c2, colliders: flatColliders(), weapons: WD.WEAPONS, seed: 3, mode: "hill", tuning: "pvp",
      matchOpts: { spawnDirectorFactory: SP.makeSpawns }, emit: (t, d) => events.push(t) });
    sim.mission.start(sim);
    const M = sim.state.match; let k = 0;
    while (M.phase !== "ended" && k++ < 60 * 120) {
      if (M.phase === "overtime") ot = true;
      let i = 0;
      for (const b of sim.state.bots) {
        if (!b.alive) continue;
        if (ot && b.team === 0 && i === 0) { sim.teleport(b.id, 0.5, 0, 0.5); i++; continue; }
        sim.teleport(b.id, b.team === 0 ? -60 + i * 3 : 60 - i * 3, 0, b.team === 0 ? 60 : -60); i++;
        if (b.weapon) { b.weapon.mag = 0; b.weapon.reserve = 0; }
      }
      sim.teleport("P", -70, 0, 70);
      sim.step(null);
    }
    ok(ot && M.result && M.result.reason === "overtime lead" && M.result.winnerTeam === 0, `0-0 at the horn → overtime → the first point wins (${M.result && M.result.reason})`);
  }

  section("determinism");
  {
    const h = (r) => djb2(JSON.stringify({ e: r.events.filter((e) => e.type === "hill").map((e) => [e.data.state, e.data.team, Math.round(e.t * 60)]), s: r.M.teams.map((t) => t.score), a: r.M.actors.map((a) => [a.kills, a.deaths, a.score]), n: r.ticks }));
    const r2 = run(7, content);
    ok(h(r1) === h(r2), `same seed twice → identical (${h(r1)} / ${h(r2)})`);
    ok(h(run(8, content)) !== h(r1), "a different seed plays a different match");
  }
  console.log(`\n${failed === 0 ? "GREEN" : "RED"} — hill.selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
