#!/usr/bin/env node
// tools/fight_probe.mjs — WHY is a map's TTK / accuracy what it is? (2026-11
// AI review). Same match harness as expert_probe (expert tier, human parked).
// For every trigger pull by an operator it records the shooter's situation:
// range to its percept target, whether the target was visible to the
// shooter's percept, whether the muzzle->chest line was actually blocked by
// geometry, shooter / target speed, the shooter's state, weapon class and the
// hit. For every kill it records the time from first hit and the number of
// trigger pulls in between; for every engagement the share of time the
// shooter spent NOT firing while it saw the target (pauses / peeks / turns).
//
//   node tools/fight_probe.mjs [--maps lanternwalk,switchyard,saltmarket] [--modes tdm] [--seeds 2] [--secs 180]
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
const SEEDS = parseInt(argOf("--seeds", "2"), 10);
const SECS = parseFloat(argOf("--secs", "180"));

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa", "dom", "hill", "tags", "ladder"]) {
  try { const mod = await import(u(`core/match/modes/${id}.js`)); MATCH.registerMode(id, mod.createMode); } catch (e) { /* optional */ }
}
const worlds = {};
function worldOf(id) {
  if (!worlds[id]) { const colliders = COL.buildCollidersFor(id, 1); worlds[id] = { colliders, nav: NAV.bakeNav(colliders, { cell: 0.75 }) }; }
  return worlds[id];
}
const FLAT = ["arena", "spawnPoints", "clusters", "flags"];
function selectArena(id) { const blk = content.arenas && content.arenas[id]; if (blk) for (const k of FLAT) if (blk[k] !== undefined) content[k] = blk[k]; }
const NULL_CMD = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
const BINS = [0, 8, 15, 25, 40, 60, 999];
const binOf = (d) => { for (let i = 1; i < BINS.length; i++) if (d < BINS[i]) return i - 1; return BINS.length - 2; };

function runMatch(mapId, mode, seed, acc) {
  selectArena(mapId);
  const { colliders, nav } = worldOf(mapId);
  const holder = { sim: null };
  const seenTrig = new Set();
  const firstHit = new Map(), pulls = new Map();
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode, tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns, difficulty: "expert" },
    emit: (type, d) => {
      const s2 = holder.sim; if (!s2) return;
      const t = s2.state.time;
      if (type === "shot" && !d.impactOnly && !d.pen && d.shooter !== "P") {
        const key = d.shooter + "@" + t.toFixed(3);
        if (seenTrig.has(key)) return; seenTrig.add(key);
        const b = s2.state.bots.find((x) => x.id === d.shooter); if (!b) return;
        const P = b.percept;
        const tgt = P && P.target != null ? (P.target === "P" ? s2.state.player : s2.state.bots.find((x) => x.id === P.target)) : null;
        const r = { hit: false, cls: (s2.weapons[b.weapon.id] || {}).class || "?", st: b.state, sees: !!(P && P.seesTarget), spd: Math.hypot(b.vel[0], b.vel[2]) };
        if (tgt) {
          const dd = Math.hypot(tgt.pos[0] - b.pos[0], tgt.pos[2] - b.pos[2]);
          r.d = dd; r.tspd = Math.hypot(tgt.vel[0], tgt.vel[2]);
          r.blocked = s2.world.losBlocked(d.origin, [tgt.pos[0], tgt.pos[1] + 1.1, tgt.pos[2]]);
          r.crouch = tgt.stance === "crouch";
          r.headClear = !s2.world.losBlocked(d.origin, [tgt.pos[0], tgt.pos[1] + (r.crouch ? 1.0 : 1.52), tgt.pos[2]]);
          const k = P.target + "|" + b.id; pulls.set(k, (pulls.get(k) || 0) + 1);
        }
        acc.shots.push(r);
        acc._last = r;
      } else if (type === "hurt" && d.attacker != null && d.attacker !== "P") {
        const k = d.victim + "|" + d.attacker; if (!firstHit.has(k)) { firstHit.set(k, t); pulls.set(k, pulls.get(k) || 1); }
        const last = acc.shots.length ? acc.shots[acc.shots.length - 1] : null;
        if (last && !last._hitMark) { last.hit = true; last._hitMark = true; }
      } else if (type === "death" && d.victim !== "P" && d.attacker != null && d.attacker !== "P") {
        const k = d.victim + "|" + d.attacker; const t0 = firstHit.get(k);
        if (t0 != null) acc.kills.push({ ttk: t - t0, pulls: pulls.get(k) || 0 });
        for (const kk of [...firstHit.keys()]) if (kk.startsWith(d.victim + "|")) { firstHit.delete(kk); pulls.delete(kk); }
      }
    },
  });
  holder.sim = sim;
  sim.mission.start(sim);
  const M = sim.state.match;
  if (SECS > 0) sim.match.m.rules.timeLimitS = SECS;
  sim.flags.noTarget = true; sim.flags.god = true;
  const maxTicks = Math.ceil((SECS + 200) * 60);
  let ticks = 0;
  while (ticks < maxTicks && M.phase !== "ended") {
    sim.step(NULL_CMD); ticks++;
    if (ticks % 6 === 0) {
      for (const b of sim.state.bots) {
        if (!b.alive || !b.percept || !b.percept.seesTarget) continue;
        const br = b._brain; if (!br) continue;
        acc.seeT++;
        const sp = Math.hypot(b.vel[0], b.vel[2]);
        if (b.cmd && b.cmd.fire) acc.seeFire++;
        else if (b.weapon.state === "reloading") acc.seeReload++;
        else if (br.pauseUntil > sim.state.time) acc.seePause++;
        else if (br.confirmT < 0 || sim.state.time < br.confirmT + br.reactionS) acc.seeReact++;
        else if (sp >= (br.k ? br.k.fireSpeed : 0.75)) acc.seeMoving++;
        else acc.seeOther++;
      }
    }
  }
}

for (const mapId of MAPS) for (const mode of MODES) {
  const acc = { shots: [], kills: [], seeT: 0, seeFire: 0, seeReload: 0, seePause: 0, seeReact: 0, seeMoving: 0, seeOther: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) runMatch(mapId, mode, seed * 37 + 3, acc);
  const sh = acc.shots;
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(0) + "%";
  const withT = sh.filter((r) => r.d != null);
  console.log(`\n${mapId} ${mode}: ${sh.length} trigger pulls, hit ${pct(sh.filter((r) => r.hit).length, sh.length)}; kills ${acc.kills.length}, mean TTK ${(acc.kills.reduce((a, k) => a + k.ttk, 0) / Math.max(1, acc.kills.length)).toFixed(2)} s, median ${(acc.kills.map((k) => k.ttk).sort((a, b) => a - b)[acc.kills.length >> 1] || 0).toFixed(2)} s, pulls/kill ${(acc.kills.reduce((a, k) => a + k.pulls, 0) / Math.max(1, acc.kills.length)).toFixed(1)}`);
  console.log(`  pulls with the muzzle->chest line BLOCKED by geometry: ${pct(withT.filter((r) => r.blocked).length, withT.length)} (hit ${pct(withT.filter((r) => r.blocked && r.hit).length, withT.filter((r) => r.blocked).length)}; of those head in view ${pct(withT.filter((r) => r.blocked && r.headClear).length, withT.filter((r) => r.blocked).length)}, nothing in view ${pct(withT.filter((r) => r.blocked && !r.headClear).length, withT.length)} of all pulls); target not in shooter's view: ${pct(withT.filter((r) => !r.sees).length, withT.length)}; target crouched: ${pct(withT.filter((r) => r.crouch).length, withT.length)}`);
  console.log(`  shooter moving >1 m/s: ${pct(sh.filter((r) => r.spd > 1).length, sh.length)} (hit ${pct(sh.filter((r) => r.spd > 1 && r.hit).length, sh.filter((r) => r.spd > 1).length)}); target moving >2 m/s: ${pct(withT.filter((r) => r.tspd > 2).length, withT.length)} (hit ${pct(withT.filter((r) => r.tspd > 2 && r.hit).length, withT.filter((r) => r.tspd > 2).length)})`);
  const line = [];
  for (let i = 0; i < BINS.length - 1; i++) {
    const inB = withT.filter((r) => binOf(r.d) === i && !r.blocked);
    line.push(`${BINS[i]}-${BINS[i + 1] === 999 ? "+" : BINS[i + 1]}m ${pct(inB.length, withT.length)} hit ${pct(inB.filter((r) => r.hit).length, inB.length)}`);
  }
  console.log("  clear-line pulls by range: " + line.join(" | "));
  const byCls = {};
  for (const r of sh) { const c = byCls[r.cls] || (byCls[r.cls] = [0, 0]); c[0]++; if (r.hit) c[1]++; }
  console.log("  by weapon class: " + Object.entries(byCls).map(([k, v]) => `${k} ${v[0]} (hit ${pct(v[1], v[0])})`).join(", "));
  console.log(`  while SEEING its target (sampled 10 Hz): firing ${pct(acc.seeFire, acc.seeT)}, reaction window ${pct(acc.seeReact, acc.seeT)}, burst pause ${pct(acc.seePause, acc.seeT)}, reloading ${pct(acc.seeReload, acc.seeT)}, moving too fast to fire ${pct(acc.seeMoving, acc.seeT)}, other (token / turn / gates) ${pct(acc.seeOther, acc.seeT)}`);
}
