#!/usr/bin/env node
// tools/mode_probe.mjs — objective metrics for the four newer modes (2026-11
// AI review), same harness as expert_probe (expert tier, real driver /
// commander / spawn director / nav, the human slot parked: god + noTarget, so
// it is excluded from every head count below).
//
//   STRONGHOLD (dom)  held%    share of owned-zone time with >= 1 operator of
//                              the owning team inside the ring (r, dy 2.5)
//                     empty%   share of owned-zone time with NOBODY of the
//                              owner inside (what an idle teammate sees)
//                     flips/m  zone owner changes per minute (all zones)
//                     pts/m    team score per minute (both teams summed)
//                     ownT%    share of zone-time owned by anybody
//   OUTPOST (hill)    occ%     share of live-hill time with >= 1 operator in it
//                     held%    share with exactly one team inside (scoring)
//                     cont%    share contested (both teams inside)
//                     pts/m    points per minute (both teams)
//   RECLAIM (tags)    conf%    tags confirmed / dropped     deny%  denied / dropped
//                     exp%     expired / dropped (left on the ground)
//                     pts/m    confirms per minute
//   ASCENT (ladder)   finish   match end time when somebody finished (else "-")
//                     topRung  highest rung reached (of N)
//                     knife    seconds an operator spent on the knife rung, knife
//                              swings / kills / swings-per-kill while on it
//
//   node tools/mode_probe.mjs [--maps lanternwalk,switchyard,saltmarket]
//        [--modes dom,hill,tags,ladder] [--seeds 2] [--secs 240]
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
const MODES = argOf("--modes", "dom,hill,tags,ladder").split(",");
const SEEDS = parseInt(argOf("--seeds", "2"), 10);
const SECS = parseFloat(argOf("--secs", "240"));
const JSON_OUT = argOf("--json", null);

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa", "dom", "hill", "tags", "ladder"]) {
  const mod = await import(u(`core/match/modes/${id}.js`));
  MATCH.registerMode(id, mod.createMode);
}
const worlds = {};
function worldOf(id) {
  if (!worlds[id]) { const colliders = COL.buildCollidersFor(id, 1); worlds[id] = { colliders, nav: NAV.bakeNav(colliders, { cell: 0.75 }) }; }
  return worlds[id];
}
const FLAT = ["arena", "spawnPoints", "clusters", "flags"];
function selectArena(id) { const blk = content.arenas && content.arenas[id]; if (blk) for (const k of FLAT) if (blk[k] !== undefined) content[k] = blk[k]; }
const NULL_CMD = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };

function runMatch(mapId, mode, seed) {
  selectArena(mapId);
  const { colliders, nav } = worldOf(mapId);
  const holder = { sim: null };
  const ev = { tagDrop: 0, tagConf: 0, tagDeny: 0, tagExp: 0, finished: null, swings: 0, knifeKills: 0, kills: 0, hillHeld: 0 };
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode, tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns, difficulty: "expert" },
    emit: (type, d) => {
      const s2 = holder.sim; if (!s2) return;
      if (type === "flag") {
        const k = "flag_" + d.state + (d.reason ? "_" + d.reason : "");
        ev[k] = (ev[k] || 0) + 1;
        if (d.state === "dropped" && d.pos) {
          const fl = (s2.match && s2.match.m && s2.match.m.state.flags) || [];
          const own = fl.find((f) => f.id === d.flagId), oth = fl.find((f) => f.id !== d.flagId);
          if (own && oth && own.home && oth.home) {
            const L = Math.hypot(own.home[0] - oth.home[0], own.home[2] - oth.home[2]) || 1;
            const fr = Math.hypot(d.pos[0] - own.home[0], d.pos[2] - own.home[2]) / L;
            ev.dropFr = ev.dropFr || [0, 0, 0, 0]; ev.dropFr[Math.min(3, Math.floor(fr * 4))]++;
            const sec = s2.state.time - (ev._takenT && ev._takenT[d.flagId] != null ? ev._takenT[d.flagId] : s2.state.time);
            ev.carryS = (ev.carryS || 0) + sec;
          }
        }
        if (d.state === "taken") { ev._takenT = ev._takenT || {}; ev._takenT[d.flagId] = s2.state.time; }
        if (d.state === "captured") { ev.caps = (ev.caps || 0) + 1; if (ev.firstCap == null) ev.firstCap = s2.state.time; }
      } else if (type === "tag") {
        if (d.state === "dropped") ev.tagDrop++; else if (d.state === "confirmed") ev.tagConf++;
        else if (d.state === "denied") ev.tagDeny++; else if (d.state === "expired") ev.tagExp++;
      } else if (type === "ladder" && d.state === "finished" && ev.finished == null) ev.finished = s2.state.time;
      else if (type === "melee" && d.phase === "swing" && d.who !== "P") { if (ev._onKnife && ev._onKnife.has(d.who)) ev.swings++; }
      else if (type === "death") { ev.kills++; if (d.weaponId === "knife" || d.weaponId === "melee") ev.knifeKills++; }
    },
  });
  holder.sim = sim;
  sim.mission.start(sim);
  const m = sim.match.m;
  const M = sim.state.match;
  if (SECS > 0) m.rules.timeLimitS = SECS;
  sim.flags.noTarget = true; sim.flags.god = true;
  const t0 = sim.state.time;
  const acc = { zoneOwnedS: 0, zoneHeldS: 0, zoneS: 0, flips: 0, hillS: 0, hillOcc: 0, hillOne: 0, hillCont: 0, knifeS: 0, topRung: 0, rungs: 0 };
  const lastOwner = new Map();
  ev._onKnife = new Set();
  const maxTicks = Math.ceil((SECS + 120) * 60);
  let ticks = 0;
  const DT6 = 6 / 60;
  while (ticks < maxTicks && M.phase !== "ended") {
    sim.step(NULL_CMD); ticks++;
    if (ticks % 6 !== 0) continue;
    const ms = m.state.mode || {};
    // positions of live NON-human actors by team
    const live = [];
    for (const a of m.actors) {
      if (!a.alive || a.kind === "human") continue;
      const p = m.posOf(a);
      if (p) live.push({ team: a.team, p, who: a.who });
    }
    const inside = (z, team) => {
      for (const x of live) {
        if (team != null && x.team !== team) continue;
        if (Math.hypot(x.p[0] - z.pos[0], x.p[2] - z.pos[2]) <= z.r && Math.abs((x.p[1] || 0) - (z.pos[1] || 0)) < 2.5) return true;
      }
      return false;
    };
    if (mode === "ctf") {
      const fl = sim.state.match && sim.state.match.flags ? sim.state.match.flags : (m.state.flags || []);
      let nC = 0; for (const f of fl) if (String(f.state).toUpperCase() === "CARRIED") nC++;
      acc.ctfS = (acc.ctfS || 0) + DT6; if (nC === 2) acc.bothS = (acc.bothS || 0) + DT6; if (nC >= 1) acc.anyS = (acc.anyS || 0) + DT6;
    }
    if (mode === "dom" && ms.zones) {
      for (const z of ms.zones) {
        acc.zoneS += DT6;
        const prev = lastOwner.get(z.id);
        if (prev !== undefined && prev !== z.owner) acc.flips++;
        lastOwner.set(z.id, z.owner);
        if (z.owner === 0 || z.owner === 1) {
          acc.zoneOwnedS += DT6;
          if (inside(z, z.owner)) acc.zoneHeldS += DT6;
        }
      }
    } else if (mode === "hill" && ms.zones) {
      const z = ms.zones.find((q) => !q.preview) || ms.zones[0];
      if (z) {
        acc.hillS += DT6;
        const a0 = inside(z, 0), a1 = inside(z, 1);
        if (a0 || a1) acc.hillOcc += DT6;
        if (a0 !== a1) acc.hillOne += DT6;
        if (a0 && a1) acc.hillCont += DT6;
      }
    } else if (mode === "ladder" && ms.tiers) {
      const last = ms.tiers.length - 1;
      ev._onKnife.clear();
      for (const a of m.actors) {
        if (a.kind === "human") continue;
        const tr = ms.tier ? ms.tier[a.actorId] : null;
        if (tr == null) continue;
        // tier === tiers.length once an operator FINISHES (ladder.js) - that is
        // the last rung completed, not a rung of its own (was "top rung 12/11")
        const trR = Math.min(tr, ms.tiers.length - 1);
        if (trR > acc.topRung) acc.topRung = trR;
        if (ms.tiers[tr] && ms.tiers[tr].knife) { ev._onKnife.add(a.who); if (a.alive) acc.knifeS += DT6; }
      }
      acc.rungs = ms.tiers.length;
    }
  }
  let pts = 0;
  for (const tt of M.teams || []) pts += tt.score || 0;
  const secs = sim.state.time - t0;
  return { mapId, mode, seed, secs, ended: M.phase === "ended", pts, ev, acc };
}

const rows = [];
const wall0 = Date.now();
for (const mapId of MAPS) for (const mode of MODES) {
  const mr = [];
  for (let seed = 1; seed <= SEEDS; seed++) mr.push(runMatch(mapId, mode, seed * 37 + 3));
  const sum = (f) => mr.reduce((a, r) => a + f(r), 0);
  const mins = sum((r) => r.secs) / 60;
  const p = (a, b) => (100 * a / Math.max(1e-9, b)).toFixed(1) + "%";
  let line = `${mapId.padEnd(11)} ${mode.padEnd(6)} n=${mr.length} ended ${mr.filter((r) => r.ended).length}/${mr.length}  `;
  const row = { mapId, mode, n: mr.length };
  if (mode === "ctf") {
    const ks = new Set(); for (const r of mr) for (const k of Object.keys(r.ev)) if (k.startsWith("flag_")) ks.add(k);
    const caps = sum((r) => r.ev.caps || 0) / mr.length;
    const fc = mr.filter((r) => r.ev.firstCap != null).map((r) => r.ev.firstCap).sort((a, b) => a - b);
    Object.assign(row, { caps, firstCap: fc.length ? fc[fc.length >> 1] : null, bothPct: 100 * sum((r) => r.acc.bothS || 0) / Math.max(1e-9, sum((r) => r.acc.ctfS || 0)), carriedPct: 100 * sum((r) => r.acc.anyS || 0) / Math.max(1e-9, sum((r) => r.acc.ctfS || 0)) });
    const dq = [0, 0, 0, 0]; for (const r of mr) if (r.ev.dropFr) for (let i = 0; i < 4; i++) dq[i] += r.ev.dropFr[i];
    line += `drops by quarter of the way home [${dq.join(",")}]  `;
    line += `caps/match ${caps.toFixed(2)} (first@${row.firstCap == null ? "n/a" : Math.round(row.firstCap) + "s"})  a flag carried ${row.carriedPct.toFixed(0)}% of the time, both ${row.bothPct.toFixed(0)}%  ` + [...ks].sort().map((k) => `${k.slice(5)} ${(sum((r) => r.ev[k] || 0) / mr.length).toFixed(1)}`).join(" ");
  } else if (mode === "dom") {
    const owned = sum((r) => r.acc.zoneOwnedS), held = sum((r) => r.acc.zoneHeldS);
    Object.assign(row, { heldPct: 100 * held / Math.max(1e-9, owned), flipsPerMin: sum((r) => r.acc.flips) / mins, ptsPerMin: sum((r) => r.pts) / mins, ownedPct: 100 * owned / Math.max(1e-9, sum((r) => r.acc.zoneS)) });
    line += `held ${p(held, owned)} (empty ${p(owned - held, owned)})  flips/min ${row.flipsPerMin.toFixed(2)}  pts/min ${row.ptsPerMin.toFixed(1)}  owned ${row.ownedPct.toFixed(1)}%`;
  } else if (mode === "hill") {
    const hs = sum((r) => r.acc.hillS);
    Object.assign(row, { occPct: 100 * sum((r) => r.acc.hillOcc) / hs, heldPct: 100 * sum((r) => r.acc.hillOne) / hs, contPct: 100 * sum((r) => r.acc.hillCont) / hs, ptsPerMin: sum((r) => r.pts) / mins });
    line += `occupied ${row.occPct.toFixed(1)}%  held(one team) ${row.heldPct.toFixed(1)}%  contested ${row.contPct.toFixed(1)}%  pts/min ${row.ptsPerMin.toFixed(1)}`;
  } else if (mode === "tags") {
    const dr = sum((r) => r.ev.tagDrop);
    Object.assign(row, { dropped: dr, confPct: 100 * sum((r) => r.ev.tagConf) / Math.max(1, dr), denyPct: 100 * sum((r) => r.ev.tagDeny) / Math.max(1, dr), expPct: 100 * sum((r) => r.ev.tagExp) / Math.max(1, dr), ptsPerMin: sum((r) => r.ev.tagConf) / mins });
    line += `tags dropped ${dr}  confirmed ${row.confPct.toFixed(1)}%  denied ${row.denyPct.toFixed(1)}%  expired ${row.expPct.toFixed(1)}%  (rest still down at the horn)  confirms/min ${row.ptsPerMin.toFixed(1)}`;
  } else if (mode === "ladder") {
    const fin = mr.filter((r) => r.ev.finished != null).map((r) => r.ev.finished);
    const sw = sum((r) => r.ev.swings);
    Object.assign(row, { finished: fin.length, finishS: fin.length ? fin.reduce((a, b) => a + b, 0) / fin.length : null, topRung: Math.max(...mr.map((r) => r.acc.topRung)), rungs: mr[0].acc.rungs, knifeS: sum((r) => r.acc.knifeS) / mr.length, swings: sw / mr.length, kills: sum((r) => r.ev.kills) / mins });
    line += `finished ${fin.length}/${mr.length}${fin.length ? " @" + Math.round(row.finishS) + "s" : ""}  top rung ${row.topRung + 1}/${row.rungs}  knife-rung time ${row.knifeS.toFixed(0)} s/match, swings there ${row.swings.toFixed(1)}/match  kills/min ${row.kills.toFixed(1)}`;
  }
  rows.push(row);
  console.log(line);
}
console.log(`\nmode_probe  secs=${SECS} seeds=${SEEDS}  AI avg ${BF.AI_PERF.avgMs.toFixed(3)} ms/tick  wall ${Math.round((Date.now() - wall0) / 1000)} s`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
