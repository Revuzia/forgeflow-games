#!/usr/bin/env node
// tools/nav_probe.mjs — headless bot NAVIGATION probe (BOT AI pass, 2026-10).
//
// For each map it bakes the REAL nav (cell 0.75, exactly what boot.js bakes),
// samples N random walkable start/goal pairs, asks nav for a path, then DRIVES a
// real bot along it with the real brain + stepBotLocomotion + world.moveCapsule
// loop (sim.step, noTarget so nothing perceives), for a time budget. Reports:
//
//   found      path-found rate (findPath returned a path for a reachable pair)
//   arrived    bot ended within ARRIVE_R of the goal inside the time budget
//   t/ideal    time-to-arrive / (path length / speed): mean, p95 (1.0 = perfect)
//   t/line     time-to-arrive / (straight-line / speed): mean, p95
//   stuck      events where displacement < 0.3 m over a trailing 2 s while the
//              bot is still pathing; "longest" = longest single stuck interval
//   snags      contact EPISODES (moveCapsule clipped the bot: hitWall) per run
//   hug%       share of drive ticks with the capsule within 0.10 m of a wall
//   skipWP     waypoint advances where the straight line bot->next waypoint
//              was NOT capsule-clear (waypoint skipping through geometry)
//   badSeg     static path segments that a capsule cannot walk (nav lied)
//
// Modes:  (default) solo walk | --sprint | --squad (5 bots, same goal, doorway
// body-block / separation check) | --maps a,b | --pairs N | --seed S | --json f
//
// Usage:  node tools/nav_probe.mjs [--pairs 300] [--maps lanternwalk,...]
"use strict";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const MAPS = argOf("--maps", "meridian_ward,lanternwalk,switchyard,saltmarket").split(",");
const PAIRS = parseInt(argOf("--pairs", "300"), 10);
const SEED = parseInt(argOf("--seed", "1"), 10);
const SPRINT = argv.includes("--sprint");
const SQUAD = argv.includes("--squad");
const VERBOSE = argv.includes("--verbose");
const JSON_OUT = argOf("--json", null);
const TIMING_ONLY = argv.includes("--timing-only");
const DIVERSITY = argv.includes("--diversity");
const TRACE_ID = parseInt(argOf("--trace", "-1"), 10);
const CELL = parseFloat(argOf("--cell", "0.75"));

const SIM = await import(u("core/sim/sim.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const RNG = await import(u("core/rng.js"));

const ARRIVE_R = 1.3;      // probe-side arrival (game accepts 0.8 on the goal itself)
const WALK = 4.6, SPR = 6.4;
const DT = 1 / 60;

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f2 = (x) => (x == null ? "  n/a" : (Math.round(x * 100) / 100).toFixed(2));

function pathLen(p) {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
  return d;
}

// capsule sweep along a segment using the mover's own blocked test (linear scan
// of all boxes — fine for a probe). Steps at 0.15 m, follows floor height.
function segmentWalkable(world, a, b) {
  const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(dist / 0.15));
  let y = a[1];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
    if (world.capsuleBlocked(x, y, z, 0.33, 1.7)) return false; // 0.02 slack: a graze is not a wedge
    const sup = world.supportAt(x, z, y, 0.35);
    if (sup > y + 0.36) return false;
    y = Math.max(sup, y - 0.4);
    if (y < sup) y = sup;
  }
  return true;
}

const hasGoto = typeof BF.aiNavGoto === "function";

async function runMap(mapId) {
  const colliders = COL.buildCollidersFor(mapId, 1);
  const t0 = performance.now();
  const nav = NAV.bakeNav(colliders, { cell: CELL });
  const bakeMs = performance.now() - t0;
  const rng = RNG.mulberry32(SEED * 7919 + mapId.length);
  const b = colliders.bounds;
  const center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
  const R = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);

  const sim = SIM.createSim({ colliders, nav, weapons: WD.WEAPONS, seed: SEED });
  sim.flags.noTarget = true;
  sim.state.phase = "assault";
  // hitWall instrumentation on the REAL mover
  const realMove = sim.world.moveCapsule;
  const contact = { hit: false };
  sim.world.moveCapsule = function (pos, vel, dt, r, h) {
    const res = realMove(pos, vel, dt, r, h);
    if (res.hitWall) contact.hit = true;
    return res;
  };

  const res = {
    map: mapId, nodes: nav.stats.nodes, walkable: nav.stats.walkable, bakeMs,
    pairs: 0, found: 0, arrived: 0, badSeg: 0, segs: 0,
    tIdeal: [], tLine: [], pathRatio: [], stuckEvents: 0, stuckOver3: 0, stuckLongest: 0,
    snagEpisodes: 0, runsWithSnag: 0, hugTicks: 0, driveTicks: 0, skipWP: 0, fails: [],
    arrTimes: [],
  };

  // ------------------------------------------------ sample pairs
  const pairs = [];
  let guard = 0;
  while (pairs.length < PAIRS && guard++ < PAIRS * 40) {
    const s = nav.randomPoint(center, R, rng);
    const g = nav.randomPoint(center, R, rng);
    if (Math.hypot(s[0] - g[0], s[2] - g[2]) < 8) continue;
    if (!nav.reachable(s, g)) continue;
    pairs.push([s, g]);
  }

  // findPath cost (A* + string pull) over the sampled pairs
  {
    const ms = [];
    for (const [s, g] of pairs) { const t1 = performance.now(); nav.findPath(s, g); ms.push(performance.now() - t1); }
    res.pathMsMean = mean(ms); res.pathMsP95 = pct(ms, 0.95); res.pathMsMax = Math.max(...ms);
  }
  if (TIMING_ONLY) return res;
  const speed = SPRINT ? SPR : WALK;
  for (const [s, g] of pairs) {
    res.pairs++;
    const path = nav.findPath(s, g);
    if (!path) { res.fails.push({ why: "nopath", s, g }); continue; }
    res.found++;
    const plen = pathLen(path);
    // static validity
    for (let i = 1; i < path.length; i++) {
      res.segs++;
      if (!segmentWalkable(sim.world, path[i - 1], path[i])) res.badSeg++;
    }
    const line = Math.hypot(g[0] - s[0], g[2] - s[2]);
    res.pathRatio.push(plen / Math.max(1, line));

    // ------------------------------------------------ drive a real bot
    sim.state.bots.length = 0;
    sim.squad.reset();
    const id = sim.spawnBot("rifleman", s[0], s[2], { y: s[1], band: "regular" });
    const bot = sim.state.bots.find((x) => x.id === id);
    bot.team = 1;
    // first tick builds the brain
    sim.step();
    driveSetup(sim, nav, bot, g, SPRINT);
    if (bot.id === TRACE_ID) console.log('   path', JSON.stringify(bot._brain.path.map((q) => q.map((v) => +v.toFixed(2)))));
    const budget = Math.max(20, (plen / speed) * 3 + 12);
    const maxTicks = Math.ceil(budget * 60);
    let arrivedT = null;
    const win = []; // trailing positions every 0.5 s
    let stuckRun = 0, stuckBest = 0, inStuck = false, snagRun = 0, snagEpisodes = 0, gap = 99;
    let lastPathI = -1;
    const tStart = sim.state.time;
    for (let k = 0; k < maxTicks; k++) {
      contact.hit = false;
      // waypoint-skip detector (pre-step brain state)
      const br = bot._brain;
      const piBefore = br ? br.pathI : 0;
      const wpBefore = br && br.path ? br.path[piBefore] : null;
      sim.step();
      if (contact.hit) { snagRun++; gap = 0; } else { gap++; if (gap > 8 && snagRun > 0) { snagEpisodes += snagRun >= 6 ? 1 : 0; snagRun = 0; } }
      res.driveTicks++;
      if (sim.world.capsuleBlocked(bot.pos[0], bot.pos[1], bot.pos[2], 0.45, 1.7)) res.hugTicks++;
      if (br && br.path && br.pathI > piBefore && wpBefore && br.pathI < br.path.length) {
        const nxt = br.path[br.pathI];
        if (!segmentWalkable(sim.world, bot.pos, nxt)) res.skipWP++;
      }
      void lastPathI;
      if (bot.id === TRACE_ID && bot._brain.path !== bot._lastPathDbg) { bot._lastPathDbg = bot._brain.path; if (k > 5) console.log('   REPATH at t=' + (sim.state.time - tStart).toFixed(2) + ' pos=' + bot.pos.map((v) => v.toFixed(2)).join(',') + ' path=' + JSON.stringify(bot._brain.path ? bot._brain.path.map((q) => q.map((v) => +v.toFixed(2))) : null)); }
      if (bot.id === TRACE_ID && k % 20 === 0) {
        const b2 = bot._brain;
        console.log(`   trace t=${(sim.state.time - tStart).toFixed(2)} pos=${bot.pos.map((v) => v.toFixed(2)).join(",")} v=${Math.hypot(bot.vel[0], bot.vel[2]).toFixed(2)} pathI=${b2.pathI}/${b2.path ? b2.path.length : null} car=${b2._carrot ? b2._carrot.map((v) => v.toFixed(1)).join(",") : "-"} mv=${b2.mvx.toFixed(2)},${b2.mvz.toFixed(2)} arr=${b2.arrived} stuck=${b2.stuckN} nudge=${b2.nudgeUntil > sim.state.time}`);
      }
      const d = Math.hypot(bot.pos[0] - g[0], bot.pos[2] - g[2]);
      if (d < ARRIVE_R && Math.abs(bot.pos[1] - g[1]) < 1.2) { arrivedT = sim.state.time - tStart; break; }
      // stuck window: every 30 ticks compare to position 2 s ago
      if (k % 30 === 0) {
        win.push([bot.pos[0], bot.pos[2]]);
        if (win.length > 4) {
          const old = win[win.length - 5];
          const moved = Math.hypot(bot.pos[0] - old[0], bot.pos[2] - old[1]);
          if (moved < 0.3) { stuckRun += 0.5; inStuck = true; if (stuckRun > stuckBest) stuckBest = stuckRun; if (VERBOSE && stuckRun === 3) { const b3 = bot._brain; console.log(`     STUCK id=${bot.id} t=${(sim.state.time - tStart).toFixed(1)} pos=${bot.pos.map((v) => v.toFixed(2))} goal=${g.map((v) => v.toFixed(1))} pathI=${b3.pathI}/${b3.path ? b3.path.length : null} mv=${b3.mvActive} stuckN=${b3.stuckN} orbit=${b3.orbitN} arrived=${b3.arrived} v=${Math.hypot(bot.vel[0], bot.vel[2]).toFixed(2)}`); } }
          else if (inStuck) { res.stuckEvents++; if (stuckRun + 2 > 3) res.stuckOver3++; inStuck = false; stuckRun = 0; }
        }
      }
    }
    if (inStuck) { res.stuckEvents++; if (stuckRun + 2 > 3) res.stuckOver3++; }
    if (snagRun >= 6) snagEpisodes++;
    res.snagEpisodes += snagEpisodes;
    if (snagEpisodes > 0) res.runsWithSnag++;
    if (stuckBest + (stuckBest > 0 ? 2 : 0) > res.stuckLongest) res.stuckLongest = stuckBest + (stuckBest > 0 ? 2 : 0);
    if (arrivedT != null) {
      res.arrived++;
      res.arrTimes.push(arrivedT);
      res.tIdeal.push(arrivedT / (plen / speed));
      res.tLine.push(arrivedT / (line / speed));
    } else {
      res.fails.push({ why: "timeout", id: bot.id, br: bot._brain ? { pathI: bot._brain.pathI, n: bot._brain.path ? bot._brain.path.length : null, arrived: bot._brain.arrived, stuckN: bot._brain.stuckN, orbitN: bot._brain.orbitN, st: bot.state, goalUnreach: bot._brain.goalUnreach } : null, s: s.map((x) => Math.round(x * 10) / 10), g: g.map((x) => Math.round(x * 10) / 10), plen: Math.round(plen), left: Math.round(Math.hypot(bot.pos[0] - g[0], bot.pos[2] - g[2]) * 10) / 10, at: bot.pos.map((x) => Math.round(x * 10) / 10) });
    }
  }
  return res;
}

function driveSetup(sim, nav, bot, goal, sprint) {
  if (hasGoto) { BF.aiNavGoto(sim, nav, bot, goal, sprint); return; }
  // baseline path: poke the brain exactly as setGoal() would (suspicious state
  // walks brain.goal through followPath and never gives up: until = huge)
  const br = bot._brain;
  bot.state = "suspicious";
  br.investT = { until: 1e9, sweepUntil: -9, nextSampleT: -9, sprint: !!sprint, target: goal.slice() };
  br.goal = [goal[0], goal[1], goal[2]];
  br.sprintMove = !!sprint;
  br.arrived = false;
  br.path = nav.findPath(bot.pos, br.goal);
  br.pathI = br.path ? 1 : 0;
  br.stuckT = 0;
}

// ------------------------------------------------------------------ squad
// 5 bots from a tight cluster to a shared goal across the map: counts how many
// reach it, the worst arrival spread, and contact episodes. Cluster members are
// spread over ~2 m so they must share doorways.
async function runSquad(mapId) {
  const colliders = COL.buildCollidersFor(mapId, 1);
  const nav = NAV.bakeNav(colliders, { cell: CELL });
  const rng = RNG.mulberry32(SEED * 104729 + mapId.length);
  const b = colliders.bounds;
  const center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
  const R = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const sim = SIM.createSim({ colliders, nav, weapons: WD.WEAPONS, seed: SEED });
  sim.flags.noTarget = true; sim.state.phase = "assault";
  const out = { map: mapId, runs: 0, botsTotal: 0, botsArrived: 0, worstSpread: [], overlapTicks: 0, ticks: 0, distinctRoutes: [] };
  const runs = Math.max(10, Math.floor(PAIRS / 5));
  let guard = 0;
  while (out.runs < runs && guard++ < runs * 40) {
    const s = nav.randomPoint(center, R, rng);
    const g = nav.randomPoint(center, R, rng);
    if (Math.hypot(s[0] - g[0], s[2] - g[2]) < 15 || !nav.reachable(s, g)) continue;
    sim.state.bots.length = 0; sim.squad.reset();
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const p = nav.randomPoint(s, 2.2, rng);
      const id = sim.spawnBot("rifleman", p[0], p[2], { y: p[1], band: "regular" });
      ids.push(id);
    }
    sim.step();
    const bots = sim.state.bots.slice();
    for (const bt of bots) { bt.team = 1; bt.squadId = "sq"; driveSetup(sim, nav, bt, nav.randomPoint(g, 2.2, rng), SPRINT); }
    const plen = pathLen(nav.findPath(s, g) || [s, g]);
    const budget = Math.max(25, (plen / (SPRINT ? SPR : WALK)) * 3 + 15);
    const arr = new Map();
    const t0 = sim.state.time;
    const routes = new Set();
    for (let k = 0; k < budget * 60; k++) {
      sim.step();
      out.ticks++;
      if (k % 60 === 0) {
        for (let i = 0; i < bots.length; i++) for (let j = i + 1; j < bots.length; j++) {
          if (Math.hypot(bots[i].pos[0] - bots[j].pos[0], bots[i].pos[2] - bots[j].pos[2]) < 0.45) out.overlapTicks++;
        }
        if (k % 300 === 0) routes.add(bots.map((x) => `${Math.round(x.pos[0] / 4)},${Math.round(x.pos[2] / 4)}`).join("|"));
      }
      for (const bt of bots) {
        if (arr.has(bt.id)) continue;
        const tgt = bt._brain && bt._brain.goal;
        if (tgt && Math.hypot(bt.pos[0] - tgt[0], bt.pos[2] - tgt[2]) < ARRIVE_R * 1.3) arr.set(bt.id, sim.state.time - t0);
      }
      if (arr.size === bots.length) break;
    }
    out.runs++;
    out.botsTotal += bots.length;
    out.botsArrived += arr.size;
    if (arr.size > 1) { const v = [...arr.values()]; out.worstSpread.push(Math.max(...v) - Math.min(...v)); }
  }
  return out;
}

// ------------------------------------------------------------------ route diversity
// 5 bots leave the same ~2 m cluster for the same goal. Mean pairwise Jaccard
// overlap of the 1 m cells their routes cross (1 = everybody in one file, lower
// = lanes), plain A* vs the in-game planner (lane noise + squad heat).
async function runDiversity(mapId) {
  const colliders = COL.buildCollidersFor(mapId, 1);
  const nav = NAV.bakeNav(colliders, { cell: CELL });
  const rng = RNG.mulberry32(SEED * 31337 + mapId.length);
  const b = colliders.bounds;
  const center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
  const R = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const cellsOf = (path) => {
    const set = new Set();
    for (let i = 1; i < path.length; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2])));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        set.add(Math.round(path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t) + "," + Math.round(path[i - 1][2] + (path[i][2] - path[i - 1][2]) * t));
      }
    }
    return set;
  };
  const jac = (a, c) => { let inter = 0; for (const x of a) if (c.has(x)) inter++; return inter / (a.size + c.size - inter); };
  const res = { plain: [], planner: [], lenRatio: [] };
  let runs = 0, guard = 0;
  while (runs < Math.max(20, Math.floor(PAIRS / 5)) && guard++ < 4000) {
    const s = nav.randomPoint(center, R, rng), g = nav.randomPoint(center, R, rng);
    if (Math.hypot(s[0] - g[0], s[2] - g[2]) < 25 || !nav.reachable(s, g)) continue;
    const starts = [];
    for (let i = 0; i < 5; i++) starts.push(nav.randomPoint(s, 2.0, rng));
    const plain = starts.map((p) => nav.findPath(p, g)).filter(Boolean);
    const heat = nav.makeHeat();
    const planned = starts.map((p, i) => {
      const path = nav.findPath(p, g, { bias: i + 1, noise: 0.10, heat, heatW: 0.28 });
      if (path && path.ids) nav.stampHeat(heat, path.ids, 1.0);
      return path;
    }).filter(Boolean);
    if (plain.length < 5 || planned.length < 5) continue;
    const sets = (ps) => ps.map(cellsOf);
    const avg = (ss) => { let t = 0, n = 0; for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) { t += jac(ss[i], ss[j]); n++; } return t / n; };
    res.plain.push(avg(sets(plain))); res.planner.push(avg(sets(planned)));
    const L = (ps) => ps.reduce((a, p) => a + pathLen(p), 0) / ps.length;
    res.lenRatio.push(L(planned) / L(plain));
    runs++;
  }
  return { map: mapId, runs, plain: mean(res.plain), planner: mean(res.planner), lenRatio: mean(res.lenRatio) };
}

// ------------------------------------------------------------------ main
const allRes = [];
console.log(`nav_probe  pairs=${PAIRS} seed=${SEED} cell=${CELL} mode=${SQUAD ? "squad" : (SPRINT ? "solo-sprint" : "solo-walk")} driver=${hasGoto ? "aiNavGoto" : "brain-poke(baseline)"}`);
for (const m of MAPS) {
  if (DIVERSITY) {
    const r = await runDiversity(m);
    allRes.push(r);
    console.log(`${m.padEnd(14)} runs=${r.runs}  route overlap (Jaccard, 1=one file): plain A* ${f2(r.plain)}  planner ${f2(r.planner)}  planner/plain mean path length x${f2(r.lenRatio)}`);
    continue;
  }
  if (SQUAD) {
    const r = await runSquad(m);
    allRes.push(r);
    console.log(`${m.padEnd(14)} squads=${r.runs} bots arrived ${r.botsArrived}/${r.botsTotal} (${f2(100 * r.botsArrived / Math.max(1, r.botsTotal))}%)` +
      `  spread mean=${f2(mean(r.worstSpread))}s p95=${f2(pct(r.worstSpread, 0.95))}s  overlap(<0.45m) samples=${r.overlapTicks}`);
    continue;
  }
  const r = await runMap(m);
  allRes.push(r);
  if (TIMING_ONLY) { console.log(`${m.padEnd(14)} findPath ms: mean=${f2(r.pathMsMean)} p95=${f2(r.pathMsP95)} max=${f2(r.pathMsMax)}  (bake ${f2(r.bakeMs)} ms, ${r.nodes} nodes)`); continue; }
  const pf = (100 * r.found / Math.max(1, r.pairs)), pa = (100 * r.arrived / Math.max(1, r.pairs));
  console.log(
    `${m.padEnd(14)} nodes=${r.nodes} bake=${f2(r.bakeMs)}ms pairs=${r.pairs}\n` +
    `   findPath ms mean=${f2(r.pathMsMean)} p95=${f2(r.pathMsP95)} max=${f2(r.pathMsMax)}
` +
    `   found ${r.found}/${r.pairs} (${f2(pf)}%)  arrived ${r.arrived}/${r.pairs} (${f2(pa)}%)` +
    `  badSeg ${r.badSeg}/${r.segs}\n` +
    `   t/ideal mean=${f2(mean(r.tIdeal))} p95=${f2(pct(r.tIdeal, 0.95))}   t/line mean=${f2(mean(r.tLine))} p95=${f2(pct(r.tLine, 0.95))}` +
    `   path/line mean=${f2(mean(r.pathRatio))} p95=${f2(pct(r.pathRatio, 0.95))}\n` +
    `   stuck events=${r.stuckEvents} (>3s: ${r.stuckOver3}, longest ${f2(r.stuckLongest)}s)  snag episodes=${r.snagEpisodes} in ${r.runsWithSnag} runs` +
    `  hug%=${f2(100 * r.hugTicks / Math.max(1, r.driveTicks))}  skipWP=${r.skipWP}`);
  if (VERBOSE) for (const f of r.fails.slice(0, 12)) console.log("     FAIL", JSON.stringify(f));
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(allRes, null, 1));
