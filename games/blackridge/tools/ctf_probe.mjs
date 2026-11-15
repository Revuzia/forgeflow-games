#!/usr/bin/env node
// tools/ctf_probe.mjs — CAPTURE THE FLAG team-play diagnosis. Same harness as
// mode_probe (expert tier, real driver / commander / spawn director / nav, the
// human slot parked: god + noTarget).
//
// Per map, pooled over seeds:
//   caps/match, team-0 win share (by captures; draws counted half), first cap
//   carrier deaths: fraction of the way home (quarters), killer's order
//     (intercept / defend / attack / ...), killer distance to the carrier's
//     own stand, carrier's own team within 15 m at death (escort cover), who
//     the carrier was fighting (hp at death is 0 — so: hits taken in the 5 s
//     before), and whether the carrier could score (own flag home)
//   dropped flags: picked up again by the carrier's team vs returned
//   stand-off: share of carried time with both flags carried, and how stand-
//     offs end (our carrier killed / their carrier killed)
//
//   node tools/ctf_probe.mjs [--maps ...] [--seeds 8] [--secs 180]
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
const SECS = parseFloat(argOf("--secs", "180"));
const SEED0 = parseInt(argOf("--seed0", "1"), 10);
// --even: bench one SLATE operator for the whole match. The parked human slot
// leaves AMBER with 4 operators against 5; benching one of the five makes it
// 4 v 4, so the team-0 match share measures the AI, not the head count.
const EVEN = argv.includes("--even");
// --nohuman: take the parked human out of the match entirely. The match driver
// clears sim.flags.noTarget when the match goes live, so the "parked" human is
// otherwise an invulnerable (god) body at AMBER's spawn that SLATE keeps
// shooting (measured: ~15% of all operator samples target it).
const NOHUMAN = argv.includes("--nohuman");
const SEEN = new Set(), SPAWNC = new Map();

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const OBJ = await import(u("core/ai/objective.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa"]) {
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
  const R = { caps: [0, 0], carrierDeaths: [], drops: 0, regrab: 0, returned: 0, standoffEnd: [], hurt: new Map(), carry: [] };
  let carrier = new Map(); // flagId -> who
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode: "ctf", tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns, difficulty: "expert" },
    emit: (type, d) => {
      const s2 = holder.sim; if (!s2) return;
      const t = s2.state.time;
      if (type === "hurt") { const a = R.hurt.get(d.victim) || []; a.push(t); R.hurt.set(d.victim, a); }
      if (type === "flag") {
        const m = s2.match.m; const fl = m.state.flags;
        if (d.state === "taken") {
          carrier.set(d.flagId, d.carrier != null ? d.carrier : d.byWho);
          if (d.reason === "ground" || d.by === "ground") R.regrab++;
          R.carry.push({ t0: t, flag: d.flagId });
        }
        if (d.state === "captured") { const f = fl.find((q) => q.id === d.flagId); if (f) R.caps[1 - f.team]++; carrier.delete(d.flagId); }
        if (d.state === "dropped") R.drops++;
        if (d.state === "returned" && d.reason === "touch") R.returned++;
      }
      if (type === "death") {
        const m = s2.match.m; const fl = m.state.flags || [];
        for (const f of fl) {
          if (carrier.get(f.id) !== d.victim) continue;
          if (process.env.CTFDBG2) console.log("ST", f.state, f.carrier, d.victim);
          if (!(String(f.state).toUpperCase() === "CARRIED" && f.carrier === d.victim)) { carrier.delete(f.id); continue; }
          // the victim carried flag f (team f.team), home stand = the OTHER flag's home
          const own = fl.find((q) => q.id !== f.id);
          const L = hd(own.home, f.home) || 1;
          const vb = s2.state.bots.find((b) => b.id === d.victim);
          const kb = s2.state.bots.find((b) => b.id === d.attacker);
          const vpos = d.pos || (vb && vb.pos);
          const fr = vpos ? hd(vpos, f.home) / L : null;
          let mates = 0, matesNear = 0;
          for (const b of s2.state.bots) {
            if (!b.alive || b.id === d.victim || !vb || b.team !== vb.team) continue;
            mates++; if (vpos && hd(b.pos, vpos) <= 15) matesNear++;
          }
          const hits = (R.hurt.get(d.victim) || []).filter((x) => t - x <= 5).length;
          const ko = kb && kb._obj;
          R.carrierDeaths.push({
            fr, killerRole: ko ? ko.role + "/" + ko.reason : (d.attacker === "P" ? "human" : "?"),
            killerToStand: kb ? hd(kb.pos, own.home) : null, killerD: kb && vpos ? hd(kb.pos, vpos) : null,
            matesNear, mates, hits, canScore: String(own.state).toUpperCase() === "AT_STAND",
            vState: vb ? vb.state : null,
          });
          if (process.env.CTFDBG && R.carrierDeaths.length <= 4) console.log("DBG", JSON.stringify({ t: +t.toFixed(1), victim: d.victim, vteam: vb && vb.team, vpos: vpos && vpos.map((x) => +x.toFixed(1)), flag: f.id, fteam: f.team, fhome: f.home, ownHome: own.home, ownState: own.state, ownCarrier: own.carrier, killer: d.attacker, kteam: kb && kb.team, kpos: kb && kb.pos.map((x) => +x.toFixed(1)), kobj: ko && { role: ko.role, reason: ko.reason, anchor: ko.anchor }, kIsCarrier: fl.some((q) => q.carrier === d.attacker) }));
          carrier.delete(f.id);
        }
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
  const acc = { ctfS: 0, bothS: 0, anyS: 0, escortD: [], escortAhead: 0, escortN: 0, holdS: 0 };
  let benchId = -1;
  if (EVEN) for (const a of m.actors) if (a.team === 1 && a.kind !== "human" && a.actorId > benchId) benchId = a.actorId;
  while (ticks < maxTicks && M.phase !== "ended") {
    sim.step(NULL_CMD); ticks++;
    if (NOHUMAN) {
      const h = m.actors.find((x) => x.kind === "human");
      if (h && h.alive) { h.alive = false; sim.state.player.alive = false; sim.state.player.pos = [0, -80, 0]; }
    }
    if (EVEN) {
      const a = m.actors.find((x) => x.actorId === benchId);
      if (a && a.alive) {
        const bd = m.bodyOf(a);
        a.alive = false;
        if (bd) { bd.alive = false; bd.hp = 0; bd.pos = [0, -80, 0]; }
      }
    }
    if (process.env.CTFSPAWN) {
      for (const b of sim.state.bots) {
        if (!b.alive || SEEN.has(b.id)) continue;
        SEEN.add(b.id);
        let best = null, bd = Infinity;
        for (const p of m.arena.spawnPoints) { const d = hd(p.pos, b.pos); if (d < bd) { bd = d; best = p; } }
        const k = "t" + b.team + ":" + (best ? best.cluster : "?");
        SPAWNC.set(k, (SPAWNC.get(k) || 0) + 1);
      }
    }
    if (ticks % 30 !== 0) continue;
    const fl = m.state.flags || [];
    let nC = 0; for (const f of fl) if (String(f.state).toUpperCase() === "CARRIED") nC++;
    acc.ctfS += 0.5; if (nC === 2) acc.bothS += 0.5; if (nC) acc.anyS += 0.5;
    for (const f of fl) {
      if (String(f.state).toUpperCase() !== "CARRIED") continue;
      const cb = sim.state.bots.find((b) => b.id === f.carrier && b.alive);
      if (!cb) continue;
      const own = fl.find((q) => q.id !== f.id);
      if (cb._obj && cb._obj.reason === "HOLD_NEAR_STAND") acc.holdS += 0.5;
      const dHome = hd(cb.pos, own.home);
      if (process.env.CTFTRACE && ticks % 60 === 0) {
        const f1 = (v) => +v.toFixed(0);
        const mates = [], foes = [];
        for (const b of sim.state.bots) {
          if (!b.alive || b === cb) continue;
          const d = hd(b.pos, cb.pos);
          const o = b._obj;
          const tag = `${b.id}:${o ? o.role + "/" + o.reason : "-"}:${b.state}:${f1(d)}m${o && o.sprint ? ":spr" : ""}${b.percept && b.percept.target === cb.id && b.percept.seesTarget ? ":SEES" : ""}`;
          if (b.team === cb.team) mates.push(tag); else if (d < 35) foes.push(tag);
        }
        const o = cb._obj;
        console.log(`T ${f1(sim.state.time)} carrier ${cb.id}(t${cb.team}) hp${f1(cb.hp)} ${cb.state} ${o && o.reason}${o && o.sprint ? " spr" : ""} v${Math.hypot(cb.vel[0], cb.vel[2]).toFixed(1)} home ${f1(dHome)}m ownFlag ${own.state} | mates ${mates.join(" ")} | foes<35 ${foes.join(" ")}`);
      }
      for (const b of sim.state.bots) {
        if (!b.alive || b === cb || b.team !== cb.team || !b._obj || b._obj.role !== "escort") continue;
        acc.escortN++; acc.escortD.push(hd(b.pos, cb.pos));
        if (hd(b.pos, own.home) < dHome - 3) acc.escortAhead++;
      }
    }
  }
  return { R, acc, ended: M.phase === "ended" };
}

const wall0 = Date.now();
for (const mapId of MAPS) {
  const rs = [];
  for (let s = SEED0; s < SEED0 + SEEDS; s++) rs.push(runMatch(mapId, s * 37 + 3));
  const caps = rs.reduce((a, r) => a + r.R.caps[0] + r.R.caps[1], 0) / rs.length;
  let w0 = 0; for (const r of rs) w0 += r.R.caps[0] > r.R.caps[1] ? 1 : r.R.caps[0] === r.R.caps[1] ? 0.5 : 0;
  const cd = rs.flatMap((r) => r.R.carrierDeaths);
  const q = [0, 0, 0, 0]; for (const c of cd) if (c.fr != null) q[Math.min(3, Math.floor(c.fr * 4))]++;
  const roles = {}; for (const c of cd) { const k = c.killerRole.split("/")[0]; roles[k] = (roles[k] || 0) + 1; }
  const reasons = {}; for (const c of cd) reasons[c.killerRole] = (reasons[c.killerRole] || 0) + 1;
  const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  const kts = med(cd.map((c) => c.killerToStand)), kd = med(cd.map((c) => c.killerD));
  const mn = cd.reduce((a, c) => a + c.matesNear, 0) / Math.max(1, cd.length);
  const cs = cd.filter((c) => c.canScore).length;
  const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
  const ed = rs.flatMap((r) => r.acc.escortD);
  console.log(`${mapId.padEnd(11)} n=${rs.length}  caps/match ${caps.toFixed(2)} (caps by team ${sum((r) => r.R.caps[0])}:${sum((r) => r.R.caps[1])}, team-0 match share ${(100 * w0 / rs.length).toFixed(0)}%)  carried ${(100 * sum((r) => r.acc.anyS) / sum((r) => r.acc.ctfS)).toFixed(0)}% both ${(100 * sum((r) => r.acc.bothS) / sum((r) => r.acc.ctfS)).toFixed(0)}% (carrier holding near stand ${(100 * sum((r) => r.acc.holdS) / Math.max(1e-9, sum((r) => r.acc.anyS))).toFixed(0)}% of carried time)`);
  console.log(`            carrier deaths ${cd.length} (${(cd.length / rs.length).toFixed(1)}/match) by quarter home [${q.join(",")}]  could score ${cs}/${cd.length}  killer order ${JSON.stringify(roles)}  killer->carrier's stand median ${kts == null ? "-" : kts.toFixed(0)} m, killer->carrier ${kd == null ? "-" : kd.toFixed(0)} m  own mates within 15 m ${mn.toFixed(2)}`);
  console.log(`            top killer reasons ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + " " + v).join(", ")}`);
  console.log(`            drops ${(sum((r) => r.R.drops) / rs.length).toFixed(1)}/match: re-grabbed by the carrier's side ${(sum((r) => r.R.regrab) / rs.length).toFixed(1)}, returned by touch ${(sum((r) => r.R.returned) / rs.length).toFixed(1)}  escorts: samples ${ed.length}, median distance to carrier ${med(ed) == null ? "-" : med(ed).toFixed(1)} m, ahead of carrier ${(100 * sum((r) => r.acc.escortAhead) / Math.max(1, sum((r) => r.acc.escortN))).toFixed(0)}%`);
}
if (process.env.CTFSPAWN) console.log("spawns by team:cluster", JSON.stringify([...SPAWNC.entries()].sort()));
console.log(`\nctf_probe${EVEN ? " --even (one SLATE operator benched)" : ""}${NOHUMAN ? " --nohuman" : ""}  secs=${SECS} seeds=${SEEDS}  AI avg ${BF.AI_PERF.avgMs.toFixed(3)} ms/tick  OBJ ${OBJ.OBJ_PERF.avgMs.toFixed(3)} ms/tick  wall ${Math.round((Date.now() - wall0) / 1000)} s`);
