#!/usr/bin/env node
// tools/duel_probe.mjs - one bot vs a scripted PLAYER, per skill band (BOT-AI PASS).
//
// Open flat ground, one Warden bot of band B, the human on its feet in plain
// view at 15 / 30 m. Nothing but the band differs between runs. Measured over N
// seeds, for a player who (a) stands still and (b) strafes (+-1 s side steps):
//   see->shot   s from t=0 (player enters the bot's view cone) to the bot's
//               first round: notice time + latched reaction + aim-up
//   hit%        rounds that hurt the player / rounds fired in the first 6 s
//   ttk         s from the first round to the player's death (HP 100, no regen
//               in that window), over duels the bot won within 12 s
//   win%        player dead inside 12 s
// Fairness checks ride along: no round before the latched reaction (the same
// audit ai.selftest runs), band reaction ranges respected.
//   node tools/duel_probe.mjs [--n 40]
"use strict";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const N = parseInt(argOf("--n", "40"), 10);

const S = await import(u("core/sim/sim.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const TUN = await import(u("core/pvp/pvp_tuning.js"));
const CONTENT = JSON.parse((await import("fs")).readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
const LADDER = ["recruit", "regular", "hardened", "veteran"];

const cc = {
  boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {},
  bounds: { min: [-80, -2, -80], max: [80, 12, 80] },
};
const nav = NAV.bakeNav(cc);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x == null ? "  n/a" : x.toFixed(d));

function duel(band, dist, strafe, seed) {
  let shots = 0, hits = 0, firstShotT = null, firstHitT = null, deadT = null, pre = 0;
  const sim = S.createSim({
    colliders: cc, nav, weapons: WD.WEAPONS, seed,
    emit: (type, d) => {
      const t = sim.state.time;
      if (type === "shot" && d.shooter !== "P" && !d.impactOnly && !d.pen) {
        shots++; if (firstShotT == null) firstShotT = t;
        const b = sim.state.bots[0], br = b && b._brain;
        if (!br || br.confirmT < 0 || t < br.confirmT + br.reactionS - 1e-6) pre++;
      } else if (type === "hurt" && d.victim === "P") { hits++; if (firstHitT == null) firstHitT = t; }
      else if (type === "death" && d.victim === "P" && deadT == null) deadT = t;
    },
  });
  if (band === "expert") { { const dc = TUN.resolveDifficulty("expert", CONTENT.difficulty); sim.mission = new Proxy({ diffCfg: dc }, { get: (o, k) => (k in o ? o[k] : () => {}) }); } band = "veteran"; }
  sim.state.phase = "assault";
  sim.teleport("P", 0, 0, 0);
  const yawToBot = 0; // player yaw 0 looks toward -z (the bot stands at -dist)
  sim.state.player.yaw = yawToBot;
  const id = sim.spawnBotFromSpec({ archetype: "rifleman", band, squad: "d", pos: [(seed % 7) - 3, 0, -dist], yaw: Math.PI + ((seed % 5) - 2) * 0.35, alerted: false });
  void id;
  let side = 1, sideUntil = 0.3 + (seed % 5) * 0.2;
  const T = 12;
  for (let i = 0; i < T * 60 && deadT == null; i++) {
    const t = sim.state.time;
    const cmd = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
    if (strafe) { if (t >= sideUntil) { side = -side; sideUntil = t + 0.7 + ((seed * 7 + i) % 5) * 0.12; } cmd.moveX = side; }
    sim.step(cmd);
    if (sim.state.player.hp <= 0 && deadT == null) deadT = sim.state.time;
  }
  const within6 = sim.state.time;
  void within6;
  return { shots, hits, firstShotT, firstHitT, deadT, pre };
}

console.log(`duel_probe  n=${N} per cell   (Warden rifleman, flat open ground, player in plain view)`);
for (const strafe of [false, true]) {
  for (const dist of [15, 30]) {
    console.log(`\nplayer ${strafe ? "STRAFING" : "standing"}  at ${dist} m`);
    console.log("band      see->shot s   hit%   ttk s   win%   pre-reaction rounds");
    for (const band of [...LADDER, "expert"]) {
      const rs = [];
      for (let s = 1; s <= N; s++) rs.push(duel(band, dist, strafe, s * 13 + dist));
      const seen = rs.filter((r) => r.firstShotT != null);
      const kills = rs.filter((r) => r.deadT != null);
      const hit = 100 * rs.reduce((a, r) => a + r.hits, 0) / Math.max(1, rs.reduce((a, r) => a + r.shots, 0));
      console.log(`${band.padEnd(9)} ${f(mean(seen.map((r) => r.firstShotT))).padStart(10)} ${f(hit, 1).padStart(7)} ${f(mean(kills.map((r) => r.deadT - r.firstShotT))).padStart(7)} ${f(100 * kills.length / rs.length, 0).padStart(6)}   ${rs.reduce((a, r) => a + r.pre, 0)}`);
    }
  }
}
