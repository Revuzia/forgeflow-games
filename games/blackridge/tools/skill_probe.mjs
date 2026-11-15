#!/usr/bin/env node
// tools/skill_probe.mjs — does the difficulty ladder actually move? (BOT-AI PASS)
//
// Real PVP matches (real arenas, real nav, real commander, real spawn director,
// all nine bots, pistol start + racks/drops) with the human slot PARKED
// (noTarget + god: nobody perceives or shoots it) so the match is a pure
// bot-vs-bot experiment. Per (map, mode, seed) the roster's two sides are
// handed skill MIXES by override: for each difficulty level L the mix is the
// level's ENEMY preset (match/roster.js DIFFICULTY_PRESETS) shifted by the
// level's ai.enemyBandShift (content.json difficulty.<level>.ai) - exactly the
// bands a human would face on that level. Every pairing is played BOTH ways
// round (the parked human leaves team 0 one body short of team 1, so side
// swapping cancels the asymmetry).
//
//   node tools/skill_probe.mjs [--maps lanternwalk,switchyard,saltmarket]
//        [--modes tdm,ctf] [--seeds 4] [--secs 150] [--levels casual,standard,hard]
//
// Reported per LEVEL (pooled over every match it plays, all opponents):
//   win%      share of matches won on kills (CTF: captures, then kills)
//   K/D       kills per death
//   acc%      hits / shots fired by that level's bots (bot rounds that hurt a
//             member of the other team / non-impact shot events)
//   ttk s     mean time from the first hit on a victim by a killer to the kill
//   flank/min botstate 'flank' entries per side-minute
//   react s   mean latched reaction roll (brain.reactionLog)
//   peek%     share of combat-ticks the bot spent leaning out of cover
// Monotonic means casual < standard < hard on win%/K-D/acc%/flank, and the
// reverse on ttk and react.
"use strict";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const MAPS = argOf("--maps", "lanternwalk,switchyard,saltmarket").split(",");
const MODES = argOf("--modes", "tdm").split(",");
const SEEDS = parseInt(argOf("--seeds", "4"), 10);
const SECS = parseFloat(argOf("--secs", "150"));
const LEVELS = argOf("--levels", "casual,standard,hard").split(",");
const JSON_OUT = argOf("--json", null);
const QUIET = argv.includes("--quiet");
const NOSHIFT = argv.includes("--noshift"); // baseline: the pre-pass ladder = the roster presets unshifted

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const ROSTER = await import(u("core/match/roster.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const LADDER = ["recruit", "regular", "hardened", "veteran"];
const TUN = await import(u("core/pvp/pvp_tuning.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa"]) {
  const mod = await import(u(`core/match/modes/${id}.js`));
  MATCH.registerMode(id, mod.createMode);
}

// ---- the band mix a human faces on each level (enemy preset + ai shift)
function levelMix(level) {
  const cfg = TUN.resolveDifficulty(level, content.difficulty);
  const shift = NOSHIFT ? 0 : ((cfg && cfg.ai && cfg.ai.enemyBandShift) | 0);
  const raw = ROSTER.DIFFICULTY_PRESETS[level].enemy.map((b) => (b === "VETERAN_SLOT" ? "hardened" : b));
  return raw.map((b) => {
    const i = Math.max(0, Math.min(LADDER.length - 1, LADDER.indexOf(b) + shift));
    return LADDER[i];
  });
}
const MIX = {};
for (const l of LEVELS) MIX[l] = levelMix(l);
if (!QUIET) for (const l of LEVELS) console.log(`mix ${l.padEnd(8)} ${MIX[l].join(" ")}`);

const world = {}; // map -> { colliders, nav, flat }
function mapWorld(id) {
  if (!world[id]) {
    const colliders = COL.buildCollidersFor(id, 1);
    world[id] = { colliders, nav: NAV.bakeNav(colliders, { cell: 0.75 }) };
  }
  return world[id];
}
const FLAT = ["arena", "spawnPoints", "clusters", "flags"];
function selectArena(id) {
  const blk = content.arenas && content.arenas[id];
  if (blk) for (const k of FLAT) if (blk[k] !== undefined) content[k] = blk[k];
}

const NULL_CMD = {
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false,
  sprint: false, fire: false, ads: false, reload: false, switchTo: null,
  interact: false, grenade: false,
};

// side[0] / side[1]: the level playing team 0 / team 1
function runMatch(mapId, mode, seed, side) {
  selectArena(mapId);
  const { colliders, nav } = mapWorld(mapId);
  const events = [];
  const holder = { sim: null };
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode, tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns },
    emit: (type, data) => { if (type === "shot" || type === "hurt" || type === "death" || type === "botstate") events.push({ type, data, t: holder.sim ? holder.sim.state.time : 0 }); },
  });
  holder.sim = sim;
  sim.mission.start(sim);
  const M = sim.state.match;
  if (SECS > 0) { sim.match.m.rules.timeLimitS = SECS; sim.match.m.rules.scoreLimit = 9999; if (sim.match.m.rules.captureLimit) sim.match.m.rules.captureLimit = 9999; }
  sim.flags.noTarget = true; sim.flags.god = true;     // the parked human
  const startT = sim.state.time;
  const maxTicks = Math.ceil((SECS + 40) * 60) + 600;
  const teamOf = new Map(); // botId -> team
  const lvlOf = (team) => side[team === 0 ? 0 : 1];
  let ticks = 0;
  let peekTicks = 0, combatTicks = 0;
  const lastHead = new Map(); const mv = {}; // per level: reversals, samples, idleWall, idleSamples
  for (const l of new Set(side)) mv[l] = { rev: 0, moveSamples: 0, idleWall: 0, idle: 0, secs: 0 };
  while (ticks < maxTicks && M.phase !== "ended") {
    for (const b of sim.state.bots) {
      if (b._exp) continue;
      b._exp = true;
      const team = b.team === 0 ? 0 : 1;
      const mix = MIX[lvlOf(team)];
      const idx = ((b.actorId || 1) - (team === 0 ? 1 : 5) + mix.length * 4) % mix.length;
      b.band = mix[idx];
      b._lvl = lvlOf(team);
      teamOf.set(b.id, team);
    }
    sim.step(NULL_CMD);
    ticks++;
    if (ticks % 15 === 0) { // 0.25 s movement-quality sampler (nav-independent)
      for (const b of sim.state.bots) {
        if (!b.alive || !b._lvl) continue;
        const m = mv[b._lvl]; if (!m) continue;
        const sp = Math.hypot(b.vel[0], b.vel[2]);
        if (sp > 1.5) {
          const h = Math.atan2(b.vel[0], b.vel[2]);
          const lh = lastHead.get(b.id);
          if (lh != null) { let d = Math.abs(h - lh); if (d > Math.PI) d = 2 * Math.PI - d; m.moveSamples++; if (d > 2.1) m.rev++; }
          lastHead.set(b.id, h);
        } else lastHead.delete(b.id);
        if ((b.state === "patrol" || b.state === "alert") && sp < 0.3) {
          m.idle++;
          if (sim.world.capsuleBlocked(b.pos[0], b.pos[1], b.pos[2], 0.62, 1.7)) m.idleWall++;
        }
      }
    }
    if (ticks % 6 === 0) {
      for (const b of sim.state.bots) {
        if (!b.alive || b.state !== "combat" || !b._brain) continue;
        combatTicks++;
        if (b._brain.pk && b._brain.pk.on && b._brain.pk.ph === "out") peekTicks++;
      }
    }
  }
  // ---- harvest per level
  const per = {};
  for (const l of new Set(side)) per[l] = { kills: 0, deaths: 0, shots: 0, hits: 0, ttk: [], flanks: 0, react: [], peek: 0, combat: 0, win: 0, secs: 0 };
  const teamLvl = (id) => { const t = teamOf.get(id); return t == null ? null : lvlOf(t); };
  const firstHit = new Map(); // victim|attacker -> t
  for (const ev of events) {
    const d = ev.data;
    if (ev.type === "shot") {
      if (d.impactOnly || d.pen || d.shooter === "P") continue;
      const l = teamLvl(d.shooter); if (l && per[l]) per[l].shots++;
    } else if (ev.type === "hurt") {
      if (d.attacker === "P" || d.attacker == null) continue;
      const la = teamLvl(d.attacker), lv = d.victim === "P" ? null : teamLvl(d.victim);
      if (la && lv && teamOf.get(d.attacker) === teamOf.get(d.victim)) continue; // friendly (should not occur)
      if (la && per[la]) per[la].hits++;
      const k = d.victim + "|" + d.attacker;
      if (!firstHit.has(k)) firstHit.set(k, ev.t);
    } else if (ev.type === "death") {
      if (d.victim === "P") continue;
      const lv = teamLvl(d.victim), la = d.attacker === "P" || d.attacker == null ? null : teamLvl(d.attacker);
      if (lv && per[lv]) per[lv].deaths++;
      if (la && per[la] && teamOf.get(d.attacker) !== teamOf.get(d.victim)) {
        per[la].kills++;
        const k0 = firstHit.get(d.victim + "|" + d.attacker);
        if (k0 != null) per[la].ttk.push(ev.t - k0);
      }
    } else if (ev.type === "botstate") {
      if (d.state === "flank") { const l = teamLvl(d.botId); if (l && per[l]) per[l].flanks++; }
    }
  }
  for (const b of sim.state.bots) {
    const l = b._lvl;
    if (!l || !per[l] || !b._brain) continue;
    for (const r of b._brain.reactionLog || []) per[l].react.push(r.reactionS);
  }
  const secs = sim.state.time - startT;
  // winner: kills (captures first in ctf)
  const t0k = M.teams[0] ? M.teams[0].score : 0, t1k = M.teams[1] ? M.teams[1].score : 0;
  const t0c = M.teams[0] ? (M.teams[0].captures || 0) : 0, t1c = M.teams[1] ? (M.teams[1].captures || 0) : 0;
  let winTeam = null;
  if (mode === "ctf" && t0c !== t1c) winTeam = t0c > t1c ? 0 : 1;
  else if (t0k !== t1k) winTeam = t0k > t1k ? 0 : 1;
  if (winTeam !== null) per[lvlOf(winTeam)].win += 1;
  for (const l of Object.keys(per)) {
    per[l].secs += secs * (side.filter((x) => x === l).length);
    per[l].combat += combatTicks * 0; // filled below by team
  }
  for (const l of Object.keys(per)) per[l].mv = mv[l];
  return { per, secs, kills: [t0k, t1k], caps: [t0c, t1c], winTeam, side: side.slice(), peekTicks, combatTicks };
}

const agg = {};
for (const l of LEVELS) agg[l] = { matches: 0, wins: 0, kills: 0, deaths: 0, shots: 0, hits: 0, ttk: [], flanks: 0, react: [], secs: 0, rev: 0, moveS: 0, idleWall: 0, idle: 0 };
const rows = [];
const t0 = Date.now();
const pairs = [];
for (let i = 0; i < LEVELS.length; i++) for (let j = i + 1; j < LEVELS.length; j++) pairs.push([LEVELS[i], LEVELS[j]]);
for (const mapId of MAPS) for (const mode of MODES) for (let seed = 1; seed <= SEEDS; seed++) for (const [a, b] of pairs) for (const swap of [0, 1]) {
  const side = swap ? [b, a] : [a, b];
  const r = runMatch(mapId, mode, seed * 101 + (swap ? 7 : 0), side);
  rows.push({ mapId, mode, seed, side, kills: r.kills, caps: r.caps, winTeam: r.winTeam });
  for (const l of Object.keys(r.per)) {
    const p = r.per[l], A = agg[l];
    A.matches += 1; A.wins += p.win; A.kills += p.kills; A.deaths += p.deaths; A.shots += p.shots; A.hits += p.hits;
    A.ttk.push(...p.ttk); A.flanks += p.flanks; A.react.push(...p.react); A.secs += r.secs;
    A.rev += p.mv.rev; A.moveS += p.mv.moveSamples; A.idleWall += p.mv.idleWall; A.idle += p.mv.idle;
  }
  if (!QUIET) console.log(`  ${mapId.padEnd(11)} ${mode} s${String(seed).padStart(2)} ${side[0].padEnd(8)}(T0) vs ${side[1].padEnd(8)}(T1) kills ${r.kills[0]}-${r.kills[1]}${mode === "ctf" ? ` caps ${r.caps[0]}-${r.caps[1]}` : ""} win=${r.winTeam == null ? "draw" : r.side[r.winTeam]} (${Math.round((Date.now() - t0) / 1000)}s)`);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x == null ? "  n/a" : x.toFixed(d));
console.log(`\nskill_probe  maps=${MAPS.join(",")} modes=${MODES.join(",")} seeds=${SEEDS} secs=${SECS}  matches=${rows.length}`);
console.log("level     win%   K/D   kills deaths  acc%   ttk s  flank/min  react s  reversals/100 moves  idle-at-wall%");
const out = {};
for (const l of LEVELS) {
  const A = agg[l];
  const row = {
    win: 100 * A.wins / Math.max(1, A.matches), kd: A.kills / Math.max(1, A.deaths), kills: A.kills, deaths: A.deaths,
    acc: 100 * A.hits / Math.max(1, A.shots), ttk: mean(A.ttk), flank: A.flanks / Math.max(1e-9, A.secs / 60), react: mean(A.react),
    rev: 100 * A.rev / Math.max(1, A.moveS), idleWall: 100 * A.idleWall / Math.max(1, A.idle),
  };
  out[l] = row;
  console.log(`${l.padEnd(9)} ${f(row.win, 1).padStart(5)} ${f(row.kd).padStart(5)} ${String(row.kills).padStart(6)} ${String(row.deaths).padStart(6)} ${f(row.acc, 1).padStart(5)} ${f(row.ttk).padStart(6)}  ${f(row.flank, 2).padStart(8)}  ${f(row.react).padStart(7)}  ${f(row.rev, 2).padStart(12)}  ${f(row.idleWall, 1).padStart(12)}`);
}
// monotonic verdict
const order = LEVELS;
const mono = (key, dir) => order.every((l, i) => i === 0 || (dir > 0 ? out[l][key] > out[order[i - 1]][key] : out[l][key] < out[order[i - 1]][key]));
console.log(`monotonic ${order.join(" < ")}:  win% ${mono("win", 1) ? "YES" : "NO"}  K/D ${mono("kd", 1) ? "YES" : "NO"}  acc% ${mono("acc", 1) ? "YES" : "NO"}  flank ${mono("flank", 1) ? "YES" : "NO"}  ttk(down) ${mono("ttk", -1) ? "YES" : "NO"}  react(down) ${mono("react", -1) ? "YES" : "NO"}`);
console.log(`wall ${Math.round((Date.now() - t0) / 1000)} s`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ out, rows }, null, 1));
