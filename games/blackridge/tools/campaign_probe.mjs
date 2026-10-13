#!/usr/bin/env node
// tools/campaign_probe.mjs - campaign (meridian_ward) sanity run per difficulty.
//
// A god-mode scripted player walks the R24 node tour (dock -> alley -> arcade ->
// plaza -> gallery -> boulevard -> platform -> customs -> exfil) through the real
// nav while the REAL mission driver spawns waves and the REAL bot brains fight.
// Reports per level: how far the tour got, bots spawned / killed-by-player (0:
// the player never fires), shots taken, worst "pushing without moving" window of
// any bot, AI ms/tick, and any exception.  Usage:
//   node tools/campaign_probe.mjs [--secs 240] [--levels casual,standard,hard] [--seed 3]
"use strict";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SECS = parseFloat(argOf("--secs", "240"));
const LEVELS = argOf("--levels", "casual,standard,hard").split(",");
const SEED = parseInt(argOf("--seed", "3"), 10);

const S = await import(u("core/sim/sim.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const raw = fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8");
const colliders = COL.buildColliders(1);
const nav = NAV.bakeNav(colliders, { cell: 0.75 });
const TOUR = ["dock_spawn", "quay_mid", "alley_dogleg_s", "alley_dogleg_n", "arcade_ground", "plaza_center", "gallery_mid", "blvd_mid", "customs_sandbags", "exfil"];

for (const level of LEVELS) {
  const content = JSON.parse(raw);
  content.difficultySelected = level;
  let shotsAtP = 0, hurt = 0, errs = 0;
  const events = [];
  const sim = S.createSim({ content, colliders, nav, weapons: WD.WEAPONS, seed: SEED, emit: (t, d) => { if (t === "hurt" && d.victim === "P") hurt++; if (t === "mission:phase" || t === "objective") events.push([t, d]); if (t === "shot" && d.shooter !== "P" && !d.impactOnly) shotsAtP++; } });
  sim.flags.god = true;
  sim.mission.start(sim);
  const p = sim.state.player;
  let stop = 0, nodeI = 1, path2 = null, pi = 1, maxBots = 0, spawned = new Set();
  const stuck = new Map(); let worstStuck = 0;
  let ticks = 0;
  try {
    while (ticks < SECS * 60 && sim.state.phase !== "won" && sim.state.phase !== "lost") {
      // steer the player along the tour
      const tgt = colliders.nodes[TOUR[Math.min(nodeI, TOUR.length - 1)]];
      if (!path2 || pi >= path2.length) { path2 = nav.findPath(p.pos, tgt); pi = 1; }
      const cmd = { moveX: 0, moveZ: 0, yaw: p.yaw, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
      if (path2 && pi < path2.length) {
        const w = path2[pi];
        const dx = w[0] - p.pos[0], dz = w[2] - p.pos[2];
        if (Math.hypot(dx, dz) < 0.8) pi++;
        cmd.yaw = Math.atan2(-dx, -dz); cmd.moveZ = 1; cmd.sprint = true; cmd.interact = (ticks % 120) < 4;
      }
      if (Math.hypot(tgt[0] - p.pos[0], tgt[2] - p.pos[2]) < 2.5) { nodeI++; path2 = null; }
      sim.step(cmd);
      ticks++;
      for (const b of sim.state.bots) spawned.add(b.id);
      if (ticks % 60 === 0) {
        const t = sim.state.time;
        maxBots = Math.max(maxBots, sim.state.bots.filter((b) => b.alive).length);
        for (const b of sim.state.bots) {
          if (!b.alive) { stuck.delete(b.id); continue; }
          const brn = b._brain; const s = stuck.get(b.id);
          const trying = brn && brn.mvActive && !brn.arrived;
          if (!s) { stuck.set(b.id, { x: b.pos[0], z: b.pos[2], t }); continue; }
          if (Math.hypot(b.pos[0] - s.x, b.pos[2] - s.z) > 0.5 || !trying) { s.x = b.pos[0]; s.z = b.pos[2]; s.t = t; }
          else worstStuck = Math.max(worstStuck, t - s.t);
        }
      }
    }
  } catch (e) { errs++; console.log("EXCEPTION", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e); }
  const alive = sim.state.bots.filter((b) => b.alive).length;
  console.log(`${level.padEnd(8)} t=${sim.state.time.toFixed(0)}s phase=${sim.state.phase} beat=${sim.state.beat != null ? sim.state.beat : "?"} tourNode=${Math.min(nodeI, TOUR.length - 1)}/${TOUR.length - 1} bots seen=${spawned.size} peakAlive=${maxBots} alive=${alive} bullets-at-P=${shotsAtP} hurt=${hurt} worstStuck=${worstStuck.toFixed(1)}s ai=${BF.AI_PERF.avgMs.toFixed(3)}ms/tick errors=${errs}`);
}
