#!/usr/bin/env node
// tools/expert_probe.mjs - the PVP tier ("expert": everyone plays like an expert
// human) measured in full matches on the three arenas x TDM / CTF / FFA.
//
// Real matches through the real driver, commander, spawn director and nav, with
// boot's difficulty id ("expert", every one of the nine others at the top skill
// band). The human slot is PARKED (noTarget + god: nobody perceives or shoots it),
// so this measures the nine NPCs against each other: navigation health, objective
// tempo, fight quality and movement quality. TTK against a scripted human lives in
// tools/persona_duel_probe.mjs.
//
//   node tools/expert_probe.mjs [--maps lanternwalk,switchyard,saltmarket]
//        [--modes tdm,ctf,ffa] [--seeds 4] [--secs 240] [--det] [--difficulty expert]
//
// Columns per (map, mode), pooled over seeds:
//   ended     matches that ended inside the cap          kills/min  all kills / minute
//   caps      CTF captures per match (first @ median s)   acc%       rounds that hurt / rounds fired
//   stuck>3s  path-following bots with < 0.3 m of net movement over 3 s, while a
//             path was still active, per match           worstIdle  matchprobe AC-4 "pushing, not moving" worst s
//   flank/min botstate 'flank' entries per minute        frag/min   grenades thrown per minute
//   pick/m    gun / ammo pick-ups by NPCs per match      idle@wall% idle (patrol/alert, speed<0.3) samples within 0.27 m of a solid
//   rev/100   heading reversals (>120 deg) per 100 moving samples (jitter)
//   det       same (map,mode,seed) twice -> identical snapshot hash (with --det)
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
const MODES = argOf("--modes", "tdm,ctf,ffa").split(",");
const SEEDS = parseInt(argOf("--seeds", "4"), 10);
const SECS = parseFloat(argOf("--secs", "240"));
const DIFF = argOf("--difficulty", "expert");
const DET = argv.includes("--det");
const JSON_OUT = argOf("--json", null);

const S = await import(u("core/sim/sim.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const BF = await import(u("core/ai/botfsm.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa"]) {
  const mod = await import(u(`core/match/modes/${id}.js`));
  MATCH.registerMode(id, mod.createMode);
}
const worlds = {};
function worldOf(id) {
  if (!worlds[id]) {
    const colliders = COL.buildCollidersFor(id, 1);
    worlds[id] = { colliders, nav: NAV.bakeNav(colliders, { cell: 0.75 }) };
  }
  return worlds[id];
}
const FLAT = ["arena", "spawnPoints", "clusters", "flags"];
function selectArena(id) {
  const blk = content.arenas && content.arenas[id];
  if (blk) for (const k of FLAT) if (blk[k] !== undefined) content[k] = blk[k];
}
const NULL_CMD = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, switchTo: null, interact: false, grenade: false };
const djb2 = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16); };
const median = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function runMatch(mapId, mode, seed) {
  selectArena(mapId);
  const { colliders, nav } = worldOf(mapId);
  const ev = { shotTrig: new Set(), hitTrig: new Set(), shots: 0, hits: 0, kills: 0, flanks: 0, frags: 0, picks: 0, caps: [], firstHit: new Map(), ttk: [] };
  const holder = { sim: null };
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed, mode, tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns, difficulty: DIFF },
    emit: (type, d) => {
      const t = holder.sim ? holder.sim.state.time : 0;
      if (type === "shot") { if (!d.impactOnly && !d.pen && d.shooter !== "P") { const sk = d.shooter + "@" + t.toFixed(3); if (!ev.shotTrig.has(sk)) { ev.shotTrig.add(sk); ev.shots++; } } }
      else if (type === "hurt") { if (d.attacker != null && d.attacker !== "P") { const hk = d.attacker + "@" + t.toFixed(3); if (!ev.hitTrig.has(hk)) { ev.hitTrig.add(hk); ev.hits++; } /* one per trigger pull: shotgun pellets must not read as 9 hits */ const k = d.victim + "|" + d.attacker; if (!ev.firstHit.has(k)) ev.firstHit.set(k, t); } }
      else if (type === "death") {
        if (d.victim !== "P") { ev.kills++; const k0 = ev.firstHit.get(d.victim + "|" + d.attacker); if (k0 != null && d.attacker != null && d.attacker !== "P") ev.ttk.push(t - k0); }
      } else if (type === "botstate") { if (d.state === "flank") ev.flanks++; }
      else if (type === "grenade") { if (d.phase === "out") ev.frags++; }
      else if (type === "pickup") { if (d.who !== "P") ev.picks++; }
      else if (type === "flag") { if (d.state === "captured") ev.caps.push(t); }
    },
  });
  holder.sim = sim;
  sim.mission.start(sim);
  const M = sim.state.match;
  const rules = sim.match.m.rules;
  if (SECS > 0) { rules.timeLimitS = SECS; }
  sim.flags.noTarget = true; sim.flags.god = true; // the parked human
  const startT = sim.state.time;
  const maxTicks = Math.ceil((SECS + 200) * 60) + 600;
  // stuck trackers
  const stuck = new Map(); let worstIdle = 0, pathStuckEvents = 0;
  const win = new Map();
  const mv = { rev: 0, moveS: 0, idleWall: 0, idle: 0 };
  const lastHead = new Map();
  let ticks = 0;
  while (ticks < maxTicks && M.phase !== "ended") {
    sim.step(NULL_CMD);
    ticks++;
    if (ticks % 15 === 0) {
      const t = sim.state.time;
      for (const b of sim.state.bots) {
        if (!b.alive) { win.delete(b.id); lastHead.delete(b.id); stuck.delete(b.id); continue; }
        const br = b._brain, sp = Math.hypot(b.vel[0], b.vel[2]);
        // path-following stuck: a path is active, the brain commands movement, < 0.3 m in 3 s
        let w = win.get(b.id);
        const trying = !!(br && br.mvActive && !br.arrived);
        if (!w) { w = { x: b.pos[0], z: b.pos[2], t, flagged: false }; win.set(b.id, w); }
        if (!trying || Math.hypot(b.pos[0] - w.x, b.pos[2] - w.z) > 0.3) { w.x = b.pos[0]; w.z = b.pos[2]; w.t = t; w.flagged = false; }
        else if (t - w.t >= 3 && !w.flagged) { w.flagged = true; pathStuckEvents++; }
        // matchprobe AC-4 (1 Hz proxy: pushing, not engaged, not at a station, < 0.5 m)
        if (ticks % 60 === 0) {
          const P = b.percept;
          const engaged = !!(P && P.target != null && (P.seesTarget || (P.lastSeenT != null && t - P.lastSeenT < 3)));
          const atStation = !!(br && br.arrived);
          const pushing = !atStation && !engaged && !!(b.cmd && (Math.abs(b.cmd.moveX) > 0.01 || Math.abs(b.cmd.moveZ) > 0.01));
          let s = stuck.get(b.id);
          if (!s) { stuck.set(b.id, { x: b.pos[0], z: b.pos[2], t, tries: 0, n: 0 }); }
          else {
            if (Math.hypot(b.pos[0] - s.x, b.pos[2] - s.z) > 0.5) { s.x = b.pos[0]; s.z = b.pos[2]; s.t = t; s.tries = 0; s.n = 0; }
            else { s.n++; if (pushing) s.tries++; if (s.tries >= Math.max(1, s.n * 0.5) && t - s.t > worstIdle) worstIdle = t - s.t; }
          }
        }
        // movement quality
        if (sp > 1.5) {
          const h = Math.atan2(b.vel[0], b.vel[2]); const lh = lastHead.get(b.id);
          if (lh != null) { let d = Math.abs(h - lh); if (d > Math.PI) d = 2 * Math.PI - d; mv.moveS++; if (d > 2.1) mv.rev++; }
          lastHead.set(b.id, h);
        } else lastHead.delete(b.id);
        if ((b.state === "patrol" || b.state === "alert") && sp < 0.3) {
          mv.idle++;
          if (sim.world.capsuleBlocked(b.pos[0], b.pos[1], b.pos[2], 0.62, 1.7)) mv.idleWall++;
        }
      }
    }
  }
  const snap = sim.match.snapshot();
  const secs = sim.state.time - startT;
  const modeCounters = (M.mode && M.mode.counters) || null;
  return {
    mapId, mode, seed, ended: M.phase === "ended", secs, ev, worstIdle, pathStuckEvents, mv,
    caps: mode === "ctf" ? (modeCounters && modeCounters.captures ? modeCounters.captures[0] + modeCounters.captures[1] : ev.caps.length) : 0,
    firstCap: ev.caps.length ? ev.caps[0] - startT : null,
    result: M.result, hash: djb2(JSON.stringify(snap)),
  };
}

const rows = [];
const t0 = Date.now();
const detBad = [];
for (const mapId of MAPS) for (const mode of MODES) {
  const mr = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = runMatch(mapId, mode, seed * 37 + 3);
    if (DET) { const r2 = runMatch(mapId, mode, seed * 37 + 3); if (r2.hash !== r.hash) detBad.push(`${mapId}/${mode}/${seed}`); }
    mr.push(r); rows.push(r);
  }
  const sum = (f) => mr.reduce((a, r) => a + f(r), 0);
  const mins = sum((r) => r.secs) / 60;
  const row = {
    mapId, mode, n: mr.length, ended: mr.filter((r) => r.ended).length,
    kpm: sum((r) => r.ev.kills) / mins, acc: 100 * sum((r) => r.ev.hits) / Math.max(1, sum((r) => r.ev.shots)),
    ttk: (() => { const a = mr.flatMap((r) => r.ev.ttk); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; })(),
    caps: sum((r) => r.caps) / mr.length, firstCap: median(mr.filter((r) => r.firstCap != null).map((r) => r.firstCap)),
    stuck: sum((r) => r.pathStuckEvents) / mr.length, worstIdle: Math.max(...mr.map((r) => r.worstIdle)),
    flank: sum((r) => r.ev.flanks) / mins, frag: sum((r) => r.ev.frags) / mins, picks: sum((r) => r.ev.picks) / mr.length,
    idleWall: 100 * sum((r) => r.mv.idleWall) / Math.max(1, sum((r) => r.mv.idle)), rev: 100 * sum((r) => r.mv.rev) / Math.max(1, sum((r) => r.mv.moveS)),
  };
  rows.push({ summary: row });
  console.log(`${mapId.padEnd(11)} ${mode.padEnd(3)} n=${row.n} ended ${row.ended}/${row.n}  kills/min ${row.kpm.toFixed(1).padStart(5)}  acc ${row.acc.toFixed(1).padStart(4)}%  ttk ${row.ttk == null ? " n/a" : row.ttk.toFixed(2)}s` +
    (mode === "ctf" ? `  caps/match ${row.caps.toFixed(1)} (first@${row.firstCap == null ? "n/a" : Math.round(row.firstCap) + "s"})` : "") +
    `  stuck>3s/match ${row.stuck.toFixed(2)}  worstIdle ${row.worstIdle.toFixed(0)}s  flank/min ${row.flank.toFixed(2)}  frag/min ${row.frag.toFixed(2)}  pick/m ${row.picks.toFixed(1)}  idle@wall ${row.idleWall.toFixed(1)}%  rev/100 ${row.rev.toFixed(2)}`);
}
console.log(`\nexpert_probe  difficulty=${DIFF}  secs=${SECS}  seeds=${SEEDS}  AI avg ${BF.AI_PERF.avgMs.toFixed(3)} ms/tick  wall ${Math.round((Date.now() - t0) / 1000)} s` + (DET ? `  determinism ${detBad.length ? "MISMATCH " + detBad.join(",") : "OK (every match run twice, identical snapshot hash)"}` : ""));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows.filter((r) => r.summary).map((r) => r.summary), null, 1));
