#!/usr/bin/env node
/* core/match/spawns.selftest.cjs [W2] — spawn director battery.
 * PVP_BUILD_PLAN Part 4.1 row W2 / Part 5 AC-9..AC-12 (the ladder / stress /
 * cooldown invariants; the live no-spawn-deaths<2s number is matchprobe's).
 *
 * 2000 selections × 20 seeds × 3 modes: a scripted, deterministic pseudo-match
 * per (mode, seed) — 10 actors random-walking the plaza, one kill every 2 s,
 * respawn via director.pick() — with independent (test-side, re-derived)
 * checks of the C7 veto table, the AC-11 reuse rule, the C8 score tables,
 * V10, the trap override, and determinism.
 *
 * Run:  node core/match/spawns.selftest.cjs        → full battery, exit 0/1
 */
"use strict";

const path = require("path");
const { pathToFileURL } = require("url");

const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }
function approx(a, b, eps) { return Math.abs(a - b) <= eps; }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Arena data — the validated 50-point / 7-cluster lanternwalk set from
// arena.md §2.2, with the C7b ruling applied (sp_l1/l2/l3/m7/m8 disabled in
// CTF). W4 owns the shipping copy in content.json; this embedded copy keeps
// the selftest free of cross-lane file dependencies (Part 4.3: lanes depend
// on the CONTRACT, not on each other's code landing).
const ALL3 = ["tdm", "ctf", "ffa"];
const NOCTF = ["tdm", "ffa"];
const FFAONLY = ["ffa"];
function P(id, x, z, yaw, cluster, cover, modes) {
  return { id, pos: [x, 0, z], yaw, cluster, cover, modes: modes || ALL3 };
}
const SPAWN_POINTS = [
  P("sp_w1", -44.5, -28.0, -3.14, "SC_WEST", 0.5), P("sp_w2", -46.5, -24.0, -3.14, "SC_WEST", 0.8),
  P("sp_w3", -43.5, -19.0, -2.36, "SC_WEST", 0.5), P("sp_w4", -46.0, -14.0, 0.00, "SC_WEST", 0.8),
  P("sp_w5", -44.0, -10.0, 0.00, "SC_WEST", 0.8), P("sp_w6", -43.0, -6.0, 0.00, "SC_WEST", 0.8),
  P("sp_w7", -43.5, -3.0, 0.00, "SC_WEST", 0.8), P("sp_w8", -45.5, 6.0, -2.36, "SC_WEST", 0.8),
  P("sp_a1", -36.0, -16.0, -2.75, "SC_ARCADE", 0.8), P("sp_a2", -27.5, -16.5, -3.14, "SC_ARCADE", 0.8),
  P("sp_a3", -28.0, -8.0, -3.14, "SC_ARCADE", 0.7), P("sp_a4", -37.5, -2.0, -0.79, "SC_ARCADE", 0.6),
  P("sp_a5", -33.5, 2.5, 0.00, "SC_ARCADE", 0.7), P("sp_a6", -29.0, 1.5, 0.00, "SC_ARCADE", 0.8),
  P("sp_a7", -32.0, -8.5, -1.18, "SC_ARCADE", 0.2),
  P("sp_l1", -32.0, 12.5, -1.57, "SC_LANTERN", 0.8, NOCTF), // C7b: V8 1.58 m
  P("sp_l2", -39.5, 11.5, 0.79, "SC_LANTERN", 0.8, NOCTF),  // C7b: V9
  P("sp_l3", -33.0, 9.5, 0.00, "SC_LANTERN", 0.7, NOCTF),   // C7b: V8 2.55 m
  P("sp_l4", -26.0, 13.0, -1.18, "SC_LANTERN", 0.6), P("sp_l5", -17.5, 7.0, -1.96, "SC_LANTERN", 0.6),
  P("sp_l6", -23.0, 2.0, -1.57, "SC_LANTERN", 0.4), P("sp_l7", -12.0, 11.5, -1.57, "SC_LANTERN", 0.5),
  P("sp_n1", -38.0, -26.5, -1.96, "SC_NORTH", 0.8), P("sp_n2", -31.5, -22.5, -1.18, "SC_NORTH", 0.6),
  P("sp_n3", -27.0, -26.0, -2.75, "SC_NORTH", 0.7), P("sp_n4", -22.5, -22.0, -1.18, "SC_NORTH", 0.6),
  P("sp_n5", -17.0, -25.5, -1.96, "SC_NORTH", 0.6), P("sp_n6", -14.5, -21.0, -3.14, "SC_NORTH", 0.8),
  P("sp_n7", -23.5, -19.0, -1.96, "SC_NORTH", 0.5),
  P("sp_m1", -12.0, -25.5, -2.75, "SC_MARKET", 0.6), P("sp_m2", -4.0, -28.5, 1.96, "SC_MARKET", 0.8),
  P("sp_m3", -9.5, -21.0, 2.75, "SC_MARKET", 0.3), P("sp_m4", -0.5, -21.5, 1.96, "SC_MARKET", 0.6),
  P("sp_m6", 11.0, -22.5, -3.14, "SC_MARKET", 0.8),
  P("sp_m7", 6.5, -32.0, 1.57, "SC_MARKET", 0.8, NOCTF),    // C7b: V8 2.00 m
  P("sp_m8", 4.0, -27.5, -3.14, "SC_MARKET", 0.8, NOCTF),   // C7b: V8 3.54 m
  P("sp_g1", 20.0, -29.0, -3.14, "SC_GALLERY", 0.6), P("sp_g2", 19.0, -20.0, -3.14, "SC_GALLERY", 0.4),
  P("sp_g3", 21.0, -13.0, -3.14, "SC_GALLERY", 0.8), P("sp_g4", 19.5, -6.0, 1.96, "SC_GALLERY", 0.5),
  P("sp_g5", 20.5, 4.5, 0.00, "SC_GALLERY", 0.7), P("sp_g6", 19.5, 10.5, 0.00, "SC_GALLERY", 0.6),
  P("sp_g7", 10.5, -17.5, 1.57, "SC_GALLERY", 0.6), P("sp_g8", 8.0, -6.0, 1.18, "SC_GALLERY", 0.2),
  P("sp_p1", -17.0, -14.0, -2.75, "SC_PLAZA", 0.6, FFAONLY), P("sp_p2", -8.0, -3.0, 0.79, "SC_PLAZA", 0.5, FFAONLY),
  P("sp_p3", 7.0, -16.0, 2.75, "SC_PLAZA", 0.6, FFAONLY), P("sp_p4", 12.5, -3.0, 1.96, "SC_PLAZA", 0.3, FFAONLY),
  P("sp_p5", -2.0, 9.0, 1.57, "SC_PLAZA", 0.4, FFAONLY), P("sp_p6", -20.5, 6.5, 0.00, "SC_PLAZA", 0.5, FFAONLY),
  // C7b consequence — the ruling drops SC_LANTERN to 4 and SC_MARKET to 5
  // CTF-eligible points and REQUIRES +3/+2 CTF-only replacements on the
  // approaches. These five are FIXTURE stand-ins so the selftest exercises
  // the mandated cluster capacity; W4 authors the probe-validated real ones.
  P("sp_lc1", -24.0, -6.0, 0.79, "SC_LANTERN", 0.6, ["ctf"]),
  P("sp_lc2", -20.0, -12.0, 0.79, "SC_LANTERN", 0.6, ["ctf"]),
  P("sp_lc3", -14.0, 2.0, -1.57, "SC_LANTERN", 0.5, ["ctf"]),
  P("sp_mc1", -14.0, -18.0, 2.36, "SC_MARKET", 0.6, ["ctf"]),
  P("sp_mc2", 8.0, -18.0, -3.14, "SC_MARKET", 0.6, ["ctf"]),
];
const POINT_BY_ID = {}; for (const p of SPAWN_POINTS) POINT_BY_ID[p.id] = p;
const ARENA = { spawnPoints: SPAWN_POINTS, bounds: { min: [-52, 0, -38], max: [28, 8, 18] } };
const C7B_IDS = ["sp_l1", "sp_l2", "sp_l3", "sp_m7", "sp_m8"];

// Fake world: axis-box occluders approximating the carve's major buildings.
const BOXES = [
  { min: [-26, 0, 4], max: [-24, 3, 15] },   // lantern yard wall
  { min: [-38, 0, -16], max: [-26, 3, 3] },  // arcade block
  { min: [-2, 0, -26], max: [12, 3, -24] },  // exchange house wall
  { min: [16, 0, -28], max: [17.5, 3, 10] }, // gallery wall
  { min: [-30, 0, -19], max: [-12, 3, -18] },// north cross-street wall
  { min: [-42, 0, -28], max: [-41, 3, 8] },  // tannery alley wall
  { min: [-12, 0, -20], max: [2, 3, -19] },  // market street north wall
];
// Plaza cover ring — the real arena is DENSE (arena.md: median sightline
// 6.3 m, 79.4% of rays under 15 m). Without this ring the fixture world is
// implausibly open and V2 fires on geometry that cannot exist on the map.
for (let k = 0; k < 8; k++) {
  const cx = -2 + 13 * Math.cos((k * Math.PI) / 4);
  const cz = -2 + 13 * Math.sin((k * Math.PI) / 4);
  BOXES.push({ min: [cx - 1.6, 0, cz - 1.6], max: [cx + 1.6, 2.4, cz + 1.6] });
}
for (let k = 0; k < 6; k++) {
  const cx = -2 + 20 * Math.cos((k * Math.PI) / 3 + 0.4);
  const cz = -2 + 20 * Math.sin((k * Math.PI) / 3 + 0.4);
  BOXES.push({ min: [cx - 1.8, 0, cz - 1.8], max: [cx + 1.8, 2.4, cz + 1.8] });
}
BOXES.push({ min: [-18.6, 0, -7.6], max: [-15.4, 2.4, -4.4] }); // west-mid crates
BOXES.push({ min: [-10.6, 0, -15.6], max: [-7.4, 2.4, -12.4] });

// Per-actor wander anchors — the battery's population model. The real arena
// measures MEAN actor separation 31 m (arena.md §4.1); a single 8 m blob of
// ten actors is geometry the map cannot produce. Teams fight toward mid,
// away from their own spawn side.
const ANCHORS_T0 = [[-2, -2], [2, -14], [18, -4], [-8, -8], [10, 2]];
const ANCHORS_T1 = [[-6, -6], [-2, -16], [-12, -24], [4, -6], [0, -26]];
const WANDER_R = 5;
function losBlocked(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  for (const box of BOXES) {
    let tIn = 0, tOut = 1, hit = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (a[i] < box.min[i] || a[i] > box.max[i]) { hit = false; break; }
      } else {
        let t0 = (box.min[i] - a[i]) / d[i], t1 = (box.max[i] - a[i]) / d[i];
        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
        if (t0 > tIn) tIn = t0;
        if (t1 < tOut) tOut = t1;
        if (tIn > tOut) { hit = false; break; }
      }
    }
    if (hit && tOut > 0.001 && tIn < 0.999) return true;
  }
  return false;
}

const FLAGS = [[-31.3, 0, 11.3], [5.8, 0, -30.6]]; // W/E stands (V7 exercise)
function distH(a, b) { const dx = a[0] - b[0], dz = a[2] - b[2]; return Math.sqrt(dx * dx + dz * dz); }

function makeModeStub(modeId) {
  if (modeId === "ctf") {
    return {
      id: "ctf", teamCount: 2,
      spawnVeto(m, actor, p) { // C7 V7: within 12 m of either flag's position
        return distH(p.pos, FLAGS[0]) < 12 || distH(p.pos, FLAGS[1]) < 12;
      },
    };
  }
  if (modeId === "ffa") return { id: "ffa", teamCount: "perActor" };
  return { id: "tdm", teamCount: 2 };
}

function makeActors(modeId) {
  const actors = [];
  for (let i = 0; i < 10; i++) {
    actors.push({
      actorId: i, team: modeId === "ffa" ? i : (i < 5 ? 0 : 1),
      alive: true, pos: [-2 + (i % 5) * 2 - 4, 0, -2 + ((i / 5) | 0) * 4 - 2],
      yaw: 0, spawnedT: -100, spawnPos: null,
    });
  }
  return actors;
}

function makeM(modeId, actors, rngSpawn) {
  return {
    time: 0,
    state: { modeId },
    actors,
    posOf: (a) => a.pos,
    bodyOf: (a) => a,
    rng: { spawn: rngSpawn },
    mode: makeModeStub(modeId),
    world: { losBlocked },
    sim: { internal: { grenades: [] } },
  };
}

// One deterministic pseudo-match. Returns {picks:[...], snapshot, log:[...]}.
function runBattery(makeSpawns, modeId, seed, nPicks, collect) {
  const walk = mulberry32((seed * 7919 + 13) ^ 0x51ab);
  const rngSpawn = mulberry32((seed * 104729 + 7) ^ 0x9e37);
  const actors = makeActors(modeId);
  const director = makeSpawns(ARENA, {
    homeClusters: modeId === "ffa" ? null : { 0: "SC_LANTERN", 1: "SC_MARKET" },
  });
  const m = makeM(modeId, actors, rngSpawn);
  const dt = 0.2;
  const respawnAt = new Array(10).fill(-1);
  const picks = [];
  // Independent test-side ledgers (never read director internals):
  const lastUsed = {};        // pointId → t
  const lastClusterT = {};    // cluster → t
  const violations = [];
  let steps = 0;
  const maxSteps = 60000;
  while (picks.length < nPicks && steps < maxSteps) {
    steps++;
    m.time += dt;
    const t = m.time;
    // wander: each actor around its own anchor (see ANCHORS_* above)
    for (const a of actors) {
      if (!a.alive) continue;
      const anc = (a.team === 1 && modeId !== "ffa") || (modeId === "ffa" && a.actorId >= 5)
        ? ANCHORS_T1[a.actorId % 5] : ANCHORS_T0[a.actorId % 5];
      const ang = walk() * Math.PI * 2;
      a.pos[0] += Math.cos(ang) * 0.8;
      a.pos[2] += Math.sin(ang) * 0.8;
      const dx = a.pos[0] - anc[0], dz = a.pos[2] - anc[1];
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > WANDER_R) {
        a.pos[0] = anc[0] + (dx / r) * WANDER_R;
        a.pos[2] = anc[1] + (dz / r) * WANDER_R;
      }
      a.yaw = walk() * Math.PI * 2 - Math.PI;
    }
    director.rebuild(m, dt);
    // respawns due
    for (let i = 0; i < 10; i++) {
      if (respawnAt[i] > 0 && t >= respawnAt[i]) {
        respawnAt[i] = -1;
        const a = actors[i];
        const r = director.pick(m, a);
        // -- validity (never fail to spawn) --
        if (!r || !isFinite(r.pos[0]) || !isFinite(r.pos[2]) || !isFinite(r.yaw) || r.stress == null) {
          violations.push("invalid pick at t=" + t.toFixed(1));
        }
        // -- AC-11: no point reuse <12 s unless the ladder forced it --
        if (r.pointId != null) {
          const lu = lastUsed[r.pointId];
          if (lu != null && t - lu < 12.0 && r.stress === 0) {
            violations.push("AC-11 reuse " + r.pointId + " after " + (t - lu).toFixed(1) + "s with stress 0");
          }
          lastUsed[r.pointId] = t;
          const pt = POINT_BY_ID[r.pointId];
          // -- C7 V1 at stress 0: no enemy (team) / actor (ffa) within radius --
          if (r.stress === 0) {
            const v1 = modeId === "ffa" ? 10.0 : 12.0;
            for (const o of actors) {
              if (o === a || !o.alive) continue;
              if (modeId !== "ffa" && o.team === a.team) continue;
              if (distH(o.pos, r.pos) <= v1) {
                violations.push("V1 breach at stress 0: enemy " + distH(o.pos, r.pos).toFixed(1) + " m");
              }
            }
            // -- V10 at stress 0 (FFA): cluster not used <3 s ago --
            if (modeId === "ffa") {
              const ct = lastClusterT[pt.cluster];
              if (ct != null && t - ct < 3.0) {
                violations.push("V10 breach: cluster " + pt.cluster + " reused after " + (t - ct).toFixed(2) + "s at stress 0");
              }
            }
          }
          // -- C7b: the five flag-room points never appear in CTF --
          if (modeId === "ctf" && C7B_IDS.indexOf(r.pointId) >= 0) {
            violations.push("C7b point " + r.pointId + " picked in CTF");
          }
          // -- mode eligibility --
          if (pt.modes.indexOf(modeId) < 0) violations.push("mode-ineligible point " + r.pointId);
          lastClusterT[pt.cluster] = t;
        } else if (!r.fallback || r.protectS !== 3.0) {
          violations.push("null pointId without centroid-fallback contract");
        }
        picks.push({ id: r.pointId, s: r.stress, t: +t.toFixed(2), x: +r.pos[0].toFixed(2), z: +r.pos[2].toFixed(2) });
        a.alive = true; a.pos = [r.pos[0], r.pos[1], r.pos[2]]; a.spawnedT = t; a.spawnPos = r.pos.slice();
      }
    }
    // one kill every 2 s, only of actors spawned >7 s ago (keeps the battery
    // trap-free; the trap override has its own scripted test)
    if (steps % 10 === 0) {
      const eligible = actors.filter((a) => a.alive && t - a.spawnedT > 7);
      if (eligible.length) {
        const v = eligible[(walk() * eligible.length) | 0];
        v.alive = false;
        director.noteDeath(m, { actor: v, pos: v.pos.slice(), t, team: v.team });
        respawnAt[v.actorId] = t + 3.0;
      }
    }
    if (steps % 55 === 0) director.noteExplosion([-2 + walk() * 8, 0, -2 + walk() * 8], t);
  }
  return { picks, snapshot: director.snapshot(), violations };
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length / 2) | 0] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
}

(async function main() {
  const { makeSpawns, SCORE_WEIGHTS, VETOES, ffaSafety } = await import(u("core/match/spawns.js"));
  const { makeInfluence } = await import(u("core/match/influence.js"));

  // ---- 1. C8 tables ----
  section("C8 score tables (SCORE_WEIGHTS as one table)");
  ok(SCORE_WEIGHTS.team.safety === 40 && SCORE_WEIGHTS.team.safetySatM === 55, "team safety 40, saturates 55 m");
  ok(SCORE_WEIGHTS.team.friendly === 22 && SCORE_WEIGHTS.team.friendlySatM === 35, "team friendly proximity 22 @35 m");
  ok(SCORE_WEIGHTS.team.influence === 18 && SCORE_WEIGHTS.team.facing === 15 && SCORE_WEIGHTS.team.facingMaxM === 60, "team influence 18, facing 15 @60 m");
  ok(SCORE_WEIGHTS.ffa.safety === 55 && SCORE_WEIGHTS.ffa.safetyLenM === 18, "ffa crowd repulsion 55, length 18 m");
  ok(SCORE_WEIGHTS.ffa.spread === 18 && SCORE_WEIGHTS.ffa.clusterHeat === 8, "ffa spread 18 + clusterHeat 8");
  ok(SCORE_WEIGHTS.ffa.facing === 18 && SCORE_WEIGHTS.ffa.facingMaxM === 40, "ffa facing 18, narrowed to 40 m");

  section("C7 merged veto table");
  ok(VETOES.team.v1 === 12 && VETOES.team.v2 === 25 && VETOES.team.v3 === 20, "team V1/V2/V3 = 12/25/20");
  ok(VETOES.ffa.v1 === 10 && VETOES.ffa.v2 === 20 && VETOES.ffa.v3 === 16, "FFA V1/V2/V3 = 10/20/16");
  ok(VETOES.ffa.v10 === 3.0, "V10 cluster cooldown 3.0 s");
  ok(VETOES.relax.team.v2 === 15 && VETOES.relax.team.v1 === 8, "team ladder targets 25→15, 12→8");
  ok(VETOES.relax.ffa.v2 === 13 && VETOES.relax.ffa.v1 === 7, "FFA ladder targets 20→13, 10→7");

  // ---- 2. C8 worked values (AC-12: safety counts ALL others) ----
  section("ffaSafety worked values (C8)");
  ok(approx(ffaSafety([22]), 0.772, 0.005), "one actor at 22 m -> 0.772 (got " + ffaSafety([22]).toFixed(3) + ")");
  ok(approx(ffaSafety([22, 22, 22]), 0.530, 0.005), "three at 22 m -> 0.530 (got " + ffaSafety([22, 22, 22]).toFixed(3) + ")");
  ok(approx(ffaSafety([60]), 0.965, 0.005), "one at 60 m -> 0.965 (got " + ffaSafety([60]).toFixed(3) + ")");
  ok(ffaSafety([22, 22, 22]) < ffaSafety([60]), "three near scores worse than one far (the single-nearest break, fixed)");

  // ---- 3. influence grid units ----
  section("influence grid (team signed / FFA unsigned + spread)");
  {
    const g = makeInfluence(ARENA.bounds, {});
    g.deposit([-10, 0, -10], 2.0, 0);
    ok(g.at([-10, 0, -10], 0) > 0 && g.at([-10, 0, -10], 1) < 0, "team grid signed: +ve for own team, -ve for enemy");
    const before = g.at([-10, 0, -10], 0);
    g.decay(2.0);
    ok(g.at([-10, 0, -10], 0) < before, "grid decays toward 0");
    const gf = makeInfluence(ARENA.bounds, { perActor: true });
    ok(gf.spread([-10, 0, -10]) === 1, "spread = 1.0 on a cold map");
    gf.deposit([-10, 0, -10], 2.0, 3);
    const s = gf.spread([-10, 0, -10]);
    ok(s < 1 && s >= 0, "death deposit lowers spread (unsigned, 0..1): " + s.toFixed(3));
    gf.deposit([-10, 0, -10], 2.0, 7); // different 'team' — must NOT cancel
    ok(gf.spread([-10, 0, -10]) < s, "AC-12: spread() is UNSIGNED — deposits never cancel by team");
    ok(gf.at([-10, 0, -10], 0) >= 0 && gf.at([-10, 0, -10], 5) >= 0, "perActor at() is unsigned pressure");
    gf.decay(6.0);
    ok(gf.spread([-10, 0, -10]) > s, "spread recovers as history decays");
  }

  // ---- 4. ladder unit scenarios ----
  section("relaxation ladder (C7 order; every step = +1 stress)");
  {
    // One point, one enemy at 16 m with clear LOS, facing away:
    // V1(12) no · V2(25) YES until the V2→15 rung → team stress must be 4.
    const arena1 = { spawnPoints: [P("only", 0, 0, 0, "SC_X", 0.5)], bounds: { min: [-40, 0, -40], max: [40, 8, 40] } };
    const d = makeSpawns(arena1, {});
    const actors = [
      { actorId: 0, team: 0, alive: false, pos: [30, 0, 30], yaw: 0 },
      { actorId: 1, team: 1, alive: true, pos: [16, 0, 0], yaw: Math.PI / 2 }, // facing -X? fwd=(-sin,-cos)=(-1,0): toward point!
    ];
    actors[1].yaw = -Math.PI / 2; // fwd = (1, 0) — away from the point
    const m1 = { time: 10, state: { modeId: "tdm" }, actors, posOf: (a) => a.pos, bodyOf: (a) => a, rng: { spawn: mulberry32(1) }, mode: makeModeStub("tdm"), world: { losBlocked: () => false } };
    const r = d.pick(m1, actors[0]);
    ok(r.pointId === "only" && r.stress === 4, "enemy@16m clear LOS: survives at the V2 25→15 rung, stress 4 (got " + r.stress + ")");
    // Same but enemy at 9 m: V1 relaxes only to 8 < 9, but V2(15) still vetoes
    // → full ladder exhausts → centroid fallback with 3.0 s protection.
    const d2 = makeSpawns(arena1, {});
    actors[1].pos = [9, 0, 0];
    const m2 = Object.assign({}, m1, { time: 20 });
    const r2 = d2.pick(m2, actors[0]);
    ok(r2.pointId === null && r2.fallback === true && r2.protectS === 3.0, "unsalvageable point: centroid fallback, protectS 3.0 (never fail)");
    ok(r2.stress === 6, "fallback stress = full team ladder depth 6 (got " + r2.stress + ")");
    // V5 is never relaxed: live grenade at 5 m from the only point.
    const d3 = makeSpawns(arena1, {});
    const m3 = { time: 30, state: { modeId: "tdm" }, actors: [actors[0]], posOf: (a) => a.pos, bodyOf: (a) => a, rng: { spawn: mulberry32(2) }, mode: makeModeStub("tdm"), world: { losBlocked: () => false }, sim: { internal: { grenades: [{ pos: [5, 0, 0] }] } } };
    const r3 = d3.pick(m3, actors[0]);
    ok(r3.pointId === null && r3.fallback === true, "V5 (live grenade 5 m) holds through the whole ladder");
  }

  // ---- 5. trap override ----
  section("trap override (3-of-5 spawn deaths -> flip + widen)");
  {
    const d = makeSpawns(ARENA, { homeClusters: { 0: "SC_LANTERN", 1: "SC_MARKET" } });
    const actors = makeActors("tdm");
    const m = makeM("tdm", actors, mulberry32(11));
    m.time = 5;
    let t = 5;
    for (let i = 0; i < 3; i++) {
      m.time = t;
      const a = actors[i]; a.alive = false;
      const r = d.pick(m, a);
      a.alive = true; a.pos = r.pos.slice();
      m.time = t + 1.0; // dies 1 s after spawning, at the spawn point
      d.noteDeath(m, { actor: a, pos: a.pos.slice(), t: t + 1.0, team: a.team });
      a.alive = false;
      t += 2.0;
    }
    const snap = d.snapshot();
    ok(snap.traps >= 1, "team trap override fired (traps=" + snap.traps + ")");
    ok(snap.compromised.length >= 1 && snap.compromised[0].team === 0, "SPAWN COMPROMISED recorded for team 0 (HUD line source)");
    ok(snap.teams["0"].widenUntil > t, "V1/V2 widened for 20 s after the trap");
  }
  {
    const d = makeSpawns(ARENA, {});
    const actors = makeActors("ffa");
    const m = makeM("ffa", actors, mulberry32(12));
    let t = 5, cluster = null;
    for (let i = 0; i < 3; i++) {
      m.time = t;
      const a = actors[4]; a.alive = false;
      const r = d.pick(m, a);
      if (r.pointId) cluster = POINT_BY_ID[r.pointId].cluster;
      a.alive = true; a.pos = r.pos.slice();
      m.time = t + 1.0;
      d.noteDeath(m, { actor: a, pos: a.pos.slice(), t: t + 1.0, team: a.team });
      a.alive = false;
      t += 6.0; // > V10 3 s so the same cluster CAN be re-picked pre-trap
    }
    const snap = d.snapshot();
    ok(snap.traps >= 1, "FFA per-actor trap fired (traps=" + snap.traps + ")");
    m.time = t + 0.5;
    const r = d.pick(m, actors[4]);
    const banned = snap.compromised.length && cluster != null;
    ok(!banned || r.pointId == null || POINT_BY_ID[r.pointId].cluster !== cluster,
      "post-trap pick avoids the banned cluster (" + cluster + " -> " + (r.pointId ? POINT_BY_ID[r.pointId].cluster : "centroid") + ")");
  }

  // ---- 6. the battery: 2000 selections x 20 seeds x 3 modes ----
  const PICKS_PER_SEED = 100; // × 20 seeds = 2000 selections per mode
  for (const modeId of ["tdm", "ctf", "ffa"]) {
    section("battery: " + modeId + " — 20 seeds × " + PICKS_PER_SEED + " selections");
    let all = [], viols = [], v10 = 0, falls = 0, picksN = 0;
    for (let seed = 0; seed < 20; seed++) {
      const r = runBattery(makeSpawns, modeId, seed, PICKS_PER_SEED);
      all = all.concat(r.picks.map((p) => p.s));
      viols = viols.concat(r.violations);
      v10 += r.snapshot.v10Vetoes;
      falls += r.snapshot.centroidFalls;
      picksN += r.picks.length;
    }
    ok(picksN === 20 * PICKS_PER_SEED, modeId + ": " + picksN + "/" + 20 * PICKS_PER_SEED + " selections completed (never failed to spawn)");
    ok(viols.length === 0, modeId + ": zero invariant violations" + (viols.length ? " — first: " + viols[0] : ""));
    if (viols.length) for (const v of viols.slice(0, 5)) console.error("        " + v);
    const med = median(all);
    ok(med <= 0.5, modeId + ": median spawnStress " + med + " <= 0.5 (AC-10)");
    const hist = {};
    for (const s of all) hist[s] = (hist[s] || 0) + 1;
    console.log("        stress histogram " + JSON.stringify(hist) + "; centroid falls " + falls);
    if (modeId === "ffa") ok(v10 > 0, "AC-12: V10 cluster cooldown FIRED during the battery (" + v10 + " candidate vetoes)");
  }

  // ---- 7. determinism ----
  section("determinism (same mode+seed twice -> identical pick sequence)");
  for (const modeId of ["tdm", "ctf", "ffa"]) {
    const a = JSON.stringify(runBattery(makeSpawns, modeId, 7, 60).picks);
    const b = JSON.stringify(runBattery(makeSpawns, modeId, 7, 60).picks);
    ok(a === b, modeId + ": bit-identical across two runs");
  }

  // ---- 8. CTF cluster lock ----
  section("CTF home-cluster lock (modes 4.3.2)");
  {
    const r = runBattery(makeSpawns, "ctf", 3, 80);
    let locked = true, sample = "";
    for (const p of r.picks) {
      if (p.id == null) continue;
      const c = POINT_BY_ID[p.id].cluster;
      if (c !== "SC_LANTERN" && c !== "SC_MARKET") { locked = false; sample = p.id + "@" + c; break; }
    }
    ok(locked, "every CTF pick lands in a home cluster" + (sample ? " — breach: " + sample : ""));
  }

  console.log("\n===== " + passed + " passed, " + failed + " failed =====");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
