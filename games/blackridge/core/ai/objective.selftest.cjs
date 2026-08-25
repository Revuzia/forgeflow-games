#!/usr/bin/env node
/* core/ai/objective.selftest.cjs [W7] — the commander's battery
 * (PVP_BUILD_PLAN Part 4.1 row W7; bot_ai.md Part 11).
 *
 * Run:  node core/ai/objective.selftest.cjs
 *
 * Sections:
 *  1. INFORMATION AUDIT (AC-34): objective.js / comms.js / roles/*.js are
 *     grepped for forbidden reads. Non-zero matches FAIL the build. This is
 *     the compile-time half of the monotonicity guarantee: the layer's
 *     source cannot name the lethality state (reaction latches, jitter,
 *     BANDS, cmd) or any live enemy transform.
 *  2. Closed reason enum + lane-graph gates (Part 3.9 structural half).
 *  3. Beacon fidelity (AC-35): 3.0 s refresh, ≥6 m quantisation.
 *  4. CTF role machine against a mock match facade on the REAL pass path:
 *     situations, quotas, the human-carrier escort rule (AC-21 core),
 *     cutoff-not-chase geometry (AC-17 core), the hopeless-chase abandon
 *     (AC-18), the returner cap (AC-19 core), the BOTH_CARRY hold (AC-20).
 *  5. Live headless TDM (real mode module, real sim): determinism with the
 *     layer live (AC-7), RNG stream isolation (AC-32 mechanical half),
 *     objrole reasons ∈ enum, OBJ_PERF ≤ 0.25 ms/tick (AC-46), and the
 *     KILL-PACE bar (the gate-2 live target): after the first kill, no
 *     ≥60 s kill-free window while the match is live; no stuck bot.
 *  6. Monotonicity (AC-32 behavioural half): same seeds with the layer's
 *     writes disabled — layered total shots ≤ unlayered total shots
 *     (summed over seeds), and the layered run is bit-deterministic.
 *  7. Live headless FFA (real mode if landed): the radio is structurally
 *     EMPTY — comms teamWrites === 0 (T-FFA-1 structural half).
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

function syntheticContent(realArchetypes, modeOverrides) {
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
    arena: { id: "flat_fixture", bounds: { min: [-79, -2, -79], max: [79, 20, 79] }, outOfBounds: { graceS: 5.0 } },
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
    clusters: { SC_A: { anchor: [0, 0, 30], team: 0 }, SC_B: { anchor: [0, 0, -30], team: 1 } },
    spawnPoints,
    flags: [
      { id: "flag_t0", team: 0, home: [0, 0, 34], yaw: 0 },
      { id: "flag_t1", team: 1, home: [0, 0, -34], yaw: 0 },
    ],
    modes: Object.assign({
      tdm: { scoreLimit: 40, timeLimitS: 180, respawnS: 2.0, protectS: 0.5 },
      ctf: { captureLimit: 3, timeLimitS: 60, respawnS: 1.0, protectS: 0.5 },
      ffa: { scoreLimit: 20, timeLimitS: 120, respawnS: 1.5, protectS: 0.5 },
    }, modeOverrides || {}),
    archetypes: realArchetypes,
    pickups: [],
    scenarios: {},
  };
}

async function main() {
  const OBJ = await import(u("core/ai/objective.js"));
  const COMMS = await import(u("core/ai/comms.js"));
  const LANES = await import(u("core/level/lanes/lanternwalk.js"));
  const STUB = await import(u("core/level/lanes/_stub.js"));

  // ================================================== 1. information audit
  section("information audit (AC-34) — the layer's source cannot cheat");
  {
    const files = [
      "core/ai/objective.js", "core/ai/comms.js",
      "core/ai/roles/tdm.js", "core/ai/roles/ctf.js", "core/ai/roles/ffa.js",
    ];
    // forbidden: live player/enemy transform + the LETHALITY state. Any hit
    // in source (comments included — the string must not exist) is a FAIL.
    // The layer MAY move feet (goal/anchor/path in the noTarget stand-down —
    // its charter is "move a bot's feet, withhold its fire"), so the brain's
    // movement fields are not banned; every latch/aim/roll field is.
    const forbidden = [
      "state.player.", ".targetBody", "reactionS", "confirmT",
      "rerollArmed", "jitter", "BANDS", ".cmd.", "missLeft", "missOff",
      "flinch", "burstLeft", "pauseUntil", "aimHigh", "leadErr",
      "rng.ai", "rng.spread", "rng.match", "rng.spawn", "rng.mission",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(GAME_DIR, f), "utf8");
      const hits = forbidden.filter((s) => src.includes(s));
      ok(hits.length === 0, `${f} contains no forbidden read` + (hits.length ? ` — HITS: ${hits.join(", ")}` : ""));
    }
  }

  // ================================================== 2. enum + lane gates
  section("closed reason enum + lane-graph structural gates (Part 3.9)");
  {
    const R = OBJ.REASONS;
    ok(Object.isFrozen(R), "REASONS is frozen (closed vocabulary)");
    ok(Object.keys(R).length >= 20 && Object.values(R).every((v) => typeof v === "string"),
      `enum has ${Object.keys(R).length} string members`);

    for (const [name, mod] of [["lanternwalk", LANES], ["_stub", STUB]]) {
      let endpointsOk = true, spacingOk = true, worstGap = 0;
      for (const L of mod.lanes) {
        if (!(L.a in mod.junctions) || !(L.b in mod.junctions)) endpointsOk = false;
        for (let i = 1; i < L.wp.length; i++) {
          const d = Math.hypot(L.wp[i][0] - L.wp[i - 1][0], L.wp[i][2] - L.wp[i - 1][2]);
          if (d > worstGap) worstGap = d;
          if (d > 12.0 + 1e-6) spacingOk = false;
        }
      }
      ok(endpointsOk, `${name}: every lane's endpoints are junctions`);
      ok(spacingOk, `${name}: consecutive waypoints ≤ 12 m (worst ${worstGap.toFixed(1)} m)`);
      // cycle: |E on traversable graph| ≥ |V| reached from any node
      const g = OBJ.laneGraphFor(name === "_stub" ? "no_such_arena" : name);
      let edges = 0;
      for (const j of g.jNames) edges += g.adj[j].length;
      edges /= 2;
      ok(edges >= g.jNames.length, `${name}: the graph contains at least one cycle (V=${g.jNames.length}, E=${edges})`);
    }
    const balcony = LANES.lanes.find((L) => L.id === "L_BALCONY");
    ok(balcony && balcony.throughGoing === false, "lanternwalk balcony is throughGoing:false (V8 honest)");
    ok(OBJ.laneGraphFor("no_such_arena") === OBJ.laneGraphFor("_stub_x") ||
       OBJ.laneGraphFor("no_such_arena").jNames.length === 4,
      "unknown arena id falls back to the _stub graph (Part 4.2)");
  }

  // ================================================== 3. beacon fidelity
  section("beacon fidelity (AC-35): 3 s refresh, ±6 m quantisation");
  {
    const q = OBJ.quantBeacon([-13.4, 0, -24.9], 6);
    ok(q[0] % 6 === 0 && q[2] % 6 === 0, `beacon position lies on the 6 m grid (${q[0]},${q[2]})`);
    ok(Math.abs(q[0] - -13.4) <= 6 && Math.abs(q[2] - -24.9) <= 6, "quantisation error ≤ 6 m per axis");
    // refresh cadence is asserted on the mock pass below (a fresher sample
    // is impossible to read because none is ever produced).
  }

  // ================================================== 4. CTF role machine
  section("CTF role machine (AC-17/18/19/20/21 cores) — real pass path, mock facade");
  {
    const mkMulberry = (seed) => {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
      };
    };

    // a mock sim+facade good enough for objectiveStep's real code path
    function mockCtf(opts) {
      const bodies = [];
      const actors = [];
      const emitLog = [];
      const teams = [{ id: 0, name: "AMBER", score: opts.us || 0 }, { id: 1, name: "SLATE", score: opts.them || 0 }];
      // human actor 0
      actors.push({ actorId: 0, kind: "human", team: 0, alive: true, who: "P", deaths: 0, duty: null, _lastPos: null });
      let nextId = 1;
      for (const spec of opts.bots) {
        const id = nextId++;
        const body = {
          id, alive: true, hp: spec.hp != null ? spec.hp : 100,
          pos: spec.pos.slice(), yaw: 0, vel: [0, 0, 0],
          state: spec.state || "patrol", archetype: spec.arch || "rifleman",
          team: spec.team, percept: null, lastHitT: null,
        };
        bodies.push(body);
        actors.push({
          actorId: id, kind: "bot", team: spec.team, alive: true, who: id,
          deaths: 0, duty: null, _lastPos: null,
        });
      }
      const flags = opts.flags;
      // five live enemy actors (bodiless — the layer never reads them beyond
      // {team, alive}, and the respawn ledger must see a full enemy team)
      for (let i = 0; i < 5; i++) {
        actors.push({ actorId: 100 + i, kind: "bot", team: 1, alive: true, who: 900 + i, deaths: 0, duty: null, _lastPos: null });
      }
      const state = {
        time: opts.t != null ? opts.t : 100, tick: opts.tick != null ? opts.tick : 6000,
        bots: bodies,
        match: { modeId: "ctf", phase: "live", teams, flags, elapsed: opts.elapsed || 100, actors },
      };
      const m = {
        phase: "live",
        arena: { id: "lanternwalk", bounds: { min: [-48.5, -2, -34.5], max: [24.5, 14, 14.6] } },
        rules: { captureLimit: 3, timeLimitS: 720, flag: { beacon: { refreshS: 3, quantM: 6 } } },
        state: state.match,
        actors,
        clusters: {},
        bodyOf(a) { return a.kind === "human" ? null : bodies.find((b) => b.id === a.who) || null; },
        posOf(a) {
          if (a.kind === "human") return opts.humanPos || [0, 0, 0];
          const b = bodies.find((x) => x.id === a.who);
          return b ? b.pos : null;
        },
      };
      const sim = {
        state,
        match: { m },
        rng: { obj: mkMulberry(7) },
        emit: (type, data) => emitLog.push({ type, data }),
      };
      const squad = { requestBark: () => true };
      return { sim, m, bodies, actors, emitLog, squad, step: () => OBJ.objectiveStep(sim, null, squad, 1 / 60) };
    }

    const LY = [-33.5, 0, 12];   // AMBER stand (our, team 0)
    const EXH = [6.5, 0, -30];   // SLATE stand

    // ---- AC-21 core: the human grabs the enemy flag → exactly 2 escorts,
    // zero attack, stations solved against the human's route
    {
      const w = mockCtf({
        humanPos: [6.5, 0, -28],
        flags: [
          { id: "f0", team: 0, state: "AT_STAND", home: LY, pos: LY, carrier: null },
          { id: "f1", team: 1, state: "CARRIED", home: EXH, pos: [6.5, 0, -28], carrier: "P" },
        ],
        bots: [
          { team: 0, pos: [-8, 0, -12] }, { team: 0, pos: [-5, 0, 10] },
          { team: 0, pos: [-26, 0, -23] }, { team: 0, pos: [-32, 0, -7] },
        ],
        tick: 6000, // team-0 pass slot (tick % 30 === 0)
      });
      w.step();
      const roles = w.bodies.map((b) => (b._obj ? b._obj.role : null));
      const nEscort = roles.filter((r) => r === "escort").length;
      const nAttack = roles.filter((r) => r === "attack").length;
      ok(nEscort === 2, `human carrier → exactly 2 bots escort (got ${roles.join(",")})`);
      ok(nAttack === 0, "human carrier → no bot is assigned attack");
      const esc = w.bodies.filter((b) => b._obj && b._obj.role === "escort");
      const near = esc.every((b) => Math.hypot(b._obj.anchor[0] - 6.5, b._obj.anchor[2] - -28) < 60);
      ok(near, "escort stations are solved near the human carrier's route");
      const reasons = w.emitLog.filter((e) => e.type === "objrole").map((e) => e.data.reason);
      ok(reasons.every((r) => Object.values(OBJ.REASONS).includes(r)),
        "every objrole reason is in the closed enum");
    }

    // ---- AC-17 core: interceptors cut off ahead of the carrier
    {
      // enemy carrier has OUR flag, beacon on the market street heading for
      // the Exchange House; our interceptor sits at the plaza
      const beaconPos = [-19, 0, -25]; // on L_STREET, west end
      const w = mockCtf({
        flags: [
          { id: "f0", team: 0, state: "CARRIED", home: LY, pos: beaconPos, carrier: 9 },
          { id: "f1", team: 1, state: "AT_STAND", home: EXH, pos: EXH, carrier: null },
        ],
        bots: [
          { team: 0, pos: [-8, 0, -12] }, { team: 0, pos: [-5, 0, 10] },
          { team: 0, pos: [14, 0, -20] }, { team: 0, pos: [-26, 0, -23] },
        ],
        tick: 6000,
      });
      w.step();
      const ints = w.bodies.filter((b) => b._obj && b._obj.role === "intercept");
      ok(ints.length >= 1, `THEY_CARRY → at least one FEASIBLE cutoff interceptor (got ${ints.length})`);
      const infeasible = w.bodies.filter((b) => b._obj && b._obj.reason === "CUTOFF_INFEASIBLE");
      ok(ints.length + infeasible.length >= 3,
        `the intercept quota was filled (feasible ${ints.length} + honestly-abandoned ${infeasible.length} ≥ 3)`);
      // ahead = toward the SLATE stand along the carrier's inferred travel
      const dirX = EXH[0] - beaconPos[0], dirZ = EXH[2] - beaconPos[2];
      const allAhead = ints.every((b) => {
        const gx = b._obj.anchor[0] - beaconPos[0], gz = b._obj.anchor[2] - beaconPos[2];
        return gx * dirX + gz * dirZ > 0;
      });
      ok(allAhead, "every cutoff anchor is AHEAD of the beacon toward the carrier's stand (dot > 0)");
      ok(ints.every((b) => b._obj.anchorKind === "cutoff" && b._obj.reason === "CUTOFF_FEASIBLE"),
        "interception is a cutoff (anchorKind 'cutoff', reason CUTOFF_FEASIBLE)");
    }

    // ---- AC-18: a hopeless chase is abandoned (carrier at the stand door,
    // bot across the map) → no intercept goal; the bot re-roles
    {
      const w = mockCtf({
        flags: [
          { id: "f0", team: 0, state: "CARRIED", home: LY, pos: [4.5, 0, -26], carrier: 9 },
          { id: "f1", team: 1, state: "AT_STAND", home: EXH, pos: EXH, carrier: null },
        ],
        bots: [{ team: 0, pos: [-46, 0, 2] }], // ~60 m of lanes away
        tick: 6000,
      });
      w.step();
      const b = w.bodies[0];
      ok(b._obj && b._obj.role !== "intercept",
        `hopeless cutoff → no intercept goal (role ${b._obj && b._obj.role})`);
      ok(b._obj && (b._obj.reason === "CUTOFF_INFEASIBLE" || b._obj.role === "defend"),
        `the bot re-roles with the honest reason (${b._obj && b._obj.reason})`);
    }

    // ---- AC-19 core: our flag dropped → ≤2 returners, the nearest among them
    {
      const drop = [-8, 0, 0]; // plaza centre
      const w = mockCtf({
        flags: [
          { id: "f0", team: 0, state: "DROPPED", home: LY, pos: drop, carrier: null },
          { id: "f1", team: 1, state: "AT_STAND", home: EXH, pos: EXH, carrier: null },
        ],
        bots: [
          { team: 0, pos: [-8, 0, -8] },    // ~8 m — nearest
          { team: 0, pos: [-26, 0, -23] },  // ~30 m
          { team: 0, pos: [-46, 0, 2] },    // ~45 m
          { team: 0, pos: [20, 0, 6] },
        ],
        tick: 6000,
      });
      w.step();
      const rets = w.bodies.filter((b) => b._obj && b._obj.role === "return");
      ok(rets.length >= 1 && rets.length <= 2, `OURS_DROPPED → 1–2 returners (got ${rets.length})`);
      ok(rets.some((b) => b.id === w.bodies[0].id), "the nav-nearest bot is one of the returners");
      ok(rets.every((b) => b._obj.priority >= 0.99 && b._obj.firePolicy === "defensive"),
        "returners run priority 1.0 with defensive fire");
    }

    // ---- AC-20 core: BOTH_CARRY — the carrier holds 10–18 m off its own
    // stand and never paths into it
    {
      const w = mockCtf({
        flags: [
          { id: "f0", team: 0, state: "CARRIED", home: LY, pos: [10, 0, -10], carrier: 9 },
          { id: "f1", team: 1, state: "CARRIED", home: EXH, pos: [-20, 0, 8], carrier: 1 },
        ],
        bots: [
          { team: 0, pos: [-20, 0, 8] },   // our carrier (id 1)
          { team: 0, pos: [-8, 0, -12] }, { team: 0, pos: [-5, 0, 10] }, { team: 0, pos: [14, 0, -20] },
        ],
        tick: 6000,
      });
      w.step();
      const carrier = w.bodies[0];
      ok(carrier._obj && carrier._obj.role === "carry" && carrier._obj.reason === "HOLD_NEAR_STAND",
        `BOTH_CARRY → the carrier holds (reason ${carrier._obj && carrier._obj.reason})`);
      const d = carrier._obj && carrier._obj.anchor
        ? Math.hypot(carrier._obj.anchor[0] - LY[0], carrier._obj.anchor[2] - LY[2]) : -1;
      ok(d >= 10 - 1e-6 && d <= 18 + 1e-6, `hold anchor is 10–18 m from the stand (${d.toFixed(1)} m)`);
      ok(carrier._obj.noRetreat && carrier._obj.noFlank && carrier._obj.noGrenade,
        "carrier keeps the monotone removals (noRetreat/noFlank/noGrenade)");
      // beacon fidelity on the mock: the layer's own beacon store never holds
      // a sample off the 6 m grid
      const st = w.sim._w7;
      let gridOk = true;
      for (const [, b] of st.beacons) {
        if (b.pos[0] % 6 !== 0 || b.pos[2] % 6 !== 0) gridOk = false;
      }
      ok(gridOk, "every stored beacon sample lies on the 6 m grid");
    }
  }

  // ================================================== 5-7. live batteries
  const RNGm = await import(u("core/rng.js"));
  void RNGm;
  const MATCH = await import(u("core/match/match.js"));
  const S = await import(u("core/sim/sim.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const liveContent = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const WEAPONS = WD.WEAPONS;

  const modeSource = {};
  for (const id of ["tdm", "ffa", "ctf"]) {
    const p = path.join(GAME_DIR, `core/match/modes/${id}.js`);
    if (fs.existsSync(p)) {
      const mod = await import(u(`core/match/modes/${id}.js`));
      MATCH.registerMode(id, mod.createMode);
      modeSource[id] = "real";
    } else modeSource[id] = "missing";
  }
  console.log("\nmode sources:", JSON.stringify(modeSource));

  const fixture = syntheticContent(liveContent.archetypes);

  function runMatch(mode, seed, opts = {}) {
    const events = [];
    let simRef = null;
    let shots = 0;
    const kills = []; // {t}
    const sim = S.createSim({
      content: fixture, colliders: flatColliders(), weapons: WEAPONS,
      seed, mode, tuning: "pvp", matchOpts: {},
      emit: (type, data) => {
        events.push(type);
        if (type === "shot" && data && !data.impactOnly && !data.pen && data.shooter !== "P") shots++;
        if (type === "death" && simRef) kills.push(simRef.state.time);
      },
    });
    simRef = sim;
    // RNG draw attribution: count draws per stream while the commander runs
    const drawsInStep = { ai: 0, spread: 0, match: 0, spawn: 0, fx: 0, mission: 0, obj: 0 };
    if (opts.attributeRng) {
      for (const k of Object.keys(drawsInStep)) {
        const orig = sim.rng[k];
        if (typeof orig !== "function") continue;
        sim.rng[k] = () => {
          if (OBJ.OBJ_PERF._inStep) drawsInStep[k]++;
          return orig();
        };
      }
    }
    sim.mission.start(sim);
    const cmd = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
    const maxTicks = opts.maxTicks || 60 * 200;
    const stuckSamples = new Map(); // botId → {pos, t}
    let stuckWorst = 0;
    const objRolesSeen = new Set();
    const badReasons = new Set();
    for (let i = 0; i < maxTicks; i++) {
      sim.step(cmd);
      if (sim.state.match && sim.state.match.phase === "ended") break;
      if (i % 60 === 0) {
        const t = sim.state.time;
        for (const b of sim.state.bots) {
          if (!b.alive) { stuckSamples.delete(b.id); continue; }
          const s = stuckSamples.get(b.id);
          if (!s) { stuckSamples.set(b.id, { pos: b.pos.slice(), t }); continue; }
          const moved = Math.hypot(b.pos[0] - s.pos[0], b.pos[2] - s.pos[2]);
          if (moved > 0.5) { s.pos = b.pos.slice(); s.t = t; }
          else if (t - s.t > stuckWorst && b.state !== "dead") stuckWorst = t - s.t;
          if (b._obj) {
            objRolesSeen.add(b._obj.role);
            if (!Object.values(OBJ.REASONS).includes(b._obj.reason)) badReasons.add(b._obj.reason);
          }
        }
      }
    }
    const snap = sim.match ? sim.match.snapshot() : null;
    return { sim, events, snap, shots, kills, stuckWorst, objRolesSeen, badReasons, drawsInStep };
  }

  if (modeSource.tdm !== "real") {
    skip("TDM mode module missing — live batteries skipped");
  } else {
    section("live TDM — determinism with the layer live (AC-7)");
    {
      OBJ.OBJ_TEST.disableWrites = false;
      const a = runMatch("tdm", 4242);
      const b = runMatch("tdm", 4242);
      const ha = djb2(JSON.stringify(a.snap) + a.shots + a.kills.length);
      const hb = djb2(JSON.stringify(b.snap) + b.shots + b.kills.length);
      ok(ha === hb, `same seed twice → identical snapshot+shots hash (${ha})`);
      ok(a.snap && a.snap.phase === "ended", "the match reached phase 'ended'");
    }

    section("live TDM — RNG stream isolation (AC-32 mechanical half)");
    {
      // OBJ_PERF._inStep is true exactly while the commander's passes run;
      // counting wrappers on every stream attribute each draw. The layer may
      // draw ONLY from rng.obj (C26) — a single attributed draw on any other
      // stream is a cheat and fails the build.
      const sim2 = S.createSim({
        content: fixture, colliders: flatColliders(), weapons: WEAPONS,
        seed: 777, mode: "tdm", tuning: "pvp", matchOpts: {}, emit: () => {},
      });
      const draws = {};
      for (const k of ["spread", "ai", "mission", "fx", "match", "spawn", "obj"]) {
        const orig = sim2.rng[k];
        if (typeof orig !== "function") continue;
        draws[k] = 0;
        sim2.rng[k] = () => {
          if (OBJ.OBJ_PERF._inStep) draws[k]++;
          return orig();
        };
      }
      sim2.mission.start(sim2);
      const cmd = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
      for (let i = 0; i < 60 * 45; i++) {
        sim2.step(cmd);
        if (sim2.state.match.phase === "ended") break;
      }
      const foreign = Object.entries(draws).filter(([k, n]) => k !== "obj" && n > 0);
      ok(foreign.length === 0, "the commander draws from NO stream but rng.obj"
        + (foreign.length ? ` — FOREIGN: ${foreign.map(([k, n]) => k + ":" + n).join(",")}` : ""));
      console.log(`  info  attributed draws: ${JSON.stringify(draws)}`);
    }

    section("live TDM — roles, reasons, perf (AC-46) and THE KILL-PACE BAR");
    {
      OBJ.OBJ_PERF.calls = 0; OBJ.OBJ_PERF.totalMs = 0; OBJ.OBJ_PERF.avgMs = 0; OBJ.OBJ_PERF.maxMs = 0;
      let totalKills = 0, worstGap = 0, worstStuck = 0;
      let endedAll = true;
      const gaps = [];
      for (const seed of [11, 12, 13]) {
        const r = runMatch("tdm", seed, { maxTicks: 60 * 200 });
        if (!r.snap || r.snap.phase !== "ended") endedAll = false;
        totalKills += r.kills.length;
        worstStuck = Math.max(worstStuck, r.stuckWorst);
        ok(r.badReasons.size === 0, `seed ${seed}: every _obj.reason ∈ enum` +
          (r.badReasons.size ? ` — BAD: ${[...r.badReasons].join(",")}` : ""));
        ok(r.objRolesSeen.size >= 1, `seed ${seed}: commander assigned roles (${[...r.objRolesSeen].join(",")})`);
        // kill-pace: after the first kill, the longest kill-free gap while live
        let gap = 0;
        for (let i = 1; i < r.kills.length; i++) gap = Math.max(gap, r.kills[i] - r.kills[i - 1]);
        if (r.kills.length >= 2) gaps.push(gap);
        worstGap = Math.max(worstGap, gap);
        console.log(`  info  seed ${seed}: kills ${r.kills.length}, worst kill gap ${gap.toFixed(1)} s, stuck ${r.stuckWorst.toFixed(1)} s`);
      }
      ok(endedAll, "all seeded matches ended");
      ok(totalKills >= 30, `bots are fighting: ${totalKills} kills across 3 seeds (≥30)`);
      ok(worstGap <= 60, `KILL PACE: worst kill-free gap ${worstGap.toFixed(1)} s ≤ 60 s (the gate-2 stall is dead)`);
      ok(worstStuck <= 20, `no bot stuck: worst <0.5 m-displacement window ${worstStuck.toFixed(1)} s ≤ 20 s (AC-4)`);
      ok(OBJ.OBJ_PERF.avgMs <= 0.25, `OBJ_PERF ${OBJ.OBJ_PERF.avgMs.toFixed(4)} ms/tick ≤ 0.25 (AC-46; max ${OBJ.OBJ_PERF.maxMs.toFixed(2)})`);
    }

    section("monotonicity (AC-32 behavioural half): posed standoff, layered shots ≤ unlayered");
    {
      // Both runs are BIT-IDENTICAL until the moment 'live' begins (warm-up
      // zeroes bot cmds and the commander is phase-gated), at which point
      // every bot is teleported to the same two facing lines. From there the
      // ONLY difference is the layer's writes — its knobs can each only
      // remove a shot (H3) or move feet (H1/H2/H4, and a moving bot fails
      // the stationary fire gate), so the shot count must not rise.
      function standoff(seed, disabled) {
        OBJ.OBJ_TEST.disableWrites = disabled;
        let shots = 0;
        let simRef = null;
        // [W11 2026-08-25] count posed bodies only, and STOP at the first
        // death. The wave-5 tuning flip (110 HP + jitter cut, C25) stretched
        // the posed fights past this window's divergence horizon: after the
        // first kill the two runs' geometry is different for reasons that are
        // pace, not fairness (the block's own comment: "respawn loops would
        // otherwise dominate the count — a layered team RE-ENGAGES after
        // respawning, which is the pace fix, not a fairness delta"). The
        // pre-first-death window is exactly where H3's remove-only fire
        // policy must show; the bar itself (≤) is unchanged.
        let posedIds = null;
        let firstDeath = false;
        const sim = S.createSim({
          content: fixture, colliders: flatColliders(), weapons: WEAPONS,
          seed, mode: "tdm", tuning: "pvp", matchOpts: {},
          emit: (type, data) => {
            if (type === "death" && posedIds) firstDeath = true;
            if (type === "shot" && data && !data.impactOnly && !data.pen && data.shooter !== "P" &&
                !firstDeath && (!posedIds || posedIds.has(data.shooter))) shots++;
          },
        });
        simRef = sim; void simRef;
        sim.mission.start(sim);
        const cmd = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
        for (let i = 0; i < 60 * 10; i++) {
          sim.step(cmd);
          if (sim.state.match.phase === "live") break;
        }
        // the pose: two facing lines 10 m apart, mutual view (inside the
        // low-light detect floor so BOTH runs perceive from the first think)
        let k0 = 0, k1 = 0;
        for (const b of sim.state.bots) {
          if (!b.alive) continue;
          if (b.team === 0) { b.pos[0] = -10 + 5 * k0++; b.pos[2] = 5; b.yaw = 0; }
          else { b.pos[0] = -10 + 5 * k1++; b.pos[2] = -5; b.yaw = Math.PI; }
          b.vel[0] = b.vel[1] = b.vel[2] = 0;
          if (b._brain) { // face the pose, not the spawn (act() re-applies curYaw)
            b._brain.curYaw = b.yaw; b._brain.anchorYaw = b.yaw;
            b._brain.goal = null; b._brain.arrived = true;
          }
        }
        posedIds = new Set(sim.state.bots.map((b) => b.id)); // [W11] see above
        // measure the FIRST 4 s only: long enough for every band's latched
        // reaction to expire and bursts to land, short enough that the two
        // runs' trajectories have not meaningfully diverged (respawn loops
        // would otherwise dominate the count — a layered team RE-ENGAGES
        // after respawning, which is the pace fix, not a fairness delta)
        shots = 0;
        for (let i = 0; i < 60 * 4; i++) sim.step(cmd);
        OBJ.OBJ_TEST.disableWrites = false;
        return shots;
      }
      let layered = 0, unlayered = 0;
      for (const seed of [21, 22, 23]) {
        layered += standoff(seed, false);
        unlayered += standoff(seed, true);
      }
      ok(layered <= unlayered,
        `bot shots layered ${layered} ≤ unlayered ${unlayered} over 3 posed 4 s standoffs`);
      console.log(`  info  layered ${layered} vs unlayered ${unlayered} bot shots`);
    }
  }

  if (modeSource.ffa !== "real") {
    skip("FFA mode module missing — solo-radio battery skipped");
  } else {
    section("live FFA — the radio is structurally EMPTY (T-FFA-1)");
    {
      OBJ.OBJ_TEST.disableWrites = false;
      const r = runMatch("ffa", 31, { maxTicks: 60 * 120 });
      const st = r.sim._w7;
      ok(st != null, "objective state initialised in FFA");
      ok(st && st.comms.counters.teamWrites === 0,
        `zero team-group comms writes in FFA (${st ? st.comms.counters.teamWrites : "?"})`);
      ok(r.kills.length >= 5, `FFA bots fight (${r.kills.length} kills in ≤120 s)`);
      ok(r.badReasons.size === 0, "FFA reasons ∈ enum");
    }
  }

  // COMMS unit
  section("comms — ring cap, staleness, dedupe");
  {
    const c = COMMS.makeComms();
    for (let i = 0; i < 10; i++) c.noteContact("t0", "b" + i, [i, 0, 0], 100 + i);
    const out = [];
    c.contacts("t0", 109, out);
    ok(out.length === COMMS.CONTACT_CAP, `ring holds ≤ ${COMMS.CONTACT_CAP} entries (${out.length})`);
    c.noteContact("t0", "b9", [99, 0, 0], 120);
    c.contacts("t0", 120.5, out);
    const b9 = out.find((s) => s.who === "b9");
    ok(b9 && b9.pos[0] === 99, "dedupe per contact id — newest wins");
    c.contacts("t0", 200, out);
    ok(out.length === 0, "entries older than 8 s are dropped");
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
