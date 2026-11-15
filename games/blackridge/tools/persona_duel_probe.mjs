#!/usr/bin/env node
// tools/persona_duel_probe.mjs - a scripted HUMAN persona fights ONE opponent, per skill band.
//
// The owner's PVP rule (2026-10-12): every opponent plays like an expert human,
// no cheats, beatable only by playing well. This answers "how often does a
// human of skill X win a fair 1v1 against an opponent of band B?" with a
// persona that can shoot back (tools/duel_probe.mjs only lets the human stand
// there). Open flat ground, Warden vs Warden, 100 hp each, both in plain view:
//
//   persona  reaction  aim sigma  recoil/rd  tracking   habit
//   novice   0.50 s    0.060 rad  .0050     4  rad/s   stands and sprays
//   regular  0.32 s    0.035 rad  .0030     8  rad/s   bursts, strafes between them
//   expert   0.22 s    0.020 rad  .0018     12 rad/s   bursts, counter-strafes, first-shot discipline
//
// Two openings: "UNAWARE" - the opponent has not noticed the human yet (the
// human sees first: how much does noticing cost the opponent?) and "MEETING" -
// the human's reaction clock starts the moment the opponent CONFIRMS the human
// (a mutual encounter; the fair coin-flip). Reported: human win%, mean time to
// resolution, the human's hit%, plus the opponent's pre-reaction round audit.
//   node tools/persona_duel_probe.mjs [--n 60] [--bands regular,hardened,veteran]
"use strict";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const N = parseInt(argOf("--n", "60"), 10);
const OV = Object.fromEntries(argOf("--ov", "").split(",").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return [k, v === "true" ? true : v === "false" ? false : parseFloat(v)]; })); // tuning aid: --ov jitter=0.014,acquire=2
const BANDS = argOf("--bands", "regular,hardened,veteran,expert").split(","); // "expert" = veteran + content.json difficulty.expert.ai.bandOverrides (PVP's only tier)

const S = await import(u("core/sim/sim.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const RNG = await import(u("core/rng.js"));
const TUN = await import(u("core/pvp/pvp_tuning.js"));
const CONTENT = JSON.parse((await import("fs")).readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));

const cc = { boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {}, bounds: { min: [-80, -2, -80], max: [80, 12, 80] } };
const nav = NAV.bakeNav(cc);
const PERSONAS = {
  // drift = uncompensated recoil climb per round (rad): the headless sim has no
  // view-side recoil, so the persona models the climb a real hand has to fight
  novice: { react: 0.50, sigma: 0.060, track: 4, burst: [6, 12], pause: 0.10, strafe: 0, drift: 0.0050 },
  regular: { react: 0.32, sigma: 0.035, track: 8, burst: [3, 5], pause: 0.35, strafe: 0.9, drift: 0.0030 },
  expert: { react: 0.22, sigma: 0.020, track: 12, burst: [3, 5], pause: 0.30, strafe: 1.0, drift: 0.0018 },
};
function gauss(r) { const a = 1 - r(), b = r(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x == null ? "  n/a" : x.toFixed(d));

function duel(personaId, band, opening, dist, seed) {
  const P = PERSONAS[personaId];
  const hr = RNG.mulberry32(seed * 977 + 13);
  let humanShots = 0, humanHits = 0, pre = 0, botDeadT = null, humanDeadT = null, botShots = 0, botHits = 0, botFirstShotT = null, humanFirstShotT = null;
  const sim = S.createSim({
    colliders: cc, nav, weapons: WD.WEAPONS, seed,
    emit: (type, d) => {
      const t = sim.state.time;
      if (type === "shot" && d.shooter === "P" && !d.impactOnly && !d.pen) { humanShots++; if (humanFirstShotT == null) humanFirstShotT = t; }
      else if (type === "shot" && d.shooter !== "P" && !d.impactOnly && !d.pen) {
        botShots++; if (botFirstShotT == null) botFirstShotT = t;
        const b = sim.state.bots[0], br = b && b._brain;
        if (!br || br.confirmT < 0 || t < br.confirmT + br.reactionS - 1e-6) pre++;
      } else if (type === "hurt" && d.victim === "P") botHits++;
      else if (type === "hurt" && d.victim !== "P" && d.attacker === "P") humanHits++;
      else if (type === "death") { if (d.victim === "P") humanDeadT = t; else botDeadT = t; }
    },
  });
  if (band === "expert") { { const dc = JSON.parse(JSON.stringify(TUN.resolveDifficulty("expert", CONTENT.difficulty))); Object.assign(dc.ai.bandOverrides.veteran, OV); sim.mission = new Proxy({ diffCfg: dc }, { get: (o, k) => (k in o ? o[k] : () => {}) }); } band = "veteran"; }
  sim.state.phase = "assault";
  const px = 0, pz = 0;
  sim.teleport("P", px, 0, pz);
  const bx = ((seed % 9) - 4) * 0.8;
  sim.spawnBotFromSpec({ archetype: "rifleman", band, squad: "d", pos: [bx, 0, -dist], yaw: opening === "meeting" ? Math.PI : Math.PI + ((seed % 5) - 2) * 0.35, alerted: opening === "meeting" });
  const bot = sim.state.bots[0];
  const p = sim.state.player;
  let yaw = 0, pitch = 0, seenT = null, firing = false, burstLeft = 0, pauseUntil = 0, side = 1, sideUntil = 0;
  let errY = 0, errP = 0, errUntil = 0, sprayN = 0;
  const T = 14;
  for (let i = 0; i < T * 60 && botDeadT == null && humanDeadT == null; i++) {
    const t = sim.state.time;
    const br = bot._brain;
    // the human's clock: UNAWARE = sees the opponent from t=0; MEETING = from the
    // moment the opponent confirms the human (hit-or-be-hit: nobody has the drop)
    if (seenT == null) {
      if (opening === "unaware") seenT = 0;
      else if (br && br.confirmT >= 0) seenT = br.confirmT;
    }
    const cmd = { moveX: 0, moveZ: 0, yaw, pitch, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
    if (seenT != null && t >= seenT + P.react && bot.alive) {
      const dx = bot.pos[0] - p.pos[0], dz = bot.pos[2] - p.pos[2];
      const ty = Math.atan2(-dx, -dz);
      const tp = Math.atan2((bot.pos[1] + 1.35) - (p.pos[1] + 1.62), Math.hypot(dx, dz));
      const dyaw = Math.atan2(Math.sin(ty - yaw), Math.cos(ty - yaw));
      const step = P.track / 60;
      yaw += Math.max(-step, Math.min(step, dyaw));
      pitch += Math.max(-step, Math.min(step, tp - pitch));
      const aimed = Math.abs(dyaw) < 0.03;
      if (t >= errUntil) { errY = gauss(hr) * P.sigma; errP = gauss(hr) * P.sigma; errUntil = t + 0.08; }
      const stationary = Math.hypot(p.vel[0], p.vel[2]) < 0.9;
      if (!firing && aimed && t >= pauseUntil && (stationary || P.strafe === 0)) { firing = true; burstLeft = P.burst[0] + Math.floor(hr() * (P.burst[1] - P.burst[0] + 1)); }
      if (firing) {
        sprayN += 0.208;
        cmd.fire = true; cmd.yaw = yaw + errY; cmd.pitch = pitch + errP + P.drift * Math.min(sprayN, 30);
        if (sim.state.time - (p.weapon.lastShotT ?? -9) < 0.001) {}
        burstLeft -= 0.208; // 750 rpm = 0.208 rounds per 1/60 s tick
        if (burstLeft <= 0) { firing = false; sprayN = 0; pauseUntil = t + P.pause * (0.7 + hr() * 0.6); }
      } else if (P.strafe > 0 && t < pauseUntil) {
        if (t >= sideUntil) { side = -side; sideUntil = t + 0.4 + hr() * 0.4; }
        cmd.moveX = side * P.strafe; cmd.yaw = yaw; cmd.pitch = pitch;
      } else { cmd.yaw = yaw; cmd.pitch = pitch; }
    }
    sim.step(cmd);
  }
  const conf = bot._brain ? bot._brain.confirmT : -1;
  return { botShots, botHits, botFirst: botFirstShotT != null && conf >= 0 ? botFirstShotT - conf : null, humanFirst: humanFirstShotT != null && conf >= 0 ? humanFirstShotT - conf : null, human: botDeadT != null && humanDeadT == null || (botDeadT != null && humanDeadT != null && botDeadT < humanDeadT), botDeadT, humanDeadT, shots: humanShots, hits: humanHits, pre, ended: botDeadT != null || humanDeadT != null };
}

console.log(`persona_duel_probe  n=${N} per cell  (Warden vs Warden, flat ground, 100 hp each, 18 m)`);
for (const opening of ["unaware", "meeting"]) {
  console.log(`\nopening: ${opening === "unaware" ? "UNAWARE - the human sees the opponent first" : "MEETING - reaction clocks start together (the opponent confirms the human)"}`);
  console.log("persona   vs band      human win%   draws%   mean resolve s   human hit%   opp hit%   opp 1st shot after confirm   human 1st shot   pre-reaction rounds");
  for (const persona of Object.keys(PERSONAS)) {
    for (const band of BANDS) {
      const rs = [];
      for (let s = 1; s <= N; s++) rs.push(duel(persona, band, opening, 18, s * 31 + 5));
      const decided = rs.filter((r) => r.ended);
      const wins = rs.filter((r) => r.ended && r.botDeadT != null && (r.humanDeadT == null || r.botDeadT < r.humanDeadT)).length;
      const res = decided.map((r) => Math.min(r.botDeadT ?? 99, r.humanDeadT ?? 99));
      const hit = 100 * rs.reduce((a, r) => a + r.hits, 0) / Math.max(1, rs.reduce((a, r) => a + r.shots, 0));
      console.log(`${persona.padEnd(9)} ${band.padEnd(10)} ${f(100 * wins / rs.length, 0).padStart(10)} ${f(100 * (rs.length - decided.length) / rs.length, 0).padStart(8)} ${f(res.reduce((a, b) => a + b, 0) / Math.max(1, res.length)).padStart(14)}   ${f(hit, 1).padStart(9)}   ${f(100 * rs.reduce((a, r) => a + r.botHits, 0) / Math.max(1, rs.reduce((a, r) => a + r.botShots, 0)), 1).padStart(8)}   ${f(mean(rs.filter((r) => r.botFirst != null).map((r) => r.botFirst))).padStart(14)}   ${f(mean(rs.filter((r) => r.humanFirst != null).map((r) => r.humanFirst))).padStart(14)}   ${rs.reduce((a, r) => a + r.pre, 0)}`);
    }
  }
}
