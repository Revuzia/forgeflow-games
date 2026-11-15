#!/usr/bin/env node
// tools/_nav_results/snag_probe.mjs — why does a solo walker touch walls?
// Same pairs as nav_probe (seed 1). For each contact tick records the steering
// state that produced it: carrot clear or fallback, nudge active, the box kind,
// whether the commanded move pointed INTO the wall, and velocity lag (angle
// between commanded heading and actual velocity).
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "../..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const MAPS = argOf("--maps", "lanternwalk").split(",");
const PAIRS = parseInt(argOf("--pairs", "300"), 10);
const SIM = await import(u("core/sim/sim.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const RNG = await import(u("core/rng.js"));
for (const mapId of MAPS) {
  const colliders = COL.buildCollidersFor(mapId, 1);
  const nav = NAV.bakeNav(colliders, { cell: 0.75 });
  const rng = RNG.mulberry32(1 * 7919 + mapId.length);
  const b = colliders.bounds;
  const center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
  const R = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const pairs = [];
  let guard = 0;
  while (pairs.length < PAIRS && guard++ < PAIRS * 40) {
    const s = nav.randomPoint(center, R, rng), g = nav.randomPoint(center, R, rng);
    if (Math.hypot(s[0] - g[0], s[2] - g[2]) < 8) continue;
    if (!nav.reachable(s, g)) continue;
    pairs.push([s, g]);
  }
  const sim = SIM.createSim({ colliders, nav, weapons: WD.WEAPONS, seed: 1 });
  sim.flags.noTarget = true; sim.state.phase = "assault";
  const realMove = sim.world.moveCapsule;
  let hit = false;
  sim.world.moveCapsule = function (pos, vel, dt, r, h) { const res = realMove(pos, vel, dt, r, h); if (res.hitWall) hit = true; return res; };
  const C = { ticks: 0, carFallback: 0, nudge: 0, lagBig: 0, startPhase: 0, arrivedPhase: 0, notMv: 0 };
  const boxK = {}; const lagHist = [0, 0, 0, 0, 0, 0];
  const ex = []; const H = { n: 0, start: 0, goal: 0 }; const HB = {}; const HX = []; const WATCH = argOf('--watch','');
  let pi = 0;
  for (const [s, g] of pairs) {
    pi++;
    sim.state.bots.length = 0; sim.squad.reset();
    const id = sim.spawnBot("rifleman", s[0], s[2], { y: s[1], band: "regular" });
    const bot = sim.state.bots.find((x) => x.id === id); bot.team = 1;
    sim.step();
    BF.aiNavGoto(sim, nav, bot, g, false);
    const t0 = sim.state.time;
    for (let k = 0; k < 60 * 60; k++) {
      hit = false;
      sim.step();
      if (sim.world.capsuleBlocked(bot.pos[0], bot.pos[1], bot.pos[2], 0.45, 1.7)) {
        const br = bot._brain; H.n++;
        const dS = Math.hypot(bot.pos[0] - s[0], bot.pos[2] - s[2]), dG = Math.hypot(bot.pos[0] - g[0], bot.pos[2] - g[2]);
        if (dS < 1.5) H.start++; else if (dG < 2.5) H.goal++;
        else {
          const A = br.path && br.path[br.pathI - 1], B = br.path && br.path[br.pathI];
          // distance from the bot to its current leg
          let dl = 9; if (A && B) { const sx = B[0]-A[0], sz = B[2]-A[2]; const L2 = sx*sx+sz*sz; let uu = L2>1e-6 ? ((bot.pos[0]-A[0])*sx+(bot.pos[2]-A[2])*sz)/L2 : 0; uu = Math.max(0, Math.min(1, uu)); dl = Math.hypot(bot.pos[0]-(A[0]+sx*uu), bot.pos[2]-(A[2]+sz*uu)); }
          const legClr = A && B ? (nav.lineClear(A, B, 0.10) ? "wide" : "narrow") : "none";
          const k = legClr + (dl < 0.15 ? "/onLine" : "/off") + (br._carLine ? "/lineFB" : "");
          H[k] = (H[k] || 0) + 1;
          const bx = sim.world.capsuleBlocked(bot.pos[0], bot.pos[1], bot.pos[2], 0.45, 1.7);
          const kk = (bx.kind || "?") + "|" + bx.id; HB[kk] = (HB[kk] || 0) + 1;
          if (bx.id === WATCH && (HX.length < 6) && (HX.length === 0 || HX[HX.length-1].pi !== pi)) HX.push({ pi, pos: bot.pos.map(v=>+v.toFixed(2)), A: A && A.map(v=>+v.toFixed(2)), B: B && B.map(v=>+v.toFixed(2)), dl: +dl.toFixed(2), legClr, path: br.path.map(q=>q.map(v=>+v.toFixed(1))) });
        }
      }
      if (hit) {
        const br = bot._brain;
        C.ticks++;
        if (sim.state.time - t0 < 0.5) C.startPhase++;
        if (!br.mvActive) C.notMv++;
        if (br._carOk === false) C.carFallback++; if (br._carLine) { C.line = (C.line||0)+1; br._carLine = false; }
        if (br.nudgeUntil > sim.state.time) C.nudge++;
        const vh = Math.atan2(bot.vel[0], bot.vel[2]), ch = Math.atan2(br.mvx, br.mvz);
        let d = Math.abs(vh - ch); if (d > Math.PI) d = 2 * Math.PI - d;
        lagHist[Math.min(5, Math.floor(d / (Math.PI / 12)))]++;
        const bx = sim.world.capsuleBlocked(bot.pos[0], bot.pos[1], bot.pos[2], 0.37, 1.7);
        const kk = bx ? (bx.kind || "?") + (bx.obb ? "(obb)" : "") : "none";
        boxK[kk] = (boxK[kk] || 0) + 1;
        if (ex.length < 12 && Math.random() < 0.02) ex.push({ pi, t: +(sim.state.time - t0).toFixed(2), pos: bot.pos.map((v) => +v.toFixed(2)), box: bx ? bx.id : null, carOk: br._carOk, car: br._carrot && br._carrot.map((v) => +v.toFixed(2)), pathI: br.pathI, n: br.path && br.path.length, wp: br.path && br.path[br.pathI] && br.path[br.pathI].map((v) => +v.toFixed(2)), prev: br.path && br.path[br.pathI - 1] && br.path[br.pathI - 1].map((v) => +v.toFixed(2)), mv: [+br.mvx.toFixed(2), +br.mvz.toFixed(2)], vel: [+bot.vel[0].toFixed(2), +bot.vel[2].toFixed(2)], yaw: +bot.yaw.toFixed(2) });
      }
      if (Math.hypot(bot.pos[0] - g[0], bot.pos[2] - g[2]) < 1.3 && Math.abs(bot.pos[1] - g[1]) < 1.2) break;
    }
  }
  console.log(mapId, JSON.stringify(C), "lag(15deg bins)", JSON.stringify(lagHist));
  console.log("  HUG", JSON.stringify(H)); console.log("  hugBoxes", JSON.stringify(Object.entries(HB).sort((a, c) => c[1] - a[1]).slice(0, 12)));
  for (const h of HX) console.log('  HX', JSON.stringify(h));
  console.log("  boxes", JSON.stringify(Object.entries(boxK).sort((a, c) => c[1] - a[1]).slice(0, 10)));
  for (const e of ex) console.log("   ", JSON.stringify(e));
}
