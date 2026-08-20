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

import { perceive } from "./perception.js";
import { spawnGrenade, GRENADE } from "../sim/grenades.js";

const DEG = Math.PI / 180;

// §5.5 difficulty bands (R30 authored mix — bands change ONLY perception/
// reaction/accuracy/aggression, never HP or damage).
export const BANDS = {
  recruit:  { reactMin: 0.650, reactMax: 0.800, jitter: 0.030, missRounds: 2, missMin: 1.8, missMax: 2.5, pauseMin: 0.8, pauseMax: 1.2, aimHigh: 0 },
  regular:  { reactMin: 0.500, reactMax: 0.700, jitter: 0.022, missRounds: 2, missMin: 1.5, missMax: 2.2, pauseMin: 0.6, pauseMax: 1.0, aimHigh: 0 },
  hardened: { reactMin: 0.380, reactMax: 0.550, jitter: 0.018, missRounds: 1, missMin: 1.2, missMax: 1.8, pauseMin: 0.5, pauseMax: 0.9, aimHigh: 0.10 },
  veteran:  { reactMin: 0.300, reactMax: 0.420, jitter: 0.012, missRounds: 0, missMin: 0, missMax: 0, pauseMin: 0.4, pauseMax: 0.7, aimHigh: 0.18 },
};

// §5.7 burst rounds + §5.8 preferred bands — mirrors content.json archetypes
// (sim does not expose content; values are the combat_spec numbers verbatim,
// weapon-class fallback for test spawns).
const BURST_BY_ARCH = { rifleman: [3, 5], cqb: [5, 8], marksman: [1, 1], heavy: [5, 8] };
const BURST_BY_CLASS = { ar: [3, 5], smg: [5, 8], dmr: [1, 1], pistol: [2, 3] };
const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const BAND_BY_CLASS = { ar: [15, 35], smg: [8, 18], dmr: [35, 80], pistol: [6, 15] };

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
  return BURST_BY_ARCH[bot.archetype] || BURST_BY_CLASS[weapon ? weapon.class : "ar"] || [3, 5];
}
function prefBand(bot, weapon, pushOn) {
  const b = BAND_BY_ARCH[bot.archetype] || BAND_BY_CLASS[weapon ? weapon.class : "ar"] || [15, 35];
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
    goal: null, path: null, pathI: 0, needRepath: false, stuckT: 0,
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
    // misc
    lowHpBarked: false, prevWeaponState: "idle", reloadDest: null,
    prevReloadCmd: false, semiToggle: false, supOffSign: 1,
    flankThinkAt: -9, wasFiring: false,
  };
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
    const d = hdist(bot.pos, S.player.pos);
    const interval = d <= THINK_NEAR_M ? THINK_NEAR_S : THINK_FAR_S;
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
  const band = BANDS[bot.band] || BANDS.regular;
  const dtT = Math.min(0.5, Math.max(1 / 60, t - Math.max(0, brain.lastThinkT)));
  brain.lastThinkT = t;

  perceive(bot, sim, sim.world, dtT, rng);
  const P = bot.percept;
  const player = sim.state.player;

  // ---- confirm / reconfirm / roll-once-and-latch (§5.6)
  if (P.awareness >= 1 - 1e-9 && !brain.confirmed) {
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
      brain.leadErr = (rng() * 2 - 1) * 0.30;
      if (brain.reactionLog.length < 32) brain.reactionLog.push({ confirmT: t, reactionS: brain.reactionS });
      squad.noteConfirm(bot.id, t);
    }
    if (P.lastKnown) squad.noteLastKnown(bot.id, P.lastKnown, t);
  }
  if (brain.confirmed && t - P.lastSeenT > 2.0 && t - (bot.lastHitT ?? -9) > 2.0) {
    brain.confirmed = false;
    brain.rerollArmed = true; // next confirm re-rolls (§5.6)
  }
  if (P.seesPlayer && P.lastKnown) squad.noteLastKnown(bot.id, P.lastKnown, t);

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

    case "combat":
      planCombat(sim, nav, squad, bot, brain, t, rng);
      break;

    case "flank": {
      // committed — no reactive self-cancel (doctrine); arrival/timeout in act
      break;
    }

    case "suppress": {
      if (!squad.holdsSuppress(bot.id)) { setState(sim, bot, brain, "combat"); brain.coverScoreAt = -9; break; }
      if (P.seesPlayer && squad.requestToken(bot.id)) { setState(sim, bot, brain, "combat"); break; }
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
    brain.path = nav ? nav.findPath(bot.pos, brain.goal) : null;
    brain.pathI = brain.path ? 1 : 0;
  }
}

function countSquadAlive(sim, bot) {
  const k = bot.squadId || "_default";
  let n = 0;
  for (const b of sim.state.bots) if (b.alive && (b.squadId || "_default") === k) n++;
  return n;
}

function setGoal(nav, sim, brain, bot, pos, sprint) {
  if (!pos) return;
  if (brain.goal && hdist(brain.goal, pos) < 0.8 && !brain.needRepath) { brain.sprintMove = sprint; return; }
  brain.goal = [pos[0], pos[1] != null ? pos[1] : bot.pos[1], pos[2]];
  brain.sprintMove = !!sprint;
  brain.arrived = false;
  brain.path = nav ? nav.findPath(bot.pos, brain.goal) : null;
  brain.pathI = brain.path ? 1 : 0;
  brain.stuckT = 0;
}

// ---- combat planning (think-rate): retreat roll, referee hooks, cover,
// token-less decisions, grenade eligibility.
function planCombat(sim, nav, squad, bot, brain, t, rng) {
  const P = bot.percept;
  const player = sim.state.player;
  const weapon = sim.weapons[bot.weapon.id];
  const pushOn = squad.pushActive();
  const squadAlive = countSquadAlive(sim, bot);
  const lastStand = squadAlive === 1;

  // referee episode close → break to investigate (engagement ends)
  if (brain.forceDisengage) {
    brain.forceDisengage = false;
    const lk = squad.squadLastKnown(bot.id) || (P.lastKnown ? { pos: P.lastKnown } : null);
    setState(sim, bot, brain, "suspicious");
    brain.investT = { until: t + 14, sweepUntil: -9, nextSampleT: -9, sprint: false, target: lk ? lk.pos.slice() : bot.pos.slice() };
    setGoal(nav, sim, brain, bot, brain.investT.target, false);
    squad.release(bot.id);
    return;
  }

  // §5.3 RETREAT: hp<35 AND squad ≥2 alive AND roll 0.6 once (latched)
  if (bot.hp < 35) {
    if (!brain.retreatRolled) {
      brain.retreatRolled = true;
      brain.retreatGo = !lastStand && rng() < 0.6;
    }
    if (brain.retreatGo && !lastStand) {
      setState(sim, bot, brain, "retreat");
      squad.release(bot.id);
      const dest = pickRetreatCover(sim, nav, bot, brain, P.lastKnown || player.pos, rng);
      setGoal(nav, sim, brain, bot, dest, true);
      brain.retreatIdleFrom = -9;
      return;
    }
  }

  // referee-forced flank
  if (brain.forceFlank) {
    brain.forceFlank = false;
    enterFlank(sim, nav, squad, bot, brain, t, rng);
    return;
  }

  const lk = squad.squadLastKnown(bot.id);
  const threat = (P.lastKnown && t - P.lastSeenT < 8) ? P.lastKnown : (lk ? lk.pos : P.lastKnown);
  if (!threat) return;

  // token-less decision: suppress → flank → reposition/hold
  const hasFire = squad.holdsFire(bot.id) || squad.requestToken(bot.id);
  if (!hasFire) {
    if (squad.requestSuppress(bot.id)) {
      setState(sim, bot, brain, "suppress");
      return;
    }
    if (t - brain.flankThinkAt > 8) {
      brain.flankThinkAt = t;
      if (rng() < 0.5) { enterFlank(sim, nav, squad, bot, brain, t, rng); return; }
    }
  }

  // cover (re)scoring: entry / every 6 s / compromised ≥20 dmg (§5.8)
  const compromised = brain.hpAtCover - bot.hp >= 20;
  if (pushOn || lastStand) {
    // push: close on last-known directly (§5.3 — the engagement ends)
    setGoal(nav, sim, brain, bot, threat, true);
    if (brain.arrived && t - P.lastSeenT > 3 && nav) {
      const p2 = nav.randomPoint(threat, 8, rng);
      setGoal(nav, sim, brain, bot, p2, true);
    }
  } else if (brain.coverIdx < 0 || t - brain.coverScoreAt >= 6 || compromised) {
    brain.coverScoreAt = t;
    brain.hpAtCover = bot.hp;
    const pick = pickCover(sim, nav, bot, brain, threat, weapon, pushOn);
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

  // grenade eligibility (§5.9): fire-token holder, player static ≥6 s,
  // range 8–30, arc solvable, squad 20 s cooldown, ≤1 live mission-wide
  // (no last-seen freshness bound: a ≥6 s static player is BY DEFINITION one
  // the bot has stopped seeing — you grenade the cover they vanished behind)
  if (hasFire && !brain.gPlanned && squad.grenadeReady(bot.id, t) &&
      sim.internal.grenades.length === 0 &&
      squad.playerStaticFor(t) >= 6 &&
      brain.confirmT >= 0 && t >= brain.confirmT + brain.reactionS) {
    const target = [threat[0], sim.world.sphereGround(threat[0], threat[2]), threat[2]];
    const d = hdist(bot.pos, target);
    if (d >= 8 && d <= 30) {
      const pitch = solveArcPitch(eyeOf(bot), target, GRENADE.BOT_THROW_V);
      if (pitch != null) {
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
  // flank geometry is computed against the squad's LAST-KNOWN player pos —
  // never the live transform (the blackboard is the only shared fact, §5.4)
  const lk = squad.squadLastKnown(bot.id);
  const P = bot.percept;
  const pRef = (lk && lk.pos) || (P && P.lastKnown) || sim.state.player.pos;
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
// the mission has exactly one known threat, flagged in the lane report).
function pickCover(sim, nav, bot, brain, threatPos, weapon, pushOn) {
  const covers = sim.colliders.cover || [];
  if (!covers.length) return null;
  const player = sim.state.player;
  const band = prefBand(bot, weapon, pushOn);
  const chest = [threatPos[0], threatPos[1] + 1.0, threatPos[2]];
  // player aim direction (±15° cone penalty)
  const aimYaw = player.yaw;
  const scored = [];
  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    const dBot = hdist(c.pos, bot.pos);
    if (dBot > 45) continue;
    const dThreat = hdist(c.pos, threatPos);
    if (dThreat < 2 || dThreat > band[1] * 1.6 + 10) continue;
    let s = 0;
    const eye = [c.pos[0], c.pos[1] + 0.8, c.pos[2]];
    if (sim.world.losBlocked(eye, chest)) s += 3.0;                      // blocksLOS
    if (dThreat >= band[0] && dThreat <= band[1]) s += 1.5;              // preferred band
    s += 1.0 / (1 + 0.15 * dBot);                                        // proximity
    s += 0.8;                                                            // flankSafety (single threat)
    // claimed / min spacing 4 m — derived from other bots' claims+positions
    for (const ob of sim.state.bots) {
      if (!ob.alive || ob.id === bot.id) continue;
      const claimedHere = ob._brain && ob._brain.coverIdx === i;
      if (claimedHere || hdist(ob.pos, c.pos) < 4) { s -= 2.0; break; }
    }
    // inside the player's last aim cone ±15°
    const toNode = Math.atan2(-(c.pos[0] - player.pos[0]), -(c.pos[2] - player.pos[2]));
    if (Math.abs(angDiff(toNode, aimYaw)) < 15 * DEG) s -= 1.5;
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

// ==================================================================== act
function act(sim, nav, squad, bot, dt, t) {
  if (!bot._brain) bot._brain = mkBrain(bot, t);
  const brain = bot._brain;
  const rng = sim.rng.ai;
  const band = BANDS[bot.band] || BANDS.regular;
  const weapon = sim.weapons[bot.weapon.id];
  const player = sim.state.player;
  const P = bot.percept;

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
        squad.noteGrenade(bot.id, t);
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
    const threat = P && P.lastKnown ? P.lastKnown : player.pos;
    const ty = yawTo(bot.pos, threat);
    const side = rng() < 0.5 ? 1 : -1;
    brain.reloadDest = [
      bot.pos[0] + Math.cos(ty) * 3 * side, bot.pos[1],
      bot.pos[2] - Math.sin(ty) * 3 * side,
    ];
  }
  brain.prevWeaponState = bot.weapon.state;

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
    if (route && route.length) {
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
      followPath(sim, bot, brain, c, dt);
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
      followPath(sim, bot, brain, c, dt);
      c.sprint = true;
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    }
  } else if (st === "retreat") {
    if (!brain.arrived && brain.goal) {
      followPath(sim, bot, brain, c, dt);
      c.sprint = true;
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    } else {
      if (brain.retreatIdleFrom < 0) brain.retreatIdleFrom = t;
      c.crouch = true; // heal-idle (§5.3 — damage.js regens in 'retreat')
      const threat = P && P.lastKnown ? P.lastKnown : player.pos;
      desYaw = yawTo(bot.pos, threat);
      turnRate = 3.2;
    }
  } else if (inFireState) {
    // combat/suppress movement: follow the plan unless in firing posture
    const hspeed = Math.hypot(bot.vel[0], bot.vel[2]);
    const visibleFresh = P && P.seesPlayer && t - P.lastSeenT <= 0.3;
    const wantHold = visibleFresh || st === "suppress";
    if (!brain.arrived && brain.goal && !wantHold) {
      followPath(sim, bot, brain, c, dt);
      c.sprint = brain.sprintMove && hdist(bot.pos, brain.goal) > 6;
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    } else if (!brain.arrived && brain.goal && wantHold && hdist(bot.pos, brain.goal) > 14) {
      // far from cover but target visible: keep moving (walk, gun up)
      followPath(sim, bot, brain, c, dt);
      desYaw = brain.moveYaw != null ? brain.moveYaw : brain.curYaw;
      moving = true;
      turnRate = 5.6;
    }
    void hspeed;
  }

  // ---------------------------------------------------------- fire control
  bot.aimAt = null;
  if (inFireState && player.alive && !reloading && bot.weapon.state !== "switching") {
    const visibleFresh = P && P.seesPlayer && t - P.lastSeenT <= 0.3;
    const lk = squad.squadLastKnown(bot.id);
    const suppressTarget = st === "suppress" && lk && t - lk.t <= 8 ? lk.pos : null;
    const targetPos = st === "combat"
      ? (visibleFresh ? player.pos : null)
      : suppressTarget;

    if (targetPos) {
      const eye = eyeOf(bot);
      const d3 = Math.hypot(targetPos[0] - eye[0], targetPos[2] - eye[2]);
      // aim point: velocity-lead with rolled error (±30%), aim-high intent
      const mv = weapon && weapon.muzzleVel ? weapon.muzzleVel : 999;
      const lead = visibleFresh ? (d3 / mv) * (1 + brain.leadErr) : 0;
      let tx = targetPos[0] + (visibleFresh ? player.vel[0] * lead : 0);
      let tz = targetPos[2] + (visibleFresh ? player.vel[2] * lead : 0);
      const crouched = player.stance === "crouch";
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
      turnRate = 9.4; // combat turn 540°/s
      bot.aimAt = [tx, ty, tz];

      // gates — every one must pass on the tick of the pull (§5.5–§5.7)
      const reactionReady = brain.confirmT >= 0 && t >= brain.confirmT + brain.reactionS - 1e-9;
      const stationary = Math.hypot(bot.vel[0], bot.vel[2]) < 0.75;
      if (reactionReady && stationary) c.ads = d3 > 12; // steady ADS posture
      const hasToken = st === "suppress"
        ? squad.holdsSuppress(bot.id)
        : (squad.holdsFire(bot.id) || squad.requestToken(bot.id));
      let wantFire = reactionReady && hasToken && stationary && mag > 0 &&
        t >= brain.pauseUntil;
      // window integrity: a NEW pull is only issued when the weapon can fire
      // THIS tick — otherwise the 0.35 s input buffer could land the shot
      // long after the ≤3-attacker fire-window authorization expired.
      if (wantFire && !brain.wasFiring && !fireReadyNow(bot, weapon, t)) wantFire = false;
      // mission-wide ≤3 damaging attackers per 250 ms (§5.7 cross-squad cap)
      if (wantFire && !squad.fireAuthOk(bot.id, t)) wantFire = false;

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
        if (fireBlocked(sim, bot, eye, dir, d3)) {
          wantFire = false;
          brain.coverScoreAt = -9; // reposition next think
        }
      }

      if (wantFire) {
        squad.noteFireAuth(bot.id, t);
        if (weapon && weapon.auto) c.fire = true;
        else { brain.semiToggle = !brain.semiToggle; c.fire = brain.semiToggle; }
        c.ads = d3 > 12;
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
  brain.prevReloadCmd = c.reload;

  // ---- peek stance at low cover while engaged (visual peek cycle)
  if (st === "combat" && brain.arrived && brain.coverIdx >= 0 && !c.fire) {
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
  if (!c.fire) brain.curYaw = approachYaw(brain.curYaw, desYaw, turnRate * dt);
  c.yaw = brain.curYaw;
  c.pitch = desPitch;
  brain.wasFiring = c.fire;

  // ---- stuck watchdog
  if ((c.moveZ !== 0 || c.moveX !== 0) && Math.hypot(bot.vel[0], bot.vel[2]) < 0.3) {
    brain.stuckT += dt;
    if (brain.stuckT > 1.5) {
      brain.stuckT = 0;
      brain.needRepath = true;
      if (nav && brain.goal) brain.goal = nav.randomPoint(brain.goal, 2.5, rng);
    }
  } else brain.stuckT = 0;
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
  // ×1.5, bot moving ×1.5; flinch adds +0.8°/stack (§3.4)
  const player = sim.state.player;
  const sinceConfirm = brain.confirmT >= 0 ? t - brain.confirmT : 9;
  const acquire = sinceConfirm < 0.6 ? 3 - 2 * (sinceConfirm / 0.6) : 1;
  const pm = player._m || null;
  const evasive = (!player.grounded || (pm && pm.sliding)) ? 1.5 : 1;
  const botMoving = Math.hypot(bot.vel[0], bot.vel[2]) > 0.5 ? 1.5 : 1;
  const flinch = (bot.flinchUntil || -9) > t ? (bot.flinchStacks || 1) * FLINCH_SIGMA_PER_STACK : 0;
  const sigma = band.jitter * acquire * evasive * botMoving + flinch;
  brain.jitterY = gauss(rng) * sigma;
  brain.jitterP = gauss(rng) * sigma;
  brain.lastSigma = sigma;
  if (AI_PROBE.enabled) AI_PROBE.jitter.push({ y: brain.jitterY, p: brain.jitterP, sigma, band: bot.band });
}

function fireBlocked(sim, bot, eye, dir, distToTarget) {
  // hard occluder within 1.4 m of the muzzle (spec bound 1.2 — stricter)
  const hit = sim.world.raycast(eye, dir, 1.4);
  if (hit && hit.box && (hit.box.matClass || "hard") === "hard") return true;
  // friendly capsule on the ray within 15 m
  const lim = Math.min(15, distToTarget);
  for (const mate of sim.state.bots) {
    if (!mate.alive || mate.id === bot.id) continue;
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

function followPath(sim, bot, brain, c, dt) {
  const goal = brain.goal;
  if (!goal) { brain.arrived = true; return; }
  let wp = null;
  if (brain.path && brain.pathI < brain.path.length) {
    wp = brain.path[brain.pathI];
    if (hdist(bot.pos, wp) < 0.6) {
      brain.pathI++;
      wp = brain.pathI < brain.path.length ? brain.path[brain.pathI] : null;
    }
  }
  if (!wp) {
    // direct or path-exhausted: head at the goal itself
    if (hdist(bot.pos, goal) < 0.8) { brain.arrived = true; return; }
    wp = goal;
  }
  brain.moveYaw = yawTo(bot.pos, wp);
  c.moveZ = 1;
  void dt; void sim;
}
