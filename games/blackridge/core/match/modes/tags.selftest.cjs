#!/usr/bin/env node
/* core/match/modes/tags.selftest.cjs [lane modes] — MODE: RECLAIM battery.
 *
 * Run: node core/match/modes/tags.selftest.cjs   → exit 0 on green.
 *  1. interface + purity + registry (borrowed tdm set) + the LIVE contract gate
 *  2. rules on a mock facade: a death drops a tag at the body; an enemy
 *     collecting it CONFIRMS (+1 team, +50 personal), a teammate DENIES it
 *     (+50, no team point); kills never score; tags expire at 30 s; arming
 *     delay; the bound (oldest expires); warm-up drops nothing; events
 *  3. win + overtime: limit / tie / horn / overtime next confirm /
 *     elimination / cap tie-break (kills → denies → draw)
 *  4. AI role unit (roles/tags.js on a stub ctx): the nearest free bot fetches
 *     an enemy tag (TAG_CONFIRM) or ours (TAG_DENY); one fetcher per tag; a
 *     bait tag (2 own deaths near it) is skipped unless underfoot; a tag that
 *     expires before arrival is skipped; an engaged bot is not pulled off its
 *     fight for a far tag
 *  5. REAL driver + sim + spawn director + bot AI (flat fixture): terminates,
 *     both teams confirm AND deny, team score == confirms, watchdog/OOB silent
 *  6. determinism
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
function fixture(arch, rules) {
  const spawnPoints = [];
  const row = (cluster, team, cz, n, x0, step) => { for (let i = 0; i < n; i++) spawnPoints.push({ id: `${cluster.toLowerCase()}_${i}`, cluster, pos: [x0 + (i % 11) * step, 0, cz + Math.floor(i / 11) * 4], yaw: team === 0 ? Math.PI : 0, cover: 0.5, modes: ["tdm", "ctf", "ffa"] }); };
  row("SC_A", 0, 22, 18, -30, 6); row("SC_A2", 0, 14, 6, -15, 6); row("SC_B", 1, -26, 18, -30, 6); row("SC_B2", 1, -18, 6, -15, 6);
  return {
    version: 2, arena: { id: "flat_fixture", bounds: { min: [-79, -2, -79], max: [79, 20, 79] }, outOfBounds: { graceS: 5 } },
    teams: [{ id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a", side: "west" }, { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b", side: "east" }],
    botRoster: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => ({ slot: s, archetype: ["cqb", "rifleman", "rifleman", "marksman"][s % 4] })),
    clusters: { SC_A: { anchor: [0, 0, 24], team: 0, side: "west" }, SC_A2: { anchor: [0, 0, 14], team: 0, side: "west" }, SC_B: { anchor: [0, 0, -28], team: 1, side: "east" }, SC_B2: { anchor: [0, 0, -18], team: 1, side: "east" } },
    spawnPoints,
    flags: [{ id: "flag_amber", team: 0, home: [0, 0, 40], standR: 1.2, standH: 2.5 }, { id: "flag_slate", team: 1, home: [0, 0, -40], standR: 1.2, standH: 2.5 }],
    modes: { tdm: { scoreLimit: 4, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ctf: { captureLimit: 3, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, ffa: { scoreLimit: 4, timeLimitS: 30, respawnS: 1, protectS: 0.5 }, tags: rules || {} },
    archetypes: arch, pickups: [], scenarios: {},
  };
}
function mock(MODE, rules) {
  const actors = [];
  for (let i = 0; i < 10; i++) actors.push({ actorId: i, team: i < 5 ? 0 : 1, who: i === 0 ? "P" : "b" + i, kind: i === 0 ? "human" : "bot", alive: true, score: 0, kills: 0, deaths: 0, assists: 0, protectedUntilT: -1, _p: [60 + i, 0, 60] });
  const events = [];
  const m = {
    time: 0, phase: "live", timeLeft: 300, rules: Object.assign({ scoreLimit: 40, timeLimitS: 600 }, rules || {}),
    state: { teams: [{ id: 0, score: 0 }, { id: 1, score: 0 }], mode: {} }, actors,
    posOf: (a) => a._p, emit: (type, data) => events.push({ type, data, t: m.time }),
    addScore: (a, p) => { a.score += p; }, addTeamScore: (t, p) => { m.state.teams[t].score += p; }, cancelProtection: (a) => { a.protectedUntilT = -1; },
  };
  const mode = MODE.createMode({ content: {} });
  mode.start(m);
  const step = (n) => { for (let i = 0; i < n; i++) { m.time += DT; mode.tick(m, DT); } };
  const die = (id, pos, killer) => { const a = actors[id]; a.alive = false; a._p = [99, 0, 99]; mode.onDeath(m, { actor: a, attacker: killer != null ? actors[killer] : null, pos: pos.slice(), t: m.time }); };
  return { m, mode, actors, events, step, die, st: mode._st };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const CONTRACT = await import(u("core/match/contract.js"));
  const MODE = await import(u("core/match/modes/tags.js"));
  const ROLES = await import(u("core/ai/roles/tags.js"));
  const OBJ = await import(u("core/ai/objective.js"));
  const SP = await import(u("core/match/spawns.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const live = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));

  section("interface + purity + registry + contract");
  {
    const mode = MODE.createMode({ content: {} });
    ok(mode.id === "tags" && mode.displayName === "RECLAIM" && mode.teamCount === 2, "id 'tags', RECLAIM, 5v5");
    ok(mode.defaults.scoreLimit === 40 && mode.defaults.tagTtlS === 30 && mode.defaults.timeLimitS === 600, "defaults 40 confirms / 10:00 / tags last 30 s");
    const src = fs.readFileSync(path.join(GAME_DIR, "core/match/modes/tags.js"), "utf8");
    ok(!src.includes("THREE.") && !src.includes("Math.random") && !src.includes("Date.now"), "THREE-free, no wall clock / unseeded rng");
    ok(MATCH.MODE_IDS.includes("tags") && CONTRACT.pointSetOf("tags") === "tdm", "registered; spawns on the borrowed tdm set");
    ok(CONTRACT.validateMatchContent(live, { modeIds: MATCH.MODE_IDS }).ok, "LIVE content.json passes the contract gate");
  }

  section("rules (mock facade)");
  {
    const T = mock(MODE);
    T.die(6, [5, 0, 5], 1);
    ok(T.st.tags.length === 1 && T.st.tags[0].team === 1 && T.st.tags[0].pos[0] === 5 && T.events.some((e) => e.type === "tag" && e.data.state === "dropped" && e.data.byWho === "b1"),
      "a death drops the victim's tag at the body ('dropped', by = the killer)");
    ok(T.m.state.teams[0].score === 0, "the kill itself scores nothing for the team");
    T.actors[2]._p = [5.5, 0, 5]; T.step(5);
    ok(T.st.tags.length === 1, "not collectable inside the arming delay");
    T.step(30);
    ok(T.st.tags.length === 0 && T.m.state.teams[0].score === 1 && T.actors[2].score === 50 && T.actors[2].confirms === 1, "an ENEMY walks over it → CONFIRMED: +1 team, +50 personal");
    T.die(3, [-5, 0, -5], 7); T.actors[4]._p = [-5, 0, -4]; T.step(30);
    ok(T.m.state.teams[1].score === 0 && T.m.state.teams[0].score === 1 && T.actors[4].denies === 1 && T.actors[4].score === 50, "a TEAMMATE walks over it → DENIED: +50, no team point");
    T.actors[3].alive = true;
    T.die(8, [20, 0, 20], null); T.step(Math.round(30 * 60) + 2);
    ok(T.st.tags.length === 0 && T.events.some((e) => e.type === "tag" && e.data.state === "expired"), "nobody reaches it → it EXPIRES at 30 s");
    T.actors[8].alive = true;
    const seq = T.events.filter((e) => e.type === "tag").map((e) => e.data.state).join(",");
    ok(seq === "dropped,confirmed,dropped,denied,dropped,expired", `event order: ${seq}`);
  }
  {
    const T = mock(MODE, { maxTags: 3 });
    for (let i = 0; i < 4; i++) { T.die(5 + i, [30 + i * 3, 0, 30], null); T.actors[5 + i].alive = true; }
    ok(T.st.tags.length === 3 && T.st.tags[0].pos[0] === 33, "bounded list: the oldest tag expires first");
    T.m.phase = "warmup"; T.die(9, [0, 0, 0], null);
    ok(T.st.tags.length === 3, "warm-up deaths drop nothing");
  }

  section("win + overtime");
  {
    const T = mock(MODE); const tm = T.m.state.teams;
    tm[0].score = 40; tm[1].score = 39; ok(T.mode.checkWin(T.m).reason === "score limit", "limit → win");
    tm[1].score = 40; ok(T.mode.checkWin(T.m).result === "draw", "equal at the limit → draw");
    tm[0].score = 10; tm[1].score = 12; T.m.timeLeft = 0; ok(T.mode.checkWin(T.m).winnerTeam === 1, "horn: higher wins");
    tm[0].score = 12; ok(T.mode.checkWin(T.m) === null, "tie → overtime");
    T.m.phase = "overtime"; T.m.timeLeft = 90;
    tm[1].score = 13; ok(T.mode.checkWin(T.m).reason === "overtime lead", "overtime: the next confirm wins it");
    tm[1].score = 12; for (const a of T.actors) if (a.team === 0) a.alive = false;
    ok(T.mode.checkWin(T.m).reason === "overtime elimination" && T.mode.checkWin(T.m).winnerTeam === 1, "overtime: no respawns, a wiped side loses");
    for (const a of T.actors) a.alive = true; T.m.timeLeft = DT;
    T.actors[6].kills = 2; ok(T.mode.checkWin(T.m).reason === "overtime (kills)", "cap: kills");
    T.actors[6].kills = 0; T.st.denies[0] = 1; ok(T.mode.checkWin(T.m).reason === "overtime (denies)", "…then denies");
    T.st.denies[0] = 0; ok(T.mode.checkWin(T.m) === null, "…then the driver's draw");
  }

  section("AI roles (roles/tags.js on a stub ctx)");
  {
    const writes = new Map();
    const mkCtx = (tags, o) => {
      o = o || {};
      const bots = [];
      const P = [[0, 0, 0], [10, 0, 0], [-10, 0, 0], [0, 0, 30]];
      for (let i = 0; i < 4; i++) bots.push({ actor: { actorId: i + 1, team: 0 }, body: { id: i + 1, pos: P[i].slice(), archetype: "rifleman", percept: null }, rec: { route: null, routeAt: -9, _tagId: null } });
      writes.clear();
      const api = {
        REASONS: OBJ.REASONS, hdist: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]), navDist: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]),
        engagedNow: (b) => !!(o.engaged && o.engaged.includes(b.id)), deathRing: o.deaths || [],
        comms: { contactWeightNear: () => 0 }, write: (rec, body, f) => writes.set(body.id, f),
      };
      return { m: { state: { mode: { tags } } }, t: 10, api, bots, team: 0, gid: "t0", speeds: { walk: 4.6 }, posture: "balanced" };
    };
    // the tdm base needs the real lane graph: unit-test the fetch overlay alone
    const R = OBJ.REASONS;
    const call = (tags, o) => { const c = mkCtx(tags, o); ROLES._overlay(c); return writes; };
    let w = call([{ id: 1, team: 1, pos: [12, 0, 2], expiresT: 30 }]);
    ok(w.size === 1 && w.get(2) && w.get(2).reason === R.TAG_CONFIRM, "enemy tag → the NEAREST free bot fetches it (TAG_CONFIRM)");
    w = call([{ id: 2, team: 0, pos: [-11, 0, 1], expiresT: 30 }]);
    ok(w.size === 1 && w.get(3) && w.get(3).reason === R.TAG_DENY, "our tag → TAG_DENY by the nearest");
    w = call([{ id: 3, team: 1, pos: [5, 0, 0], expiresT: 30 }, { id: 4, team: 1, pos: [5, 0, 1], expiresT: 30 }]);
    ok(w.size === 2 && new Set([...w.values()].map((f) => f.anchor[2])).size === 2, "one fetcher per tag (two tags → two different bots)");
    const deaths = [{ team: 0, pos: [20, 0, 0], t: 8 }, { team: 0, pos: [21, 0, 1], t: 9 }];
    w = call([{ id: 5, team: 1, pos: [20, 0, 0], expiresT: 30 }], { deaths });
    ok(w.size === 0, "bait: two of us died at the tag in the last 12 s → skipped");
    w = call([{ id: 6, team: 1, pos: [12, 0, 1], expiresT: 30 }], { deaths: [{ team: 0, pos: [12, 0, 1], t: 9 }, { team: 0, pos: [12, 0, 0], t: 9 }] });
    ok(w.size === 1, "…unless it is underfoot (2 m away)");
    w = call([{ id: 7, team: 1, pos: [0, 0, 22], expiresT: 11 }]);
    ok(w.size === 0, "a tag that expires before we can walk there → skipped");
    w = call([{ id: 8, team: 1, pos: [0, 0, 12], expiresT: 30 }], { engaged: [1, 2, 3, 4] });
    ok(w.size === 0, "everyone in a fight and the tag is not underfoot → nobody is pulled off");
  }

  section("REAL driver + sim + spawn director + bot AI (flat fixture)");
  MATCH.registerMode("tags", MODE.createMode);
  const rules = { scoreLimit: 12, timeLimitS: 180, respawnS: 1.5, protectS: 0.5 };
  function run(seed, content) {
    const events = []; let simRef = null;
    const sim = S.createSim({ content, colliders: flatColliders(), weapons: WD.WEAPONS, seed, mode: "tags", tuning: "pvp",
      matchOpts: { spawnDirectorFactory: SP.makeSpawns }, emit: (type, data) => events.push({ type, data, t: simRef ? simRef.state.time : 0 }) });
    simRef = sim; sim.mission.start(sim);
    const M = sim.state.match; let ticks = 0;
    while (M.phase !== "ended" && ticks < 60 * 420) { sim.step(null); ticks++; }
    return { sim, M, events, ticks };
  }
  const content = fixture(live.archetypes, rules);
  const r1 = run(7, content);
  {
    const { sim, M, events } = r1;
    const c = [0, 0], d = [0, 0];
    for (const e of events) if (e.type === "tag") { if (e.data.state === "confirmed") c[e.data.byTeam]++; if (e.data.state === "denied") d[e.data.byTeam]++; }
    ok(M.phase === "ended", `a bot-only RECLAIM match terminates (${sim.state.time.toFixed(1)} s, ${M.result.reason}, ${M.teams[0].score}:${M.teams[1].score})`);
    ok(c[0] > 0 && c[1] > 0, `both teams confirm (AMBER ${c[0]}, SLATE ${c[1]})`);
    ok(d[0] + d[1] > 0, `tags get denied (${d[0]} / ${d[1]})`);
    ok(M.teams[0].score === c[0] && M.teams[1].score === c[1], "team score == confirms exactly");
    ok(!sim.match._ms.watchdogFired && sim.match._ms.oobDeaths === 0, "watchdog + OOB silent");
    const roles = new Set(); for (const e of events) if (e.type === "objrole") roles.add(e.data.reason);
    ok(roles.has("TAG_CONFIRM") && roles.has("TAG_DENY"), "the commander issued TAG_CONFIRM and TAG_DENY");
  }

  section("determinism");
  {
    const h = (r) => djb2(JSON.stringify({ e: r.events.filter((e) => e.type === "tag").map((e) => [e.data.state, e.data.id, Math.round(e.t * 60)]), s: r.M.teams.map((t) => t.score), n: r.ticks }));
    ok(h(r1) === h(run(7, content)), "same seed twice → identical tag log + scores");
    ok(h(run(8, content)) !== h(r1), "a different seed plays a different match");
  }
  console.log(`\n${failed === 0 ? "GREEN" : "RED"} — tags.selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
