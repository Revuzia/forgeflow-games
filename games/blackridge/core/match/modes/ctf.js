// core/match/modes/ctf.js [W8] — MODE 2: CAPTURE THE FLAG (5v5).
// PVP_BUILD_PLAN Part 4.1 row W8 — implements modes.md Part 3 in full,
// architecture.md Part 3, bot_ai.md Part 7 (duty layer only — lane/route
// choice is W7's), under rulings C4 (flag stands are content-authored, probe
// emitted — read, never re-authored), C7 (the ctf V7 spawn veto), C7b (the
// per-mode point set), C12 (3 caps / 12:00 / 5.0 s respawn, 8.0 s during
// PRESSURE), C13 (overtime = modes.md in full: golden capture, PRESSURE from
// second one, COLLAPSE at OT+60 with the 8 m stand exemption) and C15 (the
// full points ledger, stacking).
//
// THREE-free, Node-runnable, deterministic, allocation-free after start() on
// the per-tick paths (flag-transition moments excepted — they are rare by
// construction). Draws only from the m.rng match stream.
//
// HONESTY BOUNDARY (Part 3.7/3.8, doctrine §2): actor.duty targets are built
// from PUBLIC facts only — flag states and stand homes (objective facts,
// modes.md §5.5.3), a DROPPED flag's position (public property), the carrier
// BEACON once revealed (±6 m, 3.0 s — the human gets the identical sample),
// own-team living positions (Tier R radio), and static arena data. A carried
// unrevealed flag has pubPos null and NOTHING here reads its live pos into a
// duty. The duty roles are a CLOSED enum:
//   carrier | runner | escort | defender | interceptor | returner | support.
//
// Termination: capture limit → 0:00 tie-break chain (captures → flag
// pressure → returns → kills → deaths) → overtime golden capture → the
// both-flags-out 90 s reset → COLLAPSE (stand-exempt) → the chain again at
// the OT cap → the driver's draw. The driver's watchdog above all of that is
// a bug detector, not a crutch (AC-2).
//
// KNOWN SEAM GAPS (reported, not hidden — Part 3 preamble: request, don't
// edit):
//  1. The driver blocks ALL overtime respawns (match.js tick step 3 +
//     onActorDeath), which is TDM's §2.3 rule; CTF overtime specifies 8.0 s
//     PRESSURE respawns (§3.7). Needs a mode-owned `rules.overtimeRespawns`
//     knob in W1's driver. Termination is unaffected.
//  2. W1 never wires director.noteDeath/rebuild and passes no homeClusters
//     to makeSpawns, so W2's authored cluster-flip trap override is dead in
//     live play. This mode therefore side-locks + trap-detects via the V7
//     hook itself: during a trap window it vetoes points near the trap
//     deaths (the camper's kill zone) rather than flipping cluster — the
//     flip needs the W1 seam. Forward-compatible: once homeClusters is
//     passed, the director flips and this veto simply agrees with it.
//  3. A BOT carrier's grenade suppression (§3.5.2 parity) lives in W7's
//     carrier role via bot._obj.noGrenade — the AI-lane channel this mode
//     may not write. Human carrier grenades ARE suppressed (flags.js).

import { makeFlags, FLAG_DEFAULTS } from "../flags.js";

const DT = 1 / 60;

const COLLAPSE_DEFAULTS = {
  centre: [-5, 0, 0],
  r0: 12.0, r1: 6.0, shrinkS: 30.0,
  dps0: 5.0, dps1: 15.0, rampS: 20.0,
  armsAfterOtS: 60.0,
};

const POINTS_DEFAULTS = {
  capture: 500, grab: 50, return: 100,
  carrierKill: 150, defendKill: 50, defendR: 12.0,
  escortAssist: 50, escortR: 15.0,
  kill: 100, assist: 25,
};

const PRESSURE_DEFAULTS = { enterS: 60.0, resetS: 90.0 };

const ROLE_LATCH_S = 4.0;      // preempted by any flag event (R11: latches
                               // break on events, not timers)
const TRAP_DIE_S = 6.0;        // §4.3.1 trap test: died within 6 s...
const TRAP_DIE_M = 20.0;       // ...and 20 m of the spawn
const TRAP_OF_LAST = 5, TRAP_MIN = 3;
const TRAP_FOR_S = 20.0;       // the 20 s override window (§4.3.2)
const TRAP_AVOID_M = 20.0;     // veto radius around trap deaths (seam gap 2)
const V7_FLAG_M = 12.0;        // C7: no spawn within 12 m of either flag
const V7_ESCAPE_M = 15.0;      // C7: own stand excluded while own flag CARRIED

// [P2] KILL RESUPPLY — was adopted here by verbatim copy from modes/tdm.js;
// LIFTED to match.js's base ledger by W10 (P2's own note: "W10 lifts it into
// match.js's base ledger"), so ALL modes inherit it from the driver's
// onActorDeath. Still data-driven per mode via content.json pickups
// pk_ammo_kill_refill (the live entry declares "ctf"). In CTF it still
// matters that this is a KILL rule, not a carry rule: a carrier gets no
// regen (flags.js hp clamp) but keeps earning ammo by fighting — monotonic
// with Part 3.7. The mechanism comment + helper live in core/match/match.js.

const ROLES = ["carrier", "runner", "escort", "defender", "interceptor", "returner", "support"];
const URGENCY = { carrier: 0.9, runner: 0.7, escort: 0.6, defender: 0.5, interceptor: 0.8, returner: 1.0, support: 0.4 };

// §5.4 rows as priority-ordered five-slot lists; fewer bots take a prefix
// (≥2 runners stay whenever the enemy flag is takeable — the §3.4
// anti-turtle floor survives the 4-bot human team).
const ROW = {
  homeHome: ["runner", "runner", "defender", "support", "defender"],
  homeCarried: ["escort", "escort", "defender", "support", "defender"],
  homeDropped: ["runner", "runner", "defender", "support", "defender"],
  takenHome: ["interceptor", "interceptor", "interceptor", "defender", "runner"],
  takenCarried: ["interceptor", "interceptor", "escort", "escort", "support"],
  takenDropped: ["interceptor", "interceptor", "runner", "defender", "support"],
};

export function createMode(ctx) {
  const content = ctx.content || {};
  const cc = Object.assign({}, COLLAPSE_DEFAULTS,
    (content.match && content.match.collapse) || {});

  // ---------------------------------------------------------------- state
  const st = {
    prevPhase: "pre",
    flags: null,               // makeFlags instance
    cfg: null, pts: null, pressCfg: null, otCfg: null,
    baseRespawnS: 5.0, baseProtectS: 1.5,
    pressureOn: false,
    bothOffS: 0,
    captures: [0, 0],
    teamReturns: [0, 0],
    otClock: 0,
    otStartCaps: [0, 0],
    collapse: { armed: false, radius: 0, dps: 0, lastEmitR: -1 },
    // §3.7 flag pressure: min nav distance the ENEMY flag ever reached to
    // each team's own stand (C4: NAV distance, sampled at 1 Hz — stated
    // cost decision: per-tick findPath is unaffordable; 1 Hz bounds the
    // error at one second of carrier travel, identically for both teams).
    minPressD: [Infinity, Infinity],
    nextPressT: -1e9,
    // trap override (§4.3.2 as buildable under seam gap 2)
    trapLog: [[], []],         // per team: {actorId, pos:[3], t, trapDeath}
    trapUntil: [-1e9, -1e9],
    trapZones: [[], []],       // per team: positions of the trap deaths
    // side-lock defuse (seam gap 2): the director locks each team to the
    // cluster of its FIRST pick — made before mode.start, i.e. before V7 is
    // reachable — so it can lock a team to a cluster the side rule forbids.
    // Fighting that lock turns every respawn into a centroid fallback. Two
    // consecutive fallback spawns for a team (outside a trap window) prove
    // the contradiction; the side lock then stands down for that team for
    // the match, loudly. Removed entirely once W1 exposes `mode` on the
    // facade before the initial wave (lane report).
    centroidStreak: [0, 0],
    sideLockDefused: [false, false],
    // duty layer
    duties: [],
    dutyAssignedT: new Float64Array(10),
    dutyEpochAt: new Int32Array(10),
    dutyEpoch: 0,
    // scoring context handoff between onKill and scoreForKill (same driver
    // call — onKill runs while the victim still carries, onDeath drops)
    kevCtx: { victimWho: null, victimCarriedFlagTeam: -1, t: -1e9 },
    carryS: null,              // per-actorId carry seconds (scoreboard §7.3)
    pub: null,
    clusterOfPoint: new Map(),
    homeSet: [null, null],     // Set of allowed cluster ids per team
    zoneApplied: new Float64Array(10),
    hudLine(text, t) { if (st.pub) st.pub.hudLine = { text, t }; },
    // pre-start V7 data (the driver spawns all 10 BEFORE mode.start runs):
    // flag homes for the 12 m rule, side sets for the lock — seeded from
    // content at factory time, refined from m.rules at start().
    preHomes: [],
  };
  {
    const cm = (content.modes && content.modes.ctf) || {};
    const sc0 = cm.sideClusters || null;
    if (sc0) {
      st.homeSet[0] = new Set(sc0[0] || sc0["0"] || []);
      st.homeSet[1] = new Set(sc0[1] || sc0["1"] || []);
    }
    for (const f of content.flags || []) {
      st.preHomes.push([f.home[0], f.home[1] || 0, f.home[2]]);
    }
  }
  for (let i = 0; i < 10; i++) {
    st.duties.push({ role: null, target: [0, 0, 0], urgency: 0, targetHint: null });
    st.dutyAssignedT[i] = -1e9;
  }

  // scratch (2 Hz / transition paths — reused, never reallocated)
  const scrBots = [];
  const scrFree = [];
  const scrMid = [[0, 0, 0], [0, 0, 0]]; // per-team support midpoint
  const scrQuota = { carrier: 0, runner: 0, escort: 0, defender: 0, interceptor: 0, returner: 0, support: 0 };

  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  function navDist(from, to, nav) {
    if (nav && nav.findPath) {
      const path = nav.findPath(from, to);
      if (path && path.length >= 2) {
        let d = 0;
        for (let i = 1; i < path.length; i++) {
          d += Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
        }
        return d;
      }
    }
    return dist2d(from[0], from[2], to[0], to[2]);
  }

  function setDutyOf(m, actor, role, tx, ty, tz, hint, t) {
    const d = st.duties[actor.actorId];
    if (d.role !== role) {
      st.dutyAssignedT[actor.actorId] = t;
      st.dutyEpochAt[actor.actorId] = st.dutyEpoch;
    }
    d.role = role;
    d.target[0] = tx; d.target[1] = ty; d.target[2] = tz;
    d.urgency = URGENCY[role];
    d.targetHint = hint;
    if (actor.duty !== d) m.setDuty(actor, d);
  }

  // ---------------------------------------------------------------- rules
  function applyPressureRules(m, on) {
    if (on === st.pressureOn) return;
    st.pressureOn = on;
    if (on) {
      m.rules.respawnS = m.rules.respawnPressureS != null ? m.rules.respawnPressureS : 8.0;
      m.rules.protectS = m.rules.protectPressureS != null ? m.rules.protectPressureS : 0.75;
      st.hudLine("PRESSURE — FLAGS CONTESTED", m.time);
    } else {
      m.rules.respawnS = st.baseRespawnS;
      m.rules.protectS = st.baseProtectS;
    }
    st.pub.pressure.active = on;
    m.emit("pressure", { on });
  }

  // ---------------------------------------------------------------- ticks
  function pressureTick(m, dt) {
    const F = st.flags.pub;
    const bothOff = F[0].state !== "AT_STAND" && F[1].state !== "AT_STAND";
    if (bothOff) st.bothOffS += dt; else st.bothOffS = 0;
    st.pub.pressure.bothOffS = Math.round(st.bothOffS * 100) / 100;

    const wantOn = m.phase === "overtime" || st.bothOffS >= st.pressCfg.enterS;
    applyPressureRules(m, wantOn);

    if (st.bothOffS >= st.pressCfg.resetS) {
      // §3.6 90 s: both force-return, no points, honest banner
      st.flags.forceReturn(F[0], "stalemate");
      st.flags.forceReturn(F[1], "stalemate");
      st.flags.counters.forcedResets++; // AC-6: the battery asserts ≤1/match
      st.bothOffS = 0;
      st.hudLine("FLAGS RESET — STALEMATE", m.time);
    }
  }

  function pressureSample(m) {
    const t = m.time;
    if (t < st.nextPressT) return;
    st.nextPressT = t + 1.0;
    const F = st.flags.pub;
    for (let team = 0; team < 2; team++) {
      const enemyFlag = F[1 - team];
      if (enemyFlag.state === "AT_STAND") continue;
      const d = navDist(enemyFlag.pos, F[team].home, m.nav);
      if (d < st.minPressD[team]) st.minPressD[team] = d;
    }
    st.pub.flagPressure[0] = Math.round(st.minPressD[0] * 10) / 10;
    st.pub.flagPressure[1] = Math.round(st.minPressD[1] * 10) / 10;
  }

  function collapseTick(m, dt) {
    const c = st.collapse;
    if (st.otClock < cc.armsAfterOtS) return;
    const tSinceArm = st.otClock - cc.armsAfterOtS;
    if (!c.armed) {
      c.armed = true;
      c.radius = cc.r0; c.dps = cc.dps0; c.lastEmitR = cc.r0;
      m.emit("collapse", { armed: true, radius: c.radius });
    }
    c.radius = cc.r1 + (cc.r0 - cc.r1) * Math.max(0, 1 - tSinceArm / cc.shrinkS);
    c.dps = cc.dps0 + (cc.dps1 - cc.dps0) * Math.min(1, tSinceArm / cc.rampS);
    if (Math.abs(c.radius - c.lastEmitR) >= 0.5) {
      c.lastEmitR = c.radius;
      m.emit("collapse", { armed: true, radius: c.radius });
    }
    const F = st.flags.pub;
    const exemptM = st.otCfg.collapseStandExemptM != null ? st.otCfg.collapseStandExemptM : 8.0;
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.alive) continue;
      const p = m.posOf(a);
      if (!p) continue;
      if (dist2d(p[0], p[2], cc.centre[0], cc.centre[2]) <= c.radius) continue;
      // §3.7 CTF exemption: never damage a flag carrier, nor anyone within
      // 8 m of either stand — the objective stays playable under the ring.
      if (st.flags.carriedBy(a.who)) continue;
      if (dist2d(p[0], p[2], F[0].home[0], F[0].home[2]) <= exemptM) continue;
      if (dist2d(p[0], p[2], F[1].home[0], F[1].home[2]) <= exemptM) continue;
      const amt = c.dps * dt;
      st.zoneApplied[i] += amt;
      m.sim.damage(a.who, amt, "zone");
    }
    const pub = st.pub.collapse;
    pub.armed = true;
    pub.radius = Math.round(c.radius * 100) / 100;
    pub.dps = Math.round(c.dps * 100) / 100;
  }

  // ---------------------------------------------------------------- duties
  function rowFor(own, enemy) {
    const ownKey = own.state === "CARRIED" ? "taken" : "home"; // DROPPED → home row + returner
    const enKey = enemy.state === "AT_STAND" ? "Home" : enemy.state === "CARRIED" ? "Carried" : "Dropped";
    return ROW[ownKey + enKey];
  }

  function assignTeamDuties(m, team, t) {
    const F = st.flags.pub;
    const own = F[team], enemy = F[1 - team];
    scrBots.length = 0;
    for (const a of m.actors) {
      if (a.alive && a.kind === "bot" && a.team === team) scrBots.push(a);
    }
    if (!scrBots.length) return;

    // support midpoint: 60 % toward the enemy stand (§5.4)
    const mid = scrMid[team];
    mid[0] = own.home[0] * 0.4 + enemy.home[0] * 0.6;
    mid[1] = 0;
    mid[2] = own.home[2] * 0.4 + enemy.home[2] * 0.6;

    const targetOf = (role, out) => {
      // returns [x,y,z, hint] via out array + returned hint
      switch (role) {
        case "carrier": out[0] = own.home[0]; out[1] = own.home[1]; out[2] = own.home[2]; return "flag";
        case "runner": {
          const p = enemy.state === "AT_STAND" ? enemy.home : enemy.state === "DROPPED" ? enemy.pos : enemy.home;
          out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return "flag";
        }
        case "escort": {
          // friendly carrier's exact pos — Tier R teammate radio (Part 3.8)
          const ca = enemy.state === "CARRIED" ? m.actorOf(enemy.carrier) : null;
          const p = ca ? m.posOf(ca) : null;
          if (p) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return "escort"; }
          out[0] = mid[0]; out[1] = 0; out[2] = mid[2]; return null;
        }
        case "defender": out[0] = own.home[0]; out[1] = own.home[1]; out[2] = own.home[2]; return "stand";
        case "interceptor": {
          // ONLY the beacon (±6 m, ≥3 s) — never the carried flag's live pos
          const b = own.state === "CARRIED" ? own.pubPos : null;
          if (b) { out[0] = b[0]; out[1] = b[1]; out[2] = b[2]; return "cutoff"; }
          out[0] = own.home[0]; out[1] = own.home[1]; out[2] = own.home[2]; return "stand";
        }
        case "returner": out[0] = own.pos[0]; out[1] = own.pos[1]; out[2] = own.pos[2]; return "flag";
        case "support": out[0] = mid[0]; out[1] = 0; out[2] = mid[2]; return null;
      }
      return null;
    };

    // desired quota for this team-state row
    for (const r of ROLES) scrQuota[r] = 0;
    // forced carrier: our bot carrying the enemy flag (§5.4 override row)
    let carrierBot = null;
    if (enemy.state === "CARRIED") {
      const ca = m.actorOf(enemy.carrier);
      if (ca && ca.kind === "bot" && ca.team === team) carrierBot = ca;
    }
    const slots = scrBots.length - (carrierBot ? 1 : 0);
    let need = slots;
    if (own.state === "DROPPED" && need > 0) { scrQuota.returner = 1; need--; }
    const row = rowFor(own, enemy);
    for (let i = 0; i < row.length && need > 0; i++) {
      let r = row[i];
      // interceptor without a beacon degrades to defender (§5.4: falls back)
      if (r === "interceptor" && !(own.state === "CARRIED" && own.pubPos)) r = "defender";
      // escort with no living friendly carrier degrades to runner
      if (r === "escort" && !(enemy.state === "CARRIED")) r = "runner";
      scrQuota[r]++; need--;
    }

    // pass 1 — latched bots keep a role that is still in quota (targets are
    // ALWAYS refreshed; a flag event bumps dutyEpoch and voids every latch)
    const tmp = [0, 0, 0];
    scrFree.length = 0;
    for (const a of scrBots) {
      if (a === carrierBot) continue;
      const d = st.duties[a.actorId];
      const latched = d.role !== null && d.role !== "carrier" &&
        t - st.dutyAssignedT[a.actorId] < ROLE_LATCH_S &&
        st.dutyEpochAt[a.actorId] === st.dutyEpoch;
      if (latched && scrQuota[d.role] > 0) {
        scrQuota[d.role]--;
        const hint = targetOf(d.role, tmp);
        setDutyOf(m, a, d.role, tmp[0], tmp[1], tmp[2], hint, t);
      } else {
        scrFree.push(a);
      }
    }
    if (carrierBot) {
      const hint = targetOf("carrier", tmp);
      setDutyOf(m, carrierBot, "carrier", tmp[0], tmp[1], tmp[2], hint, t);
    }

    // pass 2 — fill remaining quota nearest-first per role, deterministic
    // (role order fixed, ties broken by actorId order inside takeNearest)
    const takeNearest = (x, z) => {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < scrFree.length; i++) {
        const p = m.posOf(scrFree[i]);
        const dd = p ? dist2d(p[0], p[2], x, z) : Infinity;
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best < 0) return null;
      return scrFree.splice(best, 1)[0];
    };
    for (const role of ROLES) {
      while (scrQuota[role] > 0 && scrFree.length) {
        scrQuota[role]--;
        const hint = targetOf(role, tmp);
        const a = takeNearest(tmp[0], tmp[2]);
        if (a) setDutyOf(m, a, role, tmp[0], tmp[1], tmp[2], hint, t);
      }
    }
    // anything left over supports
    while (scrFree.length) {
      const a = scrFree.shift();
      const hint = targetOf("support", tmp);
      setDutyOf(m, a, "support", tmp[0], tmp[1], tmp[2], hint, t);
    }
  }

  // ---------------------------------------------------------------- trap
  function noteSpawn(m, ev) {
    const a = ev.actor;
    if (a.team !== 0 && a.team !== 1) return;
    // side-lock defuse bookkeeping (see st.sideLockDefused)
    if (!st.sideLockDefused[a.team] && m.time >= st.trapUntil[a.team]) {
      if (ev.pointId == null && st.flags) { // post-start fallback spawn
        if (++st.centroidStreak[a.team] >= 2) {
          st.sideLockDefused[a.team] = true;
          console.warn(`[ctf] side lock DEFUSED for team ${a.team} — the spawn director locked a cluster the side rule forbids (W1 seam: V7 unreachable for the initial wave)`);
        }
      } else {
        st.centroidStreak[a.team] = 0;
      }
    }
    const log = st.trapLog[a.team];
    log.push({
      actorId: a.actorId,
      pos: [ev.pos[0], ev.pos[1] || 0, ev.pos[2]],
      t: m.time, trapDeath: false,
    });
    if (log.length > 8) log.shift();
  }

  function noteTrapDeath(m, actor, pos, t) {
    if (actor.team !== 0 && actor.team !== 1) return;
    const log = st.trapLog[actor.team];
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].actorId !== actor.actorId) continue;
      if (t - log[i].t <= TRAP_DIE_S && pos &&
          dist2d(pos[0], pos[2], log[i].pos[0], log[i].pos[2]) <= TRAP_DIE_M) {
        log[i].trapDeath = true;
      }
      break; // most recent spawn of this actor only
    }
    const last = log.slice(-TRAP_OF_LAST);
    if (last.length < TRAP_MIN) return;
    let traps = 0;
    const zones = [];
    for (const r of last) if (r.trapDeath) { traps++; zones.push(r.pos); }
    if (traps < TRAP_MIN) return;
    st.trapUntil[actor.team] = t + TRAP_FOR_S;
    st.trapZones[actor.team] = zones.slice(0, TRAP_OF_LAST);
    log.length = 0; // consume the window
    st.pub.spawnCompromised.push({ team: actor.team, untilT: Math.round((t + TRAP_FOR_S) * 100) / 100 });
    if (st.pub.spawnCompromised.length > 6) st.pub.spawnCompromised.shift();
    st.hudLine("SPAWN COMPROMISED — FALLING BACK", t);
  }

  // ---------------------------------------------------------------- chain
  // §3.7 regulation tie-break chain; fromStep 1 at 0:00, 2 at the OT cap.
  function tieBreak(m, fromStep, tag) {
    const EPS = 0.25;
    if (fromStep <= 1) {
      if (st.captures[0] !== st.captures[1]) {
        return { result: "win", winnerTeam: st.captures[0] > st.captures[1] ? 0 : 1, reason: tag + " (captures)" };
      }
    }
    // 2 — flag pressure: LOWER minimum nav distance is better; a team that
    // never took the enemy flag holds the full stand-to-stand path and
    // loses to any team that made one real attempt (the anti-turtle rule).
    if (Math.abs(st.minPressD[0] - st.minPressD[1]) > EPS) {
      return { result: "win", winnerTeam: st.minPressD[0] < st.minPressD[1] ? 0 : 1, reason: tag + " (flag pressure)" };
    }
    if (st.teamReturns[0] !== st.teamReturns[1]) {
      return { result: "win", winnerTeam: st.teamReturns[0] > st.teamReturns[1] ? 0 : 1, reason: tag + " (returns)" };
    }
    let k0 = 0, k1 = 0, d0 = 0, d1 = 0;
    for (const a of m.actors) {
      if (a.team === 0) { k0 += a.kills; d0 += a.deaths; }
      else if (a.team === 1) { k1 += a.kills; d1 += a.deaths; }
    }
    if (k0 !== k1) return { result: "win", winnerTeam: k0 > k1 ? 0 : 1, reason: tag + " (kills)" };
    if (d0 !== d1) return { result: "win", winnerTeam: d0 < d1 ? 0 : 1, reason: tag + " (fewer deaths)" };
    return null;
  }

  // ---------------------------------------------------------------- HUD
  const hud = {
    headline: "CAPTURE THE FLAG",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "ctf_caps", label: "", state: "active" }],
    markers: [],
  };
  const standMarkers = [
    { id: "stand_0", kind: "flagstand", team: 0, pos: [0, 0, 0] },
    { id: "stand_1", kind: "flagstand", team: 1, pos: [0, 0, 0] },
  ];
  const flagMarkers = [
    { id: "flag_0", kind: "flag", team: 0, pos: [0, 0, 0], state: "AT_STAND", revealed: false },
    { id: "flag_1", kind: "flag", team: 1, pos: [0, 0, 0], state: "AT_STAND", revealed: false },
  ];
  const collapseMarker = { id: "collapse", kind: "collapse", pos: cc.centre, radius: 0 };

  // ---------------------------------------------------------------- mode
  return {
    _st: st, // private — selftest introspection only (mirrors tdm.js)
    id: "ctf",
    displayName: "CAPTURE THE FLAG",
    teamCount: 2,
    // C12 — ARITHMETIC not measurement; AC-41 moves the NUMBER (in
    // content.modes.ctf), never the design.
    defaults: {
      captureLimit: 3, timeLimitS: 720,
      respawnS: 5.0, respawnPressureS: 8.0,
      protectS: 1.5, protectPressureS: 0.75,
    },

    start(m) {
      // SEAM REPAIR (reported): W2's director consults m.mode.spawnVeto
      // (spawns.js:370) but W1's facade never exposes `.mode`, so V7 is
      // dead on arrival. Attaching it here wires V7 for every post-start
      // pick (all respawns). The INITIAL wave still spawns before
      // mode.start — closing that needs W1 (expose `mode` on the facade,
      // or pass homeClusters into makeSpawns) — lane report, gap 2.
      if (!m.mode) m.mode = this;
      const R = m.rules;
      st.cfg = Object.assign({}, FLAG_DEFAULTS, R.flag || {});
      st.pts = Object.assign({}, POINTS_DEFAULTS, R.points || {});
      st.pressCfg = Object.assign({}, PRESSURE_DEFAULTS, R.pressure || {});
      st.otCfg = Object.assign({}, R.overtime || {});
      st.baseRespawnS = R.respawnS != null ? R.respawnS : 5.0;
      st.baseProtectS = R.protectS != null ? R.protectS : 1.5;

      // side sets (C2 remap): content.modes.ctf.sideClusters, last entry =
      // the trap fallback; absent → no side lock (bare fixtures).
      const sc = R.sideClusters || null;
      for (let team = 0; team < 2; team++) {
        st.homeSet[team] = sc && sc[team] ? new Set(sc[team]) : null;
      }
      st.clusterOfPoint.clear();
      for (const p of (m.arena ? m.arena.spawnPoints : [])) {
        st.clusterOfPoint.set(p.id, p.cluster);
      }

      // public sub-state
      st.pub = m.state.mode;
      st.pub.pressure = { active: false, bothOffS: 0 };
      st.pub.collapse = { armed: false, centre: [cc.centre[0], cc.centre[1], cc.centre[2]], radius: 0, dps: 0 };
      st.pub.hudLine = null;
      st.pub.spawnCompromised = [];
      st.pub.flagPressure = [0, 0];
      st.pub.flagLog = [];
      st.carryS = new Array(10).fill(0);
      st.pub.carryS = st.carryS;

      // the flag machine — scoring hooks are the C15 ledger
      st.flags = makeFlags(m, st.cfg, {
        log: (e) => {
          st.dutyEpoch++; // flag events void duty latches (R11)
          st.pub.flagLog.push(e);
          if (st.pub.flagLog.length > 48) st.pub.flagLog.shift();
        },
        grab: (actor, f) => {
          m.addScore(actor, st.pts.grab, "grab");
          st.hudLine(actor.team === 0
            ? `${actor.name} HAS THE ${teamName(m, f.team)} FLAG`
            : "YOUR FLAG HAS BEEN TAKEN", m.time);
        },
        ret: (actor, f) => {
          if (actor) {
            m.addScore(actor, st.pts.return, "return");
            actor.returns++;
            st.teamReturns[actor.team]++;
          }
        },
        capture: (actor, f) => {
          st.captures[actor.team]++;
          actor.captures++;
          m.addScore(actor, st.pts.capture, "capture");
          m.addTeamScore(actor.team, 1, "capture");
          const T = m.state.teams.find((x) => x.id === actor.team);
          if (T) T.captures = st.captures[actor.team];
          st.hudLine(`${actor.name} CAPTURED THE FLAG`, m.time);
        },
        blocked: (actor) => {
          st.hudLine("RETURN YOUR FLAG TO CAPTURE", m.time);
        },
      });
      st.flags.start();
      st.pub.counters = st.flags.counters;

      standMarkers[0].pos = st.flags.pub[0].home;
      standMarkers[1].pos = st.flags.pub[1].home;

      // flag-pressure baseline: the full stand-to-stand nav path (C4)
      const F = st.flags.pub;
      const d01 = navDist(F[0].home, F[1].home, m.nav);
      st.minPressD[0] = d01;
      st.minPressD[1] = d01;
      st.pub.flagPressure[0] = Math.round(d01 * 10) / 10;
      st.pub.flagPressure[1] = Math.round(d01 * 10) / 10;
      st.nextPressT = -1e9;
    },

    tick(m, dt) {
      const ph = m.phase;
      if (ph === "overtime" && st.prevPhase !== "overtime") {
        // §3.7 overtime start: both flags force-reset, PRESSURE from the
        // first second (permanent reveal + 0.75 s protection; the 8 s
        // respawn is blocked by the driver — seam gap 1).
        st.otClock = 0;
        st.otStartCaps[0] = st.captures[0];
        st.otStartCaps[1] = st.captures[1];
        st.flags.resetBoth("overtime");
        st.bothOffS = 0;
        st.hudLine("OVERTIME — GOLDEN CAPTURE", m.time);
      }
      if (ph === "live" || ph === "overtime") {
        st.flags.tick(dt, { t: m.time, pressureOn: st.pressureOn });
        pressureTick(m, dt);
        pressureSample(m);
        // carry-time ledger (scoreboard §7.3)
        for (const f of st.flags.pub) {
          if (f.state === "CARRIED" && f.carrierActorId >= 0) {
            st.carryS[f.carrierActorId] += dt; // raw; readers round for display
          }
        }
      }
      if (ph === "overtime") {
        st.otClock += dt;
        collapseTick(m, dt);
      }
      st.prevPhase = ph;
    },

    end(m, outcome) {
      // restore the rules we mutated; flags freeze in place (§3.8)
      if (st.pressureOn) {
        m.rules.respawnS = st.baseRespawnS;
        m.rules.protectS = st.baseProtectS;
      }
      // F1 (AC-5): §3.8 freezes a CARRIED flag at the horn, and AC-5 allows
      // exactly AT_STAND | CARRIED as end states — but a flag DROPPED inside
      // its 30 s dropReturnS window when the clock expires used to freeze as
      // DROPPED and fail the end-state invariant. Nothing plays after the
      // horn, so a dangling drop returns home (same machinery as stalemate).
      if (st.flags) {
        for (const f of m.state.flags || []) {
          if (f.state === "DROPPED") st.flags.forceReturn(f, "matchEnd");
        }
      }
    },

    onSpawn(m, ev) {
      st.zoneApplied[ev.actor.actorId] = 0;
      noteSpawn(m, ev);
    },

    onKill(m, ev) {
      // runs while the victim still CARRIES (the drop happens in onDeath) —
      // capture the carrier-kill fact for scoreForKill.
      const carried = st.flags.carriedBy(ev.victim.who);
      st.kevCtx.victimWho = ev.victim.who;
      st.kevCtx.victimCarriedFlagTeam = carried ? carried.team : -1;
      st.kevCtx.t = ev.t;
      // team score in CTF is CAPTURES — kills never touch it.
      // ([P2] kill resupply now lands in the driver's base ledger.)
    },

    onDeath(m, ev) {
      st.flags.onActorDeath(ev.actor.who, ev.pos);
      noteTrapDeath(m, ev.actor, ev.pos, ev.t);
    },

    // C15 — the full ledger, stacking (kill 100 + carrier 150 + defend 50 +
    // escort 50 can all land on one bullet; assists 25 ride along).
    scoreForKill(m, kev) {
      const entries = [{ actor: kev.attacker, points: st.pts.kill, reason: "kill" }];
      for (const aid of kev.assists) {
        entries.push({ actor: m.actors[aid], points: st.pts.assist, reason: "assist" });
      }
      const A = kev.attacker;
      // carrier kill: the victim was carrying YOUR team's flag
      if (st.kevCtx.victimWho === kev.victim.who && st.kevCtx.t === kev.t &&
          st.kevCtx.victimCarriedFlagTeam === A.team) {
        entries.push({ actor: A, points: st.pts.carrierKill, reason: "carrier kill" });
      }
      const F = st.flags.pub;
      // defend kill: within 12 m of your own stand
      if (kev.pos && dist2d(kev.pos[0], kev.pos[2], F[A.team].home[0], F[A.team].home[2]) <= st.pts.defendR) {
        entries.push({ actor: A, points: st.pts.defendKill, reason: "defend kill" });
      }
      // escort assist: within 15 m of your own team's living carrier
      const ourCarry = F[1 - A.team]; // the flag OUR carrier would hold
      if (ourCarry.state === "CARRIED" && ourCarry.carrier !== A.who) {
        const ca = m.actorOf(ourCarry.carrier);
        if (ca && ca.alive && ca.team === A.team && kev.pos &&
            dist2d(kev.pos[0], kev.pos[2], ourCarry.pos[0], ourCarry.pos[2]) <= st.pts.escortR) {
          entries.push({ actor: A, points: st.pts.escortAssist, reason: "escort assist" });
        }
      }
      return entries;
    },

    // C7 V7 (ctf): 12 m of either flag's CURRENT position; 15 m of your own
    // stand while your own flag is CARRIED; the side lock; the trap window's
    // kill-zone avoidance (seam gap 2 — see header).
    spawnVeto(m, actor, p) {
      const F = st.flags ? st.flags.pub : null;
      if (F && F.length) {
        for (const f of F) {
          if (dist2d(p.pos[0], p.pos[2], f.pos[0], f.pos[2]) < V7_FLAG_M) return true;
        }
        const own = F[actor.team];
        if (own && own.state === "CARRIED" &&
            dist2d(p.pos[0], p.pos[2], own.home[0], own.home[2]) < V7_ESCAPE_M) return true;
      } else {
        // pre-start (initial spawn wave): flags are at their content homes
        for (const h of st.preHomes) {
          if (dist2d(p.pos[0], p.pos[2], h[0], h[2]) < V7_FLAG_M) return true;
        }
      }
      const allowed = st.homeSet[actor.team];
      if (allowed && p.cluster && !st.sideLockDefused[actor.team] &&
          !allowed.has(p.cluster)) return true;
      if (m.time < st.trapUntil[actor.team]) {
        for (const z of st.trapZones[actor.team]) {
          if (dist2d(p.pos[0], p.pos[2], z[0], z[2]) < TRAP_AVOID_M) return true;
        }
      }
      return false;
    },

    assignDuties(m) {
      const t = m.time;
      assignTeamDuties(m, 0, t);
      assignTeamDuties(m, 1, t);
    },

    checkWin(m) {
      const lim = m.rules.captureLimit != null ? m.rules.captureLimit : 3;
      if (st.captures[0] >= lim || st.captures[1] >= lim) {
        return { result: "win", winnerTeam: st.captures[0] >= lim ? 0 : 1, reason: "capture limit" };
      }
      if (m.phase === "live") {
        if (m.timeLeft <= 0) {
          // §3.7 the regulation chain; every step tied → null → OVERTIME
          return tieBreak(m, 1, "time");
        }
        return null;
      }
      if (m.phase === "overtime") {
        // golden capture
        if (st.captures[0] > st.otStartCaps[0]) return { result: "win", winnerTeam: 0, reason: "golden capture" };
        if (st.captures[1] > st.otStartCaps[1]) return { result: "win", winnerTeam: 1, reason: "golden capture" };
        // the chain re-runs from step 2 one tick before the driver's draw
        if (m.timeLeft <= DT * 1.5) return tieBreak(m, 2, "overtime");
        return null;
      }
      return null;
    },

    hudModel(m) {
      const F = st.flags ? st.flags.pub : null;
      hud.clockS = m.timeLeft;
      hud.us = st.captures[0];
      hud.them = st.captures[1];
      const o = hud.objectives[0];
      if (st.collapse.armed) o.label = "COLLAPSE — MOVE TO THE PLAZA";
      else if (m.phase === "overtime") o.label = "OVERTIME — GOLDEN CAPTURE";
      else if (st.pressureOn) o.label = "PRESSURE — FLAGS CONTESTED";
      else o.label = "CAPTURE — FIRST TO " + (m.rules.captureLimit != null ? m.rules.captureLimit : 3);
      o.state = "active";
      hud.markers.length = 0;
      hud.markers.push(standMarkers[0], standMarkers[1]);
      if (F) {
        for (let i = 0; i < 2; i++) {
          const fm = flagMarkers[i];
          fm.state = F[i].state;
          fm.revealed = F[i].revealed;
          // marker position is the PUBLIC one (marker on the FLAG — §3.5.5)
          const p = F[i].pubPos;
          if (p) { fm.pos[0] = p[0]; fm.pos[1] = p[1]; fm.pos[2] = p[2]; hud.markers.push(fm); }
        }
      }
      if (st.collapse.armed) {
        collapseMarker.radius = st.collapse.radius;
        hud.markers.push(collapseMarker);
      }
      return hud;
    },
  };

  function teamName(m, team) {
    const T = m.state.teams.find((x) => x.id === team);
    return T ? T.name : String(team);
  }
}
