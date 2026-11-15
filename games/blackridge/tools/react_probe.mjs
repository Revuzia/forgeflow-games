#!/usr/bin/env node
// tools/react_probe.mjs — shot in the back (2026-11 AI review). Flat open
// ground; one bot walks AWAY from the human (a travel order 40 m ahead); the
// human opens fire on its back from 15 m. Measured per band over N seeds:
//   turn s     first hit -> the bot faces within 25 deg of the shooter
//   return s   first hit -> the bot's first round back
//   win%       the human died inside 10 s (the bot won the duel it was handed)
// Fairness rides along: no bot round before its latched reaction.
//   node tools/react_probe.mjs [--n 30]
"use strict";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const N = parseInt(argOf("--n", "30"), 10);
const S = await import(u("core/sim/sim.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const TUN = await import(u("core/pvp/pvp_tuning.js"));
const CONTENT = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
const cc = { boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {}, bounds: { min: [-80, -2, -80], max: [80, 12, 80] } };
const nav = NAV.bakeNav(cc);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x == null ? "  n/a" : x.toFixed(d));
const ang = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function run(band, seed) {
  let firstHitT = null, turnT = null, retT = null, deadT = null, pre = 0;
  const sim = S.createSim({
    colliders: cc, nav, weapons: WD.WEAPONS, seed,
    emit: (type, d) => {
      const t = sim.state.time;
      if (type === "hurt" && d.victim !== "P" && firstHitT == null) firstHitT = t;
      else if (type === "shot" && d.shooter !== "P" && !d.impactOnly && !d.pen) {
        if (retT == null && firstHitT != null) retT = t;
        const b = sim.state.bots[0], br = b && b._brain;
        if (!br || br.confirmT < 0 || t < br.confirmT + br.reactionS - 1e-6) pre++;
      } else if (type === "death" && d.victim === "P" && deadT == null) deadT = t;
    },
  });
  if (band === "expert") { const dc = TUN.resolveDifficulty("expert", CONTENT.difficulty); sim.mission = new Proxy({ diffCfg: dc }, { get: (o, k) => (k in o ? o[k] : () => {}) }); band = "veteran"; }
  sim.state.phase = "assault";
  sim.teleport("P", 0, 0, 0);
  sim.state.player.yaw = 0;
  sim.spawnBotFromSpec({ archetype: "rifleman", band, squad: "d", pos: [(seed % 5) - 2, 0, -15], yaw: 0, alerted: false });
  sim.step({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0 });
  const bot = sim.state.bots[0];
  BF.aiNavGoto(sim, nav, bot, [bot.pos[0], 0, -55], false);
  for (let i = 0; i < 10 * 60 && deadT == null; i++) {
    const t = sim.state.time;
    const b = sim.state.bots[0];
    const dx = b.pos[0] - sim.state.player.pos[0], dz = b.pos[2] - sim.state.player.pos[2];
    const yaw = Math.atan2(-dx, -dz);
    const hd = Math.hypot(dx, dz);
    const pitch = Math.atan2(1.1 - 1.62, hd);
    const fire = t > 0.4 && b.alive && i % 30 === 0; // one aimed tap every 0.5 s
    sim.step({ moveX: 0, moveZ: 0, yaw, pitch, jump: false, crouch: false, sprint: false, fire, ads: true, reload: false, switchTo: null, interact: false, grenade: false });
    if (firstHitT != null && turnT == null && b.alive) {
      const toP = Math.atan2(-(sim.state.player.pos[0] - b.pos[0]), -(sim.state.player.pos[2] - b.pos[2]));
      if (Math.abs(ang(b.yaw - toP)) < 25 * Math.PI / 180) turnT = sim.state.time;
    }
    if (sim.state.player.hp <= 0 && deadT == null) deadT = sim.state.time;
    if (!b.alive) break;
  }
  if (process.env.RDBG) { const b = sim.state.bots[0]; console.log(JSON.stringify({ seed, firstHitT, alive: b.alive, hp: b.hp, st: b.state, t: sim.state.time, php: sim.state.player.hp, aw: b.percept && b.percept.awareness, tgt: b.percept && b.percept.target })); }
  return { turn: turnT != null ? turnT - firstHitT : null, ret: retT != null ? retT - firstHitT : null, won: deadT != null, pre, hit: firstHitT != null };
}
console.log(`react_probe n=${N}  (bot walking away, the human opens fire on its back from 15 m)`);
console.log("band      turn s   return s   bot win%   turned%   pre-reaction rounds");
for (const band of ["regular", "hardened", "veteran", "expert"]) {
  const rs = []; for (let s = 1; s <= N; s++) rs.push(run(band, s * 17 + 3));
  const hit = rs.filter((r) => r.hit);
  console.log(`${band.padEnd(9)} ${f(mean(hit.filter((r) => r.turn != null).map((r) => r.turn))).padStart(6)} ${f(mean(hit.filter((r) => r.ret != null).map((r) => r.ret))).padStart(9)} ${f(100 * hit.filter((r) => r.won).length / Math.max(1, hit.length), 0).padStart(9)} ${f(100 * hit.filter((r) => r.turn != null).length / Math.max(1, hit.length), 0).padStart(9)}   ${rs.reduce((a, r) => a + r.pre, 0)}`);
}
