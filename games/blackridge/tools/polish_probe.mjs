#!/usr/bin/env node
// tools/polish_probe.mjs — v149 polish-pass headless experiments (real arenas,
// real nav, real commander, real spawn director, deterministic seeds).
//
//   --exp idle   STRONGHOLD with the human slot IDLE (no input, can be shot,
//                respawns like anyone): does the human's side lose every time?
//                Full rules unless --secs caps the clock. Reports per match
//                score, winner and how long the absent-teammate cover rule
//                (core/ai/roles/dom.js) was active.
//   --exp tier   the hidden tier ladder: team T plays tier t, the other team
//                plays a FIXED reference profile (tier --ref, default 2: a
//                human-like target), both side assignments (cancels the parked
//                human's one-body asymmetry), human parked (god + noTarget).
//                Reports per tier: win%, K/D, acc%, ttk, react.
//
//   node tools/polish_probe.mjs --exp idle [--maps a,b,c] [--seeds 3] [--secs 0] [--nocover]
//   node tools/polish_probe.mjs --exp tier [--maps a,b,c] [--seeds 1] [--secs 150] [--ref 2] [--mode tdm]
"use strict";
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const EXP = argOf("--exp", "idle");
const MAPS = argOf("--maps", "lanternwalk,switchyard,saltmarket").split(",");
const SEEDS = parseInt(argOf("--seeds", EXP === "idle" ? "3" : "1"), 10);
const SECS = parseFloat(argOf("--secs", EXP === "idle" ? "0" : "150"));
const REF = parseInt(argOf("--ref", "2"), 10);
const MODE = argOf("--mode", EXP === "idle" ? "dom" : "tdm");
const TIERS = argOf("--tiers", "0,1,2,3,4").split(",").map(Number);
const NOCOVER = argv.includes("--nocover");

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const DOMR = await import(u("core/ai/roles/dom.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa", "dom", "hill", "tags", "ladder"]) {
  const mod = await import(u(`core/match/modes/${id}.js`));
  MATCH.registerMode(id, mod.createMode);
}
if (NOCOVER && DOMR.DOM_TUNING) DOMR.DOM_TUNING.absentCover = false;
if (process.env.SPLIT && DOMR.DOM_TUNING) DOMR.DOM_TUNING.split = process.env.SPLIT.split(",").map(Number);
if (process.env.NOROLES && DOMR.DOM_TUNING) DOMR.DOM_TUNING.roles = false;
if (process.env.NOSPAWN && DOMR.DOM_TUNING) DOMR.DOM_TUNING.spawnUnanchor = false;
if (process.env.ABS_S && DOMR.DOM_TUNING) DOMR.DOM_TUNING.absentS = +process.env.ABS_S;

const world = {};
function mapWorld(id) {
  if (!world[id]) { const colliders = COL.buildCollidersFor(id, 1); world[id] = { colliders, nav: NAV.bakeNav(colliders, { cell: 0.75 }) }; }
  return world[id];
}
const FLAT = ["arena", "spawnPoints", "clusters", "flags"];
function selectArena(id) {
  const blk = content.arenas && content.arenas[id];
  if (blk) for (const k of FLAT) if (blk[k] !== undefined) content[k] = blk[k];
}
const NULL_CMD = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };

function runMatch(mapId, mode, seed, opts) {
  selectArena(mapId);
  const { colliders, nav } = mapWorld(mapId);
  const events = [];
  const holder = { sim: null };
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode, tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns },
    emit: (type, data) => { if (type === "shot" || type === "hurt" || type === "death") events.push({ type, data, t: holder.sim ? holder.sim.state.time : 0 }); },
  });
  holder.sim = sim;
  if (opts.identity) sim.identity = opts.identity;
  sim.mission.start(sim);
  const M = sim.state.match;
  if (SECS > 0) { sim.match.m.rules.timeLimitS = SECS; if (opts.noLimit) sim.match.m.rules.scoreLimit = 9999; }
  if (opts.parked) { sim.flags.noTarget = true; sim.flags.god = true; }
  const maxTicks = Math.ceil(((sim.match.m.rules.timeLimitS || 600) + 120) * 60) + 600;
  let ticks = 0, coverTicks = 0, liveTicks = 0;
  const timeline = [];
  const seenTeam = new Map(); // every bot id ever seen -> team (ids change on respawn)
  while (ticks < maxTicks && M.phase !== "ended") {
    if (process.env.BENCH1) { // control experiment: park one SLATE operator far off-map (4 v 4 + the idle human)
      const b = sim.state.bots.find((x) => x.team === 1 && x.actorId === 9);
      if (b) { b.pos[0] = 0; b.pos[1] = -40; b.pos[2] = 0; b.vel[0] = b.vel[1] = b.vel[2] = 0; }
    }
    sim.step(NULL_CMD);
    ticks++;
    for (const b of sim.state.bots) if (!seenTeam.has(b.id)) seenTeam.set(b.id, b.team);
    if (M.phase === "live" || M.phase === "overtime") {
      liveTicks++;
      const dbg = sim.internal && sim.internal.domCover;
      if (dbg && dbg[0]) coverTicks++;
      if (ticks % 150 === 0 && M.mode && M.mode.zones) {
        const own = M.mode.zones.map((z) => {
          const o = z.owner === 0 ? "U" : z.owner === 1 ? "T" : "-";
          if (!process.env.PRES) return o;
          const n = [0, 0];
          for (const b of sim.state.bots) if (b.alive && Math.hypot(b.pos[0] - z.pos[0], b.pos[2] - z.pos[2]) <= z.r) n[b.team]++;
          return o + n[0] + n[1];
        }).join(process.env.PRES ? "," : "");
        timeline.push(own);
        if (process.env.ROLES) {
          const r = sim.state.bots.filter((b) => b.alive && b._obj).map((b) => b.team + ":" + b._obj.role[0] + (b._obj.reason || "").slice(0, 6)).join(" ");
          timeline.push("   " + r);
        }
      }
    }
  }
  const teamOf = (who) => { if (who === "P") return 0; const t = seenTeam.get(who); return t == null ? null : t; };
  const per = [0, 1].map(() => ({ kills: 0, deaths: 0, shots: 0, hits: 0, ttk: [] }));
  const firstHit = new Map();
  for (const ev of events) {
    const d = ev.data;
    if (ev.type === "shot") { if (d.impactOnly || d.pen || d.shooter === "P") continue; const tm = teamOf(d.shooter); if (tm != null) per[tm].shots++; }
    else if (ev.type === "hurt") { if (d.attacker == null || d.attacker === "P") continue; const tm = teamOf(d.attacker); if (tm != null && tm !== teamOf(d.victim)) per[tm].hits++; const k = d.victim + "|" + d.attacker; if (!firstHit.has(k)) firstHit.set(k, ev.t); }
    else if (ev.type === "death") {
      const tv = d.victimTeam != null ? d.victimTeam : teamOf(d.victim); if (tv != null) per[tv].deaths++;
      if (d.attacker != null && d.attacker !== "P") { const ta = d.attackerTeam != null ? d.attackerTeam : teamOf(d.attacker); if (ta != null && ta !== tv) { per[ta].kills++; const k0 = firstHit.get(d.victim + "|" + d.attacker); if (k0 != null) per[ta].ttk.push(ev.t - k0); } }
    }
  }
  const sc = [M.teams[0].score, M.teams[1].score];
  const win = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
  return { sc, win, per, secs: sim.state.time, coverFrac: liveTicks ? coverTicks / liveTicks : 0, result: M.result, timeline };
}

const t0 = Date.now();
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
if (EXP === "idle") {
  let wins = 0, losses = 0, draws = 0;
  const rows = [];
  for (const mapId of MAPS) for (let s = 1; s <= SEEDS; s++) {
    const seed = s * 7919 + 13;
    const r = runMatch(mapId, MODE, seed, { identity: null, parked: false });
    if (r.win === 0) wins++; else if (r.win === 1) losses++; else draws++;
    rows.push(r);
    if (process.env.TL) console.log("    zones every 2.5 s (U us, T them): " + r.timeline.join(" "));
    console.log(`  ${mapId.padEnd(11)} ${MODE} seed ${seed}: US ${r.sc[0]} - ${r.sc[1]} THEM  ${r.win === 0 ? "WIN " : r.win === 1 ? "LOSS" : "DRAW"}  kills ${r.per[0].kills}-${r.per[1].kills}  cover ${(100 * r.coverFrac).toFixed(0)}% of live  (${Math.round(r.secs)} s sim, ${Math.round((Date.now() - t0) / 1000)} s wall)`);
  }
  console.log(`\nidle-player ${MODE}${NOCOVER ? " [cover rule OFF]" : ""}: player's side W ${wins} / L ${losses} / D ${draws} of ${rows.length}; mean score ${mean(rows.map((r) => r.sc[0])).toFixed(1)} - ${mean(rows.map((r) => r.sc[1])).toFixed(1)}`);
} else {
  console.log(`tier ladder vs fixed reference tier ${REF} (${MODE}, ${SECS}s, maps ${MAPS.join(",")}, seeds ${SEEDS}, both sides)`);
  console.log("tier  matches  win%   K/D    kills deaths  acc%   ttk s");
  const out = {};
  for (const T of TIERS) {
    const A = { m: 0, w: 0, k: 0, d: 0, sh: 0, h: 0, ttk: [] };
    for (const mapId of MAPS) for (let s = 1; s <= SEEDS; s++) for (const side of [0, 1]) {
      const tb = side === 0 ? [T, REF] : [REF, T];
      const r = runMatch(mapId, MODE, s * 101 + side * 7, { identity: { tier: REF, tierByTeam: tb }, parked: true, noLimit: true });
      const p = r.per[side];
      A.m++; if (r.win === side) A.w++; A.k += p.kills; A.d += p.deaths; A.sh += p.shots; A.h += p.hits; A.ttk.push(...p.ttk);
    }
    out[T] = { win: 100 * A.w / A.m, kd: A.k / Math.max(1, A.d), acc: 100 * A.h / Math.max(1, A.sh), ttk: mean(A.ttk) };
    console.log(`${String(T).padEnd(5)} ${String(A.m).padStart(7)}  ${out[T].win.toFixed(1).padStart(5)}  ${out[T].kd.toFixed(2).padStart(5)}  ${String(A.k).padStart(6)} ${String(A.d).padStart(6)}  ${out[T].acc.toFixed(1).padStart(5)}  ${(out[T].ttk || 0).toFixed(2).padStart(5)}   (${Math.round((Date.now() - t0) / 1000)} s wall)`);
  }
  const mono = (k) => TIERS.every((t, i) => i === 0 || out[t][k] > out[TIERS[i - 1]][k]);
  console.log(`monotonic K/D: ${mono("kd") ? "YES" : "NO"}   acc: ${mono("acc") ? "YES" : "NO"}   win%: ${TIERS.every((t, i) => i === 0 || out[t].win >= out[TIERS[i - 1]].win) ? "YES (non-decreasing)" : "NO"}`);
}
console.log(`wall ${Math.round((Date.now() - t0) / 1000)} s`);
