#!/usr/bin/env node
// tools/dom_probe.mjs — STRONGHOLD (dom) flip diagnosis. Same harness as
// mode_probe (expert tier, real driver / commander / spawn director / nav, the
// human slot parked: god + noTarget, excluded from every count).
//
// For every NEUTRALISE (a held zone drained to grey) it classifies the loss
// by what the owning team had on that zone during the drain:
//   none      no operator of the owner was ordered to hold the zone
//   dead      the zone's holder(s) died during the drain / just before it
//   outside   a holder was alive and ordered there, but stood outside the ring
//   inside?   a holder inside the ring (should be impossible: contested)
// plus: how long the zone had been owned before it was lost, which zone
// (own side / centre / enemy side, from the loser's view), how holders died
// (killer distance, killer inside the ring or not), attacker head count.
//
//   node tools/dom_probe.mjs [--maps lanternwalk,switchyard,saltmarket] [--seeds 8] [--secs 240]
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
const SEEDS = parseInt(argOf("--seeds", "8"), 10);
const SECS = parseFloat(argOf("--secs", "240"));

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa", "dom"]) {
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
const hd = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function runMatch(mapId, seed) {
  selectArena(mapId);
  const { colliders, nav } = worldOf(mapId);
  const holder = { sim: null };
  const out = { neut: [], caps: 0, holderDeaths: [], flips: 0, ownedSpans: [] };
  const zoneHolders = new Map(); // zoneId -> Map(botId -> lastT ordered)
  const pending = [];
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode: "dom", tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns, difficulty: "expert" },
    emit: (type, d) => {
      const s2 = holder.sim; if (!s2) return;
      if (type === "zonecap" && (d.state === "neutralised" || d.state === "captured")) pending.push({ d, t: s2.state.time });
      if (type === "death") {
        const m = s2.match.m; const ms = m.state.mode;
        const vb = s2.state.bots.find((b) => b.id === d.victim);
        if (!vb || !ms || !ms.zones) return;
        const o = vb._obj;
        const wr = s2._w7 && s2._w7.recs.get(vb.id);
        if (!o || o.role !== "defend" || !wr || !wr._domKey || !wr._domKey.startsWith("defend:")) return;
        const z = ms.zones.find((q) => "defend:" + q.id === wr._domKey);
        if (!z) return;
        const kb = s2.state.bots.find((b) => b.id === d.attacker);
        const kp = kb ? kb.pos : null;
        out.holderDeaths.push({ z: z.id, atZone: !!o.leash, inRing: hd(vb.pos, z.pos) <= z.r, killerD: kp ? hd(kp, vb.pos) : null, killerInRing: kp ? hd(kp, z.pos) <= z.r : null, t: s2.state.time });
      }
    },
  });
  holder.sim = sim;
  sim.mission.start(sim);
  const m = sim.match.m;
  const M = sim.state.match;
  if (SECS > 0) m.rules.timeLimitS = SECS;
  sim.flags.noTarget = true; sim.flags.god = true;
  const maxTicks = Math.ceil((SECS + 120) * 60);
  let ticks = 0;
  const ownedSince = new Map();
  const hist = []; // ring buffer of per-zone samples (last 8 s)
  while (ticks < maxTicks && M.phase !== "ended") {
    sim.step(NULL_CMD); ticks++;
    const ms = m.state.mode || {};
    if (!ms.zones) continue;
    const t = sim.state.time;
    if (ticks % 6 === 0) {
      const snap = { t, z: {} };
      for (const z of ms.zones) {
        const rec = { owner: z.owner, ordered: [], inside: { 0: 0, 1: 0 } };
        for (const b of sim.state.bots) {
          if (!b.alive) continue;
          if (hd(b.pos, z.pos) <= z.r && Math.abs(b.pos[1] - z.pos[1]) < 2.5) rec.inside[b.team]++;
          const o = b._obj;
          const wr = sim._w7 && sim._w7.recs.get(b.id);
          if (o && o.role === "defend" && b.team === z.owner && wr && wr._domKey === "defend:" + z.id) {
            rec.ordered.push({ id: b.id, inRing: hd(b.pos, z.pos) <= z.r, d: hd(b.pos, z.pos), st: b.state, reason: o.reason + (o.leash ? "/L" : "/travel") });
          }
        }
        snap.z[z.id] = rec;
      }
      hist.push(snap);
      while (hist.length && t - hist[0].t > 11) hist.shift();
    }
    while (pending.length) {
      const { d, t: te } = pending.shift();
      out.flips++;
      if (d.state === "captured") { ownedSince.set(d.zone, te); out.caps++; continue; }
      // neutralised: d.prevOwner lost the zone
      const loser = d.prevOwner;
      const z = ms.zones.find((q) => q.id === d.zone);
      const since = ownedSince.get(d.zone);
      const span = since != null ? te - since : null;
      ownedSince.delete(d.zone);
      // look at the drain window (last 5.5 s)
      let everOrdered = false, aliveOrderedOutside = false, insideHolder = false, maxAtt = 0;
      const ids = new Set();
      for (const s of hist) {
        if (te - s.t > 5.5) continue;
        const r = s.z[d.zone]; if (!r) continue;
        if (r.ordered.length) everOrdered = true;
        for (const x of r.ordered) { ids.add(x.id); if (!x.inRing) aliveOrderedOutside = true; else insideHolder = true; }
        maxAtt = Math.max(maxAtt, r.inside[1 - loser] || 0);
      }
      const lastS = hist[hist.length - 1];
      const lastR = lastS && lastS.z[d.zone];
      const aliveNow = lastR ? lastR.ordered.length : 0;
      const recentHolderDeath = out.holderDeaths.some((h) => h.z === d.zone && h.atZone && te - h.t <= 10);
      let leashedSeen = false;
      for (const s of hist) { if (te - s.t > 10) continue; const r = s.z[d.zone]; if (r && r.ordered.some((x) => x.reason.endsWith("/L"))) leashedSeen = true; }
      let cls;
      if (recentHolderDeath) cls = "holderKilled";
      else if (leashedSeen) cls = "holderAliveLeft";
      else if (everOrdered) cls = "onlyTravelling";
      else cls = "noneOrdered";
      void aliveNow; void insideHolder;
      const side = z.side === loser ? "own" : z.side === 1 - loser ? "enemy" : "centre";
      const outsideD = lastR ? lastR.ordered.filter((x) => !x.inRing).map((x) => +x.d.toFixed(1) + ":" + x.st + ":" + x.reason) : [];
      out.neut.push({ zone: d.zone, side, cls, span, maxAtt, outsideD, t: te });
    }
  }
  return out;
}

const wall0 = Date.now();
for (const mapId of MAPS) {
  const all = { neut: [], deaths: [], flips: 0, caps: 0, mins: 0 };
  for (let s = 1; s <= SEEDS; s++) {
    const r = runMatch(mapId, s * 37 + 3);
    all.neut.push(...r.neut); all.deaths.push(...r.holderDeaths); all.flips += r.flips; all.caps += r.caps;
    all.mins += SECS / 60;
  }
  const cnt = (f) => all.neut.filter(f).length;
  const cls = {}; for (const n of all.neut) cls[n.cls] = (cls[n.cls] || 0) + 1;
  const side = {}; for (const n of all.neut) side[n.side] = (side[n.side] || 0) + 1;
  const spans = all.neut.filter((n) => n.span != null).map((n) => n.span).sort((a, b) => a - b);
  const med = spans.length ? spans[spans.length >> 1] : null;
  const short = spans.filter((x) => x < 20).length;
  const dIn = all.deaths.filter((h) => h.inRing).length;
  const kIn = all.deaths.filter((h) => h.killerInRing).length;
  const kd = all.deaths.filter((h) => h.killerD != null).map((h) => h.killerD).sort((a, b) => a - b);
  console.log(`${mapId.padEnd(11)} n=${SEEDS} flips/min ${(all.flips / all.mins).toFixed(2)}  neutralised ${all.neut.length} (/min ${(all.neut.length / all.mins).toFixed(2)})  by cause ${JSON.stringify(cls)}  by zone(loser's view) ${JSON.stringify(side)}  owned-before-loss median ${med == null ? "-" : med.toFixed(0)} s, <20 s ${short}/${spans.length}  attackers inside (max) mean ${(all.neut.reduce((a, n) => a + n.maxAtt, 0) / Math.max(1, all.neut.length)).toFixed(2)}`);
  console.log(`            holder deaths ${all.deaths.length} (${(all.deaths.length / all.mins).toFixed(2)}/min): in ring ${dIn}, killer in ring ${kIn}, killer distance median ${kd.length ? kd[kd.length >> 1].toFixed(1) : "-"} m`);
  const ex = all.neut.filter((n) => n.cls === "outside").slice(0, 6).map((n) => `${n.zone}@${n.t.toFixed(0)} ${n.outsideD.join(",")}`);
  if (ex.length) console.log(`            outside examples: ${ex.join(" | ")}`);
}
console.log(`\ndom_probe  secs=${SECS} seeds=${SEEDS}  AI avg ${BF.AI_PERF.avgMs.toFixed(3)} ms/tick  wall ${Math.round((Date.now() - wall0) / 1000)} s`);
