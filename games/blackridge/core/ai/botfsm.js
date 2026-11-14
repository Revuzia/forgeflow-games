// core/ai/botfsm.js [A5] — FSM brain, aiStep(sim, nav, squad, dt) entry,
// called inside sim.step slot 3 (architecture §3.9). THREE-free,
// deterministic (every roll from sim.rng.ai). Frozen state strings carry
// combat_spec semantics per R17: patrol | suspicious(=INVESTIGATE) |
// alert(=post-search heightened patrol, detectRange ×1.2 for 60 s) |
// combat | flank | suppress | retreat | dead.
//
// Fairness invariants (ai.selftest.cjs asserts, combat_spec §5.5–§5.7):
//  - reaction rolled ONCE at awareness 1.0, latched; re-rolled only after
//    the target is lost ≥2 s and re-confirmed. ZERO shots pre-reaction.
//  - Gaussian per-SHOT jitter σ per band (multipliers: acquire ×3→×1 over
//    0.6 s, target airborne/sliding ×1.5, bot moving ×1.5; flinch §3.4 adds
//    +0.8°/stack to σ while bot.flinchUntil is live — damage.js writes it).
//  - fires only with a squad fire token (≤2) + the mission-wide ≤3-attacker
//    250 ms window (squad.js); tokenless bots suppress / flank / reposition.
//  - muzzle-block raycast: `hard` within 1.4 m of the muzzle (stricter than
//    the 1.2 m spec bound) refuses the pull; friendly capsule on the ray
//    within 15 m holds fire.
//  - burst budget counts BLOWS (mag decrements), never ticks; per-archetype
//    round counts; band pause rolled per burst.
//
// Brains think ≤4/tick (0.15 s near / 0.4 s far cadence, round-robin);
// every bot ACTS every tick on latched intent. Bots go DORMANT outside
// mission phases (menu/won/lost) so A1's headless weapon probes — which run
// at phase 'menu' — see exactly the stub behaviour they were written
// against; scenarios/missions run at infil/assault/exfil where brains live.

import { perceive, enemyBodiesOf } from "./perception.js";
import { spawnGrenade, GRENADE } from "../sim/grenades.js";
import { objectiveStep } from "./objective.js"; // W7 slot 3a (bot_ai §2.4)
import * as STEER from "./steer.js";               // BOT-AI PASS: planning + path following
import { tierOf, owns } from "../sim/loadout.js";    // BOT-AI PASS: weapon tiers for swap / loot decisions

const DEG = Math.PI / 180;

// §5.5 difficulty bands (R30 authored mix — bands change ONLY perception/
// reaction/accuracy/aggression, never HP or damage).
//
// BOT-AI PASS (2026-10): a band is now a full SKILL PROFILE, not three numbers.
// The UI levels (CASUAL / STANDARD / HARD) pick a MIX of bands per team in
// match/roster.js and mission.js and may shift it (content.json
// difficulty.<level>.ai, see aiCfg below); everything a band changes is
// perception, reaction, aim error or tactics. NOTHING here touches HP, damage,
// ammo, speed or sight lines (monotonic fairness rule, bot_ai.md §2.2).
//
// Knob reference (all per band; "x" = multiplier, 1 = unchanged behaviour):
//   REACTION / AIM (fairness-audited by ai.selftest)
//     reactMin/Max  latched reaction roll in s (rolled ONCE per confirm)
//     jitter        per-shot gaussian aim sigma, rad
//     missRounds, missMin/Max   forced early misses after a confirm (rounds, deg)
//     pauseMin/Max  pause between bursts, s
//     aimHigh       chance a confirm rolls headshot intent
//     leadErr       max +-fraction error on velocity lead (rolled per confirm)
//     turnRate      combat turn cap, rad/s (aim catch-up speed)
//     acquire       sigma multiplier at the moment of a confirm, easing to 1 over
//                   0.6 s (doctrine: 3). A better shooter settles faster.
//     thinkS        brain cadence (s) against an enemy inside 25 m (0.15 default;
//                   a sharper player re-reads the situation sooner)
//     strafeReact   false = no side-stepping inside the reaction window: stand,
//                   take the first burst, THEN move (first-shot discipline)
//     holdWhenSeen  true = an enemy in view inside 45 m stops the walk to a far
//                   goal and is fought where the bot stands; default keeps the
//                   legacy "walk on, gun up, until within 14 m of the goal"
//     fireSpeed     bot may pull the trigger only below this horizontal speed
//                   (m/s). 0.75 = stop-and-shoot; higher = fires on the strafe
//                   (the sigma x1.5 moving penalty and the shared spread model
//                   still apply, so it is accurate only if it is also slow)
//   PERCEPTION
//     notice        awareness fill-rate x          memory   awareness decay x
//     hearMult      hearing radius x               hearFuzz heard-position fuzz x
//     loseS         seconds without sight before 'combat' is dropped for
//                   'suspicious' (0 = never; the referee still ends fights)
//   TACTICS
//     strafeP       chance a confirm rolls a strafe habit (side-steps in the
//                   pauses between bursts, never while a burst is firing)
//     peek          0..1 propensity to side-peek from cover (hide / lean out /
//                   fire / hide) instead of standing in it
//     coverRescoreS cover re-evaluation period    coverNoise random cover-score
//                   error (bad judgement) — sigma in score points
//     reloadBreak   chance to step to lateral cover for a reload (else reloads
//                   in the open)
//     flankP/flankEvery   token-less flank roll chance / cooldown s
//     grenStaticS/grenP/grenCdS   target-static seconds needed, chance to commit,
//                   squad cooldown s for a frag
//     retreatHp/retreatP   retreat threshold hp and roll chance
//     pushReload    chance to close on a target seen reloading
//     huntAfterS    seconds after losing sight before advancing on the last
//                   known position (0 = hold and wait)
//     exposureAvoid path-cost weight for cells in view of a known threat
//     lookCorners   0..1 pre-aim: face the far side of an upcoming corner
//     swapSmart     chance to use the right gun for the range (shotgun inside
//                   8 m, pistol when the primary is dry) instead of reloading
//     lootRange     m a bot will detour to a rack / drop when under-armed
//     loudP         chance a routeless wander leg is SPRINTED (loud, readable)
//     laneNoise     per-bot route jitter (lane diversity)
export const BANDS = {
  recruit: {
    reactMin: 0.800, reactMax: 1.100, jitter: 0.038, missRounds: 3, missMin: 2.0, missMax: 3.0,
    pauseMin: 1.0, pauseMax: 1.6, aimHigh: 0, leadErr: 0.60, turnRate: 4.0, fireSpeed: 0.75,
    notice: 0.55, memory: 2.0, hearMult: 0.6, hearFuzz: 1.6, loseS: 7,
    strafeP: 0, peek: 0, coverRescoreS: 14, coverNoise: 2.5, reloadBreak: 0,
    flankP: 0.08, flankEvery: 20, grenStaticS: 14, grenP: 0.12, grenCdS: 45,
    retreatHp: 22, retreatP: 0.3, pushReload: 0, huntAfterS: 0, exposureAvoid: 0,
    lookCorners: 0, swapSmart: 0, lootRange: 10, loudP: 0.45, laneNoise: 0.10,
  },
  regular: {
    reactMin: 0.500, reactMax: 0.700, jitter: 0.022, missRounds: 2, missMin: 1.5, missMax: 2.2,
    pauseMin: 0.6, pauseMax: 1.0, aimHigh: 0, leadErr: 0.30, turnRate: 7.0, fireSpeed: 0.75,
    notice: 1.0, memory: 1.0, hearMult: 1.0, hearFuzz: 1.0, loseS: 0,
    strafeP: 0.25, peek: 0.5, coverRescoreS: 6, coverNoise: 0.6, reloadBreak: 0.65,
    flankP: 0.5, flankEvery: 8, grenStaticS: 6, grenP: 1, grenCdS: 20,
    retreatHp: 35, retreatP: 0.6, pushReload: 0.2, huntAfterS: 12, exposureAvoid: 0.35,
    lookCorners: 0, swapSmart: 0.7, lootRange: 25, loudP: 0.1, laneNoise: 0.10,
  },
  hardened: {
    reactMin: 0.300, reactMax: 0.420, jitter: 0.016, missRounds: 1, missMin: 1.0, missMax: 1.5,
    pauseMin: 0.45, pauseMax: 0.8, aimHigh: 0.12, leadErr: 0.20, turnRate: 9.4, fireSpeed: 1.4,
    notice: 1.2, memory: 0.7, hearMult: 1.2, hearFuzz: 0.8, loseS: 0,
    strafeP: 0.7, peek: 1, coverRescoreS: 5, coverNoise: 0.2, reloadBreak: 1,
    flankP: 0.6, flankEvery: 6, grenStaticS: 3.5, grenP: 1, grenCdS: 14,
    retreatHp: 40, retreatP: 0.8, pushReload: 0.7, huntAfterS: 5, exposureAvoid: 0.9,
    lookCorners: 0.7, swapSmart: 1, lootRange: 30, loudP: 0, laneNoise: 0.10,
  },
  veteran: {
    reactMin: 0.200, reactMax: 0.300, jitter: 0.012, missRounds: 0, missMin: 0, missMax: 0,
    pauseMin: 0.35, pauseMax: 0.6, aimHigh: 0.20, leadErr: 0.12, turnRate: 12.0, fireSpeed: 2.4,
    notice: 1.4, memory: 0.5, hearMult: 1.35, hearFuzz: 0.6, loseS: 0,
    strafeP: 1, peek: 1, coverRescoreS: 4, coverNoise: 0, reloadBreak: 1,
    flankP: 0.8, flankEvery: 4, grenStaticS: 2, grenP: 1, grenCdS: 10,
    retreatHp: 45, retreatP: 0.9, pushReload: 1, huntAfterS: 2.5, exposureAvoid: 1.4,
    lookCorners: 1, swapSmart: 1, lootRange: 35, loudP: 0, laneNoise: 0.10,
  },
};
export const BAND_LADDER = ["recruit", "regular", "hardened", "veteran"];
for (const k of BAND_LADDER) {
  const b = BANDS[k];
  if (b.acquire == null) b.acquire = 3;
  if (b.thinkS == null) b.thinkS = 0.15;
  if (b.strafeReact == null) b.strafeReact = true;
  if (b.holdWhenSeen == null) b.holdWhenSeen = false;
}

// Difficulty-level AI config: content.json difficulty.<level>.ai (merged over
// pvp_tuning.DIFFICULTY by resolveDifficulty) reaches the brain through
// sim.mission.diffCfg — null in every headless selftest, so those see the raw
// band table. Fields:
//   enemyBandShift   PVP: shift the band of every bot hostile to the human
//                    along recruit<regular<hardened<veteran (-1 casual, +1 hard)
//   campaignBandShift  campaign: same, on top of mission.js's own bandShift
//   reactScale / jitterScale  global multipliers on reactMin/Max and jitter
//   humanTokens / humanWindow  fire tokens per squad on the human (squad.js,
//                    <= 2) and the attackers allowed in one 250 ms window (<= 3):
//                    one-directional, can only REMOVE shooters
//   bandOverrides    { <band>: { knob: value, ... } } - per-level edits to a band's
//                    profile. PVP's only tier, "expert" (owner 2026-10-12: every
//                    opponent plays like an expert HUMAN), seats everyone at
//                    'veteran' and sharpens it here, so the campaign ladder's own
//                    veterans stay exactly as they were. Same fairness surface:
//                    no knob grants sight, speed, HP, damage or ammo.
function aiCfg(sim) {
  const m = sim.mission;
  const d = m && m.diffCfg;
  return (d && d.ai) || null;
}

// effective skill profile of a bot: the band after the difficulty shift, with
// the level's global scales applied. Computed once per brain (the shift is a
// function of team only, which is fixed for a body's life).
function skillOf(sim, bot) {
  const base = BANDS[bot.band] ? bot.band : "regular";
  const cfg = aiCfg(sim);
  let name = base;
  let reactScale = 1, jitterScale = 1;
  if (cfg) {
    reactScale = cfg.reactScale != null ? cfg.reactScale : 1;
    jitterScale = cfg.jitterScale != null ? cfg.jitterScale : 1;
    const hostile = sim.state.player && bot.team != null && bot.team !== sim.state.player.team;
    const shift = hostile ? (sim.match ? (cfg.enemyBandShift | 0) : (cfg.campaignBandShift | 0)) : 0;
    if (shift) {
      const i = Math.max(0, Math.min(BAND_LADDER.length - 1, BAND_LADDER.indexOf(base) + shift));
      name = BAND_LADDER[i];
    }
  }
  let src = BANDS[name];
  const ov = cfg && cfg.bandOverrides && cfg.bandOverrides[name];
  if (ov) src = Object.assign({}, src, ov);
  if (reactScale === 1 && jitterScale === 1) return Object.assign({ name }, src);
  return Object.assign({ name }, src, {
    reactMin: src.reactMin * reactScale, reactMax: src.reactMax * reactScale, jitter: src.jitter * jitterScale,
  });
}
// the brain caches its skill; re-derive if the body's band was rewritten
// (scenario harnesses retag bands after spawn)
function kOf(sim, bot, brain) {
  if (!brain.k || brain.kSrc !== bot.band) {
    brain.k = skillOf(sim, bot); brain.kSrc = bot.band;
    // the band this bot actually PLAYS at after the difficulty shift (bot.band stays
    // the roster's label); scoreboard/HUD code can show this instead
    bot.bandEff = brain.k.name;
  }
  return brain.k;
}

// §5.7 burst rounds + §5.8 preferred bands — mirrors content.json archetypes
// (sim does not expose content; values are the combat_spec numbers verbatim,
// weapon-class fallback for test spawns).
const BURST_BY_ARCH = { rifleman: [3, 5], cqb: [5, 8], marksman: [1, 1], heavy: [5, 8] };
const BURST_BY_CLASS = { ar: [3, 5], smg: [5, 8], dmr: [1, 1], pistol: [2, 3], shotgun: [1, 1] };
const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const BAND_BY_CLASS = { ar: [15, 35], smg: [8, 18], dmr: [35, 80], pistol: [6, 15], shotgun: [2, 9] };
// the weapon class each archetype is built around. The archetype tables above
// describe THAT gun; when the bot actually holds something else (PVP: every
// body starts on the pistol, then picks racks/drops up) the held weapon's CLASS
// table wins — a rifleman with a Pike must not fight at 15-35 m.
const NATIVE_CLASS = { rifleman: "ar", cqb: "smg", marksman: "dmr", heavy: "ar" };

const FLINCH_SIGMA_PER_STACK = 0.8 * DEG; // §3.4 aim-error injection
const THINK_NEAR_S = 0.15, THINK_FAR_S = 0.4, THINK_NEAR_M = 25;
const MAX_THINKS = 4;

// probe instrumentation (selftest-only; a disabled sink costs one branch)
export const AI_PROBE = { enabled: false, jitter: [] };
export const AI_PERF = { calls: 0, totalMs: 0, avgMs: 0, lastMs: 0 };

const perfNow = () => (globalThis.performance ? performance.now() : Date.now());

// ---------------------------------------------------------------- helpers
function yawTo(from, to) { return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])); }
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function approachYaw(cur, des, maxStep) {
  const d = angDiff(des, cur);
  if (Math.abs(d) <= maxStep) return des;
  return cur + Math.sign(d) * maxStep;
}
function gauss(rng) {
  const u1 = 1 - rng(); // (0,1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function eyeOf(bot) {
  return [bot.pos[0], bot.pos[1] + (bot.stance === "crouch" ? 1.10 : 1.62), bot.pos[2]];
}
function hdist(a, b) { return Math.hypot(a[0] - b[0], a[2] - b[2]); }
function burstRange(bot, weapon) {
  const cls = weapon ? weapon.class : "ar";
  if (BURST_BY_ARCH[bot.archetype] && (!weapon || NATIVE_CLASS[bot.archetype] === cls)) return BURST_BY_ARCH[bot.archetype];
  return BURST_BY_CLASS[cls] || BURST_BY_ARCH[bot.archetype] || [3, 5];
}
function prefBand(bot, weapon, pushOn) {
  const cls = weapon ? weapon.class : "ar";
  const native = BAND_BY_ARCH[bot.archetype] && (!weapon || NATIVE_CLASS[bot.archetype] === cls);
  const b = (native ? BAND_BY_ARCH[bot.archetype] : null) || BAND_BY_CLASS[cls] || BAND_BY_ARCH[bot.archetype] || [15, 35];
  return pushOn ? [b[0] * 0.5, b[1] * 0.5] : b; // §5.3: at 75 s ranges halve
}

// ballistic pitch for the §5.9 frag arc (v0=16, g=−20): lowest solvable arc
export function solveArcPitch(from, to, v) {
  const R = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const dy = to[1] - from[1];
  if (R < 0.5) return null;
  const f = (th) => {
    const ct = Math.cos(th);
    if (ct < 0.05) return -1e9;
    const t = R / (v * ct);
    return v * Math.sin(th) * t - 10 * t * t - dy;
  };
  let lo = 0.06, hi = -1;
  for (let th = 0.06; th <= 1.25; th += 0.05) {
    if (f(th) >= 0) { hi = th; break; }
    lo = th;
  }
  if (hi < 0) return null; // out of throwing range
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) hi = mid; else lo = mid;
  }
  return hi;
}

function mkBrain(bot, t) {
  return {
    lastThinkT: -9, enteredT: t, anchor: bot.pos.slice(), anchorYaw: bot.yaw,
    curYaw: bot.yaw,
    // confirm / reaction (roll-once-and-latch, §5.6)
    confirmT: -1, reactionS: 0, confirmed: false, rerollArmed: true,
    reactionLog: [],
    // aim state
    jitterY: 0, jitterP: 0, lastSigma: 0, leadErr: 0, aimHigh: false,
    missLeft: 0, missOff: 0, missSign: 1,
    // burst (blow-counted)
    burstSize: 0, burstLeft: 0, pauseUntil: -9, prevMag: -1, burstLog: [],
    // movement
    mvActive: false, mvx: 0, mvz: 0, moveYaw: null, // steer.js world-space heading
    nudgeUntil: -9, nudgeX: 0, nudgeZ: 0, avoid: null, avoidUntil: -9, progA: null,
    goalUnreach: -9, orbitN: 0,
    goal: null, path: null, pathI: 0, needRepath: false, stuckT: 0,
    stuckN: 0, detourUntil: -9, wpKey: -1, wpMinD: Infinity, goalKey: null, goalMinD: Infinity,
    sprintMove: false, arrived: true,
    // patrol / investigate
    patrolI: 0, waitUntil: -9, scanYaw: 0, scanDir: 1, idleBarkAt: t + 25,
    investT: { until: -9, sweepUntil: -9, nextSampleT: -9, sprint: false, target: null },
    alertUntil: bot.state === "alert" ? t + 60 : -9,
    // cover / peek
    coverIdx: -1, coverScoreAt: -9, hpAtCover: 100,
    peekPhase: "expose", peekUntil: -9, peekSide: 1,
    // retreat
    retreatRolled: false, retreatGo: false, retreatIdleFrom: -9,
    // grenade
    gPlanned: false, gReleaseT: -9, gPitch: 0, gTarget: null,
    // referee hooks (squad.js writes)
    forceFlank: false, forceDisengage: false,
    flankUntil: -9, flankSide: null,
    // W3: per-target reaction latches (roll-once-and-latch lives INSIDE the
    // per-target record — re-acquiring an old target buys no fresh roll,
    // switching cancels none; plan R1). curTgtWho tracks whose latch is
    // currently mirrored into the brain.* fields below.
    tgt: {}, curTgtWho: null,
    // W3: objective hooks (H2 task lock, H4 patrol floor)
    taskLockUntil: -9, breakAckT: -1, wanderAt: -9, floorAnchor: null,
    // misc
    lowHpBarked: false, prevWeaponState: "idle", reloadDest: null,
    prevReloadCmd: false, semiToggle: false, supOffSign: 1,
    flankThinkAt: -9, wasFiring: false,
    // BOT-AI PASS: skill profile cache + new behaviour state
    k: null, kSrc: null,
    strafeOn: false, strafeDir: 1, strafeUntil: -9, strafeHome: null,
    pk: { ph: "hide", until: -9, side: 1, home: null, spot: null, on: null, coverIdx: -2 },
    lootUntil: -9, lootId: -1, lootCheckT: -9, lootFrom: null,
    pushUntil: -9, reloadSeenT: -9, huntOn: false, grenBlockUntil: -9, coverHopUntil: -9, coverHopNextT: -9,
    swapT: -9, smartSwap: null, wantSwap: null, idleSinceT: -9, nudgeCheckT: -9,
  };
}

// W3: the body of the bot's CURRENT percept target ('P' → the player).
// Live reads of this body happen ONLY where the target is visibleFresh —
// everywhere else the code goes through lastKnown / the blackboard.
function targetBodyOf(sim, bot) {
  const P = bot.percept;
  if (!P || P.target == null) return null;
  const tb = P.targetBody;
  return tb && tb.alive ? tb : null;
}

// W3 Part 12.6: think cadence keys to the NEAREST ENEMY ACTOR, not the
// player — in a 10-actor match every bot on the far side of the map must
// not think at the near rate just because the human happens to be close.
function nearestEnemyDist(sim, bot) {
  const list = enemyBodiesOf(sim, bot);
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || !b.alive) continue;
    const d = hdist(bot.pos, b.pos);
    if (d < best) best = d;
  }
  return best;
}

// W3: per-target latch swap. The brain.* confirm/roll fields always mirror
// the CURRENT target's latch; swapping targets saves the old latch and
// loads (or creates) the new one. A latched in-flight reaction on the old
// target survives untouched for its next re-acquire.
const LATCH_FIELDS = ["confirmT", "reactionS", "confirmed", "rerollArmed",
  "missLeft", "missOff", "missSign", "aimHigh", "leadErr", "strafeOn"];
function swapLatch(brain, who, t, P) {
  if (brain.curTgtWho === who) return;
  if (brain.curTgtWho != null) {
    let old = brain.tgt[brain.curTgtWho];
    if (!old) old = brain.tgt[brain.curTgtWho] = {};
    for (const f of LATCH_FIELDS) old[f] = brain[f];
  }
  brain.curTgtWho = who;
  const tl = who != null ? brain.tgt[who] : null;
  if (tl) {
    for (const f of LATCH_FIELDS) brain[f] = tl[f];
    // lazy re-arm: if this target was lost ≥2 s while we were away, the
    // next confirm re-rolls (same rule as the live path, evaluated on load)
    const rec = P && P.byTarget ? P.byTarget[who] : null;
    if (brain.confirmed && rec && t - rec.lastSeenT > 2.0) {
      brain.confirmed = false;
      brain.rerollArmed = true; // lost ≥2 s while unfocused → next confirm re-rolls
    }
  } else {
    brain.confirmT = -1; brain.reactionS = 0; brain.confirmed = false;
    brain.rerollArmed = true;
    brain.missLeft = 0; brain.missOff = 0; brain.missSign = 1;
    brain.aimHigh = false; brain.leadErr = 0; brain.strafeOn = false;
  }
}

function setState(sim, bot, brain, next) {
  const prev = bot.state;
  if (prev === next) return;
  bot.state = next;
  brain.enteredT = sim.state.time;
  sim.emit("botstate", { botId: bot.id, state: next, prev });
}

// ================================================================== aiStep
export function aiStep(sim, nav, squad, dt) {
  if (!sim || !squad || !squad._tick) return;
  const S = sim.state;
  const phase = S.phase;
  // dormant outside mission phases (see header)
  if (phase !== "infil" && phase !== "assault" && phase !== "exfil") return;

  const t0 = perfNow();
  squad._bind(sim);
  STEER.tickHeat(sim, nav); // crowd-heat decay (lane diversity)
  // W7 slot 3a: the commander runs BEFORE squad._tick (bot_ai §2.4). One
  // branch when no match is live; writes bot._obj only — H1–H4 read it.
  objectiveStep(sim, nav, squad, dt);
  squad._tick(sim, dt);

  const t = S.time;
  const bots = S.bots;
  const alive = [];
  for (let i = 0; i < bots.length; i++) if (bots[i].alive) alive.push(bots[i]);
  if (!alive.length) {
    AI_PERF.calls++; AI_PERF.lastMs = perfNow() - t0;
    AI_PERF.totalMs += AI_PERF.lastMs; AI_PERF.avgMs = AI_PERF.totalMs / AI_PERF.calls;
    return;
  }

  // think scheduling: ≤4 brains/tick, round-robin cursor lives on the squad
  if (!squad._ai) squad._ai = { cursor: 0 };
  const cur = squad._ai.cursor % alive.length;
  let thinks = 0;
  for (let k = 0; k < alive.length && thinks < MAX_THINKS; k++) {
    const bot = alive[(cur + k) % alive.length];
    if (bot._scenarioPinned) continue; // v2.2: scenario-posed bots (A11) never
    // waste a think slot — their cmd is pinned and assignments are swallowed.
    if (!bot._brain) bot._brain = mkBrain(bot, t);
    const d = nearestEnemyDist(sim, bot); // W3 Part 12.6 — not S.player
    const interval = d <= THINK_NEAR_M ? (bot._brain.k ? bot._brain.k.thinkS : THINK_NEAR_S) : THINK_FAR_S;
    if (t - bot._brain.lastThinkT >= interval - 1e-9) {
      think(sim, nav, squad, bot, t);
      thinks++;
    }
  }
  squad._ai.cursor = (squad._ai.cursor + 1) % alive.length;

  for (let i = 0; i < alive.length; i++) {
    if (alive[i]._scenarioPinned) continue; // v2.2: posed bots stay posed (A11)
    act(sim, nav, squad, alive[i], dt, t);
  }

  AI_PERF.calls++;
  AI_PERF.lastMs = perfNow() - t0;
  AI_PERF.totalMs += AI_PERF.lastMs;
  AI_PERF.avgMs = AI_PERF.totalMs / AI_PERF.calls;
}

// ================================================================== think
function think(sim, nav, squad, bot, t) {
  const brain = bot._brain;
  const rng = sim.rng.ai;
  const band = kOf(sim, bot, brain);
  const dtT = Math.min(0.5, Math.max(1 / 60, t - Math.max(0, brain.lastThinkT)));
  brain.lastThinkT = t;

  perceive(bot, sim, sim.world, dtT, rng);
  const P = bot.percept;

  // W3: mirror the current target's reaction latch into brain.* (a target
  // switch NEVER re-rolls a latched reaction — the latch travels with the
  // target record, plan R1 / AC-36)
  swapLatch(brain, P.target, t, P);

  // ---- confirm / reconfirm / roll-once-and-latch (§5.6, per target)
  if (P.target != null && P.awareness >= 1 - 1e-9 && !brain.confirmed) {
    brain.confirmed = true;
    if (brain.rerollArmed) {
      brain.rerollArmed = false;
      brain.confirmT = t;
      brain.reactionS = band.reactMin + rng() * (band.reactMax - band.reactMin);
      // per-confirm rolls, all latched:
      brain.missLeft = band.missRounds;
      brain.missOff = (band.missMin + rng() * (band.missMax - band.missMin)) * DEG;
      brain.missSign = rng() < 0.5 ? -1 : 1;
      brain.aimHigh = rng() < band.aimHigh;
      brain.leadErr = (rng() * 2 - 1) * band.leadErr;
      brain.strafeOn = band.strafeP >= 1 ? true : (band.strafeP > 0 && rng() < band.strafeP);
      if (brain.reactionLog.length < 32) brain.reactionLog.push({ confirmT: t, reactionS: brain.reactionS });
      squad.noteConfirm(bot.id, t);
    }
    if (P.lastKnown) squad.noteLastKnown(bot.id, P.lastKnown, t, P.target);
  }
  const hitFreshHere = P.lastHitWho === P.target && t - (bot.lastHitT ?? -9) <= 2.0;
  if (brain.confirmed && t - P.lastSeenT > 2.0 && !hitFreshHere) {
    brain.confirmed = false;
    brain.rerollArmed = true; // next confirm re-rolls (§5.6)
  }
  if (P.seesTarget && P.lastKnown) squad.noteLastKnown(bot.id, P.lastKnown, t, P.target);

  const st = bot.state;
  const confirmedNow = P.awareness >= 1 - 1e-9;

  // ---- global transitions
  if (st === "patrol" || st === "alert" || st === "suspicious") {
    if (confirmedNow) {
      setState(sim, bot, brain, "combat");
      brain.coverScoreAt = -9;
      return planCombat(sim, nav, squad, bot, brain, t, rng);
    }
  }

  switch (st) {
    case "patrol":
    case "alert": {
      if (st === "alert" && t >= brain.alertUntil) setState(sim, bot, brain, "patrol");
      if (P.awareness >= 0.5) {
        const stim = P.lastKnown || P.heardAt;
        if (stim) {
          setState(sim, bot, brain, "suspicious");
          brain.investT = {
            until: t + 14, sweepUntil: -9, nextSampleT: -9,
            sprint: P.heardKind === "gunshot", target: stim.slice(),
          };
          setGoal(nav, sim, brain, bot, brain.investT.target, brain.investT.sprint);
        }
        break;
      }
      // BOT-AI PASS: an under-armed bot detours to a rack / drop (PVP) before
      // resuming its orders; a running detour owns the goal until it ends
      if (considerLoot(sim, nav, squad, bot, brain, band, t)) break;
      // W3 H4: the objective layer's anchor owns the idle anchor outright
      const obj = bot._obj;
      if (obj && obj.anchor) {
        if (!brain.anchor || hdist(brain.anchor, obj.anchor) > 0.5) {
          brain.anchor = obj.anchor.slice();
          brain.floorAnchor = brain.anchor;
          setGoal(nav, sim, brain, bot, brain.anchor, false);
        }
      } else if (!bot.patrol && !brain.floorAnchor) {
        // W3 PATROL FLOOR (plan Part 4.2): with the campaign's authored
        // routes gone and no commander yet, an idle bot needs SOME anchor
        // or it statues in a doorway. Nearest arena node anchor, else stay.
        brain.floorAnchor = nearestNodeAnchor(sim, bot) || bot.pos.slice();
        brain.anchor = brain.floorAnchor;
        brain.wanderAt = t + 4 + rng() * 6;
      }
      // floor wander: routeless idle bots drift around their anchor instead
      // of standing still (goal-following for this lives in act())
      if (!bot.patrol && brain.floorAnchor && brain.arrived && t >= brain.wanderAt) {
        brain.wanderAt = t + 6 + rng() * 6;
        const p2 = nav ? nav.randomPoint(brain.anchor, 12, rng, 2) : null; // minClr 2: not in a doorway
        if (p2) setGoal(nav, sim, brain, bot, p2, band.loudP > 0 && rng() < band.loudP);
      }
      // BOT-AI PASS: an idle bot parked IN a doorway / against a wall (wall-
      // distance class 0) steps to open ground within 3 m after 2.5 s — never
      // for stand / flag / carry anchors (those need the exact spot)
      if (nav && brain.arrived && !bot.patrol) {
        if (brain.idleSinceT < 0) brain.idleSinceT = t;
        const exactSpot = obj && obj.anchor && (obj.priority >= 0.85 || obj.anchorKind === "stand" || obj.anchorKind === "flag" || obj.anchorKind === "cutoff");
        if (!exactSpot && t - brain.idleSinceT > 2.5 && t - brain.nudgeCheckT > 3) {
          brain.nudgeCheckT = t;
          if (nav.clearAt(bot.pos) === 0) {
            const spot = nav.openSpot(bot.pos, 3, 2);
            if (spot) { brain.arrived = false; setGoal(nav, sim, brain, bot, spot, false); brain.idleSinceT = -9; }
          }
        }
      } else brain.idleSinceT = -9;
      if (t >= brain.idleBarkAt && st === "patrol") {
        squad.requestBark(bot.id, "idle");
        brain.idleBarkAt = t + 25 + rng() * 15;
      }
      break;
    }

    case "suspicious": {
      const inv = brain.investT;
      // stimulus may refresh mid-investigation
      if (P.lastHeardT > 0 && t - P.lastHeardT < 0.5 && P.heardAt) {
        inv.target = P.heardAt.slice();
        inv.until = Math.max(inv.until, t + 8);
        setGoal(nav, sim, brain, bot, inv.target, P.heardKind === "gunshot");
      }
      if (brain.arrived && inv.sweepUntil < 0) inv.sweepUntil = t + 6; // cone sweep
      if (inv.sweepUntil > 0 && t > inv.sweepUntil && t >= inv.nextSampleT) {
        // widen 10 m (§5.3)
        inv.nextSampleT = t + 2.5;
        const p2 = nav ? nav.randomPoint(inv.target, 10, rng) : inv.target;
        setGoal(nav, sim, brain, bot, p2, false);
      }
      if (t >= inv.until) {
        setState(sim, bot, brain, "alert"); // detectRange ×1.2 for 60 s (R17)
        brain.alertUntil = t + 60;
        setGoal(nav, sim, brain, bot, brain.anchor, false);
      }
      break;
    }

    case "combat": {
      // a recruit forgets: no sight, no hit and no order for loseS seconds ends
      // the fight (the referee still ends everyone else's)
      const lostFor = t - Math.max(P.lastSeenT, brain.enteredT, bot.lastHitT ?? -9);
      if (band.loseS > 0 && lostFor > band.loseS && !(bot._obj && bot._obj.priority >= 0.9) && !brain.forceFlank) {
        const lk1 = squad.squadLastKnown(bot.id, P.target) || (P.lastKnown ? { pos: P.lastKnown } : null);
        setState(sim, bot, brain, "suspicious");
        brain.investT = { until: t + 8, sweepUntil: -9, nextSampleT: -9, sprint: false, target: lk1 ? lk1.pos.slice() : bot.pos.slice() };
        setGoal(nav, sim, brain, bot, brain.investT.target, false);
        squad.release(bot.id);
        break;
      }
      planCombat(sim, nav, squad, bot, brain, t, rng);
      break;
    }

    case "flank": {
      // committed — no reactive self-cancel (doctrine); arrival/timeout in act
      break;
    }

    case "suppress": {
      if (!squad.holdsSuppress(bot.id)) { setState(sim, bot, brain, "combat"); brain.coverScoreAt = -9; break; }
      if (P.seesTarget && squad.requestToken(bot.id, P.target)) { setState(sim, bot, brain, "combat"); break; }
      const lk = squad.squadLastKnown(bot.id);
      if (!lk || t - lk.t > 8) { setState(sim, bot, brain, "combat"); break; }
      break;
    }

    case "retreat": {
      const squadAlive = countSquadAlive(sim, bot);
      if (bot.hp >= 70 || squadAlive <= 1) {
        setState(sim, bot, brain, "combat");
        brain.coverScoreAt = -9;
        brain.retreatRolled = false;
      }
      break;
    }
  }

  // path upkeep
  if (brain.goal && (brain.needRepath || !brain.path) && !brain.arrived) {
    brain.needRepath = false;
    brain.path = nav ? STEER.planPath(sim, nav, bot, brain, brain.goal, band) : null;
    brain.pathI = brain.path ? 1 : 0;
  }
}

// W3 patrol floor: nearest R24/arena node anchor (sim.colliders.nodes).
// The commander (W7) overrides via bot._obj.anchor; this is only the
// "wave-2 bots must not statue" fallback.
function nearestNodeAnchor(sim, bot) {
  const nodes = sim.colliders && sim.colliders.nodes;
  if (!nodes) return null;
  let best = null, bestD = Infinity;
  for (const k in nodes) {
    const p = nodes[k];
    if (!p || p.length < 3) continue;
    const d = hdist(bot.pos, p);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? best.slice() : null;
}

function countSquadAlive(sim, bot) {
  const k = bot.squadId || "_default";
  let n = 0;
  for (const b of sim.state.bots) if (b.alive && (b.squadId || "_default") === k) n++;
  return n;
}

function setGoal(nav, sim, brain, bot, pos, sprint) {
  if (!pos) return;
  // W3 wedge-escape window: while a stuck detour runs (watchdog below), the
  // objective drive may NOT re-assert its anchor — it used to overwrite the
  // escape goal within one think (H1 re-sets whenever goal drifts >1 m from
  // the anchor), pinning wedged bots against geometry for 100+ s (measured:
  // matchprobe AC-4, every match). A wedged bot cannot execute orders anyway;
  // the window is ≤3.5 s and only ever opens after 1.5 s of zero movement.
  if (brain.detourUntil > sim.state.time) { brain.sprintMove = sprint; return; }
  if (brain.goal && hdist(brain.goal, pos) < 0.8 && !brain.needRepath) { brain.sprintMove = sprint; return; }
  brain.goal = [pos[0], pos[1] != null ? pos[1] : bot.pos[1], pos[2]];
  brain.sprintMove = !!sprint;
  brain.arrived = false;
  brain.path = nav ? STEER.planPath(sim, nav, bot, brain, brain.goal, kOf(sim, bot, brain)) : null;
  brain.pathI = brain.path ? 1 : 0;
  brain.stuckT = 0;
}

// ---- combat planning (think-rate): retreat roll, referee hooks, cover,
// token-less decisions, grenade eligibility.
function planCombat(sim, nav, squad, bot, brain, t, rng) {
  const P = bot.percept;
  const band = kOf(sim, bot, brain);
  const weapon = sim.weapons[bot.weapon.id];
  const pushOn = squad.pushActive();
  const squadAlive = countSquadAlive(sim, bot);
  const lastStand = squadAlive === 1;
  const obj = bot._obj || null;
  const who = P ? P.target : null;

  // W3 H2: objective-ordered break-off (same shape as the referee's hook,
  // placed ABOVE forceDisengage). Release tokens, set the goal, lock the
  // task 3.0 s, STAY in combat — no new FSM state.
  if (obj && obj.breakFight && brain.breakAckT !== (obj.assignedT != null ? obj.assignedT : 0)) {
    brain.breakAckT = obj.assignedT != null ? obj.assignedT : 0;
    squad.release(bot.id);
    if (obj.anchor) setGoal(nav, sim, brain, bot, obj.anchor, true);
    brain.taskLockUntil = t + 3.0;
    return;
  }

  // referee episode close → break to investigate (engagement ends)
  if (brain.forceDisengage) {
    brain.forceDisengage = false;
    const lk0 = squad.squadLastKnown(bot.id, who) || (P.lastKnown ? { pos: P.lastKnown } : null);
    setState(sim, bot, brain, "suspicious");
    brain.investT = { until: t + 14, sweepUntil: -9, nextSampleT: -9, sprint: false, target: lk0 ? lk0.pos.slice() : bot.pos.slice() };
    setGoal(nav, sim, brain, bot, brain.investT.target, false);
    squad.release(bot.id);
    return;
  }

  // §5.3 RETREAT: hp<35 AND squad ≥2 alive AND roll 0.6 once (latched).
  // W3: _obj.noRetreat REMOVES the roll (one-directional — plan C10).
  if (bot.hp < band.retreatHp && !(obj && obj.noRetreat)) {
    if (!brain.retreatRolled) {
      brain.retreatRolled = true;
      brain.retreatGo = !lastStand && rng() < band.retreatP;
    }
    if (brain.retreatGo && !lastStand) {
      const threatRef = P.lastKnown || (squad.squadLastKnown(bot.id, who) || {}).pos || null;
      if (threatRef) {
        setState(sim, bot, brain, "retreat");
        squad.release(bot.id);
        const dest = pickRetreatCover(sim, nav, bot, brain, threatRef, rng);
        setGoal(nav, sim, brain, bot, dest, true);
        brain.retreatIdleFrom = -9;
        return;
      }
    }
  }

  // referee-forced flank (W3: _obj.noFlank removes it)
  if (brain.forceFlank) {
    brain.forceFlank = false;
    if (!(obj && obj.noFlank)) { enterFlank(sim, nav, squad, bot, brain, t, rng); return; }
  }

  const lk = squad.squadLastKnown(bot.id, who);
  const threat = (P.lastKnown && t - P.lastSeenT < 8) ? P.lastKnown : (lk ? lk.pos : P.lastKnown);
  if (!threat) return;

  // W3 H2: while the break-off task lock runs, the goal (the anchor) is
  // held — no cover/token goal churn until the lock expires.
  if (t < brain.taskLockUntil) return;

  // token-less decision: suppress → flank → reposition/hold
  const hasFire = squad.holdsFire(bot.id) || squad.requestToken(bot.id, who);
  if (!hasFire) {
    if (squad.requestSuppress(bot.id)) {
      setState(sim, bot, brain, "suppress");
      return;
    }
    if (t - brain.flankThinkAt > band.flankEvery && !(obj && obj.noFlank)) {
      brain.flankThinkAt = t;
      if (rng() < band.flankP) { enterFlank(sim, nav, squad, bot, brain, t, rng); return; }
    }
  }

  // W3 H1: goal ownership is graded by the objective's priority.
  //   ≥0.75 → the goal IS the objective anchor; cover restricted to the path.
  //   0.40–0.75 → the FSM keeps the goal; cover biased toward the objective.
  //   <0.40 → byte-identical to the pre-PVP FSM.
  const pri = obj ? (obj.priority || 0) : 0;
  const objDrive = pri >= 0.75 && obj.anchor;

  // BOT-AI PASS: opportunism. (1) the target is VISIBLY reloading -> close on
  // it for the reload's length (a person sees the animation; pushReload is the
  // chance this bot acts on it, rolled once per reload). (2) the target has
  // been out of sight for huntAfterS -> advance on the last known position
  // along a path that keeps out of that position's view (exposureAvoid), instead
  // of waiting at a cover node until the referee forces a push.
  const tbody = targetBodyOf(sim, bot);
  const seenNow = !!(P.seesTarget && tbody && t - P.lastSeenT <= 0.4);
  if (seenNow && tbody.weapon && tbody.weapon.state === "reloading" && t - brain.reloadSeenT > 2.5) {
    brain.reloadSeenT = t;
    const dR = hdist(bot.pos, tbody.pos);
    if (band.pushReload > 0 && dR > 5 && dR < 32 && (band.pushReload >= 1 || rng() < band.pushReload) && !objDrive && bot.hp > 45) {
      const f = Math.max(0.35, 1 - 9 / dR); // close to ~9 m, never onto the muzzle
      setGoal(nav, sim, brain, bot, [bot.pos[0] + (tbody.pos[0] - bot.pos[0]) * (1 - f), bot.pos[1], bot.pos[2] + (tbody.pos[2] - bot.pos[2]) * (1 - f)], true);
      brain.pushUntil = t + 2.2;
    }
  }
  const lostS = t - P.lastSeenT;
  brain.huntOn = !!(band.huntAfterS > 0 && !objDrive && !seenNow && P.lastSeenT > -8 && lostS > band.huntAfterS &&
    bot.hp > 55 && t >= brain.taskLockUntil);

  // cover (re)scoring: entry / every 6 s / compromised ≥20 dmg (§5.8)
  const compromised = brain.hpAtCover - bot.hp >= 20;
  if (objDrive) {
    // BOT-AI PASS cover hop: an objective-driven bot used to fight wherever it
    // stood (the goal stays the anchor, cover was only "noted"). When it is
    // shot at / sees the enemy and a node that BLOCKS that enemy's line is
    // within 5 m, it dashes there, fights from it (peek / hold), and resumes
    // the order after coverHopS or once the enemy has been gone for 6 s.
    // Skipped for carriers / grabs (priority >= 0.9) and for bots that keep
    // no cover habit (recruits: peek 0).
    const hopping = t < brain.coverHopUntil;
    if (hopping && (t - P.lastSeenT > 6 || (brain.arrived && t > brain.coverHopUntil - 5.5 && t - P.lastSeenT > 3.5))) brain.coverHopUntil = -9;
    if (!hopping && (!brain.goal || hdist(brain.goal, obj.anchor) > 1.0)) {
      setGoal(nav, sim, brain, bot, obj.anchor, obj.posture === "press" || hdist(bot.pos, obj.anchor) > 12);
    }
    if (brain.coverIdx < 0 || t - brain.coverScoreAt >= band.coverRescoreS || compromised) {
      brain.coverScoreAt = t;
      brain.hpAtCover = bot.hp;
      const pick = pickCover(sim, nav, bot, brain, threat, weapon, pushOn, { pathOnly: true, obj, t, noise: band.coverNoise, rng });
      if (pick) brain.coverIdx = pick.idx; // note the node; the GOAL stays the anchor
    }
    // (objective runners keep the tempo: no dives for attackers / escorts /
    // interceptors / returners / carriers — a duel at their feet is theirs to win)
    const runner = obj && (obj.role === "attack" || obj.role === "escort" || obj.role === "intercept" || obj.role === "return" || obj.role === "carry");
    if (band.peek > 0 && pri < 0.9 && !runner && !hopping && t >= brain.coverHopNextT && seenNow && brain.coverIdx >= 0 && nav) {
      const cv = sim.colliders.cover && sim.colliders.cover[brain.coverIdx];
      const dC = cv ? hdist(bot.pos, cv.pos) : 99;
      if (cv && dC >= 1.0 && dC <= 5.0 && Math.abs(cv.pos[1] - bot.pos[1]) < 1.0) {
        brain.coverHopNextT = t + 6;
        const eye = [cv.pos[0], cv.pos[1] + 1.3, cv.pos[2]];
        if (sim.world.losBlocked(eye, [threat[0], threat[1] + 1.0, threat[2]]) && (band.peek >= 1 || rng() < band.peek)) {
          setGoal(nav, sim, brain, bot, cv.pos, true);
          brain.coverHopUntil = t + 8;
        }
      }
    }
  } else if (pushOn || lastStand || brain.huntOn) {
    // push: close on last-known directly (§5.3 — the engagement ends); a
    // hunter walks (gun up, quieter) and sweeps around the spot once there
    setGoal(nav, sim, brain, bot, threat, !brain.huntOn || lostS > band.huntAfterS + 6);
    if (brain.arrived && t - P.lastSeenT > 3 && nav) {
      const p2 = nav.randomPoint(threat, 8, rng, 1);
      setGoal(nav, sim, brain, bot, p2, !brain.huntOn);
    }
  } else if (brain.coverIdx < 0 || t - brain.coverScoreAt >= band.coverRescoreS || compromised) {
    brain.coverScoreAt = t;
    brain.hpAtCover = bot.hp;
    const pick = pickCover(sim, nav, bot, brain, threat, weapon, pushOn,
      pri >= 0.40 && obj && obj.anchor ? { obj, t, noise: band.coverNoise, rng } : { t, noise: band.coverNoise, rng });
    if (pick) {
      brain.coverIdx = pick.idx;
      setGoal(nav, sim, brain, bot, pick.pos, hdist(bot.pos, pick.pos) > 8);
    } else {
      // no cover data (test worlds): hold the preferred band on the threat
      const band = prefBand(bot, weapon, pushOn);
      const d = hdist(bot.pos, threat);
      if (d > band[1] || d < band[0]) {
        const dir = d > 0.01 ? [(bot.pos[0] - threat[0]) / d, (bot.pos[2] - threat[2]) / d] : [1, 0];
        const want = Math.min(Math.max(d, band[0] + 1), band[1] - 1);
        setGoal(nav, sim, brain, bot, [threat[0] + dir[0] * want, bot.pos[1], threat[2] + dir[1] * want], d > band[1] * 1.5);
      }
    }
  }

  // grenade eligibility (§5.9): fire-token holder, target static ≥6 s,
  // range 8–30, arc solvable, squad 20 s cooldown, ≤1 live mission-wide
  // (no last-seen freshness bound: a ≥6 s static target is BY DEFINITION one
  // the bot has stopped seeing — you grenade the cover they vanished behind).
  // W3: staticness of the HUMAN keeps the live tracker (campaign semantics);
  // a BOT target's staticness comes from its own lastKnown stability — never
  // a live transform. _obj.noGrenade removes eligibility outright.
  let staticFor = 0;
  if (who === "P") staticFor = squad.playerStaticFor(t);
  else if (who != null && P.byTarget && P.byTarget[who]) {
    const rec = P.byTarget[who];
    staticFor = rec.staticRef ? t - rec.staticSinceT : 0;
  }
  if (hasFire && !brain.gPlanned && !(obj && obj.noGrenade) &&
      t >= brain.grenBlockUntil &&
      squad.grenadeReady(bot.id, t) &&
      sim.internal.grenades.length === 0 &&
      staticFor >= band.grenStaticS &&
      (!seenNow || staticFor >= 6) && // a target in plain view is shot, not fragged (the low hardened/veteran
                                      // thresholds mean 'flush it out of cover', i.e. out of sight)
      brain.confirmT >= 0 && t >= brain.confirmT + brain.reactionS) {
    const target = [threat[0], sim.world.sphereGround(threat[0], threat[2]), threat[2]];
    const d = hdist(bot.pos, target);
    if (d >= 8 && d <= 30) {
      const pitch = solveArcPitch(eyeOf(bot), target, GRENADE.BOT_THROW_V);
      if (pitch != null && band.grenP < 1 && rng() >= band.grenP) {
        brain.grenBlockUntil = t + 15; // decided against it (recruits almost never commit)
      } else if (pitch != null) {
        brain.gPlanned = true;
        brain.gReleaseT = t + 1.2; // §5.9 telegraph: bark 1.2 s BEFORE release
        brain.gPitch = pitch;
        brain.gTarget = target;
        squad.requestBark(bot.id, "grenade");
      }
    }
  }
}

function enterFlank(sim, nav, squad, bot, brain, t, rng) {
  // flank geometry is computed against the squad's LAST-KNOWN target pos —
  // never the live transform (the blackboard is the only shared fact, §5.4).
  // W3 Part 12.2 (C10b): the old fallback to sim.state.player.pos fired
  // EXACTLY when the bot had no legitimate knowledge — a wallhack the moment
  // the target is a human. No last-known anywhere → no flank; stay combat.
  const P = bot.percept;
  const lk = squad.squadLastKnown(bot.id, P ? P.target : null);
  const pRef = (lk && lk.pos) || (P && P.lastKnown) || null;
  if (!pRef) return;
  // player-to-squad axis (§5.3): centroid of the bot's squad
  const k = bot.squadId || "_default";
  let cx = 0, cz = 0, n = 0;
  for (const b of sim.state.bots) {
    if (b.alive && (b.squadId || "_default") === k) { cx += b.pos[0]; cz += b.pos[2]; n++; }
  }
  if (!n) { cx = bot.pos[0]; cz = bot.pos[2]; n = 1; }
  const ax = cx / n - pRef[0], az = cz / n - pRef[2];
  const al = Math.hypot(ax, az) || 1;
  const axd = [ax / al, az / al];

  // candidate cover nodes ≥50° (≤110°) off the axis, 8–38 m from the player
  const covers = sim.colliders.cover || [];
  let best = null, bestD = Infinity, bestSide = null;
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    const nx = c.pos[0] - pRef[0], nzz = c.pos[2] - pRef[2];
    const nl = Math.hypot(nx, nzz);
    if (nl < 8 || nl > 38) continue;
    const cosA = (nx * axd[0] + nzz * axd[1]) / nl;
    const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
    if (ang < 50 * DEG || ang > 110 * DEG) continue;
    if (nav && !nav.reachable(bot.pos, c.pos)) continue;
    const d = hdist(bot.pos, c.pos);
    if (d < bestD) {
      bestD = d;
      best = c.pos;
      bestSide = (axd[0] * nzz - axd[1] * nx) > 0 ? "L" : "R";
    }
  }
  if (!best) {
    // fallback: rotate the axis ±(50°–110°) — never a straight-behind sneak
    const sign = rng() < 0.5 ? 1 : -1;
    const a = (50 + rng() * 60) * DEG * sign;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rd = [axd[0] * ca - axd[1] * sa, axd[0] * sa + axd[1] * ca];
    const r = Math.min(Math.max(hdist(bot.pos, pRef), 10), 20);
    let dest = [pRef[0] + rd[0] * r, bot.pos[1], pRef[2] + rd[1] * r];
    if (nav) dest = nav.randomPoint(dest, 4, rng);
    best = dest;
    bestSide = sign > 0 ? "L" : "R";
  }
  if (!squad.claimFlank(bot.id, bestSide)) {
    const other = bestSide === "L" ? "R" : "L";
    if (!squad.claimFlank(bot.id, other)) return; // both sides busy — stay combat
    bestSide = other;
  }
  brain.flankSide = bestSide;
  brain.flankUntil = t + 12; // 12 s cap (§5.3)
  setState(sim, bot, brain, "flank");
  squad.requestBark(bot.id, "flank"); // fairness leak — tells the player
  setGoal(nav, sim, brain, bot, best, true);
}

function pickRetreatCover(sim, nav, bot, brain, threatPos, rng) {
  const covers = sim.colliders.cover || [];
  const dNow = hdist(bot.pos, threatPos);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    const dT = hdist(c.pos, threatPos);
    if (dT < dNow + 4) continue; // rearward only
    const dB = hdist(c.pos, bot.pos);
    if (dB > 40) continue;
    if (nav && !nav.reachable(bot.pos, c.pos)) continue;
    const eye = [c.pos[0], c.pos[1] + 0.8, c.pos[2]];
    const chest = [threatPos[0], threatPos[1] + 1.0, threatPos[2]];
    const blocked = sim.world.losBlocked(eye, chest) ? 2.5 : 0;
    const score = blocked - dB * 0.08;
    if (score > bestScore) { bestScore = score; best = c.pos; }
  }
  if (best) return best;
  // fall straight back
  const d = dNow || 1;
  const dir = [(bot.pos[0] - threatPos[0]) / d, (bot.pos[2] - threatPos[2]) / d];
  let dest = [bot.pos[0] + dir[0] * 10, bot.pos[1], bot.pos[2] + dir[1] * 10];
  if (nav) dest = nav.randomPoint(dest, 4, rng);
  return dest;
}

// §5.8 cover scoring (verbatim terms; flankSafety is a constant +0.8 in v1 —
// flagged in the lane report). W3 (C10b Part 12.1): the ±15° "don't run at
// the barrel" penalty no longer reads the LIVE player yaw through walls —
// it uses the TARGET's yaw AS OF THE LAST SIGHTING (percept rec.tgtYaw),
// anchored at the last-known position, and only when the target has ever
// been sighted. objOpts (W3 H1): {pathOnly} restricts candidates to ≤6 m of
// the current path leg; {obj} biases +2.5 × inObjectiveBand(node).
function distToSeg(p, a, b) {
  const ax = a[0], az = a[2], bx = b[0], bz = b[2];
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let u = L2 > 1e-9 ? ((p[0] - ax) * dx + (p[2] - az) * dz) / L2 : 0;
  u = Math.min(1, Math.max(0, u));
  return Math.hypot(p[0] - (ax + dx * u), p[2] - (az + dz * u));
}
function pickCover(sim, nav, bot, brain, threatPos, weapon, pushOn, objOpts) {
  const covers = sim.colliders.cover || [];
  if (!covers.length) return null;
  const band = prefBand(bot, weapon, pushOn);
  const chest = [threatPos[0], threatPos[1] + 1.0, threatPos[2]];
  // target aim direction (±15° cone penalty) — frozen at the last sighting
  const P = bot.percept;
  const rec = P && P.target != null && P.byTarget ? P.byTarget[P.target] : null;
  const aimYaw = rec && rec.lastSeenT > -9 ? rec.tgtYaw : null;
  const obj = objOpts && objOpts.obj ? objOpts.obj : null;
  const pathOnly = !!(objOpts && objOpts.pathOnly);
  let legA = null, legB = null;
  if (pathOnly) {
    if (brain.path && brain.path.length >= 2) {
      const i1 = Math.min(brain.pathI, brain.path.length - 1);
      legA = i1 > 0 ? brain.path[i1 - 1] : bot.pos;
      legB = brain.path[i1];
    } else if (obj && obj.anchor) {
      legA = bot.pos; legB = obj.anchor;
    }
  }
  const scored = [];
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    const dBot = hdist(c.pos, bot.pos);
    if (dBot > 45) continue;
    if (legA && distToSeg(c.pos, legA, legB) > 6) continue; // H1: stay on the path
    const dThreat = hdist(c.pos, threatPos);
    if (dThreat < 2 || dThreat > band[1] * 1.6 + 10) continue;
    let s = 0;
    const eye = [c.pos[0], c.pos[1] + 0.8, c.pos[2]];
    if (sim.world.losBlocked(eye, chest)) s += 3.0;                      // blocksLOS
    if (dThreat >= band[0] && dThreat <= band[1]) s += 1.5;              // preferred band
    s += 1.0 / (1 + 0.15 * dBot);                                        // proximity
    s += 0.8;                                                            // flankSafety (single threat)
    if (obj && obj.anchor && hdist(c.pos, obj.anchor) <= 12) s += 2.5;   // H1: inObjectiveBand
    // claimed / min spacing 4 m — derived from other bots' claims+positions
    for (const ob of sim.state.bots) {
      if (!ob.alive || ob.id === bot.id) continue;
      const claimedHere = ob._brain && ob._brain.coverIdx === i;
      if (claimedHere || hdist(ob.pos, c.pos) < 4) { s -= 2.0; break; }
    }
    // inside the target's LAST-SIGHTED aim cone ±15°, from its last-known
    if (aimYaw != null) {
      const toNode = Math.atan2(-(c.pos[0] - threatPos[0]), -(c.pos[2] - threatPos[2]));
      if (Math.abs(angDiff(toNode, aimYaw)) < 15 * DEG) s -= 1.5;
    }
    if (objOpts && objOpts.noise > 0 && objOpts.rng) s += (objOpts.rng() * 2 - 1) * objOpts.noise;
    scored.push({ i, s, pos: c.pos, height: c.height });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  // crossing-open-LOS penalty on the top slice only (raycast budget)
  const top = scored.slice(0, 6);
  for (const cand of top) {
    const segLen = hdist(bot.pos, cand.pos);
    if (segLen <= 8) continue;
    let open = 0;
    for (const f of [0.25, 0.5, 0.75]) {
      const sx = bot.pos[0] + (cand.pos[0] - bot.pos[0]) * f;
      const sz = bot.pos[2] + (cand.pos[2] - bot.pos[2]) * f;
      if (!sim.world.losBlocked([sx, bot.pos[1] + 1.4, sz], chest)) open++;
    }
    if (open >= 2) cand.s -= 1.0;
  }
  top.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return { idx: top[0].i, pos: top[0].pos.slice(), height: top[0].height };
}

// ============================================================ BOT-AI PASS helpers
// ---- weapon choice: the right gun for the range, a swap instead of a reload
// when the primary is nearly dry, the shotgun for anything inside ~8 m.
const CLS_MID = { pistol: 9, shotgun: 5, smg: 13, ar: 25, dmr: 55 };
const CLS_HALF = { pistol: 7, shotgun: 6, smg: 9, ar: 18, dmr: 30 };
function fitScore(cls, d) {
  const m = CLS_MID[cls] != null ? CLS_MID[cls] : 20, h = CLS_HALF[cls] != null ? CLS_HALF[cls] : 15;
  let f = 1 - Math.abs(d - m) / (h * 1.7);
  if (cls === "pistol") f -= 0.45;          // the sidearm is a fallback, not a plan
  if (cls === "shotgun" && d > 12) f -= 0.8; // pellets are useless out there
  return f;
}
function ammoOfSlot(bot, id) {
  if (bot.weapon.id === id) return bot.weapon.mag + bot.weapon.reserve;
  const a = bot._slotAmmo && bot._slotAmmo[id];
  return a ? a.mag + a.reserve : 0;
}
// returns a weapon id to switch to, or null. Throttled to one look per 0.5 s.
function chooseWeapon(sim, bot, brain, band, t, rng, dT) {
  const slots = bot.slots;
  if (!slots || !slots.length) return null;
  const w = bot.weapon;
  if (w.state === "switching" || (brain.burstLeft > 0 && brain.burstSize > 0)) return null;
  if (t - brain.swapT < 0.5) return null;
  brain.swapT = t;
  let nOwned = 0;
  for (let i = 0; i < slots.length; i++) if (slots[i]) nOwned++;
  if (nOwned < 2) return null;
  const cur = w.id;
  // an EMPTY gun is swapped by everybody (even a recruit): best other with ammo
  if (w.mag + w.reserve <= 0) {
    let best = null, bt = -1;
    for (const id of slots) if (id && id !== cur && ammoOfSlot(bot, id) > 0 && tierOf(id) > bt) { best = id; bt = tierOf(id); }
    return best;
  }
  if (brain.smartSwap === null) brain.smartSwap = band.swapSmart >= 1 ? true : (band.swapSmart > 0 && rng() < band.swapSmart);
  if (!brain.smartSwap || dT == null) return null;
  const wt = sim.weapons[cur];
  // nearly dry primary, a loaded alternative, enemy in view: swap beats reloading
  if (wt && w.mag <= Math.max(1, wt.mag * 0.12) && w.reserve > 0) {
    for (const id of slots) {
      if (!id || id === cur) continue;
      const a = bot._slotAmmo && bot._slotAmmo[id];
      if (a && a.mag > 0 && dT < 22) return id;
    }
  }
  let best = cur, bestS = -9;
  let curS = -9;
  for (const id of slots) {
    if (!id) continue;
    if (ammoOfSlot(bot, id) <= 0) continue;
    if (id !== cur) { const a = bot._slotAmmo && bot._slotAmmo[id]; if (!a || a.mag <= 0) continue; }
    const cls = sim.weapons[id] ? sim.weapons[id].class : "ar";
    const sc = fitScore(cls, dT) + (id === cur ? 0.35 : 0); // hysteresis: the gun in hand gets a bonus
    if (id === cur) curS = sc;
    if (sc > bestS) { bestS = sc; best = id; }
  }
  return best !== cur && bestS > curS + 0.05 ? best : null;
}

// ---- pre-aim: face down the far side of an upcoming corner instead of the
// wall the path is about to turn away from (hardened/veteran)
function lookAheadYaw(bot, brain) {
  const path = brain.path;
  if (!path || brain.pathI >= path.length - 1) return null;
  const W = path[brain.pathI], N = path[brain.pathI + 1];
  if (hdist(bot.pos, W) > 3.8) return null;
  const a1 = yawTo(bot.pos, W), a2 = yawTo(W, N);
  if (Math.abs(angDiff(a2, a1)) < 35 * DEG) return null;
  return a2;
}

// ---- loot: an under-armed bot detours to a rack / drop (PVP primarily)
function lootNeed(sim, bot) {
  const slots = bot.slots || [];
  let bestTier = -1, anyAmmoLow = false, nPrim = 0;
  for (const id of slots) {
    if (!id || id === "pike") continue;
    nPrim++;
    const a = ammoOfSlot(bot, id);
    if (a > 0 && tierOf(id) > bestTier) bestTier = tierOf(id);
    const wt = sim.weapons[id];
    if (wt && a < (wt.mag + wt.reserve) * 0.3) anyAmmoLow = true;
  }
  return { weapon: nPrim === 0 || bestTier < 0, ammo: nPrim > 0 && anyAmmoLow, bestTier };
}
function considerLoot(sim, nav, squad, bot, brain, band, t) {
  const S = sim.state;
  const loot = S.loot;
  if (!loot || !loot.length || !nav) { brain.lootUntil = -9; return false; }
  const x = sim.squad && sim.squad._navx;
  if (brain.lootUntil > t) {
    let it = null;
    for (let i = 0; i < loot.length; i++) if (loot[i].id === brain.lootId) { it = loot[i]; break; }
    if (it && !brain.arrived && brain.goal && hdist(brain.goal, it.pos) < 1.6) return true; // still walking there
    brain.lootUntil = -9; brain.lootId = -1; brain.anchor = null; // gone / reached: resume orders
    return false;
  }
  if (t - brain.lootCheckT < 1.5) return false;
  brain.lootCheckT = t;
  const obj = bot._obj;
  if (obj && obj.priority >= 0.9) return false;               // carrying / grabbing / returning: no detours
  // objective runners keep the tempo: attackers / escorts / interceptors /
  // returners only detour when a gun is within a few metres of their route
  const runner = obj && (obj.role === "attack" || obj.role === "escort" || obj.role === "intercept" || obj.role === "return" || obj.role === "carry");
  const need = lootNeed(sim, bot);
  if (!need.weapon && !need.ammo) return false;
  const range = band.lootRange;
  if (!(range > 0)) return false;
  let best = null, bestScore = 0;
  for (let i = 0; i < loot.length; i++) {
    const it = loot[i];
    if (S.time < it.armedAt) continue;
    if (!sim.match && it.src === "placed") continue;         // campaign: placed items are the player's
    if (Math.abs(it.pos[1] - bot.pos[1]) > 2.5) continue;
    const d = hdist(bot.pos, it.pos);
    if (d > range) continue;
    let val = 0;
    if (it.kind === "weapon") {
      if (!owns(bot, it.weapon)) {
        const tr = tierOf(it.weapon);
        if (need.weapon || tr > need.bestTier) val = 1 + tr * 0.7;
        const nat = { rifleman: "ar", cqb: "smg", marksman: "dmr", heavy: "ar" }[bot.archetype];
        const wt = sim.weapons[it.weapon];
        if (wt && wt.class === nat) val += 0.8;
      } else if (need.ammo) val = 0.9;
    } else if (it.kind === "ammo" && need.ammo) val = 1.0;
    if (val <= 0) continue;
    if (x && x.lootClaims) {
      const cl = x.lootClaims.get(it.id);
      if (cl && cl.until > t && cl.bot !== bot.id) {
        const ob = S.bots.find((b) => b.id === cl.bot);
        if (ob && ob.alive) continue;
      }
    }
    const score = val * 8 - d * 0.35;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  if (!best) return false;
  if (obj && obj.anchor) {
    const dA = hdist(bot.pos, obj.anchor), dB = hdist(best.pos, obj.anchor);
    if (hdist(bot.pos, best.pos) + dB - dA > (runner ? 6 : range * 0.8 + 8)) return false; // too far off the way
  }
  if (!nav.reachable(bot.pos, best.pos)) return false;
  setGoal(nav, sim, brain, bot, best.pos, hdist(bot.pos, best.pos) > 12);
  if (!brain.path || brain.path.length < 2) { brain.goal = null; brain.arrived = true; return false; }
  let len = 0;
  for (let i = 1; i < brain.path.length; i++) len += hdist(brain.path[i - 1], brain.path[i]);
  if (len > range * 1.7) { brain.goal = null; brain.arrived = true; brain.anchor = null; return false; }
  brain.lootUntil = t + 16; brain.lootId = best.id;
  if (sim.squad) {
    const nx = sim.squad._navx || (sim.squad._navx = { heat: new Map(), tick: 0, plans: 0, replans: 0 });
    if (!nx.lootClaims) nx.lootClaims = new Map();
    nx.lootClaims.set(best.id, { bot: bot.id, until: t + 16 });
  }
  return true;
}

// ---- side-peek from cover: hide / lean out / fire / duck back, alternating
// sides. Returns true while it owns the feet this tick.
function peekStep(sim, nav, bot, brain, band, t, rng, P, tb, c) {
  if (brain.coverIdx < 0 || !brain.arrived) return false;
  const cover = sim.colliders.cover && sim.colliders.cover[brain.coverIdx];
  if (!cover) return false;
  const pk = brain.pk;
  if (pk.coverIdx !== brain.coverIdx) {
    pk.coverIdx = brain.coverIdx; pk.ph = "hide"; pk.until = t + 0.5;
    pk.home = [cover.pos[0], cover.pos[1], cover.pos[2]];
    pk.on = band.peek >= 1 ? true : (band.peek > 0 && rng() < band.peek);
    pk.spot = null;
  }
  if (!pk.on) return false;
  const home = pk.home;
  // the hop logic is a 1-2 m affair around the cover node; a bot that has been
  // sent elsewhere (hunt / objective / flank) and merely shares the cover index
  // must not walk a straight line "back" to a node across the map
  if (hdist(bot.pos, home) > 2.2) { pk.coverIdx = -2; pk.ph = "hide"; return false; }
  const threatP = (P && P.lastKnown && t - P.lastSeenT < 25) ? P.lastKnown : null;
  const hitJust = (bot.lastHitT ?? -9) > t - 0.35;
  const lat = (() => {
    const dx = cover.dir ? cover.dir[0] : 0, dz = cover.dir ? cover.dir[2] : 0;
    const l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  })();
  if (pk.ph === "hide") {
    if (hdist(bot.pos, home) > 0.35) { STEER.stepTo(bot, brain, home[0], home[2]); return true; }
    if (cover.height === "low") c.crouch = true;
    if (t >= pk.until && threatP && !(P.seesTarget && t - P.lastSeenT < 0.4)) {
      const first = brain.pk.side;
      // widen the lean until a firing line exists: covers are 1-6 m wide, so a
      // fixed 1 m lean often stays behind the same crate
      search:
      for (const off of [1.0, 1.7, 2.4, 3.1]) {
        for (const sd of [first, -first]) {
          const spot = [home[0] + lat[0] * sd * off, home[1], home[2] + lat[1] * sd * off];
          if (nav && !nav.lineClear(home, spot, 0)) continue;
          const eye = [spot[0], spot[1] + 1.5, spot[2]];
          if (sim.world.losBlocked(eye, [threatP[0], threatP[1] + 1.0, threatP[2]])) continue;
          pk.ph = "out"; pk.spot = spot; pk.side = sd; pk.until = t + 0.9 + rng() * 0.7 + off * 0.15; pk.outT = t;
          pk.mark = brain.burstLog.length;
          break search;
        }
      }
      if (pk.ph !== "out") pk.until = t + 0.9; // no firing line from either side: keep hiding
    }
    return false;
  }
  if (pk.ph === "out") {
    const burstDone = brain.burstLog.length > pk.mark && brain.burstLeft <= 0;
    const bursting = brain.burstLeft > 0 && brain.burstSize > 0 && t < pk.until + 0.7;
    if (!pk.spot || (!bursting && (t >= pk.until || burstDone || (hitJust && band.peek >= 1)))) {
      pk.ph = "back";
      return false;
    }
    if (hdist(bot.pos, pk.spot) > 0.22) { STEER.stepTo(bot, brain, pk.spot[0], pk.spot[2]); return true; }
    return false; // in position: the normal hold-and-fire logic takes over
  }
  // back
  if (hdist(bot.pos, home) > 0.3) { STEER.stepTo(bot, brain, home[0], home[2]); return true; }
  pk.ph = "hide";
  const hideT = (0.7 + rng() * 0.8) * (band.name === "veteran" ? 0.8 : band.peek >= 1 ? 1.0 : 1.7);
  pk.until = t + hideT;
  // hardened/veteran switch sides most of the time (not predictable); others random
  pk.side = (band.peek >= 1 ? rng() < 0.7 : rng() < 0.5) ? -pk.side : pk.side;
  return false;
}

// ---- strafe between bursts (never while a burst is firing, never in the last
// 0.12 s before the next one so the bot has stopped when it pulls)
function strafeStep(sim, nav, bot, brain, band, t, rng, c) {
  if (t >= brain.strafeUntil) {
    brain.strafeUntil = t + 0.45 + rng() * 0.5;
    if (rng() < 0.7) brain.strafeDir = -brain.strafeDir;
    // the side must be walkable for ~0.9 m and not take us far from where we were
    if (!brain.strafeHome || hdist(bot.pos, brain.strafeHome) > 3.5) brain.strafeHome = bot.pos.slice();
    if (nav) {
      const yaw = bot.yaw;
      for (let k = 0; k < 2; k++) {
        const sx = Math.cos(yaw) * brain.strafeDir, sz = -Math.sin(yaw) * brain.strafeDir;
        const tp = [bot.pos[0] + sx * 0.95, bot.pos[1], bot.pos[2] + sz * 0.95];
        if (nav.lineClear(bot.pos, tp, 0) && hdist(tp, brain.strafeHome) < 1.6) return void (c.moveX = brain.strafeDir);
        brain.strafeDir = -brain.strafeDir;
      }
      brain.strafeUntil = t + 0.3;
      return;
    }
  }
  c.moveX = brain.strafeDir;
}

// ==================================================================== act
function act(sim, nav, squad, bot, dt, t) {
  if (!bot._brain) bot._brain = mkBrain(bot, t);
  const brain = bot._brain;
  const rng = sim.rng.ai;
  const band = kOf(sim, bot, brain);
  const weapon = sim.weapons[bot.weapon.id];
  const P = bot.percept;
  const tb = targetBodyOf(sim, bot); // W3: the CURRENT target's body, or null
  const obj = bot._obj || null;

  // ---- blow detection (burst budget counts ROUNDS — doctrine §2)
  const mag = bot.weapon.mag;
  if (brain.prevMag >= 0 && mag < brain.prevMag) {
    let blows = brain.prevMag - mag;
    while (blows-- > 0) {
      brain.burstLeft--;
      if (brain.missLeft > 0) brain.missLeft--;
      rollJitter(sim, bot, brain, band, rng, t);
      if (brain.burstLeft <= 0 && brain.burstSize > 0) {
        if (brain.burstLog.length < 64) brain.burstLog.push(brain.burstSize);
        brain.burstSize = 0;
        const aggro = squad.pushActive() || countSquadAlive(sim, bot) === 1 ? 0.8 : 1.0; // +25% aggression
        brain.pauseUntil = t + (band.pauseMin + rng() * (band.pauseMax - band.pauseMin)) * aggro;
      }
    }
  }
  brain.prevMag = mag;

  // ---- cmd (reused object; zero per-tick allocation once created)
  let c = bot.cmd;
  if (!c) {
    c = bot.cmd = {
      moveX: 0, moveZ: 0, yaw: bot.yaw, pitch: 0, jump: false, crouch: false,
      sprint: false, fire: false, ads: false, reload: false, switchTo: null,
      interact: false, grenade: false,
    };
  }
  c.moveX = 0; c.moveZ = 0; c.jump = false; c.crouch = false; c.sprint = false;
  c.fire = false; c.ads = false; c.reload = false; c.switchTo = null;
  c.interact = false; c.grenade = false;
  brain.mvActive = false; // steer.js re-arms it when a path is followed this tick

  // ---- live-grenade dodge (any live frag within 6.5 m → sprint away)
  const gl = sim.internal.grenades;
  for (let i = 0; i < gl.length; i++) {
    const g = gl[i];
    const gd = Math.hypot(bot.pos[0] - g.pos[0], bot.pos[2] - g.pos[2]);
    if (gd < 6.5) {
      const away = yawTo(g.pos, bot.pos);
      brain.curYaw = approachYaw(brain.curYaw, away, 12 * dt);
      c.yaw = brain.curYaw; c.pitch = 0; c.moveZ = 1; c.sprint = true;
      bot.aimAt = null;
      return;
    }
  }

  // ---- grenade windup / release (§5.9)
  if (brain.gPlanned) {
    const aimY = yawTo(bot.pos, brain.gTarget);
    brain.curYaw = approachYaw(brain.curYaw, aimY, 8 * dt);
    c.yaw = brain.curYaw; c.pitch = 0.3;
    if (t >= brain.gReleaseT) {
      brain.gPlanned = false;
      if (sim.internal.grenades.length === 0) {
        const eye = eyeOf(bot);
        const org = [eye[0], eye[1] - 0.15, eye[2]];
        const yaw = yawTo(org, brain.gTarget);
        const cp = Math.cos(brain.gPitch), sp = Math.sin(brain.gPitch);
        const v = GRENADE.BOT_THROW_V;
        const vel = [-Math.sin(yaw) * cp * v, sp * v, -Math.cos(yaw) * cp * v];
        spawnGrenade(sim, bot.id, org, vel); // 3.8 s fuse from release
        squad.noteGrenade(bot.id, t, band.grenCdS);
      }
    }
    bot.aimAt = brain.gTarget;
    return; // windup pose: stationary, no fire
  }

  // ---- reload behaviour: dry or safe-lull reload + lateral break (§5.7)
  const reloading = bot.weapon.state === "reloading";
  if (reloading && brain.prevWeaponState !== "reloading") {
    if (brain.confirmed) squad.requestBark(bot.id, "reload");
    // break for lateral cover: pick a side point once per reload
    // (W3: never the live player transform — last-known / heard only)
    const threat = (P && (P.lastKnown || P.heardAt)) || null;
    if (threat) {
      // F1 (AC-4 finding): the old blind pos±3 m lateral point lands inside
      // the cover geometry about half the time at a cover station — the bot
      // then pushed INTO its own cover for the whole reload, every reload of
      // a standoff (measured: mx=0 "frozen" episodes, cmd pulsing, 126 s).
      // Validate the point (and its midpoint) against the mover's own
      // capsule test; try the other side; nowhere clear → crouch in place.
      const ty = yawTo(bot.pos, threat);
      const s0 = rng() < 0.5 ? 1 : -1;
      let dest = null;
      const blocked = (x, y, z) =>
        sim.world && sim.world.capsuleBlocked && sim.world.capsuleBlocked(x, y, z, 0.35, 1.7);
      for (const side of [s0, -s0]) {
        const dx = Math.cos(ty) * 3 * side, dz = -Math.sin(ty) * 3 * side;
        const cand = [bot.pos[0] + dx, bot.pos[1], bot.pos[2] + dz];
        if (blocked(cand[0], cand[1], cand[2])) continue;
        if (blocked(bot.pos[0] + dx * 0.5, bot.pos[1], bot.pos[2] + dz * 0.5)) continue;
        dest = cand;
        break;
      }
      // a recruit reloads where it stands (in the open, in the line of fire)
      if (dest && band.reloadBreak < 1 && rng() >= band.reloadBreak) dest = null;
      brain.reloadDest = dest;
    } else brain.reloadDest = null;
  }
  brain.prevWeaponState = bot.weapon.state;

  // ---- weapon choice (BOT-AI PASS): right gun for the range, no reload when a
  // loaded sidearm is in the holster, shotgun inside ~8 m
  {
    const tbS = P && P.seesTarget && t - P.lastSeenT <= 0.5 ? tb : null;
    const pick = chooseWeapon(sim, bot, brain, band, t, rng, tbS ? hdist(bot.pos, tbS.pos) : null);
    if (pick && pick !== bot.weapon.id) c.switchTo = pick;
  }

  // ---- low-hp bark
  if (bot.hp < 40 && !brain.lowHpBarked) { brain.lowHpBarked = true; squad.requestBark(bot.id, "hit"); }
  else if (bot.hp >= 70) brain.lowHpBarked = false;

  const st = bot.state;
  const inFireState = st === "combat" || st === "suppress";

  // ---------------------------------------------------------- movement
  let desYaw = brain.curYaw, desPitch = 0, turnRate = 6.28; // rad/s default
  let moving = false;

  if (reloading && brain.reloadDest) {
    // break for lateral cover while the mag is out (§5.7)
    moving = hdist(bot.pos, brain.reloadDest) > 0.7;
    if (moving) {
      desYaw = yawTo(bot.pos, brain.reloadDest);
      brain.moveYaw = desYaw;
      c.moveZ = 1;
      turnRate = 5.6;
    } else c.crouch = true;
  } else if (st === "patrol" || st === "alert") {
    const route = bot.patrol;
    if (!route && brain.goal && !brain.arrived) {
      // W3 patrol floor / H4: routeless idle bots walk their wander goals
      followPath(sim, nav, bot, brain, c, dt);
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      brain.anchorYaw = desYaw;
      turnRate = 2.4;
    } else if (route && route.length) {
      const wp = route[brain.patrolI % route.length];
      const wp3 = [wp[0], bot.pos[1], wp[1]];
      if (hdist(bot.pos, wp3) < 0.9) {
        if (brain.waitUntil < 0) brain.waitUntil = t + 2;
        if (t >= brain.waitUntil) { brain.patrolI = (brain.patrolI + 1) % route.length; brain.waitUntil = -9; }
        // scan while waiting: ±60° at 25°/s (§5.3)
        brain.scanYaw += brain.scanDir * 25 * DEG * dt;
        if (Math.abs(brain.scanYaw) > 60 * DEG) brain.scanDir *= -1;
        desYaw = brain.anchorYaw + brain.scanYaw;
        turnRate = 25 * DEG * 4;
      } else if (nav) {
        // BOT-AI PASS: authored routes walk the nav path to the next waypoint
        // (the old straight-at-the-waypoint heading pushed into walls)
        if (!brain.goal || hdist(brain.goal, wp3) > 0.6) setGoal(nav, sim, brain, bot, wp3, false);
        if (brain.goal && !brain.arrived) {
          followPath(sim, nav, bot, brain, c, dt);
          desYaw = brain.moveYaw != null ? brain.moveYaw : yawTo(bot.pos, wp3);
          moving = true;
        } else {
          brain.patrolI = (brain.patrolI + 1) % route.length; // unreachable / reached: next stop
          brain.goal = null;
        }
        brain.anchorYaw = desYaw;
        turnRate = 2.4;
      } else {
        desYaw = yawTo(bot.pos, wp3);
        c.moveZ = 1;
        moving = true;
        brain.anchorYaw = desYaw;
        turnRate = 2.4;
      }
    } else {
      brain.scanYaw += brain.scanDir * 25 * DEG * dt;
      if (Math.abs(brain.scanYaw) > 60 * DEG) brain.scanDir *= -1;
      desYaw = brain.anchorYaw + brain.scanYaw;
      turnRate = 25 * DEG * 4;
    }
  } else if (st === "suspicious") {
    if (!brain.arrived && brain.goal) {
      followPath(sim, nav, bot, brain, c, dt);
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      c.sprint = brain.investT.sprint && hdist(bot.pos, brain.goal) > 6;
      moving = true;
      turnRate = 4.8;
    } else {
      brain.scanYaw += brain.scanDir * 30 * DEG * dt;
      if (Math.abs(brain.scanYaw) > 70 * DEG) brain.scanDir *= -1;
      desYaw = (brain.investT.target ? yawTo(bot.pos, brain.investT.target) : brain.anchorYaw) + brain.scanYaw;
      turnRate = 30 * DEG * 4;
    }
  } else if (st === "flank") {
    if (t >= brain.flankUntil || brain.arrived) {
      setState(sim, bot, brain, "combat");
      squad.release(bot.id);
      brain.coverScoreAt = -9;
    } else {
      followPath(sim, nav, bot, brain, c, dt);
      c.sprint = true;
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    }
  } else if (st === "retreat") {
    if (!brain.arrived && brain.goal) {
      followPath(sim, nav, bot, brain, c, dt);
      c.sprint = true;
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    } else {
      if (brain.retreatIdleFrom < 0) brain.retreatIdleFrom = t;
      c.crouch = true; // heal-idle (§5.3 — damage.js regens in 'retreat')
      // W3: face the last-known threat — never the live player transform
      const threat = (P && (P.lastKnown || P.heardAt)) || brain.anchor;
      desYaw = threat ? yawTo(bot.pos, threat) : brain.curYaw;
      turnRate = 3.2;
    }
  } else if (inFireState) {
    // combat/suppress movement: follow the plan unless in firing posture.
    // W3 H2: a task-locked break-off keeps moving even with the target
    // visible — wantHold requires the lock to have expired.
    const hspeed = Math.hypot(bot.vel[0], bot.vel[2]);
    const visibleFresh = P && P.seesTarget && t - P.lastSeenT <= 0.3;
    // F1 (AC-14 finding): fire-hold used to pin EVERY bot the moment its
    // target was visible — carriers, returners and stand-grabbers froze
    // into duels mid-route and objective runs never completed (measured:
    // 100+ s zero-displacement firefight holds all over the battery; the
    // capture rate collapsed once the nav fixes made contact frequent).
    // The objective layer already encodes "this movement is worth a trade"
    // as priority ≥0.9 (§7.4 grab, carry, stall-breaker, return); those
    // orders keep the feet moving — aim stays on the target through the H2
    // strafe frame, so the fight continues on the move. One-directional:
    // no information, speed, or accuracy is granted (monotonic rule).
    const objPress = obj && obj.anchor && obj.priority >= 0.9 && !brain.arrived;
    const hopRun = (t < brain.pushUntil && hdist(bot.pos, brain.goal || bot.pos) > 3) ||
      (t < brain.coverHopUntil && !brain.arrived && hdist(bot.pos, brain.goal || bot.pos) > 0.8);
    const wantHold = ((visibleFresh && t >= brain.taskLockUntil) || st === "suppress") && !objPress && !hopRun;
    if (!brain.arrived && brain.goal && !wantHold) {
      followPath(sim, nav, bot, brain, c, dt);
      c.sprint = brain.sprintMove && hdist(bot.pos, brain.goal) > 6;
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    } else if (!brain.arrived && brain.goal && wantHold && hdist(bot.pos, brain.goal) > 14 &&
               !(band.holdWhenSeen && tb && hdist(bot.pos, tb.pos) <= 45)) {
      // far from cover but target visible: keep moving (walk, gun up)
      followPath(sim, nav, bot, brain, c, dt);
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    }
    void hspeed;
  }

  // ---------------------------------------------------------- fire control
  bot.aimAt = null;
  if (inFireState && !reloading && bot.weapon.state !== "switching") {
    // W3: the trigger path fires ONLY at the current percept target when it
    // is visibleFresh (combat), or at the squad's last-known (suppress) —
    // never at a live transform the bot has not perceived.
    const visibleFresh = P && P.seesTarget && t - P.lastSeenT <= 0.3 && tb;
    const lk = squad.squadLastKnown(bot.id, P ? P.target : null);
    const suppressTarget = st === "suppress" && lk && t - lk.t <= 8 ? lk.pos : null;
    const targetPos = st === "combat"
      ? (visibleFresh ? tb.pos : null)
      : suppressTarget;

    if (targetPos) {
      const eye = eyeOf(bot);
      const d3 = Math.hypot(targetPos[0] - eye[0], targetPos[2] - eye[2]);
      // aim point: velocity-lead with rolled error (±30%), aim-high intent
      const mv = weapon && weapon.muzzleVel ? weapon.muzzleVel : 999;
      const lead = visibleFresh ? (d3 / mv) * (1 + brain.leadErr) : 0;
      let tx = targetPos[0] + (visibleFresh ? tb.vel[0] * lead : 0);
      let tz = targetPos[2] + (visibleFresh ? tb.vel[2] * lead : 0);
      const crouched = !!(visibleFresh && tb.stance === "crouch");
      let ty = targetPos[1] + (brain.aimHigh && visibleFresh
        ? (crouched ? 1.02 : 1.55)
        : (crouched ? 0.75 : 1.05));
      if (st === "suppress") {
        // §5.8: timed bursts AT the player's cover edge (lateral offset)
        const py = yawTo(eye, targetPos);
        tx += Math.cos(py) * 0.5 * brain.supOffSign;
        tz += -Math.sin(py) * 0.5 * brain.supOffSign;
        ty = targetPos[1] + 1.0;
      }
      const aYaw = Math.atan2(-(tx - eye[0]), -(tz - eye[2]));
      const hl = Math.hypot(tx - eye[0], tz - eye[2]) || 1e-9;
      const aPitch = Math.atan2(ty - eye[1], hl);
      desYaw = aYaw;
      desPitch = aPitch;
      turnRate = band.turnRate; // combat turn cap (rad/s) by skill: 4.0 recruit … 12 veteran
      bot.aimAt = [tx, ty, tz];

      // gates — every one must pass on the tick of the pull (§5.5–§5.7)
      const reactionReady = brain.confirmT >= 0 && t >= brain.confirmT + brain.reactionS - 1e-9;
      const stationary = Math.hypot(bot.vel[0], bot.vel[2]) < band.fireSpeed;
      if (reactionReady && stationary) c.ads = d3 > 12 && !(weapon && weapon.class === "shotgun"); // steady ADS posture
      const who = P ? P.target : null;
      const hasToken = st === "suppress"
        ? squad.holdsSuppress(bot.id)
        : (squad.holdsFire(bot.id) || squad.requestToken(bot.id, who));
      let wantFire = reactionReady && hasToken && stationary && mag > 0 &&
        t >= brain.pauseUntil;
      // W3 H3: the objective fire policy — MONOTONIC, it can only remove a
      // shot. 'hold' → never; 'defensive' → only inside selfDefenseM or
      // when hit in the last 2.0 s.
      if (wantFire && obj && obj.firePolicy && obj.firePolicy !== "free") {
        if (obj.firePolicy === "hold") wantFire = false;
        else if (obj.firePolicy === "defensive") {
          const close = d3 <= (obj.selfDefenseM || 0);
          const hitRecently = t - (bot.lastHitT ?? -9) <= 2.0;
          if (!close && !hitRecently) wantFire = false;
        }
      }
      // window integrity: a NEW pull is only issued when the weapon can fire
      // THIS tick — otherwise the 0.35 s input buffer could land the shot
      // long after the ≤3-attacker fire-window authorization expired.
      if (wantFire && !brain.wasFiring && !fireReadyNow(bot, weapon, t)) wantFire = false;
      // ≤3 damaging attackers on a HUMAN victim per 250 ms (§5.7 cap —
      // enforced only when the target is the human; bots are not the audience)
      if (wantFire && !squad.fireAuthOk(bot.id, t, who)) wantFire = false;

      if (wantFire && brain.burstSize === 0) {
        const br = burstRange(bot, weapon);
        brain.burstSize = br[0] + Math.floor(rng() * (br[1] - br[0] + 1));
        brain.burstLeft = brain.burstSize;
        rollJitter(sim, bot, brain, band, rng, t);
      }
      if (wantFire && brain.burstLeft <= 0) wantFire = false;

      if (wantFire) {
        // muzzle-block: hard within 1.4 m + friendly-on-ray ≤15 m (§5.7)
        const dir = dirOf(aYaw, aPitch);
        if (fireBlocked(sim, bot, eye, dir, d3, who)) {
          wantFire = false;
          brain.coverScoreAt = -9; // reposition next think
        }
      }

      if (wantFire) {
        squad.noteFireAuth(bot.id, t, who);
        if (weapon && weapon.auto) c.fire = true;
        else { brain.semiToggle = !brain.semiToggle; c.fire = brain.semiToggle; }
        c.ads = d3 > 12 && !(weapon && weapon.class === "shotgun");
        // apply latched aim errors on the firing aim only
        desYaw = aYaw + brain.jitterY + (brain.missLeft > 0 ? brain.missSign * brain.missOff : 0);
        desPitch = aPitch + brain.jitterP + (brain.missLeft > 0 ? brain.missOff * 0.25 : 0);
        brain.curYaw = desYaw; // snap: jitter is per-shot, not turn-limited
        if (st === "suppress" && brain.burstLeft === brain.burstSize) brain.supOffSign *= -1;
      } else if (mag === 0 && bot.weapon.reserve > 0) {
        // dry: reload edge (buffered by the shared machine)
        c.reload = !brain.prevReloadCmd;
      }
    } else if (st === "combat") {
      // no target: face last-known, proactive reload in the lull
      const threat = (P && P.lastKnown) || (lk && lk.pos) || null;
      if (threat && !moving) { desYaw = yawTo(bot.pos, threat); turnRate = 4.8; }
      const lull = t - (bot.weapon.lastShotT ?? -9) > 1.5;
      if (weapon && lull && bot.weapon.mag <= weapon.mag * 0.25 && bot.weapon.reserve > 0) {
        c.reload = !brain.prevReloadCmd;
      }
    }
  } else if (!inFireState && !moving && st !== "patrol" && st !== "alert" && st !== "suspicious") {
    // idle-facing fallback for retreat handled above
  }
  // BOT-AI PASS: top the magazine up in a lull instead of carrying half a mag
  // into the next fight (and reloading in the middle of it): no enemy seen for
  // 2.5 s, nothing fired for 2 s, magazine at or under the band's threshold
  if (!c.reload && !reloading && !c.fire && st !== "retreat" && weapon && bot.weapon.reserve > 0 &&
      bot.weapon.mag <= weapon.mag * (band.name === "recruit" ? 0.2 : band.name === "regular" ? 0.4 : 0.55) &&
      t - (P ? P.lastSeenT : -9) > 2.5 && t - (bot.weapon.lastShotT ?? -9) > 2.0 && bot.weapon.state === "idle") {
    c.reload = !brain.prevReloadCmd;
  }
  brain.prevReloadCmd = c.reload;

  // ---- BOT-AI PASS: peeking and strafing (combat, not reloading, not firing)
  if (st === "combat" && !reloading && !brain.gPlanned) {
    const holdingGround = !moving && !brain.mvActive;
    if (holdingGround && peekStep(sim, nav, bot, brain, band, t, rng, P, tb, c)) {
      moving = true;
    } else if (holdingGround && !c.fire && brain.strafeOn && P && P.seesTarget && t - P.lastSeenT <= 0.4 && tb &&
               !(brain.pk.on && brain.coverIdx >= 0 && brain.arrived)) {
      const bursting = brain.burstLeft > 0 && brain.burstSize > 0;
      const reacting = band.strafeReact !== false && brain.confirmT >= 0 && t < brain.confirmT + brain.reactionS;
      const pausing = t < brain.pauseUntil - 0.12;
      if (!bursting && (reacting || pausing) && bot.hp > 0) strafeStep(sim, nav, bot, brain, band, t, rng, c);
    }
  }

  // ---- peek stance at low cover while engaged (visual peek cycle)
  if (st === "combat" && brain.arrived && brain.coverIdx >= 0 && !c.fire && !brain.pk.on) {
    const cover = sim.colliders.cover[brain.coverIdx];
    if (cover && cover.height === "low") {
      if (brain.peekUntil < t) {
        brain.peekPhase = brain.peekPhase === "expose" ? "hide" : "expose";
        brain.peekUntil = t + (brain.peekPhase === "expose"
          ? 0.6 + rng() * 0.5     // stand 0.6–1.1 s (§5.8)
          : 1.2 + rng() * 0.8);   // duck 1.2–2.0 s
      }
      if (brain.peekPhase === "hide") c.crouch = true;
    }
  }

  // ---- finalize aim/turn
  if (brain.mvActive && !bot.aimAt) {
    // travelling: feet are path-driven now, so facing only needs to look right —
    // catch up quickly; hardened/veteran bots pre-aim the far side of corners
    if (band.lookCorners > 0 && ((bot.id * 0.6180339887) % 1) < band.lookCorners) {
      const ly = lookAheadYaw(bot, brain);
      if (ly != null) desYaw = ly;
    }
    if (turnRate < 5.0) turnRate = 5.0;
  }
  if (!c.fire) brain.curYaw = approachYaw(brain.curYaw, desYaw, turnRate * dt);
  c.yaw = brain.curYaw;
  c.pitch = desPitch;
  // BOT-AI PASS: the feet follow steer.js's WORLD-SPACE heading expressed in
  // the final facing frame, so facing (aim, scan, turn-rate caps) and travel
  // are independent. Replaces the W3 "strafe only when aiming" special case:
  // a bot that is walking a path AND aiming (H2 break-off, H1 objective drive)
  // already strafed through this exact rotation.
  if (brain.mvActive && brain.moveYaw != null && !(reloading && brain.reloadDest)) {
    const rel = angDiff(brain.moveYaw, brain.curYaw);
    c.moveZ = Math.cos(rel);
    c.moveX = -Math.sin(rel);
  }
  brain.wasFiring = c.fire;

  // ---- stuck ladder (steer.js: sidestep + local replan at 0.7 s, then the
  // W3 escalating detour, then the embed-tomb depenetration; plus a
  // displacement detector for orbits). setGoal defers all overrides while a
  // detour runs (brain.detourUntil) so the objective drive cannot re-assert
  // its anchor inside the window.
  STEER.watchStuck(sim, nav, bot, brain, !!brain.mvActive, dt, {
    replan() { if (brain.goal && !brain.arrived) { brain.needRepath = false; brain.path = STEER.planPath(sim, nav, bot, brain, brain.goal, band); brain.pathI = brain.path ? 1 : 0; } },
    detour(esc) { setGoal(nav, sim, brain, bot, esc, false); },
  });
}

// §1.8 sprint-out (mirrors player.js SPRINT_OUT_S normal column — bots never
// tac-sprint) + rpm interval: true when a pull issued THIS tick fires THIS
// tick, so the buffered edge can never outlive its fire-window authorization.
const SPRINT_OUT = { smg: 0.160, pistol: 0.130, ar: 0.210, dmr: 0.290 };
function fireReadyNow(bot, weapon, t) {
  const w = bot.weapon;
  if (t - (w.lastShotT ?? -9) < 60 / weapon.rpm - 1e-6) return false;
  const so = SPRINT_OUT[weapon.class] || 0.210;
  if (t - (bot._lastSprintT ?? -9) < so) return false;
  return true;
}

function dirOf(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function rollJitter(sim, bot, brain, band, rng, t) {
  // σ multipliers (§5.5): acquire ×3→×1 over 0.6 s, target airborne/sliding
  // ×1.5, bot moving ×1.5; flinch adds +0.8°/stack (§3.4).
  // W3: the evasive read is against the CURRENT TARGET's body, and only
  // while it is visibleFresh — an unseen target's motion is not readable.
  const P = bot.percept;
  const tb = P && P.targetBody && P.targetBody.alive ? P.targetBody : null;
  const fresh = !!(tb && P.seesTarget && t - P.lastSeenT <= 0.3);
  const sinceConfirm = brain.confirmT >= 0 ? t - brain.confirmT : 9;
  const A = band.acquire != null ? band.acquire : 3;
  const acquire = sinceConfirm < 0.6 ? A - (A - 1) * (sinceConfirm / 0.6) : 1;
  const pm = fresh ? (tb._m || null) : null;
  const evasive = fresh && ((tb.grounded === false) || (pm && pm.sliding)) ? 1.5 : 1;
  const botMoving = Math.hypot(bot.vel[0], bot.vel[2]) > 0.5 ? 1.5 : 1;
  const flinch = (bot.flinchUntil || -9) > t ? (bot.flinchStacks || 1) * FLINCH_SIGMA_PER_STACK : 0;
  const sigma = band.jitter * acquire * evasive * botMoving + flinch;
  brain.jitterY = gauss(rng) * sigma;
  brain.jitterP = gauss(rng) * sigma;
  brain.lastSigma = sigma;
  if (AI_PROBE.enabled) AI_PROBE.jitter.push({ y: brain.jitterY, p: brain.jitterP, sigma, band: bot.band });
}

function fireBlocked(sim, bot, eye, dir, distToTarget, targetWho) {
  // hard occluder within 1.4 m of the muzzle (spec bound 1.2 — stricter)
  const hit = sim.world.raycast(eye, dir, 1.4);
  if (hit && hit.box && (hit.box.matClass || "hard") === "hard") return true;
  // friendly capsule on the ray within 15 m. W3: "friendly" now means the
  // SAME TEAM (when teams exist) — the target itself and enemy bodies on
  // the ray never hold fire, or a bot could not shoot a bot inside 15 m.
  const lim = Math.min(15, distToTarget);
  for (const mate of sim.state.bots) {
    if (!mate.alive || mate.id === bot.id) continue;
    if (mate.id === targetWho) continue;
    if (bot.team != null && mate.team != null && mate.team !== bot.team) continue;
    const rx = mate.pos[0] - eye[0];
    const ry = mate.pos[1] + 1.0 - eye[1];
    const rz = mate.pos[2] - eye[2];
    const proj = rx * dir[0] + ry * dir[1] + rz * dir[2];
    if (proj <= 0 || proj >= lim) continue;
    const perp2 = rx * rx + ry * ry + rz * rz - proj * proj;
    if (perp2 < 0.36) return true; // within 0.6 m of the ray
  }
  return false;
}

function followPath(sim, nav, bot, brain, c, dt) {
  // BOT-AI PASS: steer.js owns path following (world-space heading, carrot
  // lookahead, separation). c.moveZ = 1 only flags "the feet move" for the
  // callers' `moving` logic; the real move vector is written at the end of
  // act() from brain.mvx/mvz in the final facing frame.
  if (STEER.followPath(sim, nav, bot, brain, dt)) c.moveZ = 1;
}

// Public navigation command (nav_probe.mjs, scripted scenarios): send `bot` to
// `goal` through the real brain — path planning, steering, stuck ladder — as a
// non-combat travel order ("suspicious" never gives up on its own).
export function aiNavGoto(sim, nav, bot, goal, sprint) {
  if (!bot._brain) bot._brain = mkBrain(bot, sim.state.time);
  const brain = bot._brain;
  bot.state = "suspicious";
  brain.enteredT = sim.state.time;
  brain.investT = { until: 1e9, sweepUntil: -9, nextSampleT: -9, sprint: !!sprint, target: goal.slice() };
  brain.detourUntil = -9;
  brain.goal = null;
  setGoal(nav, sim, brain, bot, goal, sprint);
}

