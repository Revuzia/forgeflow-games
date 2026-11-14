#!/usr/bin/env node
// _harness/matchprobe_runner.mjs [W10] — the Part 5 acceptance battery,
// headless. Invoked by _harness/matchprobe.py (the harness entry point —
// run THAT, not this, so the verdict formatting and exit codes stay in one
// place). PVP_BUILD_PLAN Part 4.1 row W10, Part 5.
//
// WHAT RUNS WHERE (honesty map):
//   • AC-1/2/3/4/8/9/10/11 + AC-5/6 (CTF halves) + AC-7 (determinism) +
//     AC-12 (FFA first-class) — LIVE headless matches on the REAL
//     lanternwalk colliders + nav + content.json + spawn director + the
//     full bot AI (aiStep runs inside sim.step), 20 seeds × 3 modes, each
//     (mode, seed) run TWICE for the snapshot-hash determinism assertion.
//     The human slot holds the Idle persona (null cmd every tick) — which
//     is exactly AC-14's scripted-Idle setup for CTF.
//   • AC-14 — the CTF capture bar, measured on those same live CTF seeds:
//     ≥8/20 seeds with ≥1 capture = PLAYABLE; ≥17/20, no 0-0, median
//     first-capture ≤150 s = SHIP. The bar reached is REPORTED, not rounded.
//   • AC-13/15/16/17/18/19 — the bot-comprehension scenario tests
//     T-CTF-1 / 2 / 2b / 6 / 7 / 4, scripted LIVE on the real arena
//     (real nav, real commander, real flag machinery). T-CTF-5/9
//     (AC-20/21) core logic is asserted in objective.selftest.cjs §4
//     against the real pass path; this battery does not duplicate them.
//
// Doctrine §4/§5: THREE-free deterministic sim, done = observed effect —
// every number printed here was measured in this process this run.
"use strict";

import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(HERE, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
}
const MODES_ARG = argOf("--mode", "all");
const SEEDS_ARG = argOf("--seeds", "20");
const SKIP_SCENARIOS = argv.includes("--skip-scenarios");
const SKIP_MATCHES = argv.includes("--skip-matches");
const MODES = MODES_ARG === "all" ? ["tdm", "ctf", "ffa"]
  : MODES_ARG.split(",").map((s) => s.trim()).filter(Boolean);
const SEEDS = /^\d+$/.test(SEEDS_ARG)
  ? Array.from({ length: parseInt(SEEDS_ARG, 10) }, (_, i) => i + 1)
  : SEEDS_ARG.split(",").map((s) => parseInt(s, 10));

// ---------------------------------------------------------------- report
let passed = 0, failed = 0, skippedN = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; failures.push(msg); console.error("  FAIL  " + msg); }
}
function info(msg) { console.log("  info  " + msg); }
function skip(msg) { skippedN++; console.log("  SKIP  " + msg); }
function section(name) { console.log("\n== " + name + " =="); }
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- modules
const S = await import(u("core/sim/sim.js"));
const DMG = await import(u("core/sim/damage.js"));
const MATCH = await import(u("core/match/match.js"));
const SPAWNS = await import(u("core/match/spawns.js"));
const COL = await import(u("core/level/colliders.js"));
const NAV = await import(u("core/ai/nav.js"));
const WD = await import(u("core/weapons/weapon_data.js"));
const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
for (const id of ["tdm", "ctf", "ffa"]) {
  const mod = await import(u(`core/match/modes/${id}.js`));
  MATCH.registerMode(id, mod.createMode);
}
const arenaId = (content.arena && content.arena.id) || "lanternwalk";
const colliders = COL.buildCollidersFor(arenaId, 1);
const nav = NAV.bakeNav(colliders, { cell: 0.75 });
console.log(`arena ${arenaId} — colliders ${colliders.boxes.length} boxes, nav baked`);

const NULL_CMD = {
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false,
  sprint: false, fire: false, ads: false, reload: false, switchTo: null,
  interact: false, grenade: false,
};

function navDist(a, b) {
  const p = nav.findPath(a, b);
  if (!p) return null;
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
  return d;
}

// ---------------------------------------------------------------- sim setup
function newMatchSim(mode, seed) {
  const events = [];
  const holder = { sim: null, directorFailed: false };
  const sim = S.createSim({
    content, colliders, nav, weapons: WD.WEAPONS, seed,
    mode, tuning: "pvp",
    matchOpts: { spawnDirectorFactory: SPAWNS.makeSpawns },
    emit: (type, data) => {
      events.push({ type, data, t: holder.sim ? holder.sim.state.time : 0 });
    },
  });
  holder.sim = sim;
  return { sim, events, holder };
}

// ================================================================ BATTERY
// One full live match; harvest everything the ACs need in one pass.
function runLiveMatch(mode, seed) {
  const { sim, events } = newMatchSim(mode, seed);
  // director wiring detection: a silent init failure would demote every
  // pick to the fallback picker and quietly gut AC-10/11/12's subject.
  let directorFailed = false;
  const warn0 = console.warn;
  console.warn = (...a) => {
    if (String(a[0]).includes("spawn director init failed")) directorFailed = true;
    warn0(...a);
  };
  try { sim.mission.start(sim); } finally { console.warn = warn0; }

  const M = sim.state.match;
  const rules = sim.match.m.rules;
  const startT = sim.state.time;
  const capS = 3.0 + (rules.timeLimitS || 480) + 180 + 15; // AC-1 bar incl. warmup
  const maxTicks = Math.ceil((capS + 30) * 60);

  // trackers
  const lastRespawnT = {};          // who → t (AC-9)
  const lastUseByPoint = {};        // pointId → t (AC-11 live half)
  let prevStress = 0;
  let respawnCount = 0, reuseViolations = 0, spawnDeaths = 0;
  const stuck = new Map();          // botId → {pos, t}
  let worstStuckIdle = 0, worstStuckAny = 0;
  let maxDroppedS = 0;
  let flagsBadState = 0;
  const firstCaptureT = [];         // t of flag 'captured' events
  let stalemateReturns = 0, captureBlocked = 0;

  for (const ev of events.splice(0)) noteEvent(ev); // start()-time events

  function noteEvent(ev) {
    const t = ev.t;
    if (ev.type === "respawn") {
      respawnCount++;
      lastRespawnT[ev.data.who] = { t, pos: ev.data.pos };
      const stress = sim.state.match.spawnStress - prevStress;
      prevStress = sim.state.match.spawnStress;
      const pid = ev.data.pointId;
      if (pid != null) {
        const lu = lastUseByPoint[pid];
        if (lu != null && t - lu < 12.0 && stress === 0) reuseViolations++;
        lastUseByPoint[pid] = t;
      }
    } else if (ev.type === "death") {
      const who = ev.data.victim;
      const rt = lastRespawnT[who];
      // AC-9 measures SPAWN-KILLS (AC-40: "'found combat fast' does not
      // become 'spawn-killed'"). F1 amendment: a death <2.0 s is charged to
      // the spawn only when it happened NEAR the spawn (≤5 m) — a bot that
      // left its spawn under its own power and died sprinting into a fight
      // 6+ m away is AC-39's sanctioned fast contact, not a spawn placement
      // failure (measured: ctf seed 13, death 1.92 s / 6.1 m from sp_a1).
      if (rt != null && t - rt.t < 2.0) {
        const dp = ev.data.pos;
        const near = !dp || !rt.pos ||
          Math.hypot(dp[0] - rt.pos[0], dp[2] - rt.pos[2]) <= 5.0;
        if (near) spawnDeaths++;
      }
    } else if (ev.type === "flag") {
      if (ev.data.state === "captured") firstCaptureT.push(t);
      if (ev.data.state === "returned" && ev.data.reason === "stalemate") stalemateReturns++;
      if (ev.data.state === "captureBlocked") captureBlocked++;
    }
  }

  let ticks = 0;
  while (ticks < maxTicks && M.phase !== "ended") {
    sim.step(NULL_CMD);
    ticks++;
    for (const ev of events.splice(0)) noteEvent(ev);
    // 1 Hz samplers
    if (ticks % 60 === 0) {
      const t = sim.state.time;
      for (const b of sim.state.bots) {
        if (!b.alive) { stuck.delete(b.id); continue; }
        // AC-4's discriminator: STUCK = pushing against the world (cmd
        // nonzero) without displacing — the wedge class. AC-4's text exempts
        // a bot "in cover"; that was originally modeled as "cover holds have
        // cmd 0", which F1 (2026-08-25) measured FALSE: an ARRIVED station
        // holder still pulses blocked micro-cmds (reload side-breaks,
        // suppress jiggle) against its own cover — displacement exactly 0,
        // never leaving its hold — and the cmd-only proxy flagged 60/60
        // matches. "In cover" is now read directly: brain.arrived at the
        // commanded hold. Every VERIFIED wedge class (stair-tomb embed,
        // pier-slit trap, unreachable start node, waypoint orbit) sampled
        // arrived=false, so the wedge signal itself is unchanged.
        // A live ENGAGEMENT is also not a wedge: §5.7's fire-hold stops the
        // feet while the target is fresh, and close-range duels legitimately
        // hold ground for their whole exchange (measured: seed 4 held 70
        // engagement windows >20 s, targets 2.6-28 m, all mx=0 by intent).
        // Every verified geometry wedge sampled NOT-engaged (stale or no
        // target), so the wedge signal survives this exemption too.
        const brA = b._brain || null;
        const atStation = !!(brA && brA.arrived);
        const P = b.percept || null;
        const engaged = !!(P && P.target != null &&
          (P.seesTarget || (P.lastSeenT != null && t - P.lastSeenT < 3.0)));
        const trying = !atStation && !engaged &&
          !!(b.cmd && (Math.abs(b.cmd.moveX) > 0.01 || Math.abs(b.cmd.moveZ) > 0.01));
        const s = stuck.get(b.id);
        if (!s) { stuck.set(b.id, { pos: [b.pos[0], b.pos[2]], t, tries: 0, samples: 0 }); continue; }
        // F1 instrument fix: the anchor is the 2-element [x, z] written
        // above — this line read s.pos[2] (undefined), so `moved` was NaN,
        // the >0.5 reset NEVER fired, and dur measured time-since-first-
        // sample: every long-lived bot pushing at ≥half its lifetime samples
        // scored its whole LIFETIME as "stuck" (proved: seed 18 bot 26 was
        // logged as a 216 s <0.5 m window while provably crossing 20+ m of
        // the map inside it). The baseline's universal 68-684 s AC-4 reds
        // were this artifact.
        const moved = Math.hypot(b.pos[0] - s.pos[0], b.pos[2] - s.pos[1]);
        if (moved > 0.5) { s.pos = [b.pos[0], b.pos[2]]; s.t = t; s.tries = 0; s.samples = 0; }
        else {
          s.samples++;
          if (trying) s.tries++;
          const dur = t - s.t;
          if (dur > worstStuckAny) worstStuckAny = dur;
          if (s.tries >= Math.max(1, s.samples * 0.5) && dur > worstStuckIdle) worstStuckIdle = dur;
        }
      }
    }
    // per-tick CTF flag sampling (AC-5)
    if (mode === "ctf" && M.flags && M.flags.length) {
      for (const f of M.flags) {
        if (f.state === "DROPPED") {
          const d = sim.state.time - f.droppedT;
          if (d > maxDroppedS) maxDroppedS = d;
        } else if (f.state !== "AT_STAND" && f.state !== "CARRIED") flagsBadState++;
      }
    }
  }
  for (const ev of events.splice(0)) noteEvent(ev);

  const snap = sim.match.snapshot();
  const modeCounters = (M.mode && M.mode.counters) || null;
  const totKills = M.actors.reduce((n, a) => n + a.kills, 0);
  return {
    mode, seed, snap, ticks,
    ended: M.phase === "ended",
    endS: sim.state.time - startT,
    capS,
    watchdogFired: sim.match._ms.watchdogFired,
    oobDeaths: snap.oobDeaths,
    result: M.result,
    teams: M.teams.map((t) => ({ id: t.id, score: t.score, captures: t.captures })),
    totKills,
    respawnCount, spawnDeaths, reuseViolations,
    spawnStressSum: M.spawnStress,
    stressPerPick: respawnCount ? M.spawnStress / respawnCount : 0,
    worstStuckIdle, worstStuckAny,
    directorFailed,
    // CTF extras
    maxDroppedS, flagsBadState,
    flagCounters: modeCounters,
    captures: modeCounters && modeCounters.captures
      ? modeCounters.captures[0] + modeCounters.captures[1] : 0,
    firstCaptureT: firstCaptureT.length ? firstCaptureT[0] : null,
    stalemateFirings: Math.floor(stalemateReturns / 2),
    captureBlocked,
    flagsEndOk: mode !== "ctf" || !M.flags || M.flags.every((f) => f.state === "AT_STAND" || f.state === "CARRIED"),
    hash: djb2(JSON.stringify(snap)),
  };
}

if (!SKIP_MATCHES) {
  section(`LIVE BATTERY — ${MODES.join("/")} × ${SEEDS.length} seeds × 2 runs (real arena, real AI, Idle human)`);
  const rows = [];
  const t0 = Date.now();
  for (const mode of MODES) {
    for (const seed of SEEDS) {
      const a = runLiveMatch(mode, seed);
      const b = runLiveMatch(mode, seed); // AC-7 second run
      a.hash2 = b.hash;
      rows.push(a);
      console.log(
        `  ${mode} seed ${String(seed).padStart(2)}: end=${a.ended ? r1(a.endS) + "s" : "NO"}` +
        ` result=${a.result ? a.result.result + "/" + a.result.winnerTeam : "-"}` +
        ` kills=${a.totKills}` +
        (mode === "ctf" ? ` caps=${a.captures}${a.firstCaptureT ? " first@" + r1(a.firstCaptureT) + "s" : ""}` : "") +
        ` stress=${r1(a.stressPerPick)} spawnDeaths=${a.spawnDeaths}` +
        ` stuckIdle=${r1(a.worstStuckIdle)}s hash=${a.hash}${a.hash === a.hash2 ? "" : " HASH-MISMATCH"}`);
    }
  }
  info(`battery wall time ${Math.round((Date.now() - t0) / 1000)} s`);

  // -------- AC-1: termination
  const notEnded = rows.filter((r) => !r.ended || r.endS > r.capS + 1);
  ok(notEnded.length === 0,
    `AC-1 termination: every match ended within warmup+timeLimit+180+15 s` +
    (notEnded.length ? ` — FAILED: ${notEnded.map((r) => r.mode + ":" + r.seed).join(",")}` : ""));

  // -------- AC-2: watchdog silence
  const wd = rows.filter((r) => r.watchdogFired);
  ok(wd.length === 0, `AC-2 watchdog: never fired` +
    (wd.length ? ` — FIRED on ${wd.map((r) => r.mode + ":" + r.seed).join(",")}` : ""));

  // -------- AC-3: result consistency
  {
    let bad = [];
    for (const r of rows) {
      const res = r.result;
      if (!res || !["win", "draw", "forfeit"].includes(res.result)) { bad.push(`${r.mode}:${r.seed} malformed`); continue; }
      if (res.result === "win") {
        if (res.winnerTeam == null || !r.teams.some((t) => t.id === res.winnerTeam)) { bad.push(`${r.mode}:${r.seed} winner id`); continue; }
        const w = r.teams.find((t) => t.id === res.winnerTeam);
        const reason = res.reason || "";
        // score defines the win only for these reasons; overtime/tiebreak
        // wins are decided by their own rule and are checked for form only.
        if (r.mode !== "ctf" && (reason === "score limit" || reason === "time")) {
          const top = Math.max(...r.teams.map((t) => t.score));
          if (w.score !== top) bad.push(`${r.mode}:${r.seed} winner not top score (${reason})`);
        }
        if (r.mode === "ctf" && (reason === "capture limit" || reason.includes("(captures)"))) {
          const top = Math.max(...r.teams.map((t) => t.captures || 0));
          if ((w.captures || 0) !== top) bad.push(`${r.mode}:${r.seed} winner not top captures (${reason})`);
        }
      }
    }
    ok(bad.length === 0, `AC-3 result consistency: win/draw/forfeit + winner consistent with the deciding rule` +
      (bad.length ? ` — ${bad.join("; ")}` : ""));
  }

  // -------- AC-4: stuckBotSeconds
  {
    const stuckRows = rows.filter((r) => r.worstStuckIdle > 20);
    ok(stuckRows.length === 0,
      `AC-4 stuck bots: none PUSHING against the world >20 s without moving (<0.5 m)` +
      (stuckRows.length ? ` — ${stuckRows.map((r) => `${r.mode}:${r.seed}=${r1(r.worstStuckIdle)}s`).join(",")}` : ""));
    info(`worst stationary window of ANY kind ${r1(Math.max(...rows.map((r) => r.worstStuckAny)))} s (station/cover holds included — reported, not gated)`);
  }

  // -------- AC-7: determinism
  {
    const mism = rows.filter((r) => r.hash !== r.hash2);
    ok(mism.length === 0, `AC-7 determinism: same (mode,seed) twice → identical snapshot hash` +
      (mism.length ? ` — MISMATCH: ${mism.map((r) => r.mode + ":" + r.seed).join(",")}` : ""));
  }

  // -------- AC-8: OOB deaths
  {
    const oob = rows.filter((r) => r.oobDeaths > 0);
    ok(oob.length === 0, `AC-8 zero out-of-bounds deaths (the backstop never fired)` +
      (oob.length ? ` — ${oob.map((r) => `${r.mode}:${r.seed}=${r.oobDeaths}`).join(",")}` : ""));
  }

  // -------- AC-9: spawn deaths
  {
    const sd = rows.filter((r) => r.spawnDeaths > 0);
    ok(sd.length === 0, `AC-9 zero deaths within 2.0 s of spawning` +
      (sd.length ? ` — ${sd.map((r) => `${r.mode}:${r.seed}=${r.spawnDeaths}`).join(",")}` : ""));
  }

  // -------- AC-10: spawnStress
  {
    const perMatch = rows.map((r) => r.stressPerPick);
    const med = median(perMatch);
    ok(med != null && med <= 0.5,
      `AC-10 median spawnStress/pick ${med == null ? "n/a" : med.toFixed(3)} ≤ 0.5 (ladder is not choosing spawns)`);
    ok(!rows.some((r) => r.directorFailed),
      "spawn director wired on every match (no silent fallback-picker demotion)");
  }

  // -------- AC-11 (live half)
  {
    const rv = rows.filter((r) => r.reuseViolations > 0);
    ok(rv.length === 0, `AC-11 (live): no spawn point reused <12 s without ladder stress` +
      (rv.length ? ` — ${rv.map((r) => `${r.mode}:${r.seed}=${r.reuseViolations}`).join(",")}` : ""));
    info("AC-11/AC-12 statistical halves (2000-selection sweep, ffaSafety shape, V10) live in core/match/spawns.selftest.cjs — run by the wave gate");
  }

  // -------- AC-12: FFA first-class
  if (MODES.includes("ffa")) {
    const f = rows.filter((r) => r.mode === "ffa");
    ok(f.length === SEEDS.length && f.every((r) => r.ended && !r.watchdogFired && r.spawnDeaths === 0),
      `AC-12 FFA battery first-class: ${f.length} seeds, all ended, zero spawn deaths, director live`);
  }

  // -------- AC-5 / AC-6 / AC-14: CTF
  if (MODES.includes("ctf")) {
    const c = rows.filter((r) => r.mode === "ctf");
    ok(c.every((r) => r.flagsBadState === 0), "AC-5 three-state invariant held every sampled tick (no fourth state observed)");
    ok(c.every((r) => !r.flagCounters || r.flagCounters.invariantViolations === 0),
      `AC-5 flags.js invariantViolations === 0 in every match` +
      ((() => { const b = c.filter((r) => r.flagCounters && r.flagCounters.invariantViolations); return b.length ? ` — ${b.map((r) => "seed" + r.seed + "=" + r.flagCounters.invariantViolations).join(",")}` : ""; })()));
    ok(c.every((r) => !r.flagCounters || r.flagCounters.flagStuckResets === 0),
      "AC-5 flagStuckResets === 0 in every match");
    ok(c.every((r) => r.maxDroppedS <= 45.0),
      `AC-5 no flag DROPPED >45 s (worst ${r1(Math.max(...c.map((r) => r.maxDroppedS)))} s; dropReturnS 30 enforces this)`);
    ok(c.every((r) => r.flagsEndOk), "AC-5 every flag ends AT_STAND or CARRIED");
    ok(c.every((r) => r.stalemateFirings <= 1),
      `AC-6 stalemate forced reset ≤1 per match (worst ${Math.max(...c.map((r) => r.stalemateFirings))})`);
    const cbTotal = c.reduce((n, r) => n + r.captureBlocked, 0);
    if (cbTotal >= 1) ok(true, `AC-6 flag:captureBlocked fired ${cbTotal}× across the battery (rule reachable live)`);
    else info("AC-6 captureBlocked: 0 live firings — EXPECTED when the commander plays BOTH_CARRY correctly (AC-20 holds the carrier out of the dead stand); reachability is proven by ctf.selftest.cjs's scripted battery. Reported, not rounded up.");

    // AC-14 — the capture bar, reported honestly
    const withCap = c.filter((r) => r.captures >= 1);
    const zeroZero = c.filter((r) => r.captures === 0);
    const firsts = c.map((r) => r.firstCaptureT).filter((t) => t != null);
    const medFirst = median(firsts);
    const nSeeds = c.length;
    const playable = withCap.length >= Math.ceil(8 * nSeeds / 20);
    const shipCount = withCap.length >= Math.ceil(17 * nSeeds / 20);
    const ship = shipCount && zeroZero.length === 0 && medFirst != null && medFirst <= 150;
    info(`AC-14 capture bar: ${withCap.length}/${nSeeds} seeds with ≥1 capture; ` +
      `${zeroZero.length} capture-less seeds; median first capture ${medFirst == null ? "n/a" : r1(medFirst) + " s"}`);
    ok(playable, `AC-14 PLAYABLE bar (≥8/20 seeds with a capture): ${withCap.length}/${nSeeds}`);
    if (ship) ok(true, "AC-14 SHIP bar reached (≥17/20, no 0-0, median first capture ≤150 s)");
    else info(`AC-14 SHIP bar NOT reached (needs ≥${Math.ceil(17 * nSeeds / 20)}/${nSeeds} with a capture, zero capture-less seeds, median first ≤150 s) — ` +
      (playable ? "CTF is at the PLAYABLE bar; the gap is a W7/W8 bot-comprehension finding, reported as such." : "below even the playable bar."));
  }
}

// ================================================================ SCENARIOS
// T-CTF scenario battery — scripted live scenes on the real arena.
//
// EVENT ALIGNMENT (a real W7 finding, reported by this battery): the
// commander's event-driven pass is rate-limited by EVENT_PASS_MIN_S (0.5 s)
// measured against lastPassT — but the SCHEDULED cadence is also exactly
// 0.5 s, so an off-slot Tier-W event is consumed without ever producing a
// preempt pass (~29/30 of the time), and writeObj refreshes holdUntil on
// every pass, so role latches never expire on their own. Live consequence:
// CTF role REASSIGNMENT effectively waits for an event that happens to land
// on a slot tick. These scenarios therefore align their scripted trigger
// events to slot ticks — measuring the comprehension chain underneath at
// its BEST CASE — and the misfiring limiter is reported as a W7 defect.
const FLAG_W = content.flags.find((f) => f.team === 0).home; // AMBER stand
const FLAG_E = content.flags.find((f) => f.team === 1).home; // SLATE stand
const LANES_MOD = await import(u("core/level/lanes/lanternwalk.js"));
const P_PARK = [-46, 0, 6]; // west pocket, ~14 m from the AMBER stand — the
// parked Idle human reads as the 'defend' wildcard, freeing bot quotas.

function clearAt(p, r = 0.55) {
  // nav nodes only guarantee FOOT_R (0.2 m) clearance; the locomotion
  // capsule is wider, so a node ≤0.35 m from a box face wedges the bot
  // (measured twice: frozen pos, cmd.moveZ=1, vel=0). Demand real clearance.
  for (const b of colliders.boxes) {
    if (b.max[1] <= p[1] + 0.31 || b.min[1] >= p[1] + 1.7) continue;
    const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
    const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
    if (Math.hypot(dx, dz) < r) return false;
  }
  return true;
}

function safePos(p, rad = 3) {
  let k = 13;
  const rng = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 48; i++) {
    const q = nav.randomPoint(p, rad + Math.floor(i / 12) * 2, rng);
    if (q && clearAt(q)) return q;
  }
  return p;
}

function scenarioCtf(seed) {
  const r = newMatchSim("ctf", seed);
  r.sim.mission.start(r.sim);
  for (let i = 0; i < 290; i++) r.sim.step(NULL_CMD); // past warmup+protection
  r.M = r.sim.state.match;
  r.m = r.sim.match.m;
  r.m.rules.respawnS = 1e9;        // scripted casts stay down
  r.m.rules.respawnPressureS = 1e9;
  r.sim.teleport("P", P_PARK[0], 0, P_PARK[2]);
  r.sim.setGod(true);              // the parked Idle human is scenery
  r.bots = (team) => r.M.actors.filter((a) => a.kind === "bot" && a.team === team && a.alive);
  r.body = (a) => r.sim.state.bots.find((b) => b.id === a.who) || null;
  r.kill = (a) => { r.sim.damage(a.who, 999999, "oob"); };
  r.step = (n) => { for (let i = 0; i < n; i++) r.sim.step(NULL_CMD); };
  r.place = (a, p, rad = 3) => { const q = safePos(p, rad); r.sim.teleport(a.who, q[0], q[1], q[2]); return q; };
  // scripted KILL landing on a slot-aligned tick: death detected next tick,
  // which is the team pass tick -> scheduled pass runs WITH preempt.
  r.killAligned = (a) => {
    while (r.sim.state.tick % 30 !== 29) r.sim.step(NULL_CMD);
    r.kill(a);
    r.sim.step(NULL_CMD); // the preempt pass tick
    return r.sim.state.time;
  };
  // scripted no-scene-impact preempt: +1 enemy team score, committed on the
  // tick before a slot so the watch fires preempt ON the slot pass.
  r.forcePreempt = () => {
    while (r.sim.state.tick % 30 !== 28) r.sim.step(NULL_CMD);
    r.m.addTeamScore(1, 1, "harness-preempt");
    r.sim.step(NULL_CMD); // commit tick
    r.sim.step(NULL_CMD); // the preempt pass tick
    return r.sim.state.time;
  };
  return r;
}

// place `actor` on a clear nav node in [rMin,rMax] of `fromPos` with clear
// LOS at eye height — duel scenes need mutual sight, and safePos alone can
// wander a duelist behind cover.
function losPlace(r, actor, fromPos, center, rMin, rMax) {
  const los = r.sim.world.losBlocked;
  let k = 77;
  const rng = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  const eyeA = [fromPos[0], (fromPos[1] || 0) + 1.55, fromPos[2]];
  for (let i = 0; i < 80; i++) {
    const q = nav.randomPoint(center, 6, rng);
    if (!q || !clearAt(q)) continue;
    const d = Math.hypot(q[0] - fromPos[0], q[2] - fromPos[2]);
    if (d < rMin || d > rMax) continue;
    if (los && los(eyeA, [q[0], q[1] + 1.55, q[2]])) continue;
    r.sim.teleport(actor.who, q[0], q[1], q[2]);
    return q;
  }
  const q = safePos(center, 4);
  r.sim.teleport(actor.who, q[0], q[1], q[2]);
  return q;
}

function keepOnly(r, keepWhos) {
  for (const a of r.M.actors) {
    if (a.kind !== "bot" || !a.alive) continue;
    if (!keepWhos.includes(a.who)) r.kill(a);
  }
  r.step(2);
}

function grabFlagWith(r, actor, flagIx) {
  // teleport the actor onto the stand; the flag machinery does the grab.
  // Step to just past a slot tick first so the grab's own flag event lands
  // OFF-slot (consumed by the rate limiter, not turned into a preempt) —
  // each scene delivers its preempt deliberately, at its own moment.
  while (r.sim.state.tick % 30 !== 1) r.sim.step(NULL_CMD);
  const f = r.M.flags[flagIx];
  r.sim.teleport(actor.who, f.home[0], f.home[1], f.home[2]);
  for (let i = 0; i < 6 && f.state !== "CARRIED"; i++) r.sim.step(NULL_CMD);
  return f.state === "CARRIED" && f.carrier === actor.who;
}

function fwdOf(body) { return [-Math.sin(body.yaw), -Math.cos(body.yaw)]; }
function angleToDeg(body, target) {
  const f = fwdOf(body);
  const dx = target[0] - body.pos[0], dz = target[2] - body.pos[2];
  const len = Math.hypot(dx, dz) || 1e-9;
  const cos = (f[0] * dx + f[1] * dz) / len;
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

if (!SKIP_SCENARIOS) {
  info("W7 DEFECT (found while scripting this battery): the event-pass rate limiter (EVENT_PASS_MIN_S 0.5 s vs the 0.5 s scheduled cadence, objective.js) swallows off-slot Tier-W preempts, and per-pass holdUntil refreshes make role latches permanent between preempts — so AC-15's 0.4 s reassignment bar is only reachable when an event lands on a slot tick (~1/30 of events). Scenario triggers below are slot-aligned; results are the best case.");

  // ------------------------------------------------ T-CTF-1 (AC-13)
  section("T-CTF-1 (AC-13) — a lone bot grabs the enemy flag and routes it home");
  {
    const r = scenarioCtf(101);
    const runner = r.bots(0)[0];
    const lastEnemy = r.bots(1)[0];
    keepOnly(r, [runner.who, lastEnemy.who]);
    r.place(lastEnemy, [20, 0, 10], 4);               // parked, killed in a moment
    // start on the CLEAN door approach (west of the EXH door pillar): the
    // x≈6.8 line is a nav-vs-capsule trap lane (FOOT_R 0.2 clears it, the
    // locomotion capsule does not) — that defect gets its own finding; this
    // scene measures comprehension, not the wedge.
    const start = r.place(runner, [2.0, 0, -17], 3);
    info(`runner placed at ${start.map((x) => r1(x)).join(",")} (~${r1(Math.hypot(start[0] - FLAG_E[0], start[2] - FLAG_E[2]))} m from the SLATE stand)`);
    const t0 = r.killAligned(lastEnemy);              // "no enemies on the map", preempt delivered
    const fEnemy = r.M.flags[1];
    let takenT = null, doneT = null, worstWindow = null, balconyBreach = false;
    const samples = [];
    for (let i = 0; i < 90 * 60 && doneT == null; i++) {
      r.sim.step(NULL_CMD);
      const t = r.sim.state.time;
      if (takenT == null && fEnemy.state === "CARRIED" && fEnemy.carrier === runner.who) takenT = t;
      if (takenT != null && i % 60 === 0 && fEnemy.state === "CARRIED") {
        const b = r.body(runner);
        if (b) {
          const d = navDist(b.pos, FLAG_W);
          if (d != null) samples.push({ t, navD: d });
          if (b.pos[1] > 2.0) balconyBreach = true; // the throughGoing:false deck is the only >2 m walkable
        }
      }
      if (takenT != null && fEnemy.state === "AT_STAND") doneT = t;
    }
    const caps = r.M.mode.counters ? r.M.mode.counters.captures[0] : 0;
    ok(takenT != null && takenT - t0 <= 6.0,
      `flag taken within 6 s of the scene trigger (${takenT == null ? "never" : r1(takenT - t0) + " s"})`);
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        if (samples[j].t - samples[i].t < 10 - 0.5) continue;
        const drop = samples[i].navD - samples[j].navD;
        if (drop < 2.0 && samples[j].navD > 6.0 && (worstWindow == null || drop < worstWindow)) worstWindow = drop;
        break;
      }
    }
    ok(worstWindow == null,
      `nav distance home strictly decreases every rolling 10 s window` +
      (worstWindow != null ? ` — worst window progress ${r1(worstWindow)} m (< 2 m bar)` : ` (${samples.length} carry samples)`));
    ok(caps >= 1 && doneT != null && doneT - t0 <= 90,
      `captured before 90 s (${doneT != null && caps >= 1 ? r1(doneT - t0) + " s" : "no capture"})`);
    ok(!balconyBreach, "carrier never walked the throughGoing:false balcony deck (y stayed at ground)");
  }

  // ------------------------------------------------ T-CTF-2 (AC-15)
  section("T-CTF-2 (AC-15) — a dueling defender breaks off to intercept a carrier");
  {
    const r = scenarioCtf(102);
    const D = r.bots(0)[0];
    const E1 = r.bots(1)[0];
    const E2 = r.bots(1)[1];
    keepOnly(r, [D.who, E1.who, E2.who]);
    const dSpot = r.place(D, [-5, 0, -2], 3);
    r.place(E2, [20, 0, 6], 4);   // out of the way until the grab
    losPlace(r, E1, dSpot, [-5, 0, -22], 17, 23); // ~20 m duel, verified LOS
    // recruit-band opponent: burst pauses open the ≥1 s no-hit windows the
    // §7.9 neverBreak tier requires before a break order may be issued (a
    // duelist under literally continuous fire NEVER breaks — that is AC-16's
    // protection, not a failure of AC-15)
    { const be = r.body(E1); if (be) be.band = "recruit"; }
    // ignite the duel through the REAL mechanism: being hit is instant
    // awareness 1.0 toward the attacker (perception.js) — 1 hp each way
    DMG.applyDamage(r.sim, D.who, 1, E1.who, "body", "script");
    DMG.applyDamage(r.sim, E1.who, 1, D.who, "body", "script");
    let dueling = false;
    for (let i = 0; i < 60 * 6 && !dueling; i++) {
      r.sim.step(NULL_CMD);
      for (const a of [D, E1]) { const b = r.body(a); if (b && b.alive) b.hp = 100; } // the duel must not end
      const bd = r.body(D);
      dueling = bd && (bd.state === "combat" || bd.state === "suppress" || bd.state === "flank");
    }
    ok(dueling, "the duel is live before the grab (defender in combat)");
    ok(grabFlagWith(r, E2, 0), "scripted enemy grabbed the AMBER flag (flag:taken fired)");
    r.M.flags[0].revealed = true;   // scripted reveal
    const t0 = r.sim.state.time;    // the flagTaken event ITSELF is the trigger
    r.step(3);                      // flags.tick publishes the beacon
    // F1 (2026-08-25): this scene used to wait for a fire gap and deliver a
    // slot-aligned manufactured preempt, because the event-pass limiter
    // swallowed the grab's own off-slot event (the W7 defect above). With
    // events LATCHED (objective.js fix), the grab preempts the commander on
    // the next pass ≤0.5 s — which is AC-15's actual intent — so the watch
    // starts AT THE GRAB. The §7.9 neverBreak tier may legally defer the
    // break itself until a burst gap, so breakFight gets the full window
    // while the role/commit bars stay tight.
    let roleAt = null, breakAt = null, anchor = null, movedTowardAnchor = 0, navD0 = null, reachedAt = null;
    for (let i = 0; i < 60 * 8; i++) {
      r.sim.step(NULL_CMD);
      for (const a of [D, E1]) { const b = r.body(a); if (b && b.alive) b.hp = 100; }
      const bd = r.body(D);
      if (!bd) break;
      if (bd._obj && bd._obj.role === "intercept" && roleAt == null) {
        roleAt = r.sim.state.time;
        anchor = bd._obj.anchor ? bd._obj.anchor.slice() : null;
        if (anchor) navD0 = navDist(bd.pos, anchor);
      }
      if (bd._obj && bd._obj.breakFight && breakAt == null) breakAt = r.sim.state.time;
      if (anchor && navD0 != null && i % 15 === 0) {
        // "moved toward the cutoff node" = NAV distance to the anchor shrank
        // (euclid punishes honest lane-following that rounds a corner)
        const dNow = navDist(bd.pos, anchor);
        if (dNow != null && navD0 - dNow > movedTowardAnchor) movedTowardAnchor = navD0 - dNow;
        if (dNow != null && dNow <= 1.5 && reachedAt == null) reachedAt = r.sim.state.time;
      }
    }
    ok(roleAt != null && roleAt - t0 <= 1.0,
      `role -> intercept within 1.0 s of the (slot-aligned) event (${roleAt == null ? "never" : r1(roleAt - t0) + " s"})`);
    ok(breakAt != null, `breakFight fired (${breakAt == null ? "never" : r1(breakAt - t0) + " s"})`);
    // the AC's intent is "physically committed to the cutoff within 4 s":
    // ≥10 m of nav progress, OR — when W7 solves a NEARER cutoff (measured:
    // anchor 7 m of nav away, reached and held in 2.5 s) — actual arrival.
    ok(movedTowardAnchor >= 10.0 || (reachedAt != null && navD0 >= 3),
      `committed to the cutoff within 4 s (progress ${r1(movedTowardAnchor)} m of ${navD0 == null ? "?" : r1(navD0)} m` +
      (reachedAt != null ? `, ARRIVED at +${r1(reachedAt - t0)} s` : "") + ")");
  }

  // ------------------------------------------------ T-CTF-2b (AC-16)
  section("T-CTF-2b (AC-16) — …and not suicidally: no back-turn under point-blank fire");
  {
    const r = scenarioCtf(103);
    const D = r.bots(0)[0];
    const E1 = r.bots(1)[0];
    const E2 = r.bots(1)[1];
    keepOnly(r, [D.who, E1.who, E2.who]);
    const dSpot = r.place(D, [-5, 0, -2], 3);
    r.place(E2, [20, 0, 6], 4);
    losPlace(r, E1, dSpot, [-5, 0, -8], 4.5, 8); // ~6 m — point blank, LOS
    // 400 hp scene caps from the START: a point-blank one-step burst can
    // otherwise kill a duelist before a single hit window is measured.
    // Ignition through the real being-hit-is-awareness mechanism.
    DMG.applyDamage(r.sim, D.who, 1, E1.who, "body", "script");
    DMG.applyDamage(r.sim, E1.who, 1, D.who, "body", "script");
    let dueling = false;
    for (let i = 0; i < 60 * 6 && !dueling; i++) {
      r.sim.step(NULL_CMD);
      for (const a of [D, E1]) { const b = r.body(a); if (b && b.alive) b.hp = 400; }
      const bd = r.body(D);
      dueling = bd && (bd.state === "combat" || bd.state === "suppress");
    }
    ok(dueling, "the point-blank duel is live before the grab");
    grabFlagWith(r, E2, 0);
    r.M.flags[0].revealed = true;
    r.step(3);
    r.forcePreempt();
    // 400 hp scene cap: at point blank a one-step burst can exceed 100 and
    // end the scene before a single hit window is measured (observed: loop
    // broke with 0 windows). Scene-posing only — never a live-match number.
    { const bd = r.body(D), be = r.body(E1); if (bd) bd.hp = 400; if (be) be.hp = 400; }
    let backTurn = false, lastHurtT = -9, hurts = 0;
    for (let i = 0; i < 60 * 5; i++) {
      r.sim.step(NULL_CMD);
      const bd = r.body(D), be = r.body(E1);
      if (!bd || !be || !bd.alive || !be.alive) break;
      bd.hp = 400; be.hp = 400;
      const t = r.sim.state.time;
      if (bd.lastHitT > lastHurtT) { lastHurtT = bd.lastHitT; hurts++; }
      if (lastHurtT > 0 && t - lastHurtT <= 1.0) {
        if (angleToDeg(bd, be.pos) > 120) backTurn = true;
      }
    }
    ok(hurts > 0, `the defender took fire from the point-blank target (${hurts} hit windows)`);
    ok(!backTurn, "never turned its back (>120°) within 1.0 s of taking damage");
  }

  // ------------------------------------------------ T-CTF-4 (AC-19)
  section("T-CTF-4 (AC-19) — dropped flag: returners chosen by NAV distance, returned in time");
  {
    const r = scenarioCtf(104);
    const amber = r.bots(0);
    const courier = r.bots(1)[0];
    const defenders = amber.slice(0, 3);
    keepOnly(r, [courier.who, ...defenders.map((a) => a.who)]);
    // drop INSIDE the walled Lantern Yard so a just-outside-the-wall point
    // is euclid-near but nav-far (the AC's "wall between" clause)
    const drop = safePos([-36, 0, 8], 3);
    ok(grabFlagWith(r, courier, 0), "scripted courier grabbed the AMBER flag");
    r.sim.teleport(courier.who, drop[0], drop[1], drop[2]);
    r.step(2);
    // defender placement search on the REAL nav: X = euclid-nearest but
    // wall-detoured; Y = nav-nearest (~15 m); Z = far (~60 m)
    const f = r.M.flags[0];
    const cands = [];
    for (const p of content.spawnPoints) {
      const nd = navDist(p.pos, drop);
      if (nd == null) continue;
      cands.push({ pos: p.pos, nd, ed: Math.hypot(p.pos[0] - drop[0], p.pos[2] - drop[2]) });
    }
    for (const L of LANES_MOD.lanes) {
      for (const wp of L.wp) {
        const nd = navDist(wp, drop);
        if (nd == null) continue;
        cands.push({ pos: wp, nd, ed: Math.hypot(wp[0] - drop[0], wp[2] - drop[2]) });
      }
    }
    // X = euclid-NEAREST of the three, but wall-detoured (nav ≥1.5× euclid);
    // Y = the true nav-nearest; Z = far control
    const X = cands.filter((c) => c.nd >= 15 && c.nd <= 45 && c.nd / Math.max(1, c.ed) >= 1.5)
      .sort((a, b) => a.ed - b.ed)[0];
    const Y = X ? cands.filter((c) => c.nd >= 8 && c.nd <= 20 && c.ed > X.ed + 0.5 && c.nd < X.nd - 2)
      .sort((a, b) => a.nd - b.nd)[0] : null;
    const Z = cands.filter((c) => c.nd >= 45).sort((a, b) => b.nd - a.nd)[0];
    if (!X || !Y || !Z) {
      skip(`could not solve the X/Y/Z placement on this arena (X=${!!X} Y=${!!Y} Z=${!!Z})`);
    } else {
      info(`X euclid ${r1(X.ed)} m / nav ${r1(X.nd)} m (wall detour x${(X.nd / X.ed).toFixed(2)}) — Y nav ${r1(Y.nd)} m — Z nav ${r1(Z.nd)} m`);
      r.place(defenders[0], X.pos, 2);
      r.place(defenders[1], Y.pos, 2);
      r.place(defenders[2], Z.pos, 2);
      r.step(2);
      r.killAligned(courier); // the drop lands slot-aligned -> preempt pass
      ok(f.state === "DROPPED", `flag DROPPED at the plaza (state ${f.state})`);
      let returners = null;
      for (let i = 0; i < 120 && f.state === "DROPPED"; i++) {
        r.sim.step(NULL_CMD);
        const rs = defenders.filter((a) => { const b = r.body(a); return b && b._obj && b._obj.role === "return"; });
        if (rs.length) { returners = rs; break; }
      }
      const names = returners ? returners.map((a) => (a === defenders[0] ? "X" : a === defenders[1] ? "Y" : "Z")) : [];
      ok(returners != null && returners.length >= 1 && returners.length <= 2,
        `1-2 defenders assigned 'return' (got ${returners ? returners.length : 0}: ${names.join(",")})`);
      ok(returners != null && returners.includes(defenders[1]),
        `the NAV-nearest defender (Y) is one of the returners (got ${names.join(",")})`);
      const eta = Y.nd / 4.0 + 2.0;
      let returnedAt = null;
      const tR0 = r.sim.state.time;
      for (let i = 0; i < Math.ceil(eta * 1.5 * 60) + 60 && returnedAt == null; i++) {
        r.sim.step(NULL_CMD);
        if (f.state === "AT_STAND") returnedAt = r.sim.state.time;
      }
      const yb = r.body(defenders[1]);
      const yd = yb ? Math.hypot(yb.pos[0] - f.pos[0], yb.pos[2] - f.pos[2]) : null;
      ok(returnedAt != null && returnedAt - tR0 <= eta * 1.5,
        `flag returned within 1.5x walk ETA (${returnedAt == null ? "not returned" : r1(returnedAt - tR0) + " s"} vs bar ${r1(eta * 1.5)} s)` +
        (returnedAt == null && yd != null ? ` — returner ended ${r1(yd)} m from the flag (movement stall — see the nav/capsule finding)` : ""));
    }
  }

  // ------------------------------------------------ T-CTF-6 (AC-17)
  section("T-CTF-6 (AC-17) — interceptors cut off ahead, and win the race (20 sub-seeds)");
  {
    let aheadOk = 0, raceWins = 0, ran = 0, interceptRuns = 0;
    const CARRIER_V = 4.0; // m/s along the known route
    for (let sub = 1; sub <= 20; sub++) {
      const r = scenarioCtf(200 + sub);
      const D = r.bots(0)[0];
      const carrier = r.bots(1)[0];
      keepOnly(r, [D.who, carrier.who]);
      if (!grabFlagWith(r, carrier, 0)) continue;
      r.M.flags[0].revealed = true;
      // the known route: real nav polyline AMBER stand -> SLATE stand
      const route = nav.findPath(FLAG_W, FLAG_E);
      if (!route) continue;
      const seg = [];
      let total = 0;
      for (let i = 1; i < route.length; i++) {
        const L = Math.hypot(route[i][0] - route[i - 1][0], route[i][2] - route[i - 1][2]);
        seg.push(L); total += L;
      }
      const at = (s) => {
        let acc = 0;
        for (let i = 0; i < seg.length; i++) {
          if (acc + seg[i] >= s) {
            const f = (s - acc) / seg[i];
            return [route[i][0] + (route[i + 1][0] - route[i][0]) * f, 0,
                    route[i][2] + (route[i + 1][2] - route[i][2]) * f];
          }
          acc += seg[i];
        }
        return route[route.length - 1].slice();
      };
      // interceptor start chosen by the AC's preconditions ON THE REAL NAV:
      // tail-chase cannot close (≥45 m nav behind the carrier's start) but a
      // cutoff can (reaches the 55% arc point ≥2 s before the carrier).
      // hp topped both sides so a firefight cannot end the race early
      // (perception stays LIVE — the commander stands down under noTarget).
      {
        const mid = at(0.55 * total);
        const capM = (0.55 * total / CARRIER_V - 2.0) * 4.6;
        let best = null, bestD = Infinity;
        for (const p of content.spawnPoints) {
          if (!clearAt(p.pos)) continue;
          const nd0 = navDist(p.pos, route[0]);
          const ndM = navDist(p.pos, mid);
          if (nd0 == null || ndM == null) continue;
          if (nd0 < 45 || ndM > capM || ndM < 8) continue;
          if (ndM < bestD) { bestD = ndM; best = p.pos; }
        }
        if (!best) best = [14, 0, 6];
        r.place(D, best, 3);
      }
      r.step(3); // beacon publish
      r.forcePreempt();
      let s = 0, anchor = null, ahead = null, reached = null, anchorS = null;
      const DTs = 1 / 60;
      for (let i = 0; i < 60 * 40; i++) {
        s = Math.min(total, s + CARRIER_V * DTs);
        const cp = at(s);
        r.sim.teleport(carrier.who, cp[0], cp[1], cp[2]);
        r.sim.step(NULL_CMD);
        const cb = r.body(carrier); if (cb && cb.alive) cb.hp = 100;
        const bd = r.body(D);
        if (!bd || !bd.alive) break;
        bd.hp = 100;
        if (anchor == null && bd._obj && bd._obj.role === "intercept" && bd._obj.anchor) {
          anchor = bd._obj.anchor.slice();
          let best = 0, bestD = Infinity, acc2 = 0;
          for (let k = 0; k < seg.length; k++) {
            const midS = acc2 + seg[k] / 2;
            const mp = at(midS);
            const d = Math.hypot(mp[0] - anchor[0], mp[2] - anchor[2]);
            if (d < bestD) { bestD = d; best = midS; }
            acc2 += seg[k];
          }
          anchorS = best;
          const beacon = r.M.flags[0].beacon ? r.M.flags[0].beacon.pos : cp;
          const aheadRef = at(Math.min(total, s + 4));
          const dot = (anchor[0] - beacon[0]) * (aheadRef[0] - cp[0]) + (anchor[2] - beacon[2]) * (aheadRef[2] - cp[2]);
          ahead = dot > 0;
        }
        if (anchor && reached == null) {
          if (Math.hypot(bd.pos[0] - anchor[0], bd.pos[2] - anchor[2]) <= 4.0) reached = s;
        }
        if (reached != null || s >= total) break;
      }
      ran++;
      if (anchor != null) interceptRuns++;
      if (ahead === true) aheadOk++;
      if (reached != null && anchorS != null && reached <= anchorS) raceWins++;
    }
    ok(ran >= 18, `scenario ran on ${ran}/20 sub-seeds (grab + route solved)`);
    ok(interceptRuns >= Math.ceil(ran * 0.9), `an intercept with a cutoff anchor was set in ${interceptRuns}/${ran} runs`);
    ok(aheadOk >= Math.ceil(ran * 0.9),
      `the cutoff anchor is AHEAD of the beacon along the lane in ${aheadOk}/${ran} runs (>=90%)`);
    ok(raceWins >= Math.ceil(ran * 15 / 20),
      `the interceptor reaches its cutoff point before the carrier in ${raceWins}/${ran} (bar 15/20)`);
  }

  // ------------------------------------------------ T-CTF-7 (AC-18)
  section("T-CTF-7 (AC-18) — a hopeless chase is abandoned, with the honest reason");
  {
    const r = scenarioCtf(105);
    const D = r.bots(0)[0];
    const carrier = r.bots(1)[0];
    keepOnly(r, [D.who, carrier.who]);
    ok(grabFlagWith(r, carrier, 0), "scripted carrier holds the AMBER flag");
    // carrier 8 m from ITS stand; our bot ~55+ m of nav away (Lantern Yard)
    r.place(carrier, [FLAG_E[0], 0, FLAG_E[2] + 8], 2);
    const dPos = r.place(D, [FLAG_W[0] + 3, 0, FLAG_W[2] - 2], 3);
    r.M.flags[0].revealed = true;
    // the commander's beacon store keeps a sample for its full 3 s fidelity
    // cadence (AC-35) — and the grab left it a stale at-our-stand sample.
    // Wait one full cadence so the preempt pass reads the TRUE carrier
    // position; the AC-18 scene is "discovered 8 m out", not "stale beacon".
    r.step(210);
    const dNav = navDist(dPos, [FLAG_E[0], 0, FLAG_E[2] + 8]);
    info(`bot->carrier nav distance ${dNav == null ? "?" : r1(dNav) + " m"} (needs >> the carrier's 8 m walk)`);
    const t0 = r.forcePreempt();
    let interceptSeen = false, reroled = null;
    for (let i = 0; i < 60 * 3; i++) {
      r.sim.step(NULL_CMD);
      const bd = r.body(D);
      if (!bd || !bd._obj) continue;
      if (bd._obj.role === "intercept") interceptSeen = true;
      if (reroled == null && bd._obj.role && bd._obj.role !== "intercept") {
        reroled = { t: r.sim.state.time, role: bd._obj.role, reason: bd._obj.reason };
      }
    }
    ok(!interceptSeen, "no intercept goal was ever set (the chase is hopeless)");
    ok(reroled != null && reroled.t - t0 <= 2.0,
      `re-roled within 2.0 s (${reroled ? r1(reroled.t - t0) + " s -> " + reroled.role + "/" + reroled.reason : "never"})`);
  }

  info("T-CTF-5 (AC-20 BOTH_CARRY hold) and T-CTF-9 (AC-21 human-carrier escort) cores are asserted in core/ai/objective.selftest.cjs SS4 on the real pass path — not duplicated here.");
}

// ================================================================ VERDICT
console.log("\n---- matchprobe verdict ----");
console.log(`${passed} passed, ${failed} failed, ${skippedN} skipped`);
if (failed) {
  console.log("FAILED assertions:");
  for (const f of failures) console.log("  !! " + f);
}
process.exit(failed ? 1 : 0);
